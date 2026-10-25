# Reclaim gear and the dropped held item (`claude/reclaim-gear`)

The owner, 2026-10-25: "button on corpse small that auto takes everything and fills all equipment and back slots from the body"; "Item in hand when a player dies should drop on the ground like rust".

Nothing was replaced, so nothing here is dead. Take all (`takeAll` in `src/ui/inventory-ui.ts`) and single-item takes stay as they were. What was added:

- `src/sim/reclaim.ts`: the rule for where each thing goes, built on `PlayerInventory.freeSlotFor` and `add`, with no slot named.
- `server/searched.ts` `reclaimBody`, plus the 'reclaim' case in `server/handle.ts`.
- `pid` on a player's body (`server/acts.ts` `makeCorpse`), kept through restarts (`server/keep.ts`).
- `src/game/game/reclaim.ts` (the game's side), the "Reclaim gear" button in `takeBar()`, and `Stash.own`.
- What was in the hands now goes into `fell` in `makeCorpse`, onto the ground, and no longer onto the body.

- [ ] Once every page in play speaks PROTOCOL 68, nothing is left to remove: a page of 65 never sees `own` and shows no button.
