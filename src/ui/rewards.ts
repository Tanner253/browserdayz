// Dog tags and creator rewards: the illustrated explanation a player sees on entering
// the site, and the wallet address they give. The address is kept on this device and sent
// to the server with each tag the player cashes in, where it is listed for a reward.

import { TAG_HOLD, TAG_HOLD_MIN } from '../sim/items';
import { paidLine, platformPaid } from './platform';

/** whether the wallet modal and the Rewards button are shown */
export const REWARDS_UI = true;

const WALLET = 'zona.wallet';
const CASHED = 'zona.tags.cashed';
const SEEN = 'zona.rewards.seen';

const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

/** a Solana address: 32 to 44 base58 characters (no 0, O, I or l) */
export const isWallet = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());

export function walletAddress(): string {
  const a = read(WALLET);
  return isWallet(a) ? a : '';
}

/** how many dog tags this browser's player has cashed in */
export function cashedTags(): number {
  return Math.max(0, Math.floor(Number(read(CASHED)) || 0));
}

export function addCashedTag(): number {
  const n = cashedTags() + 1;
  write(CASHED, String(n));
  return n;
}

/** a small dog tag for the diagrams (drawn around 0,0) */
const tag = (name: string, cls = '') => `
  <g class="${cls}">
    <rect class="t-plate" x="-30" y="-17" width="60" height="34" rx="9"/>
    <circle class="t-hole" cx="-22" cy="0" r="3"/>
    <text class="t-name" x="5" y="-1" text-anchor="middle">${name}</text>
    <path class="t-line" d="M-12 8h34"/>
  </g>`;

/** seconds of the countdown shown per second of animation, and how long the "cashed in" tick stays */
const RING = 2 * Math.PI * 34;
const LOOP_MS = 7200;
const RUN_MS = 5600;

/**
 * Where the site's payouts stand (see api/cashins.ts). When it says creator rewards are
 * waiting to be collected, asking is also what gets them collected: the site's housekeeping
 * (api/tick.ts) is called, and does it.
 */
async function siteStatus() {
  // (minTags: how many of a wallet's tags must be due before it is paid, when that is more than one; next: what is to change, and when)
  const s = (await (await fetch('/api/cashins?format=status')).json()) as { on?: boolean; tagPays?: number | null; share?: number; floor?: number; due?: boolean; minTags?: number; next?: { from?: string; tagPays?: number; minTags?: number } | null };
  if (s.due) void fetch('/api/tick').catch(() => {});
  pays = s.on && typeof s.tagPays === 'number' ? s.tagPays : null;
  for (const f of told) f(pays);
  return s;
}
/**
 * What a tag pays at this moment, in SOL, told to whoever wants it each time the site is asked (and at once, with
 * what was last heard): the Payouts button of the main menu says it. Nothing more is asked of the site for this
 * than was asked already. null: the site is not paying, or there is none behind this page.
 */
let pays: number | null = null;
const told: ((sol: number | null) => void)[] = [];
export function onTagPay(f: (sol: number | null) => void) {
  told.push(f);
  f(pays);
}
// (asked when the game is opened, and every ten minutes while it stays open)
void siteStatus().catch(() => {});
setInterval(() => void siteStatus().catch(() => {}), 10 * 60_000);

export class RewardsModal {
  private root: HTMLDivElement;
  private input: HTMLInputElement;
  private err: HTMLElement;
  private timer = 0;

