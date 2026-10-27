// The Crafting tab (2026-10-25, plan-crafting): the inventory's left and middle turned to crafting, Carried kept on the
// right, where what the chosen recipe needs lights up. A rail of kinds, a search, every recipe as a tile (what can be
// made now bright, what cannot dim, a lock on what is not yet learned, a mark and a level where a workbench or a forge is
// needed), the chosen one's card (src/ui/craft-card.ts) and a strip of what the hands are making. Two more views on the
// rail (progression v3: blueprints, Rust's): each bench's tech tree in order, and what is carried that a research table
// would teach. The owner: "the UI and UX must be flawless clean animated and performant with icons and clean intuitive
// flow always".

import { ITEMS } from '../sim/items';
import { CATS, LEVEL_NAME, RECIPE, RECIPES, optionsOf, type Cat, type Level, type Recipe } from '../sim/craft/recipes';
import { most, recipeName, type Pockets } from '../sim/craft/plan';
import { TREE, researchCost, teaches } from '../sim/craft/learn';
import { MAT } from '../sim/craft/materials';
import { CraftCard, type CardHost } from './craft-card';

export interface CraftScreenHost extends CardHost {
  /** the things the chosen recipe takes, lit up in Carried (null: none) */
  light: (ids: Set<string> | null) => void;
  /** what the hands are making now, and how far through (0..1): the strip under the grid */
  making: () => { label: string; t: number; left: number } | null;
  /** the workbench's queue, its first job's progress, and a job taken off it */
  queue: () => { r: string; n: number }[];
  running: () => { r: Recipe; t: number; left: number; paused: boolean } | null;
  unqueue: (i: number) => void;
  /** whether a recipe is known (from the start, or learned) */
  knows: (id: string) => boolean;
  /** an admin in creative: whatever there is can be made */
  free?: () => boolean;
  /** the best bench level within reach (0: none), and whether a research table is */
  level: () => number;
  atTable: () => boolean;
}

type View = Cat | 'all' | 'tree' | 'research';

/** each kind's mark, a path in a box of 24 (as the wheel's: src/ui/radial.ts) */
const GLYPH: Record<View | 'bench' | 'forge' | 'lock', string> = {
  all: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  survival: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
  medical: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  tools: 'M14 4l6 6-3 3-6-6zM12 9L4 17l3 3 8-8',
  build: 'M3 6h18v4H3zM3 14h18v4H3zM9 6v4M15 14v4',
  weapons: 'M2 9h15l2-2h3v4h-6l-2 3h-3l-1 5H6l1-5H2z',
  raid: 'M12 2l2 6 6-2-4 5 5 4-6 0-1 6-3-5-4 4 1-6-6-2 6-2-2-5z',
  tree: 'M5 4v16M5 7h6v4h8M11 11v6h8M5 20h6',
  research: 'M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM15 15l6 6M10 7v6M7 10h6',
  bench: 'M3 10h18v3H3zM5 13v7M19 13v7M8 6l3 4M14 4v6',
  forge: 'M3 8h14a4 4 0 0 1-4 4h-1v3h3v3H7v-3h3v-3H7a4 4 0 0 1-4-4zM19 8h2',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
};
const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ROMAN = ['', 'I', 'II', 'III'];

