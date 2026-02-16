import '../styles/sound-engine.scss';
import '../styles/volume-hud.scss';
import { AudioEngine } from '@core/AudioEngine';
import { PlayerAudioEngine } from '@core/PlayerAudioEngine';
import { SocketManager } from '@sync/SocketManager';
import { SoundMixerApp } from '@ui/SoundMixerApp';
import { PlayerVolumePanel } from '@ui/PlayerVolumePanel';
import { VolumeHudPanel } from '@ui/VolumeHudPanel';
import { LocalLibraryApp } from '@ui/LocalLibraryApp';
import { AdvancedSoundEngineApp } from '@ui/AdvancedSoundEngineApp';
import { LibraryManager } from '@lib/LibraryManager';
import { PlaybackQueueManager } from './queue/PlaybackQueueManager';
import { Logger } from '@utils/logger';
import { PlaybackScheduler } from '@core/PlaybackScheduler';

const MODULE_ID = 'sound-engine-master';
const SUPPORTED_LOCALES = ['en', 'ru'] as const;

type SupportedLocale = typeof SUPPORTED_LOCALES[number];

const aseLocaleDictionaries = new Map<SupportedLocale, Record<string, unknown>>();

// GM
let gmEngine: AudioEngine | null = null;
let mainApp: AdvancedSoundEngineApp | null = null;
let libraryManager: LibraryManager | null = null;
let queueManager: PlaybackQueueManager | null = null;
let playbackScheduler: PlaybackScheduler | null = null;

// Player
let playerEngine: PlayerAudioEngine | null = null;
let volumePanel: PlayerVolumePanel | null = null;

// Shared
let socketManager: SocketManager | null = null;
let volumeHudPanel: VolumeHudPanel | null = null;

function normalizeSupportedLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('ru')) return 'ru';
  if (normalized.startsWith('en')) return 'en';
  return null;
}

function getFoundryLocale(): SupportedLocale {
  const i18nLocale = normalizeSupportedLocale((game.i18n as any)?.lang);
  if (i18nLocale) return i18nLocale;

  try {
    const coreLocale = normalizeSupportedLocale((game.settings as any)?.get?.('core', 'language'));
    if (coreLocale) return coreLocale;
  } catch {
    // Ignore early initialization access errors.
  }

  return 'en';
}

function getAseRootTranslations(locale: SupportedLocale): Record<string, unknown> | null {
  const dictionary = aseLocaleDictionaries.get(locale);
  if (!dictionary || typeof dictionary !== 'object') return null;

  const root = (dictionary as Record<string, unknown>).ASE;
  if (!root || typeof root !== 'object') return null;

  return root as Record<string, unknown>;
}

async function preloadLocaleDictionaries(): Promise<void> {
  for (const locale of SUPPORTED_LOCALES) {
    if (aseLocaleDictionaries.has(locale)) continue;

    const localePath = `modules/${MODULE_ID}/lang/${locale}.json`;

    try {
      const response = await fetch(localePath, { cache: 'no-store' });
      if (!response.ok) {
        Logger.warn(`Failed to load locale file "${localePath}" (status: ${response.status})`);
        continue;
      }

      const dictionary = await response.json();
      if (dictionary && typeof dictionary === 'object') {
        aseLocaleDictionaries.set(locale, dictionary as Record<string, unknown>);
      }
    } catch (error) {
      Logger.warn(`Failed to load locale file "${localePath}"`, error);
    }
  }
}

function applyAseLocaleTranslations(): void {
  try {
    const locale = getFoundryLocale();
    const aseRoot = getAseRootTranslations(locale);
    if (!aseRoot) return;

    const cloned = JSON.parse(JSON.stringify(aseRoot));

    const i18nAny = game.i18n as any;
    if (!i18nAny.translations || typeof i18nAny.translations !== 'object') {
      i18nAny.translations = {};
    }

    (i18nAny.translations as Record<string, unknown>).ASE = cloned;
  } catch (error) {
    Logger.warn('Failed to apply ASE locale translations:', error);
  }
}

declare global {
  interface Window {
    ASE: {
      isGM: boolean;
      openPanel: (tab?: string, forceRender?: boolean) => void;
      openLibrary?: () => void;
      engine?: AudioEngine | PlayerAudioEngine;
      socket?: SocketManager;
      library?: LibraryManager;
      queue?: PlaybackQueueManager;
      volumeHud?: VolumeHudPanel;
    };
  }
}



