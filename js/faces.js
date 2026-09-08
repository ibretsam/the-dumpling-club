// faces.js — FacePainter: procedural kawaii dumpling faces painted on a canvas texture.
//
// The whole canvas is the dumpling's dough colour (with very subtle mottling and flour
// speckles) so the texture doubles as the body `map`. The face is painted inside the
// DUMPLING.faceUV rect. Geometry convention: u wraps around the body (u = 0.5 at the
// front, +z), v runs from 0 (base) to 1 (top of the knob). The texture is used with the
// default `flipY = true`, so canvas row 0 is v = 1: the TOP of the canvas is the top of
// the dumpling and the face is drawn upright in canvas space.
//
// Because the face rect covers far more surface horizontally (an arc around the body)
// than vertically, drawing a round shape in canvas pixels would appear stretched on the
// model. The painter therefore works in a "face space" that is squeezed horizontally by
// `stretch` = (world width per canvas px) / (world height per canvas px); Dumpling
// measures this from the real geometry and passes it in. A circle in face space is a
// circle on the model.
//
// paint(state) redraws only when the (quantised) state key changes; the dough base is
// cached on an offscreen canvas and only the face region is blitted and repainted.

import * as THREE from 'three';
import { COLORS, DUMPLING, PERSONALITIES } from './config.js';
import { characterFor } from './characters.js';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Every expression name paint() understands ('idle' resolves to the personality default). */
export const EXPRESSIONS = [
  'idle', 'happy', 'surprised', 'worried', 'scared', 'squint', 'wink', 'nom', 'giggle',
  'sleepy', 'dizzy', 'love', 'excited', 'grumpy', 'curious', 'shy',
  // extras used by personality defaults (also valid to request directly)
  'cheeky', 'silly',
];

/** Personality id -> default (idle) expression. */
export const PERSONALITY_FACE = {
  mochi: 'happy',
  pip: 'curious',
  dumpy: 'sleepy',
  bao: 'cheeky',
  pudding: 'shy',
  nori: 'grumpy',
  suki: 'excited',
  momo: 'silly',
};

/**
 * Analytic estimate of the face-rect stretch for a roughly spherical body where u is the
 * angle around and v is (close to) normalised height. Dumpling replaces it with a value
 * measured from the real geometry.
 */
