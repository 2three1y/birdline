import test from 'node:test';
import assert from 'node:assert/strict';
import { nip49, generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, bytesToHex, VERSION } from '../vendor/nostr-tools-2.25.4.bundle.js';
import { ncryptsecLogN, LOG_N } from '../js/util.js';

test('vendored nostr-tools is 2.25.x', () => { assert.match(VERSION, /^2\.25\./); });

test('NIP-49 lock and unlock round trip, wrong password fails', () => {
  const sk = generateSecretKey();
  const t0 = Date.now();
  const enc = nip49.encrypt(sk, 'purple otters dance', 16, 0x02);
  assert.match(enc, /^ncryptsec1/);
  assert.equal(ncryptsecLogN(enc), 16);
  assert.equal(bytesToHex(nip49.decrypt(enc, 'purple otters dance')), bytesToHex(sk));
  assert.throws(() => nip49.decrypt(enc, 'purple otters dancE'));
  console.log(`  log_n 16 lock+unlock+fail took ${Date.now() - t0} ms in Node`);
});

test('the app default cost is 2^18', () => { assert.equal(LOG_N, 18); });

test('signed kind 0 verifies', () => {
  const sk = generateSecretKey();
  const ev = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ name: 'river' }) }, sk);
  assert.ok(verifyEvent(ev));
  assert.equal(ev.pubkey, getPublicKey(sk));
});
