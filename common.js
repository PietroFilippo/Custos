// Shared helpers, attached to global scope (loaded in background + popup + options + blocked).

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function hostFromUrl(url) {
  try {
    const parsed = new URL(url);
    // "x.com." is the same site as "x.com"; a trailing dot must not escape rules.
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase().replace(/\.+$/, '') : null;
  } catch {
    return null;
  }
}

function normalizeRuleDomain(d) {
  if (!d) return '';
  return d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '');
}

function hostMatches(host, ruleDomain) {
  if (!host || !ruleDomain) return false;
  const rd = normalizeRuleDomain(ruleDomain);
  if (!rd) return false;
  return host === rd || host.endsWith('.' + rd);
}

// Shared by enforcement and UI so overlapping domains have the same meaning.
function ruleForHost(rules, host) {
  return rules.reduce((best, rule) => {
    if (!rule.enabled || !hostMatches(host, rule.domain)) return best;
    return !best || normalizeRuleDomain(rule.domain).length > normalizeRuleDomain(best.domain).length
      ? rule : best;
  }, null);
}

function activeBlockForHost(blocks, host, now = Date.now()) {
  let match = null;
  for (const [key, block] of Object.entries(blocks)) {
    if (block.until <= now || !hostMatches(host, key)) continue;
    // A shorter child cooldown never cancels a longer parent cooldown.
    if (!match || block.until > match.block.until ||
        (block.until === match.block.until && key.length > match.key.length)) {
      match = { key, block };
    }
  }
  return match;
}

function formatDuration(totalSec) {
  totalSec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Lock copy shared by settings, the popup, and the block page.
// Long locks show their year so "until 3 Nov" is never ambiguous.
const otherYear = until => new Date(until).getFullYear() !== new Date().getFullYear();

function formatLockDate(until) {
  return new Date(until).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    ...(otherYear(until) ? { year: 'numeric' } : {}),
  });
}

function formatShortDate(until) {
  return new Date(until).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(otherYear(until) ? { year: 'numeric' } : {}) });
}

// "4 d 11 h", "3 h 5 min", "12 min"; never rounds a live lock down to zero.
function formatTimeLeft(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return minutes + ' min';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' h' + (minutes % 60 ? ' ' + (minutes % 60) + ' min' : '');
  const days = Math.floor(hours / 24);
  return days + ' d' + (hours % 24 ? ' ' + (hours % 24) + ' h' : '');
}

// Single unit for compact chips: "6 d", "4 h", "12 min".
function formatTimeLeftShort(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return minutes + ' min';
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? hours + ' h' : Math.floor(hours / 24) + ' d';
}
