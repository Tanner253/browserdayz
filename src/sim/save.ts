// Local persistence for the single-player slice. The shape mirrors what the
// authoritative server will own: world loot (economy), placed stashes, and the
// player's body + inventory. Swap localStorage for the server API later.

import type { WorldLoot } from './economy';
import type { PlayerInventory } from './inventory';

const KEY = 'zona.save.v1';

export interface SaveData {
  version: 1;
  savedAt: number;
  player: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    vitals: { health: number; energy: number; water: number; stamina: number; bleeding: boolean };
    inventory: ReturnType<PlayerInventory['serialize']>;
    /** starter-kit revision already granted to this character */
    kit?: number;
    /** item ids on the quick-use keys 5-8 */
    quick?: (string | null)[];
  } | null;
  economy: { time: number; lastRestock: Record<string, number>; loot: WorldLoot[]; rev?: number };
  stashes: { uid: string; x: number; y: number; z: number; rot: number; container: { id: string; items: unknown[] } }[];
  /** contents of the searchable crates that are part of the map */
  crates?: { uid: string; emptiedAt: number; container: { id: string; items: unknown[] } }[];
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d.version === 1 ? d : null;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
