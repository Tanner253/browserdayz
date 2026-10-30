// The twenty-eighth film's third act: THE WORLD. The MD-500 up off the hospital roof, flown on its own controls, the
// towns under it, and then Bunker 17 and its keycard (the owner: "shoe horn in heli flying in there and the bunker
// keycard swiping ... show the arial view of the towns too etc.. people wanna see content density").
import * as THREE from 'three';
import { Spectate } from './human';
import { BAR, NOON, V, flat, fwdOf, rightOf, type Ctx } from './frame28';
import { BUNKER, bunkerAt, levelY } from '../sim/bunker';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export function actWorld(c: Ctx) {
  const { S, g, add, helis, seatIn, pilot, say, chipSay, run, kit, lightHands, hand, look, eye, notes, when, P, piece, show, dressers } = c;
  // what is on the map, counted off the world as it is filmed (the owner: "people wanna see content density")
  const stats = piece('x28-stats', '');
  dressers.push(async () => {
    const w = S.world as Any, named = (w.pois as { name: string }[]).filter((q) => !/tower/i.test(q.name)).length;
    stats.innerHTML = `<span><b>${named}</b> PLACES</span><span><b>${w.buildings.length}</b> BUILDINGS</span><span><b>${w.basements.length}</b> BASEMENTS</span>`;
    say(`on the map: ${named} places, ${w.buildings.length} buildings, ${w.basements.length} basements`);
  });
  let H: Any = null;
  const heli = () => (H = H ?? helis()[0]);
  // up off the roof of Kamenka's hospital, in the game's own view from behind, the town falling away under it
  add(BAR * 2, {
    name: 'lift-off',
    hud: true,
    hour: NOON,
    m: 'tour',
    setup: async () => {
      const h = heli();
      const at = h.pos.clone();
      seatIn(h, at, h.yaw ?? 0, 0);
      pilot.pts = [];
      await run(10);
      say(`on the roof: ride ${!!g.garage.ride}, mode ${h.mode}, at ${h.pos.x.toFixed(0)},${h.pos.y.toFixed(0)},${h.pos.z.toFixed(0)} yaw ${h.yaw?.toFixed(2)}`);
    },
    tick: (t) => {
      S.key('Space', t > 0.15);
      S.key('KeyW', t > 1.5);
    },
    after: (t) => chipSay(t, 0.25, BAR * 2 - 0.1, 'KAMENKA', 'FLY THE MD-500'),
  });
  /** one town from the air: flown through on the controls, the lens on a spring beside it */
  const flyby = (name: string, big: string, small: string, mid: [number, number], bearing: number, up: number, side: number, len = BAR) => {
    const spec = new Spectate(300 + name.length, 58, 0.5, 0.7);
    const f = fwdOf(bearing), r = rightOf(bearing);
    add(len, {
      name,
      hour: NOON + 0.04,
      m: 'tour',
      setup: async () => {
        const m = V(mid[0], 0, mid[1]);
        const start = m.clone().addScaledVector(f, -115);
        start.y = S.ground(m.x, m.z) + up;
        seatIn(heli(), start, bearing, 44);
        pilot.pts = [m.clone().addScaledVector(f, 400)];
        pilot.pts[0].y = start.y;
        pilot.cruise = 46;
        spec.reset();
        await run(12);
      },
      tick: () => pilot.fly(heli()),
      cam: (t) => {
        const off = f.clone().multiplyScalar(-24).addScaledVector(r, side).setY(10);
        return spec.update(t, heli().pos, off, f.clone().multiplyScalar(60).setY(-up * 0.8));
      },
      after: (t) => {
        chipSay(t, 0.2, len - 0.08, big, small);
        show(stats, 1);
      },
    });
  };
  c.cleaners.push(() => { stats.style.display = 'none'; });
  flyby('kalat', 'KALAT', 'THE WALLED CITY', [-3215, 230], Math.PI * 0.3, 62, 9);
  flyby('pokrov', 'POKROV', 'A MONASTERY AND ITS LAMPS', [-1850, -30], -Math.PI / 2, 52, -9);
  flyby('mokroye', 'MOKROYE', 'A VILLAGE IN THE SWAMP', [-1855, 585], Math.PI * 0.75, 48, 9);
  flyby('lipki', 'LIPKI', 'THE VALLEY', [-1180, 350], Math.PI / 2, 50, -9);
  flyby('fort', 'ORLINOYE', 'THE FORT ON THE RIM', [537, -371], Math.PI * 1.15, 58, 9);

  // Bunker 17: the reader at the foot of its stair, the card held out and pushed home, the door sliding aside on the dark
  {
    const H0 = BUNKER.hall;
    const BW = (r: number, f: number, up = 0) => {
      const BP = g.bunker.place;
      const [x, y, z] = bunkerAt(BP, r, f, levelY() + up);
      return new THREE.Vector3(x, y, z);
    };
    add(BAR * 2.5, {
      name: 'keycard',
      hud: true,
      hour: NOON,
      m: 'dread',
      under: true,
      fadeIn: 0.3,
      setup: async () => {
        notes(true);
        lightHands();
        kit(['keycard', 'flashlight', 'gasmask']);
        S.hold(null);
        const door = BW(0, H0.front, 1.2), foot = BW(0, Math.min(BUNKER.stair.foot - 0.3, H0.front + 1.0));
        S.me(foot.x, foot.z, Math.atan2(-(door.x - foot.x), -(door.z - foot.z)), 0, foot.y);
        hand.set(P().yaw, 0.02);
        hand.look(-0.4, door, true, 0);
        await run(30);
        const card = [...g.inv.carried()].find((i: Any) => i.id === 'keycard') as Any;
        g.takeUp(card);
        await run(40);
        say(`at the reader: ${g.bunker.doorAt(V(0, 0, 0))?.distanceTo(g.s.r.camera.position)?.toFixed(2)} m; in hand ${g.inv.held()?.id}`);
      },
      tick: (t, _S, dt) => {
        look(t, dt);
        when(t, 0.5, 'swipe', () => g.swipeCard());
        when(t, 2.5, 'light', () => S.tap('KeyL'));
        when(t, 2.9, 'in', () => hand.look(t, BW(0, H0.front - 12, 1.3), true, 0.1));
        S.key('KeyW', t > 3);
      },
      after: (t) => chipSay(t, 2.9, BAR * 2.5 - 0.05, 'BUNKER 17', 'THE BEST LOOT THERE IS'),
    });
  }
  void flat; void eye;
}
