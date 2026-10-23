// The gameplay trailer's set (shots26.ts): the ground and what stands in the way, the jeep on its road with friends in
// the back and the helicopter told where it is, the infected with their own minds, and the house in Pokrov whose
// floor the rifle is laid on. Made from the twenty-first film's jeep, the fourteenth's helicopter and infected.
import * as THREE from 'three';
import type { CamPose, Stage } from './director';
import { wrap, yawTo } from './human';
import { physics, SIGHT_GROUPS, SOLID_GROUPS } from '../core/physics';
import { SEAT_AT } from '../game/garage';
import { HELI } from '../sim/heli';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const fwdOf = (yaw: number) => V(-Math.sin(yaw), 0, -Math.cos(yaw));

/** the ground and what stands in the way, by the physics (what is drawn and walked: the height table is up to 2 m off it) */
export function ground26(S: Stage) {
  const floorAt = (x: number, z: number, near?: number) => {
    const from = (near ?? S.ground(x, z)) + 1.5;
    const hit = physics.raycast({ x, y: from, z }, { x: 0, y: -1, z: 0 }, 8, SOLID_GROUPS);
    return hit ? from - hit.toi : S.ground(x, z);
  };
  const roofOver = (p: THREE.Vector3, up = 12) => !!physics.raycast({ x: p.x, y: p.y + 0.3, z: p.z }, { x: 0, y: 1, z: 0 }, up, SOLID_GROUPS);
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
  /** how far open ground runs from a point along a way, at a height */
  const reach = (p: THREE.Vector3, dir: THREE.Vector3, up: number, most = 60) => physics.raycast({ x: p.x, y: p.y + up, z: p.z }, dir.clone().setY(0).normalize(), most, SIGHT_GROUPS)?.toi ?? most;
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
  const pl = (x: number, z: number) => V(x, S.ground(x, z), z);
  /** a lens is never under the ground or inside a roof: lifted clear of what is under it */
  const clear = (c: CamPose) => {
    const f = floorAt(c.p.x, c.p.z, c.p.y);
    if (c.p.y < f + 0.9) c.p.y = f + 0.9;
    return c;
  };
  return { floorAt, roofOver, sees, seesWide, reach, offTrees, pl, clear };
}

