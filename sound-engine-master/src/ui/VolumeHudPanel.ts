import { AudioEngine } from '@core/AudioEngine';
import { PlayerAudioEngine } from '@core/PlayerAudioEngine';
import { SocketManager } from '@sync/SocketManager';
import { Logger } from '@utils/logger';

const MODULE_ID = 'sound-engine-master';
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

interface VolumeHudState {
    isGM: boolean;
    syncEnabled: boolean;
    localVolume: number;
    musicVolume: number;
    ambienceVolume: number;
    sfxVolume: number;
    masterVolume: number;
    playerVolume: number;
}


export class VolumeHudPanel extends HandlebarsApplicationMixin(ApplicationV2) {
    private engine?: AudioEngine;
    private playerEngine?: PlayerAudioEngine;
    private socket?: SocketManager;
    private openMainApp?: (tab?: string, forceRender?: boolean) => void;
    private syncPollTimer: ReturnType<typeof setInterval> | null = null;
    private _isInteracting = false;
    private _lastSyncEnabled: boolean | null = null;

    public state: VolumeHudState = {
        isGM: game.user?.isGM ?? false,
        syncEnabled: false,
        localVolume: 100,
        musicVolume: 100,
        ambienceVolume: 100,
        sfxVolume: 100,
        masterVolume: 100,
        playerVolume: 100
    };

    static override PARTS = {
        main: {
            template: `modules/${MODULE_ID}/templates/volume-hud.hbs`
        }
    };

    static override DEFAULT_OPTIONS = {
        id: 'ase-volume-hud',
        classes: ['ase-volume-hud'],
        tag: 'div',
        window: {
            frame: false,
            positioned: false,
            resizable: false,
            minimizable: false
        },
        position: {}
    };

    constructor(
        engine?: AudioEngine,
        playerEngine?: PlayerAudioEngine,
        socket?: SocketManager,
        openMainApp?: (tab?: string, forceRender?: boolean) => void,
        options: any = {}
    ) {
        super(options);

        this.engine = engine;
        this.playerEngine = playerEngine;
        this.socket = socket;
        this.openMainApp = openMainApp;
        this.state.isGM = game.user?.isGM ?? false;

        // Инициализировать громкость
        this._initializeVolumes();

        // Подписаться на обновления синхронизации/громкости для GM и Player
        if (this.socket) {
            this._subscribeToSyncChanges();
        }
    }

    private _initializeVolumes(): void {
        if (this.state.isGM) {
            this.state.syncEnabled = this.socket?.syncEnabled ?? false;
        }

        if (this.state.isGM && this.engine) {
            // Для GM - получить громкости каналов + master/local
            this.state.masterVolume = Math.round(this.engine.volumes.master * 100);
            this.state.localVolume = Math.round(this.engine.localVolume * 100);
            this.state.musicVolume = Math.round(this.engine.getChannelVolume('music') * 100);
            this.state.ambienceVolume = Math.round(this.engine.getChannelVolume('ambience') * 100);
            this.state.sfxVolume = Math.round(this.engine.getChannelVolume('sfx') * 100);
        } else if (this.playerEngine) {
            // Для игрока - загрузить сохраненный master volume
            const saved = localStorage.getItem(`${MODULE_ID}-player-volume`);
            this.state.playerVolume = saved ? Math.round(parseFloat(saved) * 100) : 100;
        }
    }

    private _subscribeToSyncChanges(): void {
        // Подписка на изменения состояния синхронизации
        // Это будет обновляться через события от SocketManager
        if (this.socket) {
            const checkSync = () => {
                const sync = this.socket?.syncEnabled ?? false;
                this.state.syncEnabled = sync;

                if (this._lastSyncEnabled !== sync) {
                    this._lastSyncEnabled = sync;
                    this.render();
                    return;
                }

                this._refreshFromEngine(true);
            };

            // Проверять состояние синхронизации и громкости периодически
            this.syncPollTimer = setInterval(checkSync, 100);
            checkSync();
        }
    }

    override async _prepareContext(_options: any): Promise<any> {
        const context = await super._prepareContext(_options);

        return {
            ...context,
            isGM: this.state.isGM,
            syncEnabled: this.state.syncEnabled,
            localVolume: this.state.localVolume,
            musicVolume: this.state.musicVolume,
            ambienceVolume: this.state.ambienceVolume,
            sfxVolume: this.state.sfxVolume,
            masterVolume: this.state.masterVolume,
            playerVolume: this.state.playerVolume
        };
    }

