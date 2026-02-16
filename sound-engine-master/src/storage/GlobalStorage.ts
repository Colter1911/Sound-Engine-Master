import { Logger } from '@utils/logger';
import type { LibraryState } from '@t/library';
import type { EffectPreset } from '@t/effects';
import { DEFAULT_MIX } from '@t/effects';
import { BUILTIN_PRESETS } from '@core/effects/presets';

const MODULE_ID = 'sound-engine-master';

/**
 * GlobalStorage - Cross-world persistent storage using JSON files
 * 
 * Stores library data in Data/sem_library/library.json
 * which persists across all worlds in Foundry and survives module updates
 */
export class GlobalStorage {
    private static readonly FILE_PATH = '/sem_library/library.json';
    private static readonly PRESETS_FILE_PATH = '/sem_library/presets.json';
    private static readonly FILE_SOURCE = 'data';
    private static readonly DIRECTORY = 'sem_library';

    /**
     * Load presets from global JSON file.
     * Returns built-in presets merged with user-saved custom presets.
     */
    static async loadPresets(): Promise<EffectPreset[]> {
        try {
            const response = await fetch(`${this.PRESETS_FILE_PATH}?t=${Date.now()}`);
            if (!response.ok) return [...BUILTIN_PRESETS];

            const data = await response.json() as any[];
            if (!data || data.length === 0) return [...BUILTIN_PRESETS];

            // Migrate legacy presets and merge with built-ins
            const customPresets = this.migratePresets(data);
            return [...BUILTIN_PRESETS, ...customPresets];
        } catch (error) {
            Logger.warn('Failed to load presets:', error);
            return [...BUILTIN_PRESETS];
        }
    }

    /**
     * Migrate old-format presets (flat effects[] with routing) to chain format.
     * Filters out any presets that match built-in IDs to avoid duplicates.
     */
    private static migratePresets(rawPresets: any[]): EffectPreset[] {
        const builtInIds = new Set(BUILTIN_PRESETS.map(p => p.id));
        const result: EffectPreset[] = [];

        for (const raw of rawPresets) {
            // Skip built-in presets (they come from BUILTIN_PRESETS)
            if (builtInIds.has(raw.id)) continue;

            // Already in new format (has chains[])
            if (raw.chains && Array.isArray(raw.chains) && raw.chains.length > 0) {
                result.push(raw as EffectPreset);
                continue;
            }

            // Legacy format: flat effects[] with routing per channel
            if (raw.effects && Array.isArray(raw.effects)) {
                const migrated = this.migrateLegacyPreset(raw);
                if (migrated) result.push(migrated);
                continue;
            }

            Logger.warn(`Skipping unrecognized preset format: ${raw.id || raw.name}`);
        }

        return result;
    }

    /**
     * Convert a single legacy preset (effects[] with routing) to chain format
     */
    private static migrateLegacyPreset(raw: any): EffectPreset | null {
        try {
            const channels: ('music' | 'ambience' | 'sfx')[] = ['music', 'ambience', 'sfx'];
            const chains = channels.map(channel => ({
                channel,
                effects: (raw.effects as any[])
                    .filter((e: any) => e.routing?.[channel])
                    .map((e: any) => ({
                        type: e.type,
                        enabled: true,
                        mix: DEFAULT_MIX[e.type as keyof typeof DEFAULT_MIX] ?? 1.0,
                        params: { level: 1.0, ...e.params },
                    })),
            }));

            return {
                id: raw.id,
                name: raw.name,
                description: raw.description || `Migrated from legacy format`,
                builtIn: false,
                chains,
            };
        } catch (error) {
            Logger.error(`Failed to migrate preset ${raw.id}:`, error);
            return null;
        }
    }

    /**
     * Save custom presets to global JSON file.
     * Built-in presets are NOT saved (they are always loaded from code).
     */
    static async savePresets(presets: EffectPreset[]): Promise<void> {
        // Only save non-built-in presets
        const customOnly = presets.filter(p => !p.builtIn);
        return this.saveFile(this.PRESETS_FILE_PATH, customOnly);
    }

    /**
     * Generic save helper (refactored from save method)
     */
    private static async saveFile(path: string, data: any): Promise<void> {
        try {
            await this.ensureDirectory();
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const file = new File([blob], path.split('/').pop()!, { type: 'application/json' });

            const originalInfo = ui.notifications?.info;
            if (ui.notifications) ui.notifications.info = (() => { }) as any;

            try {
                await FilePicker.upload(this.FILE_SOURCE, this.DIRECTORY, file, {});
            } finally {
                if (ui.notifications && originalInfo) ui.notifications.info = originalInfo;
            }
        } catch (error) {
            Logger.error(`Failed to save file ${path}:`, error);
            throw error;
        }
    }

