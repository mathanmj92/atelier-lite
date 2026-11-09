// A full-window layer above the apps for the theme menu, the new-tab menu and the AI
// settings: anything that has to appear over an app lives here, because the apps are
// views of their own.
const back = $('backdrop');
let kind = null;

let onCloseHook = null;
function close() {
  if (onCloseHook) (onCloseHook(), (onCloseHook = null));
  kind = null;
  back.hidden = true;
  back.textContent = '';
  api.closeOverlay();
}
back.addEventListener('mousedown', (e) => e.target === back && close());
document.addEventListener('keydown', (e) => e.key === 'Escape' && close());

// ---------- theme menu ----------
async function showTheme(anchor) {
  let mode = (await api.info()).theme || 'system';
  back.className = '';
  back.hidden = false;
  const draw = () => {
    back.textContent = '';
    const pop = el('div', { className: 'menu theme-pop' });
    pop.style.position = 'fixed';
    pop.append(el('div', { className: 'label', textContent: 'Appearance' }));
    const seg = el('div', { className: 'seg', role: 'group' });
    for (const [id, label] of [['light', '☀ Light'], ['dark', '☾ Dark'], ['system', '⚙ System']]) {
      const b = el('button', { className: id === mode ? 'on' : '', textContent: label });
      b.onclick = async () => ((mode = await api.setTheme(id)), draw());
      seg.append(b);
    }
    pop.append(seg, el('div', { className: 'label', textContent: 'Colour theme' }));
    const grid = el('div', { className: 'swatches' });
    for (const a of ACCENTS) {
      const b = el('button', { className: 'swatch' + (a.id === accentId ? ' on' : ''), title: a.name });
      b.setAttribute('aria-label', a.name + ' theme');
      b.style.background = `linear-gradient(135deg, ${a.side} 0 50%, ${a.accent} 50% 100%)`;
      b.onclick = async () => {
        accentId = await api.setAccent(a.id);
        applyAccent(accentId);
        draw();
      };
      grid.append(b);
    }
    pop.append(grid, el('small', { className: 'note', textContent: 'Light, dark and the colour theme apply to the whole window: the title bar, the assistant and every app.' }));
    back.append(pop);
    if (anchor.fromTop) {
      pop.style.top = anchor.bottom + 6 + 'px';
      pop.style.left = Math.max(8, Math.min(anchor.right - 250, innerWidth - 258)) + 'px';
    } else {
      pop.style.left = Math.max(8, Math.min(anchor.right + 8, innerWidth - 258)) + 'px';
      pop.style.bottom = Math.max(8, innerHeight - anchor.bottom) + 'px';
    }
  };
  draw();
}

// ---------- new tab menu ----------
async function showNewTab(anchor) {
  const info = await api.info();
  back.className = '';
  back.hidden = false;
  back.textContent = '';
  const m = el('div', { className: 'menu' });
  m.style.position = 'fixed';
  m.style.left = Math.min(anchor.left, innerWidth - 220) + 'px';
  m.style.top = anchor.bottom + 4 + 'px';
  m.append(el('div', { className: 'label', textContent: 'New tab' }));
  for (const a of info.apps) {
    const ico = el('span', { className: 'ico', textContent: a.name[0] });
    ico.style.background = a.color;
    const b = el('button', {}, ico, a.name);
    b.onclick = () => (api.tabs.newTab(a.id), close());
    m.append(b);
  }
  back.append(m);
}

// ---------- AI settings ----------
const PROVIDER_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', local: 'Local model', anthropic: 'Anthropic API', openai: 'OpenAI-compatible', custom: 'Custom command' };
// Good starting points for Ollama; any other model name can be typed in.
const SUGGESTED = [
  ['qwen3:8b', 'Qwen3 8B', 'Strong all-round model'],
  ['qwen2.5:7b-instruct', 'Qwen2.5 7B Instruct', 'Reliable instruction follower'],
  ['gemma3:4b', 'Gemma 3 4B', 'Light and fast'],
  ['llama3.2:3b', 'Llama 3.2 3B', 'Very light, runs on most PCs'],
  ['phi4-mini', 'Phi-4 mini', 'Small, good at reasoning'],
];
let onPull = null;
api.on('ui:pull', (p) => onPull && onPull(p));
const fmtBytes = (n) => (n < 1e6 ? n + ' B' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.round(n / 1e6) + ' MB');

