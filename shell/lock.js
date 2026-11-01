// The lock screen of a protected project: it covers the window until the secret is given.
const card = $('card');
let st = null; // the vault's status, from the main process
let phase = 'locked'; // locked | locking | unlocking
let progress = { done: 0, total: 0 };
let useRecovery = false;
let message = '';
let waitTimer = null;
let busy = false;

const PROMPT = { password: 'Password', pin: 'PIN', question: 'Your answer' };

function draw() {
  clearInterval(waitTimer);
  card.textContent = '';
  if (!st || !st.enabled) return;
  const av = el('span', { className: 'proj-avatar big', textContent: (st.name || 'A')[0].toUpperCase() });
  av.style.background = st.color;
  card.append(av, el('h1', { textContent: st.name }), el('p', { className: 'lock-sub', textContent: phase === 'locking' ? 'Locking…' : phase === 'unlocking' ? 'Unlocking…' : 'This project is locked' }));

  if (phase !== 'locked') {
    const bar = el('div', { className: 'lock-bar' }, el('i'));
    bar.firstChild.style.width = progress.total ? Math.round((progress.done / progress.total) * 100) + '%' : '12%';
    card.append(bar, el('p', { className: 'lock-sub', textContent: progress.total ? `${progress.done} of ${progress.total} files` : 'Getting ready…' }));
    return;
  }

  const input = el('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: useRecovery ? 'Recovery key' : PROMPT[st.method] || 'Password', 'aria-label': useRecovery ? 'Recovery key' : PROMPT[st.method] });
  if (st.method === 'pin' && !useRecovery) (input.inputMode = 'numeric'), (input.maxLength = 12);
  const err = el('div', { className: 'test-out bad', textContent: message });
  const go = el('button', { className: 'btn primary', textContent: 'Unlock' });
  const show = el('button', { className: 'btn show-btn', textContent: 'Show', type: 'button', title: 'Show what you type' });
  show.onclick = () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    show.textContent = input.type === 'password' ? 'Show' : 'Hide';
    input.focus();
  };

  const submit = async () => {
    if (busy || !input.value) return;
    busy = true;
    go.disabled = true;
    const r = await api.vault.unlock(input.value, useRecovery);
    busy = false;
    if (r.ok) {
      input.value = '';
      // The main process hides this screen; if it came back by a recovery key, point at the way to set a new secret.
      if (r.recovered) setTimeout(() => api.openVault(), 600);
      return;
    }
    message = r.message || 'That isn’t right.';
    draw();
    if (r.wait) countdown(r.wait);
    else $('card').querySelector('input')?.focus();
  };
  go.onclick = submit;
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

  const label = useRecovery ? 'Type the recovery key you saved when you turned the lock on.' : st.method === 'question' ? st.question : null;
  if (label) card.append(el('p', { className: 'lock-q', textContent: label }));
  card.append(el('div', { className: 'lock-row' }, input, show), err, go);
  if (st.hint && !useRecovery) card.append(el('p', { className: 'lock-hint', textContent: 'Hint: ' + st.hint }));
  if (st.hasRecovery) {
    const alt = el('button', { className: 'link-btn', textContent: useRecovery ? 'Back to the normal way' : 'Forgot it? Use the recovery key' });
    alt.onclick = () => ((useRecovery = !useRecovery), (message = ''), draw());
    card.append(alt);
  }
  api.ws.info().then((w) => {
    const others = w.workspaces.filter((x) => x.root !== w.root);
    if (!others.length || phase !== 'locked') return;
    const list = el('div', { className: 'lock-others' }, el('small', { textContent: 'Or open another project' }));
    for (const o of others.slice(0, 4)) {
      const b = el('button', { className: 'btn', textContent: o.name, title: o.root });
      b.onclick = () => api.ws.switch(o.root);
      list.append(b);
    }
    card.append(list);
  });
  if (!busy) setTimeout(() => input.focus(), 30);
}

function countdown(seconds) {
  const err = card.querySelector('.test-out');
  const go = card.querySelector('.btn.primary');
  let left = seconds;
  go.disabled = true;
  const tick = () => {
    if (left <= 0) {
      clearInterval(waitTimer);
      go.disabled = false;
      err.textContent = '';
      card.querySelector('input')?.focus();
      return;
    }
    err.textContent = `Too many tries. Wait ${left} s.`;
    left--;
  };
  tick();
  waitTimer = setInterval(tick, 1000);
}

let drawnFor = '';
function apply(s) {
  const was = phase;
  const key = s.root + '|' + s.method + '|' + s.question;
  const same = key === drawnFor;
  drawnFor = key;
  st = s;
  if (s.phase) phase = s.phase;
  else phase = 'locked';
  progress = { done: s.done || 0, total: s.total || 0 };
  if (s.phase === 'locked' && s.failed) message = `${s.failed} file(s) were in use and stayed unlocked.`;
  else if (was !== 'locked' || phase !== 'locked') message = '';
  // Progress ticks only move the bar; a full redraw would steal the typing focus.
  const bar = card.querySelector('.lock-bar i');
  if (bar && phase === was && phase !== 'locked') {
    bar.style.width = progress.total ? Math.round((progress.done / progress.total) * 100) + '%' : '12%';
    const t = card.querySelector('.lock-sub:last-child');
    if (t) t.textContent = progress.total ? `${progress.done} of ${progress.total} files` : 'Getting ready…';
    return;
  }
  if (phase === 'locked' && was === 'locked' && same && card.querySelector('input') && !s.failed) return;
  if (!same) (useRecovery = false), (message = '');
  draw();
}
api.on('ui:vault', apply);
api.vault.status().then((s) => apply(s));
