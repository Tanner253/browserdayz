// DayZ-style inventory. Three columns:
//   Vicinity   what is on the ground around you, and the crate / stash / body you opened
//   Character  the survivor with gear slots round them (head, face, vest, back, hands,
//              feet) and the four weapon slots underneath
//   Carried    every cargo grid you have right now (pockets, vest, bag), the inspector
// Drag & drop with rotation (R), right-click for everything an item can do,
// double-click (or shift-click) for its main action, hover + 5-8 to put it on a quick key,
// hover + G to drop. While something is being dragged every place it can go is lit: the
// slots that take it, the grids with room, the survivor (drop it anywhere on them to wear,
// equip, use or take it) and the ground (the whole left column). Over a grid the outline is where it will land,
// which is the nearest free spot to the pointer, not only the cell under it.

import { GEAR_SLOTS, ITEMS, SLOT_KIND, SLOT_LABEL, TAG_HOLD_MIN, WEAPON_SLOTS, makeItem, type AttachSlot, capacityOf, handlingOf, itemName, itemWeight, magRoom, tagClock, tagOwner, type ItemInstance, type Slot } from '../sim/items';
import { Container, type PlayerInventory } from '../sim/inventory';
import type { WorldItem, Stash } from '../game/loot';
import type { Vitals } from '../game/player';

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
  place(item: ItemInstance): void;
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
  /** take a carried thing into the hands: what is then done with it is done with the left button, out of this screen */
  hold(item: ItemInstance): void;
  /** what is in the hands */
  inHands(): ItemInstance | null;
  changed(): void;
  sound(kind: 'pickup' | 'drop' | 'move'): void;
}

type Source =
  | { kind: 'container'; c: Container; item: ItemInstance }
  | { kind: 'slot'; slot: Slot; item: ItemInstance }
  | { kind: 'ground'; w: WorldItem; item: ItemInstance }
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

export class InventoryUI {
  root: HTMLDivElement;
  isOpen = false;
  icons: Record<string, string> = {};
  /** portrait of the survivor for the paper doll */
  doll = '';
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

  constructor(private inv: PlayerInventory, private actions: InvActions) {
    this.root = document.createElement('div');
    this.root.className = 'inv';
    document.getElementById('ui')!.appendChild(this.root);
    this.hoverOutline = document.createElement('div');
    this.hoverOutline.className = 'inv-outline';
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.code === 'KeyR' && this.drag) {
        this.drag.rot = !this.drag.rot;
        this.styleGhost();
        this.onMove(e as unknown as PointerEvent);
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
    this.root.classList.remove('show');
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
    el.title = itemName(item);
    return el;
  }

  private gridEl(c: Container) {
    const g = document.createElement('div');
    g.className = 'inv-grid';
    g.style.width = `${c.w * CELL}px`;
    g.style.height = `${c.h * CELL}px`;
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

  /** a grid with its bar over it, as DayZ has it: its name, how much of it is taken up, and a click folds it away */
  private gridBox(c: Container) {
    const box = document.createElement('div');
    const used = c.items.reduce((n, p) => n + ITEMS[p.item.id].w * ITEMS[p.item.id].h, 0);
    const shut = this.folded.has(c.id);
    box.className = 'inv-gridbox' + (shut ? ' shut' : '');
    box.innerHTML = `<h4 title="${shut ? 'Open it' : 'Fold it away'}"><i>${shut ? '▸' : '▾'}</i>${c.name} <span>${c === this.inv.tags ? `${c.items.length} / ${c.w * c.h} · taken off others` : `${used} / ${c.w * c.h}`}</span></h4>`;
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
      el.title = `${itemName(item)}: used with the left button, held, once this is shut`;
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
      const url = this.icons[item.id];
      el.innerHTML = `<div class="inv-item-img fit" style="${url ? `background-image:url(${url})` : ''}"></div>${this.tags(item)}`;
      el.title = itemName(item);
      this.bindItem(el, { kind: 'slot', slot, item });
      s.appendChild(el);
    } else s.classList.add('empty');
    return s;
  }