    override _onRender(_context: any, _options: any): void {
        super._onRender(_context, _options);

        // Позиционировать панель в левом нижнем углу
        this._positionPanel();

        // Добавить слушатели событий
        this._attachEventListeners();
    }

    private _positionPanel(): void {
        const element = this.element as HTMLElement;
        if (!element) return;

        // Вставка в #ui-left:
        // 1) если есть #bastion-turn — вставляем над ним
        // 2) иначе вставляем над aside#players
        const uiLeft = document.querySelector('#ui-left') as HTMLElement | null;
        const bastionTurn = document.querySelector('#bastion-turn') as HTMLElement | null;
        const playersAside = document.querySelector('aside#players') as HTMLElement | null;

        if (uiLeft) {
            const anchor = bastionTurn ?? playersAside;
            const parent = anchor?.parentElement ?? uiLeft;

            if (element.parentElement !== parent) {
                if (anchor) parent.insertBefore(element, anchor);
                else parent.prepend(element);
            } else if (anchor && element.nextElementSibling !== anchor) {
                parent.insertBefore(element, anchor);
            }

            element.style.position = 'relative';
            element.style.left = '0';
            element.style.bottom = '0';
            element.style.zIndex = '6';
            element.style.margin = '0 0 8px 0';

            // Ширина как у целевого блока (bastion-turn / players),
            // для player строго как у players.
            if (anchor) {
                const rectWidth = anchor.getBoundingClientRect().width;
                const cssWidth = anchor.clientWidth || 0;
                const scrollWidth = anchor.scrollWidth || 0;
                const width = Math.max(rectWidth, cssWidth, scrollWidth);
                if (width > 0) {
                    element.style.width = `${Math.round(width)}px`;
                }
            }
        }
    }

    private _attachEventListeners(): void {
        const element = this.element as HTMLElement;
        if (!element) return;

        // Для GM: открытие полного окна модуля
        element.querySelector('.ase-hud-open-app')?.addEventListener('click', () => {
            this.openMainApp?.('mixer', false);
        });

        if (this.state.isGM) {
            // Для GM - обработчики пяти слайдеров
            this._attachTypeSlider(element, 'master');
            this._attachTypeSlider(element, 'local');
            this._attachChannelSlider(element, 'music');
            this._attachChannelSlider(element, 'ambience');
            this._attachChannelSlider(element, 'sfx');
        } else {
            // Для игрока - обработчик master volume
            this._attachPlayerSlider(element);
        }
    }

    private _attachTypeSlider(html: HTMLElement, type: 'master' | 'local'): void {
        const slider = html.querySelector(`.ase-hud-slider[data-type="${type}"]`) as HTMLInputElement;
        if (!slider) return;

        const startInteract = () => { this._isInteracting = true; };
        const endInteract = () => { this._isInteracting = false; };
        slider.addEventListener('pointerdown', startInteract);
        slider.addEventListener('pointerup', endInteract);
        slider.addEventListener('pointercancel', endInteract);
        slider.addEventListener('change', endInteract);
        slider.addEventListener('blur', endInteract);

        slider.addEventListener('input', (event) => {
            const value = parseFloat((event.target as HTMLInputElement).value);
            const normalizedValue = value / 100;

            if (type === 'master') {
                this.state.masterVolume = value;
                this.engine?.setMasterVolume(normalizedValue);
                this.socket?.broadcastChannelVolume('master', normalizedValue);
            } else {
                this.state.localVolume = value;
                this.engine?.setLocalVolume(normalizedValue);
                localStorage.setItem('ase-gm-local-volume', String(normalizedValue));
            }

            const valueDisplay = html.querySelector(`.ase-hud-value[data-type="${type}"]`);
            if (valueDisplay) {
                valueDisplay.textContent = `${Math.round(value)}%`;
            }
        });
    }

