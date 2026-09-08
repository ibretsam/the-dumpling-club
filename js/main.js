// The Dumpling Club — entry point. Boots the renderer and scene, loads the dumpling GLB
// (with a procedural fallback), seats the dumplings, wires input, the UI, autoplay and
// recording, and runs the render loop.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COLORS, LAYOUT, STEAMER, PLATE, BOWL, arrangement, PERSONALITIES } from './config.js';
import { DUMPLING_TYPES, TYPE_IDS, getType, buildTypeGeometry } from './dumpling-geometry.js';
import { motion, detectReducedMotion } from './motion.js';
import { quality, configureQuality, AdaptiveResolution } from './quality.js';
import { updateTweens, tween, wait, Ease, cancelAllTweens, damp, clamp } from './tween.js';
import { createRenderer, createScene, createCamera, createLights, createEnvironment, isMobile } from './scene-setup.js';
import { buildBambooSteamer, buildPorcelainPlate, buildSoyBowl, buildChopsticks, buildChopstickRest } from './steamer.js';
import { buildStall, mergeStaticMeshes } from './stall.js';
import { MenuBoard } from './menu-board.js';
import { Dumpling } from './dumpling.js';
import { SteamSystem } from './steam.js';
import { Droplets } from './sauce.js';
import { Crumbs } from './crumbs.js';
import { AudioEngine } from './audio.js';
import { BiteRecorder } from './recorder.js';
import { UI } from './ui.js';
import { ChopstickController } from './chopstick-controller.js';
import { Crowd } from './crowd.js';
import { Interaction } from './interaction.js';
import { getLanguage, setLanguage, dishName, t } from './i18n.js';
import { TYPE_CHARACTERS } from './characters.js';

const state = {
  language: getLanguage(),
  serving: 'steamer',
  portion: 5,
  menu: 'xiaolongbao',      // a type id or 'assorted'
  scene: 'title',           // title | toMenu | menu | toTable | table
  autoplay: false,
  sound: true,
  steam: true,
  sauce: true,
  reducedMotion: false,
  reducedMotionPref: false,
  recording: false,
  canRecord: BiteRecorder.isSupported(),
  round: 0,
};

const app = { state };
window.dumplingClub = app; // handy for debugging in the console
let dumplings = [];
let autoplayToken = 0;
let recordToken = 0;
let lastHintKey = '';

// ------------------------------------------------------------------ boot

