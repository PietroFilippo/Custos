const $rules = document.getElementById('rules');
const $save = document.getElementById('saveStatus');
const $add = document.getElementById('addRule');
const $glance = document.getElementById('glance');
const $xLevelRadios = [...document.querySelectorAll('input[name="xLevel"]')];
const $xSensitivityRadios = [...document.querySelectorAll('input[name="xSensitivity"]')];
const $xSacredArt = document.getElementById('xSacredArt');
const $xReplaceText = document.getElementById('xReplaceText');
const $xBlockLike = document.getElementById('xBlockLike');
const $xGroupMedia = document.getElementById('xGroupMedia');
const $xReveal = document.getElementById('xRevealDailySec');
const $xRevealPerPost = document.getElementById('xRevealPerPostSec');
const $xRevealStatus = document.getElementById('xRevealStatus');
const $xManualHides = document.getElementById('xManualHides');
const $xSafeMarksPerDay = document.getElementById('xSafeMarksPerDay');
const $xSafeMarks = document.getElementById('xSafeMarks');
const $adultEnabled = document.getElementById('adultSitesEnabled');
const $adultSafeSearch = document.getElementById('adultSafeSearch');
const $profile = {
  markers: document.getElementById('xProfileMarkers'),
  images: [...document.querySelectorAll('input[name="xProfileImages"]')],
  avatars: document.getElementById('xProfileAvatars'),
  banners: document.getElementById('xProfileBanners'),
  names: document.getElementById('xProfileNames'),
  alias: [...document.querySelectorAll('input[name="xProfileAlias"]')],
  collapse: document.getElementById('xProfileCollapse'),
};
document.getElementById('extensionVersion').textContent = `Version ${browser.runtime.getManifest().version}`;

const sensitivityRank = { lenient: 0, balanced: 1, strict: 2 };
const imageScopeRank = { off: 0, flagged: 1, everyone: 2 };
const levelLabels = { off: 'Off', labels: 'X labels only', classifier: 'Labels + classifier' };
const lockPresets = [['1 hour', 3600], ['1 day', 86400], ['1 week', 604800], ['30 days', 2592000]];

let snapshot = { rules: [], accumSec: {}, blocks: {}, focus: {}, xProtection: {} };
let workingRules = null;
let saveT = null;
let manualListKey = '';
let safeListKey = '';
let revealDraft = false;

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
      if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return e;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Rebuilds a region only when what it shows changes, so a 1 s refresh never
// steals keyboard focus or closes an open lock popover.
function renderOnce(container, key, build) {
  if (container.dataset.renderKey === key) return;
  container.dataset.renderKey = key;
  container.replaceChildren(...[].concat(build() || []).filter(Boolean));
}

function feedback(id, message, error = false) {
  const node = document.getElementById(id);
  clearTimeout(Number(node.dataset.timer));
  node.textContent = message;
  node.classList.toggle('feedback-error', error);
  if (!error) node.dataset.timer = String(setTimeout(() => { node.textContent = ''; }, 3000));
}

// Inline two-click confirm: native confirm() is unreliable on extension option
// pages (Firefox can return false even on OK), so the button asks for a second
// click instead. Reverts after a few seconds if not confirmed.
function armConfirm(button, confirmLabel, onConfirm) {
  if (button.dataset.armed === 'yes') {
    clearTimeout(Number(button.dataset.armTimer));
    delete button.dataset.armed;
    onConfirm();
    return;
  }
  const original = button.textContent;
  button.dataset.armed = 'yes';
  button.classList.add('confirming');
  button.textContent = confirmLabel;
  const timer = setTimeout(() => {
    delete button.dataset.armed;
    button.classList.remove('confirming');
    button.textContent = original;
  }, 3500);
  button.dataset.armTimer = String(timer);
}

function isLocked(until) {
  return Number.isFinite(until) && until > Date.now();
}

function durationSecUntilDate(dateInput) {
  if (!dateInput.value) return null;
  const target = new Date(dateInput.value).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.round((target - Date.now()) / 1000);
}

function minutesText(sec) {
  return String(Math.round((sec / 60) * 100) / 100) + ' min';
}

// === Locks: one control and one banner for every lockable setting ===
let openPopover = null;

function closePopover(focusTrigger = false) {
  if (!openPopover) return;
  const { pop, trigger } = openPopover;
  openPopover = null;
  pop.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  if (focusTrigger) trigger.focus();
}

document.addEventListener('click', event => {
  if (openPopover && !(event.target instanceof Element && event.target.closest('.lock-control'))) closePopover();
});

