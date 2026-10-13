// The flames of a fire: the ones that came with the campfire, moving the way they came, mended.
//
// What the download has ("Campfire" by Zelad, CC BY 4.0: scripts/flames.mjs writes it out as it came) is
// twenty-nine flat cards, each showing one still photograph cut from a sheet of them (seven big flames, four
// small ones, three runs of flame along a log, fourteen wisps of smoke and one tall curl of it), and one
// movement three and three-quarter seconds long in which every card slides up out of the wood, swells, and
// shrinks to nothing. Played as it came it is a poor fire, and why is plain from its keys:
//   - every card keeps the one time, so the whole fire swells ONCE a loop: next to nothing at the start, a blaze
//     two seconds in, next to nothing again;
//   - the loop is not closed: seven cards end somewhere else than they begin, and jump at the turn;
//   - the cards are cut out hard, stand as flat sheets (edge on from two sides), and wait their turn parked
//     under the ground, where they show wherever the ground falls away.
//
// What is kept: every card, its picture, and its own movement (where it goes, how it swells and shrinks, how it
// turns), frame for frame. What is mended:
//   - each card is played over its own RUN only (the frames in which it is there to be seen) and round again,
//     on its own time, and most of them twice over, half a run apart: as one of the pair fades the other is at
//     its fullest, so the fire as a whole burns level, and no two cards keep step for long;
//   - each fades in at the start of its run and out at the end of it, so nothing is seen to jump back;
//   - the pictures are laid on softly by their own alpha, a body that hides what is behind it with a little
//     light added over it (a flame that only ADDS its light is a pale mist on sunlit grass), and nothing of a
//     card is drawn below the foot of its fire;
//   - a flame turns about its own upright to face the eye, and leans over toward it when it is looked down on,
//     so it is never seen edge on; the runs of flame along the logs lie as the download laid them.
// What is added, because a photograph slid upward is still a photograph: the place each point of a card reads
// its picture from is pushed about by a pattern that climbs (the flame's own shapes run up through it, held at
// the foot and free at the tip), and the top of each card sways a little.
//
// Any number of fires, each a place, a size (1 is the campfire's own, in its ring 1.45 m across), a strength and
// a lean; every card of every fire in sight is one draw. A fire that is out, or too far off, costs nothing.
//
//   const fire = flames.add(place, { size: 0.3 });   // a stove's worth
//   fire.strength = 1;                               // and 0 puts it out; `fire.at` may be moved every frame
//   flames.remove(fire);
// or, for whoever says every frame what burns and keeps nothing else: `flames.feed(holder, place)`.

import * as THREE from 'three';
import { assets } from '../core/assets';
import type { Atmosphere } from '../world/atmosphere';

const ART = { sheet: 'assets/fx/flames.webp', cards: 'assets/fx/flames.json' };
/** cards drawn at once, of all fires together (one campfire is about fifty) */
const MOST = 640;

/** what `scripts/flames.mjs` writes: see there */
export interface FlameCards {
  size: number;
  fps: number;
  frames: [number, number];
  cards: { name: string; rect: number[]; c: number[]; ax: number[]; ay: number[]; rest: Keyed; keys: { p?: Keys; q?: Keys; s?: Keys } }[];
}
interface Keyed { p: number[]; q: number[]; s: number[] }
interface Keys { t: number[]; v: number[] }

