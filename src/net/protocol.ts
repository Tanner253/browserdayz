// Wire protocol between the game client and the server. JSON text frames over one
// WebSocket. Shared by both sides so a change that breaks one fails to compile.
//
// Who decides what:
//   server  - which loot exists, who picked an item up first, what is inside crates,
//             stashes and bodies, how much a hit hurts, who is alive, where you spawn
//   client  - its own movement and aim, its own inventory, whether its shot hit

import type { ItemInstance } from '../sim/items';
import type { SerializedInventory } from '../sim/inventory';
import type { WorldLoot } from '../sim/economy';
import type { HitZone } from '../sim/combat';
import type { DropInfo } from '../sim/drops';
import type { VehicleInfo, VState } from '../sim/vehicles';
import type { IState, InfectedInfo } from '../sim/infected';

// (36, 2026-10-13: the jacket and the trousers are things worn in `top` and `legs`, with the pockets inside them. A
// page from before would say "nothing in my pockets" of a character that has them full, and the server would keep it.)
export const PROTOCOL = 36;

/** chat channels: everyone on the server, or only players standing near the speaker */
/** `staff`: those with a role, to one another, wherever they are: nobody else is sent it */
export type ChatChannel = 'global' | 'near' | 'staff';
/** how far proximity chat carries, metres */
export const CHAT_RANGE = 50;

/** player state flags */
export const F_CROUCH = 1, F_SPRINT = 2, F_AIM = 4, F_GROUND = 8, F_DEAD = 16, F_BLEED = 32;
/** what the body is doing for as long as it is left to (see src/sim/emotes.ts): dancing, hands up */
export const F_DANCE = 64, F_SURRENDER = 128;
/** sat down on the ground (the wheel) */
export const F_SIT = 16384;
/** lying down (Z) */
export const F_PRONE = 32768;
/**
 * Leaning out to one side (Q, E). The eyes of whoever leans go half a pace sideways: so do
 * their head and shoulders as everybody else sees them, and as everybody else's bullets
 * find them. (A game that was never told of these simply shows nobody leaning.)
 */
export const F_LEAN_L = 256, F_LEAN_R = 512;
/** sitting in a jeep (which one, and where in it, the server says: see 'vseat') */
export const F_SEAT = 1024;
/** on guard: fists up, or something to strike with held across, to stop a blow (see INFECTED.guardArc) */
export const F_GUARD = 2048;
/** on a broken leg: it shows in how they walk */
export const F_LIMP = 4096;
/** a light lit: the one on their gun if it has one, or the flashlight they carry */
export const F_LIGHT = 8192;
/** how far the head goes sideways at a full lean, metres (the camera's own figure: see Player.updateCamera) */
export const LEAN_REACH = 0.34;

/** things a player does with their hands that the people around them can see (and hear) */
// ('load': one round pushed into a magazine; 'unbox': a box of rounds torn open. Both are small sounds, heard close to.)
// ('check': a gun turned over in the hands and looked at.)
export const ACTS = ['bolt', 'reload', 'eat', 'drink', 'bandage', 'open', 'load', 'unbox', 'check', 'stop'] as const;
export type Act = (typeof ACTS)[number];

/** [x, y, z, yaw, pitch, flags] */
export type Pose = [number, number, number, number, number, number];

/** a full stamina reserve: about 27 seconds of sprinting */
export const MAX_STAMINA = 300;

export interface Vitals {
  health: number;
  energy: number;
  water: number;
  stamina: number;
  bleeding: boolean;
  /** blood, ml, and what every open wound together costs of it a second (src/sim/blood.ts). Not said by a game or a save from before 2026-10-13: all of it, then, and one wound if `bleeding`. */
  blood?: number;
  bleed?: number;
  /** a broken leg (see src/sim/injury.ts) */
  broken?: boolean;
}

