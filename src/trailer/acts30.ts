// The thirtieth film's shots, "The way down" (shots30.ts, board marketing/plan-film-30.html, said yes to 2026-11-06). One
// survivor down the card chain: the green keycard, Level 1 by torchlight, Stolovaya, the Old Mine, Bolotnaya, the lift to
// Level 2 and its plant, the Kupol, the train, the great hall and the vault. Everything moves by the game's own parts: the
// stops are told what the server would tell them (`onSite`, `onGate`), the lift and the train run on their clock, the
// infected on their own minds. X plays it muted first, so the chips tell the story.
import * as THREE from 'three';
import { BRACED, DRONE, Operator, yawTo } from './human';
import { GOLDEN, NIGHT, NOON, V, fwdOf, rightOf, type Ctx } from './frame28';
import { BAR30 } from './music30';
import { BUNKER, CAB, bunkerAt, bunkerPlan, levelY, liftAt } from '../sim/bunker';
import { VAULT_DOOR } from '../sim/bunker-deep';
import { SITES, siteSpot, sitePoint, strongDoor } from '../sim/sites';
import { GORODOK } from '../sim/outposts';
import { townPoint } from '../sim/towns';
import { MINE } from '../sim/mine';
import { DOME } from '../world/kupol';
import { RUN, RUN_TIME, wagonAt } from '../sim/train-line';
import { LAUNCHED } from '../sim/grenades';
import { I_CHASE } from '../sim/infected';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** the stops' and the vault's word from the server, as it would come */
type Phase = 'idle' | 'alarm' | 'spent';

