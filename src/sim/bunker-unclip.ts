// Nothing in the bunker's rooms stands in anything else (the owner, 2026-11-01: "no furniture clipping into each other, there is some in the old rooms"). The rules lay a room's things
// one lot at a time, each lot checked only against some of the last. This goes over a whole plan when it is laid: every pair that stand in each other, by their real sizes, and the
// lesser of the two is moved clear with whatever is kept on top of it. What cannot be moved clear goes, if it is only clutter. The same on the server and in every game.

import type { Made, Plan, Room, Stood } from './bunker';

/** the models' sizes, metres: across, high, deep */
const SIZE: Record<string, [number, number, number]> = {
  old_bed_frame: [0.9, 1.2, 2], painted_wooden_table: [2.41, 0.96, 1.14], painted_wooden_chair_01: [0.43, 0.96, 0.54], SchoolChair_01: [0.57, 1.01, 0.68], WoodenTable_01: [1.8, 0.55, 0.66], metal_office_desk: [2, 0.79, 0.95],
  painted_wooden_cabinet: [1.19, 1.18, 0.62], Shelf_01: [1, 2.08, 0.26], wooden_bookshelf_worn: [1.37, 2.06, 0.58], Barrel_01: [0.56, 0.88, 0.56], barrel_03: [0.63, 0.93, 0.64], wooden_crate_01: [0.83, 0.35, 0.41], cardboard_box_01: [0.39, 0.34, 0.52],
  wooden_military_crate: [1.24, 0.46, 0.52], old_military_crate: [1.82, 0.3, 0.98], weapons_case: [1.25, 0.43, 0.53], gun_rack: [1.54, 1.85, 0.61], electric_stove: [0.5, 0.86, 0.65], bunker_terminal: [1.5, 1.2, 1.26], bunker_machine: [3.6, 2.22, 1.61],
  Television_01: [0.6, 0.46, 0.47], utility_box_01: [0.52, 1.12, 0.43], metal_trash_can: [0.56, 0.91, 0.56], trashbag: [0.53, 0.57, 0.46], old_tyre: [0.6, 0.6, 0.16], wooden_ladder: [0.96, 1.33, 0.5], bunker_pipe: [0.91, 3, 0.91], bunker_rail: [1.85, 0.94, 0.06], breaker_box: [0.83, 1.7, 0.61],
};
/** shelves in a row round a corner: one of the two goes, there being no room for it */
const SHELVES = new Set(['Shelf_01', 'wooden_bookshelf_worn']);
const CHAIRS = new Set(['painted_wooden_chair_01', 'SchoolChair_01']);
const TABLES = new Set(['painted_wooden_table', 'WoodenTable_01', 'metal_office_desk']);
/** what a thing stands up against and is not shifted for anything less */
const FIXED = new Set(['Shelf_01', 'wooden_bookshelf_worn', 'painted_wooden_cabinet', 'gun_rack', 'bunker_machine', 'bunker_pipe', 'bunker_rail', 'breaker_box', 'electric_stove']);
const MADE = new Set<Made['kind']>(['locker', 'generator', 'tank', 'console', 'rack', 'bench', 'pillar', 'bunk', 'cell']);

interface Thing { s: Stood | null; m: Made | null; id: string; w: number; d: number; h: number; rank: number }

const thing = (s: Stood): Thing | null => {
  const z = SIZE[s.id], k = s.scale ?? 1;
  if (!z) return null;
  const rank = s.solid ? 9 : s.id === 'old_bed_frame' ? 4 : FIXED.has(s.id) ? 3 : TABLES.has(s.id) || s.id === 'weapons_case' ? 2 : CHAIRS.has(s.id) ? 1 : 0;
  return { s, m: null, id: s.id, w: z[0] * k, h: z[1] * k, d: z[2] * k, rank };
};
const at = (t: Thing) => (t.s ?? t.m)!;

/** do two stand in each other, by more than a finger, each a turned box and high as it is? */
function clip(a: Thing, b: Thing, ax = at(a).r, af = at(a).f, by = 0.03) {
  const ya = at(a).y ?? 0, yb = at(b).y ?? 0;
  if (Math.min(ya + a.h, yb + b.h) - Math.max(ya, yb) < 0.05) return false;
  const axes = (t: Thing) => {
    const c = Math.cos(at(t).rot), n = Math.sin(at(t).rot);
    return [{ ur: c, uf: -n, h: t.w / 2 }, { ur: n, uf: c, h: t.d / 2 }];
  };
  const A = axes(a), B = axes(b), reach = (list: typeof A, ur: number, uf: number) => list.reduce((s, e) => s + e.h * Math.abs(e.ur * ur + e.uf * uf), 0);
  return [...A, ...B].every(({ ur, uf }) => Math.abs((at(b).r - ax) * ur + (at(b).f - af) * uf) < reach(A, ur, uf) + reach(B, ur, uf) - by);
}

