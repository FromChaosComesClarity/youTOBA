# YouTOBA

A small, native YouTube shell for macOS: toggle between the normal desktop
site and the TV/Leanback interface in one window, with ads stripped at the
source rather than skipped after they start, and a built-in downloader.

Personal-use project — not affiliated with YouTube or Google.

## Features

- **Desktop / TV toggle** — flip between `youtube.com` and the TV/Leanback
  interface (`youtube.com/tv`) in the same window. TV mode supports gamepad
  navigation (D-pad/stick to move, A to select, B to go back).
- **Ads stripped, not skipped** — network-level ad/tracker blocking plus
  direct removal of ad placements from YouTube's own response data, so
  video ads generally never get a chance to start. See
  [Ad blocking](#ad-blocking) below for how this actually works and its
  limits.
- **Built-in downloads** — a `DOWNLOAD` button and a right-click "Download
  Video…" option, both open a small popup with quality (Best/1080p/720p/480p)
  and Audio Only (MP3/M4A/Opus) options. Backed by
  [yt-dlp](https://github.com/yt-dlp/yt-dlp) and a bundled
  [ffmpeg](https://ffmpeg.org) — no separate installs required.
- **Native browser-style chrome** — custom titlebar with Home/Back/Forward/
  Reload for the Desktop view, and account-cookie import (Chrome, Brave,
  Firefox, or Safari) via the **Account** menu, for when Desktop's normal
  sign-in gets blocked by Google's embedded-browser check (see
  [Signing in](#signing-in)).

## Requirements

- macOS (Apple Silicon)
- Node.js + npm, for building from source

## Building

```bash
npm install
npm run dev      # run unpacked, for development
npm run pack      # build a signed .app / .dmg / .zip into dist/
npm run deploy    # copy the built .app to /Applications
```

`pack` ad-hoc signs the build (`codesign --sign -`) since there's no Apple
Developer account involved — on first launch, macOS will refuse to open it
with a plain double-click. Either right-click → Open once, or:

```bash
xattr -cr /Applications/YouTOBA.app
```

## Signing in

YouTube's TV interface uses a device-linking flow (the "enter this code on
google.com/device" style sign-in) that Google explicitly allows for
TV/limited-input apps — that one just works. The regular Desktop site
normally requires typing your password inside the app, which Google blocks
for any non-standard browser shell, embedded or otherwise.

The workaround: **Account → Import Login from Chrome/Brave/Firefox/Safari**
in the menu bar reads your already-logged-in session out of a real browser
(the same technique yt-dlp's own `--cookies-from-browser` flag uses) and
loads it into the app. Firefox needs no extra permissions; Chrome/Brave need
a one-time macOS Keychain approval; Safari needs Full Disk Access granted to
the bundled `yt-dlp` binary at
`~/Library/Application Support/YouTOBA/yt-dlp` (System Settings → Privacy &
Security → Full Disk Access), since its cookie store lives in a
TCC-protected sandbox container.

Imported cookies aren't permanent — they rotate/expire like any browser
session, so re-run the import if Desktop ever drops back to signed-out.

## Ad blocking

Two layers:

1. **Network level** — [`@ghostery/adblocker-electron`](https://github.com/ghostery/adblocker)
   running against the standard ad/tracking filter lists, blocking
   ad-serving requests outright. Cosmetic-filter injection is deliberately
   disabled (`loadCosmeticFilters: false`) — it collided with YouTube's own
   JS in a way that intermittently crashed the page entirely; network
   blocking alone still covers the actual ad-blocking value.
2. **Response stripping** — on the TV view, `adPlacements`/`adSlots` and
   known ad-renderer entries are stripped directly out of YouTube's
   innertube JSON via a persistent `fetch`/`JSON.parse` patch (the same
   technique [VacuumTube](https://github.com/shy1132/VacuumTube) uses). On
   Desktop, only the one-time inline `ytInitialData`/`ytInitialPlayerResponse`
   assignment is guarded this way — the persistent version of that patch is
   what caused the crash above, so it's TV-only. Desktop otherwise relies on
   network-level blocking plus a forced reload whenever YouTube's client-side
   router lands on a new video (its in-app navigation intermittently stalls
   the player; a real reload has fixed that every time).

Known gap: some native/sponsored content cards on the home feed use ad
formats outside what's currently targeted and may still show up.

## Acknowledgments

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) for downloads.
- [Ghostery adblocker](https://github.com/ghostery/adblocker) for
  network-level blocking.
- [VacuumTube](https://github.com/shy1132/VacuumTube) (MIT) — the TV-mode
  UA/handshake and the response-stripping ad-block technique are adapted
  from its approach.