    /**
     * Load library state from global JSON file
     */
    static async load(): Promise<LibraryState | null> {
        try {
            // Attempt to fetch the file
            const response = await fetch(`${this.FILE_PATH}?t=${Date.now()}`);

            if (!response.ok) {
                Logger.info('No existing library file found');
                return null;
            }

            const data = await response.json();
            Logger.info('Loaded library from global storage');
            return data as LibraryState;
        } catch (error) {
            Logger.warn('Failed to load global library:', error);
            return null;
        }
    }

    /**
     * Save library state to global JSON file
     */
    static async save(state: LibraryState): Promise<void> {
        try {
            await this.saveFile(this.FILE_PATH, state);
            Logger.info('Saved library to global storage');
        } catch (error) {
            Logger.error('Failed to save library to global storage:', error);
            throw error;
        }
    }

    /**
     * Ensure the module directory exists
     */
    private static async ensureDirectory(): Promise<void> {
        try {
            await FilePicker.createDirectory(this.FILE_SOURCE, this.DIRECTORY, {});
        } catch (error) {
            // Directory might already exist, ignore error
            Logger.debug('Directory creation skipped (may already exist)');
        }
    }

    /**
     * Migrate data from world-scoped game.settings to global storage
     */
    static async migrateFromWorldSettings(): Promise<boolean> {
        try {
            // Check if we already have global storage
            const existingGlobal = await this.load();
            const itemsCount = existingGlobal?.items ?
                (Array.isArray(existingGlobal.items) ? existingGlobal.items.length : Object.keys(existingGlobal.items).length) : 0;

            if (existingGlobal && existingGlobal.items && itemsCount > 0) {
                Logger.info('Global storage already populated, skipping migration');
                return false;
            }

            // Try to load from old world-scoped settings
            const oldData = await game.settings?.get(MODULE_ID as any, 'libraryState' as any) as string;
            if (!oldData || oldData === '') {
                Logger.info('No world-scoped data to migrate');
                return false;
            }

            // Parse and save to global storage
            const state = JSON.parse(oldData) as LibraryState;

            // Only migrate if there's actual data
            if (!state.items || (Array.isArray(state.items) ? state.items.length === 0 : Object.keys(state.items).length === 0)) {
                Logger.info('World-scoped data is empty, skipping migration');
                return false;
            }

            await this.save(state);

            const itemCount = Array.isArray(state.items) ? state.items.length : Object.keys(state.items).length;
            Logger.info(`Migrated ${itemCount} items from world settings to global storage`);

            return true;
        } catch (error) {
            Logger.error('Migration from world settings failed:', error);
            return false;
        }
    }

    /**
     * Delete a physical file from disk
     * Shows manual deletion instructions since automatic deletion is unreliable
     */
    static async deletePhysicalFile(url: string): Promise<boolean> {
        if (!this.isOurFile(url)) {
            Logger.warn('Cannot delete file not in sem_audio folder:', url);
            return false;
        }

        if (!game.user?.isGM) {
            return false;
        }

        // Parse file path
        let filePath = url.replace(/\\/g, '/');
        filePath = filePath.replace(/^\/*/, '');
        filePath = filePath.replace(/^Data\//i, '');

        // Show manual deletion dialog
        const content = `
            <div style="padding: 10px;">
                <p>Automatic file deletion is not available in this Foundry configuration.</p>
                <p style="margin-top: 10px;"><strong>To manually delete this file:</strong></p>
                <ol style="margin-left: 20px; margin-top: 10px;">
                    <li>Navigate to your Foundry <code>Data</code> folder</li>
                    <li>Find and delete: <code style="background: #1e293b; padding: 2px 6px; border-radius: 3px; color: #22d3ee;">${filePath}</code></li>
                </ol>
                <p style="margin-top: 10px; color: #94a3b8; font-size: 12px;">The track will be removed from the library now, but the file will remain on disk until manually deleted.</p>
            </div>
        `;

        await Dialog.prompt({
            title: 'Manual File Deletion Required',
            content,
            callback: () => { },
            options: { width: 500 }
        });

        return true;
    }

    /**
     * Check if file URL belongs to our module storage
     * Handles various URL formats from different Foundry versions and platforms
     */
    static isOurFile(url: string): boolean {
        // Normalize path separators and remove leading slashes
        const normalizedUrl = url.replace(/\\/g, '/').toLowerCase();

        // Check for our dedicated folder in various formats:
        // - sem_audio/file.mp3
        // - /sem_audio/file.mp3
        // - Data/sem_audio/file.mp3
        // - modules/sound-engine-master/sem_audio/file.mp3
        return normalizedUrl.includes('sem_audio/') ||
            normalizedUrl.includes('/sem_audio/') ||
            normalizedUrl.endsWith('sem_audio');
    }
}
