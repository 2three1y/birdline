// Birdline app: router and views. All text goes in with textContent, never as markup, because a script injection here could steal a key.
import { nip19 } from '../vendor/nostr-tools-2.25.4.bundle.js?v=0.1.1';
import * as U from './util.js?v=0.1.1';
import * as S from './store.js?v=0.1.1';
import * as N from './nostr.js?v=0.1.1';
import { createLockedKey, unlockKey, lastTimings, ncryptLogN } from './crypto.js?v=0.1.1';

// ---------- tiny DOM helpers ----------
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return e;
}
const $ = (sel, root = document) => root.querySelector(sel);
const sr = (text) => el('span', { class: 'visually-hidden', text });

// ---------- the one live region ----------
const announcer = () => document.getElementById('announcer');
let announceTimer = null;
export function announce(msg) {
  const a = announcer(); if (!a) return;
  clearTimeout(announceTimer); a.textContent = '';
  announceTimer = setTimeout(() => { a.textContent = msg; }, 80);
}

// ---------- state ----------
const state = { me: null, follows: [], cleanup: [], justJoined: null, skHex: null };
function onCleanup(fn) { state.cleanup.push(fn); }
function runCleanup() { for (const fn of state.cleanup.splice(0)) { try { fn(); } catch {} } }

function applySettings() {
  const s = S.settings();
  const sys = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.toggle('reduce-motion', s.reduceMotion === 'on' || (s.reduceMotion === 'system' && sys));
}

// ---------- routing ----------
const PUBLIC = new Set(['', 'signin', 'join', 'key']);
function parseRoute() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [path] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return { name: '' };
  if (parts[0].startsWith('@')) return { name: 'profile', who: parts[0].slice(1) };
  if (parts[0] === 'u' && parts[1]) return { name: 'profile', who: parts[1] };
  return { name: parts[0], arg: parts[1] };
}

