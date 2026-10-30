// A look round the world before the twenty-eighth film is staged (tools/trailer.html?cut=28&scout=1): every town from the
// air on one sheet, and the places the film could use printed: towns, helicopters, herds, ground to build on.
import * as THREE from 'three';
import type { Shot, Stage } from './director';
import { HELI } from '../sim/heli';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function scout(S: Stage, say: (s: string) => void): { shots: Shot[]; seconds: number } {
  const g = S.g as Any;
  const pois = [...(S.world.pois as { name: string; x: number; z: number; radius: number }[])];
  for (let k = 0; k < pois.length; k += 7) say(`places: ${pois.slice(k, k + 7).map((p) => `${p.name} ${Math.round(p.x)},${Math.round(p.z)} r${Math.round(p.radius)}`).join(' | ')}`);
  const helis = [...g.garage.jeeps.values()].filter((j: Any) => j.kind === HELI.kind);
  say(`helicopters: ${helis.map((j: Any) => `${Math.round(j.pos.x)},${Math.round(j.pos.y)},${Math.round(j.pos.z)}`).join(' | ')}`);
  say(`cars: ${g.garage.jeeps.size}, roads ${S.world.roads?.length}, trees ${S.world.trees?.length}`);
  const list = pois.filter(() => false);
  const shots: Shot[] = [];
  let t = 0;
  for (const p of list) {
    const c = S.ground(p.x, p.z), a = (p.x * 7 + p.z) % 6.28;
    const lens = V(p.x + Math.cos(a) * (p.radius * 1.5 + 60), c + p.radius * 0.8 + 70, p.z + Math.sin(a) * (p.radius * 1.5 + 60));
    shots.push({
      name: `scout ${p.name}`, start: t, end: t + 1, bars: false,
      setup: () => {
        g.hourHeld = 0.42;
        S.parkMe();
      },
      cam: () => ({ p: lens, l: V(p.x, c, p.z), fov: 50 }),
      titles: [{ at: 0, until: 1, text: `${p.name}`, cls: 'small' }],
    });
    t += 1;
  }
  // ground to build on: outside the Zona, level, with trees near but not on it
  const land = g.build.local?.land ?? g.build.known?.land;
  const trees = (S.world.trees ?? []) as { kind: string; x: number; z: number }[];
  const best: { x: number; z: number; s: number }[] = [];
  const whys = new Map<string, number>();
  const W = (S.world.size ?? 4600) / 2;
  say(`world size ${S.world.size}`);
  for (let x = -W; x < W; x += 24) {
    for (let z = -W; z < W; z += 24) {
      const why = land?.why?.(x, z);
      if (why) { whys.set(why, (whys.get(why) ?? 0) + 1); continue; }
      const h = S.ground(x, z);
      if (h < 3) continue;
      let fall = 0;
      for (const [dx, dz] of [[12, 0], [-12, 0], [0, 12], [0, -12], [9, 9], [-9, -9]]) fall = Math.max(fall, Math.abs(S.ground(x + dx, z + dz) - h));
      if (fall > 0.7) continue;
      let near = 0, ring = 0;
      for (const q of trees) {
        const d = Math.hypot(q.x - x, q.z - z);
        if (d < 16) near++;
        else if (d < 60) ring++;
      }
      if (near || ring < 6) continue;
      best.push({ x, z, s: Math.min(ring, 40) - fall * 20 });
    }
  }
  best.sort((a, b) => b.s - a.s);
  say(`why not: ${[...whys].map(([k, n]) => `${k}: ${n}`).join(' | ').slice(0, 280)}`);
  const far: typeof best = [];
  for (const q of best) if (far.every((o) => Math.hypot(o.x - q.x, o.z - q.z) > 260)) far.push(q);
  say(`ground to build on: ${far.slice(0, 14).map((q) => `${q.x},${q.z} (${q.s.toFixed(0)})`).join(' | ')}`);
  for (const q of far.slice(0, 12)) {
    shots.push({
      name: `ground ${q.x},${q.z}`, start: t, end: t + 1, bars: false,
      setup: () => {
        g.hourHeld = 0.42;
      },
      cam: () => ({ p: S.at(q.x + 30, q.z + 18, 7), l: S.at(q.x, q.z, 2), fov: 55 }),
      titles: [{ at: 0, until: 1, text: `${q.x}, ${q.z}`, cls: 'small' }],
    });
    t += 1;
  }
  return { shots, seconds: t };
}
