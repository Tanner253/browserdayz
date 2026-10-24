// The battle royale in the game (2026-10-21): what the server says of the match, kept and shown (src/ui/br/hud.ts,
// ./look.ts), and what this player does in it: the six slots on keys 1-6, F to take a thing or to get a teammate up
// (the owner: "instead of f to add to party it will now be f to revive"), G to put a thing down, V to vote, and the
// plane, the jump and the canopy. The server holds the slots, the rounds and health (arena/br/match.ts); the game's
// own inventory is made to hold the same guns and wear, so that its hands, its sights and its body show them.
import * as THREE from 'three';
import { physics, SOLID_GROUPS } from '../../core/physics';
import { ITEMS, makeItem, type ItemInstance } from '../../sim/items';
import { heightAt } from '../../world/worldgen';
import { BR, FLIGHT, HEALS, MAPS, RARITY, capOf, circleAt, kindOf, rarityOf, stackOf, type Ground } from '../../../arena/br/rules';
import type { BrC2S, BrS2C, Phase } from '../../../arena/br/wire';
import { BrHud } from '../../ui/br/hud';
import { doorGo, doorOver } from '../../ui/door';
import { BrLook } from './look';
import type { Game } from '../game';

type Of<K extends BrS2C['k']> = Extract<BrS2C, { k: K }>;
type Listen = { on(t: string, h: (m: never) => void): void };

const _v = new THREE.Vector3(), _f = new THREE.Vector3();

/** whether this page is in the battle royale (its address: `?wager=br`, the arena's door with the battle royale's word) */
export const brPage = () => new URLSearchParams(location.search).get('wager') === 'br';

export class BrMode {
  look: BrLook;
  hud: BrHud;
  /** the server's clock less ours, ms */
  private off = 0;
  phase: Phase = 'wait';
  map = 0;
  me: Of<'me'> | null = null;
  ground = new Map<number, Ground>();
  plane: Of<'plane'> | null = null;
  zone: Of<'zone'> | null = null;
  /** the slot in hand */
  held = 0;
  /** the guns and blades of the slots, as the game's inventory holds them, by the server's uid */
  private mirror = new Map<string, ItemInstance>();
  private worn: Record<'vest' | 'helmet' | 'pack', ItemInstance | null> = { vest: null, helmet: null, pack: null };
  /** in the plane, falling, or under the canopy */
  air: 'plane' | 'fall' | 'chute' | null = null;
  private fallVel = new THREE.Vector3();
  private jumped = false;
  private asked = new Map<number, number>();
  private reviving: number | null = null;
  private target: { g: Ground | null; mate: number | null } = { g: null, mate: null };
  /** the others falling or under a canopy, as their games say it (arena/br/match.ts relays it) */
  private airOf = new Map<number, 'fall' | 'chute'>();
  /** what this game last said of its own fall */
  private airSaid: 'plane' | 'fall' | 'chute' | null = null;
  ended = false;

  /** something of the battle royale's is within reach (F takes it, or gets a teammate up): the game's own F waits */
  get busy() {
    return !!this.target.g || this.target.mate !== null;
  }

  /**
   * Made once a page, the first time the battle royale is gone into (Game.join), and put on and taken off after: what it
   * listens to on the connection stays, heard only while it is the game's (src/game/modes.ts).
   */
  constructor(private game: Game) {
    this.look = new BrLook(game);
    this.hud = new BrHud(game.hud.root, () => this.vote());
    this.hud.onAgain = () => game.toBr();
    this.hud.onMenu = () => {
      game.toBr();
      void doorOver('br');
    };
    const net = game.net as unknown as Listen;
    const mine = () => game.br === this;
    net.on('br', (m: { t: 'br' } & BrS2C) => mine() && this.on(m));
    net.on('kill', (m: { by: string; who: string; w: string; head: boolean; me: boolean }) => mine() && this.hud.feed(m.by, m.who, ITEMS[m.w]?.name ?? m.w, m.head, m.me));
    net.on('hitok', (m: { amount: number; zone: string }) => mine() && this.hud.hitNumber(m.amount, m.zone === 'head'));
    // (Each shot told with how far this game's own ray went before a wall or a floor stopped it: the server has the
    // ground and not the buildings, and holds a shot to the nearer of the two. A shot through a house is not one.)
    const send0 = game.net.send.bind(game.net);
    game.net.send = (m) => {
      if (m.t === 'shot' && mine()) {
        const L = Math.hypot(m.d[0], m.d[1], m.d[2]) || 1, d = { x: m.d[0] / L, y: m.d[1] / L, z: m.d[2] / L };
        const hit = physics.raycast({ x: m.o[0] + d.x * 0.5, y: m.o[1] + d.y * 0.5, z: m.o[2] + d.z * 0.5 }, d, 900);
        return send0({ ...m, wall: hit ? hit.toi + 0.5 : -1 } as typeof m);
      }
      send0(m);
    };
    this.pool = {
      count: (a) => this.me?.pools[a] ?? 0,
      take: (a, n) => {
        const have = this.me?.pools[a] ?? 0, k = Math.max(0, Math.min(have, n));
        if (this.me && k) {
          this.me.pools[a] = have - k;
          this.send({ k: 'load', ammo: a, n: k });
        }
        return k;
      },
    };
    this.attach();
  }

