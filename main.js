const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  shell,
  session,
  nativeTheme,
  ipcMain,
  dialog
} = require('electron')
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')
const { adsAndTrackingLists } = require('@ghostery/adblocker')
const YTDlpWrap = require('yt-dlp-wrap').default

app.setName('YourTOBA')

const DESKTOP_URL = 'https://www.youtube.com'
const TV_URL = 'https://www.youtube.com/tv'
const BG = '#0e0d0d'
const TITLEBAR_HEIGHT = 40
// Renamed from YouTOBA, so the session that predates the rename lives under
// the old name — see migrateLegacyUserData below.
const PARTITION = migrateLegacyUserData()

// A userData directory is named after the app (~/Library/Application Support/
// <name>), so the rename would have silently orphaned everything personal in
// there: the persisted YouTube session, imported login cookies, the
// downloaded yt-dlp binary. To the user that looks like a freshly installed
// app that forgot who they are. Move the old directory into place on first
// run instead, and rename the partition folder inside it so the persist:
// name matches what's on disk. If either move can't happen, keep using the
// old partition name rather than dropping them into a signed-out session.
function migrateLegacyUserData() {
  const userData = app.getPath('userData')
  const legacyUserData = path.join(path.dirname(userData), 'YouTOBA')
  const partitionDir = (name) => path.join(userData, 'Partitions', name)

  if (fs.existsSync(legacyUserData) && legacyUserData !== userData) {
    try {
      // Nothing has created userData this early in startup, but an earlier
      // run of a renamed build could have left an empty one behind; rmdirSync
      // throws on a non-empty directory, which is the signal to leave both
      // alone and keep whatever the new directory already holds.
      if (fs.existsSync(userData)) fs.rmdirSync(userData)
      fs.renameSync(legacyUserData, userData)
    } catch {
      // Already migrated, or the old directory is in use / not ours to move.
    }
  }

  if (fs.existsSync(partitionDir('youtoba')) && !fs.existsSync(partitionDir('yourtoba'))) {
    try {
      fs.renameSync(partitionDir('youtoba'), partitionDir('yourtoba'))
    } catch {
      return 'persist:youtoba'
    }
  }
  return 'persist:yourtoba'
}

// A plain, current desktop Chrome UA — Electron's own UA string trips
// "unsupported browser" checks on Google properties, same fix WhatsTheFuck
// uses for web.whatsapp.com. Built from the real bundled Chromium version
// rather than a hardcoded number: Chromium's Client Hints headers
// (Sec-CH-UA etc.) are generated from process.versions.chrome regardless of
// what setUserAgent() claims, so a stale hardcoded version here would leave
// the UA string and the Client Hints headers disagreeing — exactly the kind
// of inconsistency Google's sign-in security check looks for.
const DESKTOP_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`

// youtube.com/tv (Leanback) is gated to console/TV clients. These two UA
// strings are VacuumTube's (MIT, github.com/shy1132/VacuumTube) — the
// "client" one is used only for the very first navigation, the "ongoing"
// one for every request after, per VacuumTube's own hard-won comment: an
// up-to-date Cobalt version on every request triggers playback issues, but
// works fine for the one-time initial handshake.
const TV_CLIENT_UA = `Mozilla/5.0 (PS4; Leanback Shell) Cobalt/19.lts.0-qa; compatible; YourTOBA/${app.getVersion()}`
const TV_UA = `Mozilla/5.0 (PS4; Leanback Shell) Cobalt/25.lts.40.1035033; compatible; YourTOBA/${app.getVersion()}`

let mainWindow = null
let desktopView = null
let tvView = null
let activeView = 'desktop'
let downloadPopup = null
let htmlFullscreen = false
let adBlockingReady = Promise.resolve()

const YTDLP_PATH = path.join(app.getPath('userData'), 'yt-dlp')
let ytDlp = null

function extractVideoId(url) {
  if (!url) return null
  const match =
    url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) ||
    url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) ||
    url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

async function ensureYtDlp() {
  if (ytDlp) return ytDlp
  if (!fs.existsSync(YTDLP_PATH)) {
    // yt-dlp-wrap's downloadFromGithub only special-cases win32 — every
    // other platform falls back to the plain Python zipapp asset, which
    // then fails at runtime unless a real python3.10+ is on PATH (macOS
    // ships an ancient system python3.9). Fetch the correct standalone
    // PyInstaller binary for macOS directly instead.
    const asset = process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp'
    const releases = await YTDlpWrap.getGithubReleases(1, 1)
    const version = releases[0].tag_name
    const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${asset}`
    await YTDlpWrap.downloadFile(url, YTDLP_PATH)
    fs.chmodSync(YTDLP_PATH, 0o755)
  }
  ytDlp = new YTDlpWrap(YTDLP_PATH)
  return ytDlp
}

