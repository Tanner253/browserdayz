// DayZ-style inventory. Three columns:
//   Vicinity   what is on the ground around you, and the crate / stash / body you opened
//   Character  the survivor with the places for what is worn either side of them (the rules'
//              own list, DOLL_SLOTS), the hands and the weapon slots underneath, the tags
//   Carried    every cargo grid you have right now, in the order the places stand in, each
//              under its name and where it is worn; fixed under them, the inspector and
//              the body's state
// Drag & drop with rotation (R), right-click for everything an item can do, and three clicks
// that each mean one thing wherever the thing lies and whatever else is open (see `useIt`,
// `wield`, `across`): double-click uses it, Alt-click wears or holds it (or takes it off),
// Ctrl-click moves it across (ground or crate to you, you to the open crate). Shift-click is
// the quick move it always was. Hover + a number puts it on that key, hover + G drops it.
// Pointing at a thing shows a card by the pointer saying what it is, at once. Nothing is
// refused without a line saying why (see `refusal`, `noRoom`, `noRoomIn`), and what has no
// place to go is put in the hands if they are empty, else on the ground, and that is said.
// (2026-10-13: "we should also upgrade the user inventory ensuring all items are properly
// bright and seeable in the inventory and that the UX of the inventory and how all the
// inventory management works is intuitive".)
// While something is being dragged every place it can go is lit: the
// slots that take it, the grids with room, the survivor (drop it anywhere on them to wear,
// equip, use or take it) and the ground (the whole left column). Over a grid the outline is where it will land,
// which is the nearest free spot to the pointer, not only the cell under it.

import { DOLL_SLOTS, GEAR_SLOTS, ITEMS, SLOT_KIND, SLOT_LABEL, TAG_HOLD_MIN, WEAPON_SLOTS, makeItem, type AttachSlot, capacityOf, handlingOf, itemName, itemWeight, magRoom, tagClock, tagOwner, type ItemInstance, type Slot, holds } from '../sim/items';
import { Container, bagGrid, splitPile, swapPlaces, type PlayerInventory } from '../sim/inventory';
import { LOAD, breathOf, heavy, paceOf } from '../sim/load';
import type { WorldItem, Stash } from '../game/loot';
import type { Vitals } from '../game/player';
import type { DollBox as FigureBox } from '../game/doll';

const CELL = 46;

export interface InvActions {
  /** remove a world item from the ground and hand it over */
  take(w: WorldItem): ItemInstance | null;
  drop(item: ItemInstance): void;
  use(item: ItemInstance): void;
  /** open a sealed ammo box */
  open(item: ItemInstance): void;
  /** eat, drink, apply or open a thing where it lies, without it having to be picked up and put away first */
  onGround(w: WorldItem, how: 'use' | 'open'): void;
  /** take the rounds out of a weapon */
  unload(item: ItemInstance): void;
  /** carried weapons this attachment can be fitted to right now */
  attachTargets(att: ItemInstance): ItemInstance[];
  attach(att: ItemInstance, weapon: ItemInstance): void;
  /** @param loose the part is handed back, to be put where it was let go, and not put away in a pocket */
  detach(weapon: ItemInstance, mod: string, loose?: boolean): ItemInstance | null;
  /** push loose rounds into a magazine, one at a time, for as long as the hands are left to it */
  fillMag(mag: ItemInstance): void;
  /** the rounds out of a magazine, loose into the pockets */
  emptyMag(mag: ItemInstance): void;
  /** how many loose rounds are carried of the kind this magazine holds */
  looseFor(mag: ItemInstance): number;
  /** put this thing on hot key i (0: the key 1 ... 9: the key 0), or with null clear that key */
  assignHot(item: ItemInstance | null, i: number): void;
  /** the hot key this thing is on (0-9), or -1 */
  hotIndex(item: ItemInstance): number;
  /**
   * take a thing into the hands: what is then done with it is done with the left button, out of this screen
   * @param loose it is carried nowhere (just taken off the ground or out of a crate, with no room for it): held, and nothing else
   */
  hold(item: ItemInstance, loose?: boolean): void;
  /** a thing held loose is let go of by the hands, to be put where it was dragged to */
  release(item: ItemInstance): void;
  /** what is in the hands */
  inHands(): ItemInstance | null;
  changed(): void;
  sound(kind: 'pickup' | 'drop' | 'move'): void;
  /** a line said to the player */
  note(text: string): void;
}

type Source =
  | { kind: 'container'; c: Container; item: ItemInstance }
  | { kind: 'slot'; slot: Slot; item: ItemInstance }
  | { kind: 'ground'; w: WorldItem; item: ItemInstance }
  // (in the hands and carried nowhere: see `hold`)
  | { kind: 'loose'; item: ItemInstance }
  // (a part fitted to a gun, dragged off it: `item` is only its picture until it is let go, when the game hands the part itself back)
  | { kind: 'fitted'; weapon: ItemInstance; mod: string; item: ItemInstance };

/** the places on a gun that take a part, in the order they are shown under it */
const PARTS: [AttachSlot, string][] = [['magazine', 'Magazine'], ['optic', 'Optic'], ['muzzle', 'Muzzle'], ['grip', 'Grip'], ['light', 'Light'], ['wrap', 'Stock']];

interface Drag {
  src: Source;
  ghost: HTMLDivElement;
  rot: boolean;
  /** grab offset inside the item, in the inventory's own (unzoomed) pixels */
  offX: number;
  offY: number;
}

interface Action {
  label: string;
  run: () => void;
  primary?: boolean;
}

/** what one of the three clicks does with a thing where it lies (and what to call it), or why it does nothing */
type Deed = { label: string; run: () => void } | { why: string };

/** where a thing being dragged is held over */
type Target =
  | { kind: 'grid'; el: HTMLElement; id: string }
  | { kind: 'part'; el: HTMLElement; gun: string }
  | { kind: 'hot'; el: HTMLElement; i: number }
  | { kind: 'hands'; el: HTMLElement }
  | { kind: 'slot'; el: HTMLElement; slot: Slot }
  | { kind: 'ground'; el: HTMLElement }
  | { kind: 'pockets'; el: HTMLElement }
  | { kind: 'char'; el: HTMLElement }
  | { kind: 'out'; el: HTMLElement };

type Def = (typeof ITEMS)[string];

/** the kinds of thing, in plain words (the rules' own names for them are not all words a player uses) */
const KIND: Record<string, string> = { weapon: 'Gun', ammo: 'Ammunition', magazine: 'Magazine', food: 'Food', drink: 'Drink', medical: 'Medical', melee: 'Hand weapon', tool: 'Tool', misc: 'Gear', stash: 'Storage', attachment: 'Gun part', clothing: 'Clothing' };
const kindOf = (d: Def) => KIND[d.category] ?? d.category;

/** what a player has typed (a name on a tag, on a body), made safe to put into markup */
const esc = (s: string) => s.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const things = (n: number) => (n === 1 ? '1 thing' : `${n} things`);
/** said when a thing lying about is reached for and is not there */
const GONE = 'It is not there to take any more';
const pct = (k: number) => Math.round(k * 100);

/** Is it eaten, drunk or put on a wound: used up then and there? (Not what is thrown, looked through or called with: those are used from the hands.) */
const eaten = (d: Def) => !!d.use && !d.throw && !d.call && !d.look;
/** what using such a thing is called */
const useWord = (d: Def) => (d.use?.sound === 'eat' ? 'Eat it' : d.use?.sound === 'drink' ? 'Drink' : d.use?.sound === 'smoke' ? 'Smoke one' : 'Use it');
/** what putting a thing in its place on the body is called */
const wearWord = (d: Def) => (d.category === 'clothing' ? 'Wear it' : d.slot === 'holster' ? 'Holster it' : 'Sling it on your back');
/** can it be held in the hands and carried nowhere else? (A gun, a thing to hit with and clothes need a place: see `takeUp` in src/game/game.ts.) */
const holdable = (d: Def) => d.category !== 'clothing' && !d.weapon && !d.melee;

/**
 * What a thing does, in a few words, read off the rules so that it is never out of step with them: the line under
 * its name on the card by the pointer.
 */
function does(d: Def): string {
  const o: string[] = [];
  const u = d.use;
  if (u?.health) o.push(`+${u.health} health`);
  if (u?.stopBleed) o.push('stops bleeding');
  if (u?.splint) o.push('sets a broken leg');
  if (u?.blood) o.push(`+${u.blood} ml of blood`);
  if (u?.energy) o.push(`${u.energy > 0 ? '+' : '−'}${Math.abs(u.energy)} energy`);
  if (u?.water) o.push(`${u.water > 0 ? '+' : '−'}${Math.abs(u.water)} water`);
  if (u?.stamina) o.push('fills your stamina');
  if (u?.boost) o.push(`${u.boost} s in which nothing costs breath`);
  if (u?.sips) o.push(`${u.sips} drinks, filled again at a well`);
  if (d.look) o.push(`brings things ${Math.round(1 / d.look)}× closer`);
  if (d.throw) o.push(`thrown: it goes off ${d.throw.fuse} s after`);
  if (d.call) o.push('calls a supply drop down, under open sky');
  if (d.weapon) o.push(`fires ${ITEMS[d.weapon.ammo]?.name ?? d.weapon.ammo}`);
  if (d.mag) o.push(`holds ${d.mag.capacity} × ${ITEMS[d.mag.ammo]?.name ?? d.mag.ammo}`);
  if (d.melee) o.push(`hits for ${d.melee.damage}`);
  if (d.open) o.push(`${d.open.qty} × ${ITEMS[d.open.gives]?.name ?? d.open.gives} inside`);
  if (d.wear?.cargo) o.push(`${d.wear.cargo[0]}×${d.wear.cargo[1]} of room in it`);
  if (d.wear?.armor) o.push(`chest hits −${pct(1 - d.wear.armor)}%`);
  if (d.wear?.head) o.push(`head hits −${pct(1 - d.wear.head)}%`);
  if (d.wear?.fall) o.push(`falls hurt −${pct(1 - d.wear.fall)}%`);
  if (d.wear?.fist) o.push(`punches +${d.wear.fist}`);
  if (d.wear?.gas) o.push('keeps the gas out');
  if (d.stash) o.push(`${d.stash[0]}×${d.stash[1]} of room in it`);
  if (d.attach?.quiet) o.push('quiets the shot');
  if (d.attach?.recoil) o.push(`kick −${pct(1 - d.attach.recoil)}%`);
  if (d.attach?.ergo) o.push(`handling ${d.attach.ergo > 0 ? '+' : '−'}${Math.abs(d.attach.ergo)}`);
  return o.join(' · ');
}

export class InventoryUI {
  root: HTMLDivElement;
  isOpen = false;
  icons: Record<string, string> = {};
  /** portrait of the survivor for the paper doll */
  doll = '';
  /**
   * The same survivor alive (src/game/doll.ts), where the game has made one: drawn each frame on the game's own
   * picture, behind this page, and seen through a hole left for it in the page's dark veil (the end of hud.css).
   * A drag on it turns it. Until it is made, and where it is never made (it failed, or the phone has too little
   * to spare), the still picture above is what is shown.
   */
  figure: { alive: boolean; grab(): void; turn(by: number): void; drop(): void; front(): void } | null = null;
  /** the drag that is turning the figure: which pointer it is, and where that last was */
  private turning: { id: number; x: number } | null = null;
  /** where the figure was last found on the page, when, and whether anything has happened since that may have moved it */
  private figBox: FigureBox | null = null;
  private figAt = 0;
  private figMoved = true;
  /** the figure was drawn on the last frame: the hole in the veil is open */
  private figLive = false;
  /** the dark veil behind everything, as two layers with the figure's hole in them (see the end of hud.css): shown in place of the inventory's own while the figure is drawn */
  private veil = [document.createElement('div'), document.createElement('div')];
  /** this player's public id: tells their own dog tag from the ones they took */
  selfId = '';
  private vicinity: WorldItem[] = [];
  private stash: Stash | null = null;
  private stashState = '';
  private selected: ItemInstance | null = null;
  /** the pockets and bags folded away (by their names): a click on the bar over one folds it, and opens it again */
  private folded = new Set<string>();
  private drag: Drag | null = null;
  private hoverOutline: HTMLDivElement;
  private vitals: Vitals | null = null;
  private hover: Source | null = null;
  private menu: HTMLDivElement | null = null;
  private dragStart = { x: 0, y: 0, moved: false };
  /**
   * The card by the pointer: what the thing pointed at is, said at once (the browser's own tip took a second, and
   * said only a name); and, while a thing is dragged, why it will not go where it is held.
   */
  private card: HTMLDivElement;
  private cardSrc: Source | null = null;
  /** which thing each drawn element is, so that what is under the pointer is found again when everything has been drawn afresh */
  private bound = new WeakMap<Element, Source>();
  /** where the pointer is, and whether it is a mouse (a finger does not hover, and gets no card) */
  private at = { x: 0, y: 0, mouse: false };
  /** when Ctrl-click last moved a thing: on a Mac the same click also asks for the menu, which is not wanted then */
  private ctrlAt = 0;
  /**
   * The last press on a thing: which, when and where. A second on the same thing, straight after and in the same
   * spot, is a double-click, and is told here and not left to the browser: everything on the screen is made afresh
   * between the two presses, and the browser's own double-click is sent to what was pressed first, which is gone
   * by then. (A finger's two taps are told the same way.) `twiceAt` is when one was last told, so that the
   * browser's, where it does come, is not acted on as well.
   */
  private last = { uid: '', t: 0, x: 0, y: 0 };
  private twice: Source | null = null;
  private twiceAt = 0;
  /** the bags that have been shown open by themselves once (by their numbers): one shut by hand after that stays shut */
  private shown = new Set<string>();
  /**
   * Set by the game where what is carried weighs on a survivor (null: not told, and only the weight is shown). What
   * a load does is src/sim/load.ts: this screen shows what it leaves of a sprint, and marks one that slows the feet.
   * (It was the weight at which a load began to slow them, shown beside what was carried: the figure is no longer read.)
   */
  carryLimit: number | null = null;
  /** the survivor's state, the row of symbols the game has in its corner: the HUD's element (HUD.statusPanel), shown at the foot of what is carried */
  status: HTMLElement | null = null;
  /**
   * An admin's power (src/sim/powers.ts): what is carried weighs nothing, and never slows them. The game's to
   * say; with it on, the head of the carried side says so in place of a weight.
   */
  weightless = false;