async function boot() {
  const canvas = document.getElementById('scene');
  configureQuality({ mobile: isMobile, devicePixelRatio: window.devicePixelRatio || 1 });
  // Every dish starts downloading now. The welcome table only waits for its own dish; the other
  // five arrive behind the title screen, so a phone opens after one small file instead of six.
  app.geometries = createGeometryRegistry({
    onProgress: () => { try { app.ui?.setProgress(app.geometries.progressOf(typeIdsFor(state.menu))); } catch (e) { /* the loader must never break a download */ } },
  });
  const renderer = createRenderer(canvas);
  const scene = createScene();
  const camera = createCamera();
  const lights = createLights(scene);
  createEnvironment(renderer, scene);
  Object.assign(app, { canvas, renderer, scene, camera, lights });

  app.ui = new UI({
    onPlay: () => play(),
    onLanguage: language => changeLanguage(language),
    onMenu: () => openMenu(),
    onOrder: (id, portion) => order(id, portion),
    onMenuFocus: i => app.menuBoard.setHover(i),
    onMenuSelect: i => chooseDish(i),
    onMenuPortion: n => setMenuPortion(n),
    onSound: () => toggle('sound'),
  });
  app.adaptive = new AdaptiveResolution({ apply: () => onResize() });

  state.reducedMotionPref = detectReducedMotion();
  applyMotion();
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener('change', (e) => { state.reducedMotionPref = e.matches; applyMotion(); app.ui?.sync(state); });
  } catch (e) { /* older browsers */ }

  // Load bundled type before painting the physical signs and menu.
  await Promise.all([document.fonts.load('600 34px "Be Vietnam Pro"'), document.fonts.load('600 54px Fraunces')]);

  // Props.
  app.stall = buildStall(); scene.add(app.stall.group);
  app.steamer = buildBambooSteamer(); scene.add(app.steamer.group);
  mergeStaticMeshes(app.steamer.group); // stitch loops, strips and slats: one mesh per material
  app.plate = buildPorcelainPlate(); scene.add(app.plate.group); app.plate.group.visible = false;
  app.bowl = buildSoyBowl(); app.bowl.group.position.set(LAYOUT.bowl.x, LAYOUT.bowl.y, LAYOUT.bowl.z); scene.add(app.bowl.group);
  app.rest = buildChopstickRest(); app.rest.group.position.set(LAYOUT.chopstickRest.x, LAYOUT.chopstickRest.y, LAYOUT.chopstickRest.z); app.rest.group.rotation.y = LAYOUT.chopstickRest.yaw || 0; scene.add(app.rest.group);
  app.chopsticks = buildChopsticks(); scene.add(app.chopsticks.group);
  for (const v of [app.steamer, app.plate]) { v.group.position.set(LAYOUT.steamer.x, LAYOUT.steamer.y, LAYOUT.steamer.z); }

  // Systems.
  app.steam = new SteamSystem({ origin: new THREE.Vector3(0, STEAMER.floorY + 0.12, 0), radius: 0.62, count: isMobile ? 60 : 90, height: 1.5 });
  scene.add(app.steam.object);
  app.stallSteam = new SteamSystem({ origin: app.stall.steamOrigin, radius: 0.5, count: isMobile ? 36 : 56, height: 1.8 });
  scene.add(app.stallSteam.object);
  app.droplets = new Droplets({ scene });
  app.crumbs = new Crumbs({ scene, max: 140 });
  app.audio = new AudioEngine();
  app.audio.enabled = state.sound;
  app.recorder = new BiteRecorder({ renderer, size: 1080, fps: 30, camera });

  app.chop = new ChopstickController(app.chopsticks);
  app.crowd = new Crowd({ ui: app.ui, camera, getDumplings: () => dumplings });
  app.interaction = new Interaction({
    scene, camera, chop: app.chop, crowd: app.crowd, ui: app.ui, audio: app.audio,
    rest: app.rest, bowl: app.bowl, sauce: app.bowl.sauce, droplets: app.droplets, crumbs: app.crumbs,
    getDumplings: () => dumplings,
    getFloorY: () => floorY(),
    getVessel: () => vessel(),
    onRefill: () => refill(),
    onAllEaten: () => onAllEaten(),
    onPhase: () => updateHint(true),
  });

  // The board mounts each food sample as its dish arrives; the welcome table needs its dish now.
  app.menuBoard = new MenuBoard(app.stall.menuBoard, MENU_ITEMS, app.geometries, app.audio);
  await app.geometries.ready(typeIdsFor(state.menu));

  app.camState = camState; app.camLook = camLook; app.shots = SHOTS; app.flyTo = flyTo; app.framing = FRAMING;
  wireInput();
  onResize();
  window.addEventListener('resize', onResize);
  // Camera shots: the stall (title), the menu board, and the table.
  const mb = app.stall.menuBoard;
  SHOTS.table = { pos: new THREE.Vector3(LAYOUT.cameraPos.x, LAYOUT.cameraPos.y, LAYOUT.cameraPos.z), look: new THREE.Vector3(LAYOUT.cameraLookAt.x, LAYOUT.cameraLookAt.y, LAYOUT.cameraLookAt.z), fov: LAYOUT.fov };
  SHOTS.intro = { pos: new THREE.Vector3(0.9, 2.75, 9.8), look: new THREE.Vector3(0.7, 1.25, -1.6), fov: 38 };
  SHOTS.menu = { pos: mb.centre.clone().addScaledVector(mb.normal, 2.45), look: mb.centre.clone(), fov: 40 };
  camState.pos.copy(SHOTS.intro.pos); camState.look.copy(SHOTS.intro.look); camState.fov = SHOTS.intro.fov;
  camLookCur.copy(SHOTS.intro.look);

  app.ui.setMenu(MENU_ITEMS, state.menu);
  app.ui.setMenuPortion(state.portion);
  app.ui.sync(state);
  spawnDumplings(state.portion, { intro: false });
  app.steam.warm?.(2.5);
  app.stallSteam.warm?.(3);
  app.ui.showTitle(true);

  let last = performance.now();
  let time = 0;
  // Manual stepping (used for testing and by hidden tabs where rAF is paused).
  app.step = (dt = 1 / 60, n = 1) => { for (let i = 0; i < n; i++) { time += dt; frame(dt, time); } last = performance.now(); };
  const yieldTask = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); ch.port2.close(); r(); }; ch.port2.postMessage(0); });
  app.run = async (n = 60, dt = 1 / 60) => { for (let i = 0; i < n; i++) { app.step(dt, 1); await yieldTask(); } };
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const raw = (now - last) / 1000;
    let dt = Math.min(0.05, raw);
    last = now;
    dt *= motion.timeScale;
    time += dt;
    if (!state.recording) app.adaptive.update(raw);
    try { frame(dt, time); } catch (err) { if (!app.frameError) { app.frameError = err; console.error('frame error', err); } }
  });

  app.ui.hideLoader();
  app.ui.announce(t('welcome'));
}

const MENU_ITEMS = [
  ...DUMPLING_TYPES.map((t) => ({ id: t.id, name: t.name, cn: t.cn, tag: t.tag, description: t.description })),
  { id: 'assorted', name: 'Chef\u2019s basket', cn: '点心拼盘', tag: 'Assorted · a little of everything', description: 'The chef chooses: a mixed steamer with one of each, so nobody has to decide.' },
];
const pascal = (id) => id.charAt(0).toUpperCase() + id.slice(1);
/** The dish types a menu choice needs before it can be served. */
const typeIdsFor = (menuId) => (menuId === 'assorted' ? TYPE_IDS.slice() : [menuId]);

/**
 * Geometry registry. Each dish is a small quantized GLB in assets/dumplings/, all requested in
 * parallel the moment this is created. `ready(ids)` resolves once those dishes are usable (loaded,
 * or fallen back to the procedural generator after a failed download); `get(id)` is synchronous and
 * never blocks — if a dish is asked for before it arrived, it is built procedurally on the spot.
 */
