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

export const PAID = { sol: '10.05' };
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
  // a house in Pokrov: through his own eyes, a jacket off the table, a pistol, and the real inventory
  {
    let house: Any = null, opened = false;
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
        house = house ?? findHouse26(S, -1880, LANE, LANE, say);
        if (!house) throw new Error('no house to loot');
        const h = house, side = V(-h.out.z, 0, h.out.x);
        for (const d of g.s.buildings.doors as Any[]) if (d.pivot.getWorldPosition(V(0, 0, 0)).distanceTo(h.door) < 2 && !d.open) d.setOpen(true);
        lie('sack_pack', h.gun.clone().addScaledVector(side, 0.32), 0.4);
        lie('m9', h.gun.clone().addScaledVector(side, -0.32), 1.1);
        await run(30);
        const dirIn = h.gun.clone().sub(h.inside).setY(0).normalize(), near = h.gun.clone().addScaledVector(dirIn, -1.6);
        near.y = floorAt(near.x, near.z, h.inside.y + 0.3);
        const from = h.door.clone().addScaledVector(h.out, 0.3);
        from.y = floorAt(from.x, from.z, h.inside.y + 0.5);
        S.me(from.x, from.z, yawTo(from, h.gun), -0.1, from.y);
        lay([from, near], { walk: true, stop: 0.12 });
        hand.set(yawTo(from, h.gun), -0.1);
        hand.look(-0.4, h.gun.clone().addScaledVector(side, 0.32).setY(h.gun.y + 0.06), true, 0);
      },
      tick: (t, _S, dt) => {
        const h = house;
        if (!h) return;
        legs();
        look(t, dt);
        const side = V(-h.out.z, 0, h.out.x);
        if (flat(P().pos, h.gun) < 2.05) {
          when(t, 0.9, 'jacket', () => S.tap('KeyF', 90));
          when(t, 1.35, 'look-gun', () => hand.look(t, h.gun.clone().addScaledVector(side, -0.32).setY(h.gun.y + 0.06), true, 0.05));
          when(t, 1.95, 'pistol', () => S.tap('KeyF', 90));
        }
        when(t, 2.6, 'inv', () => {
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
  const live = (ids: Any[]) => ids.map((b) => herd().beasts.get(b.i)).filter((b: Any) => b && !b.dead) as Any[];
  const middle = (ids: Any[], up: number) => {
    const l = live(ids).slice(0, 3), q = V(0, 0, 0);
    for (const b of l) q.add(V(b.x, 0, b.z));
    q.multiplyScalar(1 / Math.max(1, l.length));
    q.y = S.ground(q.x, q.z) + up;
    return q;
  };
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
  // a herd of red deer on the meadow from the long lens; then the scope, the shot, and the rest away
  {
    const op = new Operator(BRACED, 282, 13);
    let deer: Any[] = [], lens = V(0, 0, 0);
    add(BAR, {
      name: 'deer',
      hour: MORNING,
      m: 'sneak',
      fadeIn: 0.3,
      setup: async () => {
        c.keepStood.on = true;
        kit(['mosin', ['ammo_762', 10]], { mosin: ['pu_scope'] });
        S.hold('primary');
        S.me(FIELD.x - 24, FIELD.z, -Math.PI / 2, 0);
        deer = stand('stag', FIELD.x + 22, FIELD.z - 6, 6);
        await seen(deer);
        await run(50);
        say(`the deer: ${live(deer).map((b) => `${Math.round(b.x)},${Math.round(b.z)} mode ${b.mode}`).join(' | ')}`);
        lens = S.at(FIELD.x - 18, FIELD.z + 12, 1.9);
        op.reset(lens, middle(deer, 1));
      },
      cam: (t) => op.update(t, lens, middle(deer, 1)),
      after: (t) => chipSay(t, 0.2, BAR - 0.05, 'RED DEER', 'WOLVES · BEARS · COWS'),
    });
    let target: Any = null;
    add(BAR * 1.5, {
      name: 'deer-shot',
      hud: true,
      chain: true,
      m: 'sneak',
      hit: true,
      setup: () => {
        c.keepStood.on = false;
        lightHands();
        target = nearest(deer);
        const body = () => V(target.x, S.ground(target.x, target.z) + 1, target.z);
        hand.set(yawTo(eye(), body()), pitchTo(eye(), body()));
        hand.look(-0.4, body, true, 0);
      },
      tick: (t, _S, dt) => {
        look(t, dt);
        S.key('Mouse2', true);
        when(t, 0.9, 'fire', () => S.tap('Mouse0', 80));
      },
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
        await run(330);
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
        const w = nearest(pack), body = () => {
          const q = nearest(pack) ?? w;
          return V(q.x, S.ground(q.x, q.z) + 0.55, q.z);
        };
        hand.look(-0.3, body, true, 0);
      },
      tick: (t, _S, dt) => {
        look(t, dt);
        S.key('Mouse2', true);
        S.key('Mouse0', (t > 0.4 && t < 0.8) || (t > 1.2 && t < 1.6) || (t > 2 && t < 2.5));
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
        c.keepStood.on = true;
        kit(['ak', ['ammo_762', 60]]);
        S.hold('primary');
        const me = S.at(FIELD.x - 14, FIELD.z, 0);
        S.me(me.x, me.z, -Math.PI / 2, 0);
        const out = stand('bear', me.x + 25, me.z - 2, 1);
        bear = herd().beasts.get(out[0].i);
        await seen(out);
        await run(40);
        lens = S.at(me.x + 15, me.z + 4.5, 0.8);
        op.reset(lens, at());
        say(`the bear stands ${flat(me, bear).toFixed(1)} m off, mode ${bear.mode}`);
      },
      cam: (t) => op.update(t, lens, at()),
      after: (t) => chipSay(t, 0.2, BAR - 0.05, 'BROWN BEAR', 'NOTHING OUTRUNS IT'),
    });
    add(BAR * 2, {
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
        S.key('Mouse2', true);
        S.key('Mouse0', t > 0.45 && !bear.dead);
        when(t, 0.6, 'hurt', () => herd().hurt(bear.i, 60, g.wild.host.me(), Date.now()));
        const d = flat(P().pos, bear);
        when(t, 1.2, 'how', () => say(`the bear at 1.2 s: ${d.toFixed(1)} m, mode ${bear.mode}, hp ${bear.hp}`));
        // (it falls at the feet: the rounds are the game's, and this one was going to get there first)
        if (!bear.dead && (d < 3.4 || t > 3.3)) {
          when(t, 0, 'dropped', () => {
            const r = herd().hurt(bear.i, 5000, null, Date.now());
            if (r?.dead) g.wild.hp(bear.i, true);
            say(`the bear finished at ${d.toFixed(1)} m, ${t.toFixed(2)} s in`);
          });
        } else if (bear.dead) when(t, 0, 'fell', () => say(`the bear fell to the rounds at ${d.toFixed(1)} m, ${t.toFixed(2)} s in`));
      },
    });
  }
  // the infected: the hospital's own, patients and nurses, coming down Kamenka's street
  {
    const K = (a: number, side = 0) => {
      const [sx, sz] = TOWN.street;
      return V(TOWN.x + sx * a - sz * side, 0, TOWN.z + sz * a + sx * side);
    };
    let kills = 0;
    add(BAR * 1.5, {
      name: 'infected',
      hud: true,
      hour: NOON,
      m: 'dread',
      setup: async () => {
        lightHands();
        kit(['ak', ['ammo_762', 60]]);
        S.hold('primary');
        kills = 0;
        const me = K(-26);
        me.y = ground.floorAt(me.x, me.z);
        S.me(me.x, me.z, yawTo(me, K(10)), 0, me.y);
        await run(30);
        const zs = [[-8, -1], [-5, 1.6], [-2, -2.2], [1, 0.6]].map(([a, b], k) => {
          const q = K(a, b);
          q.y = ground.floorAt(q.x, q.z, me.y + 1);
          infected.putZ(infected.zeds[k], q, yawTo(q, me), true);
          infected.awake(infected.zeds[k]);
          return q;
        });
        say(`in sight: ${zs.map((q) => ground.seesWide(me.clone().setY(me.y + 1.6), q.clone().setY(q.y + 1.3))).join(' ')}`);
        await run(40);
        hand.set(yawTo(eye(), K(-4)), -0.02);
      },
      tick: (t, _S, dt) => {
        const z = infected.zeds.filter((q: Any) => !q.dead && q.pos.y > -100).sort((a: Any, b: Any) => flat(a.pos, P().pos) - flat(b.pos, P().pos))[0];
        if (z) hand.look(t, V(z.pos.x, z.pos.y + 1.2, z.pos.z), true, 9);
        look(t, dt);
        S.key('Mouse2', true);
        S.key('Mouse0', t > 0.5 && t % 0.9 < 0.3);
        if (z && flat(z.pos, P().pos) < 4.5 && kills < 4) {
          kills++;
          infected.dropZ(z, eye());
        }
      },
      after: (t) => chipSay(t, 0.2, BAR * 1.5 - 0.1, 'THE INFECTED', 'TWELVE KINDS'),
    });
    c.cleaners.push(() => infected.away());
  }
}
