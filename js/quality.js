// js/quality.js — device tier and adaptive resolution for The Dumpling Club.
//
// `quality` holds the knobs that other modules read at construction time (face canvas size, face
// repaint rate, pixel-ratio limits). main.js calls configureQuality() once before any dumpling is
// created. AdaptiveResolution watches real frame times and steps the renderer's pixel ratio down
// when the device cannot keep up (and back up when it can), so a mid-range phone keeps a smooth
// frame rate instead of rendering a 3× retina canvas it cannot fill.
//
// No DOM access at module load: tests import the modules that import this one under Node.

export const quality = {
  mobile: false,
  faceSize: 512,          // face / dough canvas size (px) per dumpling
  paintInterval: 1 / 30,  // maximum face repaint rate (s)
  maxPixelRatio: 2,
  minPixelRatio: 1,
  pixelRatio: 1,          // current renderer pixel ratio (AdaptiveResolution owns it)
};

/** Pick the tier once. `devicePixelRatio` is capped: 1.5 on phones, 2 elsewhere. */
export function configureQuality({ mobile = false, devicePixelRatio = 1 } = {}) {
  quality.mobile = !!mobile;
  quality.faceSize = mobile ? 320 : 512;
  quality.paintInterval = mobile ? 1 / 20 : 1 / 30;
  quality.maxPixelRatio = Math.max(1, Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
  quality.minPixelRatio = Math.min(1, quality.maxPixelRatio);
  quality.pixelRatio = quality.maxPixelRatio;
  return quality;
}

/**
 * Frame-time governor. Feed it the raw wall-clock delta every frame; it averages over ~1.5 s
 * windows and steps `quality.pixelRatio` by 0.25: down after one slow window, up after three
 * consecutive fast ones, with a one-window cooldown after any change so it never oscillates.
 * `apply(ratio)` is called when the ratio changes (main.js resizes the renderer).
 */
export class AdaptiveResolution {
  constructor({ apply, windowSeconds = 1.5, slowFrame = 1 / 38, fastFrame = 1 / 57, step = 0.25 } = {}) {
    this.apply = apply;
    this.windowSeconds = windowSeconds;
    this.slowFrame = slowFrame;
    this.fastFrame = fastFrame;
    this.step = step;
    this.enabled = true;
    this._elapsed = 0;
    this._frames = 0;
    this._fastWindows = 0;
    this._cooldown = 1;   // skip the first window: shaders compile and textures upload during it
    this.changes = 0;
  }

  /** Forget the current window (call after a resize or a recording so a burst of slow frames is not blamed on the tier). */
  reset() {
    this._elapsed = 0;
    this._frames = 0;
    this._fastWindows = 0;
    this._cooldown = 1;
  }

  /** @param {number} rawDt wall-clock seconds since the previous frame. Returns true when the ratio changed. */
  update(rawDt) {
    if (!this.enabled || !(rawDt > 0) || rawDt > 0.25) return false; // a paused tab is not a slow device
    this._elapsed += rawDt;
    this._frames++;
    if (this._elapsed < this.windowSeconds || this._frames < 20) return false;
    const average = this._elapsed / this._frames;
    this._elapsed = 0;
    this._frames = 0;
    if (this._cooldown > 0) { this._cooldown--; return false; }

    let next = quality.pixelRatio;
    if (average > this.slowFrame) {
      this._fastWindows = 0;
      next = Math.max(quality.minPixelRatio, quality.pixelRatio - this.step);
    } else if (average < this.fastFrame) {
      this._fastWindows++;
      if (this._fastWindows >= 3) { this._fastWindows = 0; next = Math.min(quality.maxPixelRatio, quality.pixelRatio + this.step); }
    } else {
      this._fastWindows = 0;
    }
    if (Math.abs(next - quality.pixelRatio) < 1e-6) return false;
    quality.pixelRatio = next;
    this._cooldown = 1;
    this.changes++;
    if (this.apply) this.apply(next);
    return true;
  }
}

/** Short haptic pulse where supported (Android Chrome); silent everywhere else. Never throws. */
export function haptic(pattern = 8) {
  try {
    if (quality.mobile && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch (e) { /* not available */ }
}
