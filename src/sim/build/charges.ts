// THE ONE PLACE A CHARGE IS TUNED (the owner, 2026-10-25: "raid charges should just work for admins period ... i will
// test the explosives on my own bases and tune their strength and behavior before we release the raiding update").
// Everything a C4 or a satchel charge does is said here and read from here alone: by the raid rules
// (src/sim/build/raid.ts: what it takes off the pieces of a base), by the blast rules (src/sim/combat.ts WEAPON_RULES:
// what it does to bodies, the infected, cars and animals), by the server (server/raid.ts: its fuse and its duds) and by
// the game (src/game/building/raid.ts: its arming, its throw, its beeping). It imports nothing, so anything may read it.
// A change here is a change everywhere at the next start of the server and of the page.

export interface Charge {
  /** what it takes off a piece it is stuck to, by the piece's tier: Frame, Wood, Stone, Metal, Armoured. A piece's
   * health is 60, 500, 1000, 2000, 4000 (pieces.ts TIER_HP): a C4 at 520 takes a wooden wall in one, a stone wall in
   * two, a metal one in four, an armoured one in eight, as Rust's */
  dmg: number[];
  /** how far its blast reaches pieces at all, metres: it falls off in a straight line from full at `edge` to nothing here */
  reach: number;
  /** out to this, metres, a piece takes the whole of it */
  edge: number;
  /** the share of it that reaches any piece but the one it is stuck to (Rust's sharp falloff: one charge in the corner
   * of two walls brings down one, not both, the owner, 2026-10-25: "as to not destroy multiple walls easily with 1 satch
   * placement in the intersection of walls"). 1 is a blast that takes everything in reach alike */
  splash: number;
  /** its fuse, seconds from the moment it leaves the hand, rolled between the first figure and the second (the owner,
   * 2026-10-25: "takes 30 seconds to explode"); nothing goes off in the hand or before it is thrown */
  fuse: [number, number];
  /** the share of them that do not go off when the fuse ends (lit again with F, as Rust's satchel) */
  dud: number;
  /** arming it in the hand, seconds, and how many times the left hand's finger comes down on its keys in that time
   * (the owner: "touching the c4 multiple times like input buttons, and then throwing the C4 like a grenade") */
  arm: number;
  taps: number;
  /** what its blast does to bodies, the infected, cars and animals: the damage at its middle, how far it reaches (metres;
   * it falls off to nothing there, and a wall between stops it), and the share of it a car takes */
  body: { damage: number; blast: number; car: number };
}

export const CHARGES: Record<string, Charge> = {
  c4: {
    dmg: [5000, 520, 520, 520, 520],
    reach: 2.5,
    edge: 0.15,
    splash: 0.1,
    fuse: [30, 30],
    dud: 0,
    arm: 1.7,
    taps: 5,
    body: { damage: 260, blast: 7, car: 0.8 },
  },
  // (crafting's satchel: "a hundred rounds of powder to blow one door". A wooden door is 250: one; a wooden wall two, a
  // stone wall ten, a metal wall twenty-three, as Rust's; its fuse runs from six to twelve seconds, and one in five does
  // not go off. Armed by lighting its fuse: one pull of the cord.)
  satchel: {
    dmg: [5000, 260, 105, 90, 90],
    reach: 2,
    edge: 0.15,
    splash: 0.1,
    fuse: [6, 12],
    dud: 0.2,
    arm: 0.9,
    taps: 1,
    body: { damage: 160, blast: 5, car: 0.4 },
  },
};

/** how far a charge is believed thrown, as a grenade is (src/sim/grenades.ts NADE): its stuck place no further from
 * where it left the hand than its speed and its fall can have carried it, give or take this many metres */
export const THROWN_SLACK = 2;
