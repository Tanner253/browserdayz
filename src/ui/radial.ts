import { tr } from '../i18n';

// One radial menu for every wheel of the game (2026-10-24, the owner: "the UI/UX on our emote wheel ... is lacking, we
// need clean smooth animations and responsive fresh feedback"; "should have visuals and icons for the building pieces
// and also actions of the wheel"; "the bottom option for the radial wheel should always be cancel to cancel out of
// whatever action is being done"): the emote wheel on T, and the base-building piece wheel after it. Rings of wedges
// round a hub, each ring's first at the top and the rest clockwise, each with an icon over its words (one of its own, or a
// plain one); the wedge at six o'clock on the outer ring is Cancel on every wheel, put there by this class. It opens with its wedges coming out one after another, the
// wedge under the pointer is lit and stands out from the rest with a bar round the rim that turns to it, a soft tick
// says each new one, and what is chosen flashes as the wheel goes. Styles: `.radial` in hud.css.
//
//   const r = new Radial({ rings: [{ r0: 46, r1: 205, text: 126 }], per: 8, tick, chose });
//   parent.appendChild(r.el);                        its size is the CSS variable --d on r.el
//   r.set([{ id: 'wall', label: 'Wall', icon: '/assets/icons/wall.webp' }, ...]);   an icon: a URL, or a name in ICONS
//   r.open();  each frame: const pick = r.pickAt([x, y]); r.point(pick, [x, y]); r.hub(title, sub);
//   r.close(pick);                                   pick: an entry's index, Radial.CANCEL, or -1 (the hub)
// Cancel, like the hub, is nothing chosen: the caller does nothing for it (the wheel only shows it flash as it goes).

export interface RadialEntry {
  id: string;
  label: string;
  /** a picture over the label: a URL, or the name of one of `ICONS` (none given: `ICONS.item`) */
  icon?: string;
  /** kept up until stopped (drawn quieter), on now (drawn in the accent), not to be had (dimmed), or nothing there at all
   * (not drawn and not picked: a ring only partly filled, its entries kept in their places, as the building plan's) */
  mark?: 'keeps' | 'held' | 'dim' | 'gap';
}
/** a ring, of the wheel's radius of 210: from the hub out, and where its words sit */
export interface RadialRing {
  r0: number;
  r1: number;
  text: number;
}
export interface RadialOptions {
  rings: RadialRing[];
  /** wedges to a ring (the outer ring's six o'clock wedge is Cancel's) */
  per: number;
  /** more classes on the wheel (its size and place are the caller's) */
  className?: string;
  /** said whenever the pointer comes onto another wedge (a soft click) */
  tick?: () => void;
  /** said when a wedge is chosen (Cancel among them) */
  chose?: () => void;
}

/**
 * Icons drawn as strokes in a box of 24 (pictures of things come as URLs instead). Add to them for other wheels.
 * Each is the `d` of one path.
 */
export const ICONS: Record<string, string> = {
  cancel: 'M6 6l12 12M18 6L6 18',
  item: 'M12 3l9 9-9 9-9-9z',
  call: 'M4 5h16v10H9l-5 4z',
  hey: 'M4 5h16v10H9l-5 4zM12 8v3M12 13.5v.1',
  here: 'M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11zM12 10v.1',
  omw: 'M3 12h14M12 6l6 6-6 6',
  thanks: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  help: 'M12 3l10 18H2zM12 9v5M12 17.5v.1',
  friendly: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 14s1.5 2 4 2 4-2 4-2M9 9.5v.1M15 9.5v.1',
  dontshoot: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 2v4M12 18v4M2 12h4M18 12h4M4.5 4.5l15 15',
  yes: 'M5 12.5l4.5 4.5L19 7',
  no: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  follow: 'M5 7l5 5-5 5M12 7l5 5-5 5',
  wait: 'M7 3h10M7 21h10M8 3l8 9-8 9M16 3l-8 9 8 9',
  enemy: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 2v6M12 16v6M2 12h6M16 12h6',
  go: 'M6 13l6-6 6 6M6 19l6-6 6 6',
  down: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  behind: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-4',
  medic: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  loot: 'M3 8l9-4 9 4v9l-9 4-9-4zM3 8l9 4 9-4M12 12v9',
  sorry: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 16.5s1.5-2 4-2 4 2 4 2M9 9.5v.1M15 9.5v.1',
  dance: 'M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM9 18V5l11-2v12M20 15a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  gesture: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z',
  surrender: 'M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 9v7M12 16l-3 5M12 16l3 5M12 11L7 6M12 11l5-5',
  sit: 'M9 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 8v6h6l1 6M9 11l5-1M4 21h16',
};

/** how far a lit wedge stands out from the others, of the radius of 210 */
const LIFT = 7;
/** how long the wheel takes to go once something is chosen (its flash), ms; hud.css says the same */
const GONE = 300;
/** an icon's size and the gap under it, of the radius of 210; a picture's, which is bigger, on a soft disc */
const ICON = 22, PIC = 32, UNDER = 3;

