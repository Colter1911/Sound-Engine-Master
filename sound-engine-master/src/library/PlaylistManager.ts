import type { Playlist, PlaylistItem } from '@t/library';
import type { TrackGroup } from '@t/audio';
import { generateUUID } from '@utils/uuid';
import { Logger } from '@utils/logger';

export class PlaylistManager {
  private playlists: Map<string, Playlist> = new Map();
  private onChangeCallback?: () => void;

  constructor(onChangeCallback?: () => void) {
    this.onChangeCallback = onChangeCallback;
  }

  /**
   * Notify about changes (triggers save)
   */
  private notifyChange(): void {
    if (this.onChangeCallback) {
      this.onChangeCallback();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // CRUD Operations - Playlists
  // ─────────────────────────────────────────────────────────────

  /**
   * Create new playlist
   */
  createPlaylist(name: string, description?: string): Playlist {
    // Check for duplicate names
    const existing = this.findByName(name);
    if (existing) {
      throw new Error(`Playlist with name "${name}" already exists`);
    }

    const now = Date.now();
    const playlist: Playlist = {
      id: generateUUID(),
      name,
      description,
      items: [],
      createdAt: now,
      updatedAt: now,
      favorite: false,
      playbackMode: 'loop'
    };

    this.playlists.set(playlist.id, playlist);
    this.notifyChange();
    Logger.info(`Playlist created: ${playlist.name} (${playlist.id})`);

    return playlist;
  }

  /**
   * Update playlist metadata
   */
  updatePlaylist(id: string, updates: Partial<Pick<Playlist, 'name' | 'description' | 'favorite' | 'playbackMode'>>): Playlist {
    const playlist = this.playlists.get(id);
    if (!playlist) {
      throw new Error(`Playlist not found: ${id}`);
    }

    // Validate name uniqueness if changing name
    if (updates.name && updates.name !== playlist.name) {
      const existing = this.findByName(updates.name);
      if (existing && existing.id !== id) {
        throw new Error(`Playlist with name "${updates.name}" already exists`);
      }
    }

    // Update playlist
    const updated = {
      ...playlist,
      ...updates,
      updatedAt: Date.now()
    };

    this.playlists.set(id, updated);
    this.notifyChange();
    Logger.info(`Playlist updated: ${updated.name}`);

    return updated;
  }

  /**
   * Delete playlist
   */
  deletePlaylist(id: string): void {
    const playlist = this.playlists.get(id);
    if (!playlist) {
      throw new Error(`Playlist not found: ${id}`);
    }

    this.playlists.delete(id);
    this.notifyChange();
    Logger.info(`Playlist deleted: ${playlist.name}`);
  }

  /**
   * Get playlist by ID
   */
  getPlaylist(id: string): Playlist | undefined {
    return this.playlists.get(id);
  }

  /**
   * Get all playlists
   */
  getAllPlaylists(): Playlist[] {
    return Array.from(this.playlists.values());
  }

  /**
   * Find playlist by name
   */
  findByName(name: string): Playlist | undefined {
    return Array.from(this.playlists.values()).find(p => p.name === name);
  }

  /**
   * Get favorite playlists
   */
  getFavoritePlaylists(): Playlist[] {
    return this.getAllPlaylists().filter(p => p.favorite);
  }

  /**
   * Reorder playlists based on new order array of IDs
   */
  reorderPlaylists(orderedIds: string[]): void {
    const newMap = new Map<string, Playlist>();

    // First, add playlists in the new order
    orderedIds.forEach(id => {
      const playlist = this.playlists.get(id);
      if (playlist) {
        newMap.set(id, playlist);
      }
    });

    // Add any remaining playlists that weren't in the order array
    this.playlists.forEach((playlist, id) => {
      if (!newMap.has(id)) {
        newMap.set(id, playlist);
      }
    });

    this.playlists = newMap;
    this.notifyChange();
    Logger.info('Playlists reordered');
  }


  /**
   * Toggle playlist favorite status
   */
  togglePlaylistFavorite(id: string): boolean {
    const playlist = this.getPlaylist(id);
    if (!playlist) {
      throw new Error(`Playlist not found: ${id}`);
    }

    playlist.favorite = !playlist.favorite;
    playlist.updatedAt = Date.now();
    this.notifyChange();

    return playlist.favorite;
  }

  // ─────────────────────────────────────────────────────────────
  // CRUD Operations - Playlist Items
  // ─────────────────────────────────────────────────────────────

  /**
   * Add track to playlist
   */
  addTrackToPlaylist(
    playlistId: string,
    libraryItemId: string,
    group: TrackGroup,
    options?: Partial<Omit<PlaylistItem, 'id' | 'libraryItemId' | 'group' | 'order'>>
  ): PlaylistItem {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    // Check if track already exists in playlist
    const exists = playlist.items.find(item => item.libraryItemId === libraryItemId);
    if (exists) {
      throw new Error('Track already exists in this playlist');
    }

    // Create new playlist item
    const item: PlaylistItem = {
      id: generateUUID(),
      libraryItemId,
      group,
      volume: options?.volume ?? 1.0,
      order: playlist.items.length,
      fadeIn: options?.fadeIn,
      fadeOut: options?.fadeOut
    };

    playlist.items.push(item);
    playlist.updatedAt = Date.now();
    this.notifyChange();

    Logger.debug(`Track added to playlist ${playlist.name}: ${libraryItemId}`);

    return item;
  }

  /**
   * Remove track from playlist
   */
  removeTrackFromPlaylist(playlistId: string, playlistItemId: string): void {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    const index = playlist.items.findIndex(item => item.id === playlistItemId);
    if (index === -1) {
      throw new Error(`Playlist item not found: ${playlistItemId}`);
    }

    playlist.items.splice(index, 1);

    // Reorder remaining items
    this.reorderPlaylistItems(playlist);

    playlist.updatedAt = Date.now();
    this.notifyChange();
    Logger.debug(`Track removed from playlist ${playlist.name}`);
  }

  /**
   * Remove all tracks with specific library item ID from playlist
   */
  removeLibraryItemFromPlaylist(playlistId: string, libraryItemId: string): number {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    const initialLength = playlist.items.length;
    playlist.items = playlist.items.filter(item => item.libraryItemId !== libraryItemId);
    const removed = initialLength - playlist.items.length;

    if (removed > 0) {
      this.reorderPlaylistItems(playlist);
      playlist.updatedAt = Date.now();
      this.notifyChange();
      Logger.debug(`Removed ${removed} instances of library item ${libraryItemId} from playlist ${playlist.name}`);
    }

    return removed;
  }

  /**
   * Remove library item from all playlists
   */
  removeLibraryItemFromAllPlaylists(libraryItemId: string): number {
    let totalRemoved = 0;

    this.playlists.forEach(playlist => {
      const initialLength = playlist.items.length;
      playlist.items = playlist.items.filter(item => item.libraryItemId !== libraryItemId);
      const removed = initialLength - playlist.items.length;

      if (removed > 0) {
        this.reorderPlaylistItems(playlist);
        playlist.updatedAt = Date.now();
        totalRemoved += removed;
      }
    });

    if (totalRemoved > 0) {
      this.notifyChange();
      Logger.info(`Removed library item ${libraryItemId} from ${totalRemoved} playlist(s)`);
    }

    return totalRemoved;
  }

  /**
   * Update playlist item
   */
  updatePlaylistItem(
    playlistId: string,
    playlistItemId: string,
    updates: Partial<Omit<PlaylistItem, 'id' | 'libraryItemId' | 'order'>>
  ): PlaylistItem {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    const item = playlist.items.find(i => i.id === playlistItemId);
    if (!item) {
      throw new Error(`Playlist item not found: ${playlistItemId}`);
    }

    // Update item
    Object.assign(item, updates);
    playlist.updatedAt = Date.now();
    this.notifyChange();

    Logger.debug(`Playlist item updated in ${playlist.name}`);

    return item;
  }

  /**
   * Reorder track in playlist
   */
  reorderTrack(playlistId: string, playlistItemId: string, newOrder: number): void {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    const itemIndex = playlist.items.findIndex(i => i.id === playlistItemId);
    if (itemIndex === -1) {
      throw new Error(`Playlist item not found: ${playlistItemId}`);
    }

    // Validate new order
    if (newOrder < 0 || newOrder >= playlist.items.length) {
      throw new Error(`Invalid order: ${newOrder}`);
    }

    // Remove item from current position
    const [item] = playlist.items.splice(itemIndex, 1);

    // Insert at new position
    playlist.items.splice(newOrder, 0, item);

    // Reorder all items
    this.reorderPlaylistItems(playlist);

    playlist.updatedAt = Date.now();
    this.notifyChange();
    Logger.debug(`Track reordered in playlist ${playlist.name}`);
  }

  /**
   * Get tracks in playlist
   */
  getPlaylistTracks(playlistId: string): PlaylistItem[] {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }

    return [...playlist.items].sort((a, b) => a.order - b.order);
  }

  /**
   * Get playlists containing a specific library item
   */
  getPlaylistsContainingItem(libraryItemId: string): Playlist[] {
    return this.getAllPlaylists().filter(playlist =>
      playlist.items.some(item => item.libraryItemId === libraryItemId)
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────

  /**
   * Load playlists from state object
   */
  load(playlistsData: Record<string, Playlist>): void {
    this.playlists.clear();

    Object.values(playlistsData).forEach(playlist => {
      // Ensure items are properly ordered
      playlist.items.sort((a, b) => a.order - b.order);
      // Migration: Ensure playbackMode exists
      if (!playlist.playbackMode) {
        playlist.playbackMode = 'loop';
      }
      this.playlists.set(playlist.id, playlist);
    });

    Logger.info(`PlaylistManager loaded: ${this.playlists.size} playlists`);
  }

  /**
   * Export playlists to state object
   */
  export(): Record<string, Playlist> {
    return Object.fromEntries(this.playlists);
  }

  // ─────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────

  /**
   * Reorder playlist items to ensure consecutive order values
   */
  private reorderPlaylistItems(playlist: Playlist): void {
    playlist.items.forEach((item, index) => {
      item.order = index;
    });
  }

  /**
   * Get statistics
   */
  getStats() {
    const playlists = this.getAllPlaylists();
    return {
      totalPlaylists: playlists.length,
      favoritePlaylists: playlists.filter(p => p.favorite).length,
      totalTracks: playlists.reduce((sum, p) => sum + p.items.length, 0),
      averageTracksPerPlaylist: playlists.length > 0
        ? Math.round(playlists.reduce((sum, p) => sum + p.items.length, 0) / playlists.length)
        : 0
    };
  }

  /**
   * Clear all playlists
   */
  clear(): void {
    this.playlists.clear();
    Logger.warn('All playlists cleared');
  }
}
