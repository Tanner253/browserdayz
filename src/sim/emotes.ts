// The wheel (hold T): things to call out without a microphone, and things to do with the
// body. What is called out is heard from where the caller stands and read over their head by
// whoever is near; what the body does is seen by everyone who can see the body.
//
// Rules and data only: the game draws the wheel, moves the body and makes the voice, and the
// server passes a call on to the players within earshot.

export interface Emote {
  id: string;
  /** on the wheel */
  label: string;
  /** what is called out (heard, and read over the head) */
  say?: string;
  /** what the arms do meanwhile, and for how long, seconds */
  move?: 'wave' | 'beckon' | 'distress' | 'palms' | 'point' | 'salute';
  dur?: number;
  /** a thing the body keeps doing until the player moves or does something else: told in the pose flags */
  hold?: 'dance' | 'surrender';
}

/** in the order they sit round the wheel, clockwise from the top */
export const EMOTES: Emote[] = [
  { id: 'hey', label: 'Hey!', say: 'HEY!', move: 'wave', dur: 1.5 },
  { id: 'here', label: 'Over here!', say: 'OVER HERE!', move: 'beckon', dur: 1.8 },
  { id: 'omw', label: 'On my way!', say: 'ON MY WAY!', move: 'point', dur: 1.4 },
  { id: 'thanks', label: 'Thanks!', say: 'THANKS!', move: 'salute', dur: 1.3 },
  { id: 'dance', label: 'Dance', hold: 'dance' },
  { id: 'surrender', label: 'Hands up', hold: 'surrender' },
  { id: 'help', label: 'Help!', say: 'HELP!', move: 'distress', dur: 1.8 },
  { id: 'friendly', label: 'Friendly!', say: 'FRIENDLY!', move: 'palms', dur: 1.7 },
];

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
