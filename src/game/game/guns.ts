// The game: attachments and magazines.
// (Methods of Game cut out of game.ts whole on 2026-10-14, so that they can be read and worked on alone: put back on
// Game.prototype as the file loads. Nothing in them was changed but `this: Game` said as the first parameter.)

import * as THREE from 'three';
import { physics, SIGHT_GROUPS } from '../../core/physics';
import { audio } from '../../core/audio';
import { heightAt } from '../../world/worldgen';
import { type ItemInstance, ITEMS, swapMag, capacityOf, makeItem, fillMag, newUid } from '../../sim/items';
import type { StashInfo, StoredItem } from '../../net/protocol';
import { Stash, WorldItem } from '../loot';
import { Jeep } from '../vehicle';
import type { HandAct } from '../../ui/hud';
import { noBurying, BURY } from '../../sim/stash';
import { callSite, describeSpot, DROP } from '../../sim/drops';
import { planFlight, type Flight, flightTimes, comesFrom, restAt } from '../../sim/airdrop';
import { type JobBook, bookFor, dayOf } from '../../sim/jobs';
import { DIG_SECONDS, Game } from '../game';
import { economyCargo } from '../../sim/storage';
import { SEARCHED } from '../remote';

export const gunsMethods = {
  // ------------------------------------------------------------ attachments

  /** weapons the player carries that this attachment can go on right now */
  attachTargets(this: Game, att: ItemInstance): ItemInstance[] {
    const a = ITEMS[att.id].attach;
    if (!a) return [];
    const out: ItemInstance[] = [];
    const consider = (w: ItemInstance) => {
      if (!a.fits.includes(w.id)) return;
      // (a magazine goes into a gun that has one in it already: the two are changed over)
      if (ITEMS[att.id].mag) return void out.push(w);
      // one attachment per mount point
      if ((w.mods ?? []).some((m) => ITEMS[m]?.attach?.slot === a.slot)) return;
      out.push(w);
    };
    for (const it of this.inv.topLevel()) consider(it);
    for (const c of this.inv.containers) for (const p of c.items) if (!out.includes(p.item)) consider(p.item);
    return out;
  },

  /**
   * A gun's parts and its magazine are changed with the gun in the hands, as in DayZ (asked for 2026-10-11: "a
   * player cannot swap out attachments for a gun they are not holding in their hand"). Asked of one on the back
   * or in a pocket, the gun is brought up first, and the change is made when it is there.
   * @param run the change, to be made once the gun is up
   * @returns whether it is in the hands now, and the change can be made at once
   */
  gunInHands(this: Game, gun: ItemInstance, run: () => void): boolean {
    if (this.inv.held() === gun) return true;
    if (!this.inv.find((i) => i === gun)) {
      this.hud.note(`Take the ${ITEMS[gun.id].name} first: a gun's parts are changed with it in your hands`, 'warn');
      return false;
    }
    if (this.player.dead || this.garage.ride) return false;
    this.takeUp(gun);
    this.fitting = { gun, run, t: 0 };
    return false;
  },

  /** @param loose the part is held by nothing (picked up off the ground to be fitted): there is nowhere to take it from */
  attachMod(this: Game, att: ItemInstance, weapon: ItemInstance, loose = false) {
    if (!this.attachTargets(att).includes(weapon)) return;
    if (!this.gunInHands(weapon, () => this.attachMod(att, weapon)) || this.weapons.busy) return;
    // (taken from wherever it is, and not fitted if it is nowhere: left in a bag in a pocket, a part was fitted and kept
    // as well, "so you can have flash light on all of your guns with one item", a player, 2026-10-15)
    if (!loose && !this.pluck(att)) return;
    if (ITEMS[att.id].mag) {
      // the one that was in it comes out, with what is left in it, and goes where there is room
      const out = swapMag(weapon, att);
      const left = out ? this.inv.add(out) : null;
      if (left) this.dropItem(left);
      // (heard by whoever is near as a magazine going in is, and seen as one)
      audio.ui('mag');
      this.act('reload', 0.9);
      this.hud.note(`${ITEMS[att.id].name} in the ${ITEMS[weapon.id].name}: ${weapon.loaded ?? 0} round${weapon.loaded === 1 ? '' : 's'} in it`, 'good');
      this.inventoryChanged();
      return;
    }
    (weapon.mods ??= []).push(att.id);
    audio.click(2600, 0.4, 0.03);
    audio.click(1900, 0.45, 0.05, 0.14);
    this.hud.note(`${ITEMS[att.id].name} fitted to ${ITEMS[weapon.id].name}`, 'good');
    this.inventoryChanged();
  },

  /**
   * A thing taken out of wherever this player reaches it from: what they wear or hold, their pockets and whatever
   * is in them however deep, the crate or body they have open, and a bag lying within reach (see openLying).
   * @returns whether it was there
   */
  pluck(this: Game, item: ItemInstance): boolean {
    const out = (list?: { item: ItemInstance }[]): boolean => {
      if (!list) return false;
      // (by its number: the thing asked for may be a copy of what is there now, the inventory made again since)
      const i = list.findIndex((p) => p.item === item || p.item.uid === item.uid);
      if (i >= 0) {
        list.splice(i, 1);
        return true;
      }
      return list.some((p) => out(p.item.cargo));
    };
    const worn = Object.values(this.inv.slots).find((w) => w?.uid === item.uid) ?? (this.inv.hand?.uid === item.uid ? this.inv.hand : null);
    if (worn) {
      this.inv.remove(worn);
      return true;
    }
    if (this.inv.containers.some((c) => out(c.items))) return true;
    if (this.openStash && out(this.openStash.container.items)) return true;
    return this.around().some((w) => this.lying.get(w.loot.uid) !== 'busy' && out(w.loot.item.cargo));
  },

  /**
   * A part comes off a gun.
   * @param loose it is handed back to whoever asked (the inventory, which puts it where it was let go) and not put in a pocket
   * @returns the part, when it was asked for loose
   */
  detachMod(this: Game, weapon: ItemInstance, mod: string, loose = false): ItemInstance | null {
    // (off a gun that is not in the hands: it is brought up, and the part then goes to a pocket)
    if (!this.gunInHands(weapon, () => void this.detachMod(weapon, mod)) || this.weapons.busy) return null;
    if (weapon.mag === mod) {
      // (its magazine: out with what is in it; the round in the chamber stays)
      const out = swapMag(weapon, null);
      audio.ui('mag');
      if (loose) {
        this.inventoryChanged();
        return out;
      }
      const left = out ? this.inv.add(out) : null;
      if (left) this.dropItem(left);
      this.inventoryChanged();
      return null;
    }
    if (!weapon.mods?.includes(mod)) return null;
    weapon.mods = weapon.mods.filter((m) => m !== mod);
    // rounds that no longer fit come back out
    const extra = (weapon.loaded ?? 0) - capacityOf(weapon);
    const part = makeItem(mod);
    const back: ItemInstance[] = loose ? [] : [part];
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
    return loose ? part : null;
  },

  /**
   * What the hands can do with what is in them, for the corner of the picture: the button and the word. One place,
   * beside `handFire` (which does it): a thing given a use there is given its word here.
   */
  handActs(this: Game): HandAct[] | null {
    if (this.player.dead || !this.started || this.invUI.isOpen || this.shop.isOpen || this.garage.ride) return null;
    // (at it already: what stops it)
    if (this.use) return this.holding ? [{ on: 'l', hold: true, text: 'Let go to stop' }] : [{ on: 'r', text: 'Stop' }];
    // (a grenade: until its pin is out the other button stops the hands; once it is out, only letting go is left)
    if (this.cook) return this.cook.live < 0 ? [{ on: 'r', text: 'Stop' }] : this.cook.button ? [{ on: 'l', hold: true, text: 'Let go to throw', sub: 'the pin is out' }] : null;
    const item = this.inHand;
    if (!item) return null;
    const def = ITEMS[item.id];
    const hold = !this.touch;
    let act: HandAct | null = null, wheel = 'Put away';
    if (def.throw) act = { on: 'l', hold: true, text: item.id === 'grenade' ? 'Pull the cord' : 'Pull the pin', sub: 'hold to cook it · let go to throw' };
    else if (def.mag) {
      const work = this.magWork(item);
      act = { on: 'l', hold, text: work === 'fill' ? 'Fill magazine' : 'Empty magazine', sub: work === 'fill' ? `${item.rounds ?? 0}/${def.mag.capacity} · ${this.inv.count(def.mag.ammo)} loose` : `${item.rounds ?? 0} in it` };
      wheel = work === 'fill' ? 'Empty it instead' : 'Fill it instead';
    } else if (def.open) act = { on: 'l', hold, text: 'Open the box', sub: `${def.open.qty} rounds` };
    else if (item.id === 'jerrycan') act = { on: 'l', hold, text: 'Pour it in', sub: this.lookedAt instanceof Jeep ? undefined : 'at a car' };
    else if (item.id === 'keycard') act = { on: 'l', hold, text: 'Put the card in', sub: 'at the reader' };
    else if (def.use?.sips && this.wellHere() && (item.left ?? 0) < def.use.sips) act = { on: 'l', hold, text: 'Fill it at the well' };
    else if (def.use) {
      const word = def.use.sound === 'eat' ? 'Eat' : def.use.sound === 'drink' ? 'Drink' : def.use.sound === 'bandage' ? 'Dress the wound' : def.use.sound === 'inject' ? 'Inject' : def.use.sound === 'smoke' ? 'Smoke' : 'Use';
      act = { on: 'l', hold, text: word, sub: def.use.sips ? `${item.left ?? def.use.sips}/${def.use.sips} left` : undefined };
    } else if (def.category === 'stash') act = { on: 'l', hold, text: 'Set it down' };
    return act ? [act, { on: 'w', text: wheel }] : [{ on: 'w', text: wheel }];
  },

  /** which of the two it is for this magazine, as things stand */
  magWork(this: Game, mag: ItemInstance): 'fill' | 'empty' {
    const d = ITEMS[mag.id].mag!;
    const canFill = (mag.rounds ?? 0) < d.capacity && this.inv.count(d.ammo) > 0, canEmpty = (mag.rounds ?? 0) > 0;
    return this.magMode ?? (canFill || !canEmpty ? 'fill' : 'empty');
  },

  /** The wheel (or its button) with a magazine held: the other of the two. @returns whether there was a magazine to turn it over for */
  turnMagWork(this: Game): boolean {
    const mag = this.inHand && ITEMS[this.inHand.id].mag ? this.inHand : null;
    if (!mag || this.use) return false;
    this.magMode = this.magWork(mag) === 'fill' ? 'empty' : 'fill';
    audio.ui('move');
    return true;
  },

  /**
   * Rounds thumbed out of a magazine into the pockets, one at a time, until it is empty, there is no more room
   * for them, or the hands are taken off it.
   */
  unloadMagazine(this: Game, mag: ItemInstance) {
    const d = ITEMS[mag.id].mag;
    if (!d || this.use || this.player.dead || this.weapons.working) return;
    if ((mag.rounds ?? 0) <= 0) return void this.hud.note('It is empty', 'info');
    if (!this.inv.hasRoom(makeItem(d.ammo, 1))) return void this.hud.note('No room in your pockets for loose rounds', 'warn');
    this.startUse(`Emptying the magazine · ${mag.rounds ?? 0} in it`, Game.ROUND_OUT, mag.id, 'unload', null, () => {
      if (!this.mine(mag) || (mag.rounds ?? 0) <= 0) return;
      const round = makeItem(d.ammo, 1);
      if (this.inv.add(round)) return void this.hud.note('No room in your pockets for loose rounds', 'warn');
      mag.rounds = (mag.rounds ?? 0) - 1;
      audio.ui('round');
      this.inventoryChanged();
      if ((mag.rounds ?? 0) > 0 && this.inv.hasRoom(makeItem(d.ammo, 1))) this.unloadMagazine(mag);
      else this.hud.note((mag.rounds ?? 0) > 0 ? `${mag.rounds} left in it: no room for more loose rounds` : `The ${ITEMS[mag.id].name.toLowerCase()} is empty`, 'good');
    }, 'load');
  },

  /**
   * Rounds pushed into a magazine out of the loose ones carried, one at a time, until it is full, there are no
   * more, or the hands are taken off it (anything that breaks an action off: what is in it by then stays in it).
   */
  fillMagazine(this: Game, mag: ItemInstance) {
    const d = ITEMS[mag.id].mag;
    if (!d || this.use || this.player.dead || this.weapons.working) return;
    const room = d.capacity - (mag.rounds ?? 0);
    if (room <= 0) return void this.hud.note('It is full', 'info');
    if (this.inv.count(d.ammo) <= 0) return void this.hud.note(`No ${ITEMS[d.ammo].name.toLowerCase()} to put in it`, 'warn');
    this.startUse(`Filling the magazine · ${mag.rounds ?? 0}/${d.capacity}`, Game.ROUND_IN, mag.id, 'load', null, () => {
      // (put down, sold or fitted meanwhile)
      if (!this.mine(mag)) return;
      if (this.inv.take(d.ammo, 1) !== 1) return;
      fillMag(mag, 1);
      audio.ui('round');
      this.inventoryChanged();
      // (and the next, for as long as there is one and room for it)
      if ((mag.rounds ?? 0) < d.capacity && this.inv.count(d.ammo) > 0) this.fillMagazine(mag);
      else this.hud.note(`${mag.rounds} in the ${ITEMS[mag.id].name.toLowerCase()}`, 'good');
    }, 'load');
  },

  /** The rounds out of a magazine and loose into the pockets (what there is no room for is put down). */
  emptyMagazine(this: Game, mag: ItemInstance) {
    const d = ITEMS[mag.id].mag, n = mag.rounds ?? 0;
    if (!d || n <= 0 || this.weapons.busy) return;
    mag.rounds = 0;
    const left = this.inv.add(makeItem(d.ammo, n));
    if (left) this.dropItem(left);
    audio.click(2200, 0.4, 0.03);
    audio.click(1500, 0.4, 0.04, 0.12);
    this.hud.note(`${n} × ${ITEMS[d.ammo].name} out of it`, 'good');
    this.inventoryChanged();
  },

  /** A stash as the game holds one: the case, the suitcase or the bag, as big inside as that thing is (see `stash` in src/sim/items.ts). */
  newStash(this: Game, s: StashInfo): Stash {
    const def = s.item && ITEMS[s.item]?.category === 'stash' ? ITEMS[s.item] : ITEMS.stash_kit;
    const [w, h] = def.stash ?? [8, 6];
    const st = new Stash(s.uid, s.x, s.y, s.z, s.rot, w, h, def.id === 'stash_kit' ? 'Stash Crate' : def.name);
    st.item = def.id;
    st.buried = !!s.buried;
    return st;
  },

  /**
   * A shovel put to a case, a suitcase or a bag lying on the ground, or to a place where one is buried, the left
   * button held: so many seconds of digging, and it is under the ground with what is in it (or up out of it, lying
   * there again). The spade goes in for as long as that takes; let go of the button, put the shovel away or walk
   * off, and the digging stops there with nothing done.
   */
  dig(this: Game, what: WorldItem | Stash) {
    const p = this.player;
    const { world } = this.s;
    const bury = what instanceof WorldItem;
    const at = bury ? what.loot : what, uid = bury ? what.loot.uid : what.uid;
    const no = bury ? noBurying(at.x, at.y, at.z, heightAt(world.heights, at.x, at.z), world.pois, world.buildings) : null;
    if (no) return void this.hud.note(no, 'warn');
    const there = () => (bury ? this.loot.items.get(uid) === what : this.loot.stashes.includes(what as Stash));
    const still = () => this.input.held('Mouse0') && this.weapons.equippedItem?.id === 'shovel' && there() && Math.hypot(at.x - p.pos.x, at.z - p.pos.z) <= BURY.reach - 0.5;
    this.use = { label: bury ? 'Burying it' : 'Digging it up', t: 0, dur: DIG_SECONDS, sound: null, soundT: 0, valid: still, lost: 'You stopped digging', dig: 0, done: () => {
      if (!there()) return;
      if (this.online) return void this.net.send({ t: 'bury', uid, on: bury });
      // (playing alone: there is nobody to ask)
      if (bury) {
        const l = this.economy.take(uid);
        if (!l) return;
        const st = this.newStash({ uid, x: l.x, y: heightAt(world.heights, l.x, l.z), z: l.z, rot: l.rot, item: l.item.id, buried: true });
        const items = (l.item.cargo ?? []).map((q) => ({ ...q.item, x: q.x, y: q.y, rot: q.rot }));
        if (items.length) st.container.load({ items });
        void this.loot.addStash(st).then(() => this.save());
      } else {
        const st = what as Stash;
        this.loot.removeStash(st);
        this.economy.drop(this.stashItem(st), st.x, st.y + 0.02, st.z, st.rot);
        this.save();
      }
    } };
  },

  /** what is under the ground at a stash, as the thing it is when it lies on it: the case, the suitcase or the bag, with what is in it */
  stashItem(this: Game, st: Stash): ItemInstance {
    const it = makeItem(ITEMS[st.item]?.category === 'stash' ? st.item : 'stash_kit', 1);
    it.uid = st.uid;
    const items = st.container.serialize().items as StoredItem[];
    if (items.length) it.cargo = items.map(({ x, y, rot, ...item }) => ({ item, x, y, rot }));
    return it;
  },

  nearbyStash(this: Game): Stash | null {
    // (nothing is searched from a jeep's seat)
    if (this.garage.ride) return null;
    // (what is under the ground is not opened: it is dug up first)
    if (this.focus instanceof Stash) return this.focus.buried ? null : this.focus;
    const p = this.player.pos;
    let best: Stash | null = null;
    let bd = 2.2;
    for (const s of [...this.loot.stashes.filter((q) => !q.buried), ...this.loot.crates, ...[...this.corpses.values()].map((c) => c.stash), ...[...this.drops.values()].map((d) => d.stash)]) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd && Math.abs(s.y - p.y) < 1.5) {
        bd = d;
        best = s;
      }
    }
    return best;
  },

  /**
   * @param byEscape closed with Escape. A browser will not give the mouse back on that key
   *   (only on a click), and sending the player to the pause menu for closing their pockets
   *   was the wrong answer: the game carries on, and the next click takes the mouse.
   */
  /** where the map shows a drop: the ones standing, and the places one has been called to */
  markDrops(this: Game) {
    this.minimap.setDrops([...[...this.drops.values()].map((x) => x.at), ...this.calls.map((c) => c.at)]);
  },

  /** nothing between the player and the sky: a radio is heard from there, and a crate can come down there */
  openSky(this: Game) {
    const p = this.player.pos;
    return physics.raycast({ x: p.x, y: p.y + 1.7, z: p.z }, { x: 0, y: 1, z: 0 }, 60, SIGHT_GROUPS) === null;
  },

  /** the radio keyed: the call goes out, and the set is good for the one call if it is answered */
  callDrop(this: Game, item: ItemInstance) {
    if (!this.openSky()) {
      this.hud.note('No signal under a roof: take the radio out under open sky', 'warn');
      return;
    }
    this.radio = item;
    if (this.online) {
      this.net.send({ t: 'radio' });
      return;
    }
    // (playing alone: there is nobody to refuse it, and the game sets the crate down itself)
    const p = callSite(this.s.world, this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.yaw);
    this.flightBegun(planFlight((x, z) => heightAt(this.s.world.heights, x, z), p, `drop-call-${newUid()}`), false, true);
  },

  /**
   * A helicopter has appeared on the map's edge with a supply drop (the server says so; playing alone, this game
   * does): it is set flying, the place is marked on the map and under smoke until the crate is down, and whoever
   * plays is told where it is for, which way it is coming from, and when it will be on the ground.
   * @param late it was in the air already when this game came in
   * @param mine this player called it on a radio (whose set is spent)
   */
  flightBegun(this: Game, f: Flight, late = false, mine = false) {
    this.airdrops.begin(f);
    const left = flightTimes(f).land - f.age;
    // (down already: its crate is told of as a drop standing, and only the helicopter is left to see)
    if (left <= 0) return;
    const where = describeSpot(this.s.world, f.x, f.z), way = comesFrom(f), eta = Math.max(1, Math.round(left));
    this.calls.push({ at: new THREE.Vector3(f.x, f.y, f.z), until: performance.now() + left * 1000, smoke: { owed: 0 } });
    this.markDrops();
    if (mine && this.radio) {
      this.inv.remove(this.radio);
      this.radio = null;
      this.inventoryChanged();
    }
    if (mine) this.hud.note(`Drop called in: a helicopter is coming from the ${way}. The crate is down in ${eta} s, ahead of you, under the smoke. Everybody heard it`, 'good');
    // (and whoever is near enough to see it is told when it leaves the helicopter: it is ninety metres up, where nobody is looking)
    const away = (flightTimes(f).release - f.age) * 1000;
    if (away > 0) setTimeout(() => {
      if (this.started && !this.player.dead && Math.hypot(this.player.pos.x - f.x, this.player.pos.z - f.z) < 160) this.hud.note('The crate is away, coming down under its parachute: look up', 'good');
    }, away);
    else if (f.by !== undefined) this.hud.note(`Somebody has called a supply drop in ${where}: a helicopter is coming from the ${way}, down in ${eta} s`, 'warn');
    else if (late) this.hud.note(`A helicopter is in the air with a supply drop for ${where}: down in ${eta} s, marked on the map (M)`, 'good');
    else this.hud.note(`A helicopter is coming in from the ${way} with a supply drop for ${where}: down in ${eta} s, marked on the map (M)`, 'good');
    this.hud.feed(f.by !== undefined ? `Supply drop called in ${where}: helicopter from the ${way}` : `Helicopter from the ${way}: supply drop for ${where}`);
    if (!late && f.by === undefined) this.hud.chatLine('system', '', `A helicopter is coming in from the ${way} with a supply drop for ${where}.`);
  },

  /** the crate of a flight has touched the ground: it is heard, and (playing alone, with nobody else to set it down) the crate that stays is stood there */
  dropLanded(this: Game, f: Flight) {
    const at = new THREE.Vector3(f.x, f.y, f.z);
    audio.bodyFall(at, at.distanceTo(this.s.r.camera.position));
    if (!this.online) void this.addDrop({ uid: f.uid, x: f.x, y: f.y, z: f.z, rot: restAt(f.uid), left: DROP.life }, true);
  },

  /** today's page of the trader's work for this player (a new day is a clean page) */
  jobBook(this: Game): JobBook {
    let kept: Partial<JobBook> | null = null;
    try {
      kept = JSON.parse(localStorage.getItem('zona.jobs') ?? 'null');
    } catch {
      // (nothing kept, or nothing that can be read: a clean page)
    }
    return bookFor(dayOf(Date.now()), kept);
  },

  keepBook(this: Game, book: JobBook) {
    try {
      localStorage.setItem('zona.jobs', JSON.stringify(book));
    } catch {
      // (a browser that keeps nothing)
    }
  },

  setCredit(this: Game, n: number) {
    this.credit = Math.max(0, Math.round(n));
    try {
      localStorage.setItem('zona.credit', String(this.credit));
    } catch {
      // (a browser that keeps nothing: the book is good until the page is shut)
    }
  },

  openShop(this: Game) {
    if (this.shop.isOpen || this.invUI.isOpen) return;
    this.input.releaseAll();
    this.shop.open();
    this.input.uiMode = true;
    this.input.unlock();
    audio.ui('open');
  },

  /**
   * The map, opened large or put away. Open, the mouse is let go (the sheet is pointed at, brought nearer, dragged
   * about) and nothing is fired or looked round at; the feet still go where the keys send them, as with the
   * inventory open.
   */
  toggleMap(this: Game, open?: boolean, byEscape = false) {
    const want = open ?? !this.map.open;
    if (want === this.map.open) return;
    // (no map in the arena: "this is gonna be more like CS:GO")
    if (want && this.arenaHud) return;
    if (want) {
      this.map.show(this.player.pos.x, this.player.pos.z);
      this.input.uiMode = true;
      this.input.unlock();
      audio.ui('open');
      return;
    }
    this.map.hide();
    // (shut because the inventory was opened over it: the mouse stays free, for that)
    if (this.invUI.isOpen || this.shop.isOpen) return;
    this.input.uiMode = false;
    if (byEscape && !this.input.touch) this.awaitClick = true;
    else if (this.started && !this.paused) this.input.lock();
    // if the browser refuses the re-capture, the next click on the game takes it (see awaitClick)
    setTimeout(() => {
      if (this.started && !this.paused && !this.invUI.isOpen && !this.shop.isOpen && !this.map.open && !this.input.locked && !this.player.dead) this.awaitClick = true;
    }, 400);
    audio.ui('close');
  },

  toggleInventory(this: Game, open?: boolean, byEscape = false) {
    const want = open ?? !this.invUI.isOpen;
    if (want === this.invUI.isOpen) return;
    // (nor pockets: Tab is the scoreboard there)
    if (want && this.arenaHud) return;
    if (want) {
      this.openStash = this.nearbyStash();
      this.openLying();
      this.invUI.open(this.around(), this.openStash, this.player.vitals);
      if (this.garage.ride && this.loot.near(this.player.pos, 2.3).length) this.hud.note('Nothing is picked up from a seat: get out for it', 'info');
      // (offline, a piece of furniture is given what the economy has put in it since it was last opened)
      if (!this.online && this.openStash && economyCargo(this.openStash.kind)) this.fillCrate(this.openStash);
      if (this.online && this.openStash) {
        // the server holds what is inside; show it once it answers
        this.invUI.setStashState('Opening…');
        this.net.send({ t: 'copen', cid: this.openStash.uid });
      }
      // (going through something is heard by whoever is near, as the lockers' doors are seen, but of an admin vanished: see SEARCHED)
      if (this.online && !this.powers.hidden && (this.openStash || this.lying.size)) this.act('open', SEARCHED.hands);
      this.input.uiMode = true;
      this.input.unlock();
      audio.ui('open');
    } else {
      if (this.online && this.openStash) {
        this.syncOpenBox();
        this.net.send({ t: 'cclose', cid: this.openStash.uid });
      }
      this.closeLying();
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
  },
};
