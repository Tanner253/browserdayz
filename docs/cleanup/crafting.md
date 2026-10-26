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

Progression v3, step 2 (the trader camp, c60bd5bc):
- [x] src/sim/trade.ts (the one trader: STOCK, aDay, worth, pays, asks, sold, KEPT_ON_DEATH) | src/sim/camp.ts (four stalls, prices in scrap) | c60bd5bc | grep -rn "sim/trade" src server test api: nothing
- [x] test/trade.test.ts | test/camp.test.ts | c60bd5bc | ls test/trade.test.ts: none
- [x] the browser's book: Game.credit, jobBook, keepBook, setCredit, the credit halved on a death (drops.ts) | the server's day at the camp (server/camp.ts), scrap carried | c60bd5bc | grep -rn "setCredit\|jobBook\|KEPT_ON_DEATH" src: nothing
- [x] JobBook and bookFor (src/sim/jobs.ts) | TradeDay (src/net/protocol.ts), dayFor (src/sim/camp.ts) | c60bd5bc | grep -rn "JobBook\|bookFor" src test: nothing
- [x] the trader's shelf tabs (src/ui/shop.ts TABS) | each stall's own shelf | c60bd5bc | grep -n "shop-tabs\|TABS" src/ui/shop.ts: nothing
- [x] Traders finding the shop at the trading post itself (src/game/trader.ts) | campLayer (src/sim/camp.ts) gives every stall's trader | c60bd5bc | grep -n "sites.filter" src/game/trader.ts: nothing
- [x] the old STOCK left out of the server's guarded things (server/index.ts GUARDED) | what the stalls sell is issued by the server; only the gas mask stays out, for those already bought | c60bd5bc | grep -n "STOCK" server/index.ts: nothing
- [ ] the items' `sells` (how many a day the old trader sold; on items in guns.ts, hunt.ts, kit.ts, parts.ts, tools.ts, wear.ts, and its type in items.ts) | STALLS[...].sells in src/sim/camp.ts | c60bd5bc | grep -rn "sells: [0-9]" src/sim/items: left for the integration, as those files are other paths' too (survivors edits wear.ts)
- [ ] the browser's 'zona.jobs' (the old job book) | nothing reads it | c60bd5bc | a browser left with it keeps a few bytes; 'zona.credit' is paid out once and removed (src/game/camp.ts payBook)
- [x] the Higgsfield pistol body (three tries, each a whole pistol) | the Colt 1911's own frame (colt_1911, node `base`) | ff9975d9 | grep -rn "gun_body_pistol" public/assets/manifest.json: nothing (outside the repo: assets-src/incoming/higgsfield/gun_body_pistol*.glb, unused)
- [x] the first Higgsfield spring (read as crumpled foil) | made again (same id, spring_coil) | ff9975d9 | outside the repo: assets-src/incoming/higgsfield/spring_coil_v1.glb, unused
- [x] the trader camp's first stall, market_stall (Higgsfield text-to-3D; the owner: "the trader stand looks very low quality") | trader_stall (Meshy from a front, a side and a back picture; its atlas's holes filled) | this commit | grep -rn "market_stall" src scripts public/assets/manifest.json CREDITS.md: nothing (outside the repo: assets-src/incoming/higgsfield/market_stall*.glb, unused)
- [ ] upkeep's CUT (a sheet of metal left in a claim's store from before, cut up for 30 fragments when they run short) | upkeep in gathered things (KEPT_IN, src/sim/build/upkeep.ts) | this commit | a shim for live claims stocked with sheet metal: drop CUT and `pays`' use of it a wipe or two after release
- [ ] placeNear's bench use and its `lv` (the best bench level within reach) | benchAt, the bench used by F at it (src/sim/craft/places.ts; server/learn.ts useBench) | this commit | grep -rn "placeNear(.*'bench'\|\.lv\b" src server test: only test/craft.test.ts's nearness check reads them; move that check to benchAt and drop `lv`
