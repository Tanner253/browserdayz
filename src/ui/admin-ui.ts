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
// Every name is set as text and never as markup; the only markup made here is the drawings of the icons, which are
// written out below.

import type { AdminLists } from '../net/protocol';
import type { Role } from '../net/orders';
import { ITEMS } from '../sim/items';
import { KITS } from '../sim/kits';
import type { S2C } from '../net/protocol';
import type { ItemInstance } from '../sim/items';
import './admin.css';

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
  close(): void;
}

/** what the panel is told of whoever has it open */
export interface AdminSelf {
  role: Role | null;
  id: number;
  god: boolean;
  hidden: boolean;
  clip: boolean;
  voidInv: boolean;
  voidTag: boolean;
  /** it is day in this game alone, whatever the hour */
  night: boolean;
  /** the colour chosen for the word ADMIN in the chat (null: the rainbow) */
  tint: string | null;
  freecam: boolean;
  x: number;
  z: number;
}

type Player = AdminLists['players'][number];
type View = 'who' | 'server' | 'bans' | 'roles';
type Sub = 'actions' | 'items' | 'kits' | 'pockets';
/** what somebody carries, as the server last had it from their game (`/pockets`) */
type Pockets = Extract<S2C, { t: 'inv' }>;
const SLOT_NAME: Record<string, string> = { primary: 'On the back', secondary: 'On the back', holster: 'Holster', head: 'Head', face: 'Face', vest: 'Vest', back: 'Pack', hands: 'Hands', feet: 'Feet', neck: 'Round the neck', melee: 'Belt' };
const POCKET_NAME: Record<string, string> = { tags: 'Tag pouch', jacket: 'Jacket', pants: 'Trousers' };
const KIND: Record<string, string> = { weapon: 'Guns', magazine: 'Magazines', ammo: 'Ammunition', attachment: 'Attachments', melee: 'Melee', clothing: 'Clothing', medical: 'Medical', food: 'Food', drink: 'Drink', tool: 'Tools', stash: 'Containers', misc: 'Other' };
const KINDS = [...new Set(Object.values(KIND))];

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
  car: '<path d="M4 16v-4l2-5h12l2 5v4z"/><circle cx="8" cy="16.5" r="1.6"/><circle cx="16" cy="16.5" r="1.6"/>',
  moon: '<path d="M19 14.5A8 8 0 0 1 9.5 5a8 8 0 1 0 9.5 9.5z"/>',
  flag: '<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>',
  keys: '<path d="M4 7h16v10H4z"/><path d="M7 10.5h1M10.5 10.5h1M14 10.5h1M7.5 14h9"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
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
  root = el('div', 'adm');
  isOpen = false;
  private view: View = 'who';
  private sub: Sub = 'actions';
  private self: AdminSelf = { role: null, id: 0, god: false, hidden: false, clip: false, voidInv: false, voidTag: false, night: false, tint: null, freecam: false, x: 0, z: 0 };
  private lists: AdminLists = { players: [], gone: [], bans: [], roles: [], checks: '' };
  /** who everything on the right is about: a player's number (the admin's own, when it is themselves) */
  private target = 0;
  /** what is typed in the boxes: kept while the lists are drawn again */
  private find = '';
  private why = '';
  private words = '';
  private toAll = '';
  private thing = '';
  private kind = '';
  private count = 1;
  /** a gun is handed over with a magazine in reach and something to put in it */
  private fed = true;
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
  private held = false;

  constructor(private places: { name: string; x: number; z: number; kind?: string }[], private act: AdminActions, private pictures: Record<string, string> = {}) {
    const main = el('div', 'adm-main');
    main.append(this.head, this.body);
    const mid = el('div', 'adm-mid');
    mid.append(this.side, main);
    this.root.append(this.bar, mid, this.log);
    // (a key pressed in the panel is the panel's: nothing of it reaches the game, but the two that shut it)
    this.root.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') return;
      e.stopPropagation();
      if (e.code === 'Backquote') {
        e.preventDefault();
        this.act.close();
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
    if (!this.target || (self.role !== 'admin' && this.target === self.id)) this.target = self.role === 'admin' ? self.id : 0;
    if (self.role !== 'admin') this.sub = 'actions';
    this.draw(true);
    this.act.ask();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.isOpen && this.act.ask(), 2000);
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
    if (!this.isOpen || same) return;
    if (!this.typing(this.side)) this.drawSide();
    this.drawHead();
  }

  /** a line the server said back: shown along the bottom */
  say(text: string) {
    this.said.push({ at: Date.now(), text });
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

  private button(label: string, on: () => void, cls = '', ic = '') {
    const b = el('button', `adm-b ${cls}`.trim());
    if (ic) b.append(icon(ic));
    if (label) b.append(el('span', '', label));
    b.onclick = on;
    return b;
  }

  /** a button that asks once more before it does it */
  private grave(key: string, label: string, on: () => void, ic = '') {
    const armed = this.sure?.key === key && this.sure.until > Date.now();
    return this.button(armed ? 'Click again to confirm' : label, () => {
      if (armed) {
        this.sure = null;
        on();
      } else this.sure = { key, until: Date.now() + 4000 };
      this.draw(true);
    }, armed ? 'bad armed' : 'bad', armed ? 'warn' : ic);
  }

  /** a switch: on or off, with what it is, what it does, and the key for it if it has one */
  private flip(label: string, does: string, on: boolean | undefined, toggle: () => void, ic: string, key = '') {
    const b = el('button', `adm-sw${on ? ' on' : ''}`);
    const text = el('span', 'adm-sw-text');
    text.append(el('b', '', label), el('small', '', does));
    b.append(icon(ic), text);
    if (key) b.append(el('kbd', '', key));
    b.append(el('i', 'adm-knob'));
    b.onclick = toggle;
    return b;
  }

  private input(value: string, hint: string, set: (v: string) => void, cls = '', enter?: () => void) {
    const i = el('input', `adm-i ${cls}`.trim());
    i.value = value;
    i.placeholder = hint;
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
      const keep = this.body.scrollTop, inner = this.body.querySelector('.adm-grid, .adm-table')?.scrollTop ?? 0;
      this.body.replaceChildren(...this.bodyOf());
      this.body.scrollTop = keep;
      const g = this.body.querySelector('.adm-grid, .adm-table');
      if (g) g.scrollTop = inner;
      this.drawn = key;
    }
    this.drawLog();
  }

  /** everything the body shows, in a word: when this is the same, the body is */
  private bodyKey() {
    const p = this.pick(), s = this.self;
    const base = `${this.view}|${this.sub}|${this.target}|${s.role}|${this.sure?.key ?? ''}`;
    if (this.view === 'server') return `${base}|${JSON.stringify(this.lists.stats ?? {})}|${this.lists.checks}|${this.lists.players.length}`;
    if (this.view === 'bans') return `${base}|${JSON.stringify(this.lists.bans)}`;
    if (this.view === 'roles') return `${base}|${JSON.stringify(this.lists.roles)}`;
    if (this.sub === 'items') return `${base}|${this.kind}|${this.count}|${this.fed}|${Object.keys(this.pictures).length}`;
    if (this.sub === 'kits') return base;
    if (this.sub === 'pockets') return `${base}|${this.pockets?.id}|${JSON.stringify(this.pockets?.inv ?? null).length}|${Object.keys(this.pictures).length}`;
    return `${base}|${p ? [p.role, p.muted, p.god, p.hidden, p.clip, p.voidInv, p.voidTag, p.alive].join() : ''}|${this.mine ? [s.god, s.hidden, s.clip, s.voidInv, s.voidTag, s.night, s.freecam, s.tint].join() : ''}`;
  }

  private bodyOf(): HTMLElement[] {
    if (this.view === 'server') return this.server();
    if (this.view === 'bans') return this.bans();
    if (this.view === 'roles') return this.roles();
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
    if (st?.asleep) chips.append(chip('moon', `${st.asleep} left a body`, 'Closed the game without logging out: their body is still there'));
    if (st) chips.append(chip('clock', `up ${st.up < 120 ? `${st.up} min` : `${Math.round(st.up / 60)} h`}`, 'How long the server has been running'));
    chips.append(chip('flag', `checks: ${this.lists.checks || '?'}`, 'What the server does about cheating: watch (write it down) or enforce (refuse it)'));
    const x = this.button('Close', () => this.act.close(), 'ghostly', 'x');
    x.append(el('kbd', '', '`'));
    this.bar.replaceChildren(title, chips, x);
  }

  private drawSide() {
    const f = this.find.toLowerCase().trim();
    const top = el('div', 'adm-find');
    top.append(icon('search'), this.input(this.find, 'Find a player', (v) => {
      this.find = v;
      this.filterSide();
    }));
    const list = el('div', 'adm-who');
    const row = (p: Player, you = false) => {
      const r = el('button', `adm-p${this.view === 'who' && p.id === this.target ? ' on' : ''}${p.flags > 20 ? ' hot' : ''}`);
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
    const go = (v: View, label: string, ic: string, n = '') => {
      const b = this.button(label, () => {
        this.view = v;
        this.draw(true);
      }, `nav${this.view === v ? ' on' : ''}`, ic);
      if (n) b.append(el('em', '', n));
      return b;
    };
    nav.append(go('server', 'Server', 'megaphone'));
    if (this.admin) nav.append(go('bans', 'Bans', 'ban', this.lists.bans.length ? String(this.lists.bans.length) : ''), go('roles', 'Roles', 'star'));
    const keep = this.side.querySelector('.adm-who')?.scrollTop ?? 0;
    this.side.replaceChildren(top, list, nav);
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
    if (this.view !== 'who') {
      const t = el('div', 'adm-head-t');
      const [ic, title, sub] = this.view === 'server' ? ['megaphone', 'The server', 'A word to everybody, what the server is doing, and the keys.'] : this.view === 'bans' ? ['ban', 'Bans', 'A ban is of the game that was played and of the connection it was played from. It outlasts the server’s restarts.'] : ['star', 'Roles', 'A mod can warn, mute, kick and time out. An admin can do everything here.'];
      const text = el('div', 'adm-head-text');
      text.append(el('b', '', title), el('small', '', sub));
      t.append(icon(ic, 'huge'), text);
      this.head.replaceChildren(t);
      return;
    }
    const p = this.pick();
    if (!p) return void this.head.replaceChildren(el('div', 'adm-head-t'));
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
    this.head.replaceChildren(t, quick);
  }

  private drawLog() {
    // (The last few things said, the newest lowest and the older the fainter. There is no list to scroll: 2026-10-13,
    // "when the notifications feed at the bottom fills up a scroll wheel appears im not a fan of that".)
    const big = this.view === 'server';
    const lines = this.said.slice(big ? -8 : -3);
    this.log.classList.toggle('big', big);
    const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    this.log.replaceChildren(icon('megaphone'), ...(lines.length ? lines.map((l, k) => {
      const row = el('div', k === lines.length - 1 ? 'last' : '');
      row.append(el('time', '', clock(l.at)), el('span', '', l.text));
      row.title = l.text;
      row.style.opacity = String(Math.max(0.4, 1 - (lines.length - 1 - k) * 0.1));
      return row;
    }) : [el('div', 'dim', 'What an order did is said here, and in the chat.')]));
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
    }
    const talk = () => {
      if (!this.words.trim()) return;
      this.send(`/msg ${who} ${this.words.trim()}`);
      this.words = '';
      this.draw(true);
    };
    grid.append(this.card('Say something to them', 'mail',
      this.input(this.words, `A message for ${p.name} alone. Enter sends it`, (v) => (this.words = v), 'wide', talk),
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
      this.line('Kick', this.button('Kick off the server', () => this.send(`/kick ${who}${why()}`), 'bad', 'kick')),
      this.line('Keep off', ...[5, 10, 30, 60].map((m) => this.button(`${m} min`, () => this.send(`/timeout ${who} ${m}${why()}`), 'bad', 'clock'))),
      ...(admin ? [this.line('For good', this.grave(`ban${p.id}`, 'Ban: their game and their address', () => this.send(`/ban ${who}${why()}`), 'ban'))] : []),
    ));
    if (admin) {
      grid.append(this.card('Role', 'star',
        this.line(
          this.button('Make a mod', () => this.send(`/mod ${who}`), '', 'star'),
          this.grave(`adm${p.id}`, 'Make an admin', () => this.send(`/admin ${who}`), 'shield'),
          this.button('Take their role', () => this.send(`/demote ${who}`), 'bad', 'x'),
        ),
        el('div', 'dim', p.role ? `${p.name} is ${p.role === 'admin' ? 'an admin' : 'a mod'}.` : `${p.name} has no role.`),
      ));
      // (an admin's powers are another admin's to put on and off)
      if (p.role === 'admin') {
        const sw = (label: string, does: string, order: string, on: boolean | undefined, ic: string) => this.flip(label, does, on, () => this.send(`/${order} ${who} ${on ? 'off' : 'on'}`), ic);
        grid.append(this.card(`${p.name}'s powers`, 'bolt',
          sw('God mode', 'Nothing hurts them', 'god', p.god, 'shield'),
          sw('Vanish', 'Nobody but an admin sees them', 'vanish', p.hidden, 'ghost'),
          sw('Noclip', 'They fly, through anything', 'noclip', p.clip, 'fly'),
          sw('Void inventory', 'Nothing they carried is left on their body', 'voidinv', p.voidInv, 'trash'),
          sw('Void dog tag', 'No tag of theirs is left to cash in', 'voidtag', p.voidTag, 'trash'),
        ));
      }
    }
    return [grid];
  }

  // ---------------------------------------------------------------- oneself

  private me(): HTMLElement[] {
    const s = this.self;
    const grid = el('div', 'adm-cards');
    grid.append(this.card('Powers', 'bolt',
      this.flip('God mode', 'Nothing hurts you', s.god, () => this.send(`/god ${s.god ? 'off' : 'on'}`), 'shield'),
      this.flip('Vanish', 'Nobody but an admin sees you; the infected ignore you', s.hidden, () => this.send(`/vanish ${s.hidden ? 'off' : 'on'}`), 'ghost'),
      this.flip('Noclip', 'Fly, through anything', s.clip, () => this.send(`/noclip ${s.clip ? 'off' : 'on'}`), 'fly', 'N'),
      this.flip('Free camera', 'The view leaves your body (H brings the body to it)', s.freecam, () => {
        this.act.freecam(!s.freecam);
        this.act.close();
      }, 'camera', 'K'),
      this.flip('Night vision', 'It is day, for you alone', s.night, () => this.act.night(!s.night), 'sun'),
      el('div', 'dim', 'Flying, and in the free camera: W A S D, Space up, Ctrl down, Shift fast, Alt slow, and everybody’s name is shown where they are, however far and through anything. No tag is cashed in while god mode, vanish or noclip is on.'),
    ));
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
    colour.onchange = () => this.act.tint(colour.value);
    // (no tag at all: read as anybody is where everybody talks; the staff channel still says who is who)
    tag.append(sample, this.button('No tag', () => this.act.tint(off ? null : 'off'), off ? 'on' : '', 'x'), this.button('RGB', () => this.act.tint(null), s.tint ? '' : 'on'),
      ...['#ff5a4d', '#ffb02e', '#ffe45c', '#5fe36b', '#35d6ff', '#6f8cff', '#c97bff', '#ffffff'].map((c) => {
        const b = this.button('', () => this.act.tint(c), `swatch${s.tint === c ? ' on' : ''}`);
        b.style.background = c;
        b.title = c;
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
    const all = Object.values(ITEMS).filter((d) => d.id !== 'dogtag');
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
    fed.append(icon(this.fed ? 'check' : 'x'), el('span', '', 'A gun comes with magazines and rounds'));
    fed.onclick = () => {
      this.fed = !this.fed;
      this.draw(true);
    };
    tools.append(find, amount, fed);
    const kinds = el('div', 'adm-kinds');
    const count = (k: string) => all.filter((d) => (KIND[d.category] ?? 'Other') === k).length;
    kinds.append(this.button(`All  ${all.length}`, () => {
      this.kind = '';
      this.draw(true);
    }, this.kind ? '' : 'on'), ...KINDS.filter((k) => count(k)).map((k) => this.button(`${k}  ${count(k)}`, () => {
      this.kind = k;
      this.draw(true);
    }, this.kind === k ? 'on' : '')));
    const grid = el('div', 'adm-grid');
    for (const d of all.sort((a, b) => KINDS.indexOf(KIND[a.category] ?? 'Other') - KINDS.indexOf(KIND[b.category] ?? 'Other') || a.name.localeCompare(b.name))) {
      const kind = KIND[d.category] ?? 'Other';
      if (this.kind && kind !== this.kind) continue;
      const t = el('button', 'adm-item');
      t.dataset.find = `${d.name} ${d.id} ${kind}`.toLowerCase();
      t.title = `${d.name}  (${d.id})${d.stack ? `  ·  piles of ${d.stack}` : ''}`;
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
        const n = Math.max(1, this.count);
        this.send(`/give ${d.id} ${n}${this.ref}`);
        // (a gun, and what it is fed with: two of its magazines and a pile of its rounds)
        if (this.fed && d.weapon) {
          if (d.weapon.mag) this.send(`/give ${d.weapon.mag} ${2 * n}${this.ref}`);
          if (d.weapon.ammo) this.send(`/give ${d.weapon.ammo} ${ITEMS[d.weapon.ammo]?.stack ?? 30}${this.ref}`);
        }
        t.classList.remove('did');
        void t.offsetWidth;
        t.classList.add('did');
      };
      grid.append(t);
    }
    window.setTimeout(() => this.filterItems(), 0);
    return [this.forWhom(p, 'Click a thing to give it to'), tools, kinds, grid];
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
    return [this.forWhom(p, 'A kit, in one click, for'), el('div', 'adm-h', 'Sets: each takes the place of everything carried and worn'), sets, el('div', 'dim', 'Clicked again, it is the same kit made new. Dog tags are kept. What finds no room is put at the feet.'),
      el('div', 'adm-h', 'Added to what is carried'), adds, el('div', 'adm-h', 'Nothing at all'), none];
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
      t.title = `${d?.name ?? it.id}${count ? `  ·  ${count}` : ''}${it.mods?.length ? `  ·  ${it.mods.map((x) => ITEMS[x]?.name ?? x).join(', ')}` : ''}  ·  ${where}`;
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
    key('`', 'This panel');
    key('/', 'An order, typed: they are listed as you type');
    if (this.admin) {
      key('N', 'Noclip, on and off');
      key('K', 'The free camera, on and off');
      key('H', 'In the free camera: bring your body to the view');
      key('Del', 'Take away the thing you are looking at: a thing on the ground, a body, a buried stash, a car, one of the infected');
      key('M', 'The map: right-click a place to go there');
      key('N, K', 'While flying or in the free camera: everybody’s name where they are, through anything, however far');
    }
    grid.append(this.card('Keys', 'keys', keys));
    return [grid];
  }

  private bans(): HTMLElement[] {
    const list = el('div', 'adm-table bans');
    const head = el('div', 'adm-tr head');
    for (const h of ['', 'Name', 'By', 'On', 'Why', '']) head.append(el('span', '', h));
    list.append(head);
    for (const b of this.lists.bans) {
      const r = el('div', 'adm-tr');
      for (const c of [`${b.n}.`, b.name, b.by, b.at, b.why]) r.append(el('span', '', c));
      const un = this.grave(`unban${b.n}${b.name}`, 'Unban', () => this.send(`/unban ${b.n}`), 'check');
      un.classList.add('small');
      r.append(un);
      list.append(r);
    }
    if (!this.lists.bans.length) list.append(el('div', 'adm-none', 'Nobody is banned.'));
    return [list, el('div', 'dim', 'To ban somebody: pick them on the left (somebody who has just left is at the foot of that list).')];
  }

  private roles(): HTMLElement[] {
    const list = el('div', 'adm-table roles');
    const head = el('div', 'adm-tr head');
    for (const h of ['Name', 'Role', 'Given by', 'On']) head.append(el('span', '', h));
    list.append(head);
    for (const r of this.lists.roles) {
      const row = el('div', 'adm-tr');
      for (const c of [r.name, r.role, r.by, r.at]) row.append(el('span', '', c));
      list.append(row);
    }
    if (!this.lists.roles.length) list.append(el('div', 'adm-none', 'Nobody has a role.'));
    return [list, el('div', 'dim', 'A role is given and taken away from a player’s own page: pick them on the left. They have to be online.')];
  }
}
