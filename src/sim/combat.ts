// Damage rules. The server uses these to decide how much a reported hit hurts, so a
// client can say "I hit player 7 in the head with a Mosin" but never "for 5000 damage".

import { CARTRIDGES, GUNS, damageKept, speedAt } from './gunplay';

export type HitZone = 'head' | 'torso' | 'legs';

export interface WeaponRule {
  damage: number;
  melee: boolean;
  /** furthest a hit is believed, metres */
  range: number;
  /** shortest time between hits, seconds */
  interval: number;
  /** damage kept at `range` (bullets lose energy) */
  falloff: number;
  /** a gun: how the air slows what it fires, 1/m. What a hit does at a distance goes by the speed the round has left there (see gunplay.ts), not by a straight line to `falloff`. */
  drag?: number;
  /** an explosion: the damage falls to nothing this many metres from where it went off */
  blast?: number;
  /** a shotgun: `damage` is one pellet's, and no shot is believed to land more than this many */
  pellets?: number;
}

/**
 * The guns' rules, out of the one table the game shoots by (src/sim/gunplay.ts): what a round does is its
 * cartridge's, how fast a gun can hit is its own rate (a bolt's: its cycle), how far a hit is believed is its
 * reach, and what is left of a round at a distance is what its speed there leaves it.
 */
const gunRules = (): Record<string, WeaponRule> =>
  Object.fromEntries(
    Object.entries(GUNS).map(([id, g]) => {
      const c = CARTRIDGES[g.ammo];
      return [id, { damage: c.damage, melee: false, range: g.reach, interval: g.cycle ?? 60 / g.rpm, falloff: damageKept(speedAt(c.drag, g.reach)), drag: c.drag, ...(c.pellets ? { pellets: c.pellets } : {}) }];
    }),
  );

export const WEAPON_RULES: Record<string, WeaponRule> = {
  ...gunRules(),
  fists: { damage: 14, melee: true, range: 3.2, interval: 0.3, falloff: 1 },
  hatchet: { damage: 45, melee: true, range: 3.6, interval: 0.5, falloff: 1 },
  machete: { damage: 38, melee: true, range: 3.8, interval: 0.4, falloff: 1 },
  crowbar: { damage: 42, melee: true, range: 3.7, interval: 0.6, falloff: 1 },
  bat: { damage: 30, melee: true, range: 3.9, interval: 0.5, falloff: 1 },
  shovel: { damage: 36, melee: true, range: 3.9, interval: 0.55, falloff: 1 },
  knife: { damage: 27, melee: true, range: 3.3, interval: 0.3, falloff: 1 },
  grenade: { damage: 150, melee: false, range: 70, interval: 0, falloff: 1, blast: 9 },
  // a fuel drum somebody shot (see src/sim/barrels.ts): whoever fired may be a rifle shot away
  barrel: { damage: 140, melee: false, range: 900, interval: 0, falloff: 1, blast: 8 },
  // run down by a jeep (see src/sim/vehicles.ts): how much it hurts is how fast the jeep was going
  jeep: { damage: 0, melee: true, range: 8, interval: 0.4, falloff: 1 },
  // the arms of one of the infected (see src/sim/infected.ts): never a player's to hit with
  infected: { damage: 13, melee: true, range: 3.4, interval: 1, falloff: 1 },
};

const ZONE: Record<HitZone, [bullet: number, melee: number]> = { head: [3.2, 1.6], torso: [1, 1], legs: [0.6, 0.7] };

export function zoneMultiplier(zone: HitZone, melee: boolean) {
  return ZONE[zone]?.[melee ? 1 : 0] ?? 1;
}

/**
 * Damage of one hit before the victim's armour. `bonus` is flat extra melee damage (gloves).
 * @param pellets how many of a shotgun's pellets are said to have landed (no more are believed than it fires)
 */
export function hitDamage(weapon: string, zone: HitZone, distance: number, suppressed = false, bonus = 0, pellets = 1): number {
  const r = WEAPON_RULES[weapon];
  if (!r) return 0;
  // a blast: `distance` is how far the victim was from it
  if (r.blast) return r.damage * Math.pow(Math.min(1, Math.max(0, 1 - distance / r.blast)), 1.3);
  const k = r.melee ? 1 : r.drag ? damageKept(speedAt(r.drag, distance)) : 1 - (1 - r.falloff) * Math.min(1, Math.max(0, distance) / r.range);
  const base = r.melee ? r.damage + Math.min(10, Math.max(0, bonus)) : r.damage * (suppressed ? 0.9 : 1);
  const n = r.pellets ? Math.max(1, Math.min(r.pellets, Math.floor(pellets) || 1)) : 1;
  return base * k * zoneMultiplier(zone, r.melee) * n;
}
