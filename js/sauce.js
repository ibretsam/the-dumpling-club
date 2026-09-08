// Soy sauce for The Dumpling Club.
// SauceSurface: a dense uniform disc in the local XZ plane (y = 0) with CPU-animated ripples —
//   expanding, damped rings computed analytically (heights and normals) only while ripples live.
// Droplets: pooled InstancedMesh of tiny glossy soy spheres with gravity. Droplets that fall into
//   the sauce add a ripple; droplets that reach the table (or another landing disc) leave a small
//   dark stain sprite that fades away.
// Coordinates: the surface is local (bowl positions the mesh at BOWL.sauceY); droplets are world.
import * as THREE from 'three';
import { COLORS, BOWL } from './config.js';
import { motion } from './motion.js';
import { stainTexture } from './sprites.js';

const TWO_PI = Math.PI * 2;

// Ripple defaults (world units, seconds).
const RIPPLE = {
  speed: 0.62,        // wavefront speed
  wavelength: 0.105,  // crest-to-crest distance
  damping: 2.3,       // amplitude decay rate
  width: 0.045,       // initial half-width of the wave packet
  widen: 0.035,       // packet widens over time (dispersion)
  height: 0.012,      // amplitude for strength = 1
  maxAge: 3.4,
  maxCount: 10,       // cap on simultaneous ripples (each costs ~0.1 ms/frame over 3.3k verts)
};

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Build a disc in the XZ plane with near-uniform vertex spacing (concentric rings, ~2πi verts per ring). */
function buildUniformDisc(radius, segments) {
  const rings = Math.max(10, Math.round(segments / 3));
  const positions = [];
  const uvs = [];
  const ringStart = [];
  const ringCount = [];

  ringStart.push(0);
  ringCount.push(1);
  positions.push(0, 0, 0);
  uvs.push(0.5, 0.5);
  for (let i = 1; i <= rings; i++) {
    const f = i / rings;
    const r = radius * f;
    const n = Math.max(8, Math.round(TWO_PI * i));
    ringStart.push(positions.length / 3);
    ringCount.push(n);
    for (let j = 0; j < n; j++) {
      const a = (j / n) * TWO_PI;
      const cx = Math.cos(a);
      const sz = Math.sin(a);
      positions.push(cx * r, 0, sz * r);
      uvs.push(0.5 + 0.5 * cx * f, 0.5 - 0.5 * sz * f);
    }
  }

  const indices = [];
  // Winding chosen so face normals point +y (verified: (inner a, inner a+1, outer b) is CCW from above).
  for (let i = 1; i <= rings; i++) {
    const s0 = ringStart[i - 1];
    const n0 = ringCount[i - 1];
    const s1 = ringStart[i];
    const n1 = ringCount[i];
    if (n0 === 1) {
      for (let j = 0; j < n1; j++) indices.push(s0, s1 + (j + 1) % n1, s1 + j);
      continue;
    }
    let a = 0;
    let b = 0;
    while (a < n0 || b < n1) {
      const nextA = (a + 1) / n0;
      const nextB = (b + 1) / n1;
      if (b >= n1 || (a < n0 && nextA <= nextB)) {
        indices.push(s0 + (a % n0), s0 + ((a + 1) % n0), s1 + (b % n1));
        a++;
      } else {
        indices.push(s0 + (a % n0), s1 + ((b + 1) % n1), s1 + (b % n1));
        b++;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  const pos = new THREE.Float32BufferAttribute(positions, 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', pos);
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  const nrm = new THREE.BufferAttribute(normals, 3);
  nrm.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('normal', nrm);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius + 0.1);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-radius, -0.05, -radius),
    new THREE.Vector3(radius, 0.05, radius),
  );
  return geometry;
}

export class SauceSurface {
  constructor({ radius = BOWL.sauceRadius, segments = 96 } = {}) {
    this.radius = radius;
    this.enabled = true;
    this.ripples = [];
    this._dirty = false;

    this.geometry = buildUniformDisc(radius, segments);
    const p = this.geometry.attributes.position.array;
    const n = p.length / 3;
    this._count = n;
    this._x = new Float32Array(n);
    this._z = new Float32Array(n);
    this._r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this._x[i] = p[i * 3];
      this._z[i] = p[i * 3 + 2];
      this._r[i] = Math.hypot(this._x[i], this._z[i]);
    }

    this.material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(COLORS.soy),
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      sheen: 0.25,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(COLORS.soyHighlight),
      specularIntensity: 1,
      ior: 1.42,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'SauceSurface';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.userData.sauceSurface = this;
  }

  /**
   * Start an expanding damped ring at local (x, z). strength ~0.4 for a droplet, ~1..1.6 for a dip.
   * opts: { delay, speed, wavelength, damping, width }
   */
  addRipple(localX, localZ, strength = 1, opts = {}) {
    if (!this.enabled || !motion.sauce) return;
    if (!Number.isFinite(localX) || !Number.isFinite(localZ)) return;
    // Keep the source inside the disc.
    const d = Math.hypot(localX, localZ);
    const maxR = this.radius * 0.96;
    if (d > maxR) {
      localX *= maxR / d;
      localZ *= maxR / d;
    }
    const s = Math.max(0.05, Math.min(2.5, strength)) * (motion.reduced ? 0.6 : 1);
    const wavelength = opts.wavelength ?? RIPPLE.wavelength;
    const ripple = {
      x: localX,
      z: localZ,
      age: -(opts.delay ?? 0),
      amp: RIPPLE.height * s,
      speed: opts.speed ?? RIPPLE.speed,
      k: TWO_PI / wavelength,
      damping: (opts.damping ?? RIPPLE.damping) * (motion.reduced ? 1.4 : 1),
      width: opts.width ?? RIPPLE.width * (0.85 + 0.3 * Math.min(1.5, s)),
      maxAge: RIPPLE.maxAge,
    };
    this.ripples.push(ripple);
    if (this.ripples.length > RIPPLE.maxCount) this.ripples.shift();
    this._dirty = true;
  }

  /** Same as addRipple but takes a world-space point (uses the mesh's current matrixWorld). */
  addRippleAtWorld(worldPoint, strength = 1, opts = {}) {
    _v.copy(worldPoint);
    this.mesh.worldToLocal(_v);
    this.addRipple(_v.x, _v.z, strength, opts);
  }

  /** A dumpling dip: a strong central ring plus two smaller, slightly delayed followers. */
  dip(localX, localZ, strength = 1.4) {
    this.addRipple(localX, localZ, strength);
    this.addRipple(localX, localZ, strength * 0.45, { delay: 0.16 });
    this.addRipple(localX, localZ, strength * 0.25, { delay: 0.34, wavelength: RIPPLE.wavelength * 0.8 });
  }

  /** World-space version of dip(). */
  dipAtWorld(worldPoint, strength = 1.4) {
    _v.copy(worldPoint);
    this.mesh.worldToLocal(_v);
    this.dip(_v.x, _v.z, strength);
  }

  get active() {
    return this.ripples.length > 0;
  }

  update(dt) {
    if (!this.enabled) return;
    if (this.ripples.length === 0) {
      if (this._dirty) {
        this._flatten();
        this._dirty = false;
      }
      return;
    }
    dt = Math.min(dt, 0.05);
    // Age and cull.
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.age += dt;
      if (rp.age > rp.maxAge || rp.amp * Math.exp(-rp.damping * rp.age) < 1.5e-4) {
        this.ripples.splice(i, 1);
      }
    }
    this._dirty = true;
    this._writeHeights();
  }

  _writeHeights() {
    const pos = this.geometry.attributes.position.array;
    const nrm = this.geometry.attributes.normal.array;
    const n = this._count;
    const R = this.radius;
    const edge0 = R - 0.05; // fade heights to 0 toward the rim so the sauce stays inside the bowl
    const live = [];
    for (const rp of this.ripples) {
      if (rp.age <= 0) continue;
      const w = rp.width + RIPPLE.widen * rp.age;
      live.push({
        x: rp.x, z: rp.z,
        front: rp.speed * rp.age,
        ampNow: rp.amp * Math.exp(-rp.damping * rp.age),
        k: rp.k,
        w,
        invW2: 1 / (w * w),
        cut: w * 2.6,
      });
    }
    const L = live.length;
    for (let i = 0; i < n; i++) {
      const vx = this._x[i];
      const vz = this._z[i];
      let h = 0;
      let gx = 0;
      let gz = 0;
      for (let j = 0; j < L; j++) {
        const rp = live[j];
        const dx = vx - rp.x;
        const dz = vz - rp.z;
        const r = Math.sqrt(dx * dx + dz * dz);
        const s = r - rp.front;
        if (s > rp.cut || s < -rp.cut) continue;
        const env = Math.exp(-s * s * rp.invW2) * rp.ampNow;
        const phase = rp.k * s - Math.PI * 0.5;
        const sn = Math.sin(phase);
        const cs = Math.cos(phase);
        const val = sn * env;
        // d(val)/dr
        const dval = env * (rp.k * cs - sn * 2 * s * rp.invW2);
        h += val;
        if (r > 1e-5) {
          const inv = dval / r;
          gx += inv * dx;
          gz += inv * dz;
        }
      }
      // Rim fade (and its gradient).
      const rv = this._r[i];
      let e = 1;
      let de = 0;
      if (rv > edge0) {
        const t = Math.min(1, (rv - edge0) / (R - edge0));
        e = 1 - t * t * (3 - 2 * t);
        de = -(6 * t * (1 - t)) / (R - edge0);
      }
      const hx = e * gx + (de !== 0 && rv > 1e-5 ? h * de * vx / rv : 0);
      const hz = e * gz + (de !== 0 && rv > 1e-5 ? h * de * vz / rv : 0);
      pos[i * 3 + 1] = h * e;
      // normal = normalize(-dh/dx, 1, -dh/dz)
      const inv = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
      nrm[i * 3] = -hx * inv;
      nrm[i * 3 + 1] = inv;
      nrm[i * 3 + 2] = -hz * inv;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }

  _flatten() {
    const pos = this.geometry.attributes.position.array;
    const nrm = this.geometry.attributes.normal.array;
    for (let i = 0; i < this._count; i++) {
      pos[i * 3 + 1] = 0;
      nrm[i * 3] = 0;
      nrm[i * 3 + 1] = 1;
      nrm[i * 3 + 2] = 0;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }

  /** Remove all ripples and rest flat. */
  calm() {
    this.ripples.length = 0;
    this._flatten();
    this._dirty = false;
  }

  /**
   * Enable/disable the ripple simulation. The sauce itself stays visible in the dish (it is
   * scenery, not an effect); disabling only stops new ripples and flattens the surface.
   * Use setVisible(false) if the dish should actually look empty.
   */
  setEnabled(v) {
    this.enabled = !!v;
    if (!this.enabled) this.calm();
  }

  setVisible(v) {
    this.mesh.visible = !!v;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Droplets
// ---------------------------------------------------------------------------------------------

const GRAVITY = -3.0;          // slightly slow, pleasant (scene scale: 1 unit = 10 cm)
const DROP_DRAG = 0.25;        // per-second velocity loss in air
const STAIN_HOLD = 2.0;        // seconds fully visible
const STAIN_FADE = 4.0;        // seconds fading

export class Droplets {
  /**
   * @param {{ scene?: THREE.Object3D, max?: number, maxStains?: number }} opts
   * If `scene` is omitted, add `droplets.group` to the scene yourself.
   */
  constructor({ scene = null, max = 40, maxStains = 20 } = {}) {
    this.max = max;
    this.group = new THREE.Group();
    this.group.name = 'Droplets';

    this.geometry = new THREE.SphereGeometry(1, 12, 9);
    this.material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(COLORS.soy).lerp(new THREE.Color(COLORS.soyHighlight), 0.18),
      roughness: 0.1,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      sheen: 0.2,
      sheenColor: new THREE.Color(COLORS.soyHighlight),
      ior: 1.42,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, max);
    this.mesh.name = 'DropletInstances';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);

    this.drops = [];
    for (let i = 0; i < max; i++) {
      this.drops.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        radius: 0.018,
        gen: 0,
        age: 0,
      });
    }
    this._zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this._zeroMatrix);
    this.mesh.instanceMatrix.needsUpdate = true;

    // Stains: a small pool of flat quads on the table.
    this.stainGeometry = new THREE.PlaneGeometry(1, 1);
    this.stainGeometry.rotateX(-Math.PI / 2);
    this.stainTexture = stainTexture();
    this.stains = [];
    for (let i = 0; i < maxStains; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.stainTexture,
        color: new THREE.Color('#3E1F0C'),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: true,
      });
      const m = new THREE.Mesh(this.stainGeometry, mat);
      m.visible = false;
      m.renderOrder = 1;
      m.receiveShadow = false;
      this.group.add(m);
      this.stains.push({ mesh: m, mat, active: false, age: 0, hold: STAIN_HOLD, fade: STAIN_FADE, peak: 0.8 });
    }
    this._stainCursor = 0;
    this._liveCount = 0;
    if (scene) scene.add(this.group);
  }

  get liveCount() {
    return this._liveCount;
  }

  /**
   * Spawn droplets at a world position.
   * velocity: THREE.Vector3 base velocity (default gentle fall with slight outward drift) or a
   *           number (speed; directions random in a downward-biased cone).
   * spread:   0..1+ randomisation of velocity (units/s scale ~0.6*spread) and position (~0.03*spread).
   * radius:   droplet radius (default random 0.012..0.024). gen: internal (secondary splashes).
   */
  spawn(worldPos, count = 5, { velocity = null, spread = 0.5, radius = null, gen = 0 } = {}) {
    if (!motion.sauce) return 0;
    if (motion.reduced) count = Math.max(1, Math.round(count * 0.6));
    let spawned = 0;
    for (let i = 0; i < this.drops.length && spawned < count; i++) {
      const d = this.drops[i];
      if (d.alive) continue;
      d.alive = true;
      d.age = 0;
      d.gen = gen;
      d.radius = radius ?? (0.012 + Math.random() * 0.012);
      d.pos.set(
        worldPos.x + (Math.random() - 0.5) * 0.06 * spread,
        worldPos.y + (Math.random() - 0.5) * 0.02,
        worldPos.z + (Math.random() - 0.5) * 0.06 * spread,
      );
      if (velocity && velocity.isVector3) {
        d.vel.copy(velocity);
      } else if (typeof velocity === 'number') {
        const a = Math.random() * TWO_PI;
        const t = Math.random() * 0.6; // cone half-angle ~35deg around -y
        d.vel.set(Math.cos(a) * Math.sin(t), -Math.cos(t), Math.sin(a) * Math.sin(t)).multiplyScalar(velocity);
      } else {
        d.vel.set((Math.random() - 0.5) * 0.25, -0.15 - Math.random() * 0.25, (Math.random() - 0.5) * 0.25);
      }
      d.vel.x += (Math.random() - 0.5) * 0.7 * spread;
      d.vel.y += (Math.random() - 0.5) * 0.4 * spread;
      d.vel.z += (Math.random() - 0.5) * 0.7 * spread;
      if (motion.reduced) d.vel.multiplyScalar(0.7);
      spawned++;
    }
    return spawned;
  }

  /**
   * @param {number} dt
   * @param {{ sauceSurface?: SauceSurface, sauceWorldY?: number, sauceCenter?: THREE.Vector3,
   *           sauceRadius?: number, bowlRadius?: number, tableY?: number,
   *           landings?: Array<{x:number,z:number,radius:number,y:number,stain?:boolean}> }} env
   * sauceCenter/sauceWorldY default to the sauce mesh's world position (so passing just
   * `sauceSurface` works once the bowl group has been positioned). `landings` are extra flat discs
   * (steamer floor, plate) droplets can land on; pass `stain: false` to land without a mark.
   */
  update(dt, env = {}) {
    dt = Math.min(dt, 0.05);
    const tableY = env.tableY ?? 0;
    const sauce = env.sauceSurface || null;
    const sauceR = env.sauceRadius ?? (sauce ? sauce.radius : BOWL.sauceRadius);
    const bowlR = env.bowlRadius ?? BOWL.outerRadius;
    // Sauce centre / height: explicit values win; otherwise read them from the sauce mesh's world
    // matrix (the bowl builder positions the surface at BOWL.sauceY inside the bowl group).
    let center = env.sauceCenter || null;
    let sauceY = env.sauceWorldY;
    if (sauce && (!center || sauceY == null)) {
      _c.setFromMatrixPosition(sauce.mesh.matrixWorld);
      if (!center) center = _c;
      if (sauceY == null) sauceY = _c.y;
    }
    if (sauceY == null) sauceY = center ? center.y : BOWL.sauceY;
    const landings = env.landings || null;
    const drag = 1 - DROP_DRAG * dt;
    let live = 0;
    let any = false;

    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (!d.alive) continue;
      any = true;
      d.age += dt;
      d.vel.y += GRAVITY * dt;
      d.vel.multiplyScalar(drag);
      d.pos.addScaledVector(d.vel, dt);

      let landed = false;

      // Sauce (and bowl wall right around it).
      if (sauce && center && d.pos.y <= sauceY + d.radius * 0.5 && d.vel.y < 0) {
        const dx = d.pos.x - center.x;
        const dz = d.pos.z - center.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= sauceR * 1.2) {
          const speed = d.vel.length();
          const strength = Math.min(1, 0.22 + d.radius * 8 + speed * 0.08);
          if (typeof sauce.addRippleAtWorld === 'function') {
            _v.copy(d.pos);
            _v.y = sauceY;
            sauce.addRippleAtWorld(_v, strength);
          } else {
            sauce.addRipple(dx, dz, strength);
          }
          // Little secondary splash for a fast first-generation drop.
          if (d.gen === 0 && speed > 1.1 && !motion.reduced && Math.random() < 0.55) {
            _v.copy(d.pos);
            _v.y = sauceY + 0.005;
            this.spawn(_v, 1 + (Math.random() < 0.4 ? 1 : 0), {
              velocity: new THREE.Vector3(0, 0.7 + Math.random() * 0.6, 0),
              spread: 0.35,
              radius: 0.008 + Math.random() * 0.004,
              gen: 1,
            });
          }
          landed = true;
          this._release(i, d);
        } else if (dist <= bowlR) {
          // Hit the bowl's rim / outer wall: vanish quietly instead of falling through to the table.
          landed = true;
          this._release(i, d);
        }
      }

      // Other landing discs (steamer floor, plate...).
      if (!landed && landings) {
        for (let k = 0; k < landings.length; k++) {
          const L = landings[k];
          if (d.pos.y <= L.y + d.radius * 0.4 && Math.hypot(d.pos.x - L.x, d.pos.z - L.z) <= L.radius) {
            this._stain(d.pos.x, L.y, d.pos.z, d.radius, L.stain !== false);
            landed = true;
            this._release(i, d);
            break;
          }
        }
      }

      // Table.
      if (!landed && d.pos.y <= tableY + d.radius * 0.4) {
        this._stain(d.pos.x, tableY, d.pos.z, d.radius, true);
        landed = true;
        this._release(i, d);
      }

      if (!landed && (d.pos.y < tableY - 2 || d.age > 8)) {
        landed = true;
        this._release(i, d);
      }

      if (!landed) {
        live++;
        // Teardrop stretch along the velocity.
        const speed = d.vel.length();
        const stretch = 1 + Math.min(0.55, speed * 0.22);
        if (speed > 1e-4) {
          _s.copy(d.vel).multiplyScalar(1 / speed);
          _q.setFromUnitVectors(_up, _s);
        } else {
          _q.identity();
        }
        _s.set(d.radius / Math.sqrt(stretch), d.radius * stretch, d.radius / Math.sqrt(stretch));
        _m.compose(d.pos, _q, _s);
        this.mesh.setMatrixAt(i, _m);
      }
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
    this._liveCount = live;

    // Stains fade.
    for (const s of this.stains) {
      if (!s.active) continue;
      s.age += dt;
      let opacity = s.peak;
      if (s.age > s.hold) opacity = s.peak * Math.max(0, 1 - (s.age - s.hold) / s.fade);
      s.mat.opacity = opacity;
      if (opacity <= 0.001) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
  }

  _release(i, d) {
    d.alive = false;
    this.mesh.setMatrixAt(i, this._zeroMatrix);
  }

  _stain(x, y, z, radius, visible) {
    if (!visible) return;
    // Reuse a free stain, else the oldest.
    let s = null;
    for (const c of this.stains) if (!c.active) { s = c; break; }
    if (!s) {
      s = this.stains[this._stainCursor % this.stains.length];
      this._stainCursor++;
    }
    s.active = true;
    s.age = 0;
    s.peak = 0.62 + Math.random() * 0.2;
    s.hold = STAIN_HOLD * (motion.reduced ? 0.7 : 1);
    s.fade = STAIN_FADE * (motion.reduced ? 0.7 : 1);
    const size = radius * (3.6 + Math.random() * 1.8);
    s.mesh.position.set(x, y + 0.0015, z);
    s.mesh.rotation.set(0, Math.random() * TWO_PI, 0);
    s.mesh.scale.set(size * (0.85 + Math.random() * 0.3), 1, size * (0.85 + Math.random() * 0.3));
    s.mat.opacity = s.peak;
    s.mesh.visible = true;
  }

  /** Remove all droplets and stains immediately (refill / reset). */
  clear() {
    for (let i = 0; i < this.drops.length; i++) {
      if (this.drops[i].alive) this._release(i, this.drops[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const s of this.stains) {
      s.active = false;
      s.mesh.visible = false;
      s.mat.opacity = 0;
    }
    this._liveCount = 0;
  }

  dispose() {
    this.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
    this.stainGeometry.dispose();
    for (const s of this.stains) s.mat.dispose();
  }
}
