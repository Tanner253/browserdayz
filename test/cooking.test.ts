// Checks of the rules cooking spots are kept by (src/sim/cooking.ts): the campfire, the metal stove, and the fire
// with a pot that is to come. No network and no world: `npx tsx test/cooking.test.ts`.

import assert from 'node:assert/strict';
import {
  COOKS, COOK_KINDS, CookSpots, FUEL, HEAT, IGNITERS, TO_COME,
  cookSpots, cookable, cooks, doorState, fit, fuelLeft, fuelOf, gridOf, isFuel, isHot, isLit, keepCooked, kindOf, light, mayReach, mealOf, newSpot,
  noLighting, putIn, putOut, readSpot, seen, setGrid, shadow, spotKind, stageOf, stateOf, swingDoor, takeOut, tick, unfit, warmthOf,
  type CookSpot, type Cooked, type Part,
} from '../src/sim/cooking';
import { FIRE, Hearths } from '../src/sim/fires';
import { Container } from '../src/sim/inventory';
import { ITEMS, makeItem, type ItemInstance } from '../src/sim/items';

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

/** a wall clock to begin from, seconds, and one that is moved on as time is passed at a spot */
const T0 = 1_760_000_000;
let now = T0;
const pass = (spot: CookSpot, dt: number) => tick(spot, dt, (now += dt));
/** a thing of a kind, with a number of its own that can be read in a failure */
let made = 0;
const thing = (id: string, qty?: number): ItemInstance => ({ ...makeItem(id, qty), uid: `${id}-${++made}` });
const cookOf = (it: ItemInstance) => (it as ItemInstance & Cooked).cook;
const hotOf = (it: ItemInstance) => (it as ItemInstance & Cooked).hot;
/** a spot with its door stood open, if it has one (before it is lit: opening takes time, and time burns) */
const opened = (kind: string): CookSpot => {
  const spot = newSpot(kind), door = kindOf(spot).door;
  if (door) {
    assert.ok(swingDoor(spot, true));
    pass(spot, door.seconds);
    assert.equal(doorState(spot), 'open');
  }
  return spot;
};
/** the same, alight (a kind that burns on nothing; one that does not is given a bat first) */
const alight = (kind: string): CookSpot => {
  const spot = opened(kind);
  if (kindOf(spot).free <= 0) assert.equal(putIn(spot, 'fuel', thing('bat')), null);
  assert.ok(light(spot), `a ${kind} would not light`);
  return spot;
};
const KINDS = Object.entries(COOK_KINDS);
const real = (id: string) => Object.prototype.hasOwnProperty.call(ITEMS, id);
const grid = (size: unknown) => Array.isArray(size) && size.length === 2 && size.every((v) => Number.isInteger(v) && v > 0);

ok('every kind of spot is a whole row: a tier, somewhere to stand, a way to burn, and no more behind its door than it has', () => {
  assert.ok(KINDS.length >= 3);
  const props = new Set<string>();
  for (const [id, k] of KINDS) {
    assert.ok(k.label.length > 0, id);
    assert.ok([1, 2, 3].includes(k.tier), `${id}: tier ${k.tier}`);
    assert.ok(k.reach > 0 && k.reach < 5 && k.lighting >= 0 && k.lighting < 30, id);
    assert.ok(k.fuel === null || grid(k.fuel), `${id}: its fuel slots`);
    assert.ok(k.food === null || grid(k.food), `${id}: its food slots`);
    assert.ok(k.free >= 0 && (k.free > 0 || k.fuel), `${id} has nothing to burn and nowhere to put anything`);
    assert.ok(k.lasts > 0 && k.speed > 0, id);
    assert.ok(k.needs === null || real(k.needs) || TO_COME.includes(k.needs), `${id} wants ${k.needs}, which is nothing`);
    if (k.door) {
      assert.ok(k.door.seconds > 0 && k.door.seconds <= 3, `${id}: its door takes ${k.door.seconds} s`);
      for (const part of k.door.shuts) assert.ok(k[part], `${id}: its door shuts ${part} slots it has not got`);
    }
    if (k.warm) assert.ok(k.warm.within > 0 && k.warm.heal >= 0 && k.warm.meal >= 1, id);
    if (k.noise) assert.ok(k.noise.heard > 0 && k.noise.every > 0, id);
    for (const p of k.props) {
      assert.ok(!props.has(p), `${p} is two kinds of spot`);
      props.add(p);
      assert.equal(spotKind(p), id);
    }
    // (made, it is shut, cold and empty, and goes to JSON and back as it is)
    const spot = newSpot(id);
    assert.deepEqual(spot, { kind: id, door: 0, to: 0, burn: 0, fuel: [], food: [], gear: null });
    assert.deepEqual(readSpot(JSON.parse(JSON.stringify(spot))), spot);
    assert.equal(isLit(spot), false);
  }
  // the three that were asked for: the ring of stones at tier 1, the stove above it with a door, and a fire that wants a pot
  const { campfire, stove, potfire } = COOK_KINDS;
  assert.equal(campfire.tier, 1);
  assert.ok(stove.tier > campfire.tier && stove.door && stove.fuel && stove.food);
  assert.ok(potfire.needs && TO_COME.includes(potfire.needs) && potfire.props.length === 0, 'the fire with a pot is not in the world yet');
  // a higher tier is never the worse for it: it cooks no slower, its fuel goes no less far, and it has no less room
  const cells = (g: [number, number] | null) => (g ? g[0] * g[1] : 0);
  for (const [a, x] of KINDS) for (const [b, y] of KINDS) {
    if (x.tier >= y.tier) continue;
    assert.ok(y.speed >= x.speed && y.lasts >= x.lasts && cells(y.food) >= cells(x.food) && cells(y.fuel) >= cells(x.fuel), `${b} is a higher tier than ${a} and the worse for it`);
  }
  assert.ok(stove.speed > campfire.speed && stove.lasts > campfire.lasts);
  assert.throws(() => newSpot('bonfire'));
  assert.equal(spotKind('electric_stove'), null, 'the cooker in the kitchens is furniture');
  assert.deepEqual(cookSpots([{ kind: 'pine' }, { kind: 'stove', x: 1 }, { kind: 'stone_fire_pit' }, { kind: 'stove', x: 2 }]).map((s) => s.kind), ['stove', 'campfire', 'stove']);
});

ok("today's campfire is the `campfire` row, figure for figure, and burns as a ring of stones kept by fires.ts burns", () => {
  const k = COOK_KINDS.campfire;
  assert.deepEqual(k.props, [FIRE.kind]);
  assert.equal(k.reach, FIRE.reach);
  assert.equal(k.lighting, FIRE.lighting);
  assert.equal(k.free, FIRE.burns);
  assert.deepEqual(k.warm, { within: FIRE.warm, heal: FIRE.heal, meal: FIRE.meal });
  assert.deepEqual(k.noise, { heard: FIRE.heard, every: FIRE.crackle });
  assert.equal(HEAT.meal, FIRE.meal, 'a hot meal and a meal by the fire are one bonus');
  // and nothing is asked of it that is not asked today: no fuel, no door, nothing to light it with, nothing stood on it
  assert.ok(k.fuel === null && k.door === null && !k.igniter && k.needs === null && k.lasts === 1 && k.speed === 1);
  // side by side with the keeper the server has now
  const place = { x: 40, z: -12 };
  const hearths = new Hearths([place]), spots = new CookSpots([{ kind: 'campfire', ...place }]);
  assert.equal(hearths.light(0, place.x + FIRE.reach + 1, place.z, 0), false);
  assert.equal(spots.at(0, place.x + FIRE.reach + 1, place.z), null, 'worked from out of reach');
  assert.equal(hearths.light(0, place.x + FIRE.reach + 2, place.z, 0, 2.5), true, 'the grace the server gives');
  const spot = spots.at(0, place.x + FIRE.reach + 2, place.z, 2.5)!;
  assert.ok(spot && light(spot));
  assert.equal(spots.at(0, place.x + FIRE.reach + 3, place.z, 2.5), null);
  assert.equal(spots.at(1, place.x, place.z), null, 'a spot there is not');
  assert.equal(spots.at(0.5, place.x, place.z), null);
  let t = 0;
  for (const dt of [1, 149, 149, 0.5]) {
    spots.tick(dt, T0 + (t += dt));
    assert.equal(fuelLeft(spot), hearths.left(0, t), `after ${t} s`);
    assert.equal(light(spot), hearths.light(0, place.x, place.z, t), 'lit twice over');
    assert.deepEqual(warmthOf(spot), k.warm);
  }
  spots.tick(1.5, T0 + (t += 1.5));
  assert.equal(hearths.left(0, t), 0);
  assert.equal(isLit(spot), false);
  assert.equal(warmthOf(spot), null, 'ash warms nobody');
  assert.equal(light(spot), hearths.light(0, place.x, place.z, t), 'and it is lit again when it is out');
  assert.equal(fuelLeft(spot), FIRE.burns);
});