// onLock(durationSec) resolves to an error message, or nothing on success.
function lockControl({ label = 'Lock…', title, scope, help, onLock }) {
  let choice = 86400;
  const trigger = el('button', { type: 'button', class: 'btn btn-lock btn-sm lock-icon', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, label);
  const dateInput = el('input', { class: 'input', type: 'datetime-local', 'aria-label': 'Lock until' });
  const dateField = el('label', { class: 'date-field', hidden: true }, ['Until', dateInput]);
  const error = el('p', { class: 'lock-error', role: 'alert' });
  const confirm = el('button', { type: 'button', class: 'btn btn-primary btn-sm' }, 'Lock for 1 day');
  const cancel = el('button', { type: 'button', class: 'btn btn-quiet btn-sm' }, 'Cancel');
  const presets = [...lockPresets, ['Until a date…', 'date']].map(([text, value]) => {
    const button = el('button', { type: 'button', 'aria-pressed': String(value === choice) }, text);
    button.addEventListener('click', () => {
      choice = value;
      for (const other of presets) other.setAttribute('aria-pressed', String(other === button));
      dateField.hidden = value !== 'date';
      confirm.textContent = value === 'date' ? 'Lock until date' : 'Lock for ' + text;
      error.textContent = '';
      if (value === 'date') dateInput.focus();
    });
    return button;
  });
  const pop = el('div', { class: 'lock-popover', role: 'dialog', 'aria-label': title, hidden: true }, [
    el('p', { class: 'lock-popover-title' }, title),
    scope ? el('p', { class: 'scope' }, scope) : null,
    el('p', { class: 'help' }, help),
    el('div', { class: 'presets', role: 'group', 'aria-label': 'Lock duration' }, presets),
    dateField,
    error,
    el('div', { class: 'actions' }, [cancel, confirm]),
  ]);
  trigger.addEventListener('click', () => {
    const opening = pop.hidden;
    closePopover();
    if (!opening) return;
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    openPopover = { pop, trigger };
    presets.find(button => button.getAttribute('aria-pressed') === 'true')?.focus();
  });
  cancel.addEventListener('click', () => closePopover(true));
  pop.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); closePopover(true); }
  });
  confirm.addEventListener('click', async () => {
    const durationSec = choice === 'date' ? durationSecUntilDate(dateInput) : choice;
    if (durationSec == null || durationSec < 60) {
      error.textContent = 'Choose a date at least one minute from now.';
      return;
    }
    confirm.disabled = true;
    const message = await onLock(durationSec);
    confirm.disabled = false;
    if (message) error.textContent = message;
    else closePopover();
  });
  return el('div', { class: 'lock-control' }, [trigger, pop]);
}

function lockBanner(until, help, title = 'Locked until ' + formatLockDate(until)) {
  return el('div', { class: 'lock-banner' }, el('div', null, [
    el('strong', null, title),
    ' · ' + formatTimeLeft(until - Date.now()) + ' left',
    el('span', { class: 'help' }, help),
  ]));
}

// A lock banner's "time left" changes each minute; only then is it redrawn.
function lockKey(until) {
  return isLocked(until) ? 'locked:' + until + ':' + Math.ceil((until - Date.now()) / 60000) : 'open';
}

// === Snapshot ===
function defaultRule() {
  return {
    id: uuid(),
    domain: '',
    closeAfterSec: 180,
    blockAfterClose: true,
    blockDurationSec: 1800,
    lockUnblock: true,
    enabled: true,
    disableLockedUntil: null,
  };
}

async function refreshSnapshot() {
  snapshot = await browser.runtime.sendMessage({ type: 'getState' });
}

async function initialLoad() {
  await refreshSnapshot();
  workingRules = snapshot.rules.map(rule => ({ ...rule }));
  render();
  renderSettings();
}

// === Site timers ===
function render() {
  closePopover();
  clear($rules);
  if (!workingRules || !workingRules.length) {
    $rules.appendChild(el('p', { class: 'empty-list' }, 'No sites yet. Use “+ Add site” to set a limit.'));
    return;
  }
  workingRules.forEach(rule => $rules.appendChild(renderRule(rule)));
}

function setStatus(card, rule) {
  const key = normalizeRuleDomain(rule.domain);
  const accum = snapshot.accumSec?.[key] ?? 0;
  const applicableBlock = key ? activeBlockForHost(snapshot.blocks || {}, key) : null;
  const block = applicableBlock?.block;
  const blockActive = applicableBlock?.key === key;
  const counting = !!key && snapshot.focus?.domain === key && snapshot.focus.enteredAt != null;
  const locked = isLocked(rule.disableLockedUntil);
  const remainingBlock = block ? (block.until - Date.now()) / 1000 : 0;

  card.classList.toggle('is-counting', counting && !applicableBlock);
  card.classList.toggle('is-blocked', !!applicableBlock);
  card.classList.toggle('is-locked', locked && !applicableBlock && !counting);
  const pill = card.querySelector('.rule-head .pill');
  pill.hidden = !key;
  pill.className = 'pill ' + (applicableBlock ? 'pill-blocked' : counting ? 'pill-counting' : '');
  pill.textContent = applicableBlock ? 'Blocked · ' + formatTimeLeftShort(remainingBlock * 1000)
    : !rule.enabled ? 'Off' : counting ? 'Counting' : 'Paused';

  const usage = card.querySelector('.rule-usage');
  const pct = blockActive ? 100 : Math.min(100, (accum / rule.closeAfterSec) * 100);
  const fill = blockActive ? 'danger' : pct > 90 ? 'danger' : pct > 60 ? 'warn' : '';
  const lines = [el('div', { class: 'bar' }, el('div', { class: 'bar-fill' + (fill ? ' ' + fill : ''), style: `width:${pct}%` }))];
  if (blockActive) {
    lines.push(el('p', { class: 'status-line warn' }, ['Blocked for ', el('strong', null, formatDuration(remainingBlock)), ' more. The timer resets when the block ends.']));
  } else {
    lines.push(el('p', { class: 'status-line' }, [
      el('strong', null, formatDuration(accum)), ' of ' + formatDuration(rule.closeAfterSec) + ' used · ',
      counting ? 'closes in ' + formatDuration(rule.closeAfterSec - accum) : 'resumes when a tab is focused',
    ]));
  }
  if (applicableBlock && !blockActive) {
    lines.push(el('p', { class: 'status-line warn' },
      `Blocked by ${applicableBlock.key} for ${formatDuration(remainingBlock)}. Manage that site's rule to unblock.`));
  }
  usage.replaceChildren(...lines);

  const buttons = card.querySelector('.rule-buttons');
  const children = [];
  // A locked timer keeps counting: resetting it would undo the lock.
  if (!locked) {
    const reset = el('button', { type: 'button', class: 'btn btn-quiet btn-sm', 'data-action': 'reset' }, 'Reset timer');
    reset.addEventListener('click', async () => {
      const response = await browser.runtime.sendMessage({ type: 'resetAccum', domain: rule.domain });
      if (!response?.ok) showSaveError(response?.error);
      await refreshSnapshot();
      setStatus(card, rule);
    });
    children.push(reset);
  }
  if (blockActive) {
    if (rule.lockUnblock && isLocked(rule.disableLockedUntil)) {
      children.push(el('span', { class: 'status-line warn lock-icon' }, 'Early unblock is locked'));
    } else {
      const unblock = el('button', { type: 'button', class: 'btn btn-amber btn-sm', 'data-action': 'unblock' }, 'Unblock now');
      unblock.addEventListener('click', () => armConfirm(unblock, 'Confirm unblock', async () => {
        const response = await browser.runtime.sendMessage({ type: 'unblock', domain: rule.domain });
        if (!response.ok) showSaveError(response.error);
        await refreshSnapshot();
        setStatus(card, rule);
      }));
      children.push(unblock);
    }
  }
  // Keep an armed "Confirm unblock" button through the 1 s refresh.
  if (!buttons.querySelector('[data-armed="yes"]')) buttons.replaceChildren(...children);
}

