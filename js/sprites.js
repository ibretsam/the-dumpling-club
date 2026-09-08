// Sprite texture generators for The Dumpling Club.
// Small procedural canvases (radial gradients, soft blobs) used by the steam, droplet and crumb
// systems. Every generator returns a THREE.CanvasTexture with SRGBColorSpace, clamped wrapping and
// mipmaps, and results are cached per (name, size) so systems share one GPU texture.
// The only DOM access is document.createElement('canvas'); when no DOM exists (Node import tests)
// a tiny analytic DataTexture stands in so the particle modules still import cleanly.
import * as THREE from 'three';

const cache = new Map();

function hasCanvas() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** Deterministic tiny RNG so sprites look identical on every load. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finishTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Fallback for non-DOM environments: a soft white disc as a DataTexture. */
function fallbackTexture(size, rgb) {
  const n = Math.max(8, Math.min(64, size));
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.max(0, 1 - d * d);
      const i = (y * n + x) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function cached(name, size, painter, fallbackRgb) {
  const key = name + ':' + size;
  if (cache.has(key)) return cache.get(key);
  let tex;
  if (hasCanvas()) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    painter(ctx, size);
    tex = finishTexture(new THREE.CanvasTexture(canvas));
  } else {
    tex = fallbackTexture(size, fallbackRgb || [255, 255, 255]);
  }
  cache.set(key, tex);
  return tex;
}

/**
 * Soft white disc: opaque centre easing to fully transparent at the edge.
 * Shaders should read only the alpha channel (RGB is white everywhere alpha > 0).
 */
export function softDiscTexture({ size = 128 } = {}) {
  return cached('softDisc', size, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.82)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.34)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.07)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/**
 * Cloud-like puff: a handful of overlapping soft blobs masked by a radial falloff so the
 * silhouette is irregular rather than a perfect dot. Used for steam.
 */
export function puffTexture({ size = 128, seed = 7 } = {}) {
  return cached('puff:' + seed, size, (ctx, s) => {
    const rnd = mulberry32(seed);
    const c = s / 2;
    ctx.clearRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'lighter';
    const blobs = 7;
    for (let i = 0; i < blobs; i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = (i === 0 ? 0 : 0.12 + rnd() * 0.22) * s;
      const bx = c + Math.cos(ang) * dist;
      const by = c + Math.sin(ang) * dist;
      const br = (i === 0 ? 0.42 : 0.2 + rnd() * 0.16) * s;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      const peak = i === 0 ? 0.8 : 0.45 + rnd() * 0.25;
      g.addColorStop(0, `rgba(255,255,255,${peak.toFixed(3)})`);
      g.addColorStop(0.5, `rgba(255,255,255,${(peak * 0.45).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    // Radial mask so the puff never touches the quad edge.
    ctx.globalCompositeOperation = 'destination-in';
    const m = ctx.createRadialGradient(c, c, 0, c, c, c);
    m.addColorStop(0, 'rgba(255,255,255,1)');
    m.addColorStop(0.55, 'rgba(255,255,255,1)');
    m.addColorStop(0.9, 'rgba(255,255,255,0.15)');
    m.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = m;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'source-over';
  });
}

/**
 * Irregular dough crumb sprite: warm cream blob with a slightly darker toasted rim and a few
 * speckles. Alpha is 0 outside the blob.
 */
export function crumbTexture({ size = 64, seed = 3 } = {}) {
  return cached('crumb:' + seed, size, (ctx, s) => {
    const rnd = mulberry32(seed);
    const c = s / 2;
    ctx.clearRect(0, 0, s, s);
    const points = 9;
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const r = (0.3 + rnd() * 0.16) * s;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(c - s * 0.08, c - s * 0.1, s * 0.05, c, c, s * 0.46);
    g.addColorStop(0, '#FBF0DC');
    g.addColorStop(0.6, '#F0DFC4');
    g.addColorStop(1, '#D8BC93');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.strokeStyle = 'rgba(160,120,80,0.45)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(150,105,70,0.35)';
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * s * 0.22;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, s * (0.015 + rnd() * 0.02), 0, Math.PI * 2);
      ctx.fill();
    }
  }, [240, 223, 196]);
}

/**
 * Dark glossy soy droplet sprite with a specular highlight; soft anti-aliased edge.
 */
export function dropletTexture({ size = 64 } = {}) {
  return cached('droplet', size, (ctx, s) => {
    const c = s / 2;
    ctx.clearRect(0, 0, s, s);
    const r = s * 0.46;
    const g = ctx.createRadialGradient(c - r * 0.3, c - r * 0.35, r * 0.1, c, c, r);
    g.addColorStop(0, '#6B3A17');
    g.addColorStop(0.45, '#3A1C0A');
    g.addColorStop(1, '#1F0E05');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    // Specular highlight
    const h = ctx.createRadialGradient(c - r * 0.38, c - r * 0.42, 0, c - r * 0.38, c - r * 0.42, r * 0.32);
    h.addColorStop(0, 'rgba(255,255,255,0.95)');
    h.addColorStop(0.4, 'rgba(255,255,255,0.4)');
    h.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = h;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    // Soft edge: fade alpha in the last few pixels.
    ctx.globalCompositeOperation = 'destination-in';
    const m = ctx.createRadialGradient(c, c, r * 0.8, c, c, r);
    m.addColorStop(0, 'rgba(255,255,255,1)');
    m.addColorStop(0.85, 'rgba(255,255,255,1)');
    m.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = m;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'source-over';
  }, [42, 20, 7]);
}

/**
 * Table stain: a wobbly dark spot with a thin darker "coffee ring" rim and a lighter centre.
 * Painted as grey luminance + alpha so the material colour tints it (multiply by a soy brown).
 */
export function stainTexture({ size = 128, seed = 11 } = {}) {
  return cached('stain:' + seed, size, (ctx, s) => {
    const rnd = mulberry32(seed);
    const c = s / 2;
    ctx.clearRect(0, 0, s, s);
    // Wobbly outline
    const points = 24;
    const radii = [];
    for (let i = 0; i < points; i++) radii.push(0.36 + rnd() * 0.08);
    // Smooth radii a bit so it reads as liquid, not a star.
    const smooth = radii.map((r, i) => (radii[(i + points - 1) % points] + r * 2 + radii[(i + 1) % points]) / 4);
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const r = smooth[i] * s;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.save();
    ctx.clip();
    const g = ctx.createRadialGradient(c, c, 0, c, c, s * 0.44);
    g.addColorStop(0, 'rgba(215,215,215,0.55)');
    g.addColorStop(0.7, 'rgba(230,230,230,0.7)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.restore();
    // Slightly blur the outline by stroking a translucent rim.
    ctx.lineWidth = Math.max(1.5, s * 0.03);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.stroke();
  }, [60, 30, 12]);
}

/** Dispose every cached sprite texture (only needed on a full teardown). */
export function disposeSpriteTextures() {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}
