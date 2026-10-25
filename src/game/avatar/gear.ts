// What is worn, and where it sits on the body: hats, masks and vests on their bones, and what a mask hides of the head under it.
// (One part of avatar.ts, cut out of it whole on 2026-10-24 so that it can be read and worked on alone: nothing in it was changed.)

import * as THREE from 'three';
import { _a, _b, _euler, _m2, _q1 } from '../avatar';

/** where a thing that is worn sits on the body (see GEAR) */
type Worn = { bone: 'Head' | 'spine_03'; p: [number, number, number]; r: [number, number, number]; s: [number, number, number]; pack?: boolean };

/**
 * The gas mask on the head: the GP-5, a rubber hood over the whole of it, a little larger than life so that the
 * head is inside it. Its model lies on its back, eyepieces up and crown toward -z (scripts/assets.config.mjs lays
 * it so, and leaves out the hose and the filter can it came with): it is stood up and turned to face the way the
 * body faces. (Where it sits is where it sat from the day it was first worn until 2026-10-13, to the millimetre:
 * worked out again for the model as it is built now, by laying the old hood and the new one over each other.)
 */
const MASK: Worn = { bone: 'Head', p: [0.0007, 1.5772, 0.1298], r: [-Math.PI / 2, Math.PI, 0], s: [1.1, 1.1, 1.1] };

/**
 * Worn things that are drawn on the body. `p`, `r`, `s` place the item's model on the body
 * as it stands at rest (x to its right, y up, z behind it); the bone then carries it.
 */
export const GEAR: Record<string, Worn> = {
  // (the one backpack at two sizes: its straps are toward the body as its model comes, so it is not turned)
  // (the day pack is the camping pack made small: higher on the back, and nearer it)
  sack_pack: { bone: 'spine_03', p: [0, 1.0, 0.137], r: [0.05, 0, 0], s: [1, 1, 1], pack: true },
  camping_pack: { bone: 'spine_03', p: [0, 0.9, 0.2], r: [0.05, 0, 0], s: [1, 1, 1], pack: true },
  suitcase: { bone: 'spine_03', p: [0, 0.87, 0.215], r: [0.05, 0, 0], s: [1, 1, 1], pack: true },
  // (the helmet: its brow is toward +x as its model stands, so it is turned a quarter round)
  boonie_hat: { bone: 'Head', p: [0, 1.593, 0.035], r: [0, Math.PI / 2, 0], s: [1, 1, 1] },
  // (the K6-3: its brow is toward -z as its model stands, the way a body faces. It comes down over the ears and the nape.)
  // (2026-10-13, its visor down. The model stands 27 mm taller on its visor's lower edge and its middle is 19 mm
  // further back, so the same place on the head is said otherwise; and the helmet is 2 cm further forward on the
  // head than it was. It sat with the brow of its shell against the forehead and 5 cm of air behind the skull, and
  // the face stood 3 cm proud of the brow: a visor let down in front of that brow went through the nose and the
  // chin. Here there is a centimetre of air at the forehead and at the back of the skull alike, and a centimetre
  // between the tip of the nose and the visor's plate.)
  helmet_k63: { bone: 'Head', p: [0, 1.5229, -0.0107], r: [0, 0, 0], s: [1, 1, 1] },
  // (vests that are things of their own, hung on the chest: the plate carrier is not one of these, it is part of the suit)
  // (Fitted by measure, 2026-10-10: rays cast at the body and at each vest from front and from behind at eleven
  // heights, and the size, lean and place found that leave a finger or two of air on both sides and no more. As
  // they were first put on, the two vests stood a hand off the back and over the shoulders.)
  chest_rig: { bone: 'spine_03', p: [0, 1.0, 0.03], r: [-0.045, Math.PI, 0], s: [1.0, 0.9, 1.08] },
  soft_vest: { bone: 'spine_03', p: [0, 1.0, -0.014], r: [0.15, 0, 0], s: [1.0, 0.92, 1.05] },
  armor_vest: { bone: 'spine_03', p: [0, 1.0, -0.014], r: [0.15, 0, 0], s: [1.0, 0.88, 1.1] },
  heavy_armor: { bone: 'spine_03', p: [0, 0.95, 0.07], r: [-0.18, Math.PI, 0], s: [1.2, 1.02, 1.15] },
  // (the cap and the soft hat: their bands at the brow. The cap's peak is toward +z as its model lies, so it is turned round.)
  patrol_cap: { bone: 'Head', p: [0, 1.64, 0.01], r: [0, Math.PI, 0], s: [1, 1, 1] },
  fishermans_hat: { bone: 'Head', p: [0, 1.66, 0.0], r: [0, 0, 0], s: [1, 1, 1] },
  // (the steel pot: its brow is toward -z, as the K6-3's is. It is a smaller helmet than the other two, as it was made.)
  helmet_m1: { bone: 'Head', p: [0, 1.62, 0.012], r: [0, 0, 0], s: [1, 1, 1] },
  // (the gas mask: see MASK)
  gasmask: MASK,
};

