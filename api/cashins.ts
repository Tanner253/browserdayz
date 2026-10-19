// The payouts page (/payouts, see vercel.json): what the treasury holds, what a tag pays
// now, every tag cashed in and what became of it, and every collection of creator rewards,
// each payment with the transaction anybody can look up on the chain.
//
//   ?format=json     the same as data
//   ?format=status   the few numbers the game shows on its rewards window
//
// Everything on it comes from the book (_lib/payouts.ts) and from the chain as it stands. It
// is put together at most once in twenty seconds however many people look at it, from a copy
// of the book that may be a minute behind (reading that costs nothing: see _lib/store.ts).
//
// Looking is also what sets the collecting of creator rewards off: when enough are waiting,
// the page (and the game, from the status) calls the housekeeping, api/tick.ts.

import { live } from './_lib/live.js';
import { cached, dueOf, editBook, freshBook, glanceBook, paidTo, refOf, snapshot, sol, walletRate, type Book, type Entry, type Row, type Snapshot, type World } from './_lib/payouts.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** an amount of SOL, to as many places as it needs and no more than four */
const amount = (lamports: number) => String(Math.round(sol(lamports) * 10_000) / 10_000);
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const tx = (sig: string) => `https://solscan.io/tx/${encodeURIComponent(sig)}`;
const when = (at: string) => `<time datetime="${esc(at)}">${esc(at.replace('T', ' ').slice(0, 16))} UTC</time>`;

/**
 * Tags cashed in before there was a book each have a file of their own. The first time the
 * book is opened they are read into it, as listed and not paid: once.
 */
async function withOldEntries(w: World, book: Book): Promise<Book> {
  if (book.seeded) return book;
  // (the copy at hand may be behind: the book itself is asked before anything is listed)
  const held = await freshBook(w.store);
  if (held.book.seeded) return held.book;
  const paths = await w.store.list('cashins/');
  const old = (await Promise.all(paths.map((p) => w.store.read<Entry>(p).then((r) => r?.data ?? null, () => null)))).filter((e): e is Entry => !!e && typeof e.id === 'string' && typeof e.at === 'string');
  const done = await editBook(w, (b) => {
    if (b.seeded) return false;
    b.seeded = true;
    for (const e of old) {
      if (b.rows.some((r) => r.ref === refOf(e.id))) continue;
      b.rows.push({ ref: refOf(e.id), at: e.at, name: String(e.name ?? ''), owner: String(e.owner ?? ''), wallet: String(e.wallet ?? ''), state: 'off' });
      b.tags++;
    }
  }, held);
  return done.book;
}

function outcome(r: Row): string {
  // (the note on the transaction itself reads "ZONA dog tag" and this reference; its receipt is an account of its own)
  const link =
    (r.signature ? `<a href="${tx(r.signature)}" target="_blank" rel="noopener" title="the transaction carries the note: ZONA dog tag ${esc(r.ref)}">${esc(short(r.signature))}</a>` : '') +
    (r.receipt ? ` <a class="rc" href="https://solscan.io/account/${esc(r.receipt)}" target="_blank" rel="noopener" title="the receipt this payment left on the chain: while it stands, this tag cannot be paid again">receipt</a>` : '') +
    ` <small>${esc(r.ref)}</small>`;
  if (r.state === 'paid') return `<b class="sol">${amount(r.lamports ?? 0)} SOL</b> ${link}`;
  if (r.state === 'sending') return `<span class="go">${amount(r.lamports ?? 0)} SOL on its way</span> ${link}`;
  if (r.state === 'waiting') return `<span class="go">waiting:</span> <i>${esc(r.why ?? '')}</i>`;
  if (r.state === 'skipped') return r.why?.startsWith('sold tokens') ? `<i>${esc(r.why)}</i>` : `<i>not paid: ${esc(r.why ?? '')}</i>`;
  return '<i>listed (payouts were not on)</i>';
}

/**
 * A wallet whose tags wait to be paid together (the rule of the second cut-over: see dueOf in _lib/payouts.ts).
 * The owner, 2026-10-13: "we can reender the 3/5 progress on payout for .05 once per wallet/player UNTIL the payout
 * is sent so we dont have a huge list of pending payouts on the screen". So such a wallet is ONE line of the ledger,
 * however many of its tags wait: how many it has of how many it is paid at, and what it is paid then. When the
 * payment is sent the line is gone, and each tag is listed with its transaction as paid tags always were.
 */
interface Waits {
  wallet: string;
  /** the name the latest of them was cashed in under, and when */
  name: string;
  at: string;
  /** how many of its tags are due, of how many it is paid at */
  have: number;
  need: number;
  /** lamports: what it is paid when it is paid (for `need` of them while it has fewer; for all it has, once it has more) */
  pays: number;
  /** why it is not paid yet */
  why: string;
  hold: Row['hold'];
}

/** The ledger's lines, newest first: a tag each, but one for all of a wallet's tags that wait to be paid together (where the latest of them would be). */
function lines(book: Book, s: Snapshot): (Row | Waits)[] {
  const out: (Row | Waits)[] = [];
  const done = new Set<string>(), lots = new Map<string, Row[]>();
  for (const r of book.rows) {
    if (r.rules === 2 && !lots.has(r.wallet)) lots.set(r.wallet, dueOf(book, r.wallet));
    const lot = (r.rules === 2 && lots.get(r.wallet)) || [];
    if (!lot.includes(r)) out.push(r);
    else if (!done.has(r.wallet)) {
      done.add(r.wallet);
      // (how many it takes: one, if the rule has been put off since these were taken in under it. They are then paid
      // as they stand at the next look, and the page says so, and calls for that look: see needOf in _lib/payouts.ts)
      const have = lot.length, need = s.fives ? s.minTags : 1;
      // (enough are due, and they are not paid: held by the treasury or the day's limit, which one of them says; or about to be)
      const held = lot.find((x) => x.hold !== 'five');
      out.push({ wallet: r.wallet, name: r.name, at: r.at, have, need, pays: Math.max(have, need) * s.flatPay, why: have < need ? `paid when ${need} are due` : held?.why ?? 'being paid', hold: have < need ? 'five' : held?.hold ?? 'five' });
    }
  }
  return out;
}
const isWaits = (x: Row | Waits): x is Waits => 'have' in x;

/** where the game is played, and where it is talked about (the same as the menu's own links: src/ui/hud.ts) */
const SITE = { x: 'https://x.com/zonaSOL_', changelog: '/changelog' };

/**
 * The page. Laid out again on 2026-10-12 ("a more modern and informational layout thats easy to understand with
 * diagrams or a ledger layout ... also missing nav to main site from payouts"): a bar across the top that goes back
 * to the game; the one figure that matters, big; how the money moves, drawn; what was paid each day and to whom;
 * and then the ledger itself, every row of it, which is what the page is for. Nothing on it is counted anywhere but
 * from the book and the chain, as before: the chart and the wallets are sums of the rows listed under them.
 */
