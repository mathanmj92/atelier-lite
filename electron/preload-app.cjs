const { contextBridge, ipcRenderer } = require("electron");

const arg = process.argv.find((a) => a.startsWith("--atelier-app="));
const appId = arg ? arg.slice(14) : "";

// Items sent before the page has registered a handler wait here.
const queues = { item: [], file: [] };
const handlers = { item: null, file: null };
function deliver(kind) {
  while (handlers[kind] && queues[kind].length) handlers[kind](queues[kind].shift());
}
ipcRenderer.on("atelier:open-item", (_e, item) => (queues.item.push(item), deliver("item")));
ipcRenderer.on("atelier:open-file", (_e, file) => (queues.file.push(file), deliver("file")));
// The palette every app is painted with (see theme.cjs). It is read once, before the first paint,
// and again whenever the person changes the theme.
let palette = ipcRenderer.sendSync("atelier:theme");
const themeListeners = [];
ipcRenderer.on("atelier:theme", (_e, p) => {
  palette = p;
  themeListeners.forEach((cb) => cb(p));
});

contextBridge.exposeInMainWorld("atelier", {
  app: appId,
  // The project folder this page belongs to, so an app can keep its own state per project.
  root: ipcRenderer.sendSync("atelier:root"),
  call: (op, args) => ipcRenderer.invoke("atelier:call", op, args),
  onOpenItem: (cb) => ((handlers.item = cb), deliver("item")),
  theme: () => palette,
  onTheme: (cb) => themeListeners.push(cb),
  // Streams an AI reply: onEvent gets { type: "text" | "tool" | "error" | "end", ... }.
  aiChat: (payload, onEvent) => {
    const id = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const channel = "ai:ev:" + id;
    const listener = (_e, ev) => {
      onEvent(ev);
      if (ev.type === "end" || ev.type === "error") ipcRenderer.removeListener(channel, listener);
    };
    ipcRenderer.on(channel, listener);
    ipcRenderer.invoke("ai:chat", id, payload);
    return { cancel: () => ipcRenderer.send("ai:cancel", id) };
  },
});

// The Markdown app talks to the desktop through this small API.
if (appId === "markdown") {
  contextBridge.exposeInMainWorld("desktop", {
    openFile: () => ipcRenderer.invoke("file:open"),
    saveFile: (path, content, saveAs) => ipcRenderer.invoke("file:save", { path, content, saveAs }),
    readFile: (path) => ipcRenderer.invoke("file:read", path),
    exportPdf: (html, name) => ipcRenderer.invoke("export:pdf", { html, name }),
    exportHtml: (html, name) => ipcRenderer.invoke("export:html", { html, name }),
    launchFile: () => ipcRenderer.invoke("launch:file"),
    onOpenFile: (cb) => ((handlers.file = cb), deliver("file")),
  });
}
