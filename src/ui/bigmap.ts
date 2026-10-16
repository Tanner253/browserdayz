// The map, opened large (M): a sheet as an army prints one. Pale paper, the ground's shape in brown contour
// lines every five metres (every fifth one heavier), the woods tinted green, the roads and every building in
// black, a grid of hundred-metre squares lettered across and numbered down, a scale and a north point.
//
// It can be looked into: the wheel (or two fingers) brings it nearer about wherever it is pointed at, a drag
// moves it, and there are buttons for both and one that goes back to where you stand. It has a way out that can
// be seen (an X in its corner: asked for, for phones above all, which have no M and no Esc).
//
// And it says where things are to be had. Every building that has anything in it is outlined in the colour of
// the step of the map it is on (src/sim/tiers.ts), each step switched on and off from the bar along its top;
// pointed at, a building says what kind of thing is kept there: medical, military, what a house has. (Asked for:
// "allow the player to zoom in on the map and we should redo the map it doesnt look very official like a
// military map, lets add an x button", and "a filter overlay to the in game map to toggle the loot tier and
// locations so in game i can see where the good loot is". It had a dot for every place a thing can lie, a count
// of them on each button and a list of the things themselves, and was told: "we dont need an individual dot for
// each spawn simply list what category of loot exists at that building and make the building outline the color
// of the tier / dont need to list items or show how many spots spawn loot".)
//
// The small round map in the corner of the screen is another thing (minimap.ts) and is as it was.

import { breathe } from '../core/breathe';
import { TOUCH } from '../core/device';
import type { GasZone } from '../sim/gas';
import { TIERS, type Tier } from '../sim/tiers';
import { playEdge } from '../world/outline';
import { BUILDING_FOOTPRINT, CELL, SQUARE_HALF, WORLD_NX, WORLD_X0, WORLD_X1, WORLD_Z0, WORLD_Z1, type World } from '../world/worldgen';
import type { MenuSpot } from './hud';

type Pt = { x: number; z: number };
/** what stands about the world now, as the corner map is told it */
export interface MapLive {
  jeeps: Pt[];
  wells: Pt[];
  traders: Pt[];
  drops: Pt[];
  pings: (Pt & { at: number })[];
}

/** metres between the lines of the grid, and between contour lines (every fifth is drawn heavier) */
const GRID = 100, CONTOUR = 5;
/** how near it can be brought: 1 is the whole sheet */
const NEAREST = 9;
/** a part of the world printed: its north-west corner, its south-east, and how many pixels to a metre */
interface Area { x0: number; z0: number; x1: number; z1: number; S: number }
/** a part printed: its picture, where its corner is, and its pixels to a metre */
interface Sheet { c: HTMLCanvasElement; x0: number; z0: number; S: number }
const PAPER = [218, 212, 188], INK = '#1d1b16';
const TIER_IDS: Tier[] = [1, 2, 3, 4, 5];
const KEPT = 'zona.map';
/** a tier's colour on the sheet: its own, but for the first, which is a pale one made for a dark ground */
const onPaper = (t: Tier) => (t === 1 ? '#8d846c' : TIERS[t].colour);
/** what a kind of building is called */
const CALLED: Record<string, string> = {
  house_small: 'House', house_brick: 'Brick house', house_two: 'Two-floor house', townhouse: 'Brick townhouse', shanty: 'Plank house', cabin: 'Cabin', hut: 'Long hut',
  barn: 'Barn', shed: 'Shed', garage: 'Workshop', store: 'Shop', clinic: 'Clinic', police: 'Police station', police_hq: 'Police headquarters', hospital: 'Hospital', barracks: 'Barracks', guardpost: 'Guard post', tower: 'Watchtower', tent: 'Army tent',
};
/** the kinds of thing kept in a place, by what the place is said to be used for (what is not here says where a place is, not what is in it) */
const KIND: Record<string, string> = { Village: 'Residential', Town: 'Residential', Farm: 'Farm', Industrial: 'Industrial', Military: 'Military', Hunting: 'Hunting', Medic: 'Medical', Hospital: 'Medical', Police: 'Police', Shop: 'Food and supplies', Bunker: 'Military' };

/** a building with something in it: where it stands, its step of the map, and the kinds of thing kept there */
interface Held { name: string; x: number; z: number; rot: number; w: number; d: number; tier: Tier; kinds: string[]; gas: boolean }

interface Shown { tiers: Tier[]; names: boolean; wells: boolean; cars: boolean; grid: boolean }

/** somebody on the server, as an admin's map shows them: where, which way they face, and how they are */
export interface MapPerson { id?: number; x: number; z: number; name: string; yaw?: number; dead?: boolean; faint?: boolean; staff?: boolean; asleep?: boolean; away?: boolean; seat?: boolean; hp?: number; flags?: number }
/** what can be done to somebody from the map: the list that opens when their dot is clicked (`select` is the click itself) */
export type PersonAct = 'select' | 'goto' | 'bring' | 'watch' | 'message' | 'panel';
/**
 * How an admin has their map show people: kept by the browser (2026-10-13: "allow admin map customization controls
 * to change the players name color and other helpful things").
 */
interface AdminShown {
  /** everybody's dot, at all */
  on: boolean;
  names: boolean;
  /** the colour of the names, and their size and the dots' (CSS pixels) */
  colour: string;
  size: number;
  dot: number;
  facing: boolean;
  hp: boolean;
  flags: boolean;
  dead: boolean;
  /** bodies left behind, and those whose game is not answering */
  asleep: boolean;
  /** where each has been in the last minute */
  trail: boolean;
  /** a ring of so many metres round the admin and round whoever is picked (0: none) */
  ring: number;
  /** the box of these settings is unfolded */
  open: boolean;
}
const ADMIN_KEPT = 'zona.map.admin';
// (on a phone the box opens folded: the sheet is small there)
const ADMIN_SHOWN: AdminShown = { on: true, names: true, colour: '#1d1b16', size: 12, dot: 4.5, facing: true, hp: false, flags: true, dead: true, asleep: true, trail: false, ring: 0, open: !TOUCH };
/** a trail is this long, seconds, and has a point for every so many metres gone */
const TRAIL_S = 60, TRAIL_STEP = 3;
const DOT = { player: '#1f5fd0', staff: '#7a3fd0', away: '#c98a1e', asleep: '#7d8a99', dead: '#6b6b63' };

export class BigMap {
  root: HTMLDivElement;
  open = false;
  /** asked to be shut (its X, or a tap outside it) */
  onClose: () => void = () => {};
  /** everybody on the server, where they stand (an admin's map alone): each a dot with their name by it */
  private people: MapPerson[] = [];
  /**
   * Told again and again while an admin has the map open (twice a second: see `feedMap` in game.ts), so that the
   * dots move as people do. 2026-10-13: "the admin map needs to have LIVE updates and i want to see a dot where
   * the player is". Nothing is laid out here but the list of names to pick from, and that only when who is on changes.
   */
  setPeople(list: MapPerson[]) {
    if (!list.length && !this.people.length) return;
    this.people = list;
    this.dirty = true;
    const now = performance.now() / 1000;
    if (this.adm.trail) {
      for (const q of list) {
        if (q.id === undefined || q.dead) continue;
        const t = this.trails.get(q.id) ?? [], last = t[t.length - 1];
        if (!last || Math.hypot(last.x - q.x, last.z - q.z) >= TRAIL_STEP) t.push({ x: q.x, z: q.z, at: now });
        while (t.length && now - t[0].at > TRAIL_S) t.shift();
        this.trails.set(q.id, t);
      }
      for (const id of this.trails.keys()) if (!list.some((q) => q.id === id)) this.trails.delete(id);
    } else if (this.trails.size) this.trails.clear();
    if (this.sel && !list.some((q) => q.id === this.sel)) this.pick(0);
    const key = list.map((q) => `${q.id}:${q.name}`).join('|');
    if (key !== this.peopleKey) {
      this.peopleKey = key;
      this.listPeople();
    }
  }
  /** what an admin does to somebody from the map (see PersonAct): null, and a dot is only a dot */
  onPerson: ((id: number, what: PersonAct) => void) | null = null;
  private admin = false;
  private adm: AdminShown = { ...ADMIN_SHOWN };
  /** the box of an admin's settings on the map, and the short list that opens on a dot that is clicked */
  private admBox = document.createElement('div');
  private whoBox = document.createElement('div');
  /** whoever is picked (their number; 0, nobody) */
  private sel = 0;
  private trails = new Map<number, { x: number; z: number; at: number }[]>();
  private peopleKey = '';