// Bundled rather than relying on a system install: a GUI-launched app
// (Finder/Dock/Launchpad) doesn't inherit the shell PATH a Terminal
// session has, so a Homebrew ffmpeg at /opt/homebrew/bin was invisible to
// us even when correctly installed. ffmpeg-static ships a self-contained
// arm64 binary (only linked against system frameworks, confirmed via
// otool -L — no Homebrew dylib dependencies) so this sidesteps the PATH
// problem entirely rather than working around it. asarUnpack in
// package.json keeps the actual binary out of the read-only asar archive
// (which can't execute files directly) — the app.asar -> app.asar.unpacked
// swap below points at where electron-builder actually put it.
const FFMPEG_PATH = (() => {
  const bundled = require('ffmpeg-static')
  return bundled ? bundled.replace('app.asar', 'app.asar.unpacked') : null
})()

function hasFfmpeg() {
  if (!FFMPEG_PATH) return false
  try {
    execFileSync(FFMPEG_PATH, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// TV sign-in links the device to your account server-side (DEVICE_INFO /
// visitor cookies) — it never sets the real Google account session cookies
// (SID/HSID/SAPISID/...) that www.youtube.com checks to render signed-in
// state, and there's no bridge between the two. The only way to get Desktop
// signed in without hitting Google's embedded-browser sign-in block is to
// reuse a session that already exists in a real, trusted browser. yt-dlp
// already ships a well-tested browser-cookie reader for exactly this use
// case (its own --cookies-from-browser flag), so this shells out to the
// binary we already bundle rather than reimplementing Keychain/AES cookie
// decryption ourselves.
async function importCookiesFromBrowser(browser) {
  const dlp = await ensureYtDlp()
  const tmpFile = path.join(app.getPath('temp'), `yourtoba-cookies-${Date.now()}.txt`)

  let runError = null
  try {
    await dlp.execPromise([
      '--cookies-from-browser',
      browser,
      '--cookies',
      tmpFile,
      '--simulate',
      '--no-warnings',
      'https://www.youtube.com/watch?v=jNQXAC9IVRw'
    ])
  } catch (err) {
    // yt-dlp writes the cookie jar as soon as it loads cookies from the
    // browser, independent of whether this specific test video's formats
    // resolve — confirmed by forcing a "Video unavailable" error and
    // seeing the cookie file come out unchanged. So a thrown error here
    // isn't necessarily a cookie-extraction failure; only treat it as
    // fatal below if no usable cookie file actually came out.
    runError = err
  }

  if (!fs.existsSync(tmpFile) || fs.statSync(tmpFile).size === 0) {
    const message = runError?.message || String(runError) || 'yt-dlp did not produce a cookie file'
    if (message.includes('Operation not permitted')) {
      throw new Error(
        `macOS blocked access to ${browser}'s cookies. Grant Full Disk Access to yt-dlp, then try again:\n\n` +
          `System Settings → Privacy & Security → Full Disk Access → + → add:\n${YTDLP_PATH}`
      )
    }
    throw new Error(message)
  }

  const text = fs.readFileSync(tmpFile, 'utf-8')
  fs.unlinkSync(tmpFile)

  const ses = session.fromPartition(PARTITION)
  let imported = 0

  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) continue

    let line = rawLine
    let httpOnly = false
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true
      line = line.slice('#HttpOnly_'.length)
    } else if (line.startsWith('#')) {
      continue
    }

    const parts = line.split('\t')
    if (parts.length < 7) continue
    const [domain, , cookiePath, secureFlag, expiry, name, value] = parts
    if (!domain.includes('youtube.com') && !domain.includes('google.com')) continue

    const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain
    try {
      await ses.cookies.set({
        url: `https://${cleanDomain}${cookiePath}`,
        name,
        value,
        domain: cleanDomain,
        path: cookiePath,
        secure: secureFlag === 'TRUE',
        httpOnly,
        expirationDate: Number(expiry) || undefined
      })
      imported++
    } catch {
      // Electron rejects a handful of cookies (host-only prefix mismatches,
      // __Host-/__Secure- naming rules) — skip those rather than fail the
      // whole import over a handful of non-critical entries.
    }
  }

  desktopView?.webContents.reload()
  tvView?.webContents.reload()
  return imported
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 820,
    minHeight: 520,
    backgroundColor: BG,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 13 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'shell-preload.js')
    }
  })

  mainWindow.loadFile('shell.html')
  mainWindow.once('ready-to-show', () => mainWindow.show())

  createViews()

  mainWindow.on('resize', layoutViews)

  // Leaving native fullscreen from the window side — Cmd+Ctrl+F, View →
  // Toggle Full Screen, the green traffic light — tells the page nothing: it
  // stays in HTML fullscreen, no leave-html-full-screen ever arrives, and
  // the view would sit over the titlebar for good with the player still
  // drawing its fullscreen chrome inside a small window. Push the page out
  // of fullscreen ourselves, and restore the layout whether or not it obeys.
  mainWindow.on('leave-full-screen', () => {
    if (!htmlFullscreen) return
    const active = activeView === 'tv' ? tvView : desktopView
    active?.webContents
      .executeJavaScript('document.exitFullscreen && document.exitFullscreen()')
      .catch(() => {})
    setHtmlFullscreen(false)
  })

  mainWindow.on('focus', () => {
    const active = activeView === 'tv' ? tvView : desktopView
    active?.webContents.focus()
  })
  layoutViews()
}

