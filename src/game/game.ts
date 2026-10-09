// The game: owns every system, runs the frame loop, and decides who is in charge of
// what. Offline, this browser runs the whole world (loot economy, crates, save file).
// Online, the server does, and this file mirrors it and reports what the player does.

import * as THREE from 'three';
import type { Renderer } from '../core/renderer';
import { physics, USE_GROUPS, SHOT_GROUPS, SOLID_GROUPS, SIGHT_GROUPS } from '../core/physics';
import { audio } from '../core/audio';
import { Input, NULL_INPUT } from '../core/input';
import type { Atmosphere } from '../world/atmosphere';
import type { Terrain } from '../world/terrain';
import { Barrel, type Vegetation } from '../world/vegetation';
import type { Grass } from '../world/grass';
import { Door, type Buildings } from '../world/buildings';
import { PLAY_RADIUS, heightAt, type World } from '../world/worldgen';
import { ITEMS, itemName, TAG_HOLD, TAG_HOLD_MIN, capacityOf, hasMod, makeItem, newUid, tagClock, tagOwner, type ItemInstance, type Slot } from '../sim/items';
import { PlayerInventory, SLOT_ORDER, type Container } from '../sim/inventory';
import { Economy, type WorldLoot } from '../sim/economy';
import { CRATE_RESTOCK, CRATE_SPECS, fillCrate } from '../sim/crates';
import { WEAPON_RULES } from '../sim/combat';
import { BARREL } from '../sim/barrels';
import { EMOTE, EMOTES, EMOTE_GAP, SAY_RANGE, SAY_TIME, voiceOf } from '../sim/emotes';
import { loadSave, writeSave, type SaveData } from '../sim/save';
import { Net, playerName, publicId, remoteServer, serverStatus, setPlayerName } from '../net/client';
import { F_AIM, F_BLEED, F_CROUCH, F_DANCE, F_DEAD, F_GROUND, F_LEAN_L, F_LEAN_R, F_SEAT, F_SPRINT, F_SURRENDER, MAX_STAMINA, crateId, type Act, type CorpseInfo, type PlayerInfo, type Pose, type S2C, type StashInfo } from '../net/protocol';
import { Player } from './player';
import { Avatar, AVATAR_LAYER, DEATH_REST, FP_BODY_LAYER, GEAR_SHOWN, type Hold } from './avatar';
import { lookFor } from './look';
import { roadLift } from '../world/road';
import { Dummy } from './character';
import { CorpseBody, RemotePlayer } from './remote';
import { CameraDirector } from './camera';
import { Effects } from './effects';
import { INJECT, Weapons, type HitInfo, type UseKind } from './weapons';
import { LootManager, Stash, WorldItem } from './loot';
import { Grenades } from './grenades';
import { Garage } from './garage';
import { Jeep } from './vehicle';
import { JEEP } from '../sim/vehicles';
import { HUD, type HotbarEntry } from '../ui/hud';
import { InventoryUI } from '../ui/inventory-ui';
import { Minimap } from '../ui/minimap';
import { DROP, describeSpot, fillDrop, pickDropSite, type DropInfo } from '../sim/drops';
import { renderDoll, renderIcons } from '../ui/icons';
import { Perf } from '../core/perf';
import { loadGraphics, type Graphics } from '../core/settings';
import { Horde, Infected } from './infected';
import { INFECTED } from '../sim/infected';
import { TOUCH } from '../core/device';
import { TouchControls } from '../ui/touch';
import { REWARDS_UI, RewardsModal, addCashedTag, cashedTags, walletAddress } from '../ui/rewards';

export interface WorldSystems {
  r: Renderer;
  world: World;
  atmo: Atmosphere;
  terrain: Terrain;
  veg: Vegetation;
  grass: Grass;
  buildings: Buildings;
}

interface TimedAction {
  label: string;
  t: number;
  dur: number;
  sound: 'eat' | 'drink' | 'bandage' | 'inject' | 'smoke' | null;
  soundT: number;
  done: () => void;
}

/** bump when the map's loot points change: spawned loot from older saves is re-rolled */
const LOOT_REV = 9;
const QUICK_KEYS = ['Digit5', 'Digit6', 'Digit7', 'Digit8'];
/** what can be held, in the order of the keys 1 to 4 */
const HAND_SLOTS = ['primary', 'secondary', 'holster', 'melee'] as const;
/** the wheel: how far the mouse travels from its middle to its rim (pixels), and how far out an entry is picked */
const WHEEL_REACH = 120, WHEEL_PICK = 0.35;
const SEND_HZ = 15;
const _drip = new THREE.Vector3();
const _still = new THREE.Vector3();

export class Game {
  input: Input;
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
  economy!: Economy;
  hud!: HUD;
  minimap!: Minimap;
  invUI!: InventoryUI;
  dummies: Dummy[] = [];
  /** the infected (src/game/infected.ts) */
  readonly horde: Horde = new Horde({
    atmo: () => this.s.atmo,
    scene: () => this.s.r.scene,
    world: () => this.s.world,
    me: () => ({ id: this.net.id || 1, pos: this.player.pos, crouched: this.player.crouched, speed: Math.hypot(this.player.vel.x, this.player.vel.z), alive: this.started && !this.player.dead, seated: !!this.garage.ride }),
    others: () => this.remotes.values(),
    online: () => this.online,
    send: (m) => this.net.send(m),
    struck: (amount, from) => {
      const p = this.player.pos;
      const len = Math.max(0.001, Math.hypot(p.x - from.x, p.z - from.z));
      this.takeHit({ t: 'dmg', from: 0, amount, zone: 'torso', w: 'infected', dir: [(p.x - from.x) / len, 0, (p.z - from.z) / len] });
    },
    killed: (zone, distance) => {
      this.weapons.confirmKill();
      this.hud.note(`Infected down${zone === 'head' ? ' · headshot' : ''}${distance > 8 ? ` · ${Math.round(distance)} m` : ''}`, 'good');
    },
  });
  remotes = new Map<number, RemotePlayer>();
  /** item ids on the quick-use keys 5-8 */
  quick: (string | null)[] = [null, null, null, null];
  private corpses = new Map<string, { stash: Stash; body: CorpseBody }>();
  private last = performance.now();
  private fpsAcc = 0;
  private fpsN = 0;
  fps = 0;
  private started = false;
  private joining = false;
  private use: TimedAction | null = null;
  private saveT = 0;
  private econT = 0;
  private poi: string | null = null;
  private prompt: string | null = null;
  /** where on screen the thing the prompt is about sits (fractions of the screen) */
  private mark: [number, number] | null = null;
  /**
   * Supply drops standing in the world (see src/sim/drops.ts): the crate, when it is due to
   * be cleared away (performance clock, ms), and its column of smoke.
   */
  private drops = new Map<string, { stash: Stash; until: number; at: THREE.Vector3; smoke: { owed: number } }>();
  /** playing alone: game time the next one is due (-1 until the clock is first read) */
  private nextDrop = -1;
  /** the page's own title: the tab shows the place in the line, and "your turn", over it */
  private title = document.title;
  /** times at which the open inventory should look again at what lies on the ground (see drop) */
  private vicinityDue: number[] = [];
  /** the pockets were closed but the mouse is not the game's yet: one click and it is */
  private awaitClick = false;
  /** seconds G has been held (drop what is in the hands), and whether that press has done its work */
  private dropHeld = 0;
  private dropDone = false;
  private focus: unknown = null;
  private openStash: Stash | null = null;
  private indoors = false;
  private inForest = false;
  private deathInfo = '';
  private deathSent = false;
  private warned = { hunger: false, thirst: false };
  private heldKey = '';
  // --- multiplayer bookkeeping
  private sendT = 0;
  private meT = 0;
  private meDirty = false;
  private pendingTakes = new Map<string, { item: ItemInstance; id: string; qty: number }>();
  private localDrops = new Set<string>();

  perf: Perf;
  /** graphics options the player picked in the Esc menu */
  gfx: Graphics = loadGraphics();
  private tagT = 0;
  /** when the player last got into a jeep (the keys are shown for a few seconds) */
  private rideAt = -1e9;
  /** phones and tablets: on-screen stick and buttons */
  private touch: TouchControls | null = null;
  /** on a phone: the player put the weapon away themselves, so nothing is drawn for them until they pick one */
  private handsFree = false;
  /** opens the rewards modal once the entrance has played */
  private entryModal: () => void = () => {};
  private slowFor = 0;
  private slowHinted = false;

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
    progress('loading loot');
    this.loot = new LootManager(r.scene, atmo, buildings.lootPoints);
    await this.loot.preload();
    this.loot.onPlaced = (l) => this.lootPlaced(l);
    this.grenades = new Grenades(r.scene, this.loot.models);
    await this.grenades.preload();
    this.grenades.onExplode = (at, mine) => this.explode(at, mine);
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
    this.loot.lift = (x, z) => roadLift(world, x, z);
    this.applyGraphics(this.gfx);
    this.economy = new Economy(buildings.lootPoints, {
      spawn: (l) => this.loot.spawn(l),
      despawn: (l) => this.loot.despawn(l),
    });
    // crates standing around the map become searchable containers
    for (const c of veg.crates) {
      const spec = CRATE_SPECS[c.kind];
      if (!spec) continue;
      const st = new Stash(crateId(c.x, c.z), c.x, c.y, c.z, c.rot, spec.w, spec.h, spec.label);
      st.kind = c.kind;
      st.adopt(c.collider);
      this.loot.crates.push(st);
    }

