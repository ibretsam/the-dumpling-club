// js/textures.js — The Dumpling Club
//
// Procedural canvas textures for the props: bamboo grain (light and dark), woven bamboo strips
// (colour + matching grayscale bump), the parchment steamer liner (colour + alpha with a ring of
// steam holes), porcelain glaze, the soy sauce surface, and a tileable value-noise helper.
// Everything is painted with the 2D canvas API at runtime — no image files — and every generator
// returns a THREE.CanvasTexture with the right colorSpace (SRGB for colour maps, NoColorSpace for
// bump/alpha), RepeatWrapping where the texture tiles, anisotropy 4 and mipmaps.
//
// Caching: canvases are cached by (generator, options) and textures by (canvas, repeat), so calling
// a generator twice with the same options returns the very same THREE.Texture. Treat the returned
// textures as shared — do not mutate .repeat/.offset/.rotation on them; ask for a different `repeat`
// (or call .clone()) when a material needs its own transform.
//
// The particle sprites (soft disc, puff, crumb, droplet, stain) live in js/sprites.js; they are
// re-exported here so textures.js is the single import for every procedural texture, as the
// contract describes, without duplicating the painters.
//
// Node: when no `document` exists, generators return tiny flat DataTextures instead of canvases so
// modules that import this file can still be import-tested under Node.
import * as THREE from 'three';
import { COLORS } from './config.js';

export { softDiscTexture, puffTexture, crumbTexture, dropletTexture, stainTexture } from './sprites.js';

