// Client side of the game connection. If no server answers (static hosting, or the
// dev server running on its own) the game simply plays offline.

import { PROTOCOL, type C2S, type S2C } from './protocol';

type Handler<T extends S2C['t']> = (m: Extract<S2C, { t: T }>) => void;

const KEY_STORE = 'zona.player.key';
const NAME_STORE = 'zona.player.name';

/** where the game server lives: same host by default, `?server=wss://…` or VITE_SERVER_URL to point elsewhere */
function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  const env = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL;
  const base = q || env;
  if (base) return base.replace(/^http/, 'ws').replace(/\/$/, '') + (base.endsWith('/ws') ? '' : '/ws');
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
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

/** stable anonymous identity so the server can give you your character back after a reconnect */
function playerKey(): string {
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
  onClose: (reason: string) => void = () => {};

  on<T extends S2C['t']>(t: T, h: Handler<T>) {
    if (!this.handlers.has(t)) this.handlers.set(t, []);
    this.handlers.get(t)!.push(h as (m: S2C) => void);
  }

  /** Resolves with the welcome message, or null when there is no server to play on. */
  connect(name: string, timeout = 4000): Promise<Extract<S2C, { t: 'welcome' }> | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: Extract<S2C, { t: 'welcome' }> | null) => {
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
        ws = new WebSocket(serverUrl());
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
          this.startPing();
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

  private kicked = '';

  private startPing() {
    setInterval(() => this.send({ t: 'ping', n: performance.now() }), 4000);
  }

  send(m: C2S) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
