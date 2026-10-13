// The key to the symbols a survivor's state is read from, as a card for the changelog (2026-10-13: "i dont think we
// should have the status effect key in the tab menu it will clutter the users screen. we can add it to the
// changelog"). Every symbol on it is drawn by the game's own code (src/ui/status-view.ts) from a state made up here,
// in the game's own colours (the block at the end of src/ui/hud.css), so the card cannot show a look the game has
// not. The words beside them are the rules in src/ui/status.ts: if a figure there changes, change it here.
//
//   npx esbuild marketing/status-key.ts --bundle --format=iife --loader:.css=text --outfile=marketing/status-key.js
//   node scripts/card.mjs status-key          -> marketing/zona-status-key.png and .jpg
import css from '../src/ui/hud.css';
import type { Body } from '../src/ui/status';
import { StatusView } from '../src/ui/status-view';

{
  const from = css.indexOf("/* ------------------------------------------------------------ the survivor's state");
  if (from < 0) throw new Error('the looks of the status symbols are not in hud.css where they were');
  const to = css.indexOf('/* ------------------------------------------------------------', from + 10);
  const style = document.createElement('style');
  style.textContent = css.slice(from, to < 0 ? undefined : to);
  // (before the card's own rules, which are to win where the two speak of the same thing)
  document.head.prepend(style);
}

const fine: Body = { health: 100, blood: 5000, bleed: 0, energy: 85, water: 85, broken: false, drip: false, gas: null, fire: null };

/** one symbol alone, as the game draws it for somebody in this state (and, for its arrows, what they were a second before) */
function mark(only: string, is: Partial<Body>, was: Partial<Body> = is): HTMLElement {
  const host = document.createElement('div');
  host.className = 'hud-vitals';
  host.dataset.only = only;
  const view = new StatusView(host);
  if (view.due(0.2, false)) view.show({ ...fine, ...was });
  if (view.due(1, false)) view.show({ ...fine, ...is });
  return host;
}
const el = (tag: string, cls: string, text = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

// ---- what the colour means: a row to each of the four, a column to each of the five looks
const LOOKS = ['Fine', 'Less', 'Low', 'Critical', 'Last: it blinks'];
const ROWS: [string, string, ([Partial<Body>, string] | null)[]][] = [
  ['Health', 'health', [[{ health: 100 }, '80 or more'], [{ health: 70 }, 'Under 80'], [{ health: 45 }, 'Under 50'], [{ health: 25 }, 'Under 30: slower on your feet'], [{ health: 10 }, 'Under 15: one blow ends it']]],
  ['Blood', 'blood', [null, null, [{ blood: 4300 }, 'Under 80%: the colour drains'], [{ blood: 3300 }, 'Under 40%: health stops mending'], [{ blood: 2800 }, 'Under 20%: no running']]],
  ['Food', 'food', [[{ energy: 85 }, 'Over 60'], [{ energy: 50 }, '60 or less: no mending by itself'], [{ energy: 20 }, 'Under 25: hungry'], [{ energy: 8 }, 'Under 10: starving'], [{ energy: 0 }, 'Empty: you lose health']]],
  ['Water', 'water', [[{ water: 85 }, 'Over 60'], [{ water: 50 }, '60 or less: no mending by itself'], [{ water: 20 }, 'Under 25: thirsty'], [{ water: 8 }, 'Under 10: parched'], [{ water: 0 }, 'Empty: you lose health']]],
];
const grid = document.getElementById('looks')!;
grid.append(el('span', 'corner'));
for (const l of LOOKS) grid.append(el('span', 'look', l));
for (const [name, stat, cells] of ROWS) {
  grid.append(el('span', 'stat', name));
  if (!cells[0]) {
    // (blood has no symbol at all with four fifths of it or more)
    const none = el('div', 'cell none', 'Not shown with 80% or more: nothing to say');
    grid.append(none);
  }
  for (const c of cells) {
    if (!c) continue;
    const cell = el('div', 'cell');
    cell.append(mark(stat, c[0]), el('p', '', c[1]));
    grid.append(cell);
  }
}

// ---- the arrows, and the badges
const row = (to: HTMLElement, m: HTMLElement, head: string, text: string) => {
  const r = el('div', 'r');
  const words = el('p', '');
  words.append(el('b', '', head), document.createTextNode(text));
  r.append(m, words);
  to.append(r);
};
const arrows = document.getElementById('arrows')!;
row(arrows, mark('blood', { blood: 4200, bleed: 3.6 }, { blood: 4203.6, bleed: 3.6 }), 'One down', 'Falling slowly: a wound in an arm or a leg');
row(arrows, mark('blood', { blood: 4200, bleed: 6 }, { blood: 4206, bleed: 6 }), 'Two', 'Falling fast: a wound in the body');
row(arrows, mark('blood', { blood: 4200, bleed: 12 }, { blood: 4212, bleed: 12 }), 'Three', 'Very fast: two wounds or more');
row(arrows, mark('blood', { blood: 4275, drip: true }, { blood: 4200, drip: true }), 'Green, up', 'Coming back: here, a blood bag');
const badges = document.getElementById('badges')!;
row(badges, mark('b:bleed', { bleed: 3.6, blood: 4990 }), 'Yellow wound', 'It will close by itself before it kills');
row(badges, mark('b:bleed', { bleed: 12, blood: 4000 }), 'Red wound', 'It will kill you: bandage. More drops, worse');
row(badges, mark('b:leg', { broken: true }), 'Broken leg', 'No running, no jumping: splint it');
row(badges, mark('b:gas', { gas: 'bare' }), 'Gas, no mask', 'You are breathing it: get out');
row(badges, mark('b:gas', { gas: 'masked' }), 'Gas, mask on', 'You can breathe in here');
row(badges, mark('b:fire', { fire: 'mending', health: 60.8 }, { fire: 'mending', health: 60 }), 'Fire', 'Solid: mending you. Outline: only warm');
