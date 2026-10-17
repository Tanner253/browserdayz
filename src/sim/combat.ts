// Damage rules. The server uses these to decide how much a reported hit hurts, so a
// client can say "I hit player 7 in the head with a Mosin" but never "for 5000 damage".

import { CARTRIDGES, GUNS, damageKept, speedAt } from './gunplay';

/** `arms`: hit like the legs (less than the body, and nothing worn covers them), and no leg is broken by it */
export type HitZone = 'head' | 'torso' | 'legs' | 'arms';

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
  /** an explosion: the share of a whole car it takes, whatever it does to a body (see `carDamage` in vehicles.ts) */
  car?: number;
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

/**
 * The frag grenade's figures (2026-10-13: "does more damage as the stick grenade", "2 stick grenades or 1 frag
 * grenade blows up a car": a third more at its middle, a metre further, a whole car). Among the rules below since
 * it has been a thing that can be thrown (the item `frag`: src/sim/items.ts): until then it was kept out of them,
 * a rule the server knows being one a doctored game may claim. What the server believes of a blast claimed by
 * either grenade is in src/sim/grenades.ts.
 */
export const FRAG_RULE: WeaponRule = { damage: 200, melee: false, range: 70, interval: 0, falloff: 1, blast: 10, car: 1 };

export const WEAPON_RULES: Record<string, WeaponRule> = {
  ...gunRules(),
  fists: { damage: 14, melee: true, range: 3.2, interval: 0.3, falloff: 1 },
  hatchet: { damage: 45, melee: true, range: 3.6, interval: 0.5, falloff: 1 },
  machete: { damage: 38, melee: true, range: 3.8, interval: 0.4, falloff: 1 },
  crowbar: { damage: 42, melee: true, range: 3.7, interval: 0.6, falloff: 1 },
  bat: { damage: 30, melee: true, range: 3.9, interval: 0.5, falloff: 1 },
  shovel: { damage: 36, melee: true, range: 3.9, interval: 0.55, falloff: 1 },
  pitchfork: { damage: 40, melee: true, range: 4.4, interval: 0.6, falloff: 1 },
  knife: { damage: 27, melee: true, range: 3.3, interval: 0.3, falloff: 1 },
  // (What they do to a car, 2026-10-13: "2 stick grenades or 1 frag grenade blows up a car".)
  grenade: { damage: 150, melee: false, range: 70, interval: 0, falloff: 1, blast: 9, car: 0.5 },
  frag: FRAG_RULE,
  // (a 40 mm grenade from the M32: a frag's blast a little smaller, from as far as it can be fired)
  ammo_40mm: { damage: 180, melee: false, range: 500, interval: 0, falloff: 1, blast: 7, car: 0.8 },
  // a fuel drum somebody shot (see src/sim/barrels.ts): whoever fired may be a rifle shot away. (140 and 8 m until
  // 2026-10-13: "exploding barrels should have larger explosion SFX and do more damage", then "barrell blast radius
  // should be larger with damage gradient": more than a grenade's at its middle, and reaching half as far again,
  // less with every metre as every blast is (see `hitDamage`): 132 at 3 m, 73 at 7, 35 at 10, 5 at 13, none at 14.)
  barrel: { damage: 180, melee: false, range: 900, interval: 0, falloff: 1, blast: 14, car: 0.2 },
  // run down by a jeep (see src/sim/vehicles.ts): how much it hurts is how fast the jeep was going
  jeep: { damage: 0, melee: true, range: 8, interval: 0.4, falloff: 1 },
  // the arms of one of the infected (see src/sim/infected.ts): never a player's to hit with
  infected: { damage: 13, melee: true, range: 3.4, interval: 1, falloff: 1 },
};

const ZONE: Record<HitZone, [bullet: number, melee: number]> = { head: [3.2, 1.6], torso: [1, 1], legs: [0.6, 0.7], arms: [0.6, 0.7] };

/**
 * The sniper rifle's own figures, by where its round lands and whether the rifle is quieted, before armour
 * (2026-10-12: "the sniper with supressors should 1shot headshot a player with no helmet on but not 1 shot with a
 * helmet on, sniper should be 1 shot to body with no suppressor, less damage to legs and arms"). It was a round
 * of 95 like any other, times the part of the body: a hit to the chest left anybody with 5.
 *   loud, the body: 210. Nobody stands up from it but whoever is in the heaviest plates there are, at a distance
 *     (through Heavy Armour's half it is 105 at the muzzle and under a hundred from about fifty metres).
 *   loud, the head: 304, as it always was: the end of anybody but the wearer of a K6-3, who is left with 3.
 *   quiet, the head: 130. Bare, capped or masked it is the end; under a helmet (the Combat Helmet's 0.7) it is 91.
 *   quiet, the body: 80. Two of them.
 *   an arm or a leg: 60 loud, 42 quiet.
 * A head is a head at any distance; what the body and the limbs take falls with what speed the round has left.
 */
export const RIFLE_HITS: Record<string, Record<'loud' | 'quiet', Record<HitZone, number>>> = {
  mosin: { loud: { head: 304, torso: 210, legs: 60, arms: 60 }, quiet: { head: 130, torso: 80, legs: 42, arms: 42 } },
};
/**
 * What a gun with figures of its own does where it landed, or null for a gun that has none.
 * @param kept the share of its damage the round has left at that distance (damageKept)
 */
export function ownHit(weapon: string, zone: HitZone, suppressed: boolean, kept: number): number | null {
  const own = RIFLE_HITS[weapon]?.[suppressed ? 'quiet' : 'loud']?.[zone];
  return own === undefined ? null : zone === 'head' ? own : own * kept;
}

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
  const own = ownHit(weapon, zone, suppressed, k);
  if (own !== null) return own;
  const base = r.melee ? r.damage + Math.min(10, Math.max(0, bonus)) : r.damage * (suppressed ? 0.9 : 1);
  const n = r.pellets ? Math.max(1, Math.min(r.pellets, Math.floor(pellets) || 1)) : 1;
  return base * k * zoneMultiplier(zone, r.melee) * n;
}