/** flame: a big one in the heart of the fire. tongue: a small one that breaks off and climbs. lick: a run of flame along a log. wisp, curl: smoke. */
export type Kind = 'flame' | 'tongue' | 'lick' | 'wisp' | 'curl';
/** which of the download's cards is which, by its place in the download (fire_part_00 to fire_part_028) */
const KIND_OF = (i: number): Kind => (i <= 6 ? 'flame' : i <= 10 ? 'tongue' : i <= 13 ? 'lick' : i <= 27 ? 'wisp' : 'curl');
/**
 * How each kind is played.
 *   twice  – how many of each card burn at once, evenly apart in its run
 *   slow   – its run takes this many times as long as the download gave it (the big flames a little longer: a
 *            flame a metre high that comes and goes in a second and a half is a flare, not a fire)
 *   rise, fall – the shares of its run it fades in over and out over. Half and half is a pair whose strengths
 *            always add up to one
 *   turned – it turns to face the eye about its own upright (or it lies as the download laid it)
 *   smoke  – it is smoke: lit by the hour and not by itself
 *   seen   – how far off it is still drawn, metres, for a fire of size 1
 *   sway   – how far its top swings to either side, of its own height
 *   gone   – it is let go between these two heights, metres over the foot of a fire of size 1 (the small flames
 *            are carried by the download two metres and more over the wood, shrinking as they go: a flame the
 *            size of a hand hanging in the air over a fire is not a flame that broke off it)
 */
const PLAY: Record<Kind, { twice: number; slow: number; rise: number; fall: number; turned: boolean; smoke: boolean; seen: number; sway: number; gone?: [number, number] }> = {
  flame: { twice: 3, slow: 1.35, rise: 0.5, fall: 0.5, turned: true, smoke: false, seen: 190, sway: 0.05 },
  tongue: { twice: 2, slow: 1.15, rise: 0.18, fall: 0.72, turned: true, smoke: false, seen: 90, sway: 0.08, gone: [0.8, 1.3] },
  lick: { twice: 2, slow: 1.0, rise: 0.5, fall: 0.5, turned: false, smoke: false, seen: 60, sway: 0.03 },
  wisp: { twice: 1, slow: 1.5, rise: 0.25, fall: 0.5, turned: true, smoke: true, seen: 45, sway: 0.1 },
  curl: { twice: 2, slow: 1.7, rise: 0.35, fall: 0.5, turned: true, smoke: true, seen: 60, sway: 0.06 },
};
/** a card is there to be seen in a frame when it is at least this share of its own greatest size, and its top is this far above the ground, metres */
const THERE = { size: 0.2, above: 0.03 };

/** one of the download's cards got ready to be played */
interface Card {
  kind: Kind;
  /** where on the sheet its picture is, as the card stands in the world: left, the row at its foot, right, the row at its top (0 to 1) */
  rect: [number, number, number, number];
  /** for every frame of the download's loop, nine numbers: its middle, the half of it that runs to its right, the half that runs up it; metres from the middle of the ring at the ground */
  poses: Float32Array;
  /** its run: the first and the last frame it is played over, counted from the first frame of the loop */
  from: number;
  to: number;
}
/** one card burning: a card, and where in its run it is when the clock is at nothing */
interface Part {
  card: Card;
  seconds: number;
  ahead: number;
  /** its own number, 0 to 1: what its sway and the pattern that runs through it are told apart by */
  own: number;
  /** how strong its fire must be before it is seen at all (the tallest go first as a fire dies) */
  needs: number;
}
export interface Plan {
  frames: number;
  cards: Card[];
  parts: Part[];
}

const turned = (q: number[], a: number, b: number, c: number): [number, number, number] => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  return [a + w * tx + (y * tz - z * ty), b + w * ty + (z * tx - x * tz), c + w * tz + (x * ty - y * tx)];
};
/** a run of keys at a whole frame: straight lines between keys, held before the first and after the last (as the download plays them) */
function keyAt(keys: Keys | undefined, rest: number[], frame: number, wide: number): number[] {
  if (!keys) return rest;
  const { t, v } = keys, n = t.length;
  if (frame <= t[0]) return v.slice(0, wide);
  if (frame >= t[n - 1]) return v.slice((n - 1) * wide, n * wide);
  let k = 0;
  while (t[k + 1] < frame) k++;
  const u = (frame - t[k]) / (t[k + 1] - t[k]);
  const out: number[] = [];
  for (let e = 0; e < wide; e++) out.push(v[k * wide + e] + (v[(k + 1) * wide + e] - v[k * wide + e]) * u);
  if (wide === 4) {
    const l = Math.hypot(...out) || 1;
    return out.map((x) => x / l);
  }
  return out;
}

