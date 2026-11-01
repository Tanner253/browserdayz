// What makes a room of the bunker look left and not laid out (the owner, 2026-11-01: "add more life to the rooms and environment"): filing cabinets and paper, gas bottles, extinguishers, stopped
// clocks, mops, rubbish and posters, by what each kind of room was for. It is all seen and none of it is the game's: nothing here is loot or known to the server, and only the tall things
// stop a body. It is laid by rule from each room's own number, so every game has the same rooms, one draw for each thing over a whole level, and only with the eye on that level.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { hash } from '../sim/ruins';
import type { Plan } from '../sim/bunker';

/** a thing to lay: how big, how far out of the wall its middle stands, and how it is turned to look out of the wall (its model's front) */
interface Thing { id: string; w: number; d: number; off: number; turn: number; solid?: boolean; tall?: number }
const T: Record<string, Thing> = {
  cabinet: { id: 'filing_cabinet', w: 0.57, d: 0.75, off: 0.4, turn: 0, solid: true, tall: 1.35 },
  bottles: { id: 'oxygen_bottles', w: 0.63, d: 0.47, off: 0.27, turn: 0, solid: true, tall: 1.6 },
  crate: { id: 'crate_big', w: 1, d: 1, off: 0.56, turn: 0, solid: true, tall: 1 },
  drum: { id: 'barrel_03', w: 0.62, d: 0.62, off: 0.36, turn: 0, solid: true, tall: 0.93 },
  propane: { id: 'propane_tank', w: 0.3, d: 0.3, off: 0.2, turn: 0 },
  paper: { id: 'paper_stack', w: 0.34, d: 0.3, off: 0.3, turn: 0 },
  box: { id: 'cardboard_box_01', w: 0.4, d: 0.5, off: 0.34, turn: 0 },
  bag: { id: 'trashbag', w: 0.5, d: 0.46, off: 0.34, turn: 0 },
  tyre: { id: 'old_tyre', w: 0.6, d: 0.16, off: 0.14, turn: 0 },
  mop: { id: 'mop_bucket', w: 0.8, d: 0.62, off: 0.42, turn: 0 },
  gen: { id: 'portable_generator', w: 0.82, d: 0.56, off: 0.4, turn: 0, solid: true, tall: 0.58 },
};
/** what stands out on the floor of a big room, left where it was last worked on: each piece of a heap, [what, right, forward, how high] from its middle. The middles of these rooms were bare floor */
const HEAPS: Partial<Record<string, [keyof typeof T, number, number, number][][]>> = {
  stores: [[['crate', 0, 0, 0], ['crate', 1.08, 0.1, 0], ['crate', 0.5, 0.05, 1], ['drum', -1, 0.3, 0], ['box', 1.2, 0.9, 0]], [['drum', 0, 0, 0], ['drum', 0.68, 0.1, 0], ['drum', 0.3, 0.66, 0], ['bag', -0.7, -0.3, 0], ['crate', -0.3, -1.1, 0]]],
  workshop: [[['gen', 0, 0, 0], ['propane', 0.8, 0.2, 0], ['bottles', -0.9, 0.2, 0], ['tyre', 0.5, -0.8, 0], ['box', -0.4, -0.9, 0]], [['crate', 0, 0, 0], ['gen', 0.1, 0.05, 1], ['drum', 1, 0.2, 0], ['tyre', -1.1, 0.3, 0]]],
  plant: [[['drum', 0, 0, 0], ['drum', 0.68, 0, 0], ['bottles', -0.8, 0.1, 0], ['propane', 0.4, 0.75, 0], ['tyre', 1.3, 0.7, 0]], [['gen', 0, 0, 0], ['crate', 1.1, 0, 0], ['bag', -0.8, 0.3, 0]]],
  armoury: [[['crate', 0, 0, 0], ['crate', 1.05, 0, 0], ['crate', 0.5, 0.1, 1]]],
  archive: [[['cabinet', 0, 0, 0], ['cabinet', 0.6, 0, 0], ['cabinet', 1.2, 0, 0], ['paper', 0.6, 0.75, 0], ['box', -0.5, 0.7, 0]]],
  barracks: [[['crate', 0, 0, 0], ['box', 0.8, 0.2, 0], ['bag', -0.7, 0.2, 0]]],
};
/** what hangs on a wall: how high its middle, and how far off it */
const HANG: Record<string, { id: string; y: number; off: number; turn: number }> = {
  clock: { id: 'wall_clock', y: 2.15, off: 0.04, turn: 0 },
  extinguisher: { id: 'fire_extinguisher', y: 1.25, off: 0.12, turn: 0 },
};
interface Kit { wall: (keyof typeof T)[]; floor: (keyof typeof T)[]; hang: (keyof typeof HANG | 'poster')[] }
const KITS: Record<string, Kit> = {
  control: { wall: ['cabinet'], floor: ['paper', 'box', 'bag'], hang: ['clock', 'poster'] },
  archive: { wall: ['cabinet', 'cabinet', 'crate'], floor: ['paper', 'paper', 'box'], hang: ['clock', 'extinguisher'] },
  plant: { wall: ['bottles', 'drum', 'propane', 'crate'], floor: ['tyre', 'bag', 'mop'], hang: ['extinguisher', 'poster', 'poster'] },
  stores: { wall: ['crate', 'drum', 'bottles'], floor: ['box', 'bag', 'tyre'], hang: ['extinguisher', 'poster'] },
  medical: { wall: ['bottles', 'cabinet'], floor: ['mop', 'paper', 'bag'], hang: ['clock', 'poster', 'extinguisher'] },
  quarters: { wall: ['cabinet'], floor: ['bag', 'paper', 'box'], hang: ['clock', 'poster'] },
  armoury: { wall: ['crate', 'drum'], floor: ['box', 'paper'], hang: ['extinguisher', 'poster'] },
  washroom: { wall: ['drum'], floor: ['mop', 'bag'], hang: ['extinguisher'] },
  workshop: { wall: ['bottles', 'crate', 'drum'], floor: ['tyre', 'bag', 'box'], hang: ['extinguisher', 'poster'] },
  barracks: { wall: ['cabinet'], floor: ['bag', 'box', 'paper'], hang: ['clock', 'poster', 'poster'] },
  kitchen: { wall: ['drum', 'crate'], floor: ['bag', 'mop', 'box'], hang: ['clock', 'extinguisher'] },
  mess: { wall: ['crate'], floor: ['bag', 'mop', 'box'], hang: ['clock', 'poster', 'poster'] },
  cells: { wall: [], floor: ['bag'], hang: ['poster'] },
};

