// Checks of api/_lib/solana.ts against values known from elsewhere. No network, no keys of
// anybody's: `npx tsx test/solana.test.ts`.

import assert from 'node:assert/strict';
import { Keypair, address, b58, unb58, onCurve, programAddress, tokenAccount, message, signed, transfer, memo, computeLimit, verify, SYSTEM_PROGRAM, WRAPPED_SOL } from '../api/_lib/solana';

const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

ok('base58 both ways', () => {
  assert.equal(b58(SYSTEM_PROGRAM), '11111111111111111111111111111111');
  assert.deepEqual(unb58('11111111111111111111111111111111'), new Uint8Array(32));
  for (const a of ['So11111111111111111111111111111111111111112', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P']) assert.equal(b58(address(a)), a);
  assert.throws(() => address('not-an-address'));
  assert.throws(() => address('0OIl' + '1'.repeat(40)));
  // 31 and 33 bytes are not addresses
  assert.throws(() => address(b58(new Uint8Array(31).fill(7))));
  assert.throws(() => address(b58(new Uint8Array(33).fill(7))));
});

ok('a key signs as RFC 8032 says it should', () => {
  // test 1 of the RFC: the secret, the public key it makes, and its signature of nothing
  const seed = hex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
  const pub = hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  const k = new Keypair(b58(Uint8Array.from([...seed, ...pub])));
  assert.deepEqual(k.publicKey, pub);
  assert.equal(Buffer.from(k.sign(new Uint8Array(0))).toString('hex'), 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
  // the same key written the other way, and as the seed alone
  assert.deepEqual(new Keypair(JSON.stringify([...seed, ...pub])).publicKey, pub);
  assert.deepEqual(new Keypair(b58(seed)).publicKey, pub);
  // a key whose halves do not match is refused, and so is rubbish
  assert.throws(() => new Keypair(b58(Uint8Array.from([...seed, ...pub.slice().reverse()]))), /do not belong together/);
  assert.throws(() => new Keypair('hello'), /should be 64|neither/);
  assert.ok(verify(new Uint8Array(0), k.sign(new Uint8Array(0)), pub));
  assert.ok(!verify(Uint8Array.of(1), k.sign(new Uint8Array(0)), pub));
});

ok('addresses made from seeds are the ones on the chain', () => {
  const PUMP = address('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
  const AMM = address('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
  // pump.fun's own accounts, whose addresses its documents give
  assert.equal(b58(programAddress(['global'], PUMP)), '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
  assert.equal(b58(programAddress(['__event_authority'], PUMP)), 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
  assert.equal(b58(programAddress(['global_config'], AMM)), 'ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw');
  assert.ok(onCurve(hex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a')));
  assert.ok(!onCurve(programAddress(['global'], PUMP)));
  assert.equal(tokenAccount(PUMP, WRAPPED_SOL).length, 32);
});

ok('a transfer is laid out the way the chain reads it', () => {
  const seed = hex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
  const k = new Keypair(b58(seed));
  const to = address('So11111111111111111111111111111111111111112');
  const hash = b58(new Uint8Array(32).fill(9));
  const msg = message(k.publicKey, [transfer(k.publicKey, to, 20_000_000n)], hash);
  // one signer, none read-only among signers, one read-only among the rest (the system program)
  assert.deepEqual([...msg.subarray(0, 3)], [1, 0, 1]);
  assert.equal(msg[3], 3);
  assert.deepEqual(msg.subarray(4, 36), k.publicKey);
  assert.deepEqual(msg.subarray(36, 68), to);
  assert.deepEqual(msg.subarray(68, 100), SYSTEM_PROGRAM);
  assert.deepEqual(msg.subarray(100, 132), new Uint8Array(32).fill(9));
  // one instruction: program 2, accounts [0, 1], twelve bytes: transfer (2), then the amount
  assert.deepEqual([...msg.subarray(132)], [1, 2, 2, 0, 1, 12, 2, 0, 0, 0, 0x00, 0x2d, 0x31, 0x01, 0, 0, 0, 0]);
  const tx = signed(k, [transfer(k.publicKey, to, 20_000_000n)], hash);
  assert.equal(tx.wire[0], 1);
  assert.ok(verify(tx.wire.subarray(65), tx.wire.subarray(1, 65), k.publicKey));
  assert.equal(tx.signature, b58(tx.wire.subarray(1, 65)));
  // with a note and a limit: programs that are only called come last, read-only
  const m2 = message(k.publicKey, [computeLimit(30_000), transfer(k.publicKey, to, 1n), memo('ZONA tag abc')], hash);
  assert.deepEqual([...m2.subarray(0, 3)], [1, 0, 3]);
  assert.equal(m2[3], 5);
});

console.log(`${n} checks passed`);
