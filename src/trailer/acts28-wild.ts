// The twenty-eighth film's first two acts: NOTHING (the coast, the first loot) and THE WILD (deer, wolves, the bear, the
// infected). The animals are the game's own herds with their own minds, stood where a shot wants them (as an admin
// stands one, Herd.place), and shot by the player's rounds; the kills are the game's.
import * as THREE from 'three';
import { BRACED, Operator, yawTo, pitchTo } from './human';
import { BAR, DAWN, MORNING, NOON, V, ease, flat, type Ctx } from './frame28';
import { findHouse26 } from './kit26';
import { TOWN, SEA_LEVEL } from '../world/worldgen';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export const PAID = { sol: '10.07' };
/** the middle of Pokrov's lane (shots26.ts) */
const LANE = 34.5;

export function actNothing(c: Ctx) {
  const { S, g, add, P, eye, hand, lay, legs, look, ahead, ground, show, title, say, run, lightHands, kit, lie, when, notes } = c;
  const { floorAt } = ground;
  // the coast south of Bereg: he has just come round on the wet sand, and walks up the beach toward the lens
  {
    const op = new Operator(BRACED, 281, 30);
    let lens = V(0, 0, 0);
    add(BAR * 2.5, {
      name: 'coast',
      hour: DAWN,
      m: 'card',
      setup: async () => {
        (title.querySelector('i') as HTMLElement).textContent = `${PAID.sol} SOL PAID TO PLAYERS · FREE IN YOUR BROWSER`;
        kit(['bandage'], {}, ['tshirt', 'jeans', 'trainers']);
        S.hold(null);
        const z = -378;
        let x = -3640;
        while (S.ground(x, z) > SEA_LEVEL - 0.3 && x > -3836) x -= 1;
        const p0 = V(x + 3, 0, z), p1 = V(x + 18, 0, z + 2.5);
        p0.y = S.ground(p0.x, p0.z);
        p1.y = S.ground(p1.x, p1.z);
        S.me(p0.x, p0.z, yawTo(p0, p1), -0.05);
        hand.set(yawTo(p0, p1), -0.05);
        lay([p0, p0.clone().lerp(p1, 0.5).setY(S.ground((p0.x + p1.x) / 2, (p0.z + p1.z) / 2)), p1], { walk: true });
        hand.look(-0.5, ahead(8), true, 0);
        lens = p1.clone().add(V(2.4, 0, 0.7));
        lens.y = S.ground(lens.x, lens.z) + 0.8;
        op.reset(lens, eye());
      },
      tick: (t, _S, dt) => {
        legs();
        look(t, dt);
      },
      cam: (t) => op.update(t, lens, eye().add(V(0, -0.3, 0))),
      after: (t) => show(title, t < 3.1 ? 1 : 1 - ease((t - 3.1) / 0.7)),
    });
  }
  // Pokrov's lane in the morning: through his own eyes, a pack and a pistol somebody dropped, and the real inventory
  {
    let spot: THREE.Vector3 | null = null, side = V(0, 0, 1), opened = false;
    add(BAR * 2, {
      name: 'first-loot',
      hud: true,
      hour: MORNING,
      m: 'sneak',
      fadeIn: 0.25,
      setup: async () => {
        notes(true);
        lightHands();
        kit(['bandage'], {}, ['tshirt', 'jeans', 'trainers']);
        S.hold(null);
        opened = false;
        S.me(-1880, LANE, Math.PI, 0);
        await run(60);
        const h = findHouse26(S, -1880, LANE, LANE, say);
        if (!h) throw new Error('no street to loot in');
        side = h.out.clone();
        spot = h.front.clone().addScaledVector(h.out, 1.4);
        spot.y = floorAt(spot.x, spot.z, h.front.y + 0.5);
        const [a, b] = [spot.clone().addScaledVector(side, 0.3), spot.clone().addScaledVector(side, -0.3)];
        a.y = floorAt(a.x, a.z, spot.y + 0.4);
        b.y = floorAt(b.x, b.z, spot.y + 0.4);
        lie('sack_pack', a, 0.4);
        lie('m9', b, 1.1);
        await run(30);
        const from = spot.clone().addScaledVector(h.street, 4.2), near = spot.clone().addScaledVector(h.street, 1.7);
        from.y = floorAt(from.x, from.z, spot.y + 0.5);
        near.y = floorAt(near.x, near.z, spot.y + 0.5);
        S.me(from.x, from.z, yawTo(from, spot), -0.2, from.y);
        lay([from, near], { walk: true, stop: 0.12 });
        hand.set(yawTo(from, spot), -0.2);
        hand.look(0.1, spot.clone().addScaledVector(side, 0.3).setY(spot.y + 0.06), true, 0);
      },
      tick: (t, _S, dt) => {
        if (!spot) return;
        legs();
        look(t, dt);
        if (flat(P().pos, spot) < 2.05) {
          when(t, 1.5, 'pack', () => S.tap('KeyF', 90));
          when(t, 1.9, 'look-gun', () => hand.look(t, spot!.clone().addScaledVector(side, -0.3).setY(spot!.y + 0.06), true, 0.05));
          when(t, 2.45, 'pistol', () => S.tap('KeyF', 90));
        }
        when(t, 2.95, 'inv', () => {
          if (!opened) g.toggleInventory(true);
          opened = true;
        });
      },
    });
  }
}

