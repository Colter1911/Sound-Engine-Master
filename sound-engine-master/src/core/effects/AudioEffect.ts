import type { ChainEffectState, EffectType, EffectParam } from '@t/effects';
import { DEFAULT_MIX } from '@t/effects';
import { Logger } from '@utils/logger';

export abstract class AudioEffect {
    public readonly id: string;
    public readonly type: EffectType;
    public enabled: boolean = false;

    protected ctx: AudioContext;
    public inputNode: GainNode;
    public outputNode: GainNode;
    protected wetNode: GainNode;
    protected dryNode: GainNode;

    /** Current dry/wet mix: 0.0 = fully dry, 1.0 = fully wet */
    private _mix: number;

    protected params: Map<string, EffectParam> = new Map();

    constructor(ctx: AudioContext, type: EffectType, id?: string) {
        this.ctx = ctx;
        this.type = type;
        this.id = id || type;
        this._mix = DEFAULT_MIX[type] ?? 1.0;

        // Create nodes
        this.inputNode = ctx.createGain();
        this.outputNode = ctx.createGain();
        this.wetNode = ctx.createGain();
        this.dryNode = ctx.createGain();

        // Signal flow:
        // inputNode ──┬── dryNode ──┬── outputNode
        //             └── [effect processing] ── wetNode ──┘
        this.inputNode.connect(this.dryNode);
        this.dryNode.connect(this.outputNode);
        this.wetNode.connect(this.outputNode);

        // Add generic Output Level parameter
        this.addParam({
            id: 'level',
            name: 'Output Level',
            type: 'float',
            value: 1.0,
            defaultValue: 1.0,
            min: 0,
            max: 2.0,
            step: 0.01,
            suffix: ''
        });

        // Apply initial state: disabled = true bypass
        this.setEnabled(this.enabled);
    }

    // ─── Sanitization Helper ────────────────────────────────────

    /**
     * Sanitize a float value: must be finite and within [min, max].
     * Returns fallback if invalid.
     */
    private sanitizeFloat(value: any, min: number, max: number, fallback: number): number {
        if (value === null || value === undefined || typeof value !== 'number' || !isFinite(value)) {
            return fallback;
        }
        return Math.max(min, Math.min(max, value));
    }

    // ─── Mix Control ────────────────────────────────────────────

    /** Get current mix value */
    get mix(): number {
        return this._mix;
    }

    /**
     * Set dry/wet mix.
     * 0.0 = fully dry (signal passes through untouched)
     * 1.0 = fully wet (100% effect processing)
     */
    public setMix(mix: number): void {
        this._mix = this.sanitizeFloat(mix, 0, 1, this._mix);
        // Only apply mix gains if effect is enabled; bypass overrides
        if (this.enabled) {
            this.applyMixGains();
        }
    }

    /** Apply the current mix values to dry/wet nodes */
    private applyMixGains(): void {
        const t = this.ctx.currentTime;
        this.dryNode.gain.setTargetAtTime(1.0 - this._mix, t, 0.02);
        this.wetNode.gain.setTargetAtTime(this._mix, t, 0.02);
    }

    // ─── Enable / Bypass ────────────────────────────────────────

    /**
     * Enable/Disable effect processing.
     * Disabled = true bypass: dry gain = 1.0, wet gain = 0.0, output gain = 1.0 (Unity)
     * Enabled = apply current mix and level values
     */
    public setEnabled(enabled: boolean): void {
        this.enabled = !!enabled; // Ensure boolean
        const t = this.ctx.currentTime;
        const level = (this.getParamValue('level') as number) ?? 1.0;

        if (this.enabled) {
            this.applyMixGains();
            // Restore user-defined output level
            this.outputNode.gain.setTargetAtTime(level, t, 0.02);
        } else {
            // True bypass: full dry, no wet, UNITY GAIN output
            this.dryNode.gain.setTargetAtTime(1.0, t, 0.02);
            this.wetNode.gain.setTargetAtTime(0.0, t, 0.02);
            // Force Unity Gain so disabled effect doesn't attenuate signal
            this.outputNode.gain.setTargetAtTime(1.0, t, 0.02);
        }
    }

