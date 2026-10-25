# Base building (`claude/base-building-d2c3d5`): what is to be replaced or is dead

Format: docs/cleanup/README.md. Taken over from docs/cleanup/navigator.md (its base-building lines) on 2026-10-25.

## Waiting for their replacements (to go once each is judged better and merged)
- [ ] drawn door leaves: `door()` box and dress in `src/sim/build/solids.ts`, and the shutters', hatch's and gates' leaf boxes | replaced by the Higgsfield leaves `assets-src/incoming/higgsfield/doors/*_leaf.glb` and `garage_door_slab.glb` | - | the leaves' draw path loads only the GLBs
- [ ] the leaves' iron drawn as a second group: `ironOf()` (solids.ts), the iron group in `leafGeometry` (look.ts), the two-material branch in `BaseDraw.rebuild` (draw.ts), paint 'iron' | goes with the drawn leaves above | 06ee01c8 | grep `ironOf`, `'iron'` in src/sim/build and src/game/building
- [ ] stand-in item models still procedural: `@keylock`, `@key`, `@plan` in `src/game/procedural.ts` (lockParts, the plan's roll) | replaced by Higgsfield models (key lock and key the Rust way, the clipboard) | - | grep `'@keylock'`, `'@key'`, `'@plan'` in src/sim/items
- [ ] borrowed models: hand_saw on the machete's, planks on `@planks` (`src/sim/items/build.ts`) | replaced by Higgsfield models of their own | - | no item of build.ts names another item's model
- [ ] the icon pose made for a stand-in: `key_lock` in POSED (`src/ui/icons.ts`) | replaced by whatever pose its new model needs (likely none) | 262b0691 | `npm run icons -- --only key_lock`, look at it
- [ ] `claim_post_sized.glb` (generated, its flag disliked) | replaced by `claim_pirate.glb` | - | not in the manifest
- [ ] the claim drawn as boxes with a cloth flag (`claim` in solids.ts, paint 'flag') | replaced by `claim_pirate.glb`, its flag waved in the vertex shader | - | grep `'flag'` in src/game/building/look.ts
- [ ] the wall torch drawn as boxes (`torch_wall` in solids.ts) | replaced by the torch's own model on a bracket | - | grep `torch_wall` in solids.ts

## Dead now (deleted)
- [x] the procedural log, torch, sleeping bag and code lock (`logParts`, `torchParts`, `bagParts`, the code lock's branch of `lockParts`, their materials, in `src/game/procedural.ts`) | replaced by the Higgsfield `log`, `torch`, `sleeping_bag`, `code_lock` models (scripts/assets.config.mjs) | this commit | grep `'@log'`, `'@torch'`, `'@bag'`, `'@codelock'`: none
- [x] `torchInFist()` building others' torch from the procedural one (`src/game/in-fist.ts`) | replaced by the torch's own model, fetched as the game starts (`Game.torchModel`, `makeHeld`) | this commit | grep `torchInFist`: none
- [x] the stand-ins' scales and tints on stone, nails, sheet_metal, felling_axe, hammer, pickaxe (`src/sim/items/build.ts`; the hatchet's, crowbar's, a cardboard box's, a boulder's, `@sheet`) | replaced by their own Higgsfield models at real size | this commit | the models borrowed stay: other items are drawn with them
