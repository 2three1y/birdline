// Birdline: small pure helpers (no DOM, no network) so they can be tested in Node.
export const POST_LIMIT = 140;
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
export const LOG_N = 18; // NIP-49 scrypt cost: 2^18 (256 MiB). See README "Password cost".
export const LOG_N_FALLBACK = 17;
export const APP_TAG = 'birdline';
export const LABEL_NS = 'birdline.username';

const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en-US', { granularity: 'grapheme' }) : null;

/** Count user-perceived characters (one emoji = 1). */
export function countChars(text) {
  if (!text) return 0;
  if (seg) { let n = 0; for (const _ of seg.segment(text)) n++; return n; }
  return Array.from(text).length;
}

/** What the counter should announce after the length changed from prevLeft to left (or null). */
export function counterAnnouncement(prevLeft, left) {
  if (prevLeft === left) return null;
  if (left < 0 && prevLeft >= 0) return `Over the limit by ${-left}. Posts can be ${POST_LIMIT} characters.`;
  if (left === 0 && prevLeft !== 0) return 'No characters left.';
  for (const mark of [10, 20]) {
    if (left <= mark && prevLeft > mark && left > 0) return `${left} characters left.`;
  }
  return null;
}

export function charsLeftLabel(left) {
  if (left >= 0) return `${left} character${left === 1 ? '' : 's'} left`;
  return `${-left} character${left === -1 ? '' : 's'} over the limit`;
}

// ---- usernames ----
export const RESERVED = new Set(['admin', 'administrator', 'support', 'help', 'birdline', 'tab', 'root', 'settings', 'home', 'connect', 'discover', 'me', 'join', 'signin', 'signout', 'login', 'logout', 'about', 'api', 'null', 'undefined', 'system', 'official', 'mod', 'moderator', 'staff', 'security', 'u', 'key', 'search', 'privacy', 'terms']);

export function normalizeUsername(u) { return String(u || '').trim().replace(/^@/, '').toLowerCase(); }

/** Returns null when fine, or a sentence saying what to change. */
export function usernameProblem(raw) {
  const u = normalizeUsername(raw);
  if (!u) return 'Pick a username.';
  if (u.length > 15) return 'Usernames can be up to 15 characters.';
  if (!/^[a-z0-9_]+$/.test(u)) return 'Use only letters, numbers and underscores.';
  if (RESERVED.has(u)) return 'That word is kept for the app. Try another.';
  return null;
}

export function usernameSuggestions(raw, name) {
  const u = normalizeUsername(raw).replace(/[^a-z0-9_]/g, '').slice(0, 11) || 'bird';
  const first = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 11);
  const out = new Set();
  const n = () => Math.floor(10 + Math.random() * 989);
  out.add(`${u}${n()}`);
  out.add(`${u}_${n()}`);
  if (first && first !== u) out.add(`${first}_${u}`.slice(0, 15)); else out.add(`the_${u}`.slice(0, 15));
  return [...out].filter(s => !usernameProblem(s)).slice(0, 3);
}

// ---- passwords (this password locks the key, so the bar is higher than 2012's) ----
export const COMMON_PASSWORDS = new Set(('123456 password 12345678 qwerty 123456789 12345 1234 111111 1234567 dragon 123123 baseball abc123 football monkey letmein 696969 shadow master 666666 qwertyuiop 123321 mustang 1234567890 michael 654321 superman 1qaz2wsx 7777777 121212 000000 qazwsx 123qwe killer trustno1 jordan jennifer zxcvbnm asdfgh hunter buster soccer harley batman andrew tigger sunshine iloveyou 2000 charlie robert thomas hockey ranger daniel starwars klaster 112233 george computer michelle jessica pepper 1111 zxcvbn 555555 11111111 131313 freedom 777777 pass maggie 159753 aaaaaa ginger princess joshua cheese amanda summer love ashley nicole chelsea biteme matthew access yankees 987654321 dallas austin thunder taylor matrix minecraft welcome welcome1 password1 password123 passw0rd p@ssw0rd p@ssword admin admin123 administrator letmein123 qwerty123 qwerty1 iloveyou1 sunshine1 princess1 football1 baseball1 monkey123 dragon123 abc12345 abcd1234 a1b2c3d4 1q2w3e4r 1q2w3e4r5t q1w2e3r4t5 zaq12wsx asdfghjkl asdf1234 123abc 0987654321 1234qwer qwer1234 changeme secret secret123 default guest test test123 testing nothing whatever trustno1 hello123 hellohello loveyou lovely iloveu fuckyou fuckyou1 123456a a123456 1234567a 11223344 12341234 1122334455 1234554321 0123456789 9876543210 qwertyuiop123 starwars1 pokemon pokemon123 cookie chocolate butterfly purple orange banana flower jesus jesus1 blessed samsung apple iphone google facebook instagram tiktok nostr bitcoin satoshi birdline birdline123 superman1 batman123 spiderman naruto').split(' '));

