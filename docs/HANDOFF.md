# Where the work stands (handoff, 2026-10-20)

Read `CLAUDE.md` first. The 2026-10-14 notes below are history.

## THE WORK LIST (the owner, 2026-10-23: "do not lose sight of the work list at hand"; then base building, gathering, crafting, raiding)
Visual quality first; keep every performance figure (heli flight replay.mjs owner-run-2.json, 114.8 fps). Never change the
ground around buried stashes or build on them; never raise WORLD_REV. The onboarding session reviews each session's pictures
before they go to the owner. No corners cut (the owner: "We should not have cut any corners on anything"): a "not done"
list is finished before a feature is called done. Status as of 2026-10-23 evening:
- RELEASE READY, NOT DEPLOYED: branch release-1023 (worktree .claude/worktrees/release-1023, node_modules junction:
  remove it first on teardown) = battle-royale + tag custody (46d23c71) + gameplay batch (fd708221, PROTOCOL 61) +
  Kamenka seating (3633a957) + fort gaps (3156d4f0) + /stashes (73356d52, 984951b1) + the stash re-burial fix
  (1d45eb61), changelog #infected-bodies and restart note. Type-check 0; suite 126 files, the four failures fixed and
  passing alone. HELD (the owner, 2026-10-23: "Wait till all current work is ready for prod ... wait for everything"):
  ships once inventory 1b, the fort's tail, world polish (towns, desert 1-6, river/valley 7-12, approved "1 yes") and
  animals are finished and reviewed. Open-country places need the /stashes list, which needs a server deploy first.
- Animal models: Sketchfab gives files only to a signed-in account. assets-src/_wf/animals/sketchfab.mjs fetches the 14
  with the owner's own SKETCHFAB_TOKEN (run by them), or they sign in to the animals session's pane.
- Owner 2026-10-23 on the plans: "Everything looks good"; plus "the desert needs some buildings north of the river on
  spawn. And up alongside it", "The valley that runs up the map on the north side needs some buildings too maybe".
- [ ] World polish (session world-polish, local_c34bf24d): Pokrov (castle walls and corners, church, green houses off the road,
      SE buildings clipping/stairs col U), Kalat (polish ALOT + new places F/G-12), the desert (more places, more and spread
      coastal spawns), Mokroye (more buildings), Lipki (larger), the canyon (smooth, keep cliffs), the desert ruins, every
      basement entrance clear of loot containers (no floating boxes). Needs a stash-safe way to the live stash list.
- [ ] Mountain fort Orlinoye: every gap between walls closed, polish (session fort-polish, local_e1fb82cc). 3156d4f0
      (claude/fort-polish-dc07f1) reviewed: gap sightings 3,181 -> 922 (scripts/fort-gaps.ts), flight no loss; the tail next.