function ruleScope(rule) {
  const domain = normalizeRuleDomain(rule.domain) || 'This site';
  return domain + ' · ' + minutesText(rule.closeAfterSec) +
    (rule.blockAfterClose ? ', then blocked for ' + minutesText(rule.blockDurationSec) : ', no block after close');
}

function renderRule(rule) {
  const locked = isLocked(rule.disableLockedUntil);
  // While locked, edits may only make the rule stricter; the saved rule is
  // the baseline the background compares against.
  const base = (locked && snapshot.rules.find(item => item.id === rule.id)) || rule;
  const card = el('article', { class: 'rule' + (rule.enabled ? '' : ' disabled'), 'data-locked': String(locked) });

  const domainInput = el('input', { class: 'input domain-input', type: 'text', placeholder: 'e.g. x.com', 'aria-label': 'Domain', disabled: locked });
  domainInput.value = rule.domain;
  const enabledCheckbox = el('input', { type: 'checkbox', disabled: locked });
  enabledCheckbox.checked = rule.enabled;
  const delBtn = el('button', { class: 'btn btn-icon btn-danger del', type: 'button', 'aria-label': 'Delete site', disabled: locked }, '×');
  card.appendChild(el('div', { class: 'rule-head' }, [
    domainInput,
    el('span', { class: 'pill', hidden: true }),
    el('span', { class: 'spacer' }),
    el('label', { class: 'switch' }, [enabledCheckbox, el('span', null, 'Enabled')]),
    delBtn,
  ]));

  const closeAfterInput = el('input', { class: 'input input-num', type: 'number', min: '0.1', step: '0.1',
    max: locked ? String(Math.round((base.closeAfterSec / 60) * 100) / 100) : null });
  closeAfterInput.value = String(Math.round((rule.closeAfterSec / 60) * 100) / 100);
  const blockCheckbox = el('input', { type: 'checkbox', disabled: locked && base.blockAfterClose, 'aria-label': 'Block after close' });
  blockCheckbox.checked = rule.blockAfterClose;
  const blockDurInput = el('input', { class: 'input input-num', type: 'number', step: '0.1', 'aria-label': 'Block duration in minutes',
    min: locked && base.blockAfterClose ? String(Math.round((base.blockDurationSec / 60) * 100) / 100) : '0.1', disabled: !rule.blockAfterClose });
  blockDurInput.value = String(Math.round((rule.blockDurationSec / 60) * 100) / 100);
  card.appendChild(el('div', { class: 'rule-fields' }, [
    el('label', { class: 'field' }, ['Close after', closeAfterInput, 'min of active time']),
    el('span', { class: 'field' }, [el('label', { class: 'check' }, [blockCheckbox, el('span', null, 'Block for')]), blockDurInput, 'min after close']),
  ]));

  const lockUnblockCheckbox = el('input', { type: 'checkbox', disabled: locked && !!base.lockUnblock });
  lockUnblockCheckbox.checked = !!rule.lockUnblock;
  card.appendChild(el('div', { class: 'rule-fields' }, [
    el('label', { class: 'check' }, [lockUnblockCheckbox, el('span', null, 'A lock also prevents “Unblock now”')]),
  ]));

  if (locked) {
    card.appendChild(lockBanner(rule.disableLockedUntil, 'Until then the rule can only get stricter: a shorter limit or a longer block. The domain, the enable switch, delete, and resets are unavailable' +
      (base.lockUnblock ? ', and so is early unblock.' : '; “Unblock now” stays available.')));
  }

  const actions = el('div', { class: 'rule-actions' }, el('div', { class: 'rule-buttons' }));
  if (!locked) {
    actions.appendChild(lockControl({
      title: 'Lock this rule',
      scope: ruleScope(rule),
      help: 'Until the lock ends, the rule can’t be changed, turned off, or deleted' +
        (rule.lockUnblock ? ', and its block can’t be ended early' : '') + '. A lock can’t be shortened.',
      async onLock(durationSec) {
        const saved = await save();
        if (!saved) return $save.textContent;
        const response = await browser.runtime.sendMessage({ type: 'lockRule', id: rule.id, durationSec });
        if (!response.ok) return response.error;
        await initialLoad();
      },
    }));
  }
  card.appendChild(el('div', { class: 'rule-foot' }, [el('div', { class: 'rule-usage status' }), actions]));
  setStatus(card, rule);

  domainInput.addEventListener('input', event => { rule.domain = event.target.value; scheduleSave(); });
  closeAfterInput.addEventListener('input', event => {
    const value = parseFloat(event.target.value);
    if (!isNaN(value) && value > 0) {
      rule.closeAfterSec = Math.max(1, Math.round(value * 60));
      scheduleSave();
    }
  });
  blockCheckbox.addEventListener('change', event => {
    rule.blockAfterClose = event.target.checked;
    blockDurInput.disabled = !rule.blockAfterClose;
    scheduleSave();
  });
  blockDurInput.addEventListener('input', event => {
    const value = parseFloat(event.target.value);
    if (!isNaN(value) && value > 0) {
      rule.blockDurationSec = Math.max(1, Math.round(value * 60));
      scheduleSave();
    }
  });
  lockUnblockCheckbox.addEventListener('change', event => {
    rule.lockUnblock = event.target.checked;
    scheduleSave();
  });
  enabledCheckbox.addEventListener('change', event => {
    rule.enabled = event.target.checked;
    card.classList.toggle('disabled', !rule.enabled);
    scheduleSave();
  });
  delBtn.addEventListener('click', () => {
    const index = workingRules.findIndex(item => item.id === rule.id);
    if (index < 0) return;
    const [removed] = workingRules.splice(index, 1);
    render();
    scheduleSave();
    showUndoToast(removed.domain, () => {
      workingRules.splice(Math.min(index, workingRules.length), 0, removed);
      render();
      scheduleSave();
    });
  });
  return card;
}

