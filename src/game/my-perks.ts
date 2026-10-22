// What this player has from the store, as their server says it (S2C 'perks', server/perks.ts): the finishes they may
// put on their guns (Apply in the inventory: server/plates.ts), VIP (a gold dog tag round their neck), and a word to the
// server when they buy so that it looks again (2026-10-22). The server's word, not this page's: a page could say
// anything of itself, and the server checks every Apply against its own.

import { skinFor, type ItemId } from '../../api/_lib/shop-items';

export class MyPerks {
  skins: string[] = [];
  vip = false;
  /** told when what they have changes: the gun in their hands is plated afresh */
  changed: () => void = () => {};

  set(sk: string[], vip: boolean) {
    const before = `${this.skins.join()}|${this.vip}`;
    this.skins = sk;
    this.vip = vip;
    if (`${sk.join()}|${vip}` !== before) this.changed();
  }

  /** their finish for a gun of this id (the shop's item id), if they own one */
  skin(gun: string): ItemId | null {
    return skinFor(this.skins, gun);
  }
}
