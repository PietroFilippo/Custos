# addons.mozilla.org listing

Copy for the Custos listing and the notes for Mozilla's reviewers. Keep it in step with the README when features change.

## Basics

- **Name:** Custos
- **Slug:** `custos` (free as of 5 October 2026)
- **Categories:** Privacy & Security; Social & Communication
- **Tags:** productivity, social media, parental control
- **Compatibility:** Firefox (desktop) only. Leave **Firefox for Android** unchecked: Custos relies on the context menu and window-focus APIs, which Android lacks. The `gecko_android` key in the manifest exists only to keep `web-ext lint` quiet about `data_collection_permissions`.
- **License:** MIT
- **Homepage:** <https://github.com/PietroFilippo/Custos>
- **Support site:** <https://github.com/PietroFilippo/Custos/issues>
- **Privacy policy:** paste [PRIVACY.md](../PRIVACY.md)

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
> **Locks.** Lock any protection for an hour, a day, a week, 30 days, or until a date. While locked, settings can only get stricter. Changing the system clock does not end a lock early.
>
> **Friction instead of loopholes.** A brief hold-to-reveal with a small daily allowance, and “Not sensitive” marks for classifier mistakes that only take effect a day later.
>
> **Private by design.** No account, no analytics, no server. Media is checked on your device and discarded; settings stay in your browser.
>
> **Please note:** automatic detection is not perfect. It can hide harmless media and miss sensitive media, and the domain list can block a harmless site or miss a new one. Custos lowers exposure; it cannot guarantee that nothing gets through.
>
> Open source (MIT): https://github.com/PietroFilippo/Custos

## Screenshots to upload

Take them in Firefox at 1280×800 with sample settings (no real posts from other people):

1. Settings, at-a-glance cards and the X protection section.
2. An X post with blurred media and the “Why hidden?” panel.
3. The same post with sacred art on.
4. The toolbar popup with a few timers.
5. The block page.

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
