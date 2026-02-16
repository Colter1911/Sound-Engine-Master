import { AudioEngine } from '@core/AudioEngine';
import { SocketManager } from '@sync/SocketManager';
import { LibraryManager } from '@lib/LibraryManager';
import { PlaybackQueueManager } from '@queue/PlaybackQueueManager';
import { LocalLibraryApp } from './LocalLibraryApp';
import { SoundMixerApp } from './SoundMixerApp';
import { SoundEffectsApp } from './SoundEffectsApp';
import { Logger } from '@utils/logger';

const MODULE_ID = 'sound-engine-master';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

interface AppState {
    activeTab: 'mixer' | 'library' | 'online' | 'sfx';
    syncEnabled: boolean;
}

export class AdvancedSoundEngineApp extends HandlebarsApplicationMixin(ApplicationV2) {
    private engine: AudioEngine;
    private socket: SocketManager;
    private libraryManager: LibraryManager;
    private queueManager: PlaybackQueueManager;

    // Sub-apps (Controllers)
    private libraryApp: LocalLibraryApp;
    private mixerApp: SoundMixerApp;
    private effectsApp: SoundEffectsApp;

    // Stored callback for cleanup
    private _onQueueChangeBound!: () => void;

    public state: AppState = {
        activeTab: 'library', // Default to library as per user focus
        syncEnabled: false
    };

    /**
     * Define the templates used by this application.
     * In V2, we define parts rather than a single template.
     */
    static override PARTS = {
        main: {
            template: `modules/${MODULE_ID}/templates/main-app.hbs`,
            scrollable: ['.ase-content-body']
        }
    };

    static override DEFAULT_OPTIONS = {
        id: 'sound-engine-master-app',
        tag: 'form',
        window: {
            title: 'ASE.Title',
            icon: 'fas fa-music',
            resizable: true,
            controls: []
        },
        position: {
            width: 1440,
            height: 1050
        },
        classes: ['ase-window-layout']
    };

    constructor(engine: AudioEngine, socket: SocketManager, libraryManager: LibraryManager, queueManager: PlaybackQueueManager, options: any = {}) {
        super(options);
        this.engine = engine;
        this.socket = socket;
        this.libraryManager = libraryManager;
        this.queueManager = queueManager;

        // Initialize sub-controllers
        this.libraryApp = new LocalLibraryApp(this.libraryManager, this);
        this.mixerApp = new SoundMixerApp(this.engine, this.socket, this.libraryManager, this.queueManager);
        this.effectsApp = new SoundEffectsApp(this.engine, this.socket);

        // Set render callback for mixer to trigger parent re-render
        this.mixerApp.setRenderCallback(() => {
            if (this.state.activeTab === 'mixer') {
                this.captureScroll(); // Capture before re-rendering
                this.render({ parts: ['main'] });
            }
        });

        this.effectsApp.setRenderCallback(() => {
            if (this.state.activeTab === 'sfx') {
                this.captureScroll();
                this.render({ parts: ['main'] });
            }
        });

        // Subscribe to queue changes for UI updates
        this._onQueueChangeBound = () => {
            if (this.state.activeTab === 'mixer') {
                this.captureScroll();
                this.render({ parts: ['main'] });
            }
        };
        this.queueManager.on('change', this._onQueueChangeBound);

        // Restore Local Volume (UI Preference)
        const savedLocalVol = localStorage.getItem('ase-gm-local-volume');
        if (savedLocalVol !== null) {
            this.engine.setLocalVolume(parseFloat(savedLocalVol));
        }
    }