function createGeometryRegistry({ onProgress } = {}) {
  const loaded = {};     // id -> { body, bitten } from the GLB
  const fallback = {};   // id -> { body, bitten } built procedurally
  const promises = {};   // id -> Promise<boolean> (true when the GLB arrived)
  const progress = {};   // id -> { loaded, total }
  let pending = DUMPLING_TYPES.length;
  const registry = {
    source: 'glb',       // where the welcome dish came from
    loaded: false,       // every dish resolved (GLB or fallback)
    get(id) {
      if (loaded[id]) return loaded[id];
      if (!fallback[id]) {
        console.warn(`dumplings/${id}.glb is not available yet; building the dish procedurally`);
        fallback[id] = { body: buildTypeGeometry(id), bitten: buildTypeGeometry(id, { bitten: true }) };
      }
      return fallback[id];
    },
    ready(ids = TYPE_IDS) { return Promise.all(ids.map((id) => promises[id] || Promise.resolve(false))); },
    /** 0..1 download progress of the given dishes (bytes, once the sizes are known). */
    progressOf(ids = TYPE_IDS) {
      let got = 0, total = 0, done = 0;
      for (const id of ids) { const p = progress[id]; if (!p) continue; got += p.loaded; total += p.total; if (p.done) done++; }
      if (done === ids.length) return 1;
      return total > 0 ? Math.min(0.99, got / total) : 0;
    },
  };
  let loader = null;
  try { loader = new GLTFLoader(); } catch (e) { loader = null; }
  for (const type of DUMPLING_TYPES) {
    const id = type.id;
    const p = progress[id] = { loaded: 0, total: 0, done: false };
    promises[id] = new Promise((resolve) => {
      const done = (ok) => {
        p.done = true;
        if (id === state.menu || !loaded[state.menu]) registry.source = ok ? 'glb' : 'procedural';
        if (--pending === 0) registry.loaded = true;
        onProgress?.();
        resolve(ok);
      };
      if (!loader) { done(false); return; }
      loader.load(`assets/dumplings/${id}.glb`, (gltf) => {
        const byName = {};
        gltf.scene.traverse((o) => { if (o.isMesh) byName[o.name] = o.geometry; });
        const body = byName[pascal(id) + 'Body'], bitten = byName[pascal(id) + 'Bitten'];
        if (body && bitten) loaded[id] = { body, bitten };
        else console.warn(`dumplings/${id}.glb has no ${pascal(id)}Body/${pascal(id)}Bitten meshes; using the procedural dish`);
        done(!!loaded[id]);
      }, (ev) => {
        p.loaded = ev.loaded; if (ev.total) p.total = ev.total;
        onProgress?.();
      }, (err) => {
        console.warn(`dumplings/${id}.glb could not be loaded; building the dish procedurally`, err);
        done(false);
      });
    });
  }
  return registry;
}

// ------------------------------------------------------------------ vessel & dumplings

function vessel() { return state.serving === 'plate' ? app.plate : app.steamer; }
function floorY() { return vessel().group.position.y + vessel().floorY; }

function setServing(v) {
  if (v === state.serving) return;
  state.serving = v;
  app.steamer.group.visible = v === 'steamer';
  app.plate.group.visible = v === 'plate';
  app.steam.setOrigin?.(new THREE.Vector3(0, floorY() + 0.12, 0));
  app.audio.play('ui');
  refill();
}

