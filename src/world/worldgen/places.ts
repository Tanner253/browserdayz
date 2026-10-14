// The map's measures and its places as numbers: its size and seed, the expansions (the Chemical Works, the bunker, Kamenka), the loop road (LOOP) and the mountain with its fort (MOUNTAIN).
// (One part of worldgen.ts, cut out of it whole on 2026-10-14 so that it can be read and worked on alone: nothing in it was changed.)

import { BUNKER } from '../../sim/bunker';
import type { Loose } from '../../sim/castle';

export const WORLD_SEED = 1337;

/**
 * The map was first made 1024 m square (513 height samples a side) and has been grown since, the same middle
 * in a bigger square, with nothing of it moved: every sample of the old ground is still a sample (the grid
 * grew by a whole number of cells each side), the ground's shape is written in metres from the middle, and
 * whatever read the EDGE of the map (where trees are planted from, where rocks are thrown, how far out a
 * place may be put) reads OLD_HALF, where the edge was. test/expansion.test.ts holds it to that.
 */
export const OLD_HALF = 512;

export const WORLD_SIZE = 1536; // metres, square, centred on the origin

export const WORLD_RES = 769; // height samples per side

export const CELL = WORLD_SIZE / (WORLD_RES - 1); // 2 m

/**
 * The ground smoothed, 2026-10-13 (the owner, of the map as it stood: "we will smooth out any terrain"; and of the
 * knife ridges in its meadows, told they were as old as the map and that softening them moves ground everywhere a
 * little: "sure").
 *   EDGE_ROUND - metres either side of the lines from the old square's corners to the map's within which the
 *                mountains of the edge turn the corner in a curve (see `edgeOf`)
 *   SOFTEN     - the knife edges of the open ground rounded off (see `soften`): `from`..`full`, how sharp a spot is
 *                (metres its height stands off the line between its neighbours 2 m either side) before it is
 *                rounded at all, and when in full; `passes`, how many times over; `steep`, the lie of the land
 *                about a spot (its fall in a metre, over some sixteen metres) above which it is a hillside's own
 *                face and left alone; `high`, how much of an edge mountain it may be
 */
export const EDGE_ROUND = 40;

export const SOFTEN = { from: 0.65, full: 1.2, passes: 8, steep: [0.45, 0.8], high: [0.35, 0.75] };

export const PLAY_RADIUS = 400;

/**
 * The map's first expansion. The valley the map began as is ringed by hills; behind the
 * Military Checkpoint a cirque has been cut into them, open toward the checkpoint and walled
 * on every other side, and the Chemical Works stands on its floor. It lies wholly outside the
 * ring the map used to end at. `floor` is how far out from its middle the ground is level,
 * `wall` how much further the hillside takes to come back up to where it was, `level` how
 * high the floor lies over the lowest of the ground on the way in.
 */
export const EXPANSION = { name: 'Chemical Works', x: -368, z: 368, floor: 84, wall: 56, level: 12 };

/** Where the map is played: the valley, and what has been added to it. */
/** Where the bunker is (see src/sim/bunker.ts): straight across the map from the works, in the foot of the hills there. */
export const BUNKER_AT = { x: (-EXPANSION.x / Math.hypot(EXPANSION.x, EXPANSION.z)) * BUNKER.out, z: (-EXPANSION.z / Math.hypot(EXPANSION.x, EXPANSION.z)) * BUNKER.out };

/**
 * The town built on the ground the map was grown by (2026-10-10): out of the valley by the road, which is carried
 * on to it and through it. `street`: the way its one street runs. `r`: how much of the country round it is the
 * Zona's; `gate`: the round of the Zona that joins it to the valley, over the road between the two.
 */
export const TOWN = { name: 'Kamenka', x: 625, z: 365, street: [0.349, 0.937] as [number, number], r: 150, /** how far from its middle a place for a thing is the town's own (see the economy) */ stocked: 118, gate: { x: 455, z: 203, r: 110 } };

/**
 * Kamenka lies in a valley of its own, as the old map lies in its valley: a level floor the shape of the town
 * (longer down the street than across it), and a wooded rim all round that rises from it, crests and falls away
 * again outside. This is how far out a spot is: 0 in the middle, 1 at the edge of the floor (95 m down the
 * street, 58 m across it), 2.55 on the crest of the rim, 3.4 at its outer foot. West and north of the town the
 * rim stands on ground of the old map, where there was nothing but the hill and its trees.
 */
