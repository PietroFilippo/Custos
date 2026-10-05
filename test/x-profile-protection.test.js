const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const scripts = ['x-protection-v2.js', 'x-interactions.js', 'x-profile-protection.js']
  .map(file => readFileSync(path.join(root, file), 'utf8'));

const userName = (handle, name, statusId) => `
  <div data-testid="User-Name">
    <a href="/${handle}"><div><div dir="ltr"><span>${name}</span><img alt="🔞"></div><div dir="ltr"><span>✓</span></div></div></a>
    <a href="/${handle}"><div dir="ltr"><span>@${handle}</span></div></a>
    <a href="/${handle}/status/${statusId}"><time>1h</time></a>
  </div>`;

const fixture = `
  <nav><div data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-Me_Account"><img src="https://pbs.twimg.com/profile_images/5/me_normal.jpg"></div></div></nav>
  <article id="focal">${userName('Spicy_One', 'Focal by flagged', 100)}<div data-testid="tweetText">Focal</div></article>
  <article id="reply">
    <div data-testid="UserAvatar-Container-Spicy_One"><img src="https://pbs.twimg.com/profile_images/9001/a_normal.jpg"></div>
    ${userName('Spicy_One', 'Spicy name', 101)}<div data-testid="tweetText">Reply text</div>
  </article>
  <article id="friend-reply">${userName('friend', 'Friend', 102)}<div data-testid="tweetText">Friendly</div></article>
  <div id="cell" data-testid="UserCell"><a href="/Spicy_One"><div data-testid="UserAvatar-Container-Spicy_One"></div></a>
    <a href="/Spicy_One"><div dir="ltr"><span>Spicy name</span></div></a><div dir="ltr"><span>@Spicy_One</span></div></div>`;

const accounts = [
  { handle: 'spicy_one', id: '777', flagged: true, marker: false, following: true, avatarKey: '/profile_images/9001/', bannerKey: null },
  { handle: 'friend', id: '888', flagged: false, marker: false, following: true, avatarKey: '/profile_images/42/', bannerKey: '/profile_banners/888/' },
  { handle: 'marked', id: '999', flagged: false, marker: true, following: false, avatarKey: null, bannerKey: null },
];

async function start(profile, { url = 'https://x.com/Spicy_One/status/100', html = fixture } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { window } = dom;
  const listeners = [];
  const messages = [];
  Object.defineProperty(window.document, 'visibilityState', { value: 'visible' });
  window.document.hasFocus = () => true;
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.TabCloserXMediaUtils = require('../x-media-utils.js');
  window.TabCloserXMetadata = require('../x-metadata.js');
  window.TabCloserXVerdict = require('../x-verdict.js');
  window.browser = {
    storage: { local: { get: async () => ({ xProtection: { profile } }) } },
    runtime: {
      getURL: value => 'moz-extension://tabcloser/' + value,
      onMessage: { addListener(listener) { listeners.push(listener); } },
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'xControlRevealStart') return { ok: true, token: 't', postId: message.postId, durationMs: 3000, deadline: Date.now() + 3000 };
        return { ok: true, posts: [], texts: [], media: [], revealDailySec: 30, dailyMs: 30000, postMs: 3000 };
      },
    },
  };
  for (const script of scripts) window.eval(script);
  const settle = () => new Promise(resolve => window.setTimeout(resolve, 150));
  await settle();
  const send = async message => { for (const listener of listeners) listener(message); await settle(); };
  await send({ type: 'xSensitiveMediaMetadata', metadata: { accounts } });
  return { window, document: window.document, messages, send, settle, close: () => window.close() };
}

const flaggedProfile = { images: 'flagged', avatars: true, banners: true, names: true, alias: 'virtue', collapse: true };

