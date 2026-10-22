// The Arena's own front (2026-10-14), its menu and the screens between matches. The owner: "pretend they are 2
// completely different games and ecoststems. arena will need its own razzle dazzle for the main menu and UI/UX".
// Red and steel where the Zone is gold; the fort turning behind it (src/game/game/drops.ts, menuCamera). It stands in
// for the Zone's start screen on an /arena page (that one is hidden there), and follows what the game says of it
// through HUD.onStartShown: the matches to play or watch before anything is joined, the wait for the other players,
// and the pause in a match. A match is gone into the way the Zone's Deploy goes in: the match put in the page's
// address, the name given, and the same Deploy pressed (src/net/client.ts, wagerQuery).
import './arena-menu.css';
import { ARENA, arenaLoadoutSays, type LobbyInfo } from '../../arena/rules';
import { KITS } from '../sim/kits';
import { arenaBase } from '../net/client';
import type { HUD } from './hud';
import { doorGo } from './door';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const kitOf = (id: string) => KITS.find((k) => k.id === id);

type Panel = 'play' | 'how' | 'loadouts' | 'settings';

export class ArenaMenu {
  private el: HTMLDivElement;
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private pick = { size: 1, kills: 5, loadout: 'assault' };
  private panel: Panel = 'play';
  private shown = false;
  private listT = 0;
  private asking = false;
  private woken = false;
  /** the matches as last asked for, and what was picked to go into: said on the Waiting card */
  private lobbies: LobbyInfo[] = [];

  constructor(private hud: HUD) {
    document.body.classList.add('arena-mode');
    this.el = document.createElement('div');
    this.el.id = 'arena-menu';
    this.el.innerHTML = `
      <header class="am-bar">
        <span class="am-logo">ARE<span>NA</span></span>
        <nav class="am-nav">
          <button type="button" data-p="play" class="on">Play</button>
          <button type="button" data-p="how">How to play</button>
          <button type="button" data-p="loadouts">Loadouts</button>
          <button type="button" data-p="settings">Settings</button>
        </nav>
        <button type="button" class="store-btn am-store">Store</button>
        <a class="am-zona" href="/zona">ZONA</a>
      </header>
      <main class="am-main">
        <section class="am-p am-play on">
          <div class="am-left">
            <div class="am-hero"><b>ARENA</b><span>Team against team at Orlinoye. A round ends when one side has nobody left standing; the first side to the rounds chosen wins.</span></div>
            <label class="am-name"><span>Your name</span><input maxlength="16" spellcheck="false" autocomplete="off" placeholder="Survivor"></label>
            <h5>Matches <em class="am-state"></em></h5>
            <div class="am-list"></div>
          </div>
          <div class="am-host">
            <h5>Host a match</h5>
            <div class="am-seg" data-k="size">${[1, 2, 3].map((n) => `<button type="button" data-v="${n}">${n}v${n}</button>`).join('')}</div>
            <small class="am-cap">Rounds to win</small>
            <div class="am-seg" data-k="kills">${ARENA.kills.map((n) => `<button type="button" data-v="${n}">${n}</button>`).join('')}</div>
            <small class="am-cap">Loadout, everybody's, every round</small>
            <div class="am-lo">${ARENA.loadouts.map((id) => `<button type="button" data-lo="${id}">${esc(kitOf(id)?.name ?? id)}</button>`).join('')}</div>
            <button type="button" class="am-go">Host</button>
            <button type="button" class="am-practice">Practice alone</button>
            <p class="am-note">No money moves yet: matches are played for nothing.</p>
          </div>
        </section>
        <section class="am-p am-how">
          <!-- (in pictures, as the Zone's own How to play: the owner, 2026-10-21, "how to play is missing graphiscs") -->
          <ol class="ht-steps" aria-label="How a match goes">
            <li style="--i:0"><figure><img src="/howto/arena-fort.jpg" alt="" loading="lazy" decoding="async"><i>01</i></figure><b>Join or host</b><span>Pick a match from the list, or host one: 1v1 to 3v3, the rounds to win (${ARENA.kills.join(', ')}) and one loadout for everybody. Or practise alone.</span></li>
            <li style="--i:1"><figure><img src="/howto/arena-kit.jpg" alt="" loading="lazy" decoding="async"><i>02</i></figure><b>The same guns</b><span>Everybody gets the host's loadout, every round. Rounds never run out: R reloads. Nothing to loot.</span></li>
            <li style="--i:2"><figure><img src="/howto/arena-fight.jpg" alt="" loading="lazy" decoding="async"><i>03</i></figure><b>Team against team</b><span>At Orlinoye, the mountain fort. A round ends when one side has nobody left standing.</span></li>
            <li style="--i:3"><figure><img src="/howto/arena-rounds.jpg" alt="" loading="lazy" decoding="async"><i>04</i></figure><b>First to the rounds</b><span>The first side to the rounds chosen wins the match.</span></li>
            <li style="--i:4"><figure><img src="/howto/arena-again.jpg" alt="" loading="lazy" decoding="async"><i>05</i></figure><b>Again</b><span>Play again goes straight back to the Arena's menu, nothing loaded again.</span></li>
          </ol>
        </section>
        <section class="am-p am-loadouts">
          <h5>The loadouts</h5>
          <div class="am-kits">${ARENA.loadouts.map((id) => `<div class="am-kit"><b>${esc(kitOf(id)?.name ?? id)}</b><span>${esc(arenaLoadoutSays(id))}</span></div>`).join('')}</div>
          <p class="am-note">The host picks one for the whole match. Guns only: they empty and are reloaded (R, or the trigger on an empty gun) from rounds that never run out. Nothing to loot, carry or fill.</p>
        </section>
        <section class="am-p am-settings"><button type="button" class="am-back">Back</button><div class="am-set-host"></div></section>
      </main>
      <div class="am-wait"><b>Waiting</b><em class="am-wait-what"></em><span class="am-wait-text"></span><button type="button" class="am-leave">Leave</button></div>
      <div class="am-pause"><b>Paused</b><span>The match goes on without you.</span><button type="button" class="am-resume">Resume</button><button type="button" class="am-pause-set">Settings</button><button type="button" class="am-store">Store</button><button type="button" class="am-leave">Leave the match</button></div>`;
    // (inside the HUD, so that the settings it lends stay in it: HUD.settingsInto)
    hud.root.appendChild(this.el);
    this.drawPick();
    this.el.addEventListener('click', (e) => this.click(e));
    // (the Zone's own page, gone to in place: src/game/modes.ts)
    this.q('.am-zona').addEventListener('click', (e) => {
      if (!doorGo.to) return;
      e.preventDefault();
      doorGo.to('zona');
    });
    this.hud.onStartShown = (on, paused, text) => this.state(on, paused, text);
    // (and what it is doing already, if it was shown before this was made)
    const start = document.querySelector('#hud .hud-start');
    if (start?.classList.contains('show')) this.state(true, start.classList.contains('paused'), '');
  }

