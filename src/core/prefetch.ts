import * as THREE from 'three';
import type { Strips } from './strips';
import { STRIP_OVER } from './strips';

/**
 * The world's pictures put on the card before they are first drawn (2026-10-18). A picture goes to the card in the
 * frame it is first painted with, whole: flying up to the fort, its walls' and trim's 2048 and 4096 pictures went in
 * one a frame, 41 to 61 ms each (the owner's own run played again: the worst of its hitches on arrival, and the
 * owner: "theres REASONS whyu theres fps drops and lag, its not random"). Here what is within REACH of the eye and not
 * on the card yet is sent ahead: the big ones a strip at a time as the sharp ones are (see Strips), the small ones one
 * to a frame; and a picture the sharpening looks after (`userData.hi` on its paint) is left to it.
 */
const REACH = 900;
/** how often the world is looked over for what has come within reach, frames */
const EVERY = 30;
const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap'] as const;

interface Wanted {
  tex: THREE.Texture;
  users: [THREE.Material, string][];
  at: THREE.Vector3;
  r: number;
}

export class Prefetch {
  private wanted = new Map<THREE.Texture, Wanted>();
  private small: THREE.Texture[] = [];
  private frame = 0;
  private looked = false;
  private readonly sphere = new THREE.Sphere();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private strips: () => Strips | null,
  ) {}

  private onCard(t: THREE.Texture) {
    return !!(this.renderer.properties.get(t) as { __webglTexture?: unknown }).__webglTexture;
  }

  /** what in the world has a picture not on the card yet, and where it stands */
  private look() {
    this.wanted.clear();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!mat || (mat.userData as { hi?: unknown }).hi) continue;
        for (const slot of SLOTS) {
          const t = (mat as unknown as Record<string, THREE.Texture | null | undefined>)[slot];
          const img = t?.image as { width?: number; height?: number } | undefined;
          if (!t || !t.isTexture || !img?.width || (t as THREE.DataTexture).isDataTexture || (t as THREE.VideoTexture).isVideoTexture || (t as THREE.CanvasTexture).isCanvasTexture || t.isRenderTargetTexture || this.onCard(t)) continue;
          let w = this.wanted.get(t);
          if (!w) {
            if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
            this.sphere.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
            w = { tex: t, users: [], at: this.sphere.center.clone(), r: (m as THREE.InstancedMesh).isInstancedMesh ? Infinity : this.sphere.radius };
            this.wanted.set(t, w);
          }
          w.users.push([mat, slot]);
        }
      }
    });
  }

  /** each frame: what has come within reach is sent on its way; one small one goes to the card */
  update(eye: THREE.Vector3) {
    if (import.meta.env.DEV && (globalThis as { __noPrefetch?: boolean }).__noPrefetch) return;
    const t = this.small.shift();
    if (t && !this.onCard(t)) this.renderer.initTexture(t);
    if (++this.frame % EVERY !== 0) return;
    if (!this.looked || this.frame % (EVERY * 20) === 0) {
      this.look();
      this.looked = true;
    }
    const strips = this.strips();
    for (const [tex, w] of this.wanted) {
      if (w.at.distanceTo(eye) - w.r > REACH) continue;
      this.wanted.delete(tex);
      if (this.onCard(tex)) continue;
      const img = tex.image as { width: number; height: number };
      if (!strips || Math.max(img.width, img.height) <= STRIP_OVER) {
        this.small.push(tex);
        continue;
      }
      void strips.put(tex, tex.anisotropy, () => !this.onCard(tex)).then((card) => {
        if (!card) return;
        // (painted with the card's copy wherever it was painted with this one, unless something else came first)
        for (const [mat, slot] of w.users) {
          const m = mat as unknown as Record<string, THREE.Texture | null | undefined>;
          if (m[slot] === tex) m[slot] = card;
        }
      });
    }
  }
}
