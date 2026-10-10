// Development-only numbers for every animation (window.S), beside the harness that drives the
// game (window.T) and the tools that photograph it (window.D). Loaded by hand in a dev page:
//   await import('/src/dev/sweep.ts')
// Three sweeps. `S.tp()` stands bodies up in every state there is and reports arms at full
// stretch (a hand sent further than the arm is long stops short of what it should hold), hands
// off their grip, and arms through the body. `S.pops()` takes one body through every change of
// state at sixty frames a second and reports whatever jumps in a single frame. `S.fp()` does
// the same to the first-person hands and gun, driving the real game by its keys.
// Never loaded in production builds.

import * as THREE from 'three';

type Any = Record<string, any>;
const W = window as unknown as Any;
const T = W.T as Any, g = W.__game as Any;

const GUNS = ['m9', 'deagle', 'p38', 'mosin', 'benelli'];
const MELEE = ['hatchet', 'bat', 'knife', 'crowbar', 'machete'];
const FACE = Math.PI * 0.75;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const bone = (a: Any, n: string): THREE.Object3D | null => {
  let b: THREE.Object3D | null = null;
  a.root.traverse((o: THREE.Object3D) => void ((o as THREE.Bone).isBone && o.name === n && (b = o)));
  return b;
};
const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

/** how far out each arm of a body is (1 = dead straight: its hand was sent further than it reaches), and how far each hand is from where the gun says it is held */
function arms(a: Any, gesture: boolean) {
  a.root.updateMatrixWorld(true);
  const out: Any = {};
  for (const [side, r] of [['R', a.armR], ['L', a.armL]] as [string, Any][]) {
    if (!r) continue;
    const S0 = at(r.arm), H = at(r.hand);
    out['ext' + side] = r2(S0.distanceTo(H) / (r.la + r.lb));
    const grip = a.held?.grips?.[side === 'R' ? 'right' : 'left'];
    if (grip && a.held?.obj && !gesture) out['miss' + side] = r3(grip.pos.clone().applyMatrix4(a.held.obj.matrixWorld).distanceTo(H));
  }
  return out;
}

