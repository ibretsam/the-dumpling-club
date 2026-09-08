// Geometry-based contact helpers shared by animation and regression tests.
import * as THREE from 'three';
import { BOWL, CHOPSTICKS } from './config.js';

// Inner porcelain profile, from the centre to the lip (same points as buildSoyBowl).
export const BOWL_INTERIOR = [
  [0, 0.06], [0.07, 0.061], [0.16, 0.066], [0.24, 0.08],
  [0.30, 0.105], [0.335, 0.135], [0.352, 0.164], [0.357, 0.172],
  [0.36, 0.177], [0.372, 0.215], [0.38, 0.238], [0.39, 0.245], [0.42, 0.245],
];
export function bowlFloorAt(radius) {
  if (radius > BOWL.outerRadius) return 0;
  for (let i = 1; i < BOWL_INTERIOR.length; i++) {
    const [r, y] = BOWL_INTERIOR[i], [r0, y0] = BOWL_INTERIOR[i - 1];
    if (radius <= r) return THREE.MathUtils.lerp(y0, y, (radius - r0) / (r - r0));
  }
  return BOWL.height + 0.005;
}

const matrix = new THREE.Matrix4();
const vertex = new THREE.Vector3();
/** Supporting lines for the two shafts in chopstick space. Opening adds clearance. */
export function gripSupports(mesh, chopGroup, fan = 0.10) {
  mesh.updateWorldMatrix(true, false);
  chopGroup.updateWorldMatrix(true, false);
  matrix.copy(chopGroup.matrixWorld).invert().multiply(mesh.matrixWorld);
  const pos = mesh.geometry.attributes.position;
  let left = Infinity, right = -Infinity;
  const tipY = -CHOPSTICKS.length;
  const radius = CHOPSTICKS.radiusTip + 0.004;
  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    // A thin section through the shaft plane avoids using the far side of a crescent.
    if (Math.abs(vertex.z) > 0.045) continue;
    const flare = Math.max(0, vertex.y - tipY) * Math.tan(fan);
    right = Math.max(right, vertex.x - flare + radius);
    left = Math.min(left, vertex.x + flare - radius);
  }
  return Number.isFinite(left) ? { left, right } : { left: -0.25, right: 0.25 };
}

/** Lift required to keep the actual animated mesh above the table and curved porcelain. */
export function vesselClearance(mesh, bowlPosition, bowlVisible = true, margin = 0.009) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position;
  let lift = 0;
  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    let floor = 0;
    if (bowlVisible) {
      const r = Math.hypot(vertex.x - bowlPosition.x, vertex.z - bowlPosition.z);
      if (r <= BOWL.outerRadius) floor = bowlPosition.y + bowlFloorAt(r);
    }
    lift = Math.max(lift, floor + margin - vertex.y);
  }
  return lift;
}

/** Highest local dough height actually touching soy, including tilted crescent tips. */
export function sauceContactLevel(mesh, bowlPosition, bodyHeight) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position;
  const surfaceY = bowlPosition.y + BOWL.sauceY;
  let level = 0;
  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    if (vertex.y > surfaceY || Math.hypot(vertex.x-bowlPosition.x, vertex.z-bowlPosition.z) > BOWL.sauceRadius) continue;
    level = Math.max(level, pos.getY(i) / bodyHeight + .02);
  }
  return THREE.MathUtils.clamp(level, 0, .42);
}
