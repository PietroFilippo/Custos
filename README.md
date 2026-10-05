# Custos

*Formerly TabCloser.* A Firefox / Zen browser add-on for browsing limits and content protection: timed site blocks, optional adult-site blocking, and local sensitive-media protection for X.

Current development version: **0.5.0**. See [Project status](docs/PROJECT_STATUS.md) for completed work, validation limits, and next steps.

Personal-use, Manifest V3. Requires Firefox 140+ (or Zen on a recent build).

## Features

- Per-site timer that counts only while the tab is focused (alt-tab or switch tabs = pause).
- Auto-close all tabs of a site once the timer hits the limit.
- Optional block period after close (1 min, 30 min, 2 h, whatever).
- Opt-in blocking of known pornography domains, using a bundled list from The Block List Project, with an independent timed lock.
- Optional SafeSearch enforcement for Google, Bing, DuckDuckGo, and Brave Search, covered by the adult-site lock.
- Timed rule locks that prevent a rule from being disabled, deleted, or changed before expiry.
- Optional X / Twitter protection that combines X labels with an on-device adult-content classifier for images, GIFs, sampled video, and link-preview images; it has its own timed disable lock. Hidden media is heavily blurred by default; covering it with public-domain sacred art is an optional presentation switch.
- Optional profile protection on X: blur profile pictures and banners (flagged accounts only, or everyone except accounts you follow), replace the display names of flagged accounts with a plain or virtue alias, and collapse their replies. Account flags come from X and are never saved.
- Subdomain match — a rule for `twitter.com` also catches `mobile.twitter.com`. If both have enabled timer rules, the more specific domain controls the timer. Auto-close still closes all tabs matching the expired rule, including subdomains.
- Cooldowns apply across overlapping domains: a subdomain cannot escape an active parent-domain block, and the latest applicable expiry determines when access returns. Duplicate domains are rejected when saving.
- Block screen is friction-only: **no unblock button on the page**. To unblock early, open the add-on settings.

## Install (Zen / Firefox)

### Signed XPI (permanent)