/**
 * A gas mask as it is worn. The GP-5 lay on a table with its hose and its filter can, one stiff piece with it, and
 * they were cut off here each time it was put on; they are left out where the model is built now, so the mask is
 * worn as it lies and nothing is cut. (Kept because the game and the figure in the inventory both ask for it by name.)
 */
export function facepiece(obj: THREE.Object3D) {
  return obj;
}

/**
 * A helmet worn over the mask. The mask is a hood, a centimetre and more of rubber and air over the whole head, and
 * a helmet is made to sit on a head: left as they are the two pass through each other, the hood standing out
 * through the steel wherever the steel is nearer the head than the hood is. A real hood goes UNDER a helmet, and a
 * helmet over one rides a little higher: that is what is drawn. `nudge` moves the helmet while a mask is under it.
 * `keep` says what of the mask stays, as flat cuts in the body's resting frame (the frame GEAR is written in):
 * [nx, ny, nz, d], kept where nx x + ny y + nz z is no more than d. What the helmet covers is left out, cut clean
 * along a line the helmet's own edge hides.
 * (Measured, 2026-10-13, against the head as the game stands it: every place where the surface of the one went
 * through the surface of the other, and of those the ones that can be seen from outside.)
 */
export const OVER_MASK: Record<string, { keep: [number, number, number, number][]; nudge?: [number, number, number] }> = {
  // (The steel pot is the smallest of the helmets and sits a finger off the head: the hood filled it and came
  // through it all round, at 1,338 places that could be seen. With a mask under it it rides a centimetre higher,
  // and the hood is cut along the pot's edge, which is all but flat and four centimetres higher at the brow than at
  // the nape: 3 mm below the edge, in the shadow of the brim. Higher, the hood lay in the thickness of the steel
  // at the brow. Nothing of either goes through the other.)
  helmet_m1: { keep: [[0, 1, 0.147, 1.6505]], nudge: [0, 0.01, 0] },
  // (The Combat Helmet's brow is turned in until it all but touches the forehead: the hood stood out through it
  // above the eyepieces. With a mask under it it rides a centimetre higher and 12 mm forward, and the hood is
  // inside it everywhere above its edge. Nothing is cut: the hood meets it only where its ear pieces and the
  // rails at its temples press on the rubber.)
  boonie_hat: { keep: [], nudge: [0, 0.01, -0.012] },
  // (The K6-3's visor stays down over a mask: "keep the visor down", 2026-10-13. Its plate stands a centimetre off
  // the lips and the hood's muzzle is a centimetre and a half of rubber over them: as the two sat, the muzzle lay in
  // the thickness of the plate's lower four centimetres, at 108 places that could be seen. With a mask under it
  // the helmet sits a centimetre further forward, and the plate is clear of the hood. The valve needs nothing: it
  // leaves the hood under the chin, three centimetres below the visor's lower edge, and hangs in front of the
  // collar where it always hung; the eyepieces come behind the middle of the glass. So far forward, the back of the
  // hood stood out through the shell's lower edge at the nape: the hood is cut there, 4 mm up inside that edge, on a
  // slant that rises to above the brow in front, so that nothing of the face is cut. What still meets the hood is
  // the helmet's own chin strap and its buckle, which hang inside it at the jaw, where a bare head has them
  // against the cheek. Tipping the hood chin-in instead, 5 degrees, cleared the plate as well, and put the bridge
  // of the nose through the rubber between the eyepieces.)
  helmet_k63: { keep: [[0, 1, 0.86, 1.634]], nudge: [0, 0, -0.01] },
};

/** shapes already cut (see `under`): by the shape they were cut from and where */
const CUTS = new Map<string, THREE.BufferGeometry>();

/**
 * A shape with whatever of it is beyond any of these flat cuts left out: a triangle that lies across one is cut
 * along it, so the edge that is left is a clean line and not the saw's edge that leaving whole triangles out
 * gives. Cuts are [nx, ny, nz, d] in the shape's own frame: kept where n.p is no more than d.
 */
