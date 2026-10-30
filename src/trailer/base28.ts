// The base of the twenty-eighth film, laid by the game's own rules (Bases.lay, snap.ts spots): every piece goes where a
// player's could go, in the order a player would, on the meadow north of Pokrov with the pines round it.
import * as THREE from 'three';
import { deployAt, leanAt, spots, toWorld, type Base, type Piece } from '../sim/build/snap';
import { CELL, STOREY, type Tier } from '../sim/build/pieces';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** the ground: pines round it and the cliffs behind (found by scout28.ts) */
export const SITE = { x: -1772, z: -668, yaw: 0.35 };

const GROUND: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]];
/** the tower over the back of the house */
const TOWER: [number, number][] = [[2, 0], [3, 0], [2, 1], [3, 1]];
const OVER: [number, number][] = GROUND.filter(([i, j]) => !TOWER.some(([a, b]) => a === i && b === j));

export class Base28 {
  base: Base | null = null;
  private B: Any;
  constructor(g: Any, private say: (s: string) => void) {
    this.B = g.build;
  }
  /** a place in the base's own measure, in the world */
  at(x: number, y: number, z: number) {
    const [wx, wy, wz] = toWorld(this.base!, x, y, z);
    return new THREE.Vector3(wx, wy, wz);
  }
  private put(k: string, x: number, y: number, z: number, r: number, t?: Tier): Piece | null {
    const B = this.B, b = this.base!;
    const res = B.local.lay({ b: b.id, k, x, y, z, r }, B.me, Date.now(), 'Sable', true);
    if (typeof res === 'string') {
      this.say(`${k} at ${x},${y},${z}: ${res}`);
      return null;
    }
    if (t !== undefined && t > res.piece.t) this.tier(res.piece.id, t);
    B.draw.put(res.base, res.piece);
    B.synced(res.base);
    return res.piece;
  }
  tier(id: number, t: Tier) {
    const B = this.B, b = this.base!, p = b.pieces.get(id)!;
    p.t = t;
    p.hp = 2000;
    B.draw.put(b, p);
  }
  /** nothing left of it */
  clear() {
    const B = this.B, b = this.base;
    if (!b) return;
    B.draw.remove(b.id, [...b.pieces.keys()]);
    B.local.bases.delete(b.id);
    B.claims?.forget?.(b.id);
    B.boxes?.forget?.(b.id);
    this.base = null;
  }
  /** the first foundation */
  begin() {
    this.clear();
    const B = this.B;
    const res = B.local.lay({ k: 'foundation', x: SITE.x, y: NaN, z: SITE.z, r: 0, yaw: SITE.yaw }, B.me, Date.now(), 'Sable', true);
    if (typeof res === 'string') throw new Error(`no first foundation: ${res}`);
    this.base = res.base;
    B.draw.put(res.base, res.piece);
    B.synced(res.base);
  }
  private lay1(k: string, x: number, y: number, z: number, t?: Tier, turn = 0) {
    const b = this.base!, s = spots(b, k, turn).find((q) => Math.abs(q.x - x) < 0.05 && Math.abs(q.y - y) < 0.05 && Math.abs(q.z - z) < 0.05);
    if (!s) return void this.say(`no place for ${k} at ${x},${y},${z}`);
    return this.put(k, s.x, s.y, s.z, s.r, t);
  }
  /** a kind of thing set down on the floor under a place */
  thing(k: string, x: number, y: number, z: number, turn = 0) {
    const s = deployAt(this.base!, k, { x, y: y + 0.1, z }, turn);
    if (!s) return void this.say(`no floor for ${k} at ${x},${y},${z}`);
    return this.put(k, s.x, s.y, s.z, s.r);
  }
  torch(x: number, y: number, z: number) {
    const s = leanAt(this.base!, 'torch_wall', { x, y, z });
    if (!s) return void this.say(`no wall for a torch at ${x},${y},${z}`);
    return this.put('torch_wall', s.x, s.y, s.z, s.r);
  }
  /** the walls round the cells of a level, each kind by `pick` (its side, its place along that side) */
  private walls(cells: [number, number][], y: number, t: Tier, pick: (side: number, along: number) => string) {
    const has = (i: number, j: number) => cells.some(([a, b]) => a === i && b === j);
    for (const [i, j] of cells) {
      for (const [di, dj, side] of [[1, 0, 0], [0, 1, 1], [-1, 0, 2], [0, -1, 3]] as const) {
        if (has(i + di, j + dj)) continue;
        this.lay1(pick(side, side % 2 ? i : j), (i + di / 2) * CELL, y, (j + dj / 2) * CELL, t);
      }
    }
  }
  /** a row of walls through the house, with a way through it */
  private inner(z: number, y: number, t: Tier, gap: number) {
    for (const i of [0, 1, 2, 3]) this.lay1(i === gap ? 'doorway' : 'wall', i * CELL, y, z, t);
  }
  private floors(cells: [number, number][], y: number, k: string, t: Tier) {
    for (const [i, j] of cells) this.lay1(k, i * CELL, y, j * CELL, t);
  }
  /** three bays of a base's first floor, a wall behind them: the bench, the forge and the rack, in the daylight */
  workshop() {
    this.begin();
    for (const i of [1, 2]) this.lay1('foundation', i * CELL, 0, 0, 2);
    for (const p of this.base!.pieces.values()) if (p.k === 'foundation') this.tier(p.id, 2);
    for (const i of [0, 1, 2]) this.lay1('wall', i * CELL, 0, -CELL / 2, 2);
    this.thing('workbench', 0, 0, -0.45, 6);
    this.thing('forge', CELL, 0, -0.5);
    this.thing('weapon_rack', CELL * 2, 0, -0.95, 0);
  }
  /** the whole house as batches, one for each beat of the shot that raises it */
  batches(): (() => void)[] {
    return [
      () => { for (const [i, j] of GROUND) if (i || j) this.lay1('foundation', i * CELL, 0, j * CELL); },
      () => this.walls(GROUND, 0, 2, (side, at) => (side === 1 && at === 1 ? 'doorway' : side === 3 ? 'wall' : at % 2 ? 'window' : 'wall')),
      () => { this.inner(CELL * 0.5, 0, 1, 1); this.inner(CELL * 1.5, 0, 1, 2); },
      () => this.floors(GROUND, STOREY, 'floor', 1),
      () => this.walls(GROUND, STOREY, 2, (_side, at) => (at % 2 ? 'window' : 'wall')),
      () => { this.inner(CELL * 0.5, STOREY, 1, 2); this.inner(CELL * 1.5, STOREY, 1, 2); },
      () => this.floors(OVER, STOREY * 2, 'roof', 3),
      () => this.floors(TOWER, STOREY * 2, 'floor', 3),
      () => this.walls(TOWER, STOREY * 2, 3, (_side, at) => (at % 2 ? 'wall' : 'window')),
      () => this.floors(TOWER, STOREY * 3, 'roof', 3),
    ];
  }
  /** the fittings and what stands in it */
  fit() {
    this.lay1('door_metal', CELL, 0, CELL * 2.5, undefined);
    this.thing('claim', CELL * 0.1, 0, CELL * 1.05);
    this.thing('workbench', CELL * 2.6, 0, CELL * 1.05, 6);
    this.thing('forge', CELL * 3.2, 0, CELL * 2.05);
    this.thing('weapon_rack', CELL * -0.1, 0, CELL * 2.1, 3);
    this.thing('box_large', CELL * 0.9, 0, CELL * 0.1);
    this.thing('bed', CELL * 2.9, STOREY, CELL * -0.1);
    const b = this.base!;
    if (b.claim) b.claim.until = -1;
    this.B.synced(b);
    // torches on the front wall, either side of the door, and by the rack
    this.torch(CELL * 0.45, 1.6, CELL * 2.5 + 0.12);
    this.torch(CELL * 1.55, 1.6, CELL * 2.5 + 0.12);
    this.torch(CELL * 0.5, 1.6, CELL * 2.5 - 0.12);
    this.torch(CELL * 2.5, 1.6, CELL * 1.5 - 0.12);
  }
  whole() {
    for (const b of this.batches()) b();
    this.fit();
  }
  /** what stands, by kind: said for the film's notes */
  tally() {
    const n: Record<string, number> = {};
    for (const p of this.base?.pieces.values() ?? []) n[p.k] = (n[p.k] ?? 0) + 1;
    return n;
  }
}
