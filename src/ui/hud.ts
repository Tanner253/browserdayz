// Minimal, diegetic-leaning HUD in the DayZ tradition: no minimap, small vitals,
// prompts only when relevant. Plain DOM; updated once per frame with cheap diffs.

import type { Vitals } from '../game/player';
import type { ChatChannel } from '../net/protocol';

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
      <div class="hud-cross"></div>
      <div class="hud-hit"><i></i><i></i><i></i><i></i></div>
      <div class="hud-prompt"></div>
      <div class="hud-progress"><div class="hud-progress-label"></div><div class="hud-progress-bar"><div></div></div></div>
      <div class="hud-compass"><div class="hud-compass-strip"></div><div class="hud-compass-needle"></div></div>
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
      <div class="hud-hitdir"><i></i></div>
      <div class="hud-fps"></div>
      <div class="hud-online"><i></i><b></b><span></span></div>
      <div class="hud-net"></div>
      <div class="hud-feed"></div>
      <div class="hud-fatal"><div class="fatal-title">Disconnected</div><div class="fatal-sub"></div><button class="dead-btn fatal-btn">Reconnect</button></div>
      <div class="hud-dead"><div class="dead-title">You are dead</div><div class="dead-sub"></div><button class="dead-btn">Respawn</button></div>
      <div class="hud-start">
        <div class="start-card">
          <div class="start-title">ZONA</div>
          <div class="start-sub">vertical slice · Zelenaya Dolina</div>
          <div class="start-nameRow"><label>Name</label><input class="start-name" maxlength="16" spellcheck="false" autocomplete="off" placeholder="Survivor"></div>
          <button class="start-btn">Click to play</button>
          <div class="start-online"></div>
          <div class="start-keys">
            <div><b>WASD</b> move · <b>Alt</b> walk</div><div><b>Shift</b> sprint · hold breath (scoped)</div>
            <div><b>C</b> crouch · <b>Space</b> jump</div><div><b>Q / E</b> lean</div>
            <div><b>LMB</b> fire · punch</div><div><b>RMB</b> aim · raise fists</div>
            <div><b>R</b> reload</div><div><b>X</b> holster (bare hands)</div>
            <div><b>1 2</b> primary · secondary</div><div><b>3 4</b> pistol · melee</div>
            <div><b>5 – 8</b> eat · drink · bandage</div><div><b>Wheel</b> cycle weapons</div>
            <div><b>F</b> take · doors · search crates</div><div><b>Tab</b> inventory (right-click items)</div>
            <div><b>Enter</b> chat · <b>Tab</b> switches channel</div><div><b>Esc</b> release mouse / pause</div>
            <div><b>V</b> third person · <b>P</b> free cam</div><div><b>F3</b> performance</div>
          </div>
          <div class="start-hint">You wake up on the edge of the map with empty hands, something to eat and something to drink. The best loot is in the middle: the police station in Zelenaya Dolina has guns and attachments. Clothes and bags let you carry more. Other survivors can kill you and take everything.</div>
        </div>
      </div>
    `;
    document.getElementById('ui')!.appendChild(this.root);
    for (const k of ['cross', 'hit', 'prompt', 'progress', 'compass', 'area', 'weapon', 'vitals', 'stamina', 'hotbar', 'chat', 'scope', 'damage', 'hitdir', 'fps', 'online', 'net', 'feed', 'fatal', 'dead', 'start']) {
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
    name.addEventListener('click', (e) => e.stopPropagation());
    name.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') name.blur();
    });
    // scale the whole HUD with the window so it reads the same on a laptop and a 1440p monitor
    const fit = () => document.documentElement.style.setProperty('--ui-zoom', String(Math.round(Math.max(0.7, Math.min(1.7, window.innerHeight / 860, window.innerWidth / 1400)) * 100) / 100));
    fit();
    window.addEventListener('resize', fit);
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
    (this.root.querySelector('.start-btn') as HTMLButtonElement).textContent = text || (paused ? 'Paused · click to resume' : 'Click to play');
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
    (this.root.querySelector('.dead-btn') as HTMLButtonElement).onclick = cb;
  }

  update(s: {
    vitals: Vitals;
    prompt: string | null;
    weapon: { name: string; ammo: { loaded: number; reserve: number; cap: number } | null; action: string | null; mode: string | null } | null;
    aiming: boolean;
    scoped: boolean;
    hitMarker: number;
    kill: boolean;
    hurt: number;
    heading: number | null;
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
    this.toggle(e.cross, 'off', s.aiming || s.scoped || s.dead);
    this.toggle(e.scope, 'show', s.scoped);
    this.toggle(e.hit, 'show', s.hitMarker > 0);
    this.toggle(e.hit, 'kill', s.kill);

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
    (e.stamina.firstElementChild as HTMLElement).style.width = `${v.stamina}%`;
    this.toggle(e.stamina, 'show', v.stamina < 99);

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
    } else this.toggle(e.compass, 'show', false);

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
