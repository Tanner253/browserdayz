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
  /** how far off buildings are drawn, metres (loot is drawn within 55 m whatever this is) */
  draw: number;
}

/** what a preset sets: everything but the frame limit, the volume and the draw distance */
export type Look = Omit<Graphics, 'fpsLimit' | 'volume' | 'draw'>;

export const PRESETS: Record<PresetName, Look> = {
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
 * Draw distances, metres (2026-10-16, the owner: "let the user set draw distance in settings with it default to 800m";
 * "we need lower draw options too for potatoe players realistic tho maybe down to 300m"). A short one gives no sight
 * through walls: a player past it, behind a building it leaves undrawn, is not drawn either (Buildings.hides).
 */
export const DRAWS = [300, 500, 800, 1000, 1500];

/**
 * What a phone starts on. It started on Low, which draws half the pixels each way that the
 * screen's sharpness would bear, with no smoothing of edges: on a phone's fine screen that is a
 * picture blown up three times, and it was called too low to look at. This is the middle
 * preset, a little sharper, without the darkening of corners (the one thing in it a phone
 * pays dearly for and shows least).
 */
export const PHONE: Look = { scale: 0.85, msaa: 2, ao: 'off', shadows: 'low', foliage: 'medium' };

/** A film (trailer.html) or a picture asked for at full (`?gfx=ultra`) is made with everything at full, as they always were. */
const FULL = typeof location !== 'undefined' && (location.pathname.endsWith('/trailer.html') || new URLSearchParams(location.search).get('gfx') === 'ultra');

/**
 * What a computer plays on (the owner, 2026-10-14: "MOST people cant handle full quality; the setup i provide here
 * is the best balance"): the whole of the screen's pixels, no smoothing of edges, no darkening of corners, low
 * shadows, the middle of the foliage, no limit to the frames. It is none of the presets.
 */
export const BALANCED: Look = { scale: 1, msaa: 0, ao: 'off', shadows: 'low', foliage: 'medium' };

/** That on a computer; a phone starts on its own setting, and the menu has the rest either way. (One the game has already failed to start on starts on the lowest: see LEAN.) */
export const DEFAULT_GRAPHICS: Graphics = { ...(LEAN ? PRESETS.low : TOUCH ? PHONE : FULL ? PRESETS.ultra : BALANCED), fpsLimit: 0, volume: 1, draw: 800 };

const STORE = 'zona.gfx';
/**
 * Settings given to every computer once, over whatever it had kept (its volume aside): "even returning players.
 * only once though... if they edit it and change it then it should save for them as they changed it". A browser that
 * has had this round is not given it again; a later round would be a higher number.
 */
const ROUND = 'zona.gfx.round', THIS_ROUND = 1;

function giveRound() {
  if (FULL || TOUCH || LEAN || Number(localStorage.getItem(ROUND) ?? 0) >= THIS_ROUND) return;
  const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Graphics> | null;
  const volume = raw && typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : 1;
  localStorage.setItem(STORE, JSON.stringify({ ...BALANCED, fpsLimit: 0, volume }));
  localStorage.setItem(ROUND, String(THIS_ROUND));
}

/** the preset these settings amount to, or null when they were mixed by hand */
export function presetOf(g: Graphics): PresetName | null {
  for (const [name, p] of Object.entries(PRESETS) as [PresetName, Look][]) {
    if (p.scale === g.scale && p.msaa === g.msaa && p.ao === g.ao && p.shadows === g.shadows && p.foliage === g.foliage) return name;
  }
  return null;
}

export function loadGraphics(): Graphics {
  const g = { ...DEFAULT_GRAPHICS };
  try {
    giveRound();
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Graphics> | null;
    if (raw && typeof raw === 'object') {
      if (SCALES.includes(raw.scale as number)) g.scale = raw.scale as number;
      if (MSAA.includes(raw.msaa as number)) g.msaa = raw.msaa as number;
      if (AO_MODES.includes(raw.ao as AoMode)) g.ao = raw.ao as AoMode;
      if (LEVELS.includes(raw.shadows as Level)) g.shadows = raw.shadows as Level;
      if (LEVELS.includes(raw.foliage as Level)) g.foliage = raw.foliage as Level;
      if (FPS_LIMITS.includes(raw.fpsLimit as number)) g.fpsLimit = raw.fpsLimit as number;
      if (DRAWS.includes(raw.draw as number)) g.draw = raw.draw as number;
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
