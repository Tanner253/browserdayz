// The survivor's state, drawn: a row of symbols in the corner of the game, and the same symbols with a line of
// words each in the inventory. What each is to look like is reckoned in src/ui/status.ts; this is the drawing, and
// the keeping of the page in step with it. The looks themselves (the colours, the blink, the sizes) are at the end
// of src/ui/hud.css.
//
// The symbols are drawn here and are this game's own: a cross for health, a drop for blood, an apple for food and a
// flask for water, each a plain outline that fills from the bottom as far as there is any of it left, so that the
// symbol is the read-out and nothing stands beside it. One square of 32 for every one of them, one weight of line.

import { Pace, STATS, reading, type BadgeId, type BadgeView, type Body, type Stat, type StatView } from './status';

interface Glyph {
  /** the outline, which fills */
  d: string;
  /** a detail inside it (a highlight, the line under a cap): light where the symbol is empty, dark where it is full */
  mark?: string;
  /** what is drawn beside the outline and never fills (the apple's stalk and leaf) */
  more?: string;
  /** where what fills begins and ends, down the square */
  top: number;
  bottom: number;
}

const SYMBOLS: Record<Stat, Glyph> = {
  health: { d: 'M11.5 4.5h9v7h7v9h-7v7h-9v-7h-7v-9h7z', top: 4.5, bottom: 27.5 },
  blood: { d: 'M16 3.5C12.5 9 7.5 14.5 7.5 20a8.5 8.5 0 0 0 17 0C24.5 14.5 19.5 9 16 3.5z', mark: 'M11.7 20.4a4.4 4.4 0 0 0 3.7 4.3', top: 3.5, bottom: 28.5 },
  food: {
    d: 'M16 11C14.2 9.4 10.6 9 8.2 11.2C5.2 14 5.6 19.2 8 23.2C9.8 26.4 12.6 28.6 16 26.9C19.4 28.6 22.2 26.4 24 23.2C26.4 19.2 26.8 14 23.8 11.2C21.4 9 17.8 9.4 16 11z',
    mark: 'M10.3 14.2c-1 1.5-1.2 3.4-.6 5.2',
    more: 'M16 10.6C16 8 16.7 6 18.2 4.6M18.4 4.5c2.3-1.5 4.9-1 6 .9c-2.1 1.6-4.7 1.2-6-.9z',
    top: 9.6,
    bottom: 28,
  },
  water: { d: 'M12.5 3.5h7v6C22.4 10.8 24 13.6 24 17v7.5a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V17C8 13.6 9.6 10.8 12.5 9.5z', mark: 'M12.5 7h7', top: 3.5, bottom: 28.5 },
};

/** a drop of what a wound lets go, hung from a point */
const drip = (x: number, y: number) => `M${x} ${y}c-1.9 3-3.2 4.8-3.2 6.7a3.2 3.2 0 0 0 6.4 0c0-1.9-1.3-3.7-3.2-6.7z`;
/** half of a bone, from its knuckle to where it broke */
const BONE = 'M2.86-2.1A2.9 2.9 0 1 0-1.28 0A2.9 2.9 0 1 0 2.86 2.1L10.4 2.1L9.2.7L11.4-.5L10 -2.1Z';

/** the badges: each solid, in its own colour, with a dark edge to stand off whatever is behind it */
const BADGES: Record<BadgeId, string> = {
  // a gash, and what runs from it: one drop for a light wound, two for a heavy one, three for worse
  bleed: `<path class="st-solid" d="M4.5 9.3Q16 2.2 27.5 9.3Q16 13.2 4.5 9.3z"/><path class="st-solid st-d1" d="${drip(16, 15.6)}"/><path class="st-solid st-d2" d="${drip(8.4, 13.4)}"/><path class="st-solid st-d2" d="${drip(23.6, 13.4)}"/>`,
  // a bone in two, and the two not in line
  leg: `<path class="st-solid" transform="translate(6.6 25.4) rotate(-45)" d="${BONE}"/><path class="st-solid" transform="translate(25.8 7) rotate(156)" d="${BONE}"/>`,
  // a mask, its two eyepieces and the round filter under them; and a stroke through it when there is none on the face
  gas: `<path class="st-solid" fill-rule="evenodd" d="M16 3.6C9.8 3.6 6 7.8 6 13.4C6 16.6 7.4 19.4 9.8 21H22.2C24.6 19.4 26 16.6 26 13.4C26 7.8 22.2 3.6 16 3.6zM14.8 12.4a3.2 3.2 0 1 0-6.4 0a3.2 3.2 0 1 0 6.4 0zM23.6 12.4a3.2 3.2 0 1 0-6.4 0a3.2 3.2 0 1 0 6.4 0z"/><circle class="st-solid" cx="16" cy="23" r="5.4"/><path class="st-cut" d="M13.2 21.6h5.6M12.8 23.8h6.4M13.8 26h4.4"/><path class="st-slash st-under" d="M5 27.5L27 4.5"/><path class="st-slash" d="M5 27.5L27 4.5"/>`,
  // a flame of two tongues: solid while it mends, and only its outline while it does no more than warm
  fire: `<path class="st-solid" d="M17 2.5C18 7.5 24 11 24 18.6a8 8 0 0 1-16 0C8 14.6 9.4 11.4 10.6 8.4C11.4 10.6 12.4 12.4 13.9 13.6C13.6 9.6 14.8 5.6 17 2.5z"/><path class="st-cut st-heart" d="M16 24.6c-1.7 0-2.9-1.2-2.9-2.8c0-1.6 1.2-2.6 1.9-4.2c1.9 1.3 3.9 2.7 3.9 4.5c0 1.4-1.2 2.5-2.9 2.5z"/>`,
};

