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
  // Rules target the avatar container and banner link themselves: the style
  // engine matches those by attribute, whereas a descendant or [style*=]
  // pattern would be re-checked against nearly every element X restyles while
  // scrolling. clip-path keeps the blur from spilling past the edges.
  const allAvatars = ['[data-testid^="UserAvatar-Container-"]', 'img[src*="/profile_images/"]'];
  const allBanners = ['a[href$="/header_photo"]', 'img[src*="/profile_banners/"]'];
  const avatarBlur = 'filter: blur(var(--tabcloser-avatar-blur, 6px)) saturate(0.6) !important; clip-path: inset(0 round 9999px) !important;';
  const bannerBlur = 'filter: blur(36px) saturate(0.6) brightness(0.7) !important; clip-path: inset(0) !important;';
  const accounts = new Map();
  const style = document.createElement('style');
  style.id = 'tabcloser-profile-style';
  // Every element Custos changed, so cleanup never has to search the page.
  const marked = new Set();
  // Elements X added since the last refresh; only these are scanned unless a
  // full pass is due (settings, flagged accounts, or the page changed).
  const pendingScan = new Set();
  let flaggedHandles = new Set();
  let fullScan = true;
  let scannedPath = '';
  let titleChanged = false;
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
    const list = ['[data-testid="UserAvatar-Container-' + account.handle + '" i]'];
    if (account.avatarKey) list.push('img[src*="' + account.avatarKey + '"]');
    return list;
  }

  function bannerSelectors(account) {
    const list = ['a[href="/' + account.handle + '/header_photo" i]'];
    const key = account.bannerKey || (account.id ? '/profile_banners/' + account.id + '/' : null);
    if (key) list.push('img[src*="' + key + '"]');
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
        if (exempt.length) rules.push(exempt.flatMap(selectorsFor).join(',\n') + ' { filter: none !important; clip-path: none !important; }');
      } else {
        const targets = known.filter(account => flagged(account) && account.handle !== styledOwnHandle);
        if (targets.length) rules.push(targets.flatMap(selectorsFor).join(',\n') + ' { ' + blur + ' }');
      }
    }
    // Replacing a stylesheet restyles all of X; only do it when rules changed.
    const css = rules.join('\n');
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }

  function updateFlaggedHandles() {
    const next = new Set([...accounts.values()].filter(flagged).map(account => account.handle));
    const changed = next.size !== flaggedHandles.size || [...next].some(handle => !flaggedHandles.has(handle));
    flaggedHandles = next;
    if (changed) fullScan = true;
    return changed;
  }

  // Elements inside a scan target, plus the target itself and its closest
  // match (X often re-renders just a piece of a name or post).
  function within(target, selector) {
    const found = new Set(target.querySelectorAll ? target.querySelectorAll(selector) : []);
    if (target instanceof Element) {
      if (target.matches(selector)) found.add(target);
      const ancestor = target.parentElement?.closest(selector);
      if (ancestor) found.add(ancestor);
    }
    return found;
  }

  function outermost(nodes) {
    const connected = [...nodes].filter(node => node.isConnected);
    return connected.filter(node => !connected.some(other => other !== node && other.contains(node)));
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

  // Emoji in names are images, so their alt text counts as text.
  const textOf = element => (element.textContent + [...element.querySelectorAll('img[alt]')].map(image => image.alt).join('')).trim();

  // The display name is the first text block that is not the @handle.
  function nameElement(container) {
    for (const candidate of container.querySelectorAll('div[dir]')) {
      if (candidate.closest('.tabcloser-controls')) continue;
      const text = textOf(candidate);
      if (text && !text.startsWith('@') && text !== '·') return candidate;
    }
    return null;
  }

  function profileHandle() {
    const segment = location.pathname.split('/')[1] || '';
    return handlePattern.test(segment) ? segment.toLowerCase() : null;
  }

  // Hides an element and puts the alias in its place, in X's own font (the
  // inserted span would otherwise inherit the browser's default serif).
  function showAlias(target, handle) {
    const computed = getComputedStyle(target);
    const alias = document.createElement('span');
    alias.className = 'tabcloser-alias';
    alias.title = 'Name hidden by Custos';
    alias.textContent = aliasFor(handle);
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color']) {
      alias.style[property] = computed[property];
    }
    target.dataset.tabcloserAliasFor = handle;
    target.classList.add('tabcloser-name-hidden');
    target.insertAdjacentElement('beforebegin', alias);
    marked.add(alias);
    marked.add(target);
  }

  function hideFor(element, className, handle) {
    element.classList.add(className);
    element.dataset.tabcloserAliasFor = handle;
    marked.add(element);
  }

  function restoreName(name) {
    name.classList.remove('tabcloser-name-hidden');
    delete name.dataset.tabcloserAliasFor;
  }

  function nameApplies(handle) {
    return config.names && flaggedHandles.has(handle);
  }

  function collapseApplies(article, handle) {
    const pageStatusId = statusIdFromHref(location.pathname);
    return config.collapse && !!pageStatusId && flaggedHandles.has(handle) && statusIdFor(article) !== pageStatusId;
  }

  function uncollapse(article) {
    article.removeAttribute('data-tabcloser-collapsed');
    [...article.children].find(child => child.classList.contains('tabcloser-collapsed-reply'))?.remove();
  }

  // X reuses elements for other accounts: a mark only stays while the element
  // still belongs to the account it was made for.
  function ownerMatches(node, handle) {
    if (node.matches('a')) return (node.getAttribute('href') || '').toLowerCase() === '/' + handle;
    if (node.matches('article')) return authorHandle(node) === handle;
    const container = node.closest(nameContainerSelector);
    if (!container || node.matches('.tabcloser-bio-hidden')) return true;
    const current = handleWithin(container);
    return !current || current === handle;
  }

  // Undoes anything that no longer applies, walking only Custos's own marks.
  function cleanup() {
    for (const node of [...marked]) {
      if (!node.isConnected) { marked.delete(node); continue; }
      const handle = node.dataset.tabcloserAliasFor || node.getAttribute('data-tabcloser-collapsed');
      if (node.classList.contains('tabcloser-alias')) {
        const name = node.nextElementSibling;
        const nameHandle = name?.dataset.tabcloserAliasFor;
        if (!name?.classList.contains('tabcloser-name-hidden') || !nameApplies(nameHandle) || !ownerMatches(name, nameHandle)) {
          node.remove();
          marked.delete(node);
        } else if (node.textContent !== aliasFor(nameHandle)) {
          node.textContent = aliasFor(nameHandle);
        }
      } else if (node.classList.contains('tabcloser-name-hidden')) {
        if (!node.previousElementSibling?.classList.contains('tabcloser-alias') || !nameApplies(handle) || !ownerMatches(node, handle)) {
          restoreName(node);
          marked.delete(node);
        }
      } else if (node.matches('.tabcloser-handle-hidden, .tabcloser-bio-hidden')) {
        if (!nameApplies(handle) || !ownerMatches(node, handle)) {
          if (node.previousElementSibling?.classList.contains('tabcloser-bio-notice')) node.previousElementSibling.remove();
          node.classList.remove('tabcloser-handle-hidden', 'tabcloser-bio-hidden');
          delete node.dataset.tabcloserAliasFor;
          marked.delete(node);
        }
      } else if (node.hasAttribute('data-tabcloser-collapsed')) {
        if (!collapseApplies(node, handle) || !ownerMatches(node, handle)) {
          uncollapse(node);
          marked.delete(node);
        }
      }
    }
  }

  function applyNamesWithin(target) {
    for (const container of within(target, nameContainerSelector)) {
      if (extensionOwnedElement(container)) continue;
      const handle = handleWithin(container);
      if (!nameApplies(handle)) continue;
      const name = nameElement(container);
      if (name && !name.classList.contains('tabcloser-name-hidden')) showAlias(name, handle);
      // Handles of adult accounts are often explicit too, so they go as well.
      for (const node of container.querySelectorAll('div[dir], span')) {
        if (!node.closest('.tabcloser-handle-hidden, .tabcloser-alias') && textOf(node).toLowerCase() === '@' + handle) {
          hideFor(node, 'tabcloser-handle-hidden', handle);
        }
      }
    }
    // Mentions and "Replying to @handle" links read as the alias.
    for (const link of within(target, 'a[href^="/"]')) {
      if (link.classList.contains('tabcloser-name-hidden') || link.closest(nameContainerSelector + ', .tabcloser-controls')) continue;
      const handle = (link.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/)?.[1].toLowerCase();
      if (nameApplies(handle) && textOf(link).toLowerCase() === '@' + handle) showAlias(link, handle);
    }
  }

  // On a flagged profile: the sticky top bar repeats the display name, and
  // the bio and website are often the most explicit text on the page. Only
  // flagged profile pages pay for this, so it may look at the whole page.
  function applyProfilePage() {
    const pageHandle = profileHandle();
    const hoverCards = document.querySelectorAll('[data-testid="HoverCard"]');
    if (!nameApplies(pageHandle) && !hoverCards.length) return;
    if (nameApplies(pageHandle)) {
      const names = new Set([...marked].filter(node => node.classList.contains('tabcloser-name-hidden') &&
        node.dataset.tabcloserAliasFor === pageHandle && !node.matches('a')).map(textOf).filter(Boolean));
      for (const heading of document.querySelectorAll('h2[role="heading"]')) {
        const child = heading.children.length === 1 ? heading.firstElementChild : null;
        if (child && !heading.closest(nameContainerSelector) && names.has(textOf(child))) showAlias(child, pageHandle);
      }
    }
    for (const bio of document.querySelectorAll('[data-testid="UserDescription"], [data-testid="UserUrl"]')) {
      const card = bio.closest('[data-testid="HoverCard"]');
      const owner = card ? handleWithin(card) : pageHandle;
      if (bio.classList.contains('tabcloser-bio-hidden') || !nameApplies(owner)) continue;
      hideFor(bio, 'tabcloser-bio-hidden', owner);
      if (bio.matches('[data-testid="UserDescription"]')) {
        const notice = document.createElement('div');
        notice.className = 'tabcloser-controls tabcloser-bio-notice';
        notice.textContent = 'Bio hidden by Custos';
        bio.insertAdjacentElement('beforebegin', notice);
      }
    }
  }

  // Profile tabs are titled "Name (@handle) / X"; both parts are replaced.
  function applyTitle() {
    const match = document.title.match(/^(\(\d+\+?\) )?(.+) \(@([A-Za-z0-9_]{1,15})\) \/ X$/);
    if (!match || !config.names || !flaggedHandle(match[3])) return;
    document.title = (match[1] || '') + aliasFor(match[3]) + ' / X';
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
    if (config.names) {
      // Name replacement hides the real @handle everywhere, this line included.
      text.textContent = config.alias === 'plain' ? 'Reply from a hidden account' : 'Reply from ' + aliasFor(handle);
    } else {
      text.textContent = 'Reply from a hidden account ';
      const at = document.createElement('span');
      at.className = 'tabcloser-collapsed-handle';
      at.textContent = '@' + handle;
      text.appendChild(at);
    }
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
  function applyCollapseWithin(target) {
    if (!statusIdFromHref(location.pathname)) return;
    for (const article of within(target, 'article')) {
      if (article.hasAttribute('data-tabcloser-collapsed')) continue;
      const handle = authorHandle(article);
      if (!collapseApplies(article, handle)) continue;
      article.setAttribute('data-tabcloser-collapsed', handle);
      article.prepend(collapsedNotice(article, handle));
      marked.add(article);
    }
  }

  function refresh() {
    refreshTimer = null;
    if (config.images !== 'off' && !styledOwnHandle && ownHandle()) buildStyle();
    const full = fullScan || location.pathname !== scannedPath;
    const targets = full ? [document] : outermost(pendingScan);
    fullScan = false;
    scannedPath = location.pathname;
    pendingScan.clear();
    if (marked.size) cleanup();
    // Names and collapse only ever apply to flagged accounts: with none seen,
    // there is nothing to scan.
    if (flaggedHandles.size && (config.names || config.collapse)) {
      for (const target of targets) {
        if (config.names) applyNamesWithin(target);
        if (config.collapse) applyCollapseWithin(target);
      }
      if (config.names) applyProfilePage();
    }
    if (full || titleChanged) applyTitle();
    titleChanged = false;
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
      updateFlaggedHandles();
      fullScan = true;
      buildStyle();
      refresh();
    }
    if (message?.type === 'xSensitiveMediaMetadata' && Array.isArray(message.metadata?.accounts) && message.metadata.accounts.length) {
      for (const account of message.metadata.accounts) remember(account);
      buildStyle();
      // A newly flagged account may already be on screen: rescan once.
      if (updateFlaggedHandles()) schedule();
    }
  });

  new MutationObserver(mutations => {
    const names = (config.names || config.collapse) && (flaggedHandles.size || marked.size);
    const ownPending = config.images !== 'off' && !styledOwnHandle;
    if (!names && !ownPending) return;
    for (const mutation of mutations) {
      if (mutation.target.nodeName === 'TITLE') { titleChanged = true; continue; }
      if (mutation.type === 'attributes') {
        // A changed profile link means the element now shows another account.
        if (!extensionOwnedElement(mutation.target)) {
          pendingScan.add(mutation.target.closest(nameContainerSelector) || mutation.target.closest('article') || mutation.target);
        }
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof Element && !extensionOwnedElement(node)) pendingScan.add(node);
      }
    }
    if (pendingScan.size || titleChanged) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });

  globalThis.TabCloserXProfile = {
    explain,
    collapsed: root => root instanceof Element && root.hasAttribute('data-tabcloser-collapsed'),
  };

  browser.storage.local.get('xProtection')
    .then(data => { config = normalize(data.xProtection?.profile); updateFlaggedHandles(); buildStyle(); refresh(); })
    .catch(() => buildStyle());
})();
