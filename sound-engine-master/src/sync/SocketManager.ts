import type {
  SocketMessage,
  SocketMessageType,
  SyncStatePayload,
  SyncTrackState,
  TrackPlayPayload,
  TrackPausePayload,
  TrackStopPayload,
  TrackSeekPayload,
  TrackVolumePayload,
  ChannelVolumePayload,
  TrackGroup,
  ChannelVolumes,
  EffectParamPayload,
  EffectEnabledPayload,
  ChainReorderPayload,
  ChainEffectMixPayload,
} from '@t/audio';
import type { EffectType } from '@t/effects';
import { AudioEngine } from '@core/AudioEngine';
import { PlayerAudioEngine } from '@core/PlayerAudioEngine';
import { Logger } from '@utils/logger';
import { getServerTime } from '@utils/time';

const MODULE_ID = 'sound-engine-master';
const SOCKET_NAME = `module.${MODULE_ID}`;

export class SocketManager {
  private gmEngine: AudioEngine | null = null;
  private playerEngine: PlayerAudioEngine | null = null;
  private socket: any = null;
  private _syncEnabled: boolean = false;
  private isGM: boolean = false;

  constructor() { }

  initializeAsGM(engine: AudioEngine): void {
    this.isGM = true;
    this.gmEngine = engine;
    this.socket = game.socket;

    this.socket?.on(SOCKET_NAME, (message: SocketMessage) => {
      this.handleGMMessage(message);
    });

    Logger.info('SocketManager initialized as GM');
  }

  initializeAsPlayer(engine: PlayerAudioEngine): void {
    this.isGM = false;
    this.playerEngine = engine;
    this.socket = game.socket;

    this.socket?.on(SOCKET_NAME, (message: SocketMessage) => {
      this.handlePlayerMessage(message);
    });

    // Request current state on join
    setTimeout(() => {
      this.send('player-ready', {});
    }, 1000);

    Logger.info('SocketManager initialized as Player');
  }

  // ─────────────────────────────────────────────────────────────
  // Sync Mode (GM)
  // ─────────────────────────────────────────────────────────────

  get syncEnabled(): boolean {
    return this._syncEnabled;
  }

  setSyncEnabled(enabled: boolean): void {
    if (!this.isGM) return;

    this._syncEnabled = enabled;

    if (enabled) {
      this.broadcastSyncStart();
    } else {
      this.broadcastSyncStop();
    }

    Logger.info(`Sync mode: ${enabled ? 'ON' : 'OFF'}`);
  }

  // ─────────────────────────────────────────────────────────────
  // GM Message Handling
  // ─────────────────────────────────────────────────────────────