let made = 0;

/** a symbol of the four, with a level that can be moved: the outline, what fills it, and its detail twice (light under what fills, dark over it) */
function symbolSvg(stat: Stat, clip: string): string {
  const s = SYMBOLS[stat];
  const mark = (cls: string, cut = '') => (s.mark ? `<path class="${cls}" d="${s.mark}"${cut}/>` : '');
  const cut = ` clip-path="url(#${clip})"`;
  return (
    `<svg class="st-ico" viewBox="0 0 32 32" aria-hidden="true"><clipPath id="${clip}"><rect x="0" y="0" width="32" height="32"/></clipPath>` +
    `<path class="st-back" d="${s.d}"/>${s.more ? `<path class="st-under" d="${s.more}"/><path class="st-line st-more" d="${s.more}"/>` : ''}` +
    `${mark('st-mark')}<path class="st-fill" d="${s.d}"${cut}/>${mark('st-mark st-dark', cut)}<path class="st-line" d="${s.d}"/></svg>`
  );
}

const badgeSvg = (id: BadgeId) => `<svg class="st-ico" viewBox="0 0 32 32" aria-hidden="true">${BADGES[id]}</svg>`;

/** a symbol by itself, whole, for anywhere else on the page that wants one (the line over the hotbar that says what to do about a wound) */
export const symbol = (id: Stat | BadgeId) => (id in SYMBOLS ? symbolSvg(id as Stat, `st-c${++made}`) : badgeSvg(id as BadgeId));

/** the arrows beside a symbol: so many, up or down, one over the other about its middle */
function arrowsSvg(n: number): string {
  const k = Math.abs(n), up = n > 0;
  let out = '';
  for (let i = 0; i < k; i++) {
    const y = 16 - (k * 7 - 3) / 2 + i * 7;
    const d = up ? `M1.5 ${y + 4}L5 ${y}L8.5 ${y + 4}` : `M1.5 ${y}L5 ${y + 4}L8.5 ${y}`;
    // (each lights a moment after the one before it, the way it points)
    out += `<path class="st-under" d="${d}"/><path class="st-arrow" style="--i:${up ? k - 1 - i : i}" d="${d}"/>`;
  }
  return out;
}

/** one of the four on the page, kept in step with what it is to show: nothing of the page is touched that has not changed */
class StatMark {
  readonly el = document.createElement('div');
  private level: SVGRectElement;
  private arrows: Element;
  private fig: HTMLElement;
  private words: HTMLElement | null;
  private was = { shown: '', step: '', y: '', arrows: 0, figure: '', line: '' };

  constructor(private stat: Stat, words: boolean) {
    this.el.className = 'st-stat';
    this.el.dataset.stat = stat;
    this.el.innerHTML = `${symbolSvg(stat, `st-c${++made}`)}<svg class="st-arrows" viewBox="0 0 10 32" aria-hidden="true"></svg><b class="st-fig"></b>${words ? '<p></p>' : ''}`;
    this.level = this.el.querySelector('rect') as SVGRectElement;
    this.arrows = this.el.querySelector('.st-arrows') as Element;
    this.fig = this.el.querySelector('.st-fig') as HTMLElement;
    this.words = this.el.querySelector('p');
  }

