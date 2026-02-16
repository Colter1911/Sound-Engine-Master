import type { QueueItem, PlaybackQueueState } from '@t/queue';
import type { TrackGroup } from '@t/audio';
import { generateUUID } from '@utils/uuid';
import { Logger } from '../utils/logger';

const MODULE_ID = 'sound-engine-master';

type QueueEventType = 'add' | 'remove' | 'change' | 'active';
type QueueEventCallback = (data: { item?: QueueItem; items?: QueueItem[] }) => void;

/**
 * Manages the playback queue
 * Queue state is persisted between sessions via game.settings
 */
export class PlaybackQueueManager {
    private items: QueueItem[] = [];
    private activeItemId: string | null = null;
    private eventListeners: Map<QueueEventType, Set<QueueEventCallback>> = new Map();
    private saveTimeout: number | null = null;

    constructor() {
        Logger.info('PlaybackQueueManager initialized');
    }

    /**
     * Load queue state from settings
     */
    async load(): Promise<void> {
        try {
            const savedState = (game.settings as any)?.get(MODULE_ID, 'queueState') as PlaybackQueueState | undefined;

            if (savedState && savedState.items) {
                this.items = savedState.items;
                this.activeItemId = savedState.activeItemId || null;
                Logger.info(`Loaded ${this.items.length} items from queue`);
            } else {
                Logger.debug('No saved queue state found');
            }
        } catch (error) {
            Logger.error('Failed to load queue state:', error);
        }
    }

    /**
     * Save queue state to settings (debounced)
     */
    private scheduleSave(): void {
        if (this.saveTimeout !== null) {
            window.clearTimeout(this.saveTimeout);
        }

        this.saveTimeout = window.setTimeout(() => {
            this.save();
            this.saveTimeout = null;
        }, 500); // 500ms debounce
    }

