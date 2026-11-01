const { app, BrowserWindow, WebContentsView, protocol, net, shell, Menu, ipcMain, dialog, safeStorage, nativeTheme, screen, powerMonitor, clipboard } = require("electron");
const vault = require("./vault.cjs");
const { createAi } = require("./ai.cjs");
const { extractFile } = require("./extract.cjs");
const { buildFile } = require("./export.cjs");
const { palette } = require("./theme.cjs");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

// Atelier: one window, a sidebar, and one workspace folder shared by every app.
// Each app is served from its own origin (app://<id>/) so its storage stays its
// own, and gets a local stand-in for Puter (shim/puter-shim.js) that keeps files
// in the workspace folder instead of a cloud.

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const APPS = [
  { id: "documents", name: "Documents", folder: "Documents", exts: ["docx", "dotx", "docm"], color: "#2b6cb0", blurb: "Word processor" },
  { id: "presentation", name: "Presentation", folder: "Presentations", exts: ["pptx", "potx"], color: "#d9622b", blurb: "Slides" },
  { id: "spreadsheet", name: "Spreadsheet", folder: "Spreadsheets", exts: ["xlsx", "xlsm", "csv", "tsv"], color: "#1f8a4c", blurb: "Sheets and formulas" },
  { id: "pdf", name: "PDF", folder: "PDF Editor", exts: ["pdf"], color: "#d1343b", blurb: "View and edit PDFs" },
];
const appById = (id) => APPS.find((a) => a.id === id);
// Which apps can open a file, first = default.
function appsFor(ext) {
  const e = ext.toLowerCase();
  const hit = APPS.filter((a) => !a.collection && a.exts.includes(e)).map((a) => a.id);
  return hit;
}

// ---------- config & workspace ----------
const configFile = () => path.join(app.getPath("userData"), "atelier.json");
let config = { root: null, recent: [], ext: [], workspaces: [], session: [] };
function loadConfig() {
  try {
    config = Object.assign(config, JSON.parse(fs.readFileSync(configFile(), "utf8")));
  } catch {
    /* first run */
  }
  if (!config.root) config.root = path.join(app.getPath("documents"), "Atelier Lite");
  fs.mkdirSync(config.root, { recursive: true });
  for (const a of APPS) if (!a.collection) fs.mkdirSync(path.join(config.root, a.folder), { recursive: true });
}
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  } catch {
    /* non-fatal */
  }
}

