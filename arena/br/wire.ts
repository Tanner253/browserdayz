// What the battle royale's server and the game say to each other beyond the game's own protocol (src/net/protocol.ts,
// which is read and never changed here: the hard rule in docs/BATTLE-ROYALE.md). Every one of these travels as
// { t: 'br', k: <kind>, ... }; the game's own words (welcome, ps, shot, hit, dmg, hp, put, powers, kill, door, kit)
// carry the rest, as they do for the Arena. Times are the server's clock, ms: `now` lets the game set its own by it.
import type { BrMode, Circle, Ground, SlotItem } from './rules';

export type Phase = 'wait' | 'count' | 'plane' | 'live' | 'over';

export interface Mate { id: number; name: string; hp: number; knocked: boolean; alive: boolean }

export type BrS2C =
  /** the lobby as it fills: who is in, the vote, and the count once it passed */
  | { k: 'lobby'; id: string; code: string; mode: BrMode; map: number; have: number; votes: number; need: number; voted: boolean; at: number; now: number; max: number }
  /** this player's own: the six slots, the slot in hand, what is worn, the rounds by calibre, health, a knock, the team */
  | { k: 'me'; slots: SlotItem[]; vest: string | null; helmet: string | null; pack: string | null; pools: Record<string, number>; hp: number; knocked: boolean; kn: number; mates: Mate[]; using: { slot: number; until: number } | null; rev: { id: number; until: number; me: boolean } | null; now: number }
  /** things on the ground: added, gone; `all` replaces whatever was had */
  | { k: 'loot'; add: Ground[]; gone: number[]; all?: boolean }
  /** the plane's line: at `a` at t0, flying to `b` at `speed` m/s, `y` high */
  | { k: 'plane'; a: [number, number]; b: [number, number]; y: number; t0: number; speed: number; now: number }
  /** out of the plane (the map's edge reached with this player still in it) */
  | { k: 'eject' }
  /** the circle: from `a` to `b` between t0 and t1; `dmg` a second outside it */
  | { k: 'zone'; a: Circle; b: Circle; t0: number; t1: number; phase: number; dmg: number; now: number }
  /** the match as it stands */
  | { k: 'state'; phase: Phase; alive: number; teams: number; kills: number; map: number; mode: BrMode }
  /** this player's team is out: where they placed */
  | { k: 'out'; place: number; kills: number; dmg: number; by: string | null }
  /** another player is falling, under a canopy, or down (null) */
  | { k: 'air'; id: number; s: 'fall' | 'chute' | null }
  /** that lobby (or this player's match, coming back) is on another map: the page is cut again for it */
  | { k: 'remap'; map: number; code: string; size: number }
  /** won: the winners, and everybody's place */
  | { k: 'over'; winners: string[]; board: { name: string; place: number; kills: number; dmg: number }[]; /** this player is one of them */ won?: boolean };

export type BrC2S =
  | { k: 'vote'; yes: boolean }
  /** take a thing off the ground into a slot (`slot`: the one to swap out, with no slot free) */
  | { k: 'take'; id: number; slot: number }
  /** use the heal in a slot */
  | { k: 'use'; slot: number }
  /** put a slot's thing on the ground */
  | { k: 'drop'; slot: number }
  /** out of the plane */
  | { k: 'jump' }
  /** stand over a knocked teammate to get them up (on), or stop */
  | { k: 'rev'; id: number; on: boolean }
  /** rounds of a calibre put into a gun by a reload */
  | { k: 'load'; ammo: string; n: number }
  /** this player is falling, under a canopy, or down (null) */
  | { k: 'air'; s: 'fall' | 'chute' | null }
  /** this player leaves the match, and is out of it at once */
  | { k: 'leave' };

export type BrMsg = { t: 'br' } & BrS2C;
export type BrSend = { t: 'br' } & BrC2S;