  constructor(private inv: PlayerInventory, private actions: InvActions) {
    this.root = document.createElement('div');
    this.root.className = 'inv';
    document.getElementById('ui')!.appendChild(this.root);
    this.hoverOutline = document.createElement('div');
    this.hoverOutline.className = 'inv-outline';
    this.card = document.createElement('div');
    this.card.className = 'inv-card';
    window.addEventListener('pointermove', (e) => {
      this.at = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
      this.onMove(e);
      if (this.cardSrc && !this.drag) this.placeCard();
    });
    window.addEventListener('pointerup', (e) => this.onUp(e));
    // (Alt is one of the three clicks here, and let go by itself it takes the browser's own menu: not while this is open)
    window.addEventListener('keyup', (e) => {
      if (this.isOpen && e.key === 'Alt') e.preventDefault();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Alt') e.preventDefault();
      if (e.code === 'KeyR' && this.drag) {
        this.drag.rot = !this.drag.rot;
        this.styleGhost();
        // (the outline is drawn again where the pointer is: a key press says nothing of where that is)
        this.onMove({ clientX: this.at.x, clientY: this.at.y } as PointerEvent);
      }
      // hover an item and press G: it goes on the ground
      if (e.code === 'KeyG' && !this.drag && this.hover && this.hover.kind !== 'ground') {
        const src = this.hover;
        this.detach(src);
        this.actions.drop(src.item);
        this.finish('drop');
        return;
      }
      // point at anything carried and press a number: it goes on that hot key (1 to 9, and 0)
      const q = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(e.code);
      if (q >= 0 && !this.drag && this.hover && this.hover.kind !== 'ground' && this.carried(this.hover)) {
        this.actions.assignHot(this.hover.item, q);
        this.actions.sound('move');
        this.render();
      }
    });
    window.addEventListener('pointerdown', (e) => {
      if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
    });
    // The figure of the survivor is turned by a drag on it: pressed on the figure itself and nowhere else. A thing
    // in a place beside it is pressed on the thing, and that is a drag of the thing as it always was; and a thing
    // let go over the figure is let go on the survivor as before (that asks what is under the pointer, which is
    // the same as it was). A press twice turns it back to the front.
    const onFigure = (e: Event) => this.figLive && !this.drag && !!(e.target as Element | null)?.classList?.contains('doll-fig');
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !onFigure(e)) return;
      e.preventDefault();
      this.turning = { id: e.pointerId, x: e.clientX };
      this.root.classList.add('turning');
      this.figure?.grab();
    });
    window.addEventListener('pointermove', (e) => {
      const t = this.turning;
      if (!t || e.pointerId !== t.id) return;
      this.figure?.turn((e.clientX - t.x) / this.z);
      t.x = e.clientX;
    });
    const letGo = (e: PointerEvent) => {
      if (this.turning && e.pointerId === this.turning.id) this.figureLetGo();
    };
    window.addEventListener('pointerup', letGo);
    window.addEventListener('pointercancel', letGo);
    this.root.addEventListener('dblclick', (e) => {
      if (onFigure(e)) this.figure?.front();
    });
    this.veil[0].className = 'inv-veil';
    this.veil[1].className = 'inv-veil inv-veil-band';
    // (where the figure stands on the page is found again when the window is another size, or the column it is in is scrolled)
    window.addEventListener('resize', () => (this.figMoved = true));
    this.root.addEventListener('scroll', () => (this.figMoved = true), true);
    // (The hole is cut in a veil that blurs what is behind it. That the blur keeps to the veil's cut shape has been
    // seen in Chrome and what is built on it; elsewhere it has not, and a blur that did not would lie over the
    // figure. So elsewhere the veil is a plain dark one while the figure is shown, cut as any shape is cut.
    // `?veil=blur` asks for the blurred one anyway, to look.)
    const veil = new URLSearchParams(location.search).get('veil');
    if (veil === 'plain' || (veil !== 'blur' && !/Chrome\/\d/.test(navigator.userAgent))) this.root.classList.add('veil-plain');
  }

  private figureLetGo() {
    if (!this.turning) return;
    this.turning = null;
    this.root.classList.remove('turning');
    this.figure?.drop();
  }

  /**
   * Where the figure stands on the page, and what of that is in sight (its column scrolls): asked by whoever draws
   * it, each frame. Measured when something may have moved it, and now and then besides; the same answer is handed
   * back until it has, so that nothing is worked out twice for a figure that has not moved. The hole in the veil
   * is put where it is found.
   */
  figureBox(): FigureBox | null {
    if (!this.isOpen) return null;
    const now = performance.now();
    if (!this.figMoved && now - this.figAt < 400) return this.figBox;
    this.figMoved = false;
    this.figAt = now;
    const fig = this.root.querySelector<HTMLElement>('.doll-fig'), row = fig?.parentElement, col = fig?.closest<HTMLElement>('.inv-col');
    let box: FigureBox | null = null;
    const page = this.root.getBoundingClientRect(), z = this.z;
    if (fig && row && col) {
      const f = fig.getBoundingClientRect(), d = row.getBoundingClientRect(), c = col.getBoundingClientRect();
      // (the column's own inside: within its border, and clear of its scroll bar)
      const left = c.left + col.clientLeft * z, top = c.top + col.clientTop * z;
      // The hole is the whole row the figure stands in, the places for what is worn with it, and some way over:
      // what is in the figure's hands reaches behind those places when it is turned, and is not cut off at the
      // figure's own box. (The places lie over the hole as they lie over the veil. Over and under the row it is
      // wider than at its sides: the band the veil is laid in round its edge is not to lie over the figure's head
      // or its feet.)
      // (Its edges are on whole pixels of the screen, which are not always whole pixels of the page: the veil and
      // the band inside its edge are two layers that meet there, and meeting part way across a pixel they would
      // leave a hair of the world between them.)
      const dpr = window.devicePixelRatio || 1, up = (v: number) => Math.ceil(v * dpr) / dpr, down = (v: number) => Math.floor(v * dpr) / dpr;
      const l = up(Math.max(d.left - 8 * z, left)), t = up(Math.max(d.top - 28 * z, top));
      const r = down(Math.min(d.right + 8 * z, left + col.clientWidth * z)), b = down(Math.min(d.bottom + 28 * z, top + col.clientHeight * z));
      if (f.width >= 16 && f.height >= 16 && r - l >= 16 && b - t >= 16) {
        // (the veil, as the stylesheet has it for the figure: its colours, its blur, what colour it leaves and the band round the hole, each a number there)
        const css = getComputedStyle(this.root), said = (k: string) => css.getPropertyValue(k).split(',').map(Number);
        const from = said('--veil-in'), to = said('--veil-out'), [blur, sat, band, thins] = ['--veil-blur', '--veil-sat', '--veil-band', '--veil-ramp'].map((k) => said(k)[0]);
        if ([...from, ...to, blur, sat, band, thins].every(Number.isFinite) && from.length === 4 && to.length === 4) {
          box = { x: f.left, y: f.top, w: f.width, h: f.height, cx: l, cy: t, cw: r - l, ch: b - t, veil: { x: page.left, y: page.top, w: page.width, h: page.height, from, to, blur: blur * z, sat, band: band * z, thins: thins * z } };
        }
      }
    }
    const was = this.figBox;
    if (box && was && JSON.stringify(box) === JSON.stringify(was)) return was;
    this.figBox = box;
    // (said in the page's own measure, which is the screen's over the page's scale)
    const at = (v: number, from: number) => `${((v - from) / z).toFixed(4)}px`;
    for (const { style } of this.veil) {
      style.setProperty('--fig-l', box ? at(box.cx, page.left) : '0px');
      style.setProperty('--fig-t', box ? at(box.cy, page.top) : '0px');
      style.setProperty('--fig-r', box ? at(box.cx + box.cw, page.left) : '0px');
      style.setProperty('--fig-b', box ? at(box.cy + box.ch, page.top) : '0px');
    }
    return box;
  }

  /** Whether the figure was drawn this frame, said by whoever draws it: the hole in the veil is open for exactly as long as it is. */
  figureShown(on: boolean) {
    if (on === this.figLive) return;
    this.figLive = on;
    this.root.classList.toggle('fig-live', on);
    if (on) this.root.classList.add('fig-ready');
    else this.figureLetGo();
  }

  /** the whole screen is scaled with the window: on-screen pixels per inventory pixel */
  private get z() {
    const w = this.root.offsetWidth;
    return w ? this.root.getBoundingClientRect().width / w : 1;
  }

  open(vicinity: WorldItem[], stash: Stash | null, vitals: Vitals) {
    this.cancelDrag();
    this.vicinity = vicinity;
    this.stash = stash;
    this.stashState = '';
    this.vitals = vitals;
    this.isOpen = true;
    this.root.classList.add('show');
    this.render();
  }

  refresh(vicinity: WorldItem[], stash: Stash | null) {
    this.vicinity = vicinity;
    this.stash = stash;
    if (this.isOpen && !this.drag && !this.menu) this.render();
  }

  /** something it shows has changed that it was not told about through `refresh` (the figure of the survivor) */
  redraw() {
    if (this.isOpen && !this.drag && !this.menu) this.render();
  }

  /** a message in place of the open container's grid (waiting for the server), '' to show the grid */
  setStashState(text: string) {
    this.stashState = text;
    if (this.isOpen && !this.drag) this.render();
  }

  close() {
    this.isOpen = false;
    this.hover = null;
    this.closeMenu();
    this.cancelDrag();
    this.hideCard();
    this.figureLetGo();
    this.root.classList.remove('show');
  }

  // ------------------------------------------------------------ the card by the pointer

  private hideCard() {
    this.cardSrc = null;
    this.card.style.display = 'none';
    this.card.className = 'inv-card';
  }

  /** the card (or the line said while a thing is dragged) is put by the pointer: to its right and under it, or the other side where that would run off the screen */
  private placeCard() {
    const z = this.z, c = this.card;
    const r = c.getBoundingClientRect();
    let x = this.at.x + 18, y = this.at.y + 20;
    if (x + r.width > window.innerWidth - 8) x = this.at.x - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
    c.style.left = `${Math.max(8, x) / z}px`;
    c.style.top = `${Math.max(8, y) / z}px`;
  }

  private showCard(src: Source) {
    if (this.drag || this.menu || !this.at.mouse || src.kind === 'fitted') return;
    this.cardSrc = src;
    this.card.className = 'inv-card';
    this.card.innerHTML = this.cardHtml(src);
    this.card.style.display = 'block';
    this.placeCard();
  }

  /** while a thing is dragged: why it will not go where it is held, by the pointer ('' takes the line away) */
  private hint(text: string) {
    const c = this.card;
    if (!text) {
      if (c.classList.contains('hint')) this.hideCard();
      return;
    }
    this.cardSrc = null;
    c.className = 'inv-card hint';
    c.textContent = text;
    c.style.display = 'block';
    this.placeCard();
  }

  /**
   * What the card says of a thing: its name and kind, what it does in a line read off the rules, what it is in a
   * line or two of its own words, its weight, for a gun its rounds and what is fitted to it, and what each of the
   * three clicks would do with it where it lies (asked of the clicks themselves, so the card cannot say one thing
   * and a click do another).
   */
  private cardHtml(src: Source): string {
    const it = src.item, d = ITEMS[it.id];
    const rows: string[] = [];
    const row = (k: string, v: string) => rows.push(`<div><span>${k}</span><b>${v}</b></div>`);
    row('Weight', `${itemWeight(it).toFixed(2)} kg`);
    if (d.stack) row('In the pile', `${it.qty} of ${d.stack}`);
    if (d.use?.sips) row('Drinks left', `${it.left ?? d.use.sips} of ${d.use.sips}`);
    if (d.weapon) {
      row('Rounds', d.weapon.mag ? (it.mag ? `${it.loaded ?? 0} of ${magRoom(it)}` : `${it.loaded ?? 0}, and no magazine in it`) : `${it.loaded ?? 0} of ${capacityOf(it)}`);
      if (d.weapon.mag && it.mag) row('Magazine', ITEMS[it.mag]?.name ?? it.mag);
      row('Fitted', it.mods?.length ? it.mods.map((m) => ITEMS[m]?.name ?? m).join(', ') : 'Nothing');
    }
    if (d.mag) row('Rounds', `${it.rounds ?? 0} of ${d.mag.capacity}`);
    const room = holds(it.id);
    if (room) row('Inside', it.cargo?.length ? things(it.cargo.length) : 'Nothing');
    if (it.id === 'dogtag') row('Cashes in', it.pid === this.selfId ? 'never: it is yours' : this.counting(it) ? tagClock(it) : `after ${TAG_HOLD_MIN} min carried`);
    const key = this.actions.hotIndex(it);
    if (key >= 0) row('On key', String((key + 1) % 10));
    const lines: string[] = [];
    if (this.actions.inHands() === it) lines.push(src.kind === 'loose' ? 'In your hands and nowhere else: put away, it goes on the ground unless there is room for it.' : 'In your hands: used with the left button, held, once this is shut.');
    const clicks = ([['Double-click', this.useIt(src)], ['Alt-click', this.wield(src)], ['Ctrl-click', this.across(src)]] as [string, Deed][]).filter(([, k]) => 'label' in k).map(([name, k]) => `<span><b>${name}</b> ${esc((k as { label: string }).label)}</span>`);
    const what = does(d);
    const url = this.icons[it.id];
    return `<div class="card-head"><div class="card-img" style="${url ? `background-image:url(${url})` : ''}"></div><div><small>${kindOf(d)}${d.slot && d.category === 'clothing' ? ` · ${this.placeName(d)}` : ''}</small><b>${itemName(it)}</b></div></div>`
      + (what ? `<p class="card-does">${what}</p>` : '')
      + `<p class="card-desc">${d.desc}</p>`
      + `<div class="card-rows">${rows.join('')}</div>`
      + lines.map((l) => `<p class="card-note">${l}</p>`).join('')
      + (clicks.length ? `<div class="card-keys">${clicks.join('')}</div>` : '');
  }

  /** the name written on the place a thing is worn or slung in */
  private placeName(d: Def): string {
    const s = (Object.keys(SLOT_KIND) as Slot[]).find((k) => SLOT_KIND[k] === d.slot);
    return s ? SLOT_LABEL[s] : '';
  }

  // ------------------------------------------------------------ rendering

  /** carried tags whose countdown is on screen (by uid) */
  private clocks = new Map<string, ItemInstance>();

  private counting(item: ItemInstance) {
    return item.id === 'dogtag' && item.pid !== this.selfId && item.holder === this.selfId;
  }

  /** once a second while the inventory is open: move the countdowns on without redrawing everything */
  tickTags() {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-clock]')) {
      const it = this.clocks.get(el.dataset.clock!);
      if (it) el.textContent = tagClock(it);
    }
  }

  private tags(item: ItemInstance): string {
    const d = ITEMS[item.id];
    const t: string[] = [];
    if (d.stack) t.push(`<span class="qty">${item.qty}</span>`);
    if (d.use?.sips) t.push(`<span class="qty">${item.left ?? d.use.sips}/${d.use.sips}</span>`);
    // (a gun fed by a magazine: what is in it over what its magazine holds, or that it has none)
    if (d.weapon) t.push(`<span class="qty">${item.loaded ?? 0}/${d.weapon.mag ? (item.mag ? magRoom(item) : '–') : capacityOf(item)}</span>`);
    if (d.mag) t.push(`<span class="qty">${item.rounds ?? 0}/${d.mag.capacity}</span>`);
    if (item.mods?.length) t.push(`<span class="mods">+${item.mods.length}</span>`);
    if (item.cargo?.length) t.push(`<span class="qty">${item.cargo.length} in</span>`);
    // how full it is, as a line along its foot: a stack, a bottle, what is loaded in a gun
    const fill = d.stack ? item.qty / d.stack : d.use?.sips ? (item.left ?? d.use.sips) / d.use.sips : d.weapon ? (item.loaded ?? 0) / Math.max(1, d.weapon.mag ? magRoom(item) : capacityOf(item)) : d.mag ? (item.rounds ?? 0) / d.mag.capacity : -1;
    if (fill >= 0) t.push(`<span class="qbar${fill <= 0 ? ' none' : ''}"><i style="width:${Math.round(Math.min(1, fill) * 100)}%"></i></span>`);
    // somebody else's dog tag, carried: time left until it is cashed in
    if (this.counting(item)) {
      this.clocks.set(item.uid, item);
      t.push(`<span class="tagclock" data-clock="${item.uid}">${tagClock(item)}</span>`);
    }
    const qi = this.actions.hotIndex(item);
    if (qi >= 0) t.push(`<span class="qkey">${(qi + 1) % 10}</span>`);
    return t.join('');
  }

  private itemEl(item: ItemInstance, w: number, h: number, rot: boolean) {
    const d = ITEMS[item.id];
    const el = document.createElement('div');
    el.className = `inv-item cat-${d.category}` + (item === this.selected ? ' sel' : '');
    el.style.width = `${w * CELL - 2}px`;
    el.style.height = `${h * CELL - 2}px`;
    const img = document.createElement('div');
    img.className = 'inv-item-img';
    const url = this.icons[item.id];
    if (url) {
      if (rot) {
        // rotate the icon 90deg inside the rotated footprint
        img.style.width = `${h * CELL - 2}px`;
        img.style.height = `${w * CELL - 2}px`;
        img.style.transform = `translate(-50%, -50%) rotate(90deg)`;
        img.style.left = '50%';
        img.style.top = '50%';
        img.style.position = 'absolute';
      } else {
        img.style.inset = '0';
        img.style.position = 'absolute';
      }
      img.style.backgroundImage = `url(${url})`;
    }
    el.appendChild(img);
    el.insertAdjacentHTML('beforeend', this.tags(item));
    // (its name, and the rest, are on the card by the pointer: see `showCard`)
    return el;
  }

  /** @param rows how many of its rows are drawn, where that is not all of them (see where a body is drawn) */
  private gridEl(c: Container, rows = c.h) {
    const g = document.createElement('div');
    g.className = 'inv-grid';
    g.style.width = `${c.w * CELL}px`;
    g.style.height = `${rows * CELL}px`;
    g.dataset.container = c.id;
    for (const p of c.items) {
      const [w, h] = Container.size(p.item, p.rot);
      const el = this.itemEl(p.item, w, h, p.rot);
      el.style.left = `${p.x * CELL + 1}px`;
      el.style.top = `${p.y * CELL + 1}px`;
      this.bindItem(el, { kind: 'container', c, item: p.item });
      g.appendChild(el);
    }
    return g;
  }

  /**
   * The survivor's own dog tag, round their neck: shown, and that is all. It is not picked
   * up, moved or dropped; whoever kills them takes it off the body.
   */
  private neckEl() {
    const tag = this.inv.neck;
    if (!tag) return '';
    const url = this.icons[tag.id];
    return `<div class="inv-neck" title="Your own dog tag. It hangs round your neck: it cannot be moved or dropped, and whoever kills you takes it off your body."><div class="inv-item-img fit" style="${url ? `background-image:url(${url})` : ''}"></div><div><b>${itemName(tag)}</b><span>Round your neck · cannot be dropped</span></div></div>`;
  }

  /**
   * a grid with its bar over it, as DayZ has it: its name, how much of it is taken up, and a click folds it away
   * @param where the place on the body the thing it is the inside of is worn in, written small after its name
   */
  private gridBox(c: Container, where = '') {
    const box = document.createElement('div');
    const used = c.items.reduce((n, p) => n + ITEMS[p.item.id].w * ITEMS[p.item.id].h, 0);
    const shut = this.folded.has(c.id);
    // An admin's hold (src/sim/inventory.ts): it has no bottom, so there is no "of how many" to say of it. It says
    // how many things lie in it and whether it still takes any. It is drawn whole, as tall as what is in it and a
    // few rows more, and is scrolled to with everything else on this side; narrower than itself, it scrolls sideways.
    const hold = c === this.inv.theHold;
    // (A grid nine across or more, a Field Rucksack since 2026-10-13 and the hold, is wider than the narrower side
    // of this screen has room for when it is opened there, on a body: it is marked, and scrolls sideways by itself
    // wherever it stands in less room than it is wide. Nothing is ever off the edge.)
    box.className = 'inv-gridbox' + (shut ? ' shut' : '') + (hold ? ' inv-hold' : '') + (c.w >= 9 ? ' wide' : '');
    const said = hold ? `${c.items.length} thing${c.items.length === 1 ? '' : 's'} · ${this.inv.bottomless ? 'never fills' : 'shut'}` : c === this.inv.tags ? `${c.items.length} / ${c.w * c.h} · taken off others` : `${used} / ${c.w * c.h}`;
    const tip = hold ? (this.inv.bottomless ? 'An admin’s power is on: whatever finds no room in what you wear goes in here, and there is always room. /bottomless off puts it off. ' : 'The power is off: nothing more goes in here, and what is in it can be taken out. ') : '';
    box.innerHTML = `<h4 title="${tip}${shut ? 'Open it' : 'Fold it away'}"><i>${shut ? '▸' : '▾'}</i>${c.name}${where ? `<small>${where}</small>` : ''} <span>${said}</span></h4>`;
    box.querySelector('h4')!.addEventListener('click', () => {
      if (!this.folded.delete(c.id)) this.folded.add(c.id);
      this.render();
    });
    if (!shut) box.appendChild(this.gridEl(c));
    return box;
  }

  /** The hands: what is in them, and a place to let a thing go to take it into them. */
  private handsEl() {
    const s = document.createElement('div');
    const item = this.actions.inHands();
    s.className = 'inv-slot slot-inhands' + (item ? '' : ' empty');
    s.dataset.hands = '1';
    s.innerHTML = `<div class="slot-label">In your hands</div>`;
    if (item) {
      const el = document.createElement('div');
      el.className = 'inv-item in-slot' + (item === this.selected ? ' sel' : '');
      const url = this.icons[item.id];
      el.innerHTML = `<div class="inv-item-img fit" style="${url ? `background-image:url(${url})` : ''}"></div>${this.tags(item)}`;
      // (how it is used from here, and that one held loose is carried nowhere else, is said on its card: see `cardHtml`)
      const src0 = this.locate(item);
      if (src0?.kind === 'loose') s.classList.add('loose');
      const src = this.locate(item);
      if (src) this.bindItem(el, src);
      s.appendChild(el);
    }
    return s;
  }

  /**
   * The places on a gun that take a part, in a row under it: its magazine, its sight, its muzzle, its light, its
   * stock, whichever of them this gun has. What is fitted is shown in its place and is dragged off it; a part let
   * go on its place (or anywhere on the gun) is fitted. For anything that is not a gun the row is there and empty,
   * so that nothing under it moves when a gun is slung.
   */
  private partsEl(gun: ItemInstance | null) {
    const row = document.createElement('div');
    row.className = 'inv-parts';
    if (!gun || !ITEMS[gun.id].weapon) return row;
    const takes = new Set(Object.values(ITEMS).filter((d) => d.attach?.fits.includes(gun.id)).map((d) => d.attach!.slot));
    for (const [slot, label] of PARTS) {
      if (!takes.has(slot)) continue;
      const mod = slot === 'magazine' ? gun.mag ?? null : gun.mods?.find((m) => ITEMS[m]?.attach?.slot === slot) ?? null;
      const cell = document.createElement('div');
      cell.className = 'inv-part' + (mod ? '' : ' empty');
      cell.dataset.part = slot;
      cell.dataset.gun = gun.uid;
      const inMag = slot === 'magazine' && mod ? Math.max(0, (gun.loaded ?? 0) - ((gun.loaded ?? 0) > 0 ? 1 : 0)) : 0;
      cell.innerHTML = `<span>${label}</span>` + (mod ? `<div class="inv-item-img fit" style="background-image:url(${this.icons[mod] ?? ''})"></div>${slot === 'magazine' ? `<em>${inMag}/${ITEMS[mod].mag?.capacity ?? 0}</em>` : ''}` : '');
      cell.title = mod ? `${ITEMS[mod].name}: drag it off to take it off` : `${label}: drag one here`;
      if (mod) {
        cell.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          // (what is dragged is the part's picture: the part itself comes off when it is let go)
          const pic = makeItem(mod);
          if (ITEMS[mod].mag) pic.rounds = inMag;
          const ghost = document.createElement('div');
          ghost.className = 'inv-ghost';
          this.drag = { src: { kind: 'fitted', weapon: gun, mod, item: pic }, ghost, rot: false, offX: CELL / 2, offY: CELL / 2 };
          this.styleGhost();
          this.root.appendChild(ghost);
          this.dragStart = { x: e.clientX, y: e.clientY, moved: false };
          this.onMove(e);
        });
        cell.addEventListener('dblclick', () => {
          this.actions.detach(gun, mod);
          this.finish('move');
        });
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.cancelDrag();
          this.actions.detach(gun, mod);
          this.finish('move');
        });
      }
      row.appendChild(cell);
    }
    return row;
  }

  /**
   * The hot keys along the foot of the screen: what is on each, and a place to let a thing go to put it on one.
   * (Pointing at a thing and pressing the number does the same. A right-click on a key clears it.)
   */
  private hotEl() {
    const bar = document.createElement('div');
    bar.className = 'inv-hot';
    this.inv.hot.forEach((b, i) => {
      const it = b ? this.inv.hotItem(i) : null;
      const cell = document.createElement('div');
      cell.className = 'inv-hotkey' + (b ? (it ? '' : ' gone') : ' empty') + (it && it === this.actions.inHands() ? ' on' : '');
      cell.dataset.hot = String(i);
      const id = it?.id ?? b?.id;
      cell.innerHTML = `<b>${(i + 1) % 10}</b>${id ? `<div class="inv-item-img fit" style="background-image:url(${this.icons[id] ?? ''})"></div>` : ''}`;
      cell.title = id ? `${ITEMS[id].name}${it ? '' : ' (none carried)'} · right-click to clear` : `Key ${(i + 1) % 10}: drag a thing here, or point at it and press ${(i + 1) % 10}`;
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!b) return;
        this.actions.assignHot(null, i);
        this.actions.sound('move');
        this.render();
      });
      bar.appendChild(cell);
    });
    return bar;
  }

  /** the gun carried that has this number (the one a part's place belongs to) */
  private gunByUid(uid: string): ItemInstance | null {
    return this.inv.find((it) => it.uid === uid);
  }

  private slotEl(slot: Slot, hint = '') {
    const s = document.createElement('div');
    s.className = `inv-slot slot-${slot}`;
    s.dataset.slot = slot;
    const item = this.inv.slots[slot];
    // (the key it is on, if it is on one: the keys are bound to things and can be given to anything)
    const key = item ? this.actions.hotIndex(item) : -1;
    // (the number of its key is not written over a place on the body any more: the keys are along the foot of the page. 2026-10-11: "the floating numbers above the weapon and hand and back slots are not intuitive we can just remove them")
    void key;
    s.innerHTML = `<div class="slot-label">${SLOT_LABEL[slot]}${hint ? ` <b>${hint}</b>` : ''}</div>`;
    if (item) {
      const el = document.createElement('div');
      el.className = 'inv-item in-slot' + (item === this.selected ? ' sel' : '') + (this.actions.inHands() === item ? ' active' : '');
      // (what is worn has a picture of its own for where it is worn: see `slot:` in icons.ts)
      const url = this.icons[`slot:${item.id}`] ?? this.icons[item.id];
      el.innerHTML = `<div class="inv-item-img fit" style="${url ? `background-image:url(${url})` : ''}"></div>${this.tags(item)}`;
      this.bindItem(el, { kind: 'slot', slot, item });
      s.appendChild(el);
    } else {
      s.classList.add('empty');
      // An empty place shows, faintly, the shape of a thing that goes in it: the picture of the first such thing the
      // rules list, as a pale shadow. A place nothing is made for yet has its name and no more.
      const kind = SLOT_KIND[slot];
      const like = Object.values(ITEMS).find((d) => d.slot === kind && (this.icons[`slot:${d.id}`] ?? this.icons[d.id]));
      if (like) s.insertAdjacentHTML('beforeend', `<div class="slot-ghost" style="background-image:url(${this.icons[`slot:${like.id}`] ?? this.icons[like.id]})"></div>`);
    }
    return s;
  }

  render() {
    const inv = this.inv;
    const r = this.root;
    // (Everything here is made afresh each time anything changes, and what is made afresh is scrolled to its top:
    // the list of what lies about went back to its first thing every time one of them was taken. 2026-10-12:
    // "the scroll view resets and scrolls to the top on the vicinity side when interacting with loot". How far
    // each part that scrolls was scrolled is kept, and given back to the part made in its place.)
    // (`.inv-scroll`: the grids of what is carried, which scroll by themselves over the inspector: see below)
    const scrolls = '.inv-col, .inv-ground, .inv-scroll, .inv-inspect';
    const was = [...r.querySelectorAll<HTMLElement>(scrolls)].map((e) => [e.scrollTop, e.scrollLeft]);
    r.innerHTML = '';
    this.clocks.clear();
    this.hover = null;
    const wrap = document.createElement('div');
    wrap.className = 'inv-wrap';

    // ---- vicinity
    const vic = document.createElement('div');
    vic.className = 'inv-col inv-vicinity';
    // the whole column is the ground: let go anywhere on it and the item is dropped
    vic.dataset.ground = '1';
    vic.innerHTML = `<h3>Vicinity</h3>`;
    const ground = document.createElement('div');
    ground.className = 'inv-ground';
    ground.dataset.ground = '1';
    if (!this.vicinity.length) ground.innerHTML = `<div class="inv-empty">Nothing on the ground nearby.<br>Drag items here to drop them.</div>`;
    for (const w of this.vicinity) {
      const d = ITEMS[w.loot.item.id];
      const row = document.createElement('div');
      row.className = 'inv-ground-row';
      const ic = document.createElement('div');
      ic.className = 'inv-item mini';
      // (its kind, for the faint colour each kind's cell has: see the stylesheet. Not as a `cat-` class: those are how a thing in a grid is found by what films the screen, and this is no thing in a grid.)
      ic.dataset.kind = d.category;
      // (a bat is six cells tall and one wide: stood up in this little box its picture is a hair. Long things are laid on their side here.)
      ic.innerHTML = `<div class="inv-item-img fit${d.h > d.w ? ' lying' : ''}" style="background-image:url(${this.icons[w.loot.item.id] ?? ''})"></div>`;
      row.appendChild(ic);
      // (a pack, a vest or a case lying there says whether anything is in it: it is taken with all of that, and it is not looked into where it lies)
      const extra = d.stack ? ` <span>×${w.loot.item.qty}</span>` : d.use?.sips ? ` <span>${w.loot.item.left ?? d.use.sips}/${d.use.sips}</span>` : d.weapon ? ` <span>${w.loot.item.loaded ?? 0}/${capacityOf(w.loot.item)}</span>` : holds(w.loot.item.id) ? ` <span>· ${w.loot.item.cargo?.length ? things(w.loot.item.cargo.length) : 'empty'}</span>` : '';
      row.insertAdjacentHTML('beforeend', `<div class="g-name">${itemName(w.loot.item)}${extra}<small>${kindOf(d)}</small></div>`);
      this.bindItem(row, { kind: 'ground', w, item: w.loot.item });
      ground.appendChild(row);
    }
    vic.appendChild(ground);
    if (this.stash) {
      vic.insertAdjacentHTML('beforeend', `<h3>${this.stash.label} <span>${this.stash.container.w}×${this.stash.container.h}</span></h3>`);
      if (this.stashState) vic.insertAdjacentHTML('beforeend', `<div class="inv-empty">${this.stashState}</div>`);
      else {
        const box = this.stash.container, body = this.stash.corpse;
        // A body is gone through at a glance: everything it wears that holds things (its pack, its vest, its jacket
        // and trousers) is shown open at once, each a grid of its own under its own name, where it took a right-click
        // and "Open" for each. In a crate the same is done for a bag that has something in it. Each is opened by
        // itself once: shut by hand, it stays shut.
        for (const p of box.items) {
          if (!holds(p.item.id) || this.shown.has(p.item.uid) || (!body && !p.item.cargo?.length)) continue;
          this.shown.add(p.item.uid);
          this.opened.add(p.item.uid);
        }
        // (A body's grid is made big enough for the most anybody can have on, and most of it is bare: the rows
        // under the lowest thing in it are left off, bar two to put things down in, so that what the body wears is
        // not a screen's height further down. It is as deep as it is all the same: a thing let go on it lands
        // wherever there is room, and the rows are counted again.)
        const low = box.items.reduce((n, p) => Math.max(n, p.y + Container.size(p.item, p.rot)[1]), 0);
        vic.appendChild(this.gridEl(box, body ? Math.min(box.h, Math.max(3, low + 2)) : box.h));
        // (a pack on a body or in a crate is opened where it lies, and gone through)
        this.openBags(vic, box);
      }
    }

    // ---- character: paper doll with gear slots, weapons underneath
    const gear = document.createElement('div');
    gear.className = 'inv-col inv-gear';
    gear.dataset.char = '1';
    gear.innerHTML = `<h3>Character</h3>`;
    const doll = document.createElement('div');
    doll.className = 'inv-doll';
    doll.innerHTML = `<div class="doll-fig" style="${this.doll ? `background-image:url(${this.doll})` : ''}"></div>`;
    const left = document.createElement('div');
    left.className = 'doll-col';
    const right = document.createElement('div');
    right.className = 'doll-col';
    // (the places for what is worn are listed in src/sim/items.ts: eleven of them since 2026-10-13, as DayZ has)
    for (const s of DOLL_SLOTS[0]) left.appendChild(this.slotEl(s));
    for (const s of DOLL_SLOTS[1]) right.appendChild(this.slotEl(s));
    // (Six stood in this height, three a side. Until the page is laid out for eleven, each is made lower and the
    // figure's box as tall as the longer side, so that no place lies over what is under the figure.)
    const rows = Math.max(DOLL_SLOTS[0].length, DOLL_SLOTS[1].length);
    doll.style.height = `${rows * 56 + (rows - 1) * 6}px`;
    for (const col of [left, right]) {
      col.style.gap = '6px';
      for (const el of col.children) (el as HTMLElement).style.height = '56px';
    }
    doll.prepend(left);
    doll.appendChild(right);
    gear.appendChild(doll);
    gear.insertAdjacentHTML('beforeend', this.neckEl());
    // The hands, and beside them the holster; under those the two places on the back. Under each gun are the
    // places on it that take a part, each a slot of its own: a part is dragged onto one and dragged off it.
    const withParts = (slot: Slot) => {
      const box = document.createElement('div');
      box.className = 'inv-armed';
      box.append(this.slotEl(slot), this.partsEl(inv.slots[slot]));
      return box;
    };
    const top = document.createElement('div');
    top.className = 'inv-slots';
    const handBox = document.createElement('div');
    handBox.className = 'inv-armed';
    const held = this.actions.inHands();
    handBox.append(this.handsEl(), this.partsEl(held && !WEAPON_SLOTS.some((x) => inv.slots[x] === held) ? held : null));
    // (which places those are is the rules' to say, WEAPON_SLOTS: the ones there are two of a kind of are the back, and stand together)
    const pair = (s: Slot) => WEAPON_SLOTS.some((x) => x !== s && SLOT_KIND[x] === SLOT_KIND[s]);
    top.append(handBox, ...WEAPON_SLOTS.filter((s) => !pair(s)).map(withParts));
    const long = document.createElement('div');
    long.className = 'inv-slots';
    long.append(...WEAPON_SLOTS.filter(pair).map(withParts));
    gear.append(top, long);
    // (the tags taken off others: here under the survivor, out of the way of what is carried)
    gear.appendChild(this.gridBox(inv.tags));

    // ---- carried: every cargo grid, which scroll by themselves; under them, always in sight, the inspector and the body's state
    const cargo = document.createElement('div');
    cargo.className = 'inv-col inv-cargo';
    // (let go anywhere on this side that is no grid, a thing is put away wherever there is room for it)
    cargo.dataset.pockets = '1';
    // (what is carried and, where the game has said a load weighs on anybody, what it leaves of a sprint: the rule is
    // src/sim/load.ts. In red past the weight that slows the feet as well.)
    const kg = inv.weight(), told = this.carryLimit !== null;
    cargo.innerHTML = `<h3>Carried <span${told ? `${paceOf(kg) < 1 ? ' class="over"' : ''} title="The first ${LOAD.free} kg cost nothing. Every kilogram after that takes ${+(LOAD.perKg * 100).toFixed(2)}% off how far you can sprint. It never takes more than ${Math.round((1 - LOAD.least) * 100)}% (from ${Math.round(heavy())} kg). Over ${LOAD.slowsFrom} kg you are slower on your feet as well."` : ''}>${kg.toFixed(1)} kg${told ? ` · sprint ${Math.round(breathOf(kg) * 100)}%` : ''}</span></h3>`;
    // (an admin's power: it weighs nothing to them, and the head says that and no weight)
    if (this.weightless) cargo.innerHTML = `<h3>Carried <span class="free" title="An admin's power is on: the ${kg.toFixed(1)} kg you carry weighs nothing: it takes nothing off your sprint and never slows you. /weightless off puts it off">weightless</span></h3>`;
    const scroll = document.createElement('div');
    scroll.className = 'inv-scroll';
    const grids = document.createElement('div');
    grids.className = 'inv-grids';
    // Every grid the inventory says there is, whatever it is the inside of, each under its name and the place it
    // is worn in. They stand in the order the places stand in beside the survivor (down the left of them, then
    // down the right), so that what is worn and what is in it read as one picture; a grid that is no worn thing's
    // keeps the inventory's own order, before those.
    const places = [...DOLL_SLOTS[0], ...DOLL_SLOTS[1]];
    const wornIn = (c: Container) => GEAR_SLOTS.find((s) => inv.slots[s] && c.id === `gear:${inv.slots[s]!.uid}`) ?? null;
    const carried = inv.containers.filter((c) => c !== inv.tags).map((c, i) => ({ c, i, slot: wornIn(c) }));
    // (an admin's hold stands last, under everything that is worn: it is where what those cannot take goes)
    const rank = (c: Container, slot: Slot | null) => (c === inv.theHold ? places.length + 2 : slot ? (places.indexOf(slot) + 1 || places.length + 1) : 0);
    carried.sort((a, b) => rank(a.c, a.slot) - rank(b.c, b.slot) || a.i - b.i);
    for (const { c, slot } of carried) {
      grids.appendChild(this.gridBox(c, slot ? SLOT_LABEL[slot] : c === inv.theHold ? 'admin' : ''));
      this.openBags(grids, c);
    }
    if (!carried.length) grids.insertAdjacentHTML('beforeend', `<div class="inv-empty">Nothing you have on has any room in it. A jacket, trousers, a vest or a pack each bring their own.</div>`);
    scroll.appendChild(grids);
    cargo.appendChild(scroll);
    // (the jacket and the trousers are worn things with room in them now, and are the pockets this speaks of)
    if (!GEAR_SLOTS.some((s) => s !== 'top' && s !== 'legs' && inv.slots[s] && ITEMS[inv.slots[s]!.id].wear?.cargo)) {
      if (carried.length) scroll.insertAdjacentHTML('beforeend', `<div class="inv-tip">Only your pockets. A vest or a bag on your back adds more space.</div>`);
    }
    // (The inspector stood under all the grids, and with a pack on it was scrolled out of sight. It, and the body's
    // state under it, are fixed at the foot of this side now: only the grids over them scroll.)
    cargo.appendChild(this.inspector());
    // (The body's state is the row of symbols the game has in its corner, which this screen covers: the same row,
    // and no key to it beside it. They were four bars, drawn when this was and stale until it was drawn again; this
    // is one element of the HUD's own, which the HUD keeps up to date while this screen is open, and it is put here
    // each time this is drawn.)
    if (this.vitals && this.status) {
      const box = document.createElement('div');
      box.className = 'inv-status';
      box.appendChild(this.status);
      cargo.appendChild(box);
    }

    wrap.append(vic, gear, cargo);
    r.appendChild(wrap);
    r.appendChild(this.hotEl());
    // The clicks, said along the foot of the screen either side of the hot keys, where they are always in sight
    // and take no room from the grids: each means one thing, wherever the thing lies and whatever else is open.
    // (A finger has no Ctrl and no Alt: it is told what a finger can do.)
    if (document.body.classList.contains('touch')) {
      r.insertAdjacentHTML('beforeend', `<div class="inv-help"><b>Drag</b> a thing to move it: onto your character to wear or hold it, onto another thing to change places, to the left to put it down · <b>Tap twice</b> to use it, or to take it if it is not yours yet</div><div class="inv-help right"><b>Press and hold</b> for everything else that can be done with it. What is in your hands is used with the fire button once this is shut.</div>`);
    } else {
      r.insertAdjacentHTML('beforeend', `<div class="inv-help"><b>Drag</b> move it · <b>R</b> turn it · <b>Double-click</b> use it (not yours yet: take it) · <b>Alt-click</b> wear it or hold it, or take it off · <b>Ctrl-click</b> move it across: ground or crate to you, you to the open crate</div><div class="inv-help right"><b>Shift-click</b> quick move · <b>Right-click</b> everything else · point + <b>1</b>–<b>0</b> put it on that key · point + <b>G</b> drop it. What is in your hands is used with the <b>left button</b> once this is shut.</div>`);
    }
    [...r.querySelectorAll<HTMLElement>(scrolls)].forEach((e, i) => {
      if (!was[i]) return;
      e.scrollTop = was[i][0];
      e.scrollLeft = was[i][1];
    });
    // (the figure's box was made afresh with the rest: where it is, is found again; and its still picture is put away where the live one is to be had)
    this.figMoved = true;
    r.classList.toggle('fig-ready', !!this.figure?.alive);
    r.append(...this.veil);
    r.appendChild(this.hoverOutline);
    r.appendChild(this.card);
    if (this.menu) r.appendChild(this.menu);
    // (What the pointer is on was made afresh with the rest: it is found again, so that the card stays by it and
    // the keys that act on what is pointed at still do, without the mouse having to be moved first.)
    let under: Element | null = this.isOpen && this.at.mouse && !this.drag ? document.elementFromPoint(this.at.x, this.at.y) : null;
    while (under && !this.bound.has(under)) under = under.parentElement;
    const again = under ? this.bound.get(under) : undefined;
    if (again) {
      this.hover = again;
      if (!this.menu) this.showCard(again);
    } else if (!this.card.classList.contains('hint')) this.hideCard();
  }

  private inspector() {
    const box = document.createElement('div');
    box.className = 'inv-inspect';
    const it = this.selected;
    const loc = it ? this.locate(it) : null;
    if (!it || !loc) {
      this.selected = null;
      box.classList.add('empty');
      box.innerHTML = `<div class="inv-empty">Click an item to inspect it.</div>`;
      return box;
    }
    const d = ITEMS[it.id];
    const stats: string[] = [`<div><span>Weight</span><b>${itemWeight(it).toFixed(2)} kg</b></div>`, `<div><span>Size</span><b>${d.w}×${d.h}</b></div>`];
    if (d.stack) stats.push(`<div><span>Quantity</span><b>${it.qty}/${d.stack}</b></div>`);
    if (d.use?.sips) stats.push(`<div><span>Drinks left</span><b>${it.left ?? d.use.sips} of ${d.use.sips}</b></div>`);
    if (d.weapon) stats.push(`<div><span>Loaded</span><b>${it.loaded ?? 0}${d.weapon.mag ? '' : `/${capacityOf(it)}`}</b></div>`, `<div><span>Ammo</span><b>${ITEMS[d.weapon.ammo].name}</b></div>`);
    if (d.weapon?.mag) stats.push(`<div><span>Magazine</span><b>${it.mag ? `${ITEMS[it.mag].name} (${magRoom(it)})` : 'None in it'}</b></div>`);
    if (d.mag) stats.push(`<div><span>Rounds</span><b>${it.rounds ?? 0}/${d.mag.capacity}</b></div>`, `<div><span>Holds</span><b>${ITEMS[d.mag.ammo].name}</b></div>`);
    if (d.melee) stats.push(`<div><span>Damage</span><b>${d.melee.damage}</b></div>`);
    if (d.wear?.cargo) stats.push(`<div><span>Adds</span><b>${d.wear.cargo[0]}×${d.wear.cargo[1]} slots</b></div>`);
    if (d.stash) stats.push(`<div><span>Holds</span><b>${d.stash[0]}×${d.stash[1]} slots</b></div>`);
    if (d.wear?.armor) stats.push(`<div><span>Chest hits</span><b>−${Math.round((1 - d.wear.armor) * 100)}%</b></div>`);
    if (d.wear?.fall) stats.push(`<div><span>Fall damage</span><b>−${Math.round((1 - d.wear.fall) * 100)}%</b></div>`);
    const hd = handlingOf(it);
    if (hd) stats.push(`<div><span>Handling</span><b>${Math.round(hd.ergo)} / 100</b></div>`);
    if (d.attach) stats.push(`<div><span>Fits</span><b>${d.attach.fits.map((f) => ITEMS[f].name).join(', ')}</b></div>`);
    if (d.attach?.ergo) stats.push(`<div><span>Handling</span><b>${d.attach.ergo > 0 ? '+' : '−'}${Math.abs(d.attach.ergo)}</b></div>`);
    if (d.attach?.recoil) stats.push(`<div><span>Kick</span><b>−${Math.round((1 - d.attach.recoil) * 100)}%</b></div>`);
    if (it.mods?.length) stats.push(`<div><span>Fitted</span><b>${it.mods.map((m) => ITEMS[m].name).join(', ')}</b></div>`);
    if (it.id === 'dogtag') {
      stats.push(`<div><span>Owner</span><b>${tagOwner(it)}</b></div>`);
      stats.push(`<div><span>Cashes in</span><b${this.counting(it) ? ` data-clock="${it.uid}"` : ''}>${it.pid === this.selfId ? 'never: it is yours' : this.counting(it) ? tagClock(it) : `after ${TAG_HOLD_MIN} min carried`}</b></div>`);
    }
    box.innerHTML = `
      <div class="ins-head">
        <div class="ins-img" style="background-image:url(${this.icons[it.id] ?? ''})"></div>
        <div>
          <div class="ins-cat">${kindOf(d)}</div>
          <div class="ins-name">${itemName(it)}</div>
        </div>
      </div>
      <div class="ins-actions"></div>
      <div class="ins-desc">${d.desc}</div>
      <div class="ins-stats">${stats.join('')}</div>`;
    // (What can be done with it stands straight under its name, where it is in sight however much there is to say
    // of the thing: the rest scrolls under it when it is long.)
    const acts = box.querySelector('.ins-actions') as HTMLElement;
    // (A gun carried in a pocket or a pack: its parts, each in its place, as they are under a gun on the back or in
    // the hands. A part put on or taken off here has the gun drawn first, like any other.)
    if (d.weapon && loc.kind === 'container' && this.carried(loc) && this.actions.inHands() !== it) {
      const parts = this.partsEl(it);
      parts.classList.add('in-inspect');
      box.insertBefore(parts, acts);
    }
    for (const act of this.actionsFor(loc).filter((a) => !a.label.startsWith('Quick key'))) {
      const b = document.createElement('button');
      b.textContent = act.label;
      if (act.primary) b.className = 'primary';
      b.onclick = () => {
        act.run();
        this.render();
      };
      acts.appendChild(b);
    }
    return box;
  }

  /** is this thing on the survivor (and not in the crate that is open, or on the ground)? */
  private carried(src: Source) {
    return src.kind === 'slot' || (src.kind === 'container' && this.inv.containers.includes(src.c));
  }

  /** put an item into its equipment slot (swapping out whatever was there) */
  private equip(loc: Source) {
    const it = loc.item;
    const d = ITEMS[it.id];
    if (!d.slot) return;
    // free matching slot first, otherwise swap with the first slot of that kind
    const target = this.inv.freeSlotFor(it) ?? (Object.keys(SLOT_KIND) as Slot[]).find((k) => SLOT_KIND[k] === d.slot)!;
    if (loc.kind === 'ground' && !this.materialize(loc)) return void this.actions.note(GONE);
    this.removeFrom(loc);
    const prev = this.inv.slots[target];
    this.inv.slots[target] = it;
    if (prev) this.stow(prev);
    this.actions.sound('move');
    this.actions.changed();
  }

  /** find room for something that just came out of a slot; with none, it goes where `spill` puts it, and that is said */
  private stow(item: ItemInstance) {
    const left = this.inv.containers.reduce<ItemInstance | null>((l, c) => (l ? c.add(l) : null), item);
    if (left) this.spill(left);
  }

  /**
   * What has left its place and found no other: into the hands if they are empty and it is a thing that is held
   * so, else onto the ground; and the player is told which, and why. (It went on the ground without a word, or,
   * taken off with no room for it, did not come off at all and said nothing.)
   */
  private spill(left: ItemInstance) {
    const d = ITEMS[left.id], n = d.name.toLowerCase();
    const why = left.cargo?.length ? `The ${n} has things in it, and goes in nothing you carry` : `No room for the ${n}`;
    if (!this.actions.inHands() && holdable(d)) {
      this.actions.hold(left, true);
      // (the game may not take it up: a dead hand holds nothing)
      if (this.actions.inHands() === left) return void this.actions.note(`${why}: it is in your hands`);
    }
    this.actions.drop(left);
    this.actions.note(`${why}: it is on the ground`);
  }

  /** Why a thing does not go into what is carried, in a line. */
  private noRoom(item: ItemInstance): string {
    const d = ITEMS[item.id], n = d.name.toLowerCase();
    if (item.cargo?.length) return d.slot ? `The ${n} has things in it: wear it, or empty it first` : `The ${n} has things in it: empty it first`;
    if (!holdable(d)) return `No room for the ${n}: make room, or put something on the ground`;
    return this.actions.inHands() ? `No room for the ${n}, and your hands are full: put something on the ground` : `No room for the ${n}: put it in your hands or on the ground`;
  }

  /** Why a thing does not go into this grid, in a line. (Asked of the grid itself, so that it stands whatever the rules of what goes into what are.) */
  private noRoomIn(c: Container, item: ItemInstance): string {
    const n = ITEMS[item.id].name.toLowerCase();
    if (c.only && item.id !== c.only) return `Only ${ITEMS[c.only].name.toLowerCase()}s go in there`;
    if (c.id === `gear:${item.uid}` || c.id === `bag:${item.uid}`) return `The ${n} does not go inside itself`;
    if (!c.accepts(item)) {
      // (would it go in empty? then what is in it is what keeps it out)
      if (item.cargo?.length && c.accepts({ ...item, cargo: [] })) return `Empty the ${n} first: with things in it, it is worn, held, put down or laid in a crate`;
      return c.depth >= 2 ? `Nothing is put into the ${c.name.toLowerCase()} while it lies inside something: wear it, or put it down` : `The ${n} does not go in there`;
    }
    return `No room for the ${n}: ${c.name} is full`;
  }

  /** What is worn or slung comes off: into the pockets, and with no room for it there, where `spill` puts it. */
  private takeOff(loc: Source) {
    if (loc.kind !== 'slot') return;
    this.detach(loc);
    this.stow(loc.item);
    this.actions.sound('move');
    this.actions.changed();
  }

  /** A bag that lies where it can be opened is opened, or shut again. */
  private toggleBag(item: ItemInstance) {
    if (!this.opened.delete(item.uid)) this.opened.add(item.uid);
    this.actions.sound('move');
    this.render();
  }

  // ------------------------------------------------------------ the three clicks

  /**
   * Whose side of the screen a thing is on: the survivor's (worn, held, in a pocket, in a bag that lies in one), or
   * not (on the ground, in the crate or on the body that is open, in a bag lying there).
   */
  private mine(src: Source): boolean {
    if (src.kind === 'ground') return false;
    if (src.kind !== 'container') return true;
    if (this.inv.containers.includes(src.c)) return true;
    if (!src.c.id.startsWith('bag:')) return false;
    const uid = src.c.id.slice(4);
    const inside = (items: Container['items']): boolean => items.some((p) => p.item.uid === uid || (!!p.item.cargo && inside(p.item.cargo)));
    return this.inv.containers.some((k) => inside(k.items));
  }

  /** The thing comes into the hands, where the left button uses it; or why not. */
  private hands(src: Source): Deed {
    const it = src.item, n = ITEMS[it.id].name.toLowerCase();
    if (this.actions.inHands() === it) return { why: `The ${n} is in your hands already: shut this, and the left button uses it` };
    return { label: 'Take in hands', run: () => this.actions.hold(it) };
  }

  /** A thing in a bag that lies in a pocket or a pack is taken out into what is carried: nothing is used, worn or held from in there. */
  private takeOut(src: Source): Deed {
    return { label: 'Take it out', run: () => this.putAway(src) };
  }

  /** A thing is put away wherever there is room for it among what is carried: one held in the hands and carried nowhere, or one out of a bag that lies in a pocket. */
  private putAway(src: Source) {
    const item = src.item;
    if (!this.inv.hasRoom(item)) return void this.actions.note(src.kind === 'loose' ? `No room to put the ${ITEMS[item.id].name.toLowerCase()} away: it stays in your hands` : this.noRoom(item));
    this.detach(src);
    const left = this.inv.add(item);
    if (left) this.spill(left);
    this.actions.sound('move');
    this.actions.changed();
  }

  /**
   * Double-click: the thing is used. Carried, that is whatever is done with a thing of its kind: food is eaten, a
   * drink drunk, a dressing put on, a box or a bag opened, a part fitted to the gun that takes it, clothes put on;
   * anything else comes into the hands, where the left button uses it. Not carried yet (on the ground, in a crate,
   * on a body) it is taken, as it always was: nothing is eaten off the floor by a slip of the finger. It means the
   * same whether or not a crate is open. (It moved a thing into the crate when one was, and used it when none was.)
   */
  private useIt(src: Source): Deed {
    const it = src.item, d = ITEMS[it.id], n = d.name.toLowerCase();
    if (src.kind === 'fitted') return { why: '' };
    if (!this.mine(src)) return this.across(src);
    if (this.opens(src)) return { label: this.opened.has(it.uid) ? 'Close it' : 'Open it', run: () => this.toggleBag(it) };
    if (src.kind === 'container' && !this.inv.containers.includes(src.c)) return this.takeOut(src);
    if (eaten(d)) return { label: useWord(d), run: () => this.actions.use(it) };
    if (d.open) return { label: 'Open it', run: () => this.actions.open(it) };
    if (src.kind === 'slot' && !WEAPON_SLOTS.includes(src.slot)) return { why: `You have the ${n} on: Alt-click takes it off` };
    if (d.attach && src.kind === 'container') {
      const gun = this.actions.attachTargets(it)[0];
      if (gun) return { label: `Fit it to the ${ITEMS[gun.id].name}`, run: () => this.actions.attach(it, gun) };
    }
    if (d.slot && d.category === 'clothing' && src.kind === 'container') return { label: 'Wear it', run: () => this.equip(src) };
    return this.hands(src);
  }

  /**
   * Alt-click: the thing is put where it is used from. What has a place on the body goes there (worn, slung,
   * holstered), from wherever it lies; anything else comes into the hands. What is already worn comes off; what
   * is slung or holstered comes into the hands.
   */
  private wield(src: Source): Deed {
    const it = src.item, d = ITEMS[it.id], n = d.name.toLowerCase();
    if (src.kind === 'fitted') return { why: '' };
    if (src.kind === 'slot') return WEAPON_SLOTS.includes(src.slot) ? this.hands(src) : { label: 'Take it off', run: () => this.takeOff(src) };
    if (src.kind === 'loose') return { why: `The ${n} is in your hands already` };
    if (d.slot) return { label: wearWord(d), run: () => this.equip(src) };
    if (!this.mine(src)) return { label: 'Take in hands', run: () => this.intoHands(src) };
    if (src.kind === 'container' && !this.inv.containers.includes(src.c)) return this.takeOut(src);
    return this.hands(src);
  }

  /**
   * Ctrl-click: the thing is moved across. Off the ground or out of the open crate or body, to the survivor; from
   * the survivor, into the crate or onto the body that is open. With nothing open there is nowhere across to go,
   * and it says so (it does not drop the thing: that is G, or a drag to the left).
   */
  private across(src: Source): Deed {
    if (src.kind === 'fitted') return { why: '' };
    if (src.kind === 'ground') return { label: 'Pick it up', run: () => this.pickUp(src) };
    if (!this.mine(src)) return { label: 'Take it', run: () => this.transfer(src) };
    if (!this.stash || this.stashState) return { why: 'Nothing is open to move it into. To put it down: press G on it, or drag it to the left' };
    return { label: `Move it to ${this.stash.label}`, run: () => this.transfer(src) };
  }

  /** One of the three clicks is carried out, or the player is told why it does nothing. */
  private act(deed: Deed) {
    if ('why' in deed) {
      if (deed.why) this.actions.note(deed.why);
    } else deed.run();
    // (using a thing shuts this screen: there is nothing to draw afresh then)
    if (this.isOpen) this.render();
  }

  /** Everything that can be done with an item where it currently is, most useful first. */
  private actionsFor(loc: Source): Action[] {
    const it = loc.item;
    const d = ITEMS[it.id];
    const out: Action[] = [];
    const gearWord = d.category === 'clothing' ? 'Wear' : 'Equip';
    if (loc.kind === 'ground') {
      out.push({ label: 'Take', run: () => this.quickMove(loc), primary: true });
      if (d.slot) out.push({ label: gearWord, run: () => this.equip(loc) });
      if (d.category !== 'clothing' && !d.weapon && !d.melee) out.push({ label: 'Take in hands', run: () => this.intoHands(loc) });
      return out;
    }
    // (in the crate or on the body that is open, or in a bag that lies there: it is taken, and not "moved to" where it already is)
    const inStash = !this.mine(loc);
    // What is done with a thing is done with it in the hands, out of this screen, by the left button (2026-10-10):
    // here it is taken into them. (Worn things are worn; what is on the back or in the holster comes into the
    // hands the same way.)
    const worn = loc.kind === 'slot' && !WEAPON_SLOTS.includes(loc.slot);
    if (this.carried(loc) && !worn && d.category !== 'clothing') {
      const held = this.actions.inHands() === it;
      if (!held) out.push({ label: 'Take in hands', run: () => this.actions.hold(it), primary: !d.attach || !this.actions.attachTargets(it).length });
    }
    // (and what a double-click does with a thing that is eaten, drunk or put on a wound, or with a box of rounds: said here too, for whoever looks for it)
    if ((this.carried(loc) || loc.kind === 'loose') && eaten(d)) out.push({ label: `${useWord(d)} now`, run: () => this.actions.use(it) });
    if ((this.carried(loc) || loc.kind === 'loose') && d.open) out.push({ label: 'Open it now', run: () => this.actions.open(it) });
    if (this.opens(loc)) {
      const open = this.opened.has(it.uid);
      out.push({ label: open ? 'Close it' : `Open (${it.cargo?.length ?? 0} inside)`, primary: true, run: () => {
        if (!this.opened.delete(it.uid)) this.opened.add(it.uid);
        this.actions.sound('move');
        this.render();
      } });
    }
    if (d.attach) {
      for (const w of this.actions.attachTargets(it)) out.push({ label: `Attach to ${ITEMS[w.id].name}`, run: () => this.actions.attach(it, w), primary: true });
    }
    if (d.slot && loc.kind === 'container') out.push({ label: d.category === 'clothing' ? gearWord : d.slot === 'holster' ? 'Holster it' : 'Sling on your back', run: () => this.equip(loc), primary: d.category === 'clothing' && !this.opens(loc) });
    if (loc.kind === 'slot') {
      // (With no room for it in a pocket this did nothing, and said nothing. It comes off all the same, onto the
      // ground, and the entry says so before it is chosen. A gun with no room for it is put down with Drop.)
      const room = this.inv.containers.some((c) => c.hasRoom(it));
      if (room || d.category === 'clothing') out.push({ label: d.category === 'clothing' ? (room ? 'Take off' : 'Take off, onto the ground (no room for it)') : 'Stow', run: () => this.takeOff(loc) });
    }
    if (d.mag) {
      if ((it.rounds ?? 0) > 0) out.push({ label: `Empty (${it.rounds})`, run: () => this.actions.emptyMag(it) });
    }
    // a pile of two or more is halved: the half is laid beside it, to be given away, put elsewhere or dropped
    if (d.stack && it.qty > 1 && loc.kind === 'container') {
      const pile = loc.c;
      out.push({
        label: `Split (${it.qty - Math.floor(it.qty / 2)} and ${Math.floor(it.qty / 2)})`,
        run: () => {
          if (splitPile(pile, it, makeItem)) this.finish('move');
          else this.actions.note('No room beside it for the other half');
        },
      });
    }
    if (d.weapon?.mag) {
      if (it.mag) out.push({ label: `Take out the ${ITEMS[it.mag].name.toLowerCase()}`, run: () => this.actions.detach(it, it.mag!) });
      if (it.mag || (it.loaded ?? 0) > 0) out.push({ label: 'Unload', run: () => this.actions.unload(it) });
    } else if (d.weapon && (it.loaded ?? 0) > 0) out.push({ label: `Unload (${it.loaded})`, run: () => this.actions.unload(it) });
    for (const m of it.mods ?? []) out.push({ label: `Detach ${ITEMS[m].name}`, run: () => this.actions.detach(it, m) });
    if (this.stash && !this.stashState) out.push({ label: inStash ? 'Take' : `Move to ${this.stash.label}`, run: () => this.transfer(loc), primary: inStash });
    out.push({
      label: 'Drop',
      run: () => {
        this.detach(loc);
        this.actions.drop(it);
        this.actions.sound('drop');
        this.actions.changed();
      },
    });
    return out;
  }

  /**
   * crate <-> inventory. Out of the crate (or out of a bag that lies in it) a thing goes to the survivor; with no
   * room for it there, into their hands if those are empty; and failing that it stays, and the player is told why.
   * Into the crate, the same: it goes, or it is said why not.
   */
  private transfer(src: Source) {
    if (!this.stash || this.stashState || src.kind === 'ground' || src.kind === 'fitted') return;
    const item = src.item;
    if (src.kind === 'container' && !this.mine(src)) {
      if (!this.inv.hasRoom(item)) {
        if (!this.actions.inHands() && holdable(ITEMS[item.id])) return this.intoHands(src);
        return void this.actions.note(this.noRoom(item));
      }
      this.detach(src);
      const left = this.inv.add(item);
      // (what is left of a pile that did not all go: back where it came from)
      const back = left ? src.c.add(left) : null;
      if (back) this.spill(back);
    } else {
      if (!this.stash.container.hasRoom(item)) return void this.actions.note(this.noRoomIn(this.stash.container, item));
      this.detach(src);
      const left = this.stash.container.add(item);
      if (left) this.stow(left);
    }
    this.actions.sound('move');
    this.actions.changed();
  }

  /**
   * A thing lying about is picked up: worn or slung if its place is free, else into the pockets; with no room for
   * it, into the hands if they are empty (as a double click does in DayZ); and where even that cannot be, the
   * player is told why.
   */
  private pickUp(src: Source) {
    if (src.kind !== 'ground') return;
    const item = src.item;
    if (!this.inv.hasRoom(item)) {
      if (!this.actions.inHands() && holdable(ITEMS[item.id])) return this.intoHands(src);
      this.actions.note(this.noRoom(item));
      return this.render();
    }
    if (!this.actions.take(src.w)) {
      this.actions.note(GONE);
      return this.render();
    }
    this.vicinity = this.vicinity.filter((v) => v !== src.w);
    const left = this.inv.add(item);
    if (left) this.spill(left);
    this.finish('pickup');
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  private openMenu(src: Source, x: number, y: number) {
    this.closeMenu();
    this.selected = src.item;
    this.render();
    // (the menu stands where the card would: one or the other)
    this.hideCard();
    const m = document.createElement('div');
    m.className = 'inv-menu';
    m.innerHTML = `<div class="inv-menu-title">${itemName(src.item)}</div>`;
    for (const act of this.actionsFor(src)) {
      const b = document.createElement('button');
      b.textContent = act.label;
      if (act.primary) b.className = 'primary';
      b.onclick = () => {
        this.closeMenu();
        act.run();
        this.render();
      };
      m.appendChild(b);
    }
    this.root.appendChild(m);
    const z = this.z;
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.min(x, window.innerWidth - r.width - 8) / z}px`;
    m.style.top = `${Math.min(y, window.innerHeight - r.height - 8) / z}px`;
    this.menu = m;
  }

  /** where an item currently lives */
  private locate(item: ItemInstance): Source | null {
    for (const s of Object.keys(this.inv.slots) as Slot[]) if (this.inv.slots[s] === item) return { kind: 'slot', slot: s, item };
    for (const c of this.inv.containers) if (c.has(item)) return { kind: 'container', c, item };
    if (this.stash && this.stash.container.has(item)) return { kind: 'container', c: this.stash.container, item };
    const w = this.vicinity.find((v) => v.loot.item === item);
    if (w) return { kind: 'ground', w, item };
    if (this.actions.inHands() === item) return { kind: 'loose', item };
    return null;
  }

  private detach(src: Source) {
    if (src.kind === 'fitted') return;
    if (src.kind === 'loose') return this.actions.release(src.item);
    if (src.kind === 'container') src.c.remove(src.item);
    else if (src.kind === 'slot') {
      this.inv.slots[src.slot] = null;
      if (this.inv.active === src.slot) this.inv.active = null;
    }
  }

  // ------------------------------------------------------------ interaction

  private bindItem(el: HTMLElement, src: Source) {
    this.bound.set(el, src);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.at = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
      this.hideCard();
      // (The clicks that each mean one thing, wherever the thing lies and whether or not a crate is open. Cmd does
      // on a Mac what Ctrl does elsewhere: Ctrl-click there is the right button.)
      if (e.ctrlKey || e.metaKey) {
        this.selected = src.item;
        this.ctrlAt = performance.now();
        return this.act(this.across(src));
      }
      if (e.altKey) {
        this.selected = src.item;
        return this.act(this.wield(src));
      }
      if (e.shiftKey) {
        this.selected = src.item;
        this.quickMove(src);
        return;
      }
      this.selected = src.item;
      // (the second press of a double-click, if it is let go where it was pressed: see `last`, and `onUp`. Dragged, it is a drag like any other.)
      const now = performance.now();
      const twice = this.last.uid === src.item.uid && now - this.last.t < 500 && Math.hypot(e.clientX - this.last.x, e.clientY - this.last.y) < 8;
      this.last = { uid: src.item.uid, t: twice ? 0 : now, x: e.clientX, y: e.clientY };
      this.twice = twice ? src : null;
      const z = this.z;
      const rect = el.getBoundingClientRect();
      const rot = src.kind === 'container' ? !!src.c.items.find((p) => p.item === src.item)?.rot : false;
      const ghost = document.createElement('div');
      ghost.className = 'inv-ghost';
      this.drag = { src, ghost, rot, offX: Math.min((e.clientX - rect.left) / z, CELL / 2), offY: Math.min((e.clientY - rect.top) / z, CELL / 2) };
      this.styleGhost();
      this.root.appendChild(ghost);
      this.dragStart = { x: e.clientX, y: e.clientY, moved: false };
      this.onMove(e);
    });
    el.addEventListener('dblclick', (e) => {
      // (a second Ctrl-, Alt- or Shift-click is that click again, and not this one as well; nor is a double-click already told by its two presses acted on twice)
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || performance.now() - this.twiceAt < 700) return;
      this.act(this.useIt(src));
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.cancelDrag();
      // (on a Mac, Ctrl-click has just moved the thing: it is not asked what else is to be done with it)
      if (performance.now() - this.ctrlAt < 500) return;
      this.openMenu(src, e.clientX, e.clientY);
    });
    el.addEventListener('pointerenter', (e) => {
      this.hover = src;
      this.at = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
      this.showCard(src);
    });
    el.addEventListener('pointerleave', () => {
      if (this.hover === src) this.hover = null;
      if (this.cardSrc === src) this.hideCard();
    });
  }

  private styleGhost() {
    const d = this.drag;
    if (!d) return;
    const def = ITEMS[d.src.item.id];
    const [w, h] = d.rot ? [def.h, def.w] : [def.w, def.h];
    d.ghost.innerHTML = '';
    d.ghost.appendChild(this.itemEl(d.src.item, w, h, d.rot));
  }

  private target(x: number, y: number): Target | null {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      const h = el as HTMLElement;
      if (h.dataset?.container) return { kind: 'grid' as const, el: h, id: h.dataset.container };
      if (h.dataset?.part) return { kind: 'part' as const, el: h, gun: h.dataset.gun! };
      if (h.dataset?.hot) return { kind: 'hot' as const, el: h, i: Number(h.dataset.hot) };
      if (h.dataset?.hands) return { kind: 'hands' as const, el: h };
      if (h.dataset?.slot) return { kind: 'slot' as const, el: h, slot: h.dataset.slot as Slot };
      if (h.dataset?.ground) return { kind: 'ground' as const, el: h };
      if (h.dataset?.pockets) return { kind: 'pockets' as const, el: h };
      if (h.dataset?.char) return { kind: 'char' as const, el: h };
    }
    // off the edge of the inventory altogether: let go there and it is dropped
    const wrap = this.root.querySelector('.inv-wrap')?.getBoundingClientRect();
    if (wrap && (x < wrap.left || x > wrap.right || y < wrap.top || y > wrap.bottom)) return { kind: 'out' as const, el: this.root };
    return null;
  }

  private containerById(id: string): Container | null {
    if (this.stash && this.stash.container.id === id) return this.stash.container;
    if (id.startsWith('bag:')) return this.bags.get(id.slice(4)) ?? null;
    return this.inv.containers.find((c) => c.id === id) ?? null;
  }

  /** the bags that have been opened where they lie (in a pocket, in another bag, in a crate, on a body), by their own number */
  private opened = new Set<string>();
  private bags = new Map<string, Container>();

  /** the grid of a bag that is not worn: its own things, where they are in it */
  private bagOf(item: ItemInstance, depth: number): Container | null {
    if (!holds(item.id) || depth > 2) return null;
    item.cargo ??= [];
    let c = this.bags.get(item.uid);
    if (!c || c.items !== item.cargo) {
      // (made where the rules of what goes into what are: src/sim/inventory.ts. A stash carried is opened where it lies as a bag is, and takes what a stash takes)
      c = bagGrid(item)!;
      this.bags.set(item.uid, c);
    }
    c.depth = depth;
    return c;
  }

  /** Under a grid, the bags in it that have been opened, each with its own grid, and under each of those the bags opened in it. */
  private openBags(into: HTMLElement, c: Container) {
    for (const p of c.items) {
      if (!this.opened.has(p.item.uid)) continue;
      const bag = this.bagOf(p.item, c.depth + 1);
      if (!bag) continue;
      const box = this.gridBox(bag);
      box.classList.add('inv-bag');
      const h4 = box.querySelector('h4');
      // (on a body, where it is said to be is "on the body": the body's own name is a player's, and is over the grid already)
      if (h4) h4.insertAdjacentHTML('beforeend', `<em title="Close it">${c === this.stash?.container && this.stash.corpse ? 'on the body' : `in ${c.name.toLowerCase()}`} · close</em>`);
      h4?.querySelector('em')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.opened.delete(p.item.uid);
        this.render();
      });
      into.appendChild(box);
      this.openBags(into, bag);
    }
  }

  /** is this a bag lying somewhere it can be opened (not worn: what is worn is open already; not on the ground: that is picked up first) */
  private opens(loc: Source): boolean {
    return loc.kind === 'container' && !!holds(loc.item.id) && loc.c.depth < 2;
  }

  /** grid cell under the dragged item's top-left corner */
  private cellAt(e: { clientX: number; clientY: number }, grid: HTMLElement, d: Drag): [number, number] {
    const z = this.z;
    const rect = grid.getBoundingClientRect();
    const lx = (e.clientX - rect.left) / z - d.offX;
    const ly = (e.clientY - rect.top) / z - d.offY;
    return [Math.floor((lx + CELL / 2) / CELL), Math.floor((ly + CELL / 2) / CELL)];
  }

  /**
   * Where an item held over a grid will land: the cell under it if that is free, else the
   * free spot nearest to it, turned the other way if that is the only way it goes in.
   */
  private landing(c: Container, item: ItemInstance, cx: number, cy: number, rot: boolean): { x: number; y: number; rot: boolean } | null {
    // (Whether the grid takes such a thing at all does not turn on where: it is asked once, and each cell is then
    // asked only whether it is free. And in a grid of very many rows, an admin's hold, the free spot is looked for
    // within a screen of rows of the pointer and not in all of them: asked of every cell, a hold of some hundreds
    // of things held the pointer up at every move.)
    if (!c.accepts(item)) return null;
    if (c.free(item, cx, cy, rot, item)) return { x: cx, y: cy, rot };
    let best: { x: number; y: number; rot: boolean } | null = null;
    let bd = Infinity;
    const rows = c.h, tall = rows > 40;
    for (const r of [rot, !rot]) {
      const [w, h] = Container.size(item, r);
      for (let y = tall ? Math.max(0, cy - 16) : 0; y <= (tall ? Math.min(rows - h, cy + 16) : rows - h); y++) {
        for (let x = 0; x <= c.w - w; x++) {
          // (a turn counts as a little further away: it is only taken when it has to be)
          const dist = Math.hypot(x - cx, y - cy) + (r === rot ? 0 : 0.75);
          if (dist < bd && c.free(item, x, y, r, item)) {
            bd = dist;
            best = { x, y, rot: r };
          }
        }
      }
    }
    return best;
  }

  /** the item lying under a grid cell, if any */
  private under(c: Container, cx: number, cy: number) {
    return c.items.find((p) => {
      const [w, h] = Container.size(p.item, p.rot);
      return cx >= p.x && cx < p.x + w && cy >= p.y && cy < p.y + h;
    });
  }

  /**
   * Would the thing dragged and the thing it is held over change places, if it were let go here? Tried on copies of
   * the grids, as letting go tries it on the grids themselves (see `onUp`), so that the outline can say "Swap"
   * before it is done and not show a place elsewhere that the thing will not go to.
   */
  private wouldSwap(src: Source, c: Container, other: ItemInstance, where: { x: number; y: number; rot: boolean }): boolean {
    if ((src.kind !== 'container' && src.kind !== 'ground') || other === src.item) return false;
    const twin = (k: Container) => Object.assign(new Container(k.id, k.name, k.w, k.h, [...k.items], k.holdsBags), k, { items: [...k.items] });
    const into = twin(c);
    return swapPlaces(src.item, src.kind === 'container' ? (src.c === c ? into : twin(src.c)) : null, into, other, where);
  }

  /**
   * Why the thing being dragged will not go where it is held, in a line: said by the pointer while it is held
   * there, and to the player if it is let go there. '' where it will go, and where letting go does nothing worth
   * a word (a thing let go where it already is).
   */
  private refusal(d: Drag, t: Target, e: { clientX: number; clientY: number }): string {
    const src = d.src, item = src.item, def = ITEMS[item.id], n = def.name.toLowerCase();
    // (a part dragged off its gun comes off wherever it is let go, and finds a place: see `onUp`)
    if (src.kind === 'fitted') return '';
    if (t.kind === 'grid') {
      const c = this.containerById(t.id);
      if (!c) return '';
      const z = this.z, rect = t.el.getBoundingClientRect();
      const onto = this.under(c, Math.floor((e.clientX - rect.left) / z / CELL), Math.floor((e.clientY - rect.top) / z / CELL));
      if (onto && c.joinable(item, src.kind === 'container' ? src.c : null) && this.joins(d, onto.item)) return '';
      const [cx, cy] = this.cellAt(e, t.el, d);
      if (this.landing(c, item, cx, cy, d.rot)) return '';
      if (onto && this.wouldSwap(src, c, onto.item, { x: cx, y: cy, rot: d.rot })) return '';
      return this.noRoomIn(c, item);
    }
    if (t.kind === 'slot') {
      const occupant = this.inv.slots[t.slot];
      if ((occupant && this.joins(d, occupant) === 'attach') || def.slot === SLOT_KIND[t.slot]) return '';
      // (not what that place takes: letting go there does what letting go anywhere on the survivor would)
      if (this.onCharacter(src)) return '';
      return src.kind === 'slot' ? `The ${n} only goes in the place marked “${this.placeName(def)}”` : this.notOnBody(src);
    }
    if (t.kind === 'char') return src.kind === 'slot' || this.onCharacter(src) ? '' : this.notOnBody(src);
    if (t.kind === 'part') {
      const gun = this.gunByUid(t.gun);
      if (gun && this.joins(d, gun) === 'attach') return '';
      if (!gun || !def.attach?.fits.includes(gun.id)) return `The ${n} does not fit ${gun ? `the ${ITEMS[gun.id].name}` : 'that'}`;
      return `The ${ITEMS[gun.id].name} has one fitted there already: take that off first`;
    }
    if (t.kind === 'hot') return this.carried(src) ? '' : 'Only what you carry goes on a key: pick it up first';
    if (t.kind === 'hands') {
      if (def.category === 'clothing') return 'Clothes are worn, not held: let go of it on your body';
      if (!this.carried(src) && src.kind !== 'loose' && (def.weapon || def.melee) && !this.inv.hasRoom(item)) return `No place for the ${n}: it needs one on your back, in a holster or in a pack`;
      return '';
    }
    if (t.kind === 'pockets') {
      // (dragged to what is carried, a thing that is worn or held is not put on the ground for want of room, as it is when it is told to come off: it stays)
      if (src.kind === 'slot') return this.inv.containers.some((c) => c.hasRoom(item)) ? '' : `No room for the ${n} in what you carry: it stays on you`;
      if (src.kind === 'loose') return this.inv.hasRoom(item) ? '' : `No room to put the ${n} away: it stays in your hands`;
      return !this.mine(src) && !this.inv.hasRoom(item) && (!holdable(def) || !!this.actions.inHands()) ? this.noRoom(item) : '';
    }
    return '';
  }

  /** why letting a thing go on the survivor does nothing with it */
  private notOnBody(src: Source): string {
    const it = src.item;
    if (this.actions.inHands() === it) return `The ${ITEMS[it.id].name.toLowerCase()} is in your hands already`;
    return this.mine(src) ? '' : this.noRoom(it);
  }

  /** A thing was let go where it does not go: the player is told why, and nothing is moved. */
  private refuse(d: Drag, t: Target, e: { clientX: number; clientY: number }) {
    const why = this.refusal(d, t, e);
    if (why) this.actions.note(why);
    this.render();
  }

  /** dropped on that item, the dragged one goes into it: more of the same stack, or a part the weapon takes */
  private joins(d: Drag, onto: ItemInstance): 'stack' | 'attach' | 'fill' | null {
    const item = d.src.item;
    const def = ITEMS[item.id];
    if (onto === item) return null;
    if (def.stack && onto.id === item.id && onto.qty < def.stack) return 'stack';
    // (rounds let go on a magazine that holds them and has room: they are pushed into it)
    const into = ITEMS[onto.id].mag;
    if (into && into.ammo === item.id && (onto.rounds ?? 0) < into.capacity) return 'fill';
    // (a part is fitted from wherever it lies: off the ground as well as out of a pocket)
    if (def.attach && this.actions.attachTargets(item).includes(onto)) return 'attach';
    return null;
  }

  /**
   * What letting go over the survivor does with an item: the one obvious thing, or nothing.
   * Clothes are worn and weapons slung; a part goes onto the weapon that takes it; food,
   * drink and dressings are used; anything else lying about or in a crate is pocketed.
   */
  private onCharacter(src: Source): Action | null {
    const it = src.item;
    const d = ITEMS[it.id];
    const mine = src.kind === 'slot' || (src.kind === 'container' && this.inv.containers.includes(src.c));
    if (d.slot) return src.kind === 'slot' ? null : { label: d.category === 'clothing' ? 'Wear' : 'Equip', run: () => this.equip(src) };
    if (d.attach && (mine || src.kind === 'ground')) {
      const w = this.actions.attachTargets(it)[0];
      if (w) return { label: `Fit to ${ITEMS[w.id].name}`, run: () => this.fit(src, w) };
    }
    // (let go over the survivor, a thing carried comes into their hands)
    if (mine) return this.actions.inHands() === it ? null : { label: 'Take in hands', run: () => this.actions.hold(it) };
    if (!this.inv.hasRoom(it)) return null;
    // (a thing held in the hands and carried nowhere is put away: it was sent the way of a thing out of a crate, and with no crate open went nowhere)
    return { label: src.kind === 'loose' ? 'Put away' : 'Take', run: () => (src.kind === 'ground' ? this.quickMove(src) : src.kind === 'loose' ? this.putAway(src) : this.transfer(src)) };
  }

  /** Light up every place the dragged item can go. */
  private showTargets(d: Drag) {
    const item = d.src.item;
    const def = ITEMS[item.id];
    this.root.classList.add('dragging');
    for (const el of this.root.querySelectorAll<HTMLElement>('.inv-slot')) {
      const slot = el.dataset.slot as Slot;
      const occupant = this.inv.slots[slot];
      const fits = def.slot === SLOT_KIND[slot] && !(d.src.kind === 'slot' && d.src.slot === slot);
      const part = !!occupant && this.joins(d, occupant) === 'attach';
      el.classList.toggle('drop-hint', fits || part);
    }
    for (const el of this.root.querySelectorAll<HTMLElement>('.inv-grid')) {
      const c = this.containerById(el.dataset.container!);
      if (!c) continue;
      const room = c.has(item) || c.hasRoom(item);
      el.classList.toggle('grid-ok', room);
      el.classList.toggle('grid-full', !room);
    }
    const act = this.onCharacter(d.src);
    const gear = this.root.querySelector<HTMLElement>('.inv-gear');
    const fig = this.root.querySelector<HTMLElement>('.doll-fig');
    gear?.classList.toggle('char-ok', !!act);
    if (fig) fig.dataset.drop = act ? act.label : '';
    this.root.querySelector('.inv-ground')?.classList.toggle('ground-ok', d.src.kind !== 'ground');
  }

  private clearTargets() {
    this.root.classList.remove('dragging');
    this.root.querySelectorAll('.drop-hint, .drop-ok, .drop-bad, .grid-ok, .grid-full, .char-ok, .char-over, .ground-ok, .ground-over, .pockets-over').forEach((el) => el.classList.remove('drop-hint', 'drop-ok', 'drop-bad', 'grid-ok', 'grid-full', 'char-ok', 'char-over', 'ground-ok', 'ground-over', 'pockets-over'));
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    const started = !this.dragStart.moved && Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) > 4;
    if (started) {
      this.dragStart.moved = true;
      this.showTargets(d);
    }
    const z = this.z;
    d.ghost.style.left = `${e.clientX / z - d.offX}px`;
    d.ghost.style.top = `${e.clientY / z - d.offY}px`;
    d.ghost.style.display = this.dragStart.moved ? 'block' : 'none';
    const o = this.hoverOutline;
    o.style.display = 'none';
    o.textContent = '';
    this.root.querySelectorAll('.drop-ok, .drop-bad, .char-over, .ground-over, .pockets-over').forEach((el) => el.classList.remove('drop-ok', 'drop-bad', 'char-over', 'ground-over', 'pockets-over'));
    if (!this.dragStart.moved) return;
    const t = this.target(e.clientX, e.clientY);
    // (held where it will not go, the reason is said by the pointer before it is let go, and not only after)
    this.hint(t ? this.refusal(d, t, e) : '');
    const box = (rect: DOMRect, x: number, y: number, w: number, h: number, cls: string, label = '') => {
      o.style.display = 'block';
      o.style.left = `${rect.left / z + x * CELL}px`;
      o.style.top = `${rect.top / z + y * CELL}px`;
      o.style.width = `${w * CELL}px`;
      o.style.height = `${h * CELL}px`;
      o.className = 'inv-outline ' + cls;
      o.textContent = label;
    };
    if (t?.kind === 'grid') {
      const c = this.containerById(t.id!);
      if (!c) return;
      const rect = t.el.getBoundingClientRect();
      const [cx, cy] = this.cellAt(e, t.el, d);
      // over something it goes into: that thing is what lights up
      const [px, py] = [Math.floor(((e.clientX - rect.left) / z) / CELL), Math.floor(((e.clientY - rect.top) / z) / CELL)];
      const onto = this.under(c, px, py);
      // (onto a pile, into a magazine, onto a gun: only where the thing could be put at all. Nothing goes into a bag that is itself in a pocket or a pack: Container.accepts)
      const how = onto && c.joinable(d.src.item, d.src.kind === 'container' ? d.src.c : null) ? this.joins(d, onto.item) : null;
      if (onto && how) {
        const [w, h] = Container.size(onto.item, onto.rot);
        box(rect, onto.x, onto.y, w, h, 'join', how === 'stack' ? 'Add' : how === 'fill' ? 'Fill' : 'Fit');
        return;
      }
      // (Held over another thing, the two change places when it is let go, where each has room where the other lay:
      // that thing is outlined and it says so. The outline was drawn at the nearest free place instead, where the
      // thing did not go.)
      if (onto && this.wouldSwap(d.src, c, onto.item, { x: cx, y: cy, rot: d.rot })) {
        const [w, h] = Container.size(onto.item, onto.rot);
        box(rect, onto.x, onto.y, w, h, 'join', 'Swap');
        return;
      }
      const at = this.landing(c, d.src.item, cx, cy, d.rot);
      if (at) {
        const [w, h] = Container.size(d.src.item, at.rot);
        box(rect, at.x, at.y, w, h, 'ok');
      } else {
        // (why not is said in full by the pointer: see `refusal`)
        const [w, h] = Container.size(d.src.item, d.rot);
        box(rect, cx, cy, w, h, 'bad');
      }
    } else if (t?.kind === 'slot') {
      const occupant = this.inv.slots[t.slot];
      const part = !!occupant && this.joins(d, occupant) === 'attach';
      if (part || ITEMS[d.src.item.id].slot === SLOT_KIND[t.slot]) t.el.classList.add('drop-ok');
      // (not what that place takes: letting go there does what letting go anywhere on the survivor would, and it is the survivor that lights up, not the place)
      else if (this.onCharacter(d.src)) this.root.querySelector('.inv-gear')?.classList.add('char-over');
      else t.el.classList.add('drop-bad');
    } else if (t?.kind === 'pockets') {
      // (anywhere on the right-hand side that is no grid: it is put away wherever there is room)
      if (d.src.kind !== 'container' || !this.inv.containers.includes(d.src.c)) this.root.querySelector('.inv-scroll')?.classList.add('pockets-over');
    } else if (t?.kind === 'part') {
      const gun = this.gunByUid(t.gun);
      t.el.classList.add(gun && d.src.kind !== 'fitted' && this.joins(d, gun) === 'attach' && ITEMS[d.src.item.id].attach?.slot === t.el.dataset.part ? 'drop-ok' : 'drop-bad');
    } else if (t?.kind === 'hot') {
      t.el.classList.add(d.src.kind === 'slot' || (d.src.kind === 'container' && this.inv.containers.includes(d.src.c)) ? 'drop-ok' : 'drop-bad');
    } else if (t?.kind === 'hands') {
      t.el.classList.add(d.src.kind === 'fitted' || ITEMS[d.src.item.id].category === 'clothing' ? 'drop-bad' : 'drop-ok');
    } else if (t?.kind === 'char') {
      if (this.onCharacter(d.src)) t.el.classList.add('char-over');
    } else if ((t?.kind === 'ground' || t?.kind === 'out') && d.src.kind !== 'ground') {
      this.root.querySelector('.inv-ground')?.classList.add('ground-over');
    }
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    this.cancelDrag();
    const again = this.twice;
    this.twice = null;
    if (!this.dragStart.moved) {
      // (pressed twice and let go where it was pressed: a double-click, which uses the thing. See `last`.)
      if (again) {
        this.twiceAt = performance.now();
        return this.act(this.useIt(again));
      }
      this.render();
      return;
    }
    // (a drag is no first press of a double-click)
    this.last.t = 0;
    const t = this.target(e.clientX, e.clientY);
    if (!t) return this.render();
    // A part dragged off its gun: it comes off where it is let go. Onto the ground, it is put down; into a grid, it
    // goes where it was put if it fits there; anywhere else, into a pocket (or onto the ground, with no room).
    if (d.src.kind === 'fitted') {
      if (t.kind === 'part' && t.gun === d.src.weapon.uid) return this.render();
      const part = this.actions.detach(d.src.weapon, d.src.mod, true);
      if (!part) return this.render();
      if (t.kind === 'ground' || t.kind === 'out') {
        this.actions.drop(part);
        return this.finish('drop');
      }
      const c = t.kind === 'grid' ? this.containerById(t.id!) : null;
      const at = c ? this.landing(c, part, ...this.cellAt(e, t.el, d), d.rot) : null;
      if (c && at) c.place(part, at.x, at.y, at.rot);
      else {
        const left = this.inv.add(part);
        if (left) this.spill(left);
      }
      return this.finish('move');
    }
    const item = d.src.item;
    const def = ITEMS[item.id];
    // let go on a hot key: a thing carried goes on that key
    if (t.kind === 'hot') {
      if (d.src.kind === 'slot' || (d.src.kind === 'container' && this.inv.containers.includes(d.src.c))) {
        this.actions.assignHot(item, t.i);
        this.actions.sound('move');
        return this.render();
      }
      return this.refuse(d, t, e);
    }
    // let go on the hands: a thing carried comes into them; a thing lying about is picked up, and then does
    if (t.kind === 'hands') {
      if (def.category === 'clothing') return this.refuse(d, t, e);
      if (d.src.kind === 'ground' || (d.src.kind === 'container' && !this.inv.containers.includes(d.src.c))) return this.intoHands(d.src);
      if (d.src.kind === 'loose') return this.render();
      this.actions.hold(item);
      return this.finish('move');
    }
    // let go on a place on a gun that takes a part: the part is fitted, if it is that gun's and that place's
    if (t.kind === 'part') {
      const gun = this.gunByUid(t.gun);
      if (gun && this.joins(d, gun) === 'attach') {
        this.fit(d.src, gun);
        return this.render();
      }
      return this.refuse(d, t, e);
    }
    // let go on the right-hand side, on no grid: it is put away wherever there is room for it (what is worn comes off)
    if (t.kind === 'pockets') {
      if (this.refusal(d, t, e)) return this.refuse(d, t, e);
      if (d.src.kind === 'ground') return this.pickUp(d.src);
      if (d.src.kind === 'slot') this.takeOff(d.src);
      else if (d.src.kind === 'loose') this.putAway(d.src);
      else if (!this.mine(d.src)) this.transfer(d.src);
      else if (!this.inv.containers.includes(d.src.c)) this.putAway(d.src);
      return this.render();
    }
    if (t.kind === 'grid') {
      const c = this.containerById(t.id!);
      if (!c) return this.render();
      const z = this.z;
      const rect = t.el.getBoundingClientRect();
      const [cx, cy] = this.cellAt(e, t.el, d);
      const onto = this.under(c, Math.floor(((e.clientX - rect.left) / z) / CELL), Math.floor(((e.clientY - rect.top) / z) / CELL));
      // (onto a pile, into a magazine, onto a gun: only where the thing could be put at all. Nothing goes into a bag that is itself in a pocket or a pack: Container.accepts)
      const how = onto && c.joinable(d.src.item, d.src.kind === 'container' ? d.src.c : null) ? this.joins(d, onto.item) : null;
      // more of the same, let go on the stack
      if (onto && how === 'stack') {
        if (!this.materialize(d.src)) return this.gone();
        const move = Math.min(def.stack! - onto.item.qty, item.qty);
        onto.item.qty += move;
        item.qty -= move;
        if (item.qty <= 0) this.removeFrom(d.src);
        else if (d.src.kind === 'ground') {
          // the rest of a ground stack goes into cargo (or where `spill` puts it, and that is said)
          this.removeFrom(d.src);
          const left = this.inv.add(item);
          if (left) this.spill(left);
        }
        this.finish('move');
        return;
      }
      // a part, let go on a weapon it fits
      if (onto && how === 'attach') {
        this.fit(d.src, onto.item);
        return this.render();
      }
      // rounds, let go on a magazine: off the ground they are picked up first, and then the hands fill it
      if (onto && how === 'fill') {
        if (d.src.kind === 'ground') {
          if (!this.materialize(d.src)) return this.gone();
          this.removeFrom(d.src);
          const left = this.inv.add(item);
          if (left) this.spill(left);
        }
        this.actions.fillMag(onto.item);
        return this.render();
      }
      // Let go on another thing: the two change places, where each has room where the other lay (as in DayZ). Off
      // the ground, what was in the grid is put down in its stead.
      if (onto && onto.item !== item && (d.src.kind === 'container' || d.src.kind === 'ground')) {
        const from = d.src.kind === 'container' ? d.src.c : null, other = onto.item, where = { x: cx, y: cy, rot: d.rot };
        // (a thing on the ground is picked up only once there is known to be a place for it: tried on a copy of the grid first)
        const copy = () => Object.assign(new Container(c.id, c.name, c.w, c.h, [...c.items], c.holdsBags), { depth: c.depth, only: c.only, of: c.of });
        if ((from || swapPlaces(item, null, copy(), other, where)) && (from || this.materialize(d.src)) && swapPlaces(item, from, c, other, where)) {
          if (!from) {
            this.removeFrom(d.src);
            this.actions.drop(other);
          }
          return this.finish(from ? 'move' : 'pickup');
        }
      }
      const at = this.landing(c, item, cx, cy, d.rot);
      if (!at) return this.refuse(d, t, e);
      if (!this.materialize(d.src)) return this.gone();
      this.removeFrom(d.src);
      c.place(item, at.x, at.y, at.rot);
      this.finish(d.src.kind === 'ground' ? 'pickup' : 'move');
    } else if (t.kind === 'slot') {
      const occupant = this.inv.slots[t.slot];
      // an attachment dropped onto the weapon in a slot
      if (occupant && this.joins(d, occupant) === 'attach') {
        this.fit(d.src, occupant);
        return this.render();
      }
      // not what that slot takes: do what letting go anywhere on the survivor would (or say why nothing is done)
      if (def.slot !== SLOT_KIND[t.slot]) return this.onCharacter(d.src) ? this.dropOnCharacter(d.src) : this.refuse(d, t, e);
      if (d.src.kind === 'slot' && d.src.slot === t.slot) return this.render();
      if (!this.materialize(d.src)) return this.gone();
      this.removeFrom(d.src);
      this.inv.slots[t.slot] = item;
      if (occupant) {
        // swapping two slots of the same kind just trades places
        if (d.src.kind === 'slot' && !this.inv.slots[d.src.slot] && ITEMS[occupant.id].slot === SLOT_KIND[d.src.slot]) this.inv.slots[d.src.slot] = occupant;
        else this.stow(occupant);
      }
      this.finish(d.src.kind === 'ground' ? 'pickup' : 'move');
    } else if (t.kind === 'char') {
      if (this.onCharacter(d.src)) this.dropOnCharacter(d.src);
      else this.refuse(d, t, e);
    } else if (t.kind === 'ground' || t.kind === 'out') {
      if (d.src.kind === 'ground') return this.render();
      this.removeFrom(d.src);
      this.actions.drop(item);
      this.finish('drop');
    }
  }

  private dropOnCharacter(src: Source) {
    const act = this.onCharacter(src);
    if (act) act.run();
    this.render();
  }

  /** ground items must be taken out of the world before being placed */
  /**
   * A part put on a weapon, from wherever it was. Off the ground it is picked up as it is fitted, and never has
   * to find room in a pocket first. (Should the weapon not take it after all, the hands being busy with it, it
   * goes into the pockets, or back on the ground.)
   */
  private fit(src: Source, weapon: ItemInstance) {
    const item = src.item;
    if (src.kind !== 'ground') return this.actions.attach(item, weapon);
    if (!this.materialize(src)) return void this.actions.note(GONE);
    this.removeFrom(src);
    this.actions.attach(item, weapon);
    if (!(ITEMS[item.id].mag ? weapon.mag === item.id : (weapon.mods ?? []).includes(item.id))) {
      const left = this.inv.add(item);
      if (left) this.spill(left);
    }
  }

  /** A thing lying about was reached for and is not there: somebody else was quicker, and the player is told so. */
  private gone() {
    this.actions.note(GONE);
    this.render();
  }

  /**
   * A thing lying about, or in a crate, is taken into the hands. With room for it, it is put away first and held
   * from where it is carried, as ever. With none it is held and carried nowhere (see `hold`): eaten, drunk or put
   * on from there, and put down when the hands are wanted for something else. A gun or a thing to hit with is
   * slung or holstered, and needs a place.
   */
  private intoHands(src: Source) {
    const item = src.item, def = ITEMS[item.id];
    const armed = !!(def.weapon || def.melee);
    // (each of these did nothing, and said nothing)
    if (def.category === 'clothing' || (armed && !this.inv.hasRoom(item))) {
      this.actions.note(def.category === 'clothing' ? 'Clothes are worn, not held: let go of it on your body' : `No place for the ${def.name.toLowerCase()}: it needs one on your back, in a holster or in a pack`);
      return this.render();
    }
    if (!this.materialize(src)) return this.gone();
    this.removeFrom(src);
    const left = this.inv.hasRoom(item) ? this.inv.add(item) : item;
    if (left) {
      if (armed) this.actions.drop(left);
      else this.actions.hold(left, true);
    } else {
      // (all of it may have gone onto a pile already carried: that pile is then what is held)
      const into = this.locate(item) ? item : [...this.inv.carried()].find((x) => x.id === item.id);
      if (into) this.actions.hold(into);
    }
    this.finish('pickup');
  }

  private materialize(src: Source): boolean {
    if (src.kind !== 'ground') return true;
    const it = this.actions.take(src.w);
    return !!it;
  }

  private removeFrom(src: Source) {
    if (src.kind === 'ground') {
      this.vicinity = this.vicinity.filter((v) => v !== src.w);
      return;
    }
    this.detach(src);
  }

  /**
   * Shift-click, as it always was: the one obvious thing to do with the item where things stand (never drops it).
   * Off the ground it is picked up; with a crate open it changes sides; otherwise its main action. (Double-click
   * did this too, and so meant one thing with a crate open and another without: it uses the thing now. See `useIt`.)
   */
  private quickMove(src: Source) {
    // pick up: wear it / sling it if the slot is free, else into the pockets (see `pickUp`)
    if (src.kind === 'ground') return this.pickUp(src);
    if (this.stash && !this.stashState) {
      this.transfer(src);
      this.render();
      return;
    }
    const main = this.actionsFor(src).find((a) => a.primary);
    if (main) main.run();
    // (nothing stands out to be done with it: said, where it was passed over without a word)
    else this.actions.note(`Right-click the ${ITEMS[src.item.id].name.toLowerCase()} for what can be done with it`);
    this.render();
  }

  private finish(sound: 'pickup' | 'drop' | 'move') {
    this.actions.sound(sound);
    this.actions.changed();
    this.render();
  }

  private cancelDrag() {
    if (this.drag) this.drag.ghost.remove();
    this.drag = null;
    this.hoverOutline.style.display = 'none';
    // (and the line by the pointer that said why it would not go where it was held)
    if (this.card.classList.contains('hint')) this.hideCard();
    this.clearTargets();
  }
}
