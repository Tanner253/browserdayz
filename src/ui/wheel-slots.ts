// The emote wheel's eight slots as this player has set them (the menu's Emotes tab, src/ui/emotes-menu.ts), kept in
// this browser. The owner, 2026-10-14: "we need to allow the user to assign which emote to which radial key".
import { EMOTE, WHEEL_DEFAULT, WHEEL_SLOTS } from '../sim/emotes';

const KEY = 'zona.wheel';
const told: ((ids: string[]) => void)[] = [];

/** the eight, clockwise from the top: what was set here, or the default (anything no longer in the game is put back to it) */
export function wheelSlots(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    if (Array.isArray(v) && v.length === WHEEL_SLOTS) return v.map((id, i) => (typeof id === 'string' && EMOTE[id] ? id : WHEEL_DEFAULT[i]));
  } catch {
    /* a browser that keeps nothing */
  }
  return [...WHEEL_DEFAULT];
}

export function setWheelSlots(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* kept for this visit only */
  }
  for (const f of told) f(ids);
}

/** told whenever the slots are set */
export function onWheelSlots(f: (ids: string[]) => void) {
  told.push(f);
}
