const { contextBridge, ipcRenderer } = require("electron");

// Shared by Atelier's own pages: Home, the AI panel and the overlay.
const EVENTS = new Set(["ui:strip", "ui:solo", "ui:theme", "shell:active", "shell:cmd", "ui:ai-open", "ui:accent", "ui:overlay", "ui:ai-changed", "ui:tabs", "ui:pull", "ui:session", "ui:workspace", "ui:vault", "ui:welcome"]);

contextBridge.exposeInMainWorld("shellApi", {
  info: () => ipcRenderer.invoke("shell:info"),
  files: () => ipcRenderer.invoke("shell:files"),
  show: (id) => ipcRenderer.send("shell:show", id),
  open: (abs, appId) => ipcRenderer.send("shell:open", abs, appId),
  reveal: (abs) => ipcRenderer.send("shell:reveal", abs),
  remove: (abs) => ipcRenderer.invoke("shell:delete", abs),
  newFile: (appId) => ipcRenderer.invoke("shell:newFile", appId),
  setLayout: (left) => ipcRenderer.send("shell:layout", { left }),
  chooseRoot: () => ipcRenderer.invoke("shell:chooseRoot"),
  setTheme: (mode) => ipcRenderer.invoke("shell:setTheme", mode),
  getAccent: () => ipcRenderer.invoke("ui:get-accent"),
  getTheme: () => ipcRenderer.invoke("ui:get-theme"),
  openWindow: (abs, appId) => ipcRenderer.send("shell:open-window", abs, appId),
  stripBounds: () => ipcRenderer.invoke("ui:strip-get"),
  setTabsWidth: (px) => ipcRenderer.send("ui:tabs-width", px),
  openAppAssistant: () => ipcRenderer.invoke("shell:open-assistant"),
  applyEdit: (ops) => ipcRenderer.invoke("shell:edit-apply", ops),
  undoEdit: () => ipcRenderer.invoke("shell:edit-undo"),
  soloInfo: () => ipcRenderer.invoke("solo:info"),
  openWorkspace: () => ipcRenderer.send("solo:workspace"),
  setAccent: (id) => ipcRenderer.invoke("ui:set-accent", id),
  context: (opts) => ipcRenderer.invoke("shell:context", opts),
  toggleAi: () => ipcRenderer.send("ui:toggle-ai"),
  openSettings: (section) => ipcRenderer.send("ui:overlay", { kind: "settings", section }),
  prefs: { get: () => ipcRenderer.invoke("prefs:get"), set: (patch) => ipcRenderer.invoke("prefs:set", patch) },
  perfInfo: () => ipcRenderer.invoke("perf:info"),
  links: { insert: (abs) => ipcRenderer.invoke("links:insert", abs) },
  openTheme: (anchor) => ipcRenderer.send("ui:overlay", { kind: "theme", anchor }),
  closeOverlay: () => ipcRenderer.send("ui:overlay-close"),
  openWorkspaceMenu: (anchor) => ipcRenderer.send("ui:overlay", { kind: "workspace", anchor }),
  ws: {
    info: () => ipcRenderer.invoke("ws:info"),
    switch: (root) => ipcRenderer.invoke("ws:switch", root),
    chooseFolder: () => ipcRenderer.invoke("ws:choose-folder"),
    create: (req) => ipcRenderer.invoke("ws:new", req),
    open: (kind) => ipcRenderer.invoke("ws:open", kind),
    rename: (name) => ipcRenderer.invoke("ws:rename", name),
    save: () => ipcRenderer.invoke("ws:save"),
    remove: (root) => ipcRenderer.invoke("ws:remove", root),
    reveal: () => ipcRenderer.send("ws:reveal"),
    welcome: () => ipcRenderer.invoke("ws:welcome"),
    inspect: (dir) => ipcRenderer.invoke("ws:inspect", dir),
    close: () => ipcRenderer.invoke("ws:close"),
  },
  openVault: () => ipcRenderer.send("ui:overlay", { kind: "vault" }),
  vault: {
    status: () => ipcRenderer.invoke("vault:status"),
    unlock: (secret, recovery) => ipcRenderer.invoke("vault:unlock", secret, !!recovery),
    lock: () => ipcRenderer.invoke("vault:lock"),
    enable: (opts) => ipcRenderer.invoke("vault:enable", opts),
    change: (req) => ipcRenderer.invoke("vault:change", req),
    recovery: (req) => ipcRenderer.invoke("vault:recovery", req),
    disable: (req) => ipcRenderer.invoke("vault:disable", req),
    settings: (patch) => ipcRenderer.invoke("vault:settings", patch),
  },
  openAbout: () => ipcRenderer.send("ui:overlay", { kind: "about" }),
  openHelp: (anchor) => ipcRenderer.send("ui:overlay", { kind: "help", anchor }),
  openReport: () => ipcRenderer.send("ui:overlay", { kind: "report" }),
  report: { send: (req) => ipcRenderer.invoke("report:send", req) },
  renameFile: (abs, name) => ipcRenderer.invoke("shell:rename", abs, name),
  about: {
    info: () => ipcRenderer.invoke("about:info"),
    doc: (key) => ipcRenderer.invoke("about:doc", key),
    openGuide: () => ipcRenderer.invoke("about:open-guide"),
  },
  openNewTabMenu: (anchor) => ipcRenderer.send("ui:overlay", { kind: "newtab", anchor }),
  session: {
    get: () => ipcRenderer.invoke("session:get"),
    add: (abs) => ipcRenderer.invoke("session:add", abs),
    remove: (abs) => ipcRenderer.invoke("session:remove", abs),
    setTabs: (on) => ipcRenderer.invoke("session:set-tabs", on),
  },
  createFile: (req) => ipcRenderer.invoke("ai:create-file", req),
  tabs: {
    list: () => ipcRenderer.invoke("tabs:list"),
    activate: (id) => ipcRenderer.send("tabs:activate", id),
    close: (id) => ipcRenderer.send("tabs:close", id),
    newTab: (appId) => ipcRenderer.send("tabs:new", appId),
  },
  on: (channel, cb) => {
    if (EVENTS.has(channel)) ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
  ai: {
    status: () => ipcRenderer.invoke("ai:status"),
    settings: () => ipcRenderer.invoke("ai:settings"),
    update: (patch) => ipcRenderer.invoke("ai:update", patch),
    test: () => ipcRenderer.invoke("ai:test"),
    detectLocal: () => ipcRenderer.invoke("ai:detect-local"),
    pull: (name) => ipcRenderer.invoke("ai:pull", name),
    cancelPull: (name) => ipcRenderer.send("ai:pull-cancel", name),
    chat: (payload, onEvent) => {
      const id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const channel = "ai:ev:" + id;
      const listener = (_e, ev) => {
        onEvent(ev);
        if (ev.type === "end" || ev.type === "error") ipcRenderer.removeListener(channel, listener);
      };
      ipcRenderer.on(channel, listener);
      ipcRenderer.invoke("ai:chat", id, payload);
      return { cancel: () => ipcRenderer.send("ai:cancel", id) };
    },
  },
});