class FsError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}
const inside = (abs) => abs === config.root || abs.startsWith(config.root + path.sep);
const EXT_PREFIX = "/__ext/";
// A virtual path (what apps see) -> an absolute path. Files outside the workspace
// that a person picked in a dialog are reachable as /__ext/<encoded absolute path>.
function toAbs(p) {
  let s = String(p ?? "").replace(/\\/g, "/");
  if (s.startsWith(EXT_PREFIX)) {
    const abs = path.normalize(decodeURIComponent(s.slice(EXT_PREFIX.length)));
    if (!config.ext.includes(abs)) throw new FsError("forbidden", "That file was not opened from this workspace.");
    return abs;
  }
  s = s.replace(/^~\//, "").replace(/^\/+/, "");
  const abs = path.resolve(config.root, s);
  if (!inside(abs)) throw new FsError("forbidden", "Path is outside the workspace.");
  return abs;
}
function toVirtual(abs) {
  if (inside(abs)) return "/" + path.relative(config.root, abs).split(path.sep).join("/");
  if (!config.ext.includes(abs)) {
    config.ext.push(abs);
    saveConfig();
  }
  return EXT_PREFIX + encodeURIComponent(abs);
}
function meta(abs) {
  const st = fs.statSync(abs);
  const vp = toVirtual(abs);
  return {
    id: vp,
    uid: vp,
    name: path.basename(abs),
    path: vp,
    is_dir: st.isDirectory(),
    size: st.isDirectory() ? 0 : st.size,
    modified: Math.round(st.mtimeMs),
    created: Math.round(st.birthtimeMs || st.ctimeMs),
  };
}
function uniquePath(abs) {
  if (!fs.existsSync(abs)) return abs;
  const { dir, name, ext } = path.parse(abs);
  for (let n = 1; ; n++) {
    const cand = path.join(dir, `${name} (${n})${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
}
function notFound(abs) {
  return new FsError("subject_does_not_exist", `${path.basename(abs)} does not exist`);
}
// The document each app is working on: the file it last opened or saved. The AI
// panel reads it for context. Reads only count while nothing better is known.
const DOC_EXT = /\.(docx|dotx|docm|pptx|potx|xlsx|xlsm|csv|tsv|pdf)$/i;
const currentDoc = new Map(); // tab id -> { abs, kind, t }
function touchDoc(tabId, abs, kind) {
  if (!tabId || !DOC_EXT.test(abs) || /[\\/]\./.test(path.relative(config.root, abs)) || /[\\/]Templates[\\/]/i.test(abs)) return;
  const cur = currentDoc.get(tabId);
  if (kind === "read" && cur && cur.kind !== "read") return;
  currentDoc.set(tabId, { abs, kind, t: Date.now() });
  const tab = tabs.get(tabId);
  if (tab && kind !== "read") {
    tab.file = abs;
    pushTabs();
  }
}
function remember(abs, appId, tabId) {
  touchDoc(tabId, abs, "open");
  config.recent =[{ abs, app: appId, t: Date.now() }, ...config.recent.filter((r) => r.abs !== abs)].slice(0, 60);
  saveConfig();
}

// ---------- fs operations (called from the apps' Puter stand-in) ----------
const ops = {
  stat({ path: p }) {
    const abs = toAbs(p);
    if (!fs.existsSync(abs)) throw notFound(abs);
    return meta(abs);
  },
  read({ path: p }) {
    const abs = toAbs(p);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) throw notFound(abs);
    return new Uint8Array(fs.readFileSync(abs));
  },
  write({ path: p, data, opts = {} }) {
    let abs = toAbs(p);
    if (opts.createMissingParents !== false) fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (fs.existsSync(abs)) {
      if (opts.dedupeName) abs = uniquePath(abs);
      else if (opts.overwrite === false) throw new FsError("item_with_same_name_exists", `${path.basename(abs)} already exists`);
    }
    const tmp = abs + ".atelier-tmp";
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, abs);
    return meta(abs);
  },
  readdir({ path: p }) {
    const abs = toAbs(p);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw notFound(abs);
    return fs
      .readdirSync(abs)
      .filter((n) => !n.endsWith(".atelier-tmp"))
      .map((n) => {
        try {
          return meta(path.join(abs, n));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  },
  mkdir({ path: p, opts = {} }) {
    const abs = toAbs(p);
    fs.mkdirSync(abs, { recursive: true });
    return meta(abs);
  },
  delete({ path: p, opts = {} }) {
    const abs = toAbs(p);
    if (!fs.existsSync(abs)) throw notFound(abs);
    fs.rmSync(abs, { recursive: !!opts.recursive || fs.statSync(abs).isDirectory(), force: true });
    return true;
  },
  rename({ path: p, name }) {
    const abs = toAbs(p);
    if (!fs.existsSync(abs)) throw notFound(abs);
    const to = path.join(path.dirname(abs), path.basename(String(name)));
    if (to !== abs && fs.existsSync(to)) throw new FsError("item_with_same_name_exists", `${path.basename(to)} already exists`);
    fs.renameSync(abs, to);
    return meta(to);
  },
  move({ source, destination, opts = {} }) {
    const abs = toAbs(source);
    if (!fs.existsSync(abs)) throw notFound(abs);
    let dest = toAbs(destination);
    if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) dest = path.join(dest, path.basename(abs));
    else fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && !opts.overwrite) dest = uniquePath(dest);
    fs.renameSync(abs, dest);
    return meta(dest);
  },
  copy({ source, destination, opts = {} }) {
    const abs = toAbs(source);
    if (!fs.existsSync(abs)) throw notFound(abs);
    let dest = toAbs(destination);
    if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) dest = path.join(dest, path.basename(abs));
    else fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && !opts.overwrite) dest = uniquePath(dest);
    fs.cpSync(abs, dest, { recursive: true });
    return meta(dest);
  },
  // One app handing a workspace file to another ("Open in Spreadsheet").
  launch({ path: p, app: appId }) {
    const abs = toAbs(p);
    if (!fs.existsSync(abs) || !appById(appId)) throw notFound(abs);
    launchItem(appId, abs);
    return true;
  },
};

// Native dialogs, starting in the calling app's own workspace folder.
function filtersFor(accept) {
  const list = (Array.isArray(accept) ? accept : accept ? [accept] : []).flatMap((a) => String(a).split(","));
  const exts = list.map((a) => a.trim()).filter((a) => /^\.?[\w-]+$/.test(a) && !a.includes("/")).map((a) => a.replace(/^\./, ""));
  return exts.length ? [{ name: "Supported files", extensions: exts }, { name: "All files", extensions: ["*"] }] : [{ name: "All files", extensions: ["*"] }];
}
function appDir(appId) {
  const a = appById(appId);
  const dir = a ? path.join(config.root, a.folder) : config.root;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const dialogOps = {
  async dialogOpen({ accept, multiple }, { appId, tabId, win }) {
    const opts = {
      defaultPath: appDir(appId),
      properties: ["openFile", ...(multiple ? ["multiSelections"] : [])],
      filters: filtersFor(accept),
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths.length) return null;
    r.filePaths.forEach((f) => remember(f, appId, tabId));
    return r.filePaths.map(meta);
  },
  async dialogSave({ data, name, accept }, { appId, tabId, win }) {
    const opts = {
      defaultPath: path.join(appDir(appId), String(name || "Untitled").replace(/[\\/:*?"<>|]/g, "_")),
      filters: filtersFor(accept),
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, Buffer.from(data || []));
    remember(r.filePath, appId, tabId);
    return meta(r.filePath);
  },
};

// ---------- app scheme ----------
const APP_DIST = (id) => path.join(__dirname, "..", "apps", id);
const SHELL_DIR = path.join(__dirname, "..", "shell");
const SHIM = path.join(__dirname, "..", "shim", "puter-shim.js");
const TYPES = {
  ".wasm": "application/wasm", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
};
function registerAppProtocol() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    const host = url.hostname;
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname === "") pathname = "/index.html";
    if (pathname === "/__atelier/puter-shim.js") return new Response(fs.readFileSync(SHIM), { headers: { "Content-Type": "text/javascript" } });
    if (pathname === "/__atelier/no-ai.js") return new Response(fs.readFileSync(path.join(path.dirname(SHIM), "no-ai.js")), { headers: { "Content-Type": "text/javascript" } });
    const base = host === "shell" ? SHELL_DIR : appById(host) ? APP_DIST(host) : null;
    if (!base) return new Response("Not found", { status: 404 });
    const file = path.normalize(path.join(base, pathname));
    if (!file.startsWith(base)) return new Response("Forbidden", { status: 403 });
    // The apps are prepared once, when the installer is built (scripts/sync-apps.mjs: the local
    // stand-in script, the rewording, no built-in AI). Serving is then just streaming files.
    if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) return response;
    const headers = new Headers(response.headers);
    headers.set("Content-Type", type);
    return new Response(response.body, { status: response.status, headers });
  });
}

// ---------- window & views ----------
let mainWindow = null;
let sidebar = 0; // there is no side panel any more: Home and the tab strip start at the left edge
const AI_WIDTH = 380;
let aiOpen = false;
// Every open document is a tab: a view of its own, so several files of the same app can be
// open side by side in the tab strip. `current` is "home" or a tab id.
const TAB_H = 40;
let current = "home";
// The welcome screen (create a workspace, open one, pick a recent one) shows until a workspace is opened.
let welcomeMode = true;
function setWelcome(on) {
  welcomeMode = !!on;
  if (mainWindow && !mainWindow.isDestroyed()) {
    tabsView?.setVisible(!welcomeMode);
    layout();
    sendUi("ui:welcome", welcomeMode);
  }
}
let tabSeq = 0;
const tabs = new Map(); // id -> { id, app, view, title, file }
const tabOrder = [];
const lastTabOfApp = new Map();
// Atelier's own UI above the apps, each a view of its own so nothing is painted under an app:
// the tab strip (top), the AI panel (right edge) and a full-window overlay for menus and dialogs.
let tabsView = null;
let aiView = null;
let overlayView = null;
let overlayOpen = false;
let lockView = null; // the vault's lock screen, above everything else

// The colours everything is painted with: the mode (light, dark or the system's) plus the colour theme.
// Preferences (Settings dialog). Everything has a default, so an old settings file just works.
const PREF_DEFAULTS = { startup: "welcome", askSave: true, defaultFolder: "", textSize: "normal", reduceMotion: false, lowPower: false, sleepMinutes: 10, awakeTabs: 5 };
const prefs = () => ({ ...PREF_DEFAULTS, ...(config.prefs || {}) });
const textScale = () => ({ normal: 1, large: 1.12, largest: 1.25 })[prefs().textSize] || 1;
const awakeLimit = () => (prefs().lowPower ? 2 : prefs().awakeTabs); // 0 = no limit
const sleepAfter = () => (prefs().lowPower ? 5 : prefs().sleepMinutes); // minutes, 0 = never
const currentPalette = () => ({ ...palette(config.accent || "indigo", nativeTheme.shouldUseDarkColors), textScale: textScale(), reduce: !!(prefs().reduceMotion || prefs().lowPower) });
// Sends the palette to every page (the shell's own views and the apps) and recolours the window controls.
function broadcastTheme() {
  const p = currentPalette();
  sendUi("ui:theme", p);
  for (const t of tabs.values()) if (t.view && !t.view.webContents.isDestroyed()) t.view.webContents.send("atelier:theme", p);
  for (const s of standalones.values()) if (!s.win.isDestroyed()) s.win.webContents.send("ui:theme", p), s.view.webContents.send("atelier:theme", p);
  for (const w of [mainWindow, ...[...standalones.values()].map((s) => s.win)]) {
    if (w && !w.isDestroyed() && process.platform === "win32") w.setTitleBarOverlay({ color: p.titleBar, symbolColor: p.titleSymbol, height: TAB_H });
    if (w && !w.isDestroyed()) w.setBackgroundColor(p.dark ? p.page : p.page);
  }
}
const standalones = new Map(); // window id -> { win, view, app, file }
let tabsWidth = 600; // how wide the tab strip needs to be, reported by the strip itself

// Where the tab strip is: the window page keeps its drag area clear of it (a drag area would eat the clicks).
function stripState() {
  if (!mainWindow || mainWindow.isDestroyed()) return { left: 0, width: 0 };
  const [w] = mainWindow.getContentSize();
  const stripW = Math.max(0, Math.min(tabsWidth, w - sidebar - 560));
  return { left: sidebar, width: tabsView && tabsView.getVisible() ? stripW : 0 };
}
function layout() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getContentSize();
  // Only the tab on screen is resized; the hidden ones catch up when they are shown, so
  // opening a panel does not make every heavy editor re-lay-out at once.
  // The tab strip runs the full width of the window, with the window buttons at its right end;
  // the assistant sits under it, beside the app.
  const content = Math.max(0, w - sidebar - (aiOpen ? AI_WIDTH : 0));
  const t = tabs.get(current);
  if (t?.view) t.view.setBounds({ x: sidebar, y: TAB_H, width: content, height: Math.max(0, h - TAB_H) });
  // Narrower than the row: what is left is the window page behind it, where the window can be dragged.
  const stripW = Math.max(0, Math.min(tabsWidth, w - sidebar - 560));
  tabsView?.setBounds({ x: sidebar, y: 0, width: stripW, height: TAB_H });
  // The window page tells its drag area to stay clear of the strip: a drag region under a view would
  // otherwise take the clicks meant for the tabs.
  mainWindow.webContents.send("ui:strip", stripState());
  aiView?.setBounds({ x: Math.max(0, w - AI_WIDTH), y: TAB_H, width: AI_WIDTH, height: Math.max(0, h - TAB_H) });
  overlayView?.setBounds({ x: 0, y: 0, width: w, height: h });
  // Below the tab row, so the window buttons and the drag area stay usable on the lock screen.
  lockView?.setBounds({ x: 0, y: TAB_H, width: w, height: Math.max(0, h - TAB_H) });
}
function focusContent() {
  const t = tabs.get(current);
  if (t?.view) t.view.webContents.focus();
  else mainWindow?.webContents.focus();
}
// Views added later sit on top, so after adding an app, lift the panel and overlay above it.
function raiseUi() {
  if (!mainWindow) return;
  if (aiView) mainWindow.contentView.addChildView(aiView);
  if (overlayView) mainWindow.contentView.addChildView(overlayView);
  if (lockView) mainWindow.contentView.addChildView(lockView);
}
const sendUi = (channel, payload) => {
  for (const wc of [mainWindow?.webContents, tabsView?.webContents, aiView?.webContents, overlayView?.webContents, lockView?.webContents]) if (wc && !wc.isDestroyed()) wc.send(channel, payload);
};
// Created on first use.
function ensureTabsView() {
  if (!tabsView && mainWindow) {
    tabsView = makeUiView("tabs.html");
    tabsView.setVisible(false);
    mainWindow.contentView.addChildView(tabsView);
    layout();
  }
  return tabsView;
}
function ensureAiView() {
  if (!aiView && mainWindow) {
    aiView = makeUiView("ai.html");
    aiView.webContents.on("dom-ready", () => aiView && !aiView.webContents.isDestroyed() && aiView.webContents.setZoomFactor(textScale()));
    aiView.setVisible(aiOpen);
    mainWindow.contentView.addChildView(aiView);
    aiView.webContents.once("did-finish-load", () => aiView?.webContents.send("ui:ai-open", aiOpen));
    raiseUi();
    layout();
  }
  return aiView;
}
function ensureOverlayView() {
  if (!overlayView && mainWindow) {
    overlayView = makeUiView("overlay.html");
    overlayView.setBackgroundColor("#00000000");
    overlayView.setVisible(false);
    mainWindow.contentView.addChildView(overlayView);
    raiseUi();
    layout();
  }
  return overlayView;
}
function setAiOpen(state) {
  aiOpen = !!state;
  config.aiOpen = aiOpen;
  saveConfig();
  if (aiOpen) ensureAiView();
  aiView?.setVisible(aiOpen);
  layout();
  sendUi("ui:ai-open", aiOpen);
  if (aiOpen) aiView?.webContents.focus();
  else focusContent();
}
function showOverlay(payload) {
  if (vaultLocked) return;
  const view = ensureOverlayView();
  if (!view) return;
  overlayOpen = true;
  view.setVisible(true);
  raiseUi();
  layout();
  const wc = view.webContents;
  const send = () => (wc.send("ui:overlay", payload), wc.focus());
  if (wc.isLoading()) wc.once("did-finish-load", send);
  else send();
}
function hideOverlay() {
  if (!overlayView || !overlayOpen) return;
  overlayOpen = false;
  overlayView.setVisible(false);
  if (aiOpen) aiView?.webContents.focus();
  else focusContent();
}
function makeUiView(file) {
  const v = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload-shell.cjs") },
  });
  hardenContents(v.webContents);
  v.webContents.loadURL(`app://shell/${file}`);
  return v;
}
// A link from one file to another: atelier://open/Presentations/Q4%20deck.pptx. Clicking it opens that file in a tab.
function openAtelierLink(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "open" || vaultLocked || welcomeMode) return false;
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    const abs = path.resolve(config.root, rel);
    const target = appsFor(path.extname(abs).slice(1))[0];
    if (!inside(abs) || !target || !fs.existsSync(abs)) return false;
    launchItem(target, abs);
    return true;
  } catch {
    return false;
  }
}
function hardenContents(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    else if (/^atelier:/i.test(url)) openAtelierLink(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    if (/^atelier:/i.test(url)) return (event.preventDefault(), openAtelierLink(url));
    if (!url.startsWith("app://")) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  // Alt+1..7 switch apps, Alt+0 / Alt+H go Home, Alt+T new tab, Alt+W close tab,
  // Alt+PageUp / PageDown step through tabs: all work from inside any app.
  wc.on("before-input-event", (event, input) => {
    // These belong to the workspace window; a document opened alone has none of them.
    if (!mainWindow || vaultLocked || [...standalones.values()].some((s) => s.view.webContents === wc || s.win.webContents === wc)) return;
    if (input.type === "keyDown" && input.key === "F1") return (event.preventDefault(), showOverlay({ kind: "about" }));
    // Ctrl+Shift+K: link to another file, from inside any app (Ctrl+K stays with the app's own hyperlink).
    if (input.type === "keyDown" && input.control && input.shift && !input.alt && input.key.toLowerCase() === "k" && !welcomeMode) return (event.preventDefault(), showOverlay({ kind: "link", canInsert: !!tabs.get(current)?.view }));
    if (input.type === "keyDown" && input.alt && !input.control && !input.meta && input.key === ",") return (event.preventDefault(), showOverlay({ kind: "settings" }));
    if (input.type !== "keyDown" || !input.alt || input.control || input.meta || welcomeMode) return;
    const k = input.key.toLowerCase();
    if (k === "h" || k === "0") (event.preventDefault(), activate("home"));
    else if (/^[1-4]$/.test(k)) (event.preventDefault(), showApp(APPS[Number(k) - 1].id));
    else if (k === "a") (event.preventDefault(), setAiOpen(!aiOpen));
    else if (k === "w") (event.preventDefault(), tabs.has(current) && closeTab(current));
    else if (k === "t") (event.preventDefault(), tabs.has(current) && activate(createTab(tabs.get(current).app).id));
    else if (k === "pageup" || k === "pagedown") (event.preventDefault(), stepTab(k === "pageup" ? -1 : 1));
  });
}

// ---------- tabs ----------
function cleanTitle(t) {
  const app = appById(t.app).name;
  let s = (t.title || "").split(/\s+(?:—|–|\||·|-)\s+/)[0].trim();
  if (!s || s.toLowerCase() === app.toLowerCase()) s = t.file ? path.basename(t.file) : app;
  return s;
}
function pushTabs() {
  const list = tabOrder.map((id) => {
    const t = tabs.get(id);
    const a = appById(t.app);
    return { id, app: t.app, appName: a.name, color: a.color, title: cleanTitle(t), asleep: !t.view };
  });
  const payload = { tabs: list, current };
  if (tabsView && !tabsView.webContents.isDestroyed()) tabsView.webContents.send("ui:tabs", payload);
  // The window page shows its own assistant button in the top row once there are tabs.
  if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send("ui:tabs", payload);
  scheduleProjectSave();
}
const APP_ZOOM = {};
function appZoom(appId) {
  return (APP_ZOOM[appId] || 1) * textScale();
}
function applyAppZoom(wc, appId) {
  wc.__atelierApp = appId;
  const set = () => {
    try {
      wc.setZoomFactor(appZoom(appId));
    } catch {
      /* page is going away */
    }
  };
  wc.on("dom-ready", set);
  set();
}
// The text size changed: every open app (and the assistant) follows at once.
function reapplyZoom() {
  const wcs = [...tabs.values()].map((x) => x.view?.webContents).concat([...standalones.values()].map((s) => s.view?.webContents));
  for (const wc of wcs) if (wc && !wc.isDestroyed() && wc.__atelierApp) wc.setZoomFactor(appZoom(wc.__atelierApp));
  if (aiView && !aiView.webContents.isDestroyed()) aiView.webContents.setZoomFactor(textScale());
}
// A tab can sleep: it is in the strip but has no page, so it uses no memory, until it is shown.
// That is how a saved project reopens quickly: only the tab you were on wakes up.
function materialize(tab) {
  if (tab.view) return tab.view;
  const v = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload-app.cjs"),
      additionalArguments: ["--atelier-app=" + tab.app],
    },
  });
  v.setVisible(false);
  applyAppZoom(v.webContents, tab.app);
  hardenContents(v.webContents);
  mainWindow.contentView.addChildView(v);
  tab.view = v;
  raiseUi();
  v.webContents.on("page-title-updated", (_e, title) => ((tab.title = title), pushTabs()));
  v.webContents.on("render-process-gone", () => v.webContents.reload());
  v.webContents.loadURL(`app://${tab.app}/index.html`);
  if (tab.restoreFile) {
    const abs = tab.restoreFile;
    tab.restoreFile = null;
    sendOpen(tab, abs);
  }
  return v;
}
// Hands a file to the app in a tab, once its page is ready.
function sendOpen(tab, abs) {
  sendOpenTo(tab.view.webContents, tab.app, abs);
}
function sendOpenTo(wc, appId, abs) {
  const send = () => {
    wc.send("atelier:open-item", meta(abs));
  };
  if (wc.isLoading()) wc.once("did-finish-load", send);
  else send();
}

