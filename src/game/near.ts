// What is near is drawn with its pictures at the size they came; what is far, with the world's copies.
//
// A model with big pictures is shipped twice (scripts/tiers.mjs): a copy whose pictures are a thousand pixels a
// side, which is what everything is drawn with to begin with, and the model as it came. A house six hundred
// metres off is a dozen pixels of the screen, and painted with six pictures of four thousand pixels a side it
// had half a gigabyte of the graphics card to itself. Here each such thing is given its own pictures when the
// eye comes within a few lengths of it, which is well before they could be told from the world's, and gives them
// up again when the eye has gone.
//
// (Things that are carried are not seen to here: what is in the hands is the weapons' to sharpen, and what is
// looked at within reach is the game's. See Assets.sharpen.)

import * as THREE from 'three';
import { assets } from '../core/assets';
import { TOUCH } from '../core/device';

/** carried things: not this file's (see above) */
const SMALL = ['weapon', 'loot', 'ammo', 'attachment', 'drink', 'magazine', 'gear', 'viewmodel'];
/** seconds between one look over the whole scene for what there is and the next (things come and go: a car is stood, a wreck cleared) */
const LOOK_EVERY = 8;
/** seconds between one measuring of how far everything is and the next */
const MEASURE_EVERY = 0.4;

interface Seen {
  /** the materials of it that have pictures to change */
  mats: Set<THREE.Material>;
  /**
   * Where there is a piece of it, and how far that piece reaches from its own middle: a piece that moves is asked
   * each time ([the piece, where its middle is in its own space, how far it reaches]), one that does not is a point.
   */
  at: ([THREE.Object3D, THREE.Vector3, number] | [THREE.Vector3, number])[];
  drop: (() => void) | null;
}

/**
 * How near the eye has to come to a piece for the model's own pictures to be worth having, as a multiple of how
 * far the piece reaches from its middle. A piece is painted from one picture; the world's copy of that picture is
 * a thousand pixels across it, so a piece R metres in radius has about 500 / R of them to the metre. A screen
 * 2160 pixels tall shows 1800 / d to the metre at d metres. The two are equal at d = 3.6 R; and half as far
 * again, for a picture that is not laid across its piece edge to edge.
 *
 * (On a phone what is far is drawn with pictures a quarter of that across, on a screen of about half as many
 * pixels: the two are equal at 6.5 R, and it is left at that.)
 */
const REACH = TOUCH ? 6.5 : 5.4;

/**
 * How much of the graphics card everything sharp may have at once, megabytes (2026-10-12). A picture of four
 * thousand pixels a side is 85 MB there, and a thing may have ten. With nothing to hold it, standing in the
 * hospital had two and a half gigabytes of them on a card of eight that the game at 5120x1440 had already
 * five and a half of: the card was full, and the game went at fourteen frames a second for as long as one stood
 * there. What is nearest for its size is sharp first; what there is no room for is drawn with the world's copy,
 * as it is from a few steps further off, until there is. The nearest thing of all is never left out, and what
 * is in the hands or looked at is not this file's to refuse: it is taken off what is left for the rest.
 */
const SHARP_BUDGET_MB = 900;

const _v = new THREE.Vector3(), _m = new THREE.Matrix4();

export class Near {
  private seen = new Map<string, Seen>();
  private lookT = LOOK_EVERY;
  private measureT = 0;

  constructor(private scene: THREE.Scene) {}

  private look() {
    for (const s of this.seen.values()) {
      s.mats.clear();
      s.at.length = 0;
    }
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const tag = (mat?.userData as { hi?: [string, number] } | undefined)?.hi;
        if (!tag) continue;
        const entry = assets.manifest.models[tag[0]];
        if (!entry || entry.tags.some((t) => SMALL.includes(t))) continue;
        let s = this.seen.get(tag[0]);
        if (!s) this.seen.set(tag[0], (s = { mats: new Set(), at: [], drop: null }));
        s.mats.add(mat);
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        const ball = mesh.geometry.boundingSphere!;
        mesh.updateWorldMatrix(true, false);
        const big = mesh.matrixWorld.getMaxScaleOnAxis();
        const inst = mesh as unknown as THREE.InstancedMesh;
        if (inst.isInstancedMesh) {
          // (a thing drawn many times over in one go: each of them is somewhere, and stays there)
          for (let i = 0; i < inst.count; i++) {
            inst.getMatrixAt(i, _m).premultiply(mesh.matrixWorld);
            s.at.push([ball.center.clone().applyMatrix4(_m), ball.radius * _m.getMaxScaleOnAxis()]);
          }
        } else if (!s.at.some((a) => a[0] === mesh)) s.at.push([mesh, ball.center, ball.radius * big]);
      }
    });
    // (what is sharp already is asked for again with whatever there is of it now: a new one of it stood since is painted as the others are)
    for (const s of this.seen.values()) {
      if (!s.drop) continue;
      const was = s.drop;
      s.drop = s.mats.size ? assets.sharpen([...s.mats]) : null;
      was();
    }
  }

  private wasAt = new THREE.Vector3();

  update(eye: THREE.Vector3, dt: number) {
    if ((this.lookT += dt) >= LOOK_EVERY) {
      this.lookT = 0;
      this.look();
    }
    if ((this.measureT += dt) < MEASURE_EVERY) return;
    // (nothing made sharp or let go while the eye goes faster than 15 m/s: flying over the fort its 4096 pictures were
    // fetched, unpacked and sent to the card on every pass, and let go again behind, and from a helicopter a 1024 on a
    // wall a hundred metres off is the same picture, 2026-10-18)
    const fast = this.wasAt.distanceTo(eye) / this.measureT > 15;
    this.wasAt.copy(eye);
    this.measureT = 0;
    if (fast) return;
    const want: { s: Seen; nearness: number; cost: number }[] = [];
    let mine = 0;
    for (const [id, s] of this.seen) {
      // how near the nearest piece of it is, in that piece's own reaches (see REACH); and the same a little further out, for letting go
      let near = false, about = false, nearness = Infinity;
      for (const a of s.at) {
        const moving = a.length === 3;
        const p = moving ? _v.copy(a[1]).applyMatrix4(a[0].matrixWorld) : a[0];
        const r = moving ? a[2] : a[1];
        const d = p.distanceTo(eye);
        if (d < r * REACH + 2) near = true;
        if (d < r * REACH * 1.25 + 5) about = true;
        nearness = Math.min(nearness, d / (r * REACH + 2));
      }
      const cost = assets.sharpCost(id);
      if (s.drop) mine += cost;
      if (s.mats.size && (s.drop ? about : near)) want.push({ s, nearness: s.drop ? nearness * 0.8 : nearness, cost });
      else if (s.drop) {
        s.drop();
        s.drop = null;
      }
    }
    // (the nearest for its size first; one that is sharp already counts as a little nearer than it is, so that two
    // things at the edge of what there is room for do not take turns)
    want.sort((a, b) => a.nearness - b.nearness);
    const room = SHARP_BUDGET_MB - (assets.sharpMB - mine);
    let used = 0;
    for (const [k, w] of want.entries()) {
      if (k === 0 || used + w.cost <= room) {
        used += w.cost;
        w.s.drop ??= assets.sharpen([...w.s.mats]);
      } else if (w.s.drop) {
        w.s.drop();
        w.s.drop = null;
      }
    }
  }
}
