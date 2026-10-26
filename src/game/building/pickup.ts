// A thing set down in one's own base picked up whole by hand, with nothing in particular in the hands (the owner,
// 2026-10-26: "I should be able to pick up placeable items in my base without a hammer in my hand, like the weapon rack,
// bed, forge, chest etc"): F held at it picks it up, F tapped does what F always did there (opens a box, uses a bench),
// as a claim's F joins it held and opens it tapped (src/game/building/claims.ts). What is picked up, and when, is
// src/sim/build/pieces.ts `byHand` and the server's word (server/build.ts takeDown).

/** seconds F is held at it to pick it up */
const HOLD = 0.5;

export class HandPickup {
  /** seconds F has been held at it (-1: it is not) */
  private fT = -1;
  private done = false;
  /** what it is held at: a base's piece */
  private at = '';

  constructor(private input: { pressed(code: string): boolean; held(code: string): boolean }) {}

  /**
   * Each frame, at a thing that is picked up by hand (`at` null: none is looked at).
   * @param said what F tapped does there, as the corner says it
   * @returns what the corner says now
   */
  frame(dt: number, free: boolean, at: string | null, said: string | null, tap: () => void, pick: () => void): string | null {
    if (!at || at !== this.at) {
      this.fT = -1;
      this.at = at ?? '';
      if (!at) return null;
    }
    if (free && this.input.pressed('KeyF')) {
      this.fT = 0;
      this.done = false;
    }
    if (this.fT >= 0) {
      if (this.input.held('KeyF')) {
        this.fT += dt;
        if (this.fT >= HOLD && !this.done) {
          this.done = true;
          pick();
        }
      } else {
        if (!this.done) tap();
        this.fT = -1;
      }
    }
    const picking = this.fT > 0.12 && !this.done;
    return `${said ?? ''} <i class="bc-hold">${picking ? 'picking it up…' : 'hold <kbd>F</kbd> to pick it up'}</i>`;
  }
}