const pt = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;

/**
 * How far round a ring its first wedge is, in wedges: none with an even number (one at the top, one at the bottom), half
 * a wedge with an odd one, so that one wedge still sits at six o'clock for Cancel.
 */
const offOf = (per: number) => (per % 2 ? 0.5 : 0);

/** each wedge in turn round the wheel: its ring, its place in the ring, and the entry in it (Radial.CANCEL: the Cancel wedge, six o'clock on the outer ring) */
function layout(n: number, rings: RadialRing[], per: number): { ring: number; k: number; entry: number }[] {
  const out: { ring: number; k: number; entry: number }[] = [];
  let next = 0;
  for (let ring = 0; ring < rings.length; ring++) {
    for (let k = 0; k < per; k++) {
      if (ring === rings.length - 1 && k === Math.floor(per / 2)) out.push({ ring, k, entry: Radial.CANCEL });
      else if (next < n) out.push({ ring, k, entry: next++ });
    }
  }
  return out;
}

/** the wheel's picture: every wedge with its icon and words, the bar round the rim, all of it in the wheel's own measure (-220..220) */
export function radialSvg(entries: RadialEntry[], rings: RadialRing[], per: number): string {
  const wedges = layout(entries.length, rings, per).map(({ ring, k, entry }) => {
    const given: RadialEntry = entry === Radial.CANCEL ? { id: 'cancel', label: 'Cancel', icon: 'cancel' } : entries[entry];
    if (given.mark === 'gap') return `<g class="gap" data-slot="${entry}" data-k="${k}"></g>`;
    const e = { ...given, icon: given.icon ?? 'item' };
    const { r0, r1, text: tr } = rings[ring];
    const a = ((k + offOf(per)) / per) * Math.PI * 2, half = Math.PI / per - 0.022 * (58 / r0);
    const d = `M${pt(r0, a - half)}L${pt(r1, a - half)}A${r1} ${r1} 0 0 1 ${pt(r1, a + half)}L${pt(r0, a + half)}A${r0} ${r0} 0 0 0 ${pt(r0, a - half)}Z`;
    const [x, y] = pt(tr, a).split(' ').map(Number);
    // (two words go on two lines, and a line too long for its wedge is set smaller: by the wedge's width where its words sit)
    const words = e.label.split(' ');
    const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && e.label.length > 7 ? words : [e.label];
    const room = ((Math.PI * 2 * tr) / per) * 0.82;
    // (the icon over the words, the two of them standing about the middle of the wedge)
    const glyph = !!ICONS[e.icon], size = glyph ? ICON : PIC;
    const lh = 15, tall = size + UNDER + lines.length * lh, top = y - tall / 2;
    const ty = top + size + UNDER + lh / 2;
    const text = lines.map((l, j) => {
      const size = Math.max(10, Math.min(14, room / (l.length * 0.68)));
      return `<text x="${x.toFixed(1)}" y="${(ty + j * lh).toFixed(1)}"${size < 14 ? ` style="font-size:${size.toFixed(1)}px"` : ''}>${l}</text>`;
    }).join('');
    const ix = x - size / 2, iy = top;
    const icon = glyph
      ? `<path class="radial-ico" transform="translate(${ix.toFixed(1)} ${iy.toFixed(1)}) scale(${(ICON / 24).toFixed(3)})" d="${ICONS[e.icon]}"/>`
      : `<circle class="radial-pic" cx="${x.toFixed(1)}" cy="${(iy + size / 2).toFixed(1)}" r="${(size / 2 + 2).toFixed(1)}"/><image href="${e.icon}" x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" width="${size}" height="${size}"/>`;
    // (each knows which way is out from the hub, to stand out that way when it is lit, and its turn coming out)
    const style = `--i:${ring * per + k};--ox:${(Math.sin(a) * LIFT).toFixed(2)}px;--oy:${(-Math.cos(a) * LIFT).toFixed(2)}px`;
    const cls = entry === Radial.CANCEL ? 'cancel' : (e.mark ?? '');
    return `<g class="${cls}" data-slot="${entry === Radial.CANCEL ? 'cancel' : entry}" data-k="${k}" style="${style}"><path class="radial-wedge" d="${d}"/>${icon}${text}</g>`;
  });
  // (the bar round the rim, drawn at the top over one wedge's width and turned to whichever is lit; over the wedges and
  // clear of a lit one standing out, so that nothing hides it)
  const R = rings[rings.length - 1].r1 + 16, w = Math.PI / per - 0.05;
  const bar = `<path class="radial-bar" d="M${pt(R, -w)}A${R} ${R} 0 0 1 ${pt(R, w)}"/>`;
  return `<svg viewBox="-220 -220 440 440" aria-hidden="true">${wedges.join('')}${bar}</svg>`;
}

export class Radial {
  /** the pick that is the Cancel wedge */
  static readonly CANCEL = -2;
  readonly el: HTMLDivElement;
  private wedges: SVGGElement[] = [];
  private cancelWedge: SVGGElement | null = null;
  private bar: SVGPathElement | null = null;
  private dot: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private count = 0;
  /** the entries that are nothing there (`gap`) */
  private gaps = new Set<number>();
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