export function shots30(c: Ctx) {
  const { S, g, add, P, say, run, kit, when, piece, show, chipSay, hand, look, eye, lay, legs, ahead, lightHands, ground, cleaners, dressers } = c;
  const bunker = () => g.bunker.place as Any;
  /** a place in the bunker: right, forward, and up from a level's floor */
  const BW = (level: number, r: number, f: number, up = 0) => {
    const [x, y, z] = bunkerAt(bunker(), r, f, levelY(level) + up);
    return V(x, y, z);
  };
  const site = (s: string, phase: Phase, done: number[] = [], left = 300) => g.sites.onSite({ t: 'site', s, phase, left, done });
  const gate = (id: string, open: boolean, left = 300) => g.sites.onGate({ t: 'gate', g: id, open, left });
  const H0 = BUNKER.hall;

  // ------------------------------------------------------------ the words
  const title = piece('x28-title', '<img src="/brand/zona-mark.svg" alt=""><b>ZONA</b><u>THE WAY DOWN</u><i>BUNKER 17 GOES THREE LEVELS DEEP</i>');
  const end = piece('x28-end', '<img src="/brand/zona-mark.svg" alt=""><b>ZONA</b><u>THE WAY DOWN</u><h5>FREE · PLAYS IN YOUR BROWSER · NO DOWNLOAD</h5><em>WWW.ZONAPVP.FUN</em>');
  const chain = piece('x30-chain', '<b>SIX CARDS · THREE LEVELS · ONE VAULT</b>');
  cleaners.push(() => {
    for (const el of [title, end, chain]) el.style.display = 'none';
    c.chip.style.top = c.chip.style.bottom = '';
  });
  const fade = (t: number, a: number, b: number, k = 0.35) => (t < a || t > b ? 0 : Math.min(1, (t - a) / k, (b - t) / k));

  // ------------------------------------------------------------ the infected: the bunker's in their orange suits, and the stops' own
  // (who they are is where they live, src/game/infected-kinds.ts: made once each, beside the four the frame makes)
  const bands = new Map<string, Any[]>();
  const band = async (name: string, home: [number, number], n: number, first: number) => {
    const horde = g.horde as Any, dir = horde.director, me = horde.host.me().id, out: Any[] = [];
    for (let k = 0; k < n; k++) {
      const i = first + k, info = { i, s: [home[0], -300, home[1], 0, 0, 0], hp: 90, own: me, h: [0, 0] };
      dir.bodies.set(i, { ...info, home: 0, diedAt: 0, heard: 0, struck: 0 });
      horde.add(info);
      out.push(horde.all.get(i));
    }
    for (let k = 0; k < 600 && out.some((z) => !z.ready || !z.mine); k++) await c.wait(25);
    for (const z of out) c.infected.putZ(z, V(0, -300, 0), 0, false);
    bands.set(name, out);
  };
  dressers.push(async () => {
    const P0 = bunker();
    await band('bunker', [P0.x, P0.z], 2, 3200);
    await band('stolovaya', sitePoint(SITES.stolovaya, SITES.stolovaya.room), 3, 3210);
    await band('bolotnaya', sitePoint(SITES.bolotnaya, SITES.bolotnaya.room), 2, 3220);
    say(`bands: ${[...bands].map(([k, v]) => `${k} ${v.length} (${v.map((z) => z.kind ?? '?').join(',')})`).join(' | ')}`);
  });
  cleaners.push(() => { for (const zs of bands.values()) for (const z of zs) c.infected.putZ(z, V(0, -300, 0), 0, false); });
  const zedAt = (z: Any) => V(z.pos.x, z.pos.y + 1.25, z.pos.z);
  /** stood there, woken, and already after him: as one is once it has seen somebody */
  const onTo = (z: Any, p: THREE.Vector3) => {
    c.infected.putZ(z, p, yawTo(p, P().pos), true);
    c.infected.awake(z);
    z.mode = I_CHASE;
    z.after = (g.horde as Any).host.me().id;
    z.seenAt = performance.now();
    z.lastSeen?.copy(P().pos);
  };

  // (each stop put back as it was between shots: a shot's site, gate and lamps are its own)
  cleaners.push(() => {
    for (const s of ['stolovaya', 'bolotnaya', 'kupol', 'level2', 'vault']) site(s, 'idle');
    for (const id of ['mine', 'lift', 'train', 'stair']) gate(id, false);
    if (g.bunker.open) g.bunker.setOpen(false, true);
    if (g.goggles.on) g.goggles.update(true, true, () => {});
  });

  // ------------------------------------------------------------ a shot, in bars of the score
  let at = 0;
  const shot = (bars: number, name: string, s: Omit<Parameters<typeof add>[1], 'name'>) => {
    at += bars;
    add(bars * BAR30, { name, ...s });
  };
  const chipIn = (len: number, big: string, small: string, from = 0.3) => (t: number) => chipSay(t, from, len - 0.08, big, small);

  // ============================================================ THE DOOR
  // over the camp in the gas above Bunker 17, high and slow: the title on frame 0 (it is the thumbnail)
  {
    const op = new Operator(DRONE, 3001, 46);
    let a = V(0, 0, 0), b = V(0, 0, 0), m = V(0, 0, 0);
    shot(1.5, 'title', {
      hour: GOLDEN,
      m: 'dread',
      setup: async () => {
        const P0 = bunker();
        m = V(GORODOK.x, 0, GORODOK.z);
        m.y = S.ground(m.x, m.z);
        const d = fwdOf(P0.rot + Math.PI * 0.25), r = rightOf(P0.rot + Math.PI * 0.25);
        a = m.clone().addScaledVector(d, -78).addScaledVector(r, -26).setY(m.y + 34);
        b = m.clone().addScaledVector(d, -64).addScaledVector(r, 6).setY(m.y + 30);
        S.me(P0.x, P0.z, 0);
        await run(40);
        op.reset(a, m.clone().setY(m.y + 2));
      },
      cam: (t) => op.update(t, a.clone().lerp(b, t / (1.5 * BAR30)), m.clone().setY(m.y + 2)),
      after: (t) => show(title, Math.min(1, t / 0.2 + 1, (1.5 * BAR30 - 0.15 - t) / 0.3)),
    });
  }
  // the green keycard: the reader at the stair's foot, the card pushed home, the blast door rolling aside on the dark
  shot(2, 'keycard', {
    hour: NOON,
    m: 'dread',
    under: true,
    setup: async () => {
      lightHands();
      kit(['keycard', 'flashlight']);
      S.hold(null);
      const door = BW(1, 0, H0.front, 1.2), foot = BW(1, 0, Math.min(BUNKER.stair.foot - 0.3, H0.front + 1.0));
      S.me(foot.x, foot.z, yawTo(foot, door), 0, foot.y);
      hand.set(P().yaw, 0.02);
      hand.look(-0.4, door, true, 0);
      await run(30);
      g.takeUp([...g.inv.carried()].find((i: Any) => i.id === 'keycard'));
      await run(40);
    },
    tick: (t, _S, dt) => {
      look(t, dt);
      when(t, 0.45, 'swipe', () => g.swipeCard());
      when(t, 2.6, 'light', () => S.tap('KeyL'));
      when(t, 3.0, 'in', () => hand.look(t, BW(1, 0, H0.front - 12, 1.3), true, 0.1));
      S.key('KeyW', t > 3.2);
    },
    after: chipIn(2 * BAR30, 'BUNKER 17', 'THE GREEN KEYCARD OPENS LEVEL 1', 2.9),
  });

  // ============================================================ LEVEL 1
  // down the passage by the torch: the flies, the drips, the marks on the walls
  shot(1.5, 'passage', {
    m: 'dread',
    under: true,
    setup: async () => {
      g.bunker.setOpen(true, true);
      lightHands(0.9, 0.6);
      kit(['flashlight']);
      S.hold(null);
      const a = BW(1, 0, H0.front - 4), b = BW(1, 0, H0.front - 18);
      S.me(a.x, a.z, yawTo(a, b), 0, a.y);
      lay([a, BW(1, 0.4, H0.front - 10), b], { walk: true, stop: 0.5 });
      hand.set(P().yaw, -0.05);
      hand.look(-0.4, ahead(7), true, 0);
      await run(20);
      S.tap('KeyL');
      await run(80);
    },
    tick: (t, _S, dt) => {
      legs();
      look(t, dt);
      when(t, 1.6, 'side', () => hand.look(t, BW(1, -2.2, H0.front - 14, 1.2), true, 0.25));
      when(t, 2.8, 'on', () => hand.look(t, ahead(8), true, 0.3));
    },
    after: chipIn(1.5 * BAR30, 'LEVEL 1', 'TORCHLIGHT ONLY'),
  });
  // not alone: one of the orange suits out of the dark, at a run, and two rounds in the torchlight
  {
    let z: Any = null, dropped = false;
    shot(1.5, 'infected', {
      m: 'dread',
      hit: true,
      setup: async () => {
        g.bunker.setOpen(true, true);
        lightHands();
        kit(['flashlight', 'ak', ['ammo_762', 30]]);
        S.hold('primary');
        const me = BW(1, 0, H0.front - 10), far = BW(1, 0, H0.front - 20.5);
        S.me(me.x, me.z, yawTo(me, far), 0, me.y);
        await run(20);
        S.tap('KeyL');
        z = bands.get('bunker')?.[0] ?? null;
        dropped = false;
        await run(16);
        if (z) onTo(z, far);
        hand.set(yawTo(eye(), z ? zedAt(z) : far), -0.03);
        if (z) hand.look(-0.3, () => zedAt(z), true, 0);
      },
      tick: (t, _S, dt) => {
        look(t, dt);
        const near = z ? Math.hypot(z.pos.x - P().pos.x, z.pos.z - P().pos.z) : 99;
        // (it has him in sight down the passage: kept after him, as one is that has seen somebody)
        if (z && !dropped && t < 1.5) {
          z.mode = I_CHASE;
          z.after = (g.horde as Any).host.me().id;
          z.seenAt = performance.now();
          z.lastSeen?.copy(P().pos);
        }
        S.key('Mouse0', !dropped && near < 6.5 && t % 0.32 < 0.12);
        if (z && !dropped && near < 5.2) {
          dropped = true;
          c.infected.dropZ(z, eye());
        }
      },
      after: chipIn(1.5 * BAR30, 'NOT ALONE', 'THE INFECTED LIVE DOWN HERE', 0.5),
    });
  }
  // the blue pass: found, and held up to the torch
  shot(1, 'blue-pass', {
    m: 'loot',
    setup: async () => {
      g.bunker.setOpen(true, true);
      lightHands(2, 1.3);
      kit(['card_blue', 'flashlight']);
      S.hold(null);
      const me = BW(1, 0, H0.front - 6), on = BW(1, 0, H0.front - 16, 1.0);
      S.me(me.x, me.z, yawTo(me, on), -0.1, me.y);
      hand.set(P().yaw, -0.12);
      hand.look(-0.4, on, true, 0);
      await run(20);
      g.takeUp([...g.inv.carried()].find((i: Any) => i.id === 'card_blue'));
      S.tap('KeyL');
      await run(50);
    },
    tick: (t, _S, dt) => look(t, dt),
    after: (t) => {
      chipSay(t, 0.2, BAR30 - 0.08, 'BLUE CLEARANCE PASS', 'FOUND ON LEVEL 1');
      c.chip.style.top = '64px';
      c.chip.style.bottom = 'auto';
    },
  });

  // ============================================================ THE CHAIN
  // Stolovaya: the blue pass held to the reader, the beam, the lamp gone green, the strong room's door opening, a flare up
  {
    const s = SITES.stolovaya, op = new Operator(BRACED, 3002, 44);
    let me = V(0, 0, 0), reader = V(0, 0, 0), lens = V(0, 0, 0), aim = V(0, 0, 0), along = V(1, 0, 0), out = V(0, 0, 1), door = -1;
    // (at night: the flare is what the place sends up, and it is the light the scene is seen by)
    shot(2, 'stolovaya', {
      hour: NIGHT,
      m: 'tight',
      setup: async () => {
        const [rx, rz] = sitePoint(s, s.reader), [mx, mz] = sitePoint(s, s.room);
        reader = V(rx, 0, rz);
        reader.y = ground.floorAt(rx, rz);
        out = V(rx - mx, 0, rz - mz).normalize();
        me = reader.clone().addScaledVector(out, 0.95);
        me.y = ground.floorAt(me.x, me.z);
        kit(['card_blue'], {}, ['field_jacket', 'cargo_pants', 'hiking_boots', 'sack_pack']);
        S.me(me.x, me.z, yawTo(me, reader), 0, me.y);
        await run(20);
        g.takeUp([...g.inv.carried()].find((i: Any) => i.id === 'card_blue'));
        door = strongDoor(s, (i) => { const p = g.s.buildings.doors[i]?.pivot.position; return p ? [p.x, p.z] : null; }, g.s.buildings.doors.length);
        // (the lens down the wall from the reader's side, the door beyond the man at the reader, the yard beyond the door)
        const dp = door >= 0 ? (g.s.buildings.doors[door].pivot.position as THREE.Vector3) : reader.clone().addScaledVector(V(-out.z, 0, out.x), 3);
        along = V(dp.x - reader.x, 0, dp.z - reader.z);
        along.addScaledVector(out, -along.dot(out)).normalize();
        lens = reader.clone().addScaledVector(along, -6.5).addScaledVector(out, 3.6);
        lens.y = ground.floorAt(lens.x, lens.z) + 1.55;
        aim = reader.clone().addScaledVector(along, 3).addScaledVector(out, 0.8).setY(reader.y + 1.15);
        await c.dressedNow();
        op.reset(lens, aim);
        say(`stolovaya: reader ${reader.x.toFixed(1)},${reader.y.toFixed(1)},${reader.z.toFixed(1)}, strong door ${door}`);
      },
      tick: (t) => {
        when(t, 0.2, 'scan', () => g.sites.scanning(siteSpot(s, s.reader), 1.2));
        when(t, 1.3, 'pass', () => g.sites.passed());
        when(t, 1.5, 'door', () => { if (door >= 0) g.s.buildings.doors[door].set(true, 1); });
        when(t, 0.3, 'flare', () => {
          // (as the server sends it up: from over the reader, server/sites.ts flare())
          const from = V(reader.x, S.ground(reader.x, reader.z) + 3, reader.z);
          g.grenades.throw(from, V(0.8, LAUNCHED.ammo_flare.speed, 0.5), LAUNCHED.ammo_flare.flight, false, 'ammo_flare', true);
        });
        when(t, 1.6, 'wave', () => {
          const zs = bands.get('stolovaya') ?? [];
          zs.forEach((z, k) => {
            const p = reader.clone().addScaledVector(along, 17 + k * 3.5).addScaledVector(out, 2 + k * 2.2);
            p.y = ground.floorAt(p.x, p.z, me.y + 2);
            onTo(z, p);
          });
        });
        when(t, 4.6, 'lit', () => say(`stolovaya at the end: flares ${(g.toys as Any)?.flares?.length}, zeds ${(bands.get('stolovaya') ?? []).map((z) => Math.hypot(z.pos.x - me.x, z.pos.z - me.z).toFixed(1)).join(' ')}`));
      },
      cam: (t) => op.update(t, lens, aim),
      after: chipIn(2 * BAR30, 'STOLOVAYA', 'THE BLUE PASS OPENS THE STRONG ROOM'),
    });
  }
  // the Old Mine: along the drift by its torches, toward the hoist room (the yellow pass opens its gates)
  shot(1.5, 'mine', {
    m: 'sneak',
    under: true,
    setup: async () => {
      lightHands(0.8, 0.5);
      kit(['card_yellow'], {}, ['field_jacket', 'cargo_pants', 'hiking_boots', 'sack_pack']);
      S.hold(null);
      gate('mine', true, 900);
      // (from past the fall, in the pool of the torch at the drift's turn, slowing to a stop before the dark between torches)
      const a = V(MINE.hall.x - 26.5, MINE.y, MINE.z), b = V(MINE.hall.x - 21, MINE.y, MINE.z);
      S.me(a.x, a.z, yawTo(a, b), 0, MINE.y + 0.05);
      lay([a, b], { walk: true, stop: 0.5 });
      hand.set(P().yaw, 0);
      hand.look(-0.4, ahead(9), true, 0);
      await run(150);
    },
    tick: (t, _S, dt) => {
      legs();
      look(t, dt);
    },
    after: chipIn(1.5 * BAR30, 'THE OLD MINE', 'THE YELLOW PASS OPENS ITS GATES'),
  });
  // Bolotnaya: a valve turned as the swamp gives them up
  {
    const s = SITES.bolotnaya, op = new Operator(BRACED, 3003, 42);
    let valve = V(0, 0, 0), lens = V(0, 0, 0), aim = V(0, 0, 0);
    shot(1.5, 'bolotnaya', {
      hour: GOLDEN,
      m: 'tight',
      setup: async () => {
        const [vx, vz] = townPoint(s.town, s.steps!.at[0][0], s.steps!.at[0][1]), [mx, mz] = sitePoint(s, s.room);
        valve = V(vx, 0, vz);
        valve.y = ground.floorAt(vx, vz);
        // (he stands at the wheel's face: it is set 0.42 m off its stand on this bearing, src/world/pump-works.ts. The owner on
        // the first draft: "the player is on wrong side of the wheel")
        void mx; void mz;
        const out = V(Math.sin(2.09), 0, Math.cos(2.09)), side = V(-out.z, 0, out.x);
        const me = valve.clone().addScaledVector(out, 1.0);
        me.y = ground.floorAt(me.x, me.z);
        kit([], {}, ['field_jacket', 'cargo_pants', 'hiking_boots', 'sack_pack']);
        S.hold(null);
        S.me(me.x, me.z, yawTo(me, valve), -0.2, me.y);
        site('bolotnaya', 'alarm', [], s.hold);
        lens = valve.clone().addScaledVector(out, -1.2).addScaledVector(side, 4.6);
        lens.y = ground.floorAt(lens.x, lens.z, valve.y + 1) + 1.35;
        aim = valve.clone().addScaledVector(out, 1.8).setY(valve.y + 0.9);
        await c.dressedNow();
        // (two of the swamp's own, under it, as the waves stand them: 1.8 m down, and up out of it)
        (bands.get('bolotnaya') ?? []).forEach((z, k) => {
          const p = me.clone().addScaledVector(out, 6.5 + k * 2.5).addScaledVector(side, k ? 2.5 : -2.2);
          p.y = S.ground(p.x, p.z) - 1.8;
          c.infected.putZ(z, p, yawTo(p, me), true);
        });
        op.reset(lens, aim);
        say(`bolotnaya: valve ${valve.x.toFixed(1)},${valve.y.toFixed(1)},${valve.z.toFixed(1)}`);
      },
      tick: (t) => {
        when(t, 0.3, 'turned', () => site('bolotnaya', 'alarm', [0], s.hold));
        when(t, 0.9, 'rise', () => {
          for (const z of bands.get('bolotnaya') ?? []) {
            z.rising = true;
            c.infected.awake(z);
          }
        });
      },
      cam: (t) => op.update(t, lens, aim),
      after: chipIn(1.5 * BAR30, 'BOLOTNAYA', '3 VALVES · 6 MINUTES'),
    });
  }
  // the goods lift: the cab standing at Level 2, its gate open, and him walking out of it into the Institute. (The ride
  // itself is not filmed: the owner on the first draft, "the eleveator is glitched in the video")
  shot(1, 'lift', {
    m: 'sneak',
    under: true,
    setup: async () => {
      g.bunker.setOpen(true, true);
      lightHands(0.8, 0.5);
      kit(['card_red', 'flashlight']);
      S.hold(null);
      gate('lift', true, 1800);
      // (the shared clock set so the cab has just come to Level 2 and stands there the whole shot: liftAt's own phases)
      const now = Date.now() / 1000;
      let want = 0;
      for (let k = 0; k < 4200; k++) {
        const L = liftAt(k / 100);
        if (L.stop === 2 && L.left < 11 && L.left > 10.9) { want = k / 100; break; }
      }
      g.net.clockOff = (want - now - 80 / 60) * 1000;
      // (out of the cab and up to the decon's glass doors, which he stops short of)
      const me = BW(2, CAB.r, CAB.back + 0.6), door = BW(2, 0, CAB.front + 1.2), on = BW(2, 0, CAB.front + 3.6, 1.3);
      S.me(me.x, me.z, yawTo(me, door), 0, me.y + 0.05);
      lay([me, door, on], { walk: true, stop: 0.3 });
      hand.set(P().yaw, 0);
      hand.look(-0.4, ahead(6), true, 0);
      await run(20);
      S.tap('KeyL');
      await run(60);
      say(`lift: cab ${JSON.stringify(g.lift?.cabFor?.(P().pos))}, me at ${P().pos.y.toFixed(2)} (level 2 ${BW(2, 0, 0).y.toFixed(2)})`);
    },
    tick: (t, _S, dt) => {
      legs();
      look(t, dt);
    },
    after: chipIn(BAR30, 'LEVEL 2', 'THE GOODS LIFT · THE LEVEL 2 KEYCARD'),
  });
  // Level 2's plant: the jerrycan poured, the plant turning over, the lamps coming up
  {
    const op = new Operator(BRACED, 3004, 48);
    let lens = V(0, 0, 0), aim = V(0, 0, 0);
    shot(1, 'plant', {
      m: 'sneak',
      hit: true,
      setup: async () => {
        g.bunker.setOpen(true, true);
        const pl = bunkerPlan(2).made.find((m) => m.kind === 'generator')!;
        aim = BW(2, pl.r, pl.f, 1.0);
        lens = BW(2, pl.r + 3.2, pl.f + pl.d / 2 + 4.2, 1.65);
        // (stood on the room's own floor, which is not the level's: the owner, "the player is gltiched through the ground")
        const me = BW(2, pl.r + 0.4, pl.f + pl.d / 2 + 0.75);
        me.y = ground.floorAt(me.x, me.z, me.y + 1.5);
        kit(['jerrycan', 'flashlight']);
        S.hold(null);
        S.me(me.x, me.z, yawTo(me, aim), 0, me.y);
        g.takeUp([...g.inv.carried()].find((i: Any) => i.id === 'jerrycan'));
        site('level2', 'idle');
        await run(60);
        op.reset(lens, aim);
      },
      tick: (t) => when(t, 0.7, 'on', () => site('level2', 'alarm', [], SITES.level2.hold)),
      cam: (t) => op.update(t, lens, aim),
      after: chipIn(BAR30, 'THE PLANT', 'FUEL IT · THE BLACK PASS'),
    });
  }
  // the Kupol: the last breaker thrown, the dish turning in its dome
  {
    const op = new Operator(BRACED, 3005, 52);
    const lens = V(DOME.x + 5.2, DOME.deck + 1.5, DOME.z + 2.4), aim = V(DOME.x, DOME.deck + 3.2, DOME.z);
    const lens2 = V(DOME.x + 3.9, DOME.deck + 1.45, DOME.z + 4.2);
    shot(1.5, 'kupol', {
      m: 'tight',
      hit: true,
      setup: async () => {
        kit([], {}, ['field_jacket', 'cargo_pants', 'hiking_boots', 'sack_pack']);
        S.me(DOME.x - 3.5, DOME.z - 3, 0, 0, DOME.deck + 0.05);
        site('kupol', 'alarm', [0, 1], SITES.kupol.hold);
        await run(40);
        site('kupol', 'spent', [0, 1, 2], SITES.kupol.again);
        await run(240);
        op.reset(lens, aim);
      },
      cam: (t) => op.update(t, lens.clone().lerp(lens2, t / (1.5 * BAR30)), aim),
      after: chipIn(1.5 * BAR30, 'THE KUPOL', '3 BREAKERS · 4 MINUTES'),
    });
  }

  // ============================================================ LEVEL 3
  // the train: stood on the wagon at full speed, the tunnel's lamps going by
  shot(2, 'train', {
    m: 'march',
    hit: true,
    setup: async () => {
      lightHands(0.9, 0.6);
      kit(['card_purple', 'flashlight']);
      S.hold(null);
      // (the shared clock set so the train is 20 s out of the Kupol, at speed, bound for Bunker 17)
      const want = RUN.dwell + Math.min(20, RUN_TIME / 3), now = Date.now() / 1000;
      g.net.clockOff = (want - now - 90 / 60) * 1000;
      const w = wagonAt(want - 90 / 60), n = wagonAt(want - 90 / 60 + 1);
      const dir = V(n.x - w.x, 0, n.z - w.z).normalize();
      const me = V(w.x, w.y + 1.45, w.z).addScaledVector(dir, -3.5);
      S.me(me.x, me.z, yawTo(me, me.clone().add(dir)), 0, me.y);
      await run(30);
      const p = P().pos as THREE.Vector3, w2 = wagonAt(Date.now() / 1000 + g.net.clockOff / 1000), n2 = wagonAt(Date.now() / 1000 + g.net.clockOff / 1000 + 1);
      const d2 = V(n2.x - w2.x, 0, n2.z - w2.z).normalize();
      S.me(w2.x - d2.x * 3.5, w2.z - d2.z * 3.5, Math.atan2(-d2.x, -d2.z), 0, w2.y + 1.45);
      await run(60);
      hand.set(P().yaw, -0.02);
      say(`train: me ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}; wagon ${w2.x.toFixed(1)},${w2.y.toFixed(1)},${w2.z.toFixed(1)}`);
    },
    tick: (t, _S, dt) => {
      const T = Date.now() / 1000 + g.net.clockOff / 1000, w = wagonAt(T), n = wagonAt(T + 2);
      hand.look(t, V(n.x, n.y + 2.2, n.z).addScaledVector(V(n.x - w.x, 0, n.z - w.z).normalize(), 30), true, 0.5);
      look(t, dt);
    },
    after: chipIn(2 * BAR30, 'THE TRAIN', 'THE KUPOL TO LEVEL 3 · A 2 KM LINE'),
  });
  // the great hall from the balcony: the round vault door rolling aside
  {
    const op = new Operator(BRACED, 3006, 36);
    let lens = V(0, 0, 0), lens2 = V(0, 0, 0), aim = V(0, 0, 0);
    shot(1.5, 'great-hall', {
      m: 'tour',
      hit: true,
      setup: async () => {
        g.bunker.setOpen(true, true);
        kit(['flashlight'], {}, ['field_jacket', 'cargo_pants', 'hiking_boots', 'sack_pack']);
        S.hold(null);
        const me = BW(3, -14.8, -24);
        S.me(me.x, me.z, 0, 0, me.y);
        site('vault', 'alarm', [], SITES.vault.hold);
        lens = BW(3, -12.6, -21.5, 1.7);
        lens2 = BW(3, -11.6, -18.8, 1.7);
        aim = BW(3, 0, VAULT_DOOR.f, VAULT_DOOR.y);
        await run(90);
        op.reset(lens, aim);
      },
      tick: (t) => {
        when(t, 0.1, 'roll', () => site('vault', 'spent', [], SITES.vault.again));
        when(t, 3.5, 'rolled', () => say(`vault door rolled ${(g.bunker.works?.roll ?? -1).toFixed(2)}, spent ${g.sites.spent('vault')}`));
      },
      cam: (t) => op.update(t, lens.clone().lerp(lens2, t / (1.5 * BAR30)), aim),
      after: chipIn(1.5 * BAR30, 'LEVEL 3', 'THE GREAT HALL'),
    });
  }
  // the vault: through the round door, the racks, and night vision taken from them: the picture goes green
  shot(1.5, 'vault', {
    m: 'tour',
    setup: async () => {
      g.bunker.setOpen(true, true);
      site('vault', 'spent', [], SITES.vault.again);
      lightHands(0.9, 0.6);
      kit(['flashlight', 'night_vision']);
      S.hold(null);
      const a = BW(3, 0, VAULT_DOOR.f - 3.5, -6.2), b = BW(3, 0, VAULT_DOOR.f + 6, -6.2);
      S.me(a.x, a.z, yawTo(a, b), 0, a.y + 0.05);
      lay([a, b], { walk: true, stop: 0.5 });
      hand.set(P().yaw, -0.05);
      hand.look(-0.4, ahead(8), true, 0);
      await run(330);
    },
    tick: (t, _S, dt) => {
      legs();
      look(t, dt);
      when(t, 1.0, 'side', () => hand.look(t, BW(3, -2.2, VAULT_DOOR.f + 5, -5), true, 0.3));
      when(t, 2.3, 'nv', () => S.tap('KeyN'));
    },
    after: chipIn(1.5 * BAR30, 'THE VAULT', 'NIGHT VISION · THE BEST GUNS'),
  });

  // ============================================================ GET IN
  // the six cards, the real things, laid on the great hall's floor with the round door behind them
  {
    const op = new Operator(BRACED, 3007, 40);
    const ids = ['keycard', 'card_blue', 'card_yellow', 'card_red', 'card_black', 'card_purple'];
    let row: THREE.Vector3[] = [], key: THREE.SpotLight | null = null;
    cleaners.push(() => { if (key) key.visible = false; });
    shot(2, 'cards', {
      m: 'end',
      hit: true,
      setup: async () => {
        g.bunker.setOpen(true, true);
        site('vault', 'spent', [], SITES.vault.again);
        kit([], {}, ['field_jacket', 'cargo_pants', 'hiking_boots', 'sack_pack']);
        const f0 = VAULT_DOOR.f - 4.2;
        row = ids.map((_, k) => {
          const p = BW(3, (2.5 - k) * 0.115, f0, -6.2);
          p.y = ground.floorAt(p.x, p.z, p.y + 0.5);
          return p;
        });
        S.clean();
        ids.forEach((id, k) => c.lie(id, row[k], bunker().rot + 0.12 * (k % 2 ? 1 : -1)));
        const me = BW(3, -6, f0 - 6, -6.2);
        S.me(me.x, me.z, 0, 0, me.y);
        if (!key) {
          key = new THREE.SpotLight(0xfff1dd, 8, 6, 0.6, 0.7, 1.4);
          g.s.r.scene.add(key, key.target);
        }
        key.visible = true;
        const mid = row[0].clone().lerp(row[5], 0.5);
        key.position.copy(mid).add(V(0, 2.2, 0)).addScaledVector(fwdOf(bunker().rot), 1.2);
        key.target.position.copy(mid);
        await run(60);
        op.reset(mid.clone().add(V(0, 0.22, 0)).addScaledVector(fwdOf(bunker().rot), 0.6), mid.clone().add(V(0, -0.05, 0)).addScaledVector(fwdOf(bunker().rot), -0.45));
      },
      cam: (t) => {
        // (from the hall side, low over the floor, the round door standing open behind the row)
        const mid = row[0].clone().lerp(row[5], 0.5), back = fwdOf(bunker().rot), k = t / (2 * BAR30);
        return op.update(t, mid.clone().add(V(0, 0.22 - 0.03 * k, 0)).addScaledVector(back, 0.6 - 0.1 * k).addScaledVector(rightOf(bunker().rot), 0.1 - 0.2 * k), mid.clone().add(V(0, -0.05, 0)).addScaledVector(back, -0.45));
      },
      after: (t) => show(chain, fade(t, 0.5, 2 * BAR30 - 0.1)),
    });
  }
  shot(2, 'end', {
    m: 'end',
    fadeOut: 0.4,
    setup: async () => {
      kit([]);
      const P0 = bunker();
      S.me(P0.x, P0.z, 0);
      await run(10);
    },
    cam: () => ({ p: V(GORODOK.x, 400, GORODOK.z), l: V(GORODOK.x, 0, GORODOK.z + 1), fov: 40 }),
    after: (t) => show(end, Math.min(1, t / 0.25)),
  });
  return at;
}
