# addons.mozilla.org listing

Copy for the Custos listing and the notes for Mozilla's reviewers. Keep it in step with the README when features change.

## Basics

- **Name:** Custos
- **Slug:** `custos`. Submitted on 6 October 2026 through the API (`web-ext sign --channel listed --amo-metadata`), version 0.5.0 from tag `v0.5.0`. The privacy policy and the first screenshot were added through the AMO API; the API allows roughly one screenshot upload per hour, so add the others in the Developer Hub (Edit Product Page → Media).
- **Categories:** Privacy & Security; Social & Communication
- **Tags:** content blocker, privacy, social media, twitter (AMO accepts only tags from its fixed list)
- **Compatibility:** Firefox (desktop) only. Leave **Firefox for Android** unchecked: Custos relies on the context menu and window-focus APIs, which Android lacks. The `gecko_android` key in the manifest exists only to keep `web-ext lint` quiet about `data_collection_permissions`.
- **License:** MIT
- **Homepage:** <https://github.com/PietroFilippo/Custos>
- **Support site:** <https://github.com/PietroFilippo/Custos/issues>
- **Privacy policy:** paste [PRIVACY.md](../PRIVACY.md)
- **Icon:** upload `icons/icon-128.png` under Images in the Developer Hub. AMO does not take the listing icon from the manifest's SVG; without an upload it shows a default puzzle piece.

## Summary (250 characters max)

> Custody of the eyes: time limits for distracting sites, blocking of known adult websites, and on-device hiding of sensitive media on X. Locks keep your settings from being loosened in a weak moment. Nothing you browse leaves your browser.

## Description

> Custos (Latin for “guardian”) helps you keep custody of the eyes while you browse.
>
> **Site timers.** Give a site a daily-use limit that counts only while its tab is focused. At the limit its tabs close, and it can stay blocked for a while. The block page has no unblock button.
>
> **Adult websites.** Block about 937,000 known pornography domains from a list bundled with the add-on, and keep Google, Bing, DuckDuckGo, and Brave Search on SafeSearch. Matching happens on your device.
>
> **X (Twitter) protection.** Hide sensitive images, GIFs, videos, and link previews using X's own labels and an optional on-device classifier. Hidden media is blurred, or covered with a public-domain sacred painting, and one hidden item can hide the rest of the post. “Why hidden?” explains every decision.
>
> **Profile protection.** Blur the profile pictures and banners of accounts X marks as sensitive (or of everyone you don't follow), replace their names with an alias, and fold their replies.
>
> **Locks.** Lock any protection for an hour, a day, a week, 30 days, or until a date. While locked, the protection itself can only get stricter, and how hidden content is shown stays your choice. Changing the system clock does not end a lock early.
>
> **Friction instead of loopholes.** A brief hold-to-reveal with a small daily allowance, and “Not sensitive” marks for classifier mistakes that only take effect a day later.
>
> **Private by design.** No account, no analytics, no server. Media is checked on your device and discarded; settings stay in your browser.
>
> **Please note:** automatic detection is not perfect. It can hide harmless media and miss sensitive media, and the domain list can block a harmless site or miss a new one. Custos lowers exposure; it cannot guarantee that nothing gets through.
>
> Open source (MIT): https://github.com/PietroFilippo/Custos

## Screenshots to upload

The files are in [docs/screenshots/](screenshots/), 1280×800, in upload order. They are rendered from the extension's real pages with sample settings and fictional accounts; the photos in posts are CC0 paintings from the Art Institute of Chicago (Monet, *Water Lily Pond*; Salomon van Ruysdael, *River Landscape with a View of Naarden*). The X page is a stand-in without X branding. Captions:

1. `1-x-why-hidden.png`: Hidden media stays in place, blurred, and “Why hidden?” explains the decision. A brief hold-to-reveal and delayed “Not sensitive” marks are optional.
2. `2-x-sacred-art.png`: Optionally cover hidden media with a public-domain sacred painting. Replies from accounts X flags as sensitive fold into one line under an alias.
3. `3-popup.png`: The toolbar popup shows what is on, what is locked, and the timer for the current site.
4. `4-settings-overview.png`: Settings start with an at-a-glance summary. Site timers count only while the tab is focused, and locks keep rules from being loosened.
5. `5-settings-x-protection.png`: X labels alone, or labels plus an on-device classifier with three sensitivities. While locked, the level can only go up.
6. `6-settings-hidden-media.png`: Choose how hidden media looks and behaves, set a small daily reveal allowance, and allow “Not sensitive” marks for classifier mistakes.
7. `7-block-page.png`: A blocked site shows when it becomes available again. The page has no unblock button.

## Notes for reviewers

> **Source code.** The upload contains code bundled by esbuild (`classifier-runtime.js`, `classifier-worker.js`: TensorFlow.js 4.22.0 and NSFWJS 4.3.0). The attached source archive is the tagged repository. To reproduce the package: Node.js 22, npm 10, then `npm ci` and `npm run package`; the result is `artifacts/custos-<version>.zip` (the extension files are in `dist/`). Every other file is copied unchanged. No build step downloads anything.
>
> **Permissions.** Host access to all sites: site timers and adult-domain blocking apply to any site the user adds or the bundled list contains. `webRequestBlocking`: block adult domains and redirect search pages to SafeSearch before they load. `webRequestFilterResponse`: read X's GraphQL responses (only on x.com / twitter.com) for X's own sensitive-media labels and account flags; responses are passed through unchanged. `scripting`: start the content scripts in X tabs that were open before the add-on started. `menus`: “Custos: hide…” items on X. `alarms`: cooldowns, time saving, and delayed marks.
>
> **CSP.** `wasm-unsafe-eval` is required by the bundled TensorFlow.js WebAssembly backend (`wasm/`), the fallback when WebGL is unavailable. No remote code is loaded; the model, WebAssembly binaries, and domain list are packaged.
>
> **Data.** No data is collected or transmitted (`data_collection_permissions: none`). The only requests the add-on makes are for media files on X's CDN (`pbs.twimg.com`, `video.twimg.com`), fetched without credentials and classified locally.
>
> **Testing.** X protection: open x.com, choose “Labels + on-device classifier” in settings, and browse; media blurs until checked. Adult blocking: enable it in settings and open any domain from `data/adult-domains.txt.gz`.
