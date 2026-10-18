// The game: inventory moves, the hot keys and the hands, and what an admin can do.
// (Methods of Game cut out of game.ts whole on 2026-10-14, so that they can be read and worked on alone: put back on
// Game.prototype as the file loads. Nothing in them was changed but `this: Game` said as the first parameter.)

import { basementUnder } from '../../sim/basements';
import { inCave } from '../../world/caves-carved';
import * as THREE from 'three';
import { physics, SOLID_GROUPS, SHOT_GROUPS } from '../../core/physics';
import { audio } from '../../core/audio';
import type { Input } from '../../core/input';
import { heightAt } from '../../world/worldgen';
import { type ItemInstance, ITEMS, isBag } from '../../sim/items';
import { RemotePlayer } from '../remote';
import type { UseKind } from '../weapons';
import { WorldItem, Stash } from '../loot';
import { Jeep } from '../vehicle';
import { JEEP } from '../../sim/vehicles';
import type { HUD } from '../../ui/hud';
import type { MapPerson } from '../../ui/bigmap';
import type { AdminSelf, AdminLook } from '../../ui/admin-ui';
import { type Well, WELL } from '../../sim/wells';
import { Infected } from '../infected';
import { castleUnder } from '../../sim/castle';
import { ESP_FAR, ESP_NEAR, ESP_SIZE, HOT_CODES, HOT_FREE, _lampPos, type Game } from '../game';

