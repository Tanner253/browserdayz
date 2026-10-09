// The fifth trailer: the infected. Thirty seconds (16 bars at 128 BPM), made the way the
// others were: the real game on a clock that only moves when the film says.
//
// What it says, in the order it says it: what they look like (the three bodies), how they
// find you (they see ahead of them, they hear a run and a shot), what they do about it (they
// come, slower than a jog), how one is beaten (a guard stops its blow, and stops IT for the
// moment a blow back needs), that two people do better than one, and that they can be set on
// somebody else. Every figure on a plate is read off the game's own rules as the film is made
// (INFECTED in src/sim/infected.ts, the weapons in src/sim/items.ts): if a rule changes, the
// plate does.
//
// The infected in it are the game's own, with the game's own minds: they see, hear, chase
// and strike by the rules a player meets. The film stands them where it wants them and says
// which of them have their senses; it does not move them. The people are the game's player
// bodies, as in the other films. A blow on one of those is the film's to count (playing
// alone, the game has nobody but the player to hurt), and so is a shot of theirs that kills.

import * as THREE from 'three';
import type { Actor, CamPose, Shot, Stage } from './director';
import type { Arrangement, Level } from './music';
import { BAR } from './shots';
import { ITEMS } from '../sim/items';
import { INFECTED } from '../sim/infected';

const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const b = (bars: number) => bars * BAR;

