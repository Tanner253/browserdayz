// The game: owns every system, runs the frame loop, and decides who is in charge of
// what. Offline, this browser runs the whole world (loot economy, crates, save file).
// Online, the server does, and this file mirrors it and reports what the player does.

import * as THREE from 'three';
import { keepKeysInFullScreen, leaving, rejoining } from '../core/leave';
import type { Renderer } from '../core/renderer';
import { physics } from '../core/physics';
import { assets } from '../core/assets';
import { audio } from '../core/audio';
import { voiceOf } from '../sim/emotes';
import { Input } from '../core/input';
import { Gamepad } from '../core/gamepad';
import { controls, translation, type Controls } from '../core/keys';
import type { Atmosphere } from '../world/atmosphere';
import type { Terrain } from '../world/terrain';
import { Barrel, type Vegetation } from '../world/vegetation';
import type { Grass } from '../world/grass';
import '../world/buildings';
import type { Buildings } from '../world/buildings';
import { PLAN, SQUARE_HALF, passPlan, ridgeWall, WORLD_X0, WORLD_X1, WORLD_Z0, WORLD_Z1, bunkerPlace, heightAt, type SiteKind, type World } from '../world/worldgen';
import { FLOOR_CACHE, caveSpansUnder, passWorld, wallParts } from '../sim/pass';
import { GEAR_SLOTS, ITEMS, WEAPON_SLOTS, fittedOf, makeItem, type ItemInstance } from '../sim/items';
import { PlayerInventory } from '../sim/inventory';
import '../sim/powers';
import { Economy, lootPrint, type WorldLoot } from '../sim/economy';
import { CRATE_SPECS, RACKS } from '../sim/crates';
import '../sim/combat';
import { LAUNCHED } from '../sim/grenades';
import '../sim/gunplay';
import '../sim/barrels';
import '../sim/emotes';
import '../sim/save';
import { Net, playerName, publicId, serverStatus } from '../net/client';
import { crateId } from '../net/protocol';
import { FURNITURE, storageId } from '../sim/storage';
import { CARRY_LIMIT, Player } from './player';
import '../sim/blood';
import { Avatar, AVATAR_LAYER, GEAR_SHOWN, type Hold } from './avatar';
import { lookFor } from './look';
import { Doll } from './doll';
import { GunRacks, RACK_PLAN } from './racks';
import { roadLift } from '../world/road';
import { Dummy } from './character';
import { CorpseBody, RemotePlayer } from './remote';
import { CameraDirector } from './camera';
import { Effects } from './effects';
import { Weapons, type HitInfo } from './weapons';
import { LootManager, Stash, WorldItem } from './loot';
import { Grenades } from './grenades';
import { Garage } from './garage';
import { Riders } from './riders';
import { Jeep } from './vehicle';
import '../sim/vehicles';
import { HUD } from '../ui/hud';
import { ArenaHud } from '../ui/arena-hud';
import '../ui/updates';
import { InventoryUI } from '../ui/inventory-ui';
import { Minimap } from '../ui/minimap';
import { BigMap } from '../ui/bigmap';
import { BURY } from '../sim/stash';
import { AdminUI, type AdminPlayer } from '../ui/admin-ui';
import '../sim/drops';
import '../sim/airdrop';
import { Airdrops } from './airdrop';
import { wellSpots, type Well } from '../sim/wells';
import { Voice } from './voice';
import { TIERS, tierAround, type Tier } from '../sim/tiers';
import { hasSlotIcon, iconSig, renderDoll, renderIcons } from '../ui/icons';
import '../ui/person';
import { BotCheck } from './botcheck';
import { Near } from './near';
import { Perf } from '../core/perf';
import { loadGraphics, loadMix, type Graphics } from '../core/settings';
import { Horde, Infected } from './infected';
import { INFECTED, guarded } from '../sim/infected';
import { TOUCH } from '../core/device';
import { TouchControls } from '../ui/touch';
import { REWARDS_UI, RewardsModal, onTagPay, walletAddress } from '../ui/rewards';
import { Gas } from './gas';
import { GAS, bunkerUnder } from '../sim/gas';
import { DAY } from '../sim/daynight';
import { Hearths } from '../sim/fires';
import { Fires } from './fires';
import { Lockers } from './lockers';
import '../sim/injury';
import { MenuScenes } from './menu-scenes';
import { Traders } from './trader';
import { ShopUI } from '../ui/shop';
import { STOCK, aDay, asks, pays, sold } from '../sim/trade';
import { jobsFor, progress as jobDone } from '../sim/jobs';
import type { MenuSpot } from '../ui/hud';
import { Lamps } from './lamps';
import { BunkerSite, spotKey } from '../world/bunker';
import { FieldPosts } from '../world/posts';
import { Cellars } from './cellars';
import { BUNKER, bunkerCrates } from '../sim/bunker';
import { CastleSite } from '../world/castle';
import { CASTLE_SCALE, inCastle } from '../sim/castle';
import { WreckFire } from './wreck-fire';
import { helipads } from '../world/helipad';
import { enterMethods } from './game/enter';
import { onlineMethods } from './game/online';
import { dropsMethods } from './game/drops';
import { handsMethods } from './game/hands';
import { itemsMethods } from './game/items';
import { gunsMethods } from './game/guns';
import { interactMethods } from './game/interact';
import { frameMethods } from './game/frame';

export const _gasHead = new THREE.Vector3();
/** how much of the view is left when aiming through a holographic sight (the plain sights leave 0.8 of it): nearer by a third again */
export const HOLO_ZOOM = 0.6;
export const _lampPos = new THREE.Vector3(), _lampDir = new THREE.Vector3();
/** the colour of a street lamp's light (sodium: warm) */
export const STREET_LAMP = new THREE.Color(1, 0.72, 0.38);
/** and of a bunker's lamp (an old bulb in a cage) */
export const BUNKER_LAMP = new THREE.Color(1, 0.84, 0.58);
export const _sealed = new THREE.Vector3(), _sealedDir = new THREE.Vector3(), _sealedLook = new THREE.Vector3();

export interface WorldSystems {
  r: Renderer;
  world: World;
  atmo: Atmosphere;
  terrain: Terrain;
  veg: Vegetation;
  grass: Grass;
  buildings: Buildings;
}

/** seconds with a shovel to put a stash under the ground, or to bring one up */
export const DIG_SECONDS = BURY.seconds;
/** how far off an admin's free camera shows a name over a head at its full strength, metres: further off it is there still, and faint */
// (an admin's far sight: lettering this big within ESP_NEAR metres, shrinking to this small at ESP_FAR and beyond)
export const ESP_SIZE = [15, 9.5], ESP_NEAR = 20, ESP_FAR = 500;

export interface TimedAction {
  label: string;
  t: number;
  dur: number;
  sound: 'eat' | 'drink' | 'bandage' | 'inject' | 'smoke' | null;
  soundT: number;
  done: () => void;
  /**
   * Asked every frame while the hands are at it: is what it is being done to still there to do it to? (the car
   * within reach, the well, the door's reader, the fireplace.) When it is not, the action is broken off there and
   * then, and its movement with it: nothing is done from across the yard by having begun it beside the thing.
   */
  valid?: () => boolean;
  /** what the player is told when `valid` says no */
  lost?: string;
  /** digging: the spade goes in again and again for as long as this lasts (how far through its stroke the last sound was made) */
  dig?: number;
}

/** bump when the map's loot points change: spawned loot from older saves is re-rolled */
// (24, 2026-10-16: the map three times over)
// (25, 2026-10-17: more places for loot, see WORLD_REV 28 in server/index.ts)
// (26, 2026-10-18: the gun racks, see WORLD_REV 29 in server/index.ts)
// (27, 2026-10-18: the desert's places, see WORLD_REV 30)
// (28, 2026-10-19: the cellars' places stand elsewhere, see PROTOCOL 51)
export const LOOT_REV = 28;
/** how far over the ridge's crest its invisible wall stands, metres: past it a helicopter flies over */
const RIDGE_OVER = 18;
/** the new places of the map three times over, as the map and the menu say them: what is there, the kind of mark, and its step where PLAN.tiers has none */
const WEST_PLACES: Record<string, [string, MenuSpot['kind'], Tier]> = {
  Pokrov: ['A monastery town in the green west: the cathedral and its belfry inside white walls, the monks\' cells and refectory, and below the walls a street of a tavern, merchants\' houses and a smithy.', 'town', 3],
  Lipki: ['A log village on a knoll: houses behind picket fences, a chapel on the hill, the sawmill and its log yard.', 'town', 2],
  Ozerki: ['A fishing village on the forest lake: log houses along the road, a smokehouse, a boathouse on piers over the water.', 'town', 2],
  Mokroye: ['A hamlet the swamp has drowned: houses standing in the water, boardwalks between them, a dry house and its smokehouse on an island.', 'town', 2],
  Zastava: ['The post at the pass\'s east mouth: slabs across the road, a booth, the barracks, a roadhouse over the road and a watchtower over the canyon. Whoever goes west comes through here.', 'army', 3],
  Zavod: ['The brick works by the desert river, west of the pass: the works hall, its office and the workers\' flats.', 'site', 3],
  Kalat: ['A ruined walled town on its own hill in the desert: the citadel, the curtain wall and its gate, the honeycomb of houses.', 'site', 4],
  // (Pokrov's bell tower stood alone, 2026-10-19: src/sim/watchtowers.ts)
  Watchtower: ['A stone tower standing alone, the army\'s lookout: five floors of stairs, and at the top a chamber open on all four sides. Seen from far off, and seen from.', 'army', 3],
  'Hunting tower': ['A hunters\' tower of timber on its legs in the woods, a stair up to a roofed platform. What a hunter keeps: a pack, a knife, a light, a spade, and now and then something of the army\'s.', 'army', 2],
  // (the desert's, 2026-10-18: src/sim/desert.ts)
  Peski: ['A hamlet by the beach where the main road leaves the coast: plank houses, a shed, and a shop with food and water on its shelves.', 'town', 1],
  Karavan: ['A roadhouse halfway from the coast to the pass: a tavern, a shop and a workshop on the main road.', 'shop', 1],
  Blokpost: ['The army\'s post on the track down to Kalat: a guard post, a barracks, a garage and a watchtower.', 'army', 2],
  Bereg: ['Fishermen\'s houses on the north coast, at the end of the coast track.', 'town', 1],
  Mys: ['A farmstead on the south coast, where the road round Kalat comes down to the beach.', 'town', 1],
};
/** where a jeep's headlamps are on it: so far either side of its middle, so far over its middle, so far forward (it is 2.08 m to its nose) */
export const HEADLAMP = { x: 0.5, y: 0.14, z: -2.12 };
/** and the police car's: wider apart, lower, and further forward (it is 2.58 m to its nose) */
export const HEADLAMP_CAR = { x: 0.68, y: -0.14, z: -2.6 };
/**
 * and the helicopter's searchlight, under its nose between the skids: tipped so far ahead of straight down (radians), as
 * wide as so much of a flashlight's cone (a beam of some 17 degrees), its spot as bright as a flashlight's from so many
 * metres at any height, how bright its lens is to whoever it is turned on, and how plain its shaft is in the air
 */
export const SEARCHLIGHT = { x: 0, y: -0.45, z: -1.45, tilt: 0.49, wide: 0.42, as: 4, lens: 1.2, haze: 0.08 };
/**
 * The hot keys, 1 to 9 and then 0. Each brings up whatever was put on it (PlayerInventory.hot): anything carried,
 * on any key. Pressed, the thing is taken into the hands; pressed again, it is put away. What is in the hands is
 * then used by holding the left button down for as long as the using takes (see `handFire`), which is how
 * everything is done: a tin is eaten, a box of rounds unwrapped, a magazine filled, a tank poured into.
 */
