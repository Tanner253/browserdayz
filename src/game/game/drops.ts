// The game: supply drops, targets when playing alone, and the flow of a life (death, respawn, pause).
// (Methods of Game cut out of game.ts whole on 2026-10-14, so that they can be read and worked on alone: put back on
// Game.prototype as the file loads. Nothing in them was changed but `this: Game` said as the first parameter.)

import * as THREE from 'three';
import { fullIfWanted } from '../../core/leave';
import { physics, SOLID_GROUPS } from '../../core/physics';
import { assets } from '../../core/assets';
import { audio } from '../../core/audio';
import { heightAt } from '../../world/worldgen';
import { CUT } from '../../../arena/rules';
import { newUid, ITEMS, fittedOf, quietOf } from '../../sim/items';
import { SLOT_ORDER } from '../../sim/inventory';
import type { WorldLoot } from '../../sim/economy';
import { WEAPON_RULES } from '../../sim/combat';
import { shotOf } from '../../sim/gunplay';
import { EMOTE, EMOTE_SHIFT } from '../../sim/emotes';
import { type S2C, F_CROUCH, F_SPRINT, F_AIM, F_GROUND, F_DEAD, F_BLEED, F_LEAN_R, F_LEAN_L, F_DANCE, F_SIT, F_PRONE, F_SURRENDER, F_SEAT, F_GUARD, F_LIMP, F_LIGHT, type Pose } from '../../net/protocol';
import { BLOOD, woundOf } from '../../sim/blood';
import { Dummy } from '../character';
import { RemotePlayer } from '../remote';
import type { HitInfo } from '../weapons';
import { Stash } from '../loot';
import { type DropInfo, CRASH, DROP, fillCrash, fillDrop, describeSpot, pickDropSite } from '../../sim/drops';
import { planFlight } from '../../sim/airdrop';
import type { Graphics } from '../../core/settings';
import { Infected } from '../infected';
import { INFECTED } from '../../sim/infected';
import { TOUCH } from '../../core/device';
import { phaseOf, DAY } from '../../sim/daynight';
import { breaksOnHit } from '../../sim/injury';
import { KEPT_ON_DEATH } from '../../sim/trade';
import { inBunker, BUNKER, bunkerDark } from '../../sim/bunker';
import { CRESSET } from '../../world/castle';
import { castleDark } from '../../sim/castle';
import { HELI } from '../../sim/heli';
import { BUNKER_LAMP, HEADLAMP, HEADLAMP_CAR, NIGHT_SIGHT, SEARCHLIGHT, SEND_HZ, STREET_LAMP, _lampDir, _lampPos, type Game } from '../game';

/** how far off a lit street lamp is seen, metres: within the camera's reach (1800) */
const LAMP_SEEN = 1600;

