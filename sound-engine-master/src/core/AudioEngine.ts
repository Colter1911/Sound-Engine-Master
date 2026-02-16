import type { TrackConfig, TrackState, MixerState, TrackGroup, ChannelVolumes } from '@t/audio';
import type { EffectType, ChannelChain, EffectState } from '@t/effects';
import { DEFAULT_CHAIN_ORDER, DEFAULT_MIX } from '@t/effects';
import { StreamingPlayer } from './StreamingPlayer';
import { EffectChain } from './effects/EffectChain';
import { Logger } from '@utils/logger';
import { getServerTime } from '@utils/time';
import { generateUUID } from '@utils/uuid';
import { validateAudioFile } from '@utils/audio-validation';
import type { PlaybackContext } from './PlaybackScheduler';
import type { PlaybackScheduler } from './PlaybackScheduler';
import type { SocketManager } from '../sync/SocketManager';

const MODULE_ID = 'sound-engine-master';

function getMaxSimultaneous(): number {
  return ((game.settings as any).get(MODULE_ID, 'maxSimultaneousTracks') as number) || 8;
}

// Robust EventEmitter shim to avoid build/runtime dependency issues
class SimpleEventEmitter {
  private listeners: Record<string, Function[]> = {};

  on(event: string, fn: Function) {
    (this.listeners[event] = this.listeners[event] || []).push(fn);
    return this;
  }

  addListener(event: string, fn: Function) {
    return this.on(event, fn);
  }

  once(event: string, fn: Function) {
    const onceWrapper = (...args: any[]) => {
      this.off(event, onceWrapper);
      fn.apply(this, args);
    };
    (onceWrapper as any)._original = fn;
    return this.on(event, onceWrapper);
  }

  emit(event: string, ...args: any[]) {
    if (this.listeners[event]) {
      [...this.listeners[event]].forEach(fn => fn.apply(this, args));
      return true;
    }
    return false;
  }

  off(event: string, fn: Function) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(l =>
        l !== fn && (l as any)._original !== fn
      );
    }
    return this;
  }

  removeListener(event: string, fn: Function) {
    return this.off(event, fn);
  }

  removeAllListeners(event?: string) {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
    return this;
  }
}

export class AudioEngine extends SimpleEventEmitter {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private localGain: GainNode;
  private channelGains: Record<TrackGroup, GainNode>;
  private players: Map<string, StreamingPlayer> = new Map();
  private _activeContext: PlaybackContext | null = null;
  private scheduler: PlaybackScheduler | null = null;
  private socketManager: SocketManager | null = null;

  // ─── Effects Chain System ───────────────────────────────────
  private chains: Record<TrackGroup, EffectChain>;

  private _volumes: ChannelVolumes = {
    master: 1,
    music: 1,
    ambience: 1,
    sfx: 1
  };

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();

    // Create Local Gain (GM only)
    this.localGain = this.ctx.createGain();
    this.localGain.gain.value = 1;

    // Master -> Local -> Destination
    this.masterGain.connect(this.localGain);
    this.localGain.connect(this.ctx.destination);

    this.channelGains = {
      music: this.ctx.createGain(),
      ambience: this.ctx.createGain(),
      sfx: this.ctx.createGain()
    };

    // ─── Initialize Chains ────────────────────────────────────
    // Signal flow per channel:
    //   channelGain → chain.inputNode → [effects...] → chain.outputNode → masterGain

    this.chains = {
      music: new EffectChain(this.ctx, 'music'),
      ambience: new EffectChain(this.ctx, 'ambience'),
      sfx: new EffectChain(this.ctx, 'sfx')
    };

    for (const group of ['music', 'ambience', 'sfx'] as TrackGroup[]) {
      this.channelGains[group].connect(this.chains[group].inputNode);
      this.chains[group].outputNode.connect(this.masterGain);
      this.chains[group].buildDefault();
    }

