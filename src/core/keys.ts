// Which key does what, and how fast the mouse turns the head: both the player's to set (2026-10-12: "we need a
// sensitivity slider in settings, allow players to rebind hotkeys like a normal game").
//
// The game asks for keys by the name each was first given ('KeyW', 'Mouse0'). Those names stay, as the names of what
// they DO. A player who puts "forward" on another key has that key answer to 'KeyW': src/core/input.ts does the
// translating as each key goes down, so nothing that reads a key had to change, and nothing that presses one for a
// test either. What is shown of a key on the screen is asked of `shown()` (or, for words already written with a
// key in them, of `relabel`).

import { PAD_ACTIONS, PAD_BUTTONS, padButtons } from './pad-layout';

export type KeyGroup = 'Move' | 'Fight' | 'Gear' | 'Talk' | 'Admin';
export interface Action {
  /** the key it was given, and the name it is asked for by */
  code: string;
  does: string;
  group: KeyGroup;
}

const slot = (n: number): Action => ({ code: `Digit${n % 10}`, does: n < 4 ? ['', 'Slot 1 · on your back', 'Slot 2 · on your back', 'Slot 3 · your holster'][n] : `Slot ${n}`, group: 'Gear' });

export const ACTIONS: Action[] = [
  { code: 'KeyW', does: 'Forward', group: 'Move' },
  { code: 'KeyS', does: 'Back', group: 'Move' },
  { code: 'KeyA', does: 'Left', group: 'Move' },
  { code: 'KeyD', does: 'Right', group: 'Move' },
  { code: 'Space', does: 'Jump', group: 'Move' },
  { code: 'ShiftLeft', does: 'Sprint · hold your breath', group: 'Move' },
  { code: 'AltLeft', does: 'Walk', group: 'Move' },
  { code: 'KeyC', does: 'Crouch', group: 'Move' },
  { code: 'KeyZ', does: 'Lie down', group: 'Move' },
  { code: 'KeyQ', does: 'Lean left', group: 'Move' },
  { code: 'KeyE', does: 'Lean right', group: 'Move' },
  { code: 'Mouse0', does: 'Fire · use what you hold', group: 'Fight' },
  { code: 'Mouse2', does: 'Aim', group: 'Fight' },
  { code: 'KeyR', does: 'Reload', group: 'Fight' },
  { code: 'KeyB', does: 'Automatic · single shots · bipod · folding stock (held: fire mode)', group: 'Fight' },
  { code: 'KeyI', does: 'Look the gun over', group: 'Fight' },
  { code: 'KeyX', does: 'Empty your hands', group: 'Fight' },
  { code: 'PageUp', does: 'Sights: further', group: 'Fight' },
  { code: 'PageDown', does: 'Sights: nearer', group: 'Fight' },
  { code: 'KeyF', does: 'Take · doors · search', group: 'Gear' },
  { code: 'KeyG', does: 'Drop what you hold; held, throw it (the wheel puts it off)', group: 'Gear' },
  { code: 'KeyL', does: 'Light', group: 'Gear' },
  { code: 'Tab', does: 'Inventory', group: 'Gear' },
  { code: 'KeyM', does: 'Map', group: 'Gear' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(slot),
  { code: 'KeyV', does: 'Talk to whoever is near (hold)', group: 'Talk' },
  { code: 'KeyT', does: 'Call out · dance (hold)', group: 'Talk' },
  { code: 'Enter', does: 'Chat', group: 'Talk' },
  // (listed in Settings only to whoever has a role, as the panel is theirs: the owner, 2026-10-17, "once they have the
  // admin role the keybind customization becomes available in the settings panel for rebind")
  { code: 'Backquote', does: 'Admin panel', group: 'Admin' },
];
export const KEY_GROUPS: KeyGroup[] = ['Move', 'Fight', 'Gear', 'Talk', 'Admin'];

/** how fast the mouse turns the head, as a share of what the game was made with */
export const SENS = { least: 0.2, most: 3, step: 0.05 };
/** and how fast while aiming, as a multiple of what the game slows it to there by itself (sights, a scope, binoculars): 1 is the game as it was made */
export const AIM = { least: 0.2, most: 2, step: 0.05 };
/** how fast a controller's right stick turns the head, as a share of what the game was made with (src/core/gamepad.ts) */
export const PAD_SENS = { least: 0.3, most: 3, step: 0.05 };
export interface Controls {
  sens: number;
  aim: number;
  /** played with a controller, laid out as Call of Duty's default (the owner, 2026-10-15: "make sure that the buttons
   * map similar to default COD"; "settings to enable this in the settings menu") */
  pad: boolean;
  padSens: number;
  /** the right stick pushed up looks down */
  padInvert: boolean;
  /** what has been put on another key: the name it is asked for by, to the key that answers to it now */
  keys: Record<string, string>;
  /** what has been put on another of a controller's buttons: its id to the button (src/core/pad-layout.ts) */
  padKeys: Record<string, number>;
}
/** keys nothing may be put on: the menu's own, the browser's (the admin panel's ` was one until it could be moved:
 * it is a key like any other now, its own changing places with whatever is put on it) */
const KEPT = /^(Escape|F\d+|MetaLeft|MetaRight|ContextMenu|PrintScreen|ControlLeft|ControlRight)$/;
export const bindable = (key: string) => !KEPT.test(key);

const STORE = 'zona.controls.v1';
const DEFAULTS = (): Controls => ({ sens: 1, aim: 1, pad: false, padSens: 1, padInvert: false, keys: {}, padKeys: {} });

export function loadControls(): Controls {
  const c = DEFAULTS();
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Controls> | null;
    if (raw && typeof raw === 'object') {
      if (typeof raw.sens === 'number' && raw.sens >= SENS.least && raw.sens <= SENS.most) c.sens = raw.sens;
      if (typeof raw.aim === 'number' && raw.aim >= AIM.least && raw.aim <= AIM.most) c.aim = raw.aim;
      if (typeof raw.pad === 'boolean') c.pad = raw.pad;
      if (typeof raw.padSens === 'number' && raw.padSens >= PAD_SENS.least && raw.padSens <= PAD_SENS.most) c.padSens = raw.padSens;
      if (typeof raw.padInvert === 'boolean') c.padInvert = raw.padInvert;
      for (const a of ACTIONS) {
        const key = raw.keys?.[a.code];
        if (typeof key === 'string' && key && key !== a.code && bindable(key)) c.keys[a.code] = key;
      }
      // (a controller's, kept only whole: two things on one button, as a damaged entry could have, and it is as made)
      const pk: Record<string, number> = {};
      for (const a of PAD_ACTIONS) {
        const b = raw.padKeys?.[a.id];
        if (typeof b === 'number' && b !== a.btn && PAD_BUTTONS.includes(b)) pk[a.id] = b;
      }
      const on = Object.values(padButtons(pk));
      if (new Set(on).size === on.length) c.padKeys = pk;
    }
  } catch {
    /* private mode or a damaged entry: as the game was made */
  }
  return c;
}

