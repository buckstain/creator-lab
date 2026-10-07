import test from 'node:test';
import assert from 'node:assert/strict';
import {score, toCsv, parseAccounts, hookOf} from '../scripts/outliers.mjs';

const now = Date.parse('2026-10-07T00:00:00Z');
const reel = (owner, code, plays, daysAgo, caption = 'Hook line\nmore') => ({ownerUsername: owner, shortCode: code, videoPlayCount: plays, videoViewCount: plays, timestamp: new Date(now - daysAgo * 86400000).toISOString(), caption, videoDuration: 31.4});

test('ratio is views over the account median, ranked across accounts', () => {
  const rows = [
    ...[1000, 1000, 1000, 1000, 1000].map((p, i) => reel('small', 's' + i, p, 10 + i)),
    reel('small', 'sHit', 8000, 20),
    ...[50000, 50000, 50000, 50000, 50000].map((p, i) => reel('big', 'b' + i, p, 10 + i)),
    reel('big', 'bHit', 150000, 20),
  ];
  const {rows: top} = score(rows, {top: 2, now});
  assert.deepEqual(top.map(r => [r.post.id, r.ratio]), [['sHit', 8], ['bHit', 3]]);
  assert.deepEqual(score(rows, {minRatio: 5, now}).rows.map(r => r.post.id), ['sHit']);
});

test('young Reels are scored but stay out of the baseline', () => {
  const rows = [...[100, 100, 100, 100, 100].map((p, i) => reel('a', 'a' + i, p, 10 + i)), reel('a', 'fresh', 1, 1), reel('a', 'fresh2', 1, 1)];
  const {rows: top} = score(rows, {top: 10, now});
  assert.equal(top[0].median, 100);
  assert.equal(top[0].baselineN, 5);
  assert.equal(top.length, 7);
});

test('accounts with too few baseline Reels are skipped, not scored', () => {
  const {rows: top, skipped} = score([reel('thin', 't1', 500, 10), reel('thin', 't2', 9000, 10)], {now});
  assert.equal(top.length, 0);
  assert.match(skipped[0], /thin/);
});

test('falls back to views for an account missing plays', () => {
  const rows = [...[10, 10, 10, 10, 10].map((p, i) => ({...reel('v', 'v' + i, p, 10), videoPlayCount: undefined}))];
  assert.equal(score(rows, {now}).rows[0].metric, 'views');
});

test('csv escapes captions and parseAccounts cleans handles', () => {
  const rows = [...[10, 10, 10, 10, 10].map((p, i) => reel('c', 'c' + i, p, 10, 'Say "this", then\nthat'))];
  const csv = toCsv(score(rows, {top: 1, now}).rows);
  assert.match(csv, /"Say ""this"", then"/);
  assert.deepEqual(parseAccounts('@One # note\n\none\ntwo\n# skip'), ['one', 'two']);
  assert.equal(hookOf('\n  first  \nsecond'), 'first');
});
