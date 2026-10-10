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

export const PROTOCOL = 17;

/** chat channels: everyone on the server, or only players standing near the speaker */
export type ChatChannel = 'global' | 'near';
/** how far proximity chat carries, metres */
export const CHAT_RANGE = 50;

/** player state flags */
export const F_CROUCH = 1, F_SPRINT = 2, F_AIM = 4, F_GROUND = 8, F_DEAD = 16, F_BLEED = 32;
/** what the body is doing for as long as it is left to (see src/sim/emotes.ts): dancing, hands up */
export const F_DANCE = 64, F_SURRENDER = 128;
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
export const ACTS = ['bolt', 'reload', 'eat', 'drink', 'bandage', 'open', 'stop'] as const;
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
  alive: boolean;
}

/** an item with its grid position, as containers are stored and sent */
export type StoredItem = ItemInstance & { x: number; y: number; rot: boolean };

export interface StashInfo {
  uid: string;
  x: number;
  y: number;
  z: number;
  rot: number;
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
  | { t: 'hello'; v: number; key: string; name: string }
  | { t: 's'; p: Pose; w: string | null; m: string[] }
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
  | { t: 'hit'; to: number; zone: HitZone; w: string; dist: number; sup: boolean; bonus: number; /** a shotgun: how many of the shot's pellets landed */ n?: number }
  | { t: 'take'; uid: string }
  | { t: 'drop'; l: WorldLoot }
  | { t: 'copen'; cid: string }
  | { t: 'cset'; cid: string; items: StoredItem[] }
  | { t: 'cclose'; cid: string }
  | { t: 'stash+'; s: StashInfo }
  | { t: 'stash-'; uid: string }
  | { t: 'door'; i: number; open: boolean; swing: number }
  | { t: 'me'; inv: SerializedInventory; vitals: Vitals }
  | { t: 'died'; cause: string; v?: number }
  | { t: 'respawn' }
  | { t: 'chat'; ch?: ChatChannel; text: string }
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
  | { t: 'ping'; n: number };

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
      /** seconds the bunker's door still stands open (0: it is shut) */
      bunker?: number;
      max: number;
    }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'ps'; s: [number, ...Pose, string | null, string[]][] }
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
  /** the bunker's door stands open for so many seconds more */
  | { t: 'bunker'; left: number }
  | { t: 'gear'; id: number; g: string[] }
  | { t: 'dmg'; from: number; amount: number; zone: HitZone; w: string; dir: [number, number, number] }
  | { t: 'hitok'; to: number; amount: number; zone: HitZone }
  | { t: 'death'; k: KillInfo; corpse: CorpseInfo | null }
  | { t: 'alive'; id: number }
  | { t: 'loot+'; l: WorldLoot }
  | { t: 'loot-'; uid: string }
  | { t: 'denied'; uid: string }
  | { t: 'cdata'; cid: string; items: StoredItem[] }
  | { t: 'cbusy'; cid: string }
  | { t: 'stash+'; s: StashInfo }
  | { t: 'stash-'; uid: string }
  | { t: 'corpse-'; uid: string }
  | { t: 'door'; i: number; open: boolean; swing: number }
  | { t: 'spawn'; x: number; z: number; yaw: number }
  | { t: 'chat'; ch?: ChatChannel; from: string; text: string }
  /** somebody cashed in a dog tag: announced to everyone */
  | { t: 'cashed'; id: number; name: string; owner: string }
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
  /** something the server has to say to this player alone (what became of a tag they cashed in) */
  | { t: 'tell'; text: string; kind: 'good' | 'warn' | 'info' }
  | { t: 'kick'; reason: string };

/** deterministic id of a crate that is part of the map (same on every client and the server) */
export function crateId(x: number, z: number) {
  return `crate_${Math.round(x * 10)}_${Math.round(z * 10)}`;
}
