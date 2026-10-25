// Who a survivor is: which of the bodies, and which voice calls out for them (the owner, 2026-10-24: "we should make
// a higher quality player model and perhaps even variations"; "we can offer multiple voice options for the oplayer to
// pick from in the settings"). Picked by each player, told to the server, and drawn and heard by everybody so.
// Shared by the game and the server: the server takes a pick only if it is one of these.

/** the bodies, by the number a pick is sent as (their files: src/game/survivors.ts) */
export const BODY_NAMES = ['Mikhail', 'Pavel', 'Anya', 'Grigori'] as const;

/** the voices the calls are recorded in (assets/sounds/voices/<id>/<call>.mp3), by the number a pick is sent as */
export const VOICES = [
  { id: 'vlad', name: 'Vlad' },
  { id: 'alexey', name: 'Alexey' },
  { id: 'elena', name: 'Elena' },
  { id: 'olena', name: 'Olena' },
] as const;

/** a pick as anybody may send it: one of `count`, or null */
export const pickOf = (n: unknown, count: number): number | null => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < count ? n : null);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** the body of somebody who has picked none (a game from before there were bodies to pick): by their name, the same for everybody */
export const bodyFor = (name: string): number => hash(name || 'survivor') % BODY_NAMES.length;

/** the voice that goes with a body, until another is picked: a woman's for the woman */
export const voiceFor = (body: number): number => [0, 1, 2, 1][body] ?? 0;

/**
 * The parts of a body that a worn thing hides the skin of, so that nothing pokes through it (src/game/survivors.ts):
 * each body's every point says which it is (scripts/survivors.mjs, markRegions). A thing worn names the parts it covers.
 */
export const REGION = {
  scalp: 0, face: 1, neck: 2, chest: 3, belly: 4, hips: 5,
  /** the upper arm: the half by the shoulder (a short sleeve) and the half by the elbow */
  shoulder: 6, upperArm: 7, forearm: 8, hand: 9,
  /** the thigh: the half by the hip (shorts) and the half by the knee */
  thigh: 10, aboveKnee: 11, shin: 12, foot: 13,
} as const;
export type Region = keyof typeof REGION;
/** the parts named, as the one number the body's paint is told */
export const hides = (parts: readonly Region[]): number => parts.reduce((m, p) => m | (1 << REGION[p]), 0);