export class CraftingScreen {
  readonly el = document.createElement('div');
  private view: View = 'all';
  private sel: string = RECIPES[0].id;
  private find = '';
  private card: CraftCard;
  private parts: { rail: HTMLElement; grid: HTMLElement; detail: HTMLElement; strip: HTMLElement; search: HTMLInputElement };
  private tick = 0;
  /** what the strip was last built of: built again only when that changes, its bars moved in between */
  private stripSig = '';

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
      this.view = b.dataset.cat as View;
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
    this.parts.strip.addEventListener('click', (e) => {
      const x = (e.target as HTMLElement).closest<HTMLElement>('[data-x]');
      if (x) h.unqueue(Number(x.dataset.x));
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

  /** the Crafting tab opened on a view: the research table's, when one is opened (F on it) */
  showView(v: View) {
    this.view = v;
  }

  private matches(r: Recipe) {
    if (this.view !== 'all' && r.cat !== this.view) return false;
    if (!this.find) return true;
    const words = [recipeName(r), ITEMS[r.makes]?.name ?? '', ...r.needs.flatMap((n) => [n.name ?? '', ...optionsOf(n).map((id) => ITEMS[id]?.name ?? '')])].join(' ').toLowerCase();
    return words.includes(this.find);
  }

  /** drawn again: what is carried has changed, or what is chosen */
  render() {
    const p: Pockets = this.h.pockets(), icons = this.h.icons();
    const rail = (c: { id: View; name: string }) => `<button data-cat="${c.id}" class="${this.view === c.id ? 'on' : ''}" title="${c.name}">${svg(GLYPH[c.id])}<span>${c.name}</span></button>`;
    this.parts.rail.innerHTML = [{ id: 'all' as const, name: 'All' }, ...CATS].map(rail).join('') + '<hr>' + [{ id: 'tree' as const, name: 'Blueprints' }, { id: 'research' as const, name: 'Research' }].map(rail).join('');
    this.el.classList.toggle('learning', this.view === 'tree' || this.view === 'research');
    let shown: Recipe[];
    if (this.view === 'tree') shown = this.tree(icons);
    else if (this.view === 'research') shown = this.researchView(p, icons);
    else {
      shown = RECIPES.filter((r) => this.matches(r));
      this.parts.grid.className = 'ic-grid';
      this.parts.grid.innerHTML = shown.length ? shown.map((r) => this.tile(r, p, icons)).join('') : `<p class="ic-none">No recipe has “${esc(this.find)}” in it</p>`;
    }
    if (!shown.some((r) => r.id === this.sel) && shown[0]) this.sel = shown[0].id;
    const r = shown.find((x) => x.id === this.sel);
    if (r) this.card.show(r, this.parts.detail);
    else this.card.close();
    this.parts.grid.querySelectorAll<HTMLElement>('[data-r]').forEach((t) => t.classList.toggle('sel', t.dataset.r === this.sel));
    // (what it takes lit up among what is carried)
    this.h.light(r ? new Set(r.needs.flatMap((n) => [...optionsOf(n)])) : null);
    this.strip();
  }

  /** a recipe's tile: bright if it can be made here now, a lock if not learned, the place and its level marked */
  private tile(r: Recipe, p: Pockets, icons: Record<string, string>) {
    const known = this.h.knows(r.id), place = !this.h.where?.(r), can = !!this.h.free?.() || (known && place && most(r, p) > 0);
    const qty = r.by ? '' : r.qty > 1 ? `<em>×${r.qty}</em>` : '';
    const lv = r.at === 'bench' && r.lv && r.lv > 1 ? `<b class="ic-lv">${ROMAN[r.lv]}</b>` : '';
    const title = r.at === 'bench' ? `At a ${LEVEL_NAME[r.lv ?? 1]}` : 'At a forge';
    const mark = r.at === 'hand' ? '' : `<i class="ic-mark ${place ? 'near' : ''}" title="${title}">${svg(GLYPH[r.at])}${lv}</i>`;
    const lock = known ? '' : `<i class="ic-lock" title="Not learned">${svg(GLYPH.lock)}</i>`;
    return `<button data-r="${r.id}" class="ic-tile ${can ? 'can' : 'no'} ${known ? '' : 'locked'}"><i class="ic-pic" style="background-image:url(${icons[r.makes] ?? ''})"></i>${qty}${mark}${lock}<span>${esc(recipeName(r))}</span></button>`;
  }

  /** each bench level's tech tree: its recipes in order along a line, learned ones lit, the next ready, the rest locked */
  private tree(icons: Record<string, string>): Recipe[] {
    const lv = this.h.level(), all: Recipe[] = [];
    const coin = `<i class="ic-coin" style="background-image:url(${icons[MAT.scrap] ?? ''})"></i>`;
    const rows = ([1, 2, 3] as Level[]).map((L) => {
      const nodes = TREE[L].map(([id, cost]) => {
        const r = RECIPE[id];
        if (!r) return '';
        all.push(r);
        // (any not yet known is ready, in any order: the owner, 2026-10-26)
        const known = this.h.knows(id), next = !known;
        const state = known ? 'known' : next ? 'next' : 'locked';
        return `<button data-r="${id}" class="ic-node ${state}" title="${esc(recipeName(r))}"><i class="ic-pic" style="background-image:url(${icons[r.makes] ?? ''})"></i><span>${esc(recipeName(r))}</span><b>${known ? '✓' : `${coin}${cost}`}</b></button>`;
      }).join('');
      const here = lv >= L ? 'here' : '';
      return `<div class="ic-line ${here}"><h5>${svg(GLYPH.bench)}${LEVEL_NAME[L]}<small>${lv >= L ? 'within reach' : `stand at a ${LEVEL_NAME[L]} to unlock`}</small></h5><div class="ic-nodes">${nodes}</div></div>`;
    }).join('');
    this.parts.grid.className = 'ic-grid ic-tree';
    this.parts.grid.innerHTML = rows;
    return all;
  }

  /** what is carried that a research table would teach: each thing, what it costs to learn from it */
  private researchView(p: Pockets, icons: Record<string, string>): Recipe[] {
    const seen = new Set<string>(), out: Recipe[] = [], tiles: string[] = [];
    for (const it of p.all) {
      const r = teaches(it.id);
      if (!r || seen.has(r.id) || this.h.knows(r.id)) continue;
      seen.add(r.id);
      out.push(r);
      tiles.push(`<button data-r="${r.id}" class="ic-tile research"><i class="ic-pic" style="background-image:url(${icons[it.id] ?? ''})"></i><em class="ic-cost"><i class="ic-coin" style="background-image:url(${icons[MAT.scrap] ?? ''})"></i>${researchCost(r.id)}</em><span>${esc(ITEMS[it.id].name)}</span></button>`);
    }
    const at = this.h.atTable();
    const head = `<div class="ic-rhead ${at ? 'here' : ''}">${svg(GLYPH.research)}<div><b>${at ? 'At a research table' : 'No research table within reach'}</b><span>A found thing and scrap are used up; its blueprint is yours for good, through death.</span></div></div>`;
    this.parts.grid.className = 'ic-grid ic-research';
    this.parts.grid.innerHTML = head + (tiles.length ? tiles.join('') : '<p class="ic-none">Nothing you carry has a blueprint left to learn. Guns, fittings, tools and rounds you find do.</p>');
    return out;
  }

  /** the strip: the hold, then the workbench's queue, the first job's bar and every job's cancel */
  private strip() {
    const m = this.h.making(), jobs = this.h.queue(), run = this.h.running(), icons = this.h.icons();
    const sig = JSON.stringify([m?.label ?? '', jobs, run?.paused ?? false]);
    const el = this.parts.strip;
    if (sig === this.stripSig) {
      // (only the bars and the seconds move)
      const hand = el.querySelector<HTMLElement>('.ic-run.hand');
      if (hand && m) {
        hand.querySelector('i')!.style.width = `${Math.round(m.t * 100)}%`;
        hand.querySelector('em')!.textContent = `${Math.ceil(m.left)} s`;
      }
      const first = el.querySelector<HTMLElement>('.ic-job.first');
      if (first && run) {
        first.querySelector<HTMLElement>('i.bar')!.style.width = `${Math.round(run.t * 100)}%`;
        first.querySelector('em')!.textContent = run.paused ? 'away' : `${Math.ceil(run.left)} s`;
      }
      return;
    }
    this.stripSig = sig;
    const parts: string[] = [];
    if (m) parts.push(`<span class="ic-run hand"><b>${esc(m.label)}</b><em>${Math.ceil(m.left)} s</em><i style="width:${Math.round(m.t * 100)}%"></i></span>`);
    jobs.forEach((j, i) => {
      const r = RECIPE[j.r];
      if (!r) return;
      const first = i === 0 && run;
      const tip = first && run.paused ? `Waiting: stand at a ${LEVEL_NAME[r.lv ?? 1]}` : `${recipeName(r)}${j.n > 1 ? ` × ${j.n}` : ''}`;
      parts.push(`<span class="ic-job ${first ? 'first' : ''} ${first && run.paused ? 'paused' : ''}" title="${esc(tip)}"><i class="ic-pic" style="background-image:url(${icons[r.makes] ?? ''})"></i><span>${esc(recipeName(r))}</span>${j.n > 1 ? `<b>×${j.n}</b>` : ''}${first ? `<em>${run.paused ? 'away' : `${Math.ceil(run.left)} s`}</em><i class="bar" style="width:${Math.round(run.t * 100)}%"></i>` : ''}<button data-x="${i}" title="Take it off the bench">×</button></span>`);
    });
    el.innerHTML = parts.length ? parts.join('') : '<span class="ic-idle">Nothing being made</span>';
  }
}
