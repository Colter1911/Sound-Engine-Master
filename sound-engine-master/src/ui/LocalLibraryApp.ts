import type { LibraryItem, Playlist } from '@t/library';
import type { TrackGroup } from '@t/audio';
import { LibraryManager } from '@lib/LibraryManager';
import { Logger } from '@utils/logger';
import { formatTime } from '@utils/time';

const MODULE_ID = 'sound-engine-master';

interface FilterState {
  searchQuery: string;
  selectedChannels: Set<TrackGroup>;
  selectedPlaylistId: string | null;
  selectedTags: Set<string>;
  sortBy: 'name-asc' | 'name-desc' | 'date-asc' | 'date-desc' | 'duration-asc' | 'duration-desc' | 'playable';
}

interface LibraryData {
  items: LibraryItemViewData[];
  playlists: PlaylistViewData[];
  favorites: FavoriteViewData[];
  tags: TagViewData[];
  stats: {
    totalItems: number;
    favoriteItems: number;
    playlists: number;
    tagCount: number;
  };
  searchQuery: string;
  filters: {
    music: boolean;
    ambience: boolean;
    sfx: boolean;
  };
  selectedPlaylistId: string | null;
  sortBy: string;
  hasActiveFilters: boolean;
  sortOptions?: Array<{ value: string; label: string; }>; // Added for UI dropdown
}

interface TagViewData {
  name: string;
  value: string;
  selected: boolean;
}

interface LibraryItemViewData {
  id: string;
  name: string;
  url: string;
  duration: string;
  durationFormatted: string;
  durationSeconds: number;
  tags: string[];
  favorite: boolean;
  group: string;
  inQueue: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  playbackMode?: string;
}

interface PlaylistViewData {
  id: string;
  name: string;
  itemCount: number;
  trackCount: number; // Alias for template
  favorite: boolean;
  inQueue: boolean;
  selected?: boolean;
  playbackMode?: string;
}

interface FavoriteViewData {
  id: string;
  name: string;
  type: 'track' | 'playlist';
  group?: string; // music/ambience/sfx for tracks
  inQueue?: boolean;
}

export class LocalLibraryApp extends Application {
  private library: LibraryManager;
  private filterState: FilterState;

