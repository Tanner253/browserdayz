// A controller (PlayStation, Xbox, any the browser calls "standard"), read each frame, pressing the game's own
// controls by their names as the keyboard and the phone's buttons do (src/core/input.ts). Laid out as Call of Duty's
// default (the owner, 2026-10-15: "make sure that the buttons map similar to default COD and that all of our
// functionality is maintained"): what that layout has no button for (leaning, the light, the map) is where a shooter's
// player looks for it. Switched on in Settings, Controls ("settings to enable this in the settings menu"). The bumpers
// change what is in the hands, and the sticks pressed in lean while aiming (the owner, 2026-10-18: "using r1 and r2 is the
// best for switching items ... more important than leaning left and right"; "use lean for when they press the left or
// right stick").
//
// In play the sticks move and look. Anywhere else (the menu, the inventory, the map, Emotes, the dead screen) the left
// stick steers a cursor of its own: ✕ clicks, held it drags, ○ goes back, the right stick scrolls.

/** the standard layout's buttons, by the place they are in (PlayStation names; Xbox has A B X Y, LB RB LT RT) */
const B = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, create: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, pad: 17 };
/** how far a stick is pushed before it counts; past `walk` it jogs; how far a trigger is pulled before it fires; L2 pulled
 * past `full` holds the breath (the aim is at a light pull) */
const DEAD = 0.16, WALK = 0.62, PULL = 0.3, FULL = 0.95;
/** a button held this long (seconds) does its second thing */
const HOLD = 0.32;
/** the right stick all the way over: pixels of mouse a second; and how much more it gives held there a while */
const LOOK = 1300, RAMP = { after: 0.3, over: 0.45, more: 0.7 };
/** the cursor: pixels a second with the stick all the way over */
const CURSOR = 1100;

export interface PadHost {
  /** switched on in the settings */
  on(): boolean;
  /** in play: the sticks move and look (otherwise the cursor) */
  playing(): boolean;
  /** something to take, open or search is in front: □ does that rather than reload */
  facing(): boolean;
  /** in a vehicle's seat: L3 the horn, R3 the siren */
  riding(): boolean;
  look(): { sens: number; invert: boolean };
  /** the mouse's own speed: the stick's is its own */
  mouseSens(): number;
  note(text: string): void;
}

interface Input {
  pad: boolean;
  locked: boolean;
  wheel: number;
  held(code: string): boolean;
  simulate(code: string, down: boolean): void;
  look(dx: number, dy: number): void;
  lock(): void;
  unlock(): void;
}

export class Gamepad {
  /** what the pad holds down now, by the game's names for them */
  private holding = new Set<string>();
  private was: boolean[] = [];
  private since: number[] = [];
  /** a held button's second thing has been done */
  private second = new Set<number>();
  private sprint = false;
  private full = 0;
  private cursor: HTMLElement | null = null;
  private at = { x: innerWidth / 2, y: innerHeight / 2 };
  private dragging = false;
  private over: Element | null = null;
  private told = false;

  constructor(
    private input: Input,
    private host: PadHost,
  ) {
    window.addEventListener('gamepadconnected', () => {
      if (!this.host.on() && !this.told) {
        this.told = true;
        this.host.note('Controller found: switch it on in Settings, Controls');
      }
    });
    // (a finger on the screen again: the touch controls come back)
    window.addEventListener('touchstart', () => document.body.classList.remove('pad'), { passive: true });
  }

  /** read the pad and press what it says; called at the head of each frame, before anything reads the input */
  update(dt: number) {
    const gp = this.host.on() ? [...(navigator.getGamepads?.() ?? [])].find((g) => g?.connected) : null;
    if (!gp) {
      if (this.holding.size) this.letGo();
      this.showCursor(false);
      return;
    }
    const pressed = gp.buttons.map((b, i) => b.pressed || b.value > (i === B.l2 || i === B.r2 ? PULL : 0.5));
    const any = pressed.some(Boolean) || gp.axes.some((a) => Math.abs(a) > 0.5);
    if (any && !this.input.pad) {
      this.input.pad = true;
      document.body.classList.add('pad');
    }
    if (!this.input.pad) return;
    const now = performance.now() / 1000;
    const down = (i: number) => !!pressed[i];
    const went = (i: number) => down(i) && !this.was[i];
    const up = (i: number) => !down(i) && !!this.was[i];
    for (let i = 0; i < pressed.length; i++) if (went(i)) this.since[i] = now;
    const heldFor = (i: number) => (down(i) ? now - (this.since[i] ?? now) : 0);
    if (this.host.playing()) {
      this.showCursor(false);
      if (!this.input.locked) this.input.lock();
      this.play(gp, dt, down, went, up, heldFor);
    } else {
      if (this.holding.size) this.letGo();
      this.menus(gp, dt, went, up);
    }
    this.was = pressed;
  }

