import type { LibraryItem, LibraryState, LibraryStats } from '@t/library';
import type { TrackGroup } from '@t/audio';
import { generateUUID } from '@utils/uuid';
import { validateAudioFile } from '@utils/audio-validation';
import { Logger } from '@utils/logger';
import { debounce } from '@utils/throttle';
import { PlaylistManager } from './PlaylistManager';
import { GlobalStorage } from '@storage/GlobalStorage';

const MODULE_ID = 'sound-engine-master';
const LIBRARY_VERSION = 2;

export class LibraryManager {
  private items: Map<string, LibraryItem> = new Map();
  private customTags: Set<string> = new Set();
  private favoritesOrder: Array<{ id: string, type: 'track' | 'playlist', addedAt: number }> = [];
  private saveScheduled = false;
  public readonly playlists: PlaylistManager;
  public readonly storage: GlobalStorage;

  // New property to track if we've initiated a scan this session
  private hasScannedDurations = false;

  private debouncedSave = debounce(() => {
    this.saveToSettings();
  }, 500);

  constructor() {
    this.storage = new GlobalStorage();
    this.playlists = new PlaylistManager(() => this.scheduleSave());
    // Load is now async, so we call it via then() to handle Promise
    this.loadFromSettings().catch(err => Logger.error('Failed initial load:', err));
  }

  // ─────────────────────────────────────────────────────────────
  // CRUD Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Add new item to library
   */
  async addItem(url: string, name?: string, group: TrackGroup = 'music', tags: string[] = []): Promise<LibraryItem> {
    // Validate audio format
    const validation = validateAudioFile(url);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid audio file');
    }

    // Generate name from filename if not provided
    const itemName = name || this.extractNameFromUrl(url);

    // Check for duplicates by URL
    const existingByUrl = this.findByUrl(url);
    if (existingByUrl) {
      throw new Error(`Track with this URL already exists: ${existingByUrl.name}`);
    }

    // Check for duplicates by name
    const existingByName = this.findByName(itemName);
    if (existingByName) {
      throw new Error(`Track with name "${itemName}" already exists in library`);
    }

    const now = Date.now();
    const item: LibraryItem = {
      id: generateUUID(),
      url,
      name: itemName,
      tags: tags,
      group: group,
      duration: 0,
      favorite: false,
      playbackMode: 'inherit',
      addedAt: now,
      updatedAt: now
    };

    // Asynchronously extract duration
    const audio = new Audio(url);
    audio.addEventListener('loadedmetadata', () => {
      if (audio.duration && isFinite(audio.duration)) {
        item.duration = Math.round(audio.duration);
        this.scheduleSave();
        Logger.info(`Updated duration for ${item.name}: ${item.duration}s`);
      }
    });
    // Handle error to avoid hanging if file is invalid/unreachable (though we don't block return)
    audio.addEventListener('error', (e) => {
      Logger.warn(`Failed to extract duration for ${item.name}:`, e);
    });

    this.items.set(item.id, item);
    this.scheduleSave();

