// The building and crafting guide (the owner, 2026-10-25: "we need a crafting guide and a building guide like we have the
// 'how to play' perhaps we make it a new popup for returning players and new players, shows for everyone with a 'do not
// show again' checkbox ... make it super clear and easy to understand. good UI UX with responsive ui. help the user
// understand what tools they'll need and how to build"). Shown on coming into the game until "Don't show this again" is
// ticked (kept in this browser), and opened from the menu at any time. Steps with Back and Next (the arrow keys, a swipe
// on a phone), a close button and Esc. Every figure is read off the rules the game plays by (pieces.ts, land.ts).

import { BENCH_NEAR, TIERS, TIER_BENCH, costOf, type Tier } from '../sim/build/pieces';
import { KEEP_OFF } from '../sim/build/land';
import { CHARGES } from '../sim/build/charges';
import { ITEMS } from '../sim/items';

const KEY = 'zona.guide.hide';
const name = (id: string) => ITEMS[id]?.name ?? id;
const cost = (c: Record<string, number>) => Object.entries(c).map(([k, n]) => `${n} ${name(k).toLowerCase()}`).join(', ');

interface Step { tab: 'Building' | 'Crafting'; title: string; pic?: string; lines: string[] }

function steps(): Step[] {
  const wall = (t: Tier) => cost(costOf('wall', t));
  return [
    { tab: 'Building', title: 'What you need', pic: '/changelog/media/bb-hut-flag.jpg', lines: [
      `<b>${name('building_plan')}</b>: lays pieces. Made at a workbench (2 rags and coal), or bought from a trader.`,
      `<b>${name('hammer')}</b>: nails pieces up, mends them, turns them, takes them down. Found in sheds and garages, or made at a workbench.`,
      `<b>Planks</b>: saw a log with a <b>${name('hand_saw')}</b> (fell trees with an axe for logs). <b>Nails</b>: found, or bought from a trader.`,
    ] },
    { tab: 'Building', title: 'Where you may build', lines: [
      `Out in the wilderness: at least ${KEEP_OFF.place} m past any town, camp or the fort, and ${KEEP_OFF.building} m from any building.`,
      'Never inside the Zona (the dotted line on the map), on a road or in water.',
      'The plan\'s ghost turns red where you may not build, and says why.',
    ] },
    { tab: 'Building', title: 'Claim, foundation, walls', pic: '/changelog/media/wheel-icons-cancel.jpg', lines: [
      'Hold the plan and <b>right-click</b> for the wheel: pick a piece, let go. <b>Left-click</b> lays it, <b>R</b> turns it.',
      'Lay a <b>claim</b> first: nobody else can build near it, and it keeps your base from decay while it holds upkeep.',
      'Then a <b>foundation</b>, <b>walls</b> on its edges, a <b>doorway</b>, a <b>door</b> in it and a <b>lock</b> on the door.',
    ] },
    { tab: 'Building', title: 'Upgrade: wood, stone, metal, armoured', pic: '/changelog/media/bb-doors-remade.jpg', lines: [
      'Hold the hammer, look at a piece and <b>right-click</b>: pick its new tier. A wall costs:',
      ...([1, 2, 3, 4] as Tier[]).map((t) => `<b>${TIERS[t]}</b>: ${wall(t)}${TIER_BENCH[t] ? ` (workbench level ${TIER_BENCH[t]} within ${BENCH_NEAR} m)` : ''}`),
      'Wood falls to axes; stone and above take far more, metal and armoured need charges.',
    ] },
    { tab: 'Building', title: 'Nails and materials', lines: [
      '<b>Nails</b> are never made: search sheds, garages, farms and above all industrial places, or buy them from a trader.',
      '<b>Stone</b>: mine rocks with a pickaxe. <b>Sheet metal</b> and <b>steel plate</b>: loot, or the forge and the trader.',
      'Every wooden and metal tier is nailed up: carry nails before you start.',
    ] },
    { tab: 'Building', title: 'Workbench, upkeep and the flag', pic: '/changelog/media/bb-hut-flag.jpg', lines: [
      'A <b>workbench</b> (levels I, II, III) makes more things the higher it is, and lets metal and armoured go up.',
      'Put upkeep in the <b>claim</b>: its flag stands at the top of the pole while it is paid and comes down as it runs out.',
      'When the flag reaches the ground the base begins to decay.',
    ] },
    { tab: 'Crafting', title: 'Gathering', pic: '/changelog/media/craft-v3.jpg', lines: [
      '<b>Axe</b> on a tree: logs. <b>Saw</b> on a log on the ground: planks. <b>Pickaxe</b> on a rock: stone and ore.',
      'Every tool wears with use; a broken one is mended at a bench.',
    ] },
    { tab: 'Crafting', title: 'Benches, forge and recycler', pic: '/changelog/media/craft-v3.jpg', lines: [
      'Open your inventory and its <b>Crafting</b> tab: what you can make by hand, and what needs a bench.',
      'Three <b>workbench</b> levels, each making more. The <b>forge</b> smelts ore into iron. The <b>recycler</b> breaks junk into parts.',
      'Learn new things from <b>blueprints</b> at the research table.',
    ] },
    { tab: 'Crafting', title: 'Traders', pic: '/changelog/media/trader-stall.jpg', lines: [
      'Traders stand at their stalls, marked on the map: each buys and sells its own kinds of things.',
      'Open the map (<b>M</b>) to find them.',
    ] },
    { tab: 'Crafting', title: 'Raiding (soon)', lines: [
      `C4 and satchel charges are coming with the raiding update: armed in the hand, thrown, stuck where they land, a C4 going off ${CHARGES.c4.fuse[0]} s after.`,
      'Until then, build without fear of them.',
    ] },
  ];
}