/** a poster's place on the sheet: [left, top] of six, three across */
const SHEET = { across: 3, down: 2, w: 0.62, h: 0.9, y: 1.65 };

interface Laid { id: string; turn: number; r: number; f: number; y: number; rot: number }
export interface Dressed { things: Laid[]; posters: { r: number; f: number; y: number; rot: number; k: number }[]; solid: { r: number; f: number; y: number; rot: number; w: number; d: number; h: number }[] }

/** what stands high enough against a wall to hide what hangs there */
const tallAt = (s: { id: string }) => /Shelf|bookshelf|locker|cabinet|rack|bunker_machine|container/i.test(s.id);

/** Where it all goes in a plan. Pure, and the same in every game. */
export function dressPlan(plan: Plan): Dressed {
  const out: Dressed = { things: [], posters: [], solid: [] };
  const held: { r: number; f: number; rad: number }[] = [...plan.stood.map((s) => ({ r: s.r, f: s.f, rad: 0.8 })), ...plan.made.map((m) => ({ r: m.r, f: m.f, rad: Math.max(m.w, m.d) / 2 + 0.2 })), ...plan.spots.map((s) => ({ r: s.r, f: s.f, rad: 0.3 }))];
  const clear = (r: number, f: number, rad: number) => !held.some((h) => Math.hypot(h.r - r, h.f - f) < h.rad + rad);
  plan.rooms.forEach((q, n) => {
    const kit = KITS[q.kind];
    if (!kit || q.bare) return;
    const W = q.r1 - q.r0, D = q.f1 - q.f0, area = W * D, floor = q.y ?? 0, roll = (k: number) => hash(n, k, 4177);
    // (a place along a wall: which of the four by their lengths, how far along, and which way it looks into the room)
    const along = (u: number, v: number, inset: number): [number, number, number, number, number] | null => {
      const t = u * (W + D) * 2, side = t < W ? 0 : t < W + D ? 1 : t < W * 2 + D ? 2 : 3, a = 0.5 + v * (side % 2 ? D - 1 : W - 1);
      const [r, f, rot, or, of] = side === 0 ? [q.r0 + a, q.f0 + inset, 0, 0, -1] : side === 1 ? [q.r1 - inset, q.f0 + a, -Math.PI / 2, 1, 0] : side === 2 ? [q.r0 + a, q.f1 - inset, Math.PI, 0, 1] : [q.r0 + inset, q.f0 + a, Math.PI / 2, -1, 0];
      // (a real wall behind it, not a pane or a way through)
      const wr = r + or * (inset + 0.12), wf = f + of * (inset + 0.12);
      if (!plan.walls.some((w) => wr > w.r0 && wr < w.r1 && wf > w.f0 && wf < w.f1 && floor + 1.4 >= (w.y0 ?? 0) && floor + 1.4 <= (w.y1 ?? 3))) return null;
      if (q.doors.some(([dr, df]) => Math.hypot(dr - r, df - f) < 1.5)) return null;
      return [r, f, rot, or, of];
    };
    let k = 0;
    const hanging: [number, number][] = [];
    const lay = (name: keyof typeof T, tries: number) => {
      const t = T[name];
      for (let i = 0; i < tries; i++) {
        const at = along(roll(k++), roll(k++), t.off), rad = Math.max(t.w, t.d) / 2 + 0.12;
        if (!at || !clear(at[0], at[1], rad)) continue;
        held.push({ r: at[0], f: at[1], rad });
        out.things.push({ id: t.id, turn: t.turn, r: at[0], f: at[1], y: floor, rot: at[2] + (t.solid ? 0 : (roll(k++) - 0.5) * 0.9) });
        if (t.solid) out.solid.push({ r: at[0], f: at[1], y: floor, rot: at[2], w: t.w, d: t.d, h: t.tall ?? 1 });
        return;
      }
    };
    const walls = Math.min(7, 1 + Math.ceil(area / 45)), bits = Math.min(10, 2 + Math.ceil(area / 26)), hung = Math.min(7, Math.ceil((W + D) / 6));
    // (out on the floor of a big room first, while there is room for it: a heap to a square of nine metres, clear of its ways in and of what stands there)
    const heaps = HEAPS[q.kind];
    if (heaps && area > 90) {
      const across = Math.max(1, Math.floor(W / 9)), down = Math.max(1, Math.floor(D / 9));
      let laid = 0;
      for (let i = 0; i < across; i++) for (let j = 0; j < down; j++) {
        if (laid >= 4) continue;
        // (a few tries about the middle of its square: a room's places for loot lie all over its floor, and a heap is not to be stood on one)
        let cr = 0, cf = 0, found = false;
        for (let tr = 0; tr < 10 && !found; tr++) {
          cr = q.r0 + (W * (i + 0.5)) / across + (roll(k++) - 0.5) * 4;
          cf = q.f0 + (D * (j + 0.5)) / down + (roll(k++) - 0.5) * 4;
          found = !q.doors.some(([dr, df]) => Math.hypot(dr - cr, df - cf) < 3) && clear(cr, cf, 1.3) && cr - q.r0 > 2.4 && q.r1 - cr > 2.4 && cf - q.f0 > 2.4 && q.f1 - cf > 2.4;
        }
        if (!found) continue;
        held.push({ r: cr, f: cf, rad: 2 });
        laid++;
        const rot = Math.floor(roll(k++) * 4) * (Math.PI / 2) + (roll(k++) - 0.5) * 0.3, c = Math.cos(rot), s = Math.sin(rot), heap = heaps[Math.floor(roll(k++) * heaps.length)];
        for (const [name, x, z, y] of heap) {
          const t = T[name], r = cr + x * c + z * s, f = cf - x * s + z * c, turn = rot + (t.solid ? (roll(k++) - 0.5) * 0.14 : roll(k++) * 6.28);
          out.things.push({ id: t.id, turn: t.turn, r, f, y: floor + y, rot: turn });
          if (t.solid) out.solid.push({ r, f, y: floor + y, rot: turn, w: t.w, d: t.d, h: t.tall ?? 1 });
        }
      }
    }
    if (kit.wall.length) for (let i = 0; i < walls; i++) lay(kit.wall[i % kit.wall.length], 24);
    if (kit.floor.length) for (let i = 0; i < bits; i++) lay(kit.floor[i % kit.floor.length], 24);
    for (let i = 0; i < hung && kit.hang.length; i++) {
      const name = kit.hang[i % kit.hang.length];
      // (over whatever is low against the wall: only what stands as high would hide it)
      for (let tr = 0; tr < 24; tr++) {
        const at = along(roll(k++), roll(k++), 0.03);
        if (!at || hanging.some((h) => Math.hypot(h[0] - at[0], h[1] - at[1]) < 1.1) || plan.stood.some((s) => tallAt(s) && Math.hypot(s.r - at[0], s.f - at[1]) < 0.9)) continue;
        hanging.push([at[0], at[1]]);
        held.push({ r: at[0], f: at[1], rad: 0.45 });
        if (name === 'poster') out.posters.push({ r: at[0], f: at[1], y: floor + SHEET.y, rot: at[2], k: Math.floor(roll(k++) * SHEET.across * SHEET.down) });
        else {
          const h = HANG[name], or = at[3], of = at[4];
          out.things.push({ id: h.id, turn: h.turn, r: at[0] - or * h.off, f: at[1] - of * h.off, y: floor + h.y, rot: at[2] });
        }
        break;
      }
    }
  });
  return out;
}