async function showSettings(host) {
  const [s, status] = await Promise.all([api.ai.settings(), api.ai.status()]);
  let chosen = s.provider;
  let fields = {};
  let detected = null; // null = not looked yet, [] = nothing running
  let detecting = false;
  const pulls = {}; // model -> { status, total, completed, error, done }
  let pending = {}; // values to put in the fields on the next draw (typed text is kept otherwise)
  if (!host) {
    back.className = 'dim';
    back.hidden = false;
  }

  const detect = async () => {
    detecting = true;
    draw();
    detected = await api.ai.detectLocal();
    detecting = false;
    // Adopt the first running server when nothing is set yet.
    if (detected.length && !s.localModel) {
      const first = detected.find((d) => d.models.length) || detected[0];
      pending.localUrl = first.url;
      if (first.models[0]) pending.localModel = first.models[0].name;
    }
    draw();
  };
  onPull = (p) => {
    pulls[p.name] = p.done ? { ...pulls[p.name], done: true, cancelled: p.cancelled } : p.error ? { error: p.error } : { ...p };
    if (p.done && !p.cancelled) detect();
    else if (p.error || p.cancelled) draw();
    else if (kind === 'settings' && !back.hidden) updatePulls();
  };
  const updatePulls = () => {
    for (const el_ of (host || back).querySelectorAll('[data-pull]')) {
      const p = pulls[el_.dataset.pull];
      if (!p) continue;
      const bar = el_.querySelector('.bar > i');
      const txt = el_.querySelector('.pull-state');
      const pct = p.total ? Math.round((p.completed / p.total) * 100) : 0;
      if (bar) bar.style.width = (p.done ? 100 : pct) + '%';
      if (txt) txt.textContent = p.error ? p.error : p.done ? 'Installed' : p.total ? `${pct}% · ${fmtBytes(p.completed)} of ${fmtBytes(p.total)}` : p.status || 'Starting…';
    }
  };

  function draw() {
    // Keep what was typed when the dialog redraws (a download finishing, Detect...).
    for (const [k, input] of Object.entries(fields)) if (input.isConnected && !/Key$/.test(k)) s[k] = input.value;
    Object.assign(s, pending);
    pending = {};
    fields = {};
    (host || back).textContent = '';
    const box = el('div', { className: 'modal-box', role: 'dialog' });
    const body = el('div', { id: host ? undefined : 'modal-body', className: host ? 'set-ai' : '' });
    if (!host) {
      box.setAttribute('aria-label', 'AI settings');
      const x = el('button', { className: 'icon-btn', textContent: '×' });
      x.setAttribute('aria-label', 'Close');
      x.onclick = close;
      box.append(el('header', {}, el('b', { textContent: 'AI settings' }), x), body);
    }
    body.append(el('p', { className: 'sub', textContent: 'Pick one provider. It powers the assistant panel, and it is the only AI in Atelier Lite.' }));
    const field = (id, label, value, type = 'text', ph = '', attrs = {}) => {
      const input = el('input', { type, value: value || '', placeholder: ph, ...attrs });
      fields[id] = input;
      return el('label', {}, label, input);
    };

    const localFields = () => {
      const out = [];
      const urlRow = el('div', { className: 'row-btns' });
      const url = field('localUrl', 'Server address', s.localUrl, 'text', 'http://127.0.0.1:11434');
      url.style.flex = '1';
      const det = el('button', { className: 'btn', textContent: detecting ? 'Looking…' : 'Detect' });
      det.disabled = detecting;
      det.onclick = (e) => (e.preventDefault(), detect());
      urlRow.append(url, det);
      out.push(urlRow);
      const list = el('datalist', { id: 'local-models' });
      const running = detected || [];
      const models = running.flatMap((d) => d.models.map((m) => ({ ...m, server: d })));
      for (const m of models) list.append(el('option', { value: m.name }));
      const model = field('localModel', 'Model', s.localModel, 'text', 'e.g. qwen3:8b');
      model.querySelector('input').setAttribute('list', 'local-models');
      out.push(model, list);
      const ctx = el('input', { type: 'text', value: s.localCtx || '16384', placeholder: '16384' });
      fields.localCtx = ctx;
      out.push(el('label', {}, 'Context window (tokens) — larger reads longer documents but uses more memory', ctx));
      // What was found.
      if (detected) {
        out.push(
          el('small', {
            textContent: detected.length
              ? 'Running: ' + detected.map((d) => `${d.name} (${d.models.length} model${d.models.length === 1 ? '' : 's'})`).join(', ')
              : 'No local server found. Install Ollama (ollama.com) or LM Studio (lmstudio.ai), start it, and press Detect.',
          }),
        );
        if (models.length) {
          const chips = el('div', { className: 'quick' });
          for (const m of models) {
            const b = el('button', { textContent: m.name + (m.params ? ` · ${m.params}` : m.size ? ` · ${fmtBytes(m.size)}` : '') });
            b.onclick = (e) => {
              e.preventDefault();
              pending.localModel = m.name;
              pending.localUrl = m.server.url;
              draw();
            };
            chips.append(b);
          }
          out.push(chips);
        }
      }
      // Downloads (Ollama only).
      const ollama = (detected || []).find((d) => d.kind === 'ollama');
      out.push(el('div', { className: 'label', textContent: ollama ? 'Download a model with Ollama' : 'Suggested models (needs Ollama to download here)' }));
      for (const [tag, name, why] of SUGGESTED) {
        const have = models.some((m) => m.name === tag || m.name.startsWith(tag + ':'));
        const row = el('div', { className: 'pull-row' });
        row.dataset.pull = tag;
        const p = pulls[tag];
        const state = el('span', { className: 'pull-state' + (p?.error ? ' bad' : ''), textContent: have ? 'Installed' : p?.error || '' });
        const bar = el('div', { className: 'bar' }, el('i'));
        const btn = el('button', { className: 'btn', textContent: have ? 'Use' : p && !p.done && !p.error ? 'Cancel' : 'Download' });
        btn.disabled = !have && !ollama;
        btn.onclick = (e) => {
          e.preventDefault();
          if (have) return ((pending.localModel = tag), draw());
          if (p && !p.done && !p.error) return api.ai.cancelPull(tag);
          pulls[tag] = { status: 'Starting…' };
          pending.localModel = tag;
          draw();
          api.ai.pull(tag);
        };
        row.append(el('div', {}, el('b', { textContent: name }), el('small', { textContent: ' ' + why + ' · ' + tag })), state, btn, bar);
        out.push(row);
      }
      return out;
    };

    const defs = [
      { id: 'claude-code', hint: 'Uses your installed Claude Code and its sign-in. Tick “Allow editing workspace files” in the assistant to let it work on your files.', f: () => [field('claudeModel', 'Model (optional)', s.claudeModel, 'text', 'e.g. sonnet')] },
      { id: 'codex', hint: 'Uses your installed Codex CLI and its sign-in.', f: () => [field('codexModel', 'Model (optional)', s.codexModel)] },
      { id: 'local', hint: 'Runs on your own computer through Ollama, LM Studio or llama.cpp: free, private, and it works offline. Quality and speed depend on the model and your hardware.', f: localFields },
      { id: 'anthropic', hint: 'Streams from api.anthropic.com.', f: () => [field('anthropicKey', 'API key', '', 'password', s.hasAnthropicKey ? 'Saved — leave blank to keep' : 'sk-ant-…'), field('anthropicModel', 'Model', s.anthropicModel)] },
      { id: 'openai', hint: 'OpenAI, OpenRouter or anything else OpenAI-compatible that needs a key.', f: () => [field('openaiBase', 'Base URL', s.openaiBase), field('openaiKey', 'API key', '', 'password', s.hasOpenaiKey ? 'Saved — leave blank to keep' : 'sk-…'), field('openaiModel', 'Model', s.openaiModel)] },
      { id: 'custom', hint: 'Any command that reads the prompt on stdin and prints the answer, e.g. gemini -p.', f: () => [field('customCommand', 'Command', s.customCommand, 'text', 'gemini -p')] },
    ];
    for (const d of defs) {
      const st = status.find((v) => v.id === d.id) || {};
      const label = el('div', { className: 'prov' + (chosen === d.id ? ' on' : '') });
      const radio = el('input', { type: 'radio', name: 'prov', checked: chosen === d.id });
      const pick = () => {
        if (chosen === d.id) return;
        chosen = d.id;
        draw();
        if (d.id === 'local' && detected === null) detect();
      };
      radio.onchange = pick;
      label.addEventListener('click', (e) => !e.target.closest('input,button,label,.prov-fields') && pick());
      const badge = el('span', { className: 'badge' + (st.available ? ' ok' : ''), textContent: st.kind === 'cli' && d.id !== 'custom' ? (st.available ? 'Installed' : 'Not found') : st.kind === 'api' ? 'API' : st.kind === 'local' ? 'On this PC' : 'Command' });
      label.append(el('div', { className: 'prov-top' }, radio, el('b', { textContent: PROVIDER_NAMES[d.id] }), badge));
      label.append(el('small', { textContent: d.hint + (st.kind === 'cli' && d.id !== 'custom' && !st.available ? ' ' + st.install : '') }));
      if (chosen === d.id) label.append(el('div', { className: 'prov-fields' }, ...d.f()));
      body.append(label);
    }
    const out = el('span', { className: 'test-out' });
    const save = el('button', { className: 'btn primary', textContent: 'Save' });
    const test = el('button', { className: 'btn', textContent: 'Save & test' });
    const none = el('button', { className: 'btn', textContent: 'Turn AI off' });
    const collect = () => {
      const patch = { provider: chosen };
      for (const [k, input] of Object.entries(fields)) if (input.isConnected) patch[k] = input.value;
      return patch;
    };
    const done = (msg) => (host ? ((out.className = 'test-out'), (out.textContent = msg)) : close());
    save.onclick = async () => (await api.ai.update(collect()), done('Saved.'));
    test.onclick = async () => {
      out.className = 'test-out';
      out.textContent = 'Testing… (a local model can take a moment to load)';
      await api.ai.update(collect());
      const r = await api.ai.test();
      out.className = 'test-out' + (r.ok ? '' : ' bad');
      out.textContent = r.ok ? 'Works. Reply: ' + r.reply : r.message;
    };
    none.onclick = async () => (await api.ai.update({ provider: 'none' }), host ? ((chosen = 'none'), draw(), done('AI is off.')) : close());
    body.append(el('div', { className: 'row-btns' }, save, test, none), out);
    host ? host.append(body) : back.append(box);
    updatePulls();
  }
  draw();
  if (chosen === 'local') detect();
}

