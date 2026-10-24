// The wheel (hold T): things to call out without a microphone, and things to do with the
// body. What is called out is heard from where the caller stands and read over their head by
// whoever is near; what the body does is seen by everyone who can see the body.
//
// Rules and data only: the game draws the wheel, moves the body and makes the voice, and the
// server passes a call on to the players within earshot.

export interface Emote {
  id: string;
  /** on the wheel, and in the menu's list */
  label: string;
  /** what the menu's list files it under */
  kind: 'call' | 'dance' | 'gesture' | 'pose';
  /** what is called out (heard, and read over the head) */
  say?: string;
  /** what the arms (or the head) do meanwhile, and for how long, seconds */
  move?: 'wave' | 'beckon' | 'distress' | 'palms' | 'point' | 'salute' | 'nod' | 'shake' | 'halt' | 'down' | 'back';
  dur?: number;
  /** a thing the body keeps doing until the player moves or does something else: told in the pose flags */
  hold?: 'dance' | 'surrender' | 'sit';
  /**
   * A movement from the emote pack (public/assets/characters/emotes.glb, made by scripts/emotes.mjs): danced as
   * `hold: 'dance'` is, with this clip in place of the body's own dance.
   */
  clip?: string;
  /** a clip played once and over, not one kept up until the player moves */
  once?: boolean;
  /** a clip's number in the pose flags (EMOTE_SHIFT): never changed and never used again for another */
  n?: number;
}

/** a movement from the pack: [id, label, kind, its number, played once] */
const PACK: [string, string, 'dance' | 'gesture', number, boolean?][] = [
  ['balloon', 'Balloon', 'dance', 1],
  ['bhangra', 'Bhangra', 'dance', 2],
  ['wiggle', 'Wiggle walk', 'dance', 3],
  ['valentine', 'Valentine', 'gesture', 4, true],
  ['sorrow', 'Sorrow', 'gesture', 5],
  ['shuffle', 'Shuffle', 'dance', 6],
  ['shootdance', 'Shoot dance', 'dance', 7],
  ['piratejig', 'Pirate jig', 'dance', 8],
  ['party', 'Party dance', 'dance', 9],
  ['provoke', 'Provoke', 'gesture', 10, true],
  ['loveheart', 'Love heart', 'gesture', 11, true],
  ['lol', 'LOL', 'gesture', 12, true],
  ['groove', "Let's groove", 'dance', 13],
  ['kickmoon', 'Kick the moon', 'gesture', 14, true],
  ['jaguar', 'Jaguar', 'dance', 15],
  ['hitdemfolks', 'Hit dem folks', 'dance', 16],
  ['whirl', 'Hands whirling', 'dance', 17],
  ['poof', 'Poof', 'gesture', 18, true],
  ['book', 'Rampage book', 'dance', 19],
  ['mj', 'MJ dance', 'dance', 20],
  ['max', 'Max', 'dance', 21],
  ['legguitar', 'Leg guitar', 'dance', 22],
  ['poker', 'Boyband poker', 'dance', 23],
  ['boybandak', 'Boyband AK', 'dance', 24],
  ['provocation', 'Provocation', 'gesture', 25, true],
  ['egypt', 'Egypt', 'dance', 26],
  ['dab', 'Dab', 'gesture', 27, true],
  ['clap', 'Clap', 'gesture', 28, true],
];

/**
 * Everything there is to call out or do. The calls are for whoever has no microphone (the owner, 2026-10-14: "we
 * should also add more things to the voice chat emotes, like dont shoot, yes no, etc... make the emotes more useful
 * to non mic players"); the dances and gestures are the owner's pack, on the player's own body.
 */
