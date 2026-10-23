// The gameplay trailer's Arena (shots26.ts): one round at the fort, as the eleventh film made the Arena (shots11.ts:
// its measure of the fort, blue's two up the ramp and in at the gate, red on the keep's landing, and over it all the
// Arena's own screen, src/ui/arena-hud.ts, fed what a match feeds it), seen from a crane rising in front of the ramp.
// Two against two on the Assault loadout as arena/rules.ts hands it out: an AR-15 each with a red dot, a grip and a light.
import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import { DRONE, Operator, yawTo } from './human';
import { physics, SOLID_GROUPS } from '../core/physics';
import { CASTLE, CASTLE_SCALE, castleAt, castleLocal, type FortPlace } from '../sim/castle';
import { ArenaHud } from '../ui/arena-hud';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Add = (len: number, s: Omit<Shot, 'start' | 'end'> & { hour?: number; leadTick?: boolean }) => void;
interface Help {
  lens: (f: number) => number;
  say: (s: string) => void;
  chipSay: (t: number, from: number, to: number, big: string, small: string) => void;
  run: (frames: number, each?: (k: number) => void) => Promise<void>;
  wait: (ms: number) => Promise<void>;
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

export function arenaShot(S: Stage, add: Add, h: Help) {
  const g = S.g as Any, world = S.world as Any, FP = world.castle as FortPlace;
  const overlay = document.getElementById('tr-overlay')!;
  const A = (i: number) => S.actors[i];
  // ------------------------------------------------------------ the fort's own measure (shots11.ts)
  const K = CASTLE_SCALE, C = CASTLE;
  const F = (x: number, z: number, y = 0) => {
    const [wx, wy, wz] = castleAt(FP, x, z, y);
    return new THREE.Vector3(wx, wy, wz);
  };
  const m = (metres: number) => metres / K;
  const under = (p: THREE.Vector3, up = 1.2, far = 30): number | null => {
    const hit = physics.raycast({ x: p.x, y: p.y + up, z: p.z }, { x: 0, y: -1, z: 0 }, up + far, SOLID_GROUPS);
    return hit ? p.y + up - hit.toi : null;
  };
  const G = (x: number, z: number, up = 0) => {
    const p = F(x, z, 0), y = under(p, 30, 90) ?? S.ground(p.x, p.z);
    return p.setY(y + up);
  };
  const P = C.parapet, ex = C.hx + P.thick / 2, gz = (C.gate.z0 + C.gate.z1) / 2;
  const RUN = Math.sqrt(C.ramp.len ** 2 - C.ramp.drop ** 2), rx = ex + RUN;
  const rampY = (x: number) => -C.ramp.drop * clamp01((x - ex) / RUN);
  interface Rail { len: number; at: (s: number) => THREE.Vector3 }
  const rail = (pts: THREE.Vector3[]): Rail => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    c.arcLengthDivisions = 800;
    const len = c.getLength();
    return { len, at: (s) => c.getPointAt(clamp01(s / len)) };
  };
  // blue's two ways: up the open ground, the ramp's boards, in at the gate (the eleventh film's)
  let ways: Rail[] = [];
  const makeWays = () => {
    const up = (z: number) => [G(rx + 10, z - 0.2), G(rx + 5.5, z - 0.1), G(rx + 1.6, z), F(rx - 1, z, rampY(rx - 1)), F(14.5, z, rampY(14.5)), F(11.5, z, rampY(11.5))];
    ways = [
      rail([...up(gz - 0.42), F(ex, gz - 0.3), F(9.3, gz - 0.3), F(8.4, gz - 0.45), F(7.3, gz - 0.75), F(6.8, -3.5), F(6.9, -5.1), F(7.2, -7.2)]),
      rail([...up(gz + 0.42), F(ex + 0.3, gz + 0.1), F(9.4, gz - 0.2), F(8.5, gz + 0.1), F(7.9, gz + 0.7), F(7.7, gz + 1.25)]),
    ];
  };
  const feet = new Map<Rail, number>();
  const footOf = (R: Rail) => {
    let s = feet.get(R);
    if (s !== undefined) return s;
    for (s = 0; s < R.len; s += 0.05) {
      const p = R.at(s);
      if (castleLocal(FP, p.x, p.y, p.z)[0] <= rx) break;
    }
    feet.set(R, s);
    return s;
  };
  const onWay = (a: Actor, R: Rail, s: number) => {
    const c = Math.min(R.len - 0.05, Math.max(0, s)), p = R.at(c), q = R.at(Math.min(R.len, c + 0.45)), b = R.at(Math.max(0, c - 0.45));
    a.pos.copy(p);
    a.yaw = yawTo(b, q);
    a.pitch = 0;
    return s >= R.len - 0.05;
  };
  /** blue's two, `t` seconds after the first was `back` metres short of the ramp's boards, going at `v` */
  const storm = (t: number, v: number, back: number) => {
    for (const k of [0, 1]) {
      const a = A(k), done = onWay(a, ways[k], footOf(ways[k]) - back - k * 1.9 + v * t);
      a.sprint = v > 5 && !done;
      a.aim = false;
      a.crouch = done && k === 1;
    }
  };
  const fire = (a: Actor, at: THREE.Vector3) => {
    if (!a.weapon || !a.alive) return;
    const o = a.eye();
    g.weapons.remoteShot(o, at.clone().sub(o).normalize(), a.weapon, false, a.rp.muzzle(), a.rp);
  };
  const GUN = 'ar15', MODS = ['red_dot', 'foregrip', 'gun_light'];
  const stand = (a: Actor, p: THREE.Vector3, yaw: number) => {
    a.place(p.x, p.z, yaw, GUN, []);
    a.pos.y = p.y;
    a.rp.setWeapon(GUN, MODS);
  };
  // ------------------------------------------------------------ the Arena's screen: score bar, banners, kill feed
  let screen: ArenaHud | null = null;
  const sides = (): [string, string] => [`${A(0).name} & ${A(1).name}`, `${A(2).name} & ${A(5).name}`];
  const board = () => [
    { name: A(0).name, ours: true, kills: 0, deaths: 0 }, { name: A(1).name, ours: true, kills: 0, deaths: 0 },
    { name: A(2).name, ours: false, kills: 0, deaths: 0 }, { name: A(5).name, ours: false, kills: 0, deaths: 0 },
  ];
  const says = (round: number, us: number, them: number, up: [number, number]) =>
    screen?.score({ t: 'score', round, us, them, first: 5, up, phase: 'live', sides: sides(), board: board() } as Any);