function page(book: Book, s: Snapshot, now: number): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''}`;
  const paidRows = book.rows.filter((r) => r.state === 'paid');
  const wallets = new Set(paidRows.map((r) => r.wallet)).size;
  // (every tag that is on its way or waiting is counted, though a wallet whose tags wait to be paid together is one line)
  const open = book.rows.filter((r) => r.state === 'sending' || r.state === 'waiting').length;
  const listed = lines(book, s);
  const waits = listed.filter(isWaits);
  const waitTags = waits.reduce((n, x) => n + x.have, 0);
  const pct = Math.round(s.share * 1000) / 10;
  // ---- the second cut-over, said from the settings: when, what a tag pays from then, and how many are paid at once
  const N = s.minTags, flat = amount(s.flatPay), lot = amount(N * s.flatPay);
  const from2 = s.rules2From ?? '';
  const cut = `${Number(from2.slice(8, 10))} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(from2.slice(5, 7)) - 1] ?? ''} ${from2.slice(0, 4)}`;
  const state =
    s.mode === 'on' && s.problem
      ? ['bad', 'Automatic payouts are held', `Nothing is paid as things stand: ${s.problem}.`]
      : s.mode === 'on'
      ? ['on', 'Automatic payouts are on', s.fives && N > 1 ? `A wallet is paid when ${N} of its tags are due, all ${N} at once, straight from the treasury to the wallet the player gave.` : 'A tag cashed in is paid within a minute or so, straight from the treasury to the wallet the player gave.']
      : s.mode === 'dry'
        ? ['dry', 'Automatic payouts are on trial', 'Each payment is worked out and tried, and not sent.']
        : s.problem
          ? ['bad', 'Automatic payouts are off', `They were asked for and could not start: ${s.problem}.`]
          : ['off', 'Automatic payouts are off', 'Tags are listed here as they are cashed in, and not paid by the machine.'];
  const chip = (r: Row) => (r.state === 'paid' ? '<em class="c paid">Paid</em>' : r.state === 'sending' ? '<em class="c go">Sending</em>' : r.state === 'waiting' ? '<em class="c go">Waiting</em>' : r.state === 'skipped' ? (r.why?.startsWith('sold tokens') ? '<em class="c no">Sold tokens</em>' : '<em class="c no">Not paid</em>') : '<em class="c no">Listed</em>');
  const account = (wallet: string) => `<a href="https://solscan.io/account/${esc(wallet)}" target="_blank" rel="noopener"><code>${esc(short(wallet))}</code></a>`;
  // (a wallet paid for several tags at once, in one transaction (the rule of five), is one line: the payment, the tags
  // it was for folded under it. The owner, 2026-10-15: "we shouldnt have a new row for each payment, put the
  // transactions in a collapsable under the row")
  const lotOf = new Map<string, Row[]>();
  for (const r of listed) if (!isWaits(r) && r.state === 'paid' && r.signature) lotOf.set(r.signature, [...(lotOf.get(r.signature) ?? []), r]);
  const drawn = new Set<string>();
  const rows = listed
    .map((r) => {
      if (isWaits(r) || !r.signature) return r;
      const lot = lotOf.get(r.signature);
      if (!lot || lot.length < 2) return r;
      if (drawn.has(r.signature)) return null;
      drawn.add(r.signature);
      return lot;
    })
    .filter((r): r is Row | Waits | Row[] => r !== null)
    .map((r) =>
      Array.isArray(r)
        ? `<tr class="paid" data-s="paid">
        <td>${when(r[0].paidAt ?? r[0].at)}</td>
        <td><b>${esc(r[0].name)}</b></td>
        <td><details class="lot"><summary>${r.length} tags</summary><ol>${r.map((x) => `<li>${when(x.at)} <b>${esc(x.owner)}</b>${x.receipt ? ` <a class="rc" href="https://solscan.io/account/${esc(x.receipt)}" target="_blank" rel="noopener" title="the receipt this tag's payment left on the chain: while it stands, this tag cannot be paid again">receipt</a>` : ''} <small>${esc(x.ref)}</small></li>`).join('')}</ol></details></td>
        <td class="w">${r[0].wallet ? account(r[0].wallet) : '<i>none given</i>'}</td>
        <td>${chip(r[0])}</td>
        <td><b class="sol">${amount(r.reduce((n, x) => n + (x.lamports ?? 0), 0))} SOL</b> <a href="${tx(r[0].signature!)}" target="_blank" rel="noopener" title="one transaction for all ${r.length}">${esc(short(r[0].signature!))}</a></td>
      </tr>`
        : isWaits(r)
        ? // (one line for all of a wallet's tags that wait to be paid together: how far it has got, and what it is paid then)
          `<tr class="waiting" data-s="open">
        <td>${when(r.at)}</td>
        <td><b>${esc(r.name)}</b></td>
        <td>${r.have} ${r.have === 1 ? 'tag' : 'tags'}</td>
        <td class="w">${account(r.wallet)}</td>
        <td><em class="c go">${r.have < r.need ? `${r.have} of ${r.need}` : `${r.have} due`}</em></td>
        <td>${r.have < r.need ? `<span class="track five"><i style="width:${Math.round((r.have / r.need) * 100)}%"></i></span> <b class="go">${amount(r.pays)} SOL</b> <i>when ${r.need} are due</i>` : `<b class="go">${amount(r.pays)} SOL</b> <i>for ${r.have} ${r.have === 1 ? 'tag' : 'tags'}: ${esc(r.why)}</i>`}</td>
      </tr>`
        : `<tr class="${r.state}" data-s="${r.state === 'paid' ? 'paid' : r.state === 'sending' || r.state === 'waiting' ? 'open' : 'none'}">
        <td>${when(r.at)}</td>
        <td><b>${esc(r.name)}</b></td>
        <td>${esc(r.owner)}</td>
        <td class="w">${r.wallet ? account(r.wallet) : '<i>none given</i>'}</td>
        <td>${chip(r)}</td>
        <td>${outcome(r)}</td>
      </tr>`,
    )
    .join('');
  const claims = book.claims
    .map((c) => `<tr><td>${when(c.at)}</td><td><b class="sol">+${amount(c.lamports)} SOL</b></td><td>${c.from === 'pool' ? 'PumpSwap' : 'bonding curve'}</td><td><a href="${tx(c.signature)}" target="_blank" rel="noopener">${esc(short(c.signature))}</a></td></tr>`)
    .join('');
  // ---- what was paid each day, and to whom: sums of the rows listed (the book keeps the latest of them, and says how many)
  const byDay = new Map<string, { lamports: number; n: number }>();
  const byWallet = new Map<string, { lamports: number; n: number }>();
  for (const r of paidRows) {
    const day = (r.paidAt ?? r.at).slice(0, 10), d = byDay.get(day) ?? { lamports: 0, n: 0 }, wl = byWallet.get(r.wallet) ?? { lamports: 0, n: 0 };
    d.lamports += r.lamports ?? 0;
    d.n++;
    byDay.set(day, d);
    wl.lamports += r.lamports ?? 0;
    wl.n++;
    byWallet.set(r.wallet, wl);
  }
  const days = [...byDay.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1)).slice(-14);
  const most = Math.max(1, ...days.map(([, d]) => d.lamports));
  const chart = days.length
    ? `<div class="chart">${days.map(([day, d]) => `<div class="col" title="${esc(dayName(day))}: ${d.n} ${d.n === 1 ? 'tag' : 'tags'}, ${amount(d.lamports)} SOL"><b>${amount(d.lamports)}</b><i style="height:${Math.max(3, Math.round((d.lamports / most) * 100))}%"></i><span>${esc(dayName(day))}</span><small>${d.n} ${d.n === 1 ? 'tag' : 'tags'}</small></div>`).join('')}</div>`
    : '<p class="none">Nothing paid yet.</p>';
  const top = [...byWallet.entries()].sort((p, q) => q[1].lamports - p[1].lamports).slice(0, 6);
  const topMost = Math.max(1, ...top.map(([, v]) => v.lamports));
  const board = top.length
    ? `<ol class="board">${top.map(([wl, v]) => `<li><a href="https://solscan.io/account/${esc(wl)}" target="_blank" rel="noopener"><code>${esc(short(wl))}</code></a><span class="track"><i style="width:${Math.max(4, Math.round((v.lamports / topMost) * 100))}%"></i></span><b class="sol">${amount(v.lamports)} SOL</b><small>${v.n} ${v.n === 1 ? 'tag' : 'tags'}</small></li>`).join('')}</ol>`
    : '<p class="none">Nobody yet.</p>';
  const partial = book.tags > book.rows.length;
  const tile = (big: string, label: string, small = '') => `<div class="tile"><b>${big}</b><span>${label}</span>${small ? `<small>${small}</small>` : ''}</div>`;
  const step = (n: string, head: string, big: string, text: string) => `<div class="step"><em>${n}</em><h3>${head}</h3><b>${big}</b><p>${text}</p></div>`;
  // ---- the holder tiers (api/_lib/payouts.ts, rateOf), and the Elite: every wallet a tag has been paid at the top rate,
  // with all it has been paid (the owner, 2026-10-15: "we should show off the players, how much theyve made, that are at
  // MAX level ... to make it seem like theyre elite almost")
  const holders = !!(s.rules5From && s.fives && s.tiers.length), topTier = s.tiers[s.tiers.length - 1];
  // (what a tag pays is said as the range only once the rule has begun: before, the tiers are said with their moment, and the rest as it is)
  const holdersNow = holders && Date.parse(s.rules5From!) <= now;
  const maxL = Math.round(s.tagMax * 1e9);
  const elite = holders
    ? [...new Set(paidRows.filter((r) => (r.lamports ?? 0) >= maxL && r.at >= s.rules5From!).map((r) => r.wallet))]
        .map((wl) => {
          const mine = paidRows.filter((r) => r.wallet === wl).sort((a, b) => (a.at < b.at ? 1 : -1));
          return { wallet: wl, name: mine[0]?.name ?? '', earned: mine.reduce((n, r) => n + (r.lamports ?? 0), 0), tags: mine.length };
        })
        .sort((a, b) => b.earned - a.earned)
    : [];
  // ---- the free tags and the coin to hold past them (api/_lib/payouts.ts, pastFree): the owner, 2026-10-18, "the first 10
  // tags are free to play play to earn but after that we make the user have a token holder requirement", and of the price
  // then, "10 tags would give you enough sol to cover the minimum requirement (for now)"
  const gate = s.rules6From ? { at: `${new Date(s.rules6From).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}, ${s.rules6From.slice(11, 16)} UTC`, now: Date.parse(s.rules6From) <= now, free: s.freeTags, hold: s.holdMin.toLocaleString('en-US') } : null;
  const crown = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2.3 13h13.4v2H5.3v-2z"/></svg>';
  const tiersSection = holders
    ? `
  <section class="tiers" id="tiers">
    <h2>Level up: play free, earn SOL, hold $ZONA, earn more <small>${Date.parse(s.rules5From!) <= now ? 'live' : `from ${s.rules5From!.slice(11, 16)} UTC`}</small></h2>
    <div class="flow loop">
      ${gate ? step('1', 'Play free', `your first ${gate.free} tags`, `No coin needed for your first ${gate.free} paid tags, ${amount(s.tiers[0].perTag)} SOL each. Take a dog tag, hold it twenty minutes: it pays SOL.`) : step('1', 'Play free', `${amount(s.tiers[0].perTag)} SOL a tag`, 'No coin needed. Take a dog tag, hold it twenty minutes: it pays SOL.')}
      ${gate ? step('2', `Hold ${gate.hold} $ZONA`, `to be paid past ${gate.free}`, `${gate.now ? 'After' : `From ${gate.at}, after`} your first ${gate.free}, a tag is paid only while the wallet you are paid to holds ${gate.hold} $ZONA. Your first ${gate.free} tags pay enough SOL to buy it, at the price of 19 October.`) : step('2', 'Buy $ZONA', 'with what you earn', 'Put the SOL you win into $ZONA, in the wallet you are paid to.')}
      ${step('3', 'Every tag pays more', `+${s.holderPerM} SOL per 1M`, `Each million $ZONA you hold adds ${s.holderPerM} SOL to every tag you cash in.`)}
      ${step('4', `Reach ${esc(topTier.name)}`, `${amount(topTier.perTag)} SOL a tag`, `${topTier.from}M $ZONA held: ${Math.round((topTier.perTag / s.tiers[0].perTag) * 10) / 10}× the pay, and your name on the Elite board below.`)}
    </div>
    <div class="ladder">${s.tiers
      .map((t, i) => `<div class="tier${i === s.tiers.length - 1 ? ' elite' : ''}" style="--k:${(i / (s.tiers.length - 1)).toFixed(2)}"><em>${i === s.tiers.length - 1 ? crown : ''}${esc(t.name)}</em><b>${amount(t.perTag)}<span>SOL a tag</span></b><small>${t.from ? `${t.from}M+ $ZONA held` : 'under 1M $ZONA'}</small><small>${amount(t.perTag * N)} SOL a payout of ${N}</small></div>`)
      .join('')}</div>
    <p class="tiers-how">+${s.holderPerM} SOL a tag for every full 1,000,000 $ZONA in the wallet you are paid to, from 1,000,000 up to ${topTier.from},000,000: ${amount(topTier.perTag)} SOL a tag at most. What counts is the lower of what that wallet held when the tag was cashed in and when it is paid.</p>
    <div class="mine-box"><input id="mine-in" placeholder="Your Solana wallet: what do your tags pay?" maxlength="44" spellcheck="false" autocomplete="off" aria-label="Your Solana wallet"><button type="button" id="mine-go">Check</button><div id="mine-out" class="mine-out" aria-live="polite"></div></div>
    <p class="buy"><span>$ZONA</span><code>${esc(s.mint)}</code><a class="cta" href="https://pump.fun/coin/${esc(s.mint)}" target="_blank" rel="noopener">Buy $ZONA</a></p>
  </section>

  <section class="elite-sec">
    <h2>The Elite <small>paid at the top rate: ${topTier.from}M+ $ZONA held</small></h2>
    ${
      elite.length
        ? `<ol class="elite">${elite.map((e) => `<li><span class="crown">${crown}</span><span class="who"><b>${esc(e.name || 'unnamed')}</b><small><a href="https://solscan.io/account/${esc(e.wallet)}" target="_blank" rel="noopener">${esc(short(e.wallet))}</a></small></span><b class="sol">${amount(e.earned)} SOL</b><small class="n">${e.tags} ${e.tags === 1 ? 'tag' : 'tags'}</small></li>`).join('')}</ol>`
        : `<p class="none elite-none">${crown}No one has been paid at the Elite rate yet. Hold ${topTier.from},000,000 $ZONA and cash in a payout of ${N}: your name goes here, in gold.</p>`
    }
  </section>
