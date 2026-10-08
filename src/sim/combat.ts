// Damage rules. The server uses these to decide how much a reported hit hurts, so a
// client can say "I hit player 7 in the head with a Mosin" but never "for 5000 damage".

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
  /** an explosion: the damage falls to nothing this many metres from where it went off */
  blast?: number;
}

export const WEAPON_RULES: Record<string, WeaponRule> = {
  mosin: { damage: 95, melee: false, range: 900, interval: 0.8, falloff: 0.6 },
  p38: { damage: 34, melee: false, range: 220, interval: 0.1, falloff: 0.45 },
  m9: { damage: 34, melee: false, range: 220, interval: 0.1, falloff: 0.45 },
  fists: { damage: 14, melee: true, range: 3.2, interval: 0.3, falloff: 1 },
  hatchet: { damage: 45, melee: true, range: 3.6, interval: 0.5, falloff: 1 },
  machete: { damage: 38, melee: true, range: 3.8, interval: 0.4, falloff: 1 },
  crowbar: { damage: 42, melee: true, range: 3.7, interval: 0.6, falloff: 1 },
  bat: { damage: 30, melee: true, range: 3.9, interval: 0.5, falloff: 1 },
  knife: { damage: 27, melee: true, range: 3.3, interval: 0.3, falloff: 1 },
  grenade: { damage: 150, melee: false, range: 70, interval: 0, falloff: 1, blast: 9 },
  // a fuel drum somebody shot (see src/sim/barrels.ts): whoever fired may be a rifle shot away
  barrel: { damage: 140, melee: false, range: 900, interval: 0, falloff: 1, blast: 8 },
  // run down by a jeep (see src/sim/vehicles.ts): how much it hurts is how fast the jeep was going
  jeep: { damage: 0, melee: true, range: 8, interval: 0.4, falloff: 1 },
};

const ZONE: Record<HitZone, [bullet: number, melee: number]> = { head: [3.2, 1.6], torso: [1, 1], legs: [0.6, 0.7] };

export function zoneMultiplier(zone: HitZone, melee: boolean) {
  return ZONE[zone]?.[melee ? 1 : 0] ?? 1;
}

/** Damage of one hit before the victim's armour. `bonus` is flat extra melee damage (gloves). */
export function hitDamage(weapon: string, zone: HitZone, distance: number, suppressed = false, bonus = 0): number {
  const r = WEAPON_RULES[weapon];
  if (!r) return 0;
  // a blast: `distance` is how far the victim was from it
  if (r.blast) return r.damage * Math.pow(Math.min(1, Math.max(0, 1 - distance / r.blast)), 1.3);
  const k = r.melee ? 1 : 1 - (1 - r.falloff) * Math.min(1, Math.max(0, distance) / r.range);
  const base = r.melee ? r.damage + Math.min(10, Math.max(0, bonus)) : r.damage * (suppressed ? 0.9 : 1);
  return base * k * zoneMultiplier(zone, r.melee);
}
