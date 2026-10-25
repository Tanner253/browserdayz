# ZONA: where the code is

Made by `node scripts/architecture.mjs` from the files themselves (size, and the first sentence of each file's header
comment): run it again after adding, moving or splitting a file. Read `CLAUDE.md` first. Five giant files were cut into
folders on 2026-10-14 (`src/game/game/`, `src/world/worldgen/`, `src/sim/castle/`, `src/world/castle-shape/`, and
`server/` beside `index.ts`): the old file is still there and still exports everything it did, so import from it.


## api/_lib/

| file | lines | what it is |
|---|---:|---|
| `live.ts` | 24 | The payout system as it runs for real: the settings from the environment, the real chain, the real file store, the real clock. |
| `paid-before.ts` | 589 | The treasury's payments to players up to 2026-10-20T06:38:54.361Z, read off the chain (each with a receipt or a memo: 580 of them, 7.750265 SOL to 108 wallets). |
| `payouts.ts` | 1670 | Paying for dog tags. A tag cashed in is paid out of the treasury to the wallet the player gave; the treasury is kept topped up by collecting the coin's creator rewards; and every payment is written in a book the... |
| `posts.ts` | 21 | The posts of the game's X account that its main menu shows (see api/updates.ts), by the number at the end of each post's link: x.com/ZonaSOL_/status/<this>. |
| `pump.ts` | 188 | Creator rewards on pump.fun: where a coin's creator fees pile up, and the transactions that bring them home to the creator's wallet. |
| `shop-items.ts` | 106 | What the store sells (2026-10-22), read by the site's check (shop.ts), the store's page (src/ui/store/) and the game server (server/perks.ts). |
| `shop.ts` | 416 | The store's money (2026-10-22): a price quoted in SOL, the payment found on chain and checked, and the book of what was bought. |
| `solana.ts` | 427 | Just enough of Solana to pay somebody: keys, addresses, a transaction put together and signed by hand, and the handful of questions asked of an RPC node. |
| `store.ts` | 184 | Where the payout system keeps what it must not forget: one small JSON file (the book) in Vercel Blob. |

## api/

| file | lines | what it is |
|---|---:|---|
| `admin.ts` | 124 | Who may give orders on the game server, and who is kept off it: kept where a restart of the game server does not lose it (2026-10-11). |
| `boot.ts` | 33 | How the game's start went on somebody's machine. |
| `cashin.ts` | 45 | Called by the game server when a dog tag has been held for its full time (TAG_HOLD: twenty minutes), and again for as long as that tag has not been settled. |
| `cashins.ts` | 670 | The payouts page (/payouts, see vercel.json): what the treasury holds, what a tag pays now, every tag cashed in and what became of it, and every collection of creator rewards, each payment with the transaction... |
| `keep.ts` | 103 | What the game server must not forget between its restarts: everybody's character, and every stash (2026-10-12). |
| `store.ts` | 151 | The store (2026-10-22): its prices quoted in SOL, payments checked on chain, and who has what. |
| `tick.ts` | 37 | The housekeeping: collects the coin's creator rewards when enough are waiting, and goes back over the tags that are not settled yet (a payment still on its way, a tag waiting for the treasury or for tomorrow's limit). |
| `updates.ts` | 87 | The game's news, for its main menu: the last few posts of its X account, each with what it says, its picture or film, and where it is on X. |

## server/

