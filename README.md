# The Dumpling Club

A cozy, interactive miniature food scene built with Three.js: a steamer of very cute dim sum
(or a porcelain plate of it), a little bowl of soy sauce, and a pair of chopsticks.
Order from the menu, pick up the chopsticks, choose a dumpling, dip it, and take a bite. The others will watch.

Everything is local: no CDN, no build step, no image files (all textures are generated
procedurally), and the dumplings are small glTF binary models, one per dish, in `assets/dumplings/`.

## The menu

| Tiếng Việt | English | 中文 |
| --- | --- | --- |
| Tiểu long bao | Xiaolongbao | 小笼包 |
| Sủi cảo | Jiaozi | 饺子 |
| Sủi cảo áp chảo | Potsticker | 锅贴 |
| Há cảo tôm | Har gow | 虾饺 |
| Xíu mại | Siu mai | 烧卖 |
| Bánh bao xá xíu | Char siu bao | 叉烧包 |
| Xửng thập cẩm | Chef’s basket | 点心拼盘 |

Play takes the camera to the wooden menu. Tap a dish directly on the board to order it. The printed 3 / 5 / 8 choices set the portion before ordering. Click the board at the table to return to it, or use `O`.

The experience defaults to **Vietnamese**. The small **VI / EN / 中文** switch in the upper corner changes the language immediately and remembers the choice locally. Each physical menu row always shows all three names: the current language is the headline, and the other two are smaller subtitles. Hints, character voices, tasting reactions, buttons, recording messages, and screen-reader instructions follow the same choice. Switching language preserves the order, portion, held food, and progress. Chinese uses Simplified characters.

## How a visit goes

1. **Play.** The camera moves through the stall to the physical menu; sound starts with this gesture.
2. **Choose on the board.** Hover a dish to lift its little food sample. Tap it to order, then watch the camera travel to a freshly served basket.
3. **Pick up the chopsticks.** Click or tap the resting sticks first, then choose a dumpling. Sauce → dip. Steamer → return the dumpling. Chopstick rest → put the sticks down. Anywhere else while carrying → eat. Poking a dumpling with a bare finger (before the sticks are up) only makes it hop and complain. After a few quiet seconds the resting chopsticks glow softly so a first visit knows where to start.
4. **Another round.** After the last bite, the small **Another round** button takes the camera back to the wooden menu. Tap the empty steamer to repeat the same order instead.

A small corner hint suggests the next gesture. On the phone menu it moves above the board to stay clear of the sauce bowl. Short character bubbles follow the dumplings on hover, poke and pickup, and tasting reactions appear while eating. There are no gameplay toolbars or menu dialogs; a mute button and the language switch sit in the top corners, and Play and the end-of-round Another round are the only other buttons. Facial expressions, soft movement, steam, sound, and object hover responses carry the experience: seated dumplings follow the pointer with their eyes, each chomp nudges the camera, and on Android the phone's tilt shifts the table shot a little.

## The characters

Six silhouettes distinguish the food: a gathered soup pouch, broad curved jiaozi, long golden potsticker with raised ends, plump pink har gow with fine fan folds, golden siu mai with a roe crown, and a fluffy bao with a three-part split top. The physical menu samples use the same updated geometry and skin colours.

The eight characters keep their own facial anatomy and temperament throughout a visit:

| Character | Personality and face |
| --- | --- |
| Mochi | Cheerful, round amber eyes and freckles |
| Pip | Curious, unequal tall eyes and a questioning brow |
| Dumpy | Sleepy, wide heavy lids, slow blinks and yawns |
| Bao | Cheeky, winks and a beauty spot |
| Pudding | Shy, small rosy eyes, lashes and strong blush |
| Nori | Grumpy, narrow olive eyes, thick brows and a sideways stare |
| Suki | Excitable, big starry eyes and lively movement |
| Momo | Silly, mismatched eyes, tongue faces and wobbling |

Hovering, lifting, pinching, dipping, eating, watching friends and being returned all follow the character’s temperament. Voice lines are translated into Vietnamese, English and Chinese; the first tasting reaction also describes the dish. The first piece of each type has a consistent character, and additional pieces receive different personalities.

## Live site and deployment

