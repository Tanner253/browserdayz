// The orders an admin or a mod can give on the game server, typed where talk is typed (2026-10-11).
//
// One list for both ends: the server's /help reads it out, and the game's chat box offers from it as an order is
// typed. What each one does is `command` in server/index.ts: a line added here does nothing until it is added there.

import { KITS } from '../sim/kits';
import { POLICE_CAR } from '../sim/vehicles';
import { HELI } from '../sim/heli';

export type Role = 'admin' | 'mod';

/**
 * What an admin can stand in the world with `/spawn` (2026-10-13: "add more admin tools that might be useful like
 * spawn entities like cars and zombies and future entities would go here"). One list for both ends, as the orders
 * are: the panel's Entities page is drawn from it row by row, the chat box offers from it, and the server reads it
 * to know what is meant. A new kind of thing is one more row here, and (if it is made in a way of its own) one
 * more `kind` for `/spawn` in server/index.ts to make.
 */
export interface Entity {
  /** the word it is asked for by */
  id: string;
  name: string;
  /** how the server makes it: a car (`k` says which car), one of the infected, or an animal (`animal`: its kind, src/sim/animals.ts) */
  kind: 'car' | 'infected' | 'animal';
  animal?: string;
  k?: number;
  /** the most of them one order stands */
  most: number;
  does: string;
  /** other words it answers to */
  also?: string[];
}
export const ENTITIES: Entity[] = [
  { id: 'jeep', name: 'Jeep', kind: 'car', k: 0, most: 4, does: 'The off-road car: four seats, fuel in the tank', also: ['uaz', 'car'] },
  { id: 'police', name: 'Police car', kind: 'car', k: POLICE_CAR.kind, most: 4, does: 'The road car: quicker than the jeep on a road, slower off it', also: ['policecar', 'cop'] },
  { id: 'heli', name: 'Helicopter', kind: 'car', k: HELI.kind, most: 2, does: 'The MD-500: two seats; Space climbs, C drops (put it somewhere with room round it)', also: ['helicopter', 'md500', 'chopper'] },
  { id: 'infected', name: 'Infected', kind: 'infected', most: 25, does: 'They stand where they are put, and go for whoever is near. Nothing comes back in their place when they are dead', also: ['zombie', 'zombies', 'z'] },
  // (the animals, 2026-10-23: each stood in a herd of its own that lives where it is put; src/sim/animals.ts)
  { id: 'deer', name: 'Red deer stag', kind: 'animal', animal: 'stag', most: 8, does: 'Grazes, and bolts from anybody it sees, hears or smells', also: ['stag'] },
  { id: 'doe', name: 'Red deer hind', kind: 'animal', animal: 'doe', most: 8, does: 'Grazes, and bolts', also: ['hind'] },
  { id: 'bear', name: 'Brown bear', kind: 'animal', animal: 'bear', most: 4, does: 'Roars, then charges whoever comes near or hurts it' },
  { id: 'wolf', name: 'Wolf', kind: 'animal', animal: 'wolf', most: 8, does: 'Circles whoever it hunts and comes in to bite', also: ['wolves'] },
  { id: 'boar', name: 'Wild boar', kind: 'animal', animal: 'boar', most: 6, does: 'Runs, and charges when hurt and near' },
  { id: 'hare', name: 'Hare', kind: 'animal', animal: 'hare', most: 8, does: 'Bolts zig-zag' },
  { id: 'goat', name: 'Wild goat', kind: 'animal', animal: 'goat', most: 8, does: 'Bolts uphill' },
  { id: 'fox', name: 'Red fox', kind: 'animal', animal: 'fox', most: 6, does: 'Bolts' },
  { id: 'cow', name: 'Cow', kind: 'animal', animal: 'cow', most: 6, does: 'Wanders, and shies off' },
];
/** the thing meant by a word typed after `/spawn` */
export const entityBy = (word: string): Entity | null => {
  const w = word.toLowerCase();
  return ENTITIES.find((e) => e.id === w || e.also?.includes(w)) ?? null;
};