export function kamenkaQ(x: number, z: number): number {
  const l = Math.hypot(...TOWN.street), ux = TOWN.street[0] / l, uz = TOWN.street[1] / l, dx = x - TOWN.x, dz = z - TOWN.z;
  return Math.hypot((dx * ux + dz * uz) / 95, (dx * uz - dz * ux) / 58);
}

export const KAMENKA = { floor: 1, crest: 2.55, foot: 3.4 };

/** the line the road takes on from where it used to run off the old ground: round to the town's street, and down it */
export function eastRoad(): [number, number][] {
  const l = Math.hypot(...TOWN.street), on = (k: number): [number, number] => [TOWN.x + (TOWN.street[0] / l) * k, TOWN.z + (TOWN.street[1] / l) * k];
  // (and ends at the end of its street: carried on, it ran off the edge of the ground into nothing)
  return [[540, 230], [566, 243], [585, 262], on(-80), on(-30), on(30), on(92)];
}

/**
 * The way over between the two valleys. The old road ended by running straight up the side of its valley: eighty
 * five metres up in a hundred and fifty along, a wall no car climbs, and it did not matter, for it went nowhere.
 * It goes to Kamenka now. So the hill is cut down along it and the foot of it banked up: one even climb from the
 * floor of the one valley to the floor of the other, a fifth of a metre in every metre, through a cutting whose
 * sides a wood can stand on.
 *   from  – how far east along the old road the climb begins (x, metres)
 *   bed   – half the width that is level across, the road and its verges
 *   side  – how steeply the sides of the cutting and of the bank stand (rise over run)
 *   reach – how far from the road any of this goes
 *
 * Laid back (2026-10-13: "people complain that the chokepoint to kamenka is too restrictive and tight making it easy
 * to gatekeep the loot"). The cutting was a trench: its sides stood at thirty-two degrees from the verge up, with the
 * old hill's own cliffs over them, and for 320 m there were not fifteen metres of ground beside the road that
 * anybody could stand on. One squad at the top held it. The road keeps its line and its height, and the hill is
 * taken back from it: for `open` metres either side the ground rises only `bench` in one (a wood, with rocks in it,
 * that is gone up through to left or right of the road), and beyond that at `lay`, which is still a hillside to
 * walk and not to scramble, until it meets the hill. So the top can be come at from the side. Only what stood OVER
 * the road is taken down: the bank that carries the road up from the old valley's floor is as it was. And the
 * mountains of the map's edge are not laid back at all: where they begin, the hill is taken back only `keep` metres
 * and stands over that at `wall`.
 */
export const PASS = { from: 245, bed: 5.5, side: 0.62, reach: 190, open: 75, bench: 0.2, lay: 0.55, keep: 16, wall: 1 };

/**
 * The road made a loop (2026-10-12: "can we make the road that travels to the east town pass through and loop
 * around, i think its time we make a full loop with the road. we will need to taper out some of the mountains
 * around the east town and run the road through the wilderness"; "people complain that the chokepoint to kamenka is
 * too restrictive and tight ... make the road pass through kamenka and loop back around to the main road, so that
 * you can get to kamenka from multiple directions"; "the road should follow the natural geography of the land.
 * perhaps we even make a bridge over a valley").
 *
 * It was one road with a dead end at each end. Now it goes on out of the far end of Kamenka's street, through a
 * second door in the town's rim, over a gorge on a bridge, west along the high ground south of the old valley,
 * round behind the Chemical Works and north along the high ground west of the valley, and comes down into the
 * valley again by a second pass, onto the old road's west end. Village, pass, Kamenka, bridge, round and home.
 *
 *   door   – on from the end of the street: round to the south-west and out through the rim, to the bridge's north
 *            end. The rim is let down into a saddle about it, as it was about the first door.
 *   bridge – (see src/sim/bridge.ts) from the door's last point to this one
 *   shelf  – on from the bridge's south end, round the foot of the south mountains and west along the shelf, behind
 *            the works, and north to the head of the west pass
 *   west   – the head of the west pass: round and down to the old road's first point. From there the old road is
 *            the way, on its own line, as far down as `foot` (x, metres): the last of it that was level enough to
 *            leave as it was. Everything east of that is as it was.
 */