const S = {
  /**
   * Every standing state of a body seen from outside. Returns only what is wrong: an arm at 0.99 or more of its
   * length (STRAIGHT), a gun hand more than 1.5 cm off its grip (MISS; the forward hand of a long gun may slide
   * back up to 30 cm by design and is reported past that), and an arm more than 5.5 cm inside the body (IN).
   */
  async tp(only?: string[]) {
    const still: [string, Any][] = [
      ['stand', {}], ['walk', { speed: 1.6 }], ['jog', { speed: 3.4 }], ['sprint', { speed: 6.2 }], ['strafe-l', { speed: 3, dir: 1.57 }], ['strafe-r', { speed: 3, dir: -1.57 }],
      ['back', { speed: 2.4, dir: 3.14 }], ['crouch', { crouch: true }], ['crouch-walk', { crouch: true, speed: 1.4 }], ['air', { air: true }],
      ['up', { pitch: 0.8 }], ['down', { pitch: -0.8 }], ['crouch-up', { crouch: true, pitch: 0.7 }], ['crouch-down', { crouch: true, pitch: -0.7 }],
    ];
    const aimed = still.filter(([n]) => !['jog', 'sprint'].includes(n)).map(([n, o]) => ['aim ' + n, { ...o, aim: true }] as [string, Any]);
    const acts = (w?: string): [string, Any][] => [
      ...(w && GUNS.includes(w) ? [['reload', { act: 'reload', actDur: 2.4 }], ['reload crouch', { act: 'reload', actDur: 2.4, crouch: true }], ['reload walk', { act: 'reload', actDur: 2.4, speed: 1.6 }]] as [string, Any][] : []),
      ...(w === 'mosin' ? [['bolt', { act: 'bolt', actDur: 0.95 }], ['bolt aim', { act: 'bolt', actDur: 0.95, aim: true }], ['bolt crouch', { act: 'bolt', actDur: 0.95, crouch: true }]] as [string, Any][] : []),
      ...(!w || w === 'm9' || w === 'mosin' || w === 'hatchet' ? (['eat', 'drink', 'bandage', 'open'].flatMap((k) => [[k, { act: k, actDur: 2 }], [k + ' crouch', { act: k, actDur: 2, crouch: true }]]) as [string, Any][]) : []),
      ...(!w || w === 'm9' || w === 'mosin' || w === 'hatchet' ? ([...['wave', 'beckon', 'point', 'salute', 'distress', 'palms'].map((k) => ['emote ' + k, { emote: k, emoteDur: 1.6 }]), ['hold dance', { hold: 'dance' }], ['hold surrender', { hold: 'surrender' }]] as [string, Any][]) : []),
    ];
    const bad: string[] = [];
    let n = 0;
    for (const w of [undefined, ...GUNS, ...MELEE]) {
      if (only && !only.includes(w ?? 'none')) continue;
      const gun = !!w && GUNS.includes(w);
      for (const [name, o] of [...still, ...(gun ? aimed : []), ...acts(w)]) {
        await T.lineup({ n: 4, view: 'three', weapon: w, ...o });
        n++;
        const gesture = !!(o.act || o.emote || o.hold);
        const sink = T.arms();
        const flags = new Set<string>();
        for (const a of T.row as Any[]) {
          const m = arms(a, gesture);
          // (an empty arm swinging at a side is as straight as an arm gets: only arms that are placed can be short of their place)
          const placed = gun || gesture;
          if (placed && m.extR >= 0.99) flags.add(`R STRAIGHT ${m.extR}`);
          if (placed && m.extL >= 0.99) flags.add(`L STRAIGHT ${m.extL}`);
          if (m.missR > 0.015) flags.add(`R MISS ${Math.round(m.missR * 100)}cm`);
          if (m.missL > (a.held?.long ? 0.31 : 0.015)) flags.add(`L MISS ${Math.round(m.missL * 100)}cm`);
        }
        if (sink && sink.sink > 0.055) flags.add(`IN ${sink.sink} ${sink.side} ${sink.what}`);
        if (flags.size) bad.push(`${w ?? 'none'} | ${name}: ${[...flags].join(', ')}`);
      }
    }
    return { states: n, bad };
  },

  /**
   * One body taken through every change of state, sixty frames a second, watching both wrists, both elbows, the
   * head and the gun in the body's own space. A SNAP is a frame that moved more than 3 cm and more than three and
   * a half times as far as the frame either side of it: something set, not moved. Also the fastest each went.
   */
  async pops(weapon?: string, other = weapon === 'mosin' ? 'm9' : 'mosin') {
    await T.lineup({ n: 1, view: 'three', weapon });
    const a = T.row[0] as Any;
    const pos = a.root.position.clone();
    const st = { speed: 0, dir: 0, crouch: false, pitch: 0, grounded: true, aim: false, dead: false };
    const names = ['hand_l', 'hand_r', 'lowerarm_l', 'lowerarm_r', 'head'];
    const bones = names.map((n) => bone(a, n));
    const hold = (id?: string) => {
      const h = id ? g.makeHeld(id, []) : null;
      a.setHeld(h?.obj ?? null, h?.grips ?? null, h?.kind);
    };
    type Seg = [string, number, (() => void)?, (() => void)?];
    const gun = !!weapon && GUNS.includes(weapon);
    const segs: Seg[] = [
      ['settle', 0.8],
      ...(gun ? ([['aim on', 0.6, () => (st.aim = true)], ['aim off', 0.6, () => (st.aim = false)]] as Seg[]) : []),
      ['walk', 0.6, () => (st.speed = 1.6)], ['jog', 0.6, () => (st.speed = 3.4)], ['sprint', 0.8, () => (st.speed = 6.2)], ['stop from sprint', 0.7, () => (st.speed = 0)],
      ['strafe', 0.6, () => ((st.speed = 3), (st.dir = 1.57))], ['back', 0.6, () => (st.dir = 3.14)], ['stop', 0.6, () => ((st.speed = 0), (st.dir = 0))],
      ['crouch', 0.7, () => (st.crouch = true)],
      ...(gun ? ([['crouch aim on', 0.6, () => (st.aim = true)], ['crouch aim off', 0.6, () => (st.aim = false)]] as Seg[]) : []),
      ['stand', 0.7, () => (st.crouch = false)],
      ['look up', 0.5, () => (st.pitch = 0.8)], ['look down', 0.6, () => (st.pitch = -0.8)], ['look level', 0.5, () => (st.pitch = 0)],
      ['jump', 0.5, () => (st.grounded = false)], ['land', 0.6, () => (st.grounded = true)],
      ...(gun ? ([['reload', 2.6, () => a.act('reload', 2.4)], ['reload cut short', 0.9, () => a.act('reload', 2.4), undefined], ['after the cut', 0.6, () => a.act(null)]] as Seg[]) : []),
      ...(weapon === 'mosin' ? ([['bolt', 1.2, () => a.act('bolt', 0.95)]] as Seg[]) : []),
      ['eat', 2.3, () => a.act('eat', 2)], ['bandage', 2.7, () => a.act('bandage', 2.4)], ['drink cut short', 0.8, () => a.act('drink', 2)], ['after the cut', 0.6, () => a.act(null)], ['open', 1.3, () => a.act('open', 1)],
      ['emote wave', 1.9, () => a.emote('wave', 1.6)], ['emote point cut short', 0.6, () => a.emote('point', 1.4)], ['after the cut', 0.6, () => a.emote(null)],
      ['hands up', 1.0, () => a.setHold('surrender')], ['hands down', 0.9, () => a.setHold(null)], ['dance', 1.4, () => a.setHold('dance')], ['dance off', 0.9, () => a.setHold(null)],
      ['swing', 0.75, () => a.swing()], ['swing again at once', 0.75, () => a.swing()], ['swing cut by a swing', 0.3, () => a.swing()], ['second swing', 0.8, () => a.swing()],
      ['throw', 0.9, () => a.swing(true)],
      ['hit', 0.6, () => a.hit()], ['hit in the head', 0.6, () => a.hit(true)],
      ['lean right', 0.5, () => a.setLean(1)], ['lean left', 0.6, () => a.setLean(-1)], ['lean off', 0.5, () => a.setLean(0)],
      ['take up ' + other, 0.7, () => hold(other)], ['put it away', 0.7, () => hold(undefined)], ['take up ' + (weapon ?? 'hatchet'), 0.7, () => hold(weapon ?? 'hatchet')],
      ['into a seat', 0.9, () => a.setSeat(true)], ['out of the seat', 0.9, () => a.setSeat(false)],
      ['sprint, then aim', 0.6, () => (st.speed = 6.2)], ...(gun ? ([['aim from the sprint', 0.6, () => ((st.speed = 1.6), (st.aim = true))], ['aim off, stop', 0.6, () => ((st.speed = 0), (st.aim = false))]] as Seg[]) : ([['stop', 0.6, () => (st.speed = 0)]] as Seg[])),
      ['die', 2.2, () => (st.dead = true)],
    ];
    const out: string[] = [];
    let prev: THREE.Vector3[] | null = null;
    const v = new THREE.Vector3();
    for (const [label, dur, begin] of segs) {
      begin?.();
      const frames = Math.round(dur * 60);
      const d: number[][] = names.map(() => []).concat([[]]);
      for (let f = 0; f < frames; f++) {
        v.set(-Math.sin(FACE + st.dir) * st.speed, 0, -Math.cos(FACE + st.dir) * st.speed);
        a.update(1 / 60, pos, v, FACE, st.crouch, st.dead, false, st.pitch, st.grounded, st.aim);
        a.root.updateMatrixWorld(true);
        const now = bones.map((b) => (b ? a.root.worldToLocal(at(b)) : new THREE.Vector3()));
        now.push(a.held?.obj ? a.root.worldToLocal(at(a.held.obj)) : a.inHand?.obj ? a.root.worldToLocal(at(a.inHand.obj)) : new THREE.Vector3());
        now.forEach((p, i) => d[i].push(prev ? p.distanceTo(prev[i]) : 0));
        prev = now;
      }
      const notes: string[] = [];
      [...names, 'gun'].forEach((nm, i) => {
        const s = d[i];
        let top = 0;
        for (let f = 0; f < s.length; f++) {
          top = Math.max(top, s[f]);
          const beside = Math.max(s[f - 1] ?? 0, s[f + 1] ?? 0, 0.002);
          // (the first frame of a segment has the last of the one before it on its other side, which this does not see: said apart)
          if (s[f] > 0.03 && s[f] > 3.5 * (f === 0 ? Math.max(s[1] ?? 0, 0.002) : beside)) notes.push(`SNAP ${nm} ${Math.round(s[f] * 100)}cm at frame ${f}`);
        }
        if (top * 60 > 7) notes.push(`${nm} ${r2(top * 60)} m/s`);
      });
      if (notes.length) out.push(`${label}: ${notes.join(', ')}`);
    }
    return { weapon: weapon ?? 'none', out };
  },

  /**
   * The first-person gun and hands through everything that can be done with them, by the game's own keys, one
   * exact frame at a time. Watches the model in the hands and every wrist, in the eye's own space. Reports SNAPs
   * (as `pops`: a frame that moved 2 cm or 7 degrees and far more than its neighbours), a model that came or went
   * anywhere but low out of the picture, and a wrist nearer the eye than the lens's near plane.
   */
  async fp(id: string, o: { mods?: string[]; only?: string[] } = {}) {
    const p = g.player, inp = g.input, wp = g.weapons;
    const cam = g.s.r.vmCamera as THREE.PerspectiveCamera;
    const key = (code: string, down: boolean) => inp.simulate(code, down);
    const tap = (code: string) => {
      inp.simulate(code, true);
      later.push([1, () => inp.simulate(code, false)]);
    };
    const later: [number, () => void][] = [];
    for (const k of ['Mouse0', 'Mouse2', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyQ', 'KeyE']) key(k, false);
    // what is carried: the thing itself, what it fires, something else to change to, and something to use
    g.inv.clear();
    const it = T.give(id) as Any;
    if (!it) return { id, error: 'could not be given' };
    if (o.mods) it.mods = o.mods;
    const slot = Object.entries(g.inv.slots).find(([, x]) => x === it)?.[0];
    const isGun = GUNS.includes(id);
    const ammo = { m9: 'ammo_9mm', p38: 'ammo_9mm', deagle: 'ammo_50', mosin: 'ammo_762', benelli: 'ammo_12' }[id];
    if (ammo) for (let k = 0; k < 3; k++) T.give(ammo, 30);
    const second = T.give(id === 'hatchet' ? 'm9' : 'hatchet') as Any;
    const otherSlot = Object.entries(g.inv.slots).find(([, x]) => x === second)?.[0];
    const digit = (s?: string) => ({ primary: 'Digit1', secondary: 'Digit2', holster: 'Digit3', melee: 'Digit4' }[s ?? ''] ?? 'KeyX');
    const band = T.give('bandage') as Any, food = T.give('beans') as Any;
    if (isGun) it.loaded = 3;
    p.vitals.health = 60;
    g.inventoryChanged?.();
    type Seg = [string, number, (() => void)?];
    const reload: Seg[] = isGun
      ? [
          ['reload', 4.2, () => tap('KeyR')],
          ['reload from empty', 4.6, () => ((it.loaded = 0), tap('KeyR'))],
          ['reload, then sprint', 0.5, () => ((it.loaded = 1), tap('KeyR'))], ['sprinting out of it', 0.9, () => (key('KeyW', true), key('ShiftLeft', true))], ['stop', 1.6, () => (key('KeyW', false), key('ShiftLeft', false))],
          ['reload, then change weapon', 0.5, () => ((it.loaded = 1), tap('KeyR'))], ['changing out of it', 1.6, () => tap(digit(otherSlot))], ['changing back', 2.0, () => tap(digit(slot))],
          ['reload, then aim', 0.5, () => ((it.loaded = 1), tap('KeyR'))], ['aiming in it', 0.8, () => key('Mouse2', true)], ['aim off', 3.4, () => key('Mouse2', false)],
        ]
      : [];
    const segs: Seg[] = [
      ['hands away', 1.0, () => wp.equip(null)],
      ['draw', 2.0, () => tap(digit(slot))],
      ['aim in', 0.6, () => key('Mouse2', true)], ['aim out', 0.6, () => key('Mouse2', false)],
      ['fire', 1.4, () => tap('Mouse0')], ['fire again', 1.4, () => tap('Mouse0')],
      ['aim in', 0.5, () => key('Mouse2', true)], ['fire aimed', 1.4, () => tap('Mouse0')], ['aim out', 0.6, () => key('Mouse2', false)],
      ...reload,
      ['sprint', 1.0, () => (key('KeyW', true), key('ShiftLeft', true))], ['aim out of the sprint', 0.6, () => key('Mouse2', true)], ['back to the sprint', 0.6, () => key('Mouse2', false)], ['stop', 0.8, () => (key('KeyW', false), key('ShiftLeft', false))],
      ['walk', 0.8, () => key('KeyW', true)], ['strafe', 0.6, () => (key('KeyW', false), key('KeyD', true))], ['stop', 0.6, () => key('KeyD', false)],
      ['crouch', 0.7, () => tap('KeyC')], ['aim crouched', 0.5, () => key('Mouse2', true)], ['aim out', 0.5, () => key('Mouse2', false)], ['stand', 0.7, () => tap('KeyC')],
      ['lean right', 0.5, () => key('KeyE', true)], ['lean off', 0.4, () => key('KeyE', false)], ['lean left', 0.5, () => key('KeyQ', true)], ['lean off', 0.4, () => key('KeyQ', false)],
      ['jump', 1.2, () => tap('Space')], ['jump aimed', 0.3, () => key('Mouse2', true)], ['in the air', 1.2, () => tap('Space')], ['aim out', 0.5, () => key('Mouse2', false)],
      ['bandage', 3.2, () => g.useItem(band)], ['after the bandage', 1.6],
      ['eat', 0.8, () => g.useItem(food)], ['put away while eating', 1.2, () => tap('KeyX')], ['draw again', 2.0, () => tap(digit(slot))],
      ['change weapon', 1.8, () => tap(digit(otherSlot))], ['change back at once', 0.3, () => tap(digit(slot))], ['and again', 2.2, () => tap(digit(otherSlot))], ['back', 2.0, () => tap(digit(slot))],
      ['put away', 1.0, () => tap('KeyX')],
    ];
    const out: string[] = [];
    const inv = new THREE.Matrix4();
    const wrists = () => {
      const list: THREE.Object3D[] = [];
      (g.s.r.vmScene as THREE.Object3D).traverse((b) => {
        if (!(b as THREE.Bone).isBone || !/wrist/i.test(b.name)) return;
        for (let q: THREE.Object3D | null = b; q; q = q.parent) if (!q.visible) return;
        list.push(b);
      });
      return list;
    };
    let prevRoot: THREE.Object3D | null = null, prevP = new THREE.Vector3(), prevQ = new THREE.Quaternion();
    let prevW = new Map<THREE.Object3D, THREE.Vector3>();
    const wasFrozen = false;
    T.freeze(true);
    // (nothing is drawn while it runs: the hands and the gun are where they are whether or not a picture is made of them,
    // and drawing each of several thousand frames is what takes the time)
    const draw = g.s.r.render;
    g.s.r.render = () => {};
    try {
      for (const [label, dur, begin] of segs) {
        if (o.only && !o.only.some((s) => label.includes(s))) continue;
        begin?.();
        const frames = Math.round(dur * 60);
        const dp: number[] = [], dq: number[] = [], dw: number[] = [];
        const notes: string[] = [];
        for (let f = 0; f < frames; f++) {
          // (the page is given its turn now and then: the game stays stopped between these frames, so nothing else moves it on)
          if (f % 240 === 239) await new Promise((r) => setTimeout(r, 0));
          for (let k = later.length - 1; k >= 0; k--) if (--later[k][0] < 0) later.splice(k, 1)[0][1]();
          p.vitals.health = Math.max(p.vitals.health, 50);
          T.freeze(false);
          g.frame(g.last + 1000 / 60);
          T.freeze(true);
          cam.updateMatrixWorld(true);
          inv.copy(cam.matrixWorld).invert();
          const root: THREE.Object3D | null = wp.current?.root?.parent ? wp.current.root : null;
          const P = new THREE.Vector3(), Q = new THREE.Quaternion();
          if (root) {
            root.updateWorldMatrix(true, false);
            new THREE.Matrix4().multiplyMatrices(inv, root.matrixWorld).decompose(P, Q, new THREE.Vector3());
          }
          if (root !== prevRoot) {
            // (a thing comes up from under the picture and goes down under it: anywhere else, it was put there)
            if (prevRoot && prevP.y > -0.2) notes.push(`WENT at y ${r2(prevP.y)} (frame ${f})`);
            if (root && P.y > -0.2) notes.push(`CAME at y ${r2(P.y)} (frame ${f})`);
            dp.push(0), dq.push(0);
          } else if (root) {
            dp.push(P.distanceTo(prevP)), dq.push(Q.angleTo(prevQ));
          } else dp.push(0), dq.push(0);
          prevRoot = root, prevP = P, prevQ = Q;
          const nowW = new Map<THREE.Object3D, THREE.Vector3>();
          let worst = 0;
          for (const b of wrists()) {
            const q = at(b).applyMatrix4(inv);
            nowW.set(b, q);
            const was = prevW.get(b);
            if (was) worst = Math.max(worst, q.distanceTo(was));
            if (q.z > -cam.near - 0.005 && q.z < 0.3 && Math.abs(q.x) < 0.25 && Math.abs(q.y) < 0.25) notes.push(`NEAR wrist ${b.name} z ${r3(q.z)} (frame ${f})`);
          }
          dw.push(worst);
          prevW = nowW;
        }
        const snaps = (s: number[], min: number, what: string, unit: (x: number) => string) => {
          for (let f = 0; f < s.length; f++) {
            const beside = Math.max(s[f - 1] ?? 0, s[f + 1] ?? 0, min / 12);
            if (s[f] > min && s[f] > 3.5 * (f === 0 ? Math.max(s[1] ?? 0, min / 12) : beside)) notes.push(`SNAP ${what} ${unit(s[f])} at frame ${f}`);
          }
        };
        snaps(dp, 0.02, 'gun', (x) => `${r2(x * 100)}cm`);
        snaps(dq, 0.12, 'gun turn', (x) => `${Math.round((x * 180) / Math.PI)}deg`);
        snaps(dw, 0.03, 'wrist', (x) => `${r2(x * 100)}cm`);
        const near = notes.filter((s) => s.startsWith('NEAR'));
        const rest = notes.filter((s) => !s.startsWith('NEAR'));
        if (near.length) rest.push(`${near.length} frames with a wrist at the lens (${near[0]})`);
        if (rest.length) out.push(`${label}: ${rest.join(', ')}`);
      }
    } finally {
      for (const k of ['Mouse0', 'Mouse2', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyQ', 'KeyE']) key(k, false);
      g.s.r.render = draw;
      T.freeze(wasFrozen);
    }
    return { id, slot, action: wp.action?.name ?? null, out };
  },
};

W.S = S;
export default S;