/** the jeep, its wheel and its pedals (the twenty-first film's driver), the friends in its back, and the MD-500 */
export class Drive26 {
  J: Any = null;
  H: Any = null;
  at = 0;
  cruise = 13;
  stopAt = Infinity;
  /** the main road through Pokrov, west to east (road 9, as shots21 found it), on east past the town */
  readonly ROUTE: THREE.Vector3[];
  private snapped = new Set<Any>();
  constructor(private S: Stage, private say: (s: string) => void) {
    const p = S.world.roads[9].points as Float32Array, r9: THREE.Vector3[] = [];
    for (let k = 0; k < p.length; k += 3) r9.push(V(p[k], p[k + 1], p[k + 2]));
    r9.reverse();
    this.ROUTE = r9.slice(this.nearest(r9, -1960, 39));
  }
  private nearest(pts: THREE.Vector3[], x: number, z: number) {
    let best = 1e18, bi = 0;
    pts.forEach((q, i) => {
      const d = (q.x - x) ** 2 + (q.z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    });
    return bi;
  }
  R = (x: number, z: number) => this.nearest(this.ROUTE, x, z);
  pickJeep = () => {
    const g = this.S.g as Any;
    const all = [...g.garage.jeeps.values()].filter((j: Any) => !j.wreck && j.kind !== HELI.kind);
    const by = (j: Any) => Math.hypot(j.pos.x + 1900, j.pos.z - 40) + (j.kind ? 1e4 : 0);
    all.sort((a: Any, b: Any) => by(a) - by(b));
    this.J = all[0];
    if (!this.J) throw new Error('no jeep in the world');
  };
  pickHeli = () => {
    const g = this.S.g as Any;
    this.H = [...g.garage.jeeps.values()].find((j: Any) => j.kind === HELI.kind) ?? null;
    if (!this.H) this.say('no MD-500 in the world');
  };
  /** the jeep stood at a point of the way, facing along it, going at v */
  putJeep = (k: number, v: number) => {
    const R = this.ROUTE, a = R[k], b = R[Math.min(R.length - 1, k + 3)], yaw = yawTo(a, b), f = fwdOf(yaw);
    this.J.place([a.x, a.y + 0.85, a.z, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2), f.x * v, 0, f.z * v, 0, 0]);
    this.J.hp = 5400;
    this.J.fuel = 40;
    this.at = k;
  };
  /** at the wheel: sat in from its door */
  board = () => {
    const g = this.S.g as Any, J = this.J;
    if (g.garage.ride) return;
    const door = J.point(-1.9, 0, 0.2, new THREE.Vector3());
    this.S.me(door.x, door.z, J.yaw, 0);
    g.garage.use(J);
    if (!g.garage.ride) this.say('could not get in');
  };
  /** the two friends in the back, as riders are drawn (the fourth film's way) */
  friends = (on: boolean) => {
    for (const [k, i] of [[1, 1], [2, 2]] as [number, number][]) {
      const a = this.S.actor(i);
      if (!on) {
        (a.rp as Any).seat = null;
        a.hide();
        continue;
      }
      (a.rp as Any).seat = { jeep: this.J, at: SEAT_AT[k] };
      a.pos.copy(this.J.pos);
      a.yaw = this.J.yaw;
    }
  };
  /**
   * A driver on a keyboard: the side the road goes is held while it goes on, a lift off the throttle for a bend taken
   * too fast, and the brake brought on early enough to stop where he means to.
   */
  wheel = () => {
    const g = this.S.g as Any, J = this.J, R = this.ROUTE, S = this.S;
    if (!J || !g.garage.ride) return;
    const dist2 = (a: THREE.Vector3, b: THREE.Vector3) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
    while (this.at < R.length - 2 && dist2(R[this.at + 1], J.pos) < dist2(R[this.at], J.pos)) this.at++;
    let k = this.at, d = 0;
    const want = 6 + Math.abs(J.speed) * 0.6;
    while (k < R.length - 1 && d < want) {
      d += flat(R[k], R[k + 1]);
      k++;
    }
    const err = wrap(yawTo(J.pos, R[k]) - J.yaw);
    S.key('KeyA', err > 0.035);
    S.key('KeyD', err < -0.035);
    let left = Infinity;
    if (this.stopAt < R.length) {
      left = 0;
      for (let i = this.at; i < this.stopAt; i++) left += flat(R[i], R[i + 1]);
      if (this.at >= this.stopAt) left = 0;
    }
    const v = Math.abs(J.speed), stopping = left < (v * v) / 10 + 2.5, hot = Math.abs(err) > 0.35 && v > 8;
    S.key('KeyW', !hot && !stopping && v < this.cruise);
    S.key('KeyS', (hot || stopping) && v > 0.6);
  };
  /** a helicopter told where it is, as another game's is shown (the fourteenth film's way) */
  fly = (j: Any, p: THREE.Vector3, yaw: number, pitch = 0, roll = 0, v = new THREE.Vector3(), rpm = 1) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    const st = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, rpm, rpm > 0 ? 0.7 : 0];
    if (j.mode !== 'follow' || !this.snapped.has(j)) {
      this.snapped.add(j);
      j.place(st);
      j.mode = 'follow';
    }
    j.push(st, performance.now(), performance.now());
  };
}

