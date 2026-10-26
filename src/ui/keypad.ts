// A lock's panel (2026-10-24, base building's fourth step, the owner: "keycode keylocks"): what the lock is and who it
// lets in, a keypad of four figures when a code is to be set or entered, and what may be done with it (lock, unlock,
// change its code, cut a key, join its claim). The figures are typed or clicked; Enter puts them in, Escape, F or Tab
// put the panel away. Styles: `.keypad` in hud.css.

import { audio } from '../core/audio';

export interface PadAction {
  id: string;
  label: string;
}

export interface PadOptions {
  title: string;
  status: string;
  /** a code asked for: what it is for (none: no keypad, only the actions) */
  code?: string;
  actions?: PadAction[];
  onCode?: (code: string) => void;
  onAction?: (id: string) => void;
}

const DIGITS = 4;

export class Keypad {
  readonly el: HTMLDivElement;
  isOpen = false;
  private o: PadOptions | null = null;
  private typed = '';
  private openedAt = 0;
  /** said when it is put away, by any means; and when it is opened */
  onClose: () => void = () => {};
  onOpen: () => void = () => {};
  /** a controller's: the button the d-pad or the stick is on, what was down last frame, and when the stick may move it again */
  private focus = 0;
  private was: boolean[] = [];
  private stickAt = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'keypad';
    this.el.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.el) return this.close();
      const b = t.closest('button');
      if (!b) return;
      e.preventDefault();
      this.press(b);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.repeat) return;
      if (/^Digit\d$|^Numpad\d$/.test(e.code) && this.o?.code) this.digit(e.code.slice(-1));
      else if (e.code === 'Backspace') this.back();
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') this.enter();
      else if (e.code === 'Escape' || ((e.code === 'KeyF' || e.code === 'Tab') && performance.now() - this.openedAt > 250)) this.close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  /** a button of it pressed: a figure, back, enter, put away, or one of what may be done */
  private press(b: HTMLButtonElement) {
    {
      if (b.dataset.d !== undefined) this.digit(b.dataset.d);
      else if (b.dataset.k === 'back') this.back();
      else if (b.dataset.k === 'ok') this.enter();
      else if (b.dataset.k === 'x') this.close();
      else if (b.dataset.a) {
        const id = b.dataset.a, o = this.o;
        this.close();
        o?.onAction?.(id);
      }
    }
  }

  /**
   * Each frame while it is open, a controller's say (the owner, 2026-10-25: "controller needs to be able to enter code
   * too"): the d-pad or the left stick over its buttons, three to a row and what may be done under them, A (Cross)
   * presses the one it is on, B (Circle) puts it away.
   */
  padFrame() {
    if (!this.isOpen) return;
    const g = [...(navigator.getGamepads?.() ?? [])].find((q) => q?.connected);
    if (!g) return;
    const btns = [...this.el.querySelectorAll<HTMLButtonElement>('.kp-keys button, .kp-acts button')];
    if (!btns.length) return;
    const edge = (i: number) => {
      const now = !!g.buttons[i]?.pressed, was = this.was[i];
      this.was[i] = now;
      return now && !was;
    };
    const keys = this.el.querySelectorAll('.kp-keys button').length;
    let dx = (edge(15) ? 1 : 0) - (edge(14) ? 1 : 0), dy = (edge(13) ? 1 : 0) - (edge(12) ? 1 : 0);
    const ax = g.axes[0] ?? 0, ay = g.axes[1] ?? 0, now = performance.now();
    if (!dx && !dy && now > this.stickAt && Math.max(Math.abs(ax), Math.abs(ay)) > 0.6) {
      this.stickAt = now + 220;
      if (Math.abs(ax) > Math.abs(ay)) dx = Math.sign(ax);
      else dy = Math.sign(ay);
    }
    let f = Math.min(this.focus, btns.length - 1);
    if (dx) f += dx;
    if (dy) f += f < keys ? dy * 3 : dy;
    if (dy > 0 && f >= keys && this.focus < keys) f = keys;
    this.focus = Math.max(0, Math.min(btns.length - 1, f));
    btns.forEach((b, i) => b.classList.toggle('kp-focus', i === this.focus));
    if (edge(0)) this.press(btns[this.focus]);
    else if (edge(1)) this.close();
  }

  open(o: PadOptions) {
    this.o = o;
    this.typed = '';
    this.isOpen = true;
    this.openedAt = performance.now();
    this.focus = 0;
    this.render();
    this.el.classList.add('on');
    this.onOpen();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('on');
    this.onClose();
  }

  private digit(d: string) {
    if (this.typed.length >= DIGITS) return;
    audio.built('keypad', undefined, 0.8, 0.94 + Number(d) * 0.012);
    this.typed += d;
    this.render();
    if (this.typed.length === DIGITS) setTimeout(() => this.isOpen && this.typed.length === DIGITS && this.enter(), 140);
  }
  private back() {
    this.typed = this.typed.slice(0, -1);
    this.render();
  }
  private enter() {
    if (this.typed.length !== DIGITS || !this.o?.onCode) return;
    const code = this.typed, o = this.o;
    this.close();
    o.onCode?.(code);
  }

  private render() {
    const o = this.o!;
    const cells = Array.from({ length: DIGITS }, (_, i) => `<i class="${i < this.typed.length ? 'set' : ''}">${i < this.typed.length ? '•' : ''}</i>`).join('');
    const pad = o.code
      ? `<div class="kp-for">${o.code}</div><div class="kp-cells">${cells}</div><div class="kp-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-d="${n}">${n}</button>`).join('')}<button data-k="back">&#9003;</button><button data-d="0">0</button><button data-k="ok">&#10003;</button></div>`
      : '';
    const acts = (o.actions ?? []).map((a) => `<button data-a="${a.id}">${a.label}</button>`).join('');
    this.el.innerHTML = `<div class="kp-card"><button class="kp-x" data-k="x">&times;</button><b>${o.title}</b><span>${o.status}</span>${pad}${acts ? `<div class="kp-acts">${acts}</div>` : ''}<small>${o.code ? 'Type the figures, or click them · Esc puts it away' : 'Esc puts it away'}</small></div>`;
  }
}
