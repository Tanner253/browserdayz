// The fifth trailer: the infected, and what comes after them. Forty-nine seconds (26 bars at
// 128 BPM), made the way the others were: the real game on a clock that only moves when the
// film says.
//
// What it says, in the order it says it: what they look like (the three bodies), how they
// find you (a board: how far they see and hear, drawn to scale), that you can get past one
// behind its back, that a shot brings them and a shot through a suppressor does not, what
// they do when they have seen you (they come, slower than a jog), how one is beaten (a guard
// stops its blow, and stops IT for the moment a blow back needs), that two people do better
// than one, and that they can be set on somebody else. Every figure on a plate or the board
// is read off the game's own rules as the film is made (INFECTED in src/sim/infected.ts, the
// weapons in src/sim/items.ts): if a rule changes, the film's words do.
//
// The infected in it are the game's own, with the game's own minds: they see, hear, chase
// and strike by the rules a player meets. The film stands them where it wants them and says
// which of them have their senses; it does not move them. The people are the game's player
// bodies, as in the other films. A blow on one of those is the film's to count (playing
// alone, the game has nobody but the player to hurt), and so is a shot of theirs that kills.
//
// The last part is what is planned next and is said to be: the gas zone, the mask that lets
// somebody into it (the mask is in the game already, and found in the police station
// already; that it is NEEDED anywhere is what is coming), and the guns that will lie only
// there. No such gun is shown, because there is none yet: a case in the gas, and words. The
// gas itself is the film's (the world's own fog and sky turned thick and green for those
// shots, and the game's own smoke drifting in it).

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import type { Arrangement, Level } from './music';
import { BAR } from './shots';
import { ITEMS, makeItem } from '../sim/items';
import { INFECTED } from '../sim/infected';

const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
const b = (bars: number) => bars * BAR;

export const ARRANGEMENT: Arrangement = { rows: [], hits: [], risers: [] };
export const BARS5 = 26;
export const SECONDS5 = BARS5 * BAR;

type Zed = any;
type Extra = { g?: string | null; fadeIn?: number; fadeOut?: number; flash?: number; plates?: [HTMLElement, number, number][] };

