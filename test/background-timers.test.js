const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const rule = (domain, extra = {}) => ({
  id: domain, domain, enabled: true, closeAfterSec: 180,
  blockAfterClose: true, blockDurationSec: 1800, ...extra,
});

// Run the actual background script through its browser event/message seams.
// Time, storage and tabs are isolated; no real tabs or extension data are touched.
async function start({ rules = [rule('x.com')], blocks = {}, accumSec = {}, tabs: initialTabs,
  url = 'https://x.com/home', xProtection = {}, xUserControls = {}, adultSites = {}, adultListFails = false } = {}) {
  let now = 100000;
  let activeId = 1;
  let focused = true;
  let timerId = 0;
  let saved;
  const tabs = initialTabs || [{ id: 1, url, windowId: 1 }];
  const events = {}, timers = new Map(), alarms = new Map(), removed = [], updates = [], tabMessages = [], filters = [];
  const event = name => ({ addListener(fn, filter) { events[name === 'request' && filter?.types?.includes('main_frame') ? 'adultRequest' : name] = fn; } });
  const context = vm.createContext({
    console, URL, TextDecoder, Uint8ClampedArray, ArrayBuffer,
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    TabCloserXMediaUtils: require('../x-media-utils.js'),
    TabCloserXMetadata: require('../x-metadata.js'),
    TabCloserXVerdict: require('../x-verdict.js'),
    TabCloserXUserControls: require('../x-user-controls.js'),
    TabCloserAdultSites: { ...require('../adult-sites.js'), async load() {
      if (adultListFails) throw new Error('List unavailable');
      return { domains: new Set(['adult.example']), metadata: { count: 1, retrievedAt: '2026-09-22' } };
    } },
    TabCloserClassifier: { warmUp() {} },
    browser: {
      storage: { local: {
        get: async () => structuredClone({ rules, blocks, accumSec, xProtection, xUserControls, adultSites }),
        set: async data => { saved = { ...saved, ...structuredClone(data) }; }, remove: async () => {},
      } },
      runtime: { getURL: value => 'moz-extension://test/' + value, onMessage: event('message') },
      windows: { getLastFocused: async () => ({ id: 1, focused }), onFocusChanged: event('windowFocus') },
      tabs: {
        query: async query => query.url ? [] : query.active
          ? tabs.filter(tab => tab.id === activeId) : tabs.slice(),
        sendMessage: async (tabId, message) => { tabMessages.push({ tabId, message }); return {}; },
        update: async (id, change) => {
          updates.push({ id, ...change });
          Object.assign(tabs.find(tab => tab.id === id) || {}, change);
        },
        remove: async ids => {
          removed.push(...ids);
          for (const id of ids) {
            const index = tabs.findIndex(tab => tab.id === id);
            if (index >= 0) tabs.splice(index, 1);
          }
          if (!tabs.some(tab => tab.id === activeId)) activeId = tabs[0]?.id;
        },
        onActivated: event('activated'), onUpdated: event('updated'), onRemoved: event('removed'),
      },
      alarms: {
        clear: async name => alarms.delete(name),
        create: (name, options) => alarms.set(name, options), onAlarm: event('alarm'),
      },
      webRequest: {
        onBeforeRequest: event('request'),
        filterResponseData(requestId) {
          const filter = { requestId, written: [], write(data) { this.written.push(data); }, close() {} };
          filters.push(filter);
          return filter;
        },
      },
      webNavigation: { onBeforeNavigate: event('navigate') },
    },
  });
  for (const file of ['common.js', 'background.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  await vm.runInContext('bootPromise', context);
  const send = (message, sender) => events.message(message, sender);
  const state = () => send({ type: 'getState' });
  return {
    events, timers, alarms, removed, updates, send, state, tabMessages, filters,
    saved: () => saved,
    advance(seconds) { now += seconds * 1000; },
    async activate(id) { activeId = id; await events.activated({ tabId: id }); await state(); },
    async focus(value) { focused = value; await events.windowFocus(value ? 1 : -1); await state(); },
    async tick() {
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) { timers.delete(id); await timer.fn(); }
      }
      await state();
    },
  };
}