let firstRender = true;
async function route() {
  runCleanup();
  const r = parseRoute();
  if (!state.me && !PUBLIC.has(r.name) && r.name !== 'profile') { location.replace('#/signin'); return; }
  if (state.me && (r.name === '' || r.name === 'signin' || r.name === 'join')) { location.replace('#/home'); return; }
  const views = { '': viewSignIn, signin: viewSignIn, join: viewJoin, key: viewKey, home: viewHome, connect: viewConnect, discover: viewDiscover, me: viewMe, settings: viewSettings, profile: viewProfile };
  const view = views[r.name] || viewNotFound;
  const box = document.getElementById('view');
  box.replaceChildren();
  document.getElementById('tabbar').hidden = !state.me;
  document.body.classList.toggle('signed-in', !!state.me);
  for (const a of document.querySelectorAll('#tabbar a')) {
    const on = a.id === 'tab-' + (r.name === 'settings' || (r.name === 'profile' && state.me && isMe(r.who)) ? 'me' : r.name);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  await view(box, r);
  if (!firstRender) { const h = document.getElementById('view-title'); h.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  firstRender = false;
}
function setTitle(text) {
  document.getElementById('view-title').textContent = text;
  document.title = text === 'Birdline' ? 'Birdline' : `${text} · Birdline`;
}
function isMe(who) { if (!state.me || !who) return false; return who === state.me.username || N.pubkeyFromAny(who) === state.me.pubkey; }

// ---------- shared form bits ----------
function field({ id, label, type = 'text', hint, autocomplete, extra = {} }) {
  const hintId = hint ? `${id}-hint` : null;
  const errId = `${id}-error`;
  const input = el(type === 'textarea' ? 'textarea' : 'input', { id, name: id, type: type === 'textarea' ? null : type, autocomplete, 'aria-describedby': [hintId, errId].filter(Boolean).join(' '), ...extra });
  return {
    input,
    node: el('div', { class: 'field' },
      el('label', { for: id, text: label }),
      input,
      hint ? el('p', { class: 'hint', id: hintId, text: hint }) : null,
      el('p', { class: 'error', id: errId })),
    setError(msg) { const e = document.getElementById(errId); if (e) e.textContent = msg || ''; if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); },
  };
}
function showPasswordButton(input, id) {
  return el('button', { type: 'button', class: 'btn quiet small', id, 'aria-pressed': 'false', 'aria-controls': input.id, onclick: (e) => {
    const show = input.type === 'password'; input.type = show ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-pressed', String(show));
  } }, 'Show password');
}
function checkbox({ id, label, desc, checked }) {
  const input = el('input', { type: 'checkbox', id, checked: !!checked, 'aria-describedby': desc ? `${id}-desc` : null });
  return { input, node: el('div', { class: 'check' }, input, el('div', {}, el('label', { for: id, text: label }), desc ? el('p', { class: 'hint', id: `${id}-desc`, text: desc }) : null)) };
}
function setBusy(btn, busyText) {
  if (busyText) { btn.dataset.label = btn.textContent; btn.textContent = busyText; btn.setAttribute('aria-busy', 'true'); btn.dataset.busy = '1'; }
  else { if (btn.dataset.label) btn.textContent = btn.dataset.label; btn.removeAttribute('aria-busy'); delete btn.dataset.busy; }
}

// ---------- sign in ----------
async function finishSignIn({ pubkey, skHex, username, method, remember, ncryptsec, synced }) {
  if (method === 'local') { N.setLocalSigner(skHex); state.skHex = skHex; } else { N.setExtensionSigner(); state.skHex = null; }
  if (!username) { const p = N.cachedProfile(pubkey) || await N.fetchProfile(pubkey).catch(() => null); username = U.handleOf(p || {}, pubkey).username; }
  state.me = { pubkey, username, method };
  if (ncryptsec && username) S.saveAccount(username, { pubkey, ncryptsec, synced: !!synced });
  if (remember) await S.rememberSession(pubkey, method === 'local' ? skHex : null, username); else await S.forgetSession();
}

function viewSignIn(box) {
  setTitle('Sign in to Birdline');
  const user = field({ id: 'signin-username', label: 'Username', autocomplete: 'username', extra: { autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', inputmode: 'text' } });
  const pass = field({ id: 'signin-password', label: 'Password', type: 'password', autocomplete: 'current-password' });
  const remember = checkbox({ id: 'signin-remember', label: 'Keep me signed in on this device', checked: true });
  const submit = el('button', { type: 'submit', class: 'btn primary', id: 'signin-submit' }, 'Sign in');
  const form = el('form', { id: 'signin-form', class: 'card form', novalidate: true },
    user.node, el('div', { class: 'field-with-action' }, pass.node, showPasswordButton(pass.input, 'signin-password-toggle')),
    remember.node, submit,
    el('p', { class: 'form-error', id: 'signin-error' }),
    el('p', {}, el('a', { href: '#/key', id: 'signin-key-link' }, 'Use an existing Nostr key or extension')));
  box.append(
    el('p', { class: 'lede' }, 'Short posts from the people you follow, newest first. No algorithm, no ads, no AI, and nobody owns your account.'),
    form,
    el('section', { class: 'card join-cta', 'aria-labelledby': 'join-cta-title' },
      el('h2', { id: 'join-cta-title', text: 'New to Birdline?' }),
      el('p', {}, 'Make an account in about a minute. No email or phone number.'),
      el('a', { href: '#/join', class: 'btn secondary', id: 'join-link' }, 'Join Birdline')));
  const errP = $('#signin-error', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (submit.dataset.busy) return;
    const username = U.normalizeUsername(user.input.value); const password = pass.input.value;
    user.setError(''); pass.setError(''); errP.textContent = '';
    if (!username) { user.setError('Enter your username.'); user.input.focus(); announce('Enter your username.'); return; }
    if (!password) { pass.setError('Enter your password.'); pass.input.focus(); announce('Enter your password.'); return; }
    setBusy(submit, 'Signing in…'); announce('Signing in. Unlocking your account takes a few seconds.');
    try {
      const local = S.accounts()[username];
      const candidates = [];
      if (local && local.ncryptsec) candidates.push({ ncryptsec: local.ncryptsec, pubkey: local.pubkey, synced: local.synced });
      let tried = 0;
      for (const c of candidates) { tried++; const r = await unlockKey(c.ncryptsec, password); if (r && r.pubkey === c.pubkey) return await done(r, c); }
      const remote = await N.syncedLogins(username);
      for (const ev of remote.sort((a, b) => a.created_at - b.created_at)) {
        if (candidates.some(c => c.ncryptsec === ev.content)) continue;
        tried++;
        const r = await unlockKey(ev.content, password);
        if (r && r.pubkey === ev.pubkey) return await done(r, { ncryptsec: ev.content, pubkey: ev.pubkey, synced: true });
      }
      const msg = tried ? 'That username and password don’t match. Check both and try again.' : `We couldn’t find @${username} on this device or on the relays. Check the spelling, or join with that name.`;
      errP.textContent = msg; announce(msg); pass.input.focus();
    } catch (err) {
      const msg = 'Signing in failed: ' + (err && err.message || err) + '. Try again.'; errP.textContent = msg; announce(msg);
    } finally { setBusy(submit, null); }
    async function done(r, c) {
      await finishSignIn({ pubkey: r.pubkey, skHex: r.skHex, username, method: 'local', remember: remember.input.checked, ncryptsec: c.ncryptsec, synced: c.synced });
      setBusy(submit, null);
      location.hash = '#/home';
    }
  });
}

// ---------- join ----------
function strengthWord(n) { return ['too short', 'weak', 'okay', 'good', 'strong'][n]; }
function viewJoin(box) {
  setTitle('Join Birdline');
  const name = field({ id: 'join-name', label: 'Full name', autocomplete: 'name', hint: 'Shown on your profile. You can change it later.', extra: { maxlength: 50 } });
  const user = field({ id: 'join-username', label: 'Username', autocomplete: 'username', hint: 'Up to 15 letters, numbers or underscores. People find you by it.', extra: { autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: 16 } });
  const status = el('p', { class: 'status', id: 'join-username-status' });
  user.input.setAttribute('aria-describedby', user.input.getAttribute('aria-describedby') + ' join-username-status');
  const suggest = el('div', { class: 'suggestions', id: 'join-username-suggestions' });
  const pass = field({ id: 'join-password', label: 'Password', type: 'password', autocomplete: 'new-password', hint: 'At least 10 characters. It also locks your account key, so use one you don’t use anywhere else.' });
  const strength = el('p', { class: 'status', id: 'join-password-strength' });
  pass.input.setAttribute('aria-describedby', pass.input.getAttribute('aria-describedby') + ' join-password-strength');
  const synced = checkbox({ id: 'join-synced', label: 'Sign in on any device with this password', checked: true, desc: 'Your account key is saved on the relays, locked with your password, so signing in works anywhere. Turn this off to keep the key only on this device.' });
  const remember = checkbox({ id: 'join-remember', label: 'Keep me signed in on this device', checked: true });
  const submit = el('button', { type: 'submit', class: 'btn primary', id: 'join-submit' }, 'Create my account');
  const errP = el('p', { class: 'form-error', id: 'join-error' });
  const form = el('form', { id: 'join-form', class: 'card form', novalidate: true },
    name.node, el('div', { class: 'field-group' }, user.node, status, suggest),
    el('div', { class: 'field-with-action' }, pass.node, showPasswordButton(pass.input, 'join-password-toggle')), strength,
    synced.node, remember.node, submit, errP,
    el('p', { class: 'hint' }, 'Birdline has no company servers. Your account is a Nostr key made on this device, and your posts go to public relays.'));
  box.append(el('p', { class: 'lede' }, 'It takes about a minute. No email or phone number needed.'), form,
    el('p', {}, 'Already have an account? ', el('a', { href: '#/signin', id: 'join-signin-link' }, 'Sign in')));

  let checkSeq = 0; let lastCheck = { username: null, owner: undefined };
  async function checkName(announceIt) {
    const u = U.normalizeUsername(user.input.value); suggest.replaceChildren();
    const prob = U.usernameProblem(u);
    if (!u) { status.textContent = ''; return null; }
    if (prob) { status.textContent = prob; status.className = 'status bad'; return prob; }
    if (S.accounts()[u]) { const m = `@${u} is already saved on this device. Sign in instead, or pick another.`; status.textContent = m; status.className = 'status bad'; return m; }
    const my = ++checkSeq; status.textContent = `Checking @${u}…`; status.className = 'status';
    let owner = null; try { owner = await N.usernameOwner(u); } catch {}
    if (my !== checkSeq) return undefined;
    lastCheck = { username: u, owner };
    if (owner) {
      const m = `@${u} is taken.`; status.textContent = m + ' Try one of these:'; status.className = 'status bad';
      for (const s of U.usernameSuggestions(u, name.input.value)) suggest.append(el('button', { type: 'button', class: 'btn secondary small', onclick: () => { user.input.value = s; checkName(true); user.input.focus(); } }, `Use @${s}`));
      if (announceIt) announce(`@${u} is taken. Suggestions follow the field.`);
      return m;
    }
    status.textContent = `@${u} is free.`; status.className = 'status good';
    if (announceIt) announce(`@${u} is free.`);
    return null;
  }
  let t = null;
  user.input.addEventListener('input', () => { user.setError(''); clearTimeout(t); t = setTimeout(() => checkName(document.activeElement === user.input), 700); });
  pass.input.addEventListener('input', () => { pass.setError(''); const n = U.passwordStrength(pass.input.value); strength.textContent = pass.input.value ? `Strength: ${strengthWord(n)}.` : ''; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (submit.dataset.busy) return;
    errP.textContent = '';
    const nm = name.input.value.trim(); const u = U.normalizeUsername(user.input.value); const pw = pass.input.value;
    const problems = [];
    name.setError(''); user.setError(''); pass.setError('');
    if (!nm) { name.setError('Enter a name. It can be a nickname.'); problems.push(name); }
    const up = U.usernameProblem(u); if (up) { user.setError(up); problems.push(user); }
    const pp = U.passwordProblem(pw, u, nm); if (pp) { pass.setError(pp); problems.push(pass); }
    if (problems.length) { problems[0].input.focus(); announce(problems.length === 1 ? 'One thing to fix.' : `${problems.length} things to fix.`); return; }
    setBusy(submit, 'Checking your username…');
    let taken = lastCheck.username === u ? lastCheck.owner : undefined;
    if (taken === undefined) { const m = await checkName(false); taken = m ? true : null; if (m && !lastCheck.owner && m.includes('saved on this device')) taken = true; }
    if (taken) { setBusy(submit, null); user.setError(`@${u} is taken. Pick another or use a suggestion.`); user.input.focus(); announce(`@${u} is taken.`); return; }
    setBusy(submit, 'Creating your account…'); announce('Creating your account. Locking your key takes a few seconds.');
    try {
      const k = await createLockedKey(pw);
      N.setLocalSigner(k.skHex);
      const profile = { name: u, display_name: nm, about: '' };
      const now = Math.floor(Date.now() / 1000);
      const label = [['L', U.LABEL_NS], ['l', u, U.LABEL_NS]];
      // everything goes out at once, so the wait is one relay round, not four
      const jobs = [
        N.publish({ kind: 0, content: JSON.stringify(profile) }),
        N.publish({ kind: 10002, tags: N.relays.map(x => ['r', x]) }),
        N.publish({ kind: 30078, tags: [['d', 'birdline/handle'], ...label, ['claimed_at', String(now)]], content: '' }),
      ];
      if (synced.input.checked) jobs.push(N.publish({ kind: 30078, tags: [['d', 'birdline/login'], ...label, ['alt', 'Birdline sign-in: account key locked with the owner’s password (NIP-49)']], content: k.ncryptsec }));
      const rs = await Promise.allSettled(jobs);
      if (rs[0].status !== 'fulfilled') throw rs[0].reason;
      const r0 = rs[0].value;
      N.rememberProfileEvent(r0.event);
      await finishSignIn({ pubkey: k.pubkey, skHex: k.skHex, username: u, method: 'local', remember: remember.input.checked, ncryptsec: k.ncryptsec, synced: synced.input.checked });
      const syncedOk = synced.input.checked ? (rs[3] && rs[3].status === 'fulfilled' ? rs[3].value.ok : 0) : null;
      state.justJoined = { name: nm, ok: r0.ok, total: r0.total, slow: r0.slow, ms: k.ms, logN: k.logN, syncedOk };
      setBusy(submit, null);
      location.hash = '#/home';
    } catch (err) {
      setBusy(submit, null);
      const msg = 'Your account couldn’t be created: ' + (err && err.message || err) + '. Nothing was saved. Try again.';
      errP.textContent = msg; announce(msg);
    }
  });
}

// ---------- existing key / extension ----------
function viewKey(box) {
  setTitle('Sign in with a Nostr key');
  const has = typeof window.nostr === 'object' && window.nostr;
  const extBtn = el('button', { type: 'button', class: 'btn primary', id: 'key-extension' }, 'Use my Nostr extension');
  const extRemember = checkbox({ id: 'key-extension-remember', label: 'Keep me signed in on this device', checked: true });
  const secret = field({ id: 'key-secret', label: 'Your secret key (nsec) or locked key (ncryptsec)', type: 'password', autocomplete: 'off', extra: { autocapitalize: 'none', spellcheck: 'false' } });
  const pw = field({ id: 'key-password', label: 'Password (only for a locked ncryptsec key)', type: 'password', autocomplete: 'current-password' });
  const remember = checkbox({ id: 'key-remember', label: 'Keep me signed in on this device', checked: true });
  const submit = el('button', { type: 'submit', class: 'btn primary', id: 'key-submit' }, 'Sign in with this key');
  const errP = el('p', { class: 'form-error', id: 'key-error' });
  box.append(
    el('section', { class: 'card', 'aria-labelledby': 'key-ext-title' }, el('h2', { id: 'key-ext-title', text: 'Browser extension' }),
      el('p', {}, has ? 'Your extension signs for you, so Birdline never sees your key.' : 'No Nostr extension was found in this browser. On iPhone, Safari extensions like Nostore work here.'),
      extRemember.node, extBtn),
    el('form', { class: 'card form', id: 'key-form', novalidate: true, 'aria-labelledby': 'key-paste-title' },
      el('h2', { id: 'key-paste-title', text: 'Paste a key' }),
      el('p', { class: 'hint' }, 'Your key stays on this device. Birdline never sends it anywhere.'),
      secret.node, pw.node, remember.node, submit, errP),
    el('p', {}, el('a', { href: '#/signin' }, 'Back to username and password')));
  extBtn.addEventListener('click', async () => {
    if (!(typeof window.nostr === 'object' && window.nostr)) { announce('No Nostr extension found in this browser.'); return; }
    setBusy(extBtn, 'Waiting for your extension…');
    try { const pk = await window.nostr.getPublicKey(); await finishSignIn({ pubkey: pk, method: 'nip07', remember: extRemember.input.checked }); location.hash = '#/home'; }
    catch (err) { announce('The extension didn’t sign you in: ' + (err && err.message || err)); }
    finally { setBusy(extBtn, null); }
  });
  $('#key-form', box).addEventListener('submit', async (e) => {
    e.preventDefault(); if (submit.dataset.busy) return; errP.textContent = ''; secret.setError('');
    const s = secret.input.value.trim();
    try {
      if (s.startsWith('nsec1')) {
        const d = nip19.decode(s); const skHex = U.bytesToHexSafe(d.data);
        const { getPublicKey } = await import('../vendor/nostr-tools-2.25.4.bundle.js?v=0.1.1');
        await finishSignIn({ pubkey: getPublicKey(d.data), skHex, method: 'local', remember: remember.input.checked });
        location.hash = '#/home'; return;
      }
      if (s.startsWith('ncryptsec1')) {
        if (!pw.input.value) { pw.setError('Enter the password that locks this key.'); pw.input.focus(); announce('Enter the password that locks this key.'); return; }
        setBusy(submit, 'Unlocking…'); announce('Unlocking your key. This takes a few seconds.');
        const r = await unlockKey(s, pw.input.value);
        setBusy(submit, null);
        if (!r) { const m = 'That password doesn’t unlock this key.'; pw.setError(m); announce(m); pw.input.focus(); return; }
        await finishSignIn({ pubkey: r.pubkey, skHex: r.skHex, method: 'local', remember: remember.input.checked, ncryptsec: s });
        location.hash = '#/home'; return;
      }
      const m = 'That doesn’t look like a key. It should start with nsec1 or ncryptsec1.'; secret.setError(m); announce(m); secret.input.focus();
    } catch (err) { setBusy(submit, null); const m = 'That key didn’t work: ' + (err && err.message || err); errP.textContent = m; announce(m); }
  });
}

// ---------- posts ----------
function displayFor(pk) { const p = N.cachedProfile(pk); return { name: U.displayNameOf(p, pk), ...U.handleOf(p, pk) }; }
function authorLine(pk) {
  const d = displayFor(pk);
  return el('a', { href: `#/u/${N.npubOf(pk)}`, class: 'author', 'data-pubkey': pk },
    el('span', { class: 'author-name', text: d.name }), ' ',
    el('span', { class: 'author-handle' }, d.username ? `@${d.username}` : '', sr(' key '), el('span', { 'aria-hidden': 'true', text: d.username ? ' · ' : '' }), d.tail));
}
function textNodes(text) {
  const s = S.settings(); const out = [];
  for (const t of U.tokenize(text)) {
    if (t.type === 'text') out.push(document.createTextNode(t.value));
    else if (t.type === 'link') { const href = U.safeUrl(t.value); out.push(href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, t.value.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60) + (t.value.length > 70 ? '…' : '')) : document.createTextNode(t.value)); }
    else if (t.type === 'hashtag') out.push(s.readHashAsHashtag ? el('span', { class: 'hashtag' }, el('span', { 'aria-hidden': 'true', text: '#' }), sr('hashtag '), t.value) : el('span', { class: 'hashtag', text: '#' + t.value }));
    else if (t.type === 'nostr') {
      const pk = N.pubkeyFromAny(t.value);
      if (pk) { const d = displayFor(pk); out.push(el('a', { href: `#/u/${N.npubOf(pk)}`, class: 'mention', 'data-pubkey': pk }, '@' + (d.username || d.name))); }
      else out.push(el('span', { class: 'nostr-ref', text: '(linked post)' }));
    }
  }
  return out;
}
function renderPost(ev) {
  const when = U.relativeTime(ev.created_at);
  const full = U.fullDate(ev.created_at);
  const long = U.countChars(ev.content) > 280;
  const body = el('p', { class: 'post-text' }, textNodes(long ? Array.from(ev.content).slice(0, 280).join('') + '…' : ev.content));
  const art = el('article', { class: 'post', 'data-id': ev.id, 'data-pubkey': ev.pubkey },
    el('h2', { class: 'post-author', tabindex: '-1' }, authorLine(ev.pubkey)));
  if (U.isReply(ev)) {
    const p = ev.tags.find(t => t[0] === 'p' && t[1] !== ev.pubkey);
    art.append(el('p', { class: 'reply-context' }, p ? `Replying to ${displayFor(p[1]).name}` : 'Reply'));
  }
  art.append(body);
  if (long) {
    const more = el('button', { type: 'button', class: 'btn quiet small', 'aria-expanded': 'false' }, 'Show more');
    more.addEventListener('click', () => { body.replaceChildren(...textNodes(ev.content)); more.remove(); announce('Showing the whole post.'); });
    art.append(more);
  }
  art.append(el('p', { class: 'post-meta' }, el('time', { datetime: new Date(ev.created_at * 1000).toISOString(), title: full }, el('span', { 'aria-hidden': 'true', text: when.short }), sr(`${when.long}, ${full}`))));
  return art;
}
function refreshNames(root, got) {
  for (const a of root.querySelectorAll('[data-pubkey].author')) {
    if (got && !got.has(a.dataset.pubkey)) continue;
    a.replaceWith(authorLine(a.dataset.pubkey));
  }
}

// ---------- compose ----------
function composeBox(onPosted) {
  const text = el('textarea', { id: 'compose-text', rows: '3', 'aria-describedby': 'compose-count-desc', autocapitalize: 'sentences' });
  const count = el('span', { id: 'compose-count', class: 'count', 'aria-hidden': 'true', text: String(U.POST_LIMIT) });
  const desc = el('span', { id: 'compose-count-desc', class: 'visually-hidden', text: U.charsLeftLabel(U.POST_LIMIT) });
  const send = el('button', { type: 'submit', class: 'btn primary', id: 'compose-send' }, 'Post');
  const form = el('form', { id: 'compose-form', class: 'card compose', novalidate: true },
    el('label', { for: 'compose-text', id: 'compose-label', text: 'What’s on your mind?' }), text,
    el('div', { class: 'compose-bar' }, count, desc, send));
  let prevLeft = U.POST_LIMIT;
  function update() {
    const left = U.POST_LIMIT - U.countChars(text.value);
    count.textContent = String(left);
    count.className = 'count' + (left < 0 ? ' over' : left <= 10 ? ' near' : '');
    desc.textContent = U.charsLeftLabel(left);
    const say = U.counterAnnouncement(prevLeft, left); if (say) announce(say);
    prevLeft = left;
  }
  text.addEventListener('input', update);
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (send.dataset.busy) return;
    const body = text.value.trim(); const n = U.countChars(body);
    if (!n) { announce('Write something first.'); text.focus(); return; }
    if (n > U.POST_LIMIT) { announce(`Too long by ${n - U.POST_LIMIT}. Posts can be ${U.POST_LIMIT} characters.`); text.focus(); return; }
    setBusy(send, 'Posting…');
    try {
      const tags = U.hashtagsOf(body).map(t => ['t', t]);
      const r = await N.publish({ kind: 1, content: body, tags });
      if (!r.ok) { announce('Not posted: no relay took it. Your text is still in the box.'); return; }
      text.value = ''; prevLeft = U.POST_LIMIT; update();
      announce(`Posted to ${r.ok} of ${r.total} relays.`);
      onPosted && onPosted(r.event);
      text.focus();
    } catch (err) { announce('Not posted: ' + (err && err.message || err)); }
    finally { setBusy(send, null); }
  });
  return form;
}

