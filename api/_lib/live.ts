// The payout system as it runs for real: the settings from the environment, the real chain,
// the real file store, the real clock.

import { Rpc } from './solana.js';
import { blobStore } from './store.js';
import { config, type World } from './payouts.js';

export function live(): World {
  const cfg = config();
  return {
    cfg,
    rpc: new Rpc(cfg.rpc),
    store: blobStore,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
  };
}
