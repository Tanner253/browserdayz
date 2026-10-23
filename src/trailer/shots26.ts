// The twenty-sixth film, about 70 s: the gameplay trailer (2026-10-23, the owner: "need a high quality gameplay trailer
// for my game with gameplay, no bugs or visual glitches shown"; for YouTube, itch.io, X and Google Ads). Boarded twice
// (marketing/plan-film-26.html); the owner on the first board: "the plane and land process looks terrible it should be
// shown from 3rd person spectate", "a lot of the scenes jump around and do not transtition together properly", "we want
// a smooth cinemtic trailer of high quality that shwos off the zona game and br", "we need to ensure clear targets and
// line of sights", "i need a 9:16 trailer too". So: fewer, longer shots, each ending moving the way the next begins;
// every line of fire checked clear by the physics before it is filmed; the battle royale filmed from outside.
//   ZONA (one survivor's day, dawn to night): the coast, into a house in Pokrov, a rifle off the floor, the infected in
//   the street, friends in a jeep, the road at golden hour with the MD-500 over it, the snow fort at sunset, a fight in
//   Kamenka at dusk, Pokrov's lamps at night. BATTLE ROYALE: the twenty-seventh's real match, laid in frame by frame
//   (footage.ts). ARENA: the fort, a round (arena26.ts). Then the three side by side, and the end card.
// Everything moves as people move (human.ts); nothing is sped up; no player counts, nothing of payouts.
//   node scripts/film.mjs --cut 26 --frames z26            (the BR footage first: shots27.ts, --frames br27)
//   node scripts/film.mjs --cut 26 --tall --frames z26t    (upright: the BR footage --tall --frames br27t)
import * as THREE from 'three';
import type { Shot, Stage } from './director';
import { scoreMusic17, type Kind17, type Row17 } from './music17';
import { DRONE, Hand, ON_FOOT, Operator, Spectate, Speeds, wrap, yawTo } from './human';
import { Screen, frameUrl, loadReel, soundsOf, type Reel } from './footage';
import { LEN27 } from './shots27';
import { arenaShot } from './arena26';
import { physics, SIGHT_GROUPS } from '../core/physics';
import { Drive26, Infected26, findHouse26, ground26, type House26 } from './kit26';
import { ITEMS, makeItem, stockGun } from '../sim/items';
import { SEA_LEVEL, TOWN } from '../world/worldgen';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const ROWS: Row17[] = [];
let total = 0;
export const seconds = () => total;
export const score = (ctx: BaseAudioContext, out: AudioNode) => scoreMusic17(ctx, out, ROWS);

const Q = new URLSearchParams(location.search);
const TALL = Q.has('tall');
/** upright: a taller lens, so the subject keeps its size and the picture its sides */
const lens = (f: number) => (TALL ? (2 * Math.atan(1.9 * Math.tan((f * Math.PI) / 360)) * 180) / Math.PI : f);
/** the battle royale's footage, and this take's own frames (the three side by side at the end are made from them) */
const BR_REEL = TALL ? 'br27t' : 'br27';
const OWN = Q.get('own') ?? (TALL ? 'z26t' : 'z26');
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const fwdOf = (yaw: number) => V(-Math.sin(yaw), 0, -Math.cos(yaw));
const rightOf = (yaw: number) => V(Math.cos(yaw), 0, -Math.sin(yaw));

