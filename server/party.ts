// Parties (2026-10-19), the lite first one: the owner, "players want to be able to team up with eachother, can we do a
// simple party system, with a very LITE indicator on friendlies ... we will come back to this functionality and make it
// more robust but for now just make it work". As in Rust: one asks another, face to face (F, looking at them) or by name
// (/invite), and they say yes the same way. A party is held by its members' keys while the server runs, so whoever drops
// and comes back is still in it; a restart ends them all. It changes no rule: a member can still be shot. Each member is
// told who is in it (the ids of those on the server, and every name), which is all their game needs to mark them.
import { clients, send, type Client } from './players';
import { sys } from './keep';

/** the most in one party */
export const PARTY_MAX = 6;
/** how long an invite stands, ms */
const INVITE_FOR = 120_000;
/** a party's number -> its members' keys, in the order they came */
const parties = new Map<number, string[]>();
/** a key -> its party */
const partyOf = new Map<string, number>();
/** a key -> the name it last went by (a member who is away is still listed) */
const named = new Map<string, string>();
/** the invited key -> who asked, and when */
const invites = new Map<string, { from: string; at: number }>();
let next = 1;

const online = (key: string) => {
  for (const c of clients.values()) if (c.key === key) return c;
  return null;
};

/** the members of somebody's party who are on the server, themselves among them (none: in no party) */
export function partyMates(c: Client): Client[] {
  const pid = partyOf.get(c.key), keys = pid === undefined ? undefined : parties.get(pid);
  return keys ? keys.map(online).filter((o): o is Client => !!o) : [];
}

/** every member on the server told who is in their party; and, said, one who has left it told that they are in none */
function tell(pid: number | undefined, left?: Client) {
  if (left) send(left, { t: 'party', members: [] });
  const keys = pid === undefined ? undefined : parties.get(pid);
  if (!keys) return;
  const members = keys.map((k) => ({ id: online(k)?.id ?? null, name: named.get(k) ?? 'Survivor' }));
  for (const k of keys) {
    const c = online(k);
    if (c) send(c, { t: 'party', members });
  }
}

function leave(c: Client, quiet = false) {
  const pid = partyOf.get(c.key);
  if (pid === undefined) return void (quiet || sys(c, 'You are in no party.'));
  partyOf.delete(c.key);
  const keys = (parties.get(pid) ?? []).filter((k) => k !== c.key);
  if (!quiet) sys(c, 'You left your party.');
  for (const k of keys) {
    const o = online(k);
    if (o) sys(o, `${c.name} left the party.`);
  }
  // (one left alone is in no party)
  if (keys.length < 2) {
    parties.delete(pid);
    for (const k of keys) {
      partyOf.delete(k);
      const o = online(k);
      if (o) send(o, { t: 'party', members: [] });
    }
  } else parties.set(pid, keys);
  tell(keys.length < 2 ? undefined : pid, c);
}

function invite(c: Client, o: Client) {
  if (o === c) return;
  const mine = partyOf.get(c.key);
  if (mine !== undefined && mine === partyOf.get(o.key)) return void sys(c, `${o.name} is in your party already.`);
  if (mine !== undefined && (parties.get(mine)?.length ?? 0) >= PARTY_MAX) return void sys(c, `Your party is full (${PARTY_MAX}).`);
  // (they asked first: this is a yes)
  const theirs = invites.get(c.key);
  if (theirs?.from === o.key && Date.now() - theirs.at < INVITE_FOR) return accept(c);
  invites.set(o.key, { from: c.key, at: Date.now() });
  send(o, { t: 'partyAsk', from: c.id, name: c.name });
  sys(o, `${c.name} asks you to join their party: look at them and press F, or type /accept.`);
  sys(c, `You asked ${o.name} to join your party.`);
}

function accept(c: Client) {
  const inv = invites.get(c.key);
  invites.delete(c.key);
  const from = inv && Date.now() - inv.at < INVITE_FOR ? online(inv.from) : null;
  if (!from) return void sys(c, 'Nobody has asked you to join a party, or they have gone.');
  let pid = partyOf.get(from.key);
  if (pid !== undefined && pid === partyOf.get(c.key)) return;
  if (pid !== undefined && (parties.get(pid)?.length ?? 0) >= PARTY_MAX) return void sys(c, `${from.name}'s party is full.`);
  if (partyOf.has(c.key)) leave(c, true);
  if (pid === undefined) {
    pid = next++;
    parties.set(pid, [from.key]);
    partyOf.set(from.key, pid);
  }
  parties.get(pid)!.push(c.key);
  partyOf.set(c.key, pid);
  named.set(c.key, c.name);
  named.set(from.key, from.name);
  for (const k of parties.get(pid)!) {
    const o = online(k);
    if (o) sys(o, o === c ? `You joined ${from.name}'s party. /leave leaves it.` : `${c.name} joined the party.`);
  }
  tell(pid);
}

/** what a player's game asks: to ask somebody it is looking at, to say yes, to leave */
export function partyAct(c: Client, m: { act?: unknown; id?: unknown }) {
  const o = typeof m.id === 'number' ? clients.get(m.id) : undefined;
  if (m.act === 'invite' && o) invite(c, o);
  else if (m.act === 'accept') accept(c);
  else if (m.act === 'leave') leave(c);
}

/** /party, /invite <name>, /accept, /leave: handled here, and true, if it is one of these */
export function partyCommand(c: Client, text: string): boolean {
  const [word, ...rest] = text.slice(1).trim().split(/\s+/);
  const verb = (word ?? '').toLowerCase();
  if (verb === 'invite') {
    const want = rest.join(' ').toLowerCase();
    const all = [...clients.values()].filter((o) => o !== c && !o.power.hidden);
    // (by name, or by number as the chat box offers them: #12)
    const found = all.filter((o) => o.name.toLowerCase() === want || `#${o.id}` === want.trim());
    const near = found.length ? found : all.filter((o) => want && o.name.toLowerCase().startsWith(want));
    if (near.length === 1) invite(c, near[0]);
    else sys(c, near.length ? `More than one player is called that: ${near.map((o) => o.name).join(', ')}` : `Nobody called "${rest.join(' ')}" is on the server.`);
    return true;
  }
  if (verb === 'accept') return accept(c), true;
  if (verb === 'leave') return leave(c), true;
  if (verb === 'party') {
    const pid = partyOf.get(c.key);
    const keys = pid === undefined ? [] : parties.get(pid) ?? [];
    sys(c, keys.length ? `Your party: ${keys.map((k) => `${named.get(k) ?? 'Survivor'}${online(k) ? '' : ' (away)'}`).join(', ')}.` : 'You are in no party.', 'Look at a player and press F to ask them to join you, or type /invite <name>. /accept says yes, /leave leaves.');
    return true;
  }
  return false;
}

/** come in: told the party they are in, and the others told they are here */
export function partyIn(c: Client) {
  named.set(c.key, c.name);
  tell(partyOf.get(c.key));
}

/** gone: the others told they are away (their place is kept) */
export function partyOut(c: Client) {
  tell(partyOf.get(c.key));
}
