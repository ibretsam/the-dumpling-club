// Crumbs for The Dumpling Club.
// Crumbs: one InstancedMesh (max ~120) of tiny irregular low-poly nuggets — mostly dough-coloured,
// a few filling-coloured — thrown from a bite. Each crumb has velocity, gravity, tumbling, a single
// soft bounce, then rests on the floor for ~2 s and shrinks away. Unused instances are scaled to 0.
// Positions are world space (the mesh sits at the world origin).
import * as THREE from 'three';
import { COLORS } from './config.js';
import { motion } from './motion.js';

const GRAVITY = -3.0;
const DRAG = 0.6;          // per-second velocity loss
const REST_TIME = 2.0;     // seconds resting before shrinking
const SHRINK_TIME = 0.45;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _rand = new THREE.Vector3();
const _color = new THREE.Color();
const _doughA = new THREE.Color('#F0DFC4');
const _doughB = new THREE.Color('#E3C9A3');
const _fillA = new THREE.Color(COLORS.filling);
const _fillB = new THREE.Color('#9A6240');

/** A slightly squashed, randomly dented icosahedron: reads as a crumb at 1-3 mm scale. */
function buildCrumbGeometry(seed = 1) {
  const geo = new THREE.IcosahedronGeometry(1, 0); // non-indexed, 20 faces
  const pos = geo.attributes.position;
  const jitter = new Map();
  // Shared corners must move together (the geometry is non-indexed), so hash by position.
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < pos.count; i++) {
    const key = pos.getX(i).toFixed(3) + ',' + pos.getY(i).toFixed(3) + ',' + pos.getZ(i).toFixed(3);
    let j = jitter.get(key);
    if (!j) {
      j = [(rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5];
      jitter.set(key, j);
    }
    pos.setXYZ(i, (pos.getX(i) + j[0]) * 1.05, (pos.getY(i) + j[1]) * 0.78, (pos.getZ(i) + j[2]) * 1.0);
  }
  geo.computeVertexNormals();
  return geo;
}

