// The building's two wheels (2026-10-24), on the game's one radial menu (src/ui/radial.ts): the plan's, its groups of
// pieces round the inside and the pieces of the group pointed at round the outside; and the hammer's, what it can do to
// the piece looked at. The owner: "the radial menu should have visuals and icons for the building pieces and also
// actions of the wheel"; "the bottom option for the radial wheel should always be cancel" (the radial puts Cancel at
// six o'clock itself: no wheel here has one of its own).

import type { RadialEntry, RadialRing } from '../../ui/radial';
import { PIECES, PLACED, TIERS, hpOf, type Cat, type Tier } from '../../sim/build/pieces';
import { MEND } from '../../sim/build/bases';
import type { Piece } from '../../sim/build/snap';
import { TIER_INK, actionIcon, pieceIcon, printIcon } from './icons';
import { PRINTS, asksOf, printOf } from '../../sim/build/blueprints';

/** the plan's wheel: nine wedges to a ring (an odd count turns it half a wedge, so one sits at the bottom for Cancel) */
export const PER = 9;
/** the outer ring's wedge the radial gives Cancel */
const CANCEL_K = Math.floor(PER / 2);
export const RINGS: RadialRing[] = [{ r0: 46, r1: 120, text: 84 }, { r0: 126, r1: 205, text: 166 }];
/** the groups there are (CATS: those with something left to lay) */
const ALL_CATS: { cat: Cat; label: string; icon: string }[] = [
  { cat: 'found', label: 'Ground', icon: 'foundation' },
  { cat: 'walls', label: 'Walls', icon: 'wall' },
  { cat: 'floors', label: 'Floors', icon: 'floor' },
  { cat: 'stairs', label: 'Stairs', icon: 'stairs_u' },
  { cat: 'roofs', label: 'Roofs', icon: 'roof' },
  { cat: 'doors', label: 'Doors', icon: 'door_wood' },
  { cat: 'windows', label: 'Windows', icon: 'bars_wood' },
  { cat: 'outside', label: 'Outside', icon: 'high_wall_wood' },
  { cat: 'deploy', label: 'Set down', icon: 'claim' },
];
/** the hammer's wheel: nine wedges (the radial's Cancel at the bottom), and what each of the others does (up4: the armoured tier) */
export const HAMMER_PER = 10;
/** (`remove` picks a thing set down from the hands up whole, `scrap` breaks it up for some of its materials: the owner, 2026-10-25) */
export const HAMMER_WHEEL = ['up1', 'up2', 'up3', 'up4', 'repair', 'remove', 'scrap', 'rotate', 'unlock'] as const;
/** a workbench's level, as it is said */
export const ROMAN = ['', 'I', 'II', 'III'];

export const piecesOf = (cat: Cat) => Object.values(PIECES).filter((k) => k.cat === cat && !PLACED[k.id]);
/** what a group offers round the outside: its pieces, and with the foundations the blueprints (starting spots for a base) */
export const itemsOf = (cat: Cat) => [...piecesOf(cat).map((k) => k.id), ...(cat === 'found' ? PRINTS.map((p) => p.id) : [])];
/** the groups round the inside ring: only those with something the plan lays (doors became things made and hung by hand,
 * and an empty Doors group left on the wheel crashed the game when picked: the owner, 2026-10-26, "why is the door option on
 * the build plan radial menu still? it crashed my game") */
export const CATS = ALL_CATS.filter((c) => itemsOf(c.cat).length > 0);
/** a piece's or a blueprint's name */
export const nameOf = (id: string) => printOf(id)?.name ?? PIECES[id].name;

/** the outer ring by its wedges (k from the top, clockwise): a group's pieces laid round from beside its own wedge outward both ways, never on Cancel's */
export function outerOf(cat: number): (string | null)[] {
  const list = itemsOf(CATS[cat].cat), out: (string | null)[] = Array(PER).fill(null);
  let n = 0;
  for (let s = 0; s < PER * 2 && n < list.length; s++) {
    const k = (cat + (s % 2 ? -1 : 1) * Math.ceil(s / 2) + PER * 2) % PER;
    if (k === CANCEL_K || out[k]) continue;
    out[k] = list[n++];
  }
  return out;
}