/** Returns null when the password is strong enough, else a sentence. */
export function passwordProblem(pw, username = '', name = '') {
  const p = String(pw || '');
  if (countChars(p) < 10) return 'Use at least 10 characters. A short sentence works well.';
  const low = p.toLowerCase();
  if (COMMON_PASSWORDS.has(low) || COMMON_PASSWORDS.has(low.replace(/[0-9!@#$%^&*.]+$/, ''))) return 'That password is on lists people use to guess. Pick something less common.';
  if (/^(.)\1+$/.test(p)) return 'Use more than one repeated character.';
  const seqs = ['0123456789', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  if (seqs.some(s => s.includes(low) || low.includes(s.slice(0, 8)))) return 'Avoid keyboard runs and number runs.';
  const u = normalizeUsername(username);
  if (u.length >= 3 && low.includes(u)) return 'Leave your username out of your password.';
  const n = String(name || '').toLowerCase().replace(/\s+/g, '');
  if (n.length >= 3 && low.replace(/\s+/g, '').includes(n)) return 'Leave your name out of your password.';
  if (low.includes('password') || low.includes('birdline')) return 'Pick something people would not guess.';
  if (new Set(p).size < 5) return 'Use a few more different characters.';
  return null;
}

/** 0..4 rough strength for the meter (feedback only; passwordProblem is the rule). */
export function passwordStrength(pw) {
  const p = String(pw || '');
  if (!p) return 0;
  let s = 0;
  if (countChars(p) >= 10) s++;
  if (countChars(p) >= 14) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/[0-9]/.test(p) || /[^A-Za-z0-9]/.test(p) || /\s/.test(p)) s++;
  return Math.min(4, s);
}

// ---- text: split a post into plain text, links, hashtags and mentions ----
const TOKEN = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])|(#[\p{L}\p{N}_]{1,64})|(nostr:(?:npub|nprofile|note|nevent|naddr)1[02-9ac-hj-np-z]+)/gu;
export function tokenize(text) {
  const out = [];
  let last = 0;
  const s = String(text || '');
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) out.push({ type: 'text', value: s.slice(last, m.index) });
    if (m[1]) out.push({ type: 'link', value: m[1] });
    else if (m[2]) out.push({ type: 'hashtag', value: m[2].slice(1) });
    else if (m[3]) out.push({ type: 'nostr', value: m[3] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ type: 'text', value: s.slice(last) });
  return out;
}

export function hashtagsOf(text) {
  return [...new Set(tokenize(text).filter(t => t.type === 'hashtag').map(t => t.value.toLowerCase()))];
}

// ---- time ----
export function relativeTime(sec, nowMs = Date.now()) {
  const d = Math.max(0, Math.floor(nowMs / 1000) - sec);
  if (d < 60) return { short: `${d}s`, long: d < 10 ? 'just now' : `${d} seconds ago` };
  const m = Math.floor(d / 60);
  if (m < 60) return { short: `${m}m`, long: `${m} minute${m === 1 ? '' : 's'} ago` };
  const h = Math.floor(m / 60);
  if (h < 24) return { short: `${h}h`, long: `${h} hour${h === 1 ? '' : 's'} ago` };
  const date = new Date(sec * 1000);
  const short = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: (nowMs - sec * 1000) > 300 * 864e5 ? 'numeric' : undefined });
  return { short, long: short };
}