let live = loadControls();
/** the controls as they are now */
export const controls = () => live;
export function setControls(c: Controls) {
  live = c;
  try {
    localStorage.setItem(STORE, JSON.stringify(c));
  } catch {
    /* private mode */
  }
}

/** the key that does a thing now */
export const keyOf = (c: Controls, code: string) => c.keys[code] ?? code;

/**
 * A thing put on a key. Whatever that key did before is given the key this thing had (they change places), so
 * that no two things are on one key and nothing is left with none.
 */
export function bind(c: Controls, code: string, key: string): Controls {
  const keys = { ...c.keys }, had = keyOf(c, code);
  const other = ACTIONS.find((a) => a.code !== code && keyOf(c, a.code) === key);
  const put = (what: string, on: string) => {
    if (on === what) delete keys[what];
    else keys[what] = on;
  };
  put(code, key);
  if (other) put(other.code, had);
  return { ...c, keys };
}

/**
 * For the keyboard: each key that now answers to another name, and each key that answers to nothing (its own
 * thing has been put elsewhere, and nothing put on it). A key not in it is itself.
 */
export function translation(c: Controls): Map<string, string> {
  const m = new Map<string, string>(), used = new Set(ACTIONS.map((a) => keyOf(c, a.code)));
  for (const a of ACTIONS) {
    const key = keyOf(c, a.code);
    if (key !== a.code) m.set(key, a.code);
    if (!used.has(a.code)) m.set(a.code, '');
  }
  return m;
}

const NAMES: Record<string, string> = {
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5', Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Bksp', CapsLock: 'Caps',
  ShiftLeft: 'Shift', ShiftRight: 'R Shift', AltLeft: 'Alt', AltRight: 'R Alt', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};
/** a key, as it is written on the screen */
export function keyName(key: string): string {
  if (NAMES[key]) return NAMES[key];
  if (key.startsWith('Key')) return key.slice(3);
  if (key.startsWith('Digit')) return key.slice(5);
  if (key.startsWith('Numpad')) return `Num ${key.slice(6)}`;
  if (key.startsWith('Mouse')) return `M${Number(key.slice(5)) + 1}`;
  return key;
}
/** the key that does a thing now, as it is written on the screen */
export const shown = (code: string) => keyName(keyOf(live, code));

const BY_NAME = new Map(ACTIONS.map((a) => [keyName(a.code).toUpperCase(), a.code]));
/**
 * Words written with keys in them (`<kbd>F</kbd>Take it`), with each key that has been put elsewhere written as
 * the key it is on now. What is written in the game says the key it was made with; this is asked as it is shown.
 */
export function relabel(html: string): string {
  if (!html || !Object.keys(live.keys).length || !html.includes('<kbd')) return html;
  return html.replace(/<kbd([^>]*)>([^<]{1,8})<\/kbd>/g, (all, attrs: string, name: string) => {
    const code = BY_NAME.get(name.trim().toUpperCase());
    return code && keyOf(live, code) !== code ? `<kbd${attrs}>${keyName(keyOf(live, code))}</kbd>` : all;
  });
}
