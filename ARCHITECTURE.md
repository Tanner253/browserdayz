# ZONA: where the code is

Made by `node scripts/architecture.mjs` from the files themselves (size, and the first sentence of each file's header
comment): run it again after adding, moving or splitting a file. Read `CLAUDE.md` first. Five giant files were cut into
folders on 2026-10-14 (`src/game/game/`, `src/world/worldgen/`, `src/sim/castle/`, `src/world/castle-shape/`, and
`server/` beside `index.ts`): the old file is still there and still exports everything it did, so import from it.


## api/_lib/

| file | lines | what it is |
|---|---:|---|
| `live.ts` | 24 | The payout system as it runs for real: the settings from the environment, the real chain, the real file store, the real clock. |
| `payouts.ts` | 1485 | Paying for dog tags. A tag cashed in is paid out of the treasury to the wallet the player gave; the treasury is kept topped up by collecting the coin's creator rewards; and every payment is written in a book the... |
| `posts.ts` | 21 | The posts of the game's X account that its main menu shows (see api/updates.ts), by the number at the end of each post's link: x.com/ZonaSOL_/status/<this>. |
| `pump.ts` | 188 | Creator rewards on pump.fun: where a coin's creator fees pile up, and the transactions that bring them home to the creator's wallet. |
| `solana.ts` | 404 | Just enough of Solana to pay somebody: keys, addresses, a transaction put together and signed by hand, and the handful of questions asked of an RPC node. |
| `store.ts` | 184 | Where the payout system keeps what it must not forget: one small JSON file (the book) in Vercel Blob. |

## api/

| file | lines | what it is |
|---|---:|---|
| `admin.ts` | 116 | Who may give orders on the game server, and who is kept off it: kept where a restart of the game server does not lose it (2026-10-11). |
| `boot.ts` | 32 | How the game's start went on somebody's machine. |
| `cashin.ts` | 44 | Called by the game server when a dog tag has been held for its full time (fifteen minutes), and again for as long as that tag has not been settled. |
| `cashins.ts` | 643 | The payouts page (/payouts, see vercel.json): what the treasury holds, what a tag pays now, every tag cashed in and what became of it, and every collection of creator rewards, each payment with the transaction... |
| `keep.ts` | 103 | What the game server must not forget between its restarts: everybody's character, and every stash (2026-10-12). |
| `tick.ts` | 37 | The housekeeping: collects the coin's creator rewards when enough are waiting, and goes back over the tags that are not settled yet (a payment still on its way, a tag waiting for the treasury or for tomorrow's limit). |
| `updates.ts` | 87 | The game's news, for its main menu: the last few posts of its X account, each with what it says, its picture or film, and where it is on X. |

## server/