ok('the door: shut, opening, open, shutting, in the seconds its kind says, and turned back from wherever it is', () => {
  const stove = newSpot('stove'), secs = COOK_KINDS.stove.door!.seconds;
  assert.equal(doorState(stove), 'shut');
  assert.equal(swingDoor(stove, false), false, 'shut a shut door');
  assert.ok(swingDoor(stove, true));
  assert.equal(doorState(stove), 'opening');
  assert.equal(swingDoor(stove, true), false, 'it is on its way already');
  assert.equal(pass(stove, secs / 2).door, false);
  assert.ok(Math.abs(stove.door - 0.5) < 1e-9 && doorState(stove) === 'opening');
  assert.equal(pass(stove, secs / 2).door, true, 'whoever keeps it is told when it comes to rest');
  assert.equal(doorState(stove), 'open');
  assert.equal(stove.door, 1);
  assert.equal(pass(stove, 5).door, false, 'a door at rest is not news');
  // pushed to, and caught before it is home: it goes back from where it was, in the time that takes
  assert.ok(swingDoor(stove, false));
  assert.equal(doorState(stove), 'shutting');
  pass(stove, 0.2);
  assert.ok(stove.door > 0.7 && stove.door < 0.72 && doorState(stove) === 'shutting');
  assert.ok(swingDoor(stove, true));
  pass(stove, 0.19);
  assert.equal(doorState(stove), 'opening');
  pass(stove, 0.02);
  assert.equal(doorState(stove), 'open');
  swingDoor(stove, false);
  assert.equal(pass(stove, secs).door, true);
  assert.equal(doorState(stove), 'shut');
  assert.equal(stove.door, 0);
  // however the time is cut up, it takes the same: seven tenths in tenths, and in sixtieths
  for (const step of [0.1, 1 / 60]) {
    const again = newSpot('stove');
    swingDoor(again, true);
    let t = 0;
    while (doorState(again) !== 'open' && t < 5) pass(again, step), (t += step);
    assert.ok(Math.abs(t - secs) < step, `open in ${t.toFixed(3)} s by steps of ${step.toFixed(3)}`);
  }
  // a thing with no door has none to swing
  const fire = newSpot('campfire');
  assert.equal(doorState(fire), 'none');
  assert.equal(swingDoor(fire, true), false);
  assert.deepEqual([fire.door, fire.to], [0, 0]);
});

ok('nobody reaches inside but through a door that stands open; the fire and the cooking take no notice of the door', () => {
  const stove = newSpot('stove'), bat = thing('bat'), beans = thing('beans');
  const both = (want: boolean, when: string) => (['fuel', 'food'] as Part[]).forEach((part) => assert.equal(mayReach(stove, part), want, `${part}, ${when}`));
  both(false, 'shut');
  assert.equal(putIn(stove, 'fuel', bat), bat, 'fuel went in through a shut door');
  assert.equal(putIn(stove, 'food', beans), beans);
  assert.equal(setGrid(stove, 'food', [{ item: beans, x: 0, y: 0, rot: false }]), null);
  assert.equal(stove.food.length + stove.fuel.length, 0);
  swingDoor(stove, true);
  both(false, 'opening');
  pass(stove, 0.35);
  both(false, 'half open');
  pass(stove, 0.35);
  both(true, 'open');
  assert.equal(putIn(stove, 'fuel', bat), null);
  assert.equal(putIn(stove, 'food', beans), null);
  // the moment it is pushed to, it is a door that is looked at
  swingDoor(stove, false);
  both(false, 'the moment it is pushed to');
  assert.equal(takeOut(stove, 'food', beans.uid), null);
  assert.equal(takeOut(stove, 'fuel', bat.uid), null);
  pass(stove, 1);
  both(false, 'shut again');
  // "door does not have to be open or closed to use the fire/cooking stove": it is lit shut, and cooks shut
  assert.equal(noLighting(stove), null);
  assert.ok(light(stove));
  const h = pass(stove, COOKS.beans.takes / COOK_KINDS.stove.speed);
  assert.deepEqual(h.done, [beans]);
  assert.equal(stageOf(beans), 'done');
  // and what is done is got out by opening it
  swingDoor(stove, true);
  pass(stove, 0.7);
  assert.equal(takeOut(stove, 'food', beans.uid), beans);
  assert.equal(takeOut(stove, 'food', beans.uid), null, 'taken twice');
  // a ring of stones has nothing between a hand and it, and no fuel slots to reach into
  const fire = newSpot('campfire');
  assert.equal(mayReach(fire, 'food'), true);
  assert.equal(mayReach(fire, 'fuel'), false);
  assert.equal(putIn(fire, 'fuel', bat), bat);
  assert.equal(gridOf(fire, 'fuel'), null);
});

