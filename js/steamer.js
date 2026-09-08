// js/steamer.js — The Dumpling Club
//
// Prop builders: the bamboo steamer (hero prop: laminated walls, bamboo edge strips, woven bands
// with stitch loops, slat floor and a parchment liner with steam holes), the porcelain plate, the
// soy bowl (with the rippling SauceSurface from sauce.js), the chopsticks (pivoting pair with tip /
// grip helpers), the chopstick rest and the table disc.
//
// Every builder returns { group, ...extras, update(dt, time) }. Each group sits on its own local
// origin with y = 0 on the table; main.js positions the groups using LAYOUT. All meshes cast and
// receive shadows. Textures come from textures.js (procedural canvases, cached).
import * as THREE from 'three';
import { COLORS, STEAMER, PLATE, BOWL, CHOPSTICKS } from './config.js';
import { SauceSurface } from './sauce.js';
import {
  bambooTexture,
  bambooDarkTexture,
  wovenTexture,
  wovenBumpTexture,
  parchmentTexture,
  parchmentAlphaTexture,
  porcelainTexture,
} from './textures.js';

const TWO_PI = Math.PI * 2;
const noop = () => {};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function shadowed(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function linearRGB(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

/**
 * A closed tube band with thickness: outer wall, top annulus, inner wall and bottom annulus, hard
 * edges (separate vertices per face) and world-unit UVs (`density` tiles per unit) that continue
 * around the profile so the wood grain wraps over the edges. Nothing is missing when the camera
 * looks inside: the inner wall has its own inward-facing surface.
 */
function ringWallGeometry({ rOut, rIn, y0, y1, segments = 96, density = 1, uOffset = 0 }) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const height = y1 - y0;
  const thick = rOut - rIn;
  const faces = [
    { ra: rOut, ya: y0, rb: rOut, yb: y1, n: (c, s) => [c, 0, s], va: 0, vb: height },
    { ra: rOut, ya: y1, rb: rIn, yb: y1, n: () => [0, 1, 0], va: height, vb: height + thick },
    { ra: rIn, ya: y1, rb: rIn, yb: y0, n: (c, s) => [-c, 0, -s], va: height + thick, vb: 2 * height + thick },
    { ra: rIn, ya: y0, rb: rOut, yb: y0, n: () => [0, -1, 0], va: 2 * height + thick, vb: 2 * (height + thick) },
  ];
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (const f of faces) {
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * TWO_PI;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const n = f.n(c, s);
      positions.push(f.ra * c, f.ya, f.ra * s);
      normals.push(n[0], n[1], n[2]);
      uvs.push(uOffset + a * f.ra * density, f.va * density);
      positions.push(f.rb * c, f.yb, f.rb * s);
      normals.push(n[0], n[1], n[2]);
      uvs.push(uOffset + a * f.rb * density, f.vb * density);
    }
    // Pick the winding whose geometric normal agrees with the intended one (checked on quad 0).
    pA.fromArray(positions, base * 3);
    pB.fromArray(positions, (base + 1) * 3);
    pC.fromArray(positions, (base + 2) * 3);
    e1.subVectors(pB, pA);
    e2.subVectors(pC, pA);
    const n0 = f.n(1, 0);
    const flip = e1.cross(e2).dot(new THREE.Vector3(n0[0], n0[1], n0[2])) < 0;
    for (let i = 0; i < segments; i++) {
      const a0 = base + i * 2;
      const b0 = a0 + 1;
      const a1 = a0 + 2;
      const b1 = a0 + 3;
      if (flip) indices.push(a0, a1, b0, a1, b1, b0);
      else indices.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Scale BoxGeometry UVs so `density` tiles per world unit apply on every face (1×1×1 segments). */
function boxWorldUVs(geometry, w, h, d, density, uOffset = 0) {
  const uv = geometry.attributes.uv;
  // Face order in BoxGeometry: px, nx, py, ny, pz, nz — four vertices each.
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    const [du, dv] = dims[face];
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, uOffset + uv.getX(i) * du * density, uv.getY(i) * dv * density);
    }
  }
  uv.needsUpdate = true;
}

/** Linear interpolation of y over a sorted [[x, y], ...] table. */
function interpTable(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return table[table.length - 1][1];
}