function createViews() {
  desktopView = createContentView()
  desktopView.webContents.setUserAgent(DESKTOP_UA)

  tvView = createContentView({ isTv: true })
  tvView.webContents.setUserAgent(TV_UA)

  mainWindow.contentView.addChildView(desktopView)
  mainWindow.contentView.addChildView(tvView)

  // Hold only the first navigation until the blocker is attached (or has
  // given up — see startAdBlocking), so the very first page load is covered
  // too. The window and its chrome are already on screen by then.
  adBlockingReady.then(() => {
    desktopView.webContents.loadURL(DESKTOP_URL)
    tvView.webContents.loadURL(TV_URL, { userAgent: TV_CLIENT_UA })
  })

  desktopView.webContents.focus()

  const sendNavState = () => {
    mainWindow?.webContents.send('nav-state', {
      canGoBack: desktopView.webContents.navigationHistory.canGoBack(),
      canGoForward: desktopView.webContents.navigationHistory.canGoForward()
    })
  }
  desktopView.webContents.on('did-navigate', sendNavState)
  desktopView.webContents.on('did-navigate-in-page', sendNavState)

  // YouTube's client-side router (History API navigation between videos —
  // did-navigate-in-page, as opposed to a full did-navigate reload)
  // intermittently stalls partway: the URL updates but the player never
  // actually attaches a source. A hard reload of the same URL has fixed it
  // every single time it's been hit, so rather than wait around to detect
  // a stall that may or may not happen, force the reliable path (a real
  // loadURL) the instant router navigation lands on a watch page — before
  // anything has a chance to hang. loadURL triggers did-navigate, not
  // did-navigate-in-page, so this doesn't re-trigger itself. Only watch
  // pages are redirected this way; browsing the home feed/search/channels
  // keeps YouTube's normal fast SPA routing since those aren't affected.
  desktopView.webContents.on('did-navigate-in-page', (_event, url) => {
    if (extractVideoId(url)) {
      desktopView.webContents.loadURL(url)
    }
  })
}

function createContentView({ isTv } = {}) {
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      // Ad stripping in preload.js patches window.fetch/JSON.parse/the
      // ytInitial* globals directly, which requires the real page world —
      // contextIsolation stays off here (matches VacuumTube's validated
      // trade-off); nodeIntegration stays off so the page itself never
      // gets Node access regardless.
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      // Lets preload.js tell the TV view apart from the desktop one (both
      // load the same preload script) so gamepad polling only runs there.
      additionalArguments: isTv ? ['--yourtoba-tv'] : []
    }
  })
  view.setBackgroundColor(BG)

  view.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { host } = new URL(url)
      if (/(^|\.)(youtube\.com|google\.com|googleusercontent\.com)$/.test(host)) {
        // Keep Google sign-in / consent popups inside our persisted
        // session instead of losing the flow to an external browser.
        view.webContents.loadURL(url)
      } else if (url.startsWith('http')) {
        shell.openExternal(url)
      }
    } catch {
      // malformed url — just drop it
    }
    return { action: 'deny' }
  })

  view.webContents.on('enter-html-full-screen', () => setHtmlFullscreen(true))
  view.webContents.on('leave-html-full-screen', () => setHtmlFullscreen(false))

  view.webContents.on('context-menu', () => {
    const videoId = extractVideoId(view.webContents.getURL())
    if (!videoId) return
    Menu.buildFromTemplate([
      {
        label: 'Download Video…',
        click: () => openDownloadPopup(`https://www.youtube.com/watch?v=${videoId}`)
      }
    ]).popup()
  })

  return view
}