const CSS = `
.gd-veil{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(6,8,8,.72);padding:16px}
.gd{width:min(760px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#121514;color:#e8e6df;border:1px solid #2c332f;border-radius:6px;box-shadow:0 20px 60px rgba(0,0,0,.6);font:14px/1.45 inherit;display:flex;flex-direction:column}
.gd header{display:flex;align-items:center;gap:10px;padding:14px 16px 0}
.gd header b{font-size:18px;letter-spacing:.04em;text-transform:uppercase}
.gd .gd-tabs{display:flex;gap:6px;margin-left:auto}
.gd .gd-tabs button,.gd footer button{background:#1d2220;color:#e8e6df;border:1px solid #333b37;border-radius:4px;padding:8px 14px;font:inherit;cursor:pointer;min-height:40px}
.gd .gd-tabs button.on{background:#c9a24a;color:#111;border-color:#c9a24a}
.gd .gd-x{background:none;border:0;color:#aaa;font-size:24px;cursor:pointer;min-width:40px;min-height:40px}
.gd figure{margin:12px 16px 0;aspect-ratio:16/8;background:#0b0c0c;overflow:hidden;border-radius:4px}
.gd figure img{width:100%;height:100%;object-fit:cover;display:block}
.gd h3{margin:14px 16px 6px;font-size:17px}
.gd ul{margin:0 16px;padding-left:18px}
.gd li{margin:6px 0}
.gd footer{display:flex;align-items:center;gap:10px;padding:14px 16px;margin-top:auto;flex-wrap:wrap}
.gd footer label{display:flex;align-items:center;gap:8px;color:#bbb;cursor:pointer;min-height:40px}
.gd footer .gd-n{margin-left:auto;color:#999}
.gd footer .gd-next{background:#c9a24a;color:#111;border-color:#c9a24a}
@media (max-width:600px){.gd header{flex-wrap:wrap}.gd .gd-tabs{margin-left:0;order:3;width:100%}.gd .gd-tabs button{flex:1}.gd figure{aspect-ratio:16/9}.gd footer .gd-n{order:-1;width:100%;margin:0}}
`;

export class Guide {
  private el: HTMLDivElement | null = null;
  private at = 0;
  private list = steps();
  /** while it is up, the game's own keys and mouse wait (the game asks this) */
  get isOpen() {
    return !!this.el;
  }
  /** what the game does as it opens and shuts (the mouse let go of, and taken again) */
  onToggle: (open: boolean) => void = () => {};

  /** on coming into the game: shown unless "Don't show this again" was ticked */
  welcome() {
    let hide = false;
    try {
      hide = localStorage.getItem(KEY) === '1';
    } catch {}
    if (!hide) this.open();
  }

  open(at = 0) {
    if (this.el) return;
    if (!document.getElementById('gd-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'gd-css', textContent: CSS }));
    this.at = at;
    const veil = (this.el = document.createElement('div'));
    veil.className = 'gd-veil';
    veil.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (e.target === veil || b?.classList.contains('gd-x')) return this.close();
      if (b?.classList.contains('gd-next')) return this.at >= this.list.length - 1 ? this.close() : this.go(this.at + 1);
      if (b?.classList.contains('gd-back')) return this.go(this.at - 1);
      if (b?.dataset.tab) return this.go(this.list.findIndex((s) => s.tab === b.dataset.tab));
    });
    veil.addEventListener('change', (e) => {
      const c = e.target as HTMLInputElement;
      try {
        if (c.type === 'checkbox') localStorage.setItem(KEY, c.checked ? '1' : '0');
      } catch {}
    });
    let x0 = -1;
    veil.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
    veil.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - x0;
      if (x0 >= 0 && Math.abs(dx) > 60) this.go(this.at + (dx < 0 ? 1 : -1));
      x0 = -1;
    });
    document.body.appendChild(veil);
    window.addEventListener('keydown', this.key, true);
    this.draw();
    this.onToggle(true);
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    window.removeEventListener('keydown', this.key, true);
    this.onToggle(false);
  }

  private key = (e: KeyboardEvent) => {
    if (e.code === 'Escape') this.close();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.go(this.at + 1);
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.go(this.at - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  private go(i: number) {
    this.at = Math.max(0, Math.min(this.list.length - 1, i));
    this.draw();
  }

  private draw() {
    if (!this.el) return;
    const s = this.list[this.at], last = this.at === this.list.length - 1;
    let hide = false;
    try {
      hide = localStorage.getItem(KEY) === '1';
    } catch {}
    this.el.innerHTML = `<div class="gd" role="dialog" aria-modal="true" aria-label="Building and crafting guide">
      <header><b>Build &amp; craft</b><div class="gd-tabs">${(['Building', 'Crafting'] as const).map((t) => `<button type="button" data-tab="${t}" class="${s.tab === t ? 'on' : ''}">${t}</button>`).join('')}</div><button type="button" class="gd-x" aria-label="Close">×</button></header>
      ${s.pic ? `<figure><img src="${s.pic}" alt="" loading="lazy" decoding="async"></figure>` : ''}
      <h3>${s.title}</h3>
      <ul>${s.lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      <footer><label><input type="checkbox" ${hide ? 'checked' : ''}> Don't show this again</label><span class="gd-n">${this.at + 1} / ${this.list.length}</span>
      <button type="button" class="gd-back" ${this.at ? '' : 'disabled'}>Back</button><button type="button" class="gd-next">${last ? 'Done' : 'Next'}</button></footer>
    </div>`;
  }
}
