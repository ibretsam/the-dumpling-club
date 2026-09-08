// js/dumpling-geometry.js — procedural dumplings and dim sum for The Dumpling Club.
//
// Every type is a parametric surface evaluated on a (u, v) grid with numerically derived
// normals, so shading is smooth and seam-free. Three shape families cover the menu:
//
//   lathe     gathered-top dumplings: a meridian profile revolved around +y with pleats that
//             deepen toward the top and swirl into a twisted knot (xiaolongbao, char siu bao).
//   crescent  half-moon dumplings: a round wrapper folded over the filling. The cross-section
//             (belly at +z, thin sealed crest on top) is swept along a gently bent centreline
//             that tapers to the two tips; the pleats scallop the crest and fold toward the
//             concave back, the way only the front layer of a jiaozi wrapper is pleated
//             (jiaozi, potstickers, har gow).
//   opentop   siu mai: a gathered yellow wrapper that stays open, flaring into a ruffled collar
//             around an exposed dome of filling (coloured through vertex colours).
//
// Conventions shared by all types: origin at the base centre, the base sits on y = 0, +y up,
// the face points toward +z. UVs: u runs left→right across the front (u = 0.5 at the face
// centre), v runs bottom→top so the type's `faceUV` rect lands on the smooth front where the
// face painter draws. The bitten variants carve a soft spherical crater (coloured with
// COLORS.filling) and share the UV layout of their body.
//
// Runs in the browser and under Node (no DOM); tools/build-dumpling-glb.mjs resolves 'three'.

import * as THREE from 'three';
import { COLORS } from './config.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, c, w) => { const t = (x - c) / w; return Math.exp(-t * t); };

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** Piecewise-linear monotone warp through [x, y] points, with an inverse. */
function makeWarp(points) {
  const f = (x) => {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      if (x <= x1) return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
    return points[points.length - 1][1];
  };
  f.inverse = (y) => {
    if (y <= points[0][1]) return points[0][0];
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      if (y <= y1) return x0 + (x1 - x0) * ((y - y0) / (y1 - y0));
    }
    return points[points.length - 1][0];
  };
  return f;
}

/**
 * A 2D Catmull-Rom curve sampled by normalised arc length. Returns pointAt(t, out) writing
 * {x, y} and tangentAt(t, out). `closed` curves wrap t.
 */
