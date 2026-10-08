// The second trailer: what has changed in the Zone. Same method as the first (shots.ts): the
// real game on a clock that only moves when the film says, on a 128 BPM grid, forty bars,
// 75 seconds. None of its scenes are the first one's.
//
// The story: a fist fight where you land, a raid on the police station, a supply drop that
// everybody runs at and one grenade that ends the argument, then a tag in your pocket, the
// map giving you away, a cabin door to hold until the clock runs out. After it: what the
// game is, what is new, what is coming, and a run of quick endings.
//
// As before, the people are the game's own player bodies with a small brain, their bullets
// and grenades are the game's, and whoever is hit bleeds and falls the way the game makes
// them. The film's own: the cameras, the titles, the money, the speech bubbles and the
// dancing (both in scenes that say COMING SOON), and the five at the crate being already
// hurt from fighting each other when the grenade lands.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import type { Arrangement } from './music';
import { BAR } from './shots';
import { makeItem, TAG_HOLD } from '../sim/items';
import { describeSpot } from '../sim/drops';
import { physics, USE_GROUPS } from '../core/physics';
import { audio } from '../core/audio';

const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = THREE.MathUtils.clamp;
const mix = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
const yawTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(-(bx - ax), -(bz - az));
const b = (bars: number) => bars * BAR;

/** the player the film follows, as the kill feed and the leaderboard name them */
const HERO = 'Sable';

// ------------------------------------------------------------------------------------------ the score
// In E minor this time (the first was in D minor), one row per bar: root, minor?, how it is played.
const Em = 40, C = 36, G = 43, D = 38, B = 35;
export const ARRANGEMENT: Arrangement = {
  rows: [
    [Em, true, 'low'], [C, false, 'low'],
    [Em, true, 'drive'], [D, false, 'drive'],
    [Em, true, 'pulse'], [C, false, 'pulse'], [G, false, 'pulse'], [D, false, 'build'],
    [Em, true, 'full'], [C, false, 'full'],
    [G, false, 'drive'], [D, false, 'drive'], [Em, true, 'full'],
    [Em, true, 'tense'], [Em, true, 'tense'],
    [C, false, 'full'], [G, false, 'full'],
    [Em, true, 'tick'], [C, false, 'tick'], [G, false, 'tick'],
    [D, false, 'tense'], [Em, true, 'tense'],
    [Em, true, 'drive'], [B, false, 'drive'],
    [G, false, 'bright'], [D, false, 'bright'],
    [Em, true, 'top'], [C, false, 'top'], [G, false, 'top'], [D, false, 'top'],
    [C, false, 'bright'], [G, false, 'bright'],
    [Em, true, 'pulse'], [D, false, 'build'],
    [Em, true, 'top'], [C, false, 'top'], [G, false, 'top'], [B, false, 'top'],
    [Em, true, 'end'], [Em, true, 'end'],
  ],
  // the first punch, the drop, the grenade, the tag cashed in, and the bar lines the cut turns on
  hits: [[2 * BAR, 0.7], [8 * BAR, 1], [15 * BAR + 0.08, 1.25], [24 * BAR + 0.45, 0.9], [26 * BAR, 1], [28 * BAR, 0.8], [30 * BAR, 0.7], [34 * BAR, 1], [38 * BAR, 1.2]],
  risers: [[1 * BAR, 2 * BAR, 0.35], [6.5 * BAR, 8 * BAR, 0.9], [13 * BAR + 0.85, 15 * BAR + 0.08, 0.7], [23 * BAR, 24 * BAR + 0.45, 0.6], [33 * BAR, 34 * BAR, 0.7], [36 * BAR, 38 * BAR, 1]],
};

type Bld = { id: string; type: string; x: number; z: number; rot: number; floorY: number };
type DoorLike = { id: string; pivot: THREE.Object3D; open: boolean; setOpen(o: boolean, swing?: number): void; toggle(from?: THREE.Vector3): void };