// Add button to scene controls
// Add button to scene controls
// Add button to scene controls
Hooks.on('getSceneControlButtons', (controls: SceneControl[]) => {
  try {
    const isGM = game.user?.isGM ?? false;

    const aseTools: SceneControlTool[] = [
      {
        name: 'ase-open-mixer',
        title: isGM ? game.i18n!.localize('ASE.UI.SceneControl.OpenSoundMixer') : game.i18n!.localize('ASE.UI.SceneControl.OpenSoundVolume'),
        icon: isGM ? 'fas fa-sliders-h' : 'fas fa-volume-up',
        button: true,
        onClick: () => {
          Logger.debug('Button clicked: Open Mixer/Volume');
          if (window.ASE) {
            window.ASE.openPanel();
          } else {
            Logger.error('Sound Engine namespace is undefined!');
          }
        }
      }
    ];

    if (isGM) {
      aseTools.push({
        name: 'ase-open-library',
        title: game.i18n!.localize('ASE.UI.SceneControl.OpenSoundLibrary'),
        icon: 'fas fa-book-open',
        button: true,
        onClick: () => {
          Logger.debug('Button clicked: Open Library');
          if (window.ASE && window.ASE.openLibrary) {
            window.ASE.openLibrary();
          } else {
            Logger.error('Sound Engine namespace or openLibrary is undefined');
          }
        }
      });
    }

    // V13+ Compatibility: controls might be an object/record instead of an array
    if (!Array.isArray(controls) && typeof controls === 'object' && controls !== null) {
      Logger.info('Detected non-array controls structure (V13?)');

      // Check if "sounds" exists as a property
      const soundsLayer = (controls as any).sounds;

      if (soundsLayer && Array.isArray(soundsLayer.tools)) {
        soundsLayer.tools.push(...aseTools);
        Logger.info('Added tools to "sounds" layer (V13 Object Mode)');
      } else {
        // Fallback: Add as a new property
        (controls as any)['sound-engine-master'] = {
          name: 'sound-engine-master',
          title: game.i18n!.localize('ASE.Title'),
          icon: 'fas fa-music',
          visible: true,
          tools: aseTools
        };
        Logger.info('Created dedicated control group (V13 Object Mode)');
      }
      return;
    }

    // V10-V12 Compatibility: controls is an array
    if (Array.isArray(controls)) {
      // Try to find the "sounds" layer control group
      const soundsLayer = controls.find((c: SceneControl) => c.name === 'sounds');

      if (soundsLayer) {
        // Add our tools to the existing sounds layer
        soundsLayer.tools.push(...aseTools);
      } else {
        // Fallback: Create a dedicated group if "sounds" layer is missing
        controls.push({
          name: 'sound-engine-master',
          title: game.i18n!.localize('ASE.Title'),
          icon: 'fas fa-music',
          visible: true,
          tools: aseTools
        });
      }
    } else {
      Logger.warn('Unknown controls structure:', controls);
    }

  } catch (error) {
    Logger.error('Failed to initialize scene controls:', error);
  }
});

// Manually bind click listeners in case standard onClick fails (V13 compat)
Hooks.on('renderSceneControls', (controls: any, html: JQuery) => {
  try {
    // Detect if html is jQuery or native Element
    const findElement = (selector: string): HTMLElement | null => {
      // Foundry often passes jQuery objects
      if (typeof (html as any).find === 'function') {
        const el = (html as any).find(selector);
        return el.length ? el[0] : null;
      }
      // Native HTMLElement
      else if (html instanceof HTMLElement) {
        return html.querySelector(selector);
      }
      return null;
    };

    const mixerBtn = findElement('[data-tool="ase-open-mixer"]');
    if (mixerBtn) {
      mixerBtn.onclick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        Logger.debug('Manual click handler (native): Open Mixer');
        window.ASE?.openPanel();
      };
    }

    const libraryBtn = findElement('[data-tool="ase-open-library"]');
    if (libraryBtn) {
      libraryBtn.onclick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        Logger.debug('Manual click handler (native): Open Library');
        window.ASE?.openLibrary?.();
      };
    }
  } catch (error) {
    Logger.warn('Failed to bind manual click listeners:', error);
  }
});
// ─────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Handlebars Helpers
// ─────────────────────────────────────────────────────────────