export interface PlayerInfo {
  id: number;
  name: string;
  pose: Pose;
  /** item id in hands (null = bare hands) and its attachments */
  w: string | null;
  m: string[];
  /** what they wear that shows: hat, vest, pack */
  g: string[];
  /** what is slung on their back and not in their hands: up to two things, each with what is fitted to it */
  b?: Slung[];
  alive: boolean;
  /** a vanished admin: said only to other admins, who see them all the same (faintly) */
  hidden?: true;
}

/** a thing slung on a back: its item, and what is fitted to it (its magazine among them) */
export type Slung = [id: string, fitted: string[]];

/** an item with its grid position, as containers are stored and sent */
export type StoredItem = ItemInstance & { x: number; y: number; rot: boolean };

export interface StashInfo {
  uid: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  /** what was put down: the stash case (when it is not said), or another thing of the kind, by its item (see `stash` in src/sim/items.ts) */
  item?: string;
  /** it is under the ground: nothing is seen of it but turned earth, and a shovel brings it up */
  buried?: boolean;
}

export interface CorpseInfo extends StashInfo {
  name: string;
  /** how it fell, so it lies the same way for everyone: 0 on its back, 1 on its face, 2 on its side */
  v?: number;
}

export interface KillInfo {
  id: number;
  name: string;
  by: number | null;
  byName: string | null;
  w: string;
  zone: HitZone | null;
  dist: number;
  /** how they went down (see CorpseInfo.v) */
  v: number;
}