// ---------- home ----------
async function viewHome(box) {
  setTitle('Home');
  const me = state.me.pubkey;
  const seen = new Set(); let pending = []; let oldest = Infinity;
  const timeline = el('div', { id: 'timeline', class: 'timeline' });
  const newBtn = el('button', { type: 'button', class: 'btn secondary new-posts', id: 'new-posts', hidden: true });
  const status = el('p', { class: 'status', id: 'timeline-status', text: 'Loading your timeline…' });
  const more = el('button', { type: 'button', class: 'btn secondary', id: 'timeline-older', hidden: true }, 'Load older posts');
  const showMine = (ev) => {
    seen.add(ev.id); pending = pending.filter(p => p.id !== ev.id); updateNew();
    if (!timeline.querySelector(`[data-id="${ev.id}"]`)) timeline.prepend(renderPost(ev));
    status.textContent = '';
  };
  const compose = composeBox(showMine);
  if (state.justJoined) {
    const j = state.justJoined; state.justJoined = null;
    const lines = [`Your profile reached ${j.ok} of ${j.total} relays${j.slow ? ` (${j.slow === 1 ? 'one' : j.slow} didn’t answer in time, but may have it)` : ''}.`];
    if (j.syncedOk === 0) lines.push('Signing in on other devices may not work yet, because no relay took your locked key. Try again from Settings later.');
    box.append(el('section', { class: 'card notice', id: 'welcome', 'aria-labelledby': 'welcome-title' },
      el('h2', { id: 'welcome-title', text: `Welcome, ${j.name}!` }),
      el('p', {}, lines.join(' ')),
      el('p', {}, 'Your timeline shows posts from people you follow, newest first. Find someone from ', el('a', { href: '#/connect' }, 'Connect'), ', or save a backup of your key in ', el('a', { href: '#/settings' }, 'Settings'), '.')));
    setTimeout(() => announce(`Account created. ${lines[0]}`), 900);
  }
  box.append(compose, newBtn, status, timeline, more);

  let lastAnnounce = 0; let announceLater = null;
  function updateNew() {
    newBtn.hidden = !pending.length;
    newBtn.textContent = `${pending.length} new post${pending.length === 1 ? '' : 's'}`;
    if (!pending.length) return;
    const say = () => { lastAnnounce = Date.now(); announce(pending.length === 1 ? '1 new post. Show it with the button above your timeline.' : `${pending.length} new posts. Show them with the button above your timeline.`); };
    const wait = 30000 - (Date.now() - lastAnnounce);
    if (wait <= 0) say(); else if (!announceLater) announceLater = setTimeout(() => { announceLater = null; if (pending.length) say(); }, wait);
  }
  onCleanup(() => clearTimeout(announceLater));
  newBtn.addEventListener('click', () => {
    const add = pending.sort((a, b) => b.created_at - a.created_at); pending = [];
    const frag = document.createDocumentFragment(); add.forEach(ev => frag.append(renderPost(ev)));
    timeline.prepend(frag); updateNew(); status.textContent = '';
    const first = timeline.querySelector('.post-author'); if (first) first.focus();
    N.wantProfiles(add.map(e => e.pubkey));
  });

  const unsub = N.onProfiles((got) => refreshNames(timeline, got)); onCleanup(unsub);

  let follow = N.cachedFollowList(me);
  if (!follow) follow = await N.fetchNewestFollowList(me); else N.fetchNewestFollowList(me).then(f => { if (f) state.follows = U.followsOf(f); });
  state.follows = U.followsOf(follow);
  const authors = [me, ...state.follows].slice(0, 500);
  const nowSec = Math.floor(Date.now() / 1000);
  async function load(until) {
    const f = { kinds: [1], authors, limit: 40 }; if (until) f.until = until;
    const evs = (await N.query(f, 4500).catch(() => [])).filter(e => !seen.has(e.id) && e.created_at <= nowSec + 120).sort((a, b) => b.created_at - a.created_at);
    const frag = document.createDocumentFragment();
    for (const ev of evs) { seen.add(ev.id); oldest = Math.min(oldest, ev.created_at); frag.append(renderPost(ev)); }
    timeline.append(frag);
    N.wantProfiles(evs.map(e => e.pubkey));
    return evs.length;
  }
  const n = await load();
  if (!document.body.contains(timeline)) return;
  if (!n) {
    status.replaceChildren(state.follows.length ? 'No posts yet from the people you follow.' : 'Your timeline is quiet because you don’t follow anyone yet. ',
      state.follows.length ? '' : el('a', { href: '#/connect' }, 'Find people to follow'));
  } else { status.textContent = ''; more.hidden = false; }
  more.addEventListener('click', async () => {
    setBusy(more, 'Loading…'); const got = await load(oldest - 1); setBusy(more, null);
    announce(got ? `${got} older posts added at the bottom.` : 'No older posts found.'); if (!got) more.hidden = true;
  });
  const sub = N.pool.subscribeMany(N.relays, { kinds: [1], authors, since: nowSec }, {
    onevent(ev) {
      if (seen.has(ev.id)) return; seen.add(ev.id);
      if (ev.created_at > Math.floor(Date.now() / 1000) + 120) return;
      if (ev.pubkey === me) { showMine(ev); return; } // your own posts show right away
      pending.push(ev); updateNew(); N.wantProfiles([ev.pubkey]);
    },
  });
  onCleanup(() => sub.close());
}

