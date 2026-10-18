// What an entry of the inventory's menu does, as a small solid symbol before its words (the right button on a
// thing): so that a long menu is read at a glance. Drawn as the kinds' symbols are (src/ui/kind-icons.ts): one
// square of 32, solid, a hole drawn turning the other way round. Where the deed is the thing's own use (to eat, to
// drink, to dress a wound, to wear, to holster or sling a gun) the menu shows that thing's kind instead.

import { kindGlyph } from './kind-icons';

const GLYPHS = {
  // an open hand
  hand: 'M9 17V8.5A1.8 1.8 0 0 1 12.6 8.5V15H13.4V5.5A1.8 1.8 0 0 1 17 5.5V15H17.8V6.5A1.8 1.8 0 0 1 21.4 6.5V15H22.2V9.5A1.8 1.8 0 0 1 25.8 9.5V19C25.8 24.5 22.3 28 16.8 28C13.2 28 11.2 26.4 9.4 23.6L4.3 18.4A1.8 1.8 0 0 1 7.3 16.4Z',
  // an arrow down into a tray: into what is carried
  take: 'M14 3H18V12H22.5L16 19L9.5 12H14ZM4 17H8V23.5H24V17H28V28H4Z',
  // the arrow up out of it: off, out of the way
  out: 'M16 3L22.5 10H18V19H14V10H9.5ZM4 17H8V23.5H24V17H28V28H4Z',
  // an arrow to a wall: across, into the open crate
  move: 'M3 13.5H17V8L25 16L17 24V18.5H3ZM26.5 5H30V27H26.5Z',
  // an arrow down to the ground
  drop: 'M14 3H18V15H22.5L16 22L9.5 15H14ZM4 25.5H28V29.5H4Z',
  // a carton, its two flaps opened out; and a box shut
  open: 'M5 15H27V28H5ZM5 13.5L1.5 7.5H12L15 13.5ZM27 13.5L30.5 7.5H20L17 13.5Z',
  shut: 'M4 15H28V28H4ZM3 9H29V13H3Z',
  // an arrow up into a slot, and down out of it, as a magazine goes in and comes out: simple, as it has to be read
  // at fourteen pixels (a plus was taken for the medical cross; a chain and a puzzle piece were not clear)
  attach: 'M4 15V4H28V15H24V8H8V15ZM13.5 30V20H8.5L16 12L23.5 20H18.5V30Z',
  detach: 'M4 15V4H28V15H24V8H8V15ZM13.5 12V22H8.5L16 30L23.5 22H18.5V12Z',
  // a magazine with nothing in it: its outline only
  empty: 'M9 3H20L21 9C21.5 15 23 20 26 25.5L17 29.5C14 24 12.5 17.5 11.5 10ZM12.6 6L13.9 10.6C14.8 16.6 16.2 22.4 18.6 26.6L22.2 25C19.8 20.5 18.6 15.4 18.1 9.6L17.4 6Z',
  // a gun, and a round fallen out under it
  unload: 'M2 5H28V10H15L14 13.5H11.5L10.5 21H6L8 10H2ZM20 19.5V17.5Q22.5 12 25 17.5V19.5ZM19.6 21H25.4V28.5H19.6Z',
  // one pile in two
  split: 'M3 9H13V23H3ZM19 9H29V23H19ZM15 4H17V28H15Z',
};

export type Act = keyof typeof GLYPHS;

/** A menu entry's symbol: a deed's own, or, where the deed is the thing's use, the thing's kind. */
export function actIcon(act: Act | { kind: string }): string {
  const d = typeof act === 'string' ? GLYPHS[act] : kindGlyph(act.kind);
  return `<svg class="act" viewBox="0 0 32 32" aria-hidden="true"><path d="${d}"/></svg>`;
}
