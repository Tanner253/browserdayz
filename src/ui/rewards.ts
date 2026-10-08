// Dog tags and rewards: the illustrated explanation a player sees on entering the site, and
// the EVM wallet address they give. The address is kept on this device and sent to the
// server with each tag the player cashes in, where it is listed for a reward.

import { TAG_HOLD, TAG_HOLD_MIN } from '../sim/items';

/** whether the wallet modal and the Rewards button are shown */
export const REWARDS_UI = true;

// (its own place: what was kept under 'zona.wallet' is a Solana address from before the game asked for an EVM one)
const WALLET = 'zona.wallet.evm';
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

/** an EVM address: 0x and forty hex digits */
export const isWallet = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

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
  const s = (await (await fetch('/api/cashins?format=status')).json()) as { on?: boolean; tagPays?: number | null; share?: number; floor?: number; due?: boolean };
  if (s.due) void fetch('/api/tick').catch(() => {});
  return s;
}
// (asked when the game is opened, and every ten minutes while it stays open)
void siteStatus().catch(() => {});
setInterval(() => void siteStatus().catch(() => {}), 10 * 60_000);

export class RewardsModal {
  private root: HTMLDivElement;
  private input: HTMLInputElement;
  private err: HTMLElement;
  private timer = 0;

  /** @param playerName what is stamped on the player's own tag in the first picture */
  constructor(parent: HTMLElement, private playerName: () => string = () => '') {
    this.root = document.createElement('div');
    this.root.className = 'rw';
    this.root.innerHTML = `
      <div class="rw-card" role="dialog" aria-modal="true" aria-labelledby="rw-title">
        <div class="rw-kicker">Rewards</div>
        <h2 id="rw-title">Enter your EVM wallet address to receive rewards</h2>
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
          <svg viewBox="0 0 40 32" aria-hidden="true"><circle cx="20" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="20" cy="16" r="7.5" fill="currentColor" opacity="0.75"/></svg>
          <p>Cashed-in tags are what rewards will be paid on, to the EVM wallet you enter here.</p>
        </div>
        <div class="rw-row">
          <input class="rw-input" placeholder="Your EVM wallet address (0x…)" maxlength="42" spellcheck="false" autocomplete="off" aria-label="EVM wallet address">
          <button class="rw-save">Save address</button>
        </div>
        <div class="rw-err" role="alert"></div>
        <div class="rw-foot">
          <span class="rw-fine">Use the public address of your EVM wallet: it starts with 0x. Never share a seed phrase or private key. Saved on this device, and sent with each tag you cash in so it can be listed for a reward.</span>
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
      this.err.textContent = 'That does not look like an EVM wallet address: it should be 0x followed by 40 letters and digits.';
      return;
    }
    write(WALLET, v);
    this.close();
  }
}
