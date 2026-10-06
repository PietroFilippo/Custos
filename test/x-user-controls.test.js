const test = require('node:test');
const assert = require('node:assert/strict');
const controls = require('../x-user-controls.js');
const today = new Date(2026, 8, 22, 12).getTime();
const request = (overrides = {}) => ({ postId: '123', tabId: 1, limitSec: 30, now: today, token: 'one', ...overrides });

test('one shared reservation prevents simultaneous reveals in other tabs', () => {
  const state = controls.normalize();
  assert.equal(controls.begin(state, request()).durationMs, 3000);
  assert.equal(controls.begin(state, request({ tabId: 2, postId: '456' })).ok, false);
  assert.equal(controls.end(state, { token: 'one', tabId: 2, now: today + 1000 }), false);
  assert.equal(state.ledger.usedMs, 3000);
});

test('early release refunds unused time; repeated holds share the post cap', () => {
  const state = controls.normalize();
  controls.begin(state, request());
  assert.equal(controls.end(state, { token: 'one', tabId: 1, now: today + 1000 }), true);
  assert.equal(state.ledger.usedMs, 1000);
  const second = controls.begin(state, request({ token: 'two', now: today + 1000 }));
  assert.equal(second.durationMs, 2000);
  assert.equal(controls.begin(state, request({ now: today + 4000 })).ok, false);
  assert.equal(controls.begin(state, request({ postId: '456', now: today + 4000 })).ok, true);
});

test('daily limit caps the final reveal, and disabling/re-enabling never resets usage', () => {
  const state = controls.normalize();
  controls.begin(state, request({ limitSec: 4 }));
  const last = controls.begin(state, request({ postId: '456', now: today + 4000, limitSec: 4 }));
  assert.equal(last.durationMs, 1000);
  assert.equal(controls.remaining(state, 0, '789', today + 6000).dailyMs, 0);
  assert.equal(controls.begin(state, request({ postId: '789', now: today + 6000, limitSec: 4 })).ok, false);
});

test('restart consumes outstanding reservations and preserves per-post usage', () => {
  const state = controls.normalize();
  controls.begin(state, request());
  const restarted = controls.normalize(JSON.parse(JSON.stringify(state)));
  assert.equal(restarted.ledger.lease, null);
  assert.equal(controls.begin(restarted, request({ now: today + 1000 })).ok, false);
  assert.equal(controls.remaining(restarted, 30, '123', today + 1000).dailyMs, 27000);
});

test('local midnight replenishes once and moving the date backwards does not', () => {
  const state = controls.normalize();
  controls.begin(state, request());
  assert.equal(controls.remaining(state, 30, '123', today - 86400000).postMs, 0);
  assert.equal(controls.remaining(state, 30, '123', today + 86400000).postMs, 3000);
  controls.begin(state, request({ now: today + 86400000 }));
  assert.equal(controls.remaining(state, 30, '123', today).postMs, 0);
});

test('a hold across midnight cannot clear its reservation until it ends', () => {
  const state = controls.normalize();
  const midnight = new Date(2026, 8, 23).getTime();
  controls.begin(state, request({ now: midnight - 1000 }));
  assert.equal(controls.begin(state, request({ now: midnight, postId: '456' })).ok, false);
  controls.end(state, { token: 'one', tabId: 1, now: midnight + 500 });
  assert.equal(controls.begin(state, request({ now: midnight + 500 })).durationMs, 3000);
});

test('invalid manual identities are discarded while valid post and media choices persist', () => {
  const key = '123|https://pbs.twimg.com/media/example';
  const state = controls.normalize({ posts: {123: today, garbage: today}, media: {[key]: today, '123|javascript:alert(1)': today} });
  assert.deepEqual(Object.keys(state.posts), ['123']);
  assert.deepEqual(Object.keys(state.media), [key]);
});

test('the per-post limit is configurable from 3 to 5 seconds and caps each post', () => {
  assert.equal(controls.postLimitSec(5), 5);
  assert.equal(controls.postLimitSec(3), 3);
  assert.equal(controls.postLimitSec(8), 5, 'an older saved value is lowered to the new maximum');
  assert.equal(controls.postLimitSec(10), 5);
  for (const invalid of [2, 11, 4.5, '4', null, undefined]) assert.equal(controls.postLimitSec(invalid), 3, String(invalid));
  assert.equal(controls.MAX_DAILY_SEC, 50);
  const state = controls.normalize();
  const first = controls.begin(state, request({ postLimitMs: 5000 }));
  assert.equal(first.durationMs, 5000);
  assert.equal(first.postLimitMs, 5000);
  controls.end(state, { token: 'one', tabId: 1, now: today + 5000 });
  const spent = controls.begin(state, request({ token: 'two', now: today + 6000, postLimitMs: 5000 }));
  assert.equal(spent.ok, false);
  assert.match(spent.error, /used its 5 seconds/);
  assert.equal(controls.remaining(state, 30, '123', today + 6000, 4000).postMs, 0, 'lowering the limit below usage leaves nothing');
});

test('"Not sensitive" marks take effect a day later, are capped per day, and unmarking never refunds', () => {
  const state = controls.normalize();
  const key = id => '123|https://pbs.twimg.com/media/' + id;
  assert.equal(controls.markSafe(state, { key: key('a'), perDay: 0, now: today }).ok, false, 'off at 0');
  const first = controls.markSafe(state, { key: key('a'), perDay: 2, now: today });
  assert.equal(first.activeAt, today + controls.SAFE_MARK_DELAY_MS);
  assert.equal(controls.markSafe(state, { key: key('a'), perDay: 2, now: today }).ok, false, 'already marked');
  assert.equal(controls.markSafe(state, { key: 'not-media', perDay: 2, now: today }).ok, false);
  assert.equal(controls.markSafe(state, { key: key('b'), perDay: 2, now: today }).ok, true);
  delete state.safe[key('b')];
  assert.equal(controls.marksLeft(state, 2, today), 0, 'removing a mark does not give the mark back');
  assert.equal(controls.markSafe(state, { key: key('c'), perDay: 2, now: today }).ok, false);
  assert.deepEqual(controls.safeMarkList(state, today).map(mark => mark.active), [false]);
  assert.equal(controls.nextSafeActivation(state, today), first.activeAt);
  const tomorrow = today + controls.SAFE_MARK_DELAY_MS;
  assert.deepEqual(controls.safeMarkList(state, tomorrow).map(mark => mark.active), [true]);
  assert.equal(controls.nextSafeActivation(state, tomorrow), null);
  assert.equal(controls.marksLeft(state, 2, tomorrow), 2, 'a new day brings the marks back');
});

test('stored marks are validated and can never take effect sooner than a day after marking', () => {
  const state = controls.normalize({ safe: {
    '123|https://pbs.twimg.com/media/a': { at: today, activeAt: today + 1000 },
    'bad': { at: today, activeAt: today },
    '456|https://pbs.twimg.com/media/b': { at: 'x', activeAt: today },
  }, ledger: { marks: -3 } });
  assert.deepEqual(Object.keys(state.safe), ['123|https://pbs.twimg.com/media/a']);
  assert.equal(state.safe['123|https://pbs.twimg.com/media/a'].activeAt, today + controls.SAFE_MARK_DELAY_MS);
  assert.equal(state.ledger.marks, 0);
  assert.equal(controls.safeMarksPerDay(6), 0);
  assert.equal(controls.safeMarksPerDay(3), 3);
});