export function buildShots(S: Stage): Shot[] {
  const g = S.g, world = S.world;
  const c = world.pois[0] as { x: number; z: number };
  const P = (x: number, z: number, up = 0) => S.at(x, z, up);
  const clock = (window as any).__clock;

  // ------------------------------------------------------------ finding places to film
  const near = (list: { x: number; z: number }[], x: number, z: number, r: number) => list.some((o) => Math.hypot(o.x - x, o.z - z) < r);
  const trees = world.trees as { kind: string; x: number; z: number }[];
  const trunks = trees.filter((t) => !t.kind.startsWith('bush'));
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
      if (near(world.buildings, x, z, 17) || near(trunks, x, z, 9) || near(world.props ?? [], x, z, 4) || near(world.rocks ?? [], x, z, 5)) continue;
      if (flat(x, z, 7) > 0.9 || near(open, x, z, 40)) continue;
      open.push({ x, z });
    }
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
  const station = (world.buildings as Bld[]).find((x) => x.type === 'police')!;
  const SHD = 4.5; // half the station's depth: its front wall
  const stationFront = { x: Math.sin(station.rot), z: Math.cos(station.rot) };

  // the supply drop: in the open, and as nearly straight out of the station's door as the map allows
  const sdoor = local(station, 0, SHD);
  let dropAt = open[0];
  {
    let best = -1e9;
    for (const o of open) {
      const dx = o.x - sdoor.x, dz = o.z - sdoor.z, d = Math.hypot(dx, dz);
      if (d < 60 || d > 190) continue;
      const score = ((dx * stationFront.x + dz * stationFront.z) / d) * 100 - Math.abs(d - 110) * 0.25;
      if (score > best) {
        best = score;
        dropAt = o;
      }
    }
  }
  const dropY = S.ground(dropAt.x, dropAt.z);
  const DROP_UID = 'drop-film';
  // where the grenade comes from: nineteen metres off, level with the crate, a clear throw
  let u = new THREE.Vector3(1, 0, 0);
  for (let k = 0; k < 24; k++) {
    const a = k * 0.2618 + 0.4;
    const t = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const nx = dropAt.x + t.x * 19, nz = dropAt.z + t.z * 19;
    if (near(trunks, nx, nz, 2.5) || near(world.buildings, nx, nz, 10) || near(world.props ?? [], nx, nz, 3) || Math.abs(S.ground(nx, nz) - dropY) > 1.2) continue;
    if (!S.clearLine(P(nx, nz, 1.6), P(dropAt.x + t.x * 1.9, dropAt.z + t.z * 1.9, 1))) continue;
    u = t;
    break;
  }
  const v = new THREE.Vector3(-u.z, 0, u.x);
  const nest = { x: dropAt.x + u.x * 19, z: dropAt.z + u.z * 19 };
  /** where the grenade is meant to land: on the thrower's side of the crate, among them */
  const blast = { x: dropAt.x + u.x * 1.9, z: dropAt.z + u.z * 1.9 };
  const others = open.filter((o) => Math.hypot(o.x - dropAt.x, o.z - dropAt.z) > 45);
  console.log(`[tr] cut 2: ${open.length} open places; drop at ${dropAt.x.toFixed(0)},${dropAt.z.toFixed(0)}, ${Math.hypot(dropAt.x - sdoor.x, dropAt.z - sdoor.z).toFixed(0)} m from the station door`);

  // the cabin the last stand is made in: the one with the clearest run up to its door
  const CHD = 2.5;
  let cabin = (world.buildings as Bld[]).find((x) => x.type === 'cabin')!;
  {
    let best = 1e9;
    for (const cb of (world.buildings as Bld[]).filter((x) => x.type === 'cabin')) {
      let hits = 0;
      for (let z = CHD + 2; z < CHD + 30; z += 1.5) for (const x of [-2, 0, 2]) { const w = local(cb, x, z); if (near(trunks, w.x, w.z, 1.3) || near(world.buildings.filter((o: Bld) => o !== cb), w.x, w.z, 6)) hits++; }
      if (hits < best) {
        best = hits;
        cabin = cb;
      }
    }
  }

  const shots: Shot[] = [];
  const add = (start: number, len: number, s: Omit<Shot, 'start' | 'end'>) => shots.push({ ...s, start: b(start), end: b(start + len) });
  const cast = () => S.actors;
  const hideAll = () => cast().forEach((a) => {
    // (a shot may have given one its own way of being hurt: see tough)
    delete (a as any).hurt;
    a.rp.avatar.clearWounds();
    a.hide();
    lampOn(null);
    document.body.classList.remove('tr-map-big');
  });
  /** what the HUD is still saying from before the camera rolled */
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
  const title = (text: string, at = 0.25, until = 1.6, cls = 'big') => ({ at, until, text, cls });
  /** a camera circling a point */
  const orbit = (mid: THREE.Vector3, r0: number, r1: number, a0: number, a1: number, h0: number, h1: number, fov: number, dur: number) => (t: number): CamPose => {
    const k = ease(t / dur), a = lerp(a0, a1, k), r = lerp(r0, r1, k);
    const p = new THREE.Vector3(mid.x + Math.cos(a) * r, 0, mid.z + Math.sin(a) * r);
    p.y = Math.max(S.ground(p.x, p.z) + 0.45, mid.y + lerp(h0, h1, k));
    return { p, l: mid, fov };
  };
  /** time that passes before the camera rolls (smoke building, a body settling): unseen and unheard */
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
  };
  /** scrub the set, but leave smoke standing (a column over a supply drop takes ten seconds to build) */
  const scrub = () => {
    const keep = (g.effects.particles as { alive: boolean; max: number }[]).filter((p) => p.alive && p.max > 5);
    S.clean();
    for (const p of keep) p.alive = true;
  };
  /** a lamp of the film's own, for a room the sun does not reach (off unless a shot lights it) */
  const lamp = new THREE.PointLight(0xffdfb4, 0, 9, 1.5);
  g.s.r.scene.add(lamp);
  // (the hands and what they hold are drawn in a scene of their own, at the eye: the lamp reaches them through this)
  const handLamp = new THREE.DirectionalLight(0xffdfb4, 0);
  g.weapons.vmScene.add(handLamp);
  const lampOn = (at: THREE.Vector3 | null, power = 9) => {
    lamp.intensity = at ? power : 0;
    handLamp.intensity = at ? 1.5 : 0;
    if (at) lamp.position.copy(at);
  };
  /** every frame the lamp is lit: which way it lies from the eye */
  const lampAim = () => handLamp.position.copy(lamp.position).sub(g.s.r.camera.position).normalize().multiplyScalar(10);
  /** it takes n hits to put this one down, wherever they land */
  const tough = (a: Actor, n: number) => {
    let hits = 0;
    const hurt = a.hurt.bind(a);
    a.hurt = (_amount: number, dir: THREE.Vector3) => hurt(++hits >= n ? 999 : 1, dir, false);
  };

  // ------------------------------------------------------------ the scoreboard under the map
  const score = { kills: 0, tags: 0 };
  const rivals: [string, number, number][] = [['Volkov', 7, 1], ['Mira', 6, 1], ['Kestrel', 5, 0], ['Dmitri', 4, 0], ['Oksana', 3, 0]];
  const showBoard = (kills = score.kills, tags = score.tags) => {
    score.kills = kills;
    score.tags = tags;
    const all = [...rivals, [HERO, kills, tags] as [string, number, number]].sort((x, y) => y[2] - x[2] || y[1] - x[1]);
    g.hud.setBoard(all.slice(0, 5), all.findIndex((r) => r[0] === HERO), [kills, tags], HERO);
  };
  const noDrop = () => {
    if (g.drops.has(DROP_UID)) {
      S.mute = true;
      g.removeDrop(DROP_UID);
      S.mute = false;
      hush();
    }
  };
  /** the crate and its smoke, standing long enough for the column to be up */
  const ensureDrop = async (cam?: CamPose) => {
    if (g.drops.has(DROP_UID)) return;
    S.mute = true;
    await g.addDrop({ uid: DROP_UID, x: dropAt.x, y: dropY, z: dropAt.z, rot: Math.atan2(u.x, u.z) + 0.5, left: 36000 }, true);
    await preroll(600, cam ?? { p: P(dropAt.x + u.x * 30, dropAt.z + u.z * 30, 10), l: P(dropAt.x, dropAt.z, 3), fov: 50 });
    S.mute = false;
    hush();
  };
  const dropWords = () => `Supply drop ${describeSpot(world as never, dropAt.x, dropAt.z)}`;

  // ============================================================ 1. the forest (bars 0-2)
  {
    // a straight run between the trunks, toward the village
    let A = P(c.x + 200, c.z, 0), Bp = P(c.x + 166, c.z, 0), bestN = -1;
    for (let a = 0; a < Math.PI * 2; a += 0.11) {
      for (const r0 of [215, 195, 175, 155]) {
        const ax = c.x + Math.cos(a) * r0, az = c.z + Math.sin(a) * r0, bx = c.x + Math.cos(a) * (r0 - 36), bz = c.z + Math.sin(a) * (r0 - 36);
        let ok = true, n = 0;
        for (let k = 0; k <= 12 && ok; k++) {
          const x = lerp(ax, bx, k / 12), z = lerp(az, bz, k / 12);
          if (near(trunks, x, z, 1.7) || near(world.rocks ?? [], x, z, 2.5) || near(world.buildings, x, z, 12)) ok = false;
        }
        if (!ok || Math.abs(S.ground(ax, az) - S.ground(bx, bz)) > 5) continue;
        for (const t of trunks) if (Math.hypot(t.x - (ax + bx) / 2, t.z - (az + bz) / 2) < 20) n++;
        if (n > bestN) {
          bestN = n;
          A = P(ax, az, 0);
          Bp = P(bx, bz, 0);
        }
      }
    }
    const dir = Bp.clone().sub(A).setY(0).normalize();
    add(0, 2, {
      name: 'forest',
      setup: () => {
        hideAll();
        S.parkMe();
        scrub();
        noDrop();
        shutAll();
      },
      cam: (t) => {
        const k = t / b(2);
        const at = mix(A, Bp, ease(k * 0.85 + 0.05));
        at.y = S.ground(at.x, at.z) + 1.45 + 0.03 * Math.sin(t * 5.2);
        const look = at.clone().addScaledVector(dir, 14);
        look.y = S.ground(look.x, look.z) + 1.9 + k * 1.2;
        return { p: at, l: look, fov: 52, roll: 0.012 * Math.sin(t * 2.6) };
      },
      titles: [{ at: 0.5, until: 1.7, text: 'ZELENAYA DOLINA', cls: 'small' }, { at: 1.9, until: 3.6, text: 'THE ZONE HAS CHANGED', cls: 'big' }],
    });
  }

  // ============================================================ 2. fists (bars 2-4)
  {
    // out at the edge of the fields, the village ahead
    const edge = [...open].filter((o) => Math.hypot(o.x - dropAt.x, o.z - dropAt.z) > 70).sort((p, q) => Math.hypot(q.x - c.x, q.z - c.z) - Math.hypot(p.x - c.x, p.z - c.z))[0] ?? open[open.length - 1];
    const sp = { x: edge.x, z: edge.z, yaw: yawTo(edge.x, edge.z, c.x, c.z) };
    const fwd = { x: -Math.sin(sp.yaw), z: -Math.cos(sp.yaw) };
    let downAt = -1;
    const V = () => cast()[5];
    const hitMe = () => {
      if (!V().alive) return;
      g.weapons.flinch(1.1);
      g.hud.hitFrom((S.rnd() - 0.5) * 0.6);
      g.player.damage(7, 'a beating');
    };
    add(2, 2, {
      name: 'fists',
      hud: true,
      setup: () => {
        hideAll();
        scrub();
        noDrop();
        showBoard(0, 0);
        S.kit(['sprats', 'thermos', 'bandage']);
        S.hold(null);
        S.me(sp.x, sp.z, sp.yaw, -0.02);
        V().place(sp.x + fwd.x * 3.2, sp.z + fwd.z * 3.2, sp.yaw + Math.PI, null, ['boonie_hat']);
        // five of these put him down
        tough(V(), 5);
        downAt = -1;
        V().onDeath = () => {
          downAt = -2;
          S.feedKill(HERO, V().name, 'fists');
          showBoard(1, 0);
        };
      },
      tick: (t) => {
        const p = g.player, o = V();
        const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
        if (o.alive) {
          o.yaw = yawTo(o.pos.x, o.pos.z, p.pos.x, p.pos.z);
          // he comes forward too, until they are toe to toe
          if (d > 1.25) o.go(p.pos.x, p.pos.z, 1.6, 1 / 60);
        }
        if (downAt === -2) downAt = t;
        if (o.alive) S.aimAt(o.pos.clone().setY(o.pos.y + 1.36));
        else {
          // he is watched to the ground, then the eyes come up to the village
          const k = ease((t - downAt - 0.45) / 0.9);
          const cam = g.s.r.camera.position, low = o.pos.clone().setY(o.pos.y + 0.4);
          const yaw = Math.atan2(-(low.x - cam.x), -(low.z - cam.z)), pitch = Math.atan2(low.y - cam.y, Math.hypot(low.x - cam.x, low.z - cam.z));
          p.yaw = lerp(yaw, sp.yaw, k);
          p.pitch = lerp(Math.max(pitch, -0.75), -0.02, k);
        }
        S.key('Mouse2', t < 0.45);
        S.key('KeyW', t > 0.2 && d > 1.08 && o.alive);
        if (o.alive && d < 1.3 && t > 0.55 && !g.weapons.busy) S.tap('Mouse0', 50);
      },
      cues: [
        { at: 0.95, fn: () => { if (V().alive) V().rp.swing(); } }, { at: 1.15, fn: hitMe },
        { at: 1.75, fn: () => { if (V().alive) V().rp.swing(); } }, { at: 1.95, fn: hitMe },
      ],
      titles: [title('YOU START WITH YOUR FISTS', 0.35, 3.3)],
    });
  }

  // ============================================================ 3. the station, four cuts (bars 4-8)
  /** stand `dist` from something and look at it */
  const roofed = (x: number, z: number, y: number) => !!physics.raycast({ x, y: y + 0.4, z }, { x: 0, y: 1, z: 0 }, 9);
  const standBy = (x: number, y: number, z: number, rot: number, dist: number) => {
    let best: [number, number] = [x + Math.sin(rot) * dist, z + Math.cos(rot) * dist];
    for (const a of [rot, rot + Math.PI, rot + Math.PI / 2, rot - Math.PI / 2, rot + 0.8, rot - 0.8, rot + 2.3, rot - 2.3]) {
      const px = x + Math.sin(a) * dist, pz = z + Math.cos(a) * dist;
      if (!physics.boxOverlaps({ x: px, y: y + 0.9, z: pz }, 0, 0.28, 0.7, 0.28) && roofed(px, pz, y) === roofed(x, z, y) && S.clearLine(new THREE.Vector3(px, y + 1.5, pz), new THREE.Vector3(x, y + 0.14, z).lerp(new THREE.Vector3(px, y + 1.5, pz), 0.12))) {
        best = [px, pz];
        break;
      }
    }
    return best;
  };
  const floorUnder = (x: number, z: number, y: number) => {
    const hit = physics.raycast({ x, y: y + 0.6, z }, { x: 0, y: -1, z: 0 }, 4);
    return hit ? hit.point.y : S.ground(x, z);
  };
  /** one of these lying where the player's reach really lands on it, nearest the station's armoury first */
  const lootOf = (id: string) => {
    const all = [...g.loot.items.values()].map((w: any) => w.loot).filter((l: any) => l.item.id === id) as { x: number; y: number; z: number; point: number }[];
    const tries: { l: (typeof all)[number]; px: number; pz: number; fy: number; kneel: boolean; score: number }[] = [];
    for (const l of all) {
      const pt = l.point >= 0 ? g.s.buildings.lootPoints[l.point] : null;
      const [px, pz] = standBy(l.x, l.y, l.z, pt?.surf?.rot ?? 0, 1.2);
      const fy = floorUnder(px, pz, l.y);
      const up = l.y - fy;
      if (up > 1.25) continue;
      const kneel = up < 0.3;
      const eye = new THREE.Vector3(px, fy + (kneel ? 1.02 : 1.64), pz);
      const to = new THREE.Vector3(l.x, l.y + 0.05, l.z).sub(eye);
      const len = to.length();
      const hit = physics.raycast(eye, to.normalize(), 2.6, USE_GROUPS);
      if (!hit || (hit.tag?.owner as any)?.loot !== l || len > 2.4) continue;
      tries.push({ l, px, pz, fy, kneel, score: Math.hypot(l.x - station.x, l.z - station.z) + (up > 0.4 ? 0 : 3) });
    }
    tries.sort((x, y) => x.score - y.score);
    return tries[0];
  };
  {
    const sd = () => doorsOf(station)[0];
    let pressed = false;
    add(4, 1, {
      name: 'station-door',
      hud: true,
      setup: () => {
        hideAll();
        scrub();
        noDrop();
        shutAll();
        showBoard(1, 0);
        pressed = false;
        S.kit(['sprats', 'thermos', 'bandage']);
        S.hold(null);
        const at = local(station, 0.3, SHD + 6.4), to = local(station, 0.1, SHD);
        S.me(at.x, at.z, yawTo(at.x, at.z, to.x, to.z), -0.03);
      },
      tick: (t) => {
        const p = g.player;
        const l = { x: 0, z: 0 };
        {
          const dx = p.pos.x - station.x, dz = p.pos.z - station.z, co = Math.cos(station.rot), si = Math.sin(station.rot);
          l.x = dx * co - dz * si;
          l.z = dx * si + dz * co;
        }
        // at the door until it is behind us, then into the room
        const aim = l.z > SHD - 0.6 ? inside(station, 0.1, SHD - 0.3, 1.25) : inside(station, 1.6, -1.2, 1.3);
        const want = yawTo(p.pos.x, p.pos.z, aim.x, aim.z);
        p.yaw += Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw)) * 0.2;
        S.key('KeyW', t > 0.05);
        S.key('ShiftLeft', t > 0.05);
        p.vitals.stamina = 300;
        if (!pressed && l.z < SHD + 2.5) {
          pressed = true;
          S.tap('KeyF');
        }
      },
      titles: [title('RAID THE STATION', 0.15, 1.7)],
    });
    // a gun in the station (a rifle if there is one), picked up
    let at = new THREE.Vector3();
    let gun = 'mosin';
    add(5, 1, {
      name: 'station-arms',
      hud: true,
      setup: () => {
        noDrop();
        showBoard(1, 0);
        const inStation = (l: { x: number; z: number }) => Math.hypot(l.x - station.x, l.z - station.z) < 9;
        const rifle = lootOf('mosin'), pistol = lootOf('p38');
        const pick = rifle && (inStation(rifle.l) || !pistol || !inStation(pistol.l)) ? rifle : pistol ?? rifle;
        if (!pick) throw new Error('no gun lying in the world where it can be filmed');
        gun = pick === rifle ? 'mosin' : 'p38';
        S.kit(['sprats', 'thermos', 'bandage']);
        S.hold(null);
        S.me(pick.px, pick.pz, yawTo(pick.px, pick.pz, pick.l.x, pick.l.z) + 0.5, -0.1, pick.fy);
        if (pick.kneel) g.player.setCrouch(true);
        at = new THREE.Vector3(pick.l.x, pick.l.y + 0.06, pick.l.z);
      },
      tick: (t) => {
        const p = g.player, cam = g.s.r.camera.position;
        const yaw = Math.atan2(-(at.x - cam.x), -(at.z - cam.z)), pitch = Math.atan2(at.y - cam.y, Math.hypot(at.x - cam.x, at.z - cam.z));
        const k = ease(t / 0.5);
        p.yaw = yaw + 0.5 * (1 - k);
        p.pitch = lerp(-0.1, pitch, k);
      },
      cues: [{ at: 0.8, fn: () => S.tap('KeyF') }, { at: 1.05, fn: () => S.hold(gun === 'mosin' ? 'primary' : 'holster', true) }],
      titles: [title('ARM UP', 0.15, 1.7, 'top')],
    });
    // the pockets: something to wear, dragged onto the survivor
    add(6, 1, {
      name: 'station-kit',
      chain: true,
      hud: true,
      setup: () => {
        if (!g.inv.find((i: any) => i.id === 'mosin' || i.id === 'p38')) g.inv.add(makeItem(gun));
        // a hat in a pocket (asked simply to carry it, the inventory would put it straight on)
        if (g.inv.slots.head) g.inv.remove(g.inv.slots.head);
        if (!g.inv.find((i: any) => i.id === 'boonie_hat')) {
          const hat = makeItem('boonie_hat');
          if (g.inv.jacket.add(hat)) throw new Error('no pocket takes the hat');
        }
        g.inventoryChanged();
        dragReset();
      },
      cues: [{ at: 0.12, fn: () => S.tap('Tab') }],
      after: (t) => dragItem(t, 0.55, 1.3, '.inv-cargo .inv-item.cat-clothing', '.inv-doll'),
      titles: [title('DRAG IT ON. WEAR IT.', 0.15, 1.75, 'top')],
    });
    // out of the door again, and there is smoke on the far side of the village
    add(7, 1, {
      name: 'station-out',
      chain: true,
      hud: true,
      setup: async () => {
        hideCursor();
        if (g.invUI.isOpen) g.toggleInventory(false);
        shutAll();
        sd().setOpen(true, 1);
        const at2 = local(station, 0.05, SHD - 3.1), to = local(station, 0.05, SHD + 4);
        S.me(at2.x, at2.z, yawTo(at2.x, at2.z, to.x, to.z), 0.02, station.floorY + 0.02);
        if (!g.inv.find((i: any) => i.id === 'mosin')) {
          S.kit(['mosin', ['ammo_762', 15], 'sprats', 'thermos', 'bandage', 'boonie_hat']);
        }
        S.hold(g.inv.find((i: any) => i.id === 'mosin') ? 'primary' : 'holster');
        await ensureDrop();
        showBoard(1, 0);
      },
      tick: (t) => {
        const p = g.player;
        S.key('KeyW', t > 0.15);
        // eyes up to the smoke once the lintel is out of the way
        const k = ease((t - 0.7) / 0.9);
        const want = yawTo(p.pos.x, p.pos.z, dropAt.x, dropAt.z);
        const base = yawTo(p.pos.x, p.pos.z, local(station, 0.05, SHD + 6).x, local(station, 0.05, SHD + 6).z);
        p.yaw = base + Math.atan2(Math.sin(want - base), Math.cos(want - base)) * k;
        p.pitch = lerp(0.02, 0.1, k);
      },
      cues: [{
        at: 0.3,
        fn: () => {
          g.hud.note(`${dropWords()}: there for 6 min, marked on the map (M)`, 'good');
          g.hud.feed(dropWords());
        },
      }],
      titles: [{ at: 0.45, until: 1.8, text: 'A SUPPLY DROP HAS COME DOWN', cls: 'small' }],
    });
  }

  // ============================================================ 4. the drop (bars 8-17)
  add(8, 2, {
    name: 'drop-reveal',
    setup: async () => {
      hideAll();
      S.parkMe();
      scrub();
      await ensureDrop();
    },
    cam: (t) => {
      const k = ease(t / b(2));
      const a = Math.atan2(u.z, u.x) + lerp(1.9, 1.15, k), r = lerp(78, 24, k);
      const p = new THREE.Vector3(dropAt.x + Math.cos(a) * r, 0, dropAt.z + Math.sin(a) * r);
      p.y = Math.max(S.ground(p.x, p.z) + 1.2, dropY + lerp(30, 4.2, k));
      return { p, l: P(dropAt.x, dropAt.z, lerp(9, 2.2, k)), fov: lerp(44, 38, k) };
    },
    titles: [title('SUPPLY DROPS', 0.2, 2.3), { at: 2.35, until: 3.65, text: 'THE BEST GEAR ON THE MAP · OUT IN THE OPEN', cls: 'small' }],
  });
  {
    // three of them, from three sides, flat out
    const runners = () => [cast()[0], cast()[1], cast()[2]];
    const from: { x: number; z: number; a: number }[] = [];
    for (let k = 0; k < 48 && from.length < 3; k++) {
      const a = Math.atan2(u.z, u.x) + 0.6 + k * 0.37;
      const dx = Math.cos(a), dz = Math.sin(a);
      let ok = !from.some((f) => Math.abs(Math.atan2(Math.sin(a - f.a), Math.cos(a - f.a))) < 0.75);
      for (let r = 26; r <= 62 && ok; r += 3) {
        const x = dropAt.x + dx * r, z = dropAt.z + dz * r;
        if (near(world.buildings, x, z, 14) || near(trunks, x, z, 2.6) || near(world.props ?? [], x, z, 2.6) || near(world.rocks ?? [], x, z, 3)) ok = false;
      }
      if (ok) from.push({ x: dropAt.x + dx * 58, z: dropAt.z + dz * 58, a });
    }
    while (from.length < 3) from.push({ x: dropAt.x + (u.x * 0.3 + v.x * (from.length - 1)) * 55, z: dropAt.z + (u.z * 0.3 + v.z * (from.length - 1)) * 55, a: 0 });
    add(10, 1.5, {
      name: 'drop-rush',
      setup: async () => {
        hideAll();
        S.parkMe();
        scrub();
        await ensureDrop();
        runners().forEach((a, i) => a.place(from[i].x, from[i].z, yawTo(from[i].x, from[i].z, dropAt.x, dropAt.z), ['mosin', 'p38', 'mosin'][i], [['sack_pack'], ['life_vest'], ['boonie_hat', 'suitcase']][i]));
      },
      tick: (_t, _S, dt) => runners().forEach((a) => a.go(dropAt.x, dropAt.z, 6.2, dt)),
      // over the first one's shoulder, the smoke ahead, the others closing from the sides
      cam: (t) => {
        const lead = runners()[0].pos;
        const dir = new THREE.Vector3(dropAt.x - lead.x, 0, dropAt.z - lead.z).normalize(), right = new THREE.Vector3(-dir.z, 0, dir.x);
        const k = ease(t / b(1.5));
        const p = lead.clone().addScaledVector(dir, -lerp(4.6, 3.3, k)).addScaledVector(right, lerp(1.7, 1.15, k));
        p.y = Math.max(S.ground(p.x, p.z) + 0.5, lead.y + lerp(1.15, 1.5, k));
        return { p, l: P(dropAt.x, dropAt.z, 4.5), fov: 44 };
      },
      titles: [title('EVERYONE KNOWS WHERE IT IS', 0.2, 2.5)],
    });
  }
  // five at the crate. Places are in the frame of the throw: u toward the thrower, v across.
  const ring: [number, number, string, string[]][] = [
    [-0.7, 1.35, 'p38', ['boonie_hat']],
    [-0.7, -1.35, 'p38', ['life_vest']],
    [1.5, 1.05, 'p38', ['sack_pack']],
    [1.3, -1.45, 'p38', []],
    [2.2, -0.1, 'mosin', ['boonie_hat', 'suitcase']],
  ];
  const five = () => cast().slice(0, 5);
  const ringAt = (i: number) => ({ x: blast.x + u.x * ring[i][0] + v.x * ring[i][1], z: blast.z + u.z * ring[i][0] + v.z * ring[i][1] });
  let fightT = 0;
  /** two are at the crate's lid, three are settling who gets it */
  const scrum = (dt: number) => {
    fightT += dt;
    const f = five();
    f.forEach((a, i) => {
      if (!a.alive) return;
      const to = ringAt(i);
      const d = Math.hypot(to.x - a.pos.x, to.z - a.pos.z);
      if (d > 0.08) a.go(to.x, to.z, 5.4, dt);
      else if (i < 2 && fightT < 1.5) {
        // at the crate, down on a knee, hands in it
        a.crouch = true;
        a.aim = false;
        a.yaw = yawTo(a.pos.x, a.pos.z, dropAt.x, dropAt.z);
      } else {
        a.crouch = false;
        a.think(fightT);
      }
    });
  };
  const startScrum = () => {
    hideAll();
    scrub();
    S.parkMe();
    fightT = 0;
    five().forEach((a, i) => {
      // the last few paces in, from further out along the same line
      const to = ringAt(i), out = i < 2 ? 2.5 : 6.5;
      const dx = to.x - dropAt.x, dz = to.z - dropAt.z, d = Math.hypot(dx, dz) || 1;
      a.place(to.x + (dx / d) * out, to.z + (dz / d) * out, yawTo(to.x, to.z, dropAt.x, dropAt.z), ring[i][2], ring[i][3]);
      a.hp = 1e4; // nobody wins this before the grenade has its say
      a.skill = 0.3;
      a.nextShot = 0.9 + S.rnd() * 0.5;
    });
    const f = five();
    f[2].foe = f[3];
    f[3].foe = f[2];
    f[4].foe = f[0];
    f[0].foe = f[4];
    f[1].foe = f[3];
  };
  add(11.5, 1.5, {
    name: 'drop-fight',
    setup: async () => {
      await ensureDrop();
      startScrum();
    },
    tick: (_t, _S, dt) => scrum(dt),
    cam: orbit(P(blast.x, blast.z, 1.1), 9.5, 6.2, Math.atan2(u.z, u.x) + 2.5, Math.atan2(u.z, u.x) + 1.2, 1.6, 0.4, 40, b(1.5)),
    titles: [title('AND EVERYONE WANTS IT', 0.2, 2.5)],
  });
  {
    const LAND = b(2) - 0.22;
    let thrownAt = -1, landed = false, lastVy = 0, total = 17, last: CamPose | null = null;
    const o0 = new THREE.Vector3();
    // the pitch that drops it on the mark: thrown at 15 m/s along the view, plus 3.2 m/s straight up
    const eyeY = S.ground(nest.x, nest.z) + 1.64, dist = Math.hypot(blast.x - nest.x, blast.z - nest.z), fall = eyeY - 0.1 - (S.ground(blast.x, blast.z) + 0.08);
    const reach = (th: number) => {
      const vy = 15 * Math.sin(th) + 3.2, vx = 15 * Math.cos(th);
      const T = (vy + Math.sqrt(vy * vy + 2 * 9.81 * (fall + 0.5 * Math.sin(th)))) / 9.81;
      return 0.5 * Math.cos(th) + vx * T;
    };
    let lo = -0.5, hi = 0.45;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (reach(m) < dist) lo = m;
      else hi = m;
    }
    const pitch = (lo + hi) / 2;
    add(13, 2, {
      name: 'nade',
      chain: true,
      hud: true,
      setup: () => {
        thrownAt = -1;
        landed = false;
        lastVy = 0;
        last = null;
        showBoard(1, 0);
        S.kit(['mosin', ['ammo_762', 10], 'grenade', 'bandage']);
        S.hold('primary');
        S.me(nest.x, nest.z, yawTo(nest.x, nest.z, blast.x, blast.z) + 0.1, -0.02);
        // they have been at each other for a while: none of them is whole
        five().forEach((a) => (a.hp = 60));
      },
      cues: [{
        at: 0.1,
        fn: () => {
          const it = g.inv.find((i: any) => i.id === 'grenade');
          if (it) g.useItem(it);
        },
      }],
      tick: (t, _S, dt) => {
        scrum(dt);
        five().forEach((a) => a.alive && (a.hp = Math.max(a.hp, 60)));
        const p = g.player;
        if (thrownAt < 0) {
          // the eyes settle on the middle of them, and the arm comes back
          const k = ease(t / 0.7);
          p.yaw = yawTo(p.pos.x, p.pos.z, blast.x, blast.z) + 0.1 * (1 - k);
          p.pitch = lerp(-0.02, pitch, k);
        }
        const n = S.myNade();
        if (n && thrownAt < 0) {
          thrownAt = t;
          o0.copy(n.pos);
          total = Math.hypot(blast.x - n.pos.x, blast.z - n.pos.z);
        }
        if (n) {
          // it goes off when the film says, not before
          n.fuse = Math.max(n.fuse, 2);
          if (n.resting || (lastVy < -1 && n.vel.y > 0)) landed = true;
          lastVy = n.vel.y;
        }
      },
      // its flight is stretched to fill the two bars; the world slows with it
      rate: (t) => {
        const n = S.myNade();
        if (!n || thrownAt < 0) return 1;
        if (landed) return 0.1;
        const k = clamp((t + 1 / 60 - thrownAt) / (LAND - thrownAt), 0, 1);
        const gone = Math.hypot(n.pos.x - o0.x, n.pos.z - o0.z);
        return clamp((total * k - gone) / (Math.max(1, Math.hypot(n.vel.x, n.vel.z)) / 60), 0.02, 1.2);
      },
      cam: () => {
        const n = S.myNade();
        if (!n) return thrownAt >= 0 ? last : null; // through the eyes until it leaves the hand
        const dir = new THREE.Vector3(blast.x - o0.x, 0, blast.z - o0.z).normalize(), right = new THREE.Vector3(-dir.z, 0, dir.x);
        if (landed) {
          last = { p: P(n.pos.x - dir.x * 3.3 + right.x * 1.6, n.pos.z - dir.z * 3.3 + right.z * 1.6, 0.85), l: n.pos.clone().setY(n.pos.y + 0.5), fov: 40 };
          return last;
        }
        const k = clamp(Math.hypot(n.pos.x - o0.x, n.pos.z - o0.z) / total, 0, 1);
        // riding behind it and a little above, swinging out as it comes down among them
        const p = n.pos.clone().addScaledVector(dir, -lerp(0.9, 1.7, k)).addScaledVector(right, lerp(0.15, 0.75, k));
        p.y = Math.max(S.ground(p.x, p.z) + 0.25, n.pos.y + lerp(0.22, 0.5, k));
        last = { p, l: mix(n.pos.clone().addScaledVector(dir, 4), P(blast.x, blast.z, 0.9), ease(k)), fov: lerp(54, 40, k), roll: 0.05 * Math.sin(k * 5) };
        return last;
      },
      after: () => document.body.classList.toggle('tr-hud-off', !!S.cam),
      bars: false,
    });
    // the blast, from beside them
    add(15, 1, {
      name: 'nade-blast',
      chain: true,
      setup: () => {
        five().forEach((a) => {
          a.onDeath = () => {
            score.kills++;
          };
        });
      },
      tick: (t, _S, dt) => {
        scrum(dt);
        const n = S.myNade();
        if (n) n.fuse = t >= 0.08 ? 0 : Math.max(n.fuse, 1);
      },
      rate: (t) => (t < 0.08 ? 0.2 : lerp(0.22, 0.95, ease((t - 0.3) / 1.3))),
      cam: (t) => {
        const k = ease(t / b(1));
        const a = Math.atan2(u.z, u.x) + lerp(1.75, 1.45, k);
        const p = P(blast.x + Math.cos(a) * lerp(6.8, 8.6, k), blast.z + Math.sin(a) * lerp(6.8, 8.6, k), lerp(0.9, 1.4, k));
        // the ground jumps under the tripod
        const shake = t > 0.08 ? 0.07 * Math.exp(-(t - 0.08) * 3.2) : 0;
        p.add(new THREE.Vector3(Math.sin(t * 71), Math.sin(t * 53 + 1), Math.sin(t * 61 + 2)).multiplyScalar(shake));
        return { p, l: P(blast.x, blast.z, 1.0), fov: 46, roll: shake * 0.5 * Math.sin(t * 47) };
      },
    });
    // and what the one who threw it sees: five names
    add(16, 1, {
      name: 'nade-count',
      chain: true,
      hud: true,
      setup: () => {
        const p = g.player;
        p.yaw = yawTo(p.pos.x, p.pos.z, blast.x, blast.z);
        p.pitch = -0.05;
        g.inv.active = 'primary';
        g.weapons.validate();
      },
      tick: (_t, _S, dt) => scrum(dt),
      cues: five().map((_, i) => ({
        at: 0.1 + i * 0.2,
        fn: () => {
          const a = five()[i];
          if (a.alive) return;
          S.feedKill(HERO, a.name, 'Stick Grenade', 19);
          g.weapons.confirmKill?.();
          showBoard(2 + i, 0);
        },
      })),
      titles: [title('FIVE WITH ONE', 0.3, 1.75)],
    });
  }

  // ============================================================ 5. the tag (bars 17-20)
  {
    let walkYaw = 0, tag: any = null;
    const owner = () => five()[2];
    add(17, 1.5, {
      name: 'tag',
      chain: true,
      hud: true,
      setup: async () => {
        // a body near the crate, and what is on it
        const st = g.corpses.get(owner().corpseId)?.stash;
        if (!st) throw new Error('the body did not appear');
        st.known = true;
        tag = makeItem('dogtag');
        tag.owner = owner().name;
        tag.pid = 'trailer-other';
        st.container.add(tag);
        st.container.add(makeItem('ammo_9mm', 12));
        const at = st.collider.translation();
        const sx = at.x + u.x * 1.5 + v.x * 0.4, sz = at.z + u.z * 1.5 + v.z * 0.4;
        S.me(sx, sz, yawTo(sx, sz, at.x, at.z), -0.6);
        S.hold('primary');
        await preroll(20);
        S.aimAt(new THREE.Vector3(at.x, at.y + 0.1, at.z));
        // the way out afterwards: wherever there is most room to run
        let best = -1;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const hit = physics.raycast(P(sx, sz, 1.1), { x: -Math.sin(a), y: 0, z: -Math.cos(a) }, 90);
          const room = (hit ? hit.toi : 90) + Math.cos(a - yawTo(sx, sz, c.x, c.z)) * 10;
          if (room > best) {
            best = room;
            walkYaw = a;
          }
        }
      },
      cues: [
        { at: 0.2, fn: () => S.tap('KeyF') },
        {
          at: 1.45,
          fn: () => {
            const el = document.querySelector('.inv-vicinity .inv-item.cat-misc') ?? document.querySelector('.inv-item.cat-misc');
            el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          },
        },
        { at: 2.25, fn: () => g.invUI.isOpen && g.toggleInventory(false) },
      ],
      after: (t) => cursor(t, 0.7, 1.45, '.inv-vicinity .inv-item.cat-misc'),
      titles: [title('TAKE THEIR TAG', 0.2, 2.6, 'top')],
    });
    add(18.5, 1.5, {
      name: 'marked',
      chain: true,
      hud: true,
      setup: () => {
        hideCursor();
        if (g.invUI.isOpen) g.toggleInventory(false);
        if (!g.inv.find((i: any) => i.id === 'dogtag' && i.pid === 'trailer-other') && tag) {
          g.inv.add(tag);
          g.inventoryChanged();
        }
        g.player.yaw = walkYaw;
        g.player.pitch = -0.05;
        document.body.classList.add('tr-map-big');
      },
      tick: (t) => {
        const p = g.player;
        S.key('KeyW', true);
        S.key('ShiftLeft', true);
        p.yaw = walkYaw + 0.1 * Math.sin(t * 0.9);
        p.vitals.stamina = 300;
        const it = g.inv.find((i: any) => i.id === 'dogtag' && i.pid === 'trailer-other');
        if (it) {
          // the tag's own clock, run fast: a third of the half hour goes by in these two bars
          it.held = Math.max(it.held ?? 0, lerp(2, TAG_HOLD * 0.36, ease(t / b(1.5))));
          g.tickTags(0);
        }
      },
      cues: [
        {
          at: 0.4,
          fn: () => {
            const p = g.player.pos;
            g.minimap.ping([{ x: p.x, z: p.z }], true);
            g.hud.note('You carry a tag you took: every 30 seconds the map shows everyone where you are', 'warn');
          },
        },
        { at: 1.9, fn: () => g.minimap.ping([{ x: g.player.pos.x, z: g.player.pos.z }], true) },
      ],
      titles: [title('NOW THE MAP GIVES YOU AWAY', 0.55, 2.6)],
    });
  }

  // ============================================================ 6. hunted (bars 20-26)
  {
    const hunters = () => [cast()[2], cast()[3], cast()[4]];
    const lanes = [-1.6, 0.2, 1.9];
    add(20, 1.5, {
      name: 'hunters',
      setup: () => {
        hideAll();
        S.parkMe();
        scrub();
        shutAll();
        hunters().forEach((a, i) => {
          const at = local(cabin, lanes[i], CHD + 21 + i * 2.2);
          a.place(at.x, at.z, yawTo(at.x, at.z, cabin.x, cabin.z), i === 1 ? 'p38' : 'mosin', [['boonie_hat'], ['life_vest'], ['sack_pack']][i]);
        });
      },
      tick: (_t, _S, dt) => hunters().forEach((a, i) => {
        const to = local(cabin, lanes[i] * 0.6, CHD + 5.5 + i * 1.4);
        a.go(to.x, to.z, 5.2, dt);
      }),
      // low by a trunk as they come past, then round after them to the cabin they are making for
      cam: (t) => {
        const k = ease(t / b(1.5));
        const p = outside(cabin, 3.6, CHD + 13.5, 0.7);
        const lead = hunters()[0].pos;
        const l = mix(lead.clone().setY(lead.y + 1.2), outside(cabin, 0, CHD - 0.5, 1.4), ease((t - 1.5) / 1.2));
        return { p, l, fov: lerp(42, 36, k) };
      },
      titles: [title('THEY ARE COMING', 0.25, 2.5)],
    });
    const cdoor = () => doorsOf(cabin)[0];
    const H = () => [cast()[2], cast()[3]];
    const heroAt: [number, number] = [-1.05, -1.55];
    let cashed = false;
    const heldAt = (T: number) => lerp(TAG_HOLD - 17, TAG_HOLD - 2.5, clamp(T / b(2.5), 0, 1));
    add(21.5, 2.5, {
      name: 'stand',
      hud: true,
      setup: () => {
        hideAll();
        scrub();
        shutAll();
        cashed = false;
        rain(false);
        showBoard(6, 0);
        const tag = makeItem('dogtag') as any;
        tag.owner = 'Kestrel';
        tag.pid = 'trailer-other';
        // the rifle from the station: a pistol is a black shape against a dark wall, and this is a shot to be seen
        S.kit(['mosin', ['ammo_762', 10], 'bandage']);
        g.inv.add(tag);
        g.inventoryChanged();
        S.hold('primary');
        const at = inside(cabin, heroAt[0], heroAt[1]), to = inside(cabin, 0, CHD);
        S.me(at.x, at.z, yawTo(at.x, at.z, to.x, to.z), -0.02, cabin.floorY + 0.02);
        g.tickTags(0);
        hush();
        // the cabin has one small window: a lamp by the back wall, so the hands and the pistol can be seen
        lampOn(inside(cabin, -0.6, -1.9, 2.1));
        H().forEach((a, i) => {
          const o = local(cabin, [0.1, 0.5][i], CHD + [1.6, 3.4][i]);
          a.place(o.x, o.z, yawTo(o.x, o.z, cabin.x, cabin.z), i ? 'mosin' : 'p38', [['boonie_hat'], ['sack_pack']][i]);
          a.pos.y = cabin.floorY - 0.08;
          // one rifle round each, wherever it lands
          delete (a as any).hurt;
          tough(a, 1);
          a.onDeath = () => {
            S.feedKill(HERO, a.name, 'Mosin 91/30', 4);
            showBoard(score.kills + 1, 0);
          };
        });
      },
      tick: (t, _S, dt) => {
        const p = g.player, [h1, h2] = H();
        const it = g.inv.find((i: any) => i.id === 'dogtag' && i.pid === 'trailer-other');
        if (it && !cashed) {
          it.held = Math.max(it.held ?? 0, heldAt(t));
          g.tickTags(0);
        }
        lampAim();
        // the first one through the door, then the one behind him
        if (h1.alive && t > 0.75) {
          const to = local(cabin, 0.05, CHD - 1.3);
          h1.go(to.x, to.z, 3.4, dt);
          h1.pos.y = cabin.floorY;
          h1.aim = true;
        }
        if (h2.alive && t > 2.3) {
          const to = local(cabin, 0.35, CHD - 0.5);
          h2.go(to.x, to.z, 3.2, dt);
          h2.pos.y = cabin.floorY;
          h2.aim = true;
        }
        const who = h1.alive ? h1 : h2;
        const target = who.alive ? who.chest() : inside(cabin, 0.1, CHD - 0.4, 1.0);
        const cam = g.s.r.camera.position;
        const yaw = Math.atan2(-(target.x - cam.x), -(target.z - cam.z)), pitch = Math.atan2(target.y - cam.y, Math.hypot(target.x - cam.x, target.z - cam.z));
        p.yaw += Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw)) * 0.35;
        p.pitch += (pitch - p.pitch) * 0.35;
      },
      cues: [
        { at: 0.55, fn: () => cdoor().toggle(outside(cabin, 0, CHD + 2, 1.5)) },
        { at: 1.3, fn: () => S.tap('Mouse0', 50) },
        // the second fires as he comes: wide, into the wall by the bed
        { at: 2.75, fn: () => { if (H()[1].alive) H()[1].fireAt(inside(cabin, 0.9, -2.2, 1.5), 0); } },
        { at: 3.3, fn: () => S.tap('Mouse0', 50) },
      ],
      titles: [title('HOLD THE DOOR', 0.3, 2.2, 'top'), { at: 2.5, until: 4.4, text: 'UNTIL THE CLOCK RUNS OUT', cls: 'top' }],
    });
    add(24, 2, {
      name: 'cash',
      chain: true,
      hud: true,
      setup: () => {
        rain(false);
      },
      tick: (t) => {
        const p = g.player;
        lampAim();
        S.key('KeyW', t > 1.1 && t < 2.6);
        const out = inside(cabin, 0.0, CHD + 3, 1.7), cam = g.s.r.camera.position;
        const yaw = Math.atan2(-(out.x - cam.x), -(out.z - cam.z));
        p.yaw += Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw)) * 0.06;
        p.pitch += (0.06 - p.pitch) * 0.05;
        const it = g.inv.find((i: any) => i.id === 'dogtag' && i.pid === 'trailer-other');
        if (it && !cashed) {
          it.held = Math.max(it.held ?? 0, lerp(TAG_HOLD - 2.5, TAG_HOLD - 0.4, t / 0.45));
          g.tickTags(0);
        }
      },
      cues: [{
        at: 0.45,
        fn: () => {
          const it = g.inv.find((i: any) => i.id === 'dogtag' && i.pid === 'trailer-other');
          if (it) it.held = TAG_HOLD;
          cashed = true;
          g.tickTags(0);
          g.hud.feed(`${HERO} cashed in Kestrel's dog tag.`, true);
          showBoard(Math.max(score.kills, 8), 1);
          rain(true, () => S.rnd());
        },
      }],
      after: (t) => rainTick(t - 0.45),
      titles: [{ at: 0.65, until: 2.5, text: 'CASHED IN', cls: 'big gold' }, { at: 2.55, until: 3.65, text: 'TOP OF THE BOARD', cls: 'big' }, { at: 0.45, until: b(2), text: 'in development', cls: 'dev' }],
    });
  }

  // ============================================================ 7. what it is (bars 26-28)
  add(26, 1, {
    name: 'stat-0',
    setup: () => {
      hideAll();
      rain(false);
      S.parkMe();
      scrub();
      shutAll();
    },
    // low over the treetops, fast, at the village
    cam: (t) => {
      const k = t / b(1);
      const a = 3.9;
      const r = lerp(250, 185, k);
      const p = P(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0);
      p.y = S.ground(c.x, c.z) + lerp(52, 44, k);
      return { p, l: P(c.x, c.z, 4), fov: 50 };
    },
    titles: [{ at: 0.12, until: b(1) - 0.08, text: '<b>1 KM²</b> · <b>52</b> BUILDINGS · <b>14</b> PLACES TO LOOT', cls: 'stat' }],
  });
  add(27, 1, {
    name: 'stat-1',
    // a server holds twenty-four; the rest wait their turn at the door
    setup: () => {
      hideAll();
      S.parkMe();
      scrub();
      shutAll();
      cast().forEach((a, i) => {
        const at = local(station, 0.15 + 0.12 * Math.sin(i * 2.1), SHD + 1.5 + i * 1.05);
        a.place(at.x, at.z, yawTo(at.x, at.z, local(station, 0, SHD).x, local(station, 0, SHD).z) + 0.12 * Math.sin(i * 1.7), [null, 'mosin', null, 'p38', null, 'mosin'][i], [['boonie_hat'], ['sack_pack'], ['life_vest'], [], ['suitcase'], ['boonie_hat', 'life_vest']][i]);
      });
    },
    cam: (t) => {
      const k = ease(t / b(1));
      const p = outside(station, lerp(3.8, 3.1, k), SHD + lerp(9.4, 4.4, k), 1.4);
      return { p, l: outside(station, 0.1, SHD + lerp(5.2, 2.4, k), 1.25), fov: 42 };
    },
    titles: [{ at: 0.12, until: b(1) - 0.08, text: '<b>24</b> TO A SERVER · A LINE WHEN IT IS FULL', cls: 'stat' }],
  });

  // ============================================================ 8. what is new (bars 28-30)
  {
    const lines = ['SUPPLY DROPS', 'GRENADES', 'A LEADERBOARD', 'TAG CARRIERS MARKED ON THE MAP', 'FISTS', 'WEAPONS BACK IN 3 MINUTES', 'DOORS YOU CAN RUN THROUGH', 'FIRST PERSON ONLY'];
    const each = (b(2) - 0.5) / lines.length;
    add(28, 2, {
      name: 'new',
      setup: () => {
        hideAll();
        S.parkMe();
        scrub();
        shutAll();
      },
      // down the village street, a little above head height
      cam: (t) => {
        const k = lerp(0.72, 0.3, t / b(2));
        const at = roadAt(k), look = roadAt(k - 0.1);
        return { p: at.setY(at.y + 3.1), l: look.setY(look.y + 1.9), fov: 56 };
      },
      titles: [{ at: 0.05, until: b(2) - 0.05, text: 'NEW IN THIS UPDATE', cls: 'head' }, ...lines.map((text, i) => ({ at: 0.2 + i * each, until: b(2) - 0.05, text, cls: `li li-${i}` }))],
    });
  }

  // ============================================================ 9. what is coming (bars 30-34)
  {
    const pit = outside(cabin, -1.5, CHD + 3.2, 0);
    const dancers = () => cast().slice(0, 5);
    add(30, 1.5, {
      name: 'soon-dance',
      setup: () => {
        hideAll();
        S.parkMe();
        scrub();
        shutAll();
        dancers().forEach((a, i) => {
          const ang = (i / 5) * Math.PI * 2 + 0.3;
          const x = pit.x + Math.cos(ang) * 2.15, z = pit.z + Math.sin(ang) * 2.15;
          a.place(x, z, yawTo(x, z, pit.x, pit.z), null, [['boonie_hat'], ['life_vest'], [], ['sack_pack'], ['boonie_hat', 'life_vest']][i]);
          a.emote('dance', { phase: i * 0.23, speed: 1 + (i % 2) * 0.06 });
        });
      },
      cam: orbit(pit.clone().setY(pit.y + 1.0), 6.4, 5.0, 0.6, 1.9, 0.5, 0.2, 40, b(1.5)),
      titles: [{ at: 0, until: b(1.5), text: 'COMING SOON', cls: 'soonbar' }, { at: 0.15, until: b(1.5) - 0.08, text: 'EMOTES &amp; DANCES', cls: 'soon' }],
    });
    // a meeting on the road, and a way to say something without a microphone
    const here = roadAt(0.5), there = roadAt(0.42);
    const dir = there.clone().sub(here).setY(0).normalize(), right = new THREE.Vector3(-dir.z, 0, dir.x);
    const spot = (along: number, across: number) => ({ x: here.x + dir.x * along + right.x * across, z: here.z + dir.z * along + right.z * across });
    // [who, where along and across the road, facing the others?, what is said, when, the movement that goes with it]
    const lines: { a: number; at: [number, number]; text: string; t: number; move: string; crouch?: boolean }[] = [
      { a: 0, at: [0, -0.8], text: 'HEY!', t: 0.15, move: 'hail' },
      { a: 1, at: [9.5, 0.7], text: 'FRIENDLY!', t: 1.0, move: 'talk' },
      { a: 2, at: [0.9, 1.0], text: 'OVER HERE!', t: 1.9, move: 'point' },
      { a: 3, at: [5.2, -3.4], text: 'HELP!', t: 2.8, move: '', crouch: true },
      { a: 4, at: [10.4, -0.9], text: 'ON MY WAY!', t: 3.65, move: 'talk' },
    ];
    add(31.5, 2.5, {
      name: 'soon-chat',
      setup: () => {
        hideAll();
        S.parkMe();
        scrub();
        shutAll();
        sayClear();
        lines.forEach((ln, i) => {
          const o = spot(ln.at[0], ln.at[1]);
          const face = ln.at[0] < 4 ? spot(10, 0) : spot(0, 0);
          const a = cast()[ln.a].place(o.x, o.z, yawTo(o.x, o.z, face.x, face.z), null, [['boonie_hat'], ['life_vest'], ['sack_pack'], [], ['suitcase']][i]);
          a.crouch = !!ln.crouch;
          a.bleeding = !!ln.crouch;
        });
      },
      cues: lines.map((ln) => ({
        at: ln.t,
        fn: () => {
          if (ln.move) cast()[ln.a].emote(ln.move, { loop: ln.move !== 'point', speed: ln.move === 'point' ? 0.9 : 1 });
          audio.ui('open');
        },
      })),
      // each one who speaks gets the camera
      cam: (t) => {
        let cur = lines[0];
        for (const ln of lines) if (t >= ln.t - 0.12) cur = ln;
        const a = cast()[cur.a];
        const head = a.head();
        const toward = cur.at[0] < 4 ? 1 : -1;
        const k = clamp((t - cur.t + 0.12) / 0.9, 0, 1);
        const p = head.clone().addScaledVector(dir, toward * lerp(3.3, 2.9, k)).addScaledVector(right, (cur.a % 2 ? 1 : -1) * 1.15);
        p.y = Math.max(S.ground(p.x, p.z) + 0.4, head.y - 0.25);
        return { p, l: head.clone().setY(head.y - 0.08), fov: 36 };
      },
      after: (t) => {
        for (const ln of lines) say(cast()[ln.a], ln.text, t - ln.t, t >= ln.t && t < ln.t + 0.86);
      },
      titles: [{ at: 0, until: b(2.5), text: 'COMING SOON', cls: 'soonbar' }, { at: 0.15, until: b(2.5) - 0.08, text: 'QUICK CHAT', cls: 'soon' }],
    });
  }

  // ============================================================ 10. everything at once (bars 34-38)
  {
    const places = [...others, ...open];
    const kinds = ['shot', 'punch', 'nade', 'shot', 'punch', 'shot', 'nade', 'last'] as const;
    kinds.forEach((kind, k) => {
      const at = places[(k * 2 + 1) % places.length];
      const ang = k * 1.37 + 0.6, sep = kind === 'punch' ? 1.2 : kind === 'last' ? 9 : 10 + (k % 3) * 3;
      const sx = at.x + Math.cos(ang) * sep, sz = at.z + Math.sin(ang) * sep;
      const one = () => cast()[k % 2 ? 2 : 0], two = () => cast()[k % 2 ? 3 : 1], three = () => cast()[k % 2 ? 4 : 5];
      const gear = [['boonie_hat'], ['life_vest'], ['sack_pack'], [], ['suitcase', 'boonie_hat']];
      const lastCut = kind === 'last';
      add(34 + k * 0.5, 0.5, {
        name: `finale-${k}`,
        setup: async () => {
          sayClear();
          hideAll();
          S.parkMe();
          scrub();
          const face = yawTo(at.x, at.z, sx, sz);
          if (kind === 'punch') {
            two().place(at.x, at.z, face, null, gear[k % 5]);
            two().hp = 20;
            one().place(sx, sz, yawTo(sx, sz, at.x, at.z), null, gear[(k + 2) % 5]);
          } else if (kind === 'nade') {
            // two with their backs to it, a third coming over
            two().place(at.x - 0.9, at.z + 0.3, face + 2.6, 'p38', gear[k % 5]);
            three().place(at.x + 0.8, at.z - 0.6, face + 3.4, 'mosin', gear[(k + 1) % 5]);
            one().place(at.x + 0.2, at.z + 1.5, face + 1.2, null, gear[(k + 3) % 5]);
            for (const a of [one(), two(), three()]) a.hp = 55;
          } else {
            two().place(at.x, at.z, face + [0, Math.PI, 0.5, 0, 0, Math.PI / 2, 0, Math.PI][k], k % 3 === 0 ? 'p38' : 'mosin', gear[k % 5]);
            two().hp = 40;
            two().aim = k % 2 === 0;
            one().place(sx, sz, yawTo(sx, sz, at.x, at.z), 'mosin', gear[(k + 2) % 5]);
            one().aim = true;
          }
        },
        cues: kind === 'punch'
          ? [
              { at: 0.12, fn: () => one().rp.swing() },
              { at: 0.34, fn: () => two().hurt(60, new THREE.Vector3(at.x - sx, 0, at.z - sz).normalize()) },
            ]
          : kind === 'nade'
            ? [{ at: 0.02, fn: () => g.grenades.throw(P(at.x + Math.cos(ang) * 5, at.z + Math.sin(ang) * 5, 1.4), new THREE.Vector3(-Math.cos(ang) * 6.5, 1.6, -Math.sin(ang) * 6.5), 0.52, true) }]
            : [{ at: lastCut ? 0.16 : 0.24, fn: () => one().fireAt(lastCut ? two().head() : two().chest(), 0) }],
        // the last one is the one you remember: slow, close, to the head
        rate: lastCut ? (t) => (t < 0.14 ? 1 : 0.22) : undefined,
        cam: lastCut
          ? (t) => ({ p: P(at.x + Math.cos(ang + 1.3) * 3.1, at.z + Math.sin(ang + 1.3) * 3.1, 1.5), l: P(at.x, at.z, 1.35 - t * 0.5), fov: 30 })
          : kind === 'punch'
            ? orbit(P((at.x + sx) / 2, (at.z + sz) / 2, 1.25), 3.6, 3.1, ang + 1.3, ang + 1.75, 0.15, 0.05, 40, b(0.5))
            : kind === 'nade'
              ? orbit(P(at.x, at.z, 0.9), 7.5, 6.6, ang + 2.2, ang + 2.5, 0.5, 0.3, 42, b(0.5))
              : [
                  orbit(P(at.x, at.z, 1.1), 6.5, 5.5, ang + 1.2, ang + 1.6, 0.2, 0.2, 38, b(0.5)),
                  (t: number): CamPose => ({ p: P(sx - Math.cos(ang) * 1.6 + Math.sin(ang) * 0.9, sz - Math.sin(ang) * 1.6 - Math.cos(ang) * 0.9, 1.75), l: P(at.x, at.z, 1.1 - t * 0.3), fov: 30 }),
                  orbit(P(at.x, at.z, 0.9), 4.6, 4.2, ang - 1.4, ang - 1.1, -0.3, -0.3, 44, b(0.5)),
                ][k % 3],
      });
    });
  }

  // ============================================================ 11. the name and where to find it (bars 38-40)
  add(38, 2, {
    name: 'end',
    setup: async () => {
      hideAll();
      S.parkMe();
      scrub();
      await ensureDrop();
    },
    // the smoke still standing over the field, the village behind it
    cam: (t) => {
      const a = Math.atan2(dropAt.z - c.z, dropAt.x - c.x) + 0.35 + t * 0.03;
      const r = Math.hypot(dropAt.x - c.x, dropAt.z - c.z) + 70;
      return { p: P(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0).setY(S.ground(c.x, c.z) + 34), l: P(lerp(dropAt.x, c.x, 0.5), lerp(dropAt.z, c.z, 0.5), 9), fov: 50 };
    },
    bars: false,
    titles: [{ at: 0, until: b(2) + 1, text: '<div class="end-logo">ZONA</div><div class="end-line">THE UPDATE IS LIVE · PLAY IN YOUR BROWSER</div><div class="end-url">WWW.ZONAPVP.FUN</div>', cls: 'end' }],
  });

  shots.sort((x, y) => x.start - y.start);
  return shots;
}