/** The download's cards and their movement, got ready: every card stood in every frame, the run of each found, and the list of what burns. */
export function plan(data: FlameCards): Plan {
  const first = data.frames[0], frames = data.frames[1] - first + 1;
  const cards: Card[] = data.cards.map((c, i) => {
    const poses = new Float32Array(frames * 9);
    let most = 0, at = 0;
    for (let f = 0; f < frames; f++) {
      const p = keyAt(c.keys.p, c.rest.p, first + f, 3), q = keyAt(c.keys.q, c.rest.q, first + f, 4), s = keyAt(c.keys.s, c.rest.s, first + f, 3);
      const mid = turned(q, c.c[0] * s[0], c.c[1] * s[1], c.c[2] * s[2]);
      const U = turned(q, c.ax[0] * s[0], c.ax[1] * s[1], c.ax[2] * s[2]), V = turned(q, c.ay[0] * s[0], c.ay[1] * s[1], c.ay[2] * s[2]);
      poses.set([p[0] + mid[0], p[1] + mid[1], p[2] + mid[2], ...U, ...V], f * 9);
      const big = Math.hypot(...U) * Math.hypot(...V);
      if (big > most) {
        most = big;
        at = f;
      }
    }
    // Every picture on the sheet is the other way up from the way its card stands: the half that "runs up" the
    // picture points at the ground. Here it is made the half that runs up the card, and the picture's rows are
    // read the other way to match, so that whatever stands a card can speak of its foot and its top.
    const down = poses[at * 9 + 7] < 0;
    if (down) for (let f = 0; f < frames; f++) for (let e = 6; e < 9; e++) poses[f * 9 + e] = -poses[f * 9 + e];
    const [l, t, r, b] = c.rect.map((x) => x / data.size);
    // its run: the longest unbroken stretch of frames in which it is there to be seen
    let from = 0, to = -1, start = -1;
    for (let f = 0; f <= frames; f++) {
      const o = f * 9;
      const there = f < frames && Math.hypot(poses[o + 3], poses[o + 4], poses[o + 5]) * Math.hypot(poses[o + 6], poses[o + 7], poses[o + 8]) > most * THERE.size * THERE.size && poses[o + 1] + Math.abs(poses[o + 7]) + Math.abs(poses[o + 4]) > THERE.above;
      if (there && start < 0) start = f;
      if (!there && start >= 0) {
        if (f - 1 - start > to - from) [from, to] = [start, f - 1];
        start = -1;
      }
    }
    // (a frame to either side, where it is next to nothing: it comes from nothing and goes to nothing)
    return { kind: KIND_OF(i), rect: down ? [l, t, r, b] : [l, b, r, t], poses, from: Math.max(0, from - 1), to: Math.min(frames - 1, to + 1) };
  });
  const parts: Part[] = [];
  const tallest = (c: Card) => {
    let top = 0;
    for (let f = c.from; f <= c.to; f++) top = Math.max(top, c.poses[f * 9 + 1] + c.poses[f * 9 + 7]);
    return top;
  };
  const tops = cards.filter((c) => c.kind === 'flame' || c.kind === 'tongue').map(tallest).sort((a, b) => a - b);
  cards.forEach((card, i) => {
    const how = PLAY[card.kind];
    for (let k = 0; k < how.twice; k++) {
      // (each card begins somewhere of its own in its run: 0.618… apart, which never comes round to the same place)
      const own = (i * 0.61803 + k * 0.37) % 1;
      // the taller a flame stands, the sooner a dying fire loses it; what lies along the wood, and the smoke, stay to the last
      const rank = card.kind === 'flame' || card.kind === 'tongue' ? tops.indexOf(tallest(card)) / Math.max(1, tops.length - 1) : 0;
      parts.push({ card, seconds: (Math.max(1, card.to - card.from) / data.fps) * how.slow, ahead: (own + k / how.twice) % 1, own, needs: rank * 0.6 });
    }
  });
  // (smoke first: a flame is drawn over the smoke behind it and not the other way about)
  parts.sort((a, b) => Number(PLAY[b.card.kind].smoke) - Number(PLAY[a.card.kind].smoke));
  return { frames, cards, parts };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** a fire, as whoever stood it has it */
export interface Fire {
  /** where its foot is: nothing of it is drawn below this. May be moved at any time */
  readonly at: THREE.Vector3;
  /** 1 is the campfire's own, in its ring 1.45 m across */
  size: number;
  /** 0 out (and then it costs nothing), 1 burning well; between, a fire starting or dying down: lower, and fewer flames */
  strength: number;
  /** how it is turned about the upright, radians: what it burns in may be turned (the ring of a campfire) */
  turn: number;
  /** how far it is pushed sideways for every metre it climbs: the wind, or the tilt of what burns */
  readonly lean: THREE.Vector3;
  /** how bright, about 1: whoever lights the ground from it says how the lamp flickers, so that the two agree */
  glow: number;
  /** how much of the download's own smoke rises off it: 0 none (something else smokes for it), 1 as it came */
  smoke: number;
  /** how far off it is drawn, of what its size would give (a fire that gives a place away is seen from further than one in a stove) */
  far: number;
  /** its own number: no two fires burn in step */
  readonly own: number;
  /** set when it has been taken away: whoever still holds it must ask for another */
  gone: boolean;
  fed: boolean;
  kept: boolean;
}

/**
 * The cards of one fire as they stand at a moment, each told to `card`: its middle, its two halves (metres, about
 * the fire's foot, before the fire is sized, turned or leant), how strongly it shows, and which part it is.
 * @param far how far off the eye is, metres (kinds too small to be seen from there are left out)
 */
export function burning(p: Plan, clock: number, fire: { strength: number; smoke: number; own: number; size: number }, far: number, card: (part: Part, pose: Float32Array, shows: number) => void) {
  const pose = _pose;
  // (it sinks as it dies: at its last it stands under half as high)
  const tall = 0.42 + 0.58 * fire.strength;
  for (const part of p.parts) {
    const c = part.card, how = PLAY[c.kind];
    if (far > how.seen * fire.size) continue;
    let shows = how.smoke ? fire.smoke * smooth(0, 0.25, fire.strength) : smooth(part.needs, part.needs + 0.3, fire.strength);
    if (shows <= 0.004) continue;
    let u = (clock + fire.own * 40) / part.seconds + part.ahead;
    u -= Math.floor(u);
    shows *= smooth(0, how.rise, u) * smooth(0, how.fall, 1 - u);
    if (shows <= 0.004) continue;
    const x = c.from + u * (c.to - c.from), k = Math.min(p.frames - 2, Math.floor(x)), w = x - k, o = k * 9;
    for (let e = 0; e < 9; e++) pose[e] = c.poses[o + e] + (c.poses[o + 9 + e] - c.poses[o + e]) * w;
    if (how.gone && (shows *= 1 - smooth(how.gone[0], how.gone[1], pose[1])) <= 0.004) continue;
    if (!how.smoke) {
      pose[1] *= tall;
      pose[6] *= tall; pose[7] *= tall; pose[8] *= tall;
    }
    card(part, pose, shows);
  }
}
const _pose = new Float32Array(9);

/**
 * The pattern the pictures are pushed about by: two numbers, each 0 to 1, that vary smoothly over a square and
 * meet themselves at its edges (so it can be laid end to end, and run upward for ever).
 */
export function ripple(size = 64): Uint8Array {
  let seed = 0x5eed;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < 2; ch++) {
    // (a coarse lattice of chance and one twice as fine at half the strength, each smoothed between its points)
    const lattices = [8, 16].map((n) => ({ n, v: Array.from({ length: n * n }, rnd) }));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0, span = 0;
        lattices.forEach(({ n, v }, k) => {
          const fx = (x / size) * n, fy = (y / size) * n, x0 = Math.floor(fx), y0 = Math.floor(fy);
          const ux = smooth(0, 1, fx - x0), uy = smooth(0, 1, fy - y0);
          const at = (i: number, j: number) => v[(j % n) * n + (i % n)];
          const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * ux, b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * ux;
          sum += (a + (b - a) * uy) / (k + 1);
          span += 1 / (k + 1);
        });
        out[(y * size + x) * 4 + ch] = Math.round((sum / span) * 255);
      }
    }
  }
  for (let k = 0; k < size * size; k++) out[k * 4 + 3] = 255;
  return out;
}

