// Birdline: what stays on this device (accounts, settings, the "keep me signed in" wrap).
const K = { accounts: 'birdline.accounts', settings: 'birdline.settings', session: 'birdline.session', cache: 'birdline.cache' };

function read(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

// ---- accounts saved on this device: username -> { pubkey, ncryptsec, name, synced } ----
export function accounts() { return read(K.accounts, {}); }
export function saveAccount(username, rec) { const a = accounts(); a[username] = { ...(a[username] || {}), ...rec }; write(K.accounts, a); }
export function accountByPubkey(pk) { const a = accounts(); for (const [u, r] of Object.entries(a)) if (r.pubkey === pk) return { username: u, ...r }; return null; }

// ---- settings ----
export const DEFAULT_SETTINGS = {
  readHashAsHashtag: true,   // say "hashtag" for # (screen readers)
  reduceMotion: 'system',    // 'system' | 'on' | 'off'
  readerLinks: false,        // TODO: open links in a reader-friendly view
  replyFilter: false,        // hide replies from accounts nobody you follow follows (off = everything, in order)
};
export function settings() { return { ...DEFAULT_SETTINGS, ...read(K.settings, {}) }; }
export function setSetting(k, v) { const s = settings(); s[k] = v; write(K.settings, s); return s; }

// ---- small cache of profiles and follow lists so reloads are fast ----
export function cacheGet(k) { const c = read(K.cache, {}); return c[k]; }
export function cachePut(k, v) { const c = read(K.cache, {}); c[k] = v; const keys = Object.keys(c); if (keys.length > 400) delete c[keys[0]]; write(K.cache, c); }

// ---- keep me signed in: the raw key is wrapped by a non-extractable AES key that never leaves this browser ----
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('birdline', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbPut(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('keys', 'readwrite'); t.objectStore('keys').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('keys').objectStore('keys').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
async function idbDel(k) { const db = await idb(); return new Promise((res) => { const t = db.transaction('keys', 'readwrite'); t.objectStore('keys').delete(k); t.oncomplete = res; t.onerror = res; }); }

const hex2 = (h) => Uint8Array.from(h.match(/../g).map(b => parseInt(b, 16)));
const b2hex = (b) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

export async function rememberSession(pubkey, skHex, username) {
  if (!skHex) { write(K.session, { pubkey, method: 'nip07', username }); return; }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, hex2(skHex));
  await idbPut('session', key);
  write(K.session, { pubkey, method: 'local', username, iv: b2hex(iv), ct: b2hex(ct) });
}

export async function restoreSession() {
  const s = read(K.session, null);
  if (!s || !s.pubkey) return null;
  if (s.method === 'nip07') return { pubkey: s.pubkey, method: 'nip07', username: s.username };
  try {
    const key = await idbGet('session');
    if (!key) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hex2(s.iv) }, key, hex2(s.ct));
    return { pubkey: s.pubkey, method: 'local', username: s.username, skHex: b2hex(pt) };
  } catch { return null; }
}

export async function forgetSession() { localStorage.removeItem(K.session); try { await idbDel('session'); } catch {} }
