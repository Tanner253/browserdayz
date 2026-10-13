// The doors and lids of what is searched (the rule is in src/sim/crates.ts, HUNG): a locker's leaves and a crate's
// lid, hung on their hinges, shut until somebody has the thing open and swung wide for as long as they do. Whoever
// is near sees it: the server says which of the map's containers is being searched (src/net/protocol.ts, 'cdoor'),
// and the game playing alone says it to itself.
//
// The case of each is drawn with everything else that stands about the map (src/world/vegetation.ts), which leaves
// its leaves out. They are drawn here, every leaf of one kind in one go however many of the kind there are, each
// where its own hinges are and turned as far as it stands open, and only those the eye is near enough to see the
// case of.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { audio } from '../core/audio';
import { boundsOf, extractParts, joinByPaint } from '../core/gltf-utils';
import { crateId } from '../net/protocol';
import { HUNG } from '../sim/crates';
import type { Atmosphere } from '../world/atmosphere';
import { foliagePatch, setLodFade } from '../world/foliage';
import type { Instance, World } from '../world/worldgen';

/** how far off a leaf is drawn where its case says nothing of that (out of doors): as far as anything stood about the map is */
const SEEN: [number, number] = [128, 140];
/** how near the eye has to be to hear one opened or shut, metres */
const HEARD = 28;

/** one thing with doors, standing somewhere */
interface Stood {
  it: Instance;
  /** where it stands, turned as it is turned */
  base: THREE.Matrix4;
  /** somebody has it open, by the server's word */
  told: boolean;
  /** it stood open at the last look (told so, or held open by this player) */
  open: boolean;
  /** how far its leaves have swung: 0 shut, 1 wide */
  swung: number;
}

/** every leaf of one kind of thing: how they hang, and what draws them */
interface Kind {
  open: number;
  time: number;
  /** the line a leaf turns about: upright (a door), or across the thing (a lid) */
  about: 'x' | 'y';
  wood: boolean;
  /** how far off its leaves are drawn at all: as far as the case is drawn as itself */
  far: number;
  stood: Stood[];
  /** each leaf of it: where its hinges are from the foot of the case as it is drawn, and its shapes, a paint each */
  leaves: { hinge: THREE.Matrix4; meshes: THREE.InstancedMesh[] }[];
}

const _m = new THREE.Matrix4(), _turn = new THREE.Matrix4(), _p = new THREE.Vector3();

export class Lockers {
  private kinds: Kind[] = [];
  private by = new Map<string, Stood>();
  /** where the eye was when the leaves were last laid out, and whether anything has swung since */
  private at = new THREE.Vector3(Infinity, 0, 0);
  private stale = true;

  constructor(private world: World, private scene: THREE.Scene, private atmo: Atmosphere) {}