export function buildShots(S: Stage): Shot[] {
  const g = S.g, world = S.world;
  const c = world.pois[0] as { x: number; z: number };
  const P = (x: number, z: number, up = 0) => S.at(x, z, up);
  const clock = (window as any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  document.body.classList.add('tr-cut4', 'tr-cut5');
  const I = INFECTED;

  // ------------------------------------------------------------ places
  // the village street: the road where it passes nearest the middle of the village, and a way along it
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
  // open, level ground out of the village, for what needs room on every side
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
  const open: { x: number; z: number }[] = [];
  for (let r = 60; r <= 230; r += 10) {
    for (let a = 0; a < Math.PI * 2; a += 0.17) {
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (near(builds, x, z, 20) || near(trunks, x, z, 13) || near(world.props ?? [], x, z, 6) || near(world.rocks ?? [], x, z, 7)) continue;
      if (flat(x, z, 11) > 0.8 || near(open, x, z, 34)) continue;
      open.push({ x, z });
    }
  }
  if (open.length < 2) throw new Error('no open ground to film on');
  const field = open[0], field2 = open[1];
  console.log(`[tr] cut 5: ${open.length} open places; the street is road point ${mid} of ${RN}`);

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
  const g5 = (cls: string, html: string) => {
    const el = document.createElement('div');
    el.className = `tr-gfx ${cls}`;
    el.innerHTML = html;
    el.style.display = 'none';
    overlay.appendChild(el);
    return el;
  };
  const show = (el: HTMLElement, t: number) => {
    el.style.display = '';
    el.style.setProperty('--t', t.toFixed(3));
  };
  const plate = (name: string, facts: string[]) => g5('card4', `<div class="c4-name">${name}</div><div class="c4-rows">${facts.map((f) => `<span>${f}</span>`).join('')}</div>`);
  const m = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)} m`;
  const hatchet = ITEMS.hatchet.melee!.damage;
  const PLATE = {
    cop: plate('THE INFECTED', [`${I.max} of them on the map`, 'three bodies', `${I.hp} health each`]),
    memory: plate('THEY REMEMBER', [`${I.forget} seconds after they lose you`, `${I.search} more, searching`, 'then they walk home']),
    hunt: plate('THEY HUNT', ['through doors, up stairs', 'they beat on a shut door', `${I.patience} seconds, then give up`]),
    sneak: plate('GET PAST THEM', ['crouch', 'keep behind them', 'do not run']),
    noise: plate('NOISE BRINGS THEM', [`a gunshot carries ${m(I.hearShot)}`, 'they turn, they see you', 'and they all come']),
    quiet: plate('9 MM SUPPRESSOR', [`heard at ${m(I.hearQuiet)}, not ${m(I.hearShot)}`, 'one round to the head', 'the rest never turn round']),
    chase: plate('THEY COME', [`${I.chase} metres a second`, 'you jog at 4, sprint at 6.2', 'keep moving']),
    fight: plate('STOP THE BLOW', ['guard: right mouse button', `it is stopped for ${I.stopBlocked} s`, `a hatchet: ${Math.ceil(I.hp / hatchet)} blows`]),
    team: plate('TWO GUNS', ['back to back', 'one watches each way', 'nothing gets behind you']),
    bait: plate('OR USE THEM', ['they go for whoever they see', 'let it be somebody else']),
    zone: plate('THE GAS ZONE', ['one place on the map', 'nobody breathes there', 'without a mask']),
    mask: plate('GAS MASK', ['found in the police station', 'your way into the gas']),
    guns: plate('ONLY IN THE GAS', ['the first shotgun', 'automatic weapons', 'nowhere else on the map']),
  };
  /** over everything that is not in the game yet */
  const next = g5('next5', '<span>COMING NEXT</span>');
  const card = g5('t4 t5', `
    <div class="t4-kick">ZONA &nbsp;·&nbsp; THE NEW UPDATE</div>
    <div class="t4-logo">THE INFECTED</div>
    <div class="t4-line">THEY NEVER LEFT</div>
    <div class="t4-tags"><span>THEY SEE</span><span>THEY HEAR</span><span>THEY HUNT</span></div>`);

  // the board: how far they see and hear, drawn to scale from above (one of them at the middle, looking to the right)
  const board = (() => {
    const K = 6.3, cx = 170, cy = 225;
    const wedge = (metres: number) => {
      const r = metres * K, a = I.view;
      return `M${cx} ${cy} L${(cx + r * Math.cos(a)).toFixed(1)} ${(cy - r * Math.sin(a)).toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)} Z`;
    };
    const ring = (metres: number, at: number, cls: string, label: string, up: number) =>
      `<g class="in" data-at="${at}"><circle class="${cls}" cx="${cx}" cy="${cy}" r="${(metres * K).toFixed(1)}"/><text x="${cx - 6}" y="${(cy + up * (metres * K + 13)).toFixed(1)}" text-anchor="end">${label}</text></g>`;
    const rows: [string, string, number][] = [
      [m(I.sight), 'they see, in front of them', 0.35],
      [m(I.sightCrouched), 'if you crouch', 0.85],
      [m(I.hearJog), 'they hear a jog', 1.35],
      [m(I.hearSprint), 'they hear a sprint', 1.65],
      [m(I.hearQuiet), 'a shot through a 9 mm suppressor', 2.15],
      [m(I.hearShot), 'any other shot', 2.7],
    ];
    return g5('b5', `
      <div class="b5-head">HOW THEY FIND YOU</div>
      <svg viewBox="0 0 430 450" preserveAspectRatio="xMinYMid meet">
        <path class="in see" data-at="0.35" d="${wedge(I.sight)}"/>
        <path class="in see near" data-at="0.85" d="${wedge(I.sightCrouched)}"/>
        ${ring(I.hearJog, 1.35, 'hear', 'JOG', -1)}
        ${ring(I.hearSprint, 1.65, 'hear', 'SPRINT', -1)}
        ${ring(I.hearQuiet, 2.15, 'hear quiet', 'SUPPRESSED', 1)}
        <g class="in" data-at="0.35"><text x="${(cx + I.sight * K - 8).toFixed(1)}" y="${cy - 8}" text-anchor="end">SIGHT ${I.sight} M</text></g>
        <g class="in" data-at="0.85"><text x="${(cx + I.sightCrouched * K - 8).toFixed(1)}" y="${cy + 26}" text-anchor="end">CROUCHED</text></g>
        <g class="in" data-at="2.7"><text class="far" x="215" y="446" text-anchor="middle">ANY OTHER SHOT: ${I.hearShot} M &#183; FAR OFF THIS CHART</text></g>
        <circle class="it" cx="${cx}" cy="${cy}" r="7"/>
        <path class="it" d="M${cx + 9} ${cy - 6} L${cx + 21} ${cy} L${cx + 9} ${cy + 6} Z"/>
      </svg>
      <div class="b5-rows">${rows.map(([n, what, at]) => `<div class="b5-row in" data-at="${at}"><b>${n}</b><span>${what}</span></div>`).join('')}</div>`);
  })();
  const boardAt = (t: number) => {
    show(board, t);
    board.querySelectorAll<HTMLElement | SVGElement>('[data-at]').forEach((el) => el.style.setProperty('--o', String(ease((t - Number(el.dataset.at)) / 0.3))));
  };

  // ------------------------------------------------------------ the set
  const shots: Shot[] = [];
  let cur = 0;
  const marks: Record<string, number> = {};
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
        for (const el of Object.values(PLATE)) el.style.display = 'none';
        card.style.display = board.style.display = next.style.display = 'none';
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
  // the gas: the world's own fog and sky, thick and green, for the shots that are in it
  const scene = g.s.r.scene as THREE.Scene;
  const fog = scene.fog as THREE.FogExp2;
  const air = { color: fog.color.clone(), density: fog.density, sky: scene.background, env: scene.environmentIntensity };
  const GAS = new THREE.Color(0.17, 0.21, 0.055);
  // (the light of the day comes down through it, and less of it arrives)
  const lights: [THREE.Light, number][] = [];
  scene.traverse((o) => { if ((o as THREE.Light).isLight) lights.push([o as THREE.Light, (o as THREE.Light).intensity]); });
  let gassed = false;
  const gas = (on: boolean, thick = 0.021) => {
    gassed = on;
    fog.color.copy(on ? GAS : air.color);
    fog.density = on ? thick : air.density;
    // (no sky to be seen from inside it: what is far off goes into the same green the air is)
    scene.background = on ? GAS : air.sky;
    scene.environmentIntensity = on ? air.env * 0.55 : air.env;
    for (const [l, was] of lights) l.intensity = on ? was * 0.6 : was;
  };
  /** the gas itself, lying on the ground and drifting: the game's own smoke, in its colour, about a place */
  let owed = 0;
  const drift = (at: THREE.Vector3, n: number, reach = 22) => {
    // (so many a second, whatever the film's frames are)
    owed += n;
    for (; owed >= 1; owed--) {
      const a = S.rnd() * Math.PI * 2, r = Math.sqrt(S.rnd()) * reach, tint = 0.75 + S.rnd() * 0.5;
      const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      // each starts as nothing and swells (nothing is seen to arrive), and thins away at the end of its time
      g.effects.spawn({
        p: new THREE.Vector3(x, S.ground(x, z) + 0.15 + S.rnd() * 0.7, z),
        v: new THREE.Vector3(0.3 + (S.rnd() - 0.5) * 0.3, 0.04, 0.12 + (S.rnd() - 0.5) * 0.3),
        max: 7 + S.rnd() * 4,
        size: 0.3,
        grow: 3.5 + S.rnd() * 3.5,
        color: new THREE.Color(0.5 * tint, 0.58 * tint, 0.19 * tint),
        alpha: 0.3,
        gravity: -0.012,
        drag: 0.15,
      });
    }
  };
  /** what the film has laid about, taken away again */
  const laid: string[] = [];
  const lay = (id: string, at: THREE.Vector3, rot = 0.4) => {
    const l = g.economy.drop(makeItem(id), at.x, at.y, at.z, rot);
    laid.push(l.uid);
    return l as { uid: string; x: number; y: number; z: number };
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
  const lookAt = (at: THREE.Vector3, k = 0.2) => {
    const p = g.player, cam = g.s.r.camera.position;
    p.yaw += wrap(Math.atan2(-(at.x - cam.x), -(at.z - cam.z)) - p.yaw) * k;
    p.pitch += (Math.atan2(at.y - cam.y, Math.hypot(at.x - cam.x, at.z - cam.z)) - p.pitch) * k;
  };

  // ------------------------------------------------------------ the infected of the film
  const horde = g.horde as any;
  const zeds: Zed[] = [];
  /** how hard a blow lands on each of the people (the film's to say: see the top of the file) */
  const bite = new Map<Actor, number>();
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
    // (which body each is goes by its number: 0 the man, 1 the woman, 2 the policeman)
    for (let n = 0; n < 12; n++) {
      const i = 3000 + n;
      const info = { i, s: [0, -300, 0, 0, 0, 0], hp: I.hp, own: me, h: [0, 0] };
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
      if (a.alive) a.hurt(bite.get(a) ?? I.damage, a.pos.clone().sub(z.pos).setY(0).normalize());
    };
  };
  /** the nth of a kind that is still standing (0 the man, 1 the woman, 2 the policeman) */
  const kind = (k: 0 | 1 | 2, nth = 0) => zeds.filter((z) => z.i % 3 === k && !z.dead)[nth];
  /** stand one somewhere, as it would be found: with its senses, or blind and deaf (it stands and sways) */
  const putZ = (z: Zed, x: number, zz: number, yaw: number, senses: boolean) => {
    const y = S.ground(x, zz);
    z.pos.set(x, y, zz);
    z.fallTo = y;
    z.home.set(x, y, zz);
    const body = horde.director.bodies.get(z.i);
    body.s[0] = x;
    body.s[1] = y;
    body.s[2] = zz;
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
  const park = () => zeds.forEach((z, n) => !z.dead && putZ(z, -300 + n * 3, -300, 0, false));
  /** one of the people's rounds finds its head */
  const drop = (z: Zed, from: THREE.Vector3) => {
    if (z.dead) return;
    const head = new THREE.Vector3(z.pos.x, z.pos.y + 1.55, z.pos.z);
    const d = head.clone().sub(from).normalize();
    g.effects.bleed(head, d, 1);
    z.avatar.wound(head, d, 0.07, true);
    horde.director.hurt(z.i, 999, performance.now());
    const along = -Math.sin(z.yaw) * d.x - Math.cos(z.yaw) * d.z;
    z.die(along > 0.4 ? 1 : along < -0.4 ? 0 : 2);
  };
  const reset = () => {
    for (const a of S.actors) {
      delete (a as any).hurt;
      a.rp.avatar.clearWounds();
      a.hide();
    }
    bite.clear();
    gas(false);
    for (const uid of laid.splice(0)) g.economy.take(uid);
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Mouse0', 'Mouse2']) S.key(k, false);
    park();
    S.parkMe();
    S.clean();
    hush();
  };
  const chest = (z: Zed) => new THREE.Vector3(z.pos.x, z.pos.y + 1.2, z.pos.z);
  const face = (z: Zed) => new THREE.Vector3(z.pos.x, z.pos.y + 1.5, z.pos.z);

  // ============================================================ 1. the card
  const st0 = road(0);
  const trio = () => [kind(2), kind(0), kind(1)];
  const standTrio = () => {
    const [cop, man, woman] = trio();
    const y = yawOf(st0.t.clone().negate());
    // (they face back up the street, at the lens)
    putZ(cop, st0.at.x, st0.at.z, y + 0.12, false);
    putZ(man, st0.at.x + st0.n.x * 2.3 + st0.t.x * 0.8, st0.at.z + st0.n.z * 2.3 + st0.t.z * 0.8, y - 0.2, false);
    putZ(woman, st0.at.x - st0.n.x * 2.2 + st0.t.x * 1.3, st0.at.z - st0.n.z * 2.2 + st0.t.z * 1.3, y + 0.3, false);
  };
  const street = (t: number, from: number, to: number, len: number): CamPose => {
    const k = t / len;
    const p = st0.at.clone().addScaledVector(st0.t, -lerp(from, to, k)).setY(st0.at.y + 1.25);
    return hand({ p, l: st0.at.clone().setY(st0.at.y + 1.2), fov: 34 }, t, 0.6);
  };
  add(1.5, {
    name: 'card',
    g: 'dim5',
    bars: false,
    setup: async () => {
      await troupe();
      reset();
      standTrio();
      await preroll(90);
    },
    cam: (t) => street(t, 7.2, 6.3, b(1.5)),
    // (on the picture from the first frame of it: it is what is seen before anybody presses play)
    after: (t) => show(card, t),
  });

  // ============================================================ 2. the three bodies
  const portrait = (name: string, who: () => Zed, pl: HTMLElement, sweep: number, seed: number) =>
    add(1, {
      name,
      g: 'cold',
      chain: true,
      flash: 0.55,
      plates: [[pl, 0.12, b(1) - 0.08]],
      cam: (t) => {
        const z = who(), k = t / b(1);
        const front = z.yaw + Math.PI;
        const az = front + lerp(-sweep, sweep, ease(k)) * 0.5 + 0.35;
        const at = face(z);
        // from a little under its eyes, and coming closer: the face is hung forward
        const p = at.clone().add(new THREE.Vector3(Math.sin(az) * lerp(1.8, 1.6, k), -0.16, Math.cos(az) * lerp(1.8, 1.6, k)));
        // (the lens looks past it to the right of the picture: the plate has the left)
        const l = at.clone().add(new THREE.Vector3(Math.cos(az) * -0.3, -0.1, Math.sin(az) * 0.3));
        return hand({ p, l, fov: 36 }, t, 0.5, seed);
      },
    });
  portrait('body-cop', () => trio()[0], PLATE.cop, 0.5, 1);
  portrait('body-man', () => trio()[1], PLATE.memory, -0.5, 2);
  portrait('body-woman', () => trio()[2], PLATE.hunt, 0.5, 3);

  // ============================================================ 3. the board: how they find you
  add(2.5, {
    name: 'senses',
    g: 'dim5',
    chain: true,
    bars: false,
    flash: 0.4,
    cam: (t) => street(t, 6.6, 5.6, b(2.5)),
    after: (t) => boardAt(t),
  });

  // ============================================================ 4. past one of them, behind its back
  {
    const s = road(26);
    let zed: Zed;
    add(1.5, {
      name: 'sneak',
      g: 'cold',
      flash: 0.4,
      plates: [[PLATE.sneak, 0.2, b(1.5) - 0.1]],
      setup: async () => {
        reset();
        zed = kind(0);
        // it looks down the street; she crosses the street behind it
        putZ(zed, s.at.x, s.at.z, yawOf(s.t), true);
        const mira = A(1);
        const from = s.at.clone().addScaledVector(s.t, -6.5).addScaledVector(s.n, -4.6);
        mira.place(from.x, from.z, yawOf(s.n), 'm9', ['boonie_hat']);
        mira.crouch = true;
        await preroll(40);
      },
      tick: (_t, _S, dt) => {
        const mira = A(1);
        const to = s.at.clone().addScaledVector(s.t, -6.5).addScaledVector(s.n, 5.5);
        mira.crouch = true;
        mira.go(to.x, to.z, 1.7, dt);
      },
      cam: (t) => {
        // from in front of it and to one side: its face near, her going by small behind it
        const p = s.at.clone().addScaledVector(s.t, 2.3).addScaledVector(s.n, 1.5).setY(s.at.y + 1.5);
        const l = s.at.clone().addScaledVector(s.t, -3).addScaledVector(s.n, -0.6).setY(s.at.y + 1.15);
        return hand({ p, l, fov: 40 }, t, 0.7, 4);
      },
      after: () => {
        // (said aloud if the rules ever stop making this true: it is the game's own senses that leave her alone)
        if (zed.mode >= 2 && !(zed as any)._told) {
          (zed as any)._told = true;
          console.log('[tr] cut 5: the infected in "sneak" noticed her');
        }
      },
    });
  }

  // ============================================================ 5. a shot, and they come to it
  {
    const s = road(-34);
    const away = s.t.clone().negate();
    let three: Zed[] = [];
    add(1.5, {
      name: 'shot',
      g: 'war',
      flash: 0.5,
      plates: [[PLATE.noise, 0.25, b(1.5) - 0.1]],
      setup: async () => {
        reset();
        three = trio();
        // down the street from him with their backs to him: nothing of his has reached them yet
        three.forEach((z, n) => {
          const d = 15.5 + n * 3.2, side = (n - 1) * 2.0;
          putZ(z, s.at.x + away.x * d + s.n.x * side, s.at.z + away.z * d + s.n.z * side, yawOf(away) + (n - 1) * 0.5, true);
        });
        const v = A(0);
        v.place(s.at.x + s.n.x * 0.5, s.at.z + s.n.z * 0.5, yawOf(away), 'm9', ['sack_pack']);
        v.aim = true;
        v.pitch = 0.1;
        await preroll(30);
      },
      tick: (t) => {
        const v = A(0);
        v.aim = true;
        // the pistol up over their heads for the shot, then down on them as they come
        if (t < 0.9) v.pitch = lerp(0.1, 0.55, ease(t / 0.4));
        else v.face(chest(three[0]));
      },
      cues: [
        {
          at: 0.5,
          fn: () => {
            const v = A(0);
            v.fireAt(v.eye().addScaledVector(away, 30).add(new THREE.Vector3(0, 17, 0)));
            // (what a shot does in the game: everything of theirs within its carry goes to see)
            horde.noise(v.pos.x, v.pos.z, I.hearShot);
          },
        },
      ],
      // over his shoulder, down the street at them
      cam: (t) => {
        const v = A(0);
        const p = v.pos.clone().addScaledVector(s.t, 1.7).addScaledVector(s.n, 0.6).setY(v.pos.y + 1.74);
        const l = s.at.clone().addScaledVector(away, 12).setY(s.at.y + 1.2);
        return hand({ p, l, fov: lerp(38, 34, ease(t / b(1.5))) }, t, 1, 5);
      },
    });
  }

  // ============================================================ 6. the same with a suppressor: one of them, and nothing else stirs
  {
    const s = road(78);
    let mark: Zed, others: Zed[] = [];
    let fired = false;
    add(2, {
      name: 'quiet',
      hud: true,
      g: 'cold',
      flash: 0.5,
      plates: [[PLATE.quiet, 0.3, b(2) - 0.1]],
      setup: async () => {
        reset();
        fired = false;
        mark = kind(1, 1);
        others = [kind(2, 1), kind(0, 2)];
        S.kit(['m9', ['ammo_9mm', 30]], { m9: ['suppressor_9'] });
        S.hold('holster');
        S.me(s.at.x, s.at.z, yawOf(s.t), -0.02);
        // one with its back to the player, close; two more well beyond what a suppressed shot carries
        putZ(mark, s.at.x + s.t.x * 7.5 + s.n.x * 0.4, s.at.z + s.t.z * 7.5 + s.n.z * 0.4, yawOf(s.t) + 0.25, true);
        others.forEach((z, n) => {
          const d = I.hearQuiet + 3.5 + n * 3.5, side = n ? 2.2 : -1.8;
          putZ(z, s.at.x + s.t.x * d + s.n.x * side, s.at.z + s.t.z * d + s.n.z * side, yawOf(s.t) + (n ? -0.5 : 0.4), true);
        });
        await preroll(20);
      },
      tick: (t) => {
        // (the pistol is seen first, and what is on the end of it; then it comes up)
        S.key('Mouse2', t > 0.5 && t < 3.3);
        if (!mark.dead) lookAt(face(mark).setY(mark.pos.y + 1.58), t < 1.1 ? 0.14 : 0.5);
        // (and after it is down, the eyes go on to the two beyond, who have not moved)
        else lookAt(chest(others[0]).lerp(chest(others[1]), 0.5), 0.045);
        if (!fired && t > 1.35 && !g.weapons.action) {
          fired = true;
          S.aimAt(face(mark).setY(mark.pos.y + 1.58));
          S.tap('Mouse0', 50);
        }
      },
      cues: [
        // (if the round went past its ear the film does not wait for another)
        { at: 1.72, fn: () => drop(mark, g.s.r.camera.position.clone()) },
      ],
      after: () => {
        for (const z of others) {
          if (z.mode >= 2 && !(z as any)._told) {
            (z as any)._told = true;
            console.log('[tr] cut 5: one beyond the suppressed shot heard it');
          }
        }
      },
    });
  }

  // ============================================================ 7. the chase
  {
    const s0 = 52;
    let pack: Zed[] = [];
    let run = 0;
    add(1.5, {
      name: 'chase',
      g: 'war',
      flash: 0.6,
      plates: [[PLATE.chase, 0.2, b(1.5) - 0.1]],
      setup: async () => {
        reset();
        pack = trio();
        run = 0;
        const k = A(2);
        const at = road(s0);
        k.place(at.at.x, at.at.z, yawOf(at.t), null, ['sack_pack']);
        pack.forEach((z, n) => {
          const p = road(s0 - 2.6 - n * 1.3);
          putZ(z, p.at.x + p.n.x * (n - 1) * 1.25, p.at.z + p.n.z * (n - 1) * 1.25, yawOf(p.t), true);
        });
        // (they are already after him and up to speed when the picture starts)
        await preroll(85, undefined, () => {
          run += 3.5 / 60;
          const p = road(s0 + run);
          k.go(p.at.x, p.at.z, 3.5, 1 / 60);
        });
      },
      tick: (_t, _S, dt) => {
        const k = A(2);
        run += 3.8 * dt;
        const p = road(s0 + run);
        k.go(p.at.x, p.at.z, 3.8, dt);
      },
      cam: (t) => {
        // beside the road, going with him, looking back along it at what is behind him
        const k = A(2);
        const p0 = road(s0 + run + 2.0);
        const p = p0.at.clone().addScaledVector(p0.n, 3.0).setY(p0.at.y + 1.15);
        const l = k.pos.clone().addScaledVector(p0.t, -2.2).setY(k.pos.y + 1.15);
        return hand({ p, l, fov: 44 }, t, 1.3, 6);
      },
    });
  }

  // ============================================================ 8. one of them, with a hatchet, through the player's eyes
  {
    const s = road(-12);
    let zed: Zed;
    let blocked = false, openAt = -9, hp = 0, mine = 0;
    let jolt: (() => void) | null = null;
    add(3, {
      name: 'fight',
      hud: true,
      g: 'warm',
      flash: 0.6,
      plates: [[PLATE.fight, 0.3, b(3) - 0.1]],
      setup: async () => {
        reset();
        blocked = false;
        openAt = -9;
        hp = I.hp;
        mine = 100;
        zed = kind(0, 1);
        S.me(s.at.x, s.at.z, yawOf(s.t));
        S.kit(['hatchet']);
        S.hold('melee', false);
        putZ(zed, s.at.x + s.t.x * 3.5, s.at.z + s.t.z * 3.5, yawOf(s.t.clone().negate()), true);
        if (!jolt) {
          jolt = g.weapons.jolt.bind(g.weapons);
          g.weapons.jolt = () => {
            blocked = true;
            jolt!();
          };
        }
        await preroll(20);
      },
      tick: (t) => {
        // the eyes on it; the guard up until its blow has landed on it; then the hatchet while it is stopped; then the guard again
        lookAt(zed.dead ? chest(zed).setY(zed.pos.y + 0.4) : chest(zed), zed.dead ? 0.08 : 0.45);
        if (zed.dead) {
          S.key('Mouse2', false);
          S.key('KeyW', false);
          return;
        }
        if (blocked) {
          blocked = false;
          openAt = t;
        }
        const open = t - openAt < 1.25;
        const far = Math.hypot(zed.pos.x - g.player.pos.x, zed.pos.z - g.player.pos.z);
        S.key('Mouse2', !open);
        S.key('KeyW', open && far > 1.45);
        const w = g.weapons;
        if (open && !w.action && w.fireCooldown <= 0 && far < 1.8) S.tap('Mouse0', 60);
      },
      after: (t) => {
        // (said aloud, so a draft shows what the fight was: each blow of the hatchet, and any of its that got through)
        const now = horde.director.bodies.get(zed.i)?.hp ?? 0, me = g.player.vitals.health;
        if (now !== hp) console.log(`[tr] cut 5 fight ${t.toFixed(2)} s: the infected ${hp} -> ${now}`);
        if (me < mine - 0.5) console.log(`[tr] cut 5 fight ${t.toFixed(2)} s: the player ${mine.toFixed(0)} -> ${me.toFixed(0)}`);
        hp = now;
        mine = me;
      },
    });
  }

  // ============================================================ 9. two of them, back to back
  {
    let ring: Zed[] = [];
    // Where the lens is from the two of them, and where each of the four comes from, counted round
    // from the lens: one in from either side, across the front of the picture, and one from beyond
    // each of them. They are started so far off that they come to hand one after another.
    const az0 = 0.9, FROM = [1.6, -2.6, 2.6, -1.6], START = [9.3, 10.7, 12.4, 14.0], NEAR = 3.5;
    const about = (a: number, r: number, up = 0) => P(field.x + Math.sin(az0 + a) * r, field.z + Math.cos(az0 + a) * r, up);
    const far = (z: Zed) => Math.hypot(z.pos.x - field.x, z.pos.z - field.z);
    // (hers are the two on one hand, his the two on the other)
    const whose = (z: Zed) => A(FROM[ring.indexOf(z)] > 0 ? 1 : 0);
    const nearest = (of: Zed[]) => of.filter((z) => !z.dead).sort((x, y) => far(x) - far(y))[0];
    const aim = () => {
      for (const who of [A(1), A(0)]) {
        const z = nearest(ring.filter((x) => whose(x) === who));
        if (z) who.face(face(z));
      }
    };
    let last = -9;
    add(1.5, {
      name: 'team',
      g: 'war',
      flash: 0.6,
      plates: [[PLATE.team, 0.2, b(1.5) - 0.1]],
      setup: async () => {
        reset();
        last = -9;
        ring = zeds.filter((z) => !z.dead).slice(-4);
        const mira = A(1), volkov = A(0);
        const hers = about(Math.PI / 2, 0.36), his = about(-Math.PI / 2, 0.36);
        mira.place(hers.x, hers.z, 0, 'm9', ['boonie_hat']);
        volkov.place(his.x, his.z, 0, 'm9', ['sack_pack']);
        mira.aim = volkov.aim = true;
        // (each looks at the two of them, and has seen them: they are at a run when the picture starts)
        ring.forEach((z, n) => {
          const at = about(FROM[n], START[n]);
          putZ(z, at.x, at.z, az0 + FROM[n], true);
        });
        await preroll(90, undefined, aim);
      },
      tick: (t) => {
        aim();
        // whichever is nearest goes down when it is near enough, and no two in one breath
        const z = nearest(ring);
        if (!z || t - last < 0.36 || (far(z) > NEAR && t < b(1.5) - 0.9)) return;
        last = t;
        const who = whose(z);
        who.face(face(z));
        who.fireAt(face(z));
        console.log(`[tr] cut 5 team ${t.toFixed(2)} s: one down at ${far(z).toFixed(1)} m`);
        drop(z, who.eye());
      },
      // at the height of their heads and well back, on a long lens: the two of them, and what comes at each
      cam: (t) => {
        const e = ease(t / b(1.5));
        return hand({ p: about((t - 1.4) * 0.07, lerp(10, 9.3, e), 1.6), l: P(field.x, field.z, 1.15), fov: 34 }, t, 1.1, 7);
      },
    });
  }

  // ============================================================ 10. set on somebody else
  {
    let pack: Zed[] = [];
    add(2, {
      name: 'bait',
      g: 'dust',
      flash: 0.6,
      plates: [[PLATE.bait, 0.25, b(2) - 0.1]],
      setup: async () => {
        reset();
        pack = trio();
        const bear = A(5);
        // he is watching the other way, down his rifle; they are behind him, and they have seen him
        bear.place(field2.x, field2.z, 0, 'mosin', ['life_vest']);
        bear.aim = true;
        bear.crouch = true;
        bite.set(bear, 60);
        pack.forEach((z, n) => putZ(z, field2.x + (n - 1) * 1.6, field2.z + 8.6 + n * 1.3, 0, true));
        await preroll(70);
      },
      cam: (t) => {
        const bear = A(5);
        const k = ease(t / b(2));
        // low beside him, looking past him at what is coming up behind
        const p = P(field2.x + lerp(2.6, 2.0, k), field2.z - lerp(2.4, 1.6, k), lerp(0.75, 0.95, k));
        const l = bear.pos.clone().add(new THREE.Vector3(-0.3, 0.95, 2.2));
        return hand({ p, l, fov: 44 }, t, 1.2, 8);
      },
    });
  }

  // ============================================================ 11. what comes next: the gas, the mask, the guns
  {
    const camp = (world.pois as { name: string; x: number; z: number }[]).find((p) => p.name === 'Military Checkpoint') ?? world.pois[1];
    const police = builds.filter((x) => x.type === 'police').sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0];
    if (!camp || !police) throw new Error('no checkpoint or no police station on this map');
    const inside = (lx: number, lz: number, up = 0) => {
      const co = Math.cos(police.rot), si = Math.sin(police.rot);
      return new THREE.Vector3(police.x + lx * co + lz * si, police.floorY + up, police.z - lx * si + lz * co);
    };
    // the way in to the camp: from the village side
    const toCamp = new THREE.Vector3(camp.x - c.x, 0, camp.z - c.z).normalize();
    const edge = (back: number, side = 0, up = 0) => P(camp.x - toCamp.x * back + toCamp.z * side, camp.z - toCamp.z * back - toCamp.x * side, up);
    const lamp = new THREE.PointLight(0xfff0d0, 0, 9, 1.5);
    scene.add(lamp);
    const handLamp = new THREE.DirectionalLight(0xfff0d0, 0);
    g.weapons.vmScene.add(handLamp);
    let walked = 0;

    add(1.5, {
      name: 'next-zone',
      g: 'gas',
      flash: 0.7,
      plates: [[PLATE.zone, 0.3, b(1.5) - 0.1]],
      setup: async () => {
        reset();
        gas(true);
        walked = 0;
        const k = A(2);
        const from = edge(37, 0.9);
        k.place(from.x, from.z, yawOf(toCamp), 'mosin', ['life_vest', 'sack_pack', 'boonie_hat']);
        // (the air has been standing here a long time: it is full of it before anybody looks)
        await preroll(240, undefined, () => drift(edge(21), 1.6, 24));
      },
      // he has stopped where it begins, and goes no farther
      tick: (_t, _S, dt) => {
        void walked;
        drift(edge(21), 96 * dt, 24);
      },
      // past his shoulder, and on by him: the camp ahead, sunk in it
      cam: (t) => {
        const k = A(2), e = ease(t / b(1.5));
        const p = k.pos.clone().addScaledVector(toCamp, lerp(-3.6, -2.5, e)).add(new THREE.Vector3(toCamp.z * 1.0, 1.7, -toCamp.x * 1.0));
        const l = k.pos.clone().addScaledVector(toCamp, 12).setY(k.pos.y + 1.6);
        return hand({ p, l, fov: lerp(42, 38, e) }, t, 1, 11);
      },
      after: (t) => show(next, t),
    });

    let item: { x: number; y: number; z: number } | null = null;
    add(1.5, {
      name: 'next-mask',
      hud: true,
      g: 'cold',
      flash: 0.5,
      plates: [[PLATE.mask, 0.3, b(1.5) - 0.1]],
      setup: async () => {
        reset();
        S.kit([]);
        S.hold(null);
        // on the duty desk in the lobby of the police station, with nothing else on it to take first
        const desk = inside(-0.2, -1.0);
        for (const l of [...g.economy.loot.values()] as any[]) if (Math.hypot(l.x - desk.x, l.z - desk.z) < 2.4) g.economy.take(l.uid);
        item = lay('gasmask', inside(-0.15, -0.78, 0.8), 2.2);
        const at = inside(0.25, 0.75);
        S.me(at.x, at.z, Math.atan2(-(desk.x - at.x), -(desk.z - at.z)), -0.5, police.floorY);
        lamp.position.copy(inside(0.5, 0.3, 2.3));
        lamp.intensity = 8;
        handLamp.intensity = 3;
        handLamp.position.copy(lamp.position).sub(inside(0.25, 0.75, 1.6)).normalize().multiplyScalar(10);
        await preroll(14);
      },
      tick: (t) => {
        if (item && t < 2.5) lookAt(new THREE.Vector3(item.x, item.y + 0.05, item.z), 0.14);
        // (up to the desk as the hand goes out for it)
        S.key('KeyW', t > 0.25 && t < 0.75);
      },
      cues: [
        { at: 2.2, fn: () => S.tap('KeyF') },
        { at: b(1.5) - 0.02, fn: () => { lamp.intensity = 0; handLamp.intensity = 0; } },
      ],
      after: (t) => show(next, t),
    });

    add(1.5, {
      name: 'next-guns',
      g: 'gas',
      flash: 0.6,
      plates: [[PLATE.guns, 0.3, b(1.5) - 0.1]],
      setup: async () => {
        reset();
        gas(true, 0.024);
        lamp.intensity = 0;
        handLamp.intensity = 0;
        // a case in the middle of it, shut, and what goes in such guns beside it
        const at = edge(3, 0);
        lay('stash_kit', at.clone().setY(at.y + 0.02), 0.5);
        lay('box_762', edge(2.45, 0.8, 0.02), 1.1);
        lay('box_9mm', edge(3.6, -0.75, 0.02), 2.3);
        await preroll(240, undefined, () => drift(edge(8), 1.4, 14));
      },
      tick: (_t, _S, dt) => drift(edge(8), 84 * dt, 14),
      // low, coming up on the case through it
      cam: (t) => {
        const k = ease(t / b(1.5));
        const p = edge(lerp(0.95, 1.5, k), lerp(-0.85, -0.68, k), lerp(0.5, 0.56, k));
        return hand({ p, l: edge(3.0, 0.1, 0.2), fov: 38 }, t, 0.8, 12);
      },
      after: (t) => show(next, t),
    });

    // ============================================================ 12. the end
    add(1.5, {
      name: 'end',
      g: 'dim',
      chain: true,
      bars: false,
      fadeOut: 0.55,
      tick: (_t, _S, dt) => drift(edge(8), 84 * dt, 14),
      cam: (t) => {
        const p = edge(1.5 + t * 0.05, -0.68, 0.56 + t * 0.03);
        return hand({ p, l: edge(3.0, 0.1, 0.2), fov: 38 }, t, 0.7, 13);
      },
      titles: [{ at: 0.05, until: b(1.5) + 1, text: '<div class="end-logo">ZONA</div><div class="end-line">THE INFECTED UPDATE IS LIVE</div><div class="end-url">WWW.ZONAPVP.FUN</div>', cls: 'end' }],
    });
    void gassed;
  }

  shots.sort((x, y) => x.start - y.start);

  // ------------------------------------------------------------ the score, laid under the cut
  {
    const Am = 33, F = 41, C = 36, G = 43, E = 40;
    const PLAYED: [string, Level][] = [
      ['card', 'low'], ['body-cop', 'pulse'], ['senses', 'tick'], ['sneak', 'tense'], ['shot', 'build'], ['quiet', 'tense'], ['chase', 'drive'],
      ['fight', 'full'], ['team', 'top'], ['bait', 'tense'], ['next-zone', 'low'], ['next-mask', 'tick'], ['next-guns', 'build'], ['end', 'end'],
    ];
    const ROUND = [Am, F, C, G];
    let since = 0, was: Level | null = null;
    for (let i = 0; i < BARS5; i++) {
      let level: Level = 'low';
      for (const [name, lv] of PLAYED) if (marks[name] !== undefined && marks[name] <= i + 0.01) level = lv;
      since = level === was ? since + 1 : 0;
      was = level;
      const root = level === 'end' ? Am : level === 'build' ? E : ROUND[since % 4];
      ARRANGEMENT.rows.push([root, root === Am || root === E, level]);
    }
    const at = (name: string, plus = 0) => marks[name] * BAR + plus;
    ARRANGEMENT.hits.push(
      [at('body-cop'), 0.8], [at('body-man'), 0.5], [at('body-woman'), 0.5], [at('senses'), 0.6], [at('sneak'), 0.5], [at('shot', 0.5), 1], [at('quiet'), 0.5],
      [at('chase'), 1.1], [at('fight'), 0.9], [at('team'), 1], [at('bait'), 0.8], [at('next-zone'), 1.1], [at('next-mask'), 0.5], [at('next-guns'), 0.8], [at('end'), 1.2],
    );
    ARRANGEMENT.risers.push([at('quiet', b(1)), at('chase'), 0.8], [at('bait', b(0.6)), at('next-zone'), 0.8], [at('next-guns'), at('end'), 1]);
    ARRANGEMENT.hits.sort((x, y) => x[0] - y[0]);
    console.log(`[tr] cut 5: ${shots.length} shots, ${cur} bars, ${(cur * BAR).toFixed(2)} s`);
  }
  return shots;
}