// ---------- sleeping tabs (keeps the PC light) ----------
// A tab that has not been used for a while, or that is beyond the "awake" limit, gives up its page.
// It stays in the strip; opening it again reloads the file where it was saved. A file with unsaved
// changes never sleeps.
function sleepTab(t) {
  if (!t.view) return;
  t.restoreFile = t.file;
  try {
    mainWindow.contentView.removeChildView(t.view);
    if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
  } catch {
    /* already gone */
  }
  t.view = null;
  pushTabs();
}
async function isClean(t) {
  try {
    const wc = t.view.webContents;
    if (wc.isLoading()) return false;
    const js = "(() => { const x = ((document.body && document.body.innerText) || '').slice(0, 8000); return !/not saved|unsaved|saving…|saving\\.\\.\\./i.test(x); })()";
    return await Promise.race([wc.executeJavaScript(js, true), new Promise((r) => setTimeout(() => r(false), 1500))]);
  } catch {
    return false;
  }
}
let sleeperBusy = false;
async function runSleeper() {
  if (sleeperBusy || !mainWindow || mainWindow.isDestroyed() || vaultLocked || welcomeMode) return;
  sleeperBusy = true;
  try {
    const now = Date.now();
    const mins = sleepAfter();
    const cap = awakeLimit();
    const awake = [...tabs.values()].filter((x) => x.view);
    const cur = tabs.get(current);
    if (cur) cur.lastActive = now;
    const candidates = awake.filter((x) => x.id !== current && x.file && !x.restoreFile).sort((a, b) => (a.lastActive || 0) - (b.lastActive || 0));
    const doze = new Set();
    if (mins > 0) for (const x of candidates) if (now - (x.lastActive || now) >= mins * 60000) doze.add(x);
    if (cap > 0) {
      let n = awake.length - doze.size;
      for (const x of candidates) {
        if (n <= cap) break;
        if (!doze.has(x)) (doze.add(x), n--);
      }
    }
    for (const x of doze) if (x.view && (await isClean(x))) sleepTab(x);
  } finally {
    sleeperBusy = false;
  }
}

// ---------- a document in a window of its own ----------
// Opens one file in one app, with none of the workspace around it: no sidebar, no Home, no project.
// Files opened from outside (Explorer, "Open with") arrive this way, and Home can open any file in one.
const soloOf = (e) => [...standalones.values()].find((s) => s.view.webContents.id === e.sender.id || s.win.webContents.id === e.sender.id) || null;
function createStandalone(appId, abs) {
  const dup = [...standalones.values()].find((s) => s.file === abs && !s.win.isDestroyed());
  if (dup) return (dup.win.isMinimized() && dup.win.restore(), dup.win.focus());
  const p = currentPalette();
  const work = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: Math.min(1240, work.width),
    height: Math.min(840, work.height),
    minWidth: Math.min(720, work.width),
    minHeight: Math.min(480, work.height),
    show: false,
    backgroundColor: p.page,
    title: path.basename(abs),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: p.titleBar, symbolColor: p.titleSymbol, height: TAB_H },
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload-shell.cjs") },
  });
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload-app.cjs"), additionalArguments: ["--atelier-app=" + appId] },
  });
  const entry = { win, view, app: appId, file: abs };
  standalones.set(win.id, entry);
  win.contentView.addChildView(view);
  hardenContents(win.webContents);
  applyAppZoom(view.webContents, appId);
  hardenContents(view.webContents);
  const fit = () => {
    if (win.isDestroyed()) return;
    const [w, h] = win.getContentSize();
    view.setBounds({ x: 0, y: TAB_H, width: w, height: Math.max(0, h - TAB_H) });
  };
  win.on("resize", fit);
  fit();
  win.loadURL("app://shell/solo.html");
  view.webContents.loadURL(`app://${appId}/index.html`);
  sendOpenTo(view.webContents, appId, abs);
  view.webContents.on("render-process-gone", () => view.webContents.reload());
  view.webContents.on("page-title-updated", (_e, title) => {
    entry.title = title;
    if (!win.isDestroyed()) (win.setTitle(title), win.webContents.send("ui:solo", soloInfo(entry)));
  });
  win.once("ready-to-show", () => win.show());
  win.on("focus", () => view.webContents.focus());
  win.on("closed", () => standalones.delete(win.id));
  touchDocExternal(abs, appId);
}
const soloInfo = (s) => ({ name: path.basename(s.file), title: s.title || path.basename(s.file), app: s.app, appName: appById(s.app).name, color: appById(s.app).color, workspace: !!mainWindow });
function touchDocExternal(abs, appId) {
  config.recent = [{ abs, app: appId, t: Date.now() }, ...config.recent.filter((r) => r.abs !== abs)].slice(0, 60);
  saveConfig();
}
// The workspace window: made on demand when the app was started for a single file.
function openWorkspace() {
  if (mainWindow) return (mainWindow.isMinimized() && mainWindow.restore(), mainWindow.focus());
  createWindow();
  startWorkspace();
  for (const s of standalones.values()) if (!s.win.isDestroyed()) s.win.webContents.send("ui:solo", soloInfo(s));
}
// A file from outside opens alone, unless it belongs to the workspace that is already open.
function openExternalFile(f) {
  const target = appsFor(path.extname(f).slice(1))[0];
  if (!target) return;
  if (mainWindow && !welcomeMode && inside(f)) return launchItem(target, f);
  createStandalone(target, f);
}
function createTab(appId, { file = null, sleeping = false } = {}) {
  const id = "t" + ++tabSeq;
  const tab = { id, app: appId, view: null, title: "", file, restoreFile: sleeping ? file : null, lastActive: Date.now() };
  tabs.set(id, tab);
  tabOrder.push(id);
  if (file) touchDoc(id, file, "open");
  if (!sleeping) materialize(tab);
  pushTabs();
  return tab;
}
// "home" or a tab id.
function activate(id) {
  current = tabs.has(id) ? id : "home";
  const t = tabs.get(current);
  if (t) t.lastActive = Date.now();
  if (t) materialize(t);
  for (const x of tabs.values()) x.view?.setVisible(x.id === current);
  if (t) lastTabOfApp.set(t.app, t.id);
  // The strip stays up on Home too while any tab is open (none is highlighted there).
  // The strip (with the Home button) is always there, except on the welcome screen.
  if (!welcomeMode) ensureTabsView().setVisible(true);
  else tabsView?.setVisible(false);
  layout();
  mainWindow.webContents.send("shell:active", t ? t.app : "home");
  pushTabs();
  focusContent();
}
// The sidebar and Alt+1..7: the app's most recent tab, or a first one.
function showApp(appId) {
  if (vaultLocked || welcomeMode) return;
  const known = tabs.get(lastTabOfApp.get(appId)) || tabOrder.map((i) => tabs.get(i)).filter((t) => t.app === appId).pop();
  activate((known || createTab(appId)).id);
}
const show = (id) => (id === "home" ? activate("home") : showApp(id));
function closeTab(id, { quiet = false } = {}) {
  const t = tabs.get(id);
  if (!t) return;
  const i = tabOrder.indexOf(id);
  tabOrder.splice(i, 1);
  tabs.delete(id);
  currentDoc.delete(id);
  if (lastTabOfApp.get(t.app) === id) lastTabOfApp.delete(t.app);
  if (t.view) {
    mainWindow.contentView.removeChildView(t.view);
    if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
  }
  if (quiet) return;
  if (current === id) activate(tabOrder[Math.min(i, tabOrder.length - 1)] || "home");
  else pushTabs();
}
function stepTab(delta) {
  if (!tabOrder.length) return;
  const i = Math.max(0, tabOrder.indexOf(current));
  activate(tabOrder[(i + delta + tabOrder.length) % tabOrder.length]);
}
// Opens a file in its own tab, or goes to the tab that already has it.
function launchItem(appId, abs) {
  if (vaultLocked || welcomeMode) return;
  const dup = tabOrder.map((i) => tabs.get(i)).find((t) => t.app === appId && t.file === abs);
  if (dup) return activate(dup.id);
  const tab = createTab(appId, { file: abs });
  activate(tab.id);
  remember(abs, appId, tab.id);
  sendOpen(tab, abs);
}