    /**
     * V2 Context Preparation (replaces getData)
     */
    protected override async _prepareContext(options: any): Promise<any> {
        const moduleVersion = (globalThis as any).game?.modules?.get(MODULE_ID)?.version ?? '0.0.0';
        const volumes = this.engine.volumes;

        // Helper to check channel status
        const getChannelStatus = (group: 'music' | 'ambience' | 'sfx') => {
            const tracks = this.engine.getTracksByGroup(group);
            if (tracks.length === 0) return { playing: false, paused: false };

            const isPlaying = tracks.some(t => t.state === 'playing');
            const isPaused = tracks.some(t => t.state === 'paused');

            return { playing: isPlaying, paused: isPaused && !isPlaying };
        };

        const status = {
            music: getChannelStatus('music'),
            ambience: getChannelStatus('ambience'),
            sfx: getChannelStatus('sfx')
        };

        // Get content for the active tab manually (legacy support for sub-apps returning data)
        const renderTemplate = globalThis.renderTemplate; // V13 Compatibility

        let tabContent = '';
        if (this.state.activeTab === 'library') {
            const libData = await this.libraryApp.getData();
            tabContent = await renderTemplate('modules/sound-engine-master/templates/library.hbs', libData as any);
        } else if (this.state.activeTab === 'mixer') {
            const mixerData = await this.mixerApp.getData();
            tabContent = await renderTemplate(`modules/${MODULE_ID}/templates/mixer.hbs`, mixerData as any);
        } else if (this.state.activeTab === 'sfx') {
            Logger.info(`[AdvancedSoundEngineApp] Rendering SFX tab...`);
            const effectsData = await this.effectsApp.getData();
            tabContent = await renderTemplate(`modules/${MODULE_ID}/templates/effects.hbs`, effectsData as any);
        }

        return {
            activeTab: this.state.activeTab,
            tabContent,
            status,
            volumes: {
                master: Math.round(volumes.master * 100),
                music: Math.round(volumes.music * 100),
                ambience: Math.round(volumes.ambience * 100),
                sfx: Math.round(volumes.sfx * 100),
                local: Math.round(this.engine.localVolume * 100)
            },
            syncEnabled: this.socket.syncEnabled,
            // Pass state for Handlebars if needed
            tabs: [
                { id: 'library', label: game.i18n!.localize('ASE.UI.Tabs.Library'), icon: 'fas fa-book-open', active: this.state.activeTab === 'library' },
                { id: 'mixer', label: game.i18n!.localize('ASE.UI.Tabs.Mixer'), icon: 'fas fa-sliders-h', active: this.state.activeTab === 'mixer' },
                { id: 'sfx', label: game.i18n!.localize('ASE.UI.Tabs.Effects'), icon: 'fas fa-wave-square', active: this.state.activeTab === 'sfx' },
                { id: 'online', label: game.i18n!.localize('ASE.UI.Tabs.Online'), icon: 'fas fa-globe', active: this.state.activeTab === 'online' }
            ],
            moduleVersion
        };
    }

    /**
     * V2 Render Hook (replaces activateListeners)
     * Note: In V2, `this.element` is the HTML element itself, not a jQuery object.
     * However, we wrap it in jQuery for compatibility with existing listener logic if preferred, 
     * or use vanilla JS. Sticking to jQuery for now to minimize logic rewrite risks.
     */
    protected override _onRender(context: any, options: any): void {
        Logger.info(`[AdvancedSoundEngineApp] _onRender called. Active Tab: ${this.state.activeTab}`);
        super._onRender(context, options);

        // Wrap native element in jQuery for legacy compatibility
        const html = $(this.element);

        // Tab Navigation
        html.find('.ase-tab').on('click', this.onTabSwitch.bind(this));

        // Footer Controls (A7)
        html.find('[data-action="toggle-sync"]').on('click', this.onToggleSync.bind(this));
        html.find('[data-action="global-play"]').on('click', this.onGlobalPlay.bind(this));
        html.find('[data-action="global-pause"]').on('click', this.onGlobalPause.bind(this));
        html.find('[data-action="global-stop"]').on('click', this.onGlobalStop.bind(this));

        // Mixer Sliders (Inputs)
        html.find('.ase-volume-slider').on('input', this.onVolumeInput.bind(this));

        // Delegate listeners to sub-apps
        if (this.state.activeTab === 'library') {
            this.libraryApp.activateListeners(html);
        } else if (this.state.activeTab === 'mixer') {
            this.mixerApp.activateListeners(html);
        } else if (this.state.activeTab === 'sfx') {
            Logger.info('[AdvancedSoundEngineApp] Delegating to effectsApp.activateListeners');
            this.effectsApp.activateListeners(html);
        }

        // Restore Scroll (Global Smart Scroll)
        this.restoreScroll();
    }

    // Unified Scroll State Store
    private scrollStates: Record<'library' | 'mixer' | 'sfx' | 'online', Record<string, number>> = {
        library: {
            '.ase-track-player-list': 0,
            '.ase-list-group': 0, // Playlists list
            '.ase-favorites-section .ase-list-group': 0 // Favorites
        },
        mixer: {
            '[data-section="mixer-queue"]': 0,
            '[data-section="mixer-favorites"]': 0
        },
        sfx: {
            '.ase-effects-layout': 0
        },
        online: {}
    };

    /**
     * V2 Close Hook — cleanup all sub-apps and event subscriptions
     */
    protected override _onClose(options: any): void {
        super._onClose(options);

        // Dispose sub-apps
        this.mixerApp.dispose();
        this.effectsApp.destroy();
        this.libraryApp.close();

        // Remove queue change subscription
        this.queueManager.off('change', this._onQueueChangeBound);

        Logger.info('[AdvancedSoundEngineApp] Closed and cleaned up');
    }

