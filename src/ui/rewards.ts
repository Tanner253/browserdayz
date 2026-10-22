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
  const s = (await (await fetch('/api/cashins?format=status')).json()) as { on?: boolean; tagPays?: number | null; share?: number; floor?: number; due?: boolean; minTags?: number; next?: { from?: string; tagPays?: number; minTags?: number } | null; holder?: { from?: string; perM?: number; max?: number } | null; gate?: { from?: string; free?: number; hold?: number } | null };
  if (s.due) void fetch('/api/tick').catch(() => {});
  pays = s.on && typeof s.tagPays === 'number' ? s.tagPays : null;
  // (what this player's own tags pay, by what the wallet they gave holds of the coin: the owner, 2026-10-15, "the ui
  // shouldnt say .01 if im going to make more than .01". api/cashins.ts ?format=wallet)
  mine = null;
  const w = walletAddress();
  if (pays !== null && s.holder && w) {
    const r = (await (await fetch(`/api/cashins?format=wallet&w=${encodeURIComponent(w)}`)).json().catch(() => null)) as Rate | null;
    if (r && typeof r.perTag === 'number' && typeof r.tier === 'string') {
      mine = r;
      pays = r.perTag;
    }
  }
  for (const f of told) f(pays);
  return s;
}
/** a wallet's standing under the holder rule, as the site says it (api/cashins.ts ?format=wallet) */
interface Rate { tier: string; held: number; perTag: number; payout: number; max: boolean; next: { tier: string; perTag: number; more: number } | null; free?: { paid: number; of: number; hold: number; holds: boolean } }
/** this player's wallet's, when they have given one and the site has said */
let mine: Rate | null = null;
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
  /** the wallet whose holding is said under the box, what it was found to hold, and the wait before asking */
  private holdFor = '';
  private holdShort = false;
  private holdT = 0;

  /**
   * @param playerName what is stamped on the player's own tag in the first picture
   * @param closed told when the window is shut (an address may have been given in it)
   * @param inline drawn into a page, Settings' Account, and not as a window over the game: the wallet and what it holds,
   * without the pictures (the owner, 2026-10-22: "wallet will be entered in settings in the account tab")
   */
  constructor(parent: HTMLElement, private playerName: () => string = () => '', private closed: () => void = () => {}, private inline = false) {
    this.root = document.createElement('div');
    this.root.className = inline ? 'rw rw-inline show' : 'rw';
    this.root.innerHTML = `
      <div class="rw-card"${inline ? '' : ' role="dialog" aria-modal="true" aria-labelledby="rw-title"'}>
        <div class="rw-kicker">${inline ? 'Account' : 'Creator rewards'}</div>
        <h2 id="rw-title">${inline ? 'Payout wallet' : 'Enter your SOL wallet address to receive rewards'}</h2>
        ${inline ? '' : `<ol class="rw-steps">
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
        </ol>`}
        <div class="rw-pay">
          <svg viewBox="0 0 40 32" aria-hidden="true"><path d="M8 2h30l-6 7H2z" fill="currentColor"/><path d="M2 12.5h30l6 7H8z" fill="currentColor" opacity="0.8"/><path d="M8 23h30l-6 7H2z" fill="currentColor" opacity="0.6"/></svg>
          <p>Cashed-in tags are paid in SOL to the wallet you enter here.</p>
        </div>
        <p class="rw-umb" hidden></p>
        <div class="rw-row">
          <input class="rw-input" placeholder="Your Solana address" maxlength="44" spellcheck="false" autocomplete="off" aria-label="Solana wallet address">
          <button class="rw-save">Save address</button>
        </div>
        <div class="rw-hold" aria-live="polite" hidden></div>
        <div class="rw-err" role="alert"></div>
        <div class="rw-foot">
          <span class="rw-fine">Use the public Solana address of your wallet. Never share a seed phrase or private key. Saved on this device, and sent with each tag you cash in so it can be listed for a reward.</span>
          ${inline ? '' : '<button class="rw-skip">Not now</button>'}
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.input = this.root.querySelector('.rw-input') as HTMLInputElement;
    this.err = this.root.querySelector('.rw-err') as HTMLElement;
    // nothing typed or clicked in here is meant for the game underneath
    for (const ev of ['click', 'mousedown', 'keydown', 'keyup'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.save();
      else if (e.key === 'Escape' && !inline) this.close();
    });
    this.input.addEventListener('input', () => {
      this.err.textContent = '';
      (this.root.querySelector('.rw-save') as HTMLButtonElement).textContent = 'Save address';
      this.showHolding(this.input.value.trim());
    });
    (this.root.querySelector('.rw-save') as HTMLButtonElement).onclick = () => this.save();
    this.root.querySelector<HTMLButtonElement>('.rw-skip')?.addEventListener('click', () => this.close());
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
    const skip = this.root.querySelector('.rw-skip');
    if (skip) skip.textContent = saved ? 'Close' : 'Not now';
    (this.root.querySelector('.rw-save') as HTMLButtonElement).textContent = 'Save address';
    // the player's own name on the first tag (short enough to fit the plate)
    const name = (this.playerName() || 'Survivor').replace(/[<>&"']/g, '').toUpperCase().slice(0, 8);
    const mine = this.root.querySelector('.rw-mine');
    if (mine) mine.innerHTML = tag(name);
    this.root.classList.add('show');
    if (!this.inline) this.input.focus();
    this.holdFor = '';
    this.showHolding(saved);
    if (!this.inline) this.runClock();
    void this.showPay();
    // (what the whole platform has paid, as every money screen of both games says it: src/ui/platform.ts)
    if (!this.inline) void platformPaid().then((p) => {
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
      const listed = '<small>Every payment is on the Solana chain, with a receipt for each tag</small>';
      // (the figures are the site's own: api/_lib/payouts.ts. A flat pay, and a wallet paid when so many of its tags are due.)
      const n = typeof s.minTags === 'number' ? Math.round(s.minTags) : 1;
      if (s.share === 0) {
        // (and more for holding the coin: api/_lib/payouts.ts, holderBonus)
        const h = s.holder && typeof s.holder.perM === 'number' && typeof s.holder.max === 'number' && typeof s.holder.from === 'string' ? s.holder : null;
        // (the free tags, and the coin to hold past them: api/_lib/payouts.ts, pastFree. The owner, 2026-10-18: "the first 10
        // tags are free to play play to earn", and "10 tags would give you enough sol to cover the minimum requirement")
        const g = s.gate && typeof s.gate.free === 'number' && typeof s.gate.hold === 'number' && typeof s.gate.from === 'string' ? s.gate : null;
        const fmtN = (k: number) => Math.round(k).toLocaleString('en-US');
        const when = g && Date.now() < Date.parse(g.from!) ? `From ${g.from!.slice(0, 16).replace('T', ' ')} UTC: ` : '';
        const f = mine?.free;
        const gate = !g
          ? ''
          : f && f.paid >= f.of
            ? f.holds
              ? ` Your first ${f.of} tags are paid, and your wallet holds the <b>${fmtN(f.hold)} $ZONA</b> a tag needs past them.`
              : ` <b>Your first ${f.of} tags are paid.</b> ${when}a tag is paid now only while your wallet holds <b>${fmtN(f.hold)} $ZONA</b>.`
            : ` ${when}<b>${f ? f.of - f.paid : g.free} of ${g.free}</b> free tags${f ? ' left' : ''}: past your first ${g.free}, a tag is paid only while your wallet holds <b>${fmtN(g.hold!)} $ZONA</b>, and your first ${g.free} pay enough SOL to buy it.`;
        const more = h ? ` ${Date.now() >= Date.parse(h.from!) ? 'Holding $ZONA in that wallet pays more' : `From ${h.from!.slice(0, 16).replace('T', ' ')} UTC holding $ZONA in that wallet pays more`}: <b>+${round(h.perM!)} SOL</b> a tag for every full 1,000,000 held (from 1,000,000), up to <b>${round(h.max!)} SOL</b> a tag.` : '';
        if (mine) {
          // (the player's own: their tier, what their tags pay, and what the next tier needs)
          const fmt = (k: number) => Math.round(k).toLocaleString('en-US');
          const next = mine.next ? ` <b>${fmt(mine.next.more)}</b> more $ZONA makes you ${mine.next.tier}: <b>${round(mine.next.perTag)} SOL</b> a tag.` : ' The top rate.';
          p.innerHTML = `Your tags pay <b>${round(mine.perTag)} SOL</b> each: <b>${mine.tier}</b>, ${fmt(mine.held)} $ZONA in your wallet. ${n > 1 ? `Sent when ${n} are due: <b>${round(mine.payout)} SOL</b> for the ${n}, at once.` : ''}${next} Play free, earn SOL, hold $ZONA: every 1,000,000 adds ${h ? round(h.perM!) : '0.001'} SOL a tag, up to ${h ? round(h.max!) : '0.025'}.${gate}${listed}`;
          return;
        }
        p.innerHTML = `A tag you cash in pays <b>${round(s.tagPays)} SOL</b>${n > 1 ? `, sent to the wallet you enter here when ${n} of your tags are due: <b>${round(s.tagPays * n)} SOL</b> for the ${n}, at once. Until then they wait, counted, and none is lost.` : ', sent to the wallet you enter here.'}${more}${gate}${listed}`;
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
    // (what that wallet's tags pay, said everywhere it is said)
    void siteStatus().catch(() => {});
    // (one that holds too little to be paid past its free tags stays in sight, saved, with that said under it)
    if (this.holdFor === v && this.holdShort) {
      this.err.textContent = '';
      const skip = this.root.querySelector('.rw-skip');
      if (skip) skip.textContent = 'Close';
      (this.root.querySelector('.rw-hold') as HTMLElement).insertAdjacentHTML('afterbegin', '<em>Saved.</em> ');
      return;
    }
    // (on the Account page it stays where it is, and says so)
    if (this.inline) {
      this.err.textContent = '';
      (this.root.querySelector('.rw-save') as HTMLButtonElement).textContent = 'Saved';
      return;
    }
    this.close();
  }

  /**
   * What the wallet in the box holds of the coin, said under it, as soon as it is a whole address (and for the saved one
   * when the window opens). The coin counts only in the wallet the tags are paid to: two players who held 100,000 $ZONA
   * in another wallet were waiting for pay that never came (the owner, 2026-10-19: "show the $ZONA a payout wallet holds
   * when players set it in game"). api/cashins.ts ?format=wallet: read from the chain, held there half a minute.
   */
  private showHolding(who: string) {
    const el = this.root.querySelector('.rw-hold') as HTMLElement;
    clearTimeout(this.holdT);
    if (!isWallet(who)) {
      el.hidden = true;
      this.holdFor = '';
      return;
    }
    if (who === this.holdFor) return;
    this.holdFor = who;
    this.holdShort = false;
    el.hidden = false;
    el.className = 'rw-hold';
    el.textContent = 'Reading what this wallet holds…';
    this.holdT = window.setTimeout(async () => {
      const r = (await fetch(`/api/cashins?format=wallet&w=${encodeURIComponent(who)}`)
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null)) as Rate | null;
      if (this.holdFor !== who) return;
      if (!r || typeof r.held !== 'number') {
        el.hidden = true;
        return;
      }
      const n = (k: number) => Math.round(k).toLocaleString('en-US'), f = r.free;
      if (!f) {
        el.innerHTML = `This wallet holds <b>${n(r.held)} $ZONA</b>.`;
        return;
      }
      this.holdShort = !f.holds;
      el.classList.add(f.holds ? 'ok' : 'short');
      const left = f.paid < f.of ? ` ${f.of - f.paid} of its ${f.of} free tags are left.` : '';
      el.innerHTML = f.holds
        ? `This wallet holds <b>${n(r.held)} $ZONA</b>: enough to be paid past your first ${f.of} tags (${n(f.hold)} needed).${left}`
        : `This wallet holds <b>${n(r.held)} $ZONA</b>. Past your first ${f.of} paid tags, a tag is paid only while <b>this wallet</b> holds <b>${n(f.hold)} $ZONA</b>: the coin must be here, in the wallet your tags are paid to.${left}`;
    }, 350);
  }
}
