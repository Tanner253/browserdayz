// Gathering (2026-10-24, base building's first step): trees felled for logs, boulders broken for stone, logs sawn into
// planks, and the tools wearing out as they work. The owner: "players will need to harvest trees for logs and then saw
// them for planks and harvest nails from industrial areas etc.."; "tools need durability now... like dayz".
// The rules here are the server's (server/gather.ts) and, played alone, the game's own (src/game/game/gather.ts): one
// `Woods` keeps which trees are down and which rocks are spent, so the two never disagree.

import type { Instance } from '../world/worldgen';

/** the trees an axe bites into: their height (m) and the trunk's radius (m) at scale 1, as their models are (public/assets/trees/trees.json) */
export const TREE_KINDS: Record<string, { height: number; trunk: number }> = {
  pine_a: { height: 19, trunk: 0.39 }, pine_b: { height: 17, trunk: 0.35 }, pine_c: { height: 24, trunk: 0.45 },
  // (the young pine's trunk is measured across its lowest boughs: see Vegetation.build, which caps it the same way)
  pine_d: { height: 13, trunk: 0.5 },
  birch_a: { height: 16, trunk: 0.16 }, birch_b: { height: 14, trunk: 0.14 },
  oak_a: { height: 13, trunk: 0.27 }, ash_a: { height: 15, trunk: 0.38 },
};

export const TREE = {
  /** a felled tree stands again this long after (ms), Rust's forests come back; and only with nobody near enough to see it */
  regrow: 3 * 3600_000,
  unseen: 120,
  /** how far past the trunk's own radius a blow may be told from (the swing's reach, and a step of the player's own lateness) */
  reach: 3.2,
  /** blows forgotten after this long without another (ms): a half-cut tree heals, as nobody comes back to it */
  heal: 10 * 60_000,
  /** ms from the last blow to the tree lying on the ground (src/world/felling.ts): its logs are laid then, not under it as it falls */
  lands: 3800,
};

/** how hard each tool bites into wood (blows a tree takes are its toughness over this) */
export const CHOPS: Record<string, number> = { hatchet: 1, felling_axe: 2.5, stone_hatchet: 0.5 };
/** and into stone */
export const MINES: Record<string, number> = { pickaxe: 1 };
/** what saws a log */
export const SAWS: Record<string, number> = { hand_saw: 1 };

/** A tree's numbers: the blows it takes from a hatchet (a felling axe's bite is CHOPS), and the logs it falls into. */
export function treeOf(t: Instance): { blows: number; logs: number } | null {
  const k = TREE_KINDS[t.kind];
  if (!k) return null;
  return { blows: Math.round(6 + Math.min(k.trunk, 0.5) * t.scale * 40), logs: Math.max(2, Math.min(5, Math.round((k.height * t.scale) / 5.5))) };
}

/** how far from a tree's middle a blow may be told from */
export const treeReach = (t: Instance) => TREE.reach + Math.min(TREE_KINDS[t.kind]?.trunk ?? 0.4, 0.5) * t.scale;

// ---- stone

/** the rocks a pickaxe breaks stone off: boulders and the moss-grown sets, big enough to stand a man's height off the ground */
const STONE_KINDS = new Set(['boulder_01', 'rock_moss_set_01', 'rock_moss_set_02', 'mossy_rock', 'namaqualand_boulder_02', 'namaqualand_boulder_03', 'namaqualand_boulder_04', 'namaqualand_boulder_05']);

export const ROCK = {
  /** the stone a rock gives each blow, and in all before it is spent (scaled by its size: see `rockOf`) */
  perBlow: 3,
  total: 60,
  /** and it has stone to give again this long after (ms); it never goes away (Rust's nodes do: ours are the map's own rocks) */
  refill: 2 * 3600_000,
  reach: 3.4,
};

