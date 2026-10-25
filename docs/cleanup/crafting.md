# Cleanup catalog: crafting

The crafting path's list (format: docs/cleanup/README.md on battle-royale). One line for each thing crafting makes dead, written in the commit that makes it so.

`- [ ] <what is now dead> | replaced by <what> | <commit> | <how to check nothing still uses it>`

- [x] model cloth_pile (Large Pile Of Cloth, the rags) | replaced by rags_bundle (Higgsfield: torn strips, not whole clothes) | step 4 | grep cloth_pile src scripts public/assets/manifest.json: nothing
- [x] model rope_coil (Rope Knots, untextured, tinted) | replaced by rope_coil_hemp (Higgsfield: a coil of hemp) | step 4 | grep "'rope_coil'" src scripts: nothing
- [x] model sledgehammer_01 (Poly Haven, yellow fibreglass) | replaced by sledgehammer_slim (Higgsfield: wood, a slim handle) | step 4 | grep sledgehammer_01 src scripts public/assets/manifest.json CREDITS.md: nothing
(Their files, far copies and computer copies deleted with them; their credits taken out.)
- [x] the workbench's nails recipe (an iron bar into 20 nails) | none: nails are loot-only (the owner, 2026-10-25: "they must be looted which is hard and time consuming") | progression v3, step 1 | grep "bench(.*'nails'" src/sim/craft: nothing
- [x] scrap smelted at the forge and knocked off wrecks | metal fragments (`MAT.frags`, src/sim/craft/materials.ts); scrap is the currency now, found in loot | progression v3, step 1 | grep "'scrap'" src/sim/craft server/forge.ts server/salvage.ts: only materials.ts
- [x] the recipe card's `near` (whether a bench or a forge is near) | `where` (why not here: no bench, too low a bench, no forge) | progression v3, step 1 | grep "near?: (at" src/ui: nothing

Before step 4 nothing in the repository was dead. What was tried and dropped in step 2 was taken out before it was committed:
the two other scrap models (Skipperino's, Zuckergelee's), Poly Haven's cleaner_tin_01 (beside Higgsfield's gunpowder tin)
and Higgsfield's first sledgehammer (beside Poly Haven's sledgehammer_01); in step 4 Poly Haven's barrel_stove (beside Higgsfield's forge): no file, manifest entry or credit of them is left.

Outside the repository (assets-src is never deleted, but these are not used): assets-src/incoming/scrap_metal_1,
scrap_metal_lowpoly and charcoal_bag_photoscan_medpoly (Kingsford's print all over it), sledgehammer_sized.glb, and assets-src/models/cleaner_tin_01, sledgehammer_01 and barrel_stove. Kept: the higgsfield forge_sized.glb (forge_cold.glb is made from it by progress/crafting/cold-forge.mjs).
