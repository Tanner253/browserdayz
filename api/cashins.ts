// The payouts page (/payouts, see vercel.json): what the treasury holds, what a tag pays
// now, every tag cashed in and what became of it, and every collection of creator rewards,
// each payment with the transaction anybody can look up on the chain.
//
//   ?format=json     the same as data
//   ?format=status   the few numbers the game shows on its rewards window
//
// Everything on it comes from the book (_lib/payouts.ts) and from the chain as it stands. It
// is put together at most once in twenty seconds however many people look at it.

import { live } from './_lib/live.js';
import { dayOf, editBook, readBook, snapshot, sol, type Book, type Entry, type Row, type Snapshot, type World } from './_lib/payouts.js';

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
  const paths = await w.store.list('cashins/');
  const old = (await Promise.all(paths.map((p) => w.store.read<Entry>(p).then((r) => r?.data ?? null, () => null)))).filter((e): e is Entry => !!e && typeof e.id === 'string' && typeof e.at === 'string');
  return editBook(w, (b) => {
    b.seeded = true;
    for (const e of old) {
      if (b.rows.some((r) => r.id === e.id)) continue;
      b.rows.push({ id: e.id, at: e.at, name: String(e.name ?? ''), owner: String(e.owner ?? ''), wallet: String(e.wallet ?? ''), state: 'off' });
      b.tags++;
    }
  });
}

function outcome(r: Row): string {
  // (the note on the transaction itself reads "ZONA dog tag" and this reference)
  const link = `<a href="${tx(r.signature ?? '')}" target="_blank" rel="noopener" title="the transaction carries the note: ZONA dog tag ${esc(r.ref ?? '')}">${esc(short(r.signature ?? ''))}</a>${r.ref ? ` <small>${esc(r.ref)}</small>` : ''}`;
  if (r.state === 'paid') return `<b class="sol">${amount(r.lamports ?? 0)} SOL</b> ${link}`;
  if (r.state === 'sending') return `<span class="go">${amount(r.lamports ?? 0)} SOL on its way</span> ${link}`;
  if (r.state === 'waiting') return `<span class="go">waiting</span> <i>${esc(r.why ?? '')}</i>`;
  if (r.state === 'skipped') return `<i>not paid: ${esc(r.why ?? '')}</i>`;
  return '<i>listed (payouts were not on)</i>';
}

