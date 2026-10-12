// Hearts and comments on the entries of the changelog (2026-10-12: "can we add a blog/forum layout to the changelog
// so users can heart the changelog posts, as well as leave a comment, it could help us come up with more ideas.
// public comment section, collapsed by default").
//
// The game server holds them, since it is always there, and keeps them with the rest of what it keeps (see `keep`
// in server/index.ts): nothing is written anywhere for a heart or a comment by itself. Here are the rules only:
// who may say what, how often, and what the page is told. No clock and no network: the caller says what time it is.

/** one comment, as it is kept */
export interface Comment {
  id: number;
  entry: string;
  name: string;
  text: string;
  /** when, in milliseconds */
  at: number;
  /** who wrote it: the mark their browser gives (not their name, and not their key) */
  by: string;
}

/** everything of this that is kept through a restart */
export interface NewsKept {
  next: number;
  hearts: [entry: string, by: string[]][];
  comments: Comment[];
}

export const NEWS = {
  /** how long a comment may be, and how short */
  maxText: 400,
  minText: 2,
  maxName: 20,
  /** the newest so many are kept to an entry, and so many in all */
  perEntry: 150,
  inAll: 4000,
  /** one comment in this long from one browser or one address, and so many in a day */
  everyMs: 30_000,
  perDay: 12,
  /** hearts given or taken back in an hour from one address */
  heartsPerHour: 120,
  /** how many entries there may be (the page has thirty: nobody makes up ten thousand) */
  entries: 120,
  /** how many a browser's mark may be given by: a street of flats behind one address */
  perAddress: 40,
};

/** an entry's name is the id it has on the page: small letters, figures and dashes */
const ENTRY = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** the mark of a browser: made there from what it alone knows, sixteen to sixty-four hex figures */
const MARK = /^[a-f0-9]{16,64}$/;
/** an address of any kind: this is no place to send people from */
const LINK = /(https?:\/\/|www\.|t\.me\/|discord\.gg|\b[a-z0-9-]{2,}\.(com|net|org|io|xyz|gg|fun|ru|me|co|app|link|ly|to|tv|cc|sh|live|site|online|top|vip|pro|info|biz|dev)\b)/i;
/** the worst of what is said anywhere: not said here. (Everything short of that is an admin's to take down: `/delc`.) */
const NOT_SAID = /\b(n[i1!]gg(er|a|uh)s?|f[a@]gg?(ot)?s?|k[i1]kes?|ch[i1]nks?|sp[i1]cks?|tr[a@]nn(y|ies)|r[e3]t[a@]rd(s|ed)?|kys|k[i1]ll\s+your\s*sel(f|ves))\b/i;

/** what somebody typed, made fit to keep: one line of plain words */
export const tidy = (s: unknown, max: number) =>
  String(typeof s === 'string' ? s : '')
    // (what cannot be seen and what turns writing round are taken out, and every run of space is one space)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export type Said = { ok: true; comment: Shown } | { ok: false; why: string };
export type Loved = { ok: true; hearts: number; mine: boolean } | { ok: false; why: string };
/** a comment as the page is given it (not who wrote it) */
export interface Shown { id: number; name: string; text: string; at: number; mine?: boolean }

export class News {
  private hearts = new Map<string, Set<string>>();
  private comments: Comment[] = [];
  private next = 1;
  /** when each browser, and each address, last wrote (the day's worth) and last gave or took a heart (the hour's) */
  private wrote = new Map<string, number[]>();
  private loved = new Map<string, number[]>();
  /** which browsers' marks have come from an address */
  private marks = new Map<string, Set<string>>();
  /** the entries the page has, where that is known: nothing is kept of any other */
  known: Set<string> | null = null;
  /** something has changed since it was last kept */
  dirty = false;

  private entry(id: unknown): id is string {
    return typeof id === 'string' && ENTRY.test(id) && (this.known ? this.known.has(id) : this.hearts.has(id) || this.comments.some((c) => c.entry === id) || this.entryCount() < NEWS.entries);
  }
  private entryCount() {
    return new Set([...this.hearts.keys(), ...this.comments.map((c) => c.entry)]).size;
  }
  /** not more of one thing from one place than there may be: the times of it within `span`, with this one, are counted */
  private often(book: Map<string, number[]>, who: string, now: number, span: number, most: number, gap = 0): boolean {
    const t = (book.get(who) ?? []).filter((x) => now - x < span);
    book.set(who, t);
    return t.length >= most || (gap > 0 && t.length > 0 && now - t[t.length - 1] < gap);
  }
  /** a browser's mark, if it is one this address may speak by */
  private mark(by: unknown, address: string): string | null {
    if (typeof by !== 'string' || !MARK.test(by)) return null;
    const of = this.marks.get(address) ?? new Set<string>();
    if (!of.has(by) && of.size >= NEWS.perAddress) return null;
    of.add(by);
    this.marks.set(address, of);
    return by;
  }