export class Crumbs {
  /**
   * @param {{ scene?: THREE.Object3D, max?: number }} opts — if `scene` is omitted, add `crumbs.mesh` yourself.
   */
  constructor({ scene = null, max = 120 } = {}) {
    this.max = max;
    this.geometry = buildCrumbGeometry(7);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0,
      flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, max);
    this.mesh.name = 'Crumbs';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({
        state: 0,                 // 0 free, 1 flying, 2 resting, 3 shrinking
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        axis: new THREE.Vector3(0, 1, 0),
        spin: 0,
        size: 0.02,
        sx: 1, sy: 1, sz: 1,
        floorY: 0,
        timer: 0,
        bounced: false,
      });
    }
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this._zero);
      this.mesh.setColorAt(i, _doughA); // create instanceColor up front so the shader compiles once
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this._activeCount = 0;
    if (scene) scene.add(this.mesh);
  }

  get activeCount() {
    return this._activeCount;
  }

  /**
   * Throw crumbs from a world position.
   * dir: THREE.Vector3 bias direction (default: forward toward the camera and slightly up);
   * spread: 0..1 cone randomness; speed: base speed (units/s); floorY: landing height (0 = table);
   * fillingRatio: fraction of filling-coloured bits (default 0.28).
   */
  burst(worldPos, count = 14, { dir = null, spread = 0.6, speed = 1.0, floorY = 0, fillingRatio = 0.28 } = {}) {
    const reduced = motion.reduced;
    if (reduced) {
      count = Math.max(2, Math.round(count * 0.5));
      speed *= 0.7;
    }
    if (dir && dir.isVector3 && dir.lengthSq() > 1e-8) _dir.copy(dir).normalize();
    else _dir.set(0, 0.45, 1).normalize();

    let spawned = 0;
    for (let i = 0; i < this.max && spawned < count; i++) {
      const c = this.items[i];
      if (c.state !== 0) continue;
      c.state = 1;
      c.bounced = false;
      c.floorY = floorY;
      c.timer = 0;
      c.size = 0.012 + Math.random() * 0.018;
      c.sx = 0.8 + Math.random() * 0.5;
      c.sy = 0.7 + Math.random() * 0.4;
      c.sz = 0.8 + Math.random() * 0.5;
      c.pos.set(
        worldPos.x + (Math.random() - 0.5) * 0.05,
        worldPos.y + (Math.random() - 0.5) * 0.04,
        worldPos.z + (Math.random() - 0.5) * 0.05,
      );
      // Velocity: along dir, with a random cone and a little extra lift.
      _rand.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const sp = speed * (0.45 + Math.random() * 0.9);
      c.vel.copy(_dir).multiplyScalar(sp).addScaledVector(_rand, sp * spread * 1.1);
      c.vel.y += 0.25 * sp * (0.5 + Math.random() * 0.5);
      c.quat.setFromAxisAngle(_rand.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), Math.random() * Math.PI * 2);
      c.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      c.spin = (reduced ? 2 : 6) * (0.5 + Math.random()) * (Math.random() < 0.5 ? -1 : 1);
      // Colour: dough or filling, each with a little variation.
      if (Math.random() < fillingRatio) _color.lerpColors(_fillA, _fillB, Math.random());
      else _color.lerpColors(_doughA, _doughB, Math.random());
      this.mesh.setColorAt(i, _color);
      spawned++;
    }
    if (spawned > 0) this.mesh.instanceColor.needsUpdate = true;
    return spawned;
  }

  update(dt) {
    dt = Math.min(Math.max(0, dt || 0), 0.05);
    const reduced = motion.reduced;
    const drag = 1 - DRAG * dt;
    let active = 0;
    let touched = false;

    for (let i = 0; i < this.max; i++) {
      const c = this.items[i];
      if (c.state === 0) continue;
      touched = true;
      active++;
      let scale = 1;

      if (c.state === 1) {
        c.vel.y += GRAVITY * dt;
        c.vel.multiplyScalar(drag);
        c.pos.addScaledVector(c.vel, dt);
        // Tumble.
        _dq.setFromAxisAngle(c.axis, c.spin * dt);
        c.quat.multiply(_dq);
        c.timer += dt;
        const bottom = c.floorY + c.size * 0.5;
        if (c.pos.y <= bottom && c.vel.y < 0) {
          if (!c.bounced && !reduced && c.vel.y < -0.7) {
            c.bounced = true;
            c.pos.y = bottom;
            c.vel.y = -c.vel.y * 0.28;
            c.vel.x *= 0.55;
            c.vel.z *= 0.55;
            c.spin *= 0.5;
          } else {
            // Come to rest, sitting slightly into the surface so it never floats.
            c.pos.y = c.floorY + c.size * 0.42;
            c.vel.set(0, 0, 0);
            c.spin = 0;
            c.state = 2;
            c.timer = REST_TIME * (0.7 + Math.random() * 0.6) * (reduced ? 0.7 : 1);
          }
        } else if (c.timer > 6) {
          // Fell off the world: recycle.
          this._free(i, c);
          continue;
        }
      } else if (c.state === 2) {
        c.timer -= dt;
        if (c.timer <= 0) {
          c.state = 3;
          c.timer = 0;
        }
      } else if (c.state === 3) {
        c.timer += dt;
        const t = Math.min(1, c.timer / SHRINK_TIME);
        scale = 1 - t * t;
        // Sink a little as it shrinks so the base stays on the floor.
        if (t >= 1) {
          this._free(i, c);
          continue;
        }
      }

      _s.set(c.size * c.sx * scale, c.size * c.sy * scale, c.size * c.sz * scale);
      _p.copy(c.pos);
      if (c.state === 3) _p.y = c.floorY + c.size * 0.42 * scale;
      _m.compose(_p, c.quat, _s);
      this.mesh.setMatrixAt(i, _m);
    }

    if (touched) this.mesh.instanceMatrix.needsUpdate = true;
    this._activeCount = active;
  }

  _free(i, c) {
    c.state = 0;
    this.mesh.setMatrixAt(i, this._zero);
  }

  /** Remove every crumb immediately (refill / reset). */
  clear() {
    for (let i = 0; i < this.max; i++) if (this.items[i].state !== 0) this._free(i, this.items[i]);
    this.mesh.instanceMatrix.needsUpdate = true;
    this._activeCount = 0;
  }

  dispose() {
    this.clear();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
