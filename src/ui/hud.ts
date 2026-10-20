// A lean HUD: small vitals, a compass strip, a corner map (src/ui/minimap.ts), prompts
// only when relevant. Plain DOM; updated once per frame with cheap diffs.

import { offer, type Offer, type Pick, type Role } from '../net/orders';
import { fullWanted, reloadPage, wantFull } from '../core/leave';
import type { Vitals } from '../game/player';
import { BLOOD } from '../sim/blood';
import { bleedLevel } from './status';
import { StatusView, figuresWanted, symbol, wantFigures } from './status-view';
import { KeysView } from './keys-view';
import type { KeyHints } from '../game/key-hints';
import { BACK_SHORT, BACK_WHY, mountUpdates } from './updates';
import { MAX_STAMINA, type ChatChannel } from '../net/protocol';
import { ACTIONS, AIM, KEY_GROUPS, PAD_SENS, SENS, bind, bindable, controls, keyName, keyOf, relabel, setControls, shown, type Controls } from '../core/keys';
import { GROUPS, type Group, type Mix } from '../core/audio';
import { TOUCH } from '../core/device';
import { EMOTE } from '../sim/emotes';
import { onWheelSlots, wheelSlots, wheelSvg } from './wheel-slots';
import { TIERS, type Tier } from '../sim/tiers';
import { ITEMS, TAG_FRESH, TAG_HOLD_MIN, ZONA_VOID } from '../sim/items';
import { kindIcon } from './kind-icons';
import { howtoMore } from './howto-more';
import { INFECTED } from '../sim/infected';
import { GAS } from '../sim/gas';
import { dogTag } from './dogtag';
import { EmotesMenu } from './emotes-menu';
import { crownEl, hideCrownTip } from './elite-crown';
import { AO_MODES, DEFAULT_GRAPHICS, DRAWS, FPS_LIMITS, LEVELS, MSAA, PRESETS, SCALES, loadMix, presetOf, saveGraphics, saveMix, type Graphics, type PresetName } from '../core/settings';

/**
 * The settings, a page at a time, as a game has them (2026-10-13: "tab the settings menu like a video game would be
 * tabbed"): what each page is called. The first is the one shown when the settings are opened, and that is the
 * controls: the mouse's sensitivity is at the head of them, where it was at the head of the settings before they had
 * pages, and is the first thing anybody opening them sees. (Game has one thing on it yet, and is last.)
 */
const SET_TABS = [['controls', 'Controls'], ['audio', 'Audio'], ['video', 'Video'], ['game', 'Game']] as const;
type SetTab = (typeof SET_TABS)[number][0];
/** the four groups of sound under the one volume (src/core/audio.ts, GROUPS): what each is called, and what it turns */
const MIX_ROWS: Record<Group, [name: string, turns: string]> = {
  fx: ['Effects', 'Guns, blasts, footsteps, doors'],
  voice: ['Voice', 'Other players talking, and the calls said aloud'],
  ambience: ['Ambience', 'Wind, birds, fires, the bunker'],
  ui: ['Interface', 'Your pockets, and the tick of a shot landing'],
  vehicles: ['Vehicles', 'Jeeps and helicopters'],
};

const CHANNELS: ChatChannel[] = ['global', 'near'];
const CHANNEL_LABEL: Record<ChatChannel | 'system' | 'pm', string> = { global: 'Global', near: 'Proximity', staff: 'Staff', system: '', pm: 'To you' };

/** A mark on the menu's map: where it is in the world, what it is called, and what is said of it when it is pointed at. */
export interface MenuSpot {
  x: number;
  z: number;
  name: string;
  tip: string;
  kind: 'town' | 'police' | 'clinic' | 'shop' | 'trader' | 'army' | 'site' | 'gas' | 'spawn' | 'well';
  /** its name is always shown, not only when pointed at */
  label?: boolean;
  /** which step of the map it is (src/sim/tiers.ts), and what is to be had there */
  tier?: Tier;
  finds?: string;
}

/**
 * One thing the hands can do with what is in them, and what does it: the left button, the right, or the wheel.
 * Drawn in the corner as a small mouse with that part of it lit and the word beside it, as DayZ draws it (asked for
 * 2026-10-11: "there should be a icon on the bottom right or left of the screen showing what to press").
 */
export interface HandAct {
  on: 'l' | 'r' | 'w';
  /** done for as long as it is held */
  hold?: boolean;
  text: string;
  /** a figure or two under the word */
  sub?: string;
}

/** a mouse, small, with one part of it lit */
const mouseSvg = (on: HandAct['on']) => `<svg viewBox="26 4 68 108" aria-hidden="true"><rect class="m-body" x="30" y="8" width="60" height="100" rx="30"/><path class="m-part${on === 'l' ? ' on' : ''}" d="M57 11C43 12.5 33 23 33 38v6h24z"/><path class="m-part${on === 'r' ? ' on' : ''}" d="M63 11c14 1.5 24 12 24 27v6H63z"/><path class="m-line" d="M60 8v38M30 46h60"/><rect class="m-wheel${on === 'w' ? ' on' : ''}" x="54" y="18" width="12" height="22" rx="6"/></svg>`;

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

/** an entry of the game's own changelog, as the menu's Updates panel lists it */
interface LogEntry {
  id: string;
  title: string;
  /** its day, as the page says it */
  when: string;
  /** the sentence or two under its title */
  lead: string;
}
/** how many of them the panel lists */
const LOG_SHOWN = 4;
/** kept in the browser: whether the Updates panel was left open, and the newest of each kind that was in it when it last was */
const NEWS_OPEN = 'zona.updates.open', NEWS_SEEN = 'zona.updates.seen';

/**
 * The entries of the changelog, newest first, read off the page the site serves (public/changelog/index.html: each
 * is an <article class="entry"> with an id, a day and a title). It is the page itself that is asked for, so what the
 * menu lists is whatever was last published with the front end, and nothing is kept in step by hand. None, if the
 * page cannot be had.
 */
async function changelog(): Promise<LogEntry[]> {
  try {
    const r = await fetch('/changelog/index.html', { cache: 'no-cache' });
    if (!r.ok) return [];
    const page = new DOMParser().parseFromString(await r.text(), 'text/html');
    const out: LogEntry[] = [];
    for (const a of page.querySelectorAll('article.entry[id]')) {
      const title = a.querySelector('h2')?.textContent?.trim();
      // (its id goes into a link: letters, figures and hyphens, or the entry is left out)
      if (!title || !/^[\w-]+$/.test(a.id)) continue;
      out.push({ id: a.id, title, when: a.querySelector('time')?.textContent?.trim() ?? '', lead: a.querySelector('.lead')?.textContent?.trim() ?? '' });
    }
    return out;
  } catch {
    return [];
  }
}

/** everything there is to be given (never a tag: one is only ever taken from somebody) */
const THINGS = Object.values(ITEMS).filter((d) => d.id !== 'dogtag').map((d) => ({ id: d.id, name: d.name }));

/**
 * Blood on the glass: three splashes, each a pool with what flew off it and the run below, drawn as a picture the
 * browser makes once (a rough edge from noise, and the pool and its drops run together where they touch).
 */
const splash = (seed: number, pool: string, flecks: string, run: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 150'><defs><filter id='f' x='-30%' y='-30%' width='160%' height='160%'><feTurbulence type='fractalNoise' baseFrequency='0.05' numOctaves='2' seed='${seed}' result='n'/><feDisplacementMap in='SourceGraphic' in2='n' scale='18'/><feGaussianBlur stdDeviation='1.7' result='b'/><feColorMatrix in='b' values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 15 -5.5'/></filter><radialGradient id='g' cx='42%' cy='26%' r='80%'><stop offset='0' stop-color='#8e0e09'/><stop offset='.5' stop-color='#5e0402'/><stop offset='1' stop-color='#330100'/></radialGradient></defs><g filter='url(#f)' fill='url(#g)' opacity='.88'>${pool}${flecks}${run}</g></svg>`,
  )}")`;
/**
 * Each splash drawn once into a plain picture, as soon as the HUD is made (2026-10-17, the stutter players felt in a
 * fight, "when i get into a fight i lag a lot"): its noise, warp and blur are among the dearest things a browser draws,
 * and drawn as an SVG it was drawn again on the first drop of a fight (a frame of 100 ms) and as each drop grew. The
 * SVG is what is shown until its picture is ready.
 */
const bakeSplashes = (): Promise<string[]> =>
  Promise.all(
    SPLASHES.map(
      (svg) =>
        new Promise<string>((done) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            // (as sharp as the biggest drop, 110 by 165, on a screen of two pixels to a point)
            c.width = 240;
            c.height = 360;
            c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
            done(`url("${c.toDataURL('image/png')}")`);
          };
          img.onerror = () => done(svg);
          img.src = svg.slice(5, -2);
        }),
    ),
  );
const SPLASHES = [
  splash(3, "<ellipse cx='50' cy='42' rx='27' ry='23'/>", "<circle cx='18' cy='24' r='5'/><circle cx='86' cy='52' r='4.5'/><circle cx='72' cy='12' r='3.5'/><circle cx='12' cy='58' r='3'/><circle cx='88' cy='22' r='2.5'/>", "<path d='M45 56 Q47 104 49 136 Q50 142 52 136 Q54 104 56 56 Z'/>"),
  splash(11, "<ellipse cx='48' cy='38' rx='22' ry='27'/>", "<circle cx='80' cy='30' r='6'/><circle cx='16' cy='40' r='4'/><circle cx='30' cy='8' r='3'/><circle cx='84' cy='64' r='3'/>", "<path d='M40 58 Q41 88 42 110 Q43 115 45 110 Q46 88 47 58 Z'/><path d='M54 56 Q56 76 57 92 Q58 96 60 92 Q60 76 61 56 Z'/>"),
  splash(27, "<ellipse cx='52' cy='40' rx='32' ry='18'/>", "<circle cx='14' cy='30' r='4.5'/><circle cx='90' cy='44' r='3.5'/><circle cx='62' cy='10' r='4'/><circle cx='26' cy='62' r='3'/><circle cx='78' cy='66' r='2.5'/>", "<path d='M58 52 Q60 92 61 122 Q62 128 64 122 Q64 92 66 52 Z'/>"),
];

export class HUD {
  root: HTMLDivElement;
  /** Emotes: the wheel's slots set, each watched first; opened in the game from the wheel (src/ui/emotes-menu.ts) */
  readonly emotes = new EmotesMenu();
  private el: Record<string, HTMLElement> = {};
  private notes: HTMLDivElement;
  private last: Record<string, string> = {};
  /** the survivor's state: the symbols in the corner, and the same in words for the inventory (src/ui/status-view.ts) */
  private status: StatusView;
  private keys: KeysView;

  /** the splashes as plain pictures, once drawn (see bakeSplashes) */
  private splashes: string[] | null = null;

