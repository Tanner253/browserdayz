// The twenty-ninth film: "Friendly" (2026-10-30), a music video under a minute, upright for phones. The owner: "it would be
// cool to make a music video < 60 seconds with dances and animations and gameplay etc make it funny you know". The joke of
// the genre as a song: a man with nothing tells everybody he is friendly and is shot for it, until he has a gun of his own.
// Its song is music29.ts, its voice the preset Vlad on ElevenLabs v4 through Higgsfield (tools/trailer/vo29/<n>.mp3), told
// out here line by line, on the beat.
//   node scripts/film.mjs --cut 29 --tall                                 the take
//   node scripts/film.mjs --cut 29 --tall --draft --no-video --stills 15  a stills draft
import type { Shot, Stage } from './director';
import { frame28 } from './frame28';
import { B, shots29 } from './acts29';
import { BAR29, crack, scoreMusic29, stops } from './music29';

let total = 0;
export const seconds = () => total;

interface Vox {
  /** which line, when, from where in its file, for how long, how fast */
  n: number; at: number; off?: number; len?: number; rate?: number;
  /** shouted by the whole car park: three of him, a little apart */
  crowd?: boolean;
  /** stopped dead here (a shot) */
  cut?: number;
}
const VOX: Vox[] = [
  { n: 1, at: B(0, 0), off: 0.04, len: 0.92 }, { n: 1, at: B(0, 3), off: 1.46, len: 0.92 }, { n: 1, at: B(1, 2), off: 2.7, len: 0.98 }, { n: 1, at: B(2, 1), off: 4.07, len: 1.12 },
  { n: 2, at: B(3, 0), off: 0.24, len: 1.45 },
  { n: 6, at: B(12), off: 0.05 }, { n: 7, at: B(13), off: 0.02 },
  { n: 8, at: B(14), off: 0.08 }, { n: 9, at: B(15), off: 0.07 },
  { n: 10, at: B(16), off: 0.08 }, { n: 11, at: B(16, 3.5), off: 0.04, rate: 1.1 },
  { n: 12, at: B(18), off: 0.07, rate: 1.1 }, { n: 13, at: B(19), off: 0.04, rate: 1.1 },
  { n: 14, at: B(28), off: 0.1 }, { n: 15, at: B(29, 1), off: 0.19 }, { n: 16, at: B(30, 1), off: 0.08 }, { n: 17, at: B(31), off: 0.09 },
  { n: 18, at: B(33, 1), off: 0.09 },
  { n: 19, at: B(39, 0), off: 0.08 },
];
// the hook, shouted: bars of it from the bar it starts on
for (const [h, n] of [[4, 8], [20, 8], [34, 4]]) {
  for (let i = 0; i < n; i++) {
    const b = h + i, cut = h === 4 && i === 7 ? B(11, 1) : undefined;
    // (the last hook's seventh bar is his: the band under one word, and the shot)
    if (h === 20 && i === 6) VOX.push({ n: 19, at: B(b, 0), off: 0.08 });
    else if (i % 2 === 0) VOX.push({ n: 3, at: B(b, 0), off: 0.09, crowd: true }, { n: 3, at: B(b, 2), off: 0.09, crowd: true });
    else {
      VOX.push({ n: i % 4 === 1 ? 4 : 5, at: B(b, 0), off: 0.05, crowd: true, cut });
      if (!cut) VOX.push({ n: 20, at: B(b, 3), off: 0.04, crowd: true });
    }
  }
}
/** the shots on the beat: where each is, and whether everything stops for it */
const CRACKS: [number, boolean][] = [[B(11, 1), true], [B(22, 1), false], [B(23, 1), false], [B(24, 1), false], [B(25, 1), false], [B(25, 3), false], [B(26, 2), true], [B(34, 0), false], [B(39, 2), true]];
const VOICE = new Map<number, AudioBuffer>();

export function score(ctx: BaseAudioContext, out: AudioNode) {
  stops.length = 0;
  for (const [t, stop] of CRACKS) if (stop) stops.push(t);
  const duck = ctx.createGain();
  duck.connect(out);
  scoreMusic29(ctx, duck);
  const press = ctx.createDynamicsCompressor(), near = ctx.createBiquadFilter(), level = ctx.createGain();
  press.threshold.value = -22;
  press.ratio.value = 4;
  press.attack.value = 0.003;
  press.release.value = 0.15;
  near.type = 'peaking';
  near.frequency.value = 2600;
  near.gain.value = 4;
  level.gain.value = 1.5;
  press.connect(near).connect(level).connect(out);
  const room = ctx.createDelay(0.3);
  room.delayTime.value = BAR29 / 8;
  const back = ctx.createGain();
  back.gain.value = 0.22;
  room.connect(back).connect(press);
  const one = (b: AudioBuffer, v: Vox, delay: number, rate: number, gain: number, pan: number) => {
    const src = ctx.createBufferSource(), g = ctx.createGain(), p = ctx.createStereoPanner();
    src.buffer = b;
    src.playbackRate.value = rate;
    g.gain.value = gain;
    p.pan.value = pan;
    src.connect(g).connect(p).connect(press);
    if (v.crowd) g.connect(room);
    const at = v.at + delay, off = v.off ?? 0, last = v.len ?? b.duration - off;
    src.start(at, off, last);
    if (v.cut !== undefined) src.stop(v.cut);
  };
  for (const v of VOX) {
    const b = VOICE.get(v.n);
    if (!b) continue;
    if (v.crowd) {
      one(b, v, 0, 1, 0.85, 0);
      one(b, v, 0.014, 0.985, 0.5, -0.55);
      one(b, v, 0.026, 1.016, 0.5, 0.55);
    } else {
      one(b, v, 0, v.rate ?? 1, 1.05, 0);
    }
    // the words on top: the band comes down under the verses' lines
    if (!v.crowd) {
      const len = (v.len ?? b.duration - (v.off ?? 0)) / (v.rate ?? 1);
      duck.gain.setTargetAtTime(0.5, Math.max(0, v.at - 0.04), 0.03);
      duck.gain.setTargetAtTime(1, v.at + len - 0.08, 0.12);
    }
  }
  for (const [t] of CRACKS) crack(ctx, out, t, t === B(39, 2) || t === B(34, 0) ? 1 : 0.85);
}

export function buildShots(S: Stage): Shot[] {
  const c = frame28(S, (s) => { total = s; });
  const bars = shots29(c);
  // the lines read before anything is filmed
  c.dressers.push(async () => {
    const off = new OfflineAudioContext(2, 48000, 48000);
    for (let n = 1; n <= 20; n++) VOICE.set(n, await off.decodeAudioData(await (await fetch(`/tools/trailer/vo29/${n}.mp3`)).arrayBuffer()));
  });
  c.say(`${c.shots.length} shots, ${bars} bars, ${total.toFixed(1)} s`);
  return c.shots;
}
