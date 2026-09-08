# The Dumpling Club — module contract

A cozy miniature food scene in Three.js. Everything is a local ES module. `index.html` declares an import map:

```json
{ "imports": { "three": "./lib/three.module.js", "three/addons/": "./lib/addons/" } }
```

So every module imports `import * as THREE from 'three'` (three 0.185.1, vendored in `lib/`). No CDN, no npm at runtime, no build step. Plain JavaScript (no TypeScript). Use `MeshPhysicalMaterial` / `MeshStandardMaterial` for lit surfaces. The renderer uses `ACESFilmicToneMapping`, `outputColorSpace = SRGBColorSpace`, `PCFSoftShadowMap`. Colors are created with `new THREE.Color('#hex')` (three converts sRGB hex to linear automatically). Textures that carry color must set `texture.colorSpace = THREE.SRGBColorSpace`.

Shared modules already written (import them, do not rewrite them):

- `js/config.js` — `COLORS`, `DUMPLING`, `STEAMER`, `PLATE`, `BOWL`, `CHOPSTICKS`, `LAYOUT`, `arrangement(count)`, `PERSONALITIES`. Read it; all sizes below come from it.
- `js/motion.js` — `motion` singleton: `{ reduced, steam, sauce, sound, timeScale }`. Every animated module must respect `motion.reduced` (no overshoot/bounce, no idle hops, calmer/slower particles, shorter transitions). Do not read `matchMedia` yourself.
- `js/tween.js` — `tween({from,to,duration,ease,delay,onUpdate,onComplete})` returning a handle with `.cancel()` and `.promise`; `Ease.*`; `updateTweens(dt)` (called once per frame by main.js — never call it yourself); `wait(seconds)`; `cancelAllTweens()`; `clamp`, `lerp`, `smoothstep`, `damp`.

## World

- Units: 1 unit ≈ 10 cm. Y is up. Table top is `y = 0`. The camera sits at +z, slightly right and above, looking at the scene; dumpling faces point toward +z in object space.
- Every builder returns objects positioned at their **own local origin on the table** (their `y=0` is the table). `main.js` positions the groups using `LAYOUT`.
- Every builder sets `castShadow` / `receiveShadow` appropriately on its meshes. Keep polygon counts moderate (the whole scene should stay under ~250k triangles). Everything that is not obviously static should expose an `update(dt, time)` method.
- Procedural textures are generated with `<canvas>` at runtime (no image files). Put shared texture generators in `js/textures.js`. Keep canvases ≤ 1024px. Use `texture.anisotropy = 4` where useful.

## Module APIs

### `js/dumpling-geometry.js` (pure geometry, must also run under Node)
```js
export function buildDumplingGeometry({ segmentsU = 128, segmentsV = 80 } = {}) // -> THREE.BufferGeometry (position, normal, uv, index)
export function buildBittenGeometry(opts) // -> THREE.BufferGeometry with an additional 'color' attribute (RGB float), same UV layout
export const DUMPLING_METRICS // { radius, height, bodyHeight } equal to config.DUMPLING
```
Shape: a cute xiaolongbao / soup dumpling — squat, soft body, gently flattened base (bottom sits flat on the table at y=0), pleats that gather and spiral into a little twist knob at the top. Origin at the base center. Max half-width `DUMPLING.radius`, total height `DUMPLING.height`. Face region (front, +z) must be smooth (pleat displacement fades out below ~55% height). UVs: u wraps around (u=0.5 exactly at +z / front), v from 0 (base) to 1 (top of the knob) — the face is painted in the UV rect `DUMPLING.faceUV`, so that rect must map to the front-middle of the body with no visible seam or stretching. The bitten geometry has a spherical "bite" chunk removed from the upper-right-front (as seen from the camera, roughly at object-space direction normalize(0.55, 0.55, 0.65)) with a smooth crater; crater vertices are colored `COLORS.filling` (juicy filling) and the rest `#ffffff` (so `vertexColors` multiplies the dough map by white). Normals must be smooth and correct (recompute after displacement). Must be importable from Node with `import * as THREE from 'three'` resolved by the build script (see below), so no DOM access in this file.

