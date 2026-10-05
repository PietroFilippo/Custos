# Project status — 5 October 2026

## Current development milestone: 0.5.0

0.5.0 renames the add-on from TabCloser to **Custos** (Latin “guardian”, after *custodia oculorum*, custody of the eyes) ahead of the first public release, and builds on the unreleased 0.4.1 with a redesigned interface, a blur-first presentation for hidden X media, profile protection on X, and fixes for coverage gaps. The add-on gets its permanent public ID `custos@pietrofilippo` (previously `tabcloser@personal.local`); a new ID is a separate Firefox add-on, so the existing development install must be set up again. Permissions are unchanged and new settings default off. A signed release has not been published.

Completed for 0.5.0 (5 October):

- **Blur by default.** Confirmed-sensitive X media stays in place, blurred and darkened, with a corner notice and “Why hidden?”. The blur radius scales with the media cell (fixed-radius fallback first, so an engine that rejected the scaled value would still blur). Clicking blurred media opens “Why hidden?”. **Cover hidden media with sacred art** is an opt-in presentation switch that stays editable under every lock and redraws covers without reclassifying. Upgraded installs move to the blur until it is switched on.
- **Redesign** following the mockups (kept outside Git): settings with at-a-glance status cards, a sticky section menu with lock badges, single column, inline helper text instead of hover tooltips, an Off / X labels / Labels + classifier level selector, and one **Lock…** popover (1 h, 1 day, 1 week, 30 days, until a date) for timers, adult sites, the X level, and the reveal allowance. Locked sections show the exact end and time left. The popup has a header summary, per-area lock chips, and readable site cards. The block page explains the block, shows when early unblock is locked, and offers **Close this tab**; there is still no unblock or “go back” button during a cooldown. “Why hidden?” is sectioned into the reason and the metered reveal.
- **Profile protection on X** (opt-in): account flags come from X’s own account data (`possibly_sensitive` or a sensitive profile interstitial) plus optional explicit name/bio markers. The classifier never flags accounts, and flags live only in page memory; nothing is stored, because a persisted author list previously censored a safe post permanently. Picture/banner scope is Off, flagged accounts only, or everyone except accounts you follow (fail-closed until X reports a follow; your own picture never blurs). Name replacement (plain “Hidden account” or a stable virtue alias such as “Temperance ✝”, including mentions, the profile top bar, and the tab title, with the @handle, bio, and website hidden) and reply collapse apply to flagged accounts only. A live Zen test confirmed blurred pictures/banners and aliases on a flagged profile; the handle, top bar, and serif-font gaps it found are fixed. Collapsed replies reveal through the existing per-post allowance. Under an X lock profile settings may only tighten; the alias style stays free.
- **Coverage gaps:** a private-window warning in settings and the popup when Firefox does not run Custos there; optional SafeSearch enforcement (Google, Bing, DuckDuckGo, Brave Search) sharing the adult-site lock; link-preview images on X are classified and covered as their own cells (the whole card is still never a media root); the unused v1 `x-protection.js` was removed.
- **Rename:** user-visible text, the toolbar title, menus, page titles, log prefixes, the icon file, and package metadata say Custos. Internal identifiers (`TabCloser…` script globals, `tabcloser-` CSS classes and data attributes, storage keys, message types) are unchanged to avoid regressions. The GitHub repository is renamed to `PietroFilippo/Custos` and project links point there; GitHub redirects the old URL.
- **Palette and icon:** every color moved into named tokens (`--accent`, `--ok`, `--warn`, surfaces, and `--tabcloser-*` for controls on X), then switched from charcoal/gold to **Lapis** (ink navy, lapis-blue accent, ivory text; text 16:1, muted and accent above 7:1 on panels). New icon: a shield with a lowered eye (custody of the eyes), readable at 16 px on light and dark toolbars, also used as the small mark on X; PNG exports regenerated. Layout is unchanged.
- GraphQL parsing now also covers user operations (profiles, follower lists) when profile protection is on, and still runs only while some X protection needs it.

## Previous milestone: 0.4.1

Completed in this return-to-project cycle:

