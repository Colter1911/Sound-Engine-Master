import type { TrackGroup } from '@t/audio';
import type { EffectType } from '@t/effects';
import type { QueueItem } from '@t/queue';
import type { LibraryItem, Playlist } from '@t/library';
import { AudioEngine } from '@core/AudioEngine';
import { SocketManager } from '@sync/SocketManager';
import { LibraryManager } from '@lib/LibraryManager';
import { PlaybackQueueManager } from '@queue/PlaybackQueueManager';
import { Logger } from '@utils/logger';
import { formatTime } from '@utils/time';
import type { PlaybackContext } from '@core/PlaybackScheduler';

const MODULE_ID = 'sound-engine-master';

// ─────────────────────────────────────────────────────────────
// Types for Mixer View Data
// ─────────────────────────────────────────────────────────────

interface MixerViewData {
  favorites: FavoriteViewData[];
  queuePlaylists: QueuePlaylistViewData[];
  channelEffects: ChannelEffectsViewData;
}

interface FavoriteViewData {
  id: string;
  name: string;
  type: 'track' | 'playlist';
  group?: TrackGroup;
  isPlaying: boolean;
  isPaused: boolean;
  inQueue: boolean;
  playbackMode: string;          // Track: inherit/loop/single/linear/random, Playlist: loop/linear/random
  isFavorite: boolean;           // Always true in favorites, but needed for star state
}

interface ChannelEffectsViewData {
  music: boolean;
  ambience: boolean;
  sfx: boolean;
}

interface QueuePlaylistViewData {
  id: string | null;
  name: string;
  collapsed: boolean;
  tracks: QueueTrackViewData[];
  activeTrackCount: number;      // playing + paused tracks
  totalTrackCount: number;       // total tracks in group
  hasPlayingTracks: boolean;     // true if any track is playing
  hasPausedTracks: boolean;      // true if any track is paused
  playbackMode: string;          // playlist mode or 'loop' for ungrouped
  isUngrouped: boolean;          // true if id is null
}

interface QueueTrackViewData {
  queueId: string;
  libraryItemId: string;
  name: string;
  group: TrackGroup;
  tags: string[];
  isPlaying: boolean;
  isPaused: boolean;
  isStopped: boolean;
  isLoading: boolean;
  volume: number;
  volumePercent: number;

  playbackMode: string; // New playback mode system
  currentTime: number;
  currentTimeFormatted: string;
  duration: number;
  durationFormatted: string;
  progress: number;
  shouldBeHidden: boolean; // Computed: true if collapsed and not playing/paused
}

// ─────────────────────────────────────────────────────────────
// SoundMixerApp - Mixer Tab Controller
// ─────────────────────────────────────────────────────────────

export class SoundMixerApp {
  private engine: AudioEngine;
  private socket: SocketManager;
  private libraryManager: LibraryManager;
  private queueManager: PlaybackQueueManager;
  private collapsedPlaylists: Set<string> = new Set();
  private ungroupedCollapsed: boolean = false;
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private html: JQuery | null = null;
  private renderParent: (() => void) | null = null;

  // Throttle for socket broadcasts
  private seekThrottleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private volumeThrottleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private static THROTTLE_MS = 200;

  // Stored callbacks for proper cleanup
  private _onQueueChangeBound: () => void;
  private _onTrackEndedBound: () => void;
  private _hookFavoritesId: number = 0;
  private _hookAutoSwitchId: number = 0;

  // Drag-and-Drop State (Optimization with RAF)
  private _dragTarget: HTMLElement | null = null;
  private _dragPosition: 'above' | 'below' | null = null;
  private _rafId: number | null = null;
  private _pendingDragUpdate: { target: HTMLElement, position: 'above' | 'below' } | null = null;

  constructor(
    engine: AudioEngine,
    socket: SocketManager,
    libraryManager: LibraryManager,
    queueManager: PlaybackQueueManager
  ) {
    this.engine = engine;
    this.socket = socket;
    this.libraryManager = libraryManager;
    this.queueManager = queueManager;

    // Store bound callbacks for cleanup
    this._onQueueChangeBound = () => this.onQueueChange();
    this._onTrackEndedBound = () => this.onTrackStateChange();

    // Subscribe to queue changes for real-time updates
    this.queueManager.on('change', this._onQueueChangeBound);

    // Subscribe to track state changes for UI updates
    this.engine.on('trackEnded', this._onTrackEndedBound);

    // Listen for external favorite changes (Global Hook)
    this._hookFavoritesId = Hooks.on('ase.favoritesChanged' as any, () => {
      this.requestRender();
    });

    // Listen for automatic track switches from PlaybackScheduler
    this._hookAutoSwitchId = Hooks.on('ase.trackAutoSwitched' as any, () => {
      Logger.debug('[SoundMixerApp] Track auto-switched, re-rendering');
      this.requestRender();
    });
  }

  // Set callback for requesting parent render
  setRenderCallback(callback: () => void): void {
    this.renderParent = callback;
  }

  // ─────────────────────────────────────────────────────────────
  // Data Provider
  // ─────────────────────────────────────────────────────────────

  getData(): MixerViewData {
    // Get ordered favorites from library (includes both tracks and playlists)
    const orderedFavorites = this.libraryManager.getOrderedFavorites();
    const favorites: FavoriteViewData[] = [];

    for (const fav of orderedFavorites) {
      // Check if item is in queue (same pattern as LocalLibraryApp.ts:153-155)
      const inQueue = fav.type === 'track'
        ? (window.ASE?.queue?.hasItem(fav.id) ?? false)
        : (window.ASE?.queue?.getItems().some((q) => q.playlistId === fav.id) ?? false);

      if (fav.type === 'track') {
        const item = this.libraryManager.getItem(fav.id);
        if (item) {
          const player = this.engine.getTrack(item.id);
          favorites.push({
            id: item.id,
            name: item.name,
            type: 'track',
            group: item.group,
            isPlaying: player?.state === 'playing',
            isPaused: player?.state === 'paused',
            inQueue,
            playbackMode: item.playbackMode || 'inherit',
            isFavorite: true,
          });
        }
      } else if (fav.type === 'playlist') {
        const playlist = this.libraryManager.playlists.getPlaylist(fav.id);
        if (playlist) {
          // Check if any track in the playlist is playing/paused
          const playlistTracks = this.libraryManager.playlists.getPlaylistTracks(fav.id);
          let isPlaying = false;
          let isPaused = false;
          for (const pt of playlistTracks) {
            const player = this.engine.getTrack(pt.libraryItemId);
            if (player?.state === 'playing') isPlaying = true;
            if (player?.state === 'paused') isPaused = true;
          }

          favorites.push({
            id: playlist.id,
            name: playlist.name,
            type: 'playlist',
            group: undefined,
            isPlaying,
            isPaused: !isPlaying && isPaused,
            inQueue,
            playbackMode: playlist.playbackMode || 'loop',
            isFavorite: true,
          });
        }
      }
    }

    // Get queue items grouped by playlist
    const queueItems = this.queueManager.getItems();
    const queuePlaylists = this.groupQueueByPlaylist(queueItems);

    // Get channel bypass states
    const channelEffects: ChannelEffectsViewData = {
      music: !this.engine.getChain('music').isBypassed,
      ambience: !this.engine.getChain('ambience').isBypassed,
      sfx: !this.engine.getChain('sfx').isBypassed
    };

    return {
      favorites,
      queuePlaylists,
      channelEffects,
    };
  }