  /** The map is an admin's, or is not: the settings box is theirs alone, and so are the dots. */
  setAdmin(on: boolean) {
    if (on === this.admin) return;
    this.admin = on;
    this.admBox.hidden = !on;
    if (!on) {
      this.people = [];
      this.trails.clear();
      this.pick(0);
    }
    this.dirty = true;
  }

  /** Whoever is picked on the map (from the panel too): ringed, and the range ring is round them. */
  pick(id: number) {
    this.sel = id;
    this.whoBox.hidden = true;
    const find = this.admBox.querySelector<HTMLSelectElement>('[data-adm="find"]');
    if (find) find.value = id ? String(id) : '';
    this.dirty = true;
  }

  /** the admin's box, made once: every switch in it changes how the dots are drawn and is kept by the browser */
  private buildAdmin(view: HTMLElement) {
    try {
      const was = JSON.parse(localStorage.getItem(ADMIN_KEPT) ?? 'null') as Partial<AdminShown> | null;
      if (was && typeof was === 'object') {
        for (const k of Object.keys(ADMIN_SHOWN) as (keyof AdminShown)[]) if (typeof was[k] === typeof ADMIN_SHOWN[k]) (this.adm as unknown as Record<string, unknown>)[k] = was[k];
        if (!/^#[0-9a-f]{6}$/i.test(this.adm.colour)) this.adm.colour = ADMIN_SHOWN.colour;
        this.adm.size = Math.min(22, Math.max(9, this.adm.size));
        this.adm.dot = Math.min(10, Math.max(3, this.adm.dot));
        this.adm.ring = Math.min(500, Math.max(0, this.adm.ring));
      }
    } catch {
      /* nothing kept: as it is made */
    }
    const check = (k: keyof AdminShown, label: string, tip: string) => `<label title="${tip}"><input type="checkbox" data-adm="${k}"><span>${label}</span></label>`;
    const b = this.admBox;
    b.className = 'hm-adm';
    b.hidden = true;
    b.innerHTML = `
      <button type="button" class="hm-adm-t" data-adm="open" title="Fold this box away, or open it"><b>Admin view</b><span class="hm-adm-n"></span><i></i></button>
      <div class="hm-adm-b">
        <label class="hm-adm-row"><span>Find a player</span><select data-adm="find" title="The map goes to them, and they are picked"></select></label>
        <div class="hm-adm-checks">
          ${check('on', 'Players', 'Everybody’s dot, on or off')}
          ${check('names', 'Names', 'Each name beside its dot')}
          ${check('facing', 'Facing', 'A point on each dot, the way they face')}
          ${check('hp', 'Health', 'Health after the name')}
          ${check('flags', 'Cheat flags', 'How often the cheat checks fired on them, after the name')}
          ${check('dead', 'The dead', 'Those who are dead: a grey cross')}
          ${check('asleep', 'Bodies left, tabbed out', 'Those who left a body behind (a hollow dot), and those whose game is not answering (amber)')}
          ${check('trail', 'Trail, last minute', 'A line where each has been in the last minute')}
        </div>
        <label class="hm-adm-row"><span>Name colour</span><input type="color" data-adm="colour" title="The colour of the names"></label>
        <label class="hm-adm-row"><span>Name size</span><input type="range" min="9" max="22" step="1" data-adm="size" title="How big the names are"></label>
        <label class="hm-adm-row"><span>Dot size</span><input type="range" min="3" max="10" step="0.5" data-adm="dot" title="How big the dots are"></label>
        <label class="hm-adm-row"><span>Range ring</span><select data-adm="ring" title="A ring round you, and round whoever is picked"><option value="0">Off</option><option value="50">50 m</option><option value="100">100 m</option><option value="200">200 m</option><option value="500">500 m</option></select></label>
        <div class="hm-adm-key"><i style="background:${DOT.player}"></i>player<i style="background:${DOT.staff}"></i>staff<i style="background:${DOT.away}"></i>tabbed out<i class="hollow" style="border-color:${DOT.asleep}"></i>body left<i class="cross" style="color:${DOT.dead}">×</i>dead</div>
        <div class="hm-adm-foot"><span class="hm-adm-at" title="The map numbers under the pointer: what /tp and /spawn take"></span><button type="button" data-adm="reset" title="Every setting in this box as it was made">Reset</button></div>
        <p class="hm-adm-hint">Click a dot for what can be done. Right-click the map to go there.</p>
      </div>`;
    const w = this.whoBox;
    w.className = 'hm-who';
    w.hidden = true;
    w.innerHTML = `<b></b><small></small>
      <button type="button" data-who="goto">Go to them</button>
      <button type="button" data-who="bring">Bring them here</button>
      <button type="button" data-who="watch">Watch them</button>
      <button type="button" data-who="message">Message them</button>
      <button type="button" data-who="panel">Open in the panel</button>`;
    view.append(b, w);
    const set = () => {
      const A = this.adm as unknown as Record<string, unknown>;
      for (const i of b.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[data-adm], select[data-adm]')) {
        const k = i.dataset.adm!;
        if (k === 'find') continue;
        if (i instanceof HTMLInputElement && i.type === 'checkbox') i.checked = !!A[k];
        else i.value = String(A[k]);
      }
      b.classList.toggle('shut', !this.adm.open);
      b.querySelector('.hm-adm-t')!.setAttribute('aria-expanded', String(this.adm.open));
    };
    const keep = () => {
      try {
        localStorage.setItem(ADMIN_KEPT, JSON.stringify(this.adm));
      } catch {
        /* a browser that keeps nothing: it lasts as long as the page does */
      }
      this.dirty = true;
    };
    set();
    const changed = (e: Event) => {
      const i = e.target as HTMLInputElement | HTMLSelectElement, k = i.dataset?.adm as keyof AdminShown | 'find' | undefined;
      if (!k || k === 'open') return;
      if (k === 'find') {
        const q = this.people.find((p) => p.id === Number(i.value));
        if (!q) return void this.pick(0);
        this.pick(q.id ?? 0);
        this.at = { x: q.x, z: q.z };
        if (this.zoom < 3) this.zoom = 3;
        this.clamp();
        this.onPerson?.(q.id ?? 0, 'select');
        return;
      }
      const A = this.adm as unknown as Record<string, unknown>;
      if (i instanceof HTMLInputElement && i.type === 'checkbox') A[k] = i.checked;
      else if (k === 'colour') A[k] = /^#[0-9a-f]{6}$/i.test(i.value) ? i.value : ADMIN_SHOWN.colour;
      else A[k] = Number(i.value) || 0;
      // (trails switched off are forgotten there and then: switched on again, they start from where people are)
      if (!this.adm.trail) this.trails.clear();
      keep();
    };
    b.addEventListener('input', changed);
    b.addEventListener('change', changed);
    b.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button[data-adm]');
      if (!t) return;
      if (t.dataset.adm === 'open') this.adm.open = !this.adm.open;
      else this.adm = { ...ADMIN_SHOWN, open: this.adm.open };
      set();
      keep();
    });
    // (a key pressed in the box is the box's: an arrow on a slider does not walk the admin off)
    b.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' && e.code !== 'KeyM') e.stopPropagation();
    });
    w.addEventListener('click', (e) => {
      const what = (e.target as HTMLElement).closest<HTMLElement>('button[data-who]')?.dataset.who as PersonAct | undefined, id = this.sel;
      if (!what || !id) return;
      w.hidden = true;
      this.onPerson?.(id, what);
    });
  }

  /** the names to pick from in the admin's box, and how many there are: made again when who is on changes */
  private listPeople() {
    const find = this.admBox.querySelector<HTMLSelectElement>('[data-adm="find"]'), n = this.admBox.querySelector('.hm-adm-n');
    if (!find || !n) return;
    n.textContent = `${this.people.length} other${this.people.length === 1 ? '' : 's'} on`;
    const first = new Option(this.people.length ? 'Pick one…' : 'Nobody else is on', '');
    find.replaceChildren(first, ...[...this.people].filter((q) => q.id !== undefined).sort((a, b) => a.name.localeCompare(b.name)).map((q) => new Option(`${q.name}  #${q.id}`, String(q.id))));
    find.value = this.sel ? String(this.sel) : '';
  }

  /** whether somebody is drawn, as the admin's switches stand */
  private seen(q: MapPerson) {
    return this.admin && this.adm.on && (this.adm.dead || !q.dead) && (this.adm.asleep || !(q.asleep || q.away));
  }

  /** whoever's dot is nearest a place on the sheet, within `reach` metres of it */
  private personAt(wx: number, wz: number, reach: number): MapPerson | null {
    let best: MapPerson | null = null, far = reach;
    for (const q of this.people) {
      if (!this.seen(q)) continue;
      const d = Math.hypot(q.x - wx, q.z - wz);
      if (d < far) {
        far = d;
        best = q;
      }
    }
    return best;
  }

  /** the map numbers under the pointer, written in the admin's box (what `/tp` and `/spawn` take) */
  private sayAt(u: number, w: number) {
    const k = this.perMetre(), at = this.admBox.querySelector('.hm-adm-at');
    if (at) at.textContent = `Pointer: ${Math.round(this.at.x + ((u - 0.5) * this.view.width) / k)}, ${Math.round(this.at.z + ((w - 0.5) * this.view.height) / k)}`;
  }

  /** how somebody is, in a few words */
  private stateOf(q: MapPerson) {
    return [q.dead ? 'dead' : q.asleep ? 'gone: body left behind' : q.away ? 'not answering (tabbed out)' : q.hp !== undefined ? `${Math.round(q.hp)} health` : '', q.seat ? 'in a car' : '', q.faint && !q.asleep ? 'vanished' : '', q.staff ? 'staff' : '', q.flags ? `${q.flags} cheat flag${q.flags === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  }

  /**
   * A click on the sheet, to an admin: on a dot, that player is picked and the short list of what can be done opens
   * beside them; anywhere else, nobody is. @returns whether it was on a dot
   */
  private clickPerson(u: number, w: number, left: number, top: number): boolean {
    if (!this.admin || !this.adm.on) return false;
    const W = this.view.width, H = this.view.height, k = this.perMetre();
    const q = this.personAt(this.at.x + ((u - 0.5) * W) / k, this.at.z + ((w - 0.5) * H) / k, ((TOUCH ? 26 : 16) * (W / Math.max(1, this.view.clientWidth))) / k);
    if (!q || q.id === undefined) {
      if (this.sel) this.pick(0);
      this.whoBox.hidden = true;
      return false;
    }
    this.pick(q.id);
    this.whoBox.querySelector('b')!.textContent = q.name;
    this.whoBox.querySelector('small')!.textContent = `#${q.id} · ${Math.round(q.x)}, ${Math.round(q.z)} · ${Math.round(Math.hypot(q.x - this.me.x, q.z - this.me.z))} m from you${this.stateOf(q) ? ` · ${this.stateOf(q)}` : ''}`;
    // (the dead and the gone are not brought or watched)
    for (const b of this.whoBox.querySelectorAll<HTMLButtonElement>('button[data-who]')) b.disabled = (b.dataset.who === 'bring' || b.dataset.who === 'watch') && (!!q.dead || !!q.asleep);
    this.whoBox.hidden = false;
    const box = this.view.getBoundingClientRect();
    this.whoBox.style.left = `${Math.min(Math.max(8, box.width - 232), Math.max(8, left + 14))}px`;
    this.whoBox.style.top = `${Math.min(Math.max(8, box.height - 230), Math.max(8, top + 10))}px`;
    this.tip.hidden = true;
    this.onPerson?.(q.id, 'select');
    return true;
  }

  /** Everybody else, to an admin: a dot each that points the way they face, their name, and (asked for) their trail and a ring. */
  private drawPeople(g: CanvasRenderingContext2D, sx: (wx: number) => number, sy: (wz: number) => number, W: number, Hh: number, u: number, k: number) {
    const A = this.adm, r = A.dot * u, now = performance.now() / 1000;
    const on = (px: number, py: number, m: number) => px > -m && py > -m && px < W + m && py < Hh + m;
    const picked = this.sel ? this.people.find((q) => q.id === this.sel && this.seen(q)) : undefined;
    // a ring of so many metres: round the admin, and round whoever is picked
    if (A.ring) {
      g.lineWidth = 1.6 * u;
      g.setLineDash([6 * u, 5 * u]);
      for (const c of [this.me, ...(picked ? [picked] : [])]) {
        const px = sx(c.x), py = sy(c.z), rr = A.ring * k;
        if (!on(px, py, rr)) continue;
        g.strokeStyle = c === this.me ? 'rgba(170, 40, 24, 0.85)' : 'rgba(31, 95, 208, 0.9)';
        g.beginPath();
        g.arc(px, py, rr, 0, Math.PI * 2);
        g.stroke();
      }
      g.setLineDash([]);
    }
    // where each has been in the last minute: a line that fades toward its old end
    if (A.trail) {
      g.lineCap = g.lineJoin = 'round';
      g.lineWidth = Math.max(1.5 * u, r * 0.5);
      for (const q of this.people) {
        const t = q.id === undefined || !this.seen(q) ? undefined : this.trails.get(q.id);
        if (!t || t.length < 1) continue;
        const pts = [...t, { x: q.x, z: q.z, at: now }];
        for (let i = 1; i < pts.length; i++) {
          const age = (now - pts[i].at) / TRAIL_S;
          g.strokeStyle = `rgba(${q.staff ? '122, 63, 208' : '31, 95, 208'}, ${(0.75 * (1 - Math.min(1, age))).toFixed(2)})`;
          g.beginPath();
          g.moveTo(sx(pts[i - 1].x), sy(pts[i - 1].z));
          g.lineTo(sx(pts[i].x), sy(pts[i].z));
          g.stroke();
        }
      }
    }
    // (a pale name wants a dark edge to be read on paper, and a dark one a pale edge)
    const ink = A.colour, light = (parseInt(ink.slice(1, 3), 16) * 0.299 + parseInt(ink.slice(3, 5), 16) * 0.587 + parseInt(ink.slice(5, 7), 16) * 0.114) / 255 > 0.6;
    g.font = `600 ${Math.round(A.size * u)}px 'Barlow Condensed', 'Bahnschrift', sans-serif`;
    g.textAlign = 'left';
    g.lineJoin = 'round';
    for (const q of this.people) {
      if (!this.seen(q)) continue;
      const px = sx(q.x), py = sy(q.z);
      if (!on(px, py, 80 * u)) continue;
      g.globalAlpha = q.faint && !q.asleep ? 0.6 : 1;
      const colour = q.dead ? DOT.dead : q.asleep ? DOT.asleep : q.away ? DOT.away : q.staff ? DOT.staff : DOT.player;
      if (q.id !== undefined && q.id === this.sel) {
        g.beginPath();
        g.arc(px, py, r + 5 * u, 0, Math.PI * 2);
        g.lineWidth = 2.5 * u;
        g.strokeStyle = '#ffd24a';
        g.stroke();
        g.lineWidth = 1 * u;
        g.strokeStyle = INK;
        g.stroke();
      }
      if (q.dead) {
        // the dead: a cross where they lie
        for (const [w, s] of [[4.2 * u, '#fff8e0'], [2 * u, colour]] as [number, string][]) {
          g.lineWidth = w;
          g.strokeStyle = s;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(px - r, py - r);
          g.lineTo(px + r, py + r);
          g.moveTo(px + r, py - r);
          g.lineTo(px - r, py + r);
          g.stroke();
        }
      } else {
        if (A.facing && q.yaw !== undefined && !q.asleep) {
          // the way they face: a point on the dot (the same turn as the admin's own arrow)
          g.save();
          g.translate(px, py);
          g.rotate(-q.yaw);
          g.beginPath();
          g.moveTo(0, -r * 2.3);
          g.lineTo(r * 0.85, -r * 0.5);
          g.lineTo(-r * 0.85, -r * 0.5);
          g.closePath();
          g.lineWidth = 2 * u;
          g.strokeStyle = '#fff8e0';
          g.stroke();
          g.fillStyle = colour;
          g.fill();
          g.restore();
        }
        g.beginPath();
        g.arc(px, py, r, 0, Math.PI * 2);
        if (q.asleep) {
          // a body left behind: a hollow dot (pale within, its colour round it, and a pale edge to be seen on a dark ground)
          g.fillStyle = '#fff8e0';
          g.fill();
          g.lineWidth = 4.4 * u;
          g.strokeStyle = '#fff8e0';
          g.stroke();
          g.lineWidth = 2 * u;
          g.strokeStyle = colour;
          g.stroke();
        } else {
          g.lineWidth = 2.4 * u;
          g.strokeStyle = '#fff8e0';
          g.stroke();
          g.fillStyle = colour;
          g.fill();
        }
      }
      if (A.names) {
        const more = `${q.dead ? ' (dead)' : q.asleep ? ' (body left)' : q.away ? ' (tabbed out)' : ''}${A.hp && !q.dead && q.hp !== undefined ? `  ${Math.round(q.hp)}` : ''}${A.flags && q.flags ? `  ${q.flags} flag${q.flags === 1 ? '' : 's'}` : ''}`;
        const tx = px + r + 4 * u, ty = py + A.size * u * 0.34;
        g.lineWidth = Math.max(2, A.size * u * 0.26);
        g.strokeStyle = light ? 'rgba(20, 18, 12, 0.9)' : 'rgba(226, 221, 200, 0.92)';
        g.strokeText(q.name + more, tx, ty);
        g.fillStyle = q.dead || q.asleep ? (light ? '#c9c6ba' : '#55554e') : ink;
        g.fillText(q.name + more, tx, ty);
      }
      g.globalAlpha = 1;
    }
  }
  /** a place on the sheet right-clicked (an admin goes there): null, and a right-click is nothing */
  onPick: ((x: number, z: number) => void) | null = null;
  private sheet: Sheet[] | null = null;
  /** pixels of the sheet to a metre: finer on a computer, which has the memory for it and looks closer */
  private S = TOUCH ? 1 : 2;
  private view: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tip: HTMLElement;
  private key: HTMLElement;
  private zoom = 1;
  private at: Pt = { x: 0, z: 0 };
  private me = { x: 0, z: 0, yaw: 0 };
  private dirty = true;
  private shown: Shown = { tiers: [...TIER_IDS], names: true, wells: true, cars: true, grid: true };
  /** fingers (or the mouse button) down on it, and how far apart two of them were */
  private down = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private dragged = 0;

  private held: Held[] = [];

  constructor(
    private world: World,
    points: { x: number; z: number; tier?: Tier; usage: string[]; building: string }[],
    private spots: MenuSpot[],
    private gases: GasZone[],
    private live: () => MapLive,
  ) {
    // every building, with the step its places are on (most of them) and the kinds of thing they are for
    const inside = new Map<string, typeof points>();
    for (const q of points) inside.set(q.building, [...(inside.get(q.building) ?? []), q]);
    const most = <T,>(list: T[]) => {
      const n = new Map<T, number>();
      for (const v of list) n.set(v, (n.get(v) ?? 0) + 1);
      return [...n].sort((a, b) => b[1] - a[1]).map(([v]) => v);
    };
    const kinds = (list: typeof points) => most(list.flatMap((q) => q.usage.map((u) => KIND[u]).filter(Boolean)));
    for (const b of world.buildings) {
      const list = inside.get(b.id);
      if (!list?.length) continue;
      inside.delete(b.id);
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      this.held.push({ name: CALLED[b.type] ?? 'Building', x: b.x, z: b.z, rot: b.rot, w, d, tier: most(list.map((q) => q.tier ?? 1))[0], kinds: kinds(list), gas: list.some((q) => q.usage.includes('Gas')) });
    }
    // (The fort is no building of the sheet's either, and was marked with the bunker: seventy places of it counted
    // into the bunker's box, and nothing on the map where the fort stands. It is its own mark, and of the fourth
    // step whatever each room of it is: 2026-10-13, "castle is T4 loot and needs to render that color on the map".
    // As wide as its places within the walls lie.)
    const fort = inside.get('castle');
    if (fort?.length && world.castle) {
      inside.delete('castle');
      const C = world.castle, off = fort.filter((q) => (q.tier ?? 1) >= 3).map((q) => Math.hypot(q.x - C.x, q.z - C.z)).sort((m, n) => m - n);
      const wide = Math.min(90, Math.max(30, 2 * (off[Math.floor(off.length * 0.9)] ?? 15) + 6));
      const named = spots.find((q) => q.x === C.x && q.z === C.z)?.name ?? 'The fort';
      this.held.push({ name: named, x: C.x, z: C.z, rot: C.rot, w: wide, d: wide, tier: 4, kinds: kinds(fort), gas: false });
    }
    // (and a wreck with things about it: each where it lies)
    const wrecks = inside.get('wreck');
    if (wrecks?.length) {
      inside.delete('wreck');
      const groups: (typeof points)[] = [];
      for (const q of wrecks) {
        const g = groups.find((list) => Math.hypot(list[0].x - q.x, list[0].z - q.z) < 40);
        if (g) g.push(q);
        else groups.push([q]);
      }
      for (const g of groups) {
        const x = g.reduce((m, q) => m + q.x, 0) / g.length, z = g.reduce((m, q) => m + q.z, 0) / g.length;
        this.held.push({ name: 'A wreck', x, z, rot: 0, w: 9, d: 9, tier: most(g.map((q) => q.tier ?? 1))[0], kinds: kinds(g), gas: false });
      }
    }
    // (and what is in no building on the sheet, which is the bunker under its hill: marked where its way in is)
    const rest = [...inside.values()].flat();
    if (rest.length) {
      const tier = most(rest.map((q) => q.tier ?? 1))[0], at = spots.find((q) => q.tier === tier && q.label) ?? { x: rest[0].x, z: rest[0].z, name: 'Bunker' };
      this.held.push({ name: at.name, x: at.x, z: at.z, rot: 0, w: 14, d: 14, tier, kinds: kinds(rest), gas: false });
    }
    try {
      const was = JSON.parse(localStorage.getItem(KEPT) ?? 'null') as Partial<Shown> | null;
      if (was && Array.isArray(was.tiers)) this.shown = { ...this.shown, ...was, tiers: was.tiers.filter((t) => TIER_IDS.includes(t)) };
    } catch {
      /* nothing kept: everything shown */
    }
    this.root = document.createElement('div');
    this.root.className = 'hud-map';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="hm-sheet">
        <div class="hm-bar">
          <div class="hm-title"><b>ZONA</b><span>SHEET 1 · GRID ${GRID} M · CONTOURS ${CONTOUR} M</span></div>
          <div class="hm-tiers">${TIER_IDS.map((t) => `<button type="button" data-tier="${t}" style="--c:${TIERS[t].colour}"><i></i><span class="hm-long">Tier&nbsp;</span><span class="hm-short">T</span>${t}</button>`).join('')}</div>
          <div class="hm-show">
            <button type="button" data-show="names">Names</button>
            <button type="button" data-show="wells">Wells</button>
            <button type="button" data-show="cars">Cars</button>
            <button type="button" data-show="grid">Grid</button>
          </div>
          <div class="hm-zoom">
            <button type="button" data-zoom="-1" aria-label="Further off">−</button>
            <button type="button" data-zoom="1" aria-label="Nearer">+</button>
            <button type="button" data-zoom="0" aria-label="Where I am">Me</button>
          </div>
          <button type="button" class="hm-x" aria-label="Close the map">✕</button>
        </div>
        <div class="hm-view"><canvas></canvas><div class="hm-tip" hidden></div></div>
        <div class="hm-key"></div>
      </div>`;
    this.view = this.root.querySelector('canvas')!;
    this.g = this.view.getContext('2d')!;
    this.tip = this.root.querySelector('.hm-tip')!;
    this.key = this.root.querySelector('.hm-key')!;
    this.say(null);
    this.marks();
    this.buildAdmin(this.root.querySelector<HTMLElement>('.hm-view')!);

    this.root.querySelector('.hm-x')!.addEventListener('click', () => this.onClose());
    // (a press on the dark round the sheet is a way out too)
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.onClose();
    });
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-tier]')) {
      const t = Number(b.dataset.tier) as Tier;
      b.addEventListener('click', () => {
        this.shown.tiers = this.shown.tiers.includes(t) ? this.shown.tiers.filter((q) => q !== t) : [...this.shown.tiers, t];
        this.keep();
        this.say(t);
      });
      b.addEventListener('pointerenter', () => this.say(t));
      b.addEventListener('pointerleave', () => this.say(null));
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-show]')) {
      b.addEventListener('click', () => {
        const k = b.dataset.show as 'names' | 'wells' | 'cars' | 'grid';
        this.shown[k] = !this.shown[k];
        this.keep();
      });
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
      b.addEventListener('click', () => {
        const d = Number(b.dataset.zoom);
        if (d) this.nearer(d > 0 ? 1.6 : 1 / 1.6);
        else {
          this.at = { x: this.me.x, z: this.me.z };
          if (this.zoom < 2.5) this.zoom = 2.5;
          this.clamp();
        }
      });
    }

    const v = this.view;
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = v.getBoundingClientRect();
      this.nearer(e.deltaY < 0 ? 1.25 : 1 / 1.25, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }, { passive: false });
    v.addEventListener('pointerdown', (e) => {
      try {
        v.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that is already gone */
      }
      this.down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragged = 0;
      this.pinch = 0;
    });
    v.addEventListener('pointermove', (e) => {
      const was = this.down.get(e.pointerId), r = v.getBoundingClientRect();
      if (this.admin && this.adm.open) this.sayAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      if (!was) return void this.point((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX - r.left, e.clientY - r.top);
      const k = this.perMetre() * (r.width / v.width);
      if (this.down.size === 1) {
        // one finger, or the mouse held down: the sheet goes with it
        this.at.x -= (e.clientX - was.x) / k;
        this.at.z -= (e.clientY - was.y) / k;
        this.dragged += Math.abs(e.clientX - was.x) + Math.abs(e.clientY - was.y);
        // (and the short list that was open on a dot is put away: the dot is no longer under it)
        if (this.dragged >= 6) this.whoBox.hidden = true;
      }
      was.x = e.clientX;
      was.y = e.clientY;
      if (this.down.size === 2) {
        // two fingers: nearer as they part, about the point between them
        const [a, b] = [...this.down.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0 && d > 0) this.nearer(d / this.pinch, ((a.x + b.x) / 2 - r.left) / r.width, ((a.y + b.y) / 2 - r.top) / r.height);
        this.pinch = d;
        this.dragged = 99;
      }
      this.clamp();
      this.tip.hidden = true;
    });
    const up = (e: PointerEvent) => {
      if (!this.down.delete(e.pointerId)) return;
      this.pinch = 0;
      // (a tap, on a phone: what is tapped says what it is, as a thing pointed at does)
      const r = v.getBoundingClientRect();
      if (this.dragged >= 6 || e.type !== 'pointerup') return;
      // (to an admin, a click on somebody's dot picks them: see `clickPerson`)
      if (e.button === 0 && this.clickPerson((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX - r.left, e.clientY - r.top)) return;
      this.point((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX - r.left, e.clientY - r.top);
    };
    v.addEventListener('pointerup', up);
    v.addEventListener('pointercancel', up);
    v.addEventListener('pointerleave', () => (this.tip.hidden = true));
    v.addEventListener('contextmenu', (e) => {
      if (!this.onPick) return;
      e.preventDefault();
      const r = v.getBoundingClientRect(), k = this.perMetre();
      this.onPick(this.at.x + (((e.clientX - r.left) / r.width - 0.5) * v.width) / k, this.at.z + (((e.clientY - r.top) / r.height - 0.5) * v.height) / k);
    });
    window.addEventListener('resize', () => (this.dirty = true));
  }

  // ------------------------------------------------------------------ opened and shut

  /** @param x,z where the player stands: the sheet opens whole, and is brought near about there */
  show(x: number, z: number) {
    this.open = true;
    this.root.hidden = false;
    this.me.x = x;
    this.me.z = z;
    this.zoom = 1;
    this.at = { x: 0, z: 0 };
    this.down.clear();
    this.tip.hidden = true;
    this.whoBox.hidden = true;
    this.sheet ??= this.print();
    this.press = null;
    this.dirty = true;
  }

  hide() {
    this.open = false;
    this.root.hidden = true;
  }

  private keep() {
    try {
      localStorage.setItem(KEPT, JSON.stringify(this.shown));
    } catch {
      /* a browser that keeps nothing */
    }
    this.marks();
    this.dirty = true;
  }

  /** the buttons say what is switched on */
  private marks() {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-tier]')) b.classList.toggle('on', this.shown.tiers.includes(Number(b.dataset.tier) as Tier));
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-show]')) b.classList.toggle('on', this.shown[b.dataset.show as 'names']);
  }

  /** the line under the sheet: what a step of the map is, or how the sheet is read */
  private say(t: Tier | null) {
    const T = t ? TIERS[t] : null;
    this.key.innerHTML = T
      ? `<b style="color:${T.colour}">${T.name}</b><span>${T.where}.</span>`
      : `<span>A building is outlined in the colour of its tier. ${TOUCH ? 'Tap' : 'Point at'} one for the kind of loot kept there. ${TOUCH ? 'Two fingers bring it nearer, one moves it.' : 'The wheel brings it nearer, a drag moves it.'}</span>`;
  }

  // ------------------------------------------------------------------ where things are on the screen

  /** pixels of the picture to a metre, as near as it is now */
  private perMetre() {
    return (Math.min(this.view.width, this.view.height) / (2 * SQUARE_HALF)) * this.zoom;
  }

  /** how far off it can be put: 1 is the square (the map as it was, where it opens), less the whole world, the ground west of the square in it */
  private farthest() {
    const W = this.view.width, H = this.view.height;
    return Math.min(1, Math.min(W / (WORLD_X1 - WORLD_X0), H / (WORLD_Z1 - WORLD_Z0)) / (Math.min(W, H) / (2 * SQUARE_HALF)));
  }

  /** brought nearer (or further) about a point of the picture, 0..1 each way */
  private nearer(by: number, u = 0.5, w = 0.5) {
    const W = this.view.width, H = this.view.height, k0 = this.perMetre();
    const wx = this.at.x + ((u - 0.5) * W) / k0, wz = this.at.z + ((w - 0.5) * H) / k0;
    this.zoom = Math.min(NEAREST, Math.max(this.farthest(), this.zoom * by));
    this.whoBox.hidden = true;
    const k = this.perMetre();
    this.at.x = wx - ((u - 0.5) * W) / k;
    this.at.z = wz - ((w - 0.5) * H) / k;
    this.clamp();
  }

  /**
   * The sheet is not dragged off the picture: not off the world, and no further than the square would let it (it
   * opens on the square, as it did before the world grew west, and stays put there).
   */
  private clamp() {
    const k = this.perMetre(), halfW = this.view.width / 2 / k, halfH = this.view.height / 2 / k, edge = SQUARE_HALF;
    const keep = (v: number, half: number, lo: number, hi: number) => {
      const was = half >= edge ? [0, 0] : [-edge + half, edge - half];
      if (half >= (hi - lo) / 2) return (lo + hi) / 2;
      return Math.min(Math.max(hi - half, was[1]), Math.max(Math.min(lo + half, was[0]), v));
    };
    this.at.x = keep(this.at.x, halfW, WORLD_X0, WORLD_X1);
    this.at.z = keep(this.at.z, halfH, WORLD_Z0, WORLD_Z1);
    this.dirty = true;
  }

  /** something pointed at (or tapped): the place nearest it, if one is near, says what it is */
  private point(u: number, w: number, left: number, top: number) {
    const W = this.view.width, H = this.view.height, k = this.perMetre();
    const wx = this.at.x + ((u - 0.5) * W) / k, wz = this.at.z + ((w - 0.5) * H) / k;
    // (within a finger's width of it on the screen, whatever that is in metres just now)
    const reach = (TOUCH ? 26 : 16) * (W / Math.max(1, this.view.clientWidth)) / k;
    // a building first: the one the point is in (or all but in), if its tier is being shown
    let house: Held | null = null, near = reach * 0.6;
    for (const h of this.held) {
      if (!this.shown.tiers.includes(h.tier)) continue;
      const dx = wx - h.x, dz = wz - h.z, c = Math.cos(h.rot), sn = Math.sin(h.rot);
      const lx = Math.abs(dx * c - dz * sn) - h.w / 2, lz = Math.abs(dx * sn + dz * c) - h.d / 2, out = Math.max(0, lx, lz);
      if (out < near) {
        near = out;
        house = h;
      }
    }
    // (to an admin, somebody's dot before anything under it: who they are, and how they are)
    const who = this.personAt(wx, wz, reach);
    if (who) {
      const b = document.createElement('b'), i = document.createElement('i'), p = document.createElement('p');
      b.textContent = who.name;
      i.textContent = `${who.id !== undefined ? `#${who.id} · ` : ''}${Math.round(who.x)}, ${Math.round(who.z)} · ${Math.round(Math.hypot(who.x - this.me.x, who.z - this.me.z))} m from you`;
      i.style.color = who.dead ? '#9a9a90' : who.staff ? '#c8a8ff' : '#8fb4ff';
      p.textContent = `${this.stateOf(who) || 'alive'}. Click for what can be done.`;
      this.tip.replaceChildren(b, i, p);
    } else if (house) {
      const T = TIERS[house.tier];
      this.tip.innerHTML = `<b>${house.name}</b><i style="color:${T.colour}">${T.name}</i><p class="finds">${house.kinds.join(' · ') || 'Odds and ends'}</p>${house.gas ? '<p>Under the gas: a mask is needed.</p>' : ''}`;
    } else {
      let best: MenuSpot | null = null, far = reach;
      for (const q of this.spots) {
        if (q.kind === 'spawn') continue;
        const d = Math.hypot(q.x - wx, q.z - wz);
        if (d < far) {
          far = d;
          best = q;
        }
      }
      if (!best) return void (this.tip.hidden = true);
      const T = best.tier ? TIERS[best.tier] : null;
      this.tip.innerHTML = `<b>${best.name}</b>${T ? `<i style="color:${T.colour}">${T.name}</i>` : ''}<p>${best.tip}</p>`;
    }
    this.tip.hidden = false;
    const box = this.view.getBoundingClientRect();
    this.tip.style.left = `${Math.min(box.width - 290, Math.max(8, left + 16))}px`;
    this.tip.style.top = `${Math.min(box.height - 150, Math.max(8, top + 14))}px`;
  }

  // ------------------------------------------------------------------ the sheet, printed once

  /** the sheet as it is being printed ahead of the first time it is asked for (see `ahead`) */
  private press: Generator<void, Sheet[]> | null = null;

  /**
   * The sheet is printed before anybody opens the map, a strip of it in each frame's spare time. Printed whole
   * the first time M was pressed, it was a quarter of a second in which nothing moved (257 and 284 ms measured).
   */
  ahead() {
    if (this.sheet || this.press) return;
    const press = (this.press = this.printing());
    void (async () => {
      for (;;) {
        await breathe();
        // (opened before it was done: it was finished there and then, in `print`)
        if (this.press !== press) return;
        const step = press.next();
        if (!step.done) continue;
        this.sheet = step.value;
        this.press = null;
        this.dirty = true;
        return;
      }
    })();
  }

  /** the sheet whole, now: what is left of it, if it was being printed ahead */
  private print(): Sheet[] {
    const press = this.press ?? this.printing();
    for (;;) {
      const step = press.next();
      if (step.done) return step.value;
    }
  }

  /**
   * The square at the sheet's own fineness, as it was printed before the world grew west; and the ground west of it
   * (ground only, as yet: 2026-10-16) at half that, which is half the memory again and not a third of it.
   */
  private *printing(): Generator<void, Sheet[]> {
    const square = yield* this.printed({ x0: -SQUARE_HALF, z0: -SQUARE_HALF, x1: SQUARE_HALF, z1: SQUARE_HALF, S: this.S });
    const west = yield* this.printed({ x0: WORLD_X0, z0: WORLD_Z0, x1: -SQUARE_HALF, z1: WORLD_Z1, S: this.S / 2 });
    return [west, square];
  }

  private *printed(a: Area): Generator<void, Sheet> {
    const world = this.world, S = a.S, NW = Math.round((a.x1 - a.x0) * S), NH = Math.round((a.z1 - a.z0) * S);
    const c = document.createElement('canvas');
    c.width = NW;
    c.height = NH;
    const g = c.getContext('2d')!;
    const img = g.createImageData(NW, NH), D = img.data;
    // (the samples of the world's net the part covers: `nx` across from column `ox`, `nz` down from row `oz`)
    const H = world.heights, R = WORLD_NX, ox = (a.x0 - WORLD_X0) / CELL, oz = (a.z0 - WORLD_Z0) / CELL, nx = (a.x1 - a.x0) / CELL + 1, nz = (a.z1 - a.z0) / CELL + 1;
    // (how high and low the ground goes, read over the square as it always was, so that every part is coloured alike)
    let lo = 1e9, hi = -1e9;
    const side = (2 * SQUARE_HALF) / CELL + 1, sx0 = (-SQUARE_HALF - WORLD_X0) / CELL, sz0 = (-SQUARE_HALF - WORLD_Z0) / CELL;
    for (let i = 0; i < side * side; i += 5) {
      const h = H[(sz0 + Math.floor(i / side)) * R + sx0 + (i % side)];
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    // the ground's height under every point of a row of the sheet
    const row = (py: number, out: Float32Array) => {
      const fz = (Math.min(NH - 1, py) / (NH - 1)) * (nz - 1), z0 = Math.min(nz - 2, fz | 0), tz = fz - z0;
      for (let px = 0; px <= NW; px++) {
        const fx = (Math.min(NW - 1, px) / (NW - 1)) * (nx - 1), x0 = Math.min(nx - 2, fx | 0), tx = fx - x0, i = (oz + z0) * R + ox + x0;
        out[px] = (H[i] * (1 - tx) + H[i + 1] * tx) * (1 - tz) + (H[i + R] * (1 - tx) + H[i + R + 1] * tx) * tz;
      }
    };
    let cur = new Float32Array(NW + 1), next = new Float32Array(NW + 1);
    row(0, cur);
    for (let y = 0; y < NH; y++) {
      row(y + 1, next);
      for (let x = 0; x < NW; x++) {
        const h = cur[x], hr = cur[x + 1], hd = next[x];
        // paper, a little lighter where the ground is high, and lit from the north-west so that its shape reads
        const k = (h - lo) / Math.max(1, hi - lo);
        const lit = Math.min(1.1, Math.max(0.8, 1 + (hr - h + (hd - h)) * S * 0.16)) * (0.93 + k * 0.09);
        let r = PAPER[0] * lit, gr = PAPER[1] * lit, b = PAPER[2] * lit;
        // a contour: where the height passes a multiple of five metres between this point and the next
        const a = Math.floor(h / CONTOUR), ar = Math.floor(hr / CONTOUR), ad = Math.floor(hd / CONTOUR);
        if (a !== ar || a !== ad) {
          const level = Math.max(a, ar, ad) * CONTOUR;
          const w = level % (CONTOUR * 5) === 0 ? 0.82 : 0.4;
          r += (132 - r) * w;
          gr += (92 - gr) * w;
          b += (52 - b) * w;
        }
        const i = (y * NW + x) * 4;
        D[i] = r;
        D[i + 1] = gr;
        D[i + 2] = b;
        D[i + 3] = 255;
      }
      const t = cur;
      cur = next;
      next = t;
      // (a strip of sixteen rows put down, and a pause)
      if ((y & 15) === 15 || y === NH - 1) {
        const from = y - (y & 15);
        g.putImageData(img, 0, 0, 0, from, NW, y - from + 1);
        yield;
      }
    }
    const X = (wx: number) => (wx - a.x0) * S, Y = (wz: number) => (wz - a.z0) * S;
    // the woods: green, deeper where the trees stand close
    g.fillStyle = 'rgba(92, 132, 66, 0.2)';
    let trees = 0;
    for (const t of world.trees) {
      if (t.kind.startsWith('bush')) continue;
      g.beginPath();
      g.arc(X(t.x), Y(t.z), 3.4 * S, 0, Math.PI * 2);
      g.fill();
      if (++trees % 400 === 0) yield;
    }
    yield;
    // the grid: hundred-metre squares
    g.strokeStyle = 'rgba(36, 58, 92, 0.3)';
    g.lineWidth = Math.max(1, S * 0.5);
    // (laid from the square's corner, wherever the part is: one grid the world over)
    const gx = (((-SQUARE_HALF - a.x0) % GRID) + GRID) % GRID, gz = (((-SQUARE_HALF - a.z0) % GRID) + GRID) % GRID;
    for (let m = gx; m <= a.x1 - a.x0; m += GRID) {
      g.beginPath();
      g.moveTo(m * S, 0);
      g.lineTo(m * S, NH);
      g.stroke();
    }
    for (let m = gz; m <= a.z1 - a.z0; m += GRID) {
      g.beginPath();
      g.moveTo(0, m * S);
      g.lineTo(NW, m * S);
      g.stroke();
    }
    // the roads: cased in black, filled the orange of a made road
    g.lineJoin = g.lineCap = 'round';
    for (const [extra, colour] of [[3, INK], [0, '#d9963f']] as [number, string][]) {
      for (const road of [world.road, ...world.roads]) {
        const pts = road.points;
        g.strokeStyle = colour;
        g.lineWidth = (road.width + extra) * S;
        g.beginPath();
        for (let i = 0; i < pts.length; i += 3) {
          if (i === 0) g.moveTo(X(pts[i]), Y(pts[i + 2]));
          else g.lineTo(X(pts[i]), Y(pts[i + 2]));
        }
        g.stroke();
      }
    }
    // the ways that are not roads, each as a map draws what it is (`Way`): a cart track in long strokes, a foot
    // path in a finer broken line, as a way that is walked and not driven (and one few come by, finer still)
    g.strokeStyle = INK;
    for (const path of world.paths) {
      g.lineWidth = (path.driven ? 1.9 : path.faint ? 1.1 : 1.4) * S;
      g.setLineDash(path.driven ? [9 * S, 3 * S] : path.faint ? [2 * S, 4 * S] : [3 * S, 3 * S]);
      g.beginPath();
      path.line.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z))));
      g.stroke();
    }
    g.setLineDash([]);
    yield;
    // every building, by its own footprint
    g.fillStyle = INK;
    for (const b of world.buildings) {
      const [w, d] = BUILDING_FOOTPRINT[b.type];
      g.save();
      g.translate(X(b.x), Y(b.z));
      g.rotate(-b.rot);
      g.fillRect((-w / 2) * S, (-d / 2) * S, w * S, d * S);
      g.restore();
    }
    for (const s of world.solids) {
      g.beginPath();
      g.arc(X(s.x), Y(s.z), Math.max(1.2, s.r) * S, 0, Math.PI * 2);
      g.fill();
    }
    yield;
    // The line round the Zona: tags are earned inside it. It is drawn as a boundary is printed: one thin line
    // the whole way round, and a band of its colour laid along the inside of it, fading inward, which says at
    // any point of it which side is the Zona. (It was a dashed arc for each round the Zona is made of, and read
    // as a row of circles: "i dont like the segmented circles".)
    g.beginPath();
    for (const ring of playEdge()) {
      g.moveTo(X(ring[0].x), Y(ring[0].z));
      for (let i = 1; i < ring.length - 1; i++) g.lineTo(X(ring[i].x), Y(ring[i].z));
      g.closePath();
    }
    // (the band: the same line stroked wider and wider, faintly, with all of it that falls outside cut away)
    g.save();
    g.clip('evenodd');
    g.strokeStyle = 'rgba(150, 38, 28, 0.024)';
    for (let k = 1; k <= 12; k++) {
      g.lineWidth = k * 3 * S;
      g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(150, 38, 28, 0.9)';
    g.lineWidth = 1.4 * S;
    g.stroke();
    return { c, x0: a.x0, z0: a.z0, S };
  }

  // ------------------------------------------------------------------ each frame it is open

  /** @param yaw the way the player faces, radians (0 = north, turning left is positive) */
  update(x: number, z: number, yaw: number) {
    if (!this.open || !this.sheet) return;
    const m = this.me, live = this.live(), now = performance.now() / 1000;
    if (Math.abs(m.x - x) > 0.3 || Math.abs(m.z - z) > 0.3 || Math.abs(m.yaw - yaw) > 0.02) this.dirty = true;
    m.x = x;
    m.z = z;
    m.yaw = yaw;
    const v = this.view, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(2, Math.round(v.clientWidth * dpr)), Hh = Math.max(2, Math.round(v.clientHeight * dpr));
    if (v.width !== W || v.height !== Hh) {
      v.width = W;
      v.height = Hh;
      this.clamp();
    }
    if (!this.dirty && !live.pings.length) return;
    this.dirty = false;
    const g = this.g, k = this.perMetre(), u = dpr;
    const sx = (wx: number) => W / 2 + (wx - this.at.x) * k, sy = (wz: number) => Hh / 2 + (wz - this.at.z) * k;
    const on = (px: number, py: number, r = 0) => px > -r && py > -r && px < W + r && py < Hh + r;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#15170f';
    g.fillRect(0, 0, W, Hh);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    for (const s of this.sheet) {
      g.setTransform(k / s.S, 0, 0, k / s.S, sx(s.x0), sy(s.z0));
      g.drawImage(s.c, 0, 0);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const text = (s: string, px: number, py: number, size: number, colour = INK, weight = 700) => {
      g.font = `${weight} ${Math.round(size * u)}px 'Barlow Condensed', 'Bahnschrift', sans-serif`;
      g.lineWidth = Math.max(2, size * u * 0.26);
      g.strokeStyle = 'rgba(226, 221, 200, 0.92)';
      g.lineJoin = 'round';
      g.strokeText(s, px, py);
      g.fillStyle = colour;
      g.fillText(s, px, py);
    };

    // the gas: the ground it lies on, hatched round
    for (const gas of this.gases) {
      const qx = sx(gas.x), qz = sy(gas.z), qr = gas.r * k;
      if (on(qx, qz, qr)) {
        g.beginPath();
        g.arc(qx, qz, qr, 0, Math.PI * 2);
        g.fillStyle = 'rgba(168, 190, 40, 0.3)';
        g.fill();
        g.setLineDash([7 * u, 5 * u]);
        g.lineWidth = 2 * u;
        g.strokeStyle = 'rgba(96, 112, 10, 0.95)';
        g.stroke();
        g.setLineDash([]);
        g.textAlign = 'center';
        text('GAS · MASK NEEDED', qx, qz + qr + 16 * u, 13, '#5c6a08');
      }
    }

    // what is kept where: each building that has anything in it, outlined in the colour of its step of the map
    if (this.shown.tiers.length) {
      const line = Math.max(2 * u, Math.min(4.5 * u, k * 1.1));
      for (const h of this.held) {
        if (!this.shown.tiers.includes(h.tier)) continue;
        const px = sx(h.x), py = sy(h.z), w = h.w * k, d = h.d * k;
        if (!on(px, py, Math.max(w, d) + line * 2)) continue;
        g.save();
        g.translate(px, py);
        g.rotate(-h.rot);
        // (a dark edge under the colour, so that a pale one is seen on paper; the colour laid over the building too, thinly)
        g.lineJoin = 'miter';
        g.strokeStyle = 'rgba(20, 18, 12, 0.9)';
        g.lineWidth = line + 2 * u;
        g.strokeRect(-w / 2 - line / 2, -d / 2 - line / 2, w + line, d + line);
        g.fillStyle = onPaper(h.tier);
        g.globalAlpha = 0.35;
        g.fillRect(-w / 2, -d / 2, w, d);
        g.globalAlpha = 1;
        g.strokeStyle = onPaper(h.tier);
        g.lineWidth = line;
        g.strokeRect(-w / 2 - line / 2, -d / 2 - line / 2, w + line, d + line);
        g.restore();
      }
    }

    // a well: a drop of water
    if (this.shown.wells) {
      const r = 6.5 * u;
      for (const t of live.wells) {
        const qx = sx(t.x), qz = sy(t.z);
        if (!on(qx, qz, r * 2)) continue;
        g.beginPath();
        g.moveTo(qx, qz - r * 1.5);
        g.bezierCurveTo(qx + r * 1.3, qz - r * 0.1, qx + r, qz + r, qx, qz + r);
        g.bezierCurveTo(qx - r, qz + r, qx - r * 1.3, qz - r * 0.1, qx, qz - r * 1.5);
        g.fillStyle = '#3f8fd0';
        g.fill();
        g.lineWidth = 1.6 * u;
        g.strokeStyle = INK;
        g.stroke();
      }
    }
    // the trader: a coin, where he stands
    for (const t of live.traders) {
      const qx = sx(t.x), qz = sy(t.z), r = 7 * u;
      if (!on(qx, qz, r)) continue;
      g.beginPath();
      g.arc(qx, qz, r, 0, Math.PI * 2);
      g.fillStyle = '#58b983';
      g.fill();
      g.lineWidth = 1.8 * u;
      g.strokeStyle = INK;
      g.stroke();
      g.beginPath();
      g.arc(qx, qz, r * 0.45, 0, Math.PI * 2);
      g.lineWidth = 1.3 * u;
      g.stroke();
    }
    // cars nobody is in: a block with a wheel at each end
    if (this.shown.cars) {
      const h = 4.2 * u;
      for (const j of live.jeeps) {
        const qx = sx(j.x), qz = sy(j.z);
        if (!on(qx, qz, h * 3)) continue;
        g.fillStyle = '#f2ecd6';
        g.strokeStyle = INK;
        g.lineWidth = 1.5 * u;
        g.beginPath();
        g.rect(qx - h * 1.5, qz - h * 0.75, h * 3, h * 1.5);
        g.fill();
        g.stroke();
        g.fillStyle = INK;
        g.beginPath();
        g.arc(qx - h * 0.85, qz + h * 0.85, h * 0.45, 0, Math.PI * 2);
        g.arc(qx + h * 0.85, qz + h * 0.85, h * 0.45, 0, Math.PI * 2);
        g.fill();
      }
    }
    // supply drops and helicopters down: a crate, for as long as it stands
    for (const d of live.drops) {
      const qx = sx(d.x), qz = sy(d.z), h = 7 * u;
      if (!on(qx, qz, h * 2)) continue;
      g.fillStyle = '#f39a2b';
      g.strokeStyle = INK;
      g.lineWidth = 1.8 * u;
      g.beginPath();
      g.rect(qx - h, qz - h * 0.8, h * 2, h * 1.6);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(qx - h, qz - h * 0.25);
      g.lineTo(qx + h, qz - h * 0.25);
      g.moveTo(qx, qz - h * 0.8);
      g.lineTo(qx, qz + h * 0.8);
      g.lineWidth = 1.2 * u;
      g.stroke();
    }
    // whoever carries a tag they took: a ring that beats, as on the corner map
    for (const p of live.pings) {
      const age = now - p.at, beat = (age * 1.4) % 1, qx = sx(p.x), qz = sy(p.z), r0 = 8 * u;
      g.lineWidth = 2.4 * u;
      g.strokeStyle = `rgba(214, 48, 24, ${0.9 * (1 - beat)})`;
      g.beginPath();
      g.arc(qx, qz, r0 * (0.6 + beat * 1.9), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgb(214, 48, 24)';
      g.beginPath();
      g.arc(qx, qz, r0 * 0.6, 0, Math.PI * 2);
      g.fill();
    }

    // the places, by name: the big ones always, the rest once the sheet is brought a little nearer
    if (this.shown.names) {
      g.textAlign = 'center';
      for (const s of this.spots) {
        if (s.kind === 'spawn' || s.kind === 'well') continue;
        if (!s.label && this.zoom < (TOUCH ? 2.6 : 1.5)) continue;
        const px = sx(s.x), py = sy(s.z);
        if (!on(px, py, 80 * u)) continue;
        text(s.name.toUpperCase(), px, py - 9 * u, (s.label ? 15 : 12.5) * (TOUCH ? 0.82 : 1), s.tier && this.shown.tiers.includes(s.tier) ? INK : '#3a372e', s.label ? 700 : 600);
      }
    }

    // the grid's letters and numbers, along the top and down the left of the picture
    if (this.shown.grid) {
      // (along the sheet's own edges where the whole of it is in the picture, and the picture's where it runs off it)
      // (the square's, as it always was: the ground west of it has no letters as yet)
      const half = SQUARE_HALF, x0 = Math.max(0, sx(-half)), x1 = Math.min(W, sx(half)), y0 = Math.max(0, sy(-half)), y1 = Math.min(Hh, sy(half));
      g.fillStyle = 'rgba(21, 23, 15, 0.82)';
      g.fillRect(x0, y0, x1 - x0, 17 * u);
      g.fillRect(x0, y0, 19 * u, y1 - y0);
      g.font = `700 ${Math.round(11 * u)}px 'JetBrains Mono', ui-monospace, monospace`;
      g.fillStyle = '#e9e4d8';
      g.textAlign = 'center';
      for (let i = 0; (i + 0.5) * GRID < 2 * SQUARE_HALF; i++) {
        const mid = -half + (i + 0.5) * GRID, px = sx(mid), py = sy(mid);
        if (px > x0 + 24 * u && px < x1 - 6 * u) g.fillText(String.fromCharCode(65 + i), px, y0 + 12.5 * u);
        if (py > y0 + 24 * u && py < y1 - 6 * u) g.fillText(String(i + 1), x0 + 9.5 * u, py + 4 * u);
      }
    }

    // a scale: a round number of metres, about a hand's width of the picture
    {
      const want = (150 * u) / k, steps = [10, 20, 50, 100, 200, 500], m = steps.reduce((p, q) => (Math.abs(q - want) < Math.abs(p - want) ? q : p)), len = m * k;
      const x1 = W - 18 * u, y1 = Hh - 18 * u;
      g.fillStyle = 'rgba(226, 221, 200, 0.9)';
      g.fillRect(x1 - len - 8 * u, y1 - 20 * u, len + 16 * u, 30 * u);
      g.strokeStyle = INK;
      g.lineWidth = 2 * u;
      g.beginPath();
      g.moveTo(x1 - len, y1 - 6 * u);
      g.lineTo(x1 - len, y1);
      g.lineTo(x1, y1);
      g.lineTo(x1, y1 - 6 * u);
      g.stroke();
      g.textAlign = 'center';
      g.font = `700 ${Math.round(11 * u)}px 'JetBrains Mono', ui-monospace, monospace`;
      g.fillStyle = INK;
      g.fillText(`${m} M`, x1 - len / 2, y1 - 7 * u);
      // and north
      const nx = W - 26 * u, ny = (this.shown.grid ? 17 : 0) * u + 34 * u;
      g.beginPath();
      g.moveTo(nx, ny - 18 * u);
      g.lineTo(nx + 7 * u, ny + 4 * u);
      g.lineTo(nx, ny - 2 * u);
      g.lineTo(nx - 7 * u, ny + 4 * u);
      g.closePath();
      g.fillStyle = INK;
      g.strokeStyle = 'rgba(226, 221, 200, 0.92)';
      g.lineWidth = 2.5 * u;
      g.stroke();
      g.fill();
      text('N', nx, ny + 17 * u, 12);
    }

    // everybody else, to an admin: a dot each, and their name (how, is the admin's to choose: see `drawPeople`)
    if (this.admin && ((this.adm.on && this.people.length) || this.adm.ring)) {
      g.save();
      this.drawPeople(g, sx, sy, W, Hh, u, k);
      g.restore();
    }

    // you: an arrow pointing the way you face
    {
      const s = 11 * u;
      g.save();
      g.translate(sx(x), sy(z));
      g.rotate(-yaw);
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s * 0.62, s * 0.72);
      g.lineTo(0, s * 0.34);
      g.lineTo(-s * 0.62, s * 0.72);
      g.closePath();
      g.lineWidth = 4 * u;
      g.strokeStyle = '#fff8e0';
      g.stroke();
      g.fillStyle = '#d2311b';
      g.fill();
      g.lineWidth = 1.2 * u;
      g.strokeStyle = INK;
      g.stroke();
      g.restore();
    }
  }
}
