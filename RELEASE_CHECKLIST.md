# Custos 0.5.0 release checklist

## Automated gates

1. Use Node 22 and npm 10, then run `npm ci`.
2. Run `npm test`; all tests must pass.
3. Run the private corpus evaluator as described below (this remains a release qualification gate, not a claim that the current branch has met it). The configured operating point must protect 100% of known misses, achieve unsafe recall of at least 98%, and release at least 90% of clearly safe samples. A recommended alternative threshold alone does not pass this gate.
4. Run `npm run build` and `npm run lint:extension` with no errors.
5. Run `npm run package`; inspect the archive and confirm it contains no corpus media, credentials, source maps, development tools, or remote code.

## Private corpus evaluation

Run `npm run evaluate:model -- --manifest <corpus-manifest.json> --corpus <private-directory>`. This corpus manifest is separate from the extension's root `manifest.json`. It contains a `samples` array; each entry has `id`, `file` (relative to the private directory), `expected`, and an optional `sha256`. Accepted labels are `safe`, `adult`, `hentai`, `borderline`, and `known-miss`; all except `safe` count toward unsafe recall. Include safe, unsafe, and known-miss samples to make all three gates meaningful. Keep the corpus and its identifying manifest outside Git.

The current evaluator accepts PNG/JPEG images and reports `configured` metrics using the default Balanced image scoring. It also searches alternative thresholds and reports `recommended`. Exit code 2 means no searched threshold passed; exit code 0 does **not** prove the configured threshold passed, so inspect `configured` explicitly. It does not change extension settings or thresholds.

This script does not evaluate video sampling/aggregation, live X labels or DOM behavior, or the complete Lenient/Strict presets. Qualify those separately with recorded account/preset context and live safe/mature cases before release. Passing image metrics alone cannot establish video accuracy.

## Firefox and Zen QA

