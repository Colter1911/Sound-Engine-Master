import type { TrackGroup, PlaybackState } from '@t/audio';
import { Logger } from '@utils/logger';

export class StreamingPlayer {
  readonly id: string;
  private ctx: AudioContext;
  private _group: TrackGroup;
  private _url: string = '';

  private audio: HTMLAudioElement;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode;
  private outputNode: GainNode;

  private _state: PlaybackState = 'stopped';
  private _volume: number = 1;
  private _ready: boolean = false;
  private _stopRequested: boolean = false;

  public onEnded?: () => void;

  constructor(
    id: string,
    ctx: AudioContext,
    channelOutput: GainNode,
    group: TrackGroup = 'music'
  ) {
    this.id = id;
    this.ctx = ctx;
    this._group = group;

    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'auto';

    this.gainNode = ctx.createGain();
    this.outputNode = ctx.createGain();

    this.gainNode.connect(this.outputNode);
    this.outputNode.connect(channelOutput);

    this.setupAudioEvents();
  }

  private setupAudioEvents(): void {
    this.audio.addEventListener('canplay', () => {
      this._ready = true;
      if (this._state === 'loading') {
        this._state = 'stopped';
      }
      Logger.debug(`Track ${this.id} ready to play`);
    });

    this.audio.addEventListener('ended', () => {
      // PlaybackScheduler handles track progression based on playbackMode
      this._state = 'stopped';
      Logger.debug(`Track ${this.id} ended`);
      this.onEnded?.();
    });

    this.audio.addEventListener('error', (e) => {
      // Ignore errors if we are disposing (src cleared)
      if (this.audio.getAttribute('src') === '' || !this.audio.src) return;

      Logger.error(`Track ${this.id} error:`, this.audio.error);
      this._state = 'stopped';
    });
  }

  get state(): PlaybackState {
    return this._state;
  }

  get group(): TrackGroup {
    return this._group;
  }

  get url(): string {
    return this._url;
  }

  get volume(): number {
    return this._volume;
  }

  get ready(): boolean {
    return this._ready;
  }

  async load(url: string): Promise<void> {
    this._state = 'loading';
    this._url = url;
    this._ready = false;

    return new Promise((resolve, reject) => {
      const onCanPlay = () => {
        this.audio.removeEventListener('canplay', onCanPlay);
        this.audio.removeEventListener('error', onError);

        // Connect to Web Audio
        if (!this.sourceNode) {
          this.sourceNode = this.ctx.createMediaElementSource(this.audio);
          this.sourceNode.connect(this.gainNode);
        }

        this._ready = true;
        this._state = 'stopped';
        Logger.debug(`Track loaded: ${this.id}`);
        resolve();
      };

      const onError = () => {
        this.audio.removeEventListener('canplay', onCanPlay);
        this.audio.removeEventListener('error', onError);
        this._state = 'stopped';
        reject(new Error(`Failed to load: ${url}`));
      };

      this.audio.addEventListener('canplay', onCanPlay, { once: true });
      this.audio.addEventListener('error', onError, { once: true });

      this.audio.src = url;
      this.audio.load();
    });
  }

  async play(offset: number = 0): Promise<void> {
    if (!this._ready) {
      Logger.warn(`Track ${this.id} not ready`);
      return;
    }

    // Reset stop flag at the start of play
    this._stopRequested = false;

    try {
      this.audio.currentTime = Math.max(0, Math.min(offset, this.audio.duration || 0));
      // Loop is disabled - PlaybackScheduler handles progression
      this.audio.loop = false;
      await this.audio.play();

      // Guard: if stop() was called during the async play(), don't overwrite state
      if (this._stopRequested) {
        Logger.debug(`Track ${this.id} play resolved but stop was requested — staying stopped`);
        return;
      }

      this._state = 'playing';
      Logger.debug(`Track ${this.id} playing from ${offset.toFixed(2)}s`);
    } catch (error) {
      // AbortError is expected when stop() interrupts play()
      if ((error as DOMException)?.name === 'AbortError') {
        Logger.debug(`Track ${this.id} play aborted (stop was called)`);
        return;
      }
      Logger.error(`Failed to play ${this.id}:`, error);
    }
  }

  pause(): void {
    if (this._state !== 'playing') return;

    this.audio.pause();
    this._state = 'paused';
    Logger.debug(`Track ${this.id} paused at ${this.audio.currentTime.toFixed(2)}s`);
  }

  stop(): void {
    // Set flag BEFORE pause — prevents pending play() promise from overwriting state
    this._stopRequested = true;
    this.audio.pause();
    this.audio.currentTime = 0;
    this._state = 'stopped';
    Logger.debug(`Track ${this.id} stopped`);
  }

  seek(time: number): void {
    const safeTime = Math.max(0, Math.min(time, this.audio.duration || 0));
    this.audio.currentTime = safeTime;
  }

  setVolume(value: number): void {
    this._volume = Math.max(0, Math.min(1, value));
    this.gainNode.gain.setValueAtTime(this._volume, this.ctx.currentTime);
  }


  setChannel(newGroup: TrackGroup, newOutput: GainNode): void {
    this._group = newGroup;
    this.outputNode.disconnect();
    this.outputNode.connect(newOutput);
  }

  getCurrentTime(): number {
    return this.audio.currentTime;
  }

  getDuration(): number {
    return this.audio.duration || 0;
  }

  getState() {
    return {
      id: this.id,
      url: this._url,
      group: this._group,
      playbackState: this._state,
      volume: this._volume,
      currentTime: this.getCurrentTime(),
      duration: this.getDuration()
    };
  }

  dispose(): void {
    this._stopRequested = true;
    this.audio.pause();
    this.audio.src = '';
    this.onEnded = undefined;
    this.sourceNode?.disconnect();
    this.gainNode.disconnect();
    this.outputNode.disconnect();
    Logger.debug(`Track ${this.id} disposed`);
  }
}