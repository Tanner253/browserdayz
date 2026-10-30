// The twenty-eighth film's fourth act: BUILD. A tree down, a wall nailed up tier by tier, the house raised storey on
// storey, its flag, and inside it at dusk. Then what it holds: the guns and the karambit on a sheet of their own (the
// owner: "for karambit only show the model dont show in hand").
import * as THREE from 'three';
import { BRACED, DRONE, Operator, yawTo, pitchTo } from './human';
import { AFTERNOON, BAR, GOLDEN, SUNSET, V, ease, type Ctx } from './frame28';
import { Base28, SITE } from './base28';
import { assets } from '../core/assets';
import { ITEMS, makeItem } from '../sim/items';
import { CELL } from '../sim/build/pieces';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export function actBuild(c: Ctx) {
  const { S, g, add, say, chipSay, run, when, kit, hand, look, eye, lightHands, P, ground, wait, cleaners } = c;
  const base = new Base28(g, say);
  c.base = base;
  /** the felled tree's number, and how many blows it has left in it */
  // a pine by the site down with the felling axe, watched from beside him: the last blows, and it goes over
  {
    const op = new Operator(BRACED, 285, 42);
    let tree: { x: number; z: number; i: number } | null = null, lens = V(0, 0, 0), felled = 0;
    add(BAR * 2, {
      name: 'chop',
      hour: AFTERNOON,
      m: 'groove',
      setup: async () => {
        base.clear();
        kit(['felling_axe']);
        const it = [...g.inv.carried()].find((i: Any) => i.id === 'felling_axe') as Any;
        const all = S.world.trees as Any[];
        let best = -1, bd = 1e9;
        all.forEach((t, i) => {
          if (!/pine|spruce|fir/i.test(t.kind ?? '')) return;
          const d = Math.hypot(t.x - (SITE.x + 40), t.z - SITE.z);
          if (d < bd) { bd = d; best = i; }
        });
        tree = { x: all[best].x, z: all[best].z, i: best };
        const yawOff = 0.6, me = V(tree.x + Math.sin(yawOff) * 1.7, 0, tree.z + Math.cos(yawOff) * 1.7);
        me.y = ground.floorAt(me.x, me.z);
        S.me(me.x, me.z, yawTo(me, tree), -0.05, me.y);
        hand.set(P().yaw, -0.05);
        g.takeUp(it);
        await run(30);
        // (two blows left in it: the rest were struck before the lens came)
        felled = best;
        lens = V(me.x + 5.5, me.y + 1.5, me.z + 2.5);
        op.reset(lens, me.clone().setY(me.y + 1.2));
        say(`the tree ${best}, a ${all[best].kind}, ${bd.toFixed(0)} m from the site`);
      },
      tick: (t, _S, dt) => {
        look(t, dt);
        S.key('Mouse0', t > 0.1 && t < 1.7);
        when(t, 1.75, 'falls', () => g.gather.onFell({ t: 'fell', i: felled, a: P().yaw + 1.2 }));
      },
      cam: (t) => op.update(t, lens, P().pos.clone().setY(P().pos.y + 1.3)),
      after: (t) => chipSay(t, 0.3, BAR * 2 - 0.1, 'GATHER', 'CHOP · MINE · SMELT · CRAFT'),
    });
  }
  let endOfRise = () => V(SITE.x + 30, S.ground(SITE.x, SITE.z) + 10, SITE.z);
  // the house going up, one lot on each beat, the lens going round it from the air as the day goes
  {
    const op = new Operator(DRONE, 284, 46);
    const mid = V(SITE.x + 7, 0, SITE.z + 4);
    const beat = BAR * 0.34, LONG = BAR * 3.75;
    let steps: (() => void)[] = [], a0 = 2.35;
    const want = (t: number) => {
      const a = a0 + t * 0.07, r = 31;
      return V(mid.x + Math.cos(a) * r, mid.y + 7.5 + t * 0.5, mid.z + Math.sin(a) * r);
    };
    /** the way round the house with the most air between the lens and the trees */
    const clearest = () => {
      const trunks = ((S.world.trees ?? []) as { kind: string; x: number; z: number }[]).filter((q) => !q.kind.startsWith('bush') && Math.hypot(q.x - mid.x, q.z - mid.z) < 70);
      let best = -1, pick = a0;
      for (let a = 0; a < 6.28; a += 0.1) {
        a0 = a;
        let room = 1e9;
        for (const t of [0, LONG / 2, LONG]) {
          const p = want(t);
          for (let k = 0; k <= 12; k++) {
            const x = p.x + (mid.x - p.x) * (k / 12), z = p.z + (mid.z - p.z) * (k / 12);
            for (const q of trunks) room = Math.min(room, Math.hypot(q.x - x, q.z - z));
          }
        }
        if (room > best) {
          best = room;
          pick = a;
        }
      }
      a0 = pick;
      say(`round the house from ${a0.toFixed(1)}, ${best.toFixed(1)} m clear of the trees`);
    };
    add(LONG, {
      name: 'rise',
      hour: AFTERNOON,
      m: 'groove',
      setup: () => {
        S.parkMe();
        base.begin();
        steps = base.batches();
        mid.y = S.ground(mid.x, mid.z) + 3.5;
        clearest();
        endOfRise = () => want(LONG);
        op.reset(want(0), mid);
      },
      tick: (t) => {
        steps.forEach((b, k) => when(t, beat * (k + 0.5), `step${k}`, b));
        when(t, LONG - 0.3, 'fit', () => base.fit());
        g.hourHeld = AFTERNOON + (GOLDEN - AFTERNOON) * Math.min(1, t / LONG);
      },
      cam: (t) => op.update(t, want(t), mid),
      after: (t) => {
        chipSay(t, 0.3, LONG - 0.1, 'BUILD A BASE', 'WOOD · STONE · METAL · ARMOUR');
        if (t > LONG - 0.05) say(`the base: ${JSON.stringify(base.tally())}`);
      },
    });
  }
  // the flag on its pole at sunset, and the rack inside by the torches
  {
    const op = new Operator(BRACED, 287, 30);
    let lens = V(0, 0, 0), at = V(0, 0, 0);
    add(BAR, {
      name: 'flag',
      hour: SUNSET,
      m: 'groove',
      setup: () => {
        S.parkMe();
        if (!base.base) base.begin(), base.whole();
        at = base.at(CELL * 0.1, 12.5, CELL * 1.05);
        lens = endOfRise().clone();
        op.reset(lens, base.at(CELL * 1.5, 7, CELL));
      },
      cam: (t) => op.update(t, lens, at),
      after: (t) => chipSay(t, 0.1, BAR - 0.04, 'CLAIM IT', 'YOUR FLAG · YOUR LAND'),
    });
    add(BAR, {
      name: 'rack',
      hour: SUNSET,
      m: 'groove',
      setup: async () => {
        if (!base.base) base.begin(), base.whole();
        const st = [...g.build.boxes.racks()][0] as Any;
        if (st && !st.stocked) {
          st.stocked = true;
          for (const id of ['ak', 'mosin', 'a91', 'vssk', 'deagle']) st.container.add(makeItem(id));
        }
        const me = base.at(CELL * 1, 0, CELL * 1.7);
        S.me(me.x, me.z, 0, 0, ground.floorAt(me.x, me.z, me.y + 0.5));
        await run(60);
        for (let k = 0; k < 40; k++) await wait(30);
        at = base.at(CELL * -0.1, 1.1, CELL * 2.1);
        lens = base.at(CELL * 0.75, 1.25, CELL * 1.75);
        op.reset(lens, at);
        S.parkMe();
        warm.position.copy(base.at(CELL * 0.2, 2.2, CELL * 1.85)).sub(O);
        keyLamp.position.copy(base.at(CELL * 0.1, 1.2, CELL * 1.7)).sub(O);
        warm.intensity = 70;
        keyLamp.intensity = 34;
      },
      cam: (t) => op.update(t, lens.clone().lerp(at, t * 0.04), at),
    });
  }
  /** the room the guns are shown in: the eighth film's, a hundred and seventy metres over the ground, its own lamps */
  const O = new THREE.Vector3(SITE.x, 420, SITE.z);
  const room = new THREE.Group();
  room.position.copy(O);
  room.visible = false;
  g.s.r.scene.add(room);
  const shellGeo = new THREE.SphereGeometry(46, 72, 36);
  const shell = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  shell.frustumCulled = false;
  room.add(shell);
  {
    const P0 = shellGeo.getAttribute('position'), n = P0.count, col = new Float32Array(n * 3), mid = new THREE.Vector3(0, -0.1, -1).normalize(), v = new THREE.Vector3(), q = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const k = Math.pow(THREE.MathUtils.smoothstep(v.fromBufferAttribute(P0, i).normalize().dot(mid), 0.38, 1), 1.6);
      q.setRGB(0.035 + 0.3 * k, 0.037 + 0.31 * k, 0.034 + 0.3 * k, THREE.SRGBColorSpace);
      col[i * 3] = q.r;
      col[i * 3 + 1] = q.g;
      col[i * 3 + 2] = q.b;
    }
    shellGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const warm = new THREE.PointLight(0xffb45e, 0, 8, 2), cold = new THREE.PointLight(0x7fb2ff, 0, 8, 2), keyLamp = new THREE.PointLight(0xfff1dc, 0, 8, 2), kick = new THREE.PointLight(0x9fc4ff, 0, 8, 2);
  warm.position.set(-1.6, 0.8, -1.4);
  cold.position.set(1.7, -0.5, -1.3);
  keyLamp.position.set(-1.1, 1.2, 1.6);
  kick.position.set(1.3, -0.9, 1.4);
  room.add(warm, cold, keyLamp, kick);
  cleaners.push(() => {
    room.visible = false;
    for (const l of [warm, cold, keyLamp, kick]) l.intensity = 0;
  });
  /** one thing turned in the room: its name beside it, its numbers read off the rules */
  const sheet = (name: string, id: string, mods: string[], big: string, small: string, finish?: string) => {
    let pivot: THREE.Group | null = null;
    const len = BAR * 0.75;
    add(len, {
      name,
      hour: 0.9,
      m: 'tight',
      hit: true,
      setup: async () => {
        S.parkMe();
        if (!pivot) {
          pivot = new THREE.Group();
          const inner = new THREE.Group(), h = g.makeHeld(id, mods) as { obj: THREE.Object3D } | null;
          if (!h) throw new Error(`there is no ${id} to show`);
          inner.add(h.obj);
          pivot.add(inner);
          room.add(pivot);
          if (finish === 'fade') {
            // (the Fade is kept under the karambit's steel on the model as it came: a copy of the gun has it only as text)
            const scene = (await (assets as Any).gltfOf(id)).scene as THREE.Object3D;
            let paint: THREE.Material | null = null;
            scene.traverse((o) => {
              const m = (o as THREE.Mesh).material as Any, q = (Array.isArray(m) ? m[0] : m)?.userData?.fade;
              if (q?.isMaterial) paint = q;
            });
            if (paint) h.obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = paint!; });
            else say('no Fade on the karambit');
          }
          room.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(h.obj), size = box.getSize(new THREE.Vector3());
          if (size.z > size.x) inner.rotation.y = Math.PI / 2;
          room.updateMatrixWorld(true);
          const box2 = new THREE.Box3().setFromObject(h.obj), s = box2.getSize(new THREE.Vector3());
          inner.position.sub(box2.getCenter(new THREE.Vector3()).sub(O));
          (pivot as Any).long = Math.max(s.x, s.z);
          assets.sharpen?.(h.obj);
          for (let k = 0; k < 30; k++) await wait(30);
        }
        room.visible = true;
        for (const q of room.children) if (q !== shell && !(q as THREE.Light).isLight) q.visible = q === pivot;
        warm.position.set(-1.6, 0.8, -1.4);
        keyLamp.position.set(-1.1, 1.2, 1.6);
        warm.intensity = 50;
        cold.intensity = 38;
        keyLamp.intensity = 26;
        kick.intensity = 9;
      },
      tick: (t) => {
        if (pivot) pivot.rotation.y = 0.55 - t * 0.5;
      },
      cam: () => {
        const d = Math.max(0.42, ((pivot as Any)?.long ?? 1) * 1.15);
        return { p: O.clone().add(V(0, 0.06, d)), l: O.clone(), fov: 32 };
      },
      after: (t) => chipSay(t, 0.05, len - 0.02, big, small),
    });
  };
  const g9 = () => `${ITEMS.a91?.weapon?.capacity ?? 20} ROUNDS · 7.62 · SUPPRESSED`;
  sheet('sheet-a91', 'a91', ['a91_suppressor'], '9A-91', g9());
  sheet('sheet-deagle', 'deagle', ['red_dot_1x', 'suppressor_9'], 'DESERT EAGLE', 'RED DOT · SUPPRESSOR');
  sheet('sheet-mosin', 'mosin', ['pu_scope'], 'MOSIN', 'PU SCOPE · BOLT ACTION');
  sheet('sheet-karambit', 'karambit', [], 'KARAMBIT', 'FADE FINISH', 'fade');
  void eye; void lightHands; void pitchTo; void ease;
}