  private pool: NonNullable<Game['weapons']['pool']>;

  /** the game's again (Game.join): its rules on the player and the guns, its screen */
  attach() {
    const g = this.game;
    document.body.classList.add('br');
    g.hud.root.classList.add('br');
    // (health only, as PUBG: no hunger, thirst, bleeding or broken legs)
    g.player.arcade = true;
    // (rounds come out of the pools by calibre: decision 4, no magazines)
    g.weapons.freeReload = true;
    g.weapons.pool = this.pool;
  }

  /** another game played on the page (src/game/modes.ts): as before it was made */
  detach() {
    const g = this.game;
    this.reset();
    document.body.classList.remove('br');
    g.hud.root.classList.remove('br');
    g.player.arcade = false;
    g.weapons.freeReload = false;
    g.weapons.pool = null;
    this.look.zone(null, null, 0);
  }

  /** out of the match by this player's own choice: said to the server, which counts them out at once */
  leave() {
    if (!this.ended) this.send({ k: 'leave' });
    this.ended = true;
  }

  /** as before any match, for the next on this page (Game.toBr) */
  reset() {
    this.phase = 'wait';
    this.me = this.plane = this.zone = null;
    this.ground.clear();
    this.held = 0;
    this.mirror.clear();
    this.worn = { vest: null, helmet: null, pack: null };
    this.air = this.airSaid = this.reviving = null;
    this.jumped = this.ended = false;
    this.asked.clear();
    this.airOf.clear();
    this.target = { g: null, mate: null };
    this.look.clear();
    this.look.flyPlane(null, 0, 0);
    this.look.chute(null, 0, []);
    this.hud.reset();
  }

  /** the connection is gone: the end, or why it went, with the way back */
  closed(reason: string) {
    if (!this.ended) this.hud.closed(reason);
    this.ended = true;
  }

  private send(m: BrC2S) {
    this.game.net.send({ t: 'br', ...m } as never);
  }

  private clock(now?: number) {
    if (now) this.off = now - Date.now();
  }

  get now() {
    return Date.now() + this.off;
  }

  private on(m: { t: 'br' } & BrS2C) {
    switch (m.k) {
      case 'lobby':
        this.clock(m.now);
        this.map = m.map;
        return this.hud.lobby(m, this.off);
      case 'me':
        this.clock(m.now);
        this.me = m;
        return this.mirrorSlots();
      case 'loot':
        if (m.all) this.ground.clear();
        for (const id of m.gone) this.ground.delete(id);
        for (const g of m.add) this.ground.set(g.id, g);
        return;
      case 'plane':
        this.clock(m.now);
        this.plane = m;
        return this.board();
      case 'eject':
        if (this.air === 'plane') this.jump(true);
        return;
      case 'zone':
        this.clock(m.now);
        this.zone = m;
        return;
      case 'state':
        this.phase = m.phase;
        this.map = m.map;
        this.hud.state(m);
        if (m.phase === 'wait' || m.phase === 'count') this.zone = null;
        return this.board();
      case 'out':
        this.ended = true;
        return this.hud.out(m);
      case 'over':
        this.ended = true;
        return this.hud.over(m, !!m.won);
      case 'air':
        if (m.s) this.airOf.set(m.id, m.s);
        else this.airOf.delete(m.id);
        return;
      case 'remap':
        // (that lobby, or this player's match, is on another map: the page is cut for it again)
        // (and straight back in, to that lobby: `go`, src/ui/br/menu.ts)
        // (on this page as it is, its map hidden and that one shown: src/game/modes.ts)
        // (the way in that brought this word let go at once, its connection's own second try with it: see Game.join)
        if (doorGo.br) {
          this.game.joinGen++;
          this.game.net.leaveQueue();
          return void setTimeout(() => doorGo.br!(m.map, `wager=br&size=${m.size}&kills=${m.map}&loadout=${m.code}&go=1`), 0);
        }
        return location.assign(`/battleroyale?wager=br&size=${m.size}&kills=${m.map}&loadout=${m.code}&go=1`);
    }
  }

