// Torches (2026-10-24, base building's fourth step). The owner: "found around, (tier 1 flashlight reuse the fire from
// campfire and cars put it on a stick boom you have a torch)", "held and hung on walls". In the hands, L lights it: the
// campfire's own flames, a small fire's worth, at its head (src/game/flames.ts), and a warm light all round it from the
// lamps' pool (src/game/lamps.ts). On a wall (the Wall Torch, set down with the plan) it burns for whoever is near; and
// one lit in somebody else's hands burns at its head for everybody near (the navigator: "at night it's the biggest
// tell there is").

import * as THREE from 'three';
import { audio } from '../../core/audio';
import type { Input } from '../../core/input';
import type { Flames, Fire } from '../flames';
import { shapeOf } from '../../sim/build/solids';
import { inBase } from '../../sim/build/doors';
import { toWorld } from '../../sim/build/snap';
import type { Bases } from '../../sim/build/bases';

export interface TorchHost {
  input: Input;
  flames: () => Flames;
  glow: (at: THREE.Vector3, color: THREE.Color, power: number, reach: number) => void;
  /** the id of what is in the hands, and where its head is in the world */
  held: () => string | null;
  tip: (out: THREE.Vector3) => THREE.Vector3 | null;
  me: () => THREE.Vector3;
  /** a light there is shut in a stone room the eye is not in, and is not seen (src/sim/build/rooms.ts) */
  shut: (at: THREE.Vector3) => boolean;
}

/** how far off a wall torch burns for the player (its flames and its light), m */
const SEEN = 70;
/** a torch's flame (of a campfire's 1, as big as a real torch's: in the hands, at arm's length from the eye, smaller) and its light (of a street lamp's 1, and how far it reaches) */
const TORCH = { size: 0.15, hand: 0.045, power: 0.55, reach: 11 };
const WARM = new THREE.Color(1, 0.62, 0.3);

export class TorchView {
  /** the torch in the hands is lit */
  lit = false;
  private hand: Fire | null = null;
  private walls = new Map<string, { at: THREE.Vector3; fire: Fire | null }>();
  /** the torches lit in other players' hands, by who */
  private theirs = new Map<number, Fire>();
  private their = new THREE.Vector3();
  private t = 0;
  private tip = new THREE.Vector3();

  constructor(private h: TorchHost, private store: () => Bases) {}

  /** each frame: the torch in the hands (L lights it, putting it away puts it out), and the wall torches near */
  update(dt: number, free: boolean) {
    const holding = this.h.held() === 'torch';
    if (holding && free && this.h.input.pressed('KeyL')) {
      this.lit = !this.lit;
      audio.click(this.lit ? 900 : 500, 0.2, 0.02);
    }
    if (!holding) this.lit = false;
    const tip = this.lit ? this.h.tip(this.tip) : null;
    if (tip) {
      this.hand ??= this.h.flames().add(tip, { size: TORCH.hand, smoke: 0.15 });
      this.hand.at.copy(tip);
      this.hand.strength = 1;
      if (!this.h.shut(tip)) this.h.glow(tip, WARM, TORCH.power, TORCH.reach);
    } else if (this.hand) {
      this.h.flames().remove(this.hand);
      this.hand = null;
    }
    this.wallsFrame(dt);
  }

  /** the wall torches near: found twice a second, each given its flames while near and its light */
  private wallsFrame(dt: number) {
    const me = this.h.me();
    if ((this.t -= dt) <= 0) {
      this.t = 0.5;
      const near = new Set<string>();
      for (const b of this.store().near(me.x, me.z, SEEN + 10)) {
        for (const p of b.pieces.values()) {
          const f = shapeOf(p.k).flame;
          if (!f) continue;
          const key = `${b.id}:${p.id}`;
          near.add(key);
          const at = new THREE.Vector3(...toWorld(b, ...inBase(p, f)));
          const w = this.walls.get(key);
          if (w) w.at.copy(at);
          else this.walls.set(key, { at, fire: null });
        }
      }
      for (const [key, w] of this.walls) {
        if (near.has(key)) continue;
        if (w.fire) this.h.flames().remove(w.fire);
        this.walls.delete(key);
      }
    }
    for (const w of this.walls.values()) {
      const close = w.at.distanceTo(me) < SEEN;
      if (close && !w.fire) {
        w.fire = this.h.flames().add(w.at, { size: TORCH.size });
        w.fire.strength = 1;
      } else if (!close && w.fire) {
        this.h.flames().remove(w.fire);
        w.fire = null;
      }
      if (close && !this.h.shut(w.at)) this.h.glow(w.at, WARM, TORCH.power, TORCH.reach);
    }
  }

  /** each frame: the torches lit in other players' hands (the head of each, as their body is drawn), their flames and light */
  others(players: Iterable<{ id: number; torchTip: (out: THREE.Vector3) => THREE.Vector3 | null }>) {
    const lit = new Set<number>();
    for (const r of players) {
      const tip = r.torchTip(this.their);
      if (!tip) continue;
      lit.add(r.id);
      let f = this.theirs.get(r.id);
      if (!f) this.theirs.set(r.id, (f = this.h.flames().add(tip, { size: TORCH.size, smoke: 0.15 })));
      f.at.copy(tip);
      f.strength = 1;
      if (!this.h.shut(tip)) this.h.glow(tip, WARM, TORCH.power, TORCH.reach);
    }
    for (const [id, f] of this.theirs) {
      if (lit.has(id)) continue;
      this.h.flames().remove(f);
      this.theirs.delete(id);
    }
  }

  /** a new server, or none: every flame put out */
  clear() {
    for (const w of this.walls.values()) if (w.fire) this.h.flames().remove(w.fire);
    this.walls.clear();
    for (const f of this.theirs.values()) this.h.flames().remove(f);
    this.theirs.clear();
  }
}
