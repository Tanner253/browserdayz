// The twenty-eighth film's frame (shots28.ts): what every act reaches for. The look laid over the picture, a shot's
// setting up, the player's legs and hand on the keys and mouse, and the MD-500 flown on its own controls. The owner:
// "no glitching no flying cars or characters or cars clipping into eachother etc... please just make sure the trailer
// shows authentic gameplay": so everything that moves here moves by the game's own rules. The player by keys, a car or
// the helicopter by its controls, animals and the infected by their own minds; a person other than the player only
// where the physics says they can stand.
import * as THREE from 'three';
import type { Shot, Stage } from './director';
import { Hand, Speeds, wrap, yawTo } from './human';
import { Drive26, Infected26, ground26 } from './kit26';
import { ITEMS, makeItem, stockGun } from '../sim/items';
import { HELI } from '../sim/heli';
import type { Kind28 } from './music28';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
export const fwdOf = (yaw: number) => V(-Math.sin(yaw), 0, -Math.cos(yaw));
export const rightOf = (yaw: number) => V(Math.cos(yaw), 0, -Math.sin(yaw));
/** a bar of the film, seconds: 128 beats a minute */
export const BAR = 1.875;
/** the hours it goes through (the game's day fraction) */
export const DAWN = 0.27, MORNING = 0.32, NOON = 0.46, AFTERNOON = 0.58, GOLDEN = 0.655, SUNSET = 0.705, DUSK = 0.722, NIGHT = 0.775;

export interface Way { c: THREE.CatmullRomCurve3; len: number; stop: number; sprint: boolean; walk: boolean }
export interface Extra { hour?: number; fadeIn?: number; fadeOut?: number; m: Kind28; under?: boolean; hit?: boolean }
export type Add = (len: number, s: Omit<Shot, 'start' | 'end'> & Extra) => void;

