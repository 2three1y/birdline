import test from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../js/util.js';

test('countChars counts emoji and accents as one', () => {
  assert.equal(U.countChars('hello'), 5);
  assert.equal(U.countChars('👍🏽'), 1);
  assert.equal(U.countChars('👨‍👩‍👧'), 1);
  assert.equal(U.countChars('café'), 4);
  assert.equal(U.countChars(''), 0);
});

test('counter speaks only at 20, 10, 0 and over', () => {
  const said = [];
  let prev = 140;
  for (let used = 1; used <= 145; used++) { const left = 140 - used; const s = U.counterAnnouncement(prev, left); if (s) said.push([left, s]); prev = left; }
  assert.deepEqual(said.map(x => x[0]), [20, 10, 0, -1]);
  assert.match(said[3][1], /Over the limit by 1/);
  // pasting a big jump past a mark still speaks once
  assert.equal(U.counterAnnouncement(140, 15), '15 characters left.');
  assert.equal(U.counterAnnouncement(15, 14), null);
  // deleting back up does not speak
  assert.equal(U.counterAnnouncement(9, 25), null);
});

test('usernames', () => {
  assert.equal(U.usernameProblem('good_name1'), null);
  assert.equal(U.usernameProblem('@Good_Name1'), null);
  assert.match(U.usernameProblem('has space'), /letters, numbers/);
  assert.match(U.usernameProblem('a'.repeat(16)), /15/);
  assert.match(U.usernameProblem('admin'), /kept/);
  assert.match(U.usernameProblem(''), /Pick/);
  const s = U.usernameSuggestions('river', 'River Song');
  assert.ok(s.length >= 2 && s.every(x => U.usernameProblem(x) === null));
});

test('passwords: min 10 and no common ones', () => {
  assert.match(U.passwordProblem('short1!'), /10 characters/);
  assert.match(U.passwordProblem('password123'), /lists|guess/);
  assert.match(U.passwordProblem('qwertyuiop'), /lists|runs/);
  assert.match(U.passwordProblem('1234567890'), /lists|runs/);
  assert.match(U.passwordProblem('aaaaaaaaaaaa'), /repeated/);
  assert.match(U.passwordProblem('riverbank2026!', 'riverbank'), /username/);
  assert.equal(U.passwordProblem('purple otters dance'), null);
  assert.equal(U.passwordProblem('Tr4in-on-mars!'), null);
});

test('tokenize finds links, hashtags and nostr refs', () => {
  const t = U.tokenize('Hi #Birdline see https://example.com/a. and nostr:npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m ok');
  assert.deepEqual(t.map(x => x.type), ['text', 'hashtag', 'text', 'link', 'text', 'nostr', 'text']);
  assert.equal(t[1].value, 'Birdline');
  assert.equal(t[3].value, 'https://example.com/a');
  assert.deepEqual(U.hashtagsOf('#One #one #Two'), ['one', 'two']);
});

test('follow list edits keep other follows and never go back in time', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
  const old = { created_at: 100, id: '1', tags: [['p', a], ['p', b]], content: '{"relay":1}' };
  const newer = { created_at: 200, id: '2', tags: [['p', a]], content: '' };
  assert.equal(U.newestEvent([old, newer]), newer);
  const t = U.followTemplate(newer, c, true, 150);
  assert.deepEqual(U.followsOf(t), [a, c]);
  assert.equal(t.created_at, 201);
  const t2 = U.followTemplate(old, b, false, 500);
  assert.deepEqual(U.followsOf(t2), [a]);
  assert.equal(t2.content, '{"relay":1}');
  assert.deepEqual(U.followsOf(U.followTemplate(null, a, true)), [a]);
});

test('relative time', () => {
  const now = Date.UTC(2026, 9, 31, 12, 0, 0);
  assert.equal(U.relativeTime(now / 1000 - 5, now).long, 'just now');
  assert.equal(U.relativeTime(now / 1000 - 120, now).short, '2m');
  assert.equal(U.relativeTime(now / 1000 - 7200, now).long, '2 hours ago');
  assert.equal(U.relativeTime(now / 1000 + 999, now).short, '0s'); // future-dated never shows negative
});

test('handles show a key tail', () => {
  const pk = 'abcd' + '0'.repeat(60);
  assert.deepEqual(U.handleOf({ name: 'River' }, pk), { username: 'river', tail: 'abcd' });
  assert.equal(U.displayNameOf({}, pk), 'Someone abcd');
  assert.equal(U.safeUrl('javascript:alert(1)'), null);
});
