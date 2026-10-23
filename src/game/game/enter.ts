// The game: entering the world (joining a server or playing alone, the bot check's range, dressing the player).
// (Methods of Game cut out of game.ts whole on 2026-10-14, so that they can be read and worked on alone: put back on
// Game.prototype as the file loads. Nothing in them was changed but `this: Game` said as the first parameter.)

import { doorOver } from '../../ui/door';
import { audio } from '../../core/audio';
import { wagerQuery, watching } from '../../net/client';
import { ArenaHud } from '../../ui/arena-hud';
import { BrMode, brPage } from '../br/mode';
import { reloadPage } from '../../core/leave';
import { heightAt, inPlay } from '../../world/worldgen';
import { basementUnder } from '../../sim/basements';
import { ITEMS, makeItem, makeMag, type ItemInstance, TAG_OUT, ZONA_VOID, tagOwner, TAG_HOLD_MIN, TAG_HOLD, TAG_FRESH, tagClock } from '../../sim/items';
import { refill, refilledWords } from '../../sim/powers';
import { fillCrate, RACKS, stepNear, type Keeps } from '../../sim/crates';
import { inCave } from '../../world/caves-carved';
import type { Economy } from '../../sim/economy';

/** what each step keeps, as this game's economy has it, one for each economy (crates are filled from the item rules by it) */
const keepsOf = new WeakMap<Economy, Keeps>();
import { economyCargo } from '../../sim/storage';
import { loadSave, type SaveData, writeSave } from '../../sim/save';
import { playerName, setPlayerName, personKey, remoteServer, publicId, serverNamed, UNREACHED } from '../../net/client';
import { PROTOCOL, type RangeLayout, type S2C } from '../../net/protocol';
import { freshVitals } from '../player';
import { lookFor } from '../look';
import type { Stash } from '../loot';
import { askPerson } from '../../ui/person';
import { BotCheck } from '../botcheck';
import { addCashedTag, walletAddress, REWARDS_UI } from '../../ui/rewards';
import { EMBED } from '../../core/embed';
import { underGas } from '../../sim/gas';
import { inBunker } from '../../sim/bunker';
import { LOOT_REV, type Game } from '../game';
import { playedAd } from '../../ui/ads';
import { adBreak } from '../../ui/adsense';

/** when the neck tag's clock was last looked at (see tagWhenDue) */
let neckSeen = 0;

