// The game: every frame (the main loop: input, the world, the camera, the sound, the HUD).
// (Methods of Game cut out of game.ts whole on 2026-10-14, so that they can be read and worked on alone: put back on
// Game.prototype as the file loads. Nothing in them was changed but `this: Game` said as the first parameter.)

import * as THREE from 'three';
import { physics, SHOT_GROUPS } from '../../core/physics';
import { assets } from '../../core/assets';
import { audio } from '../../core/audio';
import { NULL_INPUT } from '../../core/input';
import { controls } from '../../core/keys';
import { heightAt } from '../../world/worldgen';
import { CUT } from '../../../arena/rules';
import { ITEMS, capacityOf } from '../../sim/items';
import { weightFelt } from '../../sim/powers';
import { MAX_STAMINA } from '../../net/protocol';
import { greyOf, bleedsOutIn, BLOOD } from '../../sim/blood';
import { AVATAR_LAYER, FP_BODY_LAYER, Avatar } from '../avatar';
import { INJECT, RED_DOT } from '../weapons';
import { Stash, WorldItem } from '../loot';
import { RemotePlayer } from '../remote';
import { Jeep } from '../vehicle';
import { JEEP } from '../../sim/vehicles';
import { hpOf } from '../../sim/heli';
import { EMOTE } from '../../sim/emotes';
import { stage } from '../../sim/wells';
import { TOUCH } from '../../core/device';
import { hourAt, DAY } from '../../sim/daynight';
import { FIRE } from '../../sim/fires';
import { bunkerDark } from '../../sim/bunker';
import { rackShows } from '../../sim/crates';
import { ANIMALS } from '../../sim/animals';
import { keyHints } from '../key-hints';
import { LEFT_HELD } from '../building';
import { HOLO_ZOOM, HOT_CODES, _drip, _gasHead, _still, type Game } from '../game';

/** the server unheard this long (ms), the line is said to have stalled */
const STALLED_MS = 2000;

/** what the inventory's left side shows, as a word: the things lying near, and what is in the crate open (see Game.inventoryChanged, which takes it as seen) */
export const nearSig = (near: WorldItem[], open: Stash | null) =>
  near.map((w) => w.loot.uid + w.loot.item.qty).join(',') + (open ? `|${open.container.items.map((p) => p.item.uid + p.item.qty).join(',')}` : '');

