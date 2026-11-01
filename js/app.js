// Birdline app: router and views. All text goes in with textContent, never as markup, because a script injection here could steal a key.
import { nip19 } from '../vendor/nostr-tools-2.25.4.bundle.js?v=0.2.2';
import * as U from './util.js?v=0.2.2';
import * as S from './store.js?v=0.2.2';
import * as N from './nostr.js?v=0.2.2';
import { createLockedKey, unlockKey, lastTimings, ncryptLogN } from './crypto.js?v=0.2.2';

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

// the one h1: views move it into their main column, so keep hold of the element itself
const H1 = document.getElementById('view-title');

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
  if (!state.me && !PUBLIC.has(r.name) && r.name !== 'profile') { location.replace('#/'); return; }
  if (state.me && (r.name === '' || r.name === 'signin' || r.name === 'join')) { location.replace('#/home'); return; }
  const views = { '': viewWelcome, signin: viewSignIn, join: viewJoin, key: viewKey, home: viewHome, connect: viewConnect, notifications: viewConnect, messages: viewMessages, discover: viewDiscover, me: viewMe, settings: viewSettings, profile: viewProfile, post: viewPost };
  const view = views[r.name] || viewNotFound;
  const box = document.getElementById('view');
  closeMenu(false); closeAvatarMenu(false);
  box.replaceChildren(); resetTitle();
  box.className = PUBLIC.has(r.name) ? 'narrow-view' : '';
  document.body.dataset.route = r.name || 'signin';
  document.getElementById('tabbar').hidden = !state.me;
  document.getElementById('topbar-tools').hidden = !state.me;
  document.body.classList.toggle('signed-in', !!state.me);
  if (state.me) { paintTopbar(); if (!state.noteBadgeAt || Date.now() - state.noteBadgeAt > 60000) { state.noteBadgeAt = Date.now(); refreshNoteBadge(); } }
  const cur = r.name === 'notifications' ? 'connect' : r.name;
  for (const a of document.querySelectorAll('#tabbar a')) {
    const on = a.id === 'tab-' + (r.name === 'settings' || (r.name === 'profile' && state.me && isMe(r.who)) ? 'me' : cur);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  await view(box, r);
  if (!firstRender) { const h = H1; h.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  firstRender = false;
}
function setTitle(text) {
  H1.textContent = text;
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

function viewWelcome(box) {
  setTitle('Birdline');
  box.append(
    el('p', { class: 'lede' }, 'Birdline is a free, open-source app for reading and writing short posts on Nostr, an open social network. It is a personal project by Chaotic Carter, built screen-reader-first.'),
    el('section', { class: 'card', 'aria-labelledby': 'about-safe-title' },
      el('h2', { id: 'about-safe-title', text: 'How your key stays safe' }),
      el('ul', {},
        el('li', {}, 'Birdline has no server and no company behind it. It is a static page that talks straight to public Nostr relays.'),
        el('li', {}, 'Your Nostr key is created and encrypted on your own device. It is never sent anywhere, not even to Carter.'),
        el('li', {}, 'Birdline never asks for your email, your phone number, or a password from any other website. Do not use a password from another site here.'),
        el('li', {}, 'Birdline is not affiliated with Twitter, X, or any other company.')),
      el('p', {}, el('a', { href: 'https://github.com/2three1y/birdline' }, 'Read the source code on GitHub'))),
    el('section', { class: 'card join-cta', 'aria-labelledby': 'welcome-start-title' },
      el('h2', { id: 'welcome-start-title', text: 'Get started' }),
      el('p', {}, el('a', { href: '#/join', class: 'btn primary', id: 'welcome-join' }, 'Make a Birdline profile')),
      el('p', {}, el('a', { href: '#/signin', class: 'btn secondary', id: 'welcome-signin' }, 'I already have one'))));
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
        const { getPublicKey } = await import('../vendor/nostr-tools-2.25.4.bundle.js?v=0.2.2');
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

// ---------- icons (drawn for Birdline; every one is decorative, the words carry the meaning) ----------
const SVGNS = 'http://www.w3.org/2000/svg';
const ICONS = {
  home: 'M2.5 8.5 10 2.5l7.5 6M4.5 7v10h4v-5h3v5h4V7',
  bell: 'M5 14V9a5 5 0 0 1 10 0v5l1.5 2h-13zM8 17.5a2 2 0 0 0 4 0',
  mail: 'M2.5 5h15v10h-15zM2.5 5.5 10 11l7.5-5.5',
  hash: 'M8 3 6.5 17M13.5 3 12 17M3.5 7.5h14M2.5 12.5h14',
  person: 'M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 17.5c.8-3.4 3.6-5 7-5s6.2 1.6 7 5',
  search: 'M8.5 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12.5 12.5l5 5',
  quill: 'M16.5 2.5c-6 1-9.5 5-11 10.5M5.5 13 4 17.5M8 11l3-.5c3-1 5-4 5.5-8',
  reply: 'M8 4 3 9l5 5M3 9h8.5a5 5 0 0 1 5 5v2',
  repost: 'M4 9V7.5A2.5 2.5 0 0 1 6.5 5h9M13 2.5 15.5 5 13 7.5M16 11v1.5a2.5 2.5 0 0 1-2.5 2.5h-9M7 17.5 4.5 15 7 12.5',
  star: 'M10 2.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.3l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z',
  like: 'M10 16.8S2.5 12.2 2.5 7.2A3.8 3.8 0 0 1 10 5.6a3.8 3.8 0 0 1 7.5 1.6c0 5-7.5 9.6-7.5 9.6z',
  more: 'M4.5 10h.01M10 10h.01M15.5 10h.01',
};
function icon(name, cls = '') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
  s.setAttribute('class', `icon icon-${name} ${cls}`.trim());
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', ICONS[name]); s.append(p);
  return s;
}

/** Heart "Like" or star "Favorite", per Settings. */
function likeWord() { return S.settings().likeStyle === 'star' ? { word: 'Favorite', plural: 'Favorites', past: 'favorited', icon: 'star', did: 'Favorited' } : { word: 'Like', plural: 'Likes', past: 'liked', icon: 'like', did: 'Liked' }; }

// ---------- avatars ----------
function avatarNode(pk, size = 48, cls = 'avatar') {
  const prof = N.cachedProfile(pk) || {}; const pic = U.safeUrl(prof.picture); const d = displayFor(pk);
  const node = pic ? el('img', { class: cls, src: pic, alt: '', width: String(size), height: String(size), loading: 'lazy', referrerpolicy: 'no-referrer', 'data-avatar': pk })
    : el('span', { class: `${cls} initial`, 'aria-hidden': 'true', 'data-avatar': pk, text: (d.name[0] || '?').toUpperCase() });
  if (pic) node.addEventListener('error', () => node.replaceWith(el('span', { class: `${cls} initial`, 'aria-hidden': 'true', text: (d.name[0] || '?').toUpperCase() })), { once: true });
  return node;
}

// ---------- page shell: the three columns ----------
/** Builds the 2015-style page: left dashboard, the main column, right dashboard. The one h1 moves into the main column. */
function shell(box, { left = true, right = true, title = true } = {}) {
  const page = el('div', { class: 'page' });
  const grid = el('div', { class: `layout${right ? '' : ' no-right'}${left ? '' : ' no-left'}` });
  const center = el('div', { class: 'col-center', id: 'col-center' });
  const h = H1;
  if (title) center.append(el('div', { class: 'card page-head' }, h)); else { center.append(h); h.classList.add('visually-hidden'); }
  grid.append(center);
  let leftCol = null, rightCol = null;
  if (left) {
    leftCol = el('div', { class: 'col-left', id: 'col-left' }); grid.append(leftCol); leftCol.append(miniProfileCard());
    const unsub = N.onProfiles((got) => { const m = document.getElementById('mini-profile'); if (m && got.has(state.me.pubkey)) m.replaceWith(miniProfileCard()); }); onCleanup(unsub);
    if (!N.cachedProfile(state.me.pubkey)) N.wantProfiles([state.me.pubkey]);
  }
  if (right) { rightCol = el('div', { class: 'col-right', id: 'col-right' }); grid.append(rightCol); }
  page.append(grid); box.append(page);
  return { center, left: leftCol, right: rightCol };
}
function resetTitle() {
  const h = H1; h.className = ''; h.removeAttribute('aria-describedby');
  document.getElementById('main').prepend(h);
}

// ---------- left dashboard: your mini profile ----------
function miniProfileCard() {
  const pk = state.me.pubkey; const d = displayFor(pk); const prof = N.cachedProfile(pk) || {};
  const banner = U.safeUrl(prof.banner);
  const c = state.myCounts || {};
  const stat = (id, label, n, href) => el('li', {}, el('a', { href, id }, el('span', { class: 'stat-label', text: label }), ' ', el('span', { class: 'stat-num', text: n == null ? '…' : U.compactCount(n) })));
  const card = el('section', { class: 'card mini-profile', id: 'mini-profile', 'aria-labelledby': 'mini-profile-name' },
    el('div', { class: 'mini-banner', 'aria-hidden': 'true' }, banner ? el('img', { src: banner, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null),
    el('div', { class: 'mini-who' },
      el('a', { href: '#/me', class: 'mini-avatar-link', tabindex: '-1', 'aria-hidden': 'true' }, avatarNode(pk, 72, 'avatar mini-avatar')),
      el('h2', { id: 'mini-profile-name', class: 'mini-name' }, el('a', { href: '#/me' }, d.name)),
      el('p', { class: 'mini-handle' }, d.username ? `@${d.username}` : '', sr(' key '), el('span', { 'aria-hidden': 'true', text: d.username ? '·' : '' }), d.tail)),
    el('ul', { class: 'mini-stats', 'aria-label': 'Your counts' },
      stat('mini-count-posts', 'Tweets', c.posts, '#/me'),
      stat('mini-count-following', 'Following', state.followsFetched ? state.follows.length : c.following, '#/me'),
      stat('mini-count-followers', 'Followers', c.followers, '#/me')));
  if (!state.myCountsLoading && (!state.myCountsAt || Date.now() - state.myCountsAt > 120000)) loadMyCounts();
  return card;
}
async function loadMyCounts() {
  state.myCountsLoading = true; const pk = state.me.pubkey;
  try {
    const [posts, followers] = await Promise.all([
      N.query({ kinds: [1], authors: [pk], limit: 200 }, 4500).catch(() => []),
      N.query({ kinds: [3], '#p': [pk], limit: 500 }, 5000).catch(() => []),
      loadMyFollows()]);
    const np = new Set(posts.map(e => e.id)).size;
    state.myCounts = { posts: np >= 200 ? '200+' : np, followers: new Set(followers.map(e => e.pubkey)).size, following: state.follows.length };
    state.myCountsAt = Date.now();
  } finally { state.myCountsLoading = false; }
  const set = (id, v) => { const e = document.querySelector(`#${id} .stat-num`); if (e && v != null) e.textContent = U.compactCount(v); };
  set('mini-count-posts', state.myCounts.posts); set('mini-count-following', state.myCounts.following); set('mini-count-followers', state.myCounts.followers);
}

// ---------- trends + who to follow ----------
function trendsCard(events) {
  const list = el('ol', { class: 'trend-list', id: 'trends-list' });
  const note = el('p', { class: 'card-note', id: 'trends-note' });
  const card = el('section', { class: 'card side-card', id: 'trends', 'aria-labelledby': 'trends-title' },
    el('div', { class: 'side-head' }, el('h2', { id: 'trends-title', text: 'Trends' })), list, note);
  card.update = (evs) => {
    const top = U.topHashtags(evs, 6);
    list.replaceChildren(...top.map(t => el('li', {}, el('span', { class: 'trend-tag' }, S.settings().readHashAsHashtag ? [el('span', { 'aria-hidden': 'true', text: '#' }), sr('hashtag ')] : '#', t.tag), el('span', { class: 'trend-count', text: `${t.count} ${t.count === 1 ? 'Tweet' : 'Tweets'}` }))));
    note.textContent = top.length ? 'From the Tweets on your timeline. Wider trends are coming soon.' : 'Hashtags from your timeline will show here. Wider trends are coming soon.';
  };
  card.update(events || []);
  return card;
}
function whoToFollowCard() {
  const list = el('ul', { class: 'wtf-list', id: 'wtf-list' });
  const note = el('p', { class: 'card-note', id: 'wtf-note', text: 'Looking at who the people you follow follow…' });
  const refresh = el('button', { type: 'button', class: 'link-btn', id: 'wtf-refresh' }, 'Refresh');
  const card = el('section', { class: 'card side-card', id: 'who-to-follow', 'aria-labelledby': 'wtf-title' },
    el('div', { class: 'side-head' }, el('h2', { id: 'wtf-title', text: 'Who to follow' }), el('span', { 'aria-hidden': 'true', class: 'dot', text: '·' }), refresh), list, note);
  let offset = 0;
  async function draw(force) {
    await loadMyFollows();
    if (!state.follows.length) { list.replaceChildren(); note.textContent = 'Follow someone first, and people they follow will show up here.'; return; }
    if (force || !state.suggestions) {
      const lists = await N.query({ kinds: [3], authors: state.follows.slice(0, 40), limit: 40 }, 4500).catch(() => []);
      const newest = new Map(); for (const ev of lists) if (!newest.has(ev.pubkey) || newest.get(ev.pubkey).created_at < ev.created_at) newest.set(ev.pubkey, ev);
      state.suggestions = U.suggestFollows([...newest.values()], state.me.pubkey, state.follows, 30);
    }
    const pick = state.suggestions.filter(s => !state.follows.includes(s.pubkey));
    if (!document.body.contains(list)) return;
    if (!pick.length) { list.replaceChildren(); note.textContent = 'No suggestions right now.'; return; }
    const show = []; for (let i = 0; i < Math.min(3, pick.length); i++) show.push(pick[(offset + i) % pick.length]);
    note.textContent = '';
    list.replaceChildren(...show.map(s => {
      const d = displayFor(s.pubkey);
      const btn = followButton(s.pubkey, { small: true });
      return el('li', { class: 'wtf-item' }, el('a', { href: `#/u/${N.npubOf(s.pubkey)}`, tabindex: '-1', 'aria-hidden': 'true', class: 'wtf-avatar' }, avatarNode(s.pubkey, 48)),
        el('div', { class: 'wtf-body' },
          el('a', { href: `#/u/${N.npubOf(s.pubkey)}`, class: 'author' }, el('span', { class: 'author-name', text: d.name }), ' ', el('span', { class: 'author-handle' }, d.username ? `@${d.username}` : d.tail)),
          el('p', { class: 'wtf-why', text: `Followed by ${s.count} ${s.count === 1 ? 'person' : 'people'} you follow` }), btn));
    }));
    N.wantProfiles(show.map(s => s.pubkey));
  }
  refresh.addEventListener('click', async () => { offset += 3; setBusy(refresh, 'Refreshing…'); await draw(false); setBusy(refresh, null); announce('Suggestions refreshed.'); });
  draw(false).catch(() => { note.textContent = 'Couldn’t load suggestions.'; });
  const unsub = N.onProfiles(() => { if (document.body.contains(list) && state.suggestions) draw(false); }); onCleanup(unsub);
  return card;
}

// ---------- follow ----------
async function toggleFollow(pk) {
  const want = !state.follows.includes(pk);
  const newest = await N.fetchNewestFollowList(state.me.pubkey);
  const r = await N.publish(U.followTemplate(newest, pk, want));
  if (!r.ok) return { ok: false };
  N.rememberFollowList(r.event); state.follows = U.followsOf(r.event);
  if (state.myCounts) state.myCounts.following = state.follows.length;
  return { ok: true, following: want };
}
function followButton(pk, { small = false, id } = {}) {
  const nm = () => displayFor(pk).name;
  const btn = el('button', { type: 'button', id, class: 'btn follow-btn' + (small ? ' small' : '') });
  const paint = () => {
    const f = state.follows.includes(pk);
    btn.classList.toggle('following', f);
    btn.replaceChildren(f ? 'Unfollow' : 'Follow', small ? sr(' ' + nm()) : '');
  };
  paint();
  btn.addEventListener('click', async () => {
    if (btn.dataset.busy) return;
    const want = !state.follows.includes(pk);
    btn.dataset.busy = '1'; btn.setAttribute('aria-busy', 'true');
    try {
      const r = await toggleFollow(pk);
      if (!r.ok) { announce('That didn’t go through: no relay took the change. Try again.'); return; }
      announce(want ? `Now following ${nm()}.` : `Unfollowed ${nm()}.`);
      const fc = document.querySelector('#count-followers .stat-num'); if (fc && document.getElementById('profile-follow') === btn && /^\d+$/.test(fc.textContent)) fc.textContent = String(Number(fc.textContent) + (want ? 1 : -1));
      const mf = document.querySelector('#mini-count-following .stat-num'); if (mf) mf.textContent = String(state.follows.length);
    } catch (err) { announce('That didn’t go through: ' + (err && err.message || err)); }
    finally { delete btn.dataset.busy; btn.removeAttribute('aria-busy'); paint(); }
  });
  return btn;
}

// ---------- posts ----------
function displayFor(pk) { const p = N.cachedProfile(pk); return { name: U.displayNameOf(p, pk), ...U.handleOf(p, pk) }; }
function authorLine(pk) {
  const d = displayFor(pk);
  return el('a', { href: `#/u/${N.npubOf(pk)}`, class: 'author', 'data-pubkey': pk },
    el('span', { class: 'author-name', text: d.name }), ' ',
    el('span', { class: 'author-handle' }, d.username ? `@${d.username}` : '', sr(' key '), el('span', { 'aria-hidden': 'true', text: d.username ? '·' : '' }), d.tail));
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

// counts for the action buttons, shared by every copy of a post on the page
const events = new Map();      // id -> event (posts we've shown)
const tallies = new Map();     // id -> { replies, reposts, likes, myRepost, myLike }
const deletedByMe = new Set();
const touchedAt = new Map(); // id -> when you last pressed something on it here (stale relay answers don't undo your press)
let deletesLoaded = false;
async function loadTallies(ids) {
  ids = [...new Set(ids)].filter(Boolean); if (!ids.length || !state.me) return;
  if (!deletesLoaded) {
    deletesLoaded = true;
    const dels = await N.query({ kinds: [5], authors: [state.me.pubkey], limit: 300 }, 3500).catch(() => []);
    for (const d of dels) for (const t of d.tags) if (t[0] === 'e') deletedByMe.add(t[1]);
  }
  for (let i = 0; i < ids.length; i += 60) {
    const chunk = ids.slice(i, i + 60); const asked = Date.now();
    const evs = await N.query({ kinds: [1, 6, 7], '#e': chunk, limit: 1500 }, 4500).catch(() => []);
    const t = U.tallyActions(evs, chunk, state.me.pubkey, deletedByMe);
    for (const id of chunk) { if ((touchedAt.get(id) || 0) >= asked) continue; tallies.set(id, t[id]); paintActions(id); }
  }
}
function paintActions(id) {
  const t = tallies.get(id) || { replies: 0, reposts: 0, likes: 0 };
  for (const row of document.querySelectorAll(`.post-actions[data-for="${id}"]`)) {
    const set = (kind, word, n, pressed) => {
      const b = row.querySelector(`.act-${kind}`); if (!b) return;
      b.setAttribute('aria-label', U.actionLabel(word, n));
      b.querySelector('.act-count').textContent = n > 0 ? U.compactCount(n) : '';
      if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed));
    };
    set('reply', 'Reply', t.replies);
    set('repost', 'Retweet', t.reposts, t.myRepost);
    set('like', likeWord().word, t.likes, t.myLike);
  }
}
function bump(id, key, delta, mine) {
  touchedAt.set(id, Date.now());
  const t = { replies: 0, reposts: 0, likes: 0, myRepost: null, myLike: null, ...(tallies.get(id) || {}) };
  t[key] = Math.max(0, (t[key] || 0) + delta);
  if (mine !== undefined) t[key === 'likes' ? 'myLike' : 'myRepost'] = mine;
  tallies.set(id, t); paintActions(id);
}
let replySeq = 0;
function actionButton(kind, word, extra = {}) {
  return el('button', { type: 'button', class: `act act-${kind}`, 'aria-label': word, ...extra }, icon(kind === 'like' ? likeWord().icon : kind), el('span', { class: 'act-count', 'aria-hidden': 'true' }));
}
function actionRow(ev, art) {
  const row = el('div', { class: 'post-actions', role: 'group', 'aria-label': 'Tweet actions', 'data-for': ev.id });
  const reply = actionButton('reply', 'Reply', { 'aria-expanded': 'false' });
  const repost = actionButton('repost', 'Retweet', { 'aria-pressed': 'false' });
  const like = actionButton('like', likeWord().word, { 'aria-pressed': 'false' });
  const more = actionButton('more', 'More', { 'aria-expanded': 'false', 'aria-haspopup': 'true' });
  more.setAttribute('aria-label', 'More options');
  row.append(reply, repost, like, el('div', { class: 'menu-wrap' }, more));
  reply.addEventListener('click', () => toggleReplyBox(ev, art, reply));
  like.addEventListener('click', () => doLike(ev, like));
  repost.addEventListener('click', () => doRepost(ev, repost));
  more.addEventListener('click', () => toggleMoreMenu(ev, art, more));
  return row;
}
async function doLike(ev, btn) {
  if (btn.dataset.busy) return; btn.dataset.busy = '1';
  const t = tallies.get(ev.id) || {}; const nm = displayFor(ev.pubkey).name;
  try {
    if (t.myLike) {
      bump(ev.id, 'likes', -1, null); deletedByMe.add(t.myLike);
      const r = await N.publish(U.deleteTemplate([t.myLike], 7));
      if (!r.ok) { deletedByMe.delete(t.myLike); bump(ev.id, 'likes', 1, t.myLike); announce(`Couldn’t remove the ${likeWord().word.toLowerCase()}: no relay took it.`); return; }
      deletedByMe.add(t.myLike); announce(`Removed your ${likeWord().word.toLowerCase()} from ${nm}’s Tweet.`);
    } else {
      bump(ev.id, 'likes', 1, 'pending');
      const r = await N.publish(U.likeTemplate(ev));
      if (!r.ok) { bump(ev.id, 'likes', -1, null); announce(`Not ${likeWord().past}: no relay took it. Try again.`); return; }
      bump(ev.id, 'likes', 0, r.event.id); announce(`${likeWord().did} ${nm}’s Tweet.`);
    }
  } catch (err) { announce('That didn’t go through: ' + (err && err.message || err)); loadTallies([ev.id]); }
  finally { delete btn.dataset.busy; }
}
async function doRepost(ev, btn) {
  if (btn.dataset.busy) return; btn.dataset.busy = '1';
  const t = tallies.get(ev.id) || {}; const nm = displayFor(ev.pubkey).name;
  try {
    if (t.myRepost) {
      bump(ev.id, 'reposts', -1, null); deletedByMe.add(t.myRepost);
      const r = await N.publish(U.deleteTemplate([t.myRepost], 6));
      if (!r.ok) { deletedByMe.delete(t.myRepost); bump(ev.id, 'reposts', 1, t.myRepost); announce('Couldn’t undo the Retweet: no relay took it.'); return; }
      deletedByMe.add(t.myRepost); announce(`Undid your Retweet of ${nm}’s Tweet.`);
    } else {
      bump(ev.id, 'reposts', 1, 'pending');
      const r = await N.publish(U.repostTemplate(ev, N.relays[0]));
      if (!r.ok) { bump(ev.id, 'reposts', -1, null); announce('Not Retweeted: no relay took it. Try again.'); return; }
      bump(ev.id, 'reposts', 0, r.event.id); announce(`Retweeted ${nm}’s Tweet to your followers.`);
    }
  } catch (err) { announce('That didn’t go through: ' + (err && err.message || err)); loadTallies([ev.id]); }
  finally { delete btn.dataset.busy; }
}
function toggleReplyBox(ev, art, btn) {
  const open = art.querySelector(':scope > .post-body > .reply-box');
  if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-controls'); btn.focus(); return; }
  const nm = displayFor(ev.pubkey).name;
  const prefix = `reply-${++replySeq}`;
  const box = composeBox({
    prefix, label: `Reply to ${nm}`, placeholder: `Reply to ${nm}`, buttonText: 'Reply', cls: 'reply-box', alwaysOpen: true,
    template: (body) => U.replyTemplate(ev, body, N.relays[0]),
    onPosted: (reply, r) => {
      box.remove(); btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-controls');
      bump(ev.id, 'replies', 1); btn.focus();
      announce(`Reply sent to ${r.ok} of ${r.total} relays.`);
      if (state.onMyReply) state.onMyReply(reply);
    },
    onCancel: () => { box.remove(); btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-controls'); btn.focus(); },
  });
  box.id = prefix + '-form';
  btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-controls', box.id);
  art.querySelector(':scope > .post-body').append(box);
  box.querySelector('textarea').focus();
}
let openMenu = null;
function closeMenu(returnFocus) {
  if (!openMenu) return; const { list, btn } = openMenu; openMenu = null;
  list.remove(); btn.setAttribute('aria-expanded', 'false'); if (returnFocus) btn.focus();
}
document.addEventListener('click', (e) => { if (openMenu && !openMenu.wrap.contains(e.target)) closeMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openMenu) { e.preventDefault(); closeMenu(true); } });
function toggleMoreMenu(ev, art, btn) {
  if (openMenu && openMenu.btn === btn) { closeMenu(true); return; }
  closeMenu(false);
  const link = `${location.origin}${location.pathname}#/post/${ev.id}`;
  const copy = async (text, said) => { closeMenu(true); try { await navigator.clipboard.writeText(text); announce(said); } catch { announce('Couldn’t copy. ' + text); } };
  const items = [
    el('li', {}, el('a', { href: `#/post/${ev.id}`, class: 'menu-item' }, 'Open this Tweet and its replies')),
    el('li', {}, el('button', { type: 'button', class: 'menu-item', onclick: () => copy(link, 'Copied the link to this Tweet.') }, 'Copy link to Tweet')),
    el('li', {}, el('button', { type: 'button', class: 'menu-item', onclick: () => copy(N.neventOf(ev), 'Copied the Tweet’s Nostr ID.') }, 'Copy Nostr ID')),
  ];
  if (state.me && ev.pubkey === state.me.pubkey) items.push(el('li', {}, el('button', { type: 'button', class: 'menu-item danger', onclick: async () => {
    closeMenu(false);
    if (!window.confirm('Delete this Tweet? Relays that honor deletes will remove it.')) { btn.focus(); return; }
    const r = await N.publish(U.deleteTemplate([ev.id], 1)).catch(() => ({ ok: 0 }));
    if (!r.ok) { announce('Not deleted: no relay took it.'); btn.focus(); return; }
    const next = art.nextElementSibling && art.nextElementSibling.querySelector('.post-author');
    for (const a of document.querySelectorAll(`.post[data-id="${ev.id}"]`)) a.remove();
    announce('Tweet deleted.'); if (next) next.focus(); else H1.focus();
  } }, 'Delete Tweet')));
  const list = el('ul', { class: 'menu', id: `menu-${ev.id.slice(0, 8)}-${++replySeq}` }, ...items);
  const wrap = btn.parentElement; wrap.append(list);
  btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-controls', list.id);
  openMenu = { list, btn, wrap };
  list.querySelector('.menu-item').focus();
}

/** One post: heading (name + handle), time, text, action row. `context` is a "X reposted" line. */
function renderPost(ev, { context, big = false } = {}) {
  events.set(ev.id, ev);
  const when = U.relativeTime(ev.created_at);
  const full = U.fullDate(ev.created_at);
  const long = !big && U.countChars(ev.content) > 280;
  const body = el('p', { class: 'post-text' }, textNodes(long ? Array.from(ev.content).slice(0, 280).join('') + '…' : ev.content));
  const art = el('article', { class: 'post' + (big ? ' post-big' : ''), 'data-id': ev.id, 'data-pubkey': ev.pubkey });
  if (context) art.append(context);
  const inner = el('div', { class: 'post-body' });
  art.append(el('a', { href: `#/u/${N.npubOf(ev.pubkey)}`, class: 'post-avatar', tabindex: '-1', 'aria-hidden': 'true' }, avatarNode(ev.pubkey, 48)), inner);
  inner.append(el('div', { class: 'post-header' },
    el('h2', { class: 'post-author', tabindex: '-1' }, authorLine(ev.pubkey)),
    el('span', { class: 'post-time' }, el('span', { 'aria-hidden': 'true', text: '·' }), ' ',
      el('a', { href: `#/post/${ev.id}`, class: 'time-link' }, el('time', { datetime: new Date(ev.created_at * 1000).toISOString(), title: full }, el('span', { 'aria-hidden': 'true', text: when.short }), sr(`${when.long}, ${full}`))))));
  if (U.isReply(ev)) {
    const p = ev.tags.find(t => t[0] === 'p' && t[1] !== ev.pubkey);
    const target = U.replyTargetOf(ev);
    inner.append(el('p', { class: 'reply-context' }, target ? el('a', { href: `#/post/${target}` }, p ? `Replying to ${displayFor(p[1]).name}` : 'Reply') : (p ? `Replying to ${displayFor(p[1]).name}` : 'Reply')));
  }
  inner.append(body);
  if (long) {
    const more = el('button', { type: 'button', class: 'link-btn', 'aria-expanded': 'false' }, 'Show more');
    more.addEventListener('click', () => { body.replaceChildren(...textNodes(ev.content)); more.remove(); announce('Showing the whole Tweet.'); });
    inner.append(more);
  }
  if (state.me) inner.append(actionRow(ev, art));
  if (tallies.has(ev.id)) queueMicrotask(() => paintActions(ev.id));
  return art;
}
/** A kind 1 as-is, or a kind 6 unwrapped with a "Name reposted" line. Returns null when there's nothing to show. */
function renderAny(ev) {
  if (ev.kind === 6 || ev.kind === 16) {
    const inner = U.repostedEvent(ev);
    if (!inner || inner.kind !== 1) return null;
    const ctx = el('p', { class: 'post-context' }, icon('repost'), ' ', el('a', { href: `#/u/${N.npubOf(ev.pubkey)}`, 'data-pubkey': ev.pubkey, class: 'reposter' }, state.me && ev.pubkey === state.me.pubkey ? 'You Retweeted' : `${displayFor(ev.pubkey).name} Retweeted`));
    const art = renderPost(inner, { context: ctx });
    art.dataset.repost = ev.id;
    return art;
  }
  return renderPost(ev);
}
function refreshNames(root, got) {
  for (const a of root.querySelectorAll('[data-pubkey].author')) {
    if (got && !got.has(a.dataset.pubkey)) continue;
    a.replaceWith(authorLine(a.dataset.pubkey));
  }
  for (const a of root.querySelectorAll('[data-avatar]')) {
    if (got && !got.has(a.dataset.avatar)) continue;
    const size = a.getAttribute('width') || (a.classList.contains('mini-avatar') ? 72 : 48);
    a.replaceWith(avatarNode(a.dataset.avatar, Number(size), a.className.replace(/\s*initial\b/, '')));
  }
  for (const a of root.querySelectorAll('a.reposter')) {
    if (got && !got.has(a.dataset.pubkey)) continue;
    if (!(state.me && a.dataset.pubkey === state.me.pubkey)) a.textContent = `${displayFor(a.dataset.pubkey).name} Retweeted`;
  }
}

// ---------- compose ----------
/** A compose form. The home one is "compose-…" (ids kept from v0.1); replies and the pop-up get their own prefix. */
function composeBox({ prefix = 'compose', label = 'What’s happening?', placeholder = 'What’s happening?', buttonText = 'Tweet', cls = 'compose-home', template, onPosted, onCancel, alwaysOpen = false } = {}) {
  const text = el('textarea', { id: `${prefix}-text`, rows: '1', 'aria-describedby': `${prefix}-count-desc`, autocapitalize: 'sentences', placeholder });
  const count = el('span', { id: `${prefix}-count`, class: 'count', 'aria-hidden': 'true', text: String(U.POST_LIMIT) });
  const desc = el('span', { id: `${prefix}-count-desc`, class: 'visually-hidden', text: U.charsLeftLabel(U.POST_LIMIT) });
  const send = el('button', { type: 'submit', class: 'btn primary', id: `${prefix}-send` }, prefix.endsWith('compose') ? [icon('quill'), ' ', buttonText] : buttonText);
  const cancel = onCancel ? el('button', { type: 'button', class: 'btn plain', id: `${prefix}-cancel` }, 'Cancel') : null;
  const form = el('form', { id: `${prefix}-form`, class: `compose ${cls}${alwaysOpen ? ' open' : ''}`, novalidate: true },
    state.me ? el('span', { class: 'compose-avatar', 'aria-hidden': 'true' }, avatarNode(state.me.pubkey, 32, 'avatar small-avatar')) : null,
    el('div', { class: 'compose-main' },
      el('label', { for: `${prefix}-text`, id: `${prefix}-label`, class: 'visually-hidden', text: label }), text,
      el('div', { class: 'compose-bar' }, count, desc, cancel, send)));
  let prevLeft = U.POST_LIMIT;
  function update() {
    const left = U.POST_LIMIT - U.countChars(text.value);
    count.textContent = String(left);
    count.className = 'count' + (left < 0 ? ' over' : left <= 10 ? ' near' : '');
    desc.textContent = U.charsLeftLabel(left);
    const say = U.counterAnnouncement(prevLeft, left); if (say) announce(say);
    prevLeft = left;
    form.classList.toggle('has-text', !!text.value);
    text.style.height = 'auto'; if (form.classList.contains('open') || text.value) text.style.height = Math.max(text.scrollHeight + 2, 0) + 'px';
  }
  text.addEventListener('focus', () => { form.classList.add('open'); });
  text.addEventListener('input', update);
  form.addEventListener('focusout', () => setTimeout(() => { if (!alwaysOpen && !form.contains(document.activeElement) && !text.value) { form.classList.remove('open'); text.style.height = ''; } }, 0));
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === 'Escape' && onCancel && !text.value) { e.preventDefault(); onCancel(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (send.dataset.busy) return;
    const body = text.value.trim(); const n = U.countChars(body);
    if (!n) { announce('Write something first.'); text.focus(); return; }
    if (n > U.POST_LIMIT) { announce(`Too long by ${n - U.POST_LIMIT}. Tweets can be ${U.POST_LIMIT} characters.`); text.focus(); return; }
    setBusy(send, prefix.endsWith('compose') ? 'Tweeting…' : 'Sending…');
    try {
      const tpl = template ? template(body) : { kind: 1, content: body, tags: U.hashtagsOf(body).map(t => ['t', t]) };
      const r = await N.publish(tpl);
      if (!r.ok) { announce('Not sent: no relay took it. Your text is still in the box.'); return; }
      text.value = ''; prevLeft = U.POST_LIMIT; update();
      if (state.myCounts && typeof state.myCounts.posts === 'number') state.myCounts.posts++;
      if (!template && prefix === 'compose') announce(`Tweeted to ${r.ok} of ${r.total} relays.`);
      onPosted && onPosted(r.event, r);
      if (!template && document.body.contains(text)) text.focus();
    } catch (err) { announce('Not sent: ' + (err && err.message || err)); }
    finally { setBusy(send, null); }
  });
  return form;
}
/** The top bar's "Post" button: a pop-up compose box (the home one gets focus instead when it's on screen). */
function openComposeDialog(opener) {
  const homeBox = document.getElementById('compose-text');
  if (homeBox && homeBox.offsetParent) { homeBox.focus(); homeBox.scrollIntoView({ block: 'center' }); return; }
  const dlg = el('dialog', { id: 'compose-dialog', class: 'compose-dialog', 'aria-labelledby': 'compose-dialog-title' });
  const close = () => { dlg.close(); };
  dlg.append(el('div', { class: 'dialog-head' }, el('h2', { id: 'compose-dialog-title', text: 'Compose new Tweet' }),
    el('button', { type: 'button', class: 'btn plain', id: 'compose-dialog-close', onclick: close }, 'Close')),
    composeBox({ prefix: 'dialog-compose', cls: 'compose-dialog-form', alwaysOpen: true, onPosted: (ev, r) => { close(); announce(`Tweeted to ${r.ok} of ${r.total} relays.`); } }));
  dlg.addEventListener('close', () => { dlg.remove(); if (opener) opener.focus(); });
  document.body.append(dlg); dlg.showModal(); dlg.querySelector('textarea').focus();
}

// ---------- home ----------
async function viewHome(box) {
  setTitle('Home');
  const me = state.me.pubkey;
  const { center, left, right } = shell(box, { title: false });
  const seen = new Set(); const shownInner = new Set(); let pending = []; let oldest = Infinity; const loaded = [];
  const timeline = el('div', { id: 'timeline', class: 'timeline' });
  const newBtn = el('button', { type: 'button', class: 'new-posts', id: 'new-posts', hidden: true });
  const status = el('p', { class: 'status', id: 'timeline-status', text: 'Loading your timeline…' });
  const more = el('button', { type: 'button', class: 'load-more', id: 'timeline-older', hidden: true }, 'Load older Tweets');
  const trends = trendsCard([]);
  left.append(trends);
  right.append(whoToFollowCard());
  const place = (ev, where) => {
    const inner = (ev.kind === 6 || ev.kind === 16) ? U.repostedEvent(ev) : ev;
    const key = inner ? inner.id : ev.id;
    if (shownInner.has(key)) return null;
    const node = renderAny(ev); if (!node) return null;
    shownInner.add(key); loaded.push(inner || ev);
    if (where === 'top') timeline.prepend(node); else timeline.append(node);
    return node;
  };
  const showMine = (ev) => {
    seen.add(ev.id); pending = pending.filter(p => p.id !== ev.id); updateNew();
    if (!timeline.querySelector(`[data-id="${ev.id}"]`)) place(ev, 'top');
    status.textContent = ''; trends.update(loaded);
  };
  state.onMyReply = showMine; onCleanup(() => { state.onMyReply = null; });
  const compose = composeBox({ onPosted: showMine });
  const stream = el('div', { class: 'card stream' }, compose, newBtn, status, timeline, more);
  if (state.justJoined) {
    const j = state.justJoined; state.justJoined = null;
    const lines = [`Your profile reached ${j.ok} of ${j.total} relays${j.slow ? ` (${j.slow === 1 ? 'one' : j.slow} didn’t answer in time, but may have it)` : ''}.`];
    if (j.syncedOk === 0) lines.push('Signing in on other devices may not work yet, because no relay took your locked key. Try again from Settings later.');
    center.append(el('section', { class: 'card notice', id: 'welcome', 'aria-labelledby': 'welcome-title' },
      el('h2', { id: 'welcome-title', text: `Welcome, ${j.name}!` }),
      el('p', {}, lines.join(' ')),
      el('p', {}, 'Your timeline shows Tweets from people you follow, newest first. Find someone on ', el('a', { href: '#/discover' }, 'Discover'), ', or save a backup of your key in ', el('a', { href: '#/settings' }, 'Settings'), '.')));
    setTimeout(() => announce(`Account created. ${lines[0]}`), 900);
  }
  center.append(stream);

  let lastAnnounce = 0; let announceLater = null;
  function updateNew() {
    newBtn.hidden = !pending.length;
    newBtn.textContent = `Show ${pending.length} new Tweet${pending.length === 1 ? '' : 's'}`;
    if (!pending.length) return;
    const say = () => { lastAnnounce = Date.now(); announce(pending.length === 1 ? '1 new Tweet. Show it with the button above your timeline.' : `${pending.length} new Tweets. Show them with the button above your timeline.`); };
    const wait = 30000 - (Date.now() - lastAnnounce);
    if (wait <= 0) say(); else if (!announceLater) announceLater = setTimeout(() => { announceLater = null; if (pending.length) say(); }, wait);
  }
  onCleanup(() => clearTimeout(announceLater));
  newBtn.addEventListener('click', () => {
    const add = pending.sort((a, b) => a.created_at - b.created_at); pending = [];
    let firstNode = null; for (const ev of add) { const n = place(ev, 'top'); if (n) firstNode = n; }
    updateNew(); status.textContent = ''; trends.update(loaded);
    const first = (firstNode || timeline).querySelector('.post-author'); if (first) first.focus();
    N.wantProfiles(add.map(e => e.pubkey)); loadTallies(add.map(e => (U.repostedEvent(e) || e).id));
  });

  const unsub = N.onProfiles((got) => refreshNames(box, got)); onCleanup(unsub);

  if (N.cachedFollowList(me)) { state.follows = U.followsOf(N.cachedFollowList(me)); loadMyFollows(); } else await loadMyFollows();
  const authors = [me, ...state.follows].slice(0, 500);
  const nowSec = Math.floor(Date.now() / 1000);
  async function load(until) {
    const f = { kinds: [1, 6], authors, limit: 40 }; if (until) f.until = until;
    const evs = (await N.query(f, 4500).catch(() => [])).filter(e => !seen.has(e.id) && e.created_at <= nowSec + 120).sort((a, b) => b.created_at - a.created_at);
    let n = 0; const ids = []; const pks = [];
    for (const ev of evs) {
      seen.add(ev.id); oldest = Math.min(oldest, ev.created_at);
      const node = place(ev, 'bottom'); if (!node) continue; n++;
      ids.push(node.dataset.id); pks.push(node.dataset.pubkey, ev.pubkey);
    }
    N.wantProfiles(pks); loadTallies(ids); trends.update(loaded);
    return n;
  }
  const n = await load();
  if (!document.body.contains(timeline)) return;
  if (!n) {
    status.replaceChildren(state.follows.length ? 'No Tweets yet from the people you follow.' : 'Your timeline is quiet because you don’t follow anyone yet. ',
      state.follows.length ? '' : el('a', { href: '#/discover' }, 'Find people to follow'));
  } else { status.textContent = ''; more.hidden = false; }
  more.addEventListener('click', async () => {
    setBusy(more, 'Loading…'); const got = await load(oldest - 1); setBusy(more, null);
    announce(got ? `${got} older Tweets added at the bottom.` : 'No older Tweets found.'); if (!got) more.hidden = true;
  });
  const sub = N.pool.subscribeMany(N.relays, { kinds: [1, 6], authors, since: nowSec }, {
    onevent(ev) {
      if (seen.has(ev.id)) return; seen.add(ev.id);
      if (ev.created_at > Math.floor(Date.now() / 1000) + 120) return;
      if (ev.pubkey === me) { showMine(ev); return; } // your own posts show right away
      pending.push(ev); updateNew(); N.wantProfiles([ev.pubkey]);
    },
  });
  onCleanup(() => sub.close());
}

// ---------- my follow list ----------
async function loadMyFollows() {
  if (!state.me) return;
  const cached = N.cachedFollowList(state.me.pubkey);
  if (cached) state.follows = U.followsOf(cached);
  if (state.followsFetched && cached) return;
  const f = await N.fetchNewestFollowList(state.me.pubkey).catch(() => null);
  if (f) state.follows = U.followsOf(f);
  state.followsFetched = true;
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
  const status = el('p', { class: 'status page-status', id: 'profile-status', text: 'Looking for this person on the relays…' });
  box.append(status);
  const pk = await resolveWho(r.who || '');
  if (!document.body.contains(status)) return;
  if (!pk) { setTitle('Person not found'); status.textContent = `No one called ${r.who} was found. Check the spelling, or paste their npub on Discover.`; return; }
  const mine = state.me && state.me.pubkey === pk;
  if (state.me && !mine) await loadMyFollows();
  status.remove();
  let prof = N.cachedProfile(pk);
  const h1 = H1;
  // canopy: banner, then the stats bar with the big avatar and the follow button
  const bannerBox = el('div', { class: 'canopy-banner', 'aria-hidden': 'true' });
  const avatarBox = el('div', { class: 'canopy-avatar', 'aria-hidden': 'true' });
  const statN = (id, label) => el('li', { id, class: 'stat' }, el('span', { class: 'stat-label', text: label }), ' ', el('span', { class: 'stat-num', text: '…' }));
  const stats = el('ul', { class: 'profile-stats', id: 'profile-counts', 'aria-label': 'Counts' },
    statN('count-posts', 'Tweets'), statN('count-following', 'Following'), statN('count-followers', 'Followers'), statN('count-likes', likeWord().plural));
  const actionsBox = el('div', { class: 'profile-actions', id: 'profile-actions' });
  const canopy = el('div', { class: 'canopy' }, bannerBox, el('div', { class: 'canopy-bar' }, el('div', { class: 'canopy-inner' }, avatarBox, stats, actionsBox)));
  // left: who they are
  const info = el('section', { class: 'card profile profile-info', id: 'profile-header', 'aria-label': 'Profile details' });
  // center: tabs
  const tabs = [['posts', 'Tweets'], ['replies', 'Tweets & replies'], ['likes', likeWord().plural]];
  const tablist = el('div', { role: 'tablist', class: 'profile-tabs', id: 'profile-tabs', 'aria-label': 'Show' });
  const panel = el('div', { role: 'tabpanel', id: 'profile-panel', class: 'profile-panel', tabindex: '-1' });
  const posts = el('div', { id: 'profile-posts', class: 'timeline' });
  const postsStatus = el('p', { class: 'status', id: 'profile-posts-status', text: 'Loading Tweets…' });
  panel.append(postsStatus, posts);
  const tabBtns = tabs.map(([key, label], i) => el('button', { type: 'button', role: 'tab', id: `profile-tab-${key}`, 'aria-controls': 'profile-panel', 'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1', 'data-tab': key }, label));
  tablist.append(...tabBtns);
  const page = el('div', { class: 'page profile-page' });
  const grid = el('div', { class: 'layout' });
  const leftCol = el('div', { class: 'col-left' }, info);
  const center = el('div', { class: 'col-center' }, el('div', { class: 'card stream' }, tablist, panel));
  const rightCol = el('div', { class: 'col-right' });
  grid.append(leftCol, center, rightCol); page.append(grid);  // name and bio first, then the tabs, for screen readers too
  box.append(canopy, page);
  if (state.me) rightCol.append(whoToFollowCard());

  function drawHeader() {
    const d = displayFor(pk); prof = N.cachedProfile(pk) || {};
    setTitle(d.name);
    const banner = U.safeUrl(prof.banner);
    const site = U.safeUrl(prof.website);
    bannerBox.replaceChildren(banner ? el('img', { src: banner, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : '');
    avatarBox.replaceChildren(avatarNode(pk, 200, 'avatar big-avatar'));
    info.replaceChildren(...[
      h1,
      el('p', { class: 'handle', id: 'profile-handle' }, d.username ? `@${d.username}` : '', sr(' key '), el('span', { 'aria-hidden': 'true', text: d.username ? '·' : '' }), d.tail),
      prof.about ? el('p', { class: 'bio', id: 'profile-bio' }, textNodes(String(prof.about).slice(0, 500))) : el('p', { class: 'bio muted', id: 'profile-bio', text: mine ? 'No bio yet. Add one in Settings.' : 'No bio yet.' }),
      site ? el('p', { class: 'website' }, el('a', { href: site, target: '_blank', rel: 'noopener noreferrer me', id: 'profile-website' }, site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))) : null,
      el('div', { class: 'profile-more' }, ...infoButtons())].filter(Boolean));
    h1.className = 'profile-name';
    if (!actionsBox.firstChild || actionsBox.dataset.drawn !== '1') { actionsBox.replaceChildren(...mainActions()); actionsBox.dataset.drawn = '1'; }
  }
  function infoButtons() {
    const copy = el('button', { type: 'button', class: 'link-btn', id: 'profile-copy-npub' }, 'Copy account key (npub)');
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(N.npubOf(pk)); announce('Copied the account key.'); } catch { announce('Couldn’t copy. The key is ' + N.npubOf(pk)); } });
    if (mine) { const out = el('button', { type: 'button', class: 'link-btn', id: 'profile-signout' }, 'Sign out'); out.addEventListener('click', signOut); return [copy, out]; }
    return [copy];
  }
  function mainActions() {
    if (mine) return [el('a', { class: 'btn secondary', href: '#/settings', id: 'profile-settings' }, 'Edit profile and settings')];
    if (!state.me) return [el('a', { class: 'btn primary', href: '#/signin' }, 'Sign in to follow')];
    return [followButton(pk, { id: 'profile-follow' })];
  }
  drawHeader();
  const unsub = N.onProfiles((got) => { if (got.has(pk)) drawHeader(); refreshNames(page, got); }); onCleanup(unsub);
  if (!prof || !prof.fetched) N.fetchProfile(pk).then(() => { if (document.body.contains(info)) drawHeader(); });
  const setStat = (id, v) => { const e = document.querySelector(`#${id} .stat-num`); if (e && v != null) e.textContent = U.compactCount(v); };
  N.fetchNewestFollowList(pk).then(f => setStat('count-following', U.followsOf(f).length));
  N.query({ kinds: [3], '#p': [pk], limit: 500 }, 5000).then(evs => setStat('count-followers', new Set(evs.map(e => e.pubkey)).size)).catch(() => {});
  N.query({ kinds: [7], authors: [pk], limit: 300 }, 5000).then(evs => { const n = new Set(evs.filter(e => e.content !== '-').map(e => U.reactionTargetOf(e))).size; setStat('count-likes', n >= 300 ? '300+' : n); }).catch(() => {});

  // the posts behind each tab (loaded once, then just redrawn)
  let all = null; let likes = null; let current = 'posts';
  let allP = null, likesP = null;
  function getAll() { return allP || (allP = getAll1()); }
  function getLikes() { return likesP || (likesP = getLikes1()); }
  async function getAll1() {
    if (all) return all;
    const evs = (await N.query({ kinds: [1, 6], authors: [pk], limit: 60 }, 4500).catch(() => [])).sort((a, b) => b.created_at - a.created_at);
    const seen = new Set(); all = evs.filter(e => !seen.has(e.id) && seen.add(e.id));
    const n = all.filter(e => e.kind === 1).length; setStat('count-posts', n >= 60 ? '60+' : n);
    return all;
  }
  async function getLikes1() {
    if (likes) return likes;
    const rs = (await N.query({ kinds: [7], authors: [pk], limit: 40 }, 4500).catch(() => [])).filter(e => e.content !== '-').sort((a, b) => b.created_at - a.created_at);
    const ids = [...new Set(rs.map(e => U.reactionTargetOf(e)).filter(Boolean))].slice(0, 40);
    const got = ids.length ? await N.query({ ids, kinds: [1] }, 4500).catch(() => []) : [];
    const byId = new Map(got.map(e => [e.id, e])); likes = ids.map(id => byId.get(id)).filter(Boolean);
    return likes;
  }
  async function show(tab) {
    current = tab; posts.replaceChildren(); postsStatus.textContent = 'Loading Tweets…';
    const list = tab === 'likes' ? await getLikes() : (await getAll()).filter(e => tab === 'replies' || e.kind === 6 || !U.isReply(e));
    if (current !== tab || !document.body.contains(posts)) return;
    const frag = document.createDocumentFragment(); const ids = []; const pks = []; const shown = new Set();
    for (const ev of list) { const inner = ev.kind === 6 ? U.repostedEvent(ev) : ev; if (!inner || shown.has(inner.id)) continue; const node = renderAny(ev); if (!node) continue; shown.add(inner.id); frag.append(node); ids.push(node.dataset.id); pks.push(node.dataset.pubkey, ev.pubkey); }
    posts.append(frag);
    postsStatus.textContent = shown.size ? '' : (tab === 'likes' ? `No ${likeWord().plural.toLowerCase()} yet.` : 'No Tweets yet.');
    N.wantProfiles(pks); loadTallies(ids);
  }
  function select(btn, focus) {
    for (const b of tabBtns) { const on = b === btn; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    panel.setAttribute('aria-labelledby', btn.id);
    if (focus) btn.focus();
    show(btn.dataset.tab);
  }
  tablist.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) select(b, false); });
  tablist.addEventListener('keydown', (e) => {
    const i = tabBtns.indexOf(document.activeElement); if (i < 0) return;
    const go = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabBtns.length - 1 }[e.key];
    if (go === undefined) return; e.preventDefault(); select(tabBtns[(go + tabBtns.length) % tabBtns.length], true);
  });
  panel.setAttribute('aria-labelledby', tabBtns[0].id);
  await show('posts');
}

