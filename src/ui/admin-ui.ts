// The panel of somebody with a role (2026-10-11; laid out again 2026-10-12).
//
// It gives no order of its own. Every button writes the order it stands for (see src/net/orders.ts) and has the
// game send it as if it had been typed, so the server holds a button to exactly what it holds a typed order to,
// and what came of it is said back in words: here, along the bottom, and in the chat. The lists are asked of the
// server while the panel is open (`ask`), every two seconds.
//
// How it is laid out, and why. The first one had the players on one page and the things to hand out on another,
// and whoever was picked on the first was silently who the second gave to: "why am i selecting the player on 1
// screen and then manipulating the player on another it makes no sense ... it should be EASY to use and
// intuitive". So:
//   - WHO is down the left, always: yourself at the top, then everybody online. One of them is picked at all times.
//   - WHAT is on the right, and is all about whoever is picked: their card across the top, and under it what can be
//     done to them, the things that can be given to them (as pictures), and the kits. Every button says who it is for.
//   - The server's own pages (a word to everybody, the bans, the roles) are reached from the foot of the left side.
//     So is Entities: what can be stood in the world and taken out of it (cars, the infected), drawn row by row
//     from the one list of them in src/net/orders.ts.
// Every name is set as text and never as markup; the only markup made here is the drawings of the icons, which are
// written out below.
//
// The window (2026-10-13: "We can make the admin panel take up more of the screen so theres more space to work
// with and less scrolling, not 100% of the screen but maybe more. maybe make the window resizable, that would be
// best"). It opens at most of the screen, is moved by its title bar and resized by any edge or corner, and where
// it was left is kept by the browser (`zona.admin.window`); "Reset layout" in the title bar, or a double click on
// the bar, puts it back. Nothing in it is laid out to a size in pixels of the window: every page is a grid that
// takes as many columns as there is room for.
//
// What is drawn again, and when. The lists come every two seconds while it is open. Each part (the bar, the left
// side, the head, the body, the foot) is made again only when what it shows has changed, and whatever in it had
// the keyboard is given the keyboard back (`swap`): the panel can be worked with Tab and Enter alone.

import type { AdminLists } from '../net/protocol';
import { ENTITIES, type Entity, type Role } from '../net/orders';
import { ITEMS, TAG_HOLD_MIN, tagClock, tagOwner } from '../sim/items';
import { KITS } from '../sim/kits';
import { CARRY_POWERS, type CarryPower } from '../sim/powers';
import type { S2C } from '../net/protocol';
import type { ItemInstance } from '../sim/items';
import { controls, keyOf, shown } from '../core/keys';
import './admin.css';
import { StoreTab } from './admin-store';

export interface AdminActions {
  /** an order, as it would be typed (`/kick #12 why`) */
  order(line: string): void;
  /** the lists are wanted (again) */
  ask(): void;
  /** the free camera, put on or off */
  freecam(on: boolean): void;
  /** the map, opened to be right-clicked on */
  map(): void;
  /** the free camera, set behind a player and kept with them as they go */
  watch(id: number): void;
  /** night made day, in this game alone */
  night(on: boolean): void;
  /** the colour of the word ADMIN before this admin's name in the chat (null: the rainbow; 'off': no tag at all) */
  tint(color: string | null): void;
  /** everybody's name shown where they are, through anything: put on or off */
  names(on: boolean): void;
  /** what the middle of the game's view is on, behind the window (null: nothing within reach) */
  look(): AdminLook | null;
  /** somebody has been picked on the left (0: nobody): the admin's map rings them too */
  picked(id: number): void;
  /** an order to the store's book (src/ui/admin-store.ts) */
  store(act: unknown): void;
  close(): void;
}

/** what the middle of the view is on: where, how far off, and what it is */
export interface AdminLook {
  x: number;
  y: number;
  z: number;
  dist: number;
  /** level ground, or a floor: a thing can be stood on it at that height */
  flat: boolean;
  /** what it is, in a few words: "the ground", "car number 7" */
  what: string;
  /** a car: its number */
  car?: number;
}
/** one of those online, as the lists have them */
export type AdminPlayer = AdminLists['players'][number];

/** what the panel is told of whoever has it open */
export interface AdminSelf {
  role: Role | null;
  id: number;
  god: boolean;
  hidden: boolean;
  clip: boolean;
  voidInv: boolean;
  voidTag: boolean;
  /** what they carry weighs nothing; firing takes no round out of their gun (src/sim/powers.ts) */
  weightless: boolean;
  endless: boolean;
  /** their inventory never fills: what their pockets cannot take goes into the hold (not said by a game from before it: off) */
  bottomless?: boolean;
  /** it is day in this game alone, whatever the hour */
  night: boolean;
  /** everybody's name is shown where they are */
  names: boolean;
  /** the colour chosen for the word ADMIN in the chat (null: the rainbow) */
  tint: string | null;
  freecam: boolean;
  x: number;
  z: number;
}

type Player = AdminPlayer;
type View = 'who' | 'entities' | 'server' | 'bans' | 'roles' | 'store';
type Sub = 'actions' | 'items' | 'kits' | 'pockets';
/** where the window stands and how big it is, in pixels of the screen */
type Box = { x: number; y: number; w: number; h: number };
const WINDOW_KEPT = 'zona.admin.window';
/** where a thing given from the panel goes, as this admin last chose: kept in their browser ('ground': at the feet; anything else, or nothing kept: into the inventory) */
const GIVE_KEPT = 'zona.admin.give';
/** the least the window is made, the most it opens at when nothing is kept, and how near the edge of the screen it goes */
const MIN_W = 720, MIN_H = 440, OPEN_W = 1760, OPEN_H = 1120, GAP = 8;
/** the edges and corners it is resized by */
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
/** how many of a thing one press of Spawn can stand: these, as far as its row in ENTITIES allows */
const COUNTS = [1, 2, 3, 5, 10, 25];
/** how far about the admin the infected are put down, metres */
const CULL = [30, 60, 120, 250];
/** the drawing each kind of thing goes by on the Entities page (a new kind in ENTITIES is asked for one here) */
const ENTITY_ICON: Record<Entity['kind'], string> = { car: 'car', infected: 'infected' };
/** what somebody carries, as the server last had it from their game (`/pockets`) */
type Pockets = Extract<S2C, { t: 'inv' }>;
const SLOT_NAME: Record<string, string> = { primary: 'On the back', secondary: 'On the back', holster: 'Holster', head: 'Head', face: 'Face', vest: 'Vest', back: 'Pack', hands: 'Hands', feet: 'Feet', neck: 'Round the neck', melee: 'Belt' };
const POCKET_NAME: Record<string, string> = { tags: 'Tag pouch', jacket: 'Jacket', pants: 'Trousers', hold: 'Hold (an admin’s bottomless inventory)' };
const KIND: Record<string, string> = { weapon: 'Guns', magazine: 'Magazines', ammo: 'Ammunition', attachment: 'Attachments', melee: 'Melee', clothing: 'Clothing', medical: 'Medical', food: 'Food', drink: 'Drink', tool: 'Tools', stash: 'Containers', misc: 'Other' };
const KINDS = [...new Set(Object.values(KIND))];
/** everything there is to give, in the order the grid shows it, and how many there are of each kind: worked out once, the first time the grid is drawn (it was sorted and counted over at every drawing) */
let GIVEN: { all: (typeof ITEMS)[string][]; count: Record<string, number> } | null = null;
const given = () => {
  if (GIVEN) return GIVEN;
  const kindOf = (d: (typeof ITEMS)[string]) => KIND[d.category] ?? 'Other';
  const all = Object.values(ITEMS).filter((d) => d.id !== 'dogtag').sort((a, b) => KINDS.indexOf(kindOf(a)) - KINDS.indexOf(kindOf(b)) || a.name.localeCompare(b.name));
  const count: Record<string, number> = {};
  for (const d of all) count[kindOf(d)] = (count[kindOf(d)] ?? 0) + 1;
  return (GIVEN = { all, count });
};

/** The icons: each a few strokes on a square of 24. Drawn here; nothing is fetched. */
const ICON: Record<string, string> = {
  shield: '<path d="M12 3l7 3v5c0 4.6-3 8-7 10-4-2-7-5.4-7-10V6z"/>',
  ghost: '<path d="M6 20V10a6 6 0 0 1 12 0v10l-3-2-3 2-3-2z"/><circle cx="10" cy="10.5" r="0.9" fill="currentColor"/><circle cx="14" cy="10.5" r="0.9" fill="currentColor"/>',
  fly: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  camera: '<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13.5" r="3.4"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  heart: '<path d="M12 20s-7-4.6-7-10.2A3.8 3.8 0 0 1 12 7.6a3.8 3.8 0 0 1 7 2.2C19 15.4 12 20 12 20z"/>',
  skull: '<path d="M6 11a6 6 0 1 1 12 0v4.5h-2V19H8v-3.5H6z"/><circle cx="9.7" cy="11.5" r="1.3" fill="currentColor"/><circle cx="14.3" cy="11.5" r="1.3" fill="currentColor"/><path d="M11 19v-2M13 19v-2"/>',
  goto: '<path d="M4 12h13M12 6.5l5.5 5.5-5.5 5.5"/><path d="M20.5 5v14"/>',
  bring: '<path d="M20 12H7M12 6.5L6.5 12l5.5 5.5"/><path d="M3.5 5v14"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  mail: '<path d="M3.5 6h17v12h-17z"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r="0.6" fill="currentColor"/>',
  mute: '<path d="M4 10v4h3.5l4.5 4V6l-4.5 4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  sound: '<path d="M4 10v4h3.5l4.5 4V6l-4.5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  kick: '<path d="M10 4H5v16h5"/><path d="M9.5 12H20M15.5 7.5L20 12l-4.5 4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3 2"/>',
  ban: '<circle cx="12" cy="12" r="8.2"/><path d="M6.2 6.2l11.6 11.6"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M14.6 9.6c-.3-.9-1.3-1.4-2.6-1.4-1.5 0-2.6.7-2.6 1.8 0 2.6 5.3 1.3 5.3 4 0 1.1-1.1 1.9-2.7 1.9-1.4 0-2.4-.6-2.7-1.6"/>',
  map: '<path d="M9 4.5l-6 2v13l6-2 6 2 6-2v-13l-6 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  megaphone: '<path d="M4 10v4l11 4.5v-13z"/><path d="M15 9.5a2.8 2.8 0 0 1 0 5M6.5 14.5V19h3v-3.3"/>',
  box: '<path d="M3.5 8L12 4l8.5 4v8L12 20l-8.5-4z"/><path d="M3.5 8L12 12l8.5-4M12 12v8"/>',
  pack: '<path d="M8 8V6.5a4 4 0 0 1 8 0V8"/><path d="M5.5 8h13v12h-13z"/><path d="M9 13h6v3H9z"/>',
  server: '<path d="M4 5h16v6H4zM4 13h16v6H4z"/><circle cx="7.3" cy="8" r="0.8" fill="currentColor"/><circle cx="7.3" cy="16" r="0.8" fill="currentColor"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l9-11h-6z"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="10" r="2.3"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  lock: '<rect x="6" y="11" width="12" height="9" rx="1"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/>',
  car: '<path d="M4 16v-4l2-5h12l2 5v4z"/><circle cx="8" cy="16.5" r="1.6"/><circle cx="16" cy="16.5" r="1.6"/>',
  moon: '<path d="M19 14.5A8 8 0 0 1 9.5 5a8 8 0 1 0 9.5 9.5z"/>',
  flag: '<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>',
  keys: '<path d="M4 7h16v10H4z"/><path d="M7 10.5h1M10.5 10.5h1M14 10.5h1M7.5 14h9"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  infected: '<circle cx="9" cy="5.5" r="2.4"/><path d="M9 8v7.5M9 10.5h8.5M9 13h7.5M9 15.5l-3 5M9 15.5l3 5"/>',
  target: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  window: '<path d="M4 5.5h16v13H4z"/><path d="M4 9h16"/><path d="M10 12.5l-2 2 2 2M8 14.5h6.5"/>',
  grip: '<path d="M20 9L9 20M20 14l-6 6M20 19l-1 1"/>',
  weight: '<path d="M9.5 8a2.5 2.5 0 1 1 5 0"/><path d="M7.5 8h9l2.5 11.5h-14z"/>',
  rounds: '<path d="M5.5 20V10l1.5-4.5L8.5 10v10zM10.5 20V10L12 5.5l1.5 4.5v10zM15.5 20V10L17 5.5l1.5 4.5v10z"/>',
  refill: '<path d="M6 4.5h7.5v15H6z"/><path d="M6 8.5h7.5M6 12.5h7.5"/><path d="M18 7v9M15.5 13.5L18 16l2.5-2.5"/>',
  hold: '<path d="M3.5 5h17v4.5h-17z"/><path d="M5.5 9.5V19M18.5 9.5V19"/><path d="M12 12v7.5M9 16.5l3 3 3-3"/>',
};
const icon = (name: string, cls = '') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `adm-ic ${cls}`.trim());
  s.innerHTML = ICON[name] ?? '';
  return s;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

