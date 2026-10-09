// The fourth trailer: the Zone has grown, and everything the other three were about. Same
// method as the others (the real game on a clock that only moves when the film says, at
// 128 BPM), two and a half minutes of it, cut another way:
// fewer words, a lens that is held in a hand, time that slows for the things worth looking at,
// and as much of it as can be seen through the player's own eyes, with the game's own HUD.
//
// What it shows is what was added since the last one: the soldier's body and kit, the shop,
// the clinic, the barracks and the workshop, the two new places (Sosnovka, the Motor Pool),
// the service pistol and the rifle out of the weapon packs, the injector, the wheel of calls
// and the jeep with people in it. None of it is said to be coming: all of it is in the game.
//
// Then what the game is played for, which the earlier films told and which has not changed:
// the supply drop and the grenade, the tag, the hunt and the cash-in are the second trailer's
// own shots, played here as they were filmed there, and three of the boards about the money
// are the third's. Between them the film's new boards: what the payouts have come to (read
// off the public record), the world counted, the recordings drawn and played, the map.
//
// As before the people are the game's own player bodies with a small brain, their bullets
// are the game's, and whoever is hit bleeds and falls the way the game makes them. The
// film's own: the cameras, the titles, the grade and the grain over the picture.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import type { Arrangement } from './music';
import { BAR } from './shots';
import { ITEMS, makeItem } from '../sim/items';
import { Economy } from '../sim/economy';
import { SEAT_AT } from '../game/garage';
import { audio } from '../core/audio';
import { buildShots as build2, ARRANGEMENT as SCORE2 } from './shots2';
import { buildShots as build3 } from './shots3';
import type { Level } from './music';

const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
const yawTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(-(bx - ax), -(bz - az));
const b = (bars: number) => bars * BAR;

const HERO = 'Sable';
const KIT = ['life_vest', 'boonie_hat', 'sack_pack'];

// ------------------------------------------------------------------------------------------ the score
// A minor. It is laid under the cut once the cut is known (see the end of buildShots): one
// row a bar, and a hit wherever the picture turns.
const Am = 33, F = 41, C = 36, G = 43, E = 40;
export const ARRANGEMENT: Arrangement = { rows: [], hits: [], risers: [] };
/** how long the film runs, seconds (known once it is built) */
export let SECONDS4 = 0;

type Bld = { id: string; type: string; x: number; z: number; rot: number; floorY: number };
type DoorLike = { id: string; pivot: THREE.Object3D; open: boolean; setOpen(o: boolean, swing?: number): void };
type Drum = { i: number; x: number; y: number; z: number; there: boolean };
type Extra = { g?: string | null; fadeIn?: number; fadeOut?: number; flash?: number; /** plates over the picture: [which, from, until] seconds into the shot */ plates?: [HTMLElement, number, number][] };