// ---------- one post and its replies ----------
async function viewPost(box, r) {
  setTitle('Tweet');
  const { center } = shell(box, { right: false });
  const status = el('p', { class: 'status', id: 'post-status', text: 'Loading the Tweet…' });
  const holder = el('div', { class: 'card stream' }, status);
  center.append(holder);
  const id = String(r.arg || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) { status.textContent = 'That Tweet link isn’t right.'; return; }
  const ev = events.get(id) || (await N.query({ ids: [id] }, 4500).catch(() => []))[0];
  if (!document.body.contains(status)) return;
  if (!ev) { status.textContent = 'This Tweet wasn’t found on your relays. It may have been deleted.'; return; }
  setTitle(`Tweet by ${displayFor(ev.pubkey).name}`);
  status.remove();
  const target = U.isReply(ev) ? U.replyTargetOf(ev) : null;
  if (target) holder.append(el('p', { class: 'thread-up' }, el('a', { href: `#/post/${target}` }, 'Show the Tweet this replies to')));
  holder.append(renderPost(ev, { big: true }));
  const repliesHead = el('h2', { class: 'section-label', id: 'replies-title', text: 'Replies' });
  const replies = el('div', { class: 'timeline', id: 'post-replies', 'aria-labelledby': 'replies-title', role: 'region' });
  const rs = el('p', { class: 'status', id: 'post-replies-status', text: 'Loading replies…' });
  holder.append(repliesHead, rs, replies);
  state.onMyReply = (reply) => { if (U.replyTargetOf(reply) === ev.id) { replies.prepend(renderPost(reply)); rs.textContent = ''; } };
  onCleanup(() => { state.onMyReply = null; });
  const unsub = N.onProfiles((got) => refreshNames(holder, got)); onCleanup(unsub);
  const evs = (await N.query({ kinds: [1], '#e': [ev.id], limit: 100 }, 4500).catch(() => [])).filter(e => U.replyTargetOf(e) === ev.id).sort((a, b) => a.created_at - b.created_at);
  if (!document.body.contains(replies)) return;
  const seen = new Set(); for (const e of evs) { if (seen.has(e.id)) continue; seen.add(e.id); replies.append(renderPost(e)); }
  rs.textContent = seen.size ? '' : 'No replies yet.';
  N.wantProfiles([ev.pubkey, ...evs.map(e => e.pubkey)]); loadTallies([ev.id, ...seen]);
}

