// The tab strip above the apps: one tab per open document.
const HOUSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 11.2 12 4l8.5 7.2M6 9.8V20h4.5v-5.5h3V20H18V9.8"/></svg>';
$('homebtn').innerHTML = HOUSE;
$('homebtn').onclick = () => api.show('home');
// The workspace sits next to Home: its name, and the menu to switch, save, protect or close it.
const avatar = (name, color) => {
  const a = el('span', { className: 'proj-avatar sm', textContent: (name || 'A')[0].toUpperCase() });
  a.style.background = color;
  return a;
};
let wsNow = { name: 'Atelier', color: '#5b6cff' };
function drawWs() {
  const c = $('wschip');
  c.textContent = '';
  c.append(avatar(wsNow.name, wsNow.color), el('span', { className: 'ws-chip-name', textContent: wsNow.name }), el('span', { className: 'ws-chev', textContent: '⌄' }));
  requestAnimationFrame(() => api.setTabsWidth(Math.ceil($('tabs').scrollWidth + $('homebtn').offsetWidth + $('wschip').offsetWidth + $('newtab').offsetWidth + 56)));
}
$('wschip').onclick = () => {
  const r = $('wschip').getBoundingClientRect();
  api.openWorkspaceMenu({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
};
api.on('ui:workspace', (w) => ((wsNow = { name: w.name, color: w.color }), drawWs()));
api.ws.info().then((w) => ((wsNow = { name: w.name, color: w.color }), drawWs()));
function render({ tabs, current }) {
  const host = $('tabs');
  host.textContent = '';
  $('homebtn').classList.toggle('on', current === 'home');
  $('homebtn').setAttribute('aria-pressed', current === 'home');
  for (const t of tabs) {
    const tab = el('div', { className: 'tab' + (t.id === current ? ' on' : '') + (t.asleep ? ' asleep' : ''), role: 'tab', tabIndex: 0, title: t.title + ' — ' + t.appName });
    tab.setAttribute('aria-selected', t.id === current);
    const band = BAND[t.app] || t.color; tab.style.setProperty('--band-l', band); tab.style.setProperty('--band-d', bandDark(band));
    const ico = el('span', { className: 'tab-ico', textContent: t.appName[0] });
    ico.style.background = t.color;
    const close = el('button', { className: 'tab-x', textContent: '×' });
    close.setAttribute('aria-label', 'Close ' + t.title);
    close.title = 'Close (Alt+W)';
    close.onclick = (e) => (e.stopPropagation(), api.tabs.close(t.id));
    tab.append(ico, el('span', { className: 'tab-title', textContent: t.title }), close);
    tab.onclick = () => api.tabs.activate(t.id);
    tab.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && api.tabs.activate(t.id));
    tab.onauxclick = (e) => e.button === 1 && api.tabs.close(t.id);
    host.append(tab);
  }
  host.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // The strip is only as wide as its tabs: the rest of the top row belongs to the window page behind it,
  // which is what the window can be dragged by.
  requestAnimationFrame(() => api.setTabsWidth(Math.ceil(host.scrollWidth + $('homebtn').offsetWidth + $('wschip').offsetWidth + $('newtab').offsetWidth + 56)));
}
$('newtab').onclick = () => {
  const r = $('newtab').getBoundingClientRect();
  api.openNewTabMenu({ left: r.left, bottom: r.bottom, x: r.left + window.screenX });
};
api.on('ui:tabs', render);
api.tabs.list().then(render);
