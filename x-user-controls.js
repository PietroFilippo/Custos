// Durable manual choices, a shared reservation-based reveal allowance, and
// delayed "Not sensitive" marks for classifier false positives.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TabCloserXUserControls = api;
})(globalThis, function() {
  // Per-post daily reveal time: 3 s by default, configurable from 3 to 10 s.
  const POST_LIMIT_MS = 3000;
  const MIN_POST_SEC = 3;
  const MAX_POST_SEC = 10;
  const postLimitSec = value => (Number.isInteger(value) && value >= MIN_POST_SEC && value <= MAX_POST_SEC ? value : POST_LIMIT_MS / 1000);
  // A "Not sensitive" mark takes effect a day after it is made, so it fixes a
  // false positive without offering anything in the moment.
  const SAFE_MARK_DELAY_MS = 24 * 60 * 60 * 1000;
  const MAX_SAFE_MARKS_PER_DAY = 5;
  const MAX_SAFE_MARKS = 500;
  const safeMarksPerDay = value => (Number.isInteger(value) && value >= 0 && value <= MAX_SAFE_MARKS_PER_DAY ? value : 0);
  const validPost = value => typeof value === 'string' && /^\d{1,30}$/.test(value);
  function validMedia(value) {
    if (typeof value !== 'string' || value.length > 2048) return false;
    const split = value.indexOf('|');
    if (!validPost(value.slice(0, split))) return false;
    try {
      const url = new URL(value.slice(split + 1));
      return url.protocol === 'https:' && /^(pbs|video)\.twimg\.com$/.test(url.hostname);
    } catch { return false; }
  }
  function dayAt(now) {
    const date = new Date(now);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }
  function normalize(raw = {}) {
    raw = raw || {};
    const entries = (values, valid) => Object.fromEntries(Object.entries(values || {})
      .filter(([key, at]) => valid(key) && Number.isFinite(at)));
    const ledger = raw.ledger || {};
    const safe = Object.fromEntries(Object.entries(raw.safe || {})
      .filter(([key, mark]) => validMedia(key) && Number.isFinite(mark?.at) && Number.isFinite(mark?.activeAt))
      .map(([key, mark]) => [key, { at: mark.at, activeAt: Math.max(mark.activeAt, mark.at + SAFE_MARK_DELAY_MS) }]));
    return {
      // Legacy whole-post choices now hide its text and media separately.
      posts: entries(raw.posts, validPost), texts: entries(raw.texts, validPost), media: entries(raw.media, validMedia),
      safe,
      ledger: {
        day: /^\d{4}-\d{2}-\d{2}$/.test(ledger.day) ? ledger.day : '',
        usedMs: Math.max(0, Number(ledger.usedMs) || 0),
        posts: Object.fromEntries(Object.entries(ledger.posts || {}).filter(([key, value]) => validPost(key) && Number.isFinite(value) && value >= 0)),
        marks: Number.isInteger(ledger.marks) && ledger.marks > 0 ? ledger.marks : 0,
        // An interrupted reveal keeps its reservation. Never resume visibility on startup.
        lease: null,
      },
    };
  }
  function rollDay(state, now) {
    const day = dayAt(now);
    // Moving the clock backwards cannot refill the allowance.
    if (day > state.ledger.day && !(state.ledger.lease?.deadline > now)) {
      state.ledger = { day, usedMs: 0, posts: {}, marks: 0, lease: null };
    }
  }
  function remaining(state, limitSec, postId, now, postLimitMs = POST_LIMIT_MS) {
    rollDay(state, now);
    return {
      dailyMs: Math.max(0, limitSec * 1000 - state.ledger.usedMs),
      postMs: Math.max(0, postLimitMs - (state.ledger.posts[postId] || 0)),
      postLimitMs,
      day: state.ledger.day,
    };
  }
  function begin(state, { postId, tabId, limitSec, postLimitMs = POST_LIMIT_MS, now, token }) {
    if (!validPost(postId)) return { ok: false, error: 'This post has no stable identity.' };
    const left = remaining(state, limitSec, postId, now, postLimitMs);
    if (state.ledger.lease?.deadline > now) return { ok: false, error: 'A reveal is already active in another view.' };
    const durationMs = Math.floor(Math.min(left.dailyMs, left.postMs, postLimitMs));
    if (durationMs <= 0) return { ok: false, error: left.dailyMs <= 0 ? 'No daily reveal allowance remains.' : 'This post has used its ' + postLimitMs / 1000 + ' seconds today.' };
    const lease = { token, postId, tabId, startedAt: now, deadline: now + durationMs, durationMs };
    // Reserve before sending permission to the page. Reloads/crashes cannot refund time.
    state.ledger.usedMs += durationMs;
    state.ledger.posts[postId] = (state.ledger.posts[postId] || 0) + durationMs;
    state.ledger.lease = lease;
    return { ok: true, ...lease, ...remaining(state, limitSec, postId, now, postLimitMs) };
  }
  function end(state, { token, tabId, now }) {
    const lease = state.ledger.lease;
    if (!lease || lease.token !== token || lease.tabId !== tabId) return false;
    const elapsed = Math.min(lease.durationMs, Math.max(0, now - lease.startedAt));
    // A backwards clock consumes the reservation instead of granting extra time.
    const refund = now < lease.startedAt ? 0 : lease.durationMs - elapsed;
    state.ledger.usedMs = Math.max(0, state.ledger.usedMs - refund);
    state.ledger.posts[lease.postId] = Math.max(0, state.ledger.posts[lease.postId] - refund);
    state.ledger.lease = null;
    return true;
  }
  function marksLeft(state, perDay, now) {
    rollDay(state, now);
    return Math.max(0, safeMarksPerDay(perDay) - state.ledger.marks);
  }
  // Removing a mark never refunds the day's count, so marking and unmarking
  // cannot be used to restart anything.
  function markSafe(state, { key, perDay, now }) {
    if (!validMedia(key)) return { ok: false, error: 'This image has no stable identity.' };
    if (safeMarksPerDay(perDay) <= 0) return { ok: false, error: '“Not sensitive” marks are off. Set a daily number in Custos settings.' };
    if (state.safe[key]) return { ok: false, error: 'This image is already marked.' };
    if (marksLeft(state, perDay, now) <= 0) return { ok: false, error: 'No “Not sensitive” marks left today.' };
    if (Object.keys(state.safe).length >= MAX_SAFE_MARKS) return { ok: false, error: 'The list of marks is full. Remove some in Custos settings.' };
    const mark = { at: now, activeAt: now + SAFE_MARK_DELAY_MS };
    state.safe[key] = mark;
    state.ledger.marks += 1;
    return { ok: true, ...mark };
  }
  function safeMarkList(state, now) {
    return Object.entries(state.safe)
      .map(([key, mark]) => ({ key, at: mark.at, activeAt: mark.activeAt, active: mark.activeAt <= now }))
      .sort((a, b) => b.at - a.at);
  }
  function nextSafeActivation(state, now) {
    const pending = Object.values(state.safe).map(mark => mark.activeAt).filter(at => at > now);
    return pending.length ? Math.min(...pending) : null;
  }
  return {
    normalize, validPost, validMedia, remaining, begin, end, postLimitSec, POST_LIMIT_MS, MIN_POST_SEC, MAX_POST_SEC,
    safeMarksPerDay, marksLeft, markSafe, safeMarkList, nextSafeActivation, SAFE_MARK_DELAY_MS, MAX_SAFE_MARKS_PER_DAY,
  };
});