export const EMOTES: Emote[] = [
  { id: 'hey', label: 'Hey!', kind: 'call', say: 'HEY!', move: 'wave', dur: 1.5 },
  { id: 'here', label: 'Over here!', kind: 'call', say: 'OVER HERE!', move: 'beckon', dur: 1.8 },
  { id: 'omw', label: 'On my way!', kind: 'call', say: 'ON MY WAY!', move: 'point', dur: 1.4 },
  { id: 'thanks', label: 'Thanks!', kind: 'call', say: 'THANKS!', move: 'salute', dur: 1.3 },
  { id: 'help', label: 'Help!', kind: 'call', say: 'HELP!', move: 'distress', dur: 1.8 },
  { id: 'friendly', label: 'Friendly!', kind: 'call', say: 'FRIENDLY!', move: 'palms', dur: 1.7 },
  { id: 'dontshoot', label: "Don't shoot!", kind: 'call', say: "DON'T SHOOT!", move: 'palms', dur: 1.8 },
  { id: 'yes', label: 'Yes', kind: 'call', say: 'YES!', move: 'nod', dur: 1.1 },
  { id: 'no', label: 'No', kind: 'call', say: 'NO!', move: 'shake', dur: 1.2 },
  { id: 'follow', label: 'Follow me', kind: 'call', say: 'FOLLOW ME!', move: 'beckon', dur: 1.6 },
  { id: 'wait', label: 'Wait', kind: 'call', say: 'WAIT!', move: 'halt', dur: 1.5 },
  { id: 'enemy', label: 'Enemy!', kind: 'call', say: 'ENEMY!', move: 'point', dur: 1.4 },
  { id: 'go', label: 'Go go go!', kind: 'call', say: 'GO GO GO!', move: 'wave', dur: 1.4 },
  { id: 'down', label: 'Get down!', kind: 'call', say: 'GET DOWN!', move: 'down', dur: 1.4 },
  { id: 'behind', label: 'Behind you!', kind: 'call', say: 'BEHIND YOU!', move: 'back', dur: 1.5 },
  { id: 'medic', label: 'Need a medic!', kind: 'call', say: 'I NEED A MEDIC!', move: 'distress', dur: 1.8 },
  { id: 'loot', label: 'Loot here', kind: 'call', say: 'LOOT HERE!', move: 'point', dur: 1.4 },
  { id: 'sorry', label: 'Sorry!', kind: 'call', say: 'SORRY!', move: 'palms', dur: 1.5 },
  { id: 'dance', label: 'Dance', kind: 'dance', hold: 'dance' },
  ...PACK.map(([id, label, kind, n, once]): Emote => ({ id, label, kind, hold: 'dance', clip: id, n, once })),
  { id: 'surrender', label: 'Hands up', kind: 'pose', hold: 'surrender' },
  // (sat on the ground, for as long as nothing else is done: a rest by a fire, a wait for somebody)
  { id: 'sit', label: 'Sit down', kind: 'pose', hold: 'sit' },
];

/**
 * The wheel as it is until a player sets their own (Emotes, opened from the wheel): fifteen, an inner eight and an
 * outer seven, each clockwise from the top (the owner, 2026-10-15: "we have so many options to pick from but we need
 * more slots to assign to can we double it?"); the bottom of the outer ring is Cancel (2026-10-24: "the bottom option
 * for the radial wheel should always be cancel"). The inner eight are the eight there were.
 */
export const WHEEL_DEFAULT = ['hey', 'dontshoot', 'yes', 'no', 'bhangra', 'surrender', 'follow', 'help', 'here', 'thanks', 'wait', 'enemy', 'loot', 'sit', 'medic'];
export const WHEEL_SLOTS = 15;
/** where Cancel came in: the slot a wheel set before it kept there, which is let go (`wheelSlots`) */
export const WHEEL_CANCEL_AT = 12;
/** wedges to a ring */
export const WHEEL_RING = 8;

/** which of the pack's clips is being danced, in the pose flags: its number this many bits up (0: the body's own dance, or none) */
export const EMOTE_SHIFT = 16;
export const EMOTE_MASK = 0x7f << EMOTE_SHIFT;
export const EMOTE_BY_N: Record<number, Emote> = Object.fromEntries(EMOTES.filter((e) => e.n).map((e) => [e.n!, e]));

export const EMOTE: Record<string, Emote> = Object.fromEntries(EMOTES.map((e) => [e.id, e]));

/** how far a call carries, metres; and how near somebody has to be to read it over the caller's head */
export const SHOUT_RANGE = 90;
export const SAY_RANGE = 40;
/** seconds the words stay over the head */
export const SAY_TIME = 2.4;
/** shortest time from one call to the next, seconds */
export const EMOTE_GAP = 1;

/** Whose voice, 0 (low and broad) to 1 (higher and thinner): the same name has the same one in every game. */
export function voiceOf(name: string) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 999;
}
