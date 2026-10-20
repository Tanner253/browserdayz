// Keyboard + mouse with pointer lock. Edge-triggered state (pressed/released) is
// valid for exactly one frame; call endFrame() after the game update.

export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  /** presses latched until a fixed simulation step consumes them */
  private fixedSet = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /**
   * Touch screen: there is no mouse to capture, so "locked" simply means the game has
   * the screen, and aiming and buttons come from the on-screen controls.
   */
  touch = false;
  /** set by UI screens that need the cursor (inventory, menus) */
  uiMode = false;
  /**
   * Played with a controller (src/core/gamepad.ts): as on a touch screen, there is no mouse to capture, and "locked"
   * means the game has the screen. Let go of as soon as the mouse is clicked.
   */
  pad = false;
  /** when a key and when the controller were last used (performance.now): which of the two the corner's keys are shown for */
  keyAt = 0;
  padAt = 0;
  onLockChange: (locked: boolean) => void = () => {};
  /** keys the player has put things on: each to the name the game asks for that thing by ('' for a key that now does nothing). See src/core/keys.ts. */
  private via = new Map<string, string>();
  /** the keys as the player has set them (anything held is let go: it may not be the same thing any more) */
  rebind(via: Map<string, string>) {
    this.via = via;
    this.releaseAll();
  }
  /** in a vehicle's seat: Ctrl and a number is a seat (src/game/garage.ts, `swap`), not the browser's tab of that number */
  seatKeys = false;

  private named(key: string) {
    const as = this.via.get(key);
    return as === undefined ? key : as;
  }

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      // typing in a text field (player name) is not game input
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const k = this.named(e.code);
      if (e.code === 'Tab' || e.code === 'Space' || e.code === 'Slash' || e.code.startsWith('Arrow') || k === 'Tab' || k === 'Space' || (e.ctrlKey && e.code === 'KeyW') || (this.seatKeys && e.ctrlKey && /^Digit[1-4]$/.test(e.code))) e.preventDefault();
      if (e.repeat || !k) return;
      this.keyAt = performance.now();
      this.down.add(k);
      this.pressedSet.add(k);
      this.fixedSet.add(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = this.named(e.code);
      if (!k) return;
      this.down.delete(k);
      this.releasedSet.add(k);
    });
    window.addEventListener('blur', () => {
      for (const k of this.down) this.releasedSet.add(k);
      this.down.clear();
    });
    el.addEventListener('mousedown', (e) => {
      // a tap also arrives as a mouse click: on a touch screen the buttons do the shooting
      if (this.touch) return;
      // (the mouse again after a controller: the screen is taken properly, with the mouse captured)
      if (this.pad) {
        this.pad = false;
        if (this.locked && !document.pointerLockElement) {
          this.locked = false;
          this.lock();
          return;
        }
      }
      // clicking the game while the cursor is free captures it (the click is not a shot)
      if (!this.locked && !this.uiMode) {
        this.lock();
        return;
      }
      const k = this.named(`Mouse${e.button}`);
      if (!k) return;
      this.down.add(k);
      this.pressedSet.add(k);
      // (a mouse button that has been given a key's work: taken by whatever reads that key in a fixed step, too)
      if (!k.startsWith('Mouse')) this.fixedSet.add(k);
    });
    window.addEventListener('mouseup', (e) => {
      if (this.touch) return;
      const k = this.named(`Mouse${e.button}`);
      if (!k) return;
      this.down.delete(k);
      this.releasedSet.add(k);
    });
    window.addEventListener('mousemove', (e) => {
      // standard FPS mouse: only a captured (pointer-locked) mouse aims
      if (!this.locked || this.touch) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (this.touch) return;
      this.setLocked(document.pointerLockElement === this.el);
    });
  }

  /** let go of every held key (a text field is taking the keyboard) */
  releaseAll() {
    for (const k of this.down) this.releasedSet.add(k);
    this.down.clear();
  }

  private setLocked(locked: boolean) {
    this.locked = locked;
    if (!locked) {
      for (const k of this.down) if (k.startsWith('Mouse')) this.releasedSet.add(k);
      for (const k of [...this.down]) if (k.startsWith('Mouse')) this.down.delete(k);
    }
    this.onLockChange(locked);
  }

  /** Aim input from a finger dragging across the screen, in mouse pixels. */
  look(dx: number, dy: number) {
    if (!this.locked) return;
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Capture the mouse (call from a click or key press). */
  lock() {
    if (this.locked) return;
    if (this.touch || this.pad) return this.setLocked(true);
    // raw (unaccelerated) mouse input like native shooters, where the browser supports it
    const r = this.el.requestPointerLock({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
    r?.catch?.(() => (this.el.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}));
  }

  unlock() {
    if (this.touch || (this.pad && !document.pointerLockElement)) {
      if (this.locked) this.setLocked(false);
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  held(code: string) {
    return this.down.has(code);
  }
  pressed(code: string) {
    return this.pressedSet.has(code);
  }
  /** edge-triggered press for fixed-step code; stays set until consumeFixed() */
  pressedFixed(code: string) {
    return this.fixedSet.has(code);
  }
  consumeFixed() {
    this.fixedSet.clear();
  }

  released(code: string) {
    return this.releasedSet.has(code);
  }

  /** Programmatic input for automated testing (window.__game.input.simulate) */
  simulate(code: string, isDown: boolean) {
    if (isDown) {
      this.down.add(code);
      this.pressedSet.add(code);
      this.fixedSet.add(code);
    } else {
      this.down.delete(code);
      this.releasedSet.add(code);
    }
  }

  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}

export interface MoveInput {
  held(code: string): boolean;
  pressedFixed(code: string): boolean;
}

/** Input that never reports anything (the character stands still while a menu or the chat box has the keyboard). */
export const NULL_INPUT: MoveInput = { held: () => false, pressedFixed: () => false };