export function estimateFaceStretch() {
  const { u0, u1, v0, v1 } = DUMPLING.faceUV;
  const widthArc = (u1 - u0) * Math.PI * 2 * DUMPLING.radius * 0.92;
  const heightArc = (v1 - v0) * DUMPLING.height * 1.15;
  return (widthArc / (u1 - u0)) / (heightArc / (v1 - v0));
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const INK = COLORS.ink;            // mouth / brow / lid lines
const HIGHLIGHT = '#FFFFFF';
const CHEEK = COLORS.cheek;
const MOUTH_DARK = '#6B2C2C';
const TONGUE = '#F08E96';
const TONGUE_LINE = '#DC737E';
const HEART = '#F0637A';
const HEART_LIGHT = '#FFA7B8';
const SPARKLE = '#FFF4CC';
const SWEAT = '#BFE3F7';
const SWEAT_EDGE = '#8CC6E8';

// Face-space layout (unit = height of the face rect; y grows downward like the canvas).
const EYE_R = 0.15;
const EYE_Y = -0.09;
const CHEEK_X = 0.64;
const CHEEK_Y = 0.15;
const CHEEK_RX = 0.21;
const CHEEK_RY = 0.135;
const MOUTH_Y = 0.27;
const LINE = 0.048;                // default stroke width in face units

// ---------------------------------------------------------------------------
// Expression specs
// ---------------------------------------------------------------------------
// eye kinds: dot | wide | half | happy | flat | squeeze | heart | star | spiral | ring
// mouth kinds: smile | bigSmile | grin | cat | o | tongue | wobble | flat | chew | smirk | pout | dot

function eye(kind, opts) { return Object.assign({ kind, size: 1, lid: 0, lidAngle: 0, lidCurve: 0 }, opts || {}); }
function mouth(kind, opts) { return Object.assign({ kind, size: 1, dx: 0, dy: 0 }, opts || {}); }

const SPECS = {
  happy: {
    eyeL: eye('dot'), eyeR: eye('dot'),
    mouth: mouth('bigSmile'), blush: 0.45,
  },
  surprised: {
    eyeL: eye('wide', { size: 1.32 }), eyeR: eye('wide', { size: 1.32 }),
    browL: { kind: 'arc', lift: 1 }, browR: { kind: 'arc', lift: 1 },
    mouth: mouth('o', { size: 1.45 }), blush: 0.2, mouthOpen: 0.15,
  },
  worried: {
    eyeL: eye('dot', { size: 0.95 }), eyeR: eye('dot', { size: 0.95 }),
    browL: { kind: 'angled', angle: 0.55, lift: 0.3 }, browR: { kind: 'angled', angle: 0.55, lift: 0.3 },
    mouth: mouth('wobble', { size: 0.9, dy: 0.01 }), blush: 0.3, extras: ['sweat'],
  },
  scared: {
    eyeL: eye('ring', { size: 1.25 }), eyeR: eye('ring', { size: 1.25 }),
    browL: { kind: 'angled', angle: 0.7, lift: 0.8 }, browR: { kind: 'angled', angle: 0.7, lift: 0.8 },
    mouth: mouth('wobble', { size: 1.4, dy: 0.02 }), blush: 0.08, mouthOpen: 0.3, extras: ['sweat', 'sweat2'],
  },
  squint: {
    eyeL: eye('squeeze'), eyeR: eye('squeeze'),
    mouth: mouth('dot'), blush: 0.5,
  },
  wink: {
    eyeL: eye('dot'), eyeR: eye('happy'),
    mouth: mouth('smirk'), blush: 0.4,
  },
  cheeky: {
    eyeL: eye('dot'), eyeR: eye('happy'),
    mouth: mouth('cat'), blush: 0.45,
  },
  nom: {
    eyeL: eye('happy'), eyeR: eye('happy'),
    mouth: mouth('chew', { dx: 0.07 }), blush: 0.7, puffCheek: 1,
  },
  giggle: {
    eyeL: eye('happy', { size: 1.1 }), eyeR: eye('happy', { size: 1.1 }),
    mouth: mouth('grin', { size: 1.05 }), blush: 0.6,
  },
  sleepy: {
    eyeL: eye('half', { lid: 0.58, lidCurve: 0.5 }), eyeR: eye('half', { lid: 0.58, lidCurve: 0.5 }),
    mouth: mouth('smile', { size: 0.65, dy: 0.01 }), blush: 0.3,
  },
  dizzy: {
    eyeL: eye('spiral'), eyeR: eye('spiral'),
    mouth: mouth('wobble', { size: 1.1 }), blush: 0.35, tilt: 0.3,
  },
  love: {
    eyeL: eye('heart'), eyeR: eye('heart'),
    mouth: mouth('cat', { size: 0.9, dy: 0.01 }), blush: 0.85, extras: ['heart'],
  },
  excited: {
    eyeL: eye('star', { size: 1.12 }), eyeR: eye('star', { size: 1.12 }),
    mouth: mouth('grin'), blush: 0.5, extras: ['sparkles'],
  },
  grumpy: {
    eyeL: eye('dot', { size: 0.92, lid: 0.32, lidAngle: 0.42 }), eyeR: eye('dot', { size: 0.92, lid: 0.32, lidAngle: 0.42 }),
    browL: { kind: 'angled', angle: -0.6, lift: 0 }, browR: { kind: 'angled', angle: -0.6, lift: 0 },
    mouth: mouth('flat'), blush: 0.2,
  },
  curious: {
    eyeL: eye('wide', { size: 1.22 }), eyeR: eye('wide', { size: 1.22 }),
    browR: { kind: 'arc', lift: 0.8 },
    mouth: mouth('o', { size: 0.85 }), blush: 0.3, tilt: 0.22,
  },
  shy: {
    eyeL: eye('dot', { size: 0.95 }), eyeR: eye('dot', { size: 0.95 }),
    mouth: mouth('pout', { dx: 0.05, dy: 0.01 }), blush: 1, look: { x: 0.6, y: -0.35 },
  },
  silly: {
    eyeL: eye('dot', { size: 1.08 }), eyeR: eye('dot', { size: 0.8, lid: 0.28, lidAngle: -0.35 }),
    mouth: mouth('tongue'), blush: 0.4, tilt: 0.1,
  },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function sstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
function q(v, steps) { return Math.round(v * steps) / steps; }

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ellipsePath(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(1e-4, rx), Math.max(1e-4, ry), 0, 0, Math.PI * 2);
}

function heartPath(ctx, x, y, s) {
  // s = half width. Classic two-lobe heart, point at the bottom.
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.95);
  ctx.bezierCurveTo(x - s * 1.25, y + s * 0.05, x - s * 0.95, y - s * 0.95, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.95, y - s * 0.95, x + s * 1.25, y + s * 0.05, x, y + s * 0.95);
  ctx.closePath();
}

function starPath(ctx, x, y, r, inner) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// FacePainter
// ---------------------------------------------------------------------------