// ------------------------------------------------------------------------------------------ overlay pieces

const overlay = () => document.getElementById('tr-overlay')!;
let cursorEl: HTMLElement | null = null;
const cursorAt = (x: number, y: number, down = false) => {
  if (!cursorEl) {
    cursorEl = document.createElement('div');
    cursorEl.className = 'tr-cursor';
    overlay().appendChild(cursorEl);
  }
  cursorEl.style.display = '';
  cursorEl.style.left = `${x}px`;
  cursorEl.style.top = `${y}px`;
  cursorEl.classList.toggle('down', down);
};
/** the mouse pointer, gliding to whatever matches `selector` between two moments */
function cursor(t: number, from: number, to: number, selector: string) {
  if (t < from - 0.3 || t > to + 0.6) return hideCursor();
  const el = document.querySelector(selector) ?? document.querySelector('.inv-item.cat-misc');
  const r = el?.getBoundingClientRect();
  const k = ease((t - from) / (to - from));
  const tx = r ? r.left + r.width * 0.55 : innerWidth * 0.3, ty = r ? r.top + r.height * 0.55 : innerHeight * 0.5;
  cursorAt(lerp(innerWidth * 0.52, tx, k), lerp(innerHeight * 0.7, ty, k), t > to - 0.03 && t < to + 0.12);
}
function hideCursor() {
  if (cursorEl) cursorEl.style.display = 'none';
}