// ---------- notifications (the old "Connect") ----------
const NOTE_KEY = 'birdline.notes.seen';
function notesSeen() { return Number(localStorage.getItem(NOTE_KEY + ':' + (state.me && state.me.pubkey)) || 0); }
async function refreshNoteBadge() {
  if (!state.me) return;
  const since = notesSeen() || Math.floor(Date.now() / 1000) - 7 * 86400;
  const evs = await N.query({ kinds: [1, 6, 7], '#p': [state.me.pubkey], since: since + 1, limit: 100 }, 4500).catch(() => []);
  const n = new Set(evs.filter(e => e.pubkey !== state.me.pubkey && !deletedByMe.has(e.id)).map(e => e.id)).size;
  setBadge('badge-connect', n);
}
function setBadge(id, n) {
  const b = document.getElementById(id); if (!b) return;
  b.hidden = !n; b.replaceChildren(n ? sr(', ') : '', n ? String(n > 99 ? '99+' : n) : '', n ? sr(' new') : '');
}
async function viewConnect(box) {
  setTitle('Notifications');
  const { center, right } = shell(box);
  right.append(findCard(), whoToFollowCard());
  const list = el('div', { class: 'timeline notes', id: 'notes' });
  const status = el('p', { class: 'status', id: 'notes-status', text: 'Loading your notifications…' });
  center.append(el('div', { class: 'card stream' }, status, list));
  const me = state.me.pubkey; const seenAt = notesSeen();
  const evs = (await N.query({ kinds: [1, 6, 7], '#p': [me], limit: 60 }, 4500).catch(() => [])).filter(e => e.pubkey !== me).sort((a, b) => b.created_at - a.created_at);
  if (!document.body.contains(list)) return;
  localStorage.setItem(NOTE_KEY + ':' + me, String(Math.floor(Date.now() / 1000))); setBadge('badge-connect', 0);
  const seen = new Set(); const ids = []; const pks = [];
  for (const ev of evs) {
    if (seen.has(ev.id)) continue; seen.add(ev.id); pks.push(ev.pubkey);
    const who = displayFor(ev.pubkey).name; const isNew = ev.created_at > seenAt;
    if (ev.kind === 1) {
      const node = renderPost(ev, { context: el('p', { class: 'post-context' }, icon(U.isReply(ev) ? 'reply' : 'bell'), ' ', U.isReply(ev) ? `${who} replied to you` : `${who} mentioned you`, isNew ? sr(', new') : '') });
      list.append(node); ids.push(ev.id);
    } else {
      const target = U.reactionTargetOf(ev); const word = ev.kind === 7 ? likeWord().past : 'Retweeted';
      const when = U.relativeTime(ev.created_at);
      list.append(el('article', { class: 'post note-item', 'data-id': ev.id },
        el('span', { class: `note-icon note-${ev.kind === 7 ? 'like' : 'repost'}`, 'aria-hidden': 'true' }, icon(ev.kind === 7 ? likeWord().icon : 'repost')),
        el('div', { class: 'post-body' },
          el('h2', { class: 'post-author note-line', tabindex: '-1' }, el('a', { href: `#/u/${N.npubOf(ev.pubkey)}`, class: 'author', 'data-pubkey': ev.pubkey }, el('span', { class: 'author-name', text: who })), ` ${word} `, target ? el('a', { href: `#/post/${target}` }, 'your Tweet') : 'your Tweet', isNew ? sr(', new') : ''),
          el('p', { class: 'post-meta' }, el('time', { datetime: new Date(ev.created_at * 1000).toISOString() }, el('span', { 'aria-hidden': 'true', text: when.short }), sr(`${when.long}, ${U.fullDate(ev.created_at)}`))))));
    }
  }
  status.textContent = seen.size ? '' : 'Nothing yet. Replies, mentions, likes and Retweets of your Tweets will show up here.';
  N.wantProfiles(pks); loadTallies(ids);
  const unsub = N.onProfiles((got) => { for (const a of list.querySelectorAll('.note-line .author')) if (got.has(a.dataset.pubkey)) a.querySelector('.author-name').textContent = displayFor(a.dataset.pubkey).name; refreshNames(list, got); }); onCleanup(unsub);
}

