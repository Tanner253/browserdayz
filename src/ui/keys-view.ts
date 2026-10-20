// The keys that do something now, drawn in the corner under the hands' mouse (what they are is src/game/key-hints.ts).
// All of them for a while after they change, so that a seat taken or a gun drawn is seen with its keys; then only the
// moment's own, quieter, so the corner is not cluttered for the rest of the time (the owner's ask: shown all the
// time, in the bottom left).
import type { KeyHints, KeyRow } from '../game/key-hints';

/** how long all of them are shown after the mode changes (a seat taken, a gun drawn), ms */
const FULL_FOR = 9000;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class KeysView {
  private sig = '';
  private mode = '';
  private at = 0;
  private quiet = false;
  constructor(private el: HTMLElement, private mouse: (on: 'l' | 'r' | 'w') => string) {}

  show(k: KeyHints | null | undefined) {
    const sig = k ? k.rows.map((r) => `${r.keys.join(' ')}${r.mouse ?? ''}:${r.text}`).join('|') : '';
    const now = performance.now();
    // (the time runs again from a new mode only: not from a row that changed, nor from the inventory shut again)
    if (k && k.mode !== this.mode) {
      this.mode = k.mode;
      this.at = now;
    }
    if (sig !== this.sig) {
      this.sig = sig;
      if (k) this.el.innerHTML = k.rows.map((r, i) => this.row(r, i >= k.own, i === k.own)).join('');
    }
    this.el.classList.toggle('show', !!k);
    const quiet = !!k && now - this.at > FULL_FOR;
    if (quiet !== this.quiet) this.el.classList.toggle('quiet', (this.quiet = quiet));
  }

  /** `gen`: one of those always to hand, which go when it quietens; the first of them starts a line of its own */
  private row(r: KeyRow, gen: boolean, first: boolean) {
    const keys = r.mouse ? this.mouse(r.mouse) : r.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('');
    return `<div class="hk${gen ? ' gen' : ''}${first ? ' gen1' : ''}"><span class="hk-keys">${keys}</span><span>${esc(r.text)}</span></div>`;
  }
}
