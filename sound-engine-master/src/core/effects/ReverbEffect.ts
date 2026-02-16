import { AudioEffect } from './AudioEffect';
import { Logger } from '@utils/logger';

export class ReverbEffect extends AudioEffect {
    private convolverNode: ConvolverNode;

    constructor(ctx: AudioContext, id?: string) {
        super(ctx, 'reverb', id);
        this.convolverNode = ctx.createConvolver();
        this.convolverNode.normalize = false; // Disable normalization to keep volume levels predictably high

        this.addParam({
            id: 'decay',
            name: 'Decay Time',
            type: 'float',
            value: 2.0,
            defaultValue: 2.0,
            min: 0.1,
            max: 10.0,
            step: 0.1,
            suffix: 's'
        });

        this.addParam({
            id: 'size',
            name: 'Room Size',
            type: 'float',
            value: 1.0,
            defaultValue: 1.0,
            min: 0.1,
            max: 3.0,
            step: 0.1,
            suffix: 'x'
        });

        this.addParam({
            id: 'tone',
            name: 'Tone (Video)',
            type: 'select',
            value: 'default',
            defaultValue: 'default',
            options: [
                { label: 'Standard', value: 'default' },
                { label: 'Dark', value: 'dark' },
                { label: 'Bright', value: 'bright' }
            ]
        });

        this.buildGraph();
        this.updateImpulse();
    }

    protected buildGraph(): void {
        this.inputNode.connect(this.convolverNode);
        this.convolverNode.connect(this.wetNode);
    }

    protected applyParam(key: string, value: any): void {
        if (key === 'decay' || key === 'size' || key === 'tone') {
            this.updateImpulse();
        }
    }

    /**
     * Re-generates global impulse based on current parameters
     */
    private updateImpulse(): void {
        const decayTime = (this.params.get('decay')?.value as number) || 2.0;
        const sizeMult = (this.params.get('size')?.value as number) || 1.0;
        const tone = (this.params.get('tone')?.value as string) || 'default';

        // Base duration = decay time * size multiplier (roughly)
        const duration = decayTime * sizeMult;

        // Tone affects the initial burst or the noise "color"
        // For simple synthesis, we can affect how fast it decays initially vs late tail.
        // Dark = faster high freq decay (simulated by decay curve power)
        let decayCurvePower = 2.0;
        if (tone === 'dark') decayCurvePower = 3.0; // Decay faster (perceptually)
        if (tone === 'bright') decayCurvePower = 1.5; // Sustain noise longer

        this.generateSimpleImpulse(duration, decayCurvePower);
    }

    /**
     * Generates a simple synthetic impulse response (white noise with exponential decay)
     */
    private generateSimpleImpulse(duration: number, decayPower: number): void {
        // Safety clamps
        if (duration <= 0.01) duration = 0.01;

        const rate = this.ctx.sampleRate;
        const length = Math.floor(rate * duration);
        const impulse = this.ctx.createBuffer(2, length, rate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const n = i / length;
            // Exponential decay
            const gain = Math.pow(1 - n, decayPower);

            // SIGNIFICANTLY reduce gain to prevent volume boosting.
            // A long reverb impulse sums up to a lot of energy.
            // 0.05 seems conservative but safe for "adding" ambience without overpowering dry.
            const volumeScale = 0.05;

            left[i] = (Math.random() * 2 - 1) * gain * volumeScale;
            right[i] = (Math.random() * 2 - 1) * gain * volumeScale;
        }

        this.convolverNode.buffer = impulse;
    }
}
