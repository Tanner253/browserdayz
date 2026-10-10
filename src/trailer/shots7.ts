// The seventh film: a teaser of fifteen seconds (8 bars at 128 BPM) for what the Zone has gained.
// Made the way the others were: the real game on a clock that only moves when the film says.
//
// What it shows, in order: a card on the first frame, over the new town from the air; Kamenka
// and its street; the road over the hill with a jeep on it; the trader at his counter; the five
// body armours on five people, with what each takes off a hit; a helicopter down in a meadow;
// and where it is played. Every figure on a plate is read off the rules and the map as the film
// is made (the buildings counted, the climb measured, the armours' figures, the crash's times).

import * as THREE from 'three';
import type { CamPose, Shot, Stage } from './director';
import type { Arrangement, Level } from './music';
import { BAR } from './shots';
import { ITEMS } from '../sim/items';
import { CRASH, pickDropSite } from '../sim/drops';
import { TOWN, WORLD_SIZE, PASS, kamenkaQ } from '../world/worldgen';
import { SEAT_AT } from '../game/garage';
import { CONTRACT, DISCORD, X_HANDLE } from '../ui/hud';

const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const b = (bars: number) => bars * BAR;

export const ARRANGEMENT: Arrangement = { rows: [], hits: [], risers: [] };
export const BARS7 = 8;
export const SECONDS7 = BARS7 * BAR;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Extra = { g?: string | null; fadeIn?: number; fadeOut?: number; flash?: number; plates?: [HTMLElement, number, number][]; hour?: number };

/** the five armours, lightest first */
const ARMOUR = ['chest_rig', 'soft_vest', 'armor_vest', 'life_vest', 'heavy_armor'];

