// Salvage's wrecks as the game draws them (2026-10-25; the layer is src/sim/craft/wrecks.ts): each wreck's model where
// the layer laid it, solid to a body and a bullet as the map's own cars are (a box round it), drawn within sight and put
// away past it. Twenty-odd of them over the whole map: one model each, copied.

import * as THREE from 'three';
import { assets } from '../core/assets';
import { physics } from '../core/physics';
import { WRECK_KINDS, type Wreck } from '../sim/craft/wrecks';

/** how far off a wreck is drawn, m */
const SEEN = 450;

export class WreckView {
  private drawn: { w: Wreck; root: THREE.Object3D | null }[];
  private t = 0;

  constructor(private scene: THREE.Scene, wrecks: Wreck[], private me: () => THREE.Vector3) {
    this.drawn = wrecks.map((w) => ({ w, root: null }));
    for (const d of this.drawn) {
      const e = assets.manifest.models[WRECK_KINDS[d.w.kind].model];
      if (!e?.min || !e.max) continue;
      // (the layer lays each lengthways along its own z; a model lies lengthways along its longest side)
      const [x0, y0, z0] = e.min, [x1, y1, z1] = e.max, turn = this.turnOf(d.w);
      physics.addStatic(physics.R.ColliderDesc.cuboid(((x1 - x0) / 2) * 0.92, (y1 - y0) / 2, ((z1 - z0) / 2) * 0.92), 'metal', { x: d.w.x, y: d.w.y + (y1 - y0) / 2, z: d.w.z }, turn);
    }
  }

  private turnOf(w: Wreck) {
    const e = assets.manifest.models[WRECK_KINDS[w.kind].model];
    return e?.min && e.max && e.max[0] - e.min[0] > e.max[2] - e.min[2] ? w.rot - Math.PI / 2 : w.rot;
  }

  /** twice a second: the wrecks within sight drawn, those past it put away */
  update(dt: number) {
    if ((this.t -= dt) > 0) return;
    this.t = 0.5;
    const me = this.me();
    for (const d of this.drawn) {
      const near = Math.hypot(d.w.x - me.x, d.w.z - me.z) < SEEN;
      if (near && !d.root) {
        d.root = new THREE.Group();
        d.root.position.set(d.w.x, d.w.y, d.w.z);
        d.root.rotation.y = this.turnOf(d.w);
        const root = d.root;
        void assets.model(WRECK_KINDS[d.w.kind].model).then((m) => root.add(m.clone()));
        this.scene.add(d.root);
      } else if (!near && d.root) {
        this.scene.remove(d.root);
        d.root = null;
      }
    }
  }
}