function getActiveVideoUrl() {
  const view = activeView === 'tv' ? tvView : desktopView
  const videoId = extractVideoId(view?.webContents.getURL())
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null
}

// A same-page overlay would render behind the desktop/TV WebContentsView
// layers (they're separately composited on top of everything below the
// titlebar, so nothing from the base window's own content can show through
// where their bounds overlap) — invisible and unclickable to a real click
// even though its own JS would still technically run. A genuine floating
// BrowserWindow sidesteps that entirely since window-manager stacking is
// independent of it.
function openDownloadPopup(url) {
  if (downloadPopup && !downloadPopup.isDestroyed()) {
    downloadPopup.close()
  }

  const width = 280
  const height = 300
  const bounds = mainWindow.getBounds()

  downloadPopup = new BrowserWindow({
    width,
    height,
    x: Math.round(bounds.x + bounds.width - width - 14),
    y: Math.round(bounds.y + 48),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#161414',
    show: false,
    parent: mainWindow,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'download-panel-preload.js')
    }
  })

  downloadPopup.loadFile('download-panel.html', url ? { query: { url } } : undefined)
  downloadPopup.once('ready-to-show', () => downloadPopup?.show())
  downloadPopup.on('blur', () => downloadPopup?.close())
  downloadPopup.on('closed', () => {
    downloadPopup = null
  })
}

function toggleDownloadPopup() {
  if (downloadPopup && !downloadPopup.isDestroyed()) {
    downloadPopup.close()
    return
  }
  openDownloadPopup(getActiveVideoUrl())
}

function layoutViews() {
  if (!mainWindow) return
  const [width, height] = mainWindow.getContentSize()
  // In HTML fullscreen the view takes the whole window, titlebar strip
  // included — see setHtmlFullscreen below.
  const top = htmlFullscreen ? 0 : TITLEBAR_HEIGHT
  const full = { x: 0, y: top, width, height: Math.max(0, height - top) }
  const collapsed = { x: 0, y: 0, width: 0, height: 0 }

  if (desktopView) desktopView.setBounds(activeView === 'desktop' ? full : collapsed)
  if (tvView) tvView.setBounds(activeView === 'tv' ? full : collapsed)
}

// Electron does put the window itself into native fullscreen when a page
// asks for HTML fullscreen, but nothing moves the WebContentsView: it stays
// parked below the titlebar, so a "fullscreen" video came up TITLEBAR_HEIGHT
// short with our own chrome still drawn across the top of the screen. Hand
// the view the entire window for as long as the page holds fullscreen, and
// give the titlebar its strip back on the way out.
function setHtmlFullscreen(on) {
  if (htmlFullscreen === on) return
  htmlFullscreen = on
  layoutViews()
}

function setActiveView(view) {
  if (view !== 'desktop' && view !== 'tv') return
  activeView = view
  layoutViews()
  // Resizing bounds alone doesn't move keyboard focus — without this the
  // hidden view (or nothing) keeps receiving key events after a toggle.
  const active = view === 'tv' ? tvView : desktopView
  active?.webContents.focus()
}

ipcMain.on('set-view', (_event, view) => setActiveView(view))

ipcMain.on('nav-back', () => {
  if (desktopView?.webContents.navigationHistory.canGoBack()) {
    desktopView.webContents.navigationHistory.goBack()
  }
})

ipcMain.on('nav-forward', () => {
  if (desktopView?.webContents.navigationHistory.canGoForward()) {
    desktopView.webContents.navigationHistory.goForward()
  }
})

ipcMain.on('nav-reload', () => {
  desktopView?.webContents.reload()
})

ipcMain.on('nav-home', () => {
  desktopView?.webContents.loadURL(DESKTOP_URL)
})

ipcMain.on('toggle-download-popup', () => toggleDownloadPopup())

ipcMain.on('show-downloads-folder', () => {
  shell.openPath(app.getPath('downloads'))
})

