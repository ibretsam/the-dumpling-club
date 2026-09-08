// audio.js — The Dumpling Club sound engine.
//
// Every sound is synthesized on the fly with the Web Audio API (oscillators,
// looped noise buffers, biquad filters and short gain envelopes) — no audio
// files. The palette is deliberately soft and toy-like: short, quiet, rounded.
//
// Signal path:  voice gain → master gain (0.5) → lowpass ~9 kHz → compressor → speakers
//                                              └→ MediaStreamAudioDestination (lazy, for the recorder)
//
// The AudioContext is created lazily (on unlock() or the first play()). Call
// unlock() from a user gesture (pointerdown / click / keydown) so mobile
// browsers allow playback. Every public method is guarded with try/catch and
// never throws; play() is a no-op while the engine is disabled or when the
// browser has no AudioContext.
//
// Usage:
//   const audio = new AudioEngine();
//   canvas.addEventListener('pointerdown', () => audio.unlock(), { once: true });
//   audio.enabled = true;
//   audio.play('clack', { pitch: 1.1, volume: 0.8 });

const MASTER_GAIN = 0.5;
const MASTER_LOWPASS_HZ = 9000;
const MIN_REPEAT_GAP = 0.03;   // seconds; same sound will not stack tighter than this
const SILENT = 0.0001;         // exponential ramps cannot reach 0
const LOOKAHEAD = 0.006;       // seconds of scheduling headroom

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function getAudioContextClass() {
  try {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
  } catch (e) {
    return null;
  }
}

/**
 * Schedule an attack / hold / release envelope on an AudioParam.
 * Returns the time at which the envelope has fully decayed.
 */
function envelope(param, t0, attack, hold, release, peak) {
  const a = Math.max(0.001, attack);
  const h = Math.max(0, hold);
  const r = Math.max(0.005, release);
  const p = Math.max(SILENT, peak);
  param.cancelScheduledValues(t0);
  param.setValueAtTime(SILENT, t0);
  param.linearRampToValueAtTime(p, t0 + a);
  param.setValueAtTime(p, t0 + a + h);
  param.exponentialRampToValueAtTime(SILENT, t0 + a + h + r);
  return t0 + a + h + r;
}

/**
 * Schedule a frequency path on an AudioParam: `freq` at t0, then a list of
 * [offsetSeconds, targetHz] points reached by exponential ramps.
 */
function frequencyPath(param, t0, freq, path) {
  const f0 = Math.max(20, freq);
  param.cancelScheduledValues(t0);
  param.setValueAtTime(f0, t0);
  if (!path) return;
  for (let i = 0; i < path.length; i++) {
    const [dt, target] = path[i];
    param.exponentialRampToValueAtTime(Math.max(20, target), t0 + Math.max(0.001, dt));
  }
}

/** One triggered sound: a private gain node that disconnects itself once all its sources have ended. */
class Voice {
  constructor(ctx, destination, t0, pitch, volume) {
    this.ctx = ctx;
    this.t0 = t0;
    this.pitch = pitch;
    this.out = ctx.createGain();
    this.out.gain.value = volume;
    this.out.connect(destination);
    this.pending = 0;
    this.disposed = false;
  }

  track(source) {
    this.pending++;
    source.onended = () => {
      this.pending--;
      if (this.pending <= 0) this.dispose();
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.out.disconnect(); } catch (e) { /* already gone */ }
  }
}

