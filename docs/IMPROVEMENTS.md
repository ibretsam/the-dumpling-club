# The Dumpling Club · mobile and motion revision · September 8, 2026

The scene stays the interface. This revision makes the site open quickly and run smoothly on phones, tightens the phone framing, and adds a few small interactions and camera touches. Interface text remains minimal (a tiny eyebrow line and a muted tagline on the welcome screen, a quiet hint); the character bubbles and tasting reactions are kept and slightly polished.

## Loading

- The single 7 MB float `assets/dumplings.glb` is replaced by one quantized file per dish in `assets/dumplings/` (`KHR_mesh_quantization`; 690–875 KB each, 4.5 MB in total). `npm run build:model` writes and verifies them, including the decode error against the float geometry (≤ 1.5e-5 units).
- All six files are requested the moment the page boots, but the welcome table only waits for its own dish. The other five arrive behind the title screen; the menu mounts each food sample as its dish lands, and ordering a dish whose file is still downloading simply waits at the table. A failed download falls back to the procedural generator for that dish, as before.
- The loader shows real download progress. `modulepreload` hints for three.js and the loader, and a `preload` for the first dish, start the large downloads before the module graph is discovered.

## Runtime performance (phones first)

- `js/quality.js`: the device tier sets a pixel-ratio cap (1.5 on phones, 2 elsewhere), 320 px face canvases repainted at most 20 times a second on phones (512 px / 30 Hz on desktop), and an adaptive-resolution governor that steps the pixel ratio by 0.25 from measured frame times (down after one slow window, up after three fast ones, with a cooldown so it never oscillates).
- Pointer hit tests raycast a hidden low-poly ellipsoid per dumpling instead of the 60k-triangle body, so hover and taps stay cheap.
- The stall's static clutter and the steamer's strips, loops and slats are merged into one mesh per material (79 fewer draw calls in the stall; the welcome frame drops from 167 to 113 draw calls including the shadow pass).
- Bubbles measure themselves once and freeze their width; positioning no longer reads layout every frame. Cursor class and hint DOM writes are deduplicated; the menu texture is redrawn once per settled resize instead of on every resize event.

## Phone UX

- Portrait framing is retuned (`FRAMING` in `js/main.js`): the table shot pulls back less and looks a little higher and forward, so the sign, basket, chopsticks and sauce all fit with far less empty foreground; the welcome shot looks lower with a smaller field of view, so less blank wall sits above the awning.
- A mute button joins the language switch in the top corners (the `M` key had no equivalent on touch screens). Both fade a little while the camera travels.
- The hint stays a 12 px line but gains a faint translucent backing and sits centred in the thumb zone on phones; the Another round button does the same. Buttons use `touch-action: manipulation` to avoid the double-tap zoom delay.
- Short haptic pulses on pick and bite where the browser supports vibration (Android).
- On Android the phone's tilt shifts the table camera slightly (no permission prompt is ever shown; iOS keeps a gentle camera breath instead). Reduced motion disables all of it.

## Interaction and animation

- Poke: tapping a seated dumpling before the chopsticks are up makes it hop, blink and complain in its own voice; the neighbours glance over. Nothing is picked.
- Seated dumplings follow the pointer with their eyes whenever nothing more interesting is happening; on touch screens they glance at the tap point for a moment.
- Each chomp pushes the camera a little toward the food (with a small field-of-view pinch) on top of the existing shake.
- After a few quiet seconds at an idle table the resting chopsticks glow softly, so a first visit, especially on a phone with no hover, knows where to start.
- The vignette deepens slightly during camera flights. Bubbles pop in with a small overshoot, carry a tail pointing at the speaker, shrink away, and steer around the tasting reaction while it is up. The welcome eyebrow, Play button and tagline rise in with staggered timing.

## Verification

- `npm test`: ten geometry/contact cases pass.
- `npm run test:browser`: all six dishes at portions 3 and 8 complete pick, dip, return and bite against the new quantized per-dish files: no grip drift, no shaft penetration, no porcelain intersection, and every dish acquires sauce.
- `npm run test:ui`: desktop physical-menu hover, portion choice, ordering, sound unlock/mute, chopstick pickup, empty/loaded holder return, pick/dip/return/eat, reopening the board, keyboard interaction and empty-steamer refill pass; axe WCAG 2 A/AA and 2.1 AA report no violations at the table (the mute button is part of the audited page). The complete touch loop passes at 390×844, 320×568 and 844×390, and reduced motion passes.
- `npm run test:scenes`: camera continuity holds with the retuned portrait framing (largest per-frame field-of-view step 0.47°, largest arrival jump 0.016 units).
- `npm run test:i18n`: Vietnamese default, saved/invalid/blocked storage, three names on every menu row, translated voices and hints (including the new poke lines and the tagline, eyebrow and sound labels), switching with held food, a complete round and the return to the menu pass at all four sizes; bubbles stay inside the viewport and never overlap. The bubble width freeze initially caused an extra wrapped line on phones; one extra pixel of width fixed it and the suite was re-run.
- `npm run test:characters`: silhouettes, temperaments, trilingual voices and portrait renders pass with the dishes reported as loaded from the GLB files.
- Measured in the in-app browser: the welcome frame draws 113 calls instead of 167; the first dish file is 690 KB and is fetched exactly once (the preload is reused); a 375×812 viewport starts at pixel ratio 1.5.

