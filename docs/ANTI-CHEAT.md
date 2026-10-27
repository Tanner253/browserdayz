# Anti-cheat: walls on the server (plan, 2026-10-27)

The owner, 2026-10-27, after a player was found running a script in their browser for ESP: "we need to prevent people
form being able to access any type of ESP and as well being able to shoot through walls"; "the server needs to keep
track of this as well as collisions, currently walls do not exist on the server"; "yes we need to do all of these
things to ensure people cannot cheat in our game". The plan card they said yes to: `progress/anti-esp/zona-plan-anti-esp.png`
(source `marketing/plan-anti-esp.html`). Build it in the order below, one phase at a time; each phase is tested by the
owner on 5173 before any deploy (CLAUDE.md). CLAUDE.md's "faster churn" rules hold: type-check, the one test that
covers it, nothing more.

## 0. Already done (commit c55d9105 on battle-royale, NOT deployed, PROTOCOL 76)
- `src/net/hook-trap.ts`, main.ts's first import: three.js hands every Scene and WebGLRenderer to
  `window.__THREE_DEVTOOLS__` if a page has one (the likely ESP route: a userscript sets it at document-start). It is
  taken away before three loads; a page that had one is reported (`bait`) and banned like `window.__game`
  (`server/admin.ts` `baited`). The official Three.js DevTools extension trips it too: pardon by hand if asked.