  private groupQueueByPlaylist(queueItems: QueueItem[]): QueuePlaylistViewData[] {
    const groups = new Map<string | null, QueueItem[]>();
    const ungroupedLabel = game.i18n?.localize?.('ASE.UI.Queue.Ungrouped') ?? 'Ungrouped';
    const unknownPlaylistLabel = game.i18n?.localize?.('ASE.UI.Queue.UnknownPlaylist') ?? 'Unknown Playlist';

    // Group by playlistId (null for un-grouped tracks)
    for (const item of queueItems) {
      const key = item.playlistId ?? null;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    }

    const playlists: QueuePlaylistViewData[] = [];

    for (const [playlistId, items] of groups) {
      // Get playlist name and mode
      let name = ungroupedLabel;
      let playbackMode = 'loop'; // Default for ungrouped
      const isUngrouped = !playlistId;

      if (playlistId) {
        const playlist = this.libraryManager.playlists.getPlaylist(playlistId);
        name = playlist?.name ?? unknownPlaylistLabel;
        playbackMode = playlist?.playbackMode ?? 'loop';
      }

      const collapsed = playlistId ? this.collapsedPlaylists.has(playlistId) : this.ungroupedCollapsed;
      const tracks = items.map(queueItem => this.getQueueTrackViewData(queueItem, collapsed));

      // Compute active track counts
      const activeTrackCount = tracks.filter(t => t.isPlaying || t.isPaused).length;
      const hasPlayingTracks = tracks.some(t => t.isPlaying);
      const hasPausedTracks = tracks.some(t => t.isPaused);

      playlists.push({
        id: playlistId,
        name,
        collapsed: playlistId ? this.collapsedPlaylists.has(playlistId) : this.ungroupedCollapsed,
        tracks,
        activeTrackCount,
        totalTrackCount: tracks.length,
        hasPlayingTracks,
        hasPausedTracks,
        playbackMode,
        isUngrouped,
      });
    }

    return playlists;
  }

