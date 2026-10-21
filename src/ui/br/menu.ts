// The battle royale's own front (2026-10-21), laid out as the Arena's is (src/ui/arena-menu.ts: a bar of tabs, the play
// panel with a side panel for friends), the owner: "the ui still does not feel good at the main menu". Each mode says
// how many are waiting in its open lobby and how many are in its matches, read from the server every few seconds (the
// owner: "the battle royal menu should say how many players in each mode so the user can pick to play with other
// people"). It stands in for the Zone's start screen on a /battleroyale page and goes in as the Arena's does: the match
// put in the page's address, the name given, and Deploy pressed (src/net/client.ts, wagerQuery: `?wager=br`).
import './br.css';
import { arenaBase } from '../../net/client';
import { MAPS, TEAM, type BrMode } from '../../../arena/br/rules';
import type { HUD } from '../hud';
import { doorGo, doorOver } from '../door';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const MODES: { m: BrMode; name: string; say: string }[] = [
  { m: 'solo', name: 'Solo', say: 'every player for themselves' },
  { m: 'duo', name: 'Duo', say: 'teams of two' },
  { m: 'squad', name: 'Squad', say: 'teams of four' },
];
type Counts = Record<BrMode, { waiting: number; playing: number; map: number | null }>;
type Panel = 'play' | 'how' | 'board' | 'settings';

export class BrMenu {
  private el: HTMLDivElement;
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private mode: BrMode = 'solo';
  private counts: Counts | null = null;
  private listT = 0;
  /** out of the match by the player's own choice (the pause's Leave): the game's to say to the server first */
  onLeave: () => void = () => {};