ok('what counts as fuel is real, and so is what cooks: every row an item (or one that is to come), and each fits where it goes', () => {
  for (const [id, secs] of Object.entries(FUEL)) {
    assert.ok(real(id) || TO_COME.includes(id), `${id} burns and is no item`);
    assert.ok(secs > 0 && secs <= 600, `${id} burns ${secs} s`);
    assert.equal(fuelOf(id), secs);
    assert.ok(!COOKS[id], `${id} is fuel and food both`);
  }
  for (const id of IGNITERS) assert.ok(real(id) || TO_COME.includes(id), id);
  assert.ok(FUEL.firewood > 0 && TO_COME.includes('firewood'), 'the row for wood');
  assert.equal(FUEL.firewood, FIRE.burns, 'a log is one of the fires there have always been');
  const today = Object.keys(FUEL).filter(real);
  assert.ok(today.length >= 3, `only ${today.length} things burn today`);
  for (const id of today) {
    assert.ok(isFuel(thing(id)));
    for (const [kind, k] of KINDS) if (k.fuel) assert.ok(gridOf(newSpot(kind), 'fuel')!.findSpace(thing(id)), `a ${ITEMS[id].name} does not go in a ${kind}`);
  }
  // nothing that is steel, or a gun, or kept for a wound that a fire has no business with
  for (const id of ['boonie_hat', 'jerrycan', 'mosin', 'firstaid', 'dogtag', 'constructor', 'toString', '']) assert.equal(fuelOf(id), 0, id);
  assert.equal(isFuel({ ...thing('bat'), cargo: [{ item: thing('apple'), x: 0, y: 0, rot: false }] }), false, 'a thing with things in it is not thrown on');

  assert.ok(Object.keys(COOKS).length >= 5);
  for (const [id, r] of Object.entries(COOKS)) {
    const def = ITEMS[id];
    assert.ok(real(id), `${id} cooks and is no item`);
    assert.ok((def.use?.energy ?? 0) > 0 || (def.use?.water ?? 0) > 0, `${id} is put on the heat and is nothing to eat`);
    // (a pile is merged by what it is and nothing else: a cooked one must never be laid on a raw one)
    assert.ok(!def.stack, `${id} is kept in piles: a cooked one would be lost among the raw`);
    assert.ok(r.takes > 0 && r.burns > 0, id);
    assert.ok(r.takes + r.burns < COOK_KINDS.campfire.free, `${id} cannot be burned on one lighting of the fire`);
    // (cooked or burned it gives, if little; raw it may take, as raw meat does: never more than cooked gives)
    for (const w of [r.done, r.burned]) if (w) assert.ok(w.energy >= 0 && w.water >= 0, id);
    if (r.raw) assert.ok(r.raw.energy <= (r.done?.energy ?? 1), `${id} is better raw`);
    assert.ok(r.burned.energy < (r.done?.energy ?? 1), `${id} is no worse burned`);
    assert.ok(cookable(thing(id)));
    for (const [kind, k] of KINDS) if (k.food) assert.ok(gridOf(newSpot(kind), 'food')!.findSpace(thing(id)), `${def.name} does not go on a ${kind}`);
  }
  // every tin there is can be warmed, and the fruit baked
  for (const def of Object.values(ITEMS)) if (def.category === 'food') assert.ok(COOKS[def.id], `${def.name} is food and cannot be put on the heat`);
  for (const id of ['constructor', '__proto__', 'mosin', 'bandage']) assert.equal(cookable({ uid: 'x', id, qty: 1 }), false, id);
});

ok('fuel burns down at the rate that is said, the smallest first and one of a pile at a time, and then it is out', () => {
  // a ring of stones: its five minutes, and no more
  const fire = newSpot('campfire');
  assert.equal(fuelLeft(fire), 0);
  assert.ok(light(fire));
  assert.equal(noLighting(fire), 'It is burning already');
  assert.equal(pass(fire, 299).out, false);
  assert.ok(isLit(fire) && fuelLeft(fire) === 1);
  assert.equal(pass(fire, 2).out, true);
  assert.ok(!isLit(fire) && fuelLeft(fire) === 0);
  assert.equal(pass(fire, 50).out, false, 'out is said once');

  // a fire that burns only what it is given (the row that is to come): nothing in it, nothing lit
  const pot = newSpot('potfire');
  assert.equal(noLighting(pot), 'There is nothing in it to burn');
  assert.equal(light(pot), false);
  for (const it of [thing('bat'), thing('bandage', 3), thing('cigarettes', 2)]) assert.equal(putIn(pot, 'fuel', it), null);
  const all = FUEL.bat + 3 * FUEL.bandage + 2 * FUEL.cigarettes;
  assert.equal(fuelLeft(pot), all);
  assert.ok(light(pot));
  assert.equal(fuelLeft(pot), all, 'lighting it burned something');
  const fuel = gridOf(pot, 'fuel')!;
  assert.equal(pot.burn, FUEL.cigarettes, 'the smallest thing catches first');
  assert.deepEqual([fuel.count('cigarettes'), fuel.count('bandage'), fuel.count('bat')], [1, 3, 1]);
  // a second after the cigarettes are gone, one dressing of the three has caught
  const h = pass(pot, 2 * FUEL.cigarettes + 1);
  assert.ok(h.fed && !h.out);
  assert.deepEqual([fuel.count('cigarettes'), fuel.count('bandage'), fuel.count('bat')], [0, 2, 1]);
  assert.equal(fuelLeft(pot), all - 2 * FUEL.cigarettes - 1);
  assert.equal(pot.burn, FUEL.bandage - 1);
  // put out, it keeps what had not caught, and is lit again on that
  putOut(pot);
  assert.equal(isLit(pot), false);
  assert.equal(fuelLeft(pot), 2 * FUEL.bandage + FUEL.bat);
  assert.ok(light(pot));
  assert.equal(pass(pot, 2 * FUEL.bandage + FUEL.bat - 0.5).out, false);
  assert.equal(pot.fuel.length, 0);
  assert.equal(pass(pot, 1).out, true);
  assert.equal(noLighting(pot), 'There is nothing in it to burn', 'burned out, it wants more put in it');

  // the stove: it lights on nothing for now ("make it just work"), and what is put in it keeps it going, half as long again
  const stove = opened('stove'), k = COOK_KINDS.stove;
  assert.ok(k.free > 0, 'the stove needs wood, and there is no wood');
  assert.equal(noLighting(stove), null);
  assert.equal(putIn(stove, 'fuel', thing('bat')), null);
  assert.ok(light(stove));
  assert.equal(stove.burn, k.free);
  assert.deepEqual(stove.fuel.map((p) => p.item.id), ['bat'], 'it burns on nothing first');
  assert.equal(fuelLeft(stove), k.free + FUEL.bat * k.lasts);
  assert.ok(FUEL.bat * k.lasts > FUEL.bat * COOK_KINDS.campfire.lasts);
  const fed = pass(stove, k.free + 0.5);
  assert.ok(fed.fed && !fed.out && stove.fuel.length === 0);
  assert.equal(fuelLeft(stove), FUEL.bat * k.lasts - 0.5);
  // fed while it burns, it burns the longer
  assert.equal(putIn(stove, 'fuel', thing('bandage', 2)), null);
  assert.equal(fuelLeft(stove), FUEL.bat * k.lasts - 0.5 + 2 * FUEL.bandage * k.lasts);
  assert.equal(pass(stove, FUEL.bat * k.lasts + 2 * FUEL.bandage * k.lasts - 1).out, false);
  assert.equal(pass(stove, 1).out, true);
  // what will not burn does not go in, and what burns does not go on the plate
  for (const id of ['mosin', 'beans', 'jerrycan', 'boonie_hat']) assert.ok(putIn(stove, 'fuel', thing(id)), `${id} went into the firebox`);
  assert.ok(putIn(stove, 'food', thing('bandage')));
  // a kind that wants a light is not lit without one
  COOK_KINDS.test_match = { ...COOK_KINDS.campfire, props: [], igniter: true };
  IGNITERS.push('cigarettes');
  try {
    const wants = newSpot('test_match');
    assert.equal(noLighting(wants), 'You have nothing to light it with');
    assert.equal(light(wants, () => false), false);
    assert.equal(light(wants, (id) => id === 'cigarettes'), true);
  } finally {
    delete COOK_KINDS.test_match;
    IGNITERS.pop();
  }
});

ok('nothing cooks on a spot that is not lit, however long it is left there', () => {
  for (const kind of ['campfire', 'stove']) {
    const spot = opened(kind), beans = thing('beans'), apple = thing('apple');
    assert.equal(putIn(spot, 'food', beans), null);
    assert.equal(putIn(spot, 'food', apple), null);
    const h = pass(spot, 3600);
    assert.deepEqual([h.done, h.burned], [[], []]);
    for (const it of [beans, apple]) {
      assert.equal(stageOf(it), 'raw');
      assert.equal(cookOf(it), undefined);
      assert.equal(isHot(it, now), false);
      assert.deepEqual(it, { uid: it.uid, id: it.id, qty: 1 }, 'a cold spot left its mark on a thing');
    }
    // and once it has burned out, what was on it gets no further
    light(spot);
    pass(spot, 5);
    putOut(spot);
    const at = cookOf(beans);
    pass(spot, 3600);
    assert.equal(cookOf(beans), at);
    assert.equal(stageOf(beans), 'raw');
  }
});