ipcMain.handle('start-download', async (_event, { url, quality, audioOnly, audioFormat }) => {
  if (!hasFfmpeg()) {
    return { ok: false, error: "Bundled ffmpeg didn't run — this looks like a packaging bug, not a missing install." }
  }

  let dlp
  try {
    dlp = await ensureYtDlp()
  } catch (err) {
    return { ok: false, error: `Couldn't fetch yt-dlp: ${err.message || err}` }
  }

  const outDir = app.getPath('downloads')
  const args = [url, '-P', outDir, '-o', '%(title)s.%(ext)s', '--newline', '--ffmpeg-location', FFMPEG_PATH]

  if (audioOnly) {
    args.push('-x', '--audio-format', audioFormat)
  } else {
    const heightMap = { '1080p': 1080, '720p': 720, '480p': 480 }
    const height = heightMap[quality]
    args.push('-f', height ? `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]` : 'bestvideo+bestaudio/best')
    args.push('--merge-output-format', 'mp4')
  }

  const popupContents = () => (downloadPopup && !downloadPopup.isDestroyed() ? downloadPopup.webContents : null)

  const emitter = dlp.exec(args)
  // yt-dlp's own step-by-step log lines ("Downloading webpage", "Destination:
  // ...", merge/extract-audio postprocessing) — surfaced so the popup shows
  // real activity during the early phase before any byte-progress exists,
  // rather than sitting blank.
  emitter.on('ytDlpEvent', (eventType, eventData) => popupContents()?.send('download-status', `${eventType}:${eventData}`.trim()))
  emitter.on('progress', (progress) => popupContents()?.send('download-progress', progress))

  return new Promise((resolve) => {
    emitter.on('error', (err) => resolve({ ok: false, error: err.message || String(err) }))
    emitter.on('close', (code) => {
      if (code === 0) {
        popupContents()?.send('download-complete', { dir: outDir })
        resolve({ ok: true })
      } else {
        resolve({ ok: false, error: 'yt-dlp exited with an error' })
      }
    })
  })
})

function createMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit YourTOBA', accelerator: 'Cmd+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'Cmd+R',
          click: () => {
            const view = activeView === 'tv' ? tvView : desktopView
            if (view) view.webContents.reload()
          }
        },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      label: 'Account',
      submenu: [
        importLoginMenuItem('Safari', 'safari'),
        importLoginMenuItem('Chrome', 'chrome'),
        importLoginMenuItem('Brave', 'brave'),
        importLoginMenuItem('Firefox', 'firefox')
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function importLoginMenuItem(label, browserId) {
  return {
    label: `Import Login from ${label}…`,
    click: async () => {
      try {
        const count = await importCookiesFromBrowser(browserId)
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          message: 'Login imported',
          detail: `Imported ${count} cookies from ${label}. Desktop and TV have been reloaded.`
        })
      } catch (err) {
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          message: "Couldn't import login",
          detail: err.message || String(err)
        })
      }
    }
  }
}

// The filter lists are fetched over the network, and the whole startup path
// used to sit behind that await: on a slow connection — or with a firewall
// prompt left unanswered — the app came up with a menu bar and no window at
// all, which reads as "it didn't launch". Fetch them alongside the UI
// instead, and give up waiting after a few seconds; the lists still attach
// whenever they do arrive, they just stop holding the first page load.
const AD_LIST_WAIT_MS = 4000

function startAdBlocking(ses) {
  const attached = ElectronBlocker.fromLists(fetch, adsAndTrackingLists, { loadCosmeticFilters: false })
    .then((blocker) => blocker.enableBlockingInSession(ses))
    .catch((err) => console.error('Ad filter lists failed to load:', err))

  return Promise.race([attached, new Promise((resolve) => setTimeout(resolve, AD_LIST_WAIT_MS))])
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'

  const ses = session.fromPartition(PARTITION)
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    // Chromium routes an HTML fullscreen request (what YouTube's fullscreen
    // button calls) through this same handler, so the blanket deny here was
    // exactly why that button did nothing: requestFullscreen() was rejected
    // before it ever reached the window, no 'enter-html-full-screen', no
    // fullscreenchange event, nothing for the player to react to. Everything
    // still not on this list stays denied.
    callback(permission === 'notifications' || permission === 'fullscreen')
  })

  // fromPrebuiltAdsAndTracking() enables cosmetic filtering by default,
  // which registers a per-frame preload script via session.registerPreloadScript.
  // That script collides with something in YouTube's own JS on navigation —
  // "SyntaxError: Identifier 'JSONPath' has already been declared" followed
  // by a stack-overflowing RangeError that took down Polymer's template
  // rendering, which is why videos stopped loading after browsing for a
  // while. Confirmed by disabling Ghostery entirely and watching the error
  // disappear. Network-level blocking (the actual ad/tracker blocking) runs
  // entirely in the main process via session.webRequest and never touches
  // the page's JS, so it's unaffected — this just skips the cosmetic-filter
  // preload injection that was crashing things.
  adBlockingReady = startAdBlocking(ses)

  app.setAboutPanelOptions({
    applicationName: 'YourTOBA',
    applicationVersion: app.getVersion(),
    credits: 'A small, beautiful native shell around YouTube — Desktop/TV toggle, ads stripped at the source.'
  })

  createMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
