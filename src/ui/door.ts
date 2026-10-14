// The door (2026-10-14): zonapvp.fun asks what the visitor came for before anything is built. The owner: "now that we
// have two menu paths instead of serving them both from the main menu perhaps we ask the visitor which game mode
// they are here for", and "we should keep both paths seperate on this account and pretend they are 2 completely
// different games and ecoststems ... the entire ecosysrtem is umbrellad together". So: ZONA PvP over both, what the
// platform has paid, and the two games side by side; the one picked last is lit. /zona and /arena go straight in.
import './door.css';
import { paidLine, platformPaid } from './platform';
import { TAG_HOLD_MIN } from '../sim/items';

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
        <img src="/brand/zona-mark.svg" alt="" width="44" height="44"><b>ZONA <em>PvP</em></b>
      </header>
      <div class="door-paid" hidden></div>
      <div class="door-cards">
        <button type="button" class="door-card zona${last === 'zona' ? ' last' : ''}" data-mode="zona">
          <i class="door-bg"></i>
          ${last === 'zona' ? '<span class="door-last">Last played</span>' : ''}
          <span class="door-what">Open-world survival</span>
          <b>ZONA</b>
          <span class="door-say">Loot, survive, kill. Take a dog tag from a kill, hold it ${TAG_HOLD_MIN} minutes, and get paid in SOL.</span>
          <span class="door-go">Enter Zona</span>
        </button>
        <button type="button" class="door-card arena${last === 'arena' ? ' last' : ''}" data-mode="arena">
          <i class="door-bg"></i>
          ${last === 'arena' ? '<span class="door-last">Last played</span>' : ''}
          <span class="door-what">Team matches</span>
          <b>ARENA</b>
          <span class="door-say">Team against team at the fort, in rounds. Set loadouts, first to 3, 5 or 10. Watch any match being played.</span>
          <span class="door-go">Enter Arena</span>
        </button>
      </div>
      <footer class="door-foot"><a href="/changelog/" target="_blank" rel="noopener">Changelog</a><a href="/payouts" target="_blank" rel="noopener">Payouts</a></footer>
    </div>`;
  document.body.appendChild(el);
  void platformPaid().then((p) => {
    if (!p) return;
    const n = el.querySelector('.door-paid') as HTMLElement;
    n.textContent = paidLine(p);
    n.hidden = false;
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

/** this page's game, by its address: /arena or a wager is the Arena, /zona or any switch on the address is the Zone (development and test pages), and the bare site asks (null) */
export function modeOf(wager: boolean): Mode | null {
  const path = location.pathname.replace(/\/+$/, '');
  if (wager || path === '/arena') return 'arena';
  if (path === '/zona' || location.search.length > 1) return 'zona';
  return null;
}
