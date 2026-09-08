// Tiny tween utility with a central update loop. No external dependencies.
import { motion } from './motion.js';

export const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => --t * t * t + 1,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  outBack: (t) => { const s = 1.70158; return --t * t * ((s + 1) * t + s) + 1; },
  inBack: (t) => { const s = 1.70158; return t * t * ((s + 1) * t - s); },
  outElastic: (t) => (t === 0 || t === 1) ? t : Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1,
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outSine: (t) => Math.sin((t * Math.PI) / 2),
};

const active = new Set();

/**
 * tween({ from, to, duration, ease, delay, onUpdate(v, t), onComplete })
 * from/to can be numbers or objects with numeric fields. Returns a handle with cancel() and a promise.
 * When motion.reduced is true, "bouncy" eases are softened and durations shortened.
 */
export function tween(opts) {
  const h = {
    from: opts.from,
    to: opts.to,
    duration: Math.max(0.0001, opts.duration ?? 0.4) * (motion.reduced ? 0.6 : 1),
    delay: opts.delay ?? 0,
    ease: opts.ease ?? Ease.inOutCubic,
    onUpdate: opts.onUpdate,
    onComplete: opts.onComplete,
    elapsed: 0,
    done: false,
    cancelled: false,
  };
  if (motion.reduced && (h.ease === Ease.outBack || h.ease === Ease.outElastic || h.ease === Ease.outBounce)) {
    h.ease = Ease.outCubic;
  }
  h.promise = new Promise((resolve) => { h._resolve = resolve; });
  h.cancel = () => { h.cancelled = true; active.delete(h); h._resolve(false); };
  active.add(h);
  return h;
}

function lerpValue(from, to, t) {
  if (typeof from === 'number') return from + (to - from) * t;
  const out = {};
  for (const k in to) out[k] = from[k] + (to[k] - from[k]) * t;
  return out;
}

export function updateTweens(dt) {
  for (const h of Array.from(active)) {
    if (h.cancelled) continue;
    if (h.delay > 0) { h.delay -= dt; if (h.delay > 0) continue; h.elapsed += -h.delay; h.delay = 0; }
    else h.elapsed += dt;
    const t = Math.min(1, h.elapsed / h.duration);
    const v = lerpValue(h.from, h.to, h.ease(t));
    if (h.onUpdate) h.onUpdate(v, t);
    if (t >= 1) {
      h.done = true;
      active.delete(h);
      if (h.onComplete) h.onComplete();
      h._resolve(true);
    }
  }
}

/** Promise that resolves after `seconds` of scene time (uses the tween clock). */
export function wait(seconds) {
  return tween({ from: 0, to: 1, duration: Math.max(0.0001, seconds), ease: Ease.linear }).promise;
}

/** Cancel every running tween (used on refill/reset). */
export function cancelAllTweens() {
  for (const h of Array.from(active)) h.cancel();
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Exponential damping toward a target, frame-rate independent. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