  constructor(private icons: Record<string, string> = {}) {
    void bakeSplashes().then((s) => (this.splashes = s));
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-cross"><i></i><i></i><i></i><i></i></div>
      <div class="hud-hit"><i></i><i></i><i></i><i></i></div>
      <div class="hud-prompt"></div>
      <div class="hud-side"><div class="hud-acts"></div><div class="hud-keys"></div></div>
      <div class="hud-mark"></div>
      <div class="hud-says"></div>
      <div class="hud-wheel">${wheelSvg(wheelSlots())}<i class="wheel-dot"></i><div class="wheel-mid"><b></b><span></span></div></div>
      <div class="hud-progress"><div class="hud-progress-label"></div><div class="hud-progress-bar"><div></div></div></div>
      <div class="hud-compass"><div class="hud-compass-strip"></div><div class="hud-compass-needle"></div></div>
      <div class="hud-bearing"></div>
      <div class="hud-area"></div>
      <div class="hud-notes"></div>
      <div class="hud-weapon"><div class="hud-weapon-name"></div><div class="hud-weapon-ammo"></div></div>
      <div class="hud-vitals"></div>
      <div class="hud-arms"><div></div></div>
      <div class="hud-stamina"><div></div></div>
      <div class="hud-ride"><b>0</b><small>km/h</small><div class="ride-bars"><div class="ride-fuel" title="fuel"><i></i></div><div class="ride-hp" title="what it has left in it"><i></i></div></div><div class="ride-seats"></div></div>
      <div class="hud-hotbar"></div>
      <div class="hud-chat">
        <div class="chat-log"></div>
        <div class="chat-orders"></div>
        <div class="chat-entry"><span class="chat-ch"></span><input class="chat-input" maxlength="160" spellcheck="false" autocomplete="off"></div>
        <div class="chat-hint"><b>Tab</b> switch channel · <b>Enter</b> send · empty <b>Enter</b> closes<span class="chat-hint-orders"> · <b>/</b> orders</span></div>
      </div>
      <div class="hud-scope">
        <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
          <defs><radialGradient id="sv" r="1"><stop offset="0.82" stop-color="#000" stop-opacity="0"/><stop offset="0.97" stop-color="#000" stop-opacity="0.85"/></radialGradient></defs>
          <circle r="96" fill="url(#sv)"/>
          <!-- each scope its own mark (the owner, 2026-10-17: "guns should use their own attachments ... the mismatch
               does not work"): the PU scope's; a mil-dot crosshair for the .50s' own scopes; the PSO-1's chevrons for the
               VSSK's; the Elcan's, lit in its middle -->
          <g class="ret ret-pu">
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
          </g>
          <g class="ret ret-mildot" fill="#0c0b0a">
            <rect x="-96" y="-1.5" width="56" height="3"/><rect x="40" y="-1.5" width="56" height="3"/><rect x="-1.5" y="40" width="3" height="56"/><rect x="-1.5" y="-96" width="3" height="56"/>
            <rect x="-40" y="-0.25" width="80" height="0.5"/><rect x="-0.25" y="-40" width="0.5" height="80"/>
            <circle cx="-32" cy="0" r="0.9"/><circle cx="0" cy="-32" r="0.9"/><circle cx="-24" cy="0" r="0.9"/><circle cx="0" cy="-24" r="0.9"/><circle cx="-16" cy="0" r="0.9"/><circle cx="0" cy="-16" r="0.9"/><circle cx="-8" cy="0" r="0.9"/><circle cx="0" cy="-8" r="0.9"/><circle cx="8" cy="0" r="0.9"/><circle cx="0" cy="8" r="0.9"/><circle cx="16" cy="0" r="0.9"/><circle cx="0" cy="16" r="0.9"/><circle cx="24" cy="0" r="0.9"/><circle cx="0" cy="24" r="0.9"/><circle cx="32" cy="0" r="0.9"/><circle cx="0" cy="32" r="0.9"/>
          </g>
          <g class="ret ret-pso" fill="#0c0b0a">
            <polygon points="-3.2,5.4 0,0 3.2,5.4 2.2,5.4 0,1.9 -2.2,5.4"/>
            <polygon points="-2.2,13.8 0,10 2.2,13.8 1.5,13.8 0,11.4 -1.5,13.8"/><polygon points="-2.2,20.8 0,17 2.2,20.8 1.5,20.8 0,18.4 -1.5,20.8"/><polygon points="-2.2,27.8 0,24 2.2,27.8 1.5,27.8 0,25.4 -1.5,27.8"/>
            <rect x="-36" y="-0.3" width="30" height="0.6"/><rect x="6" y="-0.3" width="30" height="0.6"/><rect x="-36.3" y="-2.2" width="0.6" height="2.2"/><rect x="-30.3" y="-2.2" width="0.6" height="2.2"/><rect x="-24.3" y="-2.2" width="0.6" height="2.2"/><rect x="-18.3" y="-2.2" width="0.6" height="2.2"/><rect x="-12.3" y="-2.2" width="0.6" height="2.2"/><rect x="11.7" y="-2.2" width="0.6" height="2.2"/><rect x="17.7" y="-2.2" width="0.6" height="2.2"/><rect x="23.7" y="-2.2" width="0.6" height="2.2"/><rect x="29.7" y="-2.2" width="0.6" height="2.2"/><rect x="35.7" y="-2.2" width="0.6" height="2.2"/>
            <path d="M -42 27 Q -27 31 -12 36" fill="none" stroke="#0c0b0a" stroke-width="0.6"/><rect x="-42" y="35.7" width="30" height="0.6"/>
            <g font-family="monospace" font-size="3.6"><text x="-41" y="25">2</text><text x="-34" y="26.6">4</text><text x="-27" y="28.6">6</text><text x="-20" y="31">8</text><text x="-14" y="33.4">10</text></g>
          </g>
          <g class="ret ret-elcan" fill="#0c0b0a">
            <rect x="-96" y="-1.2" width="66" height="2.4"/><rect x="30" y="-1.2" width="66" height="2.4"/><rect x="-1.2" y="30" width="2.4" height="66"/><rect x="-1.2" y="-96" width="2.4" height="66"/>
            <rect x="-30" y="-0.3" width="60" height="0.6"/><rect x="-0.3" y="-30" width="0.6" height="60"/>
            <rect x="-3" y="7.7" width="6" height="0.6"/><rect x="-2.5" y="13.7" width="5" height="0.6"/><rect x="-2" y="19.7" width="4" height="0.6"/><rect x="-1.5" y="25.7" width="3" height="0.6"/>
            <circle r="1.3" fill="#e0301c"/>
          </g>
        </svg>
        <div class="scope-read"><b class="sr-range"></b><span class="sr-zoom"></span></div>
        <div class="scope-breath"><i></i><span></span></div>
      </div>
      <div class="hud-damage"></div>
      <div class="hud-bleedfx"></div>
      <div class="hud-blooddrops"></div>
      <div class="hud-bleed"><i class="hb-cut">${symbol('bleed')}</i><i class="hb-drop">${symbol('blood')}</i><span></span></div>
      <div class="hud-hitdir"><i></i></div>
      <div class="hud-fps"></div>
      <div class="hud-online"><i></i><b></b><span></span></div>
      <div class="hud-net"></div>
      <div class="hud-feed"></div>
      <div class="hud-under"><div class="hud-board"></div><div class="hud-tags"></div></div>
      <div class="hud-fatal"><div class="fatal-title">Disconnected</div><div class="fatal-sub"></div><button class="dead-btn fatal-btn">Reconnect</button></div>
      <div class="hud-dead"><div class="dead-title">You are dead</div><div class="dead-sub"></div><button class="dead-btn">Respawn <small>Space</small></button><a class="dead-back" data-back><b>Back ZONA on X</b><span>Like, reply, repost. ${BACK_SHORT}</span></a></div>
      <div class="hud-start">
        <div class="sm-cut"></div>
        <header class="sm-top">
          <div class="sm-brand"><img src="/brand/zona-mark-plain.svg" alt=""><b>ZONA</b></div>
          <nav class="sm-nav start-tabs" aria-label="Menu">
            <button type="button" data-tab="play" class="on">Play</button>
            <button type="button" data-tab="howto" class="sm-howto">How to play</button>
            <button type="button" data-tab="gfx">Settings</button>
            <button type="button" data-tab="rewards" hidden>Rewards</button>
          </nav>
          <div class="sm-status">
            <a class="sm-out sm-arena" href="/arena">Arena</a>
            <a class="sm-out" href="/changelog/" target="_blank" rel="noopener">Changelog</a>
            <a class="sm-out sm-pay" href="/payouts" target="_blank" rel="noopener" title="Every payment made to players, each with its transaction"><span>Payouts</span><em></em></a>
            <a class="sm-discord" href="${DISCORD}" target="_blank" rel="noopener noreferrer"><b>Discord</b><em>Join</em></a>
          </div>
        </header>
        <div class="sm-main">
          <section class="sm-hero start-id">
            <div class="start-kicker"><span>PvP survival shooter</span><em>Play to earn</em></div>
            <div class="start-title" aria-label="ZONA"><span style="--i:0">Z</span><span style="--i:1">O</span><span style="--i:2">N</span><span style="--i:3">A</span></div>
            <p class="start-sub">Players hunt you. So do the infected.</p>
            <p class="start-sub2">Take a dog tag off another player, stay alive ${TAG_HOLD_MIN} minutes, cash it in. Nobody has a tag in their first ${TAG_FRESH / 60} minutes alive${ZONA_VOID ? ' in the Zona' : ''}, and a tag carried ${ZONA_VOID ? 'out of the Zona' : 'down a basement'} is void.</p>
            <div class="sm-enter">
              <label class="sm-name">
                <span class="sm-name-label">Your name<em>over your head, on your dog tag</em></span>
                <span class="sm-name-field">
                  <svg class="sm-name-pen" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
                  <input id="start-name" class="start-name" maxlength="16" spellcheck="false" autocomplete="off" enterkeyhint="go" placeholder="Type a name">
                  <i class="sm-name-left">16</i>
                </span>
              </label>
              <button class="start-btn" type="button"><span>Deploy</span></button>
              <button class="start-out" type="button" title="Log out" aria-label="Log out"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4H5v16h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><b></b></button>
              <div class="sm-tag" title="Your dog tag: whoever kills you takes it"></div>
            </div>
            <div class="start-queue"><div class="sq-pos"></div><div class="sq-sub"></div><button class="sq-leave" type="button">Play on your own instead</button></div>
            <div class="start-online"></div>
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
              <ol class="ht-steps" aria-label="How a life goes">
                <li style="--i:0"><figure><img src="/howto/drop-in.jpg" alt="" loading="lazy" decoding="async"><i>01</i></figure><b>Drop in</b><span>On the west coast, bare hands. The further east, the better the loot.</span></li>
                <li style="--i:1"><figure><img src="/howto/loot.jpg" alt="" loading="lazy" decoding="async"><i>02</i></figure><b>Loot inward</b><span>Tier 1, where you start, holds no gun. Then tier by tier: pistols, SMGs, rifles. Police and army places hold the most.</span></li>
                <li style="--i:2"><figure><img src="/howto/fight.jpg" alt="" loading="lazy" decoding="async"><i>03</i></figure><b>Fight</b><span>Anyone you meet can kill you and take everything.</span></li>
                <li style="--i:3"><figure><img src="/howto/tag.jpg" alt="" loading="lazy" decoding="async"><i>04</i></figure><b>Take their tag</b><span>Everybody alive ${TAG_FRESH / 60} minutes${ZONA_VOID ? ' in the Zona' : ''} carries a dog tag. Kill them and loot it.</span></li>
                <li style="--i:4"><figure><img src="/howto/hold.jpg" alt="" loading="lazy" decoding="async"><i>05</i></figure><b>Hold ${TAG_HOLD_MIN}:00</b><span>Stay alive with it for ${TAG_HOLD_MIN} minutes to cash it in.</span></li>
              </ol>
              <h3 class="ht-h">What wants you dead</h3>
              <div class="ht-threats">
                <div><img src="/howto/players.jpg" alt="" loading="lazy" decoding="async"><b>Other players</b><span>Anyone you meet can kill you and take everything you carry, your tag with it.</span></div>
                <div><img src="/howto/infected.jpg" alt="" loading="lazy" decoding="async"><b>The infected</b><span>They see ${INFECTED.sight} m in front of them and hear a shot from ${INFECTED.hearShot} m. Crouch past them, or fit a suppressor.</span></div>
                <div><img src="/howto/gas.jpg" alt="" loading="lazy" decoding="async"><b>The gas</b><span>The ${GAS.place} lies under it: Tier 4 loot, and the keycards to the bunker. A gas mask lets you breathe it: the police stations keep them.</span></div>
                <div><img src="/howto/bunker.jpg" alt="" loading="lazy" decoding="async"><b>The bunker</b><span>Bunker 17, on the map: dark, and shut. A keycard from the gas opens its door, loudly: it stays open while anybody is inside. Tier 5, the best loot, is down there and in the fort; the ${ITEMS.benelli.name} shotgun nowhere else.</span></div>
              </div>
              ${howtoMore()}
            </div>

            <div class="start-pane pane-gfx start-gfx">
              <div class="set-tabs" role="tablist" aria-label="Settings">
                <kbd class="set-key" aria-hidden="true">Q</kbd>
                ${SET_TABS.map(([id, name]) => `<button type="button" role="tab" data-set="${id}">${name}</button>`).join('')}
                <kbd class="set-key" aria-hidden="true">E</kbd>
              </div>
              <div class="set-body">
                <div class="set-page" role="tabpanel" data-set="controls"><div class="set-rows"></div><h4 class="set-h set-keys">Keys</h4><div class="kbs"></div></div>
                <div class="set-page" role="tabpanel" data-set="audio"></div>
                <div class="set-page" role="tabpanel" data-set="video"></div>
                <div class="set-page" role="tabpanel" data-set="game"></div>
              </div>
            </div>
          </aside>
        </div>
        <footer class="sm-foot start-links">
          <button class="sl-ca" type="button" title="Copy the contract address"><b>CA</b><code>${CONTRACT}</code><em>Copy</em></button>
          <a class="sl-x" href="https://x.com/${X_HANDLE}" target="_blank" rel="noopener noreferrer">@${X_HANDLE}</a>
          <a class="sm-back" data-back title="${BACK_WHY}"><b>Back ZONA on X</b><em>Like · Reply · Repost</em></a>
          <div class="sm-live"><i></i><span></span></div>
        </footer>
      </div>
    `;
    document.getElementById('ui')!.appendChild(this.root);
    for (const k of ['cross', 'hit', 'prompt', 'acts', 'keys', 'mark', 'progress', 'compass', 'bearing', 'area', 'weapon', 'vitals', 'stamina', 'arms', 'ride', 'hotbar', 'chat', 'scope', 'damage', 'bleedfx', 'blooddrops', 'bleed', 'hitdir', 'fps', 'online', 'net', 'feed', 'board', 'tags', 'fatal', 'dead', 'start']) {
      this.el[k] = this.root.querySelector(`.hud-${k}`) as HTMLElement;
    }
    this.notes = this.root.querySelector('.hud-notes') as HTMLDivElement;
    for (const [k, sel] of [['wheel', '.hud-wheel'], ['wheelDot', '.wheel-dot'], ['wheelB', '.wheel-mid b'], ['wheelS', '.wheel-mid span'], ['says', '.hud-says']]) this.el[k] = this.root.querySelector(sel) as HTMLElement;
    // (set again in Emotes: the wedges drawn afresh)
    onWheelSlots((ids) => this.el.wheel.querySelector('svg')?.replaceWith(document.createRange().createContextualFragment(wheelSvg(ids))));
    this.status = new StatusView(this.el.vitals);
    this.keys = new KeysView(this.el.keys, mouseSvg);
    this.buildCompass();
    // (the game's news, in a corner of the way in: it comes when it comes, and the menu does not wait for it. What X
    // gave is shut into a pill the moment it is there, and the changelog is put over it: see `mountNews`.)
    void mountUpdates(this.el.start, X_HANDLE).then(() => this.mountNews()).catch(() => {});
    // And said again in the chat, to whoever is in the game and not at a menu: ten minutes in, and every twenty after.
    // (A line among the others, not a thing over the view: nobody is shot for reading it.)
    const remind = () => {
      if (!this.el.start.classList.contains('show')) this.chatLine('system', '', `Enjoying ZONA? Like, reply and repost our newest post on X (@${X_HANDLE}). ${BACK_SHORT} The link is on the menu.`);
    };
    setTimeout(() => {
      remind();
      setInterval(remind, 20 * 60_000);
    }, 10 * 60_000);
    (this.root.querySelector('.fatal-btn') as HTMLButtonElement).onclick = () => reloadPage();
    const chat = this.root.querySelector('.chat-input') as HTMLInputElement;
    chat.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const picks = this.offered?.picks ?? [];
      if (e.key === 'Tab') {
        e.preventDefault();
        // an order being typed: the one that is lit is written out. Talk: same box, different audience
        if (picks.length) this.take(picks[this.lit]);
        else if (!this.offered) {
          // (Tab goes round them; whoever has a role has a third, heard by nobody without one)
          const all: ChatChannel[] = this.role ? [...CHANNELS, 'staff'] : CHANNELS;
          this.setChannel(all[(Math.max(0, all.indexOf(this.channel)) + (e.shiftKey ? all.length - 1 : 1)) % all.length]);
        }
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && picks.length) {
        e.preventDefault();
        this.lit = (this.lit + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length;
        this.showOffer();
      } else if (e.key === '/' && e.repeat && chat.value === '/') {
        // the key that opened the box is still held down
        e.preventDefault();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // the key that opened the box is still held down
        if (e.repeat) return;
        let text = chat.value.trim();
        // An order's name, typed or half typed: Enter writes out the one that is lit, and gives it at once if
        // there is no more to it than its name.
        if (this.offered && !this.offered.order && picks.length) {
          if (!picks[this.lit].whole) return void this.take(picks[this.lit]);
          text = picks[this.lit].fill.trim();
        }
        // The admin password. `/admin` by itself turns this same box into one that does not show what is typed
        // in it; what is typed then goes to the server as a thing of its own, never as talk, and is kept nowhere.
        if (this.passMode) {
          const pw = chat.value;
          this.closeChat();
          if (pw) this.onPass(pw);
          return;
        }
        if (/^\/admin$/i.test(text)) {
          chat.value = '';
          chat.type = 'password';
          chat.placeholder = 'Admin password, then Enter (Esc to leave)';
          this.passMode = true;
          return;
        }
        this.closeChat();
        if (text) this.chatSend(this.channel, text);
      } else if (e.key === 'Escape') this.closeChat();
    });
    chat.addEventListener('input', () => this.suggest());
    chat.addEventListener('blur', () => this.chatOpen && this.closeChat());
    // (a click on what is said, or its scroll bar, leaves the box being typed in: the chat stays open)
    this.el.chat.addEventListener('mousedown', (e) => {
      if (this.chatOpen && e.target !== chat) e.preventDefault();
    });
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
    // every letter is struck into the tag beside it (src/ui/dogtag.ts), and how many more there is room for is said
    dogTag(this.root.querySelector('.sm-tag') as HTMLElement, name);
    const left = this.root.querySelector('.sm-name-left') as HTMLElement;
    const count = () => (left.textContent = String(16 - name.value.length));
    name.addEventListener('input', count);
    count();
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
      else if (tab === 'howto') this.howTo(true);
      else this.sheet(tab);
    });
    (this.root.querySelector('.sm-close') as HTMLButtonElement).onclick = () => this.sheet('play');
    this.root.append(this.emotes.root);
    (this.root.querySelector('.sm-wallet') as HTMLButtonElement).onclick = () => this.rewardsClicked();
    window.addEventListener('keydown', (e) => {
      // (Escape shuts an open sheet before it does anything else: the game's own Escape is the pause, and that is this menu)
      if (e.code === 'Escape' && this.el.start.classList.contains('sheet') && !this.el.start.classList.contains('paused')) this.sheet('play');
    });
    const gfx = this.root.querySelector('.start-gfx') as HTMLElement;
    gfx.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b?.dataset.set) this.setTab(b.dataset.set as SetTab);
      else if (b?.dataset.k) this.setGraphic(b.dataset.k, b.dataset.v ?? '');
    });
    // (a slider is heard, or felt, as it is dragged: nothing is drawn afresh under the hand that is dragging it)
    gfx.addEventListener('input', (e) => {
      const r = e.target as HTMLInputElement;
      if (!r.classList?.contains('gfx-range')) return;
      const v = Number(r.value), said = r.nextElementSibling as HTMLElement, what = r.dataset.s ?? '';
      if (what === 'sens' || what === 'aim' || what === 'padSens') {
        const c = { ...controls(), [what]: v };
        setControls(c);
        this.keysChanged(c);
        said.textContent = `${v.toFixed(2)}×`;
      } else if (what === 'volume' || GROUPS.includes(what as Group)) {
        // (the one volume is kept with the picture's settings, where it has always been; the four groups by themselves)
        if (what === 'volume') {
          this.gfx.volume = v / 100;
          saveGraphics(this.gfx);
        } else {
          this.mix[what as Group] = v / 100;
          saveMix(this.mix);
        }
        this.soundChanged(this.gfx.volume, { ...this.mix });
        said.textContent = `${v}%`;
      }
    });
    // The settings' pages by the keyboard, as a game has them: Q and E, or left and right, go to the page before and
    // the page after. (Not while a slider has the keyboard, whose own left and right are; nor while a thing waits
    // for a key, which is that thing's key and no page's.)
    window.addEventListener('keydown', (e) => {
      if (!this.el.start.classList.contains('show') || (this.root.querySelector('.start-brief') as HTMLElement).dataset.tab !== 'gfx') return;
      if (this.binding || e.ctrlKey || e.altKey || e.metaKey) return;
      const at = e.target as HTMLElement | null, typing = at?.tagName === 'INPUT' || at?.tagName === 'TEXTAREA';
      const arrow = e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0;
      const step = arrow && !typing ? arrow : typing && (at as HTMLInputElement).type !== 'range' ? 0 : e.code === 'KeyQ' ? -1 : e.code === 'KeyE' ? 1 : 0;
      if (!step) return;
      e.preventDefault();
      const order = SET_TABS.map(([id]) => id);
      this.setTab(order[(order.indexOf(this.tab) + step + order.length) % order.length]);
    });
    // ---- the controls: click a thing, press the key for it
    const kbs = this.root.querySelector('.kbs') as HTMLElement;
    kbs.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.classList.contains('kbs-reset')) {
        this.binding = null;
        return void this.setKeys({ ...controls(), keys: {} });
      }
      if (b.dataset.code) {
        this.binding = this.binding === b.dataset.code ? null : b.dataset.code;
        this.renderKeys();
      }
    });
    // (the next key pressed while a thing waits for one is the key it is put on: taken here before anything else
    // hears of it, the menu's own Escape and the game's keyboard among them)
    const take = (key: string, e: Event) => {
      if (!this.binding) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const code = this.binding;
      this.binding = null;
      if (key !== 'Escape' && bindable(key)) this.setKeys(bind(controls(), code, key));
      else this.renderKeys();
    };
    window.addEventListener('keydown', (e) => take(e.code, e), true);
    // (and a mouse button, pressed on the strip that asks for one: anywhere else a click is a click)
    kbs.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.kbs-mouse')) take(`Mouse${e.button}`, e);
    }, true);
    kbs.addEventListener('contextmenu', (e) => e.preventDefault());
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

  /**
   * The compass: drawn into a picture of its own when the heading moves (2026-10-18). It was seventy-two marks with
   * shadows in a strip faded at its ends by a mask, and every turn of the view the page drew the masked strip again:
   * hidden in the owner's flight it gave 6% more frames. The same marks, sizes, colours and fade, four pixels a degree.
   */
  private compass: { ctx: CanvasRenderingContext2D; k: number; ink: string; faint: string; font: string; mono: string } | null = null;
  private buildCompass() {
    const strip = this.root.querySelector('.hud-compass-strip') as HTMLElement;
    const c = document.createElement('canvas');
    c.className = 'hud-compass-canvas';
    strip.replaceWith(c);
    const css = getComputedStyle(this.root), v = (n: string, or: string) => css.getPropertyValue(n).trim() || or;
    this.compass = { ctx: c.getContext('2d')!, k: 0, ink: v('--ink', '#e9e4d8'), faint: v('--ink-faint', 'rgba(233,228,216,0.45)'), font: v('--font', 'sans-serif'), mono: v('--mono', 'monospace') };
    // (sharp at whatever the page is zoomed to: measured again when the window changes)
    const fit = () => {
      const r = c.getBoundingClientRect(), k = Math.max(1, (r.width || 420) / 420) * devicePixelRatio;
      if (this.compass && Math.abs(k - this.compass.k) > 0.01) {
        this.compass.k = k;
        c.width = Math.round(420 * k);
        c.height = Math.round(30 * k);
        this.last.compass = '';
      }
    };
    fit();
    window.addEventListener('resize', fit);
  }

  private drawCompass(deg: number) {
    const C = this.compass;
    if (!C) return;
    const { ctx: g, k } = C;
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    g.setTransform(k, 0, 0, k, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, 420, 30);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.shadowColor = '#000';
    g.shadowBlur = 2 * k;
    g.shadowOffsetY = 1 * k;
    for (let d = Math.floor((deg - 55) / 15) * 15; d <= deg + 55; d += 15) {
      const at = 210 + (d - deg) * 4, n = ((d % 360) + 360) % 360, name = names[n];
      if (name) {
        g.font = `600 13px ${C.font}`;
        g.fillStyle = C.ink;
        g.fillText(name, at, 18);
      } else if (n % 45 !== 0) {
        g.font = `9px ${C.mono}`;
        g.fillStyle = C.faint;
        g.fillText(String(n), at, 18);
      }
    }
    // (faded at its ends as the mask did: clear, whole from a quarter in, clear again)
    g.shadowColor = 'transparent';
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, 0, 420, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.25, '#000');
    fade.addColorStop(0.75, '#000');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, 420, 30);
    g.globalCompositeOperation = 'source-over';
  }

  private set(key: string, el: HTMLElement, value: string, prop: 'text' | 'html' | 'hurt' | 'width' = 'text') {
    if (this.last[key] === value) return;
    this.last[key] = value;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else if (prop === 'width') el.style.width = value;
    else el.style.setProperty('--hurt', value);
  }
  /** when the figures read now and then were last written (see update) */
  private slowAt = 0;

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
    const slots = wheelSlots();
    w.querySelectorAll('g').forEach((g, i) => {
      this.toggle(g as unknown as HTMLElement, 'on', i === pick);
      this.toggle(g as unknown as HTMLElement, 'held', slots[i] === held);
    });
    const dot = this.el.wheelDot.style;
    dot.setProperty('--x', at[0].toFixed(3));
    dot.setProperty('--y', at[1].toFixed(3));
    const e = pick >= 0 ? EMOTE[slots[pick]] : null;
    // (in the middle with nothing picked: a click opens Emotes, where the wheel is set; the owner: "just put the 'click to edit' in the center of the radial wheel")
    this.set('wheelB', this.el.wheelB, e ? (e.id === held ? 'Stop' : e.say ?? e.label) : 'Click to edit');
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

  private zoneEl: HTMLDivElement | null = null;
  /**
   * The warning that tags taken off others are being carried out of the Zona: how many, and the seconds left
   * before they are void (null: no warning).
   */
  /** @param down down a basement, which is out of the Zona too, rather than over its line */
  zone(left: number | null, tags: number, down = false) {
    if (left === null) {
      this.zoneEl?.classList.remove('show');
      return;
    }
    if (!this.zoneEl) {
      this.zoneEl = document.createElement('div');
      this.zoneEl.className = 'zone-warn';
      this.zoneEl.innerHTML = '<b>You are leaving the Zona</b><span></span><i></i><em>Turn back: tags are earned inside the red line on the map (M)</em>';
      this.root.appendChild(this.zoneEl);
    }
    (this.zoneEl.children[0] as HTMLElement).textContent = down ? 'Dog tags are void down a basement' : 'You are leaving the Zona';
    (this.zoneEl.children[3] as HTMLElement).textContent = down ? 'Go back up: a tag is cashed in above ground' : 'Turn back: tags are earned inside the red line on the map (M)';
    const s = Math.ceil(left);
    (this.zoneEl.children[1] as HTMLElement).textContent = s > 0 ? `${tags === 1 ? 'Your dog tag is' : `Your ${tags} dog tags are`} void in` : `${tags === 1 ? 'Your dog tag is' : 'Your dog tags are'} void`;
    (this.zoneEl.children[2] as HTMLElement).textContent = s > 0 ? String(s) : '';
    this.zoneEl.classList.add('show');
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
    // (and out of the page once it has faded: there unseen, it cost the frame as much as the crosshair, 2026-10-18)
    a.onanimationend = () => a.classList.remove('show');
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
    this.set('startSub', this.root.querySelector('.start-sub') as HTMLElement, paused ? (this.live ? 'The Zone does not stop for you: you can still be killed. Log out to leave safely: close the game without it and your body stays here for five minutes, to be killed and searched.' : 'The Zone does not stop for you: you can still be killed.') : 'Players hunt you. So do the infected.');
    if (!on) {
      this.el.start.classList.remove('enter');
      this.sheet('play');
    }
    this.onStartShown(on, paused, text);
  }

  /** told whenever the start screen is shown or put away (the Arena's menu stands in for it there: src/ui/arena-menu.ts) */
  onStartShown: (on: boolean, paused: boolean, text: string) => void = () => {};

  /** Deploy (or Resume) pressed, as by the button: for the Arena's menu, whose own buttons go in the same way */
  deploy() {
    this.startClicked();
  }

  /**
   * The settings lent to another screen (the Arena's menu), and given back (null): the very sheet, moved, so that
   * what is set there is set here. Shown as the settings tab shows it, on its first page.
   */
  settingsInto(host: HTMLElement | null) {
    const pane = this.root.querySelector('.pane-gfx') as HTMLElement, home = this.root.querySelector('.start-brief') as HTMLElement;
    if (host) {
      if (pane.parentElement === host) return;
      this.setTab(SET_TABS[0][0]);
      host.appendChild(pane);
    } else if (pane.parentElement !== home) home.appendChild(pane);
  }

  /**
   * How to play, as a card over the screen (the owner: "how to play should be a popup modal shown on first visit,
   * and maybe an option at the esc menu once youre in the game"): the brief that was a tab, lent to the card.
   * `asked`: from the button; otherwise only on this browser's first visit.
   */
  howTo(asked: boolean) {
    const SEEN = 'zona-howto-seen';
    try {
      if (!asked && localStorage.getItem(SEEN)) return;
      localStorage.setItem(SEEN, '1');
    } catch {
      if (!asked) return;
    }
    let card = this.root.querySelector('.hud-howto') as HTMLElement | null;
    if (!card) {
      card = document.createElement('div');
      card.className = 'hud-howto';
      card.innerHTML = '<div class="howto-card"><div class="howto-head"><h2>How to play</h2><button type="button" class="howto-x" aria-label="Close">&times;</button></div><div class="howto-body"></div><button type="button" class="howto-ok">Got it</button></div>';
      this.root.appendChild(card);
      (card.querySelector('.howto-body') as HTMLElement).appendChild(this.root.querySelector('.pane-brief') as HTMLElement);
      card.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t === card || t.closest('.howto-x') || t.closest('.howto-ok')) card!.classList.remove('on');
      });
    }
    card.classList.add('on');
  }

  /** Why the server will not have this player, said under the way in for as long as it is so ('' takes it away). */
  refused(text: string) {
    let n = this.root.querySelector('.start-refused') as HTMLElement | null;
    if (!n) {
      if (!text) return;
      n = Object.assign(document.createElement('div'), { className: 'start-refused' });
      this.root.querySelector('.sm-enter')?.after(n);
    }
    n.textContent = text;
    n.hidden = !text;
  }

  /** Which sheet is open beside the way in: the map, how to play, the controls, the settings; 'play' is none. */
  private sheet(tab: string) {
    // (a thing left waiting for a key is not left waiting behind another sheet)
    if (this.binding) {
      this.binding = null;
      this.renderKeys();
    }
    const card = this.root.querySelector('.start-brief') as HTMLElement;
    if (card.dataset.tab === tab && tab !== 'play') tab = 'play';
    card.dataset.tab = tab;
    this.toggle(this.el.start, 'sheet', tab !== 'play');
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.start-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    (card.querySelector('h2') as HTMLElement).textContent = { map: 'The map', brief: 'How to play', gfx: 'Settings' }[tab] ?? '';
    // (the settings open on their first page; the page chosen is kept for as long as they stay open)
    if (tab === 'gfx') this.setTab(SET_TABS[0][0]);
    (this.root.querySelector('.mm-tip') as HTMLElement).classList.remove('on');
  }

  /**
   * What goes on behind the way in, said in a corner of it, and the cut between one scene and
   * the next (see src/game/menu-scenes.ts).
   * @param fade how far the picture is faded out, 0..1
   */
  menuScene(caption: string, fade: number) {
    const live = this.root.querySelector('.sm-live') as HTMLElement;
    this.toggle(live, 'on', !!caption);
    if (caption) this.set('scene', live.lastElementChild as HTMLElement, caption);
    // (a scene that is new to whoever is looking has "New" said before its caption, by menu-scenes.ts: its line and its dot are lit for it)
    if (caption) this.toggle(live, 'new', caption.startsWith('New · '));
    const v = fade <= 0.004 ? '0' : fade.toFixed(2);
    if (this.last.cut !== v) {
      this.last.cut = v;
      (this.root.querySelector('.sm-cut') as HTMLElement).style.opacity = v;
    }
    // (Nothing else: three films used to be played over the world in turn with its scenes, and the menu has none
    // now. 2026-10-13: "i want it to all be in game footage high quality".)
  }

  /**
   * The Updates panel, bottom right of the way in (2026-10-13: "the main menu updates panel needs to be collapsable
   * and collapsed by default and updated regularly with the front end"). Shut, which it is until somebody opens it,
   * it is a pill that says Updates and how many of them are new since it was last open (a dot and no number for
   * somebody who never opened it). Open, it lists the newest entries of the game's own changelog and, under them,
   * the asking and the posts from X that src/ui/updates.ts put there. Either may be missing; with neither there is
   * no panel. Which way it was left is kept in the browser.
   */
  private async mountNews() {
    const start = this.el.start;
    const kept = (k: string) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    };
    const keep = (k: string, v: string) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* not kept: the next time it is shut, and everything in it is new */
      }
    };
    const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    const link = (a: HTMLAnchorElement, href: string) => {
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    };
    /** the newest entry and the newest post that were in the panel when it was last open (null: it never was) */
    let seen: { log: string; x: number } | null = null;
    try {
      const s = JSON.parse(kept(NEWS_SEEN) ?? 'null') as { log?: unknown; x?: unknown } | null;
      if (s) seen = { log: typeof s.log === 'string' ? s.log : '', x: Number(s.x) || 0 };
    } catch {
      /* what was kept cannot be read: as if it never was */
    }
    const was = seen;
    const log: LogEntry[] = [];
    /** how many entries are newer than the one named (all that are shown, if it is not among them) */
    const newer = (id: string) => {
      const k = log.findIndex((e) => e.id === id);
      return Math.min(k < 0 ? log.length : k, LOG_SHOWN);
    };
    /** The panel is given the handle it is opened and shut by, and one body that scrolls, and is put as it was left. */
    const dress = (panel: HTMLElement) => {
      const head = panel.querySelector('header') as HTMLElement;
      const tab = mk('button', 'sm-news-tab');
      tab.type = 'button';
      const badge = mk('i');
      tab.append(mk('b', '', 'Updates'), badge, mk('span'));
      const word = head.querySelector(':scope > b');
      if (word) word.replaceWith(tab);
      else head.prepend(tab);
      const body = mk('div', 'sm-news-body');
      body.append(...[...panel.children].filter((c) => c !== head));
      panel.append(body);
      if (body.firstElementChild) body.prepend(mk('h3', 'sm-news-h', 'On X'));
      /** when each post from X was made */
      const posted = () => [...panel.querySelectorAll<HTMLTimeElement>('.sn-post time')].map((t) => Date.parse(t.dateTime) || 0);
      const set = (open: boolean, byHand = false) => {
        panel.classList.toggle('shut', !open);
        tab.setAttribute('aria-expanded', String(open));
        tab.title = open ? 'Hide the updates' : 'Show the updates: what changed in the game, and its posts on X';
        if (byHand) keep(NEWS_OPEN, open ? '1' : '0');
        if (open) {
          // (what is in it now has been seen: the next count is of what comes after)
          seen = { log: log[0]?.id ?? seen?.log ?? '', x: Math.max(seen?.x ?? 0, ...posted()) };
          keep(NEWS_SEEN, JSON.stringify(seen));
        }
        const last = seen;
        const n = open ? 0 : last ? newer(last.log) + posted().filter((t) => t > last.x).length : -1;
        badge.textContent = n > 0 ? String(n) : '';
        badge.classList.toggle('on', n !== 0);
      };
      tab.onclick = () => set(panel.classList.contains('shut'), true);
      set(kept(NEWS_OPEN) === '1');
      return { body, again: () => set(!panel.classList.contains('shut')) };
    };
    // (the panel X's posts came in is shut at once: none of it is seen open while the changelog is sent for)
    const made = start.querySelector<HTMLElement>('.sm-news');
    let ui = made ? dress(made) : null;
    log.push(...(await changelog()));
    if (!log.length) return;
    if (!ui) {
      // (X did not answer: the panel is the changelog's alone)
      const panel = mk('aside', 'sm-news');
      const head = mk('header');
      head.append(mk('b', '', 'Updates'), link(mk('a', '', `@${X_HANDLE}`), `https://x.com/${X_HANDLE}`));
      panel.append(head);
      start.append(panel);
      ui = dress(panel);
    }
    const list = mk('section', 'sm-log');
    const h = mk('h3', 'sm-news-h', 'In the game');
    h.append(link(mk('a', '', 'All updates'), '/changelog/'));
    list.append(h);
    // (an entry that was not there when the panel was last open says so, for as long as this page is up)
    const unseen = was ? newer(was.log) : 0;
    log.slice(0, LOG_SHOWN).forEach((e, k) => {
      const a = link(mk('a', k < unseen ? 'sm-log-item new' : 'sm-log-item'), `/changelog/#${e.id}`);
      a.append(mk('time', '', e.when), mk('b', '', e.title));
      if (e.lead) a.append(mk('span', '', e.lead));
      list.append(a);
    });
    ui.body.prepend(list);
    ui.again();
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

  /**
   * Payouts, in the row along the top beside Changelog and said as that is: what a tag pays at this moment goes
   * small beside the word, when the site says. null: it is not paying, or did not answer, and there is the word
   * alone. (It was a gold button at the top right for a day, made to be noticed. 2026-10-13: "the payouts thing in
   * the top right corner is ugly i dont like it".)
   */
  setPay(sol: number | null) {
    const em = this.root.querySelector('.sm-pay em');
    if (em) em.textContent = sol === null ? '' : `${Math.round(sol * 10_000) / 10_000} SOL a tag`;
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
  setMenuMap(picture: HTMLCanvasElement, size: number, spots: MenuSpot[], gases: { x: number; z: number; r: number }[]) {
    const c = this.root.querySelector('.mm canvas') as HTMLCanvasElement;
    const g = c.getContext('2d')!, W = c.width, k = W / size;
    g.imageSmoothingEnabled = true;
    g.drawImage(picture, 0, 0, picture.width, picture.height, 0, 0, W, W);
    for (const gas of gases) {
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
      // (its step of the map in that step's own colour, and what is kept there)
      const step = sp.tier ? `<i style="color:${TIERS[sp.tier].colour}">${TIERS[sp.tier].name}</i>` : '';
      tip.innerHTML = said.innerHTML = `<b>${sp.name}</b>${step}<span>${sp.tip}</span>${sp.finds ? `<em><u style="color:${sp.tier ? TIERS[sp.tier].colour : 'inherit'}">Here:</u> ${sp.finds}</em>` : ''}`;
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
    const input = this.root.querySelector('.start-name') as HTMLInputElement;
    input.value = name;
    // (set from outside, not typed: the tag and the count are told)
    input.dispatchEvent(new Event('input'));
  }

  nameValue() {
    return (this.root.querySelector('.start-name') as HTMLInputElement).value.trim().slice(0, 16);
  }

  private voiceEl: HTMLElement | null = null;
  private voiceKey = '';
  /** Who is talking near: the player themselves (the key is down), and whoever of the others is being heard. */
  voice(self: boolean, names: string[]) {
    const key = (self ? '1' : '0') + names.join('|');
    if (key === this.voiceKey) return;
    this.voiceKey = key;
    if (!this.voiceEl) {
      this.voiceEl = document.createElement('div');
      this.voiceEl.className = 'hud-voice';
      this.root.appendChild(this.voiceEl);
    }
    this.voiceEl.replaceChildren(...[...(self ? ['You'] : []), ...names.slice(0, 5)].map((n, i) => {
      const row = document.createElement('div');
      row.className = self && i === 0 ? 'me' : '';
      row.textContent = n;
      return row;
    }));
  }

  /**
   * Playing with no server: said where the number of players is said, for as long as it is so. (Somebody the
   * server could not be reached for, or who left the line, was told once, in a note that goes after four seconds,
   * and then had a world with nobody in it and nothing to say why.)
   */
  setOffline(on: boolean) {
    const e = this.el.online;
    this.toggle(e, 'off', on);
    if (!on) return;
    this.toggle(e, 'show', true);
    (e.querySelector('b') as HTMLElement).textContent = 'OFFLINE';
    (e.querySelector('span') as HTMLElement).textContent = ' · alone, nothing here is kept · reload to connect';
  }

  /** the drops there are to put on the glass, which is next, when the next is due, and how fast it was bleeding a frame ago */
  private drops: HTMLElement[] = [];
  private dropAt = 0;
  private dropDue = 0;
  private bledAt = 0;
  /**
   * Blood on the glass while a wound is open: a drop lands somewhere toward the edge of the view, and runs. The
   * faster the bleeding, the oftener; a new wound lands several at once. (As DayZ shows it. They are a dozen
   * elements moved by the browser's own animation: nothing is drawn by the game.)
   */
  private bloodOnGlass(rate: number) {
    const host = this.el.blooddrops, now = performance.now();
    if (!this.drops.length) {
      for (let k = 0; k < 14; k++) {
        const d = host.appendChild(document.createElement('i'));
        // (each its own splash, its own size and its own way up, for good: the browser draws each once and keeps it)
        const size = 46 + ((k * 37) % 5) * 16;
        d.style.width = `${size}px`;
        d.style.height = `${Math.round(size * 1.5)}px`;
        d.style.backgroundImage = (this.splashes ?? SPLASHES)[k % SPLASHES.length];
        // (its run over, it is let go of: a drop on the glass is a layer of its own only while it runs)
        d.addEventListener('animationend', () => d.classList.remove('on'));
        d.style.setProperty('--turn', `${((k * 53) % 9) * 5 - 20}deg`);
        d.style.setProperty('--flip', k % 2 ? '-1' : '1');
        this.drops.push(d);
      }
    }
    const land = () => {
      const d = this.drops[this.dropAt++ % this.drops.length];
      // (toward the edges: the middle of the view is what somebody is aiming with)
      const side = Math.random();
      const x = side < 0.42 ? 1 + Math.random() * 20 : side < 0.84 ? 74 + Math.random() * 20 : 22 + Math.random() * 52;
      const y = side < 0.84 ? 2 + Math.random() * 64 : Math.random() < 0.6 ? 1 + Math.random() * 9 : 58 + Math.random() * 12;
      d.style.left = `${x.toFixed(1)}%`;
      d.style.top = `${y.toFixed(1)}%`;
      d.style.setProperty('--run', `${(18 + Math.random() * 46).toFixed(0)}px`);
      d.style.setProperty('--life', `${(3 + Math.random() * 2).toFixed(2)}s`);
      // (started again on the next frame, not by asking the page to lay itself out there and then: four drops at a new
      // wound were four layouts of the whole page in one frame)
      d.classList.remove('on');
      requestAnimationFrame(() => d.classList.add('on'));
    };
    if (rate > this.bledAt + 0.5) for (let k = 0; k < 4; k++) land();
    this.bledAt = rate;
    if (rate <= 0) return;
    if (now < this.dropDue) return;
    // (one wound in a limb: a drop every second and a half; as fast as anybody bleeds: three a second)
    this.dropDue = now + (1500 - 1150 * Math.min(1, rate / 18)) * (0.7 + Math.random() * 0.6);
    land();
  }

  /** the survivor's state with a line of words to each symbol: one element, kept up to date here, for the inventory to put in its Status column */
  get statusPanel(): HTMLElement {
    return this.status.panel;
  }

  /** players connected to the server right now (null = playing offline) */
  setOnline(count: number | null, max = 0) {
    const e = this.el.online;
    if (e.classList.contains('off') && count === null) return;
    this.toggle(e, 'off', false);
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

  // ---------------------------------------------------------------- menu: the controls

  private keysChanged: (c: Controls) => void = () => {};
  /** the thing that is waiting for a key to be pressed for it */
  private binding: string | null = null;

  /** what to do when the player puts a thing on another key, or moves the sensitivity */
  onControls(changed: (c: Controls) => void) {
    this.keysChanged = changed;
    this.renderKeys();
    this.renderGraphics();
  }

  private setKeys(c: Controls) {
    setControls(c);
    this.keysChanged(c);
    this.renderKeys();
  }

  private renderKeys() {
    const c = controls(), pane = this.root.querySelector('.kbs') as HTMLElement;
    const row = (a: (typeof ACTIONS)[number]) =>
      `<button type="button" class="kbs-row${this.binding === a.code ? ' on' : ''}${c.keys[a.code] ? ' set' : ''}" data-code="${a.code}"><span>${a.does}</span><kbd${keyName(keyOf(c, a.code)).length > 2 ? ' class="wide"' : ''}>${this.binding === a.code ? '…' : keyName(keyOf(c, a.code))}</kbd></button>`;
    pane.innerHTML =
      `<div class="kbs-top">${this.binding ? '<span>Press the key for it. <b>Esc</b> leaves it as it is.</span><div class="kbs-mouse">or press a mouse button here</div>' : '<span>Click a thing to put it on another key. Two things that want one key change places.</span>'}<button type="button" class="kbs-reset"${Object.keys(c.keys).length ? '' : ' disabled'}>Reset all</button></div>` +
      `<div class="kbs-cols">${KEY_GROUPS.filter((name) => name !== 'Admin' || this.role).map((name) => `<div class="kbs-group"><h4>${name}</h4>${ACTIONS.filter((a) => a.group === name).map(row).join('')}</div>`).join('')}</div>` +
      `<div class="kbs-fixed"><kbd class="wide">Esc</kbd> this menu <kbd class="wide">F3</kbd> performance <span>The wheel is the next weapon. Hold the left button to use what is in your hands.</span></div>`;
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
    // (the numbers beside the status symbols are no setting of the picture's: kept by themselves, and nothing is drawn afresh for them)
    // (full screen, likewise: kept by itself, and asked for the next time the game is clicked into)
    if (key === 'full') {
      wantFull(value === '1');
      return this.renderGraphics();
    }
    // (the controller: kept with the controls, src/core/keys.ts)
    if (key === 'pad' || key === 'padInvert') {
      const c = { ...controls(), [key]: value === '1' };
      setControls(c);
      this.keysChanged(c);
      return this.renderGraphics();
    }
    if (key === 'figures') {
      wantFigures(value === '1');
      this.status.figures = value === '1';
      return this.renderGraphics();
    }
    if (key === 'preset') Object.assign(g, PRESETS[value as PresetName]);
    else if (key === 'scale' || key === 'msaa' || key === 'fpsLimit' || key === 'volume' || key === 'draw') g[key] = Number(value);
    else if (key === 'ao') g.ao = value as Graphics['ao'];
    else if (key === 'shadows' || key === 'foliage') g[key] = value as Graphics['shadows'];
    saveGraphics(g);
    this.gfxChanged({ ...g });
    this.renderGraphics();
  }

  /** which page of the settings is shown */
  private tab: SetTab = SET_TABS[0][0];
  /** the four groups of sound, as they are kept (the one volume over them is `gfx.volume`, where it has always been) */
  private mix: Mix = loadMix();
  private soundChanged: (volume: number, mix: Mix) => void = () => {};

  /** what to do when the player moves the volume, or one of the four groups under it: told as it is dragged */
  onSound(changed: (volume: number, mix: Mix) => void) {
    this.soundChanged = changed;
  }

  private setTab(tab: SetTab) {
    // (a thing left waiting for a key is not left waiting on a page that is not shown)
    if (this.binding) {
      this.binding = null;
      this.renderKeys();
    }
    this.tab = tab;
    this.renderGraphics();
    (this.root.querySelector('.set-body') as HTMLElement).scrollTop = 0;
  }

  /** The settings, all four pages of them (the keys are their own: see renderKeys), and which is shown. */
  private renderGraphics() {
    const g = this.gfx, pane = this.root.querySelector('.start-gfx') as HTMLElement;
    const named = (label: string, hint = '') => `<span>${label}${hint ? `<small>${hint}</small>` : ''}</span>`;
    const row = (label: string, key: string, current: string | number | null, options: [string | number, string][], hint = '') =>
      `<div class="gfx-row">${named(label, hint)}<div class="gfx-opts">${options.map(([v, t]) => `<button data-k="${key}" data-v="${v}"${v === current ? ' class="on"' : ''}>${t}</button>`).join('')}</div></div>`;
    /** a slider and the number it is at. @param s what it sets (read where it is dragged, in the constructor) */
    const slide = (label: string, s: string, v: number, [least, most, step]: number[], said: string, hint = '') =>
      `<div class="gfx-row">${named(label, hint)}<div class="gfx-sens"><input type="range" class="gfx-range" data-s="${s}" min="${least}" max="${most}" step="${step}" value="${v}" aria-label="${label}"><b>${said}</b></div></div>`;
    const loud = (label: string, s: string, v: number, hint: string) => slide(label, s, Math.round(v * 100), [0, 100, 1], `${Math.round(v * 100)}%`, hint);
    const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
    const c = controls();
    const pages: Record<SetTab, string> = {
      // (health, blood, food and water are symbols: whoever wants the numbers as well asks for them here)
      game:
        row('Status: exact figures', 'figures', figuresWanted() ? 1 : 0, [[0, 'Off'], [1, 'On']], 'The numbers beside health, blood, food and water') +
        (TOUCH ? '' : row('Full screen', 'full', fullWanted() ? 1 : 0, [[0, 'Off'], [1, 'On']], 'Fills the screen when you click in, and keeps Ctrl + W from closing the tab (Chrome and Edge)')),
      controls:
        `<h4 class="set-h">${TOUCH ? 'Look' : 'Mouse'}</h4>` +
        slide(TOUCH ? 'Look sensitivity' : 'Mouse sensitivity', 'sens', c.sens, [SENS.least, SENS.most, SENS.step], `${c.sens.toFixed(2)}×`) +
        slide('Sensitivity while aiming', 'aim', c.aim, [AIM.least, AIM.most, AIM.step], `${c.aim.toFixed(2)}×`, 'Through sights, a scope or binoculars: a multiple of the first') +
        `<h4 class="set-h">Controller</h4>` +
        row('Controller', 'pad', c.pad ? 1 : 0, [[0, 'Off'], [1, 'On']], 'A PlayStation or Xbox controller, its buttons as in Call of Duty') +
        (c.pad
          ? slide('Controller look speed', 'padSens', c.padSens, [PAD_SENS.least, PAD_SENS.most, PAD_SENS.step], `${c.padSens.toFixed(2)}×`) +
            row('Invert look', 'padInvert', c.padInvert ? 1 : 0, [[0, 'Off'], [1, 'On']], 'The right stick pushed up looks down') +
            `<p class="pad-map">R2 fire · L2 aim · ✕ jump · ○ crouch, held lie down · □ reload, or take, doors and search · △ next gun, held empty hands · L1 R1 the hot bar, one slot along (aiming: a scope's zoom) · L3 sprint · R3 light · aiming, L3 or R3 clicked leans left or right (again: back), L3 held holds your breath · D-pad ↑ map, ↓ call-out wheel (held), ← single or automatic (held: drop), → look the gun over (held: talk) · touchpad inventory · options menu. In menus the left stick moves a cursor: ✕ clicks, ○ goes back, the right stick scrolls.</p>`
          : ''),
      audio:
        loud('Master', 'volume', g.volume, 'Everything') +
        `<h4 class="set-h">Mix</h4>` +
        GROUPS.map((id) => loud(MIX_ROWS[id][0], id, this.mix[id], MIX_ROWS[id][1])).join(''),
      video:
        row('Preset', 'preset', presetOf(g), (Object.keys(PRESETS) as PresetName[]).map((p) => [p, cap(p)])) +
        row('Resolution', 'scale', g.scale, SCALES.map((s) => [s, `${Math.round(s * 100)}%`])) +
        row('Anti-aliasing', 'msaa', g.msaa, MSAA.map((m) => [m, m ? `${m}×` : 'Off'])) +
        row('Ambient occlusion', 'ao', g.ao, AO_MODES.map((a) => [a, a === 'off' ? 'Off' : a === 'half' ? 'Standard' : 'High'])) +
        row('Shadows', 'shadows', g.shadows, LEVELS.map((l) => [l, cap(l)])) +
        row('Foliage', 'foliage', g.foliage, LEVELS.map((l) => [l, cap(l)])) +
        row('Draw distance', 'draw', g.draw, DRAWS.map((d) => [d, `${d} m`]), 'Nothing past it is drawn: the world closes in haze. Loot: 55 m') +
        row('Frame limit', 'fpsLimit', g.fpsLimit, FPS_LIMITS.map((f) => [f, f ? String(f) : 'Off'])) +
        `<div class="gfx-info">${this.gfxInfo()}</div>`,
    };
    for (const page of pane.querySelectorAll<HTMLElement>('.set-page')) {
      const id = page.dataset.set as SetTab;
      // (the keys are drawn into the controls' page by renderKeys, under its sliders: only the sliders are drawn here)
      ((id === 'controls' ? page.querySelector('.set-rows') : page) as HTMLElement).innerHTML = pages[id];
      page.hidden = id !== this.tab;
    }
    for (const b of pane.querySelectorAll<HTMLButtonElement>('.set-tabs button')) {
      const on = b.dataset.set === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
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

  /** @param begun what is in the box to begin with (`/`, for an order) */
  openChat(begun = '') {
    if (this.chatOpen) return;
    this.chatOpen = true;
    this.toggle(this.el.chat, 'open', true);
    this.toggle(this.el.chat, 'staff', !!this.role);
    const input = this.root.querySelector('.chat-input') as HTMLInputElement;
    input.value = begun;
    input.focus();
    input.setSelectionRange(begun.length, begun.length);
    this.suggest();
    const log = this.root.querySelector('.chat-log') as HTMLElement;
    log.scrollTop = log.scrollHeight;
  }

  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.toggle(this.el.chat, 'open', false);
    hideCrownTip();
    const box = this.root.querySelector('.chat-input') as HTMLInputElement;
    // (a password that was being typed is not left in the box, nor the box left a password's)
    if (this.passMode) {
      this.passMode = false;
      box.value = '';
      box.type = 'text';
      box.placeholder = '';
    }
    box.blur();
    this.offered = null;
    this.showOffer();
    this.chatClosed();
  }

  // ---- orders (src/net/orders.ts): offered under the box as one is typed, to whoever has a role

  /** what this player may order on the server (the server says, and is the one that holds them to it); whoever has a
   * role finds their panel's key among the keys in Settings, to be put on another */
  get role() {
    return this.roleNow;
  }
  set role(r: Role | null) {
    if (r === this.roleNow) return;
    this.roleNow = r;
    if (this.binding === 'Backquote') this.binding = null;
    this.renderKeys();
  }
  private roleNow: Role | null = null;
  /** who else is online, to be named in an order */
  people: () => { id: number; name: string }[] = () => [];
  /** the names of who left lately, newest last: they can still be banned */
  gone: string[] = [];
  private offered: Offer | null = null;
  /** which of what is offered Tab would take */
  private lit = 0;

  // ---- leaving the proper way (see "a life kept by the server" in server/index.ts)

  /** the button on the pause screen was pressed: the wait is asked for, or (true) called off */
  onLogout: (cancel: boolean) => void = () => {};
  /** playing on a server (there is somebody to leave) */
  private live = false;
  private outLeft = 0;
  private outTimer = 0;

  setLive(on: boolean) {
    this.live = on;
    this.toggle(this.el.start, 'live', on);
    const b = this.root.querySelector('.start-out') as HTMLButtonElement;
    b.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onLogout(this.outLeft > 0);
    };
  }

  /** The wait to leave: so many seconds of it are left (0: there is none). Counted down here, and said wherever the player is looking. */
  setLogout(left: number) {
    window.clearInterval(this.outTimer);
    this.outLeft = Math.max(0, Math.round(left));
    let bar = this.root.querySelector('.hud-logout') as HTMLElement | null;
    if (!bar) this.root.appendChild((bar = Object.assign(document.createElement('div'), { className: 'hud-logout' })));
    const show = () => {
      // (the button is a square with the way out drawn on it; while the wait runs it shows the seconds, and pressing it stays)
      const out = this.root.querySelector('.start-out') as HTMLElement;
      const say = this.outLeft > 0 ? `Stay in the game (out in ${this.outLeft} s)` : 'Log out';
      out.title = say;
      out.setAttribute('aria-label', say);
      (out.querySelector('b') as HTMLElement).textContent = this.outLeft > 0 ? String(this.outLeft) : '';
      this.toggle(out, 'counting', this.outLeft > 0);
      bar!.textContent = this.outLeft > 0 ? `Logging out in ${this.outLeft} s. Stay where you are: moving, firing or being hit stops it.` : '';
      this.toggle(bar!, 'show', this.outLeft > 0);
    };
    show();
    if (this.outLeft > 0) {
      this.outTimer = window.setInterval(() => {
        this.outLeft = Math.max(0, this.outLeft - 1);
        show();
        if (!this.outLeft) window.clearInterval(this.outTimer);
      }, 1000);
    }
  }

  /** Said to everybody by an admin or a mod: across the screen for a while (and it is in the chat as well). */
  announce(text: string, by: string) {
    let n = this.root.querySelector('.hud-announce') as HTMLElement | null;
    if (!n) this.root.appendChild((n = Object.assign(document.createElement('div'), { className: 'hud-announce' })));
    const who = document.createElement('small'), what = document.createElement('div');
    who.textContent = `${by}, to everybody`;
    what.textContent = text;
    n.replaceChildren(who, what);
    n.classList.remove('show');
    void n.offsetWidth;
    n.classList.add('show');
    window.clearTimeout(this.announceT);
    this.announceT = window.setTimeout(() => n!.classList.remove('show'), 9000);
  }
  private announceT = 0;

  /**
   * The server is about to be restarted: said across the top of the picture, with why if that was said, and counted
   * down. It stays until the game has gone (see Game, 'restart').
   * @param seconds how long until it does (0: it is stopping now)
   */
  restarting(why: string, seconds: number) {
    let n = this.root.querySelector('.hud-restart') as HTMLElement | null;
    if (!n) this.root.appendChild((n = Object.assign(document.createElement('div'), { className: 'hud-restart' })));
    const head = document.createElement('b'), reason = document.createElement('span'), kept = document.createElement('small');
    reason.textContent = why;
    kept.textContent = 'You are kept as you are, where you stand. The game comes back by itself.';
    n.replaceChildren(head, ...(why ? [reason] : []), kept);
    n.classList.add('show');
    const until = performance.now() + seconds * 1000;
    const tick = () => {
      const left = Math.ceil((until - performance.now()) / 1000);
      head.textContent = left > 0 ? `Server restarting in ${left} s` : 'Server restarting';
    };
    tick();
    window.clearInterval(this.restartT);
    this.restartT = window.setInterval(tick, 250);
  }
  private restartT = 0;

  /**
   * Names over heads, as an admin's free camera shows them: each where its head is on the screen (in hundredths
   * of the screen's width and height). An empty list takes them all away.
   */
  /** @param list where each name goes, as parts of the screen across and down (0 to 1) */
  esp(list: { x: number; y: number; name: string; sub: string; size: number; kind: '' | 'dead' | 'ghost' | 'me' }[]) {
    let box = this.root.querySelector('.hud-esp') as HTMLElement | null;
    if (!box) {
      if (!list.length) return;
      this.root.appendChild((box = Object.assign(document.createElement('div'), { className: 'hud-esp' })));
    }
    while (box.children.length < list.length) {
      const n = document.createElement('i');
      n.append(document.createElement('b'), document.createElement('small'));
      box.appendChild(n);
    }
    if (!list.length && !this.espShown) return;
    this.espShown = list.length;
    // (Each name is moved by a transform, which costs the page nothing but putting it somewhere else: set by its
    // left and top, as it was at first, every name was a new laying out of the page sixty times a second, and with
    // a frame round each body besides. "its causing lag", 2026-10-13.)
    const wide = box.clientWidth, tall = box.clientHeight;
    for (let i = 0; i < box.children.length; i++) {
      const n = box.children[i] as HTMLElement, q = list[i];
      if (!q) {
        if (n.style.display !== 'none') n.style.display = 'none';
        continue;
      }
      if (n.style.display) n.style.display = '';
      n.style.transform = `translate3d(${Math.round(q.x * wide)}px, ${Math.round(q.y * tall)}px, 0) translate(-50%, -100%)`;
      const size = `${q.size}px`;
      if (n.style.fontSize !== size) n.style.fontSize = size;
      if (n.dataset.k !== q.kind) n.dataset.k = q.kind;
      const [name, sub] = n.children as unknown as HTMLElement[];
      if (name.textContent !== q.name) name.textContent = q.name;
      if (sub.textContent !== q.sub) sub.textContent = q.sub;
    }
  }
  private espShown = 0;

  /** which of an admin's powers are on, said at the top of the screen for as long as any is ('' for none) */
  setPowers(text: string) {
    let n = this.root.querySelector('.hud-powers') as HTMLElement | null;
    if (!n) this.root.appendChild((n = Object.assign(document.createElement('div'), { className: 'hud-powers' })));
    n.textContent = text;
    this.toggle(n, 'show', !!text);
  }

  private suggest() {
    const box = this.root.querySelector('.chat-input') as HTMLInputElement;
    this.offered = this.passMode || !this.chatOpen ? null : offer(box.value, this.role, this.people(), this.gone, THINGS);
    this.lit = 0;
    this.showOffer();
  }

  /** one of what is offered, written into the box */
  private take(p: Pick) {
    const box = this.root.querySelector('.chat-input') as HTMLInputElement;
    box.value = p.fill;
    box.setSelectionRange(p.fill.length, p.fill.length);
    this.suggest();
  }

  private showOffer() {
    const panel = this.root.querySelector('.chat-orders') as HTMLElement, o = this.offered;
    panel.replaceChildren();
    this.toggle(panel, 'show', !!o);
    if (!o) return;
    // (every word of this is set as text and never as markup: a player's name is whatever they typed)
    const el = (tag: string, cls: string, text: string) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      n.textContent = text;
      return n;
    };
    if (o.order) {
      const head = el('div', 'co-head', `/${o.order.name}`);
      o.order.args.forEach((a, i) => head.append(' ', el(i === o.at ? 'u' : 'span', '', a)));
      panel.append(head);
    }
    // eight of them at a time, about the one that is lit
    const from = Math.max(0, Math.min(this.lit - 3, o.picks.length - 8));
    o.picks.slice(from, from + 8).forEach((p, i) => {
      const row = el('div', `co-row${from + i === this.lit ? ' on' : ''}`, '');
      row.append(el('b', '', p.label), el('span', '', p.note));
      // (pressed, not clicked: the box keeps the keyboard)
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.take(p);
      });
      panel.append(row);
    });
    if (o.picks.length) panel.append(el('div', 'co-keys', `Tab takes it · ↑ ↓ choose${o.picks.length > 8 ? ` · ${o.picks.length} in all` : ''}${o.order ? '' : ' · Enter gives it'}`));
  }

  /** the box is asking for the admin password (see the Enter key, above) */
  private passMode = false;
  /** the admin password, typed: the game sends it to the server */
  onPass: (pw: string) => void = () => {};

  /** every channel lands in the one log, tagged and coloured by channel */
  /** @param role whoever said it is an admin or a mod: it is written before their name */
  /** @param tint an admin's own colour for their tag (not said: the rainbow) */
  chatLine(ch: ChatChannel | 'system' | 'pm', from: string, text: string, role?: Role | null, tint?: string, elite?: boolean) {
    const log = this.root.querySelector('.chat-log') as HTMLElement;
    const n = document.createElement('div');
    n.className = 'chat-line';
    n.dataset.ch = ch;
    if (ch !== 'system') {
      if (role === 'admin' || role === 'mod') {
        n.dataset.role = role;
        const rank = document.createElement('em');
        rank.textContent = `[${role.toUpperCase()}]`;
        if (role === 'admin' && tint && /^#[0-9a-f]{6}$/i.test(tint)) {
          rank.className = 'plain';
          rank.style.color = tint;
        }
        n.append(rank);
      }
      const tag = document.createElement('i');
      tag.textContent = CHANNEL_LABEL[ch];
      const who = document.createElement('b');
      who.textContent = from;
      n.append(tag);
      if (elite) n.append(crownEl());
      n.append(who);
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
    /** seconds of the game's own time this frame is: what the vitals are changing by is measured against it */
    dt: number;
    vitals: Vitals;
    /** a bag of blood or saline is running in */
    drip: boolean;
    /** out of breath: no sprinting until the bar has come back a way */
    winded: boolean;
    /** seconds of adrenaline left (0 = none) */
    boost: number;
    prompt: string | null;
    /** what the hands can do with what is in them (null: nothing to say) */
    acts?: HandAct[] | null;
    /** the keys that do something now, for the corner (src/game/key-hints.ts) */
    keys?: KeyHints | null;
    /** a phone: the buttons are named, where a mouse is drawn */
    touch?: boolean;
    /** where on screen the thing the prompt is about sits, as fractions of the screen (null = no marker) */
    mark: [number, number] | null;
    weapon: { name: string; ammo: { loaded: number; reserve: number; cap: number; mags?: number; bare?: boolean } | null; action: string | null; mode: string | null; /** the range its sights are set for, metres, where that can be changed */ zero?: number | null } | null;
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
    ride?: { kmh: number; fuel: number; hp: number; driver: boolean; seats?: { name: string; who: string | null; me: boolean }[] | null } | null;
    scoped: boolean;
    /** whose mark is in the scope: see `.ret` in the scope's picture */
    reticle?: string;
    /** the scope's rangefinder: metres to what is under the cross (null: nothing in its reach; undefined: it has none) */
    range?: number | null;
    /** how far a scope that turns is turned, times */
    zoom?: number | null;
    /** looked through a scope: the breath left to hold (1 a whole one; null not looked through), and how steady it has made the gun */
    breath?: number | null;
    steady?: number;
    /** aimed with a gun that has no sights: the mark stays on the screen */
    sightless?: boolean;
    hitMarker: number;
    kill: boolean;
    /** the hit was to the head */
    head: boolean;
    hurt: number;
    /** an open wound: what to do about it (html), or null when not bleeding */
    /** a wound is open: what it costs (ml a second), about how many seconds are left if nothing is done (Infinity: it will close first), and what to do about it, in words with the key */
    bleed: { rate: number; left: number; hint: string } | null;
    /** no wound, and little blood: what puts it back */
    lowBlood: string | null;
    /** breathing gas: with nothing over the face, or through a mask (null: clean air) */
    gas?: 'bare' | 'masked' | null;
    /** resting by a fire that is alight: mending by it, or only warm */
    fire?: 'mending' | 'warm' | null;
    heading: number | null;
    /** carrying a compass: the heading is also given in degrees */
    bearing: boolean;
    /**
     * `hot`: it is a fuse running down and not a thing getting done (a grenade with its pin out): drawn as a warning,
     * on a dark plate, to be read at a glance over grass, snow or a wall. `figure`: the seconds left, which are then
     * the biggest thing in the line, before its words.
     */
    progress: { label: string; t: number; hot?: boolean; figure?: string } | null;
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
    // (to the half pixel: to the tenth, the sway of a gun held still moved it every frame, and every move was the page
    // drawn again, 0.4 ms a frame standing still, 2026-10-18)
    const lag = `${(Math.round(s.lag[0] * 2) / 2).toFixed(1)}px,${(Math.round(s.lag[1] * 2) / 2).toFixed(1)}px`;
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
    if (e.scope.dataset.ret !== (s.reticle ?? 'pu')) e.scope.dataset.ret = s.reticle ?? 'pu';
    // (under the ring, in the black: the range the scope's own rangefinder reads, and how far a scope that turns is turned)
    const read = s.range === undefined ? '' : s.range === null ? '- - - m' : `${Math.round(s.range)} m`, zoom = s.zoom ? `${s.zoom}\u00d7` : '';
    if (this.last.scopeRead !== read + zoom) {
      this.last.scopeRead = read + zoom;
      e.scope.querySelector('.sr-range')!.textContent = read;
      e.scope.querySelector('.sr-zoom')!.textContent = zoom;
    }
    this.toggle(e.scope, 'glass', s.glass && !s.scoped);
    // (under that: the breath to hold, and the key that holds it, a controller's own on a controller)
    const breath = s.breath == null ? '' : String(Math.round(s.breath * 40) / 40);
    if (this.last.scopeBreath !== breath) {
      this.last.scopeBreath = breath;
      const b = e.scope.querySelector<HTMLElement>('.scope-breath')!;
      b.style.setProperty('--left', breath || '0');
      b.querySelector('span')!.textContent = document.body.classList.contains('pad') ? 'hold L3 · steady' : `hold ${shown('ShiftLeft')} · steady`;
    }
    this.toggle(e.scope, 'steady', (s.steady ?? 0) > 0.5);
    this.toggle(e.hit, 'show', s.hitMarker > 0);
    this.toggle(e.hit, 'kill', s.kill);
    this.toggle(e.hit, 'head', s.head && !s.kill);

    // hotbar: rebuilt only when what is in it changes; the words under a slot (the rounds in a gun: every shot) are
    // written alone. (Rebuilt with every shot, it was every slot and its picture made again, in the middle of a fight.)
    let sig = '', words = '';
    for (const h of s.hotbar) {
      sig += `${h.id ?? ''}|${h.active ? 1 : 0}${h.dim ? 1 : 0};`;
      words += `${h.label}`;
    }
    if (sig === this.last.hotbar && words !== this.last.hotbarWords) {
      this.last.hotbarWords = words;
      const ems = e.hotbar.querySelectorAll('.hb > em');
      s.hotbar.forEach((h, i) => {
        if (ems[i] && ems[i].innerHTML !== h.label) ems[i].innerHTML = h.label;
      });
    }
    if (sig !== this.last.hotbar) {
      this.last.hotbar = sig;
      this.last.hotbarWords = words;
      e.hotbar.innerHTML = s.hotbar
        .map((h, i) => {
          const icon = h.id && this.icons[h.id] ? `<i style="background-image:url(${this.icons[h.id]})"></i>` : '';
          return `${i === 3 ? '<span class="hb-gap"></span>' : ''}<div class="hb${h.active ? ' on' : ''}${h.dim ? ' dim' : ''}${h.id ? '' : ' empty'}"><b>${/^\d$/.test(h.key) ? shown(`Digit${h.key}`) : h.key}</b>${icon}${h.id && ITEMS[h.id] ? kindIcon(h.id) : ''}<em>${h.label}</em></div>`;
        })
        .join('');
    }

    this.set('prompt', e.prompt, s.prompt ? relabel(s.prompt) : '', 'html');
    this.toggle(e.prompt, 'show', !!s.prompt);
    const acts = s.acts?.length ? s.acts : null;
    if (acts) {
      // (the mouse, drawn with the button that does it; or the key, if the player has put it on one)
      const put = (a: HandAct) => (a.on === 'l' ? shown('Mouse0') : a.on === 'r' ? shown('Mouse2') : '');
      const key = (a: HandAct) => (s.touch ? `<span class="act-key">${a.on === 'l' ? 'Fire' : a.on === 'w' ? 'Swap' : 'Aim'}</span>` : put(a) && !/^(LMB|RMB)$/.test(put(a)) ? `<kbd>${put(a)}</kbd>` : mouseSvg(a.on));
      this.set('acts', e.acts, acts.map((a) => `<div class="hud-act${a.hold ? ' hold' : ''}"><div class="hud-act-text"><b>${a.text}</b>${a.sub ? `<small>${a.sub}</small>` : ''}</div>${key(a)}</div>`).join(''), 'html');
    }
    this.toggle(e.acts, 'show', !!acts);
    this.keys.show(s.keys);
    this.toggle(e.mark, 'show', !!s.mark);
    if (s.mark) {
      const at = `${(s.mark[0] * 100).toFixed(1)}%|${(s.mark[1] * 100).toFixed(1)}%`;
      if (this.last.mark !== at) {
        this.last.mark = at;
        [e.mark.style.left, e.mark.style.top] = at.split('|');
      }
    }

    // The body's state, as DayZ shows it: a symbol each for health, blood, food and water, in the colour of how it
    // stands, with arrows while it is changing, and a badge for each thing that is the matter. No bars and no
    // numbers (2026-10-13: "We dont need to show the players blood unless its dropping, dayz just does icons and
    // symbols"). What each looks like, and when blood is there at all, is reckoned in src/ui/status.ts.
    const v = s.vitals;
    if (this.status.due(s.dt, s.dead)) this.status.show({ health: v.health, blood: v.blood, bleed: v.bleeding ? v.bleed : 0, energy: v.energy, water: v.water, broken: !!v.broken, drip: s.drip, gas: s.gas ?? null, fire: s.fire ?? null });
    // What to do about it, in words with the key to press, over the hotbar: the one thing a symbol cannot say. It
    // is there only for what will not wait: an open wound, and blood so low that health no longer mends on it (the
    // drop is red by then). How bad the wound is and how long there is, which this card also said, the badge says.
    // And the wound is seen, as blood on the glass (2026-10-13: "we need some sort of blood on the screen when
    // bleeding like dayz has").
    const todo = s.bleed ? s.bleed.hint : s.lowBlood !== null && v.blood < BLOOD.grey[1] ? s.lowBlood : null;
    this.toggle(e.bleed, 'show', todo !== null);
    this.toggle(e.bleed, 'low', todo !== null && !s.bleed);
    if (todo !== null) this.set('bleed', e.bleed.lastElementChild as HTMLElement, todo, 'html');
    this.toggle(e.bleedfx, 'show', s.bleed !== null);
    const lvl = s.bleed ? String(bleedLevel(s.bleed.rate)) : '';
    if (lvl && this.last.bleedfx !== lvl) e.bleedfx.dataset.lvl = this.last.bleedfx = lvl;
    this.bloodOnGlass(s.bleed?.rate ?? 0);
    const reserve = (v.stamina / MAX_STAMINA) * 100;
    // (the bars are scaled, and only as they change: their width set every frame of a sprint was the page laid out again)
    const bar = (key: string, el: Element, k: number) => {
      const t = Math.max(0, Math.min(1, k)).toFixed(3);
      if (this.last[key] !== t) (el as HTMLElement).style.transform = `scaleX(${(this.last[key] = t)})`;
    };
    bar('stamina', e.stamina.firstElementChild!, s.boost > 0 ? Math.min(100, s.boost * 10) / 100 : reserve / 100);
    this.toggle(e.stamina, 'show', reserve < 99.5 || s.boost > 0);
    this.toggle(e.stamina, 'spent', s.winded);
    // (on adrenaline the bar is full and yellow, and runs down as the ten seconds do)
    this.toggle(e.stamina, 'boost', s.boost > 0);
    bar('arms', e.arms.firstElementChild!, s.arms);
    this.toggle(e.arms, 'show', s.arms < 0.995);
    this.toggle(e.arms, 'spent', s.arms < 0.15);
    this.toggle(e.ride, 'show', !!s.ride);
    // (figures that change all the time but are read now and then are written ten times a second, all on the same
    // frames: written as they changed, the speed in a helicopter and the fps were the page drawn again most frames)
    const slow = performance.now() - this.slowAt >= 100;
    if (slow) this.slowAt = performance.now();
    if (s.ride && slow) {
      this.set('kmh', e.ride.firstElementChild as HTMLElement, String(Math.round(s.ride.kmh)));
      const [fuel, hp] = [...e.ride.querySelectorAll('i')] as HTMLElement[];
      this.set('rfuel', fuel, `${Math.round(s.ride.fuel * 100)}%`, 'width');
      this.set('rhp', hp, `${Math.round(s.ride.hp * 100)}%`, 'width');
      this.toggle(fuel.parentElement!, 'low', s.ride.fuel < 0.15);
      this.toggle(hp.parentElement!, 'low', s.ride.hp < 0.4);
      // the seats, as DayZ shows them: each by what it is and who is in it, this player's own lit, Ctrl and its number to move to it
      const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
      const seats = s.ride.seats ?? [];
      this.set('rseats', e.ride.lastElementChild as HTMLElement, seats.map((q, k) => `<div class="${q.me ? 'me' : q.who === null ? 'free' : ''}"><kbd>Ctrl ${k + 1}</kbd><span>${q.name}</span><em>${q.who === null ? 'empty' : esc(q.who)}</em></div>`).join(''), 'html');
    }

    if (s.weapon) {
      this.toggle(e.weapon, 'show', true);
      this.set('wname', e.weapon.firstElementChild as HTMLElement, s.weapon.name + (s.weapon.mode ? ` · ${s.weapon.mode === 'auto' ? 'AUTO' : 'SEMI'}` : '') + (s.weapon.zero ? ` · ${s.weapon.zero} M` : ''));
      const a = s.weapon.ammo;
      // (a gun fed by a magazine: what is in it over what its magazine holds, then the magazines carried for it and the rounds in them)
      const txt = a ? (a.mags !== undefined ? `<b>${a.loaded}</b><span>/${a.bare ? 'no mag' : a.cap}</span> <em>${a.mags ? `${a.mags} mag${a.mags === 1 ? '' : 's'} · ${a.reserve}` : 'no spare'}</em>` : `<b>${a.loaded}</b><span>/${a.cap}</span> <em>${a.reserve}</em>`) : '';
      this.set('wammo', e.weapon.lastElementChild as HTMLElement, txt + (s.weapon.action === 'reload' || s.weapon.action === 'magswap' ? ' <i>reloading</i>' : ''), 'html');
    } else this.toggle(e.weapon, 'show', false);

    if (s.heading !== null) {
      this.toggle(e.compass, 'show', true);
      const deg = ((s.heading % 360) + 360) % 360;
      // (moved only when it has moved a tenth of a pixel: written every frame, a still view restyled the page every frame)
      const x = (-deg * 4).toFixed(1);
      if (this.last.compass !== x) {
        this.last.compass = x;
        this.drawCompass(deg);
      }
      this.toggle(e.bearing, 'show', s.bearing);
      if (s.bearing) this.set('bearing', e.bearing, `${String(Math.round(deg) % 360).padStart(3, '0')}°`);
    } else {
      this.toggle(e.compass, 'show', false);
      this.toggle(e.bearing, 'show', false);
    }

    if (s.progress) {
      this.toggle(e.progress, 'show', true);
      // (nothing under way yet: words and no bar)
      this.toggle(e.progress, 'idle', s.progress.t < 0);
      this.toggle(e.progress, 'hot', !!s.progress.hot);
      // (a figure before the words: the seconds of a fuse, large. Both are the game's own words, never a player's.)
      if (s.progress.figure !== undefined) this.set('plabel', e.progress.firstElementChild as HTMLElement, `<b>${s.progress.figure}<i>s</i></b><span>${s.progress.label}</span>`, 'html');
      else this.set('plabel', e.progress.firstElementChild as HTMLElement, s.progress.label);
      ((e.progress.lastElementChild as HTMLElement).firstElementChild as HTMLElement).style.width = `${Math.min(100, s.progress.t * 100)}%`;
    } else this.toggle(e.progress, 'show', false);

    // (the beat of a body near death is the page's own animation, run by the card, and the flash of a hit is written
    // only as it changes: written every frame, it was a restyle and repaint of the page every frame, 2026-10-18)
    this.toggle(e.damage, 'low', v.health < 25);
    this.set('hurt', e.damage, Math.min(1, s.hurt * 0.9).toFixed(2), 'hurt');
    if (slow) {
      this.set('fps', e.fps, `${Math.round(s.fps)} fps`);
      this.set('net', e.net, this.netText + (s.ping !== null ? ` · ${s.ping} ms` : ''));
    }
    this.toggle(e.dead, 'show', s.dead);
    if (s.dead) this.set('dead', e.dead.querySelector('.dead-sub') as HTMLElement, s.deadText);
  }
}