export const LOOP = {
  door: [[661, 470], [658, 497], [646, 527], [628, 556], [610, 583], [590, 598], [572, 602], [555, 602]] as [number, number][],
  /** the bridge's far end, and how high its deck lies (the road's surface on it): level from bank to bank */
  bridge: [489, 602] as [number, number],
  deck: 102.5,
  shelf: [
    [474, 602], [452, 600.5], [430, 598], [408, 596], [385, 596], [350, 596], [300, 592], [240, 590], [180, 588], [120, 586], [60, 584], [0, 580], [-50, 575],
    [-100, 571], [-150, 574], [-200, 580], [-250, 582], [-310, 580], [-370, 574], [-425, 556], [-464, 526], [-488, 490], [-499, 451], [-532, 406], [-566, 350],
    [-582, 280], [-586, 200], [-584, 120], [-590, 50],
  ] as [number, number][],
  west: [[-600, 8], [-612, -38], [-617, -84], [-605, -124], [-578, -148]] as [number, number][],
  foot: -357,
  /** the most the new road climbs, rise over run: out of the town, and along the shelf (the west pass is one even climb, as the east one is) */
  steep: { door: 0.13, shelf: 0.1 },
  /**
   * The ground beside it. Out of the town and along the shelf: level across for the road and its verges, then
   * `bench` in one for `open` metres where the ground stands over the road, `lay` beyond, and `side` where the road
   * is banked up over it; nothing further off than `reach`. The west pass is laid back as the east one is (PASS).
   */
  banks: { door: { reach: 120, open: 45, bench: 0.2, lay: 0.5, side: 0.5 }, shelf: { reach: 46, open: 14, bench: 0.3, lay: 0.5, side: 0.5 } },
  /**
   * The cleft the bridge is over. Between Kamenka's rim and the south mountains the ground was a hollow with no
   * way out of it; it is cut down into a cleft from the foot of the one hill to the foot of the other, and the road
   * goes over. Nobody drives round it: its ends are the two hills. Anybody can walk round the bridge through it.
   *   line  – down its bed, north to south: [x, z, how high the bed is]
   *   ways  – the two gullies that run down into it, which are the ways into it on foot: one from the saddle on
   *           the town's side of the bridge, one from the open ground on the far side. Each from the cleft's bed
   *           up to where it comes out onto the ground, a third of a metre up in every metre
   *   bed   – half the width of a bed
   *   side  – how steeply the sides stand (a steep bank, not a scramble); `under` – and under the bridge, between
   *           the banks it springs from; `near` – how far up or down the cleft from the bridge's own line that
   *           goes on, and by how far it has eased
   */
  cleft: {
    line: [[533, 560, 97], [528, 570, 86], [524, 580, 81.5], [521.5, 602, 80], [518.5, 624, 81.5], [514, 634, 86], [508, 644, 97]] as [number, number, number][],
    ways: [
      [[524, 580, 81.5], [533, 570, 84], [544, 562, 88], [558, 557, 93], [572, 555, 98], [584, 556, 101.5]],
      [[521, 588, 81], [510, 580, 84], [498, 574, 88.5], [486, 570, 93], [474, 567, 97], [462, 564, 100]],
    ] as [number, number, number][][],
    bed: 4,
    side: 0.76,
    under: 0.84,
    near: [10, 24] as [number, number],
    reach: 78,
  },
  /**
   * A lay-by on the lip of the Chemical Works: a level place beside the road on the side toward the works, out to
   * the very lip, from which all of the works is seen from above. `at`: the place on the road it is beside; `off`:
   * how far its middle is from the middle of the road; how long it is along the road, and how wide.
   */
  layby: { at: [-499, 451] as [number, number], off: 9.5, long: 30, wide: 12 },
  /**
   * The Zona along it (see PLAY_AREAS): rounds of `zona` metres strung along the new road every `every` metres,
   * each with its middle `inward` metres to the valley's side of the road, so that the ground between the road and
   * the valley is all the Zona's and there are ninety metres of wood outside the road to fight in. Near a place
   * that is to stay outside the line (OUTLYING) a round is only as big as leaves that place `clear` metres outside.
   */
  zona: 140,
  inward: 50,
  every: 48,
  clear: 36,
};