  /** taken down, another game played on the page (src/game/modes.ts) */
  destroy() {
    clearTimeout(this.listT);
    this.settings(false);
    this.hud.onStartShown = () => {};
    this.el.remove();
    document.body.classList.remove('arena-mode');
  }

  /** out of the wait for a match (true), or out of a match: the game's to do (Game.toArena) */
  onLeave: (waiting: boolean) => void = () => {};

  /** what the game says its start screen is doing: shown before anything is joined, waiting for players, paused in a match, or gone */
  private state(on: boolean, paused: boolean, text: string) {
    this.el.classList.toggle('show', on);
    this.el.classList.toggle('paused', on && paused);
    this.el.classList.toggle('waiting', on && !paused && !!text);
    // (settings opened from the pause are only open while it is)
    if (!(on && paused)) this.el.classList.remove('pset');
    this.q<HTMLElement>('.am-wait-text').textContent = text.replace(/^Wager:/, 'Match:');
    // (here before any match, or back from one: the matches looked at again)
    if (on && !paused && !text) {
      if (!this.shown) this.q<HTMLInputElement>('.am-name input').value = this.hud.nameValue();
      this.shown = true;
      this.show(this.panel === 'settings' ? 'play' : this.panel);
    }
    if (!on) this.settings(false);
  }

  private show(p: Panel) {
    this.panel = p;
    for (const b of this.el.querySelectorAll<HTMLElement>('.am-nav button')) b.classList.toggle('on', b.dataset.p === p);
    for (const s of this.el.querySelectorAll<HTMLElement>('.am-p')) s.classList.toggle('on', s.classList.contains(`am-${p}`));
    this.settings(p === 'settings');
    if (p === 'play') void this.list();
  }

  /** the Zone's own settings, lent to this menu while it shows them (HUD.settingsInto) */
  private settings(on: boolean) {
    this.hud.settingsInto(on ? this.q<HTMLElement>('.am-set-host') : null);
  }

