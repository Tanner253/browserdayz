// The payouts page as it would be shown, from the fake world of the tests: a wallet paid at the Elite rate, one lower,
// written to marketing/_payouts-preview.html for a look (node scripts/card.mjs _payouts-preview 1400 2600). Not a test.
import fs from 'node:fs';
import { TOKEN_2022_PROGRAM, address, b58, tokenAccount } from '../api/_lib/solana';
import { handle, type Entry } from '../api/_lib/payouts';
import { show } from '../api/cashins';
import { wallet, world } from './fake';

const env = { PAYOUT_RULES_FROM: '2026-10-01T00:00:00Z', PAYOUT_RULES2_FROM: '2026-10-02T00:00:00Z', PAYOUT_RULES3_FROM: '2026-10-08T00:00:00Z', PAYOUT_RULES5_FROM: '2026-10-08T00:00:00Z' };
const w = world(1, env);
const coin = (to: number, millions: number) => w.chain.tokens.set(b58(tokenAccount(address(wallet(to)), w.cfg.mint, TOKEN_2022_PROGRAM)), BigInt(millions) * 10n ** 12n);
let id = 0;
const cash = async (to: number, name: string, n: number) => {
  for (let i = 0; i < n; i++) {
    w.skip(1000);
    const e: Entry = { id: `pv${String(id++).padStart(6, '0')}`, at: new Date(w.now()).toISOString(), name, owner: `Victim${id}`, wallet: wallet(to) };
    await handle(w, e);
  }
};
coin(501, 20);
await cash(501, 'Kovalenko', 5);
coin(502, 6);
await cash(502, 'Marta', 5);
w.skip(13 * 3600 * 1000);
await cash(501, 'Kovalenko', 5);
const r = await show(new Request('http://localhost/payouts'), w);
fs.writeFileSync('marketing/_payouts-preview.html', await r.text());
console.log('written');
