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
import { cached, editBook, freshBook, glanceBook, refOf, snapshot, sol, type Book, type Entry, type Row, type Snapshot, type World } from './_lib/payouts.js';

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
  if (r.state === 'skipped') return `<i>not paid: ${esc(r.why ?? '')}</i>`;
  return '<i>listed (payouts were not on)</i>';
}

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
  const open = book.rows.filter((r) => r.state === 'sending' || r.state === 'waiting').length;
  const pct = Math.round(s.share * 1000) / 10;
  const state =
    s.mode === 'on' && s.problem
      ? ['bad', 'Automatic payouts are held', `Nothing is paid as things stand: ${s.problem}.`]
      : s.mode === 'on'
      ? ['on', 'Automatic payouts are on', 'A tag cashed in is paid within a minute or so, straight from the treasury to the wallet the player gave.']
      : s.mode === 'dry'
        ? ['dry', 'Automatic payouts are on trial', 'Each payment is worked out and tried, and not sent.']
        : s.problem
          ? ['bad', 'Automatic payouts are off', `They were asked for and could not start: ${s.problem}.`]
          : ['off', 'Automatic payouts are off', 'Tags are listed here as they are cashed in, and not paid by the machine.'];
  const chip = (r: Row) => (r.state === 'paid' ? '<em class="c paid">Paid</em>' : r.state === 'sending' ? '<em class="c go">Sending</em>' : r.state === 'waiting' ? '<em class="c go">Waiting</em>' : r.state === 'skipped' ? '<em class="c no">Not paid</em>' : '<em class="c no">Listed</em>');
  const rows = book.rows
    .map(
      (r) => `<tr class="${r.state}" data-s="${r.state === 'paid' ? 'paid' : r.state === 'sending' || r.state === 'waiting' ? 'open' : 'none'}">
        <td>${when(r.at)}</td>
        <td><b>${esc(r.name)}</b></td>
        <td>${esc(r.owner)}</td>
        <td class="w">${r.wallet ? `<a href="https://solscan.io/account/${esc(r.wallet)}" target="_blank" rel="noopener"><code>${esc(short(r.wallet))}</code></a>` : '<i>none given</i>'}</td>
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
      <p class="lead">Take another player's dog tag, stay alive with it for fifteen minutes, and it is cashed in. This page is the whole account of what is paid for that: nothing is paid that is not listed here, and every payment listed here is a transaction on Solana that anybody can look up. ${esc(state[2])}</p>
      ${book.claimNote ? `<div class="note"><b>Collecting creator rewards did not work the last time it was tried</b>${esc(book.claimNote)}</div>` : ''}
    </div>
    <div class="tiles">
      ${tile(s.tagPays === null ? '?' : `${amount(s.tagPays)} SOL`, 'a tag pays right now', `${pct}% of the treasury, ${amount(s.floor)} at least`)}
      ${tile(s.balance === null ? '?' : `${amount(s.balance)} SOL`, 'in the treasury', s.treasury ? `<a href="https://solscan.io/account/${esc(s.treasury)}" target="_blank" rel="noopener">${esc(short(s.treasury))}</a>${s.madeTheCoin ? ', the wallet that made the coin' : ''}` : '')}
      ${tile(`${amount(book.claimedLamports)} SOL`, 'creator rewards collected', (s.waiting !== null ? `${amount(s.waiting)} waiting to be collected` : '') + (s.waitingNote ? `${s.waiting !== null ? '. ' : ''}${esc(s.waitingNote)}` : ''))}
      ${tile(String(open), open === 1 ? 'tag on its way or waiting' : 'tags on their way or waiting', open ? 'Each is paid as soon as it can be' : 'Everything owed has been paid')}
    </div>
  </div>

  <section>
    <h2>How the money moves</h2>
    <div class="flow">
      ${step('1', 'The coin is traded', 'Creator rewards', 'Every trade of the ZONA coin on pump.fun leaves a little for the wallet that made it.')}
      ${step('2', 'Collected by the machine', `${amount(book.claimedLamports)} SOL so far`, `Into one treasury wallet, automatically${s.balance === null ? '' : `. It holds ${amount(s.balance)} SOL now`}.`)}
      ${step('3', 'You cash a tag in', `${s.tagPays === null ? `${pct}%` : `${amount(s.tagPays)} SOL`} a tag`, `Kill a player, take their tag, hold it fifteen minutes. A tag pays ${pct}% of the treasury, never less than ${amount(s.floor)} SOL.`)}
      ${step('4', 'Straight to your wallet', `${amount(book.paidLamports)} SOL paid`, 'Within a minute or so, with a receipt left on the chain: no tag is ever paid twice.')}
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
      <div class="rule"><h3>What a tag pays</h3><p>${pct}% of what the treasury holds at the moment it is paid, and never less than ${amount(s.floor)} SOL. The treasury is filled by the coin's creator rewards on pump.fun, collected automatically.</p></div>
      <div class="rule"><h3>${s.walletDayTags} tags a wallet, a day</h3><p>One wallet is paid for the first ${s.walletDayTags} tags it cashes in on a day (days are counted in UTC). One cashed in after those, that day, is listed and not paid: it does not wait for tomorrow. And no more than ${Math.round(s.dayShare * 100)}% of the treasury leaves it in one day: a tag over that waits, and is paid when there is room.</p></div>
      <div class="rule"><h3>Trading tags is not paid</h3><p>When two players cash each other's tags inside a day, the first of the two is paid and the second is not. Killing a friend and being killed back earns one tag between you, not two.</p></div>
      <div class="rule"><h3>Paid once, and the chain sees to it</h3><p>Each payment leaves a receipt, an account of its own, and a second payment for the same tag cannot be made while that receipt stands. Each payment also carries a note, "ZONA dog tag" and the reference shown beside it here.</p></div>
      <div class="rule"><h3>No wallet, no payment</h3><p>A tag cashed in with no wallet given is listed and not paid. The wallet is asked for in the game, on the rewards window: add it before you cash a tag in.</p></div>
      <div class="rule"><h3>What changed on 13 October 2026</h3><p>The treasury was paying out half as much again as came in. From 04:30 UTC a tag pays ${amount(s.floor)} SOL at least (it was 0.02), the limit of ${s.walletDayTags} a day is a limit and not a queue, and traded tags are not paid. Everything cashed in before then is paid as it was promised.</p></div>
    </div>
  </section>
</main>
<footer><span>ZONA · PvP survival shooter · play to earn</span><span>As it stood at ${when(new Date(now).toISOString())}</span><span><a href="/">Back to the game</a></span></footer>
<script>
  for (const t of document.querySelectorAll('time')) t.title = new Date(t.dateTime).toLocaleString();
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
  ${s.due || open ? "fetch('/api/tick').catch(() => {});" : ''}
</script>
</body>
</html>`;
}