export interface Order {
  name: string;
  /** what follows it, word by word, as it is shown (the last may be many words). `who` is a player, `item` a thing, `minutes` a number; in [brackets], it can be left out */
  args: string[];
  does: string;
  /** an admin's alone: a mod is not offered it and may not give it */
  admin?: true;
}

export const ORDERS: Order[] = [
  { name: 'players', args: [], does: 'Who is online: their numbers, where they are, who is flagged' },
  { name: 'recent', args: [], does: 'Who has left lately' },
  { name: 'flagged', args: [], does: 'Who the cheat checks have flagged' },
  { name: 'same', args: ['who'], does: 'Who else plays, or lately played, on the same device as somebody (who may be dev:xxxxxxxx from /players)' },
  { name: 'kick', args: ['who', '[why]'], does: 'Put somebody off the server (they can come straight back)' },
  { name: 'timeout', args: ['who', 'minutes', '[why]'], does: 'Keep somebody off for up to 60 minutes' },
  { name: 'say', args: ['words'], does: 'Say something across everybody’s screen, and in the chat' },
  { name: 'del', args: ['what', 'number'], does: 'Take a thing out of the world: item, box (a body, a drop, a buried stash), car or z (one of the infected), by its number. The Delete key does it for whatever you are looking at', admin: true },
  { name: 'spawn', args: ['entity', '[count]', '[x z]'], does: 'Stand something in the world: jeep, police (a police car) or infected. A few steps in front of you, or (after how many) at those map numbers', admin: true },
  { name: 'airdrop', args: ['[x z]'], does: 'Send the helicopter with a supply drop now: to a few steps in front of you, or to those map numbers. It comes from the map’s edge as any drop does, and everybody is told', admin: true },
  { name: 'delcar', args: ['[number]'], does: 'Take a car out of the world: the one nearest you, or the one of that number', admin: true },
  { name: 'wrecks', args: [], does: 'Clear away every burned-out car now', admin: true },
  { name: 'delz', args: ['[metres]'], does: 'Put down every one of the infected within so many metres of you (60 if not said)', admin: true },
  { name: 'restart', args: ['[seconds]', '[why]'], does: 'Tell everybody the server is about to restart (it only says so)', admin: true },
  { name: 'save', args: [], does: 'Write everybody and every stash to the site now (a deploy does it by itself; this is for a restart made by hand)', admin: true },
  { name: 'delc', args: ['[number]'], does: 'Take a comment off the changelog by its number; with no number, the newest are read out', admin: true },
  { name: 'msg', args: ['who', 'words'], does: 'Say something to one player alone' },
  { name: 'inv', args: ['who'], does: 'What somebody carries, as their game last said' },
  { name: 'warn', args: ['who', 'words'], does: 'Put a warning on somebody’s screen' },
  { name: 'mute', args: ['who', 'minutes'], does: 'What they type and say reaches nobody, for up to 60 minutes' },
  { name: 'unmute', args: ['who'], does: 'Let them be heard again' },
  { name: 'unlock', args: ['who'], does: 'Let them change their name and payout wallet, fixed since their first cashed tag, until their next one (somebody not on: by the name they are fixed to)', admin: true },
  { name: 'goto', args: ['who'], does: 'Go to where somebody is', admin: true },
  { name: 'bring', args: ['who'], does: 'Bring somebody to where you are', admin: true },
  { name: 'tp', args: ['x', 'z'], does: 'Go to a place by its numbers (or right-click the map)', admin: true },
  // (2026-10-13: "the default mode for spawning loot for somone should be in their inventory unless on space". It was at their feet, always.)
  { name: 'give', args: ['item', '[count]', '[who]', '[ground]'], does: 'Put a thing into your inventory, or somebody’s: what finds no room there lies at their feet. With the word ground after it, at their feet and not into the inventory', admin: true },
  { name: 'kit', args: ['kit', '[who]'], does: 'A whole set of the best there is, in place of what is carried', admin: true },
  { name: 'clear', args: ['[who]'], does: 'Empty everything you carry and wear, or somebody else’s (dog tags are kept)', admin: true },
  { name: 'heal', args: ['[who]'], does: 'Whole, fed and watered: you, or somebody', admin: true },
  { name: 'slay', args: ['who'], does: 'Kill somebody where they stand', admin: true },
  { name: 'die', args: [], does: 'Kill yourself where you stand', admin: true },
  { name: 'god', args: ['[who]'], does: 'Nothing hurts you, or another admin (again, to put it off)', admin: true },
  { name: 'vanish', args: ['[who]'], does: 'Nobody but an admin sees you, or another admin (again, to be seen)', admin: true },
  { name: 'noclip', args: ['[who]'], does: 'You fly, and through anything; or another admin does (again, to walk)', admin: true },
  { name: 'voidinv', args: ['[who]'], does: 'Dying, an admin leaves nothing they carried on their body (again, to leave it)', admin: true },
  { name: 'voidtag', args: ['[who]'], does: 'Dying, an admin leaves no dog tag of their own (again, to leave one)', admin: true },
  // (what is carried, and what is fired, 2026-10-13: src/sim/powers.ts. `on` or `off` says which; said neither, it is turned over)
  { name: 'weightless', args: ['[on|off]', '[who]'], does: 'What you carry weighs nothing: however much it is, it never slows you. Or another admin’s (with neither word, it is turned over)', admin: true },
  { name: 'ammo', args: ['[on|off]', '[who]'], does: 'Endless ammunition: firing takes no round out of your gun. Or another admin’s (with neither word, it is turned over)', admin: true },
  { name: 'bottomless', args: ['[on|off]', '[who]'], does: 'Your inventory never fills: what your pockets cannot take goes into a hold that always has room. Or another admin’s (with neither word, it is turned over). Put off, what does not fit what you wear lies at your feet', admin: true },
  { name: 'refill', args: ['[who]'], does: 'Every magazine and every gun you carry is filled, or somebody else’s', admin: true },
  { name: 'ban', args: ['who', '[why]'], does: 'Ban for good: their game, their address and their device (who may be dev:xxxxxxxx from /players)', admin: true },
  { name: 'bans', args: [], does: 'Who is banned, numbered for /unban', admin: true },
  { name: 'unban', args: ['id-number-or-name'], does: 'Lift a ban: by its id or its number from /bans, or by the name if only one ban has it', admin: true },
  { name: 'turned', args: [], does: 'Who was turned away at the door lately (banned, kept off, a full device, the bot check not passed), and why' },
  { name: 'pardon', args: ['who'], does: 'Let somebody turned away at the door straight back in: every ban and strike on their game, address and device lifted (who: a name or p:number from /turned, or dev:xxxxxxxx)', admin: true },
  { name: 'admin', args: ['who'], does: 'Make somebody an admin', admin: true },
  { name: 'mod', args: ['who'], does: 'Make somebody a mod: kick, timeout and say', admin: true },
  { name: 'demote', args: ['who'], does: 'Take somebody’s role away', admin: true },
  { name: 'dogtag', args: ['who', 'on|off'], does: 'Whether somebody below you leaves a dog tag when they die, set for them: no longer theirs to choose', admin: true },
  { name: 'roles', args: [], does: 'Who has a role', admin: true },
  { name: 'help', args: [], does: 'This list, in the chat' },
];