/**
 * How a card is drawn. The same numbers are used by whatever draws one away from the game (the check that the
 * fire burns level reads the same plan; the picture of it is the game's own).
 *   flow   – the pattern the picture is pushed about by: how many times it repeats in a metre, how fast it climbs
 *            (repeats a second), and how far it pushes, metres; coarse, then fine
 *   foot   – a card fades in over this many metres above the foot of its fire (times the fire's size)
 *   glow   – the light added over the body of a flame, of the flame's own colour
 *   edge   – the outermost share of a card that fades to nothing: the picture pushed sideways never shows the card's square
 *   steep  – the steepest a flame is ever seen from, as how much of the look is along its upright (see the shader)
 *   red    – how bright a flame's red is, where its photograph is darkest and where it is brightest
 *   green  – how much of the photograph's own green (against its red) is kept: its yellow is its green
 *   blue   – a flame's blue, of its red: LESS THAN NOTHING. The game's picture is finished by a curve (AgX) that
 *            bleeds every colour into the others before it squeezes them: an orange as pure as a colour can be
 *            said comes out salmon, and a bright one comes out cream (the tan fog this replaces was that). A
 *            blue below nothing is what is left an orange once the bleeding is done. The picture is kept in
 *            numbers that can be below nothing until that curve, and whatever shows behind a flame is added in
 *            the ordinary way.
 */
