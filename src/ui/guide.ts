// The building and crafting guide (the owner, 2026-10-25: "we need a crafting guide and a building guide like we have the
// 'how to play' perhaps we make it a new popup for returning players and new players, shows for everyone with a 'do not
// show again' checkbox ... make it super clear and easy to understand. good UI UX with responsive ui. help the user
// understand what tools they'll need and how to build"). Shown on coming into the game until "Don't show this again" is
// ticked (kept in this browser), and opened from the menu at any time. Steps with Back and Next (the arrow keys, a swipe
// on a phone), a close button and Esc. Every figure is read off the rules the game plays by (pieces.ts, land.ts).

import { BENCH_NEAR, TIERS, TIER_BENCH, costOf, type Tier } from '../sim/build/pieces';
import { KEEP_OFF } from '../sim/build/land';
import { ITEMS } from '../sim/items';

const KEY = 'zona.guide.hide';
const name = (id: string) => ITEMS[id]?.name ?? id;
const cost = (c: Record<string, number>) => Object.entries(c).map(([k, n]) => `${n} ${name(k).toLowerCase()}`).join(', ');

interface Step { tab: 'Building' | 'Crafting'; title: string; pic?: string; lines: string[] }

function steps(): Step[] {
  const wall = (t: Tier) => cost(costOf('wall', t));
  return [
    { tab: 'Building', title: 'Where to find what you need', pic: '/guide/map.mp4', lines: [
      '<b>Tools</b> (axes, pickaxe, saw, hammer) lie in <b>farms</b>, <b>hunting</b> spots and <b>industrial</b> places: barns, sheds, garages, works.',
      '<b>Nails</b> and <b>sheet metal</b>: sheds, garages, farms, most of all <b>industrial</b> places. Nails are never made.',
      'The <b>trader camps</b> (on the map, <b>M</b>) sell nails, planks, the building plan and locks.',
    ] },
    { tab: 'Building', title: 'The tools', pic: '/guide/tools.mp4', lines: [
      '<b>Felling axe</b>: trees into logs. <b>Pickaxe</b>: rock into stone. <b>Hand saw</b>: logs into planks.',
      '<b>Hammer</b>: nails pieces up, upgrades, mends, turns and takes them down. <b>Building plan</b>: lays pieces.',
      'The plan, hammer and saw are also made at a workbench.',
    ] },
    { tab: 'Building', title: 'Chop a tree', pic: '/guide/chop.mp4', lines: [
      'Hold the axe, walk up to a tree and <b>hold the left button</b>: it swings until the tree comes down.',
      'Its <b>logs</b> fall beside it. Pick them up with <b>F</b>.',
    ] },
    { tab: 'Building', title: 'Break rock', pic: '/guide/mine.mp4', lines: [
      'Hold the pickaxe at a rock and <b>hold the left button</b>: <b>stone</b> breaks off into your pockets.',
      'A rock gives out after a while; it comes back later.',
    ] },
    { tab: 'Building', title: 'Saw planks', pic: '/guide/saw.mp4', lines: [
      'Drop a log on the ground, hold the saw, look at the log and press the <b>left button</b>.',
      'It is sawn into <b>planks</b> where it lies.',
    ] },
    { tab: 'Building', title: 'Pick a piece', pic: '/guide/wheel.mp4', lines: [
      'Hold the building plan and <b>hold the right button</b>: the wheel of pieces opens.',
      'Move the mouse onto a group, then onto a piece, and let go. The bottom of the wheel is Cancel.',
      `Build in the wilderness only: ${KEEP_OFF.place} m past any town or camp, ${KEEP_OFF.building} m from any building, never in the Zona. A red ghost says why not.`,
    ] },
    { tab: 'Building', title: 'Foundation and claim', pic: '/guide/found.mp4', lines: [
      `Aim at the ground: the ghost shows where. <b>Left-click</b> lays it, <b>R</b> turns it. A foundation costs ${cost(costOf('foundation', 0))}.`,
      'Lay a <b>claim</b> on it (click to set it, move to turn it, click again). Nobody else may build near your claim.',
    ] },
    { tab: 'Building', title: 'Walls and a doorway', pic: '/guide/walls.mp4', lines: [
      'Pick <b>Wall</b> and aim at a foundation\'s edge: it snaps there. Pick <b>Doorway</b> for the way in.',
      'Pieces go up as bare frames, to be nailed up with the hammer.',
    ] },
    { tab: 'Building', title: 'Upgrade with the hammer', pic: '/guide/upgrade.mp4', lines: [
      'Hold the hammer, look at a piece, <b>hold the right button</b> and pick its new tier. The hammer nails it up.',
      'A damaged piece: <b>hold the left button</b> on it with the hammer to mend it, paid from your pockets in what it is made of and nails. The same wheel picks up or deconstructs.',
      ...([1, 2, 3, 4] as Tier[]).map((t) => `<b>${TIERS[t]}</b>: ${wall(t)}${TIER_BENCH[t] ? ` (a level ${TIER_BENCH[t]} workbench within ${BENCH_NEAR} m)` : ''}`),
    ] },
    { tab: 'Building', title: 'A door and a lock', pic: '/guide/door.mp4', lines: [
      'Make a <b>door</b> at the crafting screen, hold it and aim at the doorway: the <b>left button</b> hangs it there, <b>R</b> turns its swing.',
      'Hold a <b>key lock</b> or <b>code lock</b>, look at the door and <b>left-click</b> to fit it (a code lock asks for its code).',
      'A key lock comes with its key. Copy the key at the crafting screen to give to friends.',
    ] },
    { tab: 'Building', title: 'The flag and upkeep', pic: '/changelog/media/bb-hut-flag.jpg', lines: [
      'Press <b>F</b> at your claim and put upkeep in its store: each day the base takes what it is built of, <b>planks</b> for wood, <b>stone</b>, <b>metal fragments</b> for metal and <b>iron bars</b> for armoured. Its flag stands at the top of the pole while it is paid.',
      'As upkeep runs out the flag comes down; when it reaches the ground the base begins to decay.',
    ] },
    { tab: 'Crafting', title: 'The workbench', pic: '/guide/bench.mp4', lines: [
      'Open your inventory (<b>Tab</b>) and its <b>Crafting</b> page: what you can make by hand, and what needs a bench.',
      'Make a <b>workbench</b> by hand, take it in your hands and <b>left-click</b> on a floor of your base to set it down (<b>R</b> turns it). Press <b>F</b> at it to craft with it: everything of its level and below.',
      'Nail it up with the hammer to <b>level II</b> and <b>III</b> for more, and for metal and armoured walls.',
    ] },
    { tab: 'Crafting', title: 'The forge', pic: '/changelog/media/trader-stall.jpg', lines: [
      'Make a <b>forge</b> by hand, hold it and set it down on a floor of your base. Press <b>F</b> at it: put in metal fragments (ten make a bar) and something to burn, logs, firewood, charcoal or planks, and <b>iron bars</b> come out (armoured walls take them).',
    ] },
    { tab: 'Crafting', title: 'The recycler', pic: '/guide/recycler.mp4', lines: [
      'Recyclers stand at the works (Zavod), the army camp, the fort, the chemical works and the trader camp.',
      'Press <b>F</b>, put in what you don\'t need and switch it on: it breaks it into fragments, scrap and rags. It is loud.',
    ] },
    { tab: 'Crafting', title: 'The research table', pic: '/changelog/media/craft-v3.jpg', lines: [
      'You start knowing the basics; everything else is learned. Make a <b>research table</b> at a workbench, set it down beside it, press <b>F</b>, and put in an item you found with some scrap: it is used up, and you know how to make it for good.',
    ] },
    { tab: 'Crafting', title: 'Traders', pic: '/guide/traders.mp4', lines: [
      'The trader camp is on the map (<b>M</b>). Each stall buys and sells its own kinds of things: building, weapons, medical, clothing.',
    ] },
  ];
}

