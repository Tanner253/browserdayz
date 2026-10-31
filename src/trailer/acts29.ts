// The twenty-ninth film's shots, "Friendly" (shots29.ts). Every cut is on a bar. The cast are the film's stand-in players,
// dancing by the pose flags as any player's copy does; he is the player himself wherever an animal or the infected have
// to want him, since their minds look for a player. The gag of the genre: everybody says friendly. Nobody is.
import * as THREE from 'three';
import { yawTo } from './human';
import { AFTERNOON, DAWN, GOLDEN, MORNING, NOON, SUNSET, V, ease, fwdOf, rightOf, type Ctx } from './frame28';
import { Base28 } from './base28';
import { BAR29, BEAT29 } from './music29';
import { EMOTE, EMOTE_SHIFT } from '../sim/emotes';
import { CELL } from '../sim/build/pieces';
import { setWheelSlots } from '../ui/wheel-slots';
import { TOWN, SEA_LEVEL } from '../world/worldgen';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** seconds into the song of a bar and a beat of it */
export const B = (bar: number, beat = 0) => (bar + beat / 4) * BAR29;

/** what he has on: the shirt the beach gave him. And what the man who shoots him has on */
const HERO = ['tshirt~4', 'jeans', 'trainers'];
const STRANGER = ['field_jacket', 'cargo_pants', 'hiking_boots', 'sack_pack', 'gasmask'];
const CROWD: string[][] = [
  ['hoodie', 'jeans', 'trainers', 'boonie_hat'],
  ['field_jacket', 'cargo_pants', 'hiking_boots', 'life_vest'],
  ['tshirt', 'cargo_pants', 'hiking_boots', 'sack_pack'],
  ['hoodie', 'cargo_pants', 'trainers', 'gasmask'],
  ['field_jacket', 'jeans', 'hiking_boots', 'boonie_hat', 'sack_pack'],
  ['tshirt', 'jeans', 'trainers', 'life_vest'],
];
/** Pokrov's lane, its middle */
const LANE = 34.5;
/** the meadow of the film before */
const FIELD = V(-1032, 0, -374);
/** the hill over Kamenka */
const HILL = V(690, 0, 466);