function page(book: Book, s: Snapshot, now: number): string {
  const today = book.rows.filter((r) => r.day === dayOf(now) && (r.state === 'paid' || r.state === 'sending'));
  const spent = today.reduce((n, r) => n + (r.lamports ?? 0), 0);
  const limit = s.balance === null ? null : Math.round((s.balance + spent) * s.dayShare);
  const wallets = new Set(book.rows.filter((r) => r.state === 'paid').map((r) => r.wallet)).size;
  const open = book.rows.filter((r) => r.state === 'sending' || r.state === 'waiting').length;
  const state =
    s.mode === 'on'
      ? ['on', 'Automatic payouts are on', 'A tag cashed in is paid within a minute or so, straight from the treasury to the wallet the player gave.']
      : s.mode === 'dry'
        ? ['dry', 'Automatic payouts are on trial', 'Each payment is worked out and tried, and not sent.']
        : s.problem
          ? ['bad', 'Automatic payouts are off', `They were asked for and could not start: ${s.problem}.`]
          : ['off', 'Automatic payouts are off', 'Tags are listed here as they are cashed in, and not paid by the machine.'];
  const rows = book.rows
    .map(
      (r) => `<tr class="${r.state}">
        <td>${when(r.at)}</td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.owner)}</td>
        <td class="w">${r.wallet ? `<a href="https://solscan.io/account/${esc(r.wallet)}" target="_blank" rel="noopener"><code>${esc(short(r.wallet))}</code></a>` : '<i>none given</i>'}</td>
        <td>${outcome(r)}</td>
      </tr>`,
    )
    .join('');
  const claims = book.claims
    .map((c) => `<tr><td>${when(c.at)}</td><td><b class="sol">${amount(c.lamports)} SOL</b>${c.done ? '' : ' <i>sent, not seen to arrive yet</i>'}</td><td>${c.from === 'pool' ? 'PumpSwap' : 'bonding curve'}</td><td><a href="${tx(c.signature)}" target="_blank" rel="noopener">${esc(short(c.signature))}</a></td></tr>`)
    .join('');
  const tile = (big: string, label: string, small = '') => `<div class="tile"><b>${big}</b><span>${label}</span>${small ? `<small>${small}</small>` : ''}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ZONA · payouts</title>
<style>
  body { margin: 0; padding: 28px 20px 60px; background: #10130f; color: #e9e4d8; font: 15px/1.45 system-ui, 'Segoe UI', sans-serif; }
  main { max-width: 1080px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: 0.04em; }
  h2 { margin: 34px 0 10px; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: #a9a391; font-weight: 600; }
  p { margin: 0 0 14px; color: #a9a391; max-width: 78ch; }
  a { color: #ffd35a; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .state { margin: 18px 0; padding: 12px 16px; border-left: 3px solid #454b3e; background: #171b15; }
  .state b { display: block; color: #e9e4d8; }
  .state.on { border-color: #8fae6b; }
  .state.dry { border-color: #c9b27c; }
  .state.bad { border-color: #c4523d; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
  .tile { padding: 14px 16px; background: #171b15; border: 1px solid #2a2f26; }
  .tile b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
  .tile span { display: block; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: #a9a391; }
  .tile small { display: block; margin-top: 6px; color: #a9a391; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 9px 10px; text-align: left; border-bottom: 1px solid #2a2f26; vertical-align: middle; }
  th { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #a9a391; font-weight: 600; }
  td.w { white-space: nowrap; }
  code { font: 13px ui-monospace, Consolas, monospace; }
  .sol { color: #8fae6b; font-variant-numeric: tabular-nums; }
  .go { color: #c9b27c; }
  tr.skipped td, tr.off td { color: #8d8877; }
  i { color: #a9a391; }
  td small { margin-left: 6px; font: 11px ui-monospace, Consolas, monospace; color: #8d8877; }
  .wrap { overflow-x: auto; }
  ul { margin: 0; padding-left: 20px; color: #a9a391; max-width: 78ch; }
  li { margin: 4px 0; }
</style>
</head>
<body>
<main>
  <h1>ZONA payouts</h1>
  <p>Take another player's dog tag, stay alive with it for ten minutes, and it is cashed in. This page is the whole account of what is paid for that: nothing is paid that is not listed here, and every payment listed here is a transaction on Solana that anybody can look up.</p>
  <div class="state ${state[0]}"><b>${state[1]}</b>${esc(state[2])}</div>
  <div class="tiles">
    ${tile(s.balance === null ? '?' : amount(s.balance), 'SOL in the treasury', s.treasury ? `<a href="https://solscan.io/account/${esc(s.treasury)}" target="_blank" rel="noopener">${esc(short(s.treasury))}</a>${s.madeTheCoin ? ', the wallet that made the coin' : ''}` : '')}
    ${tile(s.tagPays === null ? '?' : amount(s.tagPays), 'SOL a tag pays now', `${Math.round(s.share * 1000) / 10}% of the treasury, ${amount(s.floor)} at least`)}
    ${tile(String(book.paid), book.paid === 1 ? 'tag paid' : 'tags paid', `${amount(book.paidLamports)} SOL in all${wallets ? ` · ${wallets} ${wallets === 1 ? 'wallet' : 'wallets'}` : ''}${open ? ` · ${open} on the way or waiting` : ''}`)}
    ${tile(amount(book.claimedLamports), 'SOL of creator rewards collected', s.waiting !== null ? `${amount(s.waiting)} waiting to be collected` : esc(s.waitingNote ?? ''))}
    ${tile(`${amount(spent)}${limit === null ? '' : ` / ${amount(limit)}`}`, 'SOL paid today / the most that may be', `days are counted in UTC`)}
  </div>
  ${book.claimNote ? `<div class="state bad"><b>Collecting creator rewards did not work the last time it was tried</b>${esc(book.claimNote)}</div>` : ''}

  <h2>Tags cashed in${book.tags > book.rows.length ? ` (the latest ${book.rows.length} of ${book.tags})` : ''}</h2>
  <div class="wrap">
  <table>
    <thead><tr><th>When</th><th>Player</th><th>Whose tag</th><th>Wallet</th><th>Paid</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5"><i>Nothing yet.</i></td></tr>'}</tbody>
  </table>
  </div>

  <h2>Creator rewards collected into the treasury</h2>
  <div class="wrap">
  <table>
    <thead><tr><th>When</th><th>Collected</th><th>From</th><th>Transaction</th></tr></thead>
    <tbody>${claims || '<tr><td colspan="4"><i>Nothing yet.</i></td></tr>'}</tbody>
  </table>
  </div>

  <h2>The rules the machine pays by</h2>
  <ul>
    <li>A tag pays ${Math.round(s.share * 1000) / 10}% of what the treasury holds at the moment it is paid, and never less than ${amount(s.floor)} SOL. The treasury is filled by the coin's creator rewards on pump.fun, collected automatically.</li>
    <li>No more than ${Math.round(s.dayShare * 100)}% of the treasury leaves it in one day, and one wallet is paid for at most ${s.walletDayTags} tags in one day. A tag over either limit is not lost: it is paid the next day.</li>
    <li>A tag is paid once. If a payment does not arrive it is sent again only when the first can no longer arrive. Each payment carries a note on the chain, "ZONA dog tag" and the reference shown beside it here.</li>
    <li>A tag cashed in with no wallet given is listed and not paid. The wallet is asked for in the game, on the rewards window.</li>
  </ul>
</main>
<script>
  for (const t of document.querySelectorAll('time')) t.title = new Date(t.dateTime).toLocaleString();
</script>
</body>
</html>`;
}

export async function show(request: Request, w: World = live()): Promise<Response> {
  const format = new URL(request.url).searchParams.get('format');
  const s = await snapshot(w);
  if (format === 'status') {
    return Response.json({ on: s.mode === 'on', tagPays: s.tagPays === null ? null : sol(s.tagPays), share: s.share, floor: sol(s.floor), treasury: s.treasury }, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=600' } });
  }
  const book = await withOldEntries(w, await readBook(w.store));
  const cache = { 'cache-control': 'public, s-maxage=20, stale-while-revalidate=120' };
  if (format === 'json') {
    // (a tag's id is what the game server calls this site with: it is not handed out)
    const rows = book.rows.map(({ id: _id, ...r }) => r);
    return Response.json({ status: s, since: book.since, tags: book.tags, paid: book.paid, paidSol: sol(book.paidLamports), claimedSol: sol(book.claimedLamports), rows, claims: book.claims }, { headers: cache });
  }
  return new Response(page(book, s, w.now()), { headers: { 'content-type': 'text/html; charset=utf-8', ...cache } });
}

export const GET = (request: Request) => show(request);