export const HOT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
/** the first key a thing to eat, drink or dress a wound with takes by itself when it is first picked up (the ones before it are the back's and the holster's) */
export const HOT_FREE = 3;
/** the wheel: how far the mouse travels from its middle to its rim (pixels), and how far out an entry is picked */
export const WHEEL_REACH = 150, WHEEL_PICK = 0.24;
/** and how far out the outer ring begins (the wheel's two rings: src/ui/wheel-slots.ts, RINGS) */
export const WHEEL_OUTER = 0.6;
export const SEND_HZ = 15;
export const _drip = new THREE.Vector3();
export const _still = new THREE.Vector3();

/** An admin's night sight: how strong the light from nowhere is under a roof (where the day does not reach) and under the sky (where it does, and little is wanted). */
export const NIGHT_SIGHT = { indoors: 2.6, outdoors: 0.35 };

export class Game {
  input: Input;
  /** a controller, when one is switched on in the settings (src/core/gamepad.ts) */
  pad: Gamepad | null = null;
  player: Player;
  avatar = new Avatar();
  director: CameraDirector;
  inv = new PlayerInventory();
  net = new Net();
  effects!: Effects;
  weapons!: Weapons;
  loot!: LootManager;
  grenades!: Grenades;
  /** the jeeps (see garage.ts) */
  garage!: Garage;
  /** the dead still sat in a helicopter that is not down yet (see riders.ts) */
  riders!: Riders;
  economy!: Economy;
  hud!: HUD;
  minimap!: Minimap;
  /** the map opened large (M): see src/ui/bigmap.ts */
  map!: BigMap;
  invUI!: InventoryUI;
  dummies: Dummy[] = [];
  /** the infected (src/game/infected.ts) */
  /** the gas over the works: the breathing of it, and what is seen of it close to */
  gas!: Gas;
  /** what goes on behind the menu before a game is started */
  menu!: MenuScenes;
  /** the menu is (or was last frame) what is on the screen */
  menuOn = true;
  /** the fireplaces: which are alight, and the look and sound of them */
  fires!: Fires;
  /** what is drawn beside the game and told each frame where the eye is (the west's towns, Kalat, the water: main.ts) */
  readonly beside: ((dt: number, eye: THREE.Vector3, camera: THREE.Camera) => void)[] = [];
  /** and how dark it is under whatever of theirs covers a point, 0 to 1 (the pass's caves), with the bunker's and the cellars' dark */
  readonly darkBeside: ((x: number, y: number, z: number) => number)[] = [];
  /** the doors of the lockers that have them: swung open while one is searched, by anybody (see ./lockers.ts) */
  lockers!: Lockers;
  /** the gun racks, each with what stands in it drawn (./racks.ts) */
  racks!: GunRacks;
  /** the bunker: what is built of it, its door and its lamps */
  bunker!: BunkerSite;
  /** the fort on the mountain (src/world/castle.ts): none, in a world that has no place for one */
  castle: CastleSite | null = null;
  /** the basements: their bulbs, and the dark down them (src/game/cellars.ts) */
  cellars!: Cellars;
  /** the jeep that burns before the fort's gate, for good (./wreck-fire.ts): none, in a world that has no fort */
  wreck: WreckFire | null = null;
  /** playing alone: seconds since this game was last inside it with its door open */
  bunkerEmpty = 0;
  /** every lit lamp: carried, driven behind, standing in the street */
  lamps!: Lamps;
  streetLamps: THREE.Vector3[] = [];
  /** the player has a light switched on (the one on the gun, or the flashlight carried) */
  lit = false;
  /** which are alight, kept by this game when it is played alone (the server keeps it otherwise) */
  hearths!: Hearths;
  /** resting by a fire that is alight: mending by it, or only warm (a wound is open, or nothing has been eaten). The HUD has a badge for it */
  byFire: 'mending' | 'warm' | null = null;
  readonly horde: Horde = new Horde({
    atmo: () => this.s.atmo,
    scene: () => this.s.r.scene,
    world: () => this.s.world,
    buildings: () => this.s.buildings,
    me: () => ({ id: this.net.id || 1, pos: this.player.pos, crouched: this.player.crouched || this.player.prone, speed: Math.hypot(this.player.vel.x, this.player.vel.z), alive: this.started && !this.player.dead && !this.powers.hidden, seated: !!this.garage.ride }),
    // (whoever has vanished is not there, to the infected)
    others: () => this.seenByInfected(),
    online: () => this.online,
    send: (m) => this.net.send(m),
    bunkerOpen: () => this.bunker.open,
    struck: (amount, from) => {
      const me = this.player, p = me.pos;
      // on guard, facing it, with the wind to hold it off: nothing lands
      if (this.weapons.guarding && me.vitals.stamina >= INFECTED.guardCost && guarded(p.x, p.z, me.yaw, from.x, from.z)) {
        this.onGuarded();
        return false;
      }
      const len = Math.max(0.001, Math.hypot(p.x - from.x, p.z - from.z));
      // (their arms come down on you like fists)
      audio.blow(true, { x: p.x, y: p.y + 1.3, z: p.z }, 1);
      this.takeHit({ t: 'dmg', from: 0, amount, zone: 'torso', w: 'infected', dir: [(p.x - from.x) / len, 0, (p.z - from.z) / len] });
      return true;
    },
    guarded: () => this.onGuarded(),
    dropped: (id, qty, at) => this.dropItem(makeItem(id, qty), at.clone().setY(at.y + 0.05), 0.4),
    killed: (zone, distance) => {
      this.weapons.confirmKill();
      // (counted toward the trader's work of the day, whether or not he has been asked about it)
      const book = this.jobBook();
      book.kills++;
      if (zone === 'head') book.heads++;
      this.keepBook(book);
      const job = jobsFor(book.day).find((j) => (j.kind === 'cull' || (j.kind === 'heads' && zone === 'head')) && !book.done.includes(j.id));
      const done = job ? jobDone(job, book, () => 0) : 0;
      const work = job ? (done >= job.n ? ` · the trader's job is done: ${job.pays} to collect` : ` · trader's job ${done}/${job.n}`) : '';
      this.hud.note(`Infected down${zone === 'head' ? ' · headshot' : ''}${distance > 8 ? ` · ${Math.round(distance)} m` : ''}${work}`, 'good');
    },
  });
  remotes = new Map<number, RemotePlayer>();
  /** item ids on the quick-use keys 5-8 */
  quick: (string | null)[] = [null, null, null, null];
  corpses = new Map<string, { stash: Stash; body: CorpseBody }>();
  last = performance.now();
  fpsAcc = 0;
  fpsN = 0;
  fps = 0;
  started = false;
  joining = false;
  use: TimedAction | null = null;
  saveT = 0;
  econT = 0;
  /** seconds since what is in the racks was last looked at, offline */
  rackT = 0;
  poi: string | null = null;
  prompt: string | null = null;
  /** where on screen the thing the prompt is about sits (fractions of the screen) */
  mark: [number, number] | null = null;
  /**
   * Supply drops standing in the world (see src/sim/drops.ts): the crate, when it is due to
   * be cleared away (performance clock, ms), and its column of smoke.
   */
  drops = new Map<string, { stash: Stash; until: number; at: THREE.Vector3; smoke: { owed: number }; wreck?: { obj: THREE.Object3D; solid: unknown[] } }>();
  /** playing alone: game time the next one is due (-1 until the clock is first read) */
  nextDrop = -1;
  /** the helicopters in the air with a supply drop, and the crates coming down (src/game/airdrop.ts) */
  airdrops!: Airdrops;
  /** the page's own title: the tab shows the place in the line, and "your turn", over it */
  title = document.title;
  /** times at which the open inventory should look again at what lies on the ground (see drop) */
  vicinityDue: number[] = [];
  vicinityT = 0;
  vicinitySig = '';
  /** the pockets were closed but the mouse is not the game's yet: one click and it is */
  awaitClick = false;
  /** the chat is open and the mouse let go for it (see frame) */
  chatFree = false;
  /** the bot check's range, while the server has this game on it (see ./botcheck.ts): not yet anybody in the world */
  botCheck: BotCheck | null = null;
  rangeHeard = false;
  /** the men behind the shops' counters, and the counter itself (see src/sim/trade.ts) */
  traders: Traders | null = null;
  /** talking to whoever is near: hold V (src/game/voice.ts) */
  readonly voice = new Voice(() => (audio.ready ? audio.ctx : null), () => audio.voiceBus(), (piece) => this.net.sendVoice(piece));
  voiceSaid = false;
  /** the wells of the two towns (src/sim/wells.ts) */
  wells: Well[] = [];
  /** how hungry and how thirsty the player was last said to be: each is said once as it gets worse */
  wanting = [0, 0];
  /** the radio a call has been made on and not yet answered */
  radio: ItemInstance | null = null;
  /** drops called down and not yet landed: where, when they land, and the smoke that marks the place meanwhile */
  calls: { at: THREE.Vector3; until: number; smoke: { owed: number } }[] = [];
  shop!: ShopUI;
  /** what is written against this player in the trader's book: kept by the browser */
  credit = Math.max(0, Math.floor(Number(localStorage.getItem('zona.credit')) || 0));
  /** seconds G has been held (drop what is in the hands), and whether that press has done its work */
  dropHeld = 0;
  dropDone = false;
  focus: unknown = null;
  sharpFocus: { of: WorldItem; drop: () => void } | null = null;
  /** houses, cars and the like painted with their own pictures when the eye is near them (see near.ts) */
  near!: Near;
  openStash: Stash | null = null;
  /**
   * What lies within reach that holds things, opened with the pockets (see Game.openLying): waiting on the server's
   * word, this player's to go through, or somebody else's; and what of each was last told to the server.
   */
  lying = new Map<string, 'wait' | 'mine' | 'busy'>();
  lyingSent = new Map<string, string>();
  indoors = false;
  inForest = false;
  deathInfo = '';
  deathSent = false;
  warned = { hunger: false, thirst: false };
  heldKey = '';
  // --- multiplayer bookkeeping
  sendT = 0;
  meT = 0;
  meDirty = false;
  pendingTakes = new Map<string, { item: ItemInstance; id: string; qty: number }>();
  localDrops = new Set<string>();

  perf: Perf;
  /** graphics options the player picked in the Esc menu */
  gfx: Graphics = loadGraphics();
  tagT = 0;
  /** when a taken tag's time was last counted, by the clock on the wall (a hidden tab draws no frames: see `tagReal`) */
  tagWall = Date.now();
  /**
   * Seconds since tags were last counted. By the clock, not by frames drawn: put behind another tab, the game
   * draws nothing, and a tag's ten minutes stopped for as long as it was there. (The server keeps its own clock
   * on every tag and pays by that one: this is the one the player is shown, and the one that cashes it in.)
   */
  tagReal() {
    const now = Date.now(), s = Math.min(90, Math.max(0, (now - this.tagWall) / 1000));
    this.tagWall = now;
    return s;
  }
  /** when the player last got into a jeep (the keys are shown for a few seconds) */
  rideAt = -1e9;
  /** phones and tablets: on-screen stick and buttons */
  touch: TouchControls | null = null;
  /** on a phone: the player put the weapon away themselves, so nothing is drawn for them until they pick one */
  handsFree = false;
  /** opens the rewards modal once the entrance has played */
  slowFor = 0;
  slowHinted = false;

  constructor(public s: WorldSystems) {
    this.perf = new Perf(s.r.renderer);
    this.input = new Input(s.r.renderer.domElement);
    this.player = new Player(s.terrain);
    this.director = new CameraDirector(s.r.camera, this.player);
  }

  get online() {
    return this.net.online;
  }