### `tools/build-dumpling-glb.mjs` (Node ≥ 20, run with `node tools/build-dumpling-glb.mjs`)
Builds both geometries, creates a `THREE.Group` named `DumplingClub` with two meshes: `DumplingBody` (MeshPhysicalMaterial, color `COLORS.dough`, roughness 0.55, sheen) and `DumplingBitten` (same material but `vertexColors: true`), exports **binary glTF** to `assets/dumpling.glb` using `lib/addons/exporters/GLTFExporter.js`. Resolve the bare `'three'` specifier for Node either by a `package.json` `imports` map or by `--import` of a tiny resolver hook — pick the approach that works and document it in a comment. Polyfill `FileReader` (via `Blob.arrayBuffer()`) and anything else the exporter needs. Print the file size and the names of the exported meshes; verify by parsing the GLB header and the JSON chunk (magic `glTF`, meshes present) at the end of the script.

### `js/faces.js`
```js
export class FacePainter {
  constructor({ personality, size = 512 })     // personality: an entry from PERSONALITIES
  texture                                     // THREE.CanvasTexture (SRGBColorSpace, flipY as needed so the face is upright on the model)
  paint(state)                                // redraw if `state` changed; state fields below
}
```
`state`: `{ expression, blink (0 open .. 1 closed), lookX (-1..1), lookY (-1..1), blush (0..1), mouthOpen (0..1), tilt (-1..1) }`.
Expressions (all must be implemented and clearly distinct): `idle` (personality default face), `happy`, `surprised`, `worried`, `scared`, `squint` (eyes squeezed shut, ">.<"), `wink`, `nom` (chewing / satisfied), `giggle`, `sleepy`, `dizzy`, `love` (heart eyes), `excited` (sparkle eyes), `grumpy`, `curious`, `shy`. Personality defaults: mochi=happy big smile; pip=wide curious eyes, small "o" mouth; dumpy=half-closed sleepy eyes, tiny smile; bao=cheeky wink + cat "w" mouth; pudding=shy sideways glance, heavy blush; nori=grumpy brows, flat mouth (secretly cute); suki=sparkly excited eyes, open smile; momo=tongue out, silly. The whole canvas is the dumpling's dough color base (`COLORS.dough`) with very subtle mottling/flour speckles so it can be used as the body `map`; the face is drawn inside `DUMPLING.faceUV` (convert UV rect → canvas pixels; remember canvas y is flipped relative to v). Eyes are dark glossy dots with a white highlight, cheeks are soft rosy blurred ellipses, mouths are simple clean vector shapes with a warm ink color. Blink should interpolate (eyelid covering the eye), `lookX/lookY` move the pupils. Repaint only when state actually changed (compare a serialized key); set `texture.needsUpdate = true` after painting.

### `js/dumpling.js`
```js
export class Dumpling {
  constructor({ personality, bodyGeometry, bittenGeometry, index })
  group        // THREE.Group, origin at base center; add this to the scene
  mesh         // the body mesh (userData.dumpling = this)
  personality  // PERSONALITIES entry
  state        // 'seated' | 'picked' | 'eaten'
  update(dt, time, { camera })
  setExpression(name, { hold = 0 } = {})   // hold seconds then return to idle (hold=0 keeps it)
  lookAt(worldPoint | null)               // pupils (and a tiny head turn) track a world position; null = relax
  blink()                                 // trigger a blink now
  hop(strength = 1)                       // low squash-and-stretch hop (max height ~0.035 units, "almost touching the surface"); no-op when motion.reduced (do a tiny squash instead)
  wiggle()                                // side-to-side jiggle (attention)
  setDip(level01, amount01)               // sauce coat: level = object-space height (0..1 of bodyHeight) below which the dough is glossy and soy-coloured; amount = strength
  setBitten(bool)                         // swap body geometry to the bitten one (keep material/texture)
  setHeld(bool)                           // when held: gentle dangling sway; when released: reset
  puff()                                  // eaten: scale down + fade quickly (return a promise), set state 'eaten', hide group
  reset()                                 // back to seated, unbitten, undipped, idle
  dispose()
}
```
Body material: `MeshPhysicalMaterial` with the FacePainter texture as `map`, roughness ≈ 0.5, `sheen` ≈ 0.4 with a warm sheen colour, slight `clearcoat` (0.15) — soft, matte, doughy. Implement the dip coat with `material.onBeforeCompile`: pass a varying with the object-space `position.y`, and in the fragment shader mix `diffuseColor.rgb` toward `COLORS.soy` and lower `roughnessFactor` toward 0.08 below the dip level with a soft edge (`smoothstep`), scaled by the dip amount; set `material.customProgramCacheKey` so each material compiles once. The shader uniforms live on the material (`material.userData.uniforms`). Idle life: slow breathing (scale y ±2%, x/z counter), random blinks (every 2–6 s, double blink sometimes), occasional micro-hop or wiggle (every 6–14 s, never when `motion.reduced`), subtle personality-specific idle behaviour (dumpy yawns → `sleepy` + `mouthOpen`; pudding glances away; suki bounces slightly more). Squash-and-stretch must preserve volume (scale y ↑ → x/z ↓). Blinks call `faces.paint` through interpolated frames. The `group` is what main.js positions; internal animation offsets live on a child so `group.position` stays the logical spot.

