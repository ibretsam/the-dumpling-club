// tools/build-dumpling-glb.mjs — builds every dumpling type from js/dumpling-geometry.js and writes
// assets/dumplings.glb (binary glTF 2.0) with one body mesh and one bitten mesh per type.
//
// Run:  node tools/build-dumpling-glb.mjs   (or `npm run build:model`)
//
// 'three' is a bare specifier in the project modules and in lib/addons/exporters/GLTFExporter.js;
// Node has no import map, so tools/three-resolver-hook.mjs is registered first and every import
// below is dynamic (static imports would resolve before the hook is active). GLTFExporter needs a
// FileReader for binary output; a small Blob-backed polyfill is installed. No DOM is required
// because no textures are exported (the faces are painted at runtime).

import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

register('./three-resolver-hook.mjs', import.meta.url);

class NodeFileReader {
  constructor() {
    this.result = null;
    this.error = null;
    this.readyState = 0; // EMPTY
    this.onload = null;
    this.onloadend = null;
    this.onerror = null;
    this._listeners = {};
  }

  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this._listeners[type];
    if (list) this._listeners[type] = list.filter((f) => f !== fn);
  }

  _emit(type) {
    const event = { type, target: this };
    const handler = this['on' + type];
    if (typeof handler === 'function') handler.call(this, event);
    for (const fn of this._listeners[type] || []) fn.call(this, event);
  }

  _read(promise) {
    this.readyState = 1; // LOADING
    // Always asynchronous, so the caller can attach onload/onloadend after calling read*().
    promise.then(
      (result) => {
        this.result = result;
        this.readyState = 2; // DONE
        this._emit('load');
        this._emit('loadend');
      },
      (err) => {
        this.error = err;
        this.readyState = 2;
        this._emit('error');
        this._emit('loadend');
      },
    );
  }

  readAsArrayBuffer(blob) {
    this._read(blob.arrayBuffer());
  }

  readAsText(blob) {
    this._read(blob.text());
  }

  readAsDataURL(blob) {
    const type = blob.type || 'application/octet-stream';
    this._read(blob.arrayBuffer().then((buf) => `data:${type};base64,${Buffer.from(buf).toString('base64')}`));
  }

  abort() {
    this.readyState = 2;
  }
}
NodeFileReader.EMPTY = 0;
NodeFileReader.LOADING = 1;
NodeFileReader.DONE = 2;

if (typeof globalThis.FileReader === 'undefined') globalThis.FileReader = NodeFileReader;
if (typeof globalThis.Blob === 'undefined') {
  const { Blob } = await import('node:buffer');
  globalThis.Blob = Blob;
}
if (typeof globalThis.TextEncoder === 'undefined') {
  const util = await import('node:util');
  globalThis.TextEncoder = util.TextEncoder;
  globalThis.TextDecoder = util.TextDecoder;
}


const THREE = await import('three');
const { GLTFExporter } = await import('../lib/addons/exporters/GLTFExporter.js');
const geo = await import('../js/dumpling-geometry.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'dumplings.glb');
const pascal = (id) => id.charAt(0).toUpperCase() + id.slice(1);
export const meshNameFor = (id, bitten) => pascal(id) + (bitten ? 'Bitten' : 'Body');

function buildGroup() {
  const group = new THREE.Group();
  group.name = 'DumplingClub';
  let x = 0;
  for (const type of geo.DUMPLING_TYPES) {
    const skin = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(type.skin.color), roughness: type.skin.roughness, metalness: 0, name: type.id + '-skin' });
    const body = new THREE.Mesh(geo.buildTypeGeometry(type.id), skin);
    body.name = meshNameFor(type.id, false);
    body.position.x = x;
    body.userData = { type: type.id, name: type.name, metrics: { ...type.metrics }, faceUV: { ...type.faceUV }, bite: { ...type.bite }, uv: geo.measureUvInfo(type.id) };
    const bitten = new THREE.Mesh(geo.buildTypeGeometry(type.id, { bitten: true }), new THREE.MeshPhysicalMaterial({ color: new THREE.Color(type.skin.color), roughness: type.skin.roughness, metalness: 0, vertexColors: true, name: type.id + '-skin-bitten' }));
    bitten.name = meshNameFor(type.id, true);
    bitten.position.set(x, 0, -1.0);
    bitten.userData = { type: type.id, variant: 'bitten' };
    group.add(body, bitten);
    x += type.metrics.radius * 2 + 0.25;
  }
  return group;
}