  async init(progress: (label: string) => void) {
    const { r, atmo, buildings, veg, world } = this.s;
    await this.avatar.load(atmo, AVATAR_LAYER, true, lookFor(playerName()));
    r.scene.add(this.avatar.root, this.avatar.fpRoot);
    for (const l of atmo.csm.lights) l.shadow.camera.layers.enable(AVATAR_LAYER);

    this.effects = new Effects(r.scene, atmo);
    // (so a blast throws the ground it goes off on, and its marks lie on a road and not under it)
    this.effects.world(this.s.terrain, world);
    this.fires = new Fires(world, r.scene, this.effects, atmo);
    this.lamps = new Lamps(r.scene);
    // (whatever is got ready after the game has loaded is got ready for the lamps lit and for the lamps out)
    r.lighting = { lit: () => this.lamps.pool.visible, as: (lit) => this.lamps.as(lit) };
    this.lamps.canLight = (lit) => r.readyToLight(lit);
    this.lamps.held = (lit) => r.warming(lit);
    this.bunker = new BunkerSite(world, atmo, r.scene, this.s.terrain.lid, (o) => r.ready(o).then(() => r.send(o)));
    // (the army's field posts by the western roads: src/world/posts.ts)
    void new FieldPosts(world.posts ?? [], atmo, r.scene);
    this.cellars = new Cellars(r.scene, world.basements ?? []);
    // (the fort: stood where the map says, on the ground as the map has it; the earth round its hatch is drawn as the ground is)
    // (and what it draws is got ready before it is shown, as the bunker's is: a dozen kinds of surface made in the frame it first came into sight stood the game still on the way up to it)
    if (world.castle) this.castle = new CastleSite(world.castle, atmo, r.scene, { ground: (x, z) => heightAt(world.surface, x, z), earth: this.s.terrain.lid ?? undefined, ready: (o) => r.ready(o) });
    // (and the jeep that burns before its gate: where the fort's plan has it, on the ground as the map has it there.
    // Whoever rests by it is warmed as by a fireplace that is alight, and after dark the fires' lamp is its own
    // while it stands at it: its place and its lamp are told to the fires.)
    if (world.castle) {
      this.wreck = new WreckFire(world.castle, (x, z) => heightAt(world.surface, x, z), r.scene, atmo, this.effects, (o) => r.ready(o));
      this.fires.always.push({ at: this.wreck.foot, lamp: this.wreck.lamp });
    }
    // (a fall inside the fort is as long as its plan's: the speed of one a fifth shorter. See `landsAs`.)
    this.player.landsAs = (x, y, z) => (inCastle(world.castle ?? null, x, y, z) ? 1 / Math.sqrt(CASTLE_SCALE) : 1);
    // Its door is loud: heard by everybody on the map, wherever they are, and from where it is. (It was heard
    // within two hundred and seventy metres and by nobody else.) Far off it is as late and as dull as a far
    // sound is, and is brought no nearer to the ear than a hundred and ten metres along the line to it: the
    // ear is told which way, and it is never too faint to tell.
    this.bunker.onMove = (opening) => {
      const at = this.bunker.doorAt(new THREE.Vector3());
      if (!at) return;
      const ear = r.camera.position, d = at.distanceTo(ear), near = Math.min(d, 110);
      audio.blastDoor(d > near ? ear.clone().lerp(at, near / d) : at, d, opening);
      this.horde.noise(at.x, at.z, BUNKER.heard);
      this.hud.note(opening ? 'The bunker is opening' : 'The bunker is shutting', 'warn');
    };
    // the street lamps: where the head of each is
    for (const q of world.props) if (q.kind.startsWith('street_lamp')) this.streetLamps.push(new THREE.Vector3(q.x, q.y + 3.55 * (q.scale ?? 1), q.z));
    this.hearths = new Hearths(this.fires.spots);
    // the helicopters' pads: on the hospital's roof, and by the fort (src/world/helipad.ts)
    for (const pad of helipads(world, (m) => atmo.register(m))) r.scene.add(pad);
    progress('loading loot');
    this.loot = new LootManager(r.scene, atmo, buildings.lootPoints);
    this.airdrops = new Airdrops(r.scene, {
      // (the crate that comes down is the crate that stands there after: the same model, as big)
      crate: async () => {
        const o = (await this.loot.models.get('stash_kit')).group.clone();
        o.scale.setScalar(ITEMS.stash_kit.place ?? 1);
        return o;
      },
      canopy: async () => (await assets.model('parachute')).clone(),
      heli: async () => (await assets.model('apache')).clone(),
      register: (o) => atmo.registerObject(o),
      ready: (o) => r.ready(o),
      landed: (f) => this.dropLanded(f),
    });
    this.near = new Near(r.scene);
    // (no model of a thing is fetched here any more: each is, when a thing of its kind is first near. See LootManager.spawn.)
    // (never waited on for long: a card that will not say its shaders are made is not what keeps a thing out of the world)
    // (both ways it is drawn: by itself in the hands, and as a line of the list of its kind on the ground)
    this.loot.models.onMade = (tpl) => Promise.race([r.ready([tpl.group, ...this.loot.drawnWith(tpl)]).then(() => r.send(tpl.group)), new Promise<void>((done) => setTimeout(done, 6000))]);
    // (And a body is got ready before it is handed to whoever asked for it. The first of the infected and the
    // first other player to come into sight were five shaders each made in the frame: a second and a half in
    // which nothing moved. The first of a kind is what there is to wait for; each one after it has only its own
    // paints to be met under each lighting, a millisecond apiece, which was sixty of them in the one frame the
    // lamps were first lit in.)
    const bodies = new Set<string>();
    Avatar.onMade = (parts, kind) => {
      const first = !bodies.has(kind);
      bodies.add(kind);
      const all = r.ready(parts).then(async () => {
        if (first) for (const o of parts) await r.send(o);
      });
      return Promise.race([all, new Promise<void>((done) => setTimeout(done, first ? 8000 : 2000))]);
    };
    // (and what is put on any body, for the other lighting: see Avatar.onDressed)
    Avatar.onDressed = (parts) => void r.ready(parts);
    // (and a gun in another player's hands, likewise: see RemotePlayer.readyHeld)
    RemotePlayer.readyHeld = (obj) => Promise.race([r.ready(obj).then(() => r.send(obj)), new Promise<void>((done) => setTimeout(done, 3000))]);
    // (and a rack's guns, before the rack shows them: see GunRacks.onMade)
    GunRacks.onMade = (obj) => r.ready(obj).then(() => r.send(obj));
    this.loot.onPlaced = (l) => this.lootPlaced(l);
    this.grenades = new Grenades(r.scene, this.loot.models);
    await this.grenades.preload();
    this.grenades.onExplode = (at, mine, id) => this.explode(at, mine, id === 'frag' ? 'frag' : id === 'ammo_40mm' ? 'ammo_40mm' : 'grenade');
    this.garage = new Garage({
      scene: r.scene,
      atmo,
      world,
      terrain: this.s.terrain,
      player: this.player,
      avatar: this.avatar,
      net: this.net,
      effects: this.effects,
      input: this.input,
      remotes: this.remotes,
      ready: (parts) => void r.ready(parts),
      online: () => this.online,
      note: (text, kind) => this.hud.note(text, kind),
      boom: (at, mine) => this.explode(at, mine, 'jeep'),
      bump: (at, half, quat, speed) => this.bumpDummies(at, half, quat, speed),
      hurt: (amount, cause) => {
        this.player.damage(amount, cause);
        this.meDirty = true;
      },
    });
    await this.garage.load();
    this.riders = new Riders(atmo, r.scene, this.garage);
    this.loot.lift = (x, z) => roadLift(world, x, z);
    this.applyGraphics(this.gfx);
    // (offline, what the economy puts in a piece of furniture is not drawn: it is found when the piece is opened, see fillCrate)
    const inside = (l: WorldLoot) => l.point >= 0 && !!buildings.lootPoints[l.point]?.inside;
    this.economy = new Economy(buildings.lootPoints, {
      spawn: (l) => void (inside(l) || this.loot.spawn(l)),
      despawn: (l) => void (inside(l) || this.loot.despawn(l)),
    });
    // (the print of the places is said with hello, for the server to hold against its own: see lootPrint)
    let printed = '';
    this.net.lootPrint = () => (printed ||= lootPrint(buildings.lootPoints));
    // crates standing around the map become searchable containers, and the furniture that holds things (src/sim/storage.ts)
    for (const c of veg.crates) {
      const own = FURNITURE[c.kind], spec = CRATE_SPECS[c.kind] ?? (own ? { w: own.grid[0], h: own.grid[1], label: own.label } : null);
      if (!spec) continue;
      const st = new Stash(storageId(c.kind, c.x, c.y, c.z), c.x, c.y, c.z, c.rot, spec.w, spec.h, spec.label);
      st.kind = c.kind;
      st.adopt(c.collider);
      this.loot.crates.push(st);
    }
    // (and the doors of those of them that have doors, hung where their cases stand)
    this.lockers = new Lockers(world, r.scene, atmo);
    await this.lockers.load();
    // and what is searched in the bunker that is no crate: its lockers, racks, cabinets and desks
    // (each is solid already: what stands for it here is a grain of steel in the middle of it)
    const under = bunkerPlace(world);
    if (under) {
      for (const c of bunkerCrates(under)) {
        const spec = CRATE_SPECS[c.kind];
        if (!spec) continue;
        const st = new Stash(crateId(c.x, c.z), c.x, c.y, c.z, c.rot, spec.w, spec.h, spec.label);
        st.kind = c.kind;
        // (what is looked at and opened is the thing itself: the box that already stops a body there)
        const key = spotKey(c.x, c.z);
        st.adopt(this.bunker.solidAt.get(key) ?? veg.solidAt.get(key) ?? physics.addStatic(physics.R.ColliderDesc.cuboid(0.02, 0.02, 0.02), 'metal', { x: c.x, y: c.y + 0.5, z: c.z }));
        physics.tag(st.collider, { surface: 'metal', owner: st });
        this.loot.crates.push(st);
      }
    }
    this.racks = new GunRacks(r.scene, this.loot.models, RACK_PLAN);
    for (const st of this.loot.crates) if (RACKS.has(st.kind)) this.racks.add(st.uid, st.x, st.y, st.z, st.rot);

    progress('loading weapons');
    this.weapons = new Weapons(r.vmScene, r.vmCamera, atmo, this.player, this.inv, this.effects);
    // (built behind the menu, begun once the world is up and the menu shown (`buildBehind`, from src/main.ts), and
    // what wants them is done when they are: `loaded`)
    const behind = new Promise<void>((go) => (this.buildBehind = go));
    const guns = behind.then(() => this.weapons.load());
    // (and beside them the world got ready for the lighting it is not lit by, the lamps' (Renderer.warmOther): part of
    // what Deploy waits for, so that the card's last work on it is done in the menu and never in the game, where it
    // was six seconds of a game that stood still, the first night)
    const other = behind.then(() => r.warmOther(this.garage.warmers(), !TOUCH));
    this.weapons.mainCam = r.camera;
    this.weapons.itemModels = this.loot.models;
    // (a gun on the ground lies there with what is fitted to it: the copy of it that is seen in the hands)
    this.loot.models.dressed = (id, mods) => this.weapons.lyingModel(id, mods);
    this.weapons.onSlungChange = (obj) => {
      this.avatar.setSlung(obj);
      this.syncBack();
    };
    this.weapons.resolveTarget = (owner) => (owner instanceof Dummy || owner instanceof RemotePlayer || owner instanceof Infected ? owner : null);
    this.weapons.onHit = (h) => this.onHit(h);
    // whoever is hit carries the blood on their clothes where it landed
    this.weapons.onFlesh = (owner, pt, dir, power) => {
      if (power < 0.4) return;
      const body = owner instanceof RemotePlayer || owner instanceof Dummy || owner instanceof Infected ? owner.avatar : owner === this.player ? this.avatar : null;
      body?.wound(pt, dir, 0.05 + power * 0.04, power > 0.58);
    };
    // a grenade from a launcher (the M32): flown here and told to the server, which believes it from an admin alone
    this.weapons.onLaunch = (o, dir, w) => {
      const spec = LAUNCHED[w];
      if (!spec) return;
      const from = o.clone().addScaledVector(dir, 0.7), v = dir.clone().multiplyScalar(spec.speed);
      this.grenades.throw(from, v, spec.flight, true, w, true);
      if (this.online) this.net.send({ t: 'launch', o: from.toArray() as [number, number, number], v: v.toArray() as [number, number, number], w });
      this.horde.noise(o.x, o.z, INFECTED.hearShot);
    };
    this.weapons.onShot = (s) => {
      // (on the bot check's range the server is told of it as the range's own, and nobody else of anything)
      if (this.botCheck?.active) return void this.botCheck.shot(s.origin, s.dir);
      this.net.send({ t: 'shot', o: s.origin.toArray(), d: s.dir.toArray(), w: s.weapon, sup: s.suppressed });
      // the infected hear it as well as anybody
      this.horde.noise(s.origin.x, s.origin.z, s.suppressed ? INFECTED.hearQuiet : INFECTED.hearShot);
    };
    // a bullet in a fuel drum
    this.weapons.onStruck = (owner, weapon) => {
      if (owner instanceof Barrel) this.blowBarrel(owner.i, true);
      else if (owner instanceof Jeep) this.garage.struck(owner, weapon);
    };
    // the bolt, a reload: the same
    this.weapons.onAct = (a, d) => this.act(a, d);
    this.weapons.onSay = (text, kind) => this.hud.note(text, kind);
    this.weapons.onCarried = () => this.inventoryChanged();
    this.weapons.onSpill = (item) => {
      this.dropItem(item);
      this.hud.note(`No room for the ${ITEMS[item.id].name.toLowerCase()}: it is at your feet`, 'warn');
    };
    // a punch or a swing: your own body throws it, and everyone near you sees it
    this.weapons.onSwing = (seconds) => {
      this.avatar.swing(false, seconds);
      this.net.send({ t: 'swing' });
    };
    progress('compiling shaders');
    // (A loot model's materials are made ready when the model comes, off the frame: see ItemModels.onMade. They
    // were all fetched and warmed here, before anybody could play. The guns' are, once the guns are built: `loaded`.)
    const warm = new THREE.Group();
    // (one of each car, as it is painted for the world: see Garage.warmers)
    const cars = this.garage.warmers();
    for (const o of cars) warm.add(o);
    warm.position.copy(r.camera.position);
    r.scene.add(warm);
    // (asked for a part at a time, then made by the card's workers while the page goes on answering, and counted on
    // the loading screen: all in one, then drawn with at once, it was 25 seconds in which the page answered nothing.
    // The lamps' lighting is got ready behind the menu: see `other`, below.)
    await r.compileSoftly(null);
    await r.settle((d, n) => progress(`preparing graphics ${d}/${n}`));
    // (And drawn once with each, off the picture: see Renderer.drawAhead. Not on a phone, where the start is as
    // it was: the whole world drawn over before the first frame is more than is asked of one there untried.)
    if (!TOUCH) await r.drawWorldAhead();
    r.scene.remove(warm);
    // (their pictures are put on the card now, one to a frame's spare time: a car is in sight of where one comes in as often as not)
    void (async () => {
      for (const o of cars) await r.send(o);
    })();
    progress('rendering icons');
    // The pictures of things are kept from the build (public/assets/icons: `npm run icons`), one small file each,
    // fetched when it is first shown. Any whose thing has changed since it was made is made here, as all were.
    const keptIcons = (await fetch(assets.url('assets/icons/index.json')).then((res) => (res.ok ? res.json() : {})).catch(() => ({}))) as Record<string, string>;
    const icons: Record<string, string> = {};
    const stale: string[] = [];
    for (const id of Object.keys(ITEMS)) {
      const sig = iconSig(id);
      // (what is worn has two: one for a pocket, one for the place it is worn in. Both are kept or both are made.)
      if (keptIcons[id] === sig && (!hasSlotIcon(id) || keptIcons[`slot:${id}`] === sig)) {
        icons[id] = assets.url(`assets/icons/${id}.webp`);
        if (hasSlotIcon(id)) icons[`slot:${id}`] = assets.url(`assets/icons/slot-${id}.webp`);
      } else {
        stale.push(id);
        // (meanwhile the picture on disk, of the thing as it was, and not an empty cell: the new one waits on its
        // model, and the guns' come down behind the menu. 2026-10-19, after the texture caps left every gun's picture
        // out of date: "lots of missing icons...")
        if (keptIcons[id]) icons[id] = assets.url(`assets/icons/${id}.webp`);
        if (hasSlotIcon(id) && keptIcons[`slot:${id}`]) icons[`slot:${id}`] = assets.url(`assets/icons/slot-${id}.webp`);
      }
    }
    if (stale.length && import.meta.env.DEV) console.info(`${stale.length} item pictures are not kept, or are of what has changed: made here (npm run icons makes them again): ${stale.slice(0, 12).join(', ')}${stale.length > 12 ? '…' : ''}`);
    // What is built behind the menu (see `loaded`): the guns; then, with them, how they look in the hands and in
    // somebody else's (their shaders made off the frame, as a loot model's are), and any picture of a thing that is
    // out of date (a gun's is drawn from the gun). Deploy pressed meanwhile goes in now.
    this.loaded = guns
      .then(async () => {
        this.weapons.setLook(lookFor(playerName()));
        this.weapons.precompile((scene, camera) => r.precompile(scene, camera));
        const held = new THREE.Group();
        for (const id of Object.keys(ITEMS)) {
          const m = this.weapons.worldModel(id);
          if (m) held.add(m);
        }
        await Promise.race([r.ready([held]), new Promise<void>((done) => setTimeout(done, 6000))]);
        if (stale.length) Object.assign(icons, await renderIcons(r.renderer, this.loot.models, atmo.envMap, stale));
        assets.releaseModels();
        await other;
      })
      .catch((e) => console.error('what is built behind the menu', e))
      .then(() => {
        this.isLoaded = true;
        // (and the inventory's first opening got ready behind the menu: see InventoryUI.warm)
        this.invUI?.warm();
        if (this.wantIn) {
          this.wantIn = false;
          void this.join();
        }
      });
    const doll = await renderDoll(r.renderer, atmo.envMap, lookFor(playerName()));

    this.hud = new HUD(icons);
    this.hud.setName(playerName());
    this.minimap = new Minimap(world);
    this.hud.root.insertBefore(this.minimap.root, this.hud.root.firstChild);
    this.gas = new Gas(atmo.gases, atmo, r.scene, {
      masked: () => this.inv.wear('gas').length > 0,
      // (nothing hurts an admin in god mode, and the gas is no exception: 2026-10-13, "god mode make admin immune to gas")
      hurt: (amount) => void (this.powers.god || this.player.sicken(amount, 'the gas')),
      cough: (hard) => {
        this.weapons.flinch(hard);
        // (and it is heard: whatever of theirs is near comes to see who is choking)
        this.horde.noise(this.player.pos.x, this.player.pos.z, GAS.heard);
      },
      note: (text, kind) => this.hud.note(text, kind),
    }, this.hud.root, world);
    // how many people are in the world, shown before you click Play
    void serverStatus().then((s) => this.hud.setStartOnline(s ? s.players : null, s?.max, s?.queue));
    this.invUI = new InventoryUI(this.inv, {
      take: (w) => this.takeWorldItem(w),
      drop: (item) => {
        this.dropItem(item);
        // it lands a moment later: the list of what lies about is read again then, and once more
        // after it has settled (left to the five-second tick, a dropped thing seemed to vanish)
        this.vicinityDue = [performance.now() + 150, performance.now() + 700];
      },
      use: (item) => this.useItem(item),
      open: (item) => this.openBox(item),
      onGround: (w, how) => this.onGround(w, how),
      unload: (item) => this.unloadWeapon(item),
      attachTargets: (att) => this.attachTargets(att),
      attach: (att, weapon, loose) => this.attachMod(att, weapon, loose),
      detach: (weapon, mod, loose) => this.detachMod(weapon, mod, loose),
      fillMag: (mag) => this.fillMagazine(mag),
      fillAllMags: (ammo) => this.fillAllMagazines(ammo),
      emptyMag: (mag) => this.emptyMagazine(mag),
      looseFor: (mag) => this.inv.count(ITEMS[mag.id].mag?.ammo ?? ''),
      assignHot: (item, i) => this.assignHot(i, item),
      hotIndex: (item) => this.inv.hotOf(item),
      hold: (item, loose) => this.takeUp(item, loose),
      inHands: () => this.inv.held() ?? this.inHand,
      lying: (uid) => this.lying.get(uid) ?? null,
      release: (item) => this.release(item),
      changed: () => this.inventoryChanged(),
      sound: (k) => audio.ui(k),
      note: (text) => this.hud.note(text, 'info'),
    });
    // (Over the ground the bunker's gas is one of the world's clouds, as the works' is: the same lines draw it and
    // breathe it. This is the rest of it: it is all through the place under the ground, where none is drawn.)
    this.gas.under = (x, y, z) => bunkerUnder(this.bunker.place, x, y, z);
    this.invUI.icons = icons;
    this.invUI.doll = doll;
    this.invUI.selfId = publicId();
    this.invUI.carryLimit = CARRY_LIMIT;
    this.invUI.status = this.hud.statusPanel;
    // (The survivor in the middle of it, alive: see doll.ts. It asks what is worn, what is in the hands and what is
    // slung, and says when it has been drawn; until it is made, the still picture above is what is shown.)
    this.doll = new Doll(r, atmo, this.loot.models, {
      name: () => playerName(),
      worn: () => GEAR_SLOTS.map((s) => this.inv.slots[s]?.id).filter((x): x is string => !!x && GEAR_SHOWN.has(x)),
      hands: () => {
        const it = this.inv.held() ?? this.inHand;
        return it ? { id: it.id, mods: fittedOf(it) } : null;
      },
      held: (id, mods) => this.makeHeld(id, mods),
      back: () => JSON.stringify(this.weapons.slung()),
      slung: () => this.weapons.slungModel(),
      box: () => this.invUI.figureBox(),
      shown: (on) => this.invUI.figureShown(on),
    });
    this.invUI.figure = this.doll;
    // (and Emotes has the survivor beside its wheel, doing what is picked: empty-handed, dressed as the player is; asked
    // for its own place on the page by src/ui/emotes-menu.ts)
    this.emoteDoll = () =>
      (this.emoteFig ??= new Doll(r, atmo, this.loot.models, {
        name: () => playerName(),
        worn: () => GEAR_SLOTS.map((s) => this.inv.slots[s]?.id).filter((x): x is string => !!x && GEAR_SHOWN.has(x)),
        hands: () => null,
        held: (id, mods) => this.makeHeld(id, mods),
        back: () => '',
        slung: () => [],
        box: () => this.hud.emotes.box(),
        shown: (on) => this.hud.emotes.shown(on),
      }));
    this.hud.emotes.figure = { grab: () => this.emoteFig?.grab(), turn: (by) => this.emoteFig?.turn(by), drop: () => this.emoteFig?.drop() };
    // (a call picked there is heard as it is called in the game)
    this.hud.emotes.onCall = (id) => audio.shout(id, undefined, 0, voiceOf(playerName()));
    this.hud.emotes.onClose = () => this.toggleEmotes(false);
    this.pad = new Gamepad(this.input, {
      on: () => controls().pad,
      playing: () => this.started && !this.paused && !this.player.dead && !this.input.uiMode && !this.invUI?.isOpen && !this.map?.open && !this.shop?.isOpen && !this.adminUI?.isOpen && !this.hud.emotes.isOpen && !this.hud.chatOpen,
      facing: () => !!this.focus,
      riding: () => !!this.garage.ride,
      swap: () => this.breakOff() || this.turnMagWork() || this.nextWeapon(),
      hotStep: (dir) => this.hotStep(dir),
      look: () => ({ sens: controls().padSens, invert: controls().padInvert }),
      mouseSens: () => controls().sens,
      note: (text) => this.hud.note(text),
    });

    // one physics step so placement queries see every collider
    physics.step(physics.fixedDt);
    // somewhere to stand while the start screen is up
    const sp = world.spawn;
    this.player.spawn(sp.x, heightAt(world.heights, sp.x, sp.z) + 0.05, sp.z, sp.yaw);

    this.player.onLand = (speed) => this.weapons.landed(speed);
    this.player.onDamage = (amt, cause) => {
      if (cause === 'fall' && amt > 5) this.hud.note('You hurt yourself in the fall', 'warn');
    };
    this.player.onBreak = () => {
      audio.snap();
      this.weapons.flinch(1.6);
      this.hud.note('Your leg is broken: you cannot run or jump. A splint or a first aid kit sets it', 'warn');
      this.meDirty = true;
    };
    this.player.onSet = (by) => {
      this.hud.note(by ? 'Your leg is set: you can run on it again' : 'Your leg has knitted: you can run on it again', 'good');
      this.meDirty = true;
    };
    this.player.onClot = () => {
      this.hud.note('The bleeding has stopped on its own', 'good');
      this.meDirty = true;
    };
    this.hud.people = () => [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name }));
    this.hud.onLogout = (cancel) => {
      if (this.online && !this.player.dead) this.net.send(cancel ? { t: 'logout', cancel: true } : { t: 'logout' });
    };
    // Behind another tab no frame is drawn, and nothing that is done once a frame is done: a taken tag's time
    // is counted here meanwhile, once a second (or as often as the browser lets a hidden tab do anything).
    window.setInterval(() => {
      if (document.hidden && this.started && this.online && !this.player.dead) this.tickTags(this.tagReal());
    }, 1000);
    // the keys as the player has set them, and how fast their mouse turns the head (src/core/keys.ts)
    const turn = this.player.sensitivity;
    const applyControls = (c: Controls) => {
      this.input.rebind(translation(c));
      this.player.sensitivity = turn * c.sens;
    };
    applyControls(controls());
    this.hud.onControls(applyControls);
    // the four groups of sound under the one volume (Settings, Audio): as they were kept, and as they are dragged
    audio.setMix(loadMix());
    this.hud.onSound((volume, mix) => {
      audio.setVolume(volume);
      audio.setMix(mix);
    });
    this.hud.onPass = (pw) => {
      if (this.online) this.net.send({ t: 'admin', pw });
      else this.hud.chatLine('system', '', 'You are playing offline: there is no server to be an admin of.');
    };
    this.hud.onChat(
      (ch, text) => {
        if (this.online) this.net.send({ t: 'chat', ch, text });
        else {
          this.hud.chatLine(ch, playerName() || 'You', text);
          this.hud.chatLine('system', '', 'You are playing offline: nobody can hear you.');
        }
      },
      // the keyboard is the game's again
      () => this.input.releaseAll(),
    );
    this.hud.onStart(() => this.resume());
    this.hud.onRespawn(() => this.respawn());
    if (TOUCH) {
      this.input.touch = true;
      const inPlay = () => this.started && !this.paused && !this.player.dead;
      this.touch = new TouchControls(this.input, {
        menu: () => this.input.unlock(),
        inventory: () => this.started && !this.player.dead && this.toggleInventory(),
        swap: () => inPlay() && (this.breakOff() || this.turnMagWork() || this.nextWeapon()),
        emote: (id) => inPlay() && this.emote(id),
        editEmotes: () => inPlay() && this.toggleEmotes(true),
        chat: () => {
          if (!inPlay() || this.invUI.isOpen || this.hud.chatOpen) return;
          this.input.releaseAll();
          this.hud.openChat();
        },
      });
      // a tap on the corner map opens the sheet (M on a keyboard); the sheet has its own way out
      this.minimap.root.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (inPlay() && !this.invUI.isOpen) this.toggleMap(true);
      });
    }
    // Tapping (or clicking) a hotbar slot is the same as pressing its number. On a phone a tap
    // on the weapon that is already in the hands puts it away (X on a keyboard), and that is
    // remembered: empty hands that were asked for are left empty (see the frame loop).
    this.hud.onHotbar((key) => {
      const item = this.inv.hotItem((Number(key) + 9) % 10);
      if (this.touch && item && (ITEMS[item.id].weapon || ITEMS[item.id].melee)) {
        const mine = this.inv.held() === item;
        this.handsFree = mine;
        if (mine) return this.weapons.take(null);
      }
      this.input.simulate(`Digit${key}`, true);
      setTimeout(() => this.input.simulate(`Digit${key}`, false), 80);
    });
    this.hud.bindGraphics(
      this.gfx,
      (g) => this.applyGraphics(g),
      () => {
        const cv = r.renderer.domElement;
        return `Rendering ${cv.width} × ${cv.height} · ${((cv.width * cv.height) / 1e6).toFixed(1)} million pixels a frame`;
      },
    );
    // Dog tags and creator rewards: a line under the way in says a wallet is wanted (or is
    // given), and opens the window that explains it; so does Rewards in the menu. (The window
    // used to come up by itself a few seconds after the page did, over the menu somebody had
    // just started to read.)
    if (REWARDS_UI) {
      const modal = new RewardsModal(document.getElementById('ui')!, () => this.hud.nameValue(), () => this.hud.setWallet(walletAddress()));
      this.hud.onRewards(() => modal.open());
      this.hud.setWallet(walletAddress());
      onTagPay((sol) => this.hud.setPay(sol));
    }
    // the menu's map: the game's own, and what is said of each place on it
    {
      const town = world.pois[0];
      const spots: MenuSpot[] = world.spawns.map((sp) => ({ x: sp.x, z: sp.z, name: 'A start', tip: 'New survivors drop in here on the west coast, with bare hands. The further east, the better the loot.', kind: 'spawn' as const }));
      // (what is said of each kind of place, and which step of the map it is: see src/sim/tiers.ts. What is to be
      // had at a step is said under it, unless the place has more to say for itself.)
      const SITE: Record<SiteKind, [string, Tier, string?]> = {
        lodge: ['A cabin and a shed, with a fire ring to rest by. Something to fight with is always left here.', 1],
        farm: ['A house, a barn and a shed. Something to fight with is always left here.', 1],
        post: ['A guard post and a shed. Something to fight with is always left here, and the army left its cases.', 1],
        yard: ['A barn, sheds and a workshop: tools, fuel, crates. Something to fight with is always left here.', 1],
        dacha: ['A brick house and a shed. Something to fight with is always left here.', 1],
        hamlet: ['A shop between houses, a barn behind, a fire ring to rest by.', 1, 'Food and drink at the shop, melee weapons and tools in the barn and the shed.'],
        depot: ['A barracks, a workshop and a watchtower.', 2, 'Pistols and 9 mm, soft vests, boots and gloves, fuel. Now and then an armoured vest.'],
        market: ['A trader behind the counter: he buys what you bring, sells supplies, and has paid work every day.', 2, 'Whatever you can pay for.'],
        tents: ['Four army tents and a watchtower in the wood south of the west road. A pistol is always left here.', 2, 'Pistols and 9 mm, soft vests, bandages, the army\'s cases. Now and then an armoured vest or a helmet, and a gas mask if you are lucky.'],
        works: ['', 4],
        bunker: ['', 5],
        town: ['Brick houses two floors high down both sides of the road, plank houses, a police station, a clinic, a shop. Out of the valley by the paved road, and inside the Zona.', 3],
        squat: ['A plank house on piles, three floors of it, far out in the south country. Outside the Zona: tags are not earned here.', 1],
        camp: ['Two long huts and two containers in the north woods. Outside the Zona: tags are not earned here.', 1],
      };
      const at = (q: { x: number; z: number; name: string }, tip: string, kind: MenuSpot['kind'], tier: Tier, finds?: string, label = false): MenuSpot => ({ x: q.x, z: q.z, name: q.name, tip, kind, tier, finds: finds ?? TIERS[tier].finds, ...(label ? { label } : {}) });
      for (const q of world.pois.slice(1)) {
        const site = world.sites.find((st) => st.name === q.name);
        if (site?.kind === 'bunker') spots.push(at(q, 'Under the ground, in the dark: a dozen rooms off two passages. Its door opens to a keycard, and the keycards are under the gas.', 'army', 5, undefined, true));
        else if (q.name === GAS.place) spots.push(at(q, 'Under gas: you need a gas mask on to breathe here, and the masks are at the police station in the village.', 'gas', 4, undefined, true));
        else if (site?.kind === 'town') spots.push(at(q, SITE.town[0], 'town', 3, undefined, true));
        // (the fort on the mountain: named on the map, as the bunker and the works are; a place of the fourth step)
        else if (world.castle && q.x === world.castle.x && q.z === world.castle.z) spots.push(at(q, "The Eagle's Nest: an old fort on the east rim of the valley, in the snow under the mountain, held to the last as the army's signals post. A cart track leaves the end of the mountain road, passes the ruined houses and goes round under its walls to the ramp at its gate. Its vaults are dark.", 'army', 4, undefined, true));
        else if (site) spots.push(at(q, SITE[site.kind][0], site.kind === 'market' ? 'trader' : site.kind === 'depot' || site.kind === 'post' || site.kind === 'tents' ? 'army' : 'site', SITE[site.kind][1], SITE[site.kind][2], site.kind === 'tents'));
        else if (/checkpoint/i.test(q.name)) spots.push(at(q, 'Guard posts, a barracks and a watchtower. The track to the works starts here.', 'army', 2, 'Pistols and 9 mm, soft vests, grenades, the army\'s cases. Now and then an armoured vest or a helmet.', true));
        // (the places of the map three times over, each on its step: PLAN.tiers; they were marked as cabins of the first)
        else if (WEST_PLACES[q.name]) spots.push(at(q, WEST_PLACES[q.name][0], WEST_PLACES[q.name][1], (PLAN.tiers[q.name] ?? WEST_PLACES[q.name][2]) as Tier, undefined, true));
        else spots.push(at(q, 'A cabin in the hills, with a fire ring to rest by. Something to fight with is always left here.', 'site', 1));
      }
      // (the pass through the ridge: its caves, and the cache at the middle of its floor)
      const [cx, , cz] = passWorld(passPlan, FLOOR_CACHE.s, 0, 0);
      spots.push(at({ x: cx, z: cz, name: 'The pass' }, 'The one way through the ridge: a canyon with shelves up both walls and caves in them, and the best of it cached on the floor at its middle.', 'army', 3, 'The caves and the cache at the middle of the floor hold the third step\'s things.', true));
      spots.push(at({ x: town.x, z: town.z + 46, name: town.name }, 'The village: police station, clinic, shop, workshop. The first place to go from the edge, and the most people after it.', 'town', 2, undefined, true));
      const inTown = (b: { x: number; z: number }) => Math.hypot(b.x - town.x, b.z - town.z) < town.radius;
      for (const b of world.buildings.filter(inTown)) {
        if (b.type === 'police') spots.push(at({ x: b.x, z: b.z, name: 'Police station' }, 'The armoury of the village. The gas masks are kept here: without one, nobody goes into the Chemical Works.', 'police', 2, 'Pistols, 9 mm, soft vests, gas masks, and what goes on a pistol.'));
        else if (b.type === 'police_hq') spots.push(at({ x: b.x, z: b.z, name: 'Police headquarters' }, 'Three blocks round a yard at the foot of the street south of the road. The main block has a stair at each end and steel stairs outside each end, up to the roof; the cells are to the west with the men\'s quarters over them; the garage is to the east, and its roof is a terrace the chief\'s room opens onto, with stairs of its own down the outside.', 'police', 2, 'Pistols, 9 mm, soft vests, gas masks, and what the armoury kept.'));
        else if (b.type === 'clinic') spots.push(at({ x: b.x, z: b.z, name: 'Clinic' }, 'Where the wounded were brought.', 'clinic', 2, 'Bandages, stims, first aid kits, and tape to splint a broken leg.'));
        else if (b.type === 'store') spots.push(at({ x: b.x, z: b.z, name: 'Shop' }, 'The village shop.', 'shop', 2, 'Food and drink, and dressings.'));
      }
      for (const b of world.buildings) if (b.type === 'hospital') spots.push(at({ x: b.x, z: b.z, name: 'Hospital' }, 'Kamenka\'s district hospital: three floors and the roof. Casualty and the dispensary below, the wards above them, the theatres and the laboratory at the top. A stair at each end and steel stairs outside each end, from the roof down; a balcony over the doors; a wing behind with a stair of its own and a terrace on its roof.', 'clinic', 3, 'More dressings, stims and first aid kits than anywhere. On the roof somebody left a rifle, its scope and its suppressor.'));
      for (const w of wellSpots(world)) spots.push({ x: w.x, z: w.z, name: 'Well', tip: 'Drink your fill, and fill every bottle you carry.', kind: 'well' });
      // (each place's step worked out from the loot about it, cellars and wrecks aside, as they are finds of their own: see tierAround)
      const marked = buildings.lootPoints.filter((p) => p.building !== 'cellar' && p.building !== 'wreck');
      for (const s of spots) {
        if (!s.tier) continue;
        const t = tierAround(marked, s.x, s.z, s.label ? 80 : s.kind === 'police' || s.kind === 'clinic' || s.kind === 'shop' ? 15 : 40);
        if (!t || t === s.tier) continue;
        if (s.finds === TIERS[s.tier].finds) s.finds = TIERS[t].finds;
        s.tier = t;
      }
      // (the square: where everybody starts, 2026-10-16)
      this.hud.setMenuMap(this.minimap.poster(), 2 * SQUARE_HALF, spots, atmo.gases);
      // (and the map opened in the game says the same of the same places)
      this.map = new BigMap(world, buildings.lootPoints, spots, atmo.gases, () => this.minimap.live);
      this.map.ahead();
      this.map.onClose = () => this.toggleMap(false);
      document.getElementById('ui')!.appendChild(this.map.root);
      // the panel of whoever has a role (shut and empty for everybody else)
      // (the starts are all "A start" on the map: in the panel each is told by the side of the valley it is on and
      // the nearest place with a name. 2026-10-13: "we need to rename the starts locations theyre all A start".)
      const SIDES = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];
      const named = spots.filter((s) => s.kind !== 'well' && s.kind !== 'spawn');
      const seen = new Map<string, number>();
      const starts = spots.filter((s) => s.kind === 'spawn').map((s) => {
        const by = named.reduce((a, b) => (Math.hypot(b.x - s.x, b.z - s.z) < Math.hypot(a.x - s.x, a.z - s.z) ? b : a));
        const name = `${SIDES[(Math.round((Math.atan2(s.x, -s.z) / (Math.PI * 2)) * 8) + 8) % 8]} edge, by ${by.name}`;
        seen.set(name, (seen.get(name) ?? 0) + 1);
        return { name: seen.get(name)! > 1 ? `${name} (${seen.get(name)})` : name, x: s.x, z: s.z, kind: 'spawn' };
      }).sort((a, b) => a.name.localeCompare(b.name));
      this.adminUI = new AdminUI([...named.map((s) => ({ name: s.name, x: s.x, z: s.z, kind: s.kind as string })), ...starts], {
        order: (line) => this.order(line),
        ask: () => {
          if (this.online && this.role) this.net.send({ t: 'adm' });
          this.adminUI.setSelf(this.adminSelf());
        },
        freecam: (on) => this.toggleFreecam(on),
        // (the map first: the mouse stays free from the one to the other)
        map: () => {
          this.adminUI.close();
          this.toggleMap(true);
        },
        watch: (id) => {
          this.toggleAdmin(false);
          this.watch(id);
        },
        night: (on) => {
          this.nightSight = on && this.role === 'admin';
          this.adminUI.setSelf(this.adminSelf());
        },
        tint: (color) => this.setTint(color),
        names: (on) => {
          this.namesWanted = on && this.role === 'admin';
          try {
            localStorage.setItem('zona.admin.names', this.namesWanted ? '1' : '0');
          } catch {
            /* not kept: it is as it was the next time */
          }
          this.adminUI.setSelf(this.adminSelf());
        },
        look: () => this.adminLook(),
        // (whoever is picked in the panel is ringed on the map as well)
        picked: (id) => this.map.pick(id === this.net?.id ? 0 : id),
        close: () => this.toggleAdmin(false),
      }, icons);
      document.getElementById('ui')!.appendChild(this.adminUI.root);
    }
    this.menu = new MenuScenes({
      world, atmo, scene: r.scene, effects: this.effects, held: (id, mods) => this.makeHeld(id, mods), wear: (body, ids) => this.wear(body, ids),
      // (a case stood in the world for a scene, as one a player drops is stood, and nobody's: it is not among the stashes that are kept, and the menu takes it away)
      stash: async (item, x, z, rot) => {
        const st = this.newStash({ uid: `menu_${item}_${Math.round(x)}_${Math.round(z)}`, x, y: heightAt(world.heights, x, z), z, rot, item });
        st.spawn(await this.loot.models.get(st.item), r.scene);
        return st;
      },
      // (the lamp of somebody in a scene: said as another player's is, with no disc of light at it)
      beam: (pos, dir, power, wide) => this.lamps.beam(pos, dir, power, wide, 0),
    });
    // (its cast is sent for when the game is up: see `afterBoot`)
    // The ground ends at the edge of the world, and there was nothing there to stop anybody walking or
    // driving off it. Four walls that cannot be seen, a few paces in from the edge: the wild country round
    // the map is all there to be walked, and nobody falls out of the world. In the west the wall stands on the
    // beach (PLAN.barrier: the owner, "no need to go into it or swim can put barrier on beach").
    {
      const west = Math.max(WORLD_X0 + 4, PLAN.barrier), east = WORLD_X1 - 4;
      const mx = (west + east) / 2, mz = (WORLD_Z0 + WORLD_Z1) / 2, hx = (east - west) / 2, hz = (WORLD_Z1 - WORLD_Z0) / 2 - 4;
      for (const [x, z, ax, az] of [[mx, mz + hz, hx, 1], [mx, mz - hz, hx, 1], [mx + hx, mz, 1, hz], [mx - hx, mz, 1, hz]]) physics.addStatic(physics.R.ColliderDesc.cuboid(ax, 400, az), 'rock', { x, y: 0, z });
      // And one along the ridge's crest, the whole height of the map, but where the pass goes through it (plan v5:
      // "both sides of the map canyon walls stretching to the skybox so they cant be walked around"); over a cave, from
      // over its roof (the long way goes under it: src/sim/pass.ts caveSpansUnder), only that stretch of it raised.
      // (Up to RIDGE_OVER over the crest, no higher: a helicopter flies over it (the owner, 2026-10-17: "can we make it
      // so you can fly the heli over the desert wall"); nobody climbs or jumps that much.)
      for (const [ax, az, bx, bz] of ridgeWall(WORLD_Z0, WORLD_Z1)) {
        const yaw = Math.atan2(-(bz - az), bx - ax), L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
        let crest = -Infinity;
        for (let t = 0; t <= 1; t += 0.125) crest = Math.max(crest, heightAt(world.heights, ax + (bx - ax) * t, az + (bz - az) * t));
        const top = crest + RIDGE_OVER;
        for (const { from, to, foot } of wallParts(L, caveSpansUnder(passPlan, ax, az, bx, bz), -400, 0.6)) {
          if (top - foot < 1) continue;
          const m = (from + to) / 2;
          physics.addStaticQuat(physics.R.ColliderDesc.cuboid((to - from) / 2, (top - foot) / 2, 0.6), 'rock', { x: ax + ux * m, y: (top + foot) / 2, z: az + uz * m }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
        }
      }
    }
    this.traders = new Traders(world);
    this.minimap.setTraders(this.traders.places);
    this.wells = wellSpots(world);
    this.minimap.setWells(this.wells);
    void this.traders.load(r.scene, atmo, (body, ids) => this.wear(body, ids));
    this.shop = new ShopUI({
      credit: () => this.credit,
      // (what is carried, and the guns that are not in the hands: not what is worn, nor a bag with things in it)
      wares: () =>
        [...this.inv.containers.flatMap((c) => c.items.map((pl) => pl.item)), ...WEAPON_SLOTS.filter((sl) => sl !== this.inv.active).map((sl) => this.inv.slots[sl])]
          .filter((it): it is ItemInstance => !!it && !it.cargo?.length && pays(it) > 0)
          .map((item) => ({ item, pays: pays(item) })),
      stock: () => {
        const bought = this.jobBook().bought ?? {};
        return STOCK.map((id) => ({ id, asks: asks(id), left: aDay(id) - (bought[id] ?? 0) })).filter((x) => x.asks > 0);
      },
      icon: (id) => this.invUI.icons[id],
      jobs: () => {
        const book = this.jobBook();
        return jobsFor(book.day).map((j) => ({ id: j.id, text: j.text, n: j.n, pays: j.pays, have: jobDone(j, book, (id) => this.countOf(id)), paid: book.done.includes(j.id) }));
      },
      handIn: (id) => {
        const book = this.jobBook();
        const job = jobsFor(book.day).find((j) => j.id === id);
        if (!job || book.done.includes(id)) return 'That one is settled.';
        if (jobDone(job, book, (x) => this.countOf(x)) < job.n) return 'Not yet it is not.';
        if (job.kind === 'bring') {
          if (this.inv.take(job.item!, job.n) < job.n) return 'You have not got them on you.';
          this.inventoryChanged();
        }
        book.done.push(id);
        this.keepBook(book);
        this.setCredit(this.credit + job.pays);
        audio.ui('open');
        return null;
      },
      sell: (item) => {
        const got = pays(item);
        if (!got) return;
        this.inv.remove(item);
        this.setCredit(this.credit + got);
        this.inventoryChanged();
        audio.ui('close');
      },
      buy: (id) => {
        const cost = asks(id);
        if (!cost) return 'I do not sell that.';
        const book = this.jobBook();
        if ((book.bought?.[id] ?? 0) >= aDay(id)) return 'No more of those today. Come back tomorrow.';
        if (cost > this.credit) return `That is ${cost}. You have ${this.credit} with me.`;
        const it = makeItem(id, sold(id));
        if (!this.inv.hasRoom(it)) return 'You have nowhere to put it. Sell me something first.';
        this.inv.add(it);
        book.bought = { ...book.bought, [id]: (book.bought?.[id] ?? 0) + 1 };
        this.keepBook(book);
        this.setCredit(this.credit - cost);
        this.inventoryChanged();
        audio.ui('open');
        return null;
      },
      closed: () => {
        this.input.uiMode = false;
        if (this.started && !this.player.dead) this.input.lock();
        setTimeout(() => {
          if (this.started && !this.paused && !this.invUI.isOpen && !this.shop.isOpen && !this.input.locked && !this.player.dead) this.awaitClick = true;
        }, 400);
        this.save();
      },
    });
    this.hud.showStart(true);
    // FPS mouse: play only while the mouse is captured. Esc releases it -> pause menu;
    // clicking the menu captures it again and play resumes.
    this.input.onLockChange = (locked) => {
      if (locked) {
        if (this.started) this.unpause();
      } else if (!this.invUI.isOpen && !this.map?.open && !this.adminUI?.isOpen && !this.hud.emotes.isOpen && !this.hud.chatOpen && !this.player.dead && this.started && !this.arenaHud?.ended) this.pause();
      // (an Arena match over: the mouse is let go for its result's card, which is no pause, and nothing takes it
      // back. 2026-10-14, the owner: "when the match settlement ui shows up i am unable to interact with it, the
      // escape menu pops up and when i go back to game i cant actually click or move my mouse on the ui")
    };
    // (The browser lets the sound start only in a press of a key or a button. It was started by Deploy's alone: a game
    // gone into another way (back in by itself after a dropped connection, see rejoining) was silent, and so, players
    // said, until a setting was changed. In the game any press starts it, or wakes it where the browser has put it to
    // sleep: "everytime i join the game or rejoin the game, i have to changethe audio in settins to get sound back".)
    for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => this.started && audio.start(), { capture: true });
    // (and whoever is alive in a life is asked before the tab goes: Ctrl and W, the browser's own, is a helicopter
    // going down and forward. The game's own reloads are not asked about: src/core/leave.ts)
    window.addEventListener('beforeunload', (e) => {
      this.save();
      if (this.started && !this.player.dead && !leaving.now) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    keepKeysInFullScreen();
    // Dead, Space is the Respawn button. (Not in the first second: whoever died with a thumb on it, jumping, is
    // shown what killed them before they are somewhere else.)
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat || !this.started || !this.player.dead || !this.deathSent) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT' || this.hud.chatOpen || this.adminUI?.isOpen) return;
      if (performance.now() - this.diedAt < 1000) return;
      e.preventDefault();
      this.respawn();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.hud.emotes.isOpen) this.toggleEmotes(false, true);
      else if (this.adminUI?.isOpen) this.toggleAdmin(false, true);
      else if (this.shop?.isOpen) this.shop.close();
      else if (this.map?.open) this.toggleMap(false, true);
      else if (this.invUI?.isOpen) this.toggleInventory(false, true);
      // a second Escape, with the mouse still free, is the menu
      else if (this.awaitClick) {
        this.awaitClick = false;
        if (this.started && !this.player.dead && !this.arenaHud?.ended) this.pause();
      }
    });
    this.director.update(0.016);
  }

  holdTimer = 0;

  /**
   * Somebody else's tag in your pockets counts up while you are alive. After TAG_HOLD
   * seconds it is cashed in and leaves the inventory. The clock belongs to whoever is
   * carrying the tag: when it changes hands it starts again.
   */
  /** seconds this player has been outside the Zona carrying a tag they took (see TAG_OUT) */
  outFor = 0;
  /** the tags they carry that they took off somebody (as of the last look, a second ago at most) */
  takenTags: string[] = [];

  maxPlayers = 0;
  /** the server said it was about to restart: why, and when it said so (by this game's clock) */
  restartSaid: { why: string; at: number } | null = null;
  /** in a wager, the arena's own screen over the HUD (src/ui/arena-hud.ts); null in the open world */
  arenaHud: ArenaHud | null = null;
  /**
   * What is built behind the menu rather than before it (the guns, their shaders, any inventory picture that is out
   * of date): the menu is up while it is, and Deploy waits for it (`isLoaded`; pressed before, it is remembered in
   * `wantIn` and goes in when it is). The owner, 2026-10-14: "can we download it while letting the user into the
   * main menu etc and download it i nthe background", and "whatever is best for the UX without losing any
   * functionality". Building every gun was 26 of the 44 seconds before the menu.
   */
  loaded!: Promise<void>;
  isLoaded = false;
  wantIn = rejoining();
  /** starts what is built behind the menu (called once the menu is shown) */
  buildBehind: () => void = () => {};
  /** the server's messages have their handlers (once a page: wireNet); and this game is leaving an Arena match itself, so its connection's going is no result to show */
  netWired = false;
  arenaLeaving = false;
  /** carrying a tag taken off somebody (the one round their own neck does not count): no jeep takes them (see Garage.use) */
  get tagged() {
    const me = publicId();
    // (a keycard went on foot too, until 2026-10-14: the owner, "players can drive a vehicle with bunker cards now its ok just not dogtags")
    return !!this.inv.find((it) => it.id === 'dogtag' && it !== this.inv.neck && it.pid !== me);
  }

  /** the jeep the view was last behind (so going in and out of one is a move of the view, not a cut) */
  rode: Jeep | null = null;

  makeHeld = (id: string | null, mods: string[]) => {
    if (!id) return null;
    const def = ITEMS[id];
    const obj = this.weapons.worldModel(id, mods);
    const grips = this.weapons.gripsOf(id, mods);
    if (!obj || !grips) return null;
    // (a pair is held out as two pistols are, one in each hand)
    if (def?.weapon) return { obj, grips, kind: def.weapon.akimbo ? ('pistol' as const) : def.weapon.kind };
    return def?.melee ? { obj, grips, kind: 'melee' as const } : null;
  };

  backKey = '';

  /** what each player has on that shows, as the server last said: their picture in the panel wears it */
  gearOf = new Map<number, string[]>();
  /** the lists the panel last had: how much blood each player has is said beside their name in the far view */
  admPlayers = new Map<number, AdminPlayer>();
  /** a head drawn, for each name and each set of things worn */
  heads = new Map<string, string>();
  headsBusy = false;

  portraitN = 0;
  /** the survivor in the inventory window, alive (null until the game has loaded that far) */
  doll: Doll | null = null;
  /** Emotes' survivor, made when first wanted */
  emoteDoll: () => Doll = () => {
    throw new Error('the game is not made yet');
  };
  /** a second of it for Emotes, made the first time that is opened (see `emoteDoll`) */
  private emoteFig: Doll | null = null;
  gearKey = '';

  /** the stashes whose models are still on their way, by their number: what is said of one meanwhile is not lost */
  stashComing = new Map<string, Stash>();

  /** a shell's pellets that have landed on somebody and not been told to the server yet: [who, how many in each zone] */
  pellets = new Map<unknown, { h: HitInfo; zones: Record<string, number>; n: number }>();

  // ------------------------------------------------------------ flow

  paused = true;

  /** the hour as it was at some moment (the server's, or mid morning when playing alone), from which the clock runs on */
  /** how many pellets the hit being told to the server now stands for (0: an ordinary hit) */
  pelletsOut = 0;
  hourBase = { phase: DAY.start, at: performance.now() };
  /** the hour held still (for looking at a time of day: see T.hour in the harness), or null */
  hourHeld: number | null = null;
  wasNight: boolean | null = null;

  buriedT = 0;
  /** when this player last died, by this game's clock (Space respawns, but not in the same breath) */
  diedAt = 0;

  adminUI!: AdminUI;
  mapAskT = 0;
  mapFeedT = 0;

  /**
   * The colour this admin has chosen for the word ADMIN before their name in the chat (null: the rainbow it is by
   * default). Kept by this browser, and said to the server whenever it says this player is an admin.
   */
  tint: string | null = (() => {
    try {
      const c = localStorage.getItem('zona.adminTint');
      return c && /^(off|#[0-9a-f]{6})$/i.test(c) ? c : null;
    } catch {
      return null;
    }
  })();

  /** an admin's night vision: it is day in this game alone, whatever the hour (the hour itself goes on as it does) */
  nightSight = false;
  powers = { god: false, hidden: false, clip: false, voidInv: false, voidTag: false, weightless: false, endless: false, bottomless: false };
  /** the view has left the body: where it is, and which way it looks */
  freecam: { pos: THREE.Vector3; yaw: number; pitch: number } | null = null;
  /** how fast the free camera flies, metres a second (the wheel changes it) */
  freeSpeed = 14;

  /** whoever the free camera is kept with as they go: their number, and where they last were */
  watching: { id: number; last: THREE.Vector3 } | null = null;

  espAsked = 0;
  /** an admin wants everybody's name shown where they are (the panel's switch; remembered) */
  namesWanted = (() => {
    try {
      return localStorage.getItem('zona.admin.names') === '1';
    } catch {
      return false;
    }
  })();
  namesOn = false;
  freeView = (cam: THREE.PerspectiveCamera) => {
    const f = this.freecam;
    if (!f) return;
    cam.position.copy(f.pos);
    cam.quaternion.setFromEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ'));
  };

  /** what the server lets this player do out of the way: nothing (null), keep order, or everything */
  role: 'admin' | 'mod' | null = null;

  /** the left button is being held on what the hands are at: let go, it is broken off */
  holding = false;
  /** what the eye is on within arm's reach this frame (a door, a car, a crate, a thing on the ground), as `interact` found it */
  lookedAt: unknown = null;

  /** the thing that is not a weapon that is in the hands, waiting or being used (null: none) */
  inHand: ItemInstance | null = null;

  /**
   * A thing being used straight off the ground. It is in the hands for as long as that takes
   * and nowhere else; whatever is left of it afterwards (all of it, if the use was broken
   * off) goes into the pockets, or is put down again when they are full.
   */
  loose: ItemInstance | null = null;

  /**
   * An injector taken into the hand and not yet used. Its key (or Use, in the inventory) brings it out and a
   * click uses it; the wheel, the other button, its own key again, a weapon's key or the inventory puts it away.
   * `t` is how long it has been out: the click that chose Use in a menu is not the click that uses it.
   */
  ready: { item: ItemInstance; t: number } | null = null;

  /** binoculars at the eyes: how much of the field of view is left (0 = put away) */
  glass = 0;
  /** when they were last put down: the same key press must not bring them straight back up */
  glassDown = 0;
  // when the player was last told what the marks on the map mean (said once in a while, not every half minute)
  markedSaid = -1e9;
  pingSaid = -1e9;

  /**
   * A grenade in the hands that are getting its pin out, or with its pin out (2026-10-13: "rework the grenade
   * throwing mechanic so it functions more like PUBG or DAYZ or COD ... hold to cook the grenade for multiple
   * seconds before throwing it"). The rules are src/sim/grenades.ts; this is the hands' side of them.
   *   t      seconds since the hands began
   *   live   seconds since the pin came out (less than nought: it is not out yet, and the other button or the
   *          wheel still stops the hands with nothing lost). From nought on the grenade is no longer a thing
   *          carried, the server has been told, and there is no putting the pin back: it leaves the hand when the
   *          button is let go, with what is left of its fuse, or goes off in it.
   *   button the button that began it is still down. Let go at any time, before the pin is out as well (a tap),
   *          or never down at all (Throw, chosen in the pockets): it is thrown the moment the pin is out.
   */
  cook: { item: ItemInstance; id: string; t: number; live: number; button: boolean } | null = null;

  // --- the wheel (hold T, see src/sim/emotes.ts)
  wheelOn = false;
  wheelAt = new THREE.Vector2();
  wheelSince = 0;
  /** what a tap of T on its own repeats, and when we last called anything out */
  lastCall = 'hey';
  calledAt = -1e9;
  /** what the body is keeping up (a dance, hands up), and until when the arms are busy with a call */
  hold: Hold | null = null;
  /** with `hold` 'dance': which of the emote pack's movements is danced (null: the body's own dance) */
  danced: string | null = null;
  armsUntil = 0;
  /** what the people near have just called out: who, the words, when */
  said = new Map<number, { text: string; at: number }>();

  // fuel drums (see src/sim/barrels.ts): the ones a blast of ours has reached and that are about
  // to go up, and, playing alone, the ones that are gone and when each is stood up again
  fuses: { i: number; t: number }[] = [];
  drumsBack: { i: number; t: number }[] = [];

  /** a change to a gun's parts that is waiting on the gun coming up into the hands */
  fitting: { gun: ItemInstance; run: () => void; t: number } | null = null;

  // ------------------------------------------------------------ magazines

  /** seconds a round takes to push into a magazine */
  // (0.42 s to 2026-10-11, when it was asked for slower: "the loading animation and time should be slower"; 0.85 s
  // from then to 2026-10-13, when it was asked for a quarter faster: "can we speed up the loading animation by 25%
  // from its current value for loading a magazine". The hands' movement is played over this time, so it is as much
  // faster. Thirty rounds are 20 s, where they were 25.)
  static readonly ROUND_IN = 0.68;
  /** seconds to thumb one round out of a magazine (quicker than pushing one in) */
  static readonly ROUND_OUT = 0.55;
  /**
   * What holding the button does with a magazine in the hands: rounds into it, or rounds out of it. The wheel
   * turns it over (as it turns over what a thing does in DayZ); on a phone, the button that changes weapons does.
   * Null: as it comes, which is whichever of the two can be done (filling, if both can).
   */
  magMode: 'fill' | 'empty' | null = null;

  slowT = 1;
  hasCompass = false;

  /** how far down the blood has been said to be: 0 not said, 1 the colour going, 2 the head swimming */
  bloodSaid = 0;

  /** seconds to the next catch of the breath over an open wound */
  winceT = 0;

  dripT = 0;
  /** the last hit taken: which way it was travelling, and when */
  lastHit: { x: number; z: number; at: number } | null = null;
}

