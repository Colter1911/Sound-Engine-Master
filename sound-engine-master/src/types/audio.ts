import type { EffectState, EffectType, ChannelChain } from './effects';

export type TrackGroup = 'music' | 'ambience' | 'sfx';
export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'loading';

export interface TrackConfig {
  id?: string;                   // UUID v4 (генерируется автоматически, если не указан)
  url: string;
  group: TrackGroup;
  volume?: number;
  libraryItemId?: string;        // UUID ссылка на LibraryItem (для будущего использования)
}

export interface TrackState {
  id: string;
  url: string;
  group: TrackGroup;
  playbackState: PlaybackState;
  volume: number;
  currentTime: number;
  duration: number;
}

export interface ChannelVolumes {
  master: number;
  music: number;
  ambience: number;
  sfx: number;
}

export interface MixerState {
  masterVolume: number;
  channelVolumes: ChannelVolumes;
  tracks: TrackState[];
  chains: ChannelChain[];               // New chain-based effects
  /** @deprecated legacy field, used for migration only */
  effects?: EffectState[];
  timestamp: number;
  syncEnabled: boolean;
}

// Socket
export type SocketMessageType =
  | 'sync-start'
  | 'sync-stop'
  | 'sync-state'
  | 'player-ready'
  | 'sync-request'
  | 'track-play'
  | 'track-pause'
  | 'track-stop'
  | 'track-volume'
  | 'track-seek'
  | 'master-volume'
  | 'channel-volume'
  | 'stop-all'
  | 'effect-param'
  | 'effect-enabled'
  | 'chain-reorder'
  | 'chain-effect-mix';

export interface SocketMessage {
  type: SocketMessageType;
  payload: unknown;
  senderId: string;
  timestamp: number;
  version?: number; // Protocol version for compatibility checks
}

export interface SyncStatePayload {
  tracks: SyncTrackState[];
  channelVolumes: ChannelVolumes;
  chains: ChannelChain[];               // New chain-based sync
  /** @deprecated legacy field, used for migration only */
  effects?: EffectState[];
}

export interface SyncTrackState {
  id: string;
  url: string;
  group: TrackGroup;
  volume: number;
  isPlaying: boolean;
  currentTime: number;
  startTimestamp: number;
}

export interface TrackPlayPayload {
  trackId: string;
  url: string;
  group: TrackGroup;
  volume: number;
  offset: number;
  startTimestamp: number;
}

export interface TrackPausePayload {
  trackId: string;
  pausedAt: number;
}

export interface TrackStopPayload {
  trackId: string;
}

export interface TrackSeekPayload {
  trackId: string;
  time: number;
  isPlaying: boolean;
  seekTimestamp: number;
}

export interface TrackVolumePayload {
  trackId: string;
  volume: number;
}

// ─── Chain Effect Payloads ──────────────────────────────────────

export interface EffectParamPayload {
  channel: TrackGroup;
  effectType: EffectType;
  paramId: string;
  value: any;
}

export interface EffectEnabledPayload {
  channel: TrackGroup;
  effectType: EffectType;
  enabled: boolean;
}

export interface ChainReorderPayload {
  channel: TrackGroup;
  order: EffectType[];
}

export interface ChainEffectMixPayload {
  channel: TrackGroup;
  effectType: EffectType;
  mix: number;
}

export interface ChannelVolumePayload {
  channel: TrackGroup | 'master';
  volume: number;
}

// ─── Removed (legacy) ───────────────────────────────────────────
// EffectRoutingPayload removed — routing is implicit in chain architecture