/**
 * The mountain road and the fort it leads to (2026-10-13; chosen by the owner of three ideas for the north: "for
 * the castle I'd build a mountain road"). The road leaves the first pass just outside Kamenka's first door and goes
 * north over the shoulder of the town's rim and along the foot of the mountain east of the old valley, through the
 * pines. It was first carried on up the mountain to a fort on its brow, and the owner said of that: "i fear youve
 * overcomplicated the path and surrounding geography of the castle ... it doesnt render well, we need to rethink
 * the land and road and paths leading to the castle for a more natural environmen", and "i dont like how the
 * terraain and building are floating on a raise \"pad\"". So the fort stands now on the bench of the valley's east
 * rim, on the bench as the bench is (see `castle`, below, for where on the bench and why).
 * TURNED TO THE ROAD (2026-10-14, the owner, having played it: "i feel like the caste is not properly rotated to
 * face the entrance (the road)"; offered a place at the road's end instead: "i do not want the building moved that
 * cvlose to the road, i simply want it roatated so the draw bdige faces the road"). It stood with its gate to the
 * east-south-east, at the shelf under the hill, 46 to 49 degrees off the road and with its back to the track. It is
 * turned forty degrees where it stands: its gate looks south by a little east, down the last stretch of the road
 * (four or five degrees off it) and straight down the last of the track. Toward the road the land lay six metres
 * under where the ramp must come down, so the hill's foot is run out to it (`shoulder`), and the track climbs that.
 * THE ONE RULE OF THIS PLACE: what is not cut cannot look cut. Nothing here is a terrace, a
 * bench, a hollow or a zigzag, and nothing made keeps one width or one edge for more than fifteen metres.
 *
 *   road    – the points the road is drawn through: the first is on the pass road. It ENDS past the draw it
 *             crosses on its bank, at the first place its bed is on the ground as the ground is: where a cart
 *             would leave it, a house's height over the bench. (It went on north along the mountain's foot,
 *             twenty metres over the bench, and from it an eye looked down into the fort: "a fort looked down
 *             into is a model"; and the bank it stood on was the backdrop of every look east from the fort.
 *             Nor is it turned down onto the bench itself: a road is eleven metres of level ground, and laid
 *             along the mountain's foot it cut four metres into it.)
 *   wide    – it is a lesser road than the loop: narrower, and its asphalt breaks up where it stops
 *   steep   – the most it climbs, rise over run (the passes are steeper)
 *   banks   – the ground beside it (as LOOP.banks)
 *   end     – over so many metres before it stops, less and less of the ground beside it is the road's and more
 *             and more of it the ground that was: a road that runs out, not a bank that is cut off. `sinks`: how
 *             far under the ground its last point lies (the track falls away from there at once, and a bed that
 *             begins a hand lower stands that much less over the ground on its way down). `eased`: over so many
 *             metres back from its end the brows and feet of its banks are rounded
 *   track   – the cart track from the road's end TO THE GATE, where it ends in a trampled place before the ramp's
 *             foot: the points it is drawn through (off the road's end and straight down its bank, north along the
 *             hill's foot where the bench meets it, onto the rise by the one house that stands beside it, and up
 *             the shoulder with the gate before it all the way); the most it climbs; over how many of its points either way (they are
 *             two metres apart) the ground's height is evened to make its bed; half the width of its bed and how
 *             steep its banks stand (rise over run), each as [the least, the most] (it is never one width for
 *             long, and no two of its banks are of one angle); how far from its middle the ground is its banks'
 *             at the most; and how far from its middle it is trodden bare. `hill`: from so far along it the
 *             hill that stands over it is left standing as it stands (a bank no steeper than `bank` at the
 *             edge of its bed, and nothing taken further off). `turn`: THE TURNING PLACE at its end, before
 *             the gate: so many metres about its last point, and `aside` toward the hill where the shoulder's
 *             top is broad, the ground is trampled and rutted every which way, where a cart was unloaded and
 *             turned, and where one could stand beside the way. Paint and wear: no yard is levelled for it.
 *             (2026-10-14: until the fort was turned it stopped at the houses, and a foot path went on round
 *             to a ramp on the far side of the fort from everybody who came. What follows is of the time before that.)
 *             (It went on, a hundred and forty metres more: behind the fort, round under its north wall and
 *             onto the shelf by a ledge under the hill. The judge of how the place looks, 2026-10-13, of that
 *             last third: an even ring round three sides of the fort, thirteen to twenty-four metres off its
 *             walls, and then a made ledge, its bank one in one and a half; and the owner's standing words are
 *             at the head of this. A cart never went up to that gate: the ramp is a foot bridge. So the track
 *             stops where carts stopped, the ring's ground is the ground that was, and the garrison walked.)
 *   castle  – where the fort stands (src/sim/castle.ts, src/world/castle.ts). THE FORT AS IT WAS FIRST LAID OUT,
 *             WHOLE, A FIFTH BIGGER (2026-10-13, the owner, of the kit's plain walls that were stood on a levelled
 *             yard in its place: "the castle layout we had before was AMAZINg and dynamic and perfect all i
 *             wanted was to scale it up by 20%"; and: "the left side of the castle is also too sharp of a cliff,
 *             to the bunker, i think the castle needs to be moved a bit so theres enough land all the way around
 *             it"). So: the middle of its keep, 40 m east and 23 m south of where the kit's fort stood, on the
 *             east side of the bench, 60 m and more from the brink; `rot`, which way it is turned (its gate to
 *             the south by a little east: at the road, see the head of this); and `terrace`, the height of its
 *             terrace: the least that leaves the bench under its lower levels' floor (it was first the height
 *             that put the ramp's foot on the shelf's edge, and is kept). It stands on that terrace over the
 *             bench as it stood over its mountain: the bench lies 6 to 12 m under it at the feet of its back
 *             and valley walls, and at the gate wall's west of the gate; its east corner stands at the
 *             shelf's edge. NO EARTH IS MOVED UNDER IT OR ROUND IT: what is made is before the gate (`shoulder`),
 *             and at the ramp's foot that is trimmed to
 *             the boards by `foot` metres at the most: no pad, no bank, no rock stood at the front (the rock the
 *             ramp left from in the plan is not made: `rock: false`). Nothing grows within `clear` metres of its
 *             foot. `before`: the open ground before its gate, on the shelf, where the garrison's dead stand.
 *             `loose`: its loose pieces, each where this ground suits (the plan's own places are for the crest
 *             of the mountain it was first drawn on): the hamlet's five houses, the hatch of its sally port, the
 *             thin wall down the slope and the seven teeth of rock behind it.
 *             (On every bearing round its whole foot there are 20 m of ground before any fall, and no fall in
 *             them of more than 6 m, none steeper than 20 degrees. Toward the hill, north-east of it and beyond
 *             the ramp's foot, the ground RISES in those 20 m at up to 38 degrees: it is the hill's own foot.)
 *   foot    – THE LANE (2026-10-14: the track goes to the gate now, and this is the one walked way there is):
 *             off the track where it comes onto the rise, down the rise's own back and along the line the
 *             track once took between the three houses that lie off the way, to the trodden `yard` between
 *             two of them. A trodden line: PAINT AND WEAR ONLY, NO EARTH MOVED. `apron`, `doors`: as below.
 *             (What follows is of the foot path there was, from the houses up the shelf's flank to the old ramp:
 *             the hillside as it is. Between the stone of the fallen wall and the firs it had three
 *             metres to pass in, and takes the middle of them: eight and a half metres from the head of the
 *             hatch's steps at the nearest, with the firs between (no line up this flank is wider of it: east
 *             of the hatch the hill's foot stands at thirty-five to forty degrees). `apron`: the ground before the ramp's foot, trodden bare where
 *             everybody who ever came stood and waited: its middle, and half its length and its breadth [along
 *             the ramp's line, across it]. `doors`: so far from each house's door, at the most, the ground is
 *             trodden toward the nearest of the ways.
 *             (No line is trodden round to the back door or the breach. One was drawn to the back door, from the
 *             turning place round under the west tower: with the foot path it made half a ring about the walls
 *             on the plan, which is the thing that was taken away.)
 *             (No foot path goes down the bluff from the postern: under that wall, and for a hundred metres
 *             either way, the first twenty metres of the fall are forty-two to fifty-five degrees, which a body
 *             is carried or slides down (src/sim/slopes.ts), and a path is painted only where a body can walk
 *             it both ways.)
 *   wreck   – the helicopter that did not make it: on the bench north-west of the fort, in the trees outside its
 *             walls and in plain sight of their top, where a body can walk to it and back (the shelf under the
 *             valley wall, where it first lay, can only be slid down to): the middle of it, and which way it lies. Five places for things lie about it (src/world/buildings.ts).
 *   walls   – low dry-stone walls [from x, z, to x, z] about the houses along the track: each begins AT a house's
 *             wall (or at another's end) and runs behind the houses, toward the next of them or round a yard.
 *             None of them across a way that is walked: where the foot path goes through one, that length of it
 *             is down. How each is built is `wall`: told off in lengths of `step` metres, each lying to the
 *             ground under it; its top `high` over the ground [the least, the most], changing slowly along it and
 *             never by a step; and every `falls[0]` to `falls[1]` metres it has fallen for `gap[0]` to `gap[1]`
 *             (a slant down to a course or two, not a doorway). (They were told off in level boxes of a pace
 *             and three quarters, each of a height of its own: "their tops are stairs of one-metre squares and
 *             read as battlements, and down a slope they are stairs of level boxes", the judge.)
 *   seen    – no tree stands on the line from any of these places to the gate: [x, z], and how wide the open
 *             line is where it comes to the fort (unsaid: the arch's own width and a little). The road's end
 *             and two places on the track: the arch is in sight all the way. And three on the road, forty,
 *             sixty and eighty metres before its end, where it stands a house's height over the bench and the
 *             whole fort is before it: from there the line is as wide as the fort.
 *   felled  – A FIELD OF FIRE (the judge, 2026-10-13: "from the valley it is not there": the fort stands sixty
 *             metres back from the brink, behind the wood). A garrison fells what hides its enemy, so the wood
 *             is felled in a wedge from under the fort's valley-side walls out to the brink and a little down
 *             over it: from `from`, bearing `to` (west-south-west: at the village and the trader's), `long`
 *             metres, and from `half[0]` metres either side of that line at the walls to `half[1]` at ninety
 *             metres; its edge `ragged` metres in and out (no ride is ruled through a wood). Of the trees that
 *             stood there, so many in a hundred left a stump (`stumps`), so many are a dead trunk still standing
 *             (`trunks`), and `stands` are left alive, alone: the rest were grubbed out long ago.
 *             It uncovers neither the hatch nor the back door: of 216 lines from the tower tops and parapets to
 *             the head of the hatch's steps a tree stood on 212 before and stands on 212 after (they are the firs
 *             by the curved wall, which are not in it), and the back door was in plain sight of the walls already.
 */
