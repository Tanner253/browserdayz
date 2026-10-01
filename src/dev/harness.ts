// Development-only test harness (window.T). Lets automated checks drive the game without
// pointer lock or a visible tab: step frames by hand, freeze a moment for a screenshot,
// teleport, aim at things. Never loaded in production builds.

import * as THREE from 'three';
import { physics } from '../core/physics';
import { heightAt } from '../world/worldgen';
import { makeItem } from '../sim/items';
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
  anyG.frame = () => {
    if (!frozen) realFrame();
  };
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
      p.vitals = { health: 100, energy: 80, water: 80, stamina: 100, bleeding: false };
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
    vec: (x: number, y: number, z: number) => new THREE.Vector3(x, y, z),
  };
  window.addEventListener('error', (e) => T.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => T.errors.push(String((e.reason && e.reason.message) || e.reason)));
  (window as unknown as { T: typeof T }).T = T;
}
