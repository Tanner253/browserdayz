// Client side of the game connection. If no server answers (static hosting with no
// server configured, or the dev server running on its own) the game plays offline.

import { PROTOCOL, type C2S, type S2C } from './protocol';

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

function wsUrl(): string {
  const remote = remoteServer();
  if (remote) return remote.replace(/^http/, 'ws') + '/ws';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** How many people are on the server right now (for the start screen). Null if it can't be reached. */
export async function serverStatus(timeout = 6000): Promise<{ players: number } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`${remoteServer() ?? ''}/healthz`, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { players?: number };
    return typeof j.players === 'number' ? { players: j.players } : null;
  } catch {
    return null;
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
  private kicked = '';
  /** why the server turned us away before we got in (full, outdated client) */
  get refused() {
    return this.online ? '' : this.kicked;
  }
  onClose: (reason: string) => void = () => {};

  on<T extends S2C['t']>(t: T, h: Handler<T>) {
    if (!this.handlers.has(t)) this.handlers.set(t, []);
    this.handlers.get(t)!.push(h as (m: S2C) => void);
  }

  /**
   * Resolves with the welcome message, or null when there is no server to play on.
   * A server on a free host sleeps when nobody is around: `onStatus` reports the wait
   * while it wakes up (the first request can take a minute).
   */
  async connect(name: string, onStatus: (text: string) => void = () => {}): Promise<Welcome | null> {
    const remote = remoteServer();
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
    const first = await this.open(name, timeout);
    if (first || this.kicked) return first;
    // one more try: a proxy or a server that has only just started can drop the first connection
    await new Promise((r) => setTimeout(r, 400));
    return this.open(name, timeout);
  }

  private open(name: string, timeout: number): Promise<Welcome | null> {
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
      ws.onopen = () => this.send({ t: 'hello', v: PROTOCOL, key: playerKey(), name });
      ws.onerror = () => done(null);
      ws.onclose = () => {
        const was = this.online;
        this.online = false;
        done(null);
        if (was) this.onClose(this.kicked || 'Connection to the server was lost.');
      };
      ws.onmessage = (e) => {
        let m: S2C;
        try {
          m = JSON.parse(e.data as string);
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          this.online = true;
          this.id = m.you;
          setInterval(() => this.send({ t: 'ping', n: performance.now() }), 4000);
          done(m);
          return;
        }
        if (m.t === 'kick') this.kicked = m.reason;
        if (m.t === 'pong') {
          this.ping = Math.round(performance.now() - m.n);
          return;
        }
        const hs = this.handlers.get(m.t);
        if (hs) for (const h of hs) h(m);
      };
    });
  }

  send(m: C2S) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