function makeCurve(points, closed) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], 0)), closed, 'centripetal', 0.5);
  curve.arcLengthDivisions = 800;
  curve.getLengths(800);
  const tmp = new THREE.Vector3();
  const wrap = (t) => (closed ? ((t % 1) + 1) % 1 : clamp(t, 0, 1));
  return {
    pointAt(t, out) { curve.getPointAt(wrap(t), tmp); out.x = tmp.x; out.y = tmp.y; return out; },
    tangentAt(t, out) { curve.getTangentAt(wrap(t), tmp); out.x = tmp.x; out.y = tmp.y; return out; },
    /** First t (searching upward) whose y reaches `y` between t0 and t1. */
    tOfY(y, t0, t1, steps = 400) {
      let best = t0, bestErr = Infinity;
      for (let i = 0; i <= steps; i++) {
        const t = t0 + (t1 - t0) * (i / steps);
        const p = this.pointAt(t, { x: 0, y: 0 });
        const err = Math.abs(p.y - y);
        if (err < bestErr) { bestErr = err; best = t; }
      }
      return best;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Generic grid builder
// ---------------------------------------------------------------------------------------------

const _pA = new THREE.Vector3(), _pB = new THREE.Vector3(), _pC = new THREE.Vector3(), _pD = new THREE.Vector3();
const _du = new THREE.Vector3(), _dv = new THREE.Vector3();

/**
 * surface: { evalPoint(u, v, out), uvOf(u, v) -> [uu, vv], colorOf?(u, v, col), wrapU, wrapV,
 *            poleU0, poleU1, poleV0, poleV1 }
 * Poles are grid edges that collapse to a single point (their normal is taken a hair inside).
 */
function buildGrid(surface, segU, segV, name) {
  const cols = segU + 1, rows = segV + 1, count = cols * rows;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = surface.colorOf ? new Float32Array(count * 3) : null;
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const col = [1, 1, 1];
  const e = 1e-3;

  for (let j = 0; j < rows; j++) {
    const v = j / segV;
    for (let i = 0; i < cols; i++) {
      const u = i / segU;
      const k = j * cols + i;
      surface.evalPoint(u, v, p);
      positions[k * 3] = p.x; positions[k * 3 + 1] = p.y; positions[k * 3 + 2] = p.z;

      // Normal from central differences, nudged off degenerate edges.
      let un = u, vn = v;
      if (surface.poleU0 && i === 0) un = 2 * e;
      if (surface.poleU1 && i === segU) un = 1 - 2 * e;
      if (surface.poleV0 && j === 0) vn = 2 * e;
      if (surface.poleV1 && j === segV) vn = 1 - 2 * e;
      const u0 = surface.wrapU ? un - e : Math.max(0, un - e), u1 = surface.wrapU ? un + e : Math.min(1, un + e);
      const v0 = surface.wrapV ? vn - e : Math.max(0, vn - e), v1 = surface.wrapV ? vn + e : Math.min(1, vn + e);
      surface.evalPoint(u1, vn, _pA); surface.evalPoint(u0, vn, _pB);
      surface.evalPoint(un, v1, _pC); surface.evalPoint(un, v0, _pD);
      _du.subVectors(_pA, _pB); _dv.subVectors(_pC, _pD);
      n.crossVectors(_du, _dv);
      if (n.lengthSq() < 1e-16) n.set(0, 1, 0); else n.normalize();
      normals[k * 3] = n.x; normals[k * 3 + 1] = n.y; normals[k * 3 + 2] = n.z;

      const uv = surface.uvOf(u, v);
      uvs[k * 2] = uv[0]; uvs[k * 2 + 1] = uv[1];
      if (colors) { col[0] = col[1] = col[2] = 1; surface.colorOf(u, v, col); colors[k * 3] = col[0]; colors[k * 3 + 1] = col[1]; colors[k * 3 + 2] = col[2]; }
    }
  }

  // Make normals point away from the centroid (numerical cross product sign depends on param handedness).
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < count; k++) { cx += positions[k * 3]; cy += positions[k * 3 + 1]; cz += positions[k * 3 + 2]; }
  cx /= count; cy /= count; cz /= count;
  let dot = 0;
  for (let k = 0; k < count; k++) dot += normals[k * 3] * (positions[k * 3] - cx) + normals[k * 3 + 1] * (positions[k * 3 + 1] - cy) + normals[k * 3 + 2] * (positions[k * 3 + 2] - cz);
  if (dot < 0) for (let k = 0; k < count * 3; k++) normals[k] = -normals[k];

  // Indices (skip the degenerate triangle at pole edges).
  const index = [];
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      const topPole = (surface.poleV0 && j === 0), botPole = (surface.poleV1 && j === segV - 1);
      const leftPole = (surface.poleU0 && i === 0), rightPole = (surface.poleU1 && i === segU - 1);
      // A pole row/column collapses one triangle of the quad; emit only the non-degenerate one.
      if (!(topPole || leftPole)) index.push(a, c, b);
      if (!(botPole || rightPole)) index.push(b, c, d);
    }
  }
  // Winding must agree with the normals: flip if most faces disagree.
  let agree = 0;
  const fa = new THREE.Vector3(), fb = new THREE.Vector3(), fc = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let t = 0; t < index.length; t += 3) {
    const ia = index[t], ib = index[t + 1], ic = index[t + 2];
    fa.fromArray(positions, ia * 3); fb.fromArray(positions, ib * 3); fc.fromArray(positions, ic * 3);
    fn.subVectors(fb, fa).cross(_du.subVectors(fc, fa));
    agree += fn.x * normals[ia * 3] + fn.y * normals[ia * 3 + 1] + fn.z * normals[ia * 3 + 2];
  }
  if (agree < 0) for (let t = 0; t < index.length; t += 3) { const tmp = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = tmp; }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = name;
  return geometry;
}

