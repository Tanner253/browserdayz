// The twenty-eighth film's last acts. THE RAID: night, three come for the house, each gun in turn; every man falls to a
// round that hit him. PAID: the tag off the body and the game's own clock, how it pays, and what it has paid: the
// figures read from the live record (the owner: "talk about how much paid out as well and the mechanic of how to earn").
// GET IN: the game's other sides, and the end card.
import * as THREE from 'three';
import { BRACED, ON_FOOT, Operator, pitchTo, yawTo } from './human';
import { BAR, DAWN, DUSK, GOLDEN, MORNING, NIGHT, SUNSET, V, ease, flat, fwdOf, rightOf, type Ctx } from './frame28';
import { Screen, frameUrl, loadReel, type Reel } from './footage';
import { CELL, STOREY } from '../sim/build/pieces';
import { TAG_HOLD, makeItem, tagClock } from '../sim/items';
import { TOWN } from '../world/worldgen';
import { inZona } from '../world/zona';
import { PAID } from './acts28-wild';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** the figures on the board, read from /api/cashins?format=total and format=status (read again before a take) */
export const LIVE = { sol: 10.06, tags: 849, usd: 960, since: '8 OCT', solUsd: 95.42 };
const GEAR = ['tactical_jacket', 'combat_trousers', 'rubber_boots', 'chest_rig', 'balaclava'];

