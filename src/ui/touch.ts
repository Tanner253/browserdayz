// On-screen controls for phones and tablets. They drive the same Input the keyboard
// and mouse do, so nothing in the game knows the difference: the left thumb is WASD
// (a light push walks, a full push jogs, pushed past the ring sprints), the right
// thumb is the mouse, and the buttons are the keys.
//
// Every key the game reads has something here, or on the HUD, that a finger can do:
//   fire, aim, reload, jump (and the handbrake), crouch    buttons by the right thumb
//   1-4 and 5-8                                            the bar at the bottom: tap a slot
//   the mouse wheel                                        Swap (the next weapon carried)
//   X                                                      tap the slot that is in the hands
//   F                                                      Use, when there is something to use
//   G                                                      a second button beside Use, when G would do something
//   Q and E                                                the two lean buttons, while aiming
//   T                                                      the speech button: a list to tap from
//   Enter, Tab, Esc, M                                     chat, the pack, the menu, a tap on the map

import type { Input } from '../core/input';
import { EMOTES } from '../sim/emotes';

/** joystick travel in pixels: the ring's radius */
const R = 56;
/** mouse pixels per pixel of finger travel */
const LOOK = 1.55;

/** the finger that came down here keeps talking to this element wherever it goes (where the browser will have it) */
const capture = (el: HTMLElement, id: number) => {
  try {
    el.setPointerCapture(id);
  } catch {
    /* a pointer that is already gone */
  }
};

const icon = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export interface TouchActions {
  menu(): void;
  inventory(): void;
  /** the next weapon carried (what the mouse wheel does) */
  swap(): void;
  /** something off the wheel, by its id */
  emote(id: string): void;
  chat(): void;
}

export class TouchControls {
  private root: HTMLDivElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private act2: HTMLElement;
  private keys = new Set<string>();
  private stick: { id: number; x: number; y: number } | null = null;
  private drags = new Map<number, { x: number; y: number }>();
  private aiming = false;
  private visible = false;
  private held = new Set<string>();

