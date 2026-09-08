// The audience: remaining dumplings watch whatever is happening, react with expressions,
// tiny hops, eye contact, and little speech bubbles.
import * as THREE from 'three';
import { motion } from './motion.js';
import { voice } from './i18n.js';

const pick = lines => lines[Math.floor(Math.random() * lines.length)];
export class Crowd {
  constructor({ ui, camera, getDumplings }) {
    this.ui = ui;
    this.camera = camera;
    this.getDumplings = getDumplings;
    this.watchTarget = null;         // THREE.Vector3 or null
    this.actor = null;
    this._v = new THREE.Vector3();
    this._timers = new Set();
    this.hoverTimes = new WeakMap();
  }

  bubbleFrom(dumpling, text, life = 2) {
    const head = new THREE.Vector3();
    this.ui.bubble(text, dumpling.personality.name, () => {
      if (dumpling.state === 'eaten' || !dumpling.group.parent) return { visible: false };
      dumpling.headWorldPosition(head).project(this.camera);
      return { x: (head.x + 1) * innerWidth / 2, y: (1 - head.y) * innerHeight / 2,
        visible: head.z > -1 && head.z < 1 && Math.abs(head.x) < 1.1 && Math.abs(head.y) < 1.1 };
    }, life, dumpling);
  }

  _later(seconds, fn) {
    const id = setTimeout(() => { this._timers.delete(id); fn(); }, seconds * 1000);
    this._timers.add(id);
  }

  clearTimers() { for (const t of this._timers) clearTimeout(t); this._timers.clear(); }

  others(actor) { return this.getDumplings().filter((d) => d !== actor && d.state === 'seated'); }

  /** Start/stop tracking a world position with everyone's eyes. */
  setWatch(target, actor = null) {
    if (target) { if (!this.watchTarget) this.watchTarget = new THREE.Vector3(); this.watchTarget.copy(target); }
    else this.watchTarget = null;
    this.actor = actor;
  }

  react(event, actor = null, extra = {}) {
    const others = this.others(actor);
    const stagger = () => Math.random() * 0.35;
    const bubbleOne = (event, delay = .25) => {
      if (!others.length) return;
      const d = pick(others);
      this._later(delay, () => { if (d.state === 'seated') this.bubbleFrom(d, voice(event, d.personality.id)); });
    };
    switch (event) {
      case 'hover':
        if (actor && !motion.reduced && actor.character.energy > .5) actor.hop(.35 * actor.character.energy);
        if (actor && performance.now() - (this.hoverTimes.get(actor) ?? -Infinity) > 1800) {
          this.hoverTimes.set(actor, performance.now());
          this.bubbleFrom(actor, voice('hover', actor.personality.id));
        }
        break;
      case 'picking':
        if (actor) this.bubbleFrom(actor, voice('picking', actor.personality.id));
        break;
      case 'picked':
        if (actor) this.bubbleFrom(actor, voice('lifted', actor.personality.id), 2.4);
        bubbleOne('picked');
        others.forEach((d) => this._later(stagger(), () => {
          d.reactTo('watch', {hold: 2.2});
          if (!motion.reduced && d.character.energy > .6) d.wiggle(d.character.energy * .65);
        }));
        break;
      case 'dipped':
        if (actor) this.bubbleFrom(actor, voice('dipped', actor.personality.id));
        others.forEach((d) => this._later(stagger(), () => d.reactTo('watch', {hold: 1.8})));
        break;
      case 'approach':
        others.forEach((d) => this._later(stagger(), () => d.reactTo('watch', {hold: 2.5})));
        break;
      case 'bitten':
        bubbleOne('bitten');
        others.forEach((d) => this._later(stagger() * 0.4, () => {
          d.reactTo('watch', {hold: 1.1});
          this._later(1.2 + Math.random() * 0.4, () => { if (d.state === 'seated') d.reactTo('watch', {hold: 1.6}); });
        }));
        break;
      case 'eaten':
        bubbleOne('eaten', .65);
        others.forEach((d) => this._later(0.6 + stagger(), () => d.reactTo('watch', {hold: 1.5})));
        break;
      case 'boing': {
        const all = this.getDumplings().filter((d) => d.state === 'seated');
        all.forEach((d, i) => this._later(i * 0.09, () => { d.hop(d.character.energy); d.reactTo('hover', {hold: 1.4}); }));
        break;
      }
      case 'refill': {
        const all = this.getDumplings().filter((d) => d.state === 'seated');
        all.forEach((d, i) => this._later(0.3 + i * 0.08, () => { d.reactTo('putback', {hold: 1.6}); if (!motion.reduced && d.character.energy > .5) d.hop(.7*d.character.energy); }));
        break;
      }
      case 'putback':
        if (actor) this.bubbleFrom(actor, voice('putback', actor.personality.id));
        if (actor) this._later(0.2, () => actor.reactTo('putback', {hold: 1.5}));
        others.forEach((d) => this._later(stagger(), () => d.reactTo('watch', {hold: 1.2})));
        break;
      default:
        break;
    }
  }

  update(dt) {
    const target = this.watchTarget;
    for (const d of this.getDumplings()) {
      if (d.state !== 'seated') continue;
      d.lookAt(target && d !== this.actor ? target : null);
    }
  }
}
