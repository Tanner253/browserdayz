// A lean HUD: small vitals, a compass strip, a corner map (src/ui/minimap.ts), prompts
// only when relevant. Plain DOM; updated once per frame with cheap diffs.

import type { Vitals } from '../game/player';
import { MAX_STAMINA, type ChatChannel } from '../net/protocol';
import { TOUCH } from '../core/device';
import { EMOTES } from '../sim/emotes';
import { TAG_HOLD_MIN } from '../sim/items';
import { INFECTED } from '../sim/infected';
import { GAS } from '../sim/gas';
import { AO_MODES, DEFAULT_GRAPHICS, FPS_LIMITS, LEVELS, MSAA, PRESETS, SCALES, VOLUMES, presetOf, saveGraphics, type Graphics, type PresetName } from '../core/settings';

const CHANNELS: ChatChannel[] = ['global', 'near'];
const CHANNEL_LABEL: Record<ChatChannel | 'system', string> = { global: 'Global', near: 'Proximity', system: '' };

const ICONS = {
  health: '<path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6C19 16.5 12 21 12 21z"/>',
  food: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M16 3c-2 0-3 3-3 6s1 4 3 4v8"/>',
  water: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  blood: '<path d="M12 3s5 6.5 5 10a5 5 0 0 1-10 0c0-3.5 5-10 5-10zM9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
};

function svg(path: string) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

/** A mark on the menu's map: where it is in the world, what it is called, and what is said of it when it is pointed at. */
export interface MenuSpot {
  x: number;
  z: number;
  name: string;
  tip: string;
  kind: 'town' | 'police' | 'clinic' | 'shop' | 'army' | 'site' | 'gas' | 'spawn';
  /** its name is always shown, not only when pointed at */
  label?: boolean;
}

export interface HotbarEntry {
  key: string;
  id: string | null;
  label: string;
  active: boolean;
  dim: boolean;
}

/** where the game is talked about, and its token's address on Solana: both shown on the main menu */
export const X_HANDLE = 'zonaSOL_';
/** where its players talk to each other: the way in to the Discord, on the main menu */
export const DISCORD = 'https://discord.com/invite/8ECdSH2vWE';
export const CONTRACT = 'GvfAzdPF466PJsPJMzXQeX3TSqmJm9YxAG8xBJ6ypump';

/** the wheel: eight wedges round a hub, the first at the top and the rest clockwise (the order of EMOTES) */
function wheelSvg() {
  const n = EMOTES.length, half = Math.PI / n - 0.022, r0 = 58, r1 = 152;
  const pt = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;
  const wedges = EMOTES.map((e, i) => {
    const a = (i / n) * Math.PI * 2;
    const d = `M${pt(r0, a - half)}L${pt(r1, a - half)}A${r1} ${r1} 0 0 1 ${pt(r1, a + half)}L${pt(r0, a + half)}A${r0} ${r0} 0 0 0 ${pt(r0, a - half)}Z`;
    const [x, y] = pt(108, a).split(' ');
    // two words go on two lines
    const words = e.label.split(' ');
    const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && e.label.length > 9 ? words : [e.label];
    const text = lines.map((l, k) => `<text x="${x}" y="${(Number(y) + (k - (lines.length - 1) / 2) * 17).toFixed(1)}">${l}</text>`).join('');
    return `<g class="${e.hold ? 'keeps' : ''}"><path d="${d}"/>${text}</g>`;
  });
  return `<svg viewBox="-160 -160 320 320" aria-hidden="true">${wedges.join('')}</svg>`;
}

export class HUD {
  root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private notes: HTMLDivElement;
  private last: Record<string, string> = {};