// ---------- projects: a workspace folder you can switch to, with its open tabs saved ----------
// A project is a folder (like a vault) holding the app sub-folders and one small
// "<name>.atle" file: its name, colour, open tabs and AI session. It saves itself as you work,
// and double-clicking the .atle file opens the project with everything where you left it.
const PROJECT_COLORS = ["#5b6cff", "#0ea5b7", "#2f9e62", "#d98a0b", "#e0457b", "#8b5cf6", "#d9622b", "#6b7280"];
let projectSaveTimer = null;
let projectSaveSuspended = false;
let saveEmptyTabs = false; // "Don't save" when closing: the workspace comes back with no tabs open
let projectSavedAt = null;
let notifySession = () => {};
const colorFor = (root) => PROJECT_COLORS[[...String(root)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PROJECT_COLORS.length];
const safeFileName = (s) => String(s || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
function findProjectFile(root) {
  try {
    const f = fs.readdirSync(root).find((n) => n.toLowerCase().endsWith(".atle"));
    return f ? path.join(root, f) : null;
  } catch {
    return null;
  }
}
function readProject(root) {
  try {
    const p = JSON.parse(fs.readFileSync(findProjectFile(root), "utf8"));
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}
function projectName(root) {
  const f = findProjectFile(root);
  if (f) return path.basename(f, path.extname(f));
  return (config.workspaces || []).find((w) => w.root === root)?.name || path.basename(root) || "Atelier";
}
const relToRoot = (abs) => (inside(abs) ? path.relative(config.root, abs).split(path.sep).join("/") : abs);
const absFromRoot = (p) => (path.isAbsolute(p) ? p : path.join(config.root, p));
function writeProject() {
  // A locked project has no tabs open; saving then would erase the ones it will come back to.
  if (projectSaveSuspended || vaultLocked || welcomeMode || !mainWindow || !config.root) return;
  try {
    const name = projectName(config.root);
    const file = findProjectFile(config.root) || path.join(config.root, (safeFileName(name) || "Project") + ".atle");
    const files = saveEmptyTabs ? [] : tabOrder.map((id) => tabs.get(id));
    const state = {
      atelier: 1,
      name,
      color: colorFor(config.root),
      tabs: files.map((t) => ({ app: t.app, file: t.file ? relToRoot(t.file) : null })),
      active: saveEmptyTabs ? -1 : tabOrder.indexOf(current),
      session: (config.session || []).map(relToRoot),
      sessionTabs: config.sessionTabs !== false,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    projectSavedAt = Date.now();
    sendUi("ui:workspace", wsInfo());
  } catch {
    /* a read-only folder or a vanished drive: the project simply is not saved */
  }
}
function scheduleProjectSave() {
  clearTimeout(projectSaveTimer);
  projectSaveTimer = setTimeout(writeProject, 1500);
}
function flushProjectSave() {
  clearTimeout(projectSaveTimer);
  writeProject();
}
function wsInfo() {
  return {
    root: config.root,
    name: projectName(config.root),
    color: colorFor(config.root),
    savedAt: projectSavedAt,
    workspaces: (config.workspaces || []).filter((w) => fs.existsSync(w.root)).map((w) => ({ root: w.root, name: projectName(w.root), color: colorFor(w.root), lastUsed: w.lastUsed })),
  };
}
function rememberWorkspace(root) {
  config.workspaces = [{ root, name: projectName(root), lastUsed: Date.now() }, ...(config.workspaces || []).filter((w) => w.root !== root)].slice(0, 12);
  saveConfig();
}
function prepareRoot() {
  fs.mkdirSync(config.root, { recursive: true });
  for (const a of APPS) if (!a.collection) fs.mkdirSync(path.join(config.root, a.folder), { recursive: true });
}
// Puts the saved tabs back, asleep, and wakes the one that was in front.
function restoreProject(root) {
  config.session = [];
  const p = readProject(root);
  if (!p) return;
  config.session = (p.session || []).map(absFromRoot).filter((f) => fs.existsSync(f));
  config.sessionTabs = p.sessionTabs !== false;
  let front = null;
  (p.tabs || []).forEach((t, i) => {
    if (!appById(t?.app)) return;
    const file = t.file ? absFromRoot(t.file) : null;
    if (file && !fs.existsSync(file)) return;
    const tab = createTab(t.app, { file, sleeping: true });
    if (i === p.active) front = tab.id;
  });
  if (front) activate(front);
}
function switchWorkspace(root, { force = false } = {}) {
  root = path.resolve(root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("That folder doesn't exist.");
  if (root === config.root && !force && !welcomeMode) return;
  flushProjectSave();
  projectSaveSuspended = true;
  try {
    for (const id of [...tabOrder]) closeTab(id, { quiet: true });
    current = "home";
    config.root = root;
    config.ext = [];
    prepareRoot();
    workspaceChanged();
    if (welcomeMode) setWelcome(false);
    openRootContents(root);
    if (!vaultLocked && !tabs.has(current)) activate("home");
  } finally {
    projectSaveSuspended = false;
  }
  rememberWorkspace(root);
  pushTabs();
  projectSavedAt = null;
  sendUi("ui:workspace", wsInfo());
  notifySession();
}
function openProjectFile(file) {
  switchWorkspace(path.dirname(file));
}

// ---------- vault: the lock on a project ----------
// A protected project is behind a lock screen whenever it is opened. While it is open its files are
// ordinary files; locking (by hand, when idle, when the PC locks, or on leaving) encrypts them all
// ("<name>.atlk"), and unlocking brings them back. See electron/vault.cjs.
let vaultKey = null; // the master key, only while the project is open
let vaultLocked = false; // the lock screen is up
let vaultBusy = false;
const vaultFails = new Map(); // project folder -> { n, until }
const aiRuns = new Map();
const vaultSettings = () => ({ ...vault.DEFAULTS, ...(vault.read(config.root)?.settings || {}) });
let vaultPhase = "locked"; // locked | locking | unlocking
const vaultStatus = () => ({ ...vault.publicInfo(vault.read(config.root)), phase: vaultPhase, locked: vaultLocked, open: !!vaultKey, root: config.root, name: projectName(config.root), color: colorFor(config.root) });
const sendVault = (extra = {}) => sendUi("ui:vault", { ...vaultStatus(), ...extra });
function showLockScreen() {
  if (!mainWindow) return;
  hideOverlay();
  if (!lockView) {
    lockView = makeUiView("lock.html");
    mainWindow.contentView.addChildView(lockView);
  }
  lockView.setVisible(true);
  raiseUi();
  layout();
  lockView.webContents.focus();
}
function hideLockScreen() {
  lockView?.setVisible(false);
  focusContent();
}
function engageGate() {
  vaultKey?.fill(0);
  vaultKey = null;
  vaultLocked = true;
  config.session = [];
  showLockScreen();
  sendVault({ phase: "locked" });
}
// Shows what a folder holds: its saved tabs, or the lock screen when it is protected.
function openRootContents(root) {
  if (vault.exists(root)) return engageGate();
  if (vaultLocked) {
    vaultLocked = false;
    hideLockScreen();
    sendVault();
  }
  restoreProject(root);
}
async function lockNow() {
  if (!vaultKey || vaultBusy) return;
  vaultBusy = true;
  const root = config.root;
  try {
    flushProjectSave();
    for (const r of aiRuns.values()) r.abort();
    aiRuns.clear();
    for (const s of [...standalones.values()]) if (!s.win.isDestroyed() && inside(s.file)) s.win.destroy();
    if (mainWindow) {
      for (const id of [...tabOrder]) closeTab(id, { quiet: true });
      current = "home";
      tabsView?.setVisible(false);
      pushTabs();
      // The assistant's conversation may quote the documents: it starts empty after a lock.
      if (aiView && !aiView.webContents.isDestroyed()) aiView.webContents.reload();
    }
    vaultLocked = true;
    vaultPhase = "locking";
    showLockScreen();
    const progress = (done, total) => sendVault({ phase: "locking", done, total });
    sendVault({ phase: "locking", done: 0, total: 0 });
    const res = await vault.encryptTree(root, vaultKey, progress);
    vaultKey.fill(0);
    vaultKey = null;
    workspaceChanged();
    vaultPhase = "locked";
    sendVault({ failed: res.failed.length });
  } finally {
    vaultBusy = false;
    vaultPhase = "locked";
  }
}
const leaveProject = () => lockNow();
// Slows a guesser down: from the third wrong try the wait doubles, up to five minutes.
const throttled = (root) => {
  const f = vaultFails.get(root);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
};
function failed(root, e) {
  if (e.code !== "wrong") return { ok: false, message: e.message };
  const n = (vaultFails.get(root)?.n || 0) + 1;
  const wait = n >= 3 ? Math.min(300, 5 * 2 ** (n - 3)) : 0;
  vaultFails.set(root, { n, until: Date.now() + wait * 1000 });
  return { ok: false, message: e.message, wait };
}
async function verifySecret(secret) {
  const wait = throttled(config.root);
  if (wait) return { ok: false, message: "Too many tries.", wait };
  try {
    await vault.unlock(config.root, secret);
    vaultFails.delete(config.root);
    return { ok: true };
  } catch (e) {
    return failed(config.root, e);
  }
}
async function unlockNow(secret, { recovery = false } = {}) {
  if (!vaultLocked || vaultBusy || !vault.exists(config.root)) return { ok: false, message: "Nothing to unlock." };
  const root = config.root;
  const wait = throttled(root);
  if (wait) return { ok: false, message: "Too many tries.", wait };
  let key;
  try {
    key = recovery ? await vault.recover(root, secret) : await vault.unlock(root, secret);
  } catch (e) {
    return failed(root, e);
  }
  vaultFails.delete(root);
  vaultBusy = true;
  try {
    vaultKey = key;
    vaultPhase = "unlocking";
    sendVault({ done: 0, total: 0 });
    const res = await vault.decryptTree(root, key, (done, total) => sendVault({ phase: "unlocking", done, total }));
    vaultLocked = false;
    vaultPhase = "locked";
    projectSaveSuspended = true;
    try {
      restoreProject(root);
      if (!tabs.has(current)) activate("home");
    } finally {
      projectSaveSuspended = false;
    }
    hideLockScreen();
    workspaceChanged();
    pushTabs();
    sendUi("ui:workspace", wsInfo());
    sendVault();
    notifySession();
    if (res.failed.length) {
      const names = res.failed.slice(0, 5).map((f) => path.basename(f.file)).join(", ");
      dialog.showMessageBox(mainWindow, { type: "warning", message: `${res.failed.length} file(s) could not be unlocked`, detail: `${names}${res.failed.length > 5 ? ", …" : ""}\n\nThey are still locked (.atlk) in the project folder.` });
    }
    return { ok: true, recovered: recovery };
  } finally {
    vaultBusy = false;
    vaultPhase = "locked";
  }
}

// Starting Atelier shows the welcome screen; only a double-clicked workspace file goes straight in.
function startWorkspace(atle) {
  if (!atle) return setWelcome(true);
  projectSaveSuspended = true;
  try {
    config.root = path.dirname(atle);
    prepareRoot();
    welcomeMode = false;
    openRootContents(config.root);
  } finally {
    projectSaveSuspended = false;
  }
  rememberWorkspace(config.root);
  setWelcome(false);
}
// Back to the welcome screen: the tabs are saved, a protected workspace is locked.
async function closeProject() {
  await leaveProject();
  flushProjectSave();
  projectSaveSuspended = true;
  try {
    for (const id of [...tabOrder]) closeTab(id, { quiet: true });
    current = "home";
    config.session = [];
  } finally {
    projectSaveSuspended = false;
  }
  if (vaultLocked) {
    vaultLocked = false;
    hideLockScreen();
    sendVault();
  }
  hideOverlay();
  if (aiOpen) setAiOpen(false);
  pushTabs();
  setWelcome(true);
  sendUi("ui:workspace", wsInfo());
}

function createWindow() {
  // Fit the screen: never larger than the usable area, centred, and restored as it was left.
  const work = screen.getPrimaryDisplay().workArea;
  const saved = config.window || {};
  const width = Math.min(saved.width || 1440, work.width);
  const height = Math.min(saved.height || 900, work.height);
  const fits = Number.isFinite(saved.x) && Number.isFinite(saved.y) && screen.getAllDisplays().some((d) => saved.x >= d.workArea.x && saved.y >= d.workArea.y && saved.x + 200 <= d.workArea.x + d.workArea.width && saved.y + 100 <= d.workArea.y + d.workArea.height);
  const win = new BrowserWindow({
    width,
    height,
    ...(fits ? { x: saved.x, y: saved.y } : {}),
    minWidth: Math.min(960, work.width),
    minHeight: Math.min(600, work.height),
    show: false,
    backgroundColor: currentPalette().page,
    title: "Atelier Lite",
    // No separate title bar: minimise, maximise and close sit at the right end of the tab strip.
    titleBarStyle: "hidden",
    titleBarOverlay: { color: currentPalette().titleBar, symbolColor: currentPalette().titleSymbol, height: TAB_H },
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload-shell.cjs"),
    },
  });
  mainWindow = win;
  win.once("ready-to-show", () => {
    if (saved.maximized) win.maximize();
    win.show();
  });
  win.on("resize", layout);
  win.on("close", (e) => {
    // Open tabs: ask whether to keep them for next time, so a stray click on × never loses the session.
    if (!win.__confirmed && !welcomeMode && !vaultLocked && tabOrder.length && prefs().askSave !== false) {
      e.preventDefault();
      if (win.__asking) return;
      win.__asking = true;
      const n = tabOrder.length;
      dialog
        .showMessageBox(win, {
          type: "question",
          title: "Atelier Lite",
          message: "Save this session before closing?",
          detail: `Your ${n} open tab${n === 1 ? "" : "s"} will be here again the next time you open this workspace.`,
          buttons: ["Save session", "Don't save", "Cancel"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        })
        .then((r) => {
          win.__asking = false;
          if (r.response === 2) return;
          saveEmptyTabs = r.response === 1;
          win.__confirmed = true;
          flushProjectSave();
          if (!win.isDestroyed()) win.close();
        });
      return;
    }
    // A protected project locks as the window closes (unless that is switched off): wait for it, with the lock screen showing.
    if (vaultKey && vaultSettings().onQuit && !win.__locking) {
      e.preventDefault();
      win.__locking = true;
      lockNow().catch(() => {}).finally(() => (win.isDestroyed() || win.close()));
      return;
    }
    const b = win.isMaximized() || win.isMinimized() ? win.getNormalBounds() : win.getBounds();
    config.window = { ...b, maximized: win.isMaximized() };
    saveConfig();
  });
  win.on("closed", () => {
    // Its tabs and panels go with it, so a workspace opened later starts clean.
    flushProjectSave();
    mainWindow = null;
    tabs.clear();
    tabOrder.length = 0;
    lastTabOfApp.clear();
    currentDoc.clear();
    tabsView = aiView = overlayView = null;
    overlayOpen = false;
    current = "home";
    for (const s of standalones.values()) if (!s.win.isDestroyed()) s.win.webContents.send("ui:solo", soloInfo(s));
  });
  hardenContents(win.webContents);
  win.loadURL("app://shell/index.html");

  // The tab strip, the AI panel and the overlay are separate pages, each a process. They are
  // created the first time they are needed, so a fresh start runs only Home.
  aiOpen = !!config.aiOpen;
  if (aiOpen) ensureAiView();
  win.webContents.once("did-finish-load", () => win.webContents.send("ui:ai-open", aiOpen));
}

// ---------- IPC ----------
// Home asks for the file list every few seconds; the walk is cached and only redone when
// something was written, or after a while (other programs can change the folder too).
let wsCache = { t: 0, list: null, root: null };
const workspaceChanged = () => (wsCache.t = 0);
function listWorkspace() {
  if (wsCache.list && wsCache.root === config.root && Date.now() - wsCache.t < 15000) return wsCache.list;
  const list = scanWorkspace();
  wsCache = { t: Date.now(), list, root: config.root };
  return list;
}
function scanWorkspace() {
  const out = [];
  const skip = new Set(["notes", "whiteboard"]);
  const walk = (dir, depth) => {
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      if (d.name.startsWith(".") || d.name.endsWith(".atelier-tmp")) continue;
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (depth === 0 && skip.has(d.name)) continue;
        if (depth < 4) walk(abs, depth + 1);
      } else {
        const ext = path.extname(d.name).slice(1).toLowerCase();
        const apps = appsFor(ext);
        if (!apps.length) continue;
        try {
          const st = fs.statSync(abs);
          out.push({ abs, name: d.name, ext, apps, size: st.size, modified: Math.round(st.mtimeMs), folder: path.relative(config.root, dir) || "." });
        } catch {
          /* vanished */
        }
      }
    }
  };
  walk(config.root, 0);
  const seen = new Set(out.map((f) => f.abs));
  // Recent files from elsewhere on the PC count, but not ones that belong to another project.
  const otherRoots = (config.workspaces || []).map((w) => w.root).filter((r) => r !== config.root);
  for (const r of config.recent) {
    if (seen.has(r.abs) || !fs.existsSync(r.abs)) continue;
    if (otherRoots.some((root) => r.abs.startsWith(root + path.sep))) continue;
    const ext = path.extname(r.abs).slice(1).toLowerCase();
    const apps = appsFor(ext);
    if (!apps.length) continue;
    const st = fs.statSync(r.abs);
    out.push({ abs: r.abs, name: path.basename(r.abs), ext, apps, size: st.size, modified: Math.round(st.mtimeMs), folder: path.dirname(r.abs), external: true });
  }
  return out.sort((a, b) => b.modified - a.modified).slice(0, 500);
}
function collectionCount(a) {
  try {
    const dir = path.join(config.root, a.folder);
    const names = fs.readdirSync(dir);
    if (a.id === "whiteboard") return names.filter((n) => n.endsWith(".json") && n !== "catalog.json").length;
    return names.filter((n) => !n.startsWith(".")).length;
  } catch {
    return 0;
  }
}

function registerIpc() {
  const tabOf = (e) => {
    for (const t of tabs.values()) if (t.view && t.view.webContents.id === e.sender.id) return t;
    return null;
  };
  ipcMain.handle("atelier:call", async (e, op, args) => {
    try {
      // An app's own light / dark switch (its account menu) changes the whole of Atelier, not just that app.
      if (op === "setTheme") {
        const m = args && args.mode;
        if (["light", "dark", "system"].includes(m) && m !== (config.theme || "system")) {
          nativeTheme.themeSource = m;
          config.theme = m;
          saveConfig();
          broadcastTheme();
        }
        return true;
      }
      const tab = tabOf(e);
      const solo = soloOf(e);
      if (["write", "delete", "rename", "move", "copy", "mkdir", "dialogSave"].includes(op)) workspaceChanged();
      if (dialogOps[op]) return await dialogOps[op](args || {}, { appId: tab?.app || solo?.app, tabId: tab?.id, win: solo?.win && !solo.win.isDestroyed() ? solo.win : mainWindow });
      if (ops[op]) {
        const result = ops[op](args || {});
        if ((op === "write" || op === "read") && args?.path) {
          try {
            touchDoc(tab?.id, op === "write" ? toAbs(result?.path || args.path) : toAbs(args.path), op === "write" ? "write" : "read");
          } catch {
            /* not trackable */
          }
        }
        return result;
      }
      return { __err: true, code: "unsupported", message: "Unsupported operation: " + op };
    } catch (err) {
      return { __err: true, code: err.code || "error", message: err.message || String(err) };
    }
  });

  // Shell UI
  ipcMain.handle("shell:info", () => ({
    apps: APPS.map((a) => ({ id: a.id, name: a.name, color: a.color, blurb: a.blurb, collection: !!a.collection, folder: a.folder, count: a.collection ? collectionCount(a) : undefined })),
    root: config.root,
    current: tabs.get(current)?.app || "home",
    aiOpen,
    theme: nativeTheme.themeSource,
  }));
  ipcMain.handle("shell:files", () => (vaultLocked ? [] : listWorkspace()));
  // What the person is looking at in the active app: selected text, the open file and its text.
  // Polled every couple of seconds while the AI panel is open, so it must stay cheap:
  // the selection only. The page text is read just once, when a question is sent.
  const SELECTION_PROBE = `(() => {
    const a = document.activeElement;
    let sel = '';
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && typeof a.selectionStart === 'number' && a.selectionEnd > a.selectionStart) sel = a.value.slice(a.selectionStart, a.selectionEnd);
    else sel = String(window.getSelection ? window.getSelection() : '');
    return { selection: sel.slice(0, 20000), text: null };
  })()`;
  const CONTENT_PROBE = `(() => {
    const a = document.activeElement;
    let sel = '';
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && typeof a.selectionStart === 'number' && a.selectionEnd > a.selectionStart) sel = a.value.slice(a.selectionStart, a.selectionEnd);
    else sel = String(window.getSelection ? window.getSelection() : '');
    let text = null;
    if (typeof window.__atelierDoc === 'function') text = window.__atelierDoc();
    else {
      const ce = document.querySelector('[contenteditable="true"],[contenteditable=""]');
      if (ce && ce.textContent.length < 400000) text = ce.innerText;
    }
    return { selection: sel.slice(0, 20000), text: text ? text.slice(0, 80000) : null };
  })()`;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_r, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  // The other documents the AI should read: open tabs (when included) and files added by hand,
  // each with its text. The open document keeps half of the room, the rest share the other half.
  async function gatherSession(excludeTabId, excludeAbs, limit, hasActive, skip = []) {
    const files = new Map();
    const skipped = new Set(skip);
    if (config.sessionTabs !== false) {
      for (const id of tabOrder) {
        const d = currentDoc.get(id);
        if (id !== excludeTabId && d && !skipped.has(d.abs) && fs.existsSync(d.abs)) files.set(d.abs, { tab: tabs.get(id) });
      }
    }
    for (const abs of config.session || []) if (fs.existsSync(abs) && !files.has(abs)) files.set(abs, {});
    if (excludeAbs) files.delete(excludeAbs);
    const per = files.size ? Math.max(1500, Math.floor((limit * (hasActive ? 0.5 : 1)) / files.size)) : 0;
    const list = [];
    for (const [abs, info] of files) {
      const app = appsFor(path.extname(abs).slice(1))[0];
      const item = { name: path.basename(abs), app: app ? appById(app).name : "file", rel: inside(abs) ? path.relative(config.root, abs) : null, content: "", truncated: false };
      try {
        let text = null;
        // Markdown tabs are read as they are on screen, so unsaved edits count.
        if (info.tab && info.tab.app === "markdown" && info.tab.view && !info.tab.view.webContents.isLoading()) {
          text = await withTimeout(info.tab.view.webContents.executeJavaScript("typeof window.__atelierDoc === 'function' ? window.__atelierDoc() : null", true), 1500).catch(() => null);
        }
        if (text == null) text = (await extractFile(abs)).text;
        item.truncated = text.length > per;
        item.content = text.slice(0, per);
      } catch (err) {
        item.error = err.message;
      }
      list.push(item);
    }
    return list;
  }
  // The other open documents, named so the person can switch each one on or off for the AI.
  const otherDocs = (exceptTabId) =>
    tabOrder
      .filter((id) => id !== exceptTabId)
      .map((id) => {
        const t = tabs.get(id);
        const d = currentDoc.get(id);
        return d && fs.existsSync(d.abs) ? { abs: d.abs, app: appById(t.app).name, appId: t.app, name: path.basename(d.abs), rel: inside(d.abs) ? path.relative(config.root, d.abs) : null } : null;
      })
      .filter(Boolean);
  ipcMain.handle("shell:context", async (_e, opts = {}) => {
    const tab = tabs.get(current);
    if (!tab || !tab.view) {
      // On Home there is no open document, but the session still counts.
      if (!(opts.withContent && opts.session)) return { app: "home" };
      return { app: "home", session: await gatherSession(null, null, Number(opts.limit) > 0 ? Number(opts.limit) : 60000, false, opts.exclude), others: otherDocs(null) };
    }
    const a = appById(tab.app);
    let probe = { selection: "", text: null };
    try {
      const wc = tab.view.webContents;
      if (!wc.isLoading()) probe = await withTimeout(wc.executeJavaScript(opts.withContent ? CONTENT_PROBE : SELECTION_PROBE, true), 1500);
    } catch {
      /* page busy or not ready: skip this round */
    }
    const cur = currentDoc.get(tab.id);
    const out = { app: tab.app, appName: a.name, selection: probe.selection || "", file: null, content: "", truncated: false, source: "" };
    if (cur && fs.existsSync(cur.abs)) out.file = { abs: cur.abs, name: path.basename(cur.abs), rel: inside(cur.abs) ? path.relative(config.root, cur.abs) : null };
    // The other open documents: named, so the person can refer to them.
    // The session: other open tabs (when included) plus files added by hand, each with its text.
    // The open document gets half of the room, the rest share the other half.
    if (opts.withContent && opts.session) out.session = await gatherSession(tab.id, out.file?.abs, Number(opts.limit) > 0 ? Number(opts.limit) : 60000, !!(out.file || probe.text), opts.exclude);
    out.others = otherDocs(tab.id);
    if (opts.withContent) {
      // Live editors (Markdown, Notes) give the text as it is on screen; the others, the saved file.
      const full = Number(opts.limit) > 0 ? Number(opts.limit) : 60000;
      // Leave half of the room for the other documents in the session, when there are any.
      const limit = opts.session && (out.session?.length || 0) > 0 ? Math.floor(full * 0.5) : full;
      if (probe.text && (tab.app === "markdown" || tab.app === "notes" || !out.file)) {
        out.source = "screen";
        out.truncated = probe.text.length > limit;
        out.content = probe.text.slice(0, limit);
      } else if (out.file) {
        try {
          const r = await extractFile(out.file.abs);
          out.source = "file";
          out.truncated = r.truncated || r.text.length > limit;
          out.content = r.text.slice(0, limit);
        } catch (err) {
          out.error = "Could not read " + out.file.name + ": " + err.message;
        }
      }
    }
    return out;
  });
  ipcMain.on("shell:show", (_e, id) => !vaultLocked && !welcomeMode && (id === "home" || appById(id)) && show(id));
  ipcMain.on("tabs:activate", (_e, id) => activate(id));
  ipcMain.on("tabs:close", (_e, id) => closeTab(id));
  ipcMain.on("tabs:new", (_e, appId) => !vaultLocked && !welcomeMode && appById(appId) && activate(createTab(appId).id));
  ipcMain.handle("tabs:list", () => ({
    tabs: tabOrder.map((id) => {
      const t = tabs.get(id);
      return { id, app: t.app, appName: appById(t.app).name, color: appById(t.app).color, title: cleanTitle(t), asleep: !t.view };
    }),
    current,
  }));
  ipcMain.on("shell:open", (_e, abs, appId) => {
    if (!vaultLocked && !welcomeMode && appById(appId) && fs.existsSync(abs)) launchItem(appId, abs);
  });
  // A document in a window of its own (Home's "Open in a new window").
  ipcMain.on("shell:open-window", (_e, abs, appId) => !vaultLocked && appById(appId) && fs.existsSync(abs) && createStandalone(appId, abs));
  ipcMain.handle("solo:info", (e) => {
    const s = soloOf(e);
    return s ? soloInfo(s) : null;
  });
  ipcMain.on("solo:workspace", () => openWorkspace());
  ipcMain.on("ui:tabs-width", (_e, px) => {
    const n = Math.round(Number(px));
    if (Number.isFinite(n) && n > 80 && n !== tabsWidth) (tabsWidth = Math.min(n, 4000), layout());
  });
  // The assistant's changes to the open Markdown file or form, applied inside the app (one Undo takes them back).
  const editable = () => {
    const t = tabs.get(current);
    return null; // Lite has no Markdown or Forms app: the assistant changes documents through its own tools
  };
  ipcMain.handle("shell:edit-apply", async (_e, ops) => {
    const t = editable();
    if (!t) return { ok: false, message: "Open the Markdown file or form you want to change, then try again." };
    try {
      return await t.view.webContents.executeJavaScript(`(window.__atelierEdit ? window.__atelierEdit.apply(${JSON.stringify(Array.isArray(ops) ? ops : [])}) : { ok: false, message: "This app cannot be changed from here." })`, true);
    } catch (err) {
      return { ok: false, message: err.message || "The change failed." };
    }
  });
  ipcMain.handle("shell:edit-undo", async () => {
    const t = editable();
    if (!t) return false;
    try {
      return await t.view.webContents.executeJavaScript("window.__atelierEdit ? window.__atelierEdit.undo() : false", true);
    } catch {
      return false;
    }
  });
  // Opens the current app's own assistant pane (it edits the open document with tools).
  ipcMain.handle("shell:open-assistant", async () => {
    const tab = tabs.get(current);
    if (!tab?.view) return false;
    const script = `(() => {
      const re = /^\\s*(ai )?(assistant|copilot)\\b|ask ai|assistant/i;
      const open = document.querySelector('#ai-panel:not([hidden]), .ai-panel.open, aside.ai-panel');
      if (open && open.getBoundingClientRect().width > 40) return true;
      const nodes = [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')];
      const hit = nodes.find((n) => re.test(((n.getAttribute('aria-label') || '') + ' ' + (n.title || '')).trim())) || nodes.find((n) => re.test((n.textContent || '').trim().slice(0, 30)));
      if (!hit) return false;
      hit.click();
      return true;
    })()`;
    try {
      const ok = await tab.view.webContents.executeJavaScript(script, true);
      if (ok) tab.view.webContents.focus();
      return !!ok;
    } catch {
      return false;
    }
  });
  ipcMain.on("shell:reveal", (_e, abs) => fs.existsSync(abs) && shell.showItemInFolder(abs));
  ipcMain.on("shell:layout", (_e, { left }) => {
    sidebar = Math.max(0, Math.min(400, Number(left) || 0));
    layout();
  });
  ipcMain.on("ui:toggle-ai", () => setAiOpen(!aiOpen));
  ipcMain.on("ui:overlay", (_e, payload = {}) => {
    // The tab strip is offset by the sidebar; the overlay covers the whole window.
    if (payload.kind === "newtab" && payload.anchor) payload.anchor = { ...payload.anchor, left: payload.anchor.left + sidebar };
    showOverlay(payload);
  });
  ipcMain.on("ui:overlay-close", () => hideOverlay());
  ipcMain.handle("ui:get-accent", () => config.accent || "indigo");
  ipcMain.handle("ui:set-accent", (_e, id) => {
    if (typeof id !== "string" || !/^[a-z]{3,12}$/.test(id)) return config.accent || "indigo";
    config.accent = id;
    saveConfig();
    sendUi("ui:accent", id);
    broadcastTheme();
    return id;
  });
  ipcMain.handle("ui:get-theme", () => currentPalette());
  // Apps ask for the palette before their first paint.
  ipcMain.on("atelier:theme", (e) => (e.returnValue = currentPalette()));
  ipcMain.handle("shell:setTheme", (_e, mode) => {
    if (!["light", "dark", "system"].includes(mode)) return nativeTheme.themeSource;
    nativeTheme.themeSource = mode;
    config.theme = mode;
    saveConfig();
    broadcastTheme();
    return mode;
  });
  // The system switching between light and dark (when the mode is "System").
  nativeTheme.on("updated", () => broadcastTheme());

  // AI: apps reach it through puter.ai (the stand-in), the shell's assistant panel directly.
  ipcMain.handle("ai:chat", async (e, id, payload) => {
    if (vaultLocked) return;
    const ctl = new AbortController();
    aiRuns.set(id, ctl);
    const send = (ev) => !e.sender.isDestroyed() && e.sender.send("ai:ev:" + id, ev);
    try {
      for await (const part of ai.run(payload.messages || [], payload.options || {}, ctl.signal)) send(part);
      send({ type: "end" });
    } catch (err) {
      if (!ctl.signal.aborted) send({ type: "error", message: err.message || String(err), code: err.code || "error" });
      else send({ type: "end" });
    } finally {
      aiRuns.delete(id);
    }
    return true;
  });
  ipcMain.on("ai:cancel", (_e, id) => aiRuns.get(id)?.abort());
  ipcMain.handle("ai:detect-local", () => ai.detectLocal());

  // Help & About: version facts, and the guide / release notes / notices rendered from docs/.
  const DOCS = { guide: "USER_GUIDE.md", changelog: "CHANGELOG.md", notices: "NOTICES.md" };
  const docPath = (key) => path.join(__dirname, "..", "docs", DOCS[key]);
  ipcMain.handle("about:info", () => ({
    name: "Atelier Lite",
    version: app.getVersion(),
    slogan: "Documents, slides, sheets and PDFs, in one workspace.",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    workspace: config.root,
    settings: configFile(),
  }));
  ipcMain.handle("about:doc", async (_e, key) => {
    if (!DOCS[key]) return "";
    try {
      const { marked } = await import("marked");
      return marked.parse(fs.readFileSync(docPath(key), "utf8"));
    } catch {
      return "<p>This page could not be loaded.</p>";
    }
  });
  // A copy of the guide in the workspace, as a Word document.
  ipcMain.handle("about:open-guide", async () => {
    const r = await buildFile({ kind: "docx", name: "Atelier Lite User Guide", body: fs.readFileSync(docPath("guide"), "utf8") });
    const dest = uniquePath(path.join(appDir("documents"), r.fileName));
    fs.writeFileSync(dest, r.buffer);
    workspaceChanged();
    launchItem("documents", dest);
    return true;
  });

  // The AI session: files added by hand, on top of the open tabs.
  const sessionState = () => ({
    files: (config.session || []).filter((abs) => fs.existsSync(abs)).map((abs) => ({ abs, name: path.basename(abs), app: appsFor(path.extname(abs).slice(1))[0] || null, rel: inside(abs) ? path.relative(config.root, abs) : null })),
    includeTabs: config.sessionTabs !== false,
  });
  notifySession = () => sendUi("ui:session", sessionState());
  const sessionChanged = () => {
    saveConfig();
    scheduleProjectSave();
    notifySession();
  };
  ipcMain.handle("session:get", () => sessionState());
  ipcMain.handle("session:add", (_e, abs) => {
    if (typeof abs === "string" && fs.existsSync(abs) && fs.statSync(abs).isFile() && !(config.session || []).includes(abs)) {
      config.session = [...(config.session || []), abs].slice(-20);
      sessionChanged();
    }
    return sessionState();
  });
  ipcMain.handle("session:remove", (_e, abs) => {
    config.session = (config.session || []).filter((x) => x !== abs);
    sessionChanged();
    return sessionState();
  });
  ipcMain.handle("session:set-tabs", (_e, on) => {
    config.sessionTabs = !!on;
    sessionChanged();
    return sessionState();
  });
  // A file the AI wrote: built into a real document and saved in the workspace.
  ipcMain.handle("ai:create-file", async (_e, req) => {
    if (vaultLocked) return { ok: false, message: "This project is locked." };
    try {
      const r = await buildFile(req || {});
      const abs = uniquePath(path.join(appDir(r.app), r.fileName));
      fs.writeFileSync(abs, r.buffer);
      workspaceChanged();
      return { ok: true, abs, name: path.basename(abs), app: r.app, appName: appById(r.app).name };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  });
  // Model downloads (Ollama): progress goes back to the asking page as "ui:pull" events.
  const pulls = new Map();
  ipcMain.handle("ai:pull", async (e, name) => {
    const ctl = new AbortController();
    pulls.set(name, ctl);
    const send = (p) => !e.sender.isDestroyed() && e.sender.send("ui:pull", { name, ...p });
    try {
      await ai.pullModel(name, (p) => send(p), ctl.signal);
      send({ done: true });
    } catch (err) {
      send(ctl.signal.aborted ? { done: true, cancelled: true } : { error: err.message || String(err) });
    } finally {
      pulls.delete(name);
    }
    return true;
  });
  ipcMain.on("ai:pull-cancel", (_e, name) => pulls.get(name)?.abort());
  ipcMain.handle("ai:status", () => ai.status());
  ipcMain.handle("ai:settings", () => ai.settings());
  ipcMain.handle("ai:update", (_e, patch) => {
    const result = ai.update(patch || {});
    aiView?.webContents.send("ui:ai-changed");
    return result;
  });
  ipcMain.handle("ai:test", async () => {
    try {
      return { ok: true, reply: await ai.test() };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  });
  ipcMain.handle("shell:delete", async (_e, abs) => {
    workspaceChanged();
    const r = await dialog.showMessageBox(mainWindow, { type: "warning", buttons: ["Move to Recycle Bin", "Cancel"], defaultId: 1, cancelId: 1, message: `Delete "${path.basename(abs)}"?` });
    if (r.response !== 0) return false;
    await shell.trashItem(abs);
    // A tab or window that had the file open has nothing left to show.
    for (const t of [...tabs.values()]) if (t.file === abs) closeTab(t.id);
    for (const sw of [...standalones.values()]) if (sw.file === abs && !sw.win.isDestroyed()) sw.win.destroy();
    config.recent = config.recent.filter((x) => x.abs !== abs);
    saveConfig();
    return true;
  });
  ipcMain.handle("shell:newFile", (_e, appId) => {
    if (vaultLocked || welcomeMode) return false;
    workspaceChanged();
    // A starting point for apps that open files: a named empty file in the app's folder.
    show(appId);
    return true;
  });
  // Projects: switch, create, open, rename and save workspaces.
  const wsReply = (fn) => {
    try {
      fn();
      return { ok: true, ...wsInfo() };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  };
  ipcMain.on("atelier:root", (e) => (e.returnValue = config.root));
  ipcMain.handle("ws:info", () => wsInfo());
  ipcMain.handle("ws:switch", async (_e, root) => {
    await leaveProject();
    return wsReply(() => switchWorkspace(String(root)));
  });
  ipcMain.handle("ws:choose-folder", async () => {
    const pf = prefs().defaultFolder;
    const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"], defaultPath: pf && fs.existsSync(pf) ? pf : path.dirname(config.root) });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("ws:new", async (_e, { name, parent }) => {
    await leaveProject();
    return wsReply(() => {
      const nm = safeFileName(name);
      if (!nm) throw new Error("Give the project a name.");
      if (!parent || !fs.existsSync(parent)) throw new Error("Choose where to create the project.");
      const dir = path.join(parent, nm);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`A folder named "${nm}" already exists there.`);
      fs.mkdirSync(dir, { recursive: true });
      switchWorkspace(dir);
      flushProjectSave();
    });
  });
  ipcMain.handle("ws:open", async (_e, kind) => {
    const r = await dialog.showOpenDialog(mainWindow, kind === "file" ? { properties: ["openFile"], filters: [{ name: "Atelier project", extensions: ["atle"] }], defaultPath: path.dirname(config.root) } : { properties: ["openDirectory"], defaultPath: path.dirname(config.root) });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    await leaveProject();
    return wsReply(() => (kind === "file" ? openProjectFile(r.filePaths[0]) : switchWorkspace(r.filePaths[0])));
  });
  ipcMain.handle("ws:rename", (_e, name) =>
    wsReply(() => {
      const nm = safeFileName(name);
      if (!nm) throw new Error("Give the project a name.");
      const file = findProjectFile(config.root);
      if (file) {
        const to = path.join(config.root, nm + ".atle");
        if (to.toLowerCase() !== file.toLowerCase()) {
          if (fs.existsSync(to)) throw new Error(`There is already a project file named "${nm}".`);
          fs.renameSync(file, to);
        }
      }
      rememberWorkspace(config.root);
      config.workspaces = (config.workspaces || []).map((w) => (w.root === config.root ? { ...w, name: nm } : w));
      flushProjectSave();
    }),
  );
  ipcMain.handle("ws:save", () => wsReply(() => flushProjectSave()));
  ipcMain.handle("ws:welcome", () => welcomeMode);
  ipcMain.handle("prefs:get", () => prefs());
  ipcMain.handle("prefs:set", (_e, patch) => {
    const next = { ...prefs() };
    const oneOf = (k, list) => list.includes(patch[k]) && (next[k] = patch[k]);
    if (patch && typeof patch === "object") {
      oneOf("startup", ["welcome", "last"]);
      oneOf("textSize", ["normal", "large", "largest"]);
      oneOf("sleepMinutes", [0, 5, 10, 30]);
      oneOf("awakeTabs", [0, 2, 3, 5]);
      for (const k of ["askSave", "reduceMotion", "lowPower"]) if (typeof patch[k] === "boolean") next[k] = patch[k];
      if (typeof patch.defaultFolder === "string") next.defaultFolder = patch.defaultFolder.slice(0, 500);
    }
    config.prefs = next;
    saveConfig();
    broadcastTheme();
    reapplyZoom();
    runSleeper();
    return next;
  });
  ipcMain.handle("perf:info", () => {
    let kb = 0;
    try {
      for (const m of app.getAppMetrics()) kb += m.memory?.workingSetSize || 0;
    } catch {
      /* metrics unavailable */
    }
    const all = [...tabs.values()];
    return { memoryMB: Math.round(kb / 1024), awake: all.filter((x) => x.view).length, asleep: all.filter((x) => !x.view).length };
  });
  // Ctrl+Shift+K: put a link to a workspace file into the document being edited (or onto the clipboard).
  ipcMain.handle("links:insert", (_e, abs) => {
    try {
      if (typeof abs !== "string" || !inside(abs) || !fs.existsSync(abs)) return { ok: false, message: "Only files in this workspace can be linked." };
      const rel = path.relative(config.root, abs).split(path.sep).map(encodeURIComponent).join("/");
      const url = "atelier://open/" + rel;
      const label = path.basename(abs, path.extname(abs));
      const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      const tab = tabs.get(current);
      if (tab?.view && !tab.view.webContents.isDestroyed()) {
        const wc = tab.view.webContents;
        wc.focus();
        if (tab.app === "markdown") wc.insertText(`[${label}](${url})`);
        else {
          clipboard.write({ text: url, html: `<a href="${url}">${esc(label)}</a>` });
          wc.paste();
        }
        return { ok: true, copied: false };
      }
      clipboard.writeText(url);
      return { ok: true, copied: true };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  });
  ipcMain.handle("ui:strip-get", () => stripState());
  // Before a folder becomes a workspace: how full is it? (a big folder like Downloads deserves a warning)
  ipcMain.handle("ws:inspect", (_e, dir) => {
    try {
      const names = fs.readdirSync(String(dir)).filter((n) => !n.startsWith("."));
      return { items: names.length, hasProject: names.some((n) => n.toLowerCase().endsWith(".atle")) };
    } catch {
      return { items: 0, hasProject: false };
    }
  });
  ipcMain.handle("ws:close", async () => (await closeProject(), { ok: true }));
  // Home: a file gets a new name in place. The extension stays, and a file that is open in a tab waits.
  ipcMain.handle("shell:rename", (_e, abs, name) => {
    try {
      if (vaultLocked || welcomeMode) throw new Error("Open a workspace first.");
      if (typeof abs !== "string" || !fs.existsSync(abs) || !inside(abs)) throw new Error("That file is not in this workspace.");
      const nm = safeFileName(name);
      if (!nm) throw new Error("Give the file a name.");
      if ([...tabs.values()].some((t) => t.file === abs) || [...standalones.values()].some((s) => s.file === abs && !s.win.isDestroyed())) throw new Error("Close its tab first, then rename it.");
      const ext = path.extname(abs);
      const to = path.join(path.dirname(abs), nm.toLowerCase().endsWith(ext.toLowerCase()) ? nm : nm + ext);
      if (to.toLowerCase() !== abs.toLowerCase() && fs.existsSync(to)) throw new Error(`There is already a file named "${path.basename(to)}".`);
      fs.renameSync(abs, to);
      config.recent = config.recent.map((r) => (r.abs === abs ? { ...r, abs: to } : r));
      config.session = (config.session || []).map((x) => (x === abs ? to : x));
      saveConfig();
      workspaceChanged();
      notifySession();
      return { ok: true, abs: to, name: path.basename(to) };
    } catch (err) {
      return { ok: false, message: err.message || String(err) };
    }
  });
  // "Report a problem": the person describes it, their mail program opens with it and the version facts filled in.
  ipcMain.handle("report:send", async (_e, { category, text } = {}) => {
    const body = `${String(text || "").slice(0, 1500)}\n\n---\nAtelier Lite ${app.getVersion()} · ${process.platform} ${process.arch} · Electron ${process.versions.electron}`;
    const subject = `Atelier Lite ${app.getVersion()}: ${String(category || "Feedback").slice(0, 40)}`;
    await shell.openExternal(`mailto:mathannits92@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    return { ok: true };
  });
  ipcMain.handle("ws:remove", (_e, root) =>
    wsReply(() => {
      config.workspaces = (config.workspaces || []).filter((w) => w.root !== root);
      saveConfig();
    }),
  );
  ipcMain.on("ws:reveal", () => shell.openPath(config.root));

  // Vault: the lock on a project (electron/vault.cjs). Anything that changes it asks for the secret again.
  ipcMain.handle("vault:status", () => vaultStatus());
  ipcMain.handle("vault:unlock", (_e, secret, recovery) => unlockNow(String(secret ?? ""), { recovery: !!recovery }));
  ipcMain.handle("vault:lock", async () => {
    await lockNow();
    return vaultStatus();
  });
  ipcMain.handle("vault:enable", async (_e, opts) => {
    if (vaultLocked || vault.exists(config.root)) return { ok: false, message: "This project is already protected." };
    try {
      const { master, recoveryKey } = await vault.setup(config.root, opts || {});
      vaultKey = master;
      sendVault();
      return { ok: true, recoveryKey };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });
  // `current` is the secret now in force.
  const withSecret = (fn) => async (_e, req = {}) => {
    if (!vaultKey) return { ok: false, message: "Unlock the project first." };
    const v = await verifySecret(String(req.current ?? ""));
    if (!v.ok) return v;
    try {
      return { ok: true, ...(await fn(req)) };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  };
  ipcMain.handle("vault:change", withSecret(async (req) => (await vault.change(config.root, vaultKey, req), sendVault(), {})));
  ipcMain.handle("vault:recovery", withSecret(async () => ({ recoveryKey: await vault.newRecovery(config.root, vaultKey) })));
  ipcMain.handle("vault:disable", withSecret(async () => {
    // The project is open, so its files are plain; any left locked (in use at the time) are opened first.
    const res = await vault.decryptTree(config.root, vaultKey);
    if (res.failed.length) throw new Error(`${res.failed.length} file(s) are still locked and could not be opened, so the lock stays on.`);
    vault.remove(config.root);
    vaultKey.fill(0);
    vaultKey = null;
    workspaceChanged();
    sendVault();
    return {};
  }));
  ipcMain.handle("vault:settings", (_e, patch) => {
    vault.setSettings(config.root, patch || {});
    sendVault();
    return vaultStatus();
  });


}

const ai = createAi({
  safeStorage,
  getStore: () => config,
  setStore: (patch) => {
    Object.assign(config, patch);
    saveConfig();
  },
  scratchDir: () => path.join(app.getPath("userData"), "ai-scratch"),
  workspaceRoot: () => config.root,
});

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on("second-instance", (_e, argv) => {
    const f = argv.slice(1).find((a) => !a.startsWith("-") && fs.existsSync(a) && fs.statSync(a).isFile());
    if (f && /\.atle$/i.test(f)) return (openWorkspace(), leaveProject().then(() => openProjectFile(f)));
    if (f) return openExternalFile(f);
    openWorkspace();
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    loadConfig();
    if (["light", "dark", "system"].includes(config.theme)) nativeTheme.themeSource = config.theme;
    registerAppProtocol();
    registerIpc();
    const f = process.argv.slice(1).find((a) => !a.startsWith("-") && fs.existsSync(a) && fs.statSync(a).isFile());
    if (f && !/\.atle$/i.test(f) && appsFor(path.extname(f).slice(1))[0]) {
      // Started for one document: show just that, in a window of its own. The workspace opens
      // only if asked for (the button in that window, or starting Atelier again).
      openExternalFile(f);
    } else {
      createWindow();
      // A double-clicked project file chooses the workspace; otherwise the last project reopens.
      startWorkspace(f && /\.atle$/i.test(f) ? f : prefs().startup === "last" && fs.existsSync(config.root) ? path.join(config.root, ".atle") : null);
    }
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) openWorkspace();
    });
    // Locks a protected project when it has been left alone, or when Windows is locked or goes to sleep.
    setInterval(() => {
      const m = vaultKey && !vaultBusy ? vaultSettings().idleMinutes : 0;
      if (m > 0 && powerMonitor.getSystemIdleTime() >= m * 60) lockNow();
    }, 15000).unref();
    setInterval(runSleeper, 30000).unref();
    const onAway = () => vaultKey && vaultSettings().onScreenLock && lockNow();
    powerMonitor.on("lock-screen", onAway);
    powerMonitor.on("suspend", onAway);
  });
  let quitLocked = false;
  app.on("before-quit", (e) => {
    if (vaultKey && !quitLocked && vaultSettings().onQuit) {
      e.preventDefault();
      quitLocked = true;
      lockNow().catch(() => {}).finally(() => app.quit());
      return;
    }
    flushProjectSave();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