// ---------------------------------------------------------------------------------------------
// Bamboo steamer
// ---------------------------------------------------------------------------------------------

export function buildBambooSteamer() {
  const group = new THREE.Group();
  group.name = 'BambooSteamer';

  const R = STEAMER.outerRadius;
  const H = STEAMER.wallHeight;
  const floorY = STEAMER.floorY;
  const rInner = 0.90;              // innermost wall surface; the liner (0.88) fits inside with a margin
  const woodDensity = 1 / 0.85;     // one bamboo tile per 0.85 world units
  const weaveDensity = 1 / 0.30;    // one woven tile (8 strips) per 0.30 units → strips ~3.7 mm wide

  const woodOuter = new THREE.MeshStandardMaterial({
    map: bambooTexture({ seed: 1, nodes: 2 }),
    roughness: 0.7,
    metalness: 0,
  });
  const woodInner = new THREE.MeshStandardMaterial({
    map: bambooTexture({ seed: 2, nodes: 1 }),
    color: new THREE.Color('#F0E2CC'),
    roughness: 0.74,
    metalness: 0,
  });
  const stripWood = new THREE.MeshStandardMaterial({
    map: bambooDarkTexture({ seed: 3, nodes: 0 }),
    roughness: 0.62,
    metalness: 0,
  });
  const slatWood = new THREE.MeshStandardMaterial({
    map: bambooTexture({ seed: 4, nodes: 1, grainAxis: 'x' }),
    color: new THREE.Color('#F4EADA'),
    roughness: 0.76,
    metalness: 0,
  });
  const weave = new THREE.MeshStandardMaterial({
    map: wovenTexture({ seed: 3 }),
    bumpMap: wovenBumpTexture({ seed: 3 }),
    bumpScale: 0.006,
    roughness: 0.8,
    metalness: 0,
  });
  const stitch = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4A3423'), roughness: 0.85, metalness: 0 });
  const underFloor = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5A4027'), roughness: 1, metalness: 0 });
  const paper = new THREE.MeshStandardMaterial({
    map: parchmentTexture(),
    alphaMap: parchmentAlphaTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
  });

  // --- Walls: an outer band and a slightly shorter inner band set 0.03 inward (laminated rim).
  const outerBand = shadowed(new THREE.Mesh(
    ringWallGeometry({ rOut: R, rIn: R - 0.03, y0: 0.02, y1: H, density: woodDensity }),
    woodOuter,
  ));
  outerBand.name = 'WallOuter';
  const innerBand = shadowed(new THREE.Mesh(
    ringWallGeometry({ rOut: R - 0.038, rIn: rInner, y0: 0.02, y1: H - 0.025, density: woodDensity, uOffset: 0.41 }),
    woodInner,
  ));
  innerBand.name = 'WallInner';

  // --- Thin bamboo strips around the top and the base.
  const topStrip = shadowed(new THREE.Mesh(
    ringWallGeometry({ rOut: R + 0.013, rIn: R - 0.005, y0: H - 0.048, y1: H + 0.004, density: 1.4, segments: 112 }),
    stripWood,
  ));
  topStrip.name = 'StripTop';
  const baseStrip = shadowed(new THREE.Mesh(
    ringWallGeometry({ rOut: R + 0.013, rIn: R - 0.005, y0: 0, y1: 0.05, density: 1.4, segments: 112, uOffset: 0.5 }),
    stripWood,
  ));
  baseStrip.name = 'StripBase';

  // --- Woven bands just under the top strip and above the base strip (~0.08 tall).
  const wovenTop = shadowed(new THREE.Mesh(
    ringWallGeometry({ rOut: R + 0.009, rIn: R - 0.004, y0: H - 0.125, y1: H - 0.044, density: weaveDensity, segments: 112 }),
    weave,
  ));
  wovenTop.name = 'WovenTop';
  const wovenBase = shadowed(new THREE.Mesh(
    ringWallGeometry({ rOut: R + 0.009, rIn: R - 0.004, y0: 0.046, y1: 0.127, density: weaveDensity, segments: 112, uOffset: 0.17 }),
    weave,
  ));
  wovenBase.name = 'WovenBase';

  group.add(outerBand, innerBand, topStrip, baseStrip, wovenTop, wovenBase);

  // --- Stitch loops (tiny dark tori) over the woven bands and at the strip joins.
  const loopGeo = new THREE.TorusGeometry(0.017, 0.0045, 6, 14);
  const addLoop = (angle, y, radius) => {
    const m = shadowed(new THREE.Mesh(loopGeo, stitch), true, false);
    const px = Math.cos(angle) * radius;
    const pz = Math.sin(angle) * radius;
    m.position.set(px, y, pz);
    // Torus axis (local +z) along the wall tangent so the loop wraps over the band.
    m.lookAt(px - Math.sin(angle), y, pz + Math.cos(angle));
    group.add(m);
  };
  const loopRadius = R + 0.007;
  const yTopBand = H - 0.0845;
  const yBaseBand = 0.0865;
  for (let k = 0; k < 6; k++) {
    const jitter = Math.sin(k * 12.9898) * 0.06;
    addLoop(0.35 + (k / 6) * TWO_PI + jitter, yTopBand + Math.cos(k * 3.1) * 0.006, loopRadius);
    addLoop(0.35 + Math.PI / 6 + (k / 6) * TWO_PI - jitter, yBaseBand + Math.sin(k * 2.3) * 0.006, loopRadius);
  }
  // Where each strip overlaps itself: a short overlapping strip end held by two stitches.
  const joinGeo = new THREE.BoxGeometry(0.075, 0.048, 0.008);
  boxWorldUVs(joinGeo, 0.075, 0.048, 0.008, 1.4, 0.3);
  const addJoin = (angle, y) => {
    const m = shadowed(new THREE.Mesh(joinGeo, stripWood));
    const r = R + 0.014;
    m.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    m.rotation.y = -angle;
    group.add(m);
    addLoop(angle - 0.055, y, R + 0.017);
    addLoop(angle + 0.055, y, R + 0.017);
  };
  addJoin(0.95, H - 0.022);
  addJoin(3.85, 0.025);

  // --- Floor: a dark underside disc, parallel bamboo slats, and the parchment liner on top.
  const under = shadowed(new THREE.Mesh(new THREE.CircleGeometry(rInner + 0.01, 64), underFloor), false, true);
  under.rotation.x = -Math.PI / 2;
  under.position.y = 0.012;
  under.name = 'UnderFloor';
  group.add(under);

  const slatW = 0.09;
  const slatGap = 0.035;
  const slatT = 0.03;
  const slatTop = floorY - 0.012;
  const pitch = slatW + slatGap;
  const slatCount = 14;
  const clipR = rInner + 0.025; // ends buried a little inside the inner wall
  const slats = new THREE.Group();
  slats.name = 'Slats';
  for (let k = 0; k < slatCount; k++) {
    const z = (k - (slatCount - 1) / 2) * pitch;
    const edge = Math.abs(z) + slatW / 2;
    if (edge >= clipR) continue;
    const len = 2 * Math.sqrt(clipR * clipR - edge * edge);
    const geo = new THREE.BoxGeometry(len, slatT, slatW);
    boxWorldUVs(geo, len, slatT, slatW, 1 / 0.7, (k * 0.37) % 1);
    const slat = shadowed(new THREE.Mesh(geo, slatWood));
    slat.position.set(0, slatTop - slatT / 2, z);
    slats.add(slat);
  }
  group.add(slats);

  // Parchment liner with a slightly wavy rim and a ring of steam holes; top exactly at floorY.
  const linerR = STEAMER.innerRadius + 0.02;
  const linerGeo = new THREE.CircleGeometry(linerR, 128);
  {
    const pos = linerGeo.attributes.position;
    for (let i = 1; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const a = Math.atan2(y, x);
      const r = linerR
        + 0.011 * Math.sin(3 * a + 0.4)
        + 0.008 * Math.sin(5 * a + 2.1)
        + 0.005 * Math.sin(11 * a + 1.0)
        + 0.003 * Math.sin(17 * a + 4.2);
      pos.setXY(i, r * Math.cos(a), r * Math.sin(a));
    }
    pos.needsUpdate = true;
    linerGeo.computeBoundingSphere();
  }
  const liner = shadowed(new THREE.Mesh(linerGeo, paper));
  liner.rotation.x = -Math.PI / 2;
  liner.position.y = floorY;
  liner.name = 'ParchmentLiner';
  group.add(liner);

  return {
    group,
    floorY,
    innerRadius: STEAMER.innerRadius,
    liner,
    update: noop,
  };
}