`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ZONA · payouts</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root { --bg: #0c0e0b; --panel: #151812; --line: #272c22; --ink: #f0ebdd; --dim: #a9a391; --faint: #7d7868; --gold: #ffd35a; --ok: #9fc27a; --go: #d9b860; --bad: #d0604a; --mono: 'JetBrains Mono', ui-monospace, Consolas, monospace; --cond: 'Barlow Condensed', 'Bahnschrift', 'Arial Narrow', system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, 'Segoe UI', sans-serif; }
  a { color: var(--gold); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { font: 13px var(--mono); }
  .bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 26px; padding: 12px 28px; background: rgba(12, 14, 11, 0.94); border-bottom: 1px solid var(--line); backdrop-filter: blur(8px); }
  .logo { font: 800 26px/1 var(--cond); letter-spacing: 0.22em; color: var(--ink); }
  .logo:hover { text-decoration: none; color: var(--gold); }
  .bar nav { display: flex; gap: 22px; flex: 1; font: 600 13px/1 var(--cond); letter-spacing: 0.2em; text-transform: uppercase; }
  .bar nav a { color: var(--dim); padding: 6px 0; border-bottom: 2px solid transparent; white-space: nowrap; }
  .bar nav a:hover { color: var(--ink); text-decoration: none; }
  .bar nav a.on { color: var(--ink); border-bottom-color: var(--gold); }
  .cta { padding: 9px 20px 10px; font: 700 15px/1 var(--cond); letter-spacing: 0.26em; text-transform: uppercase; color: #14110b; background: var(--gold); }
  .cta:hover { text-decoration: none; background: #ffe08a; }
  main { max-width: 1160px; margin: 0 auto; padding: 0 22px 70px; }
  section { margin-top: 44px; }
  h2 { margin: 0 0 14px; font: 700 15px/1 var(--cond); letter-spacing: 0.26em; text-transform: uppercase; color: var(--gold); }
  h2 small { margin-left: 10px; font: 500 13px/1 var(--cond); letter-spacing: 0.14em; color: var(--faint); }
  .hero { margin-top: 34px; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 34px; align-items: end; }
  .pill { display: inline-flex; align-items: center; gap: 9px; padding: 6px 13px 7px; font: 600 12px/1 var(--cond); letter-spacing: 0.2em; text-transform: uppercase; border: 1px solid var(--line); color: var(--dim); }
  .pill::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--faint); }
  .pill.on { color: var(--ok); border-color: rgba(159, 194, 122, 0.5); }
  .pill.on::before { background: var(--ok); box-shadow: 0 0 0 4px rgba(159, 194, 122, 0.18); }
  .pill.dry { color: var(--go); }
  .pill.dry::before { background: var(--go); }
  .pill.bad { color: var(--bad); border-color: rgba(208, 96, 74, 0.5); }
  .pill.bad::before { background: var(--bad); }
  .big { margin: 14px 0 4px; font: 800 clamp(64px, 11vw, 132px)/0.9 var(--cond); letter-spacing: 0.01em; color: var(--gold); font-variant-numeric: tabular-nums; }
  .big span { font-size: 0.36em; letter-spacing: 0.12em; color: var(--ink); }
  .under { margin: 0; font: 700 22px/1.1 var(--cond); letter-spacing: 0.2em; text-transform: uppercase; }
  .lead { margin: 14px 0 0; max-width: 62ch; color: var(--dim); }
  .note { margin: 14px 0 0; padding: 10px 14px; border-left: 3px solid var(--bad); background: var(--panel); color: var(--dim); }
  .note b { display: block; color: var(--ink); }
  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .tile { padding: 14px 16px 15px; background: var(--panel); border: 1px solid var(--line); border-top: 3px solid var(--gold); }
  .tile b { display: block; font: 800 34px/1 var(--cond); font-variant-numeric: tabular-nums; }
  .tile span { display: block; margin-top: 5px; font: 600 12px/1.2 var(--cond); letter-spacing: 0.18em; text-transform: uppercase; color: var(--dim); }
  .tile small { display: block; margin-top: 7px; font-size: 12.5px; line-height: 1.35; color: var(--faint); }
  .flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 34px; }
  .step { position: relative; padding: 16px 16px 14px; background: var(--panel); border: 1px solid var(--line); }
  .step:not(:last-child)::after { content: ''; position: absolute; right: -26px; top: 50%; width: 18px; height: 18px; margin-top: -9px; border: solid var(--gold); border-width: 3px 3px 0 0; transform: rotate(45deg); }
  .step em { font: 700 12px/1 var(--mono); font-style: normal; color: #14110b; background: var(--gold); padding: 3px 7px; }
  .step h3 { margin: 12px 0 6px; font: 700 13px/1.2 var(--cond); letter-spacing: 0.2em; text-transform: uppercase; color: var(--dim); }
  .step b { display: block; font: 800 26px/1.05 var(--cond); letter-spacing: 0.02em; }
  .step p { margin: 8px 0 0; font-size: 13px; line-height: 1.4; color: var(--dim); }
  .two { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 34px; }
  .chart { display: flex; align-items: flex-end; gap: 8px; height: 230px; padding: 14px 14px 0; background: var(--panel); border: 1px solid var(--line); }
  .col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
  .col i { display: block; width: 100%; max-width: 64px; background: linear-gradient(var(--gold), #b98522); }
  .col b { margin-bottom: 5px; font: 700 15px/1 var(--cond); font-variant-numeric: tabular-nums; }
  .col span { margin-top: 7px; font: 12px/1 var(--mono); color: var(--dim); }
  .col small { margin: 3px 0 9px; font: 11px/1 var(--mono); color: var(--faint); white-space: nowrap; }
  .board { margin: 0; padding: 6px 14px; list-style: none; counter-reset: n; background: var(--panel); border: 1px solid var(--line); }
  .board li { counter-increment: n; display: grid; grid-template-columns: 22px 92px minmax(0, 1fr) auto 58px; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
  .board li:last-child { border-bottom: 0; }
  .board li::before { content: counter(n); font: 700 14px/1 var(--cond); color: var(--faint); }
  .track { display: block; height: 8px; background: rgba(255, 255, 255, 0.07); }
  .track i { display: block; height: 100%; background: var(--gold); }
  .track.five { display: inline-block; width: 84px; margin-right: 8px; vertical-align: middle; }
  b.go { font-variant-numeric: tabular-nums; }
  .board small { font: 11px/1 var(--mono); color: var(--faint); text-align: right; }
  .none { margin: 0; padding: 22px 16px; background: var(--panel); border: 1px solid var(--line); color: var(--faint); }
  .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 10px; }
  .filters button { padding: 6px 13px 7px; font: 600 12px/1 var(--cond); letter-spacing: 0.18em; text-transform: uppercase; color: var(--dim); background: none; border: 1px solid var(--line); cursor: pointer; }
  .filters button:hover { color: var(--ink); border-color: var(--faint); }
  .filters button.on { color: #14110b; background: var(--gold); border-color: var(--gold); }
  .filters input { flex: 1; min-width: 180px; padding: 6px 11px 7px; font: 13px var(--mono); color: var(--ink); background: var(--panel); border: 1px solid var(--line); }
  .filters input::placeholder { color: var(--faint); }
  .wrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: middle; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover td { background: rgba(255, 255, 255, 0.025); }
  th { position: sticky; top: 0; font: 600 12px/1 var(--cond); letter-spacing: 0.2em; text-transform: uppercase; color: var(--faint); background: #11140f; }
  td.w { white-space: nowrap; }
  .sol { color: var(--ok); font-variant-numeric: tabular-nums; }
  .go { color: var(--go); }
  .c { display: inline-block; padding: 3px 8px 4px; font: 700 11px/1 var(--cond); font-style: normal; letter-spacing: 0.18em; text-transform: uppercase; white-space: nowrap; }
  .c.paid { color: #10130f; background: var(--ok); }
  .c.go { color: #14110b; background: var(--go); }
  .c.no { color: var(--dim); border: 1px solid var(--line); }
  tr.skipped td, tr.off td { color: var(--faint); }
  i { color: var(--dim); }
  td small { margin-left: 6px; font: 11px var(--mono); color: var(--faint); }
  a.rc { font-size: 12px; color: var(--dim); text-decoration: underline; }
  details.lot summary { cursor: pointer; white-space: nowrap; }
  details.lot ol { margin: 6px 0 2px; padding-left: 18px; font-size: 13px; line-height: 1.5; }
  time { white-space: nowrap; font: 12.5px var(--mono); color: var(--dim); }
  .rules { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .rule { padding: 15px 16px; background: var(--panel); border: 1px solid var(--line); }
  .rule h3 { margin: 0 0 6px; font: 700 17px/1.1 var(--cond); letter-spacing: 0.08em; text-transform: uppercase; }
  .rule p { margin: 0; font-size: 13.5px; color: var(--dim); }
  footer { margin-top: 50px; padding: 22px 28px 30px; display: flex; flex-wrap: wrap; gap: 20px; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); font: 600 12px/1 var(--cond); letter-spacing: 0.2em; text-transform: uppercase; color: var(--faint); }
  @media (max-width: 860px) {
    .bar { gap: 14px; padding: 10px 14px; }
    .bar nav { gap: 14px; overflow-x: auto; }
    .hero, .two, .rules { grid-template-columns: minmax(0, 1fr); }
    .flow { grid-template-columns: minmax(0, 1fr); gap: 26px; }
    .step:not(:last-child)::after { right: 50%; top: auto; bottom: -19px; margin: 0 -9px 0 0; transform: rotate(135deg); }
    .board li { grid-template-columns: 18px 84px minmax(0, 1fr) auto; }
    .board small { display: none; }
  }
  .loop { margin-bottom: 22px; }
  .ladder { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
  .tier { padding: 14px 14px 15px; background: var(--panel); border: 1px solid var(--line); border-top: 3px solid color-mix(in srgb, var(--gold) calc(var(--k) * 100%), #5d594c); }
  .tier em { display: flex; align-items: center; gap: 6px; font: 700 13px/1 var(--cond); font-style: normal; letter-spacing: 0.24em; text-transform: uppercase; color: var(--dim); }
  .tier em svg { width: 16px; height: 16px; }
  .tier b { display: block; margin-top: 10px; font: 800 36px/1 var(--cond); font-variant-numeric: tabular-nums; color: var(--ink); }
  .tier b span { display: block; margin-top: 4px; font: 600 11px/1 var(--cond); letter-spacing: 0.2em; text-transform: uppercase; color: var(--dim); }
  .tier small { display: block; margin-top: 8px; font-size: 12.5px; line-height: 1.3; color: var(--faint); }
  .tier.elite { background: linear-gradient(180deg, rgba(255, 211, 90, 0.16), var(--panel) 70%); border-color: rgba(255, 211, 90, 0.5); box-shadow: 0 0 28px rgba(255, 211, 90, 0.12); }
  .tier.elite em, .tier.elite b { color: var(--gold); }
  .tiers-how { margin: 12px 0 0; font-size: 14px; line-height: 1.5; color: var(--dim); }
  .mine-box { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .mine-box input { flex: 1 1 320px; min-width: 0; padding: 11px 13px; background: var(--panel); border: 1px solid var(--line); color: var(--ink); font: 14px var(--mono); }
  .mine-box input:focus { outline: none; border-color: var(--gold); }
  .mine-box button { padding: 10px 20px; border: 0; background: var(--gold); color: #14110b; font: 700 15px/1 var(--cond); letter-spacing: 0.24em; text-transform: uppercase; cursor: pointer; }
  .mine-out { flex-basis: 100%; min-height: 1.4em; font-size: 15px; line-height: 1.5; color: var(--dim); }
  .mine-out b { color: var(--gold); }
  .buy { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin: 14px 0 0; }
  .buy span { font: 700 14px/1 var(--cond); letter-spacing: 0.24em; color: var(--dim); }
  .buy code { font: 13px var(--mono); color: var(--ink); word-break: break-all; }
  .elite { margin: 0; padding: 4px 16px; list-style: none; background: linear-gradient(180deg, rgba(255, 211, 90, 0.08), var(--panel)); border: 1px solid rgba(255, 211, 90, 0.42); }
  .elite li { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto 64px; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  .elite li:last-child { border-bottom: 0; }
  .elite .crown, .elite-none svg { color: var(--gold); }
  .elite .crown svg { width: 24px; height: 24px; display: block; }
  .elite .who b { font: 700 21px/1 var(--cond); letter-spacing: 0.06em; color: var(--gold); }
  .elite .who small { display: block; margin-top: 4px; font: 12px var(--mono); }
  .elite .sol { font: 800 22px/1 var(--cond); font-variant-numeric: tabular-nums; }
  .elite .n { font-size: 12.5px; color: var(--dim); text-align: right; }
  .elite-none { display: flex; align-items: center; gap: 12px; padding: 16px 18px; border: 1px dashed rgba(255, 211, 90, 0.4); color: var(--dim); }
  .elite-none svg { flex: none; width: 26px; height: 26px; }
  @media (max-width: 900px) {
    .ladder { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tier.elite { grid-column: 1 / -1; }
  }
  @media (max-width: 560px) {
    main { padding: 0 14px 50px; }
    .bar nav a:first-child { display: none; }
    .cta { padding: 8px 12px 9px; letter-spacing: 0.16em; white-space: nowrap; }
    .tile { padding: 12px 12px 13px; }
    .tile b { font-size: 27px; }
    .under { font-size: 18px; letter-spacing: 0.14em; }
    .chart { gap: 5px; padding: 12px 8px 0; }
    .col small { display: none; }
    .col span { margin-bottom: 9px; }
  }
</style>
</head>
<body>
<header class="bar">
  <a class="logo" href="/" title="Back to the game">ZONA</a>
  <nav><a href="/">The game</a><a href="${SITE.changelog}">Changelog</a><a class="on" href="/payouts">Payouts</a><a href="${SITE.x}" target="_blank" rel="noopener noreferrer">X</a></nav>
  <a class="cta" href="/">Play free</a>
</header>
<main>
  <div class="hero">
    <div>
      <span class="pill ${state[0]}">${state[1]}</span>
      <div class="big">${amount(book.paidLamports)} <span>SOL</span></div>
      <p class="under">paid to players${wallets ? ` · ${book.paid} ${book.paid === 1 ? 'tag' : 'tags'} · ${wallets}${partial ? '+' : ''} ${wallets === 1 ? 'wallet' : 'wallets'}` : ''}</p>
      <p class="under">all of ZONA PvP, the Zone and the Arena together: the Arena's matches are played for nothing so far</p>
      <p class="lead">Take another player's dog tag, stay alive with it for twenty minutes, and it is cashed in. This page is the whole account of what is paid for that: nothing is paid that is not listed here, and every payment listed here is a transaction on Solana that anybody can look up. ${esc(state[2])}</p>
      ${book.claimNote ? `<div class="note"><b>Collecting creator rewards did not work the last time it was tried</b>${esc(book.claimNote)}</div>` : ''}
    </div>
    <div class="tiles">
      ${holdersNow ? tile(`${amount(s.tiers[0].perTag)}–${amount(topTier.perTag)} SOL`, 'a tag pays, by $ZONA held', `<a href="#tiers">${esc(s.tiers[0].name)} ${amount(s.tiers[0].perTag)} up to ${esc(topTier.name)} ${amount(topTier.perTag)}: see the tiers</a>${N > 1 ? `. Paid when a wallet has ${N} due` : ''}`) : tile(s.tagPays === null ? '?' : `${amount(s.tagPays)} SOL`, 'a tag pays right now', s.fives ? `flat, whatever the treasury holds${N > 1 ? `: paid when a wallet has ${N} due` : ''}` : `${pct}% of the treasury, ${amount(s.floor)} at least`)}
      ${tile(s.balance === null ? '?' : `${amount(s.balance)} SOL`, 'in the treasury', s.treasury ? `<a href="https://solscan.io/account/${esc(s.treasury)}" target="_blank" rel="noopener">${esc(short(s.treasury))}</a>${s.madeTheCoin ? ', the wallet that made the coin' : ''}` : '')}
      ${tile(`${amount(book.claimedLamports)} SOL`, 'creator rewards collected', (s.waiting !== null ? `${amount(s.waiting)} waiting to be collected` : '') + (s.waitingNote ? `${s.waiting !== null ? '. ' : ''}${esc(s.waitingNote)}` : ''))}
      ${tile(String(open), open === 1 ? 'tag on its way or waiting' : 'tags on their way or waiting', waitTags ? `${waitTags} of them, ${amount(waitTags * s.flatPay)} SOL, owed to ${waits.length} ${waits.length === 1 ? 'wallet that is' : 'wallets that are'} ${s.fives ? `paid at ${N} due` : 'being paid now'}` : open ? 'Each is paid as soon as it can be' : 'Everything owed has been paid')}
    </div>
  </div>

${tiersSection}
  <section>
    <h2>How the money moves</h2>
    <div class="flow">
      ${step('1', 'The coin is traded', 'Creator rewards', 'Every trade of the ZONA coin on pump.fun leaves a little for the wallet that made it.')}
      ${step('2', 'Collected by the machine', `${amount(book.claimedLamports)} SOL so far`, `Into one treasury wallet, automatically${s.balance === null ? '' : `. It holds ${amount(s.balance)} SOL now`}.`)}
      ${step('3', 'You cash a tag in', holdersNow ? `${amount(s.tiers[0].perTag)}–${amount(topTier.perTag)} SOL a tag` : `${s.tagPays === null ? (s.fives ? flat + ' SOL' : `${pct}%`) : `${amount(s.tagPays)} SOL`} a tag`, `Kill a player, take their tag, hold it twenty minutes. ${holdersNow ? `A tag pays ${flat} SOL, and up to ${amount(topTier.perTag)} SOL to a wallet that holds $ZONA.` : s.fives ? `A tag pays ${flat} SOL, whatever the treasury holds.` : `A tag pays ${pct}% of the treasury, never less than ${amount(s.floor)} SOL.`}`)}
      ${step('4', 'Straight to your wallet', `${amount(book.paidLamports)} SOL paid`, s.fives && N > 1 ? `When ${N} of your tags are due: ${lot} SOL at once, with a receipt for each tag left on the chain. No tag is ever paid twice.` : 'Within a minute or so, with a receipt left on the chain: no tag is ever paid twice.')}
    </div>
  </section>

  <section class="two">
    <div>
      <h2>Paid each day <small>SOL, days in UTC${partial ? ', of those listed' : ''}</small></h2>
      ${chart}
    </div>
    <div>
      <h2>The best-paid wallets <small>${partial ? 'of those listed' : 'so far'}</small></h2>
      ${board}
    </div>
  </section>

  <section>
    <h2>The ledger: tags cashed in <small>${partial ? `the latest ${book.rows.length} of ${book.tags}` : `${book.tags} in all`}</small></h2>
    <div class="filters">
      <button type="button" class="on" data-f="all">All ${book.rows.length}</button>
      <button type="button" data-f="paid">Paid ${paidRows.length}</button>
      <button type="button" data-f="open">Waiting ${open}</button>
      <button type="button" data-f="none">Not paid ${book.rows.length - paidRows.length - open}</button>
      <input type="search" placeholder="Find a player or a wallet" aria-label="Find a player or a wallet">
    </div>
    <div class="wrap">
    <table id="ledger">
      <thead><tr><th>When</th><th>Player</th><th>Whose tag</th><th>Wallet</th><th>State</th><th>Paid · transaction</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><i>Nothing yet.</i></td></tr>'}</tbody>
    </table>
    </div>
  </section>

  <section>
    <h2>Into the treasury: creator rewards collected</h2>
    <div class="wrap">
    <table>
      <thead><tr><th>When</th><th>Collected</th><th>From</th><th>Transaction</th></tr></thead>
      <tbody>${claims || '<tr><td colspan="4"><i>Nothing yet.</i></td></tr>'}</tbody>
    </table>
    </div>
  </section>

  <section>
    <h2>The rules the machine pays by</h2>
    <div class="rules">
      <div class="rule"><h3>What a tag pays</h3><p>${holdersNow ? `${flat} SOL, and ${s.holderPerM} SOL more for every full 1,000,000 $ZONA the wallet holds, up to ${amount(topTier.perTag)} SOL (see the tiers above): the same whatever the treasury holds.` : s.fives ? `${flat} SOL, flat: the same whatever the treasury holds.` : `${pct}% of what the treasury holds at the moment it is paid, and never less than ${amount(s.floor)} SOL.`} The treasury is filled by the coin's creator rewards on pump.fun, collected automatically.</p></div>${
        s.fives && N > 1
          ? `
      <div class="rule"><h3>Paid when ${N} are due</h3><p>A wallet is paid when ${N} of its tags are due, and then for all that are due at once: ${lot} SOL for ${N}, in one transaction that leaves a receipt for each tag. Fewer than ${N} wait, counted, on one line of the ledger ("3 of ${N}"), for as long as it takes: no tag is lost for waiting. A tag that is not paid (over the ${s.rolling ? `${s.walletTags24} in ${s.hours} hours` : `${s.walletDayTags} a day`}, or traded) does not count toward the ${N}.</p></div>`
          : ''
      }
      ${
        s.rolling
          ? `<div class="rule"><h3>${s.walletTags24 === N && s.fives ? `One payout of ${N} ${s.hours === 24 ? 'a day' : `every ${s.hours} hours`}` : `${s.walletTags24} tags a wallet, in any ${s.hours} hours`}</h3><p>One wallet is paid for no more than ${s.walletTags24} tags cashed in in any ${s.hours} hours${s.walletTags24 === N && s.fives ? `: one payment of ${N}, all of them at once when the ${N}th is due, and no second one until ${s.hours} hours after the first of them was cashed in` : ''}. One cashed in over that is listed and not paid: it does not wait for later. And no more than`
          : `<div class="rule"><h3>${s.walletDayTags} tags a wallet, a day</h3><p>One wallet is paid for the first ${s.walletDayTags} tags it cashes in on a day (days are counted in UTC). One cashed in after those, that day, is listed and not paid: it does not wait for tomorrow. And no more than`
      } ${Math.round(s.dayShare * 100)}% of the treasury leaves it in one day: a tag over that waits, and is paid when there is room.</p></div>
      ${
        s.rules5From && s.fives
          ? `<div class="rule"><h3>Holding $ZONA pays more</h3><p>From ${new Date(s.rules5From).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}, ${s.rules5From.slice(11, 16)} UTC, a tag pays ${s.holderPerM} SOL more for every full 1,000,000 $ZONA its wallet holds (nothing under 1,000,000), up to ${s.tagMax} SOL a tag in all (${Math.round((s.tagMax - s.flatPay / 1e9) / s.holderPerM)},000,000 held). What counts is the lower of what the wallet held when the tag was cashed in and when it is paid.</p></div>
      `
          : ''
      }${
        gate
          ? `<div class="rule"><h3>${gate.free} tags free, then hold ${gate.hold} $ZONA</h3><p>From ${gate.at}, once a wallet, or the player cashing in, has had ${gate.free} tags paid, a tag is paid only if that wallet holds ${gate.hold} $ZONA: the lower of what it held when the tag was cashed in and when it is paid. ${s.rules7From && Date.parse(s.rules7From) <= now ? `Since ${new Date(s.rules7From).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}, ${s.rules7From.slice(11, 16)} UTC, it is what the wallet holds when the tag is paid, and a tag cashed in without it waits: it is paid as soon as the wallet holds ${gate.hold} $ZONA, within ${s.holdWaitH} hours of being cashed in, and after that it is not paid.` : 'A tag cashed in without it is listed and not paid.'} On 19 October, at 0.00000062 SOL a coin (DexScreener), ${gate.hold} $ZONA cost about ${(s.holdMin * 6.2e-7).toFixed(3)} SOL, and ${gate.free} tags pay at least ${amount(s.tiers[0].perTag * gate.free)} SOL. Tags paid before this rule began count toward the ${gate.free}, as far as this ledger lists them.</p></div>
      `
          : ''
      }<div class="rule"><h3>Trading tags is not paid</h3><p>When two players cash each other's tags inside a day, the first of the two is paid and the second is not. Killing a friend and being killed back earns one tag between you, not two.</p></div>
      <div class="rule"><h3>Paid once, and the chain sees to it</h3><p>Each payment leaves a receipt, an account of its own, and a second payment for the same tag cannot be made while that receipt stands. Each payment also carries a note, "ZONA dog tag" and the reference shown beside it here.</p></div>
      <div class="rule"><h3>No wallet, no payment</h3><p>A tag cashed in with no wallet given is listed and not paid. The wallet is asked for in the game, on the rewards window: add it before you cash a tag in.</p></div>
${
        s.rules4From
          ? `      <div class="rule"><h3>What changes on ${new Date(s.rules4From).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3><p>From ${s.rules4From.slice(11, 16)} UTC a wallet is paid for ${s.walletTags24} tags every 12 hours, where it was ${s.walletTags24} in any 24: one payout of ${N}, all at once when the ${N}th is due, and the next one can come 12 hours after the first of those was cashed in. Whatever was cashed in before then is judged as it was.</p></div>
`
          : ''
      }${
        s.rules3From
          ? `      <div class="rule"><h3>What changes on 14 October 2026</h3><p>From ${s.rules3From.slice(11, 16)} UTC the limit is ${s.walletTags24} tags a wallet in any 24 hours, where it was ${s.walletDayTags} a UTC day, which left nobody able to come to ${N} in one day. Whatever was cashed in before then is judged as it was.</p></div>
`
          : ''
      }      <div class="rule"><h3>What changed on 13 October 2026</h3><p>The treasury was paying out half as much again as came in. From 04:30 UTC a tag pays ${amount(s.floor)} SOL at least (it was 0.02), the limit of ${s.walletDayTags} a day is a limit and not a queue, and traded tags are not paid. Everything cashed in before then ${from2 ? 'was paid as it was promised, until the list was cleared (below)' : 'is paid as it was promised'}.</p></div>${
        !from2
          ? ''
          : `
      <div class="rule"><h3>What ${s.fives ? 'changed' : 'changes'} on ${cut}</h3><p>From ${from2.slice(11, 16)} UTC a tag pays ${flat} SOL flat, and no longer a share of the treasury${N > 1 ? `; and a wallet is paid when ${N} of its tags are due, for all of them at once (${lot} SOL for ${N}), not tag by tag. Until then its tags wait, counted, and none is lost for waiting` : ''}. The list ${s.fives ? 'was' : 'is'} cleared at that moment: a tag cashed in before then that ${s.fives ? 'had' : 'has'} not been paid by then ${s.fives ? 'was' : 'is'} cancelled and taken off this list, and nothing is owed for it. What was paid stays paid.</p></div>`
      }
    </div>
  </section>
</main>
<footer><span>ZONA · PvP survival shooter · play to earn</span><span>As it stood at ${when(new Date(now).toISOString())}</span><span><a href="/">Back to the game</a></span></footer>
<script>
  for (const t of document.querySelectorAll('time')) t.title = new Date(t.dateTime).toLocaleString();
  // what a wallet's tags pay (api/cashins.ts ?format=wallet): the one given in the game on this device is asked about at once
  (() => {
    const inp = document.getElementById('mine-in'), go = document.getElementById('mine-go'), out = document.getElementById('mine-out');
    if (!inp || !go || !out) return;
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const gold = (t) => { const e = document.createElement('b'); e.textContent = t; return e; };
    const ask = async () => {
      const v = inp.value.trim();
      if (!v) return;
      out.textContent = 'Reading the wallet...';
      try {
        const r = await (await fetch('/api/cashins?format=wallet&w=' + encodeURIComponent(v))).json();
        if (r.error) { out.textContent = r.error === 'not a wallet address' ? 'That is not a Solana wallet address.' : 'The wallet could not be read just now: try again in a moment.'; return; }
        out.textContent = '';
        out.append(gold(r.tier), ' · ' + fmt(r.held) + ' $ZONA held · your tags pay ', gold(r.perTag + ' SOL'), ' each, ' + r.payout + ' SOL a payout of ${N}. ' + (r.next ? fmt(r.next.more) + ' more $ZONA makes you ' + r.next.tier + ': ' + r.next.perTag + ' SOL a tag.' : 'The top rate.') + (r.tags ? ' Paid so far: ' + r.earned + ' SOL for ' + r.tags + (r.tags === 1 ? ' tag.' : ' tags.') : ''));
        // (its free tags and the coin to hold past them: see the rule below)
        if (r.free) out.append(' ', r.free.paid < r.free.of ? gold((r.free.of - r.free.paid) + ' of ' + r.free.of + ' free tags left') : r.free.holds ? gold('holds the ' + fmt(r.free.hold) + ' $ZONA') : gold('needs ' + fmt(r.free.hold) + ' $ZONA'), r.free.paid < r.free.of ? ' before this wallet must hold ' + fmt(r.free.hold) + ' $ZONA to be paid.' : r.free.holds ? ' its tags need past its first ' + r.free.of + '.' : ' to be paid: its first ' + r.free.of + ' tags are paid.');
      } catch { out.textContent = 'The wallet could not be read just now: try again in a moment.'; }
    };
    go.onclick = ask;
    inp.onkeydown = (e) => { if (e.key === 'Enter') ask(); };
    try { const saved = localStorage.getItem('zona.wallet'); if (saved) { inp.value = saved; ask(); } } catch {}
  })();
  // the ledger, narrowed: by what became of a tag, and by a name or a wallet typed in
  (() => {
    const rows = [...document.querySelectorAll('#ledger tbody tr[data-s]')], buttons = [...document.querySelectorAll('.filters button')], find = document.querySelector('.filters input');
    let kind = 'all';
    const show = () => {
      const q = find.value.trim().toLowerCase();
      for (const r of rows) r.hidden = (kind !== 'all' && r.dataset.s !== kind) || (!!q && !r.textContent.toLowerCase().includes(q) && ![...r.querySelectorAll('a')].some((a) => a.href.toLowerCase().includes(q)));
    };
    for (const b of buttons) b.onclick = () => { kind = b.dataset.f; for (const o of buttons) o.classList.toggle('on', o === b); show(); };
    find.oninput = show;
  })();
  ${s.due || open > waits.reduce((n, x) => n + (x.have < x.need ? x.have : 0), 0) ? "fetch('/api/tick').catch(() => {});" : ''}
</script>
</body>
</html>`;
}