export type C2S =
  /** `proof`: the slip the check that this is a person gave (src/ui/person.ts), where the server has asked for one */
  | { t: 'hello'; v: number; key: string; name: string; proof?: string }
  /** `n`: when this was true by the sending game's own clock, ms (passed on with it: see src/net/timeline.ts) */
  | { t: 's'; p: Pose; w: string | null; m: string[]; n?: number }
  | { t: 'shot'; o: [number, number, number]; d: [number, number, number]; w: string; sup: boolean }
  | { t: 'swing' }
  /** a grenade left the hand: where, and how fast */
  | { t: 'nade'; o: [number, number, number]; v: [number, number, number] }
  | { t: 'act'; a: Act; d: number }
  /** something called out, with the movement that goes with it (an id from src/sim/emotes.ts) */
  | { t: 'emote'; e: string }
  /** a bullet of ours found fuel drum number i (see src/sim/barrels.ts), or our blast reached it */
  | { t: 'barrel'; i: number }
  /** we have lit fireplace number i (see src/sim/fires.ts), standing beside it */
  | { t: 'fire'; i: number }
  /** a keycard was put to the bunker's door */
  | { t: 'bunker' }
  | { t: 'gear'; g: string[] }
  | { t: 'back'; b: Slung[] }
  | { t: 'hit'; to: number; zone: HitZone; w: string; dist: number; sup: boolean; bonus: number; /** a shotgun: how many of the shot's pellets landed */ n?: number }
  | { t: 'take'; uid: string }
  /** a field radio keyed: a supply drop is asked for where the sender stands */
  | { t: 'radio' }
  | { t: 'drop'; l: WorldLoot }
  | { t: 'copen'; cid: string }
  | { t: 'cset'; cid: string; items: StoredItem[] }
  | { t: 'cclose'; cid: string }
  /** a stash put down, with whatever was in it while it was carried */
  /** a shovel put to a stash: it is buried, or dug up */
  | { t: 'bury'; uid: string; on: boolean }
  | { t: 'door'; i: number; open: boolean; swing: number }
  | { t: 'me'; inv: SerializedInventory; vitals: Vitals }
  | { t: 'died'; cause: string; v?: number }
  | { t: 'respawn' }
  | { t: 'chat'; ch?: ChatChannel; text: string }
  /** the admin password, as typed (the server passes it to the site, which alone knows it; it is kept nowhere) */
  | { t: 'admin'; pw: string }
  /** somebody with a role has their panel open: the lists it shows are asked for */
  | { t: 'adm' }
  /** an admin's choice of colour for the word ADMIN before their name in the chat (null: the rainbow it is by default) */
  | { t: 'tint'; color: string | null }
  /** leaving the proper way: the wait is begun (see LOGOUT in server/index.ts), or called off */
  | { t: 'logout'; cancel?: true }
  /** a dog tag taken from another player has been carried for the full time */
  | { t: 'cash'; uid: string; /** where a reward for it should go, if the player has given an address */ wallet?: string }
  /** getting into jeep number i (see src/sim/vehicles.ts), in this seat; and getting out of whatever we are in */
  | { t: 'vin'; i: number; seat: number }
  | { t: 'vout' }
  /** where the jeep this game is moving has got to, and when by this game's own clock (milliseconds) */
  | { t: 'v'; i: number; s: VState; at: number }
  /** it has come to rest: nobody need move it any more */
  | { t: 'vrest'; i: number; s: VState }
  /** a jeep on its side that nobody is in: this game will stand it up */
  | { t: 'vflip'; i: number }
  /** a round of ours hit it (with this weapon), or it ran into something this hard while we were moving it (m/s) */
  | { t: 'vhit'; i: number; w: string }
  | { t: 'vcrash'; i: number; n: number }
  /** a jerrycan emptied into its tank */
  | { t: 'vfuel'; i: number }
  /** where the infected this game is moving have got to (see src/sim/infected.ts): [which, ...where and what it is doing] */
  | { t: 'is'; s: [number, ...IState][] }
  /** a round or a blow of ours landed on one of them */
  | { t: 'ihit'; i: number; zone: HitZone; w: string; dist: number; sup: boolean; bonus: number; n?: number }
  /** one of them that this game moves has brought its arms down on this player */
  | { t: 'iatk'; i: number; to: number }
  | { t: 'ping'; n: number }
  /**
   * On the bot check's range, before being let in (src/sim/range.ts): where the player stands and looks (the
   * range's own x and z, the turn and the tilt), and a shot fired (from where, and along what); `n` is how long
   * since the range was dealt, by the game's own count, in thousandths of a second; `g` is which go at it this
   * is of (what was said of the go before, and comes late, is not taken for this one's).
   */
  | { t: 'r'; p: [number, number, number, number]; n: number; g: number }
  | { t: 'rs'; o: [number, number, number]; d: [number, number, number]; n: number; g: number }
  /** on the range: it is built and the figures stand on it; the go's clock starts now (said once a go, and not waited for long) */
  | { t: 'rgo'; g: number }
  /** on the range: what the browser says of itself: whether a program is driving it, and what it draws with */
  | { t: 'renv'; wd: boolean; gl: string };