export function actRaid(c: Ctx) {
  const { S, g, add, say, chipSay, run, kit, hand, look, eye, lightHands, ground, when, notes } = c;
  const { floorAt } = ground;
  const house = () => c.base!;
  /** the house standing, whole, however the film got here */
  const standing = () => {
    if (!c.base!.base) c.base!.begin(), c.base!.whole();
  };
  /** the player on a floor of the house (its solids are made only with somebody near them) */
  const upstairs = async (at: THREE.Vector3, yaw: number, pitch: number) => {
    S.me(at.x, at.z, yaw, pitch);
    await run(14);
    S.me(at.x, at.z, yaw, pitch, at.y);
    await run(10);
  };
  /** a man on the physics' ground, at a run toward a place */
  const runner = (a: Any, to: THREE.Vector3, v: number, dt: number) => {
    if (!a.alive) return;
    a.go(to.x, to.z, v, dt);
    a.pos.y = floorAt(a.pos.x, a.pos.z, a.pos.y + 0.6);
  };
  const three = () => [S.actor(0), S.actor(1), S.actor(2)];
  c.cleaners.push(() => { if (!c.keepBody.on) for (const a of S.actors) if (a.pos.y > -100) a.hide(); });

  // from behind them, across the dark to the house and its torches
  {
    const op = new Operator(ON_FOOT, 286, 44);
    let to = V(0, 0, 0);
    add(BAR * 1.5, {
      name: 'raiders',
      hour: SUNSET,
      m: 'march',
      fadeIn: 0.2,
      setup: async () => {
        standing();
        S.parkMe();
        const b = house();
        to = b.at(CELL, 0, CELL * 7);
        const [v, m] = [S.actor(0), S.actor(1)];
        const p0 = b.at(CELL * 0.5, 0, CELL * 12), p1 = b.at(CELL * 2.2, 0, CELL * 12.6);
        v.place(p0.x, p0.z, yawTo(p0, to), 'ak', GEAR);
        m.place(p1.x, p1.z, yawTo(p1, to), 'ak', GEAR);
        await run(40);
        const f = fwdOf(yawTo(p0, to));
        op.reset(p0.clone().addScaledVector(f, -5.5).setY(p0.y + 1.7), v.chest());
      },
      tick: (_t, _S, dt) => {
        runner(S.actor(0), to, 5.4, dt);
        runner(S.actor(1), to.clone().add(V(4, 0, 0)), 5.4, dt);
      },
      cam: (t) => {
        const a = S.actor(0), f = fwdOf(a.yaw), w = a.pos.clone().addScaledVector(f, -5.2).add(V(0.8, 0, 0));
        w.y = floorAt(w.x, w.z, a.pos.y) + 1.75;
        return op.update(t, w, a.pos.clone().addScaledVector(f, 7).setY(a.pos.y + 1.1));
      },
      after: (t) => chipSay(t, 0.3, BAR * 1.5 - 0.1, 'THEY WILL COME FOR IT', ''),
    });
  }
  // the top floor's window: the 9A-91, suppressed, down on the yard
  {
    let aim: Any = null;
    add(BAR * 2, {
      name: 'window',
      hud: true,
      hour: SUNSET,
      m: 'board',
      hit: true,
      setup: async () => {
        standing();
        lightHands(2.2, 1.6);
        notes(true);
        kit(['a91', ['ammo_739', 80]], { a91: ['a91_suppressor'] });
        S.hold('primary');
        const b = house(), me = b.at(CELL, STOREY, CELL * 2.5 - 0.75);
        await upstairs(me, 0, -0.2);
        for (const [k, a] of three().entries()) {
          const q = b.at(CELL * (0.1 + k * 0.9), 0, CELL * (9 + k * 0.7));
          a.place(q.x, q.z, yawTo(q, b.at(CELL, 0, CELL * 3)), 'ak', GEAR);
          a.pos.y = floorAt(q.x, q.z, q.y + 0.8);
          a.sprint = true;
        }
        await run(30);
        aim = S.actor(0);
        hand.set(yawTo(eye(), aim.chest()), pitchTo(eye(), aim.chest()));
        hand.look(-0.3, () => (aim.alive ? aim.chest() : aim.pos.clone()), true, 0);
        say(`from the window: sees them ${three().map((a) => ground.sees(eye(), a.chest())).join(' ')}`);
      },
      tick: (t, _S, dt) => {
        look(t, dt);
        const b = house();
        for (const a of three()) runner(a, b.at(CELL, 0, CELL * 5), 4.8, dt);
        S.key('Mouse2', true);
        S.key('Mouse0', (t > 0.7 && t < 1.05) || (t > 1.9 && t < 2.3) || (t > 3 && t < 3.3));
        if (aim && !aim.alive) {
          const n = three().find((a) => a.alive);
          if (n && n !== aim) {
            when(t, 0, `next${n.id}`, () => {
              S.feedKill('Sable', aim.name, '9A-91', flat(eye(), aim.pos));
              aim = n;
              hand.look(t, () => (n.alive ? n.chest() : n.pos.clone()), true, 0.1);
            });
          }
        }
      },
    });
  }
  // the door: over his shoulder in the front room, the Desert Eagle up, and one comes in at it
  {
    const op = new Operator(BRACED, 288, 46);
    let man: Any = null, way = V(0, 0, 0), lens = V(0, 0, 0);
    add(BAR * 1.5, {
      name: 'door',
      hour: SUNSET,
      m: 'board',
      hit: true,
      setup: async () => {
        standing();
        kit(['deagle', ['ammo_50', 21]]);
        S.hold('holster');
        const b = house(), me = b.at(CELL * 1.25, 0, CELL * 1.75), door = b.at(CELL, 0, CELL * 2.5);
        await upstairs(me, yawTo(me, door), 0);
        await c.dressedNow();
        man = S.actor(1);
        const q = b.at(CELL, 0, CELL * 3.3);
        way = b.at(CELL, 0, CELL * 2.42);
        man.place(q.x, q.z, yawTo(q, way), 'ak', GEAR);
        man.pos.y = floorAt(q.x, q.z, q.y + 0.8);
        const dp = [...b.base!.pieces.values()].find((p) => p.k === 'door_metal');
        if (dp && !dp.open) {
          dp.open = true;
          g.build.draw.put(b.base, dp);
          g.build.draw.swing(b.base!.id, dp.id);
        }
        await run(20);
        hand.set(yawTo(eye(), door.clone().setY(me.y + 1.3)), 0);
        hand.look(-0.2, () => (man.alive ? man.chest() : man.pos.clone()), true, 0);
        lens = b.at(CELL * 1.6, 1.5, CELL * 1.57);
        op.reset(lens, door.clone().setY(me.y + 1.2));
      },
      tick: (t, _S, dt) => {
        look(t, dt);
        runner(man, way, 4, dt);
        S.key('Mouse2', true);
        when(t, 0.55, 'one', () => S.tap('Mouse0', 60));
        when(t, 0.95, 'two', () => S.tap('Mouse0', 60));
        when(t, 1.35, 'three', () => S.tap('Mouse0', 60));
        when(t, 1.5, 'down', () => { if (man.alive) man.die(fwdOf(man.yaw)); });
      },
      cam: (t) => op.update(t, lens, eye().addScaledVector(fwdOf(c.P().yaw), 2).setY(eye().y - 0.25)),
    });
  }
  // the last of them runs for it: the Mosin, from the top floor
  {
    let man: Any = null, far = V(0, 0, 0);
    add(BAR * 2, {
      name: 'tower',
      hud: true,
      hour: DUSK,
      m: 'board',
      hit: true,
      setup: async () => {
        standing();
        notes(true);
        lightHands(2.2, 1.6);
        kit(['mosin', ['ammo_762', 10]], { mosin: ['pu_scope'] });
        S.hold('primary');
        const b = house(), me = b.at(CELL, STOREY, CELL * 2.5 - 0.75);
        await upstairs(me, 0, 0);
        man = S.actor(2);
        const q = b.at(CELL * 0.6, 0, CELL * 11);
        far = b.at(CELL * 1.8, 0, CELL * 30);
        man.place(q.x, q.z, yawTo(q, far), 'ak', GEAR);
        man.pos.y = floorAt(q.x, q.z, q.y + 0.8);
        await run(20);
        hand.set(yawTo(eye(), man.chest()), pitchTo(eye(), man.chest()));
        hand.look(-0.3, () => man.chest().add(fwdOf(man.yaw).multiplyScalar(0.6)), true, 0);
        say(`from the tower: ${flat(eye(), man.pos).toFixed(0)} m, sees him ${ground.sees(eye(), man.chest())}`);
      },
      tick: (t, _S, dt) => {
        look(t, dt);
        runner(man, far, 5.2, dt);
        S.key('Mouse2', true);
        when(t, 1.7, 'fire', () => S.tap('Mouse0', 80));
        when(t, 2.05, 'fell', () => {
          if (man.alive) man.die(fwdOf(man.yaw));
          S.feedKill('Sable', man.name, 'Mosin', flat(eye(), man.pos));
        });
      },
    });
  }
}

