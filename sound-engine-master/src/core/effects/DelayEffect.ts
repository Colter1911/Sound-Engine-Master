import { AudioEffect } from './AudioEffect';
import { Logger } from '@utils/logger';

export class DelayEffect extends AudioEffect {
    private delayNode: DelayNode;
    private feedbackNode: GainNode;

    constructor(ctx: AudioContext, id?: string) {
        super(ctx, 'delay', id);
        this.delayNode = ctx.createDelay(5.0); // Max delay 5s
        this.feedbackNode = ctx.createGain();

        this.addParam({
            id: 'time',
            name: 'Time',
            type: 'float',
            value: 0.3,
            defaultValue: 0.3,
            min: 0,
            max: 2.0,
            step: 0.01,
            suffix: 's'
        });

        this.addParam({
            id: 'feedback',
            name: 'Feedback',
            type: 'float',
            value: 0.4,
            defaultValue: 0.4,
            min: 0,
            max: 0.9,
            step: 0.01,
            suffix: ''
        });

        this.buildGraph();
        this.applyParam('time', 0.3);
        this.applyParam('feedback', 0.4);
    }

    protected buildGraph(): void {
        // Input -> Delay -> Output
        //      |-> Feedback -> Delay

        // Connect Input to Delay
        this.inputNode.connect(this.delayNode);

        // Connect Delay to Wet Output
        this.delayNode.connect(this.wetNode);

        // Feedback Loop: Delay -> Feedback -> Delay
        this.delayNode.connect(this.feedbackNode);
        this.feedbackNode.connect(this.delayNode);
    }

    protected applyParam(key: string, value: any): void {
        switch (key) {
            case 'time':
                this.delayNode.delayTime.setTargetAtTime(value as number, this.ctx.currentTime, 0.05);
                break;
            case 'feedback':
                this.feedbackNode.gain.setTargetAtTime(value as number, this.ctx.currentTime, 0.05);
                break;
        }
    }
}
