// Which captured blows each thing to hit with throws, one after another in a run (see fp.ts for how one is shown in
// first person, body.ts in third). Seconds are into the captured movement (public/assets/characters/melee.glb): drawn
// back from `from`, through the middle of the picture at `hit`, home by `to`. The game counts a blow landed 0.35 of the
// way through its swing, and the captured drawing back is played in that much of it. Each was chosen in the sandbox
// (tools/sandbox.html?melee=<id>&n=<n>&strip=8, &fp=1 from the eyes): many of the library's swings are thrown with the
// left arm, with the hands a metre apart, or round behind the head (Sword_Judgment, a spin), and are not used.

import { hasCut, type Cut } from './fp';

/** one hand: a cut right to left at the height of the face, the arm thrown out from the shoulder */
const SLASH: Cut = { clip: 'Right_Hand_Sword_Slash', from: 0.28, hit: 0.57, to: 0.95, lands: { tip: [-0.35, 0.85, -0.4], edge: [-1, -0.1, -0.1] }, reach: [0.38, 0.45] };
/** one hand: drawn up over the shoulder and brought down across the body, right to left */
const CHOP: Cut = { clip: 'Triple_Combo_Attack', from: 1.2, hit: 1.57, to: 1.75, lands: { tip: [-0.25, 0.2, -0.95], edge: [-0.2, -1, 0] }, reach: [0.4, 0.4] };
/** both hands: up over the head and down in front, the body bent over it */
const OVERHEAD: Cut = { clip: 'Heavy_Hammer_Swing', from: 0.75, hit: 1.5, to: 1.75, lands: { tip: [-0.35, 0.1, -0.93], edge: [0, -1, 0.1] }, reach: [0.35, 0.25] };
/** both hands: round from the right at the height of the chest (the right arm's swing: the left closes on the handle) */
const SWEEP: Cut = { clip: 'Reaping_Swing', from: 3.5, hit: 4.15, to: 4.6, lands: { tip: [-0.75, 0.25, -0.6], edge: [-0.6, 0, 0.8] }, reach: [0.4, 0.45] };

/** the families: one hand, a knife (its first person is its own pack's), both hands */
const ONE = [SLASH, CHOP], KNIFE = [SLASH, CHOP], TWO = [OVERHEAD, SWEEP];

export const CUTS: Record<string, Cut[]> = {
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

/** the captured blow a thing throws as the `n`th of a run, if it has any */
export function cutFor(id: string | undefined, n: number): Cut | null {
  const list = id ? CUTS[id] : undefined;
  const c = list?.[n % list.length];
  return hasCut(c) ? c : null;
}
