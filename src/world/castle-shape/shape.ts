// The fort's shape put together: every part laid where the world stands it, a piece at a time (castleShape, castleShapeIn, castleShapeSteps).
// (One part of castle-shape.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { KIT_TOWER, kitMatrix, kitBlocks, kitPoint, inCut, kitSolids } from '../../sim/kit';
import { type Slab, type V3, type Part, type Paint, type Body, type Rail, castleGround, type Loose, LOOSE, type FortPlace, type GroundAt, CASTLE_SCALE, castleLocal, castleAt, looseLocal, castleLoose, castleParts, looseParts, hatchLine, UNDER, CASTLE, towerRadius, castleKit, castleRocks } from '../../sim/castle';
import { FAR_TINT, MOTTLE, Out, PAINTS, PIECE, SHEETS, STUFF, TILE, VOID, add, hidesOf, mul, skin, sub, unit, type Hide, type Shape, type Sheet, type Skin, type Solid } from './base';
import { beamPart, block, boxPart, curtainPart, flightPart, railRun, slabPart, wallPart, type Gap, type Put } from './parts';
import { apronPart, lidPart, lumpPart, moundPart, vaultPart, type LidNet, type Way } from './ground-parts';
import { towerLater, towerPart, towerSteps } from './towers';
import { Faces } from './faces';

/**
 * THE RAMP'S FOOT IS IN THE GROUND. Where a world brings its own mountain up to the foot of the ramp (no rock is made
 * for it to land on), the mountain is the world's and comes to within a hand of the height it was asked for, not to
 * it: the boards ended in the air, a hand and more over the path, with the day under them (2026-10-14, played: "gaps
 * at the top of the ramps and stairs ... where they dont meet flush"). So there the boards run on down their own
 * slope until their end is under the ground all the way across, as boards laid on a hillside do.
 */
function landed(p: Slab, ground: (x: number, z: number) => number): Slab {
  const [a, b, c, d] = p.p, down = unit(sub(b, a));
  if (down[1] >= 0) return p;
  const under = (q: V3, t: number) => { const at = add(q, mul(down, t)); return at[1] < ground(at[0], at[2]) - 0.04; };
  for (let t = 0; t <= 3; t += 0.05) if (under(b, t) && under(c, t) && under(mul(add(b, c), 0.5), t)) return t ? { ...p, p: [a, add(b, mul(down, t)), add(c, mul(down, t)), d] } : p;
  return p;
}

function lifted(p: Part, g: number): Part {
  switch (p.t) {
    case 'box': return { ...p, y0: p.y0 + g, y1: p.y1 + g };
    case 'wall': return { ...p, y0: p.y0 + g, top: typeof p.top === 'number' ? p.top + g : p.top.map((t) => t + g), openings: p.openings?.map((o) => ({ ...o, y0: o.y0 + g, y1: o.y1 + g })) };
    case 'lump': return { ...p, y: p.y + g };
    default: return p;
  }
}