    private _attachChannelSlider(html: HTMLElement, channel: 'music' | 'ambience' | 'sfx'): void {
        const slider = html.querySelector(`.ase-hud-slider[data-channel="${channel}"]`) as HTMLInputElement;
        if (!slider) return;

        const startInteract = () => { this._isInteracting = true; };
        const endInteract = () => { this._isInteracting = false; };
        slider.addEventListener('pointerdown', startInteract);
        slider.addEventListener('pointerup', endInteract);
        slider.addEventListener('pointercancel', endInteract);
        slider.addEventListener('change', endInteract);
        slider.addEventListener('blur', endInteract);

        slider.addEventListener('input', (event) => {
            const value = parseFloat((event.target as HTMLInputElement).value);
            const normalizedValue = value / 100;

            // Обновить состояние
            if (channel === 'music') this.state.musicVolume = value;
            else if (channel === 'ambience') this.state.ambienceVolume = value;
            else if (channel === 'sfx') this.state.sfxVolume = value;

            // Обновить отображаемое значение
            const valueDisplay = html.querySelector(`.ase-hud-value[data-channel="${channel}"]`);
            if (valueDisplay) {
                valueDisplay.textContent = `${Math.round(value)}%`;
            }

            // Применить к engine
            if (this.engine) {
                this.engine.setChannelVolume(channel, normalizedValue);
            }

            this.socket?.broadcastChannelVolume(channel, normalizedValue);
        });
    }

    private _attachPlayerSlider(html: HTMLElement): void {
        const slider = html.querySelector('.ase-hud-slider[data-type="player"]') as HTMLInputElement;
        if (!slider) return;

        const startInteract = () => { this._isInteracting = true; };
        const endInteract = () => { this._isInteracting = false; };
        slider.addEventListener('pointerdown', startInteract);
        slider.addEventListener('pointerup', endInteract);
        slider.addEventListener('pointercancel', endInteract);
        slider.addEventListener('change', endInteract);
        slider.addEventListener('blur', endInteract);

        slider.addEventListener('input', (event) => {
            const value = parseFloat((event.target as HTMLInputElement).value);
            const normalizedValue = value / 100;

            // Обновить состояние
            this.state.playerVolume = value;

            // Обновить отображаемое значение
            const valueDisplay = html.querySelector('.ase-hud-value[data-type="player"]');
            if (valueDisplay) {
                valueDisplay.textContent = `${Math.round(value)}%`;
            }

            // Применить к player engine
            if (this.playerEngine) {
                this.playerEngine.setLocalVolume(normalizedValue);
            }

            // Сохранить в localStorage
            localStorage.setItem(`${MODULE_ID}-player-volume`, String(normalizedValue));
        });
    }

    private _refreshFromEngine(forceRender: boolean = true): void {
        if (!this.engine) return;
        if (this._isInteracting) return;

        const nextMaster = Math.round(this.engine.volumes.master * 100);
        const nextLocal = Math.round(this.engine.localVolume * 100);
        const nextMusic = Math.round(this.engine.getChannelVolume('music') * 100);
        const nextAmbience = Math.round(this.engine.getChannelVolume('ambience') * 100);
        const nextSfx = Math.round(this.engine.getChannelVolume('sfx') * 100);

        const changed = nextMaster !== this.state.masterVolume
            || nextLocal !== this.state.localVolume
            || nextMusic !== this.state.musicVolume
            || nextAmbience !== this.state.ambienceVolume
            || nextSfx !== this.state.sfxVolume;

        if (changed) {
            this.state.masterVolume = nextMaster;
            this.state.localVolume = nextLocal;
            this.state.musicVolume = nextMusic;
            this.state.ambienceVolume = nextAmbience;
            this.state.sfxVolume = nextSfx;

            if (forceRender) this.render();
        }
    }

    /**
     * Обновить громкости из внешних источников (например, из микшера)
     */
    public updateVolumes(): void {
        if (this.state.isGM && this.engine) {
            this._refreshFromEngine(true);
        }
    }

    /**
     * Обновить состояние синхронизации
     */
    public updateSyncState(enabled: boolean): void {
        this._lastSyncEnabled = enabled;
        this.state.syncEnabled = enabled;
        this.render();
    }

    protected override _onClose(options: any): void {
        super._onClose(options);
        if (this.syncPollTimer) {
            clearInterval(this.syncPollTimer);
            this.syncPollTimer = null;
        }
    }
}
