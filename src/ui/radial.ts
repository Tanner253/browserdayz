// One radial menu for every wheel of the game (2026-10-24, the owner: "the UI/UX on our emote wheel ... is lacking, we
// need clean smooth animations and responsive fresh feedback"): the emote wheel on T, and the base-building piece wheel
// after it. Rings of wedges round a hub, each ring's first at the top and the rest clockwise. It opens with its wedges
// coming out one after another, the wedge under the pointer is lit and stands out from the rest with a bar round the
// rim that turns to it, a soft tick says each new one, and what is chosen flashes as the wheel goes. Styles: `.radial`
// in hud.css. Pointing is the caller's: it says which wedge and where the pointer is (`point`).
//
//   const r = new Radial({ rings: [{ r0: 46, r1: 122, text: 84 }], per: 8, tick: () => audio.click(2400, 0.06, 0.01) });
//   parent.appendChild(r.el); r.set(entries); r.open(); r.point(3, [0.4, -0.2]); r.close(3);

export interface RadialEntry {
  id: string;
  label: string;
  /** a picture over the label (a URL) */
  icon?: string;
  /** kept up until stopped (drawn quieter), on now (drawn in the accent), or not to be had (dimmed) */
  mark?: 'keeps' | 'held' | 'dim';
}
/** a ring, of the wheel's radius of 210: from the hub out, and where its words sit */
export interface RadialRing {
  r0: number;
  r1: number;
  text: number;
}
export interface RadialOptions {
  rings: RadialRing[];
  /** wedges to a ring */
  per: number;
  /** more classes on the wheel (its size and place are the caller's) */
  className?: string;
  /** said whenever the pointer comes onto another wedge (a soft click) */
  tick?: () => void;
  /** said when a wedge is chosen */
  chose?: () => void;
}

/** how far a lit wedge stands out from the others, of the radius of 210 */
const LIFT = 7;
/** how long the wheel takes to go once something is chosen (its flash), ms; hud.css says the same */
const GONE = 300;

const pt = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;

/** the wheel's picture: every wedge with its words, the bar round the rim, all of it in the wheel's own measure (-210..210) */
export function radialSvg(entries: RadialEntry[], rings: RadialRing[], per: number): string {
  const wedges = entries.map((e, i) => {
    const { r0, r1, text: tr } = rings[Math.min(rings.length - 1, Math.floor(i / per))];
    const a = ((i % per) / per) * Math.PI * 2, half = Math.PI / per - 0.022 * (58 / r0);
    const d = `M${pt(r0, a - half)}L${pt(r1, a - half)}A${r1} ${r1} 0 0 1 ${pt(r1, a + half)}L${pt(r0, a + half)}A${r0} ${r0} 0 0 0 ${pt(r0, a - half)}Z`;
    const [x, y] = pt(tr, a).split(' ').map(Number);
    // (two words go on two lines, and a line too long for its wedge is set smaller: by the wedge's width where its words sit)
    const words = e.label.split(' ');
    const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && e.label.length > 7 ? words : [e.label];
    const room = ((Math.PI * 2 * tr) / per) * 0.82, ty = e.icon ? y + 14 : y;
    const text = lines.map((l, k) => {
      const size = Math.max(10, Math.min(15, room / (l.length * 0.68)));
      return `<text x="${x.toFixed(1)}" y="${(ty + (k - (lines.length - 1) / 2) * 17).toFixed(1)}"${size < 15 ? ` style="font-size:${size.toFixed(1)}px"` : ''}>${l}</text>`;
    }).join('');
    const icon = e.icon ? `<image href="${e.icon}" x="${(x - 16).toFixed(1)}" y="${(y - 30).toFixed(1)}" width="32" height="32"/>` : '';
    // (each knows which way is out from the hub, to stand out that way when it is lit, and its turn coming out)
    const style = `--i:${i};--ox:${(Math.sin(a) * LIFT).toFixed(2)}px;--oy:${(-Math.cos(a) * LIFT).toFixed(2)}px`;
    return `<g class="${e.mark ?? ''}" data-slot="${i}" style="${style}"><path d="${d}"/>${icon}${text}</g>`;
  });
  // (the bar round the rim, drawn at the top over one wedge's width and turned to whichever is lit; over the wedges and
  // clear of a lit one standing out, so that nothing hides it)
  const R = rings[rings.length - 1].r1 + 16, w = Math.PI / per - 0.05;
  const bar = `<path class="radial-bar" d="M${pt(R, -w)}A${R} ${R} 0 0 1 ${pt(R, w)}"/>`;
  return `<svg viewBox="-220 -220 440 440" aria-hidden="true">${wedges.join('')}${bar}</svg>`;
}

