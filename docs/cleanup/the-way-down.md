# The way down

- [ ] the `boxcar` and `rail_track` models, their rows in `scripts/assets.config.mjs` and the manifest, `boxcar` in `SOLID` (src/world/vegetation.ts) | the train on its line (src/game/train.ts, src/world/tunnel.ts, src/world/station.ts) | the train's commit | grep for both in `src` and `scripts`
- [ ] the `Kupol Siding` town row in `src/sim/outposts.ts`, now with nothing in it | the Kupol station | the train's commit | kept for now so that what is laid after it keeps its numbers: delete only with the numbering checked (`test/loot.test.ts`)
- [ ] `concretePaint` uses in `src/world/bunker.ts` that no longer show: `inside` and `floor` are only the stair and door pieces now | the finishes in `src/world/bunker-deep.ts` | 2026-11-01 | check what is still drawn with them first
- [ ] `private hallOfWings` deck colours and the `steelPaint` greys if the finishes replace them | the same | 2026-11-01
- [ ] `assets-src/incoming/higgsfield/toys/radar_dome_uncut.glb`, `vault_door_raw*`, `radar_dish_raw*` | the cut and sized copies | 2026-11-01 | not in the repo, on this machine only
- [ ] `Made` kind `generator` on Level 2 is hand-made shapes standing for a real thing; replace it with a model when the plant is next touched | CLAUDE.md, "real, downloaded models only" | 2026-11-01


- The mine's bulbs (2026-11-01): gone with their sheet of pools; `TORCH_EVERY` in `src/world/mine.ts` is what lights it now. Nothing left to delete.

- Hand-made generators (2026-11-01): the bunker's now the model `diesel_genset`, the fort's the model `portable_generator`; both old shapes are gone from the code. `rocks_ground_02` stays for the terrain; the mine uses `rock_wall_10`.

- Room dressing (2026-11-01): `src/world/bunker-dress.ts` is drawn only by the game, so nothing there needs the server. The kit's first `mop_bucket` Higgsfield job was not used: the id already had a downloaded model. Nothing left to delete.