ok('a thing is done in the time its row says on a tier 1 spot, sooner on a higher tier, and not a second before', () => {
  for (const [id, r] of Object.entries(COOKS)) {
    const slow = alight('campfire'), it = thing(id);
    assert.equal(putIn(slow, 'food', it), null);
    assert.deepEqual(pass(slow, r.takes - 1).done, []);
    assert.equal(stageOf(it), 'raw', `${id} was done early`);
    assert.equal(isHot(it, now), false, 'half warmed is not hot');
    assert.ok(stateOf(it, now).share > 0.9 && stateOf(it, now).share < 1);
    assert.deepEqual(pass(slow, 1).done, [it], `${id} was not done in ${r.takes} s`);
    assert.equal(stageOf(it), 'done');
    assert.equal(isHot(it, now), true);
    // the stove, tier 3: the same thing in two thirds of the time, when the campfire's is not yet done
    const fast = alight('stove'), other = thing(id), speed = COOK_KINDS.stove.speed;
    assert.equal(putIn(fast, 'food', other), null);
    assert.ok(r.takes / speed < r.takes - 1);
    assert.deepEqual(pass(fast, r.takes / speed - 0.5).done, []);
    assert.deepEqual(pass(fast, 0.5).done, [other], `${id} on the stove`);
    assert.equal(stageOf(other), 'done');
  }
  // tier by tier, the same tin: each higher one has it done sooner
  const times = KINDS.filter(([, k]) => k.food).sort((a, b) => a[1].tier - b[1].tier).map(([, k]) => COOKS.beans.takes / k.speed);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] < times[i - 1], `tier by tier: ${times.join(', ')} s`);
});

ok('left on, it burns: after the time its row says, for good, and it is worth what a burned thing is worth', () => {
  const fire = alight('campfire'), beans = thing('beans'), apple = thing('apple'), r = COOKS.beans, a = COOKS.apple;
  putIn(fire, 'food', beans);
  putIn(fire, 'food', apple);
  pass(fire, a.takes + a.burns - 1);
  assert.equal(stageOf(apple), 'done');
  assert.deepEqual(pass(fire, 1).burned, [apple]);
  assert.equal(stageOf(apple), 'burned');
  pass(fire, r.takes + r.burns - (a.takes + a.burns) - 1);
  assert.equal(stageOf(beans), 'done');
  const h = pass(fire, 1);
  assert.deepEqual([h.done, h.burned], [[], [beans]]);
  assert.equal(stageOf(beans), 'burned');
  assert.equal(isHot(beans, now), false, 'burned is not called hot');
  assert.equal(hotOf(beans), undefined);
  assert.equal(stateOf(beans, now).word, 'burned');
  const u = ITEMS.beans.use!;
  assert.deepEqual(mealOf(beans, now), { energy: Math.round(u.energy! * r.burned.energy), water: 0, health: 0, hot: false });
  assert.ok(mealOf(beans, now).energy < u.energy!);
  assert.deepEqual(mealOf(apple, now), { energy: Math.round(ITEMS.apple.use!.energy! * a.burned.energy), water: 0, health: 0, hot: false });
  // it gets no worse, and no better: not by more heat, not cold, not on another fire a day later
  pass(fire, 60);
  assert.equal(cookOf(beans), r.takes + r.burns, 'it is counted no further than burned');
  assert.equal(takeOut(fire, 'food', beans.uid), beans);
  now += 86400;
  const other = alight('campfire');
  putIn(other, 'food', beans);
  assert.deepEqual(pass(other, 200).done, []);
  assert.equal(stageOf(beans), 'burned');
  // from raw to burned in one long look away is one piece of news, not two
  const third = alight('campfire'), tin = thing('sardines');
  putIn(third, 'food', tin);
  const long = pass(third, 290);
  assert.deepEqual([long.done, long.burned], [[], [tin]]);
});

ok('a tin is warmed, not cooked: hot for five minutes wherever it is taken, then the tin it was; an apple stays baked', () => {
  const fire = alight('campfire'), beans = thing('beans'), sprats = thing('sprats'), apple = thing('apple');
  for (const it of [beans, sprats, apple]) assert.equal(putIn(fire, 'food', it), null);
  pass(fire, COOKS.beans.takes);
  for (const it of [beans, sprats, apple]) assert.equal(takeOut(fire, 'food', it.uid), it);
  const off = now, u = ITEMS.beans.use!, s = ITEMS.sprats.use!, a = ITEMS.apple.use!;
  // hot: what a meal by the fire has always been worth, with no fire in sight
  assert.deepEqual(mealOf(beans, off), { energy: Math.round(u.energy! * FIRE.meal), water: Math.round(u.water! * FIRE.meal), health: 0, hot: true });
  assert.equal(stateOf(beans, off).word, 'hot');
  // (salt fish takes water from whoever eats it, hot or cold: only what a thing GIVES is made more of)
  assert.ok(s.water! < 0);
  assert.deepEqual(mealOf(sprats, off), { energy: Math.round(s.energy! * FIRE.meal), water: s.water, health: 0, hot: true });
  // by a fire as well, it is not hot twice over
  assert.deepEqual(mealOf(beans, off, FIRE.meal), mealOf(beans, off));
  assert.equal(isHot(beans, off + HEAT.keeps - 1), true);
  assert.equal(isHot(beans, off + HEAT.keeps + 1), false);
  // cold: exactly the tin it was, and by a fire exactly what it has always been there
  const cold = off + HEAT.keeps + 1;
  assert.deepEqual(mealOf(beans, cold), { energy: u.energy, water: u.water, health: 0, hot: false });
  assert.equal(stateOf(beans, cold).word, '');
  assert.deepEqual(mealOf(beans, cold, FIRE.meal), { energy: Math.round(u.energy! * FIRE.meal), water: Math.round(u.water! * FIRE.meal), health: 0, hot: false });
  // the apple is baked, and is so hot or cold: more to eat, less to drink
  const d = COOKS.apple.done!;
  assert.equal(stageOf(apple), 'done');
  assert.deepEqual(mealOf(apple, off), { energy: Math.round(a.energy! * d.energy * FIRE.meal), water: Math.round(a.water! * d.water * FIRE.meal), health: 0, hot: true });
  assert.deepEqual(mealOf(apple, cold), { energy: Math.round(a.energy! * d.energy), water: Math.round(a.water! * d.water), health: 0, hot: false });
  assert.ok(mealOf(apple, cold).energy > a.energy! && mealOf(apple, cold).water < a.water!);
  assert.deepEqual([stateOf(apple, off).word, stateOf(apple, cold).word], ['cooked, hot', 'cooked']);

  // put back while it is still hot, a tin goes on from where it was: so near burning, it burns
  now = off + 60;
  const second = alight('campfire');
  putIn(second, 'food', beans);
  pass(second, COOKS.beans.burns - 1);
  assert.equal(stageOf(beans), 'done');
  pass(second, 1);
  assert.equal(stageOf(beans), 'burned');
  // Put back cold, a tin is a cold tin: all its time over again. The apple is baked still, hot again as soon as it
  // is on the heat, and goes on from where it was toward burned: what is cooked is not made raw by going cold.
  now = cold;
  const third = alight('campfire'), baked = cookOf(apple)!;
  putIn(third, 'food', sprats);
  putIn(third, 'food', apple);
  assert.deepEqual(pass(third, 1).done, []);
  assert.equal(stageOf(apple), 'done', 'a baked apple was raw again');
  assert.equal(isHot(apple, now), true);
  assert.equal(cookOf(apple), baked + 1);
  assert.equal(takeOut(third, 'food', apple.uid), apple);
  assert.deepEqual(pass(third, COOKS.sprats.takes - 2).done, []);
  assert.equal(stageOf(sprats), 'raw', 'a cold tin was hot again at once');
  assert.deepEqual(pass(third, 1).done, [sprats]);
  assert.equal(isHot(sprats, now), true);
  // (were a thing that is only warmed ever given a worth of its own hot, it would have it hot and not a second longer)
  COOKS.milk = { how: 'warm', takes: 10, burns: 60, done: { energy: 2, water: 1 }, burned: { energy: 0, water: 0 } };
  try {
    const milk = thing('milk'), m = ITEMS.milk.use!;
    putIn(third, 'food', milk);
    pass(third, 10);
    assert.deepEqual([mealOf(milk, now).energy, stateOf(milk, now).stage, stateOf(milk, now).word], [Math.round(m.energy! * 2 * FIRE.meal), 'done', 'hot']);
    assert.deepEqual([mealOf(milk, now + HEAT.keeps + 1).energy, stateOf(milk, now + HEAT.keeps + 1).stage, stateOf(milk, now + HEAT.keeps + 1).share], [m.energy, 'raw', 0]);
    takeOut(third, 'food', milk.uid);
  } finally {
    delete COOKS.milk;
  }
  // a tin said to be half warmed that no fire of ours ever marked has not been warmed at all
  const forged = Object.assign(thing('beans'), { cook: COOKS.beans.takes - 1 });
  putIn(third, 'food', forged);
  pass(third, 2);
  assert.equal(stageOf(forged), 'raw');
});

