// The game: a survivor's gear taken back off their own body at one press (the owner, 2026-10-25: "button on corpse
// small that auto takes everything and fills all equipment and back slots from the body"). The server does it
// (src/sim/reclaim.ts, server/searched.ts `reclaimBody`) and says what this player carries after; this asks, and puts
// that on.

import type { S2C } from '../../net/protocol';
import type { Game } from '../game';

/** how long a press waits for the server's word, saying nothing of the pockets meanwhile (ms) */
const WAIT_MS = 3000;

export const reclaimMethods = {
  /** Everything on their own body, open, asked back: what they carry is said first, so that it is done to that. */
  reclaimGear(this: Game) {
    const st = this.openStash;
    if (!st?.own || !this.online || this.player.dead || performance.now() < this.reclaimUntil) return;
    this.net.send({ t: 'me', inv: this.inv.serialize(), vitals: { ...this.player.vitals } });
    this.net.send({ t: 'reclaim', cid: st.uid });
    this.meT = 0;
    this.meDirty = false;
    this.reclaimUntil = performance.now() + WAIT_MS;
    this.invUI.setStashState('Taking your gear back…');
  },

  /** The server's word: what they carry now, put on in place of what they had; what is in the hands is the very thing it was, left in them. */
  reclaimed(this: Game, m: Extract<S2C, { t: 'reclaimed' }>) {
    this.reclaimUntil = 0;
    if (this.openStash?.uid === m.cid) this.invUI.setStashState('');
    if (this.player.dead) return;
    if (this.use) this.breakOff();
    const held = this.inv.held();
    for (const it of this.inv.load(m.inv)) this.dropItem(it, this.player.pos, 0.8);
    if (held && this.inv.held()?.uid === held.uid) this.inv.slots.held = held;
    this.weapons.validate();
    this.inventoryChanged();
    this.hud.note(m.left ? `Gear taken back: ${m.left} ${m.left === 1 ? 'thing found' : 'things found'} no room and ${m.left === 1 ? 'lies' : 'lie'} on the body` : 'Gear taken back', m.took ? 'good' : 'info');
    if (this.invUI.isOpen) this.invUI.render();
  },
};