// ---------- profile ----------
async function resolveWho(who) {
  const pk = N.pubkeyFromAny(who); if (pk) return pk;
  const u = U.normalizeUsername(who);
  const local = S.accounts()[u]; if (local) return local.pubkey;
  if (U.usernameProblem(u)) return null;
  return await N.usernameOwner(u).catch(() => null);
}
async function viewMe(box) { return viewProfile(box, { who: state.me.pubkey }); }
async function viewProfile(box, r) {
  setTitle('Profile');
  const status = el('p', { class: 'status', id: 'profile-status', text: 'Looking for this person on the relays…' });
  box.append(status);
  const pk = await resolveWho(r.who || '');
  if (!document.body.contains(status)) return;
  if (!pk) { setTitle('Person not found'); status.textContent = `No one called ${r.who} was found. Check the spelling, or paste their npub on Connect.`; return; }
  const mine = state.me && state.me.pubkey === pk;
  let prof = N.cachedProfile(pk);
  const header = el('section', { class: 'card profile', id: 'profile-header', 'aria-label': 'Profile details' });
  const posts = el('div', { id: 'profile-posts', class: 'timeline' });
  const postsStatus = el('p', { class: 'status', id: 'profile-posts-status', text: 'Loading posts…' });
  function drawHeader() {
    const d = displayFor(pk); prof = N.cachedProfile(pk) || {};
    setTitle(d.name);
    const banner = U.safeUrl(prof.banner);
    const pic = U.safeUrl(prof.picture);
    const site = U.safeUrl(prof.website);
    header.replaceChildren(...[
      el('div', { class: 'banner' }, banner ? el('img', { src: banner, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null),
      el('div', { class: 'avatar-row' },
        pic ? el('img', { class: 'avatar', src: pic, alt: '', width: '72', height: '72', referrerpolicy: 'no-referrer' }) : el('span', { class: 'avatar initial', 'aria-hidden': 'true', text: (d.name[0] || '?').toUpperCase() }),
        el('div', { class: 'who' }, el('p', { class: 'handle', id: 'profile-handle' }, d.username ? `@${d.username}` : '', sr(' key '), el('span', { 'aria-hidden': 'true', text: d.username ? ' · ' : '' }), d.tail))),
      prof.about ? el('p', { class: 'bio', id: 'profile-bio' }, textNodes(String(prof.about).slice(0, 500))) : el('p', { class: 'bio muted', id: 'profile-bio', text: mine ? 'No bio yet. Add one in Settings.' : 'No bio yet.' }),
      site ? el('p', { class: 'website' }, el('a', { href: site, target: '_blank', rel: 'noopener noreferrer me', id: 'profile-website' }, site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))) : null,
      el('ul', { class: 'counts', id: 'profile-counts' },
        el('li', { id: 'count-posts' }, el('strong', { text: '…' }), el('span', { class: 'count-word', text: ' posts' })),
        el('li', { id: 'count-following' }, el('strong', { text: '…' }), ' following'),
        el('li', { id: 'count-followers' }, el('strong', { text: '…' }), el('span', { class: 'count-word', text: ' followers seen' }))),
      el('div', { class: 'profile-actions' }, ...actions())].filter(Boolean));
  }
  function actions() {
    const copy = el('button', { type: 'button', class: 'btn quiet small', id: 'profile-copy-npub' }, 'Copy account key (npub)');
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(N.npubOf(pk)); announce('Copied the account key.'); } catch { announce('Couldn’t copy. The key is ' + N.npubOf(pk)); } });
    if (mine) {
      const out = el('button', { type: 'button', class: 'btn secondary', id: 'profile-signout' }, 'Sign out');
      out.addEventListener('click', signOut);
      return [el('a', { class: 'btn secondary', href: '#/settings', id: 'profile-settings' }, 'Settings and edit profile'), out, copy];
    }
    if (!state.me) return [el('a', { class: 'btn primary', href: '#/signin' }, 'Sign in to follow'), copy];
    const following = state.follows.includes(pk);
    const btn = el('button', { type: 'button', class: following ? 'btn secondary' : 'btn primary', id: 'profile-follow' }, following ? 'Unfollow' : 'Follow');
    btn.addEventListener('click', async () => {
      if (btn.dataset.busy) return;
      const want = !state.follows.includes(pk); const nm = displayFor(pk).name;
      setBusy(btn, want ? 'Following…' : 'Unfollowing…');
      try {
        const newest = await N.fetchNewestFollowList(state.me.pubkey);
        const r = await N.publish(U.followTemplate(newest, pk, want));
        if (!r.ok) { setBusy(btn, null); announce('That didn’t go through: no relay took the change. Try again.'); return; }
        N.rememberFollowList(r.event); state.follows = U.followsOf(r.event);
        setBusy(btn, null);
        btn.textContent = want ? 'Unfollow' : 'Follow'; btn.className = want ? 'btn secondary' : 'btn primary';
        announce(want ? `Now following ${nm}.` : `Unfollowed ${nm}.`);
        const fc = document.querySelector('#count-followers strong'); if (fc && /^\d+$/.test(fc.textContent)) fc.textContent = String(Number(fc.textContent) + (want ? 1 : -1));
      } catch (err) { setBusy(btn, null); announce('That didn’t go through: ' + (err && err.message || err)); }
    });
    return [btn, copy];
  }
  drawHeader();
  status.remove();
  box.append(header, el('p', { class: 'section-label', id: 'profile-posts-label', text: 'Recent posts' }), postsStatus, posts);
  const unsub = N.onProfiles((got) => { if (got.has(pk)) drawHeader(); refreshNames(posts, got); }); onCleanup(unsub);
  if (!prof || !prof.fetched) N.fetchProfile(pk).then(() => { if (document.body.contains(header)) drawHeader(); setCounts(); });
  let nPosts = null, nFollowing = null, nFollowers = null;
  function setCounts() {
    const s = (id, v) => {
      const e = document.querySelector(`#${id} strong`); if (!e || v == null) return; e.textContent = String(v);
      const w = document.querySelector(`#${id} .count-word`); if (w) w.textContent = id === 'count-posts' ? (v === 1 ? ' post' : ' posts') : (v === 1 ? ' follower seen' : ' followers seen');
    };
    s('count-posts', nPosts); s('count-following', nFollowing); s('count-followers', nFollowers);
  }
  N.fetchNewestFollowList(pk).then(f => { nFollowing = U.followsOf(f).length; setCounts(); });
  N.query({ kinds: [3], '#p': [pk], limit: 500 }, 5000).then(evs => { nFollowers = new Set(evs.map(e => e.pubkey)).size; setCounts(); }).catch(() => {});
  const evs = (await N.query({ kinds: [1], authors: [pk], limit: 30 }, 4500).catch(() => [])).sort((a, b) => b.created_at - a.created_at);
  if (!document.body.contains(posts)) return;
  const seen = new Set(); const frag = document.createDocumentFragment();
  for (const ev of evs) { if (seen.has(ev.id)) continue; seen.add(ev.id); frag.append(renderPost(ev)); }
  posts.append(frag); nPosts = seen.size >= 30 ? '30+' : seen.size; setCounts();
  postsStatus.textContent = seen.size ? '' : 'No posts yet.';
  N.wantProfiles(evs.map(e => e.pubkey));
}

