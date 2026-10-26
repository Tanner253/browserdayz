// A controller (PlayStation, Xbox, any the browser calls "standard"), read each frame, pressing the game's own
// controls by their names as the keyboard and the phone's buttons do (src/core/input.ts). Laid out as Call of Duty's
// default (the owner, 2026-10-15: "make sure that the buttons map similar to default COD and that all of our
// functionality is maintained"): what that layout has no button for (leaning, the light, the map) is where a shooter's
// player looks for it. Switched on in Settings, Controls ("settings to enable this in the settings menu"). The bumpers
// go along the hot bar, things as well as guns, and the sticks clicked lean while aiming, as Rainbow Six Siege's do (the
// owner, 2026-10-18: "copy R6 for how to lean on controller then fill in the empty spot with the switch slots"; "using r1
// and r2 is the best for switching items ... more important than leaning left and right"; their tester, with food,
// drink and a bandage on 4 to 6: "i have no way to switch to the items").
//
// Each thing is on the button the player puts it on in Settings (src/core/pad-layout.ts, src/ui/pad-binds.ts), and a
// PlayStation pad the browser does not lay out as standard is read into the standard's places (the owner, 2026-10-26:
// "controllers have asked for key remapping"; "the playstation control has been not working, the ps4 pad").
//
// In play the sticks move and look. Anywhere else (the menu, the inventory, the map, Emotes, the dead screen) the left
// stick steers a cursor of its own: ✕ clicks, held it drags, ○ goes back, the right stick scrolls.

import { B, PAD_BUTTONS, buttonName, padButtons, padKind, pickPad, readPad, type PadKind, type PadRead } from './pad-layout';
import { controls } from './keys';

/** how far a stick is pushed before it counts; past `walk` it jogs */
const DEAD = 0.16, WALK = 0.62;

/** a thing in Settings waiting for a button to be put on (src/ui/pad-binds.ts): the next button pressed is its, and nothing else hears of it */
export const padCapture: { want: ((btn: number) => void) | null } = { want: null };
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
  /** △: the next gun carried, never empty hands (as the phone's button); false when no gun is carried */
  swap(): boolean;
  /** the bumpers: the key of the next (1) or last (-1) hot-bar slot with something on it, from what is in the hands */
  hotStep(dir: 1 | -1): string | null;
  look(): { sens: number; invert: boolean };
  /** the mouse's own speed: the stick's is its own */
  mouseSens(): number;
  note(text: string): void;
}

interface Input {
  pad: boolean;
  /** when the controller was last used (see Input.keyAt) */
  padAt: number;
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
  /** leaned by a stick's click while aiming: left -1, right 1 */
  private lean: -1 | 0 | 1 = 0;
  /** L3 went down with the sights up (a click of it then leans; a sprint begun before is not a lean) */
  private l3Aimed = false;
  /** whose names the buttons go by, on the screen */
  private kind: PadKind = 'ps';
  /** a button taken for Settings is let go before the pad acts again */
  private swallow = false;
  /** the bindings the hot bar's ends were last written for */
  private ends: Record<string, number> | null = null;
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
    // (the pad in the hands, of what the browser lists, read into the standard layout whatever it made of it: a
    // PlayStation pad over Bluetooth or under Firefox is laid out its own way, and was read as if it were not)
    const gp = this.host.on() ? pickPad([...(navigator.getGamepads?.() ?? [])]) : null;
    if (!gp) {
      if (this.holding.size) this.letGo();
      this.showCursor(false);
      return;
    }
    const read = readPad(gp, navigator.platform), pressed = read.pressed;
    const any = pressed.some(Boolean) || read.axes.some((a) => Math.abs(a) > 0.5);
    if (any) this.input.padAt = performance.now();
    // (Sony's vendor id or names: the buttons go by PlayStation's names on the screen, Xbox's otherwise)
    const kind = padKind(gp.id), keys = controls().padKeys;
    if (kind !== this.kind || keys !== this.ends || document.body.dataset.pad !== kind) {
      document.body.dataset.pad = this.kind = kind;
      this.ends = keys;
      // (the hot bar's ends say the buttons that go along it, wherever the player has put them)
      const K = padButtons(keys), st = document.body.style;
      st.setProperty('--pad-prev', JSON.stringify(buttonName(K.prev, kind)));
      st.setProperty('--pad-next', JSON.stringify(buttonName(K.next, kind)));
    }
    if (any && !this.input.pad) {
      this.input.pad = true;
      document.body.classList.add('pad');
    }
    // (Settings waiting for a button: the next one pressed is its, and the pad does nothing more until it is let go)
    if (padCapture.want) {
      const i = PAD_BUTTONS.find((k) => pressed[k] && !this.was[k]);
      if (i !== undefined) {
        const want = padCapture.want;
        padCapture.want = null;
        this.swallow = true;
        want(i);
      }
      this.was = pressed;
      return;
    }
    if (this.swallow) {
      this.was = pressed;
      if (pressed.some(Boolean)) return;
      this.swallow = false;
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
      this.play(read.axes, dt, down, went, up, heldFor);
    } else {
      if (this.holding.size) this.letGo();
      this.menus(read.axes, dt, went, up);
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
    this.lean = 0;
  }