  /** taken down, another game played on the page (src/game/modes.ts) */
  destroy() {
    clearTimeout(this.listT);
    if (this.el.classList.contains('pset')) this.hud.settingsInto(null);
    this.hud.onStartShown = () => {};
    this.el.remove();
    document.body.classList.remove('br-mode');
  }

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
      <header class="bm-bar">
        <span class="bm-logo">BATTLE <span>ROYALE</span></span>
        <nav class="bm-nav"><button data-p="play" class="on">Play</button><button data-p="how">How to play</button><button data-p="board">Leaderboard</button><button data-p="settings">Settings</button></nav>
        <a class="bm-zona" href="/">All games</a>
      </header>
      <main class="bm-main">
        <section class="bm-p bm-play on">
          <div class="bm-left">
            <div class="bm-hero"><b>BATTLE ROYALE</b><span>Up to 30 drop from the sky onto one of three maps cut from ZONA. Find guns, armour and heals, and be the last standing as the gas closes in. Free to play.</span></div>
            <label class="bm-name"><span>Your name</span><input maxlength="24" spellcheck="false" autocomplete="off" placeholder="Survivor"></label>
            <h5>Pick a mode <em class="bm-state"></em></h5>
            <div class="bm-modes">${MODES.map((x) => `<div class="bm-mode" data-m="${x.m}"><div><b>${x.name}</b><small>${x.say}</small></div><span class="bm-count" data-c="${x.m}"></span><button class="bm-find" data-m="${x.m}">Find match</button></div>`).join('')}</div>
          </div>
          <div class="bm-side">
            <h5>With friends</h5>
            <small class="bm-cap">Open a lobby of your own, in the mode picked, and give your friends its code</small>
            <div class="bm-seg">${MODES.map((x) => `<button data-pick="${x.m}">${x.name}</button>`).join('')}</div>
            <button class="bm-host">Host a lobby</button>
            <small class="bm-cap">Or join one by its code</small>
            <div class="bm-join"><input placeholder="CODE" maxlength="4" spellcheck="false" autocomplete="off"><button>Join</button></div>
            <p class="bm-note">A lobby waits in its own fenced field with guns to fight over, and starts when two thirds of it vote to go.</p>
          </div>
        </section>
        <section class="bm-p bm-how">
          <!-- (in pictures, as the Zone's own How to play: the owner, 2026-10-21, "how to play is missing graphiscs") -->
          <ol class="ht-steps" aria-label="How a match goes">
            <li style="--i:0"><figure><img src="/howto/br-lobby.jpg" alt="" loading="lazy" decoding="async"><i>01</i></figure><b>The lobby</b><span>Fight over the guns in the waiting area while it fills: back at once when you fall. V votes to start; two thirds is enough.</span></li>
            <li style="--i:1"><figure><img src="/howto/br-drop.jpg" alt="" loading="lazy" decoding="async"><i>02</i></figure><b>The drop</b><span>Space to jump once the plane is over the map; hold W to dive. The canopy opens by itself, or on Space.</span></li>
            <li style="--i:2"><figure><img src="/howto/br-loot.jpg" alt="" loading="lazy" decoding="async"><i>03</i></figure><b>Loot</b><span>Guns, armour, heals and grenades, ringed in their rarity's colour. F takes what you look at.</span></li>
            <li style="--i:3"><figure><img src="/howto/br-circle.jpg" alt="" loading="lazy" decoding="async"><i>04</i></figure><b>The circle</b><span>The gas closes in, in phases: the top of the screen says when. Outside it you lose health, more each phase.</span></li>
            <li style="--i:4"><figure><img src="/howto/br-win.jpg" alt="" loading="lazy" decoding="async"><i>05</i></figure><b>Last standing</b><span>The last player or team alive wins. Return to Battle Royale for the next match.</span></li>
          </ol>
          <h5>Keys and rules</h5>
          <div class="bm-rules">
            <div><b>The slots</b><span>Six slots, 1 to 6 or the wheel: guns, heals and grenades. F takes what you look at, G drops what is in your hand. Rounds are picked up by walking over them, and every gun of a calibre shares them.</span></div>
            <div><b>Teams</b><span>In duos and squads a teammate who falls is knocked down: stand over them and hold F for 10 seconds to get them up. No friendly fire.</span></div>
            <div><b>Leaving</b><span>Esc, then Leave the match: you are out of it at once, and what you carried is left on the ground.</span></div>
          </div>
        </section>
        <section class="bm-p bm-board"><h5>Leaderboard</h5><div class="bm-rows"></div></section>
        <section class="bm-p bm-settings"><div class="bm-set-host"></div></section>
      </main>
      <div class="bm-wait"><b>Joining</b><span class="bm-wait-text"></span></div>
      <div class="bm-pause"><b>Paused</b><span>The match goes on without you.</span><button class="bm-resume">Resume</button><button class="bm-pause-set">Settings</button><button class="bm-leave">Leave the match</button><div class="bm-pause-host"></div></div>`;
    // (inside the HUD, so that the settings it lends stay in it: HUD.settingsInto, as the Arena's menu)
    hud.root.appendChild(this.el);
    this.q<HTMLInputElement>('.bm-name input').value = hud.nameValue();
    this.drawMode();
    this.el.addEventListener('click', (e) => this.click(e));
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
      if (on && !paused && !text) void this.list();
    };
    const start = document.querySelector('#hud .hud-start');
    if (start?.classList.contains('show')) this.el.classList.add('show');
    void this.list();
    // (sent here from another map's page to its lobby: straight in, src/game/br/mode.ts)
    const q = new URLSearchParams(location.search);
    if (q.get('go') === '1') {
      q.delete('go');
      history.replaceState(null, '', `${location.pathname}?${q}`);
      this.hud.deploy();
    }
  }

  private click(e: MouseEvent) {
    // (the door over this page, nothing loaded again: src/ui/door.ts)
    if ((e.target as HTMLElement).closest('.bm-zona')) {
      e.preventDefault();
      return void doorOver('br');
    }
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!b) return;
    if (b.dataset.p) return this.show(b.dataset.p as Panel);
    if (b.dataset.pick) {
      this.mode = b.dataset.pick as BrMode;
      this.keepMode();
      return this.drawMode();
    }
    if (b.classList.contains('bm-find')) {
      this.mode = b.dataset.m as BrMode;
      this.keepMode();
      return this.go('find');
    }
    if (b.classList.contains('bm-host')) return this.go('host');
    if (b.closest('.bm-join')) {
      const code = this.q<HTMLInputElement>('.bm-join input').value.trim().toUpperCase();
      if (/^[A-Z]{4}$/.test(code)) this.go(code);
      return;
    }
    // (the pause in a match: back in, the Zone's own settings, or out of it)
    if (b.classList.contains('bm-resume')) return this.hud.deploy();
    if (b.classList.contains('bm-pause-set')) {
      const on = !this.el.classList.contains('pset');
      this.el.classList.toggle('pset', on);
      return this.hud.settingsInto(on ? this.q<HTMLElement>('.bm-pause-host') : null);
    }
    if (b.classList.contains('bm-leave')) {
      return this.onLeave();
    }
  }

  private show(p: Panel) {
    for (const b of this.el.querySelectorAll<HTMLElement>('.bm-nav button')) b.classList.toggle('on', b.dataset.p === p);
    for (const s of this.el.querySelectorAll<HTMLElement>('.bm-p')) s.classList.toggle('on', s.classList.contains(`bm-${p}`));
    this.hud.settingsInto(p === 'settings' ? this.q<HTMLElement>('.bm-set-host') : null);
    if (p === 'board') void this.board();
    if (p === 'play') void this.list();
  }

  private keepMode() {
    try {
      localStorage.setItem('zona-br-mode', this.mode);
    } catch {
      /* not kept */
    }
  }

  private drawMode() {
    for (const b of this.el.querySelectorAll<HTMLElement>('.bm-seg button')) b.classList.toggle('on', b.dataset.pick === this.mode);
  }

  /** each mode's lobby and matches, as the server has them: asked again every few seconds while the menu is shown */
  private async list() {
    clearTimeout(this.listT);
    try {
      const r = (await (await fetch(`${arenaBase()}/battleroyale/lobbies`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })).json()) as { modes?: Counts };
      this.counts = r.modes ?? null;
      this.q('.bm-state').textContent = '';
    } catch {
      this.counts = null;
      this.q('.bm-state').textContent = 'waking the server: the first match may take a minute';
    }
    for (const x of MODES) {
      const c = this.counts?.[x.m], el = this.q(`[data-c="${x.m}"]`);
      el.innerHTML = c ? `<b>${c.waiting}</b> waiting${c.map !== null && c.waiting ? ` on ${esc(MAPS[c.map].name)}` : ''}<i>·</i><b>${c.playing}</b> in matches` : '';
      this.q(`.bm-mode[data-m="${x.m}"]`).classList.toggle('busy', !!c && c.waiting > 0);
    }
    if (this.el.classList.contains('show') && !this.el.classList.contains('paused')) this.listT = window.setTimeout(() => void this.list(), 5000);
  }

  private async board() {
    try {
      const r = (await (await fetch(`${arenaBase()}/battleroyale/board`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })).json()) as { players: { name: string; wins: number; kills: number; matches: number }[] };
      this.q('.bm-rows').innerHTML = r.players.length
        ? `<div class="bm-head"><span>#</span><span>Player</span><span>Wins</span><span>Kills</span><span>Matches</span></div>` + r.players.slice(0, 20).map((p, k) => `<div><span>${k + 1}</span><span>${esc(p.name)}</span><span>${p.wins}</span><span>${p.kills}</span><span>${p.matches}</span></div>`).join('')
        : '<p>No matches played yet: be the first winner.</p>';
    } catch {
      this.q('.bm-rows').textContent = 'The board could not be reached.';
    }
  }

  /**
   * Into a lobby: put in the page's address, the name given, and Deploy pressed as the Zone presses it. A mode whose open
   * lobby is on another map than this page was made for is gone to on a page made for that map.
   */
  private go(how: string) {
    const name = this.q<HTMLInputElement>('.bm-name input').value.trim();
    if (name) this.hud.setName(name);
    clearTimeout(this.listT);
    const open = how === 'find' ? this.counts?.[this.mode] : null;
    if (open && open.map !== null && open.waiting > 0 && open.map !== this.map) {
      // (on this page as it is, its map hidden and that one shown: src/game/modes.ts)
      const search = String(new URLSearchParams({ wager: 'br', size: String(TEAM[this.mode]), kills: String(open.map), loadout: 'find', go: '1' }));
      return doorGo.br ? doorGo.br(open.map, search) : location.assign(`/battleroyale?${search}`);
    }
    history.replaceState(null, '', `/battleroyale?${new URLSearchParams({ wager: 'br', size: String(TEAM[this.mode]), kills: String(this.map), loadout: how })}`);
    this.hud.deploy();
  }
}