export function shots29(c: Ctx) {
  const { S, g, add, P, say, run, kit, when, piece, show, overlay, cleaners, keepStood, keepZeds, infected, ground } = c;
  const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const A = (i: number) => S.actors[i];
  const herd = () => g.wild.herd as Any;

  // ------------------------------------------------------------ the words
  const line = piece('x29-line', '<b></b>'), big = piece('x29-big', '<b></b>'), dead = piece('x29-dead', '<b>YOU ARE DEAD</b><i></i>');
  const end = piece('x28-end', '<img src="/brand/zona-mark.svg" alt=""><b>ZONA</b><u>FRIENDLY</u><h5>FREE · PLAYS IN YOUR BROWSER · NO DOWNLOAD</h5><em>WWW.ZONAPVP.FUN</em>');
  const flash = piece('x29-flash'), cut = piece('x29-cut', '<b>TRUST NOBODY.</b><i>WWW.ZONAPVP.FUN · PLAY FREE</i>');
  piece('x29-mark', 'ZONA · ZONAPVP.FUN').style.display = '';
  const says = [piece('x29-say', '<span></span>'), piece('x29-say', '<span></span>')];
  void overlay;
  /** what is sung, from where in the song to where */
  const LYRICS: [number, number, string][] = [
    [B(0, 0), B(0, 3), 'DAY ONE.'], [B(0, 3), B(1, 2), 'NO GUN.'], [B(1, 2), B(2, 1), 'NO FOOD.'], [B(2, 1), B(3, 0), 'NO FRIENDS.'], [B(3, 0), B(4, 0), 'BUT I HAVE MOVES.'],
    [B(12), B(13), 'HELLO, DEER.'], [B(13), B(14), 'DEER IS GONE.'],
    [B(14), B(15), 'HELLO, WOLF.'], [B(15), B(16), 'WOLF BRINGS FAMILY.'],
    [B(16), B(17), 'HELLO, BEAR.'], [B(17), B(18), 'BEAR DOES NOT DANCE.'],
    [B(18), B(19), 'HELLO, DEAD MAN.'], [B(19), B(20), 'DEAD MAN WANTS HUG.'],
    [B(28), B(29, 1), 'SO I BUILD HOUSE.'], [B(29, 1), B(30, 1), 'I BUILD DOOR.'], [B(30, 1), B(31), 'I BUILD WALL.'], [B(31), B(32), 'I GET GUN.'],
    [B(33, 1), B(34), 'I KNOW.'],
  ];
  /** the hook, shouted: the words as big as the phone will take them */
  const SHOUT: [number, number, string][] = [];
  for (const h of [4, 20, 34]) {
    for (let i = 0; i < (h === 34 ? 4 : 8); i++) {
      const b = h + i;
      if (i % 2 === 0) SHOUT.push([B(b, 0), B(b, 2), 'FRIENDLY!'], [B(b, 2), B(b + 1), 'FRIENDLY!']);
      else SHOUT.push([B(b, 0), B(b + 1), i % 4 === 1 ? "DON'T SHOOT!" : "I'M FRIENDLY!"]);
    }
  }
  const words = (T: number) => {
    const hushed = (T >= B(11, 1) && T < B(12)) || (T >= B(26) && T < B(27));
    const l = LYRICS.find(([a, b]) => T >= a && T < b), s = hushed ? undefined : SHOUT.find(([a, b]) => T >= a && T < b);
    line.style.display = l ? '' : 'none';
    big.style.display = s ? '' : 'none';
    if (l) line.querySelector('b')!.textContent = l[2];
    if (s) {
      const el = big.querySelector('b')!;
      el.textContent = s[2];
      // (each shout lands: a little too big, and settles)
      el.style.transform = `scale(${(1 + 0.16 * Math.exp(-(T - s[0]) * 14)).toFixed(3)})`;
    }
  };
  /** words over somebody's head, as the game puts them there (`hud.say`): said here since most of these shots have no HUD */
  const head = new THREE.Vector3();
  const over = (k: number, who: THREE.Vector3, text: string) => {
    const el = says[k], cam = g.s.r.camera as THREE.PerspectiveCamera;
    head.copy(who).add(V(0, 2.05, 0)).project(cam);
    el.style.display = '';
    el.style.left = `${Math.min(84, Math.max(16, (head.x * 0.5 + 0.5) * 100)).toFixed(2)}%`;
    el.style.top = `${Math.max(31, (0.5 - head.y * 0.5) * 100).toFixed(2)}%`;
    el.firstElementChild!.textContent = text;
  };

  // ------------------------------------------------------------ the people
  // (every body its own, and him the player's: left alone they are all in the suit, which nothing can be worn over)
  c.dressers.push(async () => {
    S.actors.forEach((a: Any, i: number) => a.rp.avatar.wardrobe.setBody(i ? i % 4 : g.avatar.wardrobe.body));
    for (const a of S.actors) await (a.rp.avatar as Any).wardrobe.ready();
  });
  const dance = (a: Any, id: string) => {
    a.dance = true;
    a.more = (EMOTE[id].n ?? 0) << EMOTE_SHIFT;
  };
  const rest = (a: Any) => {
    a.dance = false;
    a.more = 0;
  };
  const stand = (i: number, x: number, z: number, yaw: number, gear: string[], weapon: string | null = null) => {
    const a = A(i);
    a.place(x, z, yaw, weapon, gear);
    return a;
  };
  const faceTo = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
  /** down, by somebody's gun: the blood, the fall */
  const shot = (a: Any, from: THREE.Vector3) => {
    const d = a.chest().sub(from).normalize();
    a.hurt(300, d, false);
  };
  /** a crack from a gun nobody sees: heard, and gone over the roofs */
  const distant = (who: Any) => who.fireAt(V(who.pos.x, who.pos.y + 60, who.pos.z + 30), 0);
  const heroWear = (guns: (string | [string, number])[] = []) => kit(guns, {}, ['tshirt', 'jeans', 'trainers']);

  // ------------------------------------------------------------ a shot, in bars
  let bar = 0;
  const part = (bars: number, name: string, s: { hour?: number; hud?: boolean; setup?: () => Promise<void> | void; tick?: (t: number, dt: number) => void; cam?: (t: number) => { p: THREE.Vector3; l: THREE.Vector3; fov?: number }; after?: (t: number) => void; chain?: boolean }) => {
    const from = bar * BAR29;
    bar += bars;
    add(bars * BAR29, {
      name,
      m: 'card',
      hud: s.hud,
      hour: s.hour,
      chain: s.chain,
      setup: async () => {
        if (!s.chain) for (const a of S.actors) a.hide();
        g.setHold(null);
        await s.setup?.();
      },
      tick: (t: number, _S: unknown, dt: number) => {
        P().vitals.health = 100;
        P().vitals.bleeding = false;
        s.tick?.(t, dt);
      },
      cam: s.cam,
      after: (t: number) => {
        for (const e of says) e.style.display = 'none';
        words(from + t);
        s.after?.(t);
      },
    } as Any);
  };
  /** round a place, so far off and so high, at so many radians */
  const orbit = (mid: THREE.Vector3, r: number, h: number, a: number, fov = 30, look = 1.05) => ({ p: mid.clone().add(V(Math.sin(a) * r, h, Math.cos(a) * r)), l: mid.clone().add(V(0, look, 0)), fov });

  // ------------------------------------------------------------ the beach
  let H = V(0, 0, 0), E = V(1, 0, 0);
  const beach = () => {
    const z = -378;
    let x = -3640;
    while (S.ground(x, z) > SEA_LEVEL - 0.3 && x > -3836) x -= 1;
    H = S.at(x + 12, z, 0);
    E = V(1, 0, 0);
    return H;
  };
  part(3, 'coast', {
    hour: DAWN,
    setup: async () => {
      beach();
      heroWear();
      S.hold(null);
      S.me(H.x + 24, H.z, 0);
      stand(0, H.x, H.z, faceTo(H, H.clone().addScaledVector(E, 5)), HERO);
      await c.dressedNow();
      await run(120);
    },
    cam: (t) => orbit(H, 6.4 - 1.8 * ease(t / (3 * BAR29)), 0.75, Math.PI / 2 + 0.12, 26, 1.0),
  });
  part(1, 'wheel', {
    hud: true,
    setup: async () => {
      setWheelSlots(['hey', 'friendly', 'yes', 'no', 'balloon', 'surrender', 'follow', 'help', 'here', 'thanks', 'wait', 'enemy', 'loot', 'sit', 'medic']);
      S.me(H.x, H.z, -Math.PI / 2, -0.04);
      await run(10);
    },
    tick: (t) => {
      // the game's own wheel on T, the mouse going to the dance
      const u = ease((t - 0.25) / 0.5), wedge = 4;
      const a = (wedge / 8) * Math.PI * 2;
      g.hud.wheel(true, t > 0.45 ? wedge : -1, [Math.sin(a) * 90 * u, -Math.cos(a) * 90 * u], null, '', false);
    },
    after: (t) => { if (t > BAR29 - 0.05) g.hud.wheel(false); },
  });

  // ------------------------------------------------------------ the first hook: a man with a gun, on the road up from the sand
  part(2, 'hook1', {
    hour: MORNING,
    setup: async () => {
      S.hold(null);
      S.me(H.x + 30, H.z + 6, 0);
      const a = stand(0, H.x, H.z, faceTo(H, H.clone().addScaledVector(E, 5)), HERO);
      dance(a, 'balloon');
      await run(40);
      flash.style.display = '';
    },
    cam: (t) => orbit(H, 4.6 - 1 * ease(t / (2 * BAR29)), 0.5 + 0.2 * Math.sin(t), 1.2 + 0.5 * t / (2 * BAR29), 28, 1.0),
    after: (t) => { flash.style.opacity = Math.max(0, 1 - t / 0.18).toFixed(3); },
  });
  {
    const walk = { x: 0, z: 0 };
    part(2, 'stranger', {
      setup: async () => {
        const a = stand(0, H.x, H.z, faceTo(H, H.clone().addScaledVector(E, 5)), HERO);
        dance(a, 'balloon');
        const s = H.clone().addScaledVector(E, 15).add(V(0, 0, 0.8));
        stand(1, s.x, s.z, faceTo(s, H), STRANGER, 'ak');
        walk.x = s.x;
        walk.z = s.z;
        S.me(s.x + 12, s.z, 0);
        await c.dressedNow();
      },
      tick: (t, dt) => {
        const b = A(1);
        b.go(H.x + E.x * 3, H.z + 0.4, 2.8, dt);
        void t;
      },
      cam: () => {
        const b = A(1), p = b.pos as THREE.Vector3, f = fwdOf(b.yaw), r = rightOf(b.yaw);
        return { p: p.clone().addScaledVector(f, -3.3).addScaledVector(r, 0.42).add(V(0, 1.6, 0)), l: H.clone().add(V(0, 1.0, 0)), fov: 26 };
      },
    });
  }
  const close = () => {
    const mid = H.clone().addScaledVector(E, 0.95), r = V(0, 0, 1);
    return { mid, r };
  };
  part(2, 'meet', {
    setup: async () => {
      const a = stand(0, H.x, H.z, faceTo(H, H.clone().addScaledVector(E, 1.9)), HERO);
      const s = H.clone().addScaledVector(E, 1.9);
      const b = stand(1, s.x, s.z, faceTo(s, H), STRANGER, 'ak');
      a.rp.avatar.emote('palms', 1.7);
      void b;
      S.me(H.x + 14, H.z + 8, 0);
      await run(6);
    },
    tick: (t) => {
      when(t, BAR29, 'gun-away', () => {
        A(1).rp.setWeapon(null, []);
        dance(A(1), 'shuffle');
      });
      when(t, BAR29 + BEAT29, 'he-dances', () => dance(A(0), 'balloon'));
    },
    cam: (t) => orbit(close().mid, 4.7 - 0.4 * ease(t / (2 * BAR29)), 0.55, 0.2, 30, 1.0),
    after: (t) => {
      if (t < BAR29 - 0.1) over(0, A(0).pos, 'FRIENDLY!');
      else if (t < BAR29 * 2 - 0.3) over(1, A(1).pos, 'FRIENDLY!');
    },
  });
  part(1, 'both', {
    setup: async () => {
      const a = stand(0, H.x, H.z, faceTo(H, H.clone().addScaledVector(E, 1.9)), HERO);
      const s = H.clone().addScaledVector(E, 1.9);
      const b = stand(1, s.x, s.z, faceTo(s, H), STRANGER);
      dance(a, 'balloon');
      dance(b, 'shuffle');
      await run(30);
    },
    cam: (t) => orbit(close().mid, 4.6, 1.5, 1.9 + 0.08 * t, 36, 0.95),
  });
  part(1, 'bang1', {
    setup: async () => {
      const a = stand(0, H.x, H.z, faceTo(H, H.clone().addScaledVector(E, 1.9)), HERO);
      const s = H.clone().addScaledVector(E, 1.9);
      const b = stand(1, s.x, s.z, faceTo(s, H), STRANGER, 'ak');
      dance(a, 'balloon');
      b.aim = true;
      b.face(a.chest());
      await run(24);
    },
    tick: (t) => {
      when(t, BEAT29, 'fire', () => {
        const b = A(1), a = A(0);
        b.fireAt(a.chest(), 0);
        rest(a);
        shot(a, b.eye());
      });
    },
    cam: () => {
      const b = A(1), f = fwdOf(b.yaw), r = rightOf(b.yaw);
      return { p: b.pos.clone().addScaledVector(f, -1.5).addScaledVector(r, 0.62).add(V(0, 1.5, 0)), l: A(0).pos.clone().add(V(0, 0.75, 0)), fov: 30 };
    },
    after: (t) => {
      const on = t >= BEAT29;
      dead.style.display = on ? '' : 'none';
      if (on) {
        dead.querySelector('i')!.textContent = `TIME ALIVE ${clock(B(11, 1))}`;
        dead.style.opacity = Math.min(1, (t - BEAT29) / 0.06).toFixed(3);
      }
      if (t > BAR29 - 0.04) dead.style.display = 'none';
    },
  });

  // ------------------------------------------------------------ the verse: he tries the animals
  const stood: number[] = [];
  const beasts = (id: string, x: number, z: number, n: number) => {
    const out = herd().place(id, x, z, Date.now(), n) as Any[];
    stood.push(...out.map((b) => b.i));
    return out;
  };
  const seen = async (ids: Any[]) => {
    for (let k = 0; k < 500; k++) {
      await run(6);
      await c.wait(15);
      if (ids.every((b) => (g.wild.beasts.get(b.i) as Any)?.model)) return;
    }
    say(`not all of ${ids.length} animals were drawn`);
  };
  cleaners.push(() => {
    if (keepStood.on) return;
    for (const i of stood) herd()?.remove(i);
    stood.length = 0;
  });
  // Deer: they feed until they hear something, so nobody near but him, and he is the one kind of player they do not fear
  {
    let deer: Any[] = [], me = V(0, 0, 0), mid = V(0, 0, 0);
    part(2, 'deer', {
      hour: MORNING,
      setup: async () => {
        heroWear();
        S.hold(null);
        S.me(FIELD.x - 330, FIELD.z, 0, 0);
        stand(0, FIELD.x - 322, FIELD.z, 0, HERO);
        await c.dressedNow();
        deer = beasts('stag', FIELD.x + 8, FIELD.z - 3, 6);
        await seen(deer);
        await run(40);
        const live = deer.map((b) => herd().beasts.get(b.i)).filter(Boolean) as Any[];
        mid = S.at(live.reduce((s, b) => s + b.x, 0) / live.length, live.reduce((s, b) => s + b.z, 0) / live.length, 0);
        me = S.at(mid.x - 17, mid.z + 1, 0);
        stand(0, me.x, me.z, faceTo(me, mid), HERO);
        say(`the deer: ${live.length} round ${mid.x.toFixed(0)},${mid.z.toFixed(0)}`);
      },
      tick: (t) => {
        when(t, 0.1, 'wave', () => A(0).rp.avatar.emote('wave', 1.5));
        when(t, BAR29 - 0.12, 'bolt', () => g.wild.heard(me.x, me.z, [900, 2000]));
      },
      cam: (t) => ({ p: me.clone().add(V(-3.4 + 0.2 * t, 1.45, 0.55)), l: mid.clone().add(V(0, 0.9, 0)), fov: 22 }),
    });
  }
  // Wolf: one, and then the rest of them
  {
    let me = V(0, 0, 0);
    part(2, 'wolf', {
      hour: NOON,
      setup: async () => {
        S.clean();
        heroWear();
        S.hold(null);
        me = S.at(FIELD.x, FIELD.z, 0);
        S.me(me.x, me.z, -Math.PI / 2, 0);
        const near = beasts('wolf', me.x + 12, me.z - 1, 1);
        await seen(near);
        const pack = beasts('wolf', me.x + 26, me.z + 2, 5);
        await seen(pack);
        await run(12);
        g.calledAt = 0;
        g.emote('hey');
      },
      cam: () => ({ p: me.clone().add(V(-4.2, 2.3, 1.4)), l: me.clone().add(V(10, 0.5, -0.4)), fov: 30 }),
    });
  }
  // Bear: he dances for it
  {
    let me = V(0, 0, 0);
    part(2, 'bear', {
      hour: NOON,
      setup: async () => {
        S.clean();
        heroWear();
        S.hold(null);
        me = S.at(FIELD.x - 14, FIELD.z, 0);
        S.me(me.x, me.z, -Math.PI / 2, 0);
        const out = beasts('bear', me.x + 15, me.z - 1, 1);
        await seen(out);
        await run(30);
        g.setHold('dance', 'jaguar');
        await run(10);
      },
      cam: () => ({ p: me.clone().add(V(-3.6, 1.5, 1.2)), l: me.clone().add(V(8, 1.0, -0.2)), fov: 30 }),
    });
  }
  // The dead: Kamenka's street, the hospital's own, and his arms open
  {
    const K = (a: number, side = 0) => {
      const [sx, sz] = TOWN.street;
      return V(TOWN.x + sx * a - sz * side, 0, TOWN.z + sz * a + sx * side);
    };
    let me = V(0, 0, 0);
    part(2, 'hug', {
      hour: AFTERNOON,
      setup: async () => {
        S.clean();
        keepZeds.on = false;
        heroWear();
        S.hold(null);
        me = K(-16);
        me.y = ground.floorAt(me.x, me.z);
        S.me(me.x, me.z, yawTo(me, K(10)), 0, me.y);
        await run(30);
        [[8, -1], [11, 1.6], [14, -2.2], [17, 0.6]].forEach(([q, s], k) => {
          const p = K(-16 + q, s);
          p.y = ground.floorAt(p.x, p.z, me.y + 1);
          infected.putZ(infected.zeds[k], p, yawTo(p, me), true);
          infected.awake(infected.zeds[k]);
        });
        await run(14);
        g.calledAt = 0;
        g.emote('friendly');
      },
      cam: (t) => {
        const f = fwdOf(P().yaw), r = rightOf(P().yaw);
        return { p: me.clone().addScaledVector(f, -3.4).addScaledVector(r, 1.1).add(V(0, 1.15 + 0.03 * t, 0)), l: me.clone().addScaledVector(f, 5).add(V(0, 1.1, 0)), fov: 30 };
      },
    });
    cleaners.push(() => { if (!keepZeds.on) infected.away(); });
  }

  // ------------------------------------------------------------ the second hook: the line, and whoever is shooting at it
  const LINE = -1880;
  const inLine = (k: number) => V(LINE + 2 + k * 2.1, 0, LANE + (k % 2 ? 0.35 : -0.35));
  const lensA = V(LINE - 1.6, 0, LANE + 0.7);
  const lane = async () => {
    S.me(LINE - 22, LANE, 0);
    await run(20);
    for (let k = 0; k < 6; k++) {
      const p = inLine(k), a = stand(k, p.x, p.z, Math.PI / 2 - 0.1, k ? CROWD[k - 1] : HERO);
      dance(a, 'bhangra');
    }
    stand(6, LINE - 34, LANE, -Math.PI / 2, [], 'mosin9130');
  };
  /** who is left: from the far end of the line, one at a time */
  const pick = (k: number) => A(k);
  part(4, 'line', {
    hour: GOLDEN,
    setup: async () => {
      heroWear();
      await lane();
      await c.dressedNow();
      await run(30);
    },
    tick: (t) => {
      const fall = (key: string, at: number, k: number) => when(t, at, key, () => {
        distant(A(6));
        rest(pick(k));
        shot(pick(k), A(6).eye());
      });
      fall('a', BAR29 * 2 + BEAT29, 5);
      fall('b', BAR29 * 3 + BEAT29, 4);
    },
    cam: () => ({ p: lensA.clone().setY(S.ground(lensA.x, lensA.z) + 0.8), l: S.at(LINE + 8, LANE - 0.25, 1.2), fov: 26 }),
  });
  part(2, 'line2', {
    chain: true,
    tick: (t) => {
      const fall = (key: string, at: number, k: number) => when(t, at, key, () => {
        distant(A(6));
        rest(pick(k));
        shot(pick(k), A(6).eye());
      });
      fall('c', BEAT29, 3);
      fall('d', BAR29 + BEAT29, 2);
      fall('e', BAR29 + BEAT29 * 3, 1);
    },
    cam: (t) => {
      const p0 = A(0).pos as THREE.Vector3;
      return orbit(p0, 3.2 - 0.3 * ease(t / (2 * BAR29)), 0.2, -1.2, 30, 1.1);
    },
  });
  part(1, 'turn', {
    chain: true,
    setup: () => {
      rest(A(0));
    },
    tick: (t, dt) => {
      const a = A(0);
      // he stops; he looks behind him; he looks back
      if (t > 0.05 && t < 0.35) a.yaw += 3.6 * dt;
      if (t > 0.42 && t < BEAT29 * 2) a.yaw -= 3.6 * dt;
      when(t, BEAT29 * 2, 'last', () => {
        distant(A(6));
        shot(a, A(6).eye());
      });
    },
    cam: () => orbit(A(0).pos, 3.0, 0.3, -1.1, 30, 1.0),
    after: (t) => {
      if (t < BEAT29 * 2) over(0, A(0).pos, 'FRIENDLY?');
      const on = t >= BEAT29 * 2 && t < BAR29 - 0.04;
      dead.style.display = on ? '' : 'none';
      if (on) {
        dead.querySelector('i')!.textContent = `TIME ALIVE ${clock(B(26, 2) - B(12))}`;
        dead.style.opacity = Math.min(1, (t - BEAT29 * 2) / 0.06).toFixed(3);
      }
    },
  });
  let top = V(0, 0, 0), lensS = V(0, 0, 0);
  part(1, 'sniper', {
    hour: GOLDEN,
    setup: async () => {
      // the levellest place on the hill, with the town behind him
      let best = 1e9;
      for (let dx = -24; dx <= 24; dx += 4) {
        for (let dz = -24; dz <= 24; dz += 4) {
          const x = HILL.x + dx, z = HILL.z + dz, h = S.ground(x, z);
          const lean = Math.abs(S.ground(x + 3, z) - h) + Math.abs(S.ground(x - 3, z) - h) + Math.abs(S.ground(x, z + 3) - h) + Math.abs(S.ground(x, z - 3) - h);
          if (lean < best) {
            best = lean;
            top = V(x, h, z);
          }
        }
      }
      const town = V(TOWN.x, 0, TOWN.z), to = town.clone().sub(top).setY(0).normalize();
      const a = stand(7, top.x, top.z, Math.atan2(to.x, to.z), ['field_jacket', 'cargo_pants', 'hiking_boots', 'boonie_hat', 'sack_pack'], 'mosin9130');
      lensS = top.clone().addScaledVector(to, -3.6);
      lensS.y = Math.max(S.ground(lensS.x, lensS.z) + 1.2, top.y + 0.8);
      S.me(top.x + 20, top.z + 20, 0);
      await c.dressedNow();
      say(`the man on the hill: ${top.x},${top.z}, lean ${best.toFixed(2)}`);
      // the rifle still up, for as long as it takes to see it (a dancer's gun is put away, as the game does it)
      a.aim = true;
      a.yaw += 0.55;
      await run(12);
    },
    tick: (t) => {
      when(t, 0.55, 'dab', () => {
        const a = A(7);
        a.aim = false;
        a.yaw -= 0.55;
        dance(a, 'dab');
      });
    },
    cam: () => ({ p: lensS, l: top.clone().add(V(0, 1.0, 0)), fov: 30 }),
  });

  // ------------------------------------------------------------ the bridge: so he builds
  const base = new Base28(g, say);
  c.base = base;
  let steps: (() => void)[] = [];
  part(3, 'house', {
    hour: AFTERNOON,
    setup: () => {
      S.parkMe();
      base.begin();
      steps = base.batches();
    },
    tick: (t) => {
      steps.forEach((b, k) => when(t, ((3 * BAR29 - 0.5) / steps.length) * (k + 0.5), `step${k}`, b));
      when(t, 3 * BAR29 - 0.3, 'fit', () => base.fit());
      g.hourHeld = AFTERNOON + (GOLDEN - AFTERNOON) * Math.min(1, t / (3 * BAR29));
    },
    cam: (t) => {
      const p = base.at(CELL * 1.4, 0, CELL * 10);
      p.y = S.ground(p.x, p.z) + 1.4 + 0.12 * t;
      return { p, l: base.at(CELL * 1.2, 3.4, CELL * 2), fov: 34 };
    },
  });
  const door = () => base.at(CELL * 1.4, 0, CELL * 5);
  part(1, 'gun', {
    hour: GOLDEN,
    setup: async () => {
      const p = door(), a = stand(0, p.x, p.z, faceTo(p, base.at(CELL * 1.4, 0, CELL * 9)), HERO, 'ak');
      a.pos.y = S.ground(p.x, p.z);
      S.me(base.at(CELL * 4, 0, CELL * 14).x, base.at(CELL * 4, 0, CELL * 14).z, 0);
      await run(20);
    },
    tick: (t) => { when(t, 0.1, 'rack', () => A(0).rp.avatar.act('bolt', 0.78)); },
    cam: (t) => {
      const o = base.at(CELL * 1.4, 0, CELL * 9).sub(door());
      return orbit(A(0).pos, 3.0 - 0.5 * ease(t / BAR29), 0.5, Math.atan2(o.x, o.z) + 0.75, 28, 1.25);
    },
  });

  // ------------------------------------------------------------ the end of it: now it is him with the gun
  const yard = () => base.at(CELL * 1.4, 0, CELL * 7.2);
  const gate = () => base.at(CELL * 1.4, 0, CELL * 9.6);
  part(3, 'turned', {
    hour: SUNSET,
    setup: async () => {
      const y = yard(), s = gate();
      S.me(y.x + 22, y.z - 6, 0);
      const a = stand(0, y.x, y.z, faceTo(y, s), HERO, 'ak');
      const b = stand(1, s.x, s.z, faceTo(s, y), STRANGER);
      a.aim = true;
      a.face(b.chest());
      await c.dressedNow();
      await run(30);
    },
    tick: (t) => {
      when(t, BAR29 * 0.5, 'dance', () => dance(A(1), 'shuffle'));
      when(t, BAR29 * 2, 'fire', () => {
        const a = A(0), b = A(1);
        a.fireAt(b.chest(), 0);
        rest(b);
        shot(b, a.eye());
      });
    },
    cam: () => {
      const a = A(0), f = fwdOf(a.yaw), r = rightOf(a.yaw);
      return { p: a.pos.clone().addScaledVector(f, -2.3).addScaledVector(r, 0.42).add(V(0, 1.66, 0)), l: A(1).pos.clone().add(V(0, 1.0, 0)), fov: 26 };
    },
    after: (t) => {
      if (t < BAR29 * 1.9) over(1, A(1).pos, 'FRIENDLY!');
    },
  });
  part(1, 'dab', {
    setup: async () => {
      const y = yard(), s = gate();
      const to = y.clone().sub(s).setY(0).normalize();
      const by = s.clone().addScaledVector(to, 1.7);
      const a = stand(0, by.x, by.z, faceTo(by, y), HERO, null);
      const b = stand(1, s.x, s.z, faceTo(s, y), STRANGER);
      S.me(y.x + 22, y.z - 6, 0);
      await run(10);
      shot(b, a.eye());
      await run(190);
      dance(a, 'dab');
    },
    cam: () => {
      const to = yard().sub(gate());
      return orbit(A(0).pos, 3.1, 0.35, Math.atan2(to.x, to.z) + 0.45, 30, 1.05);
    },
  });
  const PARTY: [string, number, number][] = [['balloon', 0, 0.8], ['bhangra', -1.9, -0.2], ['mj', 1.9, -0.2], ['shuffle', -3.3, -1.5], ['piratejig', 3.3, -1.5], ['jaguar', -1.5, -2.8], ['egypt', 1.5, -2.8], ['legguitar', 0, -3.6]];
  const wholeCast = async () => {
    const y = yard();
    S.me(y.x + 24, y.z - 8, 0);
    const f = base.at(CELL * 1.4, 0, CELL * 9).sub(y).setY(0).normalize(), r = V(f.z, 0, -f.x);
    const yaw = Math.atan2(-f.x, -f.z);
    PARTY.forEach(([id, x, z], i) => {
      const p = y.clone().addScaledVector(r, x).addScaledVector(f, z);
      const a = stand(i, p.x, p.z, yaw, i === 0 ? HERO : i === 1 ? STRANGER : CROWD[i - 2]);
      dance(a, id);
    });
    await run(40);
    return { y, f };
  };
  let mid = V(0, 0, 0), front = 0;
  part(2, 'party', {
    hour: SUNSET,
    setup: async () => {
      const { y, f } = await wholeCast();
      mid = y.clone();
      front = Math.atan2(f.x, f.z);
      await c.dressedNow();
    },
    cam: (t) => orbit(mid, 8.2 - 1.4 * ease(t / (2 * BAR29)), 0.7 + 1.6 * ease(t / (2 * BAR29)), front - 0.5 + 0.8 * ease(t / (2 * BAR29)), 34, 0.9),
    after: (t) => { flash.style.opacity = Math.max(0, 0.7 - t / 0.2).toFixed(3); },
  });
  part(3, 'end', {
    setup: async () => {
      await wholeCast();
    },
    tick: (t) => {
      when(t, BAR29 + BEAT29 * 2, 'last', () => { cut.style.display = ''; });
    },
    cam: (t) => orbit(mid, 7, 2.3, front + 0.3 + 0.03 * t, 34, 0.8),
    after: (t) => {
      show(end, t > BAR29 + BEAT29 * 2 ? 0 : Math.min(1, t / 0.3));
      end.style.background = 'rgba(6, 7, 6, 0.48)';
    },
  });
  return bar;
}
