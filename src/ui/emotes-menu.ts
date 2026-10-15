// Emotes: the eight slots of the wheel (hold T) set by the player, each thing there is to call out or do watched
// first on the survivor (the owner, 2026-10-14: "we need to allow the user to assign which emote to which radial key
// ... we need an emote preview for the user to watch"; "lets make sure the ui and emote wheel interaction and edit and
// everything is super intuitive"). Opened in the game, from the wheel (the owner, 2026-10-15: "emotes should be managed
// in game not the main menu"; "edit button on the T wheel"): a sheet of its own over the game, the mouse free. The
// wheel is the one held up in the game (wheelSvg): a wedge is clicked to choose it; anything in the list is played by
// the survivor as soon as the pointer is on it, and a click puts it in the wedge chosen.
//
// The survivor is the inventory's (src/game/doll.ts), a second of it: drawn by the game's renderer into a hole cut in
// this sheet, where the sheet's veil is made again behind it (see DollBox).
import { EMOTE, EMOTES, WHEEL_DEFAULT, type Emote } from '../sim/emotes';
import type { DollBox } from '../game/doll';
import { setWheelSlots, wheelSlots, wheelSvg } from './wheel-slots';

const KINDS: [Emote['kind'], string][] = [['call', 'Calls'], ['dance', 'Dances'], ['gesture', 'Gestures'], ['pose', 'Poses']];

