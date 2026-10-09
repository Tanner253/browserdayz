// The flash at a muzzle: burning gas, seen for two or three frames.
//
// It has a shape, which a single picture turned to face the eye has not. From the side it is
// a tongue of flame the length of a forearm; from behind or in front it is a star. So it is
// three sheets: one across the barrel carrying the star, and two along it, crossed, carrying
// the tongue. Whichever way it is looked at, one of them is seen about square on.
//
// The pictures are other people's (scripts/fx.mjs puts them in public/assets/fx/): five
// flames seen from the side out of Kenney's Particle Pack, and eighteen frames seen from in
// front by maxi.ariani. No two shots are alike: each takes one flame and one frame, rolls the
// whole thing round the barrel by any angle, and varies its size. It is brightest in its
// first instant and swells as it dies, the star going on to its next frame as it does.

import * as THREE from 'three';
import { assets } from '../core/assets';

/** seconds a flash is seen for */
const LIFE = 0.065;
/** the flames from the side: five in a row, each running to the right from a muzzle this far along its tile (scripts/fx.mjs must agree) */
const SIDE = { url: 'assets/fx/muzzle_side.webp', tiles: 5, muzzle: 0.22, flame: 0.6 };
/** the stars from in front: a grid of them */
const FRONT = { url: 'assets/fx/muzzle_front.webp', cols: 6, rows: 3 };

export interface MuzzleArt {
  side: THREE.Texture;
  front: THREE.Texture;
}

let art: Promise<MuzzleArt> | null = null;
/** The two pictures, fetched once. (A flash is made only once they are here: its sheets each look at their own part of them.) */
export function muzzleArt(): Promise<MuzzleArt> {
  return (art ??= (async () => {
    const load = async (rel: string) => {
      const t = await new THREE.TextureLoader().loadAsync(assets.url(rel));
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const [side, front] = await Promise.all([load(SIDE.url), load(FRONT.url)]);
    return { side, front };
  })());
}

/** a sheet lying along the barrel (-z), `across` being the way it is wide; the muzzle is where the picture's is */
function along(across: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const a = across.clone().multiplyScalar(0.5);
  const z0 = SIDE.muzzle, z1 = -(1 - SIDE.muzzle);
  g.setAttribute('position', new THREE.Float32BufferAttribute([-a.x, -a.y, z0, a.x, a.y, z0, a.x, a.y, z1, -a.x, -a.y, z1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

const SHEETS = {
  across: new THREE.PlaneGeometry(1, 1),
  flat: along(new THREE.Vector3(1, 0, 0)),
  upright: along(new THREE.Vector3(0, 1, 0)),
};

export class MuzzleFlash {
  /** set at the muzzle, its -z down the barrel */
  readonly root = new THREE.Group();
  private turn = new THREE.Group();
  private star: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private tongues: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  private t = LIFE;
  private size = 1;
  private frame = 0;

  // (It is hidden by whatever is in front of it: the gun it comes out of, seen from behind,
  // covers the near half of it, which is what puts it at the muzzle and not beside the gun.)
  constructor(art: MuzzleArt) {
    const mat = (map: THREE.Texture, rx: number, ry: number) => {
      const own = map.clone();
      own.repeat.set(rx, ry);
      return new THREE.MeshBasicMaterial({ map: own, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, fog: false, toneMapped: false });
    };
    this.star = new THREE.Mesh(SHEETS.across, mat(art.front, 1 / FRONT.cols, 1 / FRONT.rows));
    this.tongues = [new THREE.Mesh(SHEETS.flat, mat(art.side, 1 / SIDE.tiles, 1)), new THREE.Mesh(SHEETS.upright, mat(art.side, 1 / SIDE.tiles, 1))];
    this.turn.add(this.star, ...this.tongues);
    this.root.add(this.turn);
    this.root.visible = false;
    for (const m of [this.star, ...this.tongues]) {
      m.frustumCulled = false;
      m.renderOrder = 20;
    }
  }

  /** which star the sheet across the barrel shows */
  private show(frame: number) {
    const k = ((frame % (FRONT.cols * FRONT.rows)) + FRONT.cols * FRONT.rows) % (FRONT.cols * FRONT.rows);
    // (a picture's first row is its top one, which is the far end of v)
    this.star.material.map!.offset.set((k % FRONT.cols) / FRONT.cols, 1 - (Math.floor(k / FRONT.cols) + 1) / FRONT.rows);
  }

  /** @param size how long the flame is, metres: a pistol's about 0.2, a rifle's twice that */
  fire(size: number) {
    this.t = 0;
    this.size = size * (0.85 + Math.random() * 0.35);
    this.turn.rotation.z = Math.random() * Math.PI * 2;
    for (const t of this.tongues) t.material.map!.offset.set(Math.floor(Math.random() * SIDE.tiles) / SIDE.tiles, 0);
    this.frame = Math.floor(Math.random() * FRONT.cols * FRONT.rows);
    this.show(this.frame);
    this.star.rotation.z = Math.random() * Math.PI * 2;
    this.root.visible = true;
    this.update(0);
  }

  update(dt: number) {
    if (!this.root.visible) return;
    this.t += dt;
    const k = this.t / LIFE;
    if (k >= 1) {
      this.root.visible = false;
      return;
    }
    // all of it at once, then swelling as it thins
    const lit = Math.pow(1 - k, 1.6);
    const swell = 0.78 + k * 0.55;
    if (k > 0.5) this.show(this.frame + 1);
    this.star.scale.setScalar(this.size * 0.9 * swell);
    for (const t of this.tongues) {
      // (the flame is this much of its tile: the tile is drawn that much bigger than the flame is long)
      t.scale.setScalar((this.size / SIDE.flame) * swell);
      // the flames are white in the pack: this is the colour of them
      t.material.color.setRGB(3.4 * lit, 2.5 * lit, 1.7 * lit);
    }
    this.star.material.color.setRGB(1.75 * lit, 1.35 * lit, 0.95 * lit);
  }
}