export class AudioEngine {
  constructor() {
    this._enabled = false;
    this._ctx = null;
    this._master = null;
    this._lowpass = null;
    this._compressor = null;
    this._streamDest = null;
    this._noiseBuffer = null;
    this._lastPlayed = new Map();
    this._unavailable = false;
    this._onVisibility = null;

    // When the tab comes back, iOS often leaves the context 'interrupted' / 'suspended'.
    try {
      if (typeof document !== 'undefined' && document.addEventListener) {
        this._onVisibility = () => {
          try {
            if (document.visibilityState === 'visible' && this._ctx && this._ctx.state !== 'running' && this._enabled) {
              this._ctx.resume().catch(() => {});
            }
          } catch (e) { /* ignore */ }
        };
        document.addEventListener('visibilitychange', this._onVisibility);
      }
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- state

  /** True when the browser offers an AudioContext at all. */
  get available() {
    return !this._unavailable && getAudioContextClass() !== null;
  }

  get enabled() { return this._enabled; }
  set enabled(v) {
    this._enabled = !!v;
    if (this._enabled) {
      try {
        if (this._ctx && this._ctx.state !== 'running') this._ctx.resume().catch(() => {});
      } catch (e) { /* ignore */ }
    }
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  /** The underlying AudioContext (null until created). */
  get context() { return this._ctx; }

  /** Names of every sound this engine can play. */
  static get sounds() { return Object.keys(SOUNDS); }

  /**
   * Call from a user gesture. Creates the AudioContext if needed and resumes it.
   * Resolves to true when the context is running. Never rejects.
   */
  unlock() {
    try {
      const ctx = this._ensureContext();
      if (!ctx) return Promise.resolve(false);
      // A silent one-sample buffer nudges older iOS versions into unmuting the context.
      try {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
      } catch (e) { /* ignore */ }
      if (ctx.state === 'running') return Promise.resolve(true);
      return ctx.resume().then(() => ctx.state === 'running').catch(() => false);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /**
   * Play a named sound. Options: pitch (frequency multiplier, 0.25..4), volume (0..2).
   * Returns true when the sound was scheduled.
   */
  play(name, opts = {}) {
    try {
      if (!this._enabled) return false;
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(SOUNDS, name)) return false;
      const recipe = SOUNDS[name];
      const ctx = this._ensureContext();
      if (!ctx) return false;

      if (ctx.state !== 'running') {
        // Do not queue sounds on a suspended clock (they would all burst out on resume).
        // Resume and only play if that happens promptly (e.g. the first click after unlock()).
        const asked = nowMs();
        ctx.resume().then(() => {
          if (ctx.state === 'running' && nowMs() - asked < 400) this._trigger(name, recipe, opts);
        }).catch(() => {});
        return true;
      }
      return this._trigger(name, recipe, opts);
    } catch (e) {
      return false;
    }
  }

  /**
   * A MediaStreamTrack carrying everything the engine plays (post master chain),
   * for BiteRecorder. Created lazily; null when unsupported.
   */
  get outputStreamTrack() {
    try {
      const ctx = this._ensureContext();
      if (!ctx || typeof ctx.createMediaStreamDestination !== 'function') return null;
      if (!this._streamDest) {
        this._streamDest = ctx.createMediaStreamDestination();
        // Tap the end of the master chain so the recording matches what the user hears.
        this._compressor.connect(this._streamDest);
      }
      const tracks = this._streamDest.stream.getAudioTracks();
      return tracks.length ? tracks[0] : null;
    } catch (e) {
      return null;
    }
  }

  /** Release the AudioContext. The engine can be re-used; a new context is created on demand. */
  dispose() {
    try {
      if (this._onVisibility && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this._onVisibility);
        this._onVisibility = null;
      }
      const ctx = this._ctx;
      this._ctx = null;
      this._master = this._lowpass = this._compressor = this._streamDest = this._noiseBuffer = null;
      this._lastPlayed.clear();
      if (ctx && typeof ctx.close === 'function') ctx.close().catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------- internals

  _ensureContext() {
    if (this._ctx) return this._ctx;
    if (this._unavailable) return null;
    try {
      const AC = getAudioContextClass();
      if (!AC) { this._unavailable = true; return null; }
      let ctx;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch (e) {
        ctx = new AC(); // older webkitAudioContext rejects an options argument
      }

      const master = ctx.createGain();
      master.gain.value = MASTER_GAIN;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = MASTER_LOWPASS_HZ;
      lowpass.Q.value = 0.5;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 14;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.16;

      master.connect(lowpass);
      lowpass.connect(compressor);
      compressor.connect(ctx.destination);

      this._ctx = ctx;
      this._master = master;
      this._lowpass = lowpass;
      this._compressor = compressor;
      return ctx;
    } catch (e) {
      this._unavailable = true;
      return null;
    }
  }

  _noise() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const ctx = this._ctx;
    const seconds = 1.5;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buffer;
    return buffer;
  }

  _trigger(name, recipe, opts) {
    const ctx = this._ctx;
    const pitch = clamp(Number.isFinite(opts.pitch) ? opts.pitch : 1, 0.25, 4);
    const volume = clamp(Number.isFinite(opts.volume) ? opts.volume : 1, 0, 2);
    if (volume <= 0) return false;

    const now = ctx.currentTime;
    const last = this._lastPlayed.get(name);
    if (last !== undefined && now - last < MIN_REPEAT_GAP) return false;
    this._lastPlayed.set(name, now);

    const voice = new Voice(ctx, this._master, now + LOOKAHEAD, pitch, volume);
    try {
      recipe(this, voice);
    } catch (e) {
      voice.dispose();
      return false;
    }
    if (voice.pending === 0) voice.dispose();
    return true;
  }

  /**
   * A tone. o: { type, freq, path: [[dt, hz]...], at (offset s), attack, hold, release, peak,
   *              vibrato: { rate, depth, delay } }
   */
  tone(voice, o) {
    const ctx = voice.ctx;
    const t0 = voice.t0 + (o.at || 0);
    const p = voice.pitch;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    const path = o.path ? o.path.map(([dt, hz]) => [dt, hz * p]) : null;
    frequencyPath(osc.frequency, t0, o.freq * p, path);

    const gain = ctx.createGain();
    const end = envelope(gain.gain, t0, o.attack ?? 0.005, o.hold ?? 0, o.release ?? 0.08, o.peak ?? 0.3);

    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = o.vibrato.rate || 7;
      const depth = ctx.createGain();
      const delay = o.vibrato.delay || 0;
      depth.gain.setValueAtTime(0, t0);
      depth.gain.linearRampToValueAtTime((o.vibrato.depth || 10) * p, t0 + delay + 0.08);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(end + 0.02);
      voice.track(lfo);
    }

    osc.connect(gain);
    gain.connect(voice.out);
    osc.start(t0);
    osc.stop(end + 0.02);
    voice.track(osc);
    return end;
  }

  /**
   * A filtered noise burst. o: { filter ('bandpass'|'lowpass'|'highpass'), freq, path, q, at,
   *                              attack, hold, release, peak }
   */
  noise(voice, o) {
    const ctx = voice.ctx;
    const t0 = voice.t0 + (o.at || 0);
    const p = voice.pitch;
    const src = ctx.createBufferSource();
    src.buffer = this._noise();
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = o.filter || 'bandpass';
    filter.Q.value = o.q ?? 1;
    const path = o.path ? o.path.map(([dt, hz]) => [dt, hz * p]) : null;
    frequencyPath(filter.frequency, t0, (o.freq || 1000) * p, path);

    const gain = ctx.createGain();
    const end = envelope(gain.gain, t0, o.attack ?? 0.003, o.hold ?? 0, o.release ?? 0.05, o.peak ?? 0.3);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(voice.out);
    src.start(t0, Math.random() * 1.0);
    src.stop(end + 0.02);
    voice.track(src);
    return end;
  }
}

function nowMs() {
  try {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
  } catch (e) { /* ignore */ }
  return Date.now();
}

// -------------------------------------------------------------------- sounds
// Each recipe receives the engine (for tone()/noise()) and a Voice (t0, pitch, out).
// Peaks are pre-master (master = 0.5), so 0.5 here is roughly -12 dBFS before compression.

const NOTE = {
  C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.50, D6: 1174.66,
};

const SOUNDS = {
  // Chopstick tap on wood: a bandpassed noise tick, a tiny click and a short low "tok".
  clack(e, v) {
    e.noise(v, { filter: 'bandpass', freq: 1800, q: 5, attack: 0.002, hold: 0.008, release: 0.035, peak: 0.6 });
    e.tone(v, { type: 'sine', freq: 2600, path: [[0.012, 1900]], attack: 0.001, hold: 0.002, release: 0.012, peak: 0.22 });
    e.tone(v, { type: 'sine', freq: 420, path: [[0.04, 300]], attack: 0.002, hold: 0, release: 0.045, peak: 0.28 });
  },

  // Soft rising whoosh as the chopsticks lift something.
  lift(e, v) {
    e.noise(v, { filter: 'bandpass', freq: 420, path: [[0.25, 2400]], q: 1.6, attack: 0.07, hold: 0.05, release: 0.14, peak: 0.28 });
    e.tone(v, { type: 'sine', freq: 280, path: [[0.25, 620]], attack: 0.08, hold: 0.04, release: 0.12, peak: 0.05 });
  },

  // Tiny squeaky boing as a dumpling is grabbed.
  pick(e, v) {
    e.tone(v, { type: 'sine', freq: 400, path: [[0.10, 700]], attack: 0.006, hold: 0.03, release: 0.13, peak: 0.42 });
    e.tone(v, { type: 'triangle', freq: 800, path: [[0.10, 1400]], attack: 0.006, hold: 0.02, release: 0.08, peak: 0.06 });
  },

  // A droplet.
  plip(e, v) {
    e.tone(v, { type: 'sine', freq: 900, path: [[0.08, 400]], attack: 0.003, hold: 0, release: 0.09, peak: 0.4 });
    e.noise(v, { filter: 'bandpass', freq: 3200, q: 2, attack: 0.001, hold: 0.002, release: 0.01, peak: 0.1 });
  },

  // Sploosh into the soy: lowpassed noise wash, a low sine drop and a little bubble.
  dip(e, v) {
    e.noise(v, { filter: 'lowpass', freq: 1200, path: [[0.2, 300]], q: 0.8, attack: 0.02, hold: 0.05, release: 0.16, peak: 0.45 });
    e.tone(v, { type: 'sine', freq: 220, path: [[0.2, 90]], attack: 0.01, hold: 0.02, release: 0.2, peak: 0.42 });
    e.tone(v, { type: 'sine', freq: 480, path: [[0.07, 900]], at: 0.09, attack: 0.005, hold: 0.01, release: 0.07, peak: 0.12 });
  },

  // Something swooping in.
  whoosh(e, v) {
    e.noise(v, { filter: 'bandpass', freq: 350, path: [[0.16, 1600], [0.34, 700]], q: 1.4, attack: 0.12, hold: 0.04, release: 0.19, peak: 0.22 });
  },

  // Two crunchy chews with a low thump under each.
  nom(e, v) {
    for (let i = 0; i < 2; i++) {
      const at = i * 0.16;
      const level = i === 0 ? 1 : 0.85;
      const drop = i === 0 ? 1 : 0.9;
      e.noise(v, { filter: 'bandpass', freq: 1500 * drop, path: [[0.08, 700 * drop]], q: 1.2, at, attack: 0.004, hold: 0.02, release: 0.07, peak: 0.5 * level });
      e.noise(v, { filter: 'bandpass', freq: 3500, q: 2, at, attack: 0.002, hold: 0.004, release: 0.03, peak: 0.18 * level });
      e.tone(v, { type: 'sine', freq: 150 * drop, path: [[0.07, 70 * drop]], at, attack: 0.003, hold: 0.01, release: 0.08, peak: 0.5 * level });
    }
  },

  // Puff: pitch-up blip, a soft airy body and a tick.
  pop(e, v) {
    e.tone(v, { type: 'sine', freq: 320, path: [[0.06, 900]], attack: 0.003, hold: 0.01, release: 0.07, peak: 0.38 });
    e.noise(v, { filter: 'lowpass', freq: 700, q: 0.7, attack: 0.002, hold: 0.01, release: 0.06, peak: 0.25 });
    e.noise(v, { filter: 'highpass', freq: 2500, q: 0.7, attack: 0.001, hold: 0.004, release: 0.02, peak: 0.22 });
  },

  // Springy sine sweep with vibrato.
  boing(e, v) {
    e.tone(v, { type: 'sine', freq: 180, path: [[0.11, 520]], attack: 0.008, hold: 0.06, release: 0.28, peak: 0.45,
      vibrato: { rate: 7.5, depth: 22, delay: 0.1 } });
    e.tone(v, { type: 'triangle', freq: 360, path: [[0.11, 1040]], attack: 0.008, hold: 0.04, release: 0.2, peak: 0.08,
      vibrato: { rate: 7.5, depth: 30, delay: 0.1 } });
  },

  // Two soft bell notes a fifth apart (G5 → D6) with a faint octave shimmer.
  chime(e, v) {
    const notes = [[NOTE.G5, 0], [NOTE.D6, 0.14]];
    for (const [hz, at] of notes) {
      e.tone(v, { type: 'triangle', freq: hz, at, attack: 0.006, hold: 0.03, release: 0.17, peak: 0.28 });
      e.tone(v, { type: 'sine', freq: hz * 2, at, attack: 0.004, hold: 0.01, release: 0.12, peak: 0.06 });
    }
  },

  // Three quick rising chirps.
  giggle(e, v) {
    const bases = [620, 760, 940];
    for (let i = 0; i < bases.length; i++) {
      const at = i * 0.095;
      e.tone(v, { type: 'sine', freq: bases[i], path: [[0.06, bases[i] * 1.45]], at, attack: 0.005, hold: 0.02, release: 0.06, peak: 0.3 });
      e.tone(v, { type: 'triangle', freq: bases[i], path: [[0.06, bases[i] * 1.45]], at, attack: 0.005, hold: 0.02, release: 0.05, peak: 0.07 });
    }
  },

  // Short breathy inhale: rising filtered noise with a faint tone under it.
  gasp(e, v) {
    e.noise(v, { filter: 'bandpass', freq: 500, path: [[0.18, 1800]], q: 2.5, attack: 0.13, hold: 0.02, release: 0.07, peak: 0.3 });
    e.tone(v, { type: 'sine', freq: 320, path: [[0.18, 560]], attack: 0.12, hold: 0.02, release: 0.06, peak: 0.1 });
  },

  // Tiny UI click.
  ui(e, v) {
    e.noise(v, { filter: 'bandpass', freq: 2600, q: 1.5, attack: 0.001, hold: 0.003, release: 0.01, peak: 0.32 });
    e.tone(v, { type: 'sine', freq: 1300, path: [[0.012, 900]], attack: 0.001, hold: 0.002, release: 0.012, peak: 0.14 });
  },

  // Soft rising four-note arpeggio (C5 E5 G5 C6).
  refill(e, v) {
    const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6];
    for (let i = 0; i < notes.length; i++) {
      const at = i * 0.11;
      e.tone(v, { type: 'triangle', freq: notes[i], at, attack: 0.01, hold: 0.04, release: 0.26, peak: 0.24 });
      e.tone(v, { type: 'sine', freq: notes[i] * 2, at, attack: 0.01, hold: 0.02, release: 0.16, peak: 0.045 });
    }
  },
};

export default AudioEngine;