    Logger.info(`Library item added: ${item.name} (${item.id})`);
    return item;
  }

  /**
   * Update existing item
   */
  updateItem(id: string, updates: Partial<LibraryItem>): LibraryItem {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Library item not found: ${id}`);
    }

    // Validate name uniqueness if changing name
    if (updates.name && updates.name !== item.name) {
      const existingByName = this.findByName(updates.name);
      if (existingByName && existingByName.id !== id) {
        throw new Error(`Track with name "${updates.name}" already exists`);
      }
    }

    // Validate URL uniqueness if changing URL
    if (updates.url && updates.url !== item.url) {
      const validation = validateAudioFile(updates.url);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid audio file');
      }

      const existingByUrl = this.findByUrl(updates.url);
      if (existingByUrl && existingByUrl.id !== id) {
        throw new Error(`Track with this URL already exists: ${existingByUrl.name}`);
      }
    }

    // Prevent ID change
    delete updates.id;

    // Update item
    const updated = {
      ...item,
      ...updates,
      updatedAt: Date.now()
    };

    this.items.set(id, updated);
    this.scheduleSave();

    Logger.info(`Library item updated: ${updated.name}`);
    return updated;
  }

  /**
   * Remove item from library
   */
  removeItem(id: string): void {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Library item not found: ${id}`);
    }

    // Remove from all playlists first
    this.playlists.removeLibraryItemFromAllPlaylists(id);

    this.items.delete(id);
    this.scheduleSave();

    Logger.info(`Library item removed: ${item.name}`);
  }

  /**
   * Get item by ID
   */
  getItem(id: string): LibraryItem | undefined {
    return this.items.get(id);
  }

  /**
   * Get all items
   */
  getAllItems(): LibraryItem[] {
    return Array.from(this.items.values());
  }

  // ─────────────────────────────────────────────────────────────
  // Search & Filter
  // ─────────────────────────────────────────────────────────────

  /**
   * Find item by URL
   */
  findByUrl(url: string): LibraryItem | undefined {
    return Array.from(this.items.values()).find(item => item.url === url);
  }

  /**
   * Find item by name
   */
  findByName(name: string): LibraryItem | undefined {
    return Array.from(this.items.values()).find(item => item.name === name);
  }

  /**
   * Search items by query
   */
  searchByName(query: string): LibraryItem[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllItems().filter(item =>
      item.name.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Filter items by tags (OR logic)
   */
  filterByTags(tags: string[]): LibraryItem[] {
    if (tags.length === 0) return this.getAllItems();

    return this.getAllItems().filter(item =>
      item.tags.some(tag => tags.includes(tag))
    );
  }

  /**
   * Get favorite items (sorted by favoritesOrder)
   */
  getFavorites(): LibraryItem[] {
    return this.getAllItems().filter(item => item.favorite);
  }

  /**
   * Get ordered favorites list (tracks + playlists)
   */
  getOrderedFavorites(): Array<{ id: string, type: 'track' | 'playlist', addedAt: number }> {
    // Clean up orphaned entries and ensure all favorites are in the order list
    const validFavorites: Array<{ id: string, type: 'track' | 'playlist', addedAt: number }> = [];

    // First, include items from the order list that still exist
    for (const entry of this.favoritesOrder) {
      if (entry.type === 'track') {
        const item = this.items.get(entry.id);
        if (item && item.favorite) {
          validFavorites.push(entry);
        }
      } else {
        const playlist = this.playlists.getPlaylist(entry.id);
        if (playlist && playlist.favorite) {
          validFavorites.push(entry);
        }
      }
    }

    // Add any favorites not in the order list (at the beginning = newest)
    const inOrderSet = new Set(validFavorites.map(f => `${f.type}:${f.id}`));

    // Tracks
    for (const item of this.getAllItems()) {
      if (item.favorite && !inOrderSet.has(`track:${item.id}`)) {
        validFavorites.unshift({ id: item.id, type: 'track', addedAt: Date.now() });
      }
    }

    // Playlists
    for (const playlist of this.playlists.getFavoritePlaylists()) {
      if (!inOrderSet.has(`playlist:${playlist.id}`)) {
        validFavorites.unshift({ id: playlist.id, type: 'playlist', addedAt: Date.now() });
      }
    }

    this.favoritesOrder = validFavorites;
    return validFavorites;
  }

  /**
   * Reorder favorites based on new order array
   */
  reorderFavorites(orderedItems: Array<{ id: string, type: 'track' | 'playlist' }>): void {
    const now = Date.now();
    this.favoritesOrder = orderedItems.map(item => ({
      id: item.id,
      type: item.type,
      addedAt: this.favoritesOrder.find(f => f.id === item.id && f.type === item.type)?.addedAt ?? now
    }));
    this.scheduleSave();
    Logger.info('Favorites reordered');
  }

  /**
   * Add item to favorites order (at the beginning = newest)
   */
  addToFavoritesOrder(id: string, type: 'track' | 'playlist'): void {
    // Remove if already exists
    this.favoritesOrder = this.favoritesOrder.filter(f => !(f.id === id && f.type === type));
    // Add at beginning (newest first)
    this.favoritesOrder.unshift({ id, type, addedAt: Date.now() });
    this.scheduleSave();
  }

  /**
   * Remove item from favorites order
   */
  removeFromFavoritesOrder(id: string, type: 'track' | 'playlist'): void {
    this.favoritesOrder = this.favoritesOrder.filter(f => !(f.id === id && f.type === type));
    this.scheduleSave();
  }

  // ─────────────────────────────────────────────────────────────
  // Tags Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Get all unique tags
   */
  getAllTags(): string[] {
    const tagSet = new Set<string>(this.customTags);
    this.items.forEach(item => {
      item.tags.forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }

  /**
   * Add a custom tag explicitly (even if not used on any track)
   */
  addCustomTag(tag: string): void {
    // Normalize: trim and remove leading #
    const normalizedTag = tag.trim().replace(/^#/, '');
    if (normalizedTag && !this.customTags.has(normalizedTag)) {
      this.customTags.add(normalizedTag);
      this.scheduleSave();
    }
  }

  /**
   * Add tag to item
   */
  addTagToItem(itemId: string, tag: string): void {
    const item = this.getItem(itemId);
    if (!item) {
      throw new Error(`Library item not found: ${itemId}`);
    }

    if (!item.tags.includes(tag)) {
      item.tags.push(tag);
      item.updatedAt = Date.now();
      this.scheduleSave();
    }
  }

  /**
   * Remove tag from item
   */
  removeTagFromItem(itemId: string, tag: string): void {
    const item = this.getItem(itemId);
    if (!item) {
      throw new Error(`Library item not found: ${itemId}`);
    }

    const index = item.tags.indexOf(tag);
    if (index !== -1) {
      item.tags.splice(index, 1);
      item.updatedAt = Date.now();
      this.scheduleSave();
    }
  }

  /**
   * Rename tag globally
   */
  renameTag(oldTag: string, newTag: string): number {
    let count = 0;
    this.items.forEach(item => {
      const index = item.tags.indexOf(oldTag);
      if (index !== -1) {
        item.tags[index] = newTag;
        item.updatedAt = Date.now();
        count++;
      }
    });

    if (count > 0) {
      if (this.customTags.has(oldTag)) {
        this.customTags.delete(oldTag);
        this.customTags.add(newTag);
      }
      this.scheduleSave();
      Logger.info(`Tag renamed: "${oldTag}" → "${newTag}" (${count} items)`);
    } else if (this.customTags.has(oldTag)) {
      // Renaming a tag that is ONLY in customTags (no items)
      this.customTags.delete(oldTag);
      this.customTags.add(newTag);
      this.scheduleSave();
      Logger.info(`Custom tag renamed: "${oldTag}" → "${newTag}"`);
    }

    return count;
  }

  /**
   * Delete tag globally
   */
  deleteTag(tag: string): number {
    let count = 0;
    this.items.forEach(item => {
      const index = item.tags.indexOf(tag);
      if (index !== -1) {
        item.tags.splice(index, 1);
        item.updatedAt = Date.now();
        count++;
      }
    });

    if (count > 0) {
      if (this.customTags.has(tag)) {
        this.customTags.delete(tag);
      }
      this.scheduleSave();
      Logger.info(`Tag deleted: "${tag}" (${count} items)`);
    } else if (this.customTags.has(tag)) {
      // Deleting a tag that is ONLY in customTags
      this.customTags.delete(tag);
      this.scheduleSave();
      Logger.info(`Custom tag deleted: "${tag}"`);
    }

    return count;
  }

  // ─────────────────────────────────────────────────────────────
  // Favorites
  // ─────────────────────────────────────────────────────────────

  /**
   * Toggle favorite status
   */
  toggleFavorite(id: string): boolean {
    const item = this.items.get(id);
    if (!item) {
      throw new Error('Item not found');
    }

    item.favorite = !item.favorite;
    item.updatedAt = Date.now();

    // Update favorites order array
    if (item.favorite) {
      this.addToFavoritesOrder(item.id, 'track');
      Logger.info(`Added favorite: ${item.name}`);
    } else {
      this.removeFromFavoritesOrder(item.id, 'track'); // Assuming 'track' type for removal
      Logger.info(`Removed favorite: ${item.name}`);
    }

    this.scheduleSave();

    // Emit Hook for UI updates
    Hooks.callAll('ase.favoritesChanged' as string as any, { id: item.id, isFavorite: item.favorite });

    return item.favorite;
  }


  /**
   * Scan library for items with missing duration (0) and try to extract it.
   * Run this once per session or on demand.
   */
  public async scanMissingDurations(): Promise<void> {
    if (this.hasScannedDurations) return;
    this.hasScannedDurations = true;

    const missing = Array.from(this.items.values()).filter(i => !i.duration || i.duration === 0);
    if (missing.length === 0) return;

    Logger.info(`Scanning ${missing.length} items for missing duration...`);
    let updatedCount = 0;

    // Process in batches to avoid network spam
    const batchSize = 5;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      await Promise.all(batch.map(item => new Promise<void>((resolve) => {
        const audio = new Audio(item.url);

        const cleanup = () => {
          audio.onloadedmetadata = null;
          audio.onerror = null;
          resolve();
        };

        audio.onloadedmetadata = () => {
          if (audio.duration && isFinite(audio.duration)) {
            item.duration = Math.round(audio.duration);
            updatedCount++;
            // Don't save immediately for each item, batch it
          }
          cleanup();
        };

        audio.onerror = () => {
          // Logger.warn(`Failed to extract duration for ${item.name} during scan`); // Optional: don't spam logs
          cleanup();
        };

        // Timeout to prevent hanging
        setTimeout(cleanup, 5000);
      })));
    }

    if (updatedCount > 0) {
      Logger.info(`Updated duration for ${updatedCount} items.`);
      this.scheduleSave();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────

  /**
   * Get library statistics
   */
  getStats(): LibraryStats {
    const items = this.getAllItems();
    const playlistStats = this.playlists.getStats();

    return {
      totalItems: items.length,
      favoriteItems: items.filter(i => i.favorite).length,
      totalDuration: items.reduce((sum, i) => sum + i.duration, 0),
      tagCount: this.getAllTags().length,
      totalPlaylists: playlistStats.totalPlaylists,
      itemsByGroup: this.getGroupCounts(),
    };
  }

  private getGroupCounts(): Record<TrackGroup, number> {
    const counts: Record<TrackGroup, number> = { music: 0, ambience: 0, sfx: 0 };
    for (const item of this.items.values()) {
      if (counts[item.group] !== undefined) {
        counts[item.group]++;
      }
    }
    return counts;
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────

  private async loadFromSettings(): Promise<void> {
    try {
      // First, try to migrate from old world-scoped settings
      await GlobalStorage.migrateFromWorldSettings();

      // Load from global storage
      const state = await GlobalStorage.load();

      if (!state) {
        Logger.info('No saved library state, starting fresh');
        return;
      }

      // Migrate if needed
      if (state.version !== LIBRARY_VERSION) {
        Logger.warn(`Library version mismatch: ${state.version} → ${LIBRARY_VERSION}`);
        // Add migration logic here if needed
      }

      // Load items
      this.items.clear();
      // Use strict type guard or iteration
      if (state.items) {
        Object.values(state.items).forEach((item) => {
          if (this.isValidLibraryItem(item)) {
            // Migration: Ensure playbackMode exists
            if (!item.playbackMode) {
              item.playbackMode = 'inherit';
            }
            this.items.set(item.id, item);
          }
        });
      }

      // Load custom tags
      this.customTags = new Set(state.customTags || []);

      // Load playlists
      this.playlists.load(state.playlists || {});

      // Load favorites order
      this.favoritesOrder = state.favoritesOrder || [];

      Logger.info(`Library loaded: ${this.items.size} items, ${this.playlists.getAllPlaylists().length} playlists, ${this.customTags.size} custom tags`);

      // ─────────────────────────────────────────────────────────
      // Favorites Migration & Loading (World Scope)
      // ─────────────────────────────────────────────────────────
      const worldFavorites = (game.settings as any).get(MODULE_ID, 'favorites') || { ids: [], playlistIds: [], order: [] };
      const hasWorldFavorites = (worldFavorites.ids?.length > 0) || (worldFavorites.playlistIds?.length > 0) || (worldFavorites.order?.length > 0);

      if (!hasWorldFavorites) {
        // MIGRATION: Check if we have favorites in the loaded global state
        // If so, these are from before the split. We should migrate them to world settings.
        const globalFavoriteItems = Array.from(this.items.values()).filter(i => i.favorite);
        const globalFavoritePlaylists = this.playlists.getAllPlaylists().filter(p => p.favorite);
        const hasGlobalFavorites = globalFavoriteItems.length > 0 || globalFavoritePlaylists.length > 0;

        if (hasGlobalFavorites) {
          Logger.info(`Migrating ${globalFavoriteItems.length} tracks and ${globalFavoritePlaylists.length} playlists to world-scoped favorites`);

          this.favoritesOrder = state.favoritesOrder || [];

          // Save immediately to world settings to persist the migration
          await (game.settings as any).set(MODULE_ID, 'favorites', {
            ids: globalFavoriteItems.map(i => i.id),
            playlistIds: globalFavoritePlaylists.map(p => p.id),
            order: this.favoritesOrder
          });

          // Note: The items/playlists already have favorite=true from the global load,
          // so we don't need to re-apply it. The next save will strip them from global.
        } else {
          // No favorites anywhere, clean slate
          this.favoritesOrder = [];
        }
      } else {
        // NORMAL LOAD: Apply world favorites to the library
        // 1. Reset all favorites to false (trusted source is now World Settings)
        this.items.forEach(i => i.favorite = false);
        this.playlists.getAllPlaylists().forEach(p => p.favorite = false);

        // 2. Apply track favorites
        const trackIds = new Set<string>(worldFavorites.ids || []);
        trackIds.forEach((id) => {
          const item = this.items.get(id);
          if (item) item.favorite = true;
        });

        // 3. Apply playlist favorites
        const playlistIds = new Set<string>(worldFavorites.playlistIds || []);
        playlistIds.forEach((id) => {
          const playlist = this.playlists.getPlaylist(id);
          if (playlist) playlist.favorite = true;
        });

        // 4. Load order
        this.favoritesOrder = worldFavorites.order || [];
        Logger.info(`Loaded world-scoped favorites: ${trackIds.size} tracks, ${playlistIds.size} playlists`);
      }

    } catch (error) {
      Logger.error('Failed to load library state:', error);
    }
  }

  private isValidLibraryItem(item: any): item is LibraryItem {
    return item && typeof item.id === 'string' && typeof item.url === 'string';
  }

  private async saveToSettings(): Promise<void> {
    try {
      // 1. Save World Favorites
      // We collect the current state of favorites and save it to the world setting
      const favoriteTracks = Array.from(this.items.values()).filter(i => i.favorite).map(i => i.id);
      const favoritePlaylists = this.playlists.getAllPlaylists().filter(p => p.favorite).map(p => p.id);

      await (game.settings as any).set(MODULE_ID, 'favorites', {
        ids: favoriteTracks,
        playlistIds: favoritePlaylists,
        order: this.favoritesOrder
      });

      // 2. Save Global Library (Cleaned of favorites)
      // We create a copy of the state where all favorite flags are false, 
      // so the global file remains "neutral".

      const cleanItems = new Map<string, LibraryItem>();
      this.items.forEach((item, id) => {
        if (item.favorite) {
          cleanItems.set(id, { ...item, favorite: false });
        } else {
          cleanItems.set(id, item);
        }
      });

      const cleanPlaylists = this.playlists.export();
      const processedPlaylists: Record<string, any> = {};
      Object.values(cleanPlaylists).forEach(p => {
        if (p.favorite) {
          processedPlaylists[p.id] = { ...p, favorite: false };
        } else {
          processedPlaylists[p.id] = p;
        }
      });

      const state: LibraryState = {
        items: Object.fromEntries(cleanItems),
        playlists: processedPlaylists,
        customTags: Array.from(this.customTags),
        favoritesOrder: [], // Cleared in global storage
        version: LIBRARY_VERSION,
        lastModified: Date.now()
      };

      await GlobalStorage.save(state);
      this.saveScheduled = false;

      Logger.debug(`Library saved: ${this.items.size} items, ${Object.keys(processedPlaylists).length} playlists (Favorites saved to World)`);
    } catch (error) {
      Logger.error('Failed to save library state:', error);
    }
  }

  private scheduleSave(): void {
    this.debouncedSave();
  }

  // ─────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────

  private extractNameFromUrl(url: string): string {
    try {
      const decoded = decodeURIComponent(url);
      const parts = decoded.split('/');
      const filename = parts[parts.length - 1];
      return filename.replace(/\.[^.]+$/, ''); // Remove extension
    } catch {
      return 'Unknown Track';
    }
  }

  /**
   * Clear all library data
   */
  clear(): void {
    this.items.clear();
    this.playlists.clear();
    this.scheduleSave();
    Logger.warn('Library cleared');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    // Save immediately before disposing
    if (this.saveScheduled) {
      this.saveToSettings();
    }
  }
}