- Check the popup with 0, 1, 5, and 10 tracked sites, mixed paused/blocked sites, and long domains. Verify Show more/fewer, keyboard focus, scrolling, and the pinned settings button.
- Check the protection overview with X tiers off, labels only, and classifier enabled; verify partial tier locks and expired locks. Check adult protection off, on, locked, and list unavailable. Timer counts must exclude disabled/duplicate domains and include enabled timers currently in cooldown.
- In `about:addons`, check the scalable icon, Custos name, description, author, version, project link, and Preferences/Options route. Check the lowered-eye toolbar icon at 16 px in light and dark browser themes, and the Lapis colors in the popup, settings, block page, and controls on X. The settings About section must match the manifest version.
- Check the settings at-a-glance cards and side navigation lock chips against the real lock state. Open every `Lock…` popover with mouse and keyboard (presets, until a date, Escape, Cancel, errors for past dates); locked sections must show a banner with the exact end and time left instead of a lock control.
- Check settings section links, keyboard focus, reduced motion, and narrow widths. Check the refreshed block page for a timer countdown, expired cooldown, adult-domain block, and list failure. No page may offer a lock bypass.
- Open the popup on `blocked.html` and an internal browser page. The blocked domain should appear once with its cooldown; internal pages must never show an extension UUID as a site.
- Switch between tracked sites/windows, reset an active timer, and let a timer expire. Only focused time should count; stale timeout/alarm notifications must not close a different site early.
- Test parent/subdomain timer precedence, overlapping cooldowns, duplicate-domain validation, and locked-parent override prevention.
- Test a clean install under the new permanent ID `custos@pietrofilippo`; every new setting starts off and hidden media uses the blur cover. Installing next to an old `tabcloser@personal.local` copy must not share or overwrite its storage; remove the old copy before testing. From here on, keep the Custos ID unchanged so future upgrades preserve rules, locks, and manual hides.
- In `about:addons`, the toolbar tooltip, the settings, popup, and block page titles, the right-click menu, and X notices must all say Custos.
- With extension access to private windows denied, confirm the settings banner and popup note appear; with access allowed, confirm both disappear.
- Test X Home, Search, TweetDetail, photo viewer, link-preview cards (large and small), single/multi-image tweets, GIFs, and videos. Card text and links must stay readable; only the preview image is covered.
- Confirm hidden media uses the darkened blur by default and stays unrecognizable in the full-screen photo viewer (the radius scales with the cell). Toggle sacred art on and off during an active X lock: covers switch in place without reclassifying, and clicking blurred media opens Why hidden instead of a painting viewer.
- Repeat known misses in the verified X account used for current testing. Record the account state, active sensitivity preset, and diagnostic version. Compare VPN on/off only when investigating a reproducible regional or metadata difference; VPN state alone is not a substitute for testing a verified account.
- Confirm X-labelled media blocks without waiting for local inference.
- Confirm safe media remains hidden while pending and becomes visible only after a safe verdict.
- Confirm X-labelled and model-flagged media remain protected. Image-check failures should stay covered and retry. Unavailable/incomplete video checks must retain a flagged thumbnail; absent/unreadable thumbnails alone do not protect a video.
- Recheck the Coltrane false-positive post `2101422716305744244`: a thumbnail score near 0.83 must no longer end the check before video sampling. Verify its real sampled frames as well as known mature-video cases; mocked safe-frame tests do not establish corpus accuracy.
- Check Why hidden for X labels, individual images, video frames, thumbnail fallback, manual choices, flagged-account replies, and failures. Clicking controls must not navigate or open the painting viewer.
- Profile protection: with "Flagged accounts only", confirm pictures and banners of accounts X flags as sensitive are blurred in timelines, replies, hover cards, follow lists, DMs, and profile pages, and nobody else's are. With "Everyone except accounts I follow", confirm every unfollowed picture is blurred, followed unflagged accounts and your own picture stay clear, and a followed flagged account stays blurred. Verify where X currently delivers the following flag, avatar, and banner fields in live responses.
- Replace display names: check the plain and virtue aliases in posts, user cells, hover cards, the profile header, and the profile tab title; the same account keeps the same virtue everywhere; handles stay visible. Explicit name/bio markers only count when that option is on.
- Collapse replies: on a conversation, replies from flagged accounts fold into one line, the focal post never folds, Show… opens Why hidden, and the hold reveal uses the shared allowance. Timelines never fold.
- Reload X and confirm no account flag survives; inspect extension storage to confirm no account list is saved. Under an X lock, profile settings may only tighten while the alias style stays editable.
- Right-click-hide one image and, separately, a post’s text. Confirm author details, timestamps, and actions remain visible. Verify legacy whole-post choices hide media/text without an article-wide painting. Verify persistence, timeline/detail views, quoted-post isolation, removal, and automatic protection off. Locks must prevent removing manual hides.
- Configure 4 seconds/day and reveal two different posts: at most 3 seconds on the first and 1 on the second. Repeat a hold after early release, refresh, restart, and use concurrent tabs. No action may reset usage except the next local calendar day.
- During a reveal test release, blur, tab changes, navigation, DOM remounts, and the deadline. Text and media must rehide; videos must never autoplay. Check pointer and keyboard holds.
- Independently lock the reveal allowance with X tiers unlocked, including allowance zero. Reload/restart, try increasing or shortening the lock, lower the allowance, and verify expiry. Save feedback must clear locally; zero time disables pointer and keyboard holds, and available post time must not exceed the daily remainder.
- Enable adult-site protection with multiple matching tabs open. Check HTTP/HTTPS, subdomains, embedded frames, back/forward navigation, lookalike domains, and unrelated sites. Lock, reload/restart, attempt disabling/shortening, and check expiry leaves protection enabled. Test the bundled-list error page and settings recovery.
- Confirm the popup identifies an adult block instead of saying the timer cooldown expired. Check the settings and block page at narrow widths. The block page must say why the site is blocked, show the early-unblock lock when one applies, close its own tab with Close this tab, and never offer a way back before the cooldown ends.
- Enable SafeSearch and search Google (including a country domain and image search), Bing images, DuckDuckGo, and Brave Search; each must load with its strict filter even after choosing a looser filter in the engine's own UI. Lock adult-site protection and confirm SafeSearch cannot be switched off until expiry.
- Recheck the five reported video cases listed in `docs/PROJECT_STATUS.md` under Lenient, plus known mature-video cases. Confirm strong repeated evidence still blocks and incomplete video checks retain flagged thumbnails. Compare Balanced/Strict behavior.
- Confirm an active X lock prevents increasing/enabling the reveal allowance but allows lowering it. Disabling/re-enabling never refills the allowance.
- Confirm disabling unlocked protection restores pending/protected DOM and a lock prevents disabling.
- Confirm scrolling and tab switching remain responsive with multiple visible media items.

## Signing and release

1. Build a source archive containing the lockfile and reproducible build instructions for Mozilla review.
2. Set `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` only in the shell environment.
3. Sign for self-distribution with `npx web-ext sign --source-dir dist --channel unlisted --api-key $env:AMO_JWT_ISSUER --api-secret $env:AMO_JWT_SECRET`.
4. Install and smoke-test the returned signed XPI.
5. Publish the signed XPI, SHA-256 checksum, source tag, release notes, model version, and false-positive disclosure on GitHub Releases.
6. Retain the previous signed XPI as the rollback artifact.