### `js/textures.js`
Canvas texture generators, each returning `THREE.CanvasTexture` with correct `colorSpace` and wrapping: `bambooTexture({width,height})` (warm tan with vertical grain, subtle knots, faint horizontal bands), `bambooDarkTexture`, `wovenTexture` (crossing bamboo strips, for the rim ties and base weave, with a matching `wovenBumpTexture` grayscale), `parchmentTexture` (off-white paper with fibres and a ring of tiny steam holes — also return `parchmentAlphaTexture` for the holes), `porcelainTexture` (near-white with a faint glaze speckle), `soySurfaceTexture` (dark with faint highlights), `softDiscTexture` (radial gradient sprite for steam/particles), `crumbTexture`, `dropletTexture`, plus `noiseCanvas(size)` helper. Keep them fast (< 50 ms each).

### `js/steamer.js`
```js
export function buildBambooSteamer()  // -> { group, floorY: STEAMER.floorY, innerRadius: STEAMER.innerRadius, update(dt,time) }
export function buildPorcelainPlate() // -> { group, floorY: PLATE.floorY, innerRadius: PLATE.innerRadius, update }
export function buildSoyBowl()        // -> { group, sauce /* SauceSurface from sauce.js */, sauceY: BOWL.sauceY, radius: BOWL.sauceRadius, update }
export function buildChopsticks()     // -> { group, left, right, setOpen(t01), tipWorldPosition(target), gripWorldPosition(target), update }
export function buildChopstickRest()  // -> { group }
export function buildTable()          // -> { group } — a large soft cream surface (radius ~14) that fades into the background; receives shadows (use a ShadowMaterial layered over a MeshStandardMaterial, or a single material that looks right against COLORS.background)
```
Bamboo steamer: **layered wooden walls** — a lower band and an upper band that overlaps it (outer wall slightly taller than inner wall, visible stacked rim), thin bamboo strips wrapping the top and bottom edges, a woven band (`wovenTexture`) around the outside just under the rim and at the base, subtle grain everywhere, and a couple of small "stitch" ties (tiny dark loops) where the strips join. Floor: parallel bamboo slats (thin boxes with gaps, chord-clipped to the circle) under a round **parchment liner** with a slightly wavy edge and a ring of small holes (alpha map) whose top is exactly `STEAMER.floorY`. No lid. Porcelain plate: a lathe profile (flat centre, gentle rise, wide rim), white glaze with clearcoat, a thin terracotta ring on the rim; top of the centre is `PLATE.floorY`. Soy bowl: small shallow glazed dish (lathe, terracotta outside, cream inside), with the `SauceSurface` inside at `BOWL.sauceY`. Chopsticks: two slender tapered sticks (light wood, darker lacquered tips of ~0.35 length), local origin at the **held end**, sticks extending toward `-y` (tips at `y = -CHOPSTICKS.length`); `setOpen(t)` pivots them apart around the origin so tip separation goes from touching (t=0) to ~0.55 units (t=1); at rest they are parallel with a gap of ~0.05. Chopstick rest: a small ceramic bar with a dip. Table: also add a very subtle radial darkening toward the horizon (vertex colours or texture) so the cream reads as a room, not a void.