Play at [ibretsam.github.io/the-dumpling-club](https://ibretsam.github.io/the-dumpling-club/).

GitHub Pages deploys automatically from `main` through `.github/workflows/pages.yml`. The workflow runs the contact tests and publishes only the static runtime files (`index.html`, `css`, `js`, `assets`, and `lib`). No build service, backend, or external asset host is required.

## Run it

ES modules need to be served over HTTP:

```bash
npm start
```

then open [localhost:8080](http://localhost:8080). (`npm start` runs the tiny no-cache static server in
`tools/serve.mjs`; any static file server works.)

## Controls

Mouse and touch use the same scene gestures. Pick up the chopsticks before choosing food. A held dumpling owns the next click: sauce dips, steamer returns the food, the ceramic rest returns the food and lowers the sticks, anything else eats. Put it back before reopening the menu.

| Keyboard | Action |
| --- | --- |
| `Enter` on the welcome scene | Play |
| Arrow keys on the menu | Highlight a dish |
| `3`, `5`, `8` on the menu | Portion size |
| `Enter` on the menu | Order highlighted dish |
| `Enter` at the table | Lift chopsticks → pick → dip → bite |
| Arrow keys at the table | Choose a dumpling while holding chopsticks |
| `D` / `B` / `Esc` | Dip / eat / put back |
| `O` / `R` | Open menu / refill |
| `M` | Mute / unmute (sound starts on; the corner button does the same on touch screens) |
| `Space` / `A` / `S` | Boing / autoplay / steam |
| `V` | Record an automatic bite |
| `Esc` or a scene tap while recording | Finish recording |

The menu also exposes semantic dish and portion controls to screen readers. Their focus highlights the matching physical menu row. Scene descriptions and state announcements are visually hidden. Reduced motion follows the operating-system preference.

Recording saves a local 1080 × 1080 video, targeting 30 fps (MP4 where supported, WebM otherwise). A small red dot marks recording; a short status appears when the file is saved.

## Rebuild the model

```bash
npm run build:model
```

writes one file per dish to `assets/dumplings/<type>.glb` (body and bitten variants) from the
procedural generators in `js/dumpling-geometry.js`: a gathered-top lathe family, a pleated crescent
family, and the open-top siu mai. Attributes are quantized (`KHR_mesh_quantization`, ~0.7 MB per
dish instead of 7 MB for the old single float file). The page requests all six files at once but
only waits for the dish on the welcome table; the rest arrive behind the title screen, and any file
that fails to load is rebuilt procedurally in the browser.

## Phones

The site is tuned for a phone as much as a desktop: the renderer starts at a capped pixel ratio and
steps it down (and back up) from measured frame times, faces are painted on smaller canvases at a
lower rate, pointer hit tests use low-poly proxies instead of the 60k-triangle bodies, and the stall's
static clutter is merged into a few draw calls. Portrait screens get their own camera framing for the
welcome shot and the table.

## Layout

- `index.html`, `css/style.css` — page and styling
- `js/main.js` — boot, progressive dish loading, camera flow, render loop, autoplay and recording directors
- `js/quality.js` — device tier (face size, repaint rate, pixel-ratio limits), adaptive resolution, haptics
- `js/characters.js` — persistent facial features, blink/gaze timing, gesture reactions and translated character voices
- `js/i18n.js` — shared Vietnamese, English and Chinese text, menu name hierarchy, remembered locale
- `js/menu-board.js` — physical menu texture, miniature food samples, UV hit testing
- `js/interaction.js` — pick / dip / bite state machine (mouse, touch, keyboard)
- `js/dumpling.js`, `js/faces.js` — the dumplings and their painted faces
- `js/steamer.js`, `js/textures.js` — steamer, plate, bowl, chopsticks, procedural textures
- `js/stall.js` — the surrounding stall: counter, floor, wall, shelves, awning, sign, lanterns, stove, menu board
- `js/sauce.js`, `js/steam.js`, `js/crumbs.js`, `js/sprites.js` — ripples, droplets, steam, crumbs
- `js/audio.js`, `js/recorder.js` — synthesized sound effects, video recording
- `lib/` — three.js 0.185.1 (MIT) and the addons used

## Validation

```bash
npm test                   # 10 geometry/contact tests; no dependencies required
npm install                # browser test dependencies only
npm run test:browser        # 12 full GLB interaction cases (Chrome must be installed)
npm run test:ui             # physical menu, gestures, sound, keyboard, axe, phone layouts, reduced motion
npm run test:scenes         # responsive camera continuity and scene screenshots
npm run test:i18n           # all three languages, real menu drawing, live switching, full round, layouts and persistence
npm run test:characters     # silhouette differences, temperament diversity, translated voices and portrait renders
```

Start `npm start` before browser tests. `TEST_URL` overrides the preview URL. UI screenshots go to `/tmp/dumpling-qa`. Browser tests use a separate headless Chrome profile.

`js/contact.js` constrains the animated mesh against the curved bowl interior and computes the two chopstick contacts from the mesh cross-section. Sauce coating measures vertices that actually touch the liquid, so a tilted crescent can be coated even when its origin is above the surface. The controller and food attachment are synchronized in the same frame. This is a constrained animation system, not a general rigid-body physics engine.

Be Vietnam Pro (including Vietnamese diacritics), DM Sans and Fraunces are bundled in `assets/fonts/` with their SIL Open Font Licenses. Chinese uses the device’s available CJK fonts. No runtime font or asset requests leave this site.