export const LOOK = { flow: [[0.62, 0.5, 0.2], [1.7, 0.95, 0.07]], foot: 0.09, glow: 0.1, edge: 0.1, steep: 0.82, red: [0.55, 2.3], green: 0.8, blue: -0.11 };

const VERT = /* glsl */ `
  attribute vec3 iMid;
  attribute vec3 iRight;
  attribute vec3 iUp;
  attribute vec4 iRect;
  attribute vec4 iLook;
  attribute vec4 iFire;
  uniform float uTime;
  varying vec2 vOn;
  varying vec4 vRect;
  varying vec4 vLook;
  varying vec4 vFire;
  varying vec2 vHalf;
  const float STEEP = ${LOOK.steep.toFixed(3)};
  void main() {
    vec3 mid = iMid, right = iRight, up = iUp;
    float wide = length( right ), tall = length( up );
    vec3 eye = normalize( cameraPosition - mid );
    float seen = 1.0;
    if ( iLook.y > 0.5 ) {
      // Turned about its own upright to face the eye: seen from the side it is square on, and looked down on it
      // is as much shorter as a thing standing upright is. Looked down on (or up at) more steeply than STEEP,
      // that would thin it to a line: from there on it is leant back about its foot, just far enough to be seen
      // no more edge on than at STEEP. From right over a fire its flames are short tongues, each lying a little
      // its own way.
      vec3 foot = mid - up;
      vec3 stand = up / tall;
      float along = dot( stand, eye );
      if ( abs( along ) > STEEP ) {
        float way = iLook.z * 31.4;
        vec3 across = stand - eye * along + vec3( cos( way ), 0.0, sin( way ) ) * 0.03;
        across = normalize( across - eye * dot( across, eye ) );
        stand = eye * ( sign( along ) * STEEP ) + across * sqrt( 1.0 - STEEP * STEEP );
      }
      right = normalize( cross( stand, eye ) ) * wide;
      up = stand * tall;
      mid = foot + up;
    } else {
      // (as it was laid: seen edge on it is let go to nothing, not left as a bright line)
      seen = smoothstep( 0.05, 0.4, abs( dot( normalize( cross( right, up ) ), eye ) ) );
    }
    float h = position.y * 0.5 + 0.5;
    float sway = sin( uTime * ( 1.6 + iLook.z * 1.7 ) + iLook.z * 40.0 ) * 0.65 + sin( uTime * 4.3 + iLook.z * 17.0 ) * 0.35;
    vec3 p = mid + right * position.x + up * position.y + ( right / wide ) * ( sway * iFire.z * h * h * tall * 2.0 );
    vOn = position.xy;
    vRect = iRect;
    vLook = vec4( iLook.x * seen, iLook.yzw );
    vFire = vec4( p.y - iFire.x, iFire.yzw );
    vHalf = vec2( wide, tall );
    gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
  }`;
