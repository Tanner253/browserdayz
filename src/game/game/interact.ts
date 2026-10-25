// The game: what is looked at and done with F (doors, containers, cars, fires, loot).
// (Methods of Game cut out of game.ts whole on 2026-10-14, so that they can be read and worked on alone: put back on
// Game.prototype as the file loads. Nothing in them was changed but `this: Game` said as the first parameter.)

import * as THREE from 'three';
import { Heli } from '../heli';
import { physics, USE_GROUPS, SIGHT_GROUPS } from '../../core/physics';
import { audio } from '../../core/audio';
import { Door } from '../../world/buildings';
import { ITEMS, magRoom, capacityOf, itemName, type ItemInstance, fittedOf, ZONA_VOID } from '../../sim/items';
import { inPlay } from '../../world/worldgen';
import { CRATE_RESTOCK } from '../../sim/crates';
import { POLICE_CAR } from '../../sim/vehicles';
import type { Player } from '../player';
import { bloodOf, bleedOf, BLOOD } from '../../sim/blood';
import { WorldItem, Stash } from '../loot';
import { Jeep } from '../vehicle';
import type { HotbarEntry } from '../../ui/hud';
import { WELL } from '../../sim/wells';
import { waterName } from '../../sim/water';
import { STALLS } from '../../sim/camp';
import { _lampPos, _sealed, _sealedDir, _sealedLook, type Game } from '../game';
import { finishDay, finishOn, type Finish } from '../finish';
import { lookOf } from '../../../api/_lib/shop-items';
import { renderIcons } from '../../ui/icons';

