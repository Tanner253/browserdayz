// The emote wheel's sixteen slots as this player has set them (Emotes, opened from the wheel: src/ui/emotes-menu.ts), kept in
// this browser. The owner, 2026-10-14: "we need to allow the user to assign which emote to which radial key".
import { EMOTE, WHEEL_DEFAULT, WHEEL_RING, WHEEL_SLOTS } from '../sim/emotes';

const KEY = 'zona.wheel';
const told: ((ids: string[]) => void)[] = [];

/** the sixteen, the inner ring and then the outer, each clockwise from the top: what was set here, or the default
 * (anything no longer in the game is put back to it; a wheel set when there were eight keeps them, the outer ring added) */
export function wheelSlots(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
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

/** the wheel: two rings of eight wedges round a hub, each ring's first at the top and the rest clockwise (the player's slots: src/ui/wheel-slots.ts) */
export function wheelSvg(slots: string[]) {
  const pt = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;
  const wedges = slots.map((id, i) => {
    const e = EMOTE[id];
    const { r0, r1, text: tr } = RINGS[Math.min(RINGS.length - 1, Math.floor(i / WHEEL_RING))];
    const a = ((i % WHEEL_RING) / WHEEL_RING) * Math.PI * 2, half = Math.PI / WHEEL_RING - 0.022 * (58 / r0);
    const d = `M${pt(r0, a - half)}L${pt(r1, a - half)}A${r1} ${r1} 0 0 1 ${pt(r1, a + half)}L${pt(r0, a + half)}A${r0} ${r0} 0 0 0 ${pt(r0, a - half)}Z`;
    const [x, y] = pt(tr, a).split(' ');
    // two words go on two lines
    const words = e.label.split(' ');
    const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && e.label.length > 9 ? words : [e.label];
    const text = lines.map((l, k) => `<text x="${x}" y="${(Number(y) + (k - (lines.length - 1) / 2) * 17).toFixed(1)}">${l}</text>`).join('');
    return `<g class="${e.hold ? 'keeps' : ''}" data-slot="${i}"><path d="${d}"/>${text}</g>`;
  });
  return `<svg viewBox="-210 -210 420 420" aria-hidden="true">${wedges.join('')}</svg>`;
}
