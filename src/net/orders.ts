// The orders an admin or a mod can give on the game server, typed where talk is typed (2026-10-11).
//
// One list for both ends: the server's /help reads it out, and the game's chat box offers from it as an order is
// typed. What each one does is `command` in server/index.ts: a line added here does nothing until it is added there.

import { KITS } from '../sim/kits';
import { POLICE_CAR } from '../sim/vehicles';

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
  /** how the server makes it: a car (`k` says which car), or one of the infected */
  kind: 'car' | 'infected';
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
  { id: 'infected', name: 'Infected', kind: 'infected', most: 25, does: 'They stand where they are put, and go for whoever is near. Nothing comes back in their place when they are dead', also: ['zombie', 'zombies', 'z'] },
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
  { name: 'kick', args: ['who', '[why]'], does: 'Put somebody off the server (they can come straight back)' },
  { name: 'timeout', args: ['who', 'minutes', '[why]'], does: 'Keep somebody off for up to 60 minutes' },
  { name: 'say', args: ['words'], does: 'Say something across everybody’s screen, and in the chat' },
  { name: 'del', args: ['what', 'number'], does: 'Take a thing out of the world: item, box (a body, a drop, a buried stash), car or z (one of the infected), by its number. The Delete key does it for whatever you are looking at', admin: true },
  { name: 'spawn', args: ['entity', '[count]', '[x z]'], does: 'Stand something in the world: jeep, police (a police car) or infected. A few steps in front of you, or (after how many) at those map numbers', admin: true },
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
  { name: 'goto', args: ['who'], does: 'Go to where somebody is', admin: true },
  { name: 'bring', args: ['who'], does: 'Bring somebody to where you are', admin: true },
  { name: 'tp', args: ['x', 'z'], does: 'Go to a place by its numbers (or right-click the map)', admin: true },
  { name: 'give', args: ['item', '[count]', '[who]'], does: 'Put a thing at your feet, or at somebody’s', admin: true },
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
  { name: 'ban', args: ['who', '[why]'], does: 'Ban for good: their game and their address', admin: true },
  { name: 'bans', args: [], does: 'Who is banned, numbered for /unban', admin: true },
  { name: 'unban', args: ['id-number-or-name'], does: 'Lift a ban: by its id or its number from /bans, or by the name if only one ban has it', admin: true },
  { name: 'admin', args: ['who'], does: 'Make somebody an admin', admin: true },
  { name: 'mod', args: ['who'], does: 'Make somebody a mod: kick, timeout and say', admin: true },
  { name: 'demote', args: ['who'], does: 'Take somebody’s role away', admin: true },
  { name: 'roles', args: [], does: 'Who has a role', admin: true },
  { name: 'help', args: [], does: 'This list, in the chat' },
];

/** an order as it is written out: `/timeout who minutes [why]` */
export const written = (o: Order) => `/${o.name}${o.args.length ? ` ${o.args.join(' ')}` : ''}`;
/** the orders somebody with this role may give */
export const ordersOf = (role: Role | null) => (role ? ORDERS.filter((o) => !o.admin || role === 'admin') : []);

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

/**
 * What to offer under a line being typed. @returns null when the line is talk, or whoever types has no role.
 * @param here who is online (not counting whoever types)  @param gone the names of who left lately, newest last
 * @param things everything there is to be given
 */
export function offer(text: string, role: Role | null, here: { id: number; name: string }[], gone: string[] = [], things: { id: string; name: string }[] = []): Offer | null {
  if (!role || !text.startsWith('/')) return null;
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
  return { order, at, picks };
}