// ---------------------------------------------------------------------------------------------
// Soft spherical bite shared by all families
// ---------------------------------------------------------------------------------------------

function makeBite({ centre, radius, teeth = 7 }) {
  const c = new THREE.Vector3().fromArray(centre);
  const rel = new THREE.Vector3();
  // Axis for the tooth scallops: perpendicular-ish to the crater opening.
  const axis = new THREE.Vector3(0, 1, 0);
  const t1 = new THREE.Vector3(1, 0, 0), t2 = new THREE.Vector3(0, 0, 1);
  return {
    centre: c,
    radius,
    intrusion(p) { return radius - rel.subVectors(p, c).length(); },
    apply(p) {
      rel.subVectors(p, c);
      const d = rel.length();
      if (d < 1e-6) { p.copy(c).addScaledVector(axis, radius); return p; }
      const ang = Math.atan2(rel.dot(t2), rel.dot(t1));
      const r = radius + 0.005 * Math.sin(ang * teeth) + 0.003 * Math.sin(ang * teeth * 2.3 + 1.1);
      const intrusion = r - d;
      if (intrusion <= 0) return p;
      const k = smoothstep(0, 0.035, intrusion);            // soft, rounded rim
      // A slightly lumpy crater floor (the filling).
      const lump = 1 - 0.06 * k * (0.5 + 0.5 * Math.sin(ang * 5 + rel.y * 40));
      const target = r * lump;
      p.copy(c).addScaledVector(rel, (d + (target - d) * k) / d);
      if (p.y < 0.002) p.y = 0.002;
      return p;
    },
  };
}

function fillingRatio() {
  // Vertex colours multiply the dough map, so store filling / dough to reproduce COLORS.filling.
  const fill = new THREE.Color(COLORS.filling), dough = new THREE.Color(COLORS.dough);
  return [Math.min(1, fill.r / dough.r), Math.min(1, fill.g / dough.g), Math.min(1, fill.b / dough.b)];
}

// ---------------------------------------------------------------------------------------------
// Family 1: gathered-top lathe (xiaolongbao, char siu bao)
// ---------------------------------------------------------------------------------------------

function makeLathe(P) {
  const { radius, height } = P;
  const curve = makeCurve(P.profile.map(([r, y]) => [r * radius, y * height]), false);
  const pt = { x: 0, y: 0 }, tg = { x: 0, y: 0 };
  const neckT = curve.tOfY(P.bodyHeight, 0.3, 1);
  const pleatStart = curve.tOfY(P.pleatStartY, 0.05, neckT);

  function displacement(theta, t) {
    const fade = smoothstep(pleatStart, pleatStart + 0.22, t) * (1 - smoothstep(0.965, 1, t));
    const above = smoothstep(neckT - 0.05, 1, t);
    const twist = P.twist * Math.pow(above, 1.4);
    const phase = P.pleats * theta + twist;
    const ridge = Math.pow(0.5 + 0.5 * Math.cos(phase), P.sharpness) - 0.5;
    const grow = 0.55 + 0.45 * smoothstep(pleatStart, neckT, t);       // deeper toward the gather
    let d = P.pleatDepth * fade * grow * ridge;
    // Thin-skinned types show the filling as a soft lumpiness.
    if (P.lumpiness) d += P.lumpiness * Math.sin(theta * 3 + t * 9) * Math.sin(theta * 5 - t * 4) * smoothstep(0.1, 0.3, t) * (1 - smoothstep(0.7, 0.95, t));
    return d;
  }

  function evalPoint(u, v, out) {
    const a = (u - 0.5) * TAU;
    const theta = a - 0.45 * Math.sin(a);           // denser texels/vertices toward the face
    curve.pointAt(v, pt); curve.tangentAt(v, tg);
    // Outward meridian normal (rotate the tangent -90°).
    let nr = tg.y, ny = -tg.x;
    const len = Math.hypot(nr, ny) || 1; nr /= len; ny /= len;
    const d = displacement(theta, v);
    const r = Math.max(0, pt.x + d * nr);
    const y = pt.y + d * ny;
    return out.set(r * Math.sin(theta), y, r * Math.cos(theta));
  }

  const vLow = curve.tOfY(P.faceY[0], 0.02, neckT), vHigh = curve.tOfY(P.faceY[1], 0.02, neckT);
  const warpV = makeWarp([[0, 0], [vLow, P.faceUV.v0], [vHigh, P.faceUV.v1], [1, 1]]);
  const surface = {
    evalPoint,
    uvOf: (u, v) => [u, warpV(v)],
    wrapU: true, poleV0: true, poleV1: true,
  };
  return {
    surface,
    uvToPoint: (u, v, out) => evalPoint(u, warpV.inverse(v), out),
  };
}