  /** into the plane, when the match has begun and this player has not left it */
  private board() {
    if (this.phase !== 'plane' || !this.plane || this.jumped || this.air === 'plane') return;
    this.air = 'plane';
    this.game.player.setFly(true);
    this.hud.note('Space to jump, once over the map', 'good');
  }

  private planeAt(t: number, out: THREE.Vector3) {
    const p = this.plane!, dx = p.b[0] - p.a[0], dz = p.b[1] - p.a[1], L = Math.hypot(dx, dz), s = Math.max(0, ((t - p.t0) / 1000) * p.speed);
    return out.set(p.a[0] + (dx / L) * s, p.y, p.a[1] + (dz / L) * s);
  }

  /** whether the plane is over the map now (out of it there is nothing but the gas to land in) */
  private overMap(t = this.now) {
    if (!this.plane) return false;
    const at = this.planeAt(t, _v);
    return at.x > MAPS[this.map].x0 + 10 && at.x < MAPS[this.map].x1 - 10 && at.z > MAPS[this.map].z0 + 10 && at.z < MAPS[this.map].z1 - 10;
  }

  /** seconds until the plane is over the map (0: it is) */
  jumpIn() {
    for (let s = 0; s < 90; s += 0.5) if (this.overMap(this.now + s * 1000)) return s;
    return 0;
  }

  private jump(forced = false) {
    if (this.air !== 'plane' || !this.plane || (!forced && !this.overMap())) return;
    this.jumped = true;
    this.send({ k: 'jump' });
    const p = this.plane, L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
    this.fallVel.set(((p.b[0] - p.a[0]) / L) * p.speed * 0.5, 0, ((p.b[1] - p.a[1]) / L) * p.speed * 0.5);
    this.air = 'fall';
  }

  /** what is under a point: a roof, a floor or the ground */
  private floorUnder(x: number, y: number, z: number) {
    const hit = physics.raycast({ x, y: y + 0.3, z }, { x: 0, y: -1, z: 0 }, 600, SOLID_GROUPS);
    return hit ? hit.point.y : heightAt(this.game.s.world.heights, x, z);
  }