ok('whatever is eaten that was never cooked gives exactly what it gives today, by a fire and away from one', () => {
  // (the rule as src/game/game.ts has it: what a thing gives is multiplied by a fire, what it takes is not)
  const today = (v: number | undefined, by: number) => (!v ? 0 : v > 0 ? Math.round(v * by) : v);
  let eaten = 0;
  for (const def of Object.values(ITEMS)) {
    const u = def.use;
    // (meat is the one thing worth less raw than its item says, on purpose: a quarter, and it may poison you)
    if (!u || COOKS[def.id]?.raw) continue;
    eaten++;
    const it = thing(def.id);
    assert.deepEqual(mealOf(it, T0), { energy: u.energy ?? 0, water: u.water ?? 0, health: u.health ?? 0, hot: false }, def.id);
    assert.deepEqual(mealOf(it, T0, FIRE.meal), { energy: today(u.energy, FIRE.meal), water: today(u.water, FIRE.meal), health: u.health ?? 0, hot: false }, `${def.id} by a fire`);
    assert.deepEqual(mealOf(it, T0, NaN), mealOf(it, T0));
    assert.deepEqual(mealOf(it, T0, 0.2), mealOf(it, T0), 'a fire made a meal worse');
  }
  assert.ok(eaten > 10);
  assert.deepEqual(mealOf({ uid: 'x', id: 'nothing', qty: 1 }, T0), { energy: 0, water: 0, health: 0, hot: false });
  // what is not food carries nothing of cooking, whatever was said of it
  assert.deepEqual(keepCooked(thing('mosin'), { cook: 40, hot: T0 + 100 }), { ...thing('mosin'), uid: `mosin-${made - 1}` });
  const kept = keepCooked({ uid: 'k', id: 'beans', qty: 1 }, { cook: 1e9, hot: 1e12 }, T0);
  assert.deepEqual(kept, { uid: 'k', id: 'beans', qty: 1, cook: COOKS.beans.takes + COOKS.beans.burns }, 'burned, and not hot');
  assert.deepEqual(keepCooked({ uid: 'k', id: 'beans', qty: 1 }, { cook: 50, hot: 1e12 }, T0), { uid: 'k', id: 'beans', qty: 1, cook: 50, hot: T0 + HEAT.keeps }, 'hot for a year is hot for five minutes');
  assert.deepEqual(keepCooked({ uid: 'k', id: 'beans', qty: 1 }, { cook: 50, hot: T0 + 10 }, T0), { uid: 'k', id: 'beans', qty: 1, cook: 50, hot: T0 + 10 });
  for (const junk of [null, undefined, 4, 'hot', [], { cook: 'x', hot: {} }, { cook: -3 }, { hot: T0 }, { cook: NaN, hot: Infinity }]) assert.deepEqual(keepCooked({ uid: 'k', id: 'beans', qty: 1 }, junk), { uid: 'k', id: 'beans', qty: 1 });
});

ok('a kind that wants a pot cooks nothing until the pot is stood on it, and nothing once it is lifted off', () => {
  const spot = newSpot('potfire'), pot: ItemInstance = { uid: 'pot-1', id: 'cooking_pot', qty: 1 }, beans = thing('beans'), speed = COOK_KINDS.potfire.speed;
  assert.equal(putIn(spot, 'fuel', thing('bat')), null);
  assert.equal(putIn(spot, 'food', beans), null);
  assert.ok(light(spot));
  assert.equal(cooks(spot), false);
  pass(spot, 60);
  assert.equal(cookOf(beans), undefined, 'it cooked with no pot');
  assert.equal(fit(spot, thing('thermos')), false, 'a flask is no pot');
  assert.equal(fit(spot, pot), true);
  assert.equal(fit(spot, { ...pot, uid: 'pot-2' }), false, 'two pots on one fire');
  assert.equal(cooks(spot), true);
  assert.deepEqual(pass(spot, COOKS.beans.takes / speed).done, [beans]);
  assert.equal(unfit(spot), pot);
  assert.equal(unfit(spot), null);
  const at = cookOf(beans);
  pass(spot, 30);
  assert.equal(cookOf(beans), at);
  // the others want nothing stood on them, and take nothing
  for (const kind of ['campfire', 'stove']) {
    assert.equal(cooks(newSpot(kind)), true);
    assert.equal(fit(newSpot(kind), pot), false);
  }
});

