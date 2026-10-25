// The game: multiplayer (what the server says, wired to what is done about it; other players, bodies, stashes).
// (Methods of Game cut out of game.ts whole on 2026-10-14, so that they can be read and worked on alone: put back on
// Game.prototype as the file loads. Nothing in them was changed but `this: Game` said as the first parameter.)

import * as THREE from 'three';
import { rejoining, rejoinSoon, reloadPage } from '../../core/leave';
import { physics, SOLID_GROUPS } from '../../core/physics';
import { audio } from '../../core/audio';
import { shown } from '../../core/keys';
import { heightAt } from '../../world/worldgen';
import { ITEMS, GEAR_SLOTS, holds, type ItemInstance } from '../../sim/items';
import { BODY_GRID } from '../../sim/inventory';
import { LAUNCHED, THROWN } from '../../sim/grenades';
import { EMOTE } from '../../sim/emotes';
import { playerName, remoteServer, serverSays } from '../../net/client';
import { type S2C, F_DEAD, type PlayerInfo, type Act, type StashInfo, type CorpseInfo, type StoredItem } from '../../net/protocol';
import { bloodOf, bleedOf } from '../../sim/blood';
import { type Avatar, GEAR_SHOWN, facepiece, DEATH_REST } from '../avatar';
import { lookFor } from '../look';
import { RemotePlayer, CorpseBody } from '../remote';
import { Stash } from '../loot';
import { JEEP } from '../../sim/vehicles';
import { Jeep } from '../vehicle';
import { BACK_SHORT } from '../../ui/updates';
import { renderDoll } from '../../ui/icons';
import { INFECTED, INFECTED_GRID } from '../../sim/infected';
import { cashedTags, setPinned } from '../../ui/rewards';
import type { Game } from '../game';
import { BOUGHT, onBought } from '../../ui/store/account';
import { diffOps, laidIn, type Laid } from '../../sim/box-ops';
import { bodyFor, voiceFor } from '../../sim/survivor';
import { wornKey, sortWorn } from '../survivors';

/** how near a crate is asked what is in it, and how often again while near (peekNear) */
const PEEK_AT = 3.5, PEEK_AGAIN = 8000;

/** what holds things within reach of where somebody stands, if anything does: a crate, a cupboard or a drop is 'hard'; a body, a pack, a stash or a cardboard box 'soft' */
function searched(g: Game, at: THREE.Vector3): 'hard' | 'soft' | null {
  const near = (s: { x: number; y: number; z: number }) => Math.hypot(s.x - at.x, s.z - at.z) < 2.4 && Math.abs(s.y - at.y) < 1.8;
  const crate = g.loot.crates.find(near);
  if (crate) return crate.kind.startsWith('cardboard') ? 'soft' : 'hard';
  if ([...g.drops.values()].some((d) => near(d.stash))) return 'hard';
  if (g.loot.stashes.some((s) => !s.buried && near(s)) || [...g.corpses.values()].some((c) => near(c.stash))) return 'soft';
  return [...g.economy.loot.values()].some((l) => holds(l.item.id) && near(l)) ? 'soft' : null;
}

/**
 * The box to search on a body is where the body lies: behind where they stood if they went over backwards, ahead if
 * they went down on their face, beside it if they folded up. @returns how far ahead and to the left that is
 */
export function searchedAt(stash: Stash, v: number): [number, number] {
  const [ahead, left] = DEATH_REST[v] ?? DEATH_REST[0];
  if (v === 2) stash.trigger(0.6, 0.25, 0.6, -ahead, left);
  else stash.trigger(0.48, 0.25, 0.85, -ahead * 0.56, left);
  return [ahead, left];
}

