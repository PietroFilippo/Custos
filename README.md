# Custos

*Custody of the eyes for Firefox.* Custos sets time limits on distracting sites, blocks known adult websites, and hides sensitive media on X (Twitter) with an on-device classifier. Nothing you browse or see is sent anywhere.

*Formerly TabCloser.* Version **0.5.0**, Manifest V3, Firefox 140 or later on desktop (and Zen on a recent build). See [Project status](docs/PROJECT_STATUS.md) for the state of development.

> **Custos is not perfect.** Automatic detection can hide harmless media and can miss sensitive media, and the adult-site list can block a harmless site or miss a new one. Custos lowers exposure; it cannot guarantee that nothing gets through.

## Features

- **Site timers.** A per-site limit that counts only while that site's tab is focused. At the limit its tabs close, and the site can stay blocked for a while. The block page has no unblock button.
- **Adult websites.** Optional blocking of about 937,000 known pornography domains from a list bundled with the extension, plus optional SafeSearch on Google, Bing, DuckDuckGo, and Brave Search.
- **X protection.** Hides sensitive images, GIFs, videos, and link-preview images on x.com, using X's own labels and, optionally, a local adult-content classifier. Hidden media is blurred, or covered with a public-domain sacred painting.
- **Profile protection on X.** Optionally blurs profile pictures and banners, replaces the names of accounts X flags as sensitive with an alias, and folds their replies.
- **Locks.** Any protection can be locked for an hour, a day, a week, 30 days, or until a date. While locked, a setting can only get stricter.
- **Friction, not loopholes.** Brief hold-to-reveal with a small daily allowance, and “Not sensitive” marks for classifier mistakes that only take effect a day later.

## Install

- **Firefox Add-ons:** <https://addons.mozilla.org/firefox/addon/custos/> (after the listing is approved).
- **Development install (temporary):** run `npm ci` and `npm run build`, open `about:debugging` → **This Firefox** → **Load Temporary Add-on…**, and select `manifest.json` in this folder. The add-on unloads when the browser restarts; reload it from the same page after changing the source.

**Coming from TabCloser:** 0.5.0 renamed the add-on and gave it the permanent ID `custos@pietrofilippo` (previously `tabcloser@personal.local`). Firefox treats this as a new add-on, so settings, rules, locks, and manual hides do not carry over: remove TabCloser and set Custos up again. New settings (sacred art, profile protection, SafeSearch, “Not sensitive” marks) start off.

If Custos is not allowed in private windows, the popup and settings say so. Allow it in `about:addons` → Custos → **Run in Private Windows** to keep protection there.

## Using Custos

Click the toolbar icon for a status summary, and **Open settings** to change anything. The settings page starts with an at-a-glance summary of what is on and what is locked.

### Site timers

- Each rule has a domain, a limit in minutes, an optional block after the tabs close, and an enable switch. A rule for `twitter.com` also covers `mobile.twitter.com`. If both have enabled rules, the more specific domain controls the timer.
- Time counts only while the site's tab is focused; switching tabs or windows pauses it. At the limit, every tab of that site closes.
- Cooldowns cover subdomains too: a subdomain cannot escape a blocked parent domain, and the latest expiry wins.
- Reset a timer or unblock a site early from settings. **Unblock now** asks for a second click. Deleting a site offers Undo for a few seconds.
- **Lock…** protects an enabled rule. While it is locked the rule can only get stricter: a lower limit, a longer block, or locking early unblock. Its domain, enable switch, deletion, and timer reset are unavailable. Turn on **Lock also prevents “Unblock now”** before locking to remove early unblocking as well.
- Addresses with a trailing dot (`x.com.`) load as the plain host, so they cannot escape timers, cooldowns, or X protection.

### Adult websites and SafeSearch