export type S2C =
  | {
      t: 'welcome';
      v: number;
      you: number;
      players: PlayerInfo[];
      loot: WorldLoot[];
      doors: [number, boolean, number][];
      stashes: StashInfo[];
      corpses: CorpseInfo[];
      /** where to start: a fresh spawn, or where this character logged out */
      spawn: { x: number; y?: number; z: number; yaw: number };
      /** the character the server remembers for this player (null = new life) */
      me: { inv: SerializedInventory; vitals: Vitals } | null;
      /** supply drops standing in the world now */
      drops?: DropInfo[];
      /** fuel drums that have gone up and not been stood up again yet */
      barrels?: number[];
      /** the fireplaces that are alight: [which, seconds left] */
      fires?: [number, number][];
      /** the jeeps: where each stands, what state it is in and who is in it */
      vehicles?: VehicleInfo[];
      /** the infected, standing and lying */
      infected?: InfectedInfo[];
      /** the hour: which share of the day it is at the moment of this message (see src/sim/daynight.ts) */
      hour?: number;
      /** the bunker's door stands open */
      bunker?: boolean;
      /** the map's containers that somebody is searching at the moment: a locker among them stands with its doors open (see 'cdoor'). Not said by a server from before 2026-10-13 */
      ajar?: string[];
      max: number;
    }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: number }
  /** each: who, where, what is in their hands and on it, and when their game said so by its own clock (ms) */
  | { t: 'ps'; s: [number, ...Pose, string | null, string[], (number | null)?][] }
  | { t: 'shot'; id: number; o: [number, number, number]; d: [number, number, number]; w: string; sup: boolean }
  | { t: 'swing'; id: number }
  | { t: 'nade'; id: number; o: [number, number, number]; v: [number, number, number] }
  | { t: 'act'; id: number; a: Act; d: number }
  | { t: 'emote'; id: number; e: string }
  /** fuel drum number i went up, set off by this player; and a new one has been stood in its place */
  | { t: 'boom'; i: number; by: number }
  | { t: 'barrel+'; i: number }
  /** fireplace number i is alight, with so many seconds of burning left */
  | { t: 'fire'; i: number; left: number }
  /** the bunker's door: open, or shut (it stays open while anybody is inside, and shuts a minute after the last of them has gone) */
  | { t: 'bunker'; open: boolean }
  | { t: 'gear'; id: number; g: string[] }
  | { t: 'back'; id: number; b: Slung[] }
  | { t: 'dmg'; from: number; amount: number; zone: HitZone; w: string; dir: [number, number, number] }
  | { t: 'hitok'; to: number; amount: number; zone: HitZone }
  | { t: 'death'; k: KillInfo; corpse: CorpseInfo | null }
  | { t: 'alive'; id: number }
  | { t: 'loot+'; l: WorldLoot }
  | { t: 'loot-'; uid: string }
  | { t: 'denied'; uid: string }
  | { t: 'cdata'; cid: string; items: StoredItem[] }
  | { t: 'cbusy'; cid: string }
  /**
   * One of the map's containers has been opened by somebody ('copen' was answered with what is in it), or they are
   * done with it: said to everybody, the one searching among them, so that a locker's doors are seen to swing open
   * and stay open for as long as it is searched (src/game/lockers.ts). A game that was never told of these shows
   * every locker shut.
   */
  | { t: 'cdoor'; cid: string; open: boolean }
  | { t: 'stash+'; s: StashInfo }
  | { t: 'stash-'; uid: string }
  /** a stash has been buried, or dug up */
  | { t: 'stash~'; uid: string; buried: boolean }
  /** the stash this player asked to pick up is theirs to carry: what it was, and what is in it */
  /** said to everybody by an admin or a mod: across the screen, and in the chat */
  | { t: 'announce'; text: string; by: string }
  /** said to this player alone by an admin or a mod */
  | { t: 'pm'; from: string; role: 'admin' | 'mod'; text: string }
  /** somebody this (admin's) game knows has vanished, or is seen by everybody again: they are drawn faintly, or as anybody is */
  | { t: 'ghost'; id: number; on: boolean }
  | { t: 'corpse-'; uid: string }
  | { t: 'door'; i: number; open: boolean; swing: number }
  | { t: 'spawn'; x: number; z: number; yaw: number }
  | { t: 'chat'; ch?: ChatChannel; from: string; text: string; role?: 'admin' | 'mod'; /** an admin's own colour for their tag (not said: the rainbow) */ tint?: string }
  /** somebody cashed in a dog tag: announced to everyone */
  | { t: 'cashed'; id: number; name: string; owner: string }
  /** these tags of yours are void: you carried them out of the Zona (see TAG_OUT) */
  | { t: 'void'; uids: string[] }
  /** to an admin who asked: what somebody carries, as the server last had it from their game */
  | { t: 'inv'; id: number; name: string; inv: SerializedInventory | null }
  /** an admin has taken these things out of what this player carries: they are gone */
  | { t: 'trash'; uids: string[]; by?: string }
  /**
   * The leaderboard: the top five since the server started, as [name, kills, tags cashed in],
   * where this player stands in the whole list (-1 = not on it yet) and their own two counts.
   */
  | { t: 'board'; rows: [string, number, number][]; me: number; mine: [number, number] }
  /**
   * The server is full and this player is waiting to get in: their place in the line (1 =
   * next), how many are waiting, and how many the server holds. Sent again whenever the line
   * moves; a 'welcome' follows, on the same connection, when their turn comes.
   */
  | { t: 'queue'; pos: number; of: number; max: number }
  /** a supply drop has been set down (see src/sim/drops.ts), and one has been cleared away */
  | { t: 'drop+'; d: DropInfo }
  | { t: 'drop-'; uid: string }
  /** a drop has been called down (by whom, where, and in how many seconds), or the call was not answered */
  | { t: 'radio+'; by: number; x: number; z: number; eta: number }
  | { t: 'radio-'; why: string }
  /** where everyone carrying a tag they took is standing right now: [player id, x, z]. Sent to all, every half minute. */
  | { t: 'tags'; p: [number, number, number][] }
  /**
   * Jeeps that are moving: [number, when, ...where and how]. `when` is the clock of the game
   * that is moving it: a jeep at speed covers a metre and a half between two reports, and
   * drawn by when each happened to arrive it shudders.
   */
  | { t: 'vs'; s: [number, number, ...VState][] }
  /** who is in a jeep now and whose game moves it; with `s`, where it has come to rest */
  | { t: 'vseat'; i: number; seats: (number | null)[]; sim: number | null; s?: VState }
  /** what it has left after being hit, and what is in its tank */
  | { t: 'vhp'; i: number; hp: number; by: number }
  | { t: 'vfuel'; i: number; fuel: number }
  /** it went up (set off by this player); it has been cleared away; a new one stands somewhere */
  | { t: 'vboom'; i: number; by: number }
  | { t: 'v-'; i: number }
  | { t: 'v+'; v: VehicleInfo }
  /** one of the infected has turned up; one has been cleared away; whose game moves one from now on (null: nobody's) */
  | { t: 'i+'; b: InfectedInfo }
  | { t: 'i-'; i: number }
  | { t: 'iown'; i: number; to: number | null }
  /** where the games that move them say they are */
  | { t: 'is'; s: [number, ...IState][] }
  /** one was hit by this player: what it has left, whether that was the end of it, where on it, which way the blow was going, and whether it was a blow and not a shot */
  | { t: 'ihp'; i: number; hp: number; dead: boolean; by: number; zone: HitZone; dir: [number, number]; melee?: boolean }
  /** a blow of one's was stopped by the guard of the player it was thrown at */
  | { t: 'iblk'; i: number; to: number }
  | { t: 'pong'; n: number }
  /**
   * The bot check: a range is dealt (its number and the trying its dealing ended at are all of it: src/sim/range.ts
   * `rangeOf`), `go` is which go at it this is. Nobody is in the world until it is passed.
   */
  | { t: 'range'; seed: number; turn: number; go: number }
  /** on the range: the server has counted this figure down; and the range is passed (the welcome follows) */
  | { t: 'rhit'; i: number }
  | { t: 'rpass' }
  /** something the server has to say to this player alone (what became of a tag they cashed in) */
  | { t: 'tell'; text: string; kind: 'good' | 'warn' | 'info' }
  /** what this player may do on the server: nothing out of the way (null), keep order (mod), or everything (admin) */
  | { t: 'role'; role: 'admin' | 'mod' | null }
  /** a line from the server to this player alone, shown where talk is shown (what an order did, a list asked for) */
  | { t: 'sys'; text: string }
  /** put somewhere by an admin (by themselves, or by `by`). With no height, it is on top of whatever is there */
  | { t: 'put'; x: number; y?: number; z: number; by?: string }
  /** made whole by an admin: health, food, water, the wound and the leg */
  | { t: 'mend' }
  /**
   * What this player's health is, and whether a wound is open: said when their game is heard from again after the
   * server has been keeping their life for them (a hidden tab, a frozen game). The server's figure is the figure.
   */
  | { t: 'hp'; health: number; bleeding: boolean; blood?: number; bleed?: number }
  /** leaving the proper way: so many seconds of the wait are left; or (0, with why) it has been called off */
  | { t: 'logout'; left: number; why?: string }
  /** a whole set handed over by an admin (see src/sim/kits.ts): put on and away in place of what is carried, or (adds) beside it */
  | { t: 'kit'; name: string; items: ItemInstance[]; adds?: true; by?: string }
  /**
   * Which of an admin's powers this player has on: nothing hurts them, nobody sees them, they fly through things.
   * And what they have chosen for their own death: nothing they carried is left on the body, no tag of theirs is.
   */
  | { t: 'powers'; god: boolean; hidden: boolean; clip: boolean; voidInv: boolean; voidTag: boolean; /** what they carry weighs nothing; firing takes no round out of their gun (src/sim/powers.ts). Not said by a server from before 2026-10-13: not said is off */ weightless?: boolean; endless?: boolean }
  /**
   * An admin's refill (`/refill`): every magazine and every gun this player carries is to be full. Their own game
   * fills them (`refill` in src/sim/powers.ts: it alone knows what is carried at this moment) and says what it
   * carries afterwards, as it does of anything. `by`: the admin who did it, when it was not themselves.
   */
  | { t: 'refill'; by?: string }
  /** the lists the panel shows (see AdminLists) */
  | ({ t: 'adm' } & AdminLists)
  /** the server is about to be restarted (in so many seconds: 0, it is stopping now), and why, if that was said */
  | { t: 'restart'; why: string; in: number }
  /** (`v`: turned away for being of another version than the server, which is of this one) */
  /** `captcha`: turned away for want of the check that this is a person; the key to ask for it with */
  | { t: 'kick'; reason: string; v?: number; captcha?: string };