// ---------- messages / discover ----------
function viewMessages(box) {
  setTitle('Messages');
  const { center } = shell(box, { right: false });
  center.append(el('section', { class: 'card', 'aria-labelledby': 'messages-soon' }, el('h2', { id: 'messages-soon', text: 'Coming soon' }),
    el('p', {}, 'Private messages between you and the people you follow will show up here, encrypted end to end on Nostr.')));
}
function findForm() {
  const f = field({ id: 'find-input', label: 'Go to a person: paste their npub or a Birdline username', extra: { autocapitalize: 'none', spellcheck: 'false' } });
  const go = el('button', { type: 'submit', class: 'btn primary', id: 'find-go' }, 'Go');
  const form = el('form', { class: 'form', id: 'find-form', novalidate: true }, f.node, go);
  form.addEventListener('submit', (e) => {
    e.preventDefault(); const v = f.input.value.trim(); f.setError('');
    if (!v) { f.setError('Paste an npub or type a username.'); f.input.focus(); return; }
    const pk = N.pubkeyFromAny(v); location.hash = pk ? `#/u/${N.npubOf(pk)}` : `#/@${U.normalizeUsername(v)}`;
  });
  return form;
}
function findCard() { return el('section', { class: 'card side-card', 'aria-labelledby': 'find-title' }, el('div', { class: 'side-head' }, el('h2', { id: 'find-title', text: 'Find a person' })), findForm()); }
function viewDiscover(box, r) {
  setTitle('Discover');
  const { center, right } = shell(box);
  right.append(whoToFollowCard());
  const q = new URLSearchParams(String(location.hash.split('?')[1] || '')).get('q');
  center.append(el('section', { class: 'card', 'aria-labelledby': 'find-title' }, el('h2', { id: 'find-title', text: 'Find a person' }), findForm()));
  center.append(el('section', { class: 'card', 'aria-labelledby': 'discover-soon' }, el('h2', { id: 'discover-soon', text: 'Search is coming soon' }),
    q ? el('p', {}, `You searched for “${q.slice(0, 80)}”. Searching Tweets isn’t built yet, but going to a person by username or npub works above.`) : null,
    el('p', {}, 'Search, hashtags people are using right now, and people to follow will show up here. No algorithm: just counts, in the open.')));
}
function viewNotFound(box) { setTitle('Page not found'); box.append(el('div', { class: 'page narrow' }, el('div', { class: 'card' }, el('p', {}, 'There’s nothing here. ', el('a', { href: state.me ? '#/home' : '#/signin' }, 'Go back home'))))); }

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
  const likeStyle = el('fieldset', { class: 'radios', id: 'settings-like-style' }, el('legend', { text: 'Liking a Tweet' }),
    ...[['heart', 'Heart, called “Like”'], ['star', 'Star, called “Favorite”']].map(([v, l]) => el('div', { class: 'check' },
      el('input', { type: 'radio', name: 'like-style', id: `like-style-${v}`, value: v, checked: (s.likeStyle || 'heart') === v }), el('label', { for: `like-style-${v}`, text: l }))));
  likeStyle.addEventListener('change', (e) => { S.setSetting('likeStyle', e.target.value); announce(e.target.value === 'star' ? 'Buttons will say Favorite, with a star.' : 'Buttons will say Like, with a heart.'); });
  const access = el('section', { class: 'card form', id: 'settings-accessibility', 'aria-labelledby': 'settings-a11y-title' },
    el('h2', { id: 'settings-a11y-title', text: 'Accessibility' }), hash.node, motion, likeStyle,
    el('p', { class: 'hint' }, 'Keyboard shortcuts are off, so single keys never fight with your screen reader. Control or Command + Enter sends a Tweet.'),
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
  const { center } = shell(box, { right: false });
  center.append(pform, access, replies, account, device);
}

