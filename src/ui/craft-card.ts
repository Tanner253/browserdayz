// A recipe's card (2026-10-24, plan-crafting): what it makes, what it needs with what you carry in green and red, the
// place it needs, its time, how many (1, 5, the most), and Craft. Shown where two things are dragged onto each other
// in the inventory (DayZ's way: one card per recipe the two go into), and as the Crafting tab's detail pane. A recipe
// not yet learned shows the two ways to learn it in place of Craft (progression v3: a bench's tech tree, or a research
// table). The owner: "the UI and UX must be flawless clean animated and performant with icons and clean intuitive flow
// always".

import { ITEMS } from '../sim/items';
import { most, needsOf, plan, recipeName, type Pockets } from '../sim/craft/plan';
import { LEVEL_NAME, RECIPE, type Recipe } from '../sim/craft/recipes';
import { TREE, type LearnWays } from '../sim/craft/learn';
import { MAT } from '../sim/craft/materials';
import './craft.css';

export interface CardHost {
  icons: () => Record<string, string>;
  pockets: () => Pockets;
  /** begin it: `n` of recipe `rid`, the things in `u` used first */
  craft: (rid: string, n: number, u: string[]) => void;
  /** why a recipe cannot be made where this player stands (no bench, too low a bench, no forge); null: it can */
  where?: (r: Recipe) => string | null;
  /** how a recipe not yet learned may be learned (null: it is known) */
  ways?: (r: Recipe) => LearnWays | null;
  unlock?: (rid: string) => void;
  research?: (uid: string) => void;
}