// The methods that live in game/ (see each file there): TypeScript is told of them here, and they are put back on
// the class as it had them, not enumerable. (Cut out on 2026-10-14 so that game.ts can be read in pieces.)
type Methods<T> = { [K in keyof T]: T[K] extends (this: Game, ...a: infer A) => infer R ? (...a: A) => R : never };
export interface Game {
  join: Methods<typeof enterMethods>['join'];
  toArena: Methods<typeof enterMethods>['toArena'];
  dress: Methods<typeof enterMethods>['dress'];
  onRange: Methods<typeof enterMethods>['onRange'];
  enterOffline: Methods<typeof enterMethods>['enterOffline'];
  fillCrate: Methods<typeof enterMethods>['fillCrate'];
  fresh: Methods<typeof enterMethods>['fresh'];
  spawnAtEdge: Methods<typeof enterMethods>['spawnAtEdge'];
  freshKit: Methods<typeof enterMethods>['freshKit'];
  kitUp: Methods<typeof enterMethods>['kitUp'];
  trashed: Methods<typeof enterMethods>['trashed'];
  refilled: Methods<typeof enterMethods>['refilled'];
  carryPowers: Methods<typeof enterMethods>['carryPowers'];
  emptyHold: Methods<typeof enterMethods>['emptyHold'];
  makeTag: Methods<typeof enterMethods>['makeTag'];
  ensureTag: Methods<typeof enterMethods>['ensureTag'];
  tagWhenDue: Methods<typeof enterMethods>['tagWhenDue'];
  tickZone: Methods<typeof enterMethods>['tickZone'];
  voidTags: Methods<typeof enterMethods>['voidTags'];
  tickTags: Methods<typeof enterMethods>['tickTags'];
  restore: Methods<typeof enterMethods>['restore'];
  save: Methods<typeof enterMethods>['save'];
  enterOnline: Methods<typeof onlineMethods>['enterOnline'];
  wireNet: Methods<typeof onlineMethods>['wireNet'];
  around: Methods<typeof onlineMethods>['around'];
  openLying: Methods<typeof onlineMethods>['openLying'];
  closeLying: Methods<typeof onlineMethods>['closeLying'];
  syncLying: Methods<typeof onlineMethods>['syncLying'];
  bumpDummies: Methods<typeof onlineMethods>['bumpDummies'];
  updateOnline: Methods<typeof onlineMethods>['updateOnline'];
  addRemote: Methods<typeof onlineMethods>['addRemote'];
  act: Methods<typeof onlineMethods>['act'];
  wear: Methods<typeof onlineMethods>['wear'];
  syncBack: Methods<typeof onlineMethods>['syncBack'];
  syncGear: Methods<typeof onlineMethods>['syncGear'];
  drawHeads: Methods<typeof onlineMethods>['drawHeads'];
  portrait: Methods<typeof onlineMethods>['portrait'];
  addRemoteStash: Methods<typeof onlineMethods>['addRemoteStash'];
  addCorpse: Methods<typeof onlineMethods>['addCorpse'];
  removeCorpse: Methods<typeof onlineMethods>['removeCorpse'];
  findBox: Methods<typeof onlineMethods>['findBox'];
  addDrop: Methods<typeof dropsMethods>['addDrop'];
  layWreck: Methods<typeof dropsMethods>['layWreck'];
  removeDrop: Methods<typeof dropsMethods>['removeDrop'];
  tickDrops: Methods<typeof dropsMethods>['tickDrops'];
  takeHit: Methods<typeof dropsMethods>['takeHit'];
  sendState: Methods<typeof dropsMethods>['sendState'];
  lootPlaced: Methods<typeof dropsMethods>['lootPlaced'];
  syncOpenBox: Methods<typeof dropsMethods>['syncOpenBox'];
  spawnDummies: Methods<typeof dropsMethods>['spawnDummies'];
  onGuarded: Methods<typeof dropsMethods>['onGuarded'];
  onHit: Methods<typeof dropsMethods>['onHit'];
  nextWeapon: Methods<typeof dropsMethods>['nextWeapon'];
  resume: Methods<typeof dropsMethods>['resume'];
  unpause: Methods<typeof dropsMethods>['unpause'];
  pause: Methods<typeof dropsMethods>['pause'];
  respawn: Methods<typeof dropsMethods>['respawn'];
  applyGraphics: Methods<typeof dropsMethods>['applyGraphics'];
  lightStep: Methods<typeof dropsMethods>['lightStep'];
  hourNow: Methods<typeof dropsMethods>['hourNow'];
  menuCamera: Methods<typeof dropsMethods>['menuCamera'];
  afterBoot: Methods<typeof dropsMethods>['afterBoot'];
  start: Methods<typeof dropsMethods>['start'];
  takeWorldItem: Methods<typeof handsMethods>['takeWorldItem'];
  dropItem: Methods<typeof handsMethods>['dropItem'];
  inventoryChanged: Methods<typeof handsMethods>['inventoryChanged'];
  assignHot: Methods<typeof handsMethods>['assignHot'];
  autoHot: Methods<typeof handsMethods>['autoHot'];
  unbury: Methods<typeof handsMethods>['unbury'];
  seenByInfected: Methods<typeof handsMethods>['seenByInfected'];
  feedMap: Methods<typeof handsMethods>['feedMap'];
  mapPerson: Methods<typeof handsMethods>['mapPerson'];
  setTint: Methods<typeof handsMethods>['setTint'];
  order: Methods<typeof handsMethods>['order'];
  adminSelf: Methods<typeof handsMethods>['adminSelf'];
  showPowers: Methods<typeof handsMethods>['showPowers'];
  toggleAdmin: Methods<typeof handsMethods>['toggleAdmin'];
  toggleEmotes: Methods<typeof handsMethods>['toggleEmotes'];
  toggleFreecam: Methods<typeof handsMethods>['toggleFreecam'];
  deleteLooked: Methods<typeof handsMethods>['deleteLooked'];
  adminLook: Methods<typeof handsMethods>['adminLook'];
  watch: Methods<typeof handsMethods>['watch'];
  drawNames: Methods<typeof handsMethods>['drawNames'];
  flyCamera: Methods<typeof handsMethods>['flyCamera'];
  hot: Methods<typeof handsMethods>['hot'];
  hotStep: Methods<typeof handsMethods>['hotStep'];
  emptyHands: Methods<typeof handsMethods>['emptyHands'];
  stow: Methods<typeof handsMethods>['stow'];
  takeUp: Methods<typeof handsMethods>['takeUp'];
  poseOf: Methods<typeof handsMethods>['poseOf'];
  countOf: Methods<typeof handsMethods>['countOf'];
  handFire: Methods<typeof handsMethods>['handFire'];
  wellHere: Methods<typeof handsMethods>['wellHere'];
  waterHere: Methods<typeof handsMethods>['waterHere'];
  waterNear: Methods<typeof handsMethods>['waterNear'];
  swipeCard: Methods<typeof handsMethods>['swipeCard'];
  rest: Methods<typeof handsMethods>['rest'];
  pourFuel: Methods<typeof handsMethods>['pourFuel'];
  fillBottle: Methods<typeof handsMethods>['fillBottle'];
  startUse: Methods<typeof itemsMethods>['startUse'];
  bottles: Methods<typeof itemsMethods>['bottles'];
  drinkAt: Methods<typeof itemsMethods>['drinkAt'];
  lightFire: Methods<typeof itemsMethods>['lightFire'];
  consume: Methods<typeof itemsMethods>['consume'];
  onGround: Methods<typeof itemsMethods>['onGround'];
  settle: Methods<typeof itemsMethods>['settle'];
  mine: Methods<typeof itemsMethods>['mine'];
  release: Methods<typeof itemsMethods>['release'];
  putAway: Methods<typeof itemsMethods>['putAway'];
  breakOff: Methods<typeof itemsMethods>['breakOff'];
  useItem: Methods<typeof itemsMethods>['useItem'];
  pullPin: Methods<typeof itemsMethods>['pullPin'];
  cooking: Methods<typeof itemsMethods>['cooking'];
  cookShown: Methods<typeof itemsMethods>['cookShown'];
  emptyOfGrenade: Methods<typeof itemsMethods>['emptyOfGrenade'];
  lagPx: Methods<typeof itemsMethods>['lagPx'];
  emote: Methods<typeof itemsMethods>['emote'];
  setHold: Methods<typeof itemsMethods>['setHold'];
  updateWheel: Methods<typeof itemsMethods>['updateWheel'];
  updateSaid: Methods<typeof itemsMethods>['updateSaid'];
  blowBarrel: Methods<typeof itemsMethods>['blowBarrel'];
  updateBarrels: Methods<typeof itemsMethods>['updateBarrels'];
  explode: Methods<typeof itemsMethods>['explode'];
  openBox: Methods<typeof itemsMethods>['openBox'];
  unloadWeapon: Methods<typeof itemsMethods>['unloadWeapon'];
  attachTargets: Methods<typeof gunsMethods>['attachTargets'];
  gunInHands: Methods<typeof gunsMethods>['gunInHands'];
  attachMod: Methods<typeof gunsMethods>['attachMod'];
  pluck: Methods<typeof gunsMethods>['pluck'];
  detachMod: Methods<typeof gunsMethods>['detachMod'];
  handActs: Methods<typeof gunsMethods>['handActs'];
  magWork: Methods<typeof gunsMethods>['magWork'];
  turnMagWork: Methods<typeof gunsMethods>['turnMagWork'];
  unloadMagazine: Methods<typeof gunsMethods>['unloadMagazine'];
  fillMagazine: Methods<typeof gunsMethods>['fillMagazine'];
  fillAllMagazines: Methods<typeof gunsMethods>['fillAllMagazines'];
  emptyMagazine: Methods<typeof gunsMethods>['emptyMagazine'];
  newStash: Methods<typeof gunsMethods>['newStash'];
  dig: Methods<typeof gunsMethods>['dig'];
  stashItem: Methods<typeof gunsMethods>['stashItem'];
  nearbyStash: Methods<typeof gunsMethods>['nearbyStash'];
  markDrops: Methods<typeof gunsMethods>['markDrops'];
  openSky: Methods<typeof gunsMethods>['openSky'];
  callDrop: Methods<typeof gunsMethods>['callDrop'];
  flightBegun: Methods<typeof gunsMethods>['flightBegun'];
  dropLanded: Methods<typeof gunsMethods>['dropLanded'];
  jobBook: Methods<typeof gunsMethods>['jobBook'];
  keepBook: Methods<typeof gunsMethods>['keepBook'];
  setCredit: Methods<typeof gunsMethods>['setCredit'];
  openShop: Methods<typeof gunsMethods>['openShop'];
  toggleMap: Methods<typeof gunsMethods>['toggleMap'];
  toggleInventory: Methods<typeof gunsMethods>['toggleInventory'];
  updateInteraction: Methods<typeof interactMethods>['updateInteraction'];
  nearestLoose: Methods<typeof interactMethods>['nearestLoose'];
  dropInHands: Methods<typeof interactMethods>['dropInHands'];
  tickCrates: Methods<typeof interactMethods>['tickCrates'];
  hotbar: Methods<typeof interactMethods>['hotbar'];
  takeVitals: Methods<typeof interactMethods>['takeVitals'];
  sayBlood: Methods<typeof interactMethods>['sayBlood'];
  bloodHint: Methods<typeof interactMethods>['bloodHint'];
  wince: Methods<typeof interactMethods>['wince'];
  bleedHint: Methods<typeof interactMethods>['bleedHint'];
  syncHeld: Methods<typeof interactMethods>['syncHeld'];
  frame: Methods<typeof frameMethods>['frame'];
}
for (const part of [enterMethods, onlineMethods, dropsMethods, handsMethods, itemsMethods, gunsMethods, interactMethods, frameMethods]) {
  for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(part))) Object.defineProperty(Game.prototype, name, { ...d, enumerable: false });
}
