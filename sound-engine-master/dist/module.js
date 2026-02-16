var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var _a;
const DEFAULT_MIX = {
  filter: 1,
  compressor: 1,
  distortion: 1,
  delay: 0.3,
  reverb: 0.35,
  modulation: 0.5
};
const DEFAULT_CHAIN_ORDER = [
  "filter",
  "compressor",
  "distortion",
  "delay",
  "reverb"
];
const PREFIX = "SEM";
const READY_MESSAGE = "Sound Engine Master ready";
const Logger = {
  info: /* @__PURE__ */ __name((message) => {
    if (message === READY_MESSAGE) {
      console.log(`${PREFIX} | ${message}`);
    }
  }, "info"),
  warn: /* @__PURE__ */ __name((_message, ..._args) => {
  }, "warn"),
  error: /* @__PURE__ */ __name((_message, ..._args) => {
  }, "error"),
  debug: /* @__PURE__ */ __name((_message, ..._args) => {
  }, "debug")
};
const _StreamingPlayer = class _StreamingPlayer {
  constructor(id, ctx, channelOutput, group = "music") {
    __publicField(this, "id");
    __publicField(this, "ctx");
    __publicField(this, "_group");
    __publicField(this, "_url", "");
    __publicField(this, "audio");
    __publicField(this, "sourceNode", null);
    __publicField(this, "gainNode");
    __publicField(this, "outputNode");
    __publicField(this, "_state", "stopped");
    __publicField(this, "_volume", 1);
    __publicField(this, "_ready", false);
    __publicField(this, "_stopRequested", false);
    __publicField(this, "onEnded");
    this.id = id;
    this.ctx = ctx;
    this._group = group;
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";
    this.gainNode = ctx.createGain();
    this.outputNode = ctx.createGain();
    this.gainNode.connect(this.outputNode);
    this.outputNode.connect(channelOutput);
    this.setupAudioEvents();
  }
  setupAudioEvents() {
    this.audio.addEventListener("canplay", () => {
      this._ready = true;
      if (this._state === "loading") {
        this._state = "stopped";
      }
      Logger.debug(`Track ${this.id} ready to play`);
    });
    this.audio.addEventListener("ended", () => {
      var _a2;
      this._state = "stopped";
      Logger.debug(`Track ${this.id} ended`);
      (_a2 = this.onEnded) == null ? void 0 : _a2.call(this);
    });
    this.audio.addEventListener("error", (e) => {
      if (this.audio.getAttribute("src") === "" || !this.audio.src) return;
      Logger.error(`Track ${this.id} error:`, this.audio.error);
      this._state = "stopped";
    });
  }
  get state() {
    return this._state;
  }
  get group() {
    return this._group;
  }
  get url() {
    return this._url;
  }
  get volume() {
    return this._volume;
  }
  get ready() {
    return this._ready;
  }
  async load(url) {
    this._state = "loading";
    this._url = url;
    this._ready = false;
    return new Promise((resolve, reject) => {
      const onCanPlay = /* @__PURE__ */ __name(() => {
        this.audio.removeEventListener("canplay", onCanPlay);
        this.audio.removeEventListener("error", onError);
        if (!this.sourceNode) {
          this.sourceNode = this.ctx.createMediaElementSource(this.audio);
          this.sourceNode.connect(this.gainNode);
        }
        this._ready = true;
        this._state = "stopped";
        Logger.debug(`Track loaded: ${this.id}`);
        resolve();
      }, "onCanPlay");
      const onError = /* @__PURE__ */ __name(() => {
        this.audio.removeEventListener("canplay", onCanPlay);
        this.audio.removeEventListener("error", onError);
        this._state = "stopped";
        reject(new Error(`Failed to load: ${url}`));
      }, "onError");
      this.audio.addEventListener("canplay", onCanPlay, { once: true });
      this.audio.addEventListener("error", onError, { once: true });
      this.audio.src = url;
      this.audio.load();
    });
  }
  async play(offset = 0) {
    if (!this._ready) {
      Logger.warn(`Track ${this.id} not ready`);
      return;
    }
    this._stopRequested = false;
    try {
      this.audio.currentTime = Math.max(0, Math.min(offset, this.audio.duration || 0));
      this.audio.loop = false;
      await this.audio.play();
      if (this._stopRequested) {
        Logger.debug(`Track ${this.id} play resolved but stop was requested — staying stopped`);
        return;
      }
      this._state = "playing";
      Logger.debug(`Track ${this.id} playing from ${offset.toFixed(2)}s`);
    } catch (error) {
      if ((error == null ? void 0 : error.name) === "AbortError") {
        Logger.debug(`Track ${this.id} play aborted (stop was called)`);
        return;
      }
      Logger.error(`Failed to play ${this.id}:`, error);
    }
  }
  pause() {
    if (this._state !== "playing") return;
    this.audio.pause();
    this._state = "paused";
    Logger.debug(`Track ${this.id} paused at ${this.audio.currentTime.toFixed(2)}s`);
  }
  stop() {
    this._stopRequested = true;
    this.audio.pause();
    this.audio.currentTime = 0;
    this._state = "stopped";
    Logger.debug(`Track ${this.id} stopped`);
  }
  seek(time) {
    const safeTime = Math.max(0, Math.min(time, this.audio.duration || 0));
    this.audio.currentTime = safeTime;
  }
  setVolume(value) {
    this._volume = Math.max(0, Math.min(1, value));
    this.gainNode.gain.setValueAtTime(this._volume, this.ctx.currentTime);
  }
  setChannel(newGroup, newOutput) {
    this._group = newGroup;
    this.outputNode.disconnect();
    this.outputNode.connect(newOutput);
  }
  getCurrentTime() {
    return this.audio.currentTime;
  }
  getDuration() {
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
  dispose() {
    var _a2;
    this._stopRequested = true;
    this.audio.pause();
    this.audio.src = "";
    this.onEnded = void 0;
    (_a2 = this.sourceNode) == null ? void 0 : _a2.disconnect();
    this.gainNode.disconnect();
    this.outputNode.disconnect();
    Logger.debug(`Track ${this.id} disposed`);
  }
};
__name(_StreamingPlayer, "StreamingPlayer");
let StreamingPlayer = _StreamingPlayer;
const _AudioEffect = class _AudioEffect {
  constructor(ctx, type, id) {
    __publicField(this, "id");
    __publicField(this, "type");
    __publicField(this, "enabled", false);
    __publicField(this, "ctx");
    __publicField(this, "inputNode");
    __publicField(this, "outputNode");
    __publicField(this, "wetNode");
    __publicField(this, "dryNode");
    /** Current dry/wet mix: 0.0 = fully dry, 1.0 = fully wet */
    __publicField(this, "_mix");
    __publicField(this, "params", /* @__PURE__ */ new Map());
    this.ctx = ctx;
    this.type = type;
    this.id = id || type;
    this._mix = DEFAULT_MIX[type] ?? 1;
    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();
    this.wetNode = ctx.createGain();
    this.dryNode = ctx.createGain();
    this.inputNode.connect(this.dryNode);
    this.dryNode.connect(this.outputNode);
    this.wetNode.connect(this.outputNode);
    this.addParam({
      id: "level",
      name: "Output Level",
      type: "float",
      value: 1,
      defaultValue: 1,
      min: 0,
      max: 2,
      step: 0.01,
      suffix: ""
    });
    this.setEnabled(this.enabled);
  }
  // ─── Sanitization Helper ────────────────────────────────────
  /**
   * Sanitize a float value: must be finite and within [min, max].
   * Returns fallback if invalid.
   */
  sanitizeFloat(value, min, max, fallback) {
    if (value === null || value === void 0 || typeof value !== "number" || !isFinite(value)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, value));
  }
  // ─── Mix Control ────────────────────────────────────────────
  /** Get current mix value */
  get mix() {
    return this._mix;
  }
  /**
   * Set dry/wet mix.
   * 0.0 = fully dry (signal passes through untouched)
   * 1.0 = fully wet (100% effect processing)
   */
  setMix(mix) {
    this._mix = this.sanitizeFloat(mix, 0, 1, this._mix);
    if (this.enabled) {
      this.applyMixGains();
    }
  }
  /** Apply the current mix values to dry/wet nodes */
  applyMixGains() {
    const t = this.ctx.currentTime;
    this.dryNode.gain.setTargetAtTime(1 - this._mix, t, 0.02);
    this.wetNode.gain.setTargetAtTime(this._mix, t, 0.02);
  }
  // ─── Enable / Bypass ────────────────────────────────────────
  /**
   * Enable/Disable effect processing.
   * Disabled = true bypass: dry gain = 1.0, wet gain = 0.0, output gain = 1.0 (Unity)
   * Enabled = apply current mix and level values
   */
  setEnabled(enabled) {
    this.enabled = !!enabled;
    const t = this.ctx.currentTime;
    const level = this.getParamValue("level") ?? 1;
    if (this.enabled) {
      this.applyMixGains();
      this.outputNode.gain.setTargetAtTime(level, t, 0.02);
    } else {
      this.dryNode.gain.setTargetAtTime(1, t, 0.02);
      this.wetNode.gain.setTargetAtTime(0, t, 0.02);
      this.outputNode.gain.setTargetAtTime(1, t, 0.02);
    }
  }
  // ─── Chain Connection API ───────────────────────────────────
  /** Connect this effect's output to the next effect's input */
  connectToNext(next) {
    this.outputNode.connect(next.inputNode);
  }
  /** Connect this effect's output to a destination node */
  connectToDestination(destination) {
    this.outputNode.connect(destination);
  }
  /** Disconnect output from everything */
  disconnectOutput() {
    this.outputNode.disconnect();
  }
  // ─── Parameter API ──────────────────────────────────────────
  setParam(key, value) {
    var _a2;
    const param = this.params.get(key);
    if (!param) {
      Logger.warn(`Effect ${this.type} has no parameter '${key}'`);
      return;
    }
    let safeValue = value;
    const pType = param.type;
    if (pType === "float" || pType === "range") {
      safeValue = this.sanitizeFloat(
        value,
        // Fix lint: cast to number
        param.min ?? -Infinity,
        param.max ?? Infinity,
        param.defaultValue ?? param.value
      );
    } else if (pType === "select") {
      const validOption = (_a2 = param.options) == null ? void 0 : _a2.some((opt) => opt.value === value);
      if (!validOption) {
        Logger.warn(`Invalid value '${value}' for select param '${key}' in effect '${this.type}'. Fallback to default.`);
        safeValue = param.defaultValue;
      }
    }
    Logger.debug(`Effect ${this.type} (${this.id}) setting ${key} to`, safeValue);
    param.value = safeValue;
    if (key === "level") {
      if (this.enabled) {
        this.outputNode.gain.setTargetAtTime(safeValue, this.ctx.currentTime, 0.05);
      }
    } else {
      this.applyParam(key, safeValue);
    }
  }
  getParamValue(key) {
    var _a2;
    return (_a2 = this.params.get(key)) == null ? void 0 : _a2.value;
  }
  getAllParams() {
    return this.params;
  }
  // ─── State ──────────────────────────────────────────────────
  /** Get chain-compatible state */
  getChainState() {
    const paramsObj = {};
    for (const [key, param] of this.params) {
      paramsObj[key] = param.value;
    }
    return {
      type: this.type,
      enabled: this.enabled,
      mix: this._mix,
      params: paramsObj
    };
  }
  /** Restore state from a ChainEffectState */
  restoreChainState(state) {
    this._mix = this.sanitizeFloat(state.mix, 0, 1, DEFAULT_MIX[this.type] ?? 1);
    for (const [key, value] of Object.entries(state.params)) {
      this.setParam(key, value);
    }
    this.setEnabled(state.enabled);
  }
  // ─── Abstract (subclass) ────────────────────────────────────
  addParam(param) {
    this.params.set(param.id, param);
  }
  // ─── Cleanup ────────────────────────────────────────────────
  dispose() {
    this.inputNode.disconnect();
    this.outputNode.disconnect();
    this.wetNode.disconnect();
    this.dryNode.disconnect();
  }
};
__name(_AudioEffect, "AudioEffect");
let AudioEffect = _AudioEffect;
const _ReverbEffect = class _ReverbEffect extends AudioEffect {
  constructor(ctx, id) {
    super(ctx, "reverb", id);
    __publicField(this, "convolverNode");
    this.convolverNode = ctx.createConvolver();
    this.convolverNode.normalize = false;
    this.addParam({
      id: "decay",
      name: "Decay Time",
      type: "float",
      value: 2,
      defaultValue: 2,
      min: 0.1,
      max: 10,
      step: 0.1,
      suffix: "s"
    });
    this.addParam({
      id: "size",
      name: "Room Size",
      type: "float",
      value: 1,
      defaultValue: 1,
      min: 0.1,
      max: 3,
      step: 0.1,
      suffix: "x"
    });
    this.addParam({
      id: "tone",
      name: "Tone (Video)",
      type: "select",
      value: "default",
      defaultValue: "default",
      options: [
        { label: "Standard", value: "default" },
        { label: "Dark", value: "dark" },
        { label: "Bright", value: "bright" }
      ]
    });
    this.buildGraph();
    this.updateImpulse();
  }
  buildGraph() {
    this.inputNode.connect(this.convolverNode);
    this.convolverNode.connect(this.wetNode);
  }
  applyParam(key, value) {
    if (key === "decay" || key === "size" || key === "tone") {
      this.updateImpulse();
    }
  }
  /**
   * Re-generates global impulse based on current parameters
   */
  updateImpulse() {
    var _a2, _b, _c;
    const decayTime = ((_a2 = this.params.get("decay")) == null ? void 0 : _a2.value) || 2;
    const sizeMult = ((_b = this.params.get("size")) == null ? void 0 : _b.value) || 1;
    const tone = ((_c = this.params.get("tone")) == null ? void 0 : _c.value) || "default";
    const duration = decayTime * sizeMult;
    let decayCurvePower = 2;
    if (tone === "dark") decayCurvePower = 3;
    if (tone === "bright") decayCurvePower = 1.5;
    this.generateSimpleImpulse(duration, decayCurvePower);
  }
  /**
   * Generates a simple synthetic impulse response (white noise with exponential decay)
   */
  generateSimpleImpulse(duration, decayPower) {
    if (duration <= 0.01) duration = 0.01;
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = this.ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
      const n = i / length;
      const gain = Math.pow(1 - n, decayPower);
      const volumeScale = 0.05;
      left[i] = (Math.random() * 2 - 1) * gain * volumeScale;
      right[i] = (Math.random() * 2 - 1) * gain * volumeScale;
    }
    this.convolverNode.buffer = impulse;
  }
};
__name(_ReverbEffect, "ReverbEffect");
let ReverbEffect = _ReverbEffect;
const _DelayEffect = class _DelayEffect extends AudioEffect {
  constructor(ctx, id) {
    super(ctx, "delay", id);
    __publicField(this, "delayNode");
    __publicField(this, "feedbackNode");
    this.delayNode = ctx.createDelay(5);
    this.feedbackNode = ctx.createGain();
    this.addParam({
      id: "time",
      name: "Time",
      type: "float",
      value: 0.3,
      defaultValue: 0.3,
      min: 0,
      max: 2,
      step: 0.01,
      suffix: "s"
    });
    this.addParam({
      id: "feedback",
      name: "Feedback",
      type: "float",
      value: 0.4,
      defaultValue: 0.4,
      min: 0,
      max: 0.9,
      step: 0.01,
      suffix: ""
    });
    this.buildGraph();
    this.applyParam("time", 0.3);
    this.applyParam("feedback", 0.4);
  }
  buildGraph() {
    this.inputNode.connect(this.delayNode);
    this.delayNode.connect(this.wetNode);
    this.delayNode.connect(this.feedbackNode);
    this.feedbackNode.connect(this.delayNode);
  }
  applyParam(key, value) {
    switch (key) {
      case "time":
        this.delayNode.delayTime.setTargetAtTime(value, this.ctx.currentTime, 0.05);
        break;
      case "feedback":
        this.feedbackNode.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05);
        break;
    }
  }
};
__name(_DelayEffect, "DelayEffect");
let DelayEffect = _DelayEffect;
const _FilterEffect = class _FilterEffect extends AudioEffect {
  constructor(ctx, id) {
    super(ctx, "filter", id);
    __publicField(this, "filterNode");
    this.filterNode = ctx.createBiquadFilter();
    this.addParam({
      id: "type",
      name: "Type",
      type: "select",
      value: "lowpass",
      defaultValue: "lowpass",
      options: [
        { label: "Lowpass", value: "lowpass" },
        { label: "Highpass", value: "highpass" },
        { label: "Bandpass", value: "bandpass" },
        { label: "Peaking", value: "peaking" }
      ]
    });
    this.addParam({
      id: "frequency",
      name: "Frequency",
      type: "float",
      value: 1e3,
      defaultValue: 1e3,
      min: 20,
      max: 2e4,
      step: 10,
      suffix: "Hz"
    });
    this.addParam({
      id: "Q",
      name: "Resonance",
      type: "float",
      value: 1,
      defaultValue: 1,
      min: 0.1,
      max: 10,
      step: 0.1,
      suffix: ""
    });
    this.buildGraph();
    this.applyParam("type", "lowpass");
    this.applyParam("frequency", 1e3);
  }
  buildGraph() {
    this.inputNode.connect(this.filterNode);
    this.filterNode.connect(this.wetNode);
  }
  applyParam(key, value) {
    switch (key) {
      case "type":
        this.filterNode.type = value;
        break;
      case "frequency":
        this.filterNode.frequency.setTargetAtTime(value, this.ctx.currentTime, 0.05);
        break;
      case "Q":
        this.filterNode.Q.setTargetAtTime(value, this.ctx.currentTime, 0.05);
        break;
    }
  }
};
__name(_FilterEffect, "FilterEffect");
let FilterEffect = _FilterEffect;
const _CompressorEffect = class _CompressorEffect extends AudioEffect {
  constructor(ctx, id) {
    super(ctx, "compressor", id);
    __publicField(this, "compressorNode");
    __publicField(this, "makeupNode");
    this.compressorNode = ctx.createDynamicsCompressor();
    this.makeupNode = ctx.createGain();
    this.addParam({
      id: "threshold",
      name: "Threshold",
      type: "float",
      value: -12,
      defaultValue: -12,
      min: -60,
      max: 0,
      step: 1,
      suffix: "dB"
    });
    this.addParam({
      id: "ratio",
      name: "Ratio",
      type: "float",
      value: 4,
      defaultValue: 4,
      min: 1,
      max: 20,
      step: 0.5,
      suffix: ":1"
    });
    this.addParam({
      id: "knee",
      name: "Knee",
      type: "float",
      value: 10,
      defaultValue: 10,
      min: 0,
      max: 40,
      step: 1,
      suffix: "dB"
    });
    this.addParam({
      id: "attack",
      name: "Attack",
      type: "float",
      value: 0.01,
      defaultValue: 0.01,
      min: 1e-3,
      max: 0.5,
      step: 1e-3,
      suffix: "s"
    });
    this.addParam({
      id: "release",
      name: "Release",
      type: "float",
      value: 0.15,
      defaultValue: 0.15,
      min: 0.01,
      max: 1,
      step: 0.01,
      suffix: "s"
    });
    this.buildGraph();
    this.applyParam("threshold", -12);
    this.applyParam("ratio", 4);
    this.applyParam("knee", 10);
    this.applyParam("attack", 0.01);
    this.applyParam("release", 0.15);
  }
  buildGraph() {
    this.inputNode.connect(this.compressorNode);
    this.compressorNode.connect(this.makeupNode);
    this.makeupNode.connect(this.wetNode);
  }
  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case "threshold":
        this.compressorNode.threshold.setTargetAtTime(value, t, 0.05);
        this.updateMakeupGain();
        break;
      case "ratio":
        this.compressorNode.ratio.setTargetAtTime(value, t, 0.05);
        this.updateMakeupGain();
        break;
      case "knee":
        this.compressorNode.knee.setTargetAtTime(value, t, 0.05);
        break;
      case "attack":
        this.compressorNode.attack.setTargetAtTime(value, t, 0.05);
        break;
      case "release":
        this.compressorNode.release.setTargetAtTime(value, t, 0.05);
        break;
    }
  }
  updateMakeupGain() {
    const threshold = this.compressorNode.threshold.value;
    const ratio = this.compressorNode.ratio.value;
    let makeupDb = 0;
    if (threshold < 0 && ratio > 1) {
      makeupDb = -threshold * (1 - 1 / ratio) * 0.4;
    }
    makeupDb = Math.min(makeupDb, 12);
    const makeupGain = Math.pow(10, makeupDb / 20);
    this.makeupNode.gain.setTargetAtTime(makeupGain, this.ctx.currentTime, 0.05);
  }
};
__name(_CompressorEffect, "CompressorEffect");
let CompressorEffect = _CompressorEffect;
const _DistortionEffect = class _DistortionEffect extends AudioEffect {
  constructor(ctx, id) {
    super(ctx, "distortion", id);
    __publicField(this, "shaperNode");
    __publicField(this, "preGain");
    this.shaperNode = ctx.createWaveShaper();
    this.shaperNode.oversample = "4x";
    this.preGain = ctx.createGain();
    this.addParam({
      id: "drive",
      name: "Drive",
      type: "float",
      value: 0,
      defaultValue: 0,
      min: 0,
      max: 100,
      step: 1,
      suffix: "%"
    });
    this.buildGraph();
    this.updateCurve(0);
  }
  buildGraph() {
    this.inputNode.connect(this.preGain);
    this.preGain.connect(this.shaperNode);
    this.shaperNode.connect(this.wetNode);
  }
  applyParam(key, value) {
    if (key === "drive") {
      const driveAmount = value;
      this.updateCurve(driveAmount);
      const gain = 1 + driveAmount / 5;
      this.preGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);
    }
  }
  updateCurve(amount) {
    const k = amount;
    if (k === 0) {
      this.shaperNode.curve = null;
      return;
    }
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    for (let i = 0; i < n_samples; ++i) {
      const x = i * 2 / n_samples - 1;
      const k_scaled = k * 2;
      curve[i] = (k_scaled + 20) * x / (20 + k_scaled * Math.abs(x));
    }
    this.shaperNode.curve = curve;
  }
};
__name(_DistortionEffect, "DistortionEffect");
let DistortionEffect = _DistortionEffect;
function createEffect(ctx, type) {
  switch (type) {
    case "reverb":
      return new ReverbEffect(ctx);
    case "delay":
      return new DelayEffect(ctx);
    case "filter":
      return new FilterEffect(ctx);
    case "compressor":
      return new CompressorEffect(ctx);
    case "distortion":
      return new DistortionEffect(ctx);
    default:
      Logger.warn(`Unknown effect type: ${type}, falling back to filter`);
      return new FilterEffect(ctx);
  }
}
__name(createEffect, "createEffect");
const _EffectChain = class _EffectChain {
  constructor(ctx, channel) {
    __publicField(this, "channel");
    __publicField(this, "inputNode");
    __publicField(this, "outputNode");
    __publicField(this, "ctx");
    __publicField(this, "effects", []);
    /** Mute node used during chain rebuild to prevent clicks */
    __publicField(this, "muteNode");
    __publicField(this, "_bypassed", false);
    __publicField(this, "_savedEnabledStates", /* @__PURE__ */ new Map());
    this.ctx = ctx;
    this.channel = channel;
    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();
    this.muteNode = ctx.createGain();
    this.muteNode.gain.value = 1;
    this.muteNode.connect(this.outputNode);
    this.inputNode.connect(this.muteNode);
  }
  // ─── Bypass Logic ───────────────────────────────────────────
  get isBypassed() {
    return this._bypassed;
  }
  bypass() {
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
  restore() {
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
  buildDefault() {
    this.buildFromTypes(DEFAULT_CHAIN_ORDER);
  }
  /** Build chain from an ordered array of effect types */
  buildFromTypes(types) {
    this.disposeEffects();
    this.effects = types.map((type) => createEffect(this.ctx, type));
    this._bypassed = false;
    this._savedEnabledStates.clear();
    this.rebuildConnections();
    Logger.debug(`EffectChain [${this.channel}]: built with ${types.join(" → ")}`);
  }
  /** Rebuild chain from a full ChannelChain state (restore/sync) */
  restoreState(state) {
    this.disposeEffects();
    this.effects = state.effects.map((es) => {
      const effect = createEffect(this.ctx, es.type);
      effect.restoreChainState(es);
      return effect;
    });
    if (state.bypassed) {
      this._bypassed = true;
      if (state.savedEnabledStates) {
        this._savedEnabledStates = new Map(Object.entries(state.savedEnabledStates));
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
  rebuildConnections() {
    const t = this.ctx.currentTime;
    this.muteNode.gain.setTargetAtTime(0, t, 5e-3);
    this.inputNode.disconnect();
    for (const effect of this.effects) {
      effect.disconnectOutput();
    }
    if (this.effects.length === 0) {
      this.inputNode.connect(this.muteNode);
    } else {
      this.inputNode.connect(this.effects[0].inputNode);
      for (let i = 0; i < this.effects.length - 1; i++) {
        this.effects[i].connectToNext(this.effects[i + 1]);
      }
      this.effects[this.effects.length - 1].connectToDestination(this.muteNode);
    }
    this.muteNode.gain.setTargetAtTime(1, t + 0.015, 5e-3);
  }
  // ─── Reorder ────────────────────────────────────────────────
  /** Move effect from one position to another in the chain */
  reorder(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.effects.length) return;
    if (toIndex < 0 || toIndex >= this.effects.length) return;
    if (fromIndex === toIndex) return;
    const [moved] = this.effects.splice(fromIndex, 1);
    this.effects.splice(toIndex, 0, moved);
    this.rebuildConnections();
    Logger.debug(`EffectChain [${this.channel}]: reordered ${moved.type} from ${fromIndex} to ${toIndex}`);
  }
  /** Set new order by effect type array */
  reorderByTypes(order) {
    const reordered = [];
    for (const type of order) {
      const effect = this.effects.find((e) => e.type === type);
      if (effect) {
        reordered.push(effect);
      }
    }
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
  getEffect(type) {
    return this.effects.find((e) => e.type === type);
  }
  /** Get all effects in chain order */
  getEffects() {
    return [...this.effects];
  }
  /** Get the ordered list of effect types */
  getOrder() {
    return this.effects.map((e) => e.type);
  }
  /** Count of enabled effects */
  getActiveCount() {
    return this.effects.filter((e) => e.enabled).length;
  }
  // ─── Effect Control ─────────────────────────────────────────
  setEffectEnabled(type, enabled) {
    const effect = this.getEffect(type);
    if (effect) {
      effect.setEnabled(enabled);
      if (this._bypassed) {
        this._savedEnabledStates.set(type, enabled);
        effect.setEnabled(false);
      } else {
        effect.setEnabled(enabled);
      }
    }
  }
  setEffectParam(type, paramId, value) {
    const effect = this.getEffect(type);
    if (effect) {
      effect.setParam(paramId, value);
    }
  }
  setEffectMix(type, mix) {
    const effect = this.getEffect(type);
    if (effect) {
      effect.setMix(mix);
    }
  }
  // ─── Add / Remove ───────────────────────────────────────────
  /** Add a new effect at the end of the chain (or at specified index) */
  addEffect(type, atIndex) {
    if (this.getEffect(type)) {
      Logger.warn(`EffectChain [${this.channel}]: effect ${type} already in chain`);
      return null;
    }
    const effect = createEffect(this.ctx, type);
    if (atIndex !== void 0 && atIndex >= 0 && atIndex <= this.effects.length) {
      this.effects.splice(atIndex, 0, effect);
    } else {
      this.effects.push(effect);
    }
    if (this._bypassed) {
      this._savedEnabledStates.set(type, false);
      effect.setEnabled(false);
    }
    this.rebuildConnections();
    Logger.debug(`EffectChain [${this.channel}]: added ${type}`);
    return effect;
  }
  /** Remove an effect from the chain */
  removeEffect(type) {
    const index = this.effects.findIndex((e) => e.type === type);
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
  getState() {
    const savedStateObj = {};
    for (const [key, val] of this._savedEnabledStates) {
      savedStateObj[key] = val;
    }
    return {
      channel: this.channel,
      effects: this.effects.map((e) => e.getChainState()),
      bypassed: this._bypassed,
      savedEnabledStates: this._bypassed ? savedStateObj : void 0
    };
  }
  // ─── Cleanup ────────────────────────────────────────────────
  disposeEffects() {
    for (const effect of this.effects) {
      effect.dispose();
    }
    this.effects = [];
  }
  dispose() {
    this.disposeEffects();
    this.inputNode.disconnect();
    this.muteNode.disconnect();
    this.outputNode.disconnect();
  }
};
__name(_EffectChain, "EffectChain");
let EffectChain = _EffectChain;
function getServerTime() {
  return Date.now();
}
__name(getServerTime, "getServerTime");
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
__name(formatTime, "formatTime");
function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
__name(generateUUID, "generateUUID");
const SUPPORTED_AUDIO_FORMATS = [
  ".mp3",
  ".ogg",
  ".wav",
  ".webm",
  ".m4a",
  ".aac",
  ".flac",
  ".opus"
];
const AUDIO_MIME_TYPES = {
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".opus": "audio/opus"
};
function isValidAudioFormat(url) {
  const extension = getFileExtension(url);
  return SUPPORTED_AUDIO_FORMATS.includes(extension);
}
__name(isValidAudioFormat, "isValidAudioFormat");
function getFileExtension(url) {
  try {
    const decoded = decodeURIComponent(url);
    const cleanUrl = decoded.split("?")[0].split("#")[0];
    const match = cleanUrl.match(/\.([a-z0-9]+)$/i);
    return match ? `.${match[1].toLowerCase()}` : "";
  } catch {
    return "";
  }
}
__name(getFileExtension, "getFileExtension");
function getAudioMimeType(url) {
  const extension = getFileExtension(url);
  return AUDIO_MIME_TYPES[extension] || null;
}
__name(getAudioMimeType, "getAudioMimeType");
function validateAudioFile(url) {
  if (!url || typeof url !== "string") {
    return {
      valid: false,
      error: "URL is required and must be a string"
    };
  }
  const extension = getFileExtension(url);
  if (!extension) {
    return {
      valid: false,
      error: "Could not extract file extension from URL"
    };
  }
  if (!isValidAudioFormat(url)) {
    return {
      valid: false,
      error: `Unsupported audio format: ${extension}. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(", ")}`,
      extension
    };
  }
  const mimeType = getAudioMimeType(url);
  return {
    valid: true,
    extension,
    mimeType: mimeType || void 0
  };
}
__name(validateAudioFile, "validateAudioFile");
const MODULE_ID$8 = "sound-engine-master";
function getMaxSimultaneous() {
  return game.settings.get(MODULE_ID$8, "maxSimultaneousTracks") || 8;
}
__name(getMaxSimultaneous, "getMaxSimultaneous");
const _SimpleEventEmitter = class _SimpleEventEmitter {
  constructor() {
    __publicField(this, "listeners", {});
  }
  on(event, fn) {
    (this.listeners[event] = this.listeners[event] || []).push(fn);
    return this;
  }
  addListener(event, fn) {
    return this.on(event, fn);
  }
  once(event, fn) {
    const onceWrapper = /* @__PURE__ */ __name((...args) => {
      this.off(event, onceWrapper);
      fn.apply(this, args);
    }, "onceWrapper");
    onceWrapper._original = fn;
    return this.on(event, onceWrapper);
  }
  emit(event, ...args) {
    if (this.listeners[event]) {
      [...this.listeners[event]].forEach((fn) => fn.apply(this, args));
      return true;
    }
    return false;
  }
  off(event, fn) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(
        (l) => l !== fn && l._original !== fn
      );
    }
    return this;
  }
  removeListener(event, fn) {
    return this.off(event, fn);
  }
  removeAllListeners(event) {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
    return this;
  }
};
__name(_SimpleEventEmitter, "SimpleEventEmitter");
let SimpleEventEmitter = _SimpleEventEmitter;
const _AudioEngine = class _AudioEngine extends SimpleEventEmitter {
  constructor() {
    super();
    __publicField(this, "ctx");
    __publicField(this, "masterGain");
    __publicField(this, "localGain");
    __publicField(this, "channelGains");
    __publicField(this, "players", /* @__PURE__ */ new Map());
    __publicField(this, "_activeContext", null);
    __publicField(this, "scheduler", null);
    __publicField(this, "socketManager", null);
    // ─── Effects Chain System ───────────────────────────────────
    __publicField(this, "chains");
    __publicField(this, "_volumes", {
      master: 1,
      music: 1,
      ambience: 1,
      sfx: 1
    });
    __publicField(this, "saveTimeout", null);
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.localGain = this.ctx.createGain();
    this.localGain.gain.value = 1;
    this.masterGain.connect(this.localGain);
    this.localGain.connect(this.ctx.destination);
    this.channelGains = {
      music: this.ctx.createGain(),
      ambience: this.ctx.createGain(),
      sfx: this.ctx.createGain()
    };
    this.chains = {
      music: new EffectChain(this.ctx, "music"),
      ambience: new EffectChain(this.ctx, "ambience"),
      sfx: new EffectChain(this.ctx, "sfx")
    };
    for (const group of ["music", "ambience", "sfx"]) {
      this.channelGains[group].connect(this.chains[group].inputNode);
      this.chains[group].outputNode.connect(this.masterGain);
      this.chains[group].buildDefault();
    }
    Logger.info("AudioEngine initialized (chain architecture)");
  }
  /**
   * Validate a volume value: must be a finite number in [0, 1].
   * Returns fallback if the value is missing, NaN, or out of range.
   */
  sanitizeVolume(value, fallback) {
    if (value === null || value === void 0 || typeof value !== "number" || !isFinite(value)) {
      return fallback;
    }
    return Math.max(0, Math.min(1, value));
  }
  // ─────────────────────────────────────────────────────────────
  // Persistence (GM only)
  // ─────────────────────────────────────────────────────────────
  scheduleSave() {
    var _a2;
    if (!((_a2 = game.user) == null ? void 0 : _a2.isGM)) return;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveState();
    }, 500);
  }
  async saveState() {
    var _a2;
    if (!game.ready || !((_a2 = game.user) == null ? void 0 : _a2.isGM)) return;
    const state = this.getState();
    try {
      await game.settings.set(MODULE_ID$8, "mixerState", JSON.stringify(state));
      Logger.debug("Mixer state saved");
    } catch (error) {
      Logger.error("Failed to save mixer state:", error);
    }
  }
  async loadSavedState() {
    if (!game.ready) return;
    try {
      const savedJson = game.settings.get(MODULE_ID$8, "mixerState");
      if (!savedJson) return;
      const state = JSON.parse(savedJson);
      await this.restoreState(state);
      Logger.info("Mixer state restored");
    } catch (error) {
      Logger.error("Failed to load mixer state:", error);
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Track Management
  // ─────────────────────────────────────────────────────────────
  async createTrack(config) {
    const trackId = config.id || generateUUID();
    if (this.players.has(trackId)) {
      return this.players.get(trackId);
    }
    const validation = validateAudioFile(config.url);
    if (!validation.valid) {
      const error = new Error(validation.error || "Invalid audio file");
      Logger.error(`Track validation failed: ${validation.error}`);
      throw error;
    }
    const channelOutput = this.channelGains[config.group];
    const player = new StreamingPlayer(
      trackId,
      this.ctx,
      channelOutput,
      config.group
    );
    if (config.volume !== void 0) {
      player.setVolume(config.volume);
    }
    await player.load(config.url);
    this.players.set(trackId, player);
    player.onEnded = () => {
      this.emit("trackEnded", trackId);
    };
    this.scheduleSave();
    Logger.info(`Track created: ${trackId} (${validation.extension})`);
    return player;
  }
  getTrack(id) {
    return this.players.get(id);
  }
  removeTrack(id) {
    const player = this.players.get(id);
    if (!player) return false;
    player.dispose();
    this.players.delete(id);
    this.scheduleSave();
    Logger.info(`Track removed: ${id}`);
    return true;
  }
  getAllTracks() {
    return Array.from(this.players.values());
  }
  getTracksByGroup(group) {
    return this.getAllTracks().filter((t) => t.group === group);
  }
  setTrackChannel(id, newGroup) {
    const player = this.players.get(id);
    if (!player) return;
    player.setChannel(newGroup, this.channelGains[newGroup]);
    this.scheduleSave();
  }
  // ─────────────────────────────────────────────────────────────
  // Playback Control
  // ─────────────────────────────────────────────────────────────
  async playTrack(id, offset = 0, context) {
    const player = this.players.get(id);
    if (!player) {
      Logger.warn(`Track not found: ${id}`);
      return;
    }
    const maxSimultaneous = getMaxSimultaneous();
    const playingCount = this.getAllTracks().filter((t) => t.state === "playing").length;
    const isCurrentlyPlaying = player.state === "playing";
    if (!isCurrentlyPlaying && playingCount >= maxSimultaneous) {
      Logger.warn(`Maximum simultaneous tracks (${maxSimultaneous}) reached`);
      return;
    }
    if (context) {
      this._activeContext = context;
      this.emit("contextChanged", context);
    }
    await player.play(offset);
  }
  pauseTrack(id) {
    var _a2;
    (_a2 = this.players.get(id)) == null ? void 0 : _a2.pause();
  }
  stopTrack(id) {
    var _a2;
    (_a2 = this.players.get(id)) == null ? void 0 : _a2.stop();
  }
  seekTrack(id, time) {
    var _a2;
    (_a2 = this.players.get(id)) == null ? void 0 : _a2.seek(time);
  }
  setTrackVolume(id, volume) {
    var _a2;
    (_a2 = this.players.get(id)) == null ? void 0 : _a2.setVolume(volume);
    this.scheduleSave();
  }
  stopAll() {
    var _a2, _b;
    (_a2 = this.scheduler) == null ? void 0 : _a2.clearContext();
    for (const player of this.players.values()) {
      player.stop();
    }
    this._activeContext = null;
    this.emit("contextChanged", null);
    (_b = this.socketManager) == null ? void 0 : _b.broadcastStopAll();
  }
  setScheduler(scheduler) {
    this.scheduler = scheduler;
  }
  setSocketManager(socketManager2) {
    this.socketManager = socketManager2;
  }
  // ─────────────────────────────────────────────────────────────
  // Volume Control
  // ─────────────────────────────────────────────────────────────
  get volumes() {
    return { ...this._volumes };
  }
  setMasterVolume(value) {
    this._volumes.master = Math.max(0, Math.min(1, value));
    this.masterGain.gain.linearRampToValueAtTime(
      this._volumes.master,
      this.ctx.currentTime + 0.01
    );
    this.scheduleSave();
  }
  setChannelVolume(channel, value) {
    this._volumes[channel] = Math.max(0, Math.min(1, value || 0));
    this.channelGains[channel].gain.linearRampToValueAtTime(
      this._volumes[channel],
      this.ctx.currentTime + 0.01
    );
    this.scheduleSave();
  }
  getChannelVolume(channel) {
    return this._volumes[channel];
  }
  // ─────────────────────────────────────────────────────────────
  // Local Volume (GM Monitor)
  // ─────────────────────────────────────────────────────────────
  setLocalVolume(value) {
    const val = Math.max(0, Math.min(1, value));
    this.localGain.gain.linearRampToValueAtTime(val, this.ctx.currentTime + 0.05);
  }
  get localVolume() {
    return this.localGain.gain.value;
  }
  // ─────────────────────────────────────────────────────────────
  // Effects Chain Management
  // ─────────────────────────────────────────────────────────────
  /** Get chain for a specific channel */
  getChain(channel) {
    return this.chains[channel];
  }
  /** Get all chains state for serialization / sync */
  getAllChainsState() {
    return ["music", "ambience", "sfx"].map(
      (group) => this.chains[group].getState()
    );
  }
  /** Set effect parameter within a specific channel's chain */
  setChainEffectParam(channel, effectType, paramId, value) {
    this.chains[channel].setEffectParam(effectType, paramId, value);
    this.scheduleSave();
  }
  /** Enable/disable an effect within a channel's chain */
  setChainEffectEnabled(channel, effectType, enabled) {
    this.chains[channel].setEffectEnabled(effectType, enabled);
    this.scheduleSave();
  }
  /** Set dry/wet mix for an effect within a channel's chain */
  setChainEffectMix(channel, effectType, mix) {
    this.chains[channel].setEffectMix(effectType, mix);
    this.scheduleSave();
  }
  /** Reorder effects in a channel's chain */
  reorderChainEffect(channel, fromIndex, toIndex) {
    this.chains[channel].reorder(fromIndex, toIndex);
    this.scheduleSave();
  }
  /** Reorder by type array (from sync) */
  reorderChainByTypes(channel, order) {
    this.chains[channel].reorderByTypes(order);
    this.scheduleSave();
  }
  /** Add effect to a channel's chain */
  addChainEffect(channel, effectType, atIndex) {
    this.chains[channel].addEffect(effectType, atIndex);
    this.scheduleSave();
  }
  /** Remove effect from a channel's chain */
  removeChainEffect(channel, effectType) {
    this.chains[channel].removeEffect(effectType);
    this.scheduleSave();
  }
  /** Toggle master bypass for a channel's chain */
  toggleChainBypass(channel, bypassed) {
    const chain = this.chains[channel];
    if (!chain) return;
    if (bypassed) {
      chain.bypass();
    } else {
      chain.restore();
    }
    this.scheduleSave();
  }
  // ─────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────
  getState() {
    const tracks = [];
    for (const player of this.players.values()) {
      tracks.push(player.getState());
    }
    return {
      masterVolume: this._volumes.master,
      channelVolumes: { ...this._volumes },
      tracks,
      chains: this.getAllChainsState(),
      timestamp: getServerTime(),
      syncEnabled: false
    };
  }
  async restoreState(state) {
    let needsResave = false;
    this._volumes.master = this.sanitizeVolume(state.masterVolume, 1);
    if (this._volumes.master !== state.masterVolume) needsResave = true;
    this.masterGain.gain.setValueAtTime(this._volumes.master, this.ctx.currentTime);
    if (state.channelVolumes) {
      for (const channel of ["music", "ambience", "sfx"]) {
        const raw = state.channelVolumes[channel];
        this._volumes[channel] = this.sanitizeVolume(raw, 1);
        if (this._volumes[channel] !== raw) needsResave = true;
        this.channelGains[channel].gain.setValueAtTime(this._volumes[channel], this.ctx.currentTime);
      }
    }
    if (needsResave) {
      Logger.warn("Mixer state had invalid volume values — sanitized and will re-save");
      this.scheduleSave();
    }
    if (state.chains && state.chains.length > 0) {
      for (const chainState of state.chains) {
        const chain = this.chains[chainState.channel];
        if (chain) {
          chain.restoreState(chainState);
        }
      }
    } else if (state.effects && state.effects.length > 0) {
      this.migrateFromLegacyEffects(state.effects);
    }
    for (const trackState of state.tracks) {
      if (!this.players.has(trackState.id)) {
        try {
          await this.createTrack({
            id: trackState.id,
            url: trackState.url,
            group: trackState.group,
            volume: trackState.volume
          });
        } catch (error) {
          Logger.error(`Failed to restore track ${trackState.id}:`, error);
        }
      }
    }
    const stateTrackIds = new Set(state.tracks.map((t) => t.id));
    for (const [id] of this.players) {
      if (!stateTrackIds.has(id)) {
        this.removeTrack(id);
      }
    }
  }
  /** Migrate from old parallel send architecture to chain architecture */
  migrateFromLegacyEffects(effects) {
    Logger.info("Migrating from legacy effects format to chain architecture");
    for (const group of ["music", "ambience", "sfx"]) {
      const chainEffects = DEFAULT_CHAIN_ORDER.map((type) => {
        const oldEffect = effects.find((e) => e.type === type);
        return {
          type,
          enabled: oldEffect ? oldEffect.enabled && oldEffect.routing[group] : false,
          mix: DEFAULT_MIX[type] ?? 1,
          params: (oldEffect == null ? void 0 : oldEffect.params) || {}
        };
      });
      this.chains[group].restoreState({
        channel: group,
        effects: chainEffects
      });
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Audio Context
  // ─────────────────────────────────────────────────────────────
  async resume() {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
      Logger.info("AudioContext resumed");
    }
  }
  get contextState() {
    return this.ctx.state;
  }
  // ─────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────
  dispose() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    for (const player of this.players.values()) {
      player.dispose();
    }
    this.players.clear();
    for (const chain of Object.values(this.chains)) {
      chain.dispose();
    }
    this.ctx.close();
    Logger.info("AudioEngine disposed");
  }
};
__name(_AudioEngine, "AudioEngine");
let AudioEngine = _AudioEngine;
const _PlayerAudioEngine = class _PlayerAudioEngine {
  constructor(socketManager2) {
    __publicField(this, "ctx");
    __publicField(this, "masterGain");
    __publicField(this, "gmGain");
    __publicField(this, "channelGains");
    __publicField(this, "players", /* @__PURE__ */ new Map());
    // ─── Effects Chain System ───────────────────────────────────
    __publicField(this, "chains");
    __publicField(this, "_localVolume", 1);
    __publicField(this, "_gmVolumes", {
      master: 1,
      music: 1,
      ambience: 1,
      sfx: 1
    });
    // Periodic sync verification
    __publicField(this, "lastSyncState", []);
    __publicField(this, "syncCheckInterval", null);
    __publicField(this, "socketManager");
    __publicField(this, "lastSyncRequestTime", 0);
    __publicField(this, "SYNC_REQUEST_COOLDOWN", 1e4);
    this.ctx = new AudioContext();
    this.socketManager = socketManager2;
    this.startSyncVerification();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.gmGain = this.ctx.createGain();
    this.gmGain.connect(this.masterGain);
    this.channelGains = {
      music: this.ctx.createGain(),
      ambience: this.ctx.createGain(),
      sfx: this.ctx.createGain()
    };
    this.chains = {
      music: new EffectChain(this.ctx, "music"),
      ambience: new EffectChain(this.ctx, "ambience"),
      sfx: new EffectChain(this.ctx, "sfx")
    };
    for (const group of ["music", "ambience", "sfx"]) {
      this.channelGains[group].connect(this.chains[group].inputNode);
      this.chains[group].outputNode.connect(this.gmGain);
      this.chains[group].buildDefault();
    }
    Logger.info("PlayerAudioEngine initialized (chain architecture)");
  }
  startSyncVerification() {
    this.syncCheckInterval = window.setInterval(() => {
      this.verifySyncState();
    }, 5e3);
  }
  verifySyncState() {
    let needsResync = false;
    if (this.lastSyncState.length === 0) {
      if (this.players.size > 0) {
        Logger.warn(`Sync verification mismatch: ${this.players.size} active players but sync state is empty`);
        needsResync = true;
      } else {
        return;
      }
    }
    for (const expectedTrack of this.lastSyncState) {
      const player = this.players.get(expectedTrack.id);
      if (!player) {
        if (expectedTrack.isPlaying) {
          needsResync = true;
          break;
        }
        continue;
      }
      const actuallyPlaying = player.state === "playing";
      if (expectedTrack.isPlaying && !actuallyPlaying) {
        needsResync = true;
        break;
      }
      if (!expectedTrack.isPlaying && actuallyPlaying) {
        needsResync = true;
        break;
      }
    }
    if (!needsResync) {
      const expectedIds = new Set(this.lastSyncState.map((t) => t.id));
      for (const [id] of this.players) {
        if (!expectedIds.has(id)) {
          needsResync = true;
          break;
        }
      }
    }
    if (needsResync) {
      const now = Date.now();
      if (now - this.lastSyncRequestTime < this.SYNC_REQUEST_COOLDOWN) {
        return;
      }
      this.lastSyncRequestTime = now;
      if (this.socketManager) {
        this.socketManager.requestFullSync();
      }
    }
  }
  dispose() {
    if (this.syncCheckInterval !== null) {
      window.clearInterval(this.syncCheckInterval);
      this.syncCheckInterval = null;
    }
    this.clearAll();
    for (const chain of Object.values(this.chains)) {
      chain.dispose();
    }
    this.ctx.close();
    Logger.info("PlayerAudioEngine disposed");
  }
  // ─────────────────────────────────────────────────────────────
  // Local Volume (Player's personal control)
  // ─────────────────────────────────────────────────────────────
  get localVolume() {
    return this._localVolume;
  }
  setLocalVolume(value) {
    this._localVolume = Math.max(0, Math.min(1, value));
    this.masterGain.gain.linearRampToValueAtTime(
      this._localVolume,
      this.ctx.currentTime + 0.01
    );
  }
  // ─────────────────────────────────────────────────────────────
  // GM Volume (from sync)
  // ─────────────────────────────────────────────────────────────
  sanitizeVolume(value, fallback) {
    if (value === null || value === void 0 || typeof value !== "number" || !isFinite(value)) {
      return fallback;
    }
    return Math.max(0, Math.min(1, value));
  }
  setGMVolume(channel, value) {
    const safeValue = this.sanitizeVolume(value, 1);
    if (channel === "master") {
      this._gmVolumes.master = safeValue;
      this.gmGain.gain.linearRampToValueAtTime(safeValue, this.ctx.currentTime + 0.01);
    } else {
      this._gmVolumes[channel] = safeValue;
      this.channelGains[channel].gain.linearRampToValueAtTime(safeValue, this.ctx.currentTime + 0.01);
    }
  }
  setAllGMVolumes(volumes) {
    this._gmVolumes = { ...volumes };
    this.gmGain.gain.setValueAtTime(this.sanitizeVolume(volumes.master, 1), this.ctx.currentTime);
    this.channelGains.music.gain.setValueAtTime(this.sanitizeVolume(volumes.music, 1), this.ctx.currentTime);
    this.channelGains.ambience.gain.setValueAtTime(this.sanitizeVolume(volumes.ambience, 1), this.ctx.currentTime);
    this.channelGains.sfx.gain.setValueAtTime(this.sanitizeVolume(volumes.sfx, 1), this.ctx.currentTime);
  }
  // ─────────────────────────────────────────────────────────────
  // Effects Chain Management (Called via Socket)
  // ─────────────────────────────────────────────────────────────
  setChainEffectParam(channel, effectType, paramId, value) {
    this.chains[channel].setEffectParam(effectType, paramId, value);
  }
  setChainEffectEnabled(channel, effectType, enabled) {
    this.chains[channel].setEffectEnabled(effectType, enabled);
  }
  setChainEffectMix(channel, effectType, mix) {
    this.chains[channel].setEffectMix(effectType, mix);
  }
  reorderChainByTypes(channel, order) {
    this.chains[channel].reorderByTypes(order);
  }
  /** Restore all chains from sync state */
  syncChains(chainsState) {
    for (const chainState of chainsState) {
      const chain = this.chains[chainState.channel];
      if (chain) {
        chain.restoreState(chainState);
      }
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Local Playback Control (Interface Compliance)
  // ─────────────────────────────────────────────────────────────
  async playTrack(id, offset = 0) {
    const player = this.players.get(id);
    if (player) {
      await player.play(offset);
    } else {
      Logger.warn(`PlayerAudioEngine: Track ${id} not found locally.`);
    }
  }
  pauseTrack(id) {
    var _a2;
    (_a2 = this.players.get(id)) == null ? void 0 : _a2.pause();
  }
  stopTrack(id) {
    var _a2;
    (_a2 = this.players.get(id)) == null ? void 0 : _a2.stop();
  }
  // ─────────────────────────────────────────────────────────────
  // Track Commands (from GM via socket)
  // ─────────────────────────────────────────────────────────────
  async handlePlay(payload) {
    let player = this.players.get(payload.trackId);
    if (player && player.url !== payload.url) {
      player.stop();
      player.dispose();
      this.players.delete(payload.trackId);
      player = void 0;
    }
    if (!player) {
      player = new StreamingPlayer(
        payload.trackId,
        this.ctx,
        this.channelGains[payload.group],
        payload.group
      );
      await player.load(payload.url);
      this.players.set(payload.trackId, player);
    }
    player.setVolume(payload.volume);
    const elapsed = (getServerTime() - payload.startTimestamp) / 1e3;
    const adjustedOffset = Math.max(0, payload.offset + elapsed);
    await player.play(adjustedOffset);
  }
  handlePause(trackId) {
    var _a2;
    (_a2 = this.players.get(trackId)) == null ? void 0 : _a2.pause();
  }
  handleStop(trackId) {
    var _a2;
    (_a2 = this.players.get(trackId)) == null ? void 0 : _a2.stop();
  }
  handleSeek(trackId, time, isPlaying, seekTimestamp) {
    const player = this.players.get(trackId);
    if (!player) return;
    if (isPlaying) {
      const elapsed = (getServerTime() - seekTimestamp) / 1e3;
      player.seek(time + elapsed);
    } else {
      player.seek(time);
    }
  }
  handleTrackVolume(trackId, volume) {
    var _a2;
    (_a2 = this.players.get(trackId)) == null ? void 0 : _a2.setVolume(volume);
  }
  // ─────────────────────────────────────────────────────────────
  // Sync State (full state from GM)
  // ─────────────────────────────────────────────────────────────
  async syncState(tracks, volumes, chainsState = []) {
    Logger.debug(`Player: Sync State Received. Tracks=${tracks.length}, Chains=${(chainsState == null ? void 0 : chainsState.length) || 0}`);
    this.lastSyncState = tracks;
    this.setAllGMVolumes(volumes);
    if (chainsState && chainsState.length > 0) {
      this.syncChains(chainsState);
    }
    const newTrackIds = new Set(tracks.map((t) => t.id));
    for (const [id, player] of this.players) {
      if (!newTrackIds.has(id)) {
        player.dispose();
        this.players.delete(id);
      }
    }
    for (const trackState of tracks) {
      let player = this.players.get(trackState.id);
      if (player && !trackState.isPlaying && player.state === "playing") {
        player.stop();
        continue;
      }
      if (!player) {
        if (trackState.isPlaying) {
          await this.handlePlay({
            trackId: trackState.id,
            url: trackState.url,
            group: trackState.group,
            volume: trackState.volume,
            offset: trackState.currentTime,
            startTimestamp: trackState.startTimestamp
          });
        }
        continue;
      }
      player.setVolume(trackState.volume);
      if (trackState.isPlaying) {
        const elapsed = (getServerTime() - trackState.startTimestamp) / 1e3;
        const adjustedTime = trackState.currentTime + elapsed;
        await player.play(adjustedTime);
      } else {
        player.stop();
      }
    }
    Logger.info("Player: synced state from GM");
  }
  // ─────────────────────────────────────────────────────────────
  // Sync Off
  // ─────────────────────────────────────────────────────────────
  stopAll() {
    for (const player of this.players.values()) {
      if (player.state === "playing" || player.state === "paused") {
        player.stop();
      }
    }
    this.lastSyncState = [];
  }
  clearAll() {
    for (const player of this.players.values()) {
      player.stop();
      player.dispose();
    }
    this.players.clear();
    this.lastSyncState = [];
    Logger.info("Player: all tracks cleared");
  }
  // ─────────────────────────────────────────────────────────────
  // Audio Context
  // ─────────────────────────────────────────────────────────────
  async resume() {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
      Logger.info("PlayerAudioEngine: AudioContext resumed");
    }
  }
};
__name(_PlayerAudioEngine, "PlayerAudioEngine");
let PlayerAudioEngine = _PlayerAudioEngine;
const MODULE_ID$7 = "sound-engine-master";
const SOCKET_NAME = `module.${MODULE_ID$7}`;
const _SocketManager = class _SocketManager {
  constructor() {
    __publicField(this, "gmEngine", null);
    __publicField(this, "playerEngine", null);
    __publicField(this, "socket", null);
    __publicField(this, "_syncEnabled", false);
    __publicField(this, "isGM", false);
  }
  initializeAsGM(engine) {
    var _a2;
    this.isGM = true;
    this.gmEngine = engine;
    this.socket = game.socket;
    (_a2 = this.socket) == null ? void 0 : _a2.on(SOCKET_NAME, (message) => {
      this.handleGMMessage(message);
    });
    Logger.info("SocketManager initialized as GM");
  }
  initializeAsPlayer(engine) {
    var _a2;
    this.isGM = false;
    this.playerEngine = engine;
    this.socket = game.socket;
    (_a2 = this.socket) == null ? void 0 : _a2.on(SOCKET_NAME, (message) => {
      this.handlePlayerMessage(message);
    });
    setTimeout(() => {
      this.send("player-ready", {});
    }, 1e3);
    Logger.info("SocketManager initialized as Player");
  }
  // ─────────────────────────────────────────────────────────────
  // Sync Mode (GM)
  // ─────────────────────────────────────────────────────────────
  get syncEnabled() {
    return this._syncEnabled;
  }
  setSyncEnabled(enabled) {
    if (!this.isGM) return;
    this._syncEnabled = enabled;
    if (enabled) {
      this.broadcastSyncStart();
    } else {
      this.broadcastSyncStop();
    }
    Logger.info(`Sync mode: ${enabled ? "ON" : "OFF"}`);
  }
  // ─────────────────────────────────────────────────────────────
  // GM Message Handling
  // ─────────────────────────────────────────────────────────────
  handleGMMessage(message) {
    var _a2;
    if (message.senderId === ((_a2 = game.user) == null ? void 0 : _a2.id)) return;
    if (message.type === "player-ready" && this._syncEnabled) {
      this.sendStateTo(message.senderId);
    }
    if (message.type === "sync-request" && this._syncEnabled) {
      this.sendStateTo(message.senderId);
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Player Message Handling
  // ─────────────────────────────────────────────────────────────
  async handlePlayerMessage(message) {
    var _a2;
    if (message.senderId === ((_a2 = game.user) == null ? void 0 : _a2.id)) return;
    if (!this.playerEngine) return;
    Logger.debug(`Player received: ${message.type}`, message.payload);
    switch (message.type) {
      case "sync-start": {
        const payload = message.payload;
        this._syncEnabled = true;
        await this.playerEngine.syncState(payload.tracks, payload.channelVolumes, payload.chains);
        break;
      }
      case "sync-stop":
        this._syncEnabled = false;
        this.playerEngine.clearAll();
        break;
      case "sync-state": {
        const payload = message.payload;
        this._syncEnabled = true;
        await this.playerEngine.syncState(payload.tracks, payload.channelVolumes, payload.chains);
        break;
      }
      case "track-play": {
        const payload = message.payload;
        await this.playerEngine.handlePlay(payload);
        break;
      }
      case "track-pause": {
        const payload = message.payload;
        this.playerEngine.handlePause(payload.trackId);
        break;
      }
      case "track-stop": {
        const payload = message.payload;
        this.playerEngine.handleStop(payload.trackId);
        break;
      }
      case "track-seek": {
        const payload = message.payload;
        this.playerEngine.handleSeek(
          payload.trackId,
          payload.time,
          payload.isPlaying,
          payload.seekTimestamp
        );
        break;
      }
      case "track-volume": {
        const payload = message.payload;
        this.playerEngine.handleTrackVolume(payload.trackId, payload.volume);
        break;
      }
      case "channel-volume": {
        const payload = message.payload;
        this.playerEngine.setGMVolume(payload.channel, payload.volume);
        break;
      }
      case "stop-all":
        this.playerEngine.stopAll();
        break;
      case "effect-param": {
        const payload = message.payload;
        this.playerEngine.setChainEffectParam(payload.channel, payload.effectType, payload.paramId, payload.value);
        break;
      }
      case "effect-enabled": {
        const payload = message.payload;
        this.playerEngine.setChainEffectEnabled(payload.channel, payload.effectType, payload.enabled);
        break;
      }
      case "chain-reorder": {
        const payload = message.payload;
        this.playerEngine.reorderChainByTypes(payload.channel, payload.order);
        break;
      }
      case "chain-effect-mix": {
        const payload = message.payload;
        this.playerEngine.setChainEffectMix(payload.channel, payload.effectType, payload.mix);
        break;
      }
    }
  }
  // ─────────────────────────────────────────────────────────────
  // GM Broadcast Methods
  // ─────────────────────────────────────────────────────────────
  send(type, payload, targetUserId) {
    var _a2;
    if (!this.socket) return;
    const message = {
      type,
      payload,
      senderId: ((_a2 = game.user) == null ? void 0 : _a2.id) ?? "",
      timestamp: getServerTime()
    };
    if (targetUserId) {
      this.socket.emit(SOCKET_NAME, message, { recipients: [targetUserId] });
    } else {
      this.socket.emit(SOCKET_NAME, message);
    }
    Logger.debug(`Sent: ${type}`, payload);
  }
  getCurrentSyncState() {
    if (!this.gmEngine) {
      return {
        tracks: [],
        channelVolumes: { master: 1, music: 1, ambience: 1, sfx: 1 },
        chains: []
      };
    }
    const now = getServerTime();
    const tracks = [];
    for (const player of this.gmEngine.getAllTracks()) {
      const state = player.getState();
      tracks.push({
        id: state.id,
        url: state.url,
        group: state.group,
        volume: state.volume,
        isPlaying: state.playbackState === "playing",
        currentTime: player.getCurrentTime(),
        startTimestamp: now
      });
    }
    return {
      tracks,
      channelVolumes: this.gmEngine.volumes,
      chains: this.gmEngine.getAllChainsState()
    };
  }
  broadcastFullState() {
    if (!this._syncEnabled) return;
    this.broadcastSyncStart();
  }
  broadcastSyncStart() {
    const state = this.getCurrentSyncState();
    this.send("sync-start", state);
  }
  broadcastSyncStop() {
    this.send("sync-stop", {});
  }
  sendStateTo(userId) {
    const state = this.getCurrentSyncState();
    this.send("sync-state", state, userId);
  }
  // ─────────────────────────────────────────────────────────────
  // GM Actions (called when GM interacts with mixer)
  // ─────────────────────────────────────────────────────────────
  broadcastTrackPlay(trackId, offset) {
    if (!this._syncEnabled || !this.gmEngine) return;
    const player = this.gmEngine.getTrack(trackId);
    if (!player) return;
    const payload = {
      trackId,
      url: player.url,
      group: player.group,
      volume: player.volume,
      offset,
      startTimestamp: getServerTime()
    };
    this.send("track-play", payload);
  }
  broadcastTrackPause(trackId, pausedAt) {
    if (!this._syncEnabled) return;
    const payload = { trackId, pausedAt };
    this.send("track-pause", payload);
  }
  broadcastTrackStop(trackId) {
    if (!this._syncEnabled) return;
    const payload = { trackId };
    this.send("track-stop", payload);
  }
  broadcastTrackSeek(trackId, time, isPlaying) {
    if (!this._syncEnabled) return;
    const payload = {
      trackId,
      time,
      isPlaying,
      seekTimestamp: getServerTime()
    };
    this.send("track-seek", payload);
  }
  broadcastTrackVolume(trackId, volume) {
    if (!this._syncEnabled) return;
    const payload = { trackId, volume };
    this.send("track-volume", payload);
  }
  broadcastChannelVolume(channel, volume) {
    if (!this._syncEnabled) return;
    const payload = { channel, volume };
    this.send("channel-volume", payload);
  }
  broadcastStopAll() {
    if (!this._syncEnabled) return;
    this.send("stop-all", {});
  }
  dispose() {
    var _a2;
    (_a2 = this.socket) == null ? void 0 : _a2.off(SOCKET_NAME);
  }
  // ─────────────────────────────────────────────────────────────
  // Chain Effect Broadcasts (GM → Players)
  // ─────────────────────────────────────────────────────────────
  broadcastEffectParam(channel, effectType, paramId, value) {
    if (!this._syncEnabled) return;
    const payload = { channel, effectType, paramId, value };
    this.send("effect-param", payload);
  }
  broadcastEffectEnabled(channel, effectType, enabled) {
    if (!this._syncEnabled) return;
    const payload = { channel, effectType, enabled };
    this.send("effect-enabled", payload);
  }
  broadcastChainReorder(channel, order) {
    if (!this._syncEnabled) return;
    const payload = { channel, order };
    this.send("chain-reorder", payload);
  }
  broadcastChainEffectMix(channel, effectType, mix) {
    if (!this._syncEnabled) return;
    const payload = { channel, effectType, mix };
    this.send("chain-effect-mix", payload);
  }
  // ─────────────────────────────────────────────────────────────
  // Player Methods (request sync from GM)
  // ─────────────────────────────────────────────────────────────
  requestFullSync() {
    this.send("sync-request", {});
  }
};
__name(_SocketManager, "SocketManager");
let SocketManager = _SocketManager;
const MODULE_ID$6 = "sound-engine-master";
const _PlayerVolumePanel = class _PlayerVolumePanel extends Application {
  constructor(engine, options) {
    super(options);
    __publicField(this, "engine");
    this.engine = engine;
  }
  static get defaultOptions() {
    var _a2, _b;
    const localizedTitle = ((_b = (_a2 = game.i18n) == null ? void 0 : _a2.localize) == null ? void 0 : _b.call(_a2, "ASE.UI.Panel.SoundVolume")) ?? "Sound Volume";
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ase-player-volume",
      title: localizedTitle,
      template: `modules/${MODULE_ID$6}/templates/player-volume.hbs`,
      classes: ["ase-player-panel"],
      width: 200,
      height: "auto",
      resizable: false,
      minimizable: true,
      popOut: true
    });
  }
  getData() {
    return {
      volume: Math.round(this.engine.localVolume * 100)
    };
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".ase-volume-slider").on("input", (event) => {
      const value = parseFloat(event.target.value) / 100;
      this.engine.setLocalVolume(value);
      html.find(".ase-volume-value").text(`${Math.round(value * 100)}%`);
      this.saveVolume(value);
    });
  }
  saveVolume(value) {
    localStorage.setItem(`${MODULE_ID$6}-player-volume`, String(value));
  }
  static loadSavedVolume() {
    const saved = localStorage.getItem(`${MODULE_ID$6}-player-volume`);
    return saved ? parseFloat(saved) : 1;
  }
};
__name(_PlayerVolumePanel, "PlayerVolumePanel");
let PlayerVolumePanel = _PlayerVolumePanel;
const MODULE_ID$5 = "sound-engine-master";
const { ApplicationV2: ApplicationV2$1, HandlebarsApplicationMixin: HandlebarsApplicationMixin$1 } = foundry.applications.api;
const _VolumeHudPanel = class _VolumeHudPanel extends HandlebarsApplicationMixin$1(ApplicationV2$1) {
  constructor(engine, playerEngine2, socket, openMainApp2, options = {}) {
    var _a2;
    super(options);
    __publicField(this, "engine");
    __publicField(this, "playerEngine");
    __publicField(this, "socket");
    __publicField(this, "openMainApp");
    __publicField(this, "syncPollTimer", null);
    __publicField(this, "_isInteracting", false);
    __publicField(this, "_lastSyncEnabled", null);
    __publicField(this, "state", {
      isGM: ((_a = game.user) == null ? void 0 : _a.isGM) ?? false,
      syncEnabled: false,
      localVolume: 100,
      musicVolume: 100,
      ambienceVolume: 100,
      sfxVolume: 100,
      masterVolume: 100,
      playerVolume: 100
    });
    this.engine = engine;
    this.playerEngine = playerEngine2;
    this.socket = socket;
    this.openMainApp = openMainApp2;
    this.state.isGM = ((_a2 = game.user) == null ? void 0 : _a2.isGM) ?? false;
    this._initializeVolumes();
    if (this.socket) {
      this._subscribeToSyncChanges();
    }
  }
  _initializeVolumes() {
    var _a2;
    if (this.state.isGM) {
      this.state.syncEnabled = ((_a2 = this.socket) == null ? void 0 : _a2.syncEnabled) ?? false;
    }
    if (this.state.isGM && this.engine) {
      this.state.masterVolume = Math.round(this.engine.volumes.master * 100);
      this.state.localVolume = Math.round(this.engine.localVolume * 100);
      this.state.musicVolume = Math.round(this.engine.getChannelVolume("music") * 100);
      this.state.ambienceVolume = Math.round(this.engine.getChannelVolume("ambience") * 100);
      this.state.sfxVolume = Math.round(this.engine.getChannelVolume("sfx") * 100);
    } else if (this.playerEngine) {
      const saved = localStorage.getItem(`${MODULE_ID$5}-player-volume`);
      this.state.playerVolume = saved ? Math.round(parseFloat(saved) * 100) : 100;
    }
  }
  _subscribeToSyncChanges() {
    if (this.socket) {
      const checkSync = /* @__PURE__ */ __name(() => {
        var _a2;
        const sync = ((_a2 = this.socket) == null ? void 0 : _a2.syncEnabled) ?? false;
        this.state.syncEnabled = sync;
        if (this._lastSyncEnabled !== sync) {
          this._lastSyncEnabled = sync;
          this.render();
          return;
        }
        this._refreshFromEngine(true);
      }, "checkSync");
      this.syncPollTimer = setInterval(checkSync, 100);
      checkSync();
    }
  }
  async _prepareContext(_options) {
    const context = await super._prepareContext(_options);
    return {
      ...context,
      isGM: this.state.isGM,
      syncEnabled: this.state.syncEnabled,
      localVolume: this.state.localVolume,
      musicVolume: this.state.musicVolume,
      ambienceVolume: this.state.ambienceVolume,
      sfxVolume: this.state.sfxVolume,
      masterVolume: this.state.masterVolume,
      playerVolume: this.state.playerVolume
    };
  }
  _onRender(_context, _options) {
    super._onRender(_context, _options);
    this._positionPanel();
    this._attachEventListeners();
  }
  _positionPanel() {
    const element = this.element;
    if (!element) return;
    const uiLeft = document.querySelector("#ui-left");
    const bastionTurn = document.querySelector("#bastion-turn");
    const playersAside = document.querySelector("aside#players");
    if (uiLeft) {
      const anchor = bastionTurn ?? playersAside;
      const parent = (anchor == null ? void 0 : anchor.parentElement) ?? uiLeft;
      if (element.parentElement !== parent) {
        if (anchor) parent.insertBefore(element, anchor);
        else parent.prepend(element);
      } else if (anchor && element.nextElementSibling !== anchor) {
        parent.insertBefore(element, anchor);
      }
      element.style.position = "relative";
      element.style.left = "0";
      element.style.bottom = "0";
      element.style.zIndex = "6";
      element.style.margin = "0 0 8px 0";
      if (anchor) {
        const rectWidth = anchor.getBoundingClientRect().width;
        const cssWidth = anchor.clientWidth || 0;
        const scrollWidth = anchor.scrollWidth || 0;
        const width = Math.max(rectWidth, cssWidth, scrollWidth);
        if (width > 0) {
          element.style.width = `${Math.round(width)}px`;
        }
      }
    }
  }
  _attachEventListeners() {
    var _a2;
    const element = this.element;
    if (!element) return;
    (_a2 = element.querySelector(".ase-hud-open-app")) == null ? void 0 : _a2.addEventListener("click", () => {
      var _a3;
      (_a3 = this.openMainApp) == null ? void 0 : _a3.call(this, "mixer", false);
    });
    if (this.state.isGM) {
      this._attachTypeSlider(element, "master");
      this._attachTypeSlider(element, "local");
      this._attachChannelSlider(element, "music");
      this._attachChannelSlider(element, "ambience");
      this._attachChannelSlider(element, "sfx");
    } else {
      this._attachPlayerSlider(element);
    }
  }
  _attachTypeSlider(html, type) {
    const slider = html.querySelector(`.ase-hud-slider[data-type="${type}"]`);
    if (!slider) return;
    const startInteract = /* @__PURE__ */ __name(() => {
      this._isInteracting = true;
    }, "startInteract");
    const endInteract = /* @__PURE__ */ __name(() => {
      this._isInteracting = false;
    }, "endInteract");
    slider.addEventListener("pointerdown", startInteract);
    slider.addEventListener("pointerup", endInteract);
    slider.addEventListener("pointercancel", endInteract);
    slider.addEventListener("change", endInteract);
    slider.addEventListener("blur", endInteract);
    slider.addEventListener("input", (event) => {
      var _a2, _b, _c;
      const value = parseFloat(event.target.value);
      const normalizedValue = value / 100;
      if (type === "master") {
        this.state.masterVolume = value;
        (_a2 = this.engine) == null ? void 0 : _a2.setMasterVolume(normalizedValue);
        (_b = this.socket) == null ? void 0 : _b.broadcastChannelVolume("master", normalizedValue);
      } else {
        this.state.localVolume = value;
        (_c = this.engine) == null ? void 0 : _c.setLocalVolume(normalizedValue);
        localStorage.setItem("ase-gm-local-volume", String(normalizedValue));
      }
      const valueDisplay = html.querySelector(`.ase-hud-value[data-type="${type}"]`);
      if (valueDisplay) {
        valueDisplay.textContent = `${Math.round(value)}%`;
      }
    });
  }
  _attachChannelSlider(html, channel) {
    const slider = html.querySelector(`.ase-hud-slider[data-channel="${channel}"]`);
    if (!slider) return;
    const startInteract = /* @__PURE__ */ __name(() => {
      this._isInteracting = true;
    }, "startInteract");
    const endInteract = /* @__PURE__ */ __name(() => {
      this._isInteracting = false;
    }, "endInteract");
    slider.addEventListener("pointerdown", startInteract);
    slider.addEventListener("pointerup", endInteract);
    slider.addEventListener("pointercancel", endInteract);
    slider.addEventListener("change", endInteract);
    slider.addEventListener("blur", endInteract);
    slider.addEventListener("input", (event) => {
      var _a2;
      const value = parseFloat(event.target.value);
      const normalizedValue = value / 100;
      if (channel === "music") this.state.musicVolume = value;
      else if (channel === "ambience") this.state.ambienceVolume = value;
      else if (channel === "sfx") this.state.sfxVolume = value;
      const valueDisplay = html.querySelector(`.ase-hud-value[data-channel="${channel}"]`);
      if (valueDisplay) {
        valueDisplay.textContent = `${Math.round(value)}%`;
      }
      if (this.engine) {
        this.engine.setChannelVolume(channel, normalizedValue);
      }
      (_a2 = this.socket) == null ? void 0 : _a2.broadcastChannelVolume(channel, normalizedValue);
    });
  }
  _attachPlayerSlider(html) {
    const slider = html.querySelector('.ase-hud-slider[data-type="player"]');
    if (!slider) return;
    const startInteract = /* @__PURE__ */ __name(() => {
      this._isInteracting = true;
    }, "startInteract");
    const endInteract = /* @__PURE__ */ __name(() => {
      this._isInteracting = false;
    }, "endInteract");
    slider.addEventListener("pointerdown", startInteract);
    slider.addEventListener("pointerup", endInteract);
    slider.addEventListener("pointercancel", endInteract);
    slider.addEventListener("change", endInteract);
    slider.addEventListener("blur", endInteract);
    slider.addEventListener("input", (event) => {
      const value = parseFloat(event.target.value);
      const normalizedValue = value / 100;
      this.state.playerVolume = value;
      const valueDisplay = html.querySelector('.ase-hud-value[data-type="player"]');
      if (valueDisplay) {
        valueDisplay.textContent = `${Math.round(value)}%`;
      }
      if (this.playerEngine) {
        this.playerEngine.setLocalVolume(normalizedValue);
      }
      localStorage.setItem(`${MODULE_ID$5}-player-volume`, String(normalizedValue));
    });
  }
  _refreshFromEngine(forceRender = true) {
    if (!this.engine) return;
    if (this._isInteracting) return;
    const nextMaster = Math.round(this.engine.volumes.master * 100);
    const nextLocal = Math.round(this.engine.localVolume * 100);
    const nextMusic = Math.round(this.engine.getChannelVolume("music") * 100);
    const nextAmbience = Math.round(this.engine.getChannelVolume("ambience") * 100);
    const nextSfx = Math.round(this.engine.getChannelVolume("sfx") * 100);
    const changed = nextMaster !== this.state.masterVolume || nextLocal !== this.state.localVolume || nextMusic !== this.state.musicVolume || nextAmbience !== this.state.ambienceVolume || nextSfx !== this.state.sfxVolume;
    if (changed) {
      this.state.masterVolume = nextMaster;
      this.state.localVolume = nextLocal;
      this.state.musicVolume = nextMusic;
      this.state.ambienceVolume = nextAmbience;
      this.state.sfxVolume = nextSfx;
      if (forceRender) this.render();
    }
  }
  /**
   * Обновить громкости из внешних источников (например, из микшера)
   */
  updateVolumes() {
    if (this.state.isGM && this.engine) {
      this._refreshFromEngine(true);
    }
  }
  /**
   * Обновить состояние синхронизации
   */
  updateSyncState(enabled) {
    this._lastSyncEnabled = enabled;
    this.state.syncEnabled = enabled;
    this.render();
  }
  _onClose(options) {
    super._onClose(options);
    if (this.syncPollTimer) {
      clearInterval(this.syncPollTimer);
      this.syncPollTimer = null;
    }
  }
};
__name(_VolumeHudPanel, "VolumeHudPanel");
__publicField(_VolumeHudPanel, "PARTS", {
  main: {
    template: `modules/${MODULE_ID$5}/templates/volume-hud.hbs`
  }
});
__publicField(_VolumeHudPanel, "DEFAULT_OPTIONS", {
  id: "ase-volume-hud",
  classes: ["ase-volume-hud"],
  tag: "div",
  window: {
    frame: false,
    positioned: false,
    resizable: false,
    minimizable: false
  },
  position: {}
});
let VolumeHudPanel = _VolumeHudPanel;
const _LocalLibraryApp = class _LocalLibraryApp extends Application {
  // Debounce timer for renders
  constructor(library, parentApp, options = {}) {
    super(options);
    __publicField(this, "library");
    __publicField(this, "filterState");
    __publicField(this, "parentApp");
    // Using any to avoid circular import issues for now, or use interface
    __publicField(this, "_queueListener", null);
    __publicField(this, "_listenersInitialized", false);
    // Track if we've initialized delegated listeners
    __publicField(this, "_renderDebounceTimer", null);
    this.library = library;
    this.parentApp = parentApp;
    this.filterState = {
      searchQuery: "",
      selectedChannels: /* @__PURE__ */ new Set(["music", "ambience", "sfx"]),
      selectedPlaylistId: null,
      selectedTags: /* @__PURE__ */ new Set(),
      // Default sort
      sortBy: "date-desc"
    };
  }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "local-library",
      template: "modules/sound-engine-master/templates/library.hbs",
      title: "ASE.UI.Panel.SoundLibrary",
      width: 1100,
      height: 700,
      classes: ["sound-engine-master", "library"],
      resizable: true,
      tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "library" }]
    });
  }
  // Override render to delegate to main app
  render(force, options) {
    var _a2;
    if ((options == null ? void 0 : options.renderContext) === "queue-update") {
      if (this.parentApp && typeof this.parentApp.render === "function") {
        this.parentApp.captureScroll();
        return this.parentApp.render({ parts: ["main"] });
      }
    }
    if ((_a2 = window.ASE) == null ? void 0 : _a2.openPanel) {
      if (this.parentApp) {
        if (options == null ? void 0 : options.resetScroll) {
          this.parentApp.resetScroll("library");
        } else {
          this.parentApp.captureScroll();
        }
      }
      window.ASE.openPanel("library", true);
      return;
    }
    return super.render(force, options);
  }
  async close(options) {
    var _a2;
    if (this._queueListener && ((_a2 = window.ASE) == null ? void 0 : _a2.queue)) {
      window.ASE.queue.off("change", this._queueListener);
      this._queueListener = null;
    }
    if (this._renderDebounceTimer) {
      clearTimeout(this._renderDebounceTimer);
      this._renderDebounceTimer = null;
    }
    if (this._listenersInitialized) {
      $(document).off("mousedown.ase-lib-global");
      this._listenersInitialized = false;
    }
    return super.close(options);
  }
  localize(key, fallback) {
    var _a2, _b;
    return ((_b = (_a2 = game.i18n) == null ? void 0 : _a2.localize) == null ? void 0 : _b.call(_a2, key)) ?? fallback ?? key;
  }
  format(key, data, fallback) {
    var _a2, _b;
    return ((_b = (_a2 = game.i18n) == null ? void 0 : _a2.format) == null ? void 0 : _b.call(_a2, key, data)) ?? fallback ?? key;
  }
  notifyInfo(message, showPopup = false) {
    var _a2;
    if (!showPopup) return;
    (_a2 = ui.notifications) == null ? void 0 : _a2.info(message);
  }
  notifyWarn(message, showPopup = false) {
    var _a2;
    if (!showPopup) return;
    (_a2 = ui.notifications) == null ? void 0 : _a2.warn(message);
  }
  notifyError(message, showPopup = false) {
    var _a2;
    if (!showPopup) return;
    (_a2 = ui.notifications) == null ? void 0 : _a2.error(message);
  }
  openStyledDialog(data, options = {}) {
    const mergedOptions = foundry.utils.mergeObject({
      width: 460,
      resizable: false,
      height: "auto",
      classes: ["ase-dialog-window"]
    }, options);
    const classes = Array.isArray(mergedOptions.classes) ? mergedOptions.classes : [];
    if (!classes.includes("ase-dialog-window")) {
      classes.push("ase-dialog-window");
    }
    mergedOptions.classes = classes;
    const dialog = new Dialog(data, mergedOptions);
    dialog.render(true);
    const applyDialogSkin = /* @__PURE__ */ __name(() => {
      const appId = String(dialog.appId ?? "");
      const byAppId = appId ? $(`.app.window-app[data-appid="${appId}"]`) : $();
      const element = dialog.element;
      const byElement = (element == null ? void 0 : element.length) ? element.hasClass("app") ? element : element.closest(".app.window-app") : $();
      const allRoots = byAppId.add(byElement);
      if (!allRoots.length) return;
      allRoots.addClass("ase-dialog-window");
    }, "applyDialogSkin");
    applyDialogSkin();
    setTimeout(applyDialogSkin, 0);
    return dialog;
  }
  confirmStyledDialog(title, content, defaultButton = "cancel") {
    return new Promise((resolve) => {
      this.openStyledDialog({
        title,
        content,
        buttons: {
          confirm: {
            icon: '<i class="fas fa-check"></i>',
            label: this.localize("ASE.UI.Actions.Confirm", "Confirm"),
            callback: /* @__PURE__ */ __name(() => resolve(true), "callback")
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize("ASE.UI.Actions.Cancel", "Cancel"),
            callback: /* @__PURE__ */ __name(() => resolve(false), "callback")
          }
        },
        default: defaultButton,
        close: /* @__PURE__ */ __name(() => resolve(false), "close")
      });
    });
  }
  getData() {
    let items = this.library.getAllItems();
    const playlists = this.library.playlists.getAllPlaylists();
    const allTags = this.library.getAllTags();
    const stats = this.library.getStats();
    this.library.scanMissingDurations().then(() => {
    });
    items = this.applyFilters(items);
    items = this.applySorting(items);
    const orderedFavorites = this.library.getOrderedFavorites();
    const favorites = orderedFavorites.map((entry) => {
      var _a2, _b, _c, _d;
      const inQueue = entry.type === "track" ? ((_b = (_a2 = window.ASE) == null ? void 0 : _a2.queue) == null ? void 0 : _b.hasItem(entry.id)) ?? false : ((_d = (_c = window.ASE) == null ? void 0 : _c.queue) == null ? void 0 : _d.getItems().some((q) => q.playlistId === entry.id)) ?? false;
      if (entry.type === "track") {
        const item = this.library.getItem(entry.id);
        if (!item) return null;
        return {
          id: item.id,
          name: item.name,
          type: "track",
          group: this.inferGroupFromTags(item.tags),
          inQueue
        };
      } else {
        const playlist = this.library.playlists.getPlaylist(entry.id);
        if (!playlist) return null;
        return {
          id: playlist.id,
          name: playlist.name,
          type: "playlist",
          inQueue
        };
      }
    }).filter((f) => f !== null);
    const tagSet = new Set(allTags);
    this.filterState.selectedTags.forEach((t) => tagSet.add(t));
    const tags = Array.from(tagSet).sort().map((tag) => {
      const normalizedTag = tag.startsWith("#") ? tag.substring(1) : tag;
      const isSelected = this.filterState.selectedTags.has(tag) || this.filterState.selectedTags.has(normalizedTag);
      return {
        name: normalizedTag,
        // Display name (without #)
        value: normalizedTag,
        // Data value (also normalized for consistency)
        selected: isSelected
      };
    });
    const playlistsViewData = playlists.map((p) => ({
      ...this.getPlaylistViewData(p),
      selected: p.id === this.filterState.selectedPlaylistId
    }));
    const allChannelsSelected = this.filterState.selectedChannels.size === 3;
    const hasActiveFilters = !!(!allChannelsSelected || this.filterState.selectedPlaylistId || this.filterState.selectedTags.size > 0);
    const itemsViewData = items.map((item) => this.getItemViewData(item));
    return {
      items: itemsViewData,
      playlists: playlistsViewData,
      favorites,
      tags,
      stats: {
        totalItems: stats.totalItems,
        favoriteItems: stats.favoriteItems,
        playlists: stats.totalPlaylists,
        tagCount: stats.tagCount
      },
      searchQuery: this.filterState.searchQuery,
      filters: {
        music: this.filterState.selectedChannels.has("music"),
        ambience: this.filterState.selectedChannels.has("ambience"),
        sfx: this.filterState.selectedChannels.has("sfx")
      },
      selectedPlaylistId: this.filterState.selectedPlaylistId,
      sortBy: this.filterState.sortBy,
      hasActiveFilters,
      sortOptions: [
        { value: "date-desc", label: game.i18n.localize("ASE.UI.SortOption.DateDesc") },
        { value: "date-asc", label: game.i18n.localize("ASE.UI.SortOption.DateAsc") },
        { value: "name-asc", label: game.i18n.localize("ASE.UI.SortOption.NameAsc") },
        { value: "name-desc", label: game.i18n.localize("ASE.UI.SortOption.NameDesc") },
        { value: "duration-asc", label: game.i18n.localize("ASE.UI.SortOption.DurationAsc") },
        { value: "duration-desc", label: game.i18n.localize("ASE.UI.SortOption.DurationDesc") }
      ]
    };
  }
  getPlaylistViewData(playlist) {
    var _a2, _b;
    const inQueue = ((_b = (_a2 = window.ASE) == null ? void 0 : _a2.queue) == null ? void 0 : _b.getItems().some(
      (item) => item.playlistId === playlist.id
    )) ?? false;
    return {
      id: playlist.id,
      name: playlist.name,
      itemCount: playlist.items.length,
      trackCount: playlist.items.length,
      // Alias for template
      favorite: playlist.favorite,
      inQueue,
      selected: false,
      playbackMode: playlist.playbackMode
    };
  }
  getItemViewData(item) {
    var _a2, _b, _c, _d, _e;
    const inQueue = ((_b = (_a2 = window.ASE) == null ? void 0 : _a2.queue) == null ? void 0 : _b.hasItem(item.id)) ?? false;
    const durationFormatted = formatTime(item.duration);
    const player = (_e = (_d = (_c = window.ASE) == null ? void 0 : _c.engine) == null ? void 0 : _d.getTrack) == null ? void 0 : _e.call(_d, item.id);
    const isPlaying = (player == null ? void 0 : player.state) === "playing";
    const isPaused = (player == null ? void 0 : player.state) === "paused";
    return {
      id: item.id,
      name: item.name,
      url: item.url,
      duration: durationFormatted,
      durationFormatted,
      durationSeconds: item.duration,
      tags: item.tags,
      favorite: item.favorite,
      group: item.group || "music",
      inQueue,
      isPlaying,
      isPaused,
      playbackMode: item.playbackMode
    };
  }
  inferGroupFromTags(tags) {
    const lowerTags = tags.map((t) => t.toLowerCase());
    if (lowerTags.some((t) => t.includes("music"))) return "music";
    if (lowerTags.some((t) => t.includes("ambient") || t.includes("ambience"))) return "ambience";
    if (lowerTags.some((t) => t.includes("sfx") || t.includes("effect"))) return "sfx";
    return "music";
  }
  // ─────────────────────────────────────────────────────────────
  // Filtering & Sorting
  // ─────────────────────────────────────────────────────────────
  applyFilters(items) {
    let filtered = items;
    if (this.filterState.searchQuery) {
      const query = this.filterState.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) => item.name.toLowerCase().includes(query) || item.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    }
    if (this.filterState.selectedChannels.size > 0) {
      filtered = filtered.filter((item) => {
        const group = item.group || "music";
        return this.filterState.selectedChannels.has(group);
      });
    }
    if (this.filterState.selectedPlaylistId) {
      const playlist = this.library.playlists.getPlaylist(this.filterState.selectedPlaylistId);
      if (playlist) {
        const playlistItemIds = new Set(playlist.items.map((i) => i.libraryItemId));
        filtered = filtered.filter((item) => playlistItemIds.has(item.id));
      }
    }
    if (this.filterState.selectedTags.size > 0) {
      const selectedTagsArray = Array.from(this.filterState.selectedTags);
      filtered = filtered.filter(
        (item) => selectedTagsArray.every((tag) => item.tags.includes(tag))
      );
    }
    return filtered;
  }
  applySorting(items) {
    const sorted = [...items];
    switch (this.filterState.sortBy) {
      case "playable": {
        const viewDataCache = /* @__PURE__ */ new Map();
        for (const item of sorted) {
          viewDataCache.set(item.id, this.getItemViewData(item));
        }
        sorted.sort((a, b) => {
          const aData = viewDataCache.get(a.id);
          const bData = viewDataCache.get(b.id);
          const aPriority = aData.isPlaying ? 2 : aData.isPaused ? 1 : 0;
          const bPriority = bData.isPlaying ? 2 : bData.isPaused ? 1 : 0;
          if (aPriority !== bPriority) {
            return bPriority - aPriority;
          }
          return b.addedAt - a.addedAt;
        });
        break;
      }
      case "name-asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "date-asc":
        sorted.sort((a, b) => a.addedAt - b.addedAt);
        break;
      case "date-desc":
        sorted.sort((a, b) => b.addedAt - a.addedAt);
        break;
      case "duration-asc":
        sorted.sort((a, b) => a.duration - b.duration);
        break;
      case "duration-desc":
        sorted.sort((a, b) => b.duration - a.duration);
        break;
    }
    return sorted;
  }
  activateListeners(html) {
    var _a2;
    super.activateListeners(html);
    html.off(".ase-library");
    if (!this._queueListener && ((_a2 = window.ASE) == null ? void 0 : _a2.queue)) {
      this._queueListener = () => {
        if (this._renderDebounceTimer) {
          clearTimeout(this._renderDebounceTimer);
        }
        this._renderDebounceTimer = window.setTimeout(() => {
          this._renderDebounceTimer = null;
          this.render(false, { renderContext: "queue-update" });
        }, 50);
      };
      window.ASE.queue.on("change", this._queueListener);
    }
    if (!this._listenersInitialized) {
      $(document).off("mousedown.ase-lib-global");
      $(document).on("mousedown.ase-lib-global", "#local-library [data-action]", (e) => {
        e.stopPropagation();
      });
      this._listenersInitialized = true;
    }
    html.find('[data-action="add-track"]').on("click.ase-library", this.onAddTrack.bind(this));
    html.find(".ase-search-input").on("keydown.ase-library", this.onSearchKeydown.bind(this));
    html.find(".ase-search-input").on("input.ase-library", this.onSearchInput.bind(this));
    html.find(".ase-search-clear").on("click.ase-library", this.onClearSearch.bind(this));
    html.find('[data-action="filter-channel"]').on("click.ase-library", this._onFilterChannel.bind(this));
    html.find('[data-action="sort-change"]').on("change.ase-library", this.onChangeSort.bind(this));
    html.find('[data-action="clear-filters"]').on("click.ase-library", this.onClearFilters.bind(this));
    html.find('[data-action="toggle-tag"]').on("click.ase-library", this.onToggleTag.bind(this));
    html.find('[data-action="add-tag"]').on("click.ase-library", this.onAddTag.bind(this));
    html.find('[data-action="play-track"]').on("click.ase-library", this.onPlayTrack.bind(this));
    html.find('[data-action="pause-track"]').on("click.ase-library", this.onPauseTrack.bind(this));
    html.find('[data-action="stop-track"]').on("click.ase-library", this.onStopTrack.bind(this));
    html.find('[data-action="add-to-queue"]').on("click.ase-library", this.onAddToQueue.bind(this));
    html.find('[data-action="toggle-favorite"]').on("click.ase-library", this.onToggleFavorite.bind(this));
    html.find('[data-action="add-to-playlist"]').on("click.ase-library", this.onAddToPlaylist.bind(this));
    html.find('[data-action="track-menu"]').on("click.ase-library", this.onTrackMenu.bind(this));
    html.find('[data-action="add-tag-to-track"]').on("click.ase-library", this.onAddTagToTrack.bind(this));
    html.find('[data-action="channel-dropdown"]').on("click.ase-library", this.onChannelDropdown.bind(this));
    html.find('[data-action="delete-track"]').on("click.ase-library", this.onDeleteTrack.bind(this));
    html.find(".ase-track-player-item").on("contextmenu.ase-library", this.onTrackContext.bind(this));
    html.find(".ase-track-tags .ase-tag").on("contextmenu.ase-library", this.onTrackTagContext.bind(this));
    html.find('[data-action="select-playlist"]').on("click.ase-library", this.onSelectPlaylist.bind(this));
    html.find('[data-action="create-playlist"]').on("click.ase-library", this.onCreatePlaylist.bind(this));
    html.find('[data-action="toggle-playlist-favorite"]').on("click.ase-library", this.onTogglePlaylistFavorite.bind(this));
    html.find('[data-action="toggle-playlist-queue"]').on("click.ase-library", this.onTogglePlaylistQueue.bind(this));
    html.find('[data-action="play-playlist"]').on("click.ase-library", this.onPlayPlaylist.bind(this));
    html.find('[data-action="playlist-mode-dropdown"]').on("click.ase-library", this.onPlaylistModeClick.bind(this));
    html.find('[data-action="track-mode-dropdown"]').on("click.ase-library", this.onTrackModeClick.bind(this));
    html.find('[data-action="playlist-menu"]').on("click.ase-library", this.onPlaylistMenu.bind(this));
    html.find(".ase-list-item[data-playlist-id]").on("contextmenu.ase-library", this.onPlaylistContext.bind(this));
    html.find('[data-action="remove-from-favorites"]').on("click.ase-library", this.onRemoveFromFavorites.bind(this));
    html.find('[data-action="toggle-favorite-queue"]').on("click.ase-library", this.onToggleFavoriteQueue.bind(this));
    this.setupDragAndDrop(html);
    this.setupFoundryDragDrop(html);
    html.find(".ase-track-player-item").on("mouseenter.ase-library", (event) => {
      const trackId = $(event.currentTarget).data("item-id");
      if (trackId) {
        this.highlightPlaylistsContainingTrack(trackId);
      }
    });
    html.find(".ase-track-player-item").on("mouseleave.ase-library", () => {
      this.clearPlaylistHighlights();
    });
    html.find(".ase-tags-inline .ase-tag").on("contextmenu.ase-library", this.onTagContext.bind(this));
    Logger.debug("LocalLibraryApp listeners activated");
  }
  // ─────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────
  async onAddTrack(event) {
    event.preventDefault();
    const fp = new FilePicker({
      type: "audio",
      callback: /* @__PURE__ */ __name(async (path) => {
        await this.addTrackFromPath(path);
      }, "callback")
    });
    fp.render(true);
  }
  async addTrackFromPath(path, group = "music") {
    try {
      const selectedTags = Array.from(this.filterState.selectedTags);
      const item = await this.library.addItem(path, void 0, group, selectedTags);
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(`Added to library: ${item.name}`, true);
    } catch (error) {
      Logger.error("Failed to add track to library:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.notifyError(`Failed to add track: ${errorMessage}`, true);
    }
  }
  async onToggleFavorite(event) {
    event.preventDefault();
    event.stopPropagation();
    const btn = $(event.currentTarget);
    const itemId = btn.closest("[data-item-id]").data("item-id");
    try {
      const icon = btn.find("i");
      if (icon.hasClass("far")) {
        icon.removeClass("far").addClass("fas active");
        btn.addClass("active");
      } else {
        icon.removeClass("fas active").addClass("far");
        btn.removeClass("active");
      }
      if (this.parentApp) this.parentApp.captureScroll();
      const isFavorite = this.library.toggleFavorite(itemId);
      this.render();
      this.notifyInfo(isFavorite ? "Added to favorites" : "Removed from favorites");
    } catch (error) {
      Logger.error("Failed to toggle favorite:", error);
      this.notifyError("Failed to update favorite status");
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Playback Mode Handlers
  // ─────────────────────────────────────────────────────────────
  onTrackModeClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const btn = $(event.currentTarget);
    let itemId = btn.data("item-id");
    if (!itemId) {
      itemId = btn.closest("[data-item-id]").data("item-id");
    }
    const item = this.library.getItem(itemId);
    if (!item) {
      Logger.warn(`Track mode clicked: item not found for ID ${itemId}`);
      return;
    }
    const modes = [
      { label: "Inherit (Default)", value: "inherit", icon: "fa-arrow-turn-down" },
      { label: "Loop", value: "loop", icon: "fa-repeat" },
      { label: "Single", value: "single", icon: "fa-arrow-right-to-line" },
      { label: "Linear", value: "linear", icon: "fa-arrow-right" },
      { label: "Random", value: "random", icon: "fa-shuffle" }
    ];
    this.showModeContextMenu(event, modes, (mode) => {
      this.library.updateItem(itemId, { playbackMode: mode });
      this.render();
    });
  }
  onPlaylistModeClick(event) {
    event.preventDefault();
    event.stopPropagation();
    Logger.debug("Playlist Mode Clicked");
    const btn = $(event.currentTarget);
    let playlistId = btn.data("playlist-id");
    if (!playlistId) {
      playlistId = btn.closest("[data-playlist-id]").data("playlist-id");
    }
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      Logger.warn(`Playlist Mode Clicked: Playlist not found for ID ${playlistId}`);
      return;
    }
    Logger.debug(`Playlist Mode Clicked: Found playlist ${playlist.name} (${playlist.id})`);
    const modes = [
      { label: "Loop (Default)", value: "loop", icon: "fa-repeat" },
      { label: "Linear", value: "linear", icon: "fa-arrow-right" },
      { label: "Random", value: "random", icon: "fa-shuffle" }
    ];
    this.showModeContextMenu(event, modes, (mode) => {
      this.library.playlists.updatePlaylist(playlistId, { playbackMode: mode });
      this.render();
    });
  }
  showModeContextMenu(event, modes, callback) {
    const localize = /* @__PURE__ */ __name((key) => game.i18n.localize(key), "localize");
    const menuHtml = `
        <div id="ase-mode-menu" class="ase-context-menu">
          ${modes.map((m) => `
            <div class="ase-ctx-item" data-value="${m.value}">
                <i class="fa-solid ${m.icon}"></i> 
                <span>${localize(`ASE.UI.PlaybackMode.${m.value}`)}</span>
            </div>
          `).join("")}
        </div>
      `;
    $("#ase-mode-menu").remove();
    const menu = $(menuHtml);
    $("body").append(menu);
    menu.css({ top: event.clientY, left: event.clientX });
    menu.find(".ase-ctx-item").on("click", (e) => {
      e.stopPropagation();
      const val = $(e.currentTarget).data("value");
      Logger.debug(`Mode Selected: ${val}`);
      callback(val);
      menu.remove();
    });
    setTimeout(() => {
      $("body").one("click", () => {
        Logger.debug("Mode Menu: Closed by outside click");
        menu.remove();
      });
    }, 10);
  }
  async onPlayPlaylist(event) {
    var _a2;
    event.preventDefault();
    event.stopPropagation();
    const playlistId = $(event.currentTarget).closest("[data-playlist-id]").data("playlist-id");
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (playlist && playlist.items.length > 0) {
      const queue = (_a2 = window.ASE) == null ? void 0 : _a2.queue;
      if (queue) {
        let playlistItemsInQueue = queue.getItems().filter((item) => item.playlistId === playlistId);
        if (playlistItemsInQueue.length === 0) {
          playlistItemsInQueue = queue.addPlaylist(playlistId, playlist.items);
        }
        if (playlistItemsInQueue.length > 0) {
          let startItem = playlistItemsInQueue[0];
          if (playlist.playbackMode === "random" && playlistItemsInQueue.length > 1) {
            const randomIndex = Math.floor(Math.random() * playlistItemsInQueue.length);
            startItem = playlistItemsInQueue[randomIndex];
          }
          const libItem = this.library.getItem(startItem.libraryItemId);
          if (libItem) {
            Logger.info(`Starting playlist playback: ${playlist.name} (Track: ${libItem.name})`);
            await window.ASE.engine.playTrack(libItem.id, 0, { type: "playlist", id: playlistId });
          }
        }
        this.notifyInfo(game.i18n.format("ASE.UI.Notification.PlayingPlaylist", { name: playlist.name }));
        this.render();
      } else {
        Logger.warn("Queue Manager not available, playing first track directly");
        let trackToPlay = playlist.items[0];
        const libItem = this.library.getItem(trackToPlay.libraryItemId);
        if (libItem) {
          await window.ASE.engine.playTrack(libItem.id, 0, { type: "playlist", id: playlistId });
        }
      }
    } else {
      this.notifyWarn(game.i18n.localize("ASE.UI.Warning.PlaylistIsEmpty"));
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Playlist Event Handlers
  // ─────────────────────────────────────────────────────────────
  async onCreatePlaylist(event) {
    event.preventDefault();
    const name = await this.promptPlaylistName();
    if (!name) return;
    try {
      const playlist = this.library.playlists.createPlaylist(name);
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(`Created playlist: ${playlist.name}`);
    } catch (error) {
      Logger.error("Failed to create playlist:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.notifyError(`Failed to create playlist: ${errorMessage}`);
    }
  }
  async onTogglePlaylistFavorite(event) {
    event.preventDefault();
    event.stopPropagation();
    const playlistId = $(event.currentTarget).closest("[data-playlist-id]").data("playlist-id");
    try {
      if (this.parentApp) this.parentApp.captureScroll();
      const isFavorite = this.library.playlists.togglePlaylistFavorite(playlistId);
      this.render();
      this.notifyInfo(isFavorite ? "Added to favorites" : "Removed from favorites");
    } catch (error) {
      Logger.error("Failed to toggle playlist favorite:", error);
      this.notifyError("Failed to update favorite status");
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Toolbar Event Handlers
  // ─────────────────────────────────────────────────────────────
  onSearchInput(event) {
    const val = $(event.currentTarget).val() || "";
    const trimmedVal = val.trim();
    if (!trimmedVal && this.filterState.searchQuery) {
      this.filterState.searchQuery = "";
      this.render(false, { resetScroll: true });
    }
  }
  onSearchKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      const query = ($(event.currentTarget).val() || "").trim().toLowerCase();
      if (this.filterState.searchQuery !== query) {
        this.filterState.searchQuery = query;
        this.render(false, { resetScroll: true });
      }
    }
  }
  onClearSearch(event) {
    event.preventDefault();
    this.filterState.searchQuery = "";
    const wrapper = $(event.currentTarget).closest(".ase-search-input-wrapper");
    wrapper.find(".ase-search-input").val("");
    wrapper.find(".ase-search-input").val("");
    this.render(false, { resetScroll: true });
  }
  _onFilterChannel(event) {
    event.preventDefault();
    const btn = $(event.currentTarget);
    const channel = btn.data("channel");
    if (this.filterState.selectedChannels.has(channel)) {
      this.filterState.selectedChannels.delete(channel);
      btn.removeClass("active");
    } else {
      this.filterState.selectedChannels.add(channel);
      btn.addClass("active");
    }
    this.render(false, { resetScroll: true });
    Logger.debug("Filter channel toggled:", channel, this.filterState.selectedChannels);
  }
  onChangeSort(event) {
    const sortValue = $(event.currentTarget).val();
    this.filterState.sortBy = sortValue;
    this.render();
    Logger.debug("Sort changed:", sortValue);
  }
  onClearFilters(event) {
    event.preventDefault();
    this.filterState.searchQuery = "";
    this.filterState.selectedPlaylistId = null;
    this.filterState.selectedTags.clear();
    this.render(false, { resetScroll: true });
    this.notifyInfo("Filters cleared (Channels preserved)");
  }
  // ─────────────────────────────────────────────────────────────
  // Tag Event Handlers
  // ─────────────────────────────────────────────────────────────
  onToggleTag(event) {
    event.preventDefault();
    const tag = String($(event.currentTarget).data("tag"));
    if (this.filterState.selectedTags.has(tag)) {
      this.filterState.selectedTags.delete(tag);
    } else {
      this.filterState.selectedTags.add(tag);
    }
    this.render(false, { resetScroll: true });
  }
  onTagContext(event) {
    event.preventDefault();
    event.stopPropagation();
    const tag = String($(event.currentTarget).data("tag"));
    const menuHtml = `
      <div id="ase-custom-context-menu" style="position: fixed; z-index: 10000; background: #222; border: 1px solid #444; border-radius: 4px; padding: 5px 0;">
        <div class="ase-ctx-item" data-action="edit" style="padding: 5px 15px; cursor: pointer; color: white;">
            <i class="fas fa-edit" style="margin-right: 5px;"></i> Edit
        </div>
        <div class="ase-ctx-item" data-action="delete" style="padding: 5px 15px; cursor: pointer; color: #ff6666;">
            <i class="fas fa-trash" style="margin-right: 5px;"></i> Delete
        </div>
      </div>
    `;
    $("#ase-custom-context-menu").remove();
    const menu = $(menuHtml);
    $("body").append(menu);
    menu.css({
      top: event.clientY,
      left: event.clientX
    });
    menu.find('[data-action="edit"]').on("click", () => {
      this.renameTag(tag);
      menu.remove();
    });
    menu.find('[data-action="delete"]').on("click", () => {
      this.deleteTag(tag);
      menu.remove();
    });
    menu.find(".ase-ctx-item").hover(
      function() {
        $(this).css("background", "#333");
      },
      function() {
        $(this).css("background", "transparent");
      }
    );
    $(document).one("click", () => {
      menu.remove();
    });
  }
  async onAddTag(event) {
    event.preventDefault();
    const rawTagName = await this.promptTagName();
    if (!rawTagName) return;
    const tagName = rawTagName.trim().replace(/^#/, "");
    if (!tagName) return;
    this.filterState.selectedTags.add(tagName);
    this.library.addCustomTag(tagName);
    this.render();
    this.notifyInfo(
      this.format("ASE.UI.Notification.TagAdded", { tag: tagName }, `Tag "${tagName}" added.`)
    );
  }
  // Helper for Context Menu Callbacks to ensure `this` binding and argument passing
  _onRenameTag(header) {
    const tag = header.data("tag");
    this.renameTag(tag);
  }
  _onDeleteTag(header) {
    const tag = header.data("tag");
    this.deleteTag(tag);
  }
  // Correcting selector/listener activation for Context Menu if needed
  // Foundry ContextMenu usually works fine. If z-index issue, it's CSS.
  // We will force high z-index via CSS injection or ensure fixed position.
  // BUT: user said "Buttons don't work". 
  // This usually means the callback failed or `this` yielded undefined.
  // The inline arrow functions `() => this.renameTag(tag)` in `activateListeners` SHOULD be fine if `this` is correct.
  // Let's verify `activateListeners`.
  // ─────────────────────────────────────────────────────────────
  // Tag Management Logic
  // ─────────────────────────────────────────────────────────────
  async renameTag(oldTag) {
    const newTag = await this.promptTagName(oldTag);
    if (!newTag || newTag === oldTag) return;
    const count = this.library.renameTag(oldTag, newTag);
    if (this.filterState.selectedTags.has(oldTag)) {
      this.filterState.selectedTags.delete(oldTag);
      this.filterState.selectedTags.add(newTag);
    }
    if (count > 0) {
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(
        this.format("ASE.UI.Notification.TagRenamedOnTracks", { oldTag, newTag, count }, `Renamed tag "${oldTag}" to "${newTag}" on ${count} tracks.`)
      );
    }
  }
  async deleteTag(tag) {
    const tagStr = String(tag);
    const confirm = await this.confirmStyledDialog(
      this.localize("ASE.UI.Dialog.DeleteTag.Title", "Delete Tag"),
      `<p>${this.format("ASE.UI.Dialog.DeleteTag.ContentAllTracks", { tag: tagStr }, `Are you sure you want to delete tag "${tagStr}" from all tracks?`)}</p>`
    );
    if (!confirm) return;
    const count = this.library.deleteTag(tagStr);
    this.filterState.selectedTags.delete(tagStr);
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
    this.notifyInfo(
      count > 0 ? this.format("ASE.UI.Notification.TagDeletedFromTracks", { tag: tagStr, count }, `Deleted tag "${tagStr}" from ${count} tracks.`) : this.format("ASE.UI.Notification.CustomTagDeleted", { tag: tagStr }, `Deleted custom tag "${tagStr}".`)
    );
  }
  async promptTagName(current = "") {
    return new Promise((resolve) => {
      const isRename = Boolean(current);
      this.openStyledDialog({
        title: this.localize(
          isRename ? "ASE.UI.Dialog.RenameTag.Title" : "ASE.UI.Dialog.NewTag.Title",
          isRename ? "Rename Tag" : "New Tag"
        ),
        content: `
          <form class="ase-dialog-form">
            <div class="form-group">
              <label>${this.localize("ASE.UI.Dialog.TagName.Label", "Tag Name")}</label>
              <input type="text" id="tag-name" value="${current}" autofocus />
            </div>
          </form>
        `,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: this.localize("ASE.UI.Actions.Ok", "OK"),
            callback: /* @__PURE__ */ __name((html) => resolve(html.find("#tag-name").val()), "callback")
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize("ASE.UI.Actions.Cancel", "Cancel"),
            callback: /* @__PURE__ */ __name(() => resolve(null), "callback")
          }
        },
        default: "ok",
        close: /* @__PURE__ */ __name(() => resolve(null), "close")
      });
    });
  }
  // ─────────────────────────────────────────────────────────────
  // Track Event Handlers (Extended)
  // ─────────────────────────────────────────────────────────────
  async onPlayTrack(event) {
    var _a2, _b, _c, _d, _e, _f;
    event.preventDefault();
    event.stopPropagation();
    const itemId = $(event.currentTarget).data("item-id");
    const item = this.library.getItem(itemId);
    if (!item) {
      Logger.warn("Track not found:", itemId);
      return;
    }
    const engine = (_a2 = window.ASE) == null ? void 0 : _a2.engine;
    const queue = (_b = window.ASE) == null ? void 0 : _b.queue;
    if (!engine) {
      Logger.warn("Audio engine not available");
      return;
    }
    if (queue && !queue.hasItem(itemId)) {
      queue.addItem(itemId, {
        group: item.group,
        volume: 1
      });
    }
    let player = (_c = engine.getTrack) == null ? void 0 : _c.call(engine, itemId);
    if (!player) {
      player = await ((_d = engine.createTrack) == null ? void 0 : _d.call(engine, {
        id: itemId,
        url: item.url,
        group: item.group,
        volume: 1
      }));
    }
    let offset = 0;
    if (player && player.state === "paused") {
      offset = player.getCurrentTime();
    }
    let context = { type: "track" };
    if (this.filterState.selectedPlaylistId) {
      context = { type: "playlist", id: this.filterState.selectedPlaylistId };
    }
    await ((_e = engine.playTrack) == null ? void 0 : _e.call(engine, itemId, offset, context));
    const socket = (_f = window.ASE) == null ? void 0 : _f.socket;
    if (socket && socket.syncEnabled) {
      Logger.debug("LocalLibrary: Broadcasting Play for track", itemId);
      socket.broadcastTrackPlay(itemId, offset);
    }
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }
  onStopTrack(event) {
    var _a2, _b, _c;
    event.preventDefault();
    event.stopPropagation();
    const itemId = $(event.currentTarget).data("item-id");
    Logger.debug("Stop track:", itemId);
    (_a2 = window.ASE.engine) == null ? void 0 : _a2.stopTrack(itemId);
    const socket = (_b = window.ASE) == null ? void 0 : _b.socket;
    if (socket && socket.syncEnabled) {
      socket.broadcastTrackStop(itemId);
    }
    if ((_c = window.ASE) == null ? void 0 : _c.queue) {
      window.ASE.queue.removeByLibraryItemId(itemId);
    }
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }
  onPauseTrack(event) {
    var _a2, _b, _c;
    event.preventDefault();
    event.stopPropagation();
    const itemId = $(event.currentTarget).data("item-id");
    const engine = (_a2 = window.ASE) == null ? void 0 : _a2.engine;
    const player = (_b = engine == null ? void 0 : engine.getTrack) == null ? void 0 : _b.call(engine, itemId);
    const currentTime = (player == null ? void 0 : player.getCurrentTime()) ?? 0;
    engine == null ? void 0 : engine.pauseTrack(itemId);
    const socket = (_c = window.ASE) == null ? void 0 : _c.socket;
    if (socket && socket.syncEnabled) {
      socket.broadcastTrackPause(itemId, currentTime);
    }
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }
  onAddToQueue(event) {
    var _a2;
    event.preventDefault();
    event.stopPropagation();
    const itemId = String($(event.currentTarget).data("item-id"));
    if (!((_a2 = window.ASE) == null ? void 0 : _a2.queue)) {
      Logger.warn("Queue manager not available");
      return;
    }
    const item = this.library.getItem(itemId);
    if (!item) {
      Logger.warn("Item not found:", itemId);
      return;
    }
    if (window.ASE.queue.hasItem(itemId)) {
      window.ASE.queue.removeByLibraryItemId(itemId);
      Logger.debug("Removed from queue:", itemId);
      this.notifyInfo(`"${item.name}" removed from queue`);
    } else {
      window.ASE.queue.addItem(itemId, {
        group: item.group || "music",
        volume: 1
      });
      Logger.debug("Added to queue:", itemId);
      this.notifyInfo(`"${item.name}" added to queue`);
    }
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }
  async onAddTagToTrack(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = $(event.currentTarget).data("item-id");
    Logger.debug("Add tag to track:", itemId);
    this.showTagEditor(itemId);
  }
  async onAddToPlaylist(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = $(event.currentTarget).data("item-id");
    const item = this.library.getItem(itemId);
    if (!item) {
      this.notifyError("Track not found");
      return;
    }
    const playlists = this.library.playlists.getAllPlaylists();
    if (playlists.length === 0) {
      this.notifyWarn("No playlists available. Create one first.");
      return;
    }
    const selectedPlaylistId = await this.promptPlaylistSelection(playlists);
    if (!selectedPlaylistId) return;
    try {
      const group = this.inferGroupFromTags(item.tags);
      this.library.playlists.addTrackToPlaylist(selectedPlaylistId, itemId, group);
      this.render();
      this.notifyInfo(`Added "${item.name}" to playlist`);
    } catch (error) {
      Logger.error("Failed to add track to playlist:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.notifyError(`Failed to add to playlist: ${errorMessage}`);
    }
  }
  onTrackMenu(event) {
    var _a2;
    event.preventDefault();
    event.stopPropagation();
    $(event.currentTarget).data("item-id");
    const trackElement = $(event.currentTarget).closest(".ase-track-player-item");
    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: event.clientX,
      clientY: event.clientY
    });
    (_a2 = trackElement[0]) == null ? void 0 : _a2.dispatchEvent(contextMenuEvent);
  }
  // ─────────────────────────────────────────────────────────────
  // Favorites Event Handlers
  // ─────────────────────────────────────────────────────────────
  onRemoveFromFavorites(event) {
    event.preventDefault();
    event.stopPropagation();
    const favoriteId = String($(event.currentTarget).data("favorite-id"));
    const favoriteType = String($(event.currentTarget).data("favorite-type"));
    Logger.debug("Remove from favorites:", favoriteId, favoriteType);
    if (favoriteType === "playlist") {
      const playlist = this.library.playlists.getPlaylist(favoriteId);
      if (playlist) {
        this.library.playlists.updatePlaylist(favoriteId, { favorite: false });
        this.notifyInfo(`Removed "${playlist.name}" from favorites`);
      }
    } else {
      const item = this.library.getItem(favoriteId);
      if (item) {
        this.library.toggleFavorite(favoriteId);
        this.notifyInfo(`Removed "${item.name}" from favorites`);
      }
    }
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }
  onToggleFavoriteQueue(event) {
    var _a2;
    event.preventDefault();
    event.stopPropagation();
    const favoriteId = String($(event.currentTarget).data("favorite-id"));
    const favoriteType = String($(event.currentTarget).data("favorite-type"));
    if (!((_a2 = window.ASE) == null ? void 0 : _a2.queue)) {
      Logger.warn("Queue manager not available");
      return;
    }
    if (favoriteType === "playlist") {
      const playlist = this.library.playlists.getPlaylist(favoriteId);
      if (!playlist) return;
      const inQueue = window.ASE.queue.getItems().some((item) => item.playlistId === favoriteId);
      if (inQueue) {
        const itemsToRemove = window.ASE.queue.getItems().filter((item) => item.playlistId === favoriteId);
        itemsToRemove.forEach((item) => window.ASE.queue.removeItem(item.id));
        this.notifyInfo(`Removed "${playlist.name}" from queue`);
      } else {
        const playlistItems = playlist.items.map((pItem) => ({
          libraryItemId: pItem.libraryItemId,
          group: pItem.group || "music",
          volume: pItem.volume
        }));
        window.ASE.queue.addPlaylist(favoriteId, playlistItems);
        this.notifyInfo(`Added "${playlist.name}" to queue`);
      }
    } else {
      const item = this.library.getItem(favoriteId);
      if (!item) return;
      const inQueue = window.ASE.queue.hasItem(favoriteId);
      if (inQueue) {
        const queueItems = window.ASE.queue.getItems().filter((q) => q.libraryItemId === favoriteId);
        queueItems.forEach((q) => window.ASE.queue.removeItem(q.id));
        this.notifyInfo(`Removed "${item.name}" from queue`);
      } else {
        window.ASE.queue.addItem(favoriteId, {
          group: this.inferGroupFromTags(item.tags),
          volume: 1
        });
        this.notifyInfo(`Added "${item.name}" to queue`);
      }
    }
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
  }
  // ─────────────────────────────────────────────────────────────
  // Track Control Handlers
  // ─────────────────────────────────────────────────────────────
  onChannelDropdown(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = String($(event.currentTarget).data("item-id"));
    const item = this.library.getItem(itemId);
    if (!item) return;
    const currentGroup = item.group || "music";
    const channels = ["music", "ambience", "sfx"];
    const i18n = game.i18n;
    const localize = /* @__PURE__ */ __name((key, fallback) => {
      var _a2;
      return ((_a2 = i18n == null ? void 0 : i18n.localize) == null ? void 0 : _a2.call(i18n, key)) ?? fallback;
    }, "localize");
    const menu = $(`
      <div class="ase-dropdown-menu">
        ${channels.map((ch) => `
          <div class="ase-dropdown-item ${ch === currentGroup ? "active" : ""}" data-channel="${ch}">
            ${localize(`ASE.Groups.${ch}`, ch.charAt(0).toUpperCase() + ch.slice(1))}
          </div>
        `).join("")}
      </div>
    `);
    const rect = event.currentTarget.getBoundingClientRect();
    menu.css({ top: rect.bottom + 2, left: rect.left });
    $("body").append(menu);
    menu.find(".ase-dropdown-item").on("click", (e) => {
      const newChannel = $(e.currentTarget).data("channel");
      this.updateTrackChannel(itemId, newChannel);
      menu.remove();
    });
    setTimeout(() => {
      $(document).one("click", () => menu.remove());
    }, 10);
  }
  updateTrackChannel(itemId, channel) {
    var _a2, _b, _c;
    const item = this.library.getItem(itemId);
    if (!item) return;
    const group = channel;
    this.library.updateItem(itemId, { group });
    const engine = (_a2 = window.ASE) == null ? void 0 : _a2.engine;
    if (engine && typeof engine.setTrackChannel === "function") {
      engine.setTrackChannel(itemId, group);
    }
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
    const i18n = game.i18n;
    const channelLabel = ((_b = i18n == null ? void 0 : i18n.localize) == null ? void 0 : _b.call(i18n, `ASE.Groups.${channel}`)) ?? channel;
    this.notifyInfo(
      ((_c = i18n == null ? void 0 : i18n.format) == null ? void 0 : _c.call(i18n, "ASE.UI.Notification.ChannelSetTo", { channel: channelLabel })) ?? `Channel set to ${channelLabel}`
    );
  }
  onDeleteTrack(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = String($(event.currentTarget).data("item-id"));
    const item = this.library.getItem(itemId);
    if (!item) return;
    const isInPlaylist = !!this.filterState.selectedPlaylistId;
    const title = this.localize(
      isInPlaylist ? "ASE.UI.Dialog.ManageTrack.Title" : "ASE.UI.Dialog.DeleteTrack.Title",
      isInPlaylist ? "Manage Track" : "Delete Track"
    );
    const content = isInPlaylist ? this.format("ASE.UI.Dialog.ManageTrack.Content", { name: item.name }, `What would you like to do with "${item.name}"?`) : this.format("ASE.UI.Dialog.DeleteTrack.Content", { name: item.name }, `Are you sure you want to delete "${item.name}"?`);
    const dialogData = {
      title,
      content: `<p>${content}</p>`,
      buttons: {},
      default: "cancel"
    };
    if (isInPlaylist) {
      dialogData.buttons.removeFromPlaylist = {
        icon: '<i class="fas fa-minus-circle"></i>',
        label: this.localize("ASE.UI.Menu.RemoveFromPlaylist", "Remove from Playlist"),
        callback: /* @__PURE__ */ __name(() => {
          if (this.filterState.selectedPlaylistId) {
            this.removeTrackFromPlaylist(this.filterState.selectedPlaylistId, itemId);
          }
        }, "callback")
      };
    }
    dialogData.buttons.delete = {
      icon: '<i class="fas fa-trash"></i>',
      label: this.localize(
        isInPlaylist ? "ASE.UI.Dialog.DeleteTrackGlobal.Label" : "ASE.UI.Menu.Delete",
        isInPlaylist ? "Delete Track (Global)" : "Delete"
      ),
      callback: /* @__PURE__ */ __name(() => {
        this.library.removeItem(itemId);
        if (this.parentApp) this.parentApp.captureScroll();
        this.render();
        this.notifyInfo(this.format("ASE.UI.Notification.DeletedTrack", { name: item.name }, `Deleted "${item.name}"`));
      }, "callback")
    };
    dialogData.buttons.cancel = {
      icon: '<i class="fas fa-times"></i>',
      label: this.localize("ASE.UI.Actions.Cancel", "Cancel")
    };
    this.openStyledDialog(dialogData, isInPlaylist ? { width: 620 } : { width: 500 });
  }
  onTrackContext(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = String($(event.currentTarget).data("item-id"));
    const item = this.library.getItem(itemId);
    if (!item) return;
    $(".ase-context-menu").remove();
    const isInPlaylist = !!this.filterState.selectedPlaylistId;
    const i18n = game.i18n;
    const localize = /* @__PURE__ */ __name((key, fallback) => {
      var _a2;
      return ((_a2 = i18n == null ? void 0 : i18n.localize) == null ? void 0 : _a2.call(i18n, key)) ?? fallback;
    }, "localize");
    const renameLabel = localize("ASE.UI.Menu.Rename", "Rename");
    const addToPlaylistLabel = localize("ASE.UI.Menu.AddToPlaylist", "Add to Playlist");
    const removeFromPlaylistLabel = localize("ASE.UI.Menu.RemoveFromPlaylist", "Remove from Playlist");
    const editTagsLabel = localize("ASE.UI.Menu.EditTags", "Edit Tags");
    const deleteLabel = localize("ASE.UI.Menu.DeleteTrack", "Delete Track");
    let menuHtml = `
      <div class="ase-context-menu">
        <div class="ase-menu-item" data-action="rename">
          <i class="fa-solid fa-pen"></i> ${renameLabel}
        </div>
        <div class="ase-menu-item" data-action="add-to-playlist">
          <i class="fa-solid fa-list"></i> ${addToPlaylistLabel}
        </div>`;
    if (isInPlaylist) {
      menuHtml += `
        <div class="ase-menu-item" data-action="remove-from-playlist">
          <i class="fa-solid fa-minus-circle"></i> ${removeFromPlaylistLabel}
        </div>`;
    }
    menuHtml += `
        <div class="ase-menu-item" data-action="edit-tags">
          <i class="fa-solid fa-tags"></i> ${editTagsLabel}
        </div>
        <div class="ase-menu-separator"></div>
        <div class="ase-menu-item" data-action="delete">
          <i class="fa-solid fa-trash"></i> ${deleteLabel}
        </div>
      </div>
    `;
    const menu = $(menuHtml);
    menu.css({ top: event.clientY, left: event.clientX });
    $("body").append(menu);
    menu.find('[data-action="rename"]').on("click", async () => {
      menu.remove();
      await this.renameTrack(itemId);
    });
    menu.find('[data-action="add-to-playlist"]').on("click", async () => {
      menu.remove();
      await this.addTrackToPlaylistDialog(itemId);
    });
    if (isInPlaylist) {
      menu.find('[data-action="remove-from-playlist"]').on("click", async () => {
        menu.remove();
        if (this.filterState.selectedPlaylistId) {
          await this.removeTrackFromPlaylist(this.filterState.selectedPlaylistId, itemId);
        }
      });
    }
    menu.find('[data-action="edit-tags"]').on("click", () => {
      menu.remove();
      this.showTagEditor(itemId);
    });
    menu.find('[data-action="delete"]').on("click", () => {
      menu.remove();
      this.onDeleteTrack({ preventDefault: /* @__PURE__ */ __name(() => {
      }, "preventDefault"), stopPropagation: /* @__PURE__ */ __name(() => {
      }, "stopPropagation"), currentTarget: $(`<div data-item-id="${itemId}">`)[0] });
    });
    setTimeout(() => {
      $(document).one("click", () => menu.remove());
    }, 10);
  }
  onTrackTagContext(event) {
    event.preventDefault();
    event.stopPropagation();
    const tagName = String($(event.currentTarget).data("tag"));
    const itemId = String($(event.currentTarget).data("item-id"));
    const removeTagLabel = this.localize("ASE.UI.Menu.RemoveTag", "Remove Tag");
    $(".ase-context-menu").remove();
    const menu = $(`
      <div class="ase-context-menu">
        <div class="ase-menu-item" data-action="remove-tag">
          <i class="fa-solid fa-times"></i> ${removeTagLabel}
        </div>
      </div>
    `);
    menu.css({ top: event.clientY, left: event.clientX });
    $("body").append(menu);
    menu.find('[data-action="remove-tag"]').on("click", () => {
      menu.remove();
      this.library.removeTagFromItem(itemId, tagName);
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(this.format("ASE.UI.Notification.RemovedTag", { tag: tagName }, `Removed tag "${tagName}"`));
    });
    setTimeout(() => {
      $(document).one("click", () => menu.remove());
    }, 10);
  }
  async renameTrack(itemId) {
    const item = this.library.getItem(itemId);
    if (!item) return;
    const newName = await this.promptInput(
      this.localize("ASE.UI.Dialog.RenameTrack.Title", "Rename Track"),
      this.localize("ASE.UI.Dialog.TrackName.Label", "Track Name"),
      item.name
    );
    if (newName && newName !== item.name) {
      this.library.updateItem(itemId, { name: newName });
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(this.format("ASE.UI.Notification.RenamedTo", { name: newName }, `Renamed to "${newName}"`));
    }
  }
  async addTrackToPlaylistDialog(itemId) {
    const playlists = this.library.playlists.getAllPlaylists();
    if (playlists.length === 0) {
      this.notifyWarn(this.localize("ASE.UI.Warning.NoPlaylistsCreateFirst", "No playlists available. Create one first."));
      return;
    }
    const selectedPlaylistId = await this.promptPlaylistSelection(playlists);
    if (!selectedPlaylistId) return;
    const item = this.library.getItem(itemId);
    if (!item) return;
    const group = this.inferGroupFromTags(item.tags);
    this.library.playlists.addTrackToPlaylist(selectedPlaylistId, itemId, group);
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
    this.notifyInfo(this.format("ASE.UI.Notification.AddedToPlaylist", { name: item.name }, `Added "${item.name}" to playlist`));
  }
  showTagEditor(itemId) {
    const item = this.library.getItem(itemId);
    if (!item) return;
    const allTags = this.library.getAllTags();
    const currentTags = new Set(item.tags);
    const searchLabel = this.localize("ASE.UI.Dialog.TagSearch.Label", "Search Tags");
    const searchPlaceholder = this.localize("ASE.UI.Dialog.TagSearch.Placeholder", "Find tag...");
    const content = `
      <form class="ase-dialog-form">
        <div class="form-group ase-dialog-tag-search-group">
          <label>${searchLabel}</label>
          <div class="ase-dialog-search-input-wrapper">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" name="tag-search" class="ase-dialog-tag-search" placeholder="${searchPlaceholder}">
          </div>
        </div>
        <div class="ase-dialog-scroll-list">
          ${allTags.map((tag) => `
            <div class="form-group">
              <label class="ase-checkbox-row">
                <input type="checkbox" name="tag" value="${tag}" ${currentTags.has(tag) ? "checked" : ""}>
                <span>#${tag}</span>
              </label>
            </div>
          `).join("")}
        </div>
        <div class="form-group">
          <label>${this.localize("ASE.UI.Dialog.NewTag.Title", "New Tag")}</label>
          <input type="text" name="newTag" placeholder="${this.localize("ASE.UI.Dialog.TagName.Placeholder", "Enter tag name...")}">
        </div>
      </form>
    `;
    const dialog = this.openStyledDialog({
      title: this.format("ASE.UI.Dialog.EditTags.Title", { name: item.name }, `Edit Tags: ${item.name}`),
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: this.localize("ASE.UI.Actions.Save", "Save"),
          callback: /* @__PURE__ */ __name((html) => {
            var _a2;
            const selectedTags = [];
            html.find('input[name="tag"]:checked').each((_, el) => {
              selectedTags.push($(el).val());
            });
            const newTag = (_a2 = html.find('input[name="newTag"]').val()) == null ? void 0 : _a2.trim();
            if (newTag) {
              selectedTags.push(newTag);
              this.library.addCustomTag(newTag);
            }
            this.library.updateItem(itemId, { tags: selectedTags });
            if (this.parentApp) this.parentApp.captureScroll();
            this.render();
          }, "callback")
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: this.localize("ASE.UI.Actions.Cancel", "Cancel")
        }
      },
      default: "save"
    }, { width: 320 });
    setTimeout(() => {
      var _a2;
      const appEl = (_a2 = dialog.element) == null ? void 0 : _a2.closest(".app.dialog");
      if (!(appEl == null ? void 0 : appEl.length)) return;
      const $search = appEl.find('input[name="tag-search"]');
      const $rows = appEl.find(".ase-dialog-scroll-list .form-group");
      $search.on("input", (event) => {
        const query = String($(event.currentTarget).val() ?? "").trim().toLowerCase();
        $rows.each((_, row) => {
          const $row = $(row);
          const value = String($row.find('input[name="tag"]').val() ?? "").toLowerCase();
          $row.toggle(!query || value.includes(query));
        });
      });
    }, 0);
  }
  async promptInput(title, label, defaultValue = "") {
    return new Promise((resolve) => {
      this.openStyledDialog({
        title,
        content: `
          <form class="ase-dialog-form">
            <div class="form-group">
              <label>${label}</label>
              <input type="text" name="input" value="${defaultValue}" autofocus>
            </div>
          </form>
        `,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: this.localize("ASE.UI.Actions.Ok", "OK"),
            callback: /* @__PURE__ */ __name((html) => {
              const value = html.find('input[name="input"]').val();
              resolve((value == null ? void 0 : value.trim()) || null);
            }, "callback")
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize("ASE.UI.Actions.Cancel", "Cancel"),
            callback: /* @__PURE__ */ __name(() => resolve(null), "callback")
          }
        },
        default: "ok",
        close: /* @__PURE__ */ __name(() => resolve(null), "close")
      });
    });
  }
  // ─────────────────────────────────────────────────────────────
  // Playlist Event Handlers (Extended)
  // ─────────────────────────────────────────────────────────────
  onSelectPlaylist(event) {
    event.preventDefault();
    const playlistId = $(event.currentTarget).data("playlist-id");
    if (this.filterState.selectedPlaylistId === playlistId) {
      this.filterState.selectedPlaylistId = null;
    } else {
      this.filterState.selectedPlaylistId = playlistId;
    }
    this.render(false, { resetScroll: true });
    Logger.debug("Select playlist:", playlistId);
  }
  onPlaylistMenu(event) {
    var _a2;
    event.preventDefault();
    event.stopPropagation();
    $(event.currentTarget).data("playlist-id");
    const playlistElement = $(event.currentTarget).closest(".ase-list-item");
    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: event.clientX,
      clientY: event.clientY
    });
    (_a2 = playlistElement[0]) == null ? void 0 : _a2.dispatchEvent(contextMenuEvent);
  }
  onTogglePlaylistQueue(event) {
    var _a2;
    event.preventDefault();
    event.stopPropagation();
    const playlistId = $(event.currentTarget).closest("[data-playlist-id]").data("playlist-id");
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist || !((_a2 = window.ASE) == null ? void 0 : _a2.queue)) {
      Logger.warn("Cannot toggle playlist queue: playlist or queue not available");
      return;
    }
    const inQueue = window.ASE.queue.getItems().some((item) => item.playlistId === playlistId);
    if (inQueue) {
      const itemsToRemove = window.ASE.queue.getItems().filter((item) => item.playlistId === playlistId);
      itemsToRemove.forEach((item) => window.ASE.queue.removeItem(item.id));
      this.notifyInfo(`Removed "${playlist.name}" from queue`);
    } else {
      const playlistItems = playlist.items.map((pItem) => {
        this.library.getItem(pItem.libraryItemId);
        return {
          libraryItemId: pItem.libraryItemId,
          group: pItem.group || "music",
          volume: pItem.volume
        };
      }).filter((item) => item.libraryItemId);
      window.ASE.queue.addPlaylist(playlistId, playlistItems);
      this.notifyInfo(`Added "${playlist.name}" (${playlist.items.length} tracks) to queue`);
    }
  }
  onPlaylistContext(event) {
    var _a2, _b;
    event.preventDefault();
    event.stopPropagation();
    const playlistId = String($(event.currentTarget).data("playlist-id"));
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) return;
    const i18n = game.i18n;
    const renameLabel = ((_a2 = i18n == null ? void 0 : i18n.localize) == null ? void 0 : _a2.call(i18n, "ASE.UI.Menu.Rename")) ?? "Rename";
    const deleteLabel = ((_b = i18n == null ? void 0 : i18n.localize) == null ? void 0 : _b.call(i18n, "ASE.UI.Menu.Delete")) ?? "Delete";
    const menuHtml = `
      <div id="ase-custom-context-menu" style="position: fixed; z-index: 10000; background: #222; border: 1px solid #444; border-radius: 4px; padding: 5px 0;">
        <div class="ase-ctx-item" data-action="edit" style="padding: 5px 15px; cursor: pointer; color: white;">
            <i class="fas fa-edit" style="margin-right: 5px;"></i> ${renameLabel}
        </div>
        <div class="ase-ctx-item" data-action="delete" style="padding: 5px 15px; cursor: pointer; color: #ff6666;">
            <i class="fas fa-trash" style="margin-right: 5px;"></i> ${deleteLabel}
        </div>
      </div>
    `;
    $("#ase-custom-context-menu").remove();
    const menu = $(menuHtml);
    $("body").append(menu);
    menu.css({
      top: event.clientY,
      left: event.clientX
    });
    menu.find(".ase-ctx-item").on("mouseenter", function() {
      $(this).css("background-color", "#333");
    }).on("mouseleave", function() {
      $(this).css("background-color", "transparent");
    });
    menu.find('[data-action="edit"]').on("click", () => {
      menu.remove();
      this.renamePlaylist(playlistId);
    });
    menu.find('[data-action="delete"]').on("click", () => {
      menu.remove();
      this.deletePlaylist(playlistId);
    });
    setTimeout(() => {
      $(document).one("click", () => menu.remove());
    }, 50);
  }
  async renamePlaylist(playlistId) {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) return;
    const newName = await this.promptPlaylistName(playlist.name);
    if (!newName || newName === playlist.name) return;
    this.library.playlists.updatePlaylist(playlistId, { name: newName });
    if (this.parentApp) this.parentApp.captureScroll();
    this.render();
    this.notifyInfo(`Renamed playlist to "${newName}"`);
  }
  async deletePlaylist(playlistId) {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) return;
    const confirm = await this.confirmStyledDialog(
      this.localize("ASE.UI.Dialog.DeletePlaylist.Title", "Delete Playlist"),
      `<p>${this.format("ASE.UI.Dialog.DeletePlaylist.Content", { name: playlist.name }, `Are you sure you want to delete playlist "${playlist.name}"?`)}</p>`
    );
    if (!confirm) return;
    this.library.playlists.deletePlaylist(playlistId);
    if (this.filterState.selectedPlaylistId === playlistId) {
      this.filterState.selectedPlaylistId = null;
    }
    this.render();
    this.notifyInfo(this.format("ASE.UI.Notification.DeletedPlaylist", { name: playlist.name }, `Deleted playlist "${playlist.name}"`));
  }
  async promptPlaylistName(current = "") {
    return new Promise((resolve) => {
      const isRename = Boolean(current);
      this.openStyledDialog({
        title: this.localize(
          isRename ? "ASE.UI.Dialog.RenamePlaylist.Title" : "ASE.UI.Dialog.NewPlaylist.Title",
          isRename ? "Rename Playlist" : "New Playlist"
        ),
        content: `
          <form class="ase-dialog-form">
            <div class="form-group">
              <label>${this.localize("ASE.UI.Dialog.PlaylistName.Label", "Playlist Name")}</label>
              <input type="text" name="playlistName" value="${current}" autofocus>
            </div>
          </form>
        `,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: this.localize("ASE.UI.Actions.Ok", "OK"),
            callback: /* @__PURE__ */ __name((html) => {
              const name = html.find('[name="playlistName"]').val();
              resolve((name == null ? void 0 : name.trim()) || null);
            }, "callback")
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize("ASE.UI.Actions.Cancel", "Cancel"),
            callback: /* @__PURE__ */ __name(() => resolve(null), "callback")
          }
        },
        default: "ok",
        close: /* @__PURE__ */ __name(() => resolve(null), "close")
      });
    });
  }
  // ─────────────────────────────────────────────────────────────
  // Drag and Drop
  // ─────────────────────────────────────────────────────────────
  setupDragAndDrop(html) {
    html.find('.ase-track-player-item[draggable="true"]').on("dragstart", (event) => {
      $(event.currentTarget).find("[data-item-id]").data("item-id") || $(event.currentTarget).data("item-id");
      const id = $(event.currentTarget).find("[data-item-id]").first().data("item-id");
      event.originalEvent.dataTransfer.effectAllowed = "copy";
      event.originalEvent.dataTransfer.setData("text/plain", id);
      event.originalEvent.dataTransfer.setData("application/x-ase-internal", "true");
      $(event.currentTarget).addClass("dragging");
    });
    html.find('.ase-track-player-item[draggable="true"]').on("dragend", (event) => {
      $(event.currentTarget).removeClass("dragging");
    });
    html.find(".ase-list-item[data-playlist-id]").on("dragover", (event) => {
      event.preventDefault();
      event.originalEvent.dataTransfer.dropEffect = "copy";
      const isInternalDrag = event.originalEvent.dataTransfer.types.includes("application/x-ase-internal");
      if (isInternalDrag) {
        $(event.currentTarget).addClass("drag-over");
      }
    });
    html.find(".ase-list-item[data-playlist-id]").on("dragleave", (event) => {
      $(event.currentTarget).removeClass("drag-over");
    });
    html.find(".ase-list-item[data-playlist-id]").on("drop", async (event) => {
      event.preventDefault();
      const itemId = event.originalEvent.dataTransfer.getData("text/plain");
      const playlistId = $(event.currentTarget).data("playlist-id");
      $(event.currentTarget).removeClass("drag-over");
      const draggedPlaylistId = event.originalEvent.dataTransfer.getData("application/x-playlist-id");
      if (draggedPlaylistId && draggedPlaylistId !== playlistId) {
        await this.handlePlaylistReorder(draggedPlaylistId, playlistId);
        return;
      }
      await this.handleDropTrackToPlaylist(itemId, playlistId);
    });
    html.find('.ase-list-item[data-playlist-id][draggable="true"]').on("dragstart", (event) => {
      const playlistId = String($(event.currentTarget).data("playlist-id"));
      event.originalEvent.dataTransfer.effectAllowed = "move";
      event.originalEvent.dataTransfer.setData("application/x-playlist-id", playlistId);
      $(event.currentTarget).addClass("dragging");
    });
    html.find('.ase-list-item[data-playlist-id][draggable="true"]').on("dragend", (event) => {
      $(event.currentTarget).removeClass("dragging");
      html.find(".ase-list-item").removeClass("drag-over drag-above drag-below");
    });
    html.find('.ase-favorite-item[draggable="true"]').on("dragstart", (event) => {
      const favoriteId = String($(event.currentTarget).data("favorite-id"));
      const favoriteType = String($(event.currentTarget).data("favorite-type"));
      event.originalEvent.dataTransfer.effectAllowed = "move";
      event.originalEvent.dataTransfer.setData("application/x-favorite-id", favoriteId);
      event.originalEvent.dataTransfer.setData("application/x-favorite-type", favoriteType);
      $(event.currentTarget).addClass("dragging");
    });
    html.find('.ase-favorite-item[draggable="true"]').on("dragend", (event) => {
      $(event.currentTarget).removeClass("dragging");
      html.find(".ase-favorite-item").removeClass("drag-over drag-above drag-below");
    });
    html.find(".ase-list-item[data-playlist-id]").on("dragover", (event) => {
      const draggedPlaylistId = event.originalEvent.dataTransfer.types.includes("application/x-playlist-id");
      if (!draggedPlaylistId) return;
      event.preventDefault();
      event.originalEvent.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const isAbove = event.clientY < midY;
      html.find(".ase-list-item[data-playlist-id]").removeClass("drag-above drag-below drag-over");
      $(event.currentTarget).addClass(isAbove ? "drag-above" : "drag-below");
    });
    html.find(".ase-favorite-item").on("dragover", (event) => {
      const hasFavoriteId = event.originalEvent.dataTransfer.types.includes("application/x-favorite-id");
      if (!hasFavoriteId) return;
      event.preventDefault();
      event.originalEvent.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const isAbove = event.clientY < midY;
      html.find(".ase-favorite-item").removeClass("drag-above drag-below drag-over");
      $(event.currentTarget).addClass(isAbove ? "drag-above" : "drag-below");
    });
    html.find(".ase-favorite-item").on("drop", async (event) => {
      event.preventDefault();
      const favoriteId = String($(event.currentTarget).data("favorite-id"));
      const favoriteType = String($(event.currentTarget).data("favorite-type"));
      $(event.currentTarget).removeClass("drag-above drag-below dragging");
      const draggedId = event.originalEvent.dataTransfer.getData("application/x-favorite-id");
      const draggedType = event.originalEvent.dataTransfer.getData("application/x-favorite-type");
      if (draggedId && draggedType && (draggedId !== favoriteId || draggedType !== favoriteType)) {
        await this.handleFavoriteReorder(draggedId, draggedType, favoriteId, favoriteType);
      }
    });
    html.find(".ase-content-area").on("dragover", (event) => {
      event.preventDefault();
      $(event.currentTarget).addClass("drag-over-import");
    });
    html.find(".ase-content-area").on("dragleave", (event) => {
      $(event.currentTarget).removeClass("drag-over-import");
    });
    html.find(".ase-content-area").on("drop", async (event) => {
      var _a2, _b, _c, _d;
      event.preventDefault();
      $(event.currentTarget).removeClass("drag-over-import");
      const files = (_b = (_a2 = event.originalEvent) == null ? void 0 : _a2.dataTransfer) == null ? void 0 : _b.files;
      if (files && files.length > 0) {
        Logger.debug(`Dropped ${files.length} files from OS`);
        const internalId = (_d = (_c = event.originalEvent) == null ? void 0 : _c.dataTransfer) == null ? void 0 : _d.getData("text/plain");
        if (internalId && !files.length) {
          return;
        }
        await this.handleFileUpload(files);
      }
    });
  }
  async handlePlaylistReorder(draggedId, targetId) {
    const playlists = this.library.playlists.getAllPlaylists();
    const draggedIndex = playlists.findIndex((p) => p.id === draggedId);
    const targetIndex = playlists.findIndex((p) => p.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;
    const [dragged] = playlists.splice(draggedIndex, 1);
    playlists.splice(targetIndex, 0, dragged);
    this.library.playlists.reorderPlaylists(playlists.map((p) => p.id));
    this.render();
    Logger.debug(`Reordered playlist ${draggedId} to position ${targetIndex}`);
  }
  async handleFavoriteReorder(draggedId, draggedType, targetId, targetType) {
    const favorites = this.library.getOrderedFavorites();
    const draggedIndex = favorites.findIndex((f) => f.id === draggedId && f.type === draggedType);
    const targetIndex = favorites.findIndex((f) => f.id === targetId && f.type === targetType);
    if (draggedIndex === -1 || targetIndex === -1) return;
    const [draggedItem] = favorites.splice(draggedIndex, 1);
    favorites.splice(targetIndex, 0, draggedItem);
    this.library.reorderFavorites(favorites);
    this.render();
    Logger.debug(`Reordered favorite ${draggedId} to position ${targetIndex}`);
  }
  async handleFileUpload(files) {
    var _a2;
    if (!((_a2 = game.user) == null ? void 0 : _a2.isGM)) {
      this.notifyWarn("Only GM can upload files.", true);
      return;
    }
    const audioFiles = Array.from(files).filter((file) => {
      var _a3;
      const ext = (_a3 = file.name.split(".").pop()) == null ? void 0 : _a3.toLowerCase();
      return ["mp3", "ogg", "wav", "flac", "webm", "m4a", "aac"].includes(ext || "");
    });
    if (audioFiles.length === 0) {
      this.notifyWarn("No valid audio files found. Supported formats: mp3, ogg, wav, flac, webm, m4a, aac", true);
      return;
    }
    const targetSource = "data";
    const targetDir = "sem_audio";
    try {
      await FilePicker.createDirectory(targetSource, targetDir, {});
    } catch (err) {
      Logger.debug("Directory creation skipped (might already exist):", err);
    }
    let importedCount = 0;
    let failedCount = 0;
    for (const file of audioFiles) {
      try {
        const response = await FilePicker.upload(targetSource, targetDir, file, {});
        if (response.path) {
          const channel = this.detectChannelFromFilename(file.name);
          const selectedTags = Array.from(this.filterState.selectedTags);
          const track = await this.library.addItem(
            response.path,
            file.name.split(".")[0],
            // Remove extension
            channel,
            selectedTags
          );
          if (this.filterState.selectedPlaylistId) {
            try {
              this.library.playlists.addTrackToPlaylist(
                this.filterState.selectedPlaylistId,
                track.id,
                channel
              );
            } catch (err) {
            }
          }
          importedCount++;
        }
      } catch (err) {
        Logger.error(`Failed to upload ${file.name}:`, err);
        failedCount++;
      }
    }
    if (importedCount > 0) {
      const playlistMsg = this.filterState.selectedPlaylistId ? ` and added to active playlist` : "";
      this.notifyInfo(`Imported ${importedCount} file(s)${playlistMsg}`, true);
      this.render();
    }
    if (failedCount > 0) {
      this.notifyWarn(`Failed to import ${failedCount} file(s)`, true);
    }
  }
  /**
   * Smart channel detection based on filename keywords
   */
  detectChannelFromFilename(filename) {
    const lowerName = filename.toLowerCase();
    const musicKeywords = ["music", "song", "theme", "bgm", "soundtrack", "score", "melody", "музык"];
    if (musicKeywords.some((keyword) => lowerName.includes(keyword))) {
      return "music";
    }
    const ambienceKeywords = ["ambient", "ambience", "atmosphere", "environment", "background", "nature", "wind", "rain", "forest", "cave", "амбиент", "окружен"];
    if (ambienceKeywords.some((keyword) => lowerName.includes(keyword))) {
      return "ambience";
    }
    const sfxKeywords = ["sfx", "sound", "effect", "fx", "hit", "impact", "explosion", "spell", "attack", "footstep", "door", "sword", "интерфейс", "эффект"];
    if (sfxKeywords.some((keyword) => lowerName.includes(keyword))) {
      return "sfx";
    }
    return "music";
  }
  async handleDropTrackToPlaylist(itemId, playlistId) {
    const item = this.library.getItem(itemId);
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!item || !playlist) {
      this.notifyError("Track or playlist not found");
      return;
    }
    try {
      const group = this.inferGroupFromTags(item.tags);
      this.library.playlists.addTrackToPlaylist(playlistId, itemId, group);
      this.render();
      this.notifyInfo(`Added "${item.name}" to "${playlist.name}"`);
    } catch (error) {
      Logger.error("Failed to add track to playlist:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.notifyError(`Failed to add to playlist: ${errorMessage}`);
    }
  }
  /**
   * Setup drag-and-drop handler for Foundry native playlists
   * Allows dragging PlaylistSound items into ASE library
   */
  setupFoundryDragDrop(html) {
    const dropZone = html.find(".ase-track-player-list");
    if (!dropZone.length) return;
    dropZone.on("dragover", (event) => {
      event.preventDefault();
      event.originalEvent.dataTransfer.dropEffect = "copy";
      const isInternalDrag = event.originalEvent.dataTransfer.types.includes("application/x-ase-internal");
      if (!isInternalDrag) {
        dropZone.addClass("drag-over");
      }
    });
    dropZone.on("dragleave", (event) => {
      if (event.currentTarget === event.target) {
        dropZone.removeClass("drag-over");
      }
    });
    dropZone.on("drop", async (event) => {
      event.preventDefault();
      dropZone.removeClass("drag-over");
      await this.handleFoundryPlaylistDrop(event.originalEvent);
    });
  }
  /**
   * Handle drop event from Foundry playlist
   * Routes to appropriate handler based on type (single track vs full playlist)
   */
  async handleFoundryPlaylistDrop(event) {
    try {
      const dragData = TextEditor.getDragEventData(event);
      if (!dragData) {
        Logger.debug("No drag data found, ignoring");
        return;
      }
      Logger.debug("Foundry drop detected:", dragData.type);
      if (dragData.type === "PlaylistSound") {
        await this.handlePlaylistSoundImport(dragData);
      } else if (dragData.type === "Playlist") {
        await this.handlePlaylistImport(dragData);
      } else {
        Logger.debug(`Unsupported drop type: ${dragData.type}`);
      }
    } catch (error) {
      Logger.error("Failed to handle Foundry playlist drop:", error);
      this.notifyError("Failed to import track from playlist", true);
    }
  }
  /**
   * Import single PlaylistSound track
   */
  async handlePlaylistSoundImport(dragData) {
    var _a2;
    const sound = await fromUuid(dragData.uuid);
    if (!sound) {
      this.notifyError("Failed to resolve playlist sound", true);
      return;
    }
    const audioPath = sound.path || ((_a2 = sound.sound) == null ? void 0 : _a2.path);
    const soundName = sound.name;
    if (!audioPath) {
      this.notifyError("Playlist sound has no audio file path", true);
      return;
    }
    const existing = this.library.findByUrl(audioPath);
    if (existing) {
      this.notifyWarn(`Track "${soundName}" already exists in library`, true);
      return;
    }
    const channel = this.mapFoundryChannelToASE(sound.channel);
    const selectedTags = Array.from(this.filterState.selectedTags);
    const newTrack = await this.library.addItem(audioPath, soundName, channel, selectedTags);
    if (this.filterState.selectedPlaylistId) {
      try {
        this.library.playlists.addTrackToPlaylist(
          this.filterState.selectedPlaylistId,
          newTrack.id,
          channel
        );
        const playlist = this.library.playlists.getPlaylist(this.filterState.selectedPlaylistId);
        this.notifyInfo(`Added "${soundName}" to library and playlist "${playlist == null ? void 0 : playlist.name}"`, true);
      } catch (err) {
        this.notifyInfo(`Added "${soundName}" to library`, true);
      }
    } else {
      this.notifyInfo(`Added "${soundName}" to library`, true);
    }
    this.render();
  }
  /**
   * Import entire Playlist with all tracks
   */
  async handlePlaylistImport(dragData) {
    var _a2, _b;
    try {
      const playlist = await fromUuid(dragData.uuid);
      if (!playlist) {
        this.notifyError("Failed to resolve Foundry playlist", true);
        return;
      }
      Logger.info(`Importing Foundry playlist: ${playlist.name} (${playlist.sounds.size} tracks)`);
      const playlistName = this.generateUniquePlaylistName(playlist.name);
      const asePlaylist = this.library.playlists.createPlaylist(playlistName);
      let addedCount = 0;
      let skippedCount = 0;
      for (const sound of playlist.sounds) {
        const audioPath = sound.path || ((_a2 = sound.sound) == null ? void 0 : _a2.path);
        if (!audioPath) {
          Logger.warn(`Skipping sound "${sound.name}" - no path`);
          continue;
        }
        const foundryChannel = sound.channel || playlist.channel;
        let channel = "music";
        if (foundryChannel === "environment") {
          channel = "ambience";
        } else if (foundryChannel === "interface") {
          channel = "sfx";
        } else if (foundryChannel === "music" || !foundryChannel) {
          channel = "music";
        }
        let trackId = (_b = this.library.findByUrl(audioPath)) == null ? void 0 : _b.id;
        if (!trackId) {
          try {
            const selectedTags = Array.from(this.filterState.selectedTags);
            const track = await this.library.addItem(audioPath, sound.name, channel, selectedTags);
            trackId = track.id;
            addedCount++;
          } catch (err) {
            Logger.error(`Failed to add track "${sound.name}":`, err);
            continue;
          }
        } else {
          skippedCount++;
        }
        this.library.playlists.addTrackToPlaylist(asePlaylist.id, trackId, channel);
      }
      const message = `Imported playlist "${playlistName}": ${addedCount} new tracks${skippedCount > 0 ? `, ${skippedCount} already in library` : ""}`;
      this.notifyInfo(message, true);
      this.render();
    } catch (error) {
      Logger.error("Failed to import Foundry playlist:", error);
      this.notifyError("Failed to import playlist", true);
    }
  }
  resolveFoundryChannel(sound, playlist) {
    var _a2;
    const effectiveChannel = sound.channel || ((_a2 = sound.fadeIn) == null ? void 0 : _a2.type) || playlist.channel || playlist.mode;
    return this.mapFoundryChannelToASE(effectiveChannel);
  }
  mapFoundryChannelToASE(foundryChannel) {
    if (!foundryChannel && foundryChannel !== 0) return "music";
    const channelStr = String(foundryChannel).toLowerCase();
    const channelMap = {
      "0": "music",
      "1": "ambience",
      "2": "sfx",
      "music": "music",
      "environment": "ambience",
      "interface": "sfx"
    };
    const mapped = channelMap[channelStr] || "music";
    return mapped;
  }
  generateUniquePlaylistName(baseName) {
    const existingPlaylists = this.library.playlists.getAllPlaylists();
    const existingNames = new Set(existingPlaylists.map((p) => p.name));
    if (!existingNames.has(baseName)) return baseName;
    let counter = 2;
    while (existingNames.has(`${baseName} (${counter})`)) {
      counter++;
    }
    return `${baseName} (${counter})`;
  }
  async removeTrackFromPlaylist(playlistId, trackId) {
    try {
      this.library.playlists.removeLibraryItemFromPlaylist(playlistId, trackId);
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo("Removed track from playlist");
    } catch (error) {
      Logger.error("Failed to remove track from playlist:", error);
      this.notifyError("Failed to remove track from playlist");
    }
  }
  /**
   * Highlight playlists in sidebar that contain the specified track
   */
  highlightPlaylistsContainingTrack(trackId) {
    const playlists = this.library.playlists.getAllPlaylists();
    const containingPlaylists = playlists.filter(
      (playlist) => playlist.items.some((item) => item.libraryItemId === trackId)
    );
    containingPlaylists.forEach((playlist) => {
      $(`[data-playlist-id="${playlist.id}"]`).addClass("highlight-contains-track");
    });
  }
  /**
   * Clear all playlist highlights
   */
  clearPlaylistHighlights() {
    $(".highlight-contains-track").removeClass("highlight-contains-track");
  }
  // ─────────────────────────────────────────────────────────────
  // Context Menus
  // ─────────────────────────────────────────────────────────────
  setupContextMenus(html) {
    new ContextMenu(html, ".track-item", [
      {
        name: "Edit Name",
        icon: '<i class="fas fa-edit"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const itemId = li.data("item-id");
          this.onEditTrackName(itemId);
        }, "callback")
      },
      {
        name: "Edit Tags",
        icon: '<i class="fas fa-tags"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const itemId = li.data("item-id");
          this.onEditTrackTags(itemId);
        }, "callback")
      },
      {
        name: "Add to Playlist",
        icon: '<i class="fas fa-list-ul"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const itemId = li.data("item-id");
          this.handleAddToPlaylistFromContext(itemId);
        }, "callback")
      },
      {
        name: "Toggle Favorite",
        icon: '<i class="fas fa-star"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const itemId = li.data("item-id");
          try {
            const isFavorite = this.library.toggleFavorite(itemId);
            if (this.parentApp) this.parentApp.captureScroll();
            this.render();
            this.notifyInfo(isFavorite ? "Added to favorites" : "Removed from favorites");
          } catch (error) {
            Logger.error("Failed to toggle favorite:", error);
            this.notifyError("Failed to update favorite status");
          }
        }, "callback")
      },
      {
        name: "Delete Track",
        icon: '<i class="fas fa-trash"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const itemId = li.data("item-id");
          this.onDeleteTrackConfirm(itemId);
        }, "callback")
      }
    ]);
    new ContextMenu(html, ".playlist-item", [
      {
        name: "Rename Playlist",
        icon: '<i class="fas fa-edit"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const playlistId = li.data("playlist-id");
          this.onRenamePlaylist(playlistId);
        }, "callback")
      },
      {
        name: "Edit Description",
        icon: '<i class="fas fa-align-left"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const playlistId = li.data("playlist-id");
          this.onEditPlaylistDescription(playlistId);
        }, "callback")
      },
      {
        name: "View Contents",
        icon: '<i class="fas fa-list"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const playlistId = li.data("playlist-id");
          this.onViewPlaylistContents(playlistId);
        }, "callback")
      },
      {
        name: "Clear Playlist",
        icon: '<i class="fas fa-eraser"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const playlistId = li.data("playlist-id");
          this.onClearPlaylist(playlistId);
        }, "callback")
      },
      {
        name: "Delete Playlist",
        icon: '<i class="fas fa-trash"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const playlistId = li.data("playlist-id");
          this.onDeletePlaylistConfirm(playlistId);
        }, "callback")
      }
    ]);
    new ContextMenu(html, ".tag-chip:not(.mini)", [
      {
        name: "Rename Tag",
        icon: '<i class="fas fa-edit"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const tagName = li.data("tag");
          this.onRenameTag(tagName);
        }, "callback")
      },
      {
        name: "Delete Tag",
        icon: '<i class="fas fa-trash"></i>',
        callback: /* @__PURE__ */ __name((target) => {
          const li = $(target);
          const tagName = li.data("tag");
          this.onDeleteTag(tagName);
        }, "callback")
      }
    ]);
  }
  // ─────────────────────────────────────────────────────────────
  // Context Menu Handlers - Tracks
  // ─────────────────────────────────────────────────────────────
  async onEditTrackName(itemId) {
    const item = this.library.getItem(itemId);
    if (!item) {
      this.notifyError("Track not found");
      return;
    }
    const newName = await this.promptTextInput("Edit Track Name", "Track Name", item.name);
    if (!newName || newName === item.name) return;
    try {
      this.library.updateItem(itemId, { name: newName });
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo(`Renamed to: ${newName}`);
    } catch (error) {
      Logger.error("Failed to rename track:", error);
      this.notifyError("Failed to rename track");
    }
  }
  async onEditTrackTags(itemId) {
    const item = this.library.getItem(itemId);
    if (!item) {
      this.notifyError("Track not found");
      return;
    }
    const tagsString = await this.promptTextInput(
      "Edit Tags",
      "Tags (comma-separated)",
      item.tags.join(", ")
    );
    if (tagsString === null) return;
    const newTags = tagsString.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    try {
      this.library.updateItem(itemId, { tags: newTags });
      if (this.parentApp) this.parentApp.captureScroll();
      this.render();
      this.notifyInfo("Tags updated");
    } catch (error) {
      Logger.error("Failed to update tags:", error);
      this.notifyError("Failed to update tags");
    }
  }
  async onDeleteTrackConfirm(itemId) {
    const item = this.library.getItem(itemId);
    if (!item) {
      this.notifyError("Track not found");
      return;
    }
    const confirmed = await Dialog.confirm({
      title: "Delete Track",
      content: `<p>Are you sure you want to delete <strong>${item.name}</strong> from the library?</p>
                <p class="notification warning">This will remove it from all playlists and favorites.</p>`,
      yes: /* @__PURE__ */ __name(() => true, "yes"),
      no: /* @__PURE__ */ __name(() => false, "no"),
      defaultYes: false
    });
    if (confirmed) {
      try {
        this.library.removeItem(itemId);
        if (this.parentApp) this.parentApp.captureScroll();
        this.render();
        this.notifyInfo(`Deleted: ${item.name}`);
      } catch (error) {
        Logger.error("Failed to delete track:", error);
        this.notifyError("Failed to delete track");
      }
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Context Menu Handlers - Playlists
  // ─────────────────────────────────────────────────────────────
  async onRenamePlaylist(playlistId) {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      this.notifyError("Playlist not found");
      return;
    }
    const newName = await this.promptTextInput("Rename Playlist", "Playlist Name", playlist.name);
    if (!newName || newName === playlist.name) return;
    try {
      this.library.playlists.updatePlaylist(playlistId, { name: newName });
      this.render();
      this.notifyInfo(`Renamed to: ${newName}`);
    } catch (error) {
      Logger.error("Failed to rename playlist:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.notifyError(`Failed to rename playlist: ${errorMessage}`);
    }
  }
  async onEditPlaylistDescription(playlistId) {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      this.notifyError("Playlist not found");
      return;
    }
    const description = await this.promptTextInput(
      "Edit Description",
      "Description",
      playlist.description || ""
    );
    if (description === null) return;
    try {
      this.library.playlists.updatePlaylist(playlistId, { description: description || void 0 });
      this.render();
      this.notifyInfo("Description updated");
    } catch (error) {
      Logger.error("Failed to update description:", error);
      this.notifyError("Failed to update description");
    }
  }
  async onViewPlaylistContents(playlistId) {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      this.notifyError("Playlist not found");
      return;
    }
    const items = playlist.items.sort((a, b) => a.order - b.order).map((playlistItem, index) => {
      const libraryItem = this.library.getItem(playlistItem.libraryItemId);
      const name = (libraryItem == null ? void 0 : libraryItem.name) || "Unknown";
      return `<li><strong>${index + 1}.</strong> ${name}</li>`;
    }).join("");
    const content = `
      <div>
        <p><strong>${playlist.name}</strong></p>
        ${playlist.description ? `<p><em>${playlist.description}</em></p>` : ""}
        <p>Total tracks: ${playlist.items.length}</p>
        ${playlist.items.length > 0 ? `<ul class="playlist-contents-list">${items}</ul>` : "<p>No tracks in playlist</p>"}
      </div>
    `;
    new Dialog({
      title: "Playlist Contents",
      content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: "Close"
        }
      },
      default: "close"
    }).render(true);
  }
  async onClearPlaylist(playlistId) {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      this.notifyError("Playlist not found");
      return;
    }
    if (playlist.items.length === 0) {
      this.notifyWarn("Playlist is already empty");
      return;
    }
    const confirmed = await Dialog.confirm({
      title: "Clear Playlist",
      content: `<p>Are you sure you want to remove all ${playlist.items.length} tracks from <strong>${playlist.name}</strong>?</p>
                <p class="notification warning">This cannot be undone.</p>`,
      yes: /* @__PURE__ */ __name(() => true, "yes"),
      no: /* @__PURE__ */ __name(() => false, "no"),
      defaultYes: false
    });
    if (confirmed) {
      try {
        const itemIds = [...playlist.items.map((i) => i.id)];
        itemIds.forEach((itemId) => {
          try {
            this.library.playlists.removeTrackFromPlaylist(playlistId, itemId);
          } catch (error) {
            Logger.error("Failed to remove item:", error);
          }
        });
        this.render();
        this.notifyInfo(`Cleared playlist: ${playlist.name}`);
      } catch (error) {
        Logger.error("Failed to clear playlist:", error);
        this.notifyError("Failed to clear playlist");
      }
    }
  }
  async onDeletePlaylistConfirm(playlistId) {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      this.notifyError("Playlist not found");
      return;
    }
    const confirmed = await Dialog.confirm({
      title: "Delete Playlist",
      content: `<p>Are you sure you want to delete <strong>${playlist.name}</strong>?</p>
                <p class="notification info">The tracks will remain in your library.</p>`,
      yes: /* @__PURE__ */ __name(() => true, "yes"),
      no: /* @__PURE__ */ __name(() => false, "no"),
      defaultYes: false
    });
    if (confirmed) {
      try {
        if (this.filterState.selectedPlaylistId === playlistId) {
          this.filterState.selectedPlaylistId = null;
        }
        this.library.playlists.deletePlaylist(playlistId);
        this.render();
        this.notifyInfo(`Deleted playlist: ${playlist.name}`);
      } catch (error) {
        Logger.error("Failed to delete playlist:", error);
        this.notifyError("Failed to delete playlist");
      }
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Context Menu Handlers - Tags
  // ─────────────────────────────────────────────────────────────
  async onRenameTag(oldTagName) {
    const newTagName = await this.promptTextInput("Rename Tag", "New Tag Name", oldTagName);
    if (!newTagName || newTagName === oldTagName) return;
    try {
      const items = this.library.getAllItems().filter((item) => item.tags.includes(oldTagName));
      items.forEach((item) => {
        const updatedTags = item.tags.map((tag) => tag === oldTagName ? newTagName : tag);
        this.library.updateItem(item.id, { tags: updatedTags });
      });
      if (this.filterState.selectedTags.has(oldTagName)) {
        this.filterState.selectedTags.delete(oldTagName);
        this.filterState.selectedTags.add(newTagName);
      }
      this.render();
      this.notifyInfo(`Renamed tag "${oldTagName}" to "${newTagName}" in ${items.length} track(s)`);
    } catch (error) {
      Logger.error("Failed to rename tag:", error);
      this.notifyError("Failed to rename tag");
    }
  }
  async onDeleteTag(tagName) {
    const items = this.library.getAllItems().filter((item) => item.tags.includes(tagName));
    const confirmed = await Dialog.confirm({
      title: "Delete Tag",
      content: `<p>Are you sure you want to delete the tag <strong>${tagName}</strong>?</p>
                <p class="notification warning">This will remove the tag from ${items.length} track(s).</p>`,
      yes: /* @__PURE__ */ __name(() => true, "yes"),
      no: /* @__PURE__ */ __name(() => false, "no"),
      defaultYes: false
    });
    if (confirmed) {
      try {
        items.forEach((item) => {
          const updatedTags = item.tags.filter((tag) => tag !== tagName);
          this.library.updateItem(item.id, { tags: updatedTags });
        });
        this.filterState.selectedTags.delete(tagName);
        this.render();
        this.notifyInfo(`Deleted tag "${tagName}" from ${items.length} track(s)`);
      } catch (error) {
        Logger.error("Failed to delete tag:", error);
        this.notifyError("Failed to delete tag");
      }
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────
  async promptPlaylistSelection(playlists) {
    var _a2;
    const tracksLabel = this.localize("ASE.UI.Tracks", "tracks");
    const options = playlists.map(
      (p, index) => `<button type="button" class="ase-playlist-picker-item ${index === 0 ? "active" : ""}" data-playlist-id="${p.id}">
        <span class="ase-playlist-picker-name">${p.name}</span>
        <span class="ase-playlist-picker-meta">(${p.items.length} ${tracksLabel})</span>
      </button>`
    ).join("");
    const initialPlaylistId = ((_a2 = playlists[0]) == null ? void 0 : _a2.id) ?? "";
    return new Promise((resolve) => {
      const dialog = this.openStyledDialog({
        title: this.localize("ASE.UI.Dialog.AddToPlaylist.Title", "Add to Playlist"),
        content: `
          <form class="ase-dialog-form">
            <div class="form-group">
              <label>${this.localize("ASE.UI.Dialog.SelectPlaylist.Label", "Select Playlist")}</label>
              <input type="hidden" name="playlist-id" value="${initialPlaylistId}">
              <div class="ase-dialog-scroll-list ase-playlist-picker-list">
                ${options}
              </div>
            </div>
          </form>
        `,
        buttons: {
          add: {
            icon: '<i class="fas fa-plus"></i>',
            label: this.localize("ASE.UI.Actions.Add", "Add"),
            callback: /* @__PURE__ */ __name((html) => {
              const playlistId = html.find('[name="playlist-id"]').val();
              resolve(playlistId || null);
            }, "callback")
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize("ASE.UI.Actions.Cancel", "Cancel"),
            callback: /* @__PURE__ */ __name(() => resolve(null), "callback")
          }
        },
        default: "add",
        close: /* @__PURE__ */ __name(() => resolve(null), "close")
      }, { width: 520 });
      setTimeout(() => {
        var _a3;
        const appEl = (_a3 = dialog.element) == null ? void 0 : _a3.closest(".app.dialog");
        if (!(appEl == null ? void 0 : appEl.length)) return;
        const $hidden = appEl.find('input[name="playlist-id"]');
        const $items = appEl.find(".ase-playlist-picker-item");
        $items.on("click", (event) => {
          const $item = $(event.currentTarget);
          const playlistId = String($item.data("playlist-id") ?? "");
          if (!playlistId) return;
          $items.removeClass("active");
          $item.addClass("active");
          $hidden.val(playlistId);
        });
      }, 0);
    });
  }
  async promptTextInput(title, label, defaultValue = "") {
    return new Promise((resolve) => {
      this.openStyledDialog({
        title,
        content: `
          <form class="ase-dialog-form">
            <div class="form-group">
              <label>${label}</label>
              <input type="text" name="text-input" value="${defaultValue}" autofocus />
            </div>
          </form>
        `,
        buttons: {
          save: {
            icon: '<i class="fas fa-check"></i>',
            label: this.localize("ASE.UI.Actions.Save", "Save"),
            callback: /* @__PURE__ */ __name((html) => {
              const value = (html.find('[name="text-input"]').val() || "").trim();
              resolve(value || null);
            }, "callback")
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: this.localize("ASE.UI.Actions.Cancel", "Cancel"),
            callback: /* @__PURE__ */ __name(() => resolve(null), "callback")
          }
        },
        default: "save",
        close: /* @__PURE__ */ __name(() => resolve(null), "close")
      });
    });
  }
  /**
   * Handle adding track to playlist from context menu
   */
  async handleAddToPlaylistFromContext(itemId) {
    const item = this.library.getItem(itemId);
    if (!item) return;
    const playlists = this.library.playlists.getAllPlaylists();
    if (playlists.length === 0) {
      this.notifyWarn("No playlists available. Create one first.");
      return;
    }
    const selectedPlaylistId = await this.promptPlaylistSelection(playlists);
    if (!selectedPlaylistId) return;
    try {
      const group = this.inferGroupFromTags(item.tags);
      this.library.playlists.addTrackToPlaylist(selectedPlaylistId, itemId, group);
      this.render();
      this.notifyInfo(`Added "${item.name}" to playlist`);
    } catch (error) {
      Logger.error("Failed to add track to playlist:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.notifyError(`Failed to add to playlist: ${errorMessage}`);
    }
  }
};
__name(_LocalLibraryApp, "LocalLibraryApp");
let LocalLibraryApp = _LocalLibraryApp;
const _SoundMixerApp = class _SoundMixerApp {
  constructor(engine, socket, libraryManager2, queueManager2) {
    __publicField(this, "engine");
    __publicField(this, "socket");
    __publicField(this, "libraryManager");
    __publicField(this, "queueManager");
    __publicField(this, "collapsedPlaylists", /* @__PURE__ */ new Set());
    __publicField(this, "ungroupedCollapsed", false);
    __publicField(this, "updateInterval", null);
    __publicField(this, "html", null);
    __publicField(this, "renderParent", null);
    // Throttle for socket broadcasts
    __publicField(this, "seekThrottleTimers", /* @__PURE__ */ new Map());
    __publicField(this, "volumeThrottleTimers", /* @__PURE__ */ new Map());
    // Stored callbacks for proper cleanup
    __publicField(this, "_onQueueChangeBound");
    __publicField(this, "_onTrackEndedBound");
    __publicField(this, "_hookFavoritesId", 0);
    __publicField(this, "_hookAutoSwitchId", 0);
    // Drag-and-Drop State (Optimization with RAF)
    __publicField(this, "_dragTarget", null);
    __publicField(this, "_dragPosition", null);
    __publicField(this, "_rafId", null);
    __publicField(this, "_pendingDragUpdate", null);
    this.engine = engine;
    this.socket = socket;
    this.libraryManager = libraryManager2;
    this.queueManager = queueManager2;
    this._onQueueChangeBound = () => this.onQueueChange();
    this._onTrackEndedBound = () => this.onTrackStateChange();
    this.queueManager.on("change", this._onQueueChangeBound);
    this.engine.on("trackEnded", this._onTrackEndedBound);
    this._hookFavoritesId = Hooks.on("ase.favoritesChanged", () => {
      this.requestRender();
    });
    this._hookAutoSwitchId = Hooks.on("ase.trackAutoSwitched", () => {
      Logger.debug("[SoundMixerApp] Track auto-switched, re-rendering");
      this.requestRender();
    });
  }
  // Set callback for requesting parent render
  setRenderCallback(callback) {
    this.renderParent = callback;
  }
  // ─────────────────────────────────────────────────────────────
  // Data Provider
  // ─────────────────────────────────────────────────────────────
  getData() {
    var _a2, _b, _c, _d;
    const orderedFavorites = this.libraryManager.getOrderedFavorites();
    const favorites = [];
    for (const fav of orderedFavorites) {
      const inQueue = fav.type === "track" ? ((_b = (_a2 = window.ASE) == null ? void 0 : _a2.queue) == null ? void 0 : _b.hasItem(fav.id)) ?? false : ((_d = (_c = window.ASE) == null ? void 0 : _c.queue) == null ? void 0 : _d.getItems().some((q) => q.playlistId === fav.id)) ?? false;
      if (fav.type === "track") {
        const item = this.libraryManager.getItem(fav.id);
        if (item) {
          const player = this.engine.getTrack(item.id);
          favorites.push({
            id: item.id,
            name: item.name,
            type: "track",
            group: item.group,
            isPlaying: (player == null ? void 0 : player.state) === "playing",
            isPaused: (player == null ? void 0 : player.state) === "paused",
            inQueue,
            playbackMode: item.playbackMode || "inherit",
            isFavorite: true
          });
        }
      } else if (fav.type === "playlist") {
        const playlist = this.libraryManager.playlists.getPlaylist(fav.id);
        if (playlist) {
          const playlistTracks = this.libraryManager.playlists.getPlaylistTracks(fav.id);
          let isPlaying = false;
          let isPaused = false;
          for (const pt of playlistTracks) {
            const player = this.engine.getTrack(pt.libraryItemId);
            if ((player == null ? void 0 : player.state) === "playing") isPlaying = true;
            if ((player == null ? void 0 : player.state) === "paused") isPaused = true;
          }
          favorites.push({
            id: playlist.id,
            name: playlist.name,
            type: "playlist",
            group: void 0,
            isPlaying,
            isPaused: !isPlaying && isPaused,
            inQueue,
            playbackMode: playlist.playbackMode || "loop",
            isFavorite: true
          });
        }
      }
    }
    const queueItems = this.queueManager.getItems();
    const queuePlaylists = this.groupQueueByPlaylist(queueItems);
    const channelEffects = {
      music: !this.engine.getChain("music").isBypassed,
      ambience: !this.engine.getChain("ambience").isBypassed,
      sfx: !this.engine.getChain("sfx").isBypassed
    };
    return {
      favorites,
      queuePlaylists,
      channelEffects
    };
  }
  groupQueueByPlaylist(queueItems) {
    var _a2, _b, _c, _d;
    const groups = /* @__PURE__ */ new Map();
    const ungroupedLabel = ((_b = (_a2 = game.i18n) == null ? void 0 : _a2.localize) == null ? void 0 : _b.call(_a2, "ASE.UI.Queue.Ungrouped")) ?? "Ungrouped";
    const unknownPlaylistLabel = ((_d = (_c = game.i18n) == null ? void 0 : _c.localize) == null ? void 0 : _d.call(_c, "ASE.UI.Queue.UnknownPlaylist")) ?? "Unknown Playlist";
    for (const item of queueItems) {
      const key = item.playlistId ?? null;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(item);
    }
    const playlists = [];
    for (const [playlistId, items] of groups) {
      let name = ungroupedLabel;
      let playbackMode = "loop";
      const isUngrouped = !playlistId;
      if (playlistId) {
        const playlist = this.libraryManager.playlists.getPlaylist(playlistId);
        name = (playlist == null ? void 0 : playlist.name) ?? unknownPlaylistLabel;
        playbackMode = (playlist == null ? void 0 : playlist.playbackMode) ?? "loop";
      }
      const collapsed = playlistId ? this.collapsedPlaylists.has(playlistId) : this.ungroupedCollapsed;
      const tracks = items.map((queueItem) => this.getQueueTrackViewData(queueItem, collapsed));
      const activeTrackCount = tracks.filter((t) => t.isPlaying || t.isPaused).length;
      const hasPlayingTracks = tracks.some((t) => t.isPlaying);
      const hasPausedTracks = tracks.some((t) => t.isPaused);
      playlists.push({
        id: playlistId,
        name,
        collapsed: playlistId ? this.collapsedPlaylists.has(playlistId) : this.ungroupedCollapsed,
        tracks,
        activeTrackCount,
        totalTrackCount: tracks.length,
        hasPlayingTracks,
        hasPausedTracks,
        playbackMode,
        isUngrouped
      });
    }
    return playlists;
  }
  getQueueTrackViewData(queueItem, parentCollapsed = false) {
    const libraryItem = this.libraryManager.getItem(queueItem.libraryItemId);
    const player = this.engine.getTrack(queueItem.libraryItemId);
    const currentTimeRaw = (player == null ? void 0 : player.getCurrentTime()) ?? 0;
    const duration = (libraryItem == null ? void 0 : libraryItem.duration) ?? (player == null ? void 0 : player.getDuration()) ?? 0;
    const currentTime = Math.min(currentTimeRaw, duration);
    let progress = 0;
    if (duration > 0 && Number.isFinite(duration)) {
      progress = currentTime / duration * 100;
    }
    progress = Math.min(Math.max(progress, 0), 100);
    const volume = (player == null ? void 0 : player.volume) ?? queueItem.volume;
    const isPlaying = (player == null ? void 0 : player.state) === "playing";
    const isPaused = (player == null ? void 0 : player.state) === "paused";
    const shouldBeHidden = parentCollapsed && !isPlaying && !isPaused;
    return {
      queueId: queueItem.id,
      libraryItemId: queueItem.libraryItemId,
      name: (libraryItem == null ? void 0 : libraryItem.name) ?? "Unknown Track",
      group: (libraryItem == null ? void 0 : libraryItem.group) ?? queueItem.group,
      tags: (libraryItem == null ? void 0 : libraryItem.tags) ?? [],
      isPlaying,
      isPaused,
      isStopped: !player || player.state === "stopped",
      isLoading: (player == null ? void 0 : player.state) === "loading",
      volume,
      volumePercent: Math.round(volume * 100),
      playbackMode: (libraryItem == null ? void 0 : libraryItem.playbackMode) || "inherit",
      // Add playbackMode
      currentTime,
      currentTimeFormatted: formatTime(currentTime),
      duration,
      durationFormatted: formatTime(duration),
      progress,
      shouldBeHidden
    };
  }
  // ─────────────────────────────────────────────────────────────
  // Event Listeners
  // ─────────────────────────────────────────────────────────────
  activateListeners(html) {
    this.html = html;
    this.startUpdates();
    html.find('[data-action="play-favorite"]').on("click", (e) => this.onPlayFavorite(e));
    html.find('[data-action="pause-favorite"]').on("click", (e) => this.onPauseFavorite(e));
    html.find('[data-action="stop-favorite"]').on("click", (e) => this.onStopFavorite(e));
    html.find('[data-action="add-to-queue-from-favorite"]').on("click", (e) => this.onAddToQueueFromFavorite(e));
    html.find('[data-action="favorite-mode-dropdown"]').on("click", (e) => this.onFavoriteModeClick(e));
    html.find('[data-action="toggle-mixer-favorite"]').on("click", (e) => this.onToggleMixerFavorite(e));
    html.find('[data-action="play-queue"]').on("click", (e) => this.onPlayQueueItem(e));
    html.find('[data-action="pause-queue"]').on("click", (e) => this.onPauseQueueItem(e));
    html.find('[data-action="stop-queue"]').on("click", (e) => this.onStopQueueItem(e));
    html.find('[data-action="remove-queue"]').on("click", (e) => this.onRemoveQueueItem(e));
    html.find('[data-action="track-mode-dropdown"]').on("click", (e) => this.onTrackModeClick(e));
    html.find('[data-action="channel-dropdown"]').on("click", (e) => this.onChannelDropdown(e));
    html.find('[data-action="toggle-playlist"]').on("click", (e) => this.onTogglePlaylist(e));
    html.find('[data-action="play-playlist"]').on("click", (e) => this.onPlayPlaylistHeader(e));
    html.find('[data-action="pause-playlist"]').on("click", (e) => this.onPausePlaylistHeader(e));
    html.find('[data-action="stop-playlist"]').on("click", (e) => this.onStopPlaylistHeader(e));
    html.find('[data-action="playlist-mode-dropdown"]').on("click", (e) => this.onPlaylistModeClick(e));
    html.find('[data-action="remove-playlist"]').on("click", (e) => this.onRemovePlaylistFromQueue(e));
    html.find('[data-action="seek"]').on("input", (e) => this.onSeek(e));
    html.find('[data-action="volume"]').on("input", (e) => this.onVolumeChange(e));
    html.find(".volume-slider").on("input", (e) => {
      const slider = e.currentTarget;
      const value = slider.value;
      const volumeDisplay = $(slider).siblings(".vol-value");
      volumeDisplay.text(`${value}%`);
    });
    html.find(".progress-section").each((_, section) => {
      const $section = $(section);
      const $tooltip = $section.find(".progress-hover-time");
      $section.on("mousemove", (e) => {
        var _a2;
        const rect = section.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(100, offsetX / rect.width * 100));
        const $track = $section.closest(".ase-queue-track");
        const durationText = (_a2 = $track.find(".track-timer").text().split("/")[1]) == null ? void 0 : _a2.trim();
        if (durationText) {
          const [mins, secs] = durationText.split(":").map(Number);
          const totalSeconds = mins * 60 + secs;
          const hoverSeconds = Math.floor(percentage / 100 * totalSeconds);
          const hoverMins = Math.floor(hoverSeconds / 60);
          const hoverSecs = hoverSeconds % 60;
          const hoverTime = `${hoverMins}:${hoverSecs.toString().padStart(2, "0")}`;
          $tooltip.text(hoverTime);
          $tooltip.css({
            left: `${percentage}%`,
            display: "block"
          });
        }
      });
      $section.on("mouseleave", () => {
        $tooltip.css("display", "none");
      });
    });
    html.find('[data-action="toggle-channel-effects"]').on("click", (e) => this.onToggleChannelEffects(e));
    this.setupDragAndDrop(html);
    this.setupMarquee(html);
  }
  // ─────────────────────────────────────────────────────────────
  // Marquee Logic
  // ─────────────────────────────────────────────────────────────
  /**
   * Setup scrolling text for truncated names on hover
   */
  /**
   * Setup scrolling text for truncated names on hover or active play
   */
  setupMarquee(html) {
    html.find(".ase-favorite-item").on("mouseenter", (e) => {
      this.toggleMarquee(e.currentTarget, true);
    });
    html.find(".ase-favorite-item").on("mouseleave", (e) => {
      const item = e.currentTarget;
      if (!item.classList.contains("is-playing")) {
        this.toggleMarquee(item, false);
      }
    });
    html.find(".ase-favorite-item.is-playing").each((_, el) => {
      this.toggleMarquee(el, true);
    });
  }
  toggleMarquee(item, active) {
    const info = item.querySelector(".ase-favorite-info");
    const span = info == null ? void 0 : info.querySelector("span");
    if (!span) return;
    if (!active) {
      item.classList.remove("is-scrolling");
      span.style.removeProperty("--scroll-offset");
      span.style.removeProperty("--scroll-duration");
      return;
    }
    const overflow = span.scrollWidth - info.offsetWidth;
    if (overflow > 0) {
      const speed = 20;
      const buffer = 20;
      const offset = -(overflow + buffer);
      const duration = Math.max((overflow + buffer) / speed, 2);
      span.style.setProperty("--scroll-offset", `${offset}px`);
      span.style.setProperty("--scroll-duration", `${duration}s`);
      item.classList.add("is-scrolling");
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Favorites Handlers
  // ─────────────────────────────────────────────────────────────
  async onPlayFavorite(event) {
    event.preventDefault();
    event.stopPropagation();
    const $el = $(event.currentTarget);
    const id = $el.data("favorite-id");
    const type = $el.data("favorite-type");
    if (type === "track") {
      const libraryItem = this.libraryManager.getItem(id);
      if (libraryItem) {
        const queueItems = this.queueManager.getItems();
        const existingQueueItem = queueItems.find(
          (item) => item.libraryItemId === id && !item.playlistId
        );
        if (!existingQueueItem) {
          this.queueManager.addItem(id, { group: libraryItem.group });
        }
        const context = {
          type: "track",
          playbackMode: libraryItem.playbackMode
        };
        await this.playTrack(id, context);
      }
    } else {
      const playlist = this.libraryManager.playlists.getPlaylist(id);
      if (playlist) {
        const queueItems = this.queueManager.getItems();
        const existingPlaylistItems = queueItems.filter(
          (item) => item.playlistId === id
        );
        if (existingPlaylistItems.length === 0) {
          const tracks = this.libraryManager.playlists.getPlaylistTracks(id);
          const playlistItems = tracks.map((t) => {
            const item = this.libraryManager.getItem(t.libraryItemId);
            return {
              libraryItemId: t.libraryItemId,
              group: (item == null ? void 0 : item.group) || "music"
            };
          });
          this.queueManager.addPlaylist(id, playlistItems);
        }
        await this.playPlaylist(id);
      }
    }
    this.requestRender();
  }
  onPauseFavorite(event) {
    event.preventDefault();
    event.stopPropagation();
    const $el = $(event.currentTarget);
    const id = $el.data("favorite-id");
    const type = $el.data("favorite-type");
    if (type === "track") {
      this.pauseTrack(id);
    } else {
      const tracks = this.libraryManager.playlists.getPlaylistTracks(id);
      for (const track of tracks) {
        const player = this.engine.getTrack(track.libraryItemId);
        if ((player == null ? void 0 : player.state) === "playing") {
          this.pauseTrack(track.libraryItemId);
        }
      }
    }
    this.requestRender();
  }
  onStopFavorite(event) {
    event.preventDefault();
    event.stopPropagation();
    const $el = $(event.currentTarget);
    const id = $el.data("favorite-id");
    const type = $el.data("favorite-type");
    if (type === "track") {
      this.stopTrack(id);
    } else {
      this.stopPlaylist(id);
    }
    this.requestRender();
  }
  onFavoriteModeClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const btn = $(event.currentTarget);
    const id = btn.data("favorite-id");
    const type = btn.data("favorite-type");
    if (type === "track") {
      const item = this.libraryManager.getItem(id);
      if (!item) return;
      const modes = [
        { label: "Inherit (Default)", value: "inherit", icon: "fa-arrow-turn-down" },
        { label: "Loop", value: "loop", icon: "fa-repeat" },
        { label: "Single", value: "single", icon: "fa-arrow-right-to-line" },
        { label: "Linear", value: "linear", icon: "fa-arrow-right" },
        { label: "Random", value: "random", icon: "fa-shuffle" }
      ];
      this.showModeContextMenu(event, modes, (mode) => {
        this.libraryManager.updateItem(id, { playbackMode: mode });
        this.requestRender();
      });
    } else {
      const playlist = this.libraryManager.playlists.getPlaylist(id);
      if (!playlist) return;
      const modes = [
        { label: "Loop (Default)", value: "loop", icon: "fa-repeat" },
        { label: "Linear", value: "linear", icon: "fa-arrow-right" },
        { label: "Random", value: "random", icon: "fa-shuffle" }
      ];
      this.showModeContextMenu(event, modes, (mode) => {
        this.libraryManager.playlists.updatePlaylist(id, { playbackMode: mode });
        this.requestRender();
      });
    }
  }
  onToggleMixerFavorite(event) {
    event.preventDefault();
    event.stopPropagation();
    const btn = $(event.currentTarget);
    const id = btn.data("favorite-id");
    const type = btn.data("favorite-type");
    if (type === "track") {
      this.libraryManager.toggleFavorite(id);
    } else {
      this.libraryManager.playlists.togglePlaylistFavorite(id);
    }
    this.requestRender();
  }
  // ─────────────────────────────────────────────────────────────
  // Queue Item Handlers
  // ─────────────────────────────────────────────────────────────
  async onPlayQueueItem(event) {
    event.preventDefault();
    event.stopPropagation();
    const $track = $(event.currentTarget).closest(".ase-queue-track");
    const queueId = $track.data("queue-id");
    const itemId = $track.data("item-id");
    const queueItem = this.queueManager.getItems().find((q) => q.id === queueId);
    if (!queueItem) {
      Logger.warn(`Queue item not found for ID: ${queueId}`);
      return;
    }
    let context;
    if (queueItem.playlistId) {
      const playlist = this.libraryManager.playlists.getPlaylist(queueItem.playlistId);
      context = {
        type: "playlist",
        id: queueItem.playlistId,
        playbackMode: (playlist == null ? void 0 : playlist.playbackMode) || "loop"
      };
    } else {
      const libraryItem = this.libraryManager.getItem(itemId);
      context = {
        type: "track",
        playbackMode: (libraryItem == null ? void 0 : libraryItem.playbackMode) || "inherit"
      };
    }
    await this.playTrack(itemId, context);
    this.requestRender();
  }
  onPauseQueueItem(event) {
    event.preventDefault();
    event.stopPropagation();
    const $track = $(event.currentTarget).closest(".ase-queue-track");
    const itemId = $track.data("item-id");
    this.pauseTrack(itemId);
    this.requestRender();
  }
  onStopQueueItem(event) {
    event.preventDefault();
    event.stopPropagation();
    const $track = $(event.currentTarget).closest(".ase-queue-track");
    const itemId = $track.data("item-id");
    this.stopTrack(itemId);
    this.requestRender();
  }
  onRemoveQueueItem(event) {
    event.preventDefault();
    event.stopPropagation();
    const $track = $(event.currentTarget).closest(".ase-queue-track");
    const queueId = $track.data("queue-id");
    const itemId = $track.data("item-id");
    this.stopTrack(itemId);
    this.queueManager.removeItem(queueId);
    this.requestRender();
  }
  /**
   * Handle playback mode dropdown click
   */
  onTrackModeClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const btn = $(event.currentTarget);
    let itemId = btn.data("item-id");
    if (!itemId) {
      itemId = btn.closest("[data-item-id]").data("item-id");
    }
    const item = this.libraryManager.getItem(itemId);
    if (!item) {
      Logger.warn(`Track Mode Clicked: Item not found for ID ${itemId}`);
      return;
    }
    const modes = [
      { label: "Inherit (Default)", value: "inherit", icon: "fa-arrow-turn-down" },
      { label: "Loop", value: "loop", icon: "fa-repeat" },
      { label: "Single", value: "single", icon: "fa-arrow-right-to-line" },
      { label: "Linear", value: "linear", icon: "fa-arrow-right" },
      { label: "Random", value: "random", icon: "fa-shuffle" }
    ];
    this.showModeContextMenu(event, modes, (mode) => {
      this.libraryManager.updateItem(itemId, { playbackMode: mode });
      this.requestRender();
    });
  }
  /**
   * Show context menu for mode selection
   */
  showModeContextMenu(event, modes, callback) {
    const localize = /* @__PURE__ */ __name((key) => game.i18n.localize(key), "localize");
    const menuHtml = `
      <div id="ase-mode-menu" class="ase-context-menu">
        ${modes.map((m) => `
          <div class="ase-ctx-item" data-value="${m.value}">
              <i class="fa-solid ${m.icon}"></i> 
              <span>${localize(`ASE.UI.PlaybackMode.${m.value}`)}</span>
          </div>
        `).join("")}
      </div>
    `;
    $("#ase-mode-menu").remove();
    const menu = $(menuHtml);
    $("body").append(menu);
    menu.css({ top: event.clientY, left: event.clientX });
    menu.find(".ase-ctx-item").on("click", (e) => {
      e.stopPropagation();
      const val = $(e.currentTarget).data("value");
      Logger.debug(`Mode Selected: ${val}`);
      callback(val);
      menu.remove();
    });
    setTimeout(() => {
      $("body").one("click", () => {
        menu.remove();
      });
    }, 10);
  }
  /**
   * Handle channel dropdown click
   */
  onChannelDropdown(event) {
    event.preventDefault();
    event.stopPropagation();
    const btn = $(event.currentTarget);
    const itemId = btn.data("item-id");
    const id = itemId || btn.closest("[data-item-id]").data("item-id");
    const item = this.libraryManager.getItem(id);
    if (!item) return;
    const currentGroup = item.group || "music";
    const channels = ["music", "ambience", "sfx"];
    const localize = /* @__PURE__ */ __name((key) => game.i18n.localize(key), "localize");
    const menu = $(`
      <div class="ase-dropdown-menu">
        ${channels.map((ch) => `
          <div class="ase-dropdown-item ${ch === currentGroup ? "active" : ""}" data-channel="${ch}">
            ${localize(`ASE.Groups.${ch}`)}
          </div>
        `).join("")}
      </div>
    `);
    const rect = event.currentTarget.getBoundingClientRect();
    menu.css({ top: rect.bottom + 2, left: rect.left });
    $("body").append(menu);
    menu.find(".ase-dropdown-item").on("click", (e) => {
      e.stopPropagation();
      const newChannel = $(e.currentTarget).data("channel");
      this.updateTrackChannel(id, newChannel);
      menu.remove();
    });
    setTimeout(() => {
      $(document).one("click", () => menu.remove());
    }, 10);
  }
  updateTrackChannel(itemId, channel) {
    const item = this.libraryManager.getItem(itemId);
    if (!item) return;
    const group = channel;
    this.libraryManager.updateItem(itemId, { group });
    this.engine.setTrackChannel(itemId, group);
    this.requestRender();
  }
  async onAddToQueueFromFavorite(event) {
    event.preventDefault();
    event.stopPropagation();
    const $el = $(event.currentTarget);
    const id = $el.data("favorite-id");
    const type = $el.data("favorite-type");
    if (type === "track") {
      const libraryItem = this.libraryManager.getItem(id);
      if (!libraryItem) return;
      if (this.queueManager.hasItem(id)) {
        this.queueManager.removeByLibraryItemId(id);
        Logger.info(`Removed track from queue: ${libraryItem.name}`);
      } else {
        this.queueManager.addItem(id, { group: libraryItem.group });
        Logger.info(`Added track to queue: ${libraryItem.name}`);
      }
    } else {
      const playlist = this.libraryManager.playlists.getPlaylist(id);
      if (!playlist) return;
      const tracks = this.libraryManager.playlists.getPlaylistTracks(id);
      const allInQueue = tracks.every((t) => this.queueManager.hasItem(t.libraryItemId));
      if (allInQueue) {
        for (const track of tracks) {
          this.queueManager.removeByLibraryItemId(track.libraryItemId);
        }
        Logger.info(`Removed playlist from queue: ${playlist.name}`);
      } else {
        const playlistItems = tracks.map((t) => {
          const item = this.libraryManager.getItem(t.libraryItemId);
          return {
            libraryItemId: t.libraryItemId,
            group: (item == null ? void 0 : item.group) || "music"
          };
        });
        this.queueManager.addPlaylist(id, playlistItems);
        Logger.info(`Added playlist to queue: ${playlist.name}`);
      }
    }
    this.requestRender();
  }
  // ─────────────────────────────────────────────────────────────
  // Drag and Drop
  // ─────────────────────────────────────────────────────────────
  setupDragAndDrop(html) {
    html.find(".ase-favorite-item .ase-icons, .ase-favorite-item button, .ase-favorite-item input").on("pointerdown", (e) => {
      e.stopPropagation();
      const $item = $(e.currentTarget).closest(".ase-favorite-item");
      $item.attr("draggable", "false");
    });
    html.find('.ase-list-group[data-section="mixer-favorites"]').on("pointerup pointercancel", () => {
      html.find(".ase-favorite-item").attr("draggable", "true");
    });
    html.find('.ase-favorite-item[draggable="true"]').on("dragstart", (event) => {
      event.stopPropagation();
      const favoriteId = String($(event.currentTarget).data("favorite-id"));
      const favoriteType = String($(event.currentTarget).data("favorite-type"));
      Logger.info(`[SoundMixerApp] DragStart Favorite: ${favoriteId} (${favoriteType})`);
      event.originalEvent.dataTransfer.effectAllowed = "move";
      event.originalEvent.dataTransfer.setData("application/x-mixer-favorite-id", favoriteId);
      event.originalEvent.dataTransfer.setData("application/x-mixer-favorite-type", favoriteType);
      $(event.currentTarget).addClass("dragging");
    });
    html.find('.ase-favorite-item[draggable="true"]').on("dragend", (event) => {
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._pendingDragUpdate = null;
      this._dragTarget = null;
      this._dragPosition = null;
      $(event.currentTarget).removeClass("dragging");
      html.find(".ase-favorite-item").removeClass("drag-over drag-above drag-below");
    });
    html.find(".ase-favorite-item").on("dragover", (event) => {
      const types = event.originalEvent.dataTransfer.types;
      const hasFavoriteId = types instanceof DOMStringList && types.contains("application/x-mixer-favorite-id") || types instanceof Array && types.includes("application/x-mixer-favorite-id") || Array.from(types).includes("application/x-mixer-favorite-id");
      if (!hasFavoriteId) return;
      event.preventDefault();
      event.stopPropagation();
      event.originalEvent.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const clientY = event.originalEvent.clientY ?? event.clientY;
      const isAbove = clientY < midY;
      const newPos = isAbove ? "above" : "below";
      this._pendingDragUpdate = {
        target: event.currentTarget,
        position: newPos
      };
      if (!this._rafId) {
        this._rafId = requestAnimationFrame(this._processDragUpdate.bind(this, html, ".ase-favorite-item"));
      }
    });
    html.find(".ase-favorite-item").on("dragleave", (event) => {
      if (this._dragTarget === event.currentTarget) {
        this._dragTarget = null;
        this._dragPosition = null;
        $(event.currentTarget).removeClass("drag-above drag-below");
      }
    });
    html.find(".ase-favorite-item").on("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const dropPosition = this._dragPosition || "above";
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._pendingDragUpdate = null;
      this._dragTarget = null;
      this._dragPosition = null;
      const targetId = String($(event.currentTarget).data("favorite-id"));
      const targetType = String($(event.currentTarget).data("favorite-type"));
      html.find(".ase-favorite-item").removeClass("drag-above drag-below dragging");
      const draggedId = event.originalEvent.dataTransfer.getData("application/x-mixer-favorite-id");
      const draggedType = event.originalEvent.dataTransfer.getData("application/x-mixer-favorite-type");
      Logger.info(`[SoundMixerApp] Drop Favorite: ${draggedId} -> ${targetId} (${dropPosition})`);
      if (draggedId && draggedType && (draggedId !== targetId || draggedType !== targetType)) {
        this.handleFavoriteReorder(draggedId, draggedType, targetId, targetType, dropPosition);
      }
    });
    html.find(".ase-queue-track input, .ase-queue-track button, .ase-queue-track .volume-container, .ase-queue-track .progress-wrapper").on("pointerdown", (e) => {
      e.stopPropagation();
      const $track = $(e.currentTarget).closest(".ase-queue-track");
      $track.attr("draggable", "false");
    });
    html.find(".ase-track-player-list").on("pointerup pointercancel", () => {
      html.find(".ase-queue-track").attr("draggable", "true");
    });
    html.find('.ase-queue-track[draggable="true"]').on("dragstart", (event) => {
      event.stopPropagation();
      const queueId = String($(event.currentTarget).data("queue-id"));
      Logger.info(`[SoundMixerApp] DragStart Queue: ${queueId}`);
      event.originalEvent.dataTransfer.effectAllowed = "move";
      event.originalEvent.dataTransfer.setData("application/x-mixer-queue-id", queueId);
      $(event.currentTarget).addClass("dragging");
    });
    html.find('.ase-queue-track[draggable="true"]').on("dragend", (event) => {
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._pendingDragUpdate = null;
      this._dragTarget = null;
      this._dragPosition = null;
      $(event.currentTarget).removeClass("dragging");
      html.find(".ase-queue-track").removeClass("drag-over drag-above drag-below");
      $(event.currentTarget).attr("draggable", "true");
    });
    html.find(".ase-queue-track").on("dragover", (event) => {
      const types = event.originalEvent.dataTransfer.types;
      const hasQueueId = types instanceof DOMStringList && types.contains("application/x-mixer-queue-id") || types instanceof Array && types.includes("application/x-mixer-queue-id") || Array.from(types).includes("application/x-mixer-queue-id");
      if (!hasQueueId) return;
      event.preventDefault();
      event.stopPropagation();
      event.originalEvent.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const clientY = event.originalEvent.clientY ?? event.clientY;
      const isAbove = clientY < midY;
      const newPos = isAbove ? "above" : "below";
      this._pendingDragUpdate = {
        target: event.currentTarget,
        position: newPos
      };
      if (!this._rafId) {
        this._rafId = requestAnimationFrame(this._processDragUpdate.bind(this, html, ".ase-queue-track"));
      }
    });
    html.find(".ase-queue-track").on("dragleave", (event) => {
      if (this._dragTarget === event.currentTarget) {
        this._dragTarget = null;
        this._dragPosition = null;
        $(event.currentTarget).removeClass("drag-above drag-below");
      }
    });
    html.find(".ase-queue-track").on("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const dropPosition = this._dragPosition || "above";
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._pendingDragUpdate = null;
      this._dragTarget = null;
      this._dragPosition = null;
      html.find(".ase-queue-track").removeClass("drag-above drag-below dragging");
      const draggedQueueId = event.originalEvent.dataTransfer.getData("application/x-mixer-queue-id");
      const targetQueueId = String($(event.currentTarget).data("queue-id"));
      Logger.info(`[SoundMixerApp] Drop Queue: ${draggedQueueId} -> ${targetQueueId} (${dropPosition})`);
      if (draggedQueueId && draggedQueueId !== targetQueueId) {
        this.handleQueueReorder(draggedQueueId, targetQueueId, dropPosition);
      }
    });
  }
  handleFavoriteReorder(draggedId, draggedType, targetId, targetType, position) {
    const favorites = this.libraryManager.getOrderedFavorites();
    const draggedIndex = favorites.findIndex((f) => f.id === draggedId && f.type === draggedType);
    const targetIndex = favorites.findIndex((f) => f.id === targetId && f.type === targetType);
    if (draggedIndex === -1 || targetIndex === -1) return;
    const [draggedItem] = favorites.splice(draggedIndex, 1);
    let insertIndex;
    if (position === "above") {
      insertIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    } else {
      insertIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
    }
    insertIndex = Math.max(0, Math.min(insertIndex, favorites.length));
    favorites.splice(insertIndex, 0, draggedItem);
    this.libraryManager.reorderFavorites(favorites);
    this.requestRender();
    Logger.debug(`[SoundMixerApp] Reordered favorite ${draggedId} to position ${insertIndex} (${position})`);
  }
  handleQueueReorder(draggedQueueId, targetQueueId, position) {
    const items = this.queueManager.getItems();
    const draggedIndex = items.findIndex((i) => i.id === draggedQueueId);
    const targetIndex = items.findIndex((i) => i.id === targetQueueId);
    if (draggedIndex === -1 || targetIndex === -1) return;
    let newIndex;
    if (position === "above") {
      newIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    } else {
      newIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
    }
    this.queueManager.moveItem(draggedQueueId, newIndex);
    Logger.debug(`[SoundMixerApp] Reordered queue item ${draggedQueueId} to position ${newIndex} (${position} target ${targetIndex})`);
  }
  // ─────────────────────────────────────────────────────────────
  // Playlist Toggle
  // ─────────────────────────────────────────────────────────────
  onTogglePlaylist(event) {
    event.preventDefault();
    const $playlist = $(event.currentTarget).closest(".ase-queue-playlist");
    const playlistId = $playlist.data("playlist-id");
    if (playlistId === null || playlistId === void 0 || playlistId === "") {
      this.ungroupedCollapsed = !this.ungroupedCollapsed;
    } else {
      if (this.collapsedPlaylists.has(playlistId)) {
        this.collapsedPlaylists.delete(playlistId);
      } else {
        this.collapsedPlaylists.add(playlistId);
      }
    }
    this.requestRender();
  }
  // ─────────────────────────────────────────────────────────────
  // Playlist Header Controls
  // ─────────────────────────────────────────────────────────────
  getPlaylistHeaderInfo(event) {
    event.preventDefault();
    event.stopPropagation();
    const $playlist = $(event.currentTarget).closest(".ase-queue-playlist");
    const rawId = $playlist.data("playlist-id");
    const playlistId = rawId === void 0 || rawId === null || rawId === "" ? null : String(rawId);
    return { playlistId, $playlist };
  }
  getQueueItemsForGroup(playlistId) {
    return this.queueManager.getItems().filter((item) => {
      const itemPlaylistId = item.playlistId ?? null;
      return itemPlaylistId === playlistId;
    });
  }
  async onPlayPlaylistHeader(event) {
    var _a2, _b, _c, _d;
    const info = this.getPlaylistHeaderInfo(event);
    if (!info) return;
    const { playlistId } = info;
    const groupItems = this.getQueueItemsForGroup(playlistId);
    if (!groupItems.length) return;
    const pausedItems = groupItems.filter((item) => {
      const player = this.engine.getTrack(item.libraryItemId);
      return (player == null ? void 0 : player.state) === "paused";
    });
    if (pausedItems.length > 0) {
      for (const item of pausedItems) {
        const context = playlistId ? { type: "playlist", id: playlistId, playbackMode: ((_a2 = this.libraryManager.playlists.getPlaylist(playlistId)) == null ? void 0 : _a2.playbackMode) || "loop" } : { type: "track", playbackMode: ((_b = this.libraryManager.getItem(item.libraryItemId)) == null ? void 0 : _b.playbackMode) || "loop" };
        await this.playTrack(item.libraryItemId, context);
      }
    } else {
      const firstItem = groupItems[0];
      const context = playlistId ? { type: "playlist", id: playlistId, playbackMode: ((_c = this.libraryManager.playlists.getPlaylist(playlistId)) == null ? void 0 : _c.playbackMode) || "loop" } : { type: "track", playbackMode: ((_d = this.libraryManager.getItem(firstItem.libraryItemId)) == null ? void 0 : _d.playbackMode) || "loop" };
      await this.playTrack(firstItem.libraryItemId, context);
    }
    this.requestRender();
  }
  onPausePlaylistHeader(event) {
    const info = this.getPlaylistHeaderInfo(event);
    if (!info) return;
    const { playlistId } = info;
    const groupItems = this.getQueueItemsForGroup(playlistId);
    for (const item of groupItems) {
      const player = this.engine.getTrack(item.libraryItemId);
      if ((player == null ? void 0 : player.state) === "playing") {
        this.pauseTrack(item.libraryItemId);
      }
    }
    this.requestRender();
  }
  onStopPlaylistHeader(event) {
    const info = this.getPlaylistHeaderInfo(event);
    if (!info) return;
    const { playlistId } = info;
    const groupItems = this.getQueueItemsForGroup(playlistId);
    for (const item of groupItems) {
      const player = this.engine.getTrack(item.libraryItemId);
      if ((player == null ? void 0 : player.state) === "playing" || (player == null ? void 0 : player.state) === "paused") {
        this.stopTrack(item.libraryItemId);
      }
    }
    this.requestRender();
  }
  onPlaylistModeClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const btn = $(event.currentTarget);
    const playlistId = btn.data("playlist-id");
    if (!playlistId) return;
    const playlist = this.libraryManager.playlists.getPlaylist(playlistId);
    if (!playlist) return;
    const modes = [
      { label: "Loop (Default)", value: "loop", icon: "fa-repeat" },
      { label: "Linear", value: "linear", icon: "fa-arrow-right" },
      { label: "Random", value: "random", icon: "fa-shuffle" }
    ];
    this.showModeContextMenu(event, modes, (mode) => {
      this.libraryManager.playlists.updatePlaylist(playlistId, { playbackMode: mode });
      this.requestRender();
    });
  }
  onRemovePlaylistFromQueue(event) {
    const info = this.getPlaylistHeaderInfo(event);
    if (!info) return;
    const { playlistId } = info;
    const groupItems = this.getQueueItemsForGroup(playlistId);
    for (const item of groupItems) {
      const player = this.engine.getTrack(item.libraryItemId);
      if ((player == null ? void 0 : player.state) === "playing" || (player == null ? void 0 : player.state) === "paused") {
        this.stopTrack(item.libraryItemId);
      }
      this.queueManager.removeItem(item.id);
    }
    this.requestRender();
  }
  // ─────────────────────────────────────────────────────────────
  // Track Controls
  // ─────────────────────────────────────────────────────────────
  onSeek(event) {
    const $track = $(event.currentTarget).closest(".ase-queue-track");
    const itemId = $track.data("item-id");
    const value = parseFloat($(event.currentTarget).val());
    const player = this.engine.getTrack(itemId);
    if (player) {
      const seekTime = value / 100 * player.getDuration();
      this.engine.seekTrack(itemId, seekTime);
      if (this.socket.syncEnabled) {
        if (!this.seekThrottleTimers.has(itemId)) {
          this.seekThrottleTimers.set(itemId, setTimeout(() => {
            this.seekThrottleTimers.delete(itemId);
            const currentPlayer = this.engine.getTrack(itemId);
            if (currentPlayer) {
              this.socket.broadcastTrackSeek(itemId, currentPlayer.getCurrentTime(), currentPlayer.state === "playing");
            }
          }, _SoundMixerApp.THROTTLE_MS));
        }
      }
    }
  }
  onVolumeChange(event) {
    const $track = $(event.currentTarget).closest(".ase-queue-track");
    const itemId = $track.data("item-id");
    const value = parseInt($(event.currentTarget).val(), 10);
    const volume = value / 100;
    this.engine.setTrackVolume(itemId, volume);
    if (this.socket.syncEnabled) {
      if (!this.volumeThrottleTimers.has(itemId)) {
        this.volumeThrottleTimers.set(itemId, setTimeout(() => {
          this.volumeThrottleTimers.delete(itemId);
          const currentPlayer = this.engine.getTrack(itemId);
          if (currentPlayer) {
            this.socket.broadcastTrackVolume(itemId, currentPlayer.volume);
          }
        }, _SoundMixerApp.THROTTLE_MS));
      }
    }
    $track.find(".ase-volume-value").text(`${value}%`);
  }
  // ─────────────────────────────────────────────────────────────
  // Playback Core Methods
  // ─────────────────────────────────────────────────────────────
  /**
   * Воспроизвести трек с опциональным контекстом
   * @param itemId - ID трека из библиотеки
   * @param context - Контекст воспроизведения (playlist, track, queue)
   */
  async playTrack(itemId, context) {
    const libraryItem = this.libraryManager.getItem(itemId);
    if (!libraryItem) {
      Logger.warn("Track not found in library:", itemId);
      return;
    }
    let player = this.engine.getTrack(itemId);
    if (player && player.state === "paused") {
      const offset = player.getCurrentTime();
      await this.engine.playTrack(itemId, offset, context);
      if (this.socket.syncEnabled) {
        this.socket.broadcastTrackPlay(itemId, offset);
      }
      return;
    }
    if (!player) {
      player = await this.engine.createTrack({
        id: itemId,
        url: libraryItem.url,
        group: libraryItem.group,
        volume: 1
      });
    }
    const playbackContext = context || {
      type: "track",
      playbackMode: libraryItem.playbackMode
    };
    await this.engine.playTrack(itemId, 0, playbackContext);
    if (this.socket.syncEnabled) {
      this.socket.broadcastTrackPlay(itemId, 0);
    }
  }
  pauseTrack(itemId) {
    const player = this.engine.getTrack(itemId);
    this.engine.pauseTrack(itemId);
    if (this.socket.syncEnabled && player) {
      this.socket.broadcastTrackPause(itemId, player.getCurrentTime());
    }
  }
  stopTrack(itemId) {
    this.engine.stopTrack(itemId);
    if (this.socket.syncEnabled) {
      this.socket.broadcastTrackStop(itemId);
    }
  }
  /**
   * Воспроизвести плейлист (запускает первый трек с контекстом плейлиста)
   * @param playlistId - ID плейлиста
   */
  async playPlaylist(playlistId) {
    const playlist = this.libraryManager.playlists.getPlaylist(playlistId);
    if (!playlist) {
      Logger.warn("Playlist not found:", playlistId);
      return;
    }
    const tracks = this.libraryManager.playlists.getPlaylistTracks(playlistId);
    if (!tracks.length) {
      Logger.warn("Playlist is empty:", playlist.name);
      return;
    }
    const context = {
      type: "playlist",
      id: playlistId,
      playbackMode: playlist.playbackMode
    };
    const firstTrack = tracks[0];
    await this.playTrack(firstTrack.libraryItemId, context);
  }
  stopPlaylist(playlistId) {
    const tracks = this.libraryManager.playlists.getPlaylistTracks(playlistId);
    for (const track of tracks) {
      this.stopTrack(track.libraryItemId);
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Real-time Updates
  // ─────────────────────────────────────────────────────────────
  startUpdates() {
    if (this.updateInterval) return;
    this.updateInterval = setInterval(() => this.updateTrackDisplays(), 100);
  }
  stopUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  /**
   * Full cleanup: stops updates, clears throttle timers, removes all event subscriptions.
   * Called when the parent window closes.
   */
  dispose() {
    this.stopUpdates();
    for (const timer of this.seekThrottleTimers.values()) {
      clearTimeout(timer);
    }
    this.seekThrottleTimers.clear();
    for (const timer of this.volumeThrottleTimers.values()) {
      clearTimeout(timer);
    }
    this.volumeThrottleTimers.clear();
    this.queueManager.off("change", this._onQueueChangeBound);
    this.engine.off("trackEnded", this._onTrackEndedBound);
    if (this._hookFavoritesId) {
      Hooks.off("ase.favoritesChanged", this._hookFavoritesId);
    }
    if (this._hookAutoSwitchId) {
      Hooks.off("ase.trackAutoSwitched", this._hookAutoSwitchId);
    }
    this.html = null;
    Logger.debug("[SoundMixerApp] Disposed");
  }
  updateTrackDisplays() {
    var _a2, _b, _c, _d, _e, _f, _g, _h;
    if (!this.html) return;
    const playLabel = ((_b = (_a2 = game.i18n) == null ? void 0 : _a2.localize) == null ? void 0 : _b.call(_a2, "ASE.Play")) ?? "Play";
    const pauseLabel = ((_d = (_c = game.i18n) == null ? void 0 : _c.localize) == null ? void 0 : _d.call(_c, "ASE.Pause")) ?? "Pause";
    const pauseAllLabel = ((_f = (_e = game.i18n) == null ? void 0 : _e.localize) == null ? void 0 : _f.call(_e, "ASE.UI.Tooltip.PauseAll")) ?? "Pause All";
    const tracksLabel = ((_h = (_g = game.i18n) == null ? void 0 : _g.localize) == null ? void 0 : _h.call(_g, "ASE.UI.Tracks")) ?? "tracks";
    this.html.find(".ase-queue-track").each((_, el) => {
      const $track = $(el);
      const itemId = $track.data("item-id");
      const player = this.engine.getTrack(itemId);
      if (player) {
        const currentTime = player.getCurrentTime();
        const duration = player.getDuration();
        const progress = duration > 0 ? currentTime / duration * 100 : 0;
        $track.find(".progress-fill").css("width", `${progress}%`);
        $track.find(".seek-slider").val(progress);
        $track.find(".track-timer").text(`${formatTime(currentTime)} / ${formatTime(duration)}`);
        $track.removeClass("is-playing is-paused");
        const $playPauseBtn = $track.find('[data-action="play-queue"], [data-action="pause-queue"]');
        const $playPauseIcon = $playPauseBtn.find("i");
        if (player.state === "playing") {
          $track.addClass("is-playing");
          $playPauseIcon.removeClass("fa-play").addClass("fa-pause");
          $playPauseBtn.attr("data-action", "pause-queue").attr("title", pauseLabel);
        } else if (player.state === "paused") {
          $track.addClass("is-paused");
          $playPauseIcon.removeClass("fa-pause").addClass("fa-play");
          $playPauseBtn.attr("data-action", "play-queue").attr("title", playLabel);
        } else {
          $playPauseIcon.removeClass("fa-pause").addClass("fa-play");
          $playPauseBtn.attr("data-action", "play-queue").attr("title", playLabel);
        }
      }
    });
    this.html.find(".ase-queue-playlist").each((_, el) => {
      const $playlist = $(el);
      const $tracks = $playlist.find(".ase-queue-track");
      let activeCount = 0;
      let hasPlaying = false;
      $tracks.each((_2, trackEl) => {
        const $track = $(trackEl);
        const itemId = $track.data("item-id");
        const player = this.engine.getTrack(itemId);
        if ((player == null ? void 0 : player.state) === "playing") {
          activeCount++;
          hasPlaying = true;
        } else if ((player == null ? void 0 : player.state) === "paused") {
          activeCount++;
        }
      });
      const totalCount = $tracks.length;
      $playlist.find(".ase-playlist-count").text(`(${activeCount}/${totalCount} ${tracksLabel})`);
      const $headerBtn = $playlist.find(".ase-playlist-header-controls").find('[data-action="play-playlist"], [data-action="pause-playlist"]');
      const $headerIcon = $headerBtn.find("i");
      if (hasPlaying) {
        $headerIcon.removeClass("fa-play").addClass("fa-pause");
        $headerBtn.attr("data-action", "pause-playlist").attr("title", pauseAllLabel);
      } else {
        $headerIcon.removeClass("fa-pause").addClass("fa-play");
        $headerBtn.attr("data-action", "play-playlist").attr("title", playLabel);
      }
    });
    this.html.find(".ase-favorite-item").each((_, el) => {
      const $fav = $(el);
      const favId = $fav.data("favorite-id");
      const favType = $fav.data("favorite-type");
      let isPlaying = false;
      let isPaused = false;
      if (favType === "track") {
        const player = this.engine.getTrack(favId);
        isPlaying = (player == null ? void 0 : player.state) === "playing";
        isPaused = (player == null ? void 0 : player.state) === "paused";
      } else {
        const tracks = this.libraryManager.playlists.getPlaylistTracks(favId);
        for (const pt of tracks) {
          const player = this.engine.getTrack(pt.libraryItemId);
          if ((player == null ? void 0 : player.state) === "playing") isPlaying = true;
          if ((player == null ? void 0 : player.state) === "paused") isPaused = true;
        }
        if (isPlaying) isPaused = false;
      }
      const $btn = $fav.find('[data-action="play-favorite"], [data-action="pause-favorite"]');
      const $icon = $btn.find("i").length ? $btn.find("i") : $btn;
      if (isPlaying) {
        $fav.removeClass("is-paused").addClass("is-playing");
        if ($icon.is("i")) {
          $icon.removeClass("fa-play").addClass("fa-pause");
        } else {
          $btn.removeClass("fa-play").addClass("fa-pause");
        }
        $btn.attr("data-action", "pause-favorite").attr("title", pauseLabel);
      } else if (isPaused) {
        $fav.removeClass("is-playing").addClass("is-paused");
        if ($icon.is("i")) {
          $icon.removeClass("fa-pause").addClass("fa-play");
        } else {
          $btn.removeClass("fa-pause").addClass("fa-play");
        }
        $btn.attr("data-action", "play-favorite").attr("title", playLabel);
      } else {
        $fav.removeClass("is-playing is-paused");
        if ($icon.is("i")) {
          $icon.removeClass("fa-pause").addClass("fa-play");
        } else {
          $btn.removeClass("fa-pause").addClass("fa-play");
        }
        $btn.attr("data-action", "play-favorite").attr("title", playLabel);
      }
    });
  }
  onQueueChange() {
    Logger.debug("Queue changed, mixer should refresh");
    this.requestRender();
  }
  onTrackStateChange() {
    Logger.debug("[SoundMixerApp] Track state changed, re-rendering mixer");
    this.requestRender();
  }
  requestRender() {
    if (this.renderParent) {
      this.renderParent();
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Effect Handlers
  // ─────────────────────────────────────────────────────────────
  onToggleChannelEffects(event) {
    event.preventDefault();
    const btn = $(event.currentTarget);
    const channel = btn.data("channel");
    const isCurrentlyActive = btn.hasClass("active");
    const shouldBypass = isCurrentlyActive;
    this.engine.toggleChainBypass(channel, shouldBypass);
    this.socket.broadcastFullState();
    this.requestRender();
  }
  onToggleEffect(event) {
    event.preventDefault();
    const $btn = $(event.currentTarget);
    const effectType = $btn.data("effect-id");
    const wasEnabled = $btn.hasClass("active");
    const newState = !wasEnabled;
    const channels = ["music", "ambience", "sfx"];
    for (const channel of channels) {
      this.engine.setChainEffectEnabled(channel, effectType, newState);
      this.socket.broadcastEffectEnabled(channel, effectType, newState);
    }
    $btn.toggleClass("active", newState);
    Logger.info(`Effect ${effectType} ${newState ? "enabled" : "disabled"} on all channels`);
  }
  // ─────────────────────────────────────────────────────────────
  // RAF Processor for Drag Events
  // ─────────────────────────────────────────────────────────────
  _processDragUpdate(html, selector) {
    this._rafId = null;
    if (!this._pendingDragUpdate) return;
    const { target, position } = this._pendingDragUpdate;
    if (this._dragTarget === target && this._dragPosition === position) {
      return;
    }
    this._dragTarget = target;
    this._dragPosition = position;
    html.find(selector).removeClass("drag-above drag-below drag-over");
    $(target).addClass(position === "above" ? "drag-above" : "drag-below");
  }
};
__name(_SoundMixerApp, "SoundMixerApp");
__publicField(_SoundMixerApp, "THROTTLE_MS", 200);
let SoundMixerApp = _SoundMixerApp;
function fx(type, enabled, params = {}, mix) {
  return {
    type,
    enabled,
    mix: mix ?? DEFAULT_MIX[type] ?? 1,
    params: { level: 1, ...params }
  };
}
__name(fx, "fx");
function chains(music, ambience, sfx) {
  return [
    { channel: "music", effects: music },
    { channel: "ambience", effects: ambience },
    { channel: "sfx", effects: sfx }
  ];
}
__name(chains, "chains");
const BUILTIN_PRESETS = [
  {
    id: "builtin-standard",
    name: "Standard",
    description: "Default chain order, all effects disabled. Clean starting point.",
    builtIn: true,
    chains: chains(
      [fx("filter", false), fx("compressor", false), fx("distortion", false), fx("delay", false), fx("reverb", false)],
      [fx("filter", false), fx("compressor", false), fx("distortion", false), fx("delay", false), fx("reverb", false)],
      [fx("filter", false), fx("compressor", false), fx("distortion", false), fx("delay", false), fx("reverb", false)]
    )
  },
  {
    id: "builtin-dark-dungeon",
    name: "Dark Dungeon",
    description: "Low rumble, long reverb tails, muffled echoes.",
    builtIn: true,
    chains: chains(
      // Music: lowpass filter + long reverb
      [
        fx("filter", true, { type: "lowpass", frequency: 800, Q: 1 }),
        fx("reverb", true, { decay: 4, size: 2, tone: "dark" }, 0.35)
      ],
      // Ambience: lowpass + delay + very long reverb
      [
        fx("filter", true, { type: "lowpass", frequency: 600, Q: 0.8 }),
        fx("delay", true, { time: 0.8, feedback: 0.4 }, 0.2),
        fx("reverb", true, { decay: 5, size: 2, tone: "dark" }, 0.4)
      ],
      // SFX: gentle compressor + medium reverb
      [
        fx("compressor", true, { threshold: -15, ratio: 3 }),
        fx("reverb", true, { decay: 3, size: 1.5, tone: "dark" }, 0.25)
      ]
    )
  },
  {
    id: "builtin-cave-echo",
    name: "Cave Echo",
    description: "Hard reflections, prominent delay, natural cave feel.",
    builtIn: true,
    chains: chains(
      // Music: mild filter + short delay + medium reverb
      [
        fx("filter", true, { type: "lowpass", frequency: 3e3, Q: 0.5 }),
        fx("delay", true, { time: 0.15, feedback: 0.5 }, 0.2),
        fx("reverb", true, { decay: 2.5, size: 1.8, tone: "default" }, 0.3)
      ],
      // Ambience: prominent delay + reverb
      [
        fx("delay", true, { time: 0.25, feedback: 0.4 }, 0.25),
        fx("reverb", true, { decay: 3, size: 1.8, tone: "default" }, 0.35)
      ],
      // SFX: delay + reverb for echoes
      [
        fx("delay", true, { time: 0.12, feedback: 0.5 }, 0.25),
        fx("reverb", true, { decay: 2, size: 1.5, tone: "default" }, 0.2)
      ]
    )
  },
  {
    id: "builtin-open-field",
    name: "Open Field",
    description: "Wide open space, subtle reverb, natural clarity.",
    builtIn: true,
    chains: chains(
      // Music: light compressor + subtle delay + short reverb
      [
        fx("compressor", true, { threshold: -12, ratio: 2.5 }),
        fx("delay", true, { time: 0.15, feedback: 0.15 }, 0.1),
        fx("reverb", true, { decay: 1.5, size: 1, tone: "bright" }, 0.18)
      ],
      // Ambience: highpass (remove rumble) + gentle reverb
      [
        fx("filter", true, { type: "highpass", frequency: 200, Q: 0.7 }),
        fx("reverb", true, { decay: 2, size: 1.2, tone: "bright" }, 0.22)
      ],
      // SFX: just compressor for punch
      [
        fx("compressor", true, { threshold: -10, ratio: 3 })
      ]
    )
  },
  {
    id: "builtin-tavern",
    name: "Tavern",
    description: "Warm, close-quarters sound with slight crunch.",
    builtIn: true,
    chains: chains(
      // Music: lowpass (warmth) + compressor + light distortion + short reverb
      [
        fx("filter", true, { type: "lowpass", frequency: 3e3, Q: 0.8 }),
        fx("compressor", true, { threshold: -12, ratio: 3 }),
        fx("distortion", true, { drive: 5 }, 0.3),
        fx("reverb", true, { decay: 1, size: 0.5, tone: "dark" }, 0.18)
      ],
      // Ambience: bandpass (narrow room) + short reverb
      [
        fx("filter", true, { type: "bandpass", frequency: 800, Q: 2 }),
        fx("reverb", true, { decay: 0.8, size: 0.4, tone: "default" }, 0.12)
      ],
      // SFX: short reverb only
      [
        fx("reverb", true, { decay: 0.5, size: 0.3, tone: "default" }, 0.12)
      ]
    )
  },
  {
    id: "builtin-combat",
    name: "Combat",
    description: "Punchy, energetic. Tight compression, focused sound.",
    builtIn: true,
    chains: chains(
      // Music: moderate compressor + subtle distortion for energy
      [
        fx("compressor", true, { threshold: -18, ratio: 4 }),
        fx("distortion", true, { drive: 6 }, 0.25)
      ],
      // Ambience: highpass (cut mud) + compressor
      [
        fx("filter", true, { type: "highpass", frequency: 150, Q: 0.7 }),
        fx("compressor", true, { threshold: -14, ratio: 3 })
      ],
      // SFX: compressor for impact + very short delay for punch
      [
        fx("compressor", true, { threshold: -12, ratio: 3.5 }),
        fx("delay", true, { time: 0.05, feedback: 0.15 }, 0.15)
      ]
    )
  },
  {
    id: "builtin-underwater",
    name: "Underwater",
    description: "Heavy lowpass, slow modulated feel, muffled world.",
    builtIn: true,
    chains: chains(
      // Music: aggressive lowpass + reverb
      [
        fx("filter", true, { type: "lowpass", frequency: 400, Q: 2 }),
        fx("reverb", true, { decay: 3, size: 2, tone: "dark" }, 0.4)
      ],
      // Ambience: same treatment
      [
        fx("filter", true, { type: "lowpass", frequency: 350, Q: 2.5 }),
        fx("delay", true, { time: 0.4, feedback: 0.3 }, 0.15),
        fx("reverb", true, { decay: 4, size: 2.5, tone: "dark" }, 0.45)
      ],
      // SFX: lowpass + reverb
      [
        fx("filter", true, { type: "lowpass", frequency: 500, Q: 1.5 }),
        fx("reverb", true, { decay: 2, size: 1.5, tone: "dark" }, 0.3)
      ]
    )
  },
  {
    id: "builtin-old-radio",
    name: "Old Radio",
    description: "Bandpass filter + distortion for vintage radio effect.",
    builtIn: true,
    chains: chains(
      [
        fx("filter", true, { type: "bandpass", frequency: 2e3, Q: 3 }),
        fx("compressor", true, { threshold: -18, ratio: 4 }),
        fx("distortion", true, { drive: 10 }, 0.45)
      ],
      [
        fx("filter", true, { type: "bandpass", frequency: 2e3, Q: 3 }),
        fx("distortion", true, { drive: 8 }, 0.4)
      ],
      [
        fx("filter", true, { type: "bandpass", frequency: 2e3, Q: 3 }),
        fx("distortion", true, { drive: 8 }, 0.4)
      ]
    )
  }
];
const MODULE_ID$4 = "sound-engine-master";
const _GlobalStorage = class _GlobalStorage {
  /**
   * Load presets from global JSON file.
   * Returns built-in presets merged with user-saved custom presets.
   */
  static async loadPresets() {
    try {
      const response = await fetch(`${this.PRESETS_FILE_PATH}?t=${Date.now()}`);
      if (!response.ok) return [...BUILTIN_PRESETS];
      const data = await response.json();
      if (!data || data.length === 0) return [...BUILTIN_PRESETS];
      const customPresets = this.migratePresets(data);
      return [...BUILTIN_PRESETS, ...customPresets];
    } catch (error) {
      Logger.warn("Failed to load presets:", error);
      return [...BUILTIN_PRESETS];
    }
  }
  /**
   * Migrate old-format presets (flat effects[] with routing) to chain format.
   * Filters out any presets that match built-in IDs to avoid duplicates.
   */
  static migratePresets(rawPresets) {
    const builtInIds = new Set(BUILTIN_PRESETS.map((p) => p.id));
    const result = [];
    for (const raw of rawPresets) {
      if (builtInIds.has(raw.id)) continue;
      if (raw.chains && Array.isArray(raw.chains) && raw.chains.length > 0) {
        result.push(raw);
        continue;
      }
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
  static migrateLegacyPreset(raw) {
    try {
      const channels = ["music", "ambience", "sfx"];
      const chains2 = channels.map((channel) => ({
        channel,
        effects: raw.effects.filter((e) => {
          var _a2;
          return (_a2 = e.routing) == null ? void 0 : _a2[channel];
        }).map((e) => ({
          type: e.type,
          enabled: true,
          mix: DEFAULT_MIX[e.type] ?? 1,
          params: { level: 1, ...e.params }
        }))
      }));
      return {
        id: raw.id,
        name: raw.name,
        description: raw.description || `Migrated from legacy format`,
        builtIn: false,
        chains: chains2
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
  static async savePresets(presets) {
    const customOnly = presets.filter((p) => !p.builtIn);
    return this.saveFile(this.PRESETS_FILE_PATH, customOnly);
  }
  /**
   * Generic save helper (refactored from save method)
   */
  static async saveFile(path, data) {
    var _a2;
    try {
      await this.ensureDirectory();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const file = new File([blob], path.split("/").pop(), { type: "application/json" });
      const originalInfo = (_a2 = ui.notifications) == null ? void 0 : _a2.info;
      if (ui.notifications) ui.notifications.info = () => {
      };
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
  static async load() {
    try {
      const response = await fetch(`${this.FILE_PATH}?t=${Date.now()}`);
      if (!response.ok) {
        Logger.info("No existing library file found");
        return null;
      }
      const data = await response.json();
      Logger.info("Loaded library from global storage");
      return data;
    } catch (error) {
      Logger.warn("Failed to load global library:", error);
      return null;
    }
  }
  /**
   * Save library state to global JSON file
   */
  static async save(state) {
    try {
      await this.saveFile(this.FILE_PATH, state);
      Logger.info("Saved library to global storage");
    } catch (error) {
      Logger.error("Failed to save library to global storage:", error);
      throw error;
    }
  }
  /**
   * Ensure the module directory exists
   */
  static async ensureDirectory() {
    try {
      await FilePicker.createDirectory(this.FILE_SOURCE, this.DIRECTORY, {});
    } catch (error) {
      Logger.debug("Directory creation skipped (may already exist)");
    }
  }
  /**
   * Migrate data from world-scoped game.settings to global storage
   */
  static async migrateFromWorldSettings() {
    var _a2;
    try {
      const existingGlobal = await this.load();
      const itemsCount = (existingGlobal == null ? void 0 : existingGlobal.items) ? Array.isArray(existingGlobal.items) ? existingGlobal.items.length : Object.keys(existingGlobal.items).length : 0;
      if (existingGlobal && existingGlobal.items && itemsCount > 0) {
        Logger.info("Global storage already populated, skipping migration");
        return false;
      }
      const oldData = await ((_a2 = game.settings) == null ? void 0 : _a2.get(MODULE_ID$4, "libraryState"));
      if (!oldData || oldData === "") {
        Logger.info("No world-scoped data to migrate");
        return false;
      }
      const state = JSON.parse(oldData);
      if (!state.items || (Array.isArray(state.items) ? state.items.length === 0 : Object.keys(state.items).length === 0)) {
        Logger.info("World-scoped data is empty, skipping migration");
        return false;
      }
      await this.save(state);
      const itemCount = Array.isArray(state.items) ? state.items.length : Object.keys(state.items).length;
      Logger.info(`Migrated ${itemCount} items from world settings to global storage`);
      return true;
    } catch (error) {
      Logger.error("Migration from world settings failed:", error);
      return false;
    }
  }
  /**
   * Delete a physical file from disk
   * Shows manual deletion instructions since automatic deletion is unreliable
   */
  static async deletePhysicalFile(url) {
    var _a2;
    if (!this.isOurFile(url)) {
      Logger.warn("Cannot delete file not in sem_audio folder:", url);
      return false;
    }
    if (!((_a2 = game.user) == null ? void 0 : _a2.isGM)) {
      return false;
    }
    let filePath = url.replace(/\\/g, "/");
    filePath = filePath.replace(/^\/*/, "");
    filePath = filePath.replace(/^Data\//i, "");
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
      title: "Manual File Deletion Required",
      content,
      callback: /* @__PURE__ */ __name(() => {
      }, "callback"),
      options: { width: 500 }
    });
    return true;
  }
  /**
   * Check if file URL belongs to our module storage
   * Handles various URL formats from different Foundry versions and platforms
   */
  static isOurFile(url) {
    const normalizedUrl = url.replace(/\\/g, "/").toLowerCase();
    return normalizedUrl.includes("sem_audio/") || normalizedUrl.includes("/sem_audio/") || normalizedUrl.endsWith("sem_audio");
  }
};
__name(_GlobalStorage, "GlobalStorage");
__publicField(_GlobalStorage, "FILE_PATH", "/sem_library/library.json");
__publicField(_GlobalStorage, "PRESETS_FILE_PATH", "/sem_library/presets.json");
__publicField(_GlobalStorage, "FILE_SOURCE", "data");
__publicField(_GlobalStorage, "DIRECTORY", "sem_library");
let GlobalStorage = _GlobalStorage;
const ALL_EFFECT_TYPES = ["filter", "compressor", "distortion", "delay", "reverb"];
const EFFECT_META = {
  filter: { label: "ASE.UI.EffectType.filter", icon: "fa-wave-square" },
  compressor: { label: "ASE.UI.EffectType.compressor", icon: "fa-compress" },
  distortion: { label: "ASE.UI.EffectType.distortion", icon: "fa-bolt" },
  delay: { label: "ASE.UI.EffectType.delay", icon: "fa-clock" },
  reverb: { label: "ASE.UI.EffectType.reverb", icon: "fa-water" },
  modulation: { label: "ASE.UI.EffectType.modulation", icon: "fa-wave-square" }
};
const _SoundEffectsApp = class _SoundEffectsApp {
  constructor(engine, socket) {
    __publicField(this, "engine");
    __publicField(this, "socket");
    __publicField(this, "html", null);
    __publicField(this, "renderParent", null);
    __publicField(this, "isPedalKnobDragging", false);
    __publicField(this, "activeChannel", "music");
    __publicField(this, "selectedEffectType", null);
    __publicField(this, "constructorOpen", false);
    this.engine = engine;
    this.socket = socket;
  }
  setRenderCallback(callback) {
    this.renderParent = callback;
  }
  // ─────────────────────────────────────────────────────────────
  // Data Provider
  // ─────────────────────────────────────────────────────────────
  async getData() {
    try {
      const chain = this.engine.getChain(this.activeChannel);
      const effects = chain.getEffects();
      const pedals = effects.map((effect, index) => {
        const state = effect.getChainState();
        const mixPercent = Math.round(state.mix * 100);
        const mixRotation = state.mix * 270 - 135;
        const params = [];
        for (const [key, param] of effect.getAllParams()) {
          if (key === "level") continue;
          const fillPercent = param.type === "float" && param.min !== void 0 && param.max !== void 0 ? (Number(param.value) - param.min) / (param.max - param.min) * 100 : 50;
          params.push({
            id: param.id,
            name: param.name,
            type: param.type,
            value: param.value,
            displayValue: this.formatParamValue(param),
            fillPercent: Math.round(fillPercent),
            min: param.min,
            max: param.max,
            step: param.step,
            suffix: param.suffix,
            options: param.options
          });
        }
        return {
          type: state.type,
          enabled: state.enabled,
          mix: state.mix,
          mixPercent,
          mixRotation,
          chainIndex: index,
          selected: state.type === this.selectedEffectType,
          params
        };
      });
      const usedTypes = new Set(effects.map((e) => e.type));
      const availableEffects = ALL_EFFECT_TYPES.filter((t) => !usedTypes.has(t)).map((t) => {
        var _a2, _b;
        return {
          type: t,
          label: ((_a2 = EFFECT_META[t]) == null ? void 0 : _a2.label) || t,
          icon: ((_b = EFFECT_META[t]) == null ? void 0 : _b.icon) || "fa-circle"
        };
      });
      const allPresets = await GlobalStorage.loadPresets();
      const builtinPresets = allPresets.filter((p) => p.builtIn);
      const customPresets = allPresets.filter((p) => !p.builtIn);
      return {
        activeChannel: this.activeChannel,
        pedals,
        selectedEffect: pedals.find((p) => p.selected) || null,
        musicActiveCount: this.engine.getChain("music").getActiveCount(),
        ambienceActiveCount: this.engine.getChain("ambience").getActiveCount(),
        sfxActiveCount: this.engine.getChain("sfx").getActiveCount(),
        builtinPresets,
        customPresets,
        availableEffects,
        constructorOpen: this.constructorOpen,
        chainBypassed: chain.isBypassed
      };
    } catch (error) {
      Logger.error("SoundEffectsApp getData failed:", error);
      return {
        activeChannel: this.activeChannel,
        pedals: [],
        selectedEffect: null,
        musicActiveCount: 0,
        ambienceActiveCount: 0,
        sfxActiveCount: 0,
        builtinPresets: [...BUILTIN_PRESETS],
        customPresets: [],
        availableEffects: ALL_EFFECT_TYPES.map((t) => {
          var _a2, _b;
          return {
            type: t,
            label: ((_a2 = EFFECT_META[t]) == null ? void 0 : _a2.label) || t,
            icon: ((_b = EFFECT_META[t]) == null ? void 0 : _b.icon) || "fa-circle"
          };
        }),
        constructorOpen: this.constructorOpen,
        chainBypassed: false
        // Fallback
      };
    }
  }
  formatParamValue(param) {
    if (param.type === "select") return String(param.value);
    if (param.type === "boolean") return param.value ? game.i18n.localize("ASE.UI.Common.On") : game.i18n.localize("ASE.UI.Common.Off");
    const num = Number(param.value);
    const formatted = Number.isInteger(num) ? num.toString() : num.toFixed(2);
    return param.suffix ? `${formatted}${param.suffix}` : formatted;
  }
  // ─────────────────────────────────────────────────────────────
  // Event Listeners
  // ─────────────────────────────────────────────────────────────
  activateListeners(html) {
    this.html = html;
    html.off("click", ".ase-channel-tab").on("click", ".ase-channel-tab", (e) => this.onChannelSwitch(e));
    html.off("click", '[data-action="toggle-chain-bypass"]').on("click", '[data-action="toggle-chain-bypass"]', (e) => this.onToggleChainBypass(e));
    html.off("click", ".ase-pedal-card").on("click", ".ase-pedal-card", (e) => this.onPedalSelect(e));
    html.off("click", ".ase-pedal-footswitch").on("click", ".ase-pedal-footswitch", (e) => {
      e.stopPropagation();
      this.onToggleBypass(e);
    });
    html.off("click", ".ase-pedal-remove").on("click", ".ase-pedal-remove", (e) => {
      e.stopPropagation();
      this.onRemoveEffect(e);
    });
    html.off("click", '[data-action="open-constructor"]').on("click", '[data-action="open-constructor"]', () => this.onOpenConstructor());
    html.off("click", '[data-action="close-constructor"]').on("click", '[data-action="close-constructor"]', () => this.onCloseConstructor());
    html.off("click", '[data-action="add-effect"]').on("click", '[data-action="add-effect"]', (e) => this.onAddEffect(e));
    html.find(".ase-pedal-knob, .ase-pedal-knob *").prop("draggable", false);
    html.find(".ase-pedal-knob-area, .ase-pedal-knob-area *").on("dragstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    html.find(".ase-pedal-knob").on("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onKnobDrag(e, "pedal");
    });
    html.find(".ase-detail-knob").on("mousedown", (e) => this.onKnobDrag(e, "detail"));
    html.find(".ase-detail-slider").on("input", (e) => this.onDetailParamSlider(e));
    html.off("click", ".ase-seg-btn").on("click", ".ase-seg-btn", (e) => this.onDetailParamSelect(e));
    html.find("#ase-preset-select").on("change", (e) => this.onLoadPreset(e));
    html.off("click", '[data-action="save-preset"]').on("click", '[data-action="save-preset"]', (e) => this.onSavePreset(e));
    html.off("click", '[data-action="reset-chain"]').on("click", '[data-action="reset-chain"]', (e) => this.onResetChain(e));
    this.initDragAndDrop(html);
    if (this.engine.getChain(this.activeChannel).isBypassed) {
      html.find(".ase-effects-layout").addClass("chain-bypassed");
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Channel Switch
  // ─────────────────────────────────────────────────────────────
  onChannelSwitch(event) {
    var _a2;
    event.preventDefault();
    const channel = $(event.currentTarget).data("channel");
    if (channel === this.activeChannel) return;
    this.activeChannel = channel;
    this.selectedEffectType = null;
    this.constructorOpen = false;
    (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
  }
  // ─────────────────────────────────────────────────────────────
  // Master Chain Bypass
  // ─────────────────────────────────────────────────────────────
  onToggleChainBypass(event) {
    var _a2;
    event.preventDefault();
    const chain = this.engine.getChain(this.activeChannel);
    const newState = !chain.isBypassed;
    this.engine.toggleChainBypass(this.activeChannel, newState);
    this.socket.broadcastFullState();
    (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
  }
  // ─────────────────────────────────────────────────────────────
  // Pedal Select
  // ─────────────────────────────────────────────────────────────
  onPedalSelect(event) {
    var _a2;
    const effectType = $(event.currentTarget).data("effect-type");
    if (this.selectedEffectType === effectType) {
      this.selectedEffectType = null;
    } else {
      this.selectedEffectType = effectType;
    }
    (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
  }
  // ─────────────────────────────────────────────────────────────
  // Footswitch (Bypass Toggle)
  // ─────────────────────────────────────────────────────────────
  onToggleBypass(event) {
    var _a2;
    const $card = $(event.currentTarget).closest(".ase-pedal-card");
    const effectType = $card.data("effect-type");
    const wasActive = $card.hasClass("active");
    const newEnabled = !wasActive;
    this.engine.setChainEffectEnabled(this.activeChannel, effectType, newEnabled);
    this.socket.broadcastEffectEnabled(this.activeChannel, effectType, newEnabled);
    (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
  }
  // ─────────────────────────────────────────────────────────────
  // Remove Effect
  // ─────────────────────────────────────────────────────────────
  onRemoveEffect(event) {
    var _a2;
    const $card = $(event.currentTarget).closest(".ase-pedal-card");
    const effectType = $card.data("effect-type");
    this.engine.removeChainEffect(this.activeChannel, effectType);
    if (this.selectedEffectType === effectType) {
      this.selectedEffectType = null;
    }
    const newOrder = this.engine.getChain(this.activeChannel).getOrder();
    this.socket.broadcastChainReorder(this.activeChannel, newOrder);
    (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
  }
  // ─────────────────────────────────────────────────────────────
  // Constructor Panel (Add Effects)
  // ─────────────────────────────────────────────────────────────
  onOpenConstructor() {
    var _a2;
    this.constructorOpen = true;
    (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
  }
  onCloseConstructor() {
    var _a2;
    this.constructorOpen = false;
    (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
  }
  onAddEffect(event) {
    var _a2;
    const effectType = $(event.currentTarget).data("effect-type");
    this.engine.addChainEffect(this.activeChannel, effectType);
    const newOrder = this.engine.getChain(this.activeChannel).getOrder();
    this.socket.broadcastChainReorder(this.activeChannel, newOrder);
    this.selectedEffectType = effectType;
    const chain = this.engine.getChain(this.activeChannel);
    const usedTypes = new Set(chain.getEffects().map((e) => e.type));
    const remaining = ALL_EFFECT_TYPES.filter((t) => !usedTypes.has(t));
    if (remaining.length === 0) {
      this.constructorOpen = false;
    }
    (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
  }
  // ─────────────────────────────────────────────────────────────
  // Knob Drag (shared for pedal & detail mix knobs)
  // ─────────────────────────────────────────────────────────────
  onKnobDrag(event, source) {
    const $knob = $(event.currentTarget);
    const restorePedalDraggable = /* @__PURE__ */ __name(() => {
      if (this.html) {
        this.html.find(".ase-pedal-card").prop("draggable", true);
      }
    }, "restorePedalDraggable");
    if (source === "pedal") {
      this.isPedalKnobDragging = true;
      if (this.html) {
        this.html.find(".ase-pedal-card").prop("draggable", false);
      }
    }
    let effectType;
    if (source === "pedal") {
      effectType = $knob.closest(".ase-pedal-card").data("effect-type");
    } else {
      if (!this.selectedEffectType) return;
      effectType = this.selectedEffectType;
    }
    const chain = this.engine.getChain(this.activeChannel);
    const effect = chain.getEffect(effectType);
    if (!effect) {
      if (source === "pedal") {
        this.isPedalKnobDragging = false;
        restorePedalDraggable();
      }
      return;
    }
    const startY = event.pageY;
    let currentMix = effect.mix;
    const onMouseMove = /* @__PURE__ */ __name((moveEvent) => {
      const pageY = moveEvent.pageY || moveEvent.originalEvent.pageY;
      const deltaY = startY - pageY;
      const sensitivity = 5e-3;
      const newMix = Math.max(0, Math.min(1, currentMix + deltaY * sensitivity));
      const rotation = newMix * 270 - 135;
      if (this.html) {
        const $pedalCard = this.html.find(`.ase-pedal-card[data-effect-type="${effectType}"]`);
        $pedalCard.find(".ase-pedal-knob").css("--knob-rotation", `${rotation}deg`);
        $pedalCard.find(".ase-pedal-mix-value").text(`${Math.round(newMix * 100)}%`);
        this.html.find(".ase-detail-knob").css("--knob-rotation", `${rotation}deg`);
        this.html.find(".ase-detail-knob-label").text(`MIX ${Math.round(newMix * 100)}%`);
      }
      this.engine.setChainEffectMix(this.activeChannel, effectType, newMix);
      this.socket.broadcastChainEffectMix(this.activeChannel, effectType, newMix);
    }, "onMouseMove");
    const onMouseUp = /* @__PURE__ */ __name(() => {
      $(document).off("mousemove", onMouseMove);
      $(document).off("mouseup", onMouseUp);
      if (source === "pedal") {
        this.isPedalKnobDragging = false;
        restorePedalDraggable();
      }
    }, "onMouseUp");
    $(document).on("mousemove", onMouseMove);
    $(document).on("mouseup", onMouseUp);
  }
  // ─────────────────────────────────────────────────────────────
  // Detail Panel: Param Slider
  // ─────────────────────────────────────────────────────────────
  onDetailParamSlider(event) {
    if (!this.selectedEffectType) return;
    const $input = $(event.currentTarget);
    const paramId = $input.data("param-id");
    const value = parseFloat($input.val());
    this.engine.setChainEffectParam(this.activeChannel, this.selectedEffectType, paramId, value);
    this.socket.broadcastEffectParam(this.activeChannel, this.selectedEffectType, paramId, value);
    const suffix = $input.data("suffix") || "";
    const $row = $input.closest(".ase-detail-param-row");
    const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(2);
    $row.find(".ase-detail-param-value").text(`${formatted}${suffix}`);
    const min = parseFloat($input.attr("min") || "0");
    const max = parseFloat($input.attr("max") || "1");
    const fill = (value - min) / (max - min) * 100;
    $input.css("--slider-fill", `${fill}%`);
  }
  // ─────────────────────────────────────────────────────────────
  // Detail Panel: Select Param (segmented buttons)
  // ─────────────────────────────────────────────────────────────
  onDetailParamSelect(event) {
    event.preventDefault();
    if (!this.selectedEffectType) return;
    const $btn = $(event.currentTarget);
    const paramId = $btn.data("param-id");
    const value = $btn.data("value");
    this.engine.setChainEffectParam(this.activeChannel, this.selectedEffectType, paramId, value);
    this.socket.broadcastEffectParam(this.activeChannel, this.selectedEffectType, paramId, value);
    $btn.siblings().removeClass("active");
    $btn.addClass("active");
    const $row = $btn.closest(".ase-detail-param-row");
    $row.find(".ase-detail-param-value").text(value);
  }
  // ─────────────────────────────────────────────────────────────
  // Drag and Drop Reorder
  // ─────────────────────────────────────────────────────────────
  initDragAndDrop(html) {
    const $pedalboard = html.find(".ase-pedalboard");
    if (!$pedalboard.length) return;
    const rootEl = html.get(0);
    if (rootEl) {
      rootEl.addEventListener("dragstart", (e) => {
        const target = e.target;
        if (this.isPedalKnobDragging || Boolean(target == null ? void 0 : target.closest(".ase-pedal-knob-area"))) {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);
    }
    let draggedType = null;
    let draggedIndex = -1;
    html.find(".ase-pedal-card").each((_, el) => {
      const cardEl = el;
      let blockNextDragFromKnob = false;
      cardEl.addEventListener("mousedown", (e) => {
        const target = e.target;
        blockNextDragFromKnob = Boolean(target == null ? void 0 : target.closest(".ase-pedal-knob-area"));
        if (blockNextDragFromKnob) {
          cardEl.draggable = false;
        } else if (!this.isPedalKnobDragging) {
          cardEl.draggable = true;
        }
      }, true);
      el.addEventListener("dragstart", (e) => {
        const dragTarget = e.target;
        if (this.isPedalKnobDragging || blockNextDragFromKnob || !cardEl.draggable || Boolean(dragTarget == null ? void 0 : dragTarget.closest(".ase-pedal-knob-area"))) {
          e.preventDefault();
          return;
        }
        if (!e.dataTransfer) return;
        draggedType = el.dataset.effectType || null;
        draggedIndex = parseInt(el.dataset.chainIndex || "-1", 10);
        e.dataTransfer.setData("text/plain", JSON.stringify({
          effectType: draggedType,
          chainIndex: draggedIndex
        }));
        e.dataTransfer.effectAllowed = "move";
        const ghost = el.cloneNode(true);
        ghost.style.position = "absolute";
        ghost.style.top = "-9999px";
        ghost.classList.add("ase-drag-ghost");
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 80, 115);
        requestAnimationFrame(() => ghost.remove());
        $(el).addClass("dragging");
        $pedalboard.addClass("drag-active");
        html.find(".ase-drop-zone").each((_2, z) => {
          const dropIdx = parseInt(z.dataset.dropIndex || "0", 10);
          if (draggedIndex >= 0 && (dropIdx === draggedIndex || dropIdx === draggedIndex + 1)) {
            $(z).addClass("no-op");
          }
        });
      });
      el.addEventListener("dragend", () => {
        blockNextDragFromKnob = false;
        cardEl.draggable = true;
        $(el).removeClass("dragging");
        $pedalboard.removeClass("drag-active");
        html.find(".ase-drop-zone").removeClass("drag-over no-op");
        draggedType = null;
        draggedIndex = -1;
      });
    });
    html.find(".ase-drop-zone").each((_, zone) => {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        const dropIndex = parseInt(zone.dataset.dropIndex || "0", 10);
        if (draggedIndex >= 0 && (dropIndex === draggedIndex || dropIndex === draggedIndex + 1)) {
          return;
        }
        html.find(".ase-drop-zone").not(zone).removeClass("drag-over");
        $(zone).addClass("drag-over");
      });
      zone.addEventListener("dragleave", (e) => {
        const related = e.relatedTarget;
        if (related && zone.contains(related)) return;
        $(zone).removeClass("drag-over");
      });
      zone.addEventListener("drop", (e) => {
        var _a2;
        e.preventDefault();
        $pedalboard.removeClass("drag-active");
        html.find(".ase-drop-zone").removeClass("drag-over no-op");
        if (!e.dataTransfer) return;
        const data = JSON.parse(e.dataTransfer.getData("text/plain"));
        const fromIndex = parseInt(data.chainIndex, 10);
        const toIndex = parseInt(zone.dataset.dropIndex || "0", 10);
        if (fromIndex === toIndex || fromIndex === toIndex - 1) return;
        const adjustedTo = fromIndex < toIndex ? toIndex - 1 : toIndex;
        this.engine.reorderChainEffect(this.activeChannel, fromIndex, adjustedTo);
        const newOrder = this.engine.getChain(this.activeChannel).getOrder();
        this.socket.broadcastChainReorder(this.activeChannel, newOrder);
        (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
      });
    });
  }
  // ─────────────────────────────────────────────────────────────
  // Presets
  // ─────────────────────────────────────────────────────────────
  async onLoadPreset(event) {
    var _a2;
    const presetId = $(event.currentTarget).val();
    if (!presetId) return;
    const allPresets = await GlobalStorage.loadPresets();
    const preset = allPresets.find((p) => p.id === presetId);
    if (!preset || !preset.chains) return;
    for (const chainState of preset.chains) {
      const chain = this.engine.getChain(chainState.channel);
      if (chain) {
        chain.restoreState(chainState);
      }
    }
    this.socket.broadcastFullState();
    (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
    $(event.currentTarget).val("");
  }
  async onSavePreset(event) {
    event.preventDefault();
    const content = `
            <div class="form-group">
                <label>${game.i18n.localize("ASE.UI.Effects.PresetName")}</label>
                <input type="text" name="name" placeholder="${game.i18n.localize("ASE.UI.Effects.MyCustomPreset")}"/>
            </div>
            <div class="form-group">
                <label>${game.i18n.localize("ASE.UI.Effects.DescriptionOptional")}</label>
                <input type="text" name="description" placeholder="${game.i18n.localize("ASE.UI.Effects.ShortDescription")}"/>
            </div>
        `;
    new Dialog({
      title: game.i18n.localize("ASE.UI.Effects.SaveEffectPreset"),
      content,
      buttons: {
        save: {
          label: game.i18n.localize("ASE.UI.Actions.Save"),
          callback: /* @__PURE__ */ __name(async (html) => {
            var _a2;
            const name = html.find('input[name="name"]').val();
            if (!name) return;
            const description = html.find('input[name="description"]').val();
            const newPreset = {
              id: `custom-${Date.now()}`,
              name,
              description: description || void 0,
              builtIn: false,
              chains: this.engine.getAllChainsState()
            };
            const allPresets = await GlobalStorage.loadPresets();
            allPresets.push(newPreset);
            await GlobalStorage.savePresets(allPresets);
            (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
          }, "callback")
        }
      }
    }).render(true);
  }
  onResetChain(event) {
    var _a2;
    event.preventDefault();
    const chain = this.engine.getChain(this.activeChannel);
    chain.buildDefault();
    this.selectedEffectType = null;
    this.constructorOpen = false;
    this.socket.broadcastFullState();
    (_a2 = this.renderParent) == null ? void 0 : _a2.call(this);
  }
  // ─────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────
  destroy() {
    this.html = null;
  }
};
__name(_SoundEffectsApp, "SoundEffectsApp");
let SoundEffectsApp = _SoundEffectsApp;
const MODULE_ID$3 = "sound-engine-master";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const _AdvancedSoundEngineApp = class _AdvancedSoundEngineApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(engine, socket, libraryManager2, queueManager2, options = {}) {
    super(options);
    __publicField(this, "engine");
    __publicField(this, "socket");
    __publicField(this, "libraryManager");
    __publicField(this, "queueManager");
    // Sub-apps (Controllers)
    __publicField(this, "libraryApp");
    __publicField(this, "mixerApp");
    __publicField(this, "effectsApp");
    // Stored callback for cleanup
    __publicField(this, "_onQueueChangeBound");
    __publicField(this, "state", {
      activeTab: "library",
      // Default to library as per user focus
      syncEnabled: false
    });
    // Unified Scroll State Store
    __publicField(this, "scrollStates", {
      library: {
        ".ase-track-player-list": 0,
        ".ase-list-group": 0,
        // Playlists list
        ".ase-favorites-section .ase-list-group": 0
        // Favorites
      },
      mixer: {
        '[data-section="mixer-queue"]': 0,
        '[data-section="mixer-favorites"]': 0
      },
      sfx: {
        ".ase-effects-layout": 0
      },
      online: {}
    });
    this.engine = engine;
    this.socket = socket;
    this.libraryManager = libraryManager2;
    this.queueManager = queueManager2;
    this.libraryApp = new LocalLibraryApp(this.libraryManager, this);
    this.mixerApp = new SoundMixerApp(this.engine, this.socket, this.libraryManager, this.queueManager);
    this.effectsApp = new SoundEffectsApp(this.engine, this.socket);
    this.mixerApp.setRenderCallback(() => {
      if (this.state.activeTab === "mixer") {
        this.captureScroll();
        this.render({ parts: ["main"] });
      }
    });
    this.effectsApp.setRenderCallback(() => {
      if (this.state.activeTab === "sfx") {
        this.captureScroll();
        this.render({ parts: ["main"] });
      }
    });
    this._onQueueChangeBound = () => {
      if (this.state.activeTab === "mixer") {
        this.captureScroll();
        this.render({ parts: ["main"] });
      }
    };
    this.queueManager.on("change", this._onQueueChangeBound);
    const savedLocalVol = localStorage.getItem("ase-gm-local-volume");
    if (savedLocalVol !== null) {
      this.engine.setLocalVolume(parseFloat(savedLocalVol));
    }
  }
  /**
   * V2 Context Preparation (replaces getData)
   */
  async _prepareContext(options) {
    var _a2, _b, _c;
    const moduleVersion = ((_c = (_b = (_a2 = globalThis.game) == null ? void 0 : _a2.modules) == null ? void 0 : _b.get(MODULE_ID$3)) == null ? void 0 : _c.version) ?? "0.0.0";
    const volumes = this.engine.volumes;
    const getChannelStatus = /* @__PURE__ */ __name((group) => {
      const tracks = this.engine.getTracksByGroup(group);
      if (tracks.length === 0) return { playing: false, paused: false };
      const isPlaying = tracks.some((t) => t.state === "playing");
      const isPaused = tracks.some((t) => t.state === "paused");
      return { playing: isPlaying, paused: isPaused && !isPlaying };
    }, "getChannelStatus");
    const status = {
      music: getChannelStatus("music"),
      ambience: getChannelStatus("ambience"),
      sfx: getChannelStatus("sfx")
    };
    const renderTemplate = globalThis.renderTemplate;
    let tabContent = "";
    if (this.state.activeTab === "library") {
      const libData = await this.libraryApp.getData();
      tabContent = await renderTemplate("modules/sound-engine-master/templates/library.hbs", libData);
    } else if (this.state.activeTab === "mixer") {
      const mixerData = await this.mixerApp.getData();
      tabContent = await renderTemplate(`modules/${MODULE_ID$3}/templates/mixer.hbs`, mixerData);
    } else if (this.state.activeTab === "sfx") {
      Logger.info(`[AdvancedSoundEngineApp] Rendering SFX tab...`);
      const effectsData = await this.effectsApp.getData();
      tabContent = await renderTemplate(`modules/${MODULE_ID$3}/templates/effects.hbs`, effectsData);
    }
    return {
      activeTab: this.state.activeTab,
      tabContent,
      status,
      volumes: {
        master: Math.round(volumes.master * 100),
        music: Math.round(volumes.music * 100),
        ambience: Math.round(volumes.ambience * 100),
        sfx: Math.round(volumes.sfx * 100),
        local: Math.round(this.engine.localVolume * 100)
      },
      syncEnabled: this.socket.syncEnabled,
      // Pass state for Handlebars if needed
      tabs: [
        { id: "library", label: game.i18n.localize("ASE.UI.Tabs.Library"), icon: "fas fa-book-open", active: this.state.activeTab === "library" },
        { id: "mixer", label: game.i18n.localize("ASE.UI.Tabs.Mixer"), icon: "fas fa-sliders-h", active: this.state.activeTab === "mixer" },
        { id: "sfx", label: game.i18n.localize("ASE.UI.Tabs.Effects"), icon: "fas fa-wave-square", active: this.state.activeTab === "sfx" },
        { id: "online", label: game.i18n.localize("ASE.UI.Tabs.Online"), icon: "fas fa-globe", active: this.state.activeTab === "online" }
      ],
      moduleVersion
    };
  }
  /**
   * V2 Render Hook (replaces activateListeners)
   * Note: In V2, `this.element` is the HTML element itself, not a jQuery object.
   * However, we wrap it in jQuery for compatibility with existing listener logic if preferred, 
   * or use vanilla JS. Sticking to jQuery for now to minimize logic rewrite risks.
   */
  _onRender(context, options) {
    Logger.info(`[AdvancedSoundEngineApp] _onRender called. Active Tab: ${this.state.activeTab}`);
    super._onRender(context, options);
    const html = $(this.element);
    html.find(".ase-tab").on("click", this.onTabSwitch.bind(this));
    html.find('[data-action="toggle-sync"]').on("click", this.onToggleSync.bind(this));
    html.find('[data-action="global-play"]').on("click", this.onGlobalPlay.bind(this));
    html.find('[data-action="global-pause"]').on("click", this.onGlobalPause.bind(this));
    html.find('[data-action="global-stop"]').on("click", this.onGlobalStop.bind(this));
    html.find(".ase-volume-slider").on("input", this.onVolumeInput.bind(this));
    if (this.state.activeTab === "library") {
      this.libraryApp.activateListeners(html);
    } else if (this.state.activeTab === "mixer") {
      this.mixerApp.activateListeners(html);
    } else if (this.state.activeTab === "sfx") {
      Logger.info("[AdvancedSoundEngineApp] Delegating to effectsApp.activateListeners");
      this.effectsApp.activateListeners(html);
    }
    this.restoreScroll();
  }
  /**
   * V2 Close Hook — cleanup all sub-apps and event subscriptions
   */
  _onClose(options) {
    super._onClose(options);
    this.mixerApp.dispose();
    this.effectsApp.destroy();
    this.libraryApp.close();
    this.queueManager.off("change", this._onQueueChangeBound);
    Logger.info("[AdvancedSoundEngineApp] Closed and cleaned up");
  }
  // ─────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────
  async onTabSwitch(event) {
    event.preventDefault();
    const tabName = $(event.currentTarget).data("tab");
    if (this.state.activeTab === tabName) return;
    this.captureScroll();
    this.state.activeTab = tabName;
    this.render({ parts: ["main"] });
  }
  /**
   * Resets the scroll state for a specific tab to 0.
   * Use this when changing filters or view context where the user expects to start from the top.
   */
  resetScroll(tabName) {
    const targetTab = tabName || this.state.activeTab;
    const map = this.scrollStates[targetTab];
    if (!map) return;
    for (const selector of Object.keys(map)) {
      map[selector] = 0;
    }
  }
  /**
   * Captures the current scroll positions for the ACTIVE tab.
   * Call this before any operation that might trigger a re-render.
   */
  captureScroll() {
    const activeTab = this.state.activeTab;
    const html = $(this.element);
    const map = this.scrollStates[activeTab];
    if (!map) return;
    for (const selector of Object.keys(map)) {
      const el = html.find(selector);
      if (el.length) {
        const scrollTop = el.scrollTop() || 0;
        map[selector] = scrollTop;
      }
    }
  }
  /**
   * Restores scroll positions for the ACTIVE tab.
   * called automatically in _onRender.
   */
  restoreScroll() {
    const activeTab = this.state.activeTab;
    const html = $(this.element);
    const map = this.scrollStates[activeTab];
    if (!map) return;
    for (const [selector, scrollTop] of Object.entries(map)) {
      const el = html.find(selector);
      if (el.length) {
        el.scrollTop(scrollTop);
      }
    }
  }
  onToggleSync(event) {
    var _a2, _b, _c;
    const enabled = !this.socket.syncEnabled;
    this.socket.setSyncEnabled(enabled);
    this.state.syncEnabled = enabled;
    (_c = (_b = (_a2 = window.ASE) == null ? void 0 : _a2.volumeHud) == null ? void 0 : _b.updateSyncState) == null ? void 0 : _c.call(_b, enabled);
    this.render();
  }
  async onGlobalPlay() {
    this.engine.resume();
    const tracks = this.engine.getAllTracks();
    for (const track of tracks) {
      if (track.state === "paused") {
        const offset = track.getCurrentTime();
        await track.play(offset);
        if (this.socket.syncEnabled) {
          this.socket.broadcastTrackPlay(track.id, offset);
        }
      }
    }
    Logger.debug("Global Play/Resume Clicked");
    this.render();
  }
  onGlobalPause() {
    const tracks = this.engine.getAllTracks();
    for (const track of tracks) {
      if (track.state === "playing") {
        const currentTime = track.getCurrentTime();
        track.pause();
        if (this.socket.syncEnabled) {
          this.socket.broadcastTrackPause(track.id, currentTime);
        }
      }
    }
    Logger.debug("Global Pause Clicked");
    this.render();
  }
  onGlobalStop() {
    this.engine.stopAll();
    this.render();
  }
  onVolumeInput(event) {
    const input = event.currentTarget;
    const value = parseFloat(input.value) / 100;
    const $input = $(input);
    const channel = $input.data("channel");
    const type = $input.data("type");
    if (channel) {
      this.engine.setChannelVolume(channel, value);
      this.socket.broadcastChannelVolume(channel, value);
      $input.siblings(".ase-percentage").text(`${Math.round(value * 100)}%`);
    } else if (type === "local") {
      this.engine.setLocalVolume(value);
      localStorage.setItem("ase-gm-local-volume", value.toString());
      $input.siblings(".ase-local-perc").text(`${Math.round(value * 100)}%`);
    } else {
      this.engine.setMasterVolume(value);
      this.socket.broadcastChannelVolume("master", value);
      $input.siblings(".ase-master-perc").text(`${Math.round(value * 100)}%`);
    }
  }
};
__name(_AdvancedSoundEngineApp, "AdvancedSoundEngineApp");
/**
 * Define the templates used by this application.
 * In V2, we define parts rather than a single template.
 */
__publicField(_AdvancedSoundEngineApp, "PARTS", {
  main: {
    template: `modules/${MODULE_ID$3}/templates/main-app.hbs`,
    scrollable: [".ase-content-body"]
  }
});
__publicField(_AdvancedSoundEngineApp, "DEFAULT_OPTIONS", {
  id: "sound-engine-master-app",
  tag: "form",
  window: {
    title: "ASE.Title",
    icon: "fas fa-music",
    resizable: true,
    controls: []
  },
  position: {
    width: 1440,
    height: 1050
  },
  classes: ["ase-window-layout"]
});
let AdvancedSoundEngineApp = _AdvancedSoundEngineApp;
function debounce(fn, delay) {
  let timeoutId = null;
  return function(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}
__name(debounce, "debounce");
const _PlaylistManager = class _PlaylistManager {
  constructor(onChangeCallback) {
    __publicField(this, "playlists", /* @__PURE__ */ new Map());
    __publicField(this, "onChangeCallback");
    this.onChangeCallback = onChangeCallback;
  }
  /**
   * Notify about changes (triggers save)
   */
  notifyChange() {
    if (this.onChangeCallback) {
      this.onChangeCallback();
    }
  }
  // ─────────────────────────────────────────────────────────────
  // CRUD Operations - Playlists
  // ─────────────────────────────────────────────────────────────
  /**
   * Create new playlist
   */
  createPlaylist(name, description) {
    const existing = this.findByName(name);
    if (existing) {
      throw new Error(`Playlist with name "${name}" already exists`);
    }
    const now = Date.now();
    const playlist = {
      id: generateUUID(),
      name,
      description,
      items: [],
      createdAt: now,
      updatedAt: now,
      favorite: false,
      playbackMode: "loop"
    };
    this.playlists.set(playlist.id, playlist);
    this.notifyChange();
    Logger.info(`Playlist created: ${playlist.name} (${playlist.id})`);
    return playlist;
  }
  /**
   * Update playlist metadata
   */
  updatePlaylist(id, updates) {
    const playlist = this.playlists.get(id);
    if (!playlist) {
      throw new Error(`Playlist not found: ${id}`);
    }
    if (updates.name && updates.name !== playlist.name) {
      const existing = this.findByName(updates.name);
      if (existing && existing.id !== id) {
        throw new Error(`Playlist with name "${updates.name}" already exists`);
      }
    }
    const updated = {
      ...playlist,
      ...updates,
      updatedAt: Date.now()
    };
    this.playlists.set(id, updated);
    this.notifyChange();
    Logger.info(`Playlist updated: ${updated.name}`);
    return updated;
  }
  /**
   * Delete playlist
   */
  deletePlaylist(id) {
    const playlist = this.playlists.get(id);
    if (!playlist) {
      throw new Error(`Playlist not found: ${id}`);
    }
    this.playlists.delete(id);
    this.notifyChange();
    Logger.info(`Playlist deleted: ${playlist.name}`);
  }
  /**
   * Get playlist by ID
   */
  getPlaylist(id) {
    return this.playlists.get(id);
  }
  /**
   * Get all playlists
   */
  getAllPlaylists() {
    return Array.from(this.playlists.values());
  }
  /**
   * Find playlist by name
   */
  findByName(name) {
    return Array.from(this.playlists.values()).find((p) => p.name === name);
  }
  /**
   * Get favorite playlists
   */
  getFavoritePlaylists() {
    return this.getAllPlaylists().filter((p) => p.favorite);
  }
  /**
   * Reorder playlists based on new order array of IDs
   */
  reorderPlaylists(orderedIds) {
    const newMap = /* @__PURE__ */ new Map();
    orderedIds.forEach((id) => {
      const playlist = this.playlists.get(id);
      if (playlist) {
        newMap.set(id, playlist);
      }
    });
    this.playlists.forEach((playlist, id) => {
      if (!newMap.has(id)) {
        newMap.set(id, playlist);
      }
    });
    this.playlists = newMap;
    this.notifyChange();
    Logger.info("Playlists reordered");
  }
  /**
   * Toggle playlist favorite status
   */
  togglePlaylistFavorite(id) {
    const playlist = this.getPlaylist(id);
    if (!playlist) {
      throw new Error(`Playlist not found: ${id}`);
    }
    playlist.favorite = !playlist.favorite;
    playlist.updatedAt = Date.now();
    this.notifyChange();
    return playlist.favorite;
  }
  // ─────────────────────────────────────────────────────────────
  // CRUD Operations - Playlist Items
  // ─────────────────────────────────────────────────────────────
  /**
   * Add track to playlist
   */
  addTrackToPlaylist(playlistId, libraryItemId, group, options) {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }
    const exists = playlist.items.find((item2) => item2.libraryItemId === libraryItemId);
    if (exists) {
      throw new Error("Track already exists in this playlist");
    }
    const item = {
      id: generateUUID(),
      libraryItemId,
      group,
      volume: (options == null ? void 0 : options.volume) ?? 1,
      order: playlist.items.length,
      fadeIn: options == null ? void 0 : options.fadeIn,
      fadeOut: options == null ? void 0 : options.fadeOut
    };
    playlist.items.push(item);
    playlist.updatedAt = Date.now();
    this.notifyChange();
    Logger.debug(`Track added to playlist ${playlist.name}: ${libraryItemId}`);
    return item;
  }
  /**
   * Remove track from playlist
   */
  removeTrackFromPlaylist(playlistId, playlistItemId) {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }
    const index = playlist.items.findIndex((item) => item.id === playlistItemId);
    if (index === -1) {
      throw new Error(`Playlist item not found: ${playlistItemId}`);
    }
    playlist.items.splice(index, 1);
    this.reorderPlaylistItems(playlist);
    playlist.updatedAt = Date.now();
    this.notifyChange();
    Logger.debug(`Track removed from playlist ${playlist.name}`);
  }
  /**
   * Remove all tracks with specific library item ID from playlist
   */
  removeLibraryItemFromPlaylist(playlistId, libraryItemId) {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }
    const initialLength = playlist.items.length;
    playlist.items = playlist.items.filter((item) => item.libraryItemId !== libraryItemId);
    const removed = initialLength - playlist.items.length;
    if (removed > 0) {
      this.reorderPlaylistItems(playlist);
      playlist.updatedAt = Date.now();
      this.notifyChange();
      Logger.debug(`Removed ${removed} instances of library item ${libraryItemId} from playlist ${playlist.name}`);
    }
    return removed;
  }
  /**
   * Remove library item from all playlists
   */
  removeLibraryItemFromAllPlaylists(libraryItemId) {
    let totalRemoved = 0;
    this.playlists.forEach((playlist) => {
      const initialLength = playlist.items.length;
      playlist.items = playlist.items.filter((item) => item.libraryItemId !== libraryItemId);
      const removed = initialLength - playlist.items.length;
      if (removed > 0) {
        this.reorderPlaylistItems(playlist);
        playlist.updatedAt = Date.now();
        totalRemoved += removed;
      }
    });
    if (totalRemoved > 0) {
      this.notifyChange();
      Logger.info(`Removed library item ${libraryItemId} from ${totalRemoved} playlist(s)`);
    }
    return totalRemoved;
  }
  /**
   * Update playlist item
   */
  updatePlaylistItem(playlistId, playlistItemId, updates) {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }
    const item = playlist.items.find((i) => i.id === playlistItemId);
    if (!item) {
      throw new Error(`Playlist item not found: ${playlistItemId}`);
    }
    Object.assign(item, updates);
    playlist.updatedAt = Date.now();
    this.notifyChange();
    Logger.debug(`Playlist item updated in ${playlist.name}`);
    return item;
  }
  /**
   * Reorder track in playlist
   */
  reorderTrack(playlistId, playlistItemId, newOrder) {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }
    const itemIndex = playlist.items.findIndex((i) => i.id === playlistItemId);
    if (itemIndex === -1) {
      throw new Error(`Playlist item not found: ${playlistItemId}`);
    }
    if (newOrder < 0 || newOrder >= playlist.items.length) {
      throw new Error(`Invalid order: ${newOrder}`);
    }
    const [item] = playlist.items.splice(itemIndex, 1);
    playlist.items.splice(newOrder, 0, item);
    this.reorderPlaylistItems(playlist);
    playlist.updatedAt = Date.now();
    this.notifyChange();
    Logger.debug(`Track reordered in playlist ${playlist.name}`);
  }
  /**
   * Get tracks in playlist
   */
  getPlaylistTracks(playlistId) {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error(`Playlist not found: ${playlistId}`);
    }
    return [...playlist.items].sort((a, b) => a.order - b.order);
  }
  /**
   * Get playlists containing a specific library item
   */
  getPlaylistsContainingItem(libraryItemId) {
    return this.getAllPlaylists().filter(
      (playlist) => playlist.items.some((item) => item.libraryItemId === libraryItemId)
    );
  }
  // ─────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────
  /**
   * Load playlists from state object
   */
  load(playlistsData) {
    this.playlists.clear();
    Object.values(playlistsData).forEach((playlist) => {
      playlist.items.sort((a, b) => a.order - b.order);
      if (!playlist.playbackMode) {
        playlist.playbackMode = "loop";
      }
      this.playlists.set(playlist.id, playlist);
    });
    Logger.info(`PlaylistManager loaded: ${this.playlists.size} playlists`);
  }
  /**
   * Export playlists to state object
   */
  export() {
    return Object.fromEntries(this.playlists);
  }
  // ─────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────
  /**
   * Reorder playlist items to ensure consecutive order values
   */
  reorderPlaylistItems(playlist) {
    playlist.items.forEach((item, index) => {
      item.order = index;
    });
  }
  /**
   * Get statistics
   */
  getStats() {
    const playlists = this.getAllPlaylists();
    return {
      totalPlaylists: playlists.length,
      favoritePlaylists: playlists.filter((p) => p.favorite).length,
      totalTracks: playlists.reduce((sum, p) => sum + p.items.length, 0),
      averageTracksPerPlaylist: playlists.length > 0 ? Math.round(playlists.reduce((sum, p) => sum + p.items.length, 0) / playlists.length) : 0
    };
  }
  /**
   * Clear all playlists
   */
  clear() {
    this.playlists.clear();
    Logger.warn("All playlists cleared");
  }
};
__name(_PlaylistManager, "PlaylistManager");
let PlaylistManager = _PlaylistManager;
const MODULE_ID$2 = "sound-engine-master";
const LIBRARY_VERSION = 2;
const _LibraryManager = class _LibraryManager {
  constructor() {
    __publicField(this, "items", /* @__PURE__ */ new Map());
    __publicField(this, "customTags", /* @__PURE__ */ new Set());
    __publicField(this, "favoritesOrder", []);
    __publicField(this, "saveScheduled", false);
    __publicField(this, "playlists");
    __publicField(this, "storage");
    // New property to track if we've initiated a scan this session
    __publicField(this, "hasScannedDurations", false);
    __publicField(this, "debouncedSave", debounce(() => {
      this.saveToSettings();
    }, 500));
    this.storage = new GlobalStorage();
    this.playlists = new PlaylistManager(() => this.scheduleSave());
    this.loadFromSettings().catch((err) => Logger.error("Failed initial load:", err));
  }
  // ─────────────────────────────────────────────────────────────
  // CRUD Operations
  // ─────────────────────────────────────────────────────────────
  /**
   * Add new item to library
   */
  async addItem(url, name, group = "music", tags = []) {
    const validation = validateAudioFile(url);
    if (!validation.valid) {
      throw new Error(validation.error || "Invalid audio file");
    }
    const itemName = name || this.extractNameFromUrl(url);
    const existingByUrl = this.findByUrl(url);
    if (existingByUrl) {
      throw new Error(`Track with this URL already exists: ${existingByUrl.name}`);
    }
    const existingByName = this.findByName(itemName);
    if (existingByName) {
      throw new Error(`Track with name "${itemName}" already exists in library`);
    }
    const now = Date.now();
    const item = {
      id: generateUUID(),
      url,
      name: itemName,
      tags,
      group,
      duration: 0,
      favorite: false,
      playbackMode: "inherit",
      addedAt: now,
      updatedAt: now
    };
    const audio = new Audio(url);
    audio.addEventListener("loadedmetadata", () => {
      if (audio.duration && isFinite(audio.duration)) {
        item.duration = Math.round(audio.duration);
        this.scheduleSave();
        Logger.info(`Updated duration for ${item.name}: ${item.duration}s`);
      }
    });
    audio.addEventListener("error", (e) => {
      Logger.warn(`Failed to extract duration for ${item.name}:`, e);
    });
    this.items.set(item.id, item);
    this.scheduleSave();
    Logger.info(`Library item added: ${item.name} (${item.id})`);
    return item;
  }
  /**
   * Update existing item
   */
  updateItem(id, updates) {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Library item not found: ${id}`);
    }
    if (updates.name && updates.name !== item.name) {
      const existingByName = this.findByName(updates.name);
      if (existingByName && existingByName.id !== id) {
        throw new Error(`Track with name "${updates.name}" already exists`);
      }
    }
    if (updates.url && updates.url !== item.url) {
      const validation = validateAudioFile(updates.url);
      if (!validation.valid) {
        throw new Error(validation.error || "Invalid audio file");
      }
      const existingByUrl = this.findByUrl(updates.url);
      if (existingByUrl && existingByUrl.id !== id) {
        throw new Error(`Track with this URL already exists: ${existingByUrl.name}`);
      }
    }
    delete updates.id;
    const updated = {
      ...item,
      ...updates,
      updatedAt: Date.now()
    };
    this.items.set(id, updated);
    this.scheduleSave();
    Logger.info(`Library item updated: ${updated.name}`);
    return updated;
  }
  /**
   * Remove item from library
   */
  removeItem(id) {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Library item not found: ${id}`);
    }
    this.playlists.removeLibraryItemFromAllPlaylists(id);
    this.items.delete(id);
    this.scheduleSave();
    Logger.info(`Library item removed: ${item.name}`);
  }
  /**
   * Get item by ID
   */
  getItem(id) {
    return this.items.get(id);
  }
  /**
   * Get all items
   */
  getAllItems() {
    return Array.from(this.items.values());
  }
  // ─────────────────────────────────────────────────────────────
  // Search & Filter
  // ─────────────────────────────────────────────────────────────
  /**
   * Find item by URL
   */
  findByUrl(url) {
    return Array.from(this.items.values()).find((item) => item.url === url);
  }
  /**
   * Find item by name
   */
  findByName(name) {
    return Array.from(this.items.values()).find((item) => item.name === name);
  }
  /**
   * Search items by query
   */
  searchByName(query) {
    const lowerQuery = query.toLowerCase();
    return this.getAllItems().filter(
      (item) => item.name.toLowerCase().includes(lowerQuery)
    );
  }
  /**
   * Filter items by tags (OR logic)
   */
  filterByTags(tags) {
    if (tags.length === 0) return this.getAllItems();
    return this.getAllItems().filter(
      (item) => item.tags.some((tag) => tags.includes(tag))
    );
  }
  /**
   * Get favorite items (sorted by favoritesOrder)
   */
  getFavorites() {
    return this.getAllItems().filter((item) => item.favorite);
  }
  /**
   * Get ordered favorites list (tracks + playlists)
   */
  getOrderedFavorites() {
    const validFavorites = [];
    for (const entry of this.favoritesOrder) {
      if (entry.type === "track") {
        const item = this.items.get(entry.id);
        if (item && item.favorite) {
          validFavorites.push(entry);
        }
      } else {
        const playlist = this.playlists.getPlaylist(entry.id);
        if (playlist && playlist.favorite) {
          validFavorites.push(entry);
        }
      }
    }
    const inOrderSet = new Set(validFavorites.map((f) => `${f.type}:${f.id}`));
    for (const item of this.getAllItems()) {
      if (item.favorite && !inOrderSet.has(`track:${item.id}`)) {
        validFavorites.unshift({ id: item.id, type: "track", addedAt: Date.now() });
      }
    }
    for (const playlist of this.playlists.getFavoritePlaylists()) {
      if (!inOrderSet.has(`playlist:${playlist.id}`)) {
        validFavorites.unshift({ id: playlist.id, type: "playlist", addedAt: Date.now() });
      }
    }
    this.favoritesOrder = validFavorites;
    return validFavorites;
  }
  /**
   * Reorder favorites based on new order array
   */
  reorderFavorites(orderedItems) {
    const now = Date.now();
    this.favoritesOrder = orderedItems.map((item) => {
      var _a2;
      return {
        id: item.id,
        type: item.type,
        addedAt: ((_a2 = this.favoritesOrder.find((f) => f.id === item.id && f.type === item.type)) == null ? void 0 : _a2.addedAt) ?? now
      };
    });
    this.scheduleSave();
    Logger.info("Favorites reordered");
  }
  /**
   * Add item to favorites order (at the beginning = newest)
   */
  addToFavoritesOrder(id, type) {
    this.favoritesOrder = this.favoritesOrder.filter((f) => !(f.id === id && f.type === type));
    this.favoritesOrder.unshift({ id, type, addedAt: Date.now() });
    this.scheduleSave();
  }
  /**
   * Remove item from favorites order
   */
  removeFromFavoritesOrder(id, type) {
    this.favoritesOrder = this.favoritesOrder.filter((f) => !(f.id === id && f.type === type));
    this.scheduleSave();
  }
  // ─────────────────────────────────────────────────────────────
  // Tags Management
  // ─────────────────────────────────────────────────────────────
  /**
   * Get all unique tags
   */
  getAllTags() {
    const tagSet = new Set(this.customTags);
    this.items.forEach((item) => {
      item.tags.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }
  /**
   * Add a custom tag explicitly (even if not used on any track)
   */
  addCustomTag(tag) {
    const normalizedTag = tag.trim().replace(/^#/, "");
    if (normalizedTag && !this.customTags.has(normalizedTag)) {
      this.customTags.add(normalizedTag);
      this.scheduleSave();
    }
  }
  /**
   * Add tag to item
   */
  addTagToItem(itemId, tag) {
    const item = this.getItem(itemId);
    if (!item) {
      throw new Error(`Library item not found: ${itemId}`);
    }
    if (!item.tags.includes(tag)) {
      item.tags.push(tag);
      item.updatedAt = Date.now();
      this.scheduleSave();
    }
  }
  /**
   * Remove tag from item
   */
  removeTagFromItem(itemId, tag) {
    const item = this.getItem(itemId);
    if (!item) {
      throw new Error(`Library item not found: ${itemId}`);
    }
    const index = item.tags.indexOf(tag);
    if (index !== -1) {
      item.tags.splice(index, 1);
      item.updatedAt = Date.now();
      this.scheduleSave();
    }
  }
  /**
   * Rename tag globally
   */
  renameTag(oldTag, newTag) {
    let count = 0;
    this.items.forEach((item) => {
      const index = item.tags.indexOf(oldTag);
      if (index !== -1) {
        item.tags[index] = newTag;
        item.updatedAt = Date.now();
        count++;
      }
    });
    if (count > 0) {
      if (this.customTags.has(oldTag)) {
        this.customTags.delete(oldTag);
        this.customTags.add(newTag);
      }
      this.scheduleSave();
      Logger.info(`Tag renamed: "${oldTag}" → "${newTag}" (${count} items)`);
    } else if (this.customTags.has(oldTag)) {
      this.customTags.delete(oldTag);
      this.customTags.add(newTag);
      this.scheduleSave();
      Logger.info(`Custom tag renamed: "${oldTag}" → "${newTag}"`);
    }
    return count;
  }
  /**
   * Delete tag globally
   */
  deleteTag(tag) {
    let count = 0;
    this.items.forEach((item) => {
      const index = item.tags.indexOf(tag);
      if (index !== -1) {
        item.tags.splice(index, 1);
        item.updatedAt = Date.now();
        count++;
      }
    });
    if (count > 0) {
      if (this.customTags.has(tag)) {
        this.customTags.delete(tag);
      }
      this.scheduleSave();
      Logger.info(`Tag deleted: "${tag}" (${count} items)`);
    } else if (this.customTags.has(tag)) {
      this.customTags.delete(tag);
      this.scheduleSave();
      Logger.info(`Custom tag deleted: "${tag}"`);
    }
    return count;
  }
  // ─────────────────────────────────────────────────────────────
  // Favorites
  // ─────────────────────────────────────────────────────────────
  /**
   * Toggle favorite status
   */
  toggleFavorite(id) {
    const item = this.items.get(id);
    if (!item) {
      throw new Error("Item not found");
    }
    item.favorite = !item.favorite;
    item.updatedAt = Date.now();
    if (item.favorite) {
      this.addToFavoritesOrder(item.id, "track");
      Logger.info(`Added favorite: ${item.name}`);
    } else {
      this.removeFromFavoritesOrder(item.id, "track");
      Logger.info(`Removed favorite: ${item.name}`);
    }
    this.scheduleSave();
    Hooks.callAll("ase.favoritesChanged", { id: item.id, isFavorite: item.favorite });
    return item.favorite;
  }
  /**
   * Scan library for items with missing duration (0) and try to extract it.
   * Run this once per session or on demand.
   */
  async scanMissingDurations() {
    if (this.hasScannedDurations) return;
    this.hasScannedDurations = true;
    const missing = Array.from(this.items.values()).filter((i) => !i.duration || i.duration === 0);
    if (missing.length === 0) return;
    Logger.info(`Scanning ${missing.length} items for missing duration...`);
    let updatedCount = 0;
    const batchSize = 5;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      await Promise.all(batch.map((item) => new Promise((resolve) => {
        const audio = new Audio(item.url);
        const cleanup = /* @__PURE__ */ __name(() => {
          audio.onloadedmetadata = null;
          audio.onerror = null;
          resolve();
        }, "cleanup");
        audio.onloadedmetadata = () => {
          if (audio.duration && isFinite(audio.duration)) {
            item.duration = Math.round(audio.duration);
            updatedCount++;
          }
          cleanup();
        };
        audio.onerror = () => {
          cleanup();
        };
        setTimeout(cleanup, 5e3);
      })));
    }
    if (updatedCount > 0) {
      Logger.info(`Updated duration for ${updatedCount} items.`);
      this.scheduleSave();
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────
  /**
   * Get library statistics
   */
  getStats() {
    const items = this.getAllItems();
    const playlistStats = this.playlists.getStats();
    return {
      totalItems: items.length,
      favoriteItems: items.filter((i) => i.favorite).length,
      totalDuration: items.reduce((sum, i) => sum + i.duration, 0),
      tagCount: this.getAllTags().length,
      totalPlaylists: playlistStats.totalPlaylists,
      itemsByGroup: this.getGroupCounts()
    };
  }
  getGroupCounts() {
    const counts = { music: 0, ambience: 0, sfx: 0 };
    for (const item of this.items.values()) {
      if (counts[item.group] !== void 0) {
        counts[item.group]++;
      }
    }
    return counts;
  }
  // ─────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────
  async loadFromSettings() {
    var _a2, _b, _c;
    try {
      await GlobalStorage.migrateFromWorldSettings();
      const state = await GlobalStorage.load();
      if (!state) {
        Logger.info("No saved library state, starting fresh");
        return;
      }
      if (state.version !== LIBRARY_VERSION) {
        Logger.warn(`Library version mismatch: ${state.version} → ${LIBRARY_VERSION}`);
      }
      this.items.clear();
      if (state.items) {
        Object.values(state.items).forEach((item) => {
          if (this.isValidLibraryItem(item)) {
            if (!item.playbackMode) {
              item.playbackMode = "inherit";
            }
            this.items.set(item.id, item);
          }
        });
      }
      this.customTags = new Set(state.customTags || []);
      this.playlists.load(state.playlists || {});
      this.favoritesOrder = state.favoritesOrder || [];
      Logger.info(`Library loaded: ${this.items.size} items, ${this.playlists.getAllPlaylists().length} playlists, ${this.customTags.size} custom tags`);
      const worldFavorites = game.settings.get(MODULE_ID$2, "favorites") || { ids: [], playlistIds: [], order: [] };
      const hasWorldFavorites = ((_a2 = worldFavorites.ids) == null ? void 0 : _a2.length) > 0 || ((_b = worldFavorites.playlistIds) == null ? void 0 : _b.length) > 0 || ((_c = worldFavorites.order) == null ? void 0 : _c.length) > 0;
      if (!hasWorldFavorites) {
        const globalFavoriteItems = Array.from(this.items.values()).filter((i) => i.favorite);
        const globalFavoritePlaylists = this.playlists.getAllPlaylists().filter((p) => p.favorite);
        const hasGlobalFavorites = globalFavoriteItems.length > 0 || globalFavoritePlaylists.length > 0;
        if (hasGlobalFavorites) {
          Logger.info(`Migrating ${globalFavoriteItems.length} tracks and ${globalFavoritePlaylists.length} playlists to world-scoped favorites`);
          this.favoritesOrder = state.favoritesOrder || [];
          await game.settings.set(MODULE_ID$2, "favorites", {
            ids: globalFavoriteItems.map((i) => i.id),
            playlistIds: globalFavoritePlaylists.map((p) => p.id),
            order: this.favoritesOrder
          });
        } else {
          this.favoritesOrder = [];
        }
      } else {
        this.items.forEach((i) => i.favorite = false);
        this.playlists.getAllPlaylists().forEach((p) => p.favorite = false);
        const trackIds = new Set(worldFavorites.ids || []);
        trackIds.forEach((id) => {
          const item = this.items.get(id);
          if (item) item.favorite = true;
        });
        const playlistIds = new Set(worldFavorites.playlistIds || []);
        playlistIds.forEach((id) => {
          const playlist = this.playlists.getPlaylist(id);
          if (playlist) playlist.favorite = true;
        });
        this.favoritesOrder = worldFavorites.order || [];
        Logger.info(`Loaded world-scoped favorites: ${trackIds.size} tracks, ${playlistIds.size} playlists`);
      }
    } catch (error) {
      Logger.error("Failed to load library state:", error);
    }
  }
  isValidLibraryItem(item) {
    return item && typeof item.id === "string" && typeof item.url === "string";
  }
  async saveToSettings() {
    try {
      const favoriteTracks = Array.from(this.items.values()).filter((i) => i.favorite).map((i) => i.id);
      const favoritePlaylists = this.playlists.getAllPlaylists().filter((p) => p.favorite).map((p) => p.id);
      await game.settings.set(MODULE_ID$2, "favorites", {
        ids: favoriteTracks,
        playlistIds: favoritePlaylists,
        order: this.favoritesOrder
      });
      const cleanItems = /* @__PURE__ */ new Map();
      this.items.forEach((item, id) => {
        if (item.favorite) {
          cleanItems.set(id, { ...item, favorite: false });
        } else {
          cleanItems.set(id, item);
        }
      });
      const cleanPlaylists = this.playlists.export();
      const processedPlaylists = {};
      Object.values(cleanPlaylists).forEach((p) => {
        if (p.favorite) {
          processedPlaylists[p.id] = { ...p, favorite: false };
        } else {
          processedPlaylists[p.id] = p;
        }
      });
      const state = {
        items: Object.fromEntries(cleanItems),
        playlists: processedPlaylists,
        customTags: Array.from(this.customTags),
        favoritesOrder: [],
        // Cleared in global storage
        version: LIBRARY_VERSION,
        lastModified: Date.now()
      };
      await GlobalStorage.save(state);
      this.saveScheduled = false;
      Logger.debug(`Library saved: ${this.items.size} items, ${Object.keys(processedPlaylists).length} playlists (Favorites saved to World)`);
    } catch (error) {
      Logger.error("Failed to save library state:", error);
    }
  }
  scheduleSave() {
    this.debouncedSave();
  }
  // ─────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────
  extractNameFromUrl(url) {
    try {
      const decoded = decodeURIComponent(url);
      const parts = decoded.split("/");
      const filename = parts[parts.length - 1];
      return filename.replace(/\.[^.]+$/, "");
    } catch {
      return "Unknown Track";
    }
  }
  /**
   * Clear all library data
   */
  clear() {
    this.items.clear();
    this.playlists.clear();
    this.scheduleSave();
    Logger.warn("Library cleared");
  }
  /**
   * Dispose resources
   */
  dispose() {
    if (this.saveScheduled) {
      this.saveToSettings();
    }
  }
};
__name(_LibraryManager, "LibraryManager");
let LibraryManager = _LibraryManager;
const MODULE_ID$1 = "sound-engine-master";
const _PlaybackQueueManager = class _PlaybackQueueManager {
  constructor() {
    __publicField(this, "items", []);
    __publicField(this, "activeItemId", null);
    __publicField(this, "eventListeners", /* @__PURE__ */ new Map());
    __publicField(this, "saveTimeout", null);
    Logger.info("PlaybackQueueManager initialized");
  }
  /**
   * Load queue state from settings
   */
  async load() {
    var _a2;
    try {
      const savedState = (_a2 = game.settings) == null ? void 0 : _a2.get(MODULE_ID$1, "queueState");
      if (savedState && savedState.items) {
        this.items = savedState.items;
        this.activeItemId = savedState.activeItemId || null;
        Logger.info(`Loaded ${this.items.length} items from queue`);
      } else {
        Logger.debug("No saved queue state found");
      }
    } catch (error) {
      Logger.error("Failed to load queue state:", error);
    }
  }
  /**
   * Save queue state to settings (debounced)
   */
  scheduleSave() {
    if (this.saveTimeout !== null) {
      window.clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = window.setTimeout(() => {
      this.save();
      this.saveTimeout = null;
    }, 500);
  }
  /**
   * Save queue state immediately
   */
  async save() {
    var _a2;
    try {
      const state = {
        items: this.items,
        activeItemId: this.activeItemId
      };
      await ((_a2 = game.settings) == null ? void 0 : _a2.set(MODULE_ID$1, "queueState", state));
      Logger.debug("Queue state saved");
    } catch (error) {
      Logger.error("Failed to save queue state:", error);
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Core Operations
  // ─────────────────────────────────────────────────────────────
  /**
   * Add a library item to the queue
   */
  addItem(libraryItemId, options) {
    const item = {
      id: generateUUID(),
      libraryItemId,
      group: (options == null ? void 0 : options.group) ?? "music",
      addedAt: Date.now(),
      state: "stopped",
      volume: (options == null ? void 0 : options.volume) ?? 1,
      playlistId: options == null ? void 0 : options.playlistId
    };
    this.items.push(item);
    this.emit("add", { item });
    this.emit("change", { items: this.items });
    this.scheduleSave();
    Logger.debug("Added to queue:", item.id, libraryItemId);
    return item;
  }
  /**
   * Add all items from a playlist to the queue
   */
  addPlaylist(playlistId, playlistItems) {
    const added = [];
    for (const pItem of playlistItems) {
      const queueItem = this.addItem(pItem.libraryItemId, {
        playlistId,
        group: pItem.group,
        volume: pItem.volume
        // Loop is removed
      });
      added.push(queueItem);
    }
    return added;
  }
  /**
   * Remove an item from the queue
   */
  removeItem(queueItemId) {
    var _a2;
    const index = this.items.findIndex((i) => i.id === queueItemId);
    if (index === -1) return false;
    const [removed] = this.items.splice(index, 1);
    if (this.activeItemId === queueItemId) {
      if ((_a2 = window.ASE) == null ? void 0 : _a2.engine) {
        Logger.info(`Stopping track ${removed.libraryItemId} because it was removed from queue`);
        window.ASE.engine.stopTrack(removed.libraryItemId);
      }
      this.activeItemId = null;
      this.emit("active", { item: void 0 });
    }
    this.emit("remove", { item: removed });
    this.emit("change", { items: this.items });
    this.scheduleSave();
    Logger.debug("Removed from queue:", queueItemId);
    return true;
  }
  /**
   * Clear all items from the queue
   */
  clearQueue() {
    var _a2;
    if (this.activeItemId && ((_a2 = window.ASE) == null ? void 0 : _a2.engine)) {
      const activeItem = this.items.find((i) => i.id === this.activeItemId);
      if (activeItem) {
        Logger.info(`Stopping track ${activeItem.libraryItemId} because queue was cleared`);
        window.ASE.engine.stopTrack(activeItem.libraryItemId);
      }
    }
    this.items = [];
    this.activeItemId = null;
    this.emit("change", { items: [] });
    this.emit("active", { item: void 0 });
    this.scheduleSave();
    Logger.debug("Queue cleared");
  }
  /**
   * Move a queue item to a new position
   */
  moveItem(queueItemId, newIndex) {
    const currentIndex = this.items.findIndex((i) => i.id === queueItemId);
    if (currentIndex === -1) {
      Logger.warn("Cannot move: item not in queue", queueItemId);
      return;
    }
    const clampedIndex = Math.max(0, Math.min(newIndex, this.items.length - 1));
    if (currentIndex === clampedIndex) return;
    const [item] = this.items.splice(currentIndex, 1);
    this.items.splice(clampedIndex, 0, item);
    this.emit("change", { items: this.items });
    this.scheduleSave();
    Logger.debug("Moved queue item:", queueItemId, "to index:", clampedIndex);
  }
  // ─────────────────────────────────────────────────────────────
  // Playback Control
  // ─────────────────────────────────────────────────────────────
  /**
   * Set the currently active (playing) item
   */
  setActive(queueItemId) {
    if (queueItemId && !this.items.find((i) => i.id === queueItemId)) {
      Logger.warn("Cannot set active: item not in queue", queueItemId);
      return;
    }
    this.activeItemId = queueItemId;
    const item = this.getActive();
    this.emit("active", { item: item ?? void 0 });
    Logger.debug("Active item set:", queueItemId);
  }
  /**
   * Get the currently active item
   */
  getActive() {
    if (!this.activeItemId) return null;
    return this.items.find((i) => i.id === this.activeItemId) ?? null;
  }
  /**
   * Get the next item in the queue (after active)
   */
  getNext() {
    if (!this.activeItemId) return this.items[0] ?? null;
    const currentIndex = this.items.findIndex((i) => i.id === this.activeItemId);
    if (currentIndex === -1 || currentIndex >= this.items.length - 1) return null;
    return this.items[currentIndex + 1];
  }
  /**
   * Get the previous item in the queue (before active)
   */
  getPrevious() {
    if (!this.activeItemId) return null;
    const currentIndex = this.items.findIndex((i) => i.id === this.activeItemId);
    if (currentIndex <= 0) return null;
    return this.items[currentIndex - 1];
  }
  /**
   * Update the state of a queue item
   */
  updateItemState(queueItemId, state) {
    const item = this.items.find((i) => i.id === queueItemId);
    if (item) {
      item.state = state;
      this.emit("change", { items: this.items });
    }
  }
  // ─────────────────────────────────────────────────────────────
  // State Access
  // ─────────────────────────────────────────────────────────────
  /**
   * Get all items in the queue
   */
  getItems() {
    return [...this.items];
  }
  /**
   * Get full queue state
   */
  getState() {
    return {
      items: [...this.items],
      activeItemId: this.activeItemId
    };
  }
  /**
   * Check if an item is in the queue
   */
  hasItem(libraryItemId) {
    return this.items.some((i) => i.libraryItemId === libraryItemId);
  }
  /**
   * Remove all queue items that reference a specific library item
   */
  removeByLibraryItemId(libraryItemId) {
    const toRemove = this.items.filter((i) => i.libraryItemId === libraryItemId);
    if (toRemove.length === 0) return false;
    for (const item of toRemove) {
      this.removeItem(item.id);
    }
    return true;
  }
  // ─────────────────────────────────────────────────────────────
  // Event System
  // ─────────────────────────────────────────────────────────────
  /**
   * Dispose: clear pending save timer and all event listeners
   */
  dispose() {
    if (this.saveTimeout !== null) {
      window.clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.eventListeners.clear();
    Logger.debug("PlaybackQueueManager disposed");
  }
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, /* @__PURE__ */ new Set());
    }
    this.eventListeners.get(event).add(callback);
  }
  off(event, callback) {
    var _a2;
    (_a2 = this.eventListeners.get(event)) == null ? void 0 : _a2.delete(callback);
  }
  emit(event, data) {
    var _a2;
    (_a2 = this.eventListeners.get(event)) == null ? void 0 : _a2.forEach((cb) => cb(data));
  }
};
__name(_PlaybackQueueManager, "PlaybackQueueManager");
let PlaybackQueueManager = _PlaybackQueueManager;
const _PlaybackScheduler = class _PlaybackScheduler {
  constructor(engine, library, queue) {
    __publicField(this, "engine");
    __publicField(this, "library");
    __publicField(this, "queue");
    __publicField(this, "currentContext", null);
    __publicField(this, "_stopped", false);
    // Stored callbacks for proper cleanup
    __publicField(this, "_onTrackEndedBound");
    __publicField(this, "_onContextChangedBound");
    this.engine = engine;
    this.library = library;
    this.queue = queue;
    this._onTrackEndedBound = (trackId) => this.handleTrackEnded(trackId);
    this._onContextChangedBound = (context) => this.setContext(context);
    this.setupListeners();
  }
  setupListeners() {
    this.engine.on("trackEnded", this._onTrackEndedBound);
    this.engine.on("contextChanged", this._onContextChangedBound);
  }
  /**
   * Dispose: remove all engine event listeners
   */
  dispose() {
    this.engine.off("trackEnded", this._onTrackEndedBound);
    this.engine.off("contextChanged", this._onContextChangedBound);
    this.currentContext = null;
    this._stopped = true;
    Logger.debug("[PlaybackScheduler] Disposed");
  }
  /**
   * Set the current playback context (e.g., user clicked "Play" on a playlist)
   */
  setContext(context) {
    if (!context) {
      this.clearContext();
      return;
    }
    this.currentContext = context;
    this._stopped = false;
    Logger.debug("Playback Context set:", context);
  }
  /**
   * Clear the playback context and stop scheduling.
   * Called by AudioEngine.stopAll() to prevent race conditions
   * where an 'ended' event fires after stopAll and Scheduler starts the next track.
   */
  clearContext() {
    this.currentContext = null;
    this._stopped = true;
    Logger.debug("Playback Context cleared (stopAll)");
  }
  /**
   * Handle track ending
   */
  async handleTrackEnded(trackId) {
    Logger.info(`[PlaybackScheduler] Track ended: ${trackId}`);
    if (this._stopped) {
      Logger.debug(`[PlaybackScheduler] Ignoring ended event after stopAll for: ${trackId}`);
      return;
    }
    Logger.info(`[PlaybackScheduler] Current context: ${JSON.stringify(this.currentContext)}`);
    if (!this.currentContext) {
      Logger.warn("[PlaybackScheduler] No playback context available - auto-progression disabled");
      return;
    }
    const { type, id } = this.currentContext;
    Logger.info(`[PlaybackScheduler] Context type: ${type}, id: ${id || "none"}, mode: ${this.currentContext.playbackMode}`);
    if (type === "playlist" && id) {
      Logger.info(`[PlaybackScheduler] Handling playlist context: ${id}`);
      await this.handlePlaylistContext(id, trackId);
    } else if (type === "track") {
      Logger.info(`[PlaybackScheduler] Handling track context`);
      await this.handleTrackContext(trackId);
    }
  }
  async handlePlaylistContext(playlistId, endedTrackId) {
    const playlist = this.library.playlists.getPlaylist(playlistId);
    if (!playlist) {
      Logger.warn(`Playlist ${playlistId} not found`);
      return;
    }
    const tracks = [...playlist.items].sort((a, b) => a.order - b.order);
    if (tracks.length === 0) {
      Logger.warn(`Playlist ${playlist.name} is empty`);
      return;
    }
    const currentIndex = tracks.findIndex((t) => t.libraryItemId === endedTrackId);
    if (currentIndex === -1) {
      Logger.warn(`Ended track ${endedTrackId} not found in playlist ${playlist.name}`);
      return;
    }
    const track = this.library.getItem(endedTrackId);
    if (!track) {
      Logger.warn(`Track ${endedTrackId} not found in library`);
      return;
    }
    if (track.playbackMode && track.playbackMode !== "inherit") {
      Logger.info(`Track ${track.name} has individual mode: ${track.playbackMode}`);
      await this.handleIndividualTrackMode(endedTrackId, track.playbackMode, playlistId);
      return;
    }
    Logger.debug(`Track ${track.name} inherits playlist mode`);
    const mode = playlist.playbackMode || "loop";
    const queueItems = this.queue.getItems().filter((i) => i.playlistId === playlistId);
    let effectiveTracks = tracks;
    let effectiveIndex = currentIndex;
    if (queueItems.length > 0) {
      effectiveTracks = queueItems.map((qi) => ({
        libraryItemId: qi.libraryItemId,
        volume: qi.volume
      }));
      effectiveIndex = effectiveTracks.findIndex((t) => t.libraryItemId === endedTrackId);
      Logger.debug(`Using Queue order for playlist ${playlist.name}. Index: ${effectiveIndex}/${effectiveTracks.length}`);
    } else {
      Logger.debug(`Using Library order for playlist ${playlist.name} (not in queue). Index: ${currentIndex}/${tracks.length}`);
    }
    Logger.debug(`Playlist mode: ${mode}, current index: ${effectiveIndex}/${effectiveTracks.length}`);
    switch (mode) {
      case "linear":
        if (effectiveIndex < effectiveTracks.length - 1) {
          const nextItem = effectiveTracks[effectiveIndex + 1];
          await this.engine.stopTrack(endedTrackId);
          await this.playPlaylistItem(nextItem, playlistId, playlist.playbackMode);
        } else {
          Logger.debug("Playlist linear playback finished.");
          await this.engine.stopTrack(endedTrackId);
          this.currentContext = null;
        }
        break;
      case "loop":
        let nextIndex = effectiveIndex + 1;
        if (nextIndex >= effectiveTracks.length) {
          nextIndex = 0;
        }
        await this.engine.stopTrack(endedTrackId);
        await this.playPlaylistItem(effectiveTracks[nextIndex], playlistId, playlist.playbackMode);
        break;
      case "random":
        await this.engine.stopTrack(endedTrackId);
        if (effectiveTracks.length > 1) {
          let randomIndex;
          do {
            randomIndex = Math.floor(Math.random() * effectiveTracks.length);
          } while (randomIndex === effectiveIndex && effectiveTracks.length > 1);
          await this.playPlaylistItem(effectiveTracks[randomIndex], playlistId, playlist.playbackMode);
        } else {
          await this.playPlaylistItem(effectiveTracks[0], playlistId, playlist.playbackMode);
        }
        break;
    }
  }
  /**
   * Воспроизвести элемент плейлиста
   * @param item - Элемент плейлиста
   * @param playlistId - ID плейлиста
   * @param playlistMode - Режим воспроизведения плейлиста
   */
  async playPlaylistItem(item, playlistId, playlistMode) {
    const track = this.library.getItem(item.libraryItemId);
    if (!track) {
      Logger.warn(`Track ${item.libraryItemId} not found in library`);
      return;
    }
    Logger.debug(`Playing playlist item: ${track.name}`);
    let player = this.engine.getTrack(track.id);
    if (!player) {
      player = await this.engine.createTrack({
        id: track.id,
        url: track.url,
        group: track.group,
        volume: item.volume !== void 0 ? item.volume : 1
      });
    }
    const context = {
      type: "playlist",
      id: playlistId,
      playbackMode: playlistMode
    };
    await this.engine.playTrack(track.id, 0, context);
    Hooks.call("ase.trackAutoSwitched");
  }
  /**
   * Обработать завершение отдельного трека (не из плейлиста)
   * @param trackId - ID завершившегося трека
   */
  async handleTrackContext(trackId) {
    const track = this.library.getItem(trackId);
    if (!track) {
      Logger.warn(`Track ${trackId} not found in library`);
      return;
    }
    let mode = track.playbackMode;
    if (mode === "inherit") {
      Logger.debug(`Track ${track.name} has inherit mode, using single as fallback`);
      mode = "single";
    }
    Logger.debug(`Track ${track.name} playback mode: ${mode}`);
    switch (mode) {
      case "loop":
        Logger.debug(`Looping track: ${track.name}`);
        const context = {
          type: "track",
          playbackMode: "loop"
        };
        await this.engine.playTrack(trackId, 0, context);
        break;
      case "single":
        Logger.debug(`Track ${track.name} finished (single mode) - stopping`);
        await this.engine.stopTrack(trackId);
        this.currentContext = null;
        break;
      case "random":
      case "linear":
        await this.handleUngroupedQueueContext(trackId, mode);
        break;
    }
  }
  /**
   * Обработать индивидуальный режим воспроизведения трека в контексте плейлиста
   * @param trackId - ID завершившегося трека
   * @param mode - Индивидуальный режим трека
   * @param playlistId - ID плейлиста (если контекст плейлиста)
   */
  async handleIndividualTrackMode(trackId, mode, playlistId) {
    const track = this.library.getItem(trackId);
    if (!track) {
      Logger.warn(`Track ${trackId} not found in library`);
      return;
    }
    Logger.debug(`Handling individual track mode: ${track.name} - ${mode}`);
    switch (mode) {
      case "loop":
        Logger.debug(`Looping track: ${track.name}`);
        const loopContext = {
          type: "track",
          playbackMode: "loop"
        };
        await this.engine.playTrack(trackId, 0, loopContext);
        Hooks.call("ase.trackAutoSwitched");
        break;
      case "single":
        Logger.debug(`Track ${track.name} finished (single mode) - stopping`);
        await this.engine.stopTrack(trackId);
        this.currentContext = null;
        break;
      case "random":
        Logger.debug(`Random track: ${track.name} - repeating`);
        await this.engine.stopTrack(trackId);
        const randomContext = {
          type: "track",
          playbackMode: "random"
        };
        await this.engine.playTrack(trackId, 0, randomContext);
        Hooks.call("ase.trackAutoSwitched");
        break;
      case "linear":
        if (playlistId) {
          const playlist = this.library.playlists.getPlaylist(playlistId);
          if (playlist) {
            const queueItems = this.queue.getItems().filter((i) => i.playlistId === playlistId);
            let effectiveTracks;
            if (queueItems.length > 0) {
              effectiveTracks = queueItems.map((qi) => ({
                libraryItemId: qi.libraryItemId,
                volume: qi.volume
              }));
              Logger.debug(`[handleIndividualTrackMode] Using Queue order for playlist ${playlist.name}`);
            } else {
              effectiveTracks = [...playlist.items].sort((a, b) => a.order - b.order).map((t) => ({
                libraryItemId: t.libraryItemId,
                volume: t.volume
              }));
              Logger.debug(`[handleIndividualTrackMode] Using Library order for playlist ${playlist.name}`);
            }
            const currentIndex = effectiveTracks.findIndex((t) => t.libraryItemId === trackId);
            if (currentIndex !== -1 && currentIndex < effectiveTracks.length - 1) {
              Logger.debug(`Track ${track.name} (linear) -> launching next track in playlist`);
              await this.engine.stopTrack(trackId);
              const nextItem = effectiveTracks[currentIndex + 1];
              await this.playPlaylistItem(nextItem, playlistId, playlist.playbackMode || "loop");
              return;
            }
          }
        }
        Logger.debug(`Track ${track.name} finished (linear mode) and no next track - stopping`);
        await this.engine.stopTrack(trackId);
        this.currentContext = null;
        break;
      case "inherit":
        Logger.warn(`Unexpected inherit mode in handleIndividualTrackMode`);
        break;
    }
  }
  /**
   * Обработать Random/Linear режимы для треков в Ungrouped очереди
   * @param trackId - ID завершившегося трека
   * @param mode - Режим воспроизведения (random или linear)
   */
  async handleUngroupedQueueContext(trackId, mode) {
    const ungroupedTracks = this.queue.getItems().filter((item) => !item.playlistId);
    if (ungroupedTracks.length === 0) {
      Logger.debug("No ungrouped tracks in queue");
      this.currentContext = null;
      return;
    }
    const currentIndex = ungroupedTracks.findIndex((item) => item.libraryItemId === trackId);
    if (currentIndex === -1) {
      Logger.warn(`Track ${trackId} not found in ungrouped queue`);
      this.currentContext = null;
      return;
    }
    Logger.debug(`Ungrouped queue mode: ${mode}, current index: ${currentIndex}/${ungroupedTracks.length}`);
    let nextTrack = null;
    if (mode === "linear") {
      if (currentIndex < ungroupedTracks.length - 1) {
        nextTrack = ungroupedTracks[currentIndex + 1];
        Logger.debug(`Linear: playing next track in ungrouped queue`);
      } else {
        Logger.debug("Ungrouped linear playback finished");
        this.currentContext = null;
        return;
      }
    } else if (mode === "random") {
      if (ungroupedTracks.length > 1) {
        let randomIndex;
        do {
          randomIndex = Math.floor(Math.random() * ungroupedTracks.length);
        } while (randomIndex === currentIndex && ungroupedTracks.length > 1);
        nextTrack = ungroupedTracks[randomIndex];
        Logger.debug(`Random: selected track at index ${randomIndex}`);
      } else {
        nextTrack = ungroupedTracks[0];
        Logger.debug("Random: only one track, repeating it");
      }
    }
    if (!nextTrack) {
      this.currentContext = null;
      return;
    }
    const libraryItem = this.library.getItem(nextTrack.libraryItemId);
    if (!libraryItem) {
      Logger.warn(`Track ${nextTrack.libraryItemId} not found in library`);
      this.currentContext = null;
      return;
    }
    let player = this.engine.getTrack(libraryItem.id);
    if (!player) {
      player = await this.engine.createTrack({
        id: libraryItem.id,
        url: libraryItem.url,
        group: libraryItem.group,
        volume: 1
      });
    }
    const context = {
      type: "track",
      playbackMode: mode
    };
    await this.engine.playTrack(libraryItem.id, 0, context);
    Hooks.call("ase.trackAutoSwitched");
  }
};
__name(_PlaybackScheduler, "PlaybackScheduler");
let PlaybackScheduler = _PlaybackScheduler;
const MODULE_ID = "sound-engine-master";
const SUPPORTED_LOCALES = ["en", "ru"];
const aseLocaleDictionaries = /* @__PURE__ */ new Map();
let gmEngine = null;
let mainApp = null;
let libraryManager = null;
let queueManager = null;
let playbackScheduler = null;
let playerEngine = null;
let volumePanel = null;
let socketManager = null;
let volumeHudPanel = null;
function normalizeSupportedLocale(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("ru")) return "ru";
  if (normalized.startsWith("en")) return "en";
  return null;
}
__name(normalizeSupportedLocale, "normalizeSupportedLocale");
function getFoundryLocale() {
  var _a2, _b, _c;
  const i18nLocale = normalizeSupportedLocale((_a2 = game.i18n) == null ? void 0 : _a2.lang);
  if (i18nLocale) return i18nLocale;
  try {
    const coreLocale = normalizeSupportedLocale((_c = (_b = game.settings) == null ? void 0 : _b.get) == null ? void 0 : _c.call(_b, "core", "language"));
    if (coreLocale) return coreLocale;
  } catch {
  }
  return "en";
}
__name(getFoundryLocale, "getFoundryLocale");
function getAseRootTranslations(locale) {
  const dictionary = aseLocaleDictionaries.get(locale);
  if (!dictionary || typeof dictionary !== "object") return null;
  const root = dictionary.ASE;
  if (!root || typeof root !== "object") return null;
  return root;
}
__name(getAseRootTranslations, "getAseRootTranslations");
async function preloadLocaleDictionaries() {
  for (const locale of SUPPORTED_LOCALES) {
    if (aseLocaleDictionaries.has(locale)) continue;
    const localePath = `modules/${MODULE_ID}/lang/${locale}.json`;
    try {
      const response = await fetch(localePath, { cache: "no-store" });
      if (!response.ok) {
        Logger.warn(`Failed to load locale file "${localePath}" (status: ${response.status})`);
        continue;
      }
      const dictionary = await response.json();
      if (dictionary && typeof dictionary === "object") {
        aseLocaleDictionaries.set(locale, dictionary);
      }
    } catch (error) {
      Logger.warn(`Failed to load locale file "${localePath}"`, error);
    }
  }
}
__name(preloadLocaleDictionaries, "preloadLocaleDictionaries");
function applyAseLocaleTranslations() {
  try {
    const locale = getFoundryLocale();
    const aseRoot = getAseRootTranslations(locale);
    if (!aseRoot) return;
    const cloned = JSON.parse(JSON.stringify(aseRoot));
    const i18nAny = game.i18n;
    if (!i18nAny.translations || typeof i18nAny.translations !== "object") {
      i18nAny.translations = {};
    }
    i18nAny.translations.ASE = cloned;
  } catch (error) {
    Logger.warn("Failed to apply ASE locale translations:", error);
  }
}
__name(applyAseLocaleTranslations, "applyAseLocaleTranslations");
Hooks.on("getSceneControlButtons", (controls) => {
  var _a2;
  try {
    const isGM = ((_a2 = game.user) == null ? void 0 : _a2.isGM) ?? false;
    const aseTools = [
      {
        name: "ase-open-mixer",
        title: isGM ? game.i18n.localize("ASE.UI.SceneControl.OpenSoundMixer") : game.i18n.localize("ASE.UI.SceneControl.OpenSoundVolume"),
        icon: isGM ? "fas fa-sliders-h" : "fas fa-volume-up",
        button: true,
        onClick: /* @__PURE__ */ __name(() => {
          Logger.debug("Button clicked: Open Mixer/Volume");
          if (window.ASE) {
            window.ASE.openPanel();
          } else {
            Logger.error("Sound Engine namespace is undefined!");
          }
        }, "onClick")
      }
    ];
    if (isGM) {
      aseTools.push({
        name: "ase-open-library",
        title: game.i18n.localize("ASE.UI.SceneControl.OpenSoundLibrary"),
        icon: "fas fa-book-open",
        button: true,
        onClick: /* @__PURE__ */ __name(() => {
          Logger.debug("Button clicked: Open Library");
          if (window.ASE && window.ASE.openLibrary) {
            window.ASE.openLibrary();
          } else {
            Logger.error("Sound Engine namespace or openLibrary is undefined");
          }
        }, "onClick")
      });
    }
    if (!Array.isArray(controls) && typeof controls === "object" && controls !== null) {
      Logger.info("Detected non-array controls structure (V13?)");
      const soundsLayer = controls.sounds;
      if (soundsLayer && Array.isArray(soundsLayer.tools)) {
        soundsLayer.tools.push(...aseTools);
        Logger.info('Added tools to "sounds" layer (V13 Object Mode)');
      } else {
        controls["sound-engine-master"] = {
          name: "sound-engine-master",
          title: game.i18n.localize("ASE.Title"),
          icon: "fas fa-music",
          visible: true,
          tools: aseTools
        };
        Logger.info("Created dedicated control group (V13 Object Mode)");
      }
      return;
    }
    if (Array.isArray(controls)) {
      const soundsLayer = controls.find((c) => c.name === "sounds");
      if (soundsLayer) {
        soundsLayer.tools.push(...aseTools);
      } else {
        controls.push({
          name: "sound-engine-master",
          title: game.i18n.localize("ASE.Title"),
          icon: "fas fa-music",
          visible: true,
          tools: aseTools
        });
      }
    } else {
      Logger.warn("Unknown controls structure:", controls);
    }
  } catch (error) {
    Logger.error("Failed to initialize scene controls:", error);
  }
});
Hooks.on("renderSceneControls", (controls, html) => {
  try {
    const findElement = /* @__PURE__ */ __name((selector) => {
      if (typeof html.find === "function") {
        const el = html.find(selector);
        return el.length ? el[0] : null;
      } else if (html instanceof HTMLElement) {
        return html.querySelector(selector);
      }
      return null;
    }, "findElement");
    const mixerBtn = findElement('[data-tool="ase-open-mixer"]');
    if (mixerBtn) {
      mixerBtn.onclick = (event) => {
        var _a2;
        event.preventDefault();
        event.stopPropagation();
        Logger.debug("Manual click handler (native): Open Mixer");
        (_a2 = window.ASE) == null ? void 0 : _a2.openPanel();
      };
    }
    const libraryBtn = findElement('[data-tool="ase-open-library"]');
    if (libraryBtn) {
      libraryBtn.onclick = (event) => {
        var _a2, _b;
        event.preventDefault();
        event.stopPropagation();
        Logger.debug("Manual click handler (native): Open Library");
        (_b = (_a2 = window.ASE) == null ? void 0 : _a2.openLibrary) == null ? void 0 : _b.call(_a2);
      };
    }
  } catch (error) {
    Logger.warn("Failed to bind manual click listeners:", error);
  }
});
function registerHandlebarsHelpers() {
  Handlebars.registerHelper("formatDuration", (seconds) => {
    if (!seconds || seconds <= 0) return "--:--";
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  });
  Handlebars.registerHelper("eq", (a, b) => {
    return a === b;
  });
  Handlebars.registerHelper("or", (...args) => {
    const values = args.slice(0, -1);
    return values.some((val) => !!val);
  });
  Handlebars.registerHelper("aseGroupLabel", (group) => {
    if (!group) return game.i18n.localize("ASE.Groups.music");
    return game.i18n.localize(`ASE.Groups.${String(group).toLowerCase()}`);
  });
  Handlebars.registerHelper("asePlaybackModeLabel", (mode) => {
    if (!mode) return game.i18n.localize("ASE.UI.PlaybackMode.loop");
    return game.i18n.localize(`ASE.UI.PlaybackMode.${String(mode).toLowerCase()}`);
  });
  Handlebars.registerHelper("aseEffectTypeLabel", (effectType) => {
    if (!effectType) return "";
    return game.i18n.localize(`ASE.UI.EffectType.${String(effectType).toLowerCase()}`);
  });
}
__name(registerHandlebarsHelpers, "registerHandlebarsHelpers");
Hooks.once("init", async () => {
  Logger.info("Initializing Sound Engine Master...");
  await preloadLocaleDictionaries();
  registerSettings();
  registerHandlebarsHelpers();
  await loadTemplates([
    `modules/${MODULE_ID}/templates/partials/effect-card.hbs`
  ]);
});
Hooks.once("ready", async () => {
  var _a2;
  const isGM = ((_a2 = game.user) == null ? void 0 : _a2.isGM) ?? false;
  Logger.info(`Starting Sound Engine Master (${isGM ? "GM" : "Player"})...`);
  queueManager = new PlaybackQueueManager();
  await queueManager.load();
  socketManager = new SocketManager();
  if (isGM) {
    await initializeGM();
  } else {
    await initializePlayer();
  }
  window.ASE = {
    isGM,
    openPanel: isGM ? openMainApp : openVolumePanel,
    openLibrary: /* @__PURE__ */ __name(() => isGM && openMainApp("library"), "openLibrary"),
    engine: isGM ? gmEngine ?? void 0 : playerEngine ?? void 0,
    socket: socketManager ?? void 0,
    library: isGM ? libraryManager ?? void 0 : void 0,
    queue: queueManager,
    volumeHud: void 0
  };
  setupAutoplayHandler();
  initializeVolumeHud(isGM);
  Logger.info("Sound Engine Master ready");
});
async function initializeGM() {
  libraryManager = new LibraryManager();
  gmEngine = new AudioEngine();
  socketManager.initializeAsGM(gmEngine);
  await gmEngine.loadSavedState();
  playbackScheduler = new PlaybackScheduler(gmEngine, libraryManager, queueManager);
  gmEngine.setScheduler(playbackScheduler);
  gmEngine.setSocketManager(socketManager);
  Logger.info("PlaybackScheduler initialized");
}
__name(initializeGM, "initializeGM");
function initializeVolumeHud(isGM) {
  try {
    if (isGM && gmEngine) {
      volumeHudPanel = new VolumeHudPanel(gmEngine, void 0, socketManager ?? void 0, openMainApp);
      volumeHudPanel.render(true);
      if (window.ASE) window.ASE.volumeHud = volumeHudPanel;
      Logger.info("Volume HUD Panel initialized for GM");
    } else if (!isGM && playerEngine) {
      volumeHudPanel = new VolumeHudPanel(void 0, playerEngine, void 0, void 0);
      volumeHudPanel.render(true);
      if (window.ASE) window.ASE.volumeHud = volumeHudPanel;
      Logger.info("Volume HUD Panel initialized for Player");
    }
  } catch (error) {
    Logger.error("Failed to initialize Volume HUD Panel:", error);
  }
}
__name(initializeVolumeHud, "initializeVolumeHud");
async function initializePlayer() {
  playerEngine = new PlayerAudioEngine(socketManager);
  socketManager.initializeAsPlayer(playerEngine);
  const savedVolume = PlayerVolumePanel.loadSavedVolume();
  playerEngine.setLocalVolume(savedVolume);
}
__name(initializePlayer, "initializePlayer");
function openMainApp(tab, forceRender = false) {
  if (!gmEngine || !socketManager || !libraryManager) return;
  if (mainApp && mainApp.rendered) {
    if (tab && mainApp.state.activeTab !== tab) {
      mainApp.state.activeTab = tab;
      forceRender = true;
    }
    if (forceRender) {
      mainApp.render(false);
    } else {
      mainApp.bringToTop();
    }
  } else {
    mainApp = new AdvancedSoundEngineApp(gmEngine, socketManager, libraryManager, queueManager);
    if (tab) mainApp.state.activeTab = tab;
    mainApp.render(true);
  }
}
__name(openMainApp, "openMainApp");
function openVolumePanel() {
  if (!playerEngine) return;
  if (volumePanel && volumePanel.rendered) {
    volumePanel.bringToTop();
  } else {
    volumePanel = new PlayerVolumePanel(playerEngine);
    volumePanel.render(true);
  }
}
__name(openVolumePanel, "openVolumePanel");
function setupAutoplayHandler() {
  const resumeAudio = /* @__PURE__ */ __name(() => {
    gmEngine == null ? void 0 : gmEngine.resume();
    playerEngine == null ? void 0 : playerEngine.resume();
  }, "resumeAudio");
  document.addEventListener("click", resumeAudio, { once: true });
  document.addEventListener("keydown", resumeAudio, { once: true });
  Hooks.once("canvasReady", resumeAudio);
}
__name(setupAutoplayHandler, "setupAutoplayHandler");
function registerSettings() {
  applyAseLocaleTranslations();
  game.settings.register(MODULE_ID, "mixerState", {
    name: game.i18n.localize("ASE.UI.Settings.MixerState.Name"),
    hint: game.i18n.localize("ASE.UI.Settings.MixerState.Hint"),
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  game.settings.register(MODULE_ID, "maxSimultaneousTracks", {
    name: game.i18n.localize("ASE.UI.Settings.MaxSimultaneousTracks.Name"),
    hint: game.i18n.localize("ASE.UI.Settings.MaxSimultaneousTracks.Hint"),
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 32, step: 1 },
    default: 8
  });
  game.settings.register(MODULE_ID, "libraryState", {
    name: game.i18n.localize("ASE.UI.Settings.LibraryState.Name"),
    hint: game.i18n.localize("ASE.UI.Settings.LibraryState.Hint"),
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  game.settings.register(MODULE_ID, "queueState", {
    name: game.i18n.localize("ASE.UI.Settings.QueueState.Name"),
    hint: game.i18n.localize("ASE.UI.Settings.QueueState.Hint"),
    scope: "world",
    config: false,
    type: Object,
    default: { items: [], activeItemId: null }
  });
  game.settings.register(MODULE_ID, "favorites", {
    name: game.i18n.localize("ASE.UI.Settings.Favorites.Name"),
    hint: game.i18n.localize("ASE.UI.Settings.Favorites.Hint"),
    scope: "world",
    config: false,
    type: Object,
    default: { ids: [], order: [] }
  });
}
__name(registerSettings, "registerSettings");
Hooks.once("closeGame", () => {
  mainApp == null ? void 0 : mainApp.close();
  volumePanel == null ? void 0 : volumePanel.close();
  volumeHudPanel == null ? void 0 : volumeHudPanel.close();
  playbackScheduler == null ? void 0 : playbackScheduler.dispose();
  socketManager == null ? void 0 : socketManager.dispose();
  gmEngine == null ? void 0 : gmEngine.dispose();
  playerEngine == null ? void 0 : playerEngine.dispose();
  queueManager == null ? void 0 : queueManager.dispose();
  libraryManager == null ? void 0 : libraryManager.dispose();
});
//# sourceMappingURL=module.js.map