  private handleGMMessage(message: SocketMessage): void {
    if (message.senderId === game.user?.id) return;

    if (message.type === 'player-ready' && this._syncEnabled) {
      this.sendStateTo(message.senderId);
    }

    if (message.type === 'sync-request' && this._syncEnabled) {
      this.sendStateTo(message.senderId);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Player Message Handling
  // ─────────────────────────────────────────────────────────────

  private async handlePlayerMessage(message: SocketMessage): Promise<void> {
    if (message.senderId === game.user?.id) return;
    if (!this.playerEngine) return;

    Logger.debug(`Player received: ${message.type}`, message.payload);

    switch (message.type) {
      case 'sync-start': {
        const payload = message.payload as SyncStatePayload;
        this._syncEnabled = true;
        await this.playerEngine.syncState(payload.tracks, payload.channelVolumes, payload.chains);
        break;
      }

      case 'sync-stop':
        this._syncEnabled = false;
        this.playerEngine.clearAll();
        break;

      case 'sync-state': {
        const payload = message.payload as SyncStatePayload;
        this._syncEnabled = true;
        await this.playerEngine.syncState(payload.tracks, payload.channelVolumes, payload.chains);
        break;
      }

      case 'track-play': {
        const payload = message.payload as TrackPlayPayload;
        await this.playerEngine.handlePlay(payload);
        break;
      }

      case 'track-pause': {
        const payload = message.payload as TrackPausePayload;
        this.playerEngine.handlePause(payload.trackId);
        break;
      }

      case 'track-stop': {
        const payload = message.payload as TrackStopPayload;
        this.playerEngine.handleStop(payload.trackId);
        break;
      }

      case 'track-seek': {
        const payload = message.payload as TrackSeekPayload;
        this.playerEngine.handleSeek(
          payload.trackId,
          payload.time,
          payload.isPlaying,
          payload.seekTimestamp
        );
        break;
      }

      case 'track-volume': {
        const payload = message.payload as TrackVolumePayload;
        this.playerEngine.handleTrackVolume(payload.trackId, payload.volume);
        break;
      }

      case 'channel-volume': {
        const payload = message.payload as ChannelVolumePayload;
        this.playerEngine.setGMVolume(payload.channel, payload.volume);
        break;
      }

      case 'stop-all':
        this.playerEngine.stopAll();
        break;

      // ─── Chain Effect Messages ──────────────────────────────
      case 'effect-param': {
        const payload = message.payload as EffectParamPayload;
        this.playerEngine.setChainEffectParam(payload.channel, payload.effectType, payload.paramId, payload.value);
        break;
      }

      case 'effect-enabled': {
        const payload = message.payload as EffectEnabledPayload;
        this.playerEngine.setChainEffectEnabled(payload.channel, payload.effectType, payload.enabled);
        break;
      }

      case 'chain-reorder': {
        const payload = message.payload as ChainReorderPayload;
        this.playerEngine.reorderChainByTypes(payload.channel, payload.order);
        break;
      }

      case 'chain-effect-mix': {
        const payload = message.payload as ChainEffectMixPayload;
        this.playerEngine.setChainEffectMix(payload.channel, payload.effectType, payload.mix);
        break;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GM Broadcast Methods
  // ─────────────────────────────────────────────────────────────

  private send(type: SocketMessageType, payload: unknown, targetUserId?: string): void {
    if (!this.socket) return;

    const message: SocketMessage = {
      type,
      payload,
      senderId: game.user?.id ?? '',
      timestamp: getServerTime()
    };

    if (targetUserId) {
      this.socket.emit(SOCKET_NAME, message, { recipients: [targetUserId] });
    } else {
      this.socket.emit(SOCKET_NAME, message);
    }

    Logger.debug(`Sent: ${type}`, payload);
  }

  private getCurrentSyncState(): SyncStatePayload {
    if (!this.gmEngine) {
      return {
        tracks: [],
        channelVolumes: { master: 1, music: 1, ambience: 1, sfx: 1 },
        chains: []
      };
    }

    const now = getServerTime();
    const tracks: SyncTrackState[] = [];

    for (const player of this.gmEngine.getAllTracks()) {
      const state = player.getState();
      tracks.push({
        id: state.id,
        url: state.url,
        group: state.group,
        volume: state.volume,
        isPlaying: state.playbackState === 'playing',
        currentTime: player.getCurrentTime(),
        startTimestamp: now
      });
    }

    return {
      tracks,
      channelVolumes: this.gmEngine.volumes,
      chains: this.gmEngine.getAllChainsState()
    };
  }

  public broadcastFullState(): void {
    if (!this._syncEnabled) return;
    this.broadcastSyncStart();
  }

  private broadcastSyncStart(): void {
    const state = this.getCurrentSyncState();
    this.send('sync-start', state);
  }

  private broadcastSyncStop(): void {
    this.send('sync-stop', {});
  }

  private sendStateTo(userId: string): void {
    const state = this.getCurrentSyncState();
    this.send('sync-state', state, userId);
  }

  // ─────────────────────────────────────────────────────────────
  // GM Actions (called when GM interacts with mixer)
  // ─────────────────────────────────────────────────────────────

  broadcastTrackPlay(trackId: string, offset: number): void {
    if (!this._syncEnabled || !this.gmEngine) return;

    const player = this.gmEngine.getTrack(trackId);
    if (!player) return;

    const payload: TrackPlayPayload = {
      trackId,
      url: player.url,
      group: player.group,
      volume: player.volume,
      offset,
      startTimestamp: getServerTime()
    };

    this.send('track-play', payload);
  }

  broadcastTrackPause(trackId: string, pausedAt: number): void {
    if (!this._syncEnabled) return;

    const payload: TrackPausePayload = { trackId, pausedAt };
    this.send('track-pause', payload);
  }

  broadcastTrackStop(trackId: string): void {
    if (!this._syncEnabled) return;

    const payload: TrackStopPayload = { trackId };
    this.send('track-stop', payload);
  }

  broadcastTrackSeek(trackId: string, time: number, isPlaying: boolean): void {
    if (!this._syncEnabled) return;

    const payload: TrackSeekPayload = {
      trackId,
      time,
      isPlaying,
      seekTimestamp: getServerTime()
    };
    this.send('track-seek', payload);
  }

  broadcastTrackVolume(trackId: string, volume: number): void {
    if (!this._syncEnabled) return;

    const payload: TrackVolumePayload = { trackId, volume };
    this.send('track-volume', payload);
  }

  broadcastChannelVolume(channel: TrackGroup | 'master', volume: number): void {
    if (!this._syncEnabled) return;

    const payload: ChannelVolumePayload = { channel, volume };
    this.send('channel-volume', payload);
  }

  broadcastStopAll(): void {
    if (!this._syncEnabled) return;
    this.send('stop-all', {});
  }

  dispose(): void {
    this.socket?.off(SOCKET_NAME);
  }

  // ─────────────────────────────────────────────────────────────
  // Chain Effect Broadcasts (GM → Players)
  // ─────────────────────────────────────────────────────────────

  broadcastEffectParam(channel: TrackGroup, effectType: EffectType, paramId: string, value: any): void {
    if (!this._syncEnabled) return;
    const payload: EffectParamPayload = { channel, effectType, paramId, value };
    this.send('effect-param', payload);
  }

  broadcastEffectEnabled(channel: TrackGroup, effectType: EffectType, enabled: boolean): void {
    if (!this._syncEnabled) return;
    const payload: EffectEnabledPayload = { channel, effectType, enabled };
    this.send('effect-enabled', payload);
  }

  broadcastChainReorder(channel: TrackGroup, order: EffectType[]): void {
    if (!this._syncEnabled) return;
    const payload: ChainReorderPayload = { channel, order };
    this.send('chain-reorder', payload);
  }

  broadcastChainEffectMix(channel: TrackGroup, effectType: EffectType, mix: number): void {
    if (!this._syncEnabled) return;
    const payload: ChainEffectMixPayload = { channel, effectType, mix };
    this.send('chain-effect-mix', payload);
  }

  // ─────────────────────────────────────────────────────────────
  // Player Methods (request sync from GM)
  // ─────────────────────────────────────────────────────────────

  requestFullSync(): void {
    this.send('sync-request', {});
  }
}
