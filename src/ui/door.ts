// The door (2026-10-14): zonapvp.fun asks what the visitor came for before anything is built. The owner: "now that we
// have two menu paths instead of serving them both from the main menu perhaps we ask the visitor which game mode
// they are here for", and "we should keep both paths seperate on this account and pretend they are 2 completely
// different games and ecoststems ... the entire ecosysrtem is umbrellad together". So: ZONA PvP over both, and the
// games side by side; the one picked last is lit. /zona and /arena go straight in.
import './door.css';
import { DISCORD, discordBtn } from './discord';
import { TAG_HOLD_MIN } from '../sim/items';
import { arenaBase, serverSays, serverStatus } from '../net/client';
import type { LobbyInfo } from '../../arena/rules';

export type Mode = 'zona' | 'arena' | 'br';

const LAST = 'zona-last-game';

/** the door, until a game is picked */
export function openDoor(): Promise<Mode> {
  let last: Mode | null = null;
  try {
    const v = localStorage.getItem(LAST);
    last = v === 'zona' || v === 'arena' || v === 'br' ? v : null;
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
      <div class="door-stats"><span data-s="matches" hidden></span></div>
      <div class="door-cards three">
        <button type="button" class="door-card zona${last === 'zona' ? ' last' : ''}" data-mode="zona">
          <i class="door-bg"></i>
          ${last === 'zona' ? '<span class="door-last">Last played</span>' : ''}
          <span class="door-what"><em>PvP</em> Open-world survival</span><span class="door-on" data-on="zona" hidden></span>
          <b>ZONA</b>
          <span class="door-say">Loot, survive, and kill other players. Take a dog tag from a player you kill and hold it ${TAG_HOLD_MIN} minutes.</span>
          <span class="door-go">Enter Zona</span>
        </button>
        <button type="button" class="door-card arena${last === 'arena' ? ' last' : ''}" data-mode="arena">
          <i class="door-bg"></i>
          ${last === 'arena' ? '<span class="door-last">Last played</span>' : ''}
          <span class="door-what"><em>PvP</em> Team matches</span><span class="door-on" data-on="arena" hidden></span>
          <b>ARENA</b>
          <span class="door-say">Players against players, team against team at the fort, in rounds. Set loadouts, first to 3, 5 or 10. Watch any match being played.</span>
          <span class="door-go">Enter Arena</span>
        </button>
        <button type="button" class="door-card br${last === 'br' ? ' last' : ''}" data-mode="br">
          <i class="door-bg"></i>
          ${last === 'br' ? '<span class="door-last">Last played</span>' : ''}
          <span class="door-stamp">New<small>Free to play</small></span>
          <span class="door-what"><em>PvP</em> Battle royale</span><span class="door-on" data-on="br" hidden></span>
          <b>BATTLE ROYALE</b>
          <span class="door-say">Up to 30 drop from the sky. Solos, duos or squads: loot, fight, and be the last standing as the gas closes in.</span>
          <span class="door-go">Enter Battle Royale</span>
        </button>
      </div>
      <div class="door-corner"><button type="button" class="store-btn door-store">Store</button>${discordBtn()}</div>
      <footer class="door-foot"><a href="/store" class="door-storelink">Store</a><a href="${DISCORD}" class="door-discordlink" target="_blank" rel="noopener noreferrer">Discord</a><a href="/changelog/" target="_blank" rel="noopener">Changelog</a><a href="/games-like-dayz/" target="_blank" rel="noopener">About ZONA</a><a href="/privacy/" target="_blank" rel="noopener">Privacy</a><span class="door-upd" hidden></span></footer>
    </div>`;
  document.body.appendChild(el);
  // (the store, over the door: from its button, its link, or an address of its own, /store)
  const store = (e?: Event) => (e?.preventDefault(), void import('./store/panel').then((m) => m.openStore()));
  for (const b of el.querySelectorAll('.door-store, .door-storelink')) b.addEventListener('click', store);
  if (location.pathname.replace(/\/+$/, '') === '/store') store();
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
  // (how many are in each game now, as its own server says it; under a handful it says only that the game is up;
  // nothing said where it does not answer)
  const on = (mode: Mode, n: number | null) => {
    const t = el.querySelector(`[data-on="${mode}"]`) as HTMLElement;
    if (n === null) return;
    // (the two arcade modes say how many are in them whenever anybody is, so that a visitor goes where the others are:
    // the owner, 2026-10-21, "the main menu on front end needs to say how many players in arena and battleroyale if any")
    if (mode !== 'zona') {
      if (n > 0) (t.textContent = `${n} playing`), (t.hidden = false);
      return;
    }
    t.textContent = n >= LIVE_FROM ? `${n} online` : 'Live now';
    t.hidden = false;
  };
  void serverStatus(8000).then((st) => {
    on('zona', st ? st.players + st.asleep : null);
  });
  void arenaOnline().then((a) => {
    on('arena', a ? a.players : null);
    on('br', a ? a.br : null);
    if (a?.matches) stat('matches', `${a.matches} Arena ${a.matches === 1 ? 'match' : 'matches'} on now`);
  });
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

/**
 * How a page already built goes to another game as it is (src/game/modes.ts, set once the page is up): `to` a game,
 * `br` the battle royale on a map with its address said (a lobby to go straight into). Unset, a page is loaded.
 */
export const doorGo: { to: ((m: Mode) => void) | null; br: ((map: number, search: string) => void) | null } = { to: null, br: null };

/**
 * The door over a page already built (the owner, 2026-10-21: "take me to main menu without having to reload
 * everything", and "Shouldn't I be able to switch between all modes without refresh"): this page's own game picked
 * again is only the door gone; another is gone to in place (doorGo).
 */
export async function doorOver(here: Mode) {
  const back = location.pathname + location.search;
  history.replaceState(null, '', '/');
  const mode = await openDoor();
  history.replaceState(null, '', back);
  if (mode === here) return;
  if (doorGo.to) doorGo.to(mode);
  else location.assign(`/${mode === 'br' ? 'battleroyale' : mode}`);
}

/** this page's game, by its address: /arena or a wager is the Arena, /zona or any switch on the address is the Zone (development and test pages), and the bare site asks (null) */
export function modeOf(wager: boolean): Mode | null {
  const path = location.pathname.replace(/\/+$/, '');
  if (new URLSearchParams(location.search).get('wager') === 'br' || path === '/battleroyale' || path === '/br') return 'br';
  if (wager || path === '/arena') return 'arena';
  if (path === '/zona' || location.search.length > 1) return 'zona';
  return null;
}

/** how many are in the Arena now (its own count, or, from an arena older than that, everybody in its matches and watching them), and how many matches are being played */
async function arenaOnline(): Promise<{ players: number; matches: number; br: number } | null> {
  try {
    // (the arena's server holds the battle royale too, and counts its players with the Arena's: told apart here)
    const h = (await serverSays<{ players?: number; br?: { players?: number } }>(arenaBase(), 20_000)) ?? {}, br = h.br?.players ?? 0;
    const l = (await (await fetch(`${arenaBase()}/arena/lobbies`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })).json()) as { lobbies: LobbyInfo[] };
    const matches = l.lobbies.filter((x) => x.score).length;
    return { players: typeof h.players === 'number' ? Math.max(0, h.players - br) : l.lobbies.reduce((n, x) => n + x.have + (x.watching ?? 0), 0), matches, br };
  } catch {
    return null;
  }
}

/** under this many in a game, its card says it is live and not how many (the owner: "do 1"): a count that small says empty, not live */
const LIVE_FROM = 5;
