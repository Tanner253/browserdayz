// A controller's buttons: what each does (the player's to change, as the keyboard's keys are: the owner, 2026-10-26,
// "controllers have asked for key remapping and rebinding options like we have for pc so they can make their own
// layouts"), what each is called on the pad in the hands, and the pad itself read the same whatever the browser makes
// of it ("the ps4 pad, do we support?"). Sums only: no page here, so a test reads it as the game does.

/** the standard layout's buttons, by the place they are in (PlayStation names; Xbox has A B X Y, LB RB LT RT) */
export const B = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, create: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, home: 16, pad: 17 };

export type PadAction = 'fire' | 'aim' | 'jump' | 'crouch' | 'use' | 'swap' | 'prev' | 'next' | 'sprint' | 'light' | 'map' | 'callout' | 'mode' | 'inspect' | 'inventory' | 'menu';

/** what each of a controller's buttons does, laid out as Call of Duty's default (src/core/gamepad.ts says how each acts) */
export const PAD_ACTIONS: { id: PadAction; does: string; btn: number }[] = [
  { id: 'fire', does: 'Fire · use what you hold', btn: B.r2 },
  { id: 'aim', does: 'Aim', btn: B.l2 },
  { id: 'jump', does: 'Jump', btn: B.cross },
  { id: 'crouch', does: 'Crouch · held, lie down', btn: B.circle },
  { id: 'use', does: 'Reload · or take, doors, search', btn: B.square },
  { id: 'swap', does: 'Next gun · held, empty hands', btn: B.triangle },
  { id: 'prev', does: 'Hot bar, one back · aiming, zoom out', btn: B.l1 },
  { id: 'next', does: 'Hot bar, one on · aiming, zoom in', btn: B.r1 },
  { id: 'sprint', does: 'Sprint · aiming, lean left · held, hold breath', btn: B.l3 },
  { id: 'light', does: 'Light · aiming, lean right', btn: B.r3 },
  { id: 'map', does: 'Map', btn: B.up },
  { id: 'callout', does: 'Call-out wheel (hold)', btn: B.down },
  { id: 'mode', does: 'Single or automatic · held, drop', btn: B.left },
  { id: 'inspect', does: 'Look the gun over · held, talk', btn: B.right },
  { id: 'inventory', does: 'Inventory', btn: B.create },
  { id: 'menu', does: 'Menu', btn: B.options },
];
/** the buttons a thing may be put on (not the home button: the system's) */
export const PAD_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17];

/** the button each thing is on now, from what the player has moved (`moved`: a thing's id to its button) */
export function padButtons(moved: Record<string, number>): Record<PadAction, number> {
  return Object.fromEntries(PAD_ACTIONS.map((a) => [a.id, moved[a.id] ?? a.btn])) as Record<PadAction, number>;
}

/**
 * A thing put on a button. Whatever that button did before is given the button this thing had (they change places, and
 * are said to have), so that no two things are on one button and nothing is left with none.
 * @returns what is moved now, and the thing that changed places with it (null: none did)
 */
export function bindPad(moved: Record<string, number>, id: PadAction, btn: number): { moved: Record<string, number>; swapped: PadAction | null } {
  const now = padButtons(moved), had = now[id], out = { ...moved };
  const other = PAD_ACTIONS.find((a) => a.id !== id && now[a.id] === btn)?.id ?? null;
  const put = (what: PadAction, on: number) => {
    if (on === PAD_ACTIONS.find((a) => a.id === what)!.btn) delete out[what];
    else out[what] = on;
  };
  put(id, btn);
  if (other) put(other, had);
  return { moved: out, swapped: other };
}

/** whose names the buttons go by */
export type PadKind = 'ps' | 'xbox';
/** a pad's kind from what the browser calls it: Sony's vendor id (054c) or its names, PlayStation's; anything else Xbox's names, as most pads are made to */
export const padKind = (id: string): PadKind => (/054c|playstation|dualshock|dualsense|wireless controller/i.test(id) ? 'ps' : 'xbox');

const NAMES: Record<PadKind, string[]> = {
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'PS', 'Touchpad'],
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Guide', 'Touchpad'],
};
/** a button, as the pad in the hands has it written */
export const buttonName = (i: number, kind: PadKind) => NAMES[kind][i] ?? `Button ${i}`;

/** a pad as the game reads it: its buttons in the standard layout's places, and the sticks (left x, y; right x, y) */
export interface PadRead {
  pressed: boolean[];
  /** how far each trigger is pulled, 0 to 1 */
  l2: number;
  r2: number;
  axes: [number, number, number, number];
}

/** how far a trigger is pulled before it fires */
const PULL = 0.3;

