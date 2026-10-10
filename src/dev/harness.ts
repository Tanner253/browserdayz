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
import { DRIVE } from '../game/vehicle';
import type { Game } from '../game/game';
import { installLook } from './look';

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
  const jobs: { until: number; each?: () => void; done: () => void }[] = [];
  let pumping = false;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    let last = 0;
    while (jobs.length) {
      await tick();
      const now = performance.now();
      if (now - last >= 15.5) {
        last = now;
        // (a frozen game stays frozen: whatever was drawn last, a contact sheet say, is left on the screen)
        if (!frozen) realFrame();
        for (const j of [...jobs]) j.each?.();
      }
      for (let k = jobs.length - 1; k >= 0; k--) {
        if (now < jobs[k].until) continue;
        const [j] = jobs.splice(k, 1);
        j.done();
      }
    }
    pumping = false;
  };
  const riding = () => g.garage.ride;
  /** which drive of the jeep by the harness is the one going on now: an older one stops when it sees it is not */
  let drive = 0;
  const T = {
    physics,
    THREE,
    errors: [] as string[],
    /**
     * Run the game for `ms` of wall time regardless of tab visibility. Any number of these
     * can be going at once (a drive started and left to itself, and a wait for it): one pump
     * turns the frames for all of them.
     */
    run(ms: number, each?: () => void) {
      return new Promise<void>((done) => {
        jobs.push({ until: performance.now() + ms, each, done });
        void pump();
      });
    },
    /** hold the hour at a share of the day (0 first light, 0.3 day, 0.72 dusk, 0.85 night), or let the clock run again (null) */
    hour(p: number | null) {
      g.hourHeld = p;
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
    /** the bodies the last lineup stood up */
    get row() {
      return row;
    },
    async lineup(o: { speed?: number; dir?: number; crouch?: boolean; weapon?: string | string[]; mods?: string[][]; n?: number; dead?: number; air?: boolean; pitch?: number; aim?: boolean; view?: string; name?: string; hit?: boolean; dist?: number; clip?: string; from?: number; to?: number; death?: number; gear?: string[]; act?: string; actDur?: number; step?: number; emote?: string; emoteDur?: number; hold?: string } = {}) {
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
          const h = anyG.makeHeld(wid, o.mods?.[i % o.mods.length] ?? []);
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
        // from the wheel: a call's arm movement at successive moments, or a hold (the dance spread over its loop)
        if (o.hold) {
          a.setHold(o.hold as never);
          for (let k = 0; k < 30; k++) a.update(0.05, at, vel, face, false, false);
          any.clock = (i / n) * any.dur.dance;
        }
        if (o.emote) {
          a.emote(o.emote as never, o.emoteDur ?? 1.6);
          any.move.t = ((i + 0.5) / n) * (o.emoteDur ?? 1.6);
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
    /**
     * How far the arms of the row just laid out are inside its bodies, at worst: metres, and which part of which
     * arm. The torso's own shape is measured off the first body (how wide, and how far front and back, every
     * 4 cm up it, from what is drawn of it: jacket, vest and pack), and points along each forearm, each hand and
     * the lower end of each upper arm are tried against it. An arm hanging at a side reads about 0.04 (cloth on
     * cloth): much over that is an arm through the body.
     */
    arms() {
      const bone = (a: Avatar, n: string) => {
        let b: THREE.Bone | null = null;
        a.root.traverse((o) => { if ((o as THREE.Bone).isBone && o.name === n) b = o as THREE.Bone; });
        return b!;
      };
      const at = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
      const frame = (a: Avatar) => {
        const C = at(bone(a, 'spine_03')), U = at(bone(a, 'neck_01')).sub(at(bone(a, 'spine_01'))).normalize();
        const R = at(bone(a, 'upperarm_r')).sub(at(bone(a, 'upperarm_l')));
        R.addScaledVector(U, -R.dot(U)).normalize();
        return { C, U, R, F: new THREE.Vector3().crossVectors(U, R) };
      };
      if (!row.length) return null;
      for (const a of row) a.root.updateMatrixWorld(true);
      const first = frame(row[0]), bands = new Map<number, { a: number; front: number; back: number; n: number }>(), v = new THREE.Vector3();
      const TORSO = new Set(['pelvis', 'spine_01', 'spine_02', 'spine_03']);
      row[0].root.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh || !m.visible) return;
        const P = m.geometry.getAttribute('position'), J = m.geometry.getAttribute('skinIndex'), W = m.geometry.getAttribute('skinWeight');
        for (let i = 0; i < P.count; i++) {
          let w = 0;
          for (let c = 0; c < 4; c++) if (TORSO.has(m.skeleton.bones[J.getComponent(i, c)].name)) w += W.getComponent(i, c);
          if (w < 0.8) continue;
          m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).sub(first.C);
          const h = Math.round(v.dot(first.U) / 0.04), x = v.dot(first.R), f = v.dot(first.F);
          const b = bands.get(h) ?? bands.set(h, { a: 0, front: -9, back: 9, n: 0 }).get(h)!;
          b.a = Math.max(b.a, Math.abs(x));
          if (Math.abs(x) < 0.08) {
            b.front = Math.max(b.front, f);
            b.back = Math.min(b.back, f);
          }
          b.n++;
        }
      });
      let worst = { sink: -9, side: '', what: '', i: -1 };
      /** the worst of each part of each arm, by its side and the first letter of its name: `lf` the left forearm, `ru` the right upper arm */
      const parts: Record<string, number> = {};
      row.forEach((a, i) => {
        const f = frame(a);
        for (const side of ['l', 'r']) {
          const E = at(bone(a, `lowerarm_${side}`)), Wr = at(bone(a, `hand_${side}`)), S = at(bone(a, `upperarm_${side}`));
          const pts: [THREE.Vector3, number, string][] = [];
          for (let k = 0; k <= 6; k++) pts.push([E.clone().lerp(Wr, k / 6), 0.036, 'forearm']);
          pts.push([Wr.clone().add(Wr.clone().sub(E).normalize().multiplyScalar(0.07)), 0.03, 'hand']);
          for (let k = 0; k <= 2; k++) pts.push([S.clone().lerp(E, 0.65 + k * 0.175), 0.045, 'upper arm']);
          for (const [p, r, what] of pts) {
            const q = p.clone().sub(f.C), b = bands.get(Math.round(q.dot(f.U) / 0.04));
            if (!b || b.n < 6) continue;
            const sink = Math.min(b.a - Math.abs(q.dot(f.R)), b.front - q.dot(f.F), q.dot(f.F) - b.back) + r;
            if (sink > worst.sink) worst = { sink: Math.round(sink * 1000) / 1000, side, what, i };
            parts[side + what[0]] = Math.max(parts[side + what[0]] ?? -9, Math.round(sink * 1000) / 1000);
          }
        }
      });
      return { ...worst, parts };
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
    /** how the jeep drives, live-editable (call tune() on a jeep after changing its springs) */
    drive: DRIVE,
    /** into the driver's seat of a jeep (the nearest, or the one numbered), wherever it is */
    async ride(i?: number) {
      const p = g.player;
      if (p.dead) T.revive();
      p.vitals.water = p.vitals.energy = 100;
      if (g.garage.ride) return g.garage.ride.jeep;
      const all = [...g.garage.jeeps.values()].filter((j) => !j.wreck);
      const j = i !== undefined ? g.garage.jeeps.get(i) : all.sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))[0];
      if (!j) return null;
      const at = j.point(-2.2, 0, 0.1, new THREE.Vector3());
      T.tp(at.x, at.z, 0);
      await T.run(250);
      g.garage.use(j);
      await T.run(600);
      return riding()?.jeep ?? null;
    },
    /** the jeep being ridden, stood on the road at its point number `from`, nose toward the next one */
    onRoad(from: number, dir = 1) {
      const j = g.garage.ride?.jeep;
      const pts = g.s.world.road.points;
      if (!j) return null;
      const a = [pts[from * 3], pts[from * 3 + 1], pts[from * 3 + 2]], b = [pts[(from + dir) * 3], 0, pts[(from + dir) * 3 + 2]];
      const yaw = Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));
      j.place([a[0], a[1] + 0.85, a[2], 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2), 0, 0, 0, 0, 0]);
      j.hp = 600;
      j.fuel = 40;
      g.player.yaw = yaw;
      return j;
    },
    /**
     * Drive the road by itself, flat out, from one of its points to another: how fast it got,
     * how far off the middle, how sideways, how near to going over. The answer is left in T.result.
     */
    lap(from: number, to: number, secs: number, o: { look?: number; lookK?: number; brakeAt?: number; cap?: number } = {}) {
      const dir = Math.sign(to - from);
      const j = T.onRoad(from, dir);
      if (!j) return;
      const pts = g.s.world.road.points;
      const P = (i: number) => [pts[i * 3], pts[i * 3 + 2]];
      const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
      const keys: Record<string, boolean> = { KeyW: false, KeyA: false, KeyD: false, KeyS: false };
      // (asked of the game each time, not remembered: a window that loses the focus lets go of every key)
      const set = (k: string, on: boolean) => {
        if (g.input.held(k) !== on) g.input.simulate(k, on);
      };
      const log: string[] = [];
      let i = from, maxV = 0, maxSide = 0, minUp = 1, off = 0, air = 0, n = 0, done = false;
      const t0 = performance.now();
      const mine = ++drive;
      const finish = () => {
        if (done) return;
        done = true;
        for (const k in keys) set(k, false);
        T.result = { secs: +((performance.now() - t0) / 1000).toFixed(1), reached: i, maxV: +maxV.toFixed(1), maxSide: +maxSide.toFixed(1), minUp: +minUp.toFixed(2), off: +off.toFixed(1), air, frames: n, hp: Math.round(j.hp), fuel: +j.fuel.toFixed(1), log };
      };
      T.result = null;
      void T.run(secs * 1000, () => {
        const t = (performance.now() - t0) / 1000;
        if (mine !== drive) done = true;
        if (done || t < 0.8) return;
        while (i !== to && Math.hypot(P(i)[0] - j.pos.x, P(i)[1] - j.pos.z) > Math.hypot(P(i + dir)[0] - j.pos.x, P(i + dir)[1] - j.pos.z)) i += dir;
        if (i === to) return finish();
        let ahead = i, d = 0;
        const want = (o.look ?? 7) + Math.abs(j.speed) * (o.lookK ?? 0.55);
        while (ahead !== to && d < want) {
          d += Math.hypot(P(ahead + dir)[0] - P(ahead)[0], P(ahead + dir)[1] - P(ahead)[1]);
          ahead += dir;
        }
        const err = wrap(Math.atan2(-(P(ahead)[0] - j.pos.x), -(P(ahead)[1] - j.pos.z)) - j.yaw);
        set('KeyA', err > 0.03);
        set('KeyD', err < -0.03);
        const hot = Math.abs(err) > (o.brakeAt ?? 0.4) && j.speed > 9;
        set('KeyW', !hot && !(o.cap && j.speed > o.cap));
        set('KeyS', hot);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(j.quat).y;
        const side = Math.abs(j.vel.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(j.quat)));
        const away = Math.hypot(P(i)[0] - j.pos.x, P(i)[1] - j.pos.z);
        maxV = Math.max(maxV, j.speed);
        maxSide = Math.max(maxSide, side);
        minUp = Math.min(minUp, up);
        off = Math.max(off, away);
        if (!j.grounded) air++;
        if (++n % 45 === 0) log.push(`${t.toFixed(1)} #${i} v ${j.speed.toFixed(1)} ${j.ground} side ${side.toFixed(1)} up ${up.toFixed(2)} off ${away.toFixed(1)} gnd ${j.grounded}`);
      }).then(() => mine === drive && finish());
    },
    /**
     * A set piece from a standing start on the road: a list of [seconds, keys held].
     * What the jeep did all the way through is left in T.result.
     */
    manoeuvre(from: number, steps: [number, string[]][], every = 15) {
      const j = T.onRoad(from);
      if (!j) return;
      const all = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'];
      const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
      const log: string[] = [];
      const t0 = performance.now();
      const total = steps.reduce((s, x) => s + x[0], 0);
      const start = j.pos.clone();
      let n = 0, done = false, lastYaw = j.yaw, lastT = 0, minUp = 1, maxSide = 0, maxY = -1e9;
      const mine = ++drive;
      T.result = null;
      void T.run((total + 1) * 1000, () => {
        const t = (performance.now() - t0) / 1000 - 0.8;
        if (mine !== drive) done = true;
        if (done || t < 0) return;
        let acc = 0, held: string[] | null = null;
        for (const [d, k] of steps) {
          if (t < acc + d) {
            held = k;
            break;
          }
          acc += d;
        }
        for (const k of all) g.input.simulate(k, !!held?.includes(k));
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(j.quat).y;
        const side = j.vel.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(j.quat));
        minUp = Math.min(minUp, up);
        maxSide = Math.max(maxSide, Math.abs(side));
        maxY = Math.max(maxY, j.pos.y);
        if (!held) {
          done = true;
          T.result = { minUp: +minUp.toFixed(2), maxSide: +maxSide.toFixed(1), hp: Math.round(j.hp), moved: +j.pos.distanceTo(start).toFixed(1), rose: +(maxY - start.y).toFixed(2), log };
          return;
        }
        if (++n % every === 0) {
          const rate = wrap(j.yaw - lastYaw) / Math.max(1e-3, t - lastT);
          lastYaw = j.yaw;
          lastT = t;
          log.push(`${t.toFixed(2)} ${held.join('+').replace(/Key/g, '') || '-'} v ${j.speed.toFixed(1)} side ${side.toFixed(1)} turn ${rate.toFixed(2)} lean ${((Math.acos(Math.min(1, up)) * 180) / Math.PI).toFixed(0)} gnd ${j.grounded} ${j.ground} at ${j.pos.distanceTo(start).toFixed(1)}`);
        }
      });
    },
    result: null as unknown,
  };
  window.addEventListener('error', (e) => T.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => T.errors.push(String((e.reason && e.reason.message) || e.reason)));
  (window as unknown as { T: typeof T }).T = T;
  installLook(g, T);
}