// ---------------------------------------------------------------------------------------------
// Porcelain plate
// ---------------------------------------------------------------------------------------------

export function buildPorcelainPlate() {
  const group = new THREE.Group();
  group.name = 'PorcelainPlate';

  const fy = PLATE.floorY;
  const ri = PLATE.innerRadius;
  const ro = PLATE.outerRadius;
  const thick = 0.028;
  // Top surface: flat centre out to ri, then a gentle rise to a wide rim at ro.
  const top = [
    [0, fy], [0.35, fy], [0.65, fy], [ri, fy],
    [ri + 0.06, fy + 0.006], [ri + 0.12, fy + 0.023], [ri + 0.18, fy + 0.046],
    [ri + 0.23, fy + 0.065], [ri + 0.27, fy + 0.08], [ro, fy + 0.088],
  ];

  // Profile walked with the outside on the right: underside → foot → underside → edge → top.
  const pts = [];
  const P = (x, y) => pts.push(new THREE.Vector2(x, y));
  P(0, thick); P(0.3, thick); P(0.54, thick);
  P(0.56, 0); P(0.63, 0); P(0.65, thick + 0.004);
  for (const [r, y] of top) if (r >= ri) P(r, y - thick);
  // Rounded outer edge from the underside (rim top − thick) up to the rim top.
  P(ro + 0.012, fy + 0.066);
  P(ro + 0.017, fy + 0.076);
  P(ro + 0.014, fy + 0.085);
  P(ro + 0.006, fy + 0.09);
  for (let i = top.length - 1; i >= 0; i--) P(top[i][0], top[i][1] + (i === top.length - 1 ? 0.002 : 0));

  const glaze = new THREE.MeshPhysicalMaterial({
    map: porcelainTexture({ repeat: [4, 1] }),
    color: new THREE.Color('#FFFFFF'),
    roughness: 0.25,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
  });
  const plate = shadowed(new THREE.Mesh(new THREE.LatheGeometry(pts, 96), glaze));
  plate.name = 'Plate';
  group.add(plate);

  // Thin terracotta ring riding just above the rim's top surface (walked inward → normals up).
  const ringPts = [];
  for (const r of [ro - 0.012, ro - 0.03, ro - 0.048, ro - 0.066]) {
    ringPts.push(new THREE.Vector2(r, interpTable(top, r) + 0.0022));
  }
  const ringMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COLORS.porcelainRim),
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const ring = shadowed(new THREE.Mesh(new THREE.LatheGeometry(ringPts, 96), ringMat), false, true);
  ring.name = 'RimRing';
  group.add(ring);

  return { group, floorY: fy, innerRadius: ri, update: noop };
}