    /**
     * Save queue state immediately
     */
    private async save(): Promise<void> {
        try {
            const state: PlaybackQueueState = {
                items: this.items,
                activeItemId: this.activeItemId
            };

            await (game.settings as any)?.set(MODULE_ID, 'queueState', state);
            Logger.debug('Queue state saved');
        } catch (error) {
            Logger.error('Failed to save queue state:', error);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Core Operations
    // ─────────────────────────────────────────────────────────────

    /**
     * Add a library item to the queue
     */
    addItem(libraryItemId: string, options?: Partial<Omit<QueueItem, 'id' | 'libraryItemId' | 'addedAt'>>): QueueItem {
        const item: QueueItem = {
            id: generateUUID(),
            libraryItemId,
            group: options?.group ?? 'music',
            addedAt: Date.now(),
            state: 'stopped',
            volume: options?.volume ?? 1,
            playlistId: options?.playlistId,
        };

        this.items.push(item);
        this.emit('add', { item });
        this.emit('change', { items: this.items });
        this.scheduleSave();

        Logger.debug('Added to queue:', item.id, libraryItemId);
        return item;
    }

    /**
     * Add all items from a playlist to the queue
     */
    addPlaylist(playlistId: string, playlistItems: Array<{ libraryItemId: string; group: TrackGroup; volume?: number; loop?: boolean }>): QueueItem[] {
        const added: QueueItem[] = [];

        for (const pItem of playlistItems) {
            const queueItem = this.addItem(pItem.libraryItemId, {
                playlistId,
                group: pItem.group,
                volume: pItem.volume,
                // Loop is removed
            });
            added.push(queueItem);
        }

        return added;
    }

    /**
     * Remove an item from the queue
     */
    removeItem(queueItemId: string): boolean {
        const index = this.items.findIndex(i => i.id === queueItemId);
        if (index === -1) return false;

        const [removed] = this.items.splice(index, 1);

        if (this.activeItemId === queueItemId) {
            // If the removed item was playing, stop it immediately
            if (window.ASE?.engine) {
                Logger.info(`Stopping track ${removed.libraryItemId} because it was removed from queue`);
                (window.ASE.engine as any).stopTrack(removed.libraryItemId);
            }

            this.activeItemId = null;
            this.emit('active', { item: undefined });
        }

        this.emit('remove', { item: removed });
        this.emit('change', { items: this.items });
        this.scheduleSave();

        Logger.debug('Removed from queue:', queueItemId);
        return true;
    }

    /**
     * Clear all items from the queue
     */
    clearQueue(): void {
        // If there is an active item, stop it
        if (this.activeItemId && window.ASE?.engine) {
            const activeItem = this.items.find(i => i.id === this.activeItemId);
            if (activeItem) {
                Logger.info(`Stopping track ${activeItem.libraryItemId} because queue was cleared`);
                (window.ASE.engine as any).stopTrack(activeItem.libraryItemId);
            }
        }

        this.items = [];
        this.activeItemId = null;
        this.emit('change', { items: [] });
        this.emit('active', { item: undefined });
        this.scheduleSave();
        Logger.debug('Queue cleared');
    }

    /**
     * Move a queue item to a new position
     */
    moveItem(queueItemId: string, newIndex: number): void {
        const currentIndex = this.items.findIndex(i => i.id === queueItemId);
        if (currentIndex === -1) {
            Logger.warn('Cannot move: item not in queue', queueItemId);
            return;
        }

        // Clamp newIndex
        const clampedIndex = Math.max(0, Math.min(newIndex, this.items.length - 1));
        if (currentIndex === clampedIndex) return;

        const [item] = this.items.splice(currentIndex, 1);
        this.items.splice(clampedIndex, 0, item);

        this.emit('change', { items: this.items });
        this.scheduleSave();
        Logger.debug('Moved queue item:', queueItemId, 'to index:', clampedIndex);
    }

    // ─────────────────────────────────────────────────────────────
    // Playback Control
    // ─────────────────────────────────────────────────────────────

    /**
     * Set the currently active (playing) item
     */
    setActive(queueItemId: string | null): void {
        if (queueItemId && !this.items.find(i => i.id === queueItemId)) {
            Logger.warn('Cannot set active: item not in queue', queueItemId);
            return;
        }

        this.activeItemId = queueItemId;
        const item = this.getActive();
        this.emit('active', { item: item ?? undefined });
        Logger.debug('Active item set:', queueItemId);
    }

    /**
     * Get the currently active item
     */
    getActive(): QueueItem | null {
        if (!this.activeItemId) return null;
        return this.items.find(i => i.id === this.activeItemId) ?? null;
    }

    /**
     * Get the next item in the queue (after active)
     */
    getNext(): QueueItem | null {
        if (!this.activeItemId) return this.items[0] ?? null;

        const currentIndex = this.items.findIndex(i => i.id === this.activeItemId);
        if (currentIndex === -1 || currentIndex >= this.items.length - 1) return null;

        return this.items[currentIndex + 1];
    }

    /**
     * Get the previous item in the queue (before active)
     */
    getPrevious(): QueueItem | null {
        if (!this.activeItemId) return null;

        const currentIndex = this.items.findIndex(i => i.id === this.activeItemId);
        if (currentIndex <= 0) return null;

        return this.items[currentIndex - 1];
    }

    /**
     * Update the state of a queue item
     */
    updateItemState(queueItemId: string, state: QueueItem['state']): void {
        const item = this.items.find(i => i.id === queueItemId);
        if (item) {
            item.state = state;
            this.emit('change', { items: this.items });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // State Access
    // ─────────────────────────────────────────────────────────────

    /**
     * Get all items in the queue
     */
    getItems(): QueueItem[] {
        return [...this.items];
    }

    /**
     * Get full queue state
     */
    getState(): PlaybackQueueState {
        return {
            items: [...this.items],
            activeItemId: this.activeItemId,
        };
    }

    /**
     * Check if an item is in the queue
     */
    hasItem(libraryItemId: string): boolean {
        return this.items.some(i => i.libraryItemId === libraryItemId);
    }

    /**
     * Remove all queue items that reference a specific library item
     */
    removeByLibraryItemId(libraryItemId: string): boolean {
        const toRemove = this.items.filter(i => i.libraryItemId === libraryItemId);
        if (toRemove.length === 0) return false;

        for (const item of toRemove) {
            this.removeItem(item.id);
        }
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Event System
    // ─────────────────────────────────────────────────────────────

    /**
     * Dispose: clear pending save timer and all event listeners
     */
    dispose(): void {
        if (this.saveTimeout !== null) {
            window.clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        this.eventListeners.clear();
        Logger.debug('PlaybackQueueManager disposed');
    }

    on(event: QueueEventType, callback: QueueEventCallback): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)!.add(callback);
    }

    off(event: QueueEventType, callback: QueueEventCallback): void {
        this.eventListeners.get(event)?.delete(callback);
    }

    private emit(event: QueueEventType, data: { item?: QueueItem; items?: QueueItem[] }): void {
        this.eventListeners.get(event)?.forEach(cb => cb(data));
    }
}
