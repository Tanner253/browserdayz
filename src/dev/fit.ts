// Fitting what is worn on the chest to the body, by measure and not by eye (dev only).
//
//   await import('/src/dev/fit.ts?v=' + Date.now())      (after T.boot())
//   await F.stand()                  one body to fit things on, where the player is
//   await F.measure('soft_vest')     how much air there is between the vest and the body, front and back, at eleven heights
//   await F.tune('soft_vest', { sy: [0.9], sz: [1, 1.1], dz: [-0.02, 0, 0.02], rx: [0, 0.1] })
//
// Rays are cast at the body and at the thing worn, from in front and from behind, along three lines down the
// chest. `tune` tries every size (sy up, sz front to back), place (dz) and lean (rx) it is given, leaves GEAR
// at the best (a finger or two of air on both sides and nowhere the body through it) and returns it: the numbers
// are then written into GEAR in src/game/avatar.ts by hand. Looking at pictures found none of this: a vest that
// stood a hand off the back was called fitted three times.

import * as THREE from 'three';
import { GEAR, type Avatar } from '../game/avatar';

type G = { wear(body: Avatar, ids: string[]): Promise<void> };
type Row = { h: number; front: number | null; back: number | null };

const w = window as unknown as Record<string, any>;
const game = w.__game as G, T = w.T;
const HEIGHTS = Array.from({ length: 11 }, (_, i) => +(1.02 + i * 0.04).toFixed(2)), ACROSS = [-0.08, 0, 0.08];
const rc = new THREE.Raycaster();
let body: Avatar | null = null;
let skin: Record<string, [number | null, number | null]> = {};

const anyBody = () => body as unknown as { root: THREE.Object3D; gearObjs: THREE.Object3D[]; setGear(items: { id: string; obj: THREE.Object3D }[]): void };

/** how far in front of (dir 1) or behind (dir -1) the body's middle the first thing a ray meets is */
function cast(objs: THREE.Object3D[], x: number, h: number, dir: number): number | null {
  const root = anyBody().root;
  const from = root.localToWorld(new THREE.Vector3(x, h, dir * 1.2)), to = root.localToWorld(new THREE.Vector3(x, h, 0));
  rc.set(from, to.sub(from).normalize());
  rc.far = 1.2;
  const hit = rc.intersectObjects(objs, true)[0];
  return hit ? dir * (1.2 - hit.distance) : null;
}

function air(): { rows: Row[]; front: number; back: number; cost: number } {
  const gear = anyBody().gearObjs;
  // (seen from either side: a vest's inside faces count as the vest)
  for (const g of gear) g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) (m.material as THREE.Material).side = THREE.DoubleSide;
  });
  const rows: Row[] = [];
  let front = 9, back = 9, sum = 0, n = 0;
  for (const h of HEIGHTS) {
    let f = 9, b = 9;
    for (const x of ACROSS) {
      const [bf, bb] = skin[`${h},${x}`];
      const gf = cast(gear, x, h, 1), gb = cast(gear, x, h, -1);
      if (gf !== null && bf !== null && gf > 0) f = Math.min(f, gf - bf);
      if (gb !== null && bb !== null && gb < 0) b = Math.min(b, bb - gb);
    }
    if (f < 9) { front = Math.min(front, f); sum += Math.abs(f - 0.02); n++; }
    if (b < 9) { back = Math.min(back, b); sum += Math.abs(b - 0.02); n++; }
    rows.push({ h, front: f < 9 ? +f.toFixed(3) : null, back: b < 9 ? +b.toFixed(3) : null });
  }
  return { rows, front, back, cost: n ? sum / n : 9 };
}

const F = {
  async stand() {
    await T.lineup({ n: 1, view: 'front' });
    body = T.row[0] as Avatar;
    const root = anyBody().root;
    root.updateMatrixWorld(true);
    const meshes: THREE.Object3D[] = [];
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.visible) meshes.push(o);
    });
    skin = {};
    for (const h of HEIGHTS) for (const x of ACROSS) skin[`${h},${x}`] = [cast(meshes, x, h, 1), cast(meshes, x, h, -1)];
    return meshes.length;
  },
  async measure(id: string) {
    if (!body) await F.stand();
    await game.wear(body!, [id]);
    anyBody().root.updateMatrixWorld(true);
    const m = air();
    return { front: +m.front.toFixed(3), back: +m.back.toFixed(3), rows: m.rows.map((r) => `${r.h}: ${r.front ?? '-'} / ${r.back ?? '-'}`) };
  },
  async tune(id: string, grid: { sy: number[]; sz: number[]; dz: number[]; rx: number[] }) {
    await F.measure(id);
    const g = GEAR[id], was = JSON.parse(JSON.stringify(g)) as typeof g;
    const set = (sy: number, sz: number, dz: number, rx: number) => {
      g.s = [was.s[0], sy, sz];
      g.p = [was.p[0], was.p[1], was.p[2] + dz];
      g.r = [was.r[0] + rx, was.r[1], was.r[2]];
    };
    let best: { score: number; sy: number; sz: number; dz: number; rx: number; front: number; back: number } | null = null, k = 0;
    for (const sy of grid.sy) for (const sz of grid.sz) for (const dz of grid.dz) for (const rx of grid.rx) {
      set(sy, sz, dz, rx);
      anyBody().setGear([{ id, obj: anyBody().gearObjs[0].children[0] }]);
      anyBody().root.updateMatrixWorld(true);
      const m = air();
      // (anywhere the body is through it, or nearer than a centimetre, costs twenty times what air does)
      const score = m.cost + (m.front < 0.01 ? (0.01 - m.front) * 20 : 0) + (m.back < 0.01 ? (0.01 - m.back) * 20 : 0);
      if (!best || score < best.score) best = { score: +score.toFixed(4), sy, sz, dz, rx, front: +m.front.toFixed(3), back: +m.back.toFixed(3) };
      if (++k % 40 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    set(best!.sy, best!.sz, best!.dz, best!.rx);
    return { ...best!, gear: { p: g.p.map((v) => +v.toFixed(3)), r: g.r.map((v) => +v.toFixed(3)), s: g.s }, ...(await F.measure(id)) };
  },
};
w.F = F;
