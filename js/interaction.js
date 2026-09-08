// Interaction state machine: chopsticks → pick a dumpling → dip in soy sauce → bring it to the
// camera for a bite. Works with mouse hover+click, touch taps and the keyboard. Every sequence is
// an async function built from tweens; a run id lets a refill abort a sequence mid-way.
import * as THREE from 'three';
import { CHOPSTICKS, BOWL, COLORS } from './config.js';
import { tween, wait, Ease, cancelAllTweens, clamp } from './tween.js';
import { motion } from './motion.js';
import { haptic } from './quality.js';
import { DIRS } from './chopstick-controller.js';
import { voice } from './i18n.js';
import { vesselClearance, sauceContactLevel } from './contact.js';

const UP = new THREE.Vector3(0, 1, 0);
const IDLE_CUE_AFTER = 2.5;   // seconds of doing nothing before the chopsticks start to glow softly

export class Interaction {
  constructor(opts) {
    Object.assign(this, opts); // scene, camera, chop, crowd, ui, audio, bowl, sauce, droplets, crumbs, getDumplings, getFloorY, onAllEaten, onPhase
    this.phase = 'idle';
    this.held = null;
    this.candidate = null;
    this.keyboardIndex = -1;
    this.dipped = false;
    this.runId = 0;
    this.shake = 0;
    this.punch = 0;                   // camera push-in on a chomp (decays each frame)
    this.idleTime = 0;                // seconds since the player last did something at an idle table
    this._pokeAt = new WeakMap();     // dumpling -> time of its last poke (rate limit)
    this.isTouch = false;
    this.autopilot = false;           // true while autoplay / recording drive the sequences
    this.pointer = { ndc: new THREE.Vector2(0, 0), has: false, world: new THREE.Vector3(), overBowl: false, biteZone: false, onPlane: false };
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(UP, 0);
    this.carry = new THREE.Group();
    this.carry.name = 'carry';
    this.carryYaw = 0;
    this.carryYawTarget = 0;
    this.carryFace = 0;                 // 0 = hanging upright, 1 = face turned toward the camera (bite)
    this._qHang = new THREE.Quaternion();
    this._qFace = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this.scene.add(this.carry);
    this.maxDip = 0;

    // Selection halo under the candidate dumpling.
    this.halo = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.345, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.terracotta), transparent: true, opacity: 0, depthWrite: false }));
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.renderOrder = 2;
    this.scene.add(this.halo);
    this.haloOpacity = 0;
    this.returnHalo = new THREE.Mesh(new THREE.RingGeometry(1.015, 1.035, 72), this.halo.material.clone());
    this.returnHalo.rotation.x = -Math.PI / 2;
    this.returnHalo.position.y = .005;
    this.scene.add(this.returnHalo);

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._hits = [];
    this._screenA = new THREE.Vector3();
    this._screenB = new THREE.Vector3();
    this.restMaterial = this.rest.group.getObjectByName('Rest').material;
    this.stickMaterial = this.chop.chop.leftStick.material;
    for (const material of [this.restMaterial, this.stickMaterial]) {
      material.emissive.set(COLORS.terracotta);
      material.emissiveIntensity = 0;
    }
  }

  get seated() { return this.getDumplings().filter((d) => d.state === 'seated' && !d.serving); }
  /** World height on a dumpling where the chopsticks pinch it. */
  gripOf(d) { return ((d && d.type) ? d.type.metrics.gripHeight : 0.2) * ((d && d.fitScale) || 1); }
  get busy() { return ['lifting', 'picking', 'dipping', 'biting', 'returning', 'resting'].includes(this.phase); }

  setPhase(p) { this.phase = p; this.onPhase?.(p); }

  // ---------- pointer / keyboard input ----------

  onPointerMove(ndc, isTouch) {
    this.pointer.ndc.copy(ndc);
    this.pointer.has = true;
    this.isTouch = !!isTouch;
    if (!isTouch) this.keyboardIndex = -1;
  }

  onPointerLeave() { this.pointer.has = false; if (this.phase === 'idle' || this.phase === 'holding') this.setCandidate(null); }

  /** A click or tap. Returns true when it did something. */
  onClick(ndc, isTouch) {
    this.pointer.ndc.copy(ndc);
    this.pointer.has = true;
    this.isTouch = !!isTouch;
    this.audio?.unlock?.();
    if (this.busy || this.autopilot) return false;
    const ray = this.raycaster;
    ray.setFromCamera(ndc, this.camera);
    this.idleTime = 0;
    // On a phone there is no hover: a tap is the moment the food notices you.
    if (isTouch && ['idle', 'holding'].includes(this.phase)) { this.updatePointerWorld(); this.crowd.glance(this.pointer.world, 1.4); }

    if (this.phase === 'idle') {
      if (this.hitsChopsticks(ray)) { this.liftChopsticks(); return true; }
      const poked = this.hitDumpling(ray);
      if (poked) { this.poke(poked); return true; }
      if (!this.getDumplings().some(d => d.state !== 'eaten') && this.hitsVessel(ray)) { this.onRefill?.(); return true; }
      return false;
    }
    if (['holding', 'carrying'].includes(this.phase) && this.hitsRest(ray)) {
      this.returnChopsticks(); return true;
    }
    if (this.phase === 'holding') {
      if (!this.getDumplings().some(d => d.state !== 'eaten') && this.hitsVessel(ray)) { this.onRefill?.(); return true; }
      const d = this.hitDumpling(ray);
      if (d) { this.pick(d); return true; }
      return false;
    }
    if (this.phase === 'carrying') {
      this.updatePointerWorld();
      if (this.pointer.overBowl && motion.sauce) { this.dip(); return true; }
      if (this.hitsVessel(ray)) { this.putBack(); return true; }
      this.bite(); return true;
    }
    return false;
  }

  onKey(key) {
    if (this.busy || this.autopilot) return false;
    switch (key) {
      case 'Enter':
        if (this.phase === 'idle') { this.liftChopsticks(); return true; }
        if (this.phase === 'holding') { const d = this.candidate || this.nearestToTips(); if (d) this.pick(d); return true; }
        if (this.phase === 'carrying') { if (!this.dipped && motion.sauce) this.dip(); else this.bite(); return true; }
        return false;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (this.phase !== 'holding') return false;
        const list = this.seatedSortedByX();
        if (!list.length) return false;
        const dir = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
        let i = this.candidate ? list.indexOf(this.candidate) : -1;
        i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
        this.keyboardIndex = i;
        this.setCandidate(list[i]);
        this.audio?.play('ui', { volume: 0.4 });
        return true;
      }
      case 'd': case 'D':
        if (this.phase === 'carrying' && motion.sauce) { this.dip(); return true; }
        return false;
      case 'b': case 'B':
        if (this.phase === 'carrying') { this.bite(); return true; }
        return false;
      case 'Escape':
        if (this.phase === 'carrying') { this.putBack(); return true; }
        if (this.phase === 'holding') { this.restChopsticks(); return true; }
        return false;
      default:
        return false;
    }
  }

  // ---------- hit testing ----------

  // A few screen pixels of padding make slender props usable on phones without
  // turning the rest of the tabletop into an invisible hit box.
  nearProjectedSegment(object, length, axis, height = 0) {
    const a = this._screenA.set(0, height, 0), b = this._screenB.set(0, height, 0);
    a[axis] += length / 2; b[axis] -= length / 2;
    object.localToWorld(a).project(this.camera);
    object.localToWorld(b).project(this.camera);
    if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) return false;
    const w = window.innerWidth / 2, h = window.innerHeight / 2;
    const ax = a.x*w, ay = a.y*h, dx = (b.x-a.x)*w, dy = (b.y-a.y)*h;
    const px = this.pointer.ndc.x*w-ax, py = this.pointer.ndc.y*h-ay;
    const t = clamp((px*dx+py*dy) / Math.max(.001,dx*dx+dy*dy),0,1);
    return Math.hypot(px-t*dx,py-t*dy) <= (this.isTouch ? 22 : 10);
  }

  hitsChopsticks(ray) {
    if (ray.intersectObject(this.chop.group, true).length) return true;
    return [this.chop.chop.leftStick, this.chop.chop.rightStick].some(stick => this.nearProjectedSegment(stick, CHOPSTICKS.length, 'y'));
  }

  hitsRest(ray) {
    return ray.intersectObject(this.rest.group, true).length > 0 || this.nearProjectedSegment(this.rest.group, .5, 'x', .05);
  }

  hitDumpling(ray) {
    this._hits.length = 0;
    const meshes = [];
    // The low-poly hit proxy stands in for the 60k-triangle body (see Dumpling).
    for (const d of this.seated) meshes.push(d.hitProxy || d.mesh);
    ray.intersectObjects(meshes, false, this._hits);
    for (const h of this._hits) {
      let o = h.object;
      while (o && !o.userData.dumpling) o = o.parent;
      if (o && o.userData.dumpling && o.userData.dumpling.state === 'seated') return o.userData.dumpling;
    }
    return null;
  }

  hitsVessel(ray) {
    const vessel = this.getVessel?.();
    return !!vessel && ray.intersectObject(vessel.group, true).length > 0;
  }

  hitsBowl(ray) {
    if (!this.bowl) return false;
    this._hits.length = 0;
    ray.intersectObject(this.bowl.group, true, this._hits);
    if (this._hits.length) return true;
    const p = this._v;
    this.plane.constant = -(this.bowl.group.position.y + BOWL.sauceY);
    if (ray.ray.intersectPlane(this.plane, p)) {
      const dx = p.x - this.bowl.group.position.x, dz = p.z - this.bowl.group.position.z;
      return Math.hypot(dx, dz) < BOWL.outerRadius + 0.04;
    }
    return false;
  }

  seatedSortedByX() {
    return this.seated.slice().sort((a, b) => a.seat.x - b.seat.x || a.seat.z - b.seat.z);
  }

  nearestToTips() {
    const tip = this.chop.tipWorldPosition(this._v);
    let best = null, bd = Infinity;
    for (const d of this.seated) {
      const dd = Math.hypot(d.seat.x - tip.x, d.seat.z - tip.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  /** Project the pointer onto the hover plane and classify it (over bowl / bite zone). */
  updatePointerWorld() {
    const floorY = this.getFloorY();
    const ray = this.raycaster;
    ray.setFromCamera(this.pointer.ndc, this.camera);
    this.plane.constant = -(floorY + 0.3);
    const p = this.pointer.world;
    this.pointer.onPlane = !!ray.ray.intersectPlane(this.plane, p);
    if (!this.pointer.onPlane) {
      // Pointer above the horizon: fall back to a far point in the view direction.
      p.copy(ray.ray.origin).addScaledVector(ray.ray.direction, 6);
    }
    p.x = clamp(p.x, -2.2, 3.0);
    p.z = clamp(p.z, -2.0, 3.2);
    const live = this.phase === 'carrying' && !this.autopilot && this.pointer.has;
    this.pointer.overBowl = live && motion.sauce && this.hitsBowl(ray);
    this.pointer.overRest = live && this.hitsRest(ray);
    this.pointer.biteZone = live && !this.pointer.overBowl && !this.pointer.overRest && (this.pointer.ndc.y < -0.5 || p.z > 2.3);
  }

  setCandidate(d) {
    if (this.candidate === d) return;
    if (this.candidate) { this.candidate.setExpression('idle'); }
    this.candidate = d;
    if (d) {
      d.reactTo('hover');
      this.crowd.react('hover', d);
      this.audio?.play('ui', { volume: 0.25, pitch: 1.2 });
    }
  }

  /** A bare-finger poke before the chopsticks are up: the character reacts, nothing is picked. */
  poke(d) {
    const now = performance.now();
    if (now - (this._pokeAt.get(d) || 0) < 350) return false;
    this._pokeAt.set(d, now);
    d.reactTo('hover', { hold: 1.4 });
    d.blink();
    if (motion.reduced) d.wiggle(0.5);
    else d.hop(0.55 + 0.45 * d.character.energy);
    this.crowd.react('poke', d);
    this.audio?.play('boing', { volume: 0.3, pitch: 1.15 + Math.random() * 0.25 });
    haptic(6);
    return true;
  }

  // ---------- sequences ----------

  async liftChopsticks() {
    if (this.phase !== 'idle') return false;
    const id = ++this.runId;
    this.setPhase('lifting');
    this.audio?.play('clack', { volume: 0.7 });
    this.ui.setCursor('grabbing');
    const ok = await this.chop.pickUp();
    if (!ok || id !== this.runId) return false;
    this.setPhase('holding');
    return true;
  }

  async returnChopsticks() {
    // Food goes safely home before the sticks lower onto their ceramic rest.
    if (this.phase === 'carrying' && !(await this.putBack())) return false;
    return this.restChopsticks();
  }

  async restChopsticks() {
    if (this.phase !== 'holding') return false;
    const id = ++this.runId;
    this.setPhase('resting');
    this.setCandidate(null);
    this.crowd.setWatch(null);
    const ok = await this.chop.putDown();
    if (id !== this.runId) return false;
    this.audio?.play('clack', { volume: 0.5, pitch: 0.9 });
    this.setPhase('idle');
    return ok;
  }

  async pick(d) {
    if (this.phase !== 'holding' || !d || d.state !== 'seated') return false;
    const id = ++this.runId;
    const alive = () => id === this.runId;
    this.setPhase('picking');
    this.setCandidate(null);
    this.crowd.react('picking', d);
    this.ui.setCursor('grabbing');
    const seat = d.worldPosition(new THREE.Vector3());
    this.crowd.setWatch(seat, d);
    d.reactTo('picking');
    d.lookAt(this.chop.tipWorldPosition(new THREE.Vector3()));
    this.audio?.play('lift', { volume: 0.6 });

    this.chop.setContact(d.mesh);
    this.chop.contactClosing = true;
    this.chop.setDir(DIRS.hover);
    this.chop.openTo(1, { duration: 0.35 });
    const above = seat.clone(); above.y += 0.78;
    if (!(await this.chop.moveTo(above, { duration: 0.5 })) || !alive()) return false;

    const gh = this.gripOf(d);
    const holdYaw = d.type ? d.type.holdYaw : 0;
    const down = seat.clone().add(new THREE.Vector3(0, gh, 0)).addScaledVector(DIRS.hover, CHOPSTICKS.gripFromTip);
    const tipY = down.y;
    if (!(await this.chop.moveTo(down, { duration: 0.34, ease: Ease.inOutQuad })) || !alive()) return false;

    this.audio?.play('clack', { volume: 0.5, pitch: 1.1 });
    d.reactTo('pinch');
    if (!(await this.chop.openTo(0, { duration: 0.2, ease: Ease.outCubic })) || !alive()) return false;
    this.chop.contactClosing = false;
    this.audio?.play('pick');
    haptic(10);

    // Attach the dumpling to the carry pivot at the grip point.
    this.carry.position.copy(this.chop.gripWorldPosition(this._v));
    this.carry.rotation.set(0, 0, 0);
    this.carryYaw = d.group.rotation.y; this.carryYawTarget = 0;
    this.carry.attach(d.group);
    this.held = d;
    this.dipped = d.dipped;
    this.maxDip = d.dipLevel;
    d.setHeld(true);
    d.reactTo('lifted');
    this.crowd.react('picked', d);
    const fromPos = d.group.position.clone();
    const fromRot = d.group.rotation.y;
    tween({ from: 0, to: 1, duration: 0.3, ease: Ease.outCubic, onUpdate: (t) => {
      if (this.held !== d) return;
      d.group.position.lerpVectors(fromPos, new THREE.Vector3(0, -gh, 0), t);
      d.group.rotation.y = fromRot + (holdYaw - fromRot) * t;
    } });

    const up = down.clone(); up.y = tipY + 0.72;
    if (!(await this.chop.moveTo(up, { duration: 0.5, ease: Ease.outCubic })) || !alive()) return false;
    d.reactTo('held', { hold: 1.8 });
    this.setPhase('carrying');
    return true;
  }

  async dip() {
    if (this.phase !== 'carrying' || !this.held || !motion.sauce || !this.bowl) return false;
    const id = ++this.runId;
    const alive = () => id === this.runId;
    const d = this.held;
    this.setPhase('dipping');
    const bp = this.bowl.group.position;
    const sauceY = bp.y + BOWL.sauceY;
    const gh = this.gripOf(d);
    const tipsAbove = new THREE.Vector3(bp.x, sauceY + 0.42 + gh, bp.z).addScaledVector(DIRS.dip, CHOPSTICKS.gripFromTip);
    d.reactTo('dip');
    this.crowd.setWatch(new THREE.Vector3(bp.x, sauceY + 0.3, bp.z), d);
    if (!(await this.chop.moveTo(tipsAbove, { duration: 0.6, dir: DIRS.dip })) || !alive()) return false;

    const depth = 0.055;
    const tipsDown = tipsAbove.clone(); tipsDown.y = sauceY - depth + gh + DIRS.dip.y * CHOPSTICKS.gripFromTip;
    d.reactTo('pinch');
    const mv = this.chop.moveTo(tipsDown, { duration: 0.45, ease: Ease.inOutQuad });
    wait(0.3).then(() => { if (alive()) { this.sauce?.addRipple(0, 0, 1); this.audio?.play('dip'); } });
    if (!(await mv) || !alive()) return false;
    if (!(await wait(0.32)) || !alive()) return false;

    // A tiny stir, then lift with droplets.
    const stir = tipsDown.clone().add(new THREE.Vector3(0.03, 0, 0.02));
    if (!(await this.chop.moveTo(stir, { duration: 0.22, ease: Ease.inOutSine })) || !alive()) return false;
    this.sauce?.addRipple(0.03, 0.02, 0.5);
    this.audio?.play('lift', { volume: 0.35, pitch: 1.1 });
    const lifted = tipsAbove.clone(); lifted.y += 0.12;
    const mv2 = this.chop.moveTo(lifted, { duration: 0.6, ease: Ease.outCubic });
    const dropFrom = () => { const p = this.held ? this.held.worldPosition(new THREE.Vector3()) : lifted.clone(); p.y += 0.02; return p; };
    wait(0.18).then(() => { if (alive()) { this.sauce?.addRipple(0, 0, 0.5); this.droplets?.spawn(dropFrom(), 3, { velocity: new THREE.Vector3(0, -0.2, 0), spread: 0.25 }); this.audio?.play('plip', { volume: 0.5 }); } });
    wait(0.55).then(() => { if (alive()) { this.droplets?.spawn(dropFrom(), 2, { velocity: new THREE.Vector3(0, -0.1, 0), spread: 0.2 }); this.audio?.play('plip', { volume: 0.35, pitch: 1.2 }); } });
    if (!(await mv2) || !alive()) return false;
    this.dipped = true;
    d.dipped = true;
    d.reactTo('dipped', { hold: 2.2 });
    this.crowd.react('dipped', d);
    this.setPhase('carrying');
    return true;
  }

  async bite() {
    if (this.phase !== 'carrying' || !this.held) return false;
    const id = ++this.runId;
    const alive = () => id === this.runId;
    const d = this.held;
    this.setPhase('biting');
    this.ui.setCursor('grabbing');

    const cam = this.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const upv = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const centre = cam.position.clone().addScaledVector(fwd, 2.9).addScaledVector(right, 0.22).addScaledVector(upv, 0.12);
    const tips = centre.clone().addScaledVector(DIRS.bite, CHOPSTICKS.gripFromTip);
    // Face the camera as it approaches.
    this.carryYawTarget = 0;
    if (this._faceTween) this._faceTween.cancel();
    this._faceTween = tween({ from: this.carryFace, to: 1, duration: 0.7, ease: Ease.inOutCubic, onUpdate: (v) => { this.carryFace = v; } });
    d.reactTo('approach');
    this.crowd.setWatch(centre, d);
    this.crowd.react('approach', d);
    this.audio?.play('whoosh', { volume: 0.5 });
    if (!(await this.chop.moveTo(tips, { duration: 0.8, ease: Ease.inOutCubic, dir: DIRS.bite })) || !alive()) return false;
    if (!(await wait(0.24)) || !alive()) return false;

    // Chomp one.
    const bitePoint = d.group.localToWorld(new THREE.Vector3().fromArray(d.type ? d.type.bite.point : [0.14, 0.3, 0.14]));
    this.shake = motion.reduced ? 0 : 0.6;
    this.punch = motion.reduced ? 0 : 1;
    haptic([12, 40, 10]);
    d.setBitten(true);
    d.reactTo('bitten');
    this.audio?.play('nom');
    this.crumbs?.burst(bitePoint, 16, { dir: fwd.clone().negate().add(new THREE.Vector3(0, -0.4, 0)).normalize(), spread: 0.8 });
    if (this.dipped) this.droplets?.spawn(bitePoint, 2, { velocity: new THREE.Vector3(0, -0.3, 0), spread: 0.3 });
    this.ui.showReaction(voice(this.dipped ? 'tasteDipped' : 'tastePlain', d.personality.id, d.type.id));
    this.crowd.react('bitten', d);
    const back = tips.clone().addScaledVector(DIRS.bite, -0.16).add(new THREE.Vector3(0, -0.02, 0));
    if (!(await this.chop.moveTo(back, { duration: 0.28, ease: Ease.outCubic })) || !alive()) return false;
    if (!(await wait(0.65)) || !alive()) return false;
    if (!(await this.chop.moveTo(tips, { duration: 0.32, ease: Ease.inOutCubic })) || !alive()) return false;

    // Chomp two: gone.
    this.shake = motion.reduced ? 0 : 0.45;
    this.punch = motion.reduced ? 0 : 0.8;
    haptic([10, 30, 16]);
    this.audio?.play('nom', { pitch: 1.12, volume: 0.9 });
    this.crumbs?.burst(d.group.localToWorld(new THREE.Vector3(0, (d.type ? d.type.metrics.bodyHeight : 0.36) * 0.6, (d.type ? d.type.metrics.depth : 0.5) * 0.2)), 10, { dir: fwd.clone().negate().add(new THREE.Vector3(0, -0.3, 0)).normalize(), spread: 0.9 });
    this.release(d);
    const puff = d.puff();
    this.audio?.play('pop', { volume: 0.7 });
    this.ui.showReaction(voice('tasteSecond'));
    this.crowd.react('eaten', d);
    this.held = null;
    this.chop.setContact(null);
    this.dipped = false;
    await puff;
    if (!alive()) return false;
    this.crowd.setWatch(null);

    this.setPhase('returning');
    const remaining = this.seated.length;
    if (remaining === 0) {
      this.chop.openTo(0.2);
      await this.chop.moveTo(new THREE.Vector3(0.9, this.getFloorY() + 0.9, 1.0), { duration: 0.55, dir: DIRS.hover });
      if (!alive()) return false;
      await this.chop.putDown();
      if (!alive()) return false;
      this.setPhase('idle');
      this.onAllEaten?.();
    } else {
      this.chop.openTo(0.4);
      await this.chop.moveTo(new THREE.Vector3(0.5, this.getFloorY() + 0.85, 0.7), { duration: 0.6, dir: DIRS.hover });
      if (!alive()) return false;
      this.setPhase('holding');
    }
    return true;
  }

  async putBack() {
    if (this.phase !== 'carrying' || !this.held) return false;
    const id = ++this.runId;
    const alive = () => id === this.runId;
    const d = this.held;
    this.setPhase('returning');
    const seat = d.seat.clone();
    this.crowd.setWatch(seat, d);
    d.reactTo('putback');
    const down = seat.clone().add(new THREE.Vector3(0, this.gripOf(d), 0)).addScaledVector(DIRS.hover, CHOPSTICKS.gripFromTip);
    const above = down.clone(); above.y += 0.72;
    this.carryYawTarget = 0;
    if (!(await this.chop.moveTo(above, { duration: 0.6, dir: DIRS.hover })) || !alive()) return false;
    if (!(await this.chop.moveTo(down, { duration: 0.35, ease: Ease.inOutQuad })) || !alive()) return false;
    this.chop.setContact(null);
    this.release(d);
    const p0 = d.group.position.clone(), q0 = d.group.quaternion.clone();
    const seatedRotation = new THREE.Quaternion().setFromAxisAngle(UP, d.seatYaw);
    tween({ from: 0, to: 1, duration: 0.3, ease: Ease.outCubic, onUpdate: (t) => {
      d.group.position.lerpVectors(p0, seat, t);
      d.group.quaternion.copy(q0).slerp(seatedRotation, t);
    } });
    this.audio?.play('clack', { volume: 0.4 });
    this.chop.openTo(1, { duration: 0.2 });
    this.crowd.react('putback', d);
    this.held = null; this.dipped = false;
    if (!(await wait(0.2)) || !alive()) return false;
    if (!(await this.chop.moveTo(above, { duration: 0.45, ease: Ease.outCubic })) || !alive()) return false;
    this.chop.openTo(0.4);
    this.crowd.setWatch(null);
    this.setPhase('holding');
    return true;
  }

  release(d) {
    this.scene.attach(d.group);
    d.setHeld(false);
    if (this._faceTween) this._faceTween.cancel();
    this.carryFace = 0;
  }

  /** Hard reset (refill / vessel change). */
  reset() {
    this.runId++;
    cancelAllTweens();
    this.crowd.clearTimers();
    this.crowd.setWatch(null);
    if (this.held) { this.release(this.held); this.held = null; }
    this.dipped = false;
    this.candidate = null;
    this.keyboardIndex = -1;
    this.haloOpacity = 0; this.halo.material.opacity = 0; this.returnHalo.material.opacity = 0;
    this.chop.setContact(null);
    this.restMaterial.emissiveIntensity = 0; this.stickMaterial.emissiveIntensity = 0;
    this.punch = 0; this.idleTime = 0;
    this.crowd.setGaze(null);
    this.chop.restBlend = 1;
    this.chop.openTarget = 0.12; this.chop.open = 0.12;
    this.chop.apply();
    this.setPhase('idle');
  }

  // ---------- per-frame ----------

  update(dt) {
    const floorY = this.getFloorY();
    const phase = this.phase;

    if (phase === 'holding') {
      this.updatePointerWorld();
      // Candidate selection: from the pointer (mouse) or the keyboard.
      if (!this.autopilot && !this.isTouch && this.pointer.has && this.keyboardIndex < 0) {
        const ray = this.raycaster;
        let d = this.hitDumpling(ray);
        if (!d) {
          // proximity to the hover point
          let best = Infinity;
          for (const s of this.seated) {
            const reach = (s.type ? s.type.metrics.radius : 0.27) * s.fitScale + 0.08;
            const dd = Math.hypot(s.seat.x - this.pointer.world.x, s.seat.z - this.pointer.world.z);
            if (dd < reach && dd < best) { best = dd; d = s; }
          }
        }
        this.setCandidate(d);
      }
      const tip = this._v;
      if (this.candidate) {
        tip.set(this.candidate.seat.x + 0.02, this.candidate.seat.y + (this.candidate.type ? this.candidate.type.metrics.height : 0.44) * this.candidate.fitScale + 0.28, this.candidate.seat.z + 0.02);
        this.chop.setOpen(0.85);
        this.candidate.lookAt(this.chop.tipWorldPosition(this._v2));
      } else if (this.autopilot || this.isTouch || !this.pointer.has) {
        tip.set(0.5, floorY + 0.85, 0.7);
        this.chop.setOpen(0.4);
      } else {
        tip.set(clamp(this.pointer.world.x, -1.5, 2.4), floorY + 0.62, clamp(this.pointer.world.z, -1.4, 1.7));
        this.chop.setOpen(0.45);
      }
      this.chop.setTipTarget(tip);
      this.ui.setCursor(this.candidate ? 'grab' : 'default');
    } else if (phase === 'carrying') {
      this.updatePointerWorld();
      const tip = this._v;
      const bp = this.bowl ? this.bowl.group.position : null;
      if (this.pointer.overBowl && bp) {
        tip.set(bp.x, bp.y + BOWL.sauceY + 0.3 + this.gripOf(this.held) - CHOPSTICKS.gripFromTip, bp.z);
        this.chop.setDir(DIRS.dip);
      } else if (this.pointer.overRest || this.autopilot || this.isTouch || !this.pointer.has) {
        tip.set(0.6, floorY + 0.95, 0.9);
        this.chop.setDir(DIRS.hover);
      } else {
        const p = this.pointer.world;
        const lift = this.pointer.biteZone ? 1.15 : 0.85;
        tip.set(clamp(p.x, -1.6, 2.6), floorY + lift, clamp(p.z, -1.4, 2.7));
        this.chop.setDir(this.pointer.biteZone ? DIRS.bite : DIRS.hover);
      }
      this.chop.setTipTarget(tip);
      this.carryYawTarget = this.pointer.biteZone ? Math.atan2(this.camera.position.x - this.carry.position.x, this.camera.position.z - this.carry.position.z) * 0.6 : 0;
      this.crowd.setWatch(this.carry.position, this.held);
      this.ui.setCursor('grabbing');
    } else if (phase === 'idle') {
      if (!this.autopilot && !this.isTouch && this.pointer.has) {
        this.raycaster.setFromCamera(this.pointer.ndc, this.camera);
        this.updatePointerWorld();
        const over = this.hitDumpling(this.raycaster);
        this.setCandidate(over);
        this.ui.setCursor(this.hitsChopsticks(this.raycaster) || over ? 'grab' : !this.seated.length && this.hitsVessel(this.raycaster) ? 'pointer' : 'default');
      }
    }

    // Seated food follows the pointer with its eyes whenever nothing more interesting is happening.
    if (!this.autopilot && (phase === 'idle' || phase === 'holding')) {
      this.crowd.setGaze(this.pointer.has && !this.isTouch && this.pointer.onPlane !== false ? this.pointer.world : null);
    }

    // The idle cue: after a few quiet seconds the resting chopsticks glow softly, so a first-time
    // player (especially on a phone, where nothing hovers) knows where the visit starts.
    if (phase === 'idle' && !this.autopilot && this.seated.length) this.idleTime += dt; else this.idleTime = 0;
    const cueRamp = clamp((this.idleTime - IDLE_CUE_AFTER) / 1.5, 0, 1);
    const cue = cueRamp * (motion.reduced ? 0.1 : 0.14 * (0.5 + 0.5 * Math.sin(this.idleTime * 3.4)));

    this.raycaster.setFromCamera(this.pointer.ndc, this.camera);
    const overRest = this.pointer.has && ['holding','carrying'].includes(phase) && this.hitsRest(this.raycaster);
    const overSticks = this.pointer.has && phase === 'idle' && this.hitsChopsticks(this.raycaster);
    const blend = 1 - Math.exp(-10 * dt);
    this.restMaterial.emissiveIntensity += ((overRest ? .22 : 0) - this.restMaterial.emissiveIntensity) * blend;
    this.stickMaterial.emissiveIntensity += ((overSticks ? .18 : cue) - this.stickMaterial.emissiveIntensity) * blend;
    if (overRest) this.ui.setCursor('pointer');

    const empty = !this.getDumplings().some(d => d.state !== 'eaten');
    this.raycaster.setFromCamera(this.pointer.ndc, this.camera);
    const overVessel = (phase === 'carrying' || empty) && this.pointer.has && this.hitsVessel(this.raycaster);
    const glow = (phase === 'carrying' && !this.pointer.overBowl && overVessel) || (empty && overVessel);
    this.returnHalo.material.opacity += ((glow ? .45 : 0) - this.returnHalo.material.opacity) * (1 - Math.exp(-9 * dt));

    // Halo under the candidate.
    const target = this.candidate && phase === 'holding' ? 1 : 0;
    this.haloOpacity += (target - this.haloOpacity) * (1 - Math.exp(-10 * dt));
    this.halo.material.opacity = this.haloOpacity * 0.55;
    if (this.candidate) {
      this.halo.position.set(this.candidate.seat.x, this.candidate.seat.y + 0.012, this.candidate.seat.z);
      this.halo.scale.setScalar(((this.candidate.type ? this.candidate.type.metrics.radius : 0.27) / 0.27) * this.candidate.fitScale);
    }

    // Camera shake and the bite push-in decay.
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3.2);
    if (this.punch > 0) this.punch = Math.max(0, this.punch - dt * 4.5);
  }

  syncCarry(dt) {
    const phase = this.phase;
    // Carry pivot follows the grip point with a soft lean toward the stick direction.
    if (this.held) {
      this.carry.position.copy(this.chop.gripWorldPosition(this._v2));
      const lean = this._v.copy(UP).addScaledVector(this.chop.dir, 0.18).normalize();
      this.carryYaw += (this.carryYawTarget - this.carryYaw) * (1 - Math.exp(-6 * dt));
      this._qHang.setFromUnitVectors(UP, lean).multiply(this._qYaw.setFromAxisAngle(UP, this.carryYaw));
      if (this.carryFace > 0.001) {
        this._m.lookAt(this.camera.position, this.carry.position, UP);
        this._qFace.setFromRotationMatrix(this._m);
        this.carry.quaternion.copy(this._qHang).slerp(this._qFace, this.carryFace);
      } else {
        this.carry.quaternion.copy(this._qHang);
      }
      this.carry.updateWorldMatrix(true, true);
      // The bottom and the sides must clear the actual curved porcelain on every frame.
      const lift = vesselClearance(this.held.mesh, this.bowl.group.position, this.bowl.group.visible);
      if (lift > 0) {
        this.chop.tip.y += lift;
        this.chop.apply();
        this.carry.position.y += lift;
        this.carry.updateWorldMatrix(true, true);
      }
      // Dip coat while submerged.
      if (this.bowl && phase === 'dipping') {
        const sub = sauceContactLevel(this.held.mesh, this.bowl.group.position, this.held.type.metrics.bodyHeight);
        this.maxDip = Math.max(this.maxDip, sub);
        if (this.maxDip > 0) this.held.setDip(this.maxDip, 0.92);
      }
    }

    this.chop.constrainGrip();
  }

}
