// The sixth trailer: everything so far, in three minutes (96 bars at 128 BPM). Made the way
// the others were: the real game on a clock that only moves when the film says. Nothing in it
// is taken from an earlier film: every shot is new.
//
// What it says, in the order it says it: what the game is (drop in with nothing, loot, the
// infected, other players, a tag, paid in SOL); what there is to carry (the five guns side by
// side with what each does, the Desert Eagle, the shotgun, what fits on them, and that empty
// hands run faster); the map (the village, the night, a fire, the Works under its gas); what
// happens to whoever is not ready (no mask, a broken leg, no light); the run for the bunker
// (the mask, the keycard under the gas, no jeep for whoever carries one, the door, the dark,
// the infected shut in with it, the armoury, and the second door at your back); that it plays
// on a phone; what is coming; and where it is played.
//
// Half of it is through the player's own eyes with the game's own HUD: those shots are the
// game played by the film's hand on its keys. Figures on plates are read off the rules as the
// film is made (items, the infected, the day, the bunker's plan). The payout figures are what
// the payouts page said on the day (LIVE, below: read it again before filming again). The
// infected are the game's own with their own minds, stood where the film wants them (as in
// the fifth film). What is not in the game is said to be coming, on the picture.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import type { Arrangement, Level } from './music';
import { BAR } from './shots';
import { ITEMS, makeItem } from '../sim/items';
import { INFECTED } from '../sim/infected';
import { BUNKER, bunkerAt, bunkerPlan, levelY } from '../sim/bunker';
import { DAY } from '../sim/daynight';
import { CONTRACT, DISCORD, X_HANDLE } from '../ui/hud';
import { TouchControls } from '../ui/touch';

const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
const b = (bars: number) => bars * BAR;

export const ARRANGEMENT: Arrangement = { rows: [], hits: [], risers: [] };
export const BARS6 = 96;
export const SECONDS6 = BARS6 * BAR;

