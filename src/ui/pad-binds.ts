// A controller's buttons in Settings, Controls: each thing and the button it is on, clicked and put on another as the
// keyboard's keys are (the owner, 2026-10-26: "controllers have asked for key remapping and rebinding options like we
// have for pc so they can make their own layouts"). Kept with the controls (src/core/keys.ts `padKeys`), so each player
// has their own; two things that want one button change places, and it is said which moved.

import { PAD_ACTIONS, bindPad, buttonName, padButtons, type PadAction, type PadKind } from '../core/pad-layout';
import { padCapture } from '../core/gamepad';
import { controls, setControls, type Controls } from '../core/keys';

/** whose names the buttons go by: the pad last used, or PlayStation's before any is */
export const shownKind = (): PadKind => (document.body.dataset.pad === 'xbox' ? 'xbox' : 'ps');

export class PadBinds {
  /** the thing waiting for a button */
  waiting: PadAction | null = null;
  /** what the last change moved, said once */
  private said = '';

  constructor(
    private changed: (c: Controls) => void,
    private redraw: () => void,
  ) {
    // (Esc leaves it as it was: taken before the menu hears it)
    window.addEventListener('keydown', (e) => {
      if (!this.waiting || e.code !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.stop();
    }, true);
  }

  html(c: Controls): string {
    const K = padButtons(c.padKeys), kind = shownKind(), said = this.said;
    this.said = '';
    const rows = PAD_ACTIONS.map((a) => {
      const on = this.waiting === a.id, moved = c.padKeys[a.id] !== undefined;
      return `<button type="button" class="kbs-row${on ? ' on' : ''}${moved ? ' set' : ''}" data-pad-act="${a.id}"><span>${a.does}</span><kbd class="wide">${on ? '…' : buttonName(K[a.id], kind)}</kbd></button>`;
    }).join('');
    const top = this.waiting ? 'Press the button for it on the controller. <b>Esc</b> leaves it as it is.' : said || 'Click a thing, then press its button on the controller. Two things that want one button change places.';
    return `<div class="pad-binds"><div class="kbs-top"><span>${top}</span><button type="button" class="kbs-reset pad-reset"${Object.keys(c.padKeys).length ? '' : ' disabled'}>Reset all</button></div>` +
      `<div class="kbs-cols">${rows}</div>` +
      `<p class="pad-map">In play the left stick moves and the right stick looks. In menus the left stick moves a cursor: ${buttonName(0, kind)} clicks, ${buttonName(1, kind)} goes back, the right stick scrolls.</p></div>`;
  }

  /** a click in the controls' page: true when it was this list's */
  click(b: HTMLElement): boolean {
    if (b.classList.contains('pad-reset')) {
      this.stop(false);
      this.set({ ...controls(), padKeys: {} });
      return true;
    }
    const id = b.dataset.padAct as PadAction | undefined;
    if (!id) return false;
    if (this.waiting === id) return this.stop(), true;
    this.waiting = id;
    padCapture.want = (btn) => {
      const r = bindPad(controls().padKeys, id, btn), kind = shownKind();
      this.waiting = null;
      const what = (a: PadAction) => PAD_ACTIONS.find((x) => x.id === a)!.does.split(' · ')[0];
      if (r.swapped) this.said = `${what(id)} is on ${buttonName(btn, kind)} now, and ${what(r.swapped)} moved to ${buttonName(padButtons(r.moved)[r.swapped], kind)}.`;
      this.set({ ...controls(), padKeys: r.moved });
    };
    this.redraw();
    return true;
  }

  /** nothing waits for a button any more (a page turned, Esc) */
  stop(redraw = true) {
    if (!this.waiting) return;
    this.waiting = null;
    padCapture.want = null;
    if (redraw) this.redraw();
  }

  private set(c: Controls) {
    setControls(c);
    this.changed(c);
    this.redraw();
  }
}