export function frame28(S: Stage, totalSet: (s: number) => void) {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  const say = (s: string) => console.log(`[tr] ${s}`);
  document.body.classList.add('tr-cut21', 'tr-cut26', 'tr-cut28');
  const overlay = document.getElementById('tr-overlay')!;
  const piece = (cls: string, html = '') => {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    el.style.display = 'none';
    overlay.appendChild(el);
    return el;
  };
  const grain = piece('tr-grain4'), black = piece('tr-black4');
  piece('tr-vig4').style.display = '';
  grain.style.display = '';
  black.style.display = '';
  const title = piece('x28-title', '<img src="/brand/zona-mark.svg" alt=""><b>ZONA</b><u>KEEP WHAT YOU KILL</u><i></i>');
  const chip = piece('x21-chip', '<b></b><i></i>');
  const show = (el: HTMLElement, o: number) => {
    el.style.display = o > 0.002 ? '' : 'none';
    el.style.opacity = o.toFixed(3);
  };
  const chipSay = (t: number, from: number, to: number, big: string, small: string) => {
    const o = t < from || t > to ? 0 : Math.min(ease((t - from) / 0.3), ease((to - t) / 0.3));
    if (o <= 0) return void (chip.style.display = 'none');
    chip.querySelector('b')!.textContent = big;
    chip.querySelector('i')!.textContent = small;
    chip.querySelector('i')!.style.display = small ? '' : 'none';
    show(chip, o);
    chip.style.transform = `translateX(${((1 - o) * -24).toFixed(1)}px)`;
  };
  let keepNotes = false;
  const hush = () => document.querySelectorAll(keepNotes ? '.hud-feed > *' : '.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
  const notes = (on: boolean) => { keepNotes = on; };
  const run = async (frames: number, each?: (k: number) => void) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      each?.(i);
      for (const a of S.actors) a.push();
      clock.advance(1000 / 60);
      if (i % 20 === 19) await wait(8);
    }
    S.mute = false;
  };
  // a soft fill on the first-person hands and gun (the fourth film's reflector)
  const handFill = new THREE.DirectionalLight(0xfff1dd, 0);
  handFill.position.set(0.4, 0.6, 1);
  g.weapons.vmScene.add(handFill);
  const handSky = new THREE.HemisphereLight(0xdfe8f0, 0x6b5a46, 0);
  g.weapons.vmScene.add(handSky);
  const lightHands = (a = 1.6, b = 1.1) => { handFill.intensity = a; handSky.intensity = b; };
  // (spent cases cross the lens at gun size with the sights up: not thrown in this film)
  g.weapons.eject = () => {};

  // (and in first person the body's own shoulder kept out of the picture: it pushes into the lower left of the sights as
  // a dark mass; what is seen through the sights is the gun and the hands, as a player sees: film 26's finding)
  {
    const upd = g.avatar.update.bind(g.avatar);
    g.avatar.update = (...a: Any[]) => {
      upd(...a);
      g.avatar.fpRoot.visible = false;
    };
  }
  const ground = ground26(S);
  const drive = new Drive26(S, say);
  const infected = new Infected26(S, wait);

  // ------------------------------------------------------------ the player: legs on the keys, a hand on the mouse
  const P = () => g.player as Any;
  const eye = () => {
    const p = P().pos as THREE.Vector3;
    return V(p.x, p.y + 1.62, p.z);
  };
  const hand = new Hand(28, eye);
  let way: Way | null = null;
  const lay = (pts: THREE.Vector3[], o: { stop?: number; sprint?: boolean; walk?: boolean } = {}): Way => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    c.arcLengthDivisions = 400;
    return (way = { c, len: c.getLength(), stop: o.stop ?? 0.5, sprint: !!o.sprint, walk: !!o.walk });
  };
  const along = (w: Way, p: THREE.Vector3) => {
    let best = 1e9, bu = 0;
    for (let i = 0; i <= 200; i++) {
      const q = w.c.getPointAt(i / 200), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < best) { best = d; bu = i / 200; }
    }
    return bu * w.len;
  };
  const ahead = (m: number) => () => {
    if (!way) return eye().addScaledVector(fwdOf(P().yaw), m);
    const w = way, s = Math.min(w.len, along(w, P().pos) + m), q = w.c.getPointAt(s / w.len);
    return V(q.x, ground.floorAt(q.x, q.z, P().pos.y) + 1.4, q.z);
  };
  const legs = () => {
    if (!way) return Infinity;
    const left = way.len - along(way, P().pos);
    S.key('KeyW', left > way.stop);
    S.key('ShiftLeft', way.sprint && left > 5);
    S.key('AltLeft', way.walk && left > way.stop);
    return left;
  };
  const look = (t: number, dt: number) => {
    const a = hand.update(t, dt);
    P().yaw = a.yaw;
    P().pitch = Math.max(-1.3, Math.min(1.3, a.pitch));
  };
  const heading = () => {
    if (!way) return P().yaw as number;
    const q = way.c.getTangentAt(Math.min(0.999, along(way, P().pos) / way.len));
    return Math.atan2(-q.x, -q.z);
  };
  const clearWay = () => { way = null; };

  // ------------------------------------------------------------ the MD-500 on its own controls
  /** a pilot on the keys: nose on the next point, height held over the ground, slowed for the turns and the end */
  const pilot = {
    pts: [] as THREE.Vector3[],
    at: 0,
    up: 45,
    cruise: 40,
    stop: false,
    fly(H: Any) {
      if (!this.pts.length) return;
      const p = H.pos as THREE.Vector3;
      while (this.at < this.pts.length - 1 && flat(p, this.pts[this.at]) < 28) this.at++;
      const to = this.pts[this.at], err = wrap(yawTo(p, to) - H.yaw), left = flat(p, to);
      S.key('KeyA', err > 0.03);
      S.key('KeyD', err < -0.03);
      const v = Math.hypot(H.vel?.x ?? 0, H.vel?.z ?? 0) || Math.abs(H.speed ?? 0);
      const braking = this.stop && this.at === this.pts.length - 1 && left < v * v / 9 + 6;
      S.key('KeyW', !braking && Math.abs(err) < 0.5 && v < this.cruise);
      S.key('KeyS', braking && v > 1);
      const under = Math.max(S.ground(p.x, p.z), S.ground(p.x + (to.x - p.x) * 0.2, p.z + (to.z - p.z) * 0.2)), want = to.y > 0 ? to.y : under + this.up;
      S.key('Space', p.y < want - 1.5);
      S.key('KeyC', p.y > want + 2.5);
    },
  };
  /** in the pilot's seat, its rotor at speed, at a place in the air (or on the ground, at rest: `rpm` 0) going `v` m/s along `yaw` */
  const seatIn = (H: Any, p: THREE.Vector3, yaw: number, v: number, rpm = 1) => {
    if (!g.garage.ride) {
      const door = H.point(-1.9, 0, 0.2, new THREE.Vector3());
      S.me(door.x, door.z, H.yaw, 0, H.pos.y);
      H.fuel = 60;
      H.hp = 9999;
      g.garage.use(H);
      if (!g.garage.ride) say('could not get into the helicopter');
    }
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')), f = fwdOf(yaw);
    H.place([p.x, p.y, p.z, q.x, q.y, q.z, q.w, f.x * v, 0, f.z * v, rpm, rpm > 0 ? 0.7 : 0]);
    H.rpm = rpm;
    H.setMode?.('sim');
    // (set down by the film, not flown there: the step after it is no blow, and this take has no crash in it)
    H.hasPost = false;
    H.onCrash = () => {};
  };
  const helis = () => [...g.garage.jeeps.values()].filter((j: Any) => j.kind === HELI.kind) as Any[];

  // ------------------------------------------------------------ how fast everything went
  const speeds = new Speeds();
  let lastShot = '';
  const tally = (t: number) => {
    if (g.garage.ride) speeds.note('vehicle', t, g.garage.ride.jeep.pos);
    else speeds.note('player', t, P().pos);
    if (S.cam) speeds.note('lens', t, S.cam.p);
  };

  // (a body in this film lies in what it wore, and the stand-in goes when the lying body is there)
  const wearing = new Map<string, string[]>();
  {
    const lay0 = g.addCorpse.bind(g);
    g.addCorpse = async (q: Any, wait = 1800) => {
      await lay0(q, wait);
      const b = g.corpses.get(q.uid)?.body as Any;
      const a = S.actors.find((x) => x.corpseId === q.uid);
      if (b?.avatar) await g.wear(b.avatar, a ? wearing.get(a.name) ?? [] : []);
      if (a) a.rp.avatar.root.visible = false;
    };
  }
  // ------------------------------------------------------------ the set
  let warmed = false;
  const dressers: (() => Promise<void>)[] = [];
  const warm = async () => {
    if (warmed) return;
    warmed = true;
    try { localStorage.setItem('zona-howto-seen', '1'); } catch { /* */ }
    (document.querySelector('.howto-ok') as HTMLElement | null)?.click();
    drive.pickJeep();
    drive.pickHeli();
    const ward = (S.world.buildings as { type: string; x: number; z: number }[]).find((b) => b.type === 'hospital');
    await infected.troupe(ward ? [ward.x, ward.z] : undefined);
    infected.away();
    for (let k = 0; k < 400 && !g.wild.herd; k++) await run(10);
    if (!g.wild.herd) say('the herds never came up');
    // (each animal's model fetched now, so that one stood in a shot is there at once)
    S.me(-1062, -404, 0);
    await run(30);
    for (const id of ['stag', 'wolf', 'bear']) {
      const out = g.wild.herd.place(id, -1040, -404, Date.now(), 1) as Any[];
      for (let k = 0; k < 400 && !out.every((b) => (g.wild.beasts.get(b.i) as Any)?.model); k++) {
        await run(6);
        await wait(20);
      }
      for (const b of out) g.wild.herd.remove(b.i);
    }
    for (const d of dressers) await d();
  };
  /** kept off the screen between shots: a shot may leave things behind it for the next */
  const cleaners: (() => void)[] = [];
  /** a shot whose animals the next one goes on with */
  const keepStood = { on: false };
  const reset = () => {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'AltLeft', 'KeyF', 'Mouse0', 'Mouse2']) S.key(k, false);
    if (g.garage.ride) g.garage.out(false);
    for (const j of g.garage.jeeps.values() as Iterable<Any>) j.seats?.fill?.(null);
    way = null;
    pilot.pts = [];
    pilot.at = 0;
    pilot.stop = false;
    keepNotes = false;
    S.mute = false;
    g.lit = false;
    handFill.intensity = 0;
    handSky.intensity = 0;
    for (const el of [chip, title]) el.style.display = 'none';
    for (const c of cleaners) c();
    fired.clear();
  };
  const fired = new Set<string>();
  const when = (t: number, at: number, key: string, fn: () => void) => {
    if (t >= at && !fired.has(key)) {
      fired.add(key);
      fn();
    }
  };
  /** every gun carried given the magazine it is made with, full */
  const armed = () => {
    for (const it of g.inv.carried() as Iterable<Any>) {
      const w = ITEMS[it.id]?.weapon;
      if (w?.mag && !it.mag) {
        it.mag = w.mag;
        stockGun(it, 999);
      }
    }
    g.inventoryChanged();
  };
  /** what a survivor who has been at it a while has on */
  const dressed = ['field_jacket', 'cargo_pants', 'hiking_boots', 'sack_pack'];
  const kit = (ids: (string | [string, number])[], mods: Record<string, string[]> = {}, wear = dressed) => {
    S.kit([...wear, ...ids], mods);
    armed();
  };
  /** a thing laid on what is under it, as anything put down lies; its uid */
  const lie = (id: string, at: THREE.Vector3, turn = 0) => {
    const it = makeItem(id);
    if (ITEMS[id]?.weapon?.mag) {
      it.mag = ITEMS[id].weapon!.mag!;
      stockGun(it, 999);
    }
    g.economy.drop(it, at.x, at.y + 0.005, at.z, turn);
    return it.uid as string;
  };

  const shots: Shot[] = [];
  let cur = 0, hourWas = -1;
  const marks: { at: number; len: number; kind: Kind28; under?: boolean; hit?: boolean }[] = [];
  const add: Add = (len, s) => {
    const start = cur, setup = s.setup, after = s.after, tick = s.tick;
    cur += len;
    totalSet(cur);
    marks.push({ at: start, len, kind: s.m, under: s.under, hit: s.hit });
    let lt = -1;
    shots.push({
      bars: false,
      ...s,
      start,
      end: start + len,
      setup: async (st) => {
        if (lastShot) say(`${lastShot}: ${speeds.report()}`);
        lastShot = s.name;
        try {
          await warm();
          reset();
          if (s.hour !== undefined) {
            g.hourHeld = s.hour;
            if (s.hour !== hourWas) await run(150);
            hourWas = s.hour;
          }
          await setup?.(st);
          lt = -1;
        } catch (e) {
          say(`${s.name}: its setting up failed: ${(e as Error).message}`);
        }
      },
      lead: (t, st) => {
        const dt = lt < -0.9 ? 1 / 60 : t - lt;
        lt = t;
        tick?.(t, st, dt);
      },
      tick: (t, st, dt) => {
        lt = t;
        tick?.(t, st, dt);
      },
      after: (t, st) => {
        after?.(t, st);
        tally(t);
        hush();
        const a = s.fadeIn ? 1 - ease(t / s.fadeIn) : 0, z = s.fadeOut ? ease((t - (len - s.fadeOut)) / s.fadeOut) : 0;
        black.style.opacity = String(Math.max(a, z));
        if (start + len >= cur - 1e-6 && t > len - 0.05) say(`${s.name}: ${speeds.report()}`);
      },
    } as Shot);
  };

  return {
    base: null as import('./base28').Base28 | null,
    S, g, clock, wait, say, overlay, piece, show, chipSay, title, chip, black, notes, run, lightHands, ground, drive, infected,
    P, eye, hand, lay, along, ahead, legs, look, heading, clearWay, pilot, seatIn, helis, dressers, cleaners, keepStood, wearing, when, armed, kit, dressed, lie, shots, add, marks,
  };
}
export type Ctx = ReturnType<typeof frame28>;
