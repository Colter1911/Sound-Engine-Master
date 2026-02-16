import { AudioEffect } from './AudioEffect';

export class DistortionEffect extends AudioEffect {
    private shaperNode: WaveShaperNode;
    private preGain: GainNode;

    constructor(ctx: AudioContext, id?: string) {
        super(ctx, 'distortion', id);
        this.shaperNode = ctx.createWaveShaper();
        this.shaperNode.oversample = '4x';
        this.preGain = ctx.createGain();

        this.addParam({
            id: 'drive',
            name: 'Drive',
            type: 'float',
            value: 0,
            defaultValue: 0,
            min: 0,
            max: 100,
            step: 1,
            suffix: '%'
        });

        this.buildGraph();
        this.updateCurve(0);
    }

    protected buildGraph(): void {
        // Input -> PreGain (Drive) -> WaveShaper -> WetNode
        this.inputNode.connect(this.preGain);
        this.preGain.connect(this.shaperNode);
        this.shaperNode.connect(this.wetNode);
    }

    protected applyParam(key: string, value: any): void {
        if (key === 'drive') {
            const driveAmount = value as number;
            this.updateCurve(driveAmount);

            // Apply input gain (pre-drive)
            // 0% -> 1.0 (0dB)
            // 100% -> 20.0 (+26dB) - significant boost to force clipping
            // Using exponential curve for more natural feel
            const gain = 1 + (driveAmount / 5);
            this.preGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);
        }
    }

    private updateCurve(amount: number): void {
        const k = amount; // 0-100

        if (k === 0) {
            this.shaperNode.curve = null;
            return;
        }

        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;

        // Improved output compensation - as we drive harder, we might want to normalize the curve
        // slightly differently, but standard waveshaping usually stays within -1..1 range on Y axis.

        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;

            // Sigmoid function: (1+k)*x / (1+k*|x|)
            // k needs to be scaled up to make the curve sharper
            // 0-100 is linear, let's map it to 0-1000 for the formula
            const k_scaled = k * 2;

            // Standard soft-clipping formula
            curve[i] = ((k_scaled + 20) * x) / (20 + k_scaled * Math.abs(x));
        }

        this.shaperNode.curve = curve;
    }
}