Touch checks use Chrome emulation; a physical iPhone/Android remains unverified, so the tilt parallax (Android only) and haptics were checked for guarded code paths, not felt on a device.

---

# The Dumpling Club · scene revision · September 8, 2026

The experience now lives in the miniature stall. Play opens the physical menu; a small Another round button appears after the last bite and returns to that menu. The toolbar, kitchen panel, menu dialog, bottom action panel, remaining-food counter, and help/round dialogs remain removed. At the user’s request, short character bubbles, tasting reactions, and a quiet 12px contextual hint in the bottom corner are present.

## Visit and interaction

- Play unlocks the audio, which is enabled by default, and moves the camera to the wooden A-frame menu.
- The menu itself is interactive. UV hit testing maps each pointer/tap to the row drawn on the paper. The food samples use the same GLB geometry as the basket and lift/turn on hover. Portion choices are printed on the board. Tapping a dish adds a brief order stamp, then moves to the table and serves the food.
- Tap/click the resting chopsticks first, then a dumpling to pick it up. Click the sauce to dip, the steamer to return the food, or the ceramic rest to put the sticks down. If carrying food, the rest gesture safely returns it before lowering the sticks. Any other click while carrying eats. Mouse and touch follow identical rules; slender props have a small screen-space hit margin for touch.
- A carried dumpling owns the next table gesture. Put it back before clicking the wooden menu to choose again. The keyboard menu shortcut returns held food first.
- After the last bite and chopstick return, Another round appears in the bottom corner. Clicking or tapping it flies back to the physical menu. It is hidden during a serving, camera travel, autoplay, and recording. Tapping the empty steamer still repeats the current order; no empty-basket dialog interrupts the scene.
- Food responds through eyes, expressions, gentle hops, and crowd reactions. Hover and pickup show short character bubbles, limited to two at a time; eating shows a brief tasting reaction. Labels follow the food, stay inside the viewport, do not intercept clicks, and clear when leaving the table or refilling. Reduced motion keeps them readable without animation. Selection halos belong to the scene. Sauce, steam, crumbs, and synthesized effects remain animated.
- Sauce coating persists when a dumpling is returned and picked up again. Food cannot be picked during its serving-scale animation.

## Camera, type and access

- Camera travel blends the responsive table framing throughout the flight. Portrait framing no longer snaps on at arrival. The menu camera fits the board to viewport width and height.
- Local Fraunces is used for the display headings; Be Vietnam Pro supplies complete Vietnamese accents for the menu and small interface text. Chinese uses system CJK fonts. Every menu row keeps all three language names visible, including landscape; short landscape screens enlarge the selected headline.
- There is no HTML menu overlay. Visually hidden semantic menu controls provide screen-reader access; their focus highlights the matching board row. The canvas retains keyboard controls and state announcements.
- A quiet hint in the bottom corner changes with the current gesture and hides during scripted food movement. The hint yields its place to Another round when the steamer is empty.
- Sound starts on the first Play interaction. M toggles mute. OS reduced motion disables sample bobbing and softens/shortens camera and food animations.
- Recording remains available with V. A small red dot indicates capture; Escape or a scene tap stops it. Gameplay controls cannot reset an active recording.

## Languages

- Vietnamese is the default. VI / EN / 中文 switches language without changing the camera, order, portion, held food, sauce, or round. A valid choice is saved locally; missing, invalid, or unavailable browser storage falls back to Vietnamese.
- The physical board shows Vietnamese, English and Simplified Chinese for every dish. The selected language appears first in bold; the other two appear on separate smaller lines. The menu title follows the same hierarchy, with its two subtitles on one line.
- The Play and Another round labels, small gesture hints, character bubbles, tasting reactions, screen-reader menu controls and instructions, and recording/status messages are translated from `js/i18n.js`. Brand and character names remain proper names.
- Language buttons have 44px tap targets, native-language accessible names, an active underline and `aria-pressed` state. On portrait phones the menu hint sits above the board, clear of the dark sauce bowl.

