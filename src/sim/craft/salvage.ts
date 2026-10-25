// Salvage (2026-10-25, plan-crafting: "Wrecks → scrap: Soviet cars, rusted kolkhoz machinery, drums and junk at farms
// and works, hit with a hammer, pickaxe or sledgehammer; each rusts back in 2 h"). What is on the map already gives it
// first (the navigator: "Use what's already on the map first: the red fuel drums, machinery props, the heli wreck"), then
// the wrecks of a layer of their own (src/sim/craft/wrecks.ts). Each spot gives so much, a blow at a time, and has it
// again two hours after it was last stripped. Shared by the server, which judges each blow, and the game played alone.

import type { Instance } from '../../world/worldgen';

/** what each kind of thing gives: its name, its scrap, and how near its middle a blow has to land, m */
export const SALVAGE_KINDS: Record<string, { name: string; scrap: number; reach: number }> = {
  Barrel_01: { name: 'fuel drum', scrap: 4, reach: 1.3 },
  barrel_03: { name: 'drum', scrap: 3, reach: 1.3 },
  metal_jerrycan_green: { name: 'jerrycan', scrap: 2, reach: 1 },
  metal_trash_can: { name: 'bin', scrap: 3, reach: 1.2 },
  'metal_trash_can@0': { name: 'bin', scrap: 3, reach: 1.2 },
  propane_tank: { name: 'gas bottle', scrap: 3, reach: 1.2 },
  portable_generator: { name: 'generator', scrap: 8, reach: 1.6 },
  covered_car: { name: 'covered car', scrap: 16, reach: 3.2 },
  uaz_469: { name: 'wrecked jeep', scrap: 20, reach: 3.2 },
  'container_shell@0': { name: 'shipping container', scrap: 12, reach: 4.2 },
  'container_shell@1': { name: 'shipping container', scrap: 12, reach: 4.2 },
  heli_wreck: { name: 'helicopter wreck', scrap: 30, reach: 6 },
};

export const SALVAGE = {
  /** scrap a blow knocks off with a hammer or a pickaxe; a sledgehammer twice as much (plan-base-economy, change 4) */
  per: 1,
  tools: { hammer: 1, pickaxe: 1, sledgehammer: 2 } as Record<string, number>,
  /** seconds before a stripped spot has its scrap again (and not while anybody stands at it) */
  back: 2 * 60 * 60,
};

export interface SalvageSpot {
  x: number;
  y: number;
  z: number;
  kind: string;
  name: string;
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

  /** a blow on spot `i` with a tool of `rate`: the scrap it gives, and how far through the spot it is (1: stripped) */
  blow(i: number, rate: number, now: number): { give: number; done: number } | null {
    const s = this.spots[i];
    if (!s) return null;
    const t = this.taken.get(i) ?? { left: s.scrap, at: now };
    const give = Math.min(t.left, Math.max(1, Math.round(SALVAGE.per * rate)));
    t.left -= give;
    t.at = now;
    this.taken.set(i, t);
    return { give, done: 1 - t.left / s.scrap };
  }

  /** the spots whose time is up and that nobody stands at have their scrap again; their numbers */
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
    return this.taken.get(i)?.left ?? this.spots[i]?.scrap ?? 0;
  }
}
