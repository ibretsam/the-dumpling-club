// Steam for The Dumpling Club.
// SteamSystem: ~90 soft white puffs rising from a disc around `origin`. Rendered as one Mesh of
// camera-facing quads (InstancedBufferGeometry + ShaderMaterial) so sprite size is reliable on
// every GPU (gl_PointSize caps on mobile make THREE.Points unreliable for large puffs). Each puff
// has its own size, rotation and alpha; the whole system fades in/out via a uniform.
// The simulation runs in the object's local space; `object.position` is the world origin, so the
// integrator can move the steam with the steamer.
import * as THREE from 'three';
import { motion } from './motion.js';
import { puffTexture } from './sprites.js';

const TWO_PI = Math.PI * 2;

const VERT = /* glsl */ `
attribute vec3 aOffset;
attribute vec4 aParam; // x: size, y: rotation, z: alpha, w: unused
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = aParam.z;
  float c = cos(aParam.y);
  float s = sin(aParam.y);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aParam.x;
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  mv.xy += p;                       // view-space billboard
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uFade;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha * uFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SteamSystem {
  /**
   * @param {{ origin?: THREE.Vector3, radius?: number, count?: number, height?: number,
   *           enabled?: boolean, prewarm?: boolean, color?: string }} opts
   */
  constructor({
    origin = new THREE.Vector3(0, 0, 0),
    radius = 0.55,
    count = 90,
    height = 1.6,
    enabled = true,
    prewarm = true,
    color = '#FFFFFF',
  } = {}) {
    this.radius = radius;
    this.count = count;
    this.height = height;
    this.intensity = 1;
    this.enabled = enabled;
    this.fade = enabled ? 1 : 0;      // current global alpha (0..1)
    this.fadeTarget = this.fade;
    this._spawnAcc = 0;
    this._time = 0;

    // Per-particle state (Structure of Arrays).
    this.alive = new Uint8Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.pz = new Float32Array(count);
    this.speed = new Float32Array(count);
    this.swayAmp = new Float32Array(count);
    this.swayFreq = new Float32Array(count);
    this.phase = new Float32Array(count);
    this.rot = new Float32Array(count);
    this.rotSpeed = new Float32Array(count);
    this.size0 = new Float32Array(count);
    this.size1 = new Float32Array(count);
    this.alphaPeak = new Float32Array(count);
    this.driftX = new Float32Array(count);
    this.driftZ = new Float32Array(count);

    // Geometry: one unit quad instanced `count` times.
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.attributes.position);
    geometry.setAttribute('uv', base.attributes.uv);
    this.offsets = new Float32Array(count * 3);
    this.params = new Float32Array(count * 4);
    this.aOffset = new THREE.InstancedBufferAttribute(this.offsets, 3);
    this.aParam = new THREE.InstancedBufferAttribute(this.params, 4);
    this.aOffset.setUsage(THREE.DynamicDrawUsage);
    this.aParam.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aOffset', this.aOffset);
    geometry.setAttribute('aParam', this.aParam);
    geometry.instanceCount = count;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), radius + height);
    this.geometry = geometry;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: puffTexture() },
        uColor: { value: new THREE.Color(color) },
        uFade: { value: this.fade },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: true,
    });

    this.object = new THREE.Mesh(geometry, this.material);
    this.object.name = 'Steam';
    this.object.frustumCulled = false;
    this.object.castShadow = false;
    this.object.receiveShadow = false;
    this.object.position.copy(origin);
    this.object.renderOrder = 10; // draw after other transparent bits (stains, sauce highlights)
    this.object.visible = this.fade > 0;
    // The base geometry is a single unit quad at the origin; never let a recursive raycast hit it.
    this.object.raycast = () => {};

    this._writeAll();
    if (prewarm && enabled) this.warm(3.5);
  }

  /** Move the steam column (world position of the disc centre). */
  setOrigin(v) {
    this.object.position.copy(v);
  }

  /** 0..1 scales spawn rate (and slightly the alpha). */
  setIntensity(v) {
    this.intensity = Math.max(0, Math.min(1.5, v));
  }

  /** Fade the whole column out/in over ~1 s (0.5 s with reduced motion). Spawning stops while disabled. */
  setEnabled(v) {
    this.enabled = !!v;
    this.fadeTarget = this.enabled ? 1 : 0;
    if (this.enabled) this.object.visible = true;
  }

  /** Simulate `seconds` of steam so the column is already there. */
  warm(seconds) {
    const step = 1 / 30;
    for (let t = 0; t < seconds; t += step) this._step(step);
    this._writeAll();
  }

  /** Extra burst of puffs (e.g. when the steamer is refilled). */
  puff(count = 12, strength = 1) {
    if (motion.reduced) count = Math.round(count * 0.5);
    let n = 0;
    for (let i = 0; i < this.count && n < count; i++) {
      if (this.alive[i]) continue;
      this._spawn(i, strength);
      n++;
    }
  }

  _effectiveCount() {
    return motion.reduced ? Math.floor(this.count / 2) : this.count;
  }

  _spawn(i, strength = 1) {
    const reduced = motion.reduced;
    const a = Math.random() * TWO_PI;
    const r = Math.sqrt(Math.random()) * this.radius;
    this.alive[i] = 1;
    this.age[i] = 0;
    this.px[i] = Math.cos(a) * r;
    this.pz[i] = Math.sin(a) * r;
    this.py[i] = Math.random() * 0.03;
    const sp = (0.3 + Math.random() * 0.12) * (reduced ? 0.6 : 1) * (0.85 + strength * 0.15);
    this.speed[i] = sp;
    // Life so the puff dies roughly at `height` given slight acceleration (vy = sp*(1+0.35u)).
    this.life[i] = this.height / (sp * 1.175);
    this.swayAmp[i] = reduced ? 0 : 0.03 + Math.random() * 0.05;
    this.swayFreq[i] = 0.9 + Math.random() * 0.9;
    this.phase[i] = Math.random() * TWO_PI;
    this.rot[i] = Math.random() * TWO_PI;
    this.rotSpeed[i] = (Math.random() - 0.5) * (reduced ? 0.2 : 0.6);
    this.size0[i] = 0.10 + Math.random() * 0.05;
    this.size1[i] = 0.38 + Math.random() * 0.14;
    this.alphaPeak[i] = (0.34 + Math.random() * 0.22) * (reduced ? 0.85 : 1);
    // Puffs drift gently outward as they rise, so the column widens.
    const outward = 0.02 + Math.random() * 0.05;
    this.driftX[i] = Math.cos(a) * outward + (Math.random() - 0.5) * 0.03;
    this.driftZ[i] = Math.sin(a) * outward + (Math.random() - 0.5) * 0.03;
  }

  _step(dt) {
    const n = this._effectiveCount();
    this._time += dt;

    // Spawn: keep ~all effective slots busy at intensity 1.
    if (this.enabled && this.intensity > 0) {
      const meanLife = this.height / (0.36 * (motion.reduced ? 0.6 : 1) * 1.175);
      const rate = (n / meanLife) * this.intensity;
      this._spawnAcc += rate * dt;
      while (this._spawnAcc >= 1) {
        this._spawnAcc -= 1;
        let slot = -1;
        for (let i = 0; i < n; i++) if (!this.alive[i]) { slot = i; break; }
        if (slot < 0) { this._spawnAcc = 0; break; }
        this._spawn(slot);
      }
    }

    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      const u = this.age[i] / this.life[i];
      if (u >= 1 || i >= n) {
        this.alive[i] = 0;
        continue;
      }
      const vy = this.speed[i] * (1 + 0.35 * u);
      this.py[i] += vy * dt;
      this.px[i] += this.driftX[i] * dt;
      this.pz[i] += this.driftZ[i] * dt;
      this.rot[i] += this.rotSpeed[i] * dt;
    }
  }

  _writeAll() {
    const off = this.offsets;
    const par = this.params;
    const time = this._time;
    const reduced = motion.reduced;
    const intensityAlpha = 0.75 + 0.25 * Math.min(1, this.intensity);
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      const p = i * 4;
      if (!this.alive[i]) {
        par[p] = 0;
        par[p + 2] = 0;
        off[o] = 0; off[o + 1] = -1; off[o + 2] = 0;
        continue;
      }
      const u = this.age[i] / this.life[i];
      // Sway: per-puff sinusoid + a slow shared breath of "air".
      let sx = 0;
      let sz = 0;
      if (!reduced) {
        const grow = Math.min(1, this.age[i] * 0.8);
        const s = Math.sin(this.age[i] * this.swayFreq[i] + this.phase[i]) * this.swayAmp[i] * grow;
        sx = s + Math.sin(time * 0.45 + this.py[i] * 1.7) * 0.025 * u;
        sz = Math.cos(this.age[i] * this.swayFreq[i] * 0.7 + this.phase[i]) * this.swayAmp[i] * 0.6 * grow;
      }
      off[o] = this.px[i] + sx;
      off[o + 1] = this.py[i];
      off[o + 2] = this.pz[i] + sz;
      // Size grows quickly then eases; alpha rises fast and fades to 0 at the top.
      const eu = 1 - (1 - u) * (1 - u);
      par[p] = this.size0[i] + (this.size1[i] - this.size0[i]) * eu;
      par[p + 1] = this.rot[i];
      const rise = Math.min(1, u / 0.14);
      const fall = u < 0.42 ? 1 : Math.max(0, 1 - (u - 0.42) / 0.58);
      const fallSmooth = fall * fall * (3 - 2 * fall);
      par[p + 2] = this.alphaPeak[i] * rise * fallSmooth * intensityAlpha;
      par[p + 3] = 0;
    }
    this.aOffset.needsUpdate = true;
    this.aParam.needsUpdate = true;
  }

  update(dt, time) {
    dt = Math.min(Math.max(0, dt || 0), 0.1);
    // Global fade.
    const fadeTime = motion.reduced ? 0.5 : 1.0;
    if (this.fade !== this.fadeTarget) {
      const step = dt / fadeTime;
      this.fade = this.fade < this.fadeTarget ? Math.min(this.fadeTarget, this.fade + step) : Math.max(this.fadeTarget, this.fade - step);
      this.material.uniforms.uFade.value = this.fade;
      if (this.fade <= 0) this.object.visible = false;
    }
    if (!this.object.visible && this.fade <= 0 && !this.enabled) {
      // Fully hidden: let remaining puffs expire cheaply and skip GPU writes.
      for (let i = 0; i < this.count; i++) this.alive[i] = 0;
      return;
    }
    this._step(dt);
    this._writeAll();
  }

  dispose() {
    if (this.object.parent) this.object.parent.remove(this.object);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Convenience: a one-off puff of steam at a world position. Returns { system, update(dt) };
 * call update every frame — it returns false (and has disposed itself) once every puff has
 * risen and faded. No continuous spawning: intensity is 0, only the initial puffs live.
 */
export function makeSteamBurst(scene, worldPos, { count = 14, radius = 0.2, height = 0.9 } = {}) {
  const s = new SteamSystem({ origin: worldPos, radius, count, height, enabled: true, prewarm: false });
  s.setIntensity(0);
  s.puff(count, 1.2);
  scene.add(s.object);
  let elapsed = 0;
  return {
    system: s,
    update(dt) {
      elapsed += dt;
      s.update(dt, elapsed);
      let alive = 0;
      for (let i = 0; i < s.count; i++) alive += s.alive[i];
      if ((alive === 0 && elapsed > 0.25) || elapsed > 30) {
        s.dispose();
        return false;
      }
      return true;
    },
  };
}