function registerHandlebarsHelpers(): void {
  // Format duration from seconds to MM:SS
  Handlebars.registerHelper('formatDuration', (seconds: number): string => {
    if (!seconds || seconds <= 0) return '--:--';

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  });

  // Check equality (for {{#if (eq a b)}})
  Handlebars.registerHelper('eq', (a: any, b: any): boolean => {
    return a === b;
  });

  // OR helper for conditional logic
  Handlebars.registerHelper('or', (...args: any[]): boolean => {
    // Last argument is Handlebars options object, exclude it
    const values = args.slice(0, -1);
    return values.some((val) => !!val);
  });

  // Localize channel label by id (music/ambience/sfx)
  Handlebars.registerHelper('aseGroupLabel', (group: string): string => {
    if (!group) return game.i18n!.localize('ASE.Groups.music');
    return game.i18n!.localize(`ASE.Groups.${String(group).toLowerCase()}`);
  });

  // Localize playback mode label by id
  Handlebars.registerHelper('asePlaybackModeLabel', (mode: string): string => {
    if (!mode) return game.i18n!.localize('ASE.UI.PlaybackMode.loop');
    return game.i18n!.localize(`ASE.UI.PlaybackMode.${String(mode).toLowerCase()}`);
  });

  // Localize effect type label by id
  Handlebars.registerHelper('aseEffectTypeLabel', (effectType: string): string => {
    if (!effectType) return '';
    return game.i18n!.localize(`ASE.UI.EffectType.${String(effectType).toLowerCase()}`);
  });
}

// ─────────────────────────────────────────────────────────────
// Init Hooks
// ─────────────────────────────────────────────────────────────

Hooks.once('init', async () => {
  Logger.info('Initializing Sound Engine Master...');
  await preloadLocaleDictionaries();
  registerSettings();
  registerHandlebarsHelpers();

  // Preload templates
  await loadTemplates([
    `modules/${MODULE_ID}/templates/partials/effect-card.hbs`
  ]);
});

Hooks.once('ready', async () => {
  const isGM = game.user?.isGM ?? false;
  Logger.info(`Starting Sound Engine Master (${isGM ? 'GM' : 'Player'})...`);

  // Initialize queue manager FIRST (needed by PlaybackScheduler)
  queueManager = new PlaybackQueueManager();
  await queueManager.load(); // Load saved queue state

  socketManager = new SocketManager();

  if (isGM) {
    await initializeGM();
  } else {
    await initializePlayer();
  }

  window.ASE = {
    isGM,
    openPanel: isGM ? openMainApp : openVolumePanel,
    openLibrary: () => isGM && openMainApp('library'),
    engine: isGM ? gmEngine ?? undefined : playerEngine ?? undefined,
    socket: socketManager ?? undefined,
    library: isGM ? libraryManager ?? undefined : undefined,
    queue: queueManager,
    volumeHud: undefined
  };

  setupAutoplayHandler();

  // Initialize and render HUD panel for both GM and Players
  initializeVolumeHud(isGM);

  Logger.info('Sound Engine Master ready');
});

async function initializeGM(): Promise<void> {
  libraryManager = new LibraryManager();
  gmEngine = new AudioEngine();
  socketManager!.initializeAsGM(gmEngine);

  await gmEngine.loadSavedState();

  // Initialize Scheduler
  playbackScheduler = new PlaybackScheduler(gmEngine, libraryManager, queueManager!);

  // Wire up references for atomic stopAll()
  gmEngine.setScheduler(playbackScheduler);
  gmEngine.setSocketManager(socketManager!);

  Logger.info('PlaybackScheduler initialized');
}

function initializeVolumeHud(isGM: boolean): void {
  try {
    if (isGM && gmEngine) {
      // GM HUD with three channel sliders
      volumeHudPanel = new VolumeHudPanel(gmEngine, undefined, socketManager ?? undefined, openMainApp);
      volumeHudPanel.render(true);
      if (window.ASE) window.ASE.volumeHud = volumeHudPanel;
      Logger.info('Volume HUD Panel initialized for GM');
    } else if (!isGM && playerEngine) {
      // Player HUD with single master volume slider
      volumeHudPanel = new VolumeHudPanel(undefined, playerEngine, undefined, undefined);
      volumeHudPanel.render(true);
      if (window.ASE) window.ASE.volumeHud = volumeHudPanel;
      Logger.info('Volume HUD Panel initialized for Player');
    }
  } catch (error) {
    Logger.error('Failed to initialize Volume HUD Panel:', error);
  }
}

