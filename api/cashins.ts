// The payout list: every dog tag that was held for the full thirty minutes, newest first,
// with the wallet address the player gave. Served at /payouts (see vercel.json).
// Add ?format=json for the raw list.

import { list } from '@vercel/blob';

interface Entry {
  id: string;
  at: string;
  name: string;
  owner: string;
  wallet: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET(request: Request): Promise<Response> {
  const entries: Entry[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'cashins/', limit: 1000, cursor });
    const got = await Promise.all(page.blobs.map((b) => fetch(b.url, { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<Entry>) : null)).catch(() => null)));
    for (const e of got) if (e && typeof e.id === 'string') entries.push(e);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  entries.sort((a, b) => (a.at < b.at ? 1 : -1));

  if (new URL(request.url).searchParams.get('format') === 'json') return Response.json(entries, { headers: { 'cache-control': 'no-store' } });

  const rows = entries
    .map(
      (e) => `<tr data-id="${esc(e.id)}">
        <td><input type="checkbox" aria-label="paid"></td>
        <td><time datetime="${esc(e.at)}">${esc(e.at.replace('T', ' ').slice(0, 16))} UTC</time></td>
        <td>${esc(e.name)}</td>
        <td>${esc(e.owner)}</td>
        <td class="w">${e.wallet ? `<code>${esc(e.wallet)}</code><button type="button">copy</button>` : '<i>no wallet given</i>'}</td>
      </tr>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ZONA · cashed-in dog tags</title>
<style>
  body { margin: 0; padding: 28px 20px 60px; background: #10130f; color: #e9e4d8; font: 15px/1.45 system-ui, 'Segoe UI', sans-serif; }
  main { max-width: 1040px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: 0.04em; }
  p { margin: 0 0 18px; color: #a9a391; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 9px 10px; text-align: left; border-bottom: 1px solid #2a2f26; vertical-align: middle; }
  th { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #a9a391; font-weight: 600; }
  td.w { white-space: nowrap; }
  code { font: 13px ui-monospace, Consolas, monospace; color: #ffd35a; user-select: all; }
  button { margin-left: 10px; padding: 2px 9px; font: inherit; font-size: 12px; color: #e9e4d8; background: #2a2f26; border: 1px solid #454b3e; border-radius: 4px; cursor: pointer; }
  tr.paid td { opacity: 0.42; }
  i { color: #a9a391; }
  .wrap { overflow-x: auto; }
</style>
</head>
<body>
<main>
  <h1>Cashed-in dog tags</h1>
  <p>${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, newest first. Each is a tag taken from another player and held for thirty minutes. The tick boxes are your own notes: they are remembered in this browser only.</p>
  <div class="wrap">
  <table>
    <thead><tr><th>Paid</th><th>When</th><th>Player</th><th>Whose tag</th><th>Wallet</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5"><i>Nothing yet.</i></td></tr>'}</tbody>
  </table>
  </div>
</main>
<script>
  const KEY = 'zona.paid';
  let paid = {};
  try { paid = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  for (const tr of document.querySelectorAll('tr[data-id]')) {
    const box = tr.querySelector('input');
    box.checked = !!paid[tr.dataset.id];
    tr.classList.toggle('paid', box.checked);
    box.addEventListener('change', () => {
      paid[tr.dataset.id] = box.checked;
      tr.classList.toggle('paid', box.checked);
      try { localStorage.setItem(KEY, JSON.stringify(paid)); } catch {}
    });
    const copy = tr.querySelector('button');
    if (copy) copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(tr.querySelector('code').textContent);
      copy.textContent = 'copied';
      setTimeout(() => (copy.textContent = 'copy'), 1200);
    });
    const t = tr.querySelector('time');
    t.title = new Date(t.dateTime).toLocaleString();
  }
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