export const ARRANGEMENT: Arrangement = { rows: [], hits: [], risers: [] };
export const BARS5 = 16;
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
  /** a place on the road so many metres along it from the middle of the village, and which way the road runs there */
  const road = (metres: number) => {
    let i = mid, left = Math.abs(metres);
    const step = metres >= 0 ? 1 : -1;
    while (left > 0 && i + step >= 0 && i + step < RN) {
      const d = R(i).distanceTo(R(i + step));
      if (d >= left) {
        const at = R(i).lerp(R(i + step), left / d);
        const t = R(Math.min(RN - 1, i + 1)).sub(R(Math.max(0, i - 1))).setY(0).normalize();
        return { at: P(at.x, at.z), t, n: new THREE.Vector3(t.z, 0, -t.x) };
      }
      left -= d;
      i += step;
    }
    const t = R(Math.min(RN - 1, i + 1)).sub(R(Math.max(0, i - 1))).setY(0).normalize();
    return { at: P(R(i).x, R(i).z), t, n: new THREE.Vector3(t.z, 0, -t.x) };
  };
  const yawOf = (d: THREE.Vector3) => Math.atan2(-d.x, -d.z);
  // open, level ground out of the village, for what needs room on every side
  const builds = world.buildings as { x: number; z: number }[];
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
  const GRADES = ['cold', 'warm', 'war', 'gold', 'dust', 'dim'];
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
    eyes: plate('THEY SEE', [`${m(I.sight)} ahead of them`, `${m(I.sightCrouched)} if you crouch`, 'nothing behind them']),
    ears: plate('THEY HEAR', [`a gunshot: ${m(I.hearShot)}`, `a sprint: ${m(I.hearSprint)}`, 'a walk or a crouch: nothing']),
    sneak: plate('GET PAST THEM', ['crouch', 'keep behind them', 'do not run']),
    noise: plate('NOISE BRINGS THEM', [`a gunshot carries ${m(I.hearShot)}`, 'they come to look', 'then they see who fired']),
    chase: plate('THEY COME', [`${I.chase} metres a second`, 'you jog at 4, sprint at 6.2', `out of sight ${I.forget} s, and they lose you`]),
    fight: plate('STOP THE BLOW', ['guard: right mouse button', `it is stopped for ${I.stopBlocked} s`, `a hatchet: ${Math.ceil(I.hp / hatchet)} blows`]),
    team: plate('TWO GUNS', ['one watches each way', 'one round to the head', 'kills an infected']),
    bait: plate('OR USE THEM', ['they go for whoever they see', 'let it be somebody else']),
  };
  const card = g5('t4 t5', `
    <div class="t4-kick">ZONA &nbsp;·&nbsp; NEW IN THE ZONE</div>
    <div class="t4-logo">THE INFECTED</div>
    <div class="t4-line">THEY NEVER LEFT</div>
    <div class="t4-tags"><span>THEY SEE</span><span>THEY HEAR</span><span>THEY HUNT</span></div>`);

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
        card.style.display = 'none';
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
  add(1.5, {
    name: 'card',
    g: 'dim',
    bars: false,
    fadeIn: 0.25,
    setup: async () => {
      await troupe();
      reset();
      standTrio();
      await preroll(90);
    },
    cam: (t) => {
      const k = t / b(1.5);
      const from = st0.at.clone().addScaledVector(st0.t, -lerp(7.5, 6.2, k)).setY(st0.at.y + 1.25);
      return hand({ p: from, l: st0.at.clone().setY(st0.at.y + 1.2), fov: 34 }, t, 0.6);
    },
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
        const p = at.clone().add(new THREE.Vector3(Math.sin(az) * 1.75, 0.02, Math.cos(az) * 1.75));
        // (the lens looks past it to the right of the picture: the plate has the left)
        const l = at.clone().add(new THREE.Vector3(Math.cos(az) * -0.32, -0.12, Math.sin(az) * 0.32));
        return hand({ p, l, fov: 36 }, t, 0.5, seed);
      },
    });
  portrait('body-cop', () => trio()[0], PLATE.cop, 0.5, 1);
  portrait('body-man', () => trio()[1], PLATE.eyes, -0.5, 2);
  portrait('body-woman', () => trio()[2], PLATE.ears, 0.5, 3);

  // ============================================================ 3. past one of them, behind its back
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

  // ============================================================ 4. a shot, and they come to it
  {
    const s = road(-34), far = road(-34 - 62);
    let three: Zed[] = [];
    add(1.5, {
      name: 'shot',
      g: 'war',
      flash: 0.5,
      plates: [[PLATE.noise, 0.25, b(1.5) - 0.1]],
      setup: async () => {
        reset();
        three = [kind(2), kind(1), kind(0)];
        // about the street, looking nowhere in particular; he is a rifle shot's hearing away, out of their sight
        putZ(three[0], s.at.x + s.n.x * 1.4, s.at.z + s.n.z * 1.4, yawOf(s.n), true);
        putZ(three[1], s.at.x - s.n.x * 2.2 - s.t.x * 2.5, s.at.z - s.n.z * 2.2 - s.t.z * 2.5, yawOf(s.t.clone().negate()) + 2.2, true);
        putZ(three[2], s.at.x + s.n.x * 3.4 - s.t.x * 5, s.at.z + s.n.z * 3.4 - s.t.z * 5, yawOf(s.t) + 0.9, true);
        const v = A(0);
        v.place(far.at.x, far.at.z, yawOf(far.t), 'm9');
        v.aim = true;
        await preroll(30);
      },
      cues: [
        {
          at: 0.55,
          fn: () => {
            const v = A(0);
            v.fireAt(v.eye().add(new THREE.Vector3(0, 6, 0)).addScaledVector(far.t, 20));
            // (what a shot does in the game: everything of theirs within its carry goes to see)
            horde.noise(v.pos.x, v.pos.z, I.hearShot);
          },
        },
      ],
      cam: (t) => {
        // over their shoulders, down the street toward where it came from
        const p = s.at.clone().addScaledVector(s.t, 5.2).addScaledVector(s.n, -0.6).setY(s.at.y + 1.65);
        const l = s.at.clone().addScaledVector(s.t, -14).setY(s.at.y + 1.0);
        return hand({ p, l, fov: lerp(46, 40, ease(t / b(1.5))) }, t, 0.9, 5);
      },
    });
  }

  // ============================================================ 5. the chase
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
        pack = [kind(2), kind(0), kind(1)];
        run = 0;
        const k = A(2);
        const at = road(s0);
        k.place(at.at.x, at.at.z, yawOf(at.t), null, ['sack_pack']);
        pack.forEach((z, n) => {
          const p = road(s0 - 5.5 - n * 1.7);
          putZ(z, p.at.x + p.n.x * (n - 1) * 1.2, p.at.z + p.n.z * (n - 1) * 1.2, yawOf(p.t), true);
        });
        // (they are already after him and up to speed when the picture starts)
        await preroll(110, undefined, () => {
          run += 3.9 / 60;
          const p = road(s0 + run);
          k.go(p.at.x, p.at.z, 3.9, 1 / 60);
        });
      },
      tick: (_t, _S, dt) => {
        const k = A(2);
        run += 3.9 * dt;
        const p = road(s0 + run);
        k.go(p.at.x, p.at.z, 3.9, dt);
      },
      cam: (t) => {
        // beside the road, going with him, looking back along it at what is behind him
        const k = A(2);
        const p0 = road(s0 + run + 2.2);
        const p = p0.at.clone().addScaledVector(p0.n, 3.4).setY(p0.at.y + 1.25);
        const l = k.pos.clone().addScaledVector(p0.t, -2.6).setY(k.pos.y + 1.15);
        return hand({ p, l, fov: 44 }, t, 1.3, 6);
      },
    });
  }

  // ============================================================ 6. one of them, with a hatchet, through the player's eyes
  {
    const s = road(-12);
    let zed: Zed;
    let blocked = false, blows = 0;
    let jolt: (() => void) | null = null;
    add(2.5, {
      name: 'fight',
      hud: true,
      g: 'warm',
      flash: 0.6,
      plates: [[PLATE.fight, 0.3, b(2.5) - 0.1]],
      setup: async () => {
        reset();
        blocked = false;
        blows = 0;
        zed = kind(0);
        S.me(s.at.x, s.at.z, yawOf(s.t));
        S.kit(['hatchet']);
        S.hold('melee', false);
        putZ(zed, s.at.x + s.t.x * 4.3, s.at.z + s.t.z * 4.3, yawOf(s.t.clone().negate()), true);
        if (!jolt) {
          jolt = g.weapons.jolt.bind(g.weapons);
          g.weapons.jolt = () => {
            blocked = true;
            jolt!();
          };
        }
        await preroll(20);
      },
      tick: () => {
        // the eyes on it; the guard up until its blow has landed on it; then the hatchet, for as long as it stands
        S.aimAt(zed.dead ? chest(zed).setY(zed.pos.y + 0.4) : chest(zed));
        if (zed.dead) {
          S.key('Mouse2', false);
          return;
        }
        if (!blocked) {
          S.key('Mouse2', true);
          return;
        }
        S.key('Mouse2', false);
        const w = g.weapons;
        if (!w.action && w.fireCooldown <= 0 && Math.hypot(zed.pos.x - g.player.pos.x, zed.pos.z - g.player.pos.z) < 2.1) {
          S.tap('Mouse0', 60);
          blows++;
        }
      },
    });
  }

  // ============================================================ 7. two of them, back to back
  {
    let ring: Zed[] = [];
    const shotsAt = [0.55, 0.95, 1.45, 1.95];
    add(1.5, {
      name: 'team',
      g: 'war',
      flash: 0.6,
      plates: [[PLATE.team, 0.2, b(1.5) - 0.1]],
      setup: async () => {
        reset();
        ring = zeds.filter((z) => !z.dead).slice(-4);
        const mira = A(1), volkov = A(0);
        mira.place(field.x - 0.35, field.z, 0, 'm9', ['boonie_hat']);
        volkov.place(field.x + 0.35, field.z, Math.PI, 'm9', ['sack_pack']);
        mira.aim = volkov.aim = true;
        // (they come from all four sides, and have seen the two of them already)
        ring.forEach((z, n) => {
          const a = n * (Math.PI / 2) + 0.5, r = 9.5 + (n % 2) * 2.5;
          putZ(z, field.x + Math.sin(a) * r, field.z + Math.cos(a) * r, a + Math.PI, true);
        });
        await preroll(60, undefined, () => {
          mira.face(chest(ring[0]));
          volkov.face(chest(ring[1]));
        });
      },
      cues: shotsAt.map((at, n) => ({
        at,
        fn: () => {
          const who = A(n % 2 === 0 ? 1 : 0), z = ring[n];
          if (!z || z.dead) return;
          who.face(face(z));
          who.fireAt(face(z));
          drop(z, who.eye());
        },
      })),
      tick: (t) => {
        // each has the next one of theirs in their sights before they fire
        const n = shotsAt.findIndex((at) => at > t);
        const mira = A(1), volkov = A(0);
        const zm = ring[n < 0 ? 2 : n % 2 === 0 ? n : Math.min(3, n + 1)], zv = ring[n < 0 ? 3 : n % 2 === 1 ? n : Math.min(3, n + 1)];
        if (zm && !zm.dead) mira.face(face(zm));
        if (zv && !zv.dead) volkov.face(face(zv));
      },
      cam: (t) => {
        const az = 0.9 + t * 0.42;
        const at = P(field.x, field.z, 1.25);
        return hand({ p: at.clone().add(new THREE.Vector3(Math.sin(az) * 5.2, 0.75, Math.cos(az) * 5.2)), l: at, fov: 46 }, t, 1.1, 7);
      },
    });
  }

  // ============================================================ 8. set on somebody else
  {
    let pack: Zed[] = [];
    add(2, {
      name: 'bait',
      g: 'dust',
      flash: 0.6,
      plates: [[PLATE.bait, 0.25, b(2) - 0.1]],
      setup: async () => {
        reset();
        pack = zeds.filter((z) => !z.dead).slice(0, 3);
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

  // ============================================================ 9. the end
  add(1, {
    name: 'end',
    g: 'dim',
    chain: true,
    bars: false,
    fadeOut: 0.5,
    cam: (t) => {
      const bear = A(5);
      const p = P(field2.x + 2.0 + t * 0.15, field2.z - 1.6 - t * 0.2, 0.95 + t * 0.1);
      return hand({ p, l: bear.pos.clone().add(new THREE.Vector3(-0.3, 0.9, 2.2)), fov: 44 }, t, 0.8, 9);
    },
    titles: [{ at: 0.05, until: b(1) + 1, text: '<div class="end-logo">ZONA</div><div class="end-line">THE INFECTED ARE IN THE ZONE</div><div class="end-url">WWW.ZONAPVP.FUN</div>', cls: 'end' }],
  });

  shots.sort((x, y) => x.start - y.start);

  // ------------------------------------------------------------ the score, laid under the cut
  {
    const Am = 33, F = 41, C = 36, G = 43, E = 40;
    const PLAYED: [string, Level][] = [['card', 'low'], ['body-cop', 'pulse'], ['sneak', 'tense'], ['shot', 'build'], ['chase', 'drive'], ['fight', 'full'], ['team', 'top'], ['bait', 'tense'], ['end', 'end']];
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
    ARRANGEMENT.hits.push([at('body-cop'), 0.8], [at('body-man'), 0.5], [at('body-woman'), 0.5], [at('sneak'), 0.5], [at('shot', 0.55), 1], [at('chase'), 1.1], [at('fight'), 0.9], [at('team'), 1], [at('bait'), 0.8], [at('end'), 1.2]);
    ARRANGEMENT.risers.push([at('shot'), at('chase'), 0.8], [at('bait'), at('end'), 0.9]);
    console.log(`[tr] cut 5: ${shots.length} shots, ${cur} bars, ${(cur * BAR).toFixed(2)} s`);
  }
  return shots;
}