async function signOut() {
  await S.forgetSession(); N.clearSigner(); state.me = null; state.skHex = null; state.follows = []; state.followsFetched = false;
  state.myCounts = null; state.myCountsAt = 0; state.suggestions = null; state.noteBadgeAt = 0; tallies.clear(); deletedByMe.clear(); deletesLoaded = false;
  const ap = document.getElementById('topbar-avatar-pic'); if (ap) { ap.replaceChildren(); delete ap.dataset.pk; } setBadge('badge-connect', 0);
  location.hash = '#/signin'; setTimeout(() => announce('Signed out.'), 600);
}

// ---------- top bar ----------
function paintTopbar() {
  const pk = state.me.pubkey; const holder = document.getElementById('topbar-avatar-pic');
  if (holder && holder.dataset.pk !== pk + (N.cachedProfile(pk) ? '1' : '0')) { holder.replaceChildren(avatarNode(pk, 32, 'avatar small-avatar')); holder.dataset.pk = pk + (N.cachedProfile(pk) ? '1' : '0'); }
  const nm = document.getElementById('avatar-menu-name'); if (nm) nm.textContent = displayFor(pk).name;
}
function closeAvatarMenu(focusBtn) {
  const btn = document.getElementById('topbar-avatar'); const menu = document.getElementById('avatar-menu');
  if (!btn || menu.hidden) return; menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (focusBtn) btn.focus();
}
function wireTopbar() {
  const btn = document.getElementById('topbar-avatar'); const menu = document.getElementById('avatar-menu');
  btn.addEventListener('click', () => { if (menu.hidden) { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); menu.querySelector('a,button').focus(); } else closeAvatarMenu(true); });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeAvatarMenu(true); } });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) closeAvatarMenu(false); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !btn.parentElement.contains(e.target)) closeAvatarMenu(false); });
  document.getElementById('menu-signout').addEventListener('click', () => { closeAvatarMenu(false); signOut(); });
  const compose = document.getElementById('topbar-compose');
  compose.addEventListener('click', () => openComposeDialog(compose));
  const search = document.getElementById('topbar-search');
  search.addEventListener('submit', (e) => {
    e.preventDefault(); const input = document.getElementById('topbar-search-input'); const v = input.value.trim(); if (!v) { input.focus(); return; }
    const pk = N.pubkeyFromAny(v);
    if (pk) location.hash = `#/u/${N.npubOf(pk)}`;
    else if (/^@?[a-z0-9_]{1,15}$/i.test(v) && v.startsWith('@')) location.hash = `#/@${U.normalizeUsername(v)}`;
    else location.hash = `#/discover?q=${encodeURIComponent(v)}`;
    input.value = '';
  });
  N.onProfiles((got) => { if (state.me && got.has(state.me.pubkey)) paintTopbar(); });
  setInterval(() => { if (state.me && document.visibilityState === 'visible') refreshNoteBadge(); }, 120000);
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
  wireTopbar();
  window.addEventListener('hashchange', route);
  await route();
  if (state.me) refreshNoteBadge();
}
start();
window.birdline = { version: '0.2.2', state: () => ({ signedIn: !!state.me, pubkey: state.me && state.me.pubkey, username: state.me && state.me.username }), timings: lastTimings };
