// Client side of the game connection. If no server answers (static hosting with no
// server configured, or the dev server running on its own) the game plays offline.

import { PROTOCOL, type C2S, type S2C } from './protocol';
import { deviceId } from './device';

type Handler<T extends S2C['t']> = (m: Extract<S2C, { t: T }>) => void;
type Welcome = Extract<S2C, { t: 'welcome' }>;

const KEY_STORE = 'zona.player.key';
const NAME_STORE = 'zona.player.name';

/**
 * Address of a game server on another host (`?server=https://…` or VITE_SERVER_URL at
 * build time, e.g. the client on Vercel and the server on Render). Null when the game
 * server is the host that served this page.
 */
export function remoteServer(): string | null {
  const q = new URLSearchParams(location.search).get('server');
  const env = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL;
  const base = (q || env || '').trim().replace(/\/ws$/, '').replace(/\/$/, '');
  if (!base) return null;
  try {
    if (new URL(base).host === location.host) return null;
  } catch {
    return null;
  }
  return base;
}

/**
 * The wager this page is for, as the arena asks it (arena/rules.ts, arena/match.ts): `?wager=new` with what the
 * host chose (size, kills, loadout, stake) to open one, `?wager=<id>` to join one, and `&watch=1` to watch it being
 * played. Null: the open world.
 */
export function wagerQuery(): string | null {
  const q = new URLSearchParams(location.search), w = q.get('wager');
  if (!w) return null;
  const out = new URLSearchParams({ w });
  for (const k of ['size', 'kills', 'loadout', 'stake', 'watch']) if (q.get(k)) out.set(k, q.get(k)!);
  return out.toString();
}

/** whether this page only watches a wager */
export const watching = () => !!wagerQuery() && new URLSearchParams(location.search).has('watch');

/**
 * Where the wager arena is (arena/server.ts, a service of its own): `?arena=` on the page, or VITE_ARENA_URL when
 * the site is built (set in Vercel); on a development page its own host, which sends /arena on to the local arena
 * (8090); else the arena's Render address. '' is this page's own host.
 */
export function arenaBase(): string {
  const env = (import.meta as { env?: { VITE_ARENA_URL?: string; DEV?: boolean } }).env;
  const q = new URLSearchParams(location.search).get('arena');
  return (q || env?.VITE_ARENA_URL || (env?.DEV ? '' : 'https://zona-arena-1.onrender.com')).trim().replace(/\/$/, '');
}

/** the wager is over (or was never there to join): the page is the open world's again */
export function leaveWager() {
  const q = new URLSearchParams(location.search);
  for (const k of ['wager', 'size', 'kills', 'loadout', 'stake']) q.delete(k);
  history.replaceState(null, '', `${location.pathname}${q.toString() ? '?' + q : ''}${location.hash}`);
}

function wsUrl(): string {
  const here = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  // (a wager is fought in the arena, a server of its own)
  const wager = wagerQuery();
  if (wager) return `${arenaBase() ? arenaBase().replace(/^http/, 'ws') : here}/arena?${wager}`;
  const remote = remoteServer();
  return `${remote ? remote.replace(/^http/, 'ws') : here}/ws`;
}

/** How many people are on the server right now, how many it holds and how many are waiting to get in (for the start screen). Null if it can't be reached. */
export async function serverStatus(timeout = 6000): Promise<{ players: number; max: number; queue: number; today: number | null } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`${remoteServer() ?? ''}/healthz`, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { players?: number; max?: number; queue?: number; today?: number };
    // (today: how many have played in the last 24 hours; null from a server older than its count)
    return typeof j.players === 'number' ? { players: j.players, max: j.max ?? 0, queue: j.queue ?? 0, today: typeof j.today === 'number' ? j.today : null } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The key to ask the check that this is a person with (src/ui/person.ts), where the server is set up to ask it;
 * '' where it is not, or cannot be asked just now (it then says so itself when it turns the game away).
 */
export async function personKey(timeout = 5000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`${remoteServer() ?? ''}/healthz`, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) return '';
    const j = (await r.json()) as { captchaKey?: unknown };
    return typeof j.captchaKey === 'string' ? j.captchaKey : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

export function playerName(): string {
  try {
    return localStorage.getItem(NAME_STORE) ?? '';
  } catch {
    return '';
  }
}

