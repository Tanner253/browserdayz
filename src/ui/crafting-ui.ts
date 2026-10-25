// The Crafting tab (2026-10-25, plan-crafting): the inventory's left and middle turned to crafting, Carried kept on the
// right, where what the chosen recipe needs lights up. A rail of kinds, a search, every recipe as a tile (what can be
// made now bright, what cannot dim, a mark where a workbench or a forge is needed), the chosen one's card (src/ui/craft-
// card.ts) and a strip of what the hands are making. Every recipe is known from the start (DayZ). The owner: "the UI and
// UX must be flawless clean animated and performant with icons and clean intuitive flow always".

import { ITEMS } from '../sim/items';
import { CATS, RECIPES, optionsOf, type Cat, type Recipe } from '../sim/craft/recipes';
import { most, recipeName, type Pockets } from '../sim/craft/plan';
import { CraftCard, type CardHost } from './craft-card';

export interface CraftScreenHost extends CardHost {
  /** the things the chosen recipe takes, lit up in Carried (null: none) */
  light: (ids: Set<string> | null) => void;
  /** what the hands are making now, and how far through (0..1): the strip under the grid */
  making: () => { label: string; t: number; left: number } | null;
}

/** each kind's mark, a path in a box of 24 (as the wheel's: src/ui/radial.ts) */
const GLYPH: Record<Cat | 'all' | 'bench' | 'forge', string> = {
  all: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  survival: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
  medical: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  tools: 'M14 4l6 6-3 3-6-6zM12 9L4 17l3 3 8-8',
  build: 'M3 6h18v4H3zM3 14h18v4H3zM9 6v4M15 14v4',
  raid: 'M12 2l2 6 6-2-4 5 5 4-6 0-1 6-3-5-4 4 1-6-6-2 6-2-2-5z',
  bench: 'M3 10h18v3H3zM5 13v7M19 13v7M8 6l3 4M14 4v6',
  forge: 'M6 21h12l-1-9H7zM9 12V8M15 12V8M12 3c1 2 2 3 2 5a2 2 0 0 1-4 0c0-2 1-3 2-5z',
};
const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export class CraftingScreen {
  readonly el = document.createElement('div');
  private cat: Cat | 'all' = 'all';
  private sel: string = RECIPES[0].id;
  private find = '';
  private card: CraftCard;
  private parts: { rail: HTMLElement; grid: HTMLElement; detail: HTMLElement; strip: HTMLElement; search: HTMLInputElement };
  private tick = 0;

  constructor(private h: CraftScreenHost) {
    this.card = new CraftCard(h);
    this.el.className = 'inv-craft';
    this.el.innerHTML = `<div class="ic-rail"></div>
      <div class="ic-main"><label class="ic-search">${svg('M10 3a7 7 0 1 1-4.9 12l-3.6 3.6-1.4-1.4L3.7 13.6A7 7 0 0 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z')}<input type="text" placeholder="Search recipes" spellcheck="false" autocomplete="off"></label>
      <div class="ic-grid"></div><div class="ic-strip"></div></div>
      <div class="ic-detail"></div>`;
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
    this.parts = { rail: q('.ic-rail'), grid: q('.ic-grid'), detail: q('.ic-detail'), strip: q('.ic-strip'), search: q<HTMLInputElement>('.ic-search input') };
    this.parts.rail.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]');
      if (!b) return;
      this.cat = b.dataset.cat as Cat | 'all';
      this.render();
    });
    this.parts.grid.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
      if (!t) return;
      this.sel = t.dataset.r!;
      this.render();
    });
    // (a double click makes one at once)
    this.parts.grid.addEventListener('dblclick', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
      if (t && t.classList.contains('can')) h.craft(t.dataset.r!, 1, []);
    });
    this.parts.search.addEventListener('input', () => {
      this.find = this.parts.search.value.trim().toLowerCase();
      this.render();
    });
    this.parts.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.parts.search.value) {
        e.stopPropagation();
        this.parts.search.value = this.find = '';
        this.render();
      } else if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') {
        if (e.key === 'Tab') e.preventDefault();
        this.parts.search.blur();
      }
    });
  }

  /** shown or put away with the tab (the strip runs on a clock only while it is shown) */
  shown(on: boolean) {
    clearInterval(this.tick);
    if (on) {
      this.render();
      this.tick = window.setInterval(() => this.strip(), 200);
    } else {
      this.card.close();
      this.h.light(null);
    }
  }

  private matches(r: Recipe) {
    if (this.cat !== 'all' && r.cat !== this.cat) return false;
    if (!this.find) return true;
    const words = [recipeName(r), ITEMS[r.makes]?.name ?? '', ...r.needs.flatMap((n) => [n.name ?? '', ...optionsOf(n).map((id) => ITEMS[id]?.name ?? '')])].join(' ').toLowerCase();
    return words.includes(this.find);
  }

  /** drawn again: what is carried has changed, or what is chosen */
  render() {
    const p: Pockets = this.h.pockets(), icons = this.h.icons();
    this.parts.rail.innerHTML = [{ id: 'all' as const, name: 'All' }, ...CATS]
      .map((c) => `<button data-cat="${c.id}" class="${this.cat === c.id ? 'on' : ''}" title="${c.name}">${svg(GLYPH[c.id])}<span>${c.name}</span></button>`)
      .join('');
    const shown = RECIPES.filter((r) => this.matches(r));
    if (!shown.some((r) => r.id === this.sel) && shown[0]) this.sel = shown[0].id;
    this.parts.grid.innerHTML = shown.length
      ? shown.map((r) => {
          const n = most(r, p), place = r.at === 'hand' || !!this.h.near?.(r.at), can = n > 0 && place;
          const qty = r.by ? '' : r.qty > 1 ? `<em>×${r.qty}</em>` : '';
          const mark = r.at === 'hand' ? '' : `<i class="ic-mark ${place ? 'near' : ''}" title="${r.at === 'bench' ? 'At a workbench' : 'At a forge'}">${svg(GLYPH[r.at])}</i>`;
          return `<button data-r="${r.id}" class="ic-tile ${can ? 'can' : 'no'} ${r.id === this.sel ? 'sel' : ''}"><i class="ic-pic" style="background-image:url(${icons[r.makes] ?? ''})"></i>${qty}${mark}<span>${esc(recipeName(r))}</span></button>`;
        }).join('')
      : `<p class="ic-none">No recipe has “${esc(this.find)}” in it</p>`;
    const r = RECIPES.find((x) => x.id === this.sel);
    if (r) this.card.show(r, this.parts.detail);
    else this.card.close();
    // (what it takes lit up among what is carried)
    this.h.light(r ? new Set(r.needs.flatMap((n) => [...optionsOf(n)])) : null);
    this.strip();
  }

  private strip() {
    const m = this.h.making();
    const was = this.parts.strip.dataset.on === '1';
    if (!m) {
      if (was) {
        this.parts.strip.dataset.on = '0';
        this.parts.strip.innerHTML = '<span class="ic-idle">Nothing being made</span>';
      } else if (!this.parts.strip.innerHTML) this.parts.strip.innerHTML = '<span class="ic-idle">Nothing being made</span>';
      return;
    }
    this.parts.strip.dataset.on = '1';
    const left = `${Math.ceil(m.left)} s`;
    const bar = this.parts.strip.querySelector<HTMLElement>('.ic-run i');
    if (bar && this.parts.strip.querySelector('.ic-run b')?.textContent === m.label) {
      bar.style.width = `${Math.round(m.t * 100)}%`;
      this.parts.strip.querySelector('.ic-run em')!.textContent = left;
      return;
    }
    this.parts.strip.innerHTML = `<span class="ic-run"><b>${esc(m.label)}</b><em>${left}</em><i style="width:${Math.round(m.t * 100)}%"></i></span>`;
  }
}
