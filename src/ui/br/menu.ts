// The battle royale's own front (2026-10-21): solos, duos or squads; find a match, host a lobby for friends, or join one
// by its code; the board. It stands in for the Zone's start screen on a /br page, as the Arena's menu does on /arena
// (src/ui/arena-menu.ts), and goes in the same way: the match put in the page's address, the name given, and Deploy
// pressed (src/net/client.ts, wagerQuery: the battle royale is `?wager=br` at the arena's door).
import './br.css';
import { arenaBase } from '../../net/client';
import { MAPS, TEAM, type BrMode } from '../../../arena/br/rules';
import type { HUD } from '../hud';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class BrMenu {
  private el: HTMLDivElement;
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private mode: BrMode = 'solo';

  constructor(private hud: HUD, private map: number) {
    document.body.classList.add('br-mode');
    try {
      const m = localStorage.getItem('zona-br-mode');
      if (m === 'solo' || m === 'duo' || m === 'squad') this.mode = m;
    } catch {
      /* not kept */
    }
    this.el = document.createElement('div');
    this.el.id = 'br-menu';
    this.el.innerHTML = `
      <header class="bm-bar"><span class="bm-logo">BATTLE <span>ROYALE</span></span><a class="bm-door" href="/">All games</a></header>
      <div class="bm-main">
        <div class="bm-play">
          <div class="bm-map">Map: <b>${MAPS[map].name}</b> <small>a map at random each match</small></div>
          <label class="bm-name">Name <input maxlength="24" spellcheck="false"></label>
          <div class="bm-modes">${(['solo', 'duo', 'squad'] as const).map((m) => `<button data-m="${m}">${m.toUpperCase()}<small>${TEAM[m] === 1 ? 'every player for themselves' : `teams of ${TEAM[m]}`}</small></button>`).join('')}</div>
          <button class="bm-go">FIND MATCH</button>
          <div class="bm-more"><button class="bm-host">Host a lobby</button><span class="bm-join"><input placeholder="CODE" maxlength="4"><button>Join</button></span></div>
          <p class="bm-how">Up to 30 in a lobby; fight in the waiting area while it fills, and vote to start. Jump from the plane, find guns, armour and heals, and be the last standing as the gas closes in. <b>1-6</b> slots · <b>F</b> take / revive · <b>G</b> drop · <b>V</b> vote.</p>
        </div>
        <div class="bm-board"><h3>Leaderboard</h3><div class="bm-rows">…</div></div>
      </div>
      <div class="bm-wait"><b>Joining…</b><span class="bm-wait-text"></span></div>
      <div class="bm-pause"><b>Paused</b><span>The match goes on without you.</span><button class="bm-resume">Resume</button><button class="bm-pause-set">Settings</button><button class="bm-leave">Leave the match</button><div class="bm-set-host"></div></div>`;
    // (inside the HUD, so that the settings it lends stay in it: HUD.settingsInto, as the Arena's menu)
    hud.root.appendChild(this.el);
    this.q<HTMLInputElement>('.bm-name input').value = hud.nameValue();
    this.drawMode();
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.m) {
        this.mode = b.dataset.m as BrMode;
        try {
          localStorage.setItem('zona-br-mode', this.mode);
        } catch {
          /* not kept */
        }
        return this.drawMode();
      }
      // (the pause in a match: back in, the Zone's own settings, or out of it)
      if (b.classList.contains('bm-resume')) return this.hud.deploy();
      if (b.classList.contains('bm-pause-set')) {
        const on = !this.el.classList.contains('pset');
        this.el.classList.toggle('pset', on);
        return this.hud.settingsInto(on ? this.q<HTMLElement>('.bm-set-host') : null);
      }
      if (b.classList.contains('bm-leave')) return location.assign('/battleroyale');
      if (b.classList.contains('bm-go')) return this.go('find');
      if (b.classList.contains('bm-host')) return this.go('host');
      if (b.closest('.bm-join')) {
        const code = this.q<HTMLInputElement>('.bm-join input').value.trim().toUpperCase();
        if (/^[A-Z]{4}$/.test(code)) this.go(code);
      }
    });
    this.hud.onStartShown = (on, paused, text) => {
      // (over, or out: the end has its own way on, and the mouse let go for it is no pause)
      if (document.querySelector('#hud .br-hud.ended')) on = false;
      this.el.classList.toggle('show', on);
      this.el.classList.toggle('paused', on && paused);
      this.el.classList.toggle('waiting', on && !paused && !!text);
      this.q('.bm-wait-text').textContent = text;
      if (!(on && paused) && this.el.classList.contains('pset')) {
        this.el.classList.remove('pset');
        this.hud.settingsInto(null);
      }
    };
    const start = document.querySelector('#hud .hud-start');
    if (start?.classList.contains('show')) this.el.classList.add('show');
    void this.board();
  }

  private drawMode() {
    for (const b of this.el.querySelectorAll<HTMLElement>('.bm-modes button')) b.classList.toggle('on', b.dataset.m === this.mode);
  }

  private async board() {
    try {
      const r = (await (await fetch(`${arenaBase()}/battleroyale/board`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })).json()) as { players: { name: string; wins: number; kills: number; matches: number }[] };
      this.q('.bm-rows').innerHTML = r.players.length ? r.players.slice(0, 10).map((p, k) => `<div><b>${k + 1}</b><span>${esc(p.name)}</span><em>${p.wins} wins · ${p.kills} kills</em></div>`).join('') : '<p>No matches played yet: be the first winner.</p>';
    } catch {
      this.q('.bm-rows').textContent = 'The board could not be reached.';
    }
  }

  /** into a lobby: put in the page's address, the name given, and Deploy pressed as the Zone presses it */
  private go(how: string) {
    const name = this.q<HTMLInputElement>('.bm-name input').value.trim();
    if (name) this.hud.setName(name);
    history.replaceState(null, '', `/battleroyale?${new URLSearchParams({ wager: 'br', size: String(TEAM[this.mode]), kills: String(this.map), loadout: how })}`);
    this.hud.deploy();
  }
}