/**
 * A PlayStation pad the browser does not lay out as standard (over Bluetooth, under Firefox, on some systems): its own
 * order of buttons and axes, put into the standard's places. Windows and macOS (DirectInput, HID): □ ✕ ○ △ first, the
 * sticks on axes 0 1 2 5 (the triggers' axes, 3 and 4, between), the D-pad a hat on axis 9. Linux (evdev): ✕ ○ △ □
 * first, the right stick on axes 3 4 (the triggers' 2 and 5 between), the D-pad on 6 7. The triggers are read by their
 * buttons, 6 and 7 on both: their axes read halfway pulled until first touched on some systems, and a right stick read
 * as the standard's axis 2 there is a trigger, which turned the head by itself.
 */
function fromPlayStation(gp: Pick<Gamepad, 'buttons' | 'axes'>, linux: boolean): PadRead {
  const btn = (i: number) => !!gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.5;
  const ax = (i: number) => gp.axes[i] ?? 0;
  const p: boolean[] = new Array(18).fill(false);
  const pull = (i: number) => Math.max(gp.buttons[i]?.value ?? 0, gp.buttons[i]?.pressed ? 1 : 0);
  const l2 = pull(6), r2 = pull(7);
  let axes: PadRead['axes'];
  if (linux) {
    [p[B.cross], p[B.circle], p[B.triangle], p[B.square], p[B.l1], p[B.r1]] = [btn(0), btn(1), btn(2), btn(3), btn(4), btn(5)];
    [p[B.create], p[B.options], p[B.home], p[B.l3], p[B.r3]] = [btn(8), btn(9), btn(10), btn(11), btn(12)];
    axes = [ax(0), ax(1), ax(3), ax(4)];
    [p[B.up], p[B.down], p[B.left], p[B.right]] = [ax(7) < -0.5, ax(7) > 0.5, ax(6) < -0.5, ax(6) > 0.5];
  } else {
    [p[B.square], p[B.cross], p[B.circle], p[B.triangle], p[B.l1], p[B.r1]] = [btn(0), btn(1), btn(2), btn(3), btn(4), btn(5)];
    [p[B.create], p[B.options], p[B.l3], p[B.r3], p[B.home], p[B.pad]] = [btn(8), btn(9), btn(10), btn(11), btn(12), btn(13)];
    axes = [ax(0), ax(1), ax(2), ax(5)];
    // (the hat: -1 up, then round by sevenths of two, past 1 let go)
    const hat = gp.axes[9];
    if (hat !== undefined && Math.abs(hat) <= 1.05) {
      const d = Math.round(((hat + 1) * 7) / 2) % 8;
      [p[B.up], p[B.right], p[B.down], p[B.left]] = [d === 7 || d <= 1, d >= 1 && d <= 3, d >= 3 && d <= 5, d >= 5 && d <= 7];
    } else if (gp.buttons.length >= 18) [p[B.up], p[B.down], p[B.left], p[B.right]] = [btn(14), btn(15), btn(16), btn(17)];
  }
  p[B.l2] = l2 > PULL;
  p[B.r2] = r2 > PULL;
  return { pressed: p, l2, r2, axes };
}

/** a pad read into the standard layout, whatever the browser made of it */
export function readPad(gp: Pick<Gamepad, 'id' | 'mapping' | 'buttons' | 'axes'>, platform = ''): PadRead {
  if (gp.mapping !== 'standard' && padKind(gp.id) === 'ps') return fromPlayStation(gp, /linux/i.test(platform) && !/android/i.test(platform));
  const pressed = gp.buttons.map((b, i) => b.pressed || b.value > (i === B.l2 || i === B.r2 ? PULL : 0.5));
  const [lx = 0, ly = 0, rx = 0, ry = 0] = gp.axes;
  return { pressed, l2: gp.buttons[B.l2]?.value ?? 0, r2: gp.buttons[B.r2]?.value ?? 0, axes: [lx, ly, rx, ry] };
}

/**
 * Which of the pads the browser lists is the one in the hands: one it lays out as standard before one it does not, a
 * PlayStation's or Xbox's before what else is listed (a pad's motion sensors, or a second copy of it a driver makes,
 * show as pads of their own with a few buttons or none).
 */
export function pickPad<T extends Pick<Gamepad, 'id' | 'mapping' | 'buttons' | 'connected'>>(pads: readonly (T | null)[]): T | null {
  let best: T | null = null, score = -1;
  for (const g of pads) {
    if (!g?.connected || g.buttons.length < 10) continue;
    const s = (g.mapping === 'standard' ? 2 : 0) + (/054c|045e|xbox|xinput|playstation|dualshock|dualsense|wireless controller/i.test(g.id) ? 1 : 0);
    if (s > score) [best, score] = [g, s];
  }
  return best;
}
