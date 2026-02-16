import { AudioEffect } from './AudioEffect';

export class FilterEffect extends AudioEffect {
    private filterNode: BiquadFilterNode;

    constructor(ctx: AudioContext, id?: string) {
        super(ctx, 'filter', id);
        this.filterNode = ctx.createBiquadFilter();

        this.addParam({
            id: 'type',
            name: 'Type',
            type: 'select',
            value: 'lowpass',
            defaultValue: 'lowpass',
            options: [
                { label: 'Lowpass', value: 'lowpass' },
                { label: 'Highpass', value: 'highpass' },
                { label: 'Bandpass', value: 'bandpass' },
                { label: 'Peaking', value: 'peaking' }
            ]
        });

        this.addParam({
            id: 'frequency',
            name: 'Frequency',
            type: 'float',
            value: 1000,
            defaultValue: 1000,
            min: 20,
            max: 20000,
            step: 10,
            suffix: 'Hz'
        });

        this.addParam({
            id: 'Q',
            name: 'Resonance',
            type: 'float',
            value: 1,
            defaultValue: 1,
            min: 0.1,
            max: 10,
            step: 0.1,
            suffix: ''
        });

        this.buildGraph();
        this.applyParam('type', 'lowpass');
        this.applyParam('frequency', 1000);
    }

    protected buildGraph(): void {
        this.inputNode.connect(this.filterNode);
        this.filterNode.connect(this.wetNode);
    }

    protected applyParam(key: string, value: any): void {
        switch (key) {
            case 'type':
                this.filterNode.type = value as BiquadFilterType;
                break;
            case 'frequency':
                this.filterNode.frequency.setTargetAtTime(value as number, this.ctx.currentTime, 0.05);
                break;
            case 'Q':
                this.filterNode.Q.setTargetAtTime(value as number, this.ctx.currentTime, 0.05);
                break;
        }
    }
}
