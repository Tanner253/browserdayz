# Battle royale: the plan and its work packages (2026-10-21)

## Status (branch `battle-royale`, 2026-10-21, late)
- WORKS END TO END in the real game: the door with three modes (ZONA large in the middle), the battle royale's menu
  (solo/duo/squad, find, host, join by code, board), the lobby in the waiting area with its guns, the vote, the plane, the
  jump, freefall, the canopy, landing, loot, F to take, the six slots, rounds by calibre into the reload, the circle and its
  gas, server-traced shots stopped by walls, jeeps, grenades, knock and the 10 s revive, the winner, results and the board.
- LOOK: in ZONA's own (the owner: "you took fortnite mode too literally ... toooo arcadey"): the Zone's type, ink and square
  panels; rarity a thin bar under a slot and a faint ring round a thing on the ground; the circle's edge in the gas's colour.
  Before and after, 2560x1440: `progress/br/compare-*.jpg` (and `progress/br/before/`, `progress/br/after/`).
- ENDPOINTS (the owner: "/arena still runs on the same server but for arena mode, /battleroyale runs on the same server as
  arena but is for battleroyale mode"): one server, zona-arena-1. `wss://<arena>/battleroyale` (and `/arena?w=br`, which
  today's game still asks: see the socket below), `GET /battleroyale/lobbies`, `/battleroyale/next?size=`,
  `/battleroyale/board` (each also under `/br/`); the page is zonapvp.fun/battleroyale (/br still works).
- THE SOCKET LAST (the owner: "yes we should but put it off till the end"): the game's own connection moves from
  `/arena?w=br` to `/battleroyale` with one line in src/net/client.ts, on branch `br-socket` (on top of this one). It is in
  the ZONA server's build filter, so shipping it restarts the ZONA server once (everyone keeps their place): ship it with the
  next ZONA deploy. Everything on `battle-royale` itself ships with no ZONA restart.
- LIVE 2026-10-21 (last 1dc7a65; ZONA untouched each time): the playable pass (doors, cars, health only, ZONA's look,
  cheap walls); a jump only over the map (the time until it said); others seen in freefall and under a proper canopy (made
  as the airdrop's); warm-up spawns and guns only in the open; the wheel through the slots; one open lobby a mode, filled
  first whatever its map (a page for another map goes to it and straight in); each mode's waiting and playing counts on its
  menu; the menu laid out as the Arena's; Leave the match counts a player out at once; the main menu's Arena and Battle
  Royale cards say how many are playing. Then: How to play in pictures for the battle royale and the Arena
  (`public/howto/br-*`, `arena-*`; the battle royale's shot by `tools/br/howto-pics.js`), the how-to cards sized through
  the HUD's zoom (21:9 cut them off: `tools/br/howto-look.js` shoots them at any size), and Return to Battle Royale and
  Leave the match back at its menu with the page as it is, no reload (`Game.toBr`, `BrMode.reset`).
- ON THE BRANCH SINCE, NOT DEPLOYED (the owner: "we should do this but not deploy since people are on now"): every game
  on one page, switched in place (`src/game/modes.ts`): the whole map built on every page, the Arena and the battle
  royale hiding what is outside their ground; the main menu over any page; a lobby on another map gone to in place.
  It changes `src/world/` (ZONA's build filter), so it ships with a ZONA server deploy, on the owner's word; until then
  the diff check below stops battle-royale-only deploys from this branch. Measured (`tools/modes/`): draws, triangles
  and the processor as before; the graphics card about 1 ms a frame more in the Arena's and the battle royale's main
  pass (not the gas, lights, passes or hidden geometry; not yet found).
- Deploys need no word from the owner while no ZONA path changes (the owner: "you dont need to ask me to deploy if it
  doesnt affect zona server"): `git diff --name-only origin/main HEAD -- server src/sim src/world src/net src/core
  package.json package-lock.json render.yaml` must be empty.
- MEMORY (measured locally): the arena server 262 MB at rest; one battle royale match running 309 MB; a map's walls let go
  when no lobby is on it (227 MB after). Render's free plan (512 MB) holds it; `BOT_RULES` copied from browserdayz for
  the door; nothing else changes on Render.
- Played through headless (`tools/br/br-play.js`): lobby, vote, plane, fall, canopy, landing, a door opened and closed, a
  jeep got into and driven, the pause, the end. Pictures `progress/br/play/`, `progress/br/play2/`.
- Server: `arena/br/` (rules.ts, wire.ts, loot.ts, match.ts, door.ts, solids/), served by `arena/server.ts`.
  Test: `npx tsx test/br-match.test.ts` (port 8241, 11 checks).
- Game: `src/game/br/` (mode.ts the client mode, look.ts rings/wall/plane/canopy, cut.ts the map cut), `src/ui/br/`
  (hud.ts, menu.ts, br.css); hooks in `src/game/game.ts`, `game/enter.ts`, `frame.ts`, `interact.ts`, `online.ts`,
  `weapons.ts` (the `pool` for a free reload), `src/main.ts`, `src/ui/door.ts|css`; `/battleroyale` in vercel.json and the
  dev proxy.
- Run it: launch entries `zona-arena-local` (8090) and `zona-dev` (5173), then `http://localhost:5173/battleroyale`. A
  second player needs a second browser. Headless pictures: `tools/br/br-pics.js` (how to run it is at its head).
- RELEASE: `node scripts/deploy.mjs` from `battle-royale`: the site and a push of `arena/**` (zona-arena-1 rebuilds; no ZONA
  path is changed on this branch).
- Since: jeeps (up to six a map, driver-run), grenades (stick grenades and frags in the loot, the blast judged by the server),
  the bot check at the door of the battle royale AND the Arena's wagers (`arena/br/door.ts`: the open world's course and
  judge; on with `RENDER` or `BOTCHECK`; BOT_RULES read from the host, as on browserdayz), and WALLS ON THE SERVER: every
  map's solids as the game builds them (buildings' triangles, walls, fences, the fort, rocks, tree trunks; not doors, glass
  or bushes), baked by `node scripts/br-solids.mjs` (headless game, `tools/br/br-solids.js`) into
  `arena/br/solids/<map>.bin.gz` and laid into the server's own physics at start. Run the bake again after anything on a
  map changes. (Each shot also carries how far the shooter's own game saw it go, and the nearer of the two stops it.)
  Checks: `npx tsx test/br-match.test.ts` (11: lobby, vote, plane, jeeps, loot, knock, revive, winner, board, and a shot
  through the middle of 131 of Kamenka's 152 buildings stopped by the server's walls; the rest are open sheds and towers),
  `npx tsx test/arena.test.ts` (7), `tools/br/br-look.js` and `tools/br/br-shoot.js` in the headless game.
- Known gaps: the plane is the airdrop's helicopter (a real plane model needs the owner's yes on a download); not yet
  tried on a phone, nor with 30 real players.

The owner, 2026-10-21: "this is pubg + fortnite mode, we will call it battle royale, and itll play like pubg, but we want to make it
look liek fortnite visually". Then the full go: "just build test and deploy the working battle royal with the specs ive given, do not
stop or ask for approval from me please. use the best optimization practices weve learned from development." Deploys of the site and
the arena server are allowed (they do not touch the ZONA server); a push that rebuilds `browserdayz` is not (see the hard rule).

## THE HARD RULE: the ZONA server is never touched
Render's `browserdayz` rebuilds on any push changing `server/**`, `src/sim/**`, `src/world/**`, `src/net/**`, `src/core/**`,
`package.json`, `package-lock.json` or `render.yaml`. So:
- Battle royale code lives ONLY in `arena/br/` (server and its own rules), and on the client in NEW files under `src/game/br/` and
  `src/ui/br/`, plus the menu files (`src/ui/door.ts`, `src/ui/arena-menu.*`) and the few Game hook lines named below.
- Shared folders are READ, never edited: import from `src/sim/**`, `src/world/**`, `src/net/protocol.ts`; copy into `arena/br/`
  whatever needs changing. The BR's wire messages are its own (`arena/br/wire.ts`), so `PROTOCOL` is not raised.
- No `npm install` of anything new (package.json would rebuild browserdayz).
- Exceptions found later go to the owner first.

## Decisions (the owner's answers, 2026-10-21)
1. **Money:** free to play; no dog tags, SOL or wagers ("we will add wagers in the future").
2. **Start:** lobbies of up to 30. The match starts when at least two thirds of the lobby, rounded up, vote yes
   (`ceil(2n/3)`: 2 of 3, 3 of 4, 4 of 5, 4 of 6 ... 20 of 30); at least 2 players; a full lobby (30) starts by itself. Then 10 s, then
   the plane. No bots.
   **Waiting area** (PUBG's): a small fenced area on the match's own map; random guns and ammo on the ground; fight while waiting;
   instant respawn; nothing (loot, kills) carried into the match.
3. **Maps:** random each match, one of the world cut in thirds (below). ONE shrinking circle of gas, "like fortnite exactly":
   the next circle shown, a wait, a shrink; ~5 phases; ~13-15 minutes.
4. **Slots:** 6 colour-coded slots (guns, heals, grenades; heals and grenades stack in a slot). Rarity colours from our tiers: T1 grey,
   T2 green, T3 blue, T4 purple, T5 gold. Armour, helmet and backpack in their own three slots (PUBG); the backpack raises the ammo cap.
   Ammo: a shared pool per calibre, picked off the ground (walk over = picked up), no magazines (the arena's `freeReload` with a
   finite reserve).
5. **Teams:** solos, duos, squads (4). Knock and revive in teams; no friendly fire. **F revives** (the key that adds to a party in
   ZONA); the reviver must be standing; it takes **10 seconds**. Knocked: crawl, bleed out (30 s, its own knock health); a team all
   knocked or dead is out.
6. **The world:** jeeps yes; helicopters no; the infected none; the **bot check at the door, before anyone can host, find a match or
   join a lobby** (Arena's Wagers too: it is the same server).
7. **Start kit:** every player starts with a random melee weapon (knife, machete, bat, hatchet, crowbar, shovel, pitchfork), all
   doing the same damage (Fortnite's pickaxe rule). Everything else is found.
8. **Progress:** a battle royale leaderboard of wins and kills, "and anything else that might be useful in the future": per player key,
   matches, wins, top-5s, kills, knocks, revives, damage dealt, longest kill, time alive, best place; every match's result kept as a
   row (mode, map, players, placements) for later ranks, seasons and wagers. Held in the arena server's memory; saving it anywhere
   needs a key and a store the owner chooses (the payouts store has a small write budget: never there).
9. **Hosting:** on the arena server (Render `zona-arena-1`) beside Arena ("its mostly unused for now"); the owner accepted that the
   free plan sleeps and is weak (a paid instance for 30 players) and will "swap ou tthe server url when i feel like it". The client
   reads the BR address from ONE setting: `VITE_BR_URL`, else `VITE_ARENA_URL`, else `?br=` on the page.
10. **Main menu:** three modes. ZONA large, in the centre and in front; Arena and Battle Royale smaller either side, as "the two
    arcade modes" (the owner: "we should make zona the largest and zenterpiece option").

## The three maps (world x -3840..768, z -768..768; -z is north)
| Map | Bounds (x, z) | What is in it | Built things |
|---|---|---|---|
| **Desert** | x -3640..-2300, z -740..740 | beach to the ridge: Bereg, Mys, Peski, Kalat (ruins), Karavan, Blokpost, Zavod, the pass's west mouth | 37 buildings, 357 rocks: sparse, needs BR loot spots (ruins, buttes, caves) |
| **Middle** (the green west) | x -2200..-800, z -700..700 | Pokrov, Ozerki, Lipki, Mokroye, Zastava, Bunker 17, the trading post, the pass's east mouth | 66 buildings, 7,972 trees |
| **Village** (the old square) | x -720..740, z -720..740 | Kamenka, Zelenaya Dolina, Army Camp, Military Checkpoint, Chemical Works, Orlinoye, the farms and dachas | 152 buildings, 22,218 trees |
Counts from `generateWorld()` (2026-10-21). The ridge crest (x -2250) is an invisible wall but the pass. Each map's edge: the arena's
`cutToArena` pattern (only what is within ~40 m of the box is built; a wall round it), copied into `arena/br/` for the BR.
Picture of the whole world from above: `progress/br/map-whole.png` (1536x512, 3 m a pixel; drawn by a scratch copy of the map tool).

## The circle (a first table; P4 tunes it)
| Phase | Wait | Shrink | Radius after | Gas damage/s |
|---|---|---|---|---|
| plane | ~40 s on the map | (circle 1 shown at the jump) | the whole map | 0 |
| 1 | 120 s | 90 s | 400 m | 1 |
| 2 | 90 s | 60 s | 220 m | 2 |
| 3 | 60 s | 45 s | 110 m | 4 |
| 4 | 45 s | 40 s | 50 m | 7 |
| 5 | 30 s | 40 s | 0 (moving at the end, as Fortnite's) | 12 |
About 12-13 min plus the plane. Each next circle lies wholly inside the last, centred on land a body can stand on (never sea, cliff
or the ridge). Armour does not stop gas; masks do not either. Drawn as a glowing wall at the edge, in the gas's own fog
(`src/world/atmosphere.ts`'s lines, read only).

## The plane, jump and parachute
A straight line across the map at a random angle through its middle third, ~350 m over the highest ground, ~50 m/s: ~40 s over
the map, everyone thrown out at its far edge. Everyone works out where it is from the match seed and the clock (the airdrop's
`planFlight`/`heliAt` pattern in `src/sim/airdrop.ts`, read only). Freefall ~20 m/s steered, a dive ~30 m/s, the chute opens by
itself at ~60 m (or Space), glides 5 m/s down, 12 m/s forward. The canopy is the existing `parachute` model. **The plane needs a
real downloaded model** (no plane in the assets; Poly Haven has none): Sketchfab CC-BY needs the owner's yes, so ask in one line;
until then the Apache from the airdrop flies the line.

## The look (Fortnite)
Six rounded slots at the bottom centre, each filled and glowing in its item's rarity colour, the game's own item icons
(`public/assets/icons/*.webp`), the held slot raised; ammo pools by calibre beside them; armour, helmet, backpack as three tier-coloured
badges; health and armour bars; top right the minimap with the circle, the next circle and the plane's line; alive count and kills;
the kill feed; damage numbers on hits (white, yellow for heads, blue on armour); loot on the ground with a beam of its rarity colour,
slowly turning; a pickup flies into its slot, which flashes; a dead player's things spill on the ground in a burst. The end:
"#1" for the winner (never PUBG's or Fortnite's own words), then place, kills, damage, time; then back to the lobby or the menu.
Spectate a teammate once out. The in-match "alive" figure is a game counter, not a site or film number (CLAUDE.md's "no player count"
is about pages and films).

## Sizing (measured on this machine, 2026-10-21; Render's CPU is slower)
- `generateWorld()`: 8.6 s, 287 MB peak (the arena server already makes it at start).
- The arena server at rest (`zona-arena-local`): 243 MB.
- 30 made-up players walking in one 170 m crowd on the local open-world server (`zona-server-local`, the crowd script): **1.2% of a
  core**, 424 MB (the whole open world, with its loot and infected), **19.6 KB/s down to each player**, 15 messages/s.
- A server-traced shot (Rapier ray over the whole ground heightfield + 30 bodies' hit shapes, as arena/match.ts): **36 us**; 30
  players at 10 rounds/s = 1.1% of a core.
- So a full 30-player match is a few % of a fast core; one match at a time per lobby, up to 3 at once. Bandwidth: a full 15-min match
  of 30 sends ~530 MB. Memory is the bound with building solids added: Render **Standard (1 CPU / 2 GB)** is safe; Starter
  (0.5 CPU / 512 MB) is tight; Free sleeps (a minute to wake) and has 0.1 CPU.

## What the arena server (zona-arena-1) needs
- Start command unchanged: `node --import tsx arena/server.ts` (it serves `/arena` and now `/br`, and `/br/lobbies`); build
  `npm ci --include=dev`; health `/healthz` (add `br: { lobbies, matches, players }`).
- Build filter: `arena/**` already holds every BR server file (`arena/br/**`, its solids files); nothing else to add.
- Env: `PORT`, `ORIGINS` as now; `BOT_RULES` (the same value as on browserdayz, the owner copies it) for the door's bot check;
  optional `BR_MOST` (matches at once, 3), `BR_MAX` (30). Instance: paid (see Sizing).
- Vercel: `VITE_BR_URL` optional (else `VITE_ARENA_URL`, already set). A site deploy carries the client.

## What is reused (read, not edited) and what is new
Reused: arena/'s server shape (its own service, the server traces every shot through solids with lag rewind: `hitShapes`, `rayRod`,
`poseAt`; health held by the server; 'put', 'hp', 'kit', 'tell', 'powers' words), `cutToArena`'s cut, the gas's look, the loot rules and
tiers (`src/sim/items/rules.ts`, `economy.ts`'s per-spot roll), gunplay and combat (`gunplay.ts`, `combat.ts` `hitDamage`, armour,
helmets), jeeps (driver-run), the airdrop's flight maths and the `parachute` model, the Wagers tab (`src/ui/arena-menu.ts`) and
`ArenaHud`, the bot check course (`src/sim/course.ts`), the open world's leaderboard shape (`server/queue.ts`).
New: lobbies with votes and the waiting area, parties and teams, the match clock (plane, circle), ground loot owned by the server,
ammo pools, knock and revive, spectating, results and the board; the 6-slot HUD and the look; plane, freefall and chute; the three
map cuts with loot spots; building solids for the server.

## Work packages
First, **P0, the contract** (the coordinating session, one short commit before the others start): `arena/br/wire.ts` (every BR message
both ways: lobby, vote, waiting-area respawn, match start with seed/map/plane, circle phases, ground items and pickups, ammo pools,
hp/armour/knock/revive, kill feed, results, board), `arena/br/rules.ts` (constants: MAX 30, vote `ceil(2n/3)`, min 2, slot count 6,
rarity colours, revive 10 s, melee damage), `src/game/br/parts.ts` (the interfaces P2 calls: `BrFlightPart`, `BrLootLook`). Frozen after.
Then P1-P5 run in parallel; each owns only its files, tests against `zona-arena-local` (8090) and the dev page (`zona-dev`, 5173), and
never edits a shared folder (the hard rule). Tests on ports of their own (P1: 8241-8249).

### P1: the BR server (match flow, teams, authority) [code-only: fits a cloud session]
Owns: `arena/br/server-side/*` (`lobby.ts`, `match.ts`, `teams.ts`, `loot.ts` the ground items, `ammo.ts`, `knock.ts`, `board.ts`,
`door.ts` the bot check at the door), the `/br` and `/br/lobbies` lines in `arena/server.ts`, `arena/br/README.md`, `test/br-*.test.ts`.
Does: Find match / Host (code) / Join from the list; the waiting area (random guns, instant respawn); the vote; teams from parties then
fill; the match clock (plane, jump window, circle phases and gas damage); every shot traced by the server (ground + P4's solids; until
they land, the game's own wall distance is taken as the shot's end); health, armour, knock, revive (F, standing, 10 s), deaths, the loot
spill; spectate; results; the board (decision 8); the door's bot check for BR and Wagers alike; at most 3 matches at once.
Done: `npx tsx test/br-match.test.ts` plays a 10-player duo match with scripted clients to a winner (lobby, vote, plane, drop, pickup,
shots, a knock and a revive, the circle killing a straggler, results); `test/arena.test.ts` still passes; 30 scripted clients for a
whole match on `zona-arena-local` measured (CPU, RSS, KB/s) into the README.

### P2: the client mode and the look (HUD, slots, loot glow)
Owns: `src/game/br/*` (but `flight.ts`), `src/ui/br/*` (`hud.ts`, `slots.ts`, `feed.ts`, `results.ts`, `br.css`), and the BR's hook
lines in `src/game/game/enter.ts`, `frame.ts`, `guns.ts` (as `arenaHud` is hooked today: one field, a few lines; NOT a shared folder).
Does: the mode in the page (`?br=`; the world cut to the match's map as `CUT.arena` is), the 6 slots and their keys 1-6, rarity glows,
ammo pools, armour/helmet/backpack badges, minimap circle and plane line, alive and kills, kill feed, damage numbers, beams on ground
loot, pickup flight and flash, auto-pick of ammo, the spill, knocked crawl and the F revive bar, spectate, results; an offline mock
(`?br=practice`) so it is built before P1 lands.
Done: pictures from the dev page of each screen (lobby, plane, HUD in a fight, knocked, results) sent to the owner; frame time with the
HUD on no worse than the open world's HUD (the 2026-10-18 lesson: HUD DOM cost 18-22%: draw slots on change only, never per frame).

### P3: the plane, the jump and the parachute
Owns: `src/game/br/flight.ts` (implements `BrFlightPart`), `arena/br/flight.ts` (the plane's line and the fall's numbers, pure, shared
by server and game), the plane model's intake (its own pack id; texture 2048 at most), `test/br-flight.test.ts`.
Does: the plane over the map, everyone in it (camera from it), jump key, freefall steer and dive, the chute (auto at ~60 m), landing;
others seen falling and under canopies; a skydive pose made in our own rig (`hand-animation-lessons`: each pose its own curl).
Done: a short clip (headless, `film.mjs --motion` rules: judged in motion) of a jump to landing; the landing spot within the reach the
numbers promise; plane model approved by the owner (or the Apache meanwhile).

### P4: the maps, loot tables, circle and solids
Owns: `arena/br/maps.ts` (bounds, edge walls, waiting areas, landable ground), `arena/br/cut.ts` (the cut, copied from `cutToArena`),
`arena/br/loot-table.ts` (BR items by tier with weights; ammo boxes by calibre; heals; grenades; armour, helmets, packs; per map its
spots: building spots from the economy's places, plus ground caches in the desert), `arena/br/circle.ts` (the table above and the
next-circle picker), `arena/br/solids/<map>.bin` + `scripts/br-solids.mjs` (each map's building, wall and rock colliders baked from the
game's own physics in headless Chrome: what stops a bullet in the game stops it on the server), `test/br-rules.test.ts`.
Done: a picture per map with its edge, waiting area and loot spots by tier; the picker never puts a circle on sea, cliff or ridge
(10,000 draws); the loot count per map makes ~30 players fully kitted in ~3 min of looting; solids baked, their size and load time on
the server measured. Needs this machine (headless game for the bake), so not a cloud session.

### P5: the main menu, three modes
Owns: `src/ui/door.ts`, `src/ui/door.css`, `src/ui/arena-menu.*` (and `src/ui/br/menu.ts` for the BR tab).
Does: ZONA large, centred and in front; Arena and Battle Royale smaller either side as the arcade modes; the BR panel: Solo/Duo/Squad,
Find match, Host (code), the lobby list; the door's bot check before any of it.
Done: pictures at the owner's screen size (2560x1440) and on a phone.

### After: integration (the coordinating session)
Merge P1-P5, wire P3 into P2's hook, a full match with 30 scripted clients on `zona-arena-local` and the owner's checks in the dev
page, the changelog entry with pictures, then deploy: the site (`node scripts/deploy.mjs --site`) and the arena by a push that touches
only `arena/**` and client files. NEVER a push that touches the ZONA server's filter (the hard rule): check `git diff --name-only main`
against it before any push to `main`.

## Order
P0 -> (P1 | P2 | P3 | P4 | P5 in parallel) -> integration. P2 and P5 use P0's wire and a mock until P1 lands; P1 uses ground-only
shots until P4's solids land; P3 runs offline.