// (a fixed frame: the same size on every step, the picture in a fixed-ratio box, the words scrolling in theirs, and
// Back, Next and the dots pinned at the foot, so nothing moves under the pointer from step to step: the owner,
// 2026-10-25, "the ui container keeps jumping around as its size is defined by the content within it")
const CSS = `
.gd-veil{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:rgba(6,8,8,.72);padding:16px}
.gd{width:min(760px,100%);height:min(680px,calc(100vh - 32px));background:#121514;color:#e8e6df;border:1px solid #2c332f;border-radius:6px;box-shadow:0 20px 60px rgba(0,0,0,.6);font:14px/1.45 inherit;display:flex;flex-direction:column;overflow:hidden}
.gd header{display:flex;align-items:center;gap:10px;padding:14px 16px 0;flex:none}
.gd header b{font-size:18px;letter-spacing:.04em;text-transform:uppercase}
.gd .gd-tabs{display:flex;gap:6px;margin-left:auto}
.gd .gd-tabs button,.gd footer button{background:#1d2220;color:#e8e6df;border:1px solid #333b37;border-radius:4px;padding:8px 14px;font:inherit;cursor:pointer;min-height:40px}
.gd .gd-tabs button.on{background:#c9a24a;color:#111;border-color:#c9a24a}
.gd .gd-x{background:none;border:0;color:#aaa;font-size:24px;cursor:pointer;min-width:40px;min-height:40px}
.gd figure{margin:12px 16px 0;aspect-ratio:16/9;max-height:46%;flex:none;background:#0b0c0c;overflow:hidden;border-radius:4px;align-self:center;width:calc(100% - 32px)}
.gd figure img,.gd figure video{width:100%;height:100%;object-fit:cover;display:block}
.gd .gd-words{flex:1;min-height:0;overflow:auto;padding:0 16px}
.gd h3{margin:14px 0 6px;font-size:17px}
.gd ul{margin:0;padding-left:18px}
.gd li{margin:6px 0}
.gd footer{display:flex;align-items:center;gap:10px;padding:12px 16px;flex:none;border-top:1px solid #222826}
.gd footer label{display:flex;align-items:center;gap:8px;color:#bbb;cursor:pointer;min-height:40px}
.gd .gd-dots{display:flex;gap:5px;margin-left:auto}
.gd .gd-dots i{width:7px;height:7px;border-radius:50%;background:#3a423e}
.gd .gd-dots i.on{background:#c9a24a}
.gd footer .gd-next{background:#c9a24a;color:#111;border-color:#c9a24a;min-width:84px}
.gd footer .gd-back{min-width:84px}
@media (max-width:600px){.gd{height:calc(100vh - 32px)}.gd header{flex-wrap:wrap}.gd .gd-tabs{margin-left:0;order:3;width:100%}.gd .gd-tabs button{flex:1}.gd footer{flex-wrap:wrap}.gd footer label{width:100%}.gd .gd-dots{margin-left:0;flex:1}}
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
      <figure>${!s.pic ? '' : s.pic.endsWith('.mp4') ? `<video src="${s.pic}" autoplay muted loop playsinline preload="auto"></video>` : `<img src="${s.pic}" alt="" decoding="async">`}</figure>
      <div class="gd-words" data-raw><h3>${s.title}</h3><ul>${s.lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>
      <footer><label><input type="checkbox" ${hide ? 'checked' : ''}> Don't show this again</label><span class="gd-dots" aria-label="Step ${this.at + 1} of ${this.list.length}">${this.list.map((_, i) => `<i class="${i === this.at ? 'on' : ''}"></i>`).join('')}</span>
      <button type="button" class="gd-back" ${this.at ? '' : 'disabled'}>Back</button><button type="button" class="gd-next">${last ? 'Done' : 'Next'}</button></footer>
    </div>`;
  }
}
