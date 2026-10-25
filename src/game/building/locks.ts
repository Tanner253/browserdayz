// Locks in the game (2026-10-24, base building's fourth step; the rules src/sim/build/locks.ts, the server's side
// server/locks.ts). The owner: "keycode keylocks". A lock in the hands: the left button fits it to the door, gate,
// hatch, box or claim looked at (a code lock on a code chosen first). At a locked thing, F does what it does for
// whoever the lock lets in, and knocks for anybody else; F held is the lock's panel: its code entered, or for whoever
// it lets in, locked or unlocked, its code changed, a key cut, its claim joined or left. Online the server says; alone,
// this game keeps its own locks by the same rules.

import type { Input } from '../../core/input';
import { audio } from '../../core/audio';
import { Keypad } from '../../ui/keypad';
import { LOCK, LOCK_ITEMS, goodCode, lockable, mayPass, mayWorkLock } from '../../sim/build/locks';
import { PIECES } from '../../sim/build/pieces';
import { swings } from '../../sim/build/doors';
import { toWorld, type Base, type Piece } from '../../sim/build/snap';
import type { Bases } from '../../sim/build/bases';
import { makeItem, type ItemInstance } from '../../sim/items';
import type { C2S } from '../../net/protocol';
import type { DoorView } from './doors';
import { doorWord } from './doors';
import type { BoxView } from './boxes';

export interface LockHost {
  input: Input;
  online: () => boolean;
  send: (m: C2S) => void;
  note: (text: string, kind: 'good' | 'warn' | 'info') => void;
  held: () => ItemInstance | null;
  /** who the player is to a base, the numbers of the keys they carry */
  who: () => string;
  keys: () => number[];
  count: (id: string) => number;
  take: (id: string, n: number) => void;
  give: (items: ItemInstance[], gift: string) => void;
  begin: (label: string, dur: number, valid: () => boolean, done: () => void, lost: string) => void;
  /** the lock's panel up (the mouse freed) or put away */
  panel: (open: boolean) => void;
  /** played alone: a wrong code's shock */
  hurt: (n: number) => void;
  /** what is looked at, for a thing taking a while to be still the one looked at */
  looked: () => { base: Base; id: number } | null;
  /** a base's piece changed, played alone (drawn again, its stores and spots made again) */
  changed: (b: Base) => void;
  /** a claim's store opened, and the claim joined or left */
  openClaim: (b: Base) => void;
  joinClaim: (b: Base) => void;
}

/** F held this long is the lock's panel */
const HOLD = 0.6;

const card = (head: string, line: string, keys: string, kbd?: string) => `<span class="bc">${kbd ? `<kbd>${kbd}</kbd>` : ''}<b>${head}</b>${line ? ` ${line}` : ''}<i>${keys}</i></span>`;

/** a knock on a door: three raps on wood; on steel, its own ring three times */
export function knock(at: [number, number, number], metal: boolean, distance = 0) {
  const [x, y, z] = at;
  if (!metal && audio.built('knock', { x, y, z }, 1.1)) return;
  for (let i = 0; i < 3; i++) setTimeout(() => audio.impact(metal ? 'metal' : 'wood', { x, y, z }, distance), i * 170);
}
/** a wrong code: the keypad's refusal, and the shock it gives the hand on it */
export function shocked() {
  audio.built('code_wrong', undefined, 0.8);
  audio.built('shock', undefined, 0.7);
}

export class LockView {
  readonly pad = new Keypad();
  private fT = -1;
  private fDone = false;
  /** played alone: wrong codes tried at each lock, and when it takes one again */
  private tries = new Map<string, { n: number; out: number }>();

  constructor(private h: LockHost, private store: () => Bases, private doors: DoorView, private boxes: BoxView) {
    document.body.appendChild(this.pad.el);
    this.pad.onClose = () => h.panel(false);
  }

  get padOpen() {
    return this.pad.isOpen;
  }

  /**
   * The player looks at a piece (`t`): a lock in the hands is fitted to it; a locked one is worked. What the corner
   * says (null: nothing of a lock's here, and F is the door's, the box's or the claim's own).
   */
  frame(dt: number, ok: boolean, t: { base: Base; id: number } | null): string | null {
    const held = this.h.held(), p = t?.base.pieces.get(t.id);
    if (held && LOCK_ITEMS[held.id]) return this.fitFrame(ok, held, t, p);
    if (!t || !p?.lock) {
      this.fT = -1;
      return null;
    }
    const pass = mayPass(p.lock, this.h.who(), this.h.keys()), input = this.h.input;
    if (ok && input.pressed('KeyF')) {
      this.fT = 0;
      this.fDone = false;
    }
    if (this.fT >= 0) {
      if (input.held('KeyF')) {
        this.fT += dt;
        if (this.fT >= HOLD && !this.fDone) {
          this.fDone = true;
          this.openPanel(t.base, p);
        }
      } else {
        if (!this.fDone && ok) this.tap(t.base, p, pass);
        this.fT = -1;
      }
    }
    const what = swings(p.k) ? `${p.open ? 'Close' : 'Open'} ${doorWord(p.k)}` : `Open ${PIECES[p.k].name.toLowerCase()}`;
    const head = pass ? what : swings(p.k) ? 'Knock' : 'Locked';
    const lock = p.lock.k === 'code' ? 'code lock' : 'key lock';
    return card(head, `<small>${p.lock.on ? 'locked' : 'unlocked'} · ${lock}</small>`, `hold F: ${p.lock.k === 'code' && !pass ? 'enter the code' : 'the lock'}`, 'F');
  }