export function fullDate(sec) {
  return new Date(sec * 1000).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---- follows (kind 3 is replaced whole, so always edit the newest copy) ----
export function newestEvent(events) {
  let best = null;
  for (const e of events || []) if (!best || e.created_at > best.created_at || (e.created_at === best.created_at && e.id < best.id)) best = e;
  return best;
}

export function followTemplate(newest, pubkey, follow, nowSec = Math.floor(Date.now() / 1000)) {
  const tags = newest ? newest.tags.filter(t => !(t[0] === 'p' && t[1] === pubkey)) : [];
  if (follow) tags.push(['p', pubkey]);
  return { kind: 3, created_at: Math.max(nowSec, newest ? newest.created_at + 1 : 0), tags, content: newest ? newest.content : '' };
}

export function followsOf(ev) {
  return ev ? [...new Set(ev.tags.filter(t => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1] || '')).map(t => t[1]))] : [];
}

export function shortKey(hex) { return String(hex || '').slice(0, 4); }

export function parseProfile(ev) {
  if (!ev) return {};
  try { const p = JSON.parse(ev.content); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
}

/** The handle Birdline shows: @username·abcd (key tail so look-alikes can't pass as someone else). */
export function handleOf(profile, pubkey) {
  const raw = profile && (profile.name || profile.username || '');
  const u = normalizeUsername(raw).replace(/[^a-z0-9_]/g, '').slice(0, 30);
  return { username: u || null, tail: shortKey(pubkey) };
}

export function displayNameOf(profile, pubkey) {
  const d = profile && (profile.display_name || profile.displayName || profile.name);
  return (d && String(d).trim().slice(0, 64)) || `Someone ${shortKey(pubkey)}`;
}

export function safeUrl(u) {
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; } catch { return null; }
}

/** Replies: true when a kind 1 has NIP-10 reply markers or positional e tags. */
export function isReply(ev) {
  return (ev.tags || []).some(t => t[0] === 'e');
}

// Minimal bech32 data decode (to read the scrypt cost byte from an ncryptsec without a full decoder).
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
export function bech32Bytes(str) {
  const s = String(str).toLowerCase(); const pos = s.lastIndexOf('1');
  const words = [];
  for (const ch of s.slice(pos + 1, -6)) { const v = B32.indexOf(ch); if (v < 0) throw new Error('bad bech32'); words.push(v); }
  let acc = 0, bits = 0; const out = [];
  for (const w of words) { acc = (acc << 5) | w; bits += 5; while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); } }
  return { prefix: s.slice(0, pos), bytes: Uint8Array.from(out) };
}
export function ncryptsecLogN(ncryptsec) {
  const { prefix, bytes } = bech32Bytes(ncryptsec);
  if (prefix !== 'ncryptsec') throw new Error('not an ncryptsec');
  return bytes[1];
}

export function bytesToHexSafe(b) { return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }
export function hexToBytesSafe(h) { return Uint8Array.from(String(h).match(/../g).map(x => parseInt(x, 16))); }


