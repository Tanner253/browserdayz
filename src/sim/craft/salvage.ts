// Salvage (2026-10-25, plan-crafting: "Soviet cars, rusted kolkhoz machinery, drums and junk at farms and works, hit
// with a hammer, pickaxe or sledgehammer; each rusts back in 2 h"; progression v3: "Wrecks give fragments"). What is on
// the map already gives it first (the navigator: "Use what's already on the map first: the red fuel drums, machinery
// props, the heli wreck"), then the wrecks of a layer of their own (src/sim/craft/wrecks.ts). Each spot gives so many
// metal fragments, a blow at a time, and the blow that strips it the bit of scrap it had in it; two hours after it was
// last struck it has them again. An armoured wall's sixty fragments are three cars or ten drums: a trip, not a minute
// (the navigator: "Tune salvage so that's a real trip"). Shared by the server, which judges each blow, and the game alone.

import type { Instance } from '../../world/worldgen';

/** what each kind of thing gives: its name, its fragments, its scrap (on the blow that strips it), and how near its middle a blow has to land, m */
export const SALVAGE_KINDS: Record<string, { name: string; frags: number; scrap: number; reach: number }> = {
  Barrel_01: { name: 'fuel drum', frags: 6, scrap: 2, reach: 1.3 },
  barrel_03: { name: 'drum', frags: 5, scrap: 1, reach: 1.3 },
  metal_jerrycan_green: { name: 'jerrycan', frags: 3, scrap: 0, reach: 1 },
  metal_trash_can: { name: 'bin', frags: 4, scrap: 2, reach: 1.2 },
  'metal_trash_can@0': { name: 'bin', frags: 4, scrap: 2, reach: 1.2 },
  propane_tank: { name: 'gas bottle', frags: 4, scrap: 0, reach: 1.2 },
  portable_generator: { name: 'generator', frags: 12, scrap: 3, reach: 1.6 },
  covered_car: { name: 'covered car', frags: 20, scrap: 3, reach: 3.2 },
  uaz_469: { name: 'wrecked jeep', frags: 25, scrap: 4, reach: 3.2 },
  'container_shell@0': { name: 'shipping container', frags: 15, scrap: 2, reach: 4.2 },
  'container_shell@1': { name: 'shipping container', frags: 15, scrap: 2, reach: 4.2 },
  heli_wreck: { name: 'helicopter wreck', frags: 40, scrap: 8, reach: 6 },
};

export const SALVAGE = {
  /** fragments a blow knocks off: a hammer or a pickaxe one, a sledgehammer two (plan-base-economy, change 4) */
  tools: { hammer: 1, pickaxe: 1, sledgehammer: 2 } as Record<string, number>,
  /** seconds before a stripped spot has its fragments again (and not while anybody stands at it) */
  back: 2 * 60 * 60,
};

export interface SalvageSpot {
  x: number;
  y: number;
  z: number;
  kind: string;
  name: string;
  frags: number;
  scrap: number;
  reach: number;
}

/** every spot there is, numbered as the game and the server both number them: the map's own things, then the wrecks' layer */
export function salvageSpots(props: Instance[], wrecks: SalvageSpot[] = []): SalvageSpot[] {
  const out: SalvageSpot[] = [];
  for (const p of props) {
    const k = SALVAGE_KINDS[p.kind];
    if (k) out.push({ x: p.x, y: p.y, z: p.z, kind: p.kind, ...k });
  }
  return [...out, ...wrecks];
}

/** the spot a blow that landed at a point was struck on: the nearest whose reach it is within, or -1 */
export function spotAt(spots: SalvageSpot[], x: number, y: number, z: number): number {
  let best = -1, d = Infinity;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i], h = Math.hypot(s.x - x, s.z - z);
    if (h < s.reach && h < d && y > s.y - 1 && y < s.y + 6) {
      d = h;
      best = i;
    }
  }
  return best;
}

/** what is left of each spot that has been struck, and when it was last (ms) */
export class Scrapyard {
  readonly taken = new Map<number, { left: number; at: number }>();
  constructor(readonly spots: SalvageSpot[]) {}

  /** a blow on spot `i` with a tool of `rate`: the fragments it gives, the scrap (on the blow that strips it), and how far through the spot it is (1: stripped) */
  blow(i: number, rate: number, now: number): { give: number; scrap: number; done: number } | null {
    const s = this.spots[i];
    if (!s) return null;
    const t = this.taken.get(i) ?? { left: s.frags, at: now };
    const give = Math.min(t.left, Math.max(1, Math.round(rate)));
    t.left -= give;
    t.at = now;
    this.taken.set(i, t);
    return { give, scrap: give > 0 && t.left === 0 ? s.scrap : 0, done: 1 - t.left / s.frags };
  }

  /** the spots whose time is up and that nobody stands at have their fragments again; their numbers */
  rust(now: number, near: (x: number, z: number, within: number) => boolean): number[] {
    const back: number[] = [];
    for (const [i, t] of this.taken) {
      const s = this.spots[i];
      if (now - t.at < SALVAGE.back * 1000 || near(s.x, s.z, s.reach + 4)) continue;
      this.taken.delete(i);
      back.push(i);
    }
    return back;
  }

  /** what is left on a spot (all of it, if it has not been struck) */
  left(i: number) {
    return this.taken.get(i)?.left ?? this.spots[i]?.frags ?? 0;
  }
}
