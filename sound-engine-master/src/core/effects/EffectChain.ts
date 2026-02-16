import type { TrackGroup } from '@t/audio';
import type { ChannelChain, ChainEffectState, EffectType } from '@t/effects';
import { DEFAULT_CHAIN_ORDER, DEFAULT_MIX } from '@t/effects';
import { AudioEffect } from './AudioEffect';
import { ReverbEffect } from './ReverbEffect';
import { DelayEffect } from './DelayEffect';
import { FilterEffect } from './FilterEffect';
import { CompressorEffect } from './CompressorEffect';
import { DistortionEffect } from './DistortionEffect';
import { Logger } from '@utils/logger';

/** Factory: creates an AudioEffect instance by type */
function createEffect(ctx: AudioContext, type: EffectType): AudioEffect {
    switch (type) {
        case 'reverb': return new ReverbEffect(ctx);
        case 'delay': return new DelayEffect(ctx);
        case 'filter': return new FilterEffect(ctx);
        case 'compressor': return new CompressorEffect(ctx);
        case 'distortion': return new DistortionEffect(ctx);
        default:
            Logger.warn(`Unknown effect type: ${type}, falling back to filter`);
            return new FilterEffect(ctx);
    }
}

/**
 * EffectChain manages one channel's serial effects chain.
 *
 * Signal flow:
 *   inputNode → [Effect1] → [Effect2] → ... → [EffectN] → outputNode
 *
 * Each effect internally handles dry/wet mix and bypass.
 * Disabled effects pass signal through via their dry path (true bypass).
 */
export class EffectChain {
    public readonly channel: TrackGroup;
    public readonly inputNode: GainNode;
    public readonly outputNode: GainNode;

    private ctx: AudioContext;
    private effects: AudioEffect[] = [];

    /** Mute node used during chain rebuild to prevent clicks */
    private muteNode: GainNode;

    private _bypassed: boolean = false;
    private _savedEnabledStates: Map<EffectType, boolean> = new Map();

    constructor(ctx: AudioContext, channel: TrackGroup) {
        this.ctx = ctx;
        this.channel = channel;

        this.inputNode = ctx.createGain();
        this.outputNode = ctx.createGain();
        this.muteNode = ctx.createGain();
        this.muteNode.gain.value = 1;

        // muteNode sits between last effect and outputNode
        this.muteNode.connect(this.outputNode);

        // Default: empty chain, input → muteNode → output
        this.inputNode.connect(this.muteNode);
    }

    // ─── Bypass Logic ───────────────────────────────────────────

    public get isBypassed(): boolean {
        return this._bypassed;
    }

    public bypass(): void {
        if (this._bypassed) return;

        this._savedEnabledStates.clear();
        for (const effect of this.effects) {
            this._savedEnabledStates.set(effect.type, effect.enabled);
            if (effect.enabled) {
                effect.setEnabled(false);
            }
        }
        this._bypassed = true;
        Logger.debug(`EffectChain [${this.channel}]: bypassed`);
    }

    public restore(): void {
        if (!this._bypassed) return;

        for (const effect of this.effects) {
            const wasEnabled = this._savedEnabledStates.get(effect.type);
            if (wasEnabled) {
                effect.setEnabled(true);
            }
        }
        this._savedEnabledStates.clear();
        this._bypassed = false;
        Logger.debug(`EffectChain [${this.channel}]: restored from bypass`);
    }

    // ─── Chain Building ─────────────────────────────────────────

    /** Build a chain with default effect order, all disabled */
    buildDefault(): void {
        this.buildFromTypes(DEFAULT_CHAIN_ORDER);
    }

    /** Build chain from an ordered array of effect types */
    buildFromTypes(types: EffectType[]): void {
        // Dispose old effects
        this.disposeEffects();

        // Create new effect instances
        this.effects = types.map(type => createEffect(this.ctx, type));

        this._bypassed = false;
        this._savedEnabledStates.clear();

        this.rebuildConnections();
        Logger.debug(`EffectChain [${this.channel}]: built with ${types.join(' → ')}`);
    }

    /** Rebuild chain from a full ChannelChain state (restore/sync) */
    restoreState(state: ChannelChain): void {
        // Dispose old effects
        this.disposeEffects();

        // Create new effects in state order
        this.effects = state.effects.map(es => {
            const effect = createEffect(this.ctx, es.type);
            effect.restoreChainState(es);
            return effect;
        });

        // Restore bypass state
        if (state.bypassed) {
            this._bypassed = true;
            if (state.savedEnabledStates) {
                this._savedEnabledStates = new Map(Object.entries(state.savedEnabledStates)) as Map<EffectType, boolean>;
            }
            Logger.debug(`EffectChain [${this.channel}]: restored in bypassed state`);
        } else {
            this._bypassed = false;
            this._savedEnabledStates.clear();
        }

        this.rebuildConnections();
        Logger.debug(`EffectChain [${this.channel}]: restored ${this.effects.length} effects`);
    }

    // ─── Connection Management ──────────────────────────────────

    /**
     * Disconnect and reconnect all effects in current order.
     * Uses a brief mute to prevent audio clicks.
     */
    private rebuildConnections(): void {
        const t = this.ctx.currentTime;

        // Brief mute (10ms fade out, reconnect, 10ms fade in)
        this.muteNode.gain.setTargetAtTime(0, t, 0.005);

        // Disconnect everything from inputNode
        this.inputNode.disconnect();

        // Disconnect all effect outputs
        for (const effect of this.effects) {
            effect.disconnectOutput();
        }

        if (this.effects.length === 0) {
            // No effects: input → muteNode → output
            this.inputNode.connect(this.muteNode);
        } else {
            // Wire: input → effect[0]
            this.inputNode.connect(this.effects[0].inputNode);

            // Wire: effect[i] → effect[i+1]
            for (let i = 0; i < this.effects.length - 1; i++) {
                this.effects[i].connectToNext(this.effects[i + 1]);
            }

            // Wire: last effect → muteNode → output
            this.effects[this.effects.length - 1].connectToDestination(this.muteNode);
        }

        // Fade back in
        this.muteNode.gain.setTargetAtTime(1, t + 0.015, 0.005);
    }

