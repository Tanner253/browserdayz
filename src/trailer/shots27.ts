// The twenty-seventh film, about 31 s: the battle royale for the gameplay trailer (shots26.ts lays these pictures in,
// kept frame by frame by film.mjs --frames). A real match on the film's own arena server, as the twenty-fifth was (its
// clock moves only as this page's does, its dice seeded), watched from outside as a spectator watches. The owner,
// 2026-10-23, of the first board: "the plane and land process looks terrible it should be shown from 3rd person
// spectate"; of the second: "a player would drop into a town to loot ... it feels like youre not even thinking about
// whate youre doing". So the squad jumps where the drop ship's line crosses a town, falls toward it steering, opens
// over its roofs and comes down its street, and the first thing done on the ground is a house looted: in at the door,
// a gun off the floor, out with it. Then a fight in the street, the circle closing, the last fight and the game's #1.
// Mira is followed throughout; Sable (this page's own player) is her teammate; the others are sockets moved as people
// move (brbots.ts). No music of its own (the twenty-sixth's plays under it) and no words over it.
//   node scripts/film.mjs --cut 27 --frames br27 --no-video --url "http://localhost:5173/tools/trailer.html?cut=27&wager=br&size=2&kills=2&loadout=FIND&arena=http://localhost:8095"
// Restart zona-arena-film before every run (a fresh lobby).
import * as THREE from 'three';
import type { CamPose, Shot, Stage } from './director';
import { BrBot, F_AIM, F_CROUCH, F_GROUND, F_SPRINT } from './brbots';
import { BRACED, Operator, Spectate, Speeds, wrap, yawTo } from './human';
import { FLIGHT, MAPS, kindOf } from '../../arena/br/rules';
import { openDoor } from '../ui/door';
import { physics, SIGHT_GROUPS, SOLID_GROUPS } from '../core/physics';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** each shot's length, seconds: the twenty-sixth picks its stretches of this footage by them */
export const LEN27 = { ship: 3.8, fall: 4.2, canopy: 4.6, loot: 5.2, fight: 4.2, last: 2.6, win: 3.4 };

let total = 0;
export const seconds = () => total;
/** silent: the twenty-sixth's score plays under these pictures, and their own sounds go with them */
export const score = () => {};