export class FacePainter {
  /**
   * @param {object} opts
   * @param {object} opts.personality  entry from PERSONALITIES
   * @param {number} [opts.size=512]   canvas size in px (square)
   * @param {number} [opts.stretch]    horizontal stretch of the face rect on the model (see header)
   * @param {number} [opts.seed]       seed for the dough mottling
   */
  constructor({ personality, size = 512, stretch, seed, faceUV, skin } = {}) {
    this.faceUV = faceUV || DUMPLING.faceUV;
    this.skin = Object.assign({ color: COLORS.dough, base: 'plain' }, skin || {});
    this.personality = personality || PERSONALITIES[0];
    this.features = characterFor(this.personality.id).face;
    this.size = Math.max(64, Math.round(size));
    this.stretch = (typeof stretch === 'number' && isFinite(stretch) && stretch > 0.2) ? stretch : estimateFaceStretch();
    this.seed = (typeof seed === 'number') ? seed : hashString(this.personality.id || 'dumpling');

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d');

    this.base = document.createElement('canvas');
    this.base.width = this.base.height = this.size;
    this._paintBase();

    // Face rect in canvas pixels (canvas y grows downward, v grows upward).
    const { u0, u1, v0, v1 } = this.faceUV;
    const s = this.size;
    this.rect = { x: u0 * s, y: (1 - v1) * s, w: (u1 - u0) * s, h: (v1 - v0) * s };
    const r = this.rect;
    // Region that gets restored + repainted (cheeks / sparkles may poke past the rect).
    const rx0 = Math.max(0, r.x - r.w * 0.6), rx1 = Math.min(s, r.x + r.w * 1.6);
    const ry0 = Math.max(0, r.y - r.h * 0.2), ry1 = Math.min(s, r.y + r.h * 1.2);
    this.region = { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.anisotropy = 4;
    // flipY stays true (default): canvas row 0 == v = 1 == top of the dumpling.

    this.lastKey = null;
    this.paintCount = 0;
    this.state = { expression: 'idle', blink: 0, lookX: 0, lookY: 0, blush: 0, mouthOpen: 0, tilt: 0 };

    // Draw the full canvas once (base + idle face).
    this.ctx.drawImage(this.base, 0, 0);
    this.paint(this.state);
  }

  /** The personality's default expression name. */
  get idleExpression() {
    return PERSONALITY_FACE[this.personality.id] || 'happy';
  }

  /** Resolve 'idle' / unknown names to a real spec name. */
  resolveExpression(name) {
    if (!name || name === 'idle') return this.idleExpression;
    return SPECS[name] ? name : this.idleExpression;
  }

  /** Change the stretch factor (e.g. after measuring the geometry) and force a repaint. */
  setStretch(stretch) {
    if (typeof stretch === 'number' && isFinite(stretch) && stretch > 0.2 && Math.abs(stretch - this.stretch) > 1e-4) {
      this.stretch = stretch;
      this.lastKey = null;
      this.paint(this.state);
    }
  }

  /**
   * Repaint the face if `state` differs from the last painted state.
   * state: { expression, blink 0..1, lookX -1..1, lookY -1..1 (+ = up), blush 0..1, mouthOpen 0..1, tilt -1..1 }
   * Returns true when a repaint happened.
   */
  paint(state) {
    const st = this.state;
    if (state) {
      if (state.expression !== undefined) st.expression = state.expression;
      if (state.blink !== undefined) st.blink = clamp01(+state.blink || 0);
      if (state.lookX !== undefined) st.lookX = Math.max(-1, Math.min(1, +state.lookX || 0));
      if (state.lookY !== undefined) st.lookY = Math.max(-1, Math.min(1, +state.lookY || 0));
      if (state.blush !== undefined) st.blush = clamp01(+state.blush || 0);
      if (state.mouthOpen !== undefined) st.mouthOpen = clamp01(+state.mouthOpen || 0);
      if (state.tilt !== undefined) st.tilt = Math.max(-1, Math.min(1, +state.tilt || 0));
    }
    const name = this.resolveExpression(st.expression);
    const key = name + '|' + q(st.blink, 20) + '|' + q(st.lookX, 20) + '|' + q(st.lookY, 20) + '|' +
      q(st.blush, 12) + '|' + q(st.mouthOpen, 16) + '|' + q(st.tilt, 16);
    if (key === this.lastKey) return false;
    this.lastKey = key;

    this._draw(SPECS[name], st);
    this.texture.needsUpdate = true;
    this.paintCount++;
    return true;
  }

  dispose() {
    this.texture.dispose();
    this.canvas.width = this.canvas.height = 1;
    this.base.width = this.base.height = 1;
  }

  // -------------------------------------------------------------------------
  // Dough base (cached)
  // -------------------------------------------------------------------------
  _paintBase() {
    const ctx = this.base.getContext('2d');
    const s = this.size;
    const k = s / 512;
    const rnd = mulberry32(this.seed);

    ctx.fillStyle = this.skin.color || COLORS.dough;
    ctx.fillRect(0, 0, s, s);

    // Soft mottling: a handful of large low-contrast blobs.
    for (let i = 0; i < 46; i++) {
      const x = rnd() * s, y = rnd() * s;
      const r = (26 + rnd() * 60) * k;
      const dark = rnd() < 0.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = dark ? 0.05 + rnd() * 0.05 : 0.05 + rnd() * 0.04;
      g.addColorStop(0, dark ? `rgba(232,210,178,${a})` : `rgba(255,248,236,${a})`);
      g.addColorStop(1, 'rgba(232,210,178,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    // Flour speckles (light) and a few darker specks — very low contrast.
    for (let i = 0; i < 170; i++) {
      const x = rnd() * s, y = rnd() * s;
      const r = (0.6 + rnd() * 1.2) * k;
      ctx.fillStyle = `rgba(255,252,244,${0.22 + rnd() * 0.2})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 40; i++) {
      const x = rnd() * s, y = rnd() * s;
      const r = (0.5 + rnd() * 0.8) * k;
      ctx.fillStyle = `rgba(205,180,145,${0.12 + rnd() * 0.12})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    // Slight grounding shade toward the base (v -> 0 is the bottom rows)…
    let g = ctx.createLinearGradient(0, s * 0.80, 0, s);
    g.addColorStop(0, 'rgba(220,196,160,0)');
    g.addColorStop(1, 'rgba(220,196,160,0.28)');
    ctx.fillStyle = g; ctx.fillRect(0, s * 0.80, s, s * 0.20);
    // …and a faint translucent steamed look toward the pleats/knob (top rows).
    g = ctx.createLinearGradient(0, 0, 0, s * 0.28);
    g.addColorStop(0, 'rgba(225,205,178,0.16)');
    g.addColorStop(1, 'rgba(225,205,178,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s * 0.28);

    // Per-type skins.
    const base = this.skin.base;
    if (base === 'browned') {
      // Pan-fried underside: golden, blistered. The base is the bottom rows (v -> 0); on the
      // crescent layout the bottom-back is also the top rows (v -> 1).
      const band = (y0, y1) => {
        const gg = ctx.createLinearGradient(0, y0, 0, y1);
        gg.addColorStop(0, 'rgba(196,128,62,0)');
        gg.addColorStop(0.35, 'rgba(190,107,36,0.62)');
        gg.addColorStop(0.7, 'rgba(158,80,26,0.9)');
        gg.addColorStop(1, 'rgba(140,78,28,0.95)');
        ctx.fillStyle = gg; ctx.fillRect(0, Math.min(y0, y1), s, Math.abs(y1 - y0));
      };
      // The crescent layout puts the belly at v 0.26..0.56, so climb to ~0.5 to be seen from above.
      band(s * 0.38, s); band(s * 0.14, 0);
      for (let i = 0; i < 130; i++) {
        const x = rnd() * s, low = rnd() < 0.78;
        const y = low ? s * 0.6 + rnd() * s * 0.4 : rnd() * s * 0.1;
        const r = (2.5 + rnd() * 9) * k;
        const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
        gg.addColorStop(0, 'rgba(112,58,18,0.6)'); gg.addColorStop(1, 'rgba(112,58,18,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    } else if (base === 'crystal') {
      // Har gow: pink shrimp glowing through the translucent skin.
      const r = this.faceUV;
      const cx = s * (r.u0 + r.u1) / 2, cy = s * (1 - (r.v0 + r.v1) / 2) + s * 0.05;
      const gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.36);
      gg.addColorStop(0, 'rgba(243,146,122,0.48)'); gg.addColorStop(0.55, 'rgba(243,146,122,0.26)'); gg.addColorStop(1, 'rgba(243,146,122,0)');
      ctx.fillStyle = gg; ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 6; i++) {
        const x = cx + (rnd() - 0.5) * s * 0.5, y = cy + (rnd() - 0.5) * s * 0.3, rr = (18 + rnd() * 26) * k;
        const g3 = ctx.createRadialGradient(x, y, 0, x, y, rr);
        g3.addColorStop(0, 'rgba(240,120,100,0.22)'); g3.addColorStop(1, 'rgba(240,120,100,0)');
        ctx.fillStyle = g3; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
      }
    } else if (base === 'yellow') {
      // Siu mai wrapper: egg-yellow with a faint orange freckle.
      for (let i = 0; i < 140; i++) {
        const x = rnd() * s, y = rnd() * s, r = (0.6 + rnd() * 1.5) * k;
        ctx.fillStyle = `rgba(214,148,48,${0.14 + rnd() * 0.2})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    } else if (base === 'fluffy') {
      // Steamed bun: soft, bright, almost matte.
      const gg = ctx.createRadialGradient(s * 0.5, s * 0.45, s * 0.05, s * 0.5, s * 0.45, s * 0.65);
      gg.addColorStop(0, 'rgba(255,255,255,0.2)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg; ctx.fillRect(0, 0, s, s);
    }
  }

  // -------------------------------------------------------------------------
  // Face
  // -------------------------------------------------------------------------
  _draw(spec, st) {
    const ctx = this.ctx;
    const reg = this.region;
    const r = this.rect;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    // Restore the dough under the face region, then clip to it.
    ctx.drawImage(this.base, reg.x, reg.y, reg.w, reg.h, reg.x, reg.y, reg.w, reg.h);
    ctx.beginPath(); ctx.rect(reg.x, reg.y, reg.w, reg.h); ctx.clip();

    // Face space: origin at the rect centre, 1 unit = rect height, x squeezed by stretch.
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(r.h / this.stretch, r.h);
    const tilt = st.tilt + (spec.tilt || 0);
    if (tilt !== 0) ctx.rotate(tilt * 0.14);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Gaze: expression bias + external look. lookY: + is up, face space y is down.
    const bias = spec.look || { x: 0, y: 0 };
    const look = {
      x: Math.max(-1, Math.min(1, st.lookX + bias.x)),
      y: Math.max(-1, Math.min(1, st.lookY + bias.y)),
    };
    const open = 1 - st.blink;
    const blush = clamp01(spec.blush * 0.7 + st.blush * 0.9 + this.features.blush);
    const mouthOpen = Math.max(st.mouthOpen, spec.mouthOpen || 0);

    // Cheeks first (they sit under everything).
    const puff = spec.puffCheek || 0;
    this._cheek(ctx, -CHEEK_X, CHEEK_Y, CHEEK_RX, CHEEK_RY, blush);
    this._cheek(ctx, CHEEK_X + puff * 0.03, CHEEK_Y + puff * 0.02, CHEEK_RX * (1 + puff * 0.45), CHEEK_RY * (1 + puff * 0.5), blush);

    this._markings(ctx);

    // Eyes.
    this._eye(ctx, spec.eyeL, -1, look, open);
    this._eye(ctx, spec.eyeR, +1, look, open);

    // Brows (only when the expression has them).
    if (spec.browL) this._brow(ctx, spec.browL, -1, spec.eyeL);
    if (spec.browR) this._brow(ctx, spec.browR, +1, spec.eyeR);

    if (this.features.mark === 'brows' && !spec.browL) {
      for (const side of [-1,1]) this._brow(ctx, {kind:'angled',angle:-.45,len:.26}, side, side<0?spec.eyeL:spec.eyeR);
    }

    // Mouth.
    this._mouth(ctx, spec.mouth, mouthOpen);

    // Extras.
    if (spec.extras) for (const e of spec.extras) this._extra(ctx, e);

    ctx.restore();
  }

  _cheek(ctx, x, y, rx, ry, blush) {
    const a = 0.14 + 0.62 * blush;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, CHEEK);
    g.addColorStop(0.45, CHEEK);
    g.addColorStop(1, 'rgba(240,154,151,0)');
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _markings(ctx) {
    const mark = this.features.mark;
    ctx.save();
    ctx.fillStyle = '#AA7550'; ctx.strokeStyle = '#B77764'; ctx.lineWidth = .018;
    if (mark === 'freckles' || mark === 'nose-freckles') {
      const spread = mark === 'freckles' ? .52 : .17;
      for (const side of [-1,1]) for (let i=0;i<3;i++) {
        ctx.beginPath();ctx.arc(side*(spread+(i%2)*.09),.14+(i===2?.07:0),.021,0,Math.PI*2);ctx.fill();
      }
    } else if (mark === 'beauty-spot' || mark === 'one-freckle') {
      ctx.beginPath();ctx.arc(mark==='beauty-spot'?.61:-.5,.23,.031,0,Math.PI*2);ctx.fill();
    } else if (mark === 'blush-lines') {
      ctx.globalAlpha=.6;
      for(const side of [-1,1]) for(let i=0;i<3;i++) {const x=side*(.5+i*.07);ctx.beginPath();ctx.moveTo(x,.12);ctx.lineTo(x-.025,.22);ctx.stroke();}
    } else if(mark==='sleep-lines') {
      ctx.globalAlpha=.35;
      for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(side*.29,.095);ctx.quadraticCurveTo(side*.4,.16,side*.5,.095);ctx.stroke();}
    } else if(mark==='sparkle-cheeks') {
      ctx.fillStyle='#C48539';
      for(const side of [-1,1]){starPath(ctx,side*.64,.13,.058,.3);ctx.fill();}
    }
    ctx.restore();
  }

  _eye(ctx, e, side, look, open) {
    const f=this.features, x=side*f.eyeX, y=EYE_Y;
    const asymmetric=1+(f.asymmetry||0)*side;
    ctx.save();ctx.translate(x,y);ctx.scale(f.eyeW*asymmetric,f.eyeH);ctx.translate(-x,-y);
    this._paintEye(ctx,e,side,look,open);
    if(f.lashes && open>.4 && !['squeeze','happy','flat'].includes(e.kind)) {
      ctx.strokeStyle=f.iris;ctx.lineWidth=.024;
      const r=EYE_R*e.size;
      for(let i=0;i<2;i++){const ex=x+side*(r*.78+i*.024),ey=y-r*.55+i*.04;ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex+side*.065,ey-.045);ctx.stroke();}
    }
    ctx.restore();
  }

  // side: -1 = viewer's left eye, +1 = viewer's right eye.
  _paintEye(ctx, e, side, look, open) {
    const ex = side * this.features.eyeX;
    const ey = EYE_Y;
    const r = EYE_R * e.size;
    const toCenter = -side;

    switch (e.kind) {
      case 'happy': {
        // Closed, smiling eye: an upward arch.
        ctx.strokeStyle = INK;
        ctx.lineWidth = LINE * 1.15;
        ctx.beginPath();
        ctx.moveTo(ex - r * 1.05, ey + r * 0.32);
        ctx.quadraticCurveTo(ex, ey - r * 0.85, ex + r * 1.05, ey + r * 0.32);
        ctx.stroke();
        return;
      }
      case 'flat': {
        ctx.strokeStyle = INK;
        ctx.lineWidth = LINE;
        ctx.beginPath();
        ctx.moveTo(ex - r, ey);
        ctx.quadraticCurveTo(ex, ey + r * 0.45, ex + r, ey);
        ctx.stroke();
        return;
      }
      case 'squeeze': {
        // "> <": chevron pointing toward the nose.
        ctx.strokeStyle = INK;
        ctx.lineWidth = LINE * 1.1;
        ctx.beginPath();
        ctx.moveTo(ex - toCenter * r * 0.55, ey - r * 0.7);
        ctx.lineTo(ex + toCenter * r * 0.5, ey);
        ctx.lineTo(ex - toCenter * r * 0.55, ey + r * 0.7);
        ctx.stroke();
        return;
      }
      case 'heart': {
        const s = r * 1.15;
        const o = Math.max(0.12, open);
        ctx.save();
        ctx.translate(ex + look.x * r * 0.15, ey - look.y * r * 0.1 + (1 - o) * r * 0.3);
        ctx.scale(1, o);
        heartPath(ctx, 0, 0, s);
        ctx.fillStyle = HEART; ctx.fill();
        ctx.fillStyle = HEART_LIGHT;
        ellipsePath(ctx, -s * 0.42, -s * 0.38, s * 0.22, s * 0.16); ctx.fill();
        ctx.restore();
        return;
      }
      case 'spiral': {
        const o = Math.max(0.12, open);
        ctx.save();
        ctx.translate(ex, ey + (1 - o) * r * 0.3);
        ctx.scale(1, o);
        ctx.strokeStyle = INK;
        ctx.lineWidth = LINE * 0.9;
        ctx.beginPath();
        const turns = 2.6, n = 64;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const a = t * turns * Math.PI * 2 * side;
          const rr = r * (0.06 + 0.98 * t);
          const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
        return;
      }
      case 'ring': {
        // Scared: white eye with a tiny pupil.
        const o = Math.max(0.1, open);
        const ry = r * o, rx = r * (1 + 0.1 * (1 - o));
        const py = ey + (1 - o) * r * 0.3;
        ctx.fillStyle = HIGHLIGHT;
        ellipsePath(ctx, ex, py, rx, ry); ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = LINE * 0.75;
        ctx.stroke();
        if (o > 0.25) {
          ctx.save();
          ellipsePath(ctx, ex, py, rx, ry); ctx.clip();
          const pr = r * 0.40;
          const px = ex + look.x * r * 0.42, ppy = py - look.y * r * 0.3 * o;
          ctx.fillStyle = this.features.iris;
          ellipsePath(ctx, px, ppy, pr, pr * o); ctx.fill();
          ctx.fillStyle = HIGHLIGHT;
          ellipsePath(ctx, px - pr * 0.3, ppy - pr * 0.3 * o, pr * 0.3, pr * 0.3 * o); ctx.fill();
          ctx.restore();
        }
        return;
      }
      default: {
        // dot | wide | star | half  — the glossy dark eye, optionally with a lid.
        const wide = e.kind === 'wide';
        const star = e.kind === 'star';
        let lid = e.lid || 0;
        if (e.kind === 'half') lid = Math.max(lid, 0.5);
        const lidEff = lid + (1 - lid) * (1 - open);

        const o = Math.max(0.09, open);
        const ry = r * o;
        const rx = r * (1 + 0.14 * (1 - o));
        const px = ex + look.x * r * 0.30;
        const py = ey - look.y * r * 0.22 * o + (1 - o) * r * 0.28;

        ctx.save();
        if (lid > 0) {
          // Clip away the part of the eye covered by the lid.
          const ang = (e.lidAngle || 0) * toCenter;
          ctx.translate(ex, ey);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.rect(-r * 4, -r + 2 * r * lidEff, r * 8, r * 8);
          ctx.clip();
          ctx.rotate(-ang);
          ctx.translate(-ex, -ey);
        }
        const g = ctx.createRadialGradient(px + rx * 0.12, py + ry * 0.38, 0, px, py, Math.max(rx, ry));
        g.addColorStop(0, this.features.gloss);
        g.addColorStop(1, this.features.iris);
        ctx.fillStyle = g;
        ellipsePath(ctx, px, py, rx, ry); ctx.fill();

        const ha = sstep(0.28, 0.75, open);
        if (ha > 0) {
          ctx.globalAlpha = ha * 0.96;
          const hs = wide ? 1.15 : 1;
          if (star) {
            ctx.fillStyle = HIGHLIGHT;
            ctx.save();
            ctx.translate(px - rx * 0.22, py - ry * 0.22);
            ctx.scale(rx, ry);
            starPath(ctx, 0, 0, 0.62, 0.42); ctx.fill();
            ctx.restore();
            ellipsePath(ctx, px + rx * 0.42, py + ry * 0.4, rx * 0.16, ry * 0.16); ctx.fill();
          } else {
            ctx.fillStyle = HIGHLIGHT;
            ellipsePath(ctx, px - rx * 0.32, py - ry * 0.34, rx * 0.34 * hs, ry * 0.34 * hs); ctx.fill();
            ellipsePath(ctx, px + rx * 0.38, py + ry * 0.36, rx * 0.15 * hs, ry * 0.15 * hs); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        ctx.restore();

        if (lid > 0 && lidEff < 0.98) {
          // Lid line along the clip edge.
          const ang = (e.lidAngle || 0) * toCenter;
          ctx.save();
          ctx.translate(ex, ey);
          ctx.rotate(ang);
          const ly = -r + 2 * r * lidEff;
          ctx.strokeStyle = INK;
          ctx.lineWidth = LINE * 0.9;
          ctx.beginPath();
          ctx.moveTo(-rx * 1.05, ly);
          ctx.quadraticCurveTo(0, ly + (e.lidCurve || 0) * r * 0.35, rx * 1.05, ly);
          ctx.stroke();
          ctx.restore();
        } else if (lidEff >= 0.98) {
          // Fully shut lidded eye: a soft closed line.
          ctx.strokeStyle = INK;
          ctx.lineWidth = LINE * 0.9;
          ctx.beginPath();
          ctx.moveTo(ex - rx * 0.95, ey + r * 0.3);
          ctx.quadraticCurveTo(ex, ey + r * 0.55, ex + rx * 0.95, ey + r * 0.3);
          ctx.stroke();
        }

        if (star) {
          // Little sparkle outside the eye.
          ctx.save();
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = SPARKLE;
          const sx = ex - toCenter * r * 1.55, sy = ey - r * 0.75;
          starPath(ctx, sx, sy, r * 0.27, 0.4); ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  _brow(ctx, b, side, e) {
    const ex = side * this.features.eyeX;
    const r = EYE_R * (e ? e.size : 1);
    const toCenter = -side;
    const lift = b.lift || 0;
    const y = EYE_Y - r * 1.35 - lift * 0.11;
    const len = b.len || 0.22;
    ctx.strokeStyle = INK;
    ctx.lineWidth = LINE * (this.features.mark === 'brows' ? 1.45 : .95);
    ctx.beginPath();
    if (b.kind === 'arc') {
      ctx.moveTo(ex - len * 0.5, y + 0.03);
      ctx.quadraticCurveTo(ex, y - 0.075, ex + len * 0.5, y + 0.03);
    } else {
      // angled: positive angle raises the inner end (worried); negative lowers it (grumpy).
      const a = b.angle || 0;
      const ix = ex + toCenter * len * 0.5, ox = ex - toCenter * len * 0.5;
      ctx.moveTo(ox, y + a * len * 0.5);
      ctx.lineTo(ix, y - a * len * 0.5);
    }
    ctx.stroke();
  }

  _mouth(ctx, m, mouthOpen) {
    const s = m.size || 1;
    const my = MOUTH_Y + (m.dy || 0);
    const mx = m.dx || 0;
    const w = 0.30 * s;
    const closedAlpha = 1 - sstep(0.12, 0.65, mouthOpen);
    const openAlpha = sstep(0.03, 0.4, mouthOpen);

    ctx.save();
    ctx.translate(mx, 0);
    ctx.strokeStyle = INK;
    ctx.lineWidth = LINE;

    if (closedAlpha > 0.01) {
      ctx.globalAlpha = closedAlpha;
      switch (m.kind) {
        case 'smile':
          ctx.beginPath();
          ctx.moveTo(-w / 2, my - 0.02);
          ctx.quadraticCurveTo(0, my + 0.13 * s, w / 2, my - 0.02);
          ctx.stroke();
          break;
        case 'bigSmile': {
          const bw = 0.46 * s;
          ctx.lineWidth = LINE * 1.08;
          ctx.beginPath();
          ctx.moveTo(-bw / 2, my - 0.06);
          ctx.bezierCurveTo(-bw / 4, my + 0.20 * s, bw / 4, my + 0.20 * s, bw / 2, my - 0.06);
          ctx.stroke();
          break;
        }
        case 'grin': {
          const gw = 0.40 * s;
          ctx.beginPath();
          ctx.moveTo(-gw / 2, my - 0.04);
          ctx.quadraticCurveTo(0, my + 0.0, gw / 2, my - 0.04);
          ctx.quadraticCurveTo(0, my + 0.36 * s, -gw / 2, my - 0.04);
          ctx.closePath();
          ctx.fillStyle = MOUTH_DARK; ctx.fill();
          ctx.save(); ctx.clip();
          ctx.fillStyle = TONGUE;
          ellipsePath(ctx, 0.01, my + 0.20 * s, 0.13 * s, 0.09 * s); ctx.fill();
          ctx.restore();
          ctx.lineWidth = LINE * 0.85;
          ctx.stroke();
          break;
        }
        case 'cat':
          ctx.beginPath();
          ctx.moveTo(-w / 2, my - 0.03);
          ctx.quadraticCurveTo(-w / 4, my + 0.12 * s, 0, my - 0.01);
          ctx.quadraticCurveTo(w / 4, my + 0.12 * s, w / 2, my - 0.03);
          ctx.stroke();
          break;
        case 'chew': {
          const cw = 0.20 * s;
          ctx.beginPath();
          ctx.moveTo(-cw / 2, my - 0.01);
          ctx.quadraticCurveTo(-cw / 4, my + 0.09, 0, my);
          ctx.quadraticCurveTo(cw / 4, my + 0.09, cw / 2, my - 0.01);
          ctx.stroke();
          break;
        }
        case 'o': {
          ellipsePath(ctx, 0, my + 0.02, 0.055 * s, 0.07 * s);
          ctx.fillStyle = MOUTH_DARK; ctx.fill();
          ctx.lineWidth = LINE * 0.7; ctx.stroke();
          break;
        }
        case 'dot': {
          ellipsePath(ctx, 0, my + 0.01, 0.035, 0.04);
          ctx.fillStyle = INK; ctx.fill();
          break;
        }
        case 'tongue': {
          // Tongue first, then the smile drawn over its root.
          ctx.fillStyle = TONGUE;
          ellipsePath(ctx, 0.07, my + 0.09, 0.075 * s, 0.09 * s); ctx.fill();
          ctx.strokeStyle = TONGUE_LINE; ctx.lineWidth = LINE * 0.45;
          ctx.beginPath(); ctx.moveTo(0.07, my + 0.06); ctx.lineTo(0.07, my + 0.15); ctx.stroke();
          ctx.strokeStyle = INK; ctx.lineWidth = LINE;
          ctx.beginPath();
          ctx.moveTo(-w / 2, my - 0.02);
          ctx.quadraticCurveTo(0, my + 0.13 * s, w / 2, my - 0.02);
          ctx.stroke();
          break;
        }
        case 'wobble': {
          const n = 28;
          ctx.beginPath();
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            const x = -w / 2 + w * t;
            const y = my + 0.03 * s * Math.sin(t * Math.PI * 4) + 0.015 * s * Math.sin(t * Math.PI * 2);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
          break;
        }
        case 'pout': {
          const pw = 0.13 * s;
          ctx.lineWidth = LINE * 0.9;
          ctx.beginPath();
          ctx.moveTo(-pw / 2, my + 0.01);
          ctx.quadraticCurveTo(-pw / 4, my + 0.05, 0, my + 0.005);
          ctx.quadraticCurveTo(pw / 4, my + 0.05, pw / 2, my + 0.01);
          ctx.stroke();
          break;
        }
        case 'smirk':
          ctx.beginPath();
          ctx.moveTo(-w / 2, my + 0.02);
          ctx.quadraticCurveTo(0.02, my + 0.13 * s, w / 2, my - 0.07);
          ctx.stroke();
          break;
        case 'flat':
        default: {
          const fw = 0.26 * s;
          ctx.beginPath();
          ctx.moveTo(-fw / 2, my + 0.01);
          ctx.quadraticCurveTo(0, my - 0.035, fw / 2, my + 0.01);
          ctx.stroke();
          break;
        }
      }
    }

    if (openAlpha > 0.01) {
      // Open mouth: a dark oval with a tongue, grows with mouthOpen.
      const mo = mouthOpen;
      ctx.globalAlpha = openAlpha;
      const rx = (0.06 + 0.08 * mo) * s;
      const ry = (0.03 + 0.13 * mo) * s;
      const oy = my + 0.03 + 0.05 * mo;
      ellipsePath(ctx, 0, oy, rx, ry);
      ctx.fillStyle = MOUTH_DARK; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = TONGUE;
      ellipsePath(ctx, 0, oy + ry * 0.75, rx * 0.8, ry * 0.55); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = INK; ctx.lineWidth = LINE * 0.75;
      ellipsePath(ctx, 0, oy, rx, ry); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _extra(ctx, kind) {
    ctx.save();
    switch (kind) {
      case 'sweat':
      case 'sweat2': {
        const x = kind === 'sweat' ? 0.70 : -0.74;
        const y = kind === 'sweat' ? -0.33 : -0.24;
        const s = kind === 'sweat' ? 1 : 0.75;
        ctx.beginPath();
        ctx.moveTo(x, y - 0.085 * s);
        ctx.bezierCurveTo(x + 0.02 * s, y - 0.02 * s, x + 0.055 * s, y + 0.01 * s, x + 0.055 * s, y + 0.035 * s);
        ctx.bezierCurveTo(x + 0.055 * s, y + 0.075 * s, x - 0.055 * s, y + 0.075 * s, x - 0.055 * s, y + 0.035 * s);
        ctx.bezierCurveTo(x - 0.055 * s, y + 0.01 * s, x - 0.02 * s, y - 0.02 * s, x, y - 0.085 * s);
        ctx.closePath();
        ctx.fillStyle = SWEAT; ctx.fill();
        ctx.strokeStyle = SWEAT_EDGE; ctx.lineWidth = LINE * 0.35; ctx.stroke();
        ctx.fillStyle = HIGHLIGHT;
        ellipsePath(ctx, x - 0.02 * s, y + 0.02 * s, 0.014 * s, 0.018 * s); ctx.fill();
        break;
      }
      case 'sparkles': {
        ctx.fillStyle = SPARKLE;
        ctx.globalAlpha = 0.95;
        starPath(ctx, -0.74, -0.30, 0.07, 0.38); ctx.fill();
        starPath(ctx, 0.76, -0.22, 0.055, 0.38); ctx.fill();
        starPath(ctx, 0.62, 0.02, 0.035, 0.4); ctx.fill();
        break;
      }
      case 'heart': {
        ctx.fillStyle = HEART_LIGHT;
        heartPath(ctx, 0.74, -0.32, 0.06); ctx.fill();
        ctx.fillStyle = HEART;
        heartPath(ctx, -0.70, -0.25, 0.04); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }
}
