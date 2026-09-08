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
