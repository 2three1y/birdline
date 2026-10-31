// Reply, repost and like: the Nostr events Birdline writes, and how it counts them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../js/util.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), ME = 'd'.repeat(64);
const id = (ch) => ch.repeat(64);
const post = { id: id('1'), pubkey: A, kind: 1, created_at: 100, content: 'hello #birds', tags: [['t', 'birds']], sig: 'x' };

test('reply to a top-level post: root marker, author p tag, hashtags', () => {
  const r = U.replyTemplate(post, 'hi back #Birds');
  assert.equal(r.kind, 1);
  assert.deepEqual(r.tags.filter(t => t[0] === 'e'), [['e', post.id, '', 'root']]);
  assert.deepEqual(r.tags.filter(t => t[0] === 'p'), [['p', A]]);
  assert.deepEqual(r.tags.filter(t => t[0] === 't'), [['t', 'birds']]);
  assert.equal(U.replyTargetOf({ ...r, id: id('2') }), post.id);
});

test('reply to a reply keeps the thread root and everyone in it', () => {
  const mid = { id: id('2'), pubkey: B, kind: 1, content: 'x', tags: [['e', post.id, '', 'root'], ['p', A]] };
  const r = U.replyTemplate(mid, 'third');
  assert.deepEqual(r.tags.filter(t => t[0] === 'e'), [['e', post.id, '', 'root'], ['e', mid.id, '', 'reply']]);
  assert.deepEqual(r.tags.filter(t => t[0] === 'p').map(t => t[1]).sort(), [A, B].sort());
  assert.equal(U.replyTargetOf({ ...r, id: id('3') }), mid.id);
  assert.equal(U.rootOf({ ...r, id: id('3') }), post.id);
});

test('old positional e tags: the last one is the target', () => {
  const ev = { id: id('4'), kind: 1, tags: [['e', post.id], ['e', id('2')]] };
  assert.equal(U.replyTargetOf(ev), id('2'));
  assert.equal(U.rootOf(ev), post.id);
});

test('repost is kind 6 carrying the original', () => {
  const r = U.repostTemplate(post);
  assert.equal(r.kind, 6);
  assert.deepEqual(r.tags.slice(0, 2), [['e', post.id, ''], ['p', A]]);
  assert.deepEqual(U.repostedEvent(r), post);
  assert.equal(U.repostedEvent({ content: 'not json' }), null);
});

test('like is kind 7 "+", unlike/undo is a kind 5 delete', () => {
  const l = U.likeTemplate(post);
  assert.equal(l.kind, 7); assert.equal(l.content, '+');
  assert.deepEqual(l.tags, [['e', post.id], ['p', A], ['k', '1']]);
  const d = U.deleteTemplate([id('9')], 7);
  assert.deepEqual(d, { kind: 5, content: '', tags: [['e', id('9')], ['k', '7']] });
});

test('tally counts each person once, ignores dislikes and deleted events, and knows my own', () => {
  const evs = [
    { id: id('5'), kind: 7, pubkey: B, content: '+', tags: [['e', post.id], ['p', A]] },
    { id: id('6'), kind: 7, pubkey: B, content: '❤️', tags: [['e', post.id], ['p', A]] }, // same person again
    { id: id('7'), kind: 7, pubkey: C, content: '-', tags: [['e', post.id]] }, // dislike
    { id: id('8'), kind: 7, pubkey: ME, content: '+', tags: [['e', post.id]] },
    { id: id('9'), kind: 6, pubkey: ME, content: '', tags: [['e', post.id]] },
    { id: id('e'), kind: 6, pubkey: C, content: '', tags: [['e', post.id]] },
    { id: id('f'), kind: 1, pubkey: C, content: 'reply', tags: [['e', post.id, '', 'root']] },
    { id: id('0'), kind: 1, pubkey: B, content: 'deep', tags: [['e', post.id, '', 'root'], ['e', id('f'), '', 'reply']] },
  ];
  const t = U.tallyActions(evs, [post.id, id('f')], ME)[post.id];
  assert.deepEqual(t, { replies: 1, reposts: 2, likes: 2, myRepost: id('9'), myLike: id('8') });
  const after = U.tallyActions(evs, [post.id], ME, new Set([id('8')]))[post.id];
  assert.equal(after.likes, 1); assert.equal(after.myLike, null);
  assert.equal(U.tallyActions(evs, [id('f')], ME)[id('f')].replies, 1);
});

test('button labels and counts', () => {
  assert.equal(U.actionLabel('Like', 3), 'Like, 3');
  assert.equal(U.actionLabel('Reply', 0), 'Reply');
  assert.equal(U.compactCount(999), '999');
  assert.equal(U.compactCount(1250), '1.2K');
  assert.equal(U.compactCount(34567), '34K');
  assert.equal(U.compactCount(1500000), '1.5M');
  assert.equal(U.compactCount('30+'), '30+');
});

test('trends and who to follow', () => {
  assert.deepEqual(U.topHashtags([post, { content: 'more #birds and #sky', tags: [] }, { content: '#sky', tags: [] }], 2), [{ tag: 'birds', count: 2 }, { tag: 'sky', count: 2 }]);
  const fl = (pk, ps) => ({ pubkey: pk, kind: 3, created_at: 1, tags: ps.map(p => ['p', p]) });
  assert.deepEqual(U.suggestFollows([fl(A, [C, ME, B]), fl(B, [C])], ME, [A, B]), [{ pubkey: C, count: 2 }]);
});
