// The body's clips and the numbers they are played by: which clips there are, lying, sitting, the live-tunable POSE table and the stances a gun is held in.
// (One part of avatar.ts, cut out of it whole on 2026-10-24 so that it can be read and worked on alone: nothing in it was changed.)

import type { Emote } from '../../sim/emotes';

export const CLIPS = ['idle', 'walk', 'run', 'crouchIdle', 'crouchWalk', 'jumpStart', 'jumpLoop', 'jumpLand', 'death', 'deathFront', 'deathSide', 'hit', 'hitHead', 'dance', 'sit', 'armed', 'strike', 'proneDown', 'crawl'] as const;

export type Clip = (typeof CLIPS)[number];

export const STRIDES = ['walk', 'run', 'crouchWalk'] as const;

export type Stride = (typeof STRIDES)[number];

/** the ways of going down: thrown onto the back, pitched onto the face, folded onto the side */
export const DEATHS = ['death', 'deathFront', 'deathSide'] as const;

/** where a body lies once it is down, from where it stood: metres ahead of its feet (negative = behind) and to its left */
export const DEATH_REST: [number, number][] = [[-0.85, 0], [0.9, 0], [0.05, 0.36]];

/** what the hands can be seen doing */
export type Gesture = 'bolt' | 'reload' | 'eat' | 'drink' | 'bandage' | 'open' | 'check' | 'saw';

/** from the wheel (src/sim/emotes.ts): what the arms do with a call, and what the body keeps up until told otherwise */
export type Move = NonNullable<Emote['move']>;

export type Hold = NonNullable<Emote['hold']>;

/**
 * Lying down. There is no drawing of it in the library: it is the last moment of the fall forward (face down,
 * feet where the body stood), with the head and the chest brought up off the ground and the gun held out in
 * front from the shoulders. Set by looking.
 *   back    – how far the body is put back along the way it faces, so that where the player is, is its chest
 *             (and for the player's own body, its head: the eyes are there)
 *   up      – how far the whole of it is lifted: the drawing lies with its bones on the ground, and a chest is thicker than that
 *   chest, head – how far each is turned up off the ground, radians
 *   pivot   – where the gun hangs from the middle of the shoulders: up, and (negative) forward
 *   knee    – how far a knee is drawn out to the side at each pull of a crawl, radians
 */
// (chest and head were 0.2 and 0.95 for the old lying pose, which lay face down: the owner's lying down of
// 2026-10-14 (proneDown) lies with the head up already, and on top of it the head looked straight up at the sky.
// "when prone the users head looks very odd from 3rd person like looking straight up")
export const PRONE = { back: 1.2, backOwn: 1.62, up: 0.1, chest: 0, head: 0.12, pivot: [0.1, -0.3] as [number, number], knee: 0.5 };

/** sat on the ground: how far the hips come down from the chair the sitting was drawn on, and how nearly straight the legs are laid (set by looking) */
export const SIT = { drop: 0.4, legs: 0.92 };

/**
 * Sat in a low car (the police car). The library's sitting is on a chair, which is a jeep's bench: upright, the
 * shins straight down, the body a little forward. A car's seat is a hand over its floor and its roof is a head
 * over the seat, so each seat says how it is sat in: `legs`, how nearly straight the knees (as for sitting on the
 * ground, and for the same reason); `knees`, how far the thighs are lifted (radians); `back`, how far the body
 * lies back from the waist, against the seat (radians). In front the legs go out under the dashboard to the
 * pedals. Behind there is a third of a metre of floor and a roof lower than a sat body is tall: the knees are up,
 * the feet under them, and the body lies back along the seat, which is laid back as far itself. Set, with the
 * seats (SEAT_CAR in garage.ts), by measuring every point of the body's skin against the car: none under its
 * floor, none through its roof.
 */
export interface SeatPose {
  legs: number;
  knees: number;
  back: number;
}