export const onlineMethods = {
  // ------------------------------------------------------------ multiplayer

  async enterOnline(this: Game, w: Extract<S2C, { t: 'welcome' }>) {
    const { world, buildings } = this.s;
    // (in no party until this server says otherwise: a party is the server's, server/party.ts)
    this.party.set([], w.you);
    // (whether this player's name and wallet are fixed is the server's to say: server/pinned.ts)
    setPinned(w.pinned ?? null);
    // (bought at the store in the last ten minutes: the server is asked to look again, as the store itself asks it
    // when a game is running: src/ui/store/panel.ts)
    try {
      if (Date.now() - Number(localStorage.getItem(BOUGHT) ?? 0) < 10 * 60_000) this.net.send({ t: 'perks' });
    } catch {
      /* no storage: the server looks again within five minutes */
    }
    onBought(() => this.net.send({ t: 'perks' }));
    // the server's hour, from which this game's clock runs on
    if (typeof w.hour === 'number') this.hourBase = { phase: w.hour, at: performance.now() };
    // Nothing of this game's own making is in a server's world: whatever it laid out or packed by itself is taken
    // up before the server's is put down. (Picked up, a thing the server had never heard of was refused, and
    // vanished from the hands: "when i shift click from vicinity into my inventory sometimes the item
    // disappears". And if it was a gun or armour, the player was written down as carrying what "the server never
    // put in the world": nobody had cheated.)
    for (const uid of [...this.economy.loot.keys()]) this.economy.take(uid);
    for (const c of this.loot.crates) {
      c.container.load({ items: [] } as never);
      c.known = false;
      c.emptiedAt = -1;
    }
    for (const l of w.loot) this.economy.inject(l);
    for (const [i, open, swing] of w.doors) buildings.doors[i]?.setOpen(open, swing);
    // (NOT waited for. It was, and a stash's model is fetched when first wanted: so for as long as that took,
    // seconds on a slow line, this game had been welcomed and had not yet done anything below. Whoever had just
    // shot the bot check's range was still where the range had been, four hundred metres up, with its floor
    // gone: falling, and telling the server so, and dead of the fall with everything they carried if the wait was
    // long enough. 2026-10-13: "user complans they spawned 400m in the air ... and lost all their loot". After a
    // restart everybody shoots the range again, so it was everybody's risk. A stash's model comes when it comes,
    // as a body's and a drop's do.)
    for (const s of w.stashes) void this.addRemoteStash(s);
    for (const c of w.corpses) void (c.ride ? this.riders.add(c) : this.addCorpse(c));
    for (const d of w.drops ?? []) void this.addDrop(d);
    // (a helicopter in the air when this game came in: it is where everybody else's game has it)
    for (const f of w.flights ?? []) this.flightBegun(f, true);
    // the fuel drums that are gone at the moment
    this.fuses.length = this.drumsBack.length = 0;
    for (const b of this.s.veg.barrels) b?.setThere(!w.barrels?.includes(b.i));
    for (const [cid, g] of w.racks ?? []) this.racks.show(cid, g);
    this.fires.clear();
    for (const [i, x, y, z] of w.built ?? []) this.fires.add(i, x, y, z, (gx, gz) => heightAt(this.s.world.heights, gx, gz));
    for (const [i, left] of w.fires ?? []) this.fires.set(i, left);
    // the lockers somebody is searching at the moment: their doors stand open
    this.lockers.clear();
    for (const cid of w.ajar ?? []) this.lockers.set(cid, true);
    this.bunker.setOpen(!!w.bunker, true);
    // (the nearest first: bodies are made one at a time, a second or so each as the game comes in, and in the welcome's
    // order the people beside a player back from a lost line were the last of twenty to be seen, twenty seconds on)
    const from = (p: (typeof w.players)[number]) => Math.hypot(p.pose[0] - w.spawn.x, p.pose[2] - w.spawn.z);
    for (const p of [...w.players].sort((a, b) => from(a) - from(b))) void this.addRemote(p);
    this.garage.clear();
    for (const v of w.vehicles ?? []) this.garage.add(v);
    this.garage.bind();
    this.horde.online(w.infected ?? [], w.spawn);
    this.wild.leaveAlone();
    const y = w.spawn.y ?? heightAt(world.heights, w.spawn.x, w.spawn.z);
    this.player.spawn(w.spawn.x, y + 0.05, w.spawn.z, w.spawn.yaw);
    if (w.me) {
      for (const it of this.inv.load(w.me.inv)) this.dropItem(it, this.player.pos, 0.8);
      this.takeVitals(w.me.vitals);
      this.ensureTag(w.me.tag ?? 0);
      this.weapons.validate();
      this.autoHot();
      this.invUI.settle();
    } else this.freshKit();
    this.meDirty = true;
    // the server has not heard what we are wearing yet
    this.gearKey = '\u0000';
    this.syncGear();
    this.backKey = '\u0000';
    this.syncBack();

    const net = this.net;
    // (what hears the server is set up once a page: a second match in the Arena comes in through the same)
    if (!this.netWired) {
      this.netWired = true;
      this.wireNet();
    }
    this.maxPlayers = w.max;
    this.hud.setLive(true);
    this.hud.setNet('Online');
    this.updateOnline();
    // (Every kind of message has somebody to hear it now: what was said since the welcome is heard, in its order.
    // Not in this breath but the next: whoever called this has still to say the game has begun, and what hears a
    // message has only ever heard one in a game that had. What is said meanwhile is kept with the rest.)
    setTimeout(() => net.listen(), 0);
  },

  /**
   * Whatever the Zone's server had put down, taken up (another game played on the page, src/game/modes.ts): as a welcome
   * takes up what was there before it (enterOnline), and with nothing to show for it.
   */
  leaveOnline(this: Game) {
    for (const uid of [...this.economy.loot.keys()]) this.economy.take(uid);
    for (const c of this.loot.crates) {
      c.container.load({ items: [] } as never);
      c.known = false;
      c.emptiedAt = -1;
    }
    for (const d of this.s.buildings.doors) d?.setOpen(false, 1);
    for (const uid of [...this.corpses.keys()]) this.removeCorpse(uid);
    for (const [uid, d] of [...this.drops]) {
      this.drops.delete(uid);
      if (d.wreck) {
        d.wreck.obj.removeFromParent();
        for (const c of d.wreck.solid) physics.world.removeCollider(c as never, false);
      }
    }
    this.stashComing.clear();
    for (const st of [...this.loot.stashes]) this.loot.removeStash(st);
    this.riders.clear();
    this.airdrops.clear();
    this.markDrops();
    for (const b of this.s.veg.barrels) b?.setThere(true);
    this.fires.clear();
    this.lockers.clear();
    this.bunker.setOpen(false, true);
    this.garage.clear();
    this.horde.clear();
    this.wild.clear();
    this.horde.laidAs.clear();
    this.throwing.clear();
    this.party.set([], 0);
    this.hud.setLive(false);
  },

  /**
   * Back in after a line that dropped by itself, on the page as it is: out of the world the server had put down, as a
   * switch to another game does it (Modes.leave), and in again as Deploy goes in, to the body the server kept. The page
   * was loaded again for it, which took two to five minutes on the live log of 2026-10-23, and the body stood in the
   * world all that while: DERREN's was killed 37 s after the line dropped, Xafa's after 4 min 44 s, and both came back
   * to start again (a player, 2026-10-20: "the server just reloads my game out of nowhere and when i get in i spawn
   * fresh"). A server not reached is tried again, more slowly each time, for two minutes before it is said.
   */
  async rejoin(this: Game) {
    // (the word rejoinSoon leaves for a page loaded again is not wanted here: taken, or the next reload went in by itself)
    rejoining();
    this.modes.leave();
    this.hud.showStart(true, false, 'Connection lost: getting you back in…');
    const began = performance.now();
    try {
      for (let wait = 500; ; wait = Math.min(wait * 2, 8000)) {
        const gen = this.joinGen;
        await new Promise((r) => setTimeout(r, wait));
        // (another way in taken meanwhile: Deploy pressed, or another game picked from the menu)
        if (gen !== this.joinGen) return;
        if ((await this.join(performance.now() - began < 120_000 ? 'retry' : 'last')) !== 'unreached') return;
      }
    } catch {
      // (and if the way back in on this page fails, the page is loaded again, as it always used to be)
      reloadPage();
    }
  },

  /** Everything the game does with what the server says, set up once a page (see enterOnline). */
  wireNet(this: Game) {
    const { world, buildings } = this.s;
    const net = this.net;
    const cam = () => this.s.r.camera;
    net.on('join', (m) => {
      void this.addRemote(m.p);
      this.updateOnline();
      // (said to admins only: the owner, 2026-10-18, "remove the "player joined" and "player left" messages that show to all players")
      if (this.role === 'admin') this.hud.feed(`${m.p.name} joined`);
    });
    // (what somebody has from the store: their own, or another player's VIP: src/game/my-perks.ts, RemotePlayer.setVip)
    net.on('store', (m) => this.adminUI.storeGot(m));
    // (somebody's own tag come round their neck, or gone: drawn on them only while it is there, server/worn.ts)
    net.on('tagged', (m) => {
      const r = this.remotes.get(m.id);
      if (!r) return;
      r.tagged = m.on;
      r.wearTag();
    });
    net.on('perks', (m) => (m.id === net.id ? this.perks.set(m.sk, !!m.vip) : this.remotes.get(m.id)?.setVip(!!m.vip)));
    net.on('finish', (m) => this.finished(m.uid, m.f));
    net.on('leave', (m) => {
      const r = this.remotes.get(m.id);
      if (!r) return;
      r.seat = null;
      if (this.role === 'admin') this.hud.feed(`${r.name} left`);
      this.hud.gone = [...this.hud.gone.filter((n) => n !== r.name), r.name].slice(-15);
      r.dispose();
      this.remotes.delete(m.id);
      this.updateOnline();
    });
    net.on('ps', (m) => {
      const now = performance.now();
      for (const s of m.s) {
        const r = this.remotes.get(s[0]);
        if (!r) continue;
        r.push([s[1], s[2], s[3], s[4], s[5], s[6]], now, typeof s[9] === 'number' ? s[9] : undefined);
        r.setWeapon(s[7], s[8], s[10]);
        if (!(s[6] & F_DEAD)) r.seenAlive(now);
        else r.seenDead(now);
      }
    });
    net.on('i+', (m) => this.horde.add(m.b));
    net.on('i-', (m) => this.horde.remove(m.i));
    net.on('iown', (m) => this.horde.own(m.i, m.to));
    net.on('is', (m) => this.horde.states(m.s, performance.now()));
    net.on('esp', (m) => (this.espLoot = this.lootWanted ? m.l : []));
    net.on('aesp', (m) => {
      this.espAnimals = this.animalsWanted ? (m.r ?? []) : [];
      this.espZeds = this.infectedWanted ? (m.z ?? []) : [];
    });
    net.on('tossed', (m) => this.throwing.seen(m.id, m.o, m.v));
    net.on('ihp', (m) => {
      this.horde.hp(m.i, m.dead, m.by, m.zone, m.dir, !!m.melee);
      if (m.body) void this.addCorpse(m.body);
    });
    net.on('iblk', (m) => this.horde.blocked(m.i, m.to));
    // the animals near this player, a hit on one, and gutting one (src/game/animals.ts, server/animals.ts)
    net.on('an', (m) => this.wild.rows(m.r, !!m.all, performance.now()));
    net.on('acall', (m) => this.wild.call(m.c, m.x, m.z));
    net.on('ahp', (m) => {
      const b = this.wild.beasts.get(m.i);
      this.wild.hp(m.i, m.dead);
      if (m.dead && m.by === this.net.id && b) this.hud.note(`${b.name} down${m.zone === 'head' ? ' · headshot' : ''}`, 'good');
    });
    net.on('askin', (m) => this.onSkin(m));
    net.on('shot', (m) => {
      this.weapons.remoteShot(new THREE.Vector3(...m.o), new THREE.Vector3(...m.d), m.w, m.sup, this.remotes.get(m.id)?.muzzle(), this.remotes.get(m.id));
      this.horde.noise(m.o[0], m.o[2], m.sup ? INFECTED.hearQuiet : INFECTED.hearShot, m.o[1]);
      // (nobody shoots and waves at once)
      this.remotes.get(m.id)?.avatar.emote(null);
    });
    net.on('swing', (m) => this.remotes.get(m.id)?.swing());
    net.on('nade', (m) => {
      // (which grenade, and what is left of its fuse, are the server's word: it heard the pin go, and counts from that)
      const id = THROWN[m.w] ? m.w : 'grenade';
      const left = typeof m.f === 'number' && Number.isFinite(m.f) ? THREE.MathUtils.clamp(m.f, 0, THROWN[id].fuse) : THROWN[id].fuse;
      this.grenades.throw(new THREE.Vector3(...m.o), new THREE.Vector3(...m.v), left, false, id);
      // the arm that threw it (one that went off in the hand was not thrown, nor was one that fell from a dead hand: neither is moving)
      if (left > 0 && Math.hypot(...m.v) > 1) this.remotes.get(m.id)?.avatar.swing(true);
    });
    // (a grenade from somebody's launcher: flown here too, and it goes off where it strikes; what it did is that game's to say)
    net.on('launch', (m) => {
      const spec = LAUNCHED[m.w];
      if (spec) this.grenades.throw(new THREE.Vector3(...m.o), new THREE.Vector3(...m.v), spec.flight, false, m.w, true);
    });
    // (hands opened where something that holds things stands are somebody going through it: the server passes on no more than 'open')
    net.on('act', (m) => {
      const r = this.remotes.get(m.id);
      r?.act(m.a, m.d, cam().position, m.a === 'open' ? searched(this, r.pos) : null);
    });
    net.on('emote', (m) => {
      const r = this.remotes.get(m.id), e = EMOTE[m.e];
      if (!r?.alive || !e?.say) return;
      r.call(e, cam().position);
      this.said.set(m.id, { text: e.say, at: performance.now() });
    });
    net.on('boom', (m) => this.blowBarrel(m.i, false));
    net.on('barrel+', (m) => this.s.veg.barrels[m.i]?.setThere(true));
    net.on('fire', (m) => this.fires.set(m.i, m.left));
    net.on('fire+', (m) => this.fires.add(m.i, m.x, m.y, m.z, (x, z) => heightAt(this.s.world.heights, x, z)));
    net.on('fire-', (m) => this.fires.remove(m.i));
    net.on('bunker', (m) => this.bunker.setOpen(m.open));
    net.on('gear', (m) => {
      this.gearOf.set(m.id, m.g);
      if (this.remotes.get(m.id)) void this.wear(this.remotes.get(m.id)!.avatar, m.g);
    });
    net.on('back', (m) => this.remotes.get(m.id)?.avatar.setSlung(this.weapons.slungOf(m.b)));
    net.on('who', (m) => {
      const r = this.remotes.get(m.id);
      if (!r) return;
      r.avatar.wardrobe.setBody(m.bd);
      r.voice = m.vo;
    });
    net.onVoice = (packet) => this.voice.hear(packet);
    net.on('dmg', (m) => this.takeHit(m));
    net.on('hitok', (m) => {
      const h = this.hitsOn.get(m.to) ?? { amount: 0, hits: 0, head: 0 };
      h.amount += m.amount;
      h.hits++;
      if (m.zone === 'head') h.head++;
      this.hitsOn.set(m.to, h);
    });
    net.on('death', (m) => {
      const k = m.k;
      const me = k.id === net.id;
      // (The server says so, and this game had not: it is so. An honest game is always first, because it is the
      // one that knows its own health; this is for the case that it was not, and for nothing else.)
      if (me && !this.player.dead) {
        this.player.vitals.health = 0;
        this.player.lastCause ||= 'your wounds';
        this.player.dead = true;
      }
      const zone = k.zone === 'head' ? ' · headshot' : '';
      const drum = k.w === 'barrel';
      const jeep = k.w === 'jeep' || k.w === 'fire';
      const how = k.by !== null ? `${k.byName} killed ${k.name} · ${ITEMS[k.w]?.name ?? (drum ? 'fuel drum' : k.w === 'fire' ? 'burning wreck' : k.w === 'jeep' ? 'run down' : k.w)}${zone}${k.dist > 3 && !jeep ? ` · ${k.dist} m` : ''}` : `${k.name} died (${k.w})`;
      // (the kill feed is the admins': the owner, 2026-10-18, "the kill feed should only be shown to admins". The killer is
      // still told, below, and whoever died sees how on their death screen)
      if (this.role === 'admin') this.hud.feed(how, k.by === net.id || me);
      if (k.by === net.id) {
        this.weapons.confirmKill();
        this.hud.note(`You killed ${k.name}${zone}${k.dist > 3 ? ` · ${k.dist} m` : ''}`, 'good');
      }
      if (!me) this.remotes.get(k.id)?.avatar.setDeath(k.v ?? 0);
      // (and what you did to them this life, as the server took it, before their armour: the owner, 2026-10-19, "when you
      // die you should be able to see damage done to the player who killed you works for when 2players kill eachother")
      const hits = k.by !== null && k.by !== net.id ? this.hitsOn.get(k.by) : undefined;
      const back = k.by === null || k.by === net.id ? '' : hits ? ` You hit ${k.byName} ${hits.hits === 1 ? 'once' : `${hits.hits} times`}${hits.head ? `, ${hits.head === hits.hits ? (hits.hits === 1 ? 'in the head' : 'all in the head') : `${hits.head} in the head`}` : ''}: ${Math.round(hits.amount)} damage before armour.` : ` You never hit ${k.byName}.`;
      if (me) this.deathInfo = k.by !== null ? `Killed by ${k.byName} with ${drum ? 'a fuel drum' : k.w === 'fire' ? 'a burning wreck' : jeep ? 'the car they were driving' : ITEMS[k.w]?.name ?? 'bare hands'}${zone}.${back} Your body and gear are where you fell.` : `You died of ${k.w}. Your body and gear are where you fell.`;
      else this.remotes.get(k.id)?.setAlive(false);
      // (killed in a helicopter: the body stays sat in it, and the one that fell where they were is not drawn)
      if (m.corpse?.ride) {
        if (!me) this.remotes.get(k.id)?.vanish();
        void this.riders.add(m.corpse);
      } else if (m.corpse) void this.addCorpse(m.corpse);
    });
    net.on('alive', (m) => this.remotes.get(m.id)?.setAlive(true));
    net.on('loot+', (m) => this.economy.inject(m.l));
    net.on('loot-', (m) => {
      // (told of everything taken anywhere on the map: only what the open inventory shows redraws it)
      const shown = this.invUI.isOpen && this.invUI.shows(m.uid);
      this.economy.take(m.uid);
      this.lying.delete(m.uid);
      this.lyingSent.delete(m.uid);
      if (shown) this.invUI.refresh(this.around(), this.openStash);
    });
    net.on('denied', (m) => {
      // someone got there first: hand it back
      const t = this.pendingTakes.get(m.uid);
      if (!t) return;
      this.pendingTakes.delete(m.uid);
      if (this.inv.find((i) => i === t.item)) this.inv.remove(t.item);
      else this.inv.take(t.id, t.qty);
      this.hud.note('That could not be taken: somebody else has it, or it is out of reach', 'warn');
      this.inventoryChanged();
      if (this.invUI.isOpen) this.invUI.render();
    });
    net.on('cdata', (m) => {
      const st = this.findBox(m.cid);
      if (!st) return;
      // (What the server says is in it: what this game's moves are reckoned from. Its answer to this game's own moves
      // is what this game has already, and nothing is laid out again for it.)
      const same = st.known && JSON.stringify(st.container.serialize().items) === JSON.stringify(m.items);
      st.sent = JSON.parse(JSON.stringify(m.items));
      st.known = true;
      if (same) return;
      st.container.load({ items: m.items });
      if (this.openStash === st) this.invUI.setStashState('');
    });
    // Moves of this player's that could not be done (server/searched.ts): what somebody else took first is out of
    // their pockets again, and what found no room in there is back in them (or at their feet).
    net.on('cno', (m) => {
      for (const t of m.took) {
        const it = this.inv.find((i) => i.uid === t.uid);
        if (it && (t.n === undefined || t.n >= it.qty)) this.inv.remove(it);
        else if (it && t.n) it.qty -= t.n;
        else if (t.id) this.inv.take(t.id, t.n ?? 1);
      }
      for (const b of m.back) {
        const { x: _x, y: _y, rot: _r, ...it } = b;
        const left = this.inv.add(it);
        if (left) this.dropItem(left);
      }
      this.hud.note(m.took.length ? 'Somebody else took that first' : 'No room for that in there: it is back with you', 'warn');
      this.inventoryChanged();
    });
    // (what lies within reach that holds things: see openLying)
    const lay = (uid: string, items: StoredItem[]) => {
      const l = this.economy.loot.get(uid);
      if (!l) return null;
      l.item.cargo = items.map(({ x, y, rot, ...it }) => ({ item: it, x, y, rot }));
      return l;
    };
    net.on('ldata', (m) => {
      if (!this.lying.has(m.uid)) return;
      const l = this.economy.loot.get(m.uid);
      const same = !!l && JSON.stringify(laidIn(l.item)) === JSON.stringify(m.items);
      if (!same && !lay(m.uid, m.items)) return;
      this.lying.set(m.uid, 'mine');
      this.lyingSent.set(m.uid, JSON.parse(JSON.stringify(m.items)));
      if (!same && this.invUI.isOpen) this.invUI.refresh(this.around(), this.openStash);
    });
    net.on('lbusy', (m) => {
      if (!this.lying.has(m.uid)) return;
      this.lying.set(m.uid, 'busy');
      if (this.invUI.isOpen) this.invUI.refresh(this.around(), this.openStash);
    });
    net.on('lcargo', (m) => {
      // (as it is now, to everybody: several may go through one at once, server/searched.ts; what this game did is in it)
      const l = this.economy.loot.get(m.uid);
      if (this.lying.get(m.uid) === 'mine') this.lyingSent.set(m.uid, JSON.parse(JSON.stringify(m.items)));
      if (!l || JSON.stringify(laidIn(l.item)) === JSON.stringify(m.items)) return;
      if (lay(m.uid, m.items) && this.invUI.isOpen && this.invUI.shows(m.uid)) this.invUI.refresh(this.around(), this.openStash);
    });
    net.on('cbusy', (m) => {
      if (this.openStash?.uid !== m.cid) return;
      this.hud.note('Someone else is searching that', 'warn');
      this.openStash = null;
      if (this.invUI.isOpen) this.invUI.refresh(this.around(), null);
    });
    net.on('cdoor', (m) => this.lockers.set(m.cid, m.open));
    net.on('rack', (m) => this.racks.show(m.cid, m.g));
    net.on('stash+', (m) => void this.addRemoteStash(m.s));
    net.on('stash-', (m) => {
      // (one whose model is still coming is not stood when it has: see addRemoteStash)
      this.stashComing.delete(m.uid);
      const st = this.loot.stashes.find((s) => s.uid === m.uid);
      if (st) this.loot.removeStash(st);
    });
    net.on('stash~', (m) => {
      const coming = this.stashComing.get(m.uid);
      if (coming) coming.buried = m.buried;
      const st = this.loot.stashes.find((s) => s.uid === m.uid);
      if (!st) return;
      if (this.openStash === st) this.toggleInventory(false);
      st.setBuried(m.buried);
    });
    net.on('corpse-', (m) => {
      this.riders.remove(m.uid);
      this.removeCorpse(m.uid);
    });
    // (down with the helicopter: out of its seat and on the ground beside it, at once, there to be searched)
    net.on('corpse@', (m) => void this.addCorpse(m.corpse, 0).then(() => this.riders.remove(m.corpse.uid)));
    net.on('board', (m) => this.hud.setBoard(m.rows, m.me, m.mine, playerName()));
    net.on('drop+', (m) => void this.addDrop(m.d));
    net.on('heli+', (m) => this.flightBegun(m.f, false, m.f.by === net.id));
    net.on('radio-', (m) => {
      this.radio = null;
      this.hud.note(m.why, 'warn');
    });
    net.on('drop-', (m) => this.removeDrop(m.uid));
    net.on('door', (m) => {
      const d = buildings.doors[m.i];
      if (!d || d.open === m.open) return;
      d.set(m.open, m.swing);
      // (somebody else's door is heard across a yard, not across the map)
      const far = d.pivot.position.distanceTo(cam().position);
      if (far < 28) audio.door(m.open, d.pivot.position, far);
    });
    net.on('spawn', (m) => {
      const p = this.player;
      p.spawn(m.x, heightAt(world.heights, m.x, m.z) + 0.05, m.z, m.yaw);
      this.freshKit();
      this.deathSent = false;
      this.deathInfo = '';
      this.hitsOn.clear();
      this.meDirty = true;
      this.resume();
    });
    net.on('chat', (m) => this.hud.chatLine(m.ch ?? 'global', m.from, m.text, m.role, m.tint, m.elite, { vip: m.vip, cup: m.cup }));
    // everyone carrying a tag they took, shown on the map for a few seconds
    net.on('tags', (m) => {
      const me = m.p.some(([id]) => id === net.id);
      const others = m.p.filter(([id]) => id !== net.id);
      this.minimap.ping(others.map(([, x, z]) => ({ x, z })), me);
      const now = performance.now();
      if (me && now - this.markedSaid > 300_000) {
        this.markedSaid = now;
        this.hud.note('You carry a tag you took: every 30 seconds the map shows everyone where you are', 'warn');
      } else if (others.length && now - this.pingSaid > 300_000) {
        this.pingSaid = now;
        this.hud.note('Someone is carrying a tag: they are marked on the map (M)', 'good');
      }
    });
    // what became of a tag we cashed in (paid, on its way, why not)
    // what the server says to this player alone: a role given or taken, and what came of an order (see `command` in server/index.ts)
    net.on('role', (m) => {
      this.role = m.role;
      this.hud.role = m.role;
      if (m.role) this.hud.chatLine('system', '', `You are ${m.role === 'admin' ? 'an admin' : 'a mod'} here. Press ${shown('Backquote')} for your panel, or / for your orders: they are listed as you type.`);
      // (a place right-clicked on the map is gone to: an admin's alone)
      this.map.onPick = m.role === 'admin' ? (x, z) => {
        this.order(`/tp ${x.toFixed(0)} ${z.toFixed(0)}`);
        this.toggleMap(false);
      } : null;
      if (m.role === 'admin' && this.tint) this.net.send({ t: 'tint', color: this.tint });
      // (and the map is an admin's: everybody's dot on it, the box of settings for them, and what a click on one does)
      this.map.setAdmin(m.role === 'admin');
      this.map.onPerson = m.role === 'admin' ? (id, what) => this.mapPerson(id, what) : null;
      if (m.role !== 'admin') {
        this.toggleFreecam(false);
        this.nightSight = false;
        this.map.setPeople([]);
        if (!m.role) this.toggleAdmin(false);
      }
      this.adminUI.setSelf(this.adminSelf());
    });
    net.on('party', (m) => this.party.set(m.members, this.net.id));
    net.on('partyAsk', (m) => {
      this.party.ask(m.from);
      this.hud.note(`${m.name} asks you to join their party`, 'info');
    });
    net.on('sys', (m) => {
      this.hud.chatLine('system', '', m.text);
      this.adminUI.say(m.text);
      // (what is said in the chat cannot be selected: the answer to /stashes is copied from the admin panel, in one press)
      if (/^\d+ stashes kept/.test(m.text)) this.hud.note('The stash list is ready: open the admin panel (`) and press "Copy the stash list"', 'info');
    });
    net.on('adm', (m) => {
      this.admPlayers = new Map(m.players.map((q) => [q.id, q]));
      this.adminUI.setLists(m);
      void this.drawHeads(m.players);
      // (and an admin's map shows where everybody is)
      this.feedMap();
    });
    net.on('ghost', (m) => this.remotes.get(m.id)?.setGhost(m.on));
    net.on('announce', (m) => {
      this.hud.announce(m.text, m.by);
      this.hud.chatLine('system', '', `${m.by}, to everybody: ${m.text}`);
      this.adminUI.say(`${m.by}, to everybody: ${m.text}`);
    });
    net.on('pm', (m) => {
      this.hud.chatLine('pm', m.from, m.text, m.role);
      this.hud.note(`${m.role === 'admin' ? 'An admin' : 'A mod'} (${m.from}) to you: ${m.text}`, 'warn');
    });
    net.on('powers', (m) => {
      this.powers = { god: m.god, hidden: m.hidden, clip: m.clip, voidInv: m.voidInv, voidTag: m.voidTag, weightless: !!m.weightless, endless: !!m.endless, bottomless: !!m.bottomless };
      this.player.god = m.god;
      // (God mode is proof against every state a body can be in, not only against dying of it: 2026-10-13, an
      // admin with it on: "i am still being choked out by the gas, i should be immune to all status efects in
      // godmode". The gas is not breathed (see the frame loop); and what had hold already when it is switched on,
      // a wound, a broken leg, lets go.)
      if (m.god) {
        this.player.staunch();
        this.player.setLeg(true);
      }
      this.player.setFly(m.clip);
      this.carryPowers();
      this.showPowers();
    });
    net.on('mend', () => {
      this.player.mend();
      this.meDirty = true;
    });
    net.on('kit', (m) => this.kitUp(m));
    net.on('trash', (m) => this.trashed(m.uids, m.by));
    net.on('refill', (m) => this.refilled(m.by));
    net.on('inv', (m) => this.adminUI.setPockets(m));
    // (this game was not answering, and the server kept this life meanwhile: what it makes of it is what it is)
    net.on('hp', (m) => {
      const p = this.player;
      if (p.dead) return;
      p.vitals.health = Math.max(1, Math.min(100, m.health));
      // (and the blood it made of it: no more than this game had, and whatever wounds it counted beyond this game's)
      p.vitals.blood = Math.min(p.vitals.blood, bloodOf(m));
      const more = (m.bleeding ? bleedOf(m) : 0) - p.vitals.bleed;
      if (more > 0) p.bleed(more);
      this.meDirty = true;
    });
    net.on('logout', (m) => {
      this.hud.setLogout(m.left);
      if (m.left) this.hud.note(`Logging out in ${m.left} seconds: stay where you are`, 'info');
      else if (m.why) this.hud.note(`You are staying in the game: ${m.why}`, 'warn');
    });
    // set down somewhere by an admin (by themselves, or by another): with no height given, on top of whatever is there
    net.on('put', (m) => {
      const p = this.player;
      if (p.dead || this.garage.ride) return;
      let y = m.y;
      if (y === undefined) {
        const ground = heightAt(world.heights, m.x, m.z);
        const roof = physics.raycast({ x: m.x, y: ground + 90, z: m.z }, { x: 0, y: -1, z: 0 }, 90, SOLID_GROUPS);
        y = Math.max(ground, roof ? roof.point.y : ground);
      }
      const pitch = p.pitch;
      // (the arena faces a body set down for a round toward the other end; anybody else keeps their own way)
      p.spawn(m.x, y + 0.1, m.z, m.yaw ?? p.yaw);
      p.pitch = m.yaw === undefined ? pitch : 0;
      p.landSoft();
      this.buriedT = 0;
      if (m.by) this.hud.note(`${m.by}, an admin, has moved you`, 'warn');
    });
    net.on('tell', (m) => {
      this.hud.note(m.text, m.kind);
      this.hud.chatLine('system', '', m.text);
    });
    net.on('pinned', (m) => {
      setPinned(m.pin);
      if (m.pin) this.hud.note(`Your name${m.pin.wallet ? ' and payout wallet are' : ' is'} now fixed. An admin can let you change ${m.pin.wallet ? 'them' : 'it'}.`, 'info');
    });
    // (the arena's: the score and the kills, for its own screen)
    net.on('score', (m) => this.arenaHud?.score(m));
    net.on('kill', (m) => this.arenaHud?.kill(m));
    net.on('void', (m) => this.voidTags(m.uids));
    net.on('cashed', (m) => {
      const text = `${m.name} cashed in ${m.owner}'s dog tag.`;
      this.hud.chatLine('system', '', text);
      this.hud.feed(text, m.id === net.id);
      if (m.id === net.id) {
        this.hud.chatLine('system', '', `That is ${cashedTags()} cashed in so far.`);
        // (and the one moment the treasury is on a player's mind: what fills it, and what they can do for it)
        this.hud.chatLine('system', '', `${BACK_SHORT} Like and repost ZONA on X: the link is on the menu.`);
      }
    });
    // The server says it is about to restart (an update is going on, or it has been told to stop): said across the
    // top, and when the connection then goes, the game waits for the server that comes after and loads itself
    // again when that one answers. (Whoever was on is kept as they were: they have only to press Play.)
    net.on('restart', (m) => {
      this.restartSaid = { why: m.why || this.restartSaid?.why || '', at: performance.now() };
      this.hud.restarting(this.restartSaid.why, m.in);
    });
    net.onClose = (reason) => {
      // (left by this player, from the Arena's menu: nothing to show, they are back at it already)
      if (this.arenaLeaving) return void (this.arenaLeaving = false);
      // (a wager over, or the arena gone: its result and where to go on to, up before the mouse is let go, so that
      // its going is not taken for a pause; and any pause that was open put away, under the card)
      if (this.br) {
        this.br.closed(reason);
        this.paused = true;
        this.hud.showStart(false);
        this.input.unlock();
        return;
      }
      if (this.arenaHud) {
        this.arenaHud.closed(reason);
        this.paused = true;
        this.hud.showStart(false);
        this.input.unlock();
        return;
      }
      this.paused = true;
      this.input.unlock();
      const said = this.restartSaid && performance.now() - this.restartSaid.at < 180_000 ? this.restartSaid : null;
      if (!said || this.net.refused) {
        // (dropped by itself, not ended by the server: straight back in, see rejoin and rejoinSoon)
        if (!said && !this.net.refused && reason === 'Connection to the server was lost.' && !this.player.dead && rejoinSoon()) return void this.rejoin();
        return void this.hud.fatal(reason);
      }
      this.hud.fatal(`The server is restarting${said.why ? ` (${said.why})` : ''}. You are kept as you were. This page loads again by itself when the server is back.`);
      const remote = remoteServer() ?? location.origin, began = performance.now();
      const look = async () => {
        // (a server that answers, and has not been running for long: the one that came after)
        try {
          const j = await serverSays<{ uptime?: number }>(remote, 8000);
          if (j && typeof j.uptime === 'number' && (j.uptime < 240 || performance.now() - began > 150_000)) return void reloadPage();
        } catch {
          /* not there yet */
        }
        if (performance.now() - began < 600_000) window.setTimeout(look, 4000);
      };
      window.setTimeout(look, 6000);
    };
  },

  /**
   * What lies within reach on the ground, for the open pockets to show. From a jeep's seat
   * that is nothing: whatever is wanted from the ground, a body or a crate is got out for.
   */
  around(this: Game) {
    return this.garage.ride ? [] : this.loot.near(this.player.pos, 2.3);
  },

  /**
   * What lies within reach that holds things (a pack, a vest, a jacket, a case) is gone through with the pockets, each
   * shown open as what is worn is (the owner, 2026-10-15: "all inventories should be shown in vicinity pane when items
   * are on the ground"). Each is gone through at once, what is in it known already, by as many as like (on a server
   * each is told it is open ('lopen'), and what is done in it is told move by move: server/searched.ts).
   */
  openLying(this: Game) {
    const want = this.around().filter((w) => holds(w.loot.item.id)).map((w) => w.loot.uid);
    const ask = want.filter((uid) => !this.lying.has(uid));
    if (!ask.length) return;
    for (const uid of ask) {
      this.lying.set(uid, 'mine');
      const l = this.economy.loot.get(uid);
      if (l) this.lyingSent.set(uid, JSON.parse(JSON.stringify(laidIn(l.item))));
    }
    if (this.online) this.net.send({ t: 'lopen', uids: ask });
  },

  /** the pockets shut: what was gone through is told as it is now, and let go of */
  closeLying(this: Game) {
    if (this.online && this.lying.size) {
      this.syncLying();
      this.net.send({ t: 'lclose' });
    }
    this.lying.clear();
    this.lyingSent.clear();
  },

  /** what this player has done in what lies about is told to the server, move by move, from what it last said is in it */
  syncLying(this: Game) {
    if (!this.online) return;
    for (const [uid, st] of this.lying) {
      if (st !== 'mine') continue;
      const l = this.economy.loot.get(uid);
      if (!l) continue;
      const now = laidIn(l.item);
      const ops = diffOps((this.lyingSent.get(uid) ?? []) as Laid[], now);
      if (!ops.length) continue;
      this.lyingSent.set(uid, JSON.parse(JSON.stringify(now)));
      this.net.send({ t: 'lops', uid, ops });
    }
  },

  /**
   * What is in the crates, bodies, stashes and drops within a few steps, asked for on the way to them (2026-10-23, the
   * owner's list: "Opening…"), so that what is in one is shown the moment it is opened. Each again after a while,
   * while the pockets are shut; nothing is opened or held by it (server 'cpeek').
   */
  peekNear(this: Game) {
    if (!this.online || this.invUI.isOpen || this.garage.ride) return;
    const p = this.player.pos, now = performance.now();
    const near = [...this.loot.stashes.filter((q) => !q.buried), ...this.loot.crates, ...[...this.corpses.values()].map((c) => c.stash), ...[...this.drops.values()].map((d) => d.stash)];
    for (const s of near) {
      if (!s || Math.hypot(s.x - p.x, s.z - p.z) > PEEK_AT || Math.abs(s.y - p.y) > 2.5) continue;
      if (now - (this.peekedAt.get(s.uid) ?? -1e9) < PEEK_AGAIN) continue;
      this.peekedAt.set(s.uid, now);
      this.net.send({ t: 'cpeek', cid: s.uid });
    }
  },

  /** playing alone: the training dummies a jeep driven here has just gone into */
  bumpDummies(this: Game, at: THREE.Vector3, half: THREE.Vector3, quat: THREE.Quaternion, speed: number) {
    const inv = quat.clone().invert();
    const rel = new THREE.Vector3();
    // the infected in the way of it (alone or not: on a server the server is told, and decides)
    for (const b of this.horde.all.values()) {
      if (b.dead || !b.ready) continue;
      rel.copy(b.pos).sub(at).applyQuaternion(inv);
      if (Math.abs(rel.x) > half.x || Math.abs(rel.z) > half.z || rel.y > 0.6 || rel.y < -2.6) continue;
      const chest = new THREE.Vector3(b.pos.x, b.pos.y + 1.2, b.pos.z);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      this.effects.bleed(chest, dir, 0.8);
      if (b.damage(Math.max(0, speed - JEEP.bumpFrom) * JEEP.bumpPer, chest, dir, 'torso')) this.hud.note('Infected down · run down', 'good');
      if (this.online) this.net.send({ t: 'ihit', i: b.i, zone: 'torso', w: 'jeep', dist: Math.round(speed * 10) / 10, sup: false, bonus: 0 });
    }
    // and the animals (2026-10-24: "all damage should work")
    for (const a of this.wild.beasts.values()) {
      if (a.dead || a.gone) continue;
      rel.set(a.x, a.root.position.y, a.z).sub(at).applyQuaternion(inv);
      if (Math.abs(rel.x) > half.x + a.kind.len * 0.3 || Math.abs(rel.z) > half.z + a.kind.len * 0.3 || rel.y > 0.6 || rel.y < -2.6) continue;
      const chest = new THREE.Vector3(a.x, a.root.position.y + a.kind.tall * 0.6, a.z), dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      this.effects.bleed(chest, dir, 0.8);
      if (this.online) this.net.send({ t: 'ahit', i: a.i, zone: 'torso', w: 'jeep', dist: Math.round(speed * 10) / 10, sup: false });
      else a.damage(Math.max(0, speed - JEEP.bumpFrom) * JEEP.bumpPer, chest, dir, 'torso');
    }
    for (const d of this.dummies) {
      if (d.dead) continue;
      rel.copy(d.pos).sub(at).applyQuaternion(inv);
      if (Math.abs(rel.x) > half.x || Math.abs(rel.z) > half.z || rel.y > 0.6 || rel.y < -2.6) continue;
      const chest = new THREE.Vector3(d.pos.x, d.pos.y + 1.2, d.pos.z);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      this.effects.bleed(chest, dir, 0.8);
      if (d.damage(Math.max(0, speed - JEEP.bumpFrom) * JEEP.bumpPer, chest, dir, 'torso')) this.hud.note('Training dummy down · run down', 'good');
    }
  },

  /** everyone connected to the server, this player included */
  updateOnline(this: Game) {
    this.hud.setOnline(this.online ? this.remotes.size + 1 : null, this.maxPlayers);
  },

  async addRemote(this: Game, p: PlayerInfo) {
    if (p.id === this.net.id || this.remotes.has(p.id)) return;
    const r = new RemotePlayer(p.id, p.name, this.makeHeld);
    this.remotes.set(p.id, r);
    await r.load(this.s.atmo, this.s.r.scene, p.pose);
    // (gone again while their body was being made: see RemotePlayer.gone)
    if (this.remotes.get(p.id) !== r) return;
    r.vip = !!p.vip;
    r.tagged = !!p.tag;
    r.wearTag();
    r.setWeapon(p.w, p.m, p.f);
    void this.wear(r.avatar, p.g ?? []);
    this.gearOf.set(p.id, p.g ?? []);
    // (which survivor, and their voice: a game from before there were any to pick is given the one its name gives)
    r.avatar.wardrobe.setBody(p.bd ?? bodyFor(p.name));
    r.voice = p.vo ?? voiceFor(p.bd ?? bodyFor(p.name));
    r.setGhost(!!p.hidden);
    r.avatar.setSlung(this.weapons.slungOf(p.b ?? []));
    r.setAlive(p.alive);
    // (they may have been sitting in a jeep since before this game knew of them)
    this.garage.reseat();
  },

  /** something the hands do that shows on the body: your own, and (through the server) the copy of you everyone else sees */
  act(this: Game, a: Act, d = 1) {
    if (a === 'stop') this.avatar.act(null);
    else this.avatar.act(a === 'load' || a === 'unbox' ? 'open' : a, d);
    this.net.send({ t: 'act', a, d });
  },

  /** hat, vest and pack as they sit on a body */
  async wear(this: Game, body: Avatar, ids: string[]) {
    const out: { id: string; obj: THREE.Object3D }[] = [];
    // (the clothes as they are worn, and the rest hung on the body)
    const { worn, gear } = sortWorn(ids);
    body.wardrobe.setWorn(worn);
    for (const id of gear) {
      if (!GEAR_SHOWN.has(id)) continue;
      const model = (await this.loot.models.get(id)).group.clone();
      out.push({ id, obj: id === 'gasmask' ? facepiece(model) : model });
    }
    body.setGear(out);
  },

  /** What is slung on this player's back, told to the server when it changes: everybody else draws it on the copy of them they see. */
  syncBack(this: Game) {
    if (!this.weapons) return;
    const b = this.weapons.slung();
    const key = JSON.stringify(b);
    if (key === this.backKey) return;
    this.backKey = key;
    this.net.send({ t: 'back', b });
  },

  /** what this player wears that a body shows: the clothes by their colours (src/game/survivors.ts), and the hats, vests and packs (GEAR) */
  wornKeys(this: Game): string[] {
    return GEAR_SLOTS.map((s) => this.inv.slots[s]).filter((x): x is ItemInstance => !!x && (GEAR_SHOWN.has(x.id) || !!ITEMS[x.id]?.dress)).map(wornKey);
  },

  /** what this player wears that shows, kept in step with the inventory (and told to the server when it changes) */
  syncGear(this: Game) {
    const ids = this.wornKeys();
    const key = ids.join(',');
    if (key === this.gearKey) return;
    this.gearKey = key;
    void this.wear(this.avatar, ids);
    this.net.send({ t: 'gear', g: ids });
    this.portrait();
  },

  /**
   * The panel's pictures of who is who: each player's own head, in their own colours, with what they have on it
   * (2026-10-13: "can we render the players head as profile picture on the left hand screen"). Drawn as the
   * figure in the inventory is, a few at a time while the panel is open, and none twice.
   */
  async drawHeads(this: Game, players: { id: number; name: string }[]) {
    if (this.headsBusy || !this.adminUI?.isOpen) return;
    this.headsBusy = true;
    try {
      const { r, atmo } = this.s, out: Record<number, string> = {};
      let fresh = 0;
      for (const q of players) {
        const mine = q.id === this.net.id;
        const worn = mine ? (this.gearKey && this.gearKey !== '\u0000' ? this.gearKey.split(',') : []) : this.gearOf.get(q.id) ?? [];
        const name = mine ? playerName() : q.name, key = `${name}|${worn.join(',')}`;
        if (!this.heads.has(key) && fresh < 3) {
          fresh++;
          this.heads.set(key, await renderDoll(r.renderer, atmo.envMap, lookFor(name), worn, this.loot.models, true).catch(() => ''));
        }
        const url = this.heads.get(key);
        if (url) out[q.id] = url;
      }
      this.adminUI.setHeads(out);
    } finally {
      this.headsBusy = false;
    }
  },

  /** The figure in the inventory window, drawn again as the player is now: their colours, and what they have on. */
  portrait(this: Game) {
    // (where the figure is alive there is no still picture of it to draw again: see doll.ts)
    if (this.doll?.alive) return;
    const { r, atmo } = this.s;
    const worn = this.gearKey && this.gearKey !== '\u0000' ? this.gearKey.split(',') : [];
    const mine = ++this.portraitN;
    void renderDoll(r.renderer, atmo.envMap, lookFor(playerName()), worn, this.loot.models).then((doll) => {
      // (a later one may have been asked for while this was drawn)
      if (mine !== this.portraitN || !this.invUI) return;
      this.invUI.doll = doll;
      this.invUI.redraw();
    });
  },

  async addRemoteStash(this: Game, s: StashInfo) {
    if (this.loot.stashes.some((x) => x.uid === s.uid) || this.stashComing.has(s.uid)) return;
    const st = this.newStash(s);
    this.stashComing.set(s.uid, st);
    try {
      await this.loot.addStash(st);
    } finally {
      // (taken up while its model was still on its way: it is not stood in the world after all)
      if (this.stashComing.get(s.uid) !== st) {
        if (this.loot.stashes.includes(st)) this.loot.removeStash(st);
      } else this.stashComing.delete(s.uid);
    }
  },

  /** @param wait ms to let the fall animation of the player finish before the body appears (none for one that rode a helicopter down) */
  async addCorpse(this: Game, c: CorpseInfo, wait = 1800) {
    if (this.corpses.has(c.uid)) return;
    // One of the infected's, with something on it (server/bodies.ts): searched where its body lies, which they draw
    if (c.zed !== undefined) {
      const b = this.horde.lying(c.zed, c.v ?? 0);
      const stash = new Stash(c.uid, b?.pos.x ?? c.x, b?.pos.y ?? c.y, b?.pos.z ?? c.z, b?.yaw ?? c.rot, INFECTED_GRID[0], INFECTED_GRID[1], 'Infected');
      stash.corpse = true;
      searchedAt(stash, b ? b.variant : c.v ?? 0);
      this.corpses.set(c.uid, { stash });
      return;
    }
    // Where somebody died is where their feet were, and that can be in the air (a jump, a fall, a roof's edge): the
    // body lies on whatever is under that place, and along it if it slopes. ("dead bodies somtimes hover above the
    // ground", 2026-10-12. Every game works this out the same, from the same ground.)
    // (and not on the car or the helicopter they died in: it goes, and the body lay on nothing in the sky over a house,
    // 2026-10-15. Looked through, on down to what is under it.)
    let from = c.y + 0.5, under = physics.raycast({ x: c.x, y: from, z: c.z }, { x: 0, y: -1, z: 0 }, 150, SOLID_GROUPS);
    for (let k = 0; k < 8 && under?.tag?.owner instanceof Jeep; k++) {
      from = under.point.y - 0.02;
      under = physics.raycast({ x: c.x, y: from, z: c.z }, { x: 0, y: -1, z: 0 }, 150, SOLID_GROUPS);
    }
    const slope = under && under.toi > 0.02 ? new THREE.Vector3(under.normal.x, under.normal.y, under.normal.z) : undefined;
    if (under && under.toi > 0.02) c = { ...c, y: under.point.y };
    const stash = new Stash(c.uid, c.x, c.y, c.z, c.rot, BODY_GRID[0], BODY_GRID[1], `${c.name}'s body`);
    stash.corpse = true;
    // (dog tags lie on a body, and are taken off it: see Container.refusal)
    stash.container.tagsHere = true;
    const v = c.v ?? 0;
    const [ahead, left] = searchedAt(stash, v);
    const body = new CorpseBody();
    this.corpses.set(c.uid, { stash, body });
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (!this.corpses.has(c.uid)) return;
    await body.load(this.s.atmo, this.s.r.scene, c.x, c.y, c.z, c.rot, c.name, v, slope, c.bd ?? bodyFor(c.name));
    // and what has run out of it by then
    this.effects.pool(c.x - Math.sin(c.rot) * ahead * 0.75 - Math.cos(c.rot) * left, c.y, c.z - Math.cos(c.rot) * ahead * 0.75 + Math.sin(c.rot) * left);
  },

  removeCorpse(this: Game, uid: string) {
    const c = this.corpses.get(uid);
    if (!c) return;
    if (this.openStash === c.stash) this.toggleInventory(false);
    physics.tags.delete(c.stash.collider.handle);
    physics.world.removeCollider(c.stash.collider, false);
    c.body?.dispose();
    this.corpses.delete(uid);
  },

  /** any server-held container by id: map crate, stash or body */
  findBox(this: Game, cid: string): Stash | undefined {
    return this.loot.crates.find((c) => c.uid === cid) ?? this.loot.stashes.find((c) => c.uid === cid) ?? this.corpses.get(cid)?.stash ?? this.drops.get(cid)?.stash;
  },
};