export const interactMethods = {
  // ------------------------------------------------------------ interaction

  updateInteraction(this: Game, cam: THREE.PerspectiveCamera) {
    this.prompt = null;
    this.mark = null;
    this.focus = null;
    if (this.player.dead || this.invUI.isOpen || this.shop.isOpen || this.use) return;
    // (the battle royale: its own things within reach first, a thing on the ground or a teammate to get up
    // (src/game/br/mode.ts); of the game's own, only doors and cars)
    if (this.br?.busy) return;
    // at a shop's counter, looking at the man behind it
    const stall = !this.br && this.started && !this.garage.ride ? this.traders?.at(cam.position, _sealedLook.set(0, 0, -1).applyQuaternion(cam.quaternion)) : null;
    if (stall) {
      const owed = stall === 'building' && this.camp.owed();
      this.prompt = `<kbd>F</kbd>Trade · ${STALLS[stall].name.toLowerCase()}${owed ? ' <small>· he owes you for a job</small>' : ''}`;
      if (this.input.pressed('KeyF') && !this.hud.chatOpen) {
        this.camp.stall = stall;
        this.openShop();
      }
      return;
    }
    // at a recycler, looking at it (src/game/craft-recyclers.ts)
    if (!this.br && this.started && !this.garage.ride) {
      const recy = this.recyclers.prompt(cam.position, _sealedLook.set(0, 0, -1).applyQuaternion(cam.quaternion), !this.hud.chatOpen);
      if (recy) {
        this.prompt = recy;
        return;
      }
    }
    // at the way down to the second level: it is not to be opened yet, and says so
    {
      const sealed = this.bunker.sealedAt(_sealed);
      if (sealed && sealed.distanceTo(cam.position) < 3.2 && _sealedDir.copy(sealed).sub(cam.position).normalize().dot(_sealedLook.set(0, 0, -1).applyQuaternion(cam.quaternion)) > 0.75) {
        this.prompt = '<small>Locked · requires a Level 2 keycard · coming soon</small>';
        return;
      }
    }
    // at the bunker's door, shut: a keycard is what F does there
    const door = this.bunker.open ? null : this.bunker.doorAt(_lampPos);
    if (door && door.distanceTo(cam.position) < 2.6 && !this.garage.ride) {
      // (the card is used from the hands, like everything: F takes it into them, and the button puts it in)
      const card = this.inv.find((i) => i.id === 'keycard');
      const inHand = this.inHand?.id === 'keycard';
      this.prompt = inHand ? null : card ? '<kbd>F</kbd>Take out the keycard' : '<small>Locked. A keycard opens it: they are kept under the gas</small>';
      if (card && !inHand && this.input.pressed('KeyF') && !this.hud.chatOpen && !this.use) this.takeUp(card);
      return;
    }
    // sat in a jeep there is one thing to do with F
    if (this.garage.ride) {
      if (this.input.pressed('KeyF') && !this.hud.chatOpen) this.garage.out();
      // (On a phone only: on a computer every key of a seat is in the corner with the rest, Get out among them,
      // src/game/key-hints.ts. The owner, 2026-10-20: "duplicated ui when flying heli", and of Get out over the middle
      // and the seats' keys by the speed, "why? when you have everything else and its controls on the left?")
      else if (this.touch) this.prompt = this.garage.ride.seat === 0 ? (this.garage.ride.jeep instanceof Heli ? '<kbd>F</kbd>Get out <small>Space up · C down · W S nose · A D turn · Q E lean</small>' : (this.garage.ride.jeep.kind === POLICE_CAR.kind ? '<kbd>F</kbd>Get out <small>W A S D to drive · Space is the handbrake · H horn · J siren</small>' : '<kbd>F</kbd>Get out <small>W A S D to drive · Space is the handbrake · H horn</small>')) : '<kbd>F</kbd>Get out';
      return;
    }
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const range = 2.6;
    const hit = physics.raycast(cam.position, dir, range, USE_GROUPS, this.player.collider);
    const owner = hit?.tag?.owner ?? this.nearestLoose(cam, dir, range);
    this.lookedAt = owner ?? null;
    if (!owner && this.br) return;
    if (!owner) {
      // nobody has a name floating over their head: you only learn it by looking right at them, up close
      const c = new THREE.Vector3();
      // a well stood at and looked at; or the river, a lake or the swamp, drunk from as a well is (the owner,
      // 2026-10-18: "even the swamp water"): looked at from its bank, or looked down into, stood in it
      const well = this.wells.find((w) => Math.hypot(w.x - this.player.pos.x, w.z - this.player.pos.z) < WELL.reach && Math.abs(w.y - this.player.pos.y) < 1.5);
      const wet = well ? null : this.waterHere();
      if (wet) c.set(wet.under ? this.player.pos.x + dir.x * 1.2 : wet.x, wet.surface, wet.under ? this.player.pos.z + dir.z * 1.2 : wet.z);
      else if (well) c.set(well.x, well.y + 0.8, well.z);
      if ((well || wet) && c.sub(cam.position).normalize().dot(dir) > 0.55) {
        const bottles = this.bottles().filter((it) => (it.left ?? 0) < ITEMS[it.id].use!.sips!).length;
        const dry = this.player.vitals.water < 99;
        const held = this.inHand && ITEMS[this.inHand.id].use?.sips ? this.inHand : null;
        const fill = held && (held.left ?? 0) < ITEMS[held.id].use!.sips! ? (this.touch ? 'Tap fire to fill it' : 'Hold the left button to fill it') : bottles ? 'Take a bottle into your hands to fill it here' : '';
        // (wading with nothing to drink or fill, nothing is said: the well's word for it would follow a walker the whole way through the swamp)
        if (!dry && (well || fill)) this.prompt = `<small>${well ? 'The well' : `The ${waterName(wet!)}`} · ${fill || 'you have drunk your fill, and your bottles are full'}</small>`;
        else if (dry) {
          this.prompt = `<kbd>F</kbd>Drink${fill ? ` <small>${fill}</small>` : ''}`;
          if (this.input.pressed('KeyF') && !this.use && !this.hud.chatOpen) this.drinkAt((well ?? wet)!);
        }
        if (this.prompt) return;
      }
      // a dead animal at the feet, to gut and skin (src/game/game/hunt.ts)
      if (this.skinPrompt(cam, dir)) return;
      // a fireplace stood beside and looked at
      const fi = this.fires.at(this.player.pos);
      if (fi >= 0) {
        const s = this.fires.spots[fi];
        if (c.set(s.x, s.y + 0.3, s.z).sub(cam.position).normalize().dot(dir) > 0.78) {
          const left = this.fires.left[fi], meat = left > 0 && !this.use ? this.rawMeat().length : 0;
          const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
          if (meat) {
            // (raw meat carried: it goes on the fire, as many as its stones take)
            this.prompt = `<kbd>F</kbd>Cook ${Math.min(meat, 4)} raw meat <small>Fire · ${clock} left</small>`;
            if (this.input.pressed('KeyF') && !this.hud.chatOpen) this.grill(fi);
          } else if (left > 0) this.prompt = `<small>Fire · ${clock} left · rest beside it to mend</small>`;
          else {
            this.prompt = '<kbd>F</kbd>Light the fire';
            if (this.input.pressed('KeyF') && !this.use) this.lightFire(fi);
          }
          return;
        }
      }
      for (const r of this.remotes.values()) {
        if (!r.alive) continue;
        r.chest(c).sub(cam.position);
        const d = c.length();
        // (and only with nothing in between: it used to be read straight through walls)
        if (d < 18 && c.normalize().dot(dir) > 0.992 && !physics.raycast(cam.position, c, d - 0.5, SIGHT_GROUPS)) {
          // (near enough to speak to: asked to your party, or a yes to theirs, with F, as in Rust: server/party.ts)
          const mate = this.party.ids.has(r.id), asked = this.party.askedBy(r.id);
          if (mate || d > 4) this.prompt = `<small>${r.name}${mate ? ' · party' : ''}</small>`;
          else if (this.party.wasSent(r.id)) this.prompt = `<small>${r.name} · asked to your party</small>`;
          else {
            this.prompt = `<kbd>F</kbd>${asked ? `Join ${r.name}'s party` : `Ask ${r.name} to your party`}`;
            if (this.input.pressed('KeyF') && !this.hud.chatOpen) {
              this.net.send({ t: 'party', act: asked ? 'accept' : 'invite', id: r.id });
              this.party.sent(r.id);
            }
          }
        }
      }
      return;
    }
    this.focus = owner;
    const key = this.input.pressed('KeyF');
    if (owner instanceof WorldItem) {
      const item = owner.loot.item;
      const d = ITEMS[item.id];
      const qty = d.stack ? ` <small>×${item.qty}</small>` : d.weapon ? ` <small>${item.loaded ?? 0}/${d.weapon.mag ? (item.mag ? magRoom(item) : 'no mag') : capacityOf(item)}</small>` : d.mag ? ` <small>${item.rounds ?? 0}/${d.mag.capacity}</small>` : item.cargo?.length ? ` <small>${item.cargo.length} inside</small>` : '';
      // (a case, a suitcase or a bag, and a shovel in the hands: the left button, held, buries it where it lies)
      const spade = d.category === 'stash' && this.weapons.equippedItem?.id === 'shovel';
      // (a log, and a saw in the hands: the left button saws it into planks where it lies, src/game/gathering.ts)
      const saw = item.id === 'log' && this.gather.canSaw();
      this.prompt = `<kbd>F</kbd>Take ${d.name}${qty}${spade ? ' <small>hold the left button to bury it</small>' : saw ? ' <small>the left button saws it into planks</small>' : ''}`;
      if (spade && !this.use && !this.invUI.isOpen && this.input.pressed('Mouse0')) this.dig(owner);
      if (saw && !this.use && !this.invUI.isOpen && this.input.pressed('Mouse0')) this.gather.saw(owner.loot);
      // four corners round it, so there is no doubt which thing that is
      const at = new THREE.Vector3(owner.loot.x, owner.loot.y + 0.05, owner.loot.z).project(cam);
      if (at.z < 1) this.mark = [at.x * 0.5 + 0.5, 0.5 - at.y * 0.5];
      if (key) {
        if (!this.inv.hasRoom(item)) {
          // (No room for it: it is taken into the hands, which are a place of their own, as in DayZ: eaten, drunk or
          // put on from there, a third long gun carried in them (the owner, 2026-10-24: "2 weapons on their back and 1
          // more in their hand"). What is in them is put away first; with no room for that, nothing is taken. A thing
          // to wear needs its place.)
          const wear = d.category === 'clothing', busy = !!(this.use || this.cook);
          if (wear || busy || !this.inv.canPutAway()) {
            this.hud.note(wear ? `No free ${d.slot} slot and no room in your pockets` : busy ? 'Your hands are busy' : this.handsFull(), 'warn');
            return;
          }
          if (!this.takeWorldItem(owner)) return;
          if (!this.takeUp(item, true)) return;
          audio.ui('pickup', undefined, item.id);
          this.hud.note(`${d.name}: in your hands, there is no room to put it away`, 'info');
          return;
        }
        if (!this.takeWorldItem(owner)) return;
        const left = this.inv.add(item);
        if (left) this.dropItem(left);
        audio.ui('pickup', undefined, item.id);
        this.hud.note(`${d.name}${d.stack ? ` ×${item.qty}` : ''}`, 'good');
        this.inventoryChanged();
      }
    } else if (owner instanceof Door) {
      const door = owner;
      this.prompt = `<kbd>F</kbd>${door.open ? 'Close' : 'Open'} door`;
      if (key) {
        door.toggle(this.player.pos);
        audio.door(door.open, door.pivot.position, door.pivot.position.distanceTo(this.s.r.camera.position));
        this.net.send({ t: 'door', i: this.s.buildings.doors.indexOf(door), open: door.open, swing: door.swingDir });
      }
    } else if (owner instanceof Jeep) {
      const can = this.inv.find((i) => i.id === 'jerrycan');
      const tagged = this.tagged;
      this.prompt = this.garage.prompt(owner, !!can, tagged);
      if (key) this.garage.use(owner, tagged);
    } else if (owner instanceof Stash && !this.br) {
      // A crate of the map's, a body, a drop: searched. Or a place where somebody buried a case, a suitcase or a
      // bag: with a shovel in the hands, dug up by holding the left button, and what was under it lies there again.
      const shovel = !owner.fixed && owner.buried && this.weapons.equippedItem?.id === 'shovel';
      this.prompt = owner.buried
        ? shovel ? '<kbd>LMB</kbd>Hold to dig here' : 'Something is buried here <small>a shovel would dig it up</small>'
        : `<kbd>F</kbd>${owner.fixed ? 'Search' : 'Open'} ${owner.label}`;
      if (key && !owner.buried) this.toggleInventory(true);
      if (shovel && !this.use && !this.invUI.isOpen && this.input.pressed('Mouse0')) this.dig(owner);
    }
  },

  /**
   * The loose item nearest the middle of the view, for when the eye is not dead on anything.
   * A tin on a shelf is a few pixels across: nobody should have to thread the cross-hair onto
   * it. Within reach, within a hand's spread of the cross-hair, and in plain sight.
   */
  nearestLoose(this: Game, cam: THREE.PerspectiveCamera, dir: THREE.Vector3, range: number): WorldItem | null {
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
  },

  /** G, held a moment: what is in the hands goes on the ground in front of you. */
  dropInHands(this: Game) {
    const item = this.inv.held();
    if (!item) {
      this.hud.note('Nothing in your hands to drop', 'warn');
      return;
    }
    if (this.use) this.breakOff();
    this.stow();
    this.inv.remove(item);
    this.dropItem(item);
    audio.ui('drop', undefined, item.id);
    this.hud.note(`Dropped ${itemName(item)}`);
    this.inventoryChanged();
  },

  /** offline: emptied map crates refill after a while, once nobody is around to see it */
  tickCrates(this: Game) {
    const p = this.player.pos;
    for (const c of this.loot.crates) {
      if (c.container.items.length) {
        c.emptiedAt = -1;
        continue;
      }
      if (c.emptiedAt < 0) c.emptiedAt = this.economy.time;
      else if (this.economy.time - c.emptiedAt > CRATE_RESTOCK && c !== this.openStash && Math.hypot(c.x - p.x, c.z - p.z) > 60) {
        this.fillCrate(c);
        c.emptiedAt = -1;
      }
    }
  },

  hotbar(this: Game): HotbarEntry[] {
    // each key, the thing on it, and what there is of it: rounds in a gun or a magazine, drinks in a bottle, how many of a thing that is used up
    const held = this.inv.held();
    return this.inv.hot.map((b, i) => {
      const it = b ? this.inv.hotItem(i) : null;
      const d = it ? ITEMS[it.id] : null;
      const label = !it || !d ? '' : d.weapon ? String(it.loaded ?? 0) : d.mag ? String(it.rounds ?? 0) : d.use?.sips ? `${it.left ?? d.use.sips}/${d.use.sips}` : d.melee || d.slot ? '' : String(this.countOf(it.id));
      const look = finishOn(it);
      if (look && it) this.plateIcon(it.id, look);
      return { key: String((i + 1) % 10), id: it?.id ?? b?.id ?? null, ...(look ? { look } : {}), label, active: !!it && it === held, dim: !!b && !it };
    });
  },

  /** What to do about an open wound, in as few words as it takes: the key that holds a dressing, if there is one. */
  /** blood read back from a save or from the server: one kept from before there was any has all of it, and one wound if it was bleeding */
  takeVitals(this: Game, from: Partial<Player['vitals']>) {
    const v = this.player.vitals;
    Object.assign(v, from);
    v.blood = bloodOf(from);
    v.bleed = v.bleeding ? bleedOf(from) : 0;
    v.bleeding = v.bleed > 0;
  },

  /** Said once on the way down, and once on the way back up: what the grey and the closing edges mean, and what to do. */
  sayBlood(this: Game) {
    const p = this.player, b = p.vitals.blood;
    if (p.dead || !this.started) return;
    const at = b < BLOOD.faint ? 2 : b < BLOOD.grey[0] - 200 ? 1 : b >= BLOOD.grey[0] ? 0 : this.bloodSaid;
    if (at === this.bloodSaid) return;
    if (at > this.bloodSaid) this.hud.note(at === 2 ? 'You have lost too much blood: your head swims and you cannot run. A blood bag or saline puts it back; food, water and time do it slowly' : 'You are losing blood: the colour is going out of things. Stop the bleeding', 'warn');
    else if (at === 0) this.hud.note('Your blood is back: the colour has come back to things', 'good');
    else if (at === 1) this.hud.note('Your head has cleared: you can run again', 'good');
    this.bloodSaid = at;
  },

  /** little blood and no wound: what puts it back, of what is carried, with the key to it */
  bloodHint(this: Game): string {
    if (this.player.drip.left > 0) return 'A bag is running in';
    const gives = (it: ItemInstance | null | undefined) => !!it && !!ITEMS[it.id].use?.blood;
    const i = this.inv.hot.findIndex((_, k) => gives(this.inv.hotItem(k)));
    if (i >= 0) return this.touch ? `Tap the ${ITEMS[this.inv.hotItem(i)!.id].name} below` : `<kbd>${(i + 1) % 10}</kbd>${ITEMS[this.inv.hotItem(i)!.id].name}`;
    const carried = this.inv.find((it) => gives(it));
    if (carried) return `${this.touch ? 'Open your pack' : '<kbd>Tab</kbd>'} and use the ${ITEMS[carried.id].name}`;
    return 'A blood bag or saline puts it back. Food, water and time do it slowly';
  },

  /** An open wound is felt: every few seconds what is held dips, oftener and harder the faster it bleeds. */
  wince(this: Game, dt: number) {
    const p = this.player, v = p.vitals;
    if (!v.bleeding || p.dead || !this.started) return void (this.winceT = 1.5);
    if ((this.winceT -= dt) > 0) return;
    const bad = Math.min(1, v.bleed / BLOOD.most);
    this.winceT = (5.2 - 3.2 * bad) * (0.8 + Math.random() * 0.4);
    this.weapons.wince(0.5 + 0.7 * bad);
  },

  bleedHint(this: Game): string {
    if (this.use?.sound === 'bandage' || (this.use?.sound === 'inject' && !/Adrenaline/.test(this.use.label))) return 'Treating the wound…';
    const held = this.inHand && ITEMS[this.inHand.id].use?.stopBleed ? this.inHand : null;
    if (held) return this.touch ? `Tap fire to use the ${ITEMS[held.id].name.toLowerCase()}` : `Hold the left button to use the ${ITEMS[held.id].name.toLowerCase()}`;
    const i = this.inv.hot.findIndex((_, k) => !!ITEMS[this.inv.hotItem(k)?.id ?? '']?.use?.stopBleed);
    if (i >= 0) {
      const d = ITEMS[this.inv.hotItem(i)!.id];
      return this.touch ? `Tap the ${d.name} below, then fire, to stop it` : `<kbd>${(i + 1) % 10}</kbd>${d.name}, then hold the left button`;
    }
    const carried = this.inv.find((it) => !!ITEMS[it.id].use?.stopBleed);
    if (carried) return `${this.touch ? 'Open your pack' : '<kbd>Tab</kbd>'} and use the ${ITEMS[carried.id].name}`;
    return 'Find a bandage, a health stim or a first aid kit';
  },

  /** keep the body's hands in step with what is equipped */
  syncHeld(this: Game) {
    // (and the dog tag at the breastbone, on the body and on the inventory's figure alike: only while their own tag is
    // round their neck and a killer could take it, the owner, 2026-10-22, "dogtags shouldnt render on the player until
    // they can drop a tag": so not before TAG_FRESH, not outside the Zona, not on an admin who leaves none. Gold on a VIP.
    // src/game/worn-tag.ts)
    const p = this.player, neck = this.inv.neck;
    const live = !p.dead && neck?.id === 'dogtag' && !this.powers.voidTag && !(ZONA_VOID && !inPlay(p.pos.x, p.pos.z));
    const tag = live ? (this.perks.vip || neck.gold ? 'gold' : 'steel') : null;
    this.avatar.wearTag(tag);
    this.doll?.wearTag(tag);
    finishDay();
    const it = this.weapons.equippedItem;
    const finish = finishOn(it);
    const key = it ? `${it.id}|${fittedOf(it).join(',')}|${finish ?? ''}` : '';
    if (key === this.heldKey) return;
    this.heldKey = key;
    // (with what is fitted to it and the magazine in it, and its finish from the store, as everybody else is shown it)
    const h = it ? this.makeHeld(it.id, fittedOf(it), finish) : null;
    this.avatar.setHeld(h?.obj ?? null, h?.grips ?? null, h?.kind);
  },

  /** the store finish of theirs this gun can be given, where it does not wear it already (server/plates.ts) */
  finishFor(this: Game, it: ItemInstance): Finish | null {
    const f = this.online ? this.perks.skin(it.id) : null;
    return f && it.finish !== f ? lookOf(f) : null;
  },

  /** a plated gun's picture, drawn once from its model with the finish on (src/ui/icons.ts) and shared by the inventory and the hot keys */
  plateIcon(this: Game, id: string, f: Finish) {
    const key = `${id}|${f}`, icons = this.invUI.icons;
    if (icons[key] !== undefined) return;
    icons[key] = '';
    void renderIcons(this.s.r.renderer, this.loot.models, this.s.atmo.envMap, [id], f).then(
      (made) => {
        Object.assign(icons, made);
        this.inventoryChanged();
      },
      () => delete icons[key],
    );
  },

  /** Apply: asked of the server, which keeps it on the gun; what it carries is told first, so that it finds the gun */
  applyFinish(this: Game, it: ItemInstance) {
    if (!this.finishFor(it)) return;
    this.net.send({ t: 'me', inv: this.inv.serialize(), vitals: { ...this.player.vitals } });
    this.net.send({ t: 'finish', uid: it.uid });
  },

  /** the server has put a finish on one of our guns: on it from now, wherever it goes */
  finished(this: Game, uid: string, f: string) {
    const it = this.inv.find((t) => t.uid === uid) ?? (this.inHand?.uid === uid ? this.inHand : null);
    if (!it) return;
    it.finish = f;
    this.weapons.refinish();
    this.syncHeld();
    this.inventoryChanged();
    audio.ui('move');
    this.hud.note(`${itemName(it)}: yours to carry, and to lose`, 'info');
  },
};