function emit(p: Part, of: (paint: Paint) => Out, solids: Solid[] | null, lod: number, ground: (x: number, z: number) => number, gaps: Gap[] = [], ways: Way[] = [], lid?: LidNet) {
  const body: Body = p.body ?? 'all';
  const put: Put = (s) => void (solids && body !== 'none' && solids.push(s));
  const o = p.hidden ? VOID : of(p.paint);
  // (a wall that stands on another wall has no floor at its foot for snow to drift against: the upper shell of the keep)
  o.base = p.t === 'wall' && p.y0 > 0.1 && /^keep .* face$/.test(p.name ?? '') ? null : p.t === 'box' || p.t === 'wall' ? p.y0 : p.t === 'tower' ? 0 : p.t === 'lump' ? p.y - p.ry : p.t === 'flight' ? p.foot[1] : null;
  o.ground = !!p.sits || p.t === 'apron';
  o.roofed = !!p.roofed;
  o.walked = p.paint === 'paving';
  if (p.t === 'tower') of('timber').base = of('base').base = null;
  if (p.t === 'wall' && p.paint === 'stone') Object.assign(of('base'), { base: o.base, ground: o.ground, roofed: o.roofed });
  if (p.t === 'box' && p.name === 'footing') {
    // (the footing under a wall gives way to a hatch's passage where one goes through it, under the ground: it is
    // made in pieces round the passage)
    const through = gaps.filter((g) => g.x > p.x0 - 0.2 && g.x < p.x1 + 0.2 && g.z > p.z0 - 0.2 && g.z < p.z1 + 0.2);
    if (through.length) {
      const alongZ = p.z1 - p.z0 > p.x1 - p.x0, at = (g: Gap) => (alongZ ? g.z : g.x), lo = Math.min(...through.map(at)) - 1.1, hi = Math.max(...through.map(at)) + 1.1;
      const piece = (a: number, b: number, ya: number, yb: number) => void (b - a > 0.05 && yb - ya > 0.05 && boxPart(alongZ ? { ...p, z0: a, z1: b, y0: ya, y1: yb } : { ...p, x0: a, x1: b, y0: ya, y1: yb }, o, put));
      const [u0, u1] = alongZ ? [p.z0, p.z1] : [p.x0, p.x1];
      piece(u0, lo, p.y0, p.y1);
      piece(hi, u1, p.y0, p.y1);
      piece(lo, hi, through[0].y1, p.y1);
      piece(lo, hi, p.y0, through[0].y0);
      return;
    }
  }
  switch (p.t) {
    case 'box': return boxPart(p, o, put);
    case 'slab': return slabPart(p, o, put);
    case 'beam': return beamPart(p, o, put);
    case 'rail': return railRun(o, put, (p as Rail).a, p.b, p.tone, p.name);
    case 'flight': return flightPart(p, o, put);
    case 'wall': return wallPart(p, o, p.hidden || p.paint !== 'stone' ? o : of('base'), put, lod);
    case 'curtain': return curtainPart(p, o, put, lod, gaps);
    case 'tower':
      if (towerLater.on && !lod) return void (towerLater.sections = towerSteps(p, o, of('timber'), of('base'), put, lod));
      return towerPart(p, o, of('timber'), of('base'), put, lod);
    case 'mound': return moundPart(p, o, put, lod, ground, ways);
    case 'lump': return lumpPart(p, o, put, lod);
    case 'apron': return lid ? lidPart(p, o, put, ground, lid) : apronPart(p, o, put, ground);
    case 'vault': return vaultPart(p, o);
  }
}

/**
 * The fort as shapes, and the loose pieces of its grounds with it.
 * @param ground how high the ground is at a spot, over the terrace (the loose pieces stand on it)
 * @param loose the loose pieces, in the fort's own measure: where nobody has said, where the real ones stand
 * @param rock whether the rock the ramp leaves from is made (not where the mountain itself comes up to the ramp's foot)
 */
export function castleShape(ground: (x: number, z: number) => number = castleGround, loose: Loose[] = LOOSE, rock = true, tally?: Record<string, number>, note?: Note): Shape {
  const steps = castleShapeSteps(ground, loose, rock, tally, note);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * THE SAME, WHERE A WORLD HAS STOOD IT: on that world's ground (`ground`: how high it is at a spot of the world, as
 * it was before anything was cut for the fort), with its loose pieces where that world set them down, and with what
 * its cuts left of the ground's own net (`FortLid`). A piece at a time, as `castleShapeSteps` is. It is what
 * CastleSite draws and stands; whoever counts what is drawn and stood on over the passage asks here too.
 */
export function castleShapeIn(P: FortPlace, ground?: GroundAt, loose?: Loose[], rock = P.rock !== false): Generator<Shape | undefined, Shape, void> {
  const S = CASTLE_SCALE, c = Math.cos(P.rot), s = Math.sin(P.rot), L = ground && P.lid;
  // (the world's net in the fort's own measure: a fifth smaller, and turned as the world is from where the fort stands)
  const net: LidNet | undefined = L ? { cell: L.cell / S, ex: [c, s], ez: [-s, c], squares: L.squares.map((q) => ({ x: castleLocal(P, q.x, 0, q.z)[0], z: castleLocal(P, q.x, 0, q.z)[1], open: q.open, low: (q.low - P.y) / S })) } : undefined;
  return castleShapeSteps(ground ? (x, z) => (ground(castleAt(P, x, z)[0], castleAt(P, x, z)[2]) - P.y) / S : undefined, looseLocal(P, loose ?? castleLoose(P)), rock, undefined, undefined, net);
}

/** For whoever looks the shape over piece by piece (which faces of two pieces lie in one plane): told of each piece as it is made from near, whether it is of the lower levels, and how long each sheet's row of corners was before it and after ([sheet by sheet, in SHEETS' order]) */
export type Note = (part: Part, low: boolean, from: number[], to: number[]) => void;

