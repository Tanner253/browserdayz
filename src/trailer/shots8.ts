// The eighth film: forty-five seconds (18 bars at 96 BPM) on what the guns have become, and what the hands now do.
// Made the way the others were (the real game on a clock that only moves when the film says), and filmed
// another way altogether, as it was asked: "new musics and a new shooting format, we need to feel fresh".
//
// The seven before it are told out of doors, from over a shoulder or through the player's eyes, with cards. This
// one is a spec sheet. Each new gun hangs alone in a lit room, turned in the light, and takes its parts one at a
// time on the beat: its magazine, its sight, its suppressor, each named on a fine line as it goes on. Then the
// hands: a gun looked over, a box of rounds torn open, a magazine filled a round at a time and put in the rifle,
// a bandage, an injector, each with the one number it changes counted beside it. Then the police car at dusk,
// the four guns fired, and where it is played.
//
// It was cut first at thirty seconds, as asked, and to fit them everything the hands do was run faster than it
// is done: "the animations and video play too fast, the entire video is too fast". So it is cut again at the
// pace of the game: nothing in it runs at any speed but its own (no shot has a `rate`), the parts go on a beat
// apart and not half of one, and it is as long as that takes. And the room was black, and what is black on a
// gun was not to be seen in it ("supressor is not loading in the render, the background being black makes it
// too hard to see"): it is a grey wall now, lit behind the gun.
//
// What is on the sheet is read off the rules as the film is made (a gun's round and rate, what a magazine holds,
// what a bandage gives back), and a part is hung on a gun only if the game lets it be: a film made after the
// rules change says what they say then. Nothing is shown that is not in the game that is live (so no weapon
// light on the AK or the submachine gun: that is local yet).

import * as THREE from 'three';
import type { CamPose, Shot, Stage } from './director';
import { BEAT8, SECONDS8 } from './music8';
import { assets } from '../core/assets';
import { audio } from '../core/audio';
import { ITEMS, makeItem, type ItemInstance } from '../sim/items';
import { CARTRIDGES, GUNS } from '../sim/gunplay';
import { POLICE_CAR, SEATS } from '../sim/vehicles';
import { CAR_SIT } from '../game/avatar';
import { TOWN } from '../world/worldgen';
import { CONTRACT, DISCORD, X_HANDLE } from '../ui/hud';

/**
 * How long this film is. The whole of it, unless it is the cut made for the main menu (`&menu` on the address:
 * `node scripts/film.mjs --cut 8 --menu`): the four guns and their parts and nothing else, with none of the film's
 * own words, and each gun set to the right of the picture, where the menu leaves room. That one is played by the
 * menu between its own scenes (public/menu/armoury.mp4: see src/game/menu-scenes.ts).
 */
export let seconds8 = SECONDS8;
const MENU = typeof location !== 'undefined' && new URLSearchParams(location.search).has('menu');

const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const beats = (n: number) => n * BEAT8;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Extra = { g?: string | null; fadeIn?: number; fadeOut?: number; flash?: number; hour?: number; word?: [string, string]; chip?: [string, string]; grid?: number };

/** The sheet: each new gun, how many beats it has, and what is put on it, a step at a time (each step is everything on it by then). `at`: the beat each step is taken on. */
const SHEET: { id: string; len: number; steps: string[][]; at: number[] }[] = [
  { id: 'ak', len: 8, steps: [[], ['mag_ak'], ['mag_ak', 'red_dot'], ['mag_ak', 'red_dot', 'suppressor_739'], ['drum_ak', 'red_dot', 'suppressor_739']], at: [0, 1, 2, 3, 5] },
  { id: 'ar15', len: 8, steps: [[], ['mag_ar'], ['mag_ar', 'red_dot'], ['mag_ar', 'red_dot', 'suppressor_556'], ['mag_ar', 'red_dot', 'suppressor_556', 'foregrip'], ['mag_ar', 'red_dot', 'suppressor_556', 'foregrip', 'gun_light'], ['mag_ar_60', 'red_dot', 'suppressor_556', 'foregrip', 'gun_light']], at: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'mpa', len: 4, steps: [[], ['mag_mpa'], ['mag_mpa', 'red_dot'], ['mag_mpa', 'red_dot', 'suppressor_9']], at: [0, 1, 2, 3] },
  { id: 'colt', len: 4, steps: [[], ['mag_colt'], ['mag_colt', 'suppressor_9'], ['mag_colt', 'suppressor_9', 'red_dot'], ['mag_colt', 'suppressor_9', 'red_dot', 'gun_light']], at: [0, 0.75, 1.5, 2.25, 3] },
];