  render() {
    const inv = this.inv;
    const r = this.root;
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
      // (a bat is six cells tall and one wide: stood up in this little box its picture is a hair. Long things are laid on their side here.)
      ic.innerHTML = `<div class="inv-item-img fit${d.h > d.w ? ' lying' : ''}" style="background-image:url(${this.icons[w.loot.item.id] ?? ''})"></div>`;
      row.appendChild(ic);
      const extra = d.stack ? ` <span>×${w.loot.item.qty}</span>` : d.use?.sips ? ` <span>${w.loot.item.left ?? d.use.sips}/${d.use.sips}</span>` : d.weapon ? ` <span>${w.loot.item.loaded ?? 0}/${capacityOf(w.loot.item)}</span>` : w.loot.item.cargo?.length ? ` <span>${w.loot.item.cargo.length} inside</span>` : '';
      row.insertAdjacentHTML('beforeend', `<div class="g-name">${itemName(w.loot.item)}${extra}<small>${d.category}</small></div>`);
      this.bindItem(row, { kind: 'ground', w, item: w.loot.item });
      ground.appendChild(row);
    }
    vic.appendChild(ground);
    if (this.stash) {
      vic.insertAdjacentHTML('beforeend', `<h3>${this.stash.label} <span>${this.stash.container.w}×${this.stash.container.h}</span></h3>`);
      if (this.stashState) vic.insertAdjacentHTML('beforeend', `<div class="inv-empty">${this.stashState}</div>`);
      else {
        vic.appendChild(this.gridEl(this.stash.container));
        // (a pack on a body or in a crate is opened where it lies, and gone through)
        this.openBags(vic, this.stash.container);
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
    for (const s of ['head', 'face', 'vest'] as Slot[]) left.appendChild(this.slotEl(s));
    for (const s of ['back', 'hands', 'feet'] as Slot[]) right.appendChild(this.slotEl(s));
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
    top.append(handBox, withParts('holster'));
    const long = document.createElement('div');
    long.className = 'inv-slots';
    long.append(withParts('primary'), withParts('secondary'));
    gear.append(top, long);
    // (the tags taken off others: here under the survivor, out of the way of what is carried)
    gear.appendChild(this.gridBox(inv.tags));

    // ---- carried: every cargo grid, then the inspector
    const cargo = document.createElement('div');
    cargo.className = 'inv-col inv-cargo';
    cargo.innerHTML = `<h3>Carried <span>${inv.weight().toFixed(1)} kg</span></h3>`;
    const grids = document.createElement('div');
    grids.className = 'inv-grids';
    for (const c of inv.containers) {
      if (c === inv.tags) continue;
      grids.appendChild(this.gridBox(c));
      this.openBags(grids, c);
    }
    cargo.appendChild(grids);
    if (!GEAR_SLOTS.some((s) => inv.slots[s] && ITEMS[inv.slots[s]!.id].wear?.cargo)) {
      cargo.insertAdjacentHTML('beforeend', `<div class="inv-tip">Only your pockets. A vest or a bag on your back adds more space.</div>`);
    }
    cargo.appendChild(this.inspector());
    cargo.insertAdjacentHTML('beforeend', `<div class="inv-help"><b>Drag</b> to move: onto your character to wear it, sling it or take it in your hands, onto the left side to drop · <b>R</b> rotate · <b>Double-click</b> or <b>Shift-click</b>: take in hands, wear or pick up · point + <b>1</b>–<b>0</b>: put it on that key · point + <b>G</b> drop · <b>Right-click</b> for the rest. What is in your hands is used with the <b>left button</b>, held, once this is shut.</div>`);
    if (this.vitals) {
      const v = this.vitals;
      const bar = (label: string, val: number, cls: string) => `<div class="vbar ${cls}"><span>${label}</span><div><i style="width:${Math.max(0, Math.min(100, val))}%"></i></div><b>${Math.round(val)}</b></div>`;
      cargo.insertAdjacentHTML('beforeend', `<div class="inv-status"><h3>Status</h3>${bar('Health', v.health, v.health < 30 ? 'bad' : '')}${bar('Energy', v.energy, v.energy < 25 ? 'bad' : '')}${bar('Water', v.water, v.water < 25 ? 'bad' : '')}${v.bleeding ? '<div class="bleeding">Bleeding: use a bandage</div>' : ''}</div>`);
    }

    wrap.append(vic, gear, cargo);
    r.appendChild(wrap);
    r.appendChild(this.hotEl());
    r.appendChild(this.hoverOutline);
    if (this.menu) r.appendChild(this.menu);
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
          <div class="ins-cat">${d.category}</div>
          <div class="ins-name">${itemName(it)}</div>
        </div>
      </div>
      <div class="ins-desc">${d.desc}</div>
      <div class="ins-stats">${stats.join('')}</div>
      <div class="ins-actions"></div>`;
    const acts = box.querySelector('.ins-actions') as HTMLElement;
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
    if (loc.kind === 'ground' && !this.materialize(loc)) return;
    this.removeFrom(loc);
    const prev = this.inv.slots[target];
    this.inv.slots[target] = it;
    if (prev) this.stow(prev);
    this.actions.sound('move');
    this.actions.changed();
  }

  /** find room for something that just came out of a slot; it goes on the ground if there is none */
  private stow(item: ItemInstance) {
    const left = this.inv.containers.reduce<ItemInstance | null>((l, c) => (l ? c.add(l) : null), item);
    if (left) this.actions.drop(left);
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
      return out;
    }
    const inStash = loc.kind === 'container' && !!this.stash && loc.c === this.stash.container;
    // What is done with a thing is done with it in the hands, out of this screen, by the left button (2026-10-10):
    // here it is taken into them. (Worn things are worn; what is on the back or in the holster comes into the
    // hands the same way.)
    const worn = loc.kind === 'slot' && !WEAPON_SLOTS.includes(loc.slot);
    if (this.carried(loc) && !worn && d.category !== 'clothing') {
      const held = this.actions.inHands() === it;
      if (!held) out.push({ label: 'Take in hands', run: () => this.actions.hold(it), primary: !d.attach || !this.actions.attachTargets(it).length });
    }
    if (this.opens(loc)) {
      const open = this.opened.has(it.uid);
      out.push({ label: open ? 'Close it' : `Open (${it.cargo?.length ?? 0} inside)`, primary: true, run: () => {
        if (!this.opened.delete(it.uid)) this.opened.add(it.uid);
        this.actions.sound('move');
        this.render();
      } });
    }
    if (d.category === 'stash') out.push({ label: 'Place', run: () => this.actions.place(it) });
    if (d.attach) {
      for (const w of this.actions.attachTargets(it)) out.push({ label: `Attach to ${ITEMS[w.id].name}`, run: () => this.actions.attach(it, w), primary: true });
    }
    if (d.slot && loc.kind === 'container') out.push({ label: d.category === 'clothing' ? gearWord : 'Sling on your back', run: () => this.equip(loc), primary: d.category === 'clothing' && !this.opens(loc) });
    if (loc.kind === 'slot') {
      out.push({
        label: d.category === 'clothing' ? 'Take off' : 'Stow',
        run: () => {
          if (!this.inv.containers.some((c) => c.hasRoom(it))) return;
          this.detach(loc);
          this.stow(it);
          this.actions.sound('move');
          this.actions.changed();
        },
      });
    }
    if (d.mag) {
      if ((it.rounds ?? 0) > 0) out.push({ label: `Empty (${it.rounds})`, run: () => this.actions.emptyMag(it) });
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

  /** crate <-> inventory */
  private transfer(src: Source) {
    if (!this.stash || this.stashState || src.kind === 'ground') return;
    const item = src.item;
    if (src.kind === 'container' && src.c === this.stash.container) {
      if (!this.inv.hasRoom(item)) return;
      this.detach(src);
      const left = this.inv.add(item);
      if (left) this.stash.container.add(left);
    } else {
      if (!this.stash.container.hasRoom(item)) return;
      this.detach(src);
      const left = this.stash.container.add(item);
      if (left) this.stow(left);
    }
    this.actions.sound('move');
    this.actions.changed();
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  private openMenu(src: Source, x: number, y: number) {
    this.closeMenu();
    this.selected = src.item;
    this.render();
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
    return null;
  }

  private detach(src: Source) {
    if (src.kind === 'fitted') return;
    if (src.kind === 'container') src.c.remove(src.item);
    else if (src.kind === 'slot') {
      this.inv.slots[src.slot] = null;
      if (this.inv.active === src.slot) this.inv.active = null;
    }
  }

  // ------------------------------------------------------------ interaction

  private bindItem(el: HTMLElement, src: Source) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (e.shiftKey) {
        this.selected = src.item;
        this.quickMove(src);
        return;
      }
      this.selected = src.item;
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
    el.addEventListener('dblclick', () => this.quickMove(src));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.cancelDrag();
      this.openMenu(src, e.clientX, e.clientY);
    });
    el.addEventListener('pointerenter', () => (this.hover = src));
    el.addEventListener('pointerleave', () => {
      if (this.hover === src) this.hover = null;
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

  private target(x: number, y: number) {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      const h = el as HTMLElement;
      if (h.dataset?.container) return { kind: 'grid' as const, el: h, id: h.dataset.container };
      if (h.dataset?.part) return { kind: 'part' as const, el: h, gun: h.dataset.gun! };
      if (h.dataset?.hot) return { kind: 'hot' as const, el: h, i: Number(h.dataset.hot) };
      if (h.dataset?.hands) return { kind: 'hands' as const, el: h };
      if (h.dataset?.slot) return { kind: 'slot' as const, el: h, slot: h.dataset.slot as Slot };
      if (h.dataset?.ground) return { kind: 'ground' as const, el: h };
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
    const d = ITEMS[item.id];
    if (!d.wear?.cargo || depth > 2) return null;
    item.cargo ??= [];
    let c = this.bags.get(item.uid);
    if (!c || c.items !== item.cargo) {
      c = new Container(`bag:${item.uid}`, d.name, d.wear.cargo[0], d.wear.cargo[1], item.cargo, d.slot === 'back');
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
      if (h4) h4.insertAdjacentHTML('beforeend', `<em title="Close it">in ${c.name.toLowerCase()} · close</em>`);
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
    return loc.kind === 'container' && !!ITEMS[loc.item.id].wear?.cargo && loc.c.depth < 2;
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
    if (c.fits(item, cx, cy, rot, item)) return { x: cx, y: cy, rot };
    let best: { x: number; y: number; rot: boolean } | null = null;
    let bd = Infinity;
    for (const r of [rot, !rot]) {
      const [w, h] = Container.size(item, r);
      for (let y = 0; y <= c.h - h; y++) {
        for (let x = 0; x <= c.w - w; x++) {
          // (a turn counts as a little further away: it is only taken when it has to be)
          const dist = Math.hypot(x - cx, y - cy) + (r === rot ? 0 : 0.75);
          if (dist < bd && c.fits(item, x, y, r, item)) {
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
    return { label: 'Take', run: () => (src.kind === 'ground' ? this.quickMove(src) : this.transfer(src)) };
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
    this.root.querySelectorAll('.drop-hint, .drop-ok, .drop-bad, .grid-ok, .grid-full, .char-ok, .char-over, .ground-ok, .ground-over').forEach((el) => el.classList.remove('drop-hint', 'drop-ok', 'drop-bad', 'grid-ok', 'grid-full', 'char-ok', 'char-over', 'ground-ok', 'ground-over'));
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
    this.root.querySelectorAll('.drop-ok, .drop-bad, .char-over, .ground-over').forEach((el) => el.classList.remove('drop-ok', 'drop-bad', 'char-over', 'ground-over'));
    if (!this.dragStart.moved) return;
    const t = this.target(e.clientX, e.clientY);
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
      const how = onto ? this.joins(d, onto.item) : null;
      if (onto && how) {
        const [w, h] = Container.size(onto.item, onto.rot);
        box(rect, onto.x, onto.y, w, h, 'join', how === 'stack' ? 'Add' : how === 'fill' ? 'Fill' : 'Fit');
        return;
      }
      const at = this.landing(c, d.src.item, cx, cy, d.rot);
      if (at) {
        const [w, h] = Container.size(d.src.item, at.rot);
        box(rect, at.x, at.y, w, h, 'ok');
      } else {
        const [w, h] = Container.size(d.src.item, d.rot);
        box(rect, cx, cy, w, h, 'bad', 'No room');
      }
    } else if (t?.kind === 'slot') {
      const occupant = this.inv.slots[t.slot];
      const part = !!occupant && this.joins(d, occupant) === 'attach';
      t.el.classList.add(part || ITEMS[d.src.item.id].slot === SLOT_KIND[t.slot] ? 'drop-ok' : 'drop-bad');
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
    if (!this.dragStart.moved) {
      this.render();
      return;
    }
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
        if (left) this.actions.drop(left);
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
      }
      return this.render();
    }
    // let go on the hands: a thing carried comes into them; a thing lying about is picked up, and then does
    if (t.kind === 'hands') {
      if (def.category === 'clothing') return this.render();
      if (d.src.kind === 'ground' || (d.src.kind === 'container' && !this.inv.containers.includes(d.src.c))) {
        if (!this.inv.hasRoom(item) || !this.materialize(d.src)) return this.render();
        this.removeFrom(d.src);
        const left = this.inv.add(item);
        if (left) {
          this.actions.drop(left);
          return this.finish('pickup');
        }
      }
      this.actions.hold(item);
      return this.finish('move');
    }
    // let go on a place on a gun that takes a part: the part is fitted, if it is that gun's and that place's
    if (t.kind === 'part') {
      const gun = this.gunByUid(t.gun);
      if (gun && this.joins(d, gun) === 'attach') this.fit(d.src, gun);
      return this.render();
    }
    if (t.kind === 'grid') {
      const c = this.containerById(t.id!);
      if (!c) return this.render();
      const z = this.z;
      const rect = t.el.getBoundingClientRect();
      const [cx, cy] = this.cellAt(e, t.el, d);
      const onto = this.under(c, Math.floor(((e.clientX - rect.left) / z) / CELL), Math.floor(((e.clientY - rect.top) / z) / CELL));
      const how = onto ? this.joins(d, onto.item) : null;
      // more of the same, let go on the stack
      if (onto && how === 'stack') {
        if (!this.materialize(d.src)) return this.render();
        const move = Math.min(def.stack! - onto.item.qty, item.qty);
        onto.item.qty += move;
        item.qty -= move;
        if (item.qty <= 0) this.removeFrom(d.src);
        else if (d.src.kind === 'ground') {
          // the rest of a ground stack goes into cargo (or back on the ground)
          this.removeFrom(d.src);
          const left = this.inv.add(item);
          if (left) this.actions.drop(left);
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
          if (!this.materialize(d.src)) return this.render();
          this.removeFrom(d.src);
          const left = this.inv.add(item);
          if (left) this.actions.drop(left);
        }
        this.actions.fillMag(onto.item);
        return this.render();
      }
      const at = this.landing(c, item, cx, cy, d.rot);
      if (!at) return this.render();
      if (!this.materialize(d.src)) return this.render();
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
      // not what that slot takes: do what letting go anywhere on the survivor would
      if (def.slot !== SLOT_KIND[t.slot]) return this.dropOnCharacter(d.src);
      if (d.src.kind === 'slot' && d.src.slot === t.slot) return this.render();
      if (!this.materialize(d.src)) return this.render();
      this.removeFrom(d.src);
      this.inv.slots[t.slot] = item;
      if (occupant) {
        // swapping two slots of the same kind just trades places
        if (d.src.kind === 'slot' && !this.inv.slots[d.src.slot] && ITEMS[occupant.id].slot === SLOT_KIND[d.src.slot]) this.inv.slots[d.src.slot] = occupant;
        else this.stow(occupant);
      }
      this.finish(d.src.kind === 'ground' ? 'pickup' : 'move');
    } else if (t.kind === 'char') {
      this.dropOnCharacter(d.src);
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
    if (!this.materialize(src)) return;
    this.removeFrom(src);
    this.actions.attach(item, weapon);
    if (!(ITEMS[item.id].mag ? weapon.mag === item.id : (weapon.mods ?? []).includes(item.id))) {
      const left = this.inv.add(item);
      if (left) this.actions.drop(left);
    }
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

  /** Double-click: the one obvious thing to do with the item (never drops it). */
  private quickMove(src: Source) {
    const item = src.item;
    if (src.kind === 'ground') {
      // pick up: wear it / sling it if the slot is free, else into the pockets
      if (!this.inv.hasRoom(item)) return;
      if (!this.actions.take(src.w)) return;
      this.vicinity = this.vicinity.filter((v) => v !== src.w);
      const left = this.inv.add(item);
      if (left) this.actions.drop(left);
      this.finish('pickup');
      return;
    }
    if (this.stash && !this.stashState) {
      this.transfer(src);
      this.render();
      return;
    }
    const main = this.actionsFor(src).find((a) => a.primary);
    if (main) {
      main.run();
      this.render();
    }
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
    this.clearTargets();
  }
}