test('flagged scope blurs only flagged accounts, by container, picture path, and banner link', async () => {
  const h = await start(flaggedProfile);
  try {
    const css = h.document.getElementById('tabcloser-profile-style').textContent;
    assert.match(css, /\[data-testid="UserAvatar-Container-spicy_one" i\]/);
    assert.match(css, /img\[src\*="\/profile_images\/9001\/"\]/);
    assert.match(css, /a\[href="\/spicy_one\/header_photo" i\]/);
    assert.match(css, /\/profile_banners\/777\//, 'a banner is matched by the account ID when no banner URL was seen');
    assert.doesNotMatch(css, /friend|me_account|profile_images\/42/);
  } finally { h.close(); }
});

test('everyone scope fails closed and exempts only followed, unflagged accounts and yourself', async () => {
  const h = await start({ ...flaggedProfile, images: 'everyone' });
  try {
    const rules = h.document.getElementById('tabcloser-profile-style').textContent.split('}');
    const blanket = rules.find(rule => rule.includes('blur(var(--tabcloser-avatar-blur')) || '';
    assert.match(blanket, /\[data-testid\^="UserAvatar-Container-"\]/);
    assert.match(blanket, /img\[src\*="\/profile_images\/"\]/);
    const exemptRule = rules.find(rule => rule.includes('filter: none')) || '';
    assert.match(exemptRule, /UserAvatar-Container-friend/);
    assert.match(exemptRule, /UserAvatar-Container-me_account/, 'your own picture is never blurred');
    assert.doesNotMatch(exemptRule, /spicy_one/, 'following a flagged account does not exempt it');
  } finally { h.close(); }
});

test('display names of flagged accounts get one stable virtue alias and come back when switched off', async () => {
  const h = await start(flaggedProfile);
  try {
    const replyAlias = h.document.querySelector('#reply .tabcloser-alias');
    const cellAlias = h.document.querySelector('#cell .tabcloser-alias');
    assert.match(replyAlias.textContent, /^[A-Z][a-z]+ ✝$/);
    assert.equal(cellAlias.textContent, replyAlias.textContent, 'the same account keeps the same alias everywhere');
    assert.ok(replyAlias.nextElementSibling.classList.contains('tabcloser-name-hidden'));
    assert.equal(h.document.querySelector('#friend-reply .tabcloser-alias'), null, 'unflagged accounts keep their names');
    assert.match(h.document.querySelector('#reply [data-testid="User-Name"]').textContent, /@Spicy_One/, 'the handle stays visible');
    await h.send({ type: 'xProtectionChanged', xProtection: { profile: { ...flaggedProfile, alias: 'plain' } } });
    assert.equal(h.document.querySelector('#reply .tabcloser-alias').textContent, 'Hidden account');
    await h.send({ type: 'xProtectionChanged', xProtection: { profile: { ...flaggedProfile, names: false } } });
    assert.equal(h.document.querySelector('.tabcloser-alias'), null);
    assert.equal(h.document.querySelector('.tabcloser-name-hidden'), null);
  } finally { h.close(); }
});

test('explicit markers flag an account only when that option is on', async () => {
  const html = `<div data-testid="UserCell"><a href="/marked"><div dir="ltr"><span>Marked name</span></div></a></div>`;
  const off = await start({ ...flaggedProfile, markers: false }, { url: 'https://x.com/home', html });
  try { assert.equal(off.document.querySelector('.tabcloser-alias'), null); } finally { off.close(); }
  const on = await start({ ...flaggedProfile, markers: true }, { url: 'https://x.com/home', html });
  try { assert.ok(on.document.querySelector('.tabcloser-alias')); } finally { on.close(); }
});

test('replies from flagged accounts collapse behind the metered reveal; the focal post stays', async () => {
  const h = await start(flaggedProfile);
  try {
    const reply = h.document.getElementById('reply');
    assert.equal(h.document.getElementById('focal').hasAttribute('data-tabcloser-collapsed'), false);
    assert.equal(h.document.getElementById('friend-reply').hasAttribute('data-tabcloser-collapsed'), false);
    assert.equal(reply.getAttribute('data-tabcloser-collapsed'), 'spicy_one');
    const notice = reply.querySelector('.tabcloser-collapsed-reply');
    assert.match(notice.textContent, /Reply from a hidden account @spicy_one/);
    let navigated = 0;
    reply.addEventListener('click', () => { navigated++; });
    const show = [...notice.querySelectorAll('button')].find(button => button.textContent === 'Show…');
    const click = new h.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    show.dispatchEvent(click);
    assert.equal(navigated, 0, 'the notice never opens the reply');
    await h.settle();
    const panel = h.document.querySelector('.tabcloser-control-panel');
    assert.match(panel.textContent, /Flagged account/);
    assert.match(panel.textContent, /X marks @spicy_one/);
    assert.match(panel.textContent, /never saved/);
    const hold = [...h.document.querySelectorAll('button')].find(button => button.textContent === 'Hold to reveal');
    hold.dispatchEvent(new h.window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await new Promise(resolve => h.window.setTimeout(resolve, 20));
    assert.ok(h.messages.some(message => message.type === 'xControlRevealStart' && message.postId === '101'));
    assert.ok(reply.hasAttribute('data-tabcloser-collapse-revealed'));
    h.window.dispatchEvent(new h.window.Event('blur'));
    assert.equal(reply.hasAttribute('data-tabcloser-collapse-revealed'), false, 'leaving the window folds it again');
    await h.send({ type: 'xProtectionChanged', xProtection: { profile: { ...flaggedProfile, collapse: false } } });
    assert.equal(reply.hasAttribute('data-tabcloser-collapsed'), false);
    assert.equal(reply.querySelector('.tabcloser-collapsed-reply'), null);
  } finally { h.close(); }
});

test('replies collapse only on conversation pages, and a flagged profile tab title uses the alias', async () => {
  const h = await start(flaggedProfile, { url: 'https://x.com/home' });
  try {
    assert.equal(h.document.querySelector('[data-tabcloser-collapsed]'), null, 'timelines are not conversations');
    h.document.title = 'Spicy name (@Spicy_One) / X';
    await h.settle();
    assert.match(h.document.title, /^[A-Z][a-z]+ ✝ \(@Spicy_One\) \/ X$/);
  } finally { h.close(); }
});