function shuffled(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function typesForPortion(count) {
  if (state.menu === 'assorted') {
    const pool = shuffled(DUMPLING_TYPES);
    return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
  }
  const t = getType(state.menu);
  return Array.from({ length: count }, () => t);
}

function spawnDumplings(count, { intro = false } = {}) {
  for (const d of dumplings) { app.scene.remove(d.group); d.dispose(); }
  dumplings = [];
  const types = typesForPortion(count);
  const footprint = Math.max(...types.map((t) => t.metrics.radius));
  const inner = vessel().innerRadius - 0.02;
  let seats = arrangement(count, footprint);
  let scale = 1;
  const extent = seats.ringRadius + footprint;
  if (extent > inner) { scale = inner / extent; seats = arrangement(count, footprint * scale); }
  const remaining = shuffled(PERSONALITIES);
  const people = types.map(type => {
    const preferred = remaining.findIndex(person => person.id === TYPE_CHARACTERS[type.id]);
    return remaining.splice(preferred >= 0 ? preferred : 0, 1)[0];
  });
  const fy = floorY();
  const base = vessel().group.position;
  seats.forEach((s, i) => {
    const type = types[i];
    const geo = app.geometries.get(type.id);
    const d = new Dumpling({ personality: people[i], type, bodyGeometry: geo.body, bittenGeometry: geo.bitten, index: i });
    d.fitScale = scale;
    d.seat = new THREE.Vector3(base.x + s.x, fy, base.z + s.z);
    d.seatYaw = s.yaw;
    d.group.position.copy(d.seat);
    d.group.rotation.y = s.yaw;
    d.group.scale.setScalar(scale);
    app.scene.add(d.group);
    dumplings.push(d);
    if (intro) {
      d.serving = true;
      d.group.scale.setScalar(0.001);
      tween({ from: 0.001, to: scale, duration: 0.55, delay: 0.15 + i * 0.09, ease: motion.reduced ? Ease.outCubic : Ease.outBack, onUpdate: (v) => d.group.scale.setScalar(v), onComplete: () => { d.serving = false; } });
    }
  });
  state.round++;
  app.ui.markCurrent(state.menu);
  app.steam.setIntensity((state.serving === 'steamer' ? 1 : 0.55) * (state.menu === 'potsticker' ? 0.45 : 1));
  updateHint(true);
}

function order(id, portion) {
  if (!MENU_ITEMS.some(item => item.id === id)) return;
  state.menu = id;
  if ([3,5,8].includes(portion)) state.portion = portion;
  app.menuBoard.select(id);
  app.menuBoard.setPortion(state.portion);
  app.ui.setMenuPortion(state.portion);
  if (state.scene === 'menu') closeMenu();
  else if (state.scene === 'table') app.geometries.ready(typeIdsFor(id)).then(() => { if (state.scene === 'table' && state.menu === id) refill(); });
}

// ------------------------------------------------------------------ scenes: title → menu board → table

async function play() {
  if (state.scene !== 'title') return;
  app.audio.unlock();
  app.audio.play('chime', { volume: .4 });
  app.ui.showTitle(false);
  await openMenu();
}

async function openMenu() {
  if (!['title','table'].includes(state.scene) || state.recording || app.interaction.busy) return;
  // Mark the transition immediately: rapid clicks cannot start a second camera flight.
  state.scene = 'toMenu';
  app.ui.setCinematic(true);
  setAutoplay(false);
  if (app.interaction.held) await app.interaction.putBack();
  app.interaction.reset();
  app.ui.clearReactions();
  app.interaction.onPointerLeave();
  app.crowd.clearTimers();
  app.audio.unlock();
  app.audio.play('whoosh', { volume: .3 });
  await flyTo(SHOTS.menu, { duration: 1.45, arc: .18 });
  state.scene = 'menu';
  app.menuBoard.active = true;
  app.menuBoard.committing = false;
  app.menuBoard.setHover(-1);
  app.menuBoard.draw();
  app.ui.setCinematic(false);
  app.ui.showMenu(true);
  app.ui.announce(t('menuHelp'));
  app.canvas.focus({ preventScroll: true });
}

function setMenuPortion(n) {
  if (state.scene !== 'menu' || app.menuBoard.committing) return;
  app.menuBoard.setPortion(n);
  app.ui.setMenuPortion(n);
  app.audio.play('clack', { volume: .3, pitch: 1.3 });
  app.ui.announce(t('portion', {n}));
}

async function chooseDish(i) {
  const menu = app.menuBoard;
  if (state.scene !== 'menu' || menu.committing || !MENU_ITEMS[i]) return;
  menu.setHover(i);
  menu.selected = i;
  menu.committing = true;
  menu.draw();
  app.ui.showMenu(false);
  app.audio.play('clack', { volume: .5, pitch: .8 });
  await wait(motion.reduced ? .05 : .45);
  order(MENU_ITEMS[i].id, menu.portion);
}

async function closeMenu() {
  if (state.scene !== 'menu') return;
  state.scene = 'toTable';
  app.menuBoard.active = false;
  app.menuBoard.committing = false;
  app.menuBoard.setHover(-1);
  app.menuBoard.draw();
  app.ui.showMenu(false);
  app.ui.setCinematic(true);
  app.interaction.onPointerLeave();
  app.pointerHas = false;
  app.audio.play('whoosh', { volume: .3, pitch: .9 });
  // The dish usually arrived long ago; on a slow connection the camera simply waits at the table.
  await Promise.all([flyTo(SHOTS.table, { duration: 1.5, arc: .25 }), app.geometries.ready(typeIdsFor(state.menu))]);
  state.scene = 'table';
  app.ui.setCinematic(false);
  // Serve only when the camera arrives, so the fresh-basket animation is actually seen.
  refill();
  app.canvas.focus({ preventScroll: true });
}

function refill({ silent = false } = {}) {
  app.interaction.reset();
  app.ui.clearReactions();
  app.crowd.clearTimers();
  app.droplets.clear?.();
  app.crumbs.clear?.();
  spawnDumplings(state.portion, { intro: true });
  app.ui.sync(state);
  if (!silent) {
    app.audio.play('refill');
    app.steam.puff?.(14, 1);
    setTimeout(() => app.crowd.react('refill'), 500);
    app.ui.announce(t('fresh', {n: state.portion}));
  }
  app.canvas.focus({ preventScroll: true });
}

function onAllEaten() {
  app.ui.announce(t('emptyHelp'));
  app.steam.puff?.(10, .7);
}

// ------------------------------------------------------------------ toggles

function applyMotion() {
  motion.reduced = state.reducedMotion || state.reducedMotionPref;
  document.body.classList.toggle('reduced-motion', motion.reduced);
}

function toggle(name) {
  app.audio.unlock();
  switch (name) {
    case 'autoplay': if (state.scene === 'table') setAutoplay(!state.autoplay); break;
    case 'sound':
      state.sound = !state.sound;
      app.audio.enabled = state.sound;
      if (state.sound) { app.audio.unlock(); app.audio.play('chime', { volume: 0.6 }); }
      break;
    case 'steam':
      state.steam = !state.steam; motion.steam = state.steam;
      app.steam.setEnabled(state.steam);
      app.stallSteam.setEnabled(state.steam);
      break;
    case 'sauce':
      state.sauce = !state.sauce; motion.sauce = state.sauce;
      app.bowl.group.visible = state.sauce;
      app.bowl.sauce?.setEnabled?.(state.sauce);
      if (!state.sauce) app.droplets.clear?.();
      break;
    case 'motion':
      state.reducedMotion = !state.reducedMotion;
      applyMotion();
      break;
    default: break;
  }
  app.audio.play('ui', { volume: 0.5 });
  app.ui.sync(state);
  updateHint(true);
}

function boing() {
  app.audio.unlock();
  app.audio.play('boing');
  app.crowd.react('boing');
  app.steam.puff?.(6, 0.6);
}

// ------------------------------------------------------------------ autoplay

function setAutoplay(on) {
  if (state.autoplay === on) return;
  state.autoplay = on;
  app.interaction.autopilot = on || state.recording;
  app.ui.sync(state);
  if (on) { autoplayLoop(); app.ui.announce(t('autoplayOn')); }
  else { autoplayToken++; app.ui.announce(t('autoplayOff')); }
  updateHint(true);
}

async function autoplayLoop() {
  const token = ++autoplayToken;
  const it = app.interaction;
  const alive = () => token === autoplayToken && state.autoplay && !state.recording;
  while (alive()) {
    if (it.busy) { await wait(0.25); continue; }
    if (it.phase === 'idle') {
      if (it.seated.length === 0) {
        await wait(1.3); if (!alive()) break;
        refill(); await wait(1.6); continue;
      }
      await it.liftChopsticks(); await wait(0.4); continue;
    }
    if (it.phase === 'holding') {
      const seated = it.seated;
      if (!seated.length) { await it.restChopsticks(); continue; }
      const d = seated[Math.floor(Math.random() * seated.length)];
      it.setCandidate(d);
      await wait(0.7); if (!alive()) break;
      await it.pick(d); await wait(0.55); continue;
    }
    if (it.phase === 'carrying') {
      if (motion.sauce && !it.dipped && Math.random() < 0.92) { await it.dip(); await wait(0.45); continue; }
      await it.bite(); await wait(0.9); continue;
    }
    await wait(0.2);
  }
}

// ------------------------------------------------------------------ recording

async function recordBite() {
  app.audio.unlock();
  const it = app.interaction;
  if (state.recording) { recordToken++; return; }           // "Stop" pressed: the director stops early
  if (!state.canRecord) { app.ui.toast(t('recordUnsupported')); return; }
  if (state.scene !== 'table') { app.ui.toast(t('sitFirst')); return; }
  if (it.busy) { app.ui.toast(t('waitBite')); return; }
  if (!(window.innerWidth > 0 && window.innerHeight > 0)) { app.ui.toast(t('windowSmall')); return; }
  const token = ++recordToken;
  const alive = () => token === recordToken;
  const autoplayWas = state.autoplay;
  if (autoplayWas) setAutoplay(false);
  if (it.phase === 'carrying') { await it.putBack(); }
  if (it.seated.length === 0) { refill({ silent: true }); await wait(1.4); }

  state.recording = true;
  it.autopilot = true;
  it.setCandidate(null);
  app.ui.sync(state);
  app.ui.setRecording(true, t('recording'));
  app.ui.setRecordNote(t('recordNote'));
  onResize();
  const audioTrack = state.sound ? app.audio.outputStreamTrack : null;
  const info = app.recorder.start({ audioTrack });
  if (!info) {
    state.recording = false; it.autopilot = state.autoplay; app.ui.setRecording(false); app.ui.sync(state); onResize();
    app.ui.toast(t('recordFailed'));
    return;
  }
  app.ui.setRecordNote(`1080 × 1080 · 30 fps · ${info.ext.toUpperCase()}`);
  const t0 = performance.now();
  const timer = setInterval(() => app.ui.setRecordTime((performance.now() - t0) / 1000), 100);

  try {
    await wait(0.9);
    if (alive() && it.phase === 'idle') { await it.liftChopsticks(); await wait(0.35); }
    if (alive() && it.phase === 'holding') {
      const seated = it.seated.slice().sort((a, b) => b.seat.z - a.seat.z);
      const d = seated[0];
      it.setCandidate(d); await wait(0.6);
      if (alive()) await it.pick(d);
      if (alive()) await wait(0.45);
    }
    if (alive() && it.phase === 'carrying' && motion.sauce) { await it.dip(); if (alive()) await wait(0.35); }
    if (alive() && it.phase === 'carrying') { await it.bite(); }
    if (alive()) await wait(1.0);
  } catch (e) { console.warn(e); }

  clearInterval(timer);
  app.ui.setRecording(true, t('saving'));
  const result = await app.recorder.stop();
  state.recording = false;
  it.autopilot = false;
  app.ui.setRecording(false);
  app.ui.sync(state);
  onResize();
  if (result && result.blob && result.blob.size > 0) {
    const name = `dumpling-club-bite-${String(Date.now()).slice(-6)}`;
    app.recorder.download(result, name);
    const mb = (result.blob.size / 1048576).toFixed(1);
    app.ui.toast(t('saved', {file: `<strong>${name}.${result.ext}</strong>`, mb}), 6000);
    app.ui.announce(t('savedAnnouncement', {file: `${name}.${result.ext}`}));
    setTimeout(() => app.recorder.release?.(result), 30000);
  } else {
    app.ui.toast(t('recordEmpty'));
  }
  if (autoplayWas) setAutoplay(true);
}

// ------------------------------------------------------------------ input

function wireInput() {
  const { canvas, ui, interaction } = app;
  const ndc = new THREE.Vector2();
  const toNdc = e => {
    const r = canvas.getBoundingClientRect();
    return ndc.set((e.clientX-r.left)/r.width*2-1, 1-(e.clientY-r.top)/r.height*2);
  };
  let down = null;
  canvas.addEventListener('pointermove', e => {
    toNdc(e);
    app.pointerNdc.copy(ndc); app.pointerHas = e.pointerType !== 'touch';
    if (state.scene === 'table') interaction.onPointerMove(ndc, e.pointerType === 'touch');
    if (state.scene === 'menu') {
      const hit = app.menuBoard.hit(ndc, app.camera);
      app.menuBoard.setHover(hit?.kind === 'dish' ? hit.index : -1);
      ui.setCursor(hit && hit.kind !== 'paper' ? 'pointer' : 'default');
    }
  });
  canvas.addEventListener('pointerleave', () => {
    interaction.onPointerLeave(); app.pointerHas=false;
    if (state.scene === 'menu') app.menuBoard.setHover(-1);
  });
  canvas.addEventListener('pointerdown', e => {
    if(e.button !== 0) return;
    down={x:e.clientX,y:e.clientY,t:performance.now(),type:e.pointerType};
    canvas.focus({preventScroll:true}); app.audio.unlock();
  });
  canvas.addEventListener('pointerup', e => {
    if(!down) return;
    const tap=Math.hypot(e.clientX-down.x,e.clientY-down.y)<12 && performance.now()-down.t<700;
    const touch=down.type==='touch'; down=null;
    if(!tap) return;
    toNdc(e);
    if(state.recording) { recordBite(); return; }
    if(state.scene==='menu') {
      const hit=app.menuBoard.hit(ndc,app.camera);
      if(hit?.kind==='dish') chooseDish(hit.index);
      else if(hit?.kind==='portion') setMenuPortion(hit.value);
      return;
    }
    if(state.scene!=='table') return;
    if(state.autoplay) setAutoplay(false);
    // A held dumpling owns every table gesture. The menu can be opened once it is put back.
    if(!interaction.held && !interaction.busy && app.menuBoard.hit(ndc,app.camera)) { openMenu(); return; }
    interaction.onClick(ndc,touch);
  });
  canvas.addEventListener('pointercancel', () => { down=null; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if(e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.target?.closest('input,textarea,[contenteditable="true"]')) return;
    if(e.target?.closest('button') && ['Enter',' '].includes(e.key)) return;
    if(e.repeat && !e.key.startsWith('Arrow')) return;
    if(state.recording) { if(e.key==='Escape') {recordBite();e.preventDefault();} return; }
    if(e.key.toLowerCase()==='m') { toggle('sound'); ui.announce(t(state.sound?'soundOn':'soundOff')); return; }
    if(state.scene==='title') { if(['Enter',' '].includes(e.key)) {play();e.preventDefault();} return; }
    if(state.scene==='menu') {
      if(app.menuBoard.committing) return;
      const menu=app.menuBoard;
      if(e.key.startsWith('Arrow')) {
        const dir=['ArrowUp','ArrowLeft'].includes(e.key)?-1:1;
        const i=menu.hover<0?(dir>0?0:MENU_ITEMS.length-1):(menu.hover+dir+MENU_ITEMS.length)%MENU_ITEMS.length;
        menu.setHover(i); ui.announce(dishName(MENU_ITEMS[i].id)); e.preventDefault();
      } else if(['3','5','8'].includes(e.key)) setMenuPortion(+e.key);
      else if(e.key==='Enter') {chooseDish(Math.max(0,menu.hover));e.preventDefault();}
      else if(e.key==='Escape') closeMenu();
      return;
    }
    if(state.scene!=='table') return;
    switch(e.key.toLowerCase()) {
      case ' ': boing(); e.preventDefault(); return;
      case 'a': toggle('autoplay'); return;
      case 's': toggle('steam'); return;
      case 'r': refill(); return;
      case 'o': openMenu(); return;
      case 'v': recordBite(); return;
    }
    if(state.autoplay) setAutoplay(false);
    if(interaction.onKey(e.key)) e.preventDefault();
  });
  app.pointerNdc=new THREE.Vector2(); app.pointerHas=false;
  wireTilt();
}

/**
 * Device tilt → small camera parallax on phones. Only where orientation events arrive without a
 * permission dialog (Android browsers); iOS keeps the gentle drift instead. The resting angle is
 * re-learned slowly, so however the phone is held is neutral and only quick tilts move the shot.
 */
function wireTilt() {
  app.tilt = { x: 0, y: 0 };
  const DOE = window.DeviceOrientationEvent;
  if (!quality.mobile || typeof DOE === 'undefined' || typeof DOE.requestPermission === 'function') return;
  let baseG = null, baseB = null;
  window.addEventListener('deviceorientation', (e) => {
    if (typeof e.gamma !== 'number' || typeof e.beta !== 'number') return;
    let g = e.gamma, b = e.beta;
    const angle = (screen.orientation && screen.orientation.angle) || 0;
    if (angle === 90) { const t = g; g = b; b = -t; } else if (angle === 270) { const t = g; g = -b; b = t; }
    if (baseG === null) { baseG = g; baseB = b; }
    baseG += (g - baseG) * 0.006; baseB += (b - baseB) * 0.006;
    app.tilt.x = clamp((g - baseG) / 22, -1, 1);
    app.tilt.y = clamp((baseB - b) / 22, -1, 1);
  }, { passive: true });
}

// ------------------------------------------------------------------ camera, hint, resize

const SHOTS = {};
// Responsive framing knobs (portrait phones blend toward these; landscape uses the raw shots).
const FRAMING = {
  tablePullBack: 2.5,   // camera moves back this far on a fully portrait table
  tableLift: 0.95,      // ...and up this far
  tableSlide: -0.3,     // ...and left this far
  tableLookY: 0.42,     // look-at rises so the sign clears the corner controls and the basket, sticks and bowl all fit
  tableLookZ: 0.3,      // look-at comes forward so the tabletop foreground is not half the frame
  introLookY: -0.55,    // the welcome shot looks lower on portrait screens (less empty wall)
  introFov: 14,         // extra vertical fov for the welcome shot on portrait screens
};
const camState = { tableBlend: 0, menuBlend: 0, pos: new THREE.Vector3(LAYOUT.cameraPos.x, LAYOUT.cameraPos.y, LAYOUT.cameraPos.z), look: new THREE.Vector3(LAYOUT.cameraLookAt.x, LAYOUT.cameraLookAt.y, LAYOUT.cameraLookAt.z), fov: LAYOUT.fov };
const camLook = new THREE.Vector3(LAYOUT.cameraLookAt.x, LAYOUT.cameraLookAt.y, LAYOUT.cameraLookAt.z);
const camOffset = new THREE.Vector3();
const camDrift = new THREE.Vector3();
const camTmp = new THREE.Vector3();
const camLookCur = camLook.clone();
let flight = null;

/** Cinematic move of the camera to a shot { pos, look, fov }. Resolves when it arrives. */
function flyTo(shot, { duration = 2.2, ease = Ease.inOutCubic, arc = 0.4 } = {}) {
  if (flight) flight.cancel();
  if (motion.reduced) { duration = .16; arc = 0; }
  const p0 = camState.pos.clone(), l0 = camState.look.clone(), f0 = camState.fov;
  const p1 = shot.pos.clone(), l1 = shot.look.clone(), f1 = shot.fov;
  const table0 = camState.tableBlend, menu0 = camState.menuBlend;
  const table1 = shot === SHOTS.table ? 1 : 0, menu1 = shot === SHOTS.menu ? 1 : 0;
  flight = tween({
    from: 0, to: 1, duration, ease,
    onUpdate: (t) => {
      camState.pos.lerpVectors(p0, p1, t);
      camState.pos.y += Math.sin(t * Math.PI) * arc;
      camState.look.lerpVectors(l0, l1, t);
      camState.fov = f0 + (f1 - f0) * t;
      camState.tableBlend = table0 + (table1 - table0) * t;
      camState.menuBlend = menu0 + (menu1 - menu0) * t;
    },
  });
  return flight.promise;
}

function updateCamera(dt, time) {
  const { camera, interaction } = app;
  const table = state.scene === 'table';
  const square = state.recording;
  const aspect = camera.aspect || 1;
  const narrow = clamp((1.25 - aspect) / 0.8, 0, 1);
  // Parallax from the pointer (only at the table; never in reduced motion or while recording).
  // Phones have no pointer: a small tilt of the device (where the browser exposes it without a
  // permission prompt) moves the camera the same way, and the shot breathes very slightly.
  const live = table && !motion.reduced && !square && app.pointerHas;
  const handheld = table && !motion.reduced && !square && !app.pointerHas && quality.mobile ? 1 : 0;
  const px = live ? app.pointerNdc.x : handheld * app.tilt.x;
  const py = live ? app.pointerNdc.y : handheld * app.tilt.y;
  // Narrow (portrait) screens pull the table shot back; square recordings push in slightly.
  const tNarrow = camState.tableBlend * (square ? -0.12 : narrow);
  camOffset.x = damp(camOffset.x, px * 0.12 + FRAMING.tableSlide * tNarrow, 3, dt);
  camOffset.y = damp(camOffset.y, py * 0.06 + FRAMING.tableLift * tNarrow, 3, dt);
  camOffset.z = damp(camOffset.z, FRAMING.tablePullBack * tNarrow, 3, dt);
  // A slow drift while the title screen is up; a much smaller breath at a handheld table.
  const drifting = state.scene === 'title' && !motion.reduced ? 1 : 0;
  camDrift.x = damp(camDrift.x, Math.sin(time * 0.21) * 0.5 * drifting + Math.sin(time * 0.23) * 0.045 * handheld, 2, dt);
  camDrift.y = damp(camDrift.y, Math.sin(time * 0.33 + 1) * 0.16 * drifting + Math.sin(time * 0.31 + 1) * 0.02 * handheld, 2, dt);
  camDrift.z = damp(camDrift.z, Math.cos(time * 0.17) * 0.25 * drifting, 2, dt);

  camTmp.copy(camState.look);
  if (table) {
    camTmp.x += square ? (0.78 - camLook.x) : 0;
    camTmp.y += square ? 0.12 : 0;
  }
  const introBlend = clamp(1 - camState.tableBlend - camState.menuBlend, 0, 1);
  camTmp.y += square ? 0 : FRAMING.tableLookY * narrow * camState.tableBlend + FRAMING.introLookY * narrow * introBlend;
  camTmp.z += FRAMING.tableLookZ * narrow * camState.tableBlend;
  camLookCur.lerp(camTmp, 1 - Math.exp(-5 * dt));
  camera.position.copy(camState.pos).add(camOffset).add(camDrift);
  // A chomp pushes the camera a little toward the food and back (with the existing shake).
  if (interaction.punch > 0 && !motion.reduced) {
    camTmp.subVectors(camLookCur, camera.position).normalize();
    camera.position.addScaledVector(camTmp, interaction.punch * 0.16);
  }
  if (interaction.shake > 0 && !motion.reduced) {
    const sh = interaction.shake * 0.018;
    camera.position.x += (Math.random() - 0.5) * sh;
    camera.position.y += (Math.random() - 0.5) * sh;
  }
  camera.lookAt(camLookCur);
  const menuFov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(1.65, 1.27 / aspect) / (2 * 2.45)));
  const fov = (square ? 31 : camState.fov
    + camState.tableBlend * clamp((1.25-aspect)*18,0,22)
    + camState.menuBlend * Math.max(0,menuFov-SHOTS.menu.fov)
    + introBlend * narrow * FRAMING.introFov)
    - (motion.reduced ? 0 : interaction.punch * 1.6);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