ok('its insides are ordinary grids: the inventory screen and the server move things in them as in any crate', () => {
  const stove = opened('stove'), fuel = gridOf(stove, 'fuel', 'cook:7:fuel')!, food = gridOf(stove, 'food')!;
  assert.ok(fuel instanceof Container && food instanceof Container);
  assert.deepEqual([fuel.id, fuel.w, fuel.h, food.id, food.w, food.h], ['cook:7:fuel', ...COOK_KINDS.stove.fuel!, 'food', ...COOK_KINDS.stove.food!]);
  // a live view: what is put into the grid is in the spot, and what the spot burns is gone from the grid
  const bat = thing('bat'), beans = thing('beans'), rifle = thing('mosin');
  assert.equal(fuel.add(bat), null);
  assert.equal(stove.fuel[0].item, bat);
  assert.equal(stove.fuel[0].rot, true, 'a bat goes in on its side');
  assert.ok(food.place(beans, 2, 1, false));
  assert.deepEqual(stove.food, [{ item: beans, x: 2, y: 1, rot: false }]);
  // each takes only what belongs in it, however it is asked
  assert.equal(fuel.accepts(rifle), false);
  assert.equal(fuel.fits(beans, 0, 1, false), false);
  assert.equal(fuel.add(rifle), rifle);
  assert.equal(fuel.hasRoom(thing('bandage')), true);
  assert.equal(food.accepts(thing('bandage')), false);
  assert.equal(food.findSpace(rifle), null);
  assert.equal(food.place(thing('bat'), 0, 0, true), false);
  // it is sent and filled as any grid is, and filled from what somebody sent it is still held to what it takes
  const sent = fuel.serialize().items;
  assert.deepEqual(sent, [{ ...bat, x: 0, y: 0, rot: true }]);
  const back = fuel.load({ items: [...sent, { ...rifle, x: 0, y: 1, rot: false }, { ...thing('bandage', 2), x: 5, y: 2, rot: false }] });
  assert.deepEqual(back.map((it) => it.id), ['mosin']);
  assert.deepEqual(stove.fuel.map((p) => [p.item.id, p.x, p.y]), [['bat', 0, 0], ['bandage', 5, 2]]);

  // What a player's game says is on the plate now (the server's cset). The tin that was cooking keeps the cooking
  // the SPOT has for it, whatever their game said; what does not belong is handed back.
  assert.ok(light(stove));
  pass(stove, 20);
  const had = cookOf(beans)!, hot = hotOf(beans)!;
  assert.equal(had, 20 * COOK_KINDS.stove.speed);
  const apple = Object.assign(thing('apple'), { cook: COOKS.apple.takes, hot: now + 100 });
  const said = [{ ...beans, cook: 9999, hot: 1e12, x: 0, y: 0, rot: false }, { ...apple, x: 1, y: 0, rot: false }, { ...rifle, x: 2, y: 0, rot: false }, { ...thing('sardines'), x: 0, y: 0, rot: false }];
  const spilled = setGrid(stove, 'food', said, now)!;
  assert.deepEqual(spilled.map((it) => it.id), ['mosin']);
  assert.deepEqual(stove.food.map((p) => [p.item.id, p.x, p.y]), [['beans', 0, 0], ['apple', 1, 0], ['sardines', 2, 0]], 'the tin laid on another was not found a place of its own');
  assert.deepEqual([cookOf(stove.food[0].item), hotOf(stove.food[0].item)], [had, hot], 'a game said how cooked its tin was, and was believed');
  assert.deepEqual([cookOf(stove.food[1].item), hotOf(stove.food[1].item)], [COOKS.apple.takes, now + 100], 'what is new to it brings what it carries');
  // the same written the way this file keeps a grid
  assert.deepEqual(setGrid(stove, 'food', JSON.parse(JSON.stringify(stove.food)), now), []);
  assert.equal(stove.food.length, 3);
  // an emptied grid is empty; a list that is no list empties it too, and never throws
  assert.deepEqual(setGrid(stove, 'food', []), []);
  assert.equal(stove.food.length, 0);
  for (const junk of [null, 'x', 7, {}, [null, 3, 'a', {}, { item: 5 }]]) assert.deepEqual(setGrid(stove, 'fuel', junk), []);
  assert.equal(stove.fuel.length, 0);
  // more than there is room for comes back, and none of it is lost or made twice
  const tins = Array.from({ length: 20 }, () => thing('beans'));
  const over = setGrid(stove, 'food', tins.map((item) => ({ item, x: 0, y: 0, rot: false })))!;
  assert.equal(stove.food.length, 6);
  assert.equal(over.length, 14);
  assert.equal(new Set([...stove.food.map((p) => p.item.uid), ...over.map((it) => it.uid)]).size, 20);
});

ok('a spot goes to JSON and back unchanged, and goes on from there exactly as the one it was written from', () => {
  // a busy stove: its door on the way open, alight, wood waiting, one tin nearly hot and an apple nearly burned
  const stove = opened('stove');
  putIn(stove, 'fuel', thing('bat'));
  putIn(stove, 'fuel', thing('bandage', 4));
  putIn(stove, 'fuel', thing('garden_gloves'));
  const apple = thing('apple');
  putIn(stove, 'food', apple);
  light(stove);
  pass(stove, 301);
  putIn(stove, 'food', thing('beans'));
  putIn(stove, 'food', thing('sardines'));
  pass(stove, 12.3);
  swingDoor(stove, false);
  pass(stove, 0.2);
  assert.equal(doorState(stove), 'shutting');
  assert.ok(isLit(stove) && stove.fuel.length >= 2 && stove.food.length === 3);
  assert.equal(stageOf(apple), 'burned');
  const text = JSON.stringify(stove);
  assert.deepEqual(JSON.parse(text), stove, 'it is plain data');
  const copy = readSpot(JSON.parse(text));
  assert.deepEqual(copy, stove);
  assert.deepEqual(readSpot(JSON.parse(text), { kind: 'stove', now }), stove);
  assert.equal(JSON.stringify(copy), text);
  // and both go on alike: the same news, the same state, a second at a time until both are out
  let t = now, steps = 0;
  while ((isLit(stove) || isLit(copy)) && steps++ < 2000) {
    t += 1;
    assert.deepEqual(tick(copy, 1, t), tick(stove, 1, t));
  }
  assert.deepEqual(copy, stove);
  assert.ok(!isLit(stove) && steps > 300);
  // every kind, in every state a few minutes of use leaves it in
  for (const [kind, k] of KINDS) {
    const spot = opened(kind);
    if (k.fuel) putIn(spot, 'fuel', thing('bandage', 3));
    if (k.food) putIn(spot, 'food', thing('tomatoes'));
    light(spot);
    for (const dt of [0.4, 7, 33.3, 90]) {
      pass(spot, dt);
      assert.deepEqual(readSpot(JSON.parse(JSON.stringify(spot))), spot, `${kind} after ${dt} s`);
    }
  }
  // (the pot is not an item yet, so one written down is not read back: the day it is one, it will be)
  const pot = newSpot('potfire');
  fit(pot, { uid: 'pot', id: 'cooking_pot', qty: 1 });
  assert.equal(readSpot(JSON.parse(JSON.stringify(pot))).gear, null);
});