export const CAR_SIT: { front: SeatPose; back: SeatPose } = { front: { legs: 0.85, knees: 0, back: 0.2 }, back: { legs: 0, knees: 0.43, back: 0.87 } };

/** Live-tunable numbers for how the clips are played (the dev harness exposes them as T.pose). */
export const POSE = {
  /** ground each stepping clip covers when played as drawn, m/s (how fast its planted foot travels back) */
  pace: { walk: 1.08, run: 6.1, crouchWalk: 0.69 } as Record<Stride, number>,
  /**
   * The walk is a stroll and the run a flat-out run, with nothing drawn in between. Up to
   * this speed the walk is simply played faster; beyond it the run is mixed in, so a jog is
   * half of each and a sprint is the run as drawn. Either way the feet keep pace with the ground.
   */
  walkTop: 2.1,
  /** where in each stepping clip the left foot is furthest forward, as a fraction of the clip: lines the cycles up */
  offset: { walk: 0, run: 0.95, crouchWalk: 0 } as Record<Stride, number>,
  /**
   * Where in the stride a foot is set down (the other one half a stride later), read off the
   * clips: at a walk or a flat-out run, at the jog half way between them, and crouched. The
   * step is heard here and the view dips here, so the sound keeps time with the legs at any
   * speed: a sprint is longer strides, not many more of them. Stepping backwards the stride
   * runs the other way, and a foot is set down where going forwards it would be picked up.
   */
  plant: { fwd: [0.1, 0.165, 0], back: [0.375, 0.25, 0.285] },
  /** how far the back straightens while crouched, radians: brings the head up to where the crouched camera is */
  crouchLift: 0.37,
  /** leaning out (Q, E): how far over the body goes from the waist up, radians, and how far the hips go with it, metres */
  leanAngle: 0.64,
  leanHips: 0.1,
  /** how fast the death clip is played */
  deathRate: 1.15,
  /** going down to lie (`proneDown`): the seconds of it over which the body comes down (its hips: crouched to 0.55, on the ground by 1.25), and how fast it is played back to get up */
  lie: [0.55, 1.25] as [number, number],
  rise: 1.25,
  /** metres crawled to one whole loop of `crawl` (it is drawn on the spot) */
  crawlStride: 0.9,
  /** the most the legs turn away from the chest when walking sideways, radians */
  maxTwist: 1.35,
  /** how much of the body a hit takes over at its peak */
  flinch: 0.75,
  /** landing: how much of the body the landing clip takes, and for how long (seconds) */
  landing: [0.8, 0.45] as [number, number],
  /** where in the landing clip the feet touch down, seconds */
  landFrom: 0,
  /** a jump: where in the take-off clip the feet leave the ground, and how long until the falling pose takes over (seconds) */
  jump: [0.04, 0.5] as [number, number],
  /** how long a blow with the right arm takes, seconds */
  swing: 0.42,
  /** a punch: how long it takes, and how long the fists stay up after one, seconds */
  punch: [0.38, 2.6] as [number, number],
  /** how much of the aim's pitch the neck and head add on top of the chest's lean */
  headPitch: 0.5,
  /** A weapon in the hands: where it sits from the shoulder pivot, and how the body takes it up. */
  hold: {
    /**
     * Three ways of holding each kind, blended by what the player is doing. `p` is where the
     * weapon's own origin sits from the point between the shoulders (x right, y up, z back),
     * `r` how it is turned from pointing down the aim: [nose up, nose left, roll], radians.
     *   ready: standing or walking, not aiming. Butt in the shoulder, muzzle dipped.
     *   aim:   sights up to the eye.
     *   carry: jogging or sprinting. A long gun goes across the chest, a pistol points at the ground.
     */
    // (A long gun with a stock is not put by `p` at the ready or aimed, but by its butt: see `butt`. `p` is for one
    // whose butt is not known. At the ready its muzzle is down 18 degrees, a low ready, and a little in toward the
    // other hand; it was 9. Further down and the gun hand is in the pouches of a plate carrier.)
    long: {
      ready: { p: [0.065, -0.19, -0.65], r: [-0.32, 0.06, 0] },
      aim: { p: [0.05, 0.1, -0.6], r: [0, 0, 0] },
      carry: { p: [-0.07, -0.07, -0.34], r: [0.656, 0.88, 0] },
    } as Stances,
    /**
     * A long gun with a stock is held by its butt, in the pocket of the firing shoulder. Where the middle of its
     * butt goes from the right shoulder's joint, by the chest's own right, up and back (as the upper back carries
     * them: a chest turned off the aim has its shoulder somewhere else than the aim's right), metres:
     *   ready: in the pocket, where the chest's front meets the shoulder (the jacket there is 14 cm in front of the joint);
     *   aim:   raised, the foot of the butt still in the pocket and the sights up toward the eye's line. The gun is
     *          to the firing side of the head, not under the eye: a head in a helmet with its visor down is not laid on a stock;
     *   prone: lying, the butt at the top of the shoulder, the gun out along the ground.
     * (The gun's own origin was put, for every long gun alike, on the middle line of a chest turned 43 degrees off the
     * aim. That stood an AK's butt 23 cm to the LEFT of the right shoulder, 9 cm inside the plate carrier, and a
     * sniper rifle's 13 cm inside it, and the right arm went across the chest to the grip, nearly straight: 10 cm
     * of the upper arm and of the forearm inside the vest. The user's, 2026-10-13: "the arm clips into the body",
     * "in real life the stock would be against the shoulder".)
     */
    butt: { ready: [0, 0.025, -0.143], aim: [0.03, 0.09, -0.125], prone: [-0.02, 0.1, -0.07] } as Record<'ready' | 'aim' | 'prone', [number, number, number]>,
    /**
     * A long gun with no stock (the submachine gun) is held the same way, by where the butt of a stock this long
     * would be, metres: both hands on it in front of the firing shoulder. (It was held out on the middle line of
     * the bladed chest as a rifle's origin was: 10 to 13 cm of the right arm inside the body, and 4 cm of the gun
     * inside a lowered visor when aimed. Squaring the chest to it instead left the forward hand 14 cm short.)
     */
    stockless: 0.18,
    /**
     * Aimed, a long gun is not left at the shoulder with the head upright beside it (the user's, 2026-10-13: "looks
     * bad, like not ADS", "the head needs to tilt towards the gun slightly as well like youre lining up sights"):
     * its sights are put in front of the right eye, and the head is brought to the gun.
     *   eye:     where the right eye is, in the body's resting frame as the head carries it (x right, y up, z behind);
     *   x:       how far outside the eye the gun's middle line is at the least;
     *   jaw:     and how far out from the middle of the head, where the head tips about: the stock stands upright
     *            beside the jaw and the head is tipped over it, which is what brings the eye to the sights;
     *   plate:   the same under a visor that is down, where there is no cheek to lay on the stock: further out,
     *            so that the stock, which is lower there, runs clear of the chest it is bladed across;
     *   beside:  how far outside whatever is worn on the cheek (a mask's rubber) the gun's line is, if that is further;
     *   front:   how far in front of the body's own upright line the chest's front is where the butt then rests, by
     *            the collar bone (in the resting frame, as the upper back carries it), and `slope`: how much
     *            further forward it is for each metre lower the butt rests;
     *   tilt, nod: the head laid over toward the stock, and nodded (radians);
     *   crane, drop: the neck craned to the gun (toward it, and forward: metres), and DOWN by whatever brings the
     *            eye level with the gun's sights, `drop` at the most. The gun is not carried up to an upright head: it
     *            stays at the height the shoulder holds it at, its comb about level with the chin of somebody
     *            standing straight, and the head comes down and over to it;
     *   shrug:   the firing shoulder hunched up to the butt, radians;
     *   body:    how much of that tilt is the upper chest's, the rest the neck's and the head's: it is the body that
     *            leans into the gun, not a head bent over on a stiff neck (the user's, 2026-10-13: "the head is not
     *            tilted enough it doesnt look like the model is aiming down sights");
     *   lean:    the chest leant in to the gun, radians;
     *   visored: how much of the head's part is done under a visor that is down. A stock cannot be laid on a
     *            cheek that is behind a steel plate: it goes under the plate's lower edge and the sights stand in
     *            front of the plate, as high as that lets them (see `faceGear`).
     */
    cheek: { eye: [0.032, 1.64, -0.075] as [number, number, number], x: 0, jaw: 0.05, plate: 0.1, beside: 0.025, front: 0.09, slope: 0.5, tilt: 0.35, body: 0.3, nod: 0.12, crane: [0.03, 0.04] as [number, number], drop: 0.07, shrug: 0.18, lean: 0.09, visored: 0.4 },
    /** aimed, the chest is turned this far off the aim (less than at the ready: the right shoulder comes round to the gun), the left shoulder comes this far forward, and the right this far */
    bladeAim: 0.6,
    reachAim: 0.75,
    reachRight: 0.6,
    /** how far both shoulders come forward to a pistol, radians (see GUN_ELBOW.pistolR) */
    protract: 0.14,
    // (A pistol at the ready and carried was a hand's width nearer the chest and off to the right: the left arm
    // went through the chest to get to it. In front of the middle of the body, at arm's length less a bend.)
    // (Held too high, as the rifles were (the owner, 2026-10-14: "This pistol actually needs to be lowered, like the
    // rifles needed before"; "no arm in the body, weapon positioned and held tilted when ads like real life"): at
    // the ready it is a low ready, both hands out at the belt, the muzzle down at the ground ahead; aimed, it stays
    // a little under the eye with the arms out and the head comes forward and down to the sights (`sighted`).)
    pistol: {
      // (And lower again, out at the belt, the muzzle further down, with the elbows down along the ribs and not out to
      // the sides: the owner, 2026-10-14: "the arms and shoulders look weird in 3rd person when holding the pistol
      // not ADS ... the shoulder profile looks too narrow when holding weapon in front". See GUN_ELBOW.pistolR.)
      ready: { p: [0.03, -0.4, -0.46], r: [-0.72, 0, 0] },
      // (At the eye it was 44 cm out: 6 cm further than the gun hand can reach and 10 further than the other. The
      // hands stopped short of it, behind its grip, wherever on it they were told to hold, and the pistol stood in
      // front of the fists that were meant to be round it. It is within reach, with a bend left in the elbows.)
      aim: { p: [0.035, 0.06, -0.39], r: [0, 0, 0] },
      carry: { p: [0.03, -0.42, -0.43], r: [-0.85, 0, 0] },
    } as Stances,
    /**
     * Aimed, a pistol is brought into the eye's line by the head and not up to it: the chest a little forward over
     * the arms, the head nodded down and pushed forward, so the eye sits behind the sights (radians, metres).
     */
    sighted: { lean: 0.08, nod: 0.2, forward: 0.03, down: 0.035 },
    /** the point the weapon hangs from, measured from midway between the shoulder joints: [up, back] */
    pivot: [0.04, -0.04] as [number, number],
    /** where the head is from that same point with the body standing, which is what `aim` was set for: [up, back] */
    eye: [0.146, -0.028] as [number, number],
    /** long guns: the chest turns this far off the aim, left shoulder leading, radians (at 0.5 the left hand could not reach a rifle's fore-end) */
    blade: 0.75,
    /** and the left shoulder comes forward this much more */
    reach: 0.3,
    /** the most the left hand moves back along the stock toward the right when the grip is beyond its reach, metres */
    slide: 0.3,
    /** how much of an arm's length a hand on a gun may be from its shoulder: past that the gun is brought in to the hands */
    within: 0.95,
  },
};

export interface Stance {
  p: [number, number, number];
  r: [number, number, number];
}

type Stances = Record<'ready' | 'aim' | 'carry', Stance>;