export function actWild(c: Ctx) {
  const { S, g, add, P, eye, hand, look, ground, say, run, wait, lightHands, kit, when, chipSay, cleaners, infected } = c;
  const herd = () => g.wild.herd as Any;
  /** the game's own animals taken away again when a shot has done with them */
  let stood: number[] = [];
  const stand = (id: string, x: number, z: number, n: number) => {
    const out = herd().place(id, x, z, Date.now(), n) as Any[];
    stood.push(...out.map((b) => b.i));
    return out;
  };
  cleaners.push(() => {
    if (c.keepStood.on) return;
    for (const i of stood) herd()?.remove(i);
    stood = [];
  });
  /** wait until each of them is drawn (a model is fetched the first time) */
  const seen = async (ids: Any[]) => {
    for (let k = 0; k < 600; k++) {
      await run(6);
      await wait(15);
      if (ids.every((b) => (g.wild.beasts.get(b.i) as Any)?.model)) return;
    }
    say(`not all of ${ids.length} animals were drawn`);
  };
  const live = (ids: Any[]) => ids.map((b) => herd().beasts.get(b.i)).filter((b: Any) => b && b.hp > 0) as Any[];
  const nearest = (ids: Any[]) => {
    const p = P().pos as THREE.Vector3;
    return live(ids).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] ?? null;
  };
  /** the meadow: open grass with the pines round it */
  const trunks = ((S.world.trees ?? []) as { kind: string; x: number; z: number }[]).filter((t) => !t.kind.startsWith('bush'));
  const FIELD = V(-1022, 0, -404);
  {
    let room = 0;
    for (let x = -1080; x <= -960; x += 4) {
      for (let z = -470; z <= -340; z += 4) {
        let d = 1e9;
        for (const q of trunks) d = Math.min(d, Math.hypot(q.x - x, q.z - z));
        if (d > room) {
          room = d;
          FIELD.set(x, 0, z);
        }
      }
    }
    say(`the meadow: ${FIELD.x},${FIELD.z}, the nearest trunk ${room.toFixed(0)} m off`);
  }
  // a herd of red deer feeding on the meadow from the long lens; a shot from somebody out of the picture, a stag down, and
  // the rest away. (Nobody near: a herd stood with a player in sight of it is gone before a lens can find it.)
  {
    const op = new Operator(BRACED, 282, 22);
    let deer: Any[] = [], lens = V(0, 0, 0), stag: Any = null, look0 = V(0, 0, 0);
    const LONG = BAR * 2, CRACK = 1.6;
    add(LONG, {
      name: 'deer',
      hour: MORNING,
      m: 'sneak',
      hit: true,
      fadeIn: 0.3,
      setup: async () => {
        S.hold(null);
        S.me(FIELD.x - 330, FIELD.z, 0, 0);
        await run(6);
        deer = stand('stag', FIELD.x + 8, FIELD.z - 3, 6);
        await seen(deer);
        await run(40);
        say(`the deer: ${live(deer).map((q) => `${Math.round(q.x)},${Math.round(q.z)} mode ${q.mode}`).join(' | ')}`);
        const near = live(deer).sort((p, q) => Math.hypot(p.x - FIELD.x, p.z - FIELD.z) - Math.hypot(q.x - FIELD.x, q.z - FIELD.z));
        stag = near[0];
        lens = S.at(stag.x + 4, stag.z - 21, 1.2);
        look0 = V(stag.x, S.ground(stag.x, stag.z) + 0.9, stag.z);
        op.reset(lens, look0);
        const gun = S.actor(3);
        gun.place(FIELD.x - 70, FIELD.z + 30, 0, 'mosin', []);
        gun.pos.y -= 0;
      },
      tick: (t) => {
        when(t, CRACK, 'crack', () => {
          const gun = S.actor(3), to = V(stag.x, S.ground(stag.x, stag.z) + 0.95, stag.z);
          gun.face(to);
          gun.fireAt(to, 0);
          g.wild.heard(gun.pos.x, gun.pos.z, [900, 2000]);
        });
        when(t, CRACK + 0.18, 'stag', () => {
          if (!stag.dead && herd().hurt(stag.i, 5000, g.wild.host.me(), Date.now())?.dead) g.wild.hp(stag.i, true);
        });
      },
      cam: (t) => op.update(t, lens, stag ? V(stag.x, S.ground(stag.x, stag.z) + 0.9, stag.z) : look0),
      after: (t) => chipSay(t, 0.3, LONG - 0.1, 'RED DEER', 'WOLVES · BEARS · COWS'),
    });
  }
  // the pack finds him at the edge of the wood and walks round him; then the first one comes in
  {
    let pack: Any[] = [];
    add(BAR, {
      name: 'wolves',
      hour: NOON,
      m: 'dread',
      setup: async () => {
        c.keepStood.on = true;
        kit(['ak', ['ammo_762', 60]]);
        S.hold('primary');
        const p = S.at(FIELD.x, FIELD.z, 0);
        S.me(p.x, p.z, -Math.PI / 2, 0);
        pack = stand('wolf', p.x + 15, p.z - 9, 4);
        await seen(pack);
        await run(130);
        hand.set(P().yaw, 0);
        say(`the pack: ${live(pack).map((w) => `${Math.hypot(w.x - p.x, w.z - p.z).toFixed(0)} m, mode ${w.mode}`).join(' | ')}`);
      },
      tick: (t, _S, dt) => {
        const w = nearest(pack);
        if (w) hand.look(t, V(w.x, S.ground(w.x, w.z) + 0.6, w.z), true, 9);
        look(t, dt);
      },
      cam: (t) => {
        const p = P().pos as THREE.Vector3, a = 0.7 + t * 0.09;
        return { p: V(p.x + Math.cos(a) * 9, p.y + 4.6, p.z + Math.sin(a) * 9), l: V(p.x, p.y + 0.5, p.z), fov: 66 };
      },
      after: (t) => chipSay(t, 0.2, BAR - 0.05, 'WOLVES', 'THEY HUNT IN PACKS'),
    });
    add(BAR * 1.5, {
      name: 'wolf-lunge',
      hud: true,
      chain: true,
      m: 'dread',
      hit: true,
      setup: () => {
        c.keepStood.on = false;
        lightHands();
        let on = nearest(pack);
        const body = () => {
          if (!on || !(on.hp > 0)) on = nearest(pack) ?? on;
          return V(on.x, S.ground(on.x, on.z) + 0.55, on.z);
        };
        hand.look(-0.3, body, true, 0);
      },
      tick: (t, _S, dt) => {
        look(t, dt);
        P().vitals.bleeding = false;
        S.key('Mouse0', (t > 1 && t < 1.4) || (t > 1.75 && t < 2.15) || (t > 2.4 && t < 2.75));
      },
    });
  }
  // a bear on the meadow: it stands, it roars, and it comes
  {
    const op = new Operator(BRACED, 283, 26);
    let bear: Any = null, lens = V(0, 0, 0);
    const at = () => V(bear.x, S.ground(bear.x, bear.z) + 0.9, bear.z);
    add(BAR, {
      name: 'bear-roar',
      hour: NOON,
      m: 'dread',
      setup: async () => {
        S.clean();
        c.keepStood.on = true;
        kit(['ak', ['ammo_762', 60]]);
        S.hold('primary');
        const me = S.at(FIELD.x - 14, FIELD.z, 0);
        S.me(me.x, me.z, -Math.PI / 2, 0);
        const out = stand('bear', me.x + 19, me.z - 2, 1);
        bear = herd().beasts.get(out[0].i);
        await seen(out);
        await run(40);
        lens = S.at(me.x + 10, me.z + 4.5, 0.8);
        op.reset(lens, at());
        say(`the bear stands ${flat(me, bear).toFixed(1)} m off, mode ${bear.mode}`);
      },
      cam: (t) => op.update(t, lens, at()),
      after: (t) => chipSay(t, 0.2, BAR - 0.05, 'BROWN BEAR', 'NOTHING OUTRUNS IT'),
    });
    add(BAR * 1.5, {
      name: 'bear-fight',
      hud: true,
      chain: true,
      m: 'dread',
      hit: true,
      setup: () => {
        c.keepStood.on = false;
        lightHands();
        hand.set(yawTo(eye(), at()), pitchTo(eye(), at()));
        hand.look(-0.4, at, true, 0);
        say(`the bear is ${flat(P().pos, bear).toFixed(1)} m off, mode ${bear.mode}`);
      },
      tick: (t, _S, dt) => {
        look(t, dt);
        P().vitals.bleeding = false;
        S.key('Mouse0', t > 0.45 && bear.hp > 0);
        when(t, 0.6, 'hurt', () => herd().hurt(bear.i, 60, g.wild.host.me(), Date.now()));
        const d = flat(P().pos, bear);
        when(t, 1.2, 'how', () => say(`the bear at 1.2 s: ${d.toFixed(1)} m, mode ${bear.mode}, hp ${bear.hp}`));
        // (it falls at the feet: the rounds are the game's, and this one was going to get there first)
        if (bear.hp > 0 && (d < 3.4 || t > 2.5)) {
          when(t, 0, 'dropped', () => {
            const r = herd().hurt(bear.i, 5000, null, Date.now());
            if (r?.dead) g.wild.hp(bear.i, true);
            say(`the bear finished at ${d.toFixed(1)} m, ${t.toFixed(2)} s in`);
          });
        } else if (!(bear.hp > 0)) when(t, 0, 'fell', () => say(`the bear fell to the rounds at ${d.toFixed(1)} m, ${t.toFixed(2)} s in`));
      },
    });
  }
  // the infected: the hospital's own, patients and nurses, coming down Kamenka's street
  {
    const K = (a: number, side = 0) => {
      const [sx, sz] = TOWN.street;
      return V(TOWN.x + sx * a - sz * side, 0, TOWN.z + sz * a + sx * side);
    };
    let kills = 0, lens = V(0, 0, 0);
    const op = new Operator(BRACED, 289, 40);
    const runners = () => infected.zeds.filter((q: Any) => !q.dead && q.pos.y > -100).sort((p: Any, q: Any) => flat(p.pos, P().pos) - flat(q.pos, P().pos));
    add(BAR, {
      name: 'infected-run',
      hour: NOON,
      m: 'dread',
      setup: async () => {
        S.clean();
        c.keepZeds.on = true;
        kit(['ak', ['ammo_762', 60]]);
        S.hold('primary');
        kills = 0;
        const me = K(-26);
        me.y = ground.floorAt(me.x, me.z);
        S.me(me.x, me.z, yawTo(me, K(10)), 0, me.y);
        await run(30);
        const zs = [[-1, -1], [2, 1.6], [5, -2.2], [8, 0.6]].map(([q, s], k) => {
          const p = K(q, s);
          p.y = ground.floorAt(p.x, p.z, me.y + 1);
          infected.putZ(infected.zeds[k], p, yawTo(p, me), true);
          infected.awake(infected.zeds[k]);
          return p;
        });
        say(`in sight: ${zs.map((q) => ground.seesWide(me.clone().setY(me.y + 1.6), q.clone().setY(q.y + 1.3))).join(' ')}`);
        await run(50);
        lens = K(-13, 2.2);
        lens.y = ground.floorAt(lens.x, lens.z, me.y + 1) + 0.55;
        const z0 = runners()[0];
        op.reset(lens, z0 ? V(z0.pos.x, z0.pos.y + 1.1, z0.pos.z) : K(-2).setY(me.y + 1.1));
      },
      cam: (t) => {
        const z = runners()[0];
        return op.update(t, lens, z ? V(z.pos.x, z.pos.y + 1.1, z.pos.z) : K(-2));
      },
      after: (t) => chipSay(t, 0.2, BAR - 0.05, 'THE INFECTED', 'TWELVE KINDS'),
    });
    add(BAR * 1.25, {
      name: 'infected',
      hud: true,
      chain: true,
      m: 'dread',
      setup: () => {
        c.keepZeds.on = false;
        lightHands();
        const z = runners()[0];
        if (z) hand.set(yawTo(eye(), V(z.pos.x, z.pos.y + 1.2, z.pos.z)), -0.02);
      },
      tick: (t, _S, dt) => {
        const z = runners()[0];
        if (z) hand.look(t, V(z.pos.x, z.pos.y + 1.2, z.pos.z), true, 9);
        look(t, dt);
        S.key('Mouse2', true);
        S.key('Mouse0', t > 0.15 && t % 0.8 < 0.3);
        if (z && flat(z.pos, P().pos) < 4.5 && kills < 4) {
          kills++;
          infected.dropZ(z, eye());
        }
      },
    });
    c.cleaners.push(() => { if (!c.keepZeds.on) infected.away(); });
  }
}