    // ─────────────────────────────────────────────────────────────
    // Event Handlers
    // ─────────────────────────────────────────────────────────────

    private async onTabSwitch(event: JQuery.ClickEvent): Promise<void> {
        event.preventDefault();
        const tabName = $(event.currentTarget).data('tab');
        if (this.state.activeTab === tabName) return;

        // Capture scroll BEFORE switching
        this.captureScroll();

        this.state.activeTab = tabName;
        this.render({ parts: ['main'] });
    }

    /**
     * Resets the scroll state for a specific tab to 0.
     * Use this when changing filters or view context where the user expects to start from the top.
     */
    public resetScroll(tabName?: 'library' | 'mixer'): void {
        const targetTab = tabName || this.state.activeTab;
        const map = this.scrollStates[targetTab];

        if (!map) return;

        for (const selector of Object.keys(map)) {
            map[selector] = 0;
        }
    }

    /**
     * Captures the current scroll positions for the ACTIVE tab.
     * Call this before any operation that might trigger a re-render.
     */
    public captureScroll(): void {
        const activeTab = this.state.activeTab;
        const html = $(this.element);
        const map = this.scrollStates[activeTab];

        if (!map) return;

        for (const selector of Object.keys(map)) {
            const el = html.find(selector);
            if (el.length) {
                const scrollTop = el.scrollTop() || 0;
                map[selector] = scrollTop;
            }
        }
    }

    /**
     * Restores scroll positions for the ACTIVE tab.
     * called automatically in _onRender.
     */
    private restoreScroll(): void {
        const activeTab = this.state.activeTab;
        const html = $(this.element);
        const map = this.scrollStates[activeTab];

        if (!map) return;

        for (const [selector, scrollTop] of Object.entries(map)) {
            const el = html.find(selector);
            if (el.length) {
                // Always enforce the stored scroll state
                el.scrollTop(scrollTop);
            }
        }
    }

    private onToggleSync(event: JQuery.ClickEvent): void {
        const enabled = !this.socket.syncEnabled;
        this.socket.setSyncEnabled(enabled);
        this.state.syncEnabled = enabled;
        (window as any).ASE?.volumeHud?.updateSyncState?.(enabled);
        this.render();
    }

    private async onGlobalPlay(): Promise<void> {
        this.engine.resume();
        const tracks = this.engine.getAllTracks();

        for (const track of tracks) {
            if (track.state === 'paused') {
                const offset = track.getCurrentTime();
                await track.play(offset);

                // Broadcast to players
                if (this.socket.syncEnabled) {
                    this.socket.broadcastTrackPlay(track.id, offset);
                }
            }
        }

        Logger.debug('Global Play/Resume Clicked');
        this.render();
    }

    private onGlobalPause(): void {
        const tracks = this.engine.getAllTracks();
        for (const track of tracks) {
            if (track.state === 'playing') {
                const currentTime = track.getCurrentTime();
                track.pause();
                // Sync if enabled
                if (this.socket.syncEnabled) {
                    this.socket.broadcastTrackPause(track.id, currentTime);
                }
            }
        }
        Logger.debug('Global Pause Clicked');
        this.render();
    }

    private onGlobalStop(): void {
        // AudioEngine.stopAll() now handles broadcast + scheduler cleanup internally
        this.engine.stopAll();
        this.render();
    }

    private onVolumeInput(event: JQuery.TriggeredEvent): void {
        const input = event.currentTarget as HTMLInputElement;
        const value = parseFloat(input.value) / 100;
        const $input = $(input);
        const channel = $input.data('channel') as 'music' | 'ambience' | 'sfx' | undefined;
        const type = $input.data('type') as 'master' | 'local' | undefined;

        if (channel) {
            this.engine.setChannelVolume(channel, value);
            this.socket.broadcastChannelVolume(channel, value);
            $input.siblings('.ase-percentage').text(`${Math.round(value * 100)}%`);
        } else if (type === 'local') {
            this.engine.setLocalVolume(value);
            // Local volume is NOT broadcast
            // Save to localStorage for persistence
            localStorage.setItem('ase-gm-local-volume', value.toString());
            $input.siblings('.ase-local-perc').text(`${Math.round(value * 100)}%`);
        } else {
            // Master
            this.engine.setMasterVolume(value);
            this.socket.broadcastChannelVolume('master', value);
            $input.siblings('.ase-master-perc').text(`${Math.round(value * 100)}%`);
        }
    }
}