  private hold(code: string, on: boolean) {
    if (on === this.holding.has(code)) return;
    if (on) this.holding.add(code);
    else this.holding.delete(code);
    this.input.simulate(code, on);
  }
  private tap(code: string) {
    this.input.simulate(code, true);
    // (let go next frame: pressed for this one, and the game's own held() sees it once)
    queueMicrotask(() => this.input.simulate(code, false));
  }
  private letGo() {
    for (const code of this.holding) this.input.simulate(code, false);
    this.holding.clear();
    this.second.clear();
    this.sprint = false;
  }

  private play(gp: globalThis.Gamepad, dt: number, down: (i: number) => boolean, went: (i: number) => boolean, up: (i: number) => boolean, heldFor: (i: number) => number) {
    const [lx = 0, ly = 0, rx = 0, ry = 0] = gp.axes;
    // the left stick: where it is pushed, a little to walk, all the way to jog
    const push = Math.hypot(lx, ly), moving = push > DEAD;
    this.hold('KeyW', moving && ly < -0.35);
    this.hold('KeyS', moving && ly > 0.35);
    this.hold('KeyA', moving && lx < -0.35);
    this.hold('KeyD', moving && lx > 0.35);
    this.hold('AltLeft', moving && push < WALK);
    // the right stick: the head, faster the further it is pushed, and faster again held all the way over a while
    const { sens, invert } = this.host.look();
    const curve = (v: number) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD) / (1 - DEAD)) ** 1.8);
    const cx = curve(rx), cy = curve(ry);
    this.full = Math.hypot(rx, ry) > 0.92 ? this.full + dt : 0;
    const ramp = 1 + RAMP.more * Math.min(1, Math.max(0, this.full - RAMP.after) / RAMP.over);
    const k = (LOOK * sens * ramp * dt) / Math.max(0.05, this.host.mouseSens());
    if (cx || cy) this.input.look(cx * k, (invert ? -cy : cy) * k);
    // triggers: aim and fire
    this.hold('Mouse2', down(B.l2));
    this.hold('Mouse0', down(B.r2));
    const riding = this.host.riding(), aiming = down(B.l2);
    // L3: sprint, kept up until the stick comes back or the sights go up; aiming, lean left (and L2 pulled all the way in
    // holds the breath). In a seat, the horn.
    if (riding) this.hold('KeyH', down(B.l3));
    else {
      if (went(B.l3)) this.sprint = !aiming;
      if (!moving || ly > -0.3 || aiming) this.sprint = false;
      this.hold('ShiftLeft', this.sprint || (aiming && (gp.buttons[B.l2]?.value ?? 0) >= FULL));
    }
    // R3: the light; aiming, lean right; in a seat, the siren
    if (went(B.r3) && (riding || !aiming)) this.tap(riding ? 'KeyJ' : 'KeyL');
    // ✕ jump (the helicopter: up)
    this.hold('Space', down(B.cross));
    // ○ crouch, held lie down (the helicopter: down)
    if (riding) this.hold('KeyC', down(B.circle));
    else {
      if (went(B.circle)) this.tap('KeyC');
      this.second2(B.circle, heldFor, () => this.tap('KeyZ'));
    }
    // □ reload, or take · doors · search when there is something in front (held, as the key is held)
    if (went(B.square)) this.squareDoes = this.host.facing() ? 'KeyF' : 'KeyR';
    if (this.squareDoes) {
      if (this.squareDoes === 'KeyR') {
        this.tap('KeyR');
        this.squareDoes = 'done';
      } else if (this.squareDoes === 'KeyF') this.hold('KeyF', down(B.square));
      if (up(B.square)) {
        this.hold('KeyF', false);
        this.squareDoes = null;
      }
    }
    // △ the next weapon, held empty hands
    if (up(B.triangle) && !this.second.has(B.triangle)) this.input.wheel += 1;
    this.second2(B.triangle, heldFor, () => this.tap('KeyX'));
    // bumpers: the next thing in the hands (R1) or the one before (L1), as the mouse's wheel; aiming, they turn a scope that
    // turns, R1 nearer. In a seat they roll the helicopter, as Q and E do. Leaning is the sticks pressed in while aiming.
    if (!riding) {
      if (went(B.r1)) this.input.wheel += aiming ? -1 : 1;
      if (went(B.l1)) this.input.wheel += aiming ? 1 : -1;
    }
    this.hold('KeyQ', riding ? down(B.l1) : aiming && down(B.l3));
    this.hold('KeyE', riding ? down(B.r1) : aiming && down(B.r3));
    // the D-pad: ↑ the map; ↓ the call-out wheel, held (the right stick picks); ← single shots or automatic, held drops
    // what is held; → look the gun over, held talks
    if (went(B.up)) this.tap('KeyM');
    this.hold('KeyT', down(B.down));
    if (up(B.left) && !this.second.has(B.left)) this.tap('KeyB');
    this.hold('KeyG', down(B.left) && heldFor(B.left) > 0.15);
    if (up(B.right) && !this.second.has(B.right)) this.tap('KeyI');
    this.hold('KeyV', down(B.right) && heldFor(B.right) > 0.2);
    if (heldFor(B.left) > HOLD) this.second.add(B.left);
    if (heldFor(B.right) > 0.2) this.second.add(B.right);
    // the inventory; the menu
    if (went(B.pad) || went(B.create)) this.tap('Tab');
    if (went(B.options)) this.input.unlock();
    for (const i of [B.triangle, B.circle, B.left, B.right]) if (up(i)) this.second.delete(i);
  }
  private squareDoes: 'KeyF' | 'KeyR' | 'done' | null = null;
  /** a button held past HOLD: its second thing, once */
  private second2(i: number, heldFor: (i: number) => number, then: () => void) {
    if (heldFor(i) > HOLD && !this.second.has(i)) {
      this.second.add(i);
      then();
    }
  }

  // ---------------------------------------------------------------- the cursor, off play
  private showCursor(on: boolean) {
    if (!on) {
      this.cursor?.classList.remove('on');
      return;
    }
    if (!this.cursor) {
      this.cursor = document.createElement('div');
      this.cursor.className = 'pad-cursor';
      document.body.append(this.cursor);
    }
    this.cursor.classList.add('on');
  }

  private menus(gp: globalThis.Gamepad, dt: number, went: (i: number) => boolean, up: (i: number) => boolean) {
    this.showCursor(true);
    const [lx = 0, ly = 0, rx = 0, ry = 0] = gp.axes;
    const curve = (v: number) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD) / (1 - DEAD)) ** 1.6);
    this.at.x = Math.min(innerWidth - 2, Math.max(0, this.at.x + curve(lx) * CURSOR * dt));
    this.at.y = Math.min(innerHeight - 2, Math.max(0, this.at.y + curve(ly) * CURSOR * dt));
    this.cursor!.style.transform = `translate(${this.at.x}px, ${this.at.y}px)`;
    const { x, y } = this.at;
    const el = document.elementFromPoint(x, y);
    const fire = (type: string, target: Element | null, extra: Record<string, unknown> = {}) => {
      if (!target) return;
      const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: this.dragging ? 1 : 0, pointerId: 77, pointerType: 'mouse', isPrimary: true, ...extra };
      target.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init));
    };
    if (el !== this.over) {
      fire('pointerout', this.over);
      fire('mouseout', this.over);
      fire('pointerover', el);
      fire('mouseover', el);
      this.over = el;
    }
    if (curve(lx) || curve(ly)) {
      fire('pointermove', el);
      fire('mousemove', el);
    }
    if (went(B.cross)) {
      this.dragging = true;
      fire('pointerdown', el, { buttons: 1 });
      fire('mousedown', el, { buttons: 1 });
      if (el instanceof HTMLElement) el.focus?.({ preventScroll: true });
    }
    if (up(B.cross) && this.dragging) {
      this.dragging = false;
      fire('pointerup', el);
      fire('mouseup', el);
      fire('click', el);
    }
    // ○ back: as Escape is
    if (went(B.circle) || went(B.options)) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    // the right stick scrolls what is under the cursor (or turns what is turned by a wheel there: Emotes' survivor comes nearer)
    const sy = curve(ry), sx = curve(rx);
    if (el && (sy || sx)) {
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX: sx * 900 * dt, deltaY: sy * 900 * dt });
      if (el.dispatchEvent(wheel)) {
        for (let s: Element | null = el; s; s = s.parentElement) {
          const css = getComputedStyle(s);
          if (/(auto|scroll)/.test(css.overflowY + css.overflowX) && (s.scrollHeight > s.clientHeight || s.scrollWidth > s.clientWidth)) {
            s.scrollBy(sx * 900 * dt, sy * 900 * dt);
            break;
          }
        }
      }
    }
  }
}