export const MOUNTAIN = {
  road: [
    [552, 235], [556, 214], [560, 190], [562, 160], [562, 130], [566, 100], [578, 72], [592, 40], [598, 0], [600, -40], [597, -80], [590, -115], [578, -150],
    [576.2, -178], [574.8, -189], [573.2, -196],
  ] as [number, number][],
  wide: 5.5,
  steep: 0.16,
  banks: { reach: 60, open: 18, bench: 0.25, lay: 0.55, side: 0.55 },
  end: 26,
  sinks: 0.2,
  eased: 62,
  track: {
    line: [
      [573.2, -196], [569.2, -197.2], [564.6, -198.3], [560, -199.7], [555.8, -202], [552.3, -205.8], [549.7, -211], [547.7, -217.5],
      // (north along the hill's foot, never down into the low of the bench; and from the rise by the house up the shoulder to the gate: see `shoulder`)
      [547, -227.5], [545.6, -237], [549.4, -245.5], [554, -253], [556.7, -261], [557.2, -269.5], [556.4, -278], [554.4, -286], [552.2, -294], [551.2, -302], [551, -312], [550.5, -322], [549.6, -332], [548, -340.5],
      // (and it ends before the gate, on the ramp's own line, four and a half metres beyond its foot: see `turn`)
      [545.65, -346.14],
    ] as [number, number][],
    steep: 0.16,
    evens: 4,
    bed: [2, 2.3] as [number, number],
    bank: [0.2, 0.31] as [number, number],
    hill: { from: 36, bank: 0.85 },
    reach: 15,
    worn: 1.75,
    turn: 6,
    aside: 2.6,
  },
  castle: {
    name: 'Orlinoye', x: 537, z: -371, rot: (-75 * Math.PI) / 180, terrace: 100, foot: 1.5, clear: 9,
    before: [552.6, -343.3] as [number, number],
    loose: [
      // the hamlet's houses: three off the way, at the end of the lane; one beside the track where it begins to climb; and one on the shelf east of the fort
      { kind: 'house', n: 0, x: 495.5, z: -350.7, rot: -1.286 }, { kind: 'house', n: 1, x: 514.6, z: -348.5, rot: -1.556 }, { kind: 'house', n: 2, x: 532.1, z: -281.1, rot: 1.144 }, { kind: 'house', n: 3, x: 499.3, z: -326.2, rot: 1.944 }, { kind: 'house', n: 4, x: 572, z: -358, rot: 0.4 },
      // the hatch of the sally port: on the shoulder's valley flank, west of the way in and sixteen metres clear of the track
      // (its steps go down into the shoulder, toward the gate's line; its passage runs under the made ground and never comes under the track.
      // It, the curved wall and the firs stand to the fort exactly as they stood before it was turned: each turned with it about its middle.)
      { kind: 'hatch', n: 0, x: 530.85, z: -338.31, rot: Math.PI - (75 * Math.PI) / 180 },
      // THE CURVED WALL, the plan's own, which hid the hatch from the walls in the plan (there a house's gable did):
      // stood between the hatch and the fort, its round toward the fort, four to five metres from the middle of the
      // hatch's steps and three and a half from its kerb. By itself it hides whoever is at the head of the steps from
      // the gate wall's parapet and the keep's roof; from the top of the south-east tower, eleven metres over it,
      // two lines in five still went over it, and the firs by it (`firs`, below) stop those. Measured line by line
      // (36 eyes on the tower's top, the two parapets and the keep's roof; a body before the head of the steps, at
      // it and on its third step; at the knee, the belt and the head): seen on 117 lines of 333 with neither, on 43
      // with the wall alone, on none with both (a fir reckoned as a cone eleven metres tall, 2.2 m out at its lowest boughs).
      { kind: 'curved wall', n: 0, x: 538.91, z: -333.75, rot: -3.4732 },
      // the thin wall down the slope: down the hill's foot east of the way in, its low end four metres off the track
      // (where the plan has it, turned with the fort, it would stand across the lane to the houses and through a field wall)
      { kind: 'long wall', n: 0, x: 563, z: -317, rot: -2.112 },
      // the seven teeth of rock that stood BEHIND the fort in the plan. The thirteen about its front and its sides are
      // not set down: the owner, 2026-10-13: "get rid of the rocks near the front". (The curved wall is set down
      // again, above: not by the rock, which is not made, but by the hatch.)
      // AS TWO OUTCROPS NORTH OF IT, four teeth and three, each tooth against the next as rock breaks out of a
      // bench: they stood one by one along the inside of the track's ring, a tooth every dozen paces, "like
      // bollards" (the judge, 2026-10-13), and the ring is gone.
      { kind: 'rock', n: 13, x: 517.6, z: -391.4, rot: 21.49 }, { kind: 'rock', n: 14, x: 520.3, z: -393, rot: 23.19 }, { kind: 'rock', n: 15, x: 518.4, z: -395.2, rot: 24.89 }, { kind: 'rock', n: 16, x: 522.9, z: -396.1, rot: 26.59 },
      { kind: 'rock', n: 17, x: 530.6, z: -401.2, rot: 28.29 }, { kind: 'rock', n: 18, x: 533.3, z: -402.9, rot: 29.99 }, { kind: 'rock', n: 19, x: 531.1, z: -404.6, rot: 31.69 },
    ] as Loose[],
    // The firs by the curved wall, on the fort's side of the hatch: a clump such as the hillside has all about, left
    // standing where the ground round the fort was cleared ([x, z, which pine, how big]). They are what hides the
    // head of the hatch's steps from the top of the south-east tower: see the curved wall, above.
    // (Turned with the fort, 2026-10-14, each where it stood to it; and grown a hand taller, with one more: the hatch
    // stands lower against the tower tops on the shoulder's flank than it did under the shelf, and they look down on it more steeply.)
    firs: [[529.84, -342.55, 'pine_a', 1.3], [531.71, -343.85, 'pine_c', 1.25], [528.1, -341.26, 'pine_b', 1.25], [534.52, -345.02, 'pine_d', 1.3], [529.2, -344.6, 'pine_b', 1.2]] as [number, number, string, number][],
  },
  /**
   * THE SHOULDER (2026-10-14: the fort is turned where it stands so that its drawbridge faces the road, and toward
   * the road the land lay six metres under where the ramp must come down). The ground the ramp needs is made as a
   * thing the hill has: the hill's own foot run out toward the gate, as it already runs out in the shelf east of the
   * fort. Its top is the way in: it climbs with the track, never steeper than `steep`, from where the track's line
   * leaves the ground as the ground is (it is nowhere dug: only ever raised) to the height the boards come down to,
   * level for `level` metres before the ramp's foot and `past` beyond it toward the gate. Toward the hill it rises
   * `hill` in one and runs into the hillside; toward the valley its top is `top` metres wide (at the gate, and at
   * the most: it widens and narrows along the way), then rolls over a brow of `round` metres and falls at `fall`
   * (as the hill's foot falls beside it, and never one angle for long: twenty-six to thirty-one degrees, an
   * ordinary hillside to whoever walks it: src/sim/slopes.ts) to the bench, its foot `ragged` metres in and out;
   * toward the gate wall it falls at `north`, and the ramp crosses the gap. Where it meets the ground that was, the hollow of the join is rounded over `soft` metres of height. No
   * part of it is level across, none of its edges is a line, and nothing of it goes round the walls.
   * `from`: so far along the track before any of it is made (the road's own bank is the road's).
   */
  shoulder: { steep: 0.15, level: 8, past: 1.4, top: [2.6, 5.2] as [number, number], fall: [0.48, 0.6] as [number, number], north: 0.6, hill: 0.05, round: 2.6, ragged: 0.5, soft: 1, reach: 44, from: 30 },
  foot: {
    // THE LANE to the three houses: off the track where it comes onto the rise, down the rise's own back and along the old way between them
    line: [[552.2, -294], [545, -297.2], [538, -299.2], [531.5, -303.5], [526, -313], [521, -320.5], [516, -327], [511.6, -331.8], [508.5, -337], [506.5, -343.5], [505.3, -349.6]] as [number, number][],
    apron: { out: 3.9, half: [5, 4] as [number, number] },
    doors: 14,
    yard: 4,
  },
  // (2026-10-13: it follows the fort, which stands forty metres further east than it did: on the bench behind it still, north-west of its back wall)
  wreck: { x: 498, z: -421, rot: 0.9 },
  walls: [
    // the house west of the turning place: a yard behind it toward the fort, and a field wall from its other end to the house on the shoulder
    [490, -354.7, 488.3, -362.6], [488.3, -362.6, 495.9, -364.7], [493, -344.3, 493.3, -329.7],
    // the house east of it: a yard wall behind it, and a field wall south from its corner, down where the foot path goes through it
    [518.5, -353.6, 520.3, -361.3], [518.6, -343.5, 517.3, -332.6],
    // the one on the shoulder over the track
    [497.2, -319.6, 490.7, -316.5],
  ] as [number, number, number, number][],
  wall: { step: 1.1, high: [0.8, 1.2] as [number, number], thick: [0.55, 0.7] as [number, number], falls: [7, 13] as [number, number], gap: [1.6, 3.2] as [number, number] },
  seen: [[573.2, -196], [545.6, -237], [557.2, -269.5], [551.2, -302], [577, -156, 14], [582, -137, 14], [589, -118, 14]] as [number, number, number?][],
  felled: { from: [527, -366] as [number, number], to: [-0.76, 0.65] as [number, number], long: 104, half: [15, 39] as [number, number], ragged: 5, stumps: 45, trunks: 8, stands: 4 },
  /**
   * The Zona about it (2026-10-13: "THE ZONA'S LINE must hold the fort, the track and the hamlet (a tag carried
   * there is not carried out)"). The rounds strung along the road end with the road; these take in the track, the
   * houses, the fort and a hundred metres about it, the bluff under its valley wall with the foot path and the
   * wreck, and the hillside between the bench and the valley's own round, so that the line has no hole in it.
   */
  zona: [
    { x: 533, z: -273, r: 140 }, { x: 520, z: -340, r: 140 }, { x: 493, z: -395, r: 150 },
    { x: 384, z: -167, r: 74 }, { x: 382, z: -196, r: 84 }, { x: 378, z: -225, r: 95 }, { x: 376, z: -253, r: 108 }, { x: 371, z: -280, r: 120 }, { x: 371, z: -307, r: 136 }, { x: 379, z: -331, r: 158 }, { x: 385, z: -354, r: 178 },
  ],
};