  private getQueueTrackViewData(queueItem: QueueItem, parentCollapsed: boolean = false): QueueTrackViewData {
    const libraryItem = this.libraryManager.getItem(queueItem.libraryItemId);
    const player = this.engine.getTrack(queueItem.libraryItemId);

    const currentTimeRaw = player?.getCurrentTime() ?? 0;
    const duration = libraryItem?.duration ?? player?.getDuration() ?? 0;
    const currentTime = Math.min(currentTimeRaw, duration);

    let progress = 0;
    if (duration > 0 && Number.isFinite(duration)) {
      progress = (currentTime / duration) * 100;
    }
    progress = Math.min(Math.max(progress, 0), 100);

    // Get volume and loop from player if available (persisted state), fallback to queueItem
    const volume = player?.volume ?? queueItem.volume;

    const isPlaying = player?.state === 'playing';
    const isPaused = player?.state === 'paused';
    const shouldBeHidden = parentCollapsed && !isPlaying && !isPaused;

    return {
      queueId: queueItem.id,
      libraryItemId: queueItem.libraryItemId,
      name: libraryItem?.name ?? 'Unknown Track',
      group: libraryItem?.group ?? queueItem.group,
      tags: libraryItem?.tags ?? [],
      isPlaying,
      isPaused,
      isStopped: !player || player.state === 'stopped',
      isLoading: player?.state === 'loading',
      volume,
      volumePercent: Math.round(volume * 100),
      playbackMode: libraryItem?.playbackMode || 'inherit', // Add playbackMode
      currentTime,
      currentTimeFormatted: formatTime(currentTime),
      duration,
      durationFormatted: formatTime(duration),
      progress,
      shouldBeHidden,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Event Listeners
  // ─────────────────────────────────────────────────────────────

  activateListeners(html: JQuery): void {
    this.html = html;
    this.startUpdates();

    // Favorites controls
    html.find('[data-action="play-favorite"]').on('click', (e) => this.onPlayFavorite(e));
    html.find('[data-action="pause-favorite"]').on('click', (e) => this.onPauseFavorite(e));
    html.find('[data-action="stop-favorite"]').on('click', (e) => this.onStopFavorite(e));
    html.find('[data-action="add-to-queue-from-favorite"]').on('click', (e) => this.onAddToQueueFromFavorite(e));
    html.find('[data-action="favorite-mode-dropdown"]').on('click', (e) => this.onFavoriteModeClick(e));
    html.find('[data-action="toggle-mixer-favorite"]').on('click', (e) => this.onToggleMixerFavorite(e));

    // Queue controls
    html.find('[data-action="play-queue"]').on('click', (e) => this.onPlayQueueItem(e));
    html.find('[data-action="pause-queue"]').on('click', (e) => this.onPauseQueueItem(e));
    html.find('[data-action="stop-queue"]').on('click', (e) => this.onStopQueueItem(e));
    html.find('[data-action="remove-queue"]').on('click', (e) => this.onRemoveQueueItem(e));
    // Removed old loop button handler
    html.find('[data-action="track-mode-dropdown"]').on('click', (e) => this.onTrackModeClick(e));
    html.find('[data-action="channel-dropdown"]').on('click', (e) => this.onChannelDropdown(e));

    // Playlist collapse/expand
    html.find('[data-action="toggle-playlist"]').on('click', (e) => this.onTogglePlaylist(e));

    // Playlist header controls
    html.find('[data-action="play-playlist"]').on('click', (e) => this.onPlayPlaylistHeader(e));
    html.find('[data-action="pause-playlist"]').on('click', (e) => this.onPausePlaylistHeader(e));
    html.find('[data-action="stop-playlist"]').on('click', (e) => this.onStopPlaylistHeader(e));
    html.find('[data-action="playlist-mode-dropdown"]').on('click', (e) => this.onPlaylistModeClick(e));
    html.find('[data-action="remove-playlist"]').on('click', (e) => this.onRemovePlaylistFromQueue(e));

    // Track controls
    html.find('[data-action="seek"]').on('input', (e) => this.onSeek(e));
    html.find('[data-action="volume"]').on('input', (e) => this.onVolumeChange(e));

    // Real-time volume display update (without triggering audio change)
    html.find('.volume-slider').on('input', (e) => {
      const slider = e.currentTarget as HTMLInputElement;
      const value = slider.value;
      const volumeDisplay = $(slider).siblings('.vol-value');
      volumeDisplay.text(`${value}%`);
    });

    // Progress bar time preview on hover
    html.find('.progress-section').each((_, section) => {
      const $section = $(section);
      const $tooltip = $section.find('.progress-hover-time');

      $section.on('mousemove', (e) => {
        const rect = section.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(100, (offsetX / rect.width) * 100));

        // Get duration from nearest track
        const $track = $section.closest('.ase-queue-track');
        const durationText = $track.find('.track-timer').text().split('/')[1]?.trim();

        if (durationText) {
          // Parse duration MM:SS to seconds
          const [mins, secs] = durationText.split(':').map(Number);
          const totalSeconds = (mins * 60) + secs;
          const hoverSeconds = Math.floor((percentage / 100) * totalSeconds);

          // Format to MM:SS
          const hoverMins = Math.floor(hoverSeconds / 60);
          const hoverSecs = hoverSeconds % 60;
          const hoverTime = `${hoverMins}:${hoverSecs.toString().padStart(2, '0')}`;

          $tooltip.text(hoverTime);
          $tooltip.css({
            left: `${percentage}%`,
            display: 'block'
          });
        }
      });

      $section.on('mouseleave', () => {
        $tooltip.css('display', 'none');
      });
    });

    // Effects controls
    html.find('[data-action="toggle-channel-effects"]').on('click', (e) => this.onToggleChannelEffects(e));

    // Drag and Drop
    this.setupDragAndDrop(html);

    // Text Marquee on hover
    this.setupMarquee(html);
  }

  // ─────────────────────────────────────────────────────────────
  // Marquee Logic
  // ─────────────────────────────────────────────────────────────

  /**
   * Setup scrolling text for truncated names on hover
   */
  /**
   * Setup scrolling text for truncated names on hover or active play
   */
  private setupMarquee(html: JQuery): void {
    // 1. Handle Hover
    html.find('.ase-favorite-item').on('mouseenter', (e) => {
      this.toggleMarquee(e.currentTarget as HTMLElement, true);
    });

    html.find('.ase-favorite-item').on('mouseleave', (e) => {
      // Only stop if not playing
      const item = e.currentTarget as HTMLElement;
      if (!item.classList.contains('is-playing')) {
        this.toggleMarquee(item, false);
      }
    });

    // 2. Initial Setup for Playing Items
    html.find('.ase-favorite-item.is-playing').each((_, el) => {
      this.toggleMarquee(el as HTMLElement, true);
    });
  }

  private toggleMarquee(item: HTMLElement, active: boolean): void {
    const info = item.querySelector('.ase-favorite-info') as HTMLElement;
    const span = info?.querySelector('span') as HTMLElement;
    if (!span) return;

    if (!active) {
      item.classList.remove('is-scrolling');
      span.style.removeProperty('--scroll-offset');
      span.style.removeProperty('--scroll-duration');
      return;
    }

    // Check overflow
    // We need to temporarily enable overflow to measure true scrollWidth?
    // Actually, scrollWidth works even with overflow:hidden
    const overflow = span.scrollWidth - info.offsetWidth; // Use info container width

    if (overflow > 0) {
      const speed = 20; // px/s
      // Add padding for better visual
      const buffer = 20;
      const offset = -(overflow + buffer);
      // Ensure minimum duration
      const duration = Math.max((overflow + buffer) / speed, 2);

      span.style.setProperty('--scroll-offset', `${offset}px`);
      span.style.setProperty('--scroll-duration', `${duration}s`);
      item.classList.add('is-scrolling');
    }
  }


  // ─────────────────────────────────────────────────────────────
  // Favorites Handlers
  // ─────────────────────────────────────────────────────────────

  private async onPlayFavorite(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const $el = $(event.currentTarget);
    const id = $el.data('favorite-id') as string;
    const type = $el.data('favorite-type') as 'track' | 'playlist';

    if (type === 'track') {
      // Add track to queue if not already there
      const libraryItem = this.libraryManager.getItem(id);
      if (libraryItem) {
        const queueItems = this.queueManager.getItems();
        const existingQueueItem = queueItems.find(
          (item) => item.libraryItemId === id && !item.playlistId
        );

        if (!existingQueueItem) {
          this.queueManager.addItem(id, { group: libraryItem.group });
        }

        // Play the track with single track context
        const context: PlaybackContext = {
          type: 'track',
          playbackMode: libraryItem.playbackMode
        };
        await this.playTrack(id, context);
      }
    } else {
      // Add entire playlist to queue if not already there
      const playlist = this.libraryManager.playlists.getPlaylist(id);
      if (playlist) {
        const queueItems = this.queueManager.getItems();
        const existingPlaylistItems = queueItems.filter(
          (item) => item.playlistId === id
        );

        if (existingPlaylistItems.length === 0) {
          const tracks = this.libraryManager.playlists.getPlaylistTracks(id);
          const playlistItems = tracks.map((t) => {
            const item = this.libraryManager.getItem(t.libraryItemId);
            return {
              libraryItemId: t.libraryItemId,
              group: item?.group || ('music' as const),
            };
          });
          this.queueManager.addPlaylist(id, playlistItems as any);
        }

        // Play first track from playlist
        await this.playPlaylist(id);
      }
    }
    this.requestRender();
  }

  private onPauseFavorite(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const $el = $(event.currentTarget);
    const id = $el.data('favorite-id') as string;
    const type = $el.data('favorite-type') as string;

    if (type === 'track') {
      this.pauseTrack(id);
    } else {
      // Pause all playing tracks in playlist
      const tracks = this.libraryManager.playlists.getPlaylistTracks(id);
      for (const track of tracks) {
        const player = this.engine.getTrack(track.libraryItemId);
        if (player?.state === 'playing') {
          this.pauseTrack(track.libraryItemId);
        }
      }
    }
    this.requestRender();
  }

  private onStopFavorite(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const $el = $(event.currentTarget);
    const id = $el.data('favorite-id') as string;
    const type = $el.data('favorite-type') as string;

    if (type === 'track') {
      this.stopTrack(id);
    } else {
      // Stop all tracks in playlist
      this.stopPlaylist(id);
    }
    this.requestRender();
  }

  private onFavoriteModeClick(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const btn = $(event.currentTarget);
    const id = btn.data('favorite-id') as string;
    const type = btn.data('favorite-type') as 'track' | 'playlist';

    if (type === 'track') {
      const item = this.libraryManager.getItem(id);
      if (!item) return;

      const modes: { label: string, value: string, icon: string }[] = [
        { label: 'Inherit (Default)', value: 'inherit', icon: 'fa-arrow-turn-down' },
        { label: 'Loop', value: 'loop', icon: 'fa-repeat' },
        { label: 'Single', value: 'single', icon: 'fa-arrow-right-to-line' },
        { label: 'Linear', value: 'linear', icon: 'fa-arrow-right' },
        { label: 'Random', value: 'random', icon: 'fa-shuffle' }
      ];

      this.showModeContextMenu(event, modes, (mode) => {
        this.libraryManager.updateItem(id, { playbackMode: mode as any });
        this.requestRender();
      });
    } else {
      const playlist = this.libraryManager.playlists.getPlaylist(id);
      if (!playlist) return;

      const modes: { label: string, value: string, icon: string }[] = [
        { label: 'Loop (Default)', value: 'loop', icon: 'fa-repeat' },
        { label: 'Linear', value: 'linear', icon: 'fa-arrow-right' },
        { label: 'Random', value: 'random', icon: 'fa-shuffle' }
      ];

      this.showModeContextMenu(event, modes, (mode) => {
        this.libraryManager.playlists.updatePlaylist(id, { playbackMode: mode as any });
        this.requestRender();
      });
    }
  }

  private onToggleMixerFavorite(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const btn = $(event.currentTarget);
    const id = btn.data('favorite-id') as string;
    const type = btn.data('favorite-type') as 'track' | 'playlist';

    if (type === 'track') {
      this.libraryManager.toggleFavorite(id);
    } else {
      this.libraryManager.playlists.togglePlaylistFavorite(id);
    }
    this.requestRender();
  }

  // ─────────────────────────────────────────────────────────────
  // Queue Item Handlers
  // ─────────────────────────────────────────────────────────────

  private async onPlayQueueItem(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const $track = $(event.currentTarget).closest('.ase-queue-track');
    const queueId = $track.data('queue-id') as string;
    const itemId = $track.data('item-id') as string;

    // Find specific queue item by unique ID
    const queueItem = this.queueManager.getItems().find(q => q.id === queueId);
    if (!queueItem) {
      Logger.warn(`Queue item not found for ID: ${queueId}`);
      return;
    }

    let context: PlaybackContext;

    if (queueItem.playlistId) {
      // Трек из плейлиста
      const playlist = this.libraryManager.playlists.getPlaylist(queueItem.playlistId);
      context = {
        type: 'playlist',
        id: queueItem.playlistId,
        playbackMode: playlist?.playbackMode || 'loop'
      };
    } else {
      // Отдельный трек
      const libraryItem = this.libraryManager.getItem(itemId);
      context = {
        type: 'track',
        playbackMode: libraryItem?.playbackMode || 'inherit'
      };
    }

    await this.playTrack(itemId, context);
    this.requestRender();
  }

  private onPauseQueueItem(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const $track = $(event.currentTarget).closest('.ase-queue-track');
    const itemId = $track.data('item-id') as string;
    this.pauseTrack(itemId);
    this.requestRender();
  }

  private onStopQueueItem(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const $track = $(event.currentTarget).closest('.ase-queue-track');
    const itemId = $track.data('item-id') as string;
    this.stopTrack(itemId);
    this.requestRender();
  }

  private onRemoveQueueItem(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const $track = $(event.currentTarget).closest('.ase-queue-track');
    const queueId = $track.data('queue-id') as string;
    const itemId = $track.data('item-id') as string;

    // Stop the track first
    this.stopTrack(itemId);
    // Remove from queue
    this.queueManager.removeItem(queueId);
    this.requestRender();
  }

  /**
   * Handle playback mode dropdown click
   */
  private onTrackModeClick(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const btn = $(event.currentTarget);
    // Support both direct data on icon
    let itemId = btn.data('item-id') as string;
    if (!itemId) {
      itemId = btn.closest('[data-item-id]').data('item-id') as string;
    }

    const item = this.libraryManager.getItem(itemId);
    if (!item) {
      Logger.warn(`Track Mode Clicked: Item not found for ID ${itemId}`);
      return;
    }

    const modes: { label: string, value: string, icon: string }[] = [
      { label: 'Inherit (Default)', value: 'inherit', icon: 'fa-arrow-turn-down' },
      { label: 'Loop', value: 'loop', icon: 'fa-repeat' },
      { label: 'Single', value: 'single', icon: 'fa-arrow-right-to-line' },
      { label: 'Linear', value: 'linear', icon: 'fa-arrow-right' },
      { label: 'Random', value: 'random', icon: 'fa-shuffle' }
    ];

    this.showModeContextMenu(event, modes, (mode) => {
      this.libraryManager.updateItem(itemId, { playbackMode: mode as any });
      this.requestRender();
    });
  }

  /**
   * Show context menu for mode selection
   */
  private showModeContextMenu(event: JQuery.ClickEvent, modes: any[], callback: (mode: string) => void): void {
    const localize = (key: string) => game.i18n!.localize(key);

    const menuHtml = `
      <div id="ase-mode-menu" class="ase-context-menu">
        ${modes.map(m => `
          <div class="ase-ctx-item" data-value="${m.value}">
              <i class="fa-solid ${m.icon}"></i> 
              <span>${localize(`ASE.UI.PlaybackMode.${m.value}`)}</span>
          </div>
        `).join('')}
      </div>
    `;

    $('#ase-mode-menu').remove();
    const menu = $(menuHtml);
    $('body').append(menu);

    menu.css({ top: event.clientY, left: event.clientX });

    menu.find('.ase-ctx-item').on('click', (e) => {
      e.stopPropagation();
      const val = $(e.currentTarget).data('value');
      Logger.debug(`Mode Selected: ${val}`);
      callback(val);
      menu.remove();
    });

    // Close on click outside
    setTimeout(() => {
      $('body').one('click', () => {
        menu.remove();
      });
    }, 10);
  }

  /**
   * Handle channel dropdown click
   */
  private onChannelDropdown(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const btn = $(event.currentTarget);
    const itemId = btn.data('item-id') as string;

    // Also try finding it if clicked on icon inside
    const id = itemId || btn.closest('[data-item-id]').data('item-id') as string;

    const item = this.libraryManager.getItem(id);
    if (!item) return;

    const currentGroup = item.group || 'music';
    const channels = ['music', 'ambience', 'sfx'];
    const localize = (key: string) => game.i18n!.localize(key);

    // Create dropdown menu
    const menu = $(`
      <div class="ase-dropdown-menu">
        ${channels.map(ch => `
          <div class="ase-dropdown-item ${ch === currentGroup ? 'active' : ''}" data-channel="${ch}">
            ${localize(`ASE.Groups.${ch}`)}
          </div>
        `).join('')}
      </div>
    `);

    // Position menu
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu.css({ top: rect.bottom + 2, left: rect.left });

    $('body').append(menu);

    menu.find('.ase-dropdown-item').on('click', (e) => {
      e.stopPropagation();
      const newChannel = $(e.currentTarget).data('channel') as string;
      this.updateTrackChannel(id, newChannel);
      menu.remove();
    });

    // Close on outside click
    setTimeout(() => {
      $(document).one('click', () => menu.remove());
    }, 10);
  }

  private updateTrackChannel(itemId: string, channel: string): void {
    const item = this.libraryManager.getItem(itemId);
    if (!item) return;

    const group = channel as TrackGroup;
    this.libraryManager.updateItem(itemId, { group });

    // Re-route the live audio graph if a player already exists
    this.engine.setTrackChannel(itemId, group);

    this.requestRender();
  }

  private async onAddToQueueFromFavorite(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const $el = $(event.currentTarget);
    const id = $el.data('favorite-id') as string;
    const type = $el.data('favorite-type') as 'track' | 'playlist';

    if (type === 'track') {
      const libraryItem = this.libraryManager.getItem(id);
      if (!libraryItem) return;

      // Toggle: if already in queue, remove it
      if (this.queueManager.hasItem(id)) {
        this.queueManager.removeByLibraryItemId(id);
        Logger.info(`Removed track from queue: ${libraryItem.name}`);
      } else {
        this.queueManager.addItem(id, { group: libraryItem.group });
        Logger.info(`Added track to queue: ${libraryItem.name}`);
      }
    } else {
      // Add entire playlist to queue
      const playlist = this.libraryManager.playlists.getPlaylist(id);
      if (!playlist) return;

      const tracks = this.libraryManager.playlists.getPlaylistTracks(id);

      // Check if ALL tracks from playlist are in queue
      const allInQueue = tracks.every(t => this.queueManager.hasItem(t.libraryItemId));

      if (allInQueue) {
        // Remove all tracks from this playlist
        for (const track of tracks) {
          this.queueManager.removeByLibraryItemId(track.libraryItemId);
        }
        Logger.info(`Removed playlist from queue: ${playlist.name}`);
      } else {
        // Add playlist tracks
        const playlistItems = tracks.map(t => {
          const item = this.libraryManager.getItem(t.libraryItemId);
          return {
            libraryItemId: t.libraryItemId,
            group: item?.group || 'music' as const,
          };
        });
        this.queueManager.addPlaylist(id, playlistItems as any);
        Logger.info(`Added playlist to queue: ${playlist.name}`);
      }
    }
    this.requestRender();
  }

  // ─────────────────────────────────────────────────────────────
  // Drag and Drop
  // ─────────────────────────────────────────────────────────────

  private setupDragAndDrop(html: JQuery): void {
    // ── Favorites reordering ──

    // Prevent drag from interactive elements (buttons/icons in favorites)
    html.find('.ase-favorite-item .ase-icons, .ase-favorite-item button, .ase-favorite-item input').on('pointerdown', (e) => {
      e.stopPropagation();
      const $item = $(e.currentTarget).closest('.ase-favorite-item');
      $item.attr('draggable', 'false');
    });

    html.find('.ase-list-group[data-section="mixer-favorites"]').on('pointerup pointercancel', () => {
      html.find('.ase-favorite-item').attr('draggable', 'true');
    });

    html.find('.ase-favorite-item[draggable="true"]').on('dragstart', (event: JQuery.DragStartEvent) => {
      event.stopPropagation();
      const favoriteId = String($(event.currentTarget).data('favorite-id'));
      const favoriteType = String($(event.currentTarget).data('favorite-type'));

      Logger.info(`[SoundMixerApp] DragStart Favorite: ${favoriteId} (${favoriteType})`);

      event.originalEvent!.dataTransfer!.effectAllowed = 'move';
      event.originalEvent!.dataTransfer!.setData('application/x-mixer-favorite-id', favoriteId);
      event.originalEvent!.dataTransfer!.setData('application/x-mixer-favorite-type', favoriteType);
      $(event.currentTarget).addClass('dragging');
    });

    html.find('.ase-favorite-item[draggable="true"]').on('dragend', (event: JQuery.DragEndEvent) => {
      // Cancel any pending RAF to prevent stale class application
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._pendingDragUpdate = null;
      this._dragTarget = null;
      this._dragPosition = null;

      $(event.currentTarget).removeClass('dragging');
      html.find('.ase-favorite-item').removeClass('drag-over drag-above drag-below');
    });

    // Favorites visual feedback for insertion position
    html.find('.ase-favorite-item').on('dragover', (event: JQuery.DragOverEvent) => {
      // Robust check for types (Array or DOMStringList)
      const types = event.originalEvent!.dataTransfer!.types;
      const hasFavoriteId = (types instanceof DOMStringList && types.contains('application/x-mixer-favorite-id')) ||
        (types instanceof Array && types.includes('application/x-mixer-favorite-id')) ||
        (Array.from(types).includes('application/x-mixer-favorite-id'));

      if (!hasFavoriteId) return;

      event.preventDefault();
      event.stopPropagation(); // Prevent parent handlers
      event.originalEvent!.dataTransfer!.dropEffect = 'move';

      // Optimize with RequestAnimationFrame
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const clientY = event.originalEvent!.clientY ?? event.clientY;
      const isAbove = clientY < midY;
      const newPos = isAbove ? 'above' : 'below';

      // Store pending update
      this._pendingDragUpdate = {
        target: event.currentTarget as HTMLElement,
        position: newPos
      };

      // Schedule RAF if not already running
      if (!this._rafId) {
        this._rafId = requestAnimationFrame(this._processDragUpdate.bind(this, html, '.ase-favorite-item'));
      }
    });

    html.find('.ase-favorite-item').on('dragleave', (event: JQuery.DragLeaveEvent) => {
      // If we leave the current target, clear it
      if (this._dragTarget === event.currentTarget) {
        this._dragTarget = null;
        this._dragPosition = null;
        // If we have a pending update for this target, clear it too, but we might have a new one incoming
        // Simplest: just remove classes immediately on leave to be responsive
        $(event.currentTarget).removeClass('drag-above drag-below');
      }
    });

    html.find('.ase-favorite-item').on('drop', (event: JQuery.DropEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Capture position before clearing state
      const dropPosition = this._dragPosition || 'above';

      // Cleanup RAF
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._pendingDragUpdate = null;
      this._dragTarget = null;
      this._dragPosition = null;

      const targetId = String($(event.currentTarget).data('favorite-id'));
      const targetType = String($(event.currentTarget).data('favorite-type')) as 'track' | 'playlist';

      html.find('.ase-favorite-item').removeClass('drag-above drag-below dragging');

      const draggedId = event.originalEvent!.dataTransfer!.getData('application/x-mixer-favorite-id');
      const draggedType = event.originalEvent!.dataTransfer!.getData('application/x-mixer-favorite-type') as 'track' | 'playlist';

      Logger.info(`[SoundMixerApp] Drop Favorite: ${draggedId} -> ${targetId} (${dropPosition})`);

      if (draggedId && draggedType && (draggedId !== targetId || draggedType !== targetType)) {
        this.handleFavoriteReorder(draggedId, draggedType, targetId, targetType, dropPosition);
      }
    });

    // ── Queue track reordering ──

    // Prevent drag from interactive elements (volume, seek, buttons)
    // stopPropagation alone doesn't block native HTML5 drag - we must disable draggable attribute
    html.find('.ase-queue-track input, .ase-queue-track button, .ase-queue-track .volume-container, .ase-queue-track .progress-wrapper').on('pointerdown', (e) => {
      e.stopPropagation();
      const $track = $(e.currentTarget).closest('.ase-queue-track');
      $track.attr('draggable', 'false');
    });

    // Restore draggable on pointer release (delegated to track list container)
    html.find('.ase-track-player-list').on('pointerup pointercancel', () => {
      html.find('.ase-queue-track').attr('draggable', 'true');
    });

    html.find('.ase-queue-track[draggable="true"]').on('dragstart', (event: JQuery.DragStartEvent) => {
      event.stopPropagation();
      const queueId = String($(event.currentTarget).data('queue-id'));


      Logger.info(`[SoundMixerApp] DragStart Queue: ${queueId}`);

      event.originalEvent!.dataTransfer!.effectAllowed = 'move';
      event.originalEvent!.dataTransfer!.setData('application/x-mixer-queue-id', queueId);
      $(event.currentTarget).addClass('dragging');
    });

    html.find('.ase-queue-track[draggable="true"]').on('dragend', (event: JQuery.DragEndEvent) => {
      // Cancel any pending RAF to prevent stale class application
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._pendingDragUpdate = null;
      this._dragTarget = null;
      this._dragPosition = null;

      $(event.currentTarget).removeClass('dragging');
      html.find('.ase-queue-track').removeClass('drag-over drag-above drag-below');

      // Restore draggable in case it was disabled by slider interaction
      $(event.currentTarget).attr('draggable', 'true');
    });

    html.find('.ase-queue-track').on('dragover', (event: JQuery.DragOverEvent) => {
      const types = event.originalEvent!.dataTransfer!.types;
      const hasQueueId = (types instanceof DOMStringList && types.contains('application/x-mixer-queue-id')) ||
        (types instanceof Array && types.includes('application/x-mixer-queue-id')) ||
        (Array.from(types).includes('application/x-mixer-queue-id'));

      if (!hasQueueId) return;

      event.preventDefault();
      event.stopPropagation();
      event.originalEvent!.dataTransfer!.dropEffect = 'move';

      // Optimize Queue Drag with RAF
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const clientY = event.originalEvent!.clientY ?? event.clientY;
      const isAbove = clientY < midY;
      const newPos = isAbove ? 'above' : 'below';

      this._pendingDragUpdate = {
        target: event.currentTarget as HTMLElement,
        position: newPos
      };

      if (!this._rafId) {
        this._rafId = requestAnimationFrame(this._processDragUpdate.bind(this, html, '.ase-queue-track'));
      }
    });

    html.find('.ase-queue-track').on('dragleave', (event: JQuery.DragLeaveEvent) => {
      if (this._dragTarget === event.currentTarget) {
        this._dragTarget = null;
        this._dragPosition = null;
        $(event.currentTarget).removeClass('drag-above drag-below');
      }
    });

    html.find('.ase-queue-track').on('drop', (event: JQuery.DropEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Capture position before clearing state
      const dropPosition = this._dragPosition || 'above';

      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._pendingDragUpdate = null;
      this._dragTarget = null;
      this._dragPosition = null;

      html.find('.ase-queue-track').removeClass('drag-above drag-below dragging');

      const draggedQueueId = event.originalEvent!.dataTransfer!.getData('application/x-mixer-queue-id');
      const targetQueueId = String($(event.currentTarget).data('queue-id'));

      Logger.info(`[SoundMixerApp] Drop Queue: ${draggedQueueId} -> ${targetQueueId} (${dropPosition})`);

      if (draggedQueueId && draggedQueueId !== targetQueueId) {
        this.handleQueueReorder(draggedQueueId, targetQueueId, dropPosition);
      }
    });
  }

  private handleFavoriteReorder(
    draggedId: string,
    draggedType: 'track' | 'playlist',
    targetId: string,
    targetType: 'track' | 'playlist',
    position: 'above' | 'below'
  ): void {
    const favorites = this.libraryManager.getOrderedFavorites();
    const draggedIndex = favorites.findIndex(f => f.id === draggedId && f.type === draggedType);
    const targetIndex = favorites.findIndex(f => f.id === targetId && f.type === targetType);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const [draggedItem] = favorites.splice(draggedIndex, 1);
    // After splice, target shifted if dragged was before it
    let insertIndex: number;
    if (position === 'above') {
      insertIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    } else {
      insertIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
    }
    // Clamp to valid range after removal
    insertIndex = Math.max(0, Math.min(insertIndex, favorites.length));
    favorites.splice(insertIndex, 0, draggedItem);

    this.libraryManager.reorderFavorites(favorites);
    this.requestRender();
    Logger.debug(`[SoundMixerApp] Reordered favorite ${draggedId} to position ${insertIndex} (${position})`);
  }

  private handleQueueReorder(draggedQueueId: string, targetQueueId: string, position: 'above' | 'below'): void {
    const items = this.queueManager.getItems();
    const draggedIndex = items.findIndex(i => i.id === draggedQueueId);
    const targetIndex = items.findIndex(i => i.id === targetQueueId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Account for splice behavior: removing an item before the target shifts indices.
    // After splice(draggedIndex, 1), inserting at newIndex puts the item at:
    //   - newIndex in the post-removal array
    //   - If draggedIndex < targetIndex: effective original position = newIndex + 1
    //   - If draggedIndex > targetIndex: effective original position = newIndex
    let newIndex: number;
    if (position === 'above') {
      // Place before target
      newIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    } else {
      // Place after target
      newIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
    }

    this.queueManager.moveItem(draggedQueueId, newIndex);
    Logger.debug(`[SoundMixerApp] Reordered queue item ${draggedQueueId} to position ${newIndex} (${position} target ${targetIndex})`);
  }

  // ─────────────────────────────────────────────────────────────
  // Playlist Toggle
  // ─────────────────────────────────────────────────────────────

  private onTogglePlaylist(event: JQuery.ClickEvent): void {
    event.preventDefault();
    const $playlist = $(event.currentTarget).closest('.ase-queue-playlist');
    const playlistId = $playlist.data('playlist-id') as string | null;

    // Handle Ungrouped (null/undefined) vs actual playlist IDs
    if (playlistId === null || playlistId === undefined || playlistId === '') {
      // Toggle Ungrouped
      this.ungroupedCollapsed = !this.ungroupedCollapsed;
    } else {
      // Toggle normal playlist
      if (this.collapsedPlaylists.has(playlistId)) {
        this.collapsedPlaylists.delete(playlistId);
      } else {
        this.collapsedPlaylists.add(playlistId);
      }
    }

    // Re-render to apply visual changes via Handlebars template
    // This ensures tracks are shown/hidden based on their current state
    this.requestRender();
  }

  // ─────────────────────────────────────────────────────────────
  // Playlist Header Controls
  // ─────────────────────────────────────────────────────────────

  private getPlaylistHeaderInfo(event: JQuery.ClickEvent): { playlistId: string | null, $playlist: JQuery } | null {
    event.preventDefault();
    event.stopPropagation();
    const $playlist = $(event.currentTarget).closest('.ase-queue-playlist');
    const rawId = $playlist.data('playlist-id');
    const playlistId = (rawId === undefined || rawId === null || rawId === '') ? null : String(rawId);
    return { playlistId, $playlist };
  }

  private getQueueItemsForGroup(playlistId: string | null): QueueItem[] {
    return this.queueManager.getItems().filter(item => {
      const itemPlaylistId = item.playlistId ?? null;
      return itemPlaylistId === playlistId;
    });
  }

  private async onPlayPlaylistHeader(event: JQuery.ClickEvent): Promise<void> {
    const info = this.getPlaylistHeaderInfo(event);
    if (!info) return;
    const { playlistId } = info;

    const groupItems = this.getQueueItemsForGroup(playlistId);
    if (!groupItems.length) return;

    // Check if any tracks are paused — resume all paused
    const pausedItems = groupItems.filter(item => {
      const player = this.engine.getTrack(item.libraryItemId);
      return player?.state === 'paused';
    });

    if (pausedItems.length > 0) {
      // Resume all paused tracks
      for (const item of pausedItems) {
        const context: PlaybackContext = playlistId
          ? { type: 'playlist', id: playlistId, playbackMode: this.libraryManager.playlists.getPlaylist(playlistId)?.playbackMode || 'loop' }
          : { type: 'track', playbackMode: this.libraryManager.getItem(item.libraryItemId)?.playbackMode || 'loop' };
        await this.playTrack(item.libraryItemId, context);
      }
    } else {
      // Nothing paused — play from beginning (first track)
      const firstItem = groupItems[0];
      const context: PlaybackContext = playlistId
        ? { type: 'playlist', id: playlistId, playbackMode: this.libraryManager.playlists.getPlaylist(playlistId)?.playbackMode || 'loop' }
        : { type: 'track', playbackMode: this.libraryManager.getItem(firstItem.libraryItemId)?.playbackMode || 'loop' };
      await this.playTrack(firstItem.libraryItemId, context);
    }
    this.requestRender();
  }

  private onPausePlaylistHeader(event: JQuery.ClickEvent): void {
    const info = this.getPlaylistHeaderInfo(event);
    if (!info) return;
    const { playlistId } = info;

    const groupItems = this.getQueueItemsForGroup(playlistId);
    for (const item of groupItems) {
      const player = this.engine.getTrack(item.libraryItemId);
      if (player?.state === 'playing') {
        this.pauseTrack(item.libraryItemId);
      }
    }
    this.requestRender();
  }

  private onStopPlaylistHeader(event: JQuery.ClickEvent): void {
    const info = this.getPlaylistHeaderInfo(event);
    if (!info) return;
    const { playlistId } = info;

    const groupItems = this.getQueueItemsForGroup(playlistId);
    for (const item of groupItems) {
      const player = this.engine.getTrack(item.libraryItemId);
      if (player?.state === 'playing' || player?.state === 'paused') {
        this.stopTrack(item.libraryItemId);
      }
    }
    this.requestRender();
  }

  private onPlaylistModeClick(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const btn = $(event.currentTarget);
    const playlistId = btn.data('playlist-id') as string;
    if (!playlistId) return;

    const playlist = this.libraryManager.playlists.getPlaylist(playlistId);
    if (!playlist) return;

    const modes: { label: string, value: string, icon: string }[] = [
      { label: 'Loop (Default)', value: 'loop', icon: 'fa-repeat' },
      { label: 'Linear', value: 'linear', icon: 'fa-arrow-right' },
      { label: 'Random', value: 'random', icon: 'fa-shuffle' }
    ];

    this.showModeContextMenu(event, modes, (mode) => {
      this.libraryManager.playlists.updatePlaylist(playlistId, { playbackMode: mode as any });
      this.requestRender();
    });
  }

  private onRemovePlaylistFromQueue(event: JQuery.ClickEvent): void {
    const info = this.getPlaylistHeaderInfo(event);
    if (!info) return;
    const { playlistId } = info;

    const groupItems = this.getQueueItemsForGroup(playlistId);

    // Stop all tracks first, then remove from queue
    for (const item of groupItems) {
      const player = this.engine.getTrack(item.libraryItemId);
      if (player?.state === 'playing' || player?.state === 'paused') {
        this.stopTrack(item.libraryItemId);
      }
      this.queueManager.removeItem(item.id);
    }
    this.requestRender();
  }

  // ─────────────────────────────────────────────────────────────
  // Track Controls
  // ─────────────────────────────────────────────────────────────

  private onSeek(event: JQuery.TriggeredEvent): void {
    const $track = $(event.currentTarget).closest('.ase-queue-track');
    const itemId = $track.data('item-id') as string;
    const value = parseFloat($(event.currentTarget).val() as string);

    const player = this.engine.getTrack(itemId);
    if (player) {
      const seekTime = (value / 100) * player.getDuration();
      this.engine.seekTrack(itemId, seekTime);

      // Throttled sync for socket
      if (this.socket.syncEnabled) {
        if (!this.seekThrottleTimers.has(itemId)) {
          this.seekThrottleTimers.set(itemId, setTimeout(() => {
            this.seekThrottleTimers.delete(itemId);
            const currentPlayer = this.engine.getTrack(itemId);
            if (currentPlayer) {
              this.socket.broadcastTrackSeek(itemId, currentPlayer.getCurrentTime(), currentPlayer.state === 'playing');
            }
          }, SoundMixerApp.THROTTLE_MS));
        }
      }
    }
  }

  private onVolumeChange(event: JQuery.TriggeredEvent): void {
    const $track = $(event.currentTarget).closest('.ase-queue-track');
    const itemId = $track.data('item-id') as string;
    const value = parseInt($(event.currentTarget).val() as string, 10);
    const volume = value / 100;

    // Update engine volume
    this.engine.setTrackVolume(itemId, volume);

    // Throttled sync for socket
    if (this.socket.syncEnabled) {
      if (!this.volumeThrottleTimers.has(itemId)) {
        this.volumeThrottleTimers.set(itemId, setTimeout(() => {
          this.volumeThrottleTimers.delete(itemId);
          const currentPlayer = this.engine.getTrack(itemId);
          if (currentPlayer) {
            this.socket.broadcastTrackVolume(itemId, currentPlayer.volume);
          }
        }, SoundMixerApp.THROTTLE_MS));
      }
    }

    // Update display
    $track.find('.ase-volume-value').text(`${value}%`);
  }

  // ─────────────────────────────────────────────────────────────
  // Playback Core Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Воспроизвести трек с опциональным контекстом
   * @param itemId - ID трека из библиотеки
   * @param context - Контекст воспроизведения (playlist, track, queue)
   */
  private async playTrack(itemId: string, context?: PlaybackContext): Promise<void> {
    const libraryItem = this.libraryManager.getItem(itemId);
    if (!libraryItem) {
      Logger.warn('Track not found in library:', itemId);
      return;
    }

    let player = this.engine.getTrack(itemId);

    // If player exists and is paused, resume from current position
    if (player && player.state === 'paused') {
      const offset = player.getCurrentTime();
      await this.engine.playTrack(itemId, offset, context);

      if (this.socket.syncEnabled) {
        this.socket.broadcastTrackPlay(itemId, offset);
      }
      return;
    }

    // Create track if not exists
    if (!player) {
      player = await this.engine.createTrack({
        id: itemId,
        url: libraryItem.url,
        group: libraryItem.group,
        volume: 1,
      });
    }

    // Создать контекст, если не передан
    const playbackContext: PlaybackContext = context || {
      type: 'track',
      playbackMode: libraryItem.playbackMode
    };

    await this.engine.playTrack(itemId, 0, playbackContext);

    // Sync if enabled
    if (this.socket.syncEnabled) {
      this.socket.broadcastTrackPlay(itemId, 0);
    }
  }

  private pauseTrack(itemId: string): void {
    const player = this.engine.getTrack(itemId);
    this.engine.pauseTrack(itemId);

    if (this.socket.syncEnabled && player) {
      this.socket.broadcastTrackPause(itemId, player.getCurrentTime());
    }
  }

  private stopTrack(itemId: string): void {
    this.engine.stopTrack(itemId);

    if (this.socket.syncEnabled) {
      this.socket.broadcastTrackStop(itemId);
    }
  }

  /**
   * Воспроизвести плейлист (запускает первый трек с контекстом плейлиста)
   * @param playlistId - ID плейлиста
   */
  private async playPlaylist(playlistId: string): Promise<void> {
    const playlist = this.libraryManager.playlists.getPlaylist(playlistId);
    if (!playlist) {
      Logger.warn('Playlist not found:', playlistId);
      return;
    }

    const tracks = this.libraryManager.playlists.getPlaylistTracks(playlistId);
    if (!tracks.length) {
      Logger.warn('Playlist is empty:', playlist.name);
      return;
    }

    // Создать контекст плейлиста
    const context: PlaybackContext = {
      type: 'playlist',
      id: playlistId,
      playbackMode: playlist.playbackMode
    };

    // Play first track with playlist context
    const firstTrack = tracks[0];
    await this.playTrack(firstTrack.libraryItemId, context);
  }

  private stopPlaylist(playlistId: string): void {
    const tracks = this.libraryManager.playlists.getPlaylistTracks(playlistId);
    for (const track of tracks) {
      this.stopTrack(track.libraryItemId);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Real-time Updates
  // ─────────────────────────────────────────────────────────────

  private startUpdates(): void {
    if (this.updateInterval) return;
    this.updateInterval = setInterval(() => this.updateTrackDisplays(), 100);
  }

  stopUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Full cleanup: stops updates, clears throttle timers, removes all event subscriptions.
   * Called when the parent window closes.
   */
  dispose(): void {
    this.stopUpdates();

    // Clear all throttle timers
    for (const timer of this.seekThrottleTimers.values()) {
      clearTimeout(timer);
    }
    this.seekThrottleTimers.clear();

    for (const timer of this.volumeThrottleTimers.values()) {
      clearTimeout(timer);
    }
    this.volumeThrottleTimers.clear();

    // Remove event subscriptions
    this.queueManager.off('change', this._onQueueChangeBound);
    this.engine.off('trackEnded', this._onTrackEndedBound);

    // Remove Foundry hooks
    if (this._hookFavoritesId) {
      Hooks.off('ase.favoritesChanged' as any, this._hookFavoritesId);
    }
    if (this._hookAutoSwitchId) {
      Hooks.off('ase.trackAutoSwitched' as any, this._hookAutoSwitchId);
    }

    this.html = null;
    Logger.debug('[SoundMixerApp] Disposed');
  }

  private updateTrackDisplays(): void {
    if (!this.html) return;

    const playLabel = game.i18n?.localize?.('ASE.Play') ?? 'Play';
    const pauseLabel = game.i18n?.localize?.('ASE.Pause') ?? 'Pause';
    const pauseAllLabel = game.i18n?.localize?.('ASE.UI.Tooltip.PauseAll') ?? 'Pause All';
    const tracksLabel = game.i18n?.localize?.('ASE.UI.Tracks') ?? 'tracks';

    this.html.find('.ase-queue-track').each((_, el) => {
      const $track = $(el);
      const itemId = $track.data('item-id') as string;
      const player = this.engine.getTrack(itemId);

      if (player) {
        const currentTime = player.getCurrentTime();
        const duration = player.getDuration();
        const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

        // Update progress bar
        $track.find('.progress-fill').css('width', `${progress}%`);
        $track.find('.seek-slider').val(progress);

        // Update timer
        $track.find('.track-timer').text(`${formatTime(currentTime)} / ${formatTime(duration)}`);

        // Update state classes and play/pause button
        $track.removeClass('is-playing is-paused');
        const $playPauseBtn = $track.find('[data-action="play-queue"], [data-action="pause-queue"]');
        const $playPauseIcon = $playPauseBtn.find('i');

        if (player.state === 'playing') {
          $track.addClass('is-playing');
          $playPauseIcon.removeClass('fa-play').addClass('fa-pause');
          $playPauseBtn.attr('data-action', 'pause-queue').attr('title', pauseLabel);
        } else if (player.state === 'paused') {
          $track.addClass('is-paused');
          $playPauseIcon.removeClass('fa-pause').addClass('fa-play');
          $playPauseBtn.attr('data-action', 'play-queue').attr('title', playLabel);
        } else {
          $playPauseIcon.removeClass('fa-pause').addClass('fa-play');
          $playPauseBtn.attr('data-action', 'play-queue').attr('title', playLabel);
        }
      }
    });

    // Update playlist header states (play/pause button + track counts)
    this.html.find('.ase-queue-playlist').each((_, el) => {
      const $playlist = $(el);
      const $tracks = $playlist.find('.ase-queue-track');
      let activeCount = 0;
      let hasPlaying = false;

      $tracks.each((_, trackEl) => {
        const $track = $(trackEl);
        const itemId = $track.data('item-id') as string;
        const player = this.engine.getTrack(itemId);
        if (player?.state === 'playing') {
          activeCount++;
          hasPlaying = true;
        } else if (player?.state === 'paused') {
          activeCount++;
        }
      });

      // Update track count display
      const totalCount = $tracks.length;
      $playlist.find('.ase-playlist-count').text(`(${activeCount}/${totalCount} ${tracksLabel})`);

      // Update play/pause button on header
      const $headerBtn = $playlist.find('.ase-playlist-header-controls').find('[data-action="play-playlist"], [data-action="pause-playlist"]');
      const $headerIcon = $headerBtn.find('i');

      if (hasPlaying) {
        $headerIcon.removeClass('fa-play').addClass('fa-pause');
        $headerBtn.attr('data-action', 'pause-playlist').attr('title', pauseAllLabel);
      } else {
        $headerIcon.removeClass('fa-pause').addClass('fa-play');
        $headerBtn.attr('data-action', 'play-playlist').attr('title', playLabel);
      }
    });

    // Update favorites play/pause button state
    this.html.find('.ase-favorite-item').each((_, el) => {
      const $fav = $(el);
      const favId = $fav.data('favorite-id') as string;
      const favType = $fav.data('favorite-type') as string;

      let isPlaying = false;
      let isPaused = false;

      if (favType === 'track') {
        const player = this.engine.getTrack(favId);
        isPlaying = player?.state === 'playing';
        isPaused = player?.state === 'paused';
      } else {
        // Playlist: check all tracks
        const tracks = this.libraryManager.playlists.getPlaylistTracks(favId);
        for (const pt of tracks) {
          const player = this.engine.getTrack(pt.libraryItemId);
          if (player?.state === 'playing') isPlaying = true;
          if (player?.state === 'paused') isPaused = true;
        }
        // Only show paused if nothing is playing
        if (isPlaying) isPaused = false;
      }

      // Update play/pause button
      const $btn = $fav.find('[data-action="play-favorite"], [data-action="pause-favorite"]');
      const $icon = $btn.find('i').length ? $btn.find('i') : $btn;

      if (isPlaying) {
        $fav.removeClass('is-paused').addClass('is-playing');
        if ($icon.is('i')) {
          $icon.removeClass('fa-play').addClass('fa-pause');
        } else {
          $btn.removeClass('fa-play').addClass('fa-pause');
        }
        $btn.attr('data-action', 'pause-favorite').attr('title', pauseLabel);
      } else if (isPaused) {
        $fav.removeClass('is-playing').addClass('is-paused');
        if ($icon.is('i')) {
          $icon.removeClass('fa-pause').addClass('fa-play');
        } else {
          $btn.removeClass('fa-pause').addClass('fa-play');
        }
        $btn.attr('data-action', 'play-favorite').attr('title', playLabel);
      } else {
        $fav.removeClass('is-playing is-paused');
        if ($icon.is('i')) {
          $icon.removeClass('fa-pause').addClass('fa-play');
        } else {
          $btn.removeClass('fa-pause').addClass('fa-play');
        }
        $btn.attr('data-action', 'play-favorite').attr('title', playLabel);
      }
    });
  }

  private onQueueChange(): void {
    Logger.debug('Queue changed, mixer should refresh');
    this.requestRender();
  }

  private onTrackStateChange(): void {
    Logger.debug('[SoundMixerApp] Track state changed, re-rendering mixer');
    this.requestRender();
  }

  private requestRender(): void {
    if (this.renderParent) {
      this.renderParent();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Effect Handlers
  // ─────────────────────────────────────────────────────────────

  private onToggleChannelEffects(event: JQuery.ClickEvent): void {
    event.preventDefault();
    const btn = $(event.currentTarget);
    const channel = btn.data('channel') as TrackGroup;

    // If button is active, it means effects are ON (not bypassed).
    // Clicking it should turn them OFF (bypass = true).
    const isCurrentlyActive = btn.hasClass('active');
    const shouldBypass = isCurrentlyActive;

    this.engine.toggleChainBypass(channel, shouldBypass);
    this.socket.broadcastFullState();
    this.requestRender();
  }

  private onToggleEffect(event: JQuery.ClickEvent): void {
    event.preventDefault();
    const $btn = $(event.currentTarget);
    const effectType = $btn.data('effect-id') as EffectType;

    const wasEnabled = $btn.hasClass('active');
    const newState = !wasEnabled;

    // Toggle on ALL channels simultaneously
    const channels: TrackGroup[] = ['music', 'ambience', 'sfx'];
    for (const channel of channels) {
      this.engine.setChainEffectEnabled(channel, effectType, newState);
      this.socket.broadcastEffectEnabled(channel, effectType, newState);
    }

    $btn.toggleClass('active', newState);
    Logger.info(`Effect ${effectType} ${newState ? 'enabled' : 'disabled'} on all channels`);
  }

  // ─────────────────────────────────────────────────────────────
  // RAF Processor for Drag Events
  // ─────────────────────────────────────────────────────────────

  private _processDragUpdate(html: JQuery, selector: string): void {
    this._rafId = null; // Reset ID so new frames can be requested

    if (!this._pendingDragUpdate) return;

    const { target, position } = this._pendingDragUpdate;

    // Avoid redundant DOM updates
    if (this._dragTarget === target && this._dragPosition === position) {
      return;
    }

    // Apply update
    this._dragTarget = target;
    this._dragPosition = position;

    // Clean all
    html.find(selector).removeClass('drag-above drag-below drag-over');

    // Apply new class
    $(target).addClass(position === 'above' ? 'drag-above' : 'drag-below');
  }
}