export class Radial {
  readonly el: HTMLDivElement;
  private wedges: SVGGElement[] = [];
  private bar: SVGPathElement | null = null;
  private dot: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private lit = -1;
  /** the bar's turn, in degrees, carried on past a whole turn so that it always goes the short way round */
  private turn = 0;
  private shown = false;
  private going = 0;

  constructor(private o: RadialOptions) {
    this.el = document.createElement('div');
    this.el.className = `radial${o.className ? ` ${o.className}` : ''}`;
    this.el.innerHTML = '<div class="radial-svg"></div><i class="radial-dot"></i><div class="radial-hub"><b></b><span></span></div>';
    this.dot = this.el.querySelector('.radial-dot') as HTMLElement;
    this.title = this.el.querySelector('.radial-hub b') as HTMLElement;
    this.sub = this.el.querySelector('.radial-hub span') as HTMLElement;
  }

  get isOpen() {
    return this.shown;
  }

  /** what is on it: ring after ring, each ring's first at the top and the rest clockwise */
  set(entries: RadialEntry[]) {
    const box = this.el.querySelector('.radial-svg') as HTMLElement;
    box.innerHTML = radialSvg(entries, this.o.rings, this.o.per);
    this.wedges = [...box.querySelectorAll<SVGGElement>('g[data-slot]')];
    this.bar = box.querySelector('.radial-bar');
    this.lit = -1;
  }

  /** a wedge's mark changed (`RadialEntry.mark`) without the whole of it being made again */
  mark(i: number, mark: RadialEntry['mark'] | null) {
    const g = this.wedges[i];
    if (!g) return;
    for (const m of ['keeps', 'held', 'dim']) g.classList.toggle(m, m === mark);
  }

  open() {
    if (this.shown) return;
    clearTimeout(this.going);
    this.shown = true;
    this.lit = -1;
    for (const g of this.wedges) g.classList.remove('on', 'chosen');
    this.el.classList.remove('closing');
    this.el.classList.toggle('picked', false);
    // (on the next frame, so that it comes out from shut every time it is opened)
    void this.el.offsetWidth;
    this.el.classList.add('show');
  }

  /**
   * Where the pointer is.
   * @param pick the wedge it is on (-1: the hub)
   * @param at where it is from the middle, each way -1..1
   */
  point(pick: number, at: [number, number]) {
    if (!this.shown) return;
    this.dot.style.setProperty('--x', at[0].toFixed(3));
    this.dot.style.setProperty('--y', at[1].toFixed(3));
    if (pick === this.lit) return;
    this.wedges[this.lit]?.classList.remove('on');
    this.lit = pick;
    const g = this.wedges[pick];
    this.el.classList.toggle('picked', !!g);
    if (!g) return;
    g.classList.add('on');
    // (the bar turns the short way round to it)
    const want = ((pick % this.o.per) / this.o.per) * 360;
    this.turn += ((((want - this.turn) % 360) + 540) % 360) - 180;
    this.bar?.style.setProperty('--turn', `${this.turn.toFixed(1)}deg`);
    this.o.tick?.();
  }

  /** the words in the hub, and the line under them */
  hub(title: string, sub: string) {
    if (this.title.textContent !== title) {
      this.title.textContent = title;
      // (a new word comes up, rather than being swapped in)
      this.title.classList.remove('pop');
      void this.title.offsetWidth;
      this.title.classList.add('pop');
    }
    if (this.sub.textContent !== sub) this.sub.textContent = sub;
  }

  /** put away: with a wedge chosen (not -1), that one flashes as the wheel goes */
  close(chosen = -1) {
    if (!this.shown) return;
    this.shown = false;
    const g = this.wedges[chosen];
    if (g) {
      g.classList.add('on', 'chosen');
      this.o.chose?.();
    }
    this.el.classList.add('closing');
    this.el.classList.remove('show');
    clearTimeout(this.going);
    this.going = window.setTimeout(() => this.el.classList.remove('closing', 'picked'), g ? GONE : 160);
  }
}