  /** What the page shows: every entry that has anything, with how many hearts, whether one is this browser's, and what has been said (oldest first). */
  view(by?: string): Record<string, { hearts: number; mine: boolean; comments: Shown[] }> {
    const out: Record<string, { hearts: number; mine: boolean; comments: Shown[] }> = {};
    const at = (e: string) => (out[e] ??= { hearts: 0, mine: false, comments: [] });
    for (const [e, set] of this.hearts) if (set.size) Object.assign(at(e), { hearts: set.size, mine: !!by && set.has(by) });
    for (const c of this.comments) at(c.entry).comments.push({ id: c.id, name: c.name, text: c.text, at: c.at, ...(by && c.by === by ? { mine: true } : {}) });
    return out;
  }

  /** A heart given to an entry, or taken back if this browser had given one. */
  heart(entry: unknown, by: unknown, address: string, now: number): Loved {
    const who = this.mark(by, address);
    if (!who) return { ok: false, why: 'Open the game once in this browser first.' };
    if (!this.entry(entry)) return { ok: false, why: 'There is no such entry.' };
    if (this.often(this.loved, address, now, 3600_000, NEWS.heartsPerHour)) return { ok: false, why: 'That is a lot of hearts. Try again in a while.' };
    this.loved.get(address)!.push(now);
    const set = this.hearts.get(entry) ?? new Set<string>();
    this.hearts.set(entry, set);
    const mine = !set.delete(who);
    if (mine) set.add(who);
    this.dirty = true;
    return { ok: true, hearts: set.size, mine };
  }

  /** Something said under an entry. */
  say(entry: unknown, by: unknown, address: string, name: unknown, text: unknown, now: number): Said {
    const who = this.mark(by, address);
    if (!who) return { ok: false, why: 'Open the game once in this browser first.' };
    if (!this.entry(entry)) return { ok: false, why: 'There is no such entry.' };
    const words = tidy(text, NEWS.maxText + 1), called = tidy(name, NEWS.maxName) || 'Survivor';
    if (words.length < NEWS.minText) return { ok: false, why: 'Say something first.' };
    if (words.length > NEWS.maxText) return { ok: false, why: `Keep it under ${NEWS.maxText} letters.` };
    if (LINK.test(words) || LINK.test(called)) return { ok: false, why: 'No links or addresses here.' };
    if (NOT_SAID.test(words) || NOT_SAID.test(called)) return { ok: false, why: 'Not that. Say it another way.' };
    for (const k of [who, address]) {
      if (this.often(this.wrote, k, now, 86_400_000, NEWS.perDay, NEWS.everyMs)) return { ok: false, why: 'Give it a moment before the next one.' };
    }
    // (the same words under the same entry, twice running, are said once)
    const last = [...this.comments].reverse().find((c) => c.entry === entry);
    if (last && last.by === who && last.text === words) return { ok: false, why: 'You have just said that.' };
    for (const k of [who, address]) this.wrote.get(k)!.push(now);
    const c: Comment = { id: this.next++, entry, name: called, text: words, at: now, by: who };
    this.comments.push(c);
    this.trim();
    this.dirty = true;
    return { ok: true, comment: { id: c.id, name: c.name, text: c.text, at: c.at, mine: true } };
  }

  /** A comment taken down: by an admin, or by whoever wrote it. @param by only if it is this browser's own */
  remove(id: number, by?: string): boolean {
    const i = this.comments.findIndex((c) => c.id === id && (by === undefined || c.by === by));
    if (i < 0) return false;
    this.comments.splice(i, 1);
    this.dirty = true;
    return true;
  }

  /** the newest of what was said: for an admin to look down */
  latest(n = 12): Comment[] {
    return this.comments.slice(-n);
  }

  private trim() {
    const per = new Map<string, number>();
    for (const c of this.comments) per.set(c.entry, (per.get(c.entry) ?? 0) + 1);
    // (the oldest of an entry that has too many go, and then the oldest of all)
    this.comments = this.comments.filter((c) => {
      const n = per.get(c.entry)!;
      if (n <= NEWS.perEntry) return true;
      per.set(c.entry, n - 1);
      return false;
    });
    if (this.comments.length > NEWS.inAll) this.comments.splice(0, this.comments.length - NEWS.inAll);
  }

  keep(): NewsKept {
    return { next: this.next, hearts: [...this.hearts].filter(([, s]) => s.size).map(([e, s]) => [e, [...s]]), comments: this.comments };
  }

  /** What was kept, taken in again: whatever of it can be made sense of. */
  restore(k: unknown) {
    const kept = k as Partial<NewsKept> | null | undefined;
    if (!kept || typeof kept !== 'object') return;
    this.hearts.clear();
    for (const h of Array.isArray(kept.hearts) ? kept.hearts : []) {
      if (!Array.isArray(h) || typeof h[0] !== 'string' || !ENTRY.test(h[0]) || !Array.isArray(h[1])) continue;
      this.hearts.set(h[0], new Set(h[1].filter((b): b is string => typeof b === 'string' && MARK.test(b))));
    }
    this.comments = (Array.isArray(kept.comments) ? kept.comments : []).filter(
      (c): c is Comment => !!c && Number.isInteger(c.id) && typeof c.entry === 'string' && ENTRY.test(c.entry) && typeof c.name === 'string' && typeof c.text === 'string' && Number.isFinite(c.at) && typeof c.by === 'string',
    );
    this.next = Math.max(Number.isInteger(kept.next) ? kept.next! : 1, ...this.comments.map((c) => c.id + 1), 1);
    this.trim();
    this.dirty = false;
  }
}
