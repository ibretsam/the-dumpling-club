// js/quality.js — device tier and adaptive resolution for The Dumpling Club.
//
// `quality` holds the knobs that other modules read at construction time (face canvas size, face
// repaint rate, menu texture scale, pixel-ratio caps). main.js calls configureQuality() once before
// any dumpling is created. AdaptiveResolution watches real frame times and steps the renderer's
// pixel ratio down when the device cannot keep up (and back up when it can), so a mid-range phone
// keeps a smooth frame rate instead of rendering a 3× retina canvas it cannot fill — while a phone
// that can fill it gets crisp text on the menu board instead of an upscaled blur.
//
// No DOM access at module load: tests import the modules that import this one under Node.

export const quality = {
  mobile: false,
  faceSize: 512,          // face / dough canvas size (px) per dumpling
  paintInterval: 1 / 30,  // maximum face repaint rate (s)
  menuTextureScale: 1,    // board canvas oversampling on dense screens (text stays sharp)
  maxPixelRatio: 2,       // the most the governor may ever use
  minPixelRatio: 1,
  tableCap: 2,            // pixel-ratio cap while the animated table (or the title) is up
  menuCap: 2,             // pixel-ratio cap on the mostly static, text-heavy menu
  pixelRatio: 1,          // current renderer pixel ratio (AdaptiveResolution owns it)
};

/**
 * Pick the tier once. The table renders at up to 2× on every device (the pre-existing level);
 * the menu may use the full density of a phone screen (up to 3×) because the board is mostly text
 * and the scene is nearly static there. The menu texture is oversampled on ≥2.5× screens so the
 * paper is never magnified.
 */
export function configureQuality({ mobile = false, devicePixelRatio = 1 } = {}) {
  const dpr = Math.max(1, devicePixelRatio || 1);
  quality.mobile = !!mobile;
  quality.faceSize = mobile ? 320 : 512;
  quality.paintInterval = mobile ? 1 / 20 : 1 / 30;
  quality.menuTextureScale = dpr >= 2.5 ? 1.5 : 1;
  quality.tableCap = Math.min(dpr, 2);
  quality.menuCap = Math.min(dpr, mobile ? 3 : 2);
  quality.maxPixelRatio = Math.max(quality.tableCap, quality.menuCap);
  quality.minPixelRatio = Math.min(1, quality.tableCap);
  quality.pixelRatio = quality.tableCap;
  return quality;
}

/**
 * Frame-time governor. Feed it the raw wall-clock delta every frame; it averages over ~1.5 s
 * windows (ignoring isolated stalls such as shader compiles) and steps `quality.pixelRatio`:
 * down after one slow window (a bigger step when the device is far behind), up after three
 * consecutive fast ones, with a one-window cooldown after any change so it never oscillates. A
 * ratio that proved too slow becomes a ceiling for 30 s. `setCap()` lets the scene lower or raise
 * the allowed ratio instantly (the menu prefers native density; the table stays at ≤ 2×).
 * `apply(ratio)` is called when the ratio changes (main.js resizes the renderer).
 */
export class AdaptiveResolution {
  constructor({ apply, windowSeconds = 1.5, slowFrame = 1 / 38, verySlowFrame = 1 / 24, fastFrame = 1 / 57, step = 0.25, ceilingSeconds = 30 } = {}) {
    this.apply = apply;
    this.windowSeconds = windowSeconds;
    this.slowFrame = slowFrame;
    this.verySlowFrame = verySlowFrame;
    this.fastFrame = fastFrame;
    this.step = step;
    this.ceilingSeconds = ceilingSeconds;
    this.enabled = true;
    this.cap = quality.maxPixelRatio;
    this.ceiling = Infinity;     // a ratio that was too slow, remembered for a while
    this._ceilingClock = 0;
    this._clock = 0;
    this._elapsed = 0;
    this._frames = 0;
    this._fastWindows = 0;
    this._cooldown = 1;          // skip the first window: shaders compile and textures upload during it
    this.changes = 0;
  }

  /** Forget the current window (call after a resize or a recording so a burst of slow frames is not blamed on the tier). */
  reset() {
    this._elapsed = 0;
    this._frames = 0;
    this._fastWindows = 0;
    this._cooldown = 1;
  }

  /** The most the current scene allows. Lowering applies at once; raising jumps up to the remembered ceiling. */
  setCap(cap) {
    this.cap = Math.max(quality.minPixelRatio, Math.min(quality.maxPixelRatio, cap));
    const target = Math.min(this.cap, this.ceiling);
    if (Math.abs(target - quality.pixelRatio) > 1e-6 && (target < quality.pixelRatio || this.cap > quality.pixelRatio)) this._set(target);
  }

  _set(ratio) {
    quality.pixelRatio = ratio;
    this._cooldown = 1;
    this._fastWindows = 0;
    this.changes++;
    if (this.apply) this.apply(ratio);
  }

  /** @param {number} rawDt wall-clock seconds since the previous frame. Returns true when the ratio changed. */
  update(rawDt) {
    if (!this.enabled || !(rawDt > 0) || rawDt > 0.25) return false; // a paused tab is not a slow device
    this._clock += rawDt;
    if (this.ceiling !== Infinity && this._clock - this._ceilingClock > this.ceilingSeconds) this.ceiling = Infinity;
    if (rawDt < 0.12) { this._elapsed += rawDt; this._frames++; } // isolated stalls (compiles, GC) are not the tier's fault
    if (this._elapsed < this.windowSeconds || this._frames < 20) return false;
    const average = this._elapsed / this._frames;
    this._elapsed = 0;
    this._frames = 0;
    if (this._cooldown > 0) { this._cooldown--; return false; }

    const current = quality.pixelRatio;
    let next = current;
    if (average > this.slowFrame) {
      const size = average > this.verySlowFrame ? this.step * 2 : this.step;
      next = Math.max(quality.minPixelRatio, current - size);
      if (next < current) { this.ceiling = current; this._ceilingClock = this._clock; }
    } else if (average < this.fastFrame) {
      this._fastWindows++;
      if (this._fastWindows >= 3) next = Math.min(this.cap, this.ceiling, current + this.step);
    } else {
      this._fastWindows = 0;
    }
    if (Math.abs(next - current) < 1e-6) return false;
    this._set(next);
    return true;
  }
}

/** Short haptic pulse where supported (Android Chrome); silent everywhere else. Never throws. */
export function haptic(pattern = 8) {
  try {
    if (quality.mobile && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch (e) { /* not available */ }
}