// ---------------------------------------------------------------------------------------------
// Soy bowl
// ---------------------------------------------------------------------------------------------

export function buildSoyBowl() {
  const group = new THREE.Group();
  group.name = 'SoyBowl';

  const ro = BOWL.outerRadius;
  const h = BOWL.height;
  const sy = BOWL.sauceY;

  // Profile with a tag per point: 'out' terracotta glaze, 'lip' blend, 'in' cream glaze,
  // 'soy' the cream glaze seen through / stained by the sauce (below the sauce line).
  const pts = [];
  const tags = [];
  const P = (x, y, tag) => { pts.push(new THREE.Vector2(x, y)); tags.push(tag); };
  P(0, 0.03, 'out'); P(0.15, 0.03, 'out'); P(0.16, 0, 'out'); P(0.21, 0, 'out'); P(0.225, 0.028, 'out');
  P(0.27, 0.05, 'out'); P(0.33, 0.092, 'out'); P(0.38, 0.14, 'out'); P(0.41, 0.19, 'out'); P(ro, 0.222, 'out');
  P(ro - 0.005, h - 0.004, 'out'); P(ro - 0.016, h + 0.005, 'out'); P(ro - 0.03, h + 0.005, 'lip');
  P(ro - 0.04, h - 0.002, 'in'); P(0.372, 0.215, 'in'); P(0.36, sy + 0.007, 'in');
  P(0.357, sy + 0.002, 'soy'); P(0.352, sy - 0.006, 'soy'); P(0.335, 0.135, 'soy'); P(0.30, 0.105, 'soy');
  P(0.24, 0.08, 'soy'); P(0.16, 0.066, 'soy'); P(0.07, 0.061, 'soy'); P(0, 0.06, 'soy');

  const geometry = new THREE.LatheGeometry(pts, 96);
  const palette = {
    out: linearRGB(COLORS.terracotta),
    lip: linearRGB('#E0B28F'),
    in: linearRGB('#F3E7D3'),
    soy: linearRGB('#3A1E0C'),
  };
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const c = palette[tags[i % pts.length]];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const glaze = new THREE.MeshPhysicalMaterial({
    map: porcelainTexture({ repeat: [3, 1] }),
    color: new THREE.Color('#FFFFFF'),
    vertexColors: true,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.2,
  });
  const bowl = shadowed(new THREE.Mesh(geometry, glaze));
  bowl.name = 'Bowl';
  group.add(bowl);

  const sauce = new SauceSurface({ radius: BOWL.sauceRadius, segments: 96 });
  sauce.mesh.position.y = sy;
  group.add(sauce.mesh);

  return {
    group,
    sauce,
    sauceY: sy,
    radius: BOWL.sauceRadius,
    update(dt) { sauce.update(dt); },
  };
}

