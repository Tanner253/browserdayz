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
  /** set by UI screens that need the cursor (inventory, menus) */
  uiMode = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      // typing in a text field (player name) is not game input
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressedSet.add(e.code);
      this.fixedSet.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedSet.add(e.code);
    });
    window.addEventListener('blur', () => {
      for (const k of this.down) this.releasedSet.add(k);
      this.down.clear();
    });
    el.addEventListener('mousedown', (e) => {
      // clicking the game while the cursor is free captures it (the click is not a shot)
      if (!this.locked && !this.uiMode) {
        this.lock();
        return;
      }
      const k = `Mouse${e.button}`;
      this.down.add(k);
      this.pressedSet.add(k);
    });
    window.addEventListener('mouseup', (e) => {
      const k = `Mouse${e.button}`;
      this.down.delete(k);
      this.releasedSet.add(k);
    });
    window.addEventListener('mousemove', (e) => {
      // standard FPS mouse: only a captured (pointer-locked) mouse aims
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        for (const k of this.down) if (k.startsWith('Mouse')) this.releasedSet.add(k);
        for (const k of [...this.down]) if (k.startsWith('Mouse')) this.down.delete(k);
      }
      this.onLockChange(this.locked);
    });
  }

  /** let go of every held key (a text field is taking the keyboard) */
  releaseAll() {
    for (const k of this.down) this.releasedSet.add(k);
    this.down.clear();
  }

  /** Capture the mouse (call from a click or key press). */
  lock() {
    if (this.locked) return;
    // raw (unaccelerated) mouse input like native shooters, where the browser supports it
    const r = this.el.requestPointerLock({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
    r?.catch?.(() => (this.el.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}));
  }

  unlock() {
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

/** Input that never reports anything (player body idles while the free camera flies). */
export const NULL_INPUT: MoveInput = { held: () => false, pressedFixed: () => false };