// ---------------------------------------------------------------------------------------------
// Family 2: pleated crescent (jiaozi, potsticker, har gow)
// ---------------------------------------------------------------------------------------------

function makeCrescent(P) {
  const { length: L, height: H, depth: D } = P;
  // Cross-section at the middle, (z, y): bottom centre → belly (+z) → crest → back → bottom.
  const bd = P.backDepth;           // how far the concave back reaches (-z)
  const cw = P.crestWidth;          // half thickness of the sealed edge
  const sh = P.shoulderY;           // where the body meets the crest
  const section = makeCurve([
    [0, 0], [D * 0.30, 0.004], [D * 0.47, H * 0.16], [D * 0.5, H * 0.40], [D * 0.44, H * 0.63],
    [D * 0.30, H * 0.80], [D * 0.14, H * sh], [cw * 1.6, H * (sh + 0.05)], [cw, H * 0.965], [0, H],
    [-cw, H * 0.965], [-cw * 1.6, H * (sh + 0.05)], [-bd * 0.35, H * sh], [-bd * 0.7, H * 0.72],
    [-bd, H * 0.42], [-bd * 0.86, H * 0.13], [-bd * 0.5, 0.004],
  ], true);
  const pt = { x: 0, y: 0 };
  const w = (s) => Math.sqrt(Math.max(0, 1 - (2 * s - 1) * (2 * s - 1)));

  function evalPoint(u, v, out) {
    const s = u, phi = v;
    const ws = w(s);
    const depthScale = Math.pow(ws, P.tipTaper);
    const heightScale = Math.pow(ws, P.tipHeightPower);
    const xc = (s - 0.5) * L;
    const q = (2 * s - 1) * (2 * s - 1);
    const zc = -P.bend * q;
    const yc = P.tipLift * q;
    // Section frame follows the bent centreline.
    const dz = -4 * P.bend * (2 * s - 1);
    const tl = Math.hypot(L, dz) || 1;
    const tx = L / tl, tz = dz / tl;              // tangent
    const fx = -tz, fz = tx;                       // front axis (+z at the middle)
    section.pointAt(phi, pt);
    let zl = pt.x * depthScale, yl = pt.y * heightScale;

    // Pleats: scalloped crest folding toward the concave back, fading toward the tips.
    const taper = smoothstep(0.1, 0.36, ws);
    const psi = TAU * P.pleats * (s - 0.5) + P.pleatPhase;
    const crest = gauss(phi, 0.5, 0.07);
    const backShoulder = gauss(phi, 0.575, 0.075);
    const frontLip = gauss(phi, 0.44, 0.045);
    const fold = Math.pow(0.5 + 0.5 * Math.cos(psi), P.pleatSharpness);
    yl += P.pleatAmp * 1.1 * crest * (fold - 0.5) * taper;
    zl -= P.pleatAmp * P.pleatLean * backShoulder * fold * taper;
    zl += P.pleatAmp * 0.35 * frontLip * (fold - 0.5) * taper;
    // Har gow has fine radial folds on a tall shell, rather than only a scalloped seam.
    if (P.fanDepth) {
      const fan = gauss(phi, 0.395, 0.065) * taper;
      zl += P.fanDepth * Math.cos(psi + (phi-.4)*12) * fan;
      yl += P.fanDepth * .28 * Math.sin(psi) * fan;
    }
    // A soft belly lumpiness from the filling.
    if (P.lumpiness) zl += P.lumpiness * Math.sin(s * 9.5 + phi * 6) * gauss(phi, 0.25, 0.16) * taper;

    if (ws < 1e-6) { zl = 0; yl = 0; }
    return out.set(xc + zl * fx, yc + yl, zc + zl * fz);
  }

  const warpV = makeWarp([[0, 0], [P.facePhi[0], P.faceUV.v0], [P.facePhi[1], P.faceUV.v1], [0.5, 0.74], [1, 1]]);
  const surface = {
    evalPoint,
    uvOf: (u, v) => [u, warpV(v)],
    wrapV: true, poleU0: true, poleU1: true,
  };
  return { surface, uvToPoint: (u, v, out) => evalPoint(u, warpV.inverse(v), out) };
}

