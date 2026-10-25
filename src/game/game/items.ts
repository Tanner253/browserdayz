// The game: using things (eating, healing, reading, the radio) and the emote wheel.
// (Methods of Game cut out of game.ts whole on 2026-10-14, so that they can be read and worked on alone: put back on
// Game.prototype as the file loads. Nothing in them was changed but `this: Game` said as the first parameter.)

import * as THREE from 'three';
import { physics, SIGHT_GROUPS, SOLID_GROUPS } from '../../core/physics';
import { audio } from '../../core/audio';
import type { Input } from '../../core/input';
import type { Barrel } from '../../world/vegetation';
import { type ItemInstance, ITEMS, makeItem, chambered, swapMag, isBag, itemName } from '../../sim/items';
import { BLADES, bandagesFrom, cuttable } from '../../sim/condition';
import type { Container } from '../../sim/inventory';
import { WEAPON_RULES } from '../../sim/combat';
import { THROWN, fuseLeft, NADE, inHandDamage } from '../../sim/grenades';
import { BARREL } from '../../sim/barrels';
import { EMOTE, EMOTE_GAP, voiceOf, SAY_TIME, SAY_RANGE } from '../../sim/emotes';
import { Radial } from '../../ui/radial';
import { wheelSlots } from '../../ui/wheel-slots';
import { playerName } from '../../net/client';
import { type Act, MAX_STAMINA } from '../../net/protocol';
import { woundOf } from '../../sim/blood';
import type { Hold } from '../avatar';
import type { UseKind } from '../weapons';
import type { WorldItem } from '../loot';
import { type Well, WELL } from '../../sim/wells';
import { waterName, type Drink } from '../../sim/water';
import { FIRE } from '../../sim/fires';
import { heightAt } from '../../world/worldgen';
import { COOKS, COOK_KINDS, FUEL, HEAT, cookable, mealOf, rotten, stageOf } from '../../sim/cooking';
import { POISON, fallsIll } from '../../sim/sickness';
import { WHEEL_REACH, type TimedAction, type Game } from '../game';
import { chosen } from '../survivors';