- **Block known adult websites** applies immediately to open tabs and to new navigation, including subdomains and embedded frames. Domains are matched at dot boundaries, never by keywords.
- The bundled [Block List Project pornography list](https://github.com/blocklistproject/Lists) holds **936,977 domains** after validation. Broad mixed-content platforms and public suffixes are removed. Matching happens on your device; there is no DNS service, online lookup, or automatic remote update. Source revision, date, hashes, and exclusions are in `data/adult-list.json`.
- **Enforce SafeSearch** (needs adult-site blocking) sends Google, Bing, DuckDuckGo, and Brave Search to their strictest filter, image and video search included. Other search engines are not covered.
- One lock covers both. Expiry unlocks the settings; it does not turn protection off. If the bundled list ever fails to load, navigation is held and the popup shows **Check settings**.

### X protection

- **Protection level:** **Off**, **X labels only** (media that X or the poster labelled sensitive; nothing is analysed), or **Labels + on-device classifier** with a **Lenient**, **Balanced** (recommended), or **Strict** sensitivity. **Lock level…** keeps the level and sensitivity from being lowered.
- The classifier checks images and samples video frames. A successful video check takes priority over a noisy thumbnail; Lenient needs two strong full frames before it hides a video. Media stays covered while it is checked, and media that fails to check stays covered and is retried.
- **Hidden media** stays in place, heavily blurred and darkened, with a **Sensitive media hidden** notice. The blur scales with the media, so the full-screen viewer is as unreadable as a thumbnail. **Cover hidden media with sacred art** shows a public-domain painting instead; it only changes the look, so it stays editable during any lock. Optional extras: replace the post text with a Catholic quote, prevent liking posts whose media is hidden, and **hide all of a post’s media when one is hidden**.
- **Hide all of a post’s media when one is hidden:** in a post with several images or videos, a classifier verdict on one hides the others too (X labels and confirmed video verdicts already hide the whole post). The post’s media stays covered until every item is checked, so a safe image never shows first. A quoted post counts as a separate post. If the item that hid the post is later released, for example by a “Not sensitive” mark, the others are checked again on their own.
- **Why hidden?** (or clicking blurred media) explains the reason: an X label, the classifier and its score, a manual hide, or a flagged account. Scores are model signals, not certainty.
- **Temporary reveals** are off by default. Set a daily allowance (for example 30 seconds), then hold **Hold to reveal** in Why hidden?. Each post gets 3 seconds a day by default (3 to 10 configurable), shared across its images and all tabs. Letting go, switching tabs, navigating, or reaching the limit hides it again; videos stay paused and muted. Time is reserved before the reveal and refunded on an early release; a crash can use up the reservation. The allowance resets at local midnight.
- **“Not sensitive” marks** are for classifier mistakes and are off by default. Choose up to 5 marks a day in settings; Why hidden? then offers **Mark not sensitive…** (two clicks) for an image the classifier hid. To keep this from becoming a shortcut:
  - a mark takes effect **24 hours later**; the image stays hidden until then;
  - only borderline detections qualify. Custos re-scores the image itself and refuses confident detections, X labels, manual hides, videos, and GIFs;
  - a mark covers that one image, never the post or the account;
  - removing a mark never gives the day's mark back, and any mark can be removed at any time, in Why hidden? or in settings, to hide the image again.
- **Manual hides:** right-click a post or its media and choose **Custos: hide this post’s text** or **hide this image / video**. Choices are saved on this device and apply even when the level is Off. Remove them under **Manual hides** in settings or in Why hidden?.
- **Locks:** during an X lock, the level and sensitivity can only go up, text replacement, like blocking, and post-wide hiding stay on, manual hides cannot be removed, profile protection can only tighten, and the reveal allowance, time per post, and daily marks can only go down. **Lock allowance…** applies that last rule on its own, even after the X lock ends. Locking 0 keeps reveals or marks off.

### Profile protection on X

Profile pictures are small face crops where the classifier cannot tell a suggestive photo from an ordinary selfie, so profile protection does not classify them. It works from **account flags**: accounts X itself marks as sensitive, plus, optionally, accounts whose name or bio contains an explicit marker (18+, NSFW, 🔞, OnlyFans, Fansly). A classifier verdict never flags an account. Flags live only in the X page's memory and are never saved, so a reload forgets them and a mistaken flag cannot censor an account for good.

- **Profile pictures and banners:** Off, *Flagged accounts only*, or *Everyone except accounts I follow*. In the everyone scope a picture stays blurred until X confirms you follow the account; your own picture never blurs.
- **Replace names and handles** (flagged accounts only): a plain *Hidden account* or a stable Catholic virtue alias such as *Temperance ✝*, in posts, lists, hover cards, mentions, the profile header and top bar, and the tab title. Their @handle, bio, and website are hidden too.
- **Collapse replies from flagged accounts:** on conversation pages their replies fold into one line. **Show…** opens Why hidden? and uses the same hold-to-reveal allowance.

Profile protection works even when the media level is Off. During an X lock it can only get stricter; the alias style stays editable.

### Trusted time

Locks, cooldowns, the reveal day, and “Not sensitive” marks use a trusted time: the device clock, checked against the `Date` header of real server responses. Moving the system clock forward does not end a lock early once a server time has been seen. Trusted time is never later than the device clock, so an honest clock behaves normally.

## Limitations

- **False positives and misses.** The classifier targets nudity, pornography, sexualized imagery, and hentai. It can hide harmless media (swimwear, fitness, art, skin tones) and miss sensitive media, especially brief scenes in videos. Other sensitive categories depend on X's labels. X labels come from X or the poster and can be wrong too.
- **Known-domain blocking.** The adult-site list cannot know every adult page or new domain, and can include a harmless site. An unlocked setting can be turned off for a false positive; the block page never offers a bypass.
- **X only.** Media protection covers x.com and twitter.com, not embedded posts on other sites, media files opened directly, or alternative X front-ends. X changes its pages and responses from time to time, which can break detection until Custos is updated.
- **Locks protect settings inside Custos.** They do not stop anyone from disabling or removing the add-on in the browser.
- **Desktop only.** Firefox for Android lacks APIs Custos relies on.

## Privacy

Custos collects nothing. Settings, rules, locks, manual hides, marks, and reveal usage stay in your browser's extension storage. X media is scored on your device and discarded; account flags are kept only in page memory. The only network requests Custos makes are for media files from X's own servers. See the [privacy policy](PRIVACY.md) for details and a permission-by-permission explanation.

The classifier runs in a background worker, never on X's page: on the GPU through WebGL when available (about 30 ms per image), otherwise through a bundled WebAssembly build (about 55 ms), and only as a last resort in plain JavaScript (about 1 s). Only media near the screen is checked, two items at a time, using small image variants.

## Building from source

Requirements: Node.js 22 and npm 10 (any OS).

```sh
npm ci                  # exact dependency versions from package-lock.json
npm run build           # writes the extension to dist/ (and the generated files to the repo root)
npm test                # unit, DOM, and background tests
npm run lint:extension  # web-ext lint on dist/
npm run package         # artifacts/custos-<version>.zip, the file uploaded to AMO
npm run package:source  # artifacts/custos-<version>-source.zip, the source archive for review
```

`npm run build` bundles the classifier (`classifier-runtime.js`, `classifier-worker.js`) from `classifier-entry.js` and `classifier-worker-entry.js` with esbuild, copies the NSFWJS model and the TensorFlow.js WebAssembly binaries from `node_modules`, writes `sacred-art-list.js` from `assets/sacred-art/CREDITS.json`, and re-encodes the paintings at JPEG quality 82. Every other file is copied unchanged. No build step downloads anything.

Maintainers refresh the adult-domain snapshot with `npm run update:adult-list` (or `-- <upstream-commit-sha>` for a pinned revision), then review the metadata, run the tests, and rebuild. The update script uses the development dependency `tldts`, which is not shipped. Release steps are in the [release checklist](RELEASE_CHECKLIST.md).

## Project layout

| File | Role |
|------|------|
| `manifest.json` | Manifest V3, permissions, entry points |
| `background.js` | Timers, auto-close, blocking, SafeSearch, trusted time, X response reading, classifier requests, locks |
| `common.js`, `theme.css` | Shared helpers and the Lapis color tokens and components |
| `popup.*`, `options.*`, `blocked.*` | Toolbar popup, settings page, block page |
| `adult-sites.js`, `data/` | Local adult-domain matching and the bundled list |
| `classifier-entry.js`, `classifier-worker-entry.js` | Classifier sources (bundled by the build) |
| `x-verdict.js` | Score thresholds, sensitivity presets, “Not sensitive” eligibility |
| `x-metadata.js` | Reads X labels, account flags, and video sources from X's responses |
| `x-media-utils.js` | Video frame sampling helpers |
| `x-protection-v2.js`, `x-protection-v3.css` | Media discovery, classification queue, covers, paintings, painting viewer |
| `x-interactions.js` | Why hidden?, manual hides, hold-to-reveal, “Not sensitive” marks |
| `x-user-controls.js` | Saved manual hides, the shared reveal allowance, and marks |
| `x-profile-protection.js` | Session-only account flags, picture and banner blur, aliases, reply folding |
| `catholic-quotes.js`, `assets/sacred-art/` | Quotes and the public-domain paintings with their credits |
| `icons/` | Lowered-eye icon (`custos.svg`) with PNG exports |
| `scripts/` | Build, package, model evaluation, and list update scripts |
| `test/` | Automated tests (`npm test`) |

## License and credits

Custos is released under the [MIT License](LICENSE). It bundles NSFWJS (MIT), TensorFlow.js (Apache-2.0, with XNNPACK under BSD-3-Clause), and The Block List Project's list (Unlicense); the 361 paintings are public domain or CC0 from The Metropolitan Museum of Art, the Cleveland Museum of Art, the National Gallery of Art, and the Art Institute of Chicago. Details and license texts: [third-party notices](THIRD_PARTY_NOTICES.md) and `licenses/`.
