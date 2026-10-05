const params = new URLSearchParams(location.search);
const domain = params.get('domain') || '';
const until = parseInt(params.get('until') || '0', 10);
const adult = params.get('reason') === 'adult';

const $ = id => document.getElementById(id);
$('domain').textContent = domain;
document.title = `${domain || 'Site'} blocked · TabCloser`;
$('settings').addEventListener('click', () => browser.runtime.openOptionsPage());
// The only exits are settings and leaving: nothing here shortens a block.
$('closeTab').addEventListener('click', async () => {
  const tab = await browser.tabs.getCurrent().catch(() => null);
  if (tab?.id != null) browser.tabs.remove(tab.id).catch(() => {});
});

// "30 minutes" as a noun, "30-minute" before another noun.
function durationWords(sec, adjective = false) {
  const [amount, unit] = sec >= 3600 && sec % 3600 === 0 ? [sec / 3600, 'hour']
    : sec >= 60 ? [Math.round((sec / 60) * 100) / 100, 'minute'] : [sec, 'second'];
  return adjective ? amount + '-' + unit : amount + ' ' + unit + (amount === 1 ? '' : 's');
}

function show(id, text, className) {
  const node = $(id);
  node.hidden = !text;
  node.textContent = text || '';
  if (className != null) node.className = className;
}

async function state() {
  return browser.runtime.sendMessage({ type: 'getState' }).catch(() => null);
}

async function renderAdultBlock() {
  const config = (await state())?.adultSites || {};
  $('countdown').hidden = true;
  $('badge').textContent = 'Adult-site protection';
  $('title').textContent = !config.enabled ? 'Protection is off' : config.error ? 'Navigation is paused' : 'This site is blocked';
  show('statement', config.error || (config.enabled
    ? 'This domain is on the bundled list of known adult websites.'
    : 'Adult-site protection is off. You can navigate back manually.'), 'statement' + (config.error ? ' warn' : ''));
  $('why').textContent = config.enabled
    ? 'Matching happens on this device. If this is a mistake, the protection can be switched off in settings once it is no longer locked.'
    : '';
  show('lockNote', config.enabled && config.lockUntil > Date.now() ? 'Protection is locked until ' + formatLockDate(config.lockUntil) : '');
}

let rule = null;

function renderTimer() {
  const remaining = Math.max(0, (until - Date.now()) / 1000);
  if (remaining <= 0) {
    $('card').classList.add('expired');
    $('title').textContent = 'Your break is over';
    $('countdown').hidden = true;
    show('statement', 'The block has ended.' + (rule ? ' Your ' + durationWords(rule.closeAfterSec, true) + ' timer starts again when you go back.' : ''), 'statement ok');
    $('why').textContent = 'You can navigate back to the site manually.';
    show('lockNote', '');
    return false;
  }
  $('time').textContent = formatDuration(remaining);
  if (rule?.blockDurationSec) {
    const total = rule.blockDurationSec * 1000;
    $('progressBar').hidden = false;
    $('progress').style.width = Math.min(100, Math.max(0, (1 - (until - Date.now()) / total) * 100)) + '%';
  }
  $('why').textContent = rule
    ? 'Your tabs for this site closed after ' + durationWords(rule.closeAfterSec) + ' of active time. The ' +
      durationWords(rule.blockDurationSec, true) + ' block is part of the timer you set.'
    : 'The site timer for this domain is cooling down.';
  show('lockNote', rule?.lockUnblock && rule.disableLockedUntil > Date.now()
    ? 'Early unblock is locked until ' + formatLockDate(rule.disableLockedUntil) : '');
  return true;
}

if (adult) {
  renderAdultBlock();
  setInterval(renderAdultBlock, 1000);
} else {
  state().then(s => {
    const key = normalizeRuleDomain(domain);
    rule = s?.rules?.find(item => normalizeRuleDomain(item.domain) === key) || null;
    renderTimer();
  });
  if (renderTimer()) {
    const id = setInterval(() => {
      if (!renderTimer()) clearInterval(id);
    }, 500);
  }
}
