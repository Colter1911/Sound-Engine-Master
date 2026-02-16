import type { TrackGroup, PlaybackState } from './audio';

/**
 * A single item in the playback queue
 */
export interface QueueItem {
    id: string;                    // UUID for this queue entry
    libraryItemId: string;         // Reference to LibraryItem
    playlistId?: string;           // If added as part of a playlist
    group: TrackGroup;             // music/ambience/sfx
    addedAt: number;               // Timestamp when added
    state: PlaybackState;          // stopped/playing/paused/loading
    volume: number;                // 0-1 (can override library default)
}

/**
 * Playback Queue State (runtime, not persisted)
 */
export interface PlaybackQueueState {
    items: QueueItem[];            // Ordered list of queue items
    activeItemId: string | null;   // Currently playing item
}