// ---------------------------------------------------------------------------------------------
// Family 3: open-top siu mai
// ---------------------------------------------------------------------------------------------

function makeOpenTop(P) {
  const curve = makeCurve(P.profile, false);
  const pt = { x: 0, y: 0 }, tg = { x: 0, y: 0 };
  const collar = P.collarT, fillT = P.fillingT;
  const ratio = fillingRatio();

  function evalPoint(u, v, out) {
    const a = (u - 0.5) * TAU;
    const theta = a - 0.4 * Math.sin(a);
    curve.pointAt(v, pt); curve.tangentAt(v, tg);
    let nr = tg.y, ny = -tg.x;
    const len = Math.hypot(nr, ny) || 1; nr /= len; ny /= len;
    // Gathered wrapper: vertical creases on the wall, a wavy ruffle at the collar.
    const wall = smoothstep(0.08, 0.3, v) * (1 - smoothstep(collar[0] - 0.05, collar[0], v));
    const creases = 0.007 * (Math.pow(0.5 + 0.5 * Math.cos(theta * P.creases + 0.3), 2.2) - 0.4) * wall;
    const inCollar = smoothstep(collar[0] - 0.03, collar[0], v) * (1 - smoothstep(collar[1], collar[1] + 0.03, v));
    const ruffle = Math.sin(theta * P.ruffles + 0.4) * 0.6 + Math.sin(theta * P.ruffles * 2 - 0.7) * 0.4;
    const d = creases + inCollar * P.ruffleAmp * ruffle;
    let r = Math.max(0, pt.x + d * nr);
    let y = pt.y + d * ny + inCollar * 0.012 * Math.cos(theta * P.ruffles + 0.4);
    // Lumpy filling dome.
    const inFill = smoothstep(fillT, fillT + 0.04, v);
    if (inFill > 0) {
      const bump = 0.008 * (Math.sin(theta * 4 + v * 40) * Math.sin(theta * 7 - v * 25) + 0.4 * Math.sin(theta * 11 + 2));
      r = Math.max(0, r + bump * nr * inFill);
      y += bump * ny * inFill;
    }
    return out.set(r * Math.sin(theta), y, r * Math.cos(theta));
  }

  const vLow = curve.tOfY(P.faceY[0], 0.02, collar[0]), vHigh = curve.tOfY(P.faceY[1], 0.02, collar[0]);
  const warpV = makeWarp([[0, 0], [vLow, P.faceUV.v0], [vHigh, P.faceUV.v1], [collar[0], 0.8], [1, 1]]);
  const surface = {
    evalPoint,
    uvOf: (u, v) => [u, warpV(v)],
    colorOf: (u, v, col) => { const f = smoothstep(fillT - 0.015, fillT + 0.02, v); col[0] = lerp(1, ratio[0], f); col[1] = lerp(1, ratio[1], f); col[2] = lerp(1, ratio[2], f); },
    wrapU: true, poleV0: true, poleV1: true,
  };
  return { surface, uvToPoint: (u, v, out) => evalPoint(u, warpV.inverse(v), out) };
}

// ---------------------------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------------------------

const FACE_UV_ROUND = { u0: 0.28, u1: 0.72, v0: 0.22, v1: 0.62 };
const FACE_UV_CRESCENT = { u0: 0.12, u1: 0.88, v0: 0.26, v1: 0.56 };

