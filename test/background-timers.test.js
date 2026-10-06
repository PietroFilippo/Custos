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
  url = 'https://x.com/home', xProtection = {}, xUserControls = {}, adultSites = {}, adultListFails = false, classify = null } = {}) {
  let now = 100000;
  let mono = 0;
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
    performance: { now: () => mono },
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
    TabCloserClassifier: { warmUp() {}, classifyImageData: async () => classify() },
    // Image loading for classification: a fake X image that decodes to blank pixels.
    AbortController,
    fetch: async target => ({ ok: true, url: target, headers: new Map([['content-type', 'image/jpeg']]), blob: async () => ({ size: 10 }) }),
    createImageBitmap: async () => ({ close() {} }),
    document: { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({}) }) }) },
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
        onHeadersReceived: event('headers'),
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
    advance(seconds) { now += seconds * 1000; mono += seconds * 1000; },
    // Moves only the device clock, as a user changing the system time would.
    jumpClock(seconds) { now += seconds * 1000; },
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

test('profile settings save from settings only and stay editable under an X lock', async () => {
  const h = await start({ xProtection: { labeled: { enabled: true, lockUntil: 900000 } } });
  assert.deepEqual(JSON.parse(JSON.stringify((await h.state()).xProtection.profile)), {
    images: 'off', avatars: true, banners: true, markers: false, names: false, alias: 'virtue', collapse: false,
  }, 'profile protection is off by default');
  assert.equal((await h.send({ type: 'saveXProfile', images: 'everyone' }, { tab: { id: 1, url: 'https://x.com/home' } })).ok, false,
    'content scripts cannot change profile protection');
  assert.equal((await h.send({ type: 'saveXProfile', images: 'flagged', names: true, collapse: true }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveXProfile', images: 'everyone' }, settingsSender)).ok, true, 'widening is allowed');
  assert.equal((await h.send({ type: 'saveXProfile', images: 'flagged' }, settingsSender)).ok, true, 'narrowing is allowed under the lock');
  assert.equal((await h.send({ type: 'saveXProfile', names: false, markers: true }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveXProfile', alias: 'plain' }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveXProfile', images: 'all' }, settingsSender)).ok, false, 'unknown scopes are rejected');
  const profile = (await h.state()).xProtection.profile;
  assert.equal(profile.images, 'flagged');
  assert.equal(profile.names, false);
  assert.equal(profile.markers, true);
  assert.equal(profile.alias, 'plain');
  assert.equal(h.saved().xProtection.profile.images, 'flagged');
  assert.equal((await h.send({ type: 'saveXProfile', images: 'off', collapse: false }, settingsSender)).ok, true, 'it can be turned off entirely');
  assert.equal((await h.send({ type: 'saveXProtection', labeled: false, model: false }, settingsSender)).ok, false, 'the media protection stays locked');
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
  assert.equal((await h.send({ type: 'saveAdultSites', enabled: true, safeSearch: false }, settingsSender)).ok, true, 'SafeSearch stays editable during the lock');
  assert.equal(Object.keys(await request('https://www.google.com/search?q=test')).length, 0);
  assert.equal((await h.send({ type: 'saveAdultSites', enabled: false, safeSearch: false }, settingsSender)).ok, false, 'blocking itself stays locked');
  assert.equal((await h.send({ type: 'saveAdultSites', enabled: true, safeSearch: true }, settingsSender)).ok, true);
  assert.equal((await request('https://www.google.com/search?q=test')).redirectUrl, 'https://www.google.com/search?q=test&safe=active');
});

test('time per post is 3-5 s and the daily allowance at most 50 s; both reach the ledger and only go down while locked', async () => {
  const h = await start({ xProtection: { revealDailySec: 30 } });
  const sender = { tab: { id: 1, url: 'https://x.com/home' } };
  assert.equal((await h.state()).xProtection.revealPerPostSec, 3, 'defaults to 3 s');
  for (const invalid of [2, 6, 10, 4.5, '4']) {
    assert.equal((await h.send({ type: 'saveXProtection', revealPerPostSec: invalid }, settingsSender)).ok, false, String(invalid));
  }
  for (const invalid of [51, 3600, -1, 2.5]) {
    assert.equal((await h.send({ type: 'saveXProtection', revealDailySec: invalid }, settingsSender)).ok, false, String(invalid));
  }
  assert.equal((await h.send({ type: 'saveXProtection', revealDailySec: 50 }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveXProtection', revealPerPostSec: 5 }, settingsSender)).ok, true);
  const reveal = await h.send({ type: 'xControlRevealStart', postId: '123' }, sender);
  assert.equal(reveal.durationMs, 5000, 'the background caps reveals with the configured time');
  assert.equal((await h.send({ type: 'xControlGet', postId: '456' }, sender)).revealPerPostSec, 5);
  assert.equal((await h.send({ type: 'lockXReveal', durationSec: 120 }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveXProtection', revealPerPostSec: 4 }, settingsSender)).ok, true, 'decreasing is allowed');
  assert.equal((await h.send({ type: 'saveXProtection', revealPerPostSec: 5 }, settingsSender)).ok, false, 'no increase under the allowance lock');
  assert.equal((await h.send({ type: 'saveXProtection', revealDailySec: 20 }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveXProtection', revealDailySec: 21 }, settingsSender)).ok, false);
  const xLocked = await start({ xProtection: { revealDailySec: 30, revealPerPostSec: 4, labeled: { enabled: true, lockUntil: 900000 } } });
  assert.equal((await xLocked.state()).xProtection.revealPerPostSec, 4, 'a saved value survives restart');
  assert.equal((await xLocked.send({ type: 'saveXProtection', revealPerPostSec: 5 }, settingsSender)).ok, false, 'no increase under an X lock');
  const legacy = await start({ xProtection: { revealDailySec: 600, revealPerPostSec: 8 } });
  assert.equal((await legacy.state()).xProtection.revealDailySec, 50, 'older, larger allowances are lowered to the new maximum');
  assert.equal((await legacy.state()).xProtection.revealPerPostSec, 5);
});

const xSender = { tab: { id: 1, url: 'https://x.com/home' } };

test('enum values from Object.prototype never pass validation or lock checks', async () => {
  const locked = await start({ xProtection: { labeled: { enabled: true, lockUntil: 900000 }, model: { enabled: true, sensitivity: 'strict', lockUntil: 900000 },
    profile: { images: 'flagged', avatars: true } } });
  for (const images of ['constructor', '__proto__', 'toString']) {
    assert.equal((await locked.send({ type: 'saveXProfile', images }, settingsSender)).ok, false, images);
  }
  for (const sensitivity of ['__proto__', 'constructor', 'hasOwnProperty']) {
    assert.equal((await locked.send({ type: 'saveXProtection', sensitivity }, settingsSender)).ok, false, sensitivity);
  }
  const state = (await locked.state()).xProtection;
  assert.equal(state.profile.images, 'flagged');
  assert.equal(state.model.sensitivity, 'strict');
  const stored = await start({ xProtection: { model: { enabled: true, sensitivity: '__proto__' }, profile: { images: 'constructor' } } });
  assert.equal((await stored.state()).xProtection.model.sensitivity, 'balanced', 'tampered storage normalizes safely');
  assert.equal((await stored.state()).xProtection.profile.images, 'off');
  const verdict = require('../x-verdict.js');
  assert.equal(verdict.presetValues('__proto__'), verdict.presetValues('balanced'));
});

test('overflowing lock durations are rejected and never erase an existing lock', async () => {
  const h = await start({ rules: [rule('x.com', { disableLockedUntil: 900000 })], xProtection: { labeled: { enabled: true, lockUntil: 900000 } } });
  for (const durationSec of [1e308, Infinity, 'forever', 30]) {
    assert.equal((await h.send({ type: 'lockRule', id: 'x.com', durationSec })).ok, false, String(durationSec));
    assert.equal((await h.send({ type: 'lockXProtection', target: 'labeled', durationSec })).ok, false, String(durationSec));
    assert.equal((await h.send({ type: 'lockXReveal', durationSec }, settingsSender)).ok, false, String(durationSec));
  }
  const state = await h.state();
  assert.equal(state.rules[0].disableLockedUntil, 900000);
  assert.equal(state.xProtection.labeled.lockUntil, 900000);
  assert.equal((await h.send({ type: 'saveXProtection', labeled: false, model: false }, settingsSender)).ok, false, 'the X lock still holds');
});

test('a locked timer cannot be reset, and a locked rule may only get stricter', async () => {
  const h = await start({ rules: [rule('x.com', { closeAfterSec: 600, blockDurationSec: 1800, disableLockedUntil: 900000 })] });
  assert.equal((await h.send({ type: 'resetAccum', domain: 'x.com' })).ok, false);
  const base = (await h.state()).rules[0];
  const save = change => h.send({ type: 'saveRules', rules: [{ ...base, ...change }] });
  assert.equal((await save({ closeAfterSec: 900 })).ok, false, 'a longer limit is looser');
  assert.equal((await save({ blockDurationSec: 600 })).ok, false, 'a shorter block is looser');
  assert.equal((await save({ blockAfterClose: false })).ok, false, 'removing the block is looser');
  assert.equal((await save({ enabled: false })).ok, false);
  assert.equal((await save({ domain: 'y.com' })).ok, false);
  assert.equal((await save({ closeAfterSec: 300, blockDurationSec: 3600, lockUnblock: true })).ok, true, 'stricter edits are allowed');
  const saved = (await h.state()).rules[0];
  assert.equal(saved.closeAfterSec, 300);
  assert.equal(saved.disableLockedUntil, 900000, 'the lock is kept');
  assert.equal((await h.send({ type: 'saveRules', rules: [{ ...saved, lockUnblock: false }] })).ok, false, 'early unblock stays locked');
});

test('a trailing dot in the host cannot escape timers, cooldowns, or protections', async () => {
  const h = await start({ rules: [rule('x.com')], blocks: { 'x.com': { until: 900000 } }, tabs: [{ id: 1, url: 'https://example.com', windowId: 1 }] });
  assert.equal((await h.events.adultRequest({ type: 'main_frame', url: 'https://x.com./home' })).redirectUrl, 'https://x.com/home');
  await h.events.navigate({ frameId: 0, tabId: 1, url: 'https://x.com./home' });
  await h.state();
  assert.match(h.updates.at(-1)?.url || '', /blocked\.html\?domain=x\.com/);
});

test('how hidden posts are handled stays editable under an X lock; the media protection does not', async () => {
  const locked = await start({ xProtection: { labeled: { enabled: true, lockUntil: 900000 }, replaceText: true, blockLike: true, groupMedia: true } });
  for (const change of [{ replaceText: false }, { blockLike: false }, { groupMedia: false }, { sacredArt: true }, { replaceText: true, groupMedia: true }]) {
    assert.equal((await locked.send({ type: 'saveXProtection', ...change }, settingsSender)).ok, true, JSON.stringify(change));
  }
  const state = (await locked.state()).xProtection;
  assert.equal(state.blockLike, false);
  assert.equal(state.replaceText, true);
  assert.equal(state.labeled.enabled, true, 'the level is untouched');
  assert.equal((await locked.send({ type: 'saveXProtection', labeled: false, model: false }, settingsSender)).ok, false, 'the level stays locked');
});

test('moving the system clock forward does not end locks once a server time is known', async () => {
  const h = await start({ xProtection: { labeled: { enabled: true }, model: { enabled: true } } });
  assert.equal((await h.send({ type: 'lockXProtection', target: 'model', durationSec: 120 })).ok, true);
  h.events.headers({ url: 'https://x.com/', fromCache: false, responseHeaders: [{ name: 'Date', value: new Date(100000).toUTCString() }] });
  h.jumpClock(10 * 86400);
  assert.equal((await h.send({ type: 'saveXProtection', labeled: false, model: false }, settingsSender)).ok, false, 'the lock holds after a clock jump');
  h.advance(121);
  assert.equal((await h.send({ type: 'saveXProtection', labeled: false, model: false }, settingsSender)).ok, true, 'real elapsed time still ends it');
});

test('“Not sensitive” marks: borderline classifier images only, effective a day later, capped, and lock-aware', async () => {
  const scores = values => ({ Drawing: 0.05, Hentai: 0.01, Neutral: 0.5, Porn: 0.04, Sexy: 0.4, ...values });
  const verdicts = {
    a: { verdict: 'protect', reason: 'visual', adultScore: 0.24, scores: scores({}) },
    b: { verdict: 'protect', reason: 'visual', adultScore: 0.9, scores: scores({ Porn: 0.85, Neutral: 0 }) },
    c: { verdict: 'safe', reason: 'visual', adultScore: 0.05, scores: scores({ Sexy: 0.02, Neutral: 0.88 }) },
    d: { verdict: 'protect', reason: 'visual', adultScore: 0.24, scores: scores({}) },
  };
  let current = 'a';
  const h = await start({ xProtection: { labeled: { enabled: true }, model: { enabled: true } }, classify: () => verdicts[current] });
  const key = id => '123|https://pbs.twimg.com/media/' + id;
  const mark = id => { current = id; return h.send({ type: 'xControlMarkSafe', key: key(id), url: 'https://pbs.twimg.com/media/' + id + '?format=jpg&name=small' }, xSender); };
  assert.match((await mark('a')).error, /off/, 'marks are off by default');
  for (const invalid of [6, -1, 1.5, '2']) {
    assert.equal((await h.send({ type: 'saveXProtection', safeMarksPerDay: invalid }, settingsSender)).ok, false, String(invalid));
  }
  assert.equal((await h.send({ type: 'saveXProtection', safeMarksPerDay: 1 }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'xControlMarkSafe', key: key('a'), url: 'https://pbs.twimg.com/media/zzz?format=jpg' }, xSender)).ok, false, 'the image must match the key');
  assert.equal((await h.send({ type: 'xControlMarkSafe', key: key('a'), url: 'https://pbs.twimg.com/tweet_video_thumb/a.jpg' }, xSender)).ok, false, 'GIF thumbnails cannot be marked');
  assert.equal((await h.send({ type: 'xControlMarkSafe', key: key('a'), url: 'https://pbs.twimg.com/media/a?format=jpg' }, settingsSender)).ok, false, 'only from X');
  assert.match((await mark('b')).error, /too confident/);
  assert.match((await mark('c')).error, /does not hide/);
  const marked = await mark('a');
  assert.equal(marked.ok, true);
  assert.equal(marked.activeAt, 100000 + 86400000, 'a mark takes effect 24 hours later');
  let controls = await h.send({ type: 'xControlGet' }, xSender);
  assert.deepEqual(controls.safeMarks.map(entry => [entry.key, entry.active]), [[key('a'), false]]);
  assert.equal(controls.safeMarksLeft, 0);
  assert.ok(h.alarms.has('xSafeMarks'), 'an alarm wakes X tabs when the mark takes effect');
  assert.match((await mark('d')).error, /left today/, 'the daily number caps marks');
  // A device clock jump cannot bring the mark forward once a server time is known.
  h.events.headers({ url: 'https://x.com/', fromCache: false, responseHeaders: [{ name: 'Date', value: new Date(100000).toUTCString() }] });
  h.jumpClock(3 * 86400);
  controls = await h.send({ type: 'xControlGet' }, xSender);
  assert.equal(controls.safeMarks[0].active, false);
  h.advance(86401);
  await h.events.alarm({ name: 'xSafeMarks' });
  controls = await h.send({ type: 'xControlGet' }, xSender);
  assert.equal(controls.safeMarks[0].active, true, 'real elapsed time activates it');
  assert.equal(h.alarms.has('xSafeMarks'), false, 'no pending marks, no alarm');
  // Locks: the number can only go down; removing a mark always works.
  assert.equal((await h.send({ type: 'lockXReveal', durationSec: 3600 }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'saveXProtection', safeMarksPerDay: 3 }, settingsSender)).ok, false, 'no increase under the allowance lock');
  assert.equal((await h.send({ type: 'saveXProtection', safeMarksPerDay: 0 }, settingsSender)).ok, true, 'decreasing is allowed');
  assert.equal((await h.send({ type: 'xControlUnmarkSafe', key: key('a') }, settingsSender)).ok, true);
  assert.equal((await h.send({ type: 'xControlGet' }, xSender)).safeMarks.length, 0);
  assert.equal(h.saved().xUserControls.safe[key('a')], undefined, 'removal is persisted');
});
