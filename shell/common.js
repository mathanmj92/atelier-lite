// Shared by every Atelier page (Home, the AI panel, the overlay).
const api = window.shellApi;
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

// Colour themes. Light and dark come from the system colour scheme (nativeTheme);
// these restyle Atelier's own sidebar, Home, panel and dialogs.
const ACCENTS = [
  { id: 'indigo', name: 'Indigo', accent: '#5b6cff', side: '#14161c', hover: '#20242d', on: '#2a2f3b' },
  { id: 'ocean', name: 'Ocean', accent: '#0ea5b7', side: '#0e1c22', hover: '#162a32', on: '#1d3640' },
  { id: 'forest', name: 'Forest', accent: '#2f9e62', side: '#101c15', hover: '#18291f', on: '#203629' },
  { id: 'amber', name: 'Amber', accent: '#d98a0b', side: '#201a0e', hover: '#2d2415', on: '#3a2f1b' },
  { id: 'rose', name: 'Rose', accent: '#e0457b', side: '#21111a', hover: '#2d1822', on: '#3b2030' },
  { id: 'violet', name: 'Violet', accent: '#8b5cf6', side: '#181326', hover: '#221b35', on: '#2d2445' },
  { id: 'graphite', name: 'Graphite', accent: '#6b7280', side: '#17181b', hover: '#222428', on: '#2d2f35' },
  { id: 'paper', name: 'Paper', accent: '#4a5568', side: '#e9ecf1', hover: '#dde1e8', on: '#cfd5df', light: true },
];
// The main process builds one palette from the mode and the colour theme (electron/theme.cjs) and
// sends it to every page, so the sidebar, Home, the assistant and the apps always agree.
function applyPalette(p) {
  if (!p) return;
  const s = document.documentElement.style;
  const set = (k, v) => s.setProperty(k, v);
  set('--bg', p.page);
  set('--panel', p.surface);
  set('--text', p.ink);
  set('--muted', p.muted);
  set('--line', p.line);
  set('--accent', p.accent);
  set('--accent-ink', p.accentInk || '#fff');
  set('--side', p.side);
  set('--side-hover', p.sideHover);
  set('--side-on', p.sideOn);
  set('--side-text', p.sideText);
  set('--side-strong', p.sideStrong);
  set('--side-line', p.sideLine);
  set('--title-bar', p.titleBar);
  s.colorScheme = p.dark ? 'dark' : 'light';
  document.documentElement.dataset.mode = p.dark ? 'dark' : 'light';
  set('--ts', p.textScale || 1);
  document.documentElement.classList.toggle('reduce', !!p.reduce);
}
// The colour each app wears across its title row (shim/puter-shim.js paints the same colours inside the apps).
const BAND = { documents: '#4f6a9a', spreadsheet: '#4d7c6a', presentation: '#a8644f', pdf: '#9a4f55', markdown: '#3f7a7a', forms: '#9a5578', notes: '#8a7142', whiteboard: '#6f5f9a' };
const bandDark = (h) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.78).toString(16).padStart(2, '0')).join('');
const applyAccent = () => api.getTheme().then(applyPalette);
let accentId = 'indigo';
api.getAccent().then((id) => (accentId = id));
api.on('ui:accent', (id) => (accentId = id));
api.getTheme().then(applyPalette);
api.on('ui:theme', applyPalette);