let sheet: THREE.MeshStandardMaterial | null = null;

/** It stood in the level, every kind of thing a list of its own. @param register how a paint is told to the day and the dark @param solid what stops a body */
export function dressLevel(plan: Plan, Y: number, group: THREE.Object3D, register: (m: THREE.MeshStandardMaterial) => THREE.MeshStandardMaterial, selfLit: (m: THREE.MeshStandardMaterial, k: number) => THREE.MeshStandardMaterial, solid: (s: Dressed['solid'][number]) => void) {
  const d = dressPlan(plan), byId = new Map<string, Laid[]>();
  for (const t of d.things) (byId.get(t.id) ?? byId.set(t.id, []).get(t.id)!).push(t);
  for (const s of d.solid) solid(s);
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (const [id, list] of byId) {
    void assets.model(id).then((root) => {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const paint = register(selfLit(Object.assign((src.material as THREE.MeshStandardMaterial).clone(), { metalness: 0.15 }), id === 'filing_cabinet' || id === 'oxygen_bottles' ? 0.1 : 0.18));
        const many = new THREE.InstancedMesh(src.geometry, paint, list.length), m = new THREE.Matrix4();
        list.forEach((t, i) => many.setMatrixAt(i, m.compose(p.set(t.r, Y + t.y, t.f), q.setFromAxisAngle(up, t.rot + t.turn), one).multiply(src.matrixWorld)));
        many.frustumCulled = false;
        many.receiveShadow = true;
        group.add(many);
      });
    }).catch(() => {});
  }
  if (!d.posters.length) return;
  // (the posters: one sheet of pictures, one thing to draw)
  sheet ??= register(selfLit(new THREE.MeshStandardMaterial({ map: assets.texture('assets/tex/posters.webp', { srgb: true, repeat: false }), roughness: 0.9, metalness: 0 }), 0.35));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], A = SHEET.across, B = SHEET.down;
  d.posters.forEach((o, i) => {
    const c = Math.cos(o.rot), s = Math.sin(o.rot), x = SHEET.w / 2, h = SHEET.h / 2, u0 = (o.k % A) / A, v1 = 1 - Math.floor(o.k / A) / B, base = pos.length / 3;
    for (const [lx, ly] of [[-x, -h], [x, -h], [x, h], [-x, h]]) pos.push(o.r + lx * c, Y + o.y + ly, o.f - lx * s);
    uv.push(u0 + 0.008, v1 - 1 / B + 0.008, u0 + 1 / A - 0.008, v1 - 1 / B + 0.008, u0 + 1 / A - 0.008, v1 - 0.008, u0 + 0.008, v1 - 0.008);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    void i;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, sheet);
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
}
