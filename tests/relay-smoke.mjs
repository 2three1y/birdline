// Relay smoke test (not part of `npm test`, it talks to real relays): node tests/relay-smoke.mjs
import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from '../vendor/nostr-tools-2.25.4.bundle.js';
import { DEFAULT_RELAYS } from '../js/util.js';
const pool = new SimplePool();
const sk = generateSecretKey(); const pk = getPublicKey(sk);
const u = 'bltest' + Math.floor(Math.random() * 1e6);
const now = Math.floor(Date.now() / 1000);
const claim = finalizeEvent({ kind: 30078, created_at: now, content: '', tags: [['d', 'birdline/handle'], ['L', 'birdline.username'], ['l', u, 'birdline.username'], ['client', 'birdline']] }, sk);
const res = await Promise.allSettled(pool.publish(DEFAULT_RELAYS, claim, { maxWait: 8000 }));
res.forEach((r, i) => console.log(DEFAULT_RELAYS[i], r.status, r.status === 'rejected' ? String(r.reason) : r.value));
await new Promise(r => setTimeout(r, 1500));
for (const relay of DEFAULT_RELAYS) {
  const evs = await pool.querySync([relay], { kinds: [30078], '#l': [u], '#d': ['birdline/handle'] }, { maxWait: 5000 });
  console.log('query', relay, evs.length, evs[0] && evs[0].pubkey === pk);
}
pool.destroy(); process.exit(0);