export class AdminUI {
  /** the STORE tab (src/ui/admin-store.ts) */
  private store = new StoreTab({ el, button: (l, on, c, ic) => this.button(l, on, c, ic), grave: (k, l, on, ic) => this.grave(k, l, on, ic), order: (a) => this.act.store(a), redraw: () => this.isOpen && this.draw(true) });
  /** the server's answer to an order to the store's book */
  storeGot(m: { ok: boolean; view?: unknown; why?: string; who?: { name: string; acct: string; online: boolean }[] }) {
    this.store.got(m);
  }
  root = el('div', 'adm');
  isOpen = false;
  private view: View = 'who';
  private sub: Sub = 'actions';
  private self: AdminSelf = { role: null, id: 0, god: false, hidden: false, clip: false, voidInv: false, voidTag: false, weightless: false, endless: false, night: false, names: false, tint: null, freecam: false, x: 0, z: 0 };
  private lists: AdminLists = { players: [], gone: [], bans: [], roles: [], checks: '' };
  /** who everything on the right is about: a player's number (the admin's own, when it is themselves) */
  private target = 0;
  /** what is typed in the boxes: kept while the lists are drawn again */
  private find = '';
  /** what is typed to find somebody among the banned and the kept off */
  private findBan = '';
  private why = '';
  private words = '';
  private toAll = '';
  private thing = '';
  private kind = '';
  private count = 1;
  /** a gun is handed over with a magazine in reach and something to put in it */
  private fed = true;
  /**
   * Where a thing given goes: into the inventory of whoever it is for (what finds no room there lies at their
   * feet), or at their feet as it always did. Into the inventory unless this admin has chosen otherwise, and what
   * they chose is kept for them (2026-10-13: "the default mode for spawning loot for somone should be in their
   * inventory unless on space").
   */
  private giveTo: 'inventory' | 'ground' = 'inventory';
  private where = ['', ''];
  /** a button that has to be pressed twice (a ban, a killing): which, and until when the second press counts */
  private sure: { key: string; until: number } | null = null;
  private said: { at: number; text: string }[] = [];
  /** why the server is to restart, for the banner: a box of its own */
  private restartWhy = '';
  /** which groups of places to travel to are open */
  private openPlaces = new Set(['places']);
  /** each player's head, drawn by the game (see `setHeads`): by their number */
  private heads: Record<number, string> = {};
  private timer = 0;
  private side = el('div', 'adm-side');
  private head = el('div', 'adm-head');
  private body = el('div', 'adm-body');
  private log = el('div', 'adm-log');
  private bar = el('div', 'adm-bar');
  /** what the body was last drawn as: it is not drawn again for a list that says the same */
  private drawn = '';
  /** and the same for the bar, the left side, the head and the foot */
  private drawnBar = '';
  private drawnSide = '';
  private drawnHead = '';
  private drawnLog = '';
  /** counted up whenever the heads change, and whenever the server says something: the parts that show them are made again */
  private headsN = 0;
  private saidN = 0;
  /** the last answer to /stashes, its STASHES lines (server/stash-list.ts): copied in one press, as nothing said here can be selected */
  private stashLines: string[] = [];
  private held = false;
  /** where the window was left by whoever moved or resized it (null: where it opens), and where it stands now */
  private box: Box | null = null;
  private shown: Box = { x: 0, y: 0, w: 0, h: 0 };
  /** the Entities page: where a new thing is put, how many of each, and what the view was on when it was last asked */
  private spawnAt: 'front' | 'look' = 'front';
  private spawnN: Record<string, number> = {};
  private looked: AdminLook | null = null;