/** a rock's stone in all: none if it is not a kind that breaks, or too small to be worth it */
export function rockOf(r: Instance): number {
  if (!STONE_KINDS.has(r.kind.split(/[#@]/)[0]) || r.scale < 0.8) return 0;
  return Math.round((ROCK.total * Math.min(2, r.scale)) / 1.2 / ROCK.perBlow) * ROCK.perBlow;
}
export const rockReach = (r: Instance) => ROCK.reach + 0.9 * r.scale;

// ---- planks

export const SAW = {
  /** seconds a log takes, and the planks it gives (DayZ's sawn log) */
  time: 6,
  planks: 6,
  /** how near the log must be to the one sawing it, metres */
  reach: 2.6,
};

// ---- the tools wearing (DayZ's health of an item: Pristine, Worn, Damaged, Badly damaged, Ruined)

/** how many uses a tool has in it, pristine to ruined: a blow, a log sawn (each use takes 1/life of its condition) */
export const TOOL_LIFE: Record<string, number> = { hatchet: 450, felling_axe: 650, pickaxe: 500, hand_saw: 70, hammer: 400,
  // (crafting's: the stone hatchet made by hand, the sledgehammer, and the blades that cut clothes into rags)
  stone_hatchet: 150, sledgehammer: 900, bone_knife: 120, knife: 400, machete: 450 };
/** what nails a base up and takes it down: the building hammer (Rust's), base building's second step */
export const HAMMERS: Record<string, number> = { hammer: 1 };

/** a thing's condition, 1 new: as DayZ names it, and the colour its card shows it in */
export function condition(c: number | undefined): { name: string; colour: string; ruined: boolean } {
  const v = c ?? 1;
  if (v <= 0) return { name: 'Ruined', colour: '#b0413e', ruined: true };
  if (v <= 0.3) return { name: 'Badly damaged', colour: '#e0703c', ruined: false };
  if (v <= 0.5) return { name: 'Damaged', colour: '#e3b448', ruined: false };
  if (v <= 0.7) return { name: 'Worn', colour: '#c9d3a0', ruined: false };
  return { name: 'Pristine', colour: '#6fd6a8', ruined: false };
}

/**
 * A tool's condition after one more use. (Rounded to a hundred-thousandth, so it travels short: rounded to a thousandth,
 * a use of a hatchet's 1/450 went as 0.002, and a tenth of every tool's life was lost to the rounding.)
 */
export const worn = (id: string, c: number | undefined, uses = 1) => {
  const v = (c ?? 1) - uses / (TOOL_LIFE[id] ?? 400);
  return v < 1e-5 ? 0 : Math.round(v * 1e5) / 1e5;
};

// ---- the state

/**
 * Which trees are down and which rocks are spent, and the blows taken by those being worked. Nothing of it is kept over
 * a restart: every tree stands again and every rock is whole (the owner's save has a write budget; a forest is not worth one).
 */
export class Woods {
  /** tree -> when it fell (ms) */
  felled = new Map<number, number>();
  /** tree -> the blows it has taken (as a hatchet's), and when the last landed */
  private cut = new Map<number, { n: number; at: number }>();
  /** rock -> the stone taken off it, and when it was spent (0 while it still has some) */
  private quarry = new Map<number, { taken: number; spent: number }>();

  constructor(public trees: Instance[], public rocks: Instance[]) {}

  /**
   * A blow at tree `i` with a tool that bites `power` (CHOPS). It falls when it has taken its blows: then the logs it
   * gives. Null: no tree to cut (not one, already down).
   */
  chop(i: number, power: number, now: number): { fell: boolean; logs: number; left: number } | null {
    const t = this.trees[i], k = t && treeOf(t);
    if (!k || this.felled.has(i) || !(power > 0)) return null;
    const was = this.cut.get(i);
    const n = (was && now - was.at < TREE.heal ? was.n : 0) + power;
    if (n + 1e-9 >= k.blows) {
      this.cut.delete(i);
      this.felled.set(i, now);
      return { fell: true, logs: k.logs, left: 0 };
    }
    this.cut.set(i, { n, at: now });
    return { fell: false, logs: 0, left: k.blows - n };
  }

  /** A blow at rock `i`: the stone it gives (0 when it is spent) and how much of it is gone now, 0..1. Null: no rock that breaks. */
  mine(i: number, power: number, now: number): { give: number; done: number } | null {
    const r = this.rocks[i], all = r ? rockOf(r) : 0;
    if (!all || !(power > 0)) return null;
    let q = this.quarry.get(i);
    if (q && q.spent && now - q.spent >= ROCK.refill) q = undefined;
    if (q?.spent) return { give: 0, done: 1 };
    const give = Math.min(Math.round(ROCK.perBlow * power), all - (q?.taken ?? 0));
    const taken = (q?.taken ?? 0) + give;
    this.quarry.set(i, { taken, spent: taken >= all ? now : 0 });
    return { give, done: taken / all };
  }

  /** whether a rock has nothing to give now */
  spent(i: number, now: number) {
    const q = this.quarry.get(i);
    return !!q?.spent && now - q.spent < ROCK.refill;
  }

  /** The trees that stand again now (their time is up and nobody is within TREE.unseen of them): taken off the list. */
  regrow(now: number, seen: (x: number, z: number, within: number) => boolean): number[] {
    const back: number[] = [];
    for (const [i, at] of this.felled) {
      const t = this.trees[i];
      if (now - at < TREE.regrow || seen(t.x, t.z, TREE.unseen)) continue;
      this.felled.delete(i);
      back.push(i);
    }
    for (const [i, c] of this.cut) if (now - c.at >= TREE.heal) this.cut.delete(i);
    for (const [i, q] of this.quarry) if (q.spent && now - q.spent >= ROCK.refill) this.quarry.delete(i);
    return back;
  }
}