  constructor(private input: Input, private on: TouchActions) {
    this.root = document.createElement('div');
    this.root.className = 'tc';
    this.root.innerHTML = `
      <div class="tc-move"><div class="tc-base"><i></i><div class="tc-knob"></div></div></div>
      <div class="tc-look"></div>
      <div class="tc-top">
        <button class="tc-b" data-act="menu" aria-label="Menu">${icon('<path d="M4 7h16M4 12h16M4 17h16"/>')}</button>
        <button class="tc-b" data-act="inv" aria-label="Inventory">${icon('<path d="M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2"/>')}</button>
        <button class="tc-b" data-act="chat" aria-label="Chat">${icon('<path d="M4 5h16v11H9l-5 4z"/>')}</button>
        <button class="tc-b" data-act="emotes" aria-label="Call out">${icon('<path d="M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>')}</button>
      </div>
      <button class="tc-b tc-use" data-key="KeyF" aria-label="Use">${icon('<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2.4-4.3a1.5 1.5 0 0 1 2.6-1.5L8 14"/>')}</button>
      <button class="tc-b tc-act2" data-key="KeyG"></button>
      <button class="tc-b tc-fire" data-hold="Mouse0" aria-label="Fire">${icon('<circle cx="12" cy="12" r="6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>')}</button>
      <button class="tc-b tc-aim" data-toggle="Mouse2">Aim</button>
      <button class="tc-b tc-reload" data-key="KeyR" aria-label="Reload">${icon('<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"/>')}</button>
      <button class="tc-b tc-jump" data-hold="Space" aria-label="Jump">${icon('<path d="M12 19V6M6 11l6-6 6 6"/>')}</button>
      <button class="tc-b tc-crouch" data-key="KeyC" aria-label="Crouch">${icon('<path d="M12 5v13M6 13l6 6 6-6"/>')}</button>
      <button class="tc-b tc-swap" data-act="swap" aria-label="Next weapon">${icon('<path d="M4 8h13l-3-3M20 16H7l3 3"/>')}</button>
      <button class="tc-b tc-lean tc-lean-l" data-hold="KeyQ" aria-label="Lean left">${icon('<path d="M14 6l-6 6 6 6"/>')}</button>
      <button class="tc-b tc-lean tc-lean-r" data-hold="KeyE" aria-label="Lean right">${icon('<path d="M10 6l6 6-6 6"/>')}</button>
      <div class="tc-emotes">${EMOTES.map((e) => `<button class="tc-e" data-emote="${e.id}">${e.label}</button>`).join('')}</div>
      <button class="tc-b tc-close" data-act="inv">Close</button>`;
    document.getElementById('ui')!.appendChild(this.root);
    this.base = this.root.querySelector('.tc-base') as HTMLElement;
    this.knob = this.root.querySelector('.tc-knob') as HTMLElement;
    this.act2 = this.root.querySelector('.tc-act2') as HTMLElement;
    this.bindStick(this.root.querySelector('.tc-move') as HTMLElement);
    this.bindLook(this.root.querySelector('.tc-look') as HTMLElement);
    for (const b of this.root.querySelectorAll<HTMLElement>('.tc-b')) this.bindButton(b);
    // the list of things to call out: a tap on one says it and puts the list away
    const list = this.root.querySelector('.tc-emotes') as HTMLElement;
    list.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = (e.target as HTMLElement).closest<HTMLElement>('.tc-e')?.dataset.emote;
      this.root.classList.remove('emo');
      if (id) this.on.emote(id);
    });
  }

  /**
   * Called every frame.
   * @param playing the player has control (not in a menu, not dead)
   * @param inventory the inventory screen is open (it gets a Close button)
   * @param canUse there is something in reach to take, open or search
   * @param also what G would do here, in a word ("Fuel", "Pack up"): it gets a button of its own; and whether the gun is at the eye
   */
  update(playing: boolean, inventory: boolean, canUse: boolean, also: { g: string | null; aiming: boolean } = { g: null, aiming: false }) {
    if (playing !== this.visible) {
      this.visible = playing;
      this.root.classList.toggle('on', playing);
      if (!playing) this.letGo();
    }
    this.root.classList.toggle('bag', inventory);
    this.root.classList.toggle('use', playing && canUse);
    this.root.classList.toggle('g', playing && !!also.g);
    if (also.g && this.act2.textContent !== also.g) this.act2.textContent = also.g;
    this.root.classList.toggle('ads', playing && also.aiming);
  }

  /** nothing stays held when the controls leave the screen */
  private letGo() {
    this.setKeys(new Set());
    this.stick = null;
    this.drags.clear();
    this.base.classList.remove('live');
    this.base.style.cssText = '';
    this.knob.style.transform = '';
    for (const k of this.held) this.input.simulate(k, false);
    this.held.clear();
    this.root.querySelectorAll('.tc-b.down').forEach((b) => b.classList.remove('down'));
    this.root.classList.remove('emo');
    if (this.aiming) {
      this.aiming = false;
      this.input.simulate('Mouse2', false);
    }
  }

  private setKeys(want: Set<string>) {
    for (const k of this.keys) if (!want.has(k)) this.input.simulate(k, false);
    for (const k of want) if (!this.keys.has(k)) this.input.simulate(k, true);
    this.keys = want;
  }

  private bindStick(zone: HTMLElement) {
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick) return;
      e.preventDefault();
      capture(zone, e.pointerId);
      // the stick appears under the thumb, wherever it lands
      const r = zone.getBoundingClientRect();
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.base.classList.add('live');
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.style.bottom = 'auto';
    });
    zone.addEventListener('pointermove', (e) => {
      const s = this.stick;
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      const raw = Math.hypot(dx, dy);
      const reach = Math.min(raw, R * 1.5);
      const ux = raw ? dx / raw : 0, uy = raw ? dy / raw : 0;
      this.knob.style.transform = `translate(${ux * reach}px, ${uy * reach}px)`;
      const want = new Set<string>();
      if (raw > R * 0.2) {
        if (uy < -0.38) want.add('KeyW');
        if (uy > 0.38) want.add('KeyS');
        if (ux < -0.38) want.add('KeyA');
        if (ux > 0.38) want.add('KeyD');
        if (raw < R * 0.55) want.add('AltLeft');
        else if (raw > R * 1.25 && uy < -0.6) want.add('ShiftLeft');
      }
      this.base.classList.toggle('run', want.has('ShiftLeft'));
      this.setKeys(want);
    });
    const end = (e: PointerEvent) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null;
      this.setKeys(new Set());
      this.base.classList.remove('live', 'run');
      this.base.style.cssText = '';
      this.knob.style.transform = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  /** a finger dragging on this element turns the view (the look area, and the fire button) */
  private bindLook(el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // (the list of calls is put away by a touch anywhere else)
      this.root.classList.remove('emo');
      capture(el, e.pointerId);
      this.drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    el.addEventListener('pointermove', (e) => {
      const d = this.drags.get(e.pointerId);
      if (!d) return;
      this.input.look((e.clientX - d.x) * LOOK, (e.clientY - d.y) * LOOK);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    const end = (e: PointerEvent) => this.drags.delete(e.pointerId);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private bindButton(b: HTMLElement) {
    const { hold, key, toggle, act } = b.dataset;
    if (hold) {
      // held like a mouse button or a key, and the same thumb keeps aiming while it is down
      this.bindLook(b);
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        b.classList.add('down');
        this.held.add(hold);
        this.input.simulate(hold, true);
      });
      const up = () => {
        b.classList.remove('down');
        this.held.delete(hold);
        this.input.simulate(hold, false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      return;
    }
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (act !== 'emotes') this.root.classList.remove('emo');
      if (key) {
        b.classList.add('down');
        this.input.simulate(key, true);
        setTimeout(() => {
          this.input.simulate(key, false);
          b.classList.remove('down');
        }, 90);
      } else if (toggle) {
        this.aiming = !this.aiming;
        b.classList.toggle('down', this.aiming);
        this.input.simulate(toggle, this.aiming);
      } else if (act === 'menu') this.on.menu();
      else if (act === 'inv') this.on.inventory();
      else if (act === 'swap') this.on.swap();
      else if (act === 'chat') this.on.chat();
      else if (act === 'emotes') this.root.classList.toggle('emo');
    });
  }
}