/**
 * What every player can type, admin or not: the party's (server/party.ts). Offered in the chat box to everybody, so a
 * player can find how to leave one (the owner, 2026-10-20: "we need commands for players to leave their party once
 * they join one"; /leave was there, and nobody could know it).
 */
export const PARTY_ORDERS: Order[] = [
  { name: 'leave', args: [], does: 'Leave your party' },
  { name: 'party', args: [], does: 'Who is in your party' },
  { name: 'invite', args: ['who'], does: 'Ask somebody to join your party (or look at them and press F)' },
  { name: 'accept', args: [], does: 'Join the party you were asked to' },
];

/** an order as it is written out: `/timeout who minutes [why]` */
export const written = (o: Order) => `/${o.name}${o.args.length ? ` ${o.args.join(' ')}` : ''}`;
/** the orders somebody with this role may give: the party's for everybody, then their role's */
export const ordersOf = (role: Role | null) => [...PARTY_ORDERS, ...(role ? ORDERS.filter((o) => !o.admin || role === 'admin') : [])];

/** one thing that could be meant by what is typed so far */
export interface Pick {
  label: string;
  note: string;
  /** the whole line as it stands when this is taken */
  fill: string;
  /** taken, it is an order with nothing left to add: Enter gives it */
  whole: boolean;
}
export interface Offer {
  /** the order being filled in, once its name is typed, and which of its words is being typed now */
  order: Order | null;
  at: number;
  picks: Pick[];
}

