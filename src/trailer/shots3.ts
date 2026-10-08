// The third trailer: a story, and then how the money works. Same method as the first two
// (shots.ts, shots2.ts): the real game on a clock that only moves when the film says, on a
// 128 BPM grid. Eighty bars this time, two and a half minutes, and none of its scenes are
// theirs.
//
// The story. Mira is run down in a field by a man with a pistol; her hands go up; a rifle
// shot from the trees ends him. The one who fired, Sable, walks out and says FRIENDLY. They
// take the dead man's gun and his tag, take the police station, and hold it against four who
// come for the tag: one falls to the rifle, two take cover behind a fuel drum, the last gets
// in and Mira drops him. They wait out the clock, Sable is paid, and with four tags still in
// his pocket Mira shoots him in the back, says THANKS, and takes them. Every clock starts
// again; the map gives her away; the next ones are already coming.
//
// Then, on boards over the map: where the money comes from, what a tag pays, what keeps it
// fair, and the page where anybody can audit it. Then what is coming, and the name.
//
// The people are the game's own player bodies; their voices, their arms and the words over
// their heads are the game's own wheel (hold T); the bullets, the fuel drum, the tag clocks,
// the messages on the HUD and the death screen are the game's. The film's own: the cameras,
// the titles, the grade, the coins, the big clock, and the boards in the part about money.
// On those boards the figures are the system's own rules; the rows of the payouts page are
// an example (the people in them are the ones in this film) and say so.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage, Title } from './director';
import { BAR } from './shots';
import { BARS3, scoreMusic3 } from './music3';
import { ITEMS, makeItem, TAG_HOLD } from '../sim/items';
import { BARREL } from '../sim/barrels';
import { physics } from '../core/physics';
import { audio } from '../core/audio';
import { publicId } from '../net/client';
import { CONTRACT, X_HANDLE } from '../ui/hud';

export const SECONDS3 = BARS3 * BAR;
export const score = scoreMusic3;

const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = THREE.MathUtils.clamp;
const mix = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
const yawTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(-(bx - ax), -(bz - az));
const b = (bars: number) => bars * BAR;
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** the two the film follows */
const HERO = 'Sable', FRIEND = 'Mira';
/** the wallet the hero is paid into, as the game shortens one (made up: four letters, four letters) */
const HERO_WALLET = 'SabL…e7Qp';
/** the treasury: the wallet that made the coin (read from the chain by the site; see /payouts) */
const TREASURY = 'EPY3EdyATH1bnRqwRMAhcw9kx7ssQJ1LWjrHHEVzi8Pc';
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

type Bld = { id: string; type: string; x: number; z: number; rot: number; floorY: number };
type DoorLike = { id: string; pivot: THREE.Object3D; open: boolean; setOpen(o: boolean, swing?: number): void; toggle(from?: THREE.Vector3): void };
type Drum = { i: number; x: number; y: number; z: number; there: boolean; setThere(on: boolean): void };

