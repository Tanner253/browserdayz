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

import { ALL_SLOTS, DOLL_SLOTS, GEAR_SLOTS, ITEMS, SLOT_KIND, SLOT_LABEL, TAG_HOLD_MIN, TAG_FRESH, WEAPON_SLOTS, ZONA_VOID, makeItem, type AttachSlot, capacityOf, handlingOf, magFits, itemName, itemWeight, magRoom, tagClock, tagOwner, type ItemInstance, type Slot, holds } from '../sim/items';
import { Container, bagGrid, poured, splitPile, swapPlaces, type PlayerInventory } from '../sim/inventory';
import { combinePiles, goesWith, gridWeight, pileGrids, sortAll, sortGrid, wouldSort } from './inv-piles';
import { BAG_FOR, bagFor, setBagFor, typable, wants } from './inv-types';
import { LOAD, breathOf, heavy, paceOf } from '../sim/load';
import { actIcon } from './act-icons';
import { lookOf } from '../../api/_lib/shop-items';
import { kindIcon, kindView, setKindView } from './kind-icons';
import { searchMatch, searchTerms } from './inv-search';
import { TAKE_GROUPS, fitsGuns, inTakeGroup, type TakeGroup } from './inv-take';
import { KEY, does, kindOf, rows, type Action, type Deed, type Row, type Stat } from './inv-card';
import type { WorldItem, Stash } from '../game/loot';
import type { Vitals } from '../game/player';
import type { DollBox as FigureBox } from '../game/doll';

const CELL = 46;
/** the inventory painted once, with what is carried, before it is first opened (`paintAhead`): how long into play, and for how many frames */
const AHEAD_AFTER = 2000, AHEAD_FRAMES = 6;
/** the hot key a thing in a place is on, as a key before the place's name (nothing for none) */
const slotKey = (i: number) => (i >= 0 ? `<span class="slot-key">${(i + 1) % 10}</span>` : '');
/** weight, as a weight is drawn (idea 6: "instead of kg ... an icon"): a ring over a block, read at 11 px */
const WEIGHT_ICON = `<svg class="kg-ic" viewBox="0 0 32 32" aria-hidden="true"><path fill-rule="evenodd" d="M16 2A5.5 5.5 0 1 1 15.99 2ZM16 5A2.5 2.5 0 1 0 16.01 5ZM8 12H24L29 30H3Z"/></svg>`;
/** a sprint, as a runner (idea 6: "an icon instead of the word sprint") */
const SPRINT_ICON = `<svg class="kg-ic run-ic" viewBox="0 0 32 32" aria-hidden="true"><circle cx="20" cy="5" r="3.5"/><path d="M17.5 11L13.5 19.5M17 12.5L22.5 16M17 12.5L10.5 13.5M13.5 19.5L19 23L18 29.5M13.5 19.5L10 25L3.5 25.5"/></svg>`;
/** What a press on keeps the chosen thing chosen (anywhere else, it is let go: see the constructor) */
const KEEPS_CHOSEN = '.inv-item, .inv-inspect, .inv-menu, .inv-card, .inv-hot, .inv-view, .inv-view-menu, button, input, label, a, h4';

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
  /** @param loose picked up off the ground to be fitted: held by nothing */
  attach(att: ItemInstance, weapon: ItemInstance, loose?: boolean): void;
  /** @param loose the part is handed back, to be put where it was let go, and not put away in a pocket */
  detach(weapon: ItemInstance, mod: string, loose?: boolean): ItemInstance | null;
  /** push loose rounds into a magazine, one at a time, for as long as the hands are left to it */
  fillMag(mag: ItemInstance): void;
  /** every magazine carried that takes these rounds filled, one after another */
  fillAllMags(ammo: string): void;
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
  /** the magazine on its way into this gun (the gun being taken up for it, or the hands at it), or null */
  goingIn(gun: ItemInstance): string | null;
  /** a thing lying within reach that holds things: this player's to go through ('mine'), being asked for, somebody else's, or not opened (null). See Game.openLying */
  lying(uid: string): 'wait' | 'mine' | 'busy' | null;
  changed(): void;
  sound(kind: 'pickup' | 'drop' | 'move'): void;
  /** a line said to the player */
  note(text: string): void;
  /** the store finish of theirs this gun can be given ('gold', 'nickel'), where it does not wear it already; else null */
  finishFor(item: ItemInstance): 'gold' | 'nickel' | null;
  /** that finish put on it for good, by the server (server/plates.ts) */
  applyFinish(item: ItemInstance): void;
  /** a plated gun's picture drawn, once, from its model with the finish on: put in `icons` as `<id>|<finish>` */
  plateIcon(id: string, f: 'gold' | 'nickel'): void;
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
/** a number for each thing a part of the screen acts on, written on it, so that two parts written alike act on the same things (see `place`) */
const OIDS = new WeakMap<object, number>();
let nextOid = 0;
const oid = (o: object) => {
  let n = OIDS.get(o);
  if (n === undefined) OIDS.set(o, (n = ++nextOid));
  return n;
};
const srcOid = (s: Source) => `${oid(s.item)}${s.kind === 'container' ? `.${oid(s.c)}` : s.kind === 'ground' ? `.${oid(s.w)}` : s.kind === 'fitted' ? `.${oid(s.weapon)}` : ''}`;

const PARTS: [AttachSlot, string][] = [['magazine', 'Magazine'], ['optic', 'Optic'], ['muzzle', 'Muzzle'], ['grip', 'Grip'], ['light', 'Light'], ['wrap', 'Stock']];

interface Drag {
  src: Source;
  ghost: HTMLDivElement;
  rot: boolean;
  /** grab offset inside the item, in the inventory's own (unzoomed) pixels */
  offX: number;
  offY: number;
}

/** where a thing being dragged is held over */
type Target =
  | { kind: 'grid'; el: HTMLElement; id: string }
  | { kind: 'part'; el: HTMLElement; gun: string }
  | { kind: 'hot'; el: HTMLElement; i: number }
  | { kind: 'hands'; el: HTMLElement }
  | { kind: 'slot'; el: HTMLElement; slot: Slot }
  | { kind: 'ground'; el: HTMLElement }
  | { kind: 'pockets'; el: HTMLElement }
  | { kind: 'into'; el: HTMLElement }
  | { kind: 'char'; el: HTMLElement }
  | { kind: 'out'; el: HTMLElement };

type Def = (typeof ITEMS)[string];

const things = (n: number) => (n === 1 ? '1 thing' : `${n} things`);
/** said when a thing lying about is reached for and is not there */
const GONE = 'It is not there to take any more';
const pct = (k: number) => Math.round(k * 100);

/** Is it eaten, drunk or put on a wound: used up then and there? (Not what is thrown, looked through or called with: those are used from the hands.) */
const eaten = (d: Def) => !!d.use && !d.throw && !d.call && !d.look;
/** what using such a thing is called */
// (every medical thing alike, as every food is eaten: Fettah 2026-10-18, "a single sentence for them so the user will not get confused")
const useWord = (d: Def) => (d.use?.sound === 'eat' ? 'Eat it' : d.use?.sound === 'drink' ? 'Drink' : d.use?.sound === 'smoke' ? 'Smoke one' : d.category === 'medical' ? 'Treat' : 'Use it');
/** what putting a thing in its place on the body is called */
const wearWord = (d: Def) => (d.category === 'clothing' ? 'Wear it' : d.slot === 'holster' ? 'Holster it' : 'Sling it on your back');
/** can it be held in the hands and carried nowhere else? (A gun, a thing to hit with and clothes need a place: see `takeUp` in src/game/game.ts.) */
const holdable = (d: Def) => d.category !== 'clothing' && !d.weapon && !d.melee;

