// Day and night. The Zone has a day of thirty-two minutes: three quarters of it light (first
// light, a long day, dusk) and one quarter, eight minutes, night. The night is kept shorter
// than the ten minutes a dog tag has to be held for: nobody sits a tag out in the dark.
// Rules and numbers only: the server keeps the clock in multiplayer (every
// game there is at the same hour), the game itself when playing alone; what the hour does to
// the light is in src/world/atmosphere.ts.

export const DAY = {
  /** seconds from one first light to the next */
  length: 1920,
  /**
   * Where in that each part begins, as a share of the whole. First light is 0; from `day` the
   * sun is full; at `dusk` it starts to go; from `night` it is gone until the whole comes round.
   */
  day: 0.04,
  dusk: 0.71,
  night: 0.75,
  /** the hour a game played alone begins at (mid morning), and the hour behind the menu (always day) */
  start: 0.15,
  menu: 0.3,
};

/** which share of the day a moment is: the fractional part of seconds over the day's length */
export const phaseOf = (seconds: number) => {
  const p = (seconds / DAY.length) % 1;
  return p < 0 ? p + 1 : p;
};

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

export interface Hour {
  /** how much of the day's light there is: 1 by day, 0 at night, between as it comes and goes */
  light: number;
  /** how low the sun stands: 0 by day and by night, up to 1 in the middle of first light and of dusk */
  low: number;
  night: boolean;
}

/** What an hour (a share of the day, 0..1) is like. */
export function hourAt(phase: number): Hour {
  const p = ((phase % 1) + 1) % 1;
  let t: number;
  if (p < DAY.day) t = p / DAY.day;
  else if (p < DAY.dusk) return { light: 1, low: 0, night: false };
  else if (p < DAY.night) t = 1 - (p - DAY.dusk) / (DAY.night - DAY.dusk);
  else return { light: 0, low: 0, night: true };
  return { light: smooth(t), low: Math.sin(Math.PI * t), night: false };
}

/**
 * The hour as a clock would say it ("21:40"). First light is half past five, the sun is full
 * at half past six, dusk begins at half past seven in the evening and it is night by half
 * past eight: the day's long part and the night's are each stretched to fit a clock's.
 */
export function clockAt(phase: number): string {
  const p = ((phase % 1) + 1) % 1;
  const marks: [number, number][] = [[0, 5.5], [DAY.day, 6.5], [DAY.dusk, 19.5], [DAY.night, 20.5], [1, 29.5]];
  let h = 5.5;
  for (let i = 0; i + 1 < marks.length; i++) {
    const [a, ha] = marks[i], [b, hb] = marks[i + 1];
    if (p >= a && p <= b) {
      h = ha + ((p - a) / (b - a)) * (hb - ha);
      break;
    }
  }
  const m = Math.floor((h % 24) * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** seconds from an hour until the next nightfall, and until the next first light */
export function untilNight(phase: number) {
  const p = ((phase % 1) + 1) % 1;
  return ((p < DAY.night ? DAY.night - p : 1 - p + DAY.night) % 1) * DAY.length;
}
export function untilDawn(phase: number) {
  const p = ((phase % 1) + 1) % 1;
  return (1 - p) * DAY.length;
}