  apply(v: StatView) {
    const w = this.was, s = SYMBOLS[this.stat];
    if (w.shown !== String(v.shown)) {
      w.shown = String(v.shown);
      this.el.classList.toggle('off', !v.shown);
    }
    if (!v.shown) return;
    if (w.step !== v.step) this.el.dataset.step = w.step = v.step;
    const y = (s.bottom - (s.bottom - s.top) * v.fill).toFixed(1);
    if (w.y !== y) this.level.setAttribute('y', (w.y = y));
    if (w.arrows !== v.arrows) {
      w.arrows = v.arrows;
      this.arrows.innerHTML = arrowsSvg(v.arrows);
      this.el.dataset.going = v.arrows > 0 ? 'up' : v.arrows < 0 ? 'down' : '';
    }
    if (w.figure !== v.figure) this.fig.textContent = w.figure = v.figure;
    if (this.words && w.line !== v.line) this.words.textContent = w.line = v.line;
  }
}

/** and one of the badges: there only while what it stands for is so */
class BadgeMark {
  readonly el = document.createElement('div');
  private fig: HTMLElement;
  private words: HTMLElement | null;
  private was = '';

  constructor(readonly id: BadgeId, words: boolean) {
    this.el.className = 'st-badge off';
    this.el.dataset.id = id;
    this.el.innerHTML = `${badgeSvg(id)}<b class="st-fig"></b>${words ? '<p></p>' : ''}`;
    this.fig = this.el.querySelector('.st-fig') as HTMLElement;
    this.words = this.el.querySelector('p');
  }

  apply(v: BadgeView | undefined) {
    const key = v ? `${v.tone}|${v.blink}|${v.level}|${v.figure}|${v.line}` : '';
    if (key === this.was) return;
    this.was = key;
    this.el.classList.toggle('off', !v);
    if (!v) return;
    this.el.dataset.tone = v.tone;
    this.el.dataset.lv = String(v.level);
    this.el.classList.toggle('blink', v.blink);
    this.fig.textContent = v.figure;
    if (this.words) this.words.textContent = v.line;
  }
}

const BADGE_ORDER: BadgeId[] = ['fire', 'gas', 'leg', 'bleed'];
const STORE = 'zona.figures';

/** whether the numbers are wanted beside the symbols (Settings: off until somebody asks for them), as this browser has it kept */
export function figuresWanted(): boolean {
  try {
    return localStorage.getItem(STORE) === '1';
  } catch {
    return false;
  }
}

export function wantFigures(on: boolean) {
  try {
    localStorage.setItem(STORE, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

/**
 * The two places a survivor's state is drawn, kept as one: the row in the corner of the game (made in `host`), and
 * `panel`, the same with a line of words to each, which the inventory puts in its Status column whenever it is
 * drawn. Both are brought up to date ten times a second, which is as fast as anything they show can change its look.
 */
export class StatusView {
  readonly panel = document.createElement('div');
  private pace: Record<Stat, Pace> = { health: new Pace(), blood: new Pace(), food: new Pace(), water: new Pace() };
  private drawn: { stats: StatMark[]; badges: BadgeMark[] }[] = [];
  private at = -1e9;
  private dead = false;

  constructor(private host: HTMLElement) {
    this.panel.className = 'st-panel';
    for (const [el, words] of [[host, false], [this.panel, true]] as [HTMLElement, boolean][]) {
      const badges = BADGE_ORDER.map((id) => new BadgeMark(id, words)), stats = STATS.map((s) => new StatMark(s, words));
      // (in the corner the badges stand to the left of the four; in the inventory, under them)
      el.append(...(words ? [...stats, ...badges] : [...badges, ...stats]).map((m) => m.el));
      this.drawn.push({ stats, badges });
    }
    this.figures = figuresWanted();
  }

  /** the numbers as well as the symbols */
  set figures(on: boolean) {
    this.host.classList.toggle('figs', on);
    this.panel.classList.toggle('figs', on);
  }

  /**
   * @param dead nothing is shown of the dead, and what was changing when they died is forgotten
   * @param now milliseconds, by the page's clock
   */
  update(body: Body, dead: boolean, now = performance.now()) {
    if (dead !== this.dead) {
      this.dead = dead;
      this.host.classList.toggle('gone', dead);
      for (const p of Object.values(this.pace)) p.clear();
      this.at = -1e9;
    }
    if (dead || now - this.at < 100) return;
    this.at = now;
    const t = now / 1000, p = this.pace;
    const r = reading(body, { health: p.health.note(body.health, t), blood: p.blood.note(body.blood, t), food: p.food.note(body.energy, t), water: p.water.note(body.water, t) });
    for (const d of this.drawn) {
      d.stats.forEach((m, i) => m.apply(r.stats[i]));
      for (const m of d.badges) m.apply(r.badges.find((b) => b.id === m.id));
    }
  }
}