| file | lines | what it is |
|---|---:|---|
| `acts.ts` | 541 | The server: what happens to players and things (locks, voice, carried things, seats, jeeps hurt and blown up, bodies, a kill). |
| `admin-bodies.ts` | 75 | Bodies cleared away by an admin, with whatever is on them: one (the one looked at, by its number, or the nearest), or every one within so many metres, as /delz puts down the infected (the owner, 2026-10-23: |
| `admin.ts` | 977 | The server: what an admin can do that nobody else can (command: every slash command; login; putting a player off). |
| `aimwatch.ts` | 70 | The server: the bot check's own judging of an aim, run on every shot that hits a player in the world (2026-10-18, the owner, of bots that had passed the course and were punching players: |
| `animals.ts` | 220 | The server: the animals (2026-10-23). |
| `beds.ts` | 47 | Beds and sleeping bags as the server keeps them (2026-10-24, base building's fourth step). |
| `bodies.ts` | 88 | The bodies of the infected, searched as a player's is, and bodies cleared away by an admin. |
| `bodywatch.ts` | 201 | How a body moves, watched for a program walking it: standing on nothing, or to and fro on one spot doing nothing. |
| `botrules.ts` | 51 | The server: the numbers the bot rules go by, kept off the public code (the owner, 2026-10-18: |
| `boxes.ts` | 56 | A base's boxes as the server keeps them (2026-10-24, base building's fourth step). |
| `build.ts` | 327 | The server: base building (2026-10-24, the second step; the rules are src/sim/build/). |
| `camp.ts` | 107 | The server: the trader camp (progression v3; the rules are src/sim/camp.ts and src/sim/jobs.ts). |
| `checks.ts` | 453 | The server: its own checks on where players say they are and what they say they did (moves, hills between, the zone, under the ground, gait). |
| `claims.ts` | 149 | The server: claims, upkeep and rot (2026-10-24, base building's third step; the rules are src/sim/build/upkeep.ts). |
| `craft.ts` | 158 | The server: crafting (2026-10-24, plan-crafting; the rules are src/sim/craft/). |
| `custody.ts` | 72 | Who holds each dog tag that can pay (one in `lootedTags`), as this server saw it change hands (2026-10-23, the owner: |
| `device.ts` | 91 | The server: the devices games run on (2026-10-16). |
| `doors.ts` | 55 | A base's doors as the server keeps them (2026-10-24, base building's fourth step; how a leaf swings, and what it may not swing through, is src/sim/build/doors.ts). |
| `drops.ts` | 130 | The server: supply drops and the helicopter that brings them. |
| `elite.ts` | 32 | The Elite: players whose last payout was at the top rate, each held by their key's hash (nobody's anything), with a crown by their name in chat (the owner, 2026-10-15: |
| `esp.ts` | 69 | An admin's far sight of the things about them (the owner, 2026-10-23: |
| `forge.ts` | 52 | The server: forges (2026-10-25, plan-crafting; the rules are src/sim/craft/forge.ts). |
| `gate.ts` | 746 | The server: who is let in and kept on (a life kept by the server, the bot check, the check that this is a person, bans, admins and roles). |
| `gather.ts` | 142 | The server: gathering (2026-10-24, base building's first step; the rules are src/sim/gather.ts). |
| `handle.ts` | 1083 | The server: handle, every message a player sends, checked and acted on. |
| `index.ts` | 1364 | ZONA game server. One process: serves the built client and runs the shared world over a WebSocket at /ws. |
| `keep.ts` | 789 | The server: what is kept between restarts (the save, the last word before a restart, a life put back). |
| `learn.ts` | 89 | The server: blueprints (progression v3; the rules are src/sim/craft/learn.ts). |
| `locks.ts` | 140 | Locks on a base as the server keeps them (2026-10-24, base building's fourth step; the rules are src/sim/build/locks.ts). |
| `party.ts` | 145 | Parties (2026-10-19), the lite first one: the owner, "players want to be able to team up with eachother, can we do a simple party system, with a very LITE indicator on friendlies ... |
| `perks.ts` | 97 | What players have bought at the store (2026-10-22), as the site's who-has-what list says it (api/store.ts): |
| `pinned.ts` | 52 | A player's name and payout wallet are fixed at their first cashed tag (the owner, 2026-10-22: |
| `plates.ts` | 112 | A store finish put on one gun (2026-10-22), Rust's way. |
| `players.ts` | 478 | The server: its players (who is connected, what each is told of the others, where a fresh one starts), what they send cleaned, and joining and leaving. |
| `queue.ts` | 149 | The server: the line to get in when it is full, and the leaderboard. |
| `raid.ts` | 142 | The server: raiding (base building's fifth step; the rules are src/sim/build/raid.ts). |
| `recycle.ts` | 61 | The server: recyclers (progression v3; the rules are src/sim/craft/recyclers.ts). |
| `roles.ts` | 72 | The server: the roles as the panel's Roles shows them, and whether an admin leaves a dog tag, set by an admin above them. |
| `salvage.ts` | 45 | The server: salvage (2026-10-25, plan-crafting; the rules are src/sim/craft/salvage.ts). |
| `searched.ts` | 217 | Crates, bodies, stashes, drops, furniture and bags lying about, gone through by several at once (2026-10-23, the owner's list: the "Opening…" wait and "Someone else is searching that"; "We should not have cut any... |
| `seen.ts` | 40 | Who has played lately, for the door's "N played today" (the owner, offered a true number in place of fake players to fill the count: |
| `solid.ts` | 134 | A base's pieces as solid as the game has them, where the server judges (2026-10-24). |
| `stash-guard.ts` | 49 | The players' stashes against what this release changed on the map (2026-10-23, the owner: |
| `stash-list.ts` | 19 | Where every stash kept on the map lies, told to the owner alone by /stashes (server/admin.ts), so that a release that changes the map can be checked against them first (scripts/stash-guard.ts; the owner, 2026-10-23: |
| `stash-sight.ts` | 50 | A buried stash is told to a player only once they come near it (the owner, 2026-10-23: |
| `storages.ts` | 55 | Furniture that holds the loot of its own places (src/sim/storage.ts): what is in it, as the server tells whoever opens it, and what they changed. |
| `store-admin.ts` | 54 | An admin's orders to the store's book (2026-10-22), from the STORE tab of their panel (src/ui/admin-store.ts): passed to the site, which keeps the book (api/store.ts), proved as the admin lists are (api/admin.ts):... |
| `tags.ts` | 274 | The server: cashed-in dog tags, who looted whose, and what a tag must have lived through to pay. |
| `throws.ts` | 65 | A thing thrown from somebody's hands, as the server believes it (src/sim/throw.ts has the throw itself): told as it leaves the hand ('toss': from where, how fast, at what power), and believed where its game then says... |
| `west-cars.ts` | 47 | The west's car places (JEEP.refill): which stand a new car this second, and how long one of theirs may stand idle away from home. |
| `world.ts` | 240 | The server builds the same world the clients do, from the same code and seed, so loot points, crates, doors and spawn points line up exactly without sending the map. |
| `worn.ts` | 28 | Whether a player's own dog tag is round their neck, one a killer could take: what every game is told of each player, so that the tag is drawn on them only then (src/game/worn-tag.ts). |

## src/core/

| file | lines | what it is |
|---|---:|---|
| `assets.ts` | 918 |  |
| `audio.ts` | 2762 | Procedural audio. Every sound is synthesised from noise + oscillators at runtime: no licensed sample packs, tiny download, and endless variation per shot/step. Positional sounds use HRTF panners; gunshots get an... |
| `bones.ts` | 137 |  |
| `breathe.ts` | 114 | Work that nobody is waiting on this very frame (a model being made ready for the ground, a body for one of the infected who has come near, pictures sent on ahead to the graphics card) is done a few milliseconds at a... |
| `card-keep.ts` | 260 | Pictures taken off the graphics card that nothing in the world uses any more (2026-10-20, the owner: the card's memory at "7.4 of 8 GB — how do we reduce this?"). |
| `conversion.ts` | 16 | A player pressing to play, counted as a Google Ads conversion (the owner, 2026-10-22: |
| `device.ts` | 86 | What kind of device this is. |
| `embed.ts` | 17 | Played inside itch.io's page (the owner, 2026-10-23: |
| `gamepad.ts` | 326 | A controller (PlayStation, Xbox, any the browser calls "standard"), read each frame, pressing the game's own controls by their names as the keyboard and the phone's buttons do (src/core/input.ts). |
| `gltf-utils.ts` | 178 |  |
| `input.ts` | 206 | Keyboard + mouse with pointer lock. |
| `keys.ts` | 176 | Which key does what, and how fast the mouse turns the head: both the player's to set (2026-10-12: |
| `leave.ts` | 79 | Whether the page is being left on purpose (2026-10-14). |
| `light-reach.ts` | 39 | A lamp's light worked out only where it reaches (2026-10-20, the owner: |
| `near-models.ts` | 32 | Which model files a computer draws with their pictures at 1024 while they are close (DESK_NEAR and `sharpen` in src/core/assets.ts), where everything is drawn at 512. |
| `noise.ts` | 131 | Deterministic noise + RNG. |
| `one-draw.ts` | 133 | See-through things seen from both sides, drawn in one go and not two. |
| `perf.ts` | 202 | Frame profiler + F3 overlay. |
| `physics.ts` | 195 | Rapier (Rust, compiled to WASM) physics. |
| `renderer.ts` | 1080 |  |
| `settings.ts` | 162 | Graphics and sound options (Esc menu, Settings tab). |
| `strips.ts` | 161 |  |
| `tiny.ts` | 61 |  |

## src/dev/

| file | lines | what it is |
|---|---:|---|
| `castle-post.ts` | 165 | `?post` on a development build: the fort on the mountain (src/world/castle.ts, the fort lane's, as its own page `?castle` stands it: on a plain ridge under the game's own sky and sun) with the signals post stood on... |
| `castle.ts` | 291 | `?castle` on a development build: the fort by itself (src/world/castle.ts), stood on a plain ridge under the game's own sky, sun and shadows, with the game's own survivor to walk it. |
| `clip.ts` | 88 | Cutting pictures and short films out of a film that is already made, in a browser: there is no other cutter on the machine. |
| `fit.ts` | 108 | Fitting what is worn on the chest to the body, by measure and not by eye (dev only). |
| `flight-record.ts` | 119 | A play session recorded to be played again, exactly, by the tests (development builds only, never shipped). |
| `harness.ts` | 607 | Development-only test harness (window.T). |
| `loading-film.ts` | 76 | The page's half of scripts/loading-film.mjs: the loading screen's short film for socials (the owner, 2026-10-20: |
| `look.ts` | 294 | Development-only tools for LOOKING at the game (window.D), beside the harness that drives it (window.T). |
| `overlap.ts` | 131 | Where two faces lie in one plane, facing the same way, over the same ground: the two are drawn turn and turn about and the wall flickers there ("z-fighting"). |
| `poster.ts` | 1542 | The squad's map: a poster. |
| `ruins.ts` | 160 | `?ruins` on a development build: the ruined town (src/sim/ruins.ts) stood by itself on land of its own, in the game as it is, to be walked and looked at before it has a place on the map. |
| `sandbox-body.ts` | 180 | The game's own bodies on the sandbox floor (src/dev/sandbox.ts `&bodies=`): each one stood, crouched or lying, holding what it is told and going the way it is told, posed by the game's own Avatar (the motion... |
| `sandbox-build.ts` | 623 | The sandbox's base-building scenes (2026-10-24): each step of base building looked at on the plain floor before the world (the owner: |
| `sandbox-infected.ts` | 117 | The infected in the sandbox as the game draws them (src/dev/sandbox.ts, &infected=): made by the game's own Avatar, with their kind's movements and the look their number gives them, and stepped by the game's own pose... |
| `sandbox-inventory.ts` | 242 | The sandbox's screens (2026-10-24, the owner: |
| `sandbox-sim.ts` | 167 | The sandbox's behaviour checks (2026-10-24, the owner: |
| `sandbox.ts` | 389 | The sandbox (the stage until 2026-10-24, the owner: |
| `sounds.ts` | 476 | Development only: `?sounds` on the dev page (http://localhost:5173/?sounds). Not the game: a page to hear its sounds on, for whoever can hear. Whoever chose the recordings could not, and chose them by their names and... |
| `stance.ts` | 553 | Development-only measure of how a gun is held by a body seen from outside (window.ST), beside the harness that drives the game (window.T). |
| `sweep.ts` | 313 | Development-only numbers for every animation (window.S), beside the harness that drives the game (window.T) and the tools that photograph it (window.D). |
| `towns.ts` | 130 | `?towns` on a development build: a new town (src/sim/towns.ts) stood on level ground of its own in the north-west corner of today's map, in the game as it is, to be walked and looked at before it has its place in the... |
| `viewer.ts` | 85 | A look at models as the game will load them, without starting the game: for whoever is fitting a new one. |

## src/game/

| file | lines | what it is |
|---|---:|---|
| `airdrop.ts` | 363 | The helicopter that brings a supply drop, and the crate coming down under its canopy: what is seen of them and what is heard (2026-10-13). |
| `animals.ts` | 584 | The animals as the game draws them (2026-10-23). |
| `arms.ts` | 513 | First-person arms, for everything that is held and has no hands of its own: a hatchet, a tin of beans, bare fists. |
| `avatar.ts` | 669 | The survivor's body. Used for the local player (the shadow, the flight in from the menu, and the body you see when you look down) and for every other character in the world. |

## src/game/avatar/

| file | lines | what it is |
|---|---:|---|
| `acts.ts` | 233 | What the body is told to do: blows, flinches, deaths, gestures, emotes and the wheel's calls, lying, sitting, leaning; and a clip laid over the rest. |
| `deeds.ts` | 79 | What a survivor's body does besides stepping, on the same motion capture as its steps (src/game/avatar/gait.ts): how it goes down and how it takes a shot (in the body's own blend, in place of the old clips), and the... |
| `dress.ts` | 163 | What the body wears and carries: slung guns, worn gear, the dog tag, and what is on the face that a stock goes round. |
| `gait.ts` | 286 | The body's steps, on motion capture (the owner, 2026-10-25: |
| `gear.ts` | 246 | What is worn, and where it sits on the body: hats, masks and vests on their bones, and what a mask hides of the head under it. |
| `gestures.ts` | 164 | The arms at the things they do of their own: fists up on guard and a punch thrown from it, the hands at work on something that is not a weapon (food, a drink, a dressing), and the wheel's calls (a wave, a point,... |
| `hands.ts` | 240 | The hands: what is held (taken up, put away), the two-bone arms reaching for grips, fingers curled and thumbs laid. |
| `make.ts` | 418 | The body: making it from its file (the skeleton the clips play on, the one drawn, the first-person copy), its look, and putting it away. |
| `pose.ts` | 232 | The body's clips and the numbers they are played by: which clips there are, lying, sitting, the live-tunable POSE table and the stances a gun is held in. |
| `sick.ts` | 120 | The infected's own way of going: feet kept on the ground, the sick gait. |
| `update.ts` | 757 | Each frame: the clips blended by what the body is doing, and everything posed on top of them. |
| `wounds.ts` | 74 | Wounds on the body, and the infected's shared paints while they are unhurt. |

## src/game/

| file | lines | what it is |
|---|---:|---|
| `blast.ts` | 1420 | A blast: a grenade, a drum of fuel, a car going up. |
| `botcheck-strip.ts` | 368 | The bot check as it was until 2026-10-15, kept for the ninth film (src/trailer/shots9.ts), which shows it: the game's own is the round course now (./botcheck.ts). |
| `botcheck.ts` | 452 | The bot check, as the player meets it: a round yard high over the middle of the map, walls and a hut and a catwalk in it, and six figures about it that the server walks and the server shows (src/sim/course.ts: read... |

## src/game/br/

| file | lines | what it is |
|---|---:|---|
| `cut.ts` | 30 | The battle royale's map for a page (2026-10-21): which of the three it is on, and its edge. |
| `look.ts` | 183 | What the battle royale puts in the world to be seen (2026-10-21): a faint ring of its rarity's colour round a thing on the ground, which turns slowly; the circle's edge, a faint wall in the gas's colour; the plane... |
| `mode.ts` | 501 | The battle royale in the game (2026-10-21): what the server says of the match, kept and shown (src/ui/br/hud.ts, ./look.ts), and what this player does in it: the six slots on keys 1-6, F to take a thing or to get a... |

## src/game/building/

| file | lines | what it is |
|---|---:|---|
| `beds.ts` | 115 | Beds and sleeping bags on the death screen (2026-10-24, base building's fourth step; the server's side server/beds.ts). |
| `boxes.ts` | 61 | A base's boxes in the game (2026-10-24, base building's fourth step; the server's side server/boxes.ts): each a store opened with F and filled as a crate is. |
| `claims.ts` | 208 | A base's claim as the game has it (2026-10-24, base building's third step; the server's side server/claims.ts). |
| `doors.ts` | 70 | A base's doors in the game (2026-10-24, base building's fourth step): |
| `draw.ts` | 368 | The bases as they are drawn and stood on (2026-10-24). |
| `flags.ts` | 132 | Each claim's pole and its flag. |
| `icons.ts` | 102 | The wheel's pictures (2026-10-24, the owner: |
| `index.ts` | 922 | Base building as the game has it (2026-10-24, the second step; the rules are src/sim/build/, the server's side server/build.ts). |
| `ladders.ts` | 103 | Ladders in the game (2026-10-24, base building's fourth step): a ladder leant on a wall, and the ladder under a hatch. |
| `locks.ts` | 261 | Locks in the game (2026-10-24, base building's fourth step; the rules src/sim/build/locks.ts, the server's side server/locks.ts). |
| `look.ts` | 322 | How a piece of a base looks (2026-10-24): its solids (src/sim/build/solids.ts) made into one shape for each kind and tier, and one paint for each tier, from Poly Haven's pictures (the owner's yes, plan v2: |
| `models.ts` | 386 | Base pieces drawn from models (2026-10-25: the navigator's queue, "Every Higgsfield model in: items, doors, furniture, palisade, gates"), in place of the boxes their solids are drawn as (src/sim/build/solids.ts). |
| `prints.ts` | 152 | Blueprints in the game (2026-10-24, base building's fourth step; the rules src/sim/build/blueprints.ts). |
| `raid.ts` | 344 | Raiding in the game (src/sim/build/raid.ts the rules, server/raid.ts the server's side). |
| `torches.ts` | 134 | Torches (2026-10-24, base building's fourth step). |
| `wheel.ts` | 97 | The building's two wheels (2026-10-24), on the game's one radial menu (src/ui/radial.ts): the plan's, its groups of pieces round the inside and the pieces of the group pointed at round the outside; and the hammer's,... |

## src/game/

| file | lines | what it is |
|---|---:|---|
| `camera.ts` | 103 | Camera director: the view from the survivor's eyes, and the flight into them from the menu's aerial shot. |
| `camp.ts` | 246 | The trader camp as the game has it (progression v3; the rules are src/sim/camp.ts, the server's side server/camp.ts): its stalls drawn where the camp's layer lays them, each counter's trader (src/game/trader.ts), the... |
| `cellars.ts` | 72 | The basements as the game has them (src/sim/basements.ts): a bulb hung in each of their rooms and over the foot of their steps, lit for whoever is near enough to see by it, and how dark it is down there for the eye. |
| `character.ts` | 93 | A character other than the local player: body, hit zones (head / torso / legs) and health. |
| `craft-forge.ts` | 174 | Forges as the game draws them (2026-10-25, plan-crafting; the rules are src/sim/craft/forge.ts, the server's side server/forge.ts), and the other pieces of crafting drawn by a model of their own (the research table):... |
| `craft-recyclers.ts` | 158 | Recyclers as the game has them (progression v3; the rules and the layer are src/sim/craft/recyclers.ts, the server's side server/recycle.ts): each machine's model where the layer laid it, solid; looked at from close... |
| `craft-salvage.ts` | 81 | Salvage as the game has it (2026-10-25, plan-crafting; the rules are src/sim/craft/salvage.ts, the server's side server/salvage.ts). |
| `craft-wrecks.ts` | 54 | Salvage's wrecks as the game draws them (2026-10-25; the layer is src/sim/craft/wrecks.ts): each wreck's model where the layer laid it, solid to a body and a bullet as the map's own cars are (a box round it), drawn... |
| `crafting.ts` | 271 | Crafting as the game has it (2026-10-24, plan-crafting; the rules are src/sim/craft/, the server's side server/craft.ts). |
| `doll.ts` | 1020 | The survivor in the middle of the inventory, alive. |
| `effects.ts` | 1015 | Impact / weapon effects: billboard particle pool (dust, debris, sparks, blood), bullet-hole decals, muzzle flash light. |
| `finish.ts` | 279 | A finish bought at the store (2026-10-22): the gun's own model, its metal plated in gold or nickel and buffed. |
| `fires.ts` | 352 | Campfires as the game has them (the rules are in src/sim/fires.ts): which fireplaces are alight and for how long yet, the ring of stones and wood that stands at each (cold, or burning), the flames and the smoke of... |
| `flames.ts` | 645 | The flames of a fire: the ones that came with the campfire, moving the way they came, mended. |
| `game.ts` | 2073 | The game: owns every system, runs the frame loop, and decides who is in charge of what. |

## src/game/game/

| file | lines | what it is |
|---|---:|---|
| `drops.ts` | 604 | The game: supply drops, targets when playing alone, and the flow of a life (death, respawn, pause). |
| `enter.ts` | 793 | The game: entering the world (joining a server or playing alone, the bot check's range, dressing the player). |
| `frame.ts` | 784 | The game: every frame (the main loop: input, the world, the camera, the sound, the HUD). |
| `guns.ts` | 505 | The game: attachments and magazines. |
| `hands.ts` | 757 | The game: inventory moves, the hot keys and the hands, and what an admin can do. |
| `hunt.ts` | 73 | The game: gutting and skinning an animal (2026-10-23). |
| `interact.ts` | 442 | The game: what is looked at and done with F (doors, containers, cars, fires, loot). |
| `items.ts` | 760 | The game: using things (eating, healing, reading, the radio) and the emote wheel. |
| `online.ts` | 1062 | The game: multiplayer (what the server says, wired to what is done about it; other players, bodies, stashes). |
| `reclaim.ts` | 40 | The game: a survivor's gear taken back off their own body at one press (the owner, 2026-10-25: |

## src/game/

| file | lines | what it is |
|---|---:|---|
| `garage.ts` | 1124 | Every jeep in this game, and the one the player is sitting in: getting in and out, the view from behind it, who it runs over, what it sounds like, how it burns, and keeping the server (and through it everybody else)... |
| `gas.ts` | 341 | The gas as the game has it. |
| `gathering.ts` | 229 | Gathering as the game has it (2026-10-24, base building's first step; the rules are src/sim/gather.ts, the server's side server/gather.ts). |
| `grenades.ts` | 130 | Thrown grenades. A grenade is a point flying under gravity that bounces off the world and goes off when its fuse runs out. Everyone is told where it left the hand and how fast (see the 'nade' message), and every game... |
| `hands-on.ts` | 285 | Our own arms on a pack drawn round another maker's arms (2026-10-17). |
| `held-mocap.ts` | 76 | First person on the motion capture (the owner, 2026-10-25: |
| `held-size.ts` | 15 | How big a building material is in the hands (2026-10-24). |
| `heli.ts` | 253 | The helicopter as it is in one game (2026-10-14): a Jeep (src/game/vehicle.ts) in everything but how it moves and what turns on it, so that getting in and out, the seats, the view, being told of it by the server and... |
| `horns.ts` | 89 | A car's horn (H, held) and a police car's siren (J, on and off): the owner, 2026-10-14, "we need to add honking to the cars, and maybe a siren for the cop car, but siren not important definitley need honk". |
| `in-fist.ts` | 81 | A thing that is neither gun nor club, in a body's right fist (2026-10-24, moved here out of src/game/doll.ts, where the inventory's figure holds a bandage, a tin, a flask or a magazine so): the way a thing to hit... |
| `infected-kinds.ts` | 115 | The twelve kinds of the infected, and which one each is (the owner, 2026-10-25: |
| `infected-look.ts` | 172 | Each of the infected dressed as no other of its kind is (2026-10-25, from the owner's AAA bar: |
| `infected-moves.ts` | 78 | How the infected move: motion capture from Higgsfield's library (the owner, 2026-10-25: |
| `infected.ts` | 1388 | The infected, as this game draws and (for the ones near its own player) moves them. |
| `key-hints.ts` | 163 | The keys that do something now, for the bottom-left corner: swapped as what the player is doing changes. |
| `lamps.ts` | 378 | Lamps: the lights people carry, the ones a jeep drives behind, and the ones that stand in the street. |
| `lockers.ts` | 193 | The doors and lids of what is searched (the rule is in src/sim/crates.ts, HUNG): a locker's leaves and a crate's lid, hung on their hinges, shut until somebody has the thing open and swung wide for as long as they do. |
| `look.ts` | 262 | What a survivor looks like: jacket and trouser colours, skin, hair. |
| `loot.ts` | 1176 | World items: the Central Economy decides *what* exists where; this module gives each entry a mesh + an interaction trigger, rests it properly on whatever it lies on (shelf, table, floor, sloped ground) and manages... |
| `menu-order.ts` | 90 | Which of the menu's scenes are shown first, which are said to be new, and what a browser remembers of having been shown. |
| `menu-scenes.ts` | 1709 | What goes on behind the menu before a game is started: the Zone itself, with things happening in it. |
| `mocap-switch.ts` | 8 | The hands on motion capture (the blow, the jab, the sips and a grenade's follow-through in first person, and the body's blow, jab and drink seen by everybody: src/game/held-mocap.ts, the slash and the drink of... |
| `modes.ts` | 144 | The three games of one page (the owner, 2026-10-21: |
| `muzzle.ts` | 131 | The flash at a muzzle: burning gas, seen for two or three frames. |
| `my-perks.ts` | 31 | What this player has from the store, as their server says it (S2C 'perks', server/perks.ts): the finishes they may put on their guns (Apply in the inventory: server/plates.ts), VIP (a gold dog tag round their neck),... |
| `near.ts` | 172 | What is near is drawn with its pictures at the size they came; what is far, with the world's copies. |
| `party.ts` | 108 | Your party (2026-10-19, the lite first one: see server/party.ts). |
| `player.ts` | 1448 | First-person survivor: kinematic character controller (Rapier), movement model, stamina / vitals, camera feel (bob, lean, landing dip) and footsteps. |
| `procedural.ts` | 326 | The few meshes that have no scanned model: small machined parts built from a lathe profile, with a parkerised-steel material, and the stamped dog tag. |
| `racks.ts` | 201 | Gun racks that show what stands in them (the owner, 2026-10-17: |
| `remote.ts` | 730 | Other players. Each one is a body driven by the poses the server relays: interpolated a little in the past so movement is smooth, with hit zones your bullets and fists can land on, the weapon they are holding in... |
| `riders.ts` | 67 | The dead who ride on (2026-10-14). |
| `rig.ts` | 561 | A weapon pack in the hands of whoever holds the gun: the pack's own arms and its own gun, moved by its own animation. |
| `survivors.ts` | 500 | The survivors a player can be, and what they wear over their own skin (the owner, 2026-10-24: |
| `throwing.ts` | 162 | G, in the game: a tap puts what is in the hands down at the feet; held, a throw winds up, the bar filling with how long it is held, and letting go throws it along the way the player looks, as hard as the bar says... |
| `trader.ts` | 91 | The traders as they are seen: a body behind each counter of the trader camp, the shop at the trading post and the stalls before it (src/sim/camp.ts says where they stand, what each sells and for what). |
| `vehicle.ts` | 623 | The jeep as it is in one game: a body on four sprung wheels, driven here or shown as somebody else drives it. |
| `voice.ts` | 352 | Talking to whoever is near (hold V). |
| `weapons.ts` | 5272 | Gunplay: viewmodel (own scene/camera), procedural animation (equip, bob, sway, recoil springs, bolt cycling, reloads), ballistics with gravity + drag simulated in sub-steps against the physics world, zeroing, scope +... |
| `worn-tag.ts` | 150 | The dog tag worn on the chest (2026-10-22), so that a tag is seen on everybody: steel, or gold on a VIP. |
| `wreck-fire.ts` | 141 | The jeep that burns before the fort's gate, as the game has it (the rules are in src/sim/wreck-fire.ts, and where it stands is the fort's to say: src/sim/castle.ts). |

## src/

| file | lines | what it is |
|---|---:|---|
| `main.ts` | 379 |  |

## src/net/

| file | lines | what it is |
|---|---:|---|
| `bait.ts` | 39 | window.__game was the whole game, open to the console of every player's page, until 2026-10-20: a script passed round among players reached through it to draw everybody through walls and light the night (the owner,... |
| `client.ts` | 485 | Client side of the game connection. |
| `device.ts` | 150 | The device this game runs on, boiled down to one hash and sent with `hello` (PROTOCOL 44). |
| `orders.ts` | 234 | The orders an admin or a mod can give on the game server, typed where talk is typed (2026-10-11). |
| `protocol.ts` | 778 | Wire protocol between the game client and the server. |
| `timeline.ts` | 122 | When a report of somebody else's player was TRUE, as against when it got here. |

## src/sim/

| file | lines | what it is |
|---|---:|---|
| `airdrop.ts` | 484 | The supply drop comes by helicopter (2026-10-13: |
| `animal-calls.ts` | 26 | The animals' calls (2026-10-23): when a herd is heard, and which of it. |
| `animal-fight.ts` | 391 | The animals that fight (2026-10-23): a bear's warning, rush and chase, and a wolf pack's hunt of whoever comes too near, and, hungry, of deer (src/sim/animal-mind.ts calls these for its own). |
| `animal-ground.ts` | 288 | The ground as the animals know it (2026-10-23): what kind of country a place is (field, forest, rock, snow, desert, water, a town), whether an animal can stand there, and whether it can see from one place to another. |
| `animal-mind.ts` | 850 | The animals' minds (2026-10-23): the herds, their ground and their day, what frightens them, the bear's charge and the wolves' hunt. |
| `animal-places.ts` | 144 | Where the animals are (2026-10-23): the herds' ground, each one's place in its herd and room from the rest, and whether a place will do for one (src/sim/animal-mind.ts calls these for its own). |
| `animals.ts` | 345 | Animals (2026-10-23). The owner: "We also need animals ... it may be time to implement hunting as a food source", and of how: "regarding animal logic just ask what does dayz or rust do and copy/revamp their... |
| `apart.ts` | 90 | The places stocked apart from the rest of the map, on top of it: the fort, the hamlet on its track, the wreck under the bridge, every cellar, Kalat and the new towns, the canyon pass. |
| `barrels.ts` | 31 | Fuel drums. The red barrels standing about the yards and sheds go up when a bullet finds them, and take whoever is standing near with them: a thing to shoot at instead of the man behind it, and a reason to look at... |
| `basements.ts` | 553 | Basements (2026-10-14). |
| `blood.ts` | 96 | Blood, which is not health (2026-10-13). |
| `box-ops.ts` | 143 | What is done in a crate, a body, a stash, a drop, a piece of furniture or a bag lying on the ground, as moves of one thing each (2026-10-23, the owner, of "Someone else is searching that": players locked out of a... |
| `bridge.ts` | 103 | The bridge on the loop road (2026-10-13: |

## src/sim/build/

| file | lines | what it is |
|---|---:|---|
| `bases.ts` | 402 | Every base on the map, as the server keeps them (server/build.ts) and as a game played alone keeps its own (src/game/building/index.ts): laid, nailed up, taken down, and kept in the save as short as it can be said. |
| `blueprints.ts` | 113 | Blueprints (2026-10-24, base building's fourth step). |
| `doors.ts` | 85 | Doors, hatches, shutters and gates as they swing (2026-10-24, base building's fourth step). |
| `land.ts` | 78 | Where a base may stand (2026-10-24): out in the country, and not on a tree or a rock. |
| `locks.ts` | 70 | Locks on a base (2026-10-24, base building's fourth step). |
| `pieces.ts` | 194 | What a base is built of (2026-10-24, base building's second step; plan v2, approved by the owner with "think like rust how does rust do it"): |
| `raid.ts` | 99 | Raiding (base building's fifth step; the navigator's order: |
| `rooms.ts` | 104 | A room shut in stone (2026-10-24). |
| `snap.ts` | 525 | Where a piece can go (2026-10-24, base building's second step): |
| `solid.ts` | 383 | What of a base stops a body, a round and a blast, and what lies on it (2026-10-24). |
| `solids.ts` | 350 | What each piece is made of, as solids in its own frame (2026-10-24): boxes, upright prisms and a few hulls, the same list drawn by the game (src/game/building/draw.ts) and made into what stops a body and a bullet. |
| `upkeep.ts` | 93 | Upkeep and rot (2026-10-24, base building's third step). |

## src/sim/

| file | lines | what it is |
|---|---:|---|
| `bunker.ts` | 881 | The bunker: a place under the ground on the far side of the map from the Chemical Works. |
| `camp.ts` | 212 | The trader camp (progression v3, the owner's yes 2026-10-25: |
| `castle-post.ts` | 477 | ORLINOYE, "the Eagle's Nest": the fort on the mountain as the army's signals and observation post, above ground. |
| `castle.ts` | 31 | The fort on the mountain: four round towers at the corners of a near-square, a square keep in the middle of it, a paved terrace all round between the two, and one way in, over a timber ramp from a rock on the east. |

## src/sim/castle/

| file | lines | what it is |
|---|---:|---|
| `ask.ts` | 215 | Questions asked of the fort at a point: under it, in its dark, what it cuts out of the ground, what it hides, its foot; and where the world set its loose pieces. |
| `loose.ts` | 283 | The fort's loose pieces: the ruined houses below it, the curved and long walls, the rocks, and the hatch with its passage under the ground. |
| `loot.ts` | 336 | What is in the fort and about it: its loot places by tier, the burning jeep before its gate, its props and lamps as the world has them, where the infected start, and where a thing may be stood. |
| `parts.ts` | 694 | The fort's parts: its whole layout (walls, keep, gatehouse, stairs, vaults), the kit pieces, its door, the rock it stands on, its fire baskets, furniture and lamps. |
| `plan.ts` | 452 | The fort's plan, its measures and words: where everything of it is (CASTLE, UNDER), what a part is, how its own measure is turned into the world's, its ground and its towers' girth. |

## src/sim/

| file | lines | what it is |
|---|---:|---|
| `combat.ts` | 165 | Damage rules. The server uses these to decide how much a reported hit hurts, so a client can say "I hit player 7 in the head with a Mosin" but never "for 5000 damage". |
| `condition.ts` | 44 | How worn a thing that is worn is: |
| `cooking.ts` | 872 | Cooking spots (2026-10-13): whatever a fire is made in and food is made hot on. |
| `course.ts` | 591 | The bot check's 360-degree course: the yard, the six figures the server walks and shows, and the judge of a go. |

## src/sim/craft/

| file | lines | what it is |
|---|---:|---|
| `forge.ts` | 98 | The forge (2026-10-25, plan-crafting, ours: |
| `layer.ts` | 79 | Room on the map for crafting's layers of their own (2026-10-25: the wrecks, the recyclers, the trader camp's stalls). |
| `learn.ts` | 96 | Blueprints (progression v3, the owner's yes 2026-10-25: |
| `materials.ts` | 27 | Crafting's materials, their ids, piles and the forge's ratio, in one place (the navigator, 2026-10-25: |
| `places.ts` | 49 | Where a workbench's, a forge's or a research table's work is done (2026-10-25): near one of them standing in a base, any base's (Rust's bench is anybody's who stands at it). |
| `plan.ts` | 180 | What a craft takes out of a set of pockets, and what comes of it (2026-10-24): one rule, read by the game for its screen and by the server, which judges every craft on its own copy of the pockets (as building does). |
| `recipes.ts` | 126 | Every recipe, as data (2026-10-24, plan-crafting; progression v3, the owner's yes 2026-10-25). |
| `recyclers.ts` | 207 | Recyclers (progression v3, the owner's yes 2026-10-25: |
| `salvage.ts` | 102 | Salvage (2026-10-25, plan-crafting: |
| `wrecks.ts` | 78 | Salvage's wrecks (2026-10-25, plan-crafting: |

## src/sim/

| file | lines | what it is |
|---|---:|---|
| `crates.ts` | 211 | Searchable crates that are part of the map (the army's cases at the checkpoints, wooden crates in barns, sheds and yards, the lockers and cabinets). |
| `daynight.ts` | 82 | Day and night. The Zone has a day of thirty-two minutes: three quarters of it light (first light, a long day, dusk) and one quarter, eight minutes, night. The night is kept shorter than the time a dog tag has to be... |
| `desert.ts` | 160 | The desert's places for whoever starts on the coast (2026-10-18), the owner: |
| `drops.ts` | 256 | Supply drops. Every few minutes, while anybody is playing, a crate of the best things on the map is set down somewhere in the open and everyone is told where. It is there for a few minutes, or until somebody has... |
| `economy.ts` | 893 | Central Economy, modelled on DayZ's types.xml: every item type has a world-wide nominal (target) count, a minimum that triggers restocking, a lifetime after which untouched loot despawns, and usage tags that decide... |
| `emotes.ts` | 129 | The wheel (hold T): things to call out without a microphone, and things to do with the body. |
| `fires.ts` | 140 | Campfires. The rings of stones at the lodges, the cabins and the hamlet can be lit. A fire is somewhere to mend: resting beside one puts health back far faster than it comes back on its own, and what is eaten beside... |
| `gas.ts` | 154 | The gas. One place on the map is sunk in it (the Chemical Works, in the cirque behind the checkpoint: the map's first expansion). A low dome of it lies over the place, thickest at the middle and thinning to nothing... |
| `gather.ts` | 173 | Gathering (2026-10-24, base building's first step): trees felled for logs, boulders broken for stone, logs sawn into planks, and the tools wearing out as they work. |
| `grenades.ts` | 288 | Grenades: what is thrown, how its fuse runs, and what the server believes of one. |
| `gunplay.ts` | 386 | How the guns shoot. One place for what each cartridge does in the air and what each gun does with it, read by the game (a bullet's flight, the kick, the cone a shot can land in, what its sights are set for) and by... |
| `heard.ts` | 57 | How far off a shot is heard (2026-10-19), by the round it fires: as loud as its distance makes it out to the first figure, then falling away steeply to nothing at the second. |
| `heli.ts` | 181 | The helicopter a player flies (2026-10-14), its rules shared by the game and the server: what it is, how it flies (src/game/heli.ts flies it by these numbers), and where it stands when the world is new. |
| `hitclock.ts` | 24 | How often a shooter's hits on one body are believed (server/tags.ts, mayHit): no oftener than the gun fires, over a run of them, with one allowed a gap early when the one before came late. |
| `infected.ts` | 644 | The infected: the people who lived here, and did not leave. |
| `injury.ts` | 34 | A broken leg. A hard enough landing breaks one, and so, as often as not, does a bullet in the legs. On a broken leg nobody runs or jumps: it is a limp until it is set (a splint, or a first aid kit), or until it has... |
| `inventory.ts` | 1229 | Grid inventory (DayZ / Tarkov style). |
| `items.ts` | 608 |  |

## src/sim/items/

| file | lines | what it is |
|---|---:|---|
| `build.ts` | 119 | What a base is built from, and the tools that get it (2026-10-24, base building's first step; the rules of gathering are src/sim/gather.ts). |
| `craft.ts` | 101 | What crafting makes and is made of (2026-10-24, plan-crafting: the owner, "We need some sort of crafting like how rust has crafting ... |
| `guns.ts` | 352 | The guns, what they fire and the boxes it comes in. |
| `hunt.ts` | 83 | What a hunt gives, and what keeps a hunter well (2026-10-23, with the animals: src/sim/animals.ts). |
| `kit.ts` | 206 | What you hit with, eat, drink and mend with. |
| `parts.ts` | 290 | Magazines, and what is fitted to a gun. |
| `rules.ts` | 139 | What an item's `loot` says: |
| `tools.ts` | 98 | Tools and odds and ends, the dog tag, and what things are kept in. |
| `wear.ts` | 455 | What is worn and carried. |

## src/sim/

| file | lines | what it is |
|---|---:|---|
| `jobs.ts` | 55 | Work the trader has. Three jobs a day, the same three for everybody (they come out of the date): the infected to be put down, something common to be brought in, something that has to be gone and got. Paid in scrap... |
| `kit.ts` | 565 | A KIT of building pieces, and a LAYOUT made of them. |
| `kits.ts` | 113 | Whole sets of gear an admin can hand out in one go (2026-10-11): |
| `lipki.ts` | 114 | Lipki, the woodcutters' hamlet in the birch woods (2026-10-16, reworked): where its houses and what lies about them stand. |
| `load.ts` | 70 | What a load does to whoever carries it (2026-10-13: |
| `mokroye.ts` | 190 | Mokroye, the flooded hamlet in the swamp (2026-10-16, new): where its houses, boardwalks and what the water left stand. |
| `news.ts` | 202 | Hearts and comments on the entries of the changelog (2026-10-12: |
| `outposts.ts` | 225 | The small places of the open country (2026-10-23, the owner: |
| `ozerki.ts` | 75 | Ozerki, the fishing village on a lake in the north woods (2026-10-16, new): where its houses, piers and what lies about them stand. |
| `pass.ts` | 625 | THE PASS through the ridge, and its caves, as a plan (plan v5, the owner, 2026-10-16: |
| `placement.ts` | 28 | Whether an item can physically lie at a loot point. |
| `pokrov-towers.ts` | 254 | Inside Pokrov's corner towers (2026-10-19). |
| `pokrov.ts` | 159 | Pokrov, the white-walled monastery and the town outside its gate (2026-10-16, reworked): where its buildings and what lies about them stand, and the terrace it stands on. |
| `posts.ts` | 98 | The army's field posts in the west: a WW2 pillbox (the model "WW2 Field Bunker" by Golden, the one stood over Bunker 17's stair: see src/world/bunker.ts) by four of the western roads, its door to the road, a rack, a... |
| `powers.ts` | 112 | Four of an admin's tools that are about what is carried (2026-10-13: |
| `range.ts` | 359 | The bot check (2026-10-12: |
| `reclaim.ts` | 64 | A survivor's gear taken back off their own body at one press (the owner, 2026-10-25: |
| `ruins-keep.ts` | 180 | The keep in Kalat's flat middle (2026-10-24, the owner: |
| `ruins.ts` | 1303 | The ruined walled town in the desert: a palace-fort at its point, the best stretch of its wall with three towers, the bent gate over a causeway, a quarter of dug-out houses, the footings of the north wall with four... |
| `save.ts` | 58 | Local persistence for the single-player slice. |
| `sickness.ts` | 47 | Food poisoning (2026-10-23, with the animals; DayZ's). |
| `slopes.ts` | 236 | Steep ground: what legs can do on it. |
| `stash.ts` | 36 | Where a stash can be put under the ground (2026-10-12): out in the country, and nowhere else. |
| `storage.ts` | 107 | What can be searched, in one place: every model that holds things (a crate, a locker, a cabinet, a desk...), what it is called, how big its grid is, and where what is in it comes from. |
| `survivor.ts` | 48 | Who a survivor is: which of the bodies, and which voice calls out for them (the owner, 2026-10-24: |
| `throw.ts` | 92 | A thing thrown from the hands (the owner, 2026-10-23: |
| `tiers.ts` | 38 | The steps of the map. Every place a thing can lie is on one of five, and every sort of thing is kept on the steps it belongs to (src/sim/economy.ts): what a new arrival finds at the edge is not what is kept down the... |
| `town-parts.ts` | 128 | The towns grown (2026-10-23, the owner: |
| `towns.ts` | 350 | The new towns of the map three times over (2026-10-16): where each building stands, and the monastery's walls as pieces of the fort kit. |
| `vehicles.ts` | 387 | Jeeps. A handful stand along the road and a few more out at the edge of the map, behind the outlying places; anybody can get in one and drive it, three more can ride, and it can be shot until it burns. It is the fast... |
| `voice.ts` | 29 | Talking to whoever is near (src/game/voice.ts): what the server and the game both go by. |
| `walkways.ts` | 44 | Walkways of boards on posts, from the pier kit (Poly Haven's modular wooden pier, src/world: pier_kit): a fishing village's piers, a swamp's boardwalks (2026-10-16). |
| `watchtowers.ts` | 59 | Watchtowers: Pokrov's bell tower stood alone about the map (the owner, 2026-10-19, of the tower north of its church: "the watch tower we have in pokrov is super cool we should add those around the map i will put... |
| `water.ts` | 262 | Lakes and rivers, as rules: where the water is, how deep, which way it runs, and what it does to whoever walks into it. |
| `wells.ts` | 111 | Wells, and what hunger and thirst do before they kill. |
| `wreck-fire.ts` | 103 | The jeep that burns before the fort's gate, for good (the owner, 2026-10-14: |
| `zastava.ts` | 70 | Zastava, the post at the pass's east mouth (2026-10-16, new, plan v5): where its buildings and what lies about them stand. |
| `zavod.ts` | 83 | Zavod, the brick works by the river (2026-10-16): where its buildings and what lies about them stand. |

## src/trailer/

| file | lines | what it is |
|---|---:|---|
| `arena26.ts` | 180 | The gameplay trailer's Arena (shots26.ts): one round at the fort, as the eleventh film made the Arena (shots11.ts: its measure of the fort, blue's two up the ramp and in at the gate, red on the keep's landing, and... |
| `brbots.ts` | 68 | The other players in the battle royale's film (shots25.ts): sockets this page opens to the film's arena server (tools/br-film/vclock.mjs, whose clock the film moves on frame by frame) and moves itself, as people move... |
| `director.ts` | 941 | The trailer's director. |
| `footage.ts` | 88 | Footage one cut lays into another (2026-10-23, for the gameplay trailer, shots26.ts): the pictures another take kept frame by frame (film.mjs --frames <dir>: tools/trailer/out/<dir>/<frame>.jpg and sounds.json),... |
| `human.ts` | 303 | Movement with somebody behind it, for the films from the twenty-first on (2026-10-19, the owner: |
| `kit26.ts` | 298 | The gameplay trailer's set (shots26.ts): the ground and what stands in the way, the jeep on its road with friends in the back and the helicopter told where it is, the infected with their own minds, and the house in... |
| `music.ts` | 341 | The trailer's score, written as code: one row per bar (the chord, and how hard the band plays it), in D minor at 128 beats a minute, so a bar is 1.875 s and every cut in shots.ts lands on a bar line. |
| `music10.ts` | 352 | The tenth film's score: an old fort in the snow, slow and grand. |
| `music14.ts` | 612 | The fourteenth film's score ("What goes up", shots14.ts): the ninth's band (music9.ts, which says what each part is and how it is made), playing a tune of its own. |
| `music15.ts` | 251 | The fifteenth film's score ("Emotes", shots15.ts): club music, made here from nothing but oscillators and noise, as every score of these films is. |
| `music16.ts` | 404 | The sixteenth film's score ("This week in ZONA", shots16.ts): a trailer's, made here from nothing but oscillators and noise, as every score of these films is. |
| `music17.ts` | 630 | The seventeenth film's score ("The man in the window", shots17.ts): the ninth's band as the fourteenth had it (music9.ts says what each part is and how it is made), playing a tune of its own. |
| `music3.ts` | 533 | The third trailer's score. |
| `music8.ts` | 374 | The eighth film's score, and nothing of the other seven in it. |
| `music9.ts` | 630 | The ninth film's score, and none of the other three bands in it. |
| `reel.ts` | 168 | A ten-second film of the changelog alone, as a call to check it and follow the game being made (the owner, 2026-10-15: |
| `shots.ts` | 843 | The trailer, shot by shot. |
| `shots10.ts` | 896 | The tenth film: twenty seconds of the fort. |
| `shots11.ts` | 781 | The eleventh film: ten seconds of the Arena (2026-10-14). |
| `shots12.ts` | 968 | The twelfth film: thirty seconds of what is new (2026-10-14). |
| `shots13.ts` | 936 | The thirteenth film: thirty seconds of the Arena, and the wagers coming to it (2026-10-14). |
| `shots14.ts` | 1225 | The fourteenth film: "What goes up" (2026-10-14). About two minutes, the real game on a clock that only moves when the film says, as the others were. Asked for as "we should choreograph a story and make a short film... |
| `shots15.ts` | 330 | The fifteenth film: "Emotes" (2026-10-15). The owner: "make a trailer showing some of the emotes leading with balon the one i like, dance music, hype, dont have to render in the world can do it in a virtual space to... |
| `shots16.ts` | 462 | The sixteenth film: "This week in ZONA", for X (2026-10-15). Asked for as "we need a marketing post for our X some video trailer", the board marketing/plan-film-16.html said yes to with "make sure its powerful... |
| `shots17.ts` | 1767 | The seventeenth film: "The man in the window" (2026-10-16). A story, the real game on a clock that only moves when the film says. The owner: "a high quality trailer ... origional ... should tell a story ... maybe... |
| `shots18.ts` | 208 | The eighteenth film, 15 seconds: |
| `shots19.ts` | 218 | The nineteenth film, 15 seconds: |
| `shots2.ts` | 1384 | The second trailer: what has changed in the Zone. |
| `shots21.ts` | 748 | The twenty-first film, 70 s: |
| `shots22.ts` | 171 | The twenty-second film, 22 s: |
| `shots23.ts` | 207 | The twenty-third film, 15 seconds: the 9A-91 and the Barrett's bipod (the owner, 2026-10-20: |
| `shots24.ts` | 543 | The twenty-fourth film, 26 s: |
| `shots25.ts` | 712 | The twenty-fifth film, about 29 s: the battle royale (2026-10-21, the owner: |
| `shots26.ts` | 795 | The twenty-sixth film, about 70 s: the gameplay trailer (2026-10-23, the owner: |
| `shots27.ts` | 787 | The twenty-seventh film, about 31 s: the battle royale for the gameplay trailer (shots26.ts lays these pictures in, kept frame by frame by film.mjs --frames). |
| `shots3.ts` | 1664 | The third trailer: a story, and then how the money works. |
| `shots4.ts` | 1452 | The fourth trailer: the Zone has grown, and everything the other three were about. |
| `shots5.ts` | 982 | The fifth trailer: the infected, and what comes after them. |
| `shots6.ts` | 1214 | The sixth trailer: everything so far, in three minutes (96 bars at 128 BPM). |
| `shots7.ts` | 442 | The seventh film: a teaser of fifteen seconds (8 bars at 128 BPM) for what the Zone has gained. |
| `shots8.ts` | 918 | The eighth film: forty-five seconds (18 bars at 96 BPM) on what the guns have become, and what the hands now do. |
| `shots9.ts` | 1864 | The ninth film: "Nothing stays buried". Two minutes and twenty-four seconds (72 bars at 120 BPM), made the way the others were: the real game on a clock that only moves when the film says. |

## src/ui/

| file | lines | what it is |
|---|---:|---|
| `act-icons.ts` | 47 | What an entry of the inventory's menu does, as a small solid symbol before its words (the right button on a thing): so that a long menu is read at a glance. |
| `admin-store.ts` | 466 | The admin panel's STORE tab (2026-10-22). |
| `admin-ui.ts` | 1751 | The panel of somebody with a role (2026-10-11; laid out again 2026-10-12). |
| `ads.ts` | 52 | Google Ads: its tag on the site, and its conversion sent once a page as the page is loaded (the owner, 2026-10-18, giving Google's own event snippet for the account's "Page view" conversion: |
| `adsense.ts` | 60 | Ads in the game's page (2026-10-22), through public/ads.js, on the live site only and never for a VIP or a no-ads buyer (what this browser has bought, asked of the site afresh, at most an hour old). |
| `arena-hud.ts` | 174 | The arena's own screen (2026-10-14). |
| `arena-menu.ts` | 233 | The Arena's own front (2026-10-14), its menu and the screens between matches. |
| `bigmap-names.ts` | 158 | Where the big map's names go, so that none lies on another (the owner, 2026-10-19, of the whole map: |
| `bigmap.ts` | 1634 | The map, opened large (M), drawn as the owner's picture of it is (2026-10-17: |
| `bookmark.ts` | 83 | A place the player marks on the map for themself (double-click or double-tap the sheet opened large, M): a pin there, and the same pin on the corner map, on its rim when the place is out of its view, with how far it is. |

## src/ui/br/

| file | lines | what it is |
|---|---:|---|
| `hud.ts` | 270 | The battle royale's screen (2026-10-21), the owner: |
| `menu.ts` | 236 | The battle royale's own front (2026-10-21), laid out as the Arena's is (src/ui/arena-menu.ts: a bar of tabs, the play panel with a side panel for friends), the owner: |

## src/ui/

| file | lines | what it is |
|---|---:|---|
| `craft-card.ts` | 178 | A recipe's card (2026-10-24, plan-crafting): what it makes, what it needs with what you carry in green and red, the place it needs, its time, how many (1, 5, the most), and Craft. |
| `crafting-ui.ts` | 241 | The Crafting tab (2026-10-25, plan-crafting): the inventory's left and middle turned to crafting, Carried kept on the right, where what the chosen recipe needs lights up. |
| `discord.ts` | 14 | The way in to the Discord, as a button beside every Store (the owner, 2026-10-24: |
| `dogtag.ts` | 166 | The dog tag on the menu: two steel tags on a ball chain, the player's name stamped into the front one as it is typed. |
| `door.ts` | 170 | The door (2026-10-14): zonapvp.fun asks what the visitor came for before anything is built. |
| `elite-crown.ts` | 37 | The Elite's crown by a name in chat, and a word about them with the pointer on it (the owner, 2026-10-15: |
| `emotes-menu.ts` | 241 | Emotes: the sixteen slots of the wheel (hold T) set by the player, each thing there is to call out or do watched first on the survivor (the owner, 2026-10-14: |
| `howto-more.ts` | 87 | The How to Play card's second half (the owner, 2026-10-19: |
| `hud.ts` | 2185 | A lean HUD: small vitals, a compass strip, a corner map (src/ui/minimap.ts), prompts only when relevant. |
| `icons.ts` | 500 | Inventory icons rendered from the real 3D models at startup (no hand-made sprites). |
| `inv-card.ts` | 107 | What a thing is, and what to do with it (idea 15 of Fettah, a contributor, 2026-10-18). |
| `inv-piles.ts` | 166 | The inventory's tidying (Fettah's inventory pull request, a contributor's, 2026-10-18): a grid sorted kind by kind, piles of one thing joined, a bag's weight, and which things feed one another. |
| `inv-search.ts` | 21 | The search box at the top of Carried (idea 5, 2026-10-18: typing "9mm" dims everything else, lit as the things that go with a chosen one are). |
| `inv-take.ts` | 20 | The buttons over a crate or a body (idea 10, 2026-10-18): |
| `inv-types.ts` | 59 | A bag set for a kind of thing (2026-10-23, the owner: |
| `inventory-ui.ts` | 3211 | DayZ-style inventory. Three columns: Vicinity what is on the ground around you, and the crate / stash / body you opened Character the survivor with the places for what is worn either side of them (the rules' own... |
| `keypad.ts` | 109 | A lock's panel (2026-10-24, base building's fourth step, the owner: |
| `keys-view.ts` | 42 | The keys that do something now, drawn in the corner under the hands' mouse (what they are is src/game/key-hints.ts). |
| `kind-icons.ts` | 85 | What kind of thing an item is, as a small symbol in the top right of it in the inventory and on its hot keys, in the colour of its kind: so that a gun, its rounds, a bandage or a tin is told at a glance without the card. |
| `loading-fx.ts` | 382 | The loading screen's blood and the part of its motion that answers the player. |
| `loading-pumpkins.ts` | 118 | Pumpkins round the title on the loading screen, for October. |
| `loading-screen.ts` | 135 | The loading screen's bar and the line under it. |
| `minimap.ts` | 592 | A small map in the corner of the screen: the ground, the forest, the road, the buildings, and an arrow for where you are and which way you face. |
| `person.ts` | 104 | The check that it is a person who is asking to play, and not a program (2026-10-12: connections made by a program came by the dozen, and stood in the world as players). |
| `platform.ts` | 33 | ZONA PvP, the platform both games stand under (2026-10-14). |
| `radial.ts` | 278 | One radial menu for every wheel of the game (2026-10-24, the owner: |
| `rewards.ts` | 424 | Dog tags and creator rewards: the illustrated explanation a player sees on entering the site, and the wallet address they give. |
| `rotate.ts` | 34 | The screen a phone shows while it is held upright. |
| `shop.ts` | 184 | A stall's counter at the trader camp (progression v3: |
| `status-view.ts` | 248 | The survivor's state, drawn: a row of symbols in the corner of the game, and the same row again in the inventory. |
| `status.ts` | 265 | How a survivor's state is read: an icon each for health, blood, food and water, drawn in the colour of how it stands, with arrows beside it for which way it is going and how fast; and a badge for each thing that is... |

## src/ui/store/

| file | lines | what it is |
|---|---:|---|
| `account-pane.ts` | 28 | The store's part of Settings' Account page (2026-10-22): what this browser's account has (VIP and its days, no ads, the finishes), the account it is all kept under, and the way to the store. |
| `account.ts` | 87 | This browser's account at the store, and what it has (2026-10-22). |
| `panel.ts` | 253 | The store (2026-10-22): what is for sale, and paying for it with no wallet connected. |

## src/ui/

| file | lines | what it is |
|---|---:|---|
| `touch.ts` | 271 | On-screen controls for phones and tablets. |
| `updates.ts` | 153 | The game's news in a corner of its main menu: the last few posts of its X account, each with what it says, its picture or film, and a way to it on X. |
| `wheel-slots.ts` | 58 | The emote wheel's sixteen slots as this player has set them (Emotes, opened from the wheel: src/ui/emotes-menu.ts), kept in this browser. |
| `who.ts` | 43 | Which survivor you are, picked on the main menu as DayZ has it (the owner, 2026-10-24: |

## src/world/

| file | lines | what it is |
|---|---:|---|
| `atmosphere.ts` | 1011 | Sky, sun, image-based lighting, cascaded shadows and height fog. |
| `basement-build.ts` | 172 | What a basement is made of (src/sim/basements.ts says where its rooms, steps and things are): its walls, floors and ceilings, a frame of timber round every way through, its flights, and up in the yard the kerb round... |
| `batch-cull.ts` | 91 |  |
| `big-buildings.ts` | 999 | The two buildings of several floors (2026-10-11): the district hospital in Kamenka and the police headquarters at the edge of the village. |
| `bridge.ts` | 679 | The road bridge as it is built (see src/sim/bridge.ts for what a bridge is, in figures, and src/world/worldgen.ts for where one stands): a reinforced-concrete road bridge of the kind the country it stands in built by... |
| `buildings.ts` | 3791 | Procedural buildings: walls with door/window cut-outs (two material layers), floors, ceilings, gable / shed / flat roofs, window frames + glass, hinged doors, hand-authored interior layouts with Poly Haven furniture,... |
| `bunker.ts` | 966 | The bunker as it is built (see src/sim/bunker.ts for what and where): the pad over the hole, the hut, the stair, the first level with its passage, rooms and benches, the door a keycard opens, the sealed way down, and... |
| `canyon-beds.ts` | 46 | THE CANYON'S BEDS as a chunk of shader (the terrain's, src/world/terrain.ts, and any other rock of the canyon: the carved rock round the caves' mouths, rock-blend's face), so that where a piece meets the wall its... |
| `castle-post-shape.ts` | 439 | The signals post on the fort (src/sim/castle-post.ts): the shapes of what is made by hand, as plain numbers. |
| `castle-post.ts` | 289 | The signals post on the fort (src/sim/castle-post.ts), as it is drawn and as it stops a body: what the game has no model for and is made here by hand. |
| `castle-shape.ts` | 21 | The fort's pieces (src/sim/castle.ts) as shapes: the triangles each is drawn with, by what it is made of, from near and from far; and what of it stops a body and a shot. |

## src/world/castle-shape/

| file | lines | what it is |
|---|---:|---|
| `base.ts` | 362 | The fort's shape, its ground floor: what a shape is made of (sheets, paints, pictures), the little sums every part uses, the weathering and the sky on its stone, what hides what. |
| `faces.ts` | 185 | The fort's shape: the one-plane pass (faces of two parts in one plane: which one is drawn). |
| `ground-parts.ts` | 322 | The fort's shape: the parts that meet the ground (mounds, the apron round a hatch, the lid over cut ground, lumps of rock, vaults). |
| `parts.ts` | 339 | The fort's shape: the plain parts (blocks, boxes, slabs, beams, rails, flights of steps, walls with their openings, curtain walls). |
| `shape.ts` | 215 | The fort's shape put together: every part laid where the world stands it, a piece at a time (castleShape, castleShapeIn, castleShapeSteps). |
| `towers.ts` | 390 | The fort's shape: its towers, their floors, doors, slits and stairs. |

## src/world/

| file | lines | what it is |
|---|---:|---|
| `castle.ts` | 691 | The fort on the mountain, as it is drawn and as it stops a body. |
| `cave-carve.ts` | 414 | The pass's caves carved out of the rock, each one closed surface: rock is what is under the ground and outside every gallery, and the surface between rock and air is found on a grid (surface nets). |
| `caves-carved.ts` | 22 | The pass's caves carved under the world's ground (coast-kit's src/world/cave-carve.ts, to its plan, src/sim/pass.ts), once, where the world is made for the game: plain typed arrays, kept in the world's cache and sent... |
| `caves.ts` | 230 | The pass's walls and its caves, drawn and made solid (the plan is src/sim/pass.ts). |
| `cells.ts` | 89 |  |
| `crest.ts` | 53 | What is set down on the crest the fort stands on that is neither ground, rock nor the fort itself (MOUNTAIN.crest in src/world/worldgen.ts). |
| `domes.ts` | 59 | Onion domes on drums, with a cross, for the new towns' churches (2026-10-16): what tells a church of these lands from a barn at a kilometre. |
| `facade.ts` | 188 | Facades of the downloaded modular kits laid over the game's own buildings (2026-10-16, the new land's towns). |
| `felling.ts` | 219 | Trees felled and standing again, as they are seen (2026-10-24, base building's first step; the rules are src/sim/gather.ts). |
| `foliage.ts` | 179 | Shader patches shared by every instanced foliage / prop material: - wind: whole-plant sway (height-weighted) + leaf flutter - LOD dithering: screen-space dissolve between LOD levels (no popping) - translucency:... |
| `gatehouse.ts` | 686 | The ruined gatehouse at the end of the mountain road (MOUNTAIN in src/world/worldgen.ts; 2026-10-13: |
| `grass.ts` | 444 | GPU grass. The field is tiled into 4 m patches; every patch shares one geometry of ~1000 randomly ordered blades. Blades are placed on the exact terrain triangles in the vertex shader (height texture), culled by the... |
| `ground.ts` | 354 | What the ground is, place by place: the kinds of ground there are, and how much of each lies at every point of the world's net. |
| `helipad.ts` | 68 | The pads the helicopters stand on (src/sim/heli.ts: on the hospital's roof, and by the fort): a painted circle and an H, as every pad has. |
| `kit.ts` | 299 | A layout of a kit's pieces (src/sim/kit.ts), as things to draw: every piece of the layout put into ONE shape for each of the kit's materials, so a whole fort of them is two or three things to draw however many pieces... |
| `load-world.ts` | 33 | The map is the same deterministic data on a worker; older browsers retain the staged path. |
| `macro.ts` | 45 | THE GROUND'S LARGE NOISE: a tileable picture of slow noise (three of its places fbm at three sizes, the fourth a smoother noise that deals out the ground pictures' copies), read by the terrain, the grass and whatever... |
| `mokroye-plans.ts` | 30 | Mokroye, the flooded hamlet in the swamp (2026-10-16): its houses as the water has them. |
| `ocean-waves.ts` | 239 | The sea's numbers, apart from how it is drawn (src/world/ocean.ts), so that they can be checked without a page: the picture its waves are drawn from, the tiles it is laid in, and how deep it is everywhere over them. |
| `ocean.ts` | 533 | THE SEA off the west coast (2026-10-16: |
| `outcrops.ts` | 171 | The canyon country's outcrops (the owner, 2026-10-16: |
| `outline.ts` | 219 | The edge of the Zona as one line. |
| `ozerki-plans.ts` | 50 | Ozerki, the fishing village on the lake (2026-10-16): its two buildings of its own. |
| `pokrov-tents.ts` | 74 | The tented roofs over Pokrov's towers, as drawn (2026-10-23; the plan is src/sim/pokrov-towers.ts, TENT): the tent in painted iron with its seams running down it, boarded under; the board round its eave; the eight... |
| `pokrov-towers.ts` | 151 | Inside Pokrov's corner towers, as drawn (2026-10-19): the room's wall and ceiling, the doorway's lining, the floor, the stair and its parapet, and the hatch's edges. |
| `posts.ts` | 61 | The army's field posts by the western roads (src/sim/posts.ts): each the pillbox model ("WW2 Field Bunker"), drawn and made solid triangle for triangle, as the one over Bunker 17's stair is (src/world/bunker.ts), on... |
| `road.ts` | 154 | Asphalt ribbon draped over the terrain along the road spline. |
| `rock-blend.ts` | 219 | Rock that meets the ground without a seam (the owner, 2026-10-16: |
| `rock-field.ts` | 335 | A field of scanned rocks, drawn and made solid: the pass's walls and cave mouths (src/world/caves.ts) and the canyon country's outcrops (src/world/outcrops.ts). |
| `ruins-shape.ts` | 554 | The shape of each piece of the ruined town, worked out from its parts (src/sim/ruins.ts): what is drawn, as triangles joined by what they are painted with, and what stops a body, as plain boxes, hulls and sheets. |
| `ruins.ts` | 267 | The ruined town as it is built (see src/sim/ruins.ts for what and where, src/world/ruins-shape.ts for its shape and for which pictures it is painted with): each piece stood in the world at its own place and turn, and... |
| `seat.ts` | 180 | HOW A THING THAT STANDS ON THE GROUND IS SEATED IN IT. |
| `snow.ts` | 661 | Where snow lies: by height, OR BY PLACE. |
| `terrain.ts` | 1470 |  |
| `town-plans.ts` | 528 | The buildings of the new towns (2026-10-16), each drawn up for its place: |
| `towns.ts` | 267 | The new towns as they are drawn (2026-10-16): the monastery's walls, the fort kit's pieces re-skinned in white limewash, and the onion domes over the churches. |
| `vegetation.ts` | 1300 | Instanced vegetation + scatter props with distance LODs, dithered transitions, baked tree impostors for the far field, and physics colliders. |
| `water.ts` | 464 | Lakes and rivers, drawn (the owner, 2026-10-16: |
| `ways-out.ts` | 191 | Nothing stands in a building's way out (the owner, 2026-10-19: |
| `wells.ts` | 83 | The wells as they stand in the world: a round brick wall, water a little way down it, two posts and a roof over a windlass, a bucket on its rope. |
| `works.ts` | 192 | The chimney and the tanks of the Chemical Works (see EXPANSION in worldgen.ts). |
| `world-cache.ts` | 76 |  |
| `world-file.ts` | 222 | THE MAP AS A FILE (2026-10-23): the world made once as the site is built (scripts/world-file.ts, run by the build: vite.config.ts `worldFile`) and fetched by the page, instead of made by every browser after every... |
| `world.worker.ts` | 63 | Only plain world data crosses the worker boundary; its typed-array storage is transferred once. |
| `worldgen.ts` | 15 | Deterministic world generation. |

## src/world/worldgen/

| file | lines | what it is |
|---|---:|---|
| `coast-starts.ts` | 47 | Where anybody starts: on the beach of the far west coast (the owner, 2026-10-18: |
| `generate.ts` | 2739 | generateWorld: the whole map made from its seed, stage by stage (see the index below). |
| `ground.ts` | 233 | Questions of the ground's net: the height and slope at a point, the ground as it is drawn over the fort's cuts, a curve through points, and the evening and softening of a field. |
| `layout.ts` | 464 | The map's lines and areas: the mountain's and the loop road's lines, snow by height, the outlying places, where the play is, the hospital's grounds and the village's streets, the kinds of building and their footprints. |
| `opening.ts` | 222 | THE SQUARE OPENED TO THE WEST (2026-10-16, plan v2), done to the square when everything of it is made and before it is laid into the world (see `toWorld`, west.ts). |
| `places.ts` | 479 | The map's measures and its places as numbers: its size and seed, the expansions (the Chemical Works, the bunker, Kamenka), the loop road (LOOP) and the mountain with its fort (MOUNTAIN). |
| `types.ts` | 136 | What a world is made of (World, Site, Instance, Solid, POI, Way, Worn): the types every part of the game reads it by. |
| `west-plan.ts` | 348 | THE WEST'S PLAN: where everything of the new ground goes, as numbers, and the questions only those numbers answer. |
| `west-relief.ts` | 433 | THE WEST'S RELIEF (plan v5 as the owner's client chose it, the desert made twice as big: |
| `west-towns.ts` | 412 | THE WEST'S TOWNS (2026-10-16): the new towns set down where plan v5 has them, each on level ground of its own, as their own data says (src/sim/towns.ts: the reference is lay() in src/dev/towns.ts, at the town's real... |
| `west-water.ts` | 307 | THE WEST'S WATER (2026-10-16): the owner, "i want lakes and rivers as well in natural spots in the map since we now have water". |
| `west.ts` | 892 | THE WEST (2026-10-16): the square laid into the world's rectangle, and the ground of the two squares west of it. |

## src/world/

| file | lines | what it is |
|---|---:|---|
| `zavod-plans.ts` | 193 | Zavod, the brick works by the river (2026-10-16): its buildings. |
| `zona.ts` | 154 | The Zona, where tags are earned: a round about each town, site and settlement east of a line across the map, joined by corridors, the middle of the valley filled in whole; and everywhere else is wilderness, for bases... |
