// The door (2026-10-14): zonapvp.fun asks what the visitor came for before anything is built. The owner: "now that we
// have two menu paths instead of serving them both from the main menu perhaps we ask the visitor which game mode
// they are here for", and "we should keep both paths seperate on this account and pretend they are 2 completely
// different games and ecoststems ... the entire ecosysrtem is umbrellad together". So: ZONA PvP over both, what the
// platform has paid, and the two games side by side; the one picked last is lit. /zona and /arena go straight in.
import './door.css';
import { paidLine, platformPaid } from './platform';
import { TAG_HOLD_MIN } from '../sim/items';
import { arenaBase, serverSays, serverStatus } from '../net/client';
import type { LobbyInfo } from '../../arena/rules';

export type Mode = 'zona' | 'arena';

const LAST = 'zona-last-game';

/** the door, until a game is picked */
export function openDoor(): Promise<Mode> {
  let last: Mode | null = null;
  try {
    const v = localStorage.getItem(LAST);
    last = v === 'zona' || v === 'arena' ? v : null;
  } catch {
    /* no storage: nothing is lit */
  }
  const el = document.createElement('div');
  el.id = 'door';
  el.innerHTML = `
    <div class="door-in">
      <header class="door-top">
        <img src="/brand/zona-mark-live.svg" alt="" width="44" height="44"><b>ZONA <em>PvP</em></b><img class="door-season" src="/brand/season.svg" alt="">
      </header>
      <div class="door-pvp">Player <i>vs</i> Player</div>
      <div class="door-paid" hidden></div>
      <div class="door-stats"><span data-s="tags" hidden></span><span data-s="today" hidden></span><span data-s="matches" hidden></span><span data-s="squad"></span></div>
      <div class="door-cards">
        <button type="button" class="door-card zona${last === 'zona' ? ' last' : ''}" data-mode="zona">
          <i class="door-bg"></i>
          ${last === 'zona' ? '<span class="door-last">Last played</span>' : ''}
          <span class="door-what"><em>PvP</em> Open-world survival</span><span class="door-on" data-on="zona" hidden></span>
          <b>ZONA</b>
          <span class="door-say">Loot, survive, and kill other players. Take a dog tag from a player you kill, hold it ${TAG_HOLD_MIN} minutes, and get paid in SOL.</span>
          <span class="door-go">Enter Zona</span>
        </button>
        <button type="button" class="door-card arena${last === 'arena' ? ' last' : ''}" data-mode="arena">
          <i class="door-bg"></i>
          ${last === 'arena' ? '<span class="door-last">Last played</span>' : ''}
          <span class="door-stamp">Wagers<small>Coming soon</small></span>
          <span class="door-what"><em>PvP</em> Team matches</span><span class="door-on" data-on="arena" hidden></span>
          <b>ARENA</b>
          <span class="door-say">Players against players, team against team at the fort, in rounds. Set loadouts, first to 3, 5 or 10. Watch any match being played.</span>
          <span class="door-go">Enter Arena</span>
        </button>
      </div>
      <footer class="door-foot"><a href="/changelog/" target="_blank" rel="noopener">Changelog</a><a href="/payouts" target="_blank" rel="noopener">Payouts</a><span class="door-upd" hidden></span></footer>
    </div>`;
  document.body.appendChild(el);
  // (how long ago this build of the site was made, on a computer: the owner, 2026-10-15, "for pc add last updated n(time) ago")
  const upd = el.querySelector('.door-upd') as HTMLElement;
  const ago = () => {
    const built = Date.parse(__BUILT__), m = Math.max(0, Math.round((Date.now() - built) / 60_000));
    if (!Number.isFinite(built)) return;
    upd.textContent = `Last updated ${m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`}`;
    upd.hidden = false;
    if (el.isConnected) setTimeout(ago, 60_000);
  };
  ago();
  // (true numbers, each from where it is kept, each left out where it cannot be had: the owner, offered these in
  // place of fake players to fill the count, "do 1 2 and 3")
  const stat = (s: string, text: string) => {
    const t = el.querySelector(`[data-s="${s}"]`) as HTMLElement;
    t.textContent = text;
    t.hidden = false;
  };
  void platformPaid().then((p) => {
    if (!p) return;
    const n = el.querySelector('.door-paid') as HTMLElement;
    n.textContent = paidLine(p);
    n.hidden = false;
    if (p.paid > 0) stat('tags', `${p.paid} dog tags paid`);
  });
  // (how many are in each game now, as its own server says it; under a handful it says only that the game is up;
  // nothing said where it does not answer)
  const on = (mode: Mode, n: number | null) => {
    const t = el.querySelector(`[data-on="${mode}"]`) as HTMLElement;
    if (n === null) return;
    t.textContent = n >= LIVE_FROM ? `${n} online` : 'Live now';
    t.hidden = false;
  };
  void serverStatus(8000).then((st) => {
    on('zona', st ? st.players : null);
    if (st?.today) stat('today', `${st.today} played Zona today`);
  });
  void arenaOnline().then((a) => {
    on('arena', a ? a.players : null);
    if (a?.matches) stat('matches', `${a.matches} Arena ${a.matches === 1 ? 'match' : 'matches'} on now`);
  });
  // (squad hour: when everybody is asked to come at once, said in the visitor's own time)
  const squad = () => stat('squad', squadLine(Date.now()));
  squad();
  const tick = setInterval(() => (el.isConnected ? squad() : clearInterval(tick)), 30_000);
  return new Promise((done) => {
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-mode]') as HTMLElement | null;
      if (!b) return;
      const mode = b.dataset.mode as Mode;
      try {
        localStorage.setItem(LAST, mode);
      } catch {
        /* not kept */
      }
      el.classList.add('going', mode);
      setTimeout(() => el.remove(), 450);
      done(mode);
    });
  });
}

/** this page's game, by its address: /arena or a wager is the Arena, /zona or any switch on the address is the Zone (development and test pages), and the bare site asks (null) */
export function modeOf(wager: boolean): Mode | null {
  const path = location.pathname.replace(/\/+$/, '');
  if (wager || path === '/arena') return 'arena';
  if (path === '/zona' || location.search.length > 1) return 'zona';
  return null;
}

/** how many are in the Arena now (its own count, or, from an arena older than that, everybody in its matches and watching them), and how many matches are being played */
async function arenaOnline(): Promise<{ players: number; matches: number } | null> {
  try {
    const h = (await serverSays<{ players?: number }>(arenaBase(), 20_000)) ?? {};
    const l = (await (await fetch(`${arenaBase()}/arena/lobbies`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })).json()) as { lobbies: LobbyInfo[] };
    const matches = l.lobbies.filter((x) => x.score).length;
    return { players: typeof h.players === 'number' ? h.players : l.lobbies.reduce((n, x) => n + x.have + (x.watching ?? 0), 0), matches };
  } catch {
    return null;
  }
}

/** under this many in a game, its card says it is live and not how many (the owner: "do 1"): a count that small says empty, not live */
const LIVE_FROM = 5;

/**
 * Squad hour: one hour a day when everybody is asked to come, so the servers fill for real (the owner: "do 1 2 and
 * 3"). 01:00 UTC: 9 PM on the US east coast, 6 PM on the west. Said in the visitor's own time.
 */
export const SQUAD_UTC = 1;

/** "Squad hour: daily at 9:00 PM your time, in 3 h 12 m", or that it is on now */
export function squadLine(now: number): string {
  const d = new Date(now), start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), SQUAD_UTC);
  const today = now < start ? start - 24 * 3600_000 : start;
  if (now - today < 3600_000) return `Squad hour is on now, till ${new Date(today + 3600_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const next = today + 24 * 3600_000, left = Math.max(0, next - now), h = Math.floor(left / 3600_000), m = Math.floor((left % 3600_000) / 60_000);
  return `Squad hour daily at ${new Date(next).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} your time, in ${h ? `${h} h ` : ''}${m} m`;
}