export function buildShots(S: Stage): Shot[] {
  const g = S.g, world = S.world;
  const c = world.pois[0] as { x: number; z: number };
  const P = (x: number, z: number, up = 0) => S.at(x, z, up);
  const clock = (window as any).__clock;
  document.body.classList.add('tr-cut3');
  overlay().appendChild(Object.assign(document.createElement('div'), { className: 'tr-vig' }));

  // ------------------------------------------------------------ the cast
  const [SABLE, MIRA, VOLKOV, KESTREL, DMITRI, OKSANA, BEAR] = [0, 1, 2, 3, 4, 5, 6];
  const A = (i: number) => S.actors[i];
  // (a pack for him, a hat for her: who is who from any distance)
  const GEAR: string[][] = [['sack_pack'], ['boonie_hat'], ['life_vest'], ['life_vest'], [], ['suitcase'], ['life_vest', 'suitcase']];
  const put = (i: number, x: number, z: number, yaw: number, weapon: string | null) => A(i).place(x, z, yaw, weapon, GEAR[i]);
  const cast = () => S.actors;

  // ------------------------------------------------------------ finding places to film
  const near = (list: { x: number; z: number }[], x: number, z: number, r: number) => list.some((o) => Math.hypot(o.x - x, o.z - z) < r);
  const trees = world.trees as { kind: string; x: number; z: number }[];
  const trunks = trees.filter((t) => !t.kind.startsWith('bush'));
  const props = (world.props ?? []) as { kind: string; x: number; z: number; y: number; rot: number }[];
  const rocks = (world.rocks ?? []) as { x: number; z: number }[];
  const builds = world.buildings as Bld[];
  const blocked = (x: number, z: number, tr = 2, bd = 12, skip?: Bld) => near(trunks, x, z, tr) || near(builds.filter((o) => o !== skip), x, z, bd) || near(props, x, z, 2.4) || near(rocks, x, z, 3);
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
  for (let r = 50; r <= 230; r += 12) {
    for (let a = 0; a < Math.PI * 2; a += 0.22) {
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (near(builds, x, z, 17) || near(trunks, x, z, 9) || near(props, x, z, 4) || near(rocks, x, z, 5)) continue;
      if (flat(x, z, 7) > 0.9 || near(open, x, z, 40)) continue;
      open.push({ x, z });
    }
  }

  // buildings, in their own frame: x to the right of the front door, z out through it
  const local = (bl: Bld, lx: number, lz: number) => {
    const co = Math.cos(bl.rot), si = Math.sin(bl.rot);
    return { x: bl.x + lx * co + lz * si, z: bl.z - lx * si + lz * co };
  };
  const inside = (bl: Bld, lx: number, lz: number, up = 0) => { const w = local(bl, lx, lz); return new THREE.Vector3(w.x, bl.floorY + up, w.z); };
  const outside = (bl: Bld, lx: number, lz: number, up = 0) => { const w = local(bl, lx, lz); return P(w.x, w.z, up); };
  const doors = g.s.buildings.doors as DoorLike[];
  const doorsOf = (bl: Bld) => doors.filter((d) => d.id.startsWith(bl.id + '_door'));
  const shutAll = () => { for (const d of doors) d.setOpen(false); };
  const station = builds.find((x) => x.type === 'police')!;
  const SHD = 4.5; // half the station's depth: its front wall
  const sdoor = () => doorsOf(station)[0];
  /** a place to stand in the station that nothing is standing in already, as near as can be to the one asked for */
  const freeIn = (lx: number, lz: number): [number, number] => {
    for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [0.9, 0.4], [-0.9, 0.4], [0.9, -0.6], [-0.9, -0.6], [1.4, 0], [-1.4, 0]]) {
      const w = local(station, lx + dx, lz + dz);
      if (!physics.boxOverlaps({ x: w.x, y: station.floorY + 0.95, z: w.z }, 0, 0.3, 0.75, 0.3)) return [lx + dx, lz + dz];
    }
    return [lx, lz];
  };

  /** no tree standing across the way from one place to another (a trunk has no leaves for a ray to hit: its crown is as wide as this) */
  const sightClear = (ax: number, az: number, bx: number, bz: number) => !trees.some((t) => {
    const dx = bx - ax, dz = bz - az, u = ((t.x - ax) * dx + (t.z - az) * dz) / (dx * dx + dz * dz);
    if (u < 0.04 || u > 0.96) return false;
    return Math.hypot(t.x - (ax + dx * u), t.z - (az + dz * u)) < (t.kind.startsWith('bush') ? 1.8 : 3.6);
  });
  // the field of the first scene: a straight run over open ground to the place she is caught (k),
  // a side for the camera to run along, and a place in the trees with a clear sight of it (nest)
  const field = { k: { x: open[0].x, z: open[0].z }, dir: new THREE.Vector3(1, 0, 0), side: 1, nest: { x: open[0].x + 58, z: open[0].z } };
  {
    let best = -1e9;
    for (const o of open) {
      for (let a = 0; a < Math.PI * 2; a += 0.26) {
        const dx = Math.cos(a), dz = Math.sin(a);
        let ok = true;
        for (let d = 0; d <= 42 && ok; d += 2.5) {
          const x = o.x + dx * d, z = o.z + dz * d;
          if (blocked(x, z, 2.2, 14) || (d > 0 && Math.abs(S.ground(x, z) - S.ground(x - dx * 2.5, z - dz * 2.5)) > 0.9)) ok = false;
        }
        if (!ok) continue;
        let side = 0;
        for (const sgn of [1, -1]) {
          let free = true;
          for (let d = -2; d <= 40 && free; d += 3) if (blocked(o.x + dx * d - dz * sgn * 5, o.z + dz * d + dx * sgn * 5, 2.2, 8)) free = false;
          if (free) { side = sgn; break; }
        }
        if (!side) continue;
        for (let n = 0; n < Math.PI * 2; n += 0.3) {
          const nx = o.x + Math.cos(n) * 58, nz = o.z + Math.sin(n) * 58;
          if (near(builds, nx, nz, 8) || near(trunks, nx, nz, 1.2) || near(rocks, nx, nz, 2)) continue;
          const eye = P(nx, nz, 1.64);
          if (!S.clearLine(eye, P(o.x + dx * 3.6, o.z + dz * 3.6, 1.3)) || !S.clearLine(eye, P(o.x, o.z, 1.3))) continue;
          if (!sightClear(nx, nz, o.x, o.z) || !sightClear(nx, nz, o.x + dx * 3.6, o.z + dz * 3.6)) continue;
          // side-on to the two of them reads best; trees round the nest are what he steps out of
          const across = Math.abs(Math.cos(n) * dx + Math.sin(n) * dz);
          const cover = trunks.filter((t) => Math.hypot(t.x - nx, t.z - nz) < 10).length;
          const sc = -across * 30 + Math.min(cover, 6) * 4 - Math.abs(S.ground(nx, nz) - S.ground(o.x, o.z)) * 2;
          if (sc > best) {
            best = sc;
            field.k = { x: o.x, z: o.z };
            field.dir.set(dx, 0, dz);
            field.side = side;
            field.nest = { x: nx, z: nz };
          }
        }
      }
    }
    console.log(`[tr] cut 3: ${open.length} open places; the field at ${field.k.x.toFixed(0)},${field.k.z.toFixed(0)} (score ${best.toFixed(0)})`);
  }
  const K = field.k, RUN = field.dir;
  const runAt = (d: number, across = 0) => ({ x: K.x + RUN.x * d - RUN.z * across, z: K.z + RUN.z * d + RUN.x * across });
  const toNest = new THREE.Vector3(field.nest.x - K.x, 0, field.nest.z - K.z).normalize();

  // the station: the lane up to its door with least in the way, and the ways the four come at it
  let lane = 0;
  {
    let best = 1e9;
    for (const lx of [0, 1.5, -1.5, 3, -3]) {
      let hits = 0;
      for (let lz = SHD + 3; lz < SHD + 38; lz += 2) { const w = local(station, lx, lz); if (blocked(w.x, w.z, 1.8, 6, station)) hits++; }
      if (hits < best) { best = hits; lane = lx; }
    }
  }
  /** places out in front of the station, by angle off its front and distance from its door */
  const front = (ang: number, dist: number) => local(station, Math.sin(ang) * dist, SHD + Math.cos(ang) * dist);
  const lanes: number[] = [];
  {
    const step = outside(station, 1.6, SHD + 2.2, 1.3);
    const free = (ang: number) => {
      for (let d = 12; d <= 66; d += 6) {
        const w = front(ang, d);
        if (near(trunks, w.x, w.z, 1.6) || near(builds.filter((o) => o !== station), w.x, w.z, 5) || !S.clearLine(step, P(w.x, w.z, 1.25))) return false;
      }
      return true;
    };
    for (const gap of [0.2, 0.13, 0.08]) {
      for (let k = 0; k <= 24 && lanes.length < 4; k++) {
        const ang = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.05;
        if (free(ang) && !lanes.some((l) => Math.abs(l - ang) < gap)) lanes.push(ang);
      }
    }
    for (const ang of [0.15, -0.3, 0.55, -0.7]) if (lanes.length < 4 && !lanes.some((l) => Math.abs(l - ang) < 0.12)) lanes.push(ang);
    lanes.sort((x, y) => x - y);
  }

  // the fuel drum: one with open ground on both sides of it, a clear shot at it from twenty-odd
  // metres, and, for choice, another drum near enough to go up with it
  const drums = (g.s.veg.barrels as (Drum | undefined)[]).filter((d): d is Drum => !!d);
  const drumAt = (d: Drum, up = BARREL.centre) => new THREE.Vector3(d.x, d.y + up, d.z);
  let drum = drums[0], drumDir = new THREE.Vector3(1, 0, 0);
  {
    let best = -1e9;
    for (const d of drums) {
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const u = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)); // from the drum toward whoever shoots it
        const sx = d.x + u.x * 16, sz = d.z + u.z * 16;
        if (Math.abs(S.ground(sx, sz) - d.y) > 1.6 || physics.boxOverlaps({ x: sx, y: S.ground(sx, sz) + 1, z: sz }, 0, 0.4, 0.8, 0.4)) continue;
        if (!S.clearLine(P(sx, sz, 1.64), drumAt(d).addScaledVector(u, 0.6))) continue;
        // the two who hide behind it, and the cameras either side
        let ok = true;
        for (const [du, dv] of [[-1.25, 0.55], [-1.3, -0.6], [-7, 0.5], [3.2, 2.2], [2, 9], [-1, 5]]) {
          const x = d.x + u.x * du - u.z * dv, z = d.z + u.z * du + u.x * dv;
          if (physics.boxOverlaps({ x, y: S.ground(x, z) + 1, z }, 0, 0.35, 0.8, 0.35) || Math.abs(S.ground(x, z) - d.y) > 1.2) ok = false;
        }
        if (!ok) continue;
        const friends = drums.filter((o) => o !== d && Math.hypot(o.x - d.x, o.z - d.z) < 5).length;
        const sc = friends * 12 - Math.hypot(d.x - station.x, d.z - station.z) / 15 - Math.abs(S.ground(sx, sz) - d.y) * 3;
        if (sc > best) { best = sc; drum = d; drumDir = u; }
      }
    }
    console.log(`[tr] cut 3: ${drums.length} fuel drums; the one filmed is ${Math.hypot(drum.x - station.x, drum.z - station.z).toFixed(0)} m from the station (score ${best.toFixed(0)})`);
  }
  const drumSide = new THREE.Vector3(-drumDir.z, 0, drumDir.x);
  const byDrum = (along: number, across: number) => ({ x: drum.x + drumDir.x * along + drumSide.x * across, z: drum.z + drumDir.z * along + drumSide.z * across });
  const shooter = byDrum(16, 0);

  // a car under a cover, for the scene about what is coming
  let car = { x: c.x, z: c.z, y: S.ground(c.x, c.z) }, carFrom = 0, carTo = 0.7;
  {
    let best = 0;
    for (const p of props.filter((q) => q.kind.startsWith('covered_car'))) {
      const mid = new THREE.Vector3(p.x, p.y + 0.8, p.z);
      const ok = (a: number) => {
        for (const r of [8.5, 6.8, 5.2]) {
          const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, y = Math.max(S.ground(x, z) + 0.45, p.y + 1.2);
          const from = new THREE.Vector3(x, y, z);
          if (physics.boxOverlaps({ x, y, z }, 0, 0.4, 0.4, 0.4) || !S.clearLine(from, mid.clone().lerp(from, 2.9 / r)) || Math.abs(S.ground(x, z) - p.y) > 1.5) return false;
        }
        return true;
      };
      // the longest run of angles from which it can be seen whole
      for (let a0 = 0; a0 < Math.PI * 2; a0 += 0.15) {
        let n = 0;
        while (n < 12 && ok(a0 + n * 0.08)) n++;
        if (n > best) { best = n; car = { x: p.x, z: p.z, y: p.y }; carFrom = a0; carTo = a0 + (n - 1) * 0.08; }
      }
    }
    console.log(`[tr] cut 3: the car is filmed over ${(carTo - carFrom).toFixed(2)} rad of clear ground`);
  }
  const road: THREE.Vector3[] = [];
  {
    const pts = world.road.points as Float32Array;
    for (let i = 0; i < pts.length; i += 3) if (Math.hypot(pts[i] - c.x, pts[i + 2] - c.z) < 130) road.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
  }
  const roadAt = (k: number) => {
    const f = clamp(k, 0, 1) * (road.length - 1), i = Math.min(road.length - 2, Math.floor(f));
    return road[i].clone().lerp(road[i + 1], f - i);
  };

  // ------------------------------------------------------------ tools of the trade
  const shots: Shot[] = [];
  const add = (start: number, len: number, s: Omit<Shot, 'start' | 'end'>) => shots.push({ ...s, start: b(start), end: b(start + len) });
  const title = (text: string, at = 0.25, until = 1.6, cls = 'big'): Title => ({ at, until, text, cls });
  /** what the HUD is still saying from before the camera rolled */
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
  const GRADES = ['cold', 'warm', 'war', 'gold', 'dust', 'dim'];
  const grade = (name: string | null) => { for (const n of GRADES) document.body.classList.toggle(`tr-g-${n}`, n === name); };
  /** every drum standing again, nothing about to go up */
  const resetDrums = () => {
    g.fuses.length = 0;
    g.drumsBack.length = 0;
    for (const d of drums) if (!d.there) d.setThere(true);
  };
  /** a lamp of the film's own, for a room the sun does not reach (off unless a shot lights it) */
  const lamp = new THREE.PointLight(0xffdfb4, 0, 11, 1.4);
  g.s.r.scene.add(lamp);
  const handLamp = new THREE.DirectionalLight(0xffdfb4, 0);
  g.weapons.vmScene.add(handLamp);
  const lampOn = (at: THREE.Vector3 | null, power = 10) => {
    lamp.intensity = at ? power : 0;
    handLamp.intensity = at ? 1.5 : 0;
    if (at) lamp.position.copy(at);
  };
  const lampAim = () => handLamp.position.copy(lamp.position).sub(g.s.r.camera.position).normalize().multiplyScalar(10);
  /** the set struck: everybody gone, the HUD quiet, the light and the picture back as they were */
  const strike = () => {
    cast().forEach((a) => {
      delete (a as any).hurt;
      a.rp.avatar.clearWounds();
      a.hide();
    });
    // (a body the game itself left, when the film had the player killed)
    for (const uid of [...g.corpses.keys()]) if (!String(uid).startsWith('corpse_tr_')) g.removeCorpse(uid);
    g.said.clear();
    for (const a of cast()) g.hud.say(a.id, '', null);
    lampOn(null);
    hideGfx();
    grade(null);
    document.body.classList.remove('tr-map-big');
    g.deathInfo = '';
    g.hud.setBoard(null);
    g.hud.wheel(false);
    S.clean();
    resetDrums();
    hush();
  };
  /** time that passes before the camera rolls (a body settling): unseen and unheard */
  const preroll = async (frames: number, cam?: CamPose) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      if (cam) S.cam = cam;
      for (const a of cast()) a.push();
      clock.advance(1000 / 60);
      if (i % 30 === 29) await new Promise<void>((r) => clock.real.setTimeout(r, 20));
    }
    S.mute = false;
    S.cam = null;
    hush();
  };
  /** a camera circling a point */
  const orbit = (mid: THREE.Vector3, r0: number, r1: number, a0: number, a1: number, h0: number, h1: number, fov: number, dur: number) => (t: number): CamPose => {
    const k = ease(t / dur), a = lerp(a0, a1, k), r = lerp(r0, r1, k);
    const p = new THREE.Vector3(mid.x + Math.cos(a) * r, 0, mid.z + Math.sin(a) * r);
    p.y = Math.max(S.ground(p.x, p.z) + 0.45, mid.y + lerp(h0, h1, k));
    return { p, l: mid, fov };
  };
  /** it takes n hits to put this one down, wherever they land */
  const tough = (a: Actor, n: number) => {
    let hits = 0;
    const hurt = a.hurt.bind(a);
    a.hurt = (_amount: number, dir: THREE.Vector3) => hurt(++hits >= n ? 999 : 1, dir, false);
  };
  /** the hero through his own eyes: where he stands, what he carries, what is in his hands */
  const eyes = (x: number, z: number, yaw: number, pitch: number, kit: (string | [string, number])[], slot: string | null, y?: number, mods: Record<string, string[]> = {}) => {
    S.kit(kit, mods);
    S.hold(slot);
    S.me(x, z, yaw, pitch, y);
    g.hud.setBoard(null);
  };
  /** somebody else's tag, as it lies in a pocket: whose it was, and how long it has been carried (undefined: just taken, the clock not started) */
  const tagOf = (owner: string, held?: number) => {
    const it = makeItem('dogtag') as any;
    it.owner = owner;
    it.pid = `film-${owner}`;
    if (held !== undefined) {
      it.holder = publicId();
      it.held = held;
    }
    return it;
  };
  const pocket = (...tags: any[]) => {
    for (const t of tags) if (g.inv.add(t)) throw new Error('no pocket takes the tag');
    g.inventoryChanged();
    g.tickTags(0);
  };
  const myTag = (owner: string) => g.inv.find((i: any) => i.id === 'dogtag' && i.owner === owner);
  /** turn the eyes toward a point, a part of the way each frame */
  const look = (at: THREE.Vector3, k = 0.2) => {
    const p = g.player, cam = g.s.r.camera.position;
    const yaw = Math.atan2(-(at.x - cam.x), -(at.z - cam.z)), pitch = Math.atan2(at.y - cam.y, Math.hypot(at.x - cam.x, at.z - cam.z));
    p.yaw += Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw)) * k;
    p.pitch += (pitch - p.pitch) * k;
  };
  /** the hero is hit: what the game does to you when a round lands */
  const hitMe = (amount: number, from: number, cause = 'gunshot wounds') => {
    g.weapons.flinch(1.5);
    g.hud.hitFrom(from);
    g.player.damage(amount, cause);
    if (!g.player.dead) g.player.bleed();
  };
  const dist = (a: { x: number; z: number }, q: { x: number; z: number }) => Math.hypot(a.x - q.x, a.z - q.z);

  // ============================================================ 1. the valley (bars 0-2)
  add(0, 2, {
    name: 'valley',
    setup: () => {
      strike();
      S.parkMe();
      shutAll();
      grade('cold');
    },
    // low over the grass of the field where it is about to happen, the trees coming up
    cam: (t) => {
      const k = t / b(2);
      const from = runAt(64, field.side * 14), to = runAt(40, field.side * 9);
      const p = P(lerp(from.x, to.x, ease(k)), lerp(from.z, to.z, ease(k)), lerp(7.5, 2.2, ease(k)));
      const l = P(runAt(8).x, runAt(8).z, 1.4);
      return { p, l, fov: 46, roll: 0.01 * Math.sin(t * 1.7) };
    },
    titles: [{ at: 0.5, until: 1.9, text: 'ZELENAYA DOLINA', cls: 'small' }, title('OUT HERE', 2.0, 3.65)],
  });

  // ============================================================ 2. run down (bars 2-6.5)
  {
    const M = () => A(MIRA), V = () => A(VOLKOV);
    const wide = (du: number, dv: number) => { const m = M().pos; return new THREE.Vector3(m.x + RUN.x * du - RUN.z * dv * field.side, 0, m.z + RUN.z * du + RUN.x * dv * field.side); };
    add(2, 2.5, {
      name: 'chase',
      setup: () => {
        strike();
        S.parkMe();
        grade('cold');
        const m0 = runAt(31), v0 = runAt(40);
        put(MIRA, m0.x, m0.z, yawTo(m0.x, m0.z, K.x, K.z), null).bleeding = true;
        put(VOLKOV, v0.x, v0.z, yawTo(v0.x, v0.z, K.x, K.z), 'p38');
        M().rp.avatar.clearWounds();
      },
      tick: (t, _S, dt) => {
        // she runs for the place she will be caught; he keeps a dozen paces behind and shoots as he comes
        M().go(K.x, K.z, 6.1, dt);
        M().bleeding = true;
        if (dist(V().pos, M().pos) > 8) V().go(M().pos.x, M().pos.z, 6.4, dt);
        else V().go(M().pos.x, M().pos.z, 5.2, dt);
        V().aim = t > 0.5;
        V().sprint = false;
      },
      cues: [
        // (wide of her: the dirt jumps beside her feet)
        ...[0.85, 2.0, 3.25, 4.2].map((at, i) => ({ at, fn: () => V().fireAt(M().chest().add(new THREE.Vector3(-RUN.z, 0, RUN.x).multiplyScalar((i % 2 ? 1 : -1) * 1.1)).setY(M().pos.y + 0.2), 0) })),
        { at: 1.35, fn: () => M().call('help') },
      ],
      // beside her, low, a little ahead: her in the front of the picture, him in the back of it
      cam: (t) => {
        const k = ease(t / b(2.5));
        const p = wide(lerp(-3.4, -2.2, k), lerp(4.6, 3.6, k));
        p.y = S.ground(p.x, p.z) + lerp(0.95, 1.2, k);
        const l = mix(M().chest(), V().chest(), 0.22);
        return { p, l, fov: 38, roll: 0.012 * Math.sin(t * 9) };
      },
    });
    add(4.5, 2, {
      name: 'cornered',
      chain: true,
      setup: () => {
        // she has nowhere left to run to
        const m = M();
        m.pos.set(K.x, S.ground(K.x, K.z), K.z);
        const v0 = runAt(9.5);
        V().pos.set(v0.x, S.ground(v0.x, v0.z), v0.z);
      },
      tick: (t, _S, dt) => {
        const m = M(), v = V();
        m.sprint = false;
        m.yaw = yawTo(m.pos.x, m.pos.z, v.pos.x, v.pos.z);
        m.surrender = t > 0.25;
        v.aim = true;
        if (dist(v.pos, m.pos) > 3.6) v.go(m.pos.x, m.pos.z, 2.3, dt);
        v.sprint = false;
        v.face(m.chest());
      },
      rate: () => 0.62,
      // over her shoulder: the pistol coming, her hands in the air
      cam: (t) => {
        const k = ease(t / b(2));
        const m = M().pos;
        const p = new THREE.Vector3(m.x - RUN.x * lerp(2.9, 2.2, k) - RUN.z * field.side * 1.35, 0, m.z - RUN.z * lerp(2.9, 2.2, k) + RUN.x * field.side * 1.35);
        p.y = S.ground(p.x, p.z) + lerp(1.6, 1.5, k);
        return { p, l: mix(V().chest(), M().head(), 0.2), fov: lerp(42, 35, k) };
      },
      titles: [title('NOBODY IS COMING TO SAVE YOU', 0.3, 3.5)],
    });
    // ============================================================ 3. the shot (bars 6.5-8)
    let range = 58;
    const fromNest = new THREE.Vector3(K.x - field.nest.x, 0, K.z - field.nest.z).normalize();
    add(6.5, 0.75, {
      name: 'the-shot',
      chain: true,
      setup: () => {
        const v = V();
        v.aim = true;
        tough(v, 1);
        range = Math.round(dist(field.nest, v.pos));
        v.onDeath = () => S.feedKill(HERO, v.name, ITEMS.mosin.name, range);
        // (the one who fires is in the trees, out of the picture: the game's own rifle, its own round)
        eyes(field.nest.x, field.nest.z, yawTo(field.nest.x, field.nest.z, v.pos.x, v.pos.z), 0, ['mosin', ['ammo_762', 10], 'bandage'], 'primary', undefined, { mosin: ['pu_scope'] });
        hush();
      },
      tick: () => {
        const m = M(), v = V();
        m.surrender = true;
        m.yaw = yawTo(m.pos.x, m.pos.z, v.pos.x, v.pos.z);
        if (v.alive) v.face(m.chest());
        S.key('Mouse2', true);
        S.aimAt(v.alive ? v.chest().setY(v.pos.y + 1.4) : v.pos.clone().setY(v.pos.y + 0.4));
      },
      cues: [
        { at: 0.42, fn: () => S.tap('Mouse0', 60) },
        // (and if the round went past him, he drops all the same: this is the story's shot)
        { at: 0.9, fn: () => { if (V().alive) V().die(fromNest); } },
      ],
      rate: () => (V().alive ? 0.5 : 0.55),
      // beside her, up the barrel of his pistol: the last thing either of them expects
      cam: (t) => {
        const k = ease(t / b(0.75));
        const m = M().pos, v = V();
        const p = new THREE.Vector3(m.x + RUN.x * 0.5 - RUN.z * field.side * lerp(1.55, 1.3, k), 0, m.z + RUN.z * 0.5 + RUN.x * field.side * lerp(1.55, 1.3, k));
        p.y = S.ground(p.x, p.z) + lerp(1.2, 1.3, k);
        return { p, l: v.rp.pos.clone().setY(v.rp.pos.y + (v.alive ? 1.38 : 0.75)), fov: lerp(36, 31, k) };
      },
    });
    add(7.25, 0.75, {
      name: 'from-the-trees',
      chain: true,
      hud: true,
      setup: () => {
        S.key('Mouse2', false);
        S.key('ShiftLeft', false);
        if (V().alive) V().die(fromNest);
      },
      tick: (t) => {
        const m = M();
        m.surrender = true;
        // the rifle comes down; two small figures in the grass, one of them still standing
        look(m.chest(), 0.1);
        g.player.pitch += 0.0006 * Math.sin(t * 3);
      },
      titles: [title('ALMOST NOBODY', 0.1, 1.35, 'top')],
    });

    // ============================================================ 4. friendly (bars 8-10.5)
    const S0 = () => A(SABLE);
    add(8, 2.5, {
      name: 'friendly',
      chain: true,
      setup: () => {
        S.key('Mouse2', false);
        S.key('ShiftLeft', false);
        S.parkMe();
        grade('warm');
        hush();
        const m = M().pos;
        put(SABLE, m.x + toNest.x * 12.5, m.z + toNest.z * 12.5, yawTo(m.x + toNest.x * 12.5, m.z + toNest.z * 12.5, m.x, m.z), 'mosin');
      },
      tick: (t, _S, dt) => {
        const m = M(), s = S0();
        // she turns, hands still up, to whoever is walking out of the trees
        const want = yawTo(m.pos.x, m.pos.z, s.pos.x, s.pos.z);
        m.yaw += Math.atan2(Math.sin(want - m.yaw), Math.cos(want - m.yaw)) * 0.12;
        if (dist(s.pos, m.pos) > 3.3) s.go(m.pos.x, m.pos.z, 2.9, dt);
        s.sprint = false;
        m.surrender = t < 2.55;
      },
      cues: [
        { at: 0.95, fn: () => { const s = S0(); s.weapon = null; s.rp.setWeapon(null, []); } },
        { at: 1.3, fn: () => S0().call('friendly') },
        { at: 3.15, fn: () => M().call('thanks') },
      ],
      // the two of them, side on, the dead man in the grass between the camera and them
      cam: (t) => {
        const k = ease(t / b(2.5));
        const m = M().pos, s = S0().pos;
        const mid = new THREE.Vector3((m.x + s.x) / 2, 0, (m.z + s.z) / 2);
        const out = new THREE.Vector3(-toNest.z, 0, toNest.x).multiplyScalar(field.side);
        const p = new THREE.Vector3(mid.x + out.x * lerp(12, 6.4, k) + toNest.x * lerp(-2, 0.5, k), 0, mid.z + out.z * lerp(12, 6.4, k) + toNest.z * lerp(-2, 0.5, k));
        p.y = S.ground(p.x, p.z) + lerp(1.0, 1.3, k);
        return { p, l: new THREE.Vector3(mid.x, S.ground(mid.x, mid.z) + 1.3, mid.z), fov: lerp(40, 34, k) };
      },
      titles: [{ at: 3.75, until: 4.6, text: 'EIGHT THINGS TO SAY · NO MICROPHONE', cls: 'small' }],
    });

    // ============================================================ 5. the wheel (bars 10.5-12)
    add(10.5, 1.5, {
      name: 'wheel',
      chain: true,
      hud: true,
      setup: () => {
        const s = S0().pos.clone(), m = M();
        S0().hide();
        grade('warm');
        eyes(s.x, s.z, yawTo(s.x, s.z, m.pos.x, m.pos.z), -0.03, ['mosin', ['ammo_762', 10], 'bandage'], null);
        m.surrender = false;
        hush();
      },
      tick: (t, _S, dt) => {
        const m = M();
        look(m.head(), 0.3);
        m.yaw = yawTo(m.pos.x, m.pos.z, g.player.pos.x, g.player.pos.z);
        S.key('KeyT', t > 0.22 && t < 1.42);
        // the mouse, pushed up and to the right: OVER HERE
        if (t > 0.5 && t < 0.95) {
          g.input.mouseDX += 330 * dt;
          g.input.mouseDY -= 330 * dt;
        }
      },
      cues: [{ at: 2.05, fn: () => M().call('omw') }],
      titles: [title('THE WHEEL · HOLD T', 0.15, 2.65, 'top')],
    });

    // ============================================================ 6. the spoils (bars 12-14)
    add(12, 2, {
      name: 'spoils',
      chain: true,
      hud: true,
      setup: () => {
        const v = V().pos;
        grade('warm');
        // him on one side of the body, her on the other
        const mine = { x: v.x + toNest.x * 1.7, z: v.z + toNest.z * 1.7 }, hers = { x: v.x - toNest.x * 1.5 + toNest.z * 0.5, z: v.z - toNest.z * 1.5 - toNest.x * 0.5 };
        eyes(mine.x, mine.z, yawTo(mine.x, mine.z, v.x, v.z), -0.5, ['mosin', ['ammo_762', 10], 'bandage'], 'primary');
        put(MIRA, hers.x, hers.z, yawTo(hers.x, hers.z, v.x, v.z), null).crouch = true;
        hush();
      },
      tick: (t) => {
        const m = M(), v = V().pos;
        // down at what he left, then up at her
        look(t < 1.9 ? new THREE.Vector3(v.x, v.y + 0.25, v.z) : m.head(), 0.09);
        if (t > 1.5) m.yaw = yawTo(m.pos.x, m.pos.z, g.player.pos.x, g.player.pos.z);
      },
      cues: [
        { at: 0.55, fn: () => { const m = M(); m.weapon = 'p38'; m.rp.setWeapon('p38', []); audio.ui('pickup'); } },
        { at: 1.05, fn: () => (M().crouch = false) },
        { at: 1.2, fn: () => { pocket(tagOf(V().name)); audio.ui('pickup'); } },
      ],
      titles: [title('HIS GUN FOR HER · HIS TAG FOR YOU', 0.2, 1.95, 'top'), title('HOLD A TAG 10 MINUTES · GET PAID', 2.05, 3.65)],
    });
  }

  // ============================================================ 7. the road to the station (bars 14-16)
  {
    const walkTo = (i: number, lx: number, lz: number, speed: number, dt: number) => { const w = local(station, lx, lz); return A(i).go(w.x, w.z, speed, dt); };
    add(14, 2, {
      name: 'road',
      setup: () => {
        strike();
        S.parkMe();
        shutAll();
        grade('warm');
        const s0 = local(station, lane + 0.9, SHD + 31), m0 = local(station, lane - 0.9, SHD + 32.4), d0 = local(station, 0, SHD);
        put(SABLE, s0.x, s0.z, yawTo(s0.x, s0.z, d0.x, d0.z), 'mosin');
        put(MIRA, m0.x, m0.z, yawTo(m0.x, m0.z, d0.x, d0.z), 'p38');
      },
      tick: (_t, _S, dt) => {
        walkTo(SABLE, lane * 0.4 + 0.7, SHD + 4, 4.3, dt);
        walkTo(MIRA, lane * 0.4 - 0.9, SHD + 5.4, 4.3, dt);
        A(SABLE).sprint = A(MIRA).sprint = false;
      },
      // behind the two of them and rising: the station ahead
      cam: (t) => {
        const k = ease(t / b(2));
        const s = A(SABLE).pos, m = A(MIRA).pos;
        const back = local(station, lane, SHD + 80), d = new THREE.Vector3(back.x - station.x, 0, back.z - station.z).normalize();
        const mid = new THREE.Vector3((s.x + m.x) / 2, 0, (s.z + m.z) / 2);
        const p = new THREE.Vector3(mid.x + d.x * lerp(5.2, 7.5, k) + d.z * 1.4, 0, mid.z + d.z * lerp(5.2, 7.5, k) - d.x * 1.4);
        p.y = S.ground(p.x, p.z) + lerp(1.45, 2.9, k);
        return { p, l: mix(new THREE.Vector3(mid.x, S.ground(mid.x, mid.z) + 1.3, mid.z), outside(station, 0, SHD - 2, 2.2), 0.45), fov: 44 };
      },
      titles: [title('THE POLICE STATION', 0.3, 2.3), { at: 2.4, until: 3.65, text: 'STONE WALLS · ONE DOOR · THE BEST GUNS ON THE MAP', cls: 'small' }],
    });

    // ============================================================ 8. in (bars 16-17.5)
    const camIn = inside(station, 1.7, SHD - 5.0, 1.45), doorIn = inside(station, 0.1, SHD - 0.2, 1.3);
    const fromInside = S.clearLine(camIn, doorIn);
    console.log(`[tr] cut 3: the station is entered ${fromInside ? 'filmed from inside' : 'filmed from the yard (no clear place for a camera inside)'}; lane ${lane}; the four come at ${lanes.map((l) => l.toFixed(2)).join(', ')}`);
    add(16, 1.5, {
      name: 'in',
      setup: () => {
        strike();
        S.parkMe();
        shutAll();
        grade('war');
        const s0 = local(station, 0.25, SHD + 3.4), m0 = local(station, -0.6, SHD + 5.2), d0 = local(station, 0, SHD);
        put(SABLE, s0.x, s0.z, yawTo(s0.x, s0.z, d0.x, d0.z), 'mosin').aim = true;
        put(MIRA, m0.x, m0.z, yawTo(m0.x, m0.z, d0.x, d0.z), 'p38').aim = true;
        if (fromInside) lampOn(inside(station, 0.6, SHD - 3.2, 2.2), 7);
      },
      tick: (t, _S, dt) => {
        // through the door one after the other, guns first
        const through = (i: number, lx: number, lz: number, from: number) => {
          if (t < from) return;
          const a = A(i), w = local(station, 0.15, SHD + 0.4);
          const out = (a.pos.x - station.x) * Math.sin(station.rot) + (a.pos.z - station.z) * Math.cos(station.rot) > SHD + 0.5;
          if (out) a.go(w.x, w.z, 3.3, dt);
          else {
            const to = local(station, lx, lz);
            a.go(to.x, to.z, 3.0, dt);
            a.pos.y = station.floorY;
          }
          a.sprint = false;
          a.aim = true;
        };
        through(SABLE, 0.8, SHD - 3.0, 0.35);
        through(MIRA, -1.2, SHD - 1.9, 0.75);
      },
      cues: [{ at: 0.2, fn: () => sdoor().toggle(outside(station, 0, SHD + 2, 1.5)) }],
      cam: (t) => {
        const k = ease(t / b(1.5));
        if (fromInside) return { p: camIn.clone().add(new THREE.Vector3(0, 0.05 * k, 0)), l: mix(doorIn, inside(station, 0.4, SHD - 2, 1.3), k), fov: lerp(50, 44, k) };
        return { p: outside(station, lerp(3.4, 2.6, k), SHD + lerp(8.5, 6.2, k), 1.5), l: outside(station, 0, SHD, 1.5), fov: 40 };
      },
      titles: [title('TAKE IT', 0.2, 2.5)],
    });

    // ============================================================ 9. marked (bars 17.5-19)
    add(17.5, 1.5, {
      name: 'marked',
      hud: true,
      setup: () => {
        strike();
        shutAll();
        sdoor().setOpen(true, 1);
        grade('war');
        const [lx, lz] = freeIn(0.2, SHD - 2.4), [mx, mz] = freeIn(-1.4, SHD - 1.1);
        const at = inside(station, lx, lz), out = local(station, 0, SHD + 8);
        eyes(at.x, at.z, yawTo(at.x, at.z, out.x, out.z), 0.01, ['mosin', ['ammo_762', 10], 'bandage'], 'primary', station.floorY + 0.02);
        pocket(tagOf('Volkov', 46));
        const m = inside(station, mx, mz);
        put(MIRA, m.x, m.z, yawTo(m.x, m.z, out.x, out.z), 'p38').pos.y = station.floorY;
        lampOn(inside(station, 0.4, SHD - 3.4, 2.2), 8);
        document.body.classList.add('tr-map-big');
        hush();
      },
      tick: (t) => {
        lampAim();
        A(MIRA).pos.y = station.floorY;
        const it = myTag('Volkov');
        if (it) { it.held = 46 + t * 3; g.tickTags(0); }
        const out = outside(station, 0.4 * Math.sin(t * 0.9), SHD + 14, 1.5);
        look(out, 0.06);
      },
      cues: [
        {
          at: 0.3,
          fn: () => {
            g.minimap.ping([{ x: g.player.pos.x, z: g.player.pos.z }], true);
            g.hud.note('You carry a tag you took: every 30 seconds the map shows everyone where you are', 'warn');
          },
        },
        { at: 1.75, fn: () => g.minimap.ping([{ x: g.player.pos.x, z: g.player.pos.z }], true) },
      ],
      titles: [title('A TAG PUTS YOU ON EVERYONE’S MAP', 0.5, 2.65)],
    });
  }

  // ============================================================ 10. they come (bars 19-24)
  {
    const four = [KESTREL, DMITRI, OKSANA, BEAR];
    const guns = ['mosin', 'p38', 'p38', 'mosin'];
    /** where each of them makes for: nearer on the wings than in the middle */
    const goal = (k: number) => front(lanes[k], [16, 20, 15, 21][k]);
    const advance = (dt: number, speed: number) => four.forEach((id, k) => {
      const a = A(id);
      if (!a.alive) return;
      const to = goal(k);
      if (dist(a.pos, to) > 0.6) { a.go(to.x, to.z, speed, dt); a.aim = false; } else a.sprint = false;
    });
    add(19, 2, {
      name: 'they-come',
      setup: () => {
        strike();
        S.parkMe();
        shutAll();
        grade('war');
        four.forEach((id, k) => {
          const w = front(lanes[k], 60 + k * 3), d0 = local(station, 0, SHD);
          put(id, w.x, w.z, yawTo(w.x, w.z, d0.x, d0.z), guns[k]);
        });
      },
      tick: (_t, _S, dt) => advance(dt, 6.2),
      // from the station's step, a long lens: four of them, coming
      cam: (t) => {
        const k = ease(t / b(2));
        const mid = new THREE.Vector3();
        four.forEach((id) => mid.add(A(id).chest()));
        mid.multiplyScalar(0.25);
        return { p: outside(station, lerp(2.6, 1.6, k), SHD + 2.2, lerp(0.75, 1.0, k)), l: mid, fov: lerp(13, 17, k) };
      },
      titles: [title('THEY’RE COMING FOR IT', 0.25, 3.3)],
    });
    add(21, 3, {
      name: 'hold',
      chain: true,
      hud: true,
      setup: () => {
        const me = local(station, 0.9, SHD + 3.0), her = local(station, -1.9, SHD + 6.4), tgt = goal(2);
        eyes(me.x, me.z, yawTo(me.x, me.z, tgt.x, tgt.z), 0, ['mosin', ['ammo_762', 15], 'bandage'], 'primary');
        pocket(tagOf('Volkov', 96));
        const m = put(MIRA, her.x, her.z, yawTo(her.x, her.z, tgt.x, tgt.z), 'p38');
        m.crouch = true;
        m.hp = 1e5;
        m.skill = 0.2;
        m.foe = A(DMITRI);
        four.forEach((id, k) => {
          const a = A(id);
          a.hp = 1e5;
          a.skill = 0.25;
          a.foe = m;
          a.nextShot = 0.5 + k * 0.33;
        });
        delete (A(OKSANA) as any).hurt;
        A(OKSANA).hp = 100;
        tough(A(OKSANA), 1);
        A(OKSANA).onDeath = () => {
          S.feedKill(HERO, 'Oksana', ITEMS.mosin.name, Math.round(dist(g.player.pos, A(OKSANA).pos)));
          g.weapons.confirmKill?.();
        };
        hush();
      },
      tick: (t, _S, dt) => {
        advance(dt, 5.0);
        // (they shoot as they come, and from where they stop)
        four.forEach((id, k) => { const a = A(id); if (a.alive && (dist(a.pos, goal(k)) <= 0.6 || (t + k * 0.4) % 1.7 < 0.35)) a.think(t); });
        A(MIRA).think(t);
        // the sights come up for each shot: her first, then the big one
        S.key('Mouse2', (t > 1.9 && t < 3.3) || t > 4.1);
        const first = A(OKSANA), then = A(BEAR);
        const tgt = t < 3.3 && first.alive ? first.chest() : then.chest();
        look(tgt, t < 1.2 ? 0.07 : (t > 3.3 && t < 4.2) ? 0.12 : 0.4);
      },
      cues: [
        // a round comes at him
        { at: 1.25, fn: () => { g.weapons.flinch(0.9); g.hud.hitFrom(0.25); g.player.damage(9, 'gunshot wounds'); } },
        { at: 2.75, fn: () => S.tap('Mouse0', 60) },
        { at: 2.95, fn: () => { if (A(OKSANA).alive) A(OKSANA).die(); } },
        { at: 4.95, fn: () => S.tap('Mouse0', 60) },
      ],
      titles: [title('HOLD THE STATION', 0.3, 2.6, 'top')],
    });
  }

  // ============================================================ 11. the fuel drum (bars 24-28)
  {
    const two = [KESTREL, DMITRI];
    const hides = [byDrum(-1.25, 0.55), byDrum(-1.3, -0.6)];
    const drumMid = () => drumAt(drum, 0.5);
    let wentUp = -1;
    add(24, 1.5, {
      name: 'cover',
      setup: () => {
        strike();
        S.parkMe();
        grade('war');
        two.forEach((id, k) => {
          const from = byDrum(-9 - k * 1.5, (k ? -1 : 1) * 2.4);
          put(id, from.x, from.z, yawTo(from.x, from.z, drum.x, drum.z), k ? 'p38' : 'mosin');
        });
      },
      tick: (_t, _S, dt) => two.forEach((id, k) => {
        const a = A(id);
        if (dist(a.pos, hides[k]) > 0.12) a.go(hides[k].x, hides[k].z, 5.6, dt);
        else {
          // down behind it, guns over the top, toward the station
          a.sprint = false;
          a.crouch = true;
          a.aim = true;
          a.yaw = yawTo(a.pos.x, a.pos.z, shooter.x, shooter.z);
        }
      }),
      cues: [{ at: 2.0, fn: () => A(KESTREL).fireAt(P(shooter.x, shooter.z, 1.9), 0.02) }, { at: 2.45, fn: () => A(DMITRI).fireAt(P(shooter.x + 1, shooter.z, 1.2), 0.02) }],
      // low, the red drum filling the front of the picture, the two of them getting down behind it
      cam: (t) => {
        const k = ease(t / b(1.5));
        const at = byDrum(lerp(3.6, 2.9, k), lerp(2.4, 1.7, k));
        return { p: P(at.x, at.z, lerp(0.5, 0.62, k)), l: drumAt(drum, 0.55).addScaledVector(drumDir, -0.5), fov: 38 };
      },
      titles: [title('THEY TAKE COVER', 0.25, 2.6)],
    });
    add(25.5, 1, {
      name: 'drum-aim',
      chain: true,
      hud: true,
      setup: () => {
        eyes(shooter.x, shooter.z, yawTo(shooter.x, shooter.z, drum.x, drum.z) + 0.05, 0.01, ['mosin', ['ammo_762', 15], 'bandage'], 'primary');
        wentUp = -1;
        hush();
      },
      tick: (t) => {
        S.key('Mouse2', true);
        two.forEach((id, k) => { const a = A(id); a.crouch = a.aim = true; a.yaw = yawTo(a.pos.x, a.pos.z, shooter.x, shooter.z) + (k ? 0.04 : -0.04); });
        const p = g.player, cam = g.s.r.camera.position, at = drumMid();
        const k = 1 - ease(t / 0.9);
        p.yaw = Math.atan2(-(at.x - cam.x), -(at.z - cam.z)) + 0.05 * k;
        p.pitch = Math.atan2(at.y - cam.y, Math.hypot(at.x - cam.x, at.z - cam.z)) + 0.012 * k;
      },
      cues: [{ at: 0.5, fn: () => A(KESTREL).fireAt(g.s.r.camera.position.clone().add(new THREE.Vector3(0.9, 0.5, 0)), 0.01) }],
      rate: (t) => lerp(1, 0.55, ease((t - 0.9) / 0.9)),
      titles: [title('BEHIND THE WRONG THING', 0.15, 1.8)],
    });
    add(26.5, 1.5, {
      name: 'drum-blast',
      chain: true,
      setup: () => {
        two.forEach((id) => {
          const a = A(id);
          a.hp = 100;
          a.onDeath = () => undefined;
        });
      },
      tick: (t) => {
        S.key('Mouse2', true);
        S.aimAt(drumMid());
        if (wentUp < 0 && !drum.there) wentUp = t;
      },
      cues: [
        { at: 0.3, fn: () => S.tap('Mouse0', 60) },
        // (the story needs it to go up: if the round found something else on the way, it goes up all the same)
        { at: 0.62, fn: () => { if (drum.there) g.blowBarrel(drum.i, true); } },
        { at: 1.1, fn: () => two.forEach((id) => { if (A(id).alive) A(id).die(drumDir.clone().negate()); }) },
      ],
      rate: (t) => (wentUp < 0 ? 0.4 : lerp(0.16, 1, ease((t - wentUp - 0.25) / 1.5))),
      // from the side, wide: the two behind it, the flash, the ground jumping under the tripod
      cam: (t) => {
        const k = ease(t / b(1.5));
        const at = byDrum(lerp(2.2, 1.2, k), lerp(8.6, 10.4, k));
        const p = P(at.x, at.z, lerp(1.0, 1.5, k));
        const shake = wentUp >= 0 ? 0.09 * Math.exp(-(t - wentUp) * 2.6) : 0;
        p.add(new THREE.Vector3(Math.sin(t * 71), Math.sin(t * 53 + 1), Math.sin(t * 61 + 2)).multiplyScalar(shake));
        return { p, l: drumAt(drum, 0.9), fov: 46, roll: shake * 0.5 * Math.sin(t * 47) };
      },
      titles: [title('RED BARRELS EXPLODE', 0.95, 2.7)],
    });
  }

  // ============================================================ 12. the one who got in (bars 28-31)
  {
    const B0 = () => A(BEAR), M = () => A(MIRA);
    let me: [number, number] = [0.7, SHD - 4.3], her: [number, number] = [-1.5, SHD - 1.4];
    const away = () => { const a = inside(station, me[0], me[1]), q = inside(station, me[0] + 0.3, me[1] - 3); return yawTo(a.x, a.z, q.x, q.z); };
    add(28, 3, {
      name: 'breach',
      hud: true,
      setup: () => {
        strike();
        shutAll();
        sdoor().setOpen(true, 1);
        grade('war');
        me = freeIn(0.7, SHD - 4.3);
        her = freeIn(-1.5, SHD - 1.4);
        const at = inside(station, me[0], me[1]);
        eyes(at.x, at.z, away(), -0.32, ['mosin', ['ammo_762', 15], 'bandage'], 'primary', station.floorY + 0.02);
        pocket(tagOf('Volkov', 180), tagOf('Oksana', 62), tagOf('Kestrel', 20), tagOf('Dmitri', 20));
        // (an empty rifle: he is feeding it when the door darkens)
        const rifle = g.inv.find((i: any) => i.id === 'mosin');
        if (rifle) rifle.loaded = 1;
        const m = inside(station, her[0], her[1]), out = local(station, 0.3, SHD + 10);
        put(MIRA, m.x, m.z, yawTo(m.x, m.z, out.x, out.z), 'p38').pos.y = station.floorY;
        M().crouch = true;
        const b0 = local(station, 0.4, SHD + 6.5);
        put(BEAR, b0.x, b0.z, yawTo(b0.x, b0.z, station.x, station.z), 'p38');
        tough(B0(), 3);
        B0().onDeath = () => S.feedKill(FRIEND, B0().name, ITEMS.p38.name, 0, false);
        lampOn(inside(station, 0.2, SHD - 2.6, 2.3), 9);
        hush();
      },
      tick: (t, _S, dt) => {
        lampAim();
        const b0 = B0(), m = M();
        m.pos.y = station.floorY;
        // he comes through the door at a run
        if (b0.alive && t > 0.55) {
          const out = (b0.pos.x - station.x) * Math.sin(station.rot) + (b0.pos.z - station.z) * Math.cos(station.rot) > SHD + 0.4;
          const to = out ? local(station, 0.15, SHD + 0.3) : local(station, 0.1, SHD - 1.2);
          b0.go(to.x, to.z, 4.8, dt);
          if (!out) b0.pos.y = station.floorY;
          b0.sprint = false;
          b0.aim = !out;
          if (!out) b0.face(g.s.r.camera.position.clone().setY(g.s.r.camera.position.y - 0.35));
        }
        // the eyes: on the rifle, then round to the door, and after it is over, to her
        if (t < 1.25) { g.player.yaw = away(); g.player.pitch = -0.32; }
        else if (t < 3.3) look(b0.alive ? b0.chest() : b0.pos.clone().setY(b0.pos.y + 0.4), t < 1.7 ? 0.16 : 0.25);
        else look(m.head(), 0.07);
        if (t > 2.0) { m.crouch = false; if (b0.alive) m.face(b0.chest()); m.aim = b0.alive; }
        if (t > 3.6) m.yaw = yawTo(m.pos.x, m.pos.z, g.player.pos.x, g.player.pos.z);
      },
      cues: [
        { at: 0.1, fn: () => S.tap('KeyR') },
        { at: 1.9, fn: () => { B0().fireAt(g.s.r.camera.position.clone().setY(g.s.r.camera.position.y - 0.3), 0); hitMe(42, 0); } },
        ...[2.3, 2.6, 2.9].map((at) => ({ at, fn: () => { const b0 = B0(), m = M(); if (!b0.alive) return; m.fireAt(b0.chest(), 0); b0.hurt(40, b0.chest().sub(m.chest()).normalize()); } })),
        { at: 4.15, fn: () => g.emote('thanks') },
      ],
      rate: (t) => (t > 1.7 && t < 3.1 ? 0.6 : 1),
      titles: [title('NOW YOU’RE EVEN', 4.3, 5.5, 'top')],
    });
  }

  // ============================================================ 13. what he is carrying (bars 31-33)
  const yardBodies = async () => {
    // what is left of the four, in the yard
    const lie = (id: number, lx: number, lz: number, yaw: number) => { const w = local(station, lx, lz); put(id, w.x, w.z, yaw, null).die(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))); };
    lie(OKSANA, 3.5, SHD + 13, 0.4);
    lie(BEAR, -0.6, SHD + 6.5, 2.2);
    await preroll(70);
  };
  add(31, 2, {
    name: 'five-tags',
    hud: true,
    setup: async () => {
      strike();
      shutAll();
      sdoor().setOpen(true, 1);
      grade('warm');
      await yardBodies();
      const me = local(station, 0.5, SHD + 3.2), outw = local(station, 2, SHD + 12);
      eyes(me.x, me.z, yawTo(me.x, me.z, outw.x, outw.z), -0.12, ['mosin', ['ammo_762', 15], 'bandage'], 'primary');
      pocket(tagOf('Volkov', 392), tagOf('Oksana', 208), tagOf('Kestrel', 163), tagOf('Dmitri', 163), tagOf('Bear', 131));
      const her = local(station, -1.2, SHD + 7.6);
      put(MIRA, her.x, her.z, yawTo(her.x, her.z, local(station, -0.6, SHD + 6.5).x, local(station, -0.6, SHD + 6.5).z), 'p38').crouch = true;
      hush();
    },
    tick: (t) => {
      // over the yard, slowly, and back to her
      const sweep = outside(station, lerp(4, -1.2, ease(t / 3)), SHD + lerp(13, 7.6, ease(t / 3)), lerp(0.5, 1.0, ease(t / 3)));
      look(sweep, 0.08);
      for (const [name, base] of [['Volkov', 392], ['Oksana', 208], ['Kestrel', 163], ['Dmitri', 163], ['Bear', 131]] as const) { const it = myTag(name); if (it) it.held = base + t * 4; }
      g.tickTags(0);
      if (t > 2.4) A(MIRA).crouch = false;
    },
    titles: [title('FIVE TAGS · FIVE PAYDAYS', 0.3, 2.3, 'top'), { at: 2.4, until: 3.65, text: 'IF HE LIVES THAT LONG', cls: 'small' }],
  });

  // ============================================================ 14. the wait (bars 33-36)
  {
    const clockEl = gfx('g-clock', '<span>UNTIL THE FIRST TAG PAYS</span><b>06:32</b>');
    const mid = () => outside(station, -0.2, SHD + 3.4, 1.1);
    add(33, 3, {
      name: 'the-wait',
      setup: async () => {
        strike();
        S.parkMe();
        shutAll();
        sdoor().setOpen(true, 1);
        grade('warm');
        await yardBodies();
        const s0 = local(station, 1.1, SHD + 2.8), m0 = local(station, -1.5, SHD + 4.0), outw = local(station, 0, SHD + 30);
        put(SABLE, s0.x, s0.z, yawTo(s0.x, s0.z, outw.x, outw.z), 'mosin').aim = true;
        put(MIRA, m0.x, m0.z, yawTo(m0.x, m0.z, s0.x, s0.z) + 0.6, null).dance = true;
      },
      tick: (t) => {
        // he watches the field; she has found something better to do
        const s = A(SABLE), outw = local(station, 12 * Math.sin(t * 0.7), SHD + 30);
        s.yaw = yawTo(s.pos.x, s.pos.z, outw.x, outw.z);
        A(MIRA).dance = true;
      },
      cam: (t) => orbit(mid(), 8.2, 5.4, frontYawAngle(0.75), frontYawAngle(-0.35), 0.5, 0.25, 40, b(3))(t),
      after: (t) => {
        const k = t / b(3);
        showGfx(clockEl, t);
        // ten minutes in five seconds: fast, then faster
        clockEl.querySelector('b')!.textContent = mmss(lerp(392, 4, Math.pow(k, 0.8)));
      },
      titles: [{ at: 0.5, until: 5.3, text: 'NOTHING TO DO BUT WAIT · DANCE IS ON THE WHEEL TOO', cls: 'small' }],
    });
  }
  /** an angle round the front of the station, for a camera that circles in front of its door (0 = straight out of the door) */
  function frontYawAngle(off: number) {
    const w = local(station, 0, SHD + 10);
    return Math.atan2(w.z - station.z, w.x - station.x) + off;
  }

  // ============================================================ 15. paid (bars 36-39)
  {
    const coins = Array.from({ length: 26 }, () => gfx('g-coin', ''));
    const wallet = gfx('g-wallet', '<span>YOUR WALLET</span><b>+0.00 SOL</b>');
    const PAID = 0.62;
    add(36, 3, {
      name: 'paid',
      hud: true,
      setup: async () => {
        strike();
        shutAll();
        sdoor().setOpen(true, 1);
        grade('gold');
        await yardBodies();
        const me = local(station, 0.4, SHD + 3.6), outw = local(station, -1, SHD + 40);
        eyes(me.x, me.z, yawTo(me.x, me.z, outw.x, outw.z), 0.04, ['mosin', ['ammo_762', 15], 'bandage'], 'primary');
        pocket(tagOf('Volkov', TAG_HOLD - 2.4), tagOf('Oksana', TAG_HOLD - 184), tagOf('Kestrel', TAG_HOLD - 229), tagOf('Dmitri', TAG_HOLD - 229), tagOf('Bear', TAG_HOLD - 261));
        const her = local(station, -2.3, SHD + 8.2);
        put(MIRA, her.x, her.z, yawTo(her.x, her.z, me.x, me.z), null);
        hush();
      },
      tick: (t, _S, dt) => {
        const it = myTag('Volkov');
        if (it && t < PAID) { it.held = lerp(TAG_HOLD - 2.4, TAG_HOLD - 0.3, t / PAID); g.tickTags(0); }
        for (const name of ['Oksana', 'Kestrel', 'Dmitri', 'Bear']) { const o = myTag(name); if (o) o.held += dt; }
        const m = A(MIRA);
        m.dance = t > 1.5 && t < 4.4;
        m.yaw = yawTo(m.pos.x, m.pos.z, g.player.pos.x, g.player.pos.z);
        look(t < 1.4 ? outside(station, -1, SHD + 40, 6) : m.head(), 0.035);
      },
      cues: [
        {
          at: PAID,
          fn: () => {
            const it = myTag('Volkov');
            if (it) it.held = TAG_HOLD;
            g.tickTags(0);
            g.hud.feed(`${HERO} cashed in Volkov's dog tag.`, true);
          },
        },
        // (the words the game server sends when the payment has arrived)
        { at: 1.3, fn: () => { g.hud.note(`0.02 SOL sent to ${HERO_WALLET} for Volkov's tag.`, 'good'); audio.ui('pickup'); } },
      ],
      after: (t) => {
        const u = t - PAID;
        coins.forEach((el, i) => {
          const d = u - 0.1 - i * 0.045;
          if (d < 0 || d > 1.5) { el.style.display = 'none'; return; }
          // out of the middle, an arc, into the wallet at the bottom right
          const k = ease(d / 1.1), a = (i * 2.399) % 6.283, r = Math.sin(Math.min(1, d / 0.4) * Math.PI * 0.5) * (7 + (i % 5) * 2.5) * (1 - k);
          el.style.display = '';
          el.style.left = `${lerp(50, 86, k) + Math.cos(a) * r}%`;
          el.style.top = `${lerp(46, 78, k * k) + Math.sin(a) * r * 1.4 - Math.sin(k * Math.PI) * 9}%`;
          el.style.transform = `scale(${lerp(1, 0.45, k)})`;
          el.style.opacity = String(d > 1.25 ? (1.5 - d) * 4 : 1);
        });
        if (u > 0.2) {
          showGfx(wallet, t);
          wallet.querySelector('b')!.textContent = `+${(0.02 * ease((u - 0.5) / 0.9)).toFixed(2)} SOL`;
          wallet.style.opacity = String(ease((u - 0.2) / 0.3));
        }
      },
      titles: [
        { at: PAID + 0.1, until: 2.75, text: 'PAID', cls: 'gold2' },
        { at: 1.35, until: 4.0, text: '0.02 SOL · SENT TO YOUR WALLET · AUTOMATICALLY', cls: 'sub' },
        title('FOUR MORE ON THE CLOCK', 4.15, 5.45, 'top'),
      ],
    });
  }

  // ============================================================ 16. the price (bars 39-46.5)
  {
    const S0 = () => A(SABLE), M = () => A(MIRA);
    const outYaw = () => { const a = local(station, 0.2, SHD + 6), q = local(station, 0.2, SHD + 30); return yawTo(a.x, a.z, q.x, q.z); };
    add(39, 2, {
      name: 'the-turn',
      setup: async () => {
        strike();
        S.parkMe();
        shutAll();
        grade('dust');
        const s0 = local(station, 0.2, SHD + 6.5), m0 = local(station, -0.5, SHD + 3.4);
        put(SABLE, s0.x, s0.z, outYaw(), 'mosin');
        put(MIRA, m0.x, m0.z, yawTo(m0.x, m0.z, s0.x, s0.z), 'p38');
      },
      tick: (t, _S, dt) => {
        const s = S0(), m = M(), to = local(station, 0.2, SHD + 30);
        // he walks out into the field with his back to her
        s.go(to.x, to.z, 1.5, dt);
        s.sprint = false;
        m.face(s.chest());
        m.aim = t > 1.55;
      },
      rate: () => 0.8,
      // over her shoulder: his back, and then the pistol coming up into the picture
      cam: (t) => {
        const k = ease(t / b(2));
        const m = M().pos, d = new THREE.Vector3(S0().pos.x - m.x, 0, S0().pos.z - m.z).normalize();
        const p = new THREE.Vector3(m.x - d.x * lerp(2.3, 1.75, k) - d.z * 0.95, 0, m.z - d.z * lerp(2.3, 1.75, k) + d.x * 0.95);
        p.y = M().pos.y + lerp(1.72, 1.62, k);
        return { p, l: S0().chest().setY(S0().pos.y + 1.25), fov: lerp(40, 30, k) };
      },
      titles: [{ at: 0.5, until: 3.4, text: 'FOUR TAGS STILL IN HIS POCKET', cls: 'small' }],
    });
    add(41, 1, {
      name: 'in-the-back',
      hud: true,
      setup: () => {
        strike();
        grade('dust');
        const me = local(station, 0.2, SHD + 9.5), her = local(station, -0.5, SHD + 3.4);
        eyes(me.x, me.z, outYaw(), 0.02, ['mosin', ['ammo_762', 15], 'bandage'], 'primary');
        pocket(tagOf('Oksana', TAG_HOLD - 171), tagOf('Kestrel', TAG_HOLD - 216), tagOf('Dmitri', TAG_HOLD - 216), tagOf('Bear', TAG_HOLD - 248));
        put(MIRA, her.x, her.z, yawTo(her.x, her.z, me.x, me.z), 'p38').aim = true;
        hush();
      },
      tick: (t) => {
        S.key('KeyW', t < 0.6);
        if (!g.player.dead) { g.player.yaw = outYaw() + 0.02 * Math.sin(t * 2); g.tickTags(0); }
        M().face(g.s.r.camera.position.clone().setY(g.s.r.camera.position.y - 0.4));
      },
      cues: [
        { at: 0.6, fn: () => { M().fireAt(g.s.r.camera.position.clone().setY(g.s.r.camera.position.y - 0.35), 0); hitMe(58, Math.PI); } },
        {
          at: 1.02,
          fn: () => {
            M().fireAt(g.s.r.camera.position.clone().setY(g.s.r.camera.position.y - 0.35), 0);
            // (what the game tells you when another player does this to you)
            g.deathInfo = `Killed by ${FRIEND} with ${ITEMS.p38.name}. Your body and gear are where you fell.`;
            g.lastHit = { x: -Math.sin(outYaw()), z: -Math.cos(outYaw()), at: performance.now() };
            hitMe(200, Math.PI);
          },
        },
      ],
      rate: (t) => (t > 0.6 ? 0.65 : 1),
      bars: false,
    });
    const fall = () => local(station, 0.2, SHD + 10.2);
    add(42, 2, {
      name: 'thanks',
      setup: async () => {
        strike();
        S.parkMe();
        shutAll();
        grade('dust');
        const at = fall(), her = local(station, -0.2, SHD + 7.4);
        put(SABLE, at.x, at.z, outYaw(), 'mosin').die(new THREE.Vector3(-Math.sin(outYaw()), 0, -Math.cos(outYaw())));
        put(MIRA, her.x, her.z, yawTo(her.x, her.z, at.x, at.z), 'p38').aim = true;
        await preroll(80);
      },
      tick: (t) => {
        const m = M();
        if (t < 0.55) m.aim = true;
      },
      cues: [{ at: 0.55, fn: () => (M().aim = false) }, { at: 1.05, fn: () => M().call('thanks') }],
      // from the grass beyond him: the body in the front of the picture, her standing over it
      cam: (t) => {
        const k = ease(t / b(2));
        const at = fall(), d = new THREE.Vector3(-Math.sin(outYaw()), 0, -Math.cos(outYaw()));
        const p = P(at.x + d.x * lerp(3.9, 3.3, k) - d.z * 1.5, at.z + d.z * lerp(3.9, 3.3, k) + d.x * 1.5, lerp(0.95, 1.1, k));
        return { p, l: mix(P(at.x, at.z, 0.3), M().chest(), 0.62), fov: 40 };
      },
      titles: [title('EVERYONE HAS A PRICE', 2.15, 3.7)],
    });
    const next = [KESTREL, DMITRI, OKSANA];
    add(44, 2.5, {
      name: 'her-turn',
      chain: true,
      hud: true,
      setup: () => {
        const at = fall(), me = local(station, 0.0, SHD + 8.9);
        M().hide();
        grade('dust');
        // she is the one we are now: his own tag and the four he was carrying, every clock back at the top
        eyes(me.x, me.z, yawTo(me.x, me.z, at.x, at.z), -0.62, ['p38', ['ammo_9mm', 16], 'bandage'], 'holster');
        hush();
        document.body.classList.add('tr-map-big');
        next.forEach((id, k) => {
          const w = front(lanes[(k + 1) % lanes.length], 58 + k * 5), d0 = local(station, 0, SHD + 9);
          put(id, w.x, w.z, yawTo(w.x, w.z, d0.x, d0.z), k === 1 ? 'p38' : 'mosin');
        });
      },
      tick: (t, _S, dt) => {
        const at = fall();
        const far = new THREE.Vector3();
        next.forEach((id) => { const a = A(id); a.go(g.player.pos.x, g.player.pos.z, 5.8, dt); far.add(a.chest()); });
        far.multiplyScalar(1 / next.length);
        // down at him; then up, at what is coming over the field
        look(t < 1.7 ? new THREE.Vector3(at.x, S.ground(at.x, at.z) + 0.3, at.z) : far, t < 1.7 ? 0.2 : 0.07);
        g.tickTags(0);
      },
      cues: [
        { at: 0.3, fn: () => { pocket(tagOf(HERO), tagOf('Oksana'), tagOf('Kestrel'), tagOf('Dmitri'), tagOf('Bear')); audio.ui('pickup'); } },
        // (five notes say the same thing: one is enough to read)
        { at: 0.36, fn: () => { const notes = [...document.querySelectorAll('.hud-notes > *')]; notes.slice(0, -1).forEach((e) => e.remove()); } },
        {
          at: 2.1,
          fn: () => {
            g.minimap.ping([{ x: g.player.pos.x, z: g.player.pos.z }], true);
            g.hud.note('You carry a tag you took: every 30 seconds the map shows everyone where you are', 'warn');
          },
        },
      ],
      titles: [title('KILL THE CARRIER · EVERY CLOCK STARTS AGAIN', 0.45, 2.45, 'top'), title('NOW IT’S HER TURN', 2.75, 4.55)],
    });
  }

  // ============================================================ 17. the name (bars 46.5-48)
  {
    const logo = gfx('g-logo', '<b>ZONA</b><span>LOOT · FIGHT · BETRAY · GET PAID</span>');
    add(46.5, 1.5, {
      name: 'name',
      setup: () => {
        strike();
        S.parkMe();
      },
      cam: () => ({ p: P(c.x, c.z, 60), l: P(c.x + 10, c.z, 0), fov: 50 }),
      bars: false,
      after: (t) => {
        showGfx(logo, t);
        const a = ease(t / 0.12);
        logo.style.setProperty('--k', String(1 + (1 - a) * 0.4 + t * 0.014));
        logo.style.setProperty('--o', String(ease((t - 0.55) / 0.25)));
        logo.style.opacity = String(Math.min(1, (b(1.5) - t) / 0.12));
      },
    });
  }

  // ============================================================ 18. how the money works (bars 48-64)
  {
    /** behind the boards: the map from the air, turned down and out of focus */
    const air = (a0: number, a1: number, r: number, h: number, dur: number) => (t: number): CamPose => {
      const a = lerp(a0, a1, t / dur);
      return { p: P(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0).setY(S.ground(c.x, c.z) + h), l: P(c.x, c.z, 6), fov: 50 };
    };
    const board = () => {
      strike();
      S.parkMe();
      shutAll();
      grade('dim');
    };
    /** how far in something has come that starts at `at` (0..1) */
    const inAt = (el: Element | null, t: number, at: number, len = 0.28) => (el as HTMLElement | null)?.style.setProperty('--o', String(ease((t - at) / len)));
    const tick = (at: number) => ({ at, fn: () => audio.ui('move') });

    // --- where it comes from
    const flow = gfx('eco', `
      <div class="eco-kicker">HOW THE MONEY WORKS</div>
      <div class="eco-head">REAL SOL. <b>FULLY AUTOMATIC.</b></div>
      <div class="flow">
        <div class="node in"><i>01</i><b>EVERY $ZONA TRADE</b><span>pays a creator reward on pump.fun</span></div>
        <div class="pipe in"><u></u><u></u><u></u></div>
        <div class="node in"><i>02</i><b>THE TREASURY</b><span>one public wallet. The rewards are claimed into it by the machine, nobody presses anything</span></div>
        <div class="pipe in"><u></u><u></u><u></u></div>
        <div class="node in"><i>03</i><b>YOUR WALLET</b><span>paid the moment your tag’s clock runs out</span></div>
      </div>
      <div class="eco-foot in">NO CLAIM BUTTON · NO WAITING · <b>NO MIDDLEMAN</b></div>`);
    add(48, 3, {
      name: 'money-1',
      setup: board,
      cam: air(0.4, 0.62, 210, 70, b(3)),
      bars: false,
      cues: [tick(0.5), tick(1.35), tick(2.2), tick(3.6)],
      after: (t) => {
        showGfx(flow, t);
        const ins = flow.querySelectorAll('.in');
        [0.5, 1.0, 1.35, 1.85, 2.2, 3.6].forEach((at, i) => inAt(ins[i], t, at));
        flow.querySelectorAll('.pipe').forEach((pipe, k) => pipe.querySelectorAll('u').forEach((u, i) => {
          const ph = (t * 0.55 + i / 3 + k * 0.17) % 1;
          (u as HTMLElement).style.left = `${8 + ph * 80}%`;
          (u as HTMLElement).style.opacity = String(Math.sin(ph * Math.PI));
        }));
      },
    });

    // --- what a tag pays
    const pays = gfx('eco', `
      <div class="eco-kicker">WHAT A TAG PAYS</div>
      <div class="eco-head"><b>2%</b> OF THE TREASURY · NEVER LESS THAN <b>0.02 SOL</b></div>
      <div class="bars">
        <div class="bar in"><em>TREASURY 1 SOL</em><i></i><strong>0.02<small>SOL A TAG</small></strong></div>
        <div class="bar in"><em>TREASURY 10 SOL</em><i></i><strong>0.2<small>SOL A TAG</small></strong></div>
        <div class="bar in"><em>TREASURY 100 SOL</em><i></i><strong>2<small>SOL A TAG</small></strong></div>
      </div>
      <div class="eco-foot in">THE MORE THE COIN TRADES, <b>THE MORE A TAG IS WORTH</b></div>`);
    add(51, 3.5, {
      name: 'money-2',
      setup: board,
      cam: air(2.3, 2.55, 190, 60, b(3.5)),
      bars: false,
      cues: [tick(0.6), tick(1.5), tick(2.4), tick(4.3)],
      after: (t) => {
        showGfx(pays, t);
        const rows = pays.querySelectorAll('.bar');
        [0.6, 1.5, 2.4].forEach((at, i) => {
          inAt(rows[i], t, at);
          (rows[i].querySelector('i') as HTMLElement).style.setProperty('--w', String([3.2, 13, 34][i] * ease((t - at - 0.1) / 0.7)));
        });
        inAt(pays.querySelector('.eco-foot'), t, 4.3);
      },
    });

    // --- what keeps it fair
    const fair = gfx('eco', `
      <div class="eco-kicker">BALANCED BY DESIGN</div>
      <div class="eco-head">BUILT SO IT <b>CAN’T BE DRAINED</b></div>
      <div class="rules">
        <div class="rule in"><b>50%</b><div>OF THE TREASURY A DAY, AT MOST<span>one night of fighting can never empty it</span></div></div>
        <div class="rule in"><b>3</b><div>PAID TAGS A DAY FOR ONE WALLET<span>the rest wait for tomorrow</span></div></div>
        <div class="rule in"><b>10:00</b><div>TO HOLD A TAG<span>die, and the clock starts again for whoever loots you</span></div></div>
        <div class="rule in"><b>0</b><div>FOR FARMING<span>your own second window, a fresh spawn, or the same victim again within three hours pays nothing</span></div></div>
      </div>`);
    add(54.5, 3.5, {
      name: 'money-3',
      setup: board,
      cam: air(4.1, 4.36, 200, 64, b(3.5)),
      bars: false,
      cues: [tick(0.6), tick(1.8), tick(3.0), tick(4.2)],
      after: (t) => {
        showGfx(fair, t);
        fair.querySelectorAll('.rule').forEach((el, i) => inAt(el, t, 0.6 + i * 1.2));
      },
    });

    // --- the page anybody can check it on
    const row = (who: string, whose: string, w: string, sig: string) => `<tr class="row"><td>${who}</td><td>${whose}</td><td><code>${w}</code></td><td><span class="sol">0.02 SOL</span><a>${sig}</a><u>receipt</u></td></tr>`;
    const audit = gfx('eco', `
      <div class="eco-kicker">NOTHING HIDDEN</div>
      <div class="eco-head">AUDIT <b>EVERY PAYMENT</b> YOURSELF</div>
      <div class="audit">
        <div class="panel">
          <div class="url"><i></i><i></i><i></i><span>zonapvp.fun/payouts</span></div>
          <div class="pg">
            <h4>ZONA payouts</h4>
            <div class="st"><b>Automatic payouts are on</b>A tag cashed in is paid within a minute or so, straight from the treasury.</div>
            <div class="tiles">
              <div><b>${short(TREASURY)}</b><span>the treasury, on Solana</span></div>
              <div><b>2%</b><span>of it for a tag</span></div>
              <div><b>0.02</b><span>SOL a tag, at least</span></div>
              <div><b>50%</b><span>of it a day, at most</span></div>
            </div>
            <table>
              <thead><tr><th>Player</th><th>Whose tag</th><th>Wallet</th><th>Paid</th></tr></thead>
              <tbody>${row(HERO, 'Volkov', HERO_WALLET, '5Kq1…x9Pd')}${row(FRIEND, HERO, 'M1ra…k2Vz', '3fTn…Qw8a')}${row(FRIEND, 'Oksana', 'M1ra…k2Vz', '2hXb…7LcE')}${row(FRIEND, 'Kestrel', 'M1ra…k2Vz', '4vRd…n5Yu')}</tbody>
            </table>
            <div class="eg">The rows are an example: the people in them are the ones in this film.</div>
          </div>
        </div>
        <div class="side">
          <p class="in">EVERY PAYMENT IS A TRANSACTION<span>with a link, on a public chain</span></p>
          <p class="in">EVERY PAYMENT LEAVES A RECEIPT<span>so no tag can ever be paid twice</span></p>
          <p class="in">EVERY CLAIM OF REWARDS IS LISTED<span>what came in, and when</span></p>
          <div class="go in">ZONAPVP.FUN/PAYOUTS</div>
        </div>
      </div>`);
    add(58, 4, {
      name: 'money-4',
      setup: board,
      cam: air(5.6, 5.9, 180, 58, b(4)),
      bars: false,
      cues: [tick(0.5), tick(1.5), tick(2.0), tick(2.5), tick(3.0), tick(5.6)],
      after: (t) => {
        showGfx(audit, t);
        inAt(audit.querySelector('.panel'), t, 0.5, 0.45);
        audit.querySelectorAll('tr.row').forEach((el, i) => inAt(el, t, 1.5 + i * 0.5, 0.2));
        audit.querySelectorAll('.side .in').forEach((el, i) => inAt(el, t, 2.2 + i * 1.1));
      },
    });

    // --- and what it comes to
    add(62, 2, {
      name: 'money-5',
      setup: async () => {
        strike();
        S.parkMe();
        shutAll();
        sdoor().setOpen(true, 1);
        grade('gold');
        const s0 = local(station, 1.0, SHD + 3.0), m0 = local(station, -1.2, SHD + 3.6), outw = local(station, 0, SHD + 30);
        put(SABLE, s0.x, s0.z, yawTo(s0.x, s0.z, outw.x, outw.z), 'mosin');
        put(MIRA, m0.x, m0.z, yawTo(m0.x, m0.z, outw.x, outw.z), 'p38');
      },
      // up at the two of them in the station's door, from the yard
      cam: (t) => {
        const k = ease(t / b(2));
        return { p: outside(station, lerp(-2.6, -1.6, k), SHD + lerp(11, 8.2, k), lerp(0.55, 0.7, k)), l: outside(station, 0, SHD + 3.2, 1.35), fov: lerp(34, 30, k) };
      },
      titles: [title('FREE TO PLAY', 0.2, 1.75), title('PAID TO SURVIVE', 1.85, 3.65)],
    });
  }

  // ============================================================ 19. what is coming (bars 64-72)
  const soon = (text: string, len: number): Title[] => [{ at: 0, until: b(len), text: 'COMING SOON', cls: 'soonbar' }, { at: 0.15, until: b(len) - 0.08, text, cls: 'soon' }];
  add(64, 2, {
    name: 'soon-vehicles',
    setup: () => {
      strike();
      S.parkMe();
      shutAll();
    },
    // something under a cover, and a camera that wants to know what
    cam: orbit(new THREE.Vector3(car.x, car.y + 0.8, car.z), 8.5, 5.2, carFrom, carTo, 1.3, 0.55, 38, b(2)),
    titles: soon('VEHICLES', 2),
  });
  {
    // a rifle with everything on it, then a pistol with everything on it
    const at = roadAt(0.55), to = roadAt(0.45);
    add(66, 2, {
      name: 'soon-weapons',
      hud: false,
      bars: true,
      setup: () => {
        strike();
        shutAll();
        eyes(at.x, at.z, yawTo(at.x, at.z, to.x, to.z), 0, ['mosin', 'p38', ['ammo_762', 10]], null, undefined, { mosin: ['pu_scope', 'rifle_wrap'], p38: ['suppressor_9', 'mag_p38_ext'] });
      },
      tick: (t) => {
        g.player.yaw = yawTo(at.x, at.z, to.x, to.z) + 0.05 * Math.sin(t * 1.3);
        g.player.pitch = 0.02 * Math.sin(t * 0.9);
      },
      cues: [{ at: 0.05, fn: () => S.hold('primary', true) }, { at: 1.55, fn: () => S.hold('holster', true) }, { at: 2.7, fn: () => S.tap('Mouse0', 60) }],
      titles: soon('MORE WEAPONS', 2),
    });
  }
  {
    // everybody, in a line across the road, walking at the camera
    const mid = roadAt(0.5), ahead = roadAt(0.4);
    const d = ahead.clone().sub(mid).setY(0).normalize(), right = new THREE.Vector3(-d.z, 0, d.x);
    add(68, 2, {
      name: 'soon-modes',
      setup: () => {
        strike();
        S.parkMe();
        shutAll();
        cast().forEach((_a, i) => {
          const off = (i - 3) * 1.25, back = Math.abs(i - 3) * 0.55;
          const x = mid.x + right.x * off - d.x * back, z = mid.z + right.z * off - d.z * back;
          put(i, x, z, yawTo(x, z, x + d.x, z + d.z), [null, 'p38', 'mosin', 'mosin', 'p38', null, 'mosin'][i]);
        });
      },
      tick: (_t, _S, dt) => cast().forEach((a) => { a.go(a.pos.x + d.x * 5, a.pos.z + d.z * 5, 1.7, dt); a.sprint = false; }),
      cam: (t) => {
        const k = ease(t / b(2));
        const lead = A(3).pos;
        const p = new THREE.Vector3(lead.x + d.x * lerp(9, 7, k), 0, lead.z + d.z * lerp(9, 7, k));
        p.y = S.ground(p.x, p.z) + lerp(0.7, 0.95, k);
        return { p, l: A(3).chest(), fov: 40 };
      },
      titles: soon('NEW GAME MODES', 2),
    });
  }

  // ============================================================ 20. and more; everything at once (bars 70-76)
  {
    const places = [...open].filter((o) => dist(o, K) > 50);
    type Kind = 'drum' | 'dance' | 'punch' | 'nade' | 'loot' | 'head' | 'hands' | 'back';
    // four cuts under AND MORE; then two each for the four words the film ends on
    const kinds: Kind[] = ['drum', 'dance', 'punch', 'nade', 'loot', 'loot', 'nade', 'head', 'hands', 'back', 'dance', 'dance'];
    const words: [string, string][] = [['LOOT.', 'word'], ['FIGHT.', 'word'], ['BETRAY.', 'word'], ['GET PAID.', 'word gold']];
    kinds.forEach((kind, k) => {
      const at = places[(k * 3 + 2) % places.length];
      const ang = k * 1.37 + 0.6, sep = kind === 'punch' ? 1.2 : kind === 'back' ? 4.5 : 10 + (k % 3) * 3;
      const sx = at.x + Math.cos(ang) * sep, sz = at.z + Math.sin(ang) * sep;
      const away = new THREE.Vector3(at.x - sx, 0, at.z - sz).normalize();
      const one = () => A(k % 2 ? 3 : 0), two = () => A(k % 2 ? 4 : 2), three = () => A(k % 2 ? 5 : 6);
      const everyone = k >= 10;
      const dancers = () => cast().slice(0, everyone ? 7 : 5);
      const finale = k >= 4;
      const titles: Title[] = finale ? [{ at: 0.02, until: b(0.5) - 0.02, text: words[Math.floor((k - 4) / 2)][0], cls: words[Math.floor((k - 4) / 2)][1] }] : [{ at: 0, until: b(0.5), text: 'COMING SOON', cls: 'soonbar' }, { at: 0.02, until: b(0.5) - 0.02, text: 'AND MORE', cls: 'soon' }];
      add(70 + k * 0.5, 0.5, {
        name: `burst-${k}`,
        setup: async () => {
          strike();
          S.parkMe();
          const face = yawTo(at.x, at.z, sx, sz);
          if (kind === 'drum') {
            // the drum of the story again, with two standing by it who should have known better
            const p1 = byDrum(-1.5, 1.0), p2 = byDrum(-0.5, -1.7);
            two().place(p1.x, p1.z, yawTo(p1.x, p1.z, shooter.x, shooter.z), 'p38', GEAR[4]).hp = 60;
            three().place(p2.x, p2.z, yawTo(p2.x, p2.z, shooter.x, shooter.z) + 0.5, 'mosin', GEAR[5]).hp = 60;
          } else if (kind === 'dance') {
            dancers().forEach((a, i, all) => {
              const q = (i / all.length) * Math.PI * 2 + 0.3, r = everyone ? 2.7 : 2.1;
              const x = at.x + Math.cos(q) * r, z = at.z + Math.sin(q) * r;
              a.place(x, z, yawTo(x, z, at.x, at.z), null, GEAR[i]).dance = true;
            });
            await preroll(45);
          } else if (kind === 'punch') {
            two().place(at.x, at.z, face, null, GEAR[2]).hp = 20;
            one().place(sx, sz, yawTo(sx, sz, at.x, at.z), null, GEAR[0]);
          } else if (kind === 'nade') {
            two().place(at.x - 0.9, at.z + 0.3, face + 2.6, 'p38', GEAR[2]).hp = 55;
            three().place(at.x + 0.8, at.z - 0.6, face + 3.4, 'mosin', GEAR[6]).hp = 55;
          } else if (kind === 'loot') {
            // somebody going through the pockets of somebody who no longer needs them
            two().place(at.x, at.z, face, null, GEAR[k % 2 ? 4 : 2]).die(away);
            const lx = at.x + Math.cos(ang + 1.6) * 1.05, lz = at.z + Math.sin(ang + 1.6) * 1.05;
            one().place(lx, lz, yawTo(lx, lz, at.x, at.z), null, GEAR[k % 2 ? 1 : 0]).crouch = true;
            await preroll(75);
          } else if (kind === 'hands') {
            // one with the hands up, one with a rifle on him
            two().place(at.x, at.z, face, null, GEAR[5]).surrender = true;
            one().place(at.x + Math.cos(ang) * 3.4, at.z + Math.sin(ang) * 3.4, yawTo(at.x + Math.cos(ang) * 3.4, at.z + Math.sin(ang) * 3.4, at.x, at.z), 'mosin', GEAR[0]).aim = true;
            await preroll(30);
          } else if (kind === 'back') {
            // one walking away, and the one behind him with a pistol
            two().place(at.x, at.z, yawTo(sx, sz, at.x, at.z), 'mosin', GEAR[0]).hp = 30;
            one().place(sx, sz, yawTo(sx, sz, at.x, at.z), 'p38', GEAR[1]).aim = true;
          } else {
            two().place(at.x, at.z, face + Math.PI / 2, 'mosin', GEAR[4]).hp = 40;
            one().place(sx, sz, yawTo(sx, sz, at.x, at.z), 'mosin', GEAR[3]).aim = true;
          }
        },
        tick: (_t, _S, dt) => {
          if (kind === 'dance') dancers().forEach((a) => (a.dance = true));
          if (kind === 'hands') two().surrender = true;
          if (kind === 'loot') one().crouch = true;
          if (kind === 'back' && two().alive) {
            two().go(two().pos.x + away.x * 5, two().pos.z + away.z * 5, 1.5, dt);
            two().sprint = false;
          }
        },
        cues: kind === 'punch'
          ? [{ at: 0.12, fn: () => one().rp.swing() }, { at: 0.34, fn: () => two().hurt(60, away) }]
          : kind === 'nade'
            ? [{ at: 0.02, fn: () => g.grenades.throw(P(at.x + Math.cos(ang) * 5, at.z + Math.sin(ang) * 5, 1.4), new THREE.Vector3(-Math.cos(ang) * 6.5, 1.6, -Math.sin(ang) * 6.5), 0.5, true) }]
            : kind === 'drum'
              ? [{ at: 0.3, fn: () => g.blowBarrel(drum.i, true) }]
              : kind === 'head'
                ? [{ at: 0.16, fn: () => one().fireAt(two().head(), 0) }]
                : kind === 'back'
                  ? [{ at: 0.3, fn: () => one().fireAt(two().chest(), 0) }, { at: 0.44, fn: () => { if (two().alive) two().die(away); } }]
                  : [],
        // the one to the head is the one you remember: slow, close
        rate: kind === 'head' ? (t) => (t < 0.14 ? 1 : 0.22) : undefined,
        cam: kind === 'drum'
          ? (t) => { const q = byDrum(lerp(10, 8.8, ease(t / b(0.5))), -3.2); return { p: P(q.x, q.z, 1.25), l: drumAt(drum, 0.85), fov: 42 }; }
          : kind === 'dance'
            ? orbit(P(at.x, at.z, 1.0), k === 11 ? 7.0 : everyone ? 7.4 : 6.2, k === 11 ? 6.2 : everyone ? 6.6 : 5.4, ang + (k === 11 ? 2.2 : 0), ang + (k === 11 ? 2.7 : 0.5), k === 11 ? -0.35 : 0.5, k === 11 ? -0.4 : 0.3, k === 11 ? 46 : 40, b(0.5))
            : kind === 'punch'
              ? orbit(P((at.x + sx) / 2, (at.z + sz) / 2, 1.25), 3.6, 3.1, ang + 1.3, ang + 1.75, 0.15, 0.05, 40, b(0.5))
              : kind === 'nade'
                ? orbit(P(at.x, at.z, 0.9), 7.5, 6.6, ang + 2.2, ang + 2.5, 0.5, 0.3, 42, b(0.5))
                : kind === 'loot'
                  ? orbit(P(at.x, at.z, 0.55), 4.4, 3.7, ang + (k % 2 ? 3.4 : 2.5), ang + (k % 2 ? 3.8 : 2.9), 0.55, 0.4, 38, b(0.5))
                  : kind === 'hands'
                    ? orbit(P(at.x + Math.cos(ang) * 1.4, at.z + Math.sin(ang) * 1.4, 1.2), 5.2, 4.6, ang + 1.4, ang + 1.8, 0.2, 0.1, 38, b(0.5))
                    : kind === 'back'
                      ? (t) => { const o = one().pos; return { p: new THREE.Vector3(o.x - away.x * 1.7 - away.z * 0.75, o.y + 1.62, o.z - away.z * 1.7 + away.x * 0.75), l: two().chest(), fov: lerp(38, 33, t / b(0.5)) }; }
                      : (t) => ({ p: P(at.x + Math.cos(ang + 1.3) * 3.1, at.z + Math.sin(ang + 1.3) * 3.1, 1.5), l: P(at.x, at.z, 1.35 - t * 0.5), fov: 30 }),
        titles,
      });
    });
  }

  // ============================================================ 21. the name and where to find it (bars 76-80)
  add(76, 4, {
    name: 'end',
    setup: () => {
      strike();
      S.parkMe();
      shutAll();
    },
    cam: (t) => {
      const a = 0.9 + t * 0.02;
      return { p: P(c.x + Math.cos(a) * 230, c.z + Math.sin(a) * 230, 0).setY(S.ground(c.x, c.z) + 52), l: P(c.x, c.z, 6), fov: 50 };
    },
    bars: false,
    titles: [{
      at: 0,
      until: b(4) + 1,
      text: `<div class="end-logo">ZONA</div><div class="end-line">FREE IN YOUR BROWSER · PAID IN SOL</div><div class="end-url">WWW.ZONAPVP.FUN</div><div class="end-x">X · @${X_HANDLE}</div><div class="end-ca"><b>$ZONA</b>${CONTRACT}</div>`,
      cls: 'end',
    }],
  });

  shots.sort((x, y) => x.start - y.start);
  return shots;
}

// ------------------------------------------------------------------------------------------ overlay pieces

const overlay = () => document.getElementById('tr-overlay')!;
const pieces: HTMLElement[] = [];
/** something of the film's own laid over the picture: made once, shown by the shot that wants it */
function gfx(cls: string, html: string) {
  const el = document.createElement('div');
  el.className = `tr-gfx ${cls}`;
  el.innerHTML = html;
  el.style.display = 'none';
  overlay().appendChild(el);
  pieces.push(el);
  return el;
}
function showGfx(el: HTMLElement, t: number) {
  el.style.display = '';
  el.style.setProperty('--t', t.toFixed(3));
}
function hideGfx() {
  for (const el of pieces) el.style.display = 'none';
}