export function buildShots(S: Stage): Shot[] {
  const g = S.g, world = S.world;
  const c = world.pois[0] as { x: number; z: number };
  const P = (x: number, z: number, up = 0) => S.at(x, z, up);
  const clock = (window as any).__clock;
  document.body.classList.add('tr-cut4');

  // ------------------------------------------------------------ places
  const builds = world.buildings as Bld[];
  const near = (list: { x: number; z: number }[], x: number, z: number, r: number) => list.some((o) => Math.hypot(o.x - x, o.z - z) < r);
  const trunks = (world.trees as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush'));
  const local = (bl: Bld, lx: number, lz: number) => {
    const co = Math.cos(bl.rot), si = Math.sin(bl.rot);
    return { x: bl.x + lx * co + lz * si, z: bl.z - lx * si + lz * co };
  };
  const inside = (bl: Bld, lx: number, lz: number, up = 0) => { const w = local(bl, lx, lz); return new THREE.Vector3(w.x, bl.floorY + up, w.z); };
  const outside = (bl: Bld, lx: number, lz: number, up = 0) => { const w = local(bl, lx, lz); return P(w.x, w.z, up); };
  const nearest = (type: string, to: { x: number; z: number }) => builds.filter((x) => x.type === type).sort((p, q) => Math.hypot(p.x - to.x, p.z - to.z) - Math.hypot(q.x - to.x, q.z - to.z))[0];
  const site = (name: string) => (world.sites as { name: string; x: number; z: number; rot: number }[]).find((s) => s.name === name)!;
  const hamlet = site('Sosnovka'), pool = site('Motor Pool');
  if (!hamlet || !pool) throw new Error('the two new places are not on this map');
  const shop = nearest('store', hamlet), clinic = nearest('clinic', c), townShop = nearest('store', c);
  const barracks = nearest('barracks', pool), workshop = nearest('garage', pool);
  const SHOP_HD = 3.5, CLINIC_HD = 3.75, BAR_HD = 3.25, WORK_HD = 3.5;
  const doors = g.s.buildings.doors as DoorLike[];
  const doorsOf = (bl: Bld) => doors.filter((d) => d.id.startsWith(bl.id + '_door'));
  const shutAll = () => { for (const d of doors) d.setOpen(false); };
  const flat = (x: number, z: number, r: number) => {
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k < 8; k++) {
      const h = S.ground(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return hi - lo;
  };
  /** open, level ground: nothing built within 17 m, no tree within 9 */
  const open: { x: number; z: number }[] = [];
  for (let r = 60; r <= 250; r += 12) {
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (near(builds, x, z, 17) || near(trunks, x, z, 9) || near(world.props ?? [], x, z, 4) || near(world.rocks ?? [], x, z, 5)) continue;
      if (flat(x, z, 7) > 0.9 || near(open, x, z, 30)) continue;
      open.push({ x, z });
    }
  }
  // a firing line: two open places forty to sixty metres apart that can see each other
  let nest = open[0], mark = open[1];
  {
    let best = -1e9;
    for (const p of open) {
      for (const q of open) {
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < 34 || d > 48 || !S.clearLine(P(p.x, p.z, 1.6), P(q.x, q.z, 1.25))) continue;
        // (nothing standing between them or about him: he is to be seen whole in the glass, and to walk in the open)
        const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
        const back = -trunks.filter((t) => Math.hypot(t.x - q.x, t.z - q.z) < 16).length * 3 - trunks.filter((t) => Math.hypot(t.x - mx, t.z - mz) < d / 2).length - Math.abs(S.ground(p.x, p.z) - S.ground(q.x, q.z)) * 2;
        if (back > best) {
          best = back;
          nest = p;
          mark = q;
        }
      }
    }
  }
  // a duelling ground by the Motor Pool: the nearest open place to it with room to run at somebody
  const field = [...open].sort((p, q) => Math.hypot(p.x - pool.x, p.z - pool.z) - Math.hypot(q.x - pool.x, q.z - pool.z)).find((p) => Math.hypot(p.x - pool.x, p.z - pool.z) > 34) ?? open[0];
  // a rise to stand on at the end: open ground that looks down on the village
  const rise = [...open].filter((p) => { const d = Math.hypot(p.x - c.x, p.z - c.z); return d > 95 && d < 190; }).sort((p, q) => S.ground(q.x, q.z) - S.ground(p.x, p.z))[0] ?? open[0];
  // the road, as the jeep drives it
  const rp = world.road.points as Float32Array, RN = rp.length / 3;
  const R = (i: number) => new THREE.Vector3(rp[i * 3], rp[i * 3 + 1], rp[i * 3 + 2]);
  let mid = 0;
  for (let i = 0; i < RN; i++) if (Math.hypot(rp[i * 3] - c.x, rp[i * 3 + 2] - c.z) < Math.hypot(rp[mid * 3] - c.x, rp[mid * 3 + 2] - c.z)) mid = i;
  const drums = ((g.s.veg.barrels as (Drum | undefined)[]) ?? []).filter((d): d is Drum => !!d);
  const drum = [...drums].sort((p, q) => Math.hypot(p.x - barracks.x, p.z - barracks.z) - Math.hypot(q.x - barracks.x, q.z - barracks.z))[0];
  console.log(`[tr] cut 4: ${open.length} open places; firing line ${Math.hypot(nest.x - mark.x, nest.z - mark.z).toFixed(0)} m; the drum is ${drum ? Math.hypot(drum.x - barracks.x, drum.z - barracks.z).toFixed(0) : '?'} m from the barracks; road ${RN} points, village at ${mid}`);

  // ------------------------------------------------------------ the look
  const overlay = document.getElementById('tr-overlay')!;
  const piece = (cls: string) => {
    const el = document.createElement('div');
    el.className = cls;
    overlay.appendChild(el);
    return el;
  };
  const grain = piece('tr-grain4'), black = piece('tr-black4'), white = piece('tr-flash4');
  piece('tr-vig4');
  const GRADES = ['cold', 'warm', 'war', 'gold', 'dust', 'dim'];
  const grade = (name: string | null) => { for (const n of GRADES) document.body.classList.toggle(`tr-g-${n}`, n === name); };
  let frame = 0;
  const look = (t: number, len: number, o: Extra) => {
    // (the grain is one picture, moved: where to is the frame's own number, so a take repeats)
    frame++;
    grain.style.transform = `translate(${((frame * 73) % 97) - 48}px, ${((frame * 41) % 89) - 44}px)`;
    const a = o.fadeIn ? 1 - ease(t / o.fadeIn) : 0, z = o.fadeOut ? ease((t - (len - o.fadeOut)) / o.fadeOut) : 0;
    black.style.opacity = String(Math.max(a, z));
    white.style.opacity = String(o.flash ? Math.max(0, 1 - t / 0.09) * o.flash : 0);
  };
  /** a lens held in a hand: it breathes and it wanders */
  const hand = (pose: CamPose, t: number, amp = 1, seed = 0): CamPose => {
    const n = (f: number, ph: number) => Math.sin(t * f + ph + seed) * 0.6 + Math.sin(t * f * 2.3 + ph * 1.7 + seed) * 0.4;
    const p = pose.p.clone(), l = pose.l.clone();
    p.x += n(1.9, 0.3) * 0.014 * amp;
    p.y += n(2.3, 1.1) * 0.011 * amp;
    p.z += n(1.7, 2.2) * 0.014 * amp;
    l.x += n(2.9, 4.1) * 0.022 * amp;
    l.y += n(3.3, 5.2) * 0.017 * amp;
    l.z += n(2.6, 0.7) * 0.022 * amp;
    return { ...pose, p, l, roll: (pose.roll ?? 0) + n(1.3, 3.3) * 0.004 * amp };
  };

  // ------------------------------------------------------------ the set
  const shots: Shot[] = [];
  /** where the next shot begins, bars; and where each one did, by name */
  let cur = 0;
  const marks: Record<string, number> = {};
  const add = (len: number, s: Omit<Shot, 'start' | 'end'> & Extra) => {
    const L = b(len), setup = s.setup, after = s.after, start = cur;
    cur += len;
    marks[s.name] = start;
    shots.push({
      ...s,
      start: b(start),
      end: b(start + len),
      setup: async (st) => {
        document.body.classList.remove('tr-cut3');
        grade(s.g ?? null);
        await setup?.(st);
      },
      after: (t, st) => {
        after?.(t, st);
        look(t, L, s);
        for (const [el, from, until] of s.plates ?? []) {
          if (t < from || t >= until) {
            el.style.display = 'none';
            continue;
          }
          show(el, t - from);
          el.style.setProperty('--o', String(Math.min(ease((t - from) / 0.22), ease((until - t) / 0.16))));
        }
      },
    });
  };
  /** shots out of another cut, played here as they were filmed there: the same dice, their own setups and titles */
  const borrow = (src: Shot[], names: string[], third = false) => {
    names.forEach((name, k) => {
      const s = src.find((x) => x.name === name);
      if (!s) throw new Error(`there is no shot "${name}" to borrow`);
      const len = (s.end - s.start) / BAR, setup = s.setup, after = s.after, start = cur;
      cur += len;
      marks[name] = start;
      shots.push({
        ...s,
        start: b(start),
        end: b(start + len),
        seed: src.indexOf(s),
        // (what was "in development" when it was filmed is not any more)
        titles: (s.titles ?? []).filter((ti) => ti.cls !== 'dev'),
        setup: async (st) => {
          if (k === 0) {
            reset();
            grade(null);
          }
          document.body.classList.toggle('tr-cut3', third);
          await setup?.(st);
        },
        after: (t, st) => {
          after?.(t, st);
          look(t, b(len), {});
        },
      });
    });
  };
  const cast = () => S.actors;
  const A = (i: number) => S.actors[i];
  const title = (text: string, at = 0.25, until = 1.6, cls = 'c4') => ({ at, until, text, cls });
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
  const lamp = new THREE.PointLight(0xffe2bd, 0, 10, 1.4);
  g.s.r.scene.add(lamp);
  const handLamp = new THREE.DirectionalLight(0xffe2bd, 0);
  g.weapons.vmScene.add(handLamp);
  const lampOn = (at: THREE.Vector3 | null, power = 9) => {
    lamp.intensity = at ? power : 0;
    handLamp.intensity = at ? 3.1 : 0;
    if (at) lamp.position.copy(at);
  };
  const lampAim = () => handLamp.position.copy(lamp.position).sub(g.s.r.camera.position).normalize().multiplyScalar(10);
  /** what the film itself has laid about, taken away again */
  const laid: string[] = [];
  const lay = (id: string, at: THREE.Vector3, rot = 0.4, set?: (it: any) => void) => {
    const it = makeItem(id) as any;
    set?.(it);
    const l = g.economy.drop(it, at.x, at.y, at.z, rot);
    laid.push(l.uid);
    return l as { uid: string; x: number; y: number; z: number };
  };
  const jeeps = () => [...g.garage.jeeps.values()].filter((j: any) => !j.wreck) as any[];
  const reset = () => {
    for (const a of cast()) {
      delete (a as any).hurt;
      a.rp.avatar.clearWounds();
      (a.rp as any).seat = null;
      a.hide();
    }
    if (g.garage.ride) g.garage.out(false);
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyT', 'KeyR', 'ShiftLeft', 'Mouse0', 'Mouse2']) S.key(k, false);
    if (g.hold) g.setHold(null);
    if (g.use) {
      g.use = null;
      g.weapons.endUse();
    }
    for (const uid of laid.splice(0)) g.economy.take(uid);
    lampOn(null);
    // (and whatever a borrowed cut left about: its boards and its money, its crate and its smoke, its lamps, the map blown up, the board under it)
    document.querySelectorAll<HTMLElement>('.tr-gfx, .tr-money, .tr-cursor').forEach((el) => (el.style.display = 'none'));
    document.body.classList.remove('tr-map-big', 'tr-cut3');
    g.hud.setBoard(null);
    if (g.drops.size) {
      S.mute = true;
      for (const uid of [...g.drops.keys()]) g.removeDrop(uid);
      S.mute = false;
    }
    for (const l of theirLamps) l.intensity = 0;
    S.clean();
    hush();
  };
  const preroll = async (frames: number, cam?: CamPose, each?: () => void) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      if (cam) S.cam = cam;
      each?.();
      for (const a of cast()) a.push();
      clock.advance(1000 / 60);
      if (i % 30 === 29) await new Promise<void>((r) => clock.real.setTimeout(r, 20));
    }
    S.mute = false;
    S.cam = null;
  };
  /** it takes n hits to put this one down, wherever they land */
  const tough = (a: Actor, n: number) => {
    let hits = 0;
    const hurt = a.hurt.bind(a);
    a.hurt = (_amount: number, dir: THREE.Vector3) => hurt(++hits >= n ? 999 : 1, dir, false);
  };
  /** the first-person view, turned toward a point a little at a time */
  const lookAt = (at: THREE.Vector3, k = 0.2) => {
    const p = g.player, cam = g.s.r.camera.position;
    const yaw = Math.atan2(-(at.x - cam.x), -(at.z - cam.z)), pitch = Math.atan2(at.y - cam.y, Math.hypot(at.x - cam.x, at.z - cam.z));
    p.yaw += wrap(yaw - p.yaw) * k;
    p.pitch += (pitch - p.pitch) * k;
  };
  /** on foot, in the first person, along a list of points */
  const stroll = (pts: THREE.Vector3[], sprint: (i: number) => boolean = () => false) => {
    let i = 0;
    return () => {
      const p = g.player;
      while (i < pts.length && Math.hypot(pts[i].x - p.pos.x, pts[i].z - p.pos.z) < 0.75) i++;
      if (i >= pts.length) {
        S.key('KeyW', false);
        S.key('ShiftLeft', false);
        return true;
      }
      p.yaw += wrap(yawTo(p.pos.x, p.pos.z, pts[i].x, pts[i].z) - p.yaw) * 0.22;
      S.key('KeyW', true);
      S.key('ShiftLeft', sprint(i));
      p.vitals.stamina = 300;
      return false;
    };
  };
  /** a straight walk up to a building's front that no tree or thing stands in */
  const lane = (bl: Bld, hd: number, far: number) => {
    for (const lx of [0, 2, -2, 4, -4, 6, -6, 8, -8]) {
      let ok = true;
      for (let z = hd + 5; z <= hd + far && ok; z += 1.5) {
        const w = local(bl, lx, z);
        if (near(trunks, w.x, w.z, 2) || near(world.rocks ?? [], w.x, w.z, 2.5) || near((world.props ?? []).filter((q: any) => !q.far), w.x, w.z, 1.8)) ok = false;
      }
      if (ok) return lx;
    }
    return 0;
  };
  const dress = (a: Actor, x: number, z: number, yaw: number, weapon: string | null, gear = KIT) => {
    a.place(x, z, yaw, weapon, gear);
    // (the rifle as it is carried in this film: with its glass and its cheek rest on)
    if (weapon === 'mosin') a.rp.setWeapon('mosin', ['pu_scope', 'rifle_wrap']);
    return a;
  };

  // ------------------------------------------------------------ the film's own graphics
  const mine: HTMLElement[] = [];
  const g4 = (cls: string, html: string) => {
    const el = document.createElement('div');
    el.className = `tr-gfx ${cls}`;
    el.innerHTML = html;
    el.style.display = 'none';
    overlay.appendChild(el);
    mine.push(el);
    return el;
  };
  const show = (el: HTMLElement, t: number) => {
    el.style.display = '';
    el.style.setProperty('--t', t.toFixed(3));
  };
  /** how far in something has come that starts at `at` (0..1) */
  const inAt = (el: Element | null, t: number, at: number, len = 0.28) => (el as HTMLElement | null)?.style.setProperty('--o', String(ease((t - at) / len)));
  /** numbers that count up to what they are: <b data-n="597"> */
  const count = (root: HTMLElement, t: number, at: (i: number) => number, len = 0.8) =>
    root.querySelectorAll('[data-n]').forEach((el, i) => {
      const n = Number((el as HTMLElement).dataset.n), d = Number((el as HTMLElement).dataset.d ?? 0);
      el.textContent = (n * ease((t - at(i)) / len)).toFixed(d);
    });
  /** a small plate that says what is in the picture: its name, and what is true of it */
  const plate = (name: string, facts: string[]) => g4('card4', `<div class="c4-name">${name}</div><div class="c4-rows">${facts.map((f) => `<span>${f}</span>`).join('')}</div>`);
  const PLATE = {
    injector: plate('COMBAT INJECTOR', ['stops the bleeding', '+15 health', '2.4 seconds']),
    m9: plate('M9 PISTOL', ['9×19 mm', '15 rounds', 'semi-automatic']),
    rifle: plate('SNIPER RIFLE', ['7.62×54R', '5 rounds · bolt action', '3.5× scope']),
    plates: plate('PLATE CARRIER', ['40% less damage to the body', '12 more slots']),
    pack: plate('PATROL PACK', ['16 slots', 'the field rucksack: 30']),
    cap: plate('PATROL CAP + HEADSET', ['10% off a hit to the head', 'thirst comes a fifth slower']),
    jeep: plate('UAZ-469', ['4 seats', '8 on the map', 'runs on what is in the jerrycans']),
  };
  // the card the film opens on: it is the first frame, and the picture a player sees before pressing play
  const card = g4('t4', `
    <div class="t4-kick">THE BROWSER SURVIVAL SHOOTER</div>
    <div class="t4-logo">ZONA</div>
    <div class="t4-line">THE ZONE HAS GROWN</div>
    <div class="t4-tags"><span>NEW GUNS</span><span>NEW GEAR</span><span>NEW GROUND</span><span>PAID IN SOL</span></div>`);

  // What is counted on the boards. The money is the public record at zonapvp.fun/payouts as it
  // stood when this was written (read, not sent to); the rest is counted off the world the
  // film is standing in, as the film is made.
  const LIVE = { asOf: '9 OCT 2026', since: '8 OCT 2026', tags: 11, claimed: 0.36, treasury: 0.27, pays: 0.02 };
  const stocked = new Map<string, number>();
  {
    const eco = new Economy(g.s.buildings.lootPoints, { spawn() {}, despawn() {} });
    eco.populate();
    for (const l of eco.loot.values()) stocked.set(ITEMS[l.item.id].category, (stocked.get(ITEMS[l.item.id].category) ?? 0) + 1);
  }
  const lying = [...stocked.values()].reduce((x, y) => x + y, 0);
  const SORTS: [string, string[]][] = [['AMMUNITION', ['ammo']], ['BLADES AND BATS', ['melee']], ['FOOD AND DRINK', ['food', 'drink']], ['GUNS AND THEIR PARTS', ['weapon', 'attachment']], ['KIT TO WEAR', ['clothing']], ['MEDICAL', ['medical']], ['EVERYTHING ELSE', ['misc', 'tool', 'stash']]];
  const sorts = SORTS.map(([label, cats]) => [label, cats.reduce((n, k) => n + (stocked.get(k) ?? 0), 0)] as [string, number]).sort((x, y) => y[1] - x[1]);
  const WORLD = {
    buildings: builds.length,
    places: world.pois.length,
    spots: g.s.buildings.lootPoints.length,
    crates: g.s.veg.crates.length,
    drums: drums.length,
    jeeps: g.garage.jeeps.size,
  };
  console.log(`[tr] cut 4 counts: ${JSON.stringify(WORLD)}; lying ${lying}: ${sorts.map(([l, n]) => `${l} ${n}`).join(', ')}`);

  // --- the record so far
  const X = (sol: number) => 90 + (sol / 10) * 860, Y = (pays: number) => 372 - (pays / 0.2) * 330;
  const live = g4('eco', `
    <div class="eco-kicker">LIVE ON SOLANA · THE RECORD SO FAR</div>
    <div class="eco-head">AUTOMATIC PAYOUTS ARE <b>ON</b></div>
    <div class="s4">
      <div class="s4-tiles">
        <div class="tile in"><b data-n="${LIVE.tags}">0</b><span>tags cashed in</span></div>
        <div class="tile in"><b data-n="${LIVE.claimed}" data-d="2">0</b><span>SOL claimed in, automatically</span></div>
        <div class="tile in"><b data-n="${LIVE.treasury}" data-d="2">0</b><span>SOL in the treasury</span></div>
        <div class="tile in"><b data-n="${LIVE.pays}" data-d="2">0</b><span>SOL a tag pays</span></div>
      </div>
      <div class="s4-graph in">
        <em>WHAT ONE TAG PAYS, AS THE TREASURY GROWS</em>
        <svg viewBox="0 0 1000 430">
          <line class="ax" x1="90" y1="372" x2="960" y2="372"/><line class="ax" x1="90" y1="372" x2="90" y2="26"/>
          ${[0.05, 0.1, 0.15, 0.2].map((v) => `<line class="gr" x1="90" y1="${Y(v)}" x2="960" y2="${Y(v)}"/><text class="yl" x="78" y="${Y(v) + 9}">${v}</text>`).join('')}
          ${[1, 2.5, 5, 7.5, 10].map((v) => `<text class="xl" x="${X(v)}" y="412">${v} SOL</text>`).join('')}
          <path class="floor" d="M90 ${Y(0.02)} L${X(1)} ${Y(0.02)}"/>
          <path class="curve" pathLength="1" d="M90 ${Y(0.02)} L${X(1)} ${Y(0.02)} L${X(10)} ${Y(0.2)}"/>
          <circle class="now" cx="${X(LIVE.treasury)}" cy="${Y(LIVE.pays)}" r="10"/>
          <text class="nowl" x="${X(LIVE.treasury) + 12}" y="${Y(LIVE.pays) - 20}">TODAY</text>
          <text class="note" x="${X(1) + 90}" y="${Y(0.02) + 36}">NEVER LESS THAN 0.02</text>
          <text class="note" x="${X(5.4)}" y="${Y(0.2 * 0.54) - 30}" text-anchor="end">2% OF THE TREASURY</text>
        </svg>
      </div>
    </div>
    <div class="eco-foot foot4 in">THE PUBLIC RECORD AT <b>ZONAPVP.FUN/PAYOUTS</b> · ${LIVE.asOf}</div>`);

  // --- the world, counted
  const top = Math.max(...sorts.map(([, n]) => n));
  const numbers = g4('eco', `
    <div class="eco-kicker">THE ZONE, COUNTED</div>
    <div class="eco-head">ONE MAP. <b>ALL OF IT IN PLAY.</b></div>
    <div class="n4">
      <div class="n4-tiles">
        <div class="tile in"><b data-n="${WORLD.buildings}">0</b><span>buildings to go into</span></div>
        <div class="tile in"><b data-n="${WORLD.places}">0</b><span>places with a name</span></div>
        <div class="tile in"><b data-n="${WORLD.spots}">0</b><span>spots where loot is left</span></div>
        <div class="tile in"><b data-n="${WORLD.crates}">0</b><span>crates to search</span></div>
        <div class="tile in"><b data-n="${WORLD.drums}">0</b><span>fuel drums that go up</span></div>
        <div class="tile in"><b data-n="${WORLD.jeeps}">0</b><span>jeeps, four seats each</span></div>
      </div>
      <div class="n4-chart in">
        <em>WHAT IS LYING IN THE ZONE WHEN IT IS STOCKED: <b>${lying}</b> THINGS</em>
        ${sorts.map(([label, n]) => `<div class="row"><span>${label}</span><i style="--w:${(n / top).toFixed(3)}"></i><b data-n="${n}">0</b></div>`).join('')}
      </div>
    </div>`);

  // --- what it sounds like: the recordings themselves, drawn, and played as they are drawn
  const WAVES: [string, string, string][] = [['shot_rifle', '7.62×54R RIFLE', 'recorded'], ['shot_pistol', '9 mm PISTOL', 'recorded'], ['shot_quiet', 'SUPPRESSED', 'recorded'], ['bolt', 'THE BOLT', 'recorded'], ['pistol_mag_in', 'A MAGAZINE GOING IN', 'recorded']];
  const sound = g4('eco', `
    <div class="eco-kicker">WHAT IT SOUNDS LIKE</div>
    <div class="eco-head">REAL GUNS, <b>RECORDED</b></div>
    <div class="w4">${WAVES.map(([id, label]) => `<div class="wave in" data-id="${id}"><span>${label}</span><svg viewBox="0 0 1000 100" preserveAspectRatio="none"><path d=""/></svg><i></i></div>`).join('')}</div>
    <div class="eco-foot foot4 in">11 RECORDINGS · THE REST IS MADE AS YOU PLAY: <b>WIND · BIRDS · FOOTSTEPS · ECHOES</b></div>`);
  /** the recordings, read off the files the game plays and drawn as they are */
  const waves = (async () => {
    for (const [id] of WAVES) {
      try {
        const buf = new DataView(await (await fetch(`assets/sounds/${id}.wav`)).arrayBuffer());
        // (16-bit, one channel, 44 bytes of header: scripts/sounds.mjs writes them so)
        const n = (buf.byteLength - 44) >> 1, cols = 500, per = Math.max(1, Math.floor(Math.min(n, 44100 * 1.2) / cols));
        let up = '', down = '';
        for (let k = 0; k < cols; k++) {
          let peak = 0;
          for (let i = k * per; i < (k + 1) * per && i < n; i++) peak = Math.max(peak, Math.abs(buf.getInt16(44 + i * 2, true)) / 32768);
          const h = Math.pow(peak, 0.6) * 46;
          up += `${k ? 'L' : 'M'}${k * 2} ${(50 - h).toFixed(1)} `;
          down = `L${k * 2} ${(50 + h).toFixed(1)} ` + down;
        }
        sound.querySelector(`[data-id="${id}"] path`)?.setAttribute('d', `${up}${down}Z`);
      } catch {
        // (not there: its row stays a flat line)
      }
    }
  })();

  // --- the map, and what was not on it a week ago
  const MAPR = 430;
  const mx = (x: number) => (500 + ((x - 15) / MAPR) * 470).toFixed(1), mz = (z: number) => (500 + ((z - 5) / MAPR) * 470).toFixed(1);
  const firstLater = builds.findIndex((x) => x.type === 'clinic');
  const roadPath = Array.from({ length: RN }, (_, i) => `${i ? 'L' : 'M'}${mx(rp[i * 3])} ${mz(rp[i * 3 + 2])}`).join(' ');
  const SIZE: Record<string, [number, number]> = { house_small: [8, 6.5], house_brick: [10.5, 7.5], barn: [12, 8], shed: [4, 3.2], cabin: [6, 5], guardpost: [4.4, 4.4], police: [14, 9], clinic: [11, 7.5], store: [10, 7], barracks: [13, 6.5], garage: [9, 7] };
  const rect = (bl: Bld, i: number) => {
    const [w, d] = SIZE[bl.type] ?? [6, 6], k = (470 / MAPR) * 2.1;
    return `<rect class="${i >= firstLater ? 'new' : 'old'}" x="${-(w * k) / 2}" y="${-(d * k) / 2}" width="${w * k}" height="${d * k}" transform="translate(${mx(bl.x)} ${mz(bl.z)}) rotate(${(-bl.rot * 180) / Math.PI})"/>`;
  };
  const label = (text: string, x: number, z: number, dx: number, dy: number) => `<g class="lab in"><line x1="${mx(x)}" y1="${mz(z)}" x2="${Number(mx(x)) + dx}" y2="${Number(mz(z)) + dy}"/><circle cx="${mx(x)}" cy="${mz(z)}" r="26"/><text x="${Number(mx(x)) + dx + (dx > 0 ? 8 : -8)}" y="${Number(mz(z)) + dy + 6}" text-anchor="${dx > 0 ? 'start' : 'end'}">${text}</text></g>`;
  const camp = (world.pois as { name: string; x: number; z: number }[]).find((q) => q.name === 'Military Checkpoint')!;
  const map = g4('eco m4', `
    <div class="eco-kicker">THE MAP</div>
    <div class="eco-head"><b>${builds.length - firstLater}</b> NEW BUILDINGS.<br><b>2</b> NEW PLACES.</div>
    <div class="m4-list">
      <p class="in">SOSNOVKA<span>a shop, two houses, a barn</span></p>
      <p class="in">THE MOTOR POOL<span>a barracks, a workshop, a guard post</span></p>
      <p class="in">IN THE VILLAGE<span>a clinic, a shop, a workshop</span></p>
      <p class="in">AT THE CHECKPOINT<span>a barracks with an arms room</span></p>
    </div>
    <svg class="m4-map" viewBox="0 0 1000 1000">
      <circle class="edge" cx="${mx(0)}" cy="${mz(0)}" r="${(400 / MAPR) * 470}"/>
      <path class="road" d="${roadPath}"/>
      ${builds.map(rect).join('')}
      ${label('SOSNOVKA', hamlet.x, hamlet.z, -70, -60)}
      ${label('MOTOR POOL', pool.x, pool.z, 70, -64)}
      ${label('ZELENAYA DOLINA', c.x, c.z, 110, -110)}
      ${label('CHECKPOINT', camp.x, camp.z, 60, 78)}
    </svg>`);

  // ------------------------------------------------------------ the other cuts, to borrow from
  // (what they light their rooms with is theirs and nothing here can reach it: it is found by
  // looking at what lamps there are before they are built and after, and put out between shots)
  const lampsNow = () => {
    const out: THREE.Light[] = [];
    for (const sc of [g.s.r.scene, g.weapons.vmScene] as THREE.Object3D[]) sc.traverse((o) => void ((o as THREE.Light).isLight && !(o as any).isAmbientLight && !(o as any).isHemisphereLight && out.push(o as THREE.Light)));
    return out;
  };
  const lampsBefore = new Set(lampsNow());
  const cut2 = build2(S), cut3 = build3(S);
  const theirLamps = lampsNow().filter((l) => !lampsBefore.has(l));
  document.body.classList.remove('tr-cut3');
  console.log(`[tr] cut 4 borrows from ${cut2.length} and ${cut3.length} shots; ${theirLamps.length} lamps of theirs`);


  // ============================================================ 1. morning (bars 0-5): somebody walks in out of the trees
  {
    const lx = lane(shop, SHOP_HD, 52);
    const from = local(shop, lx, SHOP_HD + 50), to = local(shop, lx, SHOP_HD + 6);
    const dir = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize(), right = new THREE.Vector3(-dir.z, 0, dir.x);
    const walk = (_t: number, _S: Stage, dt: number) => void A(0).go(to.x, to.z, 1.55, dt);
    add(1.5, {
      name: 'card',
      g: 'dim',
      bars: false,
      setup: () => {
        reset();
        S.parkMe();
        shutAll();
      },
      // the place the film is about to walk into, from the trees, held still behind the name
      cam: (t) => {
        const p = P(from.x - dir.x * 9 + right.x * 4, from.z - dir.z * 9 + right.z * 4, 5.5 - t * 0.12);
        return { p, l: new THREE.Vector3(shop.x, shop.floorY + 2, shop.z), fov: 34 };
      },
      after: (t) => show(card, t),
    });
    add(3, {
      name: 'morning',
      g: 'cold',
      flash: 0.7,
      setup: () => {
        reset();
        S.parkMe();
        shutAll();
        dress(A(0), from.x, from.z, yawTo(from.x, from.z, to.x, to.z), 'mosin');
      },
      tick: walk,
      // behind and above, a long lens, sinking toward the shoulders: the place opens out past them
      cam: (t) => {
        const k = ease(t / b(3)), a = A(0).rp.pos;
        const p = a.clone().addScaledVector(dir, -lerp(7.2, 4.4, k)).addScaledVector(right, lerp(1.7, 0.8, k));
        p.y = S.ground(p.x, p.z) + lerp(2.35, 1.8, k);
        return hand({ p, l: new THREE.Vector3(shop.x, shop.floorY + 2.4, shop.z).lerp(a.clone().setY(a.y + 1.3), 0.86), fov: 30 }, t, 0.7);
      },
      titles: [{ at: 1.9, until: 5.2, text: 'THE ZONE HAS GROWN', cls: 'c4s' }],
    });
    add(1, {
      name: 'boots',
      g: 'cold',
      chain: true,
      tick: walk,
      // at the height of the grass, beside the feet
      cam: (t) => {
        const a = A(0).rp.pos;
        const p = a.clone().addScaledVector(right, 1.5).addScaledVector(dir, 0.9 - t * 0.12);
        p.y = S.ground(p.x, p.z) + 0.2;
        return hand({ p, l: a.clone().addScaledVector(dir, 0.35).setY(a.y + 0.3), fov: 34 }, t, 0.6, 2);
      },
    });
    add(1, {
      name: 'face',
      g: 'cold',
      chain: true,
      tick: walk,
      // from in front on a long lens: the cap, the headset, the plates
      cam: (t) => {
        const a = A(0).rp.pos;
        const p = a.clone().addScaledVector(dir, 4.3).addScaledVector(right, -1.25);
        p.y = S.ground(p.x, p.z) + 1.5;
        return hand({ p, l: a.clone().setY(a.y + 1.5), fov: 17 }, t, 0.5, 4);
      },
    });
  }

  // ============================================================ 2. the shop (bars 5-8), through the player's own eyes
  {
    let go: () => boolean = () => true, pressed = false, tin: { x: number; y: number; z: number } | null = null;
    add(2, {
      name: 'shop-door',
      hud: true,
      flash: 0.5,
      setup: () => {
        reset();
        shutAll();
        pressed = false;
        S.kit(['bandage', 'thermos']);
        S.hold(null);
        const lx = lane(shop, SHOP_HD, 14);
        const at = local(shop, lx * 0.4, SHOP_HD + 8.2);
        S.me(at.x, at.z, yawTo(at.x, at.z, local(shop, 0, SHOP_HD).x, local(shop, 0, SHOP_HD).z), 0.05);
        go = stroll([outside(shop, 0, SHOP_HD + 1.6), inside(shop, 0, SHOP_HD - 1.4), inside(shop, -0.6, 1.9)], (i) => i === 0);
        // something on the counter to find
        tin = lay('beans', inside(shop, -1.5, 0.42, 0.795), 0.3);
        lay('water_jug', inside(shop, -0.5, 0.25, 0.795), 1.2);
        lay('bandage', inside(shop, 0.5, 0.4, 0.795), 0.7);
        lampOn(inside(shop, -0.8, 1.6, 2.3), 7);
      },
      tick: () => {
        lampAim();
        const p = g.player, d = Math.hypot(p.pos.x - local(shop, 0, SHOP_HD).x, p.pos.z - local(shop, 0, SHOP_HD).z);
        if (!pressed && d < 2.3) {
          pressed = true;
          S.tap('KeyF');
        }
        // eyes on the sign over the door on the way in, then level
        p.pitch += ((d > 4.5 ? 0.16 : 0) - p.pitch) * 0.1;
        go();
      },
      titles: [title('NEW PLACES', 0.3, 2.3, 'tag4')],
    });
    add(1, {
      name: 'shop-take',
      hud: true,
      chain: true,
      tick: (t) => {
        lampAim();
        if (tin) lookAt(new THREE.Vector3(tin.x, tin.y + 0.05, tin.z), t < 0.2 ? 0.08 : 0.18);
        go();
      },
      cues: [{ at: 0.7, fn: () => S.tap('KeyF') }],
    });
  }

  // ============================================================ 3. the clinic (bars 8-10.5)
  add(1, {
    name: 'clinic',
    g: 'cold',
    flash: 0.4,
    setup: () => {
      reset();
      S.parkMe();
      shutAll();
      dress(A(1), outside(clinic, 3.3, CLINIC_HD + 2.2).x, outside(clinic, 3.3, CLINIC_HD + 2.2).z, yawTo(0, 0, Math.sin(clinic.rot), Math.cos(clinic.rot)) + 2.6, 'm9');
    },
    // up to the board over its door
    cam: (t) => {
      const k = ease(t / b(1));
      return hand({ p: outside(clinic, lerp(7.5, 5.4, k), CLINIC_HD + lerp(13, 9.5, k), lerp(1.2, 1.5, k)), l: inside(clinic, 1.9, CLINIC_HD, lerp(2.0, 2.3, k)), fov: 27 }, t, 0.6, 7);
    },
    titles: [title('PATCH UP', 0.25, 1.75, 'tag4')],
  });
  add(1.5, {
    name: 'inject',
    hud: true,
    setup: async () => {
      reset();
      S.kit(['bandage', 'bandage', 'm9']);
      S.hold(null);
      const at = inside(clinic, -3.2, 1.1), to = inside(clinic, -4.7, -2.4, 1.0);
      S.me(at.x, at.z, yawTo(at.x, at.z, to.x, to.z), -0.12, clinic.floorY);
      g.player.vitals.health = 34;
      g.player.vitals.bleeding = true;
      lampOn(inside(clinic, -3.0, 0.2, 2.4), 9);
      await preroll(12);
    },
    tick: () => {
      lampAim();
      // (hurt until the shot is in)
      if (g.use) g.player.vitals.health = Math.min(g.player.vitals.health, 34);
    },
    cues: [{ at: 0.12, fn: () => g.useItem(g.inv.find((i: any) => i.id === 'bandage')) }],
    plates: [[PLATE.injector, 0.5, 2.6]],
  });

  // ============================================================ 4. arms (bars 10.5-18)
  {
    let gun: { x: number; y: number; z: number } | null = null;
    add(1.5, {
      name: 'arms-room',
      hud: true,
      flash: 0.4,
      setup: async () => {
        reset();
        shutAll();
        S.kit(['bandage']);
        S.hold(null);
        // (whatever the world left on that desk is put by: the eye is on the pistol)
        const desk = inside(barracks, 5.0, 2.35);
        for (const l of [...g.economy.loot.values()] as any[]) if (Math.hypot(l.x - desk.x, l.z - desk.z) < 2.2) g.economy.take(l.uid);
        gun = lay('m9', inside(barracks, 4.5, 2.35, 0.795), 2.2, (it) => (it.loaded = 15));
        lay('box_9mm', inside(barracks, 5.45, 2.3, 0.795), 0.4);
        const at = inside(barracks, 4.55, 0.55), to = inside(barracks, 6.0, -1.3, 1.2);
        S.me(at.x, at.z, yawTo(at.x, at.z, to.x, to.z), -0.05, barracks.floorY);
        lampOn(inside(barracks, 4.9, 0.6, 2.3), 8);
        await preroll(10);
      },
      tick: (t) => {
        lampAim();
        if (gun && t > 0.2 && t < 1.25) lookAt(new THREE.Vector3(gun.x, gun.y + 0.04, gun.z), 0.16);
        // (and up from the desk again with it in the hand)
        if (t >= 1.25) g.player.pitch += (-0.08 - g.player.pitch) * 0.08;
      },
      cues: [
        { at: 0.95, fn: () => S.tap('KeyF') },
        { at: 1.25, fn: () => g.weapons.equip(g.inv.slots.holster ? 'holster' : null) },
      ],
      titles: [title('ARM UP', 0.25, 2.2, 'tag4')],
    });
    // out in the open: somebody comes at you with a bat
    let fired = 0;
    add(2, {
      name: 'pistol',
      hud: true,
      flash: 0.7,
      setup: async () => {
        reset();
        fired = 0;
        S.kit(['m9', ['ammo_9mm', 45], 'bandage']);
        const m9 = g.inv.find((i: any) => i.id === 'm9');
        m9.loaded = 6;
        S.hold('holster');
        const ang = yawTo(field.x, field.z, pool.x, pool.z);
        S.me(field.x, field.z, ang, 0);
        const from = P(field.x - Math.sin(ang) * 27, field.z - Math.cos(ang) * 27);
        A(3).place(from.x, from.z, ang + Math.PI, 'bat', ['boonie_hat']);
        tough(A(3), 4);
        await preroll(10);
      },
      tick: (t, _S, dt) => {
        const foe = A(3);
        if (foe.alive) {
          foe.go(g.player.pos.x, g.player.pos.z, 6.2, dt);
          lookAt(foe.rp.pos.clone().setY(foe.rp.pos.y + 1.2), 0.3);
        }
        S.key('Mouse2', t > 0.2 && t < 2.5);
        // six rounds, as fast as the hand will let them go, and then the magazine
        if (t > 0.55 && fired < 6 && t > 0.55 + fired * 0.24 && foe.alive) {
          fired++;
          S.tap('Mouse0', 50);
        }
      },
      cues: [{ at: 2.55, fn: () => S.tap('KeyR') }],
      plates: [[PLATE.m9, 0.35, 3.2]],
      after: () => {
        if (!A(3).alive && !(A(3) as any).told) {
          (A(3) as any).told = true;
          S.feedKill(HERO, A(3).name, 'M9 Pistol', A(3).pos.distanceTo(g.player.pos));
        }
      },
    });
    // the rifle, slowed until the flash can be looked at
    add(1, {
      name: 'rifle-slow',
      g: 'war',
      flash: 0.5,
      rate: () => 0.16,
      setup: async () => {
        reset();
        S.parkMe();
        (A(3) as any).told = false;
        dress(A(1), nest.x, nest.z, yawTo(nest.x, nest.z, mark.x, mark.z), 'mosin');
        A(1).crouch = true;
        A(1).aim = true;
        A(1).face(P(mark.x, mark.z, 1.2));
        await preroll(30);
      },
      tick: () => {
        A(1).crouch = A(1).aim = true;
      },
      // (slowed this far, the lamp that goes with a shot is a second of white on whoever fired it)
      after: () => {
        g.effects.flashLight.distance = 1.7;
      },
      cues: [{ at: 0.42, fn: () => A(1).fireAt(P(mark.x, mark.z, 14), 0) }],
      // off the muzzle's shoulder, close
      cam: (t) => {
        const a = A(1).rp.pos, d = new THREE.Vector3(mark.x - nest.x, 0, mark.z - nest.z).normalize(), r = new THREE.Vector3(-d.z, 0, d.x);
        const k = ease(t / b(1));
        const p = a.clone().addScaledVector(d, lerp(2.5, 2.2, k)).addScaledVector(r, lerp(1.5, 1.2, k));
        p.y = a.y + 1.0;
        return hand({ p, l: a.clone().addScaledVector(d, 0.75).setY(a.y + 0.98), fov: 26 }, t * 0.3, 0.5, 9);
      },
    });
    // and through its glass
    let shot = false;
    add(2, {
      name: 'scope',
      hud: true,
      flash: 0.4,
      setup: async () => {
        reset();
        shot = false;
        S.kit(['mosin', ['ammo_762', 15], 'bandage'], { mosin: ['pu_scope', 'rifle_wrap'] });
        S.hold('primary');
        const ang = yawTo(nest.x, nest.z, mark.x, mark.z);
        S.me(nest.x, nest.z, ang + 0.05, 0);
        // the one in the glass: walking, unaware
        const d = new THREE.Vector3(mark.x - nest.x, 0, mark.z - nest.z).normalize(), r = new THREE.Vector3(-d.z, 0, d.x);
        A(2).place(mark.x - r.x * 3.2, mark.z - r.z * 3.2, yawTo(0, 0, r.x, r.z), 'p38', ['boonie_hat', 'sack_pack']);
        (A(2) as any).told = false;
        (A(2) as any).side = r;
        // (a rifle round to the body leaves a man standing, in the game: for the film one is enough)
        tough(A(2), 1);
        await preroll(10);
      },
      tick: (t, _S, dt) => {
        const foe = A(2), r = (foe as any).side as THREE.Vector3;
        if (foe.alive) foe.go(mark.x + r.x * 9, mark.z + r.z * 9, 1.5, dt);
        S.key('Mouse2', t > 0.12);
        // led by what he covers while the bullet is in the air
        if (foe.alive) lookAt(foe.rp.pos.clone().addScaledVector(r, 0.1).setY(foe.rp.pos.y + 1.3), t < 0.9 ? 0.12 : 0.4);
        if (!shot && t > 1.7) {
          shot = true;
          S.aimAt(foe.rp.pos.clone().addScaledVector(r, 0.1).setY(foe.rp.pos.y + 1.3));
          S.tap('Mouse0', 50);
        }
        // (the film does not leave it to the wind: the round is on him, and he goes down to it)
        if (shot && t > 1.86 && foe.alive) foe.die(new THREE.Vector3(mark.x - nest.x, 0, mark.z - nest.z).normalize());
      },
      after: () => {
        const foe = A(2);
        if (!foe.alive && !(foe as any).told) {
          (foe as any).told = true;
          S.feedKill(HERO, foe.name, 'Sniper Rifle', foe.pos.distanceTo(g.player.pos));
        }
      },
      titles: [title('NEW GUNS', 0.25, 1.5, 'tag4')],
      plates: [[PLATE.rifle, 1.6, 3.6]],
    });
    // what is worn: three looks at one soldier
    const spot = outside(shop, lane(shop, SHOP_HD, 20), SHOP_HD + 13);
    const stand = new THREE.Vector3(Math.sin(shop.rot), 0, Math.cos(shop.rot));
    add(1.5, {
      name: 'kit',
      g: 'warm',
      flash: 0.5,
      setup: async () => {
        reset();
        S.parkMe();
        dress(A(0), spot.x, spot.z, yawTo(0, 0, stand.x, stand.z), 'mosin');
        await preroll(20);
      },
      cam: (t) => {
        const a = A(0).rp.pos, r = new THREE.Vector3(-stand.z, 0, stand.x), u = (t % (BAR / 2)) / (BAR / 2), n = Math.min(2, Math.floor(t / (BAR / 2)));
        // the plates from in front, the pack from behind, the cap and headset from the side
        const from = [stand.clone().multiplyScalar(2.7).addScaledVector(r, 0.9 - u * 0.3), stand.clone().multiplyScalar(-1.8).addScaledVector(r, -0.6 + u * 0.25), r.clone().multiplyScalar(1.5).addScaledVector(stand, 0.5 - u * 0.2)][n];
        const h = [1.3, 1.3, 1.62][n];
        return hand({ p: a.clone().add(from).setY(a.y + h + 0.05), l: a.clone().setY(a.y + h), fov: [27, 26, 19][n] }, t, 0.45, n * 3);
      },
      plates: [[PLATE.plates, 0.08, BAR / 2 - 0.04], [PLATE.pack, BAR / 2 + 0.06, BAR - 0.04], [PLATE.cap, BAR + 0.06, BAR * 1.5 - 0.04]],
    });
  }

  // ============================================================ 5. together (bars 18-27)
  const yard = outside(barracks, -3, BAR_HD + 9);
  {
    // a stranger with empty hands; the wheel says what a microphone would
    const there = outside(barracks, -1.4, BAR_HD + 12.3);
    const yardNear = outside(barracks, -2.2, BAR_HD + 7.6);
    let pick = 0;
    add(2, {
      name: 'wheel',
      hud: true,
      g: 'warm',
      flash: 0.5,
      setup: async () => {
        reset();
        pick = 0;
        S.kit(['m9', ['ammo_9mm', 30], 'bandage']);
        g.inv.find((i: any) => i.id === 'm9').loaded = 15;
        S.hold('holster');
        S.me(yardNear.x, yardNear.z, yawTo(yardNear.x, yardNear.z, there.x, there.z), 0);
        dress(A(1), there.x, there.z, yawTo(there.x, there.z, yardNear.x, yardNear.z), null);
        A(1).surrender = true;
        await preroll(20);
      },
      tick: (t) => {
        A(1).surrender = t < 2.75;
        S.key('Mouse2', t < 0.85);
        lookAt(A(1).rp.pos.clone().setY(A(1).rp.pos.y + 1.45), 0.2);
        // hold T, push the mouse at "Friendly!" (the last place round, up and to the left), let go
        S.key('KeyT', t > 1.15 && t < 2.35);
        if (t > 1.3 && t < 2.35) {
          pick = Math.min(1, pick + 0.045);
          const a = (7 / 8) * Math.PI * 2;
          g.wheelAt.set(Math.sin(a) * 0.82 * ease(pick), -Math.cos(a) * 0.82 * ease(pick));
        }
      },
      cues: [{ at: 0.45, fn: () => A(1).call('friendly') }, { at: 3.05, fn: () => A(1).call('thanks') }],
      titles: [title('SAY IT WITH THE WHEEL', 0.3, 2.6, 'tag4')],
    });
    add(1, {
      name: 'dance',
      g: 'warm',
      flash: 0.4,
      setup: async () => {
        reset();
        S.parkMe();
        const j = jeeps()[0];
        const yaw = yawTo(yard.x, yard.z, barracks.x, barracks.z) + 1.1;
        j.place([yard.x + 3.6, S.ground(yard.x + 3.6, yard.z + 1) + 0.85, yard.z + 1, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2), 0, 0, 0, 0, 0]);
        j.hp = 600;
        dress(A(0), yard.x - 0.9, yard.z - 0.6, 0.5, null);
        dress(A(1), yard.x + 0.7, yard.z + 0.2, -0.4, null);
        dress(A(2), yard.x - 0.2, yard.z + 1.5, 2.8, null, ['boonie_hat', 'sack_pack']);
        for (const i of [0, 1, 2]) A(i).dance = true;
        await preroll(50);
      },
      tick: () => {
        for (const i of [0, 1, 2]) A(i).dance = true;
      },
      cam: (t) => {
        const m = P(yard.x, yard.z, 1.05), a = 0.9 + t * 0.32;
        return hand({ p: P(yard.x + Math.cos(a) * 5.2, yard.z + Math.sin(a) * 5.2, 0.75), l: m, fov: 38 }, t, 0.8, 5);
      },
      titles: [title('OR DON\'T SAY ANYTHING', 0.15, 1.75, 'c4s')],
    });
  }
  {
    // the jeep, with three aboard: down the road and through the village
    let j: any = null, at = 0;
    const START = Math.max(2, mid - 46);
    const steer = () => {
      if (!j) return;
      while (at < RN - 2 && Math.hypot(rp[at * 3] - j.pos.x, rp[at * 3 + 2] - j.pos.z) > Math.hypot(rp[(at + 1) * 3] - j.pos.x, rp[(at + 1) * 3 + 2] - j.pos.z)) at++;
      let ahead = at, d = 0;
      const want = 7 + Math.abs(j.speed) * 0.55;
      while (ahead < RN - 2 && d < want) {
        d += Math.hypot(rp[(ahead + 1) * 3] - rp[ahead * 3], rp[(ahead + 1) * 3 + 2] - rp[ahead * 3 + 2]);
        ahead++;
      }
      const err = wrap(Math.atan2(-(rp[ahead * 3] - j.pos.x), -(rp[ahead * 3 + 2] - j.pos.z)) - j.yaw);
      S.key('KeyA', err > 0.03);
      S.key('KeyD', err < -0.03);
      const hot = Math.abs(err) > 0.4 && j.speed > 9;
      S.key('KeyW', !hot && j.speed < 15.5);
      S.key('KeyS', hot);
      // whoever rides with you
      for (const [k, i] of [[1, 1], [2, 2]] as [number, number][]) {
        (A(i).rp as any).seat = { jeep: j, at: SEAT_AT[k] };
        A(i).pos.copy(j.pos);
        A(i).yaw = j.yaw;
      }
    };
    const fwd = () => new THREE.Vector3(0, 0, -1).applyQuaternion(j.quat).setY(0).normalize();
    add(1, {
      name: 'get-in',
      hud: true,
      g: 'warm',
      setup: async () => {
        reset();
        j = jeeps()[0];
        at = START;
        const a = R(START), n = R(START + 1), yaw = yawTo(a.x, a.z, n.x, n.z);
        j.place([a.x, a.y + 0.85, a.z, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2), 0, 0, 0, 0, 0]);
        j.hp = 600;
        j.fuel = 40;
        S.kit(['m9', ['ammo_9mm', 30], 'bandage']);
        S.hold(null);
        await preroll(40);
        // from a few paces off its left side: up to the door
        const door = j.point(-1.9, 0, 0.2, new THREE.Vector3()), from = j.point(-4.6, 0, 3.4, new THREE.Vector3());
        S.me(from.x, from.z, yawTo(from.x, from.z, door.x, door.z), -0.05);
        dress(A(1), 0, 0, 0, null);
        dress(A(2), 0, 0, 0, null, ['boonie_hat', 'sack_pack']);
        (j as any).door = door;
        await preroll(6, undefined, () => {
          for (const [k, i] of [[1, 1], [2, 2]] as [number, number][]) (A(i).rp as any).seat = { jeep: j, at: SEAT_AT[k] };
        });
      },
      tick: (t) => {
        const p = g.player, door = (j as any).door as THREE.Vector3;
        for (const [k, i] of [[1, 1], [2, 2]] as [number, number][]) {
          (A(i).rp as any).seat = { jeep: j, at: SEAT_AT[k] };
          A(i).pos.copy(j.pos);
        }
        if (g.garage.ride) return steer();
        const d = Math.hypot(door.x - p.pos.x, door.z - p.pos.z);
        p.yaw += wrap(yawTo(p.pos.x, p.pos.z, door.x, door.z) - p.yaw) * 0.2;
        S.key('KeyW', d > 0.5);
        if (d < 1.2 && t > 0.3) g.garage.use(j);
      },
      titles: [title('RIDE TOGETHER', 0.3, 1.75, 'tag4')],
    });
    add(3.5, {
      name: 'road',
      g: 'warm',
      chain: true,
      flash: 0.8,
      setup: async () => {
        if (!g.garage.ride) g.garage.use(j);
        if (!g.garage.ride) throw new Error('nobody is at the wheel');
      },
      plates: [[PLATE.jeep, b(1.3), b(2.6)]],
      tick: steer,
      cam: (t) => {
        const f = fwd(), r = new THREE.Vector3(-f.z, 0, f.x), at2 = j.pos as THREE.Vector3;
        if (t < b(1.25)) {
          // ahead of it, low, on a long lens: it comes on and fills the picture
          const p = at2.clone().addScaledVector(f, 13 - t * 1.6).addScaledVector(r, 2.3);
          p.y = S.ground(p.x, p.z) + 0.5;
          return hand({ p, l: at2.clone().setY(at2.y + 0.5), fov: 21 }, t, 1.6, 1);
        }
        if (t < b(2.25)) {
          // alongside at the height of the wheels
          const u = t - b(1.25);
          const p = at2.clone().addScaledVector(r, -4.4).addScaledVector(f, 1.4 - u * 0.7);
          p.y = at2.y + 0.15;
          return hand({ p, l: at2.clone().addScaledVector(f, 0.4).setY(at2.y + 0.45), fov: 40 }, t, 2.2, 3);
        }
        // and from over it, as the village comes up
        const u = (t - b(2.25)) / b(1.25);
        const p = at2.clone().addScaledVector(f, -lerp(8, 11, u)).addScaledVector(r, 2.2);
        p.y = at2.y + lerp(4.2, 6.5, u);
        return hand({ p, l: at2.clone().addScaledVector(f, 6.5).setY(at2.y + 1), fov: 44 }, t, 1.2, 6);
      },
    });
    add(1.5, {
      name: 'wheel-view',
      hud: true,
      g: 'warm',
      chain: true,
      flash: 0.4,
      tick: steer,
    });
  }

  // ============================================================ 6. the Motor Pool (bars 27-32)
  {
    // three of them behind the drum at the barracks, three of you in the yard
    const front = (lx: number, lz: number) => outside(barracks, lx, BAR_HD + lz);
    const dAt = drum ? new THREE.Vector3(drum.x, drum.y + 0.5, drum.z) : front(-8, 6);
    const they: [number, THREE.Vector3][] = [[3, dAt.clone().add(new THREE.Vector3(1.3, 0, 0.9))], [4, dAt.clone().add(new THREE.Vector3(-1.2, 0, 1.1))], [5, dAt.clone().add(new THREE.Vector3(0.2, 0, -1.6))]];
    const away = new THREE.Vector3(dAt.x - barracks.x, 0, dAt.z - barracks.z).normalize();
    const us: [number, THREE.Vector3][] = [[0, dAt.clone().addScaledVector(away, 19).add(new THREE.Vector3(2.5, 0, 0))], [1, dAt.clone().addScaledVector(away, 21).add(new THREE.Vector3(-2.2, 0, 1))], [2, dAt.clone().addScaledVector(away, 23)]];
    const fight = () => {
      for (const [i, p] of they) {
        const a = dress(A(i), p.x, p.z, yawTo(p.x, p.z, us[0][1].x, us[0][1].z), i === 4 ? 'mosin' : 'p38', ['boonie_hat']);
        a.foe = A(us[(i - 3) % 3][0]);
        a.skill = 0.12;
        a.crouch = i === 5;
        a.nextShot = 0.5 + (i - 3) * 0.33;
        tough(a, 50);
      }
      for (const [i, p] of us) {
        const a = dress(A(i), p.x, p.z, yawTo(p.x, p.z, dAt.x, dAt.z), i === 2 ? 'mosin' : 'm9');
        a.foe = A(they[i][0]);
        a.skill = 0.2;
        a.crouch = i === 1;
        a.nextShot = 0.3 + i * 0.27;
        tough(a, 50);
      }
    };
    const think = (t: number) => {
      for (const a of cast()) if (a.alive && a.foe) a.think(t);
    };
    add(2, {
      name: 'firefight',
      g: 'war',
      flash: 0.8,
      setup: async () => {
        reset();
        S.parkMe();
        fight();
        await preroll(30);
      },
      tick: (t) => think(t),
      // over the shoulders of your own, the lens shaken by every shot near it
      cam: (t) => {
        const m = us[0][1], k = ease(t / b(2));
        const p = P(m.x + away.x * lerp(2.9, 2.3, k) - away.z * 0.75, m.z + away.z * lerp(2.9, 2.3, k) + away.x * 0.75, 1.62);
        return hand({ p, l: dAt.clone().setY(dAt.y + 0.75), fov: 25 }, t, 2.4, 2);
      },
      titles: [title('NEW GROUND TO FIGHT OVER', 0.3, 2.9, 'c4s')],
    });
    add(1, {
      name: 'drum',
      g: 'war',
      chain: true,
      rate: (t) => (t < 0.22 ? 1 : t < 1.5 ? 0.14 : 0.5),
      tick: (t) => think(t * 0.3 + b(2)),
      cues: [{
        at: 0.3,
        fn: () => {
          // (now they can be hurt)
          for (const [i] of they) delete (A(i) as any).hurt;
          if (drum && drum.there) g.blowBarrel(drum.i, true);
          else g.explode(dAt, true, 'barrel');
        },
      }],
      // wide and low, the drum in the middle of it
      cam: (t) => {
        const side = new THREE.Vector3(-away.z, 0, away.x);
        const p = P(dAt.x + away.x * 10.5 + side.x * 5, dAt.z + away.z * 10.5 + side.z * 5, 0.7);
        return hand({ p, l: dAt.clone().setY(dAt.y + 1.1 + t * 0.25), fov: 40 }, t, t > 0.3 ? 3.2 : 1, 4);
      },
    });
    // and in through the door before the smoke has cleared
    let go: () => boolean = () => true, fired = 0;
    add(2, {
      name: 'breach',
      hud: true,
      g: 'war',
      flash: 0.6,
      setup: async () => {
        reset();
        fired = 0;
        shutAll();
        for (const d of doorsOf(barracks)) d.setOpen(true, 1);
        S.kit(['m9', ['ammo_9mm', 45], 'bandage']);
        g.inv.find((i: any) => i.id === 'm9').loaded = 15;
        S.hold('holster');
        const at = outside(barracks, 0.5, BAR_HD + 7);
        S.me(at.x, at.z, yawTo(at.x, at.z, barracks.x, barracks.z), 0);
        go = stroll([outside(barracks, 0, BAR_HD + 1.2), inside(barracks, 0, BAR_HD - 1.6), inside(barracks, -0.6, 0.9)], (i) => i === 0);
        // one of them left inside, at the far end among the beds
        const in1 = inside(barracks, -4.6, 0.4);
        A(4).place(in1.x, in1.z, yawTo(in1.x, in1.z, barracks.x, barracks.z), 'p38', ['boonie_hat']);
        A(4).pos.y = barracks.floorY;
        (A(4) as any).told = false;
        tough(A(4), 2);
        lampOn(inside(barracks, -1.5, 0.6, 2.3), 10);
        await preroll(10);
      },
      tick: (t) => {
        lampAim();
        const foe = A(4), p = g.player;
        foe.pos.y = barracks.floorY;
        const inDoor = go();
        const l = { x: 0, z: 0 };
        {
          const dx = p.pos.x - barracks.x, dz = p.pos.z - barracks.z, co = Math.cos(barracks.rot), si = Math.sin(barracks.rot);
          l.x = dx * co - dz * si;
          l.z = dx * si + dz * co;
        }
        const seen = l.z < BAR_HD - 0.6;
        S.key('Mouse2', seen);
        if (seen && foe.alive) {
          lookAt(foe.rp.pos.clone().setY(barracks.floorY + 1.2), 0.3);
          foe.face(new THREE.Vector3(p.pos.x, p.pos.y + 1.5, p.pos.z));
          if (fired < 6 && t > 1.35 + fired * 0.2) {
            fired++;
            S.tap('Mouse0', 50);
          }
          if (fired >= 4 && t > 2.25) foe.die(new THREE.Vector3(foe.pos.x - p.pos.x, 0, foe.pos.z - p.pos.z).normalize());
        }
        void inDoor;
      },
      after: () => {
        const foe = A(4);
        if (!foe.alive && !(foe as any).told) {
          (foe as any).told = true;
          S.feedKill(HERO, foe.name, 'M9 Pistol', foe.pos.distanceTo(g.player.pos));
        }
      },
    });
  }

  // ============================================================ 7. the loop the game is played for (out of the second trailer, as it was filmed there)
  // A supply drop, everybody at it, one grenade; a tag off a body, the map giving you away,
  // a door held until the clock runs out, and the tag cashed.
  borrow(cut2, cut2.filter((s) => s.start >= b(8) - 1e-6 && s.start < b(26) - 1e-6).map((s) => s.name));

  // ============================================================ 8. the money: how it works (out of the third trailer), and what it has come to
  {
    /** behind the boards: the map from the air, turned down and out of focus */
    const air = (a0: number, a1: number, r: number, h: number, dur: number) => (t: number): CamPose => {
      const a = lerp(a0, a1, t / dur);
      return { p: P(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0).setY(S.ground(c.x, c.z) + h), l: P(c.x, c.z, 6), fov: 50 };
    };
    const board = () => {
      reset();
      S.parkMe();
      shutAll();
    };
    const tick = (at: number) => ({ at, fn: () => audio.ui('move') });
    borrow(cut3, ['money-1'], true);
    add(3.5, {
      name: 'live',
      g: 'dim',
      bars: false,
      setup: board,
      cam: air(2.3, 2.55, 190, 60, b(3.5)),
      cues: [tick(0.5), tick(0.85), tick(1.2), tick(1.55), tick(2.3), tick(5.0)],
      after: (t) => {
        show(live, t);
        live.querySelectorAll('.tile').forEach((el, i) => inAt(el, t, 0.5 + i * 0.35));
        count(live, t, (i) => 0.55 + i * 0.35, 0.9);
        inAt(live.querySelector('.s4-graph'), t, 2.3, 0.4);
        // (the line is drawn across, and "today" lands on it)
        (live.querySelector('.curve') as SVGPathElement).style.strokeDashoffset = String(1 - ease((t - 2.6) / 1.5));
        for (const cls of ['.now', '.nowl']) (live.querySelector(cls) as SVGElement).style.opacity = String(ease((t - 4.0) / 0.25));
        inAt(live.querySelector('.eco-foot'), t, 5.0);
      },
    });
    borrow(cut3, ['money-3', 'money-4'], true);
    add(3, {
      name: 'numbers',
      g: 'dim',
      bars: false,
      setup: board,
      cam: air(0.9, 1.12, 200, 66, b(3)),
      cues: [tick(0.4), tick(0.65), tick(0.9), tick(1.15), tick(1.4), tick(1.65), tick(2.4)],
      after: (t) => {
        show(numbers, t);
        numbers.querySelectorAll('.n4-tiles .tile').forEach((el, i) => inAt(el, t, 0.4 + i * 0.25));
        count(numbers.querySelector('.n4-tiles') as HTMLElement, t, (i) => 0.45 + i * 0.25, 0.8);
        inAt(numbers.querySelector('.n4-chart'), t, 2.4, 0.35);
        numbers.querySelectorAll('.n4-chart .row').forEach((el, i) => (el as HTMLElement).style.setProperty('--k', String(ease((t - 2.6 - i * 0.16) / 0.7))));
        count(numbers.querySelector('.n4-chart') as HTMLElement, t, (i) => 2.6 + i * 0.16, 0.7);
      },
    });
    const HEARD: [number, () => void, number][] = [
      [0.55, () => audio.gunshot('rifle'), 1.6],
      [1.6, () => audio.gunshot('pistol'), 1.0],
      [2.45, () => audio.gunshot('pistol', undefined, 0, false, true), 0.6],
      [3.05, () => audio.boltCycle(), 1.1],
      [4.05, () => audio.magIn(0), 0.9],
    ];
    add(3, {
      name: 'sound',
      g: 'dim',
      bars: false,
      setup: async () => {
        board();
        await waves;
      },
      cam: air(3.4, 3.62, 185, 58, b(3)),
      cues: HEARD.map(([at, fn]) => ({ at, fn })),
      after: (t) => {
        show(sound, t);
        sound.querySelectorAll('.wave').forEach((el, i) => {
          const [at, , dur] = HEARD[i];
          inAt(el, t, at - 0.12, 0.2);
          // (a line across each as it is heard)
          const k = (t - at) / dur;
          (el.querySelector('i') as HTMLElement).style.cssText = k > 0 && k < 1 ? `left:${(26.2 + k * 72).toFixed(2)}%;opacity:1` : 'opacity:0';
          (el as HTMLElement).classList.toggle('on', k > 0 && k < 1);
        });
        inAt(sound.querySelector('.eco-foot'), t, 4.75);
      },
    });
    add(2, {
      name: 'map',
      g: 'dim',
      bars: false,
      setup: board,
      cam: air(5.0, 5.14, 230, 120, b(2)),
      cues: [tick(0.5), tick(1.0), tick(1.5), tick(2.0)],
      after: (t) => {
        show(map, t);
        map.querySelectorAll('.m4-list .in').forEach((el, i) => inAt(el, t, 0.5 + i * 0.5));
        map.querySelectorAll('.lab').forEach((el, i) => inAt(el, t, 0.5 + i * 0.5, 0.22));
        // (what is new on it comes up out of what was there)
        (map.querySelector('.m4-map') as SVGElement).style.setProperty('--new', String(0.5 + 0.5 * Math.sin(t * 7)));
      },
    });
  }

  // ============================================================ 9. everything at once
  {
    const still = (name: string, bl: Bld, hd: number, word: string, o: { from: [number, number, number]; to: [number, number, number]; at: [number, number, number]; fov: number; lit?: [number, number]; inside?: boolean }) =>
      add(0.5, {
        name,
        g: 'warm',
        flash: 0.55,
        setup: () => {
          reset();
          S.parkMe();
          shutAll();
          for (const d of doorsOf(bl)) d.setOpen(true, 1);
          if (o.lit) lampOn(inside(bl, o.lit[0], o.lit[1], 2.4), 11);
        },
        cam: (t) => {
          const k = t / b(0.5), q = (v: [number, number, number]) => (o.inside ? inside(bl, v[0], v[1], v[2]) : outside(bl, v[0], hd + v[1], v[2]));
          return hand({ p: q(o.from).lerp(q(o.to), k), l: inside(bl, o.at[0], o.at[1], o.at[2]), fov: o.fov }, t, 0.8, name.length * 3);
        },
        titles: [title(word, 0.05, b(0.5) - 0.04, 'word4')],
      });
    still('m-shop', townShop, SHOP_HD, 'THE SHOP', { from: [-6.5, 9, 1.3], to: [-5.2, 7.6, 1.4], at: [0, SHOP_HD, 2.2], fov: 34 });
    still('m-clinic', clinic, CLINIC_HD, 'THE CLINIC', { from: [-3.3, 1.9, 1.5], to: [-2.6, 1.5, 1.5], at: [-4.6, -2.4, 0.7], fov: 50, lit: [-3.2, 0], inside: true });
    still('m-barracks', barracks, BAR_HD, 'THE BARRACKS', { from: [2.8, 2.0, 1.6], to: [2.0, 1.7, 1.5], at: [-3.6, -1.9, 0.6], fov: 52, lit: [-1.5, 0.4], inside: true });
    still('m-workshop', workshop, WORK_HD, 'THE WORKSHOP', { from: [-7, 10, 1.1], to: [-5.6, 8.6, 1.2], at: [-1.5, WORK_HD, 1.5], fov: 36 });
    // bare hands
    let swung = 0;
    add(0.5, {
      name: 'm-fists',
      hud: true,
      g: 'war',
      flash: 0.55,
      setup: async () => {
        reset();
        swung = 0;
        S.kit(['bandage']);
        S.hold(null);
        const ang = yawTo(field.x, field.z, pool.x, pool.z);
        S.me(field.x, field.z, ang, -0.04);
        const at = P(field.x - Math.sin(ang) * 1.25, field.z - Math.cos(ang) * 1.25);
        A(5).place(at.x, at.z, ang + Math.PI, null, ['boonie_hat']);
        tough(A(5), 2);
        await preroll(8);
      },
      tick: (t) => {
        lookAt(A(5).rp.pos.clone().setY(A(5).rp.pos.y + 1.5), 0.3);
        if (swung < 2 && t > 0.08 + swung * 0.36) {
          swung++;
          S.tap('Mouse0', 50);
        }
      },
      titles: [title('FISTS', 0.05, b(0.5) - 0.04, 'word4')],
    });
    // and three abreast, slowed
    const from = P(rise.x, rise.z), toward = new THREE.Vector3(c.x - rise.x, 0, c.z - rise.z).normalize(), across = new THREE.Vector3(-toward.z, 0, toward.x);
    add(0.5, {
      name: 'm-three',
      g: 'gold',
      flash: 0.55,
      rate: () => 0.4,
      setup: async () => {
        reset();
        S.parkMe();
        for (const [i, off, w] of [[0, 0, 'mosin'], [1, -1.5, 'm9'], [2, 1.5, 'mosin']] as [number, number, string][]) dress(A(i), from.x + across.x * off - toward.x * 14, from.z + across.z * off - toward.z * 14, yawTo(0, 0, toward.x, toward.z), w);
        await preroll(40, undefined, () => {
          for (const [i, off] of [[0, 0], [1, -1.5], [2, 1.5]] as [number, number][]) A(i).go(from.x + across.x * off, from.z + across.z * off, 1.5, 1 / 60);
        });
      },
      tick: (_t, _S, dt) => {
        for (const [i, off] of [[0, 0], [1, -1.5], [2, 1.5]] as [number, number][]) A(i).go(from.x + across.x * off + toward.x * 20, from.z + across.z * off + toward.z * 20, 1.5, dt);
      },
      cam: (t) => {
        const a = A(0).rp.pos;
        const p = a.clone().addScaledVector(toward, 5.5);
        p.y = S.ground(p.x, p.z) + 0.55;
        return hand({ p, l: a.clone().setY(a.y + 1.25), fov: 30 }, t, 0.6, 8);
      },
      titles: [title('TOGETHER', 0.05, b(0.5) - 0.04, 'word4')],
    });
  }

  // ============================================================ 10. the name
  {
    const at = P(rise.x, rise.z), toward = new THREE.Vector3(c.x - rise.x, 0, c.z - rise.z).normalize(), across = new THREE.Vector3(-toward.z, 0, toward.x);
    const set = async () => {
      reset();
      S.parkMe();
      const yaw = yawTo(0, 0, toward.x, toward.z);
      const j = jeeps()[0];
      const jp = at.clone().addScaledVector(across, 3.4).addScaledVector(toward, -0.6);
      j.place([jp.x, S.ground(jp.x, jp.z) + 0.85, jp.z, 0, Math.sin((yaw + 0.35) / 2), 0, Math.cos((yaw + 0.35) / 2), 0, 0, 0, 0, 0]);
      dress(A(0), at.x, at.z, yaw, 'mosin');
      dress(A(1), at.x - across.x * 1.3 - toward.x * 0.5, at.z - across.z * 1.3 - toward.z * 0.5, yaw + 0.2, 'm9');
      dress(A(2), at.x + across.x * 1.25 - toward.x * 0.3, at.z + across.z * 1.25 - toward.z * 0.3, yaw - 0.15, 'mosin', ['boonie_hat', 'sack_pack']);
      await preroll(60);
    };
    const pull = (t: number): CamPose => {
      // from behind their shoulders, back and up: three people, a jeep, and the place below them
      const k = ease(t / b(5));
      const p = at.clone().addScaledVector(toward, -lerp(3.4, 9.5, k)).addScaledVector(across, lerp(-0.8, -2.2, k));
      p.y = S.ground(p.x, p.z) + lerp(1.5, 5.2, k);
      return hand({ p, l: P(lerp(at.x, c.x, 0.55), lerp(at.z, c.z, 0.55), 2), fov: 36 }, t, 0.5, 11);
    };
    add(2.5, {
      name: 'name',
      g: 'gold',
      flash: 0.9,
      setup: set,
      cam: pull,
      titles: [
        { at: 0.5, until: b(2.5), text: 'ZONA', cls: 'logo4' },
        { at: 1.6, until: b(2.5), text: 'NEW GUNS &nbsp;·&nbsp; NEW GEAR &nbsp;·&nbsp; NEW GROUND', cls: 'sub4' },
      ],
    });
    add(2.5, {
      name: 'end',
      g: 'dim',
      chain: true,
      bars: false,
      fadeOut: 0.9,
      cam: (t) => pull(t + b(2.5)),
      titles: [{ at: 0.1, until: b(2.5) + 1, text: '<div class="end-logo">ZONA</div><div class="end-line">PLAY FREE IN YOUR BROWSER</div><div class="end-url">WWW.ZONAPVP.FUN</div>', cls: 'end' }],
    });
  }

  shots.sort((x, y) => x.start - y.start);

  // ------------------------------------------------------------ the score, laid under the cut as it came out
  {
    const N = Math.ceil(cur - 1e-6);
    SECONDS4 = N * BAR;
    // how each stretch is played, from the shot it begins on
    const PLAYED: [string, Level][] = [
      ['card', 'low'], ['shop-door', 'pulse'], ['arms-room', 'build'], ['pistol', 'full'], ['rifle-slow', 'tense'], ['kit', 'drive'],
      ['wheel', 'pulse'], ['dance', 'bright'], ['get-in', 'build'], ['road', 'top'], ['firefight', 'full'], ['drum', 'tense'], ['breach', 'full'],
      ['money-1', 'tick'], ['live', 'pulse'], ['money-3', 'tick'], ['money-4', 'pulse'], ['numbers', 'tick'], ['sound', 'low'], ['map', 'build'],
      ['m-shop', 'top'], ['name', 'bright'], ['end', 'end'],
    ];
    const ROUND = [Am, F, C, G];
    // the second trailer's own bars under its own shots, in this film's key
    const KEY: Record<number, [number, boolean]> = { 40: [Am, true], 36: [F, false], 43: [C, false], 38: [G, false], 35: [E, false] };
    const theirs = marks['drop-reveal'];
    let since = 0, was: Level | null = null;
    for (let i = 0; i < N; i++) {
      if (i >= theirs && i < theirs + 18) {
        const [root, , level] = SCORE2.rows[8 + i - theirs];
        const [r, minor] = KEY[root] ?? [Am, true];
        ARRANGEMENT.rows.push([r, minor, level]);
        was = null;
        continue;
      }
      let level: Level = 'low';
      for (const [name, lv] of PLAYED) if (marks[name] !== undefined && marks[name] <= i + 0.01) level = lv;
      since = level === was ? since + 1 : 0;
      was = level;
      const root = level === 'end' ? Am : level === 'build' && since % 2 === 1 ? E : ROUND[since % 4];
      ARRANGEMENT.rows.push([root, root === Am, level]);
    }
    const at = (name: string, plus = 0) => marks[name] * BAR + plus;
    ARRANGEMENT.hits.push(
      [at('morning'), 0.7], [at('shop-door'), 0.6], [at('pistol'), 1], [at('rifle-slow', 0.42), 1.1], [at('scope', 1.7), 1], [at('road'), 1.1],
      [at('firefight'), 0.9], [at('drum', 0.3), 1.3], [at('live'), 0.5], [at('map'), 0.6], [at('m-shop'), 1], [at('name'), 1.25], [at('end'), 0.9],
    );
    ARRANGEMENT.risers.push(
      [at('morning', b(2)), at('shop-door'), 0.4], [at('arms-room'), at('pistol'), 0.9], [at('get-in', -b(0.5)), at('road'), 1],
      [at('drum', -b(0.8)), at('drum', 0.3), 0.7], [at('map'), at('m-shop'), 0.9], [at('name', -b(1)), at('name'), 0.9],
    );
    // and the second trailer's hits and risers, moved to where its shots are now
    const shift = (theirs - 8) * BAR;
    for (const [t, v] of SCORE2.hits) if (t >= 8 * BAR - 0.01 && t < 26 * BAR) ARRANGEMENT.hits.push([t + shift, v]);
    for (const [t0, t1, v] of SCORE2.risers) if (t1 > 8 * BAR && t1 < 26 * BAR) ARRANGEMENT.risers.push([Math.max(t0, 8 * BAR - b(1.5)) + shift, t1 + shift, v]);
    ARRANGEMENT.hits.sort((x, y) => x[0] - y[0]);
    console.log(`[tr] cut 4: ${shots.length} shots, ${N} bars, ${SECONDS4.toFixed(1)} s`);
  }
  return shots;
}
