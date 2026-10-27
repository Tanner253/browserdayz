// A bed or a sleeping bag of one's own given to somebody in one's party (the owner, 2026-10-27): looked at, G tapped
// goes through the party's members on the server, G held gives it to the one named. The server's side, its rules (one's
// own, a member online, within their limit of beds): server/beds.ts giveBed.
import type { C2S } from '../../net/protocol';

/** seconds G is held at it to give it */
const HOLD = 0.6;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export class BedGive {
  /** whether G is this one's now: the game's G, putting down what is in the hands, stands aside (src/game/game/frame.ts) */
  wantsG = false;
  /** seconds G has been held at it (-1: it is not) */
  private gT = -1;
  private done = false;
  /** what it is held at, and which member is named */
  private at = '';
  private pick = 0;

  constructor(
    private input: { pressed(code: string): boolean; held(code: string): boolean },
    /** the others in the party who are on the server now */
    private mates: () => { id: number; name: string }[],
    private send: (m: C2S) => void,
  ) {}

  /**
   * Each frame, at a bed or a bag of one's own (`at` null: none is looked at).
   * @returns what the corner says of it, after the rest of the card
   */
  frame(dt: number, free: boolean, at: { b: number; p: number } | null): string | null {
    const mates = at ? this.mates() : [];
    const key = at ? `${at.b}:${at.p}` : '';
    this.wantsG = mates.length > 0;
    if (key !== this.at || !this.wantsG) {
      this.at = key;
      this.gT = -1;
      this.pick = 0;
    }
    if (!at || !this.wantsG) return null;
    this.pick %= mates.length;
    if (free && this.input.pressed('KeyG')) {
      this.gT = 0;
      this.done = false;
    }
    if (this.gT >= 0) {
      if (this.input.held('KeyG')) {
        this.gT += dt;
        if (this.gT >= HOLD && !this.done) {
          this.done = true;
          this.send({ t: 'bgive', b: at.b, p: at.p, to: mates[this.pick].id });
        }
      } else {
        if (!this.done) this.pick = (this.pick + 1) % mates.length;
        this.gT = -1;
      }
    }
    const who = `<b>${esc(mates[this.pick].name)}</b>`;
    if (this.gT > 0.12 && !this.done) return `<i class="bc-hold">giving it to ${who}…</i>`;
    return `<i class="bc-hold">hold <kbd>G</kbd> to give it to ${who}${mates.length > 1 ? ' · tap G for another' : ''}</i>`;
  }
}