export const DUMPLING_TYPES = [
  {
    id: 'xiaolongbao', name: 'Xiaolongbao', cn: '小笼包', tag: 'Steamed · Shanghai',
    description: 'A soup dumpling: thin skin, eighteen pleats gathered into a twist, and a spoonful of hot broth inside.',
    family: 'lathe',
    params: {
      radius: 0.27, height: 0.40, bodyHeight: 0.32, pleatStartY: 0.11, pleats: 18, pleatDepth: 0.035, sharpness: 2.4, twist: 3.4, lumpiness: 0.004,
      profile: [[0, 0], [0.55, 0], [0.9, 0.05], [1.0, 0.28], [0.95, 0.52], [0.74, 0.72], [0.46, 0.82], [0.36, 0.87], [0.26, 0.94], [0.13, 0.985], [0, 1]],
      faceY: [0.045, 0.27], faceUV: FACE_UV_ROUND,
    },
    metrics: { radius: 0.28, height: 0.40, bodyHeight: 0.32, gripHeight: 0.18, length: 0.54, depth: 0.54, pinchWidth: 0.5 },
    faceUV: FACE_UV_ROUND,
    skin: { color: COLORS.dough, roughness: 0.48, clearcoat: 0.2, clearcoatRoughness: 0.5, sheen: 0.4, opacity: 1, base: 'plain' },
    bite: { centre: [0.19, 0.33, 0.22], radius: 0.2, point: [0.094, 0.264, 0.11] },
    holdYaw: 0, extras: null,
  },
  {
    id: 'jiaozi', name: 'Jiaozi', cn: '饺子', tag: 'Steamed · crescent',
    description: 'The classic half-moon: a round wrapper folded over pork and chive, pleated along the crest.',
    family: 'crescent',
    params: {
      length: 0.65, height: 0.36, depth: 0.32, backDepth: 0.13, crestWidth: 0.017, shoulderY: 0.78, bend: 0.16, tipLift: 0.06,
      tipTaper: 1.05, tipHeightPower: 0.5, pleats: 7, pleatAmp: 0.032, pleatLean: 1.7, pleatSharpness: 2.0, pleatPhase: 0, lumpiness: 0.005,
      facePhi: [0.165, 0.375], faceUV: FACE_UV_CRESCENT,
    },
    metrics: { radius: 0.36, height: 0.36, bodyHeight: 0.30, gripHeight: 0.16, length: 0.65, depth: 0.42, pinchWidth: 0.44 },
    faceUV: FACE_UV_CRESCENT,
    skin: { color: COLORS.dough, roughness: 0.5, clearcoat: 0.18, clearcoatRoughness: 0.5, sheen: 0.4, opacity: 1, base: 'plain' },
    bite: { centre: [0.44, 0.16, 0.03], radius: 0.23, point: [0.24, 0.16, 0.016] },
    holdYaw: 0.62, extras: null,
  },
  {
    id: 'potsticker', name: 'Potsticker', cn: '锅贴', tag: 'Pan-fried · guotie',
    description: 'A jiaozi fried on one side until the base turns golden and crisp, then steamed to finish.',
    family: 'crescent',
    params: {
      length: 0.70, height: 0.28, depth: 0.32, backDepth: 0.14, crestWidth: 0.012, shoulderY: 0.78, bend: 0.045, tipLift: 0.055,
      tipTaper: 1.05, tipHeightPower: 0.5, pleats: 5, pleatAmp: 0.024, pleatLean: 1.6, pleatSharpness: 2.0, pleatPhase: 0.4, lumpiness: 0.005,
      facePhi: [0.165, 0.375], faceUV: FACE_UV_CRESCENT,
    },
    metrics: { radius: 0.37, height: 0.28, bodyHeight: 0.24, gripHeight: 0.13, length: 0.70, depth: 0.34, pinchWidth: 0.43 },
    faceUV: FACE_UV_CRESCENT,
    skin: { color: '#EFCB91', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.3, opacity: 1, base: 'browned' },
    bite: { centre: [0.45, 0.155, 0.03], radius: 0.23, point: [0.25, 0.155, 0.016] },
    holdYaw: 0.62, extras: null,
  },
  {
    id: 'hargow', name: 'Har gow', cn: '虾饺', tag: 'Steamed · Cantonese',
    description: 'Crystal shrimp dumpling: a translucent bonnet of tapioca skin with at least seven fine pleats, pink shrimp glowing through.',
    family: 'crescent',
    params: {
      length: 0.45, height: 0.39, depth: 0.43, backDepth: 0.20, crestWidth: 0.010, shoulderY: 0.81, bend: 0.04, tipLift: 0.026,
      tipTaper: 0.7, tipHeightPower: 0.65, pleats: 9, pleatAmp: 0.018, fanDepth: 0.017, pleatLean: 1.8, pleatSharpness: 1.6, pleatPhase: 0.2, lumpiness: 0.003,
      facePhi: [0.165, 0.375], faceUV: FACE_UV_CRESCENT,
    },
    metrics: { radius: 0.28, height: 0.39, bodyHeight: 0.33, gripHeight: 0.17, length: 0.45, depth: 0.43, pinchWidth: 0.4 },
    faceUV: FACE_UV_CRESCENT,
    skin: { color: '#FAE6DF', roughness: 0.16, clearcoat: 0.7, clearcoatRoughness: 0.2, sheen: 0.2, opacity: 0.94, base: 'crystal' },
    bite: { centre: [0.39, 0.155, 0.03], radius: 0.21, point: [0.21, 0.155, 0.016] },
    holdYaw: 0.62, extras: 'inner-filling',
  },
  {
    id: 'siumai', name: 'Siu mai', cn: '烧卖', tag: 'Steamed · open top',
    description: 'A thin yellow wrapper gathered around pork and shrimp, left open at the top with a dot of orange roe.',
    family: 'opentop',
    params: {
      profile: [[0, 0], [0.10, 0], [0.17, 0.01], [0.195, 0.10], [0.20, 0.20], [0.205, 0.27], [0.235, 0.30], [0.25, 0.325], [0.23, 0.338], [0.205, 0.328], [0.19, 0.305], [0.175, 0.29], [0.12, 0.318], [0.06, 0.338], [0, 0.345]],
      collarT: [0.60, 0.74], fillingT: 0.80, creases: 14, ruffles: 9, ruffleAmp: 0.014,
      faceY: [0.04, 0.235], faceUV: { u0: 0.28, u1: 0.72, v0: 0.18, v1: 0.56 },
    },
    metrics: { radius: 0.26, height: 0.345, bodyHeight: 0.30, gripHeight: 0.15, length: 0.5, depth: 0.5, pinchWidth: 0.42 },
    faceUV: { u0: 0.28, u1: 0.72, v0: 0.18, v1: 0.56 },
    skin: { color: '#EAC55F', roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5, sheen: 0.3, opacity: 1, base: 'yellow' },
    bite: { centre: [0.21, 0.37, 0.21], radius: 0.2, point: [0.108, 0.273, 0.108] },
    holdYaw: 0, extras: 'roe',
  },
  {
    id: 'bao', name: 'Char siu bao', cn: '叉烧包', tag: 'Steamed bun · fluffy',
    description: 'A big pillowy steamed bun, pleated into a soft swirl on top and stuffed with sweet barbecued pork.',
    family: 'lathe',
    params: {
      radius: 0.33, height: 0.52, bodyHeight: 0.45, pleatStartY: 0.28, pleats: 3, pleatDepth: 0.105, sharpness: 1.3, twist: 0.8, lumpiness: 0,
      profile: [[0, 0], [0.6, 0], [0.93, 0.08], [1.0, 0.38], [0.9, 0.68], [0.68, 0.84], [0.46, 0.96], [0.20, 0.91], [0, 0.94]],
      faceY: [0.06, 0.36], faceUV: FACE_UV_ROUND,
    },
    metrics: { radius: 0.33, height: 0.52, bodyHeight: 0.45, gripHeight: 0.24, length: 0.66, depth: 0.66, pinchWidth: 0.6 },
    faceUV: FACE_UV_ROUND,
    skin: { color: '#FBF6EC', roughness: 0.7, clearcoat: 0.04, clearcoatRoughness: 0.8, sheen: 0.55, opacity: 1, base: 'fluffy' },
    bite: { centre: [0.24, 0.42, 0.28], radius: 0.23, point: [0.135, 0.34, 0.157] },
    holdYaw: 0, extras: null,
  },
];

