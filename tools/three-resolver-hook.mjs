// tools/three-resolver-hook.mjs — The Dumpling Club
//
// Node module-resolution hook that mirrors the browser import map in index.html:
//
//   { "imports": { "three": "./lib/three.module.js", "three/addons/": "./lib/addons/" } }
//
// The project's ES modules (js/dumpling-geometry.js, lib/addons/exporters/GLTFExporter.js, ...)
// import the bare specifier 'three'. Browsers resolve it through the import map; Node has no
// import map, so this hook rewrites the specifier to the vendored file. It is registered by
// tools/build-dumpling-glb.mjs via `register()` from 'node:module' (Node >= 20.6); any other Node
// script can reuse it the same way (register first, then dynamic-import the modules under test).
//
// Exports the standard `resolve(specifier, context, nextResolve)` hook. Everything that is not
// 'three' or 'three/addons/...' is passed through to Node's default resolver untouched.

const LIB_URL = new URL('../lib/', import.meta.url);
const THREE_URL = new URL('three.module.js', LIB_URL).href;
const ADDONS_URL = new URL('addons/', LIB_URL).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: THREE_URL, format: 'module', shortCircuit: true };
  }
  if (specifier.startsWith('three/addons/')) {
    const url = ADDONS_URL + specifier.slice('three/addons/'.length);
    return { url, format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
