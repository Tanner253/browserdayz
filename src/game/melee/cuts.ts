// Which captured blows each thing to hit with throws, one after another in a run, and its heavy one (held, then let go):
// how one is shown in first person is held-mocap.ts's, in third the body's deeds' (src/game/avatar/deeds.ts). Seconds
// are into the movement as scripts/mocap.mjs keeps it (scripts/mocap-melee.json for melee's own): drawn back from
// `from`, through the middle of the picture at `hit`, home by `to`. The game counts a blow landed 0.35 of the way
// through its swing, and the captured drawing back is played in that much of it. Each was chosen in the sandbox
// (tools/sandbox.html?melee=<id>&n=<n>&strip=8, &fp=1 from the eyes): many of the library's swings are thrown with the
// left arm, with the hands a metre apart, or round behind the head (Sword_Judgment, a spin), and are not used.

import { hasCut, type Cut } from '../held-mocap';

/** one hand: a cut right to left at the height of the face, the arm thrown out from the shoulder */
const SLASH: Cut = { clip: 'slash', from: 0.28, hit: 0.57, to: 0.95, lands: { tip: [-0.35, 0.85, -0.4], edge: [-1, -0.1, -0.1] }, reach: [0.38, 0.45] };
/** one hand: drawn up over the shoulder and brought down across the body, right to left */
const CHOP: Cut = { clip: 'combo', from: 0.1, hit: 0.47, to: 0.65, lands: { tip: [-0.25, 0.2, -0.95], edge: [-0.2, -1, 0] }, reach: [0.4, 0.4] };
/** one hand, heavy: raised high over the right shoulder and brought straight down, as a log is split */
const SPLIT: Cut = { clip: 'chop', from: 1.1, hit: 1.86, to: 2.3, lands: { tip: [-0.2, 0.1, -0.97], edge: [0, -1, 0.1] }, reach: [0.3, 0.35] };
/** both hands, heavy: up over the head and down in front, the body bent over it */
const OVERHEAD: Cut = { clip: 'hammer', from: 0.75, hit: 1.5, to: 1.75, lands: { tip: [-0.35, 0.1, -0.93], edge: [0, -1, 0.1] }, reach: [0.35, 0.25] };
/**
 * Both hands, level, as a bat is swung (the owner's word, 2026-10-25: a baseball swing, both hands on the handle, turned
 * from the hips): from back over the right shoulder round through the middle at the height of the chest, and the
 * backhand home the other way.
 */
const LEVEL: Cut = { clip: 'level', from: 0.2, hit: 0.53, to: 0.85, lands: { tip: [-0.8, 0.2, -0.55], edge: [-0.55, 0, 0.8] }, reach: [0.4, 0.3] };
const BACKHAND: Cut = { clip: 'level', from: 1.0, hit: 1.2, to: 1.42, lands: { tip: [0.8, 0.2, -0.55], edge: [0.55, 0, 0.8] }, reach: [0.4, 0.3] };

/** the families: one hand, a knife (its first person is its own pack's), both hands; the light blows of a run, and the heavy */
const ONE = { light: [SLASH, CHOP], heavy: SPLIT }, KNIFE = { light: [SLASH, CHOP], heavy: CHOP }, TWO = { light: [LEVEL, BACKHAND], heavy: OVERHEAD };

export const CUTS: Record<string, { light: Cut[]; heavy: Cut }> = {
  hatchet: ONE,
  machete: ONE,
  hammer: ONE,
  stone_hatchet: ONE,
  hand_saw: ONE,
  knife: KNIFE,
  hunting_knife: KNIFE,
  bayonet: KNIFE,
  karambit: KNIFE,
  bone_knife: KNIFE,
  bat: TWO,
  crowbar: TWO,
  shovel: TWO,
  pitchfork: TWO,
  felling_axe: TWO,
  pickaxe: TWO,
  sledgehammer: TWO,
};

/** the captured blow a thing throws as the `n`th of a run (or its heavy one), if it has any and it is to hand */
export function cutFor(id: string | undefined, n: number, heavy = false): Cut | null {
  const set = id ? CUTS[id] : undefined;
  const c = heavy ? set?.heavy : set?.light[n % set.light.length];
  return hasCut(c) ? c : null;
}

/**
 * The guard held with something to hit with (the right button), as a moment of a movement: in one fist, the boxer's
 * guard the jab is thrown from (the thing up beside the face, the left fist before the chin); in both, the two-handed
 * parry with the thing up across the face.
 */
export const GUARD = { one: { clip: 'jabR', at: 0 }, two: { clip: 'parry', at: 0.1 } };

/**
 * Something long, off the back and onto it again (the owner's brief, 2026-10-25: "draw and holster"): the library's
 * reach over the shoulder for what is slung there. Drawn: the hand goes up behind the head, the thing is in it from
 * when it closes there (`at` of the way), and comes down to the side. Put away: the other way, gone from the hand as it
 * reaches the back, and the hand comes down empty. A thing carried in a pocket is in the hand at once, as before.
 */
export const DRAW = { draw: { clip: 'drawBack', from: 0.05, hit: 0.55, to: 1.65 }, stow: { clip: 'drawBack', from: 1.65, hit: 0.55, to: 0.05 }, dur: 0.9, at: 0.45 };