export const handsMethods = {
  // ------------------------------------------------------------ inventory ops

  takeWorldItem(this: Game, w: WorldItem): ItemInstance | null {
    const l = this.economy.take(w.loot.uid);
    if (!l) return null;
    if (this.online) {
      this.pendingTakes.set(l.uid, { item: l.item, id: l.item.id, qty: l.item.qty });
      setTimeout(() => this.pendingTakes.delete(l.uid), 5000);
      this.net.send({ t: 'take', uid: l.uid });
    }
    return l.item;
  },

  dropItem(this: Game, item: ItemInstance, at?: THREE.Vector3, spread = 0.5) {
    // (A case, a suitcase or a bag is dropped like anything else and lies there as anything does, with what is in
    // it: taken with F or dragged out of what lies about, like anything. Only a shovel makes anything else of it:
    // see `dig`. "there should be no G key ... all interactions are unchanged with this object ... to drop a
    // container to stash the player will just drop it from their inventory LIKE normal, to pick it up theyll use F
    // LIKE NORMAL or drag from vicinity", 2026-10-12.)
    const p = at ?? this.player.pos;
    const a = Math.random() * Math.PI * 2;
    const r = 0.35 + Math.random() * spread;
    const fwd = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
    const x = p.x + (at ? Math.cos(a) * r : fwd.x * 0.7 + Math.cos(a) * 0.2);
    const z = p.z + (at ? Math.sin(a) * r : fwd.z * 0.7 + Math.sin(a) * 0.2);
    // (all the way down: flying, an admin's kit's spare things were left hanging in the sky where they were, 2026-10-15)
    const hit = physics.raycast({ x, y: p.y + 1.2, z }, { x: 0, y: -1, z: 0 }, 600, SOLID_GROUPS);
    const y = hit && hit.toi > 1e-3 ? hit.point.y : p.y;
    // the loot manager then slides it clear of walls and furniture and lays it on the surface
    if (this.online) this.localDrops.add(item.uid);
    // it falls from the hands (or from the body it was on) to where it comes to rest
    this.loot.hands.set(item.uid, new THREE.Vector3(at ? p.x : p.x + fwd.x * 0.35, p.y + (at ? 0.9 : 1.15), at ? p.z : p.z + fwd.z * 0.35));
    this.economy.drop(item, x, y + 0.005, z, Math.random() * Math.PI * 2);
    this.weapons.validate();
  },

  inventoryChanged(this: Game) {
    this.slowT = 1; // refresh carried weight on the next frame
    this.weapons.validate();
    this.syncGear();
    this.autoHot();
    this.meDirty = true;
    this.syncOpenBox();
    this.syncLying();
    this.save();
  },

  // ------------------------------------------------------------ hot keys, and the hands

  assignHot(this: Game, i: number, item: ItemInstance | null) {
    this.inv.bind(i, item);
    this.save();
  },

  /**
   * What goes on the back or in the holster takes the key of its place, and a new kind of thing to eat, drink or
   * dress a wound with takes the first free key after those, by itself: nobody has to open their pack under fire
   * to find out which key the bandage they have just picked up is on. Everything else is put on a key by hand.
   */
  autoHot(this: Game) {
    this.inv.autoBind();
    for (const it of this.inv.carried()) {
      if (!ITEMS[it.id].use || this.inv.hotOf(it) >= 0 || this.inv.hot.some((b) => b?.id === it.id)) continue;
      for (let i = HOT_FREE; i < this.inv.hot.length; i++) {
        if (this.inv.hot[i] && this.inv.hotItem(i)) continue;
        this.inv.bind(i, it);
        break;
      }
    }
  },

  /**
   * Under the ground. A body that has got down into the earth (through a seam of it, off the edge of something,
   * by whatever let it) is put back on its feet on the ground over it, two seconds after it is found there:
   * nobody under the ground can be shot, and one such was found waiting out his tags' ten minutes there. The
   * server holds the rule whatever a game does (see UNDER in server/index.ts); this is what keeps an honest player
   * out of its way. The bunker is under the ground and is a place: round it the ground is not asked about.
   */
  unbury(this: Game, dt: number, riding: boolean) {
    const p = this.player, at = p.pos;
    const b = this.bunker.place;
    // (the top of the earth: the ground, or the earth the fort lays back over its passage where the ground is cut down for it)
    const top = Math.max(heightAt(this.s.world.heights, at.x, at.z), heightAt(this.s.world.surface, at.x, at.z));
    const down = this.started && !p.dead && !riding && !p.fly && at.y < top - 1.1 && !(b && Math.hypot(at.x - b.x, at.z - b.z) < 48) && !castleUnder(this.s.world.castle, at.x, at.y, at.z, (x, z) => heightAt(this.s.world.surface, x, z)) && !basementUnder(this.s.world.basements, at.x, at.y, at.z) && !inCave(at.x, at.y, at.z);
    this.buriedT = down ? this.buriedT + dt : 0;
    if (this.buriedT < 2) return;
    this.buriedT = 0;
    p.spawn(at.x, top + 0.15, at.z, p.yaw);
    this.hud.note('You were under the ground: back on your feet', 'warn');
  },

  // ---- what an admin can do that nobody else can (the server holds every one of them to having the role)

  *seenByInfected(this: Game) {
    for (const r of this.remotes.values()) if (!r.ghost) yield r;
  },

  /**
   * An admin's map told where everybody is: who is on and how they are from the server's last list, and each one's
   * place and facing from this game's own picture of them, which is fresher (it is what they are drawn by).
   */
  feedMap(this: Game) {
    if (this.role !== 'admin' || !this.map.open) return;
    const out: MapPerson[] = [];
    for (const q of this.admPlayers.values()) {
      if (q.id === this.net.id) continue;
      const r = q.alive ? this.remotes.get(q.id) : undefined;
      out.push({ id: q.id, name: q.name, x: r ? r.pos.x : q.x, z: r ? r.pos.z : q.z, yaw: r ? r.yaw : q.yaw, dead: !q.alive, faint: !!q.hidden, staff: !!q.role, asleep: !!q.asleep, away: !!q.away, seat: !!q.seat, hp: q.hp, flags: q.flags });
    }
    this.map.setPeople(out);
  },

  /** What an admin did to somebody's dot on the map: picked them, or chose from the short list that opens on it. */
  mapPerson(this: Game, id: number, what: 'select' | 'goto' | 'bring' | 'watch' | 'message' | 'panel') {
    if (this.role !== 'admin') return;
    // (picked on the map is picked in the panel: it opens on them)
    this.adminUI.select(id);
    if (what === 'select') return;
    if (what === 'bring') return void this.order(`/bring #${id}`);
    if (what === 'goto') {
      this.order(`/goto #${id}`);
      return void this.toggleMap(false);
    }
    if (what === 'watch') {
      this.toggleMap(false);
      return void this.watch(id);
    }
    // (the panel, from the map: the mouse stays free from the one to the other)
    this.map.hide();
    this.toggleAdmin(true);
    // (the panel would not open: the map is put back, and not a free mouse with nothing under it)
    if (!this.adminUI.isOpen) return void this.map.show(this.player.pos.x, this.player.pos.z);
    if (what === 'message') this.adminUI.select(id, true);
  },

  setTint(this: Game, color: string | null) {
    // ('off': no tag before the name at all)
    this.tint = color && /^(off|#[0-9a-f]{6})$/i.test(color) ? color.toLowerCase() : null;
    try {
      if (this.tint) localStorage.setItem('zona.adminTint', this.tint);
      else localStorage.removeItem('zona.adminTint');
    } catch {
      /* a browser that keeps nothing: it lasts as long as the page does */
    }
    if (this.online && this.role === 'admin') this.net.send({ t: 'tint', color: this.tint });
    this.adminUI.setSelf(this.adminSelf());
  },

  /** an order, sent as if it had been typed */
  order(this: Game, line: string) {
    if (this.online) this.net.send({ t: 'chat', ch: 'global', text: line });
    else this.hud.chatLine('system', '', 'You are playing offline: there is no server to give orders on.');
  },

  adminSelf(this: Game): AdminSelf {
    return { role: this.role, id: this.net?.id ?? 0, ...this.powers, night: this.nightSight, names: this.namesWanted, tint: this.tint, freecam: !!this.freecam, x: Math.round(this.player.pos.x), z: Math.round(this.player.pos.z) };
  },

  showPowers(this: Game) {
    const seen = this.watching ? this.remotes.get(this.watching.id)?.name : '';
    const on = [this.powers.god && 'GOD MODE', this.powers.hidden && 'VANISHED', this.powers.clip && 'NOCLIP', this.powers.weightless && 'WEIGHTLESS', this.powers.endless && 'ENDLESS AMMO', this.powers.bottomless && 'BOTTOMLESS', this.freecam && `${seen ? `WATCHING ${seen.toUpperCase()}` : 'FREE CAMERA'}  ·  ${Math.round(this.freeSpeed)} M/S (WHEEL)  ·  H: BODY HERE  ·  K: BACK`].filter(Boolean);
    this.hud.setPowers(on.join('  ·  '));
    this.adminUI?.setSelf(this.adminSelf());
  },

  /** The panel (the ` key): opened over the game with the mouse free, as the map is. */
  toggleAdmin(this: Game, open?: boolean, byEscape = false) {
    if (!this.adminUI) return;
    const want = open ?? !this.adminUI.isOpen;
    if (want === this.adminUI.isOpen) return;
    if (want) {
      if (!this.role || !this.online || !this.started || this.invUI.isOpen || this.shop.isOpen || this.map.open) return;
      this.adminUI.open(this.adminSelf());
      this.input.uiMode = true;
      this.input.unlock();
      return;
    }
    this.adminUI.close();
    if (this.invUI.isOpen || this.shop.isOpen || this.map.open) return;
    this.input.uiMode = false;
    if (byEscape && !this.input.touch) this.awaitClick = true;
    else if (this.started && !this.paused) this.input.lock();
    // if the browser refuses the re-capture, the next click on the game takes it (see awaitClick)
    setTimeout(() => {
      if (this.started && !this.paused && !this.invUI.isOpen && !this.shop.isOpen && !this.map.open && !this.adminUI.isOpen && !this.input.locked && !this.player.dead) this.awaitClick = true;
    }, 400);
  },

  /** Emotes (a click on the wheel, or the phone's ✎): the wheel's slots set over the game, the mouse free, as the panel is. */
  toggleEmotes(this: Game, open?: boolean, byEscape = false) {
    const em = this.hud.emotes;
    const want = open ?? !em.isOpen;
    if (want) {
      if (!this.started || this.paused || this.player.dead || this.invUI.isOpen || this.shop.isOpen || this.map.open || this.adminUI.isOpen) return;
      em.toggle(true);
      this.input.uiMode = true;
      this.input.unlock();
      return;
    }
    if (!em.isOpen) return;
    em.toggle(false);
    this.input.uiMode = false;
    if (byEscape && !this.input.touch) this.awaitClick = true;
    else if (this.started && !this.paused) this.input.lock();
    // (as the panel's: if the browser refuses the re-capture, the next click on the game takes it)
    setTimeout(() => {
      if (this.started && !this.paused && !em.isOpen && !this.invUI.isOpen && !this.shop.isOpen && !this.map.open && !this.adminUI.isOpen && !this.input.locked && !this.player.dead) this.awaitClick = true;
    }, 400);
  },

  /** The free camera (K): the view leaves the body where it stands and goes where it is flown. */
  toggleFreecam(this: Game, on = !this.freecam) {
    if (on === !!this.freecam || (on && this.role !== 'admin')) return;
    const cam = this.s.r.camera;
    if (on) {
      const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
      this.freecam = { pos: cam.position.clone(), yaw: e.y, pitch: e.x };
      this.director.third = this.freeView;
    } else {
      this.freecam = null;
      this.watching = null;
      this.director.third = this.garage.ride ? this.garage.view : null;
    }
    this.director.shift(0.25);
    this.showPowers();
  },

  /**
   * An admin's Delete key: whatever the middle of the view is on is taken out of the world, by the order that does
   * it (`/del`), which says back what was taken. From the eyes, or from the free camera, as far as a hundred and
   * twenty metres. A thing on the ground, a body, a supply drop, a place where something is buried, a car, one of
   * the infected. Not a player (they are kicked, from the panel), and not the map itself: its buildings, its trees
   * and its crates are the same in every game and are not anybody's to take away.
   */
  deleteLooked(this: Game) {
    const cam = this.s.r.camera, dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = physics.raycast(cam.position, dir, 120, SHOT_GROUPS, this.freecam ? undefined : this.player.collider);
    // (what the hands could reach is what is meant, when the eye is on something that small)
    const o = (!this.freecam && (this.focus instanceof WorldItem || this.focus instanceof Stash) ? this.focus : null) ?? hit?.tag?.owner;
    let line = '';
    if (o instanceof WorldItem) line = `/del item ${o.loot.uid}`;
    else if (o instanceof Stash) line = o.fixed && !o.corpse ? '' : `/del box ${o.uid}`;
    else if (o instanceof Jeep) line = `/del car ${o.i}`;
    else if (o instanceof Infected) line = `/del z ${o.i}`;
    else if (o instanceof RemotePlayer) return void this.hud.note(`That is ${o.name}: a player is kicked from the panel, not taken away`, 'warn');
    if (!line) return void this.hud.note('Nothing there to take away: a thing on the ground, a body, a drop, a buried stash, a car or one of the infected', 'info');
    this.order(line);
  },

  /**
   * What the middle of the view is on, for the panel's Entities page ("where I am looking", "the car I am looking
   * at"): from the eyes, or from the free camera, as far as three hundred metres. Null: nothing that near.
   */
  adminLook(this: Game): AdminLook | null {
    const cam = this.s.r.camera, dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = physics.raycast(cam.position, dir, 300, SHOT_GROUPS, this.freecam ? undefined : this.player.collider);
    if (!hit) return null;
    const o = hit.tag?.owner, body = o instanceof Jeep || o instanceof Infected || o instanceof RemotePlayer;
    // (level enough to stand a thing on, and not somebody or something that moves; if not, a pace and a half short of it)
    const flat = !body && hit.normal.y > 0.7, back = flat ? 0 : 1.5;
    return {
      x: hit.point.x - dir.x * back, y: hit.point.y, z: hit.point.z - dir.z * back, dist: hit.toi, flat,
      what: o instanceof Jeep ? `car number ${o.i}` : o instanceof Infected ? 'one of the infected' : o instanceof RemotePlayer ? o.name : flat ? 'the ground' : 'a wall or a slope',
      ...(o instanceof Jeep ? { car: o.i } : {}),
    };
  },

  /** The free camera set behind a player and a little over them, and carried along with them from then on (it is still flown). */
  watch(this: Game, id: number) {
    const r = this.remotes.get(id);
    if (!r || this.role !== 'admin') return;
    this.toggleFreecam(true);
    if (!this.freecam) return;
    this.freecam.pos.set(r.pos.x + Math.sin(r.yaw) * 4.5, r.pos.y + 2.6, r.pos.z + Math.cos(r.yaw) * 4.5);
    this.freecam.yaw = r.yaw;
    this.freecam.pitch = -0.22;
    this.watching = { id, last: r.pos.clone() };
    this.showPowers();
  },

  /**
   * An admin's far sight: everybody's name where they stand on the screen, through whatever is in the way, however
   * far off, with how far that is and how much blood they have. A switch of the panel's own (2026-10-13: "instead
   * of only showing the names of people in no clip and in free cam lets just make a toggle for it"), kept from one
   * day to the next. No frame round the body: "admin panel does not need the rectangles following the players its
   * causing lag". Each name is moved, and not laid out again: see `esp` in hud.ts.
   *
   * Asked for four times before it was ever seen (2026-10-12: "when im in freecam or spectate i should see
   * everyone names"; "i want to see everyone name from the sky from a distance ... like a cheat menu would";
   * 2026-10-13: "ive asked this like 4x ... when im in freecam or when im no clipping, i want to see the names of
   * players, from far away ... scale their names to be smaller the farther away from them i am, and limit how big
   * they get when i get close, think like a cheat engine with wallhacks"). It was drawn from the first day, and
   * nobody saw it: the HUD is put out of sight while the view is away from the body, and this was a part of the
   * HUD. (It is left in sight now: see `#hud.hidden` in hud.css.) And it was never on while flying.
   */
  drawNames(this: Game, cam: THREE.PerspectiveCamera) {
    if (this.role !== 'admin' || !this.started || !this.namesWanted) {
      if (this.namesOn) this.hud.esp([]);
      this.namesOn = false;
      return;
    }
    this.namesOn = true;
    // (blood and flags come with the panel's lists: asked for every three seconds while this is up)
    const now = performance.now();
    if (this.online && now - this.espAsked > 3000) {
      this.espAsked = now;
      this.net.send({ t: 'adm' });
    }
    const out: Parameters<HUD['esp']>[0] = [], v = new THREE.Vector3();
    const label = (name: string, at: THREE.Vector3, up: number, kind: '' | 'dead' | 'ghost' | 'me', more: string) => {
      const d = at.distanceTo(cam.position);
      v.set(at.x, at.y + up, at.z).project(cam);
      if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return;
      const x = v.x * 0.5 + 0.5, y = -v.y * 0.5 + 0.5;
      // (the farther off, the smaller the lettering, down to what can still be read; and no bigger than this, however near)
      const size = ESP_SIZE[0] - (ESP_SIZE[0] - ESP_SIZE[1]) * THREE.MathUtils.clamp(Math.log(Math.max(d, 1) / ESP_NEAR) / Math.log(ESP_FAR / ESP_NEAR), 0, 1);
      out.push({ x, y, name, sub: `${Math.round(d)} m${more}`, size: Math.round(size * 2) / 2, kind });
    };
    for (const r of this.remotes.values()) {
      const q = this.admPlayers.get(r.id);
      label(r.name, r.pos, r.alive ? 1.95 : 0.5, !r.alive ? 'dead' : r.ghost ? 'ghost' : '', `${r.alive ? (q?.hp !== undefined ? ` · ${Math.round(q.hp)} hp` : '') : ' · dead'}${r.ghost ? ' · vanished' : ''}${q?.flags ? ` · ${q.flags} flags` : ''}`);
    }
    // (their own body, when the view has left it)
    if (this.freecam) label('your body', this.player.pos, 1.95, 'me', '');
    this.hud.esp(out);
  },

  /** the free camera flown: as noclip is, but it is the view that goes and the body that stays */
  flyCamera(this: Game, dt: number, input: Input) {
    const f = this.freecam!, sens = this.player.sensitivity;
    f.yaw -= input.mouseDX * sens;
    f.pitch = THREE.MathUtils.clamp(f.pitch - input.mouseDY * sens, -1.55, 1.55);
    const fwd = (input.held('KeyW') ? 1 : 0) - (input.held('KeyS') ? 1 : 0);
    const str = (input.held('KeyD') ? 1 : 0) - (input.held('KeyA') ? 1 : 0);
    const up = (input.held('Space') ? 1 : 0) - (input.held('ControlLeft') || input.held('KeyC') ? 1 : 0);
    // (the wheel: how fast it flies, a third more or less a notch. 2026-10-12: "when im in freecam scrollwheel allows
    // me to adjust my flight speed, so i can fly much faster, if i want". Shift is four times that, Alt a fifth.)
    if (input.wheel !== 0) {
      this.freeSpeed = THREE.MathUtils.clamp(this.freeSpeed * Math.pow(1.3, -input.wheel), 2, 400);
      input.wheel = 0;
      this.showPowers();
    }
    const speed = this.freeSpeed * (input.held('ShiftLeft') ? 4 : input.held('AltLeft') ? 0.2 : 1);
    const cp = Math.cos(f.pitch), sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
    const d = new THREE.Vector3(-sy * cp * fwd + cy * str, Math.sin(f.pitch) * fwd + up, -cy * cp * fwd - sy * str);
    if (d.lengthSq() > 1) d.normalize();
    f.pos.addScaledVector(d, speed * dt);
    // H: the body is brought to where the view is
    if (input.pressed('KeyH')) this.order(`/tp ${f.pos.x.toFixed(1)} ${(f.pos.y - 1.64).toFixed(1)} ${f.pos.z.toFixed(1)}`);
  },

  /** A hot key is pressed: what is on it comes into the hands, or goes out of them if it is there already. */
  hot(this: Game, i: number) {
    const key = (i + 1) % 10, bound = this.inv.hot[i], item = this.inv.hotItem(i);
    if (!item) {
      this.hud.note(bound ? `No ${ITEMS[bound.id].name.toLowerCase()} left` : `Key ${key} has nothing on it: point at a thing in your inventory and press ${key}`, bound ? 'warn' : 'info');
      return;
    }
    if (this.inv.held() === item || this.inHand === item) return this.emptyHands();
    this.takeUp(item);
  },

  /**
   * A controller's bumpers: the key of the next (1) or last (-1) hot-bar slot with something on it, counted from the one
   * whose thing is in the hands (from the ends, with empty hands); null when there is no other.
   */
  hotStep(this: Game, dir: 1 | -1): string | null {
    const n = this.inv.hot.length, held = this.inv.held() ?? this.inHand;
    const at = held ? this.inv.hot.findIndex((_, i) => this.inv.hotItem(i) === held) : -1;
    const from = at >= 0 ? at : dir > 0 ? -1 : n;
    for (let k = 1; k <= n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (i === at) break;
      if (this.inv.hotItem(i)) return HOT_CODES[i];
    }
    return null;
  },

  /** the hands are emptied: what was in them is put away where it is carried, and anything they were at is broken off */
  emptyHands(this: Game) {
    if (this.use) this.breakOff();
    this.stow();
    this.handsFree = true;
    this.weapons.take(null);
  },

  /** a thing that is not a weapon, held: put away (it stays where it is carried), with nothing taken up in its place */
  stow(this: Game) {
    if (!this.inHand && !this.ready) return;
    this.ready = null;
    this.inHand = null;
    this.holding = false;
    this.weapons.endUse();
    this.settle();
  },

  /**
   * Something carried is taken into the hands: a gun or a thing to hit with comes up as it always did; anything
   * else is held out in the right hand, waiting (see `ready`), and the left button then does with it what is done
   * with such a thing (see `handFire`). Whatever was in the hands before goes back where it is carried.
   */
  takeUp(this: Game, item: ItemInstance, loose = false) {
    const def = ITEMS[item.id];
    if (this.player.dead || !def) return;
    // (Nothing else is taken up by hands that are on a grenade's pin, or have a live one in them: see `cook`. A thing
    // handed over that is carried nowhere is not lost for that: it goes into a pocket, or onto the ground.)
    if (this.cook) {
      if (loose) {
        const left = this.inv.add(item);
        if (left) this.dropItem(left);
        this.inventoryChanged();
      }
      return;
    }
    if (this.use) this.breakOff();
    this.stow();
    // (Taken straight off the ground or out of a crate with no room for it anywhere: it is in the hands and nowhere
    // else, as in DayZ, and is eaten, drunk or put on from there. Put away, it goes into the pockets if there is
    // room by then and onto the ground if there is not: see `settle`. Asked for 2026-10-11: "drag things in the
    // vicinity to their hands even if no room in inventory, so i can use a medkit or drink or eat something
    // without it needing to go in my inventory". A gun or a thing to hit with needs a place on the body: not this.)
    if (loose && !def.weapon && !def.melee) this.loose = item;
    this.handsFree = false;
    this.glass = 0;
    this.weapons.take(item);
    if (def.weapon || def.melee) return;
    this.inHand = item;
    this.magMode = null;
    this.ready = { item, t: 0 };
    this.weapons.beginUse(item.id, this.poseOf(item), def.use?.time ?? def.open?.time ?? 2, true);
  },

  /** how the hands hold a thing while they wait to use it, and work on it when they do */
  poseOf(this: Game, item: ItemInstance): UseKind {
    const def = ITEMS[item.id];
    if (item.id === 'keycard') return 'swipe';
    // (a magazine is held to be filled, a box of rounds to be torn open: each has its own way of being held and worked)
    if (def.mag) return 'load';
    if (def.open) return 'unbox';
    if (def.throw || def.call || !def.use) return 'open';
    // (a bag of blood or salt water: held as a roll of dressing is, in the left palm; see ROLL)
    if (isBag(item.id)) return 'drip';
    return def.look ? 'drink' : def.use.sound;
  },

  /** how many uses of an item type are in the pockets (stack quantity, or number of items) */
  countOf(this: Game, id: string) {
    const stack = !!ITEMS[id].stack;
    let n = 0;
    for (const c of this.inv.containers) for (const p of c.items) if (p.item.id === id) n += stack ? p.item.qty : 1;
    return n;
  },

  /**
   * The left button, with a thing that is not a weapon in the hands: what is done with such a thing is begun, and
   * goes on for as long as the button is held (`holding`: let go, it is broken off, and nothing is lost by it).
   * What a thing does depends on what it is and, for some, on what is in front of the hands: a jerrycan at a car,
   * a bottle at a well, a keycard at the bunker's reader. This is the one place that says which.
   */
  handFire(this: Game, item: ItemInstance) {
    const def = ITEMS[item.id];
    if (this.use || this.player.dead || this.weapons.working) return;
    const well = def.use?.sips ? this.wellHere() : null;
    if (def.mag) this.magWork(item) === 'empty' ? this.unloadMagazine(item) : this.fillMagazine(item);
    else if (def.open) this.openBox(item);
    else if (item.id === 'jerrycan') this.pourFuel(item);
    else if (item.id === 'keycard') this.swipeCard();
    else if (well && (item.left ?? 0) < def.use!.sips!) this.fillBottle(item, well);
    else if (def.use) this.useItem(item, true);
    // (a case or a bag is not "placed": it is dropped like anything else. What makes a stash of it is a shovel.)
    else if (def.category === 'stash') this.hud.note(`Drop the ${def.name.toLowerCase()} like anything else. Where it lies, a shovel buries it.`);
    else this.hud.note(def.category === 'ammo' ? 'Loose rounds go into a magazine: hold the magazine, and hold the button' : def.attach ? `The ${def.name.toLowerCase()} goes on a gun: drag it onto one in your inventory` : `Nothing to do with the ${def.name.toLowerCase()} here`, 'info');
    // (it goes on for as long as the button is held; a thumb on a phone has only to tap)
    this.holding = !!this.use && !this.touch;
    if (this.use) this.ready = null;
  },

  /** the well stood at, if there is one */
  wellHere(this: Game): Well | null {
    const p = this.player.pos;
    return this.wells.find((w) => Math.hypot(w.x - p.x, w.z - p.z) < WELL.reach && Math.abs(w.y - p.y) < 1.5) ?? null;
  },

  /** The keycard, held in the hands at the bunker's reader: held out to it and pushed home, and only then does anything move. */
  swipeCard(this: Game) {
    const at = this.bunker.open ? null : this.bunker.doorAt(_lampPos);
    if (!at || at.distanceTo(this.s.r.camera.position) > 2.6) return void this.hud.note('The card opens the door of Bunker 17: stand at the reader beside it', 'info');
    // (A card held loose in the hand goes into a pocket first. The server opens the door for a card it has seen
    // carried, and what is held loose it is never told of: the reader kept such a card and the door stayed shut.)
    if (this.loose?.id === 'keycard') {
      if (this.inv.add(this.loose)) return void this.hud.note('Make room for the keycard in a pocket first: the reader takes it from there', 'info');
      this.loose = null;
      this.inventoryChanged();
    }
    const near = () => {
      const d = this.bunker.open ? null : this.bunker.doorAt(_lampPos);
      return !!d && d.distanceTo(this.s.r.camera.position) <= 3.1;
    };
    this.startUse('Putting the keycard in', 2.1, 'keycard', 'swipe', null, () => {
      const held = this.loose?.id === 'keycard';
      if (!near() || (!held && this.inv.count('keycard') < 1)) return;
      if (held) this.loose = null;
      else this.inv.take('keycard', 1);
      this.inventoryChanged();
      this.hud.note('The reader keeps the card. The door stays open while anybody is inside, and shuts a minute after', 'good');
      if (this.online) this.net.send({ t: 'bunker' });
      else {
        this.bunkerEmpty = 0;
        this.bunker.setOpen(true);
      }
    });
    if (this.use) Object.assign(this.use, { valid: near, lost: 'You stepped away from the reader: the card is still yours' });
  },

  /** What the hands were at is over, done or broken off: a thing still carried is held as it was before; one used up leaves the hands empty. */
  rest(this: Game) {
    const item = this.inHand;
    this.holding = false;
    if (!item) return;
    if (this.player.dead || !this.mine(item)) {
      this.inHand = null;
      this.ready = null;
      this.inv.hold(null);
      this.weapons.endUse();
      this.settle();
      return;
    }
    this.ready = { item, t: 0.3 };
    this.weapons.beginUse(item.id, this.poseOf(item), ITEMS[item.id].use?.time ?? 2, true);
  },

  /** Ten litres out of a jerrycan held in the hands, into the tank of the car in front of them. */
  pourFuel(this: Game, can: ItemInstance) {
    const jeep = this.lookedAt instanceof Jeep ? this.lookedAt : null;
    if (!jeep || jeep.wreck) return void this.hud.note('Stand at a jeep or a car and look at it to pour this in', 'info');
    if (jeep.fuel >= JEEP.tank - 0.5) return void this.hud.note('Its tank is full', 'info');
    const near = () => !jeep.wreck && jeep.pos.distanceTo(this.player.pos) <= JEEP.reach + 1;
    this.startUse('Filling the tank', 4, 'jerrycan', 'open', null, () => {
      if (!near() || !this.mine(can)) return;
      if (this.loose === can) this.loose = null;
      this.inv.remove(can);
      this.garage.refuel(jeep);
      audio.ui('drink');
      this.hud.note(`${JEEP.can} litres into the tank`, 'good');
      this.inventoryChanged();
    });
    if (this.use) Object.assign(this.use, { valid: near, lost: 'You walked off from it: the can is still full' });
  },

  /** A bottle held in the hands, filled at the well beside them. */
  fillBottle(this: Game, bottle: ItemInstance, w: Well) {
    const full = ITEMS[bottle.id].use!.sips!;
    const near = () => Math.hypot(w.x - this.player.pos.x, w.z - this.player.pos.z) <= WELL.reach + 0.8;
    this.startUse(`Filling the ${ITEMS[bottle.id].name.toLowerCase()}`, WELL.drink * 0.6, bottle.id, 'open', null, () => {
      if (!near()) return;
      bottle.left = full;
      audio.ui('drink');
      this.hud.note(`The ${ITEMS[bottle.id].name.toLowerCase()} is full`, 'good');
      this.inventoryChanged();
    });
    if (this.use) Object.assign(this.use, { valid: near, lost: 'You walked off from the well' });
  },
};
