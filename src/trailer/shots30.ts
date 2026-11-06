// The thirtieth film: "The way down" (2026-11-06), for ZONA's X page, the owner: "i need a new marketing trailer to post for
// zona X page". About a minute, 16:9: one survivor down the card chain, live since 2026-11-01, from the green keycard to the
// vault on Level 3 (board marketing/plan-film-30.html, said yes to). Built on film 28's frame; its score is music30.ts.
//   node scripts/film.mjs --cut 30 --still                                   the take
//   node scripts/film.mjs --cut 30 --still --draft --no-video --stills 15     a stills draft
import type { Shot, Stage } from './director';
import { frame28 } from './frame28';
import { shots30 } from './acts30';
import { scoreMusic30 } from './music30';

let total = 0;
let marks: { at: number; len: number; kind: string; under?: boolean; hit?: boolean }[] = [];
export const seconds = () => total;

export function score(ctx: BaseAudioContext, out: AudioNode) {
  scoreMusic30(ctx, out, marks, total);
}

export function buildShots(S: Stage): Shot[] {
  const c = frame28(S, (s) => { total = s; });
  const bars = shots30(c);
  marks = c.marks;
  c.say(`${c.shots.length} shots, ${bars} bars, ${total.toFixed(1)} s`);
  return c.shots;
}