export function actPaid(c: Ctx) {
  const { S, g, add, say, chipSay, kit, hand, look, eye, lightHands, P, ground, notes, piece, show, run } = c;
  const { floorAt } = ground;
  const house = () => c.base!;
  const standing = () => {
    if (!c.base!.base) c.base!.begin(), c.base!.whole();
  };
  /** Volkov's tag, as it is taken off him: the game's own clock starts on it */
  const tag = (held: number) => {
    const it = makeItem('dogtag') as Any;
    it.owner = 'Volkov';
    it.pid = 'film-volkov';
    it.holder = undefined;
    g.inv.add(it);
    g.tickTags(0);
    it.held = held;
    g.inventoryChanged();
    return it;
  };
  /** the tag's clock as the game keeps it, large; and what it pays */
  const big = piece('x28-clock', '<i>STAY ALIVE</i><b></b>');
  const clockOf = (t: number, from: number, to: number, end = false) => {
    const it = g.inv.find((q: Any) => q.id === 'dogtag') as Any;
    show(big, t >= from && t <= to && (!!it || end) ? 1 : 0);
    if (it) big.querySelector('b')!.textContent = tagClock(it);
    else if (end) {
      big.querySelector('i')!.textContent = 'CASHED IN';
      big.querySelector('b')!.textContent = '+0.01 SOL';
    }
  };
  c.cleaners.push(() => {
    big.style.display = 'none';
    big.querySelector('i')!.textContent = 'STAY ALIVE';
  });
  // the Zona: a rival in Kamenka's street, the shot, the tag off him, and twenty minutes on the hospital's roof. (Not at
  // the house: a kill on claimed land leaves no tag.)
  const K = (along: number, side = 0) => {
    const [sx, sz] = TOWN.street;
    return V(TOWN.x + sx * along - sz * side, 0, TOWN.z + sz * along + sx * side);
  };
  let rival: Any = null;
  add(BAR * 2, {
    name: 'zona-kill',
    hud: true,
    hour: GOLDEN,
    m: 'sting',
    hit: true,
    setup: async () => {
      c.keepBody.on = true;
      notes(true);
      lightHands();
      kit(['ak', ['ammo_762', 60]]);
      S.hold('primary');
      const me = K(-24);
      me.y = floorAt(me.x, me.z);
      S.me(me.x, me.z, yawTo(me, K(0)), 0, me.y);
      rival = S.actor(0);
      const q = K(-8, -7), to = K(-6, 9);
      rival.place(q.x, q.z, yawTo(q, to), 'ak', GEAR);
      rival.pos.y = floorAt(q.x, q.z, me.y + 0.8);
      rival.to = to;
      await run(24);
      hand.set(yawTo(eye(), rival.chest()), pitchTo(eye(), rival.chest()));
      hand.look(-0.3, () => rival.chest().add(fwdOf(rival.yaw).multiplyScalar(0.4)), true, 0);
      say(`in the Zona: ${inZona(me.x, me.z)}, ${inZona(q.x, q.z)}; sees him ${ground.sees(eye(), rival.chest())}`);
    },
    tick: (t, _S, dt) => {
      look(t, dt);
      if (rival.alive) {
        rival.go(rival.to.x, rival.to.z, 4.8, dt);
        rival.pos.y = floorAt(rival.pos.x, rival.pos.z, rival.pos.y + 0.6);
      }
      S.key('Mouse0', t > 1.2 && t < 1.8 && rival.alive);
      c.when(t, 2.05, 'fell', () => {
        if (rival.alive) rival.die(fwdOf(rival.yaw));
        S.feedKill('Sable', rival.name, 'AK', flat(eye(), rival.pos));
      });
    },
    after: (t) => chipSay(t, 0.25, 1.5, 'THE ZONA', 'WHERE A TAG IS WORTH SOL'),
  });
  add(BAR * 1.5, {
    name: 'tag',
    hud: true,
    hour: GOLDEN,
    m: 'sting',
    under: true,
    setup: async () => {
      c.keepBody.on = false;
      notes(true);
      lightHands(2, 1.4);
      kit(['ak']);
      S.hold(null);
      const q = rival.pos.clone() as THREE.Vector3, f = fwdOf(rival.yaw), s = rightOf(rival.yaw);
      const me = q.clone().addScaledVector(f, -1.3).addScaledVector(s, 1.2);
      me.y = floorAt(me.x, me.z, q.y + 0.8);
      S.me(me.x, me.z, yawTo(me, q), -0.5, me.y);
      await run(20);
      hand.set(yawTo(eye(), q), pitchTo(eye(), q.clone().setY(q.y + 0.2)));
    },
    tick: (t, _S, dt) => {
      look(t, dt);
      c.when(t, 0.9, 'taken', () => tag(0));
    },
    after: (t) => clockOf(t, 1, 9),
  });
  /** on the hill over the town: the lens beside him, the town below (the two shots of the wait). Ground with a clear view found by the trees' own places: a ray finds trunks, not boughs */
  let top: THREE.Vector3 | null = null;
  const onRoof = async (held: number) => {
    notes(true);
    const town = V(TOWN.x, S.ground(TOWN.x, TOWN.z) + 3, TOWN.z);
    if (!top) {
      const trunks = ((S.world.trees ?? []) as { kind: string; x: number; z: number }[]).filter((q) => !q.kind.startsWith('bush') && Math.hypot(q.x - TOWN.x, q.z - TOWN.z) < 260);
      let best = -1;
      for (let a = 0; a < 6.28; a += 0.1) {
        for (let r = 110; r <= 220; r += 10) {
          const x = TOWN.x + Math.cos(a) * r, z = TOWN.z + Math.sin(a) * r, h = S.ground(x, z), rise = h - town.y;
          if (rise < 8 || rise > 50 || !inZona(x, z)) continue;
          const d = town.clone().sub(V(x, 0, z)).setY(0).normalize();
          let room = 1e9;
          for (let k = -6; k <= 60; k += 3) {
            const px = x + d.x * k, pz = z + d.z * k;
            for (const q of trunks) room = Math.min(room, Math.hypot(q.x - px, q.z - pz));
            if (room < 3.5) break;
          }
          if (room < 3.5) continue;
          const eye0 = V(x, h + 1.3, z);
          if (!ground.sees(eye0, town)) continue;
          const score = room + Math.min(rise, 25) * 0.4;
          if (score > best) {
            best = score;
            top = V(x, h, z);
          }
        }
      }
      if (!top) throw new Error('no hill over the town');
      say(`the hill: ${top.x.toFixed(0)},${top.z.toFixed(0)}, ${(top.y - town.y).toFixed(0)} m over the town, score ${best.toFixed(1)}`);
      kit(['ak']);
      S.hold('primary');
      tag(held);
      S.me(top.x, top.z, yawTo(top, town), -0.1, floorAt(top.x, top.z, top.y));
      P().setCrouch(true);
      await c.dressedNow();
    } else {
      const it = g.inv.find((q: Any) => q.id === 'dogtag') as Any;
      if (it) it.held = held;
      S.me(top.x, top.z, yawTo(top, town), -0.1, floorAt(top.x, top.z, top.y));
      P().setCrouch(true);
    }
    hand.set(P().yaw, -0.1);
    await run(16);
  };
  const beside = () => {
    const f = fwdOf(P().yaw), s = rightOf(P().yaw), p = P().pos as THREE.Vector3;
    return { p: p.clone().addScaledVector(f, -2.7).addScaledVector(s, 1.2).add(V(0, 1.35, 0)), l: V(TOWN.x, S.ground(TOWN.x, TOWN.z) + 6, TOWN.z), fov: 46 };
  };
  add(BAR, {
    name: 'hold',
    hud: true,
    hour: DUSK,
    m: 'sting',
    under: true,
    setup: () => onRoof(TAG_HOLD - 700),
    tick: (t, _S, dt) => look(t, dt),
    cam: beside,
    after: (t) => clockOf(t, 0, 9),
  });
  add(BAR * 1.5, {
    name: 'cashed',
    hud: true,
    hour: DAWN + 0.02,
    m: 'sting',
    setup: () => onRoof(TAG_HOLD - 1.2),
    tick: (t, _S, dt) => look(t, dt),
    cam: beside,
    after: (t) => clockOf(t, 0, 9, true),
  });
  // the board: how it pays, and what it has paid
  const steps = piece('x28-steps', ['DROP IN', 'LOOT', 'TAKE A TAG', 'HOLD 20:00', 'CASH IN'].map((w, k) => `<div><i>${k + 1}</i><b>${w}</b></div>`).join(''));
  const paid = piece('x28-paid', `<h6>PAID TO PLAYERS, ON CHAIN</h6><b>0.00 SOL</b><p><span><u>${LIVE.tags}</u> DOG TAGS PAID</span><span><u>≈ $${LIVE.usd}</u> AT TODAY'S PRICE</span><span><u>SINCE ${LIVE.since}</u></span></p><small>0.01 SOL A TAG, UP TO 0.025 HOLDING $ZONA · 5 TAGS A WALLET IN 24 HOURS · PAST 10 TAGS, HOLD 350,000 $ZONA · TAGS COUNT ONLY INSIDE THE ZONA</small>`);
  c.cleaners.push(() => { steps.style.display = paid.style.display = 'none'; });
  const backdrop = (name: string, len: number, after: (t: number) => void) => add(len, {
    name,
    hour: MORNING,
    m: 'paid',
    hit: name === 'board-paid',
    setup: () => {
      standing();
      S.parkMe();
      steps.style.display = paid.style.display = 'none';
    },
    cam: (t) => {
      const b = house(), mid = b.at(CELL * 1.5, 4, CELL);
      const a = 3.6 + (name === 'board-paid' ? 0.5 : 0) + t * 0.05;
      return { p: mid.clone().add(V(Math.cos(a) * 34, 12 + t * 0.2, Math.sin(a) * 34)), l: mid, fov: 44 };
    },
    after,
  });
  backdrop('board-steps', BAR * 2, (t) => {
    show(steps, Math.min(ease(t / 0.2), ease((BAR * 2 - t) / 0.2)));
    steps.querySelectorAll('div').forEach((d, k) => d.classList.toggle('on', t > 0.15 + k * 0.56));
  });
  backdrop('board-paid', BAR * 3, (t) => {
    show(paid, Math.min(ease(t / 0.2), ease((BAR * 3 - t) / 0.25)));
    const u = 1 - Math.pow(1 - Math.min(1, t / 1.8), 3);
    paid.querySelector('b')!.textContent = `${(LIVE.sol * u).toFixed(2)} SOL`;
  });
  void BRACED; void PAID; void NIGHT;
}