const Q = new URLSearchParams(location.search);
const ARENA = Q.get('arena') ?? 'http://localhost:8095';
const VCLOCK = 'http://127.0.0.1:8096';
const MAP = Number(Q.get('kills') ?? 2);
/** upright for phones (film.mjs --tall): a taller lens, so the subject keeps its size and the picture its sides */
const TALL = Q.has('tall');
const lens = (f: number) => (TALL ? (2 * Math.atan(1.9 * Math.tan((f * Math.PI) / 360)) * 180) / Math.PI : f);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const fwdOf = (yaw: number) => V(-Math.sin(yaw), 0, -Math.cos(yaw));
const rightOf = (yaw: number) => V(Math.cos(yaw), 0, -Math.sin(yaw));
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  const say = (s: string) => console.log(`[tr] ${s}`);
  document.body.classList.add('tr-cut21', 'tr-br25', 'tr-br27');
  const m = MAPS[MAP];

  // ------------------------------------------------------------ the server's clock, moved on with this page's
  let owed = 0;
  const advance = clock.advance.bind(clock);
  clock.advance = (ms: number) => {
    owed += ms;
    advance(ms);
  };
  const flush = async () => {
    if (owed <= 0) return;
    const ms = owed;
    owed = 0;
    try { await fetch(`${VCLOCK}/advance?ms=${ms.toFixed(3)}`); } catch (e) { say(`the server's clock did not answer: ${(e as Error).message}`); }
    await wait(3);
  };
  S.onFrame = async () => {
    await flush();
  };

  // ------------------------------------------------------------ the ground and what stands in the way
  /** the floor under a point, by the physics (what is drawn and walked): the height table is up to two metres off it */
  const floorAt = (x: number, z: number, near?: number) => {
    const from = (near ?? S.ground(x, z)) + 1.5;
    const hit = physics.raycast({ x, y: from, z }, { x: 0, y: -1, z: 0 }, 8, SOLID_GROUPS);
    return hit ? from - hit.toi : S.ground(x, z);
  };
  /** the floor seen from high over a point: a roof if there is one */
  const topAt = (x: number, z: number) => {
    const from = S.ground(x, z) + 60;
    const hit = physics.raycast({ x, y: from, z }, { x: 0, y: -1, z: 0 }, 90, SOLID_GROUPS);
    return hit ? from - hit.toi : S.ground(x, z);
  };
  const roofOver = (p: THREE.Vector3, up = 30) => !!physics.raycast({ x: p.x, y: p.y + 0.3, z: p.z }, { x: 0, y: 1, z: 0 }, up, SOLID_GROUPS);
  /** nothing between two points that a picture or a round would meet (walls, ground, trunks, bushes) */
  const sees = (a: THREE.Vector3, b: THREE.Vector3, groups = SIGHT_GROUPS) => {
    const d = b.clone().sub(a), len = d.length();
    return len < 0.5 || !physics.raycast(a, d.normalize(), len - 0.4, groups);
  };
  /** and the same half a metre either side, so a post by the line is not missed */
  const seesWide = (a: THREE.Vector3, b: THREE.Vector3) => {
    const side = V(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar(0.5);
    return sees(a, b) && sees(a.clone().add(side), b.clone().add(side)) && sees(a.clone().sub(side), b.clone().sub(side));
  };
  /** a lens kept out of the trees: pushed off any trunk nearer than its crown reaches (a ray finds trunks, not boughs) */
  const trunks = ((S.world.trees ?? []) as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush'));
  const offTrees = (p: THREE.Vector3, r = 4.5) => {
    for (const t of trunks) {
      const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-3) {
        p.x = t.x + (dx / d) * r;
        p.z = t.z + (dz / d) * r;
      }
    }
    return p;
  };
  /** how far open ground runs from a point along a way, at a height (to 80 m) */
  const reach = (p: THREE.Vector3, dir: THREE.Vector3, up: number, most = 80) => physics.raycast({ x: p.x, y: p.y + up, z: p.z }, dir.clone().setY(0).normalize(), most, SIGHT_GROUPS)?.toi ?? most;

  // ------------------------------------------------------------ the hero (this page's own player): legs and the air
  const P = () => g.player as Any;
  const br = () => g.br as Any;
  const phase = () => br()?.phase as string | undefined;
  const serverNow = () => br()?.now ?? Date.now();
  let goal: THREE.Vector3 | null = null, goalStop = 0.6;
  const legs = () => {
    if (!goal) {
      for (const k of ['KeyW', 'ShiftLeft', 'AltLeft']) S.key(k, false);
      return Infinity;
    }
    const p = P().pos as THREE.Vector3, left = flat(goal, p);
    P().yaw += wrap(yawTo(p, goal) - P().yaw) * 0.12;
    S.key('KeyW', left > goalStop);
    S.key('ShiftLeft', left > 5);
    return left;
  };
  // (his own body, seen from outside, is hidden aboard as the others are: src/game/br/mode.ts fly)
  {
    const upd = g.avatar.update.bind(g.avatar);
    let hid = false;
    g.avatar.update = (...a: Any[]) => {
      upd(...a);
      const air = br()?.air, root = g.avatar.root as THREE.Object3D;
      if (air === 'plane') {
        root.visible = false;
        hid = true;
      } else {
        if (hid) root.visible = true;
        hid = false;
      }
    };
  }

  // ------------------------------------------------------------ the others: six sockets, moved as people move
  const url = `${ARENA.replace(/^http/, 'ws')}/battleroyale?size=2&kills=${MAP}&loadout=FIND`;
  const NAMES = ['Mira', 'Volkov', 'Kestrel', 'Oksana', 'Bear', 'Dmitri'];
  const [MIRA, VOLKOV, KESTREL, OKSANA, BEAR, DMITRI] = [0, 1, 2, 3, 4, 5];
  const bots: BrBot[] = [];
  interface Plan {
    /** on foot: where to, how fast, stopping how far short */
    goal: THREE.Vector3 | null; speed: number; stop: number;
    air: 'plane' | 'fall' | 'chute' | null; vel: THREE.Vector3; jumpAt: number; yaw: number;
    /** in the air: where it means to come down, and (the last of it, under the canopy) the way it comes in along */
    land: THREE.Vector3; way: THREE.Vector3 | null; glide: number;
    shootAt: number; left: boolean; crouch: boolean; aim: boolean; face: THREE.Vector3 | null;
  }
  const plans: Plan[] = [];
  const planeAt = (t: number) => {
    const p = br()?.plane;
    if (!p) return null;
    const dx = p.b[0] - p.a[0], dz = p.b[1] - p.a[1], L = Math.hypot(dx, dz), s = Math.max(0, ((t - p.t0) / 1000) * p.speed);
    return V(p.a[0] + (dx / L) * s, p.y, p.a[1] + (dz / L) * s);
  };
  const planeDir = () => {
    const p = br().plane, L = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
    return V((p.b[0] - p.a[0]) / L, 0, (p.b[1] - p.a[1]) / L);
  };
  const remoteOf = (b: BrBot) => g.remotes.get(b.id) as Any;
  /** where a bot's body is drawn (its RemotePlayer, a little behind what it says) */
  const bodyOf = (i: number) => {
    const r = remoteOf(bots[i]);
    return r ? (r.pos as THREE.Vector3).clone() : V(bots[i].pose[0], bots[i].pose[1], bots[i].pose[2]);
  };
  const chestOf = (i: number) => bodyOf(i).add(V(0, plans[i]?.crouch ? 0.75 : 1.25, 0));
  const said = (i: number) => V(bots[i].pose[0], bots[i].pose[1], bots[i].pose[2]);
  const guns = () => [...(br()?.ground?.values() ?? [])].filter((q: Any) => q.item && kindOf(q.item.id) === 'gun') as Any[];
  const gunIn = (i: number) => (bots[i].me?.slots ?? []).find((s: Any) => s && kindOf(s.id) === 'gun');
  const drive = (dt: number) => {
    const ph = phase();
    bots.forEach((b, i) => {
      const pl = plans[i];
      if (!b.open || pl.left || b.id < 0) return;
      if (ph === 'plane' && pl.air === 'plane') {
        const at = planeAt(serverNow());
        if (!at) return;
        b.move(at.x, at.y - 7, at.z, 0, 0, 0);
        if (serverNow() >= pl.jumpAt) {
          b.br({ k: 'jump' });
          b.br({ k: 'air', s: 'fall' });
          pl.air = 'fall';
          pl.vel.copy(planeDir().multiplyScalar(FLIGHT.speed * 0.5));
          pl.yaw = yawTo(at, at.clone().add(planeDir()));
        }
        return;
      }
      if (pl.air === 'fall' || pl.air === 'chute') {
        // falling toward its own landing as a player steers (forward held, it dives while it is far); under the canopy,
        // the last of the way in along `way`, at the glide its height left allows
        const p = said(i), chute = pl.air === 'chute';
        const floor = floorAt(p.x, p.z, topAt(p.x, p.z)), up = p.y - floor;
        // (falling, it makes for where the canopy's glide in along the street begins, at the height the canopy opens)
        let aim = pl.land;
        if (pl.way) aim = pl.land.clone().addScaledVector(pl.way, -Math.max(0, (chute ? up : FLIGHT.open) - 0.5) * (pl.glide / FLIGHT.chuteFall));
        const to = aim.clone().sub(p).setY(0), far = to.length();
        const across = chute ? (pl.way ? pl.glide : FLIGHT.chuteGlide) : FLIGHT.steer;
        const want = far > 0.5 ? to.normalize().multiplyScalar(Math.min(across, far * 1.5)) : V(0, 0, 0);
        if (chute && pl.way) {
          // on the line in along the street: as fast along it as makes the height left and the way left come out
          // together (no faster than the canopy flies, no slower than with the brakes held), and back onto it if off
          const toLand = pl.land.clone().sub(p).setY(0), have = toLand.dot(pl.way), wantHave = Math.max(0, up - 0.02) * (pl.glide / FLIGHT.chuteFall);
          const offLine = toLand.clone().addScaledVector(pl.way, -have);
          const sp = Math.min(FLIGHT.chuteGlide * 1.2, Math.max(FLIGHT.chuteGlide * 0.4, pl.glide * (1 + (have - wantHave) / 10)));
          want.copy(pl.way).multiplyScalar(sp).addScaledVector(offLine, Math.min(1.2, 3 / Math.max(1, offLine.length())));
        }
        const k = Math.min(1, dt * (chute ? 2 : 1.2));
        pl.vel.x += (want.x - pl.vel.x) * k;
        pl.vel.z += (want.z - pl.vel.z) * k;
        const down = chute ? FLIGHT.chuteFall : far > 60 ? FLIGHT.dive : FLIGHT.fall;
        pl.vel.y += (-down - pl.vel.y) * Math.min(1, dt * 2.5);
        p.addScaledVector(pl.vel, dt);
        if (Math.abs(pl.vel.x) + Math.abs(pl.vel.z) > 0.5) pl.yaw += wrap(Math.atan2(-pl.vel.x, -pl.vel.z) - pl.yaw) * Math.min(1, dt * 3);
        if (!chute && p.y - floor < FLIGHT.open) {
          pl.air = 'chute';
          b.br({ k: 'air', s: 'chute' });
        }
        // (down onto its feet where the ground is, not dropped the last metre and a half)
        if (p.y - floor < 0.04) {
          pl.air = null;
          p.y = floor;
          b.br({ k: 'air', s: null });
          pl.vel.set(0, 0, 0);
        }
        b.move(p.x, p.y, p.z, pl.yaw, 0, pl.air ? 0 : F_GROUND);
        return;
      }
      // on its feet: toward its goal at its pace, turning as a person does
      const p = said(i);
      if (b.put) {
        p.set(b.put[0], b.put[1], b.put[2]);
        b.put = null;
      }
      let flags = F_GROUND;
      if (pl.goal) {
        const to = pl.goal.clone().sub(p).setY(0), d = to.length();
        if (d > pl.stop) {
          // (eased in and out: no start or stop at full pace)
          const v = Math.min(pl.speed, (d - pl.stop) * 1.6 + 0.4);
          p.addScaledVector(to.normalize(), Math.min(d - pl.stop, v * dt));
          if (!pl.face) pl.yaw += wrap(Math.atan2(-to.x, -to.z) - pl.yaw) * Math.min(1, dt * 6);
          if (v > 5) flags |= F_SPRINT;
        }
      }
      if (pl.face) pl.yaw += wrap(yawTo(p, pl.face) - pl.yaw) * Math.min(1, dt * 7);
      p.y = floorAt(p.x, p.z, p.y);
      if (pl.crouch) flags |= F_CROUCH;
      if (pl.aim || (b.w && kindOf(b.w) === 'gun' && serverNow() < pl.shootAt + 900)) flags |= F_AIM;
      b.move(p.x, p.y, p.z, pl.yaw, 0, flags);
      const gun = gunIn(i);
      b.w = gun ? gun.id : (b.me?.slots?.[0]?.id ?? null);
    });
  };
  const fireAt = (i: number, to: THREE.Vector3, miss: number) => {
    const b = bots[i], pl = plans[i];
    if (!b.w || kindOf(b.w) !== 'gun') return;
    const o = V(b.pose[0], b.pose[1] + 1.5, b.pose[2]), d = to.clone().sub(o);
    d.x += (S.rnd() - 0.5) * miss;
    d.y += (S.rnd() - 0.5) * miss * 0.5;
    d.z += (S.rnd() - 0.5) * miss;
    pl.yaw = Math.atan2(-d.x, -d.z);
    pl.shootAt = serverNow();
    b.fire([o.x, o.y, o.z], [d.x, d.y, d.z]);
  };
  /** a bot takes the thing lying nearest to where it stands, if within the game's reach */
  const takeNear = (i: number) => {
    const p = said(i), q = guns().filter((x) => Math.hypot(x.x - p.x, x.z - p.z) < 3.1).sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
    if (q) bots[i].br({ k: 'take', id: q.id, slot: 1 });
    return q;
  };

  /** frames nobody sees: the page and the server moved on together, the others driven */
  const run = async (frames: number, each?: (k: number) => void, step = 1 / 60) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      each?.(i);
      drive(step);
      for (const a of S.actors) a.push();
      clock.advance(1000 * step);
      await flush();
    }
    S.mute = false;
  };
  const until = async (ok: () => boolean, most: number, each?: (k: number) => void, step = 1 / 60) => {
    for (let i = 0; i < most && !ok(); i++) await run(1, each ? () => each(i) : undefined, step);
    return ok();
  };

  // ------------------------------------------------------------ the shots
  const speeds = new Speeds();
  const fired = new Set<string>();
  const when = (t: number, at: number, key: string, fn: () => void) => {
    if (t >= at && !fired.has(key)) {
      fired.add(key);
      fn();
    }
  };
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
  const shots: Shot[] = [];
  let cur = 0;
  const add = (len: number, s: Omit<Shot, 'start' | 'end'>) => {
    const start = cur, setup = s.setup, after = s.after, tick = s.tick;
    cur += len;
    total = cur;
    let lt = -1;
    shots.push({
      bars: false,
      chain: shots.length > 0,
      ...s,
      start,
      end: start + len,
      setup: async (st) => {
        say(`${s.name}: setting up at the match's ${phase() ?? 'start'}`);
        try {
          await setup?.(st);
        } catch (e) {
          say(`${s.name}: its setting up failed: ${(e as Error).message}`);
        }
        lt = -1;
      },
      lead: (t, st) => {
        const dt = lt < -0.9 ? 1 / 60 : t - lt;
        lt = t;
        drive(dt);
        legs();
        tick?.(t, st, dt);
      },
      tick: (t, st, dt) => {
        lt = t;
        drive(dt);
        legs();
        tick?.(t, st, dt);
      },
      after: (t, st) => {
        after?.(t, st);
        speeds.note('mira', t, bodyOf(MIRA));
        if (S.cam) speeds.note('lens', t, S.cam.p);
        hush();
        if (t > len - 0.05 && !fired.has(`said ${s.name}`)) {
          fired.add(`said ${s.name}`);
          say(`${s.name}: ${speeds.report()} · phase ${phase()}`);
        }
      },
    } as Shot);
  };
  /** a lens is never under the ground or inside a roof: lifted clear of what is under it */
  const clear = (c: CamPose) => {
    const f = floorAt(c.p.x, c.p.z, c.p.y);
    if (c.p.y < f + 0.9) c.p.y = f + 0.9;
    return c;
  };

  // ------------------------------------------------------------ the plan: which town, which house, which gun
  interface Drop {
    town: string;
    /** the door, its middle, and the way out of it to the street */
    door: number; at: THREE.Vector3; out: THREE.Vector3;
    /** where she stands inside to take the gun, and the gun */
    inside: THREE.Vector3; gun: Any;
    /** where she comes down in the street, the way she comes in along it, how far that way is open */
    land: THREE.Vector3; way: THREE.Vector3; open: number;
    /** along the street the other way: where Volkov comes from, and how far a clear line runs */
    foe: THREE.Vector3; foeDir: THREE.Vector3;
    /** the gun in the open Volkov comes down by, and her canopy's glide (m/s across) */
    vgun: Any; glide: number;
  }
  let drop: Drop | null = null;
  const findDrop = (): Drop | null => {
    const p = br().plane, ax = p.a[0], az = p.a[1], dx = p.b[0] - ax, dz = p.b[1] - az, L = Math.hypot(dx, dz);
    const off = (x: number, z: number) => Math.abs(((x - ax) * dz - (z - az) * dx) / L);
    const doors = g.s.buildings.doors as Any[];
    const houses = (S.world.buildings as Any[]).filter((b) => b.x > m.x0 && b.x < m.x1 && b.z > m.z0 && b.z < m.z1);
    const all = guns();
    let best: (Drop & { score: number }) | null = null;
    let tried = 0;
    doors.forEach((d: Any, i: number) => {
      const w = d.size?.[0] ?? 0.9;
      if (w < 0.8) return;
      const q = d.baseQuat as THREE.Quaternion, hinge = d.pivot.position as THREE.Vector3;
      const along = V(1, 0, 0).applyQuaternion(q), n = V(0, 0, 1).applyQuaternion(q).setY(0).normalize();
      const at = hinge.clone().addScaledVector(along, w / 2);
      // (a town, within an easy fall of the ship's line: a player goes where the houses are, and can get there)
      if (off(at.x, at.z) > 150 || at.x < m.x0 + 90 || at.x > m.x1 - 90 || at.z < m.z0 + 90 || at.z > m.z1 - 90) return;
      const near = houses.filter((h) => Math.hypot(h.x - at.x, h.z - at.z) < 70);
      if (near.length < 6) return;
      tried++;
      // which side is the street: open sky over it, a roof over the other, the two floors at one height
      const a = at.clone().addScaledVector(n, 2.2), b = at.clone().addScaledVector(n, -2.2);
      a.y = floorAt(a.x, a.z, at.y + 0.2);
      b.y = floorAt(b.x, b.z, at.y + 0.2);
      const ra = roofOver(a, 12), rb = roofOver(b, 12);
      if (ra === rb || Math.abs(a.y - b.y) > 0.5) return;
      const out = ra ? n.clone().negate() : n.clone(), street = ra ? b : a, room = ra ? a : b;
      if (Math.abs(street.y - S.ground(street.x, street.z)) > 1.2) return;
      // a gun inside within reach of a step in at the door, on the floor or a table
      const inside = at.clone().addScaledVector(out, -1.0);
      inside.y = floorAt(inside.x, inside.z, at.y + 0.2);
      const gun = all.filter((x) => Math.hypot(x.x - inside.x, x.z - inside.z) < 2.6 && x.y - inside.y > -0.3 && x.y - inside.y < 1.3 && sees(inside.clone().setY(inside.y + 1.0), V(x.x, x.y + 0.15, x.z), SOLID_GROUPS))
        .sort((u, v) => Math.hypot(u.x - inside.x, u.z - inside.z) - Math.hypot(v.x - inside.x, v.z - inside.z))[0];
      if (!gun || !roofOver(room, 12)) return;
      // the street in front: open sky, flat, and the door seen from where she lands
      const land = at.clone().addScaledVector(out, 6.5);
      land.y = floorAt(land.x, land.z, at.y + 0.5);
      if (roofOver(land, 40) || Math.abs(land.y - street.y) > 0.8 || !sees(land.clone().setY(land.y + 1.0), at.clone().setY(at.y + 1.0), SOLID_GROUPS)) return;
      // along the street both ways: she comes in along the more open one, Volkov from the other
      const side = V(-out.z, 0, out.x);
      const o1 = Math.min(reach(land, side, 4), reach(land, side, 14)), o2 = Math.min(reach(land, side.clone().negate(), 4), reach(land, side.clone().negate(), 14));
      const way = o1 >= o2 ? side.clone().negate() : side.clone(), open = Math.max(o1, o2), back = Math.min(o1, o2);
      if (open < 30 || back < 18) return;
      const foeDir = way.clone();
      const foe = land.clone().addScaledVector(foeDir, Math.min(24, back - 2));
      foe.y = floorAt(foe.x, foe.z, land.y + 0.5);
      const eyeOut = land.clone().addScaledVector(out, -1.5).setY(land.y + 1.5);
      if (!seesWide(eyeOut, foe.clone().setY(foe.y + 1.25))) return;
      // the canopy's glide in: from where it opens down to her feet, nothing in the way (a tower, a tree, a roof)
      const glide = Math.min(FLIGHT.chuteGlide, ((open - 4) * FLIGHT.chuteFall) / 26), top = land.clone().addScaledVector(way, -(FLIGHT.open - 0.5) * (glide / FLIGHT.chuteFall)).setY(land.y + FLIGHT.open);
      if (!sees(top, land.clone().setY(land.y + 1.8)) || !sees(top.clone().add(V(0, 5, 0)), land.clone().setY(land.y + 6.5))) return;
      // Volkov comes down by a gun lying in the open, the street's far way, out of her picture
      const vg = all.filter((x) => { const dd = Math.hypot(x.x - land.x, x.z - land.z); return dd > 55 && dd < 170 && (x.x - land.x) * foeDir.x + (x.z - land.z) * foeDir.z > 20 && !roofOver(V(x.x, x.y, x.z), 25) && !P().water(x.x, x.z); })
        .sort((u, v) => Math.hypot(u.x - foe.x, u.z - foe.z) - Math.hypot(v.x - foe.x, v.z - foe.z))[0];
      if (!vg) return;
      const town = String(near.sort((u, v) => Math.hypot(u.x - at.x, u.z - at.z) - Math.hypot(v.x - at.x, v.z - at.z))[0]?.id ?? '?').split(/[-_:]/)[0];
      const score = near.length * 3 + open + back * 0.5 - off(at.x, at.z) * 0.15;
      if (!best || score > best.score) best = { town, door: i, at, out, inside, gun, land, way, open, foe, foeDir, vgun: vg, glide, score };
    });
    if (!best) {
      say(`the drop: of ${tried} doors in towns near the line, none would do`);
      return null;
    }
    const d = best as Drop & { score: number };
    say(`the drop: ${d.town} (${off(d.at.x, d.at.z).toFixed(0)} m off the line, ${tried} doors looked at); door ${d.door} at ${d.at.x.toFixed(1)},${d.at.y.toFixed(1)},${d.at.z.toFixed(1)}, a ${d.gun.item.id} inside; the street open ${d.open.toFixed(0)} m the way she comes in, Volkov ${flat(d.foe, d.land).toFixed(0)} m the other`);
    return d;
  };

  // ============================================================ 1 · the drop ship over the map; the squad jumps (4.6 s)
  const op1 = new Operator(BRACED, 1, lens(46));
  let tJump = 0, camShip = V(0, 0, 0);
  /** the least the ship's lens looks up, radians: half its picture's height and a little more */
  const lensUp = ((lens(46) / 2 + 2) * Math.PI) / 180;
  add(LEN27.ship, {
    name: 'ship',
    setup: async () => {
      try { localStorage.setItem('zona-howto-seen', '1'); } catch { /* */ }
      const nm = document.querySelector('.start-name') as HTMLInputElement | null;
      if (nm) nm.value = 'Sable';
      void openDoor();
      await run(30);
      (document.querySelector('.door-card.br') as HTMLElement | null)?.click();
      await run(20);
      document.getElementById('door')?.remove();
      void g.join();
      await until(() => !!br()?.me && g.started, 600);
      say(`joined: phase ${phase()} at ${P().pos.x.toFixed(0)},${P().pos.z.toFixed(0)}`);
      for (const n of NAMES) {
        bots.push(new BrBot(url, n, 27));
        plans.push({ goal: null, speed: 1.7, stop: 0.3, air: null, vel: V(0, 0, 0), jumpAt: 0, yaw: 0, land: V(0, 0, 0), way: null, glide: FLIGHT.chuteGlide, shootAt: -1e9, left: false, crouch: false, aim: false, face: null });
        await run(8);
      }
      await until(() => bots.every((b) => b.id >= 0 && b.lobby), 300);
      const w = m.wait;
      bots.forEach((_, i) => {
        const a = (i / bots.length) * Math.PI * 2;
        plans[i].goal = V(w.x + Math.cos(a) * w.r * 0.5, 0, w.z + Math.sin(a) * w.r * 0.5);
      });
      await run(90);
      bots.forEach((b) => b.br({ k: 'vote', yes: true }));
      S.tap('KeyV');
      await until(() => phase() === 'plane' && !!br()?.plane, 60 * 25);
      drop = findDrop();
      if (!drop) throw new Error('no town on the line has a house to loot');
      const d = drop, f = planeDir();
      // where the canopy's last glide begins, and the free fall aimed over it: in along the street
      plans[MIRA].land = d.land.clone();
      plans[MIRA].way = d.way.clone();
      plans[MIRA].glide = d.glide;
      // the moment the ship is abeam of the town: she goes a little before it
      const p = br().plane, Ls = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
      const s = ((d.land.x - p.a[0]) * (p.b[0] - p.a[0]) + (d.land.z - p.a[1]) * (p.b[1] - p.a[1])) / Ls;
      tJump = p.t0 + ((s - 70) / p.speed) * 1000;
      const side = (k: number, r: number) => d.land.clone().addScaledVector(d.way, -r).addScaledVector(d.out, k);
      plans[MIRA].jumpAt = tJump;
      // Volkov and Kestrel down the street's far end, in the open; the other two teams far off, out of the picture
      plans[VOLKOV].jumpAt = tJump + 1100;
      plans[VOLKOV].land = V(d.vgun.x + 1.5, 0, d.vgun.z + 1);
      plans[KESTREL].jumpAt = tJump + 1600;
      plans[KESTREL].land = side(-150, 40);
      plans[OKSANA].jumpAt = tJump - 1400;
      plans[OKSANA].land = side(160, 0);
      plans[BEAR].jumpAt = tJump - 800;
      plans[BEAR].land = side(170, 20);
      plans[DMITRI].jumpAt = tJump + 6000;
      plans[DMITRI].land = side(-220, 0);
      for (const i of [VOLKOV, KESTREL, OKSANA, BEAR, DMITRI]) {
        const q = plans[i].land;
        q.y = floorAt(q.x, q.z, topAt(q.x, q.z));
      }
      bots.forEach((_, i) => (plans[i].air = 'plane'));
      say(`the ship: over the landing ${((tJump + 70000 / p.speed - serverNow()) / 1000).toFixed(1)} s from now, ${(p.y - d.land.y).toFixed(0)} m over it; heading ${(Math.atan2(f.x, f.z) * 57.3).toFixed(0)}`);
      // the lens: ahead of where she goes out, off to the town's side, thirty metres under the ship's height
      const jp = planeAt(tJump)!, toTown = V(d.land.x - jp.x, 0, d.land.z - jp.z), sideK = toTown.dot(V(-f.z, 0, f.x)) >= 0 ? 1 : -1;
      camShip = jp.clone().addScaledVector(f, 14).addScaledVector(V(-f.z, 0, f.x), 12 * sideK).add(V(0, -22, 0));
      await until(() => serverNow() > tJump - 2200, 60 * 90, undefined, 1 / 30);
      op1.reset(camShip, planeAt(serverNow())!);
    },
    cam: (t) => {
      // a spectator's lens parked under the ship's way, ahead of where they go out, looking up at it against the sky
      // (from up here the ground is lost in the haze): it comes over, they go out, she falls past toward the lens
      const ship = planeAt(serverNow()) ?? V(0, 0, 0), k = ease((serverNow() - tJump - 250) / 1300);
      const look = ship.clone().add(V(0, -2, 0)).lerp(bodyOf(MIRA).add(V(0, 1, 0)), k);
      // (always looking up by more than half the picture: below the horizon, from up here, is haze)
      look.y = Math.max(look.y, camShip.y + Math.tan(lensUp) * Math.hypot(look.x - camShip.x, look.z - camShip.z));
      return op1.update(t, camShip, look);
    },
  });

  // ============================================================ 2 · the fall: behind her, the town coming up; the canopy (4.2 s)
  const sp2 = new Spectate(2, lens(50), 0.8, 1.1);
  add(LEN27.fall, {
    name: 'fall',
    setup: async () => {
      if (!drop) return;
      // (on, unseen, to a little over three seconds above the canopy's height)
      await until(() => {
        const p = said(MIRA);
        return plans[MIRA].air !== 'fall' || p.y - floorAt(p.x, p.z, topAt(p.x, p.z)) < FLIGHT.open + 3.1 * FLIGHT.fall;
      }, 60 * 40, undefined, 1 / 30);
      const p = said(MIRA);
      say(`the fall: her ${(p.y - floorAt(p.x, p.z, topAt(p.x, p.z))).toFixed(0)} m up, ${flat(p, plans[MIRA].land).toFixed(0)} m from the street; Sable ${br()?.air ?? 'down'}`);
      sp2.reset();
    },
    cam: (t) => {
      if (!drop) return null;
      // behind and over her, looking past her down at the town; when the canopy opens, down level with her to see it
      const pl = plans[MIRA], heading = fwdOf(pl.yaw), k = pl.air === 'chute' ? 1 : 0;
      // (the canopy whole in the picture: its dome is five metres over her shoulders)
      // (falling, she is in the picture's upper third and the town under her fills the rest)
      const off = heading.clone().multiplyScalar(-6 - 5 * k).add(V(0, 4.5 - 3.5 * k, 0)).addScaledVector(rightOf(pl.yaw), 1.4 + 1.6 * k);
      const look = heading.clone().multiplyScalar(8 - 6 * k).add(V(0, -13 + 15.6 * k, 0));
      return sp2.update(t, bodyOf(MIRA), off, look);
    },
  });

  // ============================================================ 3 · under the canopy, in along the street (4.6 s)
  const sp3 = new Spectate(3, lens(48), 0.6, 1.0);
  add(LEN27.canopy, {
    name: 'canopy',
    setup: async () => {
      if (!drop) return;
      // (on, unseen, to where four and a half seconds of the canopy's fall are left)
      await until(() => {
        const p = said(MIRA);
        return plans[MIRA].air !== 'chute' || p.y - floorAt(p.x, p.z, topAt(p.x, p.z)) < 4.75 * FLIGHT.chuteFall;
      }, 60 * 30, undefined, 1 / 30);
      const p = said(MIRA);
      say(`the canopy: her ${(p.y - floorAt(p.x, p.z)).toFixed(1)} m up, ${flat(p, plans[MIRA].land).toFixed(1)} m from the landing, glide ${plans[MIRA].glide.toFixed(1)} m/s; Sable ${br()?.air ?? 'down'} at ${P().pos.x.toFixed(0)},${P().pos.z.toFixed(0)}`);
      sp3.reset();
    },
    cam: (t) => {
      if (!drop) return null;
      // from behind and to the street's side, a little over her: the canopy, her, and the street she comes into; it
      // comes down with her to a standing man's eye, kept clear of the street's trees
      const d = drop!, w = d.way, body = bodyOf(MIRA), u = ease(t / 4.6);
      const want = body.clone().addScaledVector(w, -10.5).addScaledVector(d.out, 2.6);
      want.y = Math.max(body.y + 2.6 - 1.4 * u, floorAt(want.x, want.z, body.y) + 1.6);
      offTrees(want);
      const look = w.clone().multiplyScalar(6).add(V(0, 1.9 - 1.1 * u, 0));
      return clear(sp3.update(t, body, want.sub(body), look));
    },
  });

  // ============================================================ 4 · down, to the door, open it, a gun, out with it (5.6 s)
  const op4 = new Operator(BRACED, 4, lens(42));
  let landed = -1, atDoor = -1, inAt = -1, took = -1, outAt = -1;
  add(LEN27.loot, {
    name: 'loot',
    setup: async () => {
      if (!drop) return;
      // (to her feet: the canopy's last metre unseen)
      await until(() => plans[MIRA].air === null, 60 * 4);
      const d = drop!;
      landed = atDoor = inAt = took = outAt = -1;
      // to the door, and a stop at it, as a player stops to open one
      plans[MIRA].goal = d.at.clone().addScaledVector(d.out, 0.85);
      plans[MIRA].speed = 5.6;
      plans[MIRA].stop = 0.12;
      // a lens braced in the street behind where she came down, the door in the picture
      const at = offTrees(d.land.clone().addScaledVector(d.way, -5.4).addScaledVector(d.out, 0.9));
      at.y = floorAt(at.x, at.z, d.land.y + 0.5) + 1.6;
      (op4 as Any).at = at;
      op4.reset(at, bodyOf(MIRA).add(V(0, 1.1, 0)));
      say(`the loot: down ${flat(said(MIRA), d.land).toFixed(1)} m from the mark; the lens sees the door ${sees(at, d.at.clone().setY(d.at.y + 1.1), SOLID_GROUPS)}`);
    },
    tick: (t) => {
      if (!drop) return;
      const d = drop!, pl = plans[MIRA], p = said(MIRA);
      if (landed < 0) landed = t;
      if (atDoor < 0 && flat(p, d.at) < 1.0) {
        // the door opened, away from her (as the game swings it), and a moment for it to swing
        atDoor = t;
        const door = g.s.buildings.doors[d.door], local = V(0, 0, 1).applyQuaternion(door.baseQuat);
        bots[MIRA].send({ t: 'door', i: d.door, open: true, swing: local.dot(d.out) > 0 ? -1 : 1 });
        pl.face = d.inside.clone();
      }
      if (atDoor > 0) when(t, atDoor + 0.45, 'in', () => {
        inAt = t;
        pl.face = null;
        pl.goal = d.inside.clone();
        pl.speed = 2.4;
      });
      if (inAt > 0 && took < 0 && flat(p, d.inside) < 0.3) {
        took = t;
        pl.crouch = true;
        pl.face = V(d.gun.x, d.gun.y, d.gun.z);
      }
      if (took > 0) when(t, took + 0.25, 'take', () => takeNear(MIRA));
      if (took > 0) when(t, took + 0.55, 'up', () => {
        pl.crouch = false;
        pl.face = null;
        pl.goal = d.land.clone().addScaledVector(d.out, -2.6);
        pl.speed = 3.4;
        pl.aim = true;
        outAt = t;
      });
    },
    cam: (t) => {
      if (!drop) return null;
      const look = bodyOf(MIRA).add(V(0, 1.15, 0)).lerp(drop!.at.clone().setY(drop!.at.y + 1.2), atDoor > 0 && outAt < 0 ? 0.6 : 0.15);
      return op4.update(t, (op4 as Any).at, look);
    },
    after: (t) => {
      if (t > 5.5) say(`the loot: landed ${landed.toFixed(2)}, at the door ${atDoor.toFixed(2)}, in ${inAt.toFixed(2)}, took ${took.toFixed(2)}, out ${outAt.toFixed(2)}; in her hands ${bots[MIRA].w ?? 'nothing'}`);
    },
  });

  // ============================================================ 5 · Volkov down the street: knocked (4.2 s)
  const sp5 = new Spectate(5, lens(34), 0.9, 1.4);
  let knockedAt = -1;
  /** over her right shoulder, on whoever she is fighting: a longer lens, so he is seen */
  const shoulder = (sp: Spectate, t: number, foe: number) => {
    const mira = bodyOf(MIRA), them = bodyOf(foe), yaw = yawTo(mira, them), f = fwdOf(yaw), r = rightOf(yaw);
    const off = f.clone().multiplyScalar(-2.9).addScaledVector(r, 0.85).add(V(0, 1.82, 0));
    const look = them.clone().sub(mira).add(V(0, 0.9, 0)).lerp(f.clone().multiplyScalar(10).add(V(0, 1.2, 0)), 0.2);
    return clear(sp.update(t, mira, off, look));
  };
  /** short bursts from her, as a player fires them, once she has settled; wide shots from him on the run */
  const duel = (t: number, dt: number, foe: number) => {
    const pl = plans[MIRA];
    pl.face = bodyOf(foe);
    if (bots[foe].me?.knocked || bots[foe].over) return true;
    if (t > 0.5 && Math.floor(t * 2.6) !== Math.floor((t - dt) * 2.6)) fireAt(foe, chestOf(MIRA).add(V(0, 1.7, 0)).addScaledVector(rightOf(pl.yaw), 1.8), 0.25);
    if (t > 0.9 && Math.floor(t * 7) !== Math.floor((t - dt) * 7) && Math.floor(t * 7) % 3 !== 2) fireAt(MIRA, chestOf(foe), 0.018);
    pl.aim = t > 0.55;
    return false;
  };
  add(LEN27.fight, {
    name: 'fight',
    setup: async () => {
      if (!drop) return;
      const d = drop!;
      plans[MIRA].aim = false;
      // (a few seconds on, unseen: she out in the street with her gun, each of the other two armed off the ground)
      await until(() => plans[VOLKOV].air === null && plans[KESTREL].air === null, 60 * 30, undefined, 1 / 30);
      for (const [i, q] of [[VOLKOV, d.vgun], [KESTREL, null]] as [number, Any][]) {
        const at = said(i);
        const gq = q ?? guns().filter((x) => !roofOver(V(x.x, x.y, x.z), 20)).sort((u, v) => Math.hypot(u.x - at.x, u.z - at.z) - Math.hypot(v.x - at.x, v.z - at.z))[0];
        if (!gq) continue;
        plans[i].goal = V(gq.x, 0, gq.z);
        plans[i].speed = 5;
        plans[i].stop = 0.5;
        await until(() => flat(said(i), V(gq.x, 0, gq.z)) < 1.2, 60 * 40, undefined, 1 / 30);
        takeNear(i);
        await run(15, undefined, 1 / 30);
        plans[i].goal = null;
      }
      // Volkov round the far end of the street toward her
      const start = d.foe.clone();
      plans[VOLKOV].goal = start;
      plans[VOLKOV].speed = 5.4;
      plans[VOLKOV].stop = 0.3;
      await until(() => flat(said(VOLKOV), start) < 1, 60 * 60, undefined, 1 / 30);
      plans[VOLKOV].goal = d.land.clone().addScaledVector(d.foeDir, 12).addScaledVector(d.out, 1.5);
      plans[VOLKOV].speed = 4.8;
      plans[MIRA].goal = d.land.clone().addScaledVector(d.out, -1.5);
      plans[MIRA].speed = 1.4;
      plans[MIRA].face = d.foe.clone();
      knockedAt = -1;
      say(`the fight: Volkov ${bots[VOLKOV].w ?? 'empty-handed'} ${flat(said(VOLKOV), said(MIRA)).toFixed(0)} m off; the line from her to him clear ${seesWide(said(MIRA).add(V(0, 1.5, 0)), said(VOLKOV).add(V(0, 1.25, 0)))}`);
      sp5.reset();
    },
    tick: (t, _S, dt) => {
      if (!drop) return;
      if (duel(t, dt, VOLKOV)) {
        if (knockedAt < 0) knockedAt = t;
        plans[VOLKOV].goal = null;
        plans[MIRA].aim = t < knockedAt + 0.8;
      }
    },
    cam: (t) => (drop ? shoulder(sp5, t, VOLKOV) : null),
    after: (t) => {
      if (t > 4.1) say(`the fight: Volkov ${bots[VOLKOV].me?.knocked ? `knocked at ${knockedAt.toFixed(2)}` : 'still up'}`);
    },
  });

  // ============================================================ 6 · Kestrel down the same street, the last of them (2.6 s)
  const sp6 = new Spectate(6, lens(34), 0.9, 1.4);
  let downAt = -1;
  const kestrelDown = () => remoteOf(bots[KESTREL])?.alive === false || !!bots[KESTREL].me?.knocked;
  add(LEN27.last, {
    name: 'last',
    setup: async () => {
      if (!drop) return;
      const d = drop!;
      // two of the other teams out of the match (each leaves it; Dmitri's stays in, far off: an ended match sends everybody
      // back to the waiting area at once); Kestrel, Volkov's mate, comes for her the same way, round the far end unseen
      for (const i of [OKSANA, BEAR]) {
        bots[i].br({ k: 'leave' });
        plans[i].left = true;
      }
      const start = d.land.clone().addScaledVector(d.foeDir, 19).addScaledVector(d.out, -1);
      plans[KESTREL].goal = start;
      plans[KESTREL].speed = 5.4;
      plans[KESTREL].stop = 0.3;
      await until(() => flat(said(KESTREL), start) < 1, 60 * 60, undefined, 1 / 30);
      plans[KESTREL].goal = d.land.clone().addScaledVector(d.foeDir, 7).addScaledVector(d.out, 0.5);
      plans[KESTREL].speed = 4.2;
      plans[MIRA].face = d.foe.clone();
      downAt = -1;
      sp6.reset();
      say(`the last: Kestrel ${bots[KESTREL].w ?? 'empty-handed'} ${flat(said(KESTREL), said(MIRA)).toFixed(0)} m off; the line clear ${seesWide(said(MIRA).add(V(0, 1.5, 0)), said(KESTREL).add(V(0, 1.25, 0)))}`);
    },
    tick: (t, _S, dt) => {
      if (!drop) return;
      if (kestrelDown()) {
        if (downAt < 0) downAt = t;
        plans[KESTREL].goal = null;
        plans[MIRA].aim = t < downAt + 0.8;
      } else duel(t, dt, KESTREL);
    },
    cam: (t) => (drop ? shoulder(sp6, t, KESTREL) : null),
    after: (t) => {
      if (t > LEN27.last - 0.1) say(`the last: Kestrel ${kestrelDown() ? `down at ${downAt.toFixed(2)}` : 'still up'}`);
    },
  });

  // ============================================================ 7 · her, from in front: the gun down; the game's #1 (3.4 s)
  // (from where Kestrel fell, looking back at her: the game hides a player who is out a moment after he drops, and his
  // things spill where he lay; that is behind this lens)
  const op7 = new Operator(BRACED, 7, lens(44));
  add(LEN27.win, {
    name: 'win',
    hud: true,
    setup: async () => {
      if (!drop) return;
      await until(() => kestrelDown(), 60 * 3);
      plans[MIRA].goal = null;
      plans[MIRA].face = null;
      const mira = said(MIRA), f = drop!.foeDir, r = rightOf(yawTo(mira, mira.clone().add(f)));
      const at = offTrees(mira.clone().addScaledVector(f, 5.4).addScaledVector(r, -1.4));
      at.y = floorAt(at.x, at.z, mira.y + 0.5) + 1.6;
      (op7 as Any).at = at;
      op7.reset(at, mira.clone().setY(mira.y + 1.5));
      // the last of them down: the game's own end, as it shows the winners theirs
      br()?.hud?.over({ k: 'over', board: [], winners: ['Sable', 'Mira'] }, true);
      say(`the win: the lens ${mira.distanceTo(at).toFixed(1)} m in front of her; Kestrel ${remoteOf(bots[KESTREL])?.alive === false ? 'down' : 'up?'}`);
    },
    tick: (t) => {
      if (!drop) return;
      // the gun comes down a moment after; a look along the street
      plans[MIRA].aim = t < 0.35;
      if (t > 1.1) plans[MIRA].face = said(MIRA).addScaledVector(rightOf(plans[MIRA].yaw), 6).addScaledVector(drop!.foeDir, 4);
    },
    cam: (t) => (drop ? op7.update(t, (op7 as Any).at, bodyOf(MIRA).add(V(0, 1.5, 0))) : null),
  });

  say(`${shots.length} shots, ${total.toFixed(1)} s on map ${m.name}${TALL ? ', upright' : ''}`);
  return shots;
}
