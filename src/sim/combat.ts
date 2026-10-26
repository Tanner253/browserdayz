// Damage rules. The server uses these to decide how much a reported hit hurts, so a
// client can say "I hit player 7 in the head with a Mosin" but never "for 5000 damage".

import { CARTRIDGES, GUNS, damageKept, speedAt } from './gunplay';
import { CHARGES } from './build/charges';

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
  /** a hit anywhere, at any distance, through any armour, is the end of whoever it lands on (see ONE_SHOT) */
  kill?: boolean;
}

/** what a hit from a gun that always kills does: more than any armour could bring under a whole life */
export const ONE_SHOT = 1000;

/**
 * How many bodies a round goes on through after the first it hits, by its cartridge (the owner, 2026-10-18: "we should
 * have bullet penetration so you can collateral, depending on the bullet caliber. small calibers cannot, while .50bmg
 * can collateral like 5 targets"); and what each body it has gone through leaves of what it does to the next.
 */
export const PIERCE: Record<string, number> = { ammo_556: 1, ammo_739: 1, ammo_762: 2, ammo_127x55: 2, ammo_50bmg: 4 };
export const PIERCE_KEPT = 0.75;
export const pierceOf = (weapon: string) => PIERCE[GUNS[weapon]?.ammo ?? ''] ?? 0;
/** what is left of a hit after so many bodies (as many as its round can have gone through, and no more) */
export const piercedBy = (weapon: string, passed: unknown) => (typeof passed === 'number' && passed > 0 ? PIERCE_KEPT ** Math.min(pierceOf(weapon), Math.floor(passed)) : 1);

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
// (twice the damage and twice the reach it had, 200 within 10 m: the owner, 2026-10-19, "regular grenades t4-5 and do 2x damage and 2x blast radius")
export const FRAG_RULE: WeaponRule = { damage: 400, melee: false, range: 70, interval: 0, falloff: 1, blast: 20, car: 1 };

export const WEAPON_RULES: Record<string, WeaponRule> = {
  ...gunRules(),
  // The two .50s: a hit is the end of anybody (the owner, 2026-10-18: "the l96 and berret should always 1 shot kill and
  // should do lots of damage to vehicles"), and a helicopter takes a whole magazine and one more (2026-10-20: "they do too
  // much damage to vehicles currently, i think it should take 1 mag + 1 to take down a heli with 50 cal"). A helicopter
  // has three quarters of a car's health (HELI.hp), so a hit is 0.75 / (rounds + 0.6) of a car's: six hits for the
  // .50 sniper's five, eleven for the Barrett's ten; a jeep, eight and fifteen. (It was 0.4: two hits a helicopter.)
  ...Object.fromEntries(([['sniper50', 5], ['barrett', 10]] as const).flatMap(([id, rounds]) => (gunRules()[id] ? [[id, { ...gunRules()[id], kill: true, car: 0.75 / (rounds + 0.6) }]] : []))),
  fists: { damage: 14, melee: true, range: 3.2, interval: 0.3, falloff: 1 },
  hatchet: { damage: 45, melee: true, range: 3.6, interval: 0.5, falloff: 1 },
  machete: { damage: 38, melee: true, range: 3.8, interval: 0.4, falloff: 1 },
  crowbar: { damage: 42, melee: true, range: 3.7, interval: 0.6, falloff: 1 },
  bat: { damage: 30, melee: true, range: 3.9, interval: 0.5, falloff: 1 },
  shovel: { damage: 36, melee: true, range: 3.9, interval: 0.55, falloff: 1 },
  pitchfork: { damage: 40, melee: true, range: 4.4, interval: 0.6, falloff: 1 },
  knife: { damage: 27, melee: true, range: 3.3, interval: 0.3, falloff: 1 },
  karambit: { damage: 27, melee: true, range: 3.3, interval: 0.3, falloff: 1 },
  hunting_knife: { damage: 27, melee: true, range: 3.3, interval: 0.3, falloff: 1 },
  bayonet: { damage: 27, melee: true, range: 3.3, interval: 0.3, falloff: 1 },
  // (base building's and crafting's tools hit as what they are: until 2026-10-25 they had no rule here and the server
  // threw away every blow they landed. The owner: "the new shovel and hatchet and EVERYTHING should be a weapon that is a
  // melee weapon in the game". Each as its item's stats say, with the others' slack: reach +1.9 m, blows at 0.7 the rate)
  hand_saw: { damage: 18, melee: true, range: 3.5, interval: 0.49, falloff: 1 },
  felling_axe: { damage: 55, melee: true, range: 3.9, interval: 0.7, falloff: 1 },
  hammer: { damage: 30, melee: true, range: 3.6, interval: 0.42, falloff: 1 },
  pickaxe: { damage: 50, melee: true, range: 3.9, interval: 0.74, falloff: 1 },
  stone_hatchet: { damage: 32, melee: true, range: 3.5, interval: 0.6, falloff: 1 },
  bone_knife: { damage: 20, melee: true, range: 3.3, interval: 0.32, falloff: 1 },
  sledgehammer: { damage: 70, melee: true, range: 4.0, interval: 0.95, falloff: 1 },
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
  // a charge (tuned in src/sim/build/charges.ts, the one place): a wall between stops its blast (server/solid.ts)
  c4: { damage: CHARGES.c4.body.damage, melee: false, range: 70, interval: 0, falloff: 1, blast: CHARGES.c4.body.blast, car: CHARGES.c4.body.car },
  satchel: { damage: CHARGES.satchel.body.damage, melee: false, range: 70, interval: 0, falloff: 1, blast: CHARGES.satchel.body.blast, car: CHARGES.satchel.body.car },
  // run down by a jeep (see src/sim/vehicles.ts): how much it hurts is how fast the jeep was going
  jeep: { damage: 0, melee: true, range: 8, interval: 0.4, falloff: 1 },
  // the arms of one of the infected (see src/sim/infected.ts): never a player's to hit with
  infected: { damage: 13, melee: true, range: 3.4, interval: 1, falloff: 1 },
};

