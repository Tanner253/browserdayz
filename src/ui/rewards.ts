// Dog tags and creator rewards: the explanation a player sees on entering the site, and
// the wallet address they give. The address is kept in this browser and nowhere else;
// payouts are not live, and the text says so.

/**
 * Whether the wallet modal and the Rewards button are shown. Off: what the modal tells
 * players about payouts has to match what the payout system really does before it goes
 * in front of them. Dog tags, their countdown and the cash-in announcement work either way.
 */
export const REWARDS_UI = false;

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

/** a plain Ethereum address: 0x and forty hex digits */
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

export class RewardsModal {
  private root: HTMLDivElement;
  private input: HTMLInputElement;
  private err: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'rw';
    this.root.innerHTML = `
      <div class="rw-card" role="dialog" aria-modal="true" aria-labelledby="rw-title">
        <div class="rw-kicker">Creator rewards</div>
        <h2 id="rw-title">Enter your Robinhood ETH wallet address to receive rewards</h2>
        <ol class="rw-steps">
          <li><b>Everyone carries a dog tag.</b> Yours has your name stamped on it.</li>
          <li><b>Kill another survivor and loot the body.</b> Their dog tag is in there with the rest of their gear.</li>
          <li><b>Stay alive with it for 30 minutes.</b> The tag then leaves your inventory and is cashed in. Die first and whoever loots you takes it, and their 30 minutes start from zero.</li>
        </ol>
        <p class="rw-why"><b>Why we ask for a wallet.</b> Creator rewards are planned for every tag you cash in, paid in ETH, so we need an address to pay you at. Paste the Ethereum address of your Robinhood wallet: it starts with <code>0x</code>. That is a public address. Never give anyone a seed phrase or a private key; we will never ask for one.</p>
        <p class="rw-status"><b>Payouts are not switched on yet.</b> Nothing is sent today. Your address stays in this browser, ready for when they are.</p>
        <div class="rw-row">
          <input class="rw-input" placeholder="0x…" maxlength="42" spellcheck="false" autocomplete="off" aria-label="Ethereum wallet address">
          <button class="rw-save">Save address</button>
        </div>
        <div class="rw-err" role="alert"></div>
        <div class="rw-foot"><span class="rw-count"></span><button class="rw-skip">Not now</button></div>
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
    const n = cashedTags();
    (this.root.querySelector('.rw-count') as HTMLElement).textContent = n ? `Dog tags cashed in so far: ${n}` : '';
    (this.root.querySelector('.rw-skip') as HTMLElement).textContent = saved ? 'Close' : 'Not now';
    this.root.classList.add('show');
    this.input.focus();
  }

  close() {
    this.root.classList.remove('show');
    this.input.blur();
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      /* private mode */
    }
  }

  private save() {
    const v = this.input.value.trim();
    if (!isWallet(v)) {
      this.err.textContent = 'That does not look like an Ethereum address: it should be 0x followed by 40 letters and digits.';
      return;
    }
    write(WALLET, v);
    this.close();
  }
}