## Character revision

- Rebuilt the local GLB’s six bodies and bitten variants. Jiaozi are broader and thinner, potstickers longer and lower with golden blistered skin, har gow plumper and pinker with radiating folds, soup dumplings have a more pronounced gather, bao have a three-part split top, and siu mai have a richer yellow wrapper. The menu samples share these models and colours.
- Eight persistent facial styles add distinct eye proportions, asymmetric eyes, iris colours, freckles, lashes, blush marks, heavy brows and cheek sparkles. They remain recognisable when expressions change.
- Per-character gesture responses replace the shared surprised/scared sequence. Slow sleepy blinks, curious double blinks, shy glances, grumpy side-eyes, excited motion and different dangling energy carry the personality through the visit. Reduced motion still suppresses hops and softens movement.
- Character-specific hover, pickup, dipping, return and audience dialogue is available in all three languages. Tasting reactions also follow the dish. Each type’s first piece has a consistent character, while extra pieces use other available personalities.
- Sauce coating now checks actual surface contact with the liquid instead of the dumpling origin. The longest potsticker has gently raised ends so it can reach the soy without intersecting the rim.

## Contact fixes retained

The chopstick rig derives supporting contacts from the animated mesh, accounting for portion scale and rotation. Shafts fan out above the shoulders, and the shorter tip extension clears the food's base. Scripted movement follows its tween directly; pointer movement retains damping. Food is attached after the chopsticks and body update in the same frame.

Dipping is shallow and checks the animated body against the table and curved porcelain profile, including the rim. Putting food back restores its seated quaternion. Sauce updates once per frame, and completed crowd timers are released. These are animation constraints, not a general rigid-body simulation.

## Verification

- `npm test`: ten geometry/contact cases pass.
- `npm run test:browser`: six loaded GLB types at portions 3 and 8 complete pick, dip, return, and bite sequences. The sampled checks report no grip drift, shaft penetration, or porcelain intersection; every type also acquires sauce at both portion sizes.
- `npm run test:ui`: desktop physical-menu hover, portion choice, ordering, sound unlock/mute, chopstick pickup, empty/loaded holder return, pick/dip/return/eat, reopening the board, keyboard interaction, and empty-steamer refill pass. Axe WCAG 2 A/AA and 2.1 AA checks pass at the table.
- The physical-menu and full touch gesture loop passed at 390×844, 320×568, and 844×390 in the scene revision. The character revision reran the complete touch loop at 390×844 and the language/order/eating/next-round journey at all four desktop and phone sizes. Reduced-motion checks pass, with no page runtime errors in the completed runs.
- `npm run test:characters` measures the loaded GLB silhouette differences, checks at least five different temperaments per shared event, validates every character voice in all three languages, and renders the six dishes and eight faces for visual review.
- `npm run test:i18n` verifies Vietnamese default, saved/invalid/blocked storage, all three names painted on every menu row, translated voices and hints, switching with held food, a complete eating round and a real return-to-menu click/tap at 1440×1000, 390×844, 320×568 and 844×390. The 320px run uses reduced motion. It also checks bubble bounds/overlap and Chinese table accessibility with axe.
- `npm run test:scenes` checks responsive camera continuity and captures the welcome, physical menu, and table at the tested viewport sizes.

Touch checks use Chrome emulation; physical iPhone/Safari remains unverified. The video encoder was verified in the earlier contact/UI revision; this revision retains it but does not repeat an export test. The character revision rebuilds the existing procedural GLB pipeline; it does not require Blender edits.

## Previews

- [Six distinct dishes](qa/characters-dishes.png)
- [Eight personalities](qa/characters-personalities.png)
- [Different reactions after dipping](qa/characters-dipped.png)

- [Vietnamese menu](qa/menu-vi-1440.png)
- [English menu](qa/menu-en-1440.png)
- [Chinese menu](qa/menu-zh-1440.png)
- [Three-language phone menu](qa/menu-vi-390.png)
- [Vietnamese character reaction](qa/pick-vi-390.png)
- [Chinese eating reaction](qa/eat-zh-390.png)
- [Another round on phone](qa/round-zh-390.png)

- [Welcome](qa/title.png)
- [Physical menu](qa/menu.png)
- [Table](qa/table.png)
- [Dipping](qa/dip.png)
- [Phone table](qa/mobile-390.png)
- [Phone menu](qa/mobile-menu.png)
- [Landscape menu](qa/landscape-menu.png)

This directory is not a Git repository. The previous revision was copied to `/tmp/dumpling-scene-first-backup/` before these edits; the earlier original backup remains at `/tmp/dumpling-improvements-backup/`.
