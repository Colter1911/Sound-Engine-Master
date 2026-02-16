import { AudioEffect } from './AudioEffect';

export class CompressorEffect extends AudioEffect {
    private compressorNode: DynamicsCompressorNode;
    private makeupNode: GainNode;

    constructor(ctx: AudioContext, id?: string) {
        super(ctx, 'compressor', id);
        this.compressorNode = ctx.createDynamicsCompressor();
        this.makeupNode = ctx.createGain();

        this.addParam({
            id: 'threshold',
            name: 'Threshold',
            type: 'float',
            value: -12,
            defaultValue: -12,
            min: -60,
            max: 0,
            step: 1,
            suffix: 'dB'
        });

        this.addParam({
            id: 'ratio',
            name: 'Ratio',
            type: 'float',
            value: 4,
            defaultValue: 4,
            min: 1,
            max: 20,
            step: 0.5,
            suffix: ':1'
        });

        this.addParam({
            id: 'knee',
            name: 'Knee',
            type: 'float',
            value: 10,
            defaultValue: 10,
            min: 0,
            max: 40,
            step: 1,
            suffix: 'dB'
        });

        this.addParam({
            id: 'attack',
            name: 'Attack',
            type: 'float',
            value: 0.01,
            defaultValue: 0.01,
            min: 0.001,
            max: 0.5,
            step: 0.001,
            suffix: 's'
        });

        this.addParam({
            id: 'release',
            name: 'Release',
            type: 'float',
            value: 0.15,
            defaultValue: 0.15,
            min: 0.01,
            max: 1.0,
            step: 0.01,
            suffix: 's'
        });

        this.buildGraph();
        this.applyParam('threshold', -12);
        this.applyParam('ratio', 4);
        this.applyParam('knee', 10);
        this.applyParam('attack', 0.01);
        this.applyParam('release', 0.15);
    }

    protected buildGraph(): void {
        this.inputNode.connect(this.compressorNode);
        this.compressorNode.connect(this.makeupNode);
        this.makeupNode.connect(this.wetNode);
    }

    protected applyParam(key: string, value: any): void {
        const t = this.ctx.currentTime;
        switch (key) {
            case 'threshold':
                this.compressorNode.threshold.setTargetAtTime(value as number, t, 0.05);
                this.updateMakeupGain();
                break;
            case 'ratio':
                this.compressorNode.ratio.setTargetAtTime(value as number, t, 0.05);
                this.updateMakeupGain();
                break;
            case 'knee':
                this.compressorNode.knee.setTargetAtTime(value as number, t, 0.05);
                break;
            case 'attack':
                this.compressorNode.attack.setTargetAtTime(value as number, t, 0.05);
                break;
            case 'release':
                this.compressorNode.release.setTargetAtTime(value as number, t, 0.05);
                break;
        }
    }

    private updateMakeupGain(): void {
        const threshold = this.compressorNode.threshold.value;
        const ratio = this.compressorNode.ratio.value;

        // Proper makeup gain: compensate for gain reduction above threshold.
        // GR(dB) = -threshold * (1 - 1/ratio) for signals at 0dBFS.
        // Apply ~40% of that as makeup to keep levels moderate.
        let makeupDb = 0;
        if (threshold < 0 && ratio > 1) {
            makeupDb = (-threshold * (1 - 1 / ratio)) * 0.4;
        }

        // Cap makeup gain to avoid runaway volume
        makeupDb = Math.min(makeupDb, 12);

        const makeupGain = Math.pow(10, makeupDb / 20);
        this.makeupNode.gain.setTargetAtTime(makeupGain, this.ctx.currentTime, 0.05);
    }
}