export const dropsMethods = {
  // ------------------------------------------------------------ supply drops

  /**
   * A supply drop has been set down: the crate, the smoke over it, the mark on the map, and
   * word of where it is.
   * @param fill playing alone: nobody else holds what is inside, so it is packed here
   */
  async addDrop(this: Game, d: DropInfo, fill = false) {
    if (this.drops.has(d.uid)) return;
    const stash = new Stash(d.uid, d.x, d.y, d.z, d.rot, d.heli ? CRASH.w : DROP.w, d.heli ? CRASH.h : DROP.h, d.heli ? CRASH.label : DROP.label);
    if (fill) {
      if (d.heli) fillCrash(stash.container);
      else fillDrop(stash.container);
      stash.known = true;
    }
    this.drops.set(d.uid, { stash, until: performance.now() + d.left * 1000, at: new THREE.Vector3(d.x, d.y, d.z), smoke: { owed: 0 } });
    this.markDrops();
    const where = describeSpot(this.s.world, d.x, d.z);
    const mins = Math.max(1, Math.round(d.left / 60));
    if (d.heli) {
      void this.layWreck(d);
      this.hud.note(`A helicopter has come down ${where}: its cargo is there for ${mins} min, marked on the map (M)`, 'good');
      this.hud.feed(`Helicopter down ${where}`);
    } else {
      this.hud.note(`Supply drop ${where}: there for ${mins} min, marked on the map (M)`, 'good');
      this.hud.feed(`Supply drop ${where}`);
      this.hud.chatLine('system', '', `A supply drop has come down ${where}.`);
    }
    // (The cargo itself, beside the wreck as beside nothing: a wreck's was never set down at all. This line
    // came after a `return` in the helicopter's case, and there was a wreck, smoke, a mark on the map and
    // nothing to open.)
    await this.loot.addDrop(stash);
    this.airdrops.stood(d.uid);
    // (cleared away while its crate was still being fetched)
    if (this.drops.get(d.uid)?.stash !== stash) this.loot.removeStash(stash);
  },

  /** The wreck of the helicopter whose cargo a drop is: beside the cargo, lying to the ground, solid. */
  async layWreck(this: Game, d: DropInfo) {
    const model = (await assets.model('heli_wreck')).clone();
    const entry = this.drops.get(d.uid);
    if (!entry) return;
    const H = this.s.world.heights;
    const x = d.x + Math.cos(d.rot) * CRASH.beside, z = d.z - Math.sin(d.rot) * CRASH.beside;
    // (laid to the ground along its length, and let a hand's depth into it: it came down hard)
    const ax = Math.sin(d.rot), az = Math.cos(d.rot);
    const nose = heightAt(H, x + ax * 5, z + az * 5), tail = heightAt(H, x - ax * 5, z - az * 5);
    const y = (heightAt(H, x, z) + nose + tail) / 3 - 0.12;
    model.position.set(x, y, z);
    model.rotation.set(-Math.atan2(nose - tail, 10), d.rot, 0, 'YXZ');
    model.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      // (it is painted burnt black all over: lifted, so that it is a wreck and not a hole in the picture)
      const paint = (m.material as THREE.MeshStandardMaterial).clone();
      paint.color.multiplyScalar(2.6);
      m.material = paint;
    });
    // (got ready to be drawn first, as the one on the crest is: see src/world/crest.ts)
    await this.s.r.ready(model).catch(() => {});
    if (this.drops.get(d.uid) !== entry) return;
    this.s.r.scene.add(model);
    // its body, as two boxes: the cabin and the tail boom
    const solid = [
      physics.addStatic(physics.R.ColliderDesc.cuboid(1.35, 1.2, 3.2), 'metal', { x: x + ax * 1.6, y: y + 1.1, z: z + az * 1.6 }, d.rot),
      physics.addStatic(physics.R.ColliderDesc.cuboid(0.5, 0.6, 3.4), 'metal', { x: x - ax * 4, y: y + 1.0, z: z - az * 4 }, d.rot),
    ];
    entry.wreck = { obj: model, solid };
    // (its smoke stands over the wreck, not over the cargo beside it)
    entry.at.set(x, y + 1.2, z);
    this.markDrops();
  },

  removeDrop(this: Game, uid: string) {
    const d = this.drops.get(uid);
    if (!d) return;
    this.drops.delete(uid);
    if (d.wreck) {
      d.wreck.obj.removeFromParent();
      for (const c of d.wreck.solid) physics.world.removeCollider(c as never, false);
    }
    if (this.openStash === d.stash) this.toggleInventory(false);
    if (d.stash.obj) this.loot.removeStash(d.stash);
    this.markDrops();
    this.hud.feed(d.wreck ? 'The wreck has been cleared away' : 'The supply drop is gone');
  },

  /** Playing alone: the same clock the server keeps (see tickDrops in server/index.ts). */
  tickDrops(this: Game) {
    const t = this.economy.time;
    for (const [uid, d] of this.drops) {
      const s = d.stash;
      if (s.container.items.length) s.emptiedAt = -1;
      else if (s.emptiedAt < 0) s.emptiedAt = t;
      const done = performance.now() > d.until || (s.emptiedAt >= 0 && t - s.emptiedAt > DROP.linger);
      if (done && this.openStash !== s) this.removeDrop(uid);
    }
    if (this.nextDrop < 0) this.nextDrop = t + DROP.first;
    else if (t >= this.nextDrop && !this.drops.size && !this.airdrops.list().some((l) => l.t < l.T.land)) {
      this.nextDrop = t + DROP.every;
      const at = pickDropSite(this.s.world);
      if (at) this.flightBegun(planFlight((x, z) => heightAt(this.s.world.heights, x, z), at, `drop-${newUid()}`));
    }
  },

  /** the server says someone hit us */
  takeHit(this: Game, m: Extract<S2C, { t: 'dmg' }>) {
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
    const blast = !!WEAPON_RULES[m.w]?.blast || m.w === 'fire';
    const melee = !blast && !ITEMS[m.w]?.weapon;
    const sick = m.w === 'infected';
    p.damage(amount, sick ? 'the infected' : m.w === 'fire' ? 'a burning wreck' : m.w === 'jeep' ? 'being run down' : blast ? 'an explosion' : melee ? 'a beating' : 'gunshot wounds');
    this.glass = 0;
    this.setHold(null);
    // a bullet nearly always opens a wound, a blade often, a fist or a bat seldom
    const blade = m.w === 'knife' || m.w === 'machete' || m.w === 'hatchet';
    // (and it bleeds by what made it and where: a round in the body more than one in an arm, a bite less than a
    // blade; and a round takes a hundred of blood as it goes in, wound or no wound: src/sim/blood.ts)
    if (!melee && !blast) p.spill(BLOOD.shot);
    if (!p.dead && Math.random() < (sick ? INFECTED.bleed : melee ? (blade ? 0.6 : amount > 25 ? 0.25 : 0) : amount > 12 ? 0.85 : 0.4)) p.bleed(woundOf(sick ? 'bite' : blast ? 'blast' : melee ? (blade ? 'cut' : 'blunt') : 'shot', m.zone));
    // in the legs, a bullet as often as not breaks one, and so now and then does something swung (not their hands, and not a blast)
    if (!blast && !sick && m.w !== 'fists' && m.w !== 'jeep' && breaksOnHit(m.zone, melee, Math.random())) p.breakLeg();
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
    // Which side it came from, as an angle round from straight ahead (clockwise, as the arc is turned). `dir` is
    // the way the round was going, from whoever fired it to here; ahead is (-sin yaw, -cos yaw). (It was worked
    // out with the turn the wrong way about: right only for a shot from exactly the left or the right, and a shot
    // from in front was shown as from behind.)
    this.hud.hitFrom(p.yaw - Math.atan2(m.dir[0], m.dir[2]));
    if (this.use) {
      this.use = null;
      this.weapons.endUse();
      this.act('stop');
      this.settle();
    }
    this.meDirty = true;
  },

  sendState(this: Game, dt: number) {
    if (!this.online) return;
    const p = this.player;
    this.sendT += dt;
    if (this.sendT >= 1 / SEND_HZ) {
      // (what is over is kept: thrown away, sixty frames a second made thirteen reports of fifteen, and whoever
      // was watching saw a runner stop for a tick now and then)
      this.sendT = this.sendT > 2 / SEND_HZ ? 0 : this.sendT - 1 / SEND_HZ;
      const it = this.weapons.equippedItem;
      const flags = (p.crouched ? F_CROUCH : 0) | (p.sprinting ? F_SPRINT : 0) | (this.weapons.aiming ? F_AIM : 0) | (p.grounded ? F_GROUND : 0) | (p.dead ? F_DEAD : 0) | (p.vitals.bleeding ? F_BLEED : 0) | (p.lean > 0.3 ? F_LEAN_R : p.lean < -0.3 ? F_LEAN_L : 0) | (this.hold === 'dance' ? F_DANCE : 0) | (this.hold === 'sit' ? F_SIT : 0) | (p.prone ? F_PRONE : 0) | (this.hold === 'surrender' ? F_SURRENDER : 0) | (this.garage.ride ? F_SEAT : 0) | (this.weapons.guarding ? F_GUARD : 0) | (p.vitals.broken ? F_LIMP : 0) | (this.lit && !this.garage.ride ? F_LIGHT : 0) | (this.hold === 'dance' && this.danced ? (EMOTE[this.danced]?.n ?? 0) << EMOTE_SHIFT : 0);
      // With the pockets open (or the map, or a panel) the mouse is free and the head is not steered: it was told
      // to the server turned exactly as it had been, report after report. The server takes a body that goes to
      // and fro with its head held like a statue's for one walked by a program (`gaitCheck`), and put a player
      // off the server as they went through the pockets of somebody they had just killed, stepping round the body
      // (2026-10-13, from its log: "went to and fro 4 times over 20 m without their head once turning", 33 s
      // after a kill; and the complaint, "they get disconnected when they kill someone"). A head over open
      // pockets is not a statue's: it is told with the hair's sway it has, a twelfth of a degree, which nobody
      // can see. (The server's rule is being changed to mind what a player DOES: this is for until that is live.)
      const sway = this.input.uiMode ? Math.sin(performance.now() / 700) * 0.0015 : 0;
      const pose: Pose = [p.pos.x, p.pos.y, p.pos.z, p.yaw + sway, p.pitch, flags];
      this.net.send({ t: 's', p: pose, w: it?.id ?? null, m: fittedOf(it), n: Math.round(performance.now()), ...(it?.finish ? { u: it.uid } : {}) });
    }
    // the server keeps a copy of what we carry so it can leave a body with our gear on it
    this.meT += dt;
    if (!p.dead && ((this.meDirty && this.meT > 0.6) || this.meT > 8)) {
      this.meT = 0;
      this.meDirty = false;
      this.net.send({ t: 'me', inv: this.inv.serialize(), vitals: { ...p.vitals } });
    }
  },

  /** an item finished settling: tell the server about the ones this player dropped */
  lootPlaced(this: Game, l: WorldLoot) {
    if (!this.localDrops.delete(l.uid)) return;
    this.net.send({ t: 'drop', l });
  },

  syncOpenBox(this: Game) {
    const st = this.openStash;
    if (!this.online || !st || !st.known) return;
    this.net.send({ t: 'cset', cid: st.uid, items: st.container.serialize().items });
  },

  // ------------------------------------------------------------ targets (offline)

  /** Training dummies with real hit zones: something to shoot and punch when nobody else is around. */
  async spawnDummies(this: Game) {
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
  },

  /** a blow came down on this player's guard: it costs wind, and jolts the arms */
  onGuarded(this: Game) {
    const v = this.player.vitals;
    v.stamina = Math.max(0, v.stamina - INFECTED.guardCost);
    this.weapons.jolt();
    this.meDirty = true;
  },

  onHit(this: Game, h: HitInfo) {
    // A shotgun: nine hits in a few hundredths of a second. The server is told once for each
    // body, a moment later: how many landed, and where most of them did.
    if (!h.melee && shotOf(h.weapon).pellets > 1 && !this.pelletsOut && (h.victim instanceof Infected || h.victim instanceof RemotePlayer)) {
      const got = this.pellets.get(h.victim) ?? { h, zones: {}, n: 0 };
      got.zones[h.zone] = (got.zones[h.zone] ?? 0) + 1;
      got.n++;
      got.h = h.killed ? h : got.h;
      if (!this.pellets.has(h.victim)) {
        this.pellets.set(h.victim, got);
        setTimeout(() => {
          this.pellets.delete(h.victim);
          const zone = Object.entries(got.zones).sort((a, b) => b[1] - a[1])[0][0] as HitInfo['zone'];
          this.pelletsOut = got.n;
          this.onHit({ ...got.h, zone });
          this.pelletsOut = 0;
        }, 90);
      }
      return;
    }
    const n = this.pelletsOut || 1;
    if (h.victim instanceof Infected) {
      // (stopped where it stands for a moment: at once if it is this game's to move, when the server says so if not)
      h.victim.stagger(h.melee ? INFECTED.stopStruck : INFECTED.stopShot);
      // (alone, this game has already decided what it did; on a server the server does)
      if (this.online) this.net.send({ t: 'ihit', i: h.victim.i, zone: h.zone, w: h.weapon, dist: h.distance, sup: quietOf(this.weapons.equippedItem), n, bonus: h.weapon === 'fists' ? this.inv.wear('fist').reduce((a, b) => a + b, 0) : 0, ...(h.pierced ? { p: h.pierced } : {}) });
      else if (h.killed) this.hud.note(`Infected down${h.zone === 'head' ? ' · headshot' : ''}${h.melee || h.distance < 8 ? '' : ` · ${Math.round(h.distance)} m`}`, 'good');
      return;
    }
    if (h.victim instanceof RemotePlayer) {
      const it = this.weapons.equippedItem;
      const bonus = this.inv.wear('fist').reduce((a, b) => a + b, 0);
      this.net.send({ t: 'hit', to: h.victim.id, zone: h.zone, w: h.weapon, dist: h.distance, sup: quietOf(it), n, bonus: h.weapon === 'fists' ? bonus : 0, ...(h.pierced ? { p: h.pierced } : {}) });
      return;
    }
    if (!h.killed) return;
    const how = h.melee ? '' : ` · ${Math.round(h.distance)} m`;
    this.hud.note(`${h.target} down${h.zone === 'head' ? ' · headshot' : ''}${how}`, 'good');
  },

  /** The next weapon carried, round and round (the mouse wheel, for a thumb: it never stops on empty hands). False: none is carried. */
  nextWeapon(this: Game): boolean {
    const have = SLOT_ORDER.filter((s) => this.inv.slots[s]);
    if (!have.length) return false;
    if (this.use || this.garage.ride) return true;
    const at = this.inv.active ? have.indexOf(this.inv.active) : -1;
    this.handsFree = false;
    this.stow();
    this.weapons.equip(have[(at + 1) % have.length]);
    return true;
  },

  resume(this: Game) {
    // (on the bot check's range the game is still on its way in, and is being played all the same: Resume resumes)
    if (this.joining && !this.botCheck?.active) return;
    // (an Arena match over: its card has the mouse, and nothing is resumed)
    if (this.arenaHud?.ended) return;
    // (still building behind the menu, the guns: Deploy is remembered, and goes in the moment they are ready. The
    // mouse is not taken yet: in the game it is, with a click)
    if (!this.started && !this.isLoaded) {
      this.wantIn = true;
      this.hud.showStart(true, false, 'Loading…');
      return;
    }
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
    } else if (!TOUCH) fullIfWanted();
    // capture the mouse in the same click; play begins once we are in the world and locked
    if (!this.input.locked) this.input.lock();
    if (!this.started) {
      void this.join();
      return;
    }
    if (this.input.locked) this.unpause();
  },

  unpause(this: Game) {
    this.paused = false;
    this.hud.showStart(false);
  },

  pause(this: Game) {
    this.paused = true;
    this.save();
    this.hud.showStart(true, true);
    this.input.unlock();
  },

  respawn(this: Game) {
    this.handsFree = false;
    if (this.online) {
      // the server picks the spawn and answers with 'spawn'
      this.net.send({ t: 'respawn' });
      return;
    }
    const p = this.player;
    // everything you carried stays where you fell
    for (const it of this.inv.topLevel()) this.dropItem(it, p.pos, 1.2);
    // (and the trader writes off half of what he owed a dead man: credit is not a way to carry nothing and lose nothing)
    if (this.credit > 0) this.setCredit(Math.floor(this.credit * KEPT_ON_DEATH));
    this.spawnAtEdge();
    this.freshKit();
    this.deathInfo = '';
    this.hitsOn.clear();
    this.save();
    this.resume();
  },

  /** Graphics options from the Esc menu: applied at once, nothing needs a reload. */
  applyGraphics(this: Game, g: Graphics) {
    this.gfx = g;
    const { r, atmo, veg, grass, buildings } = this.s;
    buildings.setDrawDistance(g.draw);
    r.applyQuality({ renderScale: g.scale, msaa: g.msaa, ao: g.ao !== 'off', aoHalfRes: g.ao === 'half' });
    // shadow map size per cascade, and how far from the camera shadows are drawn
    const [size, reach] = { low: [1024, 70], medium: [1024, 110], high: [2048, 160] }[g.shadows];
    atmo.setShadows(size, reach);
    // (a thing lying about casts a shadow only near the eye, on any setting: the owner, 2026-10-14, "loose loot more than
    // about 8 m away drawn with its light model copy and no shadow". Its shadows were drawn into every one of the sun's
    // maps out to 18 m, or 26 on high: more than the things themselves near the police station.)
    this.loot.shadowDist = 8;
    // reach of the full-detail trees, and blades of grass per patch (high: the trees' full copies to three quarters of
    // their built reach, 1.46 ms and 330k triangles less in the worst wood; and five blades in ten, see grass.ts, medium
    // no thicker. Chosen by the owner from side-by-sides, 2026-10-21: "people complain about lag in the foreests maybe
    // trees could use a tone down too")
    const [detail, density] = { low: [0.45, 0.4], medium: [0.7, 0.5], high: [0.75, 0.5] }[g.foliage];
    veg.setDetail(detail);
    grass.setDensity(density);
    grass.setShown(g.grass);
    audio.setVolume(g.volume);
  },

  /**
   * The lamps: L switches the player's own, and every lamp that is lit anywhere says so (see
   * lamps.ts), by day as by night: a light is a light.
   * @param free the player's hands and keys are their own (not typing, not in the inventory)
   */
  lightStep(this: Game, dt: number, free: boolean) {
    const cam = this.s.r.camera, p = this.player, atmo = this.s.atmo;
    const carried = this.weapons.hasLamp || this.inv.count('flashlight') > 0;
    if (free && this.input.pressed('KeyL')) {
      if (this.garage.ride) this.hud.note('It lights its own lamps while somebody drives', 'warn');
      else if (!carried) this.hud.note('Nothing to light: find a flashlight, or a weapon light for your gun', 'warn');
      else {
        this.lit = !this.lit;
        audio.click(2400, 0.25, 0.012);
      }
    }
    if (!carried || p.dead || !this.started) this.lit = false;
    if (this.lit && !this.garage.ride) {
      if (this.weapons.hasLamp) this.lamps.beam(this.weapons.lampWorld(cam, _lampPos), _lampDir.set(0, 0, -1).applyQuaternion(cam.quaternion), 1.5, 0.85, 0);
      // (the lantern: from the chest and tipped a little down, so that it lights the ground walked on; wide, and not far)
      else this.lamps.beam(_lampPos.set(0.16, -0.3, -0.15).applyQuaternion(cam.quaternion).add(cam.position), _lampDir.set(0, -0.09, -1).applyQuaternion(cam.quaternion), 1, 1.3, 0);
    }
    for (const r of this.remotes.values()) {
      const l = r.lamp(_lampPos, _lampDir);
      if (l) this.lamps.beam(_lampPos, _lampDir, l.power, l.wide, 0);
    }
    const dark = atmo.night > 0.3;
    // headlights: a jeep's lamps are on while it is driven, and after dark they light the road
    if (dark) {
      for (const j of this.garage.lit()) {
        if (j.kind === HELI.kind) {
          // The helicopter's searchlight (the owner, 2026-10-16: "shine a light on the ground like a police helicopter from
          // at least 50m up"; it had the police car's headlight, level, which lit nothing below it). A Nightsun's narrow
          // beam, held down and a little ahead of where it heads whatever the body does, as on a real one's steadied mount
          // (tipping the nose to fly would throw it at the horizon). Its power is set for how far the ground is along it,
          // so the spot is as bright at the 100 m ceiling as at 50 m, only wider; and its shaft is seen in the air.
          const S = SEARCHLIGHT;
          _lampDir.set(0, 0, -1).applyQuaternion(j.quat).setY(0);
          if (_lampDir.lengthSq() < 0.01) _lampDir.set(0, 0, -1);
          _lampDir.normalize().multiplyScalar(Math.sin(S.tilt)).setY(-Math.cos(S.tilt));
          _lampPos.set(S.x, S.y, S.z).applyQuaternion(j.quat).add(j.pos);
          let far = 50;
          for (let k = 0; k < 3; k++) far = Math.max(0.5, (_lampPos.y - heightAt(this.s.world.surface, _lampPos.x + _lampDir.x * far, _lampPos.z + _lampDir.z * far)) / Math.cos(S.tilt));
          this.lamps.beam(_lampPos, _lampDir, (far / S.as) ** 2, S.wide, 0);
          this.lamps.flare(_lampPos, _lampDir, S.lens);
          this.lamps.shaft(_lampPos, _lampDir, far, S.wide, S.haze);
          continue;
        }
        _lampDir.set(0, -0.07, -1).applyQuaternion(j.quat);
        // One light, thrown from between the two lamps at the front of the car and at their height, with no
        // disc of its own: each lens is a point of light to whoever is in front and some way off. (It was thrown
        // from a metre over the middle of the car, with a white disc there: a ball of light sitting on the bonnet.)
        const L = j.kind ? HEADLAMP_CAR : HEADLAMP;
        this.lamps.beam(_lampPos.set(0, L.y, L.z).applyQuaternion(j.quat).add(j.pos), _lampDir, 2.4, 1.5, 0);
        for (const side of [-1, 1]) this.lamps.flare(_lampPos.set(side * L.x, L.y, L.z + 0.06).applyQuaternion(j.quat).add(j.pos), _lampDir, 1);
      }
      // the street lamps of the village and the towns, from dusk: a point of light from as far off as the eye sees (the
      // owner, 2026-10-19: "at night you cant really tell where to go especially as a fresh spawn"). Only the nearest
      // few light the ground (see Lamps): the rest are their glare, and no more, fading over the last 300 m of the way.
      const lit = Math.min(1, (atmo.night - 0.3) / 0.3);
      for (const at of this.streetLamps) {
        const d2 = at.distanceToSquared(cam.position);
        if (d2 < LAMP_SEEN * LAMP_SEEN) this.lamps.glow(at, STREET_LAMP, lit * Math.min(1, (LAMP_SEEN - Math.sqrt(d2)) / 300), 22, 1);
      }
    }
    // (alone, this game keeps the door as a server would: open while it is in there, shut a minute after it has gone)
    if (!this.online && this.bunker.open) {
      const p = this.player.pos;
      this.bunkerEmpty = inBunker(this.bunker.place, p.x, p.y + 1, p.z, 2.5) && !this.player.dead ? 0 : this.bunkerEmpty + dt;
      if (this.bunkerEmpty > BUNKER.door.shut) this.bunker.setOpen(false);
    }
    // the bunker: its door, its lamps, and the dark of it (no daylight comes down the stair)
    this.bunker.update(dt, cam.position, (pos, burn) => this.lamps.glow(pos, BUNKER_LAMP, burn * 0.5, 8));
    // (an admin's night vision sees down here as well: "night vision makes bunker darkness go away too", 2026-10-13)
    // the fort: what of it is drawn for where the eye is, its cressets, and the dark under its terrace
    // (a fire basket's light unless the fort says otherwise: its floodlights are white, the wash under its mast red)
    this.castle?.update(dt, cam.position, atmo.night, (pos, burn, colour = CRESSET.colour, reach = CRESSET.reach) => this.lamps.glow(pos, colour, burn, reach));
    // (and the jeep that burns before its gate: its flames and its smoke. Its light is the fires' own lamp: see `fires.always`.)
    this.wreck?.update(dt, cam.position);
    // the basements: the bulbs near the eye, and the dark down them
    this.cellars.update(cam.position, this.lamps);
    const { x: cx, y: cy, z: cz } = cam.position;
    const under = this.nightSight ? 0 : Math.max(bunkerDark(this.bunker.place, cx, cy, cz), castleDark(this.s.world.castle, cx, cy, cz, (x, z) => heightAt(this.s.world.surface, x, z)), this.cellars.dark(cx, cy, cz), ...this.darkBeside.map((d) => d(cx, cy, cz)));
    atmo.cover.ground = { sun: 1 - under, sky: 1 - 0.994 * under };
    // (And it sees indoors as it sees out of doors: "admin night vision should make it day time in buildings as
    // well so i can see in the dark without flashlight", 2026-10-13. Under a roof the day's light is the little
    // that comes in at the windows: a light from nowhere is added there, eased in and out at the door.)
    const fill = this.nightSight && this.started ? (this.indoors ? NIGHT_SIGHT.indoors : NIGHT_SIGHT.outdoors) : 0;
    atmo.fill.intensity += (fill - atmo.fill.intensity) * Math.min(1, dt * 6);
    this.lamps.update(cam, dt);
    this.weapons.lampSpill.copy(this.lamps.spill);
  },

  /** which share of the day it is now */
  hourNow(this: Game) {
    return this.hourHeld ?? phaseOf(this.hourBase.phase * DAY.length + (performance.now() - this.hourBase.at) / 1000);
  },

  /** A slow circuit above the village: what the entrance menu is laid over. */
  menuCamera(this: Game, now: number) {
    const { r, world } = this.s;
    const cam = r.camera;
    // (a page cut down to the arena circles its fort, closer: nothing else of the world is there to see)
    const fort = CUT.arena ? world.castle : null;
    const c = fort ?? world.pois[0];
    const a = now * (fort ? 0.00005 : 0.000028) + 2.2;
    const x = c.x + Math.cos(a) * (fort ? 80 : 128);
    const z = c.z + Math.sin(a) * (fort ? 80 : 128);
    const ground = fort ? fort.y - 8 : heightAt(world.heights, c.x, c.z);
    cam.position.set(x, Math.max(ground + 44, heightAt(world.heights, x, z) + (fort ? 30 : 20)), z);
    // the menu covers the left of the screen: keep the village in the right half
    const fx = c.x - x, fz = c.z - z;
    const len = Math.hypot(fx, fz) || 1;
    // (and the fort to the right, clear of the Arena menu's panels)
    const aside = fort ? 52 : 34;
    cam.lookAt(c.x + (fz / len) * aside, ground + 7, c.z - (fx / len) * aside);
    cam.fov = 50;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  },

  /**
   * The game is up, and what nobody was made to wait for is sent for now: the sharp sky, and the cast of the menu's
   * scenes (three of the infected among them). Until each has come the menu has what it has: the soft sky, and the
   * view from the air. (The menu's films were sent for here too, twenty-four megabytes of them. It has none now:
   * everything behind it is played live. See src/game/menu-scenes.ts.)
   */
  afterBoot(this: Game) {
    // (the shaders written while the game loaded, for the lamps lit and for the lamps out, are looked over now, behind the menu: see Renderer.lookOver)
    void this.s.r.lookOverAll();
    this.s.atmo.afterBoot();
    void this.menu.load();
    // (and whatever of the world was put off because nobody starts by it)
    assets.up();
  },

  start(this: Game) {
    // the loading screen lifts: the way in arrives
    setTimeout(() => this.hud.entrance(), 400);
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
  },
};
