const $current = document.getElementById('current');
const $active = document.getElementById('active');
const $activeMore = document.getElementById('activeMore');
const $blocks = document.getElementById('blocks');
const $activeCount = document.getElementById('activeCount');
const $blockCount = document.getElementById('blockCount');
const $blockMore = document.getElementById('blockMore');
const $activeSection = document.getElementById('activeSection');
const $blockSection = document.getElementById('blockSection');
const $error = document.getElementById('error');

const MAX_ROWS = 5;
let showAllActive = false;
let showAllBlocks = false;
let renderVersion = 0;

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
  }
  if (children != null) {
    for (const c of [].concat(children)) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return e;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function lockChip(text) {
  return el('span', { class: 'lock-chip' }, text);
}

function progressFor(rule, s) {
  const key = normalizeRuleDomain(rule.domain);
  const accum = s.accumSec[key] ?? 0;
  return Math.min(100, (accum / rule.closeAfterSec) * 100);
}

function renderActive(rule, s, now, compact = true) {
  const key = normalizeRuleDomain(rule.domain);
  const accum = s.accumSec[key] ?? 0;
  const limit = rule.closeAfterSec;
  const pct = progressFor(rule, s);
  const cls = pct > 90 ? 'danger' : pct > 60 ? 'warn' : '';
  const counting = s.focus?.domain === key && s.focus.enteredAt != null;
  const locked = rule.disableLockedUntil > now;

  return el('div', { class: 'row' + (counting ? ' active' : '') + (compact ? ' compact' : '') }, [
    el('div', { class: 'row-top' }, [
      el('div', { class: 'dom', title: key }, key),
      locked ? lockChip('Locked') : null,
      el('span', { class: 'pill' + (counting ? ' pill-counting' : '') }, counting ? 'Counting' : 'Paused'),
    ]),
    el('div', { class: 'bar' },
      el('div', { class: 'bar-fill' + (cls ? ' ' + cls : ''), style: `width:${pct}%` })
    ),
    el('div', { class: 'row-detail' }, [
      el('span', null, [el('strong', null, formatDuration(accum)), ' of ' + formatDuration(limit) + ' used']),
      el('span', { class: 'meta' }, counting ? 'closes in ' + formatDuration(limit - accum)
        : locked ? 'rule locked ' + formatTimeLeftShort(rule.disableLockedUntil - now) : 'resumes when focused'),
    ]),
  ]);
}

function renderBlock(key, b, now, blockedBy = key, { compact = true, note = null } = {}) {
  const remaining = Math.max(0, (b.until - now) / 1000);
  return el('div', { class: 'row blocked' + (compact ? ' compact' : '') }, [
    el('div', { class: 'row-top' }, [
      el('div', { class: 'dom', title: key }, key),
      el('span', { class: 'pill pill-blocked' }, 'Blocked'),
    ]),
    el('div', { class: 'row-detail' }, [
      el('span', { title: blockedBy !== key ? `Blocked by ${blockedBy}` : 'Includes subdomains' },
        blockedBy !== key ? `By ${blockedBy}` : 'Available in'),
      el('span', { class: 'meta countdown' }, formatDuration(remaining)),
    ]),
    note ? el('p', { class: 'row-note' }, note) : null,
  ]);
}

async function currentPage() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    const blockedPage = new URL(browser.runtime.getURL('blocked.html'));
    if (url.protocol === blockedPage.protocol && url.hostname === blockedPage.hostname &&
        url.pathname === blockedPage.pathname) {
      return { host: normalizeRuleDomain(url.searchParams.get('domain') || ''), blockedPage: true, adult: url.searchParams.get('reason') === 'adult' };
    }
    return { host: hostFromUrl(tab.url) };
  } catch {
    return { host: null };
  }
}

function updateOverflow(button, count, expanded) {
  button.hidden = count <= MAX_ROWS;
  button.setAttribute('aria-expanded', String(expanded && count > MAX_ROWS));
  button.textContent = expanded ? 'Show fewer' : `Show ${count - MAX_ROWS} more`;
}