let menuRedrawTimer = 0;
function onResize() {
  const { renderer, camera } = app;
  if (state.recording) {
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    return;
  }
  const w = window.innerWidth, h = window.innerHeight;
  if (!(w > 0 && h > 0)) return; // hidden or collapsed window: keep the previous framing
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(w, h, false);
  app.adaptive?.reset();
  // The board's headline size depends on the viewport; redraw once the resize has settled.
  clearTimeout(menuRedrawTimer);
  menuRedrawTimer = setTimeout(() => app.menuBoard?.draw(), 120);
  camera.aspect = w / h;
  camera.updateProjectionMatrix(); // fov follows the current shot in updateCamera
}

function changeLanguage(language) {
  if (!setLanguage(language)) return;
  state.language = getLanguage();
  app.ui.localize();
  app.ui.clearReactions();
  app.menuBoard?.draw();
  lastHintKey = '';
  updateHint();
  if (state.scene === 'title') app.ui.announce(t('welcome'));
  else if (state.scene === 'menu') app.ui.announce(t('menuHelp'));
}

function updateHint() {
  const it=app.interaction;
  const empty = !it.getDumplings().some(d => d.state !== 'eaten');
  app.ui.showNextRound(state.scene === 'table' && empty && !it.busy && !state.recording && !state.autoplay);
  let guide = '';
  if (!state.recording) {
    if (state.scene === 'menu' && !app.menuBoard.committing) guide = t('guideMenu');
    else if (state.scene === 'table' && !it.busy && !state.autoplay) {
      if (empty) guide = '';
      else if (it.phase === 'idle') guide = t('guideIdle');
      else if (it.phase === 'holding') guide = t('guideChoose');
      else if (it.phase === 'carrying') guide = it.pointer.overRest ? t('guideRest')
        : t('guideCarry');
    }
  }
  app.ui.setGuide(guide, state.scene);
  if(state.scene !== 'table' || state.recording) return;
  const key=it.phase+'|'+!!it.held+'|'+it.seated.length;
  if(key===lastHintKey) return;
  lastHintKey=key;
  const text = it.phase==='carrying' ? t('carryHelp')
    : it.phase==='idle' || it.phase==='holding' ? (it.seated.length ? (it.phase === 'idle' ? t('idleHelp') : t('chooseHelp')) : t('emptyHelp')) : '';
  app.ui.setHint(text);
}

