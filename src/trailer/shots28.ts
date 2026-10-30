// The twenty-eighth film: "Keep what you kill" (2026-10-30), about 1:40, 1080p60. The owner: "I need a trailer for zona,
// maybe 1:30 long, should show all the updates since last trailer, from the animals to the weapons to the base building
// etc.... its supposed to be exciting and make people wanna play zona"; "talk about how much paid out as well and the
// mechanic of how to earn etc... we want to summarize zona while showing off the new content and get people to join and
// play the game"; "also shoe horn in heli flying in there and the bunker keycard swiping etc... just make sure our game
// is well represented completely and fully, maybe show the arial view of the towns too etc.. people wanna see content
// density"; "for karambit only show the model dont show in hand"; "no glitching no flying cars or characters or cars
// clipping into eachother etc... please just make sure the trailer shows authentic gameplay". Board: marketing/plan-film-28.html.
//   node scripts/film.mjs --cut 28                                  the take
//   node scripts/film.mjs --cut 28 --draft --no-video --stills 15   a stills draft (add --from A --to B for a stretch)
//   tools/trailer.html?cut=28&scout=1                               the towns and the ground to build on (scout28.ts)
import type { Shot, Stage } from './director';
import { frame28 } from './frame28';
import { actNothing, actWild } from './acts28-wild';
import { actWorld } from './acts28-world';
import { actBuild } from './acts28-base';
import { actGetIn, actPaid, actRaid } from './acts28-fight';
import { scout } from './scout28';
import { BAR28, scoreMusic28, type Row28 } from './music28';

let total = 0;
export const seconds = () => total;

const ROWS: Row28[] = [];
/**
 * The narrator (ElevenLabs v4 through Higgsfield, the voice Gideon, tools/trailer/vo/vo-<n>.mp3): which line, on which
 * shot, how far into it. "A hard voice": the music comes down under each line and the game's own sound does not.
 */
const LINES: [number, string, number][] = [
  [1, 'coast', 0.9], [2, 'first-loot', 0.3], [3, 'wolves', 0.1], [4, 'lift-off', 0.9], [5, 'fort', 0.2], [6, 'chop', 0.5], [7, 'raiders', 0.2],
  [8, 'zona-kill', 0.1], [9, 'hold', 0.1], [10, 'board-paid', 0.3], [11, 'end', 0.4], [12, 'end', 3.6],
];
const VOICE = new Map<number, AudioBuffer>();
const LINE_AT: { n: number; at: number }[] = [];

export function score(ctx: BaseAudioContext, out: AudioNode) {
  const duck = ctx.createGain();
  duck.connect(out);
  scoreMusic28(ctx, duck, ROWS);
  const press = ctx.createDynamicsCompressor(), near = ctx.createBiquadFilter(), low = ctx.createBiquadFilter(), level = ctx.createGain();
  press.threshold.value = -20;
  press.ratio.value = 3.5;
  press.attack.value = 0.004;
  press.release.value = 0.18;
  near.type = 'peaking';
  near.frequency.value = 2800;
  near.gain.value = 3;
  low.type = 'lowshelf';
  low.frequency.value = 160;
  low.gain.value = 2.5;
  level.gain.value = 1.15;
  press.connect(near).connect(low).connect(level).connect(out);
  for (const { n, at } of LINE_AT) {
    const b = VOICE.get(n);
    if (!b) continue;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(press);
    src.start(at);
    duck.gain.setTargetAtTime(0.42, Math.max(0, at - 0.12), 0.05);
    duck.gain.setTargetAtTime(1, at + b.duration - 0.1, 0.22);
  }
}

export function buildShots(S: Stage): Shot[] {
  if (new URLSearchParams(location.search).has('scout')) {
    const r = scout(S, (s) => console.log(`[tr] ${s}`));
    total = r.seconds;
    return r.shots;
  }
  const c = frame28(S, (s) => { total = s; });
  actNothing(c);
  actWild(c);
  actWorld(c);
  actBuild(c);
  actRaid(c);
  actPaid(c);
  actGetIn(c);
  // the narrator's lines read before anything is filmed
  c.dressers.push(async () => {
    const off = new OfflineAudioContext(2, 48000, 48000);
    for (const [n] of LINES) VOICE.set(n, await off.decodeAudioData(await (await fetch(`/tools/trailer/vo/vo-${n}.mp3`)).arrayBuffer()));
  });
  for (const [n, name, t] of LINES) {
    const shot = c.shots.find((q) => q.name === name);
    if (shot) LINE_AT.push({ n, at: shot.start + t });
    else c.say(`no shot ${name} for line ${n}`);
  }
  // the score under the cut, bar by bar: each bar plays the part of the shot it begins in, a blow where a part begins
  const bars = Math.round(total / BAR28), m = c.marks;
  ROWS.length = 0;
  const kindAt = (t: number) => [...m].reverse().find((x) => x.at <= t + 1e-6)!;
  for (let b = 0; b < bars; b++) {
    const here = kindAt(b * BAR28), next = kindAt((b + 1) * BAR28);
    let run = 0, left = 0;
    while (b - run - 1 >= 0 && kindAt((b - run - 1) * BAR28).kind === here.kind) run++;
    while (b + left + 1 < bars && kindAt((b + left + 1) * BAR28).kind === here.kind) left++;
    const first = !run;
    ROWS.push({ kind: here.kind, hit: first ? 0.85 : here.hit && Math.abs(here.at - b * BAR28) < 0.02 ? 0.55 : undefined, lift: next.kind !== here.kind ? 1 : undefined, build: run / Math.max(1, run + left), under: here.under || undefined });
  }
  c.say(`${c.shots.length} shots, ${total.toFixed(1)} s, ${bars} bars of score`);
  return c.shots;
}