// ---------------------------------------------------------------------------------------------
// Chopsticks
// ---------------------------------------------------------------------------------------------

export function buildChopsticks() {
  const L = CHOPSTICKS.length;
  const rTop = CHOPSTICKS.radiusTop;
  const rTip = CHOPSTICKS.radiusTip;
  const base = 0.025;          // half the gap between the sticks at the held end (parallel gap ≈ 0.05)
  const halfSepMin = 0.01;     // tip half-separation at t = 0 (tips ~0.02 apart)
  const halfSepMax = 0.275;    // at t = 1 (tips ~0.55 apart)
  const tipLen = 0.35;

  const group = new THREE.Group();
  group.name = 'Chopsticks';

  const wood = new THREE.MeshStandardMaterial({
    map: bambooTexture({ seed: 9, nodes: 1, base: COLORS.chopstick, light: '#D8B486', dark: '#8C6740', repeat: [0.3, 3] }),
    roughness: 0.55,
    metalness: 0,
  });
  const lacquer = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COLORS.chopstickTip),
    roughness: 0.35,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
  });
  const bandMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COLORS.terracottaDeep),
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  });

  const radiusAt = (yFromTop) => rTop - (rTop - rTip) * (yFromTop / L);
  const stickGeo = new THREE.CylinderGeometry(rTop, rTip, L, 14, 1);
  const tipGeo = new THREE.CylinderGeometry(radiusAt(L - tipLen) + 0.001, rTip + 0.0008, tipLen, 14, 1);
  const band1Geo = new THREE.CylinderGeometry(radiusAt(0.205) + 0.0012, radiusAt(0.235) + 0.0012, 0.03, 14, 1);
  const band2Geo = new THREE.CylinderGeometry(radiusAt(0.258) + 0.0012, radiusAt(0.27) + 0.0012, 0.012, 14, 1);

  const makeStick = (sign, name) => {
    const pivot = new THREE.Group();
    pivot.name = name;
    const x = sign * base;
    const stick = shadowed(new THREE.Mesh(stickGeo, wood));
    stick.position.set(x, -L / 2, 0);
    stick.name = name + 'Stick';
    const tip = shadowed(new THREE.Mesh(tipGeo, lacquer));
    tip.position.set(x, -L + tipLen / 2, 0);
    const b1 = shadowed(new THREE.Mesh(band1Geo, bandMat), false, true);
    b1.position.set(x, -0.22, 0);
    const b2 = shadowed(new THREE.Mesh(band2Geo, bandMat), false, true);
    b2.position.set(x, -0.264, 0);
    pivot.add(stick, tip, b1, b2);
    pivot.userData.stick = stick;
    return pivot;
  };
  const left = makeStick(-1, 'Left');
  const right = makeStick(1, 'Right');
  group.add(left, right);

  const pivotR = Math.hypot(base, L);
  const pivotPhi = Math.atan2(base, L);
  let theta = 0;
  let openness = 0;

  /** t = 0: tips ~0.02 apart, t = 1: ~0.55 apart. Sticks pivot around the origin in local x. */
  function setOpen(t) {
    left.position.x = 0; right.position.x = 0;
    openness = clamp01(Number.isFinite(t) ? t : 0);
    const half = halfSepMin + (halfSepMax - halfSepMin) * openness;
    theta = Math.asin(Math.min(1, half / pivotR)) - pivotPhi;
    right.rotation.z = theta;
    left.rotation.z = -theta;
  }

  /** World midpoint between the two tips. */
  function tipWorldPosition(target) {
    target = target || new THREE.Vector3();
    group.updateWorldMatrix(true, false);
    target.set(0, base * Math.sin(theta) - L * Math.cos(theta), 0);
    return group.localToWorld(target);
  }

  /** World point CHOPSTICKS.gripFromTip above the tips along the sticks' axis. */
  function gripWorldPosition(target) {
    target = target || new THREE.Vector3();
    group.updateWorldMatrix(true, false);
    target.set(0, -L + CHOPSTICKS.gripFromTip, 0);
    return group.localToWorld(target);
  }

  setOpen(0.12);

  return {
    group,
    left,
    right,
    leftStick: left.userData.stick,
    rightStick: right.userData.stick,
    setOpen,
    // Fan outward above the contact, so the shaft clears the dumpling's shoulders.
    setContact(leftX, rightX, fan = 0.10) {
      left.rotation.z = fan; right.rotation.z = -fan;
      left.position.x = leftX + base * Math.cos(fan) - L * Math.sin(fan);
      right.position.x = rightX - base * Math.cos(fan) + L * Math.sin(fan);
    },
    get open() { return openness; },
    tipWorldPosition,
    gripWorldPosition,
    update: noop,
  };
}