test('manual hides persist, remain removable when unlocked, and reject removal under either X lock', async () => {
  const sender = { tab: { id: 1, url: 'https://x.com/home' } };
  const h = await start();
  assert.equal((await h.send({ type: 'xControlHide', scope: 'post', key: '123' }, sender)).ok, true);
  assert.equal(h.saved().xUserControls.posts['123'], 100000);
  assert.equal((await h.send({ type: 'xControlRemove', scope: 'post', key: '123' }, sender)).ok, true);
  const locked = await start({ xProtection: { labeled: { enabled: true, lockUntil: 900000 }, revealDailySec: 6 }, xUserControls: { posts: {123: 100000} } });
  assert.equal((await locked.send({ type: 'xControlRemove', scope: 'post', key: '123' }, sender)).ok, false);
  assert.equal((await locked.send({ type: 'saveXProtection', labeled: true, model: false, revealDailySec: 9 })).ok, false);
  assert.equal((await locked.state()).xProtection.revealDailySec, 6);
  assert.equal((await locked.send({ type: 'saveXProtection', labeled: true, model: false, revealDailySec: 3 })).ok, true);
});

test('simultaneous reveal requests are serialized and reserve storage before permission is returned', async () => {
  const h = await start({ xProtection: { revealDailySec: 5 } });
  const sender = { tab: { id: 1, url: 'https://x.com/home' } };
  const results = await Promise.all(['123', '456'].map(postId => h.send({ type: 'xControlRevealStart', postId }, sender)));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(h.saved().xUserControls.ledger.usedMs, 3000);
  assert.ok(h.saved().xUserControls.ledger.lease.token);
  h.advance(1);
  await h.send({ type: 'xControlRevealEnd', token: results[0].token, postId: '123' }, sender);
  assert.equal(h.saved().xUserControls.ledger.usedMs, 1000);
  await h.focus(false);
  assert.equal((await h.send({ type: 'xControlRevealStart', postId: '789' }, sender)).ok, false);
});

test('unrelated tabs cannot access manual hide or reveal state', async () => {
  const h = await start();
  assert.equal((await h.send({ type: 'xControlGet' }, { tab: { id: 1, url: 'https://example.com' } })).ok, false);
});

test('independent site timers pause on tab/window changes and close only matching tabs', async () => {
  const h = await start({ rules: [rule('x.com'), rule('reddit.com')], tabs: [
    { id: 1, url: 'https://x.com' }, { id: 2, url: 'https://reddit.com' },
    { id: 3, url: 'https://mobile.x.com', windowId: 2 },
  ] });
  h.advance(10); await h.activate(2);
  h.advance(20); await h.focus(false);
  h.advance(90); await h.focus(true);
  await h.activate(1);
  const state = await h.state();
  assert.equal(state.accumSec['x.com'], 10);
  assert.equal(state.accumSec['reddit.com'], 20);
  h.advance(170); await h.tick();
  assert.deepEqual(h.removed, [1, 3]);
  assert.equal((await h.state()).accumSec['reddit.com'], 20);
  assert.ok((await h.state()).blocks['x.com']);
});

test('concurrent activation and window-focus notifications count an interval once', async () => {
  const h = await start();
  h.advance(10);
  await Promise.all([h.events.activated({ tabId: 1 }), h.events.windowFocus(1)]);
  assert.equal((await h.state()).accumSec['x.com'], 10);
});

test('the most specific enabled domain controls its own timer regardless of rule order', async () => {
  for (const reverse of [false, true]) {
    const rules = [rule('example.com'), rule('video.example.com', { closeAfterSec: 30 })];
    const h = await start({ rules: reverse ? rules.reverse() : rules, url: 'https://video.example.com/watch' });
    assert.equal((await h.state()).focus.domain, 'video.example.com');
    h.advance(30); await h.tick();
    assert.ok((await h.state()).blocks['video.example.com']);
    assert.equal((await h.state()).blocks['example.com'], undefined);
  }
});

