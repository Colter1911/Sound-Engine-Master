import type { TrackGroup } from './audio';

export type EffectType = 'reverb' | 'delay' | 'filter' | 'compressor' | 'distortion' | 'modulation';

export interface EffectParam {
    id: string;
    name: string;
    type: 'float' | 'boolean' | 'select';
    value: number | boolean | string;
    defaultValue: number | boolean | string;
    min?: number;
    max?: number;
    step?: number;
    options?: { label: string; value: string }[]; // For select type
    suffix?: string; // e.g. "ms", "%", "Hz"
}

// ─── Legacy (kept for migration) ────────────────────────────────

export interface EffectState {
    id: string;
    type: EffectType;
    enabled: boolean;
    params: Record<string, number | boolean | string>;
    routing: {
        [key in TrackGroup]: boolean;
    };
}

// ─── Chain Architecture ─────────────────────────────────────────

/** State of a single effect within a channel chain */
export interface ChainEffectState {
    type: EffectType;
    enabled: boolean;
    mix: number;                                      // 0.0 = fully dry, 1.0 = fully wet
    params: Record<string, number | boolean | string>;
}

/** One channel's complete chain: ordered array of effects */
export interface ChannelChain {
    channel: TrackGroup;
    effects: ChainEffectState[];                      // index = position in chain
    bypassed?: boolean;
    savedEnabledStates?: Record<string, boolean>;     // Snapshot of enabled states before bypass
}

/** Default mix values per effect type */
export const DEFAULT_MIX: Record<EffectType, number> = {
    filter: 1.0,
    compressor: 1.0,
    distortion: 1.0,
    delay: 0.30,
    reverb: 0.35,
    modulation: 0.50,
};

/** Default chain order for new channels */
export const DEFAULT_CHAIN_ORDER: EffectType[] = [
    'filter', 'compressor', 'distortion', 'delay', 'reverb'
];

// ─── Presets ────────────────────────────────────────────────────

export interface EffectPreset {
    id: string;
    name: string;
    description?: string;
    builtIn?: boolean;
    chains: ChannelChain[];                            // 3 chains (one per channel)
    /** @deprecated legacy field, used for migration only */
    effects?: EffectState[];
}
