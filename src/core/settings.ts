// Graphics and sound options (Esc menu, Settings tab). The player picks them and they are kept in this browser;
// nothing here changes by itself while playing.

import { GROUPS, MIX, type Mix } from './audio';
import { LEAN, TOUCH } from './device';

export type AoMode = 'off' | 'half' | 'full';
export type Level = 'low' | 'medium' | 'high';
export type PresetName = 'low' | 'medium' | 'high' | 'ultra';

export interface Graphics {
  /** share of the screen's own pixels that is rendered (1 = native) */
  scale: number;
  /** multisample anti-aliasing samples */
  msaa: number;
  ao: AoMode;
  shadows: Level;
  /** how far full-detail trees reach and how thick the grass is */
  foliage: Level;
  /** frames per second, 0 = as many as the display shows */
  fpsLimit: number;
  /** master sound volume, 0..1 */
  volume: number;
}

export const PRESETS: Record<PresetName, Omit<Graphics, 'fpsLimit' | 'volume'>> = {
  low: { scale: 0.5, msaa: 0, ao: 'off', shadows: 'low', foliage: 'low' },
  medium: { scale: 0.75, msaa: 2, ao: 'half', shadows: 'medium', foliage: 'medium' },
  high: { scale: 1, msaa: 4, ao: 'half', shadows: 'high', foliage: 'medium' },
  ultra: { scale: 1, msaa: 4, ao: 'full', shadows: 'high', foliage: 'high' },
};

export const SCALES = [0.5, 0.67, 0.75, 0.85, 1];
export const MSAA = [0, 2, 4];
export const AO_MODES: AoMode[] = ['off', 'half', 'full'];
export const LEVELS: Level[] = ['low', 'medium', 'high'];
export const FPS_LIMITS = [30, 40, 60, 120, 0];

/**
 * What a phone starts on. It started on Low, which draws half the pixels each way that the
 * screen's sharpness would bear, with no smoothing of edges: on a phone's fine screen that is a
 * picture blown up three times, and it was called too low to look at. This is the middle
 * preset, a little sharper, without the darkening of corners (the one thing in it a phone
 * pays dearly for and shows least).
 */
export const PHONE: Omit<Graphics, 'fpsLimit' | 'volume'> = { scale: 0.85, msaa: 2, ao: 'off', shadows: 'low', foliage: 'medium' };

/** Everything at full on a computer; a phone starts on its own setting, and the menu has the rest either way. (One the game has already failed to start on starts on the lowest: see LEAN.) */
export const DEFAULT_GRAPHICS: Graphics = { ...(LEAN ? PRESETS.low : TOUCH ? PHONE : PRESETS.ultra), fpsLimit: 0, volume: 1 };

const STORE = 'zona.gfx';

/** the preset these settings amount to, or null when they were mixed by hand */
export function presetOf(g: Graphics): PresetName | null {
  for (const [name, p] of Object.entries(PRESETS) as [PresetName, Omit<Graphics, 'fpsLimit' | 'volume'>][]) {
    if (p.scale === g.scale && p.msaa === g.msaa && p.ao === g.ao && p.shadows === g.shadows && p.foliage === g.foliage) return name;
  }
  return null;
}

export function loadGraphics(): Graphics {
  const g = { ...DEFAULT_GRAPHICS };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Graphics> | null;
    if (raw && typeof raw === 'object') {
      if (SCALES.includes(raw.scale as number)) g.scale = raw.scale as number;
      if (MSAA.includes(raw.msaa as number)) g.msaa = raw.msaa as number;
      if (AO_MODES.includes(raw.ao as AoMode)) g.ao = raw.ao as AoMode;
      if (LEVELS.includes(raw.shadows as Level)) g.shadows = raw.shadows as Level;
      if (LEVELS.includes(raw.foliage as Level)) g.foliage = raw.foliage as Level;
      if (FPS_LIMITS.includes(raw.fpsLimit as number)) g.fpsLimit = raw.fpsLimit as number;
      // (it was one of five steps and is a slider now: whatever was kept of the five is still one of these)
      if (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) g.volume = raw.volume;
    }
  } catch {
    /* private mode or a damaged entry: defaults */
  }
  return g;
}

export function saveGraphics(g: Graphics) {
  try {
    localStorage.setItem(STORE, JSON.stringify(g));
  } catch {
    /* private mode */
  }
}

// ---- The four groups of sound under the one volume (src/core/audio.ts, GROUPS). Kept by themselves: the one
// volume stays where it has always been kept (`volume`, above), so what a player had set before there were groups
// is read as it was.
const MIX_STORE = 'zona.mix';

export function loadMix(): Mix {
  const m = { ...MIX };
  try {
    const raw = JSON.parse(localStorage.getItem(MIX_STORE) ?? 'null') as Partial<Mix> | null;
    if (raw && typeof raw === 'object') {
      for (const g of GROUPS) {
        const v = raw[g];
        if (typeof v === 'number' && v >= 0 && v <= 1) m[g] = v;
      }
    }
  } catch {
    /* private mode or a damaged entry: all of them at full, as the game was made */
  }
  return m;
}

export function saveMix(m: Mix) {
  try {
    localStorage.setItem(MIX_STORE, JSON.stringify(m));
  } catch {
    /* private mode */
  }
}