    // ─── Chain Connection API ───────────────────────────────────

    /** Connect this effect's output to the next effect's input */
    public connectToNext(next: AudioEffect): void {
        this.outputNode.connect(next.inputNode);
    }

    /** Connect this effect's output to a destination node */
    public connectToDestination(destination: AudioNode): void {
        this.outputNode.connect(destination);
    }

    /** Disconnect output from everything */
    public disconnectOutput(): void {
        this.outputNode.disconnect();
    }

    // ─── Parameter API ──────────────────────────────────────────

    public setParam(key: string, value: any): void {
        const param = this.params.get(key);
        if (!param) {
            Logger.warn(`Effect ${this.type} has no parameter '${key}'`);
            return;
        }

        let safeValue: any = value;

        // Sanitize based on param type
        const pType = param.type as string; // Fix lint: 'range' might not be in EffectParamType union in legacy definitions

        if (pType === 'float' || pType === 'range') {
            safeValue = this.sanitizeFloat(
                value as number, // Fix lint: cast to number
                param.min ?? -Infinity,
                param.max ?? Infinity,
                (param.defaultValue as number) ?? (param.value as number)
            );
        } else if (pType === 'select') {
            const validOption = param.options?.some(opt => opt.value === value);
            if (!validOption) {
                Logger.warn(`Invalid value '${value}' for select param '${key}' in effect '${this.type}'. Fallback to default.`);
                safeValue = param.defaultValue;
            }
        }

        Logger.debug(`Effect ${this.type} (${this.id}) setting ${key} to`, safeValue);
        // Update stored param value
        param.value = safeValue;

        if (key === 'level') {
            // Only update gain node if enabled. 
            // If disabled, we store the value but keep Unity Gain (1.0) on node.
            if (this.enabled) {
                this.outputNode.gain.setTargetAtTime(safeValue as number, this.ctx.currentTime, 0.05);
            }
        } else {
            this.applyParam(key, safeValue);
        }
    }

    public getParamValue(key: string): number | boolean | string | undefined {
        return this.params.get(key)?.value;
    }

    public getAllParams(): Map<string, EffectParam> {
        return this.params;
    }

    // ─── State ──────────────────────────────────────────────────

    /** Get chain-compatible state */
    public getChainState(): ChainEffectState {
        const paramsObj: Record<string, any> = {};
        for (const [key, param] of this.params) {
            paramsObj[key] = param.value;
        }

        return {
            type: this.type,
            enabled: this.enabled,
            mix: this._mix,
            params: paramsObj,
        };
    }

    /** Restore state from a ChainEffectState */
    public restoreChainState(state: ChainEffectState): void {
        // Sanitize mix
        this._mix = this.sanitizeFloat(state.mix, 0, 1, DEFAULT_MIX[this.type] ?? 1.0);

        // Sanitize parameters by going through setParam validation
        for (const [key, value] of Object.entries(state.params)) {
            // We use setParam internal logic to validate against the existing param definition
            this.setParam(key, value);
        }

        // setEnabled also applies mix gains
        this.setEnabled(state.enabled);
    }

    // ─── Abstract (subclass) ────────────────────────────────────

    protected addParam(param: EffectParam): void {
        this.params.set(param.id, param);
    }

    protected abstract applyParam(key: string, value: any): void;

    /** Subclass connects: this.inputNode -> [EffectNodes] -> this.wetNode */
    protected abstract buildGraph(): void;

    // ─── Cleanup ────────────────────────────────────────────────

    public dispose(): void {
        this.inputNode.disconnect();
        this.outputNode.disconnect();
        this.wetNode.disconnect();
        this.dryNode.disconnect();
    }
}
