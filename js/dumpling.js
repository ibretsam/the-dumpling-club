// js/dumpling.js — The Dumpling Club
//
// Dumpling: one living dumpling character. Owns the body mesh, its face texture (FacePainter),
// the doughy MeshPhysicalMaterial with the soy "dip coat" shader patch, and all of the little
// life: breathing, blinking, gaze, expressions, hops, wiggles, dangling while held, the puff
// when eaten, and personality quirks.
//
// Scene graph
//   group  (THREE.Group)  — origin at the base centre; the logical seat. main.js positions it,
//                            sets rotation.y to the seat yaw, and reparents it while carrying.
//                            Nothing in this class touches group.position / rotation / scale.
//     body (THREE.Group)  — carries every animation offset: hop height, squash-and-stretch and
//                            breathing scale, head yaw/tilt, wiggle roll, dangling sway, puff.
//       mesh (THREE.Mesh) — the dough body. userData.dumpling = this on group, body and mesh.
//
// Bitten swap — ONE mesh, geometry swap
//   The bitten geometry carries a 'color' attribute (filling colour in the crater, white
//   elsewhere) and needs material.vertexColors = true; that is a material flag, so two meshes
//   would need two materials (and two shader programs). Instead the unbitten geometry gets a
//   derived twin that SHARES its position/normal/uv/index BufferAttributes and adds an all-white
//   'color' attribute (the source geometry object is never modified — it is still usable
//   without vertex colours elsewhere). The twin is cached per source geometry in a WeakMap, so
//   all dumplings share one twin and one set of GPU buffers. setBitten() just swaps
//   mesh.geometry; the material, texture and compiled program stay the same (both geometries
//   have an RGB colour attribute, so the program parameters do not change).
//   Geometries are owned by main.js: dispose() does not dispose them.
//
// Face
//   FacePainter is created with `stretch` = DUMPLING_UV_INFO.circleAspect (surface arc covered
//   by one unit of u divided by the arc covered by one unit of v at the face centre, measured
//   from the real geometry via uvToSurfacePoint) so circles drawn on the canvas are round on the
//   model. Faces are repainted only when their quantised state changes and at most ~30 times a
//   second (the painter dedupes again on its own key).
//
// Dip coat (material.onBeforeCompile)
//   A varying carries the object-space vertex position; in the fragment shader everything below
//   uDipLevel * bodyHeight (with a soft smoothstep edge of ±0.03 units and a faint wobble around
//   the body so the sauce line is not a ruler-straight ring) is mixed toward COLORS.soy (after
//   <color_fragment>, i.e. after the map AND the vertex colour so the bite crater is tinted rather
//   than multiplied by near-black) and its roughness is pulled toward 0.08 (after
//   <roughnessmap_fragment>, where roughnessFactor is declared). Uniforms live in
//   material.userData.uniforms; customProgramCacheKey is a constant so every dumpling shares one
//   compiled program while keeping its own uniform values.
//
// Pivots
//   Seated: head turns and hops pivot at the base. Held: the sway pivots at the pinch point
//   (HOLD_PIVOT_Y, where interaction.js grips the dumpling). Puff: shrinks toward the body
//   centre. The body child's position compensates so the pivot stays fixed.
//
// Public API — see the class. All durations are in scene seconds (dt as passed to update()).

import * as THREE from 'three';
import { COLORS, DUMPLING, PERSONALITIES } from './config.js';
import { motion } from './motion.js';
import { tween, Ease, clamp, damp } from './tween.js';
import { FacePainter } from './faces.js';
import { characterFor } from './characters.js';
import { getType, measureUvInfo } from './dumpling-geometry.js';

// ---------------------------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------------------------

const PAINT_INTERVAL = 1 / 30;      // max face repaint rate (s)
const EYE_Y = 0.21;                 // object-space height of the eyes (face centre is ~0.20)
const HOP_PEAK = 0.035;             // max hop height (units) at strength 1
const BREATH_AMP = 0.02;            // ±2 % on scale y
const HEAD_YAW_MAX = 0.14;          // ≈ 8°
const HEAD_PITCH_MAX = 0.07;        // ≈ 4°
const BLINK_DURATION = 0.21;        // close 0.07 + hold 0.03 + open 0.11 (s)
const DIP_CACHE_KEY = 'dumpling-club-dip-coat-v1';

// Breathing rate in cycles per second, per personality.
const BREATH_RATE = {
  mochi: 0.30, pip: 0.36, dumpy: 0.20, bao: 0.32, pudding: 0.28, nori: 0.24, suki: 0.42, momo: 0.34,
};