test('an expired parent block cannot mask an active child block on navigation', async () => {
  const h = await start({ url: 'https://untracked.test', blocks: {
    'example.com': { until: 99000 }, 'video.example.com': { until: 700000 },
  } });
  await h.events.navigate({ frameId: 0, tabId: 1, url: 'https://video.example.com/watch' });
  await h.state();
  assert.match(h.updates[0]?.url || '', /blocked.html\?domain=video.example.com/);
});

test('the longest applicable block wins, including an active parent block', async () => {
  const h = await start({ url: 'https://untracked.test', blocks: {
    'video.example.com': { until: 200000 }, 'example.com': { until: 700000 },
  } });
  await h.events.navigate({ frameId: 0, tabId: 1, url: 'https://video.example.com/watch' });
  await h.state();
  assert.match(h.updates[0]?.url || '', /domain=example.com&until=700000/);
});

test('duplicate normalized domains are rejected without changing saved rules', async () => {
  const h = await start();
  const response = await h.send({ type: 'saveRules', rules: [
    rule('x.com'), rule('https://www.X.com/home', { id: 'duplicate', enabled: false }),
  ] });
  assert.equal(response.ok, false);
  assert.match(response.error, /already|duplicate/i);
  assert.equal((await h.state()).rules.length, 1);
});

test('legacy disabled duplicates cannot supply an enabled rule\'s block duration', async () => {
  const h = await start({ rules: [
    rule('x.com', { id: 'disabled', enabled: false, blockDurationSec: 60 }), rule('x.com'),
  ] });
  h.advance(180); await h.tick();
  assert.equal((await h.state()).blocks['x.com'].until, 280000 + 1800000);
});

test('resetting an active timer reschedules its timeout and ignores an obsolete alarm', async () => {
  const h = await start();
  const obsoleteTimeout = [...h.timers.values()][0].fn;
  h.advance(100);
  await h.send({ type: 'resetAccum', domain: 'x.com' });
  assert.equal((await h.state()).accumSec['x.com'], 0);
  h.advance(80); await obsoleteTimeout(); await h.events.alarm({ name: 'autoclose' }); await h.tick();
  assert.deepEqual(h.removed, []);
  h.advance(100); await h.tick();
  assert.deepEqual(h.removed, [1]);
});

test('saving after deleting the active rule does not resurrect orphan elapsed time', async () => {
  const h = await start();
  h.advance(10);
  assert.equal((await h.send({ type: 'saveRules', rules: [] })).ok, true);
  assert.equal((await h.state()).accumSec['x.com'], undefined);
  assert.equal(h.timers.size, 0);
});

test('a new subdomain rule cannot override a currently locked parent timer', async () => {
  const h = await start({ rules: [rule('example.com', { disableLockedUntil: 700000 })] });
  const response = await h.send({ type: 'saveRules', rules: [rule('example.com'), rule('video.example.com')] });
  assert.equal(response.ok, false);
  assert.match(response.error, /locked/i);
});

test('a stale close signal after switching sites cannot close the new site early', async () => {
  const h = await start({ rules: [rule('x.com'), rule('reddit.com')], tabs: [
    { id: 1, url: 'https://x.com' }, { id: 2, url: 'https://reddit.com' },
  ] });
  const stale = [...h.timers.values()][0].fn;
  h.advance(100); await h.activate(2);
  await stale(); await h.events.alarm({ name: 'autoclose' }); await h.state();
  assert.deepEqual(h.removed, []);
  assert.equal((await h.state()).focus.domain, 'reddit.com');
});