export const enterMethods = {
  // ------------------------------------------------------------ entering the world

  /**
   * First click on Play: find a server (multiplayer) or fall back to the local world.
   * @param again back in after a dropped line (Game.rejoin): 'retry' answers 'unreached' where the server could not be
   * reached, to be tried again before it is said; 'last' says it
   */
  async join(this: Game, again: '' | 'retry' | 'last' = ''): Promise<'unreached' | void> {
    this.joining = true;
    // (Another game gone to while this way in is on its way, src/game/modes.ts: what comes of it then is nobody's. A
    // battle royale's lobby on another map was the case: its server turns the first try away, the connection's own second
    // try went on into the new map's lobby, and the new map's own way in was then turned away as one already in it.)
    const gen = ++this.joinGen, gone = () => gen !== this.joinGen;
    this.hud.refused('');
    const name = this.hud.nameValue() || `Survivor${Math.floor(100 + Math.random() * 900)}`;
    const renamed = name !== playerName();
    setPlayerName(name);
    this.dress(name, renamed);
    this.hud.showStart(true, false, again ? 'Connection lost: getting you back in…' : 'Connecting…');
    // A full server puts us in line. The wait can be long: the mouse goes back to the player,
    // the screen says where they stand, and they can give it up and play on their own.
    let waited = false;
    // (in a wager the server alone says when anybody dies: arena/rules.ts; and the arena has its own screen)
    this.player.keepAlive = !!wagerQuery();
    // (the battle royale rides on the arena's door, `?wager=br`, with its own mode in place of the Arena's screen)
    // (made once a page and put on again after: src/game/modes.ts)
    if (brPage() && !this.br) {
      if (this.brKept) this.brKept.attach();
      this.br = this.brKept ??= new BrMode(this);
    }
    else if (wagerQuery() && !this.arenaHud && !brPage()) {
      this.arenaHud = new ArenaHud(this.hud.root, watching(), new URLSearchParams(location.search).get('wager') === 'practice');
      this.weapons.freeReload = true;
      // (over: the Arena's menu again, as the page is, for another; or the main menu over it, src/ui/door.ts)
      this.arenaHud.onGo = (again) => {
        this.toArena();
        if (!again) void doorOver('arena');
      };
    }
    this.net.onQueue = (pos, of, max) => {
      if (!waited) {
        waited = true;
        this.input.unlock();
      }
      // (a wager waits for its other players as the open world's line waits for a place)
      if (wagerQuery()) return void this.hud.showStart(true, false, `Wager: ${pos} of ${of} in · waiting for the rest`);
      this.hud.showStart(true, false, 'In line');
      this.hud.setQueue({ pos, of, max }, () => this.net.leaveQueue());
      document.title = `(${pos}) in line · ${this.title}`;
    };
    // The check that this is a person, where the server asks it: shown the moment Deploy is pressed, to everybody,
    // before anything is asked of the server. Not passed, or given up: back at the way in, and not into the game.
    const notAPerson = () => {
      this.joining = false;
      this.input.unlock();
      this.hud.showStart(true);
      this.hud.note('The check that you are a person was not passed: press Deploy to try again', 'warn');
    };
    // (The bot check: a range dealt, a figure counted down, the range passed. Listened for before anything is asked
    // of the server: it deals the range in place of a welcome. See `onRange`.)
    if (!this.rangeHeard) {
      this.rangeHeard = true;
      this.net.on('range', (m) => void this.onRange(m.turn, m.go, m.need, m.secs, m.lay));
      this.net.on('rfig', (m) => this.botCheck?.sighted(m.f));
      this.net.on('rhit', (m) => this.botCheck?.hit(m.i));
      this.net.on('rpass', () => this.botCheck?.passed());
    }
    // (once a visit, an ad before the check that it is a person and the way in: the owner, "we can serve 1 popup ad
    // before the bot check starts as well so any stale session starts with an ad for us". Waited for: a range timed
    // under an ad would be failed. Nothing for VIP, nor off the live site: src/ui/adsense.ts)
    await adBreak('start', 'way-in');
    if (gone()) return;
    let slip = '';
    const ask = await personKey();
    if (ask) {
      this.input.unlock();
      this.hud.showStart(true, false, 'One check that you are a person');
      slip = (await askPerson(ask)) ?? '';
      if (!slip) return void notAPerson();
      this.hud.showStart(true, false, 'Connecting…');
    }
    let welcome = await this.net.connect(name, (text) => this.hud.showStart(true, false, text), slip);
    if (gone()) return;
    // (the bot check's range, if the server put this game on it, is over one way or the other: see `onRange`)
    const ranged = !!this.botCheck;
    this.botCheck?.end();
    this.botCheck = null;
    // (Whoever was on the range and is welcomed cannot be hurt until they have been stood in the world: the range's
    // floor has just gone from under them. See the stashes in `enterOnline`.)
    if (!(ranged && welcome)) this.player.god = false;
    if (ranged && !welcome) {
      // not passed, or the line dropped: back at the way in, and not into the game alone
      this.joining = false;
      this.started = false;
      this.weapons.take(null);
      this.inv.clear();
      this.input.unlock();
      this.hud.showStart(true);
      this.hud.note(this.net.refused || 'The bot check was not finished: press Deploy to try again', 'warn');
      return;
    }
    // Turned away for being of another version than the server. Which of the two is behind is told by the site as
    // it is served this moment (version.json, made with the build). If that is not this page, this page is the old
    // one and is loaded again. If it is, the server is the one behind: a new site goes out before its server does
    // (2026-10-12: "why not just deploy the front end early so its ready for the server when it launches"), and it
    // is waited for here, asked again every few seconds, for as long as ten minutes.
    for (const began = performance.now(); !welcome && this.net.outdated && performance.now() - began < 600_000; ) {
      const site = (await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { protocol?: number } | null;
      if (site && typeof site.protocol === 'number' && site.protocol !== PROTOCOL) {
        // (once in a while only: a page that came back the same is not asked for over and over)
        const last = Number(sessionStorage.getItem('zona:reloaded') ?? 0);
        if (Date.now() - last > 20_000) {
          sessionStorage.setItem('zona:reloaded', String(Date.now()));
          return void reloadPage();
        }
      }
      this.input.unlock();
      this.hud.showStart(true, false, 'The server is being updated. You are let in as soon as it is up');
      await new Promise((r) => setTimeout(r, 4000));
      welcome = await this.net.connect(name);
      if (gone()) return;
    }
    // Turned away for want of the check that this is a person (the server asks it of whoever it has not lately had
    // it from: see src/ui/person.ts). The check is shown, and the way in is asked for again with what it gave.
    for (let tries = 0; !welcome && this.net.wantsProof && tries < 2; tries++) {
      this.input.unlock();
      this.hud.showStart(true, false, 'One check that you are a person');
      const again = await askPerson(this.net.wantsProof);
      if (!again) return void notAPerson();
      this.hud.showStart(true, false, 'Connecting…');
      welcome = await this.net.connect(name, (text) => this.hud.showStart(true, false, text), again);
      if (gone()) return;
    }
    // (asked twice and still turned away for it: not into the game)
    if (!welcome && this.net.wantsProof) return void notAPerson();
    // (a wager not got into: given up while waiting, turned away, or the arena not reached. Back at the Arena's
    // menu as it was, never into the world alone)
    if (!welcome && wagerQuery()) return void this.toArena(this.net.leftQueue ? '' : this.net.refused || 'The arena could not be reached: try again in a minute.', brPage() ? `/battleroyale?kills=${this.modes.brMap}` : '/arena');
    this.hud.setQueue(null);
    document.title = this.title;
    if (welcome) {
      await this.enterOnline(welcome);
      // (stood in the world now: as anybody is. An admin's own is said again by the server as it comes in.)
      if (ranged) this.player.god = false;
      if (waited) {
        // their turn, quite possibly while they were looking at something else
        audio.ui('open');
        document.title = `${wagerQuery() ? 'Match on!' : 'Your turn!'} · ${this.title}`;
        // (the line's own word; a match that has its players needs none: its banner says the round)
        if (!wagerQuery()) this.hud.note('A place came free: you are in', 'good');
      }
    } else {
      if (this.net.leftQueue) this.hud.note('You left the line: playing on your own', 'warn');
      else if (this.net.refused) {
        // Kept off, or banned: said on the way in where it stays said, and not into a game alone as if nothing
        // had happened. (It was a note that went after four seconds, and then a world with nobody in it.
        // 2026-10-13: "when a user is banned or kicked we tell them right? at the menu or when rejected?")
        // (And whatever else the server turned them away for: somebody already playing from their connection,
        // a page that is out of date. 2026-10-13: "he says hes in offline mode and cant play": he had been turned
        // away, was told so for four seconds, and was then walking about a world with nobody in it.)
        this.joining = false;
        this.input.unlock();
        this.hud.showStart(true);
        this.hud.refused(this.net.refused);
        return;
      } else if ((remoteServer() && !serverNamed()) || again) {
        // The site's own server not reached: said on the way in where it stays said, with the likely cause and what to
        // do, and not into a world alone. (It was a note gone in four seconds, then the OFFLINE banner, and players did
        // not know why: 2026-10-18, "players who get this message still dont know why". A server named in the address,
        // as a development page or a game played offline on purpose names one, is played without as it was; never
        // whoever is on their way back to their body.)
        this.joining = false;
        if (again === 'retry') return 'unreached';
        this.input.unlock();
        this.hud.showStart(true);
        this.hud.refused(UNREACHED[this.net.unreached || 'socket']);
        return;
      } else if (remoteServer()) this.hud.note('The server could not be reached: you are playing OFFLINE, alone. Reload the page to try again.', 'warn');
      await this.enterOffline();
    }
    this.joining = false;
    this.started = true;
    playedAd();
    this.menu.dispose();
    this.hud.menuScene('', 0);
    // out of the aerial shot and down into the character's eyes (in a wager, straight in: a round starts in the eyes;
    // and back after a dropped line, where the eyes already were)
    this.director.flyIn(wagerQuery() || again ? 0.001 : undefined);
    if (!this.weapons.equippedItem) {
      const slot = (['primary', 'secondary', 'holster'] as const).find((k) => this.inv.slots[k]);
      if (slot) this.weapons.equip(slot);
    }
    if (this.input.locked) this.unpause();
    else this.hud.showStart(true, true, waited && welcome ? 'You are in: click to play' : '');
  },

  /**
   * Back at the Arena's menu with the page as it is (the owner: "I should not have to redownload everything when
   * ending a match, canceling fining a match etc... bad UX"): out of the match, or out of the wait for one, its
   * people gone, and this player as before any match; the world, the fort and everything loaded stay. `note`: why,
   * where it was not by the player's own choice.
   */
  toArena(this: Game, note = '', to = '/arena') {
    this.idle();
    history.replaceState(null, '', to);
    this.hud.showStart(true);
    if (note) this.hud.note(note, 'warn');
  },

  /** This player as before any match or life: out of it, its people gone; the world and everything loaded stay (toArena, src/game/modes.ts). */
  idle(this: Game) {
    // (a connection still open is closed from here, and its going is not shown as a result: see onClose)
    if (this.net.online) {
      this.arenaLeaving = true;
      this.net.leaveQueue();
    }
    this.arenaHud?.destroy();
    this.arenaHud = null;
    this.br?.reset();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.weapons.take(null);
    this.inv.clear();
    this.powers = { god: false, hidden: false, clip: false, voidInv: false, voidTag: false, weightless: false, endless: false, bottomless: false };
    this.player.god = false;
    this.player.setFly(false);
    this.carryPowers();
    this.showPowers();
    this.player.mend();
    this.player.keepAlive = false;
    this.joining = false;
    this.started = false;
    this.paused = true;
    this.input.unlock();
  },

  /**
   * Back at the battle royale's menu as toArena is back at the Arena's (the owner, 2026-10-21: "return to battle royale
   * which should not trigger a total reload and redeownload"): the page as it is, for the next match.
   */
  toBr(this: Game) {
    this.toArena('', `/battleroyale?kills=${this.br?.map ?? 0}`);
  },

  /** What this player looks like follows from their name: body, first-person sleeves, inventory portrait. */
  dress(this: Game, name: string, portrait: boolean) {
    const look = lookFor(name);
    this.avatar.setLook(look);
    this.weapons.setLook(look);
    if (portrait) this.portrait();
  },

  /**
   * The server has dealt this game a go at the course (the bot check: ./botcheck.ts, ../sim/course.ts) before it
   * will let it in: the way the yard is turned, how many figures, how long. The player is put on it alone, with a
   * rifle: not in the world, and with nothing of their own. It ends in `join`, when the server either welcomes this
   * game or turns it away.
   */
  async onRange(this: Game, turn: number, go: number, need: number, secs: number, lay?: RangeLayout) {
    const { r, atmo, world } = this.s;
    if (!this.botCheck) {
      let top = 0;
      for (let i = 0; i < world.heights.length; i += 7) top = Math.max(top, world.heights[i]);
      this.botCheck = new BotCheck({
        scene: r.scene,
        atmo,
        camera: r.camera,
        floor: Math.round(top + 140),
        place: (x, y, z, yaw) => this.player.spawn(x, y, z, yaw),
        where: () => this.player.pos,
        send: (m) => this.net.send(m),
        ready: (o) => r.ready(o),
        playing: () => this.input.locked || this.input.touch,
      });
      // a rifle with a sight on it, and more rounds than the range lets anybody fire
      if (this.use) this.breakOff();
      this.weapons.take(null);
      this.inv.clear();
      const gun = Object.assign(makeItem('ar15'), { mag: 'mag_ar', loaded: 31, mods: ['red_dot'] });
      this.inv.add(gun);
      for (let k = 0; k < 2; k++) this.inv.add(makeMag('mag_ar', 30));
      this.weapons.validate();
      this.autoHot();
      this.player.vitals = freshVitals();
      this.player.god = true;
      this.started = true;
      this.menu.dispose();
      this.hud.menuScene('', 0);
      this.hud.showStart(false);
      await this.botCheck.deal(turn, go, need, secs, lay);
      // (straight to the eyes: the range's clock is running)
      this.director.flyIn(0.5);
      const slot = (['primary', 'secondary', 'holster'] as const).find((k) => this.inv.slots[k]);
      if (slot && !this.weapons.equippedItem) this.weapons.equip(slot);
      // (the mouse was let go for the check before this one: the next click on the game takes it again. On a phone there
      // is no mouse to take, and a tap is not that click: it waited paused, with no controls on the screen, for good. A
      // player on Android, 2026-10-15: "I can get into the bot test but there is no way of moving/controlling".)
      if (this.input.locked || this.input.touch) {
        this.input.lock();
        this.unpause();
      } else this.awaitClick = true;
      return;
    }
    // (another go: a fresh magazine with the fresh course)
    const held = this.weapons.equippedItem;
    if (held?.id === 'ar15') Object.assign(held, { mag: 'mag_ar', loaded: 31 });
    await this.botCheck.deal(turn, go, need, secs, lay);
  },

  async enterOffline(this: Game) {
    // (said for as long as it is so: nobody else is here, and nothing done here is kept)
    this.hud.setOffline(!!remoteServer());
    const save = loadSave();
    if (save) await this.restore(save);
    else this.fresh();
    await this.spawnDummies();
    this.garage.startAlone();
    this.horde.alone();
    this.hud.setNet('Offline · single player');
    this.hud.setOnline(null);
  },

  /** a crate of the map filled (one under the gas with the best of everything) */
  fillCrate(this: Game, c: Stash) {
    // (offline, a piece of furniture holds what the economy put in it: taken out of the economy into it as it would be by hand)
    if (economyCargo(c.kind)) {
      for (const l of this.economy.within(c.uid)) if (c.container.hasRoom(l.item) && this.economy.take(l.uid, false)) c.container.add(l.item);
      return;
    }
    const e = this.economy, keeps = keepsOf.get(e) ?? keepsOf.set(e, (id, t) => e.written(id, t)).get(e)!;
    fillCrate(c.container, c.kind, Math.random, inBunker(this.bunker.place, c.x, c.y + 0.5, c.z) ? 'bunker' : underGas(this.s.atmo.gas, c.x, c.y, c.z) || inCave(c.x, c.y + 0.5, c.z), keeps, RACKS.has(c.kind) ? stepNear(e.points, c.x, c.z) : undefined, !inPlay(c.x, c.z));
  },

  fresh(this: Game) {
    this.spawnAtEdge();
    this.economy.populate();
    for (const c of this.loot.crates) this.fillCrate(c);
    this.freshKit();
  },

  spawnAtEdge(this: Game) {
    const { world } = this.s;
    const sp = world.spawns[Math.floor(Math.random() * world.spawns.length)] ?? world.spawn;
    this.player.spawn(sp.x, heightAt(world.heights, sp.x, sp.z) + 0.05, sp.z, sp.yaw);
  },

  /** A new life: bare hands, one thing to eat and one thing to drink. Everything else is out there. */
  freshKit(this: Game) {
    // (`clear` leaves them in a new Field Jacket and Field Trousers, which are things now and have the pockets: 2026-10-13)
    this.inv.clear();
    const pick = (ids: string[]) => ids[Math.floor(Math.random() * ids.length)];
    this.inv.add(makeItem(pick(['sprats', 'beans', 'sardines', 'tomatoes'])));
    this.inv.add(makeItem(pick(['thermos', 'milk'])));
    // one dressing: the first wound is survivable, the second is yours to deal with
    this.inv.add(makeItem('bandage'));
    // (no tag of their own yet: it is put round their neck once they have lived long enough, see `tagWhenDue`)
    this.inv.neck = null;
    this.inv.neckDue = Date.now() + TAG_FRESH * 1000;
    this.player.vitals = freshVitals();
    this.player.drip.left = 0;
    this.bloodSaid = 0;
    this.player.boost = 0;
    this.ready = null;
    this.inHand = null;
    this.holding = false;
    this.avatar.clearWounds();
    this.weapons.validate();
    this.autoHot();
    this.invUI.settle();
    // (and it is seen with nothing on: the helmet, the vest and the pack of the life before were still on the body,
    // and on the figure in the inventory, until something was next picked up. "when i die and respawn my player
    // model still has its old equipement shown", 2026-10-12.)
    this.syncGear();
  },

  /**
   * A whole set handed over by an admin (src/sim/kits.ts): what was carried goes, but for the dog tags, and the
   * set is put on and away as things picked up are. What finds no room is put at the feet.
   */
  kitUp(this: Game, m: Extract<S2C, { t: 'kit' }>) {
    const inv = this.inv;
    if (this.player.dead) return;
    if (!m.adds) {
      // (whatever the hands were at is dropped: a kit asked for again is the same kit, whole, in place of what is left of the last)
      if (this.use) this.breakOff();
      if (this.invUI.isOpen) this.toggleInventory(false);
      this.loose = null;
      this.weapons.take(null);
      const me = publicId();
      inv.sortTags((tag) => tag.pid === me);
      const neck = inv.neck, pouch = inv.tags.items.map((q) => q.item);
      // (a kit replaces everything: the jacket and the trousers that were on go too, with what was in them, and `clear` leaves new ones on)
      inv.clear();
      inv.neck = neck;
      for (const tag of pouch) inv.tags.add(tag);
      this.ready = null;
      this.inHand = null;
      this.holding = false;
    }
    // (with an admin's hold open, `add` has room for every one of them: PlayerInventory.containers)
    const over = m.items.filter((it) => inv.add(it));
    for (const it of over) this.dropItem(it);
    this.weapons.validate();
    this.autoHot();
    // (in the arena every round starts with the first gun in hand, as in CS:GO)
    if (this.arenaHud && !m.adds) {
      const i = this.inv.hot.findIndex((h, k) => !!h && !!ITEMS[this.inv.hotItem(k)?.id ?? '']?.weapon);
      if (i >= 0) this.hot(i);
    }
    this.inventoryChanged();
    this.meDirty = true;
    // (things given while the pockets are open are seen to arrive)
    if (m.adds && this.invUI.isOpen) this.invUI.render();
    // (a kit of nothing is an admin's "empty everything")
    if (!m.name) return void (m.by && this.hud.note(`${m.by}, an admin, has emptied what you carried`, 'warn'));
    // (things an admin has given, and no kit: said as what they are, and where they went. Each pile is one thing here.)
    if (m.gift) {
      const none = over.length === m.items.length, lies = none ? (over.length === 1 ? 'it found no room and lies at your feet' : 'none of it found room: it lies at your feet') : over.length === 1 ? 'one found no room and lies at your feet' : `${over.length} found no room and lie at your feet`;
      if (m.by) return void this.hud.note(`${m.by}, an admin, has given you ${m.gift}${over.length ? `; ${lies}` : ''}`, 'good');
      return void this.hud.note(`${m.gift}: ${over.length ? lies : 'in your inventory'}`, 'good');
    }
    if (m.by || over.length) this.hud.note(`${m.by ? `${m.by}, an admin, has given you the ${m.name} kit` : `The ${m.name} kit`}${over.length ? `: ${over.length} of its things found no room and lie at your feet` : ''}`, 'good');
  },

  /** Things an admin has taken out of what is carried (the panel's trash): gone, from wherever they were. */
  trashed(this: Game, uids: string[], by?: string) {
    const inv = this.inv, gone = new Set(uids);
    let n = 0;
    const strip = (it: ItemInstance | null | undefined) => {
      if (!it?.cargo) return;
      const kept = it.cargo.filter((p) => !gone.has(p.item.uid));
      n += it.cargo.length - kept.length;
      // (in place: a bag that is open is looked into through this very list)
      it.cargo.splice(0, it.cargo.length, ...kept);
      for (const p of it.cargo) strip(p.item);
    };
    if (this.inHand && gone.has(this.inHand.uid)) this.emptyHands();
    if (this.loose && gone.has(this.loose.uid)) this.loose = null;
    for (const [slot, it] of Object.entries(inv.slots) as [keyof typeof inv.slots, ItemInstance | null][]) {
      if (it && gone.has(it.uid)) {
        if (inv.held() === it) this.weapons.take(null);
        inv.slots[slot] = null;
        n++;
      } else strip(it);
    }
    for (const c of inv.containers) {
      for (const q of [...c.items]) {
        if (gone.has(q.item.uid)) {
          c.remove(q.item);
          n++;
        } else strip(q.item);
      }
    }
    if (!n) return;
    this.weapons.validate();
    this.autoHot();
    this.inventoryChanged();
    this.meDirty = true;
    if (by) this.hud.note(`${by}, an admin, has taken ${n > 1 ? `${n} things` : 'a thing'} out of what you carry`, 'warn');
  },

  /**
   * An admin's refill (`/refill`, on the server's word and never without it): every magazine and every gun carried
   * is full, wherever it is, and what the hands hold loose with them. The rule is `refill` in src/sim/powers.ts,
   * the same the server fills its own copy by; what is carried is said to it again straight after.
   */
  refilled(this: Game, by?: string) {
    if (this.player.dead) return;
    // (whatever the hands were at with a magazine or a gun stops there: a change half made is not finished on top of this)
    if (this.use) this.breakOff();
    else this.weapons.abortReload();
    const r = refill([...this.inv.topLevel(), this.loose]), did = refilledWords(r);
    if (did) this.inventoryChanged();
    if (this.invUI.isOpen) this.invUI.render();
    this.hud.note(did ? `${by ? `${by}, an admin, has filled what you carry: ` : ''}${did}` : `${by ? `${by}, an admin, went to fill what you carry: ` : ''}${r.of ? 'every magazine and gun you carry is full already' : 'you carry no magazine and no gun'}`, did ? 'good' : 'info');
  },

  /** Those of an admin's powers that are about what is carried (src/sim/powers.ts): said to what fires a gun, to the screen that weighs the pockets, and to the inventory, whose hold is opened or emptied. */
  carryPowers(this: Game) {
    this.weapons.endless = this.powers.endless;
    this.invUI.weightless = this.powers.weightless;
    // The inventory that never fills. On: the hold is open, and whatever is put away finds room in it. Off (and it
    // was on, or there are things in a hold that the server says is not to be had): what fits what is worn stays,
    // and the rest goes to the feet.
    if (this.powers.bottomless) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = 0;
      this.inv.bottomless = true;
      // (not while it is being emptied already: every word of any power comes through here)
    } else if (this.inv.bottomless || (this.inv.theHold.items.length && !this.holdTimer)) this.emptyHold();
    // (and the legs are told on the next frame)
    this.slowT = 1;
    if (this.invUI.isOpen) this.invUI.render();
  },

  /**
   * An admin's hold is shut (the power is off, or was never theirs): everything in it that finds a place on the
   * body or room in what is worn is put there, at once; the rest is put at the feet and counted out loud. A few at
   * a time: each thing put down is a message to the server, which takes no more than 120 a second from anybody
   * and says nothing of the ones it lets fall, so forty rifles put down in one frame would be forty rifles that
   * some of them nobody else could see or take. Until the last is down they are still in the hold, shut, and
   * still said to the server as carried: nothing is anywhere it cannot be found.
   */
  emptyHold(this: Game) {
    const inv = this.inv;
    window.clearTimeout(this.holdTimer);
    const had = inv.theHold.items.length, left = inv.shutHold();
    if (had) this.inventoryChanged();
    if (left) this.hud.note(`The bottomless inventory is off: ${left === 1 ? 'one thing finds' : `${left} things find`} no room in what you wear, and ${left === 1 ? 'is' : 'are'} put at your feet`, 'warn');
    else if (had) this.hud.note('The bottomless inventory is off: everything that was in the hold is in what you wear', 'info');
    const step = () => {
      this.holdTimer = 0;
      // (dead, or the power is back on: what is still in it stays where it is)
      if (this.player.dead || inv.bottomless || !inv.theHold.items.length) return;
      for (const p of inv.theHold.items.slice(0, 6)) {
        inv.theHold.remove(p.item);
        this.dropItem(p.item, this.player.pos, 1.1);
      }
      this.inventoryChanged();
      if (this.invUI.isOpen) this.invUI.render();
      if (inv.theHold.items.length) this.holdTimer = window.setTimeout(step, 250);
    };
    step();
  },

  /** Every survivor wears a dog tag stamped with their own name, round their neck (see PlayerInventory.neck). */
  makeTag(this: Game): ItemInstance {
    const it = makeItem('dogtag');
    it.owner = playerName() || 'Survivor';
    it.pid = publicId();
    // (a VIP's is gold, as their server says they are: the store's, and it pays the same)
    if (this.perks.vip) it.gold = true;
    return it;
  },

  /**
   * Tags where they belong as a character comes in (the one in a pocket round the neck, the taken ones into the
   * pouch), and their own round their neck only once they have been alive TAG_FRESH since coming in: until then it is
   * put aside, and put on when it is due (see `tagWhenDue`). `served`: the time of this life the server has counted
   * already (`me.tag`), which a restart or a coming back does not take away: a tag that was round their neck stays.
   */
  ensureTag(this: Game, served = 0) {
    const me = publicId();
    this.inv.sortTags((tag) => tag.pid === me);
    if (served < TAG_FRESH * 1000) this.inv.neck = null;
    this.inv.neckDue = this.inv.neck ? 0 : Date.now() + Math.max(0, TAG_FRESH * 1000 - served);
  },

  /** their own tag round their neck, once it is due (asked every few seconds) */
  tagWhenDue(this: Game) {
    // (its clock stands still outside the Zona: only time in it counts, as the server counts it (tagTime in server/tags.ts);
    // the owner, 2026-10-19: "players 'survived for 10 minutes' timer does not start or count until they are in the zona")
    const now = Date.now(), step = neckSeen ? Math.min(now - neckSeen, 5000) : 0;
    neckSeen = now;
    if (ZONA_VOID && this.inv.neckDue && !this.inv.neck && !inPlay(this.player.pos.x, this.player.pos.z)) this.inv.neckDue += step;
    if (this.inv.neck || !this.inv.neckDue || now < this.inv.neckDue || this.player.dead) return;
    this.inv.neck = this.makeTag();
    this.inv.neckDue = 0;
    this.inventoryChanged();
    this.hud.note('Your dog tag is round your neck now: whoever kills you can take it', 'info');
  },

  /**
   * Over the line round the Zona with a tag taken off somebody: it is said on the screen, with the seconds left
   * to turn back in. Every frame, so that a step back over the line is answered at once. (Online it is the
   * server that calls them void, a moment after this clock runs out.)
   */
  tickZone(this: Game, dt: number) {
    const p = this.player;
    // (down a basement, which is out of the Zona: the owner, 2026-10-18, "ad basements to the "out of bounds" area for
    // dogtags"; and over the Zona's line only while ZONA_VOID says so, off until there are bases)
    const down = this.started && basementUnder(this.s.world.basements, p.pos.x, p.pos.y, p.pos.z);
    if (this.started && !p.dead && this.takenTags.length && (down || (ZONA_VOID && !inPlay(p.pos.x, p.pos.z)))) {
      this.outFor += dt;
      this.hud.zone(Math.max(0, TAG_OUT - this.outFor), this.takenTags.length, down);
      // (and two seconds after it, whatever the server says: a tag it does not know of was worth nothing already)
      if (this.outFor >= TAG_OUT + (this.online ? 2 : 0)) this.voidTags(this.takenTags);
    } else if (this.outFor) {
      this.outFor = 0;
      this.hud.zone(null, 0);
    }
  },

  /** These tags were carried out of the Zona and are void: out of the pockets they go, and it is said why. */
  voidTags(this: Game, uids: string[]) {
    let n = 0;
    for (let it = this.inv.find((i) => uids.includes(i.uid)); it; it = this.inv.find((i) => uids.includes(i.uid))) {
      this.inv.remove(it);
      n++;
    }
    this.outFor = 0;
    this.takenTags = [];
    this.hud.zone(null, 0);
    if (!n) return;
    this.inventoryChanged();
    const p = this.player, down = basementUnder(this.s.world.basements, p.pos.x, p.pos.y, p.pos.z);
    const text = down || !ZONA_VOID ? `${n === 1 ? 'Your dog tag is' : `Your ${n} dog tags are`} void: carried down a basement. A tag is cashed in above ground.` : `${n === 1 ? 'Your dog tag is' : `Your ${n} dog tags are`} void: carried out of the Zona. Tags are earned inside the red line on the map.`;
    this.hud.note(text, 'warn');
    this.hud.chatLine('system', '', text);
  },

  tickTags(this: Game, dt: number) {
    const me = publicId();
    const done: ItemInstance[] = [];
    const carried: { name: string; clock: string }[] = [];
    const taken: string[] = [];
    this.inv.find((it) => {
      if (it.id !== 'dogtag' || it.pid === me) return false;
      taken.push(it.uid);
      if (it.holder !== me) {
        it.holder = me;
        it.held = 0;
        this.meDirty = true;
        this.hud.note(`${tagOwner(it)}'s dog tag: stay alive for ${TAG_HOLD_MIN} minutes to cash it in`, 'good');
      }
      it.held = (it.held ?? 0) + dt;
      if (it.held >= TAG_HOLD) done.push(it);
      else carried.push({ name: tagOwner(it), clock: tagClock(it) });
      return false;
    });
    this.takenTags = taken;
    // the countdown is on screen the whole time, and on the tag itself in the inventory
    this.hud.setTags(carried);
    if (this.invUI.isOpen) this.invUI.tickTags();
    if (!done.length) return;
    // (the server is shown the tag with its time served before it is asked to cash it: asked from a hidden tab, its last sight of it may be minutes old)
    if (this.online) this.net.send({ t: 'me', inv: this.inv.serialize(), vitals: { ...this.player.vitals } });
    for (const it of done) {
      this.inv.remove(it);
      const n = addCashedTag();
      const owner = tagOwner(it);
      this.hud.note(`Dog tag cashed in: ${owner}`, 'good');
      // online the server checks the tag and announces it to everyone; a payout would be issued there
      // the address goes with it: the tag is listed for a reward under it
      if (this.online) {
        const wallet = walletAddress();
        this.net.send({ t: 'cash', uid: it.uid, ...(wallet ? { wallet } : {}) });
        if (!wallet && REWARDS_UI && !EMBED) this.hud.note('No wallet address saved: add one in Settings, on the Account page', 'warn');
      }
      else {
        this.hud.chatLine('system', '', `${playerName() || 'You'} cashed in ${owner}'s dog tag.`);
        this.hud.chatLine('system', '', `That is ${n} cashed in so far.`);
      }
    }
    audio.ui('pickup');
    this.inventoryChanged();
    if (this.invUI.isOpen) this.invUI.refresh(this.around(), this.openStash);
  },

  async restore(this: Game, save: SaveData) {
    const e = save.economy;
    const sameMap = e.rev === LOOT_REV;
    this.economy.time = e.time;
    this.economy.lastRestock = sameMap ? e.lastRestock : {};
    this.economy.restore(e.loot, sameMap);
    if (!sameMap) this.economy.populate();
    for (const sd of save.stashes as (SaveData['stashes'][number] & { item?: string; buried?: boolean })[]) {
      const st = this.newStash(sd);
      st.container.load(sd.container as never);
      // (one that stood on the ground, kept from before a stash was a thing to drop: it lies there as one now)
      if (sd.buried) await this.loot.addStash(st);
      else if (!this.economy.loot.has(st.uid)) this.economy.drop(this.stashItem(st), st.x, st.y, st.z, st.rot);
    }
    const saved = new Map((save.crates ?? []).map((c) => [c.uid, c]));
    for (const c of this.loot.crates) {
      const sc = saved.get(c.uid);
      if (sc) {
        c.container.load(sc.container as never);
        c.emptiedAt = sc.emptiedAt;
      } else this.fillCrate(c);
    }
    const p = save.player;
    if (p && sameMap) {
      this.player.spawn(p.x, p.y + 0.05, p.z, p.yaw);
      this.takeVitals(p.vitals);
      // pockets are smaller than they used to be: whatever no longer fits lands at your feet
      for (const it of this.inv.load(p.inventory)) this.dropItem(it, this.player.pos, 0.8);
      // (a save from when keys 5 to 8 were for kinds of thing to use: each kind is on the same key still, as the thing itself)
      (p.quick ?? []).forEach((id, i) => {
        const it = id && !this.inv.hot[4 + i] ? [...this.inv.carried()].find((x) => x.id === id) : null;
        if (it && this.inv.hotOf(it) < 0) this.inv.bind(4 + i, it);
      });
      this.ensureTag();
      this.autoHot();
      this.weapons.validate();
      this.invUI.settle();
    } else {
      // the map changed under the old character (or they were dead): a new life on the edge
      this.spawnAtEdge();
      this.freshKit();
    }
    // top the world back up if the save is sparse
    this.economy.tick(0, [this.player.pos]);
  },

  /** Offline only: the server owns the world and your character when you play online. */
  save(this: Game) {
    if (!this.economy || this.online || !this.started || this.botCheck?.active) return;
    const p = this.player;
    writeSave({
      version: 1,
      savedAt: Date.now(),
      player: p.dead ? null : { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, vitals: { ...p.vitals }, inventory: this.inv.serialize() },
      economy: { ...this.economy.serialize(), rev: LOOT_REV },
      stashes: this.loot.stashes.map((s) => s.serialize()),
      crates: this.loot.crates.map((c) => ({ uid: c.uid, emptiedAt: c.emptiedAt, container: c.container.serialize() })),
    });
  },
};