function cut(geo: THREE.BufferGeometry, cuts: number[][]): THREE.BufferGeometry {
  const key = `${geo.uuid}|${cuts.map((c) => c.map((x) => x.toFixed(5)).join()).join('|')}`;
  const had = CUTS.get(key);
  if (had) return had;
  const names = Object.keys(geo.attributes), attrs = names.map((n) => geo.attributes[n]);
  const at = attrs.map((_, i) => attrs.slice(0, i).reduce((s, a) => s + a.itemSize, 0)), wide = attrs.reduce((s, a) => s + a.itemSize, 0);
  const pos = at[names.indexOf('position')];
  const index = geo.index, count = index ? index.count : attrs[0].count;
  const corner = (i: number) => {
    const v = new Float32Array(wide);
    attrs.forEach((a, k) => {
      for (let c = 0; c < a.itemSize; c++) v[at[k] + c] = a.getComponent(i, c);
    });
    return v;
  };
  const out: number[] = [];
  for (let t = 0; t + 2 < count; t += 3) {
    let poly: Float32Array[] = [0, 1, 2].map((j) => corner(index ? index.getX(t + j) : t + j));
    for (const [nx, ny, nz, d] of cuts) {
      const off = (v: Float32Array) => nx * v[pos] + ny * v[pos + 1] + nz * v[pos + 2] - d;
      const next: Float32Array[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], da = off(a), db = off(b);
        if (da <= 0) next.push(a);
        if (da <= 0 !== db <= 0) {
          const u = da / (da - db), mid = new Float32Array(wide);
          for (let c = 0; c < wide; c++) mid[c] = a[c] + (b[c] - a[c]) * u;
          next.push(mid);
        }
      }
      poly = next;
      if (poly.length < 3) break;
    }
    for (let i = 1; i + 1 < poly.length; i++) for (const v of [poly[0], poly[i], poly[i + 1]]) for (let c = 0; c < wide; c++) out.push(v[c]);
  }
  const made = new THREE.BufferGeometry();
  const n = out.length / wide;
  names.forEach((name, k) => {
    const a = new Float32Array(n * attrs[k].itemSize);
    for (let i = 0; i < n; i++) for (let c = 0; c < attrs[k].itemSize; c++) a[i * attrs[k].itemSize + c] = out[i * wide + at[k] + c];
    made.setAttribute(name, new THREE.BufferAttribute(a, attrs[k].itemSize));
  });
  made.computeBoundingSphere();
  CUTS.set(key, made);
  return made;
}

/**
 * A mask as it is under a helmet: every piece of it cut where the helmet says (see OVER_MASK).
 * @param place where the mask's model is put on the body at rest (what GEAR says of it, as one turn and move)
 */
function under(mask: THREE.Object3D, place: THREE.Matrix4, keep: number[][]) {
  mask.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // (where the piece is in the mask's model, whatever the model hangs on just now)
    _m2.identity();
    for (let p: THREE.Object3D | null = mesh; p; p = p === mask ? null : p.parent) {
      p.updateMatrix();
      _m2.premultiply(p.matrix);
    }
    // (a cut said in the body's frame, said again in the piece's own: n.(M p) = (M' n).p + n.t)
    const e = _m2.premultiply(place).elements;
    mesh.geometry = cut(mesh.geometry, keep.map(([nx, ny, nz, d]) => [nx * e[0] + ny * e[1] + nz * e[2], nx * e[4] + ny * e[5] + nz * e[6], nx * e[8] + ny * e[9] + nz * e[10], d - (nx * e[12] + ny * e[13] + nz * e[14])]));
  });
}

/**
 * Where a worn thing is put on the body as it stands at rest, when these things are worn together (itself among
 * them): what GEAR says of it as one turn and move, a helmet over a mask where OVER_MASK moves it. And the thing
 * itself is made ready to be worn with the others: a mask cut under a helmet.
 * Null for a thing that is not hung on the body. (`setGear` dresses a body with this; so does whoever dresses one
 * by itself, the portrait in the inventory: a body dressed by GEAR alone had a hood through its helmet.)
 */
export function placeWorn(id: string, obj: THREE.Object3D, ids: string[], into = new THREE.Matrix4()): THREE.Matrix4 | null {
  const g = GEAR[id];
  if (!g) return null;
  const helmet = ids.some((other) => GEAR[other] === MASK) ? ids.map((other) => OVER_MASK[other]).find((h) => !!h) : undefined;
  const nudge = helmet && helmet === OVER_MASK[id] ? helmet.nudge : undefined;
  into.compose(_a.set(g.p[0] + (nudge?.[0] ?? 0), g.p[1] + (nudge?.[1] ?? 0), g.p[2] + (nudge?.[2] ?? 0)), _q1.setFromEuler(_euler.set(g.r[0], g.r[1], g.r[2], 'XYZ')), _b.set(...g.s));
  if (helmet && g === MASK && helmet.keep.length) under(obj, into, helmet.keep);
  return into;
}

/**
 * Worn things that are part of the body itself: pieces of the suit (scripts/suit.mjs), on its
 * skeleton and cut to it, that are there or not. [what is worn]: the pieces it shows.
 */
export const WORN: Record<string, string[]> = {
  life_vest: ['gear_plate', 'gear_pouches'],
};

export const GEAR_SHOWN = new Set([...Object.keys(GEAR), ...Object.keys(WORN)]);