export function buildShots(S: Stage): Shot[] {
  const g = S.g as Any, world = S.world as Any;
  const P = (x: number, z: number, up = 0) => S.at(x, z, up);
  const clock = (window as Any).__clock;
  const wait = (ms: number) => new Promise<void>((r) => clock.real.setTimeout(r, ms));
  document.body.classList.add('tr-cut4', 'tr-cut5', 'tr-cut6', 'tr-cut7');
  const scene = g.s.r.scene as THREE.Scene;

  // ------------------------------------------------------------ places
  const T = TOWN, ul = Math.hypot(T.street[0], T.street[1]), ux = T.street[0] / ul, uz = T.street[1] / ul;
  /** a place in the town: so far down its street, so far to the right of it */
  const K = (along: number, right = 0, up = 0) => P(T.x + ux * along + uz * right, T.z + uz * along - ux * right, up);
  const builds = world.buildings as { id: string; type: string; x: number; z: number; rot: number; floorY: number }[];
  const inTown = builds.filter((q) => kamenkaQ(q.x, q.z) < 1.5);
  const kinds = (type: string) => inTown.filter((q) => q.type === type).length;
  const rp = world.road.points as Float32Array, RN = rp.length / 3;
  const R = (i: number) => new THREE.Vector3(rp[i * 3], rp[i * 3 + 1], rp[i * 3 + 2]);
  // the climb: from where the old road leaves the floor of its valley to its end
  let foot = 0;
  for (let i = 0; i < RN; i++) if (rp[i * 3] < PASS.from) foot = i;
  const climb = Math.round(S.ground(T.x, T.z) - rp[foot * 3 + 1]);
  let run = 0;
  for (let i = foot; i < RN - 1; i++) run += R(i).distanceTo(R(i + 1));
  const steep = Math.round(((rp[(RN - 1) * 3 + 1] - rp[foot * 3 + 1]) / run) * 100);
  const trader = (g.traders?.places?.[0] as THREE.Vector3 | undefined)?.clone();
  if (!trader) throw new Error('the map has no trader');
  const trunks = (world.trees as { kind: string; x: number; z: number }[]).filter((q) => !q.kind.startsWith('bush'));
  const nearAny = (list: { x: number; z: number }[], x: number, z: number, r: number) => list.some((o) => Math.hypot(o.x - x, o.z - z) < r);
  const flat = (x: number, z: number, r: number) => {
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k < 8; k++) {
      const h = S.ground(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return hi - lo;
  };
  // (a meadow: nothing built near, no tree close, level over the length of the wreck and more: the widest there is)
  let crashAt: { x: number; y: number; z: number } | null = null;
  const vc = world.pois[0] as { x: number; z: number };
  for (const [built, wooded] of [[60, 18], [48, 14], [40, 11]]) {
    for (let r = 70; r <= 360 && !crashAt; r += 10) {
      for (let a = 0; a < Math.PI * 2 && !crashAt; a += 0.11) {
        const x = vc.x + Math.cos(a) * r, z = vc.z + Math.sin(a) * r;
        if (nearAny(builds, x, z, built) || nearAny(trunks, x, z, wooded) || nearAny(world.props ?? [], x, z, 6) || nearAny(world.rocks ?? [], x, z, 7) || flat(x, z, 11) > 1.3) continue;
        crashAt = { x, y: S.ground(x, z), z };
      }
    }
    if (crashAt) {
      console.log(`[tr] cut 7: a meadow for the helicopter with nothing built within ${built} m and no tree within ${wooded}`);
      break;
    }
  }
  if (!crashAt) console.log('[tr] cut 7: no meadow found for the helicopter: it comes down where a supply drop would');
  crashAt ??= pickDropSite(world, () => S.rnd());
  if (!crashAt) throw new Error('nowhere for a helicopter to come down');
  console.log(`[tr] cut 7: Kamenka has ${inTown.length} buildings; the climb is ${climb} m at ${steep} in a hundred from road point ${foot} of ${RN}; the trader is at ${trader.x.toFixed(0)}, ${trader.z.toFixed(0)}; the helicopter comes down at ${crashAt.x.toFixed(0)}, ${crashAt.z.toFixed(0)}`);

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
  const g7 = (cls: string, html: string) => {
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
  const plate = (name: string, facts: string[]) => g7('card4', `<div class="c4-name">${name}</div><div class="c4-rows">${facts.map((f) => `<span>${f}</span>`).join('')}</div>`);
  const off = (id: string) => Math.round((1 - (ITEMS[id].wear?.armor ?? 1)) * 100);
  const PLATE = {
    town: plate('KAMENKA', [`${inTown.length} buildings on one street`, 'a valley of its own', `the map is ${WORLD_SIZE} m across`]),
    street: plate('EVERY DOOR OPENS', [`${kinds('townhouse')} brick houses of two floors`, `${kinds('shanty')} plank houses on piles`, `${kinds('hut')} long huts`]),
    pass: plate('THE ROAD OVER', [`${climb} m up from the old valley`, `a climb of ${steep} in a hundred`, 'a jeep takes it at speed']),
    trader: plate('THE TRADER', ['he buys what you bring', 'sells what you are short of', 'and has work every day']),
    heli: plate('HELICOPTER DOWN', [`every ${Math.round(CRASH.every / 60)} minutes, somewhere open`, 'black smoke, seen from far off', `its cargo is there ${Math.round(CRASH.life / 60)} minutes`]),
  };
  const card = g7('t4 t5 t6', `
    <div class="t4-kick">NEW GROUND &nbsp;·&nbsp; A NEW TOWN &nbsp;·&nbsp; NEW GEAR</div>
    <div class="t4-logo">ZONA</div>
    <div class="t4-line">THE ZONE HAS GROWN</div>
    <div class="t4-tags"><span>KAMENKA</span><span>THE ROAD OVER</span><span>THE TRADER</span><span>ARMOUR</span></div>`);
  const armour = g7('arm7', ARMOUR.map((id) => `<div class="a7"><strong>${ITEMS[id].name}</strong><b data-n="${off(id)}">0%</b><i></i><span>${id === 'heavy_armor' ? 'IN THE BUNKER, NOWHERE ELSE' : 'OFF A HIT TO THE BODY'}</span></div>`).join(''));
  const end = g7('t4 end6', `
    <div class="t4-logo">ZONA</div>
    <div class="t4-line">PLAY FREE IN YOUR BROWSER</div>
    <div class="e6-url">WWW.ZONAPVP.FUN</div>
    <div class="e6-rows"><span>X &nbsp;@${X_HANDLE}</span><span>DISCORD &nbsp;${DISCORD.replace('https://', '')}</span></div>
    <div class="e6-ca">${CONTRACT}</div>`);

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
        for (const el of gfx) el.style.display = 'none';
        g.hourHeld = s.hour ?? 0.36;
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
  // the jeep the film drives: where it stood, to be put back there
  const jeep = [...g.garage.jeeps.values()][0] as Any;
  const home = jeep ? [jeep.pos.x, jeep.pos.y, jeep.pos.z, jeep.quat.x, jeep.quat.y, jeep.quat.z, jeep.quat.w, 0, 0, 0, 0, 0] : null;
  let wreck = false;
  const reset = (hide: THREE.Vector3) => {
    for (const a of S.actors) {
      a.dance = a.surrender = a.crouch = a.aim = a.sprint = false;
      a.foe = null;
      (a.rp as Any).seat = null;
      a.hide();
    }
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Mouse0', 'Mouse2', 'AltLeft']) S.key(k, false);
    // (the player is stood near what is filmed and out of the picture: the world is drawn round where they are)
    S.me(hide.x, hide.z, 0);
    S.kit([]);
    S.hold(null);
    S.clean();
    hush();
    g.lit = false;
    if (jeep && home) jeep.place(home);
    if (wreck) {
      g.removeDrop('tr-heli');
      wreck = false;
    }
  };

  // ------------------------------------------------------------ 1. the card, over the town from the air
  const centre = K(0, 0, 4);
  /** round the town, coming down and in: `k` is how far through the two shots it is */
  const over = (k: number): CamPose => {
    const a = Math.atan2(-ux, -uz) + 0.55 + k * 0.5, r = 300 - k * 80;
    return { p: new THREE.Vector3(T.x + Math.sin(a) * r, centre.y + 155 - k * 45, T.z + Math.cos(a) * r), l: centre, fov: 31 };
  };
  add(1, {
    name: 'card',
    g: 'dim5',
    setup: async () => {
      reset(K(96, 30));
      await preroll(24, over(0));
    },
    cam: (t) => over((t / b(1.75)) * 0.55),
    // (as it stands when it has arrived: the first frame is the picture the film is known by)
    after: (t) => show(card, t + 1),
    fadeOut: 0.18,
  });
  add(0.75, {
    name: 'town',
    g: 'warm',
    flash: 0.5,
    chain: true,
    cam: (t) => hand(over(0.55 + (t / b(0.75)) * 0.45), t, 0.5),
    plates: [[PLATE.town, 0.1, b(0.75) - 0.05]],
  });

  // ------------------------------------------------------------ 2. down its street
  add(0.75, {
    name: 'street',
    g: 'warm',
    flash: 0.35,
    setup: async () => {
      reset(K(-96, 34));
      await preroll(16, { p: K(-66, 1.2, 1.7), l: K(30, -0.6, 3.2), fov: 44 });
    },
    cam: (t) => hand({ p: K(-66 + t * 9, 1.2, 1.7), l: K(30, -0.6, 3.2), fov: 44 }, t, 1.2),
    plates: [[PLATE.street, 0.08, b(0.75) - 0.05]],
  });

  // ------------------------------------------------------------ 3. the road over, and a jeep on it
  const DRIVE = { from: Math.min(RN - 24, foot + 26), speed: 15 };
  /** where the jeep is so many seconds into its climb: on the road, nose up the hill, lying to the slope */
  const onRoad = (t: number) => {
    let left = t * DRIVE.speed, i = DRIVE.from;
    while (i < RN - 2 && left > R(i).distanceTo(R(i + 1))) {
      left -= R(i).distanceTo(R(i + 1));
      i++;
    }
    const a = R(i), z = R(i + 1), d = a.distanceTo(z) || 1, at = a.clone().lerp(z, Math.min(1, left / d));
    const yaw = Math.atan2(-(z.x - a.x), -(z.z - a.z)), pitch = Math.atan2(z.y - a.y, Math.hypot(z.x - a.x, z.z - a.z));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    const dir = z.clone().sub(a).setY(0).normalize();
    return { at, q, dir, right: new THREE.Vector3(-dir.z, 0, dir.x) };
  };
  const drive = (t: number) => {
    const o = onRoad(t);
    jeep?.place([o.at.x, o.at.y + 0.86, o.at.z, o.q.x, o.q.y, o.q.z, o.q.w, o.dir.x * DRIVE.speed, 0, o.dir.z * DRIVE.speed, 0, 1]);
    return o;
  };
  const chase = (t: number): CamPose => {
    const o = onRoad(t), ahead = onRoad(t + 0.5).at;
    return { p: o.at.clone().addScaledVector(o.dir, -11.5 + t * 1.3).addScaledVector(o.right, 2.6).setY(o.at.y + 3.3 - t * 0.35), l: ahead.clone().setY(ahead.y + 1.0), fov: 50 };
  };
  add(1, {
    name: 'pass',
    g: 'gold',
    flash: 0.4,
    setup: async () => {
      const o = onRoad(0);
      reset(o.at.clone().addScaledVector(o.dir, -60).addScaledVector(o.right, 30));
      if (jeep) {
        A(0).place(o.at.x, o.at.z, 0, null, ['patrol_cap']);
        (A(0).rp as Any).seat = { jeep, at: SEAT_AT[0] };
      }
      await preroll(20, chase(0), () => drive(0));
    },
    tick: (t) => { drive(t); },
    cam: (t) => hand(chase(t), t, 1.6),
    plates: [[PLATE.pass, 0.1, b(1) - 0.05]],
  });

  // ------------------------------------------------------------ 4. the trader
  // the way to look at him: whichever side has the longest clear run to his chest (the customer's side of the counter)
  const chest = trader.clone().setY(trader.y + 1.35);
  const facing = ((g.traders as Any).stands?.[0]?.yaw ?? 0) as number, front = new THREE.Vector3(-Math.sin(facing), 0, -Math.cos(facing));
  let side = front.clone(), reach = 0, best = 0;
  for (let k = 0; k < 48; k++) {
    const d = new THREE.Vector3(Math.sin((k / 48) * Math.PI * 2), 0, Math.cos((k / 48) * Math.PI * 2)), across = new THREE.Vector3(d.z, 0, -d.x);
    let far = 0;
    for (let r = 1.2; r <= 6; r += 0.3) {
      const at = chest.clone().addScaledVector(d, r).setY(chest.y + 0.25);
      // (nothing between the lens and him, nor just to either side of it: a door post beside the lens is half the picture)
      if (![0, 0.5, -0.5].every((o) => S.clearLine(at.clone().addScaledVector(across, o), chest))) break;
      far = r;
    }
    const score = far * (0.35 + Math.max(0, d.dot(front)));
    if (score > best) {
      best = score;
      reach = far;
      side = d;
    }
  }
  console.log(`[tr] cut 7: the trader is looked at from ${reach.toFixed(1)} m`);
  const counter = (t: number): CamPose => {
    const r = Math.max(1.9, Math.min(reach - 0.35, 3.7) - t * 0.75);
    return { p: chest.clone().addScaledVector(side, r).setY(chest.y + 0.25), l: chest.clone().setY(chest.y + 0.05), fov: 40 };
  };
  add(1, {
    name: 'trader',
    g: 'warm',
    flash: 0.35,
    hour: 0.42,
    setup: async () => {
      reset(chest.clone().addScaledVector(side, Math.min(reach, 5) + 9));
      await preroll(30, counter(0));
    },
    cam: (t) => hand(counter(t), t, 0.9),
    plates: [[PLATE.trader, 0.1, b(1) - 0.05]],
  });

  // ------------------------------------------------------------ 5. the five armours
  const ROW = { along: 18, gap: 2.1, guns: [null, 'p38', 'm9', 'mosin', 'benelli'] as (string | null)[] };
  const man = (k: number) => K(ROW.along + (k - 2) * ROW.gap, 0);
  const lineUp = (t: number): CamPose => {
    const k = ease(t / b(1.5)), at = K(ROW.along + (-2.6 + k * 5.2) * ROW.gap, 0, 1.25);
    return { p: K(ROW.along + (-3.1 + k * 6.2) * ROW.gap, 5.3, 1.45), l: at, fov: 29 };
  };
  add(1.5, {
    name: 'armour',
    g: 'cold',
    flash: 0.5,
    hour: 0.4,
    setup: async () => {
      reset(K(ROW.along - 44, -30));
      const face = Math.atan2(-uz, ux);
      ARMOUR.forEach((id, k) => {
        const at = man(k);
        A(k).place(at.x, at.z, face, ROW.guns[k], k >= 3 ? [id, 'boonie_hat'] : [id]);
      });
      // (what they wear is fetched as it is asked for)
      await wait(900);
      await preroll(40, lineUp(0));
    },
    cam: (t) => hand(lineUp(t), t, 0.7),
    after: (t) => {
      show(armour, t);
      armour.querySelectorAll<HTMLElement>('.a7').forEach((el, k) => {
        const on = ease((t - 0.12 - k * 0.42) / 0.2), n = Number(el.querySelector<HTMLElement>('[data-n]')!.dataset.n);
        el.style.opacity = String(on);
        el.style.transform = `translateY(${((1 - on) * 2.4).toFixed(2)}vh)`;
        el.querySelector('b')!.textContent = `${Math.round(n * ease((t - 0.12 - k * 0.42) / 0.5))}%`;
        el.style.setProperty('--w', `${(n * 2 * ease((t - 0.12 - k * 0.42) / 0.5)).toFixed(1)}%`);
      });
    },
  });

  // ------------------------------------------------------------ 6. a helicopter down
  const crash = new THREE.Vector3(crashAt.x + Math.cos(0.6) * CRASH.beside, crashAt.y, crashAt.z - Math.sin(0.6) * CRASH.beside);
  // (from the side the cargo is on, and the smoke going up out of the top of the picture)
  const fromCargo = new THREE.Vector3(crashAt.x - crash.x, 0, crashAt.z - crash.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
  const wide = (t: number): CamPose => ({ p: P(crash.x + fromCargo.x * (17 - t * 2.4), crash.z + fromCargo.z * (17 - t * 2.4), 1.7 + t * 0.4), l: crash.clone().setY(crash.y + 2.8 + t * 1.1), fov: 46 });
  add(1, {
    name: 'heli',
    g: 'war',
    flash: 0.5,
    hour: 0.33,
    setup: async () => {
      reset(P(crash.x - fromCargo.x * 60, crash.z - fromCargo.z * 60));
      await g.addDrop({ uid: 'tr-heli', x: crashAt.x, y: crashAt.y, z: crashAt.z, rot: 0.6, left: CRASH.life, heli: true }, true);
      wreck = true;
      hush();
      // (its smoke is built as time passes: six seconds of it before the picture)
      await wait(700);
      await preroll(360, wide(0));
      hush();
    },
    cam: (t) => hand(wide(t), t, 1.3),
    plates: [[PLATE.heli, 0.1, b(1) - 0.05]],
  });

  // ------------------------------------------------------------ 7. where it is played
  add(1, {
    name: 'end',
    g: 'dim5',
    chain: true,
    cam: (t) => wide(b(1) + t * 0.6),
    after: (t) => show(end, t),
    fadeOut: 0.3,
  });

  // ------------------------------------------------------------ the score: laid under the cut bar by bar
  {
    const Am = 33, F = 41, C = 36, G = 43, E = 40;
    const LEVELS: Level[] = ['low', 'build', 'drive', 'full', 'drive', 'top', 'top', 'end'];
    const ROOTS = [Am, E, Am, F, C, G, Am, Am];
    for (let i = 0; i < BARS7; i++) ARRANGEMENT.rows.push([ROOTS[i], ROOTS[i] === Am || ROOTS[i] === E, LEVELS[i]]);
    const at = (name: string, plus = 0) => marks[name] * BAR + plus;
    ARRANGEMENT.hits.push([at('town'), 1.1], [at('street'), 0.6], [at('pass'), 0.9], [at('trader'), 0.6], [at('armour'), 1], [at('heli'), 1.1], [at('end'), 1.2]);
    ARRANGEMENT.risers.push([0, at('town'), 0.9], [at('trader', b(0.4)), at('armour'), 0.7]);
    ARRANGEMENT.hits.sort((x, y) => x[0] - y[0]);
    console.log(`[tr] cut 7: ${shots.length} shots, ${cur} bars, ${(cur * BAR).toFixed(2)} s`);
  }
  // (the light used by none of this, the scene by nothing else: kept from being called unused)
  void scene;
  return shots;
}
