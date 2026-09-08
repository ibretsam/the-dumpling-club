// Chopstick controller: blends between a resting pose (laid on the table) and an active pose
// (held from the upper front-right, tips hovering over the food). Tip position, direction and
// openness are all damped so pointer following feels soft, and scripted moves use tweens.
import * as THREE from 'three';
import { CHOPSTICKS, LAYOUT } from './config.js';
import { tween, Ease, damp } from './tween.js';
import { motion } from './motion.js';
import { gripSupports } from './contact.js';

const UP = new THREE.Vector3(0, 1, 0);

export const DIRS = {
  hover: new THREE.Vector3(-0.28, -0.85, -0.42).normalize(),   // hand upper-front-right, tips down-left-back
  dip: new THREE.Vector3(-0.18, -0.9, -0.36).normalize(),
  bite: new THREE.Vector3(-0.62, -0.28, 0.72).normalize(),     // coming in from the right toward the viewer
};

export class ChopstickController {
  constructor(chopsticks) {
    this.chop = chopsticks;              // { group, setOpen, tipWorldPosition, gripWorldPosition }
    this.group = chopsticks.group;
    this.restBlend = 1;                  // 1 = resting on the table
    this.tipTarget = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.dirTarget = DIRS.hover.clone();
    this.dir = DIRS.hover.clone();
    this.openTarget = 0.15;
    this.open = 0.15;
    this.followLambda = 9;               // damping for pointer following
    this.viewDir = new THREE.Vector3(0, -0.5, -0.85);

    // Resting transform: sticks lying along +x on the table in front of the steamer.
    const r = LAYOUT.chopsticksRest;
    this.restPos = new THREE.Vector3(r.x - CHOPSTICKS.length * 0.5, r.y, r.z);
    this.restQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r.yaw, Math.PI / 2 + (r.tilt || 0), 'YXZ'));
    // Where the tips would be when resting (used as the start of the pick-up motion).
    this.restTip = new THREE.Vector3(0, -CHOPSTICKS.length, 0).applyQuaternion(this.restQuat).add(this.restPos);
    // Add a little world y so the tips sit over the rest.
    this.tipTarget.copy(this.restTip).add(new THREE.Vector3(0, 0.55, 0));
    this.tip.copy(this.tipTarget);

    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._z = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._blendTween = null;
    this.apply();
  }

  get isResting() { return this.restBlend > 0.999; }

  /** Lift the chopsticks off the table. Resolves when the motion is done. */
  pickUp() {
    if (this._blendTween) this._blendTween.cancel();
    this.tipTarget.copy(this.restTip).add(new THREE.Vector3(-0.3, 0.6, -0.2));
    this.tip.copy(this.tipTarget);
    this.openTarget = 0.35;
    this._blendTween = tween({ from: this.restBlend, to: 0, duration: 0.6, ease: Ease.inOutCubic, onUpdate: (v) => { this.restBlend = v; } });
    return this._blendTween.promise;
  }

  /** Lay the chopsticks back on the table. */
  putDown() {
    if (this._blendTween) this._blendTween.cancel();
    this.openTarget = 0.12;
    this.dirTarget.copy(DIRS.hover);
    // Drift the tips toward the rest before blending so the motion reads as "placing".
    this.moveTo(this.restTip.clone().add(new THREE.Vector3(-0.2, 0.5, -0.1)), { duration: 0.5, ease: Ease.inOutCubic });
    this._blendTween = tween({ from: this.restBlend, to: 1, duration: 0.7, ease: Ease.inOutCubic, delay: 0.25, onUpdate: (v) => { this.restBlend = v; } });
    return this._blendTween.promise;
  }

  /** Pointer following: set where the tips should hover. */
  setTipTarget(v) { if (this._moveTween) { this._moveTween.cancel(); this._moveTween = null; } this.tipTarget.copy(v); }

  /** Scripted move of the tip midpoint. Returns a promise. */
  moveTo(v, { duration = 0.5, ease = Ease.inOutCubic, dir = null } = {}) {
    if (this._moveTween) this._moveTween.cancel();
    if (dir) this.dirTarget.copy(dir);
    const from = this.tip.clone();
    const to = v.clone();
    this._moveTween = tween({
      from: 0, to: 1, duration, ease,
      onUpdate: (t) => { this.tipTarget.lerpVectors(from, to, t); this.tip.copy(this.tipTarget); },
      onComplete: () => { this._moveTween = null; },
    });
    return this._moveTween.promise;
  }

  setDir(dir) { this.dirTarget.copy(dir); }
  setContact(mesh = null) { this.contactMesh = mesh; }

  constrainGrip() {
    if (!this.contactMesh || this.restBlend > 0.001) return;
    const supports = gripSupports(this.contactMesh, this.group);
    const clearance = this.contactClosing ? 0.10 * this.open : 0;
    this.chop.setContact(supports.left - clearance, supports.right + clearance);
  }

  setOpen(v) { this.openTarget = THREE.MathUtils.clamp(v, 0, 1); }
  openTo(v, { duration = 0.25, ease = Ease.outCubic } = {}) {
    if (this._openTween) this._openTween.cancel();
    this._openTween = tween({ from: this.openTarget, to: THREE.MathUtils.clamp(v, 0, 1), duration, ease, onUpdate: (x) => { this.openTarget = x; this.open = x; } });
    return this._openTween.promise;
  }

  gripWorldPosition(target) { return this.chop.gripWorldPosition(target); }
  tipWorldPosition(target) { return this.chop.tipWorldPosition(target); }

  update(dt, camera) {
    camera.getWorldDirection(this.viewDir);
    const lam = this.followLambda * (motion.reduced ? 1.4 : 1);
    this.tip.x = damp(this.tip.x, this.tipTarget.x, lam, dt);
    this.tip.y = damp(this.tip.y, this.tipTarget.y, lam, dt);
    this.tip.z = damp(this.tip.z, this.tipTarget.z, lam, dt);
    this.dir.lerp(this.dirTarget, 1 - Math.exp(-6 * dt)).normalize();
    this.open = damp(this.open, this.openTarget, 14, dt);
    this.apply();
  }

  apply() {
    // Active transform from the tip, direction and a camera-aware roll.
    const dir = this.dir;
    const r = this._r.copy(this.viewDir).addScaledVector(UP, 0.6).normalize();
    const x = this._x.crossVectors(r, dir);
    if (x.lengthSq() < 1e-4) x.crossVectors(UP, dir);
    x.normalize();
    const y = this._y.copy(dir).negate();
    const z = this._z.crossVectors(x, y).normalize();
    this._m.makeBasis(x, y, z);
    const activeQuat = this._quat.setFromRotationMatrix(this._m);
    const activePos = this._pos.copy(this.tip).addScaledVector(dir, -CHOPSTICKS.length);

    const b = this.restBlend;
    if (b <= 0) {
      this.group.position.copy(activePos);
      this.group.quaternion.copy(activeQuat);
    } else if (b >= 1) {
      this.group.position.copy(this.restPos);
      this.group.quaternion.copy(this.restQuat);
    } else {
      // Arc the blend upward a little so the sticks lift rather than slide.
      const lift = Math.sin(b * Math.PI) * 0.35;
      this.group.position.lerpVectors(activePos, this.restPos, b);
      this.group.position.y += lift;
      this.group.quaternion.copy(activeQuat).slerp(this.restQuat, b);
    }
    this.chop.setOpen(this.open);
  }
}