    Logger.info('AudioEngine initialized (chain architecture)');
  }

  /**
   * Validate a volume value: must be a finite number in [0, 1].
   * Returns fallback if the value is missing, NaN, or out of range.
   */
  private sanitizeVolume(value: any, fallback: number): number {
    if (value === null || value === undefined || typeof value !== 'number' || !isFinite(value)) {
      return fallback;
    }
    return Math.max(0, Math.min(1, value));
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence (GM only)
  // ─────────────────────────────────────────────────────────────

  private scheduleSave(): void {
    if (!game.user?.isGM) return;

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveState();
    }, 500);
  }

  private async saveState(): Promise<void> {
    if (!game.ready || !game.user?.isGM) return;

    const state = this.getState();

    try {
      await (game.settings as any).set(MODULE_ID, 'mixerState', JSON.stringify(state));
      Logger.debug('Mixer state saved');
    } catch (error) {
      Logger.error('Failed to save mixer state:', error);
    }
  }

  async loadSavedState(): Promise<void> {
    if (!game.ready) return;

    try {
      const savedJson = (game.settings as any).get(MODULE_ID, 'mixerState') as string;
      if (!savedJson) return;

      const state = JSON.parse(savedJson) as MixerState;
      await this.restoreState(state);

      Logger.info('Mixer state restored');
    } catch (error) {
      Logger.error('Failed to load mixer state:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Track Management
  // ─────────────────────────────────────────────────────────────

  async createTrack(config: TrackConfig): Promise<StreamingPlayer> {
    const trackId = config.id || generateUUID();

    if (this.players.has(trackId)) {
      return this.players.get(trackId)!;
    }

    const validation = validateAudioFile(config.url);
    if (!validation.valid) {
      const error = new Error(validation.error || 'Invalid audio file');
      Logger.error(`Track validation failed: ${validation.error}`);
      throw error;
    }

    const channelOutput = this.channelGains[config.group];

    const player = new StreamingPlayer(
      trackId,
      this.ctx,
      channelOutput,
      config.group
    );

    if (config.volume !== undefined) {
      player.setVolume(config.volume);
    }

    await player.load(config.url);

    this.players.set(trackId, player);

    player.onEnded = () => {
      this.emit('trackEnded', trackId);
    };

    this.scheduleSave();

    Logger.info(`Track created: ${trackId} (${validation.extension})`);
    return player;
  }

  getTrack(id: string): StreamingPlayer | undefined {
    return this.players.get(id);
  }

  removeTrack(id: string): boolean {
    const player = this.players.get(id);
    if (!player) return false;

    player.dispose();
    this.players.delete(id);
    this.scheduleSave();

    Logger.info(`Track removed: ${id}`);
    return true;
  }

  getAllTracks(): StreamingPlayer[] {
    return Array.from(this.players.values());
  }

  getTracksByGroup(group: TrackGroup): StreamingPlayer[] {
    return this.getAllTracks().filter(t => t.group === group);
  }

  setTrackChannel(id: string, newGroup: TrackGroup): void {
    const player = this.players.get(id);
    if (!player) return;

    player.setChannel(newGroup, this.channelGains[newGroup]);
    this.scheduleSave();
  }

  // ─────────────────────────────────────────────────────────────
  // Playback Control
  // ─────────────────────────────────────────────────────────────

  async playTrack(id: string, offset: number = 0, context?: PlaybackContext): Promise<void> {
    const player = this.players.get(id);
    if (!player) {
      Logger.warn(`Track not found: ${id}`);
      return;
    }

    const maxSimultaneous = getMaxSimultaneous();
    const playingCount = this.getAllTracks().filter(t => t.state === 'playing').length;
    const isCurrentlyPlaying = player.state === 'playing';

    if (!isCurrentlyPlaying && playingCount >= maxSimultaneous) {
      Logger.warn(`Maximum simultaneous tracks (${maxSimultaneous}) reached`);
      return;
    }

    if (context) {
      this._activeContext = context;
      this.emit('contextChanged', context);
    }
    await player.play(offset);
  }

  pauseTrack(id: string): void {
    this.players.get(id)?.pause();
  }

  stopTrack(id: string): void {
    this.players.get(id)?.stop();
  }

  seekTrack(id: string, time: number): void {
    this.players.get(id)?.seek(time);
  }

  setTrackVolume(id: string, volume: number): void {
    this.players.get(id)?.setVolume(volume);
    this.scheduleSave();
  }

  stopAll(): void {
    this.scheduler?.clearContext();

    for (const player of this.players.values()) {
      player.stop();
    }

    this._activeContext = null;
    this.emit('contextChanged', null);

    this.socketManager?.broadcastStopAll();
  }

  setScheduler(scheduler: PlaybackScheduler | null): void {
    this.scheduler = scheduler;
  }

  setSocketManager(socketManager: SocketManager | null): void {
    this.socketManager = socketManager;
  }

  // ─────────────────────────────────────────────────────────────
  // Volume Control
  // ─────────────────────────────────────────────────────────────

  get volumes(): ChannelVolumes {
    return { ...this._volumes };
  }

  setMasterVolume(value: number): void {
    this._volumes.master = Math.max(0, Math.min(1, value));
    this.masterGain.gain.linearRampToValueAtTime(
      this._volumes.master,
      this.ctx.currentTime + 0.01
    );
    this.scheduleSave();
  }

  setChannelVolume(channel: TrackGroup, value: number): void {
    this._volumes[channel] = Math.max(0, Math.min(1, value || 0));
    this.channelGains[channel].gain.linearRampToValueAtTime(
      this._volumes[channel],
      this.ctx.currentTime + 0.01
    );
    this.scheduleSave();
  }

  getChannelVolume(channel: TrackGroup): number {
    return this._volumes[channel];
  }

  // ─────────────────────────────────────────────────────────────
  // Local Volume (GM Monitor)
  // ─────────────────────────────────────────────────────────────

  setLocalVolume(value: number): void {
    const val = Math.max(0, Math.min(1, value));
    this.localGain.gain.linearRampToValueAtTime(val, this.ctx.currentTime + 0.05);
  }

  get localVolume(): number {
    return this.localGain.gain.value;
  }

  // ─────────────────────────────────────────────────────────────
  // Effects Chain Management
  // ─────────────────────────────────────────────────────────────

  /** Get chain for a specific channel */
  getChain(channel: TrackGroup): EffectChain {
    return this.chains[channel];
  }

  /** Get all chains state for serialization / sync */
  getAllChainsState(): ChannelChain[] {
    return (['music', 'ambience', 'sfx'] as TrackGroup[]).map(
      group => this.chains[group].getState()
    );
  }

  /** Set effect parameter within a specific channel's chain */
  setChainEffectParam(channel: TrackGroup, effectType: EffectType, paramId: string, value: any): void {
    this.chains[channel].setEffectParam(effectType, paramId, value);
    this.scheduleSave();
  }

  /** Enable/disable an effect within a channel's chain */
  setChainEffectEnabled(channel: TrackGroup, effectType: EffectType, enabled: boolean): void {
    this.chains[channel].setEffectEnabled(effectType, enabled);
    this.scheduleSave();
  }

  /** Set dry/wet mix for an effect within a channel's chain */
  setChainEffectMix(channel: TrackGroup, effectType: EffectType, mix: number): void {
    this.chains[channel].setEffectMix(effectType, mix);
    this.scheduleSave();
  }

  /** Reorder effects in a channel's chain */
  reorderChainEffect(channel: TrackGroup, fromIndex: number, toIndex: number): void {
    this.chains[channel].reorder(fromIndex, toIndex);
    this.scheduleSave();
  }

  /** Reorder by type array (from sync) */
  reorderChainByTypes(channel: TrackGroup, order: EffectType[]): void {
    this.chains[channel].reorderByTypes(order);
    this.scheduleSave();
  }

  /** Add effect to a channel's chain */
  addChainEffect(channel: TrackGroup, effectType: EffectType, atIndex?: number): void {
    this.chains[channel].addEffect(effectType, atIndex);
    this.scheduleSave();
  }

  /** Remove effect from a channel's chain */
  removeChainEffect(channel: TrackGroup, effectType: EffectType): void {
    this.chains[channel].removeEffect(effectType);
    this.scheduleSave();
  }

  /** Toggle master bypass for a channel's chain */
  toggleChainBypass(channel: TrackGroup, bypassed: boolean): void {
    const chain = this.chains[channel];
    if (!chain) return;

    if (bypassed) {
      chain.bypass();
    } else {
      chain.restore();
    }
    this.scheduleSave();
  }

  // ─────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────

  getState(): MixerState {
    const tracks: TrackState[] = [];

    for (const player of this.players.values()) {
      tracks.push(player.getState());
    }

    return {
      masterVolume: this._volumes.master,
      channelVolumes: { ...this._volumes },
      tracks,
      chains: this.getAllChainsState(),
      timestamp: getServerTime(),
      syncEnabled: false
    };
  }

  async restoreState(state: MixerState): Promise<void> {
    let needsResave = false;

    // Restore master volume with validation
    this._volumes.master = this.sanitizeVolume(state.masterVolume, 1);
    if (this._volumes.master !== state.masterVolume) needsResave = true;
    this.masterGain.gain.setValueAtTime(this._volumes.master, this.ctx.currentTime);

    // Restore per-channel volumes with validation
    if (state.channelVolumes) {
      for (const channel of ['music', 'ambience', 'sfx'] as TrackGroup[]) {
        const raw = state.channelVolumes[channel];
        this._volumes[channel] = this.sanitizeVolume(raw, 1);
        if (this._volumes[channel] !== raw) needsResave = true;
        this.channelGains[channel].gain.setValueAtTime(this._volumes[channel], this.ctx.currentTime);
      }
    }

    // If volumes were missing/corrupted, save the cleaned state
    if (needsResave) {
      Logger.warn('Mixer state had invalid volume values — sanitized and will re-save');
      this.scheduleSave();
    }

    // Restore chains (new format)
    if (state.chains && state.chains.length > 0) {
      for (const chainState of state.chains) {
        const chain = this.chains[chainState.channel];
        if (chain) {
          chain.restoreState(chainState);
        }
      }
    }
    // Migration: old format (effects[] without chains[])
    else if (state.effects && state.effects.length > 0) {
      this.migrateFromLegacyEffects(state.effects);
    }

    // Restore tracks (without playing)
    for (const trackState of state.tracks) {
      if (!this.players.has(trackState.id)) {
        try {
          await this.createTrack({
            id: trackState.id,
            url: trackState.url,
            group: trackState.group,
            volume: trackState.volume
          });
        } catch (error) {
          Logger.error(`Failed to restore track ${trackState.id}:`, error);
        }
      }
    }

    // Remove tracks not in state
    const stateTrackIds = new Set(state.tracks.map(t => t.id));
    for (const [id] of this.players) {
      if (!stateTrackIds.has(id)) {
        this.removeTrack(id);
      }
    }
  }

  /** Migrate from old parallel send architecture to chain architecture */
  private migrateFromLegacyEffects(effects: EffectState[]): void {
    Logger.info('Migrating from legacy effects format to chain architecture');

    for (const group of ['music', 'ambience', 'sfx'] as TrackGroup[]) {
      const chainEffects = DEFAULT_CHAIN_ORDER.map(type => {
        const oldEffect = effects.find(e => e.type === type);
        return {
          type,
          enabled: oldEffect ? (oldEffect.enabled && oldEffect.routing[group]) : false,
          mix: DEFAULT_MIX[type] ?? 1.0,
          params: oldEffect?.params || {},
        };
      });

      this.chains[group].restoreState({
        channel: group,
        effects: chainEffects,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Audio Context
  // ─────────────────────────────────────────────────────────────

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
      Logger.info('AudioContext resumed');
    }
  }

  get contextState(): AudioContextState {
    return this.ctx.state;
  }

  // ─────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    for (const player of this.players.values()) {
      player.dispose();
    }
    this.players.clear();

    for (const chain of Object.values(this.chains)) {
      chain.dispose();
    }

    this.ctx.close();
    Logger.info('AudioEngine disposed');
  }
}