1. Download the latest signed `.xpi` from the [Releases page](https://github.com/PietroFilippo/TabCloser/releases/latest).
2. Drag the file into a Zen / Firefox window, or open it with `Ctrl+O`.
3. Confirm the install prompt.

### Development install (temporary)

Use this when iterating on the source. The add-on unloads on browser restart.

1. Open `about:debugging` in the browser.
2. Click **This Firefox** (Zen exposes the same page).
3. Run `npm ci` and `npm run build` from this folder before loading the add-on (Node 22 and npm 10 are the release-checklist baseline).
4. **Load Temporary Add-on…** and select `manifest.json` from this folder.

## Usage

- Click the Custos toolbar icon -> **Open settings** to add a site. The settings page opens with an at-a-glance summary of what is on and what is locked; every lock uses the same **Lock…** control with 1 hour, 1 day, 1 week, 30 days, or until-a-date presets.
- If Custos is not allowed to run in private windows, the popup and settings say so. Allow it in `about:addons` -> Custos -> **Run in Private Windows** to keep protection there.
- The protection overview shows the current X mode and tier locks, adult-site blocking (including list errors), and the number of enabled site timers. It displays your configuration; it is not a guarantee that every sensitive item is detected.
- Each rule has: domain, close-after (minutes), block-after-close toggle + duration, enabled toggle.
- The popup shows each site as counting, paused, or blocked. Blocked sites show a cooldown instead of a second, reset timer card. Long lists expand with **Show more**, and the settings button stays visible while scrolling.
- Reset the timer or unblock early from the settings page (per-rule buttons).
- Use **Lock…** after saving an enabled site to protect its configuration for a preset duration or until a chosen date. Enable **Lock also prevents "Unblock now"** before locking if early unblocking should be unavailable too.
- A new subdomain rule cannot override a locked parent timer. Existing duplicate rules from older versions remain editable; resolve duplicates before saving further rule changes.
- Choose an X protection level (**Off**, **X labels only**, or **Labels + on-device classifier** with a sensitivity) and use **Lock level…** to keep it from being lowered until expiry. X labels protect immediately. The classifier checks images and samples videos; a successful video check takes priority over a noisy thumbnail. Unavailable video checks fall back to the thumbnail, while image-check errors stay covered and retry.
- Hidden media stays in place, heavily blurred and darkened, with a **Sensitive media hidden** notice. The blur radius scales with the media so the full-screen viewer is as unreadable as a thumbnail. Turn on **Cover hidden media with sacred art** to show a painting instead; this presentation switch stays editable during every lock.
- Click **Why hidden?** (or blurred media itself) to see the reason, checked media type, and available model scores. Scores are model signals, not reliable probabilities.
- Right-click a post or media on X and choose **Custos → hide this post’s text** or **hide this image / video**. Text gets a compact notice; artwork only replaces the selected media. Author details and post actions remain visible. Existing whole-post choices hide text and media individually, preserving their protection. Manual choices survive reloads and work with automatic protection off. Remove individual choices under **Manual hides** in settings, or through **Why hidden?**. Active X locks prevent removal.
- Temporary reveals default **off**. Set a daily allowance in settings (for example, 30 seconds), then hold **Hold to reveal** inside **Why hidden?**. A post gets **three cumulative seconds per local calendar day**, shared across all its images and all tabs. Releasing the button/key, losing focus, navigating, or reaching the deadline hides it again. Videos remain paused and muted. Keyboard: focus the hold button and hold Space or Enter.
- The background process reserves time before revealing and refunds unused time on a clean early release. Refreshes preserve usage; a crash or extension restart can consume the outstanding reservation. Local midnight replenishes the allowance; changing a setting never clears usage. The daily limit may decrease but cannot increase during either an active X lock or the independent **Lock allowance** period. Locking zero keeps reveals off. Locks cannot be shortened. Save feedback appears beside the allowance and clears after three seconds; exhausted reveals are disabled.

## Settings and add-on details

Custos keeps the shield-and-clock icon and charcoal/gold design of TabCloser. In 0.5.0 the settings page is a single column with at-a-glance status cards, a sticky section menu with lock badges, inline helper text instead of hover tooltips, and one lock control for every lockable setting. Locked sections show the exact end date and time left. The popup shows a one-line summary, a per-area overview with lock chips, and clearer site cards. The block page explains why a site is blocked, whether early unblock is locked, and offers **Close this tab**; it still has no unblock button. The About section shows the installed version, explains local processing and browser access, and links to usage instructions, issues, and third-party notices.

In Zen / Firefox, open `about:addons` → **Extensions** → **Custos** for its description, author, version, and project homepage. Use the extension's **Preferences** / **Options** action (the label and placement depend on the browser) to open the full settings tab. The surrounding add-on manager remains browser-owned.

**Coming from TabCloser:** 0.5.0 renames the add-on to Custos and gives it the permanent public ID `custos@pietrofilippo` (previously `tabcloser@personal.local`). Firefox treats a new ID as a separate add-on, so settings, rules, locks, and manual hides from TabCloser do not carry over: remove the old TabCloser add-on and set Custos up again. Permissions and classification policies are unchanged. New settings (sacred art, profile protection, SafeSearch) default off, so hidden media uses the blur cover until sacred art is switched on. Source changes do not update a permanently installed XPI: use the temporary development install above to test 0.5.0, or install a newly signed release when available.

## Adult-site protection

Enable **Block known adult websites** in settings, then optionally lock it for a duration or until a date. This applies immediately to matching open tabs and future HTTP(S) navigation, including subdomains and embedded frames. A lock prevents disabling it; expiry unlocks the setting but does not turn protection off. Timer cooldowns and the X reveal allowance are separate.

The bundled [Block List Project pornography list](https://github.com/blocklistproject/Lists) contains **936,977 domains** after validation and removal of redundant subdomains. Data matches locally, without a DNS service, external browsing lookup, or automatic remote update. Attribution, pinned upstream revision, retrieval date, hash, and exclusions are in `data/adult-list.json`; the upstream Unlicense text is included. Domains are matched at dot boundaries, never by keywords. Broad mixed-content platform entries and public suffixes are removed. Specific adult subdomains may still be blocked.

**Enforce SafeSearch on search engines** (needs adult-site blocking on) redirects Google, Bing, DuckDuckGo, and Brave Search pages to their strictest filter parameter, including image and video search. It shares the adult-site lock: during a lock it can be turned on but not off. Other search engines are not covered.

This is a known-domain blocker, not an adult-content scanner for the entire web. Lists can miss new sites or misclassify domains. An unlocked setting can be disabled for a false positive; there is no bypass button on the block page. Extension locks do not prevent disabling or removing the add-on in the browser. A broken bundled list is reported, and an enabled policy holds navigation until repaired or disabled when unlocked.

Maintainers update the bundled snapshot with `npm run update:adult-list`, or `npm run update:adult-list -- <upstream-commit-sha>` for a pinned revision. Review metadata/exclusions, run tests, rebuild, and ship the data with the extension. Normal builds use the checked-in snapshot and need no blocklist download. The update script uses the pinned development dependency `tldts` to reject public suffixes; it is not shipped in the extension.

## Profile protection on X

Profile pictures are small face crops where the classifier cannot tell suggestive photos from ordinary selfies, so profile protection does not classify them. It works from **account flags**: accounts X itself marks as sensitive (`possibly_sensitive` or a sensitive profile interstitial in X's own responses), plus, optionally, accounts whose name or bio contains an explicit marker (18+, NSFW, 🔞, OnlyFans, Fansly). A single classifier verdict never flags an account. Flags live only in the X page's memory and are never written to storage, so a reload forgets them and a mistaken flag cannot censor an account permanently.

- **Profile pictures and banners**: Off, *Flagged accounts only*, or *Everyone except accounts I follow*. Blurring applies across timelines, replies, hover cards, lists, DMs, and profile pages. In the everyone scope every picture blurs until X confirms you follow the account; a followed flagged account stays blurred, and your own picture never blurs.
- **Replace display names** (flagged accounts only): a plain *Hidden account* or a stable Catholic virtue alias such as *Temperance ✝*. Handles stay visible so accounts can be told apart.
- **Collapse replies from flagged accounts**: on conversation pages, their replies fold into one line. **Show…** opens Why hidden and uses the same hold-to-reveal allowance as media; there is no one-click reveal.

Profile protection works even when the media protection level is Off. During an X lock it can only get stricter; the alias style stays editable. X changes its response format from time to time, so live verification of the account fields is part of the release checklist.

## Video sensitivity

Lenient now requires **two separate full frames scoring at least 0.60** before it blocks a video on frame evidence. Ambiguous checks sample up to six frames; a single spike or a low average cannot block on its own after a complete check. Lenient does not use center crops. This deliberately favors fewer false positives and can miss brief or lower-scoring mature scenes. Balanced and Strict retain their existing, more aggressive aggregation rules. X labels, image thresholds, and flagged-thumbnail fallback when video checks fail are unchanged.

The supplied false-positive logs reproduce the previous decision patterns in regression tests. Missing continuation frames in those tests are synthetic; they are not measurements from the original videos. Live-video accuracy and mature-content recall still need corpus qualification.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest, permissions, entry points |
| `theme.css`, `icons/custos.svg` | Shared presentation and scalable shield-and-clock icon |
| `adult-sites.js`, `data/` | Local adult-domain matching and bundled list |
| `common.js` | Shared helpers (domain matching, formatting) |
| `background.js` | Focus tracking, auto-close, block enforcement |
| `popup.*` | Status popup (no unblock here) |
| `options.*` | Rule editor + unblock |
| `x-interactions.js` | Reason panel, manual hides, hold-to-reveal presentation |
| `x-user-controls.js` | Persistent manual identities and shared reveal accounting |
| `x-profile-protection.js` | Session-only account flags, profile picture/banner blur, aliases, reply collapse |
| `blocked.*` | Page shown when a blocked site is opened |

## Notes

- Storage lives in `browser.storage.local` — uninstalling clears all rules.
- After editing source files, reload the add-on from `about:debugging` → Custos → **Reload**.
- Re-run `npm run build` before reloading whenever classifier or protection source changes.
- Timer cooldowns use navigation redirects. Adult-site blocking intercepts navigation before the network request proceeds; enabling it also redirects already-loaded matching tabs.
- X media classification is entirely local. Media pixels and model scores are not uploaded or persisted.
- The classifier targets adult sexual content, nudity, pornography, sexualized imagery, and hentai. Other sensitive categories continue to depend on X metadata.
- Safe media can still be incorrectly blocked. Optional reveals are temporary presentation overrides and never change a classifier verdict or add a safe exception.
- Manual post/media identities and daily reveal usage are saved locally; image pixels, diagnostic scores, and account flags are not persisted by the extension. Removing a manual hide does not override X labels or classifier results.
- The private evaluation corpus stays outside Git; see [the release checklist](RELEASE_CHECKLIST.md#private-corpus-evaluation) for evaluator usage, its image-only limits, and qualification/signing gates.
