// The emote wheel's sixteen slots as this player has set them (Emotes, opened from the wheel: src/ui/emotes-menu.ts), kept in
// this browser. The owner, 2026-10-14: "we need to allow the user to assign which emote to which radial key".
import { EMOTE, WHEEL_CANCEL_AT, WHEEL_DEFAULT, WHEEL_RING, WHEEL_SLOTS } from '../sim/emotes';
import { ICONS, radialSvg, type RadialEntry } from './radial';

const KEY = 'zona.wheel';
const told: ((ids: string[]) => void)[] = [];

/** the fifteen, the inner ring and then the outer round Cancel, each clockwise from the top: what was set here, or the
 * default (anything no longer in the game is put back to it; a wheel set when there were eight keeps them, the outer
 * ring added; one of sixteen lets go of the slot where Cancel is now, and keeps the rest where they were) */
export function wheelSlots(): string[] {
  try {
    let v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    if (Array.isArray(v) && v.length === WHEEL_SLOTS + 1) v = [...v.slice(0, WHEEL_CANCEL_AT), ...v.slice(WHEEL_CANCEL_AT + 1)];
    if (Array.isArray(v) && v.length > 0 && v.length <= WHEEL_SLOTS) return WHEEL_DEFAULT.map((d, i) => (typeof v[i] === 'string' && EMOTE[v[i] as string] ? (v[i] as string) : d));
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

/** where the rings are, of the wheel's radius of 210: the inner from the hub out, the outer round it */
export const RINGS = [
  { r0: 46, r1: 122, text: 84 },
  { r0: 127, r1: 205, text: 166 },
];

/** an emote's icon (src/ui/radial.ts ICONS): its own, else its kind's */
export function emoteIcon(id: string): string {
  const e = EMOTE[id];
  return ICONS[id] ? id : e.kind === 'dance' || e.kind === 'gesture' ? e.kind : e.hold === 'surrender' ? 'surrender' : e.hold === 'sit' ? 'sit' : 'call';
}

/** the slots as the wheel on T has them (src/ui/radial.ts): each emote's icon and words, those kept up until stopped drawn quieter */
export function wheelEntries(slots: string[]): RadialEntry[] {
  return slots.map((id) => ({ id, label: EMOTE[id].label, icon: emoteIcon(id), ...(EMOTE[id].hold ? { mark: 'keeps' as const } : {}) }));
}

/** the wheel as Emotes sets it: the one held up in the game (radialSvg), each wedge's data-slot its slot, Cancel's 'cancel' */
export function wheelSvg(slots: string[]) {
  return radialSvg(wheelEntries(slots), RINGS, WHEEL_RING, true);
}