  /** a lock in the hands, at the piece looked at */
  private fitFrame(ok: boolean, held: ItemInstance, t: { base: Base; id: number } | null, p: Piece | undefined): string {
    const name = held.id === 'code_lock' ? 'code lock' : 'key lock';
    if (!t || !p) return card(`Fit the ${name}`, '', 'look at a door, a gate, a hatch, a box or a claim');
    const why = !lockable(p.k) ? 'That takes no lock' : p.lock ? 'It has a lock already' : !this.store().mayWork(t.base, this.h.who()) ? (t.base.claim ? 'You are not on its claim' : 'It is not yours') : null;
    if (why) return card(PIECES[p.k].name, `<span class="no">${why}</span>`, '');
    if (ok && this.h.input.pressed('Mouse0')) this.fit(t.base, p, held);
    return card(`Fit the ${name}`, `to the ${PIECES[p.k].name.toLowerCase()}`, held.id === 'code_lock' ? 'you choose its code first' : 'its key is yours', 'LMB');
  }

  /** F pressed and let go at a locked thing: what it does for whoever the lock lets in; a knock for anybody else */
  private tap(base: Base, p: Piece, pass: boolean) {
    if (!pass) {
      if (swings(p.k)) {
        if (this.h.online()) this.h.send({ t: 'bknock', b: base.id, p: p.id });
        else knock(toWorld(base, p.x, p.y + 1.2, p.z), (PIECES[p.k].only ?? 1) >= 3);
      }
      return this.h.note('It is locked', 'warn');
    }
    if (swings(p.k)) this.doors.toggle(base, p);
    else if (p.k === 'claim') this.h.openClaim(base);
    else this.boxes.openFor(base.id, p.id);
  }

  // ---- the panel

  private openPanel(base: Base, p: Piece) {
    const l = p.lock!, who = this.h.who(), keys = this.h.keys(), mine = mayWorkLock(l, who, keys);
    const status = `${l.on ? 'Locked' : 'Unlocked'} · ${l.k === 'code' ? `${l.who.length} ${l.who.length === 1 ? 'knows' : 'know'} its code${l.who.includes(who) ? ', you among them' : ''}` : mine ? 'it lets you in' : 'you have no key to it'}`;
    const title = l.k === 'code' ? 'Code lock' : 'Key lock';
    this.h.panel(true);
    if (!mine) {
      if (l.k === 'code') return this.pad.open({ title, status, code: 'Enter its code', onCode: (c) => this.enter(base, p, c) });
      return this.pad.open({ title, status });
    }
    const actions = [{ id: l.on ? 'unlock' : 'lock', label: l.on ? 'Unlock' : 'Lock' }];
    if (l.k === 'code') actions.push({ id: 'recode', label: 'Change the code' });
    else actions.push({ id: 'cut', label: `Cut a key · ${Object.entries(LOCK.cut).map(([k, n]) => `${n} ${k === 'planks' ? 'plank' : k}`).join(', ')}` });
    if (p.k === 'claim' && base.claim) actions.push({ id: 'join', label: base.claim.members.some((m) => m.pid === who) ? 'Leave the claim' : 'Join the claim' });
    this.pad.open({
      title,
      status,
      actions,
      onAction: (id) => {
        if (id === 'lock' || id === 'unlock') this.onOff(base, p, id === 'lock');
        else if (id === 'recode') {
          this.h.panel(true);
          this.pad.open({ title, status: 'Whoever knew the old code will have to be told the new', code: 'A new code', onCode: (c) => this.recode(base, p, c) });
        } else if (id === 'cut') this.cut(base, p);
        else if (id === 'join') this.h.joinClaim(base);
      },
    });
  }

  // ---- what is done: asked of the server online, done here alone