async function exportGLB(group) {
  const exporter = new GLTFExporter();
  exporter.register(() => ({ writeMesh(mesh, meshDef) { if (mesh.name) meshDef.name = mesh.name; } }));
  const result = await exporter.parseAsync(group, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return an ArrayBuffer');
  return result;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const COMPONENT_TYPES = {
  5120: { ctor: Int8Array, size: 1 },
  5121: { ctor: Uint8Array, size: 1 },
  5122: { ctor: Int16Array, size: 2 },
  5123: { ctor: Uint16Array, size: 2 },
  5125: { ctor: Uint32Array, size: 4 },
  5126: { ctor: Float32Array, size: 4 },
};
const TYPE_SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGLB(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.byteLength < 20) throw new Error('file too small to be a GLB');
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const length = view.getUint32(8, true);
  if (magic !== GLB_MAGIC) throw new Error(`bad magic 0x${magic.toString(16)} (expected 'glTF')`);
  if (version !== 2) throw new Error(`unsupported GLB version ${version} (expected 2)`);
  if (length !== buffer.byteLength) throw new Error(`header length ${length} != file size ${buffer.byteLength}`);

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < length) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkStart + chunkLength > length) throw new Error('chunk overruns file');
    if (chunkType === CHUNK_JSON) {
      if (json !== null) throw new Error('duplicate JSON chunk');
      json = JSON.parse(new TextDecoder().decode(buffer.subarray(chunkStart, chunkStart + chunkLength)));
    } else if (chunkType === CHUNK_BIN) {
      if (bin !== null) throw new Error('duplicate BIN chunk');
      bin = buffer.subarray(chunkStart, chunkStart + chunkLength);
    } else {
      throw new Error(`unknown chunk type 0x${chunkType.toString(16)}`);
    }
    offset = chunkStart + chunkLength;
  }
  if (!json) throw new Error('no JSON chunk');
  if (!bin) throw new Error('no BIN chunk');
  return { json, bin };
}

/** Reads an accessor from the BIN chunk into a typed array (tightly packed copy). */
function readAccessor(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor.bufferView];
  const comp = COMPONENT_TYPES[accessor.componentType];
  const itemSize = TYPE_SIZES[accessor.type];
  if (!comp || !itemSize) throw new Error(`unsupported accessor ${accessorIndex}`);
  const count = accessor.count;
  const stride = bufferView.byteStride || itemSize * comp.size;
  const base = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = new comp.ctor(count * itemSize);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const getter = {
    5120: (o) => view.getInt8(o),
    5121: (o) => view.getUint8(o),
    5122: (o) => view.getInt16(o, true),
    5123: (o) => view.getUint16(o, true),
    5125: (o) => view.getUint32(o, true),
    5126: (o) => view.getFloat32(o, true),
  }[accessor.componentType];
  for (let i = 0; i < count; i++) {
    const rowOffset = base + i * stride;
    for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = getter(rowOffset + k * comp.size);
  }
  return { accessor, data: out, itemSize };
}

function boundsOf(data, itemSize) {
  const min = new Array(itemSize).fill(Infinity);
  const max = new Array(itemSize).fill(-Infinity);
  let nan = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) { nan++; continue; }
    const k = i % itemSize;
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  return { min, max, nan };
}

const fmt = (arr) => '[' + arr.map((v) => (typeof v === 'number' ? v.toFixed(4) : String(v))).join(', ') + ']';
const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;


function verify(filePath) {
  const buffer = fs.readFileSync(filePath);
  const { json, bin } = parseGLB(buffer);
  const failures = [];
  console.log(`\nVerification of ${path.relative(ROOT, filePath)}`);
  console.log(`  size       ${buffer.byteLength} bytes (${(buffer.byteLength / 1024).toFixed(1)} KiB), magic glTF v2, BIN ${bin.byteLength} bytes`);
  const names = json.meshes.map((m) => m.name);
  for (const type of geo.DUMPLING_TYPES) {
    for (const bitten of [false, true]) {
      const name = meshNameFor(type.id, bitten);
      const mi = names.indexOf(name);
      if (mi < 0) { failures.push('missing mesh ' + name); continue; }
      const prim = json.meshes[mi].primitives[0];
      const pos = readAccessor(json, bin, prim.attributes.POSITION);
      const nor = readAccessor(json, bin, prim.attributes.NORMAL);
      const b = boundsOf(pos.data, 3);
      const nb = boundsOf(nor.data, 3);
      const hasColor = prim.attributes.COLOR_0 !== undefined;
      if (b.nan || nb.nan) failures.push(name + ' has NaN');
      if (bitten && !hasColor) failures.push(name + ' lacks COLOR_0');
      if (!prim.attributes.TEXCOORD_0) failures.push(name + ' lacks TEXCOORD_0');
      console.log(`  ${name.padEnd(18)} verts ${String(pos.accessor.count).padStart(6)}  y ${b.min[1].toFixed(3)}..${b.max[1].toFixed(3)}  x ${b.min[0].toFixed(3)}..${b.max[0].toFixed(3)}  z ${b.min[2].toFixed(3)}..${b.max[2].toFixed(3)}${hasColor ? '  COLOR_0' : ''}`);
    }
  }
  if (failures.length) { for (const f of failures) console.error('  FAIL ' + f); process.exitCode = 1; }
  else console.log('  all meshes present, finite, textured');
}

const t0 = performance.now();
const group = buildGroup();
const glb = await exportGLB(group);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(glb));
console.log(`Wrote ${path.relative(ROOT, OUT)} in ${Math.round(performance.now() - t0)} ms`);
verify(OUT);
