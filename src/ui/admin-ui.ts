// The panel of somebody with a role (2026-10-11): everything their orders do, as lists and buttons.
//
// It gives no order of its own. Every button writes the order it stands for (see src/net/orders.ts) and has the
// game send it as if it had been typed, so the server holds a button to exactly what it holds a typed order to,
// and what came of it is said back in words: here, under the lists, and in the chat. The lists themselves are
// asked of the server while the panel is open (`ask`), every two seconds.
//
// Words and lists only, for now: no pictures. Every name is set as text and never as markup.

import type { AdminLists } from '../net/protocol';
import type { Role } from '../net/orders';
import { ITEMS } from '../sim/items';
import { KITS } from '../sim/kits';
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
  freecam: boolean;
  x: number;
  z: number;
}

type Tab = 'players' | 'me' | 'items' | 'bans' | 'roles';
const TABS: [Tab, string, boolean][] = [['players', 'Players', false], ['me', 'Me', true], ['items', 'Spawn', true], ['bans', 'Bans', true], ['roles', 'Roles', true]];
const KIND: Record<string, string> = { weapon: 'Guns', melee: 'Melee', magazine: 'Magazines', ammo: 'Ammunition', attachment: 'Attachments', medical: 'Medical', food: 'Food', drink: 'Drink', clothing: 'Clothing', tool: 'Tools', misc: 'Other', stash: 'Other' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

export class AdminUI {
  root = el('div', 'adm');
  isOpen = false;
  private tab: Tab = 'players';
  private self: AdminSelf = { role: null, id: 0, god: false, hidden: false, clip: false, voidInv: false, voidTag: false, freecam: false, x: 0, z: 0 };
  private lists: AdminLists = { players: [], gone: [], bans: [], roles: [], checks: '' };
  /** who is picked in the list of players (their number), and what is typed in the boxes: kept while the lists are drawn again */
  private picked = 0;
  private find = '';
  private why = '';
  private thing = '';
  private kind = '';
  private count = '1';
  private words = '';
  private where = ['', ''];
  /** a button that has to be pressed twice (a ban, a killing): which, and until when the second press counts */
  private sure: { key: string; until: number } | null = null;
  private said: string[] = [];
  private timer = 0;
  private body = el('div', 'adm-body');
  private out = el('div', 'adm-out');
  private tabs = el('div', 'adm-tabs');
  private head = el('span', 'adm-title');

  constructor(private places: { name: string; x: number; z: number }[], private act: AdminActions) {
    const bar = el('div', 'adm-bar');
    const x = el('button', 'adm-x', 'Close  [ ` ]');
    x.onclick = () => this.act.close();
    bar.append(this.head, this.tabs, x);
    this.root.append(bar, this.body, this.out);
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
    // (the lists are not drawn again between a button going down and coming up: the press would be lost)
    this.root.addEventListener('pointerdown', () => (this.held = true));
    window.addEventListener('pointerup', () => (this.held = false));
  }
  private held = false;

  open(self: AdminSelf) {
    this.self = self;
    this.isOpen = true;
    this.root.classList.add('open');
    if (self.role !== 'admin') this.tab = 'players';
    this.draw();
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
    const moved = self.x !== this.self.x || self.z !== this.self.z;
    const same = !moved && (Object.keys(self) as (keyof AdminSelf)[]).every((k) => self[k] === this.self[k]);
    this.self = self;
    if (this.isOpen && !same && !this.typing()) this.draw();
  }

  setLists(l: AdminLists) {
    this.lists = l;
    // (not drawn again under somebody who is typing in it: the box would be taken from under them)
    if (this.isOpen && !this.typing() && !this.held) this.draw();
  }

  /** a line the server said back: shown under the lists */
  say(text: string) {
    this.said.push(text);
    if (this.said.length > 40) this.said.shift();
    if (this.isOpen) this.drawOut();
  }

  private typing() {
    const a = document.activeElement;
    return !!a && a.tagName === 'INPUT' && this.root.contains(a);
  }

  private send(line: string) {
    this.act.order(line.trim());
    // (and what it did is in the lists a moment later)
    window.setTimeout(() => this.isOpen && this.act.ask(), 700);
  }

  // ---------------------------------------------------------------- the pieces

  private button(label: string, on: () => void, cls = '') {
    const b = el('button', `adm-b ${cls}`.trim(), label);
    b.onclick = on;
    return b;
  }

  /** a button that asks once more before it does it */
  private grave(key: string, label: string, on: () => void) {
    const armed = this.sure?.key === key && this.sure.until > Date.now();
    return this.button(armed ? `Sure? ${label}` : label, () => {
      if (armed) {
        this.sure = null;
        on();
      } else this.sure = { key, until: Date.now() + 4000 };
      this.draw();
    }, armed ? 'bad armed' : 'bad');
  }

  private input(value: string, hint: string, set: (v: string) => void, cls = '', enter?: () => void) {
    const i = el('input', `adm-i ${cls}`.trim());
    i.value = value;
    i.placeholder = hint;
    i.spellcheck = false;
    i.autocomplete = 'off';
    i.maxLength = 120;
    i.oninput = () => set(i.value);
    if (enter) i.onkeydown = (e) => e.key === 'Enter' && enter();
    return i;
  }

  private row(...cells: (string | HTMLElement)[]) {
    const r = el('div', 'adm-row');
    for (const c of cells) r.append(typeof c === 'string' ? el('span', '', c) : c);
    return r;
  }

  private draw() {
    const admin = this.self.role === 'admin';
    this.head.textContent = admin ? 'ADMIN' : 'MOD';
    this.tabs.replaceChildren(...TABS.filter(([, , adminOnly]) => admin || !adminOnly).map(([id, label]) => {
      const n = id === 'players' ? ` ${this.lists.players.length}` : id === 'bans' ? ` ${this.lists.bans.length}` : '';
      return this.button(label + n, () => {
        this.tab = id;
        this.draw();
      }, this.tab === id ? 'tab on' : 'tab');
    }));
    const keep = this.body.scrollTop, inner = this.body.querySelector('.adm-list')?.scrollTop ?? 0;
    this.body.replaceChildren(...(this.tab === 'players' ? this.players(admin) : this.tab === 'me' ? this.me() : this.tab === 'items' ? this.items() : this.tab === 'bans' ? this.bans() : this.roles()));
    this.body.scrollTop = keep;
    const list = this.body.querySelector('.adm-list');
    if (list) list.scrollTop = inner;
    this.drawOut();
  }

  private drawOut() {
    this.out.replaceChildren(...this.said.slice(-5).map((t) => el('div', '', t)));
    if (!this.said.length) this.out.append(el('div', 'dim', 'What an order did is said here, and in the chat.'));
  }

  // ---------------------------------------------------------------- players

  private players(admin: boolean): HTMLElement[] {
    const f = this.find.toLowerCase();
    const shown = this.lists.players.filter((p) => !f || p.name.toLowerCase().includes(f) || `#${p.id}`.startsWith(f));
    const pick = this.lists.players.find((p) => p.id === this.picked) ?? null;
    const top = el('div', 'adm-line');
    top.append(
      this.input(this.find, 'Find a player', (v) => {
        this.find = v;
        this.redrawList();
      }, 'wide'),
      el('span', 'dim', `${this.lists.players.length} online · cheat checks: ${this.lists.checks || '?'}`),
    );
    const list = el('div', 'adm-list');
    list.append(this.row('#', 'Name', 'Role', 'At', 'On', 'Flags', ''));
    list.firstElementChild!.classList.add('headrow');
    for (const p of shown) {
      const marks = [p.alive ? '' : 'dead', p.asleep ? 'gone: body left behind' : p.away ? 'not answering (tabbed out)' : '', p.seat ? 'in a car' : '', p.muted ? 'muted' : '', p.god ? 'god' : '', p.hidden ? 'vanished' : '', p.clip ? 'noclip' : ''].filter(Boolean).join(' · ');
      const r = this.row(`#${p.id}`, p.name + (p.id === this.self.id ? '  (you)' : ''), p.role ?? '', `${p.x}, ${p.z}`, `${p.mins} min`, p.flags ? String(p.flags) : '', marks);
      r.classList.add('pickable');
      if (p.id === this.picked) r.classList.add('on');
      if (p.flags > 20) r.classList.add('hot');
      r.onclick = () => {
        this.picked = p.id === this.picked ? 0 : p.id;
        this.draw();
      };
      list.append(r);
    }
    if (!shown.length) list.append(el('div', 'dim pad', this.lists.players.length ? 'Nobody of that name.' : 'The list is on its way.'));

    const acts = el('div', 'adm-acts');
    if (!pick) acts.append(el('div', 'dim', 'Click a player to do something about them.'));
    else {
      const who = `#${pick.id}`, me = pick.id === this.self.id, why = () => (this.why.trim() ? ` ${this.why.trim()}` : '');
      acts.append(el('div', 'adm-who', `#${pick.id}  ${pick.name}${pick.role ? `  [${pick.role}]` : ''}`));
      const reason = this.input(this.why, 'Why (shown to them), or the words of a warning', (v) => (this.why = v), 'wide');
      const line = (label: string, ...b: HTMLElement[]) => {
        const l = el('div', 'adm-line');
        l.append(el('span', 'adm-label', label), ...b);
        return l;
      };
      if (admin && !me) acts.append(line('Move', this.button('Go to them', () => this.send(`/goto ${who}`)), this.button('Bring them here', () => this.send(`/bring ${who}`))));
      if (admin) acts.append(line('Body', this.button('Heal', () => this.send(`/heal ${who}`), 'good'), ...(me ? [] : [this.grave(`slay${pick.id}`, 'Kill', () => this.send(`/slay ${who}`))])));
      if (!me) {
        acts.append(line('Why', reason));
        acts.append(line('Order',
          this.button('Warn', () => this.send(`/warn ${who}${why() || ' keep to the rules'}`)),
          this.button(pick.muted ? 'Unmute' : 'Mute 10 min', () => this.send(pick.muted ? `/unmute ${who}` : `/mute ${who} 10`)),
          this.button('Mute 60', () => this.send(`/mute ${who} 60`)),
          this.button('Kick', () => this.send(`/kick ${who}${why()}`), 'bad'),
        ));
        acts.append(line('Timeout', ...[5, 10, 30, 60].map((m) => this.button(`${m} min`, () => this.send(`/timeout ${who} ${m}${why()}`), 'bad'))));
        if (admin) {
          acts.append(line('For good', this.grave(`ban${pick.id}`, 'Ban: their game and their address', () => this.send(`/ban ${who}${why()}`))));
          acts.append(line('Role', this.button('Make a mod', () => this.send(`/mod ${who}`)), this.grave(`adm${pick.id}`, 'Make an admin', () => this.send(`/admin ${who}`)), this.button('Take their role', () => this.send(`/demote ${who}`))));
        }
      }
    }

    const gone = el('div', 'adm-gone');
    if (this.lists.gone.length) {
      gone.append(el('div', 'adm-label', 'Left lately'));
      for (const g of this.lists.gone.slice(0, 12)) {
        const r = this.row(`#${g.id}`, g.name, `${g.mins} min ago`);
        if (admin) r.append(this.grave(`gban${g.id}`, 'Ban', () => this.send(`/ban #${g.id}${this.why.trim() ? ` ${this.why.trim()}` : ''}`)));
        gone.append(r);
      }
    }
    return [top, list, acts, gone];
  }

  /** the list of players alone, drawn again as its filter is typed (the box keeps the keyboard) */
  private redrawList() {
    const f = this.find.toLowerCase();
    for (const r of this.body.querySelectorAll<HTMLElement>('.adm-list .pickable')) {
      const name = r.children[1]?.textContent?.toLowerCase() ?? '', id = r.children[0]?.textContent ?? '';
      r.style.display = !f || name.includes(f) || id.startsWith(f) ? '' : 'none';
    }
  }

  // ---------------------------------------------------------------- me

  private me(): HTMLElement[] {
    const s = this.self;
    const toggle = (label: string, on: boolean, flip: () => void, key = '') => {
      const b = this.button(`${on ? '[x]' : '[ ]'}  ${label}${key ? `   [ ${key} ]` : ''}`, flip, on ? 'toggle on' : 'toggle');
      return b;
    };
    const powers = el('div', 'adm-col');
    powers.append(
      el('div', 'adm-label', 'Powers'),
      toggle('God mode: nothing hurts you', s.god, () => this.send(`/god ${s.god ? 'off' : 'on'}`)),
      toggle('Vanish: nobody sees you', s.hidden, () => this.send(`/vanish ${s.hidden ? 'off' : 'on'}`)),
      toggle('Noclip: fly, through anything', s.clip, () => this.send(`/noclip ${s.clip ? 'off' : 'on'}`), 'N'),
      toggle('Free camera: the view leaves the body', s.freecam, () => {
        this.act.freecam(!s.freecam);
        this.act.close();
      }, 'K'),
      this.button('Heal me', () => this.send('/heal'), 'good'),
      el('div', 'adm-label', 'When you die'),
      toggle('Void inventory: nothing you carried is left on your body', s.voidInv, () => this.send(`/voidinv ${s.voidInv ? 'off' : 'on'}`)),
      toggle('Void dog tag: no tag of yours is left to be cashed in', s.voidTag, () => this.send(`/voidtag ${s.voidTag ? 'off' : 'on'}`)),
      el('div', 'dim', 'Flying and in the free camera: W A S D, Space up, Ctrl down, Shift fast, Alt slow. In the free camera, H brings your body to where the view is.'),
      el('div', 'dim', 'No tag is cashed in while god mode, vanish or noclip is on.'),
    );

    const go = el('div', 'adm-col');
    const coords = el('div', 'adm-line');
    const jump = () => {
      const [x, z] = this.where.map(Number);
      if (this.where.every((v) => v.trim() !== '') && Number.isFinite(x) && Number.isFinite(z)) this.send(`/tp ${x} ${z}`);
    };
    coords.append(el('span', 'adm-label', 'To'), this.input(this.where[0], 'x', (v) => (this.where[0] = v), 'num', jump), this.input(this.where[1], 'z', (v) => (this.where[1] = v), 'num', jump), this.button('Go', jump));
    const places = el('div', 'adm-places');
    for (const p of this.places) places.append(this.button(p.name, () => this.send(`/tp ${Math.round(p.x)} ${Math.round(p.z)}`)));
    go.append(
      el('div', 'adm-label', `Teleport   (you are at ${Math.round(s.x)}, ${Math.round(s.z)})`),
      this.button('Open the map: right-click a place to go there', () => this.act.map()),
      coords,
      places,
      el('div', 'dim', 'To a player, or a player to you: the Players tab. Set down on top of whatever is there: use noclip to go inside.'),
    );

    const say = el('div', 'adm-line');
    const tell = () => {
      if (!this.words.trim()) return;
      this.send(`/say ${this.words.trim()}`);
      this.words = '';
      this.draw();
    };
    say.append(el('span', 'adm-label', 'Say to all'), this.input(this.words, 'Across everybody’s screen', (v) => (this.words = v), 'wide', tell), this.button('Say', tell));
    const cols = el('div', 'adm-cols');
    cols.append(powers, go);
    return [cols, say];
  }

  // ---------------------------------------------------------------- things to spawn

  private items(): HTMLElement[] {
    const all = Object.values(ITEMS).filter((d) => d.id !== 'dogtag');
    const kinds = [...new Set(all.map((d) => KIND[d.category] ?? 'Other'))];
    const pick = this.lists.players.find((p) => p.id === this.picked && p.id !== this.self.id) ?? null;
    const top = el('div', 'adm-line');
    top.append(
      this.input(this.thing, 'Find a thing by its name', (v) => {
        this.thing = v;
        this.redrawItems();
      }, 'wide'),
      el('span', 'adm-label', 'How many'),
      this.input(this.count, '1', (v) => (this.count = v), 'num'),
      el('span', 'dim', pick ? `at the feet of #${pick.id} ${pick.name} (picked in Players)` : 'at your feet (pick a player in Players to give to them)'),
    );
    const filter = el('div', 'adm-line');
    filter.append(this.button('All', () => {
      this.kind = '';
      this.draw();
    }, this.kind ? 'tab' : 'tab on'), ...kinds.map((k) => this.button(k, () => {
      this.kind = k;
      this.draw();
    }, this.kind === k ? 'tab on' : 'tab')));
    const list = el('div', 'adm-list tall');
    for (const d of all.sort((a, b) => (KIND[a.category] ?? 'Other').localeCompare(KIND[b.category] ?? 'Other') || a.name.localeCompare(b.name))) {
      const kind = KIND[d.category] ?? 'Other';
      if (this.kind && kind !== this.kind) continue;
      const r = this.row(d.name, d.id, kind, d.stack ? `piles of ${d.stack}` : '');
      r.classList.add('pickable', 'item');
      r.dataset.find = `${d.name} ${d.id}`.toLowerCase();
      r.append(this.button('Give', () => {
        const n = Math.max(1, Math.round(Number(this.count) || 1));
        this.send(`/give ${d.id} ${n}${pick ? ` #${pick.id}` : ''}`);
      }, 'good'));
      list.append(r);
    }
    window.setTimeout(() => this.redrawItems(), 0);
    const kits = el('div', 'adm-kits');
    kits.append(el('div', 'adm-label', `Kits: one click, ${pick ? `for #${pick.id} ${pick.name}` : 'for you'}`));
    for (const k of KITS) {
      const r = el('div', 'adm-kit');
      r.append(this.button(k.name, () => this.send(`/kit ${k.id}${pick ? ` #${pick.id}` : ''}`), 'good'), el('span', 'dim', k.does));
      kits.append(r);
    }
    kits.append(el('div', 'dim', 'A kit takes the place of what is carried (dog tags are kept). What finds no room is put at the feet.'));
    return [kits, top, filter, list, el('div', 'dim', 'A gun comes empty: give its magazine and its rounds as well. A pile is as many as one place holds; more than that comes as several piles (ten at most).')];
  }

  private redrawItems() {
    const f = this.thing.toLowerCase().trim();
    for (const r of this.body.querySelectorAll<HTMLElement>('.adm-list .item')) r.style.display = !f || (r.dataset.find ?? '').includes(f) ? '' : 'none';
  }

  // ---------------------------------------------------------------- bans and roles

  private bans(): HTMLElement[] {
    const list = el('div', 'adm-list tall bans');
    list.append(this.row('', 'Name', 'By', 'On', 'Why', ''));
    list.firstElementChild!.classList.add('headrow');
    for (const b of this.lists.bans) {
      const r = this.row(`${b.n}.`, b.name, b.by, b.at, b.why);
      r.append(this.grave(`unban${b.n}${b.name}`, 'Unban', () => this.send(`/unban ${b.n}`)));
      list.append(r);
    }
    if (!this.lists.bans.length) list.append(el('div', 'dim pad', 'Nobody is banned.'));
    return [el('div', 'dim', 'A ban is of the game that was played and of the connection it was played from. It outlasts the server’s restarts. To ban somebody: the Players tab (they can have just left).'), list];
  }

  private roles(): HTMLElement[] {
    const list = el('div', 'adm-list tall roles');
    list.append(this.row('Name', 'Role', 'Given by', 'On'));
    list.firstElementChild!.classList.add('headrow');
    for (const r of this.lists.roles) list.append(this.row(r.name, r.role, r.by, r.at));
    if (!this.lists.roles.length) list.append(el('div', 'dim pad', 'Nobody has a role.'));
    return [el('div', 'dim', 'A role is given, and taken away, in the Players tab: whoever it is has to be online. A mod can warn, mute, kick and time out. An admin can do everything here.'), list];
  }
}