/** the hours of the day it goes through (the game's day fraction): dawn, morning, noon, golden hour, sunset, dusk, night */
const DAWN = 0.27, MORNING = 0.32, GOLDEN = 0.655, SUNSET = 0.705, DUSK = 0.722, NIGHT = 0.775;
/** the middle of Pokrov's lane, between its two rows of lamps (west-towns.ts townLamps) */
const LANE = 34.5;

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any;
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  const say = (s: string) => console.log(`[tr] ${s}`);
  document.body.classList.add('tr-cut21', 'tr-cut26');
  if (TALL) document.body.classList.add('tr-tall');
  const overlay = document.getElementById('tr-overlay')!;
  const piece = (cls: string, html = '') => {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    el.style.display = 'none';
    overlay.appendChild(el);
    return el;
  };
  // the footage's screens first, under every word and the grain
  const reelScreen = new Screen(overlay, 'x26-reel');
  const panels = [0, 1, 2].map((k) => new Screen(overlay, `x26-panel p${k}`));
  const grain = piece('tr-grain4'), black = piece('tr-black4');
  piece('tr-vig4').style.display = '';
  grain.style.display = '';
  black.style.display = '';
  const title = piece('x26-title', '<img src="/brand/zona-mark.svg" alt=""><b>ZONA</b><i>FREE · PLAYS IN YOUR BROWSER · NO DOWNLOAD</i>');
  const chip = piece('x21-chip', '<b></b><i></i>');
  const words = piece('x26-words', '<span>SURVIVE</span><span>BATTLE ROYALE</span><span>ARENA</span>');
  const end = piece('x26-end', '<img src="/brand/zona-mark.svg" alt=""><b>ZONA</b><p><span>SURVIVAL</span><span>BATTLE ROYALE</span><span>ARENA</span></p><h5>FREE · PLAYS IN YOUR BROWSER · NO DOWNLOAD</h5><u>zonapvp.fun</u>');
  const show = (el: HTMLElement, o: number) => {
    el.style.display = o > 0.002 ? '' : 'none';
    el.style.opacity = o.toFixed(3);
  };
  const chipSay = (t: number, from: number, to: number, big: string, small: string) => {
    const o = t < from || t > to ? 0 : Math.min(ease((t - from) / 0.35), ease((to - t) / 0.35));
    if (o <= 0) return void (chip.style.display = 'none');
    chip.querySelector('b')!.textContent = big;
    chip.querySelector('i')!.textContent = small;
    show(chip, o);
    chip.style.transform = `translateX(${((1 - o) * -24).toFixed(1)}px)`;
  };
  const fired = new Set<string>();
  const when = (t: number, at: number, key: string, fn: () => void) => {
    if (t >= at && !fired.has(key)) {
      fired.add(key);
      fn();
    }
  };
  /** the HUD's passing notes and feed kept out of the picture (a note about the gas a kilometre off is not this shot's) */
  let keepNotes = false;
  const hush = () => document.querySelectorAll(keepNotes ? '.hud-feed > *' : '.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
  /** frames nobody sees or hears */
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
  // a soft fill on the first-person hands and gun, as a reflector would give (the fourth film's: in the game's own light
  // the sleeves and the far hand go near black when they are turned from the sun)
  const handFill = new THREE.DirectionalLight(0xfff1dd, 0);
  handFill.position.set(0.4, 0.6, 1);
  g.weapons.vmScene.add(handFill);
  // (and a sky's worth from all round, for the faces of the far arm that the sun and the fill both miss: in the sights
  // the support arm's sleeve was a black mass in the corner)
  const handSky = new THREE.HemisphereLight(0xdfe8f0, 0x6b5a46, 0);
  g.weapons.vmScene.add(handSky);
  // the spent cases are not thrown in this film: with the sights up the port is a hand from the eye, and each case
  // went past the lens as a brass log the size of the gun (the game's own scale, but nothing a player's eye sees so)
  g.weapons.eject = () => {};
  // (and in first person with the sights up, the body's own shoulder kept out of the picture: it pushed into the lower
  // left of the sights as a dark mass; what is seen through the sights is the gun and the hands, as a player sees)
  let ownBodyOff = false;
  {
    const upd = g.avatar.update.bind(g.avatar);
    g.avatar.update = (...a: Any[]) => {
      upd(...a);
      if (ownBodyOff) g.avatar.fpRoot.visible = false;
    };
  }
  // (the page waits for the footage's picture before each frame is photographed)
  S.onFrame = async () => {
    await reelScreen.settled();
    await Promise.all(panels.map((p) => p.settled()));
  };

  // ------------------------------------------------------------ the set's pieces (kit26.ts): the ground, the jeep and the heli, the infected
  const { floorAt, roofOver, sees, seesWide, offTrees, pl, clear } = ground26(S);
  const drive = new Drive26(S, say);
  const { R, pickJeep, pickHeli, putJeep, board, friends, wheel, fly } = drive;
  const infected = new Infected26(S, wait);
  const { zeds, troupe, putZ, awake, away, dropZ } = infected;

  // ------------------------------------------------------------ the player: his legs and his hand (as in shots21)
  const P = () => g.player as Any;
  const eye = () => {
    const p = P().pos as THREE.Vector3;
    return V(p.x, p.y + 1.62, p.z);
  };
  const hand = new Hand(26, eye);
  interface Way { c: THREE.CatmullRomCurve3; len: number; stop: number; sprint: boolean; walk: boolean }
  let way: Way | null = null;
  const lay = (pts: THREE.Vector3[], o: { stop?: number; sprint?: boolean; walk?: boolean } = {}): Way => {
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    c.arcLengthDivisions = 400;
    return { c, len: c.getLength(), stop: o.stop ?? 0.5, sprint: !!o.sprint, walk: !!o.walk };
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
    return V(q.x, floorAt(q.x, q.z, P().pos.y) + 1.4, q.z);
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
    const w = way!, s = along(w, P().pos), q = w.c.getTangentAt(Math.min(0.999, s / w.len));
    return Math.atan2(-q.x, -q.z);
  };

  // ------------------------------------------------------------ how fast everything went
  const speeds = new Speeds();
  let lastShot = '';
  const tally = (t: number) => {
    if (g.garage.ride && drive.J) speeds.note('jeep', t, drive.J.pos);
    else speeds.note('player', t, P().pos);
    if (S.cam) speeds.note('lens', t, S.cam.p);
  };

  // ------------------------------------------------------------ the set
  let warmed = false;
  const warm = async () => {
    if (warmed) return;
    warmed = true;
    try { localStorage.setItem('zona-howto-seen', '1'); } catch { /* */ }
    (document.querySelector('.howto-ok') as HTMLElement | null)?.click();
    pickJeep();
    pickHeli();
    await troupe();
    away();
    // every place looked at once, so nothing is drawn for the first time in a shot
    const t0 = clock.real.now();
    for (const [x, z, lx, lz] of [[-3640, -362, -3570, -395], [-1880, 30, -1830, 40], [-1830, 20, -1760, 60], [-1700, 40, -1500, 30], [TOWN.x - 40, TOWN.z - 60, TOWN.x, TOWN.z], [450, -300, 537, -371]]) {
      S.cam = { p: V(x, S.ground(x, z) + 4, z), l: V(lx, S.ground(lx, lz) + 1.5, lz), fov: 50 };
      await run(90);
      await wait(150);
    }
    S.cam = null;
    say(`the set is ready; ${((clock.real.now() - t0) / 1000).toFixed(1)} s`);
  };
  const reset = () => {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'AltLeft', 'KeyF', 'Mouse0', 'Mouse2']) S.key(k, false);
    if (g.garage.ride) g.garage.out(false);
    if (drive.J) drive.J.seats.fill(null);
    way = null;
    drive.stopAt = Infinity;
    drive.cruise = 13;
    keepNotes = false;
    S.mute = false;
    g.lit = false;
    handFill.intensity = 0;
    handSky.intensity = 0;
    ownBodyOff = false;
    for (const el of [chip, title, end, words]) el.style.display = 'none';
    reelScreen.hide();
    for (const p of panels) p.hide();
    fired.clear();
  };
  const fresh = () => {
    S.kit(['beans', 'thermos', 'bandage']);
    S.hold(null);
  };
  /** every gun carried given the magazine it is made with, full (S.kit makes them bare: the HUD said "no mag") */
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

  const shots: Shot[] = [];
  let cur = 0, hourWas = -1;
  /** each shot's kind of music, for the score laid under the cut at the end */
  const marks: { at: number; kind: Kind17; under?: boolean }[] = [];
  interface Extra { hour?: number; fadeIn?: number; fadeOut?: number; leadTick?: boolean; m: Kind17; under?: boolean }
  const add = (len: number, s: Omit<Shot, 'start' | 'end'> & Extra) => {
    const start = cur, setup = s.setup, after = s.after, tick = s.tick;
    cur += len;
    total = cur;
    marks.push({ at: start, kind: s.m, under: s.under });
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
      lead: s.leadTick === false ? undefined : (t, st) => {
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
        if (start + len >= total - 1e-6 && t > len - 0.05) say(`${s.name}: ${speeds.report()}`);
      },
    } as Shot);
  };

  // ============================================================ ZONA · 1 · dawn on the coast (a drone low along the water)
  {
    const op = new Operator(DRONE, 101, lens(48));
    let dir = V(0, 0, -1), sea = V(-1, 0, 0);
    add(5, {
      name: 'coast',
      hour: DAWN,
      m: 'card',
      setup: async () => {
        fresh();
        // the water's edge (where the ground goes under the sea), and him running north along the wet sand by it, the
        // drone coming up behind him over the shallows with the sea on one side and the land on the other
        const edge = (z: number) => {
          let x = -3640;
          while (S.ground(x, z) > SEA_LEVEL - 0.3 && x > -3836) x -= 1;
          return x;
        };
        const z0 = -380, z1 = -350, x0 = edge(z0) + 7, x1 = edge(z1) + 7;
        const p0 = pl(x0, z0), p3 = pl(x1, z1);
        dir = p3.clone().sub(p0).setY(0).normalize();
        sea = V(dir.z, 0, -dir.x);
        if (S.ground(p0.x + sea.x * 12, p0.z + sea.z * 12) > S.ground(p0.x - sea.x * 12, p0.z - sea.z * 12)) sea.negate();
        S.me(p0.x, p0.z, yawTo(p0, p3), -0.04);
        hand.set(yawTo(p0, p3), -0.04);
        way = lay([p0, p0.clone().lerp(p3, 0.5).setY(S.ground((x0 + x1) / 2, (z0 + z1) / 2)), p3], { sprint: true });
        hand.look(-0.5, ahead(8), true, 0);
        say(`the coast: the water's edge at ${(x0 - 7).toFixed(0)},${z0} and ${(x1 - 7).toFixed(0)},${z1}; the sea to ${sea.x.toFixed(2)},${sea.z.toFixed(2)}`);
        op.reset(want(0), eye().addScaledVector(dir, 10));
      },
      tick: (t, _S, dt) => {
        legs();
        look(t, dt);
      },
      cam: (t) => op.update(t, want(t), eye().addScaledVector(dir, 9 + 9 * ease(t / 5)).addScaledVector(sea, -3 * ease(t / 5)).setY(eye().y - 0.6 - 1.8 * ease(t / 5))),
      after: (t) => show(title, t < 2.4 ? 1 : 1 - ease((t - 2.4) / 0.8)),
    });
    /** where the drone wants to be at t: low over the shallows behind him, closing and rising as he runs on */
    function want(t: number) {
      const u = ease(t / 5), p = P().pos as THREE.Vector3;
      const w = p.clone().addScaledVector(dir, -(15 - 8 * u)).addScaledVector(sea, 6 - 2 * u);
      w.y = Math.max(S.ground(w.x, w.z), SEA_LEVEL + 1.2) + 2.4 + 6 * u;
      return w;
    }
  }

  // ============================================================ ZONA · 2-3 · Pokrov: into a house, a rifle, the infected
  let house: House26 | null = null;
  const findHouse = (cx: number, cz: number) => findHouse26(S, cx, cz, LANE, say);
  {
    const op = new Operator(ON_FOOT, 102, lens(46));
    add(4, {
      name: 'town',
      hour: MORNING,
      m: 'march',
      setup: async () => {
        fresh();
        S.me(-1880, LANE, Math.PI, 0);
        await run(60);
        house = house ?? findHouse(-1880, LANE);
        if (!house) throw new Error('no house to loot');
        // the rifle on its floor, as anything put down lies (the game's own drop: it lays it on what is under it)
        const ak = makeItem('ak');
        ak.mag = ITEMS.ak.weapon!.mag!;
        stockGun(ak, 999);
        g.economy.drop(ak, house.gun.x, house.gun.y + 0.005, house.gun.z, yawTo(house.inside, house.gun) + 1.3);
        S.me(house.front.x, house.front.z, 0, 0, house.front.y);
        await run(40);
        const lying = [...g.loot.items.values()].find((w: Any) => w.loot.item.uid === ak.uid) as Any;
        say(`the rifle laid: ${lying ? `at ${lying.loot.x.toFixed(2)},${lying.loot.y.toFixed(2)},${lying.loot.z.toFixed(2)} (floor ${house.gun.y.toFixed(2)}), mods ${(ak.mods ?? []).join(' ') || 'none'}, ${ak.loaded} rounds` : 'NOT made'}`);
        const h = house;
        for (const d of g.s.buildings.doors as Any[]) if (d.pivot.getWorldPosition(V(0, 0, 0)).distanceTo(h.door) < 2 && !d.open) d.setOpen(true);
        await run(20);
        // from along the street, a run to the door and in
        const p0 = h.front.clone().addScaledVector(h.runIn, -13);
        p0.y = floorAt(p0.x, p0.z, h.front.y + 0.5);
        const turn = h.front.clone().addScaledVector(h.runIn, -1.6);
        S.me(p0.x, p0.z, yawTo(p0, turn), -0.06, p0.y);
        way = lay([p0, turn, h.door.clone().addScaledVector(h.out, 0.6), h.door.clone().addScaledVector(h.out, -0.4)], { stop: 0.2 });
        hand.set(yawTo(p0, turn), -0.06);
        hand.look(-0.5, ahead(5), true, 0);
        const f = fwdOf(yawTo(p0, turn));
        op.reset(p0.clone().addScaledVector(f, -4.6).setY(p0.y + 1.6), eye(), f.clone().multiplyScalar(4.5));
      },
      tick: (t, _S, dt) => {
        legs();
        look(t, dt);
      },
      cam: (t) => {
        const p = P().pos as THREE.Vector3, f = fwdOf(way ? heading() : P().yaw);
        const want = p.clone().addScaledVector(f, -4.4).addScaledVector(rightOf(P().yaw), 0.7);
        want.y = floorAt(want.x, want.z, p.y) + 1.65;
        return op.update(t, want, p.clone().addScaledVector(f, 3).setY(p.y + 1.2));
      },
    });
  }
  {
    let took = -1, drew = -1, outAt = -1, woke = -1, shotAt = -9, aimed: Any = null, hits = 0;
    add(7.5, {
      name: 'rifle',
      hud: true,
      chain: true,
      hour: MORNING,
      m: 'tight',
      under: true,
      setup: async () => {
        const h = house;
        if (!h) return;
        keepNotes = true;
        handFill.intensity = 1.6;
        handSky.intensity = 1.1;
        took = drew = outAt = woke = -1;
        shotAt = -9;
        aimed = null;
        // the infected down the lane, in its middle in the open, each in sight of where he will stand
        const stand = h.front.clone().addScaledVector(h.out, 1.6);
        const zs = [[15, -0.8], [18.5, 1.2], [22, -0.2]].map(([d, o]) => {
          const p = stand.clone().addScaledVector(h.street, d).addScaledVector(h.out, o);
          p.y = floorAt(p.x, p.z, stand.y + 0.5);
          return p;
        });
        zs.forEach((p, k) => putZ(zeds[k], p, yawTo(p, stand) + 0.6 * (k - 1), false));
        say(`the infected: in sight of where he stands ${zs.map((p) => seesWide(stand.clone().setY(stand.y + 1.6), p.clone().setY(p.y + 1.3))).join(' ')}`);
        // in at the door, the eyes on the rifle on the floor, to two metres from it
        const dirIn = h.gun.clone().sub(h.inside).setY(0).normalize();
        const near = h.gun.clone().addScaledVector(dirIn, -2.05);
        near.y = floorAt(near.x, near.z, h.inside.y + 0.3);
        way = lay([P().pos.clone(), h.inside.clone(), near], { walk: true, stop: 0.15 });
        hand.set(yawTo(eye(), h.gun), Math.atan2(h.gun.y + 0.05 - eye().y, flat(eye(), h.gun)));
        hand.look(0, h.gun.clone().setY(h.gun.y + 0.05), true, 0);
      },
      tick: (t, _S, dt) => {
        const h = house;
        if (!h) return;
        legs();
        // the rifle taken (F) once the eyes are on it and it is within reach; drawn; then back out into the lane
        if (took < 0 && t > 1.2 && flat(P().pos, h.gun) < 2.3) {
          took = t;
          S.tap('KeyF', 90);
        }
        if (took > 0 && drew < 0 && t > took + 0.45) {
          drew = t;
          S.hold('primary', true);
          const it = g.weapons.equippedItem;
          say(`the rifle: picked up ${it?.id ?? 'nothing'} with ${it?.loaded ?? '?'} rounds, its magazine ${it?.mag ?? 'none'}`);
        }
        if (drew > 0 && outAt < 0 && t > drew + 0.35) {
          outAt = t;
          const p = P().pos as THREE.Vector3, stand = h.front.clone().addScaledVector(h.out, 1.6);
          way = lay([p.clone(), h.door.clone().addScaledVector(h.out, 0.2), stand], { stop: 0.3 });
          hand.look(t, ahead(3), true);
        }
        // in the lane: they come for him at a run; he puts the sights on each in turn and fires
        if (outAt > 0 && woke < 0 && flat(P().pos, h.front) < 1.2) {
          woke = t;
          for (const z of zeds.slice(0, 3)) awake(z);
        }
        if (woke > 0) {
          S.key('Mouse2', t > woke + 0.25);
          ownBodyOff = true;
          const live = zeds.slice(0, 3).filter((z) => !z.dead);
          const z = live.sort((a, b) => flat(a.pos, P().pos) - flat(b.pos, P().pos))[0];
          // (the hand led a little ahead of where he runs, as a player leads a man coming at him)
          const lead = (q: Any) => q.pos.clone().addScaledVector(P().pos.clone().sub(q.pos).setY(0).normalize(), 0.5).setY(q.pos.y + 1.3);
          if (z && z !== aimed) {
            aimed = z;
            hits = 0;
            hand.look(t, () => lead(z), true, 0.1);
          }
          if (z) {
            const aimErr = Math.abs(wrap(yawTo(eye(), lead(z)) - P().yaw));
            if (t > woke + 0.55 && t - shotAt > 0.3 && aimErr < 0.04) {
              shotAt = t;
              S.tap('Mouse0', 60);
              // (the second round on him, his: the game's own hits on a runner are not every one counted)
              if (++hits >= 2) dropZ(z, eye());
            }
          }
        }
        look(t, dt);
      },
      after: (t) => {
        if (t > 5.9 && t < 5.95) say(`the infected at 6 s: ${zeds.slice(0, 3).map((z) => `${flat(z.pos, P().pos).toFixed(1)} m ${z.dead ? 'dead' : 'up'}`).join(', ')}`);
        if (t > 7.4) say(`the rifle: took ${took.toFixed(2)} drew ${drew.toFixed(2)} out ${outAt.toFixed(2)} woke ${woke.toFixed(2)}; in hand ${g.weapons.equippedItem?.id ?? 'nothing'}; down ${zeds.slice(0, 3).filter((z) => z.dead).length} of 3`);
      },
    });
  }

  // ============================================================ ZONA · 4 · on the road with friends; the MD-500 low over them
  {
    const sp = new Spectate(104, lens(50), 0.6, 1.0);
    let hp0 = V(0, 0, 0), hf = V(0, 0, -1);
    add(5, {
      name: 'drive',
      hour: GOLDEN,
      m: 'groove',
      setup: async () => {
        fresh();
        S.kit([['ak', 1]], { ak: ['gun_light'] });
        armed();
        friends(false);
        const k = R(-1690, 36);
        putJeep(k, 0);
        await run(10);
        board();
        await run(10);
        putJeep(k, 12.5);
        friends(true);
        drive.cruise = 13;
        const f = fwdOf(drive.J.yaw);
        sp.reset();
        // the helicopter from behind the lens, low, overtaking along the road: over the jeep a couple of seconds in
        hf = f.clone();
        hp0 = drive.J.pos.clone().addScaledVector(f, -16).addScaledVector(rightOf(drive.J.yaw), 2.5).setY(drive.J.pos.y + 12);
        if (drive.H) fly(drive.H, hp0, drive.J.yaw, -0.16, 0, f.clone().multiplyScalar(22));
        say(`the drive: the jeep on road 9 at ${drive.J.pos.x.toFixed(0)},${drive.J.pos.z.toFixed(0)}, friends aboard; the heli 16 m behind, 12 m up`);
      },
      tick: (t) => {
        friends(true);
        wheel();
        if (drive.H) {
          const p = hp0.clone().addScaledVector(hf, 22 * t);
          p.y = Math.max(hp0.y, S.ground(p.x, p.z) + 11);
          fly(drive.H, p, yawTo(p, p.clone().add(hf)), -0.16, 0.03 * Math.sin(t * 0.8), hf.clone().multiplyScalar(22));
        }
      },
      cam: (t) => {
        // a chase lens riding behind the jeep, a little to its left and over it: the road ahead, the jeep in the lower
        // third, and the helicopter coming over the lens and away up the road
        const f = fwdOf(drive.J.yaw), r = rightOf(drive.J.yaw);
        const off = f.clone().multiplyScalar(-8.5).addScaledVector(r, -2.2).add(V(0, 2.7, 0));
        offTrees(off.add(drive.J.pos)).sub(drive.J.pos);
        return clear(sp.update(t, (drive.J.pos as THREE.Vector3).clone(), off, f.clone().multiplyScalar(14).add(V(0, 1.4, 0))));
      },
      after: (t) => chipSay(t, 0.6, 3.8, 'ZONA', 'open-world survival · 4.6 km from the sea to the snow'),
    });
  }

  // ============================================================ ZONA · 6 · behind the MD-500 to the snow fort at sunset
  {
    const sp = new Spectate(106, lens(50), 0.6, 0.9);
    let p0 = V(0, 0, 0), dirH = V(0, 0, -1);
    add(3.5, {
      name: 'mountain',
      hour: SUNSET,
      m: 'board',
      setup: async () => {
        fresh();
        friends(false);
        // (the fort on the rim: src/sim/castle's place in the world)
        const fort = (S.world.castle as Any) ?? { x: 537, z: -371 };
        const fp = V(fort.x, S.ground(fort.x, fort.z), fort.z);
        p0 = V(fort.x - 215, 0, fort.z + 105);
        dirH = fp.clone().sub(p0).setY(0).normalize();
        p0.y = Math.max(S.ground(p0.x, p0.z) + 70, fp.y + 55);
        if (drive.H) fly(drive.H, p0, yawTo(p0, fp), -0.1, 0, dirH.clone().multiplyScalar(30));
        sp.reset();
        say(`the mountain: the fort ${flat(p0, fp).toFixed(0)} m ahead, the heli ${(p0.y - S.ground(p0.x, p0.z)).toFixed(0)} m up`);
      },
      tick: (t) => {
        if (!drive.H) return;
        const p = p0.clone().addScaledVector(dirH, 30 * t);
        p.y = Math.max(p0.y, S.ground(p.x, p.z) + 45);
        fly(drive.H, p, yawTo(p, p.clone().add(dirH)), -0.1, 0, dirH.clone().multiplyScalar(30));
      },
      cam: (t) => {
        const body = drive.H ? (drive.H.pos as THREE.Vector3).clone() : p0.clone(), r = V(-dirH.z, 0, dirH.x);
        return sp.update(t, body, dirH.clone().multiplyScalar(-13).addScaledVector(r, 4).add(V(0, 3.2, 0)), dirH.clone().multiplyScalar(45).add(V(0, -9, 0)));
      },
    });
  }

  // ============================================================ ZONA · 7 · Kamenka at dusk: a man in the open across the street
  {
    const sp = new Spectate(107, lens(36), 0.9, 1.4);
    const K = (a: number, o: number) => {
      const s = V(TOWN.street[0], 0, TOWN.street[1]), n = V(-s.z, 0, s.x);
      const p = V(TOWN.x, 0, TOWN.z).addScaledVector(s, a).addScaledVector(n, o);
      p.y = floorAt(p.x, p.z);
      return p;
    };
    let hero = V(0, 0, 0), foeFrom = V(0, 0, 0), foeTo = V(0, 0, 0), downAt = -1;
    add(4, {
      name: 'dusk',
      hour: DUSK,
      m: 'tight',
      under: true,
      setup: async () => {
        fresh();
        S.parkMe();
        // Volkov at the corner of the street, Bear across it in the open: a line the physics finds nothing on
        // (and room round the lens over his shoulder: nothing within a metre of it, nothing between it and Bear)
        const roomy = (p: THREE.Vector3) => [V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1), V(0.7, 0, 0.7), V(-0.7, 0, -0.7)].every((v) => !physics.raycast(p, v, 1.1, SIGHT_GROUPS));
        let best: { a: number; o: number } | null = null;
        for (const a of [-30, -20, -10, 0, 10, 20, -40, 30]) for (const o of [3.5, -3.5, 4.5, -4.5]) {
          const h = K(a, o), f1 = K(a + 12, -o * 0.4), f2 = K(a + 16, -o * 1.2);
          if (roofOver(h, 15) || roofOver(f1, 15)) continue;
          const yaw = yawTo(h, f1), cam = h.clone().addScaledVector(fwdOf(yaw), -2.6).addScaledVector(rightOf(yaw), 0.9).setY(h.y + 1.85);
          if (!roomy(cam) || !sees(cam, f1.clone().setY(f1.y + 1.2)) || !sees(h.clone().setY(h.y + 1.6), cam)) continue;
          if (seesWide(h.clone().setY(h.y + 1.55), f1.clone().setY(f1.y + 1.25)) && seesWide(h.clone().setY(h.y + 1.55), f2.clone().setY(f2.y + 1.25))) { best = { a, o }; break; }
        }
        if (!best) throw new Error('no clear line in Kamenka');
        hero = K(best.a, best.o);
        foeFrom = K(best.a + 17, -best.o * 1.4);
        foeTo = K(best.a + 12, best.o * 0.1);
        const v = S.actor(0), b = S.actor(5);
        v.place(hero.x, hero.z, yawTo(hero, foeTo), 'ak', ['soft_vest', 'patrol_cap']);
        v.pos.y = hero.y;
        b.place(foeFrom.x, foeFrom.z, yawTo(foeFrom, foeTo), 'mpa', ['sack_pack']);
        b.pos.y = foeFrom.y;
        downAt = -1;
        sp.reset();
        say(`the dusk fight: Kamenka ${best.a},${best.o}; ${flat(hero, foeTo).toFixed(0)} m across`);
      },
      tick: (t, _S, dt) => {
        const v = S.actor(0), b = S.actor(5);
        if (b.alive) {
          b.go(foeTo.x, foeTo.z, 4.6, dt);
          b.pos.y = floorAt(b.pos.x, b.pos.z, b.pos.y);
        } else if (downAt < 0) downAt = t;
        v.aim = t > 0.5;
        v.face(b.alive ? b.chest() : b.pos.clone().setY(b.pos.y + 0.3));
        // short bursts, as a player fires them; the rounds are the game's and so is what they do
        if (b.alive && t > 1.1 && Math.floor(t * 8) !== Math.floor((t - dt) * 8) && Math.floor(t * 8) % 4 !== 3) v.fireAt(b.chest(), 0.012);
      },
      cam: (t) => {
        const v = S.actor(0), b = S.actor(5), yaw = yawTo(v.pos, b.pos), f = fwdOf(yaw), r = rightOf(yaw);
        const off = f.clone().multiplyScalar(-2.6).addScaledVector(r, 0.9).add(V(0, 1.85, 0));
        const lookOff = b.pos.clone().sub(v.pos).add(V(0, 1.0, 0)).lerp(f.clone().multiplyScalar(8).add(V(0, 1.3, 0)), 0.25);
        return sp.update(t, v.pos.clone(), off, lookOff);
      },
      after: (t) => {
        if (t > 3.9) say(`the dusk fight: Bear ${S.actor(5).alive ? 'still up' : `down at ${downAt.toFixed(2)}`}`);
      },
    });
  }

  // ============================================================ ZONA · 8 · night under Pokrov's lamps, his light on
  {
    const op = new Operator(ON_FOOT, 108, lens(44));
    add(4, {
      name: 'night',
      hour: NIGHT,
      m: 'sneak',
      fadeOut: 0.7,
      setup: async () => {
        S.actor(0).hide();
        S.actor(5).hide();
        S.kit([['ak', 1]], { ak: ['gun_light'] });
        armed();
        S.hold('primary');
        g.lit = true;
        // (between Pokrov's lamps: they stand either side of its lane from x -1973 to -1885, and again from -1817)
        const p0 = pl(-1946, LANE);
        S.me(p0.x, p0.z, yawTo(p0, pl(-1920, LANE)), -0.08);
        way = lay([p0, pl(-1934, LANE + 0.4), pl(-1920, LANE)], { walk: true, stop: 0.4 });
        hand.set(yawTo(p0, pl(-1920, LANE)), -0.08);
        hand.look(-0.3, ahead(7), true, 0);
        op.reset(p0.clone().add(V(-4.5, 1.6, 0.8)), eye());
      },
      tick: (t, _S, dt) => {
        legs();
        when(t, 1.3, 'left', () => hand.look(t, V(-1928, S.ground(-1928, LANE - 6) + 1.6, LANE - 6)));
        when(t, 2.4, 'on', () => hand.look(t, ahead(8), true));
        look(t, dt);
      },
      cam: (t) => {
        const p = P().pos as THREE.Vector3;
        const want = p.clone().add(V(-4.2, 0, 0.9));
        want.y = floorAt(want.x, want.z, p.y) + 1.65;
        return op.update(t, want, p.clone().add(V(6, 1.1, 0)));
      },
    });
  }

  // ============================================================ BATTLE ROYALE · the twenty-seventh's match, laid in
  let reel: Reel | null = null;
  const reelAt = (name: keyof typeof LEN27) => {
    let s = 0;
    for (const [k, v] of Object.entries(LEN27)) {
      if (k === name) return s;
      s += v;
    }
    return s;
  };
  const footage = (name: string, part: keyof typeof LEN27, from: number, len: number, o: { m: Kind17; under?: boolean; after?: (t: number) => void; fadeIn?: number }) => {
    const src = reelAt(part) + from;
    let start = 0;
    add(len, {
      name,
      m: o.m,
      under: o.under,
      fadeIn: o.fadeIn,
      leadTick: false,
      setup: async () => {
        reel = reel ?? (await loadReel(BR_REEL));
        start = shots.find((x) => x.name === name)!.start;
        S.parkMe();
        S.mute = true;
        S.addSounds(soundsOf(reel, src, src + len, start));
        reelScreen.show(frameUrl(reel, src));
      },
      tick: () => { S.mute = true; },
      after: (t) => {
        if (reel) reelScreen.show(frameUrl(reel, src + t));
        o.after?.(t);
      },
    });
  };
  footage('br-ship', 'ship', 0.0, 2.0, { m: 'next', fadeIn: 0.5, after: (t) => chipSay(t, 0.4, 2.0, 'BATTLE ROYALE', 'solo · duo · squad') });
  footage('br-fall', 'fall', 0.0, 4.2, { m: 'board', after: (t) => chipSay(t, -1, 1.8, 'BATTLE ROYALE', 'solo · duo · squad') });
  footage('br-canopy', 'canopy', 0.2, 4.3, { m: 'board' });
  footage('br-loot', 'loot', 0.0, 5.2, { m: 'march' });
  footage('br-fight', 'fight', 0.2, 4.0, { m: 'tight', under: true });
  footage('br-last', 'last', 0.2, 2.4, { m: 'tight', under: true });
  footage('br-win', 'win', 0.0, 1.6, { m: 'paid' });

  // ============================================================ ARENA · one round at the fort
  arenaShot(S, (len, s) => add(len, { ...s, m: 'groove' } as Any), { lens, say, chipSay, run, wait });

  // ============================================================ the three side by side, and the end card
  const own = { dir: OWN } as Reel;
  const rangeOf = (name: string, from: number) => shots.find((x) => x.name === name)!.start + from;
  add(3, {
    name: 'three',
    m: 'board',
    leadTick: false,
    setup: async () => {
      S.parkMe();
      S.mute = true;
      reel = reel ?? (await loadReel(BR_REEL));
    },
    // (this take's own frames are on the disk as it goes, at its own rate: read off the step between frames)
    tick: (_t, _S, dt) => {
      S.mute = true;
      if (dt > 0) Object.assign(own, { fps: Math.round(1 / dt), first: 0, last: 1e9 });
    },
    after: (t) => {
      // ZONA from the infected in the street, the battle royale from her canopy, the Arena from its round
      if (own.fps) {
        panels[0].show(frameUrl(own, rangeOf('rifle', 3.8) + t));
        panels[2].show(frameUrl(own, rangeOf('arena', 0.8) + t));
      }
      if (reel) panels[1].show(frameUrl(reel, reelAt('canopy') + 0.9 + t));
      show(words, ease((t - 0.3) / 0.4));
      words.style.setProperty('--k', String(ease(t / 3)));
    },
  });
  // (five seconds and what makes the film a whole number of the score's two-second bars)
  add(5 + ((2 - ((cur + 5) % 2)) % 2), {
    name: 'end',
    m: 'end',
    leadTick: false,
    setup: async () => {
      S.parkMe();
      S.mute = true;
    },
    tick: () => { S.mute = true; },
    after: (t) => {
      // the three close to the mark as the card comes up
      const k = ease(t / 0.6);
      for (const [i, p] of panels.entries()) {
        p.el.style.opacity = String(1 - k);
        if (k >= 1) continue;
        // (on from where the three were, each still within its own shot)
        if (i === 1 && reel) p.show(frameUrl(reel, reelAt('canopy') + 3.9 + t));
        else if (own.fps) p.show(frameUrl(own, rangeOf(i === 0 ? 'rifle' : 'arena', i === 0 ? 6.8 : 3.8) + t));
      }
      show(words, 1 - k);
      show(end, ease((t - 0.2) / 0.6));
    },
  });

  // the score under the cut, bar by bar (music17's band, two-second bars): each bar plays the part of the shot it
  // begins in, a blow where a part begins, quieter where gunshots are to be heard
  const bars = Math.round(total / 2);
  for (let b = 0; b < bars; b++) {
    const t = b * 2, m = [...marks].reverse().find((x) => x.at <= t + 1e-6)!, next = [...marks].reverse().find((x) => x.at <= t + 2 + 1e-6)!;
    const first = !ROWS.length || ROWS[ROWS.length - 1].kind !== m.kind;
    ROWS.push({ kind: m.kind, hit: first ? 0.8 : undefined, lift: next.kind !== m.kind ? 1 : undefined, under: m.under || undefined });
  }
  if (Math.abs(bars * 2 - total) > 0.01) say(`the score is ${bars * 2} s and the film ${total.toFixed(2)} s`);
  say(`${shots.length} shots, ${total.toFixed(1)} s, ${ROWS.length} bars of score${TALL ? ', upright' : ''}`);
  return shots;
}
