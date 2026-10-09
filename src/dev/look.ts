// Development-only tools for LOOKING at the game (window.D), beside the harness that drives
// it (window.T). They step the game by exact amounts of its own time, photograph a moment of
// it and send the picture to a receiver on this machine, so a movement can be judged frame by
// frame whether or not the tab is showing. Never loaded in production builds.
//
// The receiver is any small server on 127.0.0.1:5199 that writes the body of
// POST /save?name=x to a file; without one, snap() fails and nothing else is affected.

import * as THREE from 'three';
import type { Game } from '../game/game';

type Any = Record<string, any>;

export function installLook(g: Game, T: { freeze(on?: boolean): void }) {
  const anyG = g as unknown as Any;
  const vm = g.s.r.vmScene;
  const scene = g.s.r.scene;
  const R = Object.values(g.s.r as unknown as Any).find((v) => v && v.isWebGLRenderer) as THREE.WebGLRenderer;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 400);
  const normalMat = new THREE.MeshNormalMaterial();
  const realMat = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();
  const shown = (o: THREE.Object3D | null) => {
    for (let p = o; p; p = p.parent) if (p.visible === false) return false;
    return true;
  };
  const vmBone = (re: RegExp) => {
    const out: THREE.Object3D[] = [];
    vm.traverse((o) => void ((o as THREE.Bone).isBone && re.test(o.name) && shown(o) && out.push(o)));
    return out;
  };
  /** tiles of one picture: each draws itself into the part of the canvas it is given */
  const sheet = (n: number, draw: (i: number, aspect: number) => THREE.Scene | null) => {
    const size = R.getSize(new THREE.Vector2());
    const rows = n > 3 ? 2 : 1, cols = Math.ceil(n / rows);
    const w = size.x / cols, h = size.y / rows;
    R.setRenderTarget(null);
    R.setScissorTest(false);
    R.setViewport(0, 0, size.x, size.y);
    R.setClearColor(new THREE.Color(0x808080), 1);
    R.clear();
    R.setScissorTest(true);
    for (let i = 0; i < n; i++) {
      const cx = i % cols, cy = rows - 1 - Math.floor(i / cols);
      const what = draw(i, w / h);
      if (!what) continue;
      R.setViewport(cx * w, cy * h, w, h);
      R.setScissor(cx * w, cy * h, w, h);
      R.render(what, cam);
    }
    R.setScissorTest(false);
    R.setViewport(0, 0, size.x, size.y);
  };
  const VIEWS: [number, number][] = [[0, 0], [1.3, 0], [-1.3, 0], [3.14, 0], [0, 1.2], [0.6, -0.9]];
  const snap = async (name: string) => {
    const url = R.domElement.toDataURL('image/jpeg', 0.92);
    const bin = atob(url.split(',')[1]);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    await fetch(`http://127.0.0.1:5199/save?name=${name}`, { method: 'POST', body: buf });
    return name;
  };
  const D = {
    VIEWS,
    /** the game moved on by `ms` of its own time, in frames of a sixtieth, and stopped there */
    step(ms: number) {
      T.freeze(false);
      const n = Math.max(1, Math.round(ms / 16.667));
      for (let i = 0; i < n; i++) anyG.frame(anyG.last + 16.667);
      T.freeze(true);
    },
    /** the first-person hands drawn by their shape alone (the gloves are near black) */
    plain(on = true) {
      vm.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        if (on) {
          if (!realMat.has(m)) realMat.set(m, m.material);
          m.material = normalMat;
        } else if (realMat.has(m)) m.material = realMat.get(m)!;
      });
    },
    /** what is on the canvas this instant, sent to the receiver (it must just have been drawn) */
    snap,
    /** the game's own picture of this moment, the whole of it or a part enlarged ([x0, y0, x1, y1] as shares of the screen) */
    async eye(name: string, zoom?: [number, number, number, number]) {
      const cams = [g.s.r.vmCamera, g.s.r.camera];
      for (const c of cams) {
        if (!zoom) c.clearViewOffset();
        else c.setViewOffset(1000, 1000, zoom[0] * 1000, zoom[1] * 1000, (zoom[2] - zoom[0]) * 1000, (zoom[3] - zoom[1]) * 1000);
        c.updateProjectionMatrix();
      }
      g.s.r.vmScene.visible = true;
      g.s.r.render(0);
      const out = await snap(name);
      for (const c of cams) {
        c.clearViewOffset();
        c.updateProjectionMatrix();
      }
      return out;
    },
    /** one first-person hand ('L' or 'R') from several sides at once: views are [round, up] in radians from the eye's own line */
    async hand(name: string, side: 'L' | 'R', views = VIEWS, dist = 0.3, fov = 30) {
      vm.updateMatrixWorld(true);
      const wrist = vmBone(new RegExp(`^${side}_wrist`))[0], mid = vmBone(new RegExp(`^${side}_middle2`))[0];
      if (!wrist || !mid) return 'no hand';
      const p = wrist.getWorldPosition(new THREE.Vector3()).lerp(mid.getWorldPosition(new THREE.Vector3()), 0.6);
      const q = g.s.r.vmCamera.getWorldQuaternion(new THREE.Quaternion());
      sheet(views.length, (i, aspect) => {
        const [az, el] = views[i];
        cam.position.copy(p).add(new THREE.Vector3(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist).applyQuaternion(q));
        cam.up.set(0, 1, 0).applyQuaternion(q);
        cam.lookAt(p);
        cam.fov = fov;
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        return vm;
      });
      return snap(name);
    },
    /**
     * Places in the world, several to a picture: each is [x, y, z of what is looked at, round, up, how far, field of view].
     * (Drawn straight, without the game's finishing: colours are flatter than in play.)
     */
    async world(name: string, list: [number, number, number, number, number, number, number?][]) {
      scene.updateMatrixWorld(true);
      sheet(list.length, (i, aspect) => {
        const [x, y, z, az, el, dist, fov] = list[i];
        cam.up.set(0, 1, 0);
        cam.position.set(x + Math.sin(az) * Math.cos(el) * dist, y + Math.sin(el) * dist, z + Math.cos(az) * Math.cos(el) * dist);
        cam.lookAt(x, y, z);
        cam.fov = fov ?? 30;
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        return scene;
      });
      return snap(name);
    },
    /** every bone of that name in the world, with where it is (to point `world` at a hand or a head) */
    bones(name: string) {
      const out: { at: THREE.Vector3; bone: THREE.Object3D }[] = [];
      scene.traverse((o) => void ((o as THREE.Bone).isBone && o.name === name && shown(o) && out.push({ at: o.getWorldPosition(new THREE.Vector3()), bone: o })));
      return out;
    },
  };
  (window as unknown as { D: typeof D }).D = D;
}
