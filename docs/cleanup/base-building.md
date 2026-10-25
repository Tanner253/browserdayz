# Base building (`claude/base-building-d2c3d5`): what is to be replaced or is dead

Format: docs/cleanup/README.md. Taken over from docs/cleanup/navigator.md (its base-building lines) on 2026-10-25.

## Waiting for their replacements (to go once each is judged better and merged)
- [ ] drawn door leaves: `door()` box and dress in `src/sim/build/solids.ts`, and the shutters', hatch's and gates' leaf boxes | replaced by the Higgsfield leaves `assets-src/incoming/higgsfield/doors/*_leaf.glb` and `garage_door_slab.glb` | - | the leaves' draw path loads only the GLBs
- [ ] the leaves' iron drawn as a second group: `ironOf()` (solids.ts), the iron group in `leafGeometry` (look.ts), the two-material branch in `BaseDraw.rebuild` (draw.ts), paint 'iron' | goes with the drawn leaves above | 06ee01c8 | grep `ironOf`, `'iron'` in src/sim/build and src/game/building
- [ ] stand-in item models: the procedural `@torch`, `@plan`, `@codelock`, `@keylock`, `@key`, `@bag`, `@log` in `src/game/procedural.ts` (torchParts, lockParts, bagParts, logParts, the plan's roll) | replaced by Higgsfield models (`assets-src/incoming/higgsfield/items/`) | - | grep `proceduralParts(` and `'@` in src/sim/items
- [ ] borrowed models: hammer and felling_axe on the hatchet's, hand_saw on the machete's, pickaxe on the crowbar's (`model`, `tint`, `scale` in `src/sim/items/build.ts`); stone, planks, nails, sheet_metal on their present models | replaced by Higgsfield (or Poly Haven) models of their own | - | no item of build.ts names another item's model
- [ ] `torchInFist()` building the torch from `proceduralParts('@torch')` (`src/game/in-fist.ts`) | replaced by the torch's own model through the item models | - | grep `proceduralParts` in src/game/in-fist.ts
- [ ] the icon poses made for the stand-ins: `felling_axe`, `hammer` in HEAD_UP and `key_lock` in POSED (`src/ui/icons.ts`) | replaced by whatever pose each new model needs (likely none) | 262b0691 | `npm run icons -- --only <ids>`, look at each
- [ ] `claim_post_sized.glb` (generated, its flag disliked) | replaced by `claim_pirate.glb` | - | not in the manifest
- [ ] the claim drawn as boxes with a cloth flag (`claim` in solids.ts, paint 'flag') | replaced by `claim_pirate.glb`, its flag waved in the vertex shader | - | grep `'flag'` in src/game/building/look.ts

## Dead now
(none: nothing of base building is left beside a replacement yet)