    progress('loading weapons');
    this.weapons = new Weapons(r.vmScene, r.vmCamera, atmo, this.player, this.inv, this.effects);
    await this.weapons.load();
    this.weapons.mainCam = r.camera;
    this.weapons.itemModels = this.loot.models;
    this.weapons.onSlungChange = (obj) => this.avatar.setSlung(obj);
    this.weapons.setLook(lookFor(playerName()));
    this.weapons.resolveTarget = (owner) => (owner instanceof Dummy || owner instanceof RemotePlayer || owner instanceof Infected ? owner : null);
    this.weapons.onHit = (h) => this.onHit(h);
    // whoever is hit carries the blood on their clothes where it landed
    this.weapons.onFlesh = (owner, pt, dir, power) => {
      if (power < 0.4) return;
      const body = owner instanceof RemotePlayer || owner instanceof Dummy || owner instanceof Infected ? owner.avatar : owner === this.player ? this.avatar : null;
      body?.wound(pt, dir, 0.05 + power * 0.04, power > 0.58);
    };
    this.weapons.onShot = (s) => {
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
    // a punch or a swing: your own body throws it, and everyone near you sees it
    this.weapons.onSwing = () => {
      this.avatar.swing();
      this.net.send({ t: 'swing' });
    };
    progress('compiling shaders');
    this.weapons.precompile((scene, camera) => r.precompile(scene, camera));
    // every loot model's material, so entering a house never compiles mid-game
    const warm = new THREE.Group();
    for (const id of Object.keys(ITEMS)) {
      warm.add((await this.loot.models.get(id)).group.clone());
      // and every weapon as it looks in somebody's hands: the first armed player to walk
      // into view must not cost a frame
      const held = this.weapons.worldModel(id);
      if (held) warm.add(held);
    }
    warm.position.copy(r.camera.position);
    r.scene.add(warm);
    r.precompile(r.scene, r.camera);
    r.scene.remove(warm);
    progress('rendering icons');
    const icons = await renderIcons(r.renderer, this.loot.models, atmo.envMap);
    const doll = await renderDoll(r.renderer, atmo.envMap, lookFor(playerName()));

    this.hud = new HUD(icons);
    this.hud.setName(playerName());
    this.minimap = new Minimap(world);
    this.hud.root.insertBefore(this.minimap.root, this.hud.root.firstChild);
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
      place: (item) => this.placeStash(item),
      attachTargets: (att) => this.attachTargets(att),
      attach: (att, weapon) => this.attachMod(att, weapon),
      detach: (weapon, mod) => this.detachMod(weapon, mod),
      assignQuick: (item, i) => this.assignQuick(i, item.id),
      quickIndex: (id) => this.quick.indexOf(id),
      changed: () => this.inventoryChanged(),
      sound: (k) => audio.ui(k),
    });
    this.invUI.icons = icons;
    this.invUI.doll = doll;
    this.invUI.selfId = publicId();

    // one physics step so placement queries see every collider
    physics.step(physics.fixedDt);
    // somewhere to stand while the start screen is up
    const sp = world.spawn;
    this.player.spawn(sp.x, heightAt(world.heights, sp.x, sp.z) + 0.05, sp.z, sp.yaw);

    this.player.onLand = (speed) => this.weapons.landed(speed);
    this.player.onDamage = (amt, cause) => {
      if (cause === 'fall' && amt > 5) this.hud.note('You hurt yourself in the fall', 'warn');
    };
    this.player.onClot = () => {
      this.hud.note('The bleeding has stopped on its own', 'good');
      this.meDirty = true;
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
        swap: () => inPlay() && this.nextWeapon(),
        emote: (id) => inPlay() && this.emote(id),
        chat: () => {
          if (!inPlay() || this.invUI.isOpen || this.hud.chatOpen) return;
          this.input.releaseAll();
          this.hud.openChat();
        },
      });
      // a tap on the map makes it big, another puts it back (M on a keyboard)
      this.minimap.root.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (inPlay() && !this.invUI.isOpen) this.minimap.toggle();
      });
    }
    // Tapping (or clicking) a hotbar slot is the same as pressing its number. On a phone a tap
    // on the weapon that is already in the hands puts it away (X on a keyboard), and that is
    // remembered: empty hands that were asked for are left empty (see the frame loop).
    this.hud.onHotbar((key) => {
      const slot = HAND_SLOTS[Number(key) - 1];
      if (this.touch && slot) {
        const mine = this.inv.active === slot;
        this.handsFree = mine;
        if (mine) return this.weapons.equip(null);
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
    // dog tags and creator rewards: explained on entering the site, and again from the menu
    if (REWARDS_UI) {
      const modal = new RewardsModal(document.getElementById('ui')!, () => this.hud.nameValue());
      this.hud.onRewards(() => modal.open());
      this.entryModal = () => modal.openAtEntry();
    }
    // the briefing map is drawn from the world itself
    const town = world.pois[0];
    const station = world.buildings.find((b) => b.type === 'police');
    this.hud.setBriefing({
      radius: PLAY_RADIUS,
      spawns: world.spawns,
      centre: town,
      places: [
        { name: town.name, x: town.x, z: town.z, kind: 'town' },
        ...(station ? [{ name: 'Police station', x: station.x, z: station.z, kind: 'police' as const }] : []),
        ...world.pois.slice(1).map((q) => ({ name: q.name, x: q.x, z: q.z, kind: world.sites.some((st) => st.name === q.name) ? ('site' as const) : ('post' as const) })),
      ],
    });
    this.hud.showStart(true);
    // FPS mouse: play only while the mouse is captured. Esc releases it -> pause menu;
    // clicking the menu captures it again and play resumes.
    this.input.onLockChange = (locked) => {
      if (locked) {
        if (this.started) this.unpause();
      } else if (!this.invUI.isOpen && !this.player.dead && this.started) this.pause();
    };
    window.addEventListener('beforeunload', () => this.save());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.invUI?.isOpen) this.toggleInventory(false, true);
      // a second Escape, with the mouse still free, is the menu
      else if (this.awaitClick) {
        this.awaitClick = false;
        if (this.started && !this.player.dead) this.pause();
      }
    });
    this.director.update(0.016);
  }

  // ------------------------------------------------------------ entering the world

  /** First click on Play: find a server (multiplayer) or fall back to the local world. */
  private async join() {
    this.joining = true;
    const name = this.hud.nameValue() || `Survivor${Math.floor(100 + Math.random() * 900)}`;
    const renamed = name !== playerName();
    setPlayerName(name);
    this.dress(name, renamed);
    this.hud.showStart(true, false, 'Connecting…');
    // A full server puts us in line. The wait can be long: the mouse goes back to the player,
    // the screen says where they stand, and they can give it up and play on their own.
    let waited = false;
    this.net.onQueue = (pos, of, max) => {
      if (!waited) {
        waited = true;
        this.input.unlock();
      }
      this.hud.showStart(true, false, 'In line');
      this.hud.setQueue({ pos, of, max }, () => this.net.leaveQueue());
      document.title = `(${pos}) in line · ${this.title}`;
    };
    const welcome = await this.net.connect(name, (text) => this.hud.showStart(true, false, text));
    this.hud.setQueue(null);
    document.title = this.title;
    if (welcome) {
      await this.enterOnline(welcome);
      if (waited) {
        // their turn, quite possibly while they were looking at something else
        audio.ui('open');
        document.title = `Your turn! · ${this.title}`;
        this.hud.note('A place came free: you are in', 'good');
      }
    } else {
      if (this.net.leftQueue) this.hud.note('You left the line: playing on your own', 'warn');
      else if (this.net.refused) this.hud.note(this.net.refused, 'warn');
      else if (remoteServer()) this.hud.note('The server could not be reached: playing offline', 'warn');
      await this.enterOffline();
    }
    this.joining = false;
    this.started = true;
    // out of the aerial shot and down into the character's eyes
    this.director.flyIn();
    if (!this.weapons.equippedItem) {
      const slot = (['primary', 'secondary', 'holster'] as const).find((k) => this.inv.slots[k]);
      if (slot) this.weapons.equip(slot);
    }
    if (this.input.locked) this.unpause();
    else this.hud.showStart(true, true, waited && welcome ? 'You are in: click to play' : '');
  }

  /** What this player looks like follows from their name: body, first-person sleeves, inventory portrait. */
  private dress(name: string, portrait: boolean) {
    const look = lookFor(name);
    this.avatar.setLook(look);
    this.weapons.setLook(look);
    if (portrait) this.portrait();
  }

  private async enterOffline() {
    const save = loadSave();
    if (save) await this.restore(save);
    else this.fresh();
    await this.spawnDummies();
    this.garage.startAlone();
    this.horde.alone();
    this.hud.setNet('Offline · single player');
    this.hud.setOnline(null);
  }

  private fresh() {
    this.spawnAtEdge();
    this.economy.populate();
    for (const c of this.loot.crates) fillCrate(c.container, c.kind);
    this.freshKit();
  }

  private spawnAtEdge() {
    const { world } = this.s;
    const sp = world.spawns[Math.floor(Math.random() * world.spawns.length)] ?? world.spawn;
    this.player.spawn(sp.x, heightAt(world.heights, sp.x, sp.z) + 0.05, sp.z, sp.yaw);
  }

  /** A new life: bare hands, one thing to eat and one thing to drink. Everything else is out there. */
  private freshKit() {
    this.inv.clear();
    this.quick = [null, null, null, null];
    const pick = (ids: string[]) => ids[Math.floor(Math.random() * ids.length)];
    this.inv.add(makeItem(pick(['sprats', 'beans', 'sardines', 'tomatoes'])));
    this.inv.add(makeItem(pick(['thermos', 'milk'])));
    // one dressing: the first wound is survivable, the second is yours to deal with
    this.inv.add(makeItem('bandage'));
    this.inv.neck = this.makeTag();
    this.player.vitals = { health: 100, energy: 80, water: 80, stamina: MAX_STAMINA, bleeding: false };
    this.avatar.clearWounds();
    this.weapons.validate();
    this.refreshQuick();
  }

  /** Every survivor wears a dog tag stamped with their own name, round their neck (see PlayerInventory.neck). */
  private makeTag(): ItemInstance {
    const it = makeItem('dogtag');
    it.owner = playerName() || 'Survivor';
    it.pid = publicId();
    return it;
  }

  /** characters from before dog tags existed get theirs now */
  private ensureTag() {
    const me = publicId();
    // (and from before tags had places of their own: the one in the pocket goes round the neck, the taken ones into the pouch)
    this.inv.sortTags((tag) => tag.pid === me);
    this.inv.neck ??= this.makeTag();
  }

  /**
   * Somebody else's tag in your pockets counts up while you are alive. After TAG_HOLD
   * seconds it is cashed in and leaves the inventory. The clock belongs to whoever is
   * carrying the tag: when it changes hands it starts again.
   */
  private tickTags(dt: number) {
    const me = publicId();
    const done: ItemInstance[] = [];
    const carried: { name: string; clock: string }[] = [];
    this.inv.find((it) => {
      if (it.id !== 'dogtag' || it.pid === me) return false;
      if (it.holder !== me) {
        it.holder = me;
        it.held = 0;
        this.meDirty = true;
        this.hud.note(`${tagOwner(it)}'s dog tag: stay alive for ${TAG_HOLD_MIN} minutes to cash it in`, 'good');
      }
      it.held = (it.held ?? 0) + dt;
      if (it.held >= TAG_HOLD) done.push(it);
      else carried.push({ name: tagOwner(it), clock: tagClock(it) });
      return false;
    });
    // the countdown is on screen the whole time, and on the tag itself in the inventory
    this.hud.setTags(carried);
    if (this.invUI.isOpen) this.invUI.tickTags();
    if (!done.length) return;
    for (const it of done) {
      this.inv.remove(it);
      const n = addCashedTag();
      const owner = tagOwner(it);
      this.hud.note(`Dog tag cashed in: ${owner}`, 'good');
      // online the server checks the tag and announces it to everyone; a payout would be issued there
      // the address goes with it: the tag is listed for a reward under it
      if (this.online) {
        const wallet = walletAddress();
        this.net.send({ t: 'cash', uid: it.uid, ...(wallet ? { wallet } : {}) });
        if (!wallet && REWARDS_UI) this.hud.note('No wallet address saved: add one under Rewards in the menu', 'warn');
      }
      else {
        this.hud.chatLine('system', '', `${playerName() || 'You'} cashed in ${owner}'s dog tag.`);
        this.hud.chatLine('system', '', `That is ${n} cashed in so far.`);
      }
    }
    audio.ui('pickup');
    this.inventoryChanged();
    if (this.invUI.isOpen) this.invUI.refresh(this.around(), this.openStash);
  }

  private async restore(save: SaveData) {
    const e = save.economy;
    const sameMap = e.rev === LOOT_REV;
    this.economy.time = e.time;
    this.economy.lastRestock = sameMap ? e.lastRestock : {};
    this.economy.restore(e.loot, sameMap);
    if (!sameMap) this.economy.populate();
    for (const sd of save.stashes) {
      const st = new Stash(sd.uid, sd.x, sd.y, sd.z, sd.rot);
      st.container.load(sd.container as never);
      await this.loot.addStash(st);
    }
    const saved = new Map((save.crates ?? []).map((c) => [c.uid, c]));
    for (const c of this.loot.crates) {
      const sc = saved.get(c.uid);
      if (sc) {
        c.container.load(sc.container as never);
        c.emptiedAt = sc.emptiedAt;
      } else fillCrate(c.container, c.kind);
    }
    const p = save.player;
    if (p && sameMap) {
      this.player.spawn(p.x, p.y + 0.05, p.z, p.yaw);
      Object.assign(this.player.vitals, p.vitals);
      // pockets are smaller than they used to be: whatever no longer fits lands at your feet
      for (const it of this.inv.load(p.inventory)) this.dropItem(it, this.player.pos, 0.8);
      if (p.quick) this.quick = [0, 1, 2, 3].map((i) => (p.quick![i] && ITEMS[p.quick![i]!] ? p.quick![i] : null));
      this.ensureTag();
      this.refreshQuick();
      this.weapons.validate();
    } else {
      // the map changed under the old character (or they were dead): a new life on the edge
      this.spawnAtEdge();
      this.freshKit();
    }
    // top the world back up if the save is sparse
    this.economy.tick(0, [this.player.pos]);
  }

  /** Offline only: the server owns the world and your character when you play online. */
  save() {
    if (!this.economy || this.online || !this.started) return;
    const p = this.player;
    writeSave({
      version: 1,
      savedAt: Date.now(),
      player: p.dead ? null : { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, vitals: { ...p.vitals }, inventory: this.inv.serialize(), quick: this.quick },
      economy: { ...this.economy.serialize(), rev: LOOT_REV },
      stashes: this.loot.stashes.map((s) => s.serialize()),
      crates: this.loot.crates.map((c) => ({ uid: c.uid, emptiedAt: c.emptiedAt, container: c.container.serialize() })),
    });
  }

  // ------------------------------------------------------------ multiplayer

  private async enterOnline(w: Extract<S2C, { t: 'welcome' }>) {
    const { world, buildings } = this.s;
    for (const l of w.loot) this.economy.inject(l);
    for (const [i, open, swing] of w.doors) buildings.doors[i]?.setOpen(open, swing);
    for (const s of w.stashes) await this.addRemoteStash(s);
    for (const c of w.corpses) void this.addCorpse(c);
    for (const d of w.drops ?? []) void this.addDrop(d);
    // the fuel drums that are gone at the moment
    this.fuses.length = this.drumsBack.length = 0;
    for (const b of this.s.veg.barrels) b?.setThere(!w.barrels?.includes(b.i));
    for (const p of w.players) void this.addRemote(p);
    this.garage.clear();
    for (const v of w.vehicles ?? []) this.garage.add(v);
    this.garage.bind();
    this.horde.online(w.infected ?? []);
    const y = w.spawn.y ?? heightAt(world.heights, w.spawn.x, w.spawn.z);
    this.player.spawn(w.spawn.x, y + 0.05, w.spawn.z, w.spawn.yaw);
    if (w.me) {
      for (const it of this.inv.load(w.me.inv)) this.dropItem(it, this.player.pos, 0.8);
      Object.assign(this.player.vitals, w.me.vitals);
      this.ensureTag();
      this.weapons.validate();
      this.refreshQuick();
    } else this.freshKit();
    this.meDirty = true;
    // the server has not heard what we are wearing yet
    this.gearKey = '\u0000';
    this.syncGear();

    const net = this.net;
    const cam = () => this.s.r.camera;
    net.on('join', (m) => {
      void this.addRemote(m.p);
      this.updateOnline();
      this.hud.feed(`${m.p.name} joined`);
      this.hud.chatLine('system', '', `${m.p.name} joined`);
    });
    net.on('leave', (m) => {
      const r = this.remotes.get(m.id);
      if (!r) return;
      r.seat = null;
      this.hud.feed(`${r.name} left`);
      this.hud.chatLine('system', '', `${r.name} left`);
      r.dispose();
      this.remotes.delete(m.id);
      this.updateOnline();
    });
    net.on('ps', (m) => {
      const now = performance.now();
      for (const s of m.s) {
        const r = this.remotes.get(s[0]);
        if (!r) continue;
        r.push([s[1], s[2], s[3], s[4], s[5], s[6]], now);
        r.setWeapon(s[7], s[8]);
        if (!(s[6] & F_DEAD)) r.setAlive(true);
      }
    });
    net.on('i+', (m) => this.horde.add(m.b));
    net.on('i-', (m) => this.horde.remove(m.i));
    net.on('iown', (m) => this.horde.own(m.i, m.to));
    net.on('is', (m) => this.horde.states(m.s, performance.now()));
    net.on('ihp', (m) => this.horde.hp(m.i, m.dead, m.by, m.zone, m.dir));
    net.on('shot', (m) => {
      this.weapons.remoteShot(new THREE.Vector3(...m.o), new THREE.Vector3(...m.d), m.w, m.sup);
      this.horde.noise(m.o[0], m.o[2], m.sup ? INFECTED.hearQuiet : INFECTED.hearShot);
      // (nobody shoots and waves at once)
      this.remotes.get(m.id)?.avatar.emote(null);
    });
    net.on('swing', (m) => this.remotes.get(m.id)?.swing());
    net.on('nade', (m) => {
      this.grenades.throw(new THREE.Vector3(...m.o), new THREE.Vector3(...m.v), ITEMS.grenade.throw!.fuse - 0.75, false);
      // the arm that threw it
      this.remotes.get(m.id)?.avatar.swing(true);
    });
    net.on('act', (m) => this.remotes.get(m.id)?.act(m.a, m.d, cam().position));
    net.on('emote', (m) => {
      const r = this.remotes.get(m.id), e = EMOTE[m.e];
      if (!r?.alive || !e?.say) return;
      r.call(e, cam().position);
      this.said.set(m.id, { text: e.say, at: performance.now() });
    });
    net.on('boom', (m) => this.blowBarrel(m.i, false));
    net.on('barrel+', (m) => this.s.veg.barrels[m.i]?.setThere(true));
    net.on('gear', (m) => this.remotes.get(m.id) && void this.wear(this.remotes.get(m.id)!.avatar, m.g));
    net.on('dmg', (m) => this.takeHit(m));
    net.on('death', (m) => {
      const k = m.k;
      const me = k.id === net.id;
      const zone = k.zone === 'head' ? ' · headshot' : '';
      const drum = k.w === 'barrel';
      const jeep = k.w === 'jeep' || k.w === 'fire';
      const how = k.by !== null ? `${k.byName} killed ${k.name} · ${ITEMS[k.w]?.name ?? (drum ? 'fuel drum' : k.w === 'fire' ? 'burning jeep' : k.w)}${zone}${k.dist > 3 && !jeep ? ` · ${k.dist} m` : ''}` : `${k.name} died (${k.w})`;
      this.hud.feed(how, k.by === net.id || me);
      if (k.by === net.id) {
        this.weapons.confirmKill();
        this.hud.note(`You killed ${k.name}${zone}${k.dist > 3 ? ` · ${k.dist} m` : ''}`, 'good');
      }
      if (!me) this.remotes.get(k.id)?.avatar.setDeath(k.v ?? 0);
      if (me) this.deathInfo = k.by !== null ? `Killed by ${k.byName} with ${drum ? 'a fuel drum' : k.w === 'fire' ? 'a burning jeep' : jeep ? 'a jeep' : ITEMS[k.w]?.name ?? 'bare hands'}${zone}. Your body and gear are where you fell.` : `You died of ${k.w}. Your body and gear are where you fell.`;
      else this.remotes.get(k.id)?.setAlive(false);
      if (m.corpse) void this.addCorpse(m.corpse);
    });
    net.on('alive', (m) => this.remotes.get(m.id)?.setAlive(true));
    net.on('loot+', (m) => this.economy.inject(m.l));
    net.on('loot-', (m) => {
      this.economy.take(m.uid);
      if (this.invUI.isOpen) this.invUI.refresh(this.around(), this.openStash);
    });
    net.on('denied', (m) => {
      // someone got there first: hand it back
      const t = this.pendingTakes.get(m.uid);
      if (!t) return;
      this.pendingTakes.delete(m.uid);
      if (this.inv.find((i) => i === t.item)) this.inv.remove(t.item);
      else this.inv.take(t.id, t.qty);
      this.hud.note('Someone else took it first', 'warn');
      this.inventoryChanged();
      if (this.invUI.isOpen) this.invUI.render();
    });
    net.on('cdata', (m) => {
      const st = this.findBox(m.cid);
      if (!st) return;
      st.container.load({ items: m.items });
      st.known = true;
      if (this.openStash === st) this.invUI.setStashState('');
    });
    net.on('cbusy', (m) => {
      if (this.openStash?.uid !== m.cid) return;
      this.hud.note('Someone else is searching that', 'warn');
      this.openStash = null;
      if (this.invUI.isOpen) this.invUI.refresh(this.around(), null);
    });
    net.on('stash+', (m) => void this.addRemoteStash(m.s));
    net.on('stash-', (m) => {
      const st = this.loot.stashes.find((s) => s.uid === m.uid);
      if (st) this.loot.removeStash(st);
    });
    net.on('corpse-', (m) => this.removeCorpse(m.uid));
    net.on('board', (m) => this.hud.setBoard(m.rows, m.me, m.mine, playerName()));
    net.on('drop+', (m) => void this.addDrop(m.d));
    net.on('drop-', (m) => this.removeDrop(m.uid));
    net.on('door', (m) => {
      const d = buildings.doors[m.i];
      if (!d || d.open === m.open) return;
      d.set(m.open, m.swing);
      audio.door(m.open, d.pivot.position);
    });
    net.on('spawn', (m) => {
      const p = this.player;
      p.spawn(m.x, heightAt(world.heights, m.x, m.z) + 0.05, m.z, m.yaw);
      this.freshKit();
      this.deathSent = false;
      this.deathInfo = '';
      this.meDirty = true;
      this.resume();
    });
    net.on('chat', (m) => this.hud.chatLine(m.ch ?? 'global', m.from, m.text));
    // everyone carrying a tag they took, shown on the map for a few seconds
    net.on('tags', (m) => {
      const me = m.p.some(([id]) => id === net.id);
      const others = m.p.filter(([id]) => id !== net.id);
      this.minimap.ping(others.map(([, x, z]) => ({ x, z })), me);
      const now = performance.now();
      if (me && now - this.markedSaid > 300_000) {
        this.markedSaid = now;
        this.hud.note('You carry a tag you took: every 30 seconds the map shows everyone where you are', 'warn');
      } else if (others.length && now - this.pingSaid > 300_000) {
        this.pingSaid = now;
        this.hud.note('Someone is carrying a tag: they are marked on the map (M)', 'good');
      }
    });
    // what became of a tag we cashed in (paid, on its way, why not)
    net.on('tell', (m) => {
      this.hud.note(m.text, m.kind);
      this.hud.chatLine('system', '', m.text);
    });
    net.on('cashed', (m) => {
      const text = `${m.name} cashed in ${m.owner}'s dog tag.`;
      this.hud.chatLine('system', '', text);
      this.hud.feed(text, m.id === net.id);
      if (m.id === net.id) this.hud.chatLine('system', '', `That is ${cashedTags()} cashed in so far.`);
    });
    net.onClose = (reason) => {
      this.paused = true;
      this.input.unlock();
      this.hud.fatal(reason);
    };
    this.maxPlayers = w.max;
    this.hud.setNet('Online');
    this.updateOnline();
  }

  private maxPlayers = 0;
  /** carrying a tag taken off somebody (the one round their own neck does not count): no jeep takes them (see Garage.use) */
  private get tagged() {
    const me = publicId();
    return !!this.inv.find((it) => it.id === 'dogtag' && it !== this.inv.neck && it.pid !== me);
  }

  /**
   * What lies within reach on the ground, for the open pockets to show. From a jeep's seat
   * that is nothing: whatever is wanted from the ground, a body or a crate is got out for.
   */
  private around() {
    return this.garage.ride ? [] : this.loot.near(this.player.pos, 2.3);
  }
  /** the jeep the view was last behind (so going in and out of one is a move of the view, not a cut) */
  private rode: Jeep | null = null;

  /** playing alone: the training dummies a jeep driven here has just gone into */
  private bumpDummies(at: THREE.Vector3, half: THREE.Vector3, quat: THREE.Quaternion, speed: number) {
    const inv = quat.clone().invert();
    const rel = new THREE.Vector3();
    for (const d of this.dummies) {
      if (d.dead) continue;
      rel.copy(d.pos).sub(at).applyQuaternion(inv);
      if (Math.abs(rel.x) > half.x || Math.abs(rel.z) > half.z || rel.y > 0.6 || rel.y < -2.6) continue;
      const chest = new THREE.Vector3(d.pos.x, d.pos.y + 1.2, d.pos.z);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      this.effects.bleed(chest, dir, 0.8);
      if (d.damage(Math.max(0, speed - JEEP.bumpFrom) * JEEP.bumpPer, chest, dir, 'torso')) this.hud.note('Training dummy down · jeep', 'good');
    }
  }

  /** everyone connected to the server, this player included */
  private updateOnline() {
    this.hud.setOnline(this.online ? this.remotes.size + 1 : null, this.maxPlayers);
  }

  private makeHeld = (id: string | null, mods: string[]) => {
    if (!id) return null;
    const def = ITEMS[id];
    const obj = this.weapons.worldModel(id, mods);
    const grips = this.weapons.gripsOf(id);
    if (!obj || !grips) return null;
    if (def?.weapon) return { obj, grips, kind: def.weapon.kind };
    return def?.melee ? { obj, grips, kind: 'melee' as const } : null;
  };

  private async addRemote(p: PlayerInfo) {
    if (p.id === this.net.id || this.remotes.has(p.id)) return;
    const r = new RemotePlayer(p.id, p.name, this.makeHeld);
    this.remotes.set(p.id, r);
    await r.load(this.s.atmo, this.s.r.scene, p.pose);
    r.setWeapon(p.w, p.m);
    void this.wear(r.avatar, p.g ?? []);
    r.setAlive(p.alive);
    // (they may have been sitting in a jeep since before this game knew of them)
    this.garage.reseat();
  }

  /** something the hands do that shows on the body: your own, and (through the server) the copy of you everyone else sees */
  private act(a: Act, d = 1) {
    if (a === 'stop') this.avatar.act(null);
    else this.avatar.act(a, d);
    this.net.send({ t: 'act', a, d });
  }

  /** hat, vest and pack as they sit on a body */
  private async wear(body: Avatar, ids: string[]) {
    const out: { id: string; obj: THREE.Object3D }[] = [];
    for (const id of ids) {
      if (!GEAR_SHOWN.has(id)) continue;
      out.push({ id, obj: (await this.loot.models.get(id)).group.clone() });
    }
    body.setGear(out);
  }

  /** what this player wears that shows, kept in step with the inventory (and told to the server when it changes) */
  private syncGear() {
    const ids = (['head', 'vest', 'back'] as const).map((s) => this.inv.slots[s]?.id).filter((x): x is string => !!x);
    const key = ids.join(',');
    if (key === this.gearKey) return;
    this.gearKey = key;
    void this.wear(this.avatar, ids);
    this.net.send({ t: 'gear', g: ids });
    this.portrait();
  }

  /** The figure in the inventory window, drawn again as the player is now: their colours, and what they have on. */
  private portrait() {
    const { r, atmo } = this.s;
    const worn = this.gearKey && this.gearKey !== '\u0000' ? this.gearKey.split(',') : [];
    const mine = ++this.portraitN;
    void renderDoll(r.renderer, atmo.envMap, lookFor(playerName()), worn, this.loot.models).then((doll) => {
      // (a later one may have been asked for while this was drawn)
      if (mine !== this.portraitN || !this.invUI) return;
      this.invUI.doll = doll;
      this.invUI.redraw();
    });
  }
  private portraitN = 0;
  private gearKey = '';

  private async addRemoteStash(s: StashInfo) {
    if (this.loot.stashes.some((x) => x.uid === s.uid)) return;
    await this.loot.addStash(new Stash(s.uid, s.x, s.y, s.z, s.rot));
  }

  private async addCorpse(c: CorpseInfo) {
    if (this.corpses.has(c.uid)) return;
    const stash = new Stash(c.uid, c.x, c.y, c.z, c.rot, 8, 10, `${c.name}'s body`);
    stash.corpse = true;
    // the box to search is where the body lies: behind where they stood if they went over
    // backwards, ahead if they went down on their face, beside it if they folded up
    const v = c.v ?? 0;
    const [ahead, left] = DEATH_REST[v] ?? DEATH_REST[0];
    if (v === 2) stash.trigger(0.6, 0.25, 0.6, -ahead, left);
    else stash.trigger(0.48, 0.25, 0.85, -ahead * 0.56, left);
    const body = new CorpseBody();
    this.corpses.set(c.uid, { stash, body });
    // let the fall animation of the player finish before the body appears
    await new Promise((r) => setTimeout(r, 1800));
    if (!this.corpses.has(c.uid)) return;
    await body.load(this.s.atmo, this.s.r.scene, c.x, c.y, c.z, c.rot, c.name, v);
    // and what has run out of it by then
    this.effects.pool(c.x - Math.sin(c.rot) * ahead * 0.75 - Math.cos(c.rot) * left, c.y, c.z - Math.cos(c.rot) * ahead * 0.75 + Math.sin(c.rot) * left);
  }

  private removeCorpse(uid: string) {
    const c = this.corpses.get(uid);
    if (!c) return;
    if (this.openStash === c.stash) this.toggleInventory(false);
    physics.tags.delete(c.stash.collider.handle);
    physics.world.removeCollider(c.stash.collider, false);
    c.body.dispose();
    this.corpses.delete(uid);
  }

  /** any server-held container by id: map crate, stash or body */
  private findBox(cid: string): Stash | undefined {
    return this.loot.crates.find((c) => c.uid === cid) ?? this.loot.stashes.find((c) => c.uid === cid) ?? this.corpses.get(cid)?.stash ?? this.drops.get(cid)?.stash;
  }

  // ------------------------------------------------------------ supply drops

  /**
   * A supply drop has been set down: the crate, the smoke over it, the mark on the map, and
   * word of where it is.
   * @param fill playing alone: nobody else holds what is inside, so it is packed here
   */
  private async addDrop(d: DropInfo, fill = false) {
    if (this.drops.has(d.uid)) return;
    const stash = new Stash(d.uid, d.x, d.y, d.z, d.rot, DROP.w, DROP.h, DROP.label);
    if (fill) {
      fillDrop(stash.container);
      stash.known = true;
    }
    this.drops.set(d.uid, { stash, until: performance.now() + d.left * 1000, at: new THREE.Vector3(d.x, d.y, d.z), smoke: { owed: 0 } });
    this.minimap.setDrops([...this.drops.values()].map((x) => x.at));
    const where = describeSpot(this.s.world, d.x, d.z);
    const mins = Math.max(1, Math.round(d.left / 60));
    this.hud.note(`Supply drop ${where}: there for ${mins} min, marked on the map (M)`, 'good');
    this.hud.feed(`Supply drop ${where}`);
    this.hud.chatLine('system', '', `A supply drop has come down ${where}.`);
    await this.loot.addDrop(stash);
    // (cleared away while its crate was still being fetched)
    if (this.drops.get(d.uid)?.stash !== stash) this.loot.removeStash(stash);
  }

  private removeDrop(uid: string) {
    const d = this.drops.get(uid);
    if (!d) return;
    this.drops.delete(uid);
    if (this.openStash === d.stash) this.toggleInventory(false);
    if (d.stash.obj) this.loot.removeStash(d.stash);
    this.minimap.setDrops([...this.drops.values()].map((x) => x.at));
    this.hud.feed('The supply drop is gone');
  }

  /** Playing alone: the same clock the server keeps (see tickDrops in server/index.ts). */
  private tickDrops() {
    const t = this.economy.time;
    for (const [uid, d] of this.drops) {
      const s = d.stash;
      if (s.container.items.length) s.emptiedAt = -1;
      else if (s.emptiedAt < 0) s.emptiedAt = t;
      const done = performance.now() > d.until || (s.emptiedAt >= 0 && t - s.emptiedAt > DROP.linger);
      if (done && this.openStash !== s) this.removeDrop(uid);
    }
    if (this.nextDrop < 0) this.nextDrop = t + DROP.first;
    else if (t >= this.nextDrop && !this.drops.size) {
      this.nextDrop = t + DROP.every;
      const at = pickDropSite(this.s.world);
      if (at) void this.addDrop({ uid: `drop-${newUid()}`, ...at, rot: Math.random() * Math.PI * 2, left: DROP.life }, true);
    }
  }

  /** the server says someone hit us */
  private takeHit(m: Extract<S2C, { t: 'dmg' }>) {
    const p = this.player;
    if (p.dead) return;
    let amount = m.amount;
    if (m.zone === 'torso') for (const a of this.inv.wear('armor')) amount *= a;
    if (m.zone === 'head') for (const a of this.inv.wear('head')) amount *= a;
    // the jeep they are in ran into something: no wound, and nobody to look round for
    if (m.w === 'crash') {
      p.damage(m.amount, 'a crash');
      this.weapons.flinch(1);
      this.meDirty = true;
      return;
    }
    // (a jeep that ran them down is 'jeep'; one that burned with them in it, or beside them, is 'fire')
    const blast = m.w === 'grenade' || m.w === 'barrel' || m.w === 'fire';
    const melee = !blast && !ITEMS[m.w]?.weapon;
    const sick = m.w === 'infected';
    p.damage(amount, sick ? 'the infected' : m.w === 'fire' ? 'a burning jeep' : m.w === 'jeep' ? 'being run down' : blast ? 'an explosion' : melee ? 'a beating' : 'gunshot wounds');
    this.glass = 0;
    this.setHold(null);
    // a bullet nearly always opens a wound, a blade often, a fist or a bat seldom
    const blade = m.w === 'knife' || m.w === 'machete' || m.w === 'hatchet';
    if (!p.dead && Math.random() < (sick ? INFECTED.bleed : melee ? (blade ? 0.6 : amount > 25 ? 0.25 : 0) : amount > 12 ? 0.85 : 0.4)) p.bleed();
    this.weapons.flinch(melee ? 0.5 : 1);
    this.lastHit = { x: m.dir[0], z: m.dir[2], at: performance.now() };
    // Bullets in this world pass through your own body (the server said you were hit, not
    // this game): put the wound where the hit zone is, on the side it came from, so your own
    // clothes carry it and the ground behind you is marked.
    {
      const dir = new THREE.Vector3(m.dir[0], 0, m.dir[2]).normalize();
      const up = m.zone === 'head' ? (p.crouched ? 1.0 : 1.6) : m.zone === 'legs' ? (p.crouched ? 0.3 : 0.55) : p.crouched ? 0.72 : 1.22;
      const at = new THREE.Vector3(p.pos.x, p.pos.y + up, p.pos.z).addScaledVector(dir, m.zone === 'head' ? -0.12 : -0.16);
      const power = melee ? (m.w === 'fists' ? 0.2 : 0.55) : ITEMS[m.w]?.weapon?.kind === 'pistol' ? 0.6 : 1;
      this.effects.bleed(at, dir, power, true);
      if (power >= 0.4) this.avatar.wound(at, dir, 0.05 + power * 0.04, power > 0.58);
    }
    this.hud.hitFrom(Math.atan2(m.dir[0], m.dir[2]) - (p.yaw + Math.PI));
    if (this.use) {
      this.use = null;
      this.weapons.endUse();
      this.act('stop');
      this.settle();
    }
    this.meDirty = true;
  }

  private sendState(dt: number) {
    if (!this.online) return;
    const p = this.player;
    this.sendT += dt;
    if (this.sendT >= 1 / SEND_HZ) {
      this.sendT = 0;
      const it = this.weapons.equippedItem;
      const flags = (p.crouched ? F_CROUCH : 0) | (p.sprinting ? F_SPRINT : 0) | (this.weapons.aiming ? F_AIM : 0) | (p.grounded ? F_GROUND : 0) | (p.dead ? F_DEAD : 0) | (p.vitals.bleeding ? F_BLEED : 0) | (p.lean > 0.3 ? F_LEAN_R : p.lean < -0.3 ? F_LEAN_L : 0) | (this.hold === 'dance' ? F_DANCE : 0) | (this.hold === 'surrender' ? F_SURRENDER : 0) | (this.garage.ride ? F_SEAT : 0);
      const pose: Pose = [p.pos.x, p.pos.y, p.pos.z, p.yaw, p.pitch, flags];
      this.net.send({ t: 's', p: pose, w: it?.id ?? null, m: it?.mods ?? [] });
    }
    // the server keeps a copy of what we carry so it can leave a body with our gear on it
    this.meT += dt;
    if (!p.dead && ((this.meDirty && this.meT > 0.6) || this.meT > 8)) {
      this.meT = 0;
      this.meDirty = false;
      this.net.send({ t: 'me', inv: this.inv.serialize(), vitals: { ...p.vitals } });
    }
  }

  /** an item finished settling: tell the server about the ones this player dropped */
  private lootPlaced(l: WorldLoot) {
    if (!this.localDrops.delete(l.uid)) return;
    this.net.send({ t: 'drop', l });
  }

  private syncOpenBox() {
    const st = this.openStash;
    if (!this.online || !st || !st.known) return;
    this.net.send({ t: 'cset', cid: st.uid, items: st.container.serialize().items });
  }

  // ------------------------------------------------------------ targets (offline)

  /** Training dummies with real hit zones: something to shoot and punch when nobody else is around. */
  private async spawnDummies() {
    const { world, atmo, r } = this.s;
    const camp = world.pois.find((q) => q.name === 'Military Checkpoint');
    const village = world.pois.find((q) => q.name === 'Zelenaya Dolina');
    const spots: [number, number][] = [];
    if (village) spots.push([village.x - 22, village.z + 26], [village.x + 34, village.z - 20], [village.x - 48, village.z - 12]);
    if (camp) spots.push([camp.x - 9, camp.z + 11], [camp.x - 15, camp.z + 17]);
    for (const [sx, sz] of spots) {
      // nudge off anything solid (trees, walls, props)
      let x = sx, z = sz;
      for (let k = 0; k < 24; k++) {
        const y = heightAt(world.heights, x, z);
        if (!physics.boxOverlaps({ x, y: y + 1.0, z }, 0, 0.4, 0.8, 0.4, SOLID_GROUPS)) break;
        const a = k * 2.4;
        x = sx + Math.cos(a) * (1 + k * 0.4);
        z = sz + Math.sin(a) * (1 + k * 0.4);
      }
      const y = heightAt(world.heights, x, z);
      const d = new Dummy(new THREE.Vector3(x, y, z), Math.random() * Math.PI * 2);
      await d.load(atmo, r.scene);
      this.dummies.push(d);
    }
  }

  private onHit(h: HitInfo) {
    if (h.victim instanceof Infected) {
      // (alone, this game has already decided what it did; on a server the server does)
      if (this.online) this.net.send({ t: 'ihit', i: h.victim.i, zone: h.zone, w: h.weapon, dist: h.distance, sup: hasMod(this.weapons.equippedItem, 'suppressor_9'), bonus: h.weapon === 'fists' ? this.inv.wear('fist').reduce((a, b) => a + b, 0) : 0 });
      else if (h.killed) this.hud.note(`Infected down${h.zone === 'head' ? ' · headshot' : ''}${h.melee || h.distance < 8 ? '' : ` · ${Math.round(h.distance)} m`}`, 'good');
      return;
    }
    if (h.victim instanceof RemotePlayer) {
      const it = this.weapons.equippedItem;
      const bonus = this.inv.wear('fist').reduce((a, b) => a + b, 0);
      this.net.send({ t: 'hit', to: h.victim.id, zone: h.zone, w: h.weapon, dist: h.distance, sup: hasMod(it, 'suppressor_9'), bonus: h.weapon === 'fists' ? bonus : 0 });
      return;
    }
    if (!h.killed) return;
    const how = h.melee ? '' : ` · ${Math.round(h.distance)} m`;
    this.hud.note(`${h.target} down${h.zone === 'head' ? ' · headshot' : ''}${how}`, 'good');
  }

  // ------------------------------------------------------------ flow

  paused = true;

  /** The next weapon carried, round and round (the mouse wheel, for a thumb: it never stops on empty hands). */
  private nextWeapon() {
    const have = HAND_SLOTS.filter((s) => this.inv.slots[s]);
    if (!have.length || this.use || this.garage.ride) return;
    const at = have.indexOf(this.inv.active as (typeof HAND_SLOTS)[number]);
    this.handsFree = false;
    this.weapons.equip(have[(at + 1) % have.length]);
  }

  private resume() {
    if (this.joining) return;
    document.title = this.title;
    // keys must reach the game, not the name field
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    audio.start();
    // a phone goes full screen and stays on its side, where the browser allows it
    if (TOUCH && !document.fullscreenElement) {
      const orient = screen.orientation as unknown as { lock?: (o: string) => Promise<void> } | undefined;
      document.documentElement
        .requestFullscreen?.({ navigationUI: 'hide' })
        .then(() => orient?.lock?.('landscape'))
        .catch(() => {});
    }
    // capture the mouse in the same click; play begins once we are in the world and locked
    if (!this.input.locked) this.input.lock();
    if (!this.started) {
      void this.join();
      return;
    }
    if (this.input.locked) this.unpause();
  }

  private unpause() {
    this.paused = false;
    this.hud.showStart(false);
  }

  private pause() {
    this.paused = true;
    this.save();
    this.hud.showStart(true, true);
    this.input.unlock();
  }

  private respawn() {
    this.handsFree = false;
    if (this.online) {
      // the server picks the spawn and answers with 'spawn'
      this.net.send({ t: 'respawn' });
      return;
    }
    const p = this.player;
    // everything you carried stays where you fell
    for (const it of this.inv.topLevel()) this.dropItem(it, p.pos, 1.2);
    this.spawnAtEdge();
    this.freshKit();
    this.deathInfo = '';
    this.save();
    this.resume();
  }

  /** Graphics options from the Esc menu: applied at once, nothing needs a reload. */
  applyGraphics(g: Graphics) {
    this.gfx = g;
    const { r, atmo, veg, grass } = this.s;
    r.applyQuality({ renderScale: g.scale, msaa: g.msaa, ao: g.ao !== 'off', aoHalfRes: g.ao === 'half' });
    // shadow map size per cascade, and how far from the camera shadows are drawn
    const [size, reach] = { low: [1024, 70], medium: [1024, 110], high: [2048, 160] }[g.shadows];
    atmo.setShadows(size, reach);
    this.loot.shadowDist = g.shadows === 'high' ? 26 : 18;
    // reach of the full-detail trees, and blades of grass per patch
    const [detail, density] = { low: [0.45, 0.4], medium: [0.7, 0.7], high: [1, 1] }[g.foliage];
    veg.setDetail(detail);
    grass.setDensity(density);
    audio.setVolume(g.volume);
  }

  /** A slow circuit above the village: what the entrance menu is laid over. */
  private menuCamera(now: number) {
    const { r, world } = this.s;
    const cam = r.camera;
    const c = world.pois[0];
    const a = now * 0.000028 + 2.2;
    const x = c.x + Math.cos(a) * 128;
    const z = c.z + Math.sin(a) * 128;
    const ground = heightAt(world.heights, c.x, c.z);
    cam.position.set(x, Math.max(ground + 44, heightAt(world.heights, x, z) + 20), z);
    // the menu covers the left of the screen: keep the village in the right half
    const fx = c.x - x, fz = c.z - z;
    const len = Math.hypot(fx, fz) || 1;
    cam.lookAt(c.x + (fz / len) * 34, ground + 7, c.z - (fx / len) * 34);
    cam.fov = 50;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  start() {
    // the loading screen lifts: title and panels arrive, then the rewards briefing
    setTimeout(() => this.hud.entrance(), 400);
    setTimeout(() => !this.started && !this.joining && this.entryModal(), 3600);
    let due = 0;
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      const limit = this.gfx.fpsLimit;
      if (limit > 0) {
        // frame limit: skip display refreshes until the next frame is due (1 ms of slack,
        // so asking for 60 on a 60 Hz screen still shows every refresh)
        const step = 1000 / limit;
        if (t < due - 1) return;
        due = Math.max(due + step, t - step);
      }
      this.frame(t);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ inventory ops

  private takeWorldItem(w: WorldItem): ItemInstance | null {
    const l = this.economy.take(w.loot.uid);
    if (!l) return null;
    if (this.online) {
      this.pendingTakes.set(l.uid, { item: l.item, id: l.item.id, qty: l.item.qty });
      setTimeout(() => this.pendingTakes.delete(l.uid), 5000);
      this.net.send({ t: 'take', uid: l.uid });
    }
    return l.item;
  }

  dropItem(item: ItemInstance, at?: THREE.Vector3, spread = 0.5) {
    const p = at ?? this.player.pos;
    const a = Math.random() * Math.PI * 2;
    const r = 0.35 + Math.random() * spread;
    const fwd = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
    const x = p.x + (at ? Math.cos(a) * r : fwd.x * 0.7 + Math.cos(a) * 0.2);
    const z = p.z + (at ? Math.sin(a) * r : fwd.z * 0.7 + Math.sin(a) * 0.2);
    const hit = physics.raycast({ x, y: p.y + 1.2, z }, { x: 0, y: -1, z: 0 }, 4, SOLID_GROUPS);
    const y = hit && hit.toi > 1e-3 ? hit.point.y : p.y;
    // the loot manager then slides it clear of walls and furniture and lays it on the surface
    if (this.online) this.localDrops.add(item.uid);
    // it falls from the hands (or from the body it was on) to where it comes to rest
    this.loot.hands.set(item.uid, new THREE.Vector3(at ? p.x : p.x + fwd.x * 0.35, p.y + (at ? 0.9 : 1.15), at ? p.z : p.z + fwd.z * 0.35));
    this.economy.drop(item, x, y + 0.005, z, Math.random() * Math.PI * 2);
    this.weapons.validate();
  }

  private inventoryChanged() {
    this.slowT = 1; // refresh carried weight on the next frame
    this.weapons.validate();
    this.syncGear();
    this.refreshQuick();
    this.meDirty = true;
    this.syncOpenBox();
    this.save();
  }

  // ------------------------------------------------------------ quick slots (5-8)

  private assignQuick(i: number, id: string | null) {
    if (id) this.quick = this.quick.map((q) => (q === id ? null : q));
    this.quick[i] = id;
    this.save();
  }

  /** New kinds of food, drink and medical supplies take the first free quick key on their own. */
  private refreshQuick() {
    for (const c of this.inv.containers) {
      for (const pl of c.items) {
        const id = pl.item.id;
        if (!ITEMS[id].use || this.quick.includes(id)) continue;
        const i = this.quick.findIndex((q) => q === null || this.countOf(q) === 0);
        if (i >= 0) this.quick[i] = id;
      }
    }
  }

  /** how many uses of an item type are in the pockets (stack quantity, or number of items) */
  private countOf(id: string) {
    const stack = !!ITEMS[id].stack;
    let n = 0;
    for (const c of this.inv.containers) for (const p of c.items) if (p.item.id === id) n += stack ? p.item.qty : 1;
    return n;
  }

  private useQuick(i: number) {
    const id = this.quick[i];
    if (!id) {
      this.hud.note(`Quick key ${i + 5} is empty: hover an item in the inventory and press ${i + 5}`, 'info');
      return;
    }
    const item = this.inv.containers.flatMap((c) => c.items).find((pl) => pl.item.id === id)?.item;
    if (!item) {
      this.hud.note(`No ${ITEMS[id].name} left`, 'warn');
      return;
    }
    const def = ITEMS[item.id];
    if (def.use) this.useItem(item);
    else if (def.open) this.openBox(item);
  }

  // ------------------------------------------------------------ item actions

  private startUse(label: string, dur: number, itemId: string, kind: UseKind, sound: TimedAction['sound'], done: () => void) {
    this.toggleInventory(false);
    this.use = { label, t: 0, dur, sound, soundT: 0, done };
    this.weapons.beginUse(itemId, kind, dur);
    // (what everybody else sees of an injection is the hands at work on a wound, as with a dressing)
    this.act(kind === 'inject' ? 'bandage' : kind === 'smoke' ? 'eat' : kind, dur);
    // (a smoke is one sound from the lighter to the last breath of it, made once)
    if (sound === 'smoke') audio.ui('smoke');
  }

  /** wherever the item currently is: player inventory or the open crate */
  private consume(item: ItemInstance, from: Container | null) {
    const def = ITEMS[item.id];
    if (def.stack && item.qty > 1) {
      item.qty--;
      return;
    }
    if (this.loose === item) this.loose = null;
    this.inv.remove(item);
    from?.remove(item);
  }

  /**
   * A thing being used straight off the ground. It is in the hands for as long as that takes
   * and nowhere else; whatever is left of it afterwards (all of it, if the use was broken
   * off) goes into the pockets, or is put down again when they are full.
   */
  private loose: ItemInstance | null = null;

  /** Eat, drink, apply or open a thing where it lies (the inventory's right-click on the ground list). */
  private onGround(w: WorldItem, how: 'use' | 'open') {
    const def = ITEMS[w.loot.item.id];
    if (this.use || this.player.dead || !(how === 'use' ? def.use : def.open)) return;
    const item = this.takeWorldItem(w);
    if (!item) return;
    // (binoculars are not used up: they are kept and held to the eyes, so they need a place first)
    if (def.look) {
      const left = this.inv.add(item);
      if (left) return void this.dropItem(left);
      this.inventoryChanged();
      return this.useItem(item);
    }
    this.loose = item;
    if (how === 'use') this.useItem(item);
    else this.openBox(item);
    if (!this.use) this.settle();
  }

  /** what was in the hands off the ground and is not used up: put away, or put down */
  private settle() {
    const item = this.loose;
    this.loose = null;
    if (!item) return;
    const left = this.inv.add(item);
    if (left) this.dropItem(left);
    this.inventoryChanged();
  }

  private useItem(item: ItemInstance) {
    const def = ITEMS[item.id];
    if (!def.use || this.use || this.player.dead) return;
    if (def.look && performance.now() - this.glassDown < 150) return;
    const u = def.use;
    const from = this.openStash?.container.has(item) ? this.openStash.container : null;
    if (from) {
      // take it out of the crate first, so the crate can be closed while we eat
      from.remove(item);
      this.syncOpenBox();
    }
    // how the hands hold it while it is used: a smoke goes to the mouth, a grenade is worked with both
    const kind: UseKind = def.throw ? 'open' : def.look ? 'drink' : u.sound;
    const sound: TimedAction['sound'] = def.throw || def.look ? null : u.sound;
    this.glass = 0;
    this.startUse(def.throw ? 'Pulling the cord' : def.look ? 'Binoculars' : `${u.verb} ${def.name}`, u.time, item.id, kind, sound, () => {
      if (def.throw) {
        this.consume(item, null);
        this.inventoryChanged();
        this.throwGrenade(def.throw);
        return;
      }
      if (def.look) {
        // kept, and held up: see the frame loop for what puts them down again
        if (from) this.inv.add(item);
        this.glass = def.look;
        return;
      }
      const v = this.player.vitals;
      if (u.energy) v.energy = THREE.MathUtils.clamp(v.energy + u.energy, 0, 100);
      if (u.water) v.water = THREE.MathUtils.clamp(v.water + u.water, 0, 100);
      if (u.health) v.health = Math.min(100, v.health + u.health);
      if (u.stopBleed && v.bleeding) {
        v.bleeding = false;
        this.hud.note('The bleeding has stopped', 'good');
        this.meDirty = true;
      }
      const gained = [u.energy ? `${u.energy > 0 ? '+' : ''}${u.energy} energy` : '', u.water ? `${u.water > 0 ? '+' : ''}${u.water} water` : '', u.health ? `+${u.health} health` : ''].filter(Boolean).join(' · ');
      if (gained) this.hud.note(gained, 'good');
      if (u.sound === 'smoke') {
        // what is left of it, in front of the face
        const cam = this.s.r.camera;
        this.effects.muzzle(cam.position.clone().add(new THREE.Vector3(0, -0.12, -0.35).applyQuaternion(cam.quaternion)), new THREE.Vector3(0, 0.3, -1).applyQuaternion(cam.quaternion), true, true);
      }
      this.consume(item, null);
      this.inventoryChanged();
    });
  }

  /** binoculars at the eyes: how much of the field of view is left (0 = put away) */
  private glass = 0;
  /** when they were last put down: the same key press must not bring them straight back up */
  private glassDown = 0;
  // when the player was last told what the marks on the map mean (said once in a while, not every half minute)
  private markedSaid = -1e9;
  private pingSaid = -1e9;

  /** The cord is pulled: it leaves the hand the way the player is looking, and everyone is told. */
  private throwGrenade(spec: { fuse: number; damage: number; radius: number }) {
    const cam = this.s.r.camera, p = this.player;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const o = cam.position.clone().addScaledVector(dir, 0.5).add(new THREE.Vector3(0.18, -0.1, 0).applyQuaternion(cam.quaternion));
    // thrown, not dropped: forward and up, plus whatever the thrower was doing
    const v = dir.multiplyScalar(15).add(new THREE.Vector3(p.vel.x, 3.2 + Math.max(0, p.vel.y), p.vel.z));
    this.grenades.throw(o, v, spec.fuse - 0.75, true);
    this.net.send({ t: 'nade', o: o.toArray(), v: v.toArray() });
    this.avatar.swing(true);
    audio.whoosh(0.5);
  }

  // --- the wheel (hold T, see src/sim/emotes.ts)
  private wheelOn = false;
  private wheelAt = new THREE.Vector2();
  private wheelSince = 0;
  /** what a tap of T on its own repeats, and when we last called anything out */
  private lastCall = 'hey';
  private calledAt = -1e9;
  /** what the body is keeping up (a dance, hands up), and until when the arms are busy with a call */
  private hold: Hold | null = null;
  private armsUntil = 0;
  /** what the people near have just called out: who, the words, when */
  private said = new Map<number, { text: string; at: number }>();

  /** Where the gun is pointing, as pixels off the middle of the screen (see Weapons.lag). */
  private lagPx(): [number, number] {
    const cam = this.s.r.camera, lag = this.weapons.lag;
    const k = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    return [-Math.tan(lag.x) * k, -Math.tan(lag.y) * k];
  }

  /** From the wheel: call something out, or start (or stop) something the body keeps up. */
  private emote(id: string) {
    const e = EMOTE[id], p = this.player;
    if (!e || p.dead || this.use) return;
    if (e.hold) {
      this.setHold(this.hold === e.hold ? null : e.hold);
      return;
    }
    const now = performance.now();
    if (now - this.calledAt < EMOTE_GAP * 1000) return;
    this.calledAt = now;
    this.lastCall = id;
    // a dance stops for it; hands that are up stay up
    if (this.hold === 'dance') this.setHold(null);
    if (e.move && !this.hold) {
      this.avatar.emote(e.move, e.dur);
      this.armsUntil = now + (e.dur ?? 1.5) * 1000;
    }
    audio.shout(id, undefined, 0, voiceOf(playerName()));
    this.hud.note('“' + e.say + '”');
    this.net.send({ t: 'emote', e: id });
  }

  private setHold(h: Hold | null) {
    if (h === this.hold) return;
    const p = this.player;
    // (nobody dances crouched, or in the air)
    if (h && (!p.grounded || (h === 'dance' && p.crouched))) {
      this.hud.note(p.grounded ? 'Stand up to dance' : 'Not in the air', 'warn');
      return;
    }
    this.hold = h;
    this.avatar.setHold(h);
    if (h) {
      this.armsUntil = 0;
      this.avatar.emote(null);
      this.hud.note(h === 'dance' ? 'Dancing · move to stop' : 'Hands up · move to stop');
    }
  }

  /** T held: the mouse picks from the wheel instead of turning the head, and letting go does it. */
  private updateWheel(ok: boolean, now: number) {
    const input = this.input;
    if (ok && !this.wheelOn && input.pressed('KeyT')) {
      this.wheelOn = true;
      this.wheelAt.set(0, 0);
      this.wheelSince = now;
    }
    if (!this.wheelOn) return;
    const at = this.wheelAt;
    at.x += input.mouseDX / WHEEL_REACH;
    at.y += input.mouseDY / WHEEL_REACH;
    if (at.length() > 1) at.normalize();
    // the first entry is at the top, the rest follow clockwise
    const n = EMOTES.length;
    const pick = at.length() > WHEEL_PICK ? ((Math.round((Math.atan2(at.x, -at.y) / (Math.PI * 2)) * n) % n) + n) % n : -1;
    if (!ok || !input.held('KeyT')) {
      this.wheelOn = false;
      // (a tap, the mouse left alone, is the last call again)
      if (ok) {
        if (pick >= 0) this.emote(EMOTES[pick].id);
        else if (now - this.wheelSince < 220) this.emote(this.lastCall);
      }
    }
    this.hud.wheel(this.wheelOn, pick, [at.x, at.y], this.hold, EMOTE[this.lastCall]?.say ?? '');
  }

  /** The words people near have called out, over their heads: for whoever is close and can see them. */
  private updateSaid(now: number) {
    if (!this.said.size) return;
    const cam = this.s.r.camera;
    const head = new THREE.Vector3(), dir = new THREE.Vector3();
    for (const [id, s] of this.said) {
      const r = this.remotes.get(id);
      const age = (now - s.at) / 1000;
      let at: [number, number] | null = null;
      if (r?.alive && age < SAY_TIME) {
        r.head(head).y += 0.36;
        const d = dir.copy(head).sub(cam.position).length();
        if (d < SAY_RANGE && !physics.raycast(cam.position, dir.divideScalar(d), Math.max(0, d - 0.7), SIGHT_GROUPS)) {
          head.project(cam);
          if (head.z < 1 && Math.abs(head.x) < 1.15 && Math.abs(head.y) < 1.15) at = [head.x * 0.5 + 0.5, 0.5 - head.y * 0.5];
        }
      } else this.said.delete(id);
      this.hud.say(id, s.text, at, age);
    }
  }

  // fuel drums (see src/sim/barrels.ts): the ones a blast of ours has reached and that are about
  // to go up, and, playing alone, the ones that are gone and when each is stood up again
  private fuses: { i: number; t: number }[] = [];
  private drumsBack: { i: number; t: number }[] = [];

  /**
   * A fuel drum goes up.
   * @param mine set off by this player (a bullet, or a blast of theirs that reached it), who
   *   tells the server and answers for whoever it reaches
   */
  private blowBarrel(i: number, mine: boolean) {
    const b = this.s.veg.barrels[i];
    if (!b?.there) return;
    b.setThere(false);
    // (the server has to hear that it went up before it hears who was hurt)
    if (mine) this.net.send({ t: 'barrel', i });
    if (!this.online) this.drumsBack.push({ i, t: BARREL.respawn });
    this.explode(new THREE.Vector3(b.x, b.y + BARREL.centre, b.z), mine, 'barrel', b.collider);
  }

  private updateBarrels(dt: number) {
    for (let k = this.fuses.length - 1; k >= 0; k--) {
      const f = this.fuses[k];
      if ((f.t -= dt) > 0) continue;
      this.fuses.splice(k, 1);
      this.blowBarrel(f.i, true);
    }
    for (let k = this.drumsBack.length - 1; k >= 0; k--) {
      const f = this.drumsBack[k];
      const b = this.s.veg.barrels[f.i];
      // (never stood up round somebody's legs)
      if ((f.t -= dt) > 0 || Math.hypot(b.x - this.player.pos.x, b.z - this.player.pos.z) < BARREL.clear) continue;
      this.drumsBack.splice(k, 1);
      b.setThere(true);
    }
  }

  /**
   * Something has gone off somewhere in the world: a grenade, or a fuel drum.
   * @param skip what went up, if it is still standing in the way of its own blast
   */
  private explode(at: THREE.Vector3, mine: boolean, what: 'grenade' | 'barrel' | 'jeep' = 'grenade', skip?: Barrel['collider']) {
    // (a jeep goes up as a drum of fuel does; online the server says who it reached)
    const jeep = what === 'jeep';
    const drum = what === 'barrel' || jeep;
    const spec = drum ? { damage: WEAPON_RULES.barrel.damage, radius: WEAPON_RULES.barrel.blast! } : ITEMS.grenade.throw!;
    const p = this.player, cam = this.s.r.camera;
    const far = at.distanceTo(cam.position);
    this.effects.explode(at, drum);
    audio.explosion(at, far, drum);
    if (far < 40) this.weapons.flinch(THREE.MathUtils.clamp(2.2 - far / 14, 0.2, 2));
    /** how much of the blast reaches a point: nothing through a wall, less with every metre */
    const reach = (to: THREE.Vector3, short = 0.3) => {
      const d = to.distanceTo(at);
      if (d > spec.radius) return 0;
      const ray = to.clone().sub(at);
      if (physics.raycast(at, ray.normalize(), Math.max(0, d - short), SOLID_GROUPS, skip)) return 0;
      return Math.pow(1 - d / spec.radius, 1.3);
    };
    // your own body: this game decides it for your own grenade; another player's reaches you through the server
    if (mine && !p.dead && this.started && !(jeep && this.online)) {
      const chest = new THREE.Vector3(p.pos.x, p.pos.y + (p.crouched ? 0.6 : 1.1), p.pos.z);
      const k = reach(chest);
      if (k > 0) {
        let amount = spec.damage * k;
        for (const a of this.inv.wear('armor')) amount *= a;
        p.damage(amount, jeep ? 'a burning jeep' : drum ? 'a fuel drum you set off' : 'your own grenade');
        if (amount > 12) p.bleed();
        this.hud.hitFrom(Math.atan2(p.pos.x - at.x, p.pos.z - at.z) - (p.yaw + Math.PI));
        this.meDirty = true;
      }
    }
    if (!mine) return;
    // the next drum along goes up a moment later
    for (const b of this.s.veg.barrels) {
      if (!b?.there || this.fuses.some((f) => f.i === b.i)) continue;
      const c = new THREE.Vector3(b.x, b.y + BARREL.centre, b.z);
      // (the look stops short of the drum's own sides, which are in the way of its middle)
      if (c.distanceTo(at) < spec.radius * BARREL.chainReach && reach(c, 0.5) > 0) this.fuses.push({ i: b.i, t: BARREL.chainDelay + Math.random() * 0.15 });
    }
    // everyone else it reached: reported one by one, like any other hit
    for (const rp of this.remotes.values()) {
      if (!rp.alive || jeep) continue;
      const chest = rp.chest(new THREE.Vector3());
      const d = chest.distanceTo(at);
      if (reach(chest) <= 0) continue;
      const dir = chest.clone().sub(at).normalize();
      rp.damage(0, chest, dir, 'torso');
      this.effects.bleed(chest, dir, 0.8);
      rp.avatar.wound(chest.clone().addScaledVector(dir, -0.2), dir, 0.09, false);
      this.net.send({ t: 'hit', to: rp.id, zone: 'torso', w: what, dist: d, sup: false, bonus: 0 });
    }
    // the infected standing in it
    for (const b of this.horde.all.values()) {
      if (b.dead || !b.ready) continue;
      const chest = new THREE.Vector3(b.pos.x, b.pos.y + 1.2, b.pos.z);
      const k = reach(chest);
      if (k <= 0) continue;
      const dir = chest.clone().sub(at).normalize();
      this.effects.bleed(chest, dir, 0.8);
      b.avatar.wound(chest.clone().addScaledVector(dir, -0.2), dir, 0.09, false);
      if (b.damage(spec.damage * k, chest, dir, 'torso')) this.hud.note(drum ? 'Infected down · fuel drum' : 'Infected down · grenade', 'good');
      if (this.online && !jeep) this.net.send({ t: 'ihit', i: b.i, zone: 'torso', w: what, dist: chest.distanceTo(at), sup: false, bonus: 0 });
    }
    for (const d of this.dummies) {
      const chest = new THREE.Vector3(d.pos.x, d.pos.y + 1.2, d.pos.z);
      const k = reach(chest);
      if (k <= 0 || d.dead) continue;
      const dir = chest.clone().sub(at).normalize();
      this.effects.bleed(chest, dir, 0.8);
      d.avatar.wound(chest.clone().addScaledVector(dir, -0.2), dir, 0.09, false);
      if (d.damage(spec.damage * k, chest, dir, 'torso')) this.hud.note(drum ? 'Training dummy down · fuel drum' : 'Training dummy down · grenade', 'good');
    }
    // and any jeep standing in it
    if (!jeep) {
      for (const j of this.garage.jeeps.values()) if (!j.wreck && j.pos.distanceTo(at) < spec.radius * 0.7 && reach(j.pos.clone().setY(j.pos.y + 0.9), 2.2) > 0) this.garage.struck(j, what);
    }
  }

  /** Sealed ammo box -> a stack of loose rounds. */
  private openBox(item: ItemInstance) {
    const def = ITEMS[item.id];
    if (!def.open || this.use || this.player.dead) return;
    const o = def.open;
    const from = this.openStash?.container.has(item) ? this.openStash.container : null;
    if (from) {
      from.remove(item);
      this.syncOpenBox();
    }
    audio.ui('open');
    this.startUse(`Open ${def.name}`, o.time, item.id, 'open', null, () => {
      if (this.loose === item) this.loose = null;
      this.inv.remove(item);
      const left = this.inv.add(makeItem(o.gives, o.qty));
      if (left) this.dropItem(left);
      audio.ui('pickup');
      this.hud.note(`${o.qty} × ${ITEMS[o.gives].name}`, 'good');
      this.inventoryChanged();
    });
  }

  /** Take the rounds out of a weapon and put them back in the pockets. */
  private unloadWeapon(item: ItemInstance) {
    const def = ITEMS[item.id];
    const n = item.loaded ?? 0;
    if (!def.weapon || n <= 0 || this.weapons.busy) return;
    item.loaded = 0;
    const left = this.inv.add(makeItem(def.weapon.ammo, n));
    if (left) this.dropItem(left);
    audio.click(2200, 0.4, 0.03);
    audio.click(1500, 0.4, 0.04, 0.12);
    this.hud.note(`Unloaded ${n} × ${ITEMS[def.weapon.ammo].name}`, 'good');
    this.inventoryChanged();
  }

  // ------------------------------------------------------------ attachments

  /** weapons the player carries that this attachment can go on right now */
  private attachTargets(att: ItemInstance): ItemInstance[] {
    const a = ITEMS[att.id].attach;
    if (!a) return [];
    const out: ItemInstance[] = [];
    const consider = (w: ItemInstance) => {
      if (!a.fits.includes(w.id)) return;
      // one attachment per mount point
      if ((w.mods ?? []).some((m) => ITEMS[m]?.attach?.slot === a.slot)) return;
      out.push(w);
    };
    for (const it of this.inv.topLevel()) consider(it);
    for (const c of this.inv.containers) for (const p of c.items) if (!out.includes(p.item)) consider(p.item);
    return out;
  }

  private attachMod(att: ItemInstance, weapon: ItemInstance) {
    if (!this.attachTargets(att).includes(weapon) || this.weapons.busy) return;
    this.inv.remove(att);
    this.openStash?.container.remove(att);
    (weapon.mods ??= []).push(att.id);
    audio.click(2600, 0.4, 0.03);
    audio.click(1900, 0.45, 0.05, 0.14);
    this.hud.note(`${ITEMS[att.id].name} fitted to ${ITEMS[weapon.id].name}`, 'good');
    this.inventoryChanged();
  }

  private detachMod(weapon: ItemInstance, mod: string) {
    if (!weapon.mods?.includes(mod) || this.weapons.busy) return;
    weapon.mods = weapon.mods.filter((m) => m !== mod);
    // rounds that no longer fit come back out
    const extra = (weapon.loaded ?? 0) - capacityOf(weapon);
    const back: ItemInstance[] = [makeItem(mod)];
    if (extra > 0) {
      weapon.loaded = capacityOf(weapon);
      back.push(makeItem(ITEMS[weapon.id].weapon!.ammo, extra));
    }
    for (const it of back) {
      const left = this.inv.add(it);
      if (left) this.dropItem(left);
    }
    audio.click(1900, 0.45, 0.05);
    this.inventoryChanged();
  }

  private placeStash(item: ItemInstance) {
    const p = this.player;
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const x = p.pos.x + fwd.x * 1.6, z = p.pos.z + fwd.z * 1.6;
    const hit = physics.raycast({ x, y: p.pos.y + 1.5, z }, { x: 0, y: -1, z: 0 }, 5, SOLID_GROUPS);
    if (!hit || hit.toi < 1e-3 || hit.point.y > p.pos.y + 0.6 || physics.boxOverlaps({ x, y: hit.point.y + 0.3, z }, p.yaw, 0.6, 0.22, 0.26)) {
      this.hud.note('Not enough room to place the crate here', 'warn');
      return;
    }
    this.inv.remove(item);
    this.openStash?.container.remove(item);
    const st = new Stash(newUid(), x, hit.point.y, z, p.yaw);
    st.known = true;
    void this.loot.addStash(st).then(() => this.save());
    this.net.send({ t: 'stash+', s: { uid: st.uid, x: st.x, y: st.y, z: st.z, rot: st.rot } });
    this.toggleInventory(false);
    this.inventoryChanged();
    audio.ui('drop');
    this.hud.note('Stash crate placed. Look at it and press F to open it.', 'good');
  }

  private nearbyStash(): Stash | null {
    // (nothing is searched from a jeep's seat)
    if (this.garage.ride) return null;
    if (this.focus instanceof Stash) return this.focus;
    const p = this.player.pos;
    let best: Stash | null = null;
    let bd = 2.2;
    for (const s of [...this.loot.stashes, ...this.loot.crates, ...[...this.corpses.values()].map((c) => c.stash), ...[...this.drops.values()].map((d) => d.stash)]) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd && Math.abs(s.y - p.y) < 1.5) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /**
   * @param byEscape closed with Escape. A browser will not give the mouse back on that key
   *   (only on a click), and sending the player to the pause menu for closing their pockets
   *   was the wrong answer: the game carries on, and the next click takes the mouse.
   */
  toggleInventory(open?: boolean, byEscape = false) {
    const want = open ?? !this.invUI.isOpen;
    if (want === this.invUI.isOpen) return;
    if (want) {
      this.openStash = this.nearbyStash();
      this.invUI.open(this.around(), this.openStash, this.player.vitals);
      if (this.garage.ride && this.loot.near(this.player.pos, 2.3).length) this.hud.note('Nothing is picked up from a seat: get out for it', 'info');
      if (this.online && this.openStash) {
        // the server holds what is inside; show it once it answers
        this.invUI.setStashState('Opening…');
        this.net.send({ t: 'copen', cid: this.openStash.uid });
      }
      this.input.uiMode = true;
      this.input.unlock();
      audio.ui('open');
    } else {
      if (this.online && this.openStash) {
        this.syncOpenBox();
        this.net.send({ t: 'cclose', cid: this.openStash.uid });
      }
      this.invUI.close();
      this.input.uiMode = false;
      this.openStash = null;
      if (byEscape && !this.input.touch) this.awaitClick = true;
      else if (this.started) this.input.lock();
      // if the browser refuses the re-capture, the next click on the game takes it (see awaitClick)
      setTimeout(() => {
        if (this.started && !this.paused && !this.invUI.isOpen && !this.input.locked && !this.player.dead) this.awaitClick = true;
      }, 400);
      audio.ui('close');
      this.save();
    }
  }

  // ------------------------------------------------------------ interaction

  private updateInteraction(cam: THREE.PerspectiveCamera) {
    this.prompt = null;
    this.mark = null;
    this.focus = null;
    if (this.player.dead || this.invUI.isOpen || this.use) return;
    // sat in a jeep there is one thing to do with F
    if (this.garage.ride) {
      if (this.input.pressed('KeyF') && !this.hud.chatOpen) this.garage.out();
      else if (this.touch || performance.now() - this.rideAt < 7000) this.prompt = this.garage.ride.seat === 0 ? '<kbd>F</kbd>Get out <small>W A S D to drive · Space is the handbrake</small>' : '<kbd>F</kbd>Get out';
      return;
    }
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const range = 2.6;
    const hit = physics.raycast(cam.position, dir, range, USE_GROUPS, this.player.collider);
    const owner = hit?.tag?.owner ?? this.nearestLoose(cam, dir, range);
    if (!owner) {
      // nobody has a name floating over their head: you only learn it by looking right at them, up close
      const c = new THREE.Vector3();
      for (const r of this.remotes.values()) {
        if (!r.alive) continue;
        r.chest(c).sub(cam.position);
        const d = c.length();
        // (and only with nothing in between: it used to be read straight through walls)
        if (d < 18 && c.normalize().dot(dir) > 0.992 && !physics.raycast(cam.position, c, d - 0.5, SIGHT_GROUPS)) this.prompt = `<small>${r.name}</small>`;
      }
      return;
    }
    this.focus = owner;
    const key = this.input.pressed('KeyF');
    if (owner instanceof WorldItem) {
      const item = owner.loot.item;
      const d = ITEMS[item.id];
      const qty = d.stack ? ` <small>×${item.qty}</small>` : d.weapon ? ` <small>${item.loaded ?? 0}/${capacityOf(item)}</small>` : item.cargo?.length ? ` <small>${item.cargo.length} inside</small>` : '';
      this.prompt = `<kbd>F</kbd>Take ${d.name}${qty}`;
      // four corners round it, so there is no doubt which thing that is
      const at = new THREE.Vector3(owner.loot.x, owner.loot.y + 0.05, owner.loot.z).project(cam);
      if (at.z < 1) this.mark = [at.x * 0.5 + 0.5, 0.5 - at.y * 0.5];
      if (key) {
        if (!this.inv.hasRoom(item)) {
          this.hud.note(d.slot ? `No free ${d.slot === 'long' ? 'weapon' : d.slot} slot and no room in your pockets` : 'No room: find a vest or a bag', 'warn');
          return;
        }
        if (!this.takeWorldItem(owner)) return;
        const left = this.inv.add(item);
        if (left) this.dropItem(left);
        audio.ui('pickup');
        this.hud.note(`${d.name}${d.stack ? ` ×${item.qty}` : ''}`, 'good');
        this.inventoryChanged();
      }
    } else if (owner instanceof Door) {
      const door = owner;
      this.prompt = `<kbd>F</kbd>${door.open ? 'Close' : 'Open'} door`;
      if (key) {
        door.toggle(this.player.pos);
        audio.door(door.open, door.pivot.position);
        this.net.send({ t: 'door', i: this.s.buildings.doors.indexOf(door), open: door.open, swing: door.swingDir });
      }
    } else if (owner instanceof Jeep) {
      const can = this.inv.find((i) => i.id === 'jerrycan');
      const tagged = this.tagged;
      this.prompt = this.garage.prompt(owner, !!can, tagged);
      if (key) this.garage.use(owner, tagged);
      else if (can && !owner.wreck && owner.fuel < JEEP.tank - 0.5 && this.input.pressed('KeyG')) {
        const jeep = owner;
        this.startUse('Filling the tank', 4, 'jerrycan', 'drink', null, () => {
          if (jeep.wreck || jeep.pos.distanceTo(this.player.pos) > JEEP.reach + 1 || !this.inv.find((i) => i === can)) return;
          this.inv.remove(can);
          this.garage.refuel(jeep);
          audio.ui('drink');
          this.hud.note(`${JEEP.can} litres into the tank`, 'good');
          this.inventoryChanged();
        });
      }
    } else if (owner instanceof Stash) {
      const canPack = !owner.fixed && owner.container.items.length === 0 && (!this.online || owner.known);
      this.prompt = owner.fixed
        ? `<kbd>F</kbd>Search ${owner.label}`
        : `<kbd>F</kbd>Open ${owner.label}${canPack ? ' <small>G to pack up</small>' : ''}`;
      if (key) this.toggleInventory(true);
      if (canPack && this.input.pressed('KeyG')) {
        const kit = makeItem('stash_kit', 1);
        if (!this.inv.hasRoom(kit)) {
          this.hud.note('No room to carry the crate', 'warn');
          return;
        }
        this.inv.add(kit);
        this.loot.removeStash(owner);
        this.net.send({ t: 'stash-', uid: owner.uid });
        audio.ui('pickup');
        this.inventoryChanged();
      }
    }
  }

  /**
   * The loose item nearest the middle of the view, for when the eye is not dead on anything.
   * A tin on a shelf is a few pixels across: nobody should have to thread the cross-hair onto
   * it. Within reach, within a hand's spread of the cross-hair, and in plain sight.
   */
  private nearestLoose(cam: THREE.PerspectiveCamera, dir: THREE.Vector3, range: number): WorldItem | null {
    let best: WorldItem | null = null;
    // the widest it reaches: about 24 degrees off the cross-hair for something at arm's length
    let score = 0.42;
    const to = new THREE.Vector3();
    for (const w of this.loot.near(this.player.pos, range)) {
      to.set(w.loot.x, w.loot.y + 0.05, w.loot.z).sub(cam.position);
      const d = to.length();
      if (d > range || d < 0.05) continue;
      to.divideScalar(d);
      // nearest the cross-hair wins; of two as near to it, the one closer to hand
      const s = Math.acos(Math.min(1, to.dot(dir))) + d * 0.04;
      if (s >= score) continue;
      // (a shelf or a wall in the way: it stops just short of the thing itself, which lies on a surface)
      if (physics.raycast(cam.position, to, Math.max(0, d - 0.22), SIGHT_GROUPS)) continue;
      score = s;
      best = w;
    }
    return best;
  }

  /** G, held a moment: what is in the hands goes on the ground in front of you. */
  private dropInHands() {
    const slot = this.inv.active;
    const item = slot ? this.inv.slots[slot] : null;
    if (!slot || !item) {
      this.hud.note('Nothing in your hands to drop', 'warn');
      return;
    }
    this.inv.slots[slot] = null;
    this.inv.active = null;
    this.dropItem(item);
    audio.ui('drop');
    this.hud.note(`Dropped ${itemName(item)}`);
    this.inventoryChanged();
  }

  /** offline: emptied map crates refill after a while, once nobody is around to see it */
  private tickCrates() {
    const p = this.player.pos;
    for (const c of this.loot.crates) {
      if (c.container.items.length) {
        c.emptiedAt = -1;
        continue;
      }
      if (c.emptiedAt < 0) c.emptiedAt = this.economy.time;
      else if (this.economy.time - c.emptiedAt > CRATE_RESTOCK && c !== this.openStash && Math.hypot(c.x - p.x, c.z - p.z) > 60) {
        fillCrate(c.container, c.kind);
        c.emptiedAt = -1;
      }
    }
  }

  private slowT = 1;
  private hasCompass = false;

  private hotbar(): HotbarEntry[] {
    const out: HotbarEntry[] = [];
    SLOT_ORDER.forEach((s: Slot, i) => {
      const it = this.inv.slots[s];
      const d = it ? ITEMS[it.id] : null;
      out.push({ key: String(i + 1), id: it?.id ?? null, label: it && d?.weapon ? String(it.loaded ?? 0) : '', active: this.inv.active === s, dim: false });
    });
    this.quick.forEach((id, i) => {
      const n = id ? this.countOf(id) : 0;
      out.push({ key: String(i + 5), id, label: id ? String(n) : '', active: false, dim: !!id && n === 0 });
    });
    return out;
  }

  /** What to do about an open wound, in as few words as it takes: the key that holds a dressing, if there is one. */
  private bleedHint(): string {
    if (this.use?.sound === 'bandage' || this.use?.sound === 'inject') return 'Treating the wound…';
    const i = this.quick.findIndex((id) => !!id && !!ITEMS[id].use?.stopBleed && this.countOf(id) > 0);
    if (i >= 0) {
      const d = ITEMS[this.quick[i]!];
      return this.touch ? `Tap the ${d.name} below to stop it` : `<kbd>${i + 5}</kbd>${d.name}: stop the bleeding`;
    }
    const carried = this.inv.find((it) => !!ITEMS[it.id].use?.stopBleed);
    if (carried) return `${this.touch ? 'Open your pack' : '<kbd>Tab</kbd>'} and use the ${ITEMS[carried.id].name}`;
    return 'Find an injector or a first aid kit';
  }

  private dripT = 0;
  /** the last hit taken: which way it was travelling, and when */
  private lastHit: { x: number; z: number; at: number } | null = null;

  /** keep the body's hands in step with what is equipped */
  private syncHeld() {
    const it = this.weapons.equippedItem;
    const key = it ? `${it.id}|${(it.mods ?? []).join(',')}` : '';
    if (key === this.heldKey) return;
    this.heldKey = key;
    const h = it ? this.makeHeld(it.id, it.mods ?? []) : null;
    this.avatar.setHeld(h?.obj ?? null, h?.grips ?? null, h?.kind);
  }

  // ------------------------------------------------------------ frame

  /** @param stamp when the display refresh this frame is for began (the browser's own stamp) */
  private frame(stamp = performance.now()) {
    const now = performance.now();
    this.perf.begin(now);
    // How far the world moves this frame is measured between refreshes, not between the moments
    // the browser got round to calling us. Those wander by a millisecond or two with whatever
    // else the page is doing, while the picture goes up on the even beat of the display: a
    // step measured on the wandering clock and shown on the even one is motion that judders.
    const dt = Math.min(Math.max(0, stamp - this.last) / 1000, 0.1);
    this.last = stamp;
    const { r, veg, grass, buildings, atmo, world } = this.s;
    const input = this.input;
    const p = this.player;
    const cam = r.camera;
    const playing = this.started && !this.paused && !p.dead;

    if (input.pressed('Tab') && playing) this.toggleInventory();
    if (this.awaitClick && (this.input.locked || !playing || this.invUI.isOpen)) this.awaitClick = false;
    if (this.vicinityDue.length && now >= this.vicinityDue[0]) {
      this.vicinityDue.shift();
      if (this.invUI.isOpen) this.invUI.refresh(this.around(), this.openStash);
    }
    // G held for a third of a second drops what is in the hands (a tap next to F does nothing;
    // looking at an empty crate of your own, G packs it up instead: see updateInteraction)
    if (playing && !this.invUI.isOpen && !this.hud.chatOpen && !this.use && input.held('KeyG') && !(this.focus instanceof Stash) && !(this.focus instanceof Jeep)) {
      this.dropHeld += dt;
      if (this.dropHeld > 0.33 && !this.dropDone) {
        this.dropDone = true;
        this.dropInHands();
      }
    } else {
      this.dropHeld = 0;
      this.dropDone = false;
    }
    // M: the map, large; any way out of play puts it away again
    if (input.pressed('KeyM') && playing && !this.invUI.isOpen && !this.hud.chatOpen) this.minimap.toggle();
    else if (this.minimap.big && (!playing || this.invUI.isOpen)) this.minimap.toggle(false);
    const uiOpen = this.invUI.isOpen;
    // Enter opens the chat box; while typing the character stands still and the gun stays quiet
    if (input.pressed('Enter') && playing && !uiOpen && !this.hud.chatOpen) {
      input.releaseAll();
      this.hud.openChat();
    }
    if (this.hud.chatOpen && (!playing || uiOpen)) this.hud.closeChat();
    const typing = this.hud.chatOpen;
    // A phone has no row of number keys under the fingers: whatever is picked up to fight with
    // comes into the hands by itself when they are empty, unless they were emptied on purpose.
    if (this.touch && playing && !uiOpen && !this.use && !this.garage.ride && !this.handsFree && !this.weapons.equippedItem && !this.weapons.busy) {
      const slot = HAND_SLOTS.find((s) => this.inv.slots[s]);
      if (slot) this.weapons.equip(slot);
    }

    // binoculars come down for anything else: a trigger, a sprint, the pockets, a hit
    if (this.glass && (!playing || uiOpen || this.use || input.pressed('Mouse0') || input.pressed('Mouse2') || p.sprinting || QUICK_KEYS.some((k) => input.pressed(k)))) {
      this.glass = 0;
      this.glassDown = now;
    }
    this.updateWheel(playing && !uiOpen && !typing && !TOUCH, now);
    // a dance, or hands that are up, ends with the first step, shot or anything else done
    if (this.hold && (!playing || uiOpen || typing || !!this.use || !p.grounded || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => input.held(k)) || ['Space', 'KeyC', 'ControlLeft', 'Mouse0', 'Mouse2', 'KeyR', 'KeyG'].some((k) => input.pressed(k)))) this.setHold(null);
    // and a wave with a trigger pulled or a sight raised
    if (this.armsUntil > now && (input.pressed('Mouse0') || input.pressed('Mouse2'))) {
      this.armsUntil = 0;
      this.avatar.emote(null);
    }
    // In a jeep: the view is from behind it, the hands are on the wheel (or in the lap), and
    // getting in or out of one moves the view there rather than cutting to it.
    const ride = this.garage.ride;
    if ((ride?.jeep ?? null) !== this.rode) {
      this.rode = ride?.jeep ?? null;
      this.director.third = ride ? this.garage.view : null;
      this.director.shift(ride ? 0.5 : 0.35);
      if (ride) {
        this.rideAt = now;
        this.setHold(null);
        this.glass = 0;
        if (this.minimap.big) this.minimap.toggle(false);
      }
    }
    this.weapons.stowed = !!this.hold || this.armsUntil > now || !!ride;
    const sens = this.glass ? 0.22 : this.weapons.scoped ? 0.28 : this.weapons.aiming ? 0.7 : 1;
    if (!uiOpen && playing && !this.wheelOn) p.look(input, sens);

    const canMove = !uiOpen && playing && !typing;
    const moveInput = canMove ? input : NULL_INPUT;
    // carried weight and gear effects only change with the inventory: a few times a second is plenty
    this.slowT += dt;
    if (this.slowT > 0.2) {
      this.slowT = 0;
      p.weightKg = this.inv.weight();
      p.fallMult = this.inv.wear('fall').reduce((a, b) => a * b, 1);
      p.thirstMult = this.inv.wear('thirst').reduce((a, b) => a * b, 1);
      this.hasCompass = !!this.inv.find((i) => i.id === 'compass');
    }
    this.tagT += dt;
    if (this.tagT >= 1) {
      this.minimap.setJeeps([...this.garage.jeeps.values()].filter((j) => !j.wreck && j.mode === 'parked' && j.seats.every((s) => s === null)).map((j) => ({ x: j.pos.x, z: j.pos.z })));
      if (this.started && !p.dead) this.tickTags(this.tagT);
      else this.hud.setTags([]);
      this.tagT = 0;
    }
    physics.step(dt, (h) => {
      this.garage.step(h, moveInput);
      p.step(h, moveInput);
      // A key press belongs to one simulation step, however many of them this frame needs:
      // seen by two, a single tap of C crouches and stands straight back up.
      input.consumeFixed();
      buildings.update(h);
    });
    if (this.started) p.tickVitals(dt);

    // quick-use keys
    if (playing && !uiOpen && !typing && !this.use) {
      QUICK_KEYS.forEach((k, i) => {
        if (input.pressed(k)) this.useQuick(i);
      });
    }

    // timed item use (eat, drink, bandage, open a box): shown in the hands, RMB cancels
    if (this.use) {
      const u = this.use;
      u.t += dt;
      u.soundT += dt;
      if (u.sound === 'inject') {
        // one sound, a breath before the shot lands (weapons.ts, INJECT.hit)
        if (u.soundT >= 0 && u.t > INJECT.hit - 0.04) {
          u.soundT = -1e9;
          audio.ui('inject');
        }
      } else if (u.sound && u.sound !== 'smoke' && u.soundT > 1.05 && u.t < u.dur - 0.4) {
        u.soundT = 0;
        audio.ui(u.sound);
      }
      if (p.dead || (input.pressed('Mouse2') && !uiOpen)) {
        this.use = null;
        this.weapons.endUse();
        this.act('stop');
        if (!p.dead) this.hud.note('Cancelled', 'info');
        this.settle();
      } else if (u.t >= u.dur) {
        this.use = null;
        this.weapons.endUse();
        u.done();
        this.settle();
      }
    }

    // weapons + fov
    const fpLive = this.director.blend > 0.9;
    this.garage.frame(dt, now, physics.alpha, cam.position);
    this.weapons.update(dt, input, cam, fpLive && !uiOpen && playing && !this.use && !typing && !this.glass && !this.wheelOn && !this.hold && !ride);
    this.grenades.update(dt);
    this.updateBarrels(dt);
    const kind = this.weapons.equippedItem ? ITEMS[this.weapons.equippedItem.id].weapon?.kind : undefined;
    // a sprint opens the view a touch: speed you can feel
    this.director.fovMul = ride ? this.garage.fov : this.glass ? this.glass : this.weapons.scoped ? 0.3 : this.weapons.aiming ? (kind === 'rifle' ? 0.78 : 0.88) : p.sprinting && p.moving > 0.6 ? 1.055 : 1;
    this.syncHeld();

    this.director.update(dt);
    if (this.director.avatarVisible) cam.layers.enable(AVATAR_LAYER);
    else cam.layers.disable(AVATAR_LAYER);
    // your own body below the camera, first person only
    // before you deploy, the menu looks down on the middle of the map from the air
    if (!this.started) this.menuCamera(now);
    const fpView = this.started && this.director.viewmodelVisible && !p.dead && !this.garage.ride;
    if (fpView) cam.layers.enable(FP_BODY_LAYER);
    else cam.layers.disable(FP_BODY_LAYER);
    r.vmScene.visible = fpView && !this.glass;
    const interp = new THREE.Vector3().lerpVectors(p.prevPos, p.pos, physics.alpha);
    this.avatar.setLean(p.dead ? 0 : p.lean);
    if (this.garage.ride) {
      this.avatar.update(dt, p.pos, _still, this.garage.ride.jeep.yaw, false, p.dead, true, 0, true, false);
      this.garage.seatBody();
    } else this.avatar.update(dt, interp, p.vel, p.yaw, p.crouched, p.dead, true, 0, p.grounded, this.weapons.aiming);
    // the step you hear and the bob you see are the body's own
    p.stride = this.avatar.stride;
    if (this.avatar.footfall) p.footfall();
    for (const d of this.dummies) {
      if (Math.abs(d.pos.x - interp.x) + Math.abs(d.pos.z - interp.z) < 260) d.update(dt);
    }
    this.horde.update(dt, now, cam.position);
    for (const rp of this.remotes.values()) {
      rp.update(dt, now, cam.position);
      if (rp.bleeding && rp.alive && (rp.dripT -= dt) <= 0) {
        rp.dripT = 0.3 + Math.random() * 0.35;
        if (rp.pos.distanceToSquared(cam.position) < 90 * 90) this.effects.drip(_drip.set(rp.pos.x, rp.pos.y + (rp.crouched ? 0.55 : 0.95), rp.pos.z));
      }
    }
    // your own wound leaves the same trail: it is how you are followed
    if (p.vitals.bleeding && !p.dead && this.started && (this.dripT -= dt) <= 0) {
      this.dripT = 0.3 + Math.random() * 0.35;
      this.effects.drip(_drip.set(interp.x, interp.y + (p.crouched ? 0.55 : 0.95), interp.z));
    }

    this.updateInteraction(cam);
    this.minimap.update(interp.x, interp.z, p.yaw);
    this.effects.eye.copy(cam.position);
    // the smoke over each supply drop (not from the far side of the map: nobody could see it)
    for (const d of this.drops.values()) if (d.at.distanceToSquared(cam.position) < 420 * 420) this.effects.signal(d.at, d.smoke, dt);
    this.effects.update(dt);
    this.loot.update(cam.position, dt);

    // world simulation ticks (the server does this when online)
    this.econT += dt;
    if (this.econT > 5) {
      if (!this.online && this.started) {
        this.economy.tick(this.econT, [p.pos]);
        this.tickCrates();
        this.tickDrops();
      }
      this.econT = 0;
      if (this.invUI.isOpen) this.invUI.refresh(this.around(), this.openStash);
    }
    this.saveT += dt;
    if (this.saveT > 20 && playing) {
      this.saveT = 0;
      this.save();
    }
    this.sendState(dt);

    // points of interest
    const here = world.pois.find((q) => Math.hypot(q.x - p.pos.x, q.z - p.pos.z) < q.radius);
    if (here && here.name !== this.poi && this.started) this.hud.area(here.name);
    this.poi = here?.name ?? null;

    // vitals warnings
    const v = p.vitals;
    if (v.energy < 25 && !this.warned.hunger) {
      this.hud.note('You are hungry', 'warn');
      this.warned.hunger = true;
    } else if (v.energy > 35) this.warned.hunger = false;
    if (v.water < 25 && !this.warned.thirst) {
      this.hud.note('You are thirsty', 'warn');
      this.warned.thirst = true;
    } else if (v.water > 35) this.warned.thirst = false;
    if (p.dead && !this.deathSent) {
      this.deathSent = true;
      audio.death();
      // Which way the body goes: away from what killed it. With nothing to throw it (blood
      // loss, a fall, hunger) it folds up where it stands.
      let variant = Math.random() < 0.5 ? 1 : 2;
      if (this.lastHit && now - this.lastHit.at < 2500) {
        const along = this.lastHit.x * -Math.sin(p.yaw) + this.lastHit.z * -Math.cos(p.yaw);
        variant = along > 0.4 ? 1 : along < -0.4 ? 0 : 2;
      }
      this.avatar.setDeath(variant);
      if (!this.deathInfo) this.deathInfo = `You died of ${p.lastCause || 'your injuries'}. Your gear lies where you fell.`;
      if (this.invUI.isOpen) this.toggleInventory(false);
      this.input.unlock();
      if (this.online) {
        // last word on what we were carrying, then the server leaves a body with it
        this.net.send({ t: 'me', inv: this.inv.serialize(), vitals: { ...p.vitals } });
        this.net.send({ t: 'died', cause: p.lastCause || 'injuries', v: variant });
        this.inv.clear();
        this.weapons.validate();
      }
    } else if (!p.dead) this.deathSent = false;

    atmo.update();
    veg.update(dt, cam);
    grass.update(cam, interp);

    // audio
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position, fwd, new THREE.Vector3(0, 1, 0));
    if (Math.random() < 0.1) {
      this.indoors = physics.raycast(cam.position, { x: 0, y: 1, z: 0 }, 12, SHOT_GROUPS, p.collider) !== null;
      // forest floor underfoot means trees overhead: leaves instead of open-field insects
      this.inForest = this.s.terrain.surfaceAt(p.pos.x, p.pos.z) === 'dirt';
    }
    audio.updateAmbience(dt, cam.position, this.indoors, this.inForest);
    // breathing follows how much of the reserve is left, as a percentage
    if (this.started) audio.body(dt, (v.stamina / MAX_STAMINA) * 100, v.health, !p.dead, v.bleeding);

    // post-fx reacting to state
    const hurt = p.hurt;
    r.chroma.offset.set(hurt * 0.004 + (v.health < 25 ? 0.0015 : 0), hurt * 0.002);
    r.vignette.darkness = 0.42 + (this.weapons.aiming ? 0.12 : 0) + (v.health < 25 ? 0.25 : 0);

    const hasCompass = this.hasCompass;
    const heading = THREE.MathUtils.radToDeg(-p.yaw);
    this.updateSaid(now);
    this.hud.update({
      vitals: v,
      winded: p.outOfBreath,
      // no keyboard on a phone: the Use button lights up instead of naming a key
      prompt: this.awaitClick ? '<kbd>Click</kbd>to look around' : this.touch ? (this.prompt?.replace(/<kbd>F<\/kbd>/, '').replace(/ <small>G to [^<]*<\/small>/, '').replace('W A S D to drive · Space is the handbrake', 'the stick drives · the jump button is the handbrake') ?? null) : this.prompt,
      mark: this.awaitClick ? null : this.mark,
      weapon: this.garage.ride ? null : this.weapons.status(),
      aiming: this.weapons.aiming,
      spread: this.weapons.spread,
      lag: this.lagPx(),
      arms: this.weapons.armStamina,
      ride: this.garage.ride && !p.dead ? { kmh: Math.abs(this.garage.ride.jeep.speed) * 3.6, fuel: this.garage.ride.jeep.fuel / JEEP.tank, hp: this.garage.ride.jeep.hp / JEEP.hp, driver: this.garage.ride.seat === 0 } : null,
      scoped: this.weapons.scoped,
      sightless: this.weapons.sightless,
      glass: !!this.glass,
      hitMarker: this.weapons.hitMarker,
      kill: this.weapons.killMarker,
      head: this.weapons.headMarker,
      hurt,
      bleed: v.bleeding && !p.dead ? this.bleedHint() : null,
      heading: !uiOpen ? heading : null,
      bearing: hasCompass,
      progress: this.use ? { label: this.use.label, t: this.use.t / this.use.dur } : null,
      hotbar: this.hotbar(),
      fps: this.fps,
      ping: this.online ? this.net.ping : null,
      dead: p.dead,
      deadText: this.deathInfo,
      hidden: uiOpen || !this.started,
    });

    // (what G would do here gets a button of its own beside Use)
    this.touch?.update(playing && !uiOpen && !typing, uiOpen, !!this.prompt?.includes('<kbd>F'), {
      g: this.prompt?.includes('G to pour') ? 'Fuel' : this.prompt?.includes('G to pack up') ? 'Pack' : null,
      aiming: this.weapons.aiming,
    });
    this.perf.beforeRender();
    r.render(dt);
    this.perf.afterRender();
    input.endFrame();

    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsN / this.fpsAcc;
      // struggling for a while: point at the options once (the game never lowers them itself)
      this.slowFor = playing && this.fps < 28 && !(this.gfx.fpsLimit && this.gfx.fpsLimit <= 30) ? this.slowFor + this.fpsAcc : 0;
      if (this.slowFor > 8 && !this.slowHinted) {
        this.slowHinted = true;
        this.hud.note(TOUCH ? 'Low frame rate: open the menu, then Settings' : 'Low frame rate: press Esc and open Settings', 'warn');
        this.hud.chatLine('system', '', `The frame rate is low. ${TOUCH ? 'Open the menu' : 'Press Esc'} and open Settings to turn the graphics down.`);
      }
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
  }
}