  constructor(private places: { name: string; x: number; z: number; kind?: string }[], private act: AdminActions, private pictures: Record<string, string> = {}) {
    const main = el('div', 'adm-main');
    main.append(this.head, this.body);
    const mid = el('div', 'adm-mid');
    mid.append(this.side, main);
    this.root.append(this.bar, mid, this.log);
    // The window: moved by its bar, resized by any edge or corner, and kept where it was left.
    try {
      const b = JSON.parse(localStorage.getItem(WINDOW_KEPT) ?? 'null') as Partial<Box> | null;
      if (b && [b.x, b.y, b.w, b.h].every((v) => typeof v === 'number' && Number.isFinite(v))) this.box = { x: b.x!, y: b.y!, w: b.w!, h: b.h! };
    } catch {
      /* nothing kept: it opens where it is made */
    }
    try {
      if (localStorage.getItem(GIVE_KEPT) === 'ground') this.giveTo = 'ground';
    } catch {
      /* nothing kept: into the inventory */
    }
    for (const edge of EDGES) {
      const h = el('div', `adm-edge ${edge}`);
      h.addEventListener('pointerdown', (e) => this.grab(e, edge));
      this.root.append(h);
    }
    const grip = el('div', 'adm-grip');
    grip.title = 'Drag to resize the window';
    grip.append(icon('grip'));
    grip.addEventListener('pointerdown', (e) => this.grab(e, 'se'));
    this.root.append(grip);
    this.bar.title = 'Drag to move the window. Double-click to put it back where it opens.';
    this.bar.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('button, input, kbd')) this.grab(e, 'move');
    });
    this.bar.addEventListener('dblclick', (e) => {
      if (!(e.target as HTMLElement).closest('button, input')) this.resetLayout();
    });
    window.addEventListener('resize', () => this.isOpen && this.fit());
    // (the window can be given the keyboard itself, so that Tab starts inside it and its key shuts it)
    this.root.tabIndex = -1;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Admin panel');
    // (a key pressed in the panel is the panel's: nothing of it reaches the game, but the two that shut it)
    this.root.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') return;
      e.stopPropagation();
      if (e.code === keyOf(controls(), 'Backquote')) {
        e.preventDefault();
        // (not a key held down: the window has the keyboard from the moment it opens, and the key that opened it is still down)
        if (!e.repeat) this.act.close();
      }
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    // (nothing is drawn again between a button going down and coming up: the press would be lost)
    this.root.addEventListener('pointerdown', () => (this.held = true));
    window.addEventListener('pointerup', () => (this.held = false));
  }

  /** the pictures of things, once the game has them (the grid of things to give is drawn from them) */
  setPictures(p: Record<string, string>) {
    this.pictures = p;
  }

  open(self: AdminSelf) {
    this.self = self;
    this.isOpen = true;
    this.root.classList.add('open');
    this.fit();
    if (!this.target || (self.role !== 'admin' && this.target === self.id)) this.target = self.role === 'admin' ? self.id : 0;
    if (self.role !== 'admin') {
      this.sub = 'actions';
      if (this.view === 'entities' || this.view === 'bans' || this.view === 'roles' || this.view === 'store') this.view = 'who';
    }
    // (what the view is on, behind the window: asked now, while it is still what the admin was looking at)
    this.looked = self.role === 'admin' ? this.act.look() : null;
    this.draw(true);
    this.act.ask();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.isOpen && this.act.ask(), 2000);
    this.root.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- the window: where it stands, and how big

  /** where it opens when nothing is kept: most of the screen, in the middle of it, and no bigger than is any use on a very large one */
  private home(): Box {
    const W = window.innerWidth, H = window.innerHeight, w = Math.min(Math.round(W * 0.86), OPEN_W), h = Math.min(Math.round(H * 0.84), OPEN_H);
    return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
  }

  /** the least it may be made on this screen */
  private least() {
    return { w: Math.min(MIN_W, Math.max(280, window.innerWidth - GAP * 2)), h: Math.min(MIN_H, Math.max(220, window.innerHeight - GAP * 2)) };
  }

  /** The window put where it was left (or where it opens): never bigger than the screen, and never off it. */
  private fit() {
    const W = window.innerWidth, H = window.innerHeight, b = this.box ?? this.home(), min = this.least();
    const w = Math.max(min.w, Math.min(b.w, W - GAP * 2)), h = Math.max(min.h, Math.min(b.h, H - GAP * 2));
    const x = Math.max(GAP, Math.min(b.x, W - GAP - w)), y = Math.max(GAP, Math.min(b.y, H - GAP - h));
    this.shown = { x, y, w, h };
    const s = this.root.style;
    s.left = `${x}px`;
    s.top = `${y}px`;
    s.width = `${w}px`;
    s.height = `${h}px`;
    // (how its pages are laid out goes by its own width, not the screen's)
    this.root.classList.toggle('narrow', w < 900);
  }

  /** an edge, a corner or the bar taken hold of: the window goes with the pointer until it is let go, and is kept there */
  private grab(e: PointerEvent, edge: 'move' | (typeof EDGES)[number]) {
    if (e.button !== 0) return;
    e.preventDefault();
    const at = e.currentTarget as HTMLElement, from = { ...this.shown }, x0 = e.clientX, y0 = e.clientY, min = this.least();
    try {
      at.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that is already gone */
    }
    const move = (m: PointerEvent) => {
      const W = window.innerWidth, H = window.innerHeight, dx = m.clientX - x0, dy = m.clientY - y0, b = { ...from };
      if (edge === 'move') {
        b.x = from.x + dx;
        b.y = from.y + dy;
      } else {
        if (edge.includes('e')) b.w = Math.max(min.w, Math.min(from.w + dx, W - GAP - from.x));
        if (edge.includes('s')) b.h = Math.max(min.h, Math.min(from.h + dy, H - GAP - from.y));
        if (edge.includes('w')) {
          b.x = Math.max(GAP, Math.min(from.x + dx, from.x + from.w - min.w));
          b.w = from.x + from.w - b.x;
        }
        if (edge.includes('n')) {
          b.y = Math.max(GAP, Math.min(from.y + dy, from.y + from.h - min.h));
          b.h = from.y + from.h - b.y;
        }
      }
      this.box = b;
      this.fit();
    };
    const up = () => {
      at.removeEventListener('pointermove', move);
      at.removeEventListener('pointerup', up);
      at.removeEventListener('pointercancel', up);
      this.root.classList.remove('moving');
      // (kept as it stands on the screen, not as far as the pointer was dragged past the edge of it)
      if (this.box) this.box = { ...this.shown };
      this.keepBox();
    };
    at.addEventListener('pointermove', move);
    at.addEventListener('pointerup', up);
    at.addEventListener('pointercancel', up);
    this.root.classList.add('moving');
  }

  private keepBox() {
    try {
      if (this.box) localStorage.setItem(WINDOW_KEPT, JSON.stringify(this.box));
      else localStorage.removeItem(WINDOW_KEPT);
    } catch {
      /* a browser that keeps nothing: it lasts as long as the page does */
    }
  }

  /** the window back where it opens, at the size it opens */
  private resetLayout() {
    this.box = null;
    this.keepBox();
    this.fit();
  }

  /**
   * Somebody picked from outside the panel (their dot on the admin's map): everything on the right is about them.
   * @param message the box that writes to them is given the keyboard
   */
  select(id: number, message = false) {
    if (id !== this.self.id && !this.lists.players.some((p) => p.id === id)) return;
    this.target = id;
    this.view = 'who';
    if (message || !this.admin) this.sub = 'actions';
    if (!this.isOpen) return;
    this.draw(true);
    if (message) this.body.querySelector<HTMLInputElement>('input[data-k="i:message"]')?.focus();
  }

  close() {
    this.isOpen = false;
    this.root.classList.remove('open');
    window.clearInterval(this.timer);
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  /** what the server says of this player has changed (a power put on, a role taken) */
  setSelf(self: AdminSelf) {
    const same = (Object.keys(self) as (keyof AdminSelf)[]).every((k) => k === 'x' || k === 'z' || self[k] === this.self[k]);
    this.self = self;
    // (no longer an admin: the pages that are an admin's alone are left)
    if (self.role !== 'admin' && (this.view === 'entities' || this.view === 'bans' || this.view === 'roles' || this.view === 'store')) this.view = 'who';
    if (this.isOpen && !same) this.draw();
  }

  /** what somebody carries has come from the server (asked for with `/pockets`) */
  setPockets(m: Pockets) {
    this.pockets = m;
    if (this.isOpen && this.sub === 'pockets') this.draw(true);
  }
  private pockets: Pockets | null = null;
  private pocketsAsked = 0;

  setLists(l: AdminLists) {
    this.lists = l;
    // (a mod has nobody picked until there is somebody to pick)
    if (!this.pick() && this.self.role !== 'admin') this.target = l.players.find((p) => p.id !== this.self.id)?.id ?? 0;
    if (this.isOpen) this.draw();
  }

  /** everybody's head, as the game has drawn them: shown in place of the letter in the round badge */
  setHeads(heads: Record<number, string>) {
    const same = Object.keys(heads).length === Object.keys(this.heads).length && Object.entries(heads).every(([id, url]) => this.heads[Number(id)] === url);
    this.heads = heads;
    if (same) return;
    this.headsN++;
    if (!this.isOpen) return;
    if (!this.typing(this.side)) this.drawSide();
    this.drawHead();
  }

  /** a line the server said back: shown along the bottom */
  say(text: string) {
    if (/^\d+ stashes kept/.test(text)) this.stashLines = [];
    if (text.startsWith('STASHES ')) this.stashLines.push(text);
    this.said.push({ at: Date.now(), text });
    this.saidN++;
    if (this.said.length > 60) this.said.shift();
    if (this.isOpen) this.drawLog();
  }

  private typing(inside: HTMLElement = this.root) {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && inside.contains(a);
  }

  private send(line: string) {
    this.act.order(line.trim());
    // (and what it did is in the lists a moment later)
    window.setTimeout(() => this.isOpen && this.act.ask(), 700);
  }

  // ---------------------------------------------------------------- who is picked

  private get admin() {
    return this.self.role === 'admin';
  }
  /** the row of whoever is picked (their own, made up from what the game knows, until the server's list has come) */
  private pick(): Player | null {
    const p = this.lists.players.find((q) => q.id === this.target);
    if (p) return p;
    if (this.target && this.target === this.self.id) return { id: this.self.id, name: 'You', role: this.self.role, x: Math.round(this.self.x), z: Math.round(this.self.z), alive: true, flags: 0, mins: 0, hp: 100, kills: 0, tags: 0 } as Player;
    return null;
  }
  private get mine() {
    return this.target === this.self.id;
  }
  /** how whoever is picked is written in an order: nothing for oneself (an order with nobody named is for whoever gave it) */
  private get ref() {
    return this.mine ? '' : ` #${this.target}`;
  }

  // ---------------------------------------------------------------- the pieces

  /**
   * Children put in place of what a part of the window held. Whatever in it had the keyboard has it again, by the
   * name it goes by (`data-k`): the lists come every two seconds, and somebody working the panel with Tab and
   * Enter was put back at its start every time they did.
   */
  private swap(host: HTMLElement, kids: (HTMLElement | SVGElement)[]) {
    const a = document.activeElement as HTMLElement | null, had = !!a && a !== host && host.contains(a), k = had ? a!.dataset.k : undefined;
    host.replaceChildren(...kids);
    if (!had) return;
    const again = k ? [...host.querySelectorAll<HTMLElement>('[data-k]')].find((n) => n.dataset.k === k && !(n as HTMLButtonElement).disabled) : undefined;
    // (what it stood for is gone: the window keeps the keyboard, so that ` still shuts it)
    (again ?? this.root).focus({ preventScroll: true });
    if (again instanceof HTMLInputElement && again.type === 'text') again.setSelectionRange(again.value.length, again.value.length);
  }

  private button(label: string, on: () => void, cls = '', ic = '') {
    const b = el('button', `adm-b ${cls}`.trim());
    b.type = 'button';
    if (ic) b.append(icon(ic));
    if (label) b.append(el('span', '', label));
    b.dataset.k = `${ic}|${label}`;
    b.onclick = on;
    return b;
  }

  /** a button for something that cannot be had here and now: it is shown, greyed, with why */
  private off(label: string, why: string, ic = '') {
    const b = this.button(label, () => {}, '', ic);
    b.disabled = true;
    b.title = why;
    return b;
  }

  /** a button that asks once more before it does it */
  private grave(key: string, label: string, on: () => void, ic = '') {
    const armed = this.sure?.key === key && this.sure.until > Date.now();
    const b = this.button(armed ? 'Click again to confirm' : label, () => {
      if (armed) {
        this.sure = null;
        on();
      } else this.sure = { key, until: Date.now() + 4000 };
      this.draw(true);
    }, armed ? 'bad armed' : 'bad', armed ? 'warn' : ic);
    // (the same button before and after it is armed: the keyboard stays on it for the second press)
    b.dataset.k = `sure:${key}`;
    if (!armed) b.title = 'Asks once more before it is done';
    return b;
  }

  /** a switch: on or off, with what it is, what it does, and the key for it if it has one */
  private flip(label: string, does: string, on: boolean | undefined, toggle: () => void, ic: string, key = '') {
    const b = el('button', `adm-sw${on ? ' on' : ''}`);
    b.type = 'button';
    b.dataset.k = `sw:${label}`;
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(!!on));
    const text = el('span', 'adm-sw-text');
    text.append(el('b', '', label), el('small', '', does));
    b.append(icon(ic), text);
    if (key) b.append(el('kbd', '', key));
    b.append(el('i', 'adm-knob'));
    b.onclick = toggle;
    return b;
  }

  /** @param k the name it goes by, when what it says in its box changes with who is picked */
  private input(value: string, hint: string, set: (v: string) => void, cls = '', enter?: () => void, k = hint) {
    const i = el('input', `adm-i ${cls}`.trim());
    i.value = value;
    i.placeholder = hint;
    i.setAttribute('aria-label', hint);
    i.dataset.k = `i:${k}`;
    i.spellcheck = false;
    i.autocomplete = 'off';
    i.maxLength = 120;
    i.oninput = () => set(i.value);
    // (A handler set as `onkeydown` that answers false stops the key. Written `e.key === 'Enter' && enter()`, this
    // answered false to every key but Enter: nothing could be typed in any box that sends on Enter. 2026-10-13: "i
    // am unable to type into the a word for everybody panel ... when i click into the box and type nothing happens".)
    if (enter) i.onkeydown = (e) => {
      if (e.key === 'Enter') enter();
    };
    return i;
  }

  private card(title: string, ic: string, ...inside: (HTMLElement | SVGElement)[]) {
    const c = el('div', 'adm-card');
    const t = el('div', 'adm-card-t');
    t.append(icon(ic), el('span', '', title));
    c.append(t, ...inside);
    return c;
  }

  private line(...inside: (HTMLElement | SVGElement | string)[]) {
    const l = el('div', 'adm-line');
    for (const c of inside) l.append(typeof c === 'string' ? el('span', 'adm-label', c) : c);
    return l;
  }

  /** who somebody is, in a round badge: their first letter, in the colour of what they are */
  private face(p: Player, big = false) {
    const f = el('span', `adm-face${big ? ' big' : ''}${p.role ? ` ${p.role}` : ''}${p.alive ? '' : ' dead'}`, (p.name === 'You' ? 'Y' : p.name.trim().charAt(0) || '?').toUpperCase());
    const head = this.heads[p.id];
    if (head) {
      const img = el('img');
      img.src = head;
      img.alt = '';
      img.draggable = false;
      f.classList.add('pic');
      f.replaceChildren(img);
    }
    return f;
  }

  private bar01(v: number, cls = '') {
    const b = el('span', `adm-hp ${cls}`.trim());
    const fill = el('i');
    fill.style.width = `${Math.max(0, Math.min(100, v))}%`;
    if (v < 35) fill.classList.add('low');
    b.append(fill);
    return b;
  }

  // ---------------------------------------------------------------- drawing

  /** @param all the body too, whatever it was last drawn as */
  private draw(all = false) {
    if (this.sure && this.sure.until <= Date.now()) this.sure = null;
    this.drawBar();
    if (!this.typing(this.side)) this.drawSide();
    this.drawHead();
    // (the body is drawn again only when what it shows has changed, and never under somebody typing in it or
    // pressing on it: a grid of a hundred pictures is not made again every two seconds for nothing)
    const key = this.bodyKey();
    if (all || (key !== this.drawn && !this.typing(this.body) && !this.held)) {
      // (how far each part that scrolls was scrolled is kept, and given back to the part made in its place: a thing
      // binned in somebody's pockets put the list back at its top. "when i deleted an item from inventory tab on
      // admin panel it scrolls my view back to the top", 2026-10-13.)
      const SCROLLS = '.adm-pockets, .adm-table, .adm-grid:not(.held)';
      const keep = this.body.scrollTop, inner = [...this.body.querySelectorAll(SCROLLS)].map((e) => e.scrollTop);
      this.swap(this.body, this.bodyOf());
      this.body.scrollTop = keep;
      this.body.querySelectorAll(SCROLLS).forEach((e, k) => (e.scrollTop = inner[k] ?? 0));
      this.drawn = key;
    }
    this.drawLog();
  }

  /** everything the body shows, in a word: when this is the same, the body is */
  private bodyKey() {
    const p = this.pick(), s = this.self;
    const base = `${this.view}|${this.sub}|${this.target}|${s.role}|${this.sure?.key ?? ''}`;
    if (this.view === 'entities') return `${base}|${this.spawnAt}|${JSON.stringify(this.spawnN)}|${JSON.stringify(this.looked ? [this.looked.what, Math.round(this.looked.x), Math.round(this.looked.z), Math.round(this.looked.dist)] : null)}|${JSON.stringify(this.lists.stats ?? {})}`;
    if (this.view === 'server') return `${base}|${JSON.stringify(this.lists.stats ?? {})}|${this.lists.checks}|${this.lists.players.length}`;
    if (this.view === 'bans') return `${base}|${JSON.stringify(this.lists.bans)}|${JSON.stringify(this.lists.turned ?? [])}`;
    if (this.view === 'roles') return `${base}|${JSON.stringify(this.lists.roles)}`;
    if (this.view === 'store') return `${base}|${this.store.n}`;
    if (this.sub === 'items') return `${base}|${this.kind}|${this.count}|${this.fed}|${this.giveTo}|${Object.keys(this.pictures).length}`;
    if (this.sub === 'kits') return base;
    if (this.sub === 'pockets') return `${base}|${this.pockets?.id}|${JSON.stringify(this.pockets?.inv ?? null).length}|${Object.keys(this.pictures).length}`;
    return `${base}|${p ? [p.role, p.muted, p.god, p.hidden, p.clip, p.voidInv, p.voidTag, p.weightless, p.endless, p.bottomless, p.alive].join() : ''}|${this.mine ? [s.god, s.hidden, s.clip, s.voidInv, s.voidTag, s.weightless, s.endless, s.bottomless, s.night, s.names, s.freecam, s.tint].join() : ''}`;
  }

  private bodyOf(): HTMLElement[] {
    if (this.view === 'entities' && this.admin) return this.entities();
    if (this.view === 'server') return this.server();
    if (this.view === 'bans') return this.bans();
    if (this.view === 'roles') return this.roles();
    if (this.view === 'store') return this.store.body();
    const p = this.pick();
    if (!p) return [el('div', 'adm-empty', this.lists.players.length > 1 ? 'Pick somebody on the left.' : 'Nobody else is on.')];
    const tabs = el('div', 'adm-subs');
    const tab = (id: Sub, label: string, ic: string) => this.button(label, () => {
      this.sub = id;
      this.draw(true);
    }, `sub${this.sub === id ? ' on' : ''}`, ic);
    tabs.append(tab('actions', this.mine ? 'Powers and travel' : 'Actions', this.mine ? 'bolt' : 'user'));
    if (this.admin) tabs.append(tab('pockets', 'Inventory', 'pack'), tab('items', 'Give items', 'box'), tab('kits', 'Kits', 'pack'));
    const part = this.sub === 'items' && this.admin ? this.items(p) : this.sub === 'kits' && this.admin ? this.kits(p) : this.sub === 'pockets' && this.admin ? this.carried(p) : this.mine ? this.me() : this.actions(p);
    return [tabs, ...part];
  }

  private drawBar() {
    const st = this.lists.stats;
    const key = `${this.admin}|${this.lists.players.length}|${st?.asleep ?? ''}|${st?.up ?? ''}|${st?.today ?? ''}|${this.lists.checks}`;
    if (key === this.drawnBar) return;
    this.drawnBar = key;
    const title = el('div', 'adm-title');
    title.append(icon('shield'), el('span', '', this.admin ? 'ADMIN PANEL' : 'MOD PANEL'));
    const chips = el('div', 'adm-chips');
    const chip = (ic: string, text: string, tip: string) => {
      const c = el('span', 'adm-chip');
      c.title = tip;
      c.append(icon(ic), el('span', '', text));
      return c;
    };
    chips.append(chip('user', `${this.lists.players.length} online`, 'Players on the server now'));
    if (st?.today) chips.append(chip('eye', `${st.today} today`, 'Different players in the world in the last 24 hours (it was on the main menu)'));
    if (st?.asleep) chips.append(chip('moon', `${st.asleep} left a body`, 'Closed the game without logging out: their body is still there'));
    if (st) chips.append(chip('clock', `up ${st.up < 120 ? `${st.up} min` : `${Math.round(st.up / 60)} h`}`, 'How long the server has been running'));
    chips.append(chip('flag', `checks: ${this.lists.checks || '?'}`, 'What the server does about cheating: watch (write it down) or enforce (refuse it)'));
    const reset = this.button('Reset layout', () => this.resetLayout(), 'ghostly', 'window');
    reset.title = 'Put this window back where it opens, at the size it opens. (Drag the bar to move it, any edge or corner to resize it.)';
    const x = this.button('Close', () => this.act.close(), 'ghostly', 'x');
    x.append(el('kbd', '', shown('Backquote')));
    this.swap(this.bar, [title, chips, reset, x]);
  }

  private drawSide() {
    const f = this.find.toLowerCase().trim(), s = this.self;
    // (made again only when something it shows has changed: who is on and how they are, who is picked, a head drawn)
    const key = JSON.stringify([this.view, this.target, s.role, s.id, s.god, s.hidden, s.clip, s.x, s.z, this.headsN, this.sure?.key ?? '', this.lists.bans.length, this.lists.gone.slice(0, 10),
      this.lists.players.map((p) => [p.id, p.name, p.role, p.x, p.z, p.alive, p.hp, p.flags, p.asleep, p.away, p.god, p.hidden, p.clip, p.muted, p.seat])]);
    if (key === this.drawnSide) return;
    this.drawnSide = key;
    const top = el('div', 'adm-find');
    top.append(icon('search'), this.input(this.find, 'Find a player', (v) => {
      this.find = v;
      this.filterSide();
    }));
    const list = el('div', 'adm-who');
    const row = (p: Player, you = false) => {
      const r = el('button', `adm-p${this.view === 'who' && p.id === this.target ? ' on' : ''}${p.flags > 20 ? ' hot' : ''}`);
      r.type = 'button';
      r.dataset.k = `p${p.id}`;
      r.dataset.find = `${p.name} #${p.id}`.toLowerCase();
      const text = el('span', 'adm-p-text');
      const name = el('span', 'adm-p-name', you ? 'You' : p.name);
      if (p.role && !you) name.append(el('em', p.role, p.role === 'admin' ? 'A' : 'M'));
      const under = el('span', 'adm-p-sub');
      const state = !p.alive ? 'dead' : p.asleep ? 'gone, body left' : p.away ? 'tabbed out' : `${p.hp ?? '?'} hp`;
      const far = Math.round(Math.hypot(p.x - this.self.x, p.z - this.self.z));
      under.append(el('span', '', you ? p.name === 'You' ? `#${p.id}` : `${p.name} · #${p.id}` : `#${p.id} · ${state} · ${far} m`));
      text.append(name, under);
      if (!you) text.append(this.bar01(p.alive ? p.hp ?? 100 : 0, 'thin'));
      r.append(this.face(p), text);
      const marks = el('span', 'adm-marks');
      const mark = (on: boolean | undefined, ic: string, tip: string) => {
        if (!on) return;
        const m = icon(ic, 'lit');
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        t.textContent = tip;
        m.append(t);
        marks.append(m);
      };
      mark(you ? this.self.god : p.god, 'shield', 'God mode');
      mark(you ? this.self.hidden : p.hidden, 'ghost', 'Vanished');
      mark(you ? this.self.clip : p.clip, 'fly', 'Noclip');
      mark(p.muted, 'mute', 'Muted');
      mark(!!p.seat, 'car', 'In a car');
      if (p.flags) {
        const fl = el('span', 'adm-flags', String(p.flags));
        fl.title = 'How often the cheat checks have fired on them';
        marks.append(fl);
      }
      r.append(marks);
      r.onclick = () => {
        this.target = p.id;
        this.view = 'who';
        if (!this.admin) this.sub = 'actions';
        this.act.picked(p.id);
        this.draw(true);
      };
      return r;
    };
    const me = this.lists.players.find((p) => p.id === this.self.id) ?? (this.self.id ? ({ id: this.self.id, name: 'You', role: this.self.role, x: 0, z: 0, alive: true, flags: 0, mins: 0, hp: 100, kills: 0, tags: 0 } as Player) : null);
    if (this.admin && me) {
      list.append(el('div', 'adm-group', 'Yourself'), row(me, true));
    }
    const others = this.lists.players.filter((p) => p.id !== this.self.id);
    list.append(el('div', 'adm-group', `Players  ${others.length}`));
    for (const p of others) list.append(row(p));
    if (!others.length) list.append(el('div', 'adm-none', this.lists.players.length ? 'Nobody else is on.' : 'The list is on its way.'));
    if (this.lists.gone.length) {
      list.append(el('div', 'adm-group', 'Left lately'));
      for (const g of this.lists.gone.slice(0, 10)) {
        const r = el('div', 'adm-p gone');
        r.dataset.find = `${g.name} #${g.id}`.toLowerCase();
        const text = el('span', 'adm-p-text');
        text.append(el('span', 'adm-p-name', g.name), el('span', 'adm-p-sub', `#${g.id} · ${g.mins} min ago`));
        r.append(el('span', 'adm-face dead', (g.name.trim().charAt(0) || '?').toUpperCase()), text);
        if (this.admin) {
          const b = this.grave(`gban${g.id}`, 'Ban', () => this.send(`/ban #${g.id}${this.why.trim() ? ` ${this.why.trim()}` : ''}`), 'ban');
          b.classList.add('small');
          r.append(b);
        }
        list.append(r);
      }
    }
    const nav = el('div', 'adm-nav');
    const go = (v: View, label: string, ic: string, tip: string, n = '') => {
      const b = this.button(label, () => {
        this.view = v;
        // (what the view is on is asked again as the page that uses it is opened)
        if (v === 'entities') this.looked = this.act.look();
        if (v === 'store') this.store.open();
        this.draw(true);
      }, `nav${this.view === v ? ' on' : ''}`, ic);
      b.title = tip;
      if (n) b.append(el('em', '', n));
      return b;
    };
    if (this.admin) nav.append(go('entities', 'Entities', 'car', 'Cars and the infected: put them in the world, and take them out of it'));
    nav.append(go('server', 'Server', 'megaphone', 'A word to everybody, what the server is doing, and the keys'));
    if (this.admin) nav.append(go('bans', 'Bans', 'ban', 'Who is banned or kept off, and lifting it', this.lists.bans.length ? String(this.lists.bans.length) : ''), go('roles', 'Roles', 'star', 'Who is an admin or a mod'), go('store', 'Store', 'coin', 'What was bought at the store: give, revoke, refund, move', this.store.view?.looks ? String(this.store.view.looks) : ''));
    const keep = this.side.querySelector('.adm-who')?.scrollTop ?? 0;
    this.swap(this.side, [top, list, nav]);
    list.scrollTop = keep;
    if (f) this.filterSide();
  }

  /** the list of players alone, as its filter is typed (the box keeps the keyboard) */
  private filterSide() {
    const f = this.find.toLowerCase().trim();
    for (const r of this.side.querySelectorAll<HTMLElement>('.adm-p')) r.style.display = !f || (r.dataset.find ?? '').includes(f) ? '' : 'none';
  }

  /** across the top of the right side: who all of it is about */
  private drawHead() {
    const p = this.view === 'who' ? this.pick() : null;
    const key = JSON.stringify([this.view, this.target, this.self.role, this.self.id, this.self.x, this.self.z, this.headsN, p]);
    if (key === this.drawnHead) return;
    this.drawnHead = key;
    if (this.view !== 'who') {
      const t = el('div', 'adm-head-t');
      const [ic, title, sub] = this.view === 'entities' ? ['car', 'Entities', 'Cars and the infected: put them in the world, and take them out of it. Everybody sees what is done here.']
        : this.view === 'server' ? ['megaphone', 'The server', 'A word to everybody, what the server is doing, and the keys.'] : this.view === 'store' ? ['coin', 'Store', 'What was bought, checked on chain as it was paid. A payment that came short or late needs a look: pass it, or refund it from the store’s wallet yourself and mark it so.'] : this.view === 'bans' ? ['ban', 'Bans', 'A ban is of the game that was played and of the connection it was played from. It outlasts the server’s restarts.'] : ['star', 'Roles', 'A mod can warn, mute, kick and time out. An admin can do everything here.'];
      const text = el('div', 'adm-head-text');
      text.append(el('b', '', title), el('small', '', sub));
      t.append(icon(ic, 'huge'), text);
      this.swap(this.head, [t]);
      return;
    }
    if (!p) return void this.swap(this.head, [el('div', 'adm-head-t')]);
    const t = el('div', 'adm-head-t');
    const text = el('div', 'adm-head-text');
    const name = el('b', '', this.mine ? (p.name === 'You' ? 'You' : `${p.name}  (you)`) : p.name);
    if (p.role) name.append(el('em', p.role, p.role === 'admin' ? 'ADMIN' : 'MOD'));
    const facts = el('small');
    const fact = (ic: string, s: string) => {
      const f = el('span', 'adm-fact');
      f.append(icon(ic), el('span', '', s));
      facts.append(f);
    };
    fact('user', `#${p.id}`);
    fact('pin', `${p.x}, ${p.z}`);
    if (!this.mine) fact('goto', `${Math.round(Math.hypot(p.x - this.self.x, p.z - this.self.z))} m from you`);
    if (p.mins) fact('clock', `on ${p.mins} min`);
    if (p.kills) fact('skull', `${p.kills} kill${p.kills === 1 ? '' : 's'}`);
    if (p.tags) fact('star', `${p.tags} tag${p.tags === 1 ? '' : 's'} cashed`);
    if (p.flags) fact('flag', `${p.flags} flag${p.flags === 1 ? '' : 's'}`);
    // (the device their game runs on: /same dev:... lists everybody on it, /ban dev:... bans it)
    if (p.dev) fact('shield', `dev:${p.dev}`);
    const state = [p.alive ? '' : 'dead', p.asleep ? 'gone: body left behind' : p.away ? 'not answering (tabbed out)' : '', p.seat ? 'in a car' : '', p.muted ? 'muted' : ''].filter(Boolean).join(' · ');
    if (state) fact('warn', state);
    text.append(name, facts);
    const hp = el('div', 'adm-head-hp');
    hp.append(icon('heart'), this.bar01(p.alive ? p.hp ?? 100 : 0, 'wide'), el('span', '', p.alive ? `${p.hp ?? '?'}` : 'dead'));
    t.append(this.face(p, true), text, hp);
    const quick = el('div', 'adm-quick');
    if (this.admin && !this.mine) {
      quick.append(
        this.button('Go to', () => this.send(`/goto #${p.id}`), 'tall', 'goto'),
        this.button('Bring', () => this.send(`/bring #${p.id}`), 'tall', 'bring'),
        this.button('Watch', () => {
          this.act.watch(p.id);
          this.act.close();
        }, 'tall', 'eye'),
      );
    } else if (this.admin) {
      quick.append(this.button('Map', () => this.act.map(), 'tall', 'map'), this.button('Heal', () => this.send('/heal'), 'tall good', 'heart'));
    }
    this.swap(this.head, [t, quick]);
  }

  private drawLog() {
    // (The last few things said, the newest lowest and the older the fainter. There is no list to scroll: 2026-10-13,
    // "when the notifications feed at the bottom fills up a scroll wheel appears im not a fan of that".)
    const big = this.view === 'server';
    const lines = this.said.slice(big ? -8 : -3);
    const key = `${big}|${this.saidN}`;
    if (key === this.drawnLog) return;
    this.drawnLog = key;
    this.log.classList.toggle('big', big);
    const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    this.log.replaceChildren(icon('megaphone'), ...(lines.length ? lines.map((l, k) => {
      const row = el('div', k === lines.length - 1 ? 'last' : '');
      row.append(el('time', '', clock(l.at)), el('span', '', l.text));
      row.title = l.text;
      row.style.opacity = String(Math.max(0.4, 1 - (lines.length - 1 - k) * 0.1));
      return row;
    }) : [el('div', 'dim', 'What an order did is said here, and in the chat.')]));
    if (this.stashLines.length) this.log.append(this.copyStashes());
  }

  /**
   * The whole of the last answer to /stashes onto the clipboard in one press (2026-10-23: the owner pastes it to be
   * checked against before the map changes). Where the clipboard cannot be written, the text is laid out selected.
   */
  private copyStashes() {
    const text = this.stashLines.join('\n'), b = el('button', 'adm-copy', `Copy the stash list (${this.stashLines.length} lines)`);
    b.onclick = () => {
      const pick = () => {
        const box = el('textarea', 'adm-copied');
        box.value = text;
        box.readOnly = true;
        b.replaceWith(box);
        box.select();
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => void (b.textContent = 'Copied: paste it where it was asked for'), pick);
      else pick();
    };
    return b;
  }

  // ---------------------------------------------------------------- somebody else

  private actions(p: Player): HTMLElement[] {
    const who = `#${p.id}`, admin = this.admin, why = () => (this.why.trim() ? ` ${this.why.trim()}` : '');
    const grid = el('div', 'adm-cards');
    if (admin) {
      grid.append(this.card('Body', 'heart',
        this.line(
          this.button('Heal', () => this.send(`/heal ${who}`), 'good', 'heart'),
          this.grave(`slay${p.id}`, 'Kill', () => this.send(`/slay ${who}`), 'skull'),
          this.button('What they carry', () => this.send(`/inv ${who}`), '', 'pack'),
        ),
        el('div', 'dim', 'What they carry is listed along the bottom.'),
      ));
      grid.append(this.carry(p));
    }
    const talk = () => {
      if (!this.words.trim()) return;
      this.send(`/msg ${who} ${this.words.trim()}`);
      this.words = '';
      this.draw(true);
    };
    grid.append(this.card('Say something to them', 'mail',
      this.input(this.words, `A message for ${p.name} alone. Enter sends it`, (v) => (this.words = v), 'wide', talk, 'message'),
      this.line(
        this.button('Send as a message', talk, '', 'mail'),
        this.button('Send as a warning', () => {
          this.send(`/warn ${who} ${this.words.trim() || 'keep to the rules'}`);
          this.words = '';
          this.draw(true);
        }, 'bad', 'warn'),
      ),
      el('div', 'dim', 'A warning is shown to them across the screen, and written down.'),
    ));
    grid.append(this.card('Discipline', 'kick',
      this.input(this.why, 'Why (they are shown this)', (v) => (this.why = v), 'wide'),
      this.line('Mute',
        p.muted ? this.button('Unmute', () => this.send(`/unmute ${who}`), 'good', 'sound') : this.button('10 min', () => this.send(`/mute ${who} 10`), '', 'mute'),
        ...(p.muted ? [] : [this.button('60 min', () => this.send(`/mute ${who} 60`), '', 'mute')]),
      ),
      // (the name and wallet fixed at their first cashed tag: server/pinned.ts)
      ...(p.pinned ? [this.line('Name and wallet', this.button('Let them change', () => this.send(`/unlock ${who}`), '', 'check'))] : []),
      // (putting somebody off the server asks once more, as a ban does: a slip of the hand is somebody's evening)
      this.line('Kick', this.grave(`kick${p.id}`, 'Kick off the server', () => this.send(`/kick ${who}${why()}`), 'kick')),
      this.line('Keep off', ...[5, 10, 30, 60].map((m) => this.grave(`out${m}_${p.id}`, `${m} min`, () => this.send(`/timeout ${who} ${m}${why()}`), 'clock'))),
      ...(admin ? [this.line('For good', this.grave(`ban${p.id}`, 'Ban: their game and their address', () => this.send(`/ban ${who}${why()}`), 'ban'))] : []),
    ));
    if (admin) {
      grid.append(this.card('Role', 'star',
        this.line(
          this.button('Make a mod', () => this.send(`/mod ${who}`), '', 'star'),
          this.grave(`adm${p.id}`, 'Make an admin', () => this.send(`/admin ${who}`), 'shield'),
          ...(p.role ? [this.grave(`demote${p.id}`, 'Take their role', () => this.send(`/demote ${who}`), 'x')] : []),
        ),
        el('div', 'dim', p.role ? `${p.name} is ${p.role === 'admin' ? 'an admin' : 'a mod'}.` : `${p.name} has no role.`),
      ));
      // (an admin's powers are another admin's to put on and off)
      if (p.role === 'admin') {
        const sw = (label: string, does: string, order: string, on: boolean | undefined, ic: string) => this.flip(label, does, on, () => this.send(`/${order} ${who} ${on ? 'off' : 'on'}`), ic);
        const theirs = el('div', 'adm-sws');
        theirs.append(
          sw('God mode', 'Nothing hurts them', 'god', p.god, 'shield'),
          sw('Vanish', 'Nobody but an admin sees them', 'vanish', p.hidden, 'ghost'),
          sw('Noclip', 'They fly, through anything', 'noclip', p.clip, 'fly'),
          sw('Void inventory', 'Nothing they carried is left on their body', 'voidinv', p.voidInv, 'trash'),
          sw('Void dog tag', 'No tag of theirs is left to cash in', 'voidtag', p.voidTag, 'trash'),
        );
        grid.append(this.card(`${p.name}'s powers`, 'bolt', theirs));
      }
    }
    return [grid];
  }

  // ---------------------------------------------------------------- what is carried, and fired

  /**
   * "Carry and ammunition" (2026-10-13: "admins should have infinite weight toggle", "reload mags button and no
   * ammo consumtion otpion ... intuitive"): the two powers that are about what is carried and the refill, together
   * in one card, each with what it does in a sentence. On one's own page, and on the page of whoever is picked: the
   * two switches are an admin's (another admin's are an admin's to put on and off, as the other powers are), and
   * the refill is for anybody. The words are the one list's (CARRY_POWERS), which the server answers in too.
   * @param p whoever is picked (null: oneself)
   */
  private carry(p: Player | null): HTMLElement {
    const s = this.self, who = p ? ` #${p.id}` : '';
    const sw = (k: CarryPower, on: boolean | undefined, ic: string) => this.flip(CARRY_POWERS[k].label, p ? CARRY_POWERS[k].theirs : CARRY_POWERS[k].mine, on, () => this.send(`/${CARRY_POWERS[k].order}${who} ${on ? 'off' : 'on'}`), ic);
    const sws = el('div', 'adm-sws');
    // (beside "weightless", the inventory that never fills: 2026-10-13, "admins need an infinite inventory option")
    if (!p || p.role === 'admin') sws.append(sw('weightless', p ? p.weightless : s.weightless, 'weight'), sw('bottomless', p ? p.bottomless : s.bottomless, 'hold'), sw('endless', p ? p.endless : s.endless, 'rounds'));
    const fill = this.button(p ? `Refill ${p.name}’s magazines` : 'Refill my magazines', () => this.send(`/refill${who}`), 'good', 'refill');
    return this.card(p ? `${p.name}: carry and ammunition` : 'Carry and ammunition', 'rounds',
      ...(sws.childElementCount ? [sws] : []),
      this.line(fill),
      el('div', 'dim', `Refill: every magazine and every gun ${p ? 'they carry' : 'you carry'} is filled at once, wherever it is: in the hands, on the back, in the holster, in a pocket, in a pack, in a bag in a pack. A gun with no magazine in it is given its own.${p && p.role !== 'admin' ? ' (Weightless, the bottomless inventory and endless ammunition are an admin’s powers: they are not one.)' : ''}`),
      ...(sws.childElementCount ? [el('div', 'dim', `Bottomless inventory: the hold is on the inventory screen, under what is worn. Put off, what fits what ${p ? 'they wear' : 'you wear'} stays and the rest is put at ${p ? 'their' : 'your'} feet. It weighs what it weighs, unless weightless is on too.`)] : []),
    );
  }

  // ---------------------------------------------------------------- oneself

  private me(): HTMLElement[] {
    const s = this.self;
    const grid = el('div', 'adm-cards');
    // (the switches side by side where the card is wide enough for two of them)
    const powers = el('div', 'adm-sws');
    powers.append(
      this.flip('God mode', 'Nothing hurts you', s.god, () => this.send(`/god ${s.god ? 'off' : 'on'}`), 'shield'),
      this.flip('Vanish', 'Nobody but an admin sees you; the infected ignore you', s.hidden, () => this.send(`/vanish ${s.hidden ? 'off' : 'on'}`), 'ghost'),
      this.flip('Noclip', 'Fly, through anything', s.clip, () => this.send(`/noclip ${s.clip ? 'off' : 'on'}`), 'fly', 'N'),
      this.flip('Free camera', 'The view leaves your body (H brings the body to it)', s.freecam, () => {
        this.act.freecam(!s.freecam);
        this.act.close();
      }, 'camera', 'K'),
      this.flip('Night vision', 'It is day, for you alone, in the bunker too', s.night, () => this.act.night(!s.night), 'sun'),
      this.flip('Names of players', 'Everybody’s name where they are, however far, through anything', s.names, () => this.act.names(!s.names), 'eye'),
    );
    grid.append(this.card('Powers', 'bolt', powers,
      el('div', 'dim', 'Flying, and in the free camera: W A S D, Space up, Ctrl down, Shift fast, Alt slow. No tag is cashed in while god mode, vanish or noclip is on. God mode is proof against the gas as well.'),
    ));
    // (under the powers, the ones that are about what is carried, and the refill)
    if (this.admin) grid.append(this.carry(null));
    const coords = el('div', 'adm-line');
    const jump = () => {
      const [x, z] = this.where.map(Number);
      if (this.where.every((v) => v.trim() !== '') && Number.isFinite(x) && Number.isFinite(z)) this.send(`/tp ${x} ${z}`);
    };
    coords.append(el('span', 'adm-label', 'To'), this.input(this.where[0], 'x', (v) => (this.where[0] = v), 'num', jump), this.input(this.where[1], 'z', (v) => (this.where[1] = v), 'num', jump), this.button('Go', jump, '', 'goto'));
    const places = el('div', 'adm-travel');
    const group = (id: string, title: string, list: typeof this.places, ic: string) => {
      if (!list.length) return;
      const open = this.openPlaces.has(id);
      const head = this.button(title, () => {
        if (open) this.openPlaces.delete(id);
        else this.openPlaces.add(id);
        this.draw(true);
      }, `fold${open ? ' on' : ''}`, open ? 'down' : 'right');
      head.append(el('em', '', String(list.length)));
      places.append(head);
      if (!open) return;
      const g = el('div', 'adm-places');
      for (const p of list) g.append(this.button(p.name, () => this.send(`/tp ${Math.round(p.x)} ${Math.round(p.z)}`), 'place', ic));
      places.append(g);
    };
    group('places', 'Places', this.places.filter((p) => p.kind !== 'spawn'), 'pin');
    group('starts', 'Starts: where new survivors drop in', this.places.filter((p) => p.kind === 'spawn'), 'flag');
    grid.append(this.card(`Travel   (you are at ${Math.round(s.x)}, ${Math.round(s.z)})`, 'map',
      this.button('Open the map, and right-click where to go', () => this.act.map(), 'wide', 'map'),
      places,
      coords,
      el('div', 'dim', 'To a player, or a player to you: pick them on the left. You are set down on top of whatever is there: noclip goes inside.'),
    ));
    grid.append(this.card('Your body', 'heart',
      this.line(this.button('Heal me', () => this.send('/heal'), 'good', 'heart'), this.grave('die', 'Kill me', () => this.send('/die'), 'skull')),
      this.flip('Void inventory when you die', 'Nothing you carried is left on your body', s.voidInv, () => this.send(`/voidinv ${s.voidInv ? 'off' : 'on'}`), 'trash'),
      this.flip('Void dog tag when you die', 'No tag of yours is left to be cashed in', s.voidTag, () => this.send(`/voidtag ${s.voidTag ? 'off' : 'on'}`), 'trash'),
    ));
    // the colour of the word ADMIN before this admin's name in the chat: the rainbow, or one of their own
    const tag = el('div', 'adm-line');
    const off = s.tint === 'off';
    const sample = el('span', `adm-tag${s.tint ? '' : ' rgb'}${off ? ' off' : ''}`, '[ADMIN]');
    if (s.tint && !off) sample.style.color = s.tint;
    const colour = el('input', 'adm-colour');
    colour.type = 'color';
    colour.value = s.tint && !off ? s.tint : '#c8a8ff';
    colour.title = 'Any other colour';
    colour.setAttribute('aria-label', 'Any other colour for the tag');
    colour.dataset.k = 'i:tag colour';
    colour.onchange = () => this.act.tint(colour.value);
    // (no tag at all: read as anybody is where everybody talks; the staff channel still says who is who)
    tag.append(sample, this.button('No tag', () => this.act.tint(off ? null : 'off'), off ? 'on' : '', 'x'), this.button('RGB', () => this.act.tint(null), s.tint ? '' : 'on'),
      ...['#ff5a4d', '#ffb02e', '#ffe45c', '#5fe36b', '#35d6ff', '#6f8cff', '#c97bff', '#ffffff'].map((c) => {
        const b = this.button('', () => this.act.tint(c), `swatch${s.tint === c ? ' on' : ''}`);
        b.style.background = c;
        b.title = c;
        b.setAttribute('aria-label', `Tag colour ${c}`);
        b.dataset.k = `swatch:${c}`;
        return b;
      }), colour);
    grid.append(this.card('Your tag in the chat', 'star', tag, el('div', 'dim', 'The colour of the word ADMIN before your name, or no tag at all. In the staff channel (Tab, in the chat box) you are always named as what you are.')));
    return [grid];
  }

  // ---------------------------------------------------------------- things to give

  /** the line that says who a thing goes to: on every page that gives anything */
  private forWhom(p: Player, what: string) {
    const b = el('div', 'adm-for');
    b.append(icon('goto'), el('span', '', what), this.face(p), el('b', '', this.mine ? 'you' : `#${p.id} ${p.name}`), el('span', 'dim', this.mine ? '(pick a player on the left to give to them instead)' : '(pick yourself on the left to give to you instead)'));
    return b;
  }

  private items(p: Player): HTMLElement[] {
    const { all, count: counts } = given();
    const tools = el('div', 'adm-tools');
    const find = el('div', 'adm-find wide');
    find.append(icon('search'), this.input(this.thing, 'Find a thing by its name', (v) => {
      this.thing = v;
      this.filterItems();
    }));
    const amount = el('div', 'adm-seg');
    amount.append(el('span', 'adm-label', 'How many'));
    for (const n of [1, 5, 10, 30]) amount.append(this.button(String(n), () => {
      this.count = n;
      this.draw(true);
    }, this.count === n ? 'on' : ''));
    const fed = el('button', `adm-check${this.fed ? ' on' : ''}`);
    fed.type = 'button';
    fed.dataset.k = 'fed';
    fed.setAttribute('aria-pressed', String(this.fed));
    fed.append(icon(this.fed ? 'check' : 'x'), el('span', '', 'A gun comes with magazines and rounds'));
    fed.onclick = () => {
      this.fed = !this.fed;
      this.draw(true);
    };
    // Where it goes: a switch of two, into the inventory unless this admin chose the ground, and kept as they left
    // it. Every tile, and the line over them, says which it will do.
    const ground = this.giveTo === 'ground', whose = this.mine ? 'your' : 'their';
    const where = el('div', 'adm-seg adm-where');
    where.setAttribute('role', 'radiogroup');
    where.setAttribute('aria-label', 'Where a thing given goes');
    const way = (id: 'inventory' | 'ground', label: string, ic: string) => {
      const b = this.button(label, () => {
        this.giveTo = id;
        try {
          localStorage.setItem(GIVE_KEPT, id);
        } catch {
          /* a browser that keeps nothing: it lasts as long as the page does */
        }
        this.draw(true);
      }, this.giveTo === id ? 'on' : '', ic);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(this.giveTo === id));
      b.dataset.k = `give-to:${id}`;
      return b;
    };
    where.append(way('inventory', 'Into inventory', 'pack'), way('ground', `At ${whose} feet`, 'down'));
    tools.append(find, amount, where, fed);
    const goes = el('div', 'dim', ground ? `A thing clicked is put on the ground at ${whose} feet, as /give with the word ground does.` : `A thing clicked goes into ${whose} inventory: onto the body where there is a free place for it, then into pockets, vest and pack. What finds no room lies at ${whose} feet${this.mine && this.self.bottomless ? ' (none will: your bottomless inventory is on)' : ''}.`);
    const kinds = el('div', 'adm-kinds');
    const count = (k: string) => counts[k] ?? 0;
    kinds.append(this.button(`All  ${all.length}`, () => {
      this.kind = '';
      this.draw(true);
    }, this.kind ? '' : 'on'), ...KINDS.filter((k) => count(k)).map((k) => this.button(`${k}  ${count(k)}`, () => {
      this.kind = k;
      this.draw(true);
    }, this.kind === k ? 'on' : '')));
    const grid = el('div', 'adm-grid');
    for (const d of all) {
      const kind = KIND[d.category] ?? 'Other';
      if (this.kind && kind !== this.kind) continue;
      const t = el('button', 'adm-item');
      t.type = 'button';
      t.dataset.k = `give:${d.id}`;
      t.dataset.find = `${d.name} ${d.id} ${kind}`.toLowerCase();
      t.title = `${d.name}  (${d.id})${d.stack ? `  ·  piles of ${d.stack}` : ''}  ·  ${ground ? `at ${whose} feet` : `into ${whose} inventory`}`;
      const pic = this.pictures[d.id];
      if (pic) {
        const img = el('img');
        img.loading = 'lazy';
        img.draggable = false;
        img.src = pic;
        img.alt = '';
        t.append(img);
      } else t.append(icon('box', 'huge'));
      t.append(el('span', '', d.name));
      t.onclick = () => {
        // (the word that puts it at their feet; with no word, the server puts it into their inventory)
        const n = Math.max(1, this.count), to = `${this.ref}${ground ? ' ground' : ''}`;
        this.send(`/give ${d.id} ${n}${to}`);
        // (a gun, and what it is fed with: two of its magazines and a pile of its rounds)
        if (this.fed && d.weapon) {
          if (d.weapon.mag) this.send(`/give ${d.weapon.mag} ${2 * n}${to}`);
          if (d.weapon.ammo) this.send(`/give ${d.weapon.ammo} ${ITEMS[d.weapon.ammo]?.stack ?? 30}${to}`);
        }
        t.classList.remove('did');
        void t.offsetWidth;
        t.classList.add('did');
      };
      grid.append(t);
    }
    window.setTimeout(() => this.filterItems(), 0);
    return [this.forWhom(p, ground ? 'Click a thing to put it at the feet of' : 'Click a thing to put it into the inventory of'), tools, goes, kinds, grid];
  }

  private filterItems() {
    const f = this.thing.toLowerCase().trim();
    for (const r of this.body.querySelectorAll<HTMLElement>('.adm-item')) r.style.display = !f || (r.dataset.find ?? '').includes(f) ? '' : 'none';
  }

  private kits(p: Player): HTMLElement[] {
    const kit = (k: (typeof KITS)[number]) => {
      const c = el('div', 'adm-kit');
      const strip = el('div', 'adm-strip');
      for (const id of [...new Set(k.things.map((t) => t.id))].slice(0, 12)) {
        const pic = this.pictures[id];
        if (!pic) continue;
        const img = el('img');
        img.src = pic;
        img.alt = '';
        img.title = ITEMS[id]?.name ?? id;
        img.draggable = false;
        strip.append(img);
      }
      const b = this.button(`${k.adds ? 'Add' : 'Give'} ${k.name} to ${this.mine ? 'me' : p.name}`, () => this.send(`/kit ${k.id}${this.ref}`), 'good wide', 'pack');
      c.append(el('b', '', k.name), el('small', k.adds ? 'adds' : '', k.adds ? 'Added to what is carried' : 'Takes the place of everything carried and worn'), el('p', '', k.does), strip, b);
      return c;
    };
    // (Those that take the place of everything, and apart from them what is only added: one click on "Supplies" after a
    // kit left both in the pockets, and read as a kit that had not taken the last one's place.)
    const sets = el('div', 'adm-kits'), adds = el('div', 'adm-kits');
    sets.append(...KITS.filter((k) => !k.adds).map(kit));
    adds.append(...KITS.filter((k) => k.adds).map(kit));
    const none = this.line(this.grave('clear', `Empty everything ${this.mine ? 'I carry' : `${p.name} carries`}`, () => this.send(`/clear${this.ref}`), 'trash'), el('span', 'dim', 'Pockets, packs, what is worn and what is held: all of it gone. Dog tags are kept.'));
    // (and beside the kits, what keeps one going: every magazine and gun of it full again)
    const again = this.line(this.button(this.mine ? 'Refill my magazines' : `Refill ${p.name}’s magazines`, () => this.send(`/refill${this.ref}`), 'good', 'refill'), el('span', 'dim', 'Every magazine and every gun carried is filled, wherever it is. Nothing else is touched.'));
    return [this.forWhom(p, 'A kit, in one click, for'), el('div', 'adm-h', 'Sets: each takes the place of everything carried and worn'), sets, el('div', 'dim', 'Clicked again, it is the same kit made new. Dog tags are kept. What finds no room is put at the feet.'),
      el('div', 'adm-h', 'Added to what is carried'), adds, el('div', 'adm-h', 'Magazines and guns, filled'), again, el('div', 'adm-h', 'Nothing at all'), none];
  }

  // ---------------------------------------------------------------- what somebody carries

  /** Everything somebody has on them, thing by thing, as the server last had it from their game: worn, slung, in each pocket, and in whatever is in those. A thing hovered over has a bin on it. */
  private carried(p: Player): HTMLElement[] {
    const who = this.target, m = this.pockets?.id === who ? this.pockets : null;
    // (asked for when the tab is opened on somebody, and again whenever it is opened on them after a few seconds)
    if (!m || Date.now() - this.pocketsAsked > 4000) {
      this.pocketsAsked = Date.now();
      this.act.order(`/pockets${this.ref}`);
    }
    const head = this.line(this.button('Look again', () => {
      this.pocketsAsked = Date.now();
      this.act.order(`/pockets${this.ref}`);
    }, '', 'eye'), this.grave('clear', 'Empty everything', () => {
      this.send(`/clear${this.ref}`);
      window.setTimeout(() => this.act.order(`/pockets${this.ref}`), 900);
    }, 'trash'), el('span', 'dim', 'What their game last told the server. Point at a thing and press the bin to take it away for good.'));
    if (!m) return [this.forWhom(p, 'Everything carried by'), head, el('div', 'adm-empty', 'Asking the server…')];
    if (!m.inv) return [this.forWhom(p, 'Everything carried by'), head, el('div', 'adm-empty', 'The server has not been told what they carry yet.')];
    const tile = (it: ItemInstance, where: string) => {
      const d = ITEMS[it.id], t = el('div', 'adm-item adm-held');
      const count = d?.stack && it.qty > 1 ? `×${it.qty}` : it.loaded !== undefined ? `${it.loaded} in it` : it.rounds !== undefined ? `${it.rounds} rounds` : '';
      // (a dog tag: whose it is, and how long before it cashes in, by what their game last said: 2026-10-14, the owner,
      // "as admin when im investigating a players inventory and i hover my mouse over a dogtag ... i should see the
      // timer on it for that tag, and who's tag it is (owner)")
      const tag = it.id === 'dogtag' ? `  ·  ${tagOwner(it)}'s  ·  ${tagOwner(it) === p.name ? 'their own: never cashed in' : it.holder ? `cashes in in ${tagClock(it)}` : `not counting (cashes in after ${TAG_HOLD_MIN} min carried)`}` : '';
      t.title = `${d?.name ?? it.id}${tag}${count ? `  ·  ${count}` : ''}${it.mods?.length ? `  ·  ${it.mods.map((x) => ITEMS[x]?.name ?? x).join(', ')}` : ''}  ·  ${where}`;
      const pic = this.pictures[it.id];
      if (pic) {
        const img = el('img');
        img.draggable = false;
        img.src = pic;
        img.alt = '';
        t.append(img);
      } else t.append(icon('box', 'huge'));
      t.append(el('span', '', d?.name ?? it.id));
      if (count) t.append(el('i', 'adm-qty', count));
      const bin = el('button', 'adm-bin');
      bin.type = 'button';
      bin.dataset.k = `bin:${it.uid}`;
      bin.setAttribute('aria-label', `Take the ${d?.name ?? it.id} away`);
      bin.title = `Take the ${d?.name ?? it.id} away`;
      bin.append(icon('trash'));
      bin.onclick = () => {
        t.classList.add('going');
        this.act.order(`/trash #${who} ${it.uid}`);
      };
      t.append(bin);
      return t;
    };
    /** a thing, and under it whatever is in it */
    const out: HTMLElement[] = [];
    const group = (title: string, items: ItemInstance[], note = '') => {
      if (!items.length) return;
      const g = el('div', 'adm-pocket'), grid = el('div', 'adm-grid held');
      g.append(el('div', 'adm-h', `${title}  ·  ${items.length}${note ? `  ·  ${note}` : ''}`), grid);
      for (const it of items) grid.append(tile(it, title));
      out.push(g);
    };
    const slots = Object.entries(m.inv.slots).filter(([, it]) => it) as [string, ItemInstance][];
    group('Worn, slung and held', slots.map(([, it]) => it), slots.map(([k]) => SLOT_NAME[k] ?? k).filter((v, i, all) => all.indexOf(v) === i).join(', '));
    for (const [, it] of slots) if (it.cargo?.length) group(`In the ${(ITEMS[it.id]?.name ?? it.id).toLowerCase()}`, it.cargo.map((q) => q.item));
    for (const c of m.inv.containers) {
      group(POCKET_NAME[String(c.id)] ?? String(c.id), c.items);
      for (const it of c.items) if (it.cargo?.length) group(`In the ${(ITEMS[it.id]?.name ?? it.id).toLowerCase()}`, it.cargo.map((q) => q.item));
    }
    if (!out.length) out.push(el('div', 'adm-empty', 'Nothing at all.'));
    const list = el('div', 'adm-pockets');
    list.append(...out);
    return [this.forWhom(p, 'Everything carried by'), head, list];
  }

  // ---------------------------------------------------------------- what stands in the world

  /**
   * Cars and the infected: put in the world, and taken out of it (2026-10-13: "add more admin tools that might be
   * useful like spawn entities like cars and zombies and future entities would go here etc, make sure delete car is
   * on there"). A tile for every row of ENTITIES in src/net/orders.ts: a kind of thing added there is here by itself.
   */
  private entities(): HTMLElement[] {
    const st = this.lists.stats, look = this.looked, there = this.spawnAt === 'look' && !!look;
    const num = (v: number) => (Math.round(v * 10) / 10).toString();
    // (at what the view is on: with its height where that is level, and without it a pace short of a wall or a slope)
    const at = there && look ? (look.flat ? ` ${num(look.x)} ${num(look.y)} ${num(look.z)}` : ` ${num(look.x)} ${num(look.z)}`) : '';

    const where = el('div', 'adm-choice');
    const choose =(id: 'front' | 'look', label: string, ic: string) => this.button(label, () => {
      this.spawnAt = id;
      if (id === 'look') this.looked = this.act.look();
      this.draw(true);
    }, this.spawnAt === id ? 'on' : '', ic);
    where.append(choose('front', 'A few steps in front of me', 'user'), choose('look', 'Where I am looking', 'target'));
    const seen = el('div', 'adm-look');
    seen.append(icon('eye'), el('span', '', look ? `You are looking at ${look.what}, ${Math.round(look.dist)} m away, at ${Math.round(look.x)}, ${Math.round(look.z)}.` : 'Nothing within 300 metres is in the middle of your view.'));
    const again = this.button('Look again', () => {
      this.looked = this.act.look();
      this.draw(true);
    }, 'small', 'eye');
    again.title = 'Ask again what is in the middle of your view';
    seen.append(again);
    const placing = this.card('Where a new thing is put', 'pin', where, seen,
      el('div', 'dim', this.spawnAt === 'look' && !look ? 'Nothing is in the middle of your view: a new thing is put in front of you instead.' : 'What you are looking at is whatever is in the middle of your view, behind this window: shut it, look, and open it again to change that.'));

    const tiles = el('div', 'adm-ents');
    for (const e of ENTITIES) {
      const n = Math.min(this.spawnN[e.id] ?? 1, e.most), t = el('div', 'adm-ent');
      const text = el('div', 'adm-ent-text');
      text.append(el('b', '', e.name), el('small', '', e.does));
      const many = el('div', 'adm-seg');
      many.append(el('span', 'adm-label', 'How many'));
      for (const c of [...new Set([...COUNTS.filter((v) => v < e.most), e.most])]) {
        const b = this.button(String(c), () => {
          this.spawnN[e.id] = c;
          this.draw(true);
        }, n === c ? 'on' : '');
        b.dataset.k = `n:${e.id}:${c}`;
        many.append(b);
      }
      const go = this.button(`Spawn ${n > 1 ? `${n} ` : ''}${there ? 'where I am looking' : 'in front of me'}`, () => this.send(`/spawn ${e.id} ${n}${at}`), 'good wide', ENTITY_ICON[e.kind]);
      go.dataset.k = `spawn:${e.id}`;
      t.append(icon(ENTITY_ICON[e.kind], 'huge'), text, many, go);
      tiles.append(t);
    }

    const car = look?.car;
    const away = this.card('Take out of the world', 'trash',
      this.line('Cars',
        car !== undefined ? this.grave(`delcar${car}`, `Delete the car I am looking at  (number ${car})`, () => {
          this.send(`/delcar ${car}`);
          // (and what is behind it is looked at, once it has gone)
          window.setTimeout(() => {
            this.looked = this.act.look();
            if (this.isOpen) this.draw();
          }, 900);
        }, 'target') : this.off('The car I am looking at', 'You are not looking at a car. Shut this window, look at one, and open it again', 'target'),
        this.grave('delcar', 'Delete the car nearest me', () => this.send('/delcar'), 'car'),
        this.grave('wrecks', `Clear every burned-out car${st?.wrecks ? `  (${st.wrecks})` : ''}`, () => this.send('/wrecks'), 'trash'),
      ),
      this.line('Infected', el('span', '', 'Put down those within'), ...CULL.map((m) => this.grave(`delz${m}`, `${m} m`, () => this.send(`/delz ${m}`), 'infected')), el('span', '', 'of me')),
      el('div', 'dim', 'Nobody can be sitting in a car that is deleted. The infected lie where they fall, as any do, and those that lived there come back in their time. While you play, the Delete key takes away whatever you are looking at: a thing on the ground, a body, a stash, a car, one of the infected.'),
    );

    const counts = el('div', 'adm-tiles');
    const tile = (v: string | number, label: string, ic: string) => {
      const t = el('div', 'adm-tile');
      t.append(icon(ic), el('b', '', String(v)), el('span', '', label));
      counts.append(t);
    };
    if (st?.cars !== undefined) {
      tile(st.cars - (st.wrecks ?? 0), 'cars standing', 'car');
      tile(st.wrecks ?? 0, 'burned out', 'trash');
    }
    if (st?.infected !== undefined) tile(st.infected, 'infected on their feet', 'infected');
    if (st) tile(st.loot, 'things lying', 'box');
    const grid = el('div', 'adm-cards');
    grid.append(away);
    if (counts.childElementCount) grid.append(this.card('What stands in the world now', 'server', counts));
    return [placing, el('div', 'adm-h', 'Spawn: one press puts it in the world, for everybody'), tiles, grid];
  }

  // ---------------------------------------------------------------- the server's own pages

  private server(): HTMLElement[] {
    const st = this.lists.stats;
    const tell = () => {
      if (!this.toAll.trim()) return;
      this.send(`/say ${this.toAll.trim()}`);
      this.toAll = '';
      this.draw(true);
    };
    const grid = el('div', 'adm-cards');
    if (this.admin) {
      grid.append(this.card('A word to everybody', 'megaphone',
        this.input(this.toAll, 'Shown across everybody’s screen, and in the chat. Enter sends it', (v) => (this.toAll = v), 'wide', tell),
        this.line(this.button('Say it to everybody', tell, 'good', 'megaphone')),
        el('div', 'dim', 'A word to one player alone: pick them on the left.'),
      ));
      const warn = (secs: number) => this.button(`${secs < 120 ? `${secs} s` : `${secs / 60} min`}`, () => this.send(`/restart ${secs}${this.restartWhy.trim() ? ` ${this.restartWhy.trim()}` : ''}`), 'bad', 'clock');
      grid.append(this.card('Warn of a restart', 'warn',
        this.input(this.restartWhy, 'Why (it is the second line of the banner)', (v) => (this.restartWhy = v), 'wide'),
        this.line('Restarting in', warn(30), warn(60), warn(300)),
        el('div', 'dim', 'A banner across everybody’s screen, counting down. It only says so: nothing is restarted by it. (An update that restarts the server says so by itself.)'),
      ));
    }
    const tiles = el('div', 'adm-tiles');
    const tile = (n: string | number, label: string, ic: string) => {
      const t = el('div', 'adm-tile');
      t.append(icon(ic), el('b', '', String(n)), el('span', '', label));
      tiles.append(t);
    };
    tile(this.lists.players.length, 'online', 'user');
    if (st) {
      if (st.today) tile(st.today, 'played today', 'eye');
      tile(st.asleep, 'bodies left', 'moon');
      tile(st.up < 120 ? `${st.up} m` : `${Math.round(st.up / 60)} h`, 'running', 'clock');
      tile(st.loot, 'things lying', 'box');
      tile(st.stashes, 'stashes', 'pack');
      tile(st.kept, 'characters kept', 'user');
    }
    grid.append(this.card('What the server is doing', 'server', tiles,
      this.line('Cheat checks', el('b', '', this.lists.checks || '?'), this.button('Who has been flagged', () => this.send('/flagged'), '', 'flag'), this.button('Who left lately', () => this.send('/recent'), '', 'clock')),
      el('div', 'dim', 'What these find is listed along the bottom.'),
    ));
    const keys = el('div', 'adm-keys');
    const key = (k: string, does: string) => {
      const r = el('div');
      r.append(el('kbd', '', k), el('span', '', does));
      keys.append(r);
    };
    key(shown('Backquote'), 'This panel');
    key('/', 'An order, typed: they are listed as you type');
    if (this.admin) {
      key('N', 'Noclip, on and off');
      key('K', 'The free camera, on and off');
      key('H', 'In the free camera: bring your body to the view');
      key('Del', 'Take away the thing you are looking at: a thing on the ground, a body, a buried stash, a car, one of the infected');
      key('M', 'The map: everybody is a dot on it, moving as they move. Click a dot for what can be done, right-click a place to go there');
    }
    key('Tab', 'In this window: from one button to the next (Shift and Tab, back). Enter presses it');
    grid.append(this.card('Keys', 'keys', keys));
    return [grid];
  }

  private bans(): HTMLElement[] {
    // (found by a name, or by anything else its line says: who did it, why, when. 2026-10-13: "need searchbar for
    // users and banned users in admin panel".)
    const find = el('div', 'adm-find for-bans');
    const list = el('div', 'adm-table bans');
    const sift = () => {
      const f = this.findBan.toLowerCase().trim();
      let shown = 0;
      for (const r of list.querySelectorAll<HTMLElement>('.adm-tr[data-find]')) {
        const on = !f || (r.dataset.find ?? '').includes(f);
        r.style.display = on ? '' : 'none';
        if (on) shown++;
      }
      list.querySelector<HTMLElement>('.adm-none.sift')?.remove();
      if (f && !shown && this.lists.bans.length) list.append(el('div', 'adm-none sift', `Nobody banned or kept off is "${this.findBan.trim()}".`));
    };
    find.append(icon('search'), this.input(this.findBan, 'Find somebody banned or kept off', (v) => {
      this.findBan = v;
      sift();
    }, '', undefined, 'find-ban'));
    const head = el('div', 'adm-tr head');
    for (const h of ['', 'Name', 'By', 'On', 'Why', '']) head.append(el('span', '', h));
    list.append(head);
    // (newest first: the server sends them in the order they were made, the bans and then whoever is kept off now;
    // the owner, 2026-10-15: "admin panel bans should be sorted by most recent first")
    for (const b of [...this.lists.bans].reverse()) {
      const r = el('div', 'adm-tr');
      // (Somebody the checks put off twice in an hour, or an admin timed out, is kept off for a while and is in this
      // list with the banned: lifted the same way. Marked, so that it is seen which they are: "people in this
      // state should show in the bans list so i can remove their suspension or timeout".)
      const off = b.by === 'the checks' || b.by === 'a timeout';
      if (off) r.classList.add('off');
      r.dataset.find = `${b.name} ${b.by} ${b.at} ${b.why} ${b.id ?? ''} ${off ? 'kept off suspended timeout' : 'banned'}`.toLowerCase();
      for (const c of [`${b.n}.`, b.name, b.by, b.at, b.why]) {
        const cell = el('span', '', c);
        cell.title = c;
        r.append(cell);
      }
      // (lifted by its own id, which is the same whatever else has been banned or lifted since this list was sent:
      // by its place in the list, a press on a list two seconds old could lift somebody else's. A server from before
      // the ids says none, and is sent the place as before.)
      const ref = b.id ?? String(b.n);
      const un = this.grave(`unban:${ref}`, off ? 'Let back in' : 'Unban', () => this.send(`/unban ${ref}`), 'check');
      un.classList.add('small');
      un.title = `Lift this one: ${b.name}${b.id ? ` (${b.id})` : ''}. Asks once more before it is done`;
      r.append(un);
      list.append(r);
    }
    if (!this.lists.bans.length) list.append(el('div', 'adm-none', 'Nobody is banned, and nobody is kept off by the checks or a timeout.'));
    sift();
    // Whoever was turned away at the door lately, with a Pardon button: everything on them lifted and they are
    // straight back in. (The owner, 2026-10-16: "admins need a way to handle when someone tries to join but is
    // wrongly banned, or kicked or rejects. we need to have a 'pardon' button for these people".)
    const turned = el('div', 'adm-table bans turned');
    const th = el('div', 'adm-tr head');
    for (const h of ['', 'Name', 'When', 'Device', 'Why', '']) th.append(el('span', '', h));
    turned.append(th);
    for (const t of this.lists.turned ?? []) {
      const r = el('div', 'adm-tr off');
      for (const c of [`p:${t.id}`, t.name, `${t.mins} min ago`, t.dev ? `dev:${t.dev}` : '', t.why]) {
        const cell = el('span', '', c);
        cell.title = c;
        r.append(cell);
      }
      const p = this.grave(`pardon:${t.id}`, 'Pardon', () => this.send(`/pardon p:${t.id}`), 'check');
      p.classList.add('small');
      p.title = `Let ${t.name} straight back in: every ban and strike on their game, address and device lifted. Asks once more before it is done`;
      r.append(p);
      turned.append(r);
    }
    if (!this.lists.turned?.length) turned.append(el('div', 'adm-none', 'Nobody has been turned away at the door lately.'));
    return [
      find,
      list,
      el('div', 'adm-group', `Turned away at the door  ${this.lists.turned?.length ?? 0}`),
      turned,
      el('div', 'dim', 'Turned away: banned, kept off, a full device, or the bot check not passed. Pardon lifts everything on that person at once (their game, their address and their device) and they can press Play again.'),
      el('div', 'dim', 'Kept off: the checks put somebody off twice in an hour (six hours), or an admin timed them out. It is in the server’s memory only: a restart lets everybody kept off back in. A ban is written down and stays.'),
      el('div', 'dim', 'To ban somebody: pick them on the left (somebody who has just left is at the foot of that list).'),
    ];
  }

  private roles(): HTMLElement[] {
    const list = el('div', 'adm-table roles');
    const head = el('div', 'adm-tr head');
    for (const h of ['Name', 'Role', 'Given by', 'On', 'Dog tag', '']) head.append(el('span', '', h));
    list.append(head);
    for (const r of this.lists.roles) {
      const row = el('div', 'adm-tr');
      for (const c of [r.name, r.role, r.by, r.at]) row.append(el('span', '', c));
      // (whether they leave a dog tag when they die, set here by whoever is above them and no longer theirs to choose:
      // the owner, 2026-10-19, "some admins i cannot trust to self regulate their powers ... Dogtag:on/off is fine")
      const tag = el('span', 'adm-dt');
      if (r.tag) {
        const words = `Dogtag: ${r.tag.on ? 'on' : 'off'}`, on = r.tag.on;
        const b = r.tagMine && r.id ? this.button(words, () => this.send(`/dogtag ${r.id} ${on ? 'off' : 'on'}`), `small${on ? ' good' : ''}`) : el('span', on ? 'ro' : 'ro off', words);
        b.title = `${on ? 'They leave a dog tag when they die, as anybody does' : 'They leave no dog tag when they die'}. ${r.tag.by ? `Set by ${r.tag.by}: not theirs to change.` : 'Their own choice until somebody above them sets it.'}`;
        tag.append(b);
        if (r.tag.by) tag.append(icon('lock'));
      }
      row.append(tag);
      // (taken away here, online or not, from whoever this admin is above: the owner, 2026-10-19, "as an admin i should be
      // able to click offline admins via the role panel to un admin someone, assuming i am above them")
      const act = el('span', 'adm-acts');
      if (r.low && r.id) {
        if (r.role === 'admin') act.append(this.grave(`mod:${r.id}`, 'Make a mod', () => this.send(`/mod ${r.id}`), 'star'));
        act.append(this.grave(`demote:${r.id}`, 'Take their role', () => this.send(`/demote ${r.id}`), 'x'));
        for (const b of act.children) b.classList.add('small');
      }
      row.append(act);
      list.append(row);
    }
    if (!this.lists.roles.length) list.append(el('div', 'adm-none', 'Nobody has a role.'));
    return [list, el('div', 'dim', 'A role is given from a player’s own page (pick them on the left: they have to be online), and taken away there or here, from anybody you are above, online or not. Dogtag: whether they leave a dog tag when they die. Set by you, it is no longer theirs to change (the lock), and only you or whoever is above you can change it again.')];
  }
}