  /** The leaves of every kind of thing that has them and stands somewhere on the map. */
  async load() {
    for (const [id, rule] of Object.entries(HUNG)) {
      const list = this.world.props.filter((p) => p.kind.split(/[#@]/)[0] === id);
      const entry = assets.manifest.models[id];
      if (!list.length || !entry) continue;
      const model = await assets.model(id);
      // The case is stood about the middle of what is drawn of it, on its own foot (see groundParts): the hinges
      // are said from there.
      const still = boundsOf(extractParts(model, (n) => !rule.leaf.test(n)));
      const foot = still.getCenter(new THREE.Vector3()).setY(still.min.y);
      // A thing that has a lighter copy of itself for far off is drawn as itself only so near, and the lighter
      // copy has its lid on: the leaves go out as the case does (the same sum as there: src/world/vegetation.ts).
      const size = still.getSize(new THREE.Vector3()), biggest = list.reduce((a, it) => Math.max(a, it.scale), 0) || 1;
      const swap = THREE.MathUtils.clamp(Math.max(size.x, size.y, size.z) * biggest * 20, 18, 60);
      const seen: [number, number] = entry.lods.length ? [swap, swap + Math.max(4, swap * 0.18)] : SEEN;
      const stood: Stood[] = list.map((it) => ({
        it,
        base: new THREE.Matrix4().compose(new THREE.Vector3(it.x, it.y, it.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot), new THREE.Vector3(it.scale, it.scale, it.scale)),
        told: false, open: false, swung: 0,
      }));
      const leaves: Kind['leaves'] = [];
      for (const piece of model.children) {
        if (!rule.leaf.test(piece.name)) continue;
        // Its shapes as they hang from the line of its hinges. A piece made to be hung has its own origin there;
        // of one that was not, the rule says where the line is, and its shapes are said from that.
        const at = rule.at ? new THREE.Vector3(...rule.at) : piece.position.clone();
        const parts = rule.at ? extractParts(model, (n) => n === piece.name) : extractParts(piece);
        if (rule.at) for (const p of parts) p.geometry.translate(-at.x, -at.y, -at.z);
        const meshes = joinByPaint(parts).map((p) => {
          const paint = (p.material as THREE.MeshStandardMaterial).clone();
          const fp = foliagePatch({});
          setLodFade(fp.lod, null, seen);
          this.atmo.register(paint, fp.patch, 'prop');
          const im = new THREE.InstancedMesh(p.geometry, paint, stood.length);
          im.count = 0;
          im.visible = false;
          im.frustumCulled = false;
          // (a leaf is a sheet of steel in a room, or a board: it takes the shadows of where it is and throws none of its own worth a pass)
          im.castShadow = false;
          im.receiveShadow = true;
          im.matrixAutoUpdate = false;
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.renderOrder = -10;
          im.name = `${piece.name}:0`;
          this.scene.add(im);
          return im;
        });
        leaves.push({ hinge: new THREE.Matrix4().makeTranslation(at.x - foot.x, at.y - foot.y, at.z - foot.z), meshes });
      }
      if (!leaves.length) continue;
      this.kinds.push({ open: rule.open, time: rule.time, about: rule.about ?? 'y', wood: !!rule.wood, far: seen[1], stood, leaves });
      for (const s of stood) this.by.set(crateId(s.it.x, s.it.z), s);
    }
    this.stale = true;
  }

  /** has this container doors (or a lid) at all */
  has(cid: string): boolean {
    return this.by.has(cid);
  }

  /** told (by the server) that somebody has one open, or has shut it */
  set(cid: string, open: boolean) {
    const s = this.by.get(cid);
    if (s) s.told = open;
  }

  /** every one shut, at once and without a sound (a new connection to a world) */
  clear() {
    for (const s of this.by.values()) {
      s.told = s.open = false;
      s.swung = 0;
    }
    this.stale = true;
  }

  /**
   * @param eye where the game is looked at from
   * @param held the container this player is searching, if any: its doors stand open without waiting to be told
   */
  update(dt: number, eye: THREE.Vector3, held: string | null) {
    const mine = held ? this.by.get(held) : undefined;
    for (const k of this.kinds) {
      for (const s of k.stood) {
        const open = s.told || s === mine;
        if (open !== s.open) {
          s.open = open;
          const at = { x: s.it.x, y: s.it.y + 1, z: s.it.z }, far = _p.set(at.x, at.y, at.z).distanceTo(eye);
          if (far < HEARD && k.wood) audio.door(open, at, far);
          else if (far < HEARD) audio.locker(open, at, far, k.time);
        }
        const to = open ? 1 : 0;
        if (s.swung === to) continue;
        s.swung = THREE.MathUtils.clamp(s.swung + ((open ? 1 : -1) * dt) / k.time, 0, 1);
        this.stale = true;
      }
    }
    // (the same leaves where they were, and the eye has barely moved: what is on the card is still right)
    if (!this.stale && this.at.distanceToSquared(eye) < 1) return;
    this.stale = false;
    this.at.copy(eye);
    for (const k of this.kinds) {
      let n = 0;
      for (const s of k.stood) {
        // (drawn as far off as its case is, by the same measure: see LodSet.update)
        if (_p.set(s.it.x, s.it.y, s.it.z).distanceTo(eye) > Math.min(s.it.far ?? Infinity, k.far)) continue;
        // eased at both ends: a door is pulled from rest and comes to rest
        const e = s.swung * s.swung * (3 - 2 * s.swung);
        if (k.about === 'x') _turn.makeRotationX(k.open * e);
        else _turn.makeRotationY(k.open * e);
        for (const leaf of k.leaves) {
          _m.multiplyMatrices(s.base, leaf.hinge).multiply(_turn);
          for (const im of leaf.meshes) im.setMatrixAt(n, _m);
        }
        n++;
      }
      for (const leaf of k.leaves) for (const im of leaf.meshes) {
        im.count = n;
        im.visible = n > 0;
        if (n) {
          im.instanceMatrix.clearUpdateRanges();
          im.instanceMatrix.addUpdateRange(0, n * 16);
          im.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }
}