export function setPlayerName(name: string) {
  try {
    localStorage.setItem(NAME_STORE, name);
  } catch {
    /* private mode */
  }
}

let key = '';

/** stable anonymous identity so the server can give you your character back after a reconnect */
function playerKey(): string {
  key ||= readKey();
  return key;
}

/**
 * Short public id derived from the private key. It is stamped on this player's dog tag,
 * so everyone can tell whose tag it is without learning the key itself.
 */
export function publicId(): string {
  const k = playerKey();
  let a = 2166136261, b = 5381;
  for (let i = 0; i < k.length; i++) {
    a = Math.imul(a ^ k.charCodeAt(i), 16777619);
    b = (Math.imul(b, 33) ^ k.charCodeAt(i)) | 0;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

function readKey(): string {
  try {
    // ?key= lets two tabs on one machine be two different players (testing)
    const q = new URLSearchParams(location.search).get('key');
    if (q) return q.padEnd(8, '0');
    let k = localStorage.getItem(KEY_STORE);
    if (!k) {
      k = crypto.randomUUID();
      localStorage.setItem(KEY_STORE, k);
    }
    return k;
  } catch {
    return crypto.randomUUID();
  }
}

export class Net {
  online = false;
  id = 0;
  /** round-trip time in ms */
  ping = 0;
  private ws: WebSocket | null = null;
  private handlers = new Map<string, ((m: S2C) => void)[]>();
  /**
   * What the server has said since it let this game in, kept until the game says it is listening (`listen`).
   *
   * A game takes its welcome, puts the world the welcome describes together, and only then says what it does with
   * each kind of message. Putting it together WAITS, for one thing on the model of every stash in the world, and
   * since models are fetched when first wanted (2026-10-11) that is a wait on the network of up to some seconds.
   * Everything the server said meanwhile fell on nobody and was gone: "you are an admin" and an admin's powers,
   * said in the same breath as the welcome ("my admin status is not loading properly and i have to reenter my
   * admin password every time", 2026-10-13); and for everybody the board, whoever came in or left, whatever was
   * picked up, put down, opened or shut in those seconds: a world a little out of step with everybody else's
   * until something put it right. Null: nothing is being kept, and a message goes straight to whoever listens.
   */
  private held: S2C[] | null = null;
  private heldTill: ReturnType<typeof setTimeout> | null = null;
  private pingT = 0;
  private kicked = '';
  private kickedV: number | undefined;
  private proofKey = '';
  /** turned away for want of the check that this is a person: the key the server said to ask for it with (see src/ui/person.ts) */
  get wantsProof() {
    return this.online ? '' : this.proofKey;
  }
  /** why the server turned us away before we got in (full, outdated client) */
  get refused() {
    return this.online ? '' : this.kicked;
  }
  /** turned away for being of another version than the server (a server from before it said which it is says so in words) */
  get outdated() {
    return !this.online && !!this.kicked && (this.kickedV !== undefined ? this.kickedV !== PROTOCOL : /updated/i.test(this.kicked));
  }
  onClose: (reason: string) => void = () => {};
  /**
   * The server is full and we are waiting in line for it: our place (1 = next), how many are
   * waiting, how many the server holds. Called again whenever the line moves. connect()
   * answers with the welcome when our turn comes, however long that takes.
   */
  onQueue: (pos: number, of: number, max: number) => void = () => {};
  private left = false;
  /** the player gave up their place in the line */
  get leftQueue() {
    return this.left;
  }

  /** Give up the place in the line: connect() then answers null. */
  leaveQueue() {
    this.left = true;
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
  }

  on<T extends S2C['t']>(t: T, h: Handler<T>) {
    if (!this.handlers.has(t)) this.handlers.set(t, []);
    this.handlers.get(t)!.push(h as (m: S2C) => void);
  }

  /**
   * Resolves with the welcome message, or null when there is no server to play on.
   * A server on a free host sleeps when nobody is around: `onStatus` reports the wait
   * while it wakes up (the first request can take a minute).
   */
  async connect(name: string, onStatus: (text: string) => void = () => {}, proof = ''): Promise<Welcome | null> {
    // (asked again after being turned away: what was said then is not what is said now)
    this.kicked = '';
    this.kickedV = undefined;
    this.proofKey = '';
    // (the server asked first, which wakes one that sleeps: the arena on a free plan does, after fifteen quiet minutes)
    const remote = wagerQuery() ? arenaBase() || null : remoteServer();
    if (remote) {
      // any answer at all means it is awake; the request itself is what wakes it
      const slow = setTimeout(() => onStatus('Waking the server… this can take a minute'), 3500);
      const ctl = new AbortController();
      const giveUp = setTimeout(() => ctl.abort(), 90_000);
      try {
        await fetch(`${remote}/healthz`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
      } catch {
        clearTimeout(slow);
        clearTimeout(giveUp);
        return null;
      }
      clearTimeout(slow);
      clearTimeout(giveUp);
      onStatus('Connecting…');
    }
    const timeout = remote ? 12_000 : 4000;
    this.left = false;
    // (the device this game runs on, said with hello: made once, a few tens of ms the first time)
    const fp = await deviceId();
    const first = await this.open(name, timeout, proof, fp);
    if (first || this.kicked || this.left) return first;
    // one more try: a proxy or a server that has only just started can drop the first connection
    await new Promise((r) => setTimeout(r, 400));
    return this.open(name, timeout, proof, fp);
  }

  private open(name: string, timeout: number, proof = '', fp = ''): Promise<Welcome | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: Welcome | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => {
        try {
          this.ws?.close();
        } catch {
          /* already closed */
        }
        done(null);
      }, timeout);
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        done(null);
        return;
      }
      this.ws = ws;
      ws.onopen = () => this.send({ t: 'hello', v: PROTOCOL, key: playerKey(), name, ...(proof ? { proof } : {}), ...(fp ? { fp } : {}) });
      ws.onerror = () => done(null);
      ws.onclose = () => {
        const was = this.online;
        this.online = false;
        done(null);
        if (was) this.onClose(this.kicked || 'Connection to the server was lost.');
      };
      ws.binaryType = 'arraybuffer';
      ws.onmessage = (e) => {
        // (what is not words is somebody's speech)
        if (typeof e.data !== 'string') return void this.onVoice(e.data as ArrayBuffer);
        let m: S2C;
        try {
          m = JSON.parse(e.data as string);
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          this.online = true;
          this.id = m.you;
          // (one a page: a second match in the Arena is a second connection, not a second clock)
          clearInterval(this.pingT);
          this.pingT = setInterval(() => this.send({ t: 'ping', n: performance.now() }), 4000) as unknown as number;
          // (from this word on, what is said is kept for the game until it listens)
          this.held = [];
          if (this.heldTill) clearTimeout(this.heldTill);
          // (never for ever: a game that has not said so in half a minute is handed what there is, as it used to be)
          this.heldTill = setTimeout(() => this.listen(), 30_000);
          done(m);
          return;
        }
        if (m.t === 'queue') {
          // in line: there is no giving up on a slow answer now, the welcome comes when it comes
          clearTimeout(timer);
          this.onQueue(m.pos, m.of, m.max);
          return;
        }
        // (on the bot check's range: the welcome comes when it is passed, however long that takes)
        if (m.t === 'range') clearTimeout(timer);
        if (m.t === 'kick') {
          // (out of a wager, whatever the reason: the next Deploy is into the open world)
          if (wagerQuery()) leaveWager();
          this.kicked = m.reason;
          this.kickedV = m.v;
          this.proofKey = typeof m.captcha === 'string' ? m.captcha : '';
        }
        if (m.t === 'pong') {
          this.ping = Math.round(performance.now() - m.n);
          return;
        }
        if (this.held) return void this.held.push(m);
        this.hand(m);
      };
    });
  }

  private hand(m: S2C) {
    const hs = this.handlers.get(m.t);
    if (hs) for (const h of hs) h(m);
  }

  /** The game is listening: everything the server has said since the welcome is handed over, in the order it was said. See `held`. */
  listen() {
    if (this.heldTill) clearTimeout(this.heldTill);
    this.heldTill = null;
    const held = this.held;
    this.held = null;
    if (held) for (const m of held) this.hand(m);
  }

  send(m: C2S) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** a piece of the player's own speech, to be passed on to whoever is near */
  sendVoice(piece: Uint8Array) {
    if (this.online && this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(piece as Uint8Array<ArrayBuffer>);
  }
  /** a piece of somebody else's, from the server */
  onVoice: (packet: ArrayBuffer) => void = () => {};
}