| file | lines | what it is |
|---|---:|---|
| `acts.ts` | 421 | The server: what happens to players and things (locks, voice, carried things, seats, jeeps hurt and blown up, bodies, a kill). |
| `admin.ts` | 855 | The server: what an admin can do that nobody else can (command: every slash command; login; putting a player off). |
| `bodywatch.ts` | 201 | How a body moves, watched for a program walking it: standing on nothing, or to and fro on one spot doing nothing. |
| `checks.ts` | 439 | The server: its own checks on where players say they are and what they say they did (moves, hills between, the zone, under the ground, gait). |
| `device.ts` | 91 | The server: the devices games run on (2026-10-16). |
| `drops.ts` | 130 | The server: supply drops and the helicopter that brings them. |
| `elite.ts` | 32 | The Elite: players whose last payout was at the top rate, each held by their key's hash (nobody's anything), with a crown by their name in chat (the owner, 2026-10-15: |
| `gate.ts` | 637 | The server: who is let in and kept on (a life kept by the server, the bot check, the check that this is a person, bans, admins and roles). |
| `handle.ts` | 824 | The server: handle, every message a player sends, checked and acted on. |
| `index.ts` | 1135 | ZONA game server. One process: serves the built client and runs the shared world over a WebSocket at /ws. |
| `keep.ts` | 683 | The server: what is kept between restarts (the save, the last word before a restart, a life put back). |
| `players.ts` | 345 | The server: its players (who is connected, what each is told of the others, where a fresh one starts), what they send cleaned, and joining and leaving. |
| `queue.ts` | 142 | The server: the line to get in when it is full, and the leaderboard. |
| `seen.ts` | 40 | Who has played lately, for the door's "N played today" (the owner, offered a true number in place of fake players to fill the count: |
| `tags.ts` | 230 | The server: cashed-in dog tags, who looted whose, and what a tag must have lived through to pay. |
| `world.ts` | 151 | The server builds the same world the clients do, from the same code and seed, so loot points, crates, doors and spawn points line up exactly without sending the map. |

## src/core/

| file | lines | what it is |
|---|---:|---|
| `assets.ts` | 855 |  |
| `audio.ts` | 2382 | Procedural audio. Every sound is synthesised from noise + oscillators at runtime: no licensed sample packs, tiny download, and endless variation per shot/step. Positional sounds use HRTF panners; gunshots get an... |
| `breathe.ts` | 103 | Work that nobody is waiting on this very frame (a model being made ready for the ground, a body for one of the infected who has come near, pictures sent on ahead to the graphics card) is done a few milliseconds at a... |
| `device.ts` | 69 | What kind of device this is. |
| `gamepad.ts` | 275 | A controller (PlayStation, Xbox, any the browser calls "standard"), read each frame, pressing the game's own controls by their names as the keyboard and the phone's buttons do (src/core/input.ts). |
| `gltf-utils.ts` | 178 |  |
| `input.ts` | 195 | Keyboard + mouse with pointer lock. |
| `keys.ts` | 172 | Which key does what, and how fast the mouse turns the head: both the player's to set (2026-10-12: |
| `leave.ts` | 79 | Whether the page is being left on purpose (2026-10-14). |
| `noise.ts` | 131 | Deterministic noise + RNG. |
| `one-draw.ts` | 130 | See-through things seen from both sides, drawn in one go and not two. |
| `perf.ts` | 202 | Frame profiler + F3 overlay. |
| `physics.ts` | 183 | Rapier (Rust, compiled to WASM) physics. |
| `renderer.ts` | 836 |  |
| `settings.ts` | 154 | Graphics and sound options (Esc menu, Settings tab). |
| `strips.ts` | 153 |  |

## src/dev/

| file | lines | what it is |
|---|---:|---|
| `castle-post.ts` | 165 | `?post` on a development build: the fort on the mountain (src/world/castle.ts, the fort lane's, as its own page `?castle` stands it: on a plain ridge under the game's own sky and sun) with the signals post stood on... |
| `castle.ts` | 291 | `?castle` on a development build: the fort by itself (src/world/castle.ts), stood on a plain ridge under the game's own sky, sun and shadows, with the game's own survivor to walk it. |
| `clip.ts` | 88 | Cutting pictures and short films out of a film that is already made, in a browser: there is no other cutter on the machine. |
| `fit.ts` | 108 | Fitting what is worn on the chest to the body, by measure and not by eye (dev only). |
| `flight-record.ts` | 119 | A play session recorded to be played again, exactly, by the tests (development builds only, never shipped). |
| `harness.ts` | 598 | Development-only test harness (window.T). |
| `look.ts` | 294 | Development-only tools for LOOKING at the game (window.D), beside the harness that drives it (window.T). |
| `overlap.ts` | 131 | Where two faces lie in one plane, facing the same way, over the same ground: the two are drawn turn and turn about and the wall flickers there ("z-fighting"). |
| `poster.ts` | 1542 | The squad's map: a poster. |
| `ruins.ts` | 160 | `?ruins` on a development build: the ruined town (src/sim/ruins.ts) stood by itself on land of its own, in the game as it is, to be walked and looked at before it has a place on the map. |
| `sounds.ts` | 476 | Development only: `?sounds` on the dev page (http://localhost:5173/?sounds). Not the game: a page to hear its sounds on, for whoever can hear. Whoever chose the recordings could not, and chose them by their names and... |
| `stance.ts` | 553 | Development-only measure of how a gun is held by a body seen from outside (window.ST), beside the harness that drives the game (window.T). |
| `sweep.ts` | 313 | Development-only numbers for every animation (window.S), beside the harness that drives the game (window.T) and the tools that photograph it (window.D). |
| `towns.ts` | 130 | `?towns` on a development build: a new town (src/sim/towns.ts) stood on level ground of its own in the north-west corner of today's map, in the game as it is, to be walked and looked at before it has its place in the... |
| `viewer.ts` | 85 | A look at models as the game will load them, without starting the game: for whoever is fitting a new one. |

## src/game/

| file | lines | what it is |
|---|---:|---|
| `airdrop.ts` | 360 | The helicopter that brings a supply drop, and the crate coming down under its canopy: what is seen of them and what is heard (2026-10-13). |
| `arms.ts` | 509 | First-person arms, for everything that is held and has no hands of its own: a hatchet, a tin of beans, bare fists. |
| `avatar.ts` | 2639 | The survivor's body. Used for the local player (the shadow, the flight in from the menu, and the body you see when you look down) and for every other character in the world. |
| `blast.ts` | 1384 | A blast: a grenade, a drum of fuel, a car going up. |
| `botcheck-strip.ts` | 368 | The bot check as it was until 2026-10-15, kept for the ninth film (src/trailer/shots9.ts), which shows it: the game's own is the round course now (./botcheck.ts). |
| `botcheck.ts` | 416 | The bot check, as the player meets it: a round yard high over the middle of the map, walls and a hut and a catwalk in it, and six figures about it that the server walks and the server shows (src/sim/course.ts: read... |
| `camera.ts` | 103 | Camera director: the view from the survivor's eyes, and the flight into them from the menu's aerial shot. |
| `cellars.ts` | 53 | The basements as the game has them (src/sim/basements.ts): a bulb hung in each of their rooms and over the foot of their steps, lit for whoever is near enough to see by it, and how dark it is down there for the eye. |
| `character.ts` | 93 | A character other than the local player: body, hit zones (head / torso / legs) and health. |
| `doll.ts` | 1054 | The survivor in the middle of the inventory, alive. |
| `effects.ts` | 957 | Impact / weapon effects: billboard particle pool (dust, debris, sparks, blood), bullet-hole decals, muzzle flash light. |
| `fires.ts` | 297 | Campfires as the game has them (the rules are in src/sim/fires.ts): which fireplaces are alight and for how long yet, the ring of stones and wood that stands at each (cold, or burning), the flames and the smoke of... |
| `flames.ts` | 645 | The flames of a fire: the ones that came with the campfire, moving the way they came, mended. |
| `game.ts` | 1512 | The game: owns every system, runs the frame loop, and decides who is in charge of what. |

## src/game/game/

| file | lines | what it is |
|---|---:|---|
| `drops.ts` | 562 | The game: supply drops, targets when playing alone, and the flow of a life (death, respawn, pause). |
| `enter.ts` | 653 | The game: entering the world (joining a server or playing alone, the bot check's range, dressing the player). |
| `frame.ts` | 657 | The game: every frame (the main loop: input, the world, the camera, the sound, the HUD). |
| `guns.ts` | 505 | The game: attachments and magazines. |
| `hands.ts` | 573 | The game: inventory moves, the hot keys and the hands, and what an admin can do. |
| `interact.ts` | 306 | The game: what is looked at and done with F (doors, containers, cars, fires, loot). |
| `items.ts` | 662 | The game: using things (eating, healing, reading, the radio) and the emote wheel. |
| `online.ts` | 731 | The game: multiplayer (what the server says, wired to what is done about it; other players, bodies, stashes). |

## src/game/

| file | lines | what it is |
|---|---:|---|
| `garage.ts` | 1111 | Every jeep in this game, and the one the player is sitting in: getting in and out, the view from behind it, who it runs over, what it sounds like, how it burns, and keeping the server (and through it everybody else)... |
| `gas.ts` | 336 | The gas as the game has it. |
| `grenades.ts` | 105 | Thrown grenades. A grenade is a point flying under gravity that bounces off the world and goes off when its fuse runs out. Everyone is told where it left the hand and how fast (see the 'nade' message), and every game... |
| `heli.ts` | 237 | The helicopter as it is in one game (2026-10-14): a Jeep (src/game/vehicle.ts) in everything but how it moves and what turns on it, so that getting in and out, the seats, the view, being told of it by the server and... |
| `horns.ts` | 87 | A car's horn (H, held) and a police car's siren (J, on and off): the owner, 2026-10-14, "we need to add honking to the cars, and maybe a siren for the cop car, but siren not important definitley need honk". |
| `infected.ts` | 1033 | The infected, as this game draws and (for the ones near its own player) moves them. |
| `lamps.ts` | 329 | Lamps: the lights people carry, the ones a jeep drives behind, and the ones that stand in the street. |
| `lockers.ts` | 193 | The doors and lids of what is searched (the rule is in src/sim/crates.ts, HUNG): a locker's leaves and a crate's lid, hung on their hinges, shut until somebody has the thing open and swung wide for as long as they do. |
| `look.ts` | 198 | What a survivor looks like: jacket and trouser colours, skin, hair. |
| `loot.ts` | 1119 | World items: the Central Economy decides *what* exists where; this module gives each entry a mesh + an interaction trigger, rests it properly on whatever it lies on (shelf, table, floor, sloped ground) and manages... |
| `menu-order.ts` | 90 | Which of the menu's scenes are shown first, which are said to be new, and what a browser remembers of having been shown. |
| `menu-scenes.ts` | 1711 | What goes on behind the menu before a game is started: the Zone itself, with things happening in it. |
| `muzzle.ts` | 131 | The flash at a muzzle: burning gas, seen for two or three frames. |
| `near.ts` | 152 | What is near is drawn with its pictures at the size they came; what is far, with the world's copies. |
| `player.ts` | 1307 | First-person survivor: kinematic character controller (Rapier), movement model, stamina / vitals, camera feel (bob, lean, landing dip) and footsteps. |
| `procedural.ts` | 266 | The few meshes that have no scanned model: small machined parts built from a lathe profile, with a parkerised-steel material, and the stamped dog tag. |
| `remote.ts` | 520 | Other players. Each one is a body driven by the poses the server relays: interpolated a little in the past so movement is smooth, with hit zones your bullets and fists can land on, the weapon they are holding in... |
| `riders.ts` | 62 | The dead who ride on (2026-10-14). |
| `rig.ts` | 495 | A weapon pack in the hands of whoever holds the gun: the pack's own arms and its own gun, moved by its own animation. |
| `trader.ts` | 97 | The trader as he is seen: a body behind the counter of the shop at the trading post (see src/sim/trade.ts for what he pays and asks). |
| `vehicle.ts` | 613 | The jeep as it is in one game: a body on four sprung wheels, driven here or shown as somebody else drives it. |
| `voice.ts` | 352 | Talking to whoever is near (hold V). |
| `weapons.ts` | 4060 | Gunplay: viewmodel (own scene/camera), procedural animation (equip, bob, sway, recoil springs, bolt cycling, reloads), ballistics with gravity + drag simulated in sub-steps against the physics world, zeroing, scope +... |
| `wreck-fire.ts` | 141 | The jeep that burns before the fort's gate, as the game has it (the rules are in src/sim/wreck-fire.ts, and where it stands is the fort's to say: src/sim/castle.ts). |

## src/

| file | lines | what it is |
|---|---:|---|
| `main.ts` | 255 |  |

## src/net/

| file | lines | what it is |
|---|---:|---|
| `client.ts` | 375 | Client side of the game connection. |
| `device.ts` | 135 | The device this game runs on, boiled down to one hash and sent with `hello` (PROTOCOL 44). |
| `orders.ts` | 210 | The orders an admin or a mod can give on the game server, typed where talk is typed (2026-10-11). |
| `protocol.ts` | 493 | Wire protocol between the game client and the server. |
| `timeline.ts` | 122 | When a report of somebody else's player was TRUE, as against when it got here. |

## src/sim/

| file | lines | what it is |
|---|---:|---|
| `airdrop.ts` | 479 | The supply drop comes by helicopter (2026-10-13: |
| `barrels.ts` | 31 | Fuel drums. The red barrels standing about the yards and sheds go up when a bullet finds them, and take whoever is standing near with them: a thing to shoot at instead of the man behind it, and a reason to look at... |
| `basements.ts` | 545 | Basements (2026-10-14). |
| `blood.ts` | 96 | Blood, which is not health (2026-10-13). |
| `bridge.ts` | 103 | The bridge on the loop road (2026-10-13: |
| `bunker.ts` | 815 | The bunker: a place under the ground on the far side of the map from the Chemical Works. |
| `castle-post.ts` | 477 | ORLINOYE, "the Eagle's Nest": the fort on the mountain as the army's signals and observation post, above ground. |
| `castle.ts` | 31 | The fort on the mountain: four round towers at the corners of a near-square, a square keep in the middle of it, a paved terrace all round between the two, and one way in, over a timber ramp from a rock on the east. |

## src/sim/castle/

| file | lines | what it is |
|---|---:|---|
| `ask.ts` | 215 | Questions asked of the fort at a point: under it, in its dark, what it cuts out of the ground, what it hides, its foot; and where the world set its loose pieces. |
| `loose.ts` | 283 | The fort's loose pieces: the ruined houses below it, the curved and long walls, the rocks, and the hatch with its passage under the ground. |
| `loot.ts` | 336 | What is in the fort and about it: its loot places by tier, the burning jeep before its gate, its props and lamps as the world has them, where the infected start, and where a thing may be stood. |
| `parts.ts` | 681 | The fort's parts: its whole layout (walls, keep, gatehouse, stairs, vaults), the kit pieces, its door, the rock it stands on, its fire baskets, furniture and lamps. |
| `plan.ts` | 454 | The fort's plan, its measures and words: where everything of it is (CASTLE, UNDER), what a part is, how its own measure is turned into the world's, its ground and its towers' girth. |

## src/sim/

| file | lines | what it is |
|---|---:|---|
| `combat.ts` | 120 | Damage rules. The server uses these to decide how much a reported hit hurts, so a client can say "I hit player 7 in the head with a Mosin" but never "for 5000 damage". |
| `cooking.ts` | 836 | Cooking spots (2026-10-13): whatever a fire is made in and food is made hot on. |
| `course.ts` | 496 | The bot check's 360-degree course: the yard, the six figures the server walks and shows, and the judge of a go. |
| `crates.ts` | 183 | Searchable crates that are part of the map (military crates at the checkpoint, wooden crates in barns, sheds and yards). |
| `daynight.ts` | 82 | Day and night. The Zone has a day of thirty-two minutes: three quarters of it light (first light, a long day, dusk) and one quarter, eight minutes, night. The night is kept shorter than the time a dog tag has to be... |
| `drops.ts` | 256 | Supply drops. Every few minutes, while anybody is playing, a crate of the best things on the map is set down somewhere in the open and everyone is told where. It is there for a few minutes, or until somebody has... |
| `economy.ts` | 869 | Central Economy, modelled on DayZ's types.xml: every item type has a world-wide nominal (target) count, a minimum that triggers restocking, a lifetime after which untouched loot despawns, and usage tags that decide... |
| `emotes.ts` | 126 | The wheel (hold T): things to call out without a microphone, and things to do with the body. |
| `fires.ts` | 84 | Campfires. The rings of stones at the lodges, the cabins and the hamlet can be lit. A fire is somewhere to mend: resting beside one puts health back far faster than it comes back on its own, and what is eaten beside... |
| `gas.ts` | 154 | The gas. One place on the map is sunk in it (the Chemical Works, in the cirque behind the checkpoint: the map's first expansion). A low dome of it lies over the place, thickest at the middle and thinning to nothing... |
| `grenades.ts` | 249 | Grenades: what is thrown, how its fuse runs, and what the server believes of one. |
| `gunplay.ts` | 335 | How the guns shoot. One place for what each cartridge does in the air and what each gun does with it, read by the game (a bullet's flight, the kick, the cone a shot can land in, what its sights are set for) and by... |
| `heli.ts` | 171 | The helicopter a player flies (2026-10-14), its rules shared by the game and the server: what it is, how it flies (src/game/heli.ts flies it by these numbers), and where it stands when the world is new. |
| `hitclock.ts` | 24 | How often a shooter's hits on one body are believed (server/tags.ts, mayHit): no oftener than the gun fires, over a run of them, with one allowed a gap early when the one before came late. |
| `infected.ts` | 439 | The infected: the people who lived here, and did not leave. |
| `injury.ts` | 34 | A broken leg. A hard enough landing breaks one, and so, as often as not, does a bullet in the legs. On a broken leg nobody runs or jumps: it is a limp until it is set (a splint, or a first aid kit), or until it has... |
| `inventory.ts` | 1020 | Grid inventory (DayZ / Tarkov style). |
| `items.ts` | 932 |  |
| `jobs.ts` | 64 | Work the trader has. Three jobs a day, the same three for everybody (they come out of the date): the infected to be put down, something common to be brought in, something that has to be gone and got. He pays in... |
| `kit.ts` | 534 | A KIT of building pieces, and a LAYOUT made of them. |
| `kits.ts` | 75 | Whole sets of gear an admin can hand out in one go (2026-10-11): |
| `lipki.ts` | 114 | Lipki, the woodcutters' hamlet in the birch woods (2026-10-16, reworked): where its houses and what lies about them stand. |
| `load.ts` | 70 | What a load does to whoever carries it (2026-10-13: |
| `mokroye.ts` | 112 | Mokroye, the flooded hamlet in the swamp (2026-10-16, new): where its houses, boardwalks and what the water left stand. |
| `news.ts` | 202 | Hearts and comments on the entries of the changelog (2026-10-12: |
| `ozerki.ts` | 75 | Ozerki, the fishing village on a lake in the north woods (2026-10-16, new): where its houses, piers and what lies about them stand. |
| `placement.ts` | 28 | Whether an item can physically lie at a loot point. |
| `pokrov.ts` | 102 | Pokrov, the white-walled monastery and the town outside its gate (2026-10-16, reworked): where its buildings and what lies about them stand, and the terrace it stands on. |
| `powers.ts` | 112 | Four of an admin's tools that are about what is carried (2026-10-13: |
| `range.ts` | 359 | The bot check (2026-10-12: |
| `ruins.ts` | 1256 | The ruined walled town in the desert: a palace-fort at its point, the best stretch of its wall with three towers, the bent gate over a causeway, a quarter of dug-out houses, the footings of the north wall with four... |
| `save.ts` | 58 | Local persistence for the single-player slice. |
| `slopes.ts` | 236 | Steep ground: what legs can do on it. |
| `stash.ts` | 36 | Where a stash can be put under the ground (2026-10-12): out in the country, and nowhere else. |
| `tiers.ts` | 24 | The steps of the map. Every place a thing can lie is on one of five, and every sort of thing is kept on the steps it belongs to (src/sim/economy.ts): what a new arrival finds at the edge is not what is kept down the... |
| `towns.ts` | 258 | The new towns of the map three times over (2026-10-16): where each building stands, and the monastery's walls as pieces of the fort kit. |
| `trade.ts` | 82 | The trader. A man stands behind the counter of the shop at the trading post, out east of the village. He buys what is brought to him and sells what a body needs to go on with: dressings, food, rounds, a light, a... |
| `vehicles.ts` | 277 | Jeeps. A handful stand along the road and a few more out at the edge of the map, behind the outlying places; anybody can get in one and drive it, three more can ride, and it can be shot until it burns. It is the fast... |
| `voice.ts` | 29 | Talking to whoever is near (src/game/voice.ts): what the server and the game both go by. |
| `walkways.ts` | 44 | Walkways of boards on posts, from the pier kit (Poly Haven's modular wooden pier, src/world: pier_kit): a fishing village's piers, a swamp's boardwalks (2026-10-16). |
| `water.ts` | 177 | Lakes and rivers, as rules: where the water is, how deep, which way it runs, and what it does to whoever walks into it. |
| `wells.ts` | 90 | Wells, and what hunger and thirst do before they kill. |
| `wreck-fire.ts` | 103 | The jeep that burns before the fort's gate, for good (the owner, 2026-10-14: |
| `zavod.ts` | 83 | Zavod, the brick works by the river (2026-10-16): where its buildings and what lies about them stand. |

## src/trailer/

| file | lines | what it is |
|---|---:|---|
| `director.ts` | 888 | The trailer's director. |
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
| `shots2.ts` | 1383 | The second trailer: what has changed in the Zone. |
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
| `admin-ui.ts` | 1558 | The panel of somebody with a role (2026-10-11; laid out again 2026-10-12). |
| `ads.ts` | 48 | Google Ads: its tag on the site, and one conversion when a visitor first goes into a game, the Zone or the Arena (the owner, 2026-10-14: |
| `arena-hud.ts` | 172 | The arena's own screen (2026-10-14). |
| `arena-menu.ts` | 216 | The Arena's own front (2026-10-14), its menu and the screens between matches. |
| `bigmap.ts` | 1290 | The map, opened large (M): a sheet as an army prints one. |
| `dogtag.ts` | 166 | The dog tag on the menu: two steel tags on a ball chain, the player's name stamped into the front one as it is typed. |
| `door.ts` | 155 | The door (2026-10-14): zonapvp.fun asks what the visitor came for before anything is built. |
| `elite-crown.ts` | 37 | The Elite's crown by a name in chat, and a word about them with the pointer on it (the owner, 2026-10-15: |
| `emotes-menu.ts` | 239 | Emotes: the sixteen slots of the wheel (hold T) set by the player, each thing there is to call out or do watched first on the survivor (the owner, 2026-10-14: |
| `hud.ts` | 1860 | A lean HUD: small vitals, a compass strip, a corner map (src/ui/minimap.ts), prompts only when relevant. |
| `icons.ts` | 467 | Inventory icons rendered from the real 3D models at startup (no hand-made sprites). |
| `inventory-ui.ts` | 2135 | DayZ-style inventory. Three columns: Vicinity what is on the ground around you, and the crate / stash / body you opened Character the survivor with the places for what is worn either side of them (the rules' own... |
| `minimap.ts` | 433 | A small map in the corner of the screen: the ground, the forest, the road, the buildings, and an arrow for where you are and which way you face. |
| `person.ts` | 104 | The check that it is a person who is asking to play, and not a program (2026-10-12: connections made by a program came by the dozen, and stood in the world as players). |
| `platform.ts` | 33 | ZONA PvP, the platform both games stand under (2026-10-14). |
| `rewards.ts` | 290 | Dog tags and creator rewards: the illustrated explanation a player sees on entering the site, and the wallet address they give. |
| `rotate.ts` | 34 | The screen a phone shows while it is held upright. |
| `shop.ts` | 188 | The trader's counter: what you have that he will take, and what he has to sell. |
| `status-view.ts` | 241 | The survivor's state, drawn: a row of symbols in the corner of the game, and the same row again in the inventory. |
| `status.ts` | 260 | How a survivor's state is read: an icon each for health, blood, food and water, drawn in the colour of how it stands, with arrows beside it for which way it is going and how fast; and a badge for each thing that is... |
| `touch.ts` | 270 | On-screen controls for phones and tablets. |
| `updates.ts` | 153 | The game's news in a corner of its main menu: the last few posts of its X account, each with what it says, its picture or film, and a way to it on X. |
| `wheel-slots.ts` | 57 | The emote wheel's sixteen slots as this player has set them (Emotes, opened from the wheel: src/ui/emotes-menu.ts), kept in this browser. |

## src/world/

| file | lines | what it is |
|---|---:|---|
| `atmosphere.ts` | 856 | Sky, sun, image-based lighting, cascaded shadows and height fog. |
| `basement-build.ts` | 172 | What a basement is made of (src/sim/basements.ts says where its rooms, steps and things are): its walls, floors and ceilings, a frame of timber round every way through, its flights, and up in the yard the kerb round... |
| `big-buildings.ts` | 996 | The two buildings of several floors (2026-10-11): the district hospital in Kamenka and the police headquarters at the edge of the village. |
| `bridge.ts` | 679 | The road bridge as it is built (see src/sim/bridge.ts for what a bridge is, in figures, and src/world/worldgen.ts for where one stands): a reinforced-concrete road bridge of the kind the country it stands in built by... |
| `buildings.ts` | 3445 | Procedural buildings: walls with door/window cut-outs (two material layers), floors, ceilings, gable / shed / flat roofs, window frames + glass, hinged doors, hand-authored interior layouts with Poly Haven furniture,... |
| `bunker.ts` | 917 | The bunker as it is built (see src/sim/bunker.ts for what and where): the pad over the hole, the hut, the stair, the first level with its passage, rooms and benches, the door a keycard opens, the sealed way down, and... |
| `castle-post-shape.ts` | 439 | The signals post on the fort (src/sim/castle-post.ts): the shapes of what is made by hand, as plain numbers. |
| `castle-post.ts` | 286 | The signals post on the fort (src/sim/castle-post.ts), as it is drawn and as it stops a body: what the game has no model for and is made here by hand. |
| `castle-shape.ts` | 21 | The fort's pieces (src/sim/castle.ts) as shapes: the triangles each is drawn with, by what it is made of, from near and from far; and what of it stops a body and a shot. |

## src/world/castle-shape/

| file | lines | what it is |
|---|---:|---|
| `base.ts` | 369 | The fort's shape, its ground floor: what a shape is made of (sheets, paints, pictures), the little sums every part uses, the weathering and the sky on its stone, what hides what. |
| `faces.ts` | 185 | The fort's shape: the one-plane pass (faces of two parts in one plane: which one is drawn). |
| `ground-parts.ts` | 311 | The fort's shape: the parts that meet the ground (mounds, the apron round a hatch, the lid over cut ground, lumps of rock, vaults). |
| `parts.ts` | 339 | The fort's shape: the plain parts (blocks, boxes, slabs, beams, rails, flights of steps, walls with their openings, curtain walls). |
| `shape.ts` | 216 | The fort's shape put together: every part laid where the world stands it, a piece at a time (castleShape, castleShapeIn, castleShapeSteps). |
| `towers.ts` | 323 | The fort's shape: its towers, their floors, doors, slits and stairs. |

## src/world/

| file | lines | what it is |
|---|---:|---|
| `castle.ts` | 680 | The fort on the mountain, as it is drawn and as it stops a body. |
| `cells.ts` | 89 |  |
| `crest.ts` | 53 | What is set down on the crest the fort stands on that is neither ground, rock nor the fort itself (MOUNTAIN.crest in src/world/worldgen.ts). |
| `domes.ts` | 48 | Onion domes on drums, with a cross, for the new towns' churches (2026-10-16): what tells a church of these lands from a barn at a kilometre. |
| `facade.ts` | 188 | Facades of the downloaded modular kits laid over the game's own buildings (2026-10-16, the new land's towns). |
| `foliage.ts` | 179 | Shader patches shared by every instanced foliage / prop material: - wind: whole-plant sway (height-weighted) + leaf flutter - LOD dithering: screen-space dissolve between LOD levels (no popping) - translucency:... |
| `gatehouse.ts` | 686 | The ruined gatehouse at the end of the mountain road (MOUNTAIN in src/world/worldgen.ts; 2026-10-13: |
| `grass.ts` | 381 | GPU grass. The field is tiled into 4 m patches; every patch shares one geometry of ~1000 randomly ordered blades. Blades are placed on the exact terrain triangles in the vertex shader (height texture), culled by the... |
| `ground.ts` | 320 | What the ground is, place by place: the kinds of ground there are, and how much of each lies at every point of the world's net. |
| `helipad.ts` | 68 | The pads the helicopters stand on (src/sim/heli.ts: on the hospital's roof, and by the fort): a painted circle and an H, as every pad has. |
| `kit.ts` | 270 | A layout of a kit's pieces (src/sim/kit.ts), as things to draw: every piece of the layout put into ONE shape for each of the kit's materials, so a whole fort of them is two or three things to draw however many pieces... |
| `load-world.ts` | 25 | The map is the same deterministic data on a worker; older browsers retain the staged path. |
| `mokroye-plans.ts` | 30 | Mokroye, the flooded hamlet in the swamp (2026-10-16): its houses as the water has them. |
| `ocean-waves.ts` | 239 | The sea's numbers, apart from how it is drawn (src/world/ocean.ts), so that they can be checked without a page: the picture its waves are drawn from, the tiles it is laid in, and how deep it is everywhere over them. |
| `ocean.ts` | 442 | THE SEA off the west coast (2026-10-16: |
| `outline.ts` | 218 | The edge of the Zona as one line. |
| `ozerki-plans.ts` | 48 | Ozerki, the fishing village on the lake (2026-10-16): its two buildings of its own. |
| `road.ts` | 154 | Asphalt ribbon draped over the terrain along the road spline. |
| `ruins-shape.ts` | 553 | The shape of each piece of the ruined town, worked out from its parts (src/sim/ruins.ts): what is drawn, as triangles joined by what they are painted with, and what stops a body, as plain boxes, hulls and sheets. |
| `ruins.ts` | 226 | The ruined town as it is built (see src/sim/ruins.ts for what and where, src/world/ruins-shape.ts for its shape and for which pictures it is painted with): each piece stood in the world at its own place and turn, and... |
| `seat.ts` | 180 | HOW A THING THAT STANDS ON THE GROUND IS SEATED IN IT. |
| `snow.ts` | 661 | Where snow lies: by height, OR BY PLACE. |
| `terrain.ts` | 1373 |  |
| `town-plans.ts` | 447 | The buildings of the new towns (2026-10-16), each drawn up for its place: |
| `towns.ts` | 210 | The new towns as they are drawn (2026-10-16): the monastery's walls, the fort kit's pieces re-skinned in white limewash, and the onion domes over the churches. |
| `vegetation.ts` | 1038 | Instanced vegetation + scatter props with distance LODs, dithered transitions, baked tree impostors for the far field, and physics colliders. |
| `water.ts` | 435 | Lakes and rivers, drawn (the owner, 2026-10-16: |
| `wells.ts` | 81 | The wells as they stand in the world: a round brick wall, water a little way down it, two posts and a roof over a windlass, a bucket on its rope. |
| `works.ts` | 192 | The chimney and the tanks of the Chemical Works (see EXPANSION in worldgen.ts). |
| `world-cache.ts` | 77 |  |
| `world.worker.ts` | 31 | Only plain world data crosses the worker boundary; its typed-array storage is transferred once. |
| `worldgen.ts` | 13 | Deterministic world generation. |

## src/world/worldgen/

| file | lines | what it is |
|---|---:|---|
| `generate.ts` | 2708 | generateWorld: the whole map made from its seed, stage by stage (see the index below). |
| `ground.ts` | 208 | Questions of the ground's net: the height and slope at a point, the ground as it is drawn over the fort's cuts, a curve through points, and the evening and softening of a field. |
| `layout.ts` | 451 | The map's lines and areas: the mountain's and the loop road's lines, snow by height, the outlying places, where the play is, the hospital's grounds and the village's streets, the kinds of building and their footprints. |
| `places.ts` | 468 | The map's measures and its places as numbers: its size and seed, the expansions (the Chemical Works, the bunker, Kamenka), the loop road (LOOP) and the mountain with its fort (MOUNTAIN). |
| `types.ts` | 112 | What a world is made of (World, Site, Instance, Solid, POI, Way, Worn): the types every part of the game reads it by. |
| `west.ts` | 220 | THE WEST (2026-10-16): the square laid into the world's rectangle, and the ground of the two squares west of it. |

## src/world/

| file | lines | what it is |
|---|---:|---|
| `zavod-plans.ts` | 182 | Zavod, the brick works by the river (2026-10-16): its buildings. |