/** 0 not begun, 1 the button is down and the thing is being carried, 2 let go */
let dragState = 0;
let dragFrom = { x: 0, y: 0 };
function dragReset() {
  dragState = 0;
}
/**
 * The player's own drag: the pointer goes down on the first thing matching `selector`, carries
 * it to the middle of `target` and lets go. These are the events a mouse would send, so the
 * inventory answers as it does in the game: the places it can go light up, and it lands.
 */
function dragItem(t: number, from: number, to: number, selector: string, target: string) {
  const ev = (type: string, x: number, y: number, el: Element | Window) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, pointerId: 1, isPrimary: true }));
  const el = document.querySelector(selector), tg = document.querySelector(target)?.getBoundingClientRect();
  if (t < from) {
    const r = el?.getBoundingClientRect();
    if (r && t > from - 0.4) {
      const k = ease((t - (from - 0.4)) / 0.4);
      cursorAt(lerp(innerWidth * 0.55, r.left + r.width / 2, k), lerp(innerHeight * 0.75, r.top + r.height / 2, k));
    }
    return;
  }
  if (dragState === 0) {
    const r = el?.getBoundingClientRect();
    if (!el || !r) return;
    dragFrom = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    ev('pointerdown', dragFrom.x, dragFrom.y, el);
    dragState = 1;
  }
  if (!tg) return;
  const k = ease((t - from) / (to - from));
  const x = lerp(dragFrom.x, tg.left + tg.width / 2, k), y = lerp(dragFrom.y, tg.top + tg.height * 0.45, k);
  if (dragState === 1) {
    if (t < to) ev('pointermove', x, y, window);
    else {
      ev('pointermove', x, y, window);
      ev('pointerup', x, y, window);
      dragState = 2;
    }
  }
  cursorAt(x, y, dragState === 1);
}

