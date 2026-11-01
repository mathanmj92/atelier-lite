// The window page: the welcome screen (create / open a workspace), Home (start something new, workspace
// files), and the right end of the top row (assistant, workspace, theme, help). The tab strip, the AI
// panel and the dialogs that float over the apps are separate views; this page only asks the main
// process to show them.
let apps = [];
let files = [];
let filter = 'all';
let active = 'home';
let aiOpen = false;
let welcome = false;
let project = { name: 'Atelier', color: '#5b6cff', root: '', savedAt: null, workspaces: [] };
let vault = { enabled: false, open: false, locked: false };

// ---------- small helpers ----------
const SVG = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5M12 16.8v.1"/>',
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14 7l3 3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  chev: '<path d="M7 10l5 5 5-5"/>',
};
function svg(name, size = 16) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = SVG[name];
  return s;
}
function icon(a, cls = '') {
  const i = el('span', { className: 'ico ' + cls, textContent: a.name[0] });
  i.style.background = a.color;
  i.setAttribute('aria-hidden', 'true');
  return i;
}
const appOf = (id) => apps.find((a) => a.id === id);
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function fmtWhen(t) {
  const d = new Date(t);
  const days = (Date.now() - t) / 86400000;
  if (days < 1 && new Date().getDate() === d.getDate()) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days < 2) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined });
}
function flash(text) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { className: 'toast', textContent: text, role: 'status' });
  document.body.append(t);
  setTimeout(() => t.remove(), 3600);
}
const avatar = (name, color, cls = 'proj-avatar') => {
  const a = el('span', { className: cls, textContent: (name || 'A')[0].toUpperCase() });
  a.style.background = color;
  return a;
};
const rectOf = (node) => {
  const r = node.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
};

// ---------- the right end of the top row ----------
function renderTopbar() {
  $('topbar').classList.toggle('is-welcome', welcome);
  const ai = $('ai-top');
  ai.hidden = welcome;
  ai.textContent = '✦ AI assistant';
  ai.classList.toggle('on', aiOpen);
  const lk = $('lock-btn');
  lk.textContent = '';
  lk.append(svg('lock', 14), ' Lock');
  lk.hidden = welcome || !(vault.enabled && vault.open);
  const g = $('settings-btn');
  if (!g.firstChild) g.append(svg('gear', 18));
  const h = $('help-btn');
  if (!h.firstChild) h.append(svg('help', 18));
}
$('ai-top').onclick = () => api.toggleAi();
$('lock-btn').onclick = () => api.vault.lock();
$('settings-btn').onclick = () => api.openSettings();
$('help-btn').onclick = () => api.openHelp({ ...rectOf($('help-btn')), fromTop: true });
$('h-report').onclick = $('w-report').onclick = () => api.openReport();
$('h-help').onclick = $('w-help').onclick = () => api.openAbout();
api.on('ui:ai-open', (state) => ((aiOpen = !!state), renderTopbar()));
api.on('ui:vault', (v) => {
  vault = v;
  document.body.classList.toggle('vault-locked', !!v.locked);
  renderTopbar();
});
api.vault.status().then((v) => ((vault = v), document.body.classList.toggle('vault-locked', !!v.locked), renderTopbar()));
api.on('ui:workspace', (w) => {
  const changedRoot = w.root !== project.root;
  project = { ...project, ...w };
  renderProject();
  renderTopbar();
  renderWelcome();
  if (changedRoot) refresh();
});