const rand = (a, b) => a + Math.random() * (b - a);
const quant = (v, steps) => Math.round(v * steps) / steps;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _euler = new THREE.Euler();

// ---------------------------------------------------------------------------------------------
// Geometry: a vertex-colour-ready twin of the plain body geometry (shared, cached)
// ---------------------------------------------------------------------------------------------

const WHITE_TWINS = new WeakMap();

/**
 * Return a geometry that has a 'color' attribute. If `geometry` already has one it is returned
 * as is; otherwise a derived geometry that shares every attribute (and the index) with the
 * source and adds an all-white RGB colour attribute is built once and cached.
 */
function withVertexColors(geometry) {
  if (!geometry || !geometry.isBufferGeometry) return geometry;
  if (geometry.getAttribute('color')) return geometry;
  let twin = WHITE_TWINS.get(geometry);
  if (twin) return twin;

  twin = new THREE.BufferGeometry();
  twin.name = (geometry.name || 'dumpling-body') + '-vcolor';
  if (geometry.index) twin.setIndex(geometry.index);
  for (const name of Object.keys(geometry.attributes)) twin.setAttribute(name, geometry.attributes[name]);
  const count = geometry.attributes.position.count;
  twin.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  for (const g of geometry.groups) twin.addGroup(g.start, g.count, g.materialIndex);
  if (geometry.boundingSphere) twin.boundingSphere = geometry.boundingSphere.clone();
  else twin.computeBoundingSphere();
  if (geometry.boundingBox) twin.boundingBox = geometry.boundingBox.clone();

  WHITE_TWINS.set(geometry, twin);
  return twin;
}

// ---------------------------------------------------------------------------------------------
// Face stretch measured from the geometry
// ---------------------------------------------------------------------------------------------

function measureFaceStretch(type) {
  try {
    const a = measureUvInfo(type.id).circleAspect;
    return (typeof a === 'number' && isFinite(a) && a > 0.2) ? a : 1;
  } catch (e) { return 1; }
}

// ---------------------------------------------------------------------------------------------
// Material with the dip-coat shader patch
// ---------------------------------------------------------------------------------------------

function buildBodyMaterial(texture, type) {
  const skin = type.skin || {};
  const material = new THREE.MeshPhysicalMaterial({
    map: texture,
    color: 0xffffff,
    roughness: skin.roughness ?? 0.5,
    metalness: 0,
    sheen: skin.sheen ?? 0.4,
    sheenColor: new THREE.Color('#FFDDB5'),
    sheenRoughness: 0.75,
    clearcoat: skin.clearcoat ?? 0.15,
    clearcoatRoughness: skin.clearcoatRoughness ?? 0.6,
    vertexColors: true,
    transparent: (skin.opacity ?? 1) < 1,
    opacity: skin.opacity ?? 1,
  });
  material.name = 'dumpling-dough';

  const uniforms = {
    uDipLevel: { value: 0 },                          // 0..1 of bodyHeight
    uDipAmount: { value: 0 },                         // 0..1 strength
    uDipColor: { value: new THREE.Color(COLORS.soy) }, // linear (three converts the sRGB hex)
    uBodyHeight: { value: type.metrics ? type.metrics.bodyHeight : DUMPLING.bodyHeight },
  };
  material.userData.uniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = 'varying vec3 vDipPos;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\tvDipPos = transformed;'
    );

    shader.fragmentShader = [
      'varying vec3 vDipPos;',
      'uniform float uDipLevel;',
      'uniform float uDipAmount;',
      'uniform vec3 uDipColor;',
      'uniform float uBodyHeight;',
      '',
    ].join('\n') + shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          '\tfloat dipY = uDipLevel * uBodyHeight;',
          '\tfloat dipAng = length( vDipPos.xz ) > 1e-5 ? atan( vDipPos.x, vDipPos.z ) : 0.0;',
          '\tfloat dipWobble = 0.006 * sin( dipAng * 5.0 + 1.3 ) + 0.004 * sin( dipAng * 9.0 - 0.7 );',
          '\tfloat dipMask = ( 1.0 - smoothstep( dipY - 0.03, dipY + 0.03, vDipPos.y - dipWobble ) ) * uDipAmount;',
          '\tdiffuseColor.rgb = mix( diffuseColor.rgb, uDipColor, dipMask );',
        ].join('\n')
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n\troughnessFactor = mix( roughnessFactor, 0.08, dipMask );'
      );
  };
  material.customProgramCacheKey = () => DIP_CACHE_KEY;
  return material;
}

// ---------------------------------------------------------------------------------------------
// Motion curves
// ---------------------------------------------------------------------------------------------

