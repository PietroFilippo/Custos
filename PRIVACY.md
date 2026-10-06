# Custos privacy policy

*Last updated: 5 October 2026*

Custos does not collect, sell, or share any data. It has no account, no analytics, no telemetry, and no server of its own. Everything it does runs inside your browser.

## What stays on your device

Custos saves its settings in your browser's extension storage (`browser.storage.local`):

- site rules, the time counted on each site, cooldowns, and locks;
- the adult-site and SafeSearch settings;
- X protection settings, manual hides, “Not sensitive” marks, and the daily reveal usage;
- the last server time Custos has seen, which keeps locks from ending early when the system clock is moved.

This data never leaves your browser. Removing the add-on deletes it.

## What is processed and then discarded

- **Media on X.** To check an image or a video frame, Custos downloads the image from X's media servers (`pbs.twimg.com`, `video.twimg.com`), the same files the X page shows, without cookies. The on-device model scores it inside the extension. Pixels and scores are kept only in memory, in a short cache of recent results, and are never written to storage or sent anywhere.
- **X's own responses.** Custos reads the responses X sends to the X page to find X's sensitive-content labels and account flags. It keeps only what it needs (which posts and media are labelled, which accounts X marks as sensitive) in the X tab's memory. Account flags are never saved; reloading X forgets them.
- **Web addresses.** To apply your site timers and the adult-site block, Custos checks the address of the pages you open against your rules and against a list of adult domains bundled with the extension. Your browsing history is not recorded, and nothing is looked up online.
- **Server time.** Custos reads the `Date` header of responses your browser already receives. It sends no extra requests for this.

## Network requests

Custos itself only requests media files from X's media servers, for on-device checks. It loads no remote code. The adult-domain list and the classifier model are bundled with the extension and change only when the extension is updated.

## Permissions

| Permission | Why Custos needs it |
|---|---|
| Access to all websites | Count time on the sites you add, close their tabs at the limit, block adult domains, and enforce SafeSearch. |
| `webRequest`, `webRequestBlocking` | Block adult domains and redirect search pages to SafeSearch before they load. |
| `webRequestFilterResponse` | Read X's responses for sensitive-content labels and account flags. |
| `webNavigation`, `tabs` | Notice which site the focused tab shows, and send blocked sites to the block page. |
| `scripting` | Start X protection in X tabs that were already open when Custos started. |
| `storage` | Save your settings on this device. |
| `alarms` | End cooldowns, save counted time, and apply “Not sensitive” marks on time. |
| `menus` | The right-click “Custos: hide…” items on X. |

## Contact

Questions or concerns: open an issue at <https://github.com/PietroFilippo/Custos/issues>.

If this policy changes, the new version will be published in this file with a new date.
