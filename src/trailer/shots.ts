// The trailer, shot by shot. Times are on the music's grid: 128 beats a minute, so a bar is
// 1.875 s and forty bars are exactly 75 s. Every cut is on a bar line (or a half or a quarter).
//
// Each shot sets the game up, then lets it run: the people in it are the game's own player
// bodies with a small brain (face the enemy, shoot when the weapon allows, miss sometimes),
// their bullets are real bullets in the game's world, and whoever is hit bleeds and falls
// the way the game makes them. The first-person shots are the local player with the keys
// pressed for them.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import { makeItem, TAG_HOLD } from '../sim/items';
import { physics, USE_GROUPS } from '../core/physics';

export const BPM = 128;
export const BAR = (60 / BPM) * 4;
export const BARS = 40;
export const SECONDS = BARS * BAR;

const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
const yawTo = (ax: number, az: number, bx: number, bz: number) => Math.atan2(-(bx - ax), -(bz - az));

export function buildShots(S: Stage): Shot[] {
  const g = S.g, world = S.world;
  const c = world.pois[0] as { x: number; z: number };
  const P = (x: number, z: number, up = 0) => S.at(x, z, up);

  // ------------------------------------------------------------ finding places to film
  const near = (list: { x: number; z: number }[], x: number, z: number, r: number) => list.some((o) => Math.hypot(o.x - x, o.z - z) < r);
  const bushes = (world.trees as { kind: string; x: number; z: number }[]).filter((t) => t.kind.startsWith('bush'));
  const trunks = (world.trees as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush'));
  const flat = (x: number, z: number, r: number) => {
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k < 8; k++) {
      const h = S.ground(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return hi - lo;
  };
  /** open, level ground: nothing built within 16 m, no tree within 9 */
  const open: { x: number; z: number }[] = [];
  for (let r = 50; r <= 230; r += 12) {
    for (let a = 0; a < Math.PI * 2; a += 0.22) {
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (near(world.buildings, x, z, 17) || near(trunks, x, z, 9) || near(world.props ?? [], x, z, 4) || near(world.rocks ?? [], x, z, 5)) continue;
      if (flat(x, z, 7) > 0.9 || near(open, x, z, 40)) continue;
      open.push({ x, z });
    }
  }
  /** a place to fight, and a bush about a hundred metres off with a clear line to it */
  let duel = open[0], nest = { x: open[0].x + 90, z: open[0].z };
  search: for (const d of open) {
    for (const b of bushes) {
      const dist = Math.hypot(b.x - d.x, b.z - d.z);
      if (dist < 85 || dist > 118) continue;
      const ux = (d.x - b.x) / dist, uz = (d.z - b.z) / dist;
      const sx = b.x + ux * 1.3, sz = b.z + uz * 1.3;
      if (near(trunks, sx, sz, 1.2)) continue;
      const eye = P(sx, sz, 1.02);
      // the two of them fight strung across his view: every place they can be has to be in it
      const px = -uz, pz = ux;
      if (near(world.buildings, d.x, d.z, 24)) continue;
      if (![-9, -6.5, -4, 0, 4, 6.5, 9].every((k) => [-3, 0, 3].every((j) => S.clearLine(eye, P(d.x + px * k + ux * j, d.z + pz * k + uz * j, 1.25)) && S.clearLine(eye, P(d.x + px * k + ux * j, d.z + pz * k + uz * j, 0.75))))) continue;
      duel = d;
      nest = { x: sx, z: sz };
      break search;
    }
  }
  const others = open.filter((o) => Math.hypot(o.x - duel.x, o.z - duel.z) > 45);
  console.log(`[tr] ${open.length} open places; duel at ${duel.x.toFixed(0)},${duel.z.toFixed(0)}; nest ${Math.hypot(nest.x - duel.x, nest.z - duel.z).toFixed(0)} m away`);

  // the road through the village, for moving shots
  const road: THREE.Vector3[] = [];
  {
    const pts = world.road.points as Float32Array;
    for (let i = 0; i < pts.length; i += 3) if (Math.hypot(pts[i] - c.x, pts[i + 2] - c.z) < 130) road.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
  }
  const roadAt = (k: number) => {
    const f = THREE.MathUtils.clamp(k, 0, 1) * (road.length - 1), i = Math.min(road.length - 2, Math.floor(f));
    return road[i].clone().lerp(road[i + 1], f - i);
  };

  const b = (bars: number) => bars * BAR;
  const shots: Shot[] = [];
  const add = (start: number, len: number, s: Omit<Shot, 'start' | 'end'>) => shots.push({ ...s, start: b(start), end: b(start + len) });
  const cast = () => S.actors;
  const hideAll = () => cast().forEach((a) => a.hide());
  const title = (text: string, at = 0.25, until = 1.6, cls = 'big') => ({ at, until, text, cls });
  /** a camera circling a point */
  const orbit = (mid: THREE.Vector3, r0: number, r1: number, a0: number, a1: number, h: number, fov: number, dur: number) => (t: number): CamPose => {
    const k = ease(t / dur), a = lerp(a0, a1, k), r = lerp(r0, r1, k);
    const p = new THREE.Vector3(mid.x + Math.cos(a) * r, 0, mid.z + Math.sin(a) * r);
    p.y = Math.max(S.ground(p.x, p.z) + 0.5, mid.y + h);
    return { p, l: mid, fov };
  };

  // ============================================================ 1. the world (bars 0-2)
  add(0, 2, {
    name: 'open',
    setup: () => {
      hideAll();
      S.parkMe();
      S.clean();
    },
    cam: (t) => {
      const k = ease(t / b(2));
      const to = P(c.x + 46, c.z + 78, 20), from = P(c.x + 190, c.z + 250, 0).setY(to.y + 62);
      return { p: mix(from, to, k), l: P(c.x, c.z, 5).lerp(P(c.x - 20, c.z - 30, 2), k), fov: 46 };
    },
    titles: [{ at: 0.5, until: 1.7, text: 'ZELENAYA DOLINA', cls: 'small' }, { at: 1.9, until: 3.6, text: 'ONE PERSISTENT WORLD', cls: 'big' }],
  });

  // ============================================================ 2. nothing in your hands (bars 2-4)
  {
    const sp = world.spawns[0] as { x: number; z: number; yaw: number };
    add(2, 2, {
      name: 'spawn',
      hud: true,
      setup: () => {
        hideAll();
        S.clean();
        S.kit(['sprats', 'thermos', 'bandage']);
        S.hold(null);
        S.me(sp.x, sp.z, sp.yaw + 0.5, -0.1);
      },
      tick: (t) => {
        const p = g.player;
        // a look round, then off toward the nearest roof
        p.yaw = sp.yaw + 0.5 * (1 - ease(t / 1.5)) + 0.05 * Math.sin(t * 1.4);
        p.pitch = -0.1 + 0.08 * ease(t / 1.2) + 0.015 * Math.sin(t * 2.3);
        S.key('KeyW', t > 1.1);
        S.key('ShiftLeft', t > 2.4);
      },
      titles: [title('YOU START WITH NOTHING', 0.5, 3.2)],
    });
  }

  // ============================================================ 3. looting, four cuts (bars 4-8)
  /** stand `dist` in front of something indoors or out, and look at it */
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
  /** one of these lying somewhere the player's reach really lands on it: where to stand, and whether to kneel */
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
      // on a table at a good height first, then anything else that works
      tries.push({ l, px, pz, fy, kneel, score: (up > 0.4 ? 0 : 5) + Math.hypot(l.x - c.x, l.z - c.z) / 100 });
    }
    tries.sort((x, y) => x.score - y.score);
    return tries[0];
  };
  const takeShot = (name: string, id: string, pressAt: number, after: ((S: Stage) => void) | null, titles: Shot['titles']): Omit<Shot, 'start' | 'end'> => {
    let at = new THREE.Vector3();
    return {
      name,
      hud: true,
      setup: () => {
        const pick = lootOf(id);
        if (!pick) throw new Error(`no ${id} lying in the world where it can be filmed`);
        const { l, px, pz, fy } = pick;
        S.me(px, pz, yawTo(px, pz, l.x, l.z) + 0.5, -0.1, fy);
        // on the floor: down on one knee for it
        if (pick.kneel) g.player.setCrouch(true);
        at = new THREE.Vector3(l.x, l.y + 0.06, l.z);
      },
      tick: (t) => {
        // the eyes find it
        const p = g.player, cam = g.s.r.camera.position;
        const yaw = Math.atan2(-(at.x - cam.x), -(at.z - cam.z)), pitch = Math.atan2(at.y - cam.y, Math.hypot(at.x - cam.x, at.z - cam.z));
        const k = ease(t / 0.55);
        p.yaw = yaw + 0.5 * (1 - k);
        p.pitch = lerp(-0.1, pitch, k);
      },
      cues: [{ at: pressAt, fn: () => S.tap('KeyF') }, ...(after ? [{ at: pressAt + 0.25, fn: after }] : [])],
      titles,
    };
  };
  {
    // a door: the nearest shut one in the village, from outside
    const doors = g.s.buildings.doors as { pivot: THREE.Object3D; open: boolean; setOpen(o: boolean): void }[];
    let out = new THREE.Vector3(), mid = new THREE.Vector3();
    let bd = 1e9;
    for (const d of doors) {
      const q = d.pivot.quaternion, centre = new THREE.Vector3(0.45, 1, 0).applyQuaternion(q).add(d.pivot.position);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      for (const sgn of [1, -1]) {
        const o = centre.clone().addScaledVector(n, 2.4 * sgn);
        const roofed = physics.raycast({ x: o.x, y: o.y + 0.5, z: o.z }, { x: 0, y: 1, z: 0 }, 12);
        const dist = Math.hypot(centre.x - c.x, centre.z - c.z);
        if (!roofed && dist < bd && dist > 12) {
          bd = dist;
          out = o;
          mid = centre;
        }
      }
    }
    add(4, 1, {
      name: 'loot-door',
      hud: true,
      setup: () => {
        hideAll();
        S.clean();
        for (const d of doors) d.setOpen(false);
        S.kit(['sprats', 'thermos', 'bandage']);
        S.hold(null);
        S.me(out.x, out.z, yawTo(out.x, out.z, mid.x, mid.z), -0.05, S.ground(out.x, out.z));
      },
      cues: [{ at: 0.3, fn: () => S.tap('KeyF') }],
      tick: (t) => S.key('KeyW', t > 0.6),
      titles: [title('LOOT', 0.15, 1.7)],
    });
  }
  add(5, 1, takeShot('loot-pistol', 'p38', 0.85, null, []));
  add(6, 1, {
    name: 'loot-pockets',
    chain: true,
    hud: true,
    // straight on from the last cut: the pistol is in the pockets now, and Tab opens them
    setup: () => {
      if (!g.inv.find((i: any) => i.id === 'p38')) g.inv.add(makeItem('p38'));
      if (!g.inv.find((i: any) => i.id === 'ammo_9mm')) g.inv.add(makeItem('ammo_9mm', 16));
      g.inventoryChanged();
    },
    cues: [{ at: 0.2, fn: () => S.tap('Tab') }],
    after: (t) => cursor(t, 0.5, 1.4, '.inv-cargo .inv-item, .inv-gear .inv-item.in-slot'),
    titles: [title('ARM UP', 0.15, 1.7, 'top')],
  });
  add(7, 1, { ...takeShot('loot-rifle', 'mosin', 0.6, () => S.hold('primary', true), []), name: 'loot-rifle' });

  // ============================================================ 4. the weapons (bars 8-10)
  {
    const guns: [string, string][] = [['mosin', 'MOSIN 91/30'], ['p38', 'P38'], ['hatchet', 'HATCHET'], ['machete', 'MACHETE'], ['crowbar', 'CROWBAR'], ['bat', 'BASEBALL BAT'], ['knife', 'FISH KNIFE']];
    const each = b(2) / guns.length;
    const here = roadAt(0.45), ahead = roadAt(0.6);
    add(8, 2, {
      name: 'weapons',
      setup: () => {
        hideAll();
        S.clean();
        S.me(here.x, here.z, yawTo(here.x, here.z, ahead.x, ahead.z), -0.02);
        S.kit(['mosin', 'p38', ['ammo_762', 20], ['ammo_9mm', 30]]);
      },
      cues: guns.flatMap(([id], i) => [
        {
          at: i * each,
          fn: () => {
            if (i >= 2) {
              // one melee weapon at a time has a place on the belt
              if (g.inv.slots.melee) g.inv.remove(g.inv.slots.melee);
              g.inv.add(makeItem(id));
            }
            S.hold(i === 0 ? 'primary' : i === 1 ? 'holster' : 'melee');
            g.weapons.start('equip', 0.2);
          },
        },
        { at: i * each + 0.26, fn: () => S.tap('Mouse0', 60) },
        ...(i === 1 ? [{ at: i * each + 0.4, fn: () => S.tap('Mouse0', 60) }] : []),
      ]),
      titles: [{ at: 0.1, until: b(2) - 0.1, text: '7 WEAPONS', cls: 'top' }, ...guns.map(([, label], i) => ({ at: i * each + 0.02, until: (i + 1) * each - 0.02, text: label, cls: 'name' }))],
    });
  }

  // ============================================================ 5-8. two fight; a third is watching (bars 10-16)
  const A = () => cast()[0], B = () => cast()[1];
  const mid = P(duel.x, duel.z, 1.2);
  const axis = yawTo(duel.x, duel.z, nest.x, nest.z); // the fight is strung across the sniper's view
  const side = new THREE.Vector3(Math.cos(axis), 0, -Math.sin(axis));
  let fightT = 0;
  /** both keep moving, both keep shooting */
  const fight = (dt: number, strafe = true) => {
    fightT += dt;
    for (const [a, sgn, ph] of [[A(), -1, 0], [B(), 1, 1.9]] as [Actor, number, number][]) {
      if (!a.alive) continue;
      if (strafe) {
        const along = sgn * 6.5 + Math.sin(fightT * 0.9 + ph) * 1.2, across = Math.sin(fightT * 1.7 + ph) * 2.6;
        const tx = duel.x + side.x * along - side.z * across, tz = duel.z + side.z * along + side.x * across;
        a.go(tx, tz, 3.2, dt, false);
        a.crouch = Math.sin(fightT * 0.8 + ph * 2) > 0.75;
      }
      a.think(fightT);
    }
  };
  const startFight = () => {
    hideAll();
    S.clean();
    S.parkMe();
    fightT = 0;
    A().place(duel.x - side.x * 6.5, duel.z - side.z * 6.5, 0, 'p38', ['boonie_hat']);
    B().place(duel.x + side.x * 6.5, duel.z + side.z * 6.5, 0, 'p38', ['life_vest']);
    for (const a of [A(), B()]) {
      a.hp = 1e4; // nobody wins this one before the third player has a say
      a.skill = 0.42;
      a.nextShot = 0.25 + S.rnd() * 0.3;
    }
    A().foe = B();
    B().foe = A();
  };
  add(10, 2, {
    name: 'duel',
    setup: startFight,
    tick: (_t, _S, dt) => fight(dt),
    cam: orbit(mid, 10.5, 7.5, axis + 0.5, axis + 1.9, 0.5, 40, b(2)),
    titles: [title('HUNT', 0.2, 2.6)],
  });
  /** the local player, in the bush, with the scoped rifle */
  const settleSniper = () => {
    S.me(nest.x, nest.z, yawTo(nest.x, nest.z, A().pos.x, A().pos.z), 0);
    g.player.setCrouch(true);
    S.kit(['mosin', ['ammo_762', 10]], { mosin: ['pu_scope'] });
    S.hold('primary');
  };
  add(12, 1, {
    name: 'sniper',
    chain: true,
    setup: settleSniper,
    tick: (_t, _S, dt) => {
      fight(dt, false);
      A().go(duel.x - side.x * 6.5, duel.z - side.z * 6.5, 2.4, dt, false);
      S.key('Mouse2', true);
      S.aimAt(A().chest());
    },
    // over the rifle from behind, the fight small in the distance
    cam: (t) => {
      const eye = P(nest.x, nest.z, 1.05), away = new THREE.Vector3(nest.x - duel.x, 0, nest.z - duel.z).normalize();
      const right = new THREE.Vector3(-away.z, 0, away.x);
      const k = ease(t / b(1));
      return { p: eye.clone().addScaledVector(away, lerp(2.6, 1.7, k)).addScaledVector(right, lerp(1.1, 0.7, k)).setY(eye.y + lerp(0.5, 0.25, k)), l: mid, fov: lerp(30, 24, k) };
    },
    titles: [title('OR BE HUNTED', 0.15, 1.7)],
  });
  {
    const FIRE = 1.0, LAND = 3.05;
    let flown = 0, total = 100, hitAt = -1, last: CamPose | null = null;
    const dirOf = new THREE.Vector3();
    add(13, 2, {
      name: 'shot',
      chain: true,
      hud: true,
      setup: () => {
        flown = 0;
        hitAt = -1;
        last = null;
        // the man in the hat stops to reload: it is the last thing he does
        A().hp = 60;
        A().foe = null;
        A().aim = false;
        A().rp.avatar.act('reload', 3);
        A().onDeath = () => (hitAt = -2);
        // the other one has ducked to do the same: nobody else is going to finish this
        B().foe = null;
        B().aim = false;
        B().crouch = true;
      },
      cues: [{ at: FIRE, fn: () => S.tap('Mouse0', 60) }],
      tick: (t, _S, dt) => {
        fight(dt, false);
        S.key('Mouse2', true);
        S.key('ShiftLeft', t > 0.3);
        if (t <= FIRE + 0.05) {
          // the crosshair drifts onto him and settles
          const p = g.player, cam = g.s.r.camera.position, at = A().chest();
          const yaw = Math.atan2(-(at.x - cam.x), -(at.z - cam.z)), pitch = Math.atan2(at.y - cam.y, Math.hypot(at.x - cam.x, at.z - cam.z));
          const k = 1 - ease(t / 0.75);
          p.yaw = yaw + 0.012 * k;
          p.pitch = pitch - 0.008 * k;
        }
      },
      // the bullet's flight is stretched to two seconds; the world slows with it
      rate: (t) => {
        const bl = S.myBullet();
        if (hitAt === -2) hitAt = t;
        if (bl) {
          total = Math.max(total, bl.travelled + 1);
          const u = THREE.MathUtils.clamp((t + 1 / 60 - FIRE) / (LAND - FIRE), 0, 1);
          const want = total * (1 - Math.pow(1 - u, 1.6));
          return THREE.MathUtils.clamp((want - bl.travelled) / (bl.vel.length() / 60), 0.0006, 1);
        }
        if (hitAt >= 0) return lerp(0.1, 1, ease((t - hitAt) / 0.5));
        return 1;
      },
      cam: () => {
        const bl = S.myBullet();
        if (!bl) return hitAt >= 0 || hitAt === -2 ? last : null; // through the scope until it is fired
        if (!flown) total = bl.pos.distanceTo(A().chest());
        flown = bl.travelled;
        dirOf.copy(bl.vel).normalize();
        const right = new THREE.Vector3(-dirOf.z, 0, dirOf.x);
        S.bullet.visible = S.trail.visible = true;
        S.bullet.position.copy(bl.pos);
        S.bullet.lookAt(bl.pos.clone().add(dirOf));
        S.trail.position.copy(bl.pos);
        S.trail.lookAt(bl.pos.clone().sub(dirOf));
        S.trail.scale.set(1, 1, Math.min(9, flown));
        // riding just behind and beside it, swinging wide as it comes in
        const k = THREE.MathUtils.clamp(flown / total, 0, 1);
        last = { p: bl.pos.clone().addScaledVector(dirOf, -lerp(0.55, 1.5, k)).addScaledVector(right, lerp(0.1, 0.55, k)).add(new THREE.Vector3(0, lerp(0.05, 0.22, k), 0)), l: bl.pos.clone().addScaledVector(dirOf, 6), fov: lerp(52, 34, k) };
        return last;
      },
      after: () => {
        if (!S.myBullet()) S.bullet.visible = S.trail.visible = false;
        // the scope and its HUD belong to the eye, not to the camera that follows the bullet
        document.body.classList.toggle('tr-hud-off', !!S.cam);
      },
      bars: false,
    });
  }
  {
    const flee = new THREE.Vector3(side.x * 0.9 - side.z * 0.44, 0, side.z * 0.9 + side.x * 0.44).normalize();
    const snipe = () => {
      if (!B().alive) return;
      // where the body the game draws will be when the round gets there (it is drawn a tenth of a second behind its orders)
      const from = P(nest.x, nest.z, 1.02), to = B().rp.pos.clone().setY(B().rp.pos.y + 1.22);
      to.addScaledVector(flee, 6 * (from.distanceTo(to) / 790));
      B().hp = 50;
      g.weapons.remoteShot(from, to.sub(from).normalize(), 'mosin', false);
    };
    add(15, 1, {
      name: 'second',
      chain: true,
      setup: () => {
        S.key('Mouse2', false);
        B().foe = null;
        B().aim = false;
      },
      tick: (t, _S, dt) => {
        // he has just watched the other one drop: he looks for where it came from, and runs
        if (!B().alive) return;
        B().crouch = t < 0.3;
        if (t < 0.4) B().face(P(nest.x, nest.z, 1));
        else B().go(B().pos.x + flee.x * 10, B().pos.z + flee.z * 10, 6, dt);
      },
      cues: [{ at: 0.85, fn: snipe }, { at: 1.2, fn: snipe }],
      // alongside him, low, the village behind
      cam: (t) => {
        const at = B().chest();
        const k = ease(t / b(1));
        const p = at.clone().addScaledVector(flee, lerp(5.5, 3.5, k)).add(new THREE.Vector3(-flee.z, 0, flee.x).multiplyScalar(lerp(4.5, 5.5, k)));
        p.y = Math.max(S.ground(p.x, p.z) + 0.45, at.y - 0.45);
        return { p, l: at.clone().setY(at.y - 0.15), fov: 40 };
      },
    });
  }

  // ============================================================ 9. together (bars 16-18)
  {
    const from = roadAt(0.2), to = roadAt(0.55);
    const dir = to.clone().sub(from).setY(0).normalize(), right = new THREE.Vector3(-dir.z, 0, dir.x);
    const squad = () => [cast()[2], cast()[3], cast()[4]];
    add(16, 2, {
      name: 'team',
      setup: () => {
        hideAll();
        S.clean();
        S.parkMe();
        const yaw = Math.atan2(-dir.x, -dir.z);
        squad()[0].place(from.x, from.z, yaw, 'mosin', ['boonie_hat', 'sack_pack']);
        squad()[1].place(from.x - dir.x * 2 + right.x * 2.2, from.z - dir.z * 2 + right.z * 2.2, yaw, 'p38', ['life_vest']);
        squad()[2].place(from.x - dir.x * 3.6 - right.x * 2, from.z - dir.z * 3.6 - right.z * 2, yaw, 'mosin', ['suitcase']);
      },
      tick: (t, _S, dt) => {
        squad().forEach((a, i) => {
          const stop = t > 2.5;
          if (!stop) a.go(a.pos.x + dir.x * 5, a.pos.z + dir.z * 5, 3.4, dt);
          else {
            // something ahead: down, guns up
            a.crouch = true;
            a.aim = true;
            a.yaw = Math.atan2(-dir.x, -dir.z) + (i - 1) * 0.5;
          }
        });
      },
      cam: (t) => {
        const lead = squad()[0].pos;
        const k = ease(t / b(2));
        return { p: lead.clone().addScaledVector(dir, lerp(7.5, 5.5, k)).addScaledVector(right, lerp(-2.6, 1.8, k)).setY(lead.y + lerp(0.7, 1.3, k)), l: lead.clone().addScaledVector(dir, -1.5).setY(lead.y + 1.25), fov: 38 };
      },
      titles: [title('TEAM UP', 0.25, 3.2)],
    });
  }

  // ============================================================ 10. or not (bars 18-20)
  {
    const spot = others[0] ?? open[0];
    const V = () => cast()[5];
    add(18, 2, {
      name: 'takedown',
      hud: true,
      setup: () => {
        hideAll();
        S.clean();
        V().place(spot.x, spot.z, 0.4, 'mosin', ['sack_pack']);
        V().aim = true;
        V().crouch = true;
        S.kit(['hatchet']);
        S.hold('melee');
        // behind him, and he has not heard
        S.me(spot.x + Math.sin(0.4) * 11, spot.z + Math.cos(0.4) * 11, 0.4, -0.05);
      },
      tick: (t) => {
        const p = g.player, v = V();
        const d = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z);
        S.aimAt(v.alive ? v.pos.clone().setY(v.pos.y + 0.75) : v.pos.clone().setY(v.pos.y + 0.2));
        S.key('KeyW', t > 0.25 && d > 1.15 && v.alive);
        S.key('ShiftLeft', t > 0.25 && d > 3);
        if (v.alive && d < 1.75 && !g.weapons.busy) S.tap('Mouse0', 50);
      },
      titles: [title('OR TAKE THEM DOWN', 0.25, 2.3)],
    });
  }

  // ============================================================ 11-13. the tag (bars 20-26)
  {
    const spot = others[1] ?? others[0] ?? open[0];
    const dead = () => cast()[5];
    let tag: any = null;
    let walkYaw = yawTo(spot.x, spot.z, c.x, c.z);
    {
      let best = -1;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const hit = physics.raycast(P(spot.x, spot.z, 1.1), { x: -Math.sin(a), y: 0, z: -Math.cos(a) }, 90);
        const room = (hit ? hit.toi : 90) + Math.cos(a - walkYaw) * 12;
        if (room > best) {
          best = room;
          walkYaw = a;
        }
      }
    }
    add(20, 2, {
      name: 'tag-take',
      hud: true,
      setup: async () => {
        hideAll();
        S.clean();
        dead().place(spot.x, spot.z, 1.2, null, []);
        dead().die(new THREE.Vector3(-Math.sin(1.2), 0, -Math.cos(1.2)).negate());
        S.kit(['p38', ['ammo_9mm', 16], 'bandage']);
        S.hold('holster');
        // he went over backwards: the body lies a pace behind where he stood
        const bx = spot.x + Math.sin(1.2) * 0.85, bz = spot.z + Math.cos(1.2) * 0.85;
        S.me(bx + Math.cos(1.2) * 1.6, bz - Math.sin(1.2) * 1.6, yawTo(bx + Math.cos(1.2) * 1.6, bz - Math.sin(1.2) * 1.6, bx, bz), -0.7);
        // the fall, and the body settling, happen before the camera rolls
        for (let i = 0; i < 150; i++) {
          (window as any).__clock.advance(1000 / 60);
          if (i % 30 === 29) await new Promise<void>((r) => (window as any).__clock.real.setTimeout(r, 30));
        }
        const st = g.corpses.get(dead().corpseId)?.stash;
        if (!st) throw new Error('the body did not appear');
        st.known = true;
        tag = makeItem('dogtag');
        tag.owner = dead().name;
        tag.pid = 'trailer-other';
        st.container.add(tag);
        st.container.add(makeItem('ammo_762', 8));
        st.container.add(makeItem('beans'));
        S.aimAt(P(spot.x + Math.sin(1.2) * 0.85, spot.z + Math.cos(1.2) * 0.85, 0.22));
      },
      cues: [
        { at: 0.35, fn: () => S.tap('KeyF') },
        {
          at: 2.15,
          fn: () => {
            // the player's own double click on the tag
            const el = document.querySelector('.inv-vicinity .inv-item.cat-misc') ?? document.querySelector('.inv-item.cat-misc');
            el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
          },
        },
        { at: 3.2, fn: () => g.invUI.isOpen && g.toggleInventory(false) },
      ],
      after: (t) => cursor(t, 1.1, 2.15, '.inv-vicinity .inv-item.cat-misc'),
      titles: [title('TAKE THEIR TAG', 0.2, 3.4, 'top')],
    });
    add(22, 2, {
      name: 'tag-hold',
      chain: true,
      hud: true,
      setup: () => {
        hideCursor();
        if (g.invUI.isOpen) g.toggleInventory(false);
        g.player.yaw = walkYaw;
        g.player.pitch = -0.06;
      },
      // thirty minutes in under four seconds: the tag's own clock, run fast
      tick: (t) => {
        S.key('KeyW', true);
        S.key('ShiftLeft', true);
        g.player.yaw = walkYaw + 0.12 * Math.sin(t * 0.8);
        g.player.vitals.stamina = 300;
        const it = g.inv.find((i: any) => i.id === 'dogtag' && i.pid === 'trailer-other');
        if (it) {
          it.held = Math.max(it.held ?? 0, lerp(2, TAG_HOLD - 6, ease(t / b(2)) ** 1.3));
          g.tickTags(0);
        }
      },
      rate: () => 2.2,
      titles: [title('HOLD IT 30:00', 0.25, 3.2, 'top')],
    });
    add(24, 2, {
      name: 'cash-in',
      chain: true,
      hud: true,
      setup: () => {
        rain(false);
      },
      tick: (t) => {
        S.key('KeyW', t < 0.5);
        S.key('ShiftLeft', false);
        g.player.pitch = lerp(-0.06, 0.12, ease(t / 1.2));
      },
      cues: [{
        at: 0.45,
        fn: () => {
          const it = g.inv.find((i: any) => i.id === 'dogtag' && i.pid === 'trailer-other');
          if (it) it.held = TAG_HOLD;
          g.tickTags(0);
          rain(true, () => S.rnd());
        },
      }],
      after: (t) => rainTick(t - 0.45),
      titles: [{ at: 0.65, until: 3.5, text: 'CASHED IN', cls: 'big gold' }, { at: 0.45, until: b(2), text: 'in development', cls: 'dev' }],
    });
  }

  // ============================================================ 14. what it is (bars 26-30)
  {
    const stat = (i: number, text: string, cam: Shot['cam'], setup?: Shot['setup'], tick?: Shot['tick']) =>
      add(26 + i, 1, { name: `stat-${i}`, setup: setup ?? (() => { hideAll(); rain(false); S.parkMe(); S.clean(); }), cam, tick, titles: [{ at: 0.12, until: b(1) - 0.08, text, cls: 'stat' }] });
    stat(0, '<b>1 KM²</b> OF FOREST, FIELDS AND VILLAGE', (t) => {
      const k = t / b(1);
      return { p: P(c.x - 260 + k * 60, c.z + 240 - k * 50, 0).setY(S.ground(c.x, c.z) + 150), l: P(c.x, c.z, 0), fov: 42 };
    });
    stat(1, '<b>52</b> BUILDINGS · <b>14</b> PLACES TO LOOT', (t) => {
      const k = lerp(0.15, 0.62, t / b(1));
      const at = roadAt(k), look = roadAt(k + 0.12);
      return { p: at.setY(at.y + 2.4), l: look.setY(look.y + 1.6), fov: 58 };
    });
    const crowd = others[2] ?? others[0] ?? open[0];
    stat(2, 'UP TO <b>24</b> PLAYERS A SERVER', orbit(P(crowd.x, crowd.z, 1.1), 9, 7, 0.4, 1.5, 0.6, 40, b(1)), () => {
      hideAll();
      S.parkMe();
      S.clean();
      const gear = [['boonie_hat'], ['life_vest'], ['sack_pack'], ['suitcase', 'boonie_hat'], [], ['life_vest', 'boonie_hat']];
      cast().forEach((a, i) => {
        const ang = (i / cast().length) * Math.PI * 2;
        a.place(crowd.x + Math.cos(ang) * 2.6, crowd.z + Math.sin(ang) * 2.6, yawTo(Math.cos(ang), Math.sin(ang), 0, 0) + 0.3, ['mosin', 'p38', 'hatchet', 'mosin', 'bat', 'p38'][i], gear[i]);
        a.aim = i % 2 === 0;
      });
    });
    stat(3, 'NO DOWNLOAD · <b>PLAYS IN YOUR BROWSER</b>', (t) => {
      const k = t / b(1);
      const sp = world.spawns[5] as { x: number; z: number };
      const dir = new THREE.Vector3(c.x - sp.x, 0, c.z - sp.z).normalize();
      const at = P(sp.x + dir.x * (20 + k * 16), sp.z + dir.z * (20 + k * 16), 2.2);
      return { p: at, l: at.clone().addScaledVector(dir, 10).setY(at.y - 0.4), fov: 60 };
    });
  }

  // ============================================================ 15. what is coming (bars 30-34)
  {
    const soon = (i: number, text: string, cam: Shot['cam'], setup?: Shot['setup'], tick?: Shot['tick']) =>
      add(30 + i, 1, { name: `soon-${i}`, setup: setup ?? (() => { hideAll(); S.parkMe(); S.clean(); }), cam, tick, titles: [{ at: 0, until: b(1), text: 'COMING SOON', cls: 'kicker' }, { at: 0.12, until: b(1) - 0.08, text, cls: 'soon' }] });
    const s1 = others[3] ?? open[0], s2 = others[4] ?? open[0];
    soon(0, 'SOL PAYOUTS FOR THE TAGS YOU CASH IN', orbit(P(s1.x, s1.z, 0.9), 5, 4, 2.2, 3.0, 0.4, 36, b(1)), () => {
      hideAll();
      S.parkMe();
      S.clean();
      cast()[0].place(s1.x, s1.z, 2.0, 'p38', ['boonie_hat', 'sack_pack']);
      cast()[0].aim = false;
    });
    soon(1, 'AN AUTOMATIC RIFLE · MORE WEAPONS', orbit(P(s2.x, s2.z, 1.3), 4.2, 3.4, 0.2, 0.9, 0.1, 34, b(1)), () => {
      hideAll();
      S.parkMe();
      S.clean();
      const a = cast()[1].place(s2.x, s2.z, 1.1, 'mosin', ['life_vest']);
      a.aim = true;
      a.nextShot = 0.3;
    }, (t) => {
      const a = cast()[1];
      if (t > a.nextShot) {
        a.nextShot = 99;
        a.fireAt(a.eye().add(new THREE.Vector3(-Math.sin(1.1), 0, -Math.cos(1.1)).multiplyScalar(60)));
      }
    });
    {
      const from = roadAt(0.7), to = roadAt(0.4);
      const dir = to.clone().sub(from).setY(0).normalize(), right = new THREE.Vector3(-dir.z, 0, dir.x);
      soon(2, 'SQUADS', (t) => {
        const lead = cast()[2].pos;
        return { p: lead.clone().addScaledVector(dir, -5.5).addScaledVector(right, 1.2).setY(lead.y + 1.9 + t * 0.3), l: lead.clone().addScaledVector(dir, 4).setY(lead.y + 1.1), fov: 44 };
      }, () => {
        hideAll();
        S.parkMe();
        S.clean();
        const yaw = Math.atan2(-dir.x, -dir.z);
        [cast()[2], cast()[3], cast()[4], cast()[5]].forEach((a, i) => a.place(from.x - dir.x * (i > 1 ? 2.5 : 0) + right.x * (i % 2 ? 1.6 : -1.6), from.z - dir.z * (i > 1 ? 2.5 : 0) + right.z * (i % 2 ? 1.6 : -1.6), yaw, i % 2 ? 'p38' : 'mosin', [['boonie_hat'], ['life_vest'], ['sack_pack'], ['suitcase']][i]));
      }, (_t, _S, dt) => [cast()[2], cast()[3], cast()[4], cast()[5]].forEach((a) => a.go(a.pos.x + dir.x * 5, a.pos.z + dir.z * 5, 3.3, dt)));
    }
    soon(3, 'NEW PLACES ON THE MAP', (t) => {
      const k = t / b(1);
      const far = world.sites[2] as { x: number; z: number };
      const dir = new THREE.Vector3(far.x - c.x, 0, far.z - c.z).normalize();
      const at = P(c.x + dir.x * (60 + k * 40), c.z + dir.z * (60 + k * 40), 0).setY(S.ground(c.x, c.z) + 46 - k * 6);
      return { p: at, l: P(far.x, far.z, 4), fov: 44 };
    });
  }

  // ============================================================ 16. everything at once (bars 34-38)
  {
    const places = [...others.slice(5), ...others, ...open];
    for (let k = 0; k < 8; k++) {
      const at = places[k % places.length];
      const ang = k * 1.1 + 0.4, sep = k === 7 ? 9 : 11 + (k % 3) * 3;
      const sx = at.x + Math.cos(ang) * sep, sz = at.z + Math.sin(ang) * sep;
      const shooter = () => cast()[k % 2 ? 2 : 0], victim = () => cast()[k % 2 ? 3 : 1];
      const lastCut = k === 7;
      const vyaw = [0, Math.PI, Math.PI / 2, 0.3, Math.PI, -Math.PI / 2, 0, Math.PI][k];
      add(34 + k * 0.5, 0.5, {
        name: `finale-${k}`,
        setup: () => {
          hideAll();
          S.parkMe();
          S.clean();
          const face = yawTo(at.x, at.z, sx, sz);
          victim().place(at.x, at.z, face + vyaw, k % 3 === 0 ? 'p38' : 'mosin', [['boonie_hat'], ['life_vest'], ['sack_pack'], []][k % 4]);
          victim().hp = 40;
          victim().aim = vyaw === 0;
          shooter().place(sx, sz, yawTo(sx, sz, at.x, at.z), 'mosin', [['life_vest'], ['boonie_hat', 'suitcase']][k % 2]);
          shooter().aim = true;
        },
        cues: [{ at: lastCut ? 0.16 : 0.24, fn: () => shooter().fireAt(lastCut ? victim().head() : victim().chest(), 0) }],
        // the last one is the one you remember: slow, close, to the head
        rate: lastCut ? (t) => (t < 0.14 ? 1 : 0.22) : undefined,
        cam: lastCut
          ? (t) => ({ p: P(at.x + Math.cos(ang + 1.3) * 3.1, at.z + Math.sin(ang + 1.3) * 3.1, 1.5), l: P(at.x, at.z, 1.35 - t * 0.5), fov: 30 })
          : [
              orbit(P(at.x, at.z, 1.1), 6.5, 5.5, ang + 1.2, ang + 1.6, 0.2, 38, b(0.5)),
              (t: number): CamPose => ({ p: P(sx - Math.cos(ang) * 1.6 + Math.sin(ang) * 0.9, sz - Math.sin(ang) * 1.6 - Math.cos(ang) * 0.9, 1.75), l: P(at.x, at.z, 1.1 - t * 0.3), fov: 30 }),
              orbit(P(at.x, at.z, 0.9), 4.6, 4.2, ang - 1.4, ang - 1.1, -0.3, 44, b(0.5)),
            ][k % 3],
      });
    }
  }

  // ============================================================ 17. the name and where to find it (bars 38-40)
  add(38, 2, {
    name: 'end',
    setup: () => {
      hideAll();
      S.parkMe();
      S.clean();
    },
    cam: (t) => {
      const a = 2.2 + t * 0.05;
      return { p: P(c.x + Math.cos(a) * 128, c.z + Math.sin(a) * 128, 0).setY(S.ground(c.x, c.z) + 44), l: P(c.x, c.z, 7), fov: 50 };
    },
    bars: false,
    titles: [{ at: 0, until: b(2) + 1, text: '<div class="end-logo">ZONA</div><div class="end-line">PLAY NOW IN YOUR BROWSER</div><div class="end-url">WWW.ZONAPVP.FUN</div>', cls: 'end' }],
  });

  shots.sort((x, y) => x.start - y.start);
  return shots;
}