  // ------------------------------------------------------------ the shot
  const fired = new Set<string>();
  const once = (key: string, t: number, at: number, fn: () => void) => {
    if (t >= at && !fired.has(key)) {
      fired.add(key);
      fn();
    }
  };
  /** blue up the ramp and in; Bear on the keep's landing with his rifle on them; Mira sees him and fires first */
  const play = (t: number) => {
    storm(t + 0.4, 5.6, 7.5);
    const bear = A(5), mira = A(1), on = A(0).rp.pos;
    if (bear.alive) bear.face(new THREE.Vector3(on.x, on.y + 1.2, on.z));
    if (t > 2.3) mira.face(bear.alive ? bear.chest() : bear.pos.clone().setY(bear.pos.y + 0.4));
    mira.aim = t > 2.35;
    once('bear', t, 2.4, () => fire(bear, A(0).chest().add(new THREE.Vector3(0, 1.6, 0))));
    for (const [i, at] of [2.55, 2.68, 2.81].entries()) once(`mira${i}`, t, at, () => fire(mira, bear.chest()));
    once('down', t, 2.84, () => {
      bear.die(bear.chest().sub(mira.eye()).normalize());
      screen?.kill({ t: 'kill', by: mira.name, who: bear.name, w: GUN, head: false, ours: true, me: false } as Any);
      says(1, 0, 0, [2, 1]);
    });
  };
  const op = new Operator(DRONE, 260, h.lens(46));
  let from = new THREE.Vector3(), to = new THREE.Vector3();
  add(4.5, {
    name: 'arena',
    hour: 0.42,
    setup: async () => {
      S.parkMe();
      if (screen) screen.destroy();
      screen = new ArenaHud(overlay, false, false);
      makeWays();
      fired.clear();
      for (const k of [0, 1]) stand(A(k), ways[k].at(0), 0);
      const landing = F(C.keep.x1 + 0.85, 0.15, C.keep.floors[1]);
      stand(A(5), landing, yawTo(landing, F(ex - 1, gz, 0)));
      A(5).aim = true;
      A(2).hide();
      await h.run(60);
      // a crane on the open ground before the ramp, off to its side, rising as they go up it
      from = G(rx + 11, gz - 7, m(2.6));
      to = G(rx + 8, gz - 5, m(6.5));
      h.say(`the arena: the crane ${from.distanceTo(F(ex, gz, 0)).toFixed(0)} m from the gate`);
      op.reset(from, F(rx, gz, m(1.2)));
      for (let i = 0; i < 36; i++) {
        play(-0.6 + i / 60);
        for (const a of S.actors) a.push();
        await h.run(1);
      }
      fired.clear();
      says(1, 0, 0, [2, 2]);
    },
    lead: (t) => play(t),
    tick: (t) => play(t),
    cam: (t): CamPose => {
      const u = ease(t / 4.5), look = F(rx - 2, gz, rampY(rx - 2) + m(1.4)).lerp(F(ex + 1, gz, m(2.6)), ease((t - 0.8) / 2.4));
      return op.update(t, from.clone().lerp(to, u), look);
    },
    after: (t) => {
      screen?.tick(100, GUN, 31, 31, false, false);
      h.chipSay(t, 0.6, 3.9, 'ARENA', 'team rounds at the fort · 1v1 to 3v3');
      if (t > 4.45 && screen) {
        screen.destroy();
        screen = null;
      }
    },
  });
}