  static override get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'local-library',
      template: 'modules/sound-engine-master/templates/library.hbs',
      title: 'ASE.UI.Panel.SoundLibrary',
      width: 1100,
      height: 700,
      classes: ['sound-engine-master', 'library'],
      resizable: true,
      tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: 'library' }]
    });
  }

  private parentApp: any; // Using any to avoid circular import issues for now, or use interface
  private _queueListener: ((data: any) => void) | null = null;
  private _listenersInitialized = false; // Track if we've initialized delegated listeners
  private _renderDebounceTimer: number | null = null; // Debounce timer for renders

  constructor(library: LibraryManager, parentApp: any, options = {}) {
    super(options);
    this.library = library;
    this.parentApp = parentApp;
    this.filterState = {
      searchQuery: '',
      selectedChannels: new Set(['music', 'ambience', 'sfx']),
      selectedPlaylistId: null,
      selectedTags: new Set(),
      // Default sort
      sortBy: 'date-desc'
    } as any;
  }

  // Override render to delegate to main app
  override render(force?: boolean, options?: any): any {
    // Background update: Trigger parent app re-render
    if (options?.renderContext === 'queue-update') {
      if (this.parentApp && typeof this.parentApp.render === 'function') {
        this.parentApp.captureScroll(); // Capture before background update
        return this.parentApp.render({ parts: ['main'] });
      }
    }

    // Default behavior: Delegate to openPanel (likely focuses tab)
    if (window.ASE?.openPanel) {
      // openPanel calls render, so we should capture if we are already open
      if (this.parentApp) {
        if (options?.resetScroll) {
          this.parentApp.resetScroll('library');
        } else {
          this.parentApp.captureScroll();
        }
      }
      window.ASE.openPanel('library', true);
      return;
    }
    return super.render(force, options);
  }

  override async close(options?: any): Promise<void> {
    // Clean up queue listener
    if (this._queueListener && window.ASE?.queue) {
      window.ASE.queue.off('change', this._queueListener);
      this._queueListener = null;
    }

    // Clean up debounce timer
    if (this._renderDebounceTimer) {
      clearTimeout(this._renderDebounceTimer);
      this._renderDebounceTimer = null;
    }

    // Clean up global delegated event handler
    if (this._listenersInitialized) {
      $(document).off('mousedown.ase-lib-global');
      this._listenersInitialized = false;
    }

    return super.close(options);
  }

  private localize(key: string, fallback?: string): string {
    return game.i18n?.localize?.(key) ?? fallback ?? key;
  }

  private format(key: string, data: Record<string, unknown>, fallback?: string): string {
    return game.i18n?.format?.(key, data as Record<string, string>) ?? fallback ?? key;
  }

  private notifyInfo(message: string, showPopup: boolean = false): void {
    if (!showPopup) return;
    ui.notifications?.info(message);
  }

  private notifyWarn(message: string, showPopup: boolean = false): void {
    if (!showPopup) return;
    ui.notifications?.warn(message);
  }

  private notifyError(message: string, showPopup: boolean = false): void {
    if (!showPopup) return;
    ui.notifications?.error(message);
  }

  private openStyledDialog(data: any, options: any = {}): Dialog {
    const mergedOptions = foundry.utils.mergeObject({
      width: 460,
      resizable: false,
      height: 'auto',
      classes: ['ase-dialog-window']
    }, options);

    const classes = Array.isArray(mergedOptions.classes) ? mergedOptions.classes : [];
    if (!classes.includes('ase-dialog-window')) {
      classes.push('ase-dialog-window');
    }
    mergedOptions.classes = classes;

    const dialog = new Dialog(data, mergedOptions);
    dialog.render(true);

    const applyDialogSkin = () => {
      const appId = String((dialog as any).appId ?? '');
      const byAppId = appId ? $(`.app.window-app[data-appid="${appId}"]`) : $();

      const element = dialog.element as JQuery | null | undefined;
      const byElement = element?.length
        ? (element.hasClass('app') ? element : element.closest('.app.window-app'))
        : $();

      const allRoots = byAppId.add(byElement);
      if (!allRoots.length) return;

      allRoots.addClass('ase-dialog-window');
    };

    applyDialogSkin();
    setTimeout(applyDialogSkin, 0);

    return dialog;
  }

  private confirmStyledDialog(title: string, content: string, defaultButton: 'confirm' | 'cancel' = 'cancel'): Promise<boolean> {
    return new Promise((resolve) => {
      this.openStyledDialog({
        title,
        content,
        buttons: {
          confirm: {
            icon: '<i class="fas fa-check"></i>',
            label: this.localize('ASE.UI.Actions.Confirm', 'Confirm'),
            callback: () => resolve(true)
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize('ASE.UI.Actions.Cancel', 'Cancel'),
            callback: () => resolve(false)
          }
        },
        default: defaultButton,
        close: () => resolve(false)
      });
    });
  }


  override getData(): LibraryData {
    let items = this.library.getAllItems();
    const playlists = this.library.playlists.getAllPlaylists();
    const allTags = this.library.getAllTags();

    const stats = this.library.getStats();


    // Trigger background scan for missing durations (run once per session)
    this.library.scanMissingDurations().then(() => {
      // If items were updated, we might want to re-render, but usually scheduleSave will trigger an event? 
      // For now, we rely on the next interaction or auto-refresh if we implement signals.
      // Or we can force a render if updates happened. 
      // But scanMissingDurations is async and we don't await it here to avoid blocking UI.
    });

    // Apply filters
    items = this.applyFilters(items);

    // Apply sorting
    items = this.applySorting(items);

    // Build favorites list (tracks + playlists)
    // Use the ordered list from LibraryManager
    const orderedFavorites = this.library.getOrderedFavorites();

    const favorites: FavoriteViewData[] = orderedFavorites.map((entry): FavoriteViewData | null => {
      const inQueue = entry.type === 'track'
        ? (window.ASE?.queue?.hasItem(entry.id) ?? false)
        : (window.ASE?.queue?.getItems().some(q => q.playlistId === entry.id) ?? false);

      if (entry.type === 'track') {
        const item = this.library.getItem(entry.id);
        if (!item) return null; // Should be handled by getOrderedFavorites cleanup

        return {
          id: item.id,
          name: item.name,
          type: 'track' as const,
          group: this.inferGroupFromTags(item.tags),
          inQueue
        };
      } else {
        const playlist = this.library.playlists.getPlaylist(entry.id);
        if (!playlist) return null;

        return {
          id: playlist.id,
          name: playlist.name,
          type: 'playlist' as const,
          inQueue
        };
      }
    }).filter((f): f is FavoriteViewData => f !== null);

    // Build tags list with selection state, ensuring selected and recent tags are visible
    const tagSet = new Set(allTags);
    this.filterState.selectedTags.forEach(t => tagSet.add(t));

    const tags: TagViewData[] = Array.from(tagSet).sort().map(tag => {
      // Normalize: ensure no leading #
      const normalizedTag = tag.startsWith('#') ? tag.substring(1) : tag;
      const isSelected = this.filterState.selectedTags.has(tag) || this.filterState.selectedTags.has(normalizedTag);
      return {
        name: normalizedTag, // Display name (without #)
        value: normalizedTag, // Data value (also normalized for consistency)
        selected: isSelected
      };
    });

    // Build playlists with selection state
    const playlistsViewData = playlists.map(p => ({
      ...this.getPlaylistViewData(p),
      selected: p.id === this.filterState.selectedPlaylistId
    }));

    // Check if any filters are active (if NOT all channels are selected, or other filters exist)
    const allChannelsSelected = this.filterState.selectedChannels.size === 3; // Assuming 3 channels
    const hasActiveFilters = !!(
      !allChannelsSelected ||
      this.filterState.selectedPlaylistId ||
      this.filterState.selectedTags.size > 0
    );

    // Map items to view data (adds inQueue, durationFormatted, etc.)
    const itemsViewData = items.map(item => this.getItemViewData(item));

    return {
      items: itemsViewData,
      playlists: playlistsViewData,
      favorites,
      tags,
      stats: {
        totalItems: stats.totalItems,
        favoriteItems: stats.favoriteItems,
        playlists: stats.totalPlaylists,
        tagCount: stats.tagCount
      },
      searchQuery: this.filterState.searchQuery,
      filters: {
        music: this.filterState.selectedChannels.has('music'),
        ambience: this.filterState.selectedChannels.has('ambience'),
        sfx: this.filterState.selectedChannels.has('sfx')
      },
      selectedPlaylistId: this.filterState.selectedPlaylistId,
      sortBy: this.filterState.sortBy,
      hasActiveFilters,
      sortOptions: [
        { value: 'date-desc', label: game.i18n!.localize('ASE.UI.SortOption.DateDesc') },
        { value: 'date-asc', label: game.i18n!.localize('ASE.UI.SortOption.DateAsc') },
        { value: 'name-asc', label: game.i18n!.localize('ASE.UI.SortOption.NameAsc') },
        { value: 'name-desc', label: game.i18n!.localize('ASE.UI.SortOption.NameDesc') },
        { value: 'duration-asc', label: game.i18n!.localize('ASE.UI.SortOption.DurationAsc') },
        { value: 'duration-desc', label: game.i18n!.localize('ASE.UI.SortOption.DurationDesc') }
      ]
    };
  }

  private getPlaylistViewData(playlist: Playlist): PlaylistViewData {
    // Check if playlist is in queue
    const inQueue = window.ASE?.queue?.getItems().some(
      item => item.playlistId === playlist.id
    ) ?? false;

    return {
      id: playlist.id,
      name: playlist.name,
      itemCount: playlist.items.length,
      trackCount: playlist.items.length, // Alias for template
      favorite: playlist.favorite,
      inQueue,
      selected: false,
      playbackMode: playlist.playbackMode
    };
  }

  private getItemViewData(item: LibraryItem): LibraryItemViewData {
    const inQueue = window.ASE?.queue?.hasItem(item.id) ?? false;
    const durationFormatted = formatTime(item.duration);

    // Get playback state from AudioEngine
    const player = (window.ASE?.engine as any)?.getTrack?.(item.id);
    const isPlaying = player?.state === 'playing';
    const isPaused = player?.state === 'paused';

    return {
      id: item.id,
      name: item.name,
      url: item.url,
      duration: durationFormatted,
      durationFormatted,
      durationSeconds: item.duration,
      tags: item.tags,
      favorite: item.favorite,
      group: item.group || 'music',
      inQueue,
      isPlaying,
      isPaused,
      playbackMode: item.playbackMode
    };
  }

  private inferGroupFromTags(tags: string[]): string {
    // Try to infer group from tags if possible
    const lowerTags = tags.map(t => t.toLowerCase());
    if (lowerTags.some(t => t.includes('music'))) return 'music';
    if (lowerTags.some(t => t.includes('ambient') || t.includes('ambience'))) return 'ambience';
    if (lowerTags.some(t => t.includes('sfx') || t.includes('effect'))) return 'sfx';
    return 'music'; // default
  }

  // ─────────────────────────────────────────────────────────────
  // Filtering & Sorting
  // ─────────────────────────────────────────────────────────────

  private applyFilters(items: LibraryItem[]): LibraryItem[] {
    let filtered = items;

    // Search filter
    if (this.filterState.searchQuery) {
      const query = this.filterState.searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(query) ||
        item.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // Channel filter (OR logic: Show item if its group is in selectedChannels)
    // If no channels selected, show all items (default behavior)
    if (this.filterState.selectedChannels.size > 0) {
      filtered = filtered.filter(item => {
        const group = (item.group || 'music') as TrackGroup;
        return this.filterState.selectedChannels.has(group);
      });
    }
    // If no channels selected, show all items (don't filter)

    // Playlist filter
    if (this.filterState.selectedPlaylistId) {
      const playlist = this.library.playlists.getPlaylist(this.filterState.selectedPlaylistId);
      if (playlist) {
        const playlistItemIds = new Set(playlist.items.map(i => i.libraryItemId));
        filtered = filtered.filter(item => playlistItemIds.has(item.id));
      }
    }

    // Tags filter (AND logic - show items that have ALL selected tags)
    if (this.filterState.selectedTags.size > 0) {
      const selectedTagsArray = Array.from(this.filterState.selectedTags);
      filtered = filtered.filter(item =>
        selectedTagsArray.every(tag => item.tags.includes(tag))
      );
    }

    return filtered;
  }

  private applySorting(items: LibraryItem[]): LibraryItem[] {
    const sorted = [...items];

    switch (this.filterState.sortBy) {
      case 'playable': {
        // Sort by playback state: playing first, paused second, rest by date
        const viewDataCache = new Map<string, LibraryItemViewData>();
        for (const item of sorted) {
          viewDataCache.set(item.id, this.getItemViewData(item));
        }

        sorted.sort((a, b) => {
          const aData = viewDataCache.get(a.id)!;
          const bData = viewDataCache.get(b.id)!;

          // Priority: playing > paused > stopped
          const aPriority = aData.isPlaying ? 2 : (aData.isPaused ? 1 : 0);
          const bPriority = bData.isPlaying ? 2 : (bData.isPaused ? 1 : 0);

          if (aPriority !== bPriority) {
            return bPriority - aPriority; // Higher priority first
          }

          // If same state, sort by date (newest first)
          return b.addedAt - a.addedAt;
        });
        break;
      }
      case 'name-asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'date-asc':
        sorted.sort((a, b) => a.addedAt - b.addedAt);
        break;
      case 'date-desc':
        sorted.sort((a, b) => b.addedAt - a.addedAt);
        break;
      case 'duration-asc':
        sorted.sort((a, b) => a.duration - b.duration);
        break;
      case 'duration-desc':
        sorted.sort((a, b) => b.duration - a.duration);
        break;
    }

    return sorted;
  }

  override activateListeners(html: JQuery): void {
    super.activateListeners(html);

    // ═══════════════════════════════════════════════════════════════
    // CRITICAL: Remove ALL namespaced event listeners to prevent memory leaks
    // Using namespace ensures delegated handlers are also removed
    // ═══════════════════════════════════════════════════════════════
    html.off('.ase-library');

    // ═══════════════════════════════════════════════════════════════
    // Queue Change Listener - Register ONCE to update UI when queue changes
    // ═══════════════════════════════════════════════════════════════
    if (!this._queueListener && window.ASE?.queue) {
      this._queueListener = () => {
        // Debounce renders to prevent multiple rapid updates
        if (this._renderDebounceTimer) {
          clearTimeout(this._renderDebounceTimer);
        }
        this._renderDebounceTimer = window.setTimeout(() => {
          this._renderDebounceTimer = null;
          this.render(false, { renderContext: 'queue-update' });
        }, 50); // 50ms debounce
      };
      window.ASE.queue.on('change', this._queueListener);
    }

    // ═══════════════════════════════════════════════════════════════
    // GLOBAL delegated handlers - registered ONCE to prevent accumulation
    // ═══════════════════════════════════════════════════════════════
    if (!this._listenersInitialized) {
      $(document).off('mousedown.ase-lib-global'); // Clean up any previous global handlers
      $(document).on('mousedown.ase-lib-global', '#local-library [data-action]', (e) => {
        e.stopPropagation();
      });
      this._listenersInitialized = true;
    }

    // Toolbar actions
    html.find('[data-action="add-track"]').on('click.ase-library', this.onAddTrack.bind(this));
    // Listen for KeyDown (Enter) for search execution
    html.find('.ase-search-input').on('keydown.ase-library', this.onSearchKeydown.bind(this));
    // Listen for 'input' to manage X button visibility and auto-reset on empty
    html.find('.ase-search-input').on('input.ase-library', this.onSearchInput.bind(this));
    html.find('.ase-search-clear').on('click.ase-library', this.onClearSearch.bind(this));
    html.find('[data-action="filter-channel"]').on('click.ase-library', this._onFilterChannel.bind(this));
    html.find('[data-action="sort-change"]').on('change.ase-library', this.onChangeSort.bind(this));
    html.find('[data-action="clear-filters"]').on('click.ase-library', this.onClearFilters.bind(this));

    // Tag actions
    html.find('[data-action="toggle-tag"]').on('click.ase-library', this.onToggleTag.bind(this));
    html.find('[data-action="add-tag"]').on('click.ase-library', this.onAddTag.bind(this));

    // Track actions
    html.find('[data-action="play-track"]').on('click.ase-library', this.onPlayTrack.bind(this));
    html.find('[data-action="pause-track"]').on('click.ase-library', this.onPauseTrack.bind(this));
    html.find('[data-action="stop-track"]').on('click.ase-library', this.onStopTrack.bind(this));
    html.find('[data-action="add-to-queue"]').on('click.ase-library', this.onAddToQueue.bind(this));
    html.find('[data-action="toggle-favorite"]').on('click.ase-library', this.onToggleFavorite.bind(this));
    html.find('[data-action="add-to-playlist"]').on('click.ase-library', this.onAddToPlaylist.bind(this));
    html.find('[data-action="track-menu"]').on('click.ase-library', this.onTrackMenu.bind(this));

    // In-track tag management
    html.find('[data-action="add-tag-to-track"]').on('click.ase-library', this.onAddTagToTrack.bind(this));

    // Channel dropdown
    html.find('[data-action="channel-dropdown"]').on('click.ase-library', this.onChannelDropdown.bind(this));

    // Delete track
    html.find('[data-action="delete-track"]').on('click.ase-library', this.onDeleteTrack.bind(this));

    // Track context menu (right-click)
    html.find('.ase-track-player-item').on('contextmenu.ase-library', this.onTrackContext.bind(this));

    // Tag context menu on track (right-click on tag)
    html.find('.ase-track-tags .ase-tag').on('contextmenu.ase-library', this.onTrackTagContext.bind(this));

    // Playlist actions
    html.find('[data-action="select-playlist"]').on('click.ase-library', this.onSelectPlaylist.bind(this));
    html.find('[data-action="create-playlist"]').on('click.ase-library', this.onCreatePlaylist.bind(this));
    html.find('[data-action="toggle-playlist-favorite"]').on('click.ase-library', this.onTogglePlaylistFavorite.bind(this));
    html.find('[data-action="toggle-playlist-queue"]').on('click.ase-library', this.onTogglePlaylistQueue.bind(this));
    html.find('[data-action="play-playlist"]').on('click.ase-library', this.onPlayPlaylist.bind(this)); // New handler

    // Switch to direct binding for reliability
    html.find('[data-action="playlist-mode-dropdown"]').on('click.ase-library', this.onPlaylistModeClick.bind(this));
    html.find('[data-action="track-mode-dropdown"]').on('click.ase-library', this.onTrackModeClick.bind(this));

    // NOTE: Moved mousedown handler to global delegation above to prevent accumulation

    html.find('[data-action="playlist-menu"]').on('click.ase-library', this.onPlaylistMenu.bind(this));
    html.find('.ase-list-item[data-playlist-id]').on('contextmenu.ase-library', this.onPlaylistContext.bind(this));

    // Favorite actions
    html.find('[data-action="remove-from-favorites"]').on('click.ase-library', this.onRemoveFromFavorites.bind(this));
    html.find('[data-action="toggle-favorite-queue"]').on('click.ase-library', this.onToggleFavoriteQueue.bind(this));

    // Drag and drop
    this.setupDragAndDrop(html);
    this.setupFoundryDragDrop(html);

    // Track hover highlighting for playlists
    html.find('.ase-track-player-item').on('mouseenter.ase-library', (event: JQuery.MouseEnterEvent) => {
      const trackId = $(event.currentTarget).data('item-id');
      if (trackId) {
        this.highlightPlaylistsContainingTrack(trackId);
      }
    });

    html.find('.ase-track-player-item').on('mouseleave.ase-library', () => {
      this.clearPlaylistHighlights();
    });

    // Custom Context Menu for GLOBAL tags only (in top panel)
    html.find('.ase-tags-inline .ase-tag').on('contextmenu.ase-library', this.onTagContext.bind(this));

    Logger.debug('LocalLibraryApp listeners activated');
  }

  // ─────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────

  private async onAddTrack(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();

    const fp = new FilePicker({
      type: 'audio',
      callback: async (path: string) => {
        await this.addTrackFromPath(path);
      }
    });
    fp.render(true);
  }

  private async addTrackFromPath(path: string, group: TrackGroup = 'music'): Promise<void> {
    try {
      // Get currently selected tags
      const selectedTags = Array.from(this.filterState.selectedTags);

      const item = await this.library.addItem(path, undefined, group, selectedTags);
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(`Added to library: ${item.name}`, true);
    } catch (error) {
      Logger.error('Failed to add track to library:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.notifyError(`Failed to add track: ${errorMessage}`, true);
    }
  }

  private async onToggleFavorite(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const btn = $(event.currentTarget);
    const itemId = btn.closest('[data-item-id]').data('item-id') as string;

    try {
      // Optimistic UI update for instant feedback
      const icon = btn.find('i');
      if (icon.hasClass('far')) {
        icon.removeClass('far').addClass('fas active');
        btn.addClass('active');
      } else {
        icon.removeClass('fas active').addClass('far');
        btn.removeClass('active');
      }

      if (this.parentApp) this.parentApp.captureScroll();
      const isFavorite = this.library.toggleFavorite(itemId);

      // We still re-render to update the sidebar/state fully, but the button interaction felt instant
      this.render();
      this.notifyInfo(isFavorite ? 'Added to favorites' : 'Removed from favorites');
    } catch (error) {
      Logger.error('Failed to toggle favorite:', error);
      this.notifyError('Failed to update favorite status');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Playback Mode Handlers
  // ─────────────────────────────────────────────────────────────

  private onTrackModeClick(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const btn = $(event.currentTarget);
    // Support both direct data on icon (new) and wrapper (legacy fallback)
    let itemId = btn.data('item-id') as string;
    if (!itemId) {
      itemId = btn.closest('[data-item-id]').data('item-id') as string;
    }

    const item = this.library.getItem(itemId);
    if (!item) {
      Logger.warn(`Track mode clicked: item not found for ID ${itemId}`);
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
      this.library.updateItem(itemId, { playbackMode: mode as any });
      this.render();
    });
  }

  private onPlaylistModeClick(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    Logger.debug('Playlist Mode Clicked'); // Debug
    const btn = $(event.currentTarget);
    // Support both direct data on icon (new) and wrapper (legacy fallback)
    let playlistId = btn.data('playlist-id') as string;
    if (!playlistId) {
      playlistId = btn.closest('[data-playlist-id]').data('playlist-id') as string;
    }
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      Logger.warn(`Playlist Mode Clicked: Playlist not found for ID ${playlistId}`);
      return;
    }
    Logger.debug(`Playlist Mode Clicked: Found playlist ${playlist.name} (${playlist.id})`);

    const modes: { label: string, value: string, icon: string }[] = [
      { label: 'Loop (Default)', value: 'loop', icon: 'fa-repeat' },
      { label: 'Linear', value: 'linear', icon: 'fa-arrow-right' },
      { label: 'Random', value: 'random', icon: 'fa-shuffle' }
    ];

    this.showModeContextMenu(event, modes, (mode) => {
      this.library.playlists.updatePlaylist(playlistId, { playbackMode: mode as any });
      this.render();
    });
  }

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
      e.stopPropagation(); // prevent body click from firing immediately
      const val = $(e.currentTarget).data('value');
      Logger.debug(`Mode Selected: ${val}`);
      callback(val);
      menu.remove();
    });

    // Close on click outside
    setTimeout(() => {
      $('body').one('click', () => {
        Logger.debug('Mode Menu: Closed by outside click');
        menu.remove();
      });
    }, 10);
  }



  private async onPlayPlaylist(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const playlistId = $(event.currentTarget).closest('[data-playlist-id]').data('playlist-id') as string;
    const playlist = this.library.playlists.getPlaylist(playlistId);

    if (playlist && playlist.items.length > 0) {
      const queue = window.ASE?.queue;
      if (queue) {
        // Check if playlist items are already in queue
        // We get ALL items and filter by playlistId
        let playlistItemsInQueue = queue.getItems().filter(item => item.playlistId === playlistId);

        // If not in queue, add them
        if (playlistItemsInQueue.length === 0) {
          playlistItemsInQueue = queue.addPlaylist(playlistId, playlist.items);
        }

        // Determine start track logic
        if (playlistItemsInQueue.length > 0) {
          let startItem = playlistItemsInQueue[0];

          // Handle Random Start if mode is random
          if (playlist.playbackMode === 'random' && playlistItemsInQueue.length > 1) {
            const randomIndex = Math.floor(Math.random() * playlistItemsInQueue.length);
            startItem = playlistItemsInQueue[randomIndex];
          }

          // Play the track immediately
          const libItem = this.library.getItem(startItem.libraryItemId);
          if (libItem) {
            Logger.info(`Starting playlist playback: ${playlist.name} (Track: ${libItem.name})`);
            await (window.ASE.engine as any).playTrack(libItem.id, 0, { type: 'playlist', id: playlistId });
          }
        }

        this.notifyInfo(game.i18n!.format('ASE.UI.Notification.PlayingPlaylist', { name: playlist.name }));
        this.render();
      } else {
        Logger.warn('Queue Manager not available, playing first track directly');
        let trackToPlay = playlist.items[0];
        const libItem = this.library.getItem(trackToPlay.libraryItemId);
        if (libItem) {
          await (window.ASE.engine as any).playTrack(libItem.id, 0, { type: 'playlist', id: playlistId });
        }
      }
    } else {
      this.notifyWarn(game.i18n!.localize('ASE.UI.Warning.PlaylistIsEmpty'));
    }
  }




  // ─────────────────────────────────────────────────────────────
  // Playlist Event Handlers
  // ─────────────────────────────────────────────────────────────

  private async onCreatePlaylist(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();

    const name = await this.promptPlaylistName();
    if (!name) return;

    try {
      const playlist = this.library.playlists.createPlaylist(name);
      // Create playlist -> might want to scroll to it? Or keep position?
      // User: "actions in zone of tracks". Playlists are separate zone. 
      // But adding playlist shouldn't jump list to top? Let's persist.
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(`Created playlist: ${playlist.name}`);
    } catch (error) {
      Logger.error('Failed to create playlist:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.notifyError(`Failed to create playlist: ${errorMessage}`);
    }
  }

  private async onTogglePlaylistFavorite(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const playlistId = $(event.currentTarget).closest('[data-playlist-id]').data('playlist-id') as string;

    try {
      if (this.parentApp) this.parentApp.captureScroll();
      const isFavorite = this.library.playlists.togglePlaylistFavorite(playlistId);
      this.render();
      this.notifyInfo(isFavorite ? 'Added to favorites' : 'Removed from favorites');
    } catch (error) {
      Logger.error('Failed to toggle playlist favorite:', error);
      this.notifyError('Failed to update favorite status');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Toolbar Event Handlers
  // ─────────────────────────────────────────────────────────────

  private onSearchInput(event: JQuery.TriggeredEvent): void {
    const val = ($(event.currentTarget).val() as string || '');
    const trimmedVal = val.trim();

    // If field becomes empty and search was active, reset search
    if (!trimmedVal && this.filterState.searchQuery) {
      this.filterState.searchQuery = '';
      this.render(false, { resetScroll: true });
    }
  }

  private onSearchKeydown(event: JQuery.KeyDownEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      const query = ($(event.currentTarget).val() as string || '').trim().toLowerCase();
      if (this.filterState.searchQuery !== query) {
        this.filterState.searchQuery = query;
        this.render(false, { resetScroll: true });
      }
    }
  }

  private onClearSearch(event: JQuery.ClickEvent): void {
    event.preventDefault();
    this.filterState.searchQuery = '';
    const wrapper = $(event.currentTarget).closest('.ase-search-input-wrapper');
    wrapper.find('.ase-search-input').val('');
    wrapper.find('.ase-search-input').val('');
    this.render(false, { resetScroll: true }); // Re-render to show all items
  }

  private _onFilterChannel(event: JQuery.ClickEvent): void {
    event.preventDefault();
    const btn = $(event.currentTarget);
    const channel = btn.data('channel') as TrackGroup;

    // Toggle logic: If clicked, toggle it.
    if (this.filterState.selectedChannels.has(channel)) {
      this.filterState.selectedChannels.delete(channel);
      btn.removeClass('active');
    } else {
      this.filterState.selectedChannels.add(channel);
      btn.addClass('active');
    }

    // Pass true to force render because complex logic might need re-evaluation of the list
    // OR implement client-side hiding for this too if feeling brave. 
    // Given 3 checkboxes, re-render is safer to ensure correct combinatorics.
    // Given 3 checkboxes, re-render is safer to ensure correct combinatorics.
    this.render(false, { resetScroll: true });
    Logger.debug('Filter channel toggled:', channel, this.filterState.selectedChannels);
  }

  private onChangeSort(event: JQuery.ChangeEvent): void {
    const sortValue = $(event.currentTarget).val() as FilterState['sortBy'];
    this.filterState.sortBy = sortValue;
    this.render();
    Logger.debug('Sort changed:', sortValue);
  }

  private onClearFilters(event: JQuery.ClickEvent): void {
    event.preventDefault();

    // Reset all filters except channels (as requested: "clear button... resets all except sound channels")
    this.filterState.searchQuery = '';
    this.filterState.selectedPlaylistId = null;
    this.filterState.selectedTags.clear();

    // channels remain as is? "Kнопка clear... сбрасывает все фильтры кроме каналов звука"
    // "All Tracks" button usually means SHOW ALL. 
    // IF the button is named "All Tracks" (in template it is "Clear Filters" or similar?), let's verify.
    // Template says: <button ... data-action="clear-filters">All Tracks</button>
    // So YES, it should reset eveything relative to "viewing a slice", but the user EXPLICITLY said:
    // "except sound channels... they work separately".

    // So we DO NOT reset selectedChannels.

    this.render(false, { resetScroll: true });
    this.notifyInfo('Filters cleared (Channels preserved)');
  }

  // ─────────────────────────────────────────────────────────────
  // Tag Event Handlers
  // ─────────────────────────────────────────────────────────────

  private onToggleTag(event: JQuery.ClickEvent): void {
    event.preventDefault();
    // Use the right click context menu for edit/delete
    // Left click just toggles filter
    const tag = String($(event.currentTarget).data('tag')); // String() fixes numeric coercion

    if (this.filterState.selectedTags.has(tag)) {
      this.filterState.selectedTags.delete(tag);
    } else {
      this.filterState.selectedTags.add(tag);
    }

    this.render(false, { resetScroll: true });
  }

  private onTagContext(event: JQuery.ContextMenuEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const tag = String($(event.currentTarget).data('tag')); // String() fixes numeric coercion

    // Create a custom context menu appended to body to avoid clipping
    const menuHtml = `
      <div id="ase-custom-context-menu" style="position: fixed; z-index: 10000; background: #222; border: 1px solid #444; border-radius: 4px; padding: 5px 0;">
        <div class="ase-ctx-item" data-action="edit" style="padding: 5px 15px; cursor: pointer; color: white;">
            <i class="fas fa-edit" style="margin-right: 5px;"></i> Edit
        </div>
        <div class="ase-ctx-item" data-action="delete" style="padding: 5px 15px; cursor: pointer; color: #ff6666;">
            <i class="fas fa-trash" style="margin-right: 5px;"></i> Delete
        </div>
      </div>
    `;

    // Remove existing
    $('#ase-custom-context-menu').remove();

    const menu = $(menuHtml);
    $('body').append(menu);

    // Position
    menu.css({
      top: event.clientY,
      left: event.clientX
    });

    // Handlers
    menu.find('[data-action="edit"]').on('click', () => {
      this.renameTag(tag);
      menu.remove();
    });

    menu.find('[data-action="delete"]').on('click', () => {
      this.deleteTag(tag);
      menu.remove();
    });

    // Initial Hover effect
    menu.find('.ase-ctx-item').hover(
      function () { $(this).css('background', '#333'); },
      function () { $(this).css('background', 'transparent'); }
    );

    // Close on click elsewhere
    $(document).one('click', () => {
      menu.remove();
    });
  }

  private async onAddTag(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();

    const rawTagName = await this.promptTagName();
    if (!rawTagName) return;

    // Normalize: trim and remove leading # if user added it
    const tagName = rawTagName.trim().replace(/^#/, '');
    if (!tagName) return;

    // Add to selectedTags for immediate visual feedback
    this.filterState.selectedTags.add(tagName);

    // Add to library persistent tags
    this.library.addCustomTag(tagName);

    this.render();
    this.notifyInfo(
      this.format('ASE.UI.Notification.TagAdded', { tag: tagName }, `Tag "${tagName}" added.`)
    );
  }

  // Helper for Context Menu Callbacks to ensure `this` binding and argument passing
  private _onRenameTag(header: JQuery): void {
    const tag = header.data('tag');
    this.renameTag(tag);
  }

  private _onDeleteTag(header: JQuery): void {
    const tag = header.data('tag');
    this.deleteTag(tag);
  }

  // Correcting selector/listener activation for Context Menu if needed
  // Foundry ContextMenu usually works fine. If z-index issue, it's CSS.
  // We will force high z-index via CSS injection or ensure fixed position.
  // BUT: user said "Buttons don't work". 
  // This usually means the callback failed or `this` yielded undefined.
  // The inline arrow functions `() => this.renameTag(tag)` in `activateListeners` SHOULD be fine if `this` is correct.
  // Let's verify `activateListeners`.

  // ─────────────────────────────────────────────────────────────
  // Tag Management Logic
  // ─────────────────────────────────────────────────────────────

  private async renameTag(oldTag: string): Promise<void> {
    const newTag = await this.promptTagName(oldTag);
    if (!newTag || newTag === oldTag) return;

    // Use LibraryManager's method
    const count = this.library.renameTag(oldTag, newTag);

    // Also update filter state if selected
    if (this.filterState.selectedTags.has(oldTag)) {
      this.filterState.selectedTags.delete(oldTag);
      this.filterState.selectedTags.add(newTag);
    }

    if (count > 0) {
      // Renaming tag does not necessarily keep scroll unless it was a tag list interaction?
      // User said "zone of tracks with tracks". Tag list is separate. 
      // But renaming right from track context menu? Let's enabling it generally.
      // Actually user said "zone of tracks". Let's persist.
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(
        this.format('ASE.UI.Notification.TagRenamedOnTracks', { oldTag, newTag, count }, `Renamed tag "${oldTag}" to "${newTag}" on ${count} tracks.`)
      );
    }
  }

  private async deleteTag(tag: string): Promise<void> {
    const tagStr = String(tag); // Ensure string for numeric tags

    const confirm = await this.confirmStyledDialog(
      this.localize('ASE.UI.Dialog.DeleteTag.Title', 'Delete Tag'),
      `<p>${this.format('ASE.UI.Dialog.DeleteTag.ContentAllTracks', { tag: tagStr }, `Are you sure you want to delete tag "${tagStr}" from all tracks?`)}</p>`
    );
    if (!confirm) return;

    // Use LibraryManager's method
    const count = this.library.deleteTag(tagStr);

    // Remove from filter
    this.filterState.selectedTags.delete(tagStr);

    // Always re-render
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
    this.notifyInfo(
      count > 0
        ? this.format('ASE.UI.Notification.TagDeletedFromTracks', { tag: tagStr, count }, `Deleted tag "${tagStr}" from ${count} tracks.`)
        : this.format('ASE.UI.Notification.CustomTagDeleted', { tag: tagStr }, `Deleted custom tag "${tagStr}".`)
    );
  }

  private async promptTagName(current: string = ""): Promise<string | null> {
    return new Promise((resolve) => {
      const isRename = Boolean(current);
      this.openStyledDialog({
        title: this.localize(
          isRename ? 'ASE.UI.Dialog.RenameTag.Title' : 'ASE.UI.Dialog.NewTag.Title',
          isRename ? 'Rename Tag' : 'New Tag'
        ),
        content: `
          <form class="ase-dialog-form">
            <div class="form-group">
              <label>${this.localize('ASE.UI.Dialog.TagName.Label', 'Tag Name')}</label>
              <input type="text" id="tag-name" value="${current}" autofocus />
            </div>
          </form>
        `,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: this.localize('ASE.UI.Actions.Ok', 'OK'),
            callback: (html: JQuery) => resolve(html.find('#tag-name').val() as string)
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize('ASE.UI.Actions.Cancel', 'Cancel'),
            callback: () => resolve(null)
          }
        },
        default: 'ok',
        close: () => resolve(null)
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Track Event Handlers (Extended)
  // ─────────────────────────────────────────────────────────────

  private async onPlayTrack(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const itemId = $(event.currentTarget).data('item-id') as string;

    const item = this.library.getItem(itemId);
    if (!item) {
      Logger.warn('Track not found:', itemId);
      return;
    }

    const engine = window.ASE?.engine;
    const queue = window.ASE?.queue;

    if (!engine) {
      Logger.warn('Audio engine not available');
      return;
    }

    // Add to queue if not already there
    if (queue && !queue.hasItem(itemId)) {
      queue.addItem(itemId, {
        group: item.group,
        volume: 1
      });
    }

    // Get or create player (must exist BEFORE playTrack)
    let player = (engine as any).getTrack?.(itemId);
    if (!player) {
      player = await (engine as any).createTrack?.({
        id: itemId,
        url: item.url,
        group: item.group,
        volume: 1
      });
    }

    // Check if track is paused and get current position
    let offset = 0;
    if (player && player.state === 'paused') {
      offset = player.getCurrentTime();
    }

    // Determine context based on current view
    let context: any = { type: 'track' };
    if (this.filterState.selectedPlaylistId) {
      context = { type: 'playlist', id: this.filterState.selectedPlaylistId };
    }

    // Play the track
    await (engine as any).playTrack?.(itemId, offset, context);

    // Sync if enabled
    const socket = window.ASE?.socket;
    if (socket && socket.syncEnabled) {
      Logger.debug('LocalLibrary: Broadcasting Play for track', itemId);
      socket.broadcastTrackPlay(itemId, offset);
    }

    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }

  private onStopTrack(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const itemId = $(event.currentTarget).data('item-id') as string;

    Logger.debug('Stop track:', itemId);

    // Stop the track
    window.ASE.engine?.stopTrack(itemId);

    // Sync if enabled
    const socket = window.ASE?.socket;
    if (socket && socket.syncEnabled) {
      socket.broadcastTrackStop(itemId);
    }

    // Remove from queue
    if (window.ASE?.queue) {
      window.ASE.queue.removeByLibraryItemId(itemId);
    }

    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }

  private onPauseTrack(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const itemId = $(event.currentTarget).data('item-id') as string;

    // Get current time before pausing for sync
    const engine = window.ASE?.engine;
    const player = (engine as any)?.getTrack?.(itemId);
    const currentTime = player?.getCurrentTime() ?? 0;

    engine?.pauseTrack(itemId);

    // Sync if enabled
    const socket = window.ASE?.socket;
    if (socket && socket.syncEnabled) {
      socket.broadcastTrackPause(itemId, currentTime);
    }

    if (this.parentApp) this.parentApp.captureScroll();
    this.render(); // Update UI and bottom panel indicators
  }

  private onAddToQueue(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const itemId = String($(event.currentTarget).data('item-id'));

    if (!window.ASE?.queue) {
      Logger.warn('Queue manager not available');
      return;
    }

    // Get item details to determine group
    const item = this.library.getItem(itemId);
    if (!item) {
      Logger.warn('Item not found:', itemId);
      return;
    }

    // Toggle: if already in queue, remove; otherwise add
    if (window.ASE.queue.hasItem(itemId)) {
      window.ASE.queue.removeByLibraryItemId(itemId);
      Logger.debug('Removed from queue:', itemId);
      this.notifyInfo(`"${item.name}" removed from queue`);
    } else {
      window.ASE.queue.addItem(itemId, {
        group: item.group || 'music',
        volume: 1
      });
      Logger.debug('Added to queue:', itemId);
      this.notifyInfo(`"${item.name}" added to queue`);
    }

    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }

  private async onAddTagToTrack(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const itemId = $(event.currentTarget).data('item-id') as string;
    Logger.debug('Add tag to track:', itemId);

    // Open tag editor dialog
    this.showTagEditor(itemId);
  }

  private async onAddToPlaylist(event: JQuery.ClickEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const itemId = $(event.currentTarget).data('item-id') as string;
    const item = this.library.getItem(itemId);

    if (!item) {
      this.notifyError('Track not found');
      return;
    }

    const playlists = this.library.playlists.getAllPlaylists();
    if (playlists.length === 0) {
      this.notifyWarn('No playlists available. Create one first.');
      return;
    }

    // Show playlist selection dialog
    const selectedPlaylistId = await this.promptPlaylistSelection(playlists);
    if (!selectedPlaylistId) return;

    try {
      const group = this.inferGroupFromTags(item.tags) as TrackGroup;
      this.library.playlists.addTrackToPlaylist(selectedPlaylistId, itemId, group);
      this.render();
      this.notifyInfo(`Added "${item.name}" to playlist`);
    } catch (error) {
      Logger.error('Failed to add track to playlist:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.notifyError(`Failed to add to playlist: ${errorMessage}`);
    }
  }

  private onTrackMenu(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Context menu is now handled by right-click
    // This button can trigger the same menu programmatically
    const itemId = $(event.currentTarget).data('item-id') as string;
    const trackElement = $(event.currentTarget).closest('.ase-track-player-item');

    // Trigger a contextmenu event on the track item
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: event.clientX,
      clientY: event.clientY
    });
    trackElement[0]?.dispatchEvent(contextMenuEvent);
  }

  // ─────────────────────────────────────────────────────────────
  // Favorites Event Handlers
  // ─────────────────────────────────────────────────────────────

  private onRemoveFromFavorites(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const favoriteId = String($(event.currentTarget).data('favorite-id'));
    const favoriteType = String($(event.currentTarget).data('favorite-type'));

    Logger.debug('Remove from favorites:', favoriteId, favoriteType);

    if (favoriteType === 'playlist') {
      const playlist = this.library.playlists.getPlaylist(favoriteId);
      if (playlist) {
        this.library.playlists.updatePlaylist(favoriteId, { favorite: false });
        this.notifyInfo(`Removed "${playlist.name}" from favorites`);
      }
    } else {
      const item = this.library.getItem(favoriteId);
      if (item) {
        this.library.toggleFavorite(favoriteId);
        this.notifyInfo(`Removed "${item.name}" from favorites`);
      }
    }

    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }

  private onToggleFavoriteQueue(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const favoriteId = String($(event.currentTarget).data('favorite-id'));
    const favoriteType = String($(event.currentTarget).data('favorite-type'));

    if (!window.ASE?.queue) {
      Logger.warn('Queue manager not available');
      return;
    }

    if (favoriteType === 'playlist') {
      // Delegate to playlist queue handler
      const playlist = this.library.playlists.getPlaylist(favoriteId);
      if (!playlist) return;

      const inQueue = window.ASE.queue.getItems().some(item => item.playlistId === favoriteId);

      if (inQueue) {
        const itemsToRemove = window.ASE.queue.getItems().filter(item => item.playlistId === favoriteId);
        itemsToRemove.forEach(item => window.ASE!.queue!.removeItem(item.id));
        this.notifyInfo(`Removed "${playlist.name}" from queue`);
      } else {
        const playlistItems = playlist.items.map(pItem => ({
          libraryItemId: pItem.libraryItemId,
          group: pItem.group || 'music' as const,
          volume: pItem.volume
        }));
        window.ASE.queue.addPlaylist(favoriteId, playlistItems);
        this.notifyInfo(`Added "${playlist.name}" to queue`);
      }
    } else {
      // Track
      const item = this.library.getItem(favoriteId);
      if (!item) return;

      const inQueue = window.ASE.queue.hasItem(favoriteId);

      if (inQueue) {
        const queueItems = window.ASE.queue.getItems().filter(q => q.libraryItemId === favoriteId);
        queueItems.forEach(q => window.ASE!.queue!.removeItem(q.id));
        this.notifyInfo(`Removed "${item.name}" from queue`);
      } else {
        window.ASE.queue.addItem(favoriteId, {
          group: this.inferGroupFromTags(item.tags) as any,
          volume: 1
        });
        this.notifyInfo(`Added "${item.name}" to queue`);
      }
    }

    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }

  // ─────────────────────────────────────────────────────────────
  // Track Control Handlers
  // ─────────────────────────────────────────────────────────────

  private onChannelDropdown(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const itemId = String($(event.currentTarget).data('item-id'));
    const item = this.library.getItem(itemId);
    if (!item) return;

    const currentGroup = item.group || 'music';
    const channels: TrackGroup[] = ['music', 'ambience', 'sfx'];
    const i18n = game.i18n;
    const localize = (key: string, fallback: string) => i18n?.localize?.(key) ?? fallback;

    // Create dropdown menu
    // Using .ase-dropdown-menu class defined in SCSS
    const menu = $(`
      <div class="ase-dropdown-menu">
        ${channels.map(ch => `
          <div class="ase-dropdown-item ${ch === currentGroup ? 'active' : ''}" data-channel="${ch}">
            ${localize(`ASE.Groups.${ch}`, ch.charAt(0).toUpperCase() + ch.slice(1))}
          </div>
        `).join('')}
      </div>
    `);

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu.css({ top: rect.bottom + 2, left: rect.left });

    $('body').append(menu);

    menu.find('.ase-dropdown-item').on('click', (e) => {
      const newChannel = $(e.currentTarget).data('channel') as string;
      this.updateTrackChannel(itemId, newChannel);
      menu.remove();
    });

    // Close on outside click
    setTimeout(() => {
      $(document).one('click', () => menu.remove());
    }, 10);
  }

  private updateTrackChannel(itemId: string, channel: string): void {
    const item = this.library.getItem(itemId);
    if (!item) return;

    const group = channel as TrackGroup;
    this.library.updateItem(itemId, { group });

    // Re-route the live audio graph if a player already exists
    const engine = window.ASE?.engine;
    if (engine && typeof (engine as any).setTrackChannel === 'function') {
      (engine as any).setTrackChannel(itemId, group);
    }

    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
    const i18n = game.i18n;
    const channelLabel = i18n?.localize?.(`ASE.Groups.${channel}`) ?? channel;
    this.notifyInfo(
      i18n?.format?.('ASE.UI.Notification.ChannelSetTo', { channel: channelLabel }) ?? `Channel set to ${channelLabel}`
    );
  }

  private onDeleteTrack(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const itemId = String($(event.currentTarget).data('item-id'));
    const item = this.library.getItem(itemId);
    if (!item) return;

    const isInPlaylist = !!this.filterState.selectedPlaylistId;
    const title = this.localize(
      isInPlaylist ? 'ASE.UI.Dialog.ManageTrack.Title' : 'ASE.UI.Dialog.DeleteTrack.Title',
      isInPlaylist ? 'Manage Track' : 'Delete Track'
    );
    const content = isInPlaylist
      ? this.format('ASE.UI.Dialog.ManageTrack.Content', { name: item.name }, `What would you like to do with "${item.name}"?`)
      : this.format('ASE.UI.Dialog.DeleteTrack.Content', { name: item.name }, `Are you sure you want to delete "${item.name}"?`);

    const dialogData: any = {
      title,
      content: `<p>${content}</p>`,
      buttons: {},
      default: 'cancel'
    };

    if (isInPlaylist) {
      dialogData.buttons.removeFromPlaylist = {
        icon: '<i class="fas fa-minus-circle"></i>',
        label: this.localize('ASE.UI.Menu.RemoveFromPlaylist', 'Remove from Playlist'),
        callback: () => {
          if (this.filterState.selectedPlaylistId) {
            this.removeTrackFromPlaylist(this.filterState.selectedPlaylistId, itemId);
          }
        }
      };
    }

    dialogData.buttons.delete = {
      icon: '<i class="fas fa-trash"></i>',
      label: this.localize(
        isInPlaylist ? 'ASE.UI.Dialog.DeleteTrackGlobal.Label' : 'ASE.UI.Menu.Delete',
        isInPlaylist ? 'Delete Track (Global)' : 'Delete'
      ),
      callback: () => {
        this.library.removeItem(itemId);
        if (this.parentApp) this.parentApp.captureScroll();
        this.render();
        this.notifyInfo(this.format('ASE.UI.Notification.DeletedTrack', { name: item.name }, `Deleted "${item.name}"`));
      }
    };

    dialogData.buttons.cancel = {
      icon: '<i class="fas fa-times"></i>',
      label: this.localize('ASE.UI.Actions.Cancel', 'Cancel')
    };

    this.openStyledDialog(dialogData, isInPlaylist ? { width: 620 } : { width: 500 });
  }

  private onTrackContext(event: JQuery.ContextMenuEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const itemId = String($(event.currentTarget).data('item-id'));
    const item = this.library.getItem(itemId);
    if (!item) return;

    // Remove existing menus
    $('.ase-context-menu').remove();

    const isInPlaylist = !!this.filterState.selectedPlaylistId;
    const i18n = game.i18n;
    const localize = (key: string, fallback: string) => i18n?.localize?.(key) ?? fallback;
    const renameLabel = localize('ASE.UI.Menu.Rename', 'Rename');
    const addToPlaylistLabel = localize('ASE.UI.Menu.AddToPlaylist', 'Add to Playlist');
    const removeFromPlaylistLabel = localize('ASE.UI.Menu.RemoveFromPlaylist', 'Remove from Playlist');
    const editTagsLabel = localize('ASE.UI.Menu.EditTags', 'Edit Tags');
    const deleteLabel = localize('ASE.UI.Menu.DeleteTrack', 'Delete Track');

    let menuHtml = `
      <div class="ase-context-menu">
        <div class="ase-menu-item" data-action="rename">
          <i class="fa-solid fa-pen"></i> ${renameLabel}
        </div>
        <div class="ase-menu-item" data-action="add-to-playlist">
          <i class="fa-solid fa-list"></i> ${addToPlaylistLabel}
        </div>`;

    if (isInPlaylist) {
      menuHtml += `
        <div class="ase-menu-item" data-action="remove-from-playlist">
          <i class="fa-solid fa-minus-circle"></i> ${removeFromPlaylistLabel}
        </div>`;
    }

    menuHtml += `
        <div class="ase-menu-item" data-action="edit-tags">
          <i class="fa-solid fa-tags"></i> ${editTagsLabel}
        </div>
        <div class="ase-menu-separator"></div>
        <div class="ase-menu-item" data-action="delete">
          <i class="fa-solid fa-trash"></i> ${deleteLabel}
        </div>
      </div>
    `;

    const menu = $(menuHtml);

    menu.css({ top: event.clientY, left: event.clientX });
    $('body').append(menu);

    menu.find('[data-action="rename"]').on('click', async () => {
      menu.remove();
      await this.renameTrack(itemId);
    });

    menu.find('[data-action="add-to-playlist"]').on('click', async () => {
      menu.remove();
      await this.addTrackToPlaylistDialog(itemId);
    });

    if (isInPlaylist) {
      menu.find('[data-action="remove-from-playlist"]').on('click', async () => {
        menu.remove();
        if (this.filterState.selectedPlaylistId) {
          await this.removeTrackFromPlaylist(this.filterState.selectedPlaylistId, itemId);
        }
      });
    }

    menu.find('[data-action="edit-tags"]').on('click', () => {
      menu.remove();
      this.showTagEditor(itemId);
    });

    menu.find('[data-action="delete"]').on('click', () => {
      menu.remove();
      this.onDeleteTrack({ preventDefault: () => { }, stopPropagation: () => { }, currentTarget: $(`<div data-item-id="${itemId}">`)[0] } as any);
    });

    setTimeout(() => {
      $(document).one('click', () => menu.remove());
    }, 10);
  }

  private onTrackTagContext(event: JQuery.ContextMenuEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const tagName = String($(event.currentTarget).data('tag'));
    const itemId = String($(event.currentTarget).data('item-id'));
    const removeTagLabel = this.localize('ASE.UI.Menu.RemoveTag', 'Remove Tag');

    $('.ase-context-menu').remove();

    const menu = $(`
      <div class="ase-context-menu">
        <div class="ase-menu-item" data-action="remove-tag">
          <i class="fa-solid fa-times"></i> ${removeTagLabel}
        </div>
      </div>
    `);

    menu.css({ top: event.clientY, left: event.clientX });
    $('body').append(menu);

    menu.find('[data-action="remove-tag"]').on('click', () => {
      menu.remove();
      this.library.removeTagFromItem(itemId, tagName);
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(this.format('ASE.UI.Notification.RemovedTag', { tag: tagName }, `Removed tag "${tagName}"`));
    });

    setTimeout(() => {
      $(document).one('click', () => menu.remove());
    }, 10);
  }

  private async renameTrack(itemId: string): Promise<void> {
    const item = this.library.getItem(itemId);
    if (!item) return;

    const newName = await this.promptInput(
      this.localize('ASE.UI.Dialog.RenameTrack.Title', 'Rename Track'),
      this.localize('ASE.UI.Dialog.TrackName.Label', 'Track Name'),
      item.name
    );
    if (newName && newName !== item.name) {
      this.library.updateItem(itemId, { name: newName });
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(this.format('ASE.UI.Notification.RenamedTo', { name: newName }, `Renamed to "${newName}"`));
    }
  }

  private async addTrackToPlaylistDialog(itemId: string): Promise<void> {
    const playlists = this.library.playlists.getAllPlaylists();
    if (playlists.length === 0) {
      this.notifyWarn(this.localize('ASE.UI.Warning.NoPlaylistsCreateFirst', 'No playlists available. Create one first.'));
      return;
    }

    const selectedPlaylistId = await this.promptPlaylistSelection(playlists);
    if (!selectedPlaylistId) return;

    const item = this.library.getItem(itemId);
    if (!item) return;

    const group = this.inferGroupFromTags(item.tags) as TrackGroup;
    this.library.playlists.addTrackToPlaylist(selectedPlaylistId, itemId, group);
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
    this.notifyInfo(this.format('ASE.UI.Notification.AddedToPlaylist', { name: item.name }, `Added "${item.name}" to playlist`));
  }

  private showTagEditor(itemId: string): void {
    const item = this.library.getItem(itemId);
    if (!item) return;

    const allTags = this.library.getAllTags();
    const currentTags = new Set(item.tags);
    const searchLabel = this.localize('ASE.UI.Dialog.TagSearch.Label', 'Search Tags');
    const searchPlaceholder = this.localize('ASE.UI.Dialog.TagSearch.Placeholder', 'Find tag...');

    const content = `
      <form class="ase-dialog-form">
        <div class="form-group ase-dialog-tag-search-group">
          <label>${searchLabel}</label>
          <div class="ase-dialog-search-input-wrapper">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" name="tag-search" class="ase-dialog-tag-search" placeholder="${searchPlaceholder}">
          </div>
        </div>
        <div class="ase-dialog-scroll-list">
          ${allTags.map(tag => `
            <div class="form-group">
              <label class="ase-checkbox-row">
                <input type="checkbox" name="tag" value="${tag}" ${currentTags.has(tag) ? 'checked' : ''}>
                <span>#${tag}</span>
              </label>
            </div>
          `).join('')}
        </div>
        <div class="form-group">
          <label>${this.localize('ASE.UI.Dialog.NewTag.Title', 'New Tag')}</label>
          <input type="text" name="newTag" placeholder="${this.localize('ASE.UI.Dialog.TagName.Placeholder', 'Enter tag name...')}">
        </div>
      </form>
    `;

    const dialog = this.openStyledDialog({
      title: this.format('ASE.UI.Dialog.EditTags.Title', { name: item.name }, `Edit Tags: ${item.name}`),
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: this.localize('ASE.UI.Actions.Save', 'Save'),
          callback: (html: JQuery) => {
            const selectedTags: string[] = [];
            html.find('input[name="tag"]:checked').each((_, el) => {
              selectedTags.push($(el).val() as string);
            });

            const newTag = (html.find('input[name="newTag"]').val() as string)?.trim();
            if (newTag) {
              selectedTags.push(newTag);
              this.library.addCustomTag(newTag);
            }

            this.library.updateItem(itemId, { tags: selectedTags });
            if (this.parentApp) this.parentApp.captureScroll();
            this.render();
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: this.localize('ASE.UI.Actions.Cancel', 'Cancel')
        }
      },
      default: 'save'
    }, { width: 320 });

    setTimeout(() => {
      const appEl = dialog.element?.closest('.app.dialog') as JQuery | undefined;
      if (!appEl?.length) return;

      const $search = appEl.find('input[name="tag-search"]');
      const $rows = appEl.find('.ase-dialog-scroll-list .form-group');

      $search.on('input', (event) => {
        const query = String($(event.currentTarget).val() ?? '').trim().toLowerCase();

        $rows.each((_, row) => {
          const $row = $(row);
          const value = String($row.find('input[name="tag"]').val() ?? '').toLowerCase();
          $row.toggle(!query || value.includes(query));
        });
      });
    }, 0);
  }

  private async promptInput(title: string, label: string, defaultValue: string = ''): Promise<string | null> {
    return new Promise((resolve) => {
      this.openStyledDialog({
        title,
        content: `
          <form class="ase-dialog-form">
            <div class="form-group">
              <label>${label}</label>
              <input type="text" name="input" value="${defaultValue}" autofocus>
            </div>
          </form>
        `,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: this.localize('ASE.UI.Actions.Ok', 'OK'),
            callback: (html: JQuery) => {
              const value = html.find('input[name="input"]').val() as string;
              resolve(value?.trim() || null);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize('ASE.UI.Actions.Cancel', 'Cancel'),
            callback: () => resolve(null)
          }
        },
        default: 'ok',
        close: () => resolve(null)
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Playlist Event Handlers (Extended)
  // ─────────────────────────────────────────────────────────────

  private onSelectPlaylist(event: JQuery.ClickEvent): void {
    event.preventDefault();
    const playlistId = $(event.currentTarget).data('playlist-id') as string;

    // Toggle playlist filter
    if (this.filterState.selectedPlaylistId === playlistId) {
      // Deselect if clicking the same playlist
      this.filterState.selectedPlaylistId = null;
    } else {
      this.filterState.selectedPlaylistId = playlistId;
    }

    this.render(false, { resetScroll: true });
    Logger.debug('Select playlist:', playlistId);
  }

  private onPlaylistMenu(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Context menu is now handled by right-click
    // This button can trigger the same menu programmatically
    const playlistId = $(event.currentTarget).data('playlist-id') as string;
    const playlistElement = $(event.currentTarget).closest('.ase-list-item');

    // Trigger a contextmenu event on the playlist item
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: event.clientX,
      clientY: event.clientY
    });
    playlistElement[0]?.dispatchEvent(contextMenuEvent);
  }

  private onTogglePlaylistQueue(event: JQuery.ClickEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const playlistId = $(event.currentTarget).closest('[data-playlist-id]').data('playlist-id') as string;
    const playlist = this.library.playlists.getPlaylist(playlistId);

    if (!playlist || !window.ASE?.queue) {
      Logger.warn('Cannot toggle playlist queue: playlist or queue not available');
      return;
    }

    // Check if already in queue (by playlistId)
    const inQueue = window.ASE.queue.getItems().some(item => item.playlistId === playlistId);

    if (inQueue) {
      // Remove all items from this playlist
      const itemsToRemove = window.ASE.queue.getItems().filter(item => item.playlistId === playlistId);
      itemsToRemove.forEach(item => window.ASE!.queue!.removeItem(item.id));
      this.notifyInfo(`Removed "${playlist.name}" from queue`);
    } else {
      // Add all playlist items to queue
      const playlistItems = playlist.items.map(pItem => {
        const libraryItem = this.library.getItem(pItem.libraryItemId);
        return {
          libraryItemId: pItem.libraryItemId,
          group: pItem.group || 'music' as const,
          volume: pItem.volume
        };
      }).filter(item => item.libraryItemId);

      window.ASE.queue.addPlaylist(playlistId, playlistItems);
      this.notifyInfo(`Added "${playlist.name}" (${playlist.items.length} tracks) to queue`);
    }
  }

  private onPlaylistContext(event: JQuery.ContextMenuEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const playlistId = String($(event.currentTarget).data('playlist-id'));
    const playlist = this.library.playlists.getPlaylist(playlistId);

    if (!playlist) return;

    // Create a custom context menu appended to body to avoid clipping
    const i18n = game.i18n;
    const renameLabel = i18n?.localize?.('ASE.UI.Menu.Rename') ?? 'Rename';
    const deleteLabel = i18n?.localize?.('ASE.UI.Menu.Delete') ?? 'Delete';

    const menuHtml = `
      <div id="ase-custom-context-menu" style="position: fixed; z-index: 10000; background: #222; border: 1px solid #444; border-radius: 4px; padding: 5px 0;">
        <div class="ase-ctx-item" data-action="edit" style="padding: 5px 15px; cursor: pointer; color: white;">
            <i class="fas fa-edit" style="margin-right: 5px;"></i> ${renameLabel}
        </div>
        <div class="ase-ctx-item" data-action="delete" style="padding: 5px 15px; cursor: pointer; color: #ff6666;">
            <i class="fas fa-trash" style="margin-right: 5px;"></i> ${deleteLabel}
        </div>
      </div>
    `;

    // Remove existing
    $('#ase-custom-context-menu').remove();

    const menu = $(menuHtml);
    $('body').append(menu);

    // Position
    menu.css({
      top: event.clientY,
      left: event.clientX
    });

    // Hover effect
    menu.find('.ase-ctx-item').on('mouseenter', function () {
      $(this).css('background-color', '#333');
    }).on('mouseleave', function () {
      $(this).css('background-color', 'transparent');
    });

    // Handle clicks
    menu.find('[data-action="edit"]').on('click', () => {
      menu.remove();
      this.renamePlaylist(playlistId);
    });

    menu.find('[data-action="delete"]').on('click', () => {
      menu.remove();
      this.deletePlaylist(playlistId);
    });

    // Close on click outside
    setTimeout(() => {
      $(document).one('click', () => menu.remove());
    }, 50);
  }

  private async renamePlaylist(playlistId: string): Promise<void> {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) return;

    const newName = await this.promptPlaylistName(playlist.name);
    if (!newName || newName === playlist.name) return;

    this.library.playlists.updatePlaylist(playlistId, { name: newName });
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
    this.notifyInfo(`Renamed playlist to "${newName}"`);
  }

  private async deletePlaylist(playlistId: string): Promise<void> {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) return;

    const confirm = await this.confirmStyledDialog(
      this.localize('ASE.UI.Dialog.DeletePlaylist.Title', 'Delete Playlist'),
      `<p>${this.format('ASE.UI.Dialog.DeletePlaylist.Content', { name: playlist.name }, `Are you sure you want to delete playlist "${playlist.name}"?`)}</p>`
    );

    if (!confirm) return;

    this.library.playlists.deletePlaylist(playlistId);

    // Clear selection if this was selected
    if (this.filterState.selectedPlaylistId === playlistId) {
      this.filterState.selectedPlaylistId = null;
    }

    this.render();
    this.notifyInfo(this.format('ASE.UI.Notification.DeletedPlaylist', { name: playlist.name }, `Deleted playlist "${playlist.name}"`));
  }

  private async promptPlaylistName(current: string = ""): Promise<string | null> {
    return new Promise((resolve) => {
      const isRename = Boolean(current);
      this.openStyledDialog({
        title: this.localize(
          isRename ? 'ASE.UI.Dialog.RenamePlaylist.Title' : 'ASE.UI.Dialog.NewPlaylist.Title',
          isRename ? 'Rename Playlist' : 'New Playlist'
        ),
        content: `
          <form class="ase-dialog-form">
            <div class="form-group">
              <label>${this.localize('ASE.UI.Dialog.PlaylistName.Label', 'Playlist Name')}</label>
              <input type="text" name="playlistName" value="${current}" autofocus>
            </div>
          </form>
        `,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: this.localize('ASE.UI.Actions.Ok', 'OK'),
            callback: (html: JQuery) => {
              const name = html.find('[name="playlistName"]').val() as string;
              resolve(name?.trim() || null);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize('ASE.UI.Actions.Cancel', 'Cancel'),
            callback: () => resolve(null)
          }
        },
        default: 'ok',
        close: () => resolve(null)
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Drag and Drop
  // ─────────────────────────────────────────────────────────────

  private setupDragAndDrop(html: JQuery): void {
    // Drag start
    html.find('.ase-track-player-item[draggable="true"]').on('dragstart', (event: JQuery.DragStartEvent) => {
      const itemId = $(event.currentTarget).find('[data-item-id]').data('item-id') as string || $(event.currentTarget).data('item-id') as string;
      // Note: Data-item-id might be on the action button/icon, but for the row it should be on the row or accessible.
      // In template: <div class="ase-track-player-item"> doesn't have data-item-id directly? 
      // Let's check template.
      // Template: <div class="ase-track-player-item"> inside each item. 
      // Actually, my template rewrite in 751:
      // {{#each items}} <div class="ase-track-player-item"> ... <div class="ase-track-actions"> <i ... data-item-id="{{this.id}}">
      // The row itself DOES NOT have data-item-id in the rewrite! 
      // I NEED TO ADD IT TO THE TEMPLATE OR FIND IT.
      // I will assume I will fix the template to include data-item-id on the row, or find it inside.
      // For now, let's find it inside.
      const id = $(event.currentTarget).find('[data-item-id]').first().data('item-id') as string;

      event.originalEvent!.dataTransfer!.effectAllowed = 'copy';
      event.originalEvent!.dataTransfer!.setData('text/plain', id);
      // Mark as internal ASE drag with custom type
      event.originalEvent!.dataTransfer!.setData('application/x-ase-internal', 'true');
      $(event.currentTarget).addClass('dragging');
    });

    // Drag end
    html.find('.ase-track-player-item[draggable="true"]').on('dragend', (event: JQuery.DragEndEvent) => {
      $(event.currentTarget).removeClass('dragging');
    });

    // Drop zones (playlists)
    html.find('.ase-list-item[data-playlist-id]').on('dragover', (event: JQuery.DragOverEvent) => {
      event.preventDefault();
      event.originalEvent!.dataTransfer!.dropEffect = 'copy';
      // Show drag-over highlight when dragging tracks onto playlists
      // Internal drags have 'application/x-ase-internal' marker
      const isInternalDrag = event.originalEvent!.dataTransfer!.types.includes('application/x-ase-internal');
      if (isInternalDrag) {
        $(event.currentTarget).addClass('drag-over');
      }
    });

    html.find('.ase-list-item[data-playlist-id]').on('dragleave', (event: JQuery.DragLeaveEvent) => {
      $(event.currentTarget).removeClass('drag-over');
    });

    html.find('.ase-list-item[data-playlist-id]').on('drop', async (event: JQuery.DropEvent) => {
      event.preventDefault();
      const itemId = event.originalEvent!.dataTransfer!.getData('text/plain');
      const playlistId = $(event.currentTarget).data('playlist-id') as string;
      $(event.currentTarget).removeClass('drag-over');

      // Check if this is a playlist reorder drop (dragging a playlist onto another)
      const draggedPlaylistId = event.originalEvent!.dataTransfer!.getData('application/x-playlist-id');
      if (draggedPlaylistId && draggedPlaylistId !== playlistId) {
        await this.handlePlaylistReorder(draggedPlaylistId, playlistId);
        return;
      }

      await this.handleDropTrackToPlaylist(itemId, playlistId);
    });

    // Playlist reordering - drag start
    html.find('.ase-list-item[data-playlist-id][draggable="true"]').on('dragstart', (event: JQuery.DragStartEvent) => {
      const playlistId = String($(event.currentTarget).data('playlist-id'));
      event.originalEvent!.dataTransfer!.effectAllowed = 'move';
      event.originalEvent!.dataTransfer!.setData('application/x-playlist-id', playlistId);
      $(event.currentTarget).addClass('dragging');
    });

    html.find('.ase-list-item[data-playlist-id][draggable="true"]').on('dragend', (event: JQuery.DragEndEvent) => {
      $(event.currentTarget).removeClass('dragging');
      html.find('.ase-list-item').removeClass('drag-over drag-above drag-below');
    });

    // Favorites reordering - drag start
    html.find('.ase-favorite-item[draggable="true"]').on('dragstart', (event: JQuery.DragStartEvent) => {
      const favoriteId = String($(event.currentTarget).data('favorite-id'));
      const favoriteType = String($(event.currentTarget).data('favorite-type'));
      event.originalEvent!.dataTransfer!.effectAllowed = 'move';
      event.originalEvent!.dataTransfer!.setData('application/x-favorite-id', favoriteId);
      event.originalEvent!.dataTransfer!.setData('application/x-favorite-type', favoriteType);
      $(event.currentTarget).addClass('dragging');
    });

    html.find('.ase-favorite-item[draggable="true"]').on('dragend', (event: JQuery.DragEndEvent) => {
      $(event.currentTarget).removeClass('dragging');
      html.find('.ase-favorite-item').removeClass('drag-over drag-above drag-below');
    });

    // Visual feedback for playlist insertion position
    html.find('.ase-list-item[data-playlist-id]').on('dragover', (event: JQuery.DragOverEvent) => {
      const draggedPlaylistId = event.originalEvent!.dataTransfer!.types.includes('application/x-playlist-id');
      if (!draggedPlaylistId) return; // Not a playlist drag

      event.preventDefault();
      event.originalEvent!.dataTransfer!.dropEffect = 'move';

      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const isAbove = event.clientY! < midY;

      // Clear drag classes from ALL playlist items first
      html.find('.ase-list-item[data-playlist-id]').removeClass('drag-above drag-below drag-over');
      // Then add to current target
      $(event.currentTarget).addClass(isAbove ? 'drag-above' : 'drag-below');
    });

    // Visual feedback for favorites insertion position
    html.find('.ase-favorite-item').on('dragover', (event: JQuery.DragOverEvent) => {
      const hasFavoriteId = event.originalEvent!.dataTransfer!.types.includes('application/x-favorite-id');
      if (!hasFavoriteId) return; // Not a favorite drag

      event.preventDefault();
      event.originalEvent!.dataTransfer!.dropEffect = 'move';

      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const isAbove = event.clientY! < midY;

      // Clear drag classes from ALL favorite items first
      html.find('.ase-favorite-item').removeClass('drag-above drag-below drag-over');
      // Then add to current target
      $(event.currentTarget).addClass(isAbove ? 'drag-above' : 'drag-below');
    });

    html.find('.ase-favorite-item').on('drop', async (event: JQuery.DropEvent) => {
      event.preventDefault();
      const favoriteId = String($(event.currentTarget).data('favorite-id'));
      const favoriteType = String($(event.currentTarget).data('favorite-type'));

      $(event.currentTarget).removeClass('drag-above drag-below dragging');

      const draggedId = event.originalEvent!.dataTransfer!.getData('application/x-favorite-id');
      const draggedType = event.originalEvent!.dataTransfer!.getData('application/x-favorite-type');

      if (draggedId && draggedType && (draggedId !== favoriteId || draggedType !== favoriteType)) {
        await this.handleFavoriteReorder(draggedId, draggedType as 'track' | 'playlist', favoriteId, favoriteType as 'track' | 'playlist');
      }
    });

    // Drop zone from OS (Main Library Area)
    html.find('.ase-content-area').on('dragover', (event: JQuery.DragOverEvent) => {
      event.preventDefault();
      $(event.currentTarget).addClass('drag-over-import');
    });

    html.find('.ase-content-area').on('dragleave', (event: JQuery.DragLeaveEvent) => {
      $(event.currentTarget).removeClass('drag-over-import');
    });

    html.find('.ase-content-area').on('drop', async (event: JQuery.DropEvent) => {
      event.preventDefault();
      $(event.currentTarget).removeClass('drag-over-import');

      // Handle files from OS
      const files = event.originalEvent?.dataTransfer?.files;
      if (files && files.length > 0) {
        Logger.debug(`Dropped ${files.length} files from OS`);
        // Processing files...
        // Note: Foundry FilePicker/Upload API is needed here.
        // For now, we simulate the drop if it's external, or handle internal drops logic separately.

        // Check if it's an internal drag (track item)
        // If dataTransfer has 'text/plain' equal to item ID, it's internal.
        const internalId = event.originalEvent?.dataTransfer?.getData('text/plain');
        if (internalId && !files.length) {
          // Internal drop on main area -> Maybe remove from current playlist if we are in one? 
          // Currently do nothing.
          return;
        }

        // Real file upload
        await this.handleFileUpload(files);
      }
    });
  }

  private async handlePlaylistReorder(draggedId: string, targetId: string): Promise<void> {
    // Get current playlists order
    const playlists = this.library.playlists.getAllPlaylists();
    const draggedIndex = playlists.findIndex(p => p.id === draggedId);
    const targetIndex = playlists.findIndex(p => p.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Reorder
    const [dragged] = playlists.splice(draggedIndex, 1);
    playlists.splice(targetIndex, 0, dragged);

    // Update order in library (need to save the new order)
    this.library.playlists.reorderPlaylists(playlists.map(p => p.id));

    this.render();
    Logger.debug(`Reordered playlist ${draggedId} to position ${targetIndex}`);
  }

  private async handleFavoriteReorder(
    draggedId: string,
    draggedType: 'track' | 'playlist',
    targetId: string,
    targetType: 'track' | 'playlist'
  ): Promise<void> {
    const favorites = this.library.getOrderedFavorites();
    const draggedIndex = favorites.findIndex(f => f.id === draggedId && f.type === draggedType);
    const targetIndex = favorites.findIndex(f => f.id === targetId && f.type === targetType); // Drop ON this item

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged item
    const [draggedItem] = favorites.splice(draggedIndex, 1);

    // Insert at target index (shift others down)
    favorites.splice(targetIndex, 0, draggedItem);

    // Update library
    this.library.reorderFavorites(favorites);
    this.render();
    Logger.debug(`Reordered favorite ${draggedId} to position ${targetIndex}`);
  }

  private async handleFileUpload(files: FileList): Promise<void> {
    if (!game.user?.isGM) {
      this.notifyWarn('Only GM can upload files.', true);
      return;
    }

    // Validate audio files
    const audioFiles = Array.from(files).filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      return ['mp3', 'ogg', 'wav', 'flac', 'webm', 'm4a', 'aac'].includes(ext || '');
    });

    if (audioFiles.length === 0) {
      this.notifyWarn('No valid audio files found. Supported formats: mp3, ogg, wav, flac, webm, m4a, aac', true);
      return;
    }

    // Upload to dedicated sem_audio folder (separate from worlds and modules)
    const targetSource = 'data';
    const targetDir = 'sem_audio';

    // Ensure directory exists (create if needed)
    try {
      await FilePicker.createDirectory(targetSource, targetDir, {});
    } catch (err) {
      // Directory might already exist, ignore error
      Logger.debug('Directory creation skipped (might already exist):', err);
    }

    let importedCount = 0;
    let failedCount = 0;

    for (const file of audioFiles) {
      try {
        // Upload file to server
        const response = await FilePicker.upload(targetSource, targetDir, file, {}) as any;
        if (response.path) {
          // Smart channel detection based on filename
          const channel = this.detectChannelFromFilename(file.name);

          // Get selected tags
          const selectedTags = Array.from(this.filterState.selectedTags);

          // Add to library
          const track = await this.library.addItem(
            response.path,
            file.name.split('.')[0], // Remove extension
            channel,
            selectedTags
          );

          // Add to active playlist if one is selected
          if (this.filterState.selectedPlaylistId) {
            try {
              this.library.playlists.addTrackToPlaylist(
                this.filterState.selectedPlaylistId,
                track.id,
                channel
              );
            } catch (err) {
              // Track might already be in playlist, ignore
            }
          }

          importedCount++;
        }
      } catch (err) {
        Logger.error(`Failed to upload ${file.name}:`, err);
        failedCount++;
      }
    }

    // Show summary notification
    if (importedCount > 0) {
      const playlistMsg = this.filterState.selectedPlaylistId
        ? ` and added to active playlist`
        : '';
      this.notifyInfo(`Imported ${importedCount} file(s)${playlistMsg}`, true);
      this.render();
    }

    if (failedCount > 0) {
      this.notifyWarn(`Failed to import ${failedCount} file(s)`, true);
    }
  }

  /**
   * Smart channel detection based on filename keywords
   */
  private detectChannelFromFilename(filename: string): TrackGroup {
    const lowerName = filename.toLowerCase();

    // Music keywords
    const musicKeywords = ['music', 'song', 'theme', 'bgm', 'soundtrack', 'score', 'melody', 'музык'];
    if (musicKeywords.some(keyword => lowerName.includes(keyword))) {
      return 'music';
    }

    // Ambience keywords
    const ambienceKeywords = ['ambient', 'ambience', 'atmosphere', 'environment', 'background', 'nature', 'wind', 'rain', 'forest', 'cave', 'амбиент', 'окружен'];
    if (ambienceKeywords.some(keyword => lowerName.includes(keyword))) {
      return 'ambience';
    }

    // SFX keywords
    const sfxKeywords = ['sfx', 'sound', 'effect', 'fx', 'hit', 'impact', 'explosion', 'spell', 'attack', 'footstep', 'door', 'sword', 'интерфейс', 'эффект'];
    if (sfxKeywords.some(keyword => lowerName.includes(keyword))) {
      return 'sfx';
    }

    // Default to music if no keywords detected
    return 'music';
  }

  private async handleDropTrackToPlaylist(itemId: string, playlistId: string): Promise<void> {
    const item = this.library.getItem(itemId);
    const playlist = this.library.playlists.getPlaylist(playlistId);

    if (!item || !playlist) {
      this.notifyError('Track or playlist not found');
      return;
    }

    try {
      const group = this.inferGroupFromTags(item.tags) as TrackGroup;
      this.library.playlists.addTrackToPlaylist(playlistId, itemId, group);
      this.render();
      this.notifyInfo(`Added "${item.name}" to "${playlist.name}"`);
    } catch (error) {
      Logger.error('Failed to add track to playlist:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.notifyError(`Failed to add to playlist: ${errorMessage}`);
    }
  }

  /**
   * Setup drag-and-drop handler for Foundry native playlists
   * Allows dragging PlaylistSound items into ASE library
   */
  private setupFoundryDragDrop(html: JQuery): void {
    const dropZone = html.find('.ase-track-player-list');
    if (!dropZone.length) return;

    // Prevent default drag over to allow drop
    dropZone.on('dragover', (event: JQuery.DragOverEvent) => {
      event.preventDefault();
      event.originalEvent!.dataTransfer!.dropEffect = 'copy';
      // Only show drag-over border for external drags (Foundry playlists/files)
      // Internal drags have 'application/x-ase-internal' marker
      const isInternalDrag = event.originalEvent!.dataTransfer!.types.includes('application/x-ase-internal');
      if (!isInternalDrag) {
        dropZone.addClass('drag-over');
      }
    });

    // Remove visual feedback on drag leave
    dropZone.on('dragleave', (event: JQuery.DragLeaveEvent) => {
      // Only remove if leaving the drop zone itself (not child elements)
      if (event.currentTarget === event.target) {
        dropZone.removeClass('drag-over');
      }
    });

    // Handle drop
    dropZone.on('drop', async (event: JQuery.DropEvent) => {
      event.preventDefault();
      dropZone.removeClass('drag-over');

      await this.handleFoundryPlaylistDrop(event.originalEvent!);
    });
  }

  /**
   * Handle drop event from Foundry playlist
   * Routes to appropriate handler based on type (single track vs full playlist)
   */
  private async handleFoundryPlaylistDrop(event: DragEvent): Promise<void> {
    try {
      // Extract drag data using Foundry's helper (V10+)
      const dragData = TextEditor.getDragEventData(event) as any;

      if (!dragData) {
        Logger.debug('No drag data found, ignoring');
        return;
      }

      Logger.debug('Foundry drop detected:', dragData.type);

      // Route by type
      if (dragData.type === 'PlaylistSound') {
        await this.handlePlaylistSoundImport(dragData);


      } else if (dragData.type === 'Playlist') {
        await this.handlePlaylistImport(dragData);
      } else {
        Logger.debug(`Unsupported drop type: ${dragData.type}`);
      }

    } catch (error) {
      Logger.error('Failed to handle Foundry playlist drop:', error);
      this.notifyError('Failed to import track from playlist', true);
    }
  }

  /**
   * Import single PlaylistSound track
   */
  private async handlePlaylistSoundImport(dragData: any): Promise<void> {
    // Resolve UUID to get the actual PlaylistSound document
    const sound = await fromUuid(dragData.uuid) as any;

    if (!sound) {
      this.notifyError('Failed to resolve playlist sound', true);
      return;
    }

    // Extract audio path and name
    const audioPath = sound.path || sound.sound?.path;
    const soundName = sound.name;

    if (!audioPath) {
      this.notifyError('Playlist sound has no audio file path', true);
      return;
    }

    // Check if already exists
    const existing = this.library.findByUrl(audioPath);
    if (existing) {
      this.notifyWarn(`Track "${soundName}" already exists in library`, true);
      return;
    }

    // Determine channel (use track channel, or default to 'music')
    const channel = this.mapFoundryChannelToASE(sound.channel);

    // Add to library
    // Get selected tags
    const selectedTags = Array.from(this.filterState.selectedTags);

    // Add to library
    const newTrack = await this.library.addItem(audioPath, soundName, channel, selectedTags);

    // If a playlist is currently selected, add the track to it automatically
    if (this.filterState.selectedPlaylistId) {
      try {
        this.library.playlists.addTrackToPlaylist(
          this.filterState.selectedPlaylistId,
          newTrack.id,
          channel
        );
        const playlist = this.library.playlists.getPlaylist(this.filterState.selectedPlaylistId);
        this.notifyInfo(`Added "${soundName}" to library and playlist "${playlist?.name}"`, true);
      } catch (err) {
        // Track might already be in playlist, just notify about library add
        this.notifyInfo(`Added "${soundName}" to library`, true);
      }
    } else {
      this.notifyInfo(`Added "${soundName}" to library`, true);
    }

    this.render();
  }

  /**
   * Import entire Playlist with all tracks
   */
  private async handlePlaylistImport(dragData: any): Promise<void> {
    try {
      const playlist = await fromUuid(dragData.uuid) as any;

      if (!playlist) {
        this.notifyError('Failed to resolve Foundry playlist', true);
        return;
      }

      Logger.info(`Importing Foundry playlist: ${playlist.name} (${playlist.sounds.size} tracks)`);

      const playlistName = this.generateUniquePlaylistName(playlist.name);
      const asePlaylist = this.library.playlists.createPlaylist(playlistName);

      let addedCount = 0;
      let skippedCount = 0;

      for (const sound of playlist.sounds) {
        const audioPath = sound.path || sound.sound?.path;
        if (!audioPath) {
          Logger.warn(`Skipping sound "${sound.name}" - no path`);
          continue;
        }

        // Resolve channel with inheritance
        const foundryChannel = sound.channel || playlist.channel;

        // Map Foundry channels to ASE channels
        let channel: TrackGroup = 'music'; // default
        if (foundryChannel === 'environment') {
          channel = 'ambience';
        } else if (foundryChannel === 'interface') {
          channel = 'sfx';
        } else if (foundryChannel === 'music' || !foundryChannel) {
          channel = 'music';
        }

        let trackId = this.library.findByUrl(audioPath)?.id;

        if (!trackId) {
          try {
            // Get selected tags
            const selectedTags = Array.from(this.filterState.selectedTags);
            // Log once per playlist import to avoid spam? Or just log.
            // Logger.debug(`[ASE] PlaylistImport: Adding track with tags: ${JSON.stringify(selectedTags)}`);

            const track = await this.library.addItem(audioPath, sound.name, channel, selectedTags);
            trackId = track.id;
            addedCount++;
          } catch (err) {
            Logger.error(`Failed to add track "${sound.name}":`, err);
            continue;
          }
        } else {
          skippedCount++;
        }

        this.library.playlists.addTrackToPlaylist(asePlaylist.id, trackId, channel);
      }

      const message = `Imported playlist "${playlistName}": ${addedCount} new tracks${skippedCount > 0 ? `, ${skippedCount} already in library` : ''}`;
      this.notifyInfo(message, true);
      this.render();

    } catch (error) {
      Logger.error('Failed to import Foundry playlist:', error);
      this.notifyError('Failed to import playlist', true);
    }
  }

  private resolveFoundryChannel(sound: any, playlist: any): TrackGroup {
    const effectiveChannel = sound.channel || sound.fadeIn?.type || playlist.channel || playlist.mode;

    return this.mapFoundryChannelToASE(effectiveChannel);
  }

  private mapFoundryChannelToASE(foundryChannel: string | number | null | undefined): TrackGroup {
    if (!foundryChannel && foundryChannel !== 0) return 'music';

    // Convert to string for comparison
    const channelStr = String(foundryChannel).toLowerCase();

    // Foundry uses numeric constants (CONST.AUDIO_CHANNELS):
    // 0 or "0" = music
    // 1 or "1" = environment  
    // 2 or "2" = interface
    const channelMap: Record<string, TrackGroup> = {
      '0': 'music',
      '1': 'ambience',
      '2': 'sfx',
      'music': 'music',
      'environment': 'ambience',
      'interface': 'sfx'
    };

    const mapped = channelMap[channelStr] || 'music';

    return mapped;
  }

  private generateUniquePlaylistName(baseName: string): string {
    const existingPlaylists = this.library.playlists.getAllPlaylists();
    const existingNames = new Set(existingPlaylists.map(p => p.name));

    if (!existingNames.has(baseName)) return baseName;

    let counter = 2;
    while (existingNames.has(`${baseName} (${counter})`)) {
      counter++;
    }

    return `${baseName} (${counter})`;
  }

  private async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    try {
      this.library.playlists.removeLibraryItemFromPlaylist(playlistId, trackId);
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo('Removed track from playlist');
    } catch (error) {
      Logger.error('Failed to remove track from playlist:', error);
      this.notifyError('Failed to remove track from playlist');
    }
  }

  /**
   * Highlight playlists in sidebar that contain the specified track
   */
  private highlightPlaylistsContainingTrack(trackId: string): void {
    const playlists = this.library.playlists.getAllPlaylists();

    // Find playlists containing this track
    const containingPlaylists = playlists.filter(playlist =>
      playlist.items.some(item => item.libraryItemId === trackId)
    );

    // Highlight them in the UI
    containingPlaylists.forEach(playlist => {
      $(`[data-playlist-id="${playlist.id}"]`).addClass('highlight-contains-track');
    });
  }

  /**
   * Clear all playlist highlights
   */
  private clearPlaylistHighlights(): void {
    $('.highlight-contains-track').removeClass('highlight-contains-track');
  }

  // ─────────────────────────────────────────────────────────────
  // Context Menus
  // ─────────────────────────────────────────────────────────────

  private setupContextMenus(html: JQuery): void {
    // Track context menu
    new ContextMenu(html, '.track-item', [
      {
        name: 'Edit Name',
        icon: '<i class="fas fa-edit"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const itemId = li.data('item-id') as string;
          this.onEditTrackName(itemId);
        }
      },
      {
        name: 'Edit Tags',
        icon: '<i class="fas fa-tags"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const itemId = li.data('item-id') as string;
          this.onEditTrackTags(itemId);
        }
      },
      {
        name: 'Add to Playlist',
        icon: '<i class="fas fa-list-ul"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const itemId = li.data('item-id') as string;
          this.handleAddToPlaylistFromContext(itemId);
        }
      },
      {
        name: 'Toggle Favorite',
        icon: '<i class="fas fa-star"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const itemId = li.data('item-id') as string;
          try {
            const isFavorite = this.library.toggleFavorite(itemId);
            if (this.parentApp) this.parentApp.captureScroll();
            this.render();
            this.notifyInfo(isFavorite ? 'Added to favorites' : 'Removed from favorites');
          } catch (error) {
            Logger.error('Failed to toggle favorite:', error);
            this.notifyError('Failed to update favorite status');
          }
        }
      },
      {
        name: 'Delete Track',
        icon: '<i class="fas fa-trash"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const itemId = li.data('item-id') as string;
          this.onDeleteTrackConfirm(itemId);
        }
      }
    ]);

    // Playlist context menu
    new ContextMenu(html, '.playlist-item', [
      {
        name: 'Rename Playlist',
        icon: '<i class="fas fa-edit"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const playlistId = li.data('playlist-id') as string;
          this.onRenamePlaylist(playlistId);
        }
      },
      {
        name: 'Edit Description',
        icon: '<i class="fas fa-align-left"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const playlistId = li.data('playlist-id') as string;
          this.onEditPlaylistDescription(playlistId);
        }
      },
      {
        name: 'View Contents',
        icon: '<i class="fas fa-list"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const playlistId = li.data('playlist-id') as string;
          this.onViewPlaylistContents(playlistId);
        }
      },
      {
        name: 'Clear Playlist',
        icon: '<i class="fas fa-eraser"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const playlistId = li.data('playlist-id') as string;
          this.onClearPlaylist(playlistId);
        }
      },
      {
        name: 'Delete Playlist',
        icon: '<i class="fas fa-trash"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const playlistId = li.data('playlist-id') as string;
          this.onDeletePlaylistConfirm(playlistId);
        }
      }
    ]);

    // Tag context menu
    new ContextMenu(html, '.tag-chip:not(.mini)', [
      {
        name: 'Rename Tag',
        icon: '<i class="fas fa-edit"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const tagName = li.data('tag') as string;
          this.onRenameTag(tagName);
        }
      },
      {
        name: 'Delete Tag',
        icon: '<i class="fas fa-trash"></i>',
        callback: (target: JQuery | HTMLElement) => {
          const li = $(target);
          const tagName = li.data('tag') as string;
          this.onDeleteTag(tagName);
        }
      }
    ]);
  }

  // ─────────────────────────────────────────────────────────────
  // Context Menu Handlers - Tracks
  // ─────────────────────────────────────────────────────────────

  private async onEditTrackName(itemId: string): Promise<void> {
    const item = this.library.getItem(itemId);
    if (!item) {
      this.notifyError('Track not found');
      return;
    }

    const newName = await this.promptTextInput('Edit Track Name', 'Track Name', item.name);
    if (!newName || newName === item.name) return;

    try {
      this.library.updateItem(itemId, { name: newName });
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(`Renamed to: ${newName}`);
    } catch (error) {
      Logger.error('Failed to rename track:', error);
      this.notifyError('Failed to rename track');
    }
  }

  private async onEditTrackTags(itemId: string): Promise<void> {
    const item = this.library.getItem(itemId);
    if (!item) {
      this.notifyError('Track not found');
      return;
    }

    const tagsString = await this.promptTextInput(
      'Edit Tags',
      'Tags (comma-separated)',
      item.tags.join(', ')
    );
    if (tagsString === null) return;

    // Parse tags
    const newTags = tagsString
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    try {
      this.library.updateItem(itemId, { tags: newTags });
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo('Tags updated');
    } catch (error) {
      Logger.error('Failed to update tags:', error);
      this.notifyError('Failed to update tags');
    }
  }

  private async onDeleteTrackConfirm(itemId: string): Promise<void> {
    const item = this.library.getItem(itemId);
    if (!item) {
      this.notifyError('Track not found');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Delete Track',
      content: `<p>Are you sure you want to delete <strong>${item.name}</strong> from the library?</p>
                <p class="notification warning">This will remove it from all playlists and favorites.</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (confirmed) {
      try {
        this.library.removeItem(itemId);
        if (this.parentApp) this.parentApp.captureScroll();
        this.render();
        this.notifyInfo(`Deleted: ${item.name}`);
      } catch (error) {
        Logger.error('Failed to delete track:', error);
        this.notifyError('Failed to delete track');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Context Menu Handlers - Playlists
  // ─────────────────────────────────────────────────────────────

  private async onRenamePlaylist(playlistId: string): Promise<void> {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      this.notifyError('Playlist not found');
      return;
    }

    const newName = await this.promptTextInput('Rename Playlist', 'Playlist Name', playlist.name);
    if (!newName || newName === playlist.name) return;

    try {
      this.library.playlists.updatePlaylist(playlistId, { name: newName });
      this.render();
      this.notifyInfo(`Renamed to: ${newName}`);
    } catch (error) {
      Logger.error('Failed to rename playlist:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.notifyError(`Failed to rename playlist: ${errorMessage}`);
    }
  }

  private async onEditPlaylistDescription(playlistId: string): Promise<void> {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      this.notifyError('Playlist not found');
      return;
    }

    const description = await this.promptTextInput(
      'Edit Description',
      'Description',
      playlist.description || ''
    );
    if (description === null) return;

    try {
      this.library.playlists.updatePlaylist(playlistId, { description: description || undefined });
      this.render();
      this.notifyInfo('Description updated');
    } catch (error) {
      Logger.error('Failed to update description:', error);
      this.notifyError('Failed to update description');
    }
  }

  private async onViewPlaylistContents(playlistId: string): Promise<void> {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      this.notifyError('Playlist not found');
      return;
    }

    const items = playlist.items
      .sort((a, b) => a.order - b.order)
      .map((playlistItem, index) => {
        const libraryItem = this.library.getItem(playlistItem.libraryItemId);
        const name = libraryItem?.name || 'Unknown';
        return `<li><strong>${index + 1}.</strong> ${name}</li>`;
      })
      .join('');

    const content = `
      <div>
        <p><strong>${playlist.name}</strong></p>
        ${playlist.description ? `<p><em>${playlist.description}</em></p>` : ''}
        <p>Total tracks: ${playlist.items.length}</p>
        ${playlist.items.length > 0 ? `<ul class="playlist-contents-list">${items}</ul>` : '<p>No tracks in playlist</p>'}
      </div>
    `;

    new Dialog({
      title: 'Playlist Contents',
      content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close'
        }
      },
      default: 'close'
    }).render(true);
  }

  private async onClearPlaylist(playlistId: string): Promise<void> {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      this.notifyError('Playlist not found');
      return;
    }

    if (playlist.items.length === 0) {
      this.notifyWarn('Playlist is already empty');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Clear Playlist',
      content: `<p>Are you sure you want to remove all ${playlist.items.length} tracks from <strong>${playlist.name}</strong>?</p>
                <p class="notification warning">This cannot be undone.</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (confirmed) {
      try {
        // Remove all items
        const itemIds = [...playlist.items.map(i => i.id)];
        itemIds.forEach(itemId => {
          try {
            this.library.playlists.removeTrackFromPlaylist(playlistId, itemId);
          } catch (error) {
            Logger.error('Failed to remove item:', error);
          }
        });

        this.render();
        this.notifyInfo(`Cleared playlist: ${playlist.name}`);
      } catch (error) {
        Logger.error('Failed to clear playlist:', error);
        this.notifyError('Failed to clear playlist');
      }
    }
  }

  private async onDeletePlaylistConfirm(playlistId: string): Promise<void> {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      this.notifyError('Playlist not found');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Delete Playlist',
      content: `<p>Are you sure you want to delete <strong>${playlist.name}</strong>?</p>
                <p class="notification info">The tracks will remain in your library.</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (confirmed) {
      try {
        // Clear playlist filter if this playlist is selected
        if (this.filterState.selectedPlaylistId === playlistId) {
          this.filterState.selectedPlaylistId = null;
        }

        this.library.playlists.deletePlaylist(playlistId);
        this.render();
        this.notifyInfo(`Deleted playlist: ${playlist.name}`);
      } catch (error) {
        Logger.error('Failed to delete playlist:', error);
        this.notifyError('Failed to delete playlist');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Context Menu Handlers - Tags
  // ─────────────────────────────────────────────────────────────

  private async onRenameTag(oldTagName: string): Promise<void> {
    const newTagName = await this.promptTextInput('Rename Tag', 'New Tag Name', oldTagName);
    if (!newTagName || newTagName === oldTagName) return;

    try {
      // Find all items with this tag and update them
      const items = this.library.getAllItems().filter(item => item.tags.includes(oldTagName));

      items.forEach(item => {
        const updatedTags = item.tags.map(tag => tag === oldTagName ? newTagName : tag);
        this.library.updateItem(item.id, { tags: updatedTags });
      });

      // Update filter state if tag is selected
      if (this.filterState.selectedTags.has(oldTagName)) {
        this.filterState.selectedTags.delete(oldTagName);
        this.filterState.selectedTags.add(newTagName);
      }

      this.render();
      this.notifyInfo(`Renamed tag "${oldTagName}" to "${newTagName}" in ${items.length} track(s)`);
    } catch (error) {
      Logger.error('Failed to rename tag:', error);
      this.notifyError('Failed to rename tag');
    }
  }

  private async onDeleteTag(tagName: string): Promise<void> {
    const items = this.library.getAllItems().filter(item => item.tags.includes(tagName));

    const confirmed = await Dialog.confirm({
      title: 'Delete Tag',
      content: `<p>Are you sure you want to delete the tag <strong>${tagName}</strong>?</p>
                <p class="notification warning">This will remove the tag from ${items.length} track(s).</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (confirmed) {
      try {
        items.forEach(item => {
          const updatedTags = item.tags.filter(tag => tag !== tagName);
          this.library.updateItem(item.id, { tags: updatedTags });
        });

        // Remove from filter state if selected
        this.filterState.selectedTags.delete(tagName);

        this.render();
        this.notifyInfo(`Deleted tag "${tagName}" from ${items.length} track(s)`);
      } catch (error) {
        Logger.error('Failed to delete tag:', error);
        this.notifyError('Failed to delete tag');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────



  private async promptPlaylistSelection(playlists: Playlist[]): Promise<string | null> {
    const tracksLabel = this.localize('ASE.UI.Tracks', 'tracks');
    const options = playlists.map((p, index) =>
      `<button type="button" class="ase-playlist-picker-item ${index === 0 ? 'active' : ''}" data-playlist-id="${p.id}">
        <span class="ase-playlist-picker-name">${p.name}</span>
        <span class="ase-playlist-picker-meta">(${p.items.length} ${tracksLabel})</span>
      </button>`
    ).join('');
    const initialPlaylistId = playlists[0]?.id ?? '';

    return new Promise((resolve) => {
      const dialog = this.openStyledDialog({
        title: this.localize('ASE.UI.Dialog.AddToPlaylist.Title', 'Add to Playlist'),
        content: `
          <form class="ase-dialog-form">
            <div class="form-group">
              <label>${this.localize('ASE.UI.Dialog.SelectPlaylist.Label', 'Select Playlist')}</label>
              <input type="hidden" name="playlist-id" value="${initialPlaylistId}">
              <div class="ase-dialog-scroll-list ase-playlist-picker-list">
                ${options}
              </div>
            </div>
          </form>
        `,
        buttons: {
          add: {
            icon: '<i class="fas fa-plus"></i>',
            label: this.localize('ASE.UI.Actions.Add', 'Add'),
            callback: (html: JQuery) => {
              const playlistId = html.find('[name="playlist-id"]').val() as string;
              resolve(playlistId || null);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize('ASE.UI.Actions.Cancel', 'Cancel'),
            callback: () => resolve(null)
          }
        },
        default: 'add',
        close: () => resolve(null)
      }, { width: 520 });

      setTimeout(() => {
        const appEl = dialog.element?.closest('.app.dialog') as JQuery | undefined;
        if (!appEl?.length) return;

        const $hidden = appEl.find('input[name="playlist-id"]');
        const $items = appEl.find('.ase-playlist-picker-item');

        $items.on('click', (event) => {
          const $item = $(event.currentTarget);
          const playlistId = String($item.data('playlist-id') ?? '');
          if (!playlistId) return;

          $items.removeClass('active');
          $item.addClass('active');
          $hidden.val(playlistId);
        });
      }, 0);
    });
  }

  private async promptTextInput(
    title: string,
    label: string,
    defaultValue: string = ''
  ): Promise<string | null> {
    return new Promise((resolve) => {
      this.openStyledDialog({
        title,
        content: `
          <form class="ase-dialog-form">
            <div class="form-group">
              <label>${label}</label>
              <input type="text" name="text-input" value="${defaultValue}" autofocus />
            </div>
          </form>
        `,
        buttons: {
          save: {
            icon: '<i class="fas fa-check"></i>',
            label: this.localize('ASE.UI.Actions.Save', 'Save'),
            callback: (html: JQuery) => {
              const value = (html.find('[name="text-input"]').val() as string || '').trim();
              resolve(value || null);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize('ASE.UI.Actions.Cancel', 'Cancel'),
            callback: () => resolve(null)
          }
        },
        default: 'save',
        close: () => resolve(null)
      });
    });
  }

  /**
   * Handle adding track to playlist from context menu
   */
  private async handleAddToPlaylistFromContext(itemId: string): Promise<void> {
    const item = this.library.getItem(itemId);
    if (!item) return;

    const playlists = this.library.playlists.getAllPlaylists();
    if (playlists.length === 0) {
      this.notifyWarn('No playlists available. Create one first.');
      return;
    }

    const selectedPlaylistId = await this.promptPlaylistSelection(playlists);
    if (!selectedPlaylistId) return;

    try {
      const group = this.inferGroupFromTags(item.tags) as any;
      this.library.playlists.addTrackToPlaylist(selectedPlaylistId, itemId, group);
      this.render();
      this.notifyInfo(`Added "${item.name}" to playlist`);
    } catch (error) {
      Logger.error('Failed to add track to playlist:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.notifyError(`Failed to add to playlist: ${errorMessage}`);
    }
  }


}