  /** the game's inventory made to hold what the server says is carried (guns and blades in hand, armour and packs worn) */
  private mirrorSlots() {
    const g = this.game, m = this.me!, keep = new Set<string>(), gone: string[] = [];

    for (const s of m.slots) {
      if (!s || (kindOf(s.id) !== 'gun' && kindOf(s.id) !== 'melee' && kindOf(s.id) !== 'nade')) continue;
      keep.add(s.uid);
      // (and again if the game let it go: a game coming in is given the open world's kit, after the slots were filled)
      const had = this.mirror.get(s.uid);
      if (!had || !g.inv.find((i) => i === had)) {
        const it = structuredClone(s) as ItemInstance;
        g.inv.add(it);
        this.mirror.set(s.uid, it);
      }
    }
    for (const u of [...this.mirror.keys()]) if (!keep.has(u)) {
      gone.push(u);
      this.mirror.delete(u);
    }
    for (const k of ['vest', 'helmet', 'pack'] as const) {
      const want = m[k], has = this.worn[k];
      if ((has?.id ?? null) === want && (!has || g.inv.find((i) => i === has))) continue;
      if (has) gone.push(has.uid);
      this.worn[k] = want ? makeItem(want) : null;
      if (this.worn[k]) g.inv.add(this.worn[k]!);
    }
    // (and nothing else: the open world's food and water that a game is given when it comes in, or anything of a life
    // before, is not carried here; the game's inventory holds the slots' things and the worn, and the clothes it keeps on)
    const ours = new Set([...this.mirror.keys(), ...Object.values(this.worn).flatMap((it) => (it ? [it.uid] : []))]);
    for (const [slot, it] of Object.entries(g.inv.slots)) if (it && !ours.has(it.uid) && slot !== 'top' && slot !== 'legs') gone.push(it.uid);
    for (const c of g.inv.containers) for (const q of c.items) if (!ours.has(q.item.uid)) gone.push(q.item.uid);
    if (gone.length) g.trashed(gone);
    g.weapons.validate();
    g.meDirty = true;
    // (what is in hand follows the slot it was taken from: swapped out, the new one comes up in its place)
    const s = m.slots[this.held], want = s ? this.mirror.get(s.uid) ?? null : null;
    if (m.knocked || !this.game.player.pos) return;
    if (want && g.inv.held() !== want) this.hold(want);
    else if (!want && g.inv.held() && ![...this.mirror.values()].includes(g.inv.held()!)) this.hold(null);
  }

  /**
   * A thing into the hands by this mode's own slots, out of wherever the game carries it, and what was in them put
   * back (null: only that). Nothing is refused for want of room here: the server's slots are what is carried, and
   * what the game finds no room for is laid in it again by their next word.
   */
  private hold(it: ItemInstance | null) {
    const g = this.game, was = g.inv.held();
    if (was !== it) {
      g.inv.slots.held = null;
      if (was) g.inv.add(was);
      if (it) {
        g.inv.remove(it);
        g.inv.slots.held = it;
      }
    }
    g.showHands(true);
  }

  private select(k: number) {
    const s = this.me?.slots[k];
    if (!s || this.me?.knocked) return;
    if (HEALS[s.id]) return this.send({ k: 'use', slot: k });
    this.held = k;
    const it = this.mirror.get(s.uid);
    // (a grenade is taken up the game's own way, its pin and its throw as in the open world)
    if (it) this.hold(it);
  }

  private vote() {
    if (this.phase !== 'wait') return;
    const was = this.hud.voted;
    this.send({ k: 'vote', yes: !was });
  }

  /** the keys, in place of the game's own hot keys while playing */
  keys() {
    const input = this.game.input;
    for (let k = 0; k < BR.slots; k++) if (input.pressed(`Digit${k + 1}`)) this.select(k);
    // the wheel: the next or the last slot with a gun or a blade in it (the game's own wheel goes through what is worn on the body)
    if (input.wheel !== 0 && this.me && !this.me.knocked && !this.air && !this.game.weapons.aiming) {
      const dir = input.wheel > 0 ? 1 : -1;
      for (let k = 1; k <= BR.slots; k++) {
        const i = (this.held + dir * k + BR.slots * 2) % BR.slots, s = this.me.slots[i];
        if (s && (kindOf(s.id) === 'gun' || kindOf(s.id) === 'melee')) {
          this.select(i);
          break;
        }
      }
      input.wheel = 0;
    }
    if (input.pressed('KeyV')) this.vote();
    if (input.pressed('Space')) {
      if (this.air === 'plane') this.jump();
      else if (this.air === 'fall') this.air = 'chute';
    }
    if (input.pressed('KeyG') && this.me) {
      const s = this.me.slots[this.held];
      if (s && kindOf(s.id) !== 'melee') this.send({ k: 'drop', slot: this.held });
    }
    if (input.pressed('KeyF')) {
      if (this.target.mate !== null) {
        this.reviving = this.target.mate;
        this.send({ k: 'rev', id: this.reviving, on: true });
      } else if (this.target.g) {
        const g = this.target.g;
        this.send({ k: 'take', id: g.id, slot: this.held });
        this.asked.set(g.id, performance.now());
      }
    }
    if (this.reviving !== null && !input.held('KeyF')) {
      this.send({ k: 'rev', id: this.reviving, on: false });
      this.reviving = null;
    }
  }