// ---------- projects ----------
const avatar = (name, color, cls = 'proj-avatar') => {
  const a = el('span', { className: cls, textContent: (name || 'A')[0].toUpperCase() });
  a.style.background = color;
  return a;
};
const parentOf = (p) => String(p).replace(/[\\/][^\\/]*$/, '');
async function showWorkspace(anchor) {
  const w = await api.ws.info();
  const vs = await api.vault.status();
  back.className = '';
  back.hidden = false;
  back.textContent = '';
  const m = el('div', { className: 'menu ws-menu' });
  m.style.position = 'fixed';
  m.style.left = Math.max(8, Math.min(anchor.fromTop ? anchor.right - 290 : anchor.left, innerWidth - 300)) + 'px';
  m.style.top = anchor.bottom + 4 + 'px';
  const note = el('div', { className: 'ws-note', hidden: true });
  const act = (fn) => async () => {
    const r = await fn();
    if (r && r.ok === false && !r.cancelled) {
      note.textContent = r.message || 'Something went wrong.';
      note.hidden = false;
    } else if (!r || r.ok !== false) close();
  };
  const item = (label, fn, hint) => {
    const b = el('button', {}, label, hint ? el('small', { className: 'hint-r', textContent: hint }) : '');
    b.onclick = act(fn);
    return b;
  };
  m.append(
    el('div', { className: 'ws-head' }, avatar(w.name, w.color), el('div', {}, el('b', { textContent: w.name }), el('small', { textContent: w.root }))),
    note,
    item('Save workspace now', () => api.ws.save(), w.savedAt ? 'saved ' + new Date(w.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'saves itself'),
    item('Rename workspace…', async () => (showRename(w), { ok: false, cancelled: true })),
    item('Show workspace folder', async () => (api.ws.reveal(), { ok: true })),
    item(vs.enabled ? 'Workspace lock…' : 'Protect this workspace…', async () => (showVault(), { ok: false, cancelled: true }), vs.enabled ? 'on' : 'off'),
  );
  if (vs.enabled && vs.open) m.append(item('Lock now', async () => (api.vault.lock(), { ok: true })));
  const others = w.workspaces.filter((x) => x.root !== w.root);
  if (others.length) {
    m.append(el('hr'), el('div', { className: 'label', textContent: 'Switch to' }));
    for (const o of others) {
      const b = el('button', { title: o.root }, avatar(o.name, o.color, 'proj-avatar sm'), el('span', { className: 'ws-name', textContent: o.name }));
      b.onclick = act(() => api.ws.switch(o.root));
      m.append(b);
    }
  }
  m.append(
    el('hr'),
    item('New workspace…', async () => (showNewProject(w), { ok: false, cancelled: true })),
    item('Open workspace file (.atle)…', () => api.ws.open('file')),
    item('Open a folder as a workspace…', () => api.ws.open('folder')),
    el('hr'),
    item('Close workspace (back to start)', () => api.ws.close()),
  );
  back.append(m);
}
function formModal(title, bodyEls, submitLabel, onSubmit) {
  back.className = 'dim';
  back.hidden = false;
  back.textContent = '';
  const box = el('div', { className: 'modal-box small-box', role: 'dialog' });
  box.setAttribute('aria-label', title);
  const x = el('button', { className: 'icon-btn', textContent: '×' });
  x.onclick = close;
  const err = el('div', { className: 'test-out bad' });
  const go = el('button', { className: 'btn primary', textContent: submitLabel });
  go.onclick = async () => {
    go.disabled = true;
    const r = await onSubmit();
    go.disabled = false;
    if (r && r.ok === false) err.textContent = r.message || 'Something went wrong.';
    else close();
  };
  box.append(el('header', {}, el('b', { textContent: title }), x), el('div', { id: 'modal-body' }, ...bodyEls, err, el('div', { className: 'row-btns' }, go, Object.assign(el('button', { className: 'btn', textContent: 'Cancel' }), { onclick: close }))));
  back.append(box);
  return box;
}
function showNewProject(w) {
  let parent = parentOf(w.root);
  const name = el('input', { type: 'text', placeholder: 'e.g. Thesis, Q4 launch, Client work', maxLength: 80 });
  const loc = el('input', { type: 'text', readOnly: true, value: parent });
  const browse = el('button', { className: 'btn', textContent: 'Browse…' });
  browse.onclick = async () => {
    const f = await api.ws.chooseFolder();
    if (f) loc.value = parent = f;
  };
  const box = formModal(
    'New workspace',
    [el('p', { className: 'sub', textContent: 'A workspace is a folder that holds everything for one piece of work, and remembers which documents you had open.' }), el('label', { className: 'fld' }, 'Name', name), el('label', { className: 'fld' }, 'Location', el('div', { className: 'row-btns' }, loc, browse))],
    'Create workspace',
    () => api.ws.create({ name: name.value, parent }),
  );
  name.focus();
  name.addEventListener('keydown', (e) => e.key === 'Enter' && box.querySelector('.btn.primary').click());
}
function showRename(w) {
  const name = el('input', { type: 'text', value: w.name, maxLength: 80 });
  const box = formModal('Rename workspace', [el('label', { className: 'fld' }, 'Name', name)], 'Rename', () => api.ws.rename(name.value));
  name.focus();
  name.select();
  name.addEventListener('keydown', (e) => e.key === 'Enter' && box.querySelector('.btn.primary').click());
}

// ---------- project lock (vault) ----------
const METHODS = [['password', 'Password or name'], ['pin', 'PIN (numbers)'], ['question', 'Security question']];
const METHOD_NOTE = {
  password: 'Use something long that you will remember. A name works, but a longer phrase is much harder to guess.',
  pin: 'A PIN is quick to type but easy to guess. It keeps a curious person out, not a determined one.',
  question: 'Write a question only you can answer. Anyone who knows the answer can open the project, so keep it hard to guess.',
};
const IDLE_CHOICES = [[0, 'Never'], [5, 'After 5 minutes'], [15, 'After 15 minutes'], [30, 'After 30 minutes'], [60, 'After 1 hour']];
let vaultHost = null; // set while the vault screens are drawn inside the settings dialog
const vclose = () => (vaultHost ? showVault() : close());
function vaultModal(title, ...kids) {
  if (vaultHost) {
    vaultHost.textContent = '';
    vaultHost.append(el('h4', { className: 'set-sub', textContent: title }), ...kids);
    return vaultHost;
  }
  back.className = 'dim';
  back.hidden = false;
  back.textContent = '';
  const box = el('div', { className: 'modal-box small-box vault-box', role: 'dialog' });
  box.setAttribute('aria-label', title);
  const x = el('button', { className: 'icon-btn', textContent: '×' });
  x.onclick = vclose;
  box.append(el('header', {}, el('b', { textContent: title }), x), el('div', { id: 'modal-body' }, ...kids));
  back.append(box);
  return box;
}
// The fields for choosing how to unlock: method, question, secret twice, hint.
function secretForm(method0 = 'password') {
  const method = el('select', {}, ...METHODS.map(([v, t]) => el('option', { value: v, textContent: t })));
  method.value = method0;
  const question = el('input', { type: 'text', placeholder: 'e.g. The street I grew up on', maxLength: 200 });
  const secret = el('input', { type: 'password', autocomplete: 'new-password' });
  const again = el('input', { type: 'password', autocomplete: 'new-password' });
  const hint = el('input', { type: 'text', placeholder: 'Optional. Shown on the lock screen, so keep it vague.', maxLength: 120 });
  const sLabel = el('span');
  const qFld = el('label', { className: 'fld' }, 'Your question (shown on the lock screen)', question);
  const note = el('p', { className: 'sub vault-note' });
  const sync = () => {
    qFld.hidden = method.value !== 'question';
    sLabel.textContent = { password: 'Password or name', pin: 'PIN, 4 to 12 digits', question: 'Answer' }[method.value];
    secret.inputMode = again.inputMode = method.value === 'pin' ? 'numeric' : 'text';
    note.textContent = METHOD_NOTE[method.value];
  };
  method.onchange = sync;
  sync();
  const nodes = [
    el('label', { className: 'fld' }, 'Unlock with', method),
    qFld,
    el('label', { className: 'fld' }, sLabel, secret),
    el('label', { className: 'fld' }, 'Type it again', again),
    el('label', { className: 'fld' }, 'Hint', hint),
    note,
  ];
  return {
    nodes,
    focus: () => (method0 === 'question' ? question : secret).focus(),
    get: () => ({ method: method.value, question: question.value, secret: secret.value, hint: hint.value }),
    mismatch: () => secret.value !== again.value,
  };
}
function currentField(s, label = 'Your current secret') {
  const input = el('input', { type: 'password', autocomplete: 'off' });
  return { node: el('label', { className: 'fld' }, s.method === 'question' ? `${s.question} (your answer)` : label, input), input };
}
function showRecoveryKey(key, done) {
  const copy = el('button', { className: 'btn', textContent: 'Copy' });
  copy.onclick = () => navigator.clipboard.writeText(key).then(() => (copy.textContent = 'Copied'), () => (copy.textContent = 'Select it and press Ctrl+C'));
  const chk = el('input', { type: 'checkbox' });
  const ok = el('button', { className: 'btn primary', textContent: 'Done', disabled: true });
  chk.onchange = () => (ok.disabled = !chk.checked);
  ok.onclick = done;
  vaultModal(
    'Your recovery key',
    el('p', { className: 'sub', textContent: 'If you forget your secret, this key opens the project. It is shown only now. Without your secret or this key, nobody can open the files, including Atelier Lite.' }),
    el('div', { className: 'recovery-key', textContent: key }),
    el('div', { className: 'row-btns' }, copy),
    el('label', { className: 'chk' }, chk, 'I have saved it somewhere safe, such as a password manager or on paper.'),
    el('div', { className: 'row-btns' }, ok),
  );
}
async function showVault() {
  const s = await api.vault.status();
  if (s.locked) return vclose();
  s.enabled ? showVaultOn(s) : showVaultOff();
}
function showVaultOff() {
  const form = secretForm('password');
  const idle = el('select', {}, ...IDLE_CHOICES.map(([v, t]) => el('option', { value: v, textContent: t })));
  idle.value = 15;
  const quit = el('input', { type: 'checkbox', checked: true });
  const screen = el('input', { type: 'checkbox', checked: true });
  const err = el('div', { className: 'test-out bad' });
  const go = el('button', { className: 'btn primary', textContent: 'Turn on protection' });
  go.onclick = async () => {
    err.textContent = '';
    if (form.mismatch()) return (err.textContent = 'The two entries are different.');
    go.disabled = true;
    const r = await api.vault.enable({ ...form.get(), settings: { idleMinutes: Number(idle.value), onQuit: quit.checked, onScreenLock: screen.checked } });
    go.disabled = false;
    if (!r.ok) return (err.textContent = r.message || 'Something went wrong.');
    showRecoveryKey(r.recoveryKey, vclose);
  };
  vaultModal(
    'Protect this project',
    el('p', { className: 'sub', textContent: 'Anyone who opens Atelier Lite, or this folder, can read your files. A lock encrypts every file in the project and asks for your secret to open them. It is optional, and you choose the kind of secret.' }),
    ...form.nodes,
    el('hr'),
    el('label', { className: 'fld' }, 'Lock by itself when idle', idle),
    el('label', { className: 'chk' }, quit, 'Lock when I close Atelier Lite or switch project'),
    el('label', { className: 'chk' }, screen, 'Lock when Windows locks or goes to sleep'),
    err,
    el('div', { className: 'row-btns' }, go, Object.assign(el('button', { className: 'btn', textContent: 'Not now' }), { onclick: vclose })),
  );
  form.focus();
}
function showVaultOn(s) {
  const how = METHODS.find(([v]) => v === s.method)?.[1] || '';
  const idle = el('select', {}, ...IDLE_CHOICES.map(([v, t]) => el('option', { value: v, textContent: t })));
  idle.value = s.settings.idleMinutes;
  idle.onchange = () => api.vault.settings({ idleMinutes: Number(idle.value) });
  const quit = el('input', { type: 'checkbox', checked: s.settings.onQuit });
  quit.onchange = () => api.vault.settings({ onQuit: quit.checked });
  const screen = el('input', { type: 'checkbox', checked: s.settings.onScreenLock });
  screen.onchange = () => api.vault.settings({ onScreenLock: screen.checked });
  const lock = el('button', { className: 'btn primary', textContent: 'Lock now' });
  lock.onclick = () => (api.vault.lock(), vclose());
  const change = el('button', { className: 'btn', textContent: 'Change how it unlocks…' });
  change.onclick = () => showVaultChange(s);
  const rec = el('button', { className: 'btn', textContent: 'New recovery key…' });
  rec.onclick = () => showVaultAsk(s, 'New recovery key', 'Your old recovery key stops working.', 'Make a new key', (current) => api.vault.recovery({ current }), (r) => showRecoveryKey(r.recoveryKey, vclose));
  const off = el('button', { className: 'btn', textContent: 'Turn protection off…' });
  off.onclick = () => showVaultAsk(s, 'Turn protection off', 'Every file in this project is unlocked and the lock is removed.', 'Turn off', (current) => api.vault.disable({ current }), vclose);
  vaultModal(
    'Project lock',
    el('div', { className: 'vault-state' }, el('i'), el('span', {}, `On. Unlocks with a ${how.toLowerCase()}.`)),
    el('div', { className: 'row-btns' }, lock, change, rec, off),
    el('hr'),
    el('label', { className: 'fld' }, 'Lock by itself when idle', idle),
    el('label', { className: 'chk' }, quit, 'Lock when I close Atelier Lite or switch project'),
    el('label', { className: 'chk' }, screen, 'Lock when Windows locks or goes to sleep'),
    el('p', { className: 'sub vault-note', textContent: 'File names and the project file (.atle) stay readable; what is inside the files is encrypted. Files in other folders are not covered.' }),
  );
}
// Asks for the secret now in force, then runs the change.
function showVaultAsk(s, title, intro, label, run, then) {
  const cur = currentField(s);
  const err = el('div', { className: 'test-out bad' });
  const go = el('button', { className: 'btn primary', textContent: label });
  go.onclick = async () => {
    go.disabled = true;
    const r = await run(cur.input.value);
    go.disabled = false;
    if (!r.ok) return (err.textContent = r.wait ? `Too many tries. Wait ${r.wait} s.` : r.message || 'Something went wrong.');
    then(r);
  };
  cur.input.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  vaultModal(title, el('p', { className: 'sub', textContent: intro }), cur.node, err, el('div', { className: 'row-btns' }, go, Object.assign(el('button', { className: 'btn', textContent: 'Cancel' }), { onclick: () => showVaultOn(s) })));
  cur.input.focus();
}
function showVaultChange(s) {
  const cur = currentField(s);
  const form = secretForm(s.method);
  const err = el('div', { className: 'test-out bad' });
  const go = el('button', { className: 'btn primary', textContent: 'Change' });
  go.onclick = async () => {
    err.textContent = '';
    if (form.mismatch()) return (err.textContent = 'The two entries are different.');
    go.disabled = true;
    const r = await api.vault.change({ current: cur.input.value, ...form.get() });
    go.disabled = false;
    if (!r.ok) return (err.textContent = r.wait ? `Too many tries. Wait ${r.wait} s.` : r.message || 'Something went wrong.');
    vclose();
  };
  vaultModal('Change how it unlocks', cur.node, el('hr'), ...form.nodes, err, el('div', { className: 'row-btns' }, go, Object.assign(el('button', { className: 'btn', textContent: 'Cancel' }), { onclick: () => showVaultOn(s) })));
  cur.input.focus();
}

// ---------- Help & About ----------
const SHORTCUTS = [
  ['Alt+1 … Alt+4', 'Go to an app (or start one if none is open)'], ['Alt+H', 'Home'], ['Alt+A', 'Show / hide the AI assistant'], ['Alt+,', 'Settings'],
  ['Alt+T', 'New tab (same app)'], ['Alt+W', 'Close tab'], ['Alt+PageUp / PageDown', 'Previous / next tab'], ['F1', 'Help & About'], ['Esc', 'Close a menu or dialog'],
];
async function showAbout(startTab = 'about') {
  const info = await api.about.info();
  back.className = 'dim';
  back.hidden = false;
  const TABS = [['about', 'About'], ['guide', 'User guide'], ['keys', 'Shortcuts'], ['news', 'What’s new'], ['legal', 'Licences'], ['report', 'Report a problem']];
  let tab = startTab;
  const draw = async () => {
    back.textContent = '';
    const box = el('div', { className: 'modal-box about-box', role: 'dialog' });
    box.setAttribute('aria-label', 'Help and about');
    const x = el('button', { className: 'icon-btn', textContent: '×' });
    x.setAttribute('aria-label', 'Close');
    x.onclick = close;
    const nav = el('nav', { className: 'about-nav' });
    for (const [id, label] of TABS) {
      const b = el('button', { className: id === tab ? 'on' : '', textContent: label });
      b.onclick = id === 'report' ? () => showReport() : () => ((tab = id), draw());
      nav.append(b);
    }
    const pane = el('div', { className: 'about-pane' });
    box.append(el('header', {}, el('b', { textContent: 'Help & About' }), x), el('div', { className: 'about-body' }, nav, pane));
    back.append(box);
    if (tab === 'about') {
      const logo = el('div', { className: 'about-logo' });
      pane.append(
        logo,
        el('h2', { className: 'about-title', textContent: info.name }),
        el('p', { className: 'about-slogan', textContent: info.slogan }),
        el('p', { textContent: 'Documents, presentations, spreadsheets and PDFs in one window, sharing one folder — with one AI assistant that can read across all of them and create new documents. It works offline, with no account and no cloud.' }),
      );
      const rows = [['Version', info.version], ['Electron', info.electron], ['Chromium', info.chrome], ['Platform', info.platform], ['Workspace', info.workspace], ['Settings file', info.settings]];
      const table = el('table', { className: 'about-facts' });
      for (const [k, v] of rows) table.append(el('tr', {}, el('th', { textContent: k }), el('td', { textContent: v })));
      const guide = el('button', { className: 'btn primary', textContent: 'Open the guide as a file' });
      guide.onclick = async () => (await api.about.openGuide(), close());
      const read = el('button', { className: 'btn', textContent: 'Read the guide' });
      read.onclick = () => ((tab = 'guide'), draw());
      pane.append(table, el('p', { className: 'about-updates' }, el('b', { textContent: 'Updates. ' }), 'Atelier Lite doesn’t check for updates by itself. A new version arrives as a new installer: run it over this one and your settings and workspace are kept.'), el('div', { className: 'row-btns' }, read, guide));
    } else if (tab === 'keys') {
      const table = el('table', { className: 'about-facts keys' });
      for (const [k, v] of SHORTCUTS) table.append(el('tr', {}, el('th', {}, el('kbd', { textContent: k })), el('td', { textContent: v })));
      pane.append(el('h2', { textContent: 'Keyboard shortcuts' }), table);
    } else {
      const key = { guide: 'guide', news: 'changelog', legal: 'notices' }[tab];
      const doc = el('div', { className: 'doc', innerHTML: '<p>Loading…</p>' });
      pane.append(doc);
      api.about.doc(key).then((html) => (doc.innerHTML = html));
    }
  };
  draw();
}

// ---------- the Help menu and reporting a problem ----------
function showHelp(anchor) {
  back.className = '';
  back.hidden = false;
  back.textContent = '';
  const m = el('div', { className: 'menu' });
  m.style.position = 'fixed';
  m.style.top = anchor.bottom + 6 + 'px';
  m.style.left = Math.max(8, Math.min(anchor.right - 230, innerWidth - 240)) + 'px';
  const item = (label, fn, hint) => {
    const b = el('button', {}, label, hint ? el('small', { className: 'hint-r', textContent: hint }) : '');
    b.onclick = fn;
    return b;
  };
  m.append(
    item('Help & About', () => showAbout('about'), 'F1'),
    item('User guide', () => showAbout('guide')),
    item('Keyboard shortcuts', () => showAbout('keys')),
    item('What’s new', () => showAbout('news')),
    el('hr'),
    item('Report a problem…', () => showReport()),
  );
  back.append(m);
}
async function showReport() {
  const info = await api.about.info();
  const cat = el('select', {}, ...['Something is broken', 'Something is confusing', 'I have an idea', 'Other'].map((t) => el('option', { textContent: t })));
  const text = el('textarea', { placeholder: 'What happened? What did you expect? Steps to repeat it help a lot.', maxLength: 1500 });
  const facts = `Atelier Lite ${info.version} · ${info.platform} · Electron ${info.electron}`;
  const box = formModal(
    'Report a problem',
    [
      el('p', { className: 'sub', textContent: 'Tell the developer what went wrong. Your email program opens with your note ready to send, so you can read it first. Nothing is sent from here.' }),
      el('label', { className: 'fld' }, 'Kind', cat),
      el('label', { className: 'fld' }, 'What happened', text),
      el('p', { className: 'report-facts', textContent: 'Added to the email: ' + facts + '. Contact: mathannits92@gmail.com' }),
      // No mail program on this PC? Copy the note and send it from anywhere.
      Object.assign(el('button', { className: 'btn', textContent: 'Copy instead' }), {
        onclick: async (e) => {
          const b = e.currentTarget;
          try {
            await navigator.clipboard.writeText(`To: mathannits92@gmail.com\nSubject: Atelier Lite ${info.version}: ${cat.value}\n\n${text.value}\n\n---\n${facts}`);
            b.textContent = 'Copied. Paste it into an email.';
          } catch {
            b.textContent = 'Could not copy';
          }
        },
      }),
    ],
    'Open email',
    async () => {
      if (!text.value.trim()) return { ok: false, message: 'Write a few words first.' };
      await api.report.send({ category: cat.value, text: text.value });
      return { ok: true };
    },
  );
  box.classList.add('report-box');
  text.focus();
}

// ---------- Settings: one place for everything ----------
const SECTIONS = [['general', 'General'], ['appearance', 'Appearance'], ['ai', 'AI assistant'], ['security', 'Security'], ['performance', 'Performance'], ['keys', 'Shortcuts'], ['about', 'About and report']];
const PREF_KEYS = ['startup', 'askSave', 'defaultFolder', 'textSize', 'reduceMotion', 'lowPower', 'sleepMinutes', 'awakeTabs'];
async function showSettingsDialog(start) {
  const [prefs0, info, isWelcome] = await Promise.all([api.prefs.get(), api.info(), api.ws.welcome()]);
  const draft = { ...prefs0, theme: info.theme || 'system', accent: accentId };
  let base = JSON.parse(JSON.stringify(draft));
  let section = SECTIONS.some((s) => s[0] === start) ? start : 'general';
  back.className = 'dim';
  back.hidden = false;
  back.textContent = '';
  const box = el('div', { className: 'set-box', role: 'dialog' });
  box.setAttribute('aria-label', 'Settings');
  const x = el('button', { className: 'icon-btn', textContent: '×' });
  x.setAttribute('aria-label', 'Close settings');
  x.onclick = close;
  const nav = el('nav', { className: 'set-nav', 'aria-label': 'Settings sections' });
  const pane = el('div', { className: 'set-pane' });
  const pending = el('span', { className: 'pending' });
  const save = el('button', { className: 'btn primary', textContent: 'Save' });
  const cancel = el('button', { className: 'btn', textContent: 'Close' });
  box.append(el('header', {}, el('b', { textContent: 'Settings' }), x), el('div', { className: 'set-grid' }, nav, pane), el('div', { className: 'set-foot' }, pending, el('div', { className: 'row-btns' }, cancel, save)));
  back.append(box);
  let memTimer = null;
  onCloseHook = () => {
    clearInterval(memTimer);
    vaultHost = null;
    onPull = null;
  };
  const changed = () => Object.keys(draft).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(base[k]));
  const foot = (saved) => {
    const n = changed().length;
    pending.className = 'pending' + (n ? ' dirty' : '');
    pending.textContent = saved ? 'Saved' : n ? n + (n === 1 ? ' change' : ' changes') + ' not saved yet' : 'Nothing to save';
    save.disabled = !n;
    cancel.textContent = n ? 'Cancel' : 'Close';
  };
  // small controls
  const row = (label, hint, control) => el('div', { className: 'set-row' }, el('div', { className: 'what' }, label, hint ? el('small', { textContent: hint }) : ''), control);
  const seg = (key, options) => {
    const g = el('div', { className: 'seg2', role: 'group' });
    const draw = () => g.querySelectorAll('button').forEach((b, i) => {
      const on = JSON.stringify(options[i][0]) === JSON.stringify(draft[key]);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    options.forEach(([v, label]) => {
      const b = el('button', { textContent: label });
      b.onclick = () => ((draft[key] = v), draw(), foot());
      g.append(b);
    });
    draw();
    return g;
  };
  const toggle = (key, label) => {
    const b = el('button', { className: 'toggle' + (draft[key] ? ' on' : ''), role: 'switch', type: 'button' });
    b.setAttribute('aria-checked', !!draft[key]);
    b.setAttribute('aria-label', label);
    b.onclick = () => ((draft[key] = !draft[key]), b.classList.toggle('on', draft[key]), b.setAttribute('aria-checked', draft[key]), foot());
    return b;
  };
  const panes = {
    general: () => [
      row('When Atelier Lite starts', 'The welcome screen lets you pick a workspace; or go straight back to the last one.', seg('startup', [['welcome', 'Welcome screen'], ['last', 'Last workspace']])),
      row('Folder for new workspaces', draft.defaultFolder || 'Next to your current workspace', Object.assign(el('button', { className: 'btn', textContent: 'Change…' }), { onclick: async () => { const f = await api.ws.chooseFolder(); if (f) ((draft.defaultFolder = f), draw(), foot()); } })),
      row('Ask to save the session when closing', 'So your open tabs are there next time. A stray click on the cross loses nothing.', toggle('askSave', 'Ask to save the session when closing')),
    ],
    appearance: () => {
      const sw = el('div', { className: 'set-swatches' });
      for (const a of ACCENTS) {
        const b = el('button', { className: 'swatch' + (a.id === draft.accent ? ' on' : ''), title: a.name, type: 'button' });
        b.setAttribute('aria-label', a.name + ' colour theme');
        b.style.background = 'linear-gradient(135deg, ' + a.side + ' 0 50%, ' + a.accent + ' 50% 100%)';
        b.onclick = () => ((draft.accent = a.id), draw(), foot());
        sw.append(b);
      }
      return [
        row('Mode', 'System follows Windows.', seg('theme', [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']])),
        row('Colour theme', 'Tints the title bar, the assistant and every app.', sw),
        row('Text size', 'Larger text in every app, the assistant and these dialogs.', seg('textSize', [['normal', 'Normal'], ['large', 'Large'], ['largest', 'Largest']])),
        row('Reduce animation', 'Switches off fades and slides. Helps on slower PCs.', toggle('reduceMotion', 'Reduce animation')),
      ];
    },
    ai: () => [Object.assign(el('div', { className: 'set-host', id: 'modal-body' }), { _init: (h) => showSettings(h) })],
    security: () => (isWelcome ? [el('p', { className: 'set-note', textContent: 'Open or create a workspace first. Protection locks one workspace at a time.' })] : [Object.assign(el('div', { className: 'set-host', id: 'modal-body' }), { _init: (h) => ((vaultHost = h), showVault()) })]),
    performance: () => {
      const mem = el('b', { className: 'mem', textContent: '…' });
      const sub = el('small', { textContent: '' });
      const tick = async () => {
        const p = await api.perfInfo();
        mem.textContent = p.memoryMB + ' MB';
        sub.textContent = p.awake + ' tab' + (p.awake === 1 ? '' : 's') + ' awake, ' + p.asleep + ' asleep';
      };
      tick();
      memTimer = setInterval(tick, 3000);
      return [
        row('Low-power mode', 'Fewer effects, at most two tabs awake and sleep after 5 minutes. For older PCs.', toggle('lowPower', 'Low-power mode')),
        row('Put unused tabs to sleep after', 'A sleeping tab keeps its place in the strip and opens again in a moment. Files with unsaved changes never sleep.', seg('sleepMinutes', [[5, '5 min'], [10, '10 min'], [30, '30 min'], [0, 'Never']])),
        row('Tabs kept awake at once', 'Each awake tab is a running app. Fewer means less memory.', seg('awakeTabs', [[2, '2'], [3, '3'], [5, '5'], [0, 'No limit']])),
        row('Memory used now', '', el('div', { className: 'what', style: 'text-align:right' }, mem, sub)),
      ];
    },
    keys: () => SHORTCUTS.concat([['Ctrl+Shift+K', 'Link to another file (inside any app)']]).map(([k, v]) => el('div', { className: 'set-row kbd-row' }, el('div', { className: 'what', textContent: v }), el('kbd', { textContent: k }))),
    about: async () => {
      const i = await api.about.info();
      return [
        row('Atelier Lite ' + i.version, i.platform + ', Electron ' + i.electron, Object.assign(el('button', { className: 'btn', textContent: 'About and what’s new' }), { onclick: () => showAbout('about') })),
        row('User guide', 'How everything works, with shortcuts.', Object.assign(el('button', { className: 'btn', textContent: 'Read it' }), { onclick: () => showAbout('guide') })),
        row('Report a problem', 'Opens an email to the developer with your note and these details filled in.', Object.assign(el('button', { className: 'btn', textContent: 'Report…' }), { onclick: () => showReport() })),
      ];
    },
  };
  async function draw() {
    clearInterval(memTimer);
    vaultHost = null;
    onPull = null;
    nav.textContent = '';
    for (const [id, label] of SECTIONS) {
      const b = el('button', { className: id === section ? 'on' : '', textContent: label });
      if (id === section) b.setAttribute('aria-current', 'page');
      b.onclick = () => ((section = id), draw());
      nav.append(b);
    }
    pane.textContent = '';
    pane.append(el('h3', { textContent: SECTIONS.find((s) => s[0] === section)[1] }));
    const kids = await panes[section]();
    pane.append(...kids);
    for (const k of kids) if (k._init) k._init(k);
    pane.scrollTop = 0;
  }
  save.onclick = async () => {
    save.disabled = true;
    const patch = {};
    for (const k of PREF_KEYS) patch[k] = draft[k];
    await api.prefs.set(patch);
    if (draft.theme !== base.theme) await api.setTheme(draft.theme);
    if (draft.accent !== base.accent) ((accentId = await api.setAccent(draft.accent)), applyAccent(accentId));
    base = JSON.parse(JSON.stringify(draft));
    foot(true);
    setTimeout(() => foot(), 1800);
    if (section === 'general' || section === 'appearance' || section === 'performance') draw();
  };
  cancel.onclick = close;
  foot();
  draw();
}

// ---------- Ctrl+K: link to another file ----------
async function showLinkPicker(payload) {
  const files = (await api.files()).filter((f) => !f.external);
  const apps = (await api.info()).apps;
  back.className = 'dim';
  back.hidden = false;
  back.textContent = '';
  const box = el('div', { className: 'modal-box link-box', role: 'dialog' });
  box.setAttribute('aria-label', 'Link to a file');
  const q = el('input', { type: 'search', placeholder: 'Type to search your workspace files', 'aria-label': 'Search files' });
  const list = el('div', { className: 'link-list' });
  const note = el('div', { className: 'test-out' });
  let shown = [];
  let sel = 0;
  const pick = async (f) => {
    const r = await api.links.insert(f.abs);
    if (!r.ok) return (note.className = 'test-out bad'), (note.textContent = r.message || 'Could not make the link.');
    note.className = 'test-out';
    note.textContent = r.copied ? 'Link copied. Paste it where you want it.' : 'Link inserted.';
    setTimeout(close, r.copied ? 1400 : 500);
  };
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    shown = files.filter((f) => !term || f.name.toLowerCase().includes(term)).slice(0, 60);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.textContent = '';
    if (!shown.length) list.append(el('p', { className: 'sub', textContent: 'No file matches.' }));
    shown.forEach((f, i) => {
      const a = apps.find((x) => x.id === f.apps[0]);
      const ico = el('span', { className: 'ico', textContent: a.name[0] });
      ico.style.background = a.color;
      const b = el('button', { className: i === sel ? 'on' : '' }, ico, f.name, el('small', { textContent: f.folder === '.' ? 'Workspace' : f.folder }));
      b.onclick = () => pick(f);
      list.append(b);
    });
  };
  q.oninput = () => ((sel = 0), draw());
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), (sel = Math.min(sel + 1, shown.length - 1)), draw());
    else if (e.key === 'ArrowUp') (e.preventDefault(), (sel = Math.max(sel - 1, 0)), draw());
    else if (e.key === 'Enter' && shown[sel]) pick(shown[sel]);
  });
  const x = el('button', { className: 'icon-btn', textContent: '×' });
  x.setAttribute('aria-label', 'Close');
  x.onclick = close;
  box.append(el('header', {}, el('b', { textContent: 'Link to a file' }), x), el('div', { id: 'modal-body' }, el('p', { className: 'sub', textContent: payload.canInsert ? 'The link goes in where your cursor is. Clicking it opens the file in a new tab.' : 'The link is copied, ready to paste. Clicking it opens the file in a new tab.' }), q, list, note));
  back.append(box);
  draw();
  q.focus();
}

api.on('ui:overlay', (payload) => {
  kind = payload.kind;
  if (kind === 'link') return showLinkPicker(payload);
  if (kind === 'help') return showHelp(payload.anchor || { right: innerWidth - 160, bottom: 40 });
  if (kind === 'report') return showReport();
  if (kind === 'about') return showAbout(payload.tab);
  if (kind === 'vault') return showVault();
  if (kind === 'workspace') return showWorkspace(payload.anchor || { left: 8, bottom: 56 });
  if (kind === 'theme') showTheme(payload.anchor || { right: 70, bottom: innerHeight - 20 });
  else if (kind === 'settings') showSettingsDialog(payload.section);
  else if (kind === 'newtab') showNewTab(payload.anchor || { left: 300, bottom: 40 });
});
