// Camera director: the view from the survivor's eyes, and the flight into them from the
// menu's aerial shot. While that flight lasts we blend from a frozen snapshot of where the
// camera was toward the (still moving) eyes, so arrival is always seamless.

import * as THREE from 'three';
import { physics } from '../core/physics';
import type { Player } from './player';

interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  fov: number;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

export class CameraDirector {
  /** how far the flight in has got (1 = behind the eyes) */
  blend = 1;
  baseFov = 62;
  /** extra FOV multiplier from gameplay (ADS zoom) */
  fovMul = 1;
  /**
   * Set while the view is not from the survivor's eyes but from somewhere outside them (behind
   * the jeep they are sitting in): whatever this does to the camera is where the view goes.
   */
  third: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;

  private from: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 62 };
  private target: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 62 };
  private proxy = new THREE.PerspectiveCamera();
  private t = 1;
  private dur = 1;
  private arc = 0;

  constructor(private cam: THREE.PerspectiveCamera, private player: Player) {}

  get viewmodelVisible() {
    return !this.third && this.blend > 0.92;
  }
  /** the whole body is seen by the main camera: while flying in toward it, and from outside it */
  get avatarVisible() {
    return !!this.third || this.blend < 0.8;
  }

  /** The view moves from where it is to where it now belongs (into a seat's view, or back to the eyes), not in one cut. */
  shift(duration = 0.45) {
    if (this.t < 1) return;
    this.from.pos.copy(this.cam.position);
    this.from.quat.copy(this.cam.quaternion);
    this.from.fov = this.cam.fov;
    this.dur = duration;
    this.arc = 0;
    this.t = 0;
    this.blend = 0;
  }

  /**
   * Fly from wherever the camera is now (the menu's aerial shot) into the survivor's eyes:
   * up and over the forest, and down.
   */
  flyIn(duration = 3.4) {
    this.from.pos.copy(this.cam.position);
    this.from.quat.copy(this.cam.quaternion);
    this.from.fov = this.cam.fov;
    this.computeTarget(0);
    this.dur = duration;
    this.arc = 22;
    this.t = 0;
    this.blend = 0;
  }

  private computeTarget(dt: number) {
    if (this.third) this.third(this.proxy, Math.max(dt, 1e-4));
    else this.player.updateCamera(this.proxy, Math.max(dt, 1e-4), physics.alpha);
    this.target.pos.copy(this.proxy.position);
    this.target.quat.copy(this.proxy.quaternion);
    this.target.fov = this.baseFov * this.fovMul;
  }

  update(dt: number) {
    this.computeTarget(dt);
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const kp = easeInOutCubic(this.t);
      const kr = easeInOutSine(this.t);
      this.cam.position.lerpVectors(this.from.pos, this.target.pos, kp);
      this.cam.position.y += Math.sin(Math.PI * kp) * this.arc;
      this.cam.quaternion.slerpQuaternions(this.from.quat, this.target.quat, kr);
      this.cam.fov = THREE.MathUtils.lerp(this.from.fov, this.target.fov, kr);
      this.blend = kp;
    } else {
      this.cam.position.copy(this.target.pos);
      this.cam.quaternion.copy(this.target.quat);
      this.cam.fov += (this.target.fov - this.cam.fov) * (1 - Math.exp(-14 * dt));
      this.blend = 1;
    }
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
  }
}
