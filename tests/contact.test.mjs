// Fast contact regression tests; no browser, network, or npm dependencies required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../tools/three-resolver-hook.mjs', import.meta.url);
const THREE = await import('../lib/three.module.js');
const { vesselClearance, gripSupports, sauceContactLevel } = await import('../js/contact.js');
const { DUMPLING_TYPES, buildTypeGeometry } = await import('../js/dumpling-geometry.js');
const bowl = new THREE.Vector3(1.7, 0, -.45);

test('a submerged body is raised above the porcelain, then settles without jitter', () => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(.22,32,24));
  mesh.position.copy(bowl).add(new THREE.Vector3(0,.15,0));
  const correction = vesselClearance(mesh,bowl);
  assert.ok(correction > .12, 'must lift the bottom out of the bowl floor');
  mesh.position.y += correction;
  assert.ok(vesselClearance(mesh,bowl) < 1e-7, 'constraint must be stable on the next frame');
});
test('clearing the rim also clears the sloped bowl wall', () => {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.08,.08,.08));
  mesh.position.copy(bowl).add(new THREE.Vector3(.37,.16,0));
  const correction=vesselClearance(mesh,bowl);
  assert.ok(correction>.10, 'rim needs more clearance than the centre');
});
test('hidden sauce bowl leaves the table as the collision floor', () => {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1));
  mesh.position.copy(bowl).add(new THREE.Vector3(0,.10,0));
  assert.equal(vesselClearance(mesh,bowl,false),0);
});
for(const type of DUMPLING_TYPES) {
  test(`${type.name}: finite, ordered contacts across scale and yaw`, () => {
    const mesh=new THREE.Mesh(buildTypeGeometry(type.id));
    const chop=new THREE.Group();
    for(const scale of [.6,.8,1]) for(const yaw of [-.3,0,.62]) {
      mesh.scale.setScalar(scale);mesh.rotation.y=yaw;
      mesh.position.y=-2.12-type.metrics.gripHeight*scale;
      const s=gripSupports(mesh,chop);
      assert.ok(Number.isFinite(s.left)&&Number.isFinite(s.right));
      assert.ok(s.left<s.right, 'left and right shafts must never cross');
      assert.ok(s.right-s.left>.1&&s.right-s.left<1, 'gap follows the real food scale');
    }
    mesh.geometry.dispose();
  });
}

test('sauce coats a tilted tip even when the food origin is above the liquid', () => {
  const geometry=new THREE.BoxGeometry(.5,.18,.1);geometry.translate(0,.09,0);
  const mesh=new THREE.Mesh(geometry);mesh.position.copy(bowl).add(new THREE.Vector3(0,.20,0));mesh.rotation.z=.5;
  assert(mesh.position.y>.17);
  assert(sauceContactLevel(mesh,bowl,.18)>0,'the low corner touches soy');
  mesh.position.x+=1;
  assert.equal(sauceContactLevel(mesh,bowl,.18),0,'a nearby surface outside the sauce is not coated');
  mesh.geometry.dispose();
});