  private fit(base: Base, p: Piece, held: ItemInstance) {
    const go = (code?: string) => {
      const still = () => this.h.held()?.uid === held.uid && this.h.looked()?.id === p.id && this.h.looked()?.base === base;
      this.h.begin(`Fitting the ${held.id === 'code_lock' ? 'code lock' : 'key lock'}`, LOCK.fit, still, () => {
        if (!still()) return;
        const [x, y, z] = toWorld(base, p.x, p.y + 1.2, p.z);
        audio.built('lock_click', { x, y, z }, 0.9);
        if (this.h.online()) return void this.h.send({ t: 'block', b: base.id, p: p.id, u: held.uid, ...(code ? { code } : {}) });
        const k = LOCK_ITEMS[held.id];
        this.h.take(held.id, 1);
        p.lock = { k, on: true, who: [this.h.who()], ...(k === 'code' ? { code } : { key: 1 + Math.floor(Math.random() * 2 ** 30) }) };
        if (k === 'key') this.giveKey(p.lock.key!, 'Its key');
        this.h.changed(base);
      }, 'You stopped: the lock is still in your hands');
    };
    if (held.id !== 'code_lock') return go();
    this.h.panel(true);
    this.pad.open({ title: 'Code lock', status: 'Whoever enters its code may open it', code: 'Choose its code', onCode: (c) => go(c) });
  }

  private enter(base: Base, p: Piece, code: string) {
    if (!goodCode(code)) return;
    if (this.h.online()) return void this.h.send({ t: 'bcode', b: base.id, p: p.id, code });
    const l = p.lock!, key = `${base.id}:${p.id}`, t = this.tries.get(key) ?? { n: 0, out: 0 }, now = performance.now();
    if (now < t.out) return this.h.note(`It takes no code for ${Math.ceil((t.out - now) / 1000)} s`, 'warn');
    if (code === l.code) {
      this.tries.delete(key);
      if (!l.who.includes(this.h.who())) l.who.push(this.h.who());
      this.h.changed(base);
      audio.built('code_ok', undefined, 0.7);
      return this.h.note('The code is right: it lets you in', 'good');
    }
    if (++t.n >= LOCK.tries) {
      t.n = 0;
      t.out = now + LOCK.out;
    }
    this.tries.set(key, t);
    shocked();
    this.h.hurt(LOCK.shock);
    this.h.note(t.out > now ? `Wrong code: it will take none for ${LOCK.out / 1000} s` : 'Wrong code', 'warn');
  }

  private recode(base: Base, p: Piece, code: string) {
    if (!goodCode(code)) return;
    if (this.h.online()) return void this.h.send({ t: 'bcode', b: base.id, p: p.id, code, set: true });
    p.lock!.code = code;
    p.lock!.who = [this.h.who()];
    this.h.changed(base);
    this.h.note('Its code is changed', 'good');
  }

  private onOff(base: Base, p: Piece, on: boolean) {
    // (a key lock's bolt thrown, a code lock's keypad answering)
    const [x, y, z] = toWorld(base, p.x, p.y + 1.2, p.z);
    if (p.lock!.k === 'key') audio.built('lock_click', { x, y, z }, 0.9);
    else audio.built('code_ok', { x, y, z }, 0.5);
    if (this.h.online()) return void this.h.send({ t: 'blockon', b: base.id, p: p.id, on });
    p.lock!.on = on;
    this.h.changed(base);
  }

  private cut(base: Base, p: Piece) {
    const short = Object.entries(LOCK.cut).find(([id, n]) => this.h.count(id) < n);
    if (short) return this.h.note(`A key is cut from ${short[1]} ${short[0] === 'planks' ? 'plank' : short[0]}`, 'warn');
    if (this.h.online()) return void this.h.send({ t: 'bkey', b: base.id, p: p.id });
    for (const [id, n] of Object.entries(LOCK.cut)) this.h.take(id, n);
    this.giveKey(p.lock!.key!, 'A key');
  }

  /** the lock taken off with the hammer `u` (the hammer's wheel), given back */
  unfit(base: Base, p: Piece, hammer: ItemInstance) {
    const l = p.lock;
    if (!l) return;
    if (!mayWorkLock(l, this.h.who(), this.h.keys())) return this.h.note('It is not yours to take off', 'warn');
    const still = () => this.h.held()?.uid === hammer.uid && !!base.pieces.get(p.id)?.lock;
    this.h.begin('Taking the lock off', 2, still, () => {
      if (!still()) return;
      if (this.h.online()) return void this.h.send({ t: 'bunlock', b: base.id, p: p.id, u: hammer.uid });
      delete p.lock;
      this.h.give([makeItem(l.k === 'code' ? 'code_lock' : 'key_lock', 1)], l.k === 'code' ? 'Code Lock' : 'Key Lock');
      this.h.changed(base);
    }, 'You stopped: the lock is on');
  }

  private giveKey(n: number, gift: string) {
    const key = makeItem('key', 1);
    key.key = n;
    this.h.give([key], gift);
  }
}