// ---------- connect / discover ----------
function findForm() {
  const f = field({ id: 'find-input', label: 'Go to a person: paste their npub or a Birdline username', extra: { autocapitalize: 'none', spellcheck: 'false' } });
  const go = el('button', { type: 'submit', class: 'btn primary', id: 'find-go' }, 'Go');
  const form = el('form', { class: 'card form', id: 'find-form', novalidate: true }, f.node, go);
  form.addEventListener('submit', (e) => {
    e.preventDefault(); const v = f.input.value.trim(); f.setError('');
    if (!v) { f.setError('Paste an npub or type a username.'); f.input.focus(); return; }
    const pk = N.pubkeyFromAny(v); location.hash = pk ? `#/u/${N.npubOf(pk)}` : `#/@${U.normalizeUsername(v)}`;
  });
  return form;
}
function viewConnect(box) {
  setTitle('Connect');
  box.append(findForm(), el('section', { class: 'card', 'aria-labelledby': 'connect-soon' }, el('h2', { id: 'connect-soon', text: 'Coming soon' }),
    el('p', {}, 'Mentions, replies and who followed you will show up here.')));
}
function viewDiscover(box) {
  setTitle('Discover');
  box.append(el('section', { class: 'card', 'aria-labelledby': 'discover-soon' }, el('h2', { id: 'discover-soon', text: 'Coming soon' }),
    el('p', {}, 'Search, hashtags people are using right now, and people to follow will show up here. No algorithm: just counts, in the open.')));
}
function viewNotFound(box) { setTitle('Page not found'); box.append(el('p', {}, 'There’s nothing here. ', el('a', { href: state.me ? '#/home' : '#/signin' }, 'Go back home'))); }