/** what https://www.zonapvp.fun/api/cashins?format=json said when this was filmed (a read; never /api/tick) */
const LIVE = { on: '9 OCT 2026', paidTags: 37, paidSol: 0.74, tagPays: 0.02, share: 2 };
/** a 9 mm round and a rifle round, as the game has them (BALLISTICS in src/game/weapons.ts, which keeps them to itself) */
const NINE = 34, RIFLE = 95;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Zed = Any;
type Extra = { g?: string | null; fadeIn?: number; fadeOut?: number; flash?: number; plates?: [HTMLElement, number, number][]; hour?: number };

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any, world = S.world as Any;
  const c = world.pois[0] as { x: number; z: number };
  const P = (x: number, z: number, up = 0) => S.at(x, z, up);
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  document.body.classList.add('tr-cut4', 'tr-cut5', 'tr-cut6');
  const I = INFECTED;
  const scene = g.s.r.scene as THREE.Scene;

  // ------------------------------------------------------------ places
  const rp = world.road.points as Float32Array, RN = rp.length / 3;
  const R = (i: number) => new THREE.Vector3(rp[i * 3], rp[i * 3 + 1], rp[i * 3 + 2]);
  let mid = 0;
  for (let i = 0; i < RN; i++) if (Math.hypot(rp[i * 3] - c.x, rp[i * 3 + 2] - c.z) < Math.hypot(rp[mid * 3] - c.x, rp[mid * 3 + 2] - c.z)) mid = i;
  /** a place on the road so many metres along it from the middle of the village, which way the road runs there (`t`), and what is to its right (`n`) */
  const road = (metres: number) => {
    let i = mid, left = Math.abs(metres);
    const step = metres >= 0 ? 1 : -1;
    const tangent = (k: number) => R(Math.min(RN - 1, k + 1)).sub(R(Math.max(0, k - 1))).setY(0).normalize();
    while (left > 0 && i + step >= 0 && i + step < RN) {
      const d = R(i).distanceTo(R(i + step));
      if (d >= left) {
        const at = R(i).lerp(R(i + step), left / d), t = tangent(i);
        return { at: P(at.x, at.z), t, n: new THREE.Vector3(t.z, 0, -t.x) };
      }
      left -= d;
      i += step;
    }
    const t = tangent(i);
    return { at: P(R(i).x, R(i).z), t, n: new THREE.Vector3(t.z, 0, -t.x) };
  };
  const yawOf = (d: THREE.Vector3) => Math.atan2(-d.x, -d.z);
  const builds = world.buildings as { id: string; type: string; x: number; z: number; rot: number; floorY: number }[];
  const near = (list: { x: number; z: number }[], x: number, z: number, r: number) => list.some((o) => Math.hypot(o.x - x, o.z - z) < r);
  const trunks = (world.trees as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush'));
  const flat = (x: number, z: number, r: number) => {
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k < 8; k++) {
      const h = S.ground(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return hi - lo;
  };
  // open, level ground out of the village, for what needs room on every side
  const open: { x: number; z: number }[] = [];
  for (let r = 60; r <= 300; r += 10) {
    for (let a = 0; a < Math.PI * 2; a += 0.17) {
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (near(builds, x, z, 20) || near(trunks, x, z, 13) || near(world.props ?? [], x, z, 6) || near(world.rocks ?? [], x, z, 7)) continue;
      if (flat(x, z, 11) > 0.8 || near(open, x, z, 34)) continue;
      open.push({ x, z });
    }
  }
  if (open.length < 2) throw new Error('no open ground to film on');
  // (three places are wanted; where the map has two, the third is the first again: no two shots that follow each other use the same)
  const field = open[0], field2 = open[1], field3 = open[2] ?? open[0];
  const works = world.sites.find((q: Any) => q.kind === 'works') as { x: number; z: number };
  const camp = world.pois.find((q: Any) => q.name === 'Military Checkpoint') as { x: number; z: number };
  const police = builds.filter((x) => x.type === 'police').sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0];
  const BP = g.bunker.place as { x: number; y: number; z: number; rot: number };
  if (!works || !camp || !police || !BP) throw new Error('the map has no works, checkpoint, police station or bunker');
  const inPolice = (lx: number, lz: number, up = 0) => {
    const co = Math.cos(police.rot), si = Math.sin(police.rot);
    return new THREE.Vector3(police.x + lx * co + lz * si, police.floorY + up, police.z - lx * si + lz * co);
  };
  // the way in to the works: from the checkpoint's side
  const wIn = new THREE.Vector3(camp.x - works.x, 0, camp.z - works.z).normalize();
  const gasR = (g.s.atmo.gas?.r ?? 96) as number;
  const W = (out: number, side = 0, up = 0) => P(works.x + wIn.x * out + wIn.z * side, works.z + wIn.z * out - wIn.x * side, up);
  // the bunker: places in it by its own measure (right, forward, up from its floor)
  const H = BUNKER.hall, plan = bunkerPlan();
  const BW = (r: number, f: number, up = 0) => {
    const [x, y, z] = bunkerAt(BP, r, f, levelY() + up);
    return new THREE.Vector3(x, y, z);
  };
  const room = (kind: string) => plan.rooms.find((q) => q.kind === kind)!;
  const armoury = room('armoury'), barracks = room('barracks');
  console.log(`[tr] cut 6: ${open.length} open places; the bunker has ${plan.rooms.length} rooms; places are ${world.pois.map((q: Any) => q.name).join(', ')}`);

  // ------------------------------------------------------------ the look
  const overlay = document.getElementById('tr-overlay')!;
  const piece = (cls: string) => {
    const el = document.createElement('div');
    el.className = cls;
    overlay.appendChild(el);
    return el;
  };
  const grain = piece('tr-grain4'), black = piece('tr-black4'), white = piece('tr-flash4');
  piece('tr-vig4');
  const GRADES = ['cold', 'warm', 'war', 'gold', 'dust', 'dim', 'dim5', 'gas'];
  const grade = (name: string | null) => { for (const n of GRADES) document.body.classList.toggle(`tr-g-${n}`, n === name); };
  let frame = 0;
  const look = (t: number, len: number, o: Extra) => {
    frame++;
    grain.style.transform = `translate(${((frame * 73) % 97) - 48}px, ${((frame * 41) % 89) - 44}px)`;
    const a = o.fadeIn ? 1 - ease(t / o.fadeIn) : 0, z = o.fadeOut ? ease((t - (len - o.fadeOut)) / o.fadeOut) : 0;
    black.style.opacity = String(Math.max(a, z));
    white.style.opacity = String(o.flash ? Math.max(0, 1 - t / 0.09) * o.flash : 0);
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
  const g6 = (cls: string, html: string) => {
    const el = document.createElement('div');
    el.className = `tr-gfx ${cls}`;
    el.innerHTML = html;
    el.style.display = 'none';
    overlay.appendChild(el);
    gfx.push(el);
    return el;
  };
  const show = (el: HTMLElement, t: number) => {
    el.style.display = '';
    el.style.setProperty('--t', t.toFixed(3));
  };
  const plate = (name: string, facts: string[]) => g6('card4', `<div class="c4-name">${name}</div><div class="c4-rows">${facts.map((f) => `<span>${f}</span>`).join('')}</div>`);
  const m = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)} m`;
  const gun = (id: string) => ITEMS[id].weapon as Any;
  const nightMin = Math.round(((1 - DAY.night) * DAY.length) / 60), dayMin = Math.round(DAY.length / 60);
  const PLATE = {
    loot: plate('LOOT', [`${g.s.buildings.lootPoints.length} places things are left`, 'every one of them worth a look', 'everything has a use']),
    them: plate('THE INFECTED', [`${I.max} of them on the map`, `a gunshot carries ${m(I.hearShot)}`, 'crouch, and keep behind them']),
    tag: plate('TAKE THE TAG', ['off whoever you put down', 'stay alive 10:00 holding it', 'the map gives you away', 'cash it in: paid in SOL']),
    p38: plate('PISTOL 43', ['9 mm', `${gun('p38').capacity} rounds`, `${NINE} a round`]),
    m9: plate('M9', ['9 mm', `${gun('m9').capacity} rounds`, 'suppressor · sight · light']),
    deagle: plate('DESERT EAGLE', ['.50', `${gun('deagle').capacity} rounds`, `${gun('deagle').round.damage} a round`]),
    sniper: plate('SNIPER RIFLE', ['7.62, bolt action', `${gun('mosin').capacity} rounds`, `${RIFLE} a round`]),
    benelli: plate('BENELLI M3', ['12 gauge', `${gun('benelli').capacity} shells`, `${gun('benelli').round.pellets} pellets of ${gun('benelli').round.damage}`]),
    eagle: plate('DESERT EAGLE', [`${gun('deagle').round.damage} a round`, `a 9 mm does ${NINE}`, 'the hardest-hitting pistol in the Zone']),
    shotgun: plate('BENELLI M3', [`${gun('benelli').round.pellets} pellets a shell`, `${gun('benelli').round.pellets * gun('benelli').round.damage} if they all land`, 'nothing is worse to meet in a corridor']),
    fits: plate('WHAT FITS ON THEM', ['a holographic sight', 'suppressors: 9 mm, sniper, shotgun', 'a weapon light', 'longer magazines']),
    pace: plate('EMPTY HANDS RUN', ['holstered: 20% faster', 'aiming: 20% slower', 'X puts it away']),
    night: plate('NIGHT', [`a day is ${dayMin} minutes`, `${nightMin} of them are dark`, 'a flashlight · a weapon light · headlights']),
    fire: plate('A FIRE', ['light the ring', 'it mends you and warms a meal', 'its smoke gives you away']),
    works: plate('THE CHEMICAL WORKS', ['sunk in gas', 'the richest loot above ground', 'and the keycard']),
    mask: plate('GAS MASK', ['found in the police station', 'your way into the gas', 'and into the bunker']),
    leg: plate('LEGS BREAK', ['a hard landing', 'or a round in the leg', 'you limp until you splint it']),
    card: plate('BUNKER KEYCARD', ['kept under the gas', 'opens Bunker 17, once', 'the door keeps it']),
    bunker: plate('BUNKER 17', [`${plan.rooms.length} rooms off two passages`, 'no daylight', 'gas of its own', 'the best loot in the Zone']),
    shut: plate('SHUT IN WITH IT', ['the infected of the bunker', 'they find their way from room to room', 'bring shells']),
    arms: plate('THE ARMOURY', ['the deepest room', 'racks, benches and cases', 'two ways in']),
  };
  const card = g6('t4 t5 t6', `
    <div class="t4-kick">PVP SURVIVAL &nbsp;·&nbsp; FREE IN YOUR BROWSER &nbsp;·&nbsp; PAID IN SOL</div>
    <div class="t4-logo">ZONA</div>
    <div class="t4-line">EVERYTHING SO FAR</div>
    <div class="t4-tags"><span>THE INFECTED</span><span>THE GAS</span><span>BUNKER 17</span><span>NIGHT</span></div>`);
  // what has been paid, counted up
  const paid = g6('eco b6', `
    <div class="b6-head">PAID IN <b>SOL</b>. BY THE MACHINE.</div>
    <div class="b6-tiles">
      <div class="tile"><b data-n="${LIVE.paidTags}" data-d="0">0</b><span>tags paid, each on the chain</span></div>
      <div class="tile"><b data-n="${LIVE.paidSol}" data-d="2">0</b><span>SOL paid to players</span></div>
      <div class="tile"><b data-n="${LIVE.tagPays}" data-d="2">0</b><span>SOL a tag, or ${LIVE.share}% of the treasury if that is more</span></div>
    </div>
    <div class="b6-foot">EVERY PAYMENT CAN BE LOOKED UP: ZONAPVP.FUN/PAYOUTS &nbsp;·&nbsp; AS OF ${LIVE.on}</div>`);
  const count = (el: HTMLElement, t: number) => {
    show(el, t);
    el.querySelectorAll<HTMLElement>('[data-n]').forEach((n, k) => {
      const v = Number(n.dataset.n) * ease((t - 0.25 - k * 0.3) / 1.1);
      n.textContent = v.toFixed(Number(n.dataset.d));
    });
  };
  // the way to the bunker, on the map: drawn from where the places are
  const route = (() => {
    const spots = [{ x: police.x, z: police.z, n: '1', k: 'THE MASK', s: 'the police station' }, { x: works.x, z: works.z, n: '2', k: 'THE KEYCARD', s: 'under the gas' }, { x: BP.x, z: BP.z, n: '3', k: 'BUNKER 17', s: 'on foot: no jeep takes a keycard' }];
    const ext = Math.max(...spots.map((q) => Math.max(Math.abs(q.x), Math.abs(q.z)))) + 60;
    const X = (x: number) => (50 + (x / ext) * 44).toFixed(1), Z = (z: number) => (50 + (z / ext) * 44).toFixed(1);
    const far = spots.map((q, i) => (i ? Math.hypot(q.x - spots[i - 1].x, q.z - spots[i - 1].z) : 0));
    const line = spots.map((q, i) => `${i ? 'L' : 'M'}${X(q.x)} ${Z(q.z)}`).join(' ');
    const roadLine = Array.from({ length: Math.ceil(RN / 3) }, (_, i) => `${i ? 'L' : 'M'}${X(rp[i * 9])} ${Z(rp[i * 9 + 2])}`).join(' ');
    return g6('b6 route6', `
      <div class="b6-head">THE BEST LOOT IS <b>UNDER THE GROUND</b></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <circle cx="50" cy="50" r="46" class="r6-rim"/>
        <path d="${roadLine}" class="r6-road"/>
        <circle cx="${X(works.x)}" cy="${Z(works.z)}" r="${((gasR / ext) * 44).toFixed(1)}" class="r6-gas"/>
        <path d="${line}" class="r6-way" pathLength="100"/>
        ${spots.map((q) => `<g class="r6-spot"><circle cx="${X(q.x)}" cy="${Z(q.z)}" r="2.6"/><text x="${X(q.x)}" y="${(Number(Z(q.z)) + 1.1).toFixed(1)}">${q.n}</text></g>`).join('')}
      </svg>
      <ol>${spots.map((q, i) => `<li><b>${q.n}</b><div><strong>${q.k}</strong><span>${q.s}${i ? ` · ${Math.round(far[i] / 10) * 10} m` : ''}</span></div></li>`).join('')}</ol>`);
  })();
  const soon = g6('b6 soon6', `
    <div class="b6-head"><b>COMING</b> SOON</div>
    <ul><li>LEVEL 2, AND WHAT IS UNDER IT</li><li>MORE WEAPONS</li><li>A SAFE ZONE</li><li>AND MORE</li></ul>`);
  const end = g6('t4 end6', `
    <div class="t4-logo">ZONA</div>
    <div class="t4-line">PLAY FREE IN YOUR BROWSER</div>
    <div class="e6-url">WWW.ZONAPVP.FUN</div>
    <div class="e6-rows"><span>X &nbsp;@${X_HANDLE}</span><span>DISCORD &nbsp;${DISCORD.replace('https://', '')}</span></div>
    <div class="e6-ca">${CONTRACT}</div>`);
  // how fast the feet are going, for the shot that is about it
  const speed = g6('speed6', '<b>0.0</b><span>m/s</span><em></em>');
  const phone = piece('tr-phone-frame6');
  phone.style.display = 'none';

  // ------------------------------------------------------------ the set
  const shots: Shot[] = [];
  let cur = 0;
  const marks: Record<string, number> = {};
  const lamp = new THREE.PointLight(0xfff0d0, 0, 16, 1.4);
  scene.add(lamp);
  const add = (len: number, s: Omit<Shot, 'start' | 'end'> & Extra) => {
    const L = b(len), setup = s.setup, after = s.after, start = cur;
    cur += len;
    marks[s.name] = start;
    shots.push({
      ...s,
      start: b(start),
      end: b(start + len),
      setup: async (st) => {
        grade(s.g ?? null);
        for (const el of gfx) el.style.display = 'none';
        g.hourHeld = s.hour ?? 0.3;
        await setup?.(st);
      },
      after: (t, st) => {
        after?.(t, st);
        look(t, L, s);
        for (const [el, from, until] of s.plates ?? []) {
          if (t < from || t >= until) {
            el.style.display = 'none';
            continue;
          }
          show(el, t - from);
          el.style.setProperty('--o', String(Math.min(ease((t - from) / 0.22), ease((until - t) / 0.16))));
        }
      },
    });
  };
  const A = (i: number) => S.actors[i];
  const laid: string[] = [];
  const lay = (id: string, at: THREE.Vector3, rot = 0.4) => {
    const l = g.economy.drop(makeItem(id), at.x, at.y, at.z, rot);
    laid.push(l.uid);
    return l as { uid: string; x: number; y: number; z: number };
  };
  /** nothing else lying about a spot for an F to take first */
  const sweep = (at: THREE.Vector3, r = 2.4) => {
    for (const l of [...g.economy.loot.values()] as Any[]) if (Math.hypot(l.x - at.x, l.z - at.z) < r && Math.abs(l.y - at.y) < 2) g.economy.take(l.uid);
  };
  const hush = () => document.querySelectorAll('.hud-notes > *, .hud-feed > *').forEach((e) => e.remove());
  const preroll = async (frames: number, cam?: CamPose, each?: (k: number) => void) => {
    S.mute = true;
    for (let i = 0; i < frames; i++) {
      if (cam) S.cam = cam;
      each?.(i);
      for (const a of S.actors) a.push();
      clock.advance(1000 / 60);
      if (i % 30 === 29) await wait(20);
    }
    S.mute = false;
    S.cam = null;
  };
  /** the first-person eyes brought round to a point, a part of the way each frame */
  const eyes = (at: THREE.Vector3, k = 0.2) => {
    const p = g.player, cam = g.s.r.camera.position;
    p.yaw += wrap(Math.atan2(-(at.x - cam.x), -(at.z - cam.z)) - p.yaw) * k;
    p.pitch += (Math.atan2(at.y - cam.y, Math.hypot(at.x - cam.x, at.z - cam.z)) - p.pitch) * k;
  };
  /** the player stood somewhere looking at something */
  const stand = (at: THREE.Vector3, to: THREE.Vector3, y?: number) => S.me(at.x, at.z, Math.atan2(-(to.x - at.x), -(to.z - at.z)), 0, y);
  /** somebody of the cast stood on a floor that is not the ground's (the bunker's) */
  const floor = (a: Actor, at: THREE.Vector3, yaw: number, weapon: string | null, gear: string[] = []) => {
    a.place(at.x, at.z, yaw, weapon, gear);
    a.pos.y = at.y;
  };

  // ------------------------------------------------------------ the infected of the film
  const horde = g.horde as Any;
  const zeds: Zed[] = [];
  let made = false;
  const troupe = async () => {
    if (made) return;
    made = true;
    // none of the game's own: the film's are stood where it wants them, and nobody's clock gives them away or takes them back
    horde.clear();
    const dir = horde.director;
    dir.bodies.clear();
    dir.due = [];
    dir.tick = () => ({ added: [], gone: [], owned: [] });
    const me = horde.host.me().id;
    // (six of the valley, and six that turn up at the bunker and so wear its orange suit: it goes by where each turns up)
    for (let n = 0; n < 12; n++) {
      const i = 3000 + n, at = n < 6 ? [0, -300, 0] : [BP.x, BP.y, BP.z];
      const info = { i, s: [at[0], at[1], at[2], 0, 0, 0], hp: I.hp, own: me, h: [0, 0] };
      dir.bodies.set(i, { ...info, home: 0, diedAt: 0, heard: 0, struck: 0 });
      horde.add(info);
      zeds.push(horde.all.get(i));
    }
    for (let k = 0; k < 600 && zeds.some((z) => !z.ready || !z.mine); k++) await wait(25);
    if (zeds.some((z) => !z.ready)) throw new Error('the infected never arrived');
    // a blow at one of the film's people is the film's to land
    const strike = horde.strike.bind(horde);
    horde.strike = (z: Zed, on: { id: number }) => {
      const a = S.actors.find((x) => x.id === on.id);
      if (!a) return strike(z, on);
      if (a.alive) a.hurt(I.damage, a.pos.clone().sub(z.pos).setY(0).normalize());
    };
  };
  const plain = (nth: number) => zeds.filter((z) => z.i < 3006 && !z.dead)[nth], suited = (nth: number) => zeds.filter((z) => z.i >= 3006 && !z.dead)[nth];
  /** stand one somewhere, as it would be found: with its senses, or blind and deaf (it stands and sways) */
  const putZ = (z: Zed, at: THREE.Vector3, yaw: number, senses: boolean) => {
    if (!z) return;
    z.pos.copy(at);
    z.fallTo = at.y;
    z.home.copy(at);
    const body = horde.director.bodies.get(z.i);
    body.s[0] = at.x;
    body.s[1] = at.y;
    body.s[2] = at.z;
    body.heard = performance.now();
    z.mode = 0;
    z.after = 0;
    z.waitT = 999;
    z.yaw = yaw;
    z.gait = 0;
    z.stopT = 0;
    z.strikeAt = 0;
    z.seenAt = -1e9;
    z.lost();
    z._think ??= z.think;
    z.think = senses ? z._think : () => {};
    if (z.avatar.sick) z.avatar.sick.claw = -1;
  };
  const park = () => zeds.forEach((z, n) => !z.dead && putZ(z, P(-300 + n * 3, -300), 0, false));
  const chest = (z: Zed) => new THREE.Vector3(z.pos.x, z.pos.y + 1.2, z.pos.z);
  const face = (z: Zed) => new THREE.Vector3(z.pos.x, z.pos.y + 1.52, z.pos.z);
  let touch: Any = null;
  const reset = () => {
    for (const a of S.actors) {
      a.dance = a.surrender = a.crouch = a.aim = a.sprint = false;
      a.foe = null;
      a.rp.avatar.clearWounds();
      a.hide();
    }
    for (const uid of laid.splice(0)) g.economy.take(uid);
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Mouse0', 'Mouse2', 'AltLeft']) S.key(k, false);
    park();
    S.parkMe();
    S.kit([]);
    S.hold(null);
    S.clean();
    hush();
    lamp.intensity = 0;
    phone.style.display = 'none';
    document.body.classList.remove('touch', 'tr-phone6');
    g.lit = false;
  };
  /** the light in the hand or on the gun, on: it is the L key's, and whether it is lit already is the game's to say */
  const lightOn = () => {
    if (!g.lit) S.tap('KeyL');
  };

  g.director.t = 1;
  g.entryModal = () => {};
  g.slowHinted = true;
  document.getElementById('loading')?.classList.add('done');

  // ============================================================ 1. what it is
  const high = (t: number, from: number, to: number, len: number, up = 62): CamPose => {
    const k = ease(t / len), a = lerp(from, to, k);
    return { p: P(c.x + Math.sin(a) * 150, c.z + Math.cos(a) * 150, up), l: P(c.x, c.z, 6), fov: 34 };
  };
  add(1.5, {
    name: 'card',
    g: 'dim5',
    hour: 0.72,
    setup: async () => {
      await troupe();
      reset();
      await preroll(20, high(0, 0.3, 0.42, 1));
    },
    cam: (t) => high(t, 0.3, 0.42, b(1.5)),
    after: (t) => show(card, t + 1),
    fadeOut: 0.3,
  });

  add(2.5, {
    name: 'dawn',
    g: 'cold',
    flash: 0.4,
    setup: () => reset(),
    // (the hour run through from deep night to the middle of the morning)
    tick: (t) => { g.hourHeld = (0.9 + (t / b(2.5)) * 0.3) % 1; },
    cam: (t) => hand(high(t, 0.42, 0.7, b(2.5), 48), t, 0.6),
    titles: [{ at: 0.5, until: b(2.5) - 0.3, text: `A DAY IS ${dayMin} MINUTES. &nbsp;${nightMin} OF THEM ARE DARK.`, cls: 'small' }],
  });

  const st = road(-74);
  add(2, {
    name: 'drop-in',
    hud: true,
    g: 'warm',
    hour: 0.12,
    flash: 0.5,
    setup: async () => {
      reset();
      stand(st.at, road(-40).at);
      await preroll(12);
    },
    tick: (t) => {
      S.key('KeyW', true);
      eyes(road(-74 + 34 + t * 5).at.clone().setY(road(-40).at.y + 1.5), 0.08);
    },
    titles: [{ at: 0.4, until: b(2) - 0.2, text: 'YOU DROP IN WITH NOTHING', cls: 'big' }],
  });

  let item: { x: number; y: number; z: number } | null = null;
  add(2.5, {
    name: 'loot',
    hud: true,
    g: 'warm',
    hour: 0.14,
    plates: [[PLATE.loot, 0.5, b(2.5) - 0.15]],
    setup: async () => {
      reset();
      const at = road(-38), spot = at.at.clone().addScaledVector(at.n, 2.2);
      spot.y = S.ground(spot.x, spot.z);
      sweep(spot);
      item = lay('deagle', spot.clone().setY(spot.y + 0.03), 1.1);
      lay('ammo_50', spot.clone().add(new THREE.Vector3(0.28, 0.03, 0.12)), 0.3);
      const from = spot.clone().addScaledVector(at.t, -1.5);
      stand(from, spot);
      g.player.pitch = -0.75;
      await preroll(12);
    },
    tick: (t) => {
      if (item && t < 1.5) eyes(new THREE.Vector3(item.x, item.y, item.z), 0.16);
      else eyes(road(-10).at.clone().setY(road(-10).at.y + 1.5), 0.06);
    },
    cues: [
      { at: 1.0, fn: () => S.tap('KeyF') },
      { at: 1.7, fn: () => S.tap('KeyF') },
      { at: 2.3, fn: () => S.tap('Digit3') },
    ],
  });

  const stA = road(10);
  add(2.5, {
    name: 'them',
    g: 'cold',
    flash: 0.5,
    plates: [[PLATE.them, 0.5, b(2.5) - 0.15]],
    setup: async () => {
      reset();
      const down = yawOf(stA.t.clone().negate());
      putZ(plain(2), stA.at.clone().addScaledVector(stA.n, -0.6), down, false);
      putZ(plain(0), road(13).at.clone().addScaledVector(stA.n, 1.8), down + 0.4, false);
      putZ(plain(1), road(16).at.clone().addScaledVector(stA.n, -2.1), down - 0.3, false);
      const from = road(22).at.clone().addScaledVector(stA.n, 5.5);
      A(1).place(from.x, from.z, yawOf(stA.t.clone().negate()), 'm9', ['sack_pack']);
      A(1).crouch = true;
      await preroll(40, { p: road(-1).at.clone().setY(road(-1).at.y + 0.9), l: chest(plain(2)), fov: 30 });
    },
    tick: (_t, _s, dt) => {
      const to = road(2).at.clone().addScaledVector(stA.n, 5.5);
      A(1).go(to.x, to.z, 1.7, dt);
    },
    cam: (t) => hand({ p: road(-1 - t * 0.25).at.clone().addScaledVector(stA.n, -1.2).setY(road(-1).at.y + 0.95), l: chest(plain(2) ?? plain(0)), fov: 30 }, t, 1.2, 4),
  });

  const fa = P(field.x - 10, field.z), fb = P(field.x + 11, field.z + 2);
  add(3, {
    name: 'pvp',
    g: 'war',
    flash: 0.7,
    setup: async () => {
      reset();
      A(0).place(fa.x, fa.z, yawOf(fb.clone().sub(fa)), 'm9', ['life_vest']);
      A(2).place(fb.x, fb.z, yawOf(fa.clone().sub(fb)), 'mosin', ['sack_pack']);
      A(0).foe = A(2);
      A(2).foe = A(0);
      A(0).skill = 0.55;
      A(2).skill = 0.05;
      A(0).hp = A(2).hp = 400;
      A(0).nextShot = 0.5;
      A(2).nextShot = 0.9;
      await preroll(30, { p: P(field.x, field.z + 17, 1.5), l: P(field.x, field.z, 1.2), fov: 34 });
    },
    tick: (t) => {
      if (A(2).alive) {
        A(0).think(t);
        A(2).think(t);
      }
    },
    cues: [{ at: 4.1, fn: () => { A(2).die(fb.clone().sub(fa).normalize()); S.feedKill('Volkov', 'Kestrel', 'm9', 21, false); } }],
    rate: (t) => (t > 3.95 && t < 4.6 ? 0.3 : 1),
    cam: (t) => hand({ p: P(field.x + lerp(-4, 5, ease(t / b(3))), field.z + 17, 1.5), l: P(field.x + lerp(-3, 7, ease(t / b(3))), field.z + 1, 1.25), fov: lerp(36, 26, ease(t / b(3))) }, t, 1.4, 2),
    titles: [{ at: 0.5, until: 2.7, text: 'PLAYERS HUNT YOU', cls: 'big' }],
  });

  add(2, {
    name: 'tag',
    g: 'war',
    chain: true,
    plates: [[PLATE.tag, 0.3, b(2) - 0.15]],
    tick: (_t, _s, dt) => {
      A(0).aim = false;
      const near1 = A(0).go(fb.x - 0.9, fb.z + 0.3, 3.4, dt);
      A(0).crouch = near1;
    },
    cam: (t) => hand({ p: P(fb.x + 4.5, fb.z + 5.5, 1.1), l: P(fb.x - 0.4, fb.z, 0.6), fov: 30 }, t, 1.1, 7),
  });

  add(3, {
    name: 'paid',
    g: 'dim',
    flash: 0.5,
    hour: 0.5,
    setup: () => reset(),
    cam: (t) => high(t, 1.2, 1.45, b(3), 70),
    after: (t) => count(paid, t),
  });

  // ============================================================ 2. what there is to carry
  const ROW = ['p38', 'm9', 'deagle', 'mosin', 'benelli'], GAP = 2.3;
  const rowAt = (k: number, up = 0) => P(field2.x + (k - 2) * GAP, field2.z, up);
  add(4, {
    name: 'guns',
    g: 'gold',
    hour: 0.62,
    flash: 0.8,
    plates: [PLATE.p38, PLATE.m9, PLATE.deagle, PLATE.sniper, PLATE.benelli].map((p, k) => [p, 0.25 + k * b(0.78), 0.25 + (k + 1) * b(0.78) - 0.12] as [HTMLElement, number, number]),
    setup: async () => {
      reset();
      ROW.forEach((id, k) => {
        A(k).place(rowAt(k).x, rowAt(k).z, 0, id, k % 2 ? ['life_vest'] : ['sack_pack']);
        A(k).yaw = Math.PI;
        A(k).aim = k !== 3;
      });
      await preroll(40, { p: rowAt(0, 1.35).add(new THREE.Vector3(1.1, 0, 2.6)), l: rowAt(0, 1.3), fov: 28 });
    },
    cam: (t) => {
      // (along the row, one gun at a time, a pause on each)
      const k = Math.min(4, t / b(0.78)), i = Math.floor(k), x = i + ease((k - i) * 2.2 - 1.2);
      const at = P(field2.x + (Math.min(4, x) - 2) * GAP, field2.z, 1.32);
      return hand({ p: at.clone().add(new THREE.Vector3(1.0, 0.02, 2.5)), l: at.clone().add(new THREE.Vector3(0.25, 0, 0)), fov: 26 }, t, 0.7, 3);
    },
  });

  const shoot = (len: number, name: string, o: { kit: (string | [string, number])[]; mods?: Record<string, string[]>; slot: string; hour?: number; g?: string; plate: HTMLElement; stage: (from: THREE.Vector3, fwd: THREE.Vector3, side: THREE.Vector3) => void; aim: () => Zed | undefined; when: (t: number, d: number) => boolean; head?: boolean; light?: boolean; every?: number }) => {
    let last = -9;
    add(len, {
      name,
      hud: true,
      g: o.g ?? 'war',
      hour: o.hour,
      flash: 0.6,
      plates: [[o.plate, 0.4, b(len) - 0.15]],
      setup: async () => {
        reset();
        last = -9;
        const from = P(field3.x, field3.z), fwd = new THREE.Vector3(0, 0, -1), side = new THREE.Vector3(1, 0, 0);
        o.stage(from, fwd, side);
        S.kit(o.kit, o.mods ?? {});
        S.hold(o.slot);
        stand(from, from.clone().addScaledVector(fwd, 10));
        if (o.light) lightOn();
        await preroll(16);
      },
      tick: (t) => {
        const z = o.aim();
        S.key('Mouse2', t > 0.35);
        if (!z) return;
        eyes(o.head ? face(z) : chest(z), 0.22);
        const d = Math.hypot(z.pos.x - g.player.pos.x, z.pos.z - g.player.pos.z);
        if (t - last > (o.every ?? 0.7) && o.when(t, d)) {
          last = t;
          S.tap('Mouse0');
        }
      },
      after: (t) => {
        if (t > b(len) - 0.05) S.key('Mouse2', false);
      },
    });
  };
  shoot(2.5, 'deagle', {
    kit: ['deagle', ['ammo_50', 14]], slot: 'holster', plate: PLATE.eagle, head: true, every: 0.8,
    stage: (from, fwd, side) => {
      putZ(plain(0), from.clone().addScaledVector(fwd, 11).addScaledVector(side, -0.6), yawOf(fwd), false);
      putZ(plain(1), from.clone().addScaledVector(fwd, 15).addScaledVector(side, 2.2), yawOf(fwd) + 0.5, false);
    },
    aim: () => [plain(0), plain(1)].find((z) => z && z.pos.z > -200),
    when: (t) => t > 1.2,
  });
  shoot(2.5, 'benelli', {
    kit: ['benelli', ['ammo_12', 14]], mods: { benelli: ['red_dot'] }, slot: 'primary', plate: PLATE.shotgun, every: 0.75,
    stage: (from, fwd, side) => {
      [0, 1, 2].forEach((k) => putZ(plain(k), from.clone().addScaledVector(fwd, 15 + k * 3.2).addScaledVector(side, (k - 1) * 1.6), yawOf(fwd.clone().negate()), true));
    },
    aim: () => zeds.filter((z) => z.i < 3006 && !z.dead && z.pos.z > -200).sort((p, q) => p.pos.distanceTo(g.player.pos) - q.pos.distanceTo(g.player.pos))[0],
    when: (_t, d) => d < 6.5,
  });
  shoot(2.5, 'quiet', {
    kit: ['m9', ['ammo_9mm', 30]], mods: { m9: ['suppressor_9', 'red_dot', 'gun_light'] }, slot: 'holster', plate: PLATE.fits, head: true, hour: 0.735, g: 'cold', light: true, every: 9,
    stage: (from, fwd, side) => {
      [0, 1, 2].forEach((k) => putZ(plain(k), from.clone().addScaledVector(fwd, 9 + k * 2.4).addScaledVector(side, (k - 1) * 2.6), yawOf(fwd) + (k - 1) * 0.3, false));
    },
    aim: () => plain(1) && plain(1).pos.z > -200 ? plain(1) : undefined,
    when: (t) => t > 1.5,
  });

  add(2.5, {
    name: 'holster',
    hud: true,
    g: 'warm',
    hour: 0.2,
    flash: 0.5,
    plates: [[PLATE.pace, 0.4, b(2.5) - 0.15]],
    setup: async () => {
      reset();
      S.kit(['m9']);
      S.hold('holster');
      const a = road(-150);
      stand(a.at, road(-110).at);
      await preroll(10);
    },
    tick: (t) => {
      S.key('KeyW', true);
      S.key('ShiftLeft', true);
      g.player.vitals.stamina = 300;
      eyes(road(-150 + 40 + t * 7).at.clone().setY(road(-100).at.y + 1.5), 0.08);
    },
    cues: [{ at: 2.1, fn: () => S.tap('KeyX') }],
    after: (t) => {
      show(speed, t);
      (speed.firstElementChild as HTMLElement).textContent = (g.player.groundSpeed as number).toFixed(1);
      (speed.lastElementChild as HTMLElement).textContent = g.player.emptyHanded ? 'EMPTY HANDS' : 'GUN OUT';
      speed.classList.toggle('free', !!g.player.emptyHanded);
    },
  });

  // ============================================================ 3. the map
  add(2, {
    name: 'village',
    g: 'gold',
    hour: 0.66,
    flash: 0.6,
    setup: () => reset(),
    cam: (t) => {
      const k = t / b(2), at = road(lerp(-70, 10, k)).at, to = road(lerp(-20, 70, k)).at;
      return hand({ p: at.clone().setY(at.y + lerp(15, 9, ease(k))), l: to.clone().setY(to.y + 2), fov: 40 }, t, 0.8, 5);
    },
    titles: [{ at: 0.4, until: b(2) - 0.25, text: 'ONE MAP. EVERYBODY ON IT.', cls: 'big' }],
  });

  add(2.5, {
    name: 'night',
    hud: true,
    hour: 0.87,
    flash: 0.4,
    plates: [[PLATE.night, 0.4, b(2.5) - 0.15]],
    setup: async () => {
      reset();
      S.kit(['flashlight']);
      stand(road(-34).at, road(0).at);
      lightOn();
      await preroll(20);
    },
    tick: (t) => {
      S.key('KeyW', true);
      eyes(road(-34 + 26 + t * 4).at.clone().setY(road(0).at.y + 1.4), 0.07);
    },
  });

  let pit: THREE.Vector3 | null = null;
  add(2, {
    name: 'fire',
    hour: 0.9,
    flash: 0.4,
    plates: [[PLATE.fire, 0.3, b(2) - 0.15]],
    setup: async () => {
      reset();
      const fires = g.fires.spots as THREE.Vector3[];
      let fi = 0;
      fires.forEach((s, i) => { if (Math.hypot(s.x - c.x, s.z - c.z) < Math.hypot(fires[fi].x - c.x, fires[fi].z - c.z)) fi = i; });
      pit = fires[fi].clone();
      g.fires.set(fi, 900);
      A(3).place(pit.x + 1.5, pit.z + 0.4, yawOf(new THREE.Vector3(-1.5, 0, -0.4)), null, ['sack_pack']);
      A(4).place(pit.x - 1.2, pit.z + 1.1, yawOf(new THREE.Vector3(1.2, 0, -1.1)), 'mosin', []);
      A(3).crouch = true;
      await preroll(90, { p: P(pit.x + 0.6, pit.z + 5.2, 1.0), l: pit.clone().setY(pit.y + 0.7), fov: 32 });
    },
    cam: (t) => hand({ p: P(pit!.x + 0.6 - t * 0.2, pit!.z + 5.2, 1.0), l: pit!.clone().setY(pit!.y + 0.75), fov: 32 }, t, 1, 9),
  });

  add(3, {
    name: 'works',
    g: 'gas',
    flash: 0.6,
    plates: [[PLATE.works, 0.6, b(3) - 0.15]],
    setup: () => reset(),
    cam: (t) => {
      const k = ease(t / b(3));
      return hand({ p: W(lerp(gasR + 70, gasR - 10, k), lerp(26, 8, k), lerp(34, 7, k)), l: W(0, 0, 5), fov: 38 }, t, 0.8, 11);
    },
  });

  // ============================================================ 4. what happens to whoever is not ready
  add(2.5, {
    name: 'no-mask',
    hud: true,
    g: 'gas',
    flash: 0.5,
    fadeOut: 0.5,
    setup: async () => {
      reset();
      stand(W(gasR - 24), W(0));
      g.player.vitals.health = 62;
      await preroll(8);
    },
    tick: () => {
      S.key('KeyW', true);
      eyes(W(0, 0, 3), 0.05);
    },
    titles: [{ at: 2.3, until: b(2.5) - 0.1, text: 'NO MASK. NO CHANCE.', cls: 'big' }],
  });

  add(2.5, {
    name: 'mask',
    hud: true,
    g: 'cold',
    flash: 0.5,
    plates: [[PLATE.mask, 0.3, b(2.5) - 0.15]],
    setup: async () => {
      reset();
      // on the duty desk in the lobby of the police station, with nothing else on it to take first
      const desk = inPolice(-0.2, -1.0);
      sweep(desk);
      item = lay('gasmask', inPolice(-0.15, -0.78, 0.8), 2.2);
      const at = inPolice(0.25, 0.75);
      S.me(at.x, at.z, Math.atan2(-(desk.x - at.x), -(desk.z - at.z)), -0.5, police.floorY);
      lamp.position.copy(inPolice(0.5, 0.3, 2.3));
      lamp.intensity = 9;
      await preroll(14);
    },
    tick: (t) => {
      if (item) eyes(new THREE.Vector3(item.x, item.y + 0.05, item.z), 0.14);
      S.key('KeyW', t > 0.25 && t < 0.75);
    },
    cues: [{ at: 2.3, fn: () => S.tap('KeyF') }],
  });

  add(2, {
    name: 'leg',
    hud: true,
    g: 'cold',
    flash: 0.6,
    plates: [[PLATE.leg, 0.9, b(2) - 0.15]],
    setup: async () => {
      reset();
      // (off the edge of something high: eight metres of air)
      const at = P(field.x + 30, field.z - 20);
      S.me(at.x, at.z, 0.4, -0.5, at.y + 8.2);
    },
    tick: (t) => {
      S.key('KeyW', t > 1.5);
      if (t > 1.3) g.player.pitch += (-0.1 - g.player.pitch) * 0.08;
    },
  });

  add(2.5, {
    name: 'dark',
    hud: true,
    flash: 0.3,
    setup: async () => {
      reset();
      const q = barracks, mid = BW((q.r0 + q.r1) / 2, (q.f0 + q.f1) / 2), from = BW((q.r0 + q.r1) / 2 - 4.5, (q.f0 + q.f1) / 2);
      S.kit(['gasmask', 'flashlight']);
      S.me(from.x, from.z, Math.atan2(-(mid.x - from.x), -(mid.z - from.z)), 0, from.y);
      if (g.lit) S.tap('KeyL');
      putZ(suited(0), mid, Math.atan2(-(from.x - mid.x), -(from.z - mid.z)), false);
      await preroll(20);
    },
    cues: [
      { at: 1.5, fn: () => lightOn() },
      { at: 1.9, fn: () => { const z = suited(0); if (z) putZ(z, z.pos.clone(), z.yaw, true); } },
    ],
    tick: (t) => {
      const z = suited(0);
      if (z && t > 1.5) eyes(face(z), 0.2);
      S.key('KeyS', t > 2.4);
    },
    titles: [{ at: 0.3, until: 1.4, text: 'NO LIGHT.', cls: 'big' }, { at: 2.4, until: b(2.5) - 0.1, text: 'BRING ONE.', cls: 'big' }],
  });

  // ============================================================ 5. the run for the bunker
  add(3, {
    name: 'route',
    g: 'dim',
    flash: 0.6,
    setup: () => reset(),
    cam: (t) => ({ p: P(lerp(works.x, BP.x, ease(t / b(3)) * 0.4) * 0.5, lerp(works.z, BP.z, ease(t / b(3)) * 0.4) * 0.5 + 120, 210), l: P(0, 0, 0), fov: 40 }),
    after: (t) => show(route, t),
  });

  add(2.5, {
    name: 'keycard',
    hud: true,
    g: 'gas',
    flash: 0.5,
    plates: [[PLATE.card, 0.4, b(2.5) - 0.15]],
    setup: async () => {
      reset();
      const from = W(20, 6), spot = W(18.6, 6.4);
      S.kit(['gasmask']);
      sweep(spot);
      item = lay('keycard', spot.clone().setY(spot.y + 0.03), 0.8);
      stand(from, spot);
      g.player.pitch = -0.7;
      await preroll(14);
    },
    tick: (t) => {
      if (item && t < 2.4) eyes(new THREE.Vector3(item.x, item.y, item.z), 0.15);
      else eyes(W(40, 0, 2), 0.05);
    },
    cues: [{ at: 1.6, fn: () => S.tap('KeyF') }],
  });

  add(2, {
    name: 'no-jeep',
    hud: true,
    g: 'warm',
    hour: 0.6,
    flash: 0.5,
    setup: async () => {
      reset();
      const j = ([...g.garage.jeeps.values()] as Any[]).filter((q) => !q.wreck).sort((p, q) => Math.hypot(p.pos.x - c.x, p.pos.z - c.z) - Math.hypot(q.pos.x - c.x, q.pos.z - c.z))[0];
      if (!j) throw new Error('no jeep on the map');
      S.kit(['keycard']);
      const from = P(j.pos.x + 2.6, j.pos.z + 1.2);
      stand(from, j.pos);
      await preroll(14);
    },
    cues: [{ at: 1.3, fn: () => S.tap('KeyF') }],
    titles: [{ at: 0.4, until: b(2) - 0.2, text: 'NO JEEP TAKES A KEYCARD', cls: 'big' }],
  });

  const runFrom = P(field2.x - 30, field2.z + 10), runTo = P(field2.x + 60, field2.z - 6);
  add(2.5, {
    name: 'run',
    hud: true,
    g: 'war',
    hour: 0.72,
    flash: 0.7,
    setup: async () => {
      reset();
      S.kit(['keycard', 'm9']);
      S.hold(null);
      stand(runFrom, runTo);
      const back = runFrom.clone().add(new THREE.Vector3(-38, 0, 14));
      A(0).place(back.x, back.z, 0, 'mosin', []);
      A(2).place(back.x + 6, back.z - 9, 0, 'm9', []);
      await preroll(10);
    },
    tick: (t) => {
      S.key('KeyW', true);
      S.key('ShiftLeft', true);
      g.player.vitals.stamina = 300;
      eyes(runTo.clone().setY(runTo.y + 1.5), 0.06);
      // (rounds from behind, wide of the mark: beside and ahead)
      const p = g.player.pos as THREE.Vector3;
      for (const [a, every, off] of [[A(0), 1.3, 0.2], [A(2), 0.45, 0]] as [Actor, number, number][]) {
        if (Math.floor((t + off) / every) !== Math.floor((t + off - 1 / 60) / every)) a.fireAt(new THREE.Vector3(p.x + 9 + S.rnd() * 6, p.y + 0.4, p.z + (S.rnd() - 0.5) * 9), 0.01);
      }
    },
    titles: [{ at: 0.4, until: b(2.5) - 0.2, text: 'THE WHOLE WAY ON FOOT', cls: 'big' }],
  });

  const doorAt = BW(0, H.front, 1.2), foot = BW(0, Math.min(BUNKER.stair.foot - 0.3, H.front + 1.0));
  add(3, {
    name: 'door',
    hud: true,
    flash: 0.5,
    setup: async () => {
      reset();
      S.kit(['gasmask', 'flashlight', 'keycard', 'benelli', ['ammo_12', 21]], { benelli: ['gun_light', 'red_dot'] });
      S.hold(null);
      S.me(foot.x, foot.z, Math.atan2(-(doorAt.x - foot.x), -(doorAt.z - foot.z)), 0, foot.y);
      await preroll(20);
    },
    tick: (t) => {
      eyes(t < 3.2 ? doorAt : BW(0, H.front - 10, 1.4), 0.1);
      S.key('KeyW', t > 3.4);
    },
    cues: [
      { at: 0.5, fn: () => S.tap('KeyF') },
      { at: 3.0, fn: () => lightOn() },
    ],
    titles: [{ at: 3.3, until: b(3) - 0.2, text: 'BUNKER 17', cls: 'big' }],
  });

  add(3.5, {
    name: 'passage',
    hud: true,
    flash: 0.3,
    plates: [[PLATE.bunker, 0.8, b(3.5) - 0.15]],
    setup: async () => {
      reset();
      S.kit(['gasmask', 'flashlight']);
      const from = BW(0.3, H.front - 2);
      S.me(from.x, from.z, Math.atan2(-(BW(0, H.back).x - from.x), -(BW(0, H.back).z - from.z)), 0, from.y);
      lightOn();
      await preroll(20);
    },
    tick: (t) => {
      S.key('KeyW', true);
      S.key('AltLeft', t < 1);
      // (the light goes over the walls as whoever carries it looks about)
      const f = H.front - 2 - t * 4.3 - 9;
      eyes(BW(Math.sin(t * 1.15) * 1.5, Math.max(H.back, f), 1.25 + Math.sin(t * 0.8) * 0.25), 0.07);
    },
  });

  add(3.5, {
    name: 'horde',
    hud: true,
    flash: 0.6,
    plates: [[PLATE.shut, 0.4, 3.6]],
    setup: async () => {
      reset();
      S.kit(['gasmask', 'benelli', ['ammo_12', 21]], { benelli: ['gun_light', 'red_dot'] });
      S.hold('primary');
      const from = BW(0, plan.cross + 7.5);
      S.me(from.x, from.z, Math.atan2(-(BW(0, H.back).x - from.x), -(BW(0, H.back).z - from.z)), 0, from.y);
      lightOn();
      [0, 1, 2, 3, 4].forEach((k) => putZ(suited(k), BW((k % 2 ? 0.9 : -0.9) * (k === 4 ? 0 : 1), plan.cross - 6.5 - k * 2.6), 0, true));
      await preroll(16);
    },
    tick: (() => {
      let last = -9;
      return (t: number) => {
        if (t < 0.1) last = -9;
        const z = zeds.filter((q) => q.i >= 3006 && !q.dead && q.pos.y < BP.y - 2).sort((p, q) => p.pos.distanceTo(g.player.pos) - q.pos.distanceTo(g.player.pos))[0];
        S.key('KeyS', t > 2.2);
        if (!z) return;
        eyes(chest(z), 0.25);
        if (t - last > 0.62 && z.pos.distanceTo(g.player.pos) < 7.5) {
          last = t;
          S.tap('Mouse0');
        }
      };
    })(),
  });

  // ============================================================ 6. the best loot, and who else wants it
  const aMid = BW((armoury.r0 + armoury.r1) / 2, (armoury.f0 + armoury.f1) / 2);
  const aDoor = (k: number) => BW(armoury.doors[k][0], armoury.doors[k][1]);
  add(3, {
    name: 'armoury',
    hud: true,
    flash: 0.4,
    plates: [[PLATE.arms, 0.5, b(3) - 0.15]],
    setup: async () => {
      reset();
      S.kit(['gasmask', 'flashlight']);
      const from = aDoor(0).clone().lerp(aMid, 0.28);
      S.me(from.x, from.z, Math.atan2(-(aMid.x - from.x), -(aMid.z - from.z)), -0.15, from.y);
      lightOn();
      await preroll(20);
    },
    tick: (t) => {
      S.key('KeyW', t < 1.2);
      S.key('AltLeft', true);
      // (the light taken round the room, floor to benches to racks)
      const a = lerp(-1.1, 1.2, ease(t / b(3)));
      const d = aMid.clone().sub(g.player.pos).setY(0).normalize();
      const to = new THREE.Vector3(d.x * Math.cos(a) - d.z * Math.sin(a), 0, d.x * Math.sin(a) + d.z * Math.cos(a));
      eyes(g.player.pos.clone().addScaledVector(to, 5).setY(aMid.y + 0.75), 0.08);
    },
  });

  add(3, {
    name: 'backstab',
    flash: 0.5,
    setup: async () => {
      reset();
      const d2 = aDoor(armoury.doors.length > 1 ? 1 : 0), into = aMid.clone().sub(d2).setY(0).normalize();
      // (somebody on their knees at a case, and the room's other door behind them)
      const v = aMid.clone().addScaledVector(into, 1.2);
      floor(A(1), v, yawOf(into), null, ['sack_pack']);
      A(1).crouch = true;
      A(1).hp = 500;
      const k = d2.clone().addScaledVector(into, -1.2);
      floor(A(0), k, yawOf(into), 'deagle', ['life_vest']);
      lamp.position.copy(aMid).setY(aMid.y + 2.5);
      lamp.intensity = 16;
      await preroll(30, { p: v.clone().addScaledVector(into, 2.6).setY(v.y + 1.2), l: v.clone().setY(v.y + 0.8), fov: 36 });
    },
    tick: (t, _s, dt) => {
      const d2 = aDoor(armoury.doors.length > 1 ? 1 : 0), into = aMid.clone().sub(d2).setY(0).normalize();
      const to = d2.clone().addScaledVector(into, 1.3);
      if (t > 0.8 && t < 2.6) {
        A(0).go(to.x, to.z, 1.6, dt, false);
        A(0).pos.y = aMid.y;
      }
      A(0).aim = t > 2.2;
      A(1).pos.y = aMid.y;
    },
    cues: [
      { at: 3.1, fn: () => A(0).fireAt(A(1).chest(), 0.004) },
      { at: 3.45, fn: () => { const d = A(1).pos.clone().sub(A(0).pos).setY(0).normalize(); A(0).fireAt(A(1).chest(), 0.004); A(1).die(d); S.feedKill('Volkov', 'Mira', 'deagle', 5, false); } },
    ],
    rate: (t) => (t > 3.05 && t < 3.9 ? 0.35 : 1),
    cam: (t) => {
      const d2 = aDoor(armoury.doors.length > 1 ? 1 : 0), into = aMid.clone().sub(d2).setY(0).normalize(), v = aMid.clone().addScaledVector(into, 1.2);
      const side = new THREE.Vector3(into.z, 0, -into.x);
      return hand({ p: v.clone().addScaledVector(into, 2.7).addScaledVector(side, lerp(1.4, 0.5, ease(t / b(3)))).setY(v.y + 1.15), l: v.clone().addScaledVector(into, -1.5).setY(v.y + 1.0), fov: 38 }, t, 1.2, 13);
    },
    titles: [{ at: 3.9, until: b(3) - 0.15, text: 'WATCH YOUR BACK', cls: 'big' }],
  });

  add(3, {
    name: 'level2',
    hud: true,
    flash: 0.4,
    fadeOut: 0.5,
    setup: async () => {
      reset();
      S.kit(['gasmask', 'flashlight']);
      const from = BW(0, H.back + 8);
      S.me(from.x, from.z, Math.atan2(-(BW(0, H.back).x - from.x), -(BW(0, H.back).z - from.z)), 0, from.y);
      lightOn();
      await preroll(20);
    },
    tick: (t) => {
      S.key('KeyW', t < 3.2);
      S.key('AltLeft', true);
      eyes(BW(0, H.back, 1.5), 0.08);
    },
    titles: [{ at: 0.6, until: 3.0, text: 'LEVEL 2. &nbsp;WHAT IS DOWN THERE?', cls: 'small' }, { at: 3.3, until: b(3) - 0.2, text: 'COMING SOON', cls: 'soon' }],
  });

  // ============================================================ 7. everywhere, with anybody
  add(3, {
    name: 'phone',
    hud: true,
    g: 'warm',
    hour: 0.25,
    flash: 0.6,
    setup: async () => {
      reset();
      S.kit(['m9', ['ammo_9mm', 30]]);
      S.hold('holster');
      stand(road(-30).at, road(10).at);
      document.body.classList.add('touch', 'tr-phone6');
      phone.style.display = '';
      touch ??= new TouchControls(g.input, new Proxy({}, { get: () => () => {} }) as never);
      await preroll(12);
    },
    tick: (t) => {
      S.key('KeyW', true);
      eyes(road(-30 + 30 + t * 4).at.clone().setY(road(0).at.y + 1.5), 0.07);
    },
    after: () => touch?.update(true, false, true, { g: null, aiming: false, lamp: false, lit: false }),
    titles: [{ at: 0.4, until: b(3) - 0.2, text: 'ON YOUR PHONE TOO', cls: 'top' }],
  });

  const meet = P(field3.x + 6, field3.z + 20);
  add(3, {
    name: 'squad',
    g: 'gold',
    hour: 0.64,
    flash: 0.6,
    setup: async () => {
      reset();
      const at = (k: number) => P(meet.x + (k - 1) * 1.9, meet.z + Math.abs(k - 1) * 0.7);
      [A(0), A(1), A(3)].forEach((a, k) => a.place(at(k).x, at(k).z, Math.PI, k === 0 ? 'benelli' : k === 1 ? 'deagle' : 'mosin', k === 1 ? ['sack_pack'] : ['life_vest']));
      [A(0), A(1), A(3)].forEach((a) => (a.yaw = 0));
      await preroll(30, { p: P(meet.x - 1.5, meet.z - 6.2, 1.25), l: P(meet.x, meet.z, 1.2), fov: 34 });
    },
    cues: [
      { at: 0.7, fn: () => A(1).call('friendly') },
      { at: 2.0, fn: () => A(0).call('here') },
      { at: 3.4, fn: () => { A(3).dance = true; } },
    ],
    cam: (t) => hand({ p: P(meet.x - 1.5 + t * 0.5, meet.z - 6.2, 1.25), l: P(meet.x + t * 0.15, meet.z, 1.2), fov: lerp(34, 30, ease(t / b(3))) }, t, 1.1, 17),
    titles: [{ at: 3.2, until: b(3) - 0.2, text: 'TEAM UP. &nbsp;OR DO NOT.', cls: 'big' }],
  });

  // ============================================================ 8. what is coming, and where it is played
  add(4, {
    name: 'soon',
    g: 'dim',
    hour: 0.74,
    flash: 0.7,
    setup: () => reset(),
    cam: (t) => high(t, 2.2, 2.5, b(4), 80),
    after: (t) => show(soon, t),
  });

  add(5, {
    name: 'end',
    g: 'dim5',
    hour: 0.78,
    flash: 0.5,
    fadeOut: 0.8,
    setup: () => reset(),
    cam: (t) => high(t, 2.5, 2.75, b(5), 62),
    after: (t) => show(end, t),
  });

  // ------------------------------------------------------------ the score, laid under the cut: quiet at night and under the ground, driving in the open
  {
    const Am = 33, F = 41, C = 36, G = 43, E = 40, Dm = 38;
    const PLAYED: [string, Level][] = [
      ['card', 'low'], ['dawn', 'pulse'], ['drop-in', 'tick'], ['loot', 'tick'], ['them', 'tense'], ['pvp', 'drive'], ['tag', 'tense'], ['paid', 'bright'],
      ['guns', 'build'], ['deagle', 'full'], ['benelli', 'full'], ['quiet', 'tense'], ['holster', 'drive'],
      ['village', 'bright'], ['night', 'low'], ['fire', 'pulse'], ['works', 'tense'],
      ['no-mask', 'low'], ['mask', 'tick'], ['leg', 'tick'], ['dark', 'low'],
      ['route', 'build'], ['keycard', 'tense'], ['no-jeep', 'tick'], ['run', 'drive'], ['door', 'low'], ['passage', 'low'], ['horde', 'top'],
      ['armoury', 'tick'], ['backstab', 'tense'], ['level2', 'low'],
      ['phone', 'bright'], ['squad', 'full'], ['soon', 'build'], ['end', 'end'],
    ];
    // (a turn of four chords in the open; under the ground and at night one chord held, and a darker one)
    const ROUND = [Am, F, C, G], DARK = new Set(['night', 'no-mask', 'dark', 'door', 'passage', 'level2', 'armoury', 'backstab']);
    let since = 0, was: Level | null = null;
    for (let i = 0; i < BARS6; i++) {
      let level: Level = 'low', name = 'card';
      for (const [n, lv] of PLAYED) if (marks[n] !== undefined && marks[n] <= i + 0.01) { level = lv; name = n; }
      since = level === was ? since + 1 : 0;
      was = level;
      const root = level === 'end' ? Am : DARK.has(name) ? (since % 4 < 2 ? Dm : E) : level === 'build' ? E : ROUND[since % 4];
      ARRANGEMENT.rows.push([root, root === Am || root === E || root === Dm, level]);
    }
    const at = (name: string, plus = 0) => marks[name] * BAR + plus;
    for (const [n, hit] of [['dawn', 0.6], ['pvp', 1], ['paid', 0.9], ['guns', 1], ['deagle', 0.8], ['benelli', 0.8], ['holster', 0.6], ['village', 0.8], ['works', 0.9], ['no-mask', 0.6], ['dark', 0.5], ['route', 0.9], ['run', 1.1], ['door', 0.7], ['horde', 1.1], ['backstab', 0.6], ['phone', 0.8], ['squad', 0.9], ['soon', 1], ['end', 1.2]] as [string, number][]) ARRANGEMENT.hits.push([at(n), hit]);
    ARRANGEMENT.hits.push([at('backstab', 3.45), 1.1], [at('dark', 1.9), 0.9]);
    ARRANGEMENT.risers.push([at('tag'), at('paid'), 0.7], [at('quiet', b(1.5)), at('holster'), 0.6], [at('keycard', b(1)), at('run'), 0.9], [at('passage', b(1.5)), at('horde'), 1], [at('level2', b(1.5)), at('phone'), 0.8], [at('soon', b(2)), at('end'), 1]);
    ARRANGEMENT.hits.sort((x, y) => x[0] - y[0]);
    console.log(`[tr] cut 6: ${shots.length} shots, ${cur} bars, ${(cur * BAR).toFixed(2)} s`);
  }
  return shots;
}
