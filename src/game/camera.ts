// Camera director: first-person, third-person orbit and free (fly) camera, with
// eased, arcing transitions between any two modes. Each mode produces a live
// target pose; during a transition we blend from a frozen snapshot of the previous
// pose toward the (still moving) target, so arrival is always seamless.
//
//   V      first person <-> third-person orbit (wheel zooms in orbit; zoom fully in = first person)
//   P      toggle free camera (crane shot out of the player, fly with WASD / Space / Ctrl)
//   Enter  (free cam) drop the player where you're looking and fly back into their eyes

import * as THREE from 'three';
import { physics, SHOT_GROUPS } from '../core/physics';
import type { Input } from '../core/input';
import type { Player } from './player';

export type CamMode = 'first' | 'orbit' | 'free';

interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  fov: number;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

export class CameraDirector {
  mode: CamMode = 'first';
  /** fraction of the transition into the current mode (1 = settled) */
  blend = 1;
  baseFov = 62;
  /** extra FOV multiplier from gameplay (ADS zoom) — first person only */
  fovMul = 1;

  orbit = { yaw: 0, pitch: -0.25, dist: 4.2, wantDist: 4.2, shoulder: 0.42 };
  free = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 14 };

  private from: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 62 };
  private target: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 62 };
  private proxy = new THREE.PerspectiveCamera();
  private t = 1;
  private dur = 1;
  private arc = 0;
  private label: HTMLDivElement;
  onModeChange: (mode: CamMode) => void = () => {};
  /** set by the game: called when the free camera drops the player somewhere */
  onDropPlayer: (x: number, y: number, z: number, yaw: number) => void = () => {};
  /** terrain height lookup so the free camera can't fly underground */
  groundAt: (x: number, z: number) => number = () => -1e9;

  constructor(private cam: THREE.PerspectiveCamera, private player: Player) {
    this.label = document.createElement('div');
    this.label.className = 'cam-label';
    document.getElementById('ui')!.appendChild(this.label);
    this.updateLabel();
  }

  get viewmodelVisible() {
    return this.mode === 'first' && this.blend > 0.92;
  }
  /** avatar visible to the main camera */
  get avatarVisible() {
    return this.mode !== 'first' || this.blend < 0.8;
  }
  get controlsPlayer() {
    return this.mode !== 'free';
  }

  private snapshot() {
    this.from.pos.copy(this.cam.position);
    this.from.quat.copy(this.cam.quaternion);
    this.from.fov = this.cam.fov;
  }

  setMode(mode: CamMode, duration?: number) {
    if (mode === this.mode) return;
    this.snapshot();
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'orbit') {
      this.orbit.yaw = this.player.yaw;
      this.orbit.pitch = THREE.MathUtils.clamp(this.player.pitch - 0.18, -1.2, 0.6);
      if (prev === 'first') this.orbit.dist = 0.4;
      this.orbit.wantDist = Math.max(this.orbit.wantDist, 2.5);
    } else if (mode === 'free') {
      // crane up and back out of the player's head, looking down at them
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion);
      fwd.y = 0;
      fwd.normalize();
      const p = this.player.pos;
      this.free.pos.set(p.x, p.y + 1.6, p.z).addScaledVector(fwd, -7.5);
      this.free.pos.y += 4.5;
      const look = new THREE.Vector3(p.x, p.y + 1.2, p.z).sub(this.free.pos);
      this.free.yaw = Math.atan2(-look.x, -look.z);
      this.free.pitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
      this.free.vel.set(0, 0, 0);
    } else if (mode === 'first' && prev === 'orbit') {
      this.player.yaw = this.orbit.yaw;
      this.player.pitch = THREE.MathUtils.clamp(this.orbit.pitch + 0.18, -1.4, 1.4);
    } else if (mode === 'first' && prev === 'free') {
      this.player.pitch = 0;
    }
    // compute the new target once so the arc height reflects the real travel distance
    this.computeTarget(0);
    const dist = this.from.pos.distanceTo(this.target.pos);
    this.dur = duration ?? THREE.MathUtils.clamp(0.55 + dist / 22, 0.6, 2.4);
    this.arc = THREE.MathUtils.clamp(dist * 0.22, 0, 18) * (mode === 'orbit' || prev === 'orbit' ? 0.3 : 1);
    this.t = 0;
    this.blend = 0;
    this.updateLabel();
    this.onModeChange(mode);
  }

  /**
   * Fly from wherever the camera is now (the menu's aerial shot) into the current mode:
   * up and over the forest, down into the character's eyes.
   */
  flyIn(duration = 3.4) {
    this.snapshot();
    this.computeTarget(0);
    this.dur = duration;
    this.arc = 22;
    this.t = 0;
    this.blend = 0;
  }

  private updateLabel() {
    const names: Record<CamMode, string> = { first: 'First person', orbit: 'Third person', free: 'Free camera' };
    const hints: Record<CamMode, string> = {
      first: '<b>V</b> third person · <b>P</b> free cam',
      orbit: '<b>V</b> first person · <b>wheel</b> zoom · <b>P</b> free cam',
      free: '<b>WASD</b> fly · <b>Space/Ctrl</b> up/down · <b>Shift</b> fast · <b>wheel</b> speed · <b>Enter</b> drop here · <b>P</b> back',
    };
    this.label.innerHTML = `<span class="cam-mode">${names[this.mode]}</span><span class="cam-hints">${hints[this.mode]}</span>`;
  }

  /** Handles mode keys + per-mode input. Returns true if the mouse was consumed (no player look). */
  handleInput(input: Input, dt: number): boolean {
    if (input.pressed('KeyV')) this.setMode(this.mode === 'orbit' ? 'first' : this.mode === 'free' ? 'orbit' : 'orbit');
    if (input.pressed('KeyP')) this.setMode(this.mode === 'free' ? 'first' : 'free');

    const sens = this.player.sensitivity;
    if (this.mode === 'orbit') {
      this.orbit.yaw -= input.mouseDX * sens;
      this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch - input.mouseDY * sens, -1.35, 0.9);
      if (input.wheel) {
        this.orbit.wantDist = THREE.MathUtils.clamp(this.orbit.wantDist * (1 + input.wheel * 0.15), 0.8, 14);
        if (input.wheel < 0 && this.orbit.wantDist <= 0.85) this.setMode('first', 0.45);
      }
      // movement is camera-relative in third person
      this.player.yaw = this.orbit.yaw;
      return true;
    }
    if (this.mode === 'free') {
      const f = this.free;
      f.yaw -= input.mouseDX * sens;
      f.pitch = THREE.MathUtils.clamp(f.pitch - input.mouseDY * sens, -1.55, 1.55);
      if (input.wheel) f.speed = THREE.MathUtils.clamp(f.speed * (1 - input.wheel * 0.12), 1.5, 160);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ'));
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const wish = new THREE.Vector3();
      if (input.held('KeyW')) wish.add(fwd);
      if (input.held('KeyS')) wish.sub(fwd);
      if (input.held('KeyD')) wish.add(right);
      if (input.held('KeyA')) wish.sub(right);
      if (input.held('Space') || input.held('KeyE')) wish.y += 1;
      if (input.held('ControlLeft') || input.held('KeyQ') || input.held('KeyC')) wish.y -= 1;
      if (wish.lengthSq() > 0) wish.normalize();
      const speed = f.speed * (input.held('ShiftLeft') ? 3.5 : 1);
      f.vel.lerp(wish.multiplyScalar(speed), 1 - Math.exp(-5 * dt));
      f.pos.addScaledVector(f.vel, dt);
      const floor = this.groundAt(f.pos.x, f.pos.z) + 0.6;
      if (f.pos.y < floor) {
        f.pos.y = floor;
        if (f.vel.y < 0) f.vel.y = 0;
      }
      if (input.pressed('Enter') || input.pressed('NumpadEnter')) this.dropPlayer(fwd);
      return true;
    }
    return false;
  }

  private dropPlayer(fwd: THREE.Vector3) {
    const origin = this.free.pos;
    let hit = physics.raycast(origin, fwd, 800, SHOT_GROUPS, this.player.collider);
    if (!hit) hit = physics.raycast(origin, { x: 0, y: -1, z: 0 }, 2000, SHOT_GROUPS, this.player.collider);
    if (!hit) return;
    // land on top of whatever was hit
    const down = physics.raycast({ x: hit.point.x, y: hit.point.y + 2, z: hit.point.z }, { x: 0, y: -1, z: 0 }, 10, SHOT_GROUPS, this.player.collider);
    const p = down ? down.point : hit.point;
    this.onDropPlayer(p.x, p.y + 0.05, p.z, this.free.yaw);
    this.player.yaw = this.free.yaw;
    this.setMode('first');
  }

  private computeTarget(dt: number) {
    const tp = this.target;
    if (this.mode === 'first') {
      this.player.updateCamera(this.proxy, Math.max(dt, 1e-4), physics.alpha);
      tp.pos.copy(this.proxy.position);
      tp.quat.copy(this.proxy.quaternion);
      tp.fov = this.baseFov * this.fovMul;
    } else if (this.mode === 'orbit') {
      const o = this.orbit;
      o.dist += (o.wantDist - o.dist) * (1 - Math.exp(-8 * Math.max(dt, 0.016)));
      const p = new THREE.Vector3().lerpVectors(this.player.prevPos, this.player.pos, physics.alpha);
      const pivot = new THREE.Vector3(p.x, p.y + (this.player.crouched ? 1.05 : 1.5), p.z);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.pitch, o.yaw, 0, 'YXZ'));
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const shoulder = o.shoulder * THREE.MathUtils.clamp((o.dist - 0.8) / 2.5, 0, 1);
      pivot.addScaledVector(right, shoulder);
      // keep the camera out of walls / terrain
      let d = o.dist;
      const hit = physics.raycast(pivot, back, d + 0.3, SHOT_GROUPS, this.player.collider);
      if (hit) d = Math.max(0.3, hit.toi - 0.3);
      tp.pos.copy(pivot).addScaledVector(back, d);
      tp.quat.copy(q);
      tp.fov = this.baseFov + 4;
    } else {
      const f = this.free;
      tp.pos.copy(f.pos);
      tp.quat.setFromEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ'));
      tp.fov = this.baseFov + 6;
    }
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
