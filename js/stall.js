// js/stall.js — the dim sum stall around the table: a counter with a wooden front, a floor, a
// plaster back wall with shelves of jars and bowls, wooden posts, a striped awning with a
// scalloped valance, a hanging sign, red paper lanterns, a stove with a stack of bamboo steamers,
// a chopstick cup, and a standing menu board the camera flies to when the player orders.
// Everything is procedural (canvas textures, lathe/box geometry). Units: 1 = 10 cm, y up.
import * as THREE from 'three';
import { COLORS } from './config.js';
import { bambooTexture, wovenTexture, noiseCanvas } from './textures.js';
import { motion } from './motion.js';

const cache = new Map();
function canvasTexture(key, w, h, paint, { repeat = null, wrap = THREE.RepeatWrapping, colorSpace = THREE.SRGBColorSpace } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = colorSpace; t.wrapS = t.wrapT = wrap; t.anisotropy = 4;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  cache.set(key, t);
  return t;
}

function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

function woodTexture(key, base, dark, light, seed = 3) {
  return canvasTexture(key, 512, 512, (ctx, w, h) => {
    const rnd = mulberry(seed);
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    // planks
    const plankH = 128;
    for (let p = 0; p < h / plankH; p++) {
      const y0 = p * plankH;
      const tone = 0.9 + rnd() * 0.2;
      ctx.fillStyle = `rgba(0,0,0,${0.08 * (1 - tone)})`; ctx.fillRect(0, y0, w, plankH);
      // grain
      for (let i = 0; i < 22; i++) {
        const yy = y0 + rnd() * plankH;
        ctx.strokeStyle = rnd() < 0.5 ? dark : light; ctx.globalAlpha = 0.08 + rnd() * 0.12; ctx.lineWidth = 0.6 + rnd() * 1.4;
        ctx.beginPath();
        const amp = 2 + rnd() * 5, freq = 0.01 + rnd() * 0.02, ph = rnd() * 10;
        for (let x = 0; x <= w; x += 8) { const y = yy + Math.sin(x * freq + ph) * amp; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // seam
      ctx.fillStyle = 'rgba(40,20,8,0.45)'; ctx.fillRect(0, y0 + plankH - 3, w, 3);
      ctx.fillStyle = 'rgba(255,240,220,0.18)'; ctx.fillRect(0, y0, w, 2);
      // a knot now and then
      if (rnd() < 0.6) {
        const kx = rnd() * w, ky = y0 + 20 + rnd() * (plankH - 40);
        const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, 14 + rnd() * 10);
        g.addColorStop(0, dark); g.addColorStop(0.5, 'rgba(60,35,15,0.35)'); g.addColorStop(1, 'rgba(60,35,15,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(kx, ky, 26, 12, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
}

function plasterTexture() {
  return canvasTexture('stall:plaster', 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#EBDCC6'; ctx.fillRect(0, 0, w, h);
    const n = noiseCanvas(512, { seed: 9, cells: 6, octaves: 4, contrast: 1.4 });
    if (n) { ctx.globalAlpha = 0.16; ctx.drawImage(n, 0, 0, w, h); ctx.globalAlpha = 1; }
    const rnd = mulberry(11);
    for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(120,90,60,${0.04 + rnd() * 0.08})`; ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
  });
}

function floorTexture() {
  return canvasTexture('stall:floor', 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#B7A38C'; ctx.fillRect(0, 0, w, h);
    const rnd = mulberry(5);
    const tile = 128;
    for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) {
      ctx.fillStyle = `rgba(${90 + rnd() * 40},${70 + rnd() * 30},${50 + rnd() * 25},${0.18 + rnd() * 0.18})`;
      ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
    }
    const n = noiseCanvas(512, { seed: 21, cells: 8, octaves: 3, contrast: 1.6 });
    if (n) { ctx.globalAlpha = 0.18; ctx.drawImage(n, 0, 0, w, h); ctx.globalAlpha = 1; }
    ctx.strokeStyle = 'rgba(70,50,35,0.5)'; ctx.lineWidth = 3;
    for (let i = 0; i <= w; i += tile) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
  }, { repeat: [10, 10] });
}

function awningTexture() {
  return canvasTexture('stall:awning', 512, 256, (ctx, w, h) => {
    const stripe = 64;
    for (let x = 0; x < w; x += stripe) { ctx.fillStyle = (x / stripe) % 2 === 0 ? COLORS.terracotta : '#F4E7D3'; ctx.fillRect(x, 0, stripe, h); }
    const n = noiseCanvas(256, { seed: 4, cells: 12, octaves: 2, contrast: 1.2 });
    if (n) { ctx.globalAlpha = 0.12; ctx.drawImage(n, 0, 0, w, h); ctx.globalAlpha = 1; }
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0.18)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { repeat: [5, 1] });
}

const SERIF = 'Fraunces, Georgia, serif';
const CJK = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", "Songti SC", serif';

function signTexture() {
  return canvasTexture('stall:sign', 1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4E3120'; ctx.fillRect(0, 0, w, h);
    const rnd = mulberry(8);
    for (let i = 0; i < 60; i++) { ctx.strokeStyle = `rgba(0,0,0,${0.08 + rnd() * 0.14})`; ctx.lineWidth = 1 + rnd() * 2; ctx.beginPath(); const y = rnd() * h; ctx.moveTo(0, y); ctx.lineTo(w, y + (rnd() - 0.5) * 12); ctx.stroke(); }
    ctx.strokeStyle = '#D9B27A'; ctx.lineWidth = 6; ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.fillStyle = '#F6E7CF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 98px ${SERIF}`; ctx.fillText('The Dumpling Club', w / 2, h / 2 - 22, w - 100);
    ctx.font = `400 46px ${CJK}`; ctx.fillStyle = '#E5B77D'; ctx.fillText('· 点 心 ·', w / 2, h / 2 + 68);
  }, { wrap: THREE.ClampToEdgeWrapping });
}


function lanternTexture() {
  return canvasTexture('stall:lantern', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#E4552F'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 18) { const g = ctx.createLinearGradient(0, y, 0, y + 18); g.addColorStop(0, 'rgba(120,20,0,0.35)'); g.addColorStop(0.4, 'rgba(255,200,150,0.12)'); g.addColorStop(1, 'rgba(120,20,0,0.35)'); ctx.fillStyle = g; ctx.fillRect(0, y, w, 18); }
    for (let x = 0; x < w; x += 32) { ctx.fillStyle = 'rgba(90,10,0,0.25)'; ctx.fillRect(x, 0, 2, h); }
  }, { repeat: [3, 1] });
}

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

function roundedRectShape(w, d, r) {
  const s = new THREE.Shape();
  const x0 = -w / 2, z0 = -d / 2, x1 = w / 2, z1 = d / 2;
  s.moveTo(x0 + r, z0); s.lineTo(x1 - r, z0); s.quadraticCurveTo(x1, z0, x1, z0 + r);
  s.lineTo(x1, z1 - r); s.quadraticCurveTo(x1, z1, x1 - r, z1);
  s.lineTo(x0 + r, z1); s.quadraticCurveTo(x0, z1, x0, z1 - r);
  s.lineTo(x0, z0 + r); s.quadraticCurveTo(x0, z0, x0 + r, z0);
  return s;
}

function lathe(points, segments, material, { shadow = true } = {}) {
  const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow; m.receiveShadow = shadow;
  return m;
}

export function buildStall() {
  const group = new THREE.Group();
  group.name = 'Stall';
  const animated = [];

  const plank = woodTexture('stall:plank', '#B98C5E', '#6B4529', '#E2C39A', 3);
  const darkPlank = woodTexture('stall:darkplank', '#6E4A2D', '#3C2414', '#9C7248', 7);
  const woodMat = new THREE.MeshStandardMaterial({ map: plank, roughness: 0.82, metalness: 0 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ map: darkPlank, roughness: 0.78, metalness: 0 });
  const plasterMat = new THREE.MeshStandardMaterial({ map: plasterTexture(), roughness: 1, metalness: 0 });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95, metalness: 0 });
  const ceramicMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#F4EEE3'), roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const glazeMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(COLORS.terracotta), roughness: 0.4, clearcoat: 0.35 });
  const celadonMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#9FB9A4'), roughness: 0.35, clearcoat: 0.4 });
  const ironMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3B3330'), roughness: 0.6, metalness: 0.55 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#4A2A12'), roughness: 0.15, clearcoat: 0.8, transparent: true, opacity: 0.92 });
  const paperMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#F6EEDC'), roughness: 0.9 });
  const clothMat = new THREE.MeshStandardMaterial({ map: awningTexture(), roughness: 0.95, side: THREE.DoubleSide });
  const lanternMat = new THREE.MeshStandardMaterial({ map: lanternTexture(), roughness: 0.7, emissive: new THREE.Color('#D8401E'), emissiveIntensity: 0.35, emissiveMap: lanternTexture() });

  // ---- Counter: cream top on a wooden body, plus the floor.
  const topShape = roundedRectShape(9.6, 6.9, 0.35);
  const topGeo = new THREE.ExtrudeGeometry(topShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  topGeo.rotateX(Math.PI / 2); // extrude along -y
  const top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(COLORS.table), roughness: 1, metalness: 0 }));
  top.position.set(0.4, 0.0, 0.05);
  top.receiveShadow = true; top.castShadow = false;
  group.add(top);
  const body = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.86, 6.7), woodMat);
  body.position.set(0.4, -0.16 - 0.43, 0.05);
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.08, 6.8), darkWoodMat);
  trim.position.set(0.4, -0.2, 0.05);
  group.add(trim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(26, 48), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.02;
  floor.receiveShadow = true;
  group.add(floor);

  // ---- Back wall with a baseboard.
  const wallZ = -5.3;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 5.6), plasterMat);
  wall.position.set(0.5, 1.78, wallZ); wall.receiveShadow = true;
  group.add(wall);
  const baseboard = new THREE.Mesh(new THREE.BoxGeometry(16, 0.28, 0.08), darkWoodMat);
  baseboard.position.set(0.5, -0.88, wallZ + 0.04);
  group.add(baseboard);

  // ---- Posts, beam, awning, valance.
  const postGeo = new THREE.BoxGeometry(0.22, 4.45, 0.22);
  for (const x of [-4.2, 5.1]) {
    const post = new THREE.Mesh(postGeo, darkWoodMat);
    post.position.set(x, 1.2, -2.35); post.castShadow = true;
    group.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(9.9, 0.2, 0.2), darkWoodMat);
  beam.position.set(0.45, 3.35, -2.35); beam.castShadow = true;
  group.add(beam);
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(10.2, 3.4, 1, 1), clothMat);
  awning.position.set(0.45, 3.78, -3.85);
  awning.rotation.x = -Math.PI / 2 + 0.2; // sloping down toward the front
  awning.castShadow = false;
  group.add(awning);
  const valance = new THREE.Group();
  const scallopGeo = new THREE.CircleGeometry(0.26, 16, Math.PI, Math.PI);
  for (let i = 0; i < 20; i++) {
    const sc = new THREE.Mesh(scallopGeo, i % 2 === 0 ? new THREE.MeshStandardMaterial({ color: new THREE.Color(COLORS.terracotta), roughness: 0.95, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ color: new THREE.Color('#F4E7D3'), roughness: 0.95, side: THREE.DoubleSide }));
    sc.position.set(-4.3 + i * 0.5, 3.46, -2.2);
    valance.add(sc);
  }
  const valanceBar = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.16, 0.05), clothMat);
  valanceBar.position.set(0.45, 3.52, -2.2);
  valance.add(valanceBar);
  group.add(valance);

  // ---- Sign hanging from the beam.
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.66, 0.06), [darkWoodMat, darkWoodMat, darkWoodMat, darkWoodMat, new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.75 }), darkWoodMat]);
  sign.position.set(0.5, 2.72, -2.3); sign.castShadow = true;
  group.add(sign);
  const ropeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8E6B41'), roughness: 1 });
  for (const dx of [-1.1, 1.1]) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), ropeMat);
    rope.position.set(0.5 + dx, 3.2, -2.3);
    group.add(rope);
  }

  // ---- Lanterns.
  const lanternProfile = [[0.02, 0], [0.15, 0.05], [0.25, 0.17], [0.28, 0.3], [0.25, 0.43], [0.15, 0.55], [0.02, 0.6]];
  for (const x of [-2.7, 3.7]) {
    const l = new THREE.Group();
    const bodyL = lathe(lanternProfile, 28, lanternMat);
    bodyL.position.y = -0.3;
    l.add(bodyL);
    const capGeo = new THREE.CylinderGeometry(0.09, 0.07, 0.05, 16);
    const capT = new THREE.Mesh(capGeo, ironMat); capT.position.y = 0.31; l.add(capT);
    const capB = new THREE.Mesh(capGeo, ironMat); capB.position.y = -0.31; capB.rotation.x = Math.PI; l.add(capB);
    const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color('#C9A227'), roughness: 0.9 }));
    tassel.position.y = -0.46; tassel.rotation.x = Math.PI; l.add(tassel);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 6), ropeMat);
    string.position.y = 0.5; l.add(string);
    l.position.set(x, 2.62, -2.55);
    group.add(l);
    animated.push({ obj: l, phase: x, amp: 0.035, rate: 0.7 });
  }

  // ---- Stove and a stack of steamers behind the counter (left).
  const stove = new THREE.Group();
  const stoveBody = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.2), ironMat);
  stoveBody.position.y = -1.02 + 0.45; stoveBody.castShadow = true; stove.add(stoveBody);
  const pot = lathe([[0.55, 0], [0.66, 0.04], [0.68, 0.5], [0.62, 0.52], [0.6, 0.48], [0.55, 0.45]], 40, ironMat);
  pot.position.y = -0.57; stove.add(pot);
  const bamboo = bambooTexture().clone(); bamboo.repeat.set(4, 1); bamboo.needsUpdate = true;
  const woven = wovenTexture().clone(); woven.repeat.set(6, 1); woven.needsUpdate = true;
  const ringMat = new THREE.MeshStandardMaterial({ map: bamboo, roughness: 0.75 });
  const bandMat = new THREE.MeshStandardMaterial({ map: woven, roughness: 0.8 });
  let y = -0.07;
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.38, 40, 1, true), ringMat);
    ring.material.side = THREE.DoubleSide; ring.position.y = y + 0.19; ring.castShadow = true; ring.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.712, 0.712, 0.07, 40, 1, true), bandMat);
    band.position.y = y + 0.32;
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.73, 0.71, 0.05, 40, 1, true), ringMat);
    lip.position.y = y + 0.02;
    stove.add(ring, band, lip);
    y += 0.4;
  }
  const lidTop = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.1, 40), bandMat);
  lidTop.position.y = y + 0.05; lidTop.castShadow = true; stove.add(lidTop);
  const knob = lathe([[0.02, 0], [0.09, 0.02], [0.11, 0.06], [0.08, 0.1], [0.03, 0.12], [0, 0.125]], 20, ringMat);
  knob.position.y = y + 0.1; stove.add(knob);
  stove.position.set(-2.5, 0, -4.15);
  group.add(stove);
  const steamOrigin = new THREE.Vector3(-2.5, y + 0.12, -4.15);

  // ---- Shelves with jars, bottles, bowls, a teapot, cups.
  const shelfGeo = new THREE.BoxGeometry(4.6, 0.07, 0.34);
  const bracketGeo = new THREE.BoxGeometry(0.06, 0.24, 0.3);
  const shelfItems = new THREE.Group();
  for (const sy of [1.45, 2.25]) {
    const shelf = new THREE.Mesh(shelfGeo, darkWoodMat);
    shelf.position.set(2.3, sy, wallZ + 0.19); shelf.castShadow = true; shelf.receiveShadow = true;
    shelfItems.add(shelf);
    for (const bx of [0.3, 4.3]) { const b = new THREE.Mesh(bracketGeo, darkWoodMat); b.position.set(bx, sy - 0.15, wallZ + 0.17); shelfItems.add(b); }
  }
  const jarProfile = [[0, 0], [0.13, 0], [0.16, 0.06], [0.15, 0.24], [0.11, 0.28], [0.12, 0.31], [0, 0.31]];
  const jarMats = [ceramicMat, glazeMat, celadonMat];
  [0.7, 1.15, 1.6].forEach((x, i) => { const j = lathe(jarProfile, 24, jarMats[i]); j.position.set(x, 2.29, wallZ + 0.2); shelfItems.add(j); });
  for (const x of [2.4, 2.65]) {
    const bottle = lathe([[0, 0], [0.06, 0], [0.065, 0.24], [0.03, 0.3], [0.03, 0.37], [0, 0.37]], 18, glassMat);
    bottle.position.set(x, 2.29, wallZ + 0.2); shelfItems.add(bottle);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.1), paperMat);
    label.position.set(x, 2.42, wallZ + 0.267); shelfItems.add(label);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 12), new THREE.MeshStandardMaterial({ color: new THREE.Color(COLORS.terracottaDeep), roughness: 0.6 }));
    cap.position.set(x, 2.67, wallZ + 0.2); shelfItems.add(cap);
  }
  const bowlProfile = [[0, 0], [0.09, 0], [0.11, 0.015], [0.2, 0.09], [0.21, 0.1], [0.19, 0.1], [0.1, 0.03], [0.02, 0.025]];
  for (const [x, mat] of [[3.4, ceramicMat], [4.0, celadonMat]]) {
    for (let k = 0; k < 4; k++) { const b = lathe(bowlProfile, 28, mat); b.position.set(x, 2.29 + k * 0.045, wallZ + 0.2); shelfItems.add(b); }
  }
  // lower shelf: teapot, cups, more bowls
  const teapot = new THREE.Group();
  const potBody = lathe([[0, 0], [0.12, 0], [0.19, 0.06], [0.2, 0.14], [0.16, 0.22], [0.09, 0.25], [0.1, 0.27], [0, 0.27]], 28, glazeMat);
  teapot.add(potBody);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.22, 10), glazeMat);
  spout.position.set(0.22, 0.17, 0); spout.rotation.z = -0.9; teapot.add(spout);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.016, 8, 20, Math.PI), glazeMat);
  handle.position.set(-0.19, 0.15, 0); handle.rotation.z = Math.PI / 2; teapot.add(handle);
  const potLid = lathe([[0, 0], [0.09, 0], [0.05, 0.03], [0.02, 0.05], [0, 0.05]], 16, glazeMat);
  potLid.position.y = 0.27; teapot.add(potLid);
  teapot.position.set(1.0, 1.49, wallZ + 0.2);
  shelfItems.add(teapot);
  for (const x of [1.5, 1.75, 2.0]) { const cup = lathe([[0, 0], [0.05, 0], [0.065, 0.09], [0.055, 0.09], [0.04, 0.02], [0, 0.02]], 16, ceramicMat); cup.position.set(x, 1.49, wallZ + 0.2); shelfItems.add(cup); }
  for (const [x, mat] of [[2.7, glazeMat], [3.3, ceramicMat]]) {
    for (let k = 0; k < 3; k++) { const b = lathe(bowlProfile, 28, mat); b.position.set(x, 1.49 + k * 0.045, wallZ + 0.2); shelfItems.add(b); }
  }
  const tin = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 20), new THREE.MeshStandardMaterial({ color: new THREE.Color('#B9302A'), roughness: 0.5, metalness: 0.2 }));
  tin.position.set(3.9, 1.62, wallZ + 0.2); shelfItems.add(tin);
  shelfItems.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(shelfItems);

  // ---- Chopstick cup on the counter.
  const cup = new THREE.Group();
  const cupBody = lathe([[0, 0], [0.14, 0], [0.16, 0.04], [0.15, 0.3], [0.16, 0.33], [0.12, 0.33], [0.12, 0.05], [0, 0.05]], 24, glazeMat);
  cup.add(cupBody);
  const stickGeo = new THREE.CylinderGeometry(0.014, 0.01, 0.9, 6);
  const stickMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(COLORS.chopstick), roughness: 0.7 });
  const rnd = mulberry(17);
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Mesh(stickGeo, stickMat);
    const a = rnd() * Math.PI * 2, r = rnd() * 0.08;
    s.position.set(Math.cos(a) * r, 0.5, Math.sin(a) * r);
    s.rotation.set((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25);
    s.castShadow = true;
    cup.add(s);
  }
  cup.position.set(4.25, 0, 0.9);
  group.add(cup);

  // ---- Menu board (A-frame) on the counter's back-right corner.
  // An A-frame: both panels hinge at the top and spread at the bottom.
  const board = new THREE.Group();
  const tilt = 0.17;
  const panelW = 1.05, panelH = 1.4;
  const hingeY = panelH * Math.cos(tilt) + 0.06;
  const hinge = new THREE.Group();
  hinge.position.y = hingeY;
  const face = new THREE.Group();                   // front panel: bottom swings toward +z
  face.rotation.x = -tilt;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(panelW + 0.12, panelH + 0.12, 0.05), darkWoodMat);
  frame.position.y = -panelH / 2; frame.castShadow = true;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), new THREE.MeshStandardMaterial({ color: '#fff4de', roughness: 0.9 }));
  paper.position.set(0, -panelH / 2, 0.028);
  face.add(frame, paper);
  const backLeg = new THREE.Mesh(new THREE.BoxGeometry(panelW + 0.12, panelH + 0.12, 0.04), darkWoodMat);
  backLeg.position.y = -panelH / 2;
  const back = new THREE.Group();                   // back leg: bottom swings toward -z
  back.rotation.x = tilt;
  back.add(backLeg);
  const hingeBar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, panelW + 0.16, 12), darkWoodMat);
  hingeBar.rotation.z = Math.PI / 2;
  hinge.add(face, back, hingeBar);
  board.add(hinge);
  const boardYaw = -0.34;
  board.rotation.y = boardYaw;
  board.position.set(1.85, 0, -1.65);
  group.add(board);
  board.updateMatrixWorld(true);
  const menuCentre = paper.getWorldPosition(new THREE.Vector3());
  const menuNormal = paper.getWorldDirection(new THREE.Vector3()).normalize();

  function update(dt, time) {
    if (motion.reduced) return;
    for (const a of animated) {
      a.obj.rotation.z = Math.sin(time * a.rate + a.phase) * a.amp;
      a.obj.rotation.x = Math.cos(time * a.rate * 0.8 + a.phase) * a.amp * 0.6;
    }
  }

  return { group, update, steamOrigin, menuBoard: { group: board, paper, centre: menuCentre, normal: menuNormal, width: panelW, height: panelH } };
}
