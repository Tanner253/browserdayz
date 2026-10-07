// Development-only test harness (window.T). Lets automated checks drive the game without
// pointer lock or a visible tab: step frames by hand, freeze a moment for a screenshot,
// teleport, aim at things. Never loaded in production builds.

import * as THREE from 'three';
import { physics } from '../core/physics';
import { heightAt } from '../world/worldgen';
import { makeItem } from '../sim/items';
import { Avatar, POSE } from '../game/avatar';
import { lookFor } from '../game/look';
import { MAX_STAMINA } from '../net/protocol';
import type { Game } from '../game/game';

export function installHarness(g: Game) {
  const ch = new MessageChannel();
  let waiter: (() => void) | null = null;
  ch.port1.onmessage = () => {
    const w = waiter;
    waiter = null;
    w?.();
  };
  const tick = () =>
    new Promise<void>((r) => {
      waiter = r;
      ch.port2.postMessage(0);
    });
  const anyG = g as unknown as Record<string, any>;
  const realFrame = anyG.frame.bind(g);
  let frozen = false;
  anyG.frame = (stamp?: number) => {
    if (!frozen) realFrame(stamp);
  };
  const row: Avatar[] = [];
  let sheet: { from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  const T = {
    physics,
    errors: [] as string[],
    /** run the game for `ms` of wall time regardless of tab visibility */
    async run(ms: number, each?: () => void) {
      const t0 = performance.now();
      let last = 0;
      while (performance.now() - t0 < ms) {
        await tick();
        const now = performance.now();
        if (now - last >= 15.5) {
          last = now;
          realFrame();
          each?.();
        }
      }
    },
    /** stop the world (the last rendered frame stays on screen for a screenshot) */
    freeze(on = true) {
      frozen = on;
    },
    /** enter the world the way the Play button does (connects to a server if there is one) */
    async join() {
      if (!anyG.started && !anyG.joining) await anyG.join();
      if (g.paused) anyG.unpause();
      return { online: g.online, id: g.net.id };
    },
    revive() {
      const p = g.player;
      p.vitals = { health: 100, energy: 80, water: 80, stamina: MAX_STAMINA, bleeding: false };
      p.dead = false;
      if (g.paused && anyG.started) anyG.unpause();
    },
    /** footprint of every item's world model: paste into src/sim/item-sizes.json */
    itemSizes() {
      return Object.fromEntries([...g.loot.models.sizes].map(([k, v]) => [k, [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]]));
    },
    /** give the player an item (testing) */
    give(id: string, qty?: number) {
      const it = makeItem(id, qty);
      const left = g.inv.add(it);
      anyG.inventoryChanged();
      return left ? null : it;
    },
    tp(x: number, z: number, yaw = 0, y?: number) {
      g.player.spawn(x, (y ?? heightAt(g.s.world.heights, x, z)) + 0.05, z, yaw);
    },
    /** turn the view toward a world point */
    aim(x: number, y: number, z: number) {
      const c = g.s.r.camera.position;
      const dx = x - c.x, dy = y - c.y, dz = z - c.z;
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    key(code: string, ms = 60) {
      g.input.simulate(code, true);
      setTimeout(() => g.input.simulate(code, false), ms);
    },
    /** stand in front of a world item and look at it */
    async lookAtItem(id: string, dist = 1.4, nth = 0) {
      const w = [...g.loot.items.values()].filter((i) => i.loot.item.id === id)[nth];
      if (!w) return null;
      const l = w.loot;
      const pt = l.point >= 0 ? g.s.buildings.lootPoints[l.point] : undefined;
      const rot = pt?.surf?.rot ?? 0;
      const dir = [Math.sin(rot), Math.cos(rot)];
      let best: [number, number] | null = null;
      for (const sgn of [1, -1]) {
        const x = l.x + dir[0] * dist * sgn, z = l.z + dir[1] * dist * sgn;
        if (!physics.boxOverlaps({ x, y: l.y + 0.3, z }, 0, 0.25, 0.5, 0.25)) {
          best = [x, z];
          break;
        }
      }
      best ??= [l.x + dir[0] * dist, l.z + dir[1] * dist];
      const b = g.s.world.buildings.find((q) => Math.hypot(q.x - l.x, q.z - l.z) < 8);
      g.player.spawn(best[0], (b ? b.floorY : heightAt(g.s.world.heights, best[0], best[1])) + 0.05, best[1], 0);
      await T.run(200);
      T.aim(l.x, l.y + 0.05, l.z);
      await T.run(300);
      return { id, y: +l.y.toFixed(2), prompt: anyG.prompt as string | null };
    },
    /**
     * A row of bodies frozen at successive moments of one movement, to look at an animation
     * as a contact sheet. The camera is left looking at the row; call again to replace it.
     * @param o.speed ground speed; o.dir which way it travels relative to where it faces (0 ahead, 1.57 to its left)
     * @param o.view 'side' | 'front' | 'back' | 'three' (three-quarter)
     */
    async lineup(o: { speed?: number; dir?: number; crouch?: boolean; weapon?: string | string[]; n?: number; dead?: number; air?: boolean; pitch?: number; aim?: boolean; view?: string; name?: string; hit?: boolean; dist?: number; clip?: string; from?: number; to?: number; death?: number; gear?: string[]; act?: string; actDur?: number; step?: number } = {}) {
      for (const a of row) a.dispose();
      row.length = 0;
      const n = o.n ?? 8;
      const p = g.player.pos;
      const base = new THREE.Vector3(p.x, p.y, p.z);
      const face = o.view === 'front' ? Math.PI : o.view === 'back' ? 0 : o.view === 'three' ? Math.PI * 0.75 : Math.PI / 2;
      const speed = o.speed ?? 0, dir = o.dir ?? 0;
      // the way it faces is yaw: forward = (-sin, 0, -cos); travel is that turned by dir
      const vel = new THREE.Vector3(-Math.sin(face + dir) * speed, 0, -Math.cos(face + dir) * speed);
      for (let i = 0; i < n; i++) {
        const a = new Avatar();
        await a.load(g.s.atmo, 0, false, lookFor(o.name ?? `row ${i}`));
        g.s.r.scene.add(a.root);
        const gap = o.step ?? 1.05;
        const at = new THREE.Vector3(base.x + (i - (n - 1) / 2) * gap, heightAt(g.s.world.heights, base.x + (i - (n - 1) / 2) * gap, base.z - 5), base.z - 5);
        const wid = Array.isArray(o.weapon) ? o.weapon[i % o.weapon.length] : o.weapon;
        if (wid) {
          const h = anyG.makeHeld(wid, []);
          a.setHeld(h?.obj ?? null, h?.grips ?? null, h?.kind);
        }
        const any = a as unknown as Record<string, any>;
        const dead = o.dead !== undefined;
        for (let k = 0; k < 40; k++) a.update(0.05, at, vel, face, !!o.crouch, false, false, o.pitch ?? 0, !o.air, !!o.aim);
        any.phase = i / n;
        if (dead) {
          a.update(0.016, at, vel, face, !!o.crouch, true, false, 0, true);
          any.downT = (o.dead! * (i + 1)) / n;
        }
        if (o.hit) {
          a.hit();
          any.hitT = ((i + 0.5) / n) * any.dur.hit;
        }
        if (o.death !== undefined) a.setDeath(o.death);
        if (o.gear) await anyG.wear(a, o.gear);
        if (o.act) {
          a.act(o.act as never, o.actDur ?? 2);
          any.gesture.t = ((i + 0.5) / n) * (o.actDur ?? 2);
        }
        a.update(0, at, vel, face, !!o.crouch, dead, false, o.pitch ?? 0, !o.air, !!o.aim);
        if (o.clip) {
          const len = a.clipLength(o.clip as never);
          const t0 = o.from ?? 0, t1 = o.to ?? len;
          a.debugPose(o.clip as never, t0 + ((t1 - t0) * i) / Math.max(1, n - 1));
        }
        row.push(a);
      }
      const cam = g.s.r.camera;
      const d = o.dist ?? Math.max(4.2, n * 0.72 * ((o.step ?? 1.05) / 1.05));
      const mid = new THREE.Vector3(base.x, heightAt(g.s.world.heights, base.x, base.z - 5) + (o.crouch || o.dead !== undefined ? 0.6 : 0.95), base.z - 5);
      // never from under a slope: the camera stands on the ground wherever it is put
      sheet = { from: new THREE.Vector3(mid.x, Math.max(mid.y + 0.25, heightAt(g.s.world.heights, mid.x, mid.z + d) + 1.2), mid.z + d), to: mid };
      void cam;
    },
    /** render the contact sheet's view over whatever the game just drew */
    sheet() {
      if (!sheet) return;
      const cam = g.s.r.camera;
      cam.position.copy(sheet.from);
      cam.lookAt(sheet.to);
      cam.fov = 40;
      cam.layers.disable(2);
      cam.layers.disable(4);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      g.s.r.vmScene.visible = false;
      g.s.r.render(0);
    },
    wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    /** everything a test wants first: in the world, the entry modal gone, frames running whether or not the tab shows */
    async boot() {
      (window as unknown as Record<string, unknown>).__run = T.run(280000);
      await T.join();
      (g.director as unknown as { t: number }).t = 1;
      [...document.querySelectorAll('button')].find((b) => /not now/i.test(b.textContent ?? ''))?.click();
      await T.wait(300);
    },
    /** stand `dist` metres from a dummy (in front of it, or `side` radians round it), looking `h` metres up it */
    async face(i = 0, dist = 6, h = 1.25, side = 0) {
      const d = g.dummies[i];
      const a = d.yaw + side;
      T.tp(d.pos.x - Math.sin(a) * dist, d.pos.z - Math.cos(a) * dist, 0);
      await T.wait(300);
      T.aim(d.pos.x, d.pos.y + h, d.pos.z);
      await T.wait(150);
      return d;
    },
    /** pull the trigger */
    async fire(holdMs = 50) {
      g.input.simulate('Mouse0', true);
      await T.wait(holdMs);
      g.input.simulate('Mouse0', false);
    },
    vec: (x: number, y: number, z: number) => new THREE.Vector3(x, y, z),
    /** crouch / air / collapse pose angles, live-editable */
    pose: POSE,
  };
  window.addEventListener('error', (e) => T.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => T.errors.push(String((e.reason && e.reason.message) || e.reason)));
  (window as unknown as { T: typeof T }).T = T;
}