// ---------- settings ----------
async function viewSettings(box) {
  setTitle('Settings');
  const me = state.me; const s = S.settings();
  // profile
  const cur = N.cachedProfile(me.pubkey) || {};
  const fName = field({ id: 'settings-name', label: 'Name', autocomplete: 'name', extra: { maxlength: 50 } }); fName.input.value = cur.display_name || cur.name || '';
  const fBio = field({ id: 'settings-bio', label: 'Bio', type: 'textarea', hint: 'Up to 160 characters.', extra: { maxlength: 160, rows: 3 } }); fBio.input.value = cur.about || '';
  const fSite = field({ id: 'settings-website', label: 'Website', type: 'url', autocomplete: 'url' }); fSite.input.value = cur.website || '';
  const fPic = field({ id: 'settings-picture', label: 'Profile picture address (https link to an image)', type: 'url' }); fPic.input.value = cur.picture || '';
  const save = el('button', { type: 'submit', class: 'btn primary', id: 'settings-save-profile' }, 'Save profile');
  const pform = el('form', { class: 'card form', id: 'settings-profile', 'aria-labelledby': 'settings-profile-title', novalidate: true },
    el('h2', { id: 'settings-profile-title', text: 'Profile' }), fName.node, fBio.node, fSite.node, fPic.node, save);
  pform.addEventListener('submit', async (e) => {
    e.preventDefault(); if (save.dataset.busy) return;
    for (const f of [fSite, fPic]) { f.setError(''); if (f.input.value.trim() && !U.safeUrl(f.input.value.trim())) { f.setError('Use a full link starting with https://'); f.input.focus(); announce('One thing to fix.'); return; } }
    setBusy(save, 'Saving…');
    try {
      await N.fetchProfile(me.pubkey).catch(() => null);
      const base = { ...(N.cachedProfile(me.pubkey) || {}) }; delete base.created_at; delete base.fetched;
      const next = { ...base, name: me.username || base.name, display_name: fName.input.value.trim(), about: fBio.input.value.trim(), website: fSite.input.value.trim(), picture: fPic.input.value.trim() };
      for (const k of Object.keys(next)) if (next[k] === '') delete next[k];
      const r = await N.publish({ kind: 0, content: JSON.stringify(next) });
      if (r.ok) N.rememberProfileEvent(r.event);
      announce(r.ok ? `Profile saved to ${r.ok} of ${r.total} relays.` : 'Not saved: no relay took it. Try again.');
    } catch (err) { announce('Not saved: ' + (err && err.message || err)); }
    finally { setBusy(save, null); }
  });

  // accessibility
  const hash = checkbox({ id: 'settings-hashtag', label: 'Read # as “hashtag”', checked: s.readHashAsHashtag, desc: 'Screen readers say “hashtag cats” instead of “number sign cats”.' });
  hash.input.addEventListener('change', () => { S.setSetting('readHashAsHashtag', hash.input.checked); announce(hash.input.checked ? 'Hashtags will be read as hashtag.' : 'Hashtags will be read as written.'); });
  const motion = el('fieldset', { class: 'radios', id: 'settings-motion' }, el('legend', { text: 'Reduce motion' }),
    ...[['system', 'Follow my device setting'], ['on', 'On: no animations'], ['off', 'Off']].map(([v, l]) => el('div', { class: 'check' },
      el('input', { type: 'radio', name: 'reduce-motion', id: `motion-${v}`, value: v, checked: s.reduceMotion === v }), el('label', { for: `motion-${v}`, text: l }))));
  motion.addEventListener('change', (e) => { S.setSetting('reduceMotion', e.target.value); applySettings(); });
  const access = el('section', { class: 'card form', id: 'settings-accessibility', 'aria-labelledby': 'settings-a11y-title' },
    el('h2', { id: 'settings-a11y-title', text: 'Accessibility' }), hash.node, motion,
    el('p', { class: 'hint' }, 'Coming later: open links in a reader-friendly view.'));

  // replies
  const rf = checkbox({ id: 'settings-reply-filter', label: 'Hide replies from accounts nobody you follow follows', checked: s.replyFilter, desc: 'Off means you see every reply, in order. This takes effect when replies arrive in a later version.' });
  rf.input.addEventListener('change', () => S.setSetting('replyFilter', rf.input.checked));
  const replies = el('section', { class: 'card form', id: 'settings-replies', 'aria-labelledby': 'settings-replies-title' }, el('h2', { id: 'settings-replies-title', text: 'Replies' }), rf.node);

  // account
  const acct = S.accountByPubkey(me.pubkey);
  const how = me.method === 'nip07' ? 'Your browser extension signs for you.' : acct && acct.synced ? 'Username and password on any device. Your locked key is saved on the relays.' : acct ? 'Username and password on this device only.' : 'A pasted key on this device.';
  const backup = el('button', { type: 'button', class: 'btn secondary', id: 'settings-backup' }, 'Download my locked key backup');
  backup.addEventListener('click', () => {
    if (!acct || !acct.ncryptsec) { announce('There’s no locked key on this device to back up.'); return; }
    const txt = `Birdline backup for @${me.username}\nAccount key (public): ${N.npubOf(me.pubkey)}\nLocked secret key (NIP-49, opens only with your password):\n${acct.ncryptsec}\n`;
    const a = el('a', { href: URL.createObjectURL(new Blob([txt], { type: 'text/plain' })), download: `birdline-${me.username || 'backup'}.txt` }); document.body.append(a); a.click(); a.remove();
    announce('Backup downloaded. It still needs your password to open.');
  });
  const reveal = el('button', { type: 'button', class: 'btn quiet', id: 'settings-reveal', 'aria-expanded': 'false', 'aria-controls': 'settings-secret' }, 'Show my secret key');
  const secretBox = el('p', { id: 'settings-secret', class: 'secret', hidden: true });
  reveal.addEventListener('click', () => {
    if (!state.skHex) { announce(me.method === 'nip07' ? 'Your extension holds your key, so Birdline can’t show it.' : 'Sign in with your password again to see your key.'); return; }
    if (secretBox.hidden && !window.confirm('Anyone with this key can post as you. Show it?')) return;
    secretBox.hidden = !secretBox.hidden; reveal.setAttribute('aria-expanded', String(!secretBox.hidden));
    secretBox.textContent = secretBox.hidden ? '' : nip19.nsecEncode(U.hexToBytesSafe(state.skHex));
    reveal.textContent = secretBox.hidden ? 'Show my secret key' : 'Hide my secret key';
  });
  const out = el('button', { type: 'button', class: 'btn secondary', id: 'settings-signout' }, 'Sign out'); out.addEventListener('click', signOut);
  const account = el('section', { class: 'card', id: 'settings-account', 'aria-labelledby': 'settings-account-title' },
    el('h2', { id: 'settings-account-title', text: 'Your account' }),
    el('p', {}, 'Username: ', el('strong', { text: me.username ? '@' + me.username : 'none yet' })),
    el('p', { class: 'npub' }, 'Account key: ', el('span', { text: N.npubOf(me.pubkey) })),
    el('p', {}, 'How you sign in: ' + how),
    el('div', { class: 'stack' }, backup, reveal, secretBox, out));

  // device
  const t = lastTimings().find(x => x.kind === 'unlock') || lastTimings()[0];
  const cost = acct && acct.ncryptsec ? (() => { try { return ncryptLogN(acct.ncryptsec); } catch { return null; } })() : null;
  const device = el('section', { class: 'card', id: 'settings-device', 'aria-labelledby': 'settings-device-title' },
    el('h2', { id: 'settings-device-title', text: 'This device' }),
    el('p', { id: 'settings-timing' }, t ? `Last time, ${t.kind === 'unlock' ? 'unlocking' : 'locking'} your key took ${(t.ms / 1000).toFixed(1)} seconds here${t.logN ? ` (password cost 2^${t.logN})` : ''}.` : 'No unlock timing recorded on this device yet.', cost ? ` Your saved key uses cost 2^${cost}.` : ''),
    el('p', {}, 'Relays: '), el('ul', { class: 'relays' }, ...N.relays.map(r => el('li', { text: r.replace('wss://', '') }))));
  box.append(pform, access, replies, account, device);
}

async function signOut() {
  await S.forgetSession(); N.clearSigner(); state.me = null; state.skHex = null; state.follows = [];
  location.hash = '#/signin'; setTimeout(() => announce('Signed out.'), 600);
}

// ---------- start ----------
async function start() {
  applySettings();
  if (window.matchMedia) window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applySettings);
  try {
    const s = await S.restoreSession();
    if (s && s.method === 'local' && s.skHex) { N.setLocalSigner(s.skHex); state.skHex = s.skHex; state.me = { pubkey: s.pubkey, username: s.username, method: 'local' }; }
    else if (s && s.method === 'nip07') {
      // the extension may load a moment after the page
      for (let i = 0; i < 10 && !window.nostr; i++) await new Promise(r => setTimeout(r, 100));
      if (window.nostr) { N.setExtensionSigner(); state.me = { pubkey: s.pubkey, username: s.username, method: 'nip07' }; }
    }
  } catch {}
  window.addEventListener('hashchange', route);
  await route();
}
start();
window.birdline = { version: '0.1.1', state: () => ({ signedIn: !!state.me, pubkey: state.me && state.me.pubkey, username: state.me && state.me.username }), timings: lastTimings };