const FRAG = /* glsl */ `
  uniform sampler2D tSheet;
  uniform sampler2D tRipple;
  uniform float uTime;
  uniform float uDaylight;
  uniform vec3 uFlowA;
  uniform vec3 uFlowB;
  uniform vec3 uSoft;
  varying vec2 vOn;
  varying vec4 vRect;
  varying vec4 vLook;
  varying vec4 vFire;
  varying vec2 vHalf;
  void main() {
    vec2 on = vOn * 0.5 + 0.5;
    float smoke = vLook.w;
    // The picture is a still. What moves in it is where each point of the card reads it from: pushed about by a
    // pattern that climbs the card, hardly at all at the foot (which the wood holds) and freely at the tip.
    vec2 at = vOn * vHalf;
    float slow = mix( 1.0, 0.45, smoke );
    vec2 a = texture2D( tRipple, at * uFlowA.x + vec2( vLook.z * 3.7, vLook.z * 5.3 - uTime * uFlowA.y * slow ) ).rg - 0.5;
    vec2 b = texture2D( tRipple, at * uFlowB.x + vec2( vLook.z * 9.1, vLook.z * 2.9 - uTime * uFlowB.y * slow ) ).gr - 0.5;
    vec2 push = ( a * uFlowA.z + b * uFlowB.z ) * ( 0.2 + 0.8 * on.y );
    vec2 from = on + push / ( 2.0 * vHalf );
    float edge = smoothstep( 0.0, uSoft.x, from.x ) * smoothstep( 0.0, uSoft.x, 1.0 - from.x ) * smoothstep( 0.0, uSoft.x, 1.0 - from.y ) * smoothstep( 0.0, uSoft.x * 0.5, from.y );
    vec4 t = texture2D( tSheet, mix( vRect.xy, vRect.zw, clamp( from, 0.0, 1.0 ) ) );
    float alpha = t.a * edge * vLook.x * smoothstep( 0.0, vFire.w, vFire.x );
    if ( alpha < 0.004 ) discard;
    vec3 colour;
    float light = 0.0;
    if ( smoke > 0.5 ) {
      // smoke has no light of its own: it is as bright as the hour, and near the fire by night a little of the fire's colour
      float pale = ( t.r + t.g + t.b ) / 3.0;
      colour = vec3( 0.5, 0.49, 0.47 ) * ( 0.35 + 0.65 * pale ) * uDaylight + vec3( 0.55, 0.2, 0.04 ) * exp( -vFire.x * 1.3 ) * ( 1.0 - uDaylight ) * 0.6;
      alpha *= 0.55;
    } else {
      // A flame photographed against black is dark at its thin edges, where a flame is only thin: there its
      // alpha is taken down, and its colour is not left a brown rim. What the photograph gives is how HOT each
      // point is (how bright it is there) and how yellow (how much green it has to its red: never white, which
      // is its haze); the colour itself is made from those two, for the curve the picture is finished by (see LOOK).
      float hot = max( t.r, max( t.g, t.b ) );
      float body = smoothstep( 0.02, 0.5, hot );
      float heat = smoothstep( 0.03, 0.75, dot( t.rgb, vec3( 0.3, 0.6, 0.1 ) ) );
      float red = mix( ${LOOK.red[0].toFixed(3)}, ${LOOK.red[1].toFixed(3)}, heat ) * vFire.y;
      colour = vec3( red, red * min( t.g / max( t.r, 0.001 ), 0.62 ) * ${LOOK.green.toFixed(3)}, red * ${LOOK.blue.toFixed(3)} );
      // (the faintest of its alpha is the haze round a flame cut out of its photograph, a square of it: let go)
      alpha *= mix( 0.3, 1.0, body ) * smoothstep( 0.02, 0.24, t.a );
      light = uSoft.z;
    }
    // (the body hides what is behind it; the light is laid over that)
    gl_FragColor = vec4( colour * alpha * ( 1.0 + light ), alpha );
  }`;