export async function show(request: Request, w: World = live()): Promise<Response> {
  const format = new URL(request.url).searchParams.get('format');
  const s = await cached(w, 'snapshot', 20_000, () => snapshot(w));
  if (format === 'status') {
    // (due: enough rewards are waiting to be collected; whoever is told so calls api/tick, which collects them)
    return Response.json({ on: s.mode === 'on' && !s.problem, tagPays: s.tagPays === null ? null : sol(s.tagPays), share: s.share, floor: sol(s.floor), treasury: s.treasury, due: s.due }, { headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=120' } });
  }
  const book = await cached(w, 'book', 20_000, async () => withOldEntries(w, await glanceBook(w.store)));
  const cache = { 'cache-control': 'public, s-maxage=20, stale-while-revalidate=60' };
  if (format === 'json') {
    // (a tag not paid yet goes by no name here: its reference is where the receipt of its payment will be)
    const rows = book.rows.map(({ tries: _tries, ...r }) => (r.state === 'paid' ? r : { ...r, ref: undefined }));
    return Response.json({ status: s, since: book.since, tags: book.tags, paid: book.paid, paidSol: sol(book.paidLamports), claimedSol: sol(book.claimedLamports), rows, claims: book.claims }, { headers: cache });
  }
  return new Response(page(book, s, w.now()), { headers: { 'content-type': 'text/html; charset=utf-8', ...cache } });
}

export const GET = (request: Request) => show(request);