// ------------------------------------------------------------------ frame

const dropletEnv = { sauceSurface: null, sauceWorldY: 0, sauceCenter: new THREE.Vector3(), sauceRadius: BOWL.sauceRadius, bowlRadius: BOWL.outerRadius, tableY: 0, landings: [{ x: 0, z: 0, y: 0, radius: 1, stain: true }] };

function frame(dt, time) {
  const { scene, camera, renderer, interaction, chop, crowd, steam, droplets, crumbs, bowl, ui } = app;
  updateTweens(dt);
  updateCamera(dt, time);
  if (state.scene === 'table' || interaction.busy) interaction.update(dt);
  app.menuBoard.update(dt,time);
  if (state.scene === 'table' && !interaction.held && !interaction.busy && app.pointerHas && app.menuBoard.hit(app.pointerNdc,camera)) ui.setCursor('pointer');
  chop.update(dt, camera);
  for (const d of dumplings) d.update(dt, time, { camera });
  interaction.syncCarry(dt);
  crowd.update(dt);
  vessel().update?.(dt, time);
  app.chopsticks.update?.(dt, time);
  bowl.update?.(dt, time);
  steam.update(dt, time);
  app.stallSteam.update(dt, time);
  app.stall.update(dt, time);
  dropletEnv.sauceSurface = state.sauce ? bowl.sauce : null;
  dropletEnv.sauceWorldY = bowl.group.position.y + BOWL.sauceY;
  dropletEnv.sauceCenter.copy(bowl.group.position);
  dropletEnv.sauceCenter.y = dropletEnv.sauceWorldY;
  const land = dropletEnv.landings[0]; land.x = vessel().group.position.x; land.z = vessel().group.position.z; land.y = floorY(); land.radius = vessel().innerRadius;
  droplets.update(dt, dropletEnv);
  crumbs.update(dt);
  updateHint();
  if (state.scene === 'table') ui.updateReactions(dt);
  else ui.clearReactions();
  renderer.render(scene, camera);
}

boot().catch((err) => {
  console.error(err);
  const loader = document.getElementById('loader');
  if (loader) loader.textContent = t('error');
});