- Popup status and multi-site timer fixes, including duplicate blocked cards, focus accounting, and overlapping parent/subdomain rules.
- Video-frame checks can clear a false-positive thumbnail after a complete successful check. The user confirmed the Coltrane post (`2101422716305744244`) no longer gets censored in their verified-account session.
- “Why hidden?”, local manual hides, and a shared daily reveal budget with a three-second cumulative limit per post. Reveal time is reserved before display; releasing early refunds unused time, while interrupted reservations survive restarts as used time.
- An independent allowance lock, including zero. Either this lock or an active X protection lock prevents increases; reductions are allowed. Usage never resets on a settings change.
- Local, transient allowance-save feedback; exhausted controls are disabled; displayed post availability is limited by the daily remainder.
- Separate text and image/video context-menu actions. Text uses a compact notice. Legacy whole-post choices still cover their text and media, with no article-wide artwork over author details or actions.
- Optional adult-site blocking and a separate persistent lock, with a pinned, compressed local list of 936,977 domains, upstream attribution/license, a reproducible update script, and public-suffix validation. It blocks matching existing tabs, new HTTP(S) navigation, and frames. Expiry unlocks configuration without switching protection off.
- Lenient video checks now require two strong full-frame signals. Balanced/Strict, X labels, image thresholds, and failed-video thumbnail fallback retain their prior policy.
- Presentation refresh with the **TabCloser** name retained by user choice: scalable shield-and-clock icon, shared charcoal/gold styling, a popup overview of all three protection areas and their locks, settings section navigation and About details, and a calmer blocked page. The add-on manager gets a clearer description, author, and project homepage through manifest metadata. The existing full-tab settings route, extension ID, permissions, storage, and protection policies are preserved.

## Video false-positive investigation

The supplied console file contains five distinct protected-video traces and three safe traces. The protected traces all report `reason: visual`. They do not include the active preset; Lenient is inferred from the supplied settings screenshot and is consistent with the decision thresholds. Unrelated X console errors are not evidence that the extension censored a video.

| Post ID | Captured full-frame scores, in sampling order | Previous decision |
| --- | --- | --- |
| 2102013906692530650 | .111, .756 | Single strong frame; check stopped after two samples |
| 2101878224376762506 | .456, .326 | Corroborated marginal result |
| 2102037342286495975 | .156, .004, .039, .417 | .156 counted as supporting evidence for .417 |
| 2102167969014968675 | .077, .099, .498 | Mean .225 exceeded Lenient's old .210 mean threshold |
| 2102168314189410343 | .119, .248, .516 | Weak second-frame corroboration |

The Lenient rule now requires two different full frames at or above 0.60. It does not classify center crops. Suspicion still triggers a second pass, up to six frames in total. Complete checks without this agreement release the video; an incomplete check cannot clear a flagged thumbnail. Logs now include the preset and diagnostic version so future reports do not require inference from a screenshot.

Regression tests replay these score patterns through the real coordinator. Unobserved continuation frames are explicitly synthetic clean frames, so passing tests does **not** establish that all five original videos now pass live, or that the new threshold meets a mature-content recall target. A synthetic repeated-strong-signal case verifies that Lenient still protects. This is a deliberate false-positive/sensitivity tradeoff, not a replacement model or an account/site allowlist.

## Validation and limits

- 0.5.0: 159 automated tests pass (`npm test`, 5 October). New coverage: blur default and in-place sacred-art switching, the scaled-blur fallback, sacred art under locks, partial X saves never switching tiers off, account extraction without names/bios, profile scopes (including fail-closed everyone scope and own-picture exemption), stable aliases, marker opt-in, reply collapse and its metered reveal, profile lock tightening, account parsing only while needed, SafeSearch rewrites and lock, and link-preview cells.
- `npm run build`, `npm run lint:extension` (0 errors, warnings, or notices), and `npm run package` pass; the unsigned development package is `artifacts/custos-0.5.0.zip` (ignored by Git).
- The settings page, popup, block page, and X overlays (blur, sacred art, “Why hidden?”, aliases, blurred avatars, collapsed replies) were rendered in headless Chrome with the real HTML/CSS/JS, an isolated fake browser API, and a fake X page. This does not replace a live Zen smoke test or a check against live X responses: the location of X’s following, avatar, and banner fields must be verified live, and X’s real DOM for names, user cells, and hover cards may differ from the fixtures.
- 0.4.1 notes still apply: private corpus qualification, live rechecks of the five video posts, and signed-XPI release testing remain open. The evaluator covers default Balanced image scoring only; video policies and other presets need separate qualification; see `RELEASE_CHECKLIST.md`.
- No domains or media are sent to a classification/list service. Media pixels, scores, and account flags stay transient; manual choices, locks, and reveal usage stay in local extension storage. Only the maintainer update command downloads the upstream list.
- The domain list cannot identify every adult page or newly created domain. SafeSearch covers four engines only. The settings lock does not prevent browser-level add-on disabling/removal or a user editing their own profile.

## Recommended next steps

1. Smoke-test 0.5.0 in Zen against live X: verify account fields (following, avatar, banner) in real responses, aliases in posts/user cells/hover cards/profile headers, collapsed replies, the blur in the photo viewer, and link-preview cards. Adjust the fixtures to any real DOM differences.
2. Re-test the five videos in the verified X account, collect known mature videos alongside safe videos, and measure both missed content and false positives before further threshold changes. Keep private media out of Git.
3. Consider further gaps: embedded tweets on other sites (content scripts run only in top-level X frames), direct `pbs.twimg.com` / `video.twimg.com` media opened in a tab, and alternative X front-ends.
4. Complete the release checklist, including multiple-site Zen testing and source-package review, before signing/publishing 0.5.0.