function showSaveError(message) {
  $save.textContent = message || 'Unable to save.';
  $save.className = 'save-status error';
}

let undoTimer = null;
function showUndoToast(domain, onUndo) {
  document.querySelector('.tabcloser-toast')?.remove();
  clearTimeout(undoTimer);
  const label = domain && domain.trim() ? domain : 'Site';
  const toast = el('div', { class: 'tabcloser-toast', role: 'status' }, [
    el('span', null, label + ' removed'),
    el('button', { type: 'button', class: 'btn btn-green btn-sm' }, 'Undo'),
  ]);
  toast.querySelector('button').addEventListener('click', () => {
    clearTimeout(undoTimer);
    toast.remove();
    onUndo();
  });
  document.body.appendChild(toast);
  undoTimer = setTimeout(() => toast.remove(), 5000);
}

function scheduleSave() {
  if (saveT) clearTimeout(saveT);
  $save.textContent = 'Saving…';
  $save.className = 'save-status';
  saveT = setTimeout(save, 400);
}

async function save() {
  if (!workingRules) return false;
  if (saveT) {
    clearTimeout(saveT);
    saveT = null;
  }
  const rules = workingRules.filter(rule => rule.domain && rule.domain.trim().length > 0);
  const response = await browser.runtime.sendMessage({ type: 'saveRules', rules });
  if (!response.ok) {
    showSaveError(response.error);
    // Keep the draft visible so validation errors (such as duplicate domains)
    // can be corrected without losing other unsaved edits.
    return false;
  }
  $save.textContent = 'All changes saved';
  $save.className = 'save-status saved';
  return true;
}

// === At a glance and section nav ===
function lockChip(text) {
  return el('span', { class: 'lock-chip' }, text);
}

function glanceCard(href, name, pill, pillClass, value, detail, attention = false) {
  return el('a', { href }, [
    el('div', { class: 'g-top' }, [el('span', { class: 'g-name' }, name), el('span', { class: 'pill ' + pillClass }, pill)]),
    el('div', { class: 'g-value' }, value),
    el('div', { class: 'g-detail' + (attention ? ' attention' : '') }, detail),
  ]);
}

function sectionLocks() {
  const x = snapshot.xProtection || {};
  const timerLocks = (snapshot.rules || []).filter(rule => rule.enabled && isLocked(rule.disableLockedUntil));
  const xLocks = [x.labeled?.enabled && x.labeled.lockUntil, x.model?.enabled && x.model.lockUntil, x.revealLockUntil].filter(isLocked);
  return {
    timers: timerLocks.length,
    adult: snapshot.adultSites?.enabled && isLocked(snapshot.adultSites.lockUntil) ? 1 : 0,
    x: xLocks.length,
  };
}

