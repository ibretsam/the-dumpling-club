// tools/build-dumpling-glb.mjs — builds every dumpling type from js/dumpling-geometry.js and writes
// one small binary glTF per dish to assets/dumplings/<type>.glb, each holding a body mesh and a
// bitten mesh (<Type>Body / <Type>Bitten).
//
// Run:  node tools/build-dumpling-glb.mjs   (or `npm run build:model`)
//
// Why one file per dish: the site only needs the dish on the welcome table before it can open, so
// the other five download in the background while the title screen is up. On a phone that turns a
// single multi-megabyte wait into a few hundred kilobytes.
//
// Why quantized: every attribute is stored with KHR_mesh_quantization — int16 positions and
// normals, uint16 texture coordinates and uint8 vertex colours (~1.5e-5 units of position error).
// The vendored GLTFLoader decodes it natively; runtime code that reads vertices goes through
// BufferAttribute.getX/Y/Z, which denormalizes for it. Together the files are about a third smaller
// than the float32 export.
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
const OUT_DIR = path.join(ROOT, 'assets', 'dumplings');
const pascal = (id) => id.charAt(0).toUpperCase() + id.slice(1);
export const meshNameFor = (id, bitten) => pascal(id) + (bitten ? 'Bitten' : 'Body');
export const fileFor = (id) => path.join(OUT_DIR, id + '.glb');

// ------------------------------------------------------------------------------------------------
// Quantization
// ------------------------------------------------------------------------------------------------

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Float attribute → normalized integer attribute (the exporter writes it as KHR_mesh_quantization). */
function quantizeAttribute(attribute, Ctor, scale, min = -1, max = 1) {
  const src = attribute.array;
  const out = new Ctor(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.round(clamp(src[i], min, max) * scale);
  return new THREE.BufferAttribute(out, attribute.itemSize, true);
}

/**
 * A quantized twin of a dumpling geometry. Positions stay well inside ±1 unit (the largest dish
 * is ~0.6 units long), so int16 keeps ~1.5e-5 units of precision; normals also fit int16 within
 * the glTF validator's unit-length tolerance; UVs are 0..1 (uint16) and vertex colours 0..1 (uint8).
 */
function quantizeGeometry(source) {
  const out = new THREE.BufferGeometry();
  out.name = source.name;
  out.setAttribute('position', quantizeAttribute(source.attributes.position, Int16Array, 32767));
  out.setAttribute('normal', quantizeAttribute(source.attributes.normal, Int16Array, 32767));
  out.setAttribute('uv', quantizeAttribute(source.attributes.uv, Uint16Array, 65535, 0, 1));
  if (source.attributes.color) out.setAttribute('color', quantizeAttribute(source.attributes.color, Uint8Array, 255, 0, 1));
  out.setIndex(source.index);
  out.userData = { ...source.userData };
  return out;
}

// ------------------------------------------------------------------------------------------------
// Export
// ------------------------------------------------------------------------------------------------

function buildTypeGroup(type) {
  const group = new THREE.Group();
  group.name = 'DumplingClub-' + type.id;
  const skin = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(type.skin.color), roughness: type.skin.roughness, metalness: 0, name: type.id + '-skin' });
  const bodySource = geo.buildTypeGeometry(type.id);
  const bittenSource = geo.buildTypeGeometry(type.id, { bitten: true });
  const body = new THREE.Mesh(quantizeGeometry(bodySource), skin);
  body.name = meshNameFor(type.id, false);
  body.userData = { type: type.id, name: type.name, metrics: { ...type.metrics }, faceUV: { ...type.faceUV }, bite: { ...type.bite }, uv: geo.measureUvInfo(type.id) };
  const bitten = new THREE.Mesh(quantizeGeometry(bittenSource), new THREE.MeshPhysicalMaterial({ color: new THREE.Color(type.skin.color), roughness: type.skin.roughness, metalness: 0, vertexColors: true, name: type.id + '-skin-bitten' }));
  bitten.name = meshNameFor(type.id, true);
  bitten.position.set(0, 0, -1.0);
  bitten.userData = { type: type.id, variant: 'bitten' };
  group.add(body, bitten);
  return { group, sources: { body: bodySource, bitten: bittenSource } };
}

