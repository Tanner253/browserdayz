// What kind of thing an item is, as a small symbol in the top right of it in the inventory and on its hot keys, in
// the colour of its kind: so that a gun, its rounds, a bandage or a tin is told at a glance without the card.
// Solid shapes in one square of 32, as the status symbols' square (src/ui/status-view.ts); the cross, the apple and
// the flask are those very symbols, so a thing that feeds a need wears that need's mark. A hole in a shape (the
// sight's ring, the tag's eye) is drawn turning the other way round, so that it is left empty.

import { ITEMS, type Category } from '../sim/items';
import { SYMBOLS } from './status-view';

type Kind = Category | 'explosive';

const GLYPHS: Record<Kind, string> = {
  // a pistol side on: the slide, the grip raked back
  weapon: 'M4 9H27V14H14L13 17.5H10.5L9.5 25H5L7 14H4Z',
  // a knife: blade, guard and handle
  melee: 'M3 14H17.5V18.5H8C5 18.5 3 17 3 14ZM18 10.5H20.5V22H18ZM21 13H28V19H21Z',
  // one cartridge standing: its bullet over its case
  ammo: 'M12.5 12V10Q16 2 19.5 10V12ZM12 13.5H20V27H12Z',
  // a curved magazine
  magazine: 'M8 3H21L22 9C22.5 14.5 24 19.5 27.5 24.5L17.5 29.5C14 24 11.5 17.5 10.5 10Z',
  // a sight's reticle: a ring, the four posts and the dot
  attachment: 'M16 5A11 11 0 1 1 15.99 5ZM16 8.5A7.5 7.5 0 1 0 16.01 8.5ZM14.8 2H17.2V11.5H14.8ZM14.8 20.5H17.2V30H14.8ZM2 14.8H11.5V17.2H2ZM20.5 14.8H30V17.2H20.5ZM16 14A2 2 0 1 1 15.99 14Z',
  food: SYMBOLS.food.d + SYMBOLS.food.more,
  drink: SYMBOLS.water.d,
  medical: SYMBOLS.health.d,
  // a shirt
  clothing: 'M11.5 5L4 9.5L7 15.5L10 14V27H22V14L25 15.5L28 9.5L20.5 5C19.5 7 18 8 16 8S12.5 7 11.5 5Z',
  // a spanner
  tool: 'M21 4.5A6.5 6.5 0 0 0 14.6 12.6L5 22.2L9.8 27L19.4 17.4A6.5 6.5 0 0 0 27.5 11L23.7 14.8L19.2 12.8L17.2 8.3L21 4.5Z',
  // a case with its handle
  stash: 'M4.5 11H27.5V26.5H4.5ZM11.5 11V5.5H20.5V11H18V8H14V11Z',
  // a grenade: its body, the lever and the pin's ring
  explosive: 'M16 12A7.5 7.5 0 1 1 15.99 12ZM12.5 8H19.5V12.5H12.5ZM25 2A3.2 3.2 0 1 1 24.99 2ZM25 4A1.2 1.2 0 1 0 25.01 4Z',
  // a tag, for what is none of these (the dog tag, the keycard, the radio, the cigarettes, the jerrycan)
  misc: 'M4.5 16.5L16.5 4.5H27.5V15.5L15.5 27.5ZM23 7A2 2 0 1 0 23.01 7Z',
};

/** A thrown thing that goes off is an explosive, whatever list it is kept in (the grenades are in `misc`). */
function kindOf(id: string): Kind {
  const d = ITEMS[id];
  return d.throw ? 'explosive' : d.category;
}

/** The symbol of an item's kind, coloured by the kind's tint (`data-kind` in src/ui/hud.css). */
export function kindIcon(id: string): string {
  const k = kindOf(id);
  return `<span class="kind" data-kind="${ITEMS[id].category}"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="${GLYPHS[k]}"/></svg></span>`;
}
