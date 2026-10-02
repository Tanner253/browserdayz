// Graphics options (Esc menu). The player picks them and they are kept in this browser;
// nothing here changes by itself while playing.

import { TOUCH } from './device';

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
}

export const PRESETS: Record<PresetName, Omit<Graphics, 'fpsLimit'>> = {
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

/** Everything at full on a computer. A phone starts on Low: its GPU is a fraction of a laptop's. */
export const DEFAULT_GRAPHICS: Graphics = { ...(TOUCH ? PRESETS.low : PRESETS.ultra), fpsLimit: 0 };

const STORE = 'zona.gfx';

/** the preset these settings amount to, or null when they were mixed by hand */
export function presetOf(g: Graphics): PresetName | null {
  for (const [name, p] of Object.entries(PRESETS) as [PresetName, Omit<Graphics, 'fpsLimit'>][]) {
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