function renderGlance() {
  const now = Date.now();
  const rules = (snapshot.rules || []).filter(rule => rule.enabled);
  const domains = [...new Set(rules.map(rule => normalizeRuleDomain(rule.domain)))];
  const blocked = domains.filter(domain => activeBlockForHost(snapshot.blocks || {}, domain, now)).length;
  const locks = sectionLocks();
  const adult = snapshot.adultSites || {};
  const x = snapshot.xProtection || {};
  const level = x.model?.enabled ? 'classifier' : x.labeled?.enabled ? 'labels' : 'off';
  const xLockUntil = level === 'classifier' && isLocked(x.model?.lockUntil) ? x.model.lockUntil
    : level !== 'off' && isLocked(x.labeled?.lockUntil) ? x.labeled.lockUntil : null;
  const sensitivity = sensitivityRank[x.model?.sensitivity] != null ? x.model.sensitivity : 'balanced';
  const reveal = x.revealDailySec || 0;
  const cards = [
    ['#site-timers', 'Site timers', domains.length ? 'On' : 'Off', domains.length ? 'pill-on' : '',
      domains.length ? domains.length + (domains.length === 1 ? ' site' : ' sites') : 'No sites',
      [blocked ? blocked + ' blocked' : domains.length ? 'Counting active time' : 'Add a site to start', locks.timers ? lockChip(locks.timers + ' locked') : null]],
    ['#adult-sites', 'Adult websites', adult.enabled ? adult.error ? 'Attention' : 'On' : 'Off',
      adult.enabled ? adult.error ? 'pill-attention' : 'pill-on' : '',
      adult.enabled ? Number(adult.listCount || 0).toLocaleString() + ' domains' : 'Not blocking',
      adult.enabled && adult.error ? ['List unavailable · navigation held'] : [adult.safeSearch && adult.enabled ? 'SafeSearch on' : null,
        locks.adult ? lockChip('Locked until ' + formatShortDate(adult.lockUntil)) : adult.enabled ? 'Not locked' : null],
      adult.enabled && !!adult.error],
    ['#x-protection', 'X protection', level === 'off' ? 'Off' : 'On', level === 'off' ? '' : 'pill-on', levelLabels[level],
      [level === 'classifier' ? sensitivity[0].toUpperCase() + sensitivity.slice(1) : level === 'labels' ? 'No on-device checks' : 'Media shows as X shows it',
        xLockUntil ? lockChip('Locked until ' + formatShortDate(xLockUntil)) : null]],
    ['#x-reveals', 'Temporary reveals', reveal > 0 ? 'On' : 'Off', '', reveal > 0 ? reveal + ' s per day' : 'Reveals off',
      [isLocked(x.revealLockUntil) ? lockChip('Locked until ' + formatShortDate(x.revealLockUntil)) : 'Not locked']],
  ];
  renderOnce($glance, JSON.stringify(cards.map(card => card.map(part => Array.isArray(part)
    ? part.map(item => item?.textContent ?? item) : part))), () => cards.map(card => glanceCard(...card)));

  for (const link of document.querySelectorAll('.side-nav a[data-section]')) {
    const count = locks[link.dataset.section];
    const label = link.dataset.label || (link.dataset.label = link.textContent.trim());
    renderOnce(link, label + ':' + count, () => [label, count ? lockChip('Locked') : null]);
  }
}

// Mark the section nearest the top of the viewport as current.
if ('IntersectionObserver' in window) {
  const links = [...document.querySelectorAll('.side-nav a[href^="#"]')];
  const byId = new Map(links.map(link => [link.getAttribute('href').slice(1), link]));
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of links) link.removeAttribute('aria-current');
      byId.get(entry.target.id)?.setAttribute('aria-current', 'true');
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  for (const id of byId.keys()) {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  }
}

// === Adult websites ===
function renderAdultSites() {
  const config = snapshot.adultSites || {};
  const locked = isLocked(config.lockUntil);
  $adultEnabled.checked = config.enabled === true;
  $adultEnabled.disabled = locked;
  $adultSafeSearch.checked = config.safeSearch === true;
  // The lock keeps blocking on; SafeSearch stays editable.
  $adultSafeSearch.disabled = config.enabled !== true;
  const pill = document.getElementById('adultPill');
  pill.textContent = config.enabled ? config.error ? 'Attention' : 'On' : 'Off';
  pill.className = 'pill ' + (config.enabled ? config.error ? 'pill-attention' : 'pill-on' : '');
  const status = document.getElementById('adultListStatus');
  status.textContent = config.error || (config.enabled
    ? Number(config.listCount || 0).toLocaleString() + ' domains · list bundled ' + new Date(config.listUpdatedAt).toLocaleDateString()
    : 'Off. Turn on to use the bundled list.');
  status.className = 'status-line' + (config.error ? ' warn' : '');
  renderOnce(document.getElementById('adultLock'), lockKey(config.lockUntil) + ':' + !!config.enabled, () => {
    if (locked) {
      return lockBanner(config.lockUntil, 'Blocking can’t be switched off until then; SafeSearch stays editable. After the lock ends, blocking stays on until you turn it off.');
    }
    if (!config.enabled) return null;
    return [
      el('p', { class: 'help' }, 'Lock it to keep blocking on for a while. A lock can’t be shortened.'),
      lockControl({
        title: 'Lock adult-site blocking',
        scope: 'Block known adult websites',
        help: 'Until the lock ends, blocking can’t be switched off. SafeSearch stays editable. A lock can’t be shortened.',
        async onLock(durationSec) {
          const response = await changeAdultSites({ type: 'lockAdultSites', durationSec });
          return response?.ok ? null : response?.error || 'Unable to lock.';
        },
      }),
    ];
  });
}

async function changeAdultSites(message) {
  const response = await browser.runtime.sendMessage(message);
  feedback('adultFeedback', response?.ok ? 'Saved.' : response?.error || 'Unable to save.', !response?.ok);
  await refreshSnapshot();
  renderSettings();
  return response;
}

$adultEnabled.addEventListener('change', event => changeAdultSites({ type: 'saveAdultSites', enabled: event.target.checked }));
$adultSafeSearch.addEventListener('change', event => changeAdultSites({ type: 'saveAdultSites', enabled: $adultEnabled.checked, safeSearch: event.target.checked }));

// === X protection ===
function xLocks() {
  const config = snapshot.xProtection || {};
  return {
    labeled: config.labeled?.enabled === true && isLocked(config.labeled.lockUntil),
    model: config.model?.enabled === true && isLocked(config.model.lockUntil),
  };
}

