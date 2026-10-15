// The menu's Emotes: the eight slots of the wheel (hold T) set by the player, each thing there is to call out or do
// watched first on the survivor (the owner, 2026-10-14: "we need to rethink how we have emotes setup and we need to
// allow the user to assign which emote to which radial key i think which means we need an emote preview for the user
// to watch"). Pick a slot, then pick from the list: it goes in the slot, and the survivor beside it does it.
//
// The survivor is the inventory's (src/game/doll.ts), a second of it: drawn by the game's renderer into a hole cut in
// this sheet, where the page's veil is made again behind it (see DollBox).
import { EMOTE, EMOTES, WHEEL_DEFAULT, WHEEL_SLOTS, type Emote } from '../sim/emotes';
import type { DollBox } from '../game/doll';
import { setWheelSlots, wheelSlots } from './wheel-slots';

const KINDS: [Emote['kind'], string][] = [['call', 'Calls'], ['dance', 'Dances'], ['gesture', 'Gestures'], ['pose', 'Poses']];

export class EmotesMenu {
  readonly el: HTMLElement;
  private slot = 0;
  private kind: Emote['kind'] = 'call';
  /** what the survivor beside the wheel is doing (the slot's, until something else is picked) */
  showing: string;
  /** a call picked: its words said (the game's own voice) */
  onCall?: (id: string) => void;
  /** the survivor shown, turned by a drag across it (src/game/doll.ts) */
  figure: { grab(): void; turn(by: number): void; drop(): void } | null = null;
  private fig: HTMLElement;
  private sheet: HTMLElement | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'start-pane pane-emotes';
    this.el.innerHTML = `
      <div class="em-top">
        <div class="em-wheel" role="radiogroup" aria-label="Wheel slots">${Array.from({ length: WHEEL_SLOTS }, (_, i) => `<button type="button" class="em-slot" data-slot="${i}" style="--a:${(i / WHEEL_SLOTS) * 360}deg"></button>`).join('')}<i class="em-hub">T</i></div>
        <div class="em-preview"><div class="em-fig"></div><div class="em-cap"><b></b><span></span></div><i class="em-turn">drag to turn</i></div>
      </div>
      <div class="em-lib">
        <div class="em-tabs">${KINDS.map(([k, label]) => `<button type="button" data-kind="${k}">${label}</button>`).join('')}</div>
        <div class="em-items"></div>
      </div>
      <p class="em-hint">Click a slot, then pick: it goes in, and you see it done. In the game, hold <b>T</b>, aim at a slot, let go. <button type="button" class="em-reset">Back to the first eight</button></p>`;
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
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const slot = t.closest<HTMLElement>('.em-slot')?.dataset.slot;
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
        return;
      }
      if (t.closest('.em-reset')) {
        setWheelSlots([...WHEEL_DEFAULT]);
        this.show(WHEEL_DEFAULT[this.slot]);
      }
    });
    this.render();
  }

  /** the sheet it is in: the hole the survivor is seen through is cut in that */
  inSheet(sheet: HTMLElement) {
    this.sheet = sheet;
    sheet.querySelector('.sm-sheet-head')!.after(this.el);
  }

  private show(id: string) {
    this.showing = id;
    const e = EMOTE[id];
    if (e?.kind === 'call') this.kind = 'call';
    else if (e) this.kind = e.kind;
    if (e?.say) this.onCall?.(id);
    this.render();
  }

  private render() {
    const slots = wheelSlots();
    this.el.querySelectorAll<HTMLElement>('.em-slot').forEach((b, i) => {
      const e = EMOTE[slots[i]];
      b.textContent = e?.label ?? '';
      b.classList.toggle('on', i === this.slot);
      b.classList.toggle('call', e?.kind === 'call');
    });
    this.el.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === this.kind));
    const inSlot = slots[this.slot];
    (this.el.querySelector('.em-items') as HTMLElement).innerHTML = EMOTES.filter((e) => e.kind === this.kind)
      .map((e) => `<button type="button" class="em-item${e.id === inSlot ? ' in' : ''}${e.id === this.showing ? ' on' : ''}" data-id="${e.id}">${e.label}${e.once ? '<i>once</i>' : e.hold ? '<i>until you move</i>' : ''}</button>`)
      .join('');
    const e = EMOTE[this.showing];
    (this.el.querySelector('.em-cap b') as HTMLElement).textContent = e?.label ?? '';
    (this.el.querySelector('.em-cap span') as HTMLElement).textContent = !e ? '' : e.say ? `called out: “${e.say}”` : e.once ? 'played once' : e.hold ? 'kept up until you move' : '';
  }

  /** whether it is open: the sheet on Emotes, and in sight */
  open() {
    return !!this.sheet && this.sheet.dataset.tab === 'emotes' && this.sheet.offsetParent !== null;
  }

  /** where the survivor stands, for the game's renderer (null: not open) */
  box(): DollBox | null {
    if (!this.open() || !this.sheet) return null;
    const f = this.fig.getBoundingClientRect(), s = this.sheet.getBoundingClientRect();
    if (f.width < 16 || f.height < 16) return null;
    // (the sheet's own veil, as its stylesheet has it: one colour, its blur)
    const veil = { x: s.left, y: s.top, w: s.width, h: s.height, from: [10, 12, 11, 0.82], to: [10, 12, 11, 0.82], blur: 12, sat: 1, band: 0, thins: 0 };
    return { x: f.left, y: f.top, w: f.width, h: f.height, cx: f.left, cy: f.top, cw: f.width, ch: f.height, veil };
  }

  /** the hole in the sheet is open for exactly as long as the survivor is drawn in it */
  shown(on: boolean) {
    const s = this.sheet;
    if (!s) return;
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