function renderProject() {
  $('proj-name').textContent = project.name;
  $('proj-saved').textContent = project.savedAt ? '· Saved ' + new Date(project.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

// ---------- the welcome screen ----------
function setWelcome(on) {
  welcome = !!on;
  document.body.classList.toggle('is-welcome', welcome);
  $('welcome').hidden = !welcome;
  $('home').style.display = welcome || active !== 'home' ? 'none' : '';
  renderTopbar();
  if (welcome) refreshWorkspaces();
  else refresh();
}
api.on('ui:welcome', setWelcome);
function wmsg(text) {
  $('w-msg').hidden = !text;
  $('w-msg').textContent = text || '';
}
async function startWith(promise) {
  wmsg('');
  document.body.classList.add('busy');
  try {
    const r = await promise;
    if (r && r.ok === false && !r.cancelled) wmsg(r.message || 'That did not work.');
    return r;
  } finally {
    document.body.classList.remove('busy');
  }
}
$('w-create').onclick = async () => {
  const dir = await api.ws.chooseFolder();
  if (!dir) return;
  const info = await api.ws.inspect(dir);
  // A folder that already holds a lot is probably not meant to become a workspace (Downloads, Desktop...).
  if (!info.hasProject && info.items > 25 && !confirm('This folder already holds ' + info.items + ' items.\n\nAtelier will add its own folders inside it (Documents, Presentations, Spreadsheets...) and list the files it can open. Use it anyway?\n\nTip: an empty folder keeps things tidy.')) return;
  const r = await startWith(api.ws.switch(dir));
  if (r && r.ok) api.ws.save();
};
$('w-open').onclick = () => startWith(api.ws.open('file'));
$('w-folder').onclick = () => startWith(api.ws.open('folder'));
function renderWelcome() {
  const host = $('w-recent');
  if (!host) return;
  host.textContent = '';
  const list = [...(project.workspaces || [])].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  $('w-none').hidden = list.length > 0;
  for (const w of list) {
    const open = el('button', { className: 'w-item', title: w.root }, avatar(w.name, w.color), el('span', { className: 'w-item-text' }, el('b', { textContent: w.name }), el('small', { textContent: w.root })), el('span', { className: 'w-when', textContent: w.lastUsed ? fmtWhen(w.lastUsed) : '' }));
    open.onclick = () => startWith(api.ws.switch(w.root));
    const forget = el('button', { className: 'w-forget', title: 'Remove from this list (the folder is not deleted)', textContent: '×' });
    forget.setAttribute('aria-label', 'Remove ' + w.name + ' from the list');
    forget.onclick = async () => (await api.ws.remove(w.root), refreshWorkspaces());
    host.append(el('div', { className: 'w-row' }, open, forget));
  }
  // Enter opens the most recent one: the usual way back in.
  if (welcome && !document.querySelector('.rename-box') && !document.activeElement?.closest?.('.w-actions')) host.querySelector('.w-item')?.focus({ preventScroll: true });
}
async function refreshWorkspaces() {
  project = { ...project, ...(await api.ws.info()) };
  renderWelcome();
}

// ---------- Home: start something new ----------
const NEW_LABEL = { documents: 'New document', presentation: 'New presentation', spreadsheet: 'New spreadsheet', pdf: 'Open or create a PDF', markdown: 'New Markdown file', forms: 'New form' };
function renderCards() {
  const host = $('cards');
  host.textContent = '';
  for (const a of apps) {
    const sub = a.collection ? (a.count ? `${a.count} ${a.id === 'notes' ? 'items' : 'boards'} · open` : a.blurb) : '＋ ' + (NEW_LABEL[a.id] || a.blurb);
    const c = el('button', { className: 'card', title: a.collection ? 'Open ' + a.name : NEW_LABEL[a.id] }, icon(a), el('b', { textContent: a.name }), el('span', { textContent: sub }));
    // A card always starts something new; opening what you already have is the file list below or its tab.
    c.onclick = () => (a.collection ? api.show(a.id) : a.id === 'markdown' || a.id === 'forms' ? api.newFile(a.id) : api.tabs.newTab(a.id));
    host.append(c);
  }
}

function renderChips() {
  const host = $('chips');
  host.textContent = '';
  const present = new Set(files.flatMap((f) => f.apps.slice(0, 1)));
  const opts = [['all', 'All'], ...apps.filter((a) => present.has(a.id)).map((a) => [a.id, a.name])];
  if (!opts.some(([id]) => id === filter)) filter = 'all';
  for (const [id, label] of opts) {
    const b = el('button', { className: 'chip' + (filter === id ? ' on' : ''), textContent: label });
    b.onclick = () => ((filter = id), renderChips(), renderFiles());
    host.append(b);
  }
}

const stem = (f) => f.name.slice(0, f.name.length - (f.ext ? f.ext.length + 1 : 0));
let renaming = null; // the file being renamed: the 5-second refresh must not wipe the box
function renderFiles() {
  const q = $('search').value.trim().toLowerCase();
  const list = files.filter((f) => (filter === 'all' || f.apps[0] === filter) && (!q || f.name.toLowerCase().includes(q)));
  const host = $('files');
  host.textContent = '';
  $('empty').hidden = list.length > 0;
  host.hidden = list.length === 0;
  for (const f of list.slice(0, 200)) {
    const a = appOf(f.apps[0]);
    const row = el('div', { className: 'row', tabIndex: 0, role: 'button' });
    const nameEl = el('div', { className: 'name' }, f.name, el('small', { textContent: f.external ? f.folder : f.folder === '.' ? 'Workspace' : f.folder }));
    const mk = (name, title, cls, fn) => {
      const b = el('button', { className: 'act ' + cls, title });
      b.setAttribute('aria-label', title + ': ' + f.name);
      b.append(svg(name, 15));
      b.onclick = (e) => (e.stopPropagation(), fn(b));
      return b;
    };
    const more = el('button', { className: 'more', textContent: '⋯', title: 'More actions' });
    more.setAttribute('aria-label', 'Actions for ' + f.name);
    row.append(
      icon(a),
      nameEl,
      el('div', { className: 'when', textContent: fmtWhen(f.modified) }),
      el('div', { className: 'size', textContent: fmtSize(f.size) }),
      el('div', { className: 'acts' }, ...(f.external ? [] : [mk('pencil', 'Rename', 'rename', () => startRename(nameEl, f)), mk('trash', 'Delete', 'del', () => removeFile(f))]), more),
    );
    row.onclick = (e) => !e.target.closest('.acts') && !e.target.closest('.rename-box') && api.open(f.abs, f.apps[0]);
    row.addEventListener('keydown', (e) => e.key === 'Enter' && e.target === row && api.open(f.abs, f.apps[0]));
    more.onclick = (e) => (e.stopPropagation(), openMenu(f, more.getBoundingClientRect()));
    row.oncontextmenu = (e) => (e.preventDefault(), openMenu(f, { left: e.clientX, bottom: e.clientY }));
    host.append(row);
    if (renaming === f.abs) startRename(nameEl, f);
  }
}
async function removeFile(f) {
  if (await api.remove(f.abs)) (flash('Moved “' + f.name + '” to the Recycle Bin.'), refresh());
}
// A file's name changes in place: type, Enter to keep it, Esc to leave it. The extension stays.
function startRename(nameEl, f) {
  renaming = f.abs;
  const box = el('input', { className: 'rename-box', type: 'text', value: stem(f), maxLength: 120, spellcheck: false });
  box.setAttribute('aria-label', 'New name for ' + f.name);
  nameEl.textContent = '';
  nameEl.append(box, f.ext ? el('span', { className: 'rename-ext', textContent: '.' + f.ext }) : '');
  box.focus();
  box.select();
  let done = false;
  const finish = async (keep) => {
    if (done) return;
    done = true;
    renaming = null;
    const next = box.value.trim();
    if (keep && next && next !== stem(f)) {
      const r = await api.renameFile(f.abs, next);
      if (!r.ok) flash(r.message || 'Could not rename that file.');
    }
    refresh();
  };
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') (e.stopPropagation(), finish(false));
  });
  box.addEventListener('blur', () => finish(true));
  box.addEventListener('click', (e) => e.stopPropagation());
}