export const TYPE_IDS = DUMPLING_TYPES.map((t) => t.id);
export function getType(id) { return DUMPLING_TYPES.find((t) => t.id === id) || DUMPLING_TYPES[0]; }

const builders = new Map();
function builderFor(type) {
  let b = builders.get(type.id);
  if (!b) {
    if (type.family === 'lathe') b = makeLathe(type.params);
    else if (type.family === 'crescent') b = makeCrescent(type.params);
    else b = makeOpenTop(type.params);
    builders.set(type.id, b);
  }
  return b;
}

const SEGMENTS = { lathe: [128, 80], crescent: [120, 96], opentop: [128, 96] };

/** Body or bitten geometry for a type id. */
export function buildTypeGeometry(id, { bitten = false, segU, segV } = {}) {
  const type = getType(id);
  const b = builderFor(type);
  const [du, dv] = SEGMENTS[type.family];
  const su = segU || du, sv = segV || dv;
  if (!bitten) return buildGrid(b.surface, su, sv, type.id + '-body');

  const bite = makeBite(type.bite);
  const filling = new THREE.Color(COLORS.filling);
  const ratio = fillingRatio();
  const tmp = new THREE.Vector3();
  const base = b.surface;
  const surface = {
    ...base,
    evalPoint: (u, v, out) => bite.apply(base.evalPoint(u, v, out)),
    colorOf: (u, v, col) => {
      if (base.colorOf) base.colorOf(u, v, col);
      const f = smoothstep(0.006, 0.03, bite.intrusion(base.evalPoint(u, v, tmp)));
      col[0] = lerp(col[0], ratio[0], f); col[1] = lerp(col[1], ratio[1], f); col[2] = lerp(col[2], ratio[2], f);
    },
  };
  const g = buildGrid(surface, su, sv, type.id + '-bitten');
  g.userData.bite = { centre: type.bite.centre, radius: type.bite.radius, filling: filling.getHexString() };
  return g;
}