  /** what is on it: ring after ring, each ring's first at the top and the rest clockwise, round Cancel */
  set(entries: RadialEntry[]) {
    const box = this.el.querySelector('.radial-svg') as HTMLElement;
    box.innerHTML = radialSvg(entries, this.o.rings, this.o.per);
    this.count = entries.length;
    this.gaps = new Set(entries.flatMap((e, i) => (e.mark === 'gap' ? [i] : [])));
    this.wedges = [];
    for (const g of box.querySelectorAll<SVGGElement>('g[data-slot]')) {
      if (g.dataset.slot === 'cancel') this.cancelWedge = g;
      else this.wedges[Number(g.dataset.slot)] = g;
    }
    this.bar = box.querySelector('.radial-bar');
    this.lit = -1;
  }

  /** a wedge's mark changed (`RadialEntry.mark`) without the whole of it being made again */
  mark(i: number, mark: RadialEntry['mark'] | null) {
    const g = this.wedges[i];
    if (!g) return;
    for (const m of ['keeps', 'held', 'dim']) g.classList.toggle(m, m === mark);
  }

  /**
   * Which wedge a pointer is on: an entry's index, `Radial.CANCEL`, or -1 (the hub, or a ring with nothing there).
   * @param at where it is from the middle, each way -1..1 of the wheel's outer edge (longer is the outer edge)
   */
  pickAt(at: [number, number]): number {
    const R = this.o.rings, rmax = R[R.length - 1].r1, r = Math.min(1, Math.hypot(at[0], at[1])) * rmax;
    if (r < R[0].r0) return -1;
    // (the ring: the last whose inside edge, or the middle of the gap before it, the pointer is past)
    let ring = 0;
    for (let i = 1; i < R.length; i++) if (r >= (R[i - 1].r1 + R[i].r0) / 2) ring = i;
    const per = this.o.per, k = ((Math.round((Math.atan2(at[0], -at[1]) / (Math.PI * 2)) * per - offOf(per)) % per) + per) % per;
    const wedge = layout(this.count, R, per).find((w) => w.ring === ring && w.k === k);
    return wedge && !this.gaps.has(wedge.entry) ? wedge.entry : -1;
  }

  open() {
    if (this.shown) return;
    clearTimeout(this.going);
    this.shown = true;
    this.lit = -1;
    for (const g of [...this.wedges, this.cancelWedge]) g?.classList.remove('on', 'chosen');
    this.el.classList.remove('closing', 'picked');
    // (on the next frame, so that it comes out from shut every time it is opened)
    void this.el.offsetWidth;
    this.el.classList.add('show');
  }

  private wedge(pick: number) {
    return pick === Radial.CANCEL ? this.cancelWedge : (this.wedges[pick] ?? null);
  }

  /**
   * Where the pointer is.
   * @param pick the wedge it is on (`pickAt`)
   * @param at where it is from the middle, each way -1..1
   */
  point(pick: number, at: [number, number]) {
    if (!this.shown) return;
    this.dot.style.setProperty('--x', at[0].toFixed(3));
    this.dot.style.setProperty('--y', at[1].toFixed(3));
    if (pick === this.lit) return;
    this.wedge(this.lit)?.classList.remove('on');
    this.lit = pick;
    const g = this.wedge(pick);
    this.el.classList.toggle('picked', !!g);
    if (!g) return;
    g.classList.add('on');
    // (the bar turns the short way round to it)
    const want = ((Number(g.dataset.k) + offOf(this.o.per)) / this.o.per) * 360;
    this.turn += ((((want - this.turn) % 360) + 540) % 360) - 180;
    this.bar?.style.setProperty('--turn', `${this.turn.toFixed(1)}deg`);
    this.el.classList.toggle('on-cancel', pick === Radial.CANCEL);
    this.o.tick?.();
  }

  /** the words in the hub, and the line under them */
  hub(title: string, sub: string) {
    const said = tr(title);
    if (this.title.textContent !== said) {
      this.title.textContent = said;
      // (a new word comes up, rather than being swapped in)
      this.title.classList.remove('pop');
      void this.title.offsetWidth;
      this.title.classList.add('pop');
    }
    if (this.sub.textContent !== tr(sub)) this.sub.textContent = tr(sub);
  }

  /** put away: with a wedge chosen (an entry, or Cancel), that one flashes as the wheel goes */
  close(chosen = -1) {
    if (!this.shown) return;
    this.shown = false;
    const g = this.wedge(chosen);
    if (g) {
      g.classList.add('on', 'chosen');
      this.o.chose?.();
    }
    this.el.classList.add('closing');
    this.el.classList.remove('show');
    clearTimeout(this.going);
    this.going = window.setTimeout(() => this.el.classList.remove('closing', 'picked', 'on-cancel'), g ? GONE : 160);
  }
}
