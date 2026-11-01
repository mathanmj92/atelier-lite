// Atelier's stand-in for the Puter SDK (js.puter.com/v2). The apps think they are
// running inside Puter; files go to the shared workspace folder on this computer,
// there is nothing to sign in to, and cloud-only features (AI, hosting, email,
// workers) are simply absent so the apps hide them.
(() => {
  const A = window.atelier;
  if (!A) return;

  // ---- one theme for every app ----
  // The apps used to keep a light/dark choice of their own, so the sidebar and an app could disagree.
  // Now the app follows the window's mode (it starts in "system"), and a colour palette from Atelier
  // is laid over its colour variables. The variable names differ per app, so each gets its own map.
  try {
    ['documents:theme', 'spreadsheet:theme', 'notes:theme', 'whiteboard-theme', 'presentation:theme', 'pdf-editor:theme'].forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
  // These four read a light/dark stamp on <html>; the window's mode is stamped there, and an app's own
  // theme switch is undone, so the window and the app can never disagree.
  let wantMode = null;
  let lastInput = 0;
  ['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, () => (lastInput = Date.now()), true));
  const stamp = () => {
    if (!wantMode || !['documents', 'spreadsheet', 'presentation', 'pdf'].includes(A.app)) return;
    const r = document.documentElement;
    const v = r.getAttribute('data-theme');
    // The app's own light / dark switch (its account menu) sets the stamp itself: that is a request to
    // change the whole window, so it is passed on; the stamp follows when the new palette arrives.
    // Only a click or key just now counts: an app that sets its own theme while loading must not be heard.
    if (v !== wantMode && (v === 'light' || v === 'dark') && Date.now() - lastInput < 1500) {
      wantMode = v; // adopt it at once, so the app does not flash back to the old mode while the window catches up
      A.call('setTheme', { mode: v });
    }
    if (r.getAttribute('data-theme') !== wantMode) r.setAttribute('data-theme', wantMode);
  };
  new MutationObserver(stamp).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const themeCss = (p) => {
    const shared = `--page:${p.page};--surface:${p.surface};--surface-2:${p.surface2};--surface-3:${p.surface3};--canvas:${p.canvas};--accent:${p.accent};--accent-strong:${p.accentStrong};--accent-ink:${p.accentInk};--accent-wash:${p.accentWash};--brand:${p.accent};`;
    const maps = {
      documents: shared + `--ed-frame:${p.frame};--ed-card:${p.dark ? p.card : p.surface};--ed-hover:${p.hover};--ed-press:${p.press};--ed-line:${p.line};--ed-workspace:${p.workspace};--ed-accent:${p.accent};--ed-accent-wash:${p.accentWash};--bs-side:${p.accentStrong};`,
      spreadsheet: shared,
      presentation: shared + `--line:${p.line};`,
      pdf: shared,
      whiteboard: `--bg:${p.page};--surface:${p.surface};--sidebar:${p.surface2};--line:${p.line};--accent:${p.accent};--accent-hover:${p.accentStrong};--canvas:${p.canvas};`,
      markdown: `--bg:${p.surface};--panel:${p.surface2};--accent:${p.accent};--accent-soft:${p.accentWash};`,
      notes: `--accent:${p.accent};--accent-hover:${p.accentStrong};--accent-text:${p.accentStrong};--accent-soft:${p.accentWash};--bg-chrome:${p.frame};--bg-card:${p.card};--bg-rail:${p.surface2};--bg-pane:${p.surface};--bg-page:${p.page};--bg-input:${p.surface};--bg-menu:${p.card};--line:${p.line};--line-2:${p.line};`,
      forms: `--ui:${p.accent};--chrome:${p.frame};--desk:${p.canvas};--panel:${p.surface};--card:${p.dark ? p.card : p.surface};--sunk:${p.surface2};--line:${p.line};--line-2:${p.line};`,
    };
    return `:root:root:root{${maps[A.app] || ''}}`;
  };
  // ---- an Office-style colour band: each app's title row and tab row take that app's colour, so Word,
  // Sheets, Slides and the rest are told apart at a glance. (Keep the colours in step with shell/common.js.)
  const BAND = { documents: '#4f6a9a', spreadsheet: '#4d7c6a', presentation: '#a8644f', pdf: '#9a4f55', markdown: '#3f7a7a', forms: '#9a5578', notes: '#8a7142', whiteboard: '#6f5f9a' };
  const BANDS = {
    spreadsheet: { rows: '.editor-header, .ribbon-tab-row', tab: '.ribbon-tab' },
    documents: { rows: '.ed-titlebar, .ribbon-tabs', tab: '.ribbon-tab' },
    presentation: { rows: '.editor-header, .ribbon-tab-row', tab: '.ribbon-tab' },
    notes: { rows: '.titlebar, .ribbon-tabs-row', tab: '.ribbon-tab' },
    pdf: { rows: '.editor-topbar, .appbar', tab: '.top-tab' },
    markdown: { rows: '#tabbar, #menubar', tab: '' },
    forms: { rows: '.tb1', tab: '' },
    whiteboard: { rows: '.library-top, .editor-heading, .editor-actions', tab: '' },
  };
  // Controls that have a white fill of their own (search boxes, pills, the open document's chip) turn into
  // frosted glass on the colour band, so their labels stay readable in light and dark.
  const GLASS = { documents: '.ed-search, .ed-pill, .user-avatar', spreadsheet: '.user-avatar', presentation: '.command-search, .btn.secondary', };
  const darken = (h, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');
  const bandCss = (p) => {
    const base = BAND[A.app], spec = BANDS[A.app];
    if (!base || !spec) return '';
    const col = p.dark ? darken(base, 0.22) : base;
    const rows = spec.rows.split(',').map((s) => s.trim());
    const on = (tail) => rows.map((r) => r + tail).join(',');
    const kids = ':is(button,a,span,label,.titlebar-title,input,select,svg,b,small,strong,i,em)';
    let css = `:root:root:root{--band:${col};--band-ink:#fff;--band-tab:${p.dark ? p.surface : '#ffffff'};--band-tab-ink:${p.dark ? '#ffffff' : col};}`
      + `${rows.join(',')}{background:var(--band)!important;color:var(--band-ink)!important;border-color:transparent!important;box-shadow:none!important}`
      + `${on(' ' + kids)}{color:var(--band-ink)!important}`
      + `${rows.flatMap((r) => [r + ' button:hover', r + ' a:hover']).join(',')}{background:rgba(255,255,255,.18)!important}`
      + `${on(' :focus-visible')}{outline:2px solid #fff!important;outline-offset:1px}`
      + `${on(' input::placeholder')}{color:rgba(255,255,255,.7)!important}`;
    if (spec.tab) {
      css += `${spec.tab}[aria-selected="true"]{background:var(--band-tab)!important;color:var(--band-tab-ink)!important;font-weight:700!important;border-radius:8px 8px 0 0!important;box-shadow:none!important}`
        + `${spec.tab}[aria-selected="true"] *{color:inherit!important}`;
    }
    if (GLASS[A.app]) {
      css += GLASS[A.app].split(',').map((s) => s.trim()).map((s) => spec.rows.split(',').map((r) => r.trim() + ' ' + s).join(',')).join(',') + '{background:rgba(255,255,255,.18)!important;border:1px solid rgba(255,255,255,.42)!important;color:#fff!important}'
        + GLASS[A.app].split(',').map((s) => s.trim()).map((s) => spec.rows.split(',').map((r) => r.trim() + ' ' + s + ':hover').join(',')).join(',') + '{background:rgba(255,255,255,.3)!important}'
        + spec.rows.split(',').map((r) => r.trim() + ' .ed-search input').join(',') + '{background:transparent!important;border:0!important}';
    }
    if (A.app === 'pdf') {
      css += ':root:root .document-tab{background:var(--band-tab)!important;border-color:transparent!important}:root:root .document-tab,:root:root .document-tab *{color:var(--band-tab-ink)!important}';
    }
    if (A.app === 'whiteboard') {
      css += '.sidebar .brand{display:flex!important;align-items:center;height:54px;margin:0 0 16px!important;padding:0 16px!important;border-radius:12px;background:var(--band)!important;pointer-events:none}'
        + '.sidebar .brand>*{display:none!important}.sidebar .brand::after{content:"Whiteboard";color:#fff;font-weight:700;font-size:17px;letter-spacing:.01em}'
        + '.sidebar .sidebar-bottom{display:none!important}'
        + '.library-top .crumbs,.library-top .crumbs *,.library-top .icon-btn,.library-top .icon-btn svg,.library-top .account-button{color:#fff!important}'
        + '.library-top .icon-btn:hover,.library-top .account-button:hover{background:rgba(255,255,255,.2)!important}'
        + '.library-top .account-button{background:rgba(255,255,255,.2)!important;border-color:rgba(255,255,255,.4)!important}'
        + '.library-top{border-radius:0 0 14px 14px!important}'
        + '.editor-heading,.editor-actions{border-radius:12px!important;border:0!important}.editor-heading .mini-brand{display:none!important}'
        + '.editor-heading,.editor-heading *,.editor-actions .icon-btn,.editor-actions .icon-btn svg,.editor-actions .account-button{color:#fff!important}'
        + '.editor-actions .share-button{background:#fff!important;color:var(--band)!important;border-color:#fff!important}.editor-actions .share-button *{color:var(--band)!important}'
        + '.editor-heading input,.editor-heading [contenteditable]{color:#fff!important;font-weight:600}';
    }
    if (A.app === 'forms') {
      css += `.tb1 .web-ico{background:#fff!important;color:var(--band)!important;border-radius:8px!important}`
        + `.tb1 .btn{background:transparent!important;border-color:rgba(255,255,255,.6)!important;color:#fff!important}`
        + `.tb1 .btn.pri{background:#fff!important;border-color:#fff!important;color:var(--band)!important}`
        + `.tb1 .btn.pri *{color:var(--band)!important}`
        + `.tb1 .wtabs button{border-bottom-color:transparent!important}.tb1 .wtabs button[aria-current=true]{border-bottom:3px solid #fff!important;font-weight:700!important}`
        + `.tb1 .tbtn svg,.tb1 .wt svg{color:#fff!important}`
        + `.tb1 .wtools{border-left-color:rgba(255,255,255,.4)!important}`
        + `.tb1 .titlebox input{color:#fff!important}`;
    }
    if (A.app === 'markdown') {
      css += `#tabbar .tab.active,#tabbar .tab.on,#tabbar [aria-selected="true"]{background:var(--band-tab)!important}#tabbar .tab.active *,#tabbar .tab.on *,#tabbar [aria-selected="true"] *{color:var(--band-tab-ink)!important}`;
    }
    return css;
  };
  let themeStyle = null;
  const applyTheme = (p) => {
    if (!p) return;
    wantMode = p.dark ? 'dark' : 'light';
    stamp();
    if (!themeStyle) {
      themeStyle = document.createElement('style');
      themeStyle.id = 'atelier-theme';
      (document.head || document.documentElement).appendChild(themeStyle);
    }
    themeStyle.textContent = themeCss(p) + bandCss(p) + (p.reduce ? '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}' : '');
  };
  applyTheme(A.theme && A.theme());
  A.onTheme && A.onTheme(applyTheme);

  const call = async (op, args) => {
    const r = await A.call(op, args);
    if (r && r.__err) throw Object.assign(new Error(r.message || r.code), { code: r.code });
    return r;
  };
  const MIME = {
    pdf: 'application/pdf', json: 'application/json', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', html: 'text/html',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || '';

  async function toBytes(d) {
    if (d == null) return new Uint8Array();
    if (typeof d === 'string') return new TextEncoder().encode(d);
    if (d instanceof Blob) return new Uint8Array(await d.arrayBuffer());
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    return new TextEncoder().encode(JSON.stringify(d));
  }

  const fsRead = async (path) => {
    const bytes = await call('read', { path });
    return new Blob([bytes], { type: mimeOf(path) });
  };
  const fsWrite = async (path, data, opts = {}) => {
    // Puter also accepts write(path, { name, ... }) forms; only the plain ones are used here.
    return item(await call('write', { path, data: await toBytes(data), opts }));
  };
  const item = (m) =>
    m && {
      ...m,
      isDir: m.is_dir,
      read: () => fsRead(m.path),
      write: (d, o) => fsWrite(m.path, d, { overwrite: true, ...o }),
    };

  const fs = {
    read: fsRead,
    write: fsWrite,
    stat: async (path) => item(await call('stat', { path })),
    readdir: async (path) => (await call('readdir', { path })).map(item),
    mkdir: async (path, opts) => item(await call('mkdir', { path, opts })),
    delete: (path, opts) => call('delete', { path, opts }).then(() => undefined),
    rename: async (path, name) => item(await call('rename', { path, name })),
    move: async (source, destination, opts) => item(await call('move', { source, destination, opts })),
    copy: async (source, destination, opts) => item(await call('copy', { source, destination, opts })),
    getReadURL: async (path) => URL.createObjectURL(await fsRead(path)),
  };

  // Settings and small values live in this app's own browser storage.
  const KV = 'puterkv:';
  const kv = {
    get: async (k) => {
      try {
        const v = localStorage.getItem(KV + k);
        return v == null ? null : JSON.parse(v);
      } catch {
        return null;
      }
    },
    set: async (k, v) => (localStorage.setItem(KV + k, JSON.stringify(v)), true),
    del: async (k) => (localStorage.removeItem(KV + k), true),
    list: async (pattern, returnValues) => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(KV)).map((k) => k.slice(KV.length));
      const re = typeof pattern === 'string' && pattern.endsWith('*') ? new RegExp('^' + pattern.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : null;
      const hit = re ? keys.filter((k) => re.test(k)) : keys;
      return returnValues === true || pattern === true ? Promise.all(hit.map(async (key) => ({ key, value: await kv.get(key) }))) : hit;
    },
    incr: async (k, n = 1) => {
      const v = (Number(await kv.get(k)) || 0) + n;
      await kv.set(k, v);
      return v;
    },
    decr: async (k, n = 1) => kv.incr(k, -n),
    flush: async () => {
      Object.keys(localStorage).filter((k) => k.startsWith(KV)).forEach((k) => localStorage.removeItem(k));
      return true;
    },
  };

  const user = { username: 'You', uuid: 'local-user', email: null };
  const auth = {
    isSignedIn: () => true,
    getUser: async () => user,
    signIn: async () => user,
    signOut: async () => {},
    getProfilePicture: async () => null,
  };

  // A file handed to an app ("Open in..." on Home, double-click) waits here until
  // the app has registered for launches.
  const launchHandlers = [];
  const pending = [];
  const dispatch = (items) => launchHandlers.forEach((h) => h(items));
  A.onOpenItem((m) => {
    const it = item(m);
    if (launchHandlers.length) dispatch([it]);
    else pending.push(it);
  });
  const register = (cb) => {
    launchHandlers.push(cb);
    if (pending.length) {
      const items = pending.splice(0);
      queueMicrotask(() => cb(items));
    }
  };

  const pick = (apiCall) => apiCall;
  const ui = {
    showOpenFilePicker: async (opts = {}) => {
      const r = await call('dialogOpen', { accept: opts.accept, multiple: !!opts.multiple });
      if (!r) return undefined; // cancelled
      const items = r.map(item);
      return opts.multiple ? items : items[0];
    },
    showSaveFilePicker: async (data, name, opts) => {
      const accept = opts?.accept || (name && /\.[\w-]+$/.test(name) ? '.' + name.split('.').pop() : undefined);
      const r = await call('dialogSave', { data: await toBytes(data), name, accept });
      return r ? item(r) : undefined;
    },
    onLaunchedWithItems: register,
    onItemsOpened: register,
    setWindowTitle: async () => {},
  };

  // puter.ai: the apps' own assistants (which read and edit the open document with tools) run on
  // whichever AI the person set up for Atelier. Parts come out in the shape the apps read:
  // { text } and { type: 'tool_use', id, name, input }.
  async function* streamParts(messages, opts) {
    const queue = [];
    let wake = null;
    let done = false;
    let failure = null;
    const poke = () => (wake && (wake(), (wake = null)));
    const run = A.aiChat(
      { messages, options: { tools: opts.tools, max_tokens: opts.max_tokens || opts.maxTokens, temperature: opts.temperature } },
      (ev) => {
        if (ev.type === 'text') queue.push({ text: ev.text });
        else if (ev.type === 'tool') queue.push({ type: 'tool_use', id: ev.id, name: ev.name, input: ev.input });
        else if (ev.type === 'error') (failure = Object.assign(new Error(ev.message), { code: ev.code }), (done = true));
        else if (ev.type === 'end') done = true;
        poke();
      },
    );
    try {
      for (;;) {
        while (queue.length) yield queue.shift();
        if (failure) throw failure;
        if (done) return;
        await new Promise((r) => (wake = r));
      }
    } finally {
      if (!done) run.cancel();
    }
  }
  const ai = {
    chat: async (a, b, c) => {
      const messages = typeof a === 'string' ? [{ role: 'user', content: a }] : Array.isArray(a) ? a : [];
      const opts = [b, c].find((x) => x && typeof x === 'object' && !Array.isArray(x)) || {};
      if (opts.stream) return streamParts(messages, opts);
      let text = '';
      const calls = [];
      for await (const part of streamParts(messages, opts)) {
        if (part.type === 'tool_use') calls.push({ id: part.id, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.input || {}) } });
        else text += part.text;
      }
      return { message: { role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) } };
    },
  };

  window.puter = {
    ai,
    env: 'app',
    authToken: 'atelier-local',
    APIOrigin: 'app://atelier.invalid',
    onAuth: null,
    auth,
    fs,
    kv,
    ui,
    exit: () => {},
    print: () => {},
  };
  void pick;
})();