  constructor(private icons: Record<string, string> = {}) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-cross"><i></i><i></i><i></i><i></i></div>
      <div class="hud-hit"><i></i><i></i><i></i><i></i></div>
      <div class="hud-prompt"></div>
      <div class="hud-mark"></div>
      <div class="hud-says"></div>
      <div class="hud-wheel">${wheelSvg()}<i class="wheel-dot"></i><div class="wheel-mid"><b></b><span></span></div></div>
      <div class="hud-progress"><div class="hud-progress-label"></div><div class="hud-progress-bar"><div></div></div></div>
      <div class="hud-compass"><div class="hud-compass-strip"></div><div class="hud-compass-needle"></div></div>
      <div class="hud-bearing"></div>
      <div class="hud-area"></div>
      <div class="hud-notes"></div>
      <div class="hud-weapon"><div class="hud-weapon-name"></div><div class="hud-weapon-ammo"></div></div>
      <div class="hud-vitals">
        <div class="vital bleed" data-k="bleed">${svg(ICONS.blood)}<span>Bleeding</span></div>
        <div class="vital" data-k="health" title="Health">${svg(ICONS.health)}<div class="vital-bar"><i></i></div><b>100</b></div>
        <div class="vital" data-k="energy" title="Food">${svg(ICONS.food)}<div class="vital-bar"><i></i></div><b>100</b></div>
        <div class="vital" data-k="water" title="Water">${svg(ICONS.water)}<div class="vital-bar"><i></i></div><b>100</b></div>
      </div>
      <div class="hud-arms"><div></div></div>
      <div class="hud-stamina"><div></div></div>
      <div class="hud-ride"><b>0</b><small>km/h</small><div class="ride-bars"><div class="ride-fuel" title="fuel"><i></i></div><div class="ride-hp" title="the jeep"><i></i></div></div></div>
      <div class="hud-hotbar"></div>
      <div class="hud-chat">
        <div class="chat-log"></div>
        <div class="chat-entry"><span class="chat-ch"></span><input class="chat-input" maxlength="160" spellcheck="false" autocomplete="off"></div>
        <div class="chat-hint"><b>Tab</b> switch channel · <b>Enter</b> send · empty <b>Enter</b> closes</div>
      </div>
      <div class="hud-scope">
        <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
          <defs><radialGradient id="sv" r="1"><stop offset="0.82" stop-color="#000" stop-opacity="0"/><stop offset="0.97" stop-color="#000" stop-opacity="0.85"/></radialGradient></defs>
          <circle r="96" fill="url(#sv)"/>
          <g stroke="#0c0b0a" fill="#0c0b0a">
            <rect x="-1.1" y="0" width="2.2" height="96"/>
            <polygon points="-1.6,0 1.6,0 0,-4"/>
            <rect x="-96" y="-0.6" width="78" height="1.2"/>
            <rect x="18" y="-0.6" width="78" height="1.2"/>
            <rect x="-24" y="-1.4" width="6" height="2.8"/>
            <rect x="18" y="-1.4" width="6" height="2.8"/>
          </g>
          <g fill="#0c0b0a" font-family="monospace" font-size="4">
            <text x="3" y="12">2</text><text x="3" y="24">4</text><text x="3" y="38">6</text><text x="3" y="54">8</text>
          </g>
          <g stroke="#0c0b0a" stroke-width="0.8">
            <line x1="-3" y1="12" x2="0" y2="12"/><line x1="-3" y1="24" x2="0" y2="24"/><line x1="-3" y1="38" x2="0" y2="38"/><line x1="-3" y1="54" x2="0" y2="54"/>
          </g>
        </svg>
      </div>
      <div class="hud-damage"></div>
      <div class="hud-bleedfx"></div>
      <div class="hud-bleed">${svg(ICONS.blood)}<b>Bleeding</b><span></span></div>
      <div class="hud-hitdir"><i></i></div>
      <div class="hud-fps"></div>
      <div class="hud-online"><i></i><b></b><span></span></div>
      <div class="hud-net"></div>
      <div class="hud-feed"></div>
      <div class="hud-under"><div class="hud-board"></div><div class="hud-tags"></div></div>
      <div class="hud-fatal"><div class="fatal-title">Disconnected</div><div class="fatal-sub"></div><button class="dead-btn fatal-btn">Reconnect</button></div>
      <div class="hud-dead"><div class="dead-title">You are dead</div><div class="dead-sub"></div><button class="dead-btn">Respawn</button></div>
      <div class="hud-start">
        <video class="sm-film" muted playsinline preload="auto" src="/menu/map-pan.mp4"></video>
        <div class="sm-cut"></div>
        <header class="sm-top">
          <div class="sm-brand"><img src="/brand/zona-mark-plain.svg" alt=""><b>ZONA</b></div>
          <nav class="sm-nav start-tabs" aria-label="Menu">
            <button type="button" data-tab="play" class="on">Play</button>
            <button type="button" data-tab="map">Map</button>
            <button type="button" data-tab="brief">How to play</button>
            <button type="button" data-tab="keys">Controls</button>
            <button type="button" data-tab="gfx">Settings</button>
            <button type="button" data-tab="rewards" hidden>Rewards</button>
          </nav>
          <div class="sm-status">
            <span class="start-online"></span>
            <a class="sm-discord" href="${DISCORD}" target="_blank" rel="noopener noreferrer"><b>Discord</b><em>Join</em></a>
          </div>
        </header>
        <div class="sm-main">
          <section class="sm-hero start-id">
            <div class="start-kicker"><span>PvP survival shooter</span><em>Play to earn</em></div>
            <div class="start-title" aria-label="ZONA"><span style="--i:0">Z</span><span style="--i:1">O</span><span style="--i:2">N</span><span style="--i:3">A</span></div>
            <p class="start-sub">Players hunt you. So do the infected.</p>
            <p class="start-sub2">Take a dog tag off another player, stay alive ${TAG_HOLD_MIN} minutes, cash it in.</p>
            <div class="sm-enter">
              <label class="sm-name tagplate">
                <svg class="tagplate-chain" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="0.1 9" stroke-linecap="round"/></svg>
                <span>Stamp your dog tag</span>
                <input id="start-name" class="start-name" maxlength="16" spellcheck="false" autocomplete="off" enterkeyhint="go" placeholder="Survivor">
                <i class="tagplate-meta"><b>ZONA</b><b>Survivor</b></i>
              </label>
              <button class="start-btn" type="button"><span>Deploy</span></button>
            </div>
            <div class="start-queue"><div class="sq-pos"></div><div class="sq-sub"></div><button class="sq-leave" type="button">Play on your own instead</button></div>
            <ol class="sm-loop" aria-label="How a life goes">
              <li><i>1</i>Drop in</li><li><i>2</i>Loot</li><li><i>3</i>Take a tag</li><li><i>4</i>Hold ${TAG_HOLD_MIN}:00</li><li><i>5</i>Cash in</li>
            </ol>
            <button class="sm-wallet" type="button" hidden><b></b><span></span></button>
          </section>
          <aside class="sm-sheet start-brief" data-tab="play">
            <div class="sm-sheet-head"><h2></h2><button class="sm-close" type="button" aria-label="Close">&times;</button></div>
            <div class="start-pane pane-map">
              <div class="mm"><canvas width="720" height="720"></canvas><div class="mm-spots"></div><div class="mm-tip" role="tooltip"></div></div>
              <div class="mm-side">
                <p class="mm-hint"></p>
                <div class="mm-said"></div>
                <ul class="mm-legend">
                  <li><i class="k-spawn"></i>You start here</li>
                  <li><i class="k-site"></i>A place with a weapon</li>
                  <li><i class="k-police"></i>Police station</li>
                  <li><i class="k-army"></i>The army's</li>
                  <li><i class="k-gas"></i>Gas: mask needed</li>
                </ul>
              </div>
            </div>
            <div class="start-pane pane-brief">
              <ol class="start-loop">
                <li style="--i:0"><i class="loop-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><path d="M12 3v7M9 8l3 3 3-3"/></svg></i><div><b>Drop in</b><span>On the edge of the map, bare hands. The nearest marked place always has a weapon.</span></div></li>
                <li style="--i:1"><i class="loop-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l8-4 8 4v8l-8 4-8-4z"/><path d="M4 9l8 4 8-4M12 13v8"/></svg></i><div><b>Loot inward</b><span>Any building can hold a gun. The police station in the middle holds the most.</span></div></li>
                <li style="--i:2"><i class="loop-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg></i><div><b>Fight</b><span>Anyone you meet can kill you and take everything.</span></div></li>
                <li style="--i:3"><i class="loop-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="14" height="9" rx="3"/><circle cx="8.5" cy="12.5" r="1"/><path d="M12 11h4M12 14h3M8 8c-3-5 3-7 5-3"/></svg></i><div><b>Take their tag</b><span>Every body carries a dog tag. Loot it.</span></div></li>
                <li style="--i:4"><i class="loop-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg></i><div><b>Hold ${TAG_HOLD_MIN}:00</b><span>Stay alive with it for ${TAG_HOLD_MIN} minutes to cash it in.</span></div></li>
              </ol>
              <div class="sm-threats">
                <div><b>Other players</b><span>Anyone you meet can kill you and take everything you carry, your tag with it.</span></div>
                <div><b>The infected</b><span>They see ${INFECTED.sight} m in front of them and hear a shot from ${INFECTED.hearShot} m. Crouch past them, or fit a suppressor.</span></div>
                <div><b>The gas</b><span>The ${GAS.place} lies under it, and the best loot on the map is in there. A gas mask lets you breathe it: the police station keeps them.</span></div>
                <div><b>The bunker</b><span>Under the hills across the map from the works: dark, and shut. A keycard from the gas opens its door, loudly: it stays open while anybody is inside. The shotgun is kept there and nowhere else.</span></div>
              </div>
            </div>
            <div class="start-pane pane-keys">
              <div class="kb">
                <div class="kb-group">
                  <h4>Move</h4>
                  <div class="kb-wasd"><kbd>Q</kbd><kbd class="hot">W</kbd><kbd>E</kbd><kbd class="hot">A</kbd><kbd class="hot">S</kbd><kbd class="hot">D</kbd></div>
                  <p><kbd>Q</kbd><kbd>E</kbd> lean</p>
                  <p><kbd class="wide">Shift</kbd> sprint · hold breath</p>
                  <p><kbd class="wide">Space</kbd> jump</p>
                  <p><kbd>C</kbd> crouch <kbd class="wide">Alt</kbd> walk</p>
                </div>
                <div class="kb-group">
                  <h4>Fight</h4>
                  <svg class="kb-mouse" viewBox="0 0 120 150" aria-hidden="true">
                    <rect x="30" y="8" width="60" height="100" rx="30" fill="none" stroke="currentColor" stroke-width="2"/>
                    <path d="M60 8v38M30 46h60" stroke="currentColor" stroke-width="2" fill="none"/>
                    <path class="m-l" d="M58 10C44 11 32 22 32 38v6h26z"/><path class="m-r" d="M62 10c14 1 26 12 26 28v6H62z"/>
                    <rect x="56" y="20" width="8" height="16" rx="4" fill="currentColor"/>
                    <text x="26" y="128" text-anchor="end">FIRE</text><text x="94" y="128">AIM</text><text x="60" y="146" text-anchor="middle">WHEEL · NEXT WEAPON</text>
                    <path d="M40 46v62H28M80 46v62h12" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3"/>
                  </svg>
                  <p><kbd>R</kbd> reload <kbd>X</kbd> holster</p>
                </div>
                <div class="kb-group">
                  <h4>Gear</h4>
                  <div class="kb-row"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><em>primary · secondary · pistol · melee</em></div>
                  <div class="kb-row"><kbd>5</kbd><kbd>6</kbd><kbd>7</kbd><kbd>8</kbd><em>eat · drink · heal</em></div>
                  <p><kbd>F</kbd> take · doors · search <kbd>G</kbd> hold: drop what you hold</p>
                  <p><kbd>L</kbd> light: the one on your gun, or a flashlight you carry</p>
                  <p><kbd class="wide">Tab</kbd> inventory <kbd>M</kbd> map</p>
                  <p><kbd class="wide">Enter</kbd> chat <kbd>T</kbd> hold: call out · dance</p>
                  <p><kbd class="wide">Esc</kbd> this menu</p>
                  <p><kbd class="wide">F3</kbd> performance</p>
                </div>
              </div>
            </div>
            <div class="start-pane pane-gfx start-gfx"></div>
          </aside>
        </div>
        <footer class="sm-foot start-links">
          <button class="sl-ca" type="button" title="Copy the contract address"><b>CA</b><code>${CONTRACT}</code><em>Copy</em></button>
          <a class="sl-x" href="/payouts" target="_blank" rel="noopener">Payouts</a>
          <a class="sl-x" href="https://x.com/${X_HANDLE}" target="_blank" rel="noopener noreferrer">@${X_HANDLE}</a>
          <div class="sm-live"><i></i><span></span></div>
        </footer>
      </div>
    `;
    document.getElementById('ui')!.appendChild(this.root);
    for (const k of ['cross', 'hit', 'prompt', 'mark', 'progress', 'compass', 'bearing', 'area', 'weapon', 'vitals', 'stamina', 'arms', 'ride', 'hotbar', 'chat', 'scope', 'damage', 'bleedfx', 'bleed', 'hitdir', 'fps', 'online', 'net', 'feed', 'board', 'tags', 'fatal', 'dead', 'start']) {
      this.el[k] = this.root.querySelector(`.hud-${k}`) as HTMLElement;
    }
    this.notes = this.root.querySelector('.hud-notes') as HTMLDivElement;
    for (const [k, sel] of [['wheel', '.hud-wheel'], ['wheelDot', '.wheel-dot'], ['wheelB', '.wheel-mid b'], ['wheelS', '.wheel-mid span'], ['says', '.hud-says']]) this.el[k] = this.root.querySelector(sel) as HTMLElement;
    this.buildCompass();
    (this.root.querySelector('.fatal-btn') as HTMLButtonElement).onclick = () => location.reload();
    const chat = this.root.querySelector('.chat-input') as HTMLInputElement;
    chat.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') {
        // same box, different audience
        e.preventDefault();
        this.setChannel(CHANNELS[(CHANNELS.indexOf(this.channel) + (e.shiftKey ? CHANNELS.length - 1 : 1)) % CHANNELS.length]);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // the key that opened the box is still held down
        if (e.repeat) return;
        const text = chat.value.trim();
        this.closeChat();
        if (text) this.chatSend(this.channel, text);
      } else if (e.key === 'Escape') this.closeChat();
    });
    chat.addEventListener('blur', () => this.chatOpen && this.closeChat());
    this.setChannel('global');
    // the contract address, copied
    const links = this.root.querySelector('.start-links') as HTMLElement;
    const ca = links.querySelector('.sl-ca') as HTMLButtonElement;
    ca.addEventListener('click', () => {
      const said = ca.querySelector('em') as HTMLElement;
      const done = (ok: boolean) => {
        said.textContent = ok ? 'Copied' : 'Select and copy';
        ca.classList.toggle('done', ok);
        setTimeout(() => {
          said.textContent = 'Copy';
          ca.classList.remove('done');
        }, 1600);
      };
      const pick = () => {
        // no clipboard to write to (an old browser, a page not served securely): leave it selected for the player to copy
        const r = document.createRange();
        r.selectNodeContents(ca.querySelector('code')!);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
        done(false);
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(CONTRACT).then(() => done(true), pick);
      else pick();
    });
    // the name: keys typed into it are not the game's, and Enter in it is the Deploy button
    const name = this.root.querySelector('.start-name') as HTMLInputElement;
    // every letter is struck into the plate
    const plate = this.root.querySelector('.tagplate') as HTMLElement;
    name.addEventListener('input', () => {
      plate.classList.remove('stamp');
      void plate.offsetWidth;
      plate.classList.add('stamp');
    });
    name.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter' || e.repeat) return;
      name.blur();
      this.startClicked();
    });
    // the menu along the top: Play is the way in itself; the rest open a sheet beside it
    const tabs = this.root.querySelector('.start-tabs') as HTMLElement;
    tabs.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest('button')?.dataset.tab;
      if (!tab) return;
      if (tab === 'rewards') this.rewardsClicked();
      else this.sheet(tab);
    });
    (this.root.querySelector('.sm-close') as HTMLButtonElement).onclick = () => this.sheet('play');
    (this.root.querySelector('.sm-wallet') as HTMLButtonElement).onclick = () => this.rewardsClicked();
    window.addEventListener('keydown', (e) => {
      // (Escape shuts an open sheet before it does anything else: the game's own Escape is the pause, and that is this menu)
      if (e.code === 'Escape' && this.el.start.classList.contains('sheet') && !this.el.start.classList.contains('paused')) this.sheet('play');
    });
    const gfx = this.root.querySelector('.start-gfx') as HTMLElement;
    gfx.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.k) this.setGraphic(b.dataset.k, b.dataset.v ?? '');
    });
    this.mapTips();
    // scale the whole HUD with the window so it reads the same on a laptop and a 1440p monitor
    const fit = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const css = document.documentElement.style;
      const z = Math.round(Math.max(0.7, Math.min(1.7, h / 860, w / 1400)) * 100) / 100;
      css.setProperty('--ui-zoom', String(z));
      // dialogs grow with a big screen but never shrink below their designed size...
      css.setProperty('--dialog-zoom', String(TOUCH ? Math.max(0.55, Math.min(1, h / 640, w / 760)) : Math.max(1, z)));
      // ...except on a phone, where they and the inventory have to fit a small screen whole
      css.setProperty('--inv-zoom', String(TOUCH ? Math.max(0.5, Math.min(1.7, h / 700, w / 1340)) : z));
    };
    document.body.classList.toggle('touch', TOUCH);
    this.el.hotbar.addEventListener('pointerdown', (e) => {
      const key = (e.target as HTMLElement).closest('.hb')?.querySelector('b')?.textContent;
      if (key) this.hotbarTapped(key);
    });
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', () => setTimeout(fit, 250));
    document.addEventListener('fullscreenchange', () => setTimeout(fit, 250));
  }

  private buildCompass() {
    const strip = this.root.querySelector('.hud-compass-strip') as HTMLElement;
    const marks: string[] = [];
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let rep = -1; rep <= 1; rep++) {
      for (let d = 0; d < 360; d += 15) {
        const deg = d + rep * 360;
        const label = names[d] ?? (d % 45 === 0 ? '' : `<small>${d}</small>`);
        marks.push(`<span style="left:${deg * 4}px" class="${names[d] ? 'major' : ''}">${label}</span>`);
      }
    }
    strip.innerHTML = marks.join('');
  }

  private set(key: string, el: HTMLElement, value: string, prop: 'text' | 'html' = 'text') {
    if (this.last[key] === value) return;
    this.last[key] = value;
    if (prop === 'text') el.textContent = value;
    else el.innerHTML = value;
  }

  private toggle(el: HTMLElement, cls: string, on: boolean) {
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  }

  /**
   * The wheel (hold T).
   * @param pick the entry the mouse is on (-1 = none) and where the mouse is from the middle, each way -1..1
   * @param held the id of the thing the body is keeping up now (picking it again stops it)
   * @param last what a tap of T on its own repeats
   */
  wheel(open: boolean, pick = -1, at: [number, number] = [0, 0], held: string | null = null, last = '') {
    const w = this.el.wheel;
    this.toggle(w, 'show', open);
    if (!open) return;
    w.querySelectorAll('g').forEach((g, i) => {
      this.toggle(g as unknown as HTMLElement, 'on', i === pick);
      this.toggle(g as unknown as HTMLElement, 'held', EMOTES[i].id === held);
    });
    const dot = this.el.wheelDot.style;
    dot.setProperty('--x', at[0].toFixed(3));
    dot.setProperty('--y', at[1].toFixed(3));
    const e = pick >= 0 ? EMOTES[pick] : null;
    this.set('wheelB', this.el.wheelB, e ? (e.id === held ? 'Stop' : e.say ?? e.label) : 'Move the mouse');
    this.set('wheelS', this.el.wheelS, e ? 'let go of T' : last ? `tap T: ${last}` : 'let go to close');
  }

  private says = new Map<number, HTMLElement>();
  /**
   * What somebody near called out, over their head.
   * @param at where their head is on screen, as fractions of it; null takes the words away
   * @param age seconds since it was said (it pops in)
   */
  say(who: number, text: string, at: [number, number] | null, age = 1) {
    let el = this.says.get(who);
    if (!at) {
      el?.remove();
      this.says.delete(who);
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'say';
      this.el.says.appendChild(el);
      this.says.set(who, el);
    }
    if (el.textContent !== text) el.textContent = text;
    el.style.left = `${at[0] * 100}%`;
    el.style.top = `${at[1] * 100}%`;
    const k = Math.min(1, age / 0.12);
    el.style.setProperty('--k', (k < 1 ? 0.4 + k * 0.75 : 1.15 - Math.min(0.15, (age - 0.12) * 1.2)).toFixed(3));
  }

  note(text: string, kind: 'info' | 'warn' | 'good' = 'info') {
    const n = document.createElement('div');
    n.className = `note note-${kind}`;
    n.textContent = text;
    this.notes.appendChild(n);
    setTimeout(() => n.classList.add('out'), 3200);
    setTimeout(() => n.remove(), 4000);
    while (this.notes.children.length > 5) this.notes.firstChild?.remove();
  }

  area(name: string) {
    const a = this.el.area;
    a.innerHTML = `<span>${name}</span>`;
    a.classList.remove('show');
    void a.offsetWidth;
    a.classList.add('show');
  }

  /**
   * The way in (before a game) and the pause (during one).
   * @param text what the button says while something is going on: connecting, in line
   */
  showStart(on: boolean, paused = false, text = '') {
    this.toggle(this.el.start, 'show', on);
    this.toggle(this.el.start, 'paused', paused);
    // (something is going on: the button says what, and is not to be pressed again)
    this.toggle(this.el.start, 'busy', on && !paused && !!text);
    this.set('startBtn', this.root.querySelector('.start-btn span') as HTMLElement, text || (paused ? 'Resume' : 'Deploy'));
    this.set('startKick', this.root.querySelector('.start-kicker span') as HTMLElement, paused ? 'Paused' : 'PvP survival shooter');
    this.set('startSub', this.root.querySelector('.start-sub') as HTMLElement, paused ? 'The Zone does not stop for you: you can still be killed.' : 'Players hunt you. So do the infected.');
    if (!on) {
      this.el.start.classList.remove('enter');
      this.sheet('play');
    }
  }

  /** Which sheet is open beside the way in: the map, how to play, the controls, the settings; 'play' is none. */
  private sheet(tab: string) {
    const card = this.root.querySelector('.start-brief') as HTMLElement;
    if (card.dataset.tab === tab && tab !== 'play') tab = 'play';
    card.dataset.tab = tab;
    this.toggle(this.el.start, 'sheet', tab !== 'play');
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.start-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    (card.querySelector('h2') as HTMLElement).textContent = { map: 'The map', brief: 'How to play', keys: 'Controls', gfx: 'Settings' }[tab] ?? '';
    if (tab === 'gfx') this.renderGraphics();
    (this.root.querySelector('.mm-tip') as HTMLElement).classList.remove('on');
  }

  /**
   * What goes on behind the way in, said in a corner of it, and the cut between one scene and
   * the next (see src/game/menu-scenes.ts).
   * @param fade how far the picture is faded out, 0..1
   */
  menuScene(caption: string, fade: number, film = -1) {
    const live = this.root.querySelector('.sm-live') as HTMLElement;
    this.toggle(live, 'on', !!caption);
    if (caption) this.set('scene', live.lastElementChild as HTMLElement, caption);
    const v = fade <= 0.004 ? '0' : fade.toFixed(2);
    if (this.last.cut !== v) {
      this.last.cut = v;
      (this.root.querySelector('.sm-cut') as HTMLElement).style.opacity = v;
    }
    // the film of the map, when it is its turn: played from the second asked for, and kept to it
    const reel = this.root.querySelector('.sm-film') as HTMLVideoElement | null;
    if (!reel) return;
    const on = film >= 0;
    if (on !== reel.classList.contains('on')) {
      reel.classList.toggle('on', on);
      if (on) {
        reel.currentTime = film;
        void reel.play().catch(() => {});
      } else reel.pause();
    } else if (on && Math.abs(reel.currentTime - film) > 0.4) reel.currentTime = film;
  }

  /** the film of the map has come and can be played */
  filmReady() {
    const reel = this.root.querySelector('.sm-film') as HTMLVideoElement | null;
    return !!reel && reel.readyState >= 3;
  }

  /** The line about being paid, under the way in: whether a wallet is given yet. Pressing it opens the rewards window. */
  setWallet(address: string | null) {
    const b = this.root.querySelector('.sm-wallet') as HTMLButtonElement;
    b.hidden = address === null;
    if (address === null) return;
    b.classList.toggle('set', !!address);
    (b.firstElementChild as HTMLElement).textContent = address ? 'Payout wallet set' : 'Play to earn';
    (b.lastElementChild as HTMLElement).textContent = address ? `${address.slice(0, 4)}…${address.slice(-4)} · change` : 'Add a wallet to be paid for the tags you cash in';
  }

  /** The loading screen is lifting: play the entrance (title, panels) once. */
  entrance() {
    if (this.el.start.classList.contains('show')) this.el.start.classList.add('enter');
  }

  /**
   * The map sheet: the game's own map (the picture the M key shows), with what is where said
   * when a mark is pointed at or tapped.
   * @param picture the whole map, drawn once (see Minimap.poster)
   * @param size how many metres across it is
   */
  setMenuMap(picture: HTMLCanvasElement, size: number, spots: MenuSpot[], gas: { x: number; z: number; r: number } | null) {
    const c = this.root.querySelector('.mm canvas') as HTMLCanvasElement;
    const g = c.getContext('2d')!, W = c.width, k = W / size;
    g.imageSmoothingEnabled = true;
    g.drawImage(picture, 0, 0, picture.width, picture.height, 0, 0, W, W);
    if (gas) {
      g.beginPath();
      g.arc((gas.x + size / 2) * k, (gas.z + size / 2) * k, gas.r * k, 0, Math.PI * 2);
      g.fillStyle = 'rgba(178, 198, 52, 0.26)';
      g.fill();
      g.setLineDash([7, 5]);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(218, 236, 98, 0.92)';
      g.stroke();
    }
    const at = (v: number) => (((v + size / 2) / size) * 100).toFixed(2);
    (this.root.querySelector('.mm-spots') as HTMLElement).innerHTML = spots
      .map((sp, i) => `<button type="button" class="mm-spot k-${sp.kind}" data-i="${i}" style="left:${at(sp.x)}%;top:${at(sp.z)}%" aria-label="${sp.name}">${sp.label ? `<span>${sp.name}</span>` : ''}</button>`)
      .join('');
    this.spots = spots;
    (this.root.querySelector('.mm-hint') as HTMLElement).textContent = TOUCH ? 'Tap a mark to see what is there.' : 'Point at a mark to see what is there.';
  }

  private spots: MenuSpot[] = [];

  /** the map's marks say what they are: under the mouse, or when tapped */
  private mapTips() {
    const map = this.root.querySelector('.mm') as HTMLElement, tip = map.querySelector('.mm-tip') as HTMLElement;
    // (on a phone the map is small and a finger is on it: there it is said beside the map)
    const said = this.root.querySelector('.mm-said') as HTMLElement;
    let stuck: HTMLElement | null = null;
    const show = (el: HTMLElement | null) => {
      const sp = el ? this.spots[Number(el.dataset.i)] : null;
      tip.classList.toggle('on', !!sp);
      said.classList.toggle('on', !!sp);
      map.querySelectorAll('.mm-spot.on').forEach((o) => o.classList.remove('on'));
      if (!sp || !el) return;
      el.classList.add('on');
      tip.innerHTML = said.innerHTML = `<b>${sp.name}</b><span>${sp.tip}</span>`;
      // beside the mark, on whichever side of it has the room
      const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
      tip.style.left = x < 55 ? `calc(${x}% + 16px)` : 'auto';
      tip.style.right = x < 55 ? 'auto' : `calc(${100 - x}% + 16px)`;
      tip.style.top = y < 70 ? `calc(${y}% - 10px)` : 'auto';
      tip.style.bottom = y < 70 ? 'auto' : `calc(${100 - y}% - 10px)`;
    };
    const spotOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('.mm-spot');
    map.addEventListener('pointerover', (e) => {
      if ((e as PointerEvent).pointerType !== 'touch' && spotOf(e)) show(spotOf(e));
    });
    map.addEventListener('pointerout', (e) => {
      if ((e as PointerEvent).pointerType !== 'touch' && spotOf(e)) show(stuck);
    });
    map.addEventListener('focusin', (e) => show(spotOf(e)));
    map.addEventListener('click', (e) => {
      // (a tap, or a click: it stays up until another is picked, or the map itself is pressed)
      const el = spotOf(e);
      stuck = el && el !== stuck ? el : null;
      show(stuck);
    });
  }

  setName(name: string) {
    (this.root.querySelector('.start-name') as HTMLInputElement).value = name;
  }

  nameValue() {
    return (this.root.querySelector('.start-name') as HTMLInputElement).value.trim().slice(0, 16);
  }

  /** players connected to the server right now (null = playing offline) */
  setOnline(count: number | null, max = 0) {
    const e = this.el.online;
    this.toggle(e, 'show', count !== null);
    if (count === null) return;
    (e.querySelector('b') as HTMLElement).textContent = String(count);
    (e.querySelector('span') as HTMLElement).textContent = `${max ? ` / ${max}` : ''} online`;
    this.setStartOnline(count);
  }

  /**
   * The same number on the start / pause screen.
   * @param max how many the server holds, when known: a full server says so, and how long the line is
   * @param waiting how many are in line for it
   */
  setStartOnline(count: number | null, max = 0, waiting = 0) {
    const e = this.root.querySelector('.start-online') as HTMLElement;
    const full = max > 0 && count !== null && count >= max;
    e.textContent =
      count === null ? ''
      : full ? `Full (${count}/${max})${waiting ? ` · ${waiting} waiting` : ''} · you will be put in line`
      : count === 0 ? 'Nobody else online yet'
      : `${count}${max ? ` / ${max}` : ''} online`;
    this.toggle(e, 'show', count !== null);
    this.toggle(e, 'full', full);
  }

  /**
   * Waiting in line for a full server: the place in it, and a way out. Null puts it away.
   * @param leave the player would rather play on their own than wait
   */
  setQueue(q: { pos: number; of: number; max: number } | null, leave?: () => void) {
    const e = this.root.querySelector('.start-queue') as HTMLElement;
    this.toggle(e, 'show', !!q);
    this.toggle(this.el.start, 'queued', !!q);
    if (!q) return;
    const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
    (e.querySelector('.sq-pos') as HTMLElement).textContent = q.pos === 1 ? 'You are next in line' : `You are ${nth(q.pos)} in line`;
    (e.querySelector('.sq-sub') as HTMLElement).textContent = `The server is full (${q.max} playing, ${q.of} waiting). Keep this tab open: you go in the moment a place is free.`;
    const b = e.querySelector('.sq-leave') as HTMLButtonElement;
    b.onclick = (ev) => {
      ev.stopPropagation();
      leave?.();
    };
  }

  private hotbarTapped: (key: string) => void = () => {};

  /** a hotbar slot was tapped or clicked: `key` is the number printed on it */
  onHotbar(cb: (key: string) => void) {
    this.hotbarTapped = cb;
  }

  // ---------------------------------------------------------------- menu: graphics, rewards

  private gfx: Graphics = { ...DEFAULT_GRAPHICS };
  private gfxChanged: (g: Graphics) => void = () => {};
  private gfxInfo: () => string = () => '';
  private rewardsClicked: () => void = () => {};

  /** the current options, what to do when the player changes one, and a line describing what is rendered */
  bindGraphics(g: Graphics, changed: (g: Graphics) => void, info: () => string) {
    this.gfx = { ...g };
    this.gfxChanged = changed;
    this.gfxInfo = info;
    this.renderGraphics();
  }

  /** the Rewards button appears once there is something for it to open */
  onRewards(cb: () => void) {
    this.rewardsClicked = cb;
    (this.root.querySelector('.start-tabs [data-tab="rewards"]') as HTMLElement).hidden = false;
  }

  private setGraphic(key: string, value: string) {
    const g = this.gfx;
    if (key === 'preset') Object.assign(g, PRESETS[value as PresetName]);
    else if (key === 'scale' || key === 'msaa' || key === 'fpsLimit' || key === 'volume') g[key] = Number(value);
    else if (key === 'ao') g.ao = value as Graphics['ao'];
    else if (key === 'shadows' || key === 'foliage') g[key] = value as Graphics['shadows'];
    saveGraphics(g);
    this.gfxChanged({ ...g });
    this.renderGraphics();
  }

  private renderGraphics() {
    const g = this.gfx;
    const row = (label: string, key: string, current: string | number | null, options: [string | number, string][]) =>
      `<div class="gfx-row"><span>${label}</span><div class="gfx-opts">${options.map(([v, t]) => `<button data-k="${key}" data-v="${v}"${v === current ? ' class="on"' : ''}>${t}</button>`).join('')}</div></div>`;
    const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
    (this.root.querySelector('.start-gfx') as HTMLElement).innerHTML =
      row('Preset', 'preset', presetOf(g), (Object.keys(PRESETS) as PresetName[]).map((p) => [p, cap(p)])) +
      row('Resolution', 'scale', g.scale, SCALES.map((s) => [s, `${Math.round(s * 100)}%`])) +
      row('Anti-aliasing', 'msaa', g.msaa, MSAA.map((m) => [m, m ? `${m}×` : 'Off'])) +
      row('Ambient occlusion', 'ao', g.ao, AO_MODES.map((a) => [a, a === 'off' ? 'Off' : a === 'half' ? 'Standard' : 'High'])) +
      row('Shadows', 'shadows', g.shadows, LEVELS.map((l) => [l, cap(l)])) +
      row('Foliage', 'foliage', g.foliage, LEVELS.map((l) => [l, cap(l)])) +
      row('Frame limit', 'fpsLimit', g.fpsLimit, FPS_LIMITS.map((f) => [f, f ? String(f) : 'Off'])) +
      row('Volume', 'volume', g.volume, VOLUMES.map((v) => [v, v ? `${v * 100}%` : 'Off'])) +
      `<div class="gfx-info">${this.gfxInfo()}</div>`;
  }

  // ---------------------------------------------------------------- chat

  /** channel the next message goes to (remembered between messages) */
  channel: ChatChannel = 'global';
  chatOpen = false;
  private chatSend: (ch: ChatChannel, text: string) => void = () => {};
  private chatClosed: () => void = () => {};

  onChat(send: (ch: ChatChannel, text: string) => void, closed: () => void) {
    this.chatSend = send;
    this.chatClosed = closed;
  }

  private setChannel(ch: ChatChannel) {
    this.channel = ch;
    const tag = this.root.querySelector('.chat-ch') as HTMLElement;
    tag.textContent = CHANNEL_LABEL[ch];
    tag.dataset.ch = ch;
  }

  openChat() {
    if (this.chatOpen) return;
    this.chatOpen = true;
    this.toggle(this.el.chat, 'open', true);
    const input = this.root.querySelector('.chat-input') as HTMLInputElement;
    input.value = '';
    input.focus();
    const log = this.root.querySelector('.chat-log') as HTMLElement;
    log.scrollTop = log.scrollHeight;
  }

  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.toggle(this.el.chat, 'open', false);
    (this.root.querySelector('.chat-input') as HTMLInputElement).blur();
    this.chatClosed();
  }

  /** every channel lands in the one log, tagged and coloured by channel */
  chatLine(ch: ChatChannel | 'system', from: string, text: string) {
    const log = this.root.querySelector('.chat-log') as HTMLElement;
    const n = document.createElement('div');
    n.className = 'chat-line';
    n.dataset.ch = ch;
    if (ch !== 'system') {
      const tag = document.createElement('i');
      tag.textContent = CHANNEL_LABEL[ch];
      const who = document.createElement('b');
      who.textContent = from;
      n.append(tag, who);
    }
    const body = document.createElement('span');
    body.textContent = text;
    n.appendChild(body);
    log.appendChild(n);
    while (log.children.length > 60) log.firstChild?.remove();
    log.scrollTop = log.scrollHeight;
  }

  /** connection line under the frame counter */
  setNet(text: string) {
    this.netText = text;
  }
  private netText = '';

  /** kill feed / server messages, top right */
  feed(text: string, mine = false) {
    const n = document.createElement('div');
    n.className = 'feed' + (mine ? ' mine' : '');
    n.textContent = text;
    this.el.feed.appendChild(n);
    setTimeout(() => n.classList.add('out'), 6500);
    setTimeout(() => n.remove(), 7300);
    while (this.el.feed.children.length > 6) this.el.feed.firstChild?.remove();
  }

  /**
   * The leaderboard under the map: the five at the top, this player's own line picked out,
   * and added underneath when they are further down. Null takes it away (playing alone).
   * @param rows [name, kills, tags cashed in], best first
   * @param me where this player stands in the whole list (-1 = not on it)
   * @param mine their own kills and tags
   */
  setBoard(rows: [string, number, number][] | null, me = -1, mine: [number, number] = [0, 0], name = '') {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    if (!rows) return this.set('board', this.el.board, '', 'html');
    const row = (n: number, r: [string, number, number], own: boolean) => `<div class="lb-row${own ? ' me' : ''}"><i>${n}</i><span>${esc(r[0])}</span><b>${r[1]}</b><b>${r[2]}</b></div>`;
    let html = `<div class="lb-head"><span>Leaderboard</span><b title="kills">Kills</b><b title="tags cashed in">Tags</b></div>`;
    html += rows.length ? rows.map((r, i) => row(i + 1, r, i === me)).join('') : `<div class="lb-none">No kills or tags yet</div>`;
    if (me >= rows.length) html += `<div class="lb-gap"></div>` + row(me + 1, [name || 'You', mine[0], mine[1]], true);
    this.set('board', this.el.board, html, 'html');
  }

  /** other players' dog tags being carried, each with the time left until it is cashed in */
  setTags(list: { name: string; clock: string }[]) {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    this.set('tags', this.el.tags, list.map((t) => `<div class="tag-row"><i></i><span>${esc(t.name)}</span><b>${t.clock}</b></div>`).join(''), 'html');
  }

  /** flash an arc on the side the hit came from (angle relative to where you are looking) */
  hitFrom(angle: number) {
    const a = this.el.hitdir;
    a.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    a.classList.remove('show');
    void a.offsetWidth;
    a.classList.add('show');
  }

  /** the connection is gone: nothing more can happen until the page reloads */
  fatal(reason: string) {
    (this.root.querySelector('.fatal-sub') as HTMLElement).textContent = reason;
    this.toggle(this.el.fatal, 'show', true);
    this.toggle(this.el.start, 'show', false);
  }

  private startClicked: () => void = () => {};

  /**
   * The click that starts a game, or goes back into one. Before a game it is the button and
   * nothing else (a stray click on the way in should not take the mouse); from the pause it is
   * the button or anywhere on the picture behind the menu, as it always was. Either way it is
   * the same click that captures the mouse.
   */
  onStart(cb: () => void) {
    this.startClicked = cb;
    this.el.start.onclick = (e) => {
      const t = e.target as HTMLElement;
      const paused = this.el.start.classList.contains('paused');
      const bare = t === this.el.start || t.classList.contains('sm-main') || t.classList.contains('sm-hero') || t.classList.contains('sm-cut');
      if (!t.closest('.start-btn') && !(paused && bare)) return;
      if (this.el.start.classList.contains('busy')) return;
      e.preventDefault();
      cb();
    };
  }

  onRespawn(cb: () => void) {
    // the Disconnected screen's Reconnect button shares the style: pick the one on the death screen
    (this.root.querySelector('.hud-dead .dead-btn') as HTMLButtonElement).onclick = cb;
  }

  update(s: {
    vitals: Vitals;
    /** out of breath: no sprinting until the bar has come back a way */
    winded: boolean;
    prompt: string | null;
    /** where on screen the thing the prompt is about sits, as fractions of the screen (null = no marker) */
    mark: [number, number] | null;
    weapon: { name: string; ammo: { loaded: number; reserve: number; cap: number } | null; action: string | null; mode: string | null } | null;
    /** looking through binoculars */
    glass: boolean;
    aiming: boolean;
    /** how wide the next shot can go, radians (0 = nothing that shoots in the hands) */
    spread: number;
    /** where the gun is pointing, off the middle of the screen, in pixels (it trails a fast turn) */
    lag: [number, number];
    /** what is left in the arms, 0..1 (see Weapons.armStamina) */
    arms: number;
    /** sat in a jeep: how fast it is going, and what it has left in the tank and in itself (0..1) */
    ride?: { kmh: number; fuel: number; hp: number; driver: boolean } | null;
    scoped: boolean;
    /** aimed with a gun that has no sights: the mark stays on the screen */
    sightless?: boolean;
    hitMarker: number;
    kill: boolean;
    /** the hit was to the head */
    head: boolean;
    hurt: number;
    /** an open wound: what to do about it (html), or null when not bleeding */
    bleed: string | null;
    heading: number | null;
    /** carrying a compass: the heading is also given in degrees */
    bearing: boolean;
    progress: { label: string; t: number } | null;
    hotbar: HotbarEntry[];
    fps: number;
    ping: number | null;
    dead: boolean;
    deadText: string;
    hidden: boolean;
  }) {
    const e = this.el;
    this.toggle(this.root, 'hidden', s.hidden);
    this.toggle(e.cross, 'off', (s.aiming && !s.sightless) || s.scoped || s.glass || s.dead || !!s.ride);
    // the four ticks stand as far out as the shot can land: half the cone, at this field of view
    this.toggle(e.cross, 'gun', s.spread > 0);
    const lag = `${s.lag[0].toFixed(1)}px,${s.lag[1].toFixed(1)}px`;
    if (this.last.lag !== lag) {
      this.last.lag = lag;
      e.cross.style.translate = lag.replace(',', ' ');
    }
    const gap = String(Math.round(3 + s.spread * 357));
    if (s.spread > 0 && this.last.gap !== gap) {
      this.last.gap = gap;
      e.cross.style.setProperty('--gap', gap + 'px');
    }
    this.toggle(e.scope, 'show', s.scoped || s.glass);
    this.toggle(e.scope, 'glass', s.glass && !s.scoped);
    this.toggle(e.hit, 'show', s.hitMarker > 0);
    this.toggle(e.hit, 'kill', s.kill);
    this.toggle(e.hit, 'head', s.head && !s.kill);

    // hotbar: rebuilt only when something on it changes
    let sig = '';
    for (const h of s.hotbar) sig += `${h.id ?? ''}|${h.label}|${h.active ? 1 : 0}${h.dim ? 1 : 0};`;
    if (sig !== this.last.hotbar) {
      this.last.hotbar = sig;
      e.hotbar.innerHTML = s.hotbar
        .map((h, i) => {
          const icon = h.id && this.icons[h.id] ? `<i style="background-image:url(${this.icons[h.id]})"></i>` : '';
          return `${i === 4 ? '<span class="hb-gap"></span>' : ''}<div class="hb${h.active ? ' on' : ''}${h.dim ? ' dim' : ''}${h.id ? '' : ' empty'}"><b>${h.key}</b>${icon}<em>${h.label}</em></div>`;
        })
        .join('');
    }

    this.set('prompt', e.prompt, s.prompt ? s.prompt : '', 'html');
    this.toggle(e.prompt, 'show', !!s.prompt);
    this.toggle(e.mark, 'show', !!s.mark);
    if (s.mark) {
      const at = `${(s.mark[0] * 100).toFixed(1)}%|${(s.mark[1] * 100).toFixed(1)}%`;
      if (this.last.mark !== at) {
        this.last.mark = at;
        [e.mark.style.left, e.mark.style.top] = at.split('|');
      }
    }

    // Vitals: each a bar and a number out of a hundred, always there to be read. (They were
    // three faint icons that only changed colour, and nobody could tell how much they had.)
    const v = s.vitals;
    const band = (x: number) => (x > 70 ? 'ok' : x > 40 ? 'mid' : x > 15 ? 'low' : 'crit');
    for (const [k, val] of [['health', v.health], ['energy', v.energy], ['water', v.water]] as [string, number][]) {
      // (never "0" on somebody still alive)
      const n = String(Math.max(0, Math.min(100, Math.ceil(val))));
      if (this.last[`vital ${k}`] === n) continue;
      this.last[`vital ${k}`] = n;
      const el = e.vitals.querySelector(`[data-k="${k}"]`) as HTMLElement;
      el.dataset.band = band(val);
      (el.querySelector('i') as HTMLElement).style.width = `${n}%`;
      (el.lastElementChild as HTMLElement).textContent = n;
    }
    const bleed = e.vitals.querySelector('[data-k="bleed"]') as HTMLElement;
    this.toggle(bleed, 'show', v.bleeding);
    // and said in words, with the key to press: an icon in the corner is easy to bleed out under
    this.toggle(e.bleed, 'show', s.bleed !== null);
    this.toggle(e.bleedfx, 'show', s.bleed !== null);
    if (s.bleed !== null) this.set('bleed', e.bleed.lastElementChild as HTMLElement, s.bleed, 'html');
    const reserve = (v.stamina / MAX_STAMINA) * 100;
    (e.stamina.firstElementChild as HTMLElement).style.width = `${reserve}%`;
    this.toggle(e.stamina, 'show', reserve < 99.5);
    this.toggle(e.stamina, 'spent', s.winded);
    (e.arms.firstElementChild as HTMLElement).style.width = `${s.arms * 100}%`;
    this.toggle(e.arms, 'show', s.arms < 0.995);
    this.toggle(e.arms, 'spent', s.arms < 0.15);
    this.toggle(e.ride, 'show', !!s.ride);
    if (s.ride) {
      this.set('kmh', e.ride.firstElementChild as HTMLElement, String(Math.round(s.ride.kmh)));
      const [fuel, hp] = [...e.ride.querySelectorAll('i')] as HTMLElement[];
      fuel.style.width = `${Math.round(s.ride.fuel * 100)}%`;
      hp.style.width = `${Math.round(s.ride.hp * 100)}%`;
      this.toggle(fuel.parentElement!, 'low', s.ride.fuel < 0.15);
      this.toggle(hp.parentElement!, 'low', s.ride.hp < 0.4);
    }

    if (s.weapon) {
      this.toggle(e.weapon, 'show', true);
      this.set('wname', e.weapon.firstElementChild as HTMLElement, s.weapon.name + (s.weapon.mode ? ` · ${s.weapon.mode === 'auto' ? 'AUTO' : 'SEMI'}` : ''));
      const a = s.weapon.ammo;
      const txt = a ? `<b>${a.loaded}</b><span>/${a.cap}</span> <em>${a.reserve}</em>` : '';
      this.set('wammo', e.weapon.lastElementChild as HTMLElement, txt + (s.weapon.action === 'reload' || s.weapon.action === 'magswap' ? ' <i>reloading</i>' : ''), 'html');
    } else this.toggle(e.weapon, 'show', false);

    if (s.heading !== null) {
      this.toggle(e.compass, 'show', true);
      const deg = ((s.heading % 360) + 360) % 360;
      (e.compass.firstElementChild as HTMLElement).style.transform = `translateX(${-deg * 4}px)`;
      this.toggle(e.bearing, 'show', s.bearing);
      if (s.bearing) this.set('bearing', e.bearing, `${String(Math.round(deg) % 360).padStart(3, '0')}°`);
    } else {
      this.toggle(e.compass, 'show', false);
      this.toggle(e.bearing, 'show', false);
    }

    if (s.progress) {
      this.toggle(e.progress, 'show', true);
      this.set('plabel', e.progress.firstElementChild as HTMLElement, s.progress.label);
      ((e.progress.lastElementChild as HTMLElement).firstElementChild as HTMLElement).style.width = `${Math.min(100, s.progress.t * 100)}%`;
    } else this.toggle(e.progress, 'show', false);

    e.damage.style.opacity = String(Math.min(1, s.hurt * 0.9 + (v.health < 25 ? 0.35 + 0.15 * Math.sin(performance.now() / 300) : 0)));
    this.set('fps', e.fps, `${Math.round(s.fps)} fps`);
    this.set('net', e.net, this.netText + (s.ping !== null ? ` · ${s.ping} ms` : ''));
    this.toggle(e.dead, 'show', s.dead);
    if (s.dead) this.set('dead', e.dead.querySelector('.dead-sub') as HTMLElement, s.deadText);
  }
}