export class InventoryUI {
  root: HTMLDivElement;
  isOpen = false;
  /** `paintAhead`: the frames it has still to stand, when it may begin, and whether it has been done in this page */
  private aheadLeft = 0;
  private aheadFrom = 0;
  private aheadDone = false;
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
  /** the choices of how things are shown, open under the gear by "Carried" */
  private viewOpen = false;
  /** the words typed in the search box under "Carried" (none: nothing is dimmed), and the box, made once (see `findEl`) */
  private terms: string[] = [];
  private findBox: HTMLLabelElement | null = null;
  /** "Fits my guns" over a crate or body (idea 11): on, it stays on from one crate to the next until pressed again */
  private fitsOnly = false;
  /** while it is on: the guns carried, and everything in the open crate (its bags too), which is lit or dimmed by them */
  private fitting: { guns: string[]; crate: Set<ItemInstance> } | null = null;
  /** the pockets and bags folded away (by their names): a click on the bar over one folds it, and opens it again */
  private folded = new Set<string>();
  private drag: Drag | null = null;
  private hoverOutline: HTMLDivElement;
  private vitals: Vitals | null = null;
  private hover: Source | null = null;
  private menu: HTMLDivElement | null = null;
  /** the thing the menu is open on: G and the number keys act on it there as on a thing pointed at */
  private menuSrc: Source | null = null;
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
   * Idea 9, "New" marker: what was carried when this was last shut (by number; null: not yet looked at), and what
   * has come in since and not yet been hovered. Things taken while it is open were seen being taken, and are not new.
   */
  private known: Set<string> | null = null;
  private fresh = new Set<string>();
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
      // (typing in the search box: a G or a number is a letter there, not a drop or a hot key)
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'KeyR' && this.drag) {
        this.drag.rot = !this.drag.rot;
        this.styleGhost();
        // (the outline is drawn again where the pointer is: a key press says nothing of where that is)
        this.onMove({ clientX: this.at.x, clientY: this.at.y } as PointerEvent);
      }
      // hover an item and press G: it goes on the ground
      const on = this.hover ?? this.menuSrc;
      if (e.code === 'KeyG' && !this.drag && on && on.kind !== 'ground') {
        const src = on;
        this.closeMenu();
        this.detach(src);
        this.actions.drop(src.item);
        this.finish('drop');
        return;
      }
      // point at anything carried and press a number: it goes on that hot key (1 to 9, and 0)
      const q = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(e.code);
      if (q >= 0 && !this.drag && on && on.kind !== 'ground' && this.carried(on)) {
        this.closeMenu();
        this.actions.assignHot(on.item, q);
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
    // A press on nothing lets the chosen thing go (there was no way to). Not on a thing, the inspector under the
    // grids with what it offers, a menu or card, the hot keys, the figure, or anything that is pressed for itself.
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.selected || e.button !== 0 || this.drag || onFigure(e)) return;
      if ((e.target as Element | null)?.closest(KEEPS_CHOSEN)) return;
      this.selected = null;
      this.render();
    });
    this.veil[0].className = 'inv-veil';
    this.veil[1].className = 'inv-veil inv-veil-band';
    // (where the figure stands on the page is found again when the window is another size, or the column it is in is scrolled)
    window.addEventListener('resize', () => {
      this.figMoved = true;
      if (this.isOpen) this.fitGrids();
    });
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

  /**
   * Got ready out of sight before the first opening: every item's picture decoded (and kept), and the veil with the
   * figure's hole in it laid over the screen, all but clear, for a few frames. The first opening did both in its own
   * frame, 0.6 to 0.8 seconds measured (2026-10-17): the veil's blur and cut half of it, as the browser makes what it
   * draws them with the first time it is asked, and the pictures most of the rest.
   */
  warm() {
    if (this.decoded.length) return;
    for (const url of new Set(Object.values(this.icons))) {
      if (!url) continue;
      const img = new Image();
      img.src = url;
      void img.decode().catch(() => {});
      this.decoded.push(img);
    }
    const w = document.createElement('div');
    w.className = `inv show fig-live${this.root.classList.contains('veil-plain') ? ' veil-plain' : ''}`;
    w.style.opacity = '0.004';
    w.style.pointerEvents = 'none';
    w.setAttribute('aria-hidden', 'true');
    for (const cls of ['inv-veil', 'inv-veil inv-veil-band']) {
      const v = document.createElement('div');
      v.className = cls;
      for (const [k, x] of [['--fig-l', '420px'], ['--fig-t', '120px'], ['--fig-r', '760px'], ['--fig-b', '640px']]) v.style.setProperty(k, x);
      w.append(v);
    }
    this.root.after(w);
    let n = 0;
    const tick = () => void (++n < 5 ? requestAnimationFrame(tick) : w.remove());
    requestAnimationFrame(tick);
  }
  private decoded: HTMLImageElement[] = [];

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

  /** how much smaller than its squares' own size the grid a thing is in is drawn, to fit (see `fitGrids`): 1, as it is */
  private scaleOf(el: Element): number {
    return parseFloat(el.closest<HTMLElement>('.inv-grid')?.style.zoom ?? '') || 1;
  }

  /**
   * Every grid as wide as the side it stands in has room for, or narrower: one that would not fit is drawn smaller,
   * every square alike (the owner, 2026-10-24: "i dont want horizontal scroll bars in the inventory or vicinity can we
   * make sure all containers and their widths fit properly, shrink them if needed"). It scrolled sideways before.
   */
  private fitGrids() {
    for (const g of this.root.querySelectorAll<HTMLElement>('.inv-grid')) {
      const box = g.closest<HTMLElement>('.inv-gridbox'), room = box?.parentElement;
      if (!box || !room || !room.clientWidth) continue;
      const rs = getComputedStyle(room), bs = getComputedStyle(box);
      const free = room.clientWidth - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight) - parseFloat(bs.marginLeft) - parseFloat(bs.marginRight) - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight) - parseFloat(bs.borderLeftWidth) - parseFloat(bs.borderRightWidth) - 2;
      const natural = parseFloat(g.style.width) || 0;
      const zoom = natural > free && free > 0 ? String(Math.max(0.35, Math.floor((free / natural) * 1000) / 1000)) : '';
      if (g.style.zoom !== zoom) g.style.zoom = zoom;
    }
  }

  open(vicinity: WorldItem[], stash: Stash | null, vitals: Vitals) {
    this.endAhead();
    this.cancelDrag();
    this.vicinity = vicinity;
    this.stash = stash;
    this.stashState = '';
    this.vitals = vitals;
    this.isOpen = true;
    const now = this.everyUid();
    if (this.known) for (const uid of now) if (!this.known.has(uid)) this.fresh.add(uid);
    for (const uid of this.fresh) if (!now.has(uid)) this.fresh.delete(uid);
    this.root.classList.add('show');
    this.render();
  }

  /** What is carried now is not new: a save loaded, or a new life's kit (the game's to call). */
  settle() {
    this.known = this.everyUid();
    this.fresh.clear();
  }

  /** the number of every thing carried, worn or inside another */
  private everyUid() {
    const out = new Set<string>();
    const walk = (it: ItemInstance) => {
      out.add(it.uid);
      for (const p of it.cargo ?? []) walk(p.item);
    };
    for (const it of Object.values(this.inv.slots)) if (it) walk(it);
    for (const c of this.inv.containers) for (const p of c.items) walk(p.item);
    return out;
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

  private drawn = 0;
  private due = false;
  /** the grid whose kinds are being offered under its chip (see gridBox), or null */
  private typing: string | null = null;

  /**
   * The pockets changed under it (a magazine gone in once the gun was up, a reload done, a tag put on): drawn again
   * on the next frame, once however many changes come in it, and not at all if it was drawn since. Until 2026-10-23
   * nothing drew it then, and the change showed at the next 5 s refresh or the next click (the owner: "when i swap my
   * magaizines out it takes a second for it to show in my inventory").
   */
  soon() {
    if (!this.isOpen || this.due) return;
    this.due = true;
    const at = this.drawn;
    requestAnimationFrame(() => {
      this.due = false;
      if (this.drawn === at && this.isOpen && !this.drag && !this.menu) this.render();
    });
  }

  /** is this thing lying among what the Vicinity shows? (loot taken elsewhere on the map leaves the screen alone) */
  shows(uid: string) {
    return this.vicinity.some((w) => w.loot.uid === uid);
  }

  /** a message in place of the open container's grid (waiting for the server), '' to show the grid */
  setStashState(text: string) {
    this.stashState = text;
    if (this.isOpen && !this.drag) this.render();
  }

  /**
   * What `warm` began behind the menu, finished two seconds into the first play of a page: the inventory itself
   * painted where nobody sees it, with what is carried in it (behind the menu there is nothing in it to paint). The
   * first time the browser painted its columns, pictures and outlines, its graphics process wrote what it draws them
   * with: the first Tab's frame was 320 to 390 ms against 55 to 110 for every Tab after (traced 2026-10-24, the card's
   * raster 292 ms of it). Shown at nearly nothing for a few frames, as it is laid over the world when it is opened,
   * most of that is paid where nobody is looking: 190 to 200 ms after it, the raster 175. Nothing of the game's is
   * told it is open: the hands, the keys and the map go on as they were.
   * (Not the figure: it is drawn into the game's own picture, whole, however faint the page is. Its first drawing is
   * 13 ms with the card's part, measured, and the veil round it was got ready by `warm`.)
   * @param may it may be done now (in play, alive, nothing open)
   */
  paintAhead(may: boolean, vicinity: () => WorldItem[], vitals: Vitals) {
    if (this.aheadLeft) {
      if (--this.aheadLeft === 0) this.endAhead();
      return;
    }
    if (this.aheadDone || !may) {
      this.aheadFrom = 0;
      return;
    }
    const now = performance.now();
    if (!this.aheadFrom) this.aheadFrom = now + AHEAD_AFTER;
    if (now < this.aheadFrom) return;
    this.aheadDone = true;
    this.aheadLeft = AHEAD_FRAMES;
    this.vicinity = vicinity();
    this.vitals = vitals;
    // (and as it is laid over the world when the figure is in it, as it is the first time it is opened)
    this.root.classList.add('show', 'ahead', 'fig-live');
    this.render();
  }

  /** done standing unseen (or opened in earnest meanwhile) */
  private endAhead() {
    if (!this.root.classList.contains('ahead')) return;
    this.aheadLeft = 0;
    this.root.classList.remove('ahead');
    if (!this.figLive) this.root.classList.remove('fig-live');
    if (!this.isOpen) this.root.classList.remove('show');
  }

  close() {
    if (this.isOpen) this.known = this.everyUid();
    this.isOpen = false;
    this.viewOpen = false;
    this.hover = null;
    // (what was looked for is not looked for still the next time it is opened, with half of it dimmed for no reason seen)
    this.terms = [];
    if (this.findBox) this.findBox.querySelector('input')!.value = '';
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

  /** the head of the card, the same at every depth (src/ui/inv-card.ts): its picture, its kind, its name */
  private cardHead(it: ItemInstance): string {
    const d = ITEMS[it.id], url = this.iconOf(it);
    return `<div class="card-head"><div class="card-img" style="${url ? `background-image:url(${url})` : ''}"></div><div><small>${kindOf(d)}${d.slot && d.category === 'clothing' ? ` · ${this.placeName(d)}` : ''}</small><b>${itemName(it)}</b></div>${kindIcon(it.id)}</div>`;
  }

  /**
   * Everything said of a thing: what was on the card and in the inspector, once.
   */
  private stats(src: Source): Stat[] {
    const it = src.item, d = ITEMS[it.id];
    const s: Stat[] = [];
    s.push({ k: 'Weight', v: `${itemWeight(it).toFixed(2)} kg` }, { k: 'Size', v: `${d.w}×${d.h}` });
    if (d.stack) s.push({ k: 'In the pile', v: `${it.qty} of ${d.stack}` });
    if (d.use?.sips) s.push({ k: 'Drinks left', v: `${it.left ?? d.use.sips} of ${d.use.sips}` });
    if (d.weapon) {
      s.push({ k: 'Rounds', v: d.weapon.mag ? (it.mag ? `${it.loaded ?? 0} of ${magRoom(it)}` : `${it.loaded ?? 0}, and no magazine in it`) : `${it.loaded ?? 0} of ${capacityOf(it)}` });
      if (d.weapon.mag) s.push({ k: 'Magazine', v: it.mag ? ITEMS[it.mag]?.name ?? it.mag : 'None in it' });
      s.push({ k: 'Fitted', v: it.mods?.length ? it.mods.map((m) => ITEMS[m]?.name ?? m).join(', ') : 'Nothing' });
    }
    if (d.mag) s.push({ k: 'Rounds', v: `${it.rounds ?? 0} of ${d.mag.capacity}` });
    if (d.melee) s.push({ k: 'Damage', v: String(d.melee.damage) });
    if (holds(it.id)) s.push({ k: 'Inside', v: it.cargo?.length ? things(it.cargo.length) : 'Nothing' });
    const vs = this.against(src);
    if (vs) s.push({ k: vs.label, v: vs.change });
    if (d.wear?.armor) s.push({ k: 'Chest hits', v: `−${pct(1 - d.wear.armor)}%` });
    if (d.wear?.fall) s.push({ k: 'Fall damage', v: `−${pct(1 - d.wear.fall)}%` });
    const hd = handlingOf(it);
    if (hd) s.push({ k: 'Handling', v: `${Math.round(hd.ergo)} / 100` });
    if (d.attach) s.push({ k: 'Fits', v: d.attach.fits.map((f) => ITEMS[f].name).join(', ') });
    if (it.id === 'dogtag') {
      s.push({ k: 'Owner', v: tagOwner(it) });
      if (it.gold) s.push({ k: 'Plated', v: 'Gold: a VIP’s' });
      s.push({ k: 'Cashes in', v: it.pid === this.selfId ? 'never: it is yours' : this.counting(it) ? tagClock(it) : `after ${TAG_HOLD_MIN} min carried`, clock: this.counting(it) ? it.uid : undefined });
    }
    const key = this.actions.hotIndex(it);
    if (key >= 0) s.push({ k: 'On key', v: String((key + 1) % 10) });
    return s;
  }

  private statHtml(list: Stat[]): string {
    return list.map((s) => `<div><span>${s.k}</span><b${s.clock ? ` data-clock="${s.clock}"` : ''}>${s.v}</b></div>`).join('');
  }

  /**
   * Every deed with the keys that do it (src/ui/inv-card.ts `rows`): what the menu lists and the small card picks
   * its one or two from, so the two cannot say different things. The keys are asked of the clicks themselves.
   */
  private keyed(src: Source): Row[] {
    const acts = this.actionsFor(src);
    const keys: [string, Deed][] = [[KEY.use, this.useIt(src)], [KEY.across, this.across(src)], [KEY.wield, this.wield(src)]];
    // (Shift-click as `quickMove` has it: across where there is an across, else what stands first)
    const main = acts.find((a) => a.primary);
    if (src.kind === 'ground' || (this.stash && !this.stashState)) keys.push([KEY.quick, this.across(src)]);
    else if (main?.id) keys.push([KEY.quick, { label: main.label, id: main.id, icon: main.icon, run: main.run }]);
    const drop = acts.find((a) => a.id === 'drop');
    if (drop && src.kind !== 'ground') keys.push([KEY.drop, { label: drop.label, id: 'drop', icon: drop.icon, run: drop.run }]);
    return rows(acts, keys);
  }

  /**
   * The card by the pointer: everything there is to know of the thing, and nothing of what to do with it (Fettah,
   * 2026-10-18: the hover card is "an info card"; the keys are the menu's). It took in the inspector's full stats.
   * Its head is the menu's head too, so the one reads as the other turned over.
   */
  private cardHtml(src: Source): string {
    const d = ITEMS[src.item.id], what = does(d, src.item), note = this.heldNote(src);
    return this.cardHead(src.item)
      + (what ? `<p class="card-does">${what}</p>` : '')
      + `<p class="card-desc">${d.desc}</p>`
      + (note ? `<p class="card-note">${note}</p>` : '')
      + `<div class="card-rows">${this.statHtml(this.stats(src))}</div>`
      + `<p class="card-more">Right-click for actions</p>`;
  }

  /** said of a thing in the hands */
  private heldNote(src: Source): string {
    if (this.actions.inHands() !== src.item) return '';
    return src.kind === 'loose' ? 'In your hands and nowhere else: put away, it goes on the ground unless there is room for it.' : 'In your hands: used with the left button, held, once this is shut.';
  }

  /**
   * A vest, bag or other gear with room in it, not yet worn, set against what is worn in its place (Idea 12,
   * Fettah 2026-10-18: "+12 slots, +1.8 kg"). The weight is of the gear alone, not what is in it, which is moved either way.
   */
  private against(src: Source): { label: string; change: string } | null {
    const it = src.item, d = ITEMS[it.id], room = d.wear?.cargo;
    if (!room || !d.slot || src.kind === 'slot' || src.kind === 'fitted') return null;
    const now = Object.values(this.inv.slots).find((w) => w && w !== it && ITEMS[w.id].slot === d.slot) ?? null;
    if (now === it) return null;
    const cells = (id: string | undefined) => { const c = id ? ITEMS[id].wear?.cargo : undefined; return c ? c[0] * c[1] : 0; };
    const dc = room[0] * room[1] - cells(now?.id), dw = d.weight - (now ? ITEMS[now.id].weight : 0);
    const part = (n: number, unit: string, worse: boolean) => `<em class="${n === 0 ? '' : worse ? 'worse' : 'better'}">${n > 0 ? '+' : '−'}${unit}</em>`;
    const slots = dc === 0 ? 'same slots' : part(dc, `${Math.abs(dc)} slot${Math.abs(dc) === 1 ? '' : 's'}`, dc < 0);
    const kg = Math.abs(dw) < 0.05 ? 'same weight' : part(dw, `${Math.abs(dw).toFixed(1)} kg`, dw > 0);
    return { label: now ? `Instead of the ${ITEMS[now.id].name}` : 'Worn, it adds', change: `${slots}, ${kg}` };
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
    // (what kind of thing it is, in its corner: what stood there was the count of a gun's attachments, which its card says)
    t.push(kindIcon(item.id));
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
    if (this.fresh.has(item.uid)) t.push('<span class="new">New</span>');
    return t.join('');
  }

  /**
   * What is carried for the gun in the hands, by "Carried": its magazines and every round that feeds it, in them,
   * loose and in boxes (not what is in the gun itself). Nothing with no gun in the hands. (Idea 4, Fettah 2026-10-18:
   * "AK: 3 mags · 81 rounds".)
   */
  private ammoLine() {
    const gun = this.actions.inHands(), w = gun && ITEMS[gun.id].weapon;
    if (!gun || !w) return '';
    const carried = pileGrids(this.inv).flatMap((c) => c.items.map((p) => p.item));
    const mags = w.mag ? carried.filter((it) => magFits(it, gun)) : [];
    const inMags = mags.reduce((n, it) => n + (it.rounds ?? 0), 0);
    const loose = carried.filter((it) => it.id === w.ammo).reduce((n, it) => n + it.qty, 0);
    const boxed = carried.reduce((n, it) => n + (ITEMS[it.id].open?.gives === w.ammo ? ITEMS[it.id].open!.qty : 0), 0);
    const all = inMags + loose + boxed;
    const tip = `Carried for the ${ITEMS[gun.id].name}, not counting what is in it: ${mags.length ? `${inMags} in ${mags.length} magazine${mags.length === 1 ? '' : 's'}, ` : ''}${loose} loose, ${boxed} in boxes`;
    return `<em class="inv-ammo${all ? '' : ' none'}" title="${tip}">${ITEMS[gun.id].name}: ${w.mag ? `${mags.length} mag${mags.length === 1 ? '' : 's'} · ` : ''}${all} round${all === 1 ? '' : 's'}</em>`;
  }

  /** The gear by "Carried", and, open, the choices under it: things in their kinds' colours, the symbols, and those in colour. */
  private viewEl() {
    // (the symbols' colours mean nothing with no symbols shown: that choice waits, greyed, until they are)
    const box = (k: keyof typeof kindView, label: string, off = false) =>
      `<label${off ? ' class="off"' : ''}><input type="checkbox" data-view="${k}"${kindView[k] ? ' checked' : ''}${off ? ' disabled' : ''}> ${label}</label>`;
    return `<button type="button" class="inv-view${this.viewOpen ? ' on' : ''}" title="How things are shown"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13.3 5.5L14 1.6L18 1.6L18.7 5.5A10.8 10.8 0 0 1 21.5 6.7L24.7 4.4L27.6 7.3L25.3 10.5A10.8 10.8 0 0 1 26.5 13.3L30.4 14L30.4 18L26.5 18.7A10.8 10.8 0 0 1 25.3 21.5L27.6 24.7L24.7 27.6L21.5 25.3A10.8 10.8 0 0 1 18.7 26.5L18 30.4L14 30.4L13.3 26.5A10.8 10.8 0 0 1 10.5 25.3L7.3 27.6L4.4 24.7L6.7 21.5A10.8 10.8 0 0 1 5.5 18.7L1.6 18L1.6 14L5.5 13.3A10.8 10.8 0 0 1 6.7 10.5L4.4 7.3L7.3 4.4L10.5 6.7A10.8 10.8 0 0 1 13.3 5.5ZM16 11.2A4.8 4.8 0 1 0 16.01 11.2Z"/></svg></button>` +
      (this.viewOpen ? `<div class="inv-view-menu">${box('colors', 'Show type colors')}${box('icons', 'Show icons')}${box('iconColors', 'Show icon colors', !kindView.icons)}${box('weights', 'Show bag weights')}</div>` : '');
  }

  private wireView(col: HTMLElement) {
    col.querySelector<HTMLButtonElement>('.inv-view')?.addEventListener('click', () => {
      this.viewOpen = !this.viewOpen;
      this.render();
    });
    col.querySelectorAll<HTMLInputElement>('[data-view]').forEach((b) =>
      b.addEventListener('change', () => {
        setKindView({ [b.dataset.view!]: b.checked });
        if (b.dataset.view === 'icons' || b.dataset.view === 'weights') this.render();
      }),
    );
    if (!this.viewOpen) return;
    // (a press anywhere but on the gear or its choices puts them away)
    const away = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest('.inv-view, .inv-view-menu')) return;
      window.removeEventListener('pointerdown', away, true);
      if (!this.viewOpen) return;
      this.viewOpen = false;
      this.render();
    };
    window.addEventListener('pointerdown', away, true);
  }

  /**
   * The chosen thing is ringed; what feeds it or is fed by it (its rounds, its magazines, the guns they go in) is lit
   * beside it. While something is searched for, what is found is lit in the same way and the rest dimmed.
   */
  private mark(item: ItemInstance) {
    if (item === this.selected) return ' sel';
    if (this.terms.length) return searchMatch(item, this.terms, kindOf(ITEMS[item.id])) ? ' kin' : ' dim';
    if (this.fitting?.crate.has(item)) return fitsGuns(item, this.fitting.guns) ? ' kin' : ' dim';
    return this.selected && goesWith(this.selected.id, item.id) ? ' kin' : '';
  }

  /** The search box under "Carried": made once and put back each time this is drawn, so what is typed and the caret stay. */
  private findEl() {
    if (this.findBox) return this.findBox;
    const box = (this.findBox = document.createElement('label'));
    box.className = 'inv-find';
    box.title = 'Dims everything that does not match: a name, a kind (medical, food) or the rounds a gun or magazine takes (9mm)';
    box.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 1a5.5 5.5 0 0 1 4.4 8.8l3.9 3.9-1.1 1.1-3.9-3.9A5.5 5.5 0 1 1 6.5 1Zm0 1.6a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8Z"/></svg><input type="text" placeholder="Search" spellcheck="false" autocomplete="off"><button type="button" title="Clear">×</button>`;
    const input = box.querySelector('input')!;
    const find = () => {
      const at = input.selectionStart;
      this.terms = searchTerms(input.value);
      box.classList.toggle('on', input.value !== '');
      this.render();
      // (drawn afresh, the box was taken out and put back, which lets go of the keys)
      input.focus();
      input.setSelectionRange(at, at);
    };
    input.addEventListener('input', find);
    box.querySelector('button')!.addEventListener('click', (e) => {
      e.preventDefault();
      input.value = '';
      find();
    });
    input.addEventListener('keydown', (e) => {
      // Escape empties it first, and only an empty box lets Escape shut the inventory; Enter and Tab put the keys back to the game
      if (e.key === 'Escape' && input.value) {
        e.stopPropagation();
        input.value = '';
        find();
      } else if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') {
        if (e.key === 'Tab') e.preventDefault();
        input.blur();
      }
    });
    return box;
  }

  private itemEl(item: ItemInstance, w: number, h: number, rot: boolean) {
    const d = ITEMS[item.id];
    const el = document.createElement('div');
    // (a VIP's own dog tag is gold: the store's, src/game/my-perks.ts)
    el.className = `inv-item cat-${d.category}` + this.mark(item) + (item.gold ? ' gold' : '');
    el.style.width = `${w * CELL - 2}px`;
    el.style.height = `${h * CELL - 2}px`;
    const img = document.createElement('div');
    img.className = 'inv-item-img';
    const url = this.iconOf(item);
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
    // (Kept between drawings, by the grid: each thing in it is drawn again only when what it shows of itself has
    // changed, and moved where it now lies; what is gone from it is taken out. A move puts in and takes out the thing
    // moved, and the browser has nothing else of the grid to lay out or style again.)
    const key = `${c.id}#${oid(c)}`;
    let kept = this.gridEls.get(key);
    if (!kept) {
      const g = document.createElement('div');
      g.className = 'inv-grid';
      g.dataset.container = c.id;
      this.gridEls.set(key, (kept = { g, items: new Map() }));
    }
    const g = kept.g;
    const width = `${c.w * CELL}px`, height = `${rows * CELL}px`;
    if (g.style.width !== width) g.style.width = width;
    if (g.style.height !== height) g.style.height = height;
    const now = new Set<string>();
    for (const p of c.items) {
      const [w, h] = Container.size(p.item, p.rot);
      const look = `${oid(p.item)}|${this.look(p.item)}|${w},${h},${p.rot ? 1 : 0}`;
      let e = kept.items.get(p.item.uid);
      if (!e || e.look !== look) {
        const el = this.itemEl(p.item, w, h, p.rot);
        this.bindItem(el, { kind: 'container', c, item: p.item });
        if (e) e.el.replaceWith(el);
        kept.items.set(p.item.uid, (e = { el, look }));
      }
      const left = `${p.x * CELL + 1}px`, top = `${p.y * CELL + 1}px`;
      if (e.el.style.left !== left) e.el.style.left = left;
      if (e.el.style.top !== top) e.el.style.top = top;
      if (e.el.parentElement !== g) g.appendChild(e.el);
      now.add(p.item.uid);
    }
    for (const [uid, e] of kept.items) {
      if (now.has(uid)) continue;
      e.el.remove();
      kept.items.delete(uid);
    }
    return g;
  }
  /** each grid as it was last drawn, and the element of each thing in it (see gridEl) */
  private gridEls = new Map<string, { g: HTMLElement; items: Map<string, { el: HTMLElement; look: string }> }>();

  /**
   * The survivor's own dog tag, round their neck: shown, and that is all. It is not picked
   * up, moved or dropped; whoever kills them takes it off the body.
   */
  private neckEl() {
    const tag = this.inv.neck;
    // (not yet: it is put on once they have been alive long enough)
    if (!tag) {
      const left = Math.ceil((this.inv.neckDue - Date.now()) / 60000);
      return this.inv.neckDue && left > 0 ? `<div class="inv-neck" title="Your own dog tag is put round your neck once you have been alive ${TAG_FRESH / 60} minutes${ZONA_VOID ? ' inside the Zona: its clock stands still outside it' : ''}. Until then, nobody who kills you finds one on you."><div class="inv-item-img fit"></div><div><b>Your dog tag</b><span>Round your neck in ${left} min${ZONA_VOID ? ' in the Zona' : ''}</span></div></div>` : '';
    }
    const url = this.icons[tag.id];
    return `<div class="inv-neck" title="Your own dog tag. It hangs round your neck: it cannot be moved or dropped, and whoever kills you takes it off your body."><div class="inv-item-img fit" style="${url ? `background-image:url(${url})` : ''}"></div><div><b>${itemName(tag)}</b><span>Round your neck · cannot be dropped</span></div></div>`;
  }

  /**
   * a grid with its bar over it, as DayZ has it: its name, how much of it is taken up, and a click folds it away
   * @param where the place on the body the thing it is the inside of is worn in, written small after its name
   */
  private gridBox(c: Container, where = '', close?: () => void) {
    // (Each grid's box is kept between drawings, by the grid and where it is said to be: its bar is built again only
    // when what the bar says has changed, and what lies in it is put in and taken out one thing at a time (`gridEl`).)
    const key = `${c.id}#${oid(c)}#${where}`;
    let kept = this.gboxes.get(key);
    if (!kept) this.gboxes.set(key, (kept = { box: document.createElement('div'), said: '' }));
    const box = kept.box;
    // (a bag opened inside another is closed by its arrow, the whole header: no word "close" beside it, idea 16, Fettah 2026-10-18)
    const shut = !close && this.folded.has(c.id);
    // An admin's hold (src/sim/inventory.ts): it has no bottom, so there is no "of how many" to say of it. It says
    // how many things lie in it and whether it still takes any. It is drawn whole, as tall as what is in it and a
    // few rows more, and is scrolled to with everything else on this side; narrower than itself, it scrolls sideways.
    const hold = c === this.inv.theHold;
    // (A grid nine across or more, a Field Rucksack since 2026-10-13 and the hold, is wider than the narrower side
    // of this screen has room for when it is opened there, on a body: it is marked, and scrolls sideways by itself
    // wherever it stands in less room than it is wide. Nothing is ever off the edge.)
    box.className = 'inv-gridbox' + (shut ? ' shut' : '') + (hold ? ' inv-hold' : '') + (c.w >= 9 ? ' wide' : '');
    box.dataset.o = String(oid(c));
    // (a bag's room taken, "13 / 20", is not said any more: Fettah 2026-10-18, "not much use for it"; the tag pouch and the hold still say theirs)
    // (what a bag's things weigh, idea 6, Fettah 2026-10-18: "so you can see which bag to drop", drawn as their share of all
    // that is carried, a percentage and a weight; nothing on an empty one, nor with the choice by "Carried" off)
    const kg = hold || c === this.inv.tags || !c.items.length || !kindView.weights ? 0 : gridWeight(c);
    const all = kg && (this.weighed ?? this.inv.weight()), share = all ? Math.min(1, kg / all) : 0;
    const said = hold ? `${c.items.length} thing${c.items.length === 1 ? '' : 's'} · ${this.inv.bottomless ? 'never fills' : 'shut'}` : c === this.inv.tags ? `${c.items.length} / ${c.w * c.h} · taken off others` : '';
    // (its share of the whole is said again after every drawing, `shares`: the whole changes with every move)
    const weighs = kg ? `<span class="inv-bagkg" data-kg="${kg}">${Math.round(share * 100)}%${WEIGHT_ICON}</span>` : '';
    const tip = kg ? `What is in it weighs ${kg.toFixed(2)} kg: ${Math.round(share * 100)}% of the ${all.toFixed(1)} kg you carry. ` : hold ? (this.inv.bottomless ? 'An admin’s power is on: whatever finds no room in what you wear goes in here, and there is always room. /bottomless off puts it off. ' : 'The power is off: nothing more goes in here, and what is in it can be taken out. ') : '';
    // (a grid of what is carried, open, with two things or more in it and not sorted already, can be sorted: packed tight, kind by kind)
    // (the crate or body open can be sorted too, as well as what is carried)
    const sorts = !shut && c.items.length > 1 && c !== this.inv.tags && (this.inv.containers.some((x) => x.id === c.id) || c === this.stash?.container) && wouldSort(c);
    const sortBtn = sorts ? `<button type="button" class="inv-sort" title="Sort: pack it tight, kind by kind"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 6H28V10H4ZM4 14H21V18H4ZM4 22H14V26H4Z"/></svg></button>` : '';
    // (what is worn that has room is set For a kind with the chip by its name, the kinds offered under it: inv-types.ts)
    const kind = typable(c) ? bagFor(c) : undefined;
    const forBtn = kind !== undefined ? `<button type="button" class="inv-for${kind ? ' set' : ''}" title="What goes in here first: things of this kind you take, buy or sort go here by themselves">${kind ? BAG_FOR.find((k) => k.id === kind)!.label : 'For…'}</button>` : '';
    const bar = `<h4 title="${tip}${close ? 'Close it' : shut ? 'Open it' : 'Fold it away'}" data-tail="${close ? 'Close it' : shut ? 'Open it' : 'Fold it away'}"><i>${shut ? '▸' : '▾'}</i>${c.name}${where ? `<small>${where}</small>` : ''}${forBtn}${sortBtn}${said ? ` <span>${said}</span>` : weighs}</h4>`;
    const grid = shut ? null : this.gridEl(c);
    if (kept.said === bar + (this.typing === c.id ? '|t' : '')) {
      if (grid && box.lastChild !== grid) box.appendChild(grid);
      if (!grid && box.lastChild instanceof HTMLElement && box.lastChild.classList.contains('inv-grid')) box.lastChild.remove();
      return box;
    }
    kept.said = bar + (this.typing === c.id ? '|t' : '');
    // (the bar, and the kinds offered under it: built again; the grid under them kept as it stands)
    for (const n of [...box.childNodes]) if (n !== grid) n.remove();
    const head = document.createElement('div');
    head.innerHTML = bar;
    box.insertBefore(head.firstChild!, box.firstChild);
    box.querySelector('h4')!.addEventListener('click', () => {
      if (close) return close();
      if (!this.folded.delete(c.id)) this.folded.add(c.id);
      this.render();
    });
    box.querySelector('.inv-sort')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sortGrid(c)) this.finish('move');
      else this.actions.note(`The ${c.name.toLowerCase()} is as tidy as it gets`);
    });
    box.querySelector('.inv-for')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.typing = this.typing === c.id ? null : c.id;
      this.render();
    });
    if (this.typing === c.id) {
      const pick = document.createElement('div');
      pick.className = 'inv-for-pick';
      for (const k of [...BAG_FOR, null]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = (k?.id ?? null) === kind ? 'on' : '';
        b.textContent = k ? k.label : 'Anything';
        b.addEventListener('click', () => {
          setBagFor(c, k?.id ?? null);
          this.typing = null;
          this.actions.note(k ? `${k.label} goes into the ${c.name.toLowerCase()} first` : `Anything goes into the ${c.name.toLowerCase()}`);
          // (it is on the bag: the server is told with the rest of what is carried, and keeps it)
          this.actions.changed();
          this.render();
        });
        pick.appendChild(b);
      }
      box.insertBefore(pick, box.querySelector('h4')!.nextSibling);
    }
    if (grid && box.lastChild !== grid) box.appendChild(grid);
    return box;
  }
  /** each grid's box as it was last drawn, and what its bar said (see gridBox) */
  private gboxes = new Map<string, { box: HTMLElement; said: string }>();

  /** The hands: what is in them, and a place to let a thing go to take it into them. */
  private handsEl() {
    const s = document.createElement('div');
    const item = this.actions.inHands();
    s.className = 'inv-slot slot-inhands' + (item ? '' : ' empty');
    s.dataset.hands = '1';
    s.innerHTML = `<div class="slot-label">${slotKey(item ? this.actions.hotIndex(item) : -1)}In your hands</div>`;
    if (item) {
      const el = document.createElement('div');
      el.className = 'inv-item in-slot' + this.mark(item);
      const url = this.iconOf(item);
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
      // (a magazine on its way in, the gun being taken up for it or the hands at it, is shown going in: it is in when they are done)
      const coming = slot === 'magazine' ? this.actions.goingIn(gun) : null;
      const cell = document.createElement('div');
      cell.className = 'inv-part' + (mod || coming ? '' : ' empty') + (coming ? ' coming' : '');
      cell.dataset.part = slot;
      cell.dataset.gun = gun.uid;
      cell.dataset.o = String(oid(gun));
      const inMag = slot === 'magazine' && mod ? Math.max(0, (gun.loaded ?? 0) - ((gun.loaded ?? 0) > 0 ? 1 : 0)) : 0;
      if (coming) {
        cell.innerHTML = `<span>Mag</span><div class="inv-item-img fit" style="background-image:url(${this.icons[coming] ?? ''})"></div><em>in…</em>`;
        cell.title = `${ITEMS[coming].name}: going in`;
        row.appendChild(cell);
        continue;
      }
      // (A magazine comes out as every part does: dragged off, double-clicked or right-clicked. The Out on it was taken
      // off again, the owner, 2026-10-24: "the out tags on the mags on the guns make no sense".)
      cell.innerHTML = `<span>${label}</span>` + (mod ? `<div class="inv-item-img fit" style="background-image:url(${this.icons[mod] ?? ''})"></div>${slot === 'magazine' ? `<em>${inMag}/${ITEMS[mod].mag?.capacity ?? 0}</em>` : ''}` : '');
      cell.title = mod ? `${ITEMS[mod].name}: double-click or drag it off to take it out` : `${label}: drag one here`;
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
  /**
   * A body as your own side is drawn: a strip of what it wears and carries slung, then each thing it wears that has
   * room as a panel (`openBags`), then whatever else lies on it, loose (the owner, 2026-10-23, the plan: "looting a
   * body mirrors your own side"). Every thing is the body's own, dragged out as from its grid; what is let go on the
   * loose part goes on the body wherever there is room.
   */
  private bodyNodes(box: Container): Node[] {
    const out: Node[] = [];
    const worn = (it: ItemInstance) => { const d = ITEMS[it.id]; return !!(d.slot || d.weapon || d.wear); };
    const row = document.createElement('div');
    row.className = 'inv-strip inv-body-strip';
    for (const p of box.items) {
      if (!worn(p.item)) continue;
      const el = this.itemEl(p.item, 1, 1, false);
      el.classList.add('strip-tile');
      this.bindItem(el, { kind: 'container', c: box, item: p.item });
      row.appendChild(el);
    }
    if (row.childNodes.length) out.push(row);
    this.openBags(out, box);
    const loose = box.items.filter((p) => !worn(p.item));
    const panel = document.createElement('div');
    panel.className = 'inv-gridbox inv-loose';
    panel.dataset.into = '1';
    panel.innerHTML = `<h4>On the body${loose.length ? ` <span>${loose.length}</span>` : ''}</h4>`;
    const tiles = document.createElement('div');
    tiles.className = 'inv-ground-tiles';
    for (const p of loose) {
      const [w, h] = Container.size(p.item, false);
      const el = this.itemEl(p.item, w, h, false);
      el.classList.add('g-tile');
      this.bindItem(el, { kind: 'container', c: box, item: p.item });
      tiles.appendChild(el);
    }
    if (!loose.length) tiles.innerHTML = '<div class="inv-empty">Nothing loose on it. Let a thing go here to put it on the body.</div>';
    panel.appendChild(tiles);
    out.push(panel);
    return out;
  }

  /** what there is of the thing on a key, as the hot bar at the foot of the screen says it: rounds, drinks, how many */
  private hotLabel(it: ItemInstance): string {
    const d = ITEMS[it.id];
    if (d.weapon) return String(it.loaded ?? 0);
    if (d.mag) return String(it.rounds ?? 0);
    if (d.use?.sips) return `${it.left ?? d.use.sips}/${d.use.sips}`;
    return d.melee || d.slot ? '' : String(this.inv.count(it.id));
  }

  /**
   * The hot keys, 1 to 0, as DayZ has them: one row of big squares at the foot of the screen, beneath the hands, each
   * with its number, the thing's picture and what there is of it (the owner, 2026-10-23: "we need to make the hotbar
   * slots much bigger now like dayz's at the bottom beneath hands"). Two rows of them in the survivor's column were
   * cut off at the foot of a 16:9 screen. A thing is dragged onto a key to put it there; a key is dragged off to clear it, or onto
   * another key to move it there (right-click clears it too). The keys themselves are as they were.
   */
  private hotEl() {
    const bar = document.createElement('div');
    bar.className = 'inv-hot big';
    this.inv.hot.forEach((b, i) => {
      const it = b ? this.inv.hotItem(i) : null;
      const cell = document.createElement('div');
      cell.className = 'inv-hotkey' + (b ? (it ? '' : ' gone') : ' empty') + (it && it === this.actions.inHands() ? ' on' : '') + (it && this.mark(it) !== ' sel' ? this.mark(it) : '');
      cell.dataset.hot = String(i);
      const id = it?.id ?? b?.id;
      cell.innerHTML = `<b>${(i + 1) % 10}</b>${id ? `<div class="inv-item-img fit" style="background-image:url(${it ? this.iconOf(it) : this.icons[id] ?? ''})"></div>${kindIcon(id)}<em>${it ? this.hotLabel(it) : ''}</em>` : ''}`;
      cell.title = id ? `${ITEMS[id].name}${it ? '' : ' (none carried)'} · drag it off, or right-click, to clear` : `Key ${(i + 1) % 10}: drag a thing here, or point at it and press ${(i + 1) % 10}`;
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!b) return;
        this.actions.assignHot(null, i);
        this.actions.sound('move');
        this.render();
      });
      if (b) cell.addEventListener('pointerdown', (e) => this.dragKey(e, i));
      bar.appendChild(cell);
    });
    return bar;
  }

  /** A key's thing dragged by the key: let go off the keys, the key is bare; on another key, it is moved there. */
  private dragKey(e: PointerEvent, i: number) {
    if (e.button !== 0) return;
    const from = { x: e.clientX, y: e.clientY };
    const up = (u: PointerEvent) => {
      window.removeEventListener('pointerup', up, true);
      if (Math.hypot(u.clientX - from.x, u.clientY - from.y) < 8) return;
      const onto = (document.elementFromPoint(u.clientX, u.clientY) as HTMLElement | null)?.closest<HTMLElement>('.inv-hotkey');
      const to = onto ? Number(onto.dataset.hot) : -1;
      if (to === i) return;
      const it = this.inv.hotItem(i);
      if (to >= 0 && it) this.actions.assignHot(it, to);
      else this.actions.assignHot(null, i);
      this.actions.sound('move');
      this.render();
    };
    window.addEventListener('pointerup', up, true);
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
    // (2026-10-11 the floating numbers over the places were taken off: "not intuitive". Its key is said again
    // before the place's name, drawn as the same key as on the hot keys, so which gun is on which key is matched at
    // a glance: Fettah 2026-10-18, "so it's clear like which one is which shortcut")
    s.innerHTML = `<div class="slot-label">${slotKey(key)}${SLOT_LABEL[slot]}${hint ? ` <b>${hint}</b>` : ''}</div>`;
    if (item) {
      const el = document.createElement('div');
      el.className = 'inv-item in-slot' + this.mark(item) + (this.actions.inHands() === item ? ' active' : '');
      // (what is worn has a picture of its own for where it is worn: see `slot:` in icons.ts)
      const url = this.icons[`slot:${item.id}`] ?? this.iconOf(item);
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

  /**
   * The screen's standing parts: the columns, and what in them is kept for good (`skeleton`). Each part inside them is
   * a block (`block`), built from what it shows and built again only when that has changed, so that a move redraws
   * the grids it touched and nothing else (the owner, 2026-10-23: "Have we made sure to optimize everything?"). What
   * every part shows the same way, the one chosen, what a search dims, a bag's share of the weight, is put on the
   * parts standing after (`marks`, `shares`), and is no reason to build one again.
   */
  private sk: { vic: HTMLElement; gear: HTMLElement; cargo: HTMLElement; grids: HTMLElement; scroll: HTMLElement; status: HTMLElement; foot: HTMLElement; vicHead: HTMLElement; gearHead: HTMLElement; help: HTMLElement; doll: HTMLElement; dollFig: HTMLElement } | null = null;
  /** the still picture of the figure last put on it */
  private dollShown: string | null = null;
  /** each block as it was last built, by its name, with what it was built from */
  private built = new Map<string, { sig: string; nodes: Node[] }>();
  /** the crate or body open when this was last drawn ('' for none): its scroll is kept while it is the same (see render) */
  private scrolledFor = '';
  /** what all that is carried weighed when this was last drawn (see render) */
  private weighed: number | null = null;
  /** the grids drawn, by their id (for `shares`) */
  private gridsNow = new Map<string, Container>();

  private skeleton() {
    const r = this.root;
    if (this.sk && r.contains(this.sk.vic)) return this.sk;
    r.innerHTML = '';
    this.built.clear();
    this.gridEls.clear();
    this.gboxes.clear();
    const div = (cls: string) => Object.assign(document.createElement('div'), { className: cls });
    const vic = div('inv-col inv-vicinity');
    // the whole column is the ground: let go anywhere on it and the item is dropped
    vic.dataset.ground = '1';
    const vicHead = Object.assign(document.createElement('h3'), { textContent: 'Vicinity' });
    const gear = div('inv-col inv-gear');
    gear.dataset.char = '1';
    const gearHead = Object.assign(document.createElement('h3'), { textContent: 'Character' });
    const cargo = div('inv-col inv-cargo');
    // (let go anywhere on this side that is no grid, a thing is put away wherever there is room for it)
    cargo.dataset.pockets = '1';
    const scroll = div('inv-scroll'), grids = div('inv-grids'), status = div('inv-status');
    // (the figure in the middle of the places for what is worn: as tall as the longer side of them)
    const doll = div('inv-doll'), dollFig = div('doll-fig');
    const rows = Math.max(DOLL_SLOTS[0].length, DOLL_SLOTS[1].length);
    doll.style.height = `${rows * 56 + (rows - 1) * 6}px`;
    this.dollShown = null;
    scroll.appendChild(grids);
    const wrap = div('inv-wrap');
    wrap.append(vic, gear, cargo);
    // The foot of the screen, on the columns' own grid: the clicks under the first two, the hot keys under Carried
    // and as wide as it (Fettah 2026-10-18: "the same width and under the carriage", so the clicks have the room to the
    // left). The clicks are always in sight there and take no room from the grids: each means one thing, wherever
    // the thing lies and whatever else is open. (A finger has no Ctrl and no Alt: it is told what a finger can do.)
    const foot = div('inv-foot');
    // Each a key and what it does, in columns of two rows as tall as the hot keys beside them (Fettah 2026-10-18: "the
    // action and beside it what it does ... almost like columns"); the whole of what it does is on the pointer.
    const help = (pairs: [string, string, string][]) => {
      const cols: string[] = [];
      for (let i = 0; i < pairs.length; i += 2) cols.push(`<div>${pairs.slice(i, i + 2).map(([k, does, all]) => `<span title="${all}"><b>${k}</b><i>${does}</i></span>`).join('')}</div>`);
      return `<div class="inv-help">${cols.join('')}</div>`;
    };
    foot.innerHTML = document.body.classList.contains('touch')
      ? help([
          ['Drag', 'move it', 'Drag a thing to move it: onto your character to wear or hold it, onto another thing to change places, to the left to put it down'],
          ['Tap twice', 'use it', 'Tap twice to use it, or to take it if it is not yours yet'],
          ['Press and hold', 'everything else', 'Press and hold for everything else that can be done with it'],
          ['Fire', 'use what is in hands', 'What is in your hands is used with the fire button once this is shut'],
        ])
      : help([
          ['Drag', 'move it', 'Drag: move it'],
          ['R', 'turn it', 'R: turn it'],
          ['Double-click', 'use it', 'Double-click: use it (not yours yet: take it)'],
          ['Alt-click', 'wear or hold it', 'Alt-click: wear it or hold it, or take it off'],
          ['Ctrl-click', 'move it across', 'Ctrl-click: move it across: ground or crate to you, you to the open crate'],
          ['Shift-click', 'quick move', 'Shift-click: quick move'],
          ['Right-click', 'everything else', 'Right-click: everything else that can be done with it'],
          ['Left button', 'use what is in hands', 'What is in your hands is used with the left button once this is shut'],
          ['Point + 1–0', 'put it on that key', 'Point at a thing and press 1 to 0: it is put on that key'],
          ['Point + G', 'drop it', 'Point at a thing and press G: it is dropped'],
        ]);
    r.append(wrap, foot, ...this.veil, this.hoverOutline, this.card);
    this.sk = { vic, gear, cargo, grids, scroll, status, foot, vicHead, gearHead, help: foot.firstElementChild as HTMLElement, doll, dollFig };
    return this.sk;
  }

  /**
   * A part of the screen: the one standing kept while what it shows is the same (`sig`), built again when that has
   * changed. One built again is scrolled where the one before it was (2026-10-12: "the scroll view resets and scrolls
   * to the top on the vicinity side when interacting with loot").
   */
  private block(key: string, sig: string, make: () => Node[]): Node[] {
    const had = this.built.get(key);
    if (had && had.sig === sig) return had.nodes;
    const nodes = make();
    if (had) {
      const scrolls = '.inv-ground, .inv-inspect';
      const of = (ns: Node[]) => ns.flatMap((n) => (n instanceof HTMLElement ? [...(n.matches(scrolls) ? [n] : []), ...n.querySelectorAll<HTMLElement>(scrolls)] : []));
      const was = of(had.nodes).map((e) => [e.scrollTop, e.scrollLeft]);
      // (put back once they stand on the page: see `fill`)
      if (was.some(([t, l]) => t || l)) this.rescroll.push(() => of(nodes).forEach((e, i) => was[i] && ((e.scrollTop = was[i][0]), (e.scrollLeft = was[i][1]))));
    }
    this.built.set(key, { sig, nodes });
    return nodes;
  }
  private rescroll: (() => void)[] = [];

  /** a parent's children made these, in this order: what is not among them taken out first, so that what stays is never moved */
  private fill(parent: HTMLElement, nodes: Node[]) {
    const want = new Set(nodes);
    for (const n of [...parent.childNodes]) if (!want.has(n)) parent.removeChild(n);
    let at = parent.firstChild;
    for (const n of nodes) {
      if (n === at) {
        at = at.nextSibling;
        continue;
      }
      parent.insertBefore(n, at);
    }
    while (at) {
      const next = at.nextSibling;
      parent.removeChild(at);
      at = next;
    }
  }

  /** what a thing shows of itself, as a word: what it is, how many, what is in it and fitted to it, its key, whether new */
  private look(it: ItemInstance): string {
    return `${it.uid}:${it.id}:${it.qty}:${it.loaded ?? ''}:${it.rounds ?? ''}:${it.mag ?? ''}:${(it.mods ?? []).join('+')}:${it.left ?? ''}:${(it as { cook?: number }).cook ?? ''}:${it.finish ?? ''}:${it.for ?? ''}:${it.gold ? 1 : ''}:${this.actions.hotIndex(it)}:${this.fresh.has(it.uid) ? 1 : ''}:${this.iconOf(it)}:${it.cargo?.length ?? ''}`;
  }

  /** what a grid shows, as a word: what lies in it and where, and the bags in it opened under it */
  private gridSig(c: Container): string {
    const parts = [c.id, c.name, c.w, c.h, this.folded.has(c.id) ? 'f' : '', this.typing === c.id ? 't' : '', typable(c) ? bagFor(c) ?? '-' : '', c === this.inv.theHold ? `${this.inv.bottomless}` : ''];
    for (const p of c.items) {
      parts.push(`${this.look(p.item)}@${p.x},${p.y},${p.rot ? 1 : 0}`);
      if (this.opened.has(p.item.uid)) {
        const bag = this.bagOf(p.item, c.depth + 1);
        if (bag) parts.push(`[${this.gridSig(bag)}]`);
      }
    }
    return parts.join('|');
  }

  /** a grid under its bar, and the bags in it that are open, each under it: the nodes of one block */
  private boxNodes(c: Container, where = ''): Node[] {
    const out: Node[] = [this.gridBox(c, where)];
    this.openBags(out, c);
    return out;
  }

  /**
   * The chosen thing ringed, what goes with it lit, what a search leaves out dimmed: on every thing standing, as
   * `mark` says, each time it is drawn (no part is built again for it).
   */
  private marks() {
    for (const el of this.root.querySelectorAll<HTMLElement>('.inv-item, .inv-ground-row')) {
      const src = this.bound.get(el);
      if (!src) continue;
      const m = this.mark(src.item).trim();
      if (el.classList.contains('inv-ground-row')) el.classList.toggle('dim', m === 'dim');
      else for (const k of ['sel', 'kin', 'dim']) el.classList.toggle(k, m === k);
    }
    for (const el of this.root.querySelectorAll<HTMLElement>('.inv-hotkey[data-hot]')) {
      const it = this.inv.hot[Number(el.dataset.hot)] ? this.inv.hotItem(Number(el.dataset.hot)) : null;
      const m = it ? this.mark(it).trim() : '';
      for (const k of ['kin', 'dim']) el.classList.toggle(k, m === k);
    }
  }

  /** each bag's share of all that is carried, by its name (the whole changes with every move: no bag is built again for it) */
  private shares() {
    const all = this.weighed ?? this.inv.weight();
    for (const el of this.root.querySelectorAll<HTMLElement>('.inv-bagkg[data-kg]')) {
      const kg = Number(el.dataset.kg), pct = `${Math.round((all ? Math.min(1, kg / all) : 0) * 100)}%`;
      const t = el.firstChild;
      if (t?.nodeType === 3 && t.textContent !== pct) t.textContent = pct;
      const h4 = el.closest('h4');
      const said = `What is in it weighs ${kg.toFixed(2)} kg: ${pct} of the ${all.toFixed(1)} kg you carry. ${h4?.dataset.tail ?? ''}`;
      if (h4 && h4.title !== said) h4.title = said;
    }
  }

  render() {
    const inv = this.inv;
    const r = this.root;
    this.drawn++;
    // (all that is carried weighed once a drawing: each bag's share of it is said by its name)
    this.weighed = inv.weight();
    this.hover = null;
    this.rescroll = [];
    this.gridsNow.clear();
    const sk = this.skeleton();
    // (where each column and Carried's grids are scrolled to, put back once this is drawn: a part built again under
    // them took the scroll back to the top, 2026-10-24: "when im looting and shift click an item it resets my scrolled position")
    // (Vicinity's only while the same crate or body is open: another starts at its top)
    const open = this.stash?.uid ?? '', same = open === this.scrolledFor;
    this.scrolledFor = open;
    const scrolled = [...(same ? [sk.vic] : []), sk.gear, sk.cargo, sk.scroll].map((e) => [e, e.scrollTop] as const);
    // A body is gone through at a glance: everything it wears that holds things (its pack, its vest, its jacket
    // and trousers) is shown open at once, each a grid of its own under its own name, where it took a right-click
    // and "Open" for each. In a crate the same is done for a bag that has something in it. Each is opened by
    // itself once: shut by hand, it stays shut.
    if (this.stash && !this.stashState) {
      for (const p of this.stash.container.items) {
        if (!holds(p.item.id) || this.shown.has(p.item.uid) || (!this.stash.corpse && !p.item.cargo?.length)) continue;
        this.shown.add(p.item.uid);
        this.opened.add(p.item.uid);
      }
    }
    this.fitting = this.stash && !this.stashState && this.fitsOnly ? { guns: this.carriedGuns(), crate: this.crateItems() } : null;
    // (what every part is drawn by: a change of any of it, rare and the player's own doing, builds every part again)
    const touch = document.body.classList.contains('touch');
    const ui = JSON.stringify([[...this.folded], [...this.opened], this.typing, this.fitsOnly, this.viewOpen, kindView, this.weightless, this.carryLimit, inv.bottomless, touch]);

    // ---- vicinity: what lies about, and the crate or body open
    const ground = this.block('v:ground', ui + this.vicinity.map((w) => `${w.loot.uid}:${this.look(w.loot.item)}:${this.actions.lying(w.loot.uid) ?? ''}:${holds(w.loot.item.id) && this.actions.lying(w.loot.uid) === 'mine' ? this.gridSig(this.bagOf(w.loot.item, 1) ?? inv.tags) : ''}`).join('|'), () => {
      const g = document.createElement('div');
      g.className = 'inv-ground';
      g.dataset.ground = '1';
      if (!this.vicinity.length) g.innerHTML = `<div class="inv-empty">Nothing on the ground nearby.<br>Drag items here to drop them.</div>`;
      // Each thing lying about is its picture at its own size, as it would lie in a grid, with what there is of it in
      // its corner and no line of words: its name is on the card when it is pointed at (the owner, 2026-10-23: "i do not
      // want a row for every item it should just be a icon for the item ... 1:1"). A long thing lies on its side.
      const tiles = document.createElement('div');
      tiles.className = 'inv-ground-tiles';
      if (this.vicinity.length) g.appendChild(tiles);
      for (const w of this.vicinity) {
        const d = ITEMS[w.loot.item.id], rot = d.h > d.w;
        const [cw, ch] = Container.size(w.loot.item, rot);
        const el = this.itemEl(w.loot.item, cw, ch, rot);
        el.classList.add('g-tile');
        this.bindItem(el, { kind: 'ground', w, item: w.loot.item });
        tiles.appendChild(el);
      }
      for (const w of this.vicinity) {
        // What lies there that holds things is shown open under the pictures, as what is worn is, and gone through
        // there: taken out of, put into, moved about in (the owner, 2026-10-15: "all inventories should be shown in
        // vicinity pane when items are on the ground / armor, clothes, bags doesnt matter, should show like it does in
        // the inventory"), by as many as like at once (Game.openLying).
        if (holds(w.loot.item.id)) {
          const st = this.actions.lying(w.loot.uid);
          const bag = st === 'mine' ? this.bagOf(w.loot.item, 1) : null;
          if (bag) {
            const box = this.gridBox(bag);
            box.classList.add('inv-bag', 'inv-lying');
            g.classList.add('inv-has-lying');
            g.appendChild(box);
            this.openBags(g, bag);
          } else if (st) g.insertAdjacentHTML('beforeend', `<div class="inv-empty inv-lying-note">${st === 'busy' ? 'Somebody else is going through it' : 'Opening…'}</div>`);
        }
      }
      return [g];
    });
    const st = this.stash;
    const stashPart = !st
      ? []
      : this.block('v:stash', `${ui}|${st.uid}|${st.label}|${this.stashState}|${this.stashState ? '' : this.gridSig(st.container)}|${this.carriedGuns().join(',')}`, () => {
          const out: Node[] = [];
          const head = document.createElement('h3');
          head.innerHTML = `${st.label} <span>${st.container.w}×${st.container.h}</span>`;
          out.push(head);
          if (this.stashState) {
            out.push(Object.assign(document.createElement('div'), { className: 'inv-empty', textContent: this.stashState }));
            return out;
          }
          const box = st.container, body = st.corpse;
          // (A body's grid is made big enough for the most anybody can have on, and most of it is bare: the rows
          // under the lowest thing in it are left off, bar two to put things down in, so that what the body wears is
          // not a screen's height further down. It is as deep as it is all the same: a thing let go on it lands
          // wherever there is room, and the rows are counted again.)
          out.push(this.takeBar());
          if (body) return [...out, ...this.bodyNodes(box)];
          out.push(this.gridEl(box, box.h));
          // (a pack in a crate is opened where it lies, and gone through)
          this.openBags(out, box);
          return out;
        });
    if (st) this.gridsNow.set(st.container.id, st.container);
    this.fill(sk.vic, [sk.vicHead, ...ground, ...stashPart]);

    // ---- character: the survivor, HANDS under them, the hot keys under those, and the tags (the plan the owner said
    // yes to, 2026-10-23: what is worn is a strip at the top of the right, and the guns slung are panels there)
    // The figure stands for good, its still picture put on it only when that changes (it was some 300 KB of what the
    // doll's part was told apart by, and built again with it on every move).
    if (this.dollShown !== this.doll) {
      this.dollShown = this.doll;
      sk.dollFig.style.backgroundImage = this.doll ? `url(${this.doll})` : '';
    }
    this.fill(sk.doll, [sk.dollFig]);
    const neck = this.block('g:neck', `${inv.neck ? this.look(inv.neck) : ''}|${inv.neck ? '' : Math.ceil((inv.neckDue - Date.now()) / 60000)}`, () => {
      const tmp = document.createElement('div');
      tmp.innerHTML = this.neckEl();
      return [...tmp.childNodes];
    });
    // The hands, and under them the places on the gun in them that take a part, each a slot of its own: a part is
    // dragged onto one and dragged off it. (A gun in the hands has its parts under the hands, wherever it is slung:
    // the owner, 2026-10-23, "when they have the gun in their hand and then want to pull the magazine out they are confused".)
    const held = this.actions.inHands();
    const hands = this.block('g:hands', `${ui}|${held ? `${this.look(held)}:${this.actions.goingIn(held) ?? ''}` : '-'}`, () => {
      const box = document.createElement('div');
      box.className = 'inv-armed inv-hands-box';
      box.append(this.handsEl(), this.partsEl(held));
      return [box];
    });
    // (the hot keys, big, under the hands: see `hotEl`)
    const hot = this.block('g:hot', `${held?.uid ?? ''}|${inv.hot.map((b, i) => (b ? `${b.id}:${this.inv.hotItem(i) ? `${this.look(this.inv.hotItem(i)!)}:${this.hotLabel(this.inv.hotItem(i)!)}` : ''}` : '-')).join('|')}`, () => [this.hotEl()]);
    // (the tags taken off others: here under the survivor, out of the way of what is carried)
    const tags = this.block('g:tags', ui + this.gridSig(inv.tags), () => this.boxNodes(inv.tags));
    this.gridsNow.set(inv.tags.id, inv.tags);
    this.fill(sk.gear, [sk.gearHead, sk.doll, ...hands, ...hot, ...neck, ...tags]);

    // ---- carried: every cargo grid, which scroll by themselves; under them, always in sight, the inspector and the body's state
    // (what is carried and, where the game has said a load weighs on anybody, what it leaves of a sprint: the rule is
    // src/sim/load.ts. In red past the weight that slows the feet as well.)
    const kg = this.weighed ?? inv.weight(), told = this.carryLimit !== null, ammo = this.ammoLine();
    const head = this.block('c:head', `${ui}|${kg.toFixed(1)}|${told ? Math.round(breathOf(kg) * 100) : ''}|${ammo}`, () => {
      const box = document.createElement('div');
      box.innerHTML = this.weightless
        ? // (an admin's power: it weighs nothing to them, and the head says that and no weight)
          `<h3><b class="inv-h">Carried${this.viewEl()}${ammo}</b><span class="free" title="An admin's power is on: the ${kg.toFixed(1)} kg you carry weighs nothing: it takes nothing off your sprint and never slows you. /weightless off puts it off">weightless</span></h3>`
        : `<h3><b class="inv-h">Carried${this.viewEl()}${ammo}</b><span${told ? `${paceOf(kg) < 1 ? ' class="over"' : ''} title="The first ${LOAD.free} kg cost nothing. Every kilogram after that takes ${+(LOAD.perKg * 100).toFixed(2)}% off how far you can sprint. It never takes more than ${Math.round((1 - LOAD.least) * 100)}% (from ${Math.round(heavy())} kg). Over ${LOAD.slowsFrom} kg you are slower on your feet as well."` : ''}>${told ? `${Math.round(breathOf(kg) * 100)}%${SPRINT_ICON} · ` : ''}${kg.toFixed(1)}${WEIGHT_ICON}</span></h3>`;
      this.wireView(box);
      // (every bag carried sorted at once, each kind into the bag set for it: inv-piles.ts sortAll)
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'inv-sortall';
      all.title = 'Sort everything you carry: piles joined, each kind into the bag set for it, every bag packed kind by kind';
      all.textContent = 'Sort all';
      all.addEventListener('click', () => {
        if (sortAll(inv, wants, (c) => !!bagFor(c))) this.finish('move');
        else this.actions.note('Everything you carry is as tidy as it gets');
      });
      box.querySelector('.inv-h')?.after(all);
      return [...box.childNodes];
    });
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
    const grids: Node[] = [];
    for (const { c, slot } of carried) {
      const where = slot ? SLOT_LABEL[slot] : c === inv.theHold ? 'admin' : '';
      grids.push(...this.block(`c:grid:${c.id}`, `${ui}|${where}|${this.gridSig(c)}`, () => this.boxNodes(c, where)));
      this.gridsNow.set(c.id, c);
    }
    if (!carried.length) grids.push(...this.block('c:none', '', () => [Object.assign(document.createElement('div'), { className: 'inv-empty', textContent: 'Nothing you have on has any room in it. A jacket, trousers, a vest or a pack each bring their own.' })]));
    this.fill(sk.grids, grids);
    // (the jacket and the trousers are worn things with room in them now, and are the pockets this speaks of)
    const tipNow = !!carried.length && !GEAR_SLOTS.some((s) => s !== 'top' && s !== 'legs' && inv.slots[s] && ITEMS[inv.slots[s]!.id].wear?.cargo);
    const tip = tipNow ? this.block('c:tip', '', () => [Object.assign(document.createElement('div'), { className: 'inv-tip', textContent: 'Only your pockets. A vest or a bag on your back adds more space.' })]) : [];
    this.fill(sk.scroll, [sk.grids, ...tip]);
    // (The inspector stood under all the grids, and with a pack on it was scrolled out of sight. It, and the body's
    // state under it, are fixed at the foot of this side now: only the grids over them scroll. With a mouse its
    // stats are on the card by the pointer and its deeds on the menu (Fettah, 2026-10-18): it is drawn only for a
    // finger, which hovers on nothing and has no right button.)
    const inspect = touch ? this.block('c:inspect', `${ui}|${this.selected ? this.look(this.selected) : ''}`, () => [this.inspector()]) : [];
    // (The body's state is the row of symbols the game has in its corner, which this screen covers: the same row,
    // and no key to it beside it, the HUD's own element, which the HUD keeps up to date while this screen is open.)
    if (this.vitals && this.status && this.status.parentElement !== sk.status) sk.status.appendChild(this.status);
    // What is worn, every place a body has, as a strip of squares at the top, as DayZ has it. Each gun's place is two
    // squares wide with the gun drawn across both, and the two squares under it hold its parts (the owner, 2026-10-24:
    // "move the weapons ui like so, make it take 2 squares and then make room for the attachments and remove from the
    // right panel its too big and annoying"); head to feet fill in after. The gun in the hands has its parts under
    // the hands instead. Two squares under a gun with no parts to show (a shovel, the gun in the hands, an empty
    // place) are taken by what is worn, which fills every square left (the owner, 2026-10-24: "make this take up less
    // height its pushing the players inventory too far down").
    const strip = this.block('c:strip', ui + ALL_SLOTS.map((s) => (inv.slots[s] ? `${this.look(inv.slots[s]!)}:${this.actions.goingIn(inv.slots[s]!) ?? ''}` : '-')).join('|') + `|${held?.uid ?? ''}`, () => {
      const row = document.createElement('div');
      row.className = 'inv-strip';
      WEAPON_SLOTS.forEach((s, k) => {
        const it = inv.slots[s], gun = this.slotEl(s), parts = this.partsEl(it && it !== held ? it : null);
        gun.classList.add('strip-gun');
        gun.style.gridArea = `1 / ${k * 2 + 1} / 2 / span 2`;
        row.appendChild(gun);
        if (!parts.childElementCount) return;
        parts.style.gridArea = `2 / ${k * 2 + 1} / 3 / span 2`;
        row.appendChild(parts);
      });
      for (const s of [...DOLL_SLOTS[0], ...DOLL_SLOTS[1]]) row.appendChild(this.slotEl(s));
      return [row];
    });
    this.fill(sk.cargo, [...head, ...strip, this.findEl(), sk.scroll, ...inspect, ...(this.vitals && this.status ? [sk.status] : [])]);

    // ---- the foot: the clicks
    this.fill(sk.foot, [sk.help]);
    for (const k of [...this.built.keys()]) if (k.startsWith('c:grid:') && !this.gridsNow.has(k.slice(7))) this.built.delete(k);
    for (const f of this.rescroll) f();
    this.fitGrids();
    // (and again a frame on, should what came in under them have been short of its full height when this was drawn)
    const back = () => scrolled.forEach(([e, top]) => e.scrollTop !== top && (e.scrollTop = top));
    back();
    requestAnimationFrame(back);
    this.marks();
    this.shares();
    for (const [k, v] of this.gridEls) if (!v.g.isConnected) this.gridEls.delete(k);
    for (const [k, v] of this.gboxes) if (!v.box.isConnected) this.gboxes.delete(k);

    // (the figure's box may have been made afresh: where it is, is found again; and its still picture is put away where the live one is to be had)
    this.figMoved = true;
    r.classList.toggle('fig-ready', !!this.figure?.alive);
    if (this.menu && this.menu.parentElement !== r) r.appendChild(this.menu);
    // (What the pointer is on is found again, so that the card stays by it and the keys that act on what is pointed at
    // still do without the mouse being moved: the very thing, if it still stands; else whatever stands under the
    // pointer now, found by where each lies once the page is laid out. Asking the page what is under a point laid it
    // all out there and then and searched every layer of it: 4-5 ms a move.)
    const was = this.hoverEl;
    if (was?.isConnected && this.bound.has(was)) {
      this.hover = this.bound.get(was)!;
      if (!this.menu) this.showCard(this.hover);
    } else {
      this.hoverEl = null;
      if (this.isOpen && this.at.mouse && !this.drag) requestAnimationFrame(() => this.refind());
      else if (!this.card.classList.contains('hint')) this.hideCard();
    }
  }

  /** the thing standing under the pointer, by where each thing lies (see the end of render) */
  private refind() {
    if (!this.isOpen || this.drag || this.hoverEl?.isConnected) return;
    let hit: HTMLElement | null = null;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-o]')) {
      if (!this.bound.has(el)) continue;
      const b = el.getBoundingClientRect();
      if (this.at.x >= b.left && this.at.x < b.right && this.at.y >= b.top && this.at.y < b.bottom) hit = el;
    }
    const src = hit ? this.bound.get(hit) : undefined;
    if (src) {
      this.hover = src;
      this.hoverEl = hit;
      if (!this.menu) this.showCard(src);
    } else if (!this.card.classList.contains('hint')) this.hideCard();
  }
  /** the element of what the pointer is on */
  private hoverEl: HTMLElement | null = null;

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
    const d = ITEMS[it.id], what = does(d, it);
    const held = this.actions.inHands() === it, note = this.heldNote(loc);
    // (a phone's: the card's info, and the menu's rows as buttons)
    box.innerHTML = `
      <div class="ins-head">
        <div class="ins-img" style="background-image:url(${this.iconOf(it)})"></div>
        <div>
          <div class="ins-cat">${kindOf(d)}</div>
          <div class="ins-name">${itemName(it)}</div>
        </div>
      </div>
      <div class="ins-actions"></div>
      ${what ? `<div class="ins-does">${what}</div>` : ''}
      <div class="ins-desc">${d.desc}</div>
      ${note ? `<div class="ins-note">${note}</div>` : ''}
      <div class="ins-stats">${this.statHtml(this.stats(loc))}</div>`;
    const acts = box.querySelector('.ins-actions') as HTMLElement;
    // (A gun carried in a pocket or a pack: its parts, each in its place, as they are under a gun on the back or in
    // the hands. A part put on or taken off here has the gun drawn first, like any other.)
    if (d.weapon && loc.kind === 'container' && this.carried(loc) && !held) {
      const parts = this.partsEl(it);
      parts.classList.add('in-inspect');
      box.insertBefore(parts, acts);
    }
    for (const act of this.keyed(loc)) {
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

  /** a thing's picture: a plated gun's own, gold or nickel, once it has been drawn (until then, the plain one) */
  private iconOf(it: ItemInstance): string {
    const f = lookOf(it.finish);
    if (f) {
      const own = this.icons[`${it.id}|${f}`];
      if (own) return own;
      this.actions.plateIcon(it.id, f);
    }
    return this.icons[it.id] ?? '';
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
    return { label: 'Take in hands', id: 'hands', icon: 'hand', run: () => this.actions.hold(it) };
  }

  /** A thing in a bag that lies in a pocket or a pack is taken out into what is carried: nothing is used, worn or held from in there. */
  private takeOut(src: Source): Deed {
    return { label: 'Take it out', id: 'out', icon: 'out', run: () => this.putAway(src) };
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
    if (this.opens(src)) return { label: this.opened.has(it.uid) ? 'Close it' : 'Open it', id: 'bag', icon: this.opened.has(it.uid) ? 'shut' : 'open', run: () => this.toggleBag(it) };
    if (src.kind === 'container' && !this.inv.containers.includes(src.c)) return this.takeOut(src);
    if (eaten(d)) return { label: useWord(d), id: 'use', icon: { kind: it.id }, run: () => this.actions.use(it) };
    if (d.open) return { label: 'Open it', id: 'open', icon: 'open', run: () => this.actions.open(it) };
    if (src.kind === 'slot' && !WEAPON_SLOTS.includes(src.slot)) return { why: `You have the ${n} on: Alt-click takes it off` };
    if (d.attach && src.kind === 'container') {
      const gun = this.actions.attachTargets(it)[0];
      if (gun) return { label: `Fit it to the ${ITEMS[gun.id].name}`, id: `attach:${gun.uid}`, icon: 'attach', run: () => this.actions.attach(it, gun) };
    }
    if (d.slot && d.category === 'clothing' && src.kind === 'container') return { label: 'Wear it', id: 'wear', icon: { kind: it.id }, run: () => this.equip(src) };
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
    if (src.kind === 'slot') return WEAPON_SLOTS.includes(src.slot) ? this.hands(src) : { label: 'Take it off', id: 'off', icon: 'out', run: () => this.takeOff(src) };
    if (src.kind === 'loose') return { why: `The ${n} is in your hands already` };
    if (d.slot) return { label: wearWord(d), id: 'wear', icon: { kind: it.id }, run: () => this.equip(src) };
    if (!this.mine(src)) return { label: 'Take in hands', id: 'hands', icon: 'hand', run: () => this.intoHands(src) };
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
    if (src.kind === 'ground') return { label: 'Pick it up', id: 'pick', icon: 'take', run: () => this.pickUp(src) };
    if (!this.mine(src)) return { label: 'Take it', id: 'across', icon: 'take', run: () => this.transfer(src) };
    if (!this.stash || this.stashState) return { why: 'Nothing is open to move it into. To put it down: press G on it, or drag it to the left' };
    return { label: `Move it to ${this.stash.label}`, id: 'across', icon: 'move', run: () => this.transfer(src) };
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
      out.push({ label: 'Take', icon: 'take', id: 'pick', run: () => this.quickMove(loc), primary: true });
      if (d.slot) out.push({ label: gearWord, icon: { kind: it.id }, id: 'wear', run: () => this.equip(loc) });
      if (d.category !== 'clothing' && !d.weapon && !d.melee) out.push({ label: 'Take in hands', icon: 'hand', id: 'hands', run: () => this.intoHands(loc) });
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
      // (the gold one is what a double-click does, as `useIt` has it: into the hands, unless it is eaten, opened or fitted)
      if (!held) out.push({ label: 'Take in hands', icon: 'hand', id: 'hands', run: () => this.actions.hold(it), primary: !eaten(d) && !d.open && !(d.attach && this.actions.attachTargets(it).length) });
    }
    // (and what a double-click does with a thing that is eaten, drunk or put on a wound, or with a box of rounds: said here too, for whoever looks for it)
    if ((this.carried(loc) || loc.kind === 'loose') && eaten(d)) out.push({ label: `${useWord(d)} now`, icon: { kind: it.id }, id: 'use', primary: true, run: () => this.actions.use(it) });
    if ((this.carried(loc) || loc.kind === 'loose') && d.open) out.push({ label: 'Open it now', icon: 'open', id: 'open', primary: true, run: () => this.actions.open(it) });
    if (this.opens(loc)) {
      const open = this.opened.has(it.uid);
      out.push({ label: open ? 'Close it' : `Open (${it.cargo?.length ?? 0} inside)`, icon: open ? 'shut' : 'open', id: 'bag', primary: true, run: () => {
        if (!this.opened.delete(it.uid)) this.opened.add(it.uid);
        this.actions.sound('move');
        this.render();
      } });
    }
    if (d.attach) {
      // (a double-click fits it to the first of them)
      this.actions.attachTargets(it).forEach((w, i) => out.push({ label: `Attach to ${ITEMS[w.id].name}`, icon: 'attach', id: `attach:${w.uid}`, run: () => this.actions.attach(it, w), primary: i === 0 }));
    }
    if (d.slot && loc.kind === 'container') out.push({ label: d.category === 'clothing' ? gearWord : d.slot === 'holster' ? 'Holster it' : 'Sling on your back', icon: { kind: it.id }, id: 'wear', run: () => this.equip(loc), primary: d.category === 'clothing' && !this.opens(loc) });
    if (loc.kind === 'slot') {
      // (With no room for it in a pocket this did nothing, and said nothing. It comes off all the same, onto the
      // ground, and the entry says so before it is chosen. A gun with no room for it is put down with Drop.)
      const room = this.inv.containers.some((c) => c.hasRoom(it));
      if (room || d.category === 'clothing') out.push({ label: d.category === 'clothing' ? (room ? 'Take off' : 'Take off, onto the ground (no room for it)') : 'Stow', icon: room ? 'out' : 'drop', id: 'off', run: () => this.takeOff(loc) });
    }
    if (d.mag) {
      // (filled from the loose rounds carried, as letting them go on it does: Fettah 2026-10-18, "instead of dragging rounds in by hand")
      const room = d.mag.capacity - (it.rounds ?? 0), loose = this.actions.looseFor(it);
      if (this.carried(loc) && room > 0 && loose > 0) out.push({ label: `Fill it (${Math.min(room, loose)})`, icon: 'fill', run: () => this.actions.fillMag(it) });
      if ((it.rounds ?? 0) > 0) out.push({ label: `Empty it (${it.rounds})`, icon: 'empty', run: () => this.actions.emptyMag(it) });
    }
    // a pile of two or more is halved: the half is laid beside it, to be given away, put elsewhere or dropped
    if (d.stack && it.qty > 1 && loc.kind === 'container') {
      const pile = loc.c;
      out.push({
        label: `Split (${it.qty - Math.floor(it.qty / 2)} and ${Math.floor(it.qty / 2)})`,
        icon: 'split',
        run: () => {
          if (splitPile(pile, it, makeItem)) this.finish('move');
          else this.actions.note('No room beside it for the other half');
        },
      });
    }
    // loose rounds: every magazine carried that takes them, filled
    if (d.category === 'ammo' && !d.open && this.carried(loc)) {
      const mags = pileGrids(this.inv).flatMap((c) => c.items).filter((p) => { const m = ITEMS[p.item.id].mag; return !!m && m.ammo === it.id && (p.item.rounds ?? 0) < m.capacity; });
      if (mags.length) out.push({ label: `Fill all magazines (${mags.length})`, icon: 'fill', run: () => this.actions.fillAllMags(it.id) });
    }
    // every pile of it that is carried made into as few as hold it, where that is fewer than there are
    if (d.stack && this.carried(loc)) {
      const piles = pileGrids(this.inv).flatMap((c) => c.items.filter((p) => p.item.id === it.id));
      const total = piles.reduce((n, p) => n + p.item.qty, 0);
      if (piles.length > Math.ceil(total / d.stack)) out.push({ label: `Combine all (${piles.length} piles)`, icon: 'merge', run: () => this.combineAll(it.id) });
    }
    if (d.weapon?.mag) {
      // One of the two, never both (Fettah 2026-10-18: "why there is two?"): the magazine out, the round in the chamber
      // left there as in DayZ; and with none in, that round out.
      if (it.mag) out.push({ label: 'Take out the magazine', icon: 'detach', run: () => this.actions.detach(it, it.mag!) });
      else if ((it.loaded ?? 0) > 0) out.push({ label: 'Unload', icon: 'unload', run: () => this.actions.unload(it) });
    } else if (d.weapon && (it.loaded ?? 0) > 0) out.push({ label: `Unload (${it.loaded})`, icon: 'unload', run: () => this.actions.unload(it) });
    for (const m of it.mods ?? []) out.push({ label: `Detach ${ITEMS[m].name}`, icon: 'detach', run: () => this.actions.detach(it, m) });
    // (a finish from the store, put on this one gun and kept with it, Rust's way: the owner, 2026-10-22, "maybe open a
    // menu when we have options, but for now an apply")
    const look = this.carried(loc) ? this.actions.finishFor(it) : null;
    if (look) out.push({ label: `Apply ${look} finish`, icon: 'shine', id: 'finish', run: () => this.actions.applyFinish(it) });
    if (this.stash && !this.stashState) out.push({ label: inStash ? 'Take' : `Move to ${this.stash.label}`, icon: inStash ? 'take' : 'move', id: 'across', run: () => this.transfer(loc), primary: inStash });
    out.push({
      label: 'Drop',
      icon: 'drop',
      id: 'drop',
      danger: true,
      run: () => {
        this.detach(loc);
        this.actions.drop(it);
        this.actions.sound('drop');
        this.actions.changed();
      },
    });
    // (what a double-click does stands first, in gold)
    return out.sort((a, b) => +!!b.primary - +!!a.primary);
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

  /** the guns on the back, at the hip, in the hands or packed away: what "Fits my guns" feeds */
  private carriedGuns(): string[] {
    const out = new Set<string>();
    const walk = (it: ItemInstance) => {
      if (ITEMS[it.id].weapon) out.add(it.id);
      for (const p of it.cargo ?? []) walk(p.item);
    };
    for (const it of Object.values(this.inv.slots)) if (it) walk(it);
    for (const c of this.inv.containers) for (const p of c.items) walk(p.item);
    const held = this.actions.inHands();
    if (held) walk(held);
    return [...out];
  }

  /** everything in the open crate or body, and in the bags in it */
  private crateItems() {
    const out = new Set<ItemInstance>();
    const walk = (it: ItemInstance) => {
      out.add(it);
      for (const p of it.cargo ?? []) walk(p.item);
    };
    for (const p of this.stash?.container.items ?? []) walk(p.item);
    return out;
  }

  /**
   * what in the open crate or body a button takes: all of it as it lies, or every thing of a kind, in the bags there
   * too; with "Fits my guns" on, only what that lights
   */
  private takeList(group: TakeGroup | null): Source[] {
    const out: Source[] = [];
    const fit = this.fitting;
    const walk = (c: Container, depth: number) => {
      for (const p of c.items) {
        if ((!group || inTakeGroup(p.item, group)) && (!fit || fitsGuns(p.item, fit.guns))) {
          out.push({ kind: 'container', c, item: p.item });
          continue;
        }
        const bag = (group || fit) && p.item.cargo?.length ? this.bagOf(p.item, depth + 1) : null;
        if (bag) walk(bag, depth + 1);
      }
    };
    if (this.stash) walk(this.stash.container, this.stash.container.depth);
    return out;
  }

  private takeBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'inv-takes';
    const add = (label: string, group: TakeGroup | null, n: number) => {
      if (!n) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${label} <span>${n}</span>`;
      b.addEventListener('click', () => this.takeAll(group));
      bar.appendChild(b);
    };
    add('Take all', null, this.takeList(null).length);
    // (with only what fits shown, every kind's button would take the same as "Take all")
    if (!this.fitting) for (const g of TAKE_GROUPS) add(g.label, g.id, this.takeList(g.id).length);
    // (no gun carried: no button, unless it is on and must be put off again)
    if (!this.fitsOnly && !this.carriedGuns().length) return bar;
    const fits = document.createElement('button');
    fits.type = 'button';
    fits.className = 'inv-fits';
    fits.textContent = 'Fits my guns';
    fits.title = 'Shows only the rounds and magazines the guns you carry take, and dims the rest';
    fits.setAttribute('aria-pressed', String(this.fitsOnly));
    fits.addEventListener('click', () => {
      this.fitsOnly = !this.fitsOnly;
      this.render();
    });
    bar.appendChild(fits);
    return bar;
  }

  /** every thing a button names is moved across, one after another, until one finds no room; and the player is told */
  private takeAll(group: TakeGroup | null) {
    const all = this.takeList(group);
    let moved = 0;
    for (const src of all) {
      if (src.kind !== 'container') continue;
      this.transfer(src);
      if (src.c.has(src.item)) break;
      moved++;
    }
    if (moved < all.length) this.actions.note(moved ? `Took ${moved} of ${all.length}: no room for the rest` : 'No room: nothing was taken');
    this.render();
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
    this.menuSrc = null;
  }

  private openMenu(src: Source, x: number, y: number) {
    this.closeMenu();
    this.selected = src.item;
    this.render();
    // (the menu is what to do, as the card is what it is: it stands where the card stood, with the card's own head, and then every deed with its keys)
    this.hideCard();
    const m = document.createElement('div');
    m.className = 'inv-menu';
    m.innerHTML = this.cardHead(src.item);
    for (const act of this.keyed(src)) {
      const b = document.createElement('button');
      b.innerHTML = actIcon(act.icon);
      b.append(act.label);
      // (two keys at most: a thing on the ground is taken by three, and the row is a row, not a list)
      if (act.keys.length) b.insertAdjacentHTML('beforeend', `<span class="menu-keys">${act.keys.slice(0, 2).map((k) => `<kbd>${k}</kbd>`).join('')}</span>`);
      if (act.primary) b.className = 'primary';
      if (act.danger) b.className = 'danger';
      b.onclick = () => {
        this.closeMenu();
        act.run();
        this.render();
      };
      m.appendChild(b);
    }
    // (the number keys put what is carried on a quick key: said here, where every other key is)
    if (src.kind !== 'ground' && this.carried(src)) m.insertAdjacentHTML('beforeend', `<div class="menu-foot"><kbd>1</kbd>–<kbd>0</kbd> puts it on a quick key</div>`);
    this.root.appendChild(m);
    this.menuSrc = src;
    const z = this.z;
    const r = m.getBoundingClientRect();
    // (by the pointer as the card is, `placeCard`: to its right and under it, or the other side where that would run off)
    const px = x + 18 + r.width > window.innerWidth - 8 ? x - r.width - 14 : x + 18;
    m.style.left = `${Math.max(8, px) / z}px`;
    m.style.top = `${Math.max(8, Math.min(y + 20, window.innerHeight - r.height - 8)) / z}px`;
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
    el.dataset.o = srcOid(src);
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
      const z = this.z * this.scaleOf(el);
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
      this.hoverEl = el;
      if (this.fresh.delete(src.item.uid)) el.classList.add('seen');
      this.at = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
      this.showCard(src);
    });
    el.addEventListener('pointerleave', () => {
      if (this.hover === src) this.hover = null;
      if (this.hoverEl === el) this.hoverEl = null;
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
      if (h.dataset?.into) return { kind: 'into' as const, el: h };
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
  /** @param into where the boxes of the open bags go: an element, or a list (a block's, see boxNodes: what is kept is not lifted off the page to be put back) */
  private openBags(into: HTMLElement | Node[], c: Container) {
    for (const p of c.items) {
      if (!this.opened.has(p.item.uid)) continue;
      const bag = this.bagOf(p.item, c.depth + 1);
      if (!bag) continue;
      // (where it sits is said in the name's own style after a dot, "BLACK BAG · FIELD JACKET"; on a body, where the body's own name is a player's and is over the grid already, "on the body")
      const where = `· ${c === this.stash?.container && this.stash.corpse ? 'on the body' : c.name}`;
      const box = this.gridBox(bag, where, () => {
        this.opened.delete(p.item.uid);
        this.render();
      });
      box.classList.add('inv-bag');
      if (Array.isArray(into)) into.push(box);
      else into.appendChild(box);
      this.openBags(into, bag);
    }
  }

  /** is this a bag lying somewhere it can be opened (not worn: what is worn is open already; not on the ground: that is picked up first) */
  private opens(loc: Source): boolean {
    return loc.kind === 'container' && !!holds(loc.item.id) && loc.c.depth < 2;
  }

  /** grid cell under the dragged item's top-left corner */
  private cellAt(e: { clientX: number; clientY: number }, grid: HTMLElement, d: Drag): [number, number] {
    const z = this.z * this.scaleOf(grid);
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
      const z = this.z * this.scaleOf(t.el), rect = t.el.getBoundingClientRect();
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
    if (d.slot) return src.kind === 'slot' ? null : { label: d.category === 'clothing' ? 'Wear' : 'Equip', icon: { kind: it.id }, run: () => this.equip(src) };
    if (d.attach && (mine || src.kind === 'ground')) {
      const w = this.actions.attachTargets(it)[0];
      if (w) return { label: `Fit to ${ITEMS[w.id].name}`, icon: 'attach', run: () => this.fit(src, w) };
    }
    // (let go over the survivor, a thing carried comes into their hands)
    if (mine) return this.actions.inHands() === it ? null : { label: 'Take in hands', icon: 'hand', run: () => this.actions.hold(it) };
    if (!this.inv.hasRoom(it)) return null;
    // (a thing held in the hands and carried nowhere is put away: it was sent the way of a thing out of a crate, and with no crate open went nowhere)
    return { label: src.kind === 'loose' ? 'Put away' : 'Take', icon: 'take', run: () => (src.kind === 'ground' ? this.quickMove(src) : src.kind === 'loose' ? this.putAway(src) : this.transfer(src)) };
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
    // A magazine lights up every gun it goes into, and the gun's magazine place, with Load; rounds light up every
    // magazine they fill with Fill; a part, Fit. (The owner, 2026-10-23: loading "can be confusing ... the users want it
    // to be easier and more intuitive. I want to maintain all dayz functionality": the drops were always there, unseen.)
    const word = (j: 'stack' | 'attach' | 'fill' | null) => (j === 'fill' ? 'Fill' : j === 'attach' ? (def.mag ? 'Load' : 'Fit') : '');
    const held = this.actions.inHands();
    for (const el of this.root.querySelectorAll<HTMLElement>('.inv-item')) {
      const onto = this.bound.get(el)?.item;
      // (a gun in the hands is marked there, not again where it is slung)
      if (onto && onto === held && !el.closest('.slot-inhands')) continue;
      const w = onto ? word(this.joins(d, onto)) : '';
      if (!w) continue;
      el.classList.add('drop-hint');
      el.dataset.does = w;
    }
    for (const el of this.root.querySelectorAll<HTMLElement>('.inv-part')) {
      const gun = this.gunByUid(el.dataset.gun ?? '');
      if (!gun || def.attach?.slot !== el.dataset.part || !this.actions.attachTargets(item).includes(gun)) continue;
      el.classList.add('drop-hint');
      el.dataset.does = def.mag ? 'Load' : 'Fit';
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
    this.root.querySelectorAll<HTMLElement>('[data-does]').forEach((el) => delete el.dataset.does);
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
    // (rot, where given: a faded picture of the thing is drawn where it would land, turned as it would lie there. Fettah 2026-10-18, idea 8 on Fettah's board)
    // (over a grid drawn smaller to fit, the outline is drawn at its size: see `fitGrids`)
    let k = 1;
    const box = (rect: DOMRect, x: number, y: number, w: number, h: number, cls: string, label = '', rot?: boolean) => {
      o.style.display = 'block';
      o.style.zoom = k === 1 ? '' : String(k);
      o.style.left = `${rect.left / z / k + x * CELL}px`;
      o.style.top = `${rect.top / z / k + y * CELL}px`;
      o.style.width = `${w * CELL}px`;
      o.style.height = `${h * CELL}px`;
      o.className = 'inv-outline ' + cls;
      if (rot !== undefined) o.appendChild(this.itemEl(d.src.item, w, h, rot));
      if (label) o.insertAdjacentHTML('beforeend', `<span>${label}</span>`);
    };
    if (t?.kind === 'grid') {
      const c = this.containerById(t.id!);
      if (!c) return;
      const rect = t.el.getBoundingClientRect();
      const [cx, cy] = this.cellAt(e, t.el, d);
      k = this.scaleOf(t.el);
      // over something it goes into: that thing is what lights up
      const [px, py] = [Math.floor(((e.clientX - rect.left) / z / k) / CELL), Math.floor(((e.clientY - rect.top) / z / k) / CELL)];
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
        // (turned to fit where it was not held turned: it says so, as it would otherwise only be seen once let go)
        const [w, h] = Container.size(d.src.item, at.rot);
        box(rect, at.x, at.y, w, h, 'ok', at.rot !== d.rot ? 'Turned' : '', at.rot);
      } else {
        // (why not is said in full by the pointer: see `refusal`)
        const [w, h] = Container.size(d.src.item, d.rot);
        box(rect, cx, cy, w, h, 'bad', '', d.rot);
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
    if (t.kind === 'into') {
      // (on the loose part of a body: what is yours goes on it wherever there is room, as Ctrl-click moves it across)
      if (this.mine(d.src)) this.transfer(d.src);
      return this.render();
    }
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
      const z = this.z * this.scaleOf(t.el);
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
        if (item.qty <= 0) {
          poured.set(item, onto.item);
          this.removeFrom(d.src);
        }
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
    this.actions.attach(item, weapon, true);
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
    // (a thing in a bag lying about, as one in a crate: taken. It ran the thing's own first deed, and a tin in a bag on
    // the ground was eaten, a dressing nothing at all: 2026-10-24, "iam unable to shift click items from vicinity that
    // are in a container into my inventory")
    if ((this.stash && !this.stashState) || !this.mine(src)) {
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

  /**
   * Combine all: the piles joined (src/ui/inv-piles.ts combinePiles), and what moved shown going: a picture of the
   * thing flies from each pile emptied to the one it joined, and that one glows (the note on the idea: "the items
   * flying from source to destination").
   */
  private combineAll(id: string) {
    const where = () => {
      const at = new Map<string, DOMRect>();
      for (const el of this.root.querySelectorAll('.inv-item')) {
        const uid = this.bound.get(el)?.item.uid;
        if (uid) at.set(uid, el.getBoundingClientRect());
      }
      return at;
    };
    const before = where();
    const moves = combinePiles(pileGrids(this.inv), id);
    if (!moves.length) return;
    this.finish('move');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const after = where(), url = this.icons[id] ?? '';
    moves.forEach((m, k) => {
      const a = before.get(m.from.uid), b = after.get(m.to.uid) ?? before.get(m.to.uid);
      if (!a || !b) return;
      const s = Math.min(a.width, a.height, 46);
      const fly = document.createElement('div');
      fly.className = 'inv-fly';
      fly.style.cssText = `left:${a.left + a.width / 2 - s / 2}px;top:${a.top + a.height / 2 - s / 2}px;width:${s}px;height:${s}px;background-image:url(${url})`;
      document.body.appendChild(fly);
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      fly.animate([{ transform: 'translate(0, 0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.7)`, opacity: 0.9 }], { duration: 420, delay: k * 70, easing: 'cubic-bezier(.35,.1,.25,1)', fill: 'both' }).finished.then(() => {
        fly.remove();
        for (const el of this.root.querySelectorAll('.inv-item')) if (this.bound.get(el)?.item === m.to) el.animate([{ boxShadow: '0 0 0 2px rgba(201,178,124,.9), 0 0 14px rgba(201,178,124,.7)' }, { boxShadow: '0 0 0 0 rgba(201,178,124,0)' }], { duration: 500 });
      });
    });
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