/** the infected, the fourteenth film's own, minds and all: made once, put where a shot wants them, woken, dropped */
export class Infected26 {
  zeds: Any[] = [];
  constructor(private S: Stage, private wait: (ms: number) => Promise<void>) {}
  private get horde() { return (this.S.g as Any).horde as Any; }
  troupe = async () => {
    const horde = this.horde, zeds = this.zeds;
    if (zeds.length) return;
    horde.clear();
    if (!horde.director) horde.alone();
    const dir = horde.director;
    dir.bodies.clear();
    dir.due = [];
    dir.tick = () => ({ added: [], gone: [], owned: [] });
    const me = horde.host.me().id;
    for (let n = 0; n < 4; n++) {
      const i = 3100 + n, info = { i, s: [0, -300, 0, 0, 0, 0], hp: 90, own: me, h: [0, 0] };
      dir.bodies.set(i, { ...info, home: 0, diedAt: 0, heard: 0, struck: 0 });
      horde.add(info);
      zeds.push(horde.all.get(i));
    }
    for (let k = 0; k < 600 && zeds.some((z) => !z.ready || !z.mine); k++) await this.wait(25);
  };
  putZ = (z: Any, p: THREE.Vector3, yaw: number, senses: boolean) => {
    if (!z) return;
    z.pos.copy(p);
    z.fallTo = p.y;
    z.home.copy(p);
    const body = this.horde.director.bodies.get(z.i);
    body.s[0] = p.x;
    body.s[1] = p.y;
    body.s[2] = p.z;
    body.heard = performance.now();
    z.mode = 0;
    z.after = 0;
    z.waitT = 999;
    z.yaw = yaw;
    z.gait = 0;
    z.stopT = 0;
    z.strikeAt = 0;
    z.seenAt = -1e9;
    z.lost();
    z._think ??= z.think;
    z.think = senses ? z._think : () => {};
    if (z.avatar.sick) z.avatar.sick.claw = -1;
  };
  awake = (z: Any) => {
    z.think = z._think;
    this.horde.director.bodies.get(z.i).heard = performance.now();
  };
  away = () => {
    for (const z of this.zeds) this.putZ(z, V(0, -300, 0), 0, false);
  };
  /** one of them down, as the game drops them: the blood, the director told, the fall */
  dropZ = (z: Any, from: THREE.Vector3) => {
    if (z.dead) return;
    const head = V(z.pos.x, z.pos.y + 1.55, z.pos.z), d = head.clone().sub(from).normalize();
    (this.S.g as Any).effects.bleed(head, d, 1);
    this.horde.director.hurt(z.i, 999, performance.now());
    z.die(2);
  };
}

/** a house of Pokrov's lane: its door, the way out of it, a step in, where the rifle lies, the street in front and along it */
export interface House26 { door: THREE.Vector3; out: THREE.Vector3; inside: THREE.Vector3; gun: THREE.Vector3; gunId: string; front: THREE.Vector3; runIn: THREE.Vector3; street: THREE.Vector3; open: number }

