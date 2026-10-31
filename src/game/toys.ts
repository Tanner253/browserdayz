// What is left in the air by the small wins of 2026-10-31: a smoke grenade's smoke, and a flare hanging under its parachute.
// Each game makes its own of them from the same word (a grenade that went off, a launch), as it does a blast: nothing here
// is told to anybody, and none of it can hurt.

import * as THREE from 'three';
import type { Effects } from './effects';
import type { Lamps } from './lamps';

/** how long a smoke grenade pours, seconds */
const SMOKE_FOR = 45;
/** how long a flare burns, seconds, how fast it comes down, m/s, and how far its light reaches, metres */
const FLARE = { burns: 30, sinks: 1.7, reach: 130, power: 70 };
const RED = new THREE.Color(1, 0.16, 0.08);
/** how much of the height of the picture a flare is, however far off: a point of light to be seen from anywhere */
const POINT = 0.045;

/** a soft round of light, for a flare to be seen by (made once) */
let round: THREE.Texture | null = null;
function roundOfLight() {
  if (round) return round;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,190,170,0.95)');
  g.addColorStop(0.45, 'rgba(255,60,30,0.35)');
  g.addColorStop(1, 'rgba(255,30,10,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return (round = new THREE.CanvasTexture(c));
}

export class Toys {
  private smokes: { at: THREE.Vector3; age: number; state: { owed: number } }[] = [];
  private flares: { at: THREE.Vector3; age: number; state: { owed: number }; seed: number; point: THREE.Sprite }[] = [];
  private trail = { owed: 0 };

  constructor(private scene: THREE.Scene, private effects: Effects, private lamps: Lamps) {}

  /** a smoke grenade has started to pour, here */
  smoke(at: THREE.Vector3) {
    this.smokes.push({ at: at.clone(), age: 0, state: { owed: 0 } });
  }

  /** a flare has lit, here */
  flare(at: THREE.Vector3) {
    const point = new THREE.Sprite(new THREE.SpriteMaterial({ map: roundOfLight(), color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, sizeAttenuation: false, fog: false }));
    point.scale.setScalar(POINT);
    point.position.copy(at);
    this.scene.add(point);
    this.flares.push({ at: at.clone(), age: 0, state: { owed: 0 }, seed: Math.random() * 10, point });
  }

  /** a flare on its way up, this frame */
  rising(at: THREE.Vector3, dt: number) {
    this.lamps.glow(at, RED, 1.2, 30, 1);
    this.effects.flareTrail(at, this.trail, dt);
  }

  update(dt: number) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.age += dt;
      if (s.age > SMOKE_FOR) this.smokes.splice(i, 1);
      else this.effects.smokeScreen(s.at, s.state, dt, s.age);
    }
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.age += dt;
      if (f.age > FLARE.burns) {
        this.scene.remove(f.point);
        f.point.material.dispose();
        this.flares.splice(i, 1);
        continue;
      }
      f.at.y -= FLARE.sinks * dt;
      // (it gutters as a flare does, and goes down in its last two seconds)
      const k = Math.min(1, (FLARE.burns - f.age) / 2) * (0.82 + 0.18 * Math.sin(f.age * 31 + f.seed) * Math.sin(f.age * 13));
      this.lamps.glow(f.at, RED, FLARE.power * k, FLARE.reach, 1);
      f.point.position.copy(f.at);
      f.point.material.opacity = k;
      this.effects.flareTrail(f.at, f.state, dt);
    }
  }

  /** nothing left in the air: a game left or begun */
  reset() {
    this.smokes = [];
    for (const f of this.flares) {
      this.scene.remove(f.point);
      f.point.material.dispose();
    }
    this.flares = [];
  }
}