    // ─── Reorder ────────────────────────────────────────────────

    /** Move effect from one position to another in the chain */
    reorder(fromIndex: number, toIndex: number): void {
        if (fromIndex < 0 || fromIndex >= this.effects.length) return;
        if (toIndex < 0 || toIndex >= this.effects.length) return;
        if (fromIndex === toIndex) return;

        const [moved] = this.effects.splice(fromIndex, 1);
        this.effects.splice(toIndex, 0, moved);
        this.rebuildConnections();

        Logger.debug(`EffectChain [${this.channel}]: reordered ${moved.type} from ${fromIndex} to ${toIndex}`);
    }

    /** Set new order by effect type array */
    reorderByTypes(order: EffectType[]): void {
        const reordered: AudioEffect[] = [];
        for (const type of order) {
            const effect = this.effects.find(e => e.type === type);
            if (effect) {
                reordered.push(effect);
            }
        }

        // Keep any effects not in the order list at the end
        for (const effect of this.effects) {
            if (!reordered.includes(effect)) {
                reordered.push(effect);
            }
        }

        this.effects = reordered;
        this.rebuildConnections();
    }

    // ─── Effect Access ──────────────────────────────────────────

    /** Get effect by type */
    getEffect(type: EffectType): AudioEffect | undefined {
        return this.effects.find(e => e.type === type);
    }

    /** Get all effects in chain order */
    getEffects(): AudioEffect[] {
        return [...this.effects];
    }

    /** Get the ordered list of effect types */
    getOrder(): EffectType[] {
        return this.effects.map(e => e.type);
    }

    /** Count of enabled effects */
    getActiveCount(): number {
        return this.effects.filter(e => e.enabled).length;
    }

    // ─── Effect Control ─────────────────────────────────────────

    setEffectEnabled(type: EffectType, enabled: boolean): void {
        const effect = this.getEffect(type);
        if (effect) {
            effect.setEnabled(enabled);
            // If bypassed, update logic is tricky. 
            // If we enable an effect while bypassed, should we un-bypass? 
            // Or just update the saved state?
            // "Mechanic already implemented in Sound Effects":
            // In SoundEffectsApp, toggling an individual effect didn't used to affect bypass state.
            // But if we are bypassed, the effect shouldn't actually turn on.
            if (this._bypassed) {
                // Update saved state instead
                this._savedEnabledStates.set(type, enabled);
                // Ensure it stays disabled in reality
                effect.setEnabled(false);
            } else {
                effect.setEnabled(enabled);
            }
        }
    }

    setEffectParam(type: EffectType, paramId: string, value: any): void {
        const effect = this.getEffect(type);
        if (effect) {
            effect.setParam(paramId, value);
        }
    }

    setEffectMix(type: EffectType, mix: number): void {
        const effect = this.getEffect(type);
        if (effect) {
            effect.setMix(mix);
        }
    }

    // ─── Add / Remove ───────────────────────────────────────────

    /** Add a new effect at the end of the chain (or at specified index) */
    addEffect(type: EffectType, atIndex?: number): AudioEffect | null {
        // Prevent duplicates
        if (this.getEffect(type)) {
            Logger.warn(`EffectChain [${this.channel}]: effect ${type} already in chain`);
            return null;
        }

        const effect = createEffect(this.ctx, type);

        if (atIndex !== undefined && atIndex >= 0 && atIndex <= this.effects.length) {
            this.effects.splice(atIndex, 0, effect);
        } else {
            this.effects.push(effect);
        }

        // If bypassed, new effect should start disabled but maybe 'enabled' in saved state?
        // Default is disabled anyway.
        if (this._bypassed) {
            this._savedEnabledStates.set(type, false);
            effect.setEnabled(false);
        }

        this.rebuildConnections();
        Logger.debug(`EffectChain [${this.channel}]: added ${type}`);
        return effect;
    }

    /** Remove an effect from the chain */
    removeEffect(type: EffectType): boolean {
        const index = this.effects.findIndex(e => e.type === type);
        if (index === -1) return false;

        const [removed] = this.effects.splice(index, 1);
        removed.dispose();

        if (this._bypassed) {
            this._savedEnabledStates.delete(type);
        }

        this.rebuildConnections();

        Logger.debug(`EffectChain [${this.channel}]: removed ${type}`);
        return true;
    }

    // ─── State ──────────────────────────────────────────────────

    /** Get full chain state for serialization / sync */
    getState(): ChannelChain {
        const savedStateObj: Record<string, boolean> = {};
        for (const [key, val] of this._savedEnabledStates) {
            savedStateObj[key] = val;
        }

        return {
            channel: this.channel,
            effects: this.effects.map(e => e.getChainState()),
            bypassed: this._bypassed,
            savedEnabledStates: this._bypassed ? savedStateObj : undefined
        };
    }

    // ─── Cleanup ────────────────────────────────────────────────

    private disposeEffects(): void {
        for (const effect of this.effects) {
            effect.dispose();
        }
        this.effects = [];
    }

    dispose(): void {
        this.disposeEffects();
        this.inputNode.disconnect();
        this.muteNode.disconnect();
        this.outputNode.disconnect();
    }
}