  tick(dt: number, cam: THREE.Camera) {
    const g = this.game, p = g.player, now = this.now, me = this.me;
    const playing = this.phase === 'plane' || this.phase === 'live' || this.phase === 'over';
    // the circle, or the waiting area's ring
    const z = this.zone, c = z && playing ? circleAt(z.a, z.b, z.t0, z.t1, now) : null, w = MAPS[this.map].wait;
    this.look.zone(c, playing ? null : { x: w.x, z: w.z, r: w.r }, heightAt(g.s.world.heights, p.pos.x, p.pos.z));
    this.look.ground(this.ground, p.pos, dt);
    this.fly(dt, now);
    // knocked: down on the ground, nothing in hand; and nothing in hand in the air either
    if (this.air && g.inv.held()) this.hold(null);
    g.hud.root.classList.toggle('br-air', !!this.air);
    if (me?.knocked && p.pos) {
      p.prone = true;
      if (g.inv.held()) this.hold(null);
    }
    this.aim(cam);
    // rounds walked over are picked up (Fortnite's way), while there is room for them
    if (me && !me.knocked && !this.air) for (const gr of this.ground.values()) {
      if (!gr.ammo || Math.abs(gr.x - p.pos.x) > 1.6 || Math.abs(gr.z - p.pos.z) > 1.6 || Math.abs(gr.y - p.pos.y) > 1.8) continue;
      if ((me.pools[gr.ammo] ?? 0) >= capOf(gr.ammo, me.pack) || performance.now() - (this.asked.get(gr.id) ?? 0) < 1500) continue;
      this.asked.set(gr.id, performance.now());
      this.send({ k: 'take', id: gr.id, slot: this.held });
    }
    const loaded = (() => {
      const it = g.weapons.equippedItem;
      return it && ITEMS[it.id]?.weapon ? { n: it.loaded ?? 0, ammo: ITEMS[it.id].weapon!.ammo } : null;
    })();
    const out = !!c && Math.hypot(p.pos.x - c.x, p.pos.z - c.z) > c.r;
    this.hud.tick({ now, phase: this.phase, me, held: this.held, loaded, zone: z, circle: c, out, map: this.map, at: p.pos, yaw: p.yaw, plane: this.plane && this.phase === 'plane' ? this.plane : null, air: this.air, jumpIn: this.air === 'plane' ? this.jumpIn() : 0 });
  }

  /** what the eye is on within reach: a knocked teammate to get up, else the thing on the ground nearest the line of sight */
  private aim(cam: THREE.Camera) {
    const g = this.game, p = g.player, me = this.me;
    this.target = { g: null, mate: null };
    if (!me || me.knocked || this.air || this.ended) return;
    for (const m of me.mates) {
      const r = g.remotes.get(m.id);
      if (m.knocked && r && r.pos.distanceTo(p.pos) < BR.reviveReach) {
        this.target.mate = m.id;
        g.prompt = this.reviving === m.id ? `Getting ${m.name} up: stay standing` : `<kbd>F</kbd>Hold to get ${m.name} up <small>10 s, standing</small>`;
        return;
      }
    }
    cam.getWorldDirection(_f);
    let best: Ground | null = null, score = 9;
    for (const gr of this.ground.values()) {
      if (gr.ammo || Math.abs(gr.x - p.pos.x) > 2.8 || Math.abs(gr.z - p.pos.z) > 2.8 || Math.abs(gr.y - p.pos.y) > 2.2) continue;
      _v.set(gr.x - cam.position.x, gr.y + 0.2 - cam.position.y, gr.z - cam.position.z);
      // (only what is looked at, within a few degrees: a door or a car looked at past a thing lying by it is the door's or the car's)
      const d = _v.length(), look = _v.normalize().dot(_f), s = d * 0.25 + (1 - look) * 4;
      if (d < 3.2 && look > 0.93 && s < score) (score = s), (best = gr);
    }
    this.target.g = best;
    if (!best?.item) return;
    const id = best.item.id, t = rarityOf(id), r = RARITY[t], full = me.slots.every((s) => s) && !['vest', 'helmet', 'pack'].includes(kindOf(id)) && !me.slots.some((s) => s?.id === id && (s.qty ?? 1) < stackOf(id));
    g.prompt = `<kbd>F</kbd>Take <b style="color:${r.colour}">${ITEMS[id]?.name ?? id}</b> <small>${r.name}${full ? ` · swaps slot ${this.held + 1}` : ''}</small>`;
  }