async function exportGLB(group) {
  const exporter = new GLTFExporter();
  exporter.register(() => ({ writeMesh(mesh, meshDef) { if (mesh.name) meshDef.name = mesh.name; } }));
  const result = await exporter.parseAsync(group, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return an ArrayBuffer');
  return result;
}

// ------------------------------------------------------------------------------------------------
// Verification (independent GLB parser; no three.js involved)
// ------------------------------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const COMPONENT_TYPES = {
  5120: { ctor: Int8Array, size: 1, scale: 127 },
  5121: { ctor: Uint8Array, size: 1, scale: 255 },
  5122: { ctor: Int16Array, size: 2, scale: 32767 },
  5123: { ctor: Uint16Array, size: 2, scale: 65535 },
  5125: { ctor: Uint32Array, size: 4, scale: 1 },
  5126: { ctor: Float32Array, size: 4, scale: 1 },
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

/** Reads an accessor from the BIN chunk as floats (normalized integers are denormalized). */
function readAccessor(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor.bufferView];
  const comp = COMPONENT_TYPES[accessor.componentType];
  const itemSize = TYPE_SIZES[accessor.type];
  if (!comp || !itemSize) throw new Error(`unsupported accessor ${accessorIndex}`);
  const count = accessor.count;
  const stride = bufferView.byteStride || itemSize * comp.size;
  const base = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = new Float32Array(count * itemSize);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const getter = {
    5120: (o) => view.getInt8(o),
    5121: (o) => view.getUint8(o),
    5122: (o) => view.getInt16(o, true),
    5123: (o) => view.getUint16(o, true),
    5125: (o) => view.getUint32(o, true),
    5126: (o) => view.getFloat32(o, true),
  }[accessor.componentType];
  const scale = accessor.normalized ? comp.scale : 1;
  for (let i = 0; i < count; i++) {
    const rowOffset = base + i * stride;
    for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = getter(rowOffset + k * comp.size) / scale;
  }
  return { accessor, data: out, itemSize };
}

/** Largest absolute difference between a decoded accessor and the float geometry it came from. */
function maxError(decoded, attribute) {
  let err = 0;
  const src = attribute.array;
  if (decoded.length !== src.length) return Infinity;
  for (let i = 0; i < src.length; i++) err = Math.max(err, Math.abs(decoded[i] - src[i]));
  return err;
}

function verify(type, filePath, sources) {
  const buffer = fs.readFileSync(filePath);
  const { json, bin } = parseGLB(buffer);
  const failures = [];
  if (!(json.extensionsUsed || []).includes('KHR_mesh_quantization')) failures.push('KHR_mesh_quantization not declared');
  const names = json.meshes.map((m) => m.name);
  const rows = [];
  for (const bitten of [false, true]) {
    const name = meshNameFor(type.id, bitten);
    const mi = names.indexOf(name);
    if (mi < 0) { failures.push('missing mesh ' + name); continue; }
    const prim = json.meshes[mi].primitives[0];
    const source = bitten ? sources.bitten : sources.body;
    const pos = readAccessor(json, bin, prim.attributes.POSITION);
    const nor = readAccessor(json, bin, prim.attributes.NORMAL);
    const hasColor = prim.attributes.COLOR_0 !== undefined;
    if (!pos.accessor.normalized || pos.accessor.componentType !== 5122) failures.push(name + ' positions are not int16 normalized');
    if (!prim.attributes.TEXCOORD_0) failures.push(name + ' lacks TEXCOORD_0');
    if (bitten && !hasColor) failures.push(name + ' lacks COLOR_0');
    const posErr = maxError(pos.data, source.attributes.position);
    const norErr = maxError(nor.data, source.attributes.normal);
    if (!(posErr < 1e-4)) failures.push(`${name} position error ${posErr}`);
    if (!(norErr < 1e-3)) failures.push(`${name} normal error ${norErr}`);
    for (let i = 0; i < pos.data.length; i++) if (!Number.isFinite(pos.data[i])) { failures.push(name + ' has NaN'); break; }
    rows.push(`    ${name.padEnd(18)} verts ${String(pos.accessor.count).padStart(6)}  position error ${posErr.toExponential(1)}  normal error ${norErr.toExponential(1)}${hasColor ? '  COLOR_0' : ''}`);
  }
  return { bytes: buffer.byteLength, rows, failures };
}

// ------------------------------------------------------------------------------------------------
// Main
// ------------------------------------------------------------------------------------------------

const t0 = performance.now();
fs.mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
const allFailures = [];
for (const type of geo.DUMPLING_TYPES) {
  const { group, sources } = buildTypeGroup(type);
  const glb = await exportGLB(group);
  const file = fileFor(type.id);
  fs.writeFileSync(file, Buffer.from(glb));
  const { bytes, rows, failures } = verify(type, file, sources);
  total += bytes;
  console.log(`${path.relative(ROOT, file)}  ${(bytes / 1024).toFixed(0)} KiB`);
  for (const row of rows) console.log(row);
  for (const f of failures) { console.error('    FAIL ' + f); allFailures.push(type.id + ': ' + f); }
}
console.log(`\nWrote ${geo.DUMPLING_TYPES.length} files, ${(total / 1024).toFixed(0)} KiB total, in ${Math.round(performance.now() - t0)} ms`);
if (allFailures.length) process.exitCode = 1;
else console.log('all meshes present, quantized, finite and within tolerance');