const PLACE = { hand: 'By hand, anywhere', bench: 'At a workbench, within 4 m', forge: 'At a forge' } as const;
/** the recipe before one in its tree (what must be learned first) */
const before = (r: Recipe) => {
  for (const line of Object.values(TREE)) {
    const i = line.findIndex(([id]) => id === r.id);
    if (i > 0) return line[i - 1][0];
  }
  return null;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const secs = (t: number) => (t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${Math.round(t * 10) / 10} s`);

export class CraftCard {
  readonly el = document.createElement('div');
  private recipes: Recipe[] = [];
  private pick = 0;
  private qty: 1 | 5 | 'max' = 1;
  private u: string[] = [];
  /** a card floating where it was asked for (drag-onto), or laid in a pane (the tab) */
  private floating = false;
  private away = (e: PointerEvent) => {
    if (this.floating && !this.el.contains(e.target as Node)) this.close();
  };
  private keys = (e: KeyboardEvent) => {
    if (!this.el.isConnected) return;
    if (e.key === 'Escape' && this.floating) {
      e.stopPropagation();
      this.close();
    } else if (e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'INPUT') {
      e.preventDefault();
      this.go();
    }
  };

  constructor(private h: CardHost) {
    this.el.className = 'craft-card';
    this.el.addEventListener('click', (e) => this.click(e));
  }

  /** floating at a point, for the recipes two dragged things go into */
  float(recipes: Recipe[], at: { x: number; y: number }, u: string[]) {
    this.recipes = recipes;
    this.pick = 0;
    this.qty = 1;
    this.u = u;
    this.floating = true;
    this.el.classList.add('floating');
    document.body.appendChild(this.el);
    this.render();
    // (beside the pointer, kept on the screen)
    const r = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, at.x + 14))}px`;
    this.el.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, at.y - 20))}px`;
    this.el.classList.remove('pop');
    void this.el.offsetWidth;
    this.el.classList.add('pop');
    setTimeout(() => addEventListener('pointerdown', this.away, true), 0);
    addEventListener('keydown', this.keys, true);
  }

  /** laid in a pane, for one recipe (the Crafting tab) */
  show(r: Recipe, into: HTMLElement) {
    if (this.recipes[0] !== r || this.recipes.length !== 1) this.qty = 1;
    this.recipes = [r];
    this.pick = 0;
    this.u = [];
    this.floating = false;
    this.el.classList.remove('floating');
    if (this.el.parentElement !== into) into.appendChild(this.el);
    this.render();
    addEventListener('keydown', this.keys, true);
  }

  close() {
    this.el.remove();
    removeEventListener('pointerdown', this.away, true);
    removeEventListener('keydown', this.keys, true);
  }

  get open() {
    return this.el.isConnected;
  }

  /** drawn again: what is carried has changed */
  render() {
    const r = this.recipes[this.pick];
    if (!r) return;
    const p = this.h.pockets(), icons = this.h.icons(), top = most(r, p), ways = this.h.ways?.(r) ?? null;
    const n = this.qty === 'max' ? Math.max(1, top) : this.qty;
    const q = plan(r, n, p, this.u), place = this.h.where?.(r) ?? null, ok = typeof q !== 'string' && !place && !ways;
    const makes = typeof q === 'string' ? (r.by ? null : r.qty * n) : q.makes, time = typeof q === 'string' ? r.time * n : q.time;
    const why = typeof q === 'string' ? q : place ?? '';
    const pic = (id: string) => `<i class="cc-pic" style="background-image:url(${icons[id] ?? ''})"></i>`;
    const tabs = this.recipes.length > 1
      ? `<div class="cc-tabs">${this.recipes.map((x, i) => `<button data-tab="${i}" class="${i === this.pick ? 'on' : ''}">${pic(x.makes)}${esc(recipeName(x))}</button>`).join('')}</div>`
      : '';
    const rows = needsOf(r, n, p).map((x) => {
      const id = x.ids.find((o) => p.all.some((it) => it.id === o)) ?? x.ids[0], good = x.have >= x.need;
      const count = x.keep ? (good ? 'carried' : 'none') : `${x.have} / ${x.need}`;
      return `<div class="cc-need ${good ? 'good' : 'bad'}">${pic(id)}<span>${esc(x.name)}${x.keep ? '<em>kept, worn a little</em>' : ''}</span><b>${count}</b></div>`;
    }).join('');
    const qty = ([1, 5, 'max'] as const).map((k) => `<button data-qty="${k}" class="${this.qty === k ? 'on' : ''}">${k === 'max' ? `Max${top > 1 ? ` (${top})` : ''}` : k}</button>`).join('');
    const where = r.at === 'bench' && r.lv && r.lv > 1 ? `At a ${LEVEL_NAME[r.lv]}, within 4 m` : PLACE[r.at];
    this.el.innerHTML = `${tabs}
      <div class="cc-head">${pic(r.makes).replace('cc-pic', 'cc-pic big')}<div><h4>${esc(recipeName(r))}</h4><p>${esc(ITEMS[r.makes]?.desc ?? '')}</p></div>${this.floating ? '<button class="cc-x" data-x aria-label="Close">×</button>' : ''}</div>
      <div class="cc-needs">${rows}</div>
      <div class="cc-meta"><span>${where}</span><span>${makes === null ? '' : `Makes ${makes}`} · ${secs(time)}</span></div>
      ${ways ? this.learnBlock(r, ways, icons) : `${r.at === 'forge' ? '' : `<div class="cc-qty">${qty}</div>`}
      ${why ? `<div class="cc-why">${esc(why)}</div>` : ''}
      <button class="cc-go" data-go ${ok ? '' : 'disabled'}>${r.at === 'bench' ? 'Queue' : 'Craft'}${typeof q !== 'string' && q.n > 1 ? ` ${q.n}` : ''}<kbd>Enter</kbd></button>`}`;
  }

  /** a recipe not yet learned: its tree's place and its research, each with why it cannot be done now */
  private learnBlock(r: Recipe, w: LearnWays, icons: Record<string, string>) {
    const coin = `<i class="cc-coin" style="background-image:url(${icons[MAT.scrap] ?? ''})"></i>`;
    const prev = before(r), after = prev ? `, after the ${esc(ITEMS[RECIPE[prev]?.makes]?.name ?? prev)}` : ', its first';
    const tree = w.tree
      ? `<div class="cc-way"><div><b>Tech tree</b><span>${LEVEL_NAME[w.tree.lv]}${after}</span>${w.tree.why ? `<em>${esc(w.tree.why)}</em>` : ''}</div><button data-unlock ${w.tree.why ? 'disabled' : ''}>Unlock ${coin}${w.tree.cost}</button></div>`
      : '';
    const res = w.research;
    const what = res.uses > 1 ? `${res.uses} ${ITEMS[r.makes].name}` : `the ${ITEMS[r.makes].name}`;
    const research = `<div class="cc-way"><div><b>Research</b><span>Uses up ${esc(what)}</span>${res.why ? `<em>${esc(res.why)}</em>` : ''}</div><button data-research ${res.why ? 'disabled' : ''}>Research ${coin}${res.cost}</button></div>`;
    return `<div class="cc-learn"><h5><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z"/></svg>Blueprint not learned</h5>${tree}${research}</div>`;
  }

  private click(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.tab) this.pick = Number(t.dataset.tab);
    else if (t.dataset.qty) this.qty = t.dataset.qty === 'max' ? 'max' : (Number(t.dataset.qty) as 1 | 5);
    else if (t.dataset.x !== undefined) return this.close();
    else if (t.dataset.go !== undefined) return this.go();
    else if (t.dataset.unlock !== undefined) {
      const r = this.recipes[this.pick];
      if (r && !(t as HTMLButtonElement).disabled) this.h.unlock?.(r.id);
    } else if (t.dataset.research !== undefined) {
      const r = this.recipes[this.pick], uid = r && this.h.ways?.(r)?.research.uid;
      if (uid && !(t as HTMLButtonElement).disabled) this.h.research?.(uid);
    }
    this.render();
  }

  private go() {
    const r = this.recipes[this.pick];
    if (!r || this.el.querySelector<HTMLButtonElement>('.cc-go')?.disabled) return;
    const n = this.qty === 'max' ? Math.max(1, most(r, this.h.pockets())) : this.qty;
    this.h.craft(r.id, n, this.u);
    if (this.floating) this.close();
  }
}