export const itemsMethods = {
  // ------------------------------------------------------------ item actions

  /** @param seen what the people around are told the hands are doing, where that is not what `kind` says (see ACTS) */
  startUse(this: Game, label: string, dur: number, itemId: string, kind: UseKind, sound: TimedAction['sound'], done: () => void, seen?: Act) {
    this.toggleInventory(false);
    this.use = { label, t: 0, dur, sound, soundT: 0, done };
    this.weapons.beginUse(itemId, kind, dur);
    // (what everybody else sees of an injection is the hands at work on a wound, as with a dressing)
    this.act(seen ?? (kind === 'inject' ? 'bandage' : kind === 'smoke' ? 'eat' : kind === 'swipe' || kind === 'live' ? 'open' : kind === 'unload' ? 'load' : kind === 'drip' ? 'bandage' : kind), dur);
    // (a smoke is one sound from the lighter to the last breath of it, made once)
    if (sound === 'smoke') audio.ui('smoke');
  },

  /** the raw meat carried that has not gone off: what can be put on a fire (src/sim/cooking.ts) */
  rawMeat(this: Game): ItemInstance[] {
    const now = Date.now() / 1000;
    return this.inv.containers.flatMap((c) => c.items).map((p) => p.item).filter((it) => COOKS[it.id]?.how === 'cook' && stageOf(it) === 'raw' && !rotten(it, now));
  },

  /**
   * Raw meat put on a lit fire, as many as its stones take (COOK_KINDS.campfire: four), for as long as its recipe
   * says, by whoever stays beside it: then it is cooked, and hot (a meal hot does more good: HEAT). Walk off, or let
   * the fire die, and it comes off as it was. DayZ's fireplace, without a screen for its slots.
   */
  grill(this: Game, fi: number) {
    const kind = COOK_KINDS.campfire, many = kind.food![0] * kind.food![1];
    const meat = this.rawMeat().slice(0, many);
    if (!meat.length || this.use) return;
    this.putAway();
    this.toggleInventory(false);
    const dur = Math.max(...meat.map((it) => COOKS[it.id].takes - (it.cook ?? 0))) / kind.speed;
    const near = () => this.fires.left[fi] > 0 && this.fires.at(this.player.pos) === fi;
    this.use = { label: `Cooking ${meat.length === 1 ? ITEMS[meat[0].id].name : `${meat.length} pieces of meat`} on the fire`, t: 0, dur, sound: null, soundT: 0, valid: near, lost: 'You walked off from the fire', done: () => {
      if (!near()) return;
      const now = Date.now() / 1000;
      let n = 0;
      for (const it of meat) {
        if (!this.mine(it)) continue;
        it.cook = COOKS[it.id].takes;
        it.hot = now + HEAT.keeps;
        n++;
      }
      if (n) this.hud.note(`Cooked ${n === 1 ? 'one piece' : `${n} pieces`} of meat: eat it hot and it does more good`, 'good');
      this.inventoryChanged();
    } };
  },

  /** every bottle carried (see `sips` in src/sim/items.ts): in the pockets, and in what is worn */
  bottles(this: Game): ItemInstance[] {
    return this.inv.containers.flatMap((c) => c.items).map((p) => p.item).filter((it) => !!ITEMS[it.id].use?.sips);
  },

  /** A few seconds at a well, or at the river, a lake or the swamp, the same: thirst gone. */
  drinkAt(this: Game, w: Well | Drink) {
    this.putAway();
    this.toggleInventory(false);
    const near = this.waterNear(w), well = 'town' in w;
    // (Out of cupped hands. A bottle is filled by holding it here and holding the button: see fillBottle. Walk off
    // and the drinking stops there: it was finished from across the yard, by having begun it at the well.)
    const label = well ? 'Drinking at the well' : `Drinking from the ${waterName(w)}`;
    this.use = { label, t: 0, dur: WELL.drink, sound: 'drink', soundT: 0, valid: near, lost: well ? 'You walked off from the well' : 'You walked off from the water', done: () => {
      if (!near()) return;
      this.player.vitals.water = 100;
      this.meDirty = true;
      this.hud.note('You drink your fill', 'good');
    } };
    this.act('drink', WELL.drink);
  },

  /** A few seconds of work at a fireplace, and it is alight: for everybody, once the server has been told. */
  lightFire(this: Game, i: number) {
    this.startUse('Lighting the fire', FIRE.lighting, 'cigarettes', 'open', null, () => {
      const p = this.player.pos;
      // (somebody else got it going first)
      if (this.fires.at(p) !== i || this.fires.left[i] > 0) return;
      if (this.online) this.net.send({ t: 'fire', i });
      else if (this.hearths.light(i, p.x, p.z, performance.now() / 1000)) this.fires.set(i, FIRE.burns);
      audio.ui('open');
      this.hud.note('The fire is lit: its smoke can be seen a long way off', 'good');
    });
    // (walk off from it and the hands stop: a fire is not lit from across the yard)
    if (this.use) Object.assign(this.use, { valid: () => this.fires.at(this.player.pos) === i, lost: 'You walked off from the fireplace' });
  },

  /**
   * Firewood used (src/sim/fires.ts FIRE.built): at a fire that is alight, put on it, five minutes more; anywhere
   * else on open ground, a campfire built a step ahead, alight. True: it was used.
   */
  burnWood(this: Game): boolean {
    const p = this.player.pos, now = performance.now() / 1000, at = this.fires.at(p);
    if (at >= 0 && this.fires.left[at] > 0) {
      if (this.online) this.net.send({ t: 'feed', i: at });
      else if (this.hearths.feed(at, FUEL.firewood, p.x, p.z, now)) this.fires.set(at, this.hearths.left(at, now));
      this.hud.note('More wood on the fire: it burns five minutes longer', 'good');
      return true;
    }
    const ground = (x: number, z: number) => heightAt(this.s.world.heights, x, z);
    const x = p.x - Math.sin(this.player.yaw) * 1.2, z = p.z - Math.cos(this.player.yaw) * 1.2, y = ground(x, z);
    // (on the ground, not on a floor or a roof: a fire is built out of doors)
    if (Math.abs(p.y - y) > 0.8 || this.garage.ride) {
      this.hud.note('Build a fire on open ground', 'warn');
      return false;
    }
    if (this.online) this.net.send({ t: 'build', x, y, z });
    else {
      const i = this.hearths.build(x, y, z, 1, now);
      if (i < 0) return false;
      this.fires.add(i, x, y, z, ground);
      this.fires.set(i, this.hearths.left(i, now));
    }
    this.hud.note('A fire built and lit: its smoke can be seen a long way off', 'good');
    return true;
  },

  /** wherever the item currently is: player inventory or the open crate */
  consume(this: Game, item: ItemInstance, from: Container | null) {
    const def = ITEMS[item.id];
    if (def.stack && item.qty > 1) {
      item.qty--;
      return;
    }
    this.inv.remove(item);
    from?.remove(item);
  },

  /** Eat, drink, apply or open a thing where it lies (the inventory's right-click on the ground list). */
  onGround(this: Game, w: WorldItem, how: 'use' | 'open') {
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
    // (in the hands while it is used, as in DayZ, and kept there if anything is left of it; with no room to put away
    // what the hands held, it goes back where it lay)
    if (!this.inv.hold(item)) {
      this.dropItem(item);
      return void this.hud.note(this.handsFull(), 'warn');
    }
    this.showHands(true);
    this.inventoryChanged();
    if (how === 'use') this.useItem(item, true);
    else this.openBox(item);
    if (this.use) this.ready = null;
  },

  /** Is this thing the survivor's: carried somewhere on them, the hands among it? */
  mine(this: Game, item: ItemInstance) {
    return !!this.inv.find((i) => i === item);
  },

  /** A thing that is not a weapon, held out: put away (`emptyHands`); only no longer drawn, if it has left the hands already or the hands are dead. */
  putAway(this: Game) {
    if (!this.ready && !this.inHand) return;
    if (this.inv.held() === this.inHand && !this.player.dead) return void this.emptyHands();
    this.stow();
    this.showHands();
  },

  /**
   * Whatever the hands are in the middle of is broken off, and nothing is lost by it: what was being eaten,
   * drunk or put on is kept whole, an injector goes back where it was, a magazine is not counted out.
   * (The wheel; on a phone, the weapon button.)
   * @returns whether there was anything to break off
   */
  breakOff(this: Game): boolean {
    if (this.use) {
      // (digging: the stroke in hand stops where it is)
      if (this.use.dig !== undefined) this.weapons.endDig();
      this.use = null;
      this.act('stop');
      if (!this.player.dead && !this.holding) this.hud.note('Cancelled', 'info');
      // (a thing that was in the hands to begin with stays in them: only what the hands were doing with it stops)
      if (this.inHand) this.rest();
      else this.weapons.endUse();
      return true;
    }
    if (this.ready) {
      this.putAway();
      return true;
    }
    return this.weapons.abortReload();
  },

  /** @param now an injector already in the hand: the click that uses it */
  useItem(this: Game, item: ItemInstance, now = false) {
    const def = ITEMS[item.id];
    if (!def.use || this.use || this.cook || this.player.dead || this.weapons.working) return;
    if (def.look && performance.now() - this.glassDown < 150) return;
    const u = def.use;
    // (an empty bottle is kept, and says where it is filled)
    if (u.sips && (item.left ?? u.sips) <= 0) {
      this.hud.note(`The ${def.name.toLowerCase()} is empty: a well fills it (marked on the map)`, 'info');
      return;
    }
    // (something is in the hand already and this is another thing, asked for out of the inventory: that one is put away)
    if (this.inHand && this.inHand !== item) this.putAway();
    // (asked before it is taken out of anything: refused after, the radio was out of the crate and nowhere)
    if (def.call && !this.openSky()) {
      this.hud.note('No signal under a roof: take the radio out under open sky', 'warn');
      return;
    }
    const from = this.openStash?.container.has(item) ? this.openStash.container : null;
    if (from) {
      // (into the hands and out of the crate, so the crate can be shut while it is used: what is left of it afterwards
      // stays in them, as in DayZ)
      if (!def.look && !def.call) {
        if (!this.inv.hold(item)) return void this.hud.note(this.handsFull(), 'warn');
        this.showHands();
        this.ready = null;
      }
      from.remove(item);
      this.syncOpenBox();
    }
    // (what is used from the hand is taken into it first, and used by the button: see takeUp and handFire)
    if (u.hold && !now) {
      this.toggleInventory(false);
      this.takeUp(item);
      return;
    }
    // (A grenade is not used over a time as other things are: its pin is pulled, and from then it is live. With the
    // button that began it still down, it is held; chosen out of the pockets, it is thrown the moment the pin is out.)
    if (def.throw) return this.pullPin(item, now);
    // how the hands hold it while it is used: a smoke goes to the mouth, a radio is worked with both, a bag of blood lies in the palm as a roll of dressing does
    const kind: UseKind = def.call ? 'open' : def.look ? 'drink' : isBag(item.id) ? 'drip' : u.sound;
    const sound: TimedAction['sound'] = def.look || def.call ? null : u.sound;
    this.glass = 0;
    this.startUse(def.look ? 'Binoculars' : def.call ? 'Calling a drop in' : `${u.verb} ${def.name}`, u.time, item.id, kind, sound, () => {
      if (def.call) {
        if (from) this.inv.add(item);
        this.callDrop(item);
        return;
      }
      if (def.look) {
        // kept, and held up: see the frame loop for what puts them down again
        if (from) this.inv.add(item);
        this.glass = def.look;
        return;
      }
      if (item.id === 'firewood') {
        if (this.burnWood()) this.consume(item, null);
        else if (from && !this.mine(item)) this.inv.add(item);
        this.inventoryChanged();
        return;
      }
      const v = this.player.vitals;
      // (hot, beside a fire, what is eaten or drunk does more good; and what cooks gives what its stage is worth: raw
      // meat a quarter, and as likely as not food poisoning; anything rotten little, and poisoning for sure: cooking.ts)
      const hot = (u.energy ?? 0) > 0 || (u.water ?? 0) > 0 ? (this.fires.warm(this.player.pos) ? FIRE.meal : 1) : 1;
      const meal = cookable(item) ? mealOf(item, Date.now() / 1000, hot) : null;
      const energy = meal ? meal.energy : u.energy ? (u.energy > 0 ? Math.round(u.energy * hot) : u.energy) : 0;
      const water = meal ? meal.water : u.water ? (u.water > 0 ? Math.round(u.water * hot) : u.water) : 0;
      const health = meal ? meal.health : (u.health ?? 0);
      if (energy) v.energy = THREE.MathUtils.clamp(v.energy + energy, 0, 100);
      if (water) v.water = THREE.MathUtils.clamp(v.water + water, 0, 100);
      if (health > 0) v.health = Math.min(100, v.health + health);
      else if (health < 0) this.player.sicken(-health, rotten(item, Date.now() / 1000) || !cookable(item) ? 'rotten food' : 'raw meat');
      if (meal && fallsIll(meal.sick, !!v.guard, Math.random())) {
        v.ill = Math.max(v.ill ?? 0, POISON.lasts);
        this.hud.note('Your stomach turns: food poisoning. Charcoal tablets will settle it', 'warn');
        this.meDirty = true;
      }
      if (u.cures) {
        this.hud.note(v.ill ? 'The charcoal settles your stomach' : 'Nothing to settle: the tablets are gone all the same', v.ill ? 'good' : 'info');
        v.ill = undefined;
        this.meDirty = true;
      }
      if (u.guard) {
        v.guard = u.guard;
        this.hud.note(`Vitamins: for ${Math.round(u.guard / 60)} minutes bad food is half as likely to make you ill`, 'good');
        this.meDirty = true;
      }
      if (u.stamina) v.stamina = Math.min(MAX_STAMINA, v.stamina + (MAX_STAMINA * u.stamina) / 100);
      if (u.boost) {
        this.player.boost = u.boost;
        this.hud.note(`Adrenaline: nothing costs you breath for ${u.boost} seconds`, 'good');
      }
      if (u.stopBleed && v.bleeding) {
        this.player.staunch();
        this.hud.note('The bleeding has stopped', 'good');
        this.meDirty = true;
      }
      if (u.blood) {
        this.player.transfuse(u.blood, u.over ?? 1);
        this.hud.note(v.bleeding ? `The bag is running in, and you are still bleeding: it will run out of you again` : `The bag is running in: ${u.blood} ml of blood over ${u.over ?? 1} seconds`, v.bleeding ? 'warn' : 'good');
        this.meDirty = true;
      }
      if (u.splint) {
        if (v.broken) this.player.setLeg(true);
        else if (!u.stopBleed) this.hud.note('Nothing is broken: the tape is used up all the same', 'info');
      }
      const gained = [energy ? `${energy > 0 ? '+' : ''}${energy} food` : '', water ? `${water > 0 ? '+' : ''}${water} water` : '', health ? `${health > 0 ? '+' : ''}${health} health` : ''].filter(Boolean).join(' · ');
      if (gained) this.hud.note(meal?.hot ? `${gained} · hot` : hot > 1 ? `${gained} · warmed by the fire` : gained, health < 0 ? 'warn' : 'good');
      if (u.sound === 'smoke') {
        // what is left of it, in front of the face
        const cam = this.s.r.camera;
        this.effects.muzzle(cam.position.clone().add(new THREE.Vector3(0, -0.12, -0.35).applyQuaternion(cam.quaternion)), new THREE.Vector3(0, 0.3, -1).applyQuaternion(cam.quaternion), true, true);
      }
      // (a bottle is one drink the emptier, and is kept)
      if (u.sips) item.left = Math.max(0, (item.left ?? u.sips) - 1);
      else this.consume(item, null);
      this.inventoryChanged();
    });
  },

  /** The hands begin on a grenade's pin (a stick grenade's cord). */
  pullPin(this: Game, item: ItemInstance, button: boolean) {
    const kind = THROWN[item.id];
    if (!kind || this.cook || this.use || this.player.dead || this.weapons.working) return;
    this.toggleInventory(false);
    this.glass = 0;
    this.ready = null;
    this.holding = false;
    this.cook = { item, id: item.id, t: 0, live: -1, button };
    // (worked with both hands, as it was: the left has it, the right is at its pin; everybody near sees hands at work)
    this.weapons.beginUse(item.id, 'open', kind.pull);
    this.act('open', kind.pull);
  },

  /** Every frame there is a grenade in the hands being made live, or live: see `cook`. */
  cooking(this: Game, dt: number, input: Input, uiOpen: boolean) {
    const c = this.cook!, kind = THROWN[c.id], p = this.player;
    c.t += dt;
    if (c.button && (uiOpen || !input.held('Mouse0'))) c.button = false;
    if (c.live < 0) {
      const stop = (input.pressed('Mouse2') || input.wheel !== 0) && !uiOpen;
      if (p.dead || stop || !this.mine(c.item)) {
        if (stop) input.wheel = 0;
        this.cook = null;
        this.act('stop');
        if (stop && !p.dead) this.hud.note('Cancelled', 'info');
        // (a thing that was in the hands to begin with stays in them: only what the hands were doing with it stops)
        if (this.inHand) this.rest();
        else this.weapons.endUse();
        return;
      }
      if (c.t < kind.pull) return;
      // The pin is out. The fuse runs from here, by this game's count and by the server's from when it hears.
      c.live = c.t - kind.pull;
      this.consume(c.item, null);
      this.inventoryChanged();
      this.net.send({ t: 'pin', w: c.id });
      // (in the one fist now, drawn back to throw: see 'live' in weapons.ts)
      this.weapons.beginUse(c.id, 'live', kind.fuse);
    } else c.live += dt;
    const left = fuseLeft(c.id, c.live);
    // Whoever dies with the pin out lets go of it: it falls where they fell, lies there, and goes off when its fuse
    // ends, for whoever is in reach (the ruling of 2026-10-13: as in DayZ, it does not go with them). Online it is
    // the server that says so to everybody else and reckons whom it reached (`fallen` in src/sim/grenades.ts): here
    // it is only seen to fall, from the same place and as still, so that it lies where everybody else has it lying.
    // Played alone, this game reckons it, as it does everything.
    if (p.dead) {
      this.emptyOfGrenade();
      this.grenades.throw(new THREE.Vector3(p.pos.x, p.pos.y + NADE.hand, p.pos.z), new THREE.Vector3(), left, !this.online, c.id);
      return;
    }
    if (left > 0 && c.button) return;
    const cam = this.s.r.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    // where the hand is: a little ahead of the eye, to the right and below it
    const o = cam.position.clone().addScaledVector(dir, 0.5).add(new THREE.Vector3(0.18, -0.1, 0).applyQuaternion(cam.quaternion));
    this.emptyOfGrenade();
    if (left <= 0) {
      // Held to the end of its fuse: it goes off in the hand. (Said to the server as a grenade that has left the
      // hand and is not moving: it has counted the fuse itself, and knows what that means.)
      this.net.send({ t: 'nade', o: o.toArray(), v: [0, 0, 0] });
      this.explode(o, true, c.id === 'frag' ? 'frag' : 'grenade', undefined, true);
      return;
    }
    // thrown, not dropped: forward and up, plus whatever the thrower was doing
    const v = dir.multiplyScalar(NADE.speed).add(new THREE.Vector3(p.vel.x, NADE.lift + Math.max(0, p.vel.y), p.vel.z));
    this.grenades.throw(o, v, left, true, c.id);
    this.net.send({ t: 'nade', o: o.toArray(), v: v.toArray() });
    this.avatar.swing(true);
    audio.whoosh(0.5);
  },

  /**
   * What the line under the crosshair says of a grenade in the hands: the pin coming out, as anything the hands
   * are at is shown; and then the fuse, a bar that runs DOWN, in red, with the seconds left before its words and
   * the biggest thing in them. (How long is left is the one thing whoever is cooking it has to know, and it is
   * nowhere else: the grenade makes no sound. How it is drawn, to be read over grass and over snow: `.hot` in hud.css.)
   */
  cookShown(this: Game): { label: string; t: number; hot?: boolean; figure?: string } {
    const c = this.cook!, kind = THROWN[c.id];
    if (c.live < 0) return { label: c.id === 'grenade' ? 'Pulling the cord' : 'Pulling the pin', t: c.t / kind.pull };
    const left = fuseLeft(c.id, c.live);
    return { label: `${ITEMS[c.id].name} live`, figure: left.toFixed(1), t: left / kind.fuse, hot: true };
  },

  /** the grenade is out of the hands, thrown or gone off or gone with them: they are empty */
  emptyOfGrenade(this: Game) {
    this.cook = null;
    if (this.inHand) this.rest();
    else this.weapons.endUse();
  },

  /** Where the gun is pointing, as pixels off the middle of the screen (see Weapons.lag). */
  lagPx(this: Game): [number, number] {
    const cam = this.s.r.camera, lag = this.weapons.lag;
    const k = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    return [-Math.tan(lag.x) * k, -Math.tan(lag.y) * k];
  },

  /** From the wheel: call something out, or start (or stop) something the body keeps up. */
  emote(this: Game, id: string) {
    const e = EMOTE[id], p = this.player;
    if (!e || p.dead || this.use) return;
    if (e.hold) {
      // (picked again, it stops: one of the pack's dances is told from the body's own by its clip)
      const on = this.hold === e.hold && (this.danced ?? null) === (e.clip ?? null);
      this.setHold(on ? null : e.hold, e.clip ?? null);
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
    audio.shout(id, undefined, 0, chosen(playerName()).voice, voiceOf(playerName()));
    this.hud.note('“' + e.say + '”');
    this.net.send({ t: 'emote', e: id });
  },

  /** @param clip one of the emote pack's movements, danced in place of the body's own dance (src/sim/emotes.ts) */
  setHold(this: Game, h: Hold | null, clip: string | null = null) {
    if (h !== 'dance') clip = null;
    if (h === this.hold && clip === this.danced) return;
    const p = this.player;
    // (nobody dances crouched, or in the air)
    if (h && p.prone) return void this.hud.note('Get up first', 'warn');
    if (h === 'sit' && p.crouched) p.setCrouch(false);
    if (h && (!p.grounded || (h === 'dance' && p.crouched))) {
      this.hud.note(p.grounded ? 'Stand up to dance' : 'Not in the air', 'warn');
      return;
    }
    this.hold = h;
    this.danced = clip;
    p.sat = h === 'sit';
    this.avatar.setHold(h);
    this.avatar.setClip(clip, !!(clip && EMOTE[clip]?.once));
    if (h) {
      this.armsUntil = 0;
      this.avatar.emote(null);
      // (one played once is over before it could be read)
      if (!(clip && EMOTE[clip]?.once)) this.hud.note(h === 'dance' ? 'Dancing · move to stop' : h === 'sit' ? 'Sat down · move to get up' : 'Hands up · move to stop');
    }
  },

  /** T held: the mouse picks from the wheel instead of turning the head, and letting go does it. */
  updateWheel(this: Game, ok: boolean, now: number) {
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
    // the first entry is at the top, the rest follow clockwise (as the player has set them in Emotes), round Cancel at
    // the bottom of the outer ring: the way the mouse has gone says the wedge, how far it has gone says the ring
    const slots = wheelSlots(), pick = this.hud.wheelPick([at.x, at.y]);
    // a click while it is up: Emotes, where its slots are set (the owner: "edit button on the T wheel"; the gun is quiet while the wheel is up)
    if (ok && input.pressed('Mouse0')) {
      this.wheelOn = false;
      this.hud.wheel(false);
      this.toggleEmotes(true);
      return;
    }
    // (let go on a wedge: chosen, and the wheel shows it as it goes)
    let chose = false;
    if (!ok || !input.held('KeyT')) {
      this.wheelOn = false;
      // (a tap, the mouse left alone, is the last call again)
      if (ok) {
        // (Cancel, let go on: the wheel goes and nothing is done)
        chose = pick >= 0 || pick === Radial.CANCEL;
        if (pick >= 0) this.emote(slots[pick]);
        else if (now - this.wheelSince < 220) this.emote(this.lastCall);
      }
    }
    this.hud.wheel(this.wheelOn, pick, [at.x, at.y], this.danced ?? this.hold, EMOTE[this.lastCall]?.say ?? '', chose);
  },

  /** The words people near have called out, over their heads: for whoever is close and can see them. */
  updateSaid(this: Game, now: number) {
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
  },

  /**
   * A fuel drum goes up.
   * @param mine set off by this player (a bullet, or a blast of theirs that reached it), who
   *   tells the server and answers for whoever it reaches
   */
  blowBarrel(this: Game, i: number, mine: boolean) {
    const b = this.s.veg.barrels[i];
    if (!b?.there) return;
    b.setThere(false);
    // (the server has to hear that it went up before it hears who was hurt)
    if (mine) this.net.send({ t: 'barrel', i });
    if (!this.online) this.drumsBack.push({ i, t: BARREL.respawn });
    this.explode(new THREE.Vector3(b.x, b.y + BARREL.centre, b.z), mine, 'barrel', b.collider);
  },

  updateBarrels(this: Game, dt: number) {
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
  },

  /**
   * Something has gone off somewhere in the world: a grenade (the stick grenade, or the frag), or a fuel drum.
   * @param skip what went up, if it is still standing in the way of its own blast
   * @param inHand a grenade of this player's own that was never thrown: it went off in the hand that held it
   */
  explode(this: Game, at: THREE.Vector3, mine: boolean, what: 'grenade' | 'frag' | 'barrel' | 'jeep' | 'ammo_40mm' = 'grenade', skip?: Barrel['collider'], inHand = false) {
    // (a jeep goes up as a drum of fuel does; online the server says who it reached)
    const jeep = what === 'jeep';
    const drum = what === 'barrel' || jeep;
    // (what a blast does and how far is its rule's, by its name: the same figures the server reckons a hit by)
    const rule = WEAPON_RULES[drum ? 'barrel' : what];
    const spec = { damage: rule.damage, radius: rule.blast! };
    const p = this.player, cam = this.s.r.camera;
    const far = at.distanceTo(cam.position);
    this.effects.explode(at, jeep ? 'vehicle' : drum ? 'drum' : what === 'frag' ? 'frag' : 'grenade');
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
      // (in the hand: all of it, and no plate is between a hand and its owner. The server counts the same: `handBlast`.)
      const k = inHand ? 1 : reach(chest);
      if (k > 0) {
        let amount = inHand ? inHandDamage(what) : spec.damage * k;
        if (!inHand) for (const a of this.inv.wear('armor')) amount *= a;
        p.damage(amount, inHand ? 'a grenade held too long' : jeep ? 'a burning wreck' : drum ? 'a fuel drum you set off' : 'your own grenade');
        if (amount > 12) p.bleed(woundOf('blast'));
        this.hud.hitFrom(p.yaw - Math.atan2(p.pos.x - at.x, p.pos.z - at.z));
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
    // the animals in it (2026-10-24: "i should be able to damage animals, obviously. all damage should work. like
    // grenades"): on a server the server decides, alone this game's own herds do
    if (mine && !jeep) for (const a of this.wild.beasts.values()) {
      if (a.dead || a.gone) continue;
      const chest = new THREE.Vector3(a.x, heightAt(this.s.world.heights, a.x, a.z) + a.kind.tall * 0.6, a.z);
      const k = reach(chest);
      if (k <= 0) continue;
      this.effects.bleed(chest, chest.clone().sub(at).normalize(), 0.8);
      if (this.online) this.net.send({ t: 'ahit', i: a.i, zone: 'torso', w: what, dist: chest.distanceTo(at), sup: false });
      else a.damage(spec.damage * k, chest, chest.clone().sub(at).normalize(), 'torso');
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
  },

  /** Sealed ammo box -> a stack of loose rounds. */
  openBox(this: Game, item: ItemInstance) {
    const def = ITEMS[item.id];
    if (!def.open || this.use || this.player.dead || this.weapons.working) return;
    const o = def.open;
    const from = this.openStash?.container.has(item) ? this.openStash.container : null;
    if (from) {
      from.remove(item);
      this.syncOpenBox();
    }
    audio.ui('unbox');
    this.startUse(`Unwrapping the ${def.name.toLowerCase()}`, o.time, item.id, 'unbox', null, () => {
      this.inv.remove(item);
      const left = this.inv.add(makeItem(o.gives, o.qty));
      if (left) this.dropItem(left);
      audio.ui('pickup', undefined, o.gives);
      this.hud.note(`${o.qty} × ${ITEMS[o.gives].name}`, 'good');
      this.inventoryChanged();
    }, 'unbox');
  },

  /** A piece of clothing cut into bandages with a blade carried, as DayZ cuts clothes into rags (src/sim/condition.ts). */
  cutUp(this: Game, it: ItemInstance) {
    if (!cuttable(it) || !this.canCut()) return;
    const n = bandagesFrom(it), name = itemName(it);
    this.inv.remove(it);
    const left = this.inv.add(makeItem('bandage', n));
    if (left) this.dropItem(left);
    audio.click(900, 0.35, 0.06);
    audio.click(700, 0.35, 0.06, 0.1);
    this.hud.note(`The ${name} is cut into ${n} bandage${n === 1 ? '' : 's'}`, 'good');
    this.inventoryChanged();
  },

  /** whether a blade is carried to cut clothes up with */
  canCut(this: Game) {
    return !!this.inv.find((x) => BLADES.includes(x.id));
  },

  /**
   * Take the rounds out of a weapon and put them back in the pockets. Out of a gun fed by a magazine that is its
   * magazine, with what is in it, and the round out of its chamber.
   */
  unloadWeapon(this: Game, item: ItemInstance) {
    const def = ITEMS[item.id];
    if (!def.weapon) return;
    if (!this.gunInHands(item, () => this.unloadWeapon(item)) || this.weapons.busy) return;
    if (def.weapon.mag) {
      if (!item.mag && !chambered(item)) return;
      const back: ItemInstance[] = [];
      const mag = swapMag(item, null);
      if (mag) back.push(mag);
      if (chambered(item)) back.push(makeItem(def.weapon.ammo, 1));
      item.loaded = 0;
      for (const it of back) {
        const left = this.inv.add(it);
        if (left) this.dropItem(left);
      }
      audio.click(2200, 0.4, 0.03);
      audio.click(1500, 0.4, 0.04, 0.12);
      this.hud.note(mag ? `The magazine is out of the ${def.name}${back.length > 1 ? ', and its chamber is clear' : ''}` : 'The chamber is clear', 'good');
      this.inventoryChanged();
      return;
    }
    const n = item.loaded ?? 0;
    if (n <= 0) return;
    item.loaded = 0;
    const left = this.inv.add(makeItem(def.weapon.ammo, n));
    if (left) this.dropItem(left);
    audio.click(2200, 0.4, 0.03);
    audio.click(1500, 0.4, 0.04, 0.12);
    this.hud.note(`Unloaded ${n} × ${ITEMS[def.weapon.ammo].name}`, 'good');
    this.inventoryChanged();
  },
};
