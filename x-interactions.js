// User-facing controls are separate from classifier verdicts. A reveal only
// changes presentation; it never marks media safe or resumes video playback.
(() => {
  let snapshot = { posts: [], media: [], revealDailySec: 0, locked: false };
  let posts = new Set(), texts = new Set(), media = new Set();
  // "Not sensitive" marks: active ones release their image; pending ones show
  // when they take effect.
  let safeActive = new Set(), safePending = new Map();
  let contextTarget = null, panel = null, panelRoot = null, allowanceText = null, holdButton = null, meter = null;
  let holding = false, requestGeneration = 0, lease = null, revealTimer = null, refreshTimer = null;
  let allowanceTimer = null;
  let revealStarted = 0, revealDuration = 0, revealPage = '';
  const marked = new Set();
  const manualRoots = new Set();
  const manualTexts = new Map();
  const send = message => browser.runtime.sendMessage(message);
  const seconds = ms => ms > 0 && ms < 100 ? '<0.1' : (Math.max(0, ms || 0) / 1000).toFixed(1);
  const textHidden = root => root?.matches?.('[data-testid="tweetText"]') && (posts.has(statusIdFor(root)) || texts.has(statusIdFor(root)));

  function manuallyHidden(root) {
    return textHidden(root) || posts.has(statusIdFor(root)) || media.has(stableMediaVerificationKey(root));
  }
  function markedNotSensitive(root) {
    return safeActive.has(stableMediaVerificationKey(root));
  }
  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    if (action) element.addEventListener('click', action);
    return element;
  }
  function isolateControls(element) {
    for (const type of ['click', 'auxclick', 'dblclick', 'keydown', 'keyup', 'pointerdown', 'pointerup']) {
      element.addEventListener(type, event => {
        // Media controls can live inside X's photo link. Cancel its default
        // navigation and stop the event before reaching X's delegated handlers.
        if (['click', 'auxclick', 'dblclick'].includes(type)) event.preventDefault();
        event.stopPropagation();
      });
    }
  }
  // The reason section of "Why hidden?": a short kind label plus the detail.
  function explanation(root) {
    if (textHidden(root)) return { kind: 'Hidden by you', text: 'You chose to hide this post’s text. The choice is saved on this device.' };
    const profile = globalThis.TabCloserXProfile?.explain?.(root);
    if (profile) return profile;
    const reason = root.dataset.tabcloserMediaReason;
    if (reason === 'manual') return { kind: 'Hidden by you', text: 'You chose to hide this image or video. The choice is saved on this device.' };
    if (reason === 'group') return { kind: 'Same post', text: 'Another image or video in this post was hidden, and “Hide all of a post’s media when one is hidden” is on.' };
    if (reason === 'metadata') return { kind: 'X label', text: 'X supplied a sensitive-content label or warning for this media, post, or author. Labels come from X or the poster and can be wrong.' };
    if (reason !== 'visual') return { kind: 'Could not check', text: 'The media could not be checked (' + (reason || 'unknown error') + '). It stays covered while Custos retries when possible.' };
    const decision = TabCloserXCoordinator.decisionFor(root);
    if (!decision) return { kind: 'On-device classifier', text: 'The on-device model flagged this media during an earlier check in this page. Models can make mistakes.' };
    let text = 'The on-device model flagged the ' + decision.source + '.';
    if (Number.isFinite(decision.adultScore)) text += ' Score ' + decision.adultScore.toFixed(3) + ', cutoff ' + decision.threshold.toFixed(2) + ' (' + decision.sensitivity + ').';
    if (decision.frames?.length) {
      if (decision.aggregate === 'strong-consensus') text += ' Lenient video protection requires two full frames scoring at least ' + (decision.threshold * 2).toFixed(2) + '.';
      text += ' Checked ' + decision.samplesChecked + ' frame(s); decision: ' + decision.aggregate + '. Frame scores: ' +
        decision.frames.map(frame => frame.t + 's: ' + frame.squash + (frame.crop == null ? '' : ' / crop ' + frame.crop)).join('; ') + '.';
    }
    if (decision.fallback) text += ' ' + decision.fallback + '; the thumbnail was used as a fallback.';
    return { kind: 'On-device classifier', text: text + ' Scores are model signals, not certainty. Harmless media can be flagged.' };
  }
  function decorate(root, state) {
    if (state !== 'protected') return;
    const overlay = overlayFor(root);
    if (!overlay || overlay.querySelector('.tabcloser-controls')) return;
    const tools = document.createElement('div');
    tools.className = 'tabcloser-controls tabcloser-media-actions';
    isolateControls(tools);
    tools.appendChild(button('Why hidden?', () => openPanel(root)));
    overlay.appendChild(tools);
    if (lease) paintReveal();
  }
  function closePanel() {
    stopReveal();
    clearInterval(allowanceTimer); allowanceTimer = null;
    const previousRoot = panelRoot;
    panel?.remove(); panel = null; panelRoot = null; holdButton = null; allowanceText = null; meter = null;
    // Return keyboard focus to the control that opened the panel without
    // scrolling the page back to it: the reader may have moved on.
    (manualTexts.get(previousRoot) || overlayFor(previousRoot || document.documentElement))?.querySelector('button')?.focus({ preventScroll: true });
  }
  function panelSection(...children) {
    const section = document.createElement('div');
    section.className = 'tabcloser-panel-section';
    section.append(...children);
    return section;
  }
  function paragraph(text, className) {
    const element = document.createElement('p');
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }
  function messagePanel(text, title = 'Custos', kind = '') {
    closePanel();
    panel = document.createElement('section');
    panel.className = 'tabcloser-controls tabcloser-control-panel';
    isolateControls(panel);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', title);
    const head = document.createElement('header');
    head.className = 'tabcloser-panel-head';
    const heading = document.createElement('strong');
    heading.textContent = title;
    head.append(heading, button('Close', closePanel));
    const label = kind ? paragraph(kind, 'tabcloser-kind') : null;
    panel.append(head, panelSection(...[label, paragraph(text)].filter(Boolean)));
    document.documentElement.appendChild(panel);
    panel.querySelector('button').focus({ preventScroll: true });
  }
  const perPostSec = source => source?.revealPerPostSec || (source?.postLimitMs ? source.postLimitMs / 1000 : 3);
  function renderAllowance(result, root) {
    const available = Math.floor(Math.min(result.dailyMs || 0, result.postMs || 0));
    allowanceText.textContent = result.revealDailySec <= 0
      ? 'Temporary reveals are off. Set a daily allowance in Custos settings.'
      : result.dailyMs < 1
        ? 'Daily allowance used up. Reveals return at local midnight.'
        : result.postMs < 1
          ? 'This post has used its ' + perPostSec(result) + ' seconds today. It can be revealed again after local midnight.'
          : seconds(available) + ' s left for this post · ' + seconds(result.dailyMs) + ' s left today · resets at local midnight';
    meter.style.width = (result.revealDailySec > 0 ? Math.min(100, (available / (result.postLimitMs || 3000)) * 100) : 0) + '%';
    holdButton.disabled = !statusIdFor(root) || result.revealDailySec <= 0 || available < 1;
  }
  async function updateAllowance(root) {
    const target = panel;
    const result = await send({ type: 'xControlGet', postId: statusIdFor(root) }).catch(() => null);
    if (target !== panel || !result?.ok || lease || holding) return;
    renderAllowance(result, root);
  }
  function openPanel(root) {
    const reason = explanation(root);
    messagePanel(reason.text, 'Why hidden?', reason.kind);
    panelRoot = root;
    const heading = document.createElement('h4');
    heading.textContent = 'Temporary reveal';
    const details = paragraph('Hold the button to show this post’s hidden media and text for up to ' + perPostSec(snapshot) + ' seconds a day. Videos stay paused. Let go or leave this tab to hide it again.', 'tabcloser-control-note');
    const track = document.createElement('div');
    track.className = 'tabcloser-meter';
    track.setAttribute('aria-hidden', 'true');
    meter = document.createElement('div');
    meter.style.width = '0%';
    track.appendChild(meter);
    allowanceText = paragraph('Checking allowance…', 'tabcloser-allowance');
    allowanceText.setAttribute('role', 'status');
    holdButton = button('Hold to reveal');
    holdButton.className = 'tabcloser-hold';
    holdButton.disabled = true;
    holdButton.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      holdButton.focus({ preventScroll: true });
      startReveal(root);
    });
    holdButton.addEventListener('pointerleave', stopReveal);
    holdButton.addEventListener('keydown', event => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (!event.repeat) startReveal(root);
    });
    holdButton.addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) stopReveal(); });
    holdButton.addEventListener('blur', stopReveal);
    const reveal = panelSection(heading, details, track, allowanceText, holdButton);
    panel.appendChild(reveal);
    const markSection = notSensitiveSection(root);
    if (markSection) panel.appendChild(markSection);
    if (manuallyHidden(root)) {
      const scope = posts.has(statusIdFor(root)) ? 'post' : textHidden(root) ? 'text' : 'media';
      const key = scope !== 'media' ? statusIdFor(root) : stableMediaVerificationKey(root);
      const undo = button('Remove manual hide', async () => {
        const result = await send({ type: 'xControlRemove', scope, key }).catch(() => null);
        if (result?.ok) { applySnapshot(result); closePanel(); }
        else allowanceText.textContent = result?.error || 'Unable to remove this hide.';
      });
      undo.className = 'tabcloser-secondary';
      undo.disabled = snapshot.locked;
      undo.title = snapshot.locked ? 'X protection is locked' : '';
      reveal.appendChild(undo);
    }
    updateAllowance(root);
    allowanceTimer = setInterval(() => { if (!lease && !holding && panelRoot === root) updateAllowance(root); }, 1000);
  }
  // "Not sensitive" marks are offered only for an image, video, or GIF the
  // classifier hid. A mark takes effect a day later and only for borderline
  // detections; the background re-checks the media before accepting it.
  function notSensitiveSection(root) {
    if (manuallyHidden(root) || root.dataset.tabcloserMediaReason !== 'visual') return null;
    const decision = TabCloserXCoordinator.decisionFor(root);
    const key = stableMediaVerificationKey(root);
    const video = TabCloserXCoordinator.isVideoRoot(root);
    const noun = video ? 'video' : 'image';
    const markUrl = mediaElementsWithin(root, 'video').map(item => item.poster).find(Boolean) ||
      sourceValues(root).find(value => value && !value.startsWith('blob:'));
    if (!key || !markUrl || !/^https:\/\/pbs\.twimg\.com\//.test(markUrl)) return null;
    // An image hidden only by its post's video verdict is released through
    // that video's mark.
    if (!video && decision && decision.source !== 'image') return null;
    const heading = document.createElement('h4');
    heading.textContent = 'Not sensitive?';
    const status = paragraph('', 'tabcloser-control-note');
    status.setAttribute('role', 'status');
    const section = panelSection(heading, status);
    const pendingAt = safePending.get(key);
    if (pendingAt) {
      status.textContent = 'Marked not sensitive. It will show from ' + formatLockDate(pendingAt) + '.';
      const cancel = button('Cancel mark', async () => {
        const result = await send({ type: 'xControlUnmarkSafe', key }).catch(() => null);
        if (result?.ok) applySnapshot(result);
        else status.textContent = result?.error || 'Unable to cancel the mark.';
      });
      cancel.className = 'tabcloser-secondary';
      section.appendChild(cancel);
      return section;
    }
    if (!(snapshot.safeMarksPerDay > 0)) {
      status.textContent = snapshot.allowanceLocked
        ? '“Not sensitive” marks are off, and a lock keeps them off' + (snapshot.allowanceLockUntil ? ' until ' + formatLockDate(snapshot.allowanceLockUntil) : '') + '.'
        : 'If this ' + noun + ' is harmless, you can turn on “Not sensitive” marks in Custos settings. A mark takes effect a day later.';
      return section;
    }
    if (!video && decision?.scores && !TabCloserXVerdict.markEligible(decision.scores)) {
      status.textContent = 'This detection is too confident to mark as not sensitive.';
      return section;
    }
    const left = snapshot.safeMarksLeft || 0;
    if (left <= 0) {
      status.textContent = 'No “Not sensitive” marks left today.';
      return section;
    }
    status.textContent = 'If the classifier got this wrong, mark it. Custos checks the ' + noun + ' again; it stays hidden for 24 hours, then shows on this device. ' +
      left + ' of ' + snapshot.safeMarksPerDay + ' marks left today.';
    const mark = button('Mark not sensitive…');
    mark.className = 'tabcloser-secondary';
    mark.addEventListener('click', async () => {
      // Two steps, like "Unblock now": the first click only asks.
      if (mark.dataset.confirm !== 'yes') {
        mark.dataset.confirm = 'yes';
        mark.textContent = 'Confirm: show it in 24 hours';
        return;
      }
      mark.disabled = true;
      status.textContent = 'Checking the ' + noun + ' again…';
      // The background samples the video file itself, so it needs its address.
      const videoSource = video ? await directVideoSourceForRoot(root, false).catch(() => null) : null;
      const result = await send({ type: 'xControlMarkSafe', key, url: markUrl, videoSource }).catch(() => null);
      if (result?.ok) {
        applySnapshot(result);
        messagePanel('Marked not sensitive. This ' + noun + ' will show from ' + formatLockDate(result.activeAt) +
          '. Undo it in “Why hidden?” or in Custos settings.', 'Custos');
        return;
      }
      if (!mark.isConnected) return;
      status.textContent = result?.error || 'Unable to save the mark.';
      mark.remove();
    });
    section.appendChild(mark);
    return section;
  }
  async function startReveal(root) {
    if (!holdButton || holdButton.disabled || holding || lease || document.visibilityState !== 'visible' || !document.hasFocus() || !root.isConnected || (root.dataset.tabcloserMediaState !== 'protected' && !textHidden(root) && !globalThis.TabCloserXProfile?.collapsed(root))) return;
    holding = true;
    const generation = ++requestGeneration;
    const page = location.href;
    const result = await send({ type: 'xControlRevealStart', postId: statusIdFor(root) }).catch(() => null);
    if (!result?.ok) {
      if (generation === requestGeneration) {
        holding = false;
        if (allowanceText && Number.isFinite(result?.dailyMs)) renderAllowance(result, root);
        else if (allowanceText) allowanceText.textContent = result?.error || 'Unable to start reveal.';
      }
      return;
    }
    if (!holding || generation !== requestGeneration || !root.isConnected || page !== location.href || document.visibilityState !== 'visible' || !document.hasFocus()) {
      send({ type: 'xControlRevealEnd', token: result.token, postId: result.postId }).catch(() => {});
      return;
    }
    lease = result;
    revealDuration = Math.min(result.durationMs, result.deadline - Date.now());
    revealStarted = performance.now();
    revealPage = page;
    closeLightbox();
    if (revealDuration <= 0) { stopReveal(); return; }
    paintReveal();
    revealTimer = setInterval(() => {
      if (!panelRoot?.isConnected || statusIdFor(panelRoot) !== lease?.postId || revealPage !== location.href || document.visibilityState !== 'visible' || !document.hasFocus() || remainingReveal() <= 0) {
        stopReveal(); return;
      }
      if (allowanceText) allowanceText.textContent = 'Visible for ' + seconds(remainingReveal()) + 's more';
    }, 40);
  }
  function remainingReveal() {
    return lease ? Math.max(0, Math.min(lease.deadline - Date.now(), revealDuration - (performance.now() - revealStarted))) : 0;
  }
  function mark(element, attribute) {
    if (!element || element.hasAttribute(attribute)) return;
    element.style.setProperty('--tabcloser-peek-ms', remainingReveal() + 'ms');
    element.setAttribute(attribute, '');
    marked.add(element);
  }
  function paintReveal() {
    if (!lease || remainingReveal() <= 0) return;
    document.querySelectorAll('[data-tabcloser-media-state="protected"]').forEach(root => {
      if (statusIdFor(root) !== lease.postId) return;
      mark(root, 'data-tabcloser-revealed');
      mark(overlayFor(root), 'data-tabcloser-overlay-revealed');
      for (const player of mediaPlayersWithin(root)) blockMediaPlayback(player);
    });
    // A collapsed reply from a flagged account unfolds for the same lease.
    document.querySelectorAll('article[data-tabcloser-collapsed]').forEach(article => {
      if (statusIdFor(article) === lease.postId) mark(article, 'data-tabcloser-collapse-revealed');
    });
    document.querySelectorAll('.tabcloser-hidden-text, .tabcloser-quote, .tabcloser-manual-text-notice').forEach(node => {
      if (statusIdFor(node) === lease.postId) mark(node, node.classList.contains('tabcloser-hidden-text') ? 'data-tabcloser-text-revealed' : 'data-tabcloser-quote-revealed');
    });
  }
  function stopReveal() {
    holding = false; requestGeneration += 1;
    clearInterval(revealTimer); revealTimer = null;
    for (const node of marked) {
      for (const name of ['data-tabcloser-revealed', 'data-tabcloser-overlay-revealed', 'data-tabcloser-text-revealed', 'data-tabcloser-quote-revealed', 'data-tabcloser-collapse-revealed']) node.removeAttribute(name);
      node.style.removeProperty('--tabcloser-peek-ms');
    }
    marked.clear();
    const previous = lease; lease = null;
    if (previous) send({ type: 'xControlRevealEnd', token: previous.token, postId: previous.postId })
      .catch(() => {}).finally(() => { if (panelRoot) updateAllowance(panelRoot); });
  }
  // Elements X added since the last refresh. A full refresh (new choices,
  // settings change) scans the document; otherwise only these are scanned.
  const pendingScan = new Set();
  let fullScan = true;
  function scanTargets() {
    if (fullScan) return [document];
    const connected = [...pendingScan].filter(node => node.isConnected);
    return connected.filter(node => !connected.some(other => other !== node && other.contains(node)));
  }
  function textsWithin(target) {
    const found = new Set(target.querySelectorAll ? target.querySelectorAll('[data-testid="tweetText"]') : []);
    const own = target instanceof Element ? target.closest('[data-testid="tweetText"]') : null;
    if (own) found.add(own);
    return found;
  }
  function refresh() {
    fullScan = true;
    runRefresh();
  }
  function runRefresh() {
    refreshTimer = null;
    const targets = scanTargets();
    const full = fullScan;
    fullScan = false;
    pendingScan.clear();
    for (const [text, notice] of manualTexts) {
      if (!text.isConnected || !textHidden(text)) {
        notice.remove(); manualTexts.delete(text);
        delete text.dataset.tabcloserManualText;
        if (text.dataset.tabcloserQuoted !== 'yes') text.classList.remove('tabcloser-hidden-text');
      }
    }
    if (posts.size || texts.size) {
      for (const text of targets.flatMap(target => [...textsWithin(target)])) {
        if (!textHidden(text)) continue;
        text.dataset.tabcloserManualText = '';
        text.classList.add('tabcloser-hidden-text');
        if (manualTexts.get(text)?.isConnected) continue;
        const notice = document.createElement('div');
        notice.className = 'tabcloser-controls tabcloser-manual-text-notice';
        notice.append('Text hidden by you. ', button('Why hidden?', () => openPanel(text)));
        isolateControls(notice);
        text.insertAdjacentElement('afterend', notice);
        manualTexts.set(text, notice);
      }
    }
    for (const root of [...manualRoots]) {
      if (!root.isConnected || !manuallyHidden(root)) {
        manualRoots.delete(root);
        if (root.isConnected) {
          setRootState(root, 'safe', 'manual-removed');
          delete root.dataset.tabcloserMediaState;
          delete root.dataset.tabcloserMediaReason;
          TabCloserXCoordinator.invalidate(root);
          discoverWithin(root);
        }
      }
    }
    if (posts.size || media.size) {
      const roots = new Set(targets.flatMap(target => candidateRootsWithin(target)));
      for (const root of roots) {
        if (!manuallyHidden(root)) continue;
        manualRoots.add(root);
        if (root.dataset.tabcloserMediaReason !== 'manual' || !overlayFor(root)) setRootState(root, 'protected', 'manual');
      }
    }
    // The coordinator decorates covers as it draws them; a full pass is only
    // a safety net for covers drawn before this script was ready.
    if (full) document.querySelectorAll('[data-tabcloser-media-state="protected"]').forEach(root => decorate(root, 'protected'));
    if (lease) {
      if (!panelRoot?.isConnected || revealPage !== location.href) stopReveal();
      else paintReveal();
    }
  }
  function applySnapshot(next) {
    stopReveal();
    if (panelRoot) closePanel();
    snapshot = next;
    posts = new Set(next.posts || []); texts = new Set(next.texts || []); media = new Set(next.media || []);
    const previousActive = safeActive;
    const marks = Array.isArray(next.safeMarks) ? next.safeMarks : [];
    safeActive = new Set(marks.filter(mark => mark.active).map(mark => mark.key));
    safePending = new Map(marks.filter(mark => !mark.active).map(mark => [mark.key, mark.activeAt]));
    refresh();
    refreshMarked(previousActive);
  }
  // Re-check media whose mark just took effect or was removed. The cover
  // stays up, as a pending check, until the new verdict arrives.
  function refreshMarked(previousActive) {
    const changed = new Set([...safeActive].filter(key => !previousActive.has(key)));
    for (const key of previousActive) if (!safeActive.has(key)) changed.add(key);
    if (!changed.size) return;
    document.querySelectorAll('[data-tabcloser-media-state]').forEach(root => {
      if (!changed.has(stableMediaVerificationKey(root)) || manuallyHidden(root)) return;
      TabCloserXCoordinator.recheckForMark(root);
    });
  }
  document.addEventListener('contextmenu', event => {
    contextTarget = event.target instanceof Element ? event.target : null;
  }, true);
  document.addEventListener('pointerup', stopReveal, true);
  document.addEventListener('pointercancel', stopReveal, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') stopReveal(); });
  window.addEventListener('blur', stopReveal);
  window.addEventListener('pagehide', stopReveal);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && panel) { event.preventDefault(); closePanel(); } }, true);
  // Which manual hides make sense for what was right-clicked: none for media
  // that is already covered, or for post text that is already hidden or
  // replaced by a quote.
  function contextMenuState() {
    const target = contextTarget?.isConnected ? contextTarget : null;
    const root = target && mediaRootFor(target);
    const media = !!root && !!stableMediaVerificationKey(root) && root.dataset.tabcloserMediaState !== 'protected';
    const article = target?.closest('article');
    const statusId = target && statusIdFor(target);
    const texts = article && statusId ? [...article.querySelectorAll('[data-testid="tweetText"]')].filter(text => statusIdFor(text) === statusId) : [];
    const text = texts.some(item => !textHidden(item) && item.dataset.tabcloserQuoted !== 'yes' && !item.classList.contains('tabcloser-hidden-text'));
    return { media, text };
  }
  browser.runtime.onMessage.addListener(message => {
    if (message?.type === 'xContextMenuState') return Promise.resolve(contextMenuState());
    if (message?.type === 'xControlsChanged') applySnapshot(message.snapshot);
    if (message?.type === 'xManualHideSelection') {
      const target = contextTarget;
      contextTarget = null;
      if (!target?.isConnected) { messagePanel('Right-click a post or its media first.'); return; }
      const root = mediaRootFor(target);
      const key = message.scope === 'text' ? statusIdFor(target) : root && stableMediaVerificationKey(root);
      if (!key || (message.scope === 'text' && !target.closest('article'))) {
        messagePanel('Choose a post, image, or video with a stable X link. Avatars and profile banners are not supported by manual hiding yet.'); return;
      }
      send({ type: 'xControlHide', scope: message.scope, key }).then(result => {
        if (result?.ok) { applySnapshot(result); messagePanel('Saved. This ' + (message.scope === 'text' ? 'post’s text' : 'image or video') + ' will stay hidden. Manage manual hides in Custos settings.'); }
        else messagePanel(result?.error || 'Unable to save the manual hide.');
      }).catch(() => messagePanel('Unable to save the manual hide.'));
    }
  });
  new MutationObserver(mutations => {
    if (!posts.size && !texts.size && !media.size && !lease) return;
    let relevant = false;
    for (const mutation of mutations) {
      if (extensionOwnedElement(mutation.target)) continue;
      relevant = true;
      // A changed src/href can change a media identity; added nodes may be
      // new posts. Text-only churn (counters, times) needs no scan.
      // A changed link can mean X reused this post's element for another
      // post: rescan the whole post, including its text.
      if (mutation.type === 'attributes') pendingScan.add(mutation.target.closest?.('article') || mutation.target);
      else for (const node of mutation.addedNodes) if (node instanceof Element && !extensionOwnedElement(node)) pendingScan.add(node);
    }
    if (!relevant) return;
    if (lease && (!panelRoot?.isConnected || statusIdFor(panelRoot) !== lease.postId || revealPage !== location.href)) stopReveal();
    if (refreshTimer == null && (pendingScan.size || lease)) refreshTimer = setTimeout(runRefresh, 50);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'poster', 'href'] });
  globalThis.TabCloserXInteractions = { manuallyHidden, markedNotSensitive, decorate, refresh, stopReveal, openPanel };
  send({ type: 'xControlGet' }).then(result => { if (result?.ok) applySnapshot(result); else refresh(); }).catch(() => refresh());
})();