function renderXProtection() {
  const config = snapshot.xProtection || {};
  const labeled = config.labeled || {};
  const model = config.model || {};
  const locks = xLocks();
  const level = model.enabled ? 'classifier' : labeled.enabled ? 'labels' : 'off';
  for (const radio of $xLevelRadios) {
    radio.checked = radio.value === level;
    // Locks only allow stepping up: a locked label tier cannot go Off, and a
    // locked classifier keeps the level at "Labels + classifier".
    radio.disabled = (radio.value === 'off' && (locks.labeled || locks.model)) ||
      (radio.value === 'labels' && locks.model);
  }
  const sensitivity = sensitivityRank[model.sensitivity] != null ? model.sensitivity : 'balanced';
  for (const radio of $xSensitivityRadios) {
    radio.checked = radio.value === sensitivity;
    radio.disabled = model.enabled !== true || (locks.model && sensitivityRank[radio.value] < sensitivityRank[sensitivity]);
  }
  renderLevelLock(config, level, sensitivity, locks);

  $xSacredArt.checked = config.sacredArt === true;
  $xReplaceText.checked = config.replaceText === true;
  $xBlockLike.checked = config.blockLike === true;
  $xGroupMedia.checked = config.groupMedia === true;
  renderReveals(config, locks);
  renderProfile(config);
  renderManualHides(snapshot.xUserControls || { posts: [], media: [] });
  renderSafeMarks(config, locks, snapshot.xUserControls || {});
}

function renderLevelLock(config, level, sensitivity, locks) {
  const labelsUntil = config.labeled?.lockUntil;
  const modelUntil = config.model?.lockUntil;
  const key = [level, sensitivity, locks.model ? lockKey(modelUntil) : '', locks.labeled ? lockKey(labelsUntil) : ''].join('|');
  renderOnce(document.getElementById('xLevelLock'), key, () => {
    const parts = [];
    if (locks.model) {
      parts.push(lockBanner(modelUntil, 'You can still raise the sensitivity, but not lower it or switch the level down.' +
        (labelsUntil > modelUntil ? ' After that, X labels stay locked until ' + formatLockDate(labelsUntil) + '.' : ''),
      'Locked at “Labels + classifier” until ' + formatLockDate(modelUntil)));
    } else if (locks.labeled) {
      parts.push(lockBanner(labelsUntil, 'The level can’t be switched Off until then. Adding the classifier is still allowed.',
        'Locked at “X labels” or stronger until ' + formatLockDate(labelsUntil)));
    }
    const target = level === 'classifier' ? 'model' : level === 'labels' ? 'labeled' : null;
    if (target && !locks[target]) {
      if (!parts.length) parts.push(el('p', { class: 'help' }, 'Lock the level to keep it from being lowered for a while.'));
      parts.push(lockControl({
        label: 'Lock level…',
        title: 'Lock X protection',
        scope: level === 'classifier' ? 'Labels + classifier · ' + sensitivity[0].toUpperCase() + sensitivity.slice(1) : 'X labels only',
        help: 'Until the lock ends, the level can only go up' + (level === 'classifier' ? ' and the sensitivity can only be raised' : '') +
          '. Manual hides can’t be removed and the reveal allowance can’t grow. A lock can’t be shortened.',
        async onLock(durationSec) {
          const response = await browser.runtime.sendMessage({ type: 'lockXProtection', target, durationSec });
          await refreshSnapshot();
          renderSettings();
          return response?.ok ? null : response?.error || 'Unable to lock.';
        },
      }));
    }
    return parts;
  });
}

async function saveXProtection(change) {
  const response = await browser.runtime.sendMessage({ type: 'saveXProtection', ...change });
  if (!response?.ok) showSaveError(response?.error);
  await refreshSnapshot();
  renderSettings();
  return response;
}

for (const radio of $xLevelRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    saveXProtection({ labeled: radio.value !== 'off', model: radio.value === 'classifier' });
  });
}
for (const radio of $xSensitivityRadios) {
  radio.addEventListener('change', () => { if (radio.checked) saveXProtection({ sensitivity: radio.value }); });
}
$xSacredArt.addEventListener('change', () => saveXProtection({ sacredArt: $xSacredArt.checked }));
$xReplaceText.addEventListener('change', () => saveXProtection({ replaceText: $xReplaceText.checked }));
$xBlockLike.addEventListener('change', () => saveXProtection({ blockLike: $xBlockLike.checked }));
$xGroupMedia.addEventListener('change', () => saveXProtection({ groupMedia: $xGroupMedia.checked }));