interface Rack {
  id: string;
  steps: string[][];
  at: number[];
  /** what is turned, and inside it what is moved so that the gun's middle is the middle */
  pivot: THREE.Group;
  /** the gun at each step */
  looks: THREE.Object3D[];
  len: number;
  high: number;
  /** where the part put on at each step is, in the pivot's own space */
  anchors: (THREE.Vector3 | null)[];
  calls: (HTMLElement | null)[];
  /** each label's row: over the gun or under it */
  rows: number[];
  spec: HTMLElement;
  drops: (() => void)[];
}

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  document.body.classList.add('tr-cut8');
  const scene = g.s.r.scene as THREE.Scene, camera = g.s.r.camera as THREE.PerspectiveCamera;
  const P = (x: number, z: number, up = 0) => S.at(x, z, up);

  // ------------------------------------------------------------ places
  const T = TOWN, ul = Math.hypot(T.street[0], T.street[1]), ux = T.street[0] / ul, uz = T.street[1] / ul;
  /** a place in Kamenka: so far down its street, so far to the right of it */
  const K = (along: number, right = 0, up = 0) => P(T.x + ux * along + uz * right, T.z + uz * along - ux * right, up);
  /** the way the street runs, as a way to face */
  const DOWN = Math.atan2(-ux, -uz);

  // ------------------------------------------------------------ the look
  const overlay = document.getElementById('tr-overlay')!;
  const piece = (cls: string) => {
    const el = document.createElement('div');
    el.className = cls;
    overlay.appendChild(el);
    return el;
  };
  const grain = piece('tr-grain4'), black = piece('tr-black4'), white = piece('tr-flash4'), grid = piece('x8-grid');
  piece('tr-vig4');
  const GRADES = ['cold', 'warm', 'war', 'gold', 'dust', 'dim', 'dim5', 'gas'];
  const grade = (name: string | null) => { for (const n of GRADES) document.body.classList.toggle(`tr-g-${n}`, n === name); };
  let frame = 0;
  const look = (t: number, len: number, o: Extra) => {
    frame++;
    grain.style.transform = `translate(${((frame * 73) % 97) - 48}px, ${((frame * 41) % 89) - 44}px)`;
    const a = o.fadeIn ? 1 - ease(t / o.fadeIn) : 0, z = o.fadeOut ? ease((t - (len - o.fadeOut)) / o.fadeOut) : 0;
    black.style.opacity = String(Math.max(a, z));
    white.style.opacity = String(o.flash ? Math.max(0, 1 - t / 0.08) * o.flash : 0);
    grid.style.setProperty('--o', String(o.grid ?? 1));
  };
  /** a lens held in a hand */
  const hand = (pose: CamPose, t: number, amp = 1, seed = 0): CamPose => {
    const n = (f: number, ph: number) => Math.sin(t * f + ph + seed) * 0.6 + Math.sin(t * f * 2.3 + ph * 1.7 + seed) * 0.4;
    const p = pose.p.clone(), l = pose.l.clone();
    p.x += n(1.9, 0.3) * 0.014 * amp;
    p.y += n(2.3, 1.1) * 0.011 * amp;
    p.z += n(1.7, 2.2) * 0.014 * amp;
    l.x += n(2.9, 4.1) * 0.022 * amp;
    l.y += n(3.3, 5.2) * 0.017 * amp;
    l.z += n(2.6, 0.7) * 0.022 * amp;
    return { ...pose, p, l, roll: (pose.roll ?? 0) + n(1.3, 3.3) * 0.004 * amp };
  };

  // ------------------------------------------------------------ the film's own graphics
  const gfx: HTMLElement[] = [];
  const g8 = (cls: string, html: string) => {
    const el = document.createElement('div');
    el.className = `tr-gfx ${cls}`;
    el.innerHTML = html;
    el.style.display = 'none';
    overlay.appendChild(el);
    gfx.push(el);
    return el;
  };
  const show = (el: HTMLElement, t: number, o = 1) => {
    el.style.display = '';
    el.style.setProperty('--t', t.toFixed(3));
    el.style.setProperty('--o', o.toFixed(3));
  };
  const chip = g8('x8-chip', '<b></b><span></span>'), word = g8('x8-word', '<b></b><span></span>');
  const mark = g8('x8-mark', 'ZONA <i>·</i> THE ARMOURY UPDATE');
  const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  lines.setAttribute('class', 'x8-lines');
  lines.setAttribute('viewBox', '0 0 1600 900');
  lines.setAttribute('preserveAspectRatio', 'none');
  overlay.appendChild(lines);
  const two = (n: number) => String(Math.max(0, Math.round(n))).padStart(2, '0');
  /** a number with what it counts, a bar under it, and a line of words */
  const counter = (kick: string, line: string, unit = '', of = '') => g8('x8-count', `<div class="c8-kick">${kick}</div><div class="c8-n"><b>00</b>${of ? `<i>/ ${of}</i>` : ''}${unit ? `<em>${unit}</em>` : ''}</div><div class="c8-bar"></div><div class="c8-line">${line}</div>`);
  const count = (el: HTMLElement, t: number, n: number, share: number, since = 1) => {
    show(el, t, Math.min(1, ease(t / 0.15)));
    el.querySelector('b')!.textContent = two(n);
    el.style.setProperty('--w', `${(Math.min(1, Math.max(0, share)) * 100).toFixed(1)}%`);
    // (the number jumps as it changes)
    el.style.setProperty('--k', (1 + Math.max(0, 1 - since / 0.16) * 0.16).toFixed(3));
  };

  // ------------------------------------------------------------ the black room
  const HOME = K(96, 30);
  const O = new THREE.Vector3(HOME.x, HOME.y + 170, HOME.z);
  const room = new THREE.Group();
  room.position.copy(O);
  room.visible = false;
  scene.add(room);
  // Its wall: grey where the lens looks, as a wall is that has a lamp turned on it, and falling away to near black
  // round that. (It was black all over, and whatever is black on a gun was not to be seen against it: the pistols'
  // suppressor was a label on a line to nothing.)
  const WALL = { lit: [0.34, 0.35, 0.33], dark: [0.035, 0.037, 0.034], wide: 0.62 };
  const shellGeo = new THREE.SphereGeometry(46, 72, 36);
  const shell = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  shell.frustumCulled = false;
  room.add(shell);
  /** the wall painted for a lens that stands at this bearing: lit behind what it looks at */
  const paintWall = (az: number) => {
    const P = shellGeo.getAttribute('position'), n = P.count, col = new Float32Array(n * 3);
    // (the middle of the lit part: straight through the room from the lens, and a little below its line)
    const mid = new THREE.Vector3(-Math.sin(az), -0.1, -Math.cos(az)).normalize(), v = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const k = Math.pow(THREE.MathUtils.smoothstep(v.fromBufferAttribute(P, i).normalize().dot(mid), 1 - WALL.wide, 1), 1.6);
      c.setRGB(WALL.dark[0] + (WALL.lit[0] - WALL.dark[0]) * k, WALL.dark[1] + (WALL.lit[1] - WALL.dark[1]) * k, WALL.dark[2] + (WALL.lit[2] - WALL.dark[2]) * k, THREE.SRGBColorSpace);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    shellGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  };
  // two lamps of the film's own behind what is shown, one warm and one cold (they are in the scene from the first
  // frame, dark, so that nothing has to be made ready again when they come on)
  // (A gun is dark steel, and under the sky alone in a black room it was a flat grey shape, and anything black on
  // it was not there at all. So it is lit as a thing is lit to be photographed: a key lamp over the lens's left
  // shoulder, a cold one low on its right, and the two behind to draw its edges.)
  const RIM = { warm: 50, cold: 38, key: 26, kick: 9 };
  const LIT: Record<string, number> = { ak: 0.48, ar15: 1, mpa: 0.7, colt: 0.6 };
  const warm = new THREE.PointLight(0xffb45e, 0, 8, 2), cold = new THREE.PointLight(0x7fb2ff, 0, 8, 2);
  const keyLamp = new THREE.PointLight(0xfff1dc, 0, 8, 2), kick = new THREE.PointLight(0x9fc4ff, 0, 8, 2);
  room.add(warm, cold, keyLamp, kick);
  const sun = (g.s.atmo.sunDir as THREE.Vector3).clone(), sunAz = Math.atan2(sun.x, sun.z);
  /** where the lens stands, round the room: the sun over its left shoulder */
  const AZ = sunAz - 0.85;
  paintWall(AZ);

  /** the box round what is seen of a thing (its own hiding is not asked: the gun at a step is put out of sight until its step comes) */
  const boxOf = (o: THREE.Object3D) => {
    const box = new THREE.Box3();
    o.updateWorldMatrix(true, true);
    const walk = (n: THREE.Object3D) => {
      if (!n.visible && n !== o) return;
      const m = n as THREE.Mesh;
      if (m.isMesh) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
      }
      for (const c of n.children) walk(c);
    };
    walk(o);
    return box;
  };
  const says = (gun: string, mod: string) => {
    const d = ITEMS[mod];
    if (!d?.attach?.fits.includes(gun)) throw new Error(`the ${mod} does not go on the ${gun}: the sheet is wrong`);
    return d.mag ? `<b>${d.mag.capacity}</b>${/drum/i.test(d.name) ? 'ROUND DRUM' : 'ROUND MAGAZINE'}` : d.name;
  };
  const racks: Rack[] = SHEET.map(({ id, steps, at }, nth) => {
    const pivot = new THREE.Group(), inner = new THREE.Group();
    pivot.add(inner);
    pivot.visible = false;
    room.add(pivot);
    const looks = steps.map((mods) => {
      const h = g.makeHeld(id, mods) as { obj: THREE.Object3D } | null;
      if (!h) throw new Error(`there is no ${id} to show`);
      inner.add(h.obj);
      h.obj.visible = false;
      return h.obj;
    });
    const last = looks[looks.length - 1];
    room.updateMatrixWorld(true);
    // its length is laid along the pivot's own x, and its middle put at the pivot's
    let box = boxOf(last), size = box.getSize(new THREE.Vector3());
    if (size.z > size.x) {
      inner.rotation.y = Math.PI / 2;
      room.updateMatrixWorld(true);
      box = boxOf(last);
      size = box.getSize(new THREE.Vector3());
    }
    inner.position.sub(box.getCenter(new THREE.Vector3()).sub(O));
    room.updateMatrixWorld(true);
    const anchors = steps.map((_, k) => {
      if (!k) return null;
      const fresh = looks[k].children.filter((c, i) => c.visible && !looks[k - 1].children[i]?.visible);
      if (!fresh.length) return null;
      const b = new THREE.Box3();
      for (const c of fresh) b.union(boxOf(c));
      return b.isEmpty() ? null : b.getCenter(new THREE.Vector3()).sub(O);
    });
    const calls = steps.map((mods, k) => {
      const mod = k ? mods.find((m) => !steps[k - 1].includes(m)) : undefined;
      if (!mod) return null;
      const el = document.createElement('div');
      el.className = 'x8-call';
      el.innerHTML = says(id, mod);
      el.dataset.mod = mod;
      el.style.display = 'none';
      overlay.appendChild(el);
      return el;
    });
    // (what hangs under a gun is named under it: its magazine, a grip, a light; what stands on it or goes on its end, over it)
    const rows = calls.map((el) => (!el ? 0 : ITEMS[el.dataset.mod!].mag || /grip|light/.test(el.dataset.mod!) ? 1 : -1));
    const gun = GUNS[id], round = CARTRIDGES[gun.ammo], mags = Object.values(ITEMS).filter((d) => d.mag && d.attach?.fits.includes(id)).map((d) => d.mag!.capacity).sort((p, q) => p - q);
    const spec = g8('x8-spec', `
      <div class="s8-idx">${two(nth + 1)} / ${two(SHEET.length)} &nbsp;·&nbsp; NEW</div>
      <div class="s8-name">${ITEMS[id].name}</div>
      <div class="s8-rows">
        <i>ROUND</i><span>${round.name}</span>
        <i>FIRE</i><span>${gun.auto ? `AUTOMATIC · ${gun.rpm} A MINUTE` : 'ONE TO A PULL'}</span>
        <i>MAGAZINE</i><span>${mags.join(' OR ')} ROUNDS</span>
      </div>`);
    console.log(`[tr] cut 8: the ${id} is ${size.x.toFixed(2)} m long and ${size.y.toFixed(2)} high; parts found at ${anchors.map((a) => (a ? `${a.x.toFixed(2)},${a.y.toFixed(2)}` : '-')).join(' | ')}`);
    return { id, steps, at, pivot, looks, len: size.x, high: size.y, anchors, calls, rows, spec, drops: [] };
  });
  const rackOf = (id: string) => racks.find((r) => r.id === id)!;
  /** the room, with one gun in it or none; the guns not in it give up their big pictures */
  const stage = (r: Rack | null, on = true) => {
    room.visible = on;
    warm.intensity = on ? RIM.warm : 0;
    cold.intensity = on ? RIM.cold : 0;
    keyLamp.intensity = on ? RIM.key : 0;
    kick.intensity = on ? RIM.kick : 0;
    for (const q of racks) {
      q.pivot.visible = q === r;
      for (const c of q.calls) if (c) c.style.display = 'none';
      if (q !== r) {
        for (const drop of q.drops) drop();
        q.drops = [];
      } else if (!q.drops.length) {
        note(q.pivot);
        q.drops = q.looks.map((o) => assets.sharpen(o));
      }
    }
    lines.innerHTML = '';
  };
  const paints = (root: THREE.Object3D) => {
    const out: Any[] = [];
    const walk = (o: THREE.Object3D) => {
      // (what is put out of sight on it is not given its own pictures, and is not waited for)
      if (!o.visible && o !== root) return;
      const m = (o as THREE.Mesh).material as Any;
      for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) if (mat.userData?.hi && mat.map) out.push(mat);
      for (const c of o.children) walk(c);
    };
    walk(root);
    return out;
  };
  /** what a thing is painted with now, written down: so that it can be told when that has been changed for its own pictures */
  const before = new WeakMap<object, unknown>();
  const note = (root: THREE.Object3D | null) => {
    if (root) for (const mat of paints(root)) if (!before.has(mat)) before.set(mat, mat.map);
  };
  /** whether everything a thing is painted with is there at the size it came (changed since it was written down, or big already) */
  const sharp = (root: THREE.Object3D) => paints(root).every((mat) => mat.map !== before.get(mat) || (mat.map.userData?.was?.[0] ?? mat.map.image?.width ?? 0) > 1024);
  /**
   * A thing the hands do is begun before its shot opens (the film comes in part of the way through it), and what
   * the game plays as it begins is played then, where nobody is listening: so the film lays those sounds itself,
   * at the moment in the picture each belongs to. `cue(t, at, play)`: once, as the shot passes `at`.
   */
  let cued = new Set<number>();
  const cue = (t: number, at: number, play: () => void) => {
    const k = Math.round(at * 1000);
    if (t < at || cued.has(k)) return;
    cued.add(k);
    play();
  };
  /** frames nobody sees or hears */
  const run = async (frames: number, each?: (k: number) => boolean | void) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      if (each?.(i) === false) break;
      for (const a of S.actors) a.push();
      clock.advance(1000 / 60);
      if (i % 20 === 19) await wait(8);
    }
    S.mute = false;
  };
  /** time for the pictures a thing came with to be fetched, unpacked and put on: they go on one at a time as the clock moves */
  const sharpen = async (root: () => THREE.Object3D | null | undefined, what: string) => {
    for (let k = 0; k < 14; k++) {
      await run(10);
      await wait(220);
      const o = root();
      if (o && sharp(o)) return void console.log(`[tr] cut 8: ${what} is at its own pictures after ${((k + 1) * 0.22).toFixed(1)} s`);
    }
    const o = root();
    const left = o ? [...new Set(paints(o).filter((mat) => mat.map === before.get(mat) && (mat.map.userData?.was?.[0] ?? mat.map.image?.width ?? 0) <= 1024).map((mat) => `${mat.userData.hi[0]}#${mat.userData.hi[1]}`))] : [];
    console.log(`[tr] cut 8: ${what} was not all at its own pictures in time: still as the world has them, ${left.join(' ') || 'none'}`);
  };

  /** the lens on a gun in the room: `k` is how far through the shot it is */
  const lens = (r: Rack, k: number, close = 1, aside = 0.07): { cam: CamPose; a: number } => {
    const d = Math.max(r.len / 0.62, r.high / 0.33) * close, a = AZ + (k - 0.5) * 0.2;
    const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    // (the gun sits a little right of the middle and above it: its figures are at the bottom left)
    const l = O.clone().addScaledVector(right, -d * aside).setY(O.y - d * 0.045);
    return { cam: { p: l.clone().add(new THREE.Vector3(Math.sin(a) * d, d * 0.11, Math.cos(a) * d)), l, fov: 30 }, a };
  };
  const turn = (r: Rack, a: number, k: number, more = 0) => {
    // turned three quarters to the lens at first, and coming round to lie across it
    r.pivot.rotation.set(0, a + 0.46 - ease(k) * 0.34 + more, 0.05);
    const back = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)), right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    // (each as far off as the gun is long, so that a pistol is lit as a rifle is)
    const u = Math.max(0.5, r.len);
    warm.position.copy(back).multiplyScalar(0.7 * u).addScaledVector(right, -1.25 * u).setY(0.95 * u);
    cold.position.copy(back).multiplyScalar(0.8 * u).addScaledVector(right, 1.3 * u).setY(-0.55 * u);
    keyLamp.position.copy(back).multiplyScalar(-1.5 * u).addScaledVector(right, -0.9 * u).setY(1.0 * u);
    kick.position.copy(back).multiplyScalar(-1.2 * u).addScaledVector(right, 1.2 * u).setY(-0.45 * u);
    // (and as bright as its own colour wants: the AK's grey steel under the light that suits a black rifle is a white one)
    const lit = LIT[r.id] ?? 1;
    for (const [l, k] of [[warm, RIM.warm], [cold, RIM.cold], [keyLamp, RIM.key], [kick, RIM.kick]] as [THREE.PointLight, number][]) if (l.intensity) l.intensity = k * u * u * lit;
  };
  const SVG = (tag: string, at: Record<string, string | number>) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(at)) el.setAttribute(k, String(v));
    lines.appendChild(el);
    return el;
  };
  const _v = new THREE.Vector3();
  /** the labels of a gun as it stands at a step: each on its line to its part, as it is seen now */
  const label = (r: Rack, step: number, t: number) => {
    lines.innerHTML = '';
    room.updateMatrixWorld(true);
    const live: { el: HTMLElement; x: number; y: number; row: number; age: number }[] = [];
    r.calls.forEach((el, k) => {
      if (!el) return;
      const a = r.anchors[k], on = k <= step && r.steps[step].includes(el.dataset.mod!);
      if (!on || !a) return void (el.style.display = 'none');
      _v.copy(a).applyMatrix4(r.pivot.matrixWorld).project(camera);
      live.push({ el, x: (_v.x * 0.5 + 0.5) * 100, y: (0.5 - _v.y * 0.5) * 100, row: r.rows[k], age: t - beats(r.at[k]) });
    });
    for (const row of [-1, 1]) {
      // (side by side in their row, in the order their parts are in, and never one on another)
      const list = live.filter((q) => q.row === row).sort((p, q) => p.x - q.x);
      const xs = list.map((q) => Math.min(MENU ? 68 : 88, Math.max(MENU ? 42 : row < 0 ? 16 : 40, q.x)));
      for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + (MENU ? 12.5 : 17));
      const over = xs.length ? Math.max(0, xs[xs.length - 1] - (MENU ? 70 : 90)) : 0;
      list.forEach((q, i) => {
        const x = xs[i] - over, y = MENU ? (row < 0 ? 31 : 66) : row < 0 ? 19 : 71;
        q.el.style.display = '';
        q.el.style.left = `${x}%`;
        q.el.style.top = `${y}%`;
        q.el.style.setProperty('--o', ease(q.age / 0.07).toFixed(3));
        q.el.style.setProperty('--k', (1 + Math.max(0, 1 - q.age / 0.16) * 0.22).toFixed(3));
        q.el.classList.toggle('new', q.age < 0.24);
        SVG('line', { x1: x * 16, y1: (y + (row < 0 ? 2.6 : -2.6)) * 9, x2: q.x * 16, y2: q.y * 9 });
        SVG('circle', { class: 'dot', cx: q.x * 16, cy: q.y * 9, r: 4.5 });
        if (q.age < 0.3) SVG('circle', { cx: q.x * 16, cy: q.y * 9, r: 6 + q.age * 150, opacity: Math.max(0, 1 - q.age / 0.3).toFixed(2) });
      });
    }
  };

  // ------------------------------------------------------------ the hands
  const give = (id: string, set: Partial<ItemInstance> = {}, qty?: number) => {
    const it = makeItem(id, qty) as ItemInstance;
    Object.assign(it, set);
    if (g.inv.add(it)) throw new Error(`no room for the ${id}`);
    return it;
  };
  /** the player stood somewhere with nothing but a pack, whole, and nothing in the hands */
  const me = (at: THREE.Vector3, yaw: number, pitch = 0) => {
    S.me(at.x, at.z, yaw, pitch);
    if (g.use) g.breakOff();
    g.emptyHands();
    const neck = g.inv.neck;
    g.inv.clear();
    g.inv.neck = neck;
    g.inv.hot = [];
    give('suitcase');
    g.inventoryChanged();
    g.lit = false;
  };
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
  /** a key put down or let go, said to the game only when it changes (said again while it is down, it is a fresh press) */
  const held = new Set<string>();
  const key = (code: string, down: boolean) => {
    if (held.has(code) === down) return;
    if (down) held.add(code);
    else held.delete(code);
    S.key(code, down);
  };
  const car = ([...g.garage.jeeps.values()] as Any[]).find((j) => j.kind === POLICE_CAR.kind) ?? null;
  if (!car) throw new Error('there is no police car on the map');
  const carHome = [car.pos.x, car.pos.y, car.pos.z, car.quat.x, car.quat.y, car.quat.z, car.quat.w, 0, 0, 0, 0, 0];
  const carLamps = ((g.garage.extra as Map<unknown, { lamps: THREE.MeshStandardMaterial[] }>).get(car)?.lamps ?? []) as THREE.MeshStandardMaterial[];
  const litCars = g.garage.lit.bind(g.garage);
  let driving = false;
  // (its headlights are thrown by the game for whichever cars it says are lit: while the film drives this one, that is this one)
  g.garage.lit = function* () {
    if (driving) yield car;
    else yield* litCars();
  };
  const reset = (hide: THREE.Vector3) => {
    for (const a of S.actors) {
      a.dance = a.surrender = a.crouch = a.aim = a.sprint = false;
      a.foe = null;
      (a.rp as Any).seat = null;
      a.hide();
    }
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Mouse0', 'Mouse2', 'AltLeft', 'KeyI', 'KeyR']) S.key(k, false);
    held.clear();
    me(hide, 0);
    S.clean();
    hush();
    stage(null, false);
    if (driving) {
      driving = false;
      car.place(carHome);
      for (const m of carLamps) m.emissiveIntensity = 0;
    }
  };

  // ------------------------------------------------------------ the set
  const shots: Shot[] = [];
  /** how long the word that opens a part of the sheet has the screen, seconds (it had five frames, and was a flicker) */
  const WORD = 0.34;
  let cur = 0;
  const add = (len: number, s: Omit<Shot, 'start' | 'end'> & Extra) => {
    const L = beats(len), setup = s.setup, after = s.after, start = cur;
    cur += len;
    shots.push({
      bars: false,
      ...s,
      start: beats(start),
      end: beats(start + len),
      setup: async (st) => {
        cued = new Set();
        grade(s.g ?? null);
        for (const el of gfx) el.style.display = 'none';
        // (The black room is at night unless a shot says otherwise. By day every bit of steel in it mirrored the whole bright
        // sky, which no wall keeps out, and a blued rifle was the colour of putty: at night its own lamps are all the light there is.)
        g.hourHeld = s.hour ?? 0.9;
        if (s.chip) {
          chip.querySelector('b')!.textContent = s.chip[0];
          chip.querySelector('span')!.textContent = s.chip[1];
        }
        await setup?.(st);
      },
      after: (t, st) => {
        after?.(t, st);
        look(t, L, s);
        if (s.chip) {
          show(chip, t);
          show(mark, t);
        }
        // (the word that opens a part of the sheet: the whole screen for a few frames, then the thing itself)
        const w = s.word && t < WORD ? s.word : null;
        word.style.display = w ? '' : 'none';
        if (w) {
          word.querySelector('b')!.textContent = w[0];
          word.querySelector('span')!.textContent = w[1];
          word.style.setProperty('--k', (1.06 - (t / WORD) * 0.06).toFixed(3));
        }
      },
    });
  };
  const A = (i: number) => S.actors[i];

  // ------------------------------------------------------------ 1. the card: the first frame is the picture the film is known by
  const parts = Object.values(ITEMS).filter((d) => d.attach && !d.mag).length, magazines = Object.values(ITEMS).filter((d) => d.mag).length;
  const card = g8('x8-card', `
    <div class="k8-kick">THE ARMOURY UPDATE &nbsp;·&nbsp; LIVE NOW</div>
    <div class="k8-logo">ZONA</div>
    <div class="k8-line">EVERY ROUND IS YOURS TO LOAD</div>
    <div class="k8-tiles">
      <div><b>${SHEET.length}</b><span>NEW GUNS</span></div>
      <div><b>${parts}</b><span>PARTS TO FIT</span></div>
      <div><b>${magazines}</b><span>MAGAZINES</span></div>
      <div><b>${Object.keys(CARTRIDGES).length}</b><span>CALIBRES</span></div>
    </div>`);
  /** the card's gun: turned well toward the lens and set to the right of the words */
  const CARD = { more: 0.5, close: 0.66, aside: 0.3 };
  const dress = async (r: Rack, cam: CamPose) => {
    reset(HOME);
    r.looks.forEach((o, k) => (o.visible = k === r.looks.length - 1));
    r.pivot.visible = true;
    stage(r);
    S.cam = cam;
    await sharpen(() => r.pivot, `the ${r.id}`);
    S.cam = null;
  };
  if (!MENU) add(4, {
    name: 'card',
    setup: async () => {
      const r = rackOf('ak');
      turn(r, AZ, 0, CARD.more);
      await dress(r, lens(r, 0, CARD.close, CARD.aside).cam);
    },
    cam: (t) => {
      const r = rackOf('ak'), k = t / beats(4), o = lens(r, k, CARD.close - k * 0.05, CARD.aside);
      turn(r, o.a, k * 0.4, CARD.more);
      return hand(o.cam, t, 0.4);
    },
    // (as it stands when it has arrived, from the first frame)
    after: (t) => show(card, t + 1),
    grid: 0.6,
  });

  // ------------------------------------------------------------ 2. the four guns, their parts a beat apart
  SHEET.forEach(({ id, len: n }, nth) => {
    const r = rackOf(id), len = beats(n);
    let done = -1;
    // (for the menu: further off and well to the right, with no words of the film's own on it)
    // (The menu has its own words down the left of the picture and its news down the right, and on a very wide screen
    // only the middle half of the height is seen at all: the gun and its labels are kept to the middle of both.)
    const [far, aside] = MENU ? [1.86, 0.07] : [1, 0.07];
    add(n, {
      name: `gun-${id}`,
      flash: MENU ? 0 : 0.45,
      chip: MENU ? undefined : ['01', 'THE GUNS'],
      word: nth || MENU ? undefined : ['GUNS', 'FOUR NEW ONES · AND WHAT GOES ON THEM'],
      grid: MENU ? 0 : 1,
      setup: async () => {
        done = 0;
        turn(r, AZ, 0);
        await dress(r, lens(r, 0, far, aside).cam);
        r.looks.forEach((o, k) => (o.visible = k === 0));
      },
      cam: (t) => {
        const k = t / len, o = lens(r, k, far * (1 - k * 0.05), aside);
        turn(r, o.a, k);
        return hand(o.cam, t, 0.35, nth);
      },
      after: (t) => {
        let step = 0;
        r.at.forEach((h, k) => { if (t >= beats(h)) step = k; });
        r.looks.forEach((o, k) => (o.visible = k === step));
        if (step > done) {
          done = step;
          // (heard as it is in the game: a magazine going home, or a part clicked on to its rail)
          const mod = r.calls[step]?.dataset.mod;
          if (mod && ITEMS[mod].mag) audio.magIn(0, id !== 'colt');
          else {
            audio.click(2600, 0.4, 0.03);
            audio.click(1900, 0.45, 0.05, 0.14);
          }
        }
        label(r, step, t);
        if (!MENU) show(r.spec, t, ease(t / 0.2));
      },
    });
  });
  if (MENU) {
    seconds8 = beats(cur);
    console.log(`[tr] cut 8, for the menu: ${shots.length} shots, ${seconds8.toFixed(2)} s`);
    return shots;
  }

  // ------------------------------------------------------------ 3. a gun looked over, at the pace it is turned at
  const VIEW = { at: K(-46, 0.9), yaw: DOWN };
  const heldRoot = () => (g.weapons.current?.root ?? null) as THREE.Object3D | null;
  const looked = counter('PRESS &nbsp;I', 'ANY TIME YOUR HANDS ARE FREE OF A FIGHT', 'LOOK IT OVER');
  // (a name is not a number: the big figure's place holds the gun's name, smaller)
  (looked.querySelector('.c8-n b') as HTMLElement).style.fontSize = '9vh';
  (looked.querySelector('.c8-bar') as HTMLElement).style.display = 'none';
  add(8, {
    name: 'look',
    flash: 0.5,
    hour: 0.3,
    g: 'warm',
    chip: ['02', 'LOOK IT OVER'],
    word: ['INSPECT', 'PRESS I'],
    grid: 0.35,
    setup: async () => {
      reset(VIEW.at);
      me(VIEW.at, VIEW.yaw + 0.25, -0.03);
      const gun = give('mpa', { mag: 'mag_mpa', loaded: 31, mods: ['red_dot', 'suppressor_9'] });
      g.takeUp(gun);
      note(heldRoot());
      await run(50);
      await sharpen(heldRoot, 'the mpa in the hands');
      S.key('KeyI', true);
      await run(2);
      S.key('KeyI', false);
      const act = g.weapons.action;
      if (act?.name !== 'check') return void console.log(`[tr] cut 8: the gun was not looked over (${act?.name ?? 'nothing begun'})`);
      // (It is seven seconds of turning over, and five of them are shown, as they are: from where the gun has begun
      // to come round. The frames the director runs unseen before the first one filmed are part of the way there.)
      await run(600, () => g.weapons.action?.name === 'check' && g.weapons.action.t < act.dur * 0.1 - 0.4);
      console.log(`[tr] cut 8: the gun is looked over in ${act.dur.toFixed(2)} s; ${beats(8).toFixed(2)} s of it are filmed, from ${(g.weapons.action.t + 0.4).toFixed(2)} s`);
    },
    after: (t) => {
      show(looked, t, ease(t / 0.15));
      looked.querySelector('b')!.textContent = ITEMS.mpa.name.toUpperCase();
    },
  });

  // ------------------------------------------------------------ 4. rounds, by hand
  const BENCH = { at: K(-18, -1.4), yaw: DOWN + 2.3 };
  const box = ITEMS.box_739, loose = ITEMS[box.open!.gives], akMag = ITEMS.mag_ak;
  let was = 0, wasAt = -1;
  /** a number watched for its changing: when it last did, for the jump its figure makes */
  const since = (n: number, t: number) => {
    if (n !== was) {
      was = n;
      wasAt = t;
    }
    return wasAt < 0 ? 1 : t - wasAt;
  };
  const unboxed = counter(`${box.name.toUpperCase()}`, 'TORN OPEN IN YOUR HANDS', `LOOSE ${CARTRIDGES[GUNS.ak.ammo].name} ROUNDS`);
  add(4, {
    name: 'unbox',
    flash: 0.5,
    hour: 0.42,
    chip: ['03', 'BY HAND'],
    word: ['BY HAND', 'AMMUNITION IS WORK NOW'],
    grid: 0.35,
    setup: async () => {
      reset(BENCH.at);
      me(BENCH.at, BENCH.yaw, -0.06);
      was = 0;
      wasAt = -1;
      g.takeUp(give('box_739'));
      await run(45);
    },
    // (begun as the picture opens, and seen through: it is two seconds' work)
    tick: (t) => { if (t > 0.05) key('Mouse0', true); },
    after: (t) => {
      const n = g.inv.count(loose.id) as number;
      count(unboxed, t, n, n / box.open!.qty, since(n, t));
    },
  });
  let mag: ItemInstance | null = null;
  const filled = counter(`${akMag.name.toUpperCase()}`, 'ONE ROUND AT A TIME · HOLD THE BUTTON', '', String(akMag.mag!.capacity));
  add(4, {
    name: 'fill',
    hour: 0.42,
    chip: ['03', 'BY HAND'],
    grid: 0.35,
    setup: async () => {
      // (what came out of the box is in the pockets: the magazine comes up to be filled from it)
      reset(BENCH.at);
      me(BENCH.at, BENCH.yaw, -0.06);
      give(loose.id, {}, box.open!.qty);
      mag = give('mag_ak', { rounds: 8 });
      was = 8;
      wasAt = -1;
      g.takeUp(mag);
      await run(48);
      // (the first round is on its way as the picture opens: three go in while it is watched, each in its own time)
      key('Mouse0', true);
      await run(8);
    },
    after: (t) => {
      const n = (mag?.rounds ?? 0) as number;
      count(filled, t, n, n / akMag.mag!.capacity, since(n, t));
    },
  });
  let rifle: ItemInstance | null = null, magOutAt = 0.3, magInAt = 1.3;
  const loaded = counter('THE FULL ONE IN · THE OTHER KEPT', 'A MAGAZINE IS A THING YOU CARRY, AND CAN RUN OUT OF', 'IN THE RIFLE');
  add(4, {
    name: 'reload',
    flash: 0.4,
    hour: 0.42,
    chip: ['03', 'BY HAND'],
    grid: 0.35,
    setup: async () => {
      reset(BENCH.at);
      me(BENCH.at, BENCH.yaw - 0.5, -0.02);
      was = 3;
      wasAt = -1;
      rifle = give('ak', { mag: 'mag_ak', loaded: 3, mods: ['red_dot'] });
      give('mag_ak', { rounds: akMag.mag!.capacity });
      g.takeUp(rifle);
      note(heldRoot());
      await run(50);
      await sharpen(heldRoot, 'the AK in the hands');
      S.tap('KeyR');
      await run(4);
      const act = g.weapons.action;
      if (!act) return void console.log('[tr] cut 8: the rifle was not reloaded');
      // (Begun a moment before the picture opens, so that it is done with a moment of the picture to spare. What
      // the game plays as it begins is played then, where nobody is listening: where in the picture the old
      // magazine comes out and the full one goes home is worked out from the game's own shares of the movement.)
      const opens = act.t + 0.4;
      magOutAt = Math.max(0.02, act.dur * 0.28 - opens);
      magInAt = act.dur * 0.66 - opens;
      console.log(`[tr] cut 8: the reload (${act.name}) takes ${act.dur.toFixed(2)} s; the picture opens ${opens.toFixed(2)} s into it`);
    },
    after: (t) => {
      cue(t, magOutAt, () => audio.magOut(0, true, 'ak'));
      cue(t, magInAt, () => audio.magIn(0, true, 'ak'));
      const n = (rifle?.loaded ?? 0) as number;
      count(loaded, t, n, n / (akMag.mag!.capacity + 1), since(n, t));
    },
  });

  // ------------------------------------------------------------ 5. mending
  const WARD = { at: K(8, 1.6), yaw: DOWN - 0.6 };
  const hp = () => Math.round(g.player.vitals.health as number);
  /** something mended with: the picture opens `into` seconds into the using of it (0: as it is begun) */
  const heal = (name: string, id: string, from: number, into: number, first: boolean) => {
    const use = ITEMS[id].use!;
    const el = counter(`${ITEMS[id].name.toUpperCase()} &nbsp;·&nbsp; +${use.health}`, id === 'stim' ? `BREATH FILLED · ${use.boost} SECONDS OF RUNNING FOR NOTHING` : 'BOUND ON BY HAND · THE BLEEDING STOPPED', 'HEALTH', '100');
    add(4, {
      name,
      flash: 0.5,
      hour: 0.6,
      g: 'warm',
      chip: ['04', 'MEND YOURSELF'],
      word: first ? ['MEND', 'IN YOUR HANDS, WITH THE BUTTON HELD'] : undefined,
      grid: 0.35,
      setup: async () => {
        reset(WARD.at);
        me(WARD.at, WARD.yaw + (first ? 0 : 0.5), -0.05);
        g.player.vitals.health = from;
        was = from;
        wasAt = -1;
        g.takeUp(give(id));
        await run(45);
        key('Mouse0', true);
        await run(8);
        if (!g.use) console.log(`[tr] cut 8: the ${id} was never begun on`);
        await run(600, () => !!g.use && g.use.t < into - 0.4);
      },
      after: (t) => {
        // (what the dressing gave, and no more: the body mends a point by itself while it is watched)
        const n = Math.min(hp(), from + use.health!);
        count(el, t, n, n / 100, since(n, t));
      },
    });
  };
  // (a bandage is three seconds' work: the last two and a bit of them; an injector is two and a half: all of it)
  heal('bandage', 'bandage', 55, ITEMS.bandage.use!.time - beats(4) + 0.25, true);
  heal('stim', 'stim', 55 + ITEMS.bandage.use!.health!, 0, false);

  // ------------------------------------------------------------ 6. the police car, after dark
  // down the town's own street, from its top end toward its middle (the road in from the old valley stops short of
  // the town, in the wood: it was driven first, and was a pair of lamps in the dark)
  const DRIVE = { speed: 13.5, from: -92 };
  const onRoad = (t: number) => {
    const along = DRIVE.from + Math.max(0, t) * DRIVE.speed, a = K(along - 1.6, 0), z = K(along + 1.6, 0), at = K(along, 0);
    const pitch = Math.atan2(z.y - a.y, 3.2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, DOWN, 0, 'YXZ'));
    const dir = new THREE.Vector3(ux, 0, uz);
    return { at, q, dir, right: new THREE.Vector3(-dir.z, 0, dir.x) };
  };
  const drive = (t: number) => {
    const o = onRoad(t);
    car.place([o.at.x, o.at.y + 0.81, o.at.z, o.q.x, o.q.y, o.q.z, o.q.w, o.dir.x * DRIVE.speed, 0, o.dir.z * DRIVE.speed, 0, 1]);
    return o;
  };
  const carSpec = g8('x8-spec', `
    <div class="s8-idx">A SECOND CAR TO FIND</div>
    <div class="s8-name">POLICE CAR</div>
    <div class="s8-rows"><i>SEATS</i><span>${SEATS}</span><i>LAMPS</i><span>ON WHEN IT IS DRIVEN</span><i>FOUND</i><span>PARKED ABOUT THE ZONE</span></div>`);
  /** the car coming at a lens stood low beside the road ahead of it */
  const meet = (t: number): CamPose => {
    const ahead = onRoad(1.62), o = onRoad(t);
    return { p: ahead.at.clone().addScaledVector(ahead.right, 2.5).setY(ahead.at.y + 0.6), l: o.at.clone().setY(o.at.y + 0.72), fov: 36 };
  };
  const chase = (t: number): CamPose => {
    const o = onRoad(t), ahead = onRoad(t + 0.6).at;
    return { p: o.at.clone().addScaledVector(o.dir, -8.2 + (t - beats(2)) * 1.1).addScaledVector(o.right, -2.3).setY(o.at.y + 2.5), l: ahead.clone().setY(ahead.y + 0.9), fov: 46 };
  };
  add(2, {
    name: 'car-meet',
    flash: 0.5,
    hour: 0.733,
    chip: ['05', 'THE POLICE CAR'],
    word: ['DRIVE', 'A SECOND CAR'],
    grid: 0.35,
    setup: async () => {
      const o = onRoad(0);
      reset(o.at.clone().addScaledVector(o.dir, 26).addScaledVector(o.right, 30));
      driving = true;
      for (const m of carLamps) m.emissiveIntensity = 1.8;
      A(0).place(o.at.x, o.at.z, 0, null, ['patrol_cap']);
      (A(0).rp as Any).seat = { jeep: car, at: [-0.4, -0.84, -0.32], how: CAR_SIT.front };
      S.cam = meet(0);
      await run(40, () => void drive(0));
      S.cam = null;
      console.log(`[tr] cut 8: the car is filmed with the night at ${Number(g.s.atmo.night).toFixed(2)} (its lamps throw their light over 0.3)`);
    },
    tick: (t) => { drive(t); },
    cam: (t) => hand(meet(t), t, 0.9),
    after: (t) => show(carSpec, t, ease(t / 0.2)),
  });
  add(2, {
    name: 'car-chase',
    hour: 0.733,
    chip: ['05', 'THE POLICE CAR'],
    chain: true,
    grid: 0.35,
    tick: (t) => { drive(beats(2) + t); },
    cam: (t) => hand(chase(beats(2) + t), t, 1.5),
    after: (t) => show(carSpec, t + beats(2)),
  });

  // ------------------------------------------------------------ 7. and fired
  const RANGE = { at: K(-70, 0.4), yaw: DOWN };
  const FIRED: [string, Partial<ItemInstance>, number][] = [
    ['ak', { mag: 'drum_ak', loaded: 76, mods: ['red_dot'] }, 0],
    ['mpa', { mag: 'mag_mpa', loaded: 31, mods: ['red_dot'] }, 0.5],
    ['ar15', { mag: 'mag_ar_60', loaded: 61, mods: ['red_dot', 'foregrip'] }, -0.45],
    ['colt', { mag: 'mag_colt', loaded: 8 }, 0.2],
  ];
  FIRED.forEach(([id, set, yaw], nth) => {
    const gun = GUNS[id];
    const el = g8('x8-spec', `<div class="s8-idx">${CARTRIDGES[gun.ammo].name}</div><div class="s8-name">${ITEMS[id].name}</div>`);
    add(2, {
      name: `fire-${id}`,
      flash: 0.7,
      hour: 0.64,
      g: 'gold',
      chip: ['06', 'AND FIRED'],
      word: nth ? undefined : ['FIRE', ''],
      grid: 0.25,
      setup: async () => {
        reset(RANGE.at);
        me(RANGE.at, RANGE.yaw + yaw, 0.01);
        g.takeUp(give(id, set));
        await run(52);
      },
      // (the trigger pulled and let go: ten times a second for a gun that fires on, which fires on; four for a pistol, a shot to each)
      tick: (t) => key('Mouse0', t > 0.12 && Math.floor(t * 60) % (gun.auto ? 6 : 16) < 4),
      after: (t) => show(el, t, ease(t / 0.1)),
    });
  });

  // ------------------------------------------------------------ 8. where it is played
  const end = g8('x8-end', `
    <div class="k8-logo">ZONA</div>
    <div class="k8-line">PLAY FREE IN YOUR BROWSER</div>
    <div class="k8-url">WWW.ZONAPVP.FUN</div>
    <div class="k8-rows"><span>X &nbsp;@${X_HANDLE}</span><span>DISCORD &nbsp;${DISCORD.replace('https://', '')}</span></div>
    <div class="k8-ca">${CONTRACT}</div>`);
  add(4, {
    name: 'end',
    flash: 0.6,
    setup: async () => {
      const r = rackOf('ar15');
      turn(r, AZ, 0.4);
      await dress(r, lens(r, 0.4, 0.9).cam);
    },
    cam: (t) => {
      const r = rackOf('ar15'), k = 0.4 + (t / beats(4)) * 0.6, o = lens(r, k, 0.9);
      turn(r, o.a, k);
      return hand(o.cam, t, 0.3);
    },
    after: (t) => show(end, t),
    fadeOut: 0.45,
    grid: 0.5,
  });

  console.log(`[tr] cut 8: ${shots.length} shots, ${cur} beats, ${beats(cur).toFixed(2)} s of ${SECONDS8}`);
  return shots;
}