/** Squash-and-stretch hop profile. t 0..1, s = strength 0..1 → { sy (y scale), h (height) }. */
function hopCurve(t, s) {
  let sy = 1, h = 0;
  if (t < 0.18) {
    // Anticipation: squash down.
    const a = t / 0.18;
    sy = 1 - 0.09 * s * Math.sin(Math.PI * a);
  } else if (t < 0.64) {
    // Airborne: parabola; stretch peaks early on the way up and relaxes by the landing.
    const u = (t - 0.18) / 0.46;
    h = HOP_PEAK * s * 4 * u * (1 - u);
    sy = 1 + 0.07 * s * Math.sin(Math.PI * Math.pow(u, 0.6));
  } else if (t < 0.82) {
    // Landing squash.
    const c = (t - 0.64) / 0.18;
    sy = 1 - 0.11 * s * Math.sin(Math.PI * c);
  } else {
    // Settle: a small damped wobble.
    const d = (t - 0.82) / 0.18;
    sy = 1 + 0.03 * s * Math.sin(2 * Math.PI * d) * (1 - d);
  }
  return { sy, h };
}

/** Yawn mouth pulse: rise, hold, fall. t in seconds, returns 0..1. */
function yawnPulse(t) {
  if (t < 0.55) return Ease.inOutSine(t / 0.55);
  if (t < 1.25) return 1;
  if (t < 2.0) return 1 - Ease.inOutSine((t - 1.25) / 0.75);
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Dumpling
// ---------------------------------------------------------------------------------------------

export class Dumpling {
  /**
   * @param {object} opts
   * @param {object|string} opts.personality  PERSONALITIES entry (or its id)
   * @param {THREE.BufferGeometry} opts.bodyGeometry
   * @param {THREE.BufferGeometry} [opts.bittenGeometry]
   * @param {number} [opts.index]
   */
  constructor({ personality, type, bodyGeometry, bittenGeometry, index = 0 } = {}) {
    this.index = index;
    this.type = typeof type === 'string' ? getType(type) : (type || getType('xiaolongbao'));
    this.fitScale = 1;               // set by main when a big portion is scaled to fit the vessel
    this.personality = resolvePersonality(personality, index);
    this.character = characterFor(this.personality.id);
    this.state = 'seated';

    // Plain properties owned by main.js / interaction.js.
    this.seat = new THREE.Vector3();
    this.seatYaw = 0;
    this.dipped = false;
    this.bitten = false;
    this.held = false;

    // --- geometry / material / meshes ------------------------------------------------------
    this._bodyGeometry = withVertexColors(bodyGeometry);
    this._bittenGeometry = bittenGeometry ? withVertexColors(bittenGeometry) : null;

    this.painter = new FacePainter({ personality: this.personality, stretch: measureFaceStretch(this.type), faceUV: this.type.faceUV, skin: this.type.skin });
    this.material = buildBodyMaterial(this.painter.texture, this.type);
    this.uniforms = this.material.userData.uniforms;

    this.group = new THREE.Group();
    this.group.name = 'dumpling-' + this.personality.id;
    this.body = new THREE.Group();
    this.body.name = 'body';
    this.mesh = new THREE.Mesh(this._bodyGeometry, this.material);
    this.mesh.name = 'DumplingBody';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.body.add(this.mesh);
    this.extras = [];
    this._buildExtras();
    this.group.add(this.body);
    this.group.userData.dumpling = this;
    this.body.userData.dumpling = this;
    this.mesh.userData.dumpling = this;

    // --- face state ------------------------------------------------------------------------
    this.expression = 'idle';
    this._expressionUntil = 0;          // clock time to return to idle (0 = keep)
    this.blush = 0;
    this._blushTarget = 0;
    this.mouthOpen = 0;
    this.faceTilt = 0;
    this.look = { x: 0, y: 0 };
    this._lookTarget = null;            // THREE.Vector3 | null (world)
    this._lookTargetStore = new THREE.Vector3();
    this._quirkLook = null;             // { x, y, tilt, world:Vector3|null, until }
    this._faceState = { expression: 'idle', blink: 0, lookX: 0, lookY: 0, blush: 0, mouthOpen: 0, tilt: 0 };
    this._paintAccum = 0;
    this._faceDirty = true;

    // --- blink -----------------------------------------------------------------------------
    this._blinkTimer = rand(...this.character.blink);
    this._blinkT = -1;                  // <0 idle, else elapsed time in the blink
    this._blinkQueue = 0;
    this._blinkValue = 0;

    // --- body motion -----------------------------------------------------------------------
    this._clock = 0;
    this._breathPhase = Math.random() * Math.PI * 2;
    this._breathRate = BREATH_RATE[this.personality.id] || 0.3;
    this._hop = { sy: 1, h: 0 };
    this._hopHandle = null;
    this._wiggleT = -1;
    this._wiggleAmp = 1;
    this._yawnT = -1;
    this._heldTime = 0;
    this._swayImpulse = 0;
    this._headYaw = 0;
    this._headPitch = 0;
    this._roll = 0;
    this._swayX = 0;
    this._swayZ = 0;
    this._puffScale = 1;
    this._puffHandle = null;
    this._puffPromise = null;
    this._puffId = 0;
    this._quirkTimer = rand(...this.character.quirks);
    this._queue = [];                   // [{ at, fn }]
    this._camera = null;
    this.dipLevel = 0;
    this.dipAmount = 0;

    this._paintFace(true);
  }

  // -------------------------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------------------------

  /** World position of the group origin (base centre). */
  worldPosition(target = new THREE.Vector3()) {
    return this.group.getWorldPosition(target);
  }

  /** World position just above the top of the body (follows hops / sway). */
  headWorldPosition(target = new THREE.Vector3()) {
    target.set(0, this.type.metrics.height + 0.05, 0);
    return this.body.localToWorld(target);
  }

  /** True while the dumpling is doing something (not seated, hopping, wiggling, yawning, puffing). */
  get isBusy() {
    return this.state !== 'seated' || this._hopActive() || this._wiggleT >= 0 || this._yawnT >= 0 || this._puffActive();
  }

  _hopActive() {
    const h = this._hopHandle;
    return !!h && !h.done && !h.cancelled;
  }

  _puffActive() {
    const h = this._puffHandle;
    return !!h && !h.done && !h.cancelled;
  }

  // -------------------------------------------------------------------------------------------
  // Expressions / gaze / blink
  // -------------------------------------------------------------------------------------------

  /** Set an expression; hold > 0 returns to the personality idle after `hold` seconds. */
  setExpression(name, { hold = 0 } = {}) {
    this.expression = name || 'idle';
    this._expressionUntil = hold > 0 ? this._clock + hold : 0;
    this._faceDirty = true;
    this._paintFace(true);
  }

  reactTo(event, { hold = 0 } = {}) {
    this.setExpression(this.character.reactions[event] || 'idle', {hold});
    if (event === 'hover') {
      this.blink();
      if (!motion.reduced && this.character.energy > .7) this.wiggle(this.character.energy * .6);
    }
  }

  /** Pupils (and a small head turn) track a world point; null relaxes. */
  lookAt(worldPoint) {
    if (worldPoint && typeof worldPoint.x === 'number') {
      this._lookTargetStore.copy(worldPoint);
      this._lookTarget = this._lookTargetStore;
    } else {
      this._lookTarget = null;
    }
  }

  /** Blink now (queued if a blink is already running). */
  blink() {
    if (this._blinkT >= 0) this._blinkQueue = Math.min(2, this._blinkQueue + 1);
    else this._blinkT = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Body actions
  // -------------------------------------------------------------------------------------------

  /** Low squash-and-stretch hop (peak ≤ 0.035). Reduced motion: only a tiny squash. */
  hop(strength = 1) {
    if (this.state !== 'seated' || this._hopActive()) return;
    const s = clamp(+strength || 0, 0.15, 1);
    if (motion.reduced) {
      this._hopHandle = tween({
        from: 0, to: 1, duration: 0.3, ease: Ease.linear,
        onUpdate: (t) => { this._hop.sy = 1 - 0.03 * Math.sin(Math.PI * t); this._hop.h = 0; },
        onComplete: () => { this._hop.sy = 1; this._hop.h = 0; },
      });
      return;
    }
    this._hopHandle = tween({
      from: 0, to: 1, duration: 0.42 + 0.13 * s, ease: Ease.linear,
      onUpdate: (t) => { const c = hopCurve(t, s); this._hop.sy = c.sy; this._hop.h = c.h; },
      onComplete: () => { this._hop.sy = 1; this._hop.h = 0; },
    });
  }

  /** Side-to-side jiggle (attention). */
  wiggle(strength = this.character.energy) {
    if (this.state === 'eaten') return;
    this._wiggleT = 0;
    this._wiggleAmp = (motion.reduced ? .3 : 1) * clamp(strength, 0, 1);
  }

  /** Held by the chopsticks: gentle dangling sway; released: back to seated. */
  setHeld(on) {
    on = !!on;
    if (on === this.held) return;
    this.held = on;
    if (on) {
      this.state = 'picked';
      this._heldTime = 0;
      this._swayImpulse = motion.reduced ? 0 : 1;
      this._blushTarget = 0.35;
      this._quirkLook = null;
      this._yawnT = -1;
      this._cancelHop();
    } else {
      if (this.state === 'picked') this.state = 'seated';
      this._blushTarget = 0;
      this._swayImpulse = 0;
      this._quirkTimer = rand(...this.character.quirks);
    }
  }

  /** Sauce coat: level = 0..1 of bodyHeight below which the dough is glossy soy; amount = strength. */
  setDip(level01, amount01) {
    this.dipLevel = clamp(+level01 || 0, 0, 1);
    this.dipAmount = clamp(+amount01 || 0, 0, 1);
    this.uniforms.uDipLevel.value = this.dipLevel;
    this.uniforms.uDipAmount.value = this.dipAmount;
    if (this.dipAmount > 0.01 && this.dipLevel > 0.001) this.dipped = true;
  }

  /** Swap to the bitten geometry (same material / texture). */
  setBitten(on) {
    on = !!on && !!this._bittenGeometry;
    if (on === this.bitten) return;
    this.bitten = on;
    this.mesh.geometry = on ? this._bittenGeometry : this._bodyGeometry;
  }

  /** Eaten: quick scale-down with a tiny overshoot + fade; hides the group. Returns a promise. */
  puff() {
    if (this.state === 'eaten') return this._puffPromise || Promise.resolve(true);
    this.state = 'eaten';
    const id = ++this._puffId;
    this._cancelHop();
    this._wiggleT = -1;
    this._yawnT = -1;
    this._quirkLook = null;
    this._lookTarget = null;
    this._queue.length = 0;
    this.material.transparent = true;
    this.material.opacity = 1;
    const overshoot = motion.reduced ? 0 : 0.12;

    this._puffHandle = tween({
      from: 0, to: 1, duration: 0.35, ease: Ease.linear,
      onUpdate: (t) => {
        let s, o = 1;
        if (t < 0.25) {
          s = 1 + overshoot * Math.sin(Math.PI * (t / 0.25));
        } else {
          const u = (t - 0.25) / 0.75;
          s = Math.pow(1 - u, 1.4);
          o = 1 - u * u;
        }
        this._puffScale = Math.max(0, s);
        this.material.opacity = clamp(o, 0, 1);
      },
    });
    const finalize = () => {
      if (this._puffId !== id || this.state !== 'eaten') return;
      this._puffScale = 0;
      this.group.visible = false;
      this.material.opacity = 1;
      this.material.transparent = false;
      this._composeBody();
    };
    this._puffPromise = this._puffHandle.promise.then(() => { finalize(); return true; });
    return this._puffPromise;
  }

  /** Back to seated, unbitten, undipped, idle, visible, scale 1. Does not touch group.position/rotation. */
  reset() {
    this._puffId++;
    this._cancelHop();
    if (this._puffHandle) { this._puffHandle.cancel(); this._puffHandle = null; }
    this._puffPromise = null;
    this._puffScale = 1;
    this.material.opacity = this.type.skin.opacity ?? 1;
    this.material.transparent = this.material.opacity < 1;

    this.state = 'seated';
    this.held = false;
    this.group.visible = true;
    this.setBitten(false);
    this.setDip(0, 0);
    this.dipped = false;

    this.expression = 'idle';
    this._expressionUntil = 0;
    this.blush = 0; this._blushTarget = 0;
    this.mouthOpen = 0;
    this.faceTilt = 0;
    this.look.x = 0; this.look.y = 0;
    this._lookTarget = null;
    this._quirkLook = null;
    this._blinkT = -1; this._blinkQueue = 0; this._blinkValue = 0;
    this._blinkTimer = rand(...this.character.blink);

    this._hop.sy = 1; this._hop.h = 0;
    this._wiggleT = -1;
    this._yawnT = -1;
    this._heldTime = 0;
    this._swayImpulse = 0;
    this._headYaw = 0; this._headPitch = 0; this._roll = 0; this._swayX = 0; this._swayZ = 0;
    this._quirkTimer = rand(...this.character.quirks);
    this._queue.length = 0;
    this._paintAccum = 0;

    this._composeBody();
    this._paintFace(true);
  }

  /** Type-specific props: the pink filling inside a har gow, the roe dot on a siu mai. */
  _buildExtras() {
    const t = this.type;
    if (t.extras === 'inner-filling') {
      const inner = new THREE.Mesh(this._bodyGeometry, new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#F2A48C'), roughness: 0.55, clearcoat: 0.2, vertexColors: true }));
      inner.name = 'Filling';
      inner.scale.set(0.84, 0.82, 0.84);
      inner.position.y = 0.02;
      inner.castShadow = false; inner.receiveShadow = false;
      inner.userData.dumpling = this;
      this.body.add(inner);
      this.extras.push(inner);
    } else if (t.extras === 'roe') {
      const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#F0803A'), roughness: 0.3, clearcoat: 0.6 });
      const geo = new THREE.SphereGeometry(0.024, 16, 12);
      const roe = new THREE.Mesh(geo, mat);
      roe.position.set(0.005, t.metrics.height + 0.006, 0.01);
      roe.scale.y = 0.8;
      roe.castShadow = true;
      const roe2 = new THREE.Mesh(geo, mat);
      roe2.position.set(-0.03, t.metrics.height - 0.006, -0.02);
      roe2.scale.setScalar(0.7);
      for (const m of [roe, roe2]) { m.name = 'Roe'; m.userData.dumpling = this; this.body.add(m); this.extras.push(m); }
    }
  }

  dispose() {
    for (const m of this.extras || []) { if (m.geometry !== this._bodyGeometry) m.geometry.dispose(); m.material.dispose(); }
    this._cancelHop();
    if (this._puffHandle) { this._puffHandle.cancel(); this._puffHandle = null; }
    this._queue.length = 0;
    this.group.removeFromParent();
    this.material.dispose();
    this.painter.dispose();
    // Geometries are shared and owned by main.js — not disposed here.
    this.group.userData.dumpling = null;
    this.body.userData.dumpling = null;
    this.mesh.userData.dumpling = null;
  }

  _cancelHop() {
    if (this._hopHandle) { this._hopHandle.cancel(); this._hopHandle = null; }
    this._hop.sy = 1; this._hop.h = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------------------------

  /**
   * @param {number} dt     scene seconds since the last frame (already time-scaled by main)
   * @param {number} time   scene time (unused directly; an internal clock drives holds)
   * @param {object} [ctx]  { camera }
   */
  update(dt, time, ctx) {
    dt = clamp(+dt || 0, 0, 0.1);
    if (ctx && ctx.camera) this._camera = ctx.camera;
    this._clock += dt;
    const alive = this.state !== 'eaten';

    if (alive) {
      this._runQueue();
      this._updateExpressionHold();
      this._updateBlink(dt);
      this._updateLook(dt);
      this._updateQuirks(dt);
      this._updateYawn(dt);
      this._updateWiggle(dt);
      this._updateHeld(dt);
      this.blush = damp(this.blush, this._blushTarget, 4, dt);
    }

    // A hop cancelled from outside (cancelAllTweens) must not leave a squash behind.
    if (this._hopHandle && this._hopHandle.cancelled) { this._hopHandle = null; this._hop.sy = 1; this._hop.h = 0; }

    this._composeBody();

    if (alive) {
      this._paintAccum += dt;
      if (this._faceDirty || this._paintAccum >= PAINT_INTERVAL) {
        this._paintAccum = 0;
        this._paintFace(false);
      }
    }
  }

  _runQueue() {
    if (!this._queue.length) return;
    const due = [];
    for (let i = this._queue.length - 1; i >= 0; i--) {
      if (this._queue[i].at <= this._clock) due.push(this._queue.splice(i, 1)[0]);
    }
    for (let i = due.length - 1; i >= 0; i--) due[i].fn();
  }

  _later(seconds, fn) {
    this._queue.push({ at: this._clock + seconds, fn });
  }

  _updateExpressionHold() {
    if (this._expressionUntil > 0 && this._clock >= this._expressionUntil) {
      this._expressionUntil = 0;
      this.expression = 'idle';
      this._faceDirty = true;
    }
  }

  _updateBlink(dt) {
    if (this._blinkT < 0) {
      // Idle: count down to the next blink (a queued double blink uses a short gap).
      this._blinkTimer -= dt;
      if (this._blinkTimer <= 0) {
        this._blinkT = 0;
        if (this._blinkQueue > 0) this._blinkQueue--;
        else if (Math.random() < this.character.doubleBlink) this._blinkQueue = 1;   // double blink sometimes
      }
      this._blinkValue = 0;
      return;
    }
    // close 0.07 s, hold 0.03 s, open 0.11 s
    const t = this._blinkT / this.character.blinkSpeed;
    let v;
    if (t < 0.07) v = Ease.inQuad(t / 0.07);
    else if (t < 0.10) v = 1;
    else if (t < BLINK_DURATION) v = 1 - Ease.outQuad((t - 0.10) / 0.11);
    else v = 0;
    this._blinkValue = v;
    this._blinkT += dt;
    if (this._blinkT >= BLINK_DURATION * this.character.blinkSpeed) {
      this._blinkT = -1;
      this._blinkValue = 0;
      this._blinkTimer = this._blinkQueue > 0 ? 0.12 : rand(...this.character.blink);
    }
  }

  _updateLook(dt) {
    let tx = 0, ty = 0, tilt = 0;
    const q = this._quirkLook;
    if (q && q.until <= this._clock) this._quirkLook = null;

    if (this._lookTarget) {
      this._lookToward(this._lookTarget, _v2);
      tx = _v2.x; ty = _v2.y;
      tilt = tx * 0.2;
    } else if (this._quirkLook) {
      const ql = this._quirkLook;
      if (ql.world) { this._lookToward(ql.world, _v2); tx = _v2.x; ty = _v2.y; }
      else { tx = ql.x; ty = ql.y; }
      tilt = ql.tilt || 0;
    }

    const k = motion.reduced ? 5 : this.character.gaze;
    this.look.x = damp(this.look.x, tx, k, dt);
    this.look.y = damp(this.look.y, ty, k, dt);
    this.faceTilt = damp(this.faceTilt, tilt, 6, dt);

    const yawTarget = this.look.x * HEAD_YAW_MAX;
    const pitchTarget = -this.look.y * HEAD_PITCH_MAX + (this._yawnT >= 0 ? -0.08 * yawnPulse(this._yawnT) : 0);
    this._headYaw = damp(this._headYaw, yawTarget, 6, dt);
    this._headPitch = damp(this._headPitch, pitchTarget, 6, dt);
  }

  /** Project a world point into the group frame and derive pupil offsets (-1..1) into `out.x/.y`. */
  _lookToward(world, out) {
    this.group.updateWorldMatrix(true, false);
    _v1.copy(world);
    this.group.worldToLocal(_v1);
    _v1.y -= EYE_Y;
    const len = _v1.length();
    if (len < 1e-6) { out.set(0, 0, 0); return out; }
    _v1.divideScalar(len);
    let lx = _v1.x * 1.7, ly = _v1.y * 1.5;
    if (_v1.z < 0) { const f = clamp(1 + _v1.z * 2, 0, 1); lx *= f; ly *= f; }  // can't look behind
    out.set(clamp(lx, -1, 1), clamp(ly, -1, 1), 0);
    return out;
  }

  _updateQuirks(dt) {
    if (this.state !== 'seated') return;
    this._quirkTimer -= dt;
    if (this._quirkTimer > 0) return;
    this._quirkTimer = rand(...this.character.quirks);
    if (this.expression !== 'idle' || this.isBusy || this._lookTarget) return;
    this._doQuirk();
  }

  _doQuirk() {
    const reduced = motion.reduced;
    const sign = Math.random() < 0.5 ? -1 : 1;
    switch (this.personality.id) {
      case 'dumpy':
        // A yawn: sleepy face, mouth opens wide, head tips back a little.
        this._yawnT = 0;
        this.setExpression('sleepy', { hold: 2.3 });
        this._later(2.4, () => { if (this.state === 'seated') this.blink(); });
        break;
      case 'pudding':
        // Glances away shyly.
        this._quirkLook = { x: 0.85 * sign, y: -0.25, tilt: 0.35 * sign, world: null, until: this._clock + 1.9 };
        this.setExpression('shy', { hold: 1.9 });
        break;
      case 'suki':
        // Bounces (twice) — never hops under reduced motion.
        this.setExpression('excited', { hold: 1.3 });
        if (!reduced) { this.hop(0.75); this._later(0.45, () => { if (this.state === 'seated') this.hop(0.5); }); }
        else this.wiggle();
        break;
      case 'momo':
        // Tongue pops in… and back out ('silly' is momo's tongue-out face).
        this.setExpression('happy', { hold: 0.6 });
        this._later(0.6, () => { if (this.state === 'seated') { this.setExpression('silly', { hold: 1.6 }); if (!reduced) this.wiggle(); } });
        break;
      case 'pip':
        // Curious look at the viewer (or off to one side).
        this._quirkLook = {
          x: 0.7 * sign, y: 0.3, tilt: 0.15 * sign,
          world: this._camera ? this._camera.position.clone() : null,
          until: this._clock + 1.7,
        };
        this.setExpression('curious', { hold: 1.7 });
        if (!reduced && Math.random() < 0.4) this.hop(0.4);
        break;
      case 'nori':
        this._quirkLook = { x: .75 * sign, y: -.1, tilt: -.15 * sign, world: null, until: this._clock + 2.2 };
        this.setExpression('grumpy', {hold: 2.2});
        break;
      default:
        // Cheerful and cheeky characters offer a small greeting.
        if (!reduced && Math.random() < 0.5) this.hop(0.45);
        else this.wiggle();
        if (this.personality.id === 'mochi' && Math.random() < 0.5) this.setExpression('giggle', { hold: 1.2 });
        if (this.personality.id === 'bao' && Math.random() < 0.5) this.setExpression('wink', { hold: 1.2 });
        break;
    }
  }

  _updateYawn(dt) {
    if (this._yawnT < 0) { this.mouthOpen = damp(this.mouthOpen, 0, 10, dt); return; }
    this._yawnT += dt;
    this.mouthOpen = yawnPulse(this._yawnT);
    if (this._yawnT >= 2.0) { this._yawnT = -1; this.mouthOpen = 0; }
  }

  _updateWiggle(dt) {
    if (this._wiggleT < 0) { this._roll = damp(this._roll, 0, 12, dt); return; }
    const t = this._wiggleT;
    const amp = this._wiggleAmp;
    const reduced = motion.reduced;
    const f = reduced ? 2.5 : 5.0;
    const k = reduced ? 3 : 4;
    this._roll = 0.12 * amp * Math.sin(2 * Math.PI * f * t) * Math.exp(-k * t);
    this._wiggleT += dt;
    if (this._wiggleT >= (reduced ? 0.5 : 0.75)) { this._wiggleT = -1; }
  }

  _updateHeld(dt) {
    if (!this.held) {
      this._swayX = damp(this._swayX, 0, 8, dt);
      this._swayZ = damp(this._swayZ, 0, 8, dt);
      return;
    }
    this._heldTime += dt;
    const t = this._heldTime;
    const gain = (motion.reduced ? 0.2 : 1) * this.character.energy;
    const impulse = this._swayImpulse * Math.exp(-2.2 * t);
    const c = this._clock;
    const sx = 0.05 * gain * Math.sin(c * 1.7 + 0.8) + impulse * 0.10 * Math.sin(t * 7.5);
    const sz = 0.06 * gain * Math.sin(c * 2.3) + impulse * 0.08 * Math.sin(t * 6.2 + 1.1);
    this._swayX = damp(this._swayX, sx, 6, dt);
    this._swayZ = damp(this._swayZ, sz, 6, dt);
  }

  /** Compose breathing, hop, head turn, wiggle, sway and puff into the body child's transform. */
  _composeBody() {
    const body = this.body;
    const reduced = motion.reduced;

    // Breathing (volume preserving): y up, x/z down.
    const breath = (reduced ? BREATH_AMP * 0.5 : BREATH_AMP) * Math.sin(this._clock * this._breathRate * Math.PI * 2 + this._breathPhase);
    const by = 1 + breath;
    const bxz = 1 / Math.sqrt(by);

    const hy = this._hop.sy;
    const hxz = 1 / Math.sqrt(hy);

    const p = this._puffScale;
    const sy = by * hy * p;
    const sxz = bxz * hxz * p;
    body.scale.set(sxz, sy, sxz);

    _euler.set(this._headPitch + this._swayX, this._headYaw, this._roll + this._swayZ);
    body.rotation.copy(_euler);

    // Keep the pivot point fixed: p' = R·S·p  →  position = p − p'.
    const pivotY = this.held ? this.type.metrics.gripHeight : (this.state === 'eaten' ? this.type.metrics.bodyHeight * 0.5 : 0);
    _v1.set(0, pivotY * sy, 0).applyEuler(_euler);
    body.position.set(-_v1.x, pivotY - _v1.y + this._hop.h, -_v1.z);
  }

  // -------------------------------------------------------------------------------------------
  // Face painting (throttled + quantised; the painter dedupes on its own key as well)
  // -------------------------------------------------------------------------------------------

  _paintFace(force) {
    const st = this._faceState;
    st.expression = this.expression;
    st.blink = quant(this._blinkValue, 10);
    st.lookX = quant(this.look.x, 16);
    st.lookY = quant(this.look.y, 16);
    st.blush = quant(this.blush, 8);
    st.mouthOpen = quant(this.mouthOpen, 12);
    st.tilt = quant(this.faceTilt, 12);
    this.painter.paint(st);
    this._faceDirty = false;
    if (force) this._paintAccum = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function resolvePersonality(p, index) {
  if (p && typeof p === 'object' && p.id) return p;
  if (typeof p === 'string') {
    const found = PERSONALITIES.find((e) => e.id === p);
    if (found) return found;
  }
  return PERSONALITIES[((index % PERSONALITIES.length) + PERSONALITIES.length) % PERSONALITIES.length];
}
