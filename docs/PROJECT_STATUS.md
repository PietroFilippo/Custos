# Project status — 2 October 2026

## Current development milestone: 0.4.1

TabCloser now covers three areas: browsing time limits, known adult websites, and sensitive content on X. The name and extension ID remain unchanged. The current build is for development testing; a newly signed release has not been published.

Documentation audited against the 0.4.1 source on 2 October. The latest implementation and validation run remain those of 29 September; this documentation audit did not rerun the automated suite or complete the pending live/release checks.

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

- 144 automated tests pass, covering existing timers, ledger accounting/concurrency, persistent locks, adult host matching and list integrity, manual text/media behavior, popup/settings feedback, and classifier coordination. The new overview cases cover partial X locks, lock expiry, list failures, and enabled timer counts including duplicate/blocked domains.
- Build and packaging pass; Firefox extension lint reports zero errors, warnings, or notices. The unsigned development package is `artifacts/tabcloser-0.4.1.zip` (ignored by Git).
- The refreshed settings, popup, and block page are visually checked with real HTML/CSS/JS and isolated browser API fixtures, including narrow settings, section navigation, and the expanded ten-site popup with its pinned settings button. This does not substitute for a live Zen extension smoke test. The inspected Zen profile has a permanent installation and no temporary add-on to reload; its installed package was not replaced during this UI refresh.
- Private corpus qualification, live rechecks of the five video posts, and signed-XPI release testing remain open. The provided logs do not contain original video pixels or later samples. The current evaluator covers default Balanced image scoring only; its alternative-threshold search and successful exit are not proof that the configured operating point passes. Video policies and other presets still need separate qualification; see `RELEASE_CHECKLIST.md`.
- No domains or media are sent to a classification/list service. Media pixels/scores stay transient; manual choices, locks, and reveal usage stay in local extension storage. Only the maintainer update command downloads the upstream list.
- The domain list cannot identify every adult page or newly created domain. It deliberately excludes broad mixed-content platforms and public suffixes. The settings lock does not prevent browser-level add-on disabling/removal or a user editing their own profile.

## Recommended next steps

1. Re-test these five videos in the verified X account, collect known mature videos alongside safe videos, and measure both missed content and false positives before further threshold changes. Use the new preset-bearing logs. Keep private media out of Git.
2. Add profile-picture and banner protection as separate opt-in controls with small-image tests. These surfaces remain outside current automatic/manual media discovery.
3. Smoke-test 0.4.1 in Zen, including the new toolbar overview and `about:addons` icon, metadata, and settings route. A name change is deferred; the user chose to retain TabCloser.
4. Complete the release checklist, including multiple-site Zen testing and source-package review, before signing/publishing 0.4.1.