export async function show(request: Request, w: World = live()): Promise<Response> {
  const format = new URL(request.url).searchParams.get('format');
  const s = await cached(w, 'snapshot', 20_000, () => snapshot(w));
  if (format === 'status') {
    // (due: enough rewards are waiting to be collected; whoever is told so calls api/tick, which collects them)
    // (what was there before the second cut-over is there still, and means what it meant: from the cut-over `share` is 0
    // and `tagPays` is the flat figure. New: `minTags`, how many of a wallet's tags must be due before it is paid, 1
    // until the cut-over; and `next`, what is to change and when, while that is still to come.)
    const next = s.fives || !s.rules2From ? null : { from: s.rules2From, tagPays: sol(s.flatPay), minTags: s.minTags };
    return Response.json({ on: s.mode === 'on' && !s.problem, tagPays: s.tagPays === null ? null : sol(s.tagPays), share: s.share, floor: sol(s.floor), treasury: s.treasury, due: s.due, minTags: s.fives ? s.minTags : 1, next, holder: s.rules5From && s.fives ? { from: s.rules5From, perM: s.holderPerM, max: s.tagMax } : null, gate: s.rules6From ? { from: s.rules6From, free: s.freeTags, hold: s.holdMin } : null }, { headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=120' } });
  }
  const book = await cached(w, 'book', 20_000, async () => withOldEntries(w, await glanceBook(w.store)));
  const cache = { 'cache-control': 'public, s-maxage=20, stale-while-revalidate=60' };
  // (what the whole platform has paid players, and since when: the one line every money screen of both games shows,
  // the owner: "the entire platform is zonapvp so it should be aknowlsegd on each respective payouts screen". The
  // Zone's tags alone so far; the arena's wagers are added here when they pay.)
  if (format === 'total') return Response.json({ paidSol: sol(book.paidLamports), paid: book.paid, since: book.since, zona: sol(book.paidLamports), arena: 0 }, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  if (format === 'wallet') {
    // (a wallet's standing under the holder rule: what it holds of the coin, its tier, what a tag pays it, and what it has
    // been paid: the payouts page's own wallet check, and the game's rewards window, so that neither says the floor when
    // it is not what is paid. Read from the chain no more than once in 30 seconds a wallet.)
    const who = (new URL(request.url).searchParams.get('w') ?? '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(who)) return Response.json({ error: 'not a wallet address' }, { status: 400 });
    if (!s.rules5From || !s.fives) return Response.json({ error: 'no holder rule' }, { status: 404 });
    let r: Awaited<ReturnType<typeof walletRate>>;
    try {
      r = await cached(w, `rate:${who}`, 30_000, () => walletRate(w, who));
    } catch {
      return Response.json({ error: 'the wallet could not be read' }, { status: 502 });
    }
    const mine = book.rows.filter((x) => x.wallet === who && x.state === 'paid');
    const held = Number(r.held / 1_000_000n);
    return Response.json(
      {
        wallet: who,
        held,
        millions: r.millions,
        tier: r.tier,
        max: r.max,
        perTag: sol(Number(r.perTag)),
        payout: sol(Number(r.perTag) * s.minTags),
        next: r.next ? { tier: r.next.tier, from: r.next.from, perTag: sol(Number(r.next.perTag)), more: Math.max(0, r.next.from * 1_000_000 - held) } : null,
        earned: sol(mine.reduce((n, x) => n + (x.lamports ?? 0), 0)),
        tags: mine.length,
        // (its free tags, as far as the book knows them by this wallet: the player's own count is the site's alone, see pastFree)
        ...(s.rules6From ? { free: { paid: paidTo(book, `w:${who}`), of: s.freeTags, hold: s.holdMin, holds: held >= s.holdMin } } : {}),
      },
      { headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    );
  }
  if (format === 'json') {
    // (a tag not paid yet goes by no name here: its reference is where the receipt of its payment will be. And a
    // wallet whose tags wait to be paid together is one row here as it is one line of the page: a row like any other
    // that is waiting, with `tags` (how many of its tags the row stands for), `have` of `need`, and `pays`, in
    // lamports, what it is paid when it is paid. `owed` counts every one of those tags.)
    const listed = lines(book, s);
    const rows = listed.map((x) => {
      if (isWaits(x)) return { at: x.at, name: x.name, owner: '', wallet: x.wallet, state: 'waiting', why: `${x.have < x.need ? `${x.have} of ${x.need}` : `${x.have} due`}: ${x.why}`, hold: x.hold, rules: 2, tags: x.have, have: x.have, need: x.need, pays: x.pays };
      const { tries: _tries, ...r } = x;
      return r.state === 'paid' ? r : { ...r, ref: undefined };
    });
    const waits = listed.filter(isWaits), owedTags = waits.reduce((n, x) => n + x.have, 0);
    return Response.json({ status: s, since: book.since, tags: book.tags, paid: book.paid, paidSol: sol(book.paidLamports), claimedSol: sol(book.claimedLamports), owed: { tags: owedTags, wallets: waits.length, sol: sol(owedTags * s.flatPay) }, rows, claims: book.claims }, { headers: cache });
  }
  return new Response(page(book, s, w.now()), { headers: { 'content-type': 'text/html; charset=utf-8', ...cache } });
}

export const GET = (request: Request) => show(request);
