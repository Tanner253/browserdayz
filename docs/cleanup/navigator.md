# Navigator: replacements known as the paths start (2026-10-25)

Each line becomes dead once its replacement is judged better and merged. The path that replaces it ticks or moves the line into its own file.

## Base building (`claude/base-building-d2c3d5`)
- [ ] drawn door leaves (`door()` box and dress in `src/sim/build/solids.ts`) | replaced by the Higgsfield leaves `assets-src/incoming/higgsfield/doors/*_leaf.glb` and `garage_door_slab.glb` | - | the leaves' draw path loads only the GLBs
- [ ] stand-in item models (log, planks, stone, nails, sheet_metal, hand_saw, felling_axe, building_plan, hammer, code_lock, key_lock, sleeping_bag, torch, key, pickaxe) | replaced by Higgsfield models (`assets-src/incoming/higgsfield/items/`) | - | no item points at a stand-in model; unused entries leave `public/assets/manifest.json` and their files go
- [ ] `claim_post_sized.glb` (generated, its flag disliked) | replaced by `claim_pirate.glb` | - | not in the manifest

## Crafting (`claude/crafting`)
- [ ] stand-in models and blank icons of the new items | replaced by the Poly Haven or Higgsfield pick for each | - | `npm run icons` leaves no blank tile

## Survivors
- [ ] `folded_blanket` as the field jacket and trousers model (`src/sim/items/wear.ts`) | replaced by worn and crumpled clothing models | - | grep `folded_blanket` in the items
- [ ] the Quaternius bodybuilder base and its reshaping in `scripts/build-character.mjs`, the military suit in `scripts/suit.mjs` | replaced by the four Higgsfield survivors | - | `npm run character` no longer reads `assets-src/characters/src`
- [ ] `speak()` through the browser's speechSynthesis (`src/core/audio.ts`) | replaced by recorded Higgsfield voices | - | grep `speechSynthesis`
- [ ] `CLOTHES` spawn kit of field jacket and trousers (`src/sim/items.ts`) | replaced by DayZ basics | - | -

## Movement
- [ ] hips-twist sideways walking and the reversed forward clip for backing (`src/game/avatar.ts`, "which way the legs point") | replaced by 8-way motion capture | - | -
- [ ] Quaternius walk/jog/run blend and the eased idle (`scripts/build-character.mjs`) | replaced by motion-captured locomotion | - | the clips leave survivor.glb
- [ ] hand-made swings in `src/game/arms.ts` for held things without packs | replaced by motion capture on the body's arms | - | -

## Shared scratch
- [ ] `progress/tools/*.mjs` helpers (plain-body, fit-box, slab, scale-glb, glb-stats, inspect, claim, sheet) | git-excluded; promote any that a build step needs into `scripts/`, delete the rest | - | -

## Texture sizes (2026-10-25, the owner: 1024 for bodies, clothes, the infected and held things; 512 for the rest)
- [x] `DESK_UP` / `DESK_UP_MODELS` (Kamenka's two buildings a size up) in `src/core/assets.ts` and `UP` / `UP_FILES` in `scripts/lean.mjs` | replaced by DESK_CAP 512/256 for every model | removed | grep `DESK_UP\|UP_FILES`
- [x] computers' 256/128 copies of files no phone draws far (bodies, trees, kits) in `public/assets/lean/256-128/` | swept by `npx tsx scripts/lean.mjs` (it now makes 512/256 for computers, 256/128 only for a phone's far things) | removed | `npx tsx test/lean.test.ts`