- `server/sight.ts` `inSight`: 'ps' (every player's position, 15 Hz) now goes to a page only for players within
  1500 m (dropped past 1600), its own party (map/compass marks) and, for an admin, everybody. 'ps' carries `out`:
  who left its sight; the page hides them (`Remote.goAway` in `src/game/remote.ts`, read in `src/game/game/online.ts`).
  `test/sight.test.ts`.
- Small fix still owed there: a remote coming back from `away` within 12 m of where it was last is walked over, not
  set down (`Remote.update`'s `tele` test). On the way back (`push` with `this.away`), set `this.pos` to the new pose.

## 1. What the server knows of the world today
- The ground: `world.heights` / `heightAt`, and `hillBetween` (`server/checks.ts:286`): a round through a hill is refused.
- Player bases: `server/solid.ts` (`BaseSolids`, shapes in `src/sim/build/solid.ts`): `walled` (shots), `blastWalled`
  (grenades, drums), `stepWalled` (moves, `server/handle.ts:109`), `wakeClear` (logging in inside a wall).
- Building places and kinds only: `server/world.ts` `buildWorldData` runs `generateWorld()` and `Buildings.plan()`
  with no renderer. No walls, rooms, rocks or props as solids. `src/sim/animal-ground.ts` has rough footprints
  (a whole building as one block): too coarse for players, who see each other through windows and doors.
- Hits: `server/handle.ts` `case 'hit'` (~266) checks range, weapon in pockets, hill, bases. Nothing for map walls.

## 2. Where the walls are in the game (the browser)
- Every static solid goes through `physics.addStatic(desc, surface, pos, rotY, owner)` (`src/core/physics.ts:81`),
  plus some direct `physics.world.createCollider` calls. Shapes: cuboids, trimeshes built from model geometry
  (buildings `src/world/buildings.ts:~3654`, bunker, caves, posts, ruins, rocks in vegetation and rock-field),
  convex hulls, a terrain heightfield. `grep -rn "ColliderDesc\." src/world src/game` lists every site.
- Each collider has a tag: `surface` (concrete, wood, rock, metal, glass...) and `thin` (`physics.ts:42`: "a round
  goes through it and flies on: a curtain, a door of boards"). Glass is in `GLASS_GROUPS` (stops players only).
  `SHOT_GROUPS` (`physics.ts:27`) is what a round meets. The wallbang rule: `src/game/weapons.ts:~4305`.
- Streamed: `src/world/rock-field.ts` makes a rock solid only within `o.solid` of the eye (`solidNow`). Check every
  other site for the same (buildings' model trimeshes may be made only as a building loads near the player).
- Doors are not static: open or swinging doors are kept apart (`physics.ts:19`). The server has its own door list
  and states (`server/doors.ts`).

## 3. Phase 1: the walls on the server
1. A dev-only page hook (`src/dev/solid-bake.ts`, run by a script `scripts/solid-bake.mjs` through
   `assets-src/_wf/me/play.mjs`, offline: `http://localhost:5173/zona?server=http://127.0.0.1:9`, PLAY_LIGHT): after
   the world is built, force every streamed solid in (rock-field and any other), then walk
   `physics.world.forEachCollider`, keep the fixed ones, and write each: shape (cuboid half extents; ball; capsule;
   cylinder; convex points; trimesh vertices + indices), translation, rotation, and its tag (surface, thin, glass).
   Leave out: the heightfield (the server has `heightAt`), players, hitboxes, items, vehicles, doors, base pieces.
2. Store a shape table plus placements (one building model placed forty times is one trimesh and forty transforms),
   gzipped, at `server/data/solids.bin.gz`, committed (Render builds from git). Its header carries a print of what
   it was made from (the world's fingerprint, `scripts/split/fingerprint.ts`, and a hash of
   `public/assets/manifest.json`). `test/solids.test.ts` fails when the file is behind; re-bake after any map or
   model change (add it to CLAUDE.md's traps once it exists).
3. `server/walls.ts`: at start-up (`server/index.ts` start order) `await RAPIER.init()` (`@dimforge/rapier3d-compat`
   0.21, already a dependency), one query-only World, every placement a fixed collider. Collision groups by tag:
   SIGHT (hides a body: not glass, not thin cloth, not foliage), ROUND (stops a round: not glass, not thin), BODY
   (stops a body: everything solid). Doors from `server/doors.ts`: a cuboid each, moved or switched off as they open.
   Exports: `seeClear(a, b)`, `roundClear(a, b)`, `stepClear(a, b)`: Rapier ray casts with the group filter, plus
   `hillBetween`-style ground checks.
4. Measure once on this machine (the card promised it; nothing more): file size, load ms, memory added (Render is
   1 CPU / 2 GB), µs per ray. If memory is too high, merge small props away (only what can hide a body counts).

## 4. Phase 2: ESP (sent only if seen), the live problem
1. `inSight` takes a `canSee(viewer, target)`; within range, a pair is seen if any line is clear (SIGHT group and the
   ground): from the viewer's eye, and 0.45 m either side (a lean), and where their velocity takes them in
   ping/2 + 100 ms; to the target's head, chest, chest 0.35 m either side, and knees, and where they are heading.
   Stop at the first clear line. Seen stays seen 500 ms (`seenUntil` per pair). Check near pairs every tick, far
   ones (over 300 m) every third. A hard limit of rays per tick: whatever is not checked in time counts as SEEN (fail
   open: nobody pops in late, and a cheater is never worse off than today).
2. Footsteps (on the card as the owner's call; they said yes to the card, so as drawn): someone behind a wall
   within 30 m who is running (not walking, not crouched) is still sent, as their steps are heard.
3. Other places positions leak, closed in the same phase:
   - `info()` in `server/players.ts` (~205) puts everybody's `pose` in the welcome and in 'join': send it only for
     those in sight; the page makes the others `away` until their first row.
   - Vehicles ('vs', `vseat` in `server/index.ts`) go map-wide with their riders: send within earshot of an engine or
     in sight, the same `out` way.
   - Check proximity voice, 'iown' (infected chasing somebody) and anything else with a player's place in it:
     `grep -n "pose\[0\]" server/*.ts`.
4. Test: `test/sight.test.ts` with a fake `canSee`; one server test with two players either side of a base wall
   (bases are solid on the server already, so no bake is needed for it).

## 5. Phase 3: no rounds through walls
1. In `case 'hit'`, after `walled(...)`: the same lenience as `walled` in `server/solid.ts` (three eyes a lean apart,
   five aims round the spot hit; any clear line lets it through) against the ROUND group. Refused: `flag(c, ...)`
   and no damage. Curtains, boards and glass pass, as in the game.
2. The same for what else is hit: animals and infected (`server/animals.ts`, the horde), base pieces (raid), and
   blasts (`blastWalled` takes the map walls too).
3. Start in watch mode (log and flag only, as `CHECKS` does) for the owner's test, then refuse.
4. Test: through a wall refused, through glass and a curtain let through, a corner peeked let through.

## 6. Phase 4: no walking through walls
1. `handle.ts:109`: `stepWalled` also asks `stepClear` (BODY group) from the last pose to the new one at knee and
   chest height (a capsule cast of 0.25 m if rays let corners through). Refused: put back, as for bases. Server
   moves (respawn, admin teleport, vehicles, ladders) are not judged.
2. `wakeClear` (logging in inside a wall) takes the map walls too.
3. Watch mode first; test: a step through a wall put back, a doorway walked through.

## 7. Each release
PROTOCOL raised when the wire changes; `server/restart-note.json`; a changelog entry with pictures that does not
say how the checks work; never WORLD_REV (nothing here moves the ground or loot). Deploy only on the owner's word
after they test (`node scripts/deploy.mjs`).