// === Temporary reveals ===
function renderReveals(config, locks) {
  const controls = snapshot.xUserControls || { dailyMs: 0 };
  const revealLocked = isLocked(config.revealLockUntil);
  const xLocked = locks.labeled || locks.model;
  if (!revealDraft) $xReveal.value = config.revealDailySec || 0;
  $xReveal.max = xLocked || revealLocked ? config.revealDailySec || 0 : 50;
  // Per-post time follows the allowance's lock rule: it may only go down.
  const perPost = Number.isInteger(config.revealPerPostSec) ? config.revealPerPostSec : 3;
  $xRevealPerPost.value = String(perPost);
  for (const option of $xRevealPerPost.options) option.disabled = (xLocked || revealLocked) && Number(option.value) > perPost;
  const dailyMs = controls.dailyMs || 0;
  $xRevealStatus.textContent = config.revealDailySec > 0
    ? (dailyMs > 0 ? (Math.ceil(dailyMs / 100) / 10).toFixed(1) + ' s left today · resets at local midnight' : 'Daily allowance used up. Resets at local midnight.')
    : 'Temporary reveals are off.';
  $xRevealStatus.className = 'status-line reveal-status' + (config.revealDailySec > 0 && dailyMs > 0 ? ' ok' : '');
  renderOnce(document.getElementById('xRevealLock'), lockKey(config.revealLockUntil) + ':' + xLocked + ':' + (config.revealDailySec || 0), () => {
    if (revealLocked) return lockBanner(config.revealLockUntil, 'The allowance can only go down until then.', 'Allowance locked until ' + formatLockDate(config.revealLockUntil));
    const seconds = config.revealDailySec || 0;
    return [
      el('p', { class: 'help' }, xLocked
        ? 'X protection is locked, so the allowance can only go down. Lock it separately to keep that after X protection unlocks.'
        : 'Locking stops the allowance from being raised until the lock ends; it can still be lowered. An X protection lock has the same effect.'),
      lockControl({
        label: 'Lock allowance…',
        title: 'Lock the reveal allowance',
        scope: seconds > 0 ? seconds + ' seconds per day' : 'Reveals off (0 seconds)',
        help: 'Until the lock ends, the allowance, the time per post, and “Not sensitive” marks can only go down. Locking 0 keeps reveals off. A lock can’t be shortened.',
        async onLock(durationSec) {
          if (!await saveRevealAllowance()) return document.getElementById('xRevealFeedback').textContent;
          const result = await browser.runtime.sendMessage({ type: 'lockXReveal', durationSec });
          if (result?.ok) feedback('xRevealFeedback', 'Allowance locked.');
          await refreshSnapshot();
          renderSettings();
          return result?.ok ? null : result?.error || 'Unable to lock.';
        },
      }),
    ];
  });
}

$xReveal.addEventListener('input', () => { revealDraft = true; });
async function saveRevealAllowance() {
  if (!$xReveal.value.trim() || !$xReveal.checkValidity()) {
    feedback('xRevealFeedback', 'Choose a whole number from 0 to ' + $xReveal.max + '.', true);
    return false;
  }
  const result = await browser.runtime.sendMessage({ type: 'saveXProtection', revealDailySec: Number($xReveal.value) });
  if (!result?.ok) {
    feedback('xRevealFeedback', result?.error || 'Unable to save.', true);
    return false;
  }
  revealDraft = false;
  feedback('xRevealFeedback', 'Reveal allowance saved.');
  await refreshSnapshot();
  renderSettings();
  return true;
}
document.getElementById('saveXReveal').addEventListener('click', saveRevealAllowance);
$xRevealPerPost.addEventListener('change', async () => {
  const result = await browser.runtime.sendMessage({ type: 'saveXProtection', revealPerPostSec: Number($xRevealPerPost.value) });
  feedback('xRevealFeedback', result?.ok ? 'Time per post saved.' : result?.error || 'Unable to save.', !result?.ok);
  await refreshSnapshot();
  renderSettings();
});

// === "Not sensitive" marks ===
// They share the reveal allowance's lock rule: under that lock or an X lock
// the daily number can only go down. Removing a mark is always allowed.
function renderSafeMarks(config, locks, controls) {
  const perDay = Number.isInteger(config.safeMarksPerDay) ? config.safeMarksPerDay : 0;
  const xLocked = locks.labeled || locks.model;
  const locked = xLocked || isLocked(config.revealLockUntil);
  $xSafeMarksPerDay.value = String(perDay);
  for (const option of $xSafeMarksPerDay.options) option.disabled = locked && Number(option.value) > perDay;
  const note = document.getElementById('xSafeLockNote');
  note.hidden = !locked;
  note.textContent = !locked ? '' : xLocked
    ? 'X protection is locked, so the number of marks can only go down.'
    : 'The allowance lock covers marks too: the number can only go down until it ends.';
  const marks = Array.isArray(controls.safeMarks) ? controls.safeMarks : [];
  const key = JSON.stringify(marks);
  if (key === safeListKey) return;
  safeListKey = key;
  const pending = marks.filter(mark => !mark.active).length;
  document.getElementById('xSafeSummary').textContent = marks.length
    ? marks.length + ' image' + (marks.length === 1 ? '' : 's') + ' marked' + (pending ? ' · ' + pending + ' waiting' : '')
    : 'No images marked';
  $xSafeMarks.replaceChildren(...(marks.length ? [] : [el('li', { class: 'empty' }, 'No images marked not sensitive.')]));
  for (const mark of marks) {
    const postId = mark.key.split('|')[0];
    const remove = el('button', { type: 'button', class: 'btn btn-sm' }, 'Remove');
    const row = el('li', null, [
      el('span', null, [
        el('span', { class: 'kind' }, mark.active ? 'Showing' : 'Shows ' + formatLockDate(mark.activeAt)),
        el('a', { href: 'https://x.com/i/status/' + postId, target: '_blank', rel: 'noopener noreferrer' }, 'x.com/i/status/' + postId),
      ]),
      remove,
    ]);
    row.title = mark.key.slice(mark.key.indexOf('|') + 1);
    remove.addEventListener('click', async () => {
      const result = await browser.runtime.sendMessage({ type: 'xControlUnmarkSafe', key: mark.key });
      if (!result?.ok) feedback('xSafeFeedback', result?.error || 'Unable to remove.', true);
      await refreshSnapshot();
      renderSettings();
    });
    $xSafeMarks.appendChild(row);
  }
}