ok('rubbish read as a spot never throws, and what comes back is always a spot that could be', () => {
  /** everything that has to be true of any spot */
  const sound = (spot: CookSpot, why: string) => {
    const k = COOK_KINDS[spot.kind];
    assert.ok(k && Object.prototype.hasOwnProperty.call(COOK_KINDS, spot.kind), `${why}: a kind there is not`);
    assert.ok(spot.door >= 0 && spot.door <= 1 && (spot.to === 0 || spot.to === 1), `${why}: its door`);
    if (!k.door) assert.deepEqual([spot.door, spot.to], [0, 0], `${why}: a door on a thing with none`);
    assert.ok(Number.isFinite(spot.burn) && spot.burn >= 0 && spot.burn <= 450, `${why}: alight for ${spot.burn}`);
    const uids = new Set<string>();
    for (const part of ['fuel', 'food'] as Part[]) {
      assert.ok(Array.isArray(spot[part]), why);
      if (!k[part]) assert.equal(spot[part].length, 0, `${why}: things in ${part} slots it has not got`);
      const again = new Container('check', 'check', k[part]?.[0] ?? 0, k[part]?.[1] ?? 0);
      for (const p of spot[part]) {
        const def = ITEMS[p.item.id];
        assert.ok(real(p.item.id) && typeof p.item.uid === 'string' && p.item.uid.length > 0 && p.item.uid.length <= 64, why);
        assert.ok(!uids.has(p.item.uid), `${why}: one thing twice`);
        uids.add(p.item.uid);
        assert.ok(part === 'fuel' ? isFuel(p.item) : cookable(p.item), `${why}: ${p.item.id} in the ${part} slots`);
        assert.ok(Number.isInteger(p.item.qty) && p.item.qty >= 1 && p.item.qty <= (def.stack ?? 1), `${why}: ${p.item.qty} of ${p.item.id}`);
        assert.ok(again.place(p.item, p.x, p.y, p.rot), `${why}: ${p.item.id} lies outside its grid, or on another`);
        const c = cookOf(p.item), h = hotOf(p.item);
        if (c !== undefined) assert.ok(c > 0 && c <= COOKS[p.item.id].takes + COOKS[p.item.id].burns, `${why}: cooked for ${c}`);
        if (h !== undefined) assert.ok(Number.isFinite(h) && c !== undefined && stageOf(p.item) !== 'burned', `${why}: hot`);
      }
    }
    assert.ok(spot.gear === null || spot.gear.id === k.needs, why);
    // and it can be used: time passes at it, and it is written down again as it is
    tick(spot, 1, T0);
    assert.deepEqual(readSpot(JSON.parse(JSON.stringify(spot))), spot, why);
  };
  const bat = { item: { uid: 'b1', id: 'bat', qty: 1 }, x: 0, y: 0, rot: true };
  const rubbish: unknown[] = [
    undefined, null, 0, 42, NaN, 'stove', true, [], [1, 2, 3], {}, () => 1,
    { kind: 'constructor' }, { kind: '__proto__' }, { kind: 'toString', burn: 5 }, { kind: 7 }, { kind: ['stove'] },
    { kind: 'stove', door: 7, to: 'yes', burn: 1e308 },
    { kind: 'stove', door: -3, to: 1, burn: -4 },
    { kind: 'stove', door: null, to: null, burn: null, fuel: null, food: null, gear: null },
    { kind: 'stove', door: '0.5', to: 2, burn: '300' },
    { kind: 'campfire', door: 1, to: 1, burn: 9999, fuel: [bat], gear: { uid: 'p', id: 'thermos', qty: 1 } },
    { kind: 'stove', fuel: 'wood', food: { length: 3, 0: bat } },
    { kind: 'stove', fuel: [[[]]], food: [[bat]] },
    {
      kind: 'stove', door: 1, to: 1, burn: 100,
      fuel: [
        null, 5, 'a', {}, { item: null }, { item: 'bat' }, bat,
        { item: { uid: 'g', id: 'mosin', qty: 1 }, x: 0, y: 1, rot: false },
        { item: { uid: 'b2', id: 'bandage', qty: 1e9 }, x: -3, y: 99, rot: 'x' },
        { item: { uid: 'b2', id: 'bandage', qty: 2 }, x: 0, y: 1, rot: false },
        { item: { uid: 'c', id: 'constructor', qty: 1 }, x: 0, y: 2 },
        { item: { uid: 'n', id: 'cigarettes', qty: -2 }, x: 1.5, y: 0.5 },
        { item: { uid: 'x'.repeat(65), id: 'bat', qty: 1 }, x: 0, y: 2, rot: true },
        { item: { uid: '', id: 'bat', qty: 1 }, x: 0, y: 2, rot: true },
        { item: { uid: 7, id: 'bat', qty: 1 }, x: 0, y: 2, rot: true },
        { item: { uid: 't0', id: 'beans', qty: 1 }, x: 3, y: 2 },
        { uid: 'flat', id: 'bat', qty: 1, x: 0, y: 2, rot: true },
        { item: bat.item, x: 0, y: 0, rot: true },
      ],
      food: [
        { item: { uid: 't1', id: 'beans', qty: 50, cook: 1e12, hot: 1e99 }, x: 0, y: 0, rot: false },
        { item: { uid: 't2', id: 'apple', qty: 1, cook: -5, hot: 'soon' }, x: 0, y: 0 },
        { item: { uid: 't3', id: 'sardines', qty: 1, cook: 31, hot: 1e99 }, x: 99, y: 99 },
        { item: { uid: 't4', id: 'tomatoes', qty: 1, cook: {}, hot: T0 + 5 }, x: 3, y: 0, rot: 1 },
        { item: { uid: 'b9', id: 'bat', qty: 1 }, x: 0, y: 2, rot: true },
        { item: { uid: 'b1', id: 'beans', qty: 1 }, x: 2, y: 1 },
      ],
      gear: { uid: 'p', id: 'thermos', qty: 1 },
    },
    { kind: 'potfire', burn: 5000, gear: { uid: 'p', id: 'cooking_pot', qty: 1 }, fuel: Array.from({ length: 300 }, (_, i) => ({ item: { uid: `c${i}`, id: 'cigarettes', qty: 5 }, x: i, y: 0 })) },
    { kind: 'stove', food: Array.from({ length: 300 }, (_, i) => ({ uid: `a${i}`, id: 'apple', qty: 1, x: 0, y: 0, rot: false })) },
  ];
  // (and the same through JSON, which is how any of it would arrive)
  for (const raw of [...rubbish, ...rubbish.map((r) => (r === undefined || typeof r === 'function' ? null : JSON.parse(JSON.stringify(r))))]) {
    let spot!: CookSpot;
    const why = JSON.stringify(raw)?.slice(0, 60) ?? String(raw);
    assert.doesNotThrow(() => (spot = readSpot(raw, { now: T0 })), why);
    sound(spot, why);
    assert.doesNotThrow(() => sound(readSpot(raw), why));
    for (const kind of Object.keys(COOK_KINDS)) sound(readSpot(raw, { kind, now: T0, spilled: [] }), `${why} as a ${kind}`);
    assert.doesNotThrow(() => sound(shadow('stove', raw), `${why} as what was seen`));
    assert.doesNotThrow(() => setGrid(opened('stove'), 'fuel', raw));
  }
  // what the worst of them came to, said outright
  const spot = readSpot(rubbish[23], { now: T0 });
  assert.deepEqual([spot.kind, spot.door, spot.to, spot.burn, spot.gear], ['stove', 1, 1, 100, null]);
  assert.deepEqual(spot.fuel.map((p) => [p.item.uid, p.item.id, p.item.qty, p.x, p.y]), [['b1', 'bat', 1, 0, 0], ['b2', 'bandage', 5, 0, 1], ['n', 'cigarettes', 1, 1, 1], ['flat', 'bat', 1, 0, 2]]);
  // (the tall tin said to lie on its side half out of the grid is stood up in the first place there is for it)
  assert.deepEqual(spot.food.map((p) => [p.item.uid, p.x, p.y, cookOf(p.item), hotOf(p.item)]), [['t1', 0, 0, COOKS.beans.takes + COOKS.beans.burns, undefined], ['t2', 1, 0, undefined, undefined], ['t3', 2, 0, 31, T0 + HEAT.keeps], ['t4', 1, 1, undefined, undefined]]);
  // whoever reads knows what stands there better than what was written; failing that, what was written; failing that, the least there is
  assert.equal(readSpot({ kind: 'campfire' }, { kind: 'stove' }).kind, 'stove');
  assert.equal(readSpot({ kind: 'stove' }, { kind: 'bonfire' }).kind, 'stove');
  assert.equal(readSpot({ kind: 'bonfire' }).kind, 'campfire');
  // a stove's worth read as a ring of stones: what there is no room for is handed back, not lost
  const full = opened('stove'), spilled: ItemInstance[] = [];
  for (let i = 0; i < 6; i++) putIn(full, 'food', thing('beans'));
  putIn(full, 'fuel', thing('bat'));
  const small = readSpot(JSON.parse(JSON.stringify(full)), { kind: 'campfire', spilled });
  assert.deepEqual([small.food.length, small.fuel.length, spilled.length], [2, 0, 4]);
  // time that is no time changes nothing
  const fire = alight('campfire'), before = JSON.stringify(fire);
  for (const dt of [0, -1, NaN, Infinity, -Infinity]) assert.deepEqual(tick(fire, dt, T0), { out: false, door: false, fed: false, done: [], burned: [] });
  assert.equal(JSON.stringify(fire), before);
});

