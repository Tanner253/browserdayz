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

export const PROTOCOL = 4;

/** chat channels: everyone on the server, or only players standing near the speaker */
export type ChatChannel = 'global' | 'near';
/** how far proximity chat carries, metres */
export const CHAT_RANGE = 50;

/** player state flags */
export const F_CROUCH = 1, F_SPRINT = 2, F_AIM = 4, F_GROUND = 8, F_DEAD = 16;

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
}

export interface PlayerInfo {
  id: number;
  name: string;
  pose: Pose;
  /** item id in hands (null = bare hands) and its attachments */
  w: string | null;
  m: string[];
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
}

export interface KillInfo {
  id: number;
  name: string;
  by: number | null;
  byName: string | null;
  w: string;
  zone: HitZone | null;
  dist: number;
}

export type C2S =
  | { t: 'hello'; v: number; key: string; name: string }
  | { t: 's'; p: Pose; w: string | null; m: string[] }
  | { t: 'shot'; o: [number, number, number]; d: [number, number, number]; w: string; sup: boolean }
  | { t: 'swing' }
  | { t: 'hit'; to: number; zone: HitZone; w: string; dist: number; sup: boolean; bonus: number }
  | { t: 'take'; uid: string }
  | { t: 'drop'; l: WorldLoot }
  | { t: 'copen'; cid: string }
  | { t: 'cset'; cid: string; items: StoredItem[] }
  | { t: 'cclose'; cid: string }
  | { t: 'stash+'; s: StashInfo }
  | { t: 'stash-'; uid: string }
  | { t: 'door'; i: number; open: boolean; swing: number }
  | { t: 'me'; inv: SerializedInventory; vitals: Vitals }
  | { t: 'died'; cause: string }
  | { t: 'respawn' }
  | { t: 'chat'; ch?: ChatChannel; text: string }
  /** a dog tag taken from another player has been carried for the full time */
  | { t: 'cash'; uid: string }
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
      max: number;
    }
  | { t: 'join'; p: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'ps'; s: [number, ...Pose, string | null, string[]][] }
  | { t: 'shot'; id: number; o: [number, number, number]; d: [number, number, number]; w: string; sup: boolean }
  | { t: 'swing'; id: number }
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
  | { t: 'pong'; n: number }
  | { t: 'kick'; reason: string };

/** deterministic id of a crate that is part of the map (same on every client and the server) */
export function crateId(x: number, z: number) {
  return `crate_${Math.round(x * 10)}_${Math.round(z * 10)}`;
}
