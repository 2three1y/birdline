// Birdline: talking to Nostr relays (publish, fetch, live updates).
import { SimplePool, finalizeEvent, verifyEvent, hexToBytes, nip19 } from '../vendor/nostr-tools-2.25.4.bundle.js';
import { DEFAULT_RELAYS, APP_TAG, LABEL_NS, newestEvent, parseProfile } from './util.js';
import { cacheGet, cachePut } from './store.js';

export const pool = new SimplePool({ enablePing: true, enableReconnect: true });
export let relays = [...DEFAULT_RELAYS];

// ---- the signer: a local key in memory, or a NIP-07 browser extension ----
let signer = null;
export function setLocalSigner(skHex) { const sk = hexToBytes(skHex); signer = { kind: 'local', sign: async (t) => finalizeEvent(t, sk) }; }
export function setExtensionSigner() { signer = { kind: 'nip07', sign: async (t) => { const e = await window.nostr.signEvent(t); if (!verifyEvent(e)) throw new Error('The extension returned a bad signature.'); return e; } }; }
export function clearSigner() { signer = null; }
export function hasSigner() { return !!signer; }

/** Sign and send; resolves to { event, ok, total, errors }. */
export async function publish(template, targetRelays = relays) {
  if (!signer) throw new Error('Not signed in.');
  const t = { created_at: Math.floor(Date.now() / 1000), content: '', tags: [], ...template };
  if (!t.tags.some(x => x[0] === 'client')) t.tags = [...t.tags, ['client', APP_TAG]];
  const event = await signer.sign(t);
  const results = await Promise.allSettled(pool.publish(targetRelays, event, { maxWait: 8000 }));
  const errors = results.map((r, i) => r.status === 'rejected' ? `${targetRelays[i]}: ${String(r.reason && r.reason.message || r.reason)}` : null).filter(Boolean);
  const ok = results.filter(r => r.status === 'fulfilled').length;
  return { event, ok, total: targetRelays.length, errors };
}

export function query(filter, maxWait = 4000) { return pool.querySync(relays, filter, { maxWait }); }

// ---- profiles ----
const profileCache = new Map();
export function cachedProfile(pk) { if (profileCache.has(pk)) return profileCache.get(pk); const c = cacheGet('p:' + pk); if (c) { profileCache.set(pk, c); return c; } return null; }
export function rememberProfileEvent(ev) {
  const cur = cachedProfile(ev.pubkey);
  if (cur && cur.created_at >= ev.created_at) return cur;
  const rec = { created_at: ev.created_at, ...parseProfile(ev) };
  profileCache.set(ev.pubkey, rec); cachePut('p:' + ev.pubkey, rec);
  return rec;
}
let pendingProfiles = new Set(); let profileTimer = null; const profileListeners = new Set();
export function onProfiles(fn) { profileListeners.add(fn); return () => profileListeners.delete(fn); }
/** Ask for profiles in small batches; listeners hear when new ones arrive. */
export function wantProfiles(pubkeys) {
  for (const pk of pubkeys) if (!profileCache.has(pk) || !profileCache.get(pk).fetched) pendingProfiles.add(pk);
  if (profileTimer || !pendingProfiles.size) return;
  profileTimer = setTimeout(async () => {
    const batch = [...pendingProfiles].slice(0, 100); batch.forEach(p => pendingProfiles.delete(p)); profileTimer = null;
    const evs = await query({ kinds: [0], authors: batch }, 3500).catch(() => []);
    const got = new Set();
    for (const ev of evs) { rememberProfileEvent(ev); got.add(ev.pubkey); }
    for (const pk of batch) { const c = profileCache.get(pk) || {}; c.fetched = true; profileCache.set(pk, c); }
    profileListeners.forEach(fn => fn(got));
    if (pendingProfiles.size) wantProfiles([]);
  }, 150);
}
export async function fetchProfile(pk) {
  const evs = await query({ kinds: [0], authors: [pk] }, 4000).catch(() => []);
  const n = newestEvent(evs); if (n) rememberProfileEvent(n);
  const c = profileCache.get(pk) || {}; c.fetched = true; profileCache.set(pk, c);
  return n ? cachedProfile(pk) : null;
}

// ---- follow lists (kind 3) ----
export async function fetchNewestFollowList(pk) {
  const evs = await query({ kinds: [3], authors: [pk] }, 4500).catch(() => []);
  const n = newestEvent(evs);
  const cached = cacheGet('f:' + pk);
  if (n && (!cached || n.created_at >= cached.created_at)) { cachePut('f:' + pk, n); return n; }
  return cached || n || null;
}
export function cachedFollowList(pk) { return cacheGet('f:' + pk) || null; }
export function rememberFollowList(ev) { cachePut('f:' + ev.pubkey, ev); }

// ---- usernames: claims and synced logins are kind 30078 events labeled with the username (NIP-32 "l" tag) ----
export async function findUsername(username) {
  const evs = await query({ kinds: [30078], '#l': [username], '#d': ['birdline/handle', 'birdline/login'] }, 4500).catch(() => []);
  return evs.filter(e => e.tags.some(t => t[0] === 'l' && t[1] === username && t[2] === LABEL_NS));
}
/** Who claimed the name first (earliest claim per pubkey wins), or null. */
export async function usernameOwner(username) {
  const evs = await findUsername(username);
  if (!evs.length) return null;
  const first = new Map();
  for (const e of evs) { const f = first.get(e.pubkey); const at = Number((e.tags.find(t => t[0] === 'claimed_at') || [])[1]) || e.created_at; if (!f || at < f) first.set(e.pubkey, at); }
  return [...first.entries()].sort((a, b) => a[1] - b[1])[0][0];
}
export async function syncedLogins(username) {
  const evs = await findUsername(username);
  return evs.filter(e => e.tags.some(t => t[0] === 'd' && t[1] === 'birdline/login') && /^ncryptsec1/.test(e.content));
}

export function npubOf(pk) { return nip19.npubEncode(pk); }
export function pubkeyFromAny(s) {
  s = String(s || '').trim().replace(/^nostr:/, '');
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  try { const d = nip19.decode(s); if (d.type === 'npub') return d.data; if (d.type === 'nprofile') return d.data.pubkey; } catch {}
  return null;
}
