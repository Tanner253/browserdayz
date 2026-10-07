// A lean HUD: small vitals, a compass strip, a corner map (src/ui/minimap.ts), prompts
// only when relevant. Plain DOM; updated once per frame with cheap diffs.

import type { Vitals } from '../game/player';
import { MAX_STAMINA, type ChatChannel } from '../net/protocol';
import { TOUCH } from '../core/device';
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

export interface HotbarEntry {
  key: string;
  id: string | null;
  label: string;
  active: boolean;
  dim: boolean;
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
      <div class="hud-progress"><div class="hud-progress-label"></div><div class="hud-progress-bar"><div></div></div></div>
      <div class="hud-compass"><div class="hud-compass-strip"></div><div class="hud-compass-needle"></div></div>
      <div class="hud-bearing"></div>
      <div class="hud-area"></div>
      <div class="hud-notes"></div>
      <div class="hud-weapon"><div class="hud-weapon-name"></div><div class="hud-weapon-ammo"></div></div>
      <div class="hud-vitals">
        <div class="vital" data-k="health">${svg(ICONS.health)}</div>
        <div class="vital" data-k="energy">${svg(ICONS.food)}</div>
        <div class="vital" data-k="water">${svg(ICONS.water)}</div>
        <div class="vital bleed" data-k="bleed">${svg(ICONS.blood)}</div>
      </div>
      <div class="hud-stamina"><div></div></div>
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
      <div class="hud-tags"></div>
      <div class="hud-fatal"><div class="fatal-title">Disconnected</div><div class="fatal-sub"></div><button class="dead-btn fatal-btn">Reconnect</button></div>
      <div class="hud-dead"><div class="dead-title">You are dead</div><div class="dead-sub"></div><button class="dead-btn">Respawn</button></div>
      <div class="hud-start">
        <div class="start-shell">
          <div class="start-id">
            <div class="start-kicker">Zelenaya Dolina · one persistent world</div>
            <div class="start-title" aria-label="ZONA"><span style="--i:0">Z</span><span style="--i:1">O</span><span style="--i:2">N</span><span style="--i:3">A</span></div>
            <div class="start-sub">Loot. Fight. Stay alive for thirty minutes.</div>
            <div class="tagplate">
              <svg class="tagplate-chain" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="0.1 9" stroke-linecap="round"/></svg>
              <label for="start-name">Stamp your dog tag</label>
              <input id="start-name" class="start-name" maxlength="16" spellcheck="false" autocomplete="off" placeholder="Survivor">
              <div class="tagplate-meta"><span>ZONA</span><span>Survivor</span></div>
            </div>
            <button class="start-btn">Deploy</button>
            <div class="start-online"></div>
          </div>
          <div class="start-brief" data-tab="brief">
            <div class="start-tabs">
              <button data-tab="brief" class="on">Briefing</button>
              <button data-tab="keys">Controls</button>
              <button data-tab="gfx">Settings</button>
              <button data-tab="rewards" hidden>Rewards</button>
            </div>
            <div class="start-pane pane-brief">
              <figure class="start-map"></figure>
              <ol class="start-loop">
                <li style="--i:0"><i class="loop-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><path d="M12 3v7M9 8l3 3 3-3"/></svg></i><div><b>Drop in</b><span>On the edge of the map, bare hands. The nearest marked place always has a weapon.</span></div></li>
                <li style="--i:1"><i class="loop-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l8-4 8 4v8l-8 4-8-4z"/><path d="M4 9l8 4 8-4M12 13v8"/></svg></i><div><b>Loot inward</b><span>Any building can hold a gun. The police station in the middle holds the most.</span></div></li>
                <li style="--i:2"><i class="loop-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg></i><div><b>Fight</b><span>Anyone you meet can kill you and take everything.</span></div></li>
                <li style="--i:3"><i class="loop-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="14" height="9" rx="3"/><circle cx="8.5" cy="12.5" r="1"/><path d="M12 11h4M12 14h3M8 8c-3-5 3-7 5-3"/></svg></i><div><b>Take their tag</b><span>Every body carries a dog tag. Loot it.</span></div></li>
                <li style="--i:4"><i class="loop-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg></i><div><b>Hold 30:00</b><span>Stay alive with it for thirty minutes to cash it in.</span></div></li>
              </ol>
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
                  <div class="kb-row"><kbd>5</kbd><kbd>6</kbd><kbd>7</kbd><kbd>8</kbd><em>eat · drink · bandage</em></div>
                  <p><kbd>F</kbd> take · doors · search <kbd>G</kbd> hold: drop what you hold</p>
                  <p><kbd class="wide">Tab</kbd> inventory <kbd>M</kbd> map</p>
                  <p><kbd class="wide">Enter</kbd> chat</p>
                  <p><kbd>V</kbd> third person</p>
                  <p><kbd class="wide">Esc</kbd> this menu</p>
                  <p><kbd class="wide">F3</kbd> performance</p>
                </div>
              </div>
            </div>
            <div class="start-pane pane-gfx start-gfx"></div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('ui')!.appendChild(this.root);
    for (const k of ['cross', 'hit', 'prompt', 'mark', 'progress', 'compass', 'bearing', 'area', 'weapon', 'vitals', 'stamina', 'hotbar', 'chat', 'scope', 'damage', 'bleedfx', 'bleed', 'hitdir', 'fps', 'online', 'net', 'feed', 'tags', 'fatal', 'dead', 'start']) {
      this.el[k] = this.root.querySelector(`.hud-${k}`) as HTMLElement;
    }
    this.notes = this.root.querySelector('.hud-notes') as HTMLDivElement;
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
    // typing a name must not start the game
    const name = this.root.querySelector('.start-name') as HTMLInputElement;
    const plate = this.root.querySelector('.tagplate') as HTMLElement;
    plate.addEventListener('click', (e) => {
      e.stopPropagation();
      name.focus();
    });
    // every letter is struck into the plate
    name.addEventListener('input', () => {
      plate.classList.remove('stamp');
      void plate.offsetWidth;
      plate.classList.add('stamp');
    });
    name.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') name.blur();
    });
    // the menu under the Play button: its clicks are not "click to play"
    const card = this.root.querySelector('.start-brief') as HTMLElement;
    card.addEventListener('click', (e) => e.stopPropagation());
    const tabs = this.root.querySelector('.start-tabs') as HTMLElement;
    tabs.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = (e.target as HTMLElement).closest('button')?.dataset.tab;
      if (!tab) return;
      if (tab === 'rewards') return this.rewardsClicked();
      card.dataset.tab = tab;
      for (const b of tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === tab);
      if (tab === 'gfx') this.renderGraphics();
    });
    const gfx = this.root.querySelector('.start-gfx') as HTMLElement;
    gfx.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.k) this.setGraphic(b.dataset.k, b.dataset.v ?? '');
    });
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

  showStart(on: boolean, paused = false, text = '') {
    this.toggle(this.el.start, 'show', on);
    this.toggle(this.el.start, 'paused', paused);
    (this.root.querySelector('.start-btn') as HTMLButtonElement).textContent = text || (paused ? 'Resume' : 'Deploy');
    if (!on) this.el.start.classList.remove('enter');
  }

  /** The loading screen is lifting: play the entrance (title, panels) once. */
  entrance() {
    if (this.el.start.classList.contains('show')) this.el.start.classList.add('enter');
  }

  /**
   * The briefing map, drawn from the world itself: where fresh characters start, where
   * the landmarks are, and which way the loot gets better.
   */
  setBriefing(d: { radius: number; spawns: { x: number; z: number }[]; centre: { x: number; z: number }; places: { name: string; x: number; z: number; kind: 'town' | 'police' | 'post' | 'site' }[] }) {
    const n = (v: number) => v.toFixed(0);
    const c = d.centre;
    const flows = d.spawns
      .filter((_, i) => i % 3 === 0)
      .map((s, i) => {
        const dx = c.x - s.x, dz = c.z - s.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        return `<path class="m-flow" style="--i:${i}" d="M${n(s.x + ux * 26)} ${n(s.z + uz * 26)}L${n(c.x - ux * 150)} ${n(c.z - uz * 150)}" marker-end="url(#m-arrow)"/>`;
      })
      .join('');
    const spawns = d.spawns.map((s, i) => `<g class="m-spawn" style="--i:${i % 8}"><circle class="m-pulse" cx="${n(s.x)}" cy="${n(s.z)}" r="9"/><circle cx="${n(s.x)}" cy="${n(s.z)}" r="5.5"/></g>`).join('');
    const places = d.places
      .map((p) => {
        // the outlying places are many and small: a mark each, no name (the name shows when you get there)
        if (p.kind === 'site') return `<g class="m-place m-site" transform="translate(${n(p.x)} ${n(p.z)})"><title>${p.name}</title><rect x="-11" y="-11" width="22" height="22" transform="rotate(45)"/></g>`;
        const mark = p.kind === 'police' ? `<path d="M0-13L11-7V4C11 11 0 15 0 15S-11 11-11 4V-7Z"/>` : p.kind === 'town' ? '' : `<rect x="-8" y="-8" width="16" height="16"/>`;
        // labels step away from the middle so they never sit on top of each other
        const below = p.kind === 'town';
        return `<g class="m-place m-${p.kind}" transform="translate(${n(p.x)} ${n(p.z)})">${mark}<text y="${below ? 62 : -26}" text-anchor="middle">${p.name}</text></g>`;
      })
      .join('');
    const R = d.radius;
    (this.root.querySelector('.start-map') as HTMLElement).innerHTML = `
      <svg viewBox="${-R - 70} ${-R - 70} ${2 * R + 140} ${2 * R + 140}" role="img" aria-label="Map: you start on the outer ring, the best loot is in the middle">
        <defs>
          <radialGradient id="m-heat"><stop offset="0" stop-color="#c9b27c" stop-opacity="0.55"/><stop offset="0.55" stop-color="#c9b27c" stop-opacity="0.14"/><stop offset="1" stop-color="#c9b27c" stop-opacity="0"/></radialGradient>
          <marker id="m-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="#c9b27c" stroke-width="1.6"/></marker>
        </defs>
        <circle cx="${n(c.x)}" cy="${n(c.z)}" r="${n(R * 0.72)}" fill="url(#m-heat)"/>
        <circle class="m-tier" cx="${n(c.x)}" cy="${n(c.z)}" r="${n(R * 0.36)}"/>
        <circle class="m-tier" cx="${n(c.x)}" cy="${n(c.z)}" r="${n(R * 0.68)}"/>
        <circle class="m-edge" cx="0" cy="0" r="${n(R)}"/>
        ${flows}${spawns}${places}
      </svg>
      <figcaption><span class="lg-spawn"></span>start<span class="lg-site"></span>weapon here<span class="lg-loot"></span>better loot</figcaption>`;
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

  /** the same number on the start / pause screen */
  setStartOnline(count: number | null) {
    const e = this.root.querySelector('.start-online') as HTMLElement;
    e.textContent = count === null ? '' : count === 0 ? 'Nobody else is online yet' : `${count} survivor${count === 1 ? '' : 's'} online`;
    this.toggle(e, 'show', count !== null);
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

  /** the whole overlay is a click target so the click that resumes also captures the mouse */
  onStart(cb: () => void) {
    this.el.start.onclick = (e) => {
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
    prompt: string | null;
    /** where on screen the thing the prompt is about sits, as fractions of the screen (null = no marker) */
    mark: [number, number] | null;
    weapon: { name: string; ammo: { loaded: number; reserve: number; cap: number } | null; action: string | null; mode: string | null } | null;
    /** looking through binoculars */
    glass: boolean;
    aiming: boolean;
    /** how wide the next shot can go, radians (0 = nothing that shoots in the hands) */
    spread: number;
    scoped: boolean;
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
    this.toggle(e.cross, 'off', s.aiming || s.scoped || s.glass || s.dead);
    // the four ticks stand as far out as the shot can land: half the cone, at this field of view
    this.toggle(e.cross, 'gun', s.spread > 0);
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

    // vitals: colour bands like DayZ (hidden when healthy)
    const v = s.vitals;
    const band = (x: number) => (x > 70 ? 'ok' : x > 40 ? 'mid' : x > 15 ? 'low' : 'crit');
    for (const [k, val] of [['health', v.health], ['energy', v.energy], ['water', v.water]] as [string, number][]) {
      const el = e.vitals.querySelector(`[data-k="${k}"]`) as HTMLElement;
      const b = band(val);
      if (el.dataset.band !== b) {
        el.dataset.band = b;
      }
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