ok('one long stretch comes to the same as many short ones, and a thing cooks only for as long as the fire lasted', () => {
  const build = () => {
    const spot = opened('stove');
    putIn(spot, 'fuel', { ...thing('bandage', 3), uid: 'dressings' });
    putIn(spot, 'food', { ...thing('beans'), uid: 'tin' });
    putIn(spot, 'food', { ...thing('apple'), uid: 'apple' });
    light(spot);
    return spot;
  };
  const once = build(), often = build(), start = now;
  const news = tick(once, 317.5, start + 317.5);
  let done = 0, burned = 0, fed = 0;
  for (let i = 1; i <= 3175; i++) {
    const h = tick(often, 0.1, start + i * 0.1);
    done += h.done.length;
    burned += h.burned.length;
    fed += h.fed ? 1 : 0;
  }
  assert.ok(Math.abs(once.burn - often.burn) < 1e-6, `${once.burn} and ${often.burn} left alight`);
  assert.deepEqual(once.fuel, often.fuel);
  // (five minutes on nothing, then the first dressing of the three, which is not burned through yet)
  assert.ok(news.fed && fed === 1, 'one dressing caught, once, however it was counted');
  assert.equal(gridOf(once, 'fuel')!.count('bandage'), 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(stageOf(once.food[i].item), stageOf(often.food[i].item));
    assert.ok(Math.abs(cookOf(once.food[i].item)! - cookOf(often.food[i].item)!) < 1e-6);
  }
  assert.deepEqual([stageOf(once.food[0].item), stageOf(once.food[1].item)], ['burned', 'burned']);
  // (looked at once, a thing that went from raw to burned is one piece of news; looked at often, it was done on the way)
  assert.deepEqual([news.done.length, news.burned.length, done, burned], [0, 2, 2, 2]);

  // A tin put on a campfire with fifty seconds left to burn, and not looked at for a quarter of an hour: it had
  // its fifty seconds and no more, and has been going cold since the fire died, not since it was looked at.
  const fire = alight('campfire'), tin = thing('beans');
  pass(fire, COOK_KINDS.campfire.free - 50);
  putIn(fire, 'food', tin);
  const died = now + 50;
  const h = pass(fire, 900);
  assert.ok(h.out && h.done.length === 1);
  assert.equal(cookOf(tin), 50);
  assert.equal(stageOf(tin), 'done');
  assert.equal(hotOf(tin), died + HEAT.keeps);
  assert.equal(isHot(tin, died + HEAT.keeps - 1), true);
  assert.equal(isHot(tin, now), false, 'it was hot a quarter of an hour after the fire went out');
});

ok('all of them kept together: who is near enough, what is alight, who is warmed, and what a game that only watches is told', () => {
  // a ring of stones in a yard, and two stoves one over the other in a house of two floors
  const places = [{ kind: 'campfire', x: 0, z: 0 }, { kind: 'stove', x: 20, z: 5, y: 0.1 }, { kind: 'stove', x: 20, z: 5, y: 3.3 }];
  const server = new CookSpots(places), reach = COOK_KINDS.stove.reach;
  assert.deepEqual(server.spots.map((s) => s.kind), ['campfire', 'stove', 'stove']);
  assert.equal(server.at(2, 20.5, 5, 0, 3.3), server.spots[2]);
  assert.equal(server.at(2, 20.5, 5, 0, 0.1), null, 'worked through the floor');
  assert.equal(server.at(1, 20.5, 5, 0, 0.1), server.spots[1]);
  assert.equal(server.at(1, 20 + reach + 0.5, 5, 0, 0.1), null);
  assert.equal(server.at(1, 20 + reach + 0.5, 5, 1, 0.1), server.spots[1], 'the grace a moving player is given');
  assert.equal(server.at(1, 20.5, 5), server.spots[1], 'where how high is not known, it is not asked');
  for (const i of [-1, 3, 0.5, NaN, Infinity]) assert.equal(server.at(i, 0, 0), null);
  assert.deepEqual(server.told(), [], 'nothing is news of spots as they were made');
  assert.deepEqual(server.tick(10, T0), []);

  // the upper stove: its door opened, fed, and lit
  const up = server.spots[2];
  swingDoor(up, true);
  assert.deepEqual(server.tick(0.7, T0), [[2, { out: false, door: true, fed: false, done: [], burned: [] }]]);
  putIn(up, 'fuel', thing('bandage', 2));
  const tin = thing('sardines');
  putIn(up, 'food', tin);
  assert.ok(light(up));
  assert.deepEqual(server.tick(1, T0 + 1), [], 'a second of burning is nobody\'s news');
  const all = COOK_KINDS.stove.free + 2 * FUEL.bandage * COOK_KINDS.stove.lasts;
  assert.deepEqual(seen(up), [1, 1, all - 1]);
  assert.deepEqual(server.told(), [[2, [1, 1, all - 1]]]);
  // who it warms: whoever rests by it on its own floor
  assert.deepEqual(server.warmth(21, 5, 3.3), COOK_KINDS.stove.warm);
  assert.equal(server.warmth(21, 5, 0.1), null, 'warmed through the floor by the stove upstairs');
  assert.equal(server.warmth(20 + COOK_KINDS.stove.warm!.within + 0.1, 5, 3.3), null);
  assert.equal(server.warmth(0.5, 0, 0), null, 'warmed by cold stones');
  light(server.spots[0]);
  assert.deepEqual(server.warmth(0.5, 0), COOK_KINDS.campfire.warm);

  // a game that only watches: it is told three figures, and from them its own copy burns out when the real one does
  const game = new CookSpots(places);
  for (const [i, s] of JSON.parse(JSON.stringify(server.told()))) game.hear(i, s);
  assert.deepEqual([doorState(game.spots[2]), isLit(game.spots[2]), game.spots[2].fuel.length], ['open', true, 0]);
  assert.equal(fuelLeft(game.spots[2]), fuelLeft(up));
  let t = T0 + 1;
  const told = server.tick(20, (t += 20));
  assert.deepEqual(told.map(([i, h]) => [i, h.done]), [[2, [tin]]], 'the keeper is told what is done, to tell whoever has it open');
  game.tick(20, t);
  // (one a second at a time, the other sixty times a second, to the same end)
  const rest = all - 21;
  server.tick(rest - 0.5, (t += rest - 0.5));
  for (let i = 0; i < Math.round((rest - 0.5) * 60); i++) game.tick(1 / 60, t);
  assert.ok(isLit(up) && isLit(game.spots[2]), 'one of them went out early');
  assert.ok(Math.abs(fuelLeft(up) - fuelLeft(game.spots[2])) < 1e-6);
  const last = server.tick(1, (t += 1)).find(([i]) => i === 2)!;
  assert.ok(last[1].out);
  assert.ok(game.tick(1, t).find(([i]) => i === 2)![1].out);
  assert.deepEqual(seen(up), [1, 1, 0]);
  // a door pushed to on the server swings in the game in the same time
  swingDoor(up, false);
  game.hear(2, seen(up));
  server.tick(0.7, t);
  game.tick(0.7, t);
  assert.deepEqual([doorState(up), doorState(game.spots[2])], ['shut', 'shut']);
  // whoever opens one is given all of it, and has exactly what the server has
  game.set(2, JSON.parse(JSON.stringify(up)), t);
  assert.deepEqual(game.spots[2], up);
  assert.notEqual(game.spots[2], up);
  // nothing told of a spot there is not does any harm
  game.hear(9, [1, 1, 50]);
  game.set(-1, {});
  assert.equal(game.spots.length, 3);
  // what was seen, read back from nonsense, is a shut cold spot
  assert.deepEqual(shadow('stove', ['a', 'b', 'c']), newSpot('stove'));
  assert.deepEqual(shadow('campfire', [1, 1, 40]), { ...newSpot('campfire'), burn: 40 }, 'a ring of stones was given a door');
});

console.log(`\n${n} checks passed`);