const canvasCache = new Map();
const textureCache = new Map();

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function hasCanvas() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Deterministic tiny RNG (same seed → same texture on every load). */
function mulberry32(seed) {
  let a = (seed * 1000003) >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Lighten (amount > 0, toward white) or darken (amount < 0, toward black) an sRGB hex colour. */
function shade(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const t = Math.max(-1, Math.min(1, amount));
  const f = (c) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function gray(v) {
  const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${g},${g},${g})`;
}

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Tileable multi-octave value noise as a Float32Array (size*size, values ~0..1, mean ~0.5).
 * The lattice wraps, so the result tiles seamlessly in both directions.
 */
function fbmNoise(size, cells, octaves, seed) {
  const out = new Float32Array(size * size);
  const rng = mulberry32(seed);
  let amp = 1;
  let total = 0;
  let c = Math.max(2, Math.round(cells));
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(c * c);
    for (let i = 0; i < lat.length; i++) lat[i] = rng();
    const scale = c / size;
    for (let y = 0; y < size; y++) {
      const fy = y * scale;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      const y1 = (y0 + 1) % c;
      const row0 = y0 * c;
      const row1 = y1 * c;
      const base = y * size;
      for (let x = 0; x < size; x++) {
        const fx = x * scale;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const x1 = (x0 + 1) % c;
        const a = lat[row0 + x0];
        const b = lat[row0 + x1];
        const cc = lat[row1 + x0];
        const d = lat[row1 + x1];
        out[base + x] += ((a + (b - a) * tx) * (1 - ty) + (cc + (d - cc) * tx) * ty) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
    c *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Tileable grayscale noise canvas (value noise, `octaves` octaves starting at `cells` cells).
 * Cached by parameters. Returns null when there is no DOM.
 */
export function noiseCanvas(size = 256, { seed = 1, cells = 4, octaves = 4, contrast = 2.2 } = {}) {
  if (!hasCanvas()) return null;
  size = Math.max(8, Math.min(1024, Math.round(size)));
  const key = `noise:${size}:${seed}:${cells}:${octaves}:${contrast}`;
  if (canvasCache.has(key)) return canvasCache.get(key);
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const noise = fbmNoise(size, cells, octaves, seed);
  for (let i = 0; i < noise.length; i++) {
    const v = Math.max(0, Math.min(1, 0.5 + (noise[i] - 0.5) * contrast));
    const g = Math.round(v * 255);
    const j = i * 4;
    data[j] = g;
    data[j + 1] = g;
    data[j + 2] = g;
    data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  canvasCache.set(key, canvas);
  return canvas;
}

/** Blend a tileable noise canvas over the whole context with a composite mode. */
function overlayNoise(ctx, w, h, { seed, cells = 3, octaves = 3, alpha = 0.2, mode = 'overlay' }) {
  const n = noiseCanvas(256, { seed, cells, octaves });
  if (!n) return;
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.drawImage(n, 0, 0, w, h);
  ctx.restore();
}

function paintCached(key, w, h, painter) {
  if (canvasCache.has(key)) return canvasCache.get(key);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  painter(ctx, w, h);
  canvasCache.set(key, canvas);
  return canvas;
}

/** Flat 2×2 stand-in for environments without a canvas (Node import tests). */
function fallbackTexture(hex, colorSpace) {
  const [r, g, b] = hexToRgb(hex);
  const data = new Uint8Array(16);
  for (let i = 0; i < 4; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build (or fetch) the THREE texture for a cached canvas.
 * key: canvas cache key; paint: (ctx, w, h) painter; opts: { colorSpace, repeat, wrap, fallback }.
 */
function textureFor(key, w, h, paint, { colorSpace, repeat, wrap, fallback }) {
  const rx = Array.isArray(repeat) ? repeat[0] : 1;
  const ry = Array.isArray(repeat) ? repeat[1] : 1;
  const tkey = `${key}|${rx},${ry}`;
  if (textureCache.has(tkey)) return textureCache.get(tkey);
  let tex;
  if (hasCanvas()) {
    tex = new THREE.CanvasTexture(paintCached(key, w, h, paint));
  } else {
    tex = fallbackTexture(fallback, colorSpace);
  }
  tex.colorSpace = colorSpace;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.repeat.set(rx, ry);
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  textureCache.set(tkey, tex);
  return tex;
}

function clampSize(v, def) {
  const n = Number.isFinite(v) ? Math.round(v) : def;
  return Math.max(16, Math.min(1024, n));
}

// ---------------------------------------------------------------------------------------------
// Bamboo grain
// ---------------------------------------------------------------------------------------------

/**
 * Paint bamboo: warm tan base, soft mottling, long vertical grain streaks of slightly varying
 * tone, a scattering of short darker fibres, faint horizontal node bands and flour-fine speckle.
 * Tiles in both directions (streaks wrap horizontally, node bands span the full width, the streak
 * wander is a sine that returns to zero at the top and bottom).
 */
function paintBambooGrain(ctx, w, h, p) {
  const rng = mulberry32(p.seed);
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, w, h);
  overlayNoise(ctx, w, h, { seed: p.seed * 7 + 3, cells: 3, octaves: 3, alpha: 0.26 });
  // A second, finer mottle for "sheen" variation along the stalk.
  overlayNoise(ctx, w, h, { seed: p.seed * 13 + 5, cells: 6, octaves: 2, alpha: 0.12, mode: 'soft-light' });

  const sx = w / 512;
  const sy = h / 512;

  // Long vertical grain streaks.
  ctx.lineCap = 'butt';
  const count = Math.round(p.grain * sx);
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const width = (0.6 + rng() * rng() * 2.6) * sx;
    const alpha = 0.05 + rng() * 0.17;
    const colour = rng() < 0.52 ? p.light : p.dark;
    const a1 = (rng() - 0.5) * 3 * sx;
    const a2 = (rng() - 0.5) * 2 * sx;
    ctx.strokeStyle = rgba(colour, alpha);
    ctx.lineWidth = width;
    const drawAt = (ox) => {
      ctx.beginPath();
      const steps = 8;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = x + ox + a1 * Math.sin(Math.PI * t) + a2 * Math.sin(2 * Math.PI * t);
        const py = -2 + (h + 4) * t;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };
    drawAt(0);
    if (x < 8 * sx) drawAt(w);
    else if (x > w - 8 * sx) drawAt(-w);
  }

  // Short darker fibres (the vascular bundles that give bamboo its dashed look).
  ctx.lineCap = 'round';
  const fibres = Math.round(p.fibres * sx);
  for (let i = 0; i < fibres; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const len = (10 + rng() * rng() * 90) * sy;
    const width = (0.7 + rng() * 1.3) * sx;
    const alpha = 0.14 + rng() * 0.28;
    ctx.strokeStyle = rgba(p.fibre, alpha);
    ctx.lineWidth = width;
    const drawAt = (ox, oy) => {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + (rng() - 0.5) * 1.5 * sx, y + oy + len);
      ctx.stroke();
    };
    drawAt(0, 0);
    if (y + len > h) drawAt(0, -h);
    if (x < 3 * sx) drawAt(w, 0);
    else if (x > w - 3 * sx) drawAt(-w, 0);
  }

  // Faint horizontal node bands (the joints of the stalk).
  for (let k = 0; k < p.nodes; k++) {
    const y = ((k + 0.28 + rng() * 0.44) / p.nodes) * h;
    const bandH = (5 + rng() * 5) * sy;
    ctx.fillStyle = rgba(p.dark, 0.15);
    ctx.fillRect(0, y, w, bandH);
    ctx.fillStyle = rgba(p.light, 0.34);
    ctx.fillRect(0, y - 2 * sy, w, 2 * sy);
    ctx.fillStyle = rgba(p.fibre, 0.22);
    ctx.fillRect(0, y + bandH, w, 1.5 * sy);
    const g = ctx.createLinearGradient(0, y + bandH, 0, y + bandH + 26 * sy);
    g.addColorStop(0, rgba(p.light, 0.16));
    g.addColorStop(1, rgba(p.light, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, y + bandH, w, 26 * sy);
    const g2 = ctx.createLinearGradient(0, y - 18 * sy, 0, y);
    g2.addColorStop(0, rgba(p.dark, 0));
    g2.addColorStop(1, rgba(p.dark, 0.1));
    ctx.fillStyle = g2;
    ctx.fillRect(0, y - 18 * sy, w, 18 * sy);
  }

  // Fine speckle.
  const speckles = Math.round(260 * sx * sy);
  for (let i = 0; i < speckles; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (0.4 + rng() * 0.8) * sx;
    ctx.fillStyle = rgba(rng() < 0.6 ? p.fibre : p.light, 0.05 + rng() * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Paint bamboo with the grain running along the canvas x axis (for slats and other long parts). */
function paintBambooRotated(ctx, w, h, p) {
  const tmp = makeCanvas(h, w);
  paintBambooGrain(tmp.getContext('2d'), h, w, p);
  ctx.save();
  ctx.translate(w, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

function bambooOptions(opts, defaults) {
  const o = Object.assign({}, defaults, opts || {});
  return {
    width: clampSize(o.width, 512),
    height: clampSize(o.height, 512),
    repeat: o.repeat || [1, 1],
    seed: Number.isFinite(o.seed) ? o.seed : defaults.seed,
    nodes: Math.max(0, Math.round(o.nodes ?? 2)),
    grainAxis: o.grainAxis === 'x' ? 'x' : 'y',
    base: o.base || defaults.base,
    light: o.light || defaults.light,
    dark: o.dark || defaults.dark,
    fibre: o.fibre || defaults.fibre,
    grain: o.grain ?? 240,
    fibres: o.fibres ?? 48,
  };
}

function bambooTextureFrom(name, p) {
  const key = `${name}:${p.width}x${p.height}:${p.seed}:${p.nodes}:${p.grainAxis}:${p.base}:${p.light}:${p.dark}:${p.fibre}:${p.grain}:${p.fibres}`;
  const painter = p.grainAxis === 'x' ? paintBambooRotated : paintBambooGrain;
  return textureFor(key, p.width, p.height, (ctx, w, h) => painter(ctx, w, h, p), {
    colorSpace: THREE.SRGBColorSpace,
    repeat: p.repeat,
    wrap: THREE.RepeatWrapping,
    fallback: p.base,
  });
}

/**
 * Warm tan bamboo with vertical grain (grain runs along v, i.e. the canvas y axis, unless
 * grainAxis: 'x'). Options: { width, height, repeat: [u, v], seed, nodes (horizontal node bands,
 * default 2), grainAxis: 'y' | 'x', base, light, dark, fibre (hex colour overrides) }.
 */
export function bambooTexture(opts = {}) {
  const p = bambooOptions(opts, {
    seed: 1,
    base: COLORS.bamboo,
    light: COLORS.bambooLight,
    dark: '#A67F4F',
    fibre: '#6B4A2A',
  });
  return bambooTextureFrom('bamboo', p);
}

/** Darker, slightly more contrasty bamboo for edge strips, rims and lacquered parts. Same options. */
export function bambooDarkTexture(opts = {}) {
  const p = bambooOptions(opts, {
    seed: 2,
    base: '#A07A4C',
    light: '#C9A26E',
    dark: '#6E4B2B',
    fibre: '#4A3118',
  });
  return bambooTextureFrom('bambooDark', p);
}

// ---------------------------------------------------------------------------------------------
// Woven bamboo strips (plain weave) — colour and bump
// ---------------------------------------------------------------------------------------------

/**
 * Two-directional strips, over/under alternating per cell. The strip that passes under is shaded
 * dark toward the cell edges (it dives beneath the crossing strip), the strip on top gets a full
 * rounded cross-section gradient. `bump` paints the same layout as a height map (bright = high).
 */
function paintWeave(ctx, w, h, p) {
  const rng = mulberry32(p.seed);
  const n = p.strips;
  const cell = w / n;
  const gap = cell * 0.1;
  const sw = cell - gap;
  const bump = p.bump;
  ctx.fillStyle = bump ? '#101010' : '#3F2A18';
  ctx.fillRect(0, 0, w, h);

  const rowTint = [];
  const colTint = [];
  for (let i = 0; i < n; i++) {
    rowTint.push((rng() - 0.5) * 0.14);
    colTint.push((rng() - 0.5) * 0.14);
  }
  const shadeAlpha = bump ? 0.6 : 0.42;
  const dive = cell * 0.36;

  const bodyGradient = (x0, y0, x1, y1, over, tint) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    if (bump) {
      const hi = over ? 0.95 : 0.66;
      const lo = over ? 0.45 : 0.28;
      g.addColorStop(0, gray(lo));
      g.addColorStop(0.5, gray(hi));
      g.addColorStop(1, gray(lo));
    } else {
      g.addColorStop(0, shade(p.base, -0.26 + tint));
      g.addColorStop(0.42, shade(p.base, 0.1 + tint));
      g.addColorStop(0.6, shade(p.base, 0.06 + tint));
      g.addColorStop(1, shade(p.base, -0.3 + tint));
    }
    return g;
  };

  const grainLines = (x0, y0, x1, y1, horizontal) => {
    if (bump) return;
    const lines = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < lines; k++) {
      const t = 0.12 + rng() * 0.76;
      ctx.strokeStyle = rgba(rng() < 0.5 ? p.dark : p.light, 0.08 + rng() * 0.12);
      ctx.lineWidth = 0.6 + rng() * 1.2;
      ctx.beginPath();
      if (horizontal) {
        const y = y0 + (y1 - y0) * t;
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      } else {
        const x = x0 + (x1 - x0) * t;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      ctx.stroke();
    }
  };

  const drawH = (i, j, over) => {
    const x0 = i * cell;
    const y = j * cell + gap / 2;
    ctx.fillStyle = bodyGradient(0, y, 0, y + sw, over, rowTint[j]);
    ctx.fillRect(x0 - 0.5, y, cell + 1, sw);
    grainLines(x0 - 0.5, y + 1, x0 + cell + 0.5, y + sw - 1, true);
    if (!over) {
      let e = ctx.createLinearGradient(x0, 0, x0 + dive, 0);
      e.addColorStop(0, `rgba(0,0,0,${shadeAlpha})`);
      e.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = e;
      ctx.fillRect(x0 - 0.5, y, dive + 0.5, sw);
      e = ctx.createLinearGradient(x0 + cell, 0, x0 + cell - dive, 0);
      e.addColorStop(0, `rgba(0,0,0,${shadeAlpha})`);
      e.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = e;
      ctx.fillRect(x0 + cell - dive, y, dive + 0.5, sw);
    } else if (!bump) {
      // A soft highlight along the crest of the strip that rides on top.
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x0 - 0.5, y + sw * 0.34, cell + 1, sw * 0.18);
    }
  };

  const drawV = (i, j, over) => {
    const x = i * cell + gap / 2;
    const y0 = j * cell;
    ctx.fillStyle = bodyGradient(x, 0, x + sw, 0, over, colTint[i]);
    ctx.fillRect(x, y0 - 0.5, sw, cell + 1);
    grainLines(x + 1, y0 - 0.5, x + sw - 1, y0 + cell + 0.5, false);
    if (!over) {
      let e = ctx.createLinearGradient(0, y0, 0, y0 + dive);
      e.addColorStop(0, `rgba(0,0,0,${shadeAlpha})`);
      e.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = e;
      ctx.fillRect(x, y0 - 0.5, sw, dive + 0.5);
      e = ctx.createLinearGradient(0, y0 + cell, 0, y0 + cell - dive);
      e.addColorStop(0, `rgba(0,0,0,${shadeAlpha})`);
      e.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = e;
      ctx.fillRect(x, y0 + cell - dive, sw, dive + 0.5);
    } else if (!bump) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + sw * 0.34, y0 - 0.5, sw * 0.18, cell + 1);
    }
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if ((i + j) % 2 === 0) {
        drawH(i, j, false);
        drawV(i, j, true);
      } else {
        drawV(i, j, false);
        drawH(i, j, true);
      }
    }
  }
  if (!bump) overlayNoise(ctx, w, h, { seed: p.seed * 5 + 1, cells: 4, octaves: 3, alpha: 0.16 });
}

function weaveOptions(opts, bump) {
  const o = opts || {};
  const strips = Math.max(2, Math.round(o.strips ?? 8));
  return {
    size: clampSize(o.size, 512),
    strips: strips % 2 === 0 ? strips : strips + 1, // even so the pattern tiles
    repeat: o.repeat || [1, 1],
    seed: Number.isFinite(o.seed) ? o.seed : 3,
    base: o.base || COLORS.bamboo,
    light: COLORS.bambooLight,
    dark: '#8C6A3F',
    bump,
  };
}

/**
 * Crossing bamboo strips (plain weave), `strips` strips per tile edge (even number). Options:
 * { size, strips, repeat: [u, v], seed, base }.
 */
export function wovenTexture(opts = {}) {
  const p = weaveOptions(opts, false);
  const key = `woven:${p.size}:${p.strips}:${p.seed}:${p.base}`;
  return textureFor(key, p.size, p.size, (ctx, w, h) => paintWeave(ctx, w, h, p), {
    colorSpace: THREE.SRGBColorSpace,
    repeat: p.repeat,
    wrap: THREE.RepeatWrapping,
    fallback: p.base,
  });
}

/** Grayscale height map matching wovenTexture (same strips/seed → same layout). NoColorSpace. */
export function wovenBumpTexture(opts = {}) {
  const p = weaveOptions(opts, true);
  const key = `wovenBump:${p.size}:${p.strips}:${p.seed}`;
  return textureFor(key, p.size, p.size, (ctx, w, h) => paintWeave(ctx, w, h, p), {
    colorSpace: THREE.NoColorSpace,
    repeat: p.repeat,
    wrap: THREE.RepeatWrapping,
    fallback: '#808080',
  });
}

// ---------------------------------------------------------------------------------------------
// Parchment liner — colour and alpha (steam holes)
// ---------------------------------------------------------------------------------------------

/**
 * Steam hole layout in UV space (0..1, centre at 0.5/0.5, disc radius 0.5): two staggered rings
 * between ~45% and ~80% of the radius, hole radius ~1.7% of the texture width. Deterministic so the
 * colour and alpha maps always agree. Returns [{ u, v, r }].
 */
export function parchmentHoles() {
  const holes = [];
  const ring = (radius01, count, phase, r) => {
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * Math.PI * 2;
      holes.push({ u: 0.5 + 0.5 * radius01 * Math.cos(a), v: 0.5 + 0.5 * radius01 * Math.sin(a), r });
    }
  };
  ring(0.50, 8, 0.2, 0.0165);
  ring(0.74, 14, 0.2 + Math.PI / 14, 0.017);
  return holes;
}

function paintParchment(ctx, w, h, p) {
  const rng = mulberry32(p.seed);
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, w, h);
  overlayNoise(ctx, w, h, { seed: p.seed * 3 + 7, cells: 3, octaves: 4, alpha: 0.16 });
  overlayNoise(ctx, w, h, { seed: p.seed * 11 + 2, cells: 12, octaves: 2, alpha: 0.08, mode: 'soft-light' });
  const s = w / 512;

  // Paper fibres: short, slightly curved hairlines in tan and white.
  ctx.lineCap = 'round';
  const fibres = Math.round(620 * s * s);
  for (let i = 0; i < fibres; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const len = (6 + rng() * rng() * 46) * s;
    const a = rng() * Math.PI * 2;
    const bend = (rng() - 0.5) * len * 0.6;
    const light = rng() < 0.42;
    ctx.strokeStyle = light ? `rgba(255,255,255,${0.08 + rng() * 0.16})` : rgba('#C9B18C', 0.05 + rng() * 0.14);
    ctx.lineWidth = (0.5 + rng() * 0.9) * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const mx = x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend;
    const my = y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend;
    ctx.quadraticCurveTo(mx, my, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  // Tiny inclusions.
  const specks = Math.round(140 * s * s);
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = rgba(rng() < 0.7 ? '#B99C74' : '#8D7454', 0.08 + rng() * 0.16);
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, (0.4 + rng() * 1.1) * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Soft shading and a slightly steamed/translucent ring around each hole.
  for (const hole of parchmentHoles()) {
    const cx = hole.u * w;
    const cy = (1 - hole.v) * h;
    const r = hole.r * w;
    const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 2.4);
    g.addColorStop(0, 'rgba(120,90,60,0.2)');
    g.addColorStop(0.45, 'rgba(120,90,60,0.06)');
    g.addColorStop(1, 'rgba(120,90,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7A6248';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Off-white paper with fibres and shaded steam holes. Options: { size, seed }. Clamped wrapping. */
export function parchmentTexture(opts = {}) {
  const size = clampSize(opts.size, 512);
  const seed = Number.isFinite(opts.seed) ? opts.seed : 4;
  const p = { size, seed, base: COLORS.parchment };
  const key = `parchment:${size}:${seed}`;
  return textureFor(key, size, size, (ctx, w, h) => paintParchment(ctx, w, h, p), {
    colorSpace: THREE.SRGBColorSpace,
    repeat: [1, 1],
    wrap: THREE.ClampToEdgeWrapping,
    fallback: COLORS.parchment,
  });
}

/**
 * Alpha map for the liner: opaque (white) everywhere except the ring of small round holes from
 * parchmentHoles(); fully opaque centre and edge. NoColorSpace, use with alphaTest ≈ 0.5.
 */
export function parchmentAlphaTexture(opts = {}) {
  const size = clampSize(opts.size, 512);
  const key = `parchmentAlpha:${size}`;
  return textureFor(key, size, size, (ctx, w, h) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000000';
    for (const hole of parchmentHoles()) {
      ctx.beginPath();
      ctx.arc(hole.u * w, (1 - hole.v) * h, hole.r * w, 0, Math.PI * 2);
      ctx.fill();
    }
  }, {
    colorSpace: THREE.NoColorSpace,
    repeat: [1, 1],
    wrap: THREE.ClampToEdgeWrapping,
    fallback: '#FFFFFF',
  });
}

// ---------------------------------------------------------------------------------------------
// Porcelain glaze
// ---------------------------------------------------------------------------------------------

function paintPorcelain(ctx, w, h, p) {
  const rng = mulberry32(p.seed);
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, w, h);
  overlayNoise(ctx, w, h, { seed: p.seed * 5 + 9, cells: 2, octaves: 3, alpha: 0.07 });
  const s = w / 512;

  // Cloudy glaze pooling (very soft).
  for (let i = 0; i < 7; i++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const r = (60 + rng() * 140) * s;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const warm = rng() < 0.5;
    g.addColorStop(0, warm ? 'rgba(255,250,240,0.16)' : 'rgba(228,232,236,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // Glaze speckle: mostly faint warm grey, a few bluish and a few warm iron spots.
  const specks = Math.round(1500 * s * s);
  for (let i = 0; i < specks; i++) {
    const t = rng();
    let colour;
    let alpha;
    if (t < 0.78) { colour = '#B6AEA3'; alpha = 0.04 + rng() * 0.08; }
    else if (t < 0.93) { colour = '#8E9EAE'; alpha = 0.05 + rng() * 0.08; }
    else { colour = '#C49A72'; alpha = 0.06 + rng() * 0.1; }
    ctx.fillStyle = rgba(colour, alpha);
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h, (0.35 + rng() * 0.8) * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Near-white porcelain with faint glaze speckle. Options: { size, repeat, seed }. Repeats. */
export function porcelainTexture(opts = {}) {
  const size = clampSize(opts.size, 512);
  const seed = Number.isFinite(opts.seed) ? opts.seed : 5;
  const p = { size, seed, base: COLORS.porcelain };
  const key = `porcelain:${size}:${seed}`;
  return textureFor(key, size, size, (ctx, w, h) => paintPorcelain(ctx, w, h, p), {
    colorSpace: THREE.SRGBColorSpace,
    repeat: opts.repeat || [1, 1],
    wrap: THREE.RepeatWrapping,
    fallback: COLORS.porcelain,
  });
}

// ---------------------------------------------------------------------------------------------
// Soy sauce surface
// ---------------------------------------------------------------------------------------------

function paintSoy(ctx, w, h, p) {
  const rng = mulberry32(p.seed);
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, w, h);
  overlayNoise(ctx, w, h, { seed: p.seed * 3 + 1, cells: 2, octaves: 3, alpha: 0.3 });
  const s = w / 256;

  // Soft amber highlights drifting in the sauce.
  for (let i = 0; i < 6; i++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const r = (30 + rng() * 80) * s;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(p.highlight, 0.1 + rng() * 0.1));
    g.addColorStop(1, rgba(p.highlight, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  // A few thin curved streaks (oil sheen).
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const len = (20 + rng() * 60) * s;
    const a = rng() * Math.PI * 2;
    ctx.strokeStyle = rgba('#8B5A2B', 0.05 + rng() * 0.07);
    ctx.lineWidth = (1 + rng() * 2) * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5,
      x + Math.cos(a) * len, y + Math.sin(a) * len,
    );
    ctx.stroke();
  }
}

/** Dark soy with faint amber highlights. Options: { size, repeat, seed }. Repeats. */
export function soySurfaceTexture(opts = {}) {
  const size = clampSize(opts.size, 256);
  const seed = Number.isFinite(opts.seed) ? opts.seed : 6;
  const p = { size, seed, base: COLORS.soy, highlight: COLORS.soyHighlight };
  const key = `soy:${size}:${seed}`;
  return textureFor(key, size, size, (ctx, w, h) => paintSoy(ctx, w, h, p), {
    colorSpace: THREE.SRGBColorSpace,
    repeat: opts.repeat || [1, 1],
    wrap: THREE.RepeatWrapping,
    fallback: COLORS.soy,
  });
}

// ---------------------------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------------------------

/** Dispose every cached texture and forget the canvases (only needed when tearing the scene down). */
export function disposeProceduralTextures() {
  for (const tex of textureCache.values()) tex.dispose();
  textureCache.clear();
  canvasCache.clear();
}
