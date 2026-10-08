// The payout system as it runs for real: the settings from the environment, the real chain,
// the real file store, the real clock. One of it for as long as this process lives, so that
// what it has just asked the chain it need not ask again for every caller.

import { Rpc } from './solana.js';
import { blobStore } from './store.js';
import { config, type World } from './payouts.js';

let world: World | undefined;

export function live(): World {
  if (world) return world;
  const cfg = config();
  return (world = {
    cfg,
    rpc: new Rpc(cfg.rpc),
    store: blobStore,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    memo: new Map(),
  });
}
