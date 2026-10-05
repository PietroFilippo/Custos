// Profile protection on X: blurs profile pictures and banners, replaces the
// display names of flagged accounts, and collapses their replies. Account
// flags come from X's own account data (plus optional explicit markers), live
// only in this page's memory, and are never saved: a reload forgets them all,
// so a mistaken flag can never censor an account for good.
(() => {
  const virtues = ['Temperance', 'Patience', 'Fortitude', 'Prudence', 'Charity', 'Humility', 'Diligence', 'Kindness',
    'Justice', 'Faith', 'Hope', 'Meekness', 'Gentleness', 'Modesty', 'Perseverance', 'Constancy'];
  const maxAccounts = 5000;
  const handlePattern = /^[A-Za-z0-9_]{1,15}$/;
  const nameContainerSelector = '[data-testid="User-Name"], [data-testid="UserName"], [data-testid="UserCell"], [data-testid="HoverCard"]';
  // X paints pictures twice: an accessible <img> and a background-image div.
  const imageTargets = ' :is(img, [style*="background-image"])';
  const allAvatars = ['[data-testid^="UserAvatar-Container-"]' + imageTargets, 'img[src*="/profile_images/"]', '[style*="/profile_images/"]'];
  const allBanners = ['a[href$="/header_photo"]' + imageTargets, 'img[src*="/profile_banners/"]', '[style*="/profile_banners/"]'];
  const avatarBlur = 'filter: blur(var(--tabcloser-avatar-blur, 6px)) saturate(0.6) !important;';
  const bannerBlur = 'filter: blur(36px) saturate(0.6) brightness(0.7) !important;';
  const accounts = new Map();
  const style = document.createElement('style');
  style.id = 'tabcloser-profile-style';
  let config = normalize(null);
  let refreshTimer = null;
  let styledOwnHandle;

  function normalize(raw) {
    return {
      images: ['off', 'flagged', 'everyone'].includes(raw?.images) ? raw.images : 'off',
      avatars: raw?.avatars !== false,
      banners: raw?.banners !== false,
      markers: raw?.markers === true,
      names: raw?.names === true,
      alias: raw?.alias === 'plain' ? 'plain' : 'virtue',
      collapse: raw?.collapse === true,
    };
  }

  const accountFor = handle => (handle ? accounts.get(handle.toLowerCase()) : undefined);
  const flagged = account => !!account && (account.flagged || (config.markers && account.marker));
  const flaggedHandle = handle => flagged(accountFor(handle));

  // A stable alias per account keeps reply threads readable.
  function aliasFor(handle) {
    if (config.alias === 'plain') return 'Hidden account';
    return virtues[hashString(accountFor(handle)?.id || handle) % virtues.length] + ' ✝';
  }

  function ownHandle() {
    const container = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] [data-testid^="UserAvatar-Container-"]');
    const handle = container?.getAttribute('data-testid').slice('UserAvatar-Container-'.length);
    return handle && handlePattern.test(handle) ? handle.toLowerCase() : null;
  }

  function avatarSelectors(account) {
    const list = ['[data-testid="UserAvatar-Container-' + account.handle + '" i]' + imageTargets];
    if (account.avatarKey) list.push('img[src*="' + account.avatarKey + '"]', '[style*="' + account.avatarKey + '"]');
    return list;
  }

  function bannerSelectors(account) {
    const list = ['a[href="/' + account.handle + '/header_photo" i]' + imageTargets];
    const key = account.bannerKey || (account.id ? '/profile_banners/' + account.id + '/' : null);
    if (key) list.push('img[src*="' + key + '"]', '[style*="' + key + '"]');
    return list;
  }

  // Pictures and banners are blurred by a generated stylesheet, so React
  // re-renders and new surfaces (hover cards, lists, DMs) need no JS work.
  function buildStyle() {
    styledOwnHandle = ownHandle();
    const rules = [];
    const known = [...accounts.values()];
    const kinds = config.images === 'off' ? [] : [
      config.avatars && [allAvatars, avatarSelectors, avatarBlur],
      config.banners && [allBanners, bannerSelectors, bannerBlur],
    ].filter(Boolean);
    for (const [all, selectorsFor, blur] of kinds) {
      if (config.images === 'everyone') {
        // Fail closed: every picture blurs until X confirms you follow the
        // account. A flagged account stays blurred even when followed.
        rules.push(all.join(',\n') + ' { ' + blur + ' }');
        const exempt = known.filter(account => account.following === true && !flagged(account));
        if (styledOwnHandle) exempt.push(accountFor(styledOwnHandle) || { handle: styledOwnHandle });
        if (exempt.length) rules.push(exempt.flatMap(selectorsFor).join(',\n') + ' { filter: none !important; }');
      } else {
        const targets = known.filter(account => flagged(account) && account.handle !== styledOwnHandle);
        if (targets.length) rules.push(targets.flatMap(selectorsFor).join(',\n') + ' { ' + blur + ' }');
      }
    }
    if (kinds.some(([all]) => all === allBanners)) rules.push('a[href$="/header_photo"] { overflow: hidden !important; }');
    style.textContent = rules.join('\n');
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }

  function handleWithin(container) {
    for (const link of container.querySelectorAll('a[href^="/"]')) {
      const match = (link.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (match) return match[1].toLowerCase();
    }
    for (const span of container.querySelectorAll('span')) {
      const match = span.textContent.trim().match(/^@([A-Za-z0-9_]{1,15})$/);
      if (match) return match[1].toLowerCase();
    }
    return null;
  }

  // The display name is the first text block that is not the @handle. Emoji
  // in names are images, so their alt text counts as text.
  function nameElement(container) {
    for (const candidate of container.querySelectorAll('div[dir]')) {
      if (candidate.closest('.tabcloser-controls')) continue;
      const text = (candidate.textContent + [...candidate.querySelectorAll('img[alt]')].map(image => image.alt).join('')).trim();
      if (text && !text.startsWith('@') && text !== '·') return candidate;
    }
    return null;
  }

  function restoreName(name) {
    name.classList.remove('tabcloser-name-hidden');
    delete name.dataset.tabcloserAliasFor;
  }

  function applyNames() {
    // Drop aliases whose name element React replaced or that no longer apply.
    for (const alias of document.querySelectorAll('.tabcloser-alias')) {
      const name = alias.nextElementSibling;
      const handle = name?.dataset.tabcloserAliasFor;
      if (!name?.classList.contains('tabcloser-name-hidden') || !config.names || !flaggedHandle(handle)) {
        alias.remove();
        if (name?.classList.contains('tabcloser-name-hidden')) restoreName(name);
      } else if (alias.textContent !== aliasFor(handle)) {
        alias.textContent = aliasFor(handle);
      }
    }
    for (const name of document.querySelectorAll('.tabcloser-name-hidden')) {
      if (!name.previousElementSibling?.classList.contains('tabcloser-alias')) restoreName(name);
    }
    if (config.names) {
      for (const container of document.querySelectorAll(nameContainerSelector)) {
        if (extensionOwnedElement(container)) continue;
        const handle = handleWithin(container);
        if (!flaggedHandle(handle)) continue;
        const name = nameElement(container);
        if (!name || name.classList.contains('tabcloser-name-hidden')) continue;
        const computed = getComputedStyle(name);
        const alias = document.createElement('span');
        alias.className = 'tabcloser-alias';
        alias.title = 'Name hidden by Custos';
        alias.textContent = aliasFor(handle);
        alias.style.fontSize = computed.fontSize;
        alias.style.fontWeight = computed.fontWeight;
        alias.style.lineHeight = computed.lineHeight;
        alias.style.color = computed.color;
        name.dataset.tabcloserAliasFor = handle;
        name.classList.add('tabcloser-name-hidden');
        name.insertAdjacentElement('beforebegin', alias);
      }
    }
    applyTitle();
  }

  // Profile tabs are titled "Name (@handle) / X".
  function applyTitle() {
    const match = document.title.match(/^(\(\d+\+?\) )?(.+) \(@([A-Za-z0-9_]{1,15})\) \/ X$/);
    if (!match || !config.names || !flaggedHandle(match[3])) return;
    const alias = aliasFor(match[3]);
    if (match[2] !== alias) document.title = (match[1] || '') + alias + ' (@' + match[3] + ') / X';
  }

  function authorHandle(article) {
    const author = [...article.querySelectorAll('[data-testid="User-Name"]')].find(node => tweetLayerFor(node, article) === article);
    return author ? handleWithin(author) : null;
  }

  function isolate(element) {
    for (const type of ['click', 'auxclick', 'dblclick', 'keydown', 'keyup', 'pointerdown', 'pointerup']) {
      element.addEventListener(type, event => {
        // The notice lives inside X's clickable post: never open the reply.
        if (['click', 'auxclick', 'dblclick'].includes(type)) event.preventDefault();
        event.stopPropagation();
      });
    }
  }

  function collapsedNotice(article, handle) {
    const notice = document.createElement('div');
    notice.className = 'tabcloser-controls tabcloser-collapsed-reply';
    notice.setAttribute('role', 'group');
    notice.setAttribute('aria-label', 'Reply from a hidden account');
    const text = document.createElement('span');
    text.className = 'tabcloser-collapsed-text';
    text.textContent = 'Reply from a hidden account ';
    const at = document.createElement('span');
    at.className = 'tabcloser-collapsed-handle';
    at.textContent = '@' + handle;
    text.appendChild(at);
    // No one-click reveal: "Show…" explains and offers the metered hold.
    const show = document.createElement('button');
    show.type = 'button';
    show.textContent = 'Show…';
    show.addEventListener('click', () => globalThis.TabCloserXInteractions?.openPanel(article));
    notice.append(text, show);
    isolate(notice);
    return notice;
  }

  // Replies on a conversation page fold into one line; the focal post and
  // every post outside conversations stay as X shows them.
  function applyCollapse() {
    const pageStatusId = statusIdFromHref(location.pathname);
    for (const article of document.querySelectorAll('article')) {
      const handle = authorHandle(article);
      const notice = [...article.children].find(child => child.classList.contains('tabcloser-collapsed-reply'));
      const collapse = config.collapse && !!pageStatusId && flaggedHandle(handle) && statusIdFor(article) !== pageStatusId;
      if (!collapse) {
        article.removeAttribute('data-tabcloser-collapsed');
        notice?.remove();
        continue;
      }
      article.setAttribute('data-tabcloser-collapsed', handle);
      if (!notice) article.prepend(collapsedNotice(article, handle));
    }
  }

  function refresh() {
    refreshTimer = null;
    if (config.images !== 'off' && ownHandle() !== styledOwnHandle) buildStyle();
    applyNames();
    applyCollapse();
  }

  function schedule() {
    if (refreshTimer == null) refreshTimer = setTimeout(refresh, 100);
  }

  function remember(account) {
    if (!account || typeof account.handle !== 'string' || !handlePattern.test(account.handle)) return;
    const handle = account.handle.toLowerCase();
    const previous = accounts.get(handle);
    accounts.delete(handle);
    accounts.set(handle, {
      id: typeof account.id === 'string' && /^\d{1,30}$/.test(account.id) ? account.id : previous?.id ?? null,
      handle,
      flagged: account.flagged === true || previous?.flagged === true,
      marker: account.marker === true || previous?.marker === true,
      following: typeof account.following === 'boolean' ? account.following : previous?.following ?? null,
      avatarKey: /^\/profile_images\/\d+\/$/.test(account.avatarKey || '') ? account.avatarKey : previous?.avatarKey ?? null,
      bannerKey: /^\/profile_banners\/\d+\/$/.test(account.bannerKey || '') ? account.bannerKey : previous?.bannerKey ?? null,
    });
    while (accounts.size > maxAccounts) accounts.delete(accounts.keys().next().value);
  }

  function explain(root) {
    if (!(root instanceof Element) || !root.hasAttribute('data-tabcloser-collapsed')) return null;
    const handle = root.getAttribute('data-tabcloser-collapsed');
    const reason = accountFor(handle)?.flagged
      ? 'X marks @' + handle + ' as an account that posts sensitive media.'
      : 'The name or bio of @' + handle + ' contains an explicit marker such as 18+, NSFW, or an OnlyFans link.';
    return { kind: 'Flagged account', text: reason + ' Your settings collapse replies from flagged accounts. The flag lasts only for this page session and is never saved.' };
  }

  browser.runtime.onMessage.addListener(message => {
    if (message?.type === 'xProtectionChanged') {
      config = normalize(message.xProtection?.profile);
      buildStyle();
      refresh();
    }
    if (message?.type === 'xSensitiveMediaMetadata' && Array.isArray(message.metadata?.accounts) && message.metadata.accounts.length) {
      for (const account of message.metadata.accounts) remember(account);
      buildStyle();
      schedule();
    }
  });

  new MutationObserver(mutations => {
    const working = config.names || config.collapse || (config.images !== 'off' && !styledOwnHandle) ||
      document.querySelector('.tabcloser-alias, [data-tabcloser-collapsed]');
    if (!working || !mutations.some(mutation => !extensionOwnedElement(mutation.target))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });

  globalThis.TabCloserXProfile = {
    explain,
    collapsed: root => root instanceof Element && root.hasAttribute('data-tabcloser-collapsed'),
  };

  browser.storage.local.get('xProtection')
    .then(data => { config = normalize(data.xProtection?.profile); buildStyle(); refresh(); })
    .catch(() => buildStyle());
})();