export function actGetIn(c: Ctx) {
  const { S, g, add, piece, show, chipSay, drive, say, overlay, run, cleaners } = c;
  // the battle royale, a second and a half of the twenty-seventh film's real match
  const screen = new Screen(overlay, 'x26-reel');
  S.onFrame = () => screen.settled();
  let reel: Reel | null = null;
  const onScreen = (name: string, big: string, small: string, from: number, len: number) => add(len, {
    name,
    hour: 0.5,
    m: 'board',
    setup: async () => {
      S.parkMe();
      reel = reel ?? await loadReel('br27');
    },
    tick: (t) => {
      if (reel) screen.show(frameUrl(reel, from + t));
    },
    after: (t) => chipSay(t, 0.05, len - 0.04, big, small),
  });
  cleaners.push(() => screen.hide());
  let lensT = V(0, 0, 0), lookT = V(0, 0, 0);
  const floorAt0 = (q: THREE.Vector3) => c.ground.floorAt(q.x, q.z, q.y + 1);
  // the road: a jeep, driven
  add(BAR, {
    name: 'road',
    hud: false,
    hour: GOLDEN,
    m: 'board',
    setup: async () => {
      const R = drive.R(-1700, 40);
      drive.putJeep(R, 11);
      drive.board();
      drive.cruise = 15;
      await run(10);
    },
    tick: () => drive.wheel(),
    after: (t) => chipSay(t, 0.05, BAR - 0.04, 'DRIVE', ''),
  });
  // a trader's stall: the camp where nobody shoots
  add(BAR, {
    name: 'trader',
    hour: GOLDEN,
    m: 'board',
    setup: async () => {
      const st = g.traders.stands[0] as Any;
      const at = st.pos.clone() as THREE.Vector3, f = fwdOf(st.yaw ?? 0);
      const me = at.clone().addScaledVector(f, 6.5);
      S.me(me.x, me.z, yawTo(me, at), 0, floorAt0(me));
      await run(90);
      lensT = at.clone().addScaledVector(f, 3.6).add(V(0.5, 1.5, 0.5));
      lookT = at.clone().add(V(0, 1.3, 0));
    },
    cam: (t) => ({ p: lensT.clone().add(V(0, 0, t * 0.05)), l: lookT, fov: 44 }),
    after: (t) => chipSay(t, 0.05, BAR - 0.04, 'TRADE', 'TRADERS · RECYCLERS · NO-FIGHT CAMPS'),
  });
  onScreen('br-1', 'BATTLE ROYALE', 'AND THE ARENA, ON ONE PAGE', 6, BAR);
  // the end card
  const end = piece('x28-end', `<img src="/brand/zona-mark.svg" alt=""><b>ZONA</b><u>KEEP WHAT YOU KILL</u><h5>FREE · PLAYS IN YOUR BROWSER · NO DOWNLOAD</h5><em>WWW.ZONAPVP.FUN</em>`);
  add(BAR * 2.5, {
    name: 'end',
    hour: SUNSET,
    m: 'end',
    hit: true,
    fadeOut: 0.5,
    setup: () => {
      S.parkMe();
      end.style.display = 'none';
    },
    cam: (t) => {
      const q = S.at(537, -371, 0), a = 1.1 + t * 0.03;
      return { p: q.clone().add(V(Math.cos(a) * 150, 95, Math.sin(a) * 150)), l: q, fov: 42 };
    },
    after: (t) => show(end, ease(t / 0.4)),
  });
  void g; void say;
}