function renderProtection(s, enabled, now) {
  const labeled = s.xProtection?.labeled || {};
  const model = s.xProtection?.model || {};
  const adult = s.adultSites || {};
  const modelOn = model.enabled === true;
  const labelsOn = labeled.enabled === true;
  const preset = ['lenient', 'balanced', 'strict'].includes(model.sensitivity) ? model.sensitivity : 'balanced';
  // The level lock is the classifier lock at the top level; otherwise a label
  // lock still keeps protection from being switched off.
  const xLock = modelOn && model.lockUntil > now ? lockChip('Locked ' + formatTimeLeftShort(model.lockUntil - now))
    : labelsOn && labeled.lockUntil > now ? lockChip('Labels locked ' + formatTimeLeftShort(labeled.lockUntil - now)) : null;
  const lockedRules = enabled.filter(r => r.disableLockedUntil > now).length;
  const blockedRules = enabled.filter(r => activeBlockForHost(s.blocks, normalizeRuleDomain(r.domain), now)).length;
  const adultAttention = adult.enabled && !!adult.error;
  const summaries = [
    { id: 'xOverview', name: 'X protection', value: modelOn || labelsOn ? 'On' : 'Off', tone: modelOn || labelsOn ? 'on' : 'off',
      detail: modelOn ? `${labelsOn ? 'Labels + ' : ''}classifier · ${preset[0].toUpperCase() + preset.slice(1)}` : labelsOn ? 'X labels only' : 'Automatic media protection off',
      lock: xLock },
    { id: 'adultOverview', name: 'Adult websites', value: adultAttention ? 'Attention' : adult.enabled ? 'On' : 'Off',
      tone: adultAttention ? 'attention' : adult.enabled ? 'on' : 'off',
      detail: adult.enabled ? adultAttention ? 'Domain list unavailable · navigation held'
        : Number(adult.listCount || 0).toLocaleString() + ' known domains' + (adult.safeSearch ? ' · SafeSearch' : '') : 'Known-domain blocking off',
      lock: adult.enabled && adult.lockUntil > now ? lockChip('Locked ' + formatTimeLeftShort(adult.lockUntil - now)) : null },
    { id: 'timersOverview', name: 'Site timers', value: enabled.length ? `${enabled.length} enabled` : 'Off', tone: enabled.length ? 'on' : 'off',
      detail: enabled.length ? [lockedRules ? `${lockedRules} locked` : null, blockedRules ? `${blockedRules} blocked` : null].filter(Boolean).join(' · ') || 'Count only active tab time'
        : 'Add a site in settings to start' },
  ];
  // Only display configuration here. Changes, including locked settings, use
  // the existing settings page and background enforcement.
  document.getElementById('protection').replaceChildren(...summaries.map(item =>
    el('li', { id: item.id, class: 'ov' }, [
      el('span', { class: 'ov-name' }, item.name),
      el('span', { class: 'pill' + (item.tone === 'on' ? ' pill-on' : item.tone === 'attention' ? ' pill-attention' : '') }, item.value),
      el('span', { class: 'ov-detail' + (item.tone === 'attention' ? ' attention' : '') }, item.detail),
      item.lock || null,
    ])
  ));
  const summary = document.getElementById('headerSummary');
  const allOn = (modelOn || labelsOn) && adult.enabled && enabled.length;
  const anyOn = modelOn || labelsOn || adult.enabled || enabled.length;
  summary.textContent = adultAttention ? 'Check settings' : allOn ? 'All protection on' : anyOn ? 'Partly on' : 'Protection off';
  summary.className = 'header-summary' + (adultAttention ? ' attention' : allOn ? ' on' : '');
}