const ZONE: Record<HitZone, [bullet: number, melee: number]> = { head: [3.2, 1.6], torso: [1, 1], legs: [0.6, 0.7], arms: [0.6, 0.7] };

/**
 * The sniper rifle's own figures, by where its round lands and whether the rifle is quieted, before armour. No
 * longer one to the body (the owner, 2026-10-17: "the regular sniper rifle should no longer 1 shot kill since we
 * have better snipers now": the .50s are what kill with one); as in DayZ, a Mosin to a bare head is still the end.
 *   loud, the body: 85; quiet, 65. Two of them.
 *   loud, the head: 140. Bare, capped or masked it is the end; under a helmet (the Combat Helmet's 0.7) it is 98.
 *   quiet, the head: 110: the end of a bare head, not of a helmeted one.
 *   an arm or a leg: 50 loud, 36 quiet.
 * A head is a head at any distance; what the body and the limbs take falls with what speed the round has left.
 * (It was 210 to the body and 304 to the head loud, 2026-10-12: "sniper should be 1 shot to body with no suppressor".)
 */
export const RIFLE_HITS: Record<string, Record<'loud' | 'quiet', Record<HitZone, number>>> = {
  mosin: { loud: { head: 140, torso: 85, legs: 50, arms: 50 }, quiet: { head: 110, torso: 65, legs: 36, arms: 36 } },
  // (the Mosin 91/30, the first two steps' rifle: two thirds of the sniper rifle's to the body, so two at the least and
  // most often three; a bare head still the end, a helmeted one not (the owner, 2026-10-19: "does less damage"). It
  // takes no suppressor: the quiet figures are for one that ever does.)
  mosin9130: { loud: { head: 120, torso: 57, legs: 33, arms: 33 }, quiet: { head: 100, torso: 44, legs: 25, arms: 25 } },
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
  if (r.kill && !r.melee) return ONE_SHOT;
  const own = ownHit(weapon, zone, suppressed, k);
  if (own !== null) return own;
  // (a fitted suppressor takes a tenth off; a can that is part of the gun is in its figure already: Gun.quiet)
  const base = r.melee ? r.damage + Math.min(10, Math.max(0, bonus)) : r.damage * (suppressed && !GUNS[weapon]?.quiet ? 0.9 : 1);
  const n = r.pellets ? Math.max(1, Math.min(r.pellets, Math.floor(pellets) || 1)) : 1;
  return base * k * zoneMultiplier(zone, r.melee) * n;
}