  /** the plane, the fall and the canopy: this game moves its own body through the air (the server takes its word up there) */
  private fly(dt: number, now: number) {
    const g = this.game, p = g.player, pl = this.plane;
    const flying = pl && (this.phase === 'plane' || now < (pl.t0 + (Math.hypot(pl.b[0] - pl.a[0], pl.b[1] - pl.a[1]) / pl.speed) * 1000));
    const at = flying ? this.planeAt(now, _v) : null;
    this.look.flyPlane(at, pl ? Math.atan2(-(pl.b[0] - pl.a[0]), -(pl.b[1] - pl.a[1])) : 0, dt);
    // (this game's own fall said to the others, as it changes)
    if (this.air !== this.airSaid) {
      this.airSaid = this.air;
      this.send({ k: 'air', s: this.air === 'fall' || this.air === 'chute' ? this.air : null });
    }
    // (the others still aboard are not seen standing in the air under it; those falling lie flat, face down, as a
    // skydiver does; those under a canopy hang from one)
    const others: { id: number; pos: THREE.Vector3; yaw: number }[] = [];
    for (const [id, r] of g.remotes) {
      const rr = r as unknown as { avatar: { root: THREE.Object3D; dive: number }; yaw: number };
      const st = this.airOf.get(id), root = rr.avatar.root;
      if (at && r.pos.distanceTo(at) < 40 && !st) root.visible = false;
      rr.avatar.dive = st === 'fall' ? -1.35 : 0;
      if (st === 'chute') others.push({ id, pos: r.pos, yaw: rr.yaw });
    }
    g.avatar.dive = this.air === 'fall' ? -1.35 : 0;
    this.look.chute(this.air === 'chute' ? p.pos : null, p.yaw, others);
    if (!this.air || !pl) return;
    if (this.air === 'plane') {
      if (!at) return void this.jump(true);
      p.pos.set(at.x, at.y - 7, at.z);
      p.vel.set(0, 0, 0);
      return;
    }
    const input = g.input, fw = input.held('KeyW') ? 1 : input.held('KeyS') ? -0.5 : 0, rt = (input.held('KeyD') ? 1 : 0) - (input.held('KeyA') ? 1 : 0);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const chute = this.air === 'chute', across = chute ? FLIGHT.chuteGlide : FLIGHT.steer;
    const tx = (fx * (chute ? 0.6 + 0.4 * fw : fw) + rx * rt * 0.7) * across, tz = (fz * (chute ? 0.6 + 0.4 * fw : fw) + rz * rt * 0.7) * across;
    const k = Math.min(1, dt * (chute ? 2 : 1.2));
    this.fallVel.x += (tx - this.fallVel.x) * k;
    this.fallVel.z += (tz - this.fallVel.z) * k;
    this.fallVel.y += ((chute ? -FLIGHT.chuteFall : fw > 0 ? -FLIGHT.dive : -FLIGHT.fall) - this.fallVel.y) * Math.min(1, dt * 2.5);
    p.pos.addScaledVector(this.fallVel, dt);
    // (kept on the map)
    const m = MAPS[this.map];
    p.pos.x = Math.max(m.x0 + 5, Math.min(m.x1 - 5, p.pos.x));
    p.pos.z = Math.max(m.z0 + 5, Math.min(m.z1 - 5, p.pos.z));
    p.vel.copy(this.fallVel);
    const floor = this.floorUnder(p.pos.x, p.pos.y, p.pos.z), up = p.pos.y - floor;
    if (!chute && up < FLIGHT.open) this.air = 'chute';
    if (up < 1.4) {
      // down: on its own feet again
      this.air = null;
      p.pos.y = floor + 0.05;
      p.setFly(false);
      p.vel.set(0, 0, 0);
      this.look.chute(null, 0, others);
      // (and what was in hand before the plane comes back up)
      const s = this.me?.slots[this.held], it = s ? this.mirror.get(s.uid) : null;
      if (it) this.hold(it);
    }
  }
}