/** the entry the radial numbers an outer wedge `k` by (it counts round Cancel's) */
export const outerEntry = (k: number) => CATS.length + (k < CANCEL_K ? k : k - 1);
/** the piece a plan's pick is, with group `cat` open (null: a group, Cancel, or nothing) */
export function pieceAt(cat: number, pick: number): string | null {
  if (pick < CATS.length) return null;
  const e = pick - CATS.length, k = e < CANCEL_K ? e : e + 1;
  return outerOf(cat)[k] ?? null;
}

const icons = new Map<string, string>();
const iconOf = (id: string) => {
  let u = icons.get(id);
  if (!u) icons.set(id, (u = printOf(id) ? printIcon(asksOf(id)) : pieceIcon(id)));
  return u;
};

/** the plan's wheel with group `cat` open and `kind` the piece chosen */
export function planEntries(cat: number, kind: string): RadialEntry[] {
  const inner: RadialEntry[] = CATS.map((c, i) => ({ id: `cat:${i}`, label: c.label, icon: iconOf(c.icon), mark: i === cat ? 'held' : undefined }));
  const slots = outerOf(cat), outer: RadialEntry[] = [];
  for (let k = 0; k < PER; k++) {
    if (k === CANCEL_K) continue;
    const id = slots[k];
    outer[outerEntry(k) - CATS.length] = id ? { id, label: nameOf(id).replace(/ (Foundation|Floor|Stairs)$/, '').replace(/^(Wooden|High) /, ''), icon: iconOf(id), mark: id === kind ? 'held' : undefined } : { id: 'none', label: '', mark: 'gap' };
  }
  return [...inner, ...outer];
}

/** the hammer's wheel at piece `p` (none looked at: all dim) */
export function hammerEntries(p: Piece | null): RadialEntry[] {
  return HAMMER_WHEEL.map((w): RadialEntry => {
    if (w === 'unlock') return { id: w, label: 'Lock off', icon: actionIcon('lock'), mark: p?.lock ? undefined : 'dim' };
    if (w === 'remove') return { id: w, label: p && ((PIECES[p.k].role === 'deploy' && p.k !== 'claim') || PLACED[p.k]) ? 'Pick up' : 'Take down', icon: actionIcon('remove', '#ee7a6e'), mark: p ? undefined : 'dim' };
    if (w === 'scrap') return { id: w, label: 'Deconstruct', icon: actionIcon('remove', '#c9a24a'), mark: p && PLACED[p.k] ? undefined : 'dim' };
    // (mended when it has lost health; turned about within ten minutes of being laid: src/sim/build/bases.ts MEND)
    if (w === 'repair') return { id: w, label: 'Repair', icon: actionIcon('repair'), mark: p && p.hp < hpOf(p.k, p.t) - 0.5 ? undefined : 'dim' };
    if (w === 'rotate') return { id: w, label: 'Turn', icon: actionIcon('rotate'), mark: p && ['wall', 'fit', 'stairs', 'deploy'].includes(PIECES[p.k].role) && Date.now() - p.at <= MEND.turn ? undefined : 'dim' };
    const to = Number(w.slice(2)) as Tier;
    // (a workbench is brought up in levels, II and III: the progression plan)
    if (p && PIECES[p.k].levels) return { id: w, label: ROMAN[to] ? `Level ${ROMAN[to]}` : '', icon: actionIcon('up', TIER_INK[Math.min(4, to + 1)]), mark: to !== p.t + 1 || to > 3 ? 'dim' : undefined };
    return { id: w, label: TIERS[to], icon: actionIcon('up', TIER_INK[to]), mark: !p || p.t >= to || PIECES[p.k].only !== undefined ? 'dim' : undefined };
  });
}