export function buildAllGeometries() {
  const out = {};
  for (const t of DUMPLING_TYPES) out[t.id] = { body: buildTypeGeometry(t.id), bitten: buildTypeGeometry(t.id, { bitten: true }) };
  return out;
}

/** Object-space point for a texture coordinate on the unbitten body of a type. */
export function uvToSurfacePoint(id, u, v, target = new THREE.Vector3()) {
  if (typeof id !== 'string') { target = v || new THREE.Vector3(); v = u; u = id; id = 'xiaolongbao'; }
  return builderFor(getType(id)).uvToPoint(clamp(u, 0, 1), clamp(v, 0, 1), target);
}

/** Measured face-rect mapping: how much surface one unit of u covers versus one unit of v. */
export function measureUvInfo(id) {
  const type = getType(id);
  const { u0, u1, v0, v1 } = type.faceUV;
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const du = uvToSurfacePoint(id, uc + 0.01, vc, a).distanceTo(uvToSurfacePoint(id, uc - 0.01, vc, b)) / 0.02;
  const dv = uvToSurfacePoint(id, uc, vc + 0.01, a).distanceTo(uvToSurfacePoint(id, uc, vc - 0.01, b)) / 0.02;
  const centre = uvToSurfacePoint(id, uc, vc, new THREE.Vector3());
  return { arcPerU: du, arcPerV: dv, circleAspect: du / dv, faceCentre: centre.toArray(), faceHeightWorld: dv * (v1 - v0) };
}

// Legacy single-type API (the first menu item).
export const DUMPLING_METRICS = Object.freeze({ ...DUMPLING_TYPES[0].metrics });
export function buildDumplingGeometry(opts = {}) { return buildTypeGeometry('xiaolongbao', opts); }
export function buildBittenGeometry(opts = {}) { return buildTypeGeometry('xiaolongbao', { ...opts, bitten: true }); }
export const DUMPLING_UV_INFO = measureUvInfo('xiaolongbao');