  private drawPick() {
    for (const s of this.el.querySelectorAll<HTMLElement>('.am-seg')) for (const b of s.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', Number(b.dataset.v) === this.pick[s.dataset.k as 'size' | 'kills']);
    for (const b of this.el.querySelectorAll<HTMLElement>('.am-lo button')) b.classList.toggle('on', b.dataset.lo === this.pick.loadout);
  }

  /** the matches, as the arena has them: asked again every few seconds while they are looked at */
  private async list() {
    clearTimeout(this.listT);
    if (this.panel !== 'play' || !this.el.classList.contains('show') || this.el.classList.contains('paused') || this.el.classList.contains('waiting')) return;
    if (this.asking) return;
    this.asking = true;
    const state = this.q<HTMLElement>('.am-state'), box = this.q<HTMLElement>('.am-list');
    // (the arena sleeps when nobody has played for a while, and takes up to a minute to wake: said, not left blank)
    if (!this.woken) state.textContent = 'waking the arena…';
    let lobbies: LobbyInfo[] | null = null;
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 70_000);
      const r = await fetch(`${arenaBase()}/arena/lobbies`, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      lobbies = r.ok ? ((await r.json()) as { lobbies: LobbyInfo[] }).lobbies : null;
    } catch {
      lobbies = null;
    }
    this.asking = false;
    if (lobbies) {
      this.woken = true;
      this.lobbies = lobbies;
    }
    state.textContent = lobbies ? `${lobbies.length} open or being played` : 'the arena cannot be reached: trying again';
    if (lobbies) {
      box.innerHTML = lobbies.length
        ? lobbies.map((l) => {
            const kit = esc(kitOf(l.loadout)?.name ?? l.loadout), fought = l.state === 'match';
            const act = l.state === 'open' && l.have < l.size * 2 ? `<button type="button" data-join="${esc(l.id)}">Join</button>` : fought ? `<button type="button" class="watch" data-watch="${esc(l.id)}">Watch${l.watching ? ` · ${l.watching}` : ''}</button>` : '<i>full</i>';
            return `<div class="am-row${fought ? ' fought' : ''}"><b>${esc(l.host)}</b><span>${l.size}v${l.size}</span><span>first to ${l.kills} · ${kit}</span><em>${fought && l.score ? `${l.score[0]} : ${l.score[1]}` : `${l.have} of ${l.size * 2} in`}</em>${act}</div>`;
          }).join('')
        : '<p class="am-none">None open just now. Host one, and it shows here for others to join.</p>';
    }
    this.listT = window.setTimeout(() => void this.list(), lobbies ? 4000 : 6000);
  }

  private click(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.p) return this.show(b.dataset.p as Panel);
    const seg = b.closest('.am-seg') as HTMLElement | null;
    if (seg) {
      this.pick[seg.dataset.k as 'size' | 'kills'] = Number(b.dataset.v);
      return this.drawPick();
    }
    if (b.dataset.lo) {
      this.pick.loadout = b.dataset.lo;
      return this.drawPick();
    }
    const kit = (id: string) => kitOf(id)?.name ?? id;
    const what = (l?: LobbyInfo) => (l ? `${l.host}'s match · ${l.size}v${l.size} · first to ${l.kills} · ${kit(l.loadout)}` : '');
    if (b.dataset.join) return this.go({ wager: b.dataset.join }, what(this.lobbies.find((l) => l.id === b.dataset.join)));
    if (b.dataset.watch) return this.go({ wager: b.dataset.watch, watch: '1' }, `Watching ${what(this.lobbies.find((l) => l.id === b.dataset.watch))}`);
    if (b.classList.contains('am-go')) return this.go({ wager: 'new', size: String(this.pick.size), kills: String(this.pick.kills), loadout: this.pick.loadout, stake: String(ARENA.stake[0]) }, `Your match · ${this.pick.size}v${this.pick.size} · first to ${this.pick.kills} · ${kit(this.pick.loadout)}`);
    if (b.classList.contains('am-practice')) return this.go({ wager: 'practice', loadout: this.pick.loadout }, `Practice · ${kit(this.pick.loadout)}`);
    if (b.classList.contains('am-resume')) return this.hud.deploy();
    // (the store, from the menu and from a match's pause, over whatever is behind: the owner, 2026-10-22, "im unable to open the store from within the menu while playing mid-game")
    if (b.classList.contains('am-store')) return void import('./store/panel').then((m) => m.openStore());
    if (b.classList.contains('am-pause-set')) {
      this.el.classList.add('pset');
      return this.show('settings');
    }
    if (b.classList.contains('am-back')) {
      this.el.classList.remove('pset');
      return this.settings(false);
    }
    // (out of the wait for a match, or out of the match: back here, the page as it is)
    if (b.classList.contains('am-leave')) return this.onLeave(this.el.classList.contains('waiting'));
  }

  /** into a match: put in the page's address, the name given, and Deploy pressed as the Zone presses it */
  private go(q: Record<string, string>, what = '') {
    this.q<HTMLElement>('.am-wait-what').textContent = what;
    const name = this.q<HTMLInputElement>('.am-name input').value.trim();
    if (name) this.hud.setName(name);
    history.replaceState(null, '', `/arena?${new URLSearchParams(q)}`);
    clearTimeout(this.listT);
    this.hud.deploy();
  }
}