// ------------------------------------------------------------------------------------------ overlay pieces

const overlay = () => document.getElementById('tr-overlay')!;
let cursorEl: HTMLElement | null = null;
/** the mouse pointer, gliding to whatever matches `selector` between two moments */
function cursor(t: number, from: number, to: number, selector: string) {
  if (t < from - 0.3 || t > to + 0.6) return hideCursor();
  if (!cursorEl) {
    cursorEl = document.createElement('div');
    cursorEl.className = 'tr-cursor';
    overlay().appendChild(cursorEl);
  }
  const el = document.querySelector(selector) ?? document.querySelector('.inv-item.cat-misc');
  const r = el?.getBoundingClientRect();
  const k = ease((t - from) / (to - from));
  const tx = r ? r.left + r.width * 0.55 : innerWidth * 0.3, ty = r ? r.top + r.height * 0.55 : innerHeight * 0.5;
  cursorEl.style.display = '';
  cursorEl.style.left = `${lerp(innerWidth * 0.52, tx, k)}px`;
  cursorEl.style.top = `${lerp(innerHeight * 0.7, ty, k)}px`;
  cursorEl.classList.toggle('down', t > to - 0.03 && t < to + 0.12);
}
function hideCursor() {
  if (cursorEl) cursorEl.style.display = 'none';
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
    const u = (t - d.delay) * d.speed;
    d.el.style.display = u < 0 ? 'none' : '';
    d.el.style.fontSize = `${d.size}px`;
    d.el.style.left = `${d.x * 100}%`;
    d.el.style.top = `${-12 + u * 125}%`;
    d.el.style.transform = `translate(-50%, 0) rotate(${u * d.spin}rad)`;
  }
}