export const frameMethods = {
  // ------------------------------------------------------------ frame

  /** @param stamp when the display refresh this frame is for began (the browser's own stamp) */
  frame(this: Game, stamp = performance.now()) {
    const now = performance.now();
    this.perf.begin(now);
    // How far the world moves this frame is measured between refreshes, not between the moments
    // the browser got round to calling us. Those wander by a millisecond or two with whatever
    // else the page is doing, while the picture goes up on the even beat of the display: a
    // step measured on the wandering clock and shown on the even one is motion that judders.
    const dt = Math.min(Math.max(0, stamp - this.last) / 1000, 0.1);
    this.last = stamp;
    const { r, veg, grass, buildings, atmo, world } = this.s;
    const input = this.input;
    const p = this.player;
    const cam = r.camera;
    const playing = this.started && !this.paused && !p.dead;
    // (a controller presses its buttons before anything reads them)
    this.pad?.update(dt);

    if (input.pressed('Tab') && playing) this.toggleInventory();
    // (J: the Crafting tab, straight: shut it from there, or turn the inventory to it. On foot: at a police car's
    // wheel J is the siren, src/game/garage.ts)
    else if (input.pressed('KeyJ') && playing && !this.garage.ride) {
      if (!this.invUI.isOpen) {
        this.toggleInventory(true);
        if (this.invUI.isOpen) this.invUI.setMode('craft');
      } else if (this.invUI.mode === 'craft') this.toggleInventory(false);
      else this.invUI.setMode('craft');
    }
    if (this.awaitClick && (this.input.locked || !playing || this.invUI.isOpen)) this.awaitClick = false;
    if (this.vicinityDue.length && now >= this.vicinityDue[0]) {
      this.vicinityDue.shift();
      if (this.invUI.isOpen) this.invUI.refresh(this.around(), this.openStash);
    }
    // The inventory open: what lies near comes into the list and goes out of it as they walk, and a crate refilled
    // while open (alone, the economy's) is shown. Nothing else redraws it on a clock: it was redrawn whole every 5 s
    // as well, changed or not, until 2026-10-23.
    // (what is in the crates within a few steps, asked for on the way to them: see peekNear)
    if (!this.invUI.isOpen && (this.peekT += dt) > 0.3) {
      this.peekT = 0;
      this.peekNear();
    }
    if (this.invUI.isOpen && (this.vicinityT += dt) > 0.25) {
      this.vicinityT = 0;
      const near = this.around();
      const sig = nearSig(near, this.openStash);
      if (sig !== this.vicinitySig) {
        this.vicinitySig = sig;
        this.openLying();
        this.invUI.refresh(near, this.openStash);
      }
    }
    // (looking at an empty crate of your own, G packs it up instead: see updateInteraction; at a bed of your own with
    // somebody in your party on, G gives it to them: src/game/building/give.ts)
    const gFree = playing && !this.invUI.isOpen && !this.hud.chatOpen && !this.use && !(this.focus instanceof Stash) && !(this.focus instanceof Jeep) && !this.build.give.wantsG;
    if (this.br || this.arenaHud) {
      // (the battle royale and the arena: G held a third of a second drops what is in the hands, as it always did there)
      if (gFree && input.held('KeyG')) {
        this.dropHeld += dt;
        if (this.dropHeld > 0.33 && !this.dropDone) {
          this.dropDone = true;
          this.dropInHands();
        }
      } else {
        this.dropHeld = 0;
        this.dropDone = false;
      }
    } else if (gFree) {
      // G: a tap puts what is in the hands down, held it winds up a throw (src/game/throwing.ts); the wheel puts the
      // throw off, as another slot does (a controller's bumpers are slot keys)
      if (this.throwing.power !== null && (input.wheel !== 0 || HOT_CODES.some((k) => input.pressed(k)))) {
        this.throwing.cancel();
        input.wheel = 0;
      }
      this.throwing.key(input.held('KeyG'), dt);
    } else this.throwing.cancel();
    // M: the map, large; any way out of play puts it away again
    if (input.pressed('KeyM') && playing && !this.invUI.isOpen && !this.shop.isOpen && !this.hud.chatOpen) this.toggleMap();
    else if (this.map.open && (!playing || this.invUI.isOpen || this.shop.isOpen)) this.toggleMap(false);
    // ` : the panel of whoever has a role. And an admin's two keys: N flies (noclip), K sends the view off by itself.
    if (this.role && this.online && this.started && !this.hud.chatOpen) {
      if (input.pressed('Backquote')) this.toggleAdmin();
      if (this.role === 'admin' && playing && !this.invUI.isOpen && !this.shop.isOpen && !this.map.open && !this.adminUI.isOpen) {
        if (input.pressed('KeyN')) this.order('/noclip');
        if (input.pressed('KeyK')) this.toggleFreecam();
        if (input.pressed('Delete')) this.deleteLooked();
      }
    }
    if (this.adminUI.isOpen && (!this.started || this.paused)) this.toggleAdmin(false);
    if (this.hud.emotes.isOpen && (!playing || this.player.dead)) this.toggleEmotes(false);
    const panels = this.invUI.isOpen || this.shop.isOpen || this.map.open || this.adminUI.isOpen || this.hud.emotes.isOpen || this.build.locks.padOpen || this.guide.isOpen;
    // (with the view off by itself, the body does nothing: as with a panel open, but that talk can still be typed)
    const uiOpen = panels || !!this.freecam;
    // Enter opens the chat box, and / opens it with an order begun; while typing the character stands still and the gun stays quiet
    // Typing in the chat, the mouse is let go, to point at what is said and scroll back through it (the owner, 2026-10-16:
    // "when typing in chat the mouse should be unlocked from the character so they can hover over the chat/scroll up");
    // taken again when it shuts, as after the inventory (and if the browser will not, the next click takes it).
    if (this.hud.chatOpen !== this.chatFree && !input.touch && !input.pad) {
      this.chatFree = this.hud.chatOpen;
      if (this.chatFree) {
        input.uiMode = true;
        input.unlock();
      } else if (!this.invUI.isOpen && !this.map.open && !this.adminUI.isOpen && !this.hud.emotes.isOpen) {
        input.uiMode = false;
        if (this.started && !this.paused && !this.player.dead) {
          input.lock();
          setTimeout(() => {
            if (this.started && !this.paused && !this.hud.chatOpen && !input.locked && !this.player.dead) this.awaitClick = true;
          }, 400);
        }
      }
    }
    const order = input.pressed('Slash') || input.pressed('NumpadDivide');
    if ((order || input.pressed('Enter')) && playing && !panels && !this.hud.chatOpen) {
      input.releaseAll();
      this.hud.openChat(order ? '/' : '');
    }
    if (this.hud.chatOpen && (!playing || panels)) this.hud.closeChat();
    const typing = this.hud.chatOpen;
    // A phone has no row of number keys under the fingers: whatever is picked up to fight with
    // comes into the hands by itself when they are empty, unless they were emptied on purpose.
    if (this.touch && playing && !uiOpen && !this.use && !this.garage.ride && !this.handsFree && !this.inv.held() && !this.weapons.busy) {
      const first = this.inv.ring()[0];
      if (first) this.takeUp(first);
    }

    // binoculars come down for anything else: a trigger, a sprint, the pockets, a hit
    if (this.glass && (!playing || uiOpen || this.use || input.pressed('Mouse0') || input.pressed('Mouse2') || p.sprinting || HOT_CODES.some((k) => input.pressed(k)))) {
      this.glass = 0;
      this.glassDown = now;
    }
    this.updateWheel(playing && !uiOpen && !typing && !TOUCH, now);
    // (the building plan and the hammer: before the hands, so that the hammer at a piece is not a swing: src/game/building)
    this.build.update(dt, playing && !uiOpen && !typing && !p.dead && !this.wheelOn && !this.garage.ride);
    this.build.beds.frame(dt, this.started && p.dead);
    // a dance, or hands that are up, ends with the first step, shot or anything else done
    // (one of the pack's movements played once, at its end)
    if (this.hold === 'dance' && this.danced && this.avatar.emoteOver) this.setHold(null);
    if (this.hold && (!playing || uiOpen || typing || !!this.use || !p.grounded || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => input.held(k)) || ['Space', 'KeyC', 'Mouse0', 'Mouse2', 'KeyR', 'KeyG'].some((k) => input.pressed(k)))) this.setHold(null);
    // and a wave with a trigger pulled or a sight raised
    if (this.armsUntil > now && (input.pressed('Mouse0') || input.pressed('Mouse2'))) {
      this.armsUntil = 0;
      this.avatar.emote(null);
    }
    // In a jeep: the view is from behind it, the hands are on the wheel (or in the lap), and
    // getting in or out of one moves the view there rather than cutting to it.
    const ride = this.garage.ride;
    if ((ride?.jeep ?? null) !== this.rode) {
      this.rode = ride?.jeep ?? null;
      this.director.third = ride ? this.garage.view : null;
      this.director.shift(ride ? 0.5 : 0.35);
      if (ride) {
        this.rideAt = now;
        this.setHold(null);
        this.glass = 0;
        if (this.map.open) this.toggleMap(false);
      }
    }
    this.weapons.stowed = !!this.hold || this.armsUntil > now || !!ride || !!this.glass;
    // (slower while aiming, by what the game was made with and by the player's own multiple of that: Settings, Controls)
    const aimed = this.glass ? 0.22 : this.weapons.scoped ? 0.28 : this.weapons.aiming ? 0.7 : 1;
    const sens = aimed < 1 ? aimed * controls().aim : 1;
    if (!uiOpen && playing && !this.wheelOn && !this.build.wheelOpen) p.look(input, sens);
    // (kept with whoever it is watching: it goes as they go, and is flown about them)
    if (this.freecam && this.watching) {
      const r = this.remotes.get(this.watching.id);
      if (!r) {
        this.watching = null;
        this.showPowers();
      } else {
        this.freecam.pos.add(r.pos).sub(this.watching.last);
        this.watching.last.copy(r.pos);
      }
    }
    if (this.freecam && !panels && playing && !typing) this.flyCamera(dt, input);
    // An admin's map, live while it is open (2026-10-13: "the admin map needs to have LIVE updates"): who is on
    // and how they are is asked of the server once a second, and twice a second every dot is put where this game
    // has that player now. (Not every frame: the sheet is drawn again each time.)
    // (and the corner map too, for an admin with names on, while the sheet is shut: everybody else as a dot)
    const cornerPeople = !this.map.open && this.role === 'admin' && this.online && this.namesWanted;
    if (cornerPeople) {
      if ((this.mapAskT -= dt) <= 0) {
        this.mapAskT = 1;
        this.net.send({ t: 'adm' });
      }
      if ((this.mapFeedT -= dt) <= 0) {
        this.mapFeedT = 0.5;
        const out: { x: number; z: number; name: string; dead?: boolean }[] = [];
        for (const q of this.admPlayers.values()) {
          if (q.id === this.net.id) continue;
          const r = q.alive ? this.remotes.get(q.id) : undefined;
          out.push({ x: r ? r.pos.x : q.x, z: r ? r.pos.z : q.z, name: q.name, dead: !q.alive });
        }
        this.minimap.setPeople(out);
      }
    } else if (!this.party.marks.length) this.minimap.setPeople([]);
    if (this.map.open && this.role === 'admin' && this.online) {
      if ((this.mapAskT -= dt) <= 0) {
        this.mapAskT = 1;
        this.net.send({ t: 'adm' });
      }
      if ((this.mapFeedT -= dt) <= 0) {
        this.mapFeedT = 0.5;
        this.feedMap();
      }
    }

    // (The legs are free while the inventory is open: it is walked about with, to see what lies near, as in DayZ.
    // What is nearby is read again as it changes: see `vicinityT`. The trader's counter is stood at.)
    const canMove = (!uiOpen || ((this.invUI.isOpen || this.map.open) && !this.shop.isOpen)) && playing && !typing;
    const moveInput = canMove ? input : NULL_INPUT;
    // (are the hands empty: asked of what is in them, and every frame. It was asked five times a second, and of
    // which slot the inventory said was out, which is not the same thing when what was out has been dropped.)
    p.emptyHanded = this.weapons.handsEmpty && !this.use;
    // talking: V held down (the first time it is, the browser asks whether this site may use the microphone)
    if (this.online) {
      if (playing && !typing && !uiOpen && input.pressed('KeyV')) {
        void this.voice.talk().then((wrong) => {
          if (wrong && !this.voiceSaid) this.hud.note(wrong, 'warn');
          this.voiceSaid ||= !!wrong;
        });
      }
      if (this.voice.talking && (!input.held('KeyV') || !playing)) this.voice.hush();
      const speaking = this.voice.update((id) => this.remotes.get(id)?.pos ?? null, p.pos);
      this.hud.voice(this.voice.talking, speaking.map((id) => this.remotes.get(id)?.name ?? '').filter(Boolean));
    }
    // hunger and thirst, said once each as they get worse (and what they do is said with them)
    if (playing) {
      const now2 = [stage(p.vitals.energy), stage(p.vitals.water)];
      if (now2[0] > this.wanting[0]) this.hud.note(now2[0] === 2 ? 'You are starving: your hands shake, and your breath is slow to come back. Eat' : 'You are hungry: your aim is less steady. Eat something', 'warn');
      if (now2[1] > this.wanting[1]) this.hud.note(now2[1] === 2 ? 'You are parched: you cannot run flat out. Drink, or find a well, a river or a lake' : 'You are thirsty: your breath comes back slower. Drink, or find a well (on the map), a river or a lake', 'warn');
      this.wanting = now2;
    }
    // carried weight and gear effects only change with the inventory: a few times a second is plenty
    this.slowT += dt;
    if (this.slowT > 0.2) {
      this.slowT = 0;
      p.weightKg = weightFelt(this.inv.weight(), this.powers.weightless);
      p.fallMult = this.inv.wear('fall').reduce((a, b) => a * b, 1);
      p.thirstMult = this.inv.wear('thirst').reduce((a, b) => a * b, 1);
      p.needMult = this.build.homeEase(p.pos.x, p.pos.z);
      this.hasCompass = !!this.inv.find((i) => i.id === 'compass');
    }
    this.tagT += dt;
    if (this.tagT >= 1) {
      // (every vehicle nobody is in, whatever its game is doing with it; to an admin every one: see setJeeps)
      const all = this.role === 'admin';
      this.minimap.setJeeps([...this.garage.jeeps.values()].filter((j) => !j.wreck && (all || j.seats.every((s) => s === null))).map((j) => ({ x: j.pos.x, z: j.pos.z, ...(j.kind ? { k: j.kind } : {}) })));
      if (this.started && !p.dead) this.tickTags(this.tagReal());
      else {
        this.hud.setTags([]);
        this.takenTags = [];
        this.tagWall = Date.now();
      }
      this.tagT = 0;
    }
    this.tickZone(dt);
    physics.step(dt, (h) => {
      this.garage.step(h, moveInput);
      p.step(h, moveInput);
      // A key press belongs to one simulation step, however many of them this frame needs:
      // seen by two, a single tap of C crouches and stands straight back up.
      input.consumeFixed();
      // (what is drawn is judged from the eye, not the body: an admin's free camera a kilometre off saw the towns' furniture with no houses round it)
      buildings.update(h, this.s.r.camera.position);
    });
    if (this.started) p.tickVitals(dt);
    this.gas.update(dt, this.s.r.camera.position, _gasHead.set(p.pos.x, p.pos.y + (p.crouched ? 1.0 : 1.6), p.pos.z), this.started && !p.dead && !this.powers.god);
    this.lightStep(dt, playing && !uiOpen && !typing);
    // the fires: the infected hear one crackle, and whoever is beside one mends
    for (const at of this.fires.update(dt, this.s.r.camera.position)) this.horde.noise(at.x, at.z, FIRE.heard);
    this.gather.update(dt);
    this.craft.update(dt);
    this.forges.update(dt);
    this.recyclers.update(dt, this.player.pos);
    audio.machine(dt, this.recyclers.loudest(this.player.pos));
    this.salvage.update(dt);
    this.wrecks.update(dt);
    // the lockers' doors: open while one is searched, by this player or (the server says) by anybody
    this.lockers.update(dt, this.s.r.camera.position, this.openStash?.uid ?? null);
    // (offline a rack shows what is in it as it is; online the server says: see GunRacks)
    if (!this.online && (this.rackT += dt) > 0.5) {
      this.rackT = 0;
      for (const st of [...this.loot.crates, ...this.build.boxes.racks()]) if (this.racks.has(st.uid)) this.racks.show(st.uid, rackShows(st.container.items.map((p) => ({ id: p.item.id, y: p.y }))));
    }
    this.racks.update(this.s.r.camera.position);
    for (const f of this.beside) f(dt, this.s.r.camera.position, this.s.r.camera);
    // (Resting by a fire, mending or only warm; a broken leg; the air breathed: each was a word at the top of the
    // screen, and is a badge beside the survivor's health now, for as long as it is so. Why a fire is doing no good,
    // when it is not, is said beside its badge in the inventory: src/ui/status.ts.)
    this.byFire = this.started && !p.dead && this.fires.warm(p.pos) ? (p.rest(FIRE.heal * dt) ? 'mending' : 'warm') : null;
    // (and whoever stands in the flames of the jeep that burns before the fort is burned: src/sim/wreck-fire.ts)
    const scorched = this.wreck && this.started && !p.dead && !ride && !this.powers.god ? this.wreck.burn(dt, p.pos) : 0;
    if (scorched > 0) {
      p.damage(scorched, 'a burning wreck');
      this.meDirty = true;
    }

    // a part waiting on its gun: fitted, or taken off, the moment the gun is up (and forgotten if something else was taken up instead)
    if (this.fitting) {
      const f = this.fitting;
      f.t += dt;
      if (this.inv.held() !== f.gun || f.t > 4 || p.dead) this.fitting = null;
      else if (!this.weapons.busy) {
        this.fitting = null;
        f.run();
      }
    }

    this.unbury(dt, !!ride);

    // the hot keys: each brings up what is on it (and puts it away again); X empties the hands
    // (not with a grenade's pin coming out, or out: those hands are spoken for until it has left them)
    // (in a seat, Ctrl and a number is a seat of the vehicle, as in DayZ: the owner, "change vehicle position with
    // ctrl 1-4, Or ctrl 1-2 for heli". The browser is kept from taking it for one of its tabs while seated.)
    input.seatKeys = !!ride;
    const seatKeys = !!ride && (input.held('ControlLeft') || input.held('ControlRight'));
    if (playing && !uiOpen && !typing && !p.dead && seatKeys) HOT_CODES.slice(0, 4).forEach((k, i) => input.pressed(k) && this.garage.swap(i));
    else if (playing && !uiOpen && !typing && !p.dead && !this.cook) {
      // (the battle royale's six slots are its own: src/game/br/mode.ts)
      if (this.br) this.br.keys();
      else HOT_CODES.forEach((k, i) => {
        if (input.pressed(k)) this.hot(i);
      });
      if (input.pressed('KeyX') && (this.inHand || this.use)) this.emptyHands();
    }

    // A thing in the hand that is not a weapon: holding the left button uses it. The wheel puts it away (and goes
    // on to the next weapon); it is kept in the hand through everything else, the inventory included.
    if (this.ready) {
      const r = this.ready;
      r.t += dt;
      const kept = this.inv.held() === r.item;
      // (a magazine: the wheel turns over what the button does with it, filling or emptying, and it stays in the hand)
      if (kept && !p.dead && input.wheel !== 0 && !uiOpen && this.turnMagWork()) input.wheel = 0;
      // (the wheel goes on to the next thing on the hot bar from this one; with no other, it is put away)
      if (kept && !p.dead && input.wheel !== 0 && !uiOpen && this.wheelStep(input.wheel > 0 ? 1 : -1)) input.wheel = 0;
      if (p.dead || !kept || (input.wheel !== 0 && !uiOpen)) this.putAway();
      // (the building plan's left button is the building's: it lays a piece; a lock's fits it, a charge's sticks it)
      else if (playing && !uiOpen && !typing && r.t > 0.3 && !LEFT_HELD.has(r.item.id) && (input.pressed('Mouse0') || (input.held('Mouse0') && r.t > 0.55))) this.handFire(r.item);
    }

    // a grenade: its pin coming out, and then live in the hand until the button is let go (see `cook`)
    if (this.cook) this.cooking(dt, input, uiOpen);

    // timed item use (eat, drink, bandage, open a box): shown in the hands; the wheel or the other button breaks it off
    if (this.use) {
      const u = this.use;
      u.t += dt;
      u.soundT += dt;
      if (u.sound === 'inject') {
        // one sound, a breath before the shot lands (weapons.ts, INJECT.hit)
        if (u.soundT >= 0 && u.t > INJECT.hit - 0.04) {
          u.soundT = -1e9;
          audio.ui('inject');
        }
      } else if (u.sound && u.sound !== 'smoke' && u.soundT > 1.05 && u.t < u.dur - 0.4) {
        u.soundT = 0;
        audio.ui(u.sound);
      }
      if (u.dig !== undefined) {
        // (a stroke, and the next when that one is done: each is heard going in, and coming out with what it lifted)
        if (this.weapons.dig()) u.dig = 0;
        const k = this.weapons.digStroke;
        if (u.dig < 1 && k > 0.3) {
          u.dig = 1;
          audio.dig(0);
        } else if (u.dig < 2 && k > 0.7) {
          u.dig = 2;
          audio.dig(1);
        }
      }
      const gone = !!u.valid && !u.valid();
      if (gone || p.dead || ((input.pressed('Mouse2') || input.wheel !== 0) && !uiOpen) || (this.holding && !uiOpen && !input.held('Mouse0'))) {
        input.wheel = 0;
        if (gone && u.lost && !p.dead) this.hud.note(u.lost, 'info');
        this.breakOff();
      } else if (u.t >= u.dur) {
        this.use = null;
        const hold = this.holding;
        u.done();
        // (what is done a round at a time has begun on the next one: the button is still what keeps it going)
        if (this.use) this.holding = hold;
        else if (this.inHand) this.rest();
        else this.weapons.endUse();
      }
    }

    // weapons + fov
    const fpLive = this.director.blend > 0.9;
    this.garage.frame(dt, now, physics.alpha, cam.position);
    // (at the trader camp the guns stay down: nobody is hurt there, src/game/camp.ts)
    const camped = this.camp.within(this.player.pos);
    this.weapons.update(dt, input, cam, fpLive && !uiOpen && playing && !this.use && !this.ready && !this.cook && !typing && !this.glass && !this.wheelOn && !this.build.wheelOpen && !this.hold && !ride && !camped);
    this.grenades.update(dt);
    this.toys.update(dt);
    this.throwing.update(dt);
    this.updateBarrels(dt);
    const kind = this.weapons.equippedItem ? ITEMS[this.weapons.equippedItem.id].weapon?.kind : undefined;
    // a sprint opens the view a touch: speed you can feel
    this.director.fovMul = ride ? this.garage.fov : this.glass ? this.glass : this.weapons.scoped ? this.weapons.scopeFov(this.director.baseFov) : this.weapons.aiming ? (this.weapons.equippedItem?.mods?.some((m) => m === 'red_dot' || m === RED_DOT) ? HOLO_ZOOM : kind === 'rifle' ? 0.78 : 0.8) : p.sprinting && p.moving > 0.6 ? 1.055 : 1;
    this.syncHeld();

    this.director.update(dt);
    this.drawNames(cam);
    if (this.director.avatarVisible) cam.layers.enable(AVATAR_LAYER);
    else cam.layers.disable(AVATAR_LAYER);
    // your own body below the camera, first person only
    // before you deploy: something going on in the Zone behind the menu, or (between those, and
    // until their people have arrived) the middle of the map from the air
    if (!this.started) {
      this.menuOn = true;
      // (a page cut down to the arena has none of the open world's scenes to show: its fort, from the air)
      if (CUT.arena || !this.menu.update(dt, cam)) this.menuCamera(now);
      this.hud.menuScene(CUT.arena ? '' : this.menu.caption, CUT.arena ? 0 : this.menu.fade);
      // (a long lens brings the far wood near: its trees are drawn as trees as far as the lens makes them large)
      this.s.veg.setReach(THREE.MathUtils.clamp(Math.tan((62 * Math.PI) / 360) / Math.tan((cam.fov * Math.PI) / 360), 1, 2.6));
    }
    else if (this.menuOn) {
      // a game has begun: the caption and the cut off, the trees as they are in play
      this.menuOn = false;
      this.hud.menuScene('', 0);
      this.s.veg.setReach(1);
    }
    const fpView = this.started && this.director.viewmodelVisible && !p.dead && !this.garage.ride;
    if (fpView) cam.layers.enable(FP_BODY_LAYER);
    else cam.layers.disable(FP_BODY_LAYER);
    r.vmScene.visible = fpView && !this.glass;
    const interp = new THREE.Vector3().lerpVectors(p.prevPos, p.pos, physics.alpha);
    this.avatar.setLean(p.dead ? 0 : p.lean);
    this.riders.update(dt);
    if (this.garage.ride) {
      this.avatar.update(dt, p.pos, _still, this.garage.ride.jeep.yaw, false, p.dead, true, 0, true, false);
      this.garage.seatBody();
    } else {
      this.avatar.guarding = this.weapons.guarding;
      this.avatar.limping = !!p.vitals.broken;
      this.avatar.setProne(p.prone);
      this.avatar.update(dt, interp, p.vel, p.yaw, p.crouched, p.dead, true, 0, p.grounded, this.weapons.aiming);
    }
    // the step you hear and the bob you see are the body's own
    p.stride = this.avatar.stride;
    if (this.avatar.footfall) p.footfall();
    if (this.avatar.pull) p.pulled();
    for (const d of this.dummies) {
      if (Math.abs(d.pos.x - interp.x) + Math.abs(d.pos.z - interp.z) < 260) d.update(dt);
    }
    Avatar.eye.copy(cam.position);
    Avatar.ground ??= (x, z) => heightAt(this.s.world.heights, x, z);
    // (what the eye takes in, for the infected as for everybody else: see inSight)
    RemotePlayer.look(cam);
    this.horde.lens = Math.tan((62 * Math.PI) / 360) / Math.tan((cam.fov * Math.PI) / 360);
    this.horde.update(dt, now, cam.position);
    if (!this.online) this.wild.tickAlone(dt);
    this.wild.update(dt, now, cam.position, cam);
    for (const rp of this.remotes.values()) {
      rp.update(dt, now, cam.position);
      rp.avatar.veil(this.s.buildings.hides(cam.position, rp.pos));
      if (rp.bleeding && rp.alive && (rp.dripT -= dt) <= 0) {
        rp.dripT = 0.3 + Math.random() * 0.35;
        if (rp.pos.distanceToSquared(cam.position) < 90 * 90) this.effects.drip(_drip.set(rp.pos.x, rp.pos.y + (rp.crouched ? 0.55 : 0.95), rp.pos.z));
      }
    }
    // (a dot over each of your party who is about, their name over it near; and twice a second where they all are, on
    // the maps and the compass: an admin's corner map with names on shows everybody instead)
    if (this.party.update(this.remotes, cam.position, dt)) {
      const m = this.party.marks;
      if (!(this.role === 'admin' && this.online && this.namesWanted)) this.minimap.setPeople(m.map((q) => ({ ...q, mate: true })));
      this.map.setMates(m);
      this.hud.compassMates = m.map((q) => Math.round(THREE.MathUtils.radToDeg(Math.atan2(q.x - p.pos.x, p.pos.z - q.z))));
    }
    // your own wound leaves the same trail: it is how you are followed
    if (p.vitals.bleeding && !p.dead && this.started && (this.dripT -= dt) <= 0) {
      this.dripT = 0.3 + Math.random() * 0.35;
      this.effects.drip(_drip.set(interp.x, interp.y + (p.crouched ? 0.55 : 0.95), interp.z));
    }

    this.updateInteraction(cam);
    if (this.build.prompt) this.prompt = this.build.prompt;
    this.traders?.update(dt, cam.position);
    // (whoever walks off from the counter, or is killed at it, is done trading)
    if (this.shop.isOpen && (p.dead || !this.traders?.by(p.pos, this.camp.stall))) this.shop.close();
    this.minimap.update(interp.x, interp.z, p.yaw);
    this.map.update(interp.x, interp.z, p.yaw);
    this.effects.eye.copy(cam.position);
    // the smoke over each supply drop (not from the far side of the map: nobody could see it)
    // (and over each place one has been called to, until it lands)
    if (this.calls.length) {
      const nowMs = performance.now();
      if (this.calls.some((c) => c.until < nowMs)) {
        this.calls = this.calls.filter((c) => c.until >= nowMs);
        this.markDrops();
      }
      for (const c of this.calls) if (c.at.distanceToSquared(cam.position) < 420 * 420) this.effects.signal(c.at, c.smoke, dt);
    }
    for (const d of this.drops.values()) if (d.at.distanceToSquared(cam.position) < 420 * 420) this.effects.signal(d.at, d.smoke, dt, !!d.wreck);
    this.effects.update(dt);
    this.loot.update(cam.position, dt, cam);
    this.near.update(cam.position, dt);
    // (The thing looked at, close enough to pick up: its pictures at the size they came, as if it were in the
    // hands already. Everything further off is drawn with the world's copies, which at that distance are more
    // than the screen has pixels for.)
    const close = this.focus instanceof WorldItem ? this.focus : null;
    if ((this.sharpFocus?.of ?? null) !== close) {
      const was = this.sharpFocus;
      this.sharpFocus = close ? { of: close, drop: assets.sharpen(close.paints(), true) } : null;
      was?.drop();
    }

    // world simulation ticks (the server does this when online)
    this.econT += dt;
    if (this.econT > 5) {
      // (Alone, and not on the way in to a server. On the bot check's range the game is started and not yet on any
      // server: until 2026-10-13 its own loot clock ran there, and laid out the whole map's loot, some fourteen
      // hundred things of its own making, which then lay about among the server's. See `enterOnline`.)
      if (!this.online && this.started && !this.joining) {
        this.economy.tick(this.econT, [p.pos]);
        this.tickCrates();
        this.tickDrops();
      }
      this.econT = 0;
      this.tagWhenDue();
    }
    this.saveT += dt;
    if (this.saveT > 20 && playing) {
      this.saveT = 0;
      this.save();
    }
    if (this.botCheck?.active) {
      this.botCheck.update(dt);
      // (nobody is kept on the range by an empty magazine)
      const held = this.weapons.equippedItem;
      if (held?.id === 'ar15' && (held.loaded ?? 0) < 4) Object.assign(held, { mag: 'mag_ar', loaded: 31 });
    }
    this.sendState(dt);
    this.br?.tick(dt, cam);
    // (the arena's screen: health, the gun in hand and what is in it, whether only looking on, and the scoreboard while Tab is held)
    if (this.arenaHud) {
      const gun = this.weapons.equippedItem;
      this.arenaHud.tick(p.vitals.health, gun?.id ?? null, gun?.loaded ?? 0, gun && ITEMS[gun.id]?.weapon ? capacityOf(gun) : 0, this.powers.hidden, input.held('Tab'));
    }

    // points of interest
    const here = world.pois.find((q) => Math.hypot(q.x - p.pos.x, q.z - p.pos.z) < q.radius);
    if (here && here.name !== this.poi && this.started && !this.botCheck?.active) this.hud.area(here.name);
    this.poi = here?.name ?? null;

    // vitals warnings
    const v = p.vitals;
    if (v.energy < 25 && !this.warned.hunger) {
      this.hud.note('You are hungry', 'warn');
      this.warned.hunger = true;
    } else if (v.energy > 35) this.warned.hunger = false;
    if (v.water < 25 && !this.warned.thirst) {
      this.hud.note('You are thirsty', 'warn');
      this.warned.thirst = true;
    } else if (v.water > 35) this.warned.thirst = false;
    if (p.dead && !this.deathSent) {
      this.deathSent = true;
      this.diedAt = performance.now();
      this.report.reset();
      audio.death();
      // Which way the body goes: away from what killed it. With nothing to throw it (blood
      // loss, a fall, hunger) it folds up where it stands.
      let variant = Math.random() < 0.5 ? 1 : 2;
      if (this.lastHit && now - this.lastHit.at < 2500) {
        const along = this.lastHit.x * -Math.sin(p.yaw) + this.lastHit.z * -Math.cos(p.yaw);
        variant = along > 0.4 ? 1 : along < -0.4 ? 0 : 2;
      }
      this.avatar.setDeath(variant);
      if (!this.deathInfo) this.deathInfo = `You died of ${p.lastCause === 'fall' ? `a fall of ${Math.round(p.lastFall.drop)} m` : p.lastCause || 'your injuries'}. Your gear lies where you fell.`;
      if (this.invUI.isOpen) this.toggleInventory(false);
      this.input.unlock();
      if (this.online) {
        // last word on what we were carrying, then the server leaves a body with it
        this.net.send({ t: 'me', inv: this.inv.serialize(), vitals: { ...p.vitals } });
        // (a fall says how far and how fast: it is what the server writes down, and what everybody reads)
        this.net.send({ t: 'died', cause: p.lastCause === 'fall' ? `fall ${Math.round(p.lastFall.drop)}m ${Math.round(p.lastFall.speed)}m/s` : p.lastCause || 'injuries', v: variant });
        this.inv.clear();
        this.weapons.validate();
      }
    } else if (!p.dead) this.deathSent = false;
    // (dead, the mouse stays free for the death screen's map: a panel shut as they died, or a click caught on its way,
    // took it back, 2026-10-27: "when the respawn map shows up sometimes my mouse is not free and i cant select where i
    // want to spawn")
    else if (this.deathSent && this.input.locked && now - this.diedAt > 250) this.input.unlock();

    // the hour: before a game has begun it is always day behind the menu
    const hour = hourAt(this.started ? this.hourNow() : this.menu.hour);
    // (an admin's night vision: what is seen is the day behind the menu; what hour it is, is as it was)
    const seen = this.nightSight && this.started ? hourAt(DAY.menu) : hour;
    atmo.setHour(seen.light, seen.low);
    if (this.started && hour.night !== this.wasNight) {
      if (this.wasNight !== null) this.hud.note(hour.night ? 'Night has fallen' : 'First light', hour.night ? 'warn' : 'good');
      this.wasNight = hour.night;
    }
    atmo.update();
    veg.update(dt, cam);
    this.s.terrain.update(cam);
    grass.update(cam, interp);

    // audio
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position, fwd, new THREE.Vector3(0, 1, 0));
    if (Math.random() < 0.1) {
      this.indoors = physics.raycast(cam.position, { x: 0, y: 1, z: 0 }, 12, SHOT_GROUPS, p.collider) !== null;
      // forest floor underfoot means trees overhead: leaves instead of open-field insects
      this.inForest = this.s.terrain.surfaceAt(p.pos.x, p.pos.z) === 'dirt';
    }
    audio.updateAmbience(dt, cam.position, this.indoors, this.inForest, bunkerDark(this.bunker.place, cam.position.x, cam.position.y, cam.position.z));
    // (the helicopter and its crate: put where the flight's clock has them, and the rotor heard from where it is)
    this.airdrops.update(dt, cam.position, seen.light, this.indoors, bunkerDark(this.bunker.place, cam.position.x, cam.position.y, cam.position.z));
    // breathing follows how much of the reserve is left, as a percentage
    if (this.started) audio.body(dt, (v.stamina / MAX_STAMINA) * 100, v.health, !p.dead, v.bleeding);

    // post-fx reacting to state
    const hurt = p.hurt;
    r.chroma.offset.set(hurt * 0.004 + (v.health < 25 ? 0.0015 : 0), hurt * 0.002);
    // (and the blood: the colour goes out of the world as it is lost, and below what a head can work on the edges
    // of the picture close in and open again, slowly, as a pulse does)
    const grey = p.dead || !this.started ? 0 : greyOf(v.blood);
    r.grade.saturation = -0.08 - grey * 0.82;
    r.vignette.darkness = 0.42 + (this.weapons.aiming ? 0.12 : 0) + (v.health < 25 ? 0.25 : 0) + (p.faint ? 0.3 + 0.14 * Math.sin(now / 520) : grey * 0.1);
    this.sayBlood();
    this.wince(dt);

    const hasCompass = this.hasCompass;
    const heading = THREE.MathUtils.radToDeg(-p.yaw);
    this.updateSaid(now);
    // (a line held up is said while it is, and how long: see Net.lag. Not just after a long frame of this page's own,
    // with what came meanwhile maybe not yet read.)
    const lag = this.online ? this.net.lag(this.remotes.size > 0) : 0;
    if (this.online && lag > STALLED_MS !== this.net.stallSaid && (this.net.stallSaid || dt < 0.25)) {
      this.net.stallSaid = !this.net.stallSaid;
      this.hud.setNet(this.net.stallSaid ? 'Connection stalled: what you see is out of date' : 'Online');
      if (this.net.stallSaid) this.hud.note('Your connection to the server has stalled: others still see you, you do not see them move', 'warn');
    }
    // (and stalled for good: given up and made again, see Net.dead and Game.rejoin)
    if (this.online && this.net.dead(this.remotes.size > 0, dt < 0.25)) this.net.giveUp();
    this.hud.update({
      dt,
      vitals: v,
      winded: p.outOfBreath,
      // no keyboard on a phone: the Use button lights up instead of naming a key
      prompt: this.awaitClick ? '<kbd>Click</kbd>to look around' : this.touch ? (this.prompt?.replace(/<kbd>F<\/kbd>/, '').replace(/ <small>G to [^<]*<\/small>/, '').replace('W A S D to drive · Space is the handbrake', 'the stick drives · the jump button is the handbrake') ?? null) : this.prompt,
      mark: this.awaitClick ? null : this.mark,
      acts: this.awaitClick ? null : this.handActs(),
      keys: keyHints(this),
      stance: this.awaitClick || p.dead || this.garage.ride ? null : p.prone ? 'prone' : p.crouched ? 'crouch' : 'stand',
      touch: !!this.touch,
      weapon: this.garage.ride ? null : this.weapons.status(),
      aiming: this.weapons.aiming,
      spread: this.weapons.spread,
      lag: this.lagPx(),
      arms: this.weapons.armStamina,
      ride: this.garage.ride && !p.dead ? { seats: this.garage.seatList(), kmh: Math.abs(this.garage.ride.jeep.speed) * 3.6, fuel: this.garage.ride.jeep.fuel / JEEP.tank, hp: this.garage.ride.jeep.hp / hpOf(this.garage.ride.jeep.kind), driver: this.garage.ride.seat === 0 } : null,
      scoped: this.weapons.scoped,
      reticle: this.weapons.reticleKind,
      range: this.weapons.ranged ? this.weapons.range : undefined,
      zoom: this.weapons.scoped ? this.weapons.zoom : null,
      breath: this.weapons.breathLeft,
      steady: this.weapons.steady,
      sightless: this.weapons.sightless,
      glass: !!this.glass,
      hitMarker: this.weapons.hitMarker,
      kill: this.weapons.killMarker,
      head: this.weapons.headMarker,
      hurt,
      bleed: v.bleeding && !p.dead ? { rate: v.bleed, left: bleedsOutIn(v.blood, v.bleed), hint: this.bleedHint() } : null,
      lowBlood: !v.bleeding && !p.dead && this.started && v.blood < BLOOD.grey[0] - 200 ? this.bloodHint() : null,
      drip: p.drip.left > 0,
      gas: this.gas.air,
      fire: this.byFire,
      heading: !uiOpen ? heading : null,
      bearing: hasCompass,
      progress: this.throwing.power !== null ? { label: 'Throw', t: this.throwing.power } : this.cook ? this.cookShown() : this.use ? { label: this.use.label, t: this.use.t / this.use.dur } : this.gather.shown() ?? this.salvage.shown() ?? (this.ready && !LEFT_HELD.has(this.ready.item.id) ? { label: `${ITEMS[this.ready.item.id].name}: ${this.ready.item.id === 'torch' ? (this.build.torches.lit ? 'L puts it out' : 'L lights it') : ITEMS[this.ready.item.id].throw ? (this.touch ? 'hold fire to cook it, let go to throw' : 'hold the left button to cook it, let go to throw · its key again puts it away') : this.touch ? 'fire to use it' : 'hold the left button to use it · its key again puts it away'}`, t: -1 } : null),
      boost: p.boost,
      hotbar: this.hotbar(),
      fps: this.fps,
      ping: this.online ? lag : null,
      dead: p.dead,
      deadText: this.deathInfo,
      hidden: uiOpen || !this.started,
    });

    // (what G would do here gets a button of its own beside Use)
    // (the Close button it shows is the inventory's and the trader's: the map has its own way out)
    this.touch?.update(playing && !uiOpen && !typing, this.invUI.isOpen || this.shop.isOpen, !!this.prompt?.includes('<kbd>F'), {
      // (and with something in the hands, G's own button: a tap drops it, held it throws, 2026-10-23. Not in the battle royale or the arena.)
      g: this.prompt?.includes('G to pour') ? 'Fuel' : this.prompt?.includes('G to pack up') ? 'Pack' : this.throwing.power !== null ? 'Throw' : !this.br && !this.arenaHud && (this.inv.held() ?? this.inHand) ? 'Drop' : null,
      aiming: this.weapons.aiming,
      lamp: this.weapons.hasLamp || this.inv.count('flashlight') > 0,
      lit: this.lit,
      talk: this.online && this.voice.supported,
      talking: this.voice.talking,
      low: !this.garage.ride && (p.crouched || p.prone),
    });
    this.perf.beforeRender();
    // (a blast near by throws the view off for a moment: laid on the eye last of all, so nothing aims by it)
    const sh = this.effects.shake;
    if (sh.pitch || sh.yaw || sh.roll) {
      const eye = this.s.r.camera;
      eye.rotateX(sh.pitch);
      eye.rotateY(sh.yaw);
      eye.rotateZ(sh.roll);
      eye.updateMatrixWorld();
    }
    // (the draw distance is where the world ends, as Minecraft's does: past it nothing is drawn, the last quarter of the
    // way to it closing in haze (see the fog in atmosphere.ts). The owner, 2026-10-18: "when i have my render distance at
    // 600m how come the entire map contonies to load past that? why not stop it like minecraft rander distance". The
    // menu's view keeps the whole of it.)
    const far = this.started && !(import.meta.env.DEV && (globalThis as { __fullFar?: boolean }).__fullFar) ? Math.max(200, this.gfx.draw) : 1800;
    if (r.camera.far !== far) {
      r.camera.far = far;
      r.camera.updateProjectionMatrix();
    }
    // (animals within ANIMALS.told, or an admin's own distance, and never past the draw distance: the server told of it)
    const reach = Math.min(this.role ? this.animalsFar : ANIMALS.told, this.started ? Math.max(200, this.gfx.draw) : ANIMALS.told);
    this.wild.far = reach;
    if (this.online && this.animalsAsked !== reach) {
      this.animalsAsked = reach;
      this.net.send({ t: 'adist', m: reach });
    }
    r.render(dt);
    // (the inventory painted unseen once, two seconds into the first play of the page, so its first Tab is like any other: InventoryUI.paintAhead)
    this.invUI.paintAhead(this.started && !this.paused && !this.player.dead && !this.invUI.isOpen && !this.map.open, () => this.around(), this.player.vitals);
    // (the figure in the inventory, laid over the game's picture where the page shows it: nothing, while that is shut)
    this.doll?.draw(dt);
    // (and Emotes' survivor, doing what is picked there, made the first time it is opened)
    if (this.hud.emotes.isOpen) {
      const fig = this.emoteDoll();
      fig.perform(EMOTE[this.hud.emotes.doing] ?? null);
      fig.draw(dt);
    } else this.hud.emotes.shown(false);
    this.perf.afterRender();
    input.endFrame();

    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsN / this.fpsAcc;
      // struggling for a while: point at the options once (the game never lowers them itself)
      this.slowFor = playing && this.fps < 28 && !(this.gfx.fpsLimit && this.gfx.fpsLimit <= 30) ? this.slowFor + this.fpsAcc : 0;
      if (this.slowFor > 8 && !this.slowHinted) {
        this.slowHinted = true;
        this.hud.note(TOUCH ? 'Low frame rate: open the menu, then Settings' : 'Low frame rate: press Esc and open Settings', 'warn');
        this.hud.chatLine('system', '', `The frame rate is low. ${TOUCH ? 'Open the menu' : 'Press Esc'} and open Settings to turn the graphics down.`);
      }
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
  },
};