// ---- post actions (NIP-10 replies, NIP-18 reposts, NIP-25 likes, NIP-09 deletes) ----
const HEX64 = /^[0-9a-f]{64}$/;
/** The id of the post this kind 1 answers: the "reply" marker, else the "root" marker, else the last positional e tag. */
export function replyTargetOf(ev) {
  const es = (ev && ev.tags || []).filter(t => t[0] === 'e' && HEX64.test(t[1] || ''));
  if (!es.length) return null;
  const marked = es.find(t => t[3] === 'reply') || es.find(t => t[3] === 'root');
  return (marked || es[es.length - 1])[1];
}
/** The thread's first post for a reply (or the post itself when it isn't a reply). */
export function rootOf(ev) {
  const es = (ev && ev.tags || []).filter(t => t[0] === 'e' && HEX64.test(t[1] || ''));
  const r = es.find(t => t[3] === 'root');
  if (r) return r[1];
  if (es.length && !es.some(t => t[3])) return es[0][1];
  return es.length ? replyTargetOf(ev) : ev.id;
}
/** The post a like or repost points at: NIP-25 says the last e tag. */
export function reactionTargetOf(ev) {
  const es = (ev && ev.tags || []).filter(t => t[0] === 'e' && HEX64.test(t[1] || ''));
  return es.length ? es[es.length - 1][1] : null;
}
export function replyTemplate(parent, content, relayHint = '') {
  const root = rootOf(parent);
  const tags = [];
  if (root && root !== parent.id) tags.push(['e', root, relayHint, 'root'], ['e', parent.id, relayHint, 'reply']);
  else tags.push(['e', parent.id, relayHint, 'root']);
  const ps = [parent.pubkey, ...(parent.tags || []).filter(t => t[0] === 'p' && HEX64.test(t[1] || '')).map(t => t[1])];
  for (const p of [...new Set(ps)]) tags.push(['p', p]);
  for (const h of hashtagsOf(content)) tags.push(['t', h]);
  return { kind: 1, content, tags };
}
export function repostTemplate(ev, relayHint = '') {
  return { kind: 6, content: JSON.stringify(ev), tags: [['e', ev.id, relayHint], ['p', ev.pubkey], ['k', String(ev.kind)]] };
}
export function likeTemplate(ev) {
  return { kind: 7, content: '+', tags: [['e', ev.id], ['p', ev.pubkey], ['k', String(ev.kind)]] };
}
export function deleteTemplate(ids, kind) {
  return { kind: 5, content: '', tags: [...ids.map(id => ['e', id]), ['k', String(kind)]] };
}
/** Count replies, reposts and likes for the given post ids. Each person counts once per like or repost. */
export function tallyActions(events, ids, me, deleted = new Set()) {
  const want = new Set(ids); const out = {};
  for (const id of ids) out[id] = { replies: new Set(), reposts: new Map(), likes: new Map() };
  for (const ev of events || []) {
    if (deleted.has(ev.id)) continue;
    if (ev.kind === 1) { const t = replyTargetOf(ev); if (t && want.has(t)) out[t].replies.add(ev.id); }
    else if (ev.kind === 6 || ev.kind === 16) { const t = reactionTargetOf(ev); if (t && want.has(t) && !out[t].reposts.has(ev.pubkey)) out[t].reposts.set(ev.pubkey, ev.id); }
    else if (ev.kind === 7) { const t = reactionTargetOf(ev); if (t && want.has(t) && ev.content !== '-' && !out[t].likes.has(ev.pubkey)) out[t].likes.set(ev.pubkey, ev.id); }
  }
  const res = {};
  for (const id of ids) {
    const o = out[id];
    res[id] = { replies: o.replies.size, reposts: o.reposts.size, likes: o.likes.size, myRepost: (me && o.reposts.get(me)) || null, myLike: (me && o.likes.get(me)) || null };
  }
  return res;
}
/** What VoiceOver hears for an action button: "Like, 3" (just "Like" at zero). */
export function actionLabel(word, n) { return n > 0 ? `${word}, ${n}` : word; }
/** Short visible count: 999, 1.2K, 34K, 1.5M. */
export function compactCount(n) {
  if (n == null) return '';
  if (typeof n !== 'number') return String(n);
  if (n < 1000) return String(n);
  if (n < 10000) return (Math.floor(n / 100) / 10).toString().replace(/\.0$/, '') + 'K';
  if (n < 1e6) return Math.floor(n / 1000) + 'K';
  return (Math.floor(n / 1e5) / 10).toString().replace(/\.0$/, '') + 'M';
}
/** Parse the post inside a kind 6 repost (null when it isn't there or isn't valid JSON). */
export function repostedEvent(ev) {
  try { const e = JSON.parse(ev.content || ''); return e && typeof e === 'object' && HEX64.test(e.id || '') && HEX64.test(e.pubkey || '') && typeof e.content === 'string' ? e : null; } catch { return null; }
}
/** Hashtags people in the loaded posts are using, most-used first. */
export function topHashtags(events, n = 5) {
  const counts = new Map();
  for (const ev of events || []) {
    const seen = new Set();
    for (const t of (ev.tags || [])) if (t[0] === 't' && t[1]) seen.add(String(t[1]).toLowerCase().slice(0, 40));
    for (const h of hashtagsOf(ev.content || '')) seen.add(h.slice(0, 40));
    for (const h of seen) counts.set(h, (counts.get(h) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([tag, count]) => ({ tag, count }));
}
/** People followed by the people you follow, most-shared first, minus you and who you already follow. */
export function suggestFollows(followLists, me, myFollows, n = 3) {
  const skip = new Set([me, ...myFollows]); const counts = new Map();
  for (const ev of followLists || []) for (const p of followsOf(ev)) if (!skip.has(p)) counts.set(p, (counts.get(p) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([pubkey, count]) => ({ pubkey, count }));
}