  /**
   * @param playerName what is stamped on the player's own tag in the first picture
   * @param closed told when the window is shut (an address may have been given in it)
   */
  constructor(parent: HTMLElement, private playerName: () => string = () => '', private closed: () => void = () => {}) {
    this.root = document.createElement('div');
    this.root.className = 'rw';
    this.root.innerHTML = `
      <div class="rw-card" role="dialog" aria-modal="true" aria-labelledby="rw-title">
        <div class="rw-kicker">Creator rewards</div>
        <h2 id="rw-title">Enter your SOL wallet address to receive rewards</h2>
        <ol class="rw-steps">
          <li>
            <svg class="rw-art" viewBox="0 0 160 104" aria-hidden="true">
              <path class="t-chain" d="M58 46C20 30 34 -6 80 6s64 28 22 42"/>
              <g transform="translate(80 58) rotate(-6) scale(1.5)" class="rw-mine"></g>
            </svg>
            <b>Your tag</b><span>Everyone carries a dog tag with their name on it.</span>
          </li>
          <li>
            <svg class="rw-art" viewBox="0 0 160 104" aria-hidden="true">
              <circle class="a-ring" cx="34" cy="50" r="22"/><path class="a-x" d="M27 43l14 14M41 43L27 57"/>
              <circle class="a-ring" cx="126" cy="50" r="22"/><text class="a-label" x="126" y="53" text-anchor="middle">YOU</text>
              <path class="a-dash" d="M58 50h44"/>
              <g transform="translate(34 50) scale(0.62)">${tag('', 'a-move')}</g>
              <text class="a-label" x="34" y="92" text-anchor="middle">THEM</text>
            </svg>
            <b>Take theirs</b><span>Kill another survivor and loot the tag from the body.</span>
          </li>
          <li>
            <svg class="rw-art" viewBox="0 0 160 104" aria-hidden="true">
              <circle class="c-track" cx="80" cy="52" r="34"/>
              <circle class="c-ring" cx="80" cy="52" r="34" stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="0"/>
              <text class="c-time" x="80" y="57" text-anchor="middle">${TAG_HOLD_MIN}:00</text>
            </svg>
            <b>Hold ${TAG_HOLD_MIN}:00</b><span>Stay alive with it. At zero it is cashed in. Die, and the clock restarts for whoever loots you.</span>
          </li>
        </ol>
        <div class="rw-pay">
          <svg viewBox="0 0 40 32" aria-hidden="true"><path d="M8 2h30l-6 7H2z" fill="currentColor"/><path d="M2 12.5h30l6 7H8z" fill="currentColor" opacity="0.8"/><path d="M8 23h30l-6 7H2z" fill="currentColor" opacity="0.6"/></svg>
          <p>Cashed-in tags are what creator rewards will be paid on, in SOL, to the wallet you enter here.<small>Payouts roll out shortly after launch</small></p>
        </div>
        <p class="rw-umb" hidden></p>
        <div class="rw-row">
          <input class="rw-input" placeholder="Your Solana address" maxlength="44" spellcheck="false" autocomplete="off" aria-label="Solana wallet address">
          <button class="rw-save">Save address</button>
        </div>
        <div class="rw-err" role="alert"></div>
        <div class="rw-foot">
          <span class="rw-fine">Use the public Solana address of your wallet. Never share a seed phrase or private key. Saved on this device, and sent with each tag you cash in so it can be listed for a reward.</span>
          <button class="rw-skip">Not now</button>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.input = this.root.querySelector('.rw-input') as HTMLInputElement;
    this.err = this.root.querySelector('.rw-err') as HTMLElement;
    // nothing typed or clicked in here is meant for the game underneath
    for (const ev of ['click', 'mousedown', 'keydown', 'keyup'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.save();
      else if (e.key === 'Escape') this.close();
    });
    this.input.addEventListener('input', () => (this.err.textContent = ''));
    (this.root.querySelector('.rw-save') as HTMLButtonElement).onclick = () => this.save();
    (this.root.querySelector('.rw-skip') as HTMLButtonElement).onclick = () => this.close();
  }

  get isOpen() {
    return this.root.classList.contains('show');
  }

  /** On entering the site: asked once per visit until an address has been given. */
  openAtEntry() {
    let seen = false;
    try {
      seen = !!sessionStorage.getItem(SEEN);
    } catch {
      /* private mode */
    }
    if (!walletAddress() && !seen) this.open();
  }

  open() {
    const saved = walletAddress();
    this.input.value = saved;
    this.err.textContent = '';
    (this.root.querySelector('.rw-skip') as HTMLElement).textContent = saved ? 'Close' : 'Not now';
    // the player's own name on the first tag (short enough to fit the plate)
    const name = (this.playerName() || 'Survivor').replace(/[<>&"']/g, '').toUpperCase().slice(0, 8);
    (this.root.querySelector('.rw-mine') as SVGGElement).innerHTML = tag(name);
    this.root.classList.add('show');
    this.input.focus();
    this.runClock();
    void this.showPay();
    // (what the whole platform has paid, as every money screen of both games says it: src/ui/platform.ts)
    void platformPaid().then((p) => {
      if (!p) return;
      const n = this.root.querySelector('.rw-umb') as HTMLElement;
      n.textContent = `ZONA PvP has paid ${paidLine(p).replace(' paid to players', ' to players')}, the Zone and the Arena together.`;
      n.hidden = false;
    });
  }

  /**
   * What a tag pays right now, if the site is paying: asked of the site each time the window
   * opens (see api/cashins.ts). With no answer, or payouts not on, the words stay as they are.
   */
  private async showPay() {
    try {
      const s = await siteStatus();
      if (!s.on || typeof s.tagPays !== 'number' || typeof s.share !== 'number' || typeof s.floor !== 'number') return;
      const round = (n: number) => String(Math.round(n * 10_000) / 10_000);
      const p = this.root.querySelector('.rw-pay p') as HTMLElement;
      const listed = '<small>Every payment is listed at <a href="/payouts" target="_blank" rel="noopener">zonapvp.fun/payouts</a></small>';
      // (the figures are the site's own: api/_lib/payouts.ts. A flat pay, and a wallet paid when so many of its tags are due.)
      const n = typeof s.minTags === 'number' ? Math.round(s.minTags) : 1;
      if (s.share === 0) {
        p.innerHTML = `A tag you cash in pays <b>${round(s.tagPays)} SOL</b>${n > 1 ? `, sent to the wallet you enter here when ${n} of your tags are due: <b>${round(s.tagPays * n)} SOL</b> for the ${n}, at once. Until then they wait, counted, and none is lost.` : ', sent to the wallet you enter here.'}${listed}`;
        return;
      }
      const next = s.next && typeof s.next.from === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(s.next.from) && typeof s.next.tagPays === 'number' && typeof s.next.minTags === 'number' ? s.next : null;
      const soon = next ? ` From ${next.from!.slice(0, 16).replace('T', ' ')} UTC a tag pays ${round(next.tagPays!)} SOL flat${next.minTags! > 1 ? `, sent when ${Math.round(next.minTags!)} of your tags are due` : ''}.` : '';
      p.innerHTML = `A tag you cash in pays <b>${round(s.tagPays)} SOL</b> right now: ${round(s.share * 100)}% of the reward treasury, ${round(s.floor)} SOL at least, sent to the wallet you enter here.${soon}${listed}`;
    } catch {
      /* no site behind this page (the game served from somewhere else, or playing offline) */
    }
  }

  close() {
    this.root.classList.remove('show');
    this.input.blur();
    clearInterval(this.timer);
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      /* private mode */
    }
    this.closed();
  }

  /** the third picture: the hold time run down in a few seconds, then the tag is cashed in */
  private runClock() {
    const ring = this.root.querySelector('.c-ring') as SVGCircleElement;
    const text = this.root.querySelector('.c-time') as SVGTextElement;
    clearInterval(this.timer);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now();
    this.timer = window.setInterval(() => {
      const t = Math.min(1, ((performance.now() - t0) % LOOP_MS) / RUN_MS);
      const left = Math.round(TAG_HOLD * (1 - t));
      ring.setAttribute('stroke-dashoffset', (RING * t).toFixed(1));
      text.textContent = t >= 1 ? '✓' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      text.classList.toggle('c-done', t >= 1);
    }, 60);
  }

  private save() {
    const v = this.input.value.trim();
    if (!isWallet(v)) {
      this.err.textContent = 'That does not look like a Solana address: it should be 32 to 44 letters and digits.';
      return;
    }
    write(WALLET, v);
    this.close();
  }
}