interface Drop { el: HTMLElement; x: number; delay: number; speed: number; spin: number; size: number }
let drops: Drop[] = [];
/** money bags and notes, coming down: what cashing a tag in is going to mean */
function rain(on: boolean, rnd: () => number = Math.random) {
  for (const d of drops) d.el.remove();
  drops = [];
  if (!on) return;
  for (let i = 0; i < 96; i++) {
    const el = document.createElement('div');
    el.className = 'tr-money';
    el.textContent = i % 3 === 0 ? '\u{1F4B0}' : '\u{1F4B5}';
    overlay().appendChild(el);
    drops.push({ el, x: rnd(), delay: rnd() * 2.3, speed: 0.55 + rnd() * 0.5, spin: (rnd() - 0.5) * 3, size: 34 + rnd() * 46 });
  }
}
function rainTick(t: number) {
  for (const d of drops) {
    const k = (t - d.delay) * d.speed;
    d.el.style.display = k < 0 ? 'none' : '';
    d.el.style.fontSize = `${d.size}px`;
    d.el.style.left = `${d.x * 100}%`;
    d.el.style.top = `${-12 + k * 125}%`;
    d.el.style.transform = `translate(-50%, 0) rotate(${k * d.spin}rad)`;
  }
}

const bubbles = new Map<string, HTMLElement>();
function sayClear() {
  for (const el of bubbles.values()) el.remove();
  bubbles.clear();
}
/** what somebody calls out, over their head (a thing the game does not do yet) */
function say(a: Actor, text: string, t: number, on: boolean) {
  let el = bubbles.get(text);
  if (!on) {
    if (el) el.style.display = 'none';
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'tr-say';
    el.textContent = text;
    overlay().appendChild(el);
    bubbles.set(text, el);
  }
  const cam = (window as any).__game.s.r.camera as THREE.PerspectiveCamera;
  const at = a.head().setY(a.head().y + 0.36).project(cam);
  el.style.display = at.z > 1 ? 'none' : '';
  el.style.left = `${(at.x * 0.5 + 0.5) * 100}%`;
  el.style.top = `${(-at.y * 0.5 + 0.5) * 100}%`;
  // popped in, a little overshoot, held
  const k = Math.min(1, t / 0.12);
  el.style.setProperty('--k', String(k < 1 ? 0.4 + k * 0.75 : 1.15 - Math.min(0.15, (t - 0.12) * 1.2)));
}
