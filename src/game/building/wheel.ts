// The building's two wheels (2026-10-24), on the game's one radial menu (src/ui/radial.ts): the plan's, its groups of
// pieces round the inside and the pieces of the group pointed at round the outside; and the hammer's, what it can do to
// the piece looked at. The owner: "the radial menu should have visuals and icons for the building pieces and also
// actions of the wheel"; "the bottom option for the radial wheel should always be cancel".

import type { RadialEntry, RadialRing } from '../../ui/radial';
import { PIECES, TIERS, type Cat, type Tier } from '../../sim/build/pieces';
import type { Piece } from '../../sim/build/snap';
import { TIER_INK, actionIcon, pieceIcon } from './icons';

/** the plan's wheel: ten wedges to a ring, its bottom one (the sixth) Cancel */
export const PER = 10;
export const CANCEL = 5;
export const RINGS: RadialRing[] = [{ r0: 46, r1: 120, text: 84 }, { r0: 126, r1: 200, text: 163 }];
/** the groups round the inside ring, its bottom Cancel */
export const CATS: { cat: Cat | null; label: string; icon: string }[] = [
  { cat: 'found', label: 'Foundations', icon: 'foundation' },
  { cat: 'walls', label: 'Walls', icon: 'wall' },
  { cat: 'floors', label: 'Floors', icon: 'floor' },
  { cat: 'stairs', label: 'Stairs', icon: 'stairs_u' },
  { cat: 'roofs', label: 'Roofs', icon: 'roof' },
  { cat: null, label: 'Cancel', icon: '' },
  { cat: 'doors', label: 'Doors', icon: 'door_wood' },
  { cat: 'windows', label: 'Windows', icon: 'bars_wood' },
  { cat: 'outside', label: 'Outside', icon: 'high_wall_wood' },
  { cat: 'deploy', label: 'Set down', icon: 'claim' },
];
/** the hammer's wheel: eight wedges, its bottom one Cancel; what each does */
export const HAMMER_PER = 8;
export const HAMMER_WHEEL = ['up1', 'up2', 'up3', 'repair', 'cancel', 'remove', 'rotate', ''] as const;

export const piecesOf = (cat: Cat | null) => Object.values(PIECES).filter((k) => k.cat === cat);

/** the outer ring: a group's pieces laid round from its own wedge outward both ways, never on the bottom one */
export function outerOf(cat: number): (string | null)[] {
  const list = piecesOf(CATS[cat].cat).map((k) => k.id), out: (string | null)[] = Array(PER).fill(null);
  let k = 0;
  for (let s = 0; s < PER * 2 && k < list.length; s++) {
    const i = (cat + (s % 2 ? -1 : 1) * Math.ceil(s / 2) + PER * 2) % PER;
    if (i === CANCEL || out[i]) continue;
    out[i] = list[k++];
  }
  return out;
}

const icons = new Map<string, string>();
const iconOf = (id: string) => {
  let u = icons.get(id);
  if (!u) icons.set(id, (u = pieceIcon(id)));
  return u;
};

/** the plan's wheel with group `cat` open and `kind` the piece chosen */
export function planEntries(cat: number, kind: string): RadialEntry[] {
  const inner: RadialEntry[] = CATS.map((c, i) => (c.cat ? { id: `cat:${i}`, label: c.label, icon: iconOf(c.icon), mark: i === cat ? 'held' : undefined } : c.label ? { id: 'cancel', label: 'Cancel', icon: actionIcon('cancel') } : { id: 'none', label: '', mark: 'dim' }));
  const outer: RadialEntry[] = outerOf(cat).map((id) => (id ? { id, label: PIECES[id].name.replace(/ (Foundation|Floor|Stairs)$/, '').replace(/^(Wooden|High) /, ''), icon: iconOf(id), mark: id === kind ? 'held' : undefined } : { id: 'none', label: '', mark: 'gap' }));
  return [...inner, ...outer];
}

/** the hammer's wheel at piece `p` (none looked at: all but Cancel dim) */
export function hammerEntries(p: Piece | null): RadialEntry[] {
  return HAMMER_WHEEL.map((w): RadialEntry => {
    if (w === 'cancel') return { id: w, label: 'Cancel', icon: actionIcon('cancel') };
    if (w === '') return { id: 'none', label: '', mark: 'dim' };
    if (w === 'remove') return { id: w, label: 'Take down', icon: actionIcon('remove', '#ee7a6e'), mark: p ? undefined : 'dim' };
    if (w === 'repair') return { id: w, label: 'Repair', icon: actionIcon('repair'), mark: 'dim' };
    if (w === 'rotate') return { id: w, label: 'Turn', icon: actionIcon('rotate'), mark: 'dim' };
    const to = Number(w.slice(2)) as Tier;
    return { id: w, label: TIERS[to], icon: actionIcon('up', TIER_INK[to]), mark: !p || p.t >= to || PIECES[p.k].only !== undefined ? 'dim' : undefined };
  });
}