/** the house of a lane (around cx, cz) with a ground-floor door onto it and clear floor just inside (where the film's rifle is laid) */
export function findHouse26(S: Stage, cx: number, cz: number, lane: number, say: (s: string) => void): House26 | null {
  const g = S.g as Any, { floorAt, roofOver, sees, reach } = ground26(S);
  const doors = g.s.buildings.doors as Any[];
  const why = { doors: 0, sides: 0, floor: 0, street: 0, open: 0 };
  let best: (House26 & { score: number }) | null = null;
  for (const d of doors) {
    const w = d.size?.[0] ?? 0.9;
    if (w < 0.8) continue;
    const q = d.baseQuat as THREE.Quaternion, hinge = d.pivot.position as THREE.Vector3;
    const at = hinge.clone().addScaledVector(V(1, 0, 0).applyQuaternion(q), w / 2);
    if (Math.hypot(at.x - cx, at.z - cz) > 120) continue;
    why.doors++;
    const n = V(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    const a = at.clone().addScaledVector(n, 2.2), b = at.clone().addScaledVector(n, -2.2);
    a.y = floorAt(a.x, a.z, at.y + 0.2);
    b.y = floorAt(b.x, b.z, at.y + 0.2);
    const ra = roofOver(a), rb = roofOver(b);
    if (ra === rb || Math.abs(a.y - b.y) > 0.4) { why.sides++; continue; }
    const out = ra ? n.clone().negate() : n.clone(), inside = at.clone().addScaledVector(out, -1.2);
    inside.y = floorAt(inside.x, inside.z, at.y + 0.2);
    // where the rifle lies: a table top within three metres in, in sight from the doorway (a rifle off a table is seen
    // and taken at a man's height); else the floor three and a half metres in, level and clear
    const eyeIn = at.clone().addScaledVector(out, -0.6).setY(inside.y + 1.55);
    let gun: THREE.Vector3 | null = null, table = false;
    const side0 = V(-out.z, 0, out.x);
    for (const [dd, l] of [[1.8, 0], [2.2, 0], [1.8, 0.8], [1.8, -0.8], [2.6, 0], [2.2, 1], [2.2, -1], [2.8, 0.8], [2.8, -0.8]] as [number, number][]) {
      const p = at.clone().addScaledVector(out, -dd).addScaledVector(side0, l);
      const hit = physics.raycast({ x: p.x, y: inside.y + 1.6, z: p.z }, { x: 0, y: -1, z: 0 }, 1.6, SOLID_GROUPS);
      const top = hit ? inside.y + 1.6 - hit.toi : inside.y;
      if (top - inside.y < 0.62 || top - inside.y > 1.02) continue;
      // (a top, not an edge: the same height a hand's breadth all round)
      const flatTop = [V(0.18, 0, 0), V(-0.18, 0, 0), V(0, 0, 0.18), V(0, 0, -0.18)].every((v) => {
        const h2 = physics.raycast({ x: p.x + v.x, y: inside.y + 1.6, z: p.z + v.z }, { x: 0, y: -1, z: 0 }, 1.6, SOLID_GROUPS);
        return h2 && Math.abs(inside.y + 1.6 - h2.toi - top) < 0.02;
      });
      if (!flatTop || !sees(eyeIn, p.clone().setY(top + 0.08), SOLID_GROUPS)) continue;
      gun = p.setY(top);
      table = true;
      break;
    }
    if (!gun) {
      gun = at.clone().addScaledVector(out, -3.4);
      gun.y = floorAt(gun.x, gun.z, at.y + 0.2);
      const low = (p: THREE.Vector3, dir: THREE.Vector3, len: number) => !physics.raycast({ x: p.x, y: p.y + 0.35, z: p.z }, dir, len, SOLID_GROUPS);
      const g2 = gun;
      if (Math.abs(g2.y - inside.y) > 0.08 || !low(at.clone().setY(inside.y), out.clone().negate(), 4.1) || ![V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)].every((v) => low(g2, v, 0.6))) { why.floor++; continue; }
    }
    // the street in front: open each way along it (he runs in along one; the infected come along the other)
    const front = at.clone().addScaledVector(out, 2.4);
    front.y = floorAt(front.x, front.z, at.y + 0.3);
    if (roofOver(front, 20)) { why.street++; continue; }
    const side = V(-out.z, 0, out.x);
    const r1 = reach(front, side, 1.4), r2 = reach(front, side.clone().negate(), 1.4);
    const street = r1 >= r2 ? side.clone() : side.clone().negate(), open = Math.max(r1, r2), back = Math.min(r1, r2);
    if (open < 30 || back < 14) { why.open++; continue; }
    const runIn = street.clone().negate();
    const score = open + back * 0.5 + (Math.abs(front.z - lane) < 8 ? 20 : 0) + (table ? 40 : 0);
    if (!best || score > best.score) best = { door: at, out, inside, gun, gunId: table ? 'table' : 'floor', front, runIn, street, open, score };
  }
  say(`the house near ${cx},${cz}: doors ${why.doors}, no street side ${why.sides}, floor taken ${why.floor}, roofed ${why.street}, street too short ${why.open}${best ? `: the door at ${best.door.x.toFixed(1)},${best.door.z.toFixed(1)}, the street open ${best.open.toFixed(0)} m, the rifle on the ${best.gunId}` : ''}`);
  return best;
}