- World polish so far (reviewed): Pokrov kremlin whitewashed + church, Kalat stone re-laid, canyon ridge smoothed. Open:
  Pokrov close-ups (greenhouses, SE clipping, col U stairs), Kalat ledges, desert + towns plans (owner's yes), an owner-only
  /stashes command for the stash-safe list (next full deploy); ground changes in open country wait for that list.
- [x] Kamenka's red building and two-storey shack one texture step up, everywhere they stand (live, +7.6 MB card).
      The plank house floating 0.27 m in the desert (Peski, Bereg x2, Mys) is let down: claude/kamenka-textures-0e1e26
      3633a957, reviewed (progress/kamenka-textures/seat-*.jpg). It moves server loot places, so it ships with the next
      SERVER deploy; never deploy the site alone from that branch, or merge it into a branch the site goes out from first.
- [ ] Gameplay batch (session gameplay-batch, local_5deed9ae): infected loot in the body (5 min), thirst -25%, admin corpse
      delete (one / all near), admin item ESP. Done on claude/gameplay-batch-94414c (b00a1846, cbc3eade, fd708221;
      PROTOCOL 61), reviewed (progress/gameplay-batch/*.png), all tests pass; waits for a full deploy (site + server).
- [ ] Animals and hunting (session animals-hunting, local_6551ac13): DayZ/Rust mechanics, useful drops (food + hides, bone,
      fat for crafting). Plan v2 (progress/animals/zona-plan-animals.jpg) approved 2026-10-23: "download all animals and
      support them in the admin panel entities for spawning", "yes to animals icons and sounds". Building all six.
- [ ] Server-run inventory + inventory lag + container QOL (session local_cbc26f80, branch claude/kind-lewin-2891bd):
      building; the payout custody holes (client-claimed inventory before 'cash', tagSeen kept after a tag leaves) with tests.
- Several branches raise PROTOCOL (gameplay-batch 61, more to come): when merging them, give the merged tree one number.
- [x] iPhone crash (live), live disconnects (live), buried-stash leak (live), Discord/X at deaths (live).

## SITE LIVE (2026-10-23): from `d9155c5` (branch claude/kamenka-textures-0e1e26 = battle-royale 03e532e plus this)
- Kamenka's plank house (`shanty_mansion`) and red brick houses (`house_interior`) a size up on a computer, 512/256
  (assets.ts DESK_UP; the owner: "bump them up by 1 incriment"). 2.5 -> 10.1 MB on the card. Lossless 512 copies
  outweigh the files, so a computer loads those two files whole and cuts them; phones keep their 256/128 lean copies
  (lean.mjs UP_FILES). Pictures and tools: progress/kamenka-textures/ (look.js, pairs.mjs). Changelog `#kamenka-sharper`.
- NOT DEPLOYED, on the same branch after it: the plank house let down 0.27 m onto the sand at its four desert copies
  (Peski, Bereg x2, Mys; buildings.ts `seatDrop`, the owner: "the building is floating off the ground"), with its
  floors and its 48 loot places (each 0.27 lower; nothing else of the 4,243 moved). The server makes those places too:
  site and server go out together, on the owner's word ("don't deploy the server until I say"). No WORLD_REV.

## LIVE (2026-10-22 ~08:57 UTC): site, server and `main` from `de02380` (PROTOCOL 60)
- **Apply a finish** (the owner: "the apply should stick with the weapon on the server ... like rust"): the item's own
  `finish`, written only by the server; gold in hands, inventory and on the ground (test/plates.test.ts). Gold in the
  hands not yet seen in a picture. A fully server-run inventory was planned in its own session, which stopped on the
  weekly limit (resets Oct 23 5am PT).
- **Worn dog tags only while live** (server/worn.ts, PlayerInfo `tag`, 'tagged'), on the inventory figure too.
- **Admin STORE tab reworked** (chips, Gift sheet of picture cards, the numbered grid opens its holder).
- Main menu: no played-today count (now in the admin panel), no squad hour.

## Earlier (2026-10-22 ~07:55 UTC): site, server and `main` from `d635e64` (PROTOCOL 58)
- **The store** (below) is open: STORE_WALLET set, 100 gold Desert Eagles and 100 gold knives in stock. Merged from
  `claude/zona-store-a6b7b0` as 36f2c2b; on merging the server did not start (perks.ts read tags.ts's SITE_URL while
  it loaded): now `storeUrl()`. All 120 test files pass; the online and join checks pass.
- **Names and payout wallets fixed at the first cashed tag** (the owner: "admin can allow user to change from admin
  panel"): `server/pinned.ts`, kept with the world; the player panel's "Let them change" and `/unlock <name>`.
- Desert Eagle shot 0.75 -> 0.33 (19f6ec5). Four more search pages, linked from every page and the menu (About ZONA).

## THE STORE: LIVE since 2026-10-22 07:55 UTC (the notes below are from before the release)
- Paid in SOL with no wallet connected: a quote sealed to the player's account (own last digits + a Solana Pay reference),
  "I've paid" finds it on chain (read only), a pasted signature as the fallback; each signature once. `api/store.ts`,
  `api/_lib/shop.ts`, catalogue `api/_lib/shop-items.ts`; book `store/book.json` beside the payouts' (one write a
  purchase). Test `test/store.test.ts` (one real past mainnet payment read).
- VIP $5/30 d (queue pass, [VIP] purple in chat and board, Discord role by hand, no ads, gold dog tag), no-ads $1.99/30 d,
  numbered finishes (100 gold Desert Eagles and 100 gold knives at $4.99; nickel M9 and Colt $2.99), coffee. The finish is
  a gold/nickel shine texture over the guns' metal (src/game/finish.ts); every survivor wears their dog tag on the chest,
  gold on a VIP (src/game/worn-tag.ts). Admin: STORE tab (Players, Purchases, Numbered). PROTOCOL 58: needs a ZONA server
  deploy, on the owner's word; it also ships the Battle Royale (merged in).
- Before it goes live: the owner sets `STORE_WALLET` on Vercel (the public address). Ads: AdSense breaks need the owner's
  H5 Games approval (until then the death screen's "Death" unit shows); Auto ads vignette only, set in AdSense.
- Desk testing: `zona-store-dev` (vite on 5174, uncommitted launch entry) serves /api/store from `data/local-store`;
  desk.json {wallet, at, rate} buys with a past mainnet payment; `.env.local-server` adds STORE_URL=http://localhost:5174.

## LIVE (2026-10-22 ~06:20 UTC): server and `main` from `2c597e1` (PROTOCOL 57), site from `abb3d90`
- **Payouts stalled 04:02-05:29 UTC:** the paid node in `SOLANA_RPC_URL` answered reads and refused every send
  ("Internal error during preflight simulation", -32603). Now the public node is last in the list (asked only when
  the others fail, handed every payment), MAX_TRIES is 10, and a tag held for want of tries is retried
  (`triesLeft`). The 8 stuck were paid. Worth the owner asking their node provider.
- **The eighth cut-over, 05:35 UTC (`RULES8_FROM`):** 5 tags a wallet in any 24 hours (was 12); 350,000 $ZONA past
  the 10 free tags (was 100,000; `holdOf`). Tags: on a body after 20 minutes alive, cashed after 30 (PROTOCOL 57).
- **Search:** keyword title, description, canonical and JSON-LD on index.html; `robots.txt` (keeps out `/api/` and
  `/payouts`); `sitemap.xml`; landing pages `/games-like-dayz/`, `/free-fps-games/`, `/browser-battle-royale/`; `/privacy/`.
- **AdSense** (pub-6477083454892612): `ads.txt` and the meta tag live; the site is in Google's review; the EU consent
  message is published for zonapvp.fun. Ad units: "Death" slot 3773360448, "Sitepages" slot 8331552554. The owner's
  rules: no ads during play; one before the bot check and at death/respawn (H5 Games Ads 'start'/'next', the owner
  applying; else the Death unit); vignette between page loads; none for VIP. The ad script is NOT on the site yet:
  the store session puts it in.
- **For the review** (the owner: "we will not nav the user to the payouts screen anymore"): no link to `/payouts`
  and no play-to-earn on any public page or menu; the wallet is given in Settings, on its new Account page
  (`rewards.ts`, `inline`); the contract address shortened and unlabelled in ZONA's top bar; wagers and stakes off
  the menus (AdSense restricts betting). Payouts still run: the game asks for `/api/tick` when one is due.
- **The store** has its own session, zona-store (branch `claude/zona-store-a6b7b0`), waiting on the owner's yes to
  its plan: VIP $5 a month (queue pass, purple [VIP], Discord role, ad-free), a gold Desert Eagle $4.99, a coffee,
  paid in SOL by a pasted transaction signature checked on chain, logged in the admin panel.

## Earlier (2026-10-21 ~07:10 UTC): site from `2111131`, server still `0b77446`
- ba2fae9 lean model files: assets/lean/256-128/ copies by sha1 of their source; scripts/lean.mjs; test/lean.test.ts. 178 -> 132 MB
  into the game, 241 -> 188 s on Fast 4G.
- The owner's recorded heli flight (replay.mjs owner-run-2.json): 114.8 fps, against 81.1 on 19 Oct (progress/flight-1021.log).
- Changelog "Lighter, faster, smoother" with its card (marketing/x-perf-1021.html). Film 23 "Under the hood" is planned
  (the marketing session); its plan is waiting for the owner's yes.

## Earlier: site from `4f34d13` (site-only: no server, API or wire change), server still `0b77446`
Both performance tracks merged and on the site:
- Model pictures at 256/128 on computers, with no sharp copies (f23bd17; owner: "we can do C").
- Far towns and ruins drop their near copies; guns readied by what is shown (93b0431, d752d9d).
- Trees behind the eye no longer drawn; woods toned down on high (5b5264e); lighter grass (fb699c3); grass setting off for
  new players (81edbe0); loot shaders made ahead (9220e4a).
- Measured online (progress/perf-1021/report.md): game peak 6.19 -> 4.94 GB, pictures 2.71 -> 1.00 GB. fps unchanged on
  this heat-held laptop (card held at 1035 MHz). Triangles -20% in the forest and -30% in the open field
  (perf-1021/forest). The forest is pixel-bound: its per-pixel cost is the open fps lever.
- No changelog entry: the owner said "skip the banner".

## BATTLE ROYALE: LIVE since 2026-10-21 (arena server, /battleroyale); notes below are from before the release
- Works end to end: the menu (ZONA in the middle), solo/duo/squad, the lobby and its vote, the plane, the canopy, loot,
  the slots, the circle, server-traced shots stopped at walls, knock and revive, jeeps, grenades, the bot check at the
  door, the board. Status and gaps are in docs/BATTLE-ROYALE.md; tests test/br-match.test.ts and test/arena.test.ts.
- RELEASE NEEDS THE OWNER'S WORD: `node scripts/deploy.mjs` from battle-royale. main (0b77446) lacks the evening's
  site-only client files (src/core, src/world: listed by `git diff --name-only main battle-royale -- src/core src/world`),
  which are in the ZONA server's build filter, so the push restarts the ZONA server once (everyone keeps their place).
  The changelog entry and the restart note are in (from br-release).
- Render (the owner's to do, BEFORE the release): the arena service on Standard (2 GB): with every map's walls loaded it holds 813 MB at rest, past the free plan's 512 MB; copy BOT_RULES to it.

## NEXT, once both performance tracks are merged and deployed (the owner, 2026-10-21)
- **iPhone players get "a problem occurred".** A player in the community chat: "I get 'a problem occured' on ios ...
  Iphone only for me. Don't own a pc". The owner: "after both sessions pass and we get to a deploy state i wanna make sure
  this is on the todo list after, ios users error. but i dont wanan deal with this till both active tracks are done and
  merged and we are deployed". The tracks are `vram-fps` (held-server) and `frame-cost` (branch claude/frame-cost-350a15).
  Earlier iPhone history: memory notes load-and-phones-2026-10-11 (phone picture memory) and mobile-touch-support.
  **FIXED 2026-10-23 on branch claude/ecstatic-napier-41c3e5 (site only; changelog `#phones-memory`), NOT tried on a real
  iPhone.** The phone start reports (`npx vercel logs --environment production --no-branch --since 7d --query "iPhone"
  --limit 1000 --json`, lines `boot {...}`) put 26 of ~40 iPhone deaths at the stage "forest", the rest a lost WebGL context
  there or at shader compile. There the tree-card atlas was baked at 2048x3072, half floats, 4 samples: 300 MB in one go.
  Phones now (all TOUCH-gated, computers unchanged): atlas frames half size (vegetation.ts CARD_K), PHONE_CAP 512/256,
  far models from the lean copies (assets.ts leanOf), the Renderer made at the phone's own settings (main.ts; it started
  at scale 1, 4x MSAA, AO until Game.init). Measured at phone defaults, 844x390@3 (card + decoded pictures): forest stage
  589 -> 169 MB, menu 982 -> 684, in game 1641 -> 1195. Left in the page, not cut: Rapier's WASM 255 MB (2.1 M trimesh
  triangles: collisions), scene geometry ~133 MB, ~180 canvases (106 MB) that `shrink` keeps as images (iOS caps canvas
  memory). Tools and figures: progress/ios-mem/ (mem-pre.js counts card memory by boot stage; TRAP: play.mjs puts ULTRA
  settings in a fresh profile unless PLAY_GFX is given: give the phone's own, {"scale":0.85,"msaa":2,"ao":"off",...}).

## LIVE NOW (2026-10-21 ~00:47 UTC): server from `0b77446`, site from `4a8f542` (its changelog entry); PROTOCOL 56
All of `held-server` shipped: the performance round's later work (CardKeep, noclip, far-tree atlas, two forest shader
savings), the parked connection work (6e313f9), the cheat trap and anti-AFK below, and the owner's asks of 2026-10-20 night
(29bcf6e radios T4+ in places apart only, heavy snipers rarer, a .50 takes a magazine + 1 to down a heli; aba2e44 no more
sticking to cars). The forest's card cost (~22 ms at the worst spot) is still open: notes in `stall-and-card-memory.md`.

## Earlier the same night: site and server from `20e2594` (PROTOCOL 56)
Two emergency deploys from a clean worktree (`../Zona-hotfix`, branch `hotfix-no-global`), on top of the performance round
below (`76726d6`), which went live earlier the same day:
- `c721b3e`: window.__game is no longer the whole game in a player's page. Reading it bans (src/net/bait.ts; server/admin.ts
  `baited`; test/bait.test.ts). Pasted wallhack and aimbot scripts all went through it.
- `5f3844b`: Zona time counts toward a tag only while the player's own hands do something (AFK_MS 60 s; server/checks.ts
  zoneCheck, `handAt`). Report: bodies idled on the beach, flown into the Zona, and killed for their tag.
`held-server` does NOT have these two yet: merge `main` into it before any deploy from it.
Parked live reports: memory note `live-drops-2026-10-20` (bodies killed while their connection was down; pages reloading).

## PICK UP HERE (2026-10-20; branch `held-server`, NOT deployed: the owner said "dont deploy")
Before the deploys above: server from `d8e626e`, site from `f783816`. On `held-server` past both, the
performance round of 2026-10-20 (the owner: "get in the game yourself ... run real data, fix real problems ... dont
stop. and dont deploy"), every change measured in the Browser pane with 20 made-up players on the local server
(scratchpad `crowd.mts`; it must say where it stands, or the server sends it away as silent):
- `eb5d6d2` a parked helicopter no longer redraws the wider shadow maps every frame; bones worked out only when changed
  (`src/core/bones.ts`); bone branches with nothing on them left out of what three walks to draw; four stale tests.
- `424cef4` far trees and tree cards culled for a view 10 degrees wider, re-culled after a 9 degree turn (the upload
  figures in its message count whole buffers: three sends only the changed range; the frame times stand).
- `65a9a4c` textures within 500 m sent to the card ahead of first drawing (Renderer.lookAhead; LodSet.nearest).
- `a45ed03` a body overlapping the player's capsule is left out of that step's controller moves (Player.apart).
- `116ba67`, `2cb9a1c` a pose leaves what hangs from a moved joint to be worked out when asked for (setWorldQuat,
  settle): proven bit-exact with two bodies posed alike (`__eagerTurn` puts it back).
- `87afc86` bodies (players AND the infected) whose body and shadow cannot be in view rest: posed 10/s, not drawn
  (`inSight` in remote.ts; `__posedAlways` puts it back).
Measured: Kamenka with 20 players 18.4 -> 14.6 ms median in the pane. Open for the owner's word: the model buildings'
colliders are their whole visual meshes (3,460 triangles a house); the character controller costs 0.4 ms a move along
their walls; a simplified movement collider would change what stops bodies and bullets by a centimetre or two.
Tools: `__breatheWatch` (LONG_PIECES in core/breathe.ts) for work between frames; `__noAhead`, `__vegExact`; the frame
recorder and the twins proof are in `progress/perf-1020/` (recorder.js, twins.js: how to run each is at its head).

## PICK UP HERE (2026-10-19 ~07:00 UTC; branch `gun-racks`, NOT deployed: the owner holds it for one full deploy)
Live server `5716b79` (`9100439` + the bot-check fix; PROTOCOL 50; `main`, `hotfix`); live site `bc1cb91` (`site-live`).
On `gun-racks` past both, for the full deploy:
- West loot numbered alike on server and game (merge of `6a937a7`): the cellars' walls dealt as cards, not by a random
  sort. Render runs **Node 26** (package.json `engines >=20`; render.yaml's 22 is not applied), whose sort found five
  cellar places fewer, so the whole west was numbered five off every game's: "took X from 77 m away" refusals since
  04:25 UTC. Hello says the game's `lootPrint` (`lp`); the server logs `[loot] ... otherwise`, /healthz `lootPrint` and
  `lootOdd`. After the deploy read the boot line "world ready ... (print ...)" and `lootOdd`. PROTOCOL 51 (not live
  yet, so the full deploy can go on 51), LOOT_REV 28.
- Respawn: a game still dead on its screen no longer sets the server back by its body (Fettah put off 3 s after respawn).
- Bot-check log: "[botcheck] name: shot hostage failed (go 2 of 4): ...", and "shot hostage once, warned".
- Watchtowers, hunting towers, western infected, stairs boarded, beach starts (the commits of 2026-10-19).
At the deploy: a new restart note (it still says the bot fix's); WORLD_REV for the towers' ground; changelog with pictures.
Open asks (owner, 2026-10-19): the 1x red dot on every gun that takes a sight (model `assets-src/fps_red_dot_sight_game_model.zip`,
its config parked in `stash@{0}`, never brought in), Pokrov's collisions, the church bigger and furnished with army loot,
more for the swamp, the bunker gun racks through walls, every new west building looked over, the condensed-milk factory
(plan picture first).

## Before that (2026-10-19 ~04:30 UTC; deployed at 04:14 as `9100439`)
Live: `517f9a2` (PROTOCOL 49; `main`, `site-live`, `hotfix` there). Ready on `gun-racks` past it, suite run, changelog
entry "Start on the coast, walk east" with pictures, restart note written; `node scripts/deploy.mjs --dry` clean:
- Starts on the far west beach (`src/world/worldgen/coast-starts.ts`); the desert's places Peski, Karavan, Bereg, Mys
  (tier 1) and Blokpost (tier 2) with roads (`src/sim/desert.ts`); keycards only under the gas, three at once.
- Kamenka's army and police places tier 4, stocked apart as 'kamenka' (`src/sim/apart.ts`); the map works each place's
  tier out from its loot (`tierAround`), WEST/EAST either side of the tier buttons, the desert's places named.
- Dog tags kept through a restart, from a LAST WORD only (a crash's older copy would pay a cashed tag twice; no cash-in
  once stopping); owners' keys hashed (`server/tags.ts keepTags`, test/tag-keep.test.ts).
- Admins in a line of who made whom (`over` in server/gate.ts): a password login marks its role `up` = its own hash;
  a password role from before `RANKS_FROM` counts as one without the mark.
- Drinking from rivers, lakes and the swamp, bigger bottles (drink-water branch); eight west jeeps, cars left 2 h taken
  away, every vehicle marked on both maps (UAZ green, police blue, helicopter black) (west-cars branch). Both merged.
- Payouts' SEVENTH cut-over (`RULES7_FROM` 2026-10-19 04:00 UTC, owner's word "12 hour"): past the free ten, a tag whose
  wallet holds < 100k waits up to 12 h and is paid once it holds them; refusals of the last 12 h reopen (one write).
At the deploy: WORLD_REV 30 sets down afresh ONLY whoever stood in the desert (REMADE in server/keep.ts); PROTOCOL 50
asks open pages to reload; tags carried through THIS restart still pay nothing (the live server's save has no tag
records yet). BOT_RULES is set on Render (the server logs "6 of the bot rules' numbers set on the host" since 02:32).

## Earlier (2026-10-18, paused for the owner's restart; branch `gun-racks`)
Done today on `gun-racks`: the controller (`5e86c58`: bumpers along the whole hot bar, △ gun to gun, L3/R3 lean while
aiming, L3 held the breath); the repo tidied (`6d56534`: docs/ and tools/, the site built the same); weapons fixes part
one (`aaf58e1`: the double barrel out entirely, the VSSK louder, the MP7A1's sight, the breath held as DayZ's, the scope's
fade); the Brave/uBlock fix (`cf9cae9`); disk cleared (115 unpacked zips, old film masters, 5 idle worktrees).
Left, in this order (the owner's words in the commits):
1. The whole test suite after the double barrel's removal: `node scripts/test-all.mjs`.
2. The gun rack in the game with its guns, a picture: `progress/rack-plan/rack-look-off.js` (offline; finds the first
   rack with guns in it). The owner: "this model in the game yet? it should be." (It is, on this branch.)
3. Reshoot the weapons film. Its session ("showcase", branch `claude/weapons-showcase-5a754b`, the film at `610be96`)
   needs this branch merged into it first (its own controller commit `30a4414` is superseded here). The owner's notes:
   the breath held before the sniper's shot; the bullet drop shown at range (a first round low, the zero turned up or
   held over, the second home, the round's arc seen); the aim on the target; the scope on the rifle from the start
   (`mods: ['scope_50']`), no irons-then-scope cut; the VSSK's new sound; the MP7's fixed sight; NO double barrel in it.
   The film's page is `tools/trailer.html` now, its takes in `tools/trailer/out`.
4. The Benelli's pump heard on a reload from empty: `1de4499` on `claude/intelligent-fermat-fd14fd`, not merged (ask).
5. LAST: the Google Ads media (`progress/google-ads/plan.md`).
The performance session ("perf-ping", `claude/perf-ping-61c7c4`) was asked to pause at a commit of its own.

## LOOT ON DAYZ'S MODEL (2026-10-17, on `perf-aggressive`, NOT deployed: the owner, "do not restart keep working")
The owner approved the plan (`progress/loot-rework/plan-1.jpg`): "use dayz as a template for loot distribution", "a loot roll is rolled for each spot", "keep it DRY". What is built (sheet: `progress/loot-rework/sheet-1.jpg`):
- Each item says everything about itself in `src/sim/items/*.ts`: its `loot` rule (DayZ counterpart `pair`, counts per step, restock, usage, found-with parts `fitted`, packs' `filled`), its trader `worth`/`sells`. A new item is one entry. The economy, the trader, FITTED and the crates read it (src/sim/items/rules.ts).
- The economy rolls per free spot (`Economy.fill`), cuts a packed step to its places (`fit`: the gas is asked 165 on 127 places, the bunker 175 on 145), keeps food off floors, caps buildings on steps 1-2. Crates are a kind of building on a step with a lean (crates.ts CRATE_SPECS), never holding what the map keeps one of.
- The new places, the owner: "Yes we need more loot places!" (pictures `progress/loot-rework/places-1.jpg`): racks in the gas works' barn, garages and barracks (127 -> 171 spots), seven shelves and eleven floor places down the bunker, laid after its plan (145 -> 177), four field posts in the west (the WW2 pillbox, src/sim/posts.ts + src/world/posts.ts, ground levelled under each, a step-3 army place with a rack, a case and a gun), a searchable case in each of the pass's six caves (filled as under the gas; the game stands it on the carved rock, main.ts). WORLD_REV 28, LOOT_REV 25: on the server deploy everybody is set down afresh at the map's edge with their gear. Now nothing is cut: the gas and the bunker hold all they are asked.
- Goes with the server deploy still waiting past `main` (furniture storage, the Mosin, gas masks, heli sound, VSSK, dog-tag rules, bodies kept an hour): write its changelog entry and restart note then.

## BUG LIST (this build: the map three times over, on `perf-aggressive`, not deployed)
The owner, 2026-10-16: "we need to add a buglist to this build". Each line: the bug, then its state.
- **A player shot out of a helicopter: their body floated in the sky.** The owner: "it should be stuck in the helicopter till the helicopter lands or crashes then spawn on the ground". FIXED, server only (server/acts.ts `leaveSeat`): a solo pilot killed in the air left the helicopter to their own dead game, which flew it no more, so it hung where they died and `riders` never laid the body out. Now the nearest player's game takes it over and it falls (its rotor runs down), or with nobody near the server sets it down wrecked; the body rides in its seat until then and is laid beside it. test/heli-body.test.ts (6 checks; the new ones fail on the old code), test/heli-orphan.test.ts. Goes live with the next server deploy.
- **The Edge "no graphics card" bot-check loop** (players drawing on the processor were turned away after the whole course with a message that named no cure): the fix is parked in `git stash` ("PARKED Edge no-card bot-check fix"), the owner: "forget it dont push for now".

## START HERE (2026-10-16, ~16:00 UTC)
- **Live (2026-10-17 21:14 UTC):** everything through `4ddcc76` (site and server, PROTOCOL 46: the weapons pass; `main`, `site-live`, `hotfix` = `4ddcc76`). Then a site-only deploy at ~21:50 UTC: the fight-stutter fix (the blood on the screen no longer costs frames; `site-live` moved, the server and `main` unchanged). Earlier: `37c11d2` (PROTOCOL 44). The branch `perf-aggressive` is the working branch (only handoff notes past `main`). Check `/healthz` and `/version.json` before trusting this line.
- **Two tasks had sessions of their own today:** the anti-bot work (section below: LIVE, with round 2: pardon at the door, banned names off "Recently left", ban saving, the missing-PCI-id tell) and the story trailer, film 17 (section below: storyboard approved, cut built and drafted; see its WHERE IT STANDS line for what is left before the final take).
- **Rules changed today:** the automatic handoff rule is GONE (the owner: "its bad"); hand off only when the owner asks.
- **Open, in no order:** the trailer's final take; furniture searchable everywhere (section at the end); a reconnect inside the page (a drop as a blip, no reload); optimizations (the shadow-shader warm-up was tried and reverted, unproven; full replays are spoiled by the laptop's heat: check `nvidia-smi` and measure with frozen A/B); sound complaints ("8D": a vehicle's own sound now at the ears; if they persist outside vehicles, find what the player was doing).

## ANTI-BOT TASK (the owner, 2026-10-16, its own session; the trailer has a session of its own)
The owner: "i think we need to make these chnages, develop the robust anti bot measures and hold deploy run tests and get it all ready to go". Also: "our bot course isn't good enough ... surely we can come up with a way to test users coming into the game that is accessibility frinedly an cant be bypassed by bots"; "can i ban this computr or browser at the source?"
- What was seen (server logs, Render, 2026-10-16 ~13:00-14:00 UTC): a swarm with made-up names `[A-Z][a-z]{5}[0-9]{3}` (Merric635, Merric538, Marlow663, Fenwic150, Brambl116, Dunmor989, Dunmor737, Norwoo429, Garric782, Drayto518, Corrig459, Ridgew389). Every one reports the same device (Chrome 155 on Windows, ANGLE NVIDIA RTX 3060). They come through ~15 residential-proxy addresses in many countries (41.140.x Morocco, 181.123.x Paraguay, 103.200.x, 51.39.x, 49.43.x ...), each bot keeping its own, connecting in waves in the same second. They PASS the bot-check course (real Chrome), come in, and are sent back within ~6 s (flying "stood on nothing", or "under the ground"), then pass again: a loop every 20-40 s each.
- **LIVE 2026-10-16 15:43 UTC as 31c6f43 (PROTOCOL 44), then 37c11d2 at 15:50 UTC** (the bot signature wants a dozen refused shots in a go, not four: two minutes after the release Survivor955, a person on an RTX 5070, failed a go with 4 of 10 landed shots refused; the owner: "okay fix"). Markers `main`, `site-live`, `hotfix` at 37c11d2. Parked on branch `antibot` for an hour at the owner's word ("can we stash these changes on branch antibot, the attacker has stopped for now"), then the swarm came back ("theyre attacking again. might be time to push"): merged into `perf-aggressive` and deployed from a clean worktree (the trailer session had an uncommitted file; `git worktree add --detach $TEMP/zp/ship HEAD`, `.vercel` copied in, `node scripts/deploy.mjs` there, then `rm -rf` and `git worktree prune`). The old server saved 412 characters and 39 stashes and the new one came up with them. The local `main`, `site-live` and `hotfix` markers stand at 31c6f43. Watch: `/healthz` `turned.device`, `keptOff`, and the log's `[device]` lines and "a Windows card named without its id"; `DEVICE_FARM=watch` on Render if real players on one phone model are caught; the panel's Bans page has the Pardon table. What is in it:
  - `src/net/device.ts`: the device hash (card's test picture + parameters, 2D text drawing, screen, zone, languages, cores, memory, system; NOT the pixel ratio: zoom changes it), sent as `fp` with hello (`src/net/client.ts`). Seen in headless Chrome on the dev page (`assets-src/_wf/me/device-check.html`): the same hash from two fresh profiles (10 to 360 ms), another when drawn by SwiftShader.
  - `server/device.ts` (DEVICE: need on Render, DEVICE_RULES watch|enforce, DEVICE_LIVE 2, DEVICE_SPREAD 3, DEVICE_HOURS 24; `cameWith`/`isFarm` pure), `server/gate.ts` `deviceRules` (at hello, before the course: a farm = 3 games from 3 public addresses in an hour -> kept off a day and its games put out; a kept-off device turned away; at most 2 live games a device; roles exempt), `bannedFor(key, ip, fp)`, admin bans carry `fp` (api/admin.ts keeps it), `recheck` strikes the device too (`namesOf(key, ip, fp)`), `join` re-asks the live cap. Admin: `/players` and `/recent` show `dev:xxxxxxxx`, `/same <who|dev:..>`, `/ban dev:xxxxxxxx` (and /ban of anybody takes their device), /bans shows it, the panel shows it as a fact (not looked at in the game). `/healthz` `turned.device`.
  - `src/sim/course.ts`: the judge tightened on what told the swarm from the four people in the same hour of the live log: a go with 4+ shots landed-but-refused carries the bot signature (REFUSED; people had 0, bots 4 to 20), and more than 90 shots ends the go (SHOTS, was 180; people fired 9 to 45, bots 63 to 160). The owner, mid-task: "we need harder to hit shots" and "does the client hold the information on where the bots are? maybe our bot check is flawed architecturally": YES, the server shows each game the figures in its sight 20x/s (`rfig`), so a script reading the wire aims perfectly, and the judge's human-aim checks can be acted out; no course that tells the client the targets' places can keep out a program built for it. Harder figures would cost people more than a script. Told the owner so. The device layer is the hold.
  - Tests: `test/device.test.ts` (port 8233, 5 checks), course, bots, heli-orphan (its near watcher stood off the map's east edge since the fort moved to the rim: fixed, the test only). Whole suite: 80 files, all pass after that fix. tsc x3 exit 0.
  - ROUND 2 (2026-10-16 ~15:40 UTC, the owner's asks relayed by the review session, all in the same release): (a) **Pardon**: `ADMIN.turned` (gate.ts `turnedAway`, the newest 40 turned away at the door: banned, kept off, a full device, the bot check not passed, an out-of-date browser, put out by a farm ban) shown on the panel's Bans page as "Turned away at the door" with a Pardon button (`/pardon p:<n>`, also by name or dev:); `/turned` lists them; a pardon lifts BANS.temp and strikes on key, address and device, the admin bans of any of the three (saved), and forgets the device's sightings. (b) **Banned off "Left lately"** (`/ban` splices ADMIN.gone). (c) **"It holds until this server restarts" was FALSE**: the ban always held at once; the site's `/api/admin` answered 500 ("the file store is serving an old copy") to every save within ~100 s of another (seen in `npx vercel logs ... --status-code 500`). Fix: the site hands back the store's `mark` and a save that brings it is written without reading (api/admin.ts), a stale read answers `{ok:false, stale:true}`, and the server retries a failed save every 15 s for ten minutes (keep.ts `keepSaving`); admins are told "they hold here now, and are written to the site again shortly" (`savedWords`). (d) **Renderer without a PCI id** = bot: `spoofedRenderer` in gate.ts, asked with BOTCHECK_ENV at the pass; 231 live passes over 2.5 days checked, no real Windows player lacked "(0x....)", every id-less one was the swarm. Tests: admin.test (pardon, recent), bots.test (spoofed renderer), keep-api, api, device: pass; tsc x3 exit 0.
  - Release: changelog entry "Bot farms turned away at the door..." with `media/anti-bot.jpg` (card `marketing/anti-bot.html`) and `media/fixes-1016.jpg`; `server/restart-note.json` (120 letters); ARCHITECTURE.md rebuilt. After the deploy: `git branch -f main HEAD` etc. (CLAUDE.md), watch `/healthz` `turned.device` and the log's `[device]` lines; `DEVICE_RULES=watch` on Render turns the rules to log-only if a real player is caught; `/unban` lifts a device like any time-off.
- Done before it, in the same release: `9a4bdff` sent back 4 times in 30 minutes -> kept off 24 h by key and address (server/checks.ts RECHECK_BAN).
- The brief as it was (all of it built but item 4, the proof of work: left out, a farm on a real RTX 3060 pays it as cheaply as a person):
  1. A device fingerprint sent with `hello` (no prompt, nothing to do for the player: accessible): a hash of how the card draws a fixed test image (WebGL) and a 2D canvas, screen and pixel ratio, timezone, languages, cores, memory, platform. PROTOCOL 44.
  2. The server keeps fingerprint -> keys and addresses. Kept off by fingerprint: the same fingerprint from 3+ different addresses within an hour, or sent back repeatedly; checked at `hello`, before the bot check. Admin: the fingerprint in /players and the join line, a /ban that takes it.
  3. At most 2 live connections per fingerprint.
  4. Optional: a few seconds of invisible proof of work at `hello` (costly for a farm, nothing for a person).
  5. Care: no real player banned for a common machine (Chrome 155 + RTX 3060 alone is common); a household on one address with one machine type is not a farm.
  6. Tests on their own ports, `node scripts/test-all.mjs`, tsc x3. Then the release: changelog entry with a picture, `server/restart-note.json`; the 14 commits waiting on `perf-aggressive` past `main` go with it (5.56 by rate, /spawn on roofs, the infected leave dropped bodies, close codes, the recheck ban). Tell the owner when it is ready; deploy only on their word.

## THE TASK NOW (started by the owner 2026-10-16): a high quality, ORIGINAL trailer that tells a story
The owner's words, all of them: "i need a high quality trailer, it sould be origional and not be a copy of any of the past trailers and should tell a story, you need to choreograph a trailer and the goal is to show off the game, things you can do in it, and get people to want to play while hinting to content thats coming soon from the roadmap etc... action packed funny dramatic idc, we have emotes, and dynamic environments and mechanics to show off. maybe theres a camper in a 2nd story of a house and people united by being killed form this person team up and take them down or something idk, showing off insisde the castle would be cool or any of our special POI's. the users and investors are starving for a good trailer."
- So: a choreographed story (their seed idea: a camper on a house's second floor picks people off; those he killed come back, team up and take him down), action, laughs and drama, emotes, the world's places (inside the fort Orlinoye, the bunker, the gas works, Kamenka, the hospital), the mechanics shown in play, and the roadmap's coming content hinted at (phases 4 to 6 of marketing/roadmap.html, said as coming, never as in the game).
- ORIGINAL: no shot, board or beat copied from the sixteen earlier films (read trailer-project.md to know what they were, so as to avoid them).
The owner, 2026-10-16: "we need a impressive trailer that tells a story". Nothing else is asked for now ("disregaurd everythin g besides the impressive trailer and handoff task").
- Read the memory note `trailer-project.md` whole (sixteen films: the method, the owner's decisions and corrections, the traps) and `feedback-film-motion.md` (judged in motion, `film.mjs --motion`; NOTHING sped up).
- The machinery is all there: `src/trailer/director.ts` (actors are the game's own players, free camera, sound from logged events, MP4 in the page), `shots*.ts` (cut 16 is the latest), `music*.ts`, `scripts/film.mjs` (`--cut N`, `--draft`, `--stills N --no-video`, `--from/--to`). Reuse it; `borrow(cutN, names)` takes shots from earlier cuts, but the owner wants NEW scenes ("we want new scenes tho, not the same exact things. it should feel fressh").
- A story, not a feature list: the third film ("the story": two survivors, the police station held, a backstab) and the fourteenth ("What goes up") were the story ones; read what the owner said of them in the note.
- **WHERE IT STANDS (2026-10-16 ~07:40 UTC): the owner said YES to the storyboard ("looks good, i want this to look like a movie, flush and smooth transitions etc... high quality, no visual bugs or glitches shown"); cut 17 is BUILT and drafted; the motion check and the full take are next.** Files: `src/trailer/shots17.ts` (30 shots, 156 s, 83 bars), `src/trailer/music17.ts` (made from music14.ts by a scratch script: E minor, kinds box/camp/march added), `trailer.css` (x17-* classes at its end), director.ts (cut 17 registered, the seven-name cast). Storyboard `marketing/plan-film-17.html` -> `zona-plan-film-17.png` (`progress/film17/storyboard.png`). Drafts seen: `progress/film17/draft17-sheet-0*.jpg` (whole film, a still a second), `draft-stairs-and-swing.jpg`, `draft-opening.jpg`. Changes from the board, all seen in drafts: the camper stands OUT ON THE BALCONY by its door (from inside, the balusters crossed the scope); the bag lies across the street from the house (K(9,-3.6)) so his shot is near square; the police car comes UP the street and stops below the house; the frag goes off at the foot of the wall under the balcony (a bouncing grenade cannot be put on a 1 m balcony from 10 m: 22, 28.5, 30.5, 35 and 40 degree lobs tried); Dmitri finishes him with a HATCHET (the stick grenade has no melee swing in the game); dusk is hour 0.745 with a fill light on the street's people (0.72 is day, 0.76 night); the first frame is the title card (never black). TRAPS met: the blood bag shot leaves the player low on blood and the game greys EVERY later shot (reset() puts blood back to BLOOD.full); H(lx, lz, up) takes a height over the house's floorY, never a world y (a doubled height put a lens over the roofs); a bash command with backticks in it runs them (write scripts with the Write tool). NEXT: read the --motion log (`trailer/out/d17-motion.log`: frames that hardly differ from the one before while their neighbours do; read the times against the shot list and mend any stutter), then the full take `node scripts/film.mjs --cut 17 --still` detached (about 45-60 min; 156 s at 60 fps) -> `trailer/out/zona-trailer-17.mp4`, copy to progress/film17/, SEND IT; re-read `/api/cashins?format=json` before the take and put the figures in LIVE (shots17.ts). The dev page must be up (launch entry zona-dev; park the pane on /trailer/clock.js).
- What is new since cut 16 and can be in it: bags and clothes gone through where they lie, the Elite crown in chat, the stick grenade held as a club, smoother frames, the AR found at police and army places, Kamenka at dusk (`assets-src/_wf/me/cine.js` takes stills). No player counts; every number true.

## Shipped with the anti-bot release (no longer waiting)
- 5.56 by rate (TypeRule.per), /spawn at the admin's height on a roof, the infected leave a dropped player's body alone, the close code in "went without logging out", sent back 4 times in 30 minutes -> kept off 24 h. Earlier site-only deploys: the T-pose fix, instant payouts (minTags 1, five a wallet), the attachment duplication fix, the automatic rejoin after a dropped connection, sound started by any press, the chat letting the mouse go, a car's or helicopter's own sound at the ears ("8D"), the Google tag AW-7844801690.

## NEXT, RIGHT AFTER THE MAP DEPLOY (the owner, 2026-10-16, in their words)
- "i have added a bunch of new weapons and guns for us to use with animations baked in. we need to part out their attachments per gun like all the rest of the guns and bring them in. We should not downscale the models when held in first person when possible, ensure proper rotation inventory icons and in the world. Make sure properly rigged and animated, be thorough we want high quality." Most come with their own attachments.
- "some weapons have inspect animations and draw animations etc.. some dont. we will have to do our best."
- "akimbo weapons are shot with left and right click controlling their respective hands".
- "the grenade launcher and its ammo is an admin only weapon. ammo stack to 50 for the grenade launcher."
- Tiers: "use common sense when tiering the loot. T4 should have weaker AR's that are rare, bunker should have all the best weapons"; the new melee weapon and new low-tier weapons into T2; "we can put some pistols in T1 now".
- "we should make the ruins T5 for now to incentivize exploration since the new map does not change spawns for the player."
- "we should add 2 more helicopter spawns in the far east in spots that make sense."
- Then: update the changelog, and "produce the 2 15 second trailers i asked for showing off the new content for marketing purposes".
- After the weapons pass: offline-mode UX. "when people are in offline mode we need to explain to them that only 2 devices from the same WIFI ip can be connected to the game at once. some people forget to close tabs on their phone and try to play on their ipad to be not able to play etc... we need better ux on this as well".

### Weapons pass: DEPLOYED 2026-10-17 (PROTOCOL 46; see the changelog entry "Ten new guns, their own sights, and a richer village")
- Guns, each in OUR OWN arms: Scorpion, MP7A1, AKS-74U, .50 sniper, Barrett M82 (bipod on B), VSSK, double-barrel (db12), three pairs (Dual SMGs, Dual MAC-10s, Sawn-Offs), pitchfork (melee), M32 (admin only: launched grenades, server-judged, 4 a second, 40 mm stack 50). Attachments: MP7 sight + suppressor, MAC-10 suppressor, Elcan (AR-15), the foregrip = the M32's vertical grip (AR-15, MPA30, db12). Rounds: real .50 BMG (`round_50bmg` from the cartridges download), cans of 25 for .50 BMG and 12.7x55.
- Scopes: own reticles per scope (HUD `.ret-*`: pu, mildot, pso, elcan); VSSK and Elcan 2-6x, .50s 4-12x on the wheel (`ZOOMS`); .50s rangefinder (`RANGED`, readout under the ring). The M32 aims through its own holo (LENS glass piece hidden in the hands).
- Third person: forward hand on each gun's fore-end (`FORE`, raycast underside) or vertical grip; gun hand by the trigger (`BY_TRIGGER`/`TRIGGER_WRIST`); pairs as two guns, one per fist (`AKIMBO_GAP`, pistol stance). Checks: `progress/weapons/third-close.js` (views left/front/right/hand/trig), `ads-all.js` (cross at screen centre), `accuracy.js` (rounds vs sights; run 4 guns at a time), `scopes.js`, `akimbo-both.js`, `bipod.js`.
- Loot: new guns put down first (FIRST) and in the armed places (ARMS_TOWN, ARMS_FORT); the VILLAGE IS TIER 3 now (buildings.ts; each sort's village share moved T2->T3 plus T3 things at Kamenka's density: ~530 more things). `test/loot.test.ts` and `test/gas.test.ts` still pin the old layout (village T2, bunker counts): rewrite them with the loot rework.
- Open: others do not see the Barrett's bipod down (needs a server field); the loot branch `refs/heads/claude/loot-world-6b02f8` (Kalat ruins T5, 2 east MD-500 pads, gun re-tiering) NOT merged: ask the owner; the old shared attachments' exclusivity is the owner's call; two 15 s weapon trailers.
- Next, in the owner's order: the offline/refused reasons (done on branch `claude/refusal-reasons-fc6875`, 1f39038, NOT merged: ask); the map made better (their inspiration picture, 2026-10-17); furniture with storage everywhere; the DayZ-style loot rework (per-spot tier and categories, a roll per spot, more places: cave stashes, cheap POIs with bunker tops).

## Open, after the trailer (the Google Ads media stays LAST)
- Furniture searchable everywhere: the bunker's `bunker_cabinet`/`bunker_desk` ARE `painted_wooden_cabinet`/`metal_office_desk` (src/sim/bunker.ts SEARCHED); plan card `marketing/plan-furniture.html`.
- In-page reconnect (a drop as a blip, no reload); optimizations (the shadow-shader warm-up tried 2026-10-15 was reverted: unproven).
- LATER, real recorded audio (the owner, 2026-10-16: "our generated audio and low effort patch work is less than desirable, we cant take this on now but its worth documenting for later"). Their reference for bullets flying by: https://www.youtube.com/watch?v=VTuuOiWgVZ0 ("amazing fly by sound"). It is the target to match, not a source: audio taken off a video is a rip (CLAUDE.md: nothing ripped). Find recordings of the same kind (supersonic crack + whizz, near and far) with a licence that allows a game: CC0 on Freesound, the free Sonniss GDC bundles (royalty-free), or a bought pack; then a pass over every generated or patched sound, judged side by side with the reference.
- **Server walls for ZONA too** (the owner, 2026-10-21, on the battle royale's cheap server walls: "its the best thing for
  zona eventually as well"). The ZONA server keeps only the ground's height and trusts players' games about walls, which
  is why wall-shooting cheats work. Give it the battle royale's cheap form: simple boxes per building, loaded once.
- **Server-side sight and aim checks, at the end of the list** (the owner, 2026-10-20: "draw the plan but we will not work on it for now", then "save it for later and put on the end of the to do list"). Players are sent only the players they could see: hills and solid walls hide, windows, doors and foliage never do. The test looks about 0.3 s ahead, so nobody pops in. Shots through solid walls are refused, and the aim watch grows. Steps: watch only, tune with bots, switch on, aim. Plan card: `marketing/plan-visibility.html` -> `zona-plan-visibility.png` (and `progress/plans/`). It is the real answer to the wallhacks of 2026-10-20: the trap on window.__game (live, c721b3e) stops pasted scripts, but not somebody who edits their own copy of the page.
- **LAST: Google Ads media** (the owner, 2026-10-18: "put this at the very end of our todo list for now"): 15 stills (5 landscape 1200x628, 5 square 1200x1200, 5 portrait 1080x1920), five trailers each in 16:9, 1:1 and 9:16 on the ABCD plan, and the 15:5:5 copy. The plan, with the owner's brief whole and three questions for them first (the tag holds 15 minutes, not the brief's 10; ZONA has no "extraction"; a landing page without token or payouts): `progress/google-ads/plan.md`. The owner: "do not discuss mention or elude to payouts or play to earn".

# Where the work stood (handoff, 2026-10-14)

Read `CLAUDE.md` first. This file says what is live, what is waiting, and what is next. Update it at every release.

## Live
- **`a2cc445`, deployed 2026-10-14 (site 20:57, server 21:46 UTC, late by a Render outage): PROTOCOL 39, WORLD_REV 25.** The performance pass's second half: see-through things drawn in one go (`src/core/one-draw.ts`), buildings instanced by model (`Buildings.paintShell`), readying waits for every shader a material has, the scene look spread over frames (`tend`), the lamp-light freeze gone (`Renderer.readyToLight` + `Lamps.canLight`); and the helicopter: C all but drops it (a stopping-distance governor in `src/game/heli.ts`), Space climbs at 12 m/s, a quarter less hp than a car (`hpOf`, `HELI.hp` 4050), `heli` in the admin entities. Changelog "Performance boost, and no more lamp freezes" (card `frames-boost.jpg`). The Arena server (zona-arena-1) was still on 077abd8 after it: Render paused free-plan deploys in the outage; it takes main when Render resumes.
- **Site-only `fdd867a` (2026-10-14 ~21:30 UTC): payouts, one payout of five in any 24 hours from 22:00 UTC** (the owner: "only 1 5/5 payout per 24 hours too as a safegaurd"); see `rules3From` in `api/_lib/payouts.ts`. Not on `main` yet: the next full deploy carries it (it is site code only).
- `077abd8`, deployed 2026-10-14 19:05 UTC: the performance pass's first half and the basements stocked as a place apart. Changelog entry "Smoother frames".

## The performance pass (the owner, 2026-10-14: "performance is the biggest user complaint ... dial in on the FPS 100+ goal"; "all changes should be invisible"; "you can deploy if nobody is online")
- Online, 1920x1080 at the default settings, this morning against now, measured the same way (joined to the local server, 15 s settled; `assets-src/_wf/me/fps-now.js ?warm=15000&settle=15000`): crossroads 84 -> 121 fps, hospital street 62 -> 92, police HQ 73 -> 101. Card: `marketing/perf-progress-3.png`.
- What did it (each commit says how it was proved the same): physics hit zones as colliders of their own (`FreeZone`, Rapier 0.21 made `setTranslationWrtParent` cost 1.5 ms a step); vegetation and far-tree cards walked by squares (`src/world/cells.ts`); ground drawn in runs of tiles; gas signs, wells, bunker roofs merged by paint; door hinges kept out of the scene; shadow materials of their own for instanced and boned things; skeletons once a drawing (`onceADraw`); fingers curled down the finger; the two items on `next` above.
- TOOLS (git-ignored, `assets-src/_wf/me/`): `fps-now.js`, `cpu-ab.js` (paired, in turns), `draw-census.js`, `prog-why.js` (why shaders are chosen again), `matrix-census3.js`, `terrain-ab.js` / `onedraw-ab.js` (the same frozen frame drawn both ways, every pixel compared), `phys-*.js`. `play.mjs` now saves `<name>.cpuprofile` (read with `prof-top.mjs`, `prof-callers.mjs`) and takes `PLAY_UNCAP=1` (no 120 Hz cap). TRAP FIXED: the test harness ran two frames per screen frame while the tab was in view, and its pump kept the page's thread busy: every headless frame time before 2026-10-14 evening was too high.
- Still open: jeeps are seven draws each (instancing their parts across jeeps); loot is a draw per kind; texture uploads when arriving somewhere online (hitches); three failing tests that fail on `main` too (`bunker`, `expansion`: stale counts since the basements; `net-held`: `window` in node).
- `bb275b6`, deployed 2026-10-14 08:10 UTC: PROTOCOL 38, WORLD_REV 25, LOOT_REV 22. The helicopters (the Apache on the supply drop; two MD-500s to fly, on the hospital roof and below the fort), the fort turned to the road with the jeep burning at its gate, everything seated in the ground; the terrace's tents taken out (the owner: too small); a keycard no longer keeps anybody out of a vehicle (only a taken tag does); the leave-the-tab question and the full screen setting; and the split of the five giant files.
- Payouts: the "rule of five" has been on since 2026-10-14 02:20 UTC (0.01 SOL a tag, a wallet paid when five are due). Check `/api/cashins?format=status`.

## The fort work of 2026-10-14 (LIVE since bb275b6; what is LEFT FOR THE FIRST ROUND AFTER THE SPLIT below is still open)
- The fort TURNED where it stands so its drawbridge faces the road (its turn is in `MOUNTAIN` in `src/world/worldgen.ts`: -75 degrees), the hill's foot run out before the gate (`MOUNTAIN.shoulder` in worldgen), the cart track up it to the gate, a lane to the ruined houses.
- A wrecked jeep burning for good before the gate (light by night, warmth like a campfire, burns to the touch): `castleJeep` in `src/sim/castle.ts`, `src/game/wreck-fire.ts`, `src/sim/wreck-fire.ts`.
- Every tree, rock, stump and log seated in the ground (`src/world/seat.ts`; test `test/seat.test.ts`).
- The faults the owner found in the fort mended: stair and ramp heads, towers seen from below, rock colliders, where the infected start.
- Round 8 of the fort (brief `%TEMP%/zp/briefs/castle-r8-last-fort-items.md`) was stopped by the owner to move on: DONE, the green tents on the terrace's back side remade with two of the army camp's real `tent_military` models, loot places there 2 -> 5, each seen from most of the walk. LEFT FOR THE FIRST ROUND AFTER THE SPLIT: the HATCH, which since the turn sits on a 39 degree made flank with its head up to 49 cm proud (a hidden spot was found at (520.05, -331.3), but there the passage climbs and runs under the wall's footing, and the lane passes within 8 m: tools `%TEMP%/zp/castle/r8-g*.mts`, `r8-hide.mts`); faces in one plane at the passage's bends (11.9 -> 22.4 m2 in sight since the turn) and the infected steering round the house shells and the fort's foot, with a way home when stuck (`src/game/infected.ts`; homes are already on clear ground). AND, from the owner (live now): "the no overlapping textures rule in the castle are has created tiny pixel wide gaps along the walls and external buildings etc... we want to make sure theres no gaps between meshes either". The one-face pass (`Faces` in `src/world/castle-shape.ts`, `backedOut` in `src/sim/kit.ts`, since 7c13915) cuts triangles where another lies in the same plane, and the cut pieces leave T-junctions that show as hairline cracks. Mend so that there are neither faces in one plane NOR cracks: for instance keep both faces and push the one that should lose back in the depth test (polygon offset) instead of cutting it, or weld the cut pieces' new corners into their neighbours' edges. Prove both by count (faces in one plane in sight, and open edges / T-junctions along every wall and building of the fort) and by looking in the game, close along the walls. The owner's own picture of what they mean is `progress/castle/reported/window-reveal-gap-from-the-owner.webp`: an arched window through a tower or wall, its side lining a thin panel of a different, smaller stone standing loose in the opening, with sky and trees seen on both sides of it through the hollow wall. So also: every opening cut through a hollow kit wall (windows, slits, doorways) gets a whole reveal (jambs, head and sill closing the wall's full thickness, nothing seen through), in the wall's own stone at the wall's own scale; counted from every standing place, and looked at.
- When it ships: raise WORLD_REV to 25 and LOOT_REV to 22 (the ground moved), write `server/restart-note.json`, add the changelog entry (a script for it is `%TEMP%/zp/release/changelog2.py <repo> [tents]`: check its date and give the tents line a picture from `progress/castle/r8/` before running it), deploy with `node scripts/deploy.mjs`.
- The tenth film (20 s of the fort, day into night) is cut 10 (`src/trailer/shots10.ts`, `music10.ts`); the owner used the draft (`progress/film10/draft-10.mp4`): no final take wanted.

## Next, in this order (agreed with the owner)
`next` ships whenever the owner says ("deploy"), never while people are on unless they say so.

**THE MAIN GOAL NOW (the owner, 2026-10-14): Phase 4 of the roadmap, "Wilder ground" (`marketing/roadmap.html`), in this order:**
1. **Basements: LIVE 2026-10-14 ~15:20 UTC as 9e868b9 (PROTOCOL 39).** `src/sim/basements.ts` (the plan: which houses, six layouts, rooms, furniture, places; `basementUnder`/`basementDark`/`inWell`/`basementDeep`), `src/world/basement-build.ts` (walls, floors, steps, cellar door), `src/game/cellars.ts` (bulbs, dark); the ground open only over the steps (terrain shader discard + `physics.holes`/`physics.through`); planned last in `Buildings.plan` and kept on `world.basements` for the server. 15 on the map. The owner: "dont be afraid to make use of the space ... dont be boring". Still to do: fuller rooms (the root cellar is sparse), then **attics** (a ladder through a hatch in the top floor's ceiling, a little loot, a window to watch from). Look with `assets-src/_wf/me/cellar-look.js` (`&layout=` or `&cellar=<plot>`).
   - **TABLED, NOT TO BE LOST (the owner, 2026-10-14, after playing it): "i ran around and im dissapointed with the lack of basements there are. almost every house should have a basement, a celler access and a inside staircase access. this is a large task but it will be worth it i think. table it for now, but i dont want to lose this."** So: a basement under nearly every house (not four in ten), each reached BOTH by the cellar door in the yard AND by a staircase down from inside the house (a stair in each house plan's ground floor, the floor opened over it: see the notes on `flight()` and the house plans' free strips in `hands-mags-overhaul.md`). Expect: every house plan reworked for a stair well, the places for things kept (append, never renumber), the clear-ground rule for wells relaxed (only 15 of 42 homes got one), and the attics done in the same pass (they need the same work inside the houses).
2. Animals (deer, boar, wolves), then hunting, skinning and cooking meat.
3. Weather: rain, cold, shelter.
4. A desert, and the ruins in it (the held desert-canyon idea: memory note `desert-canyon-idea.md`).
5. Crashed aircraft, and what they carried.
6. Forests of different trees.
7. The 100 fps performance pass (memory notes `perf-ask-2026-10-12.md`, `draw-calls-2026-10-12.md`).
Alongside: the two films (a 10 s Arena hype trailer; a 30 s trailer of the new additions: the fort, the helicopters and the rest).
Phase 6 of the card is the Arena's (its stakes, more maps, the fort finished): after Phase 4.
1. **DONE 2026-10-14: the giant files are split** (commits 2520a75 to 0c2a259, then the chores after them): `src/world/castle-shape/`, `src/sim/castle/`, `src/world/worldgen/` (`generate.ts` kept as one function, its stages indexed at its head), `server/` beside `index.ts`, `src/game/game/` (Game's methods by feature). The old paths still export everything. Proved file by file: the world fingerprint byte-identical, tsc three ways, the whole suite, the server booting and taking two players, the game online in a browser with no page errors. The tools: `scripts/split/` (see CLAUDE.md, "Checking work").
2. **LIVE since bb275b6: the flyable helicopter (MD-500)**, PROTOCOL 38. `src/game/heli.ts` (a Jeep subclass: a simple model of our own, the owner's "no parts"), `src/sim/heli.ts` (its numbers, its two spots: the hospital roof and a pad by the fort, `seatsOf`, `heliCrash`), `src/world/helipad.ts`. Keys: Space up, C down (the owner: "remove the ctrl key, use C like crouch"), W/S nose, A/D turn, Q/E lean; hands off it holds height and stops itself; never over 100 m above the ground (the owner, so it can be shot). Two seats; Ctrl+1-4 moves seat in any vehicle (Ctrl+1-2 in it), shown on a DayZ-style panel; its glass stops no shot; a fall wrecks it and kills those aboard; a pilot shot or gone leaves it to whoever is aboard, else to the nearest player within 600 m, else the server sets it down wrecked (`orphanHeli`, server/acts.ts). A parked vehicle another runs into takes up physics ('vtake'). Vehicles stay run by the driver's game, not the server: the owner chose that, 2026-10-14, after hearing the trade ("Lets not do server vehicles ... Youre saying this is how aaa games like gta do it then fine"). Test flight: `assets-src/_wf/me/heli-fly.js`; tests `test/heli.test.ts`, `test/heli-orphan.test.ts`. Not yet seen by the owner in play.
3. The first round of fort fixes listed above ("LEFT FOR THE FIRST ROUND AFTER THE SPLIT").
4. **Wagers, round 1 (gameplay, no money): BUILT on `next`, not live.** The owner: two rounds, "We will skip the fake money"; CS:GO rounds ("once all the players of 1 team is dead the winner team is decided point awarded then next round and reset"); preset loadouts; "a simple fps shooter" (guns only, never run dry, no mags, armour or gear); the fort's 100 m square, drawn alone ("do the chunk only draw for better fps"). A server of its own, `arena/` (see `arena/README.md`): it decides every hit and health point itself. The menu's Wagers tab hosts (1v1 to 3v3, first to 3/5/10, four loadouts, the stake shown and not paid), joins, and practises alone. Test `test/arena.test.ts`.
   - **Render**: the owner made the free service by hand (2026-10-14), building from branch `next` until the next deploy puts `arena/` on `main`: then its branch goes back to `main`. `VITE_ARENA_URL` is set in Vercel (Production), so the site finds it once the site is next deployed.
   - **Round 2 (money)** waits on the owner's calls: the cut (7.5% suggested), stake limits (0.02 to 0.25 SOL suggested), escrow, legal advice first. More maps: other 100 m squares of the open map (the server cannot yet build colliders for houses in a square: needed for any map but the fort).
5. **After phase 5 of the roadmap: split the next big files** (the owner, 2026-10-14: "we will add more conent to these files in the future so we should put it on the docket"): the weapons (~3,970 lines), the buildings (~3,100), `generate.ts` (~2,660), the character body (~2,410), the sound (~2,250), the inventory screen (~2,120). With `scripts/split/` and its proofs, no behaviour changed, as the first split was.

On `next` since the last release (bb275b6): the wagers (item 4), and the tabbed-out rule (the owner: "players who are tabbed out for 60 seconds should get removed from the server"): a minute of nothing from a player's game and the server takes them off, saved where they stood as with the proper leave; a hit meanwhile starts the minute again (`TABBED` in `server/gate.ts`, env `TABBED_S`; test `test/tabbed.test.ts`).

## Known and open (not urgent)
- Fort: the east wall's hollow at the rent, vault backs, things that can be walked through (medical lamp, chairs, cold fire ring, jerrycans, graves, tins, wireless); fill of the made shoulder lies up to 6 m against the gate wall west of the gate (not looked at close); house H4 stands beside nothing now; the foot of the track at the old site.
- Snow: a white drift at the foot of a rock or tree on ground too steep to hold snow; the phones' ground shader has no ruts.
- Server authority: today the player's own game keeps its health while it is answering; the server only checks it from outside (it counts what it dealt through the best armour there is, lets health come back at 10 a second, and kills whoever stays up 15 past nothing for 1.5 s: `dealt`, `standing` in `server/index.ts`, enforced on live). So a changed game could still take every hit as if in the best armour, heal at that rate without medicine, ignore falls, gas, bleeding and hunger, and call any hit a head shot (the server checks range, fire rate and hills, not the zone). Fine for now in the open world; NOT for money matches: wagers need the server to decide every hit and health value.
- Performance: the 100-fps pass is still open (memory notes `perf-ask-2026-10-12.md`, `draw-calls-2026-10-12.md`).
- The older queue of asks: memory notes `asks-2026-10-13.md` and `open-requests-2026-10-11.md`.

## Backup
`next` was pushed to GitHub as `backup/next` (the owner's yes, 2026-10-14; at ffbdd20): push it there again now and then (`git push origin next:refs/heads/backup/next`, never to `main`). Since 2026-10-14 `next` is also on GitHub under its own name (the owner's "push next", for the arena's Render service): a push to it redeploys the arena, nothing else. `site-live` and `hotfix` exist only on this machine.

## Tools outside the repo (on this machine only)
`%TEMP%/zp/`: old lane briefs (`briefs/`), the fort's measuring scripts (`castle/`, `castle/audit5/`, `eval-fort2/`), release helpers (`release/`). (The test-suite runner is in the repo now: `node scripts/test-all.mjs`.) CAUTION: many of those briefs and some tools name the project's PREVIOUS location (a temporary folder of the old chat): the project lives HERE now, in this folder; change the path before using any of them, and never edit the old copy. The old copy goes away with the old chat.