/** may this pair stand as they do: a chair drawn up under a table, the rail by what it guards */
const allowed = (a: Thing, b: Thing) => (CHAIRS.has(a.id) && TABLES.has(b.id)) || (CHAIRS.has(b.id) && TABLES.has(a.id));

/** what still stands in something, for whoever is checking */
export function clips(plan: Plan) {
  const list = gather(plan), out: string[] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (!allowed(list[i], list[j]) && clip(list[i], list[j])) out.push(`${list[i].id} ${at(list[i]).r.toFixed(1)},${at(list[i]).f.toFixed(1)} in ${list[j].id}`);
  return out;
}

function gather(plan: Plan) {
  const list: Thing[] = [];
  for (const s of plan.stood) {
    const t = thing(s);
    if (t) list.push(t);
  }
  for (const m of plan.made) if (MADE.has(m.kind) && m.solid !== false) list.push({ s: null, m, id: m.kind, w: m.w, d: m.d, h: m.h, rank: 8 });
  return list;
}

/** @param searched is this something opened and looked into, and so never to be taken away */
export function unclip(plan: Plan, searched: (s: Stood) => boolean) {
  const inRoom = (r: number, f: number) => plan.rooms.find((q) => r > q.r0 && r < q.r1 && f > q.f0 && f < q.f1) ?? null;
  for (let pass = 0; pass < 3; pass++) {
    const list = gather(plan);
    const fits = (t: Thing, q: Room, r: number, f: number) => {
      const c = Math.abs(Math.cos(at(t).rot)), n = Math.abs(Math.sin(at(t).rot)), hr = (t.w * c + t.d * n) / 2, hf = (t.w * n + t.d * c) / 2;
      if (r - hr < q.r0 + 0.18 || r + hr > q.r1 - 0.18 || f - hf < q.f0 + 0.18 || f + hf > q.f1 - 0.18) return false;
      if (q.doors.some(([a, b]) => Math.hypot(a - r, b - f) < 1.3 + Math.max(hr, hf) * 0.6)) return false;
      return !list.some((o) => o !== t && !riders(list, t).includes(o) && !allowed(t, o) && clip(t, o, r, f));
    };
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (allowed(a, b) || !clip(a, b)) continue;
        const mover = a.rank < b.rank ? a : a.rank > b.rank ? b : b, other = mover === a ? b : a, s = mover.s;
        if (!s || mover.rank >= 8) continue;
        const q = inRoom(s.r, s.f);
        let dr = s.r - at(other).r, df = s.f - at(other).f;
        const L = Math.hypot(dr, df) || 1;
        dr /= L;
        df /= L;
        let moved = false;
        if (q) {
          search: for (const [ur, uf] of [[dr, df], [-df, dr], [df, -dr], [-dr, -df]]) {
            for (let go = 0.15; go <= 2.1; go += 0.15) {
              const r = s.r + ur * go, f = s.f + uf * go;
              if (!fits(mover, q, r, f)) continue;
              for (const o of riders(list, mover)) {
                at(o).r += r - s.r;
                at(o).f += f - s.f;
              }
              s.r = r;
              s.f = f;
              moved = true;
              break search;
            }
          }
        }
        if (moved || searched(s) || (!SHELVES.has(s.id) && (s.on || mover.rank > 1))) continue;
        // (clutter with nowhere to go, and anything kept on it, is not there)
        for (const o of [mover, ...riders(list, mover)]) if (o.s) plan.stood.splice(plan.stood.indexOf(o.s), 1);
        pass = -1;
        break;
      }
      if (pass < 0) break;
    }
  }
  return plan;
}

/** what is kept on top of a thing, and goes where it goes */
function riders(list: Thing[], t: Thing) {
  const top = (at(t).y ?? 0) + t.h;
  return list.filter((o) => o !== t && Math.abs((at(o).y ?? 0) - top) < 0.25 && Math.hypot(at(o).r - at(t).r, at(o).f - at(t).f) < Math.max(t.w, t.d) / 2);
}
