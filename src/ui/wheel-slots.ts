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

/** the wheel: eight wedges round a hub, the first at the top and the rest clockwise (the player's slots: src/ui/wheel-slots.ts) */
export function wheelSvg(slots: string[]) {
  const n = slots.length, half = Math.PI / n - 0.022, r0 = 58, r1 = 152;
  const pt = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;
  const wedges = slots.map((id, i) => {
    const e = EMOTE[id];
    const a = (i / n) * Math.PI * 2;
    const d = `M${pt(r0, a - half)}L${pt(r1, a - half)}A${r1} ${r1} 0 0 1 ${pt(r1, a + half)}L${pt(r0, a + half)}A${r0} ${r0} 0 0 0 ${pt(r0, a - half)}Z`;
    const [x, y] = pt(108, a).split(' ');
    // two words go on two lines
    const words = e.label.split(' ');
    const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && e.label.length > 9 ? words : [e.label];
    const text = lines.map((l, k) => `<text x="${x}" y="${(Number(y) + (k - (lines.length - 1) / 2) * 17).toFixed(1)}">${l}</text>`).join('');
    return `<g class="${e.hold ? 'keeps' : ''}" data-slot="${i}"><path d="${d}"/>${text}</g>`;
  });
  return `<svg viewBox="-160 -160 320 320" aria-hidden="true">${wedges.join('')}</svg>`;
}
