// Shared constants for The Dumpling Club.
// Units: 1 world unit ~= 10 cm. Y is up. The table surface is at y = 0.
// Camera looks from +z (front) and slightly above; dumpling faces point toward +z.

export const COLORS = {
  background: '#F5EBDD',   // warm cream
  table: '#EEDFC9',        // slightly deeper cream for the tabletop
  terracotta: '#C4613C',
  terracottaDeep: '#9E4A2B',
  dough: '#F7E8D0',
  doughShade: '#E8D2B2',
  cheek: '#F09A97',
  eye: '#3A2A22',
  bamboo: '#CDA672',
  bambooDark: '#8E6B41',
  bambooLight: '#E2C48F',
  parchment: '#F6EEDD',
  porcelain: '#F8F5EF',
  porcelainRim: '#C4613C',
  soy: '#2A1407',
  soyHighlight: '#6B3A17',
  filling: '#B97A52',
  chopstick: '#B58A5A',
  chopstickTip: '#7A5A38',
  ink: '#3B2A21',
};

// Dumpling body dimensions (object space, origin at base center, face toward +z).
export const DUMPLING = {
  radius: 0.26,      // widest half-width
  height: 0.50,      // base to top of the knob
  bodyHeight: 0.42,  // base to where the pleat twist gathers
  faceUV: { u0: 0.30, u1: 0.70, v0: 0.24, v1: 0.62 }, // UV rect where the face is painted
};

// Serving vessels.
export const STEAMER = {
  outerRadius: 1.0,
  innerRadius: 0.86,   // usable radius for placing dumplings
  wallHeight: 0.42,
  floorY: 0.10,        // top of the parchment liner (dumplings sit here)
};

export const PLATE = {
  outerRadius: 1.1,
  innerRadius: 0.8,
  floorY: 0.06,
};

export const BOWL = {
  outerRadius: 0.42,
  height: 0.24,
  sauceRadius: 0.34,
  sauceY: 0.17,        // height of the sauce surface above the table
};

export const CHOPSTICKS = {
  length: 2.2,
  radiusTop: 0.032,
  radiusTip: 0.018,
  gripFromTip: 0.08,   // distance from tip to where a dumpling is held
};

// World layout (positions of group origins on the table).
export const LAYOUT = {
  steamer: { x: 0, y: 0, z: 0 },
  bowl: { x: 1.7, y: 0, z: -0.45 },
  chopstickRest: { x: 0.92, y: 0, z: 1.5, yaw: Math.PI / 2 },
  // Chopsticks resting pose: laid on the table in front of the steamer, tips raised on the rest.
  chopsticksRest: { x: 0.05, y: 0.035, z: 1.45, yaw: -0.06, tilt: 0.045 },
  cameraLookAt: { x: 0.6, y: 0.12, z: 0.05 },
  cameraPos: { x: 1.15, y: 3.25, z: 4.55 },
  fov: 30,
};

// Dumpling arrangements for each portion size: x/z offsets from the vessel centre and a yaw.
// `footprint` is the half-width of one dumpling; rings grow so neighbours never overlap. The
// returned array also carries `ringRadius` so the caller can scale a portion down to fit.
export function arrangement(count, footprint = 0.27) {
  const out = [];
  const jitter = () => (Math.random() - 0.5) * 0.4;
  const ringFor = (n, base) => Math.max(base, (footprint * 1.08) / Math.sin(Math.PI / n));
  if (count === 1) { out.push({ x: 0, z: 0, yaw: 0 }); out.ringRadius = 0; return out; }
  if (count <= 3) {
    const r = ringFor(count, 0.40);
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 2 + (i / count) * Math.PI * 2 + Math.PI; // start at the front
      out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: jitter() });
    }
    out.ringRadius = r;
    return out;
  }
  if (count <= 6) {
    const r = ringFor(count, 0.53);
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 2 + (i / count) * Math.PI * 2; // first one at the front
      out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: jitter() });
    }
    out.ringRadius = r;
    return out;
  }
  // 7 or 8: one in the middle, the rest around.
  const ring = count - 1;
  const r = Math.max(ringFor(ring, 0.60), footprint * 2.1);
  out.push({ x: 0, z: 0, yaw: jitter() * 0.6 });
  for (let i = 0; i < ring; i++) {
    const a = Math.PI / 2 + (i / ring) * Math.PI * 2;
    out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: jitter() });
  }
  out.ringRadius = r;
  return out;
}

export const PERSONALITIES = [
  { id: 'mochi',   name: 'Mochi',   trait: 'cheerful',  mood: 'happy' },
  { id: 'pip',     name: 'Pip',     trait: 'curious',   mood: 'curious' },
  { id: 'dumpy',   name: 'Dumpy',   trait: 'sleepy',    mood: 'sleepy' },
  { id: 'bao',     name: 'Bao',     trait: 'cheeky',    mood: 'cheeky' },
  { id: 'pudding', name: 'Pudding', trait: 'shy',       mood: 'shy' },
  { id: 'nori',    name: 'Nori',    trait: 'grumpy',    mood: 'grumpy' },
  { id: 'suki',    name: 'Suki',    trait: 'excited',   mood: 'excited' },
  { id: 'momo',    name: 'Momo',    trait: 'silly',     mood: 'silly' },
];