  private play(axes: PadRead['axes'], dt: number, down: (i: number) => boolean, went: (i: number) => boolean, up: (i: number) => boolean, heldFor: (i: number) => number) {
    const [lx, ly, rx, ry] = axes;
    // (each thing on the button the player put it on: Settings, Controls)
    const K = padButtons(controls().padKeys);
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
    this.hold('Mouse2', down(K.aim));
    this.hold('Mouse0', down(K.fire));
    const riding = this.host.riding(), aiming = down(K.aim);
    // L3: sprint, kept up until the stick comes back or the sights go up. In a seat, the horn. Aiming, as Siege leans, a
    // click of either stick leans to its side and stays leaned until it is clicked again, the other is, or the sights
    // come down (held in, a stick is no stick to aim or walk with). L3 held instead holds the breath, as Call of Duty's
    // does (a full pull of L2 held it, which nearly every pull of an aim is).
    if (riding) this.hold('KeyH', down(K.sprint));
    else {
      if (went(K.sprint)) {
        this.sprint = !aiming;
        this.l3Aimed = aiming;
      }
      if (!moving || ly > -0.3 || aiming) this.sprint = false;
      if (heldFor(K.sprint) > HOLD) this.second.add(K.sprint);
      if (up(K.sprint) && this.l3Aimed && aiming && !this.second.has(K.sprint)) this.lean = this.lean === -1 ? 0 : -1;
      this.hold('ShiftLeft', this.sprint || (aiming && down(K.sprint) && this.second.has(K.sprint)));
    }
    // R3: the light; aiming, the lean to the right; in a seat, the siren
    if (went(K.light)) {
      if (riding) this.tap('KeyJ');
      else if (aiming) this.lean = this.lean === 1 ? 0 : 1;
      else this.tap('KeyL');
    }
    if (!aiming || riding) this.lean = 0;
    // ✕ jump (the helicopter: up)
    this.hold('Space', down(K.jump));
    // ○ crouch, held lie down (the helicopter: down)
    if (riding) this.hold('KeyC', down(K.crouch));
    else {
      if (went(K.crouch)) this.tap('KeyC');
      this.second2(K.crouch, heldFor, () => this.tap('KeyZ'));
    }
    // □ reload, or take · doors · search when there is something in front (held, as the key is held)
    if (went(K.use)) this.squareDoes = this.host.facing() ? 'KeyF' : 'KeyR';
    if (this.squareDoes) {
      if (this.squareDoes === 'KeyR') {
        this.tap('KeyR');
        this.squareDoes = 'done';
      } else if (this.squareDoes === 'KeyF') this.hold('KeyF', down(K.use));
      if (up(K.use)) {
        this.hold('KeyF', false);
        this.squareDoes = null;
      }
    }
    // △ the next gun carried, gun to gun as Call of Duty's and the phone's button go (it went by the wheel, which stops
    // on empty hands: the tester, "if i press it again it just unselects it"); held, empty hands
    const [l1, r1] = [buttonName(K.prev, this.kind), buttonName(K.next, this.kind)];
    if (up(K.swap) && !this.second.has(K.swap) && !this.host.swap()) this.host.note(`No gun carried: ${l1} and ${r1} go along your hot bar`);
    this.second2(K.swap, heldFor, () => this.tap('KeyX'));
    // bumpers: along the hot bar to the next slot with something on it (R1) or the one before (L1), guns and things
    // alike, as the number keys bring them up (the wheel only goes through the guns). Aiming, they turn a scope that
    // turns, as the wheel does, R1 nearer. In a seat they roll the helicopter, as Q and E do.
    if (riding) {
      this.hold('KeyQ', down(K.prev));
      this.hold('KeyE', down(K.next));
    } else {
      this.hold('KeyQ', this.lean === -1);
      this.hold('KeyE', this.lean === 1);
      for (const [i, dir] of [[K.prev, -1], [K.next, 1]] as const) {
        if (!went(i)) continue;
        if (aiming) this.input.wheel -= dir;
        else {
          const code = this.host.hotStep(dir);
          if (code) this.tap(code);
        }
      }
    }
    // the D-pad: ↑ the map; ↓ the call-out wheel, held (the right stick picks); ← single shots or automatic, held drops
    // what is held; → look the gun over, held talks
    if (went(K.map)) this.tap('KeyM');
    this.hold('KeyT', down(K.callout));
    if (up(K.mode) && !this.second.has(K.mode)) this.tap('KeyB');
    this.hold('KeyG', down(K.mode) && heldFor(K.mode) > 0.15);
    if (up(K.inspect) && !this.second.has(K.inspect)) this.tap('KeyI');
    this.hold('KeyV', down(K.inspect) && heldFor(K.inspect) > 0.2);
    if (heldFor(K.mode) > HOLD) this.second.add(K.mode);
    if (heldFor(K.inspect) > 0.2) this.second.add(K.inspect);
    // the inventory (and the touchpad, while nothing else is put on it); the menu
    if (went(K.inventory) || (went(B.pad) && !Object.values(K).includes(B.pad))) this.tap('Tab');
    if (went(K.menu)) this.input.unlock();
    for (const i of [K.swap, K.crouch, K.mode, K.inspect, K.sprint]) if (up(i)) this.second.delete(i);
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

  private menus(axes: PadRead['axes'], dt: number, went: (i: number) => boolean, up: (i: number) => boolean) {
    this.showCursor(true);
    const [lx, ly, rx, ry] = axes;
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