### `js/sauce.js`
```js
export class SauceSurface {   // circle mesh with CPU-updated ripples
  constructor({ radius = BOWL.sauceRadius, segments = 96 })
  mesh                         // MeshPhysicalMaterial: colour COLORS.soy, roughness 0.12, clearcoat 1, slight metalness 0; lies in the XZ plane at y=0 (bowl positions it)
  addRipple(localX, localZ, strength = 1)   // expanding damped rings from a point; multiple ripples may overlap
  update(dt)                   // update vertex heights + normals only while ripples are alive
  setEnabled(bool)
}
export class Droplets {       // small dark glossy spheres with gravity
  constructor({ scene })
  spawn(worldPos: Vector3, count, { velocity, spread })
  update(dt, { sauceSurface, sauceWorldY, sauceCenter, sauceRadius, tableY: 0 }) // droplets that hit the sauce add a ripple and vanish; droplets that hit the table leave a small dark spot (fading sprite)
}
```

### `js/steam.js`
```js
export class SteamSystem {
  constructor({ origin: Vector3, radius = 0.55, count = 90 })
  object                       // THREE.Points or instanced sprites; additive-ish soft white puffs, low opacity, slow rise, gentle sway, size grows then fades
  update(dt, time)
  setEnabled(bool)             // fade out over ~1 s, not a hard cut
  setIntensity(v01)
}
```
Also `export function makeSteamBurst()`-style helper is optional. When `motion.reduced`: half the particles, slower rise, no sway.

### `js/crumbs.js`
```js
export class Crumbs {
  constructor({ scene, max = 120 })
  burst(worldPos: Vector3, count = 14, { dir: Vector3, spread })   // tiny dough crumbs + a few filling bits; gravity; fade after landing
  update(dt)
}
```
Use one `InstancedMesh` for all crumbs (tiny irregular geometry, two colours via instance colour).

### `js/audio.js`
```js
export class AudioEngine {
  constructor()
  enable()  / disable()  / get enabled
  unlock()                            // call from a user gesture; resumes the AudioContext
  play(name, { pitch = 1, volume = 1 } = {})
  get outputStreamTrack()             // MediaStreamTrack from a MediaStreamAudioDestinationNode (for the recorder), created lazily
}
```
Sounds (all synthesized, all gentle and short): `clack` (chopstick tap: filtered noise burst + small click), `lift` (soft rising whoosh), `pick` (a tiny squeak/boing as the dumpling is grabbed), `plip` (droplet), `dip` (soft "sploosh": low sine drop + noise), `whoosh` (approach), `nom` (two crunchy filtered-noise chews with a low thump), `pop` (puff/eaten), `boing` (springy sine sweep with vibrato), `chime` (soft two-note bell for reactions), `giggle` (quick three-note chirp), `gasp` (short rising breathy tone), `ui` (tiny click), `refill` (soft rising arpeggio). Master gain ≈ 0.5; a gentle master compressor/lowpass so nothing is harsh. No-op when disabled or when `AudioContext` is unavailable. Never throw.

### `js/recorder.js`
```js
export class BiteRecorder {
  constructor({ renderer, size = 1080, fps = 30 })
  static supportedMimeTypes()             // ordered probe list; mp4 (avc1) preferred, webm fallback
  start({ audioTrack = null } = {})        // switches the renderer to a fixed 1080×1080 drawing buffer (pixelRatio 1, setSize(size,size,false)), captures `renderer.domElement.captureStream(fps)`, adds the audio track if provided, starts MediaRecorder with a sensible videoBitsPerSecond (~8 Mbps). Returns { mimeType, ext }.
  stop()                                   // -> Promise<{ blob, mimeType, ext, url }>; restores the renderer size/pixelRatio (main passes a `restore()` callback in constructor options or the recorder remembers the previous size)
  get recording
  download(result, filename = 'dumpling-club-bite')  // creates an <a download> and clicks it; revokes the object URL after a while
}
```
The renderer's canvas is displayed by CSS, so main.js will style the canvas as a centred square during recording (the "live square preview"); the recorder only handles the drawing buffer, stream, MediaRecorder, and file. Handle browsers with no MediaRecorder gracefully (return `null` from `start()` and expose `static isSupported()`).

## Quality bar
- Everything must work on desktop and mobile Safari/Chrome (WebGL2). No console errors. No dependency on network.
- Add a short header comment to each file describing what it does. Prefer clarity over cleverness. No TypeScript syntax.
- Validate with `node --check <file>` (syntax) before finishing. If you can, also import-test the pure modules under Node.