export class Flames {
  /** every card of every fire, in one draw */
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private fires: Fire[] = [];
  private plan: Plan | null = null;
  private clock = 0;
  private mid: Float32Array;
  private right: Float32Array;
  private up: Float32Array;
  private rect: Float32Array;
  private look: Float32Array;
  private fire: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  private time = { value: 0 };
  /** frames yet for which one card of no size is drawn: the sheet is put on the graphics card then, and not in the frame the first fire is lit */
  private warming = 0;

  constructor(scene: THREE.Scene, atmo: Atmosphere) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = (name: string, wide: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MOST * wide), wide);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.attrs = [attr('iMid', 3), attr('iRight', 3), attr('iUp', 3), attr('iRect', 4), attr('iLook', 4), attr('iFire', 4)];
    [this.mid, this.right, this.up, this.rect, this.look, this.fire] = this.attrs.map((a) => a.array as Float32Array);
    geo.instanceCount = 0;
    const pattern = new THREE.DataTexture(ripple(), 64, 64, THREE.RGBAFormat);
    pattern.wrapS = pattern.wrapT = THREE.RepeatWrapping;
    pattern.magFilter = pattern.minFilter = THREE.LinearFilter;
    pattern.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tSheet: { value: null },
        tRipple: { value: pattern },
        uTime: this.time,
        uDaylight: atmo.daylight,
        uFlowA: { value: new THREE.Vector3(...LOOK.flow[0]) },
        uFlowB: { value: new THREE.Vector3(...LOOK.flow[1]) },
        uSoft: { value: new THREE.Vector3(LOOK.edge, 0, LOOK.glow) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // (what a card gives is its colour already times its alpha, with its light on top: so the one draw both hides and adds)
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // (before the smoke and the dust, which are 5: smoke drifts in front of a flame oftener than behind one)
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    // The sheet and the cards, asked for once the game is up and not waited for by anything: a fire lit before
    // they have come shows its flames when they do.
    void (async () => {
      const [cards, sheet] = await Promise.all([
        fetch(assets.url(ART.cards)).then((r) => (r.ok ? (r.json() as Promise<FlameCards>) : Promise.reject(new Error(`${r.status} for ${ART.cards}`)))),
        fetch(assets.url(ART.sheet)).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status} for ${ART.sheet}`)))).then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })),
      ]);
      const t = new THREE.Texture(sheet as unknown as HTMLImageElement);
      // (a picture decoded off the frame is not turned over as it is put on the card: its first row is v = 0, and the cards' rows are counted the same way)
      t.flipY = false;
      t.premultiplyAlpha = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = 4;
      t.needsUpdate = true;
      mat.uniforms.tSheet.value = t;
      this.plan = plan(cards);
      this.warming = 3;
    })().catch((e) => console.warn('the flames did not come:', e));
  }

  /** A fire stood somewhere, out until its strength is raised. It burns until it is taken away with `remove`. */
  add(at: THREE.Vector3, o: { size?: number; turn?: number; smoke?: number; far?: number } = {}): Fire {
    const f: Fire = { at: at.clone(), size: o.size ?? 1, strength: 0, turn: o.turn ?? 0, lean: new THREE.Vector3(), glow: 1, smoke: o.smoke ?? 1, far: o.far ?? 1, own: Math.random(), gone: false, fed: false, kept: true };
    this.fires.push(f);
    return f;
  }

  remove(f: Fire) {
    const i = this.fires.indexOf(f);
    if (i >= 0) this.fires.splice(i, 1);
    f.gone = true;
  }

  /**
   * For whoever says every frame what burns and keeps nothing else (the smoke of a campfire and of an engine
   * are said that way: see Effects): the fire `holder` has, stood at `at` and kept alight for this frame. A
   * frame it is not fed in, it begins to die, and in under a second it is gone.
   */
  feed(holder: { fire?: Fire }, at: THREE.Vector3): Fire {
    let f = holder.fire;
    if (!f || f.gone) {
      f = holder.fire = this.add(at);
      f.kept = false;
    }
    f.at.copy(at);
    f.fed = true;
    return f;
  }

  /** @param eye where the picture is drawn from */
  update(dt: number, eye: THREE.Vector3) {
    this.clock += dt;
    // (kept small: the shader's own arithmetic is coarse with a big number, and a flame would shiver. Once in an hour and a bit every card skips a beat.)
    this.time.value = this.clock % 4096;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (f.kept) continue;
      if (f.fed) f.fed = false;
      else if ((f.strength -= dt * 1.4) <= 0) this.remove(f);
    }
    const p = this.plan, geo = this.mesh.geometry;
    let n = 0;
    if (p) {
      // the furthest first: a near fire is drawn over a far one behind it
      const lit = _lit;
      lit.length = 0;
      for (const f of this.fires) {
        if (f.strength <= 0) continue;
        const far = f.at.distanceTo(eye);
        if (far < PLAY.flame.seen * f.size * f.far) lit.push({ f, far });
      }
      lit.sort((a, b) => b.far - a.far);
      for (const { f, far } of lit) n = this.stand(p, f, far, n);
    }
    if (!n && this.warming > 0 && p) {
      // (one card of no size, somewhere out of the way: see `warming`)
      this.warming--;
      this.mid.fill(0, 0, 3);
      this.right.set([1e-6, 0, 0]);
      this.up.set([0, 1e-6, 0]);
      this.look.fill(0, 0, 4);
      n = 1;
    }
    const was = geo.instanceCount;
    geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n && !was) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  /** the cards of one fire written into the lists the draw is made from, from place `n` on; @returns the next free place */
  private stand(p: Plan, f: Fire, far: number, n: number): number {
    const { mid, right, up, rect, look, fire } = this;
    const s = f.size, cos = Math.cos(f.turn), sin = Math.sin(f.turn);
    const reach = PLAY.flame.seen * f.size * f.far;
    // (it goes out of sight over the last fifth of how far it is seen, not at a line)
    const thin = 1 - smooth(reach * 0.8, reach, far);
    burning(p, this.clock, f, far / f.far, (part, pose, shows) => {
      if (n >= MOST) return;
      const how = PLAY[part.card.kind];
      const a = n * 3, b = n * 4;
      // sized, turned as its fire is turned, and stood at its fire's foot
      const y = pose[1] * s;
      mid[a] = f.at.x + (pose[0] * cos + pose[2] * sin) * s + f.lean.x * y;
      mid[a + 1] = f.at.y + y;
      mid[a + 2] = f.at.z + (-pose[0] * sin + pose[2] * cos) * s + f.lean.z * y;
      right[a] = (pose[3] * cos + pose[5] * sin) * s;
      right[a + 1] = pose[4] * s;
      right[a + 2] = (-pose[3] * sin + pose[5] * cos) * s;
      const rise = pose[7] * s;
      up[a] = (pose[6] * cos + pose[8] * sin) * s + f.lean.x * rise;
      up[a + 1] = rise;
      up[a + 2] = (-pose[6] * sin + pose[8] * cos) * s + f.lean.z * rise;
      rect.set(part.card.rect, b);
      look[b] = shows * thin;
      look[b + 1] = how.turned ? 1 : 0;
      look[b + 2] = (part.own + f.own) % 1;
      look[b + 3] = how.smoke ? 1 : 0;
      fire[b] = f.at.y;
      fire[b + 1] = f.glow;
      fire[b + 2] = how.sway;
      fire[b + 3] = LOOK.foot * s;
      n++;
    });
    return n;
  }
}
const _lit: { f: Fire; far: number }[] = [];