// ---------- context menu: open in any app that can read the file ----------
function openMenu(f, rect) {
  const m = $('menu');
  m.textContent = '';
  m.append(el('div', { className: 'label', textContent: 'Open in' }));
  for (const id of f.apps) {
    const a = appOf(id);
    const b = el('button', {}, icon(a), a.name);
    b.onclick = () => (closeMenu(), api.open(f.abs, id));
    m.append(b);
  }
  m.append(el('hr'));
  const win = el('button', { textContent: 'Open in a new window' });
  win.title = 'Just this document, without the workspace';
  win.onclick = () => (closeMenu(), api.openWindow(f.abs, f.apps[0]));
  m.append(win);
  const add = el('button', { textContent: '✦ Add to AI session' });
  add.onclick = () => (closeMenu(), api.session.add(f.abs));
  m.append(add);
  const reveal = el('button', { textContent: 'Show in folder' });
  reveal.onclick = () => (closeMenu(), api.reveal(f.abs));
  m.append(reveal);
  if (!f.external) {
    const ren = el('button', { textContent: 'Rename…' });
    ren.onclick = () => {
      closeMenu();
      const row = [...$('files').children].find((r) => r.querySelector('.name')?.firstChild?.textContent === f.name);
      if (row) startRename(row.querySelector('.name'), f);
    };
    const del = el('button', { textContent: 'Move to Recycle Bin' });
    del.onclick = () => (closeMenu(), removeFile(f));
    m.append(ren, del);
  }
  m.hidden = false;
  const x = Math.min(rect.left, innerWidth - m.offsetWidth - 8);
  const y = Math.min(rect.bottom + 4, innerHeight - m.offsetHeight - 8);
  m.style.left = Math.max(8, x) + 'px';
  m.style.top = Math.max(8, y) + 'px';
}
function closeMenu() {
  $('menu').hidden = true;
}
document.addEventListener('mousedown', (e) => !e.target.closest('#menu') && closeMenu());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());

async function refresh() {
  const info = await api.info();
  apps = info.apps;
  aiOpen = !!info.aiOpen;
  active = info.current || 'home';
  $('home').style.display = welcome || active !== 'home' ? 'none' : '';
  project = { ...project, ...(await api.ws.info()) };
  files = welcome ? [] : await api.files();
  renderProject();
  renderTopbar();
  renderCards();
  renderChips();
  if (renaming) return; // keep the box the person is typing in
  renderFiles();
  renderWelcome();
}

$('search').oninput = renderFiles;
const h = new Date().getHours();
$('tod').textContent = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';

api.on('shell:active', (id) => {
  active = id;
  $('home').style.display = welcome || id !== 'home' ? 'none' : '';
  if (id === 'home') refresh();
});
setInterval(() => active === 'home' && !welcome && refresh(), 5000);
// The drag area behind the top row must stop where the tab strip starts, or the Home button, the tabs and + get no clicks.
const fitDrag = async () => {
  const s = await api.stripBounds();
  $('dragbar').style.left = s.left + s.width + 'px';
};
api.on('ui:strip', (s) => ($('dragbar').style.left = s.left + s.width + 'px'));
api.on('ui:tabs', fitDrag);
api.on('ui:welcome', () => setTimeout(fitDrag, 60));
fitDrag();
api.ws.welcome().then((w) => setWelcome(w));
