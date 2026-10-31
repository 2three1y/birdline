// Birdline: runs the slow password work (NIP-49 scrypt) off the main thread so VoiceOver stays responsive.
import { nip49, generateSecretKey, getPublicKey, bytesToHex, hexToBytes } from '../vendor/nostr-tools-2.25.4.bundle.js';

self.onmessage = (e) => {
  const { id, op, password, logN, ncryptsec, skHex } = e.data || {};
  const t0 = performance.now();
  try {
    if (op === 'create') {
      const sk = generateSecretKey();
      const enc = nip49.encrypt(sk, password, logN, 0x02);
      self.postMessage({ id, ok: true, skHex: bytesToHex(sk), pubkey: getPublicKey(sk), ncryptsec: enc, ms: Math.round(performance.now() - t0) });
    } else if (op === 'encrypt') {
      const enc = nip49.encrypt(hexToBytes(skHex), password, logN, 0x02);
      self.postMessage({ id, ok: true, ncryptsec: enc, ms: Math.round(performance.now() - t0) });
    } else if (op === 'decrypt') {
      const sk = nip49.decrypt(ncryptsec, password);
      self.postMessage({ id, ok: true, skHex: bytesToHex(sk), pubkey: getPublicKey(sk), ms: Math.round(performance.now() - t0) });
    } else {
      self.postMessage({ id, ok: false, error: 'unknown op' });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err), ms: Math.round(performance.now() - t0) });
  }
};