function renderState(s, page) {
  const host = page.host;
  const now = Date.now();
  // Old installations may already contain duplicate domains. Show the same
  // enabled rule that enforcement uses until the user resolves them in settings.
  const enabled = [...new Map(s.rules.filter(r => r.enabled).map(r => {
    const key = normalizeRuleDomain(r.domain);
    return [key, ruleForHost(s.rules, key)];
  })).values()];
  renderProtection(s, enabled, now);
  const currentBlock = activeBlockForHost(s.blocks, host, now);
  // A child-domain cooldown need not block its parent's other hosts. Keep
  // that parent's independent timer in the tracked list.
  const adultBlocked = page.adult && s.adultSites?.enabled;
  const currentRule = currentBlock || adultBlocked ? null : ruleForHost(enabled, host);
  const currentKey = currentRule ? normalizeRuleDomain(currentRule.domain) : host;

  // Current site — always shown.
  clear($current);
  if (adultBlocked) {
    $current.appendChild(el('div', { class: 'row blocked' }, [
      el('div', { class: 'row-top' }, [el('div', { class: 'dom' }, host), el('span', { class: 'pill pill-blocked' }, 'Blocked')]),
      el('div', { class: 'row-detail' }, el('span', null, s.adultSites.error || 'Blocked by adult-site protection.')),
      el('p', { class: 'row-note' }, s.adultSites.lockUntil > now ? 'Protection is locked until ' + formatLockDate(s.adultSites.lockUntil) + '.' : 'Manage it in settings.'),
    ]));
  } else if (currentBlock) {
    const blockingRule = s.rules.find(r => normalizeRuleDomain(r.domain) === currentBlock.key);
    const unblockLocked = blockingRule?.lockUnblock && blockingRule.disableLockedUntil > now;
    $current.appendChild(renderBlock(currentKey, currentBlock.block, now, currentBlock.key, {
      compact: false, note: unblockLocked ? 'Early unblock is locked for this rule.' : null,
    }));
  } else if (currentRule) {
    $current.appendChild(renderActive(currentRule, s, now, false));
  } else {
    $current.appendChild(el('div', { class: 'row' }, [
      el('div', { class: 'row-top' }, el('div', { class: 'dom', title: host }, host || 'Browser page')),
      el('div', { class: 'row-detail' }, el('span', null, host
        ? (page.adult ? 'Adult-site protection is off.' : page.blockedPage ? 'Cooldown finished. You can return to the site.' : 'No timer for this site.')
        : 'Timers run on websites, not internal pages.')),
    ]));
  }

  // Blocked rules have one cooldown card, never a second zeroed timer card.
  clear($active);
  const others = enabled
    .filter(r => r !== currentRule && !(adultBlocked && r === ruleForHost(enabled, host)) && !activeBlockForHost(s.blocks, normalizeRuleDomain(r.domain), now))
    .sort((a, b) => progressFor(b, s) - progressFor(a, s) || a.domain.localeCompare(b.domain));
  $activeSection.hidden = !others.length;
  $activeCount.textContent = String(others.length);
  others.slice(0, showAllActive ? others.length : MAX_ROWS)
    .forEach(r => $active.appendChild(renderActive(r, s, now)));
  updateOverflow($activeMore, others.length, showAllActive);

  // Blocked — soonest to unblock first.
  clear($blocks);
  const blockEntries = Object.entries(s.blocks)
    .filter(([key, b]) => now < b.until && key !== currentBlock?.key && key !== currentKey)
    .map(([key]) => [key, activeBlockForHost(s.blocks, key, now)])
    .sort((a, b) => a[1].block.until - b[1].block.until || a[0].localeCompare(b[0]));
  $blockSection.hidden = !blockEntries.length;
  $blockCount.textContent = String(blockEntries.length);
  blockEntries.slice(0, showAllBlocks ? blockEntries.length : MAX_ROWS)
    .forEach(([key, match]) => $blocks.appendChild(renderBlock(key, match.block, now, match.key)));
  updateOverflow($blockMore, blockEntries.length, showAllBlocks);
}

async function render() {
  const version = ++renderVersion;
  try {
    const [s, page] = await Promise.all([
      browser.runtime.sendMessage({ type: 'getState' }), currentPage(),
    ]);
    if (version !== renderVersion) return;
    renderState(s, page);
    $error.hidden = true;
  } catch {
    if (version === renderVersion) $error.hidden = false;
  }
}

$activeMore.addEventListener('click', () => { showAllActive = !showAllActive; render(); });
$blockMore.addEventListener('click', () => { showAllBlocks = !showAllBlocks; render(); });
document.getElementById('openOptions').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});
// Extensions do not run in private windows unless the user allows it there.
browser.extension?.isAllowedIncognitoAccess?.()
  .then(allowed => { document.getElementById('privateNote').hidden = allowed !== false; })
  .catch(() => {});

render();
setInterval(render, 1000);