// ---------------------------------------------------------------------------------------------
// Chopstick rest
// ---------------------------------------------------------------------------------------------

export function buildChopstickRest() {
  const group = new THREE.Group();
  group.name = 'ChopstickRest';

  const len = 0.5;
  const height = 0.08;
  const depth = 0.13;
  const shape = new THREE.Shape();
  shape.moveTo(-len / 2, 0);
  shape.lineTo(len / 2, 0);
  shape.lineTo(len / 2, height * 0.85);
  shape.quadraticCurveTo(len / 2, height, len / 2 - 0.03, height);
  shape.lineTo(0.14, height);
  shape.bezierCurveTo(0.07, height, 0.055, height * 0.56, 0, height * 0.56);
  shape.bezierCurveTo(-0.055, height * 0.56, -0.07, height, -0.14, height);
  shape.lineTo(-len / 2 + 0.03, height);
  shape.quadraticCurveTo(-len / 2, height, -len / 2, height * 0.85);
  shape.closePath();

  const bevel = 0.01;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 10,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: bevel,
    bevelSegments: 3,
  });
  geometry.translate(0, bevel, -depth / 2);

  const glaze = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(COLORS.terracotta),
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.25,
  });
  const rest = shadowed(new THREE.Mesh(geometry, glaze));
  rest.name = 'Rest';
  group.add(rest);

  return { group, update: noop };
}

// ---------------------------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------------------------

export function buildTable() {
  const group = new THREE.Group();
  group.name = 'Table';

  const radius = 14;
  const geometry = new THREE.RingGeometry(0.02, radius, 128, 24);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i)) / radius;
    const c = 1 - 0.1 * smoothstep(0.05, 0.85, r); // white centre → ~0.9 at the horizon
    colors[i * 3] = c;
    colors[i * 3 + 1] = c;
    colors[i * 3 + 2] = c;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(COLORS.table),
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  const table = shadowed(new THREE.Mesh(geometry, material), false, true);
  table.rotation.x = -Math.PI / 2;
  table.name = 'TableTop';
  group.add(table);

  return { group, update: noop };
}
