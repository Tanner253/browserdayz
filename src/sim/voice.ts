// Talking to whoever is near (src/game/voice.ts): what the server and the game both go by.

export const VOICE = {
  /** how far a voice carries, metres: the server passes it on to nobody further off */
  range: 45,
  /** within this of the speaker a voice is as loud as it gets */
  near: 2,
  /** how fast it falls away between the two (1 would be a straight line: more is quieter sooner) */
  fall: 1.6,
  /** the most one piece of speech may be, bytes (a fiftieth of a second of Opus is about fifty) */
  bytes: 400,
  /**
   * And the most pieces one player may send: `rate` a second over any length of time (speech is fifty), and as
   * many as `burst` at once (a game that stopped for a moment sends what it owes all together, and none of it is
   * to be lost: at seventy in any one second and no more, it was).
   */
  rate: 60,
  burst: 250,
};

/**
 * How loud a voice is heard from so far off, 0..1: all of it beside the speaker, less with every step away, and
 * nothing at the edge of earshot. There is no distance at which it is suddenly there or suddenly gone.
 */
export function loud(metres: number): number {
  const t = Math.min(1, Math.max(0, (metres - VOICE.near) / (VOICE.range - VOICE.near)));
  return Math.pow(1 - t, VOICE.fall);
}