export class EmotesMenu {
  /** over the game: the sheet, and the dark round it */
  readonly root: HTMLElement;
  readonly el: HTMLElement;
  private on = false;
  /** ✕ clicked: the game puts it away and takes the mouse back */
  onClose?: () => void;
  private slot = 0;
  private kind: Emote['kind'] = 'call';
  /** what is in the slot chosen, or was just put there (see `doing` for what the survivor is doing) */
  showing: string;
  private hovered: string | null = null;
  /** a call picked: its words said (the game's own voice) */
  onCall?: (id: string) => void;
  /** the survivor shown, turned by a drag across it (src/game/doll.ts) */
  figure: { grab(): void; turn(by: number): void; drop(): void } | null = null;
  private fig: HTMLElement;
  private sheet: HTMLElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'em-over';
    this.root.innerHTML = `<div class="em-sheet"><div class="em-head"><h2>Emotes</h2><button type="button" class="em-close" aria-label="Close">✕</button></div></div>`;
    this.sheet = this.root.querySelector('.em-sheet') as HTMLElement;
    this.root.querySelector('.em-close')!.addEventListener('click', () => this.onClose?.());
    this.el = document.createElement('div');
    this.el.className = 'pane-emotes';
    this.el.innerHTML = `
      <ol class="em-steps"><li><b>1</b>Choose a slot on your wheel</li><li><b>2</b>Point at an emote to watch it, click to put it in</li></ol>
      <div class="em-top">
        <div class="em-wheel"><div class="em-svg"></div><div class="em-mid"><small>Slot</small><b></b></div></div>
        <div class="em-preview"><div class="em-fig"></div><div class="em-cap"><b></b><span></span></div><i class="em-turn">drag to turn</i><i class="em-saved" aria-live="polite"></i></div>
      </div>
      <div class="em-lib">
        <div class="em-tabs">${KINDS.map(([k, label]) => `<button type="button" data-kind="${k}">${label}</button>`).join('')}</div>
        <div class="em-items"></div>
      </div>
      <p class="em-hint">Hold <b>T</b>, move the mouse toward a slot, let go. A tap of T says the last call again. <button type="button" class="em-reset">Back to the first eight</button></p>`;
    this.sheet.append(this.el);
    this.fig = this.el.querySelector('.em-fig') as HTMLElement;
    this.showing = wheelSlots()[0];
    // turned by a drag, as the inventory's is
    let x = 0;
    this.fig.addEventListener('pointerdown', (e) => {
      x = e.clientX;
      this.fig.setPointerCapture(e.pointerId);
      this.figure?.grab();
    });
    this.fig.addEventListener('pointermove', (e) => {
      if (!this.fig.hasPointerCapture(e.pointerId)) return;
      this.figure?.turn(e.clientX - x);
      x = e.clientX;
    });
    const drop = () => this.figure?.drop();
    this.fig.addEventListener('pointerup', drop);
    this.fig.addEventListener('pointercancel', drop);
    // the pointer on something in the list: the survivor does it at once, and stops when the pointer leaves the list
    const items = this.el.querySelector('.em-items') as HTMLElement;
    items.addEventListener('pointerover', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('.em-item')?.dataset.id;
      if (id && id !== this.hovered) this.preview(id);
    });
    items.addEventListener('pointerleave', () => this.preview(null));
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const slot = (t as Element).closest<SVGGElement>('.em-svg g')?.dataset.slot;
      if (slot !== undefined) {
        this.slot = Number(slot);
        this.show(wheelSlots()[this.slot]);
        return;
      }
      const kind = t.closest<HTMLElement>('[data-kind]')?.dataset.kind as Emote['kind'] | undefined;
      if (kind) {
        this.kind = kind;
        this.render();
        return;
      }
      const id = t.closest<HTMLElement>('.em-item')?.dataset.id;
      if (id) {
        const slots = wheelSlots();
        slots[this.slot] = id;
        setWheelSlots(slots);
        this.show(id);
        this.saved(`${EMOTE[id]?.label ?? id} is in slot ${this.slot + 1}`);
        return;
      }
      if (t.closest('.em-reset')) {
        setWheelSlots([...WHEEL_DEFAULT]);
        this.show(WHEEL_DEFAULT[this.slot]);
        this.saved('The first eight are back');
      }
    });
    this.render();
  }

  /** put up over the game, on the slot just used if there is one, or taken away */
  toggle(on: boolean) {
    this.on = on;
    this.root.classList.toggle('show', on);
    if (on) this.render();
    else this.preview(null);
  }

  /** what is in the slot chosen, or what was just put there: shown, its list opened, a call heard */
  private show(id: string) {
    this.showing = id;
    this.hovered = null;
    const e = EMOTE[id];
    if (e) this.kind = e.kind;
    if (e?.say) this.onCall?.(id);
    this.render();
  }

  /** the pointer on one in the list (null: off the list): the survivor does that one meanwhile */
  private preview(id: string | null) {
    this.hovered = id;
    this.caption();
  }

  /** what the survivor is doing now */
  get doing() {
    return this.hovered ?? this.showing;
  }

  /** said for a moment over the survivor: what was saved; and the wedge it went in flashes */
  private saved(text: string) {
    const el = this.el.querySelector('.em-saved') as HTMLElement;
    el.textContent = `\u2713 ${text}`;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    this.el.querySelector(`.em-svg g[data-slot="${this.slot}"]`)?.classList.add('flash');
  }

  private render() {
    const slots = wheelSlots();
    // the wheel as it is held up in the game, the chosen wedge lit
    const svg = this.el.querySelector('.em-svg') as HTMLElement;
    svg.innerHTML = wheelSvg(slots);
    svg.querySelector(`g[data-slot="${this.slot}"]`)?.classList.add('on');
    (this.el.querySelector('.em-mid b') as HTMLElement).textContent = String(this.slot + 1);
    this.el.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === this.kind));
    // each in the list says which slots it is in already
    const where = (id: string) => slots.flatMap((s, i) => (s === id ? [i + 1] : []));
    (this.el.querySelector('.em-items') as HTMLElement).innerHTML = EMOTES.filter((e) => e.kind === this.kind)
      .map((e) => {
        const at = where(e.id);
        return `<button type="button" class="em-item${slots[this.slot] === e.id ? ' in' : ''}" data-id="${e.id}"><span>${e.label}</span>${at.length ? `<em>slot ${at.join(', ')}</em>` : `<i>${e.once ? 'once' : e.hold ? 'until you move' : 'call'}</i>`}</button>`;
      })
      .join('');
    this.caption();
  }

  /** over the survivor: what it is doing, and whether that is what is in the slot */
  private caption() {
    const e = EMOTE[this.doing];
    const trying = !!this.hovered && this.hovered !== wheelSlots()[this.slot];
    (this.el.querySelector('.em-cap b') as HTMLElement).textContent = e?.label ?? '';
    (this.el.querySelector('.em-cap span') as HTMLElement).textContent = !e ? '' : (trying ? `click to put it in slot ${this.slot + 1} \u00b7 ` : '') + (e.say ? `called out: \u201c${e.say}\u201d` : e.once ? 'played once' : e.hold ? 'kept up until you move' : '');
    this.el.querySelector('.em-preview')!.classList.toggle('trying', trying);
  }

  /** whether it is up and in sight */
  get isOpen() {
    return this.on && this.root.offsetParent !== null;
  }

  /** where the survivor stands, for the game's renderer (null: not open) */
  box(): DollBox | null {
    if (!this.isOpen) return null;
    const f = this.fig.getBoundingClientRect(), s = this.sheet.getBoundingClientRect();
    if (f.width < 16 || f.height < 16) return null;
    // (the sheet's own veil, as its stylesheet has it: one colour, its blur)
    const veil = { x: s.left, y: s.top, w: s.width, h: s.height, from: [10, 12, 11, 0.82], to: [10, 12, 11, 0.82], blur: 12, sat: 1, band: 0, thins: 0 };
    return { x: f.left, y: f.top, w: f.width, h: f.height, cx: f.left, cy: f.top, cw: f.width, ch: f.height, veil };
  }

  /** the hole in the sheet is open for exactly as long as the survivor is drawn in it */
  shown(on: boolean) {
    const s = this.sheet;
    s.classList.toggle('em-hole', on);
    if (!on) return;
    // (said in the sheet's own measure: the screen's, over the page's zoom)
    const f = this.fig.getBoundingClientRect(), b = s.getBoundingClientRect(), z = s.offsetWidth ? b.width / s.offsetWidth : 1;
    // (and from the top of what it scrolls, which is where the layer the hole is cut in begins)
    const at = (v: number, scrolled: number) => `${(v / z + scrolled).toFixed(2)}px`;
    s.style.setProperty('--em-l', at(f.left - b.left, s.scrollLeft));
    s.style.setProperty('--em-t', at(f.top - b.top, s.scrollTop));
    s.style.setProperty('--em-r', at(f.right - b.left, s.scrollLeft));
    s.style.setProperty('--em-b', at(f.bottom - b.top, s.scrollTop));
  }
}