async function initializePlayer(): Promise<void> {
  playerEngine = new PlayerAudioEngine(socketManager!);
  socketManager!.initializeAsPlayer(playerEngine);

  // Restore saved local volume
  const savedVolume = PlayerVolumePanel.loadSavedVolume();
  playerEngine!.setLocalVolume(savedVolume);
}

// ─────────────────────────────────────────────────────────────
// Panels
// ─────────────────────────────────────────────────────────────
// Open main app with specific tab
function openMainApp(tab?: string, forceRender: boolean = false): void {
  if (!gmEngine || !socketManager || !libraryManager) return;

  if (mainApp && mainApp.rendered) {
    if (tab && mainApp.state.activeTab !== tab) {
      mainApp.state.activeTab = tab as any;
      forceRender = true;
    }

    if (forceRender) {
      mainApp.render(false); // Re-render content, keep window position
    } else {
      mainApp.bringToTop();
    }
  } else {
    mainApp = new AdvancedSoundEngineApp(gmEngine, socketManager, libraryManager, queueManager!);
    if (tab) mainApp.state.activeTab = tab as any;
    mainApp.render(true);
  }
}

function openVolumePanel(): void {
  if (!playerEngine) return;

  if (volumePanel && volumePanel.rendered) {
    volumePanel.bringToTop();
  } else {
    volumePanel = new PlayerVolumePanel(playerEngine);
    volumePanel.render(true);
  }
}

// Old openLibrary removed/redirected
function openLibrary(): void {
  openMainApp('library');
}



// ─────────────────────────────────────────────────────────────
// Autoplay Policy Handler
// ─────────────────────────────────────────────────────────────

function setupAutoplayHandler(): void {
  const resumeAudio = () => {
    gmEngine?.resume();
    playerEngine?.resume();
  };

  document.addEventListener('click', resumeAudio, { once: true });
  document.addEventListener('keydown', resumeAudio, { once: true });

  Hooks.once('canvasReady', resumeAudio);
}

// ─────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────

function registerSettings(): void {
  applyAseLocaleTranslations();

  (game.settings as any).register(MODULE_ID, 'mixerState', {
    name: game.i18n!.localize('ASE.UI.Settings.MixerState.Name'),
    hint: game.i18n!.localize('ASE.UI.Settings.MixerState.Hint'),
    scope: 'world',
    config: false,
    type: String,
    default: ''
  });

  (game.settings as any).register(MODULE_ID, 'maxSimultaneousTracks', {
    name: game.i18n!.localize('ASE.UI.Settings.MaxSimultaneousTracks.Name'),
    hint: game.i18n!.localize('ASE.UI.Settings.MaxSimultaneousTracks.Hint'),
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 1, max: 32, step: 1 },
    default: 8
  });

  // Legacy library state fallback (world-scoped, for migration only)
  (game.settings as any).register(MODULE_ID, 'libraryState', {
    name: game.i18n!.localize('ASE.UI.Settings.LibraryState.Name'),
    hint: game.i18n!.localize('ASE.UI.Settings.LibraryState.Hint'),
    scope: 'world',
    config: false,
    type: String,
    default: ''
  });

  // Queue state (world-scoped, session persistence  
  (game.settings as any).register(MODULE_ID, 'queueState', {
    name: game.i18n!.localize('ASE.UI.Settings.QueueState.Name'),
    hint: game.i18n!.localize('ASE.UI.Settings.QueueState.Hint'),
    scope: 'world',
    config: false,
    type: Object,
    default: { items: [], activeItemId: null }
  });

  // World-scoped favorites (migrated from global)
  (game.settings as any).register(MODULE_ID, 'favorites', {
    name: game.i18n!.localize('ASE.UI.Settings.Favorites.Name'),
    hint: game.i18n!.localize('ASE.UI.Settings.Favorites.Hint'),
    scope: 'world',
    config: false,
    type: Object,
    default: { ids: [], order: [] }
  });
}

// ─────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────

Hooks.once('closeGame', () => {
  mainApp?.close();
  volumePanel?.close();
  volumeHudPanel?.close();
  playbackScheduler?.dispose();
  socketManager?.dispose();
  gmEngine?.dispose();
  playerEngine?.dispose();
  queueManager?.dispose();
  libraryManager?.dispose();
});