/** What the panel of somebody with a role is shown. The last two are an admin's alone. */
export interface AdminLists {
  /** everybody online: where they are, how long they have been on (minutes), how often the checks have fired on them */
  players: { id: number; name: string; role: 'admin' | 'mod' | null; x: number; z: number; /** the way they face, radians (0 looks north, down -z): the admin's map points each dot that way. Not said by a server from before 2026-10-13 */ yaw?: number; alive: boolean; flags: number; mins: number; /** health as their game last said it, kills and tags cashed since the server started */ hp: number; kills: number; tags: number; hidden?: true; god?: true; clip?: true; muted?: true; seat?: true; voidInv?: true; voidTag?: true; /** an admin's: what they carry weighs nothing, and their gun spends no rounds */ weightless?: true; endless?: true; /** gone without logging out: the body is still here */ asleep?: true; /** their game is not answering (a hidden tab): the server keeps their life */ away?: true }[];
  /** who left lately, newest first */
  gone: { id: number; name: string; mins: number }[];
  /**
   * `n` is where it stands in the list now (what `/unban 3` takes straight after `/bans`). `id` is its own, and is
   * the same whatever else is banned or lifted meanwhile: `a:` and the start of the hash of the key an admin
   * banned, `t:` and a hash of what a time off the server is kept by. The panel's Unban sends the id. (Not said by a
   * server from before 2026-10-13.)
   */
  bans: { n: number; id?: string; name: string; why: string; by: string; at: string }[];
  roles: { name: string; role: 'admin' | 'mod'; by: string; at: string }[];
  /** what the server's own checks are set to */
  checks: string;
  /** the server itself: minutes it has been up, things lying loose, stashes standing, characters kept for players who are away */
  /** (and, for the Entities page: cars standing, how many of those are burned out, and the infected on their feet) */
  stats?: { up: number; loot: number; stashes: number; kept: number; asleep: number; cars?: number; wrecks?: number; infected?: number };
}

/** deterministic id of a crate that is part of the map (same on every client and the server) */
export function crateId(x: number, z: number) {
  return `crate_${Math.round(x * 10)}_${Math.round(z * 10)}`;
}