const settingsSender = { url: 'moz-extension://test/options.html' };
test('independent allowance lock persists, accepts decreases, rejects increases and shortening, then expires', async () => {
  const h = await start({ xProtection: { revealDailySec: 5 } });
  assert.equal((await h.send({ type: 'lockXReveal', durationSec: 120 }, settingsSender)).ok, true);
  assert.equal(h.saved().xProtection.revealLockUntil, 220000);
  assert.equal((await h.send({ type: 'saveXProtection', revealDailySec: 6 })).ok, false);
  assert.equal((await h.send({ type: 'lockXReveal', durationSec: 60 })).ok, false);
  assert.equal((await h.send({ type: 'saveXProtection', revealDailySec: 0 })).ok, true);
  const restarted = await start({ xProtection: h.saved().xProtection });
  assert.equal((await restarted.send({ type: 'saveXProtection', revealDailySec: 1 })).ok, false);
  restarted.advance(121);
  assert.equal((await restarted.send({ type: 'saveXProtection', revealDailySec: 1 })).ok, true);
});
test('adult blocking is opt-in, catches existing tabs and subframes, and preserves its lock across restart', async () => {
  const h = await start({ tabs: [{ id: 1, url: 'https://www.adult.example/video', windowId: 1 }, { id: 2, url: 'https://x.com/home', windowId: 1 }] });
  assert.equal(Object.keys(await h.events.adultRequest({ type: 'main_frame', url: 'https://adult.example/' })).length, 0);
  assert.equal((await h.send({ type: 'saveAdultSites', enabled: true }, settingsSender)).ok, true);
  assert.equal(h.updates.length, 1);
  assert.match(h.updates[0].url, /reason=adult/);
  assert.match((await h.events.adultRequest({ type: 'main_frame', url: 'https://cdn.adult.example/' })).redirectUrl, /reason=adult/);
  assert.equal((await h.events.adultRequest({ type: 'sub_frame', url: 'https://adult.example/' })).cancel, true);
  assert.equal(Object.keys(await h.events.adultRequest({ type: 'main_frame', url: 'https://notadult.example/' })).length, 0);
  assert.equal((await h.send({ type: 'lockAdultSites', durationSec: 120 }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveAdultSites', enabled: false }, settingsSender)).ok, false);
  assert.equal((await h.send({ type: 'lockAdultSites', durationSec: 60 }, settingsSender)).ok, false);
  const restarted = await start({ adultSites: h.saved().adultSites });
  assert.equal((await restarted.send({ type: 'saveAdultSites', enabled: false }, settingsSender)).ok, false);
  restarted.advance(121);
  assert.equal((await restarted.state()).adultSites.enabled, true, 'expiry unlocks settings, not websites');
  assert.equal((await restarted.send({ type: 'saveAdultSites', enabled: false }, settingsSender)).ok, true);
});
test('a missing adult list prevents enabling; a broken locked installation explains the failure instead of bypassing', async () => {
  const h = await start({ adultListFails: true });
  assert.equal((await h.send({ type: 'saveAdultSites', enabled: true }, settingsSender)).ok, false);
  assert.equal((await h.state()).adultSites.enabled, false);
  const locked = await start({ adultSites: { enabled: true, lockUntil: 999999 }, adultListFails: true });
  assert.match((await locked.events.adultRequest({ type: 'main_frame', url: 'https://example.org' })).redirectUrl, /unavailable=1/);
});
test('adult protection cannot be changed by content scripts', async () => {
  const h = await start();
  assert.equal((await h.send({ type: 'saveAdultSites', enabled: true }, { tab: { id: 1, url: 'https://x.com' } })).ok, false);
});

test('sacred art is a presentation switch: editable under every X lock and never touches the tiers', async () => {
  const xProtection = {
    labeled: { enabled: true, lockUntil: 900000 },
    model: { enabled: true, sensitivity: 'strict', lockUntil: 900000 },
  };
  const h = await start({ xProtection });
  assert.equal((await h.state()).xProtection.sacredArt, false, 'blur is the default');
  assert.equal((await h.send({ type: 'saveXProtection', sacredArt: true }, settingsSender)).ok, true);
  let saved = (await h.state()).xProtection;
  assert.equal(saved.sacredArt, true);
  assert.equal(saved.model.enabled, true, 'an omitted tier keeps its value');
  assert.equal(saved.labeled.enabled, true);
  assert.equal((await h.send({ type: 'saveXProtection', sacredArt: false }, settingsSender)).ok, true);
  saved = (await h.state()).xProtection;
  assert.equal(saved.sacredArt, false, 'switching back to blur is allowed during the lock too');
  assert.equal(saved.model.sensitivity, 'strict');
  const unlocked = await start({ xProtection: { model: { enabled: true } } });
  assert.equal((await unlocked.send({ type: 'saveXProtection', sacredArt: true }, settingsSender)).ok, true);
  assert.equal((await unlocked.state()).xProtection.model.enabled, true, 'presentation saves never switch protection off');
});

test('profile settings save from settings only, and only tighten under an X lock except the alias', async () => {
  const h = await start({ xProtection: { labeled: { enabled: true, lockUntil: 900000 } } });
  assert.deepEqual(JSON.parse(JSON.stringify((await h.state()).xProtection.profile)), {
    images: 'off', avatars: true, banners: true, markers: false, names: false, alias: 'virtue', collapse: false,
  }, 'profile protection is off by default');
  assert.equal((await h.send({ type: 'saveXProfile', images: 'everyone' }, { tab: { id: 1, url: 'https://x.com/home' } })).ok, false,
    'content scripts cannot change profile protection');
  assert.equal((await h.send({ type: 'saveXProfile', images: 'flagged', names: true, collapse: true }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveXProfile', images: 'everyone' }, settingsSender)).ok, true, 'widening is allowed');
  assert.equal((await h.send({ type: 'saveXProfile', images: 'flagged' }, settingsSender)).ok, false, 'narrowing is refused');
  assert.equal((await h.send({ type: 'saveXProfile', names: false }, settingsSender)).ok, false);
  assert.equal((await h.send({ type: 'saveXProfile', alias: 'plain' }, settingsSender)).ok, true, 'the alias style is presentation');
  assert.equal((await h.send({ type: 'saveXProfile', images: 'all' }, settingsSender)).ok, false, 'unknown scopes are rejected');
  const profile = (await h.state()).xProtection.profile;
  assert.equal(profile.images, 'everyone');
  assert.equal(profile.names, true);
  assert.equal(profile.alias, 'plain');
  assert.equal(h.saved().xProtection.profile.images, 'everyone');
  h.advance(900);
  assert.equal((await h.send({ type: 'saveXProfile', images: 'off', names: false }, settingsSender)).ok, true, 'expiry unlocks loosening');
});

test('account flags are parsed from X responses only while profile protection needs them', async () => {
  const user = { __typename: 'User', rest_id: '7', core: { screen_name: 'flagged', name: 'Name' }, legacy: { possibly_sensitive: true } };
  const payload = new TextEncoder().encode(JSON.stringify({ data: { user: { result: user } } }));
  const request = { tabId: 3, requestId: 'r1', url: 'https://x.com/i/api/graphql/abc/UserByScreenName?variables=%7B%7D' };
  const off = await start();
  off.events.request(request);
  assert.equal(off.filters.length, 0, 'nothing is intercepted while X and profile protection are off');
  const on = await start({ xProtection: { profile: { images: 'flagged' } } });
  on.events.request(request);
  assert.equal(on.filters.length, 1, 'profile-only protection still reads account data');
  const filter = on.filters[0];
  filter.ondata({ data: payload.buffer });
  await filter.onstop();
  assert.equal(filter.written.length, 1, 'response bytes pass through untouched');
  const delivered = on.tabMessages.find(entry => entry.message.type === 'xSensitiveMediaMetadata');
  assert.equal(delivered.tabId, 3);
  assert.equal(JSON.stringify(delivered.message.metadata.accounts.map(account => [account.handle, account.flagged])), '[["flagged",true]]');
  assert.equal(JSON.stringify(delivered.message).includes('Name'), false, 'display names are never forwarded');
  assert.equal(on.saved()?.xAccounts, undefined, 'account flags are never stored');
});

test('SafeSearch rewrites search engines to their strict filter and shares the adult-site lock', async () => {
  const h = await start();
  const request = url => h.events.adultRequest({ type: 'main_frame', url });
  assert.equal(Object.keys(await request('https://www.google.com/search?q=test')).length, 0, 'off by default');
  assert.equal((await h.send({ type: 'saveAdultSites', enabled: true, safeSearch: true }, settingsSender)).ok, true);
  assert.equal((await request('https://www.google.com/search?q=test&tbm=isch&safe=off')).redirectUrl, 'https://www.google.com/search?q=test&tbm=isch&safe=active');
  assert.equal((await request('https://www.google.co.uk/search?q=test')).redirectUrl, 'https://www.google.co.uk/search?q=test&safe=active');
  assert.equal(Object.keys(await request('https://www.google.com/search?q=test&safe=active')).length, 0, 'no redirect loop');
  assert.equal((await request('https://www.bing.com/images/search?q=test')).redirectUrl, 'https://www.bing.com/images/search?q=test&adlt=strict');
  assert.equal((await request('https://duckduckgo.com/?q=test')).redirectUrl, 'https://duckduckgo.com/?q=test&kp=1');
  assert.equal(Object.keys(await request('https://duckduckgo.com/about')).length, 0);
  const posted = await h.events.adultRequest({ type: 'main_frame', url: 'https://html.duckduckgo.com/html/', requestBody: { formData: { q: ['test query'] } } });
  assert.equal(posted.redirectUrl, 'https://html.duckduckgo.com/html/?q=test+query&kp=1', 'HTML and Lite searches post their query in the body');
  assert.equal(Object.keys(await h.events.adultRequest({ type: 'main_frame', url: 'https://lite.duckduckgo.com/lite/' })).length, 0, 'the empty search form loads');
  assert.equal((await request('https://search.brave.com/images?q=test')).redirectUrl, 'https://search.brave.com/images?q=test&safesearch=strict');
  assert.equal(Object.keys(await request('https://www.google.com/maps?q=test')).length, 0, 'only search pages are rewritten');
  assert.equal(Object.keys(await h.events.adultRequest({ type: 'sub_frame', url: 'https://www.google.com/search?q=test' })).length, 0);
  assert.equal((await h.send({ type: 'lockAdultSites', durationSec: 120 }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveAdultSites', enabled: true, safeSearch: false }, settingsSender)).ok, false, 'locked SafeSearch stays on');
  h.advance(121);
  assert.equal((await h.send({ type: 'saveAdultSites', enabled: true, safeSearch: false }, settingsSender)).ok, true);
  assert.equal(Object.keys(await request('https://www.google.com/search?q=test')).length, 0);
});

test('time per post is 3-10 s, reaches the ledger, and may only go down while locked', async () => {
  const h = await start({ xProtection: { revealDailySec: 30 } });
  const sender = { tab: { id: 1, url: 'https://x.com/home' } };
  assert.equal((await h.state()).xProtection.revealPerPostSec, 3, 'defaults to 3 s');
  for (const invalid of [2, 11, 4.5, '7']) {
    assert.equal((await h.send({ type: 'saveXProtection', revealPerPostSec: invalid }, settingsSender)).ok, false, String(invalid));
  }
  assert.equal((await h.send({ type: 'saveXProtection', revealPerPostSec: 8 }, settingsSender)).ok, true);
  const reveal = await h.send({ type: 'xControlRevealStart', postId: '123' }, sender);
  assert.equal(reveal.durationMs, 8000, 'the background caps reveals with the configured time');
  assert.equal((await h.send({ type: 'xControlGet', postId: '456' }, sender)).revealPerPostSec, 8);
  assert.equal((await h.send({ type: 'lockXReveal', durationSec: 120 }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveXProtection', revealPerPostSec: 10 }, settingsSender)).ok, false, 'no increase under the allowance lock');
  assert.equal((await h.send({ type: 'saveXProtection', revealPerPostSec: 5 }, settingsSender)).ok, true, 'decreasing is allowed');
  const xLocked = await start({ xProtection: { revealDailySec: 30, revealPerPostSec: 6, labeled: { enabled: true, lockUntil: 900000 } } });
  assert.equal((await xLocked.state()).xProtection.revealPerPostSec, 6, 'a saved value survives restart');
  assert.equal((await xLocked.send({ type: 'saveXProtection', revealPerPostSec: 7 }, settingsSender)).ok, false, 'no increase under an X lock');
});