$xSafeMarksPerDay.addEventListener('change', async () => {
  const result = await browser.runtime.sendMessage({ type: 'saveXProtection', safeMarksPerDay: Number($xSafeMarksPerDay.value) });
  feedback('xSafeFeedback', result?.ok ? 'Saved.' : result?.error || 'Unable to save.', !result?.ok);
  await refreshSnapshot();
  renderSettings();
});

// === Profile protection ===
function profileConfig(config) {
  const profile = config.profile || {};
  return {
    images: imageScopeRank[profile.images] != null ? profile.images : 'off',
    avatars: profile.avatars !== false,
    banners: profile.banners !== false,
    markers: profile.markers === true,
    names: profile.names === true,
    alias: profile.alias === 'plain' ? 'plain' : 'virtue',
    collapse: profile.collapse === true,
  };
}

// Profile protection stays editable during an X lock: it changes how
// accounts are shown, not whether media is hidden.
function renderProfile(config) {
  const profile = profileConfig(config);
  $profile.markers.checked = profile.markers;
  for (const radio of $profile.images) radio.checked = radio.value === profile.images;
  for (const key of ['avatars', 'banners']) {
    $profile[key].checked = profile[key];
    $profile[key].disabled = profile.images === 'off';
  }
  $profile.names.checked = profile.names;
  for (const radio of $profile.alias) {
    radio.checked = radio.value === profile.alias;
    radio.disabled = !profile.names;
  }
  $profile.collapse.checked = profile.collapse;
}

async function saveProfile(change) {
  const response = await browser.runtime.sendMessage({ type: 'saveXProfile', ...change });
  if (!response?.ok) feedback('xProfileFeedback', response?.error || 'Unable to save.', true);
  await refreshSnapshot();
  renderSettings();
}

$profile.markers.addEventListener('change', () => saveProfile({ markers: $profile.markers.checked }));
for (const radio of $profile.images) radio.addEventListener('change', () => { if (radio.checked) saveProfile({ images: radio.value }); });
for (const key of ['avatars', 'banners', 'names', 'collapse']) {
  $profile[key].addEventListener('change', () => saveProfile({ [key]: $profile[key].checked }));
}
for (const radio of $profile.alias) radio.addEventListener('change', () => { if (radio.checked) saveProfile({ alias: radio.value }); });

// === Manual hides ===
function renderManualHides(controls) {
  const key = JSON.stringify([controls.posts, controls.texts, controls.media, controls.locked]);
  if (key === manualListKey) return;
  manualListKey = key;
  const entries = [...(controls.posts || []).map(key => ({ scope: 'post', key })),
    ...(controls.texts || []).map(key => ({ scope: 'text', key })),
    ...(controls.media || []).map(key => ({ scope: 'media', key }))];
  document.getElementById('xManualSummary').textContent = entries.length + ' saved hide' + (entries.length === 1 ? '' : 's');
  const lockNote = document.getElementById('xManualLockNote');
  lockNote.hidden = !controls.locked;
  lockNote.textContent = controls.locked ? 'Removing hides is unavailable while X protection is locked.' : '';
  $xManualHides.replaceChildren(...(entries.length ? [] : [el('li', { class: 'empty' }, 'No manual hides yet.')]));
  for (const entry of entries) {
    const postId = entry.key.split('|')[0];
    const remove = el('button', { type: 'button', class: 'btn btn-sm', disabled: controls.locked }, 'Remove');
    const row = el('li', null, [
      el('span', null, [
        el('span', { class: 'kind' }, entry.scope === 'post' ? 'Text and media' : entry.scope === 'text' ? 'Text' : 'Media'),
        el('a', { href: 'https://x.com/i/status/' + postId, target: '_blank', rel: 'noopener noreferrer' }, 'x.com/i/status/' + postId),
      ]),
      remove,
    ]);
    if (entry.scope === 'media') row.title = entry.key.slice(entry.key.indexOf('|') + 1);
    remove.addEventListener('click', async () => {
      const result = await browser.runtime.sendMessage({ type: 'xControlRemove', ...entry });
      if (!result?.ok) showSaveError(result?.error);
      await refreshSnapshot();
      renderSettings();
    });
    $xManualHides.appendChild(row);
  }
}

// === Page ===
function renderSettings() {
  renderGlance();
  renderAdultSites();
  renderXProtection();
}

$add.addEventListener('click', () => {
  if (!workingRules) workingRules = [];
  workingRules.push(defaultRule());
  render();
  $rules.querySelector('.rule:last-child .domain-input')?.focus();
});

// Extensions do not run in private windows unless the user allows it there.
browser.extension?.isAllowedIncognitoAccess?.()
  .then(allowed => { document.getElementById('privateWarning').hidden = allowed !== false; })
  .catch(() => {});

setInterval(async () => {
  if (!workingRules) return;
  await refreshSnapshot();
  const cards = [...$rules.querySelectorAll('.rule')];
  const lockChanged = cards.some((card, index) => workingRules[index] &&
    card.dataset.locked !== String(isLocked(snapshot.rules.find(rule => rule.id === workingRules[index].id)?.disableLockedUntil)));
  if (lockChanged) {
    for (const rule of workingRules) rule.disableLockedUntil = snapshot.rules.find(item => item.id === rule.id)?.disableLockedUntil ?? rule.disableLockedUntil;
    render();
  } else {
    cards.forEach((card, index) => {
      const rule = workingRules[index];
      if (rule) setStatus(card, rule);
    });
  }
  renderSettings();
}, 1000);

initialLoad();