/**
 * THE SAME, A PIECE AT A TIME, for whoever cannot stop for it (the game, as it starts: all of it at once was three
 * quarters of a second in which nothing was drawn, for a fort nobody starts near). What is seen from far off is
 * made FIRST, with the earth laid over what the world cut for it (which is seen from the first, or the cut would
 * be): then it stops and hands over the shape as far as it has got, whose `far`, `farOwn` and `near.earth` are
 * finished. After that it stops after every piece, handing over nothing; and at the end it hands over the whole.
 * The shape it makes is the one `castleShape` makes, to the last number.
 */
export function* castleShapeSteps(ground: (x: number, z: number) => number = castleGround, loose: Loose[] = LOOSE, rock = true, tally?: Record<string, number>, note?: Note, lid?: LidNet): Generator<Shape | undefined, Shape, void> {
  const sheets = () => Object.fromEntries(SHEETS.map((p) => [p, skin()])) as Record<Sheet, Skin>;
  const near = sheets(), under = sheets(), far = skin(), solids: Solid[] = [];
  const all = [...castleParts().filter((p) => rock || !/outcrop|ramp head/.test(p.name ?? '')), ...loose.flatMap((l) => looseParts(l, ground(l.x, l.z), ground))].map((raw) => (raw.sits ? lifted(raw, ground(raw.sits[0], raw.sits[1])) : !rock && raw.t === 'slab' && raw.name === 'ramp' ? landed(raw, ground) : raw));
  // (where each hatch's passage goes through the foot of a wall, half way between its ends)
  const gaps: Gap[] = loose.filter((l) => l.kind === 'hatch').flatMap((l) => {
    // (along the last eight metres of its passage, by the fort)
    const L = hatchLine(l, ground(l.x, l.z)), b = L.path[L.path.length - 1], a = L.path[L.path.length - 2], len = Math.hypot(a[0] - b[0], a[2] - b[2]), out: Gap[] = [];
    for (let d = 0.3; d <= Math.min(len, 8); d += 0.7) {
      const y = b[1] + ((a[1] - b[1]) * d) / len;
      out.push({ x: b[0] + ((a[0] - b[0]) * d) / len, z: b[2] + ((a[2] - b[2]) * d) / len, y0: y - 0.6, y1: y + UNDER.hatch.tall + 0.7 });
    }
    return out;
  });
  // (the blocks that hide what lies against them: those that are seen, stop everything, and stand square to the fort.
  // NOT one that a hatch's passage goes through: it is said as a whole block and made with a way through it, and said
  // to hide, it hid the passage: the last pace and a half of its floor, its walls and its roof were left unmade where
  // it comes in under the wall's footing. 2026-10-13: "the path underground at the base of the stairs is bugged with
  // panels and textures missing".)
  const holed = (b: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }) => gaps.some((q) => q.x > b.x0 - 0.9 && q.x < b.x1 + 0.9 && q.z > b.z0 - 0.9 && q.z < b.z1 + 0.9 && q.y1 > b.y0 && q.y0 < b.y1);
  const hides = hidesOf(all.flatMap((p): Hide[] => (p.t === 'box' && !p.hidden && !p.yaw && p.paint !== 'water' && p.at !== 'far' && (p.body ?? 'all') === 'all' && !holed(p) ? [{ x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, z0: p.z0, z1: p.z1, low: !!p.low }] : [])));
  const outs = (to: Record<Sheet, Skin>, low: boolean) => Object.fromEntries(PAINTS.map((p) => [p, new Out(to[STUFF[p].sheet], TILE[p], STUFF[p].tint, MOTTLE[p], PIECE[p], hides, low)])) as Record<Paint, Out>;
  const nears = outs(near, false), unders = outs(under, true);
  const fars = Object.fromEntries(PAINTS.map((p) => [p, new Out(far, 1, FAR_TINT[p], MOTTLE[p], 0)])) as Record<Paint, Out>;
  const ways: Way[] = loose.filter((l) => l.kind === 'hatch').map((l) => ({ L: hatchLine(l, ground(l.x, l.z)), g: ground(l.x, l.z) }));
  const shape: Shape = { near, under, far, farOwn: 0, solids };
  // (one face to a place: see `Faces`. Each sheet's triangles are asked as far as `asked`; water is seen through, and is nobody's face)
  const faces = new Faces(), asked = { near: SHEETS.map(() => 0), under: SHEETS.map(() => 0) };
  const oneFace = () => SHEETS.forEach((s, i) => {
    if (s === 'water') return;
    asked.near[i] = faces.take(near[s], asked.near[i], false);
    asked.under[i] = faces.take(under[s], asked.under[i], true);
  });
  /** a piece as it is from near: drawn, and what of it stops a body */
  const close = (p: Part) => {
    // (`tally`, for whoever asks what it costs: how many triangles each kind of piece is drawn with from near, by its name)
    const to = p.low ? under : near, was = tally ? SHEETS.reduce((t, s) => t + to[s].pos.length, 0) : 0, from = note ? SHEETS.map((s) => to[s].pos.length) : [];
    emit(p, (paint) => (p.low ? unders : nears)[paint], solids, 0, ground, gaps, ways, lid);
    oneFace();
    note?.(p, !!p.low, from, SHEETS.map((s) => to[s].pos.length));
    if (tally) {
      const key = `${p.low ? 'under' : 'near'} ${p.t} ${p.name ?? ''}`;
      tally[key] = (tally[key] ?? 0) + (SHEETS.reduce((t, s) => t + to[s].pos.length, 0) - was) / 9;
    }
  };
  // ---- FIRST: what is seen from far off, and the earth laid over the cut ground
  for (const p of all) {
    if (p.at) emit(p, (paint) => fars[paint], null, 1, ground, gaps, ways);
    if (p.t === 'apron') close(p);
  }
  // (from far off a block for each block of the kit's pieces, less what has been broken out; and a plain round for
  // each tower's foot, which is the kit's round tower: all of it stands only until the kit's own far copy has come)
  shape.farOwn = far.pos.length / 9;
  for (const tw of all) {
    if (tw.t !== 'tower') continue;
    const foot = -KIT_TOWER.top[0] * CASTLE.tower.kit, ys = [-0.01, foot + KIT_TOWER.waist[0] * CASTLE.tower.kit, foot, tw.foot], N = 16;
    const at = (a: number, y: number): V3 => [tw.cx + Math.cos(a) * towerRadius(y), y, tw.cz + Math.sin(a) * towerRadius(y)];
    fars.base.base = null;
    for (let i = 0; i + 1 < ys.length; i++) for (let k = 0; k < N; k++) {
      const a0 = (k * 2 * Math.PI) / N, a1 = ((k + 1) * 2 * Math.PI) / N, am = (a0 + a1) / 2;
      fars.base.quad([at(a0, ys[i]), at(a1, ys[i]), at(a1, ys[i + 1]), at(a0, ys[i + 1])], [[a0 * 4, ys[i]], [a1 * 4, ys[i]], [a1 * 4, ys[i + 1]], [a0 * 4, ys[i + 1]]], [Math.cos(am), 0, Math.sin(am)], 0.9);
    }
  }
  for (const p of castleKit()) {
    const m = kitMatrix(p), sc = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale ?? [1, 1, 1];
    if (sc[0] < 0.3) continue;
    const ax = [0, 1, 2].map((k) => unit([m[k * 4], m[k * 4 + 1], m[k * 4 + 2]]));
    for (const b of kitBlocks(p.id) ?? []) {
      const c = kitPoint(m, [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2]);
      if ((p.cut ?? []).some((k) => !k.capsOnly && inCut(k, c))) continue;
      fars.stone.base = null;
      block(fars.stone, c, ax, [((b[1] - b[0]) / 2) * sc[0], ((b[3] - b[2]) / 2) * sc[1], ((b[5] - b[4]) / 2) * sc[2]], 0.9);
    }
  }
  yield shape;
  // ---- THEN the rest of it, a piece at a time
  for (const p of all) {
    if (p.at === 'far' || p.t === 'apron') continue;
    // (a tower in its sections: but not for whoever is counting what each piece comes to, who wants it whole)
    towerLater.on = p.t === 'tower' && !tally && !note;
    close(p);
    towerLater.on = false;
    const sections = towerLater.sections;
    towerLater.sections = null;
    if (sections) {
      while (!sections.next().done) yield undefined;
      oneFace();
    }
    yield undefined;
  }
  // (the kit's pieces, the walls, the gatehouse, blocks of fallen wall: what stops a body, as the kit says)
  for (const k of kitSolids(castleKit())) solids.push(k.t === 'box' ? { ...k, feet: false, surface: 'concrete' } : { t: 'hull', pts: k.pts, feet: false, surface: 'concrete', name: k.name });
  // (and the scanned rock under the walls and round the ramp's rock, each as the rock it is drawn as: see `KIT_ROCK`)
  for (const k of kitSolids(castleRocks(ground, rock))) if (k.t === 'hull') solids.push({ t: 'hull', pts: k.pts, feet: false, surface: 'rock', name: k.name });
  if (tally) tally['left out, never seen'] = hides.count;
  return shape;
}
