// Birdline: key creation and password locking (NIP-49), with timing logged so the cost can be tuned per device.
import { nip49, generateSecretKey, getPublicKey, bytesToHex, hexToBytes } from '../vendor/nostr-tools-2.25.4.bundle.js?v=0.1.2';
import { LOG_N, LOG_N_FALLBACK, ncryptsecLogN } from './util.js?v=0.1.2';

let worker = null; let seq = 0; const waiting = new Map();
function getWorker() {
  if (worker === false) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./crypto-worker.js?v=0.1.2', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); w(e.data); } };
    worker.onerror = () => { worker = false; for (const [k, w] of waiting) { waiting.delete(k); w({ ok: false, error: 'worker failed', retryInline: true }); } };
  } catch { worker = false; }
  return worker || null;
}

function inline(msg) {
  const t0 = performance.now();
  try {
    if (msg.op === 'create') { const sk = generateSecretKey(); const enc = nip49.encrypt(sk, msg.password, msg.logN, 0x02); return { ok: true, skHex: bytesToHex(sk), pubkey: getPublicKey(sk), ncryptsec: enc, ms: Math.round(performance.now() - t0) }; }
    if (msg.op === 'encrypt') { return { ok: true, ncryptsec: nip49.encrypt(hexToBytes(msg.skHex), msg.password, msg.logN, 0x02), ms: Math.round(performance.now() - t0) }; }
    if (msg.op === 'decrypt') { const sk = nip49.decrypt(msg.ncryptsec, msg.password); return { ok: true, skHex: bytesToHex(sk), pubkey: getPublicKey(sk), ms: Math.round(performance.now() - t0) }; }
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  return { ok: false, error: 'unknown op' };
}

function run(msg) {
  const w = getWorker();
  if (!w) return Promise.resolve(inline(msg));
  return new Promise((resolve) => {
    const id = ++seq; waiting.set(id, (r) => resolve(r.retryInline ? inline(msg) : r));
    w.postMessage({ ...msg, id });
  });
}

function record(kind, logN, ms) {
  const line = { kind, logN, ms, at: new Date().toISOString(), ua: navigator.userAgent.slice(0, 120) };
  console.info(`[birdline] ${kind} with scrypt log_n=${logN} took ${ms} ms`);
  try {
    const all = JSON.parse(localStorage.getItem('birdline.timings') || '[]');
    all.unshift(line); localStorage.setItem('birdline.timings', JSON.stringify(all.slice(0, 10)));
  } catch {}
}

export function lastTimings() { try { return JSON.parse(localStorage.getItem('birdline.timings') || '[]'); } catch { return []; } }

/** Make a new key and lock it with the password. Falls back to a lighter cost if the device runs out of memory. */
export async function createLockedKey(password) {
  let r = await run({ op: 'create', password, logN: LOG_N });
  let logN = LOG_N;
  if (!r.ok) { logN = LOG_N_FALLBACK; r = await run({ op: 'create', password, logN }); }
  if (!r.ok) throw new Error(r.error || 'could not make a key');
  record('lock', logN, r.ms);
  return { skHex: r.skHex, pubkey: r.pubkey, ncryptsec: r.ncryptsec, ms: r.ms, logN };
}

export async function lockKey(skHex, password) {
  let r = await run({ op: 'encrypt', skHex, password, logN: LOG_N });
  let logN = LOG_N;
  if (!r.ok) { logN = LOG_N_FALLBACK; r = await run({ op: 'encrypt', skHex, password, logN }); }
  if (!r.ok) throw new Error(r.error || 'could not lock the key');
  record('lock', logN, r.ms);
  return { ncryptsec: r.ncryptsec, ms: r.ms, logN };
}

/** Unlock: returns {skHex, pubkey, ms} or null when the password does not fit. */
export async function unlockKey(ncryptsec, password) {
  const r = await run({ op: 'decrypt', ncryptsec, password });
  if (!r.ok) return null;
  let logN = null; try { logN = ncryptLogN(ncryptsec); } catch {}
  record('unlock', logN, r.ms);
  return { skHex: r.skHex, pubkey: r.pubkey, ms: r.ms };
}

export function ncryptLogN(ncryptsec) { return ncryptsecLogN(ncryptsec); }