const MINUTES = ['5', '10', '30', '60'];
const METRES = ['30', '60', '120', '250'];
const SWITCH = ['on', 'off'];
/**
 * The words that put what `/give` makes at somebody's feet, where it would otherwise go into their inventory. One
 * list for both ends: the chat box offers the first of them, and the server reads any. (Somebody whose name is one
 * of these is given things by their number.)
 */
export const GROUND = ['ground', 'feet', 'floor'];

/**
 * What to offer under a line being typed. @returns null when the line is talk, or whoever types has no role.
 * @param here who is online (not counting whoever types)  @param gone the names of who left lately, newest last
 * @param things everything there is to be given
 */
export function offer(text: string, role: Role | null, here: { id: number; name: string }[], gone: string[] = [], things: { id: string; name: string }[] = []): Offer | null {
  if (!text.startsWith('/')) return null;
  const mine = ordersOf(role), words = text.slice(1).split(/\s+/);
  if (words.length === 1) {
    const w = words[0].toLowerCase();
    // (an order whose every word can be left out is given whole by Enter, as one with no words is)
    const bare = (o: Order) => o.args.every((a) => a.startsWith('['));
    const picks = mine.filter((o) => o.name.startsWith(w)).map((o) => ({ label: written(o), note: o.does, fill: `/${o.name}${bare(o) ? '' : ' '}`, whole: bare(o) }));
    return picks.length ? { order: null, at: -1, picks } : null;
  }
  const order = mine.find((o) => o.name === words[0].toLowerCase());
  if (!order || !order.args.length) return null;
  const typed = words.length - 2, at = Math.min(typed, order.args.length - 1);
  // (past the last word that is named, what is typed is more of that last one: a reason, or what to say)
  const part = typed === at ? words[words.length - 1] : '', p = part.toLowerCase();
  const stem = text.slice(0, text.length - part.length), kind = order.args[at].replace(/[[\]]/g, '');
  let picks: Pick[] = [];
  if (kind === 'who') {
    // (taken by number: a name can have a space in it, or be somebody else's too)
    picks = here
      .filter((o) => !p || o.name.toLowerCase().includes(p) || `#${o.id}`.startsWith(p))
      .map((o) => ({ label: `#${o.id}  ${o.name}`, note: 'online', fill: `${stem}#${o.id} `, whole: order.args.length === 1 }));
    if (order.name === 'ban') {
      const on = new Set(here.map((o) => o.name.toLowerCase()));
      for (const name of [...new Set([...gone].reverse())]) {
        // (who has gone is found by name, and by one word of it)
        const word = name.split(/\s+/).sort((x, y) => y.length - x.length)[0] ?? '';
        if (word.length < 2 || on.has(name.toLowerCase()) || (p && !name.toLowerCase().includes(p))) continue;
        picks.push({ label: name, note: 'left lately', fill: `${stem}${word} `, whole: false });
      }
    }
  } else if (kind === 'item') {
    picks = things
      .filter((o) => !p || o.id.includes(p) || o.name.toLowerCase().includes(p))
      .sort((x, y) => Number(y.id.startsWith(p)) - Number(x.id.startsWith(p)))
      .map((o) => ({ label: o.id, note: o.name, fill: `${stem}${o.id} `, whole: false }));
  } else if (kind === 'kit') {
    picks = KITS.filter((o) => o.id.startsWith(p)).map((o) => ({ label: o.id, note: o.does, fill: `${stem}${o.id} `, whole: false }));
  } else if (kind === 'minutes') {
    picks = MINUTES.filter((m) => m.startsWith(p) && m !== p).map((m) => ({ label: m, note: 'minutes', fill: `${stem}${m} `, whole: false }));
  } else if (kind === 'entity') {
    picks = ENTITIES.filter((e) => e.id.startsWith(p) || e.name.toLowerCase().startsWith(p) || !!e.also?.some((a) => a === p)).map((e) => ({ label: e.id, note: `${e.name}: ${e.does}`, fill: `${stem}${e.id} `, whole: false }));
  } else if (kind === 'metres') {
    picks = METRES.filter((m) => m.startsWith(p) && m !== p).map((m) => ({ label: m, note: 'metres', fill: `${stem}${m} `, whole: false }));
  }
  // After the thing in `/give`: how many, who it is for and the word `ground`, each of which can be left out, and
  // the last two said in either order, as the server reads them. Whatever is still to be said is offered: who is
  // online (not while a number is being typed: that is how many), and `ground`, which puts it at their feet.
  if (order.name === 'give' && at >= 1) {
    const before = words.slice(2, -1).map((w) => w.toLowerCase()), count = /^\d+$/.test(p);
    const grounded = before.some((w) => GROUND.includes(w)), named = before.some((w) => !GROUND.includes(w) && !/^\d+$/.test(w));
    const who = named || count ? [] : here.filter((o) => !p || o.name.toLowerCase().includes(p) || `#${o.id}`.startsWith(p)).map((o) => ({ label: `#${o.id}  ${o.name}`, note: 'online', fill: `${stem}#${o.id} `, whole: false }));
    const ground = grounded || count || !GROUND[0].startsWith(p) || p === GROUND[0] ? [] : [{ label: GROUND[0], note: 'at their feet, and not into the inventory', fill: `${stem}${GROUND[0]} `, whole: false }];
    picks = [...who, ...ground];
  }
  // A switch (`[on|off]`, then `[who]`). The word and the player may be said in either order, as the server reads
  // them: whichever is still to be said is what is offered. With nothing typed, the two words; with a name or a
  // number begun where the word would be, the players; with both said, nothing more.
  if (order.args[0] === '[on|off]') {
    const before = words.slice(1, -1).map((w) => w.toLowerCase());
    const switched = before.some((w) => SWITCH.includes(w)), named = before.some((w) => !SWITCH.includes(w));
    const word = switched ? [] : SWITCH.filter((w) => w.startsWith(p) && w !== p).map((w) => ({ label: w, note: w === 'on' ? 'put it on' : 'put it off', fill: `${stem}${w} `, whole: false }));
    const who = named || (!switched && (!p || SWITCH.some((w) => w.startsWith(p)))) ? [] : here.filter((o) => !p || o.name.toLowerCase().includes(p) || `#${o.id}`.startsWith(p)).map((o) => ({ label: `#${o.id}  ${o.name}`, note: 'online', fill: `${stem}#${o.id} `, whole: false }));
    picks = [...word, ...who];
  }
  return { order, at, picks };
}
