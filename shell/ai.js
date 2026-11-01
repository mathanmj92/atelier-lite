// The AI assistant panel: its own view on the right of the window.
let aiSettings = null;
let history = [];
let running = null;
let open = false;
const PROVIDER_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', local: 'Local model', anthropic: 'Anthropic API', openai: 'OpenAI-compatible', custom: 'Custom command', none: 'Not set up' };
const isCli = (p) => p === 'claude-code' || p === 'codex';
const store = {
  get: (k, d) => {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

// ----- reading: everything the assistant is given, shown as chips you can switch off -----
let appsInfo = [];
let session = { files: [], includeTabs: true };
let ctxNow = { app: 'home' };
let openOthers = [];
let useCurrent = true;
const excluded = new Set(store.get('ai.excluded', []));
const appInfo = (id) => appsInfo.find((a) => a.id === id || a.name === id) || { color: '#6b7280', name: 'File' };

function chip({ app, text, title, on = true, toggle, remove }) {
  const a = appInfo(app);
  const ico = el('i', { textContent: a.name[0] });
  ico.style.background = a.color;
  const c = el('span', { className: 'fchip' + (toggle ? ' toggle' : '') + (on ? '' : ' off'), title });
  c.append(ico, el('span', { textContent: text }));
  if (toggle) {
    c.tabIndex = 0;
    c.setAttribute('role', 'switch');
    c.setAttribute('aria-checked', String(on));
    c.onclick = toggle;
    c.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle());
  }
  if (remove) {
    const rm = el('button', { textContent: '×', title: 'Remove from this chat' });
    rm.setAttribute('aria-label', 'Remove ' + text);
    rm.onclick = (e) => (e.stopPropagation(), remove());
    c.append(rm);
  }
  return c;
}
function renderReading() {
  const box = $('reading-chips');
  box.textContent = '';
  let n = 0;
  const sel = ctxNow.selection?.trim();
  if (ctxNow.app && ctxNow.app !== 'home' && (ctxNow.file || sel || ctxNow.app === 'markdown' || ctxNow.app === 'notes')) {
    if (useCurrent) n++;
    box.append(
      chip({
        app: ctxNow.app,
        text: sel ? `Selection · ${sel.length.toLocaleString()} characters` : ctxNow.file?.name || ctxNow.appName,
        title: (sel ? 'Only the selected text' : 'The document you are looking at') + ' — click to turn off',
        on: useCurrent,
        toggle: () => ((useCurrent = !useCurrent), renderReading()),
      }),
    );
  }
  for (const o of openOthers) {
    const on = session.includeTabs && !excluded.has(o.abs);
    if (on) n++;
    box.append(
      chip({
        app: o.appId,
        text: o.name,
        title: `Open in a tab (${o.app}) — click to ${on ? 'leave it out' : 'include it'}`,
        on,
        toggle: () => {
          if (!session.includeTabs) {
            api.session.setTabs(true);
            excluded.clear();
            for (const x of openOthers) if (x.abs !== o.abs) excluded.add(x.abs);
          } else if (excluded.has(o.abs)) excluded.delete(o.abs);
          else excluded.add(o.abs);
          store.set('ai.excluded', [...excluded]);
          renderReading();
        },
      }),
    );
  }
  for (const f of session.files) {
    n++;
    box.append(chip({ app: f.app, text: f.name, title: f.rel || f.abs, remove: () => api.session.remove(f.abs) }));
  }
  $('reading-count').textContent = n ? ` · ${n} item${n === 1 ? '' : 's'}` : '';
  if (!box.children.length) box.append(el('span', { className: 'reading-empty', textContent: 'Nothing attached. Open a document, or add a file, and the assistant can read it.' }));
}
$('session-add').onclick = async () => {
  const pick = $('session-pick');
  pick.hidden = !pick.hidden;
  if (pick.hidden) return;
  $('pick-q').value = '';
  await renderPick();
  $('pick-q').focus();
};
$('pick-q').oninput = () => renderPick();
const iconOf = (appId) => {
  const a = appInfo(appId);
  const ico = el('i', { textContent: a.name[0] });
  ico.style.cssText = `background:${a.color};width:14px;height:14px;border-radius:4px;display:grid;place-items:center;font-style:normal;font-size:8px;font-weight:700;color:#fff;flex:none`;
  return [a, ico];
};
async function workspaceFiles(q) {
  const have = new Set(session.files.map((f) => f.abs));
  return (await api.files()).filter((f) => !have.has(f.abs) && (!q || f.name.toLowerCase().includes(q)));
}
async function renderPick() {
  const files = await workspaceFiles($('pick-q').value.trim().toLowerCase());
  const list = $('pick-list');
  list.textContent = '';
  if (!files.length) return list.append(el('div', { className: 'pick-empty', textContent: $('pick-q').value ? 'No matching files.' : 'No more files in the workspace.' }));
  for (const f of files.slice(0, 40)) {
    const [a, ico] = iconOf(f.apps[0]);
    const b = el('button', { className: 'pick-item' }, ico, el('span', { textContent: f.name }), el('small', { textContent: a.name }));
    b.onclick = async () => {
      await api.session.add(f.abs);
      $('session-pick').hidden = true;
    };
    list.append(b);
  }
}
api.on('ui:session', (s) => ((session = s), renderReading()));

// ----- "@" in the message: pick a file to add -----
let mention = null;
const closeMention = () => ((mention = null), ($('mention').hidden = true));
async function renderMention() {
  if (!mention) return;
  const files = (await workspaceFiles(mention.query)).slice(0, 7);
  if (!mention) return;
  mention.items = files;
  mention.sel = Math.min(mention.sel, Math.max(0, files.length - 1));
  const box = $('mention');
  box.textContent = '';
  box.hidden = false;
  if (!files.length) return box.append(el('div', { className: 'pick-empty', textContent: 'No matching files.' }));
  files.forEach((f, i) => {
    const [a, ico] = iconOf(f.apps[0]);
    const b = el('button', { className: 'pick-item' + (i === mention.sel ? ' sel' : '') }, ico, el('span', { textContent: f.name }), el('small', { textContent: a.name }));
    b.onmousedown = (e) => (e.preventDefault(), chooseMention(f));
    box.append(b);
  });
}
async function chooseMention(f) {
  const input = $('ai-in');
  const end = input.selectionStart;
  input.value = input.value.slice(0, mention.at) + input.value.slice(end);
  input.setSelectionRange(mention.at, mention.at);
  closeMention();
  await api.session.add(f.abs);
  input.focus();
}
function onInput() {
  const input = $('ai-in');
  const before = input.value.slice(0, input.selectionStart);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return closeMention();
  mention = { at: before.length - m[2].length - 1, query: m[2].toLowerCase(), sel: 0, items: [] };
  renderMention();
}

// ----- what the assistant is told -----
const FILE_HELP = [
  'When the person asks you to create a document, deck or spreadsheet, write it as a file block, using FOUR backticks, like this:',
  '````atelier:docx Report name.docx',
  '(the whole document in Markdown: # headings, paragraphs, - lists, tables, **bold**)',
  '````',
  'Kinds: docx (Markdown document), pptx (a designed slide deck, described below), xlsx (one "## Sheet: Name" section per sheet, each a Markdown table or CSV; a value starting with = is a formula), csv.',
  '',
  'Slides (pptx) are Markdown. Slides are separated by a line containing only ---. Optionally begin with a header block of "theme: ocean" (themes: slate, ocean, forest, sunset, violet, rose, mono, midnight), "accent: #0077B6" and "footer: text", then ---. Every slide starts with "# Title" and may have a first line "layout: name". Layouts:',
  '- title: the first slide; "# Title" then a subtitle line.',
  '- section: "# 02 Heading" then one line.',
  '- bullets (default): "# Title" then "- point" lines.',
  '- two-column: "## Left heading" with bullets, then "## Right heading" with bullets.',
  '- cards: "## Card title" and a short sentence, 3 to 6 cards.',
  '- stats: up to 4 lines like "- 81% | Pass rate".',
  '- chart: a line "type: bar" (bar, line, pie, doughnut or area), "# Title", then a Markdown table whose first column holds the labels; bullets after it are shown beside the chart.',
  '- table: "# Title" then a Markdown table.',
  '- timeline: up to 6 lines like "- 2019 | What happened".',
  '- quote: "> The quote" then a line "— Name".',
  '- closing: the last slide, like the title slide.',
  'Design like a professional: one idea per slide; titles state the point, not the topic; at most 5 bullets of under 12 words; when the content is numbers, comparisons or steps, use stats, a chart, cards or a timeline instead of bullets; vary the layouts and never use the same one three times in a row; start with a title slide and end with a closing slide; put the detail for the speaker in a final line "Notes: ...".',
  '',
  '',
  'Only create a file when asked. The person saves it with a button, so never say it is already saved. Outside file blocks, answer normally and briefly.',
].join('\n');
// Only when the open document is a Markdown file or a form: changes it directly, with a preview and Undo.
const EDIT_HELP = [
  '',
  'Changing the open document. When the person asks you to change the Markdown file or the form they have open (reword, fix, add, remove), do not write a new file: write ONE edit block, with a short sentence before it:',
  '````atelier:edit',
  '{"summary":"Tighten the introduction","ops":[{"op":"replace","find":"the exact old text","with":"the new text"}]}',
  '````',
  'Markdown steps: replace {find, with}, insert_after {find, text}, insert_before {find, text}, append {text}, prepend {text}, set_all {text}. "find" must be copied exactly from the document and be long enough to be unique.',
  'Form steps (question numbers are the Q numbers in the document text): set {fields:{title, description, passMark, timeLimit, shuffle, showScore, thankYou, kind, anonymous, closeAt}}, add_questions {questions:[...], after: n}, update_question {index: n, q, options, answer, points, type, accepted}, remove_question {index: n}. Questions use the same compact format as a new quiz.',
  'The person presses Apply to make the change and can undo it.',
].join('\n');
const ASK_HELP = [
  '',
  'Asking first. When the request leaves out something that would change the result (the audience, length, tone, which file, what kind of questions), ask before you start. Write ONE block, with at most one short sentence before it and nothing after it:',
  '````atelier:ask',
  '{"questions":[{"q":"Who is the audience?","options":["Students","Executives","General readers"]},{"q":"Which tone?","options":["Formal","Friendly"]}]}',
  '````',
  'At most 3 questions with 2 to 5 short options each ("multi":true lets the person pick several). Do not ask when the request is clear, when the answer is already in the conversation, or when you have already asked once for this task. Then do the work.',
  'Plans. Before a job that creates several files or takes many steps, show the plan in one block and wait for the person to confirm:',
  '````atelier:plan',
  '{"title":"Quarterly review pack","steps":["Read the sales workbook","Write the summary report","Build a 10-slide deck"]}',
  '````',
  'When the person replies "Go ahead", carry out the plan.',
].join('\n');

// ----- blocks the assistant writes: files, questions and plans -----
const FILE_RE4 = /````+[ \t]*atelier:(docx|pptx|xlsx|md|csv|form)[ \t]+([^\n]+)\n([\s\S]*?)\n````+/g;
const FILE_RE3 = /```[ \t]*atelier:(docx|pptx|xlsx|md|csv|form)[ \t]+([^\n]+)\n([\s\S]*?)\n```(?!`)/g;
const BLOCK_RE4 = /````+[ \t]*atelier:(ask|plan|edit)[ \t]*\n([\s\S]*?)\n````+/g;
const BLOCK_RE3 = /```[ \t]*atelier:(ask|plan|edit)[ \t]*\n([\s\S]*?)\n```(?!`)/g;
function splitFiles(content) {
  const files = [];
  const mark = () => `\n[[file:${files.length - 1}]]\n`;
  const takeFile = (_m, kind, name, body) => (files.push({ kind, name: name.trim(), body }), mark());
  const takeBlock = (_m, kind, body) => (files.push({ kind, name: '', body }), mark());
  let text = content.replace(FILE_RE4, takeFile);
  if (!files.length) text = text.replace(FILE_RE3, takeFile);
  const had = files.length;
  text = text.replace(BLOCK_RE4, takeBlock);
  if (files.length === had) text = text.replace(BLOCK_RE3, takeBlock);
  return { text, files };
}
// While a reply is still streaming, a block that has not closed yet is hidden (it is shown as a step).
function hideOpenBlock(text) {
  const open = [...text.matchAll(/`{3,}[ \t]*atelier:\w+/g)].pop();
  if (!open) return text;
  return /\n`{3,}(?!\w)/.test(text.slice(open.index + open[0].length)) ? text : text.slice(0, open.index).trimEnd();
}
const KIND_APP = { docx: 'documents', pptx: 'presentation', xlsx: 'spreadsheet', csv: 'spreadsheet' };
function fileCard(m, f, i) {
  const a = appInfo(KIND_APP[f.kind]);
  const made = (m.created ||= {})[i];
  const ico = el('div', { className: 'fico', textContent: f.kind.toUpperCase().slice(0, 4) });
  ico.style.background = a.color;
  ico.style.fontSize = '9px';
  const info = el('div', { className: 'finfo' }, el('b', { textContent: f.name }), el('small', { className: made?.error ? 'bad' : '', textContent: made?.error || (made ? 'Saved to your workspace' : `${f.kind.toUpperCase()} · ${f.body.length.toLocaleString()} characters`) }));
  const btns = el('div', { className: 'fbtns' });
  if (made && !made.error) {
    const open = el('button', { className: 'btn primary', textContent: 'Open' });
    open.onclick = () => api.open(made.abs, made.app);
    const show = el('button', { className: 'btn', textContent: 'Show' });
    show.onclick = () => api.reveal(made.abs);
    btns.append(open, show);
  } else {
    const create = el('button', { className: 'btn primary', textContent: made?.error ? 'Retry' : 'Create file' });
    create.onclick = async () => {
      create.disabled = true;
      create.textContent = 'Creating…';
      const r = await api.createFile({ kind: f.kind, name: f.name, body: f.body });
      m.created[i] = r.ok ? r : { error: r.message };
      renderLog();
    };
    btns.append(create);
  }
  return el('div', { className: 'filecard' }, ico, info, btns);
}

function parseJson(body) {
  try {
    return JSON.parse(body.trim());
  } catch {
    return null;
  }
}
// A short set of questions with buttons for the answers.
function askCard(m, f, i, active) {
  const d = parseJson(f.body) || {};
  const qs = (d.questions || (d.q || d.question ? [d] : []))
    .map((q) => ({ q: String(q.q || q.question || ''), options: (q.options || q.choices || []).map(String).slice(0, 8), multi: !!q.multi }))
    .filter((q) => q.q);
  if (!qs.length) return el('div', { className: 'msg err', textContent: 'The assistant asked a question that could not be shown.' });
  const st = ((m.answers ||= {})[i] ||= { picks: qs.map(() => []), other: qs.map(() => ''), sent: false });
  const card = el('div', { className: 'askcard' + (st.sent ? ' done' : '') });
  card.append(el('div', { className: 'ask-head', textContent: st.sent ? 'Your answers' : 'Before I start' }));
  const ready = () => qs.every((_q, k) => st.picks[k].length || st.other[k].trim());
  let go;
  qs.forEach((q, k) => {
    const row = el('div', { className: 'ask-q' }, el('div', { className: 'ask-t', textContent: q.q }));
    const opts = el('div', { className: 'ask-opts' });
    q.options.forEach((o) => {
      const b = el('button', { className: 'ask-opt' + (st.picks[k].includes(o) ? ' on' : ''), textContent: o, disabled: st.sent || !active });
      b.onclick = () => {
        const has = st.picks[k].includes(o);
        st.picks[k] = q.multi ? (has ? st.picks[k].filter((x) => x !== o) : [...st.picks[k], o]) : has ? [] : [o];
        if (!q.multi) st.other[k] = '';
        renderLog();
      };
      opts.append(b);
    });
    row.append(opts);
    if (!st.sent && active) {
      const other = el('input', { className: 'ask-other', placeholder: 'Something else…', value: st.other[k] });
      other.oninput = () => {
        st.other[k] = other.value;
        if (other.value && !q.multi) st.picks[k] = [];
        if (go) go.disabled = !ready();
      };
      row.append(other);
    } else if (st.other[k].trim()) row.append(el('div', { className: 'ask-opts' }, el('button', { className: 'ask-opt on', disabled: true, textContent: st.other[k].trim() })));
    card.append(row);
  });
  if (!st.sent) {
    if (!active) card.append(el('div', { className: 'ask-skipped', textContent: 'Skipped' }));
    else {
      go = el('button', { className: 'btn primary', textContent: 'Continue', disabled: !ready() });
      go.onclick = () => {
        st.sent = true;
        const lines = qs.map((q, k) => `- ${q.q} ${[...st.picks[k], st.other[k].trim()].filter(Boolean).join(', ')}`);
        submit('My answers:\n' + lines.join('\n'));
      };
      card.append(el('div', { className: 'ask-foot' }, go));
    }
  }
  return card;
}
// A change to the open Markdown file or form: what it will do, then Apply, then Undo.
function editCard(m, f, i) {
  const d = parseJson(f.body) || {};
  const ops = Array.isArray(d.ops) ? d.ops : [];
  if (!ops.length) return el('div', { className: 'msg err', textContent: 'The assistant proposed a change that could not be shown.' });
  const st = ((m.answers ||= {})[i] ||= { state: 'new', message: '' });
  const card = el('div', { className: 'askcard edit' + (st.state === 'applied' ? ' done' : '') });
  card.append(el('div', { className: 'ask-head', textContent: d.summary ? 'Change · ' + d.summary : 'Change to this document' }));
  const list = el('ul', { className: 'edit-ops' });
  const short = (s) => String(s ?? '').replace(/\s+/g, ' ').slice(0, 90);
  for (const o of ops.slice(0, 12)) {
    const li = el('li');
    if (o.op === 'replace') li.append(el('del', { textContent: short(o.find) }), ' → ', el('ins', { textContent: short(o.with ?? o.text) }));
    else if (o.op === 'insert_after' || o.op === 'insert_before') li.append((o.op === 'insert_after' ? 'After “' : 'Before “') + short(o.find) + '” add ', el('ins', { textContent: short(o.text) }));
    else if (o.op === 'append' || o.op === 'prepend') li.append((o.op === 'append' ? 'Add at the end: ' : 'Add at the start: '), el('ins', { textContent: short(o.text) }));
    else if (o.op === 'set_all') li.append('Replace the whole document');
    else if (o.op === 'set') li.append('Set ' + Object.keys(o.fields || {}).join(', '));
    else if (o.op === 'add_questions') li.append(`Add ${(o.questions || []).length} question${(o.questions || []).length === 1 ? '' : 's'}`);
    else if (o.op === 'update_question') li.append(`Change question ${o.index}`);
    else if (o.op === 'remove_question') li.append(`Remove question ${o.index}`);
    else li.append(String(o.op));
    list.append(li);
  }
  card.append(list);
  if (st.state === 'new' || st.state === 'failed') {
    if (st.message) card.append(el('div', { className: 'ask-skipped bad', textContent: st.message }));
    const go = el('button', { className: 'btn primary', textContent: st.state === 'failed' ? 'Try again' : 'Apply' });
    go.onclick = async () => {
      go.disabled = true;
      const r = await api.applyEdit(ops);
      st.state = r?.ok ? 'applied' : 'failed';
      st.message = r?.message || (r?.ok ? 'Done.' : 'The change could not be made.');
      renderLog();
    };
    card.append(el('div', { className: 'ask-foot' }, go));
  } else if (st.state === 'applied') {
    card.append(el('div', { className: 'ask-skipped', textContent: st.message }));
    const undo = el('button', { className: 'btn', textContent: 'Undo' });
    undo.onclick = async () => {
      await api.undoEdit();
      st.state = 'undone';
      st.message = 'Undone.';
      renderLog();
    };
    card.append(el('div', { className: 'ask-foot' }, undo));
  } else card.append(el('div', { className: 'ask-skipped', textContent: st.message }));
  return card;
}
// The plan, with a button to go ahead.
function planCard(m, f, i, active) {
  const d = parseJson(f.body) || {};
  const steps = (d.steps || []).map(String).slice(0, 12);
  if (!steps.length) return el('div', { className: 'msg err', textContent: 'The assistant wrote a plan that could not be shown.' });
  const st = ((m.answers ||= {})[i] ||= { sent: false });
  const card = el('div', { className: 'askcard plan' + (st.sent ? ' done' : '') });
  card.append(el('div', { className: 'ask-head', textContent: d.title ? 'Plan · ' + d.title : 'Plan' }));
  const ol = el('ol', { className: 'plan-steps' });
  steps.forEach((s) => ol.append(el('li', { textContent: s })));
  card.append(ol);
  if (st.sent) card.append(el('div', { className: 'ask-skipped', textContent: 'Approved' }));
  else if (active) {
    const go = el('button', { className: 'btn primary', textContent: 'Go ahead' });
    go.onclick = () => ((st.sent = true), submit('Go ahead with this plan.'));
    const change = el('button', { className: 'btn', textContent: 'Change it' });
    change.onclick = () => {
      $('ai-in').placeholder = 'What should change in the plan?';
      $('ai-in').focus();
    };
    card.append(el('div', { className: 'ask-foot' }, go, change));
  }
  return card;
}

async function loadAi() {
  aiSettings = await api.ai.settings();
  $('ai-prov').textContent = PROVIDER_NAMES[aiSettings.provider] || aiSettings.provider;
  $('ai-agent-row').hidden = !isCli(aiSettings.provider);
  // Small local models rarely follow the question protocol, so it starts off for them.
  $('ai-ask').checked = store.get('ai.ask', aiSettings.provider !== 'local');
  if (!history.length) renderLog();
}
$('ai-ask').onchange = (e) => store.set('ai.ask', e.target.checked);

// A very small markdown subset: fenced code and line breaks, everything escaped.
function fmt(text) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return text
    .split(/```/)
    .map((part, i) => (i % 2 ? '<pre>' + esc(part.replace(/^\w*\n/, '')) + '</pre>' : esc(part)))
    .join('');
}

// ----- what the person is looking at in the app -----
const QUICK_SELECTION = ['Explain this', 'Improve the writing', 'Make it shorter', 'Fix grammar and spelling'];
const QUICK_MULTI = ['Combine these into one document', 'Summarize all of them', 'Compare these documents', 'Build a slide deck from these'];
const QUICK_DOCUMENT = ['Summarize this', 'List the key points', 'Find problems or gaps', 'Suggest improvements'];
const QUICK_FORMS = ['Add 5 more questions', 'Check the answer keys', 'Make it harder', 'Write feedback for wrong answers'];
let polling = false;
async function refreshCtx() {
  if (!open || polling) return;
  polling = true;
  let c = { app: 'home' };
  try {
    c = (await api.context({ withContent: false })) || c;
  } catch {
    /* app busy */
  }
  polling = false;
  const sig = JSON.stringify([c.app, c.file?.abs, !!c.selection?.trim(), c.selection?.trim().length, (c.others || []).map((o) => o.abs)]);
  ctxNow = c;
  openOthers = c.others || [];
  if (sig !== refreshCtx.sig) {
    refreshCtx.sig = sig;
    renderReading();
  }
  // These apps have an assistant of their own that changes the open document with tools, on the same AI.
  $('ai-edit').hidden = !['documents', 'presentation', 'spreadsheet'].includes(c.app);
  const quick = $('ai-quick');
  const hasApp = c.app !== 'home' && (c.selection || c.file || c.app === 'markdown' || c.app === 'notes');
  const multi = openOthers.length + session.files.length > 0;
  quick.hidden = !hasApp && !multi;
  if (!hasApp && !multi) return;
  const sel = c.selection?.trim();
  const prompts = sel ? QUICK_SELECTION : c.app === 'forms' ? QUICK_FORMS : multi ? QUICK_MULTI : QUICK_DOCUMENT;
  const key = prompts.join('|');
  if (quick.dataset.key !== key) {
    quick.dataset.key = key;
    quick.textContent = '';
    for (const p of prompts) {
      const b = el('button', { textContent: p });
      b.onclick = () => submit(p);
      quick.append(b);
    }
  }
}
setInterval(refreshCtx, 2000);
window.addEventListener('focus', refreshCtx);

async function buildContext() {
  // The open document (when its chip is on) and the other documents the person has switched on.
  const useApp = useCurrent;
  let c;
  try {
    // A local model has a small context window: send less.
    c = await api.context({ withContent: true, session: true, limit: aiSettings?.provider === 'local' ? 18000 : 60000, exclude: [...excluded] });
  } catch {
    return { text: '', label: '', labels: [] };
  }
  c ||= { app: 'home' };
  const parts = [];
  const labels = [];
  if (useApp && c.app !== 'home') {
    const sel = c.selection?.trim();
    parts.push(`The person is working in the ${c.appName} app` + (c.file ? ` on the file "${c.file.name}"` : '') + '. Use the context below to answer.');
    if (sel) parts.push('Selected text:\n"""\n' + sel + '\n"""');
    if (c.content) parts.push(`${sel ? 'The surrounding document' : 'Document text'}${c.truncated ? ' (truncated)' : ''}:\n"""\n${c.content}\n"""`);
    if (c.error) parts.push('(' + c.error + ')');
    if (c.file?.rel) parts.push(`File path in the workspace: ${c.file.rel}`);
    labels.push(sel ? `Selection from ${c.file?.name || c.appName}` : c.file?.name || c.appName);
  }
  const docs = (c.session || []).filter((d) => d.content || d.error);
  if (docs.length) {
    parts.push(
      'Other documents the person has in this session (use them when asked to combine, compare or draw from several documents):\n' +
        docs.map((d) => `--- ${d.name} (${d.app})${d.rel ? ' [workspace path: ' + d.rel + ']' : ''}${d.truncated ? ' (truncated)' : ''} ---\n${d.error ? '(could not be read: ' + d.error + ')' : d.content}`).join('\n\n'),
    );
    labels.push(...docs.map((d) => d.name));
  }
  if (!parts.length) return { text: '', label: '', labels: [] };
  const label = labels.length > 3 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more` : labels.join(', ');
  return { text: parts.join('\n\n'), label, labels };
}

// ----- the log -----
function stepRows(m, live) {
  const box = el('div', { className: 'steps' + (live ? ' live' : '') });
  const steps = m.steps || [];
  const head = el('button', { className: 'steps-head' });
  const doing = steps.find((s) => s.state === 'running');
  head.append(el('span', { className: 'steps-title', textContent: live ? doing?.label || 'Working…' : `Worked through ${steps.length} step${steps.length === 1 ? '' : 's'}` }), el('span', { className: 'steps-chev', textContent: m.stepsOpen || live ? '▾' : '▸' }));
  head.onclick = () => ((m.stepsOpen = !m.stepsOpen), renderLog());
  box.append(head);
  if (m.stepsOpen || live) {
    const ul = el('ul');
    for (const s of steps) {
      const ic = el('span', { className: 'st-ic ' + s.state, textContent: s.state === 'done' ? '✓' : s.state === 'error' ? '✕' : '' });
      ul.append(el('li', { className: s.state }, ic, el('span', { textContent: s.label })));
    }
    box.append(ul);
  }
  if (live) {
    const stop = el('button', { className: 'steps-stop', textContent: 'Stop' });
    stop.onclick = () => running?.cancel();
    box.append(stop);
  }
  return box;
}
function thinkEl(m) {
  const d = el('details', { className: 'think' });
  d.open = !!m.thinkOpen;
  d.ontoggle = () => (m.thinkOpen = d.open);
  const secs = m.thinkMs ? Math.max(1, Math.round(m.thinkMs / 1000)) : 0;
  d.append(el('summary', { textContent: m.thinkMs ? `Thought for ${secs}s` : 'Thinking…' }), el('div', { className: 'think-body', textContent: m.thinking.trim() }));
  return d;
}

function renderLog() {
  const log = $('ai-log');
  const keep = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.textContent = '';
  if (!history.length) {
    const none = !aiSettings || aiSettings.provider === 'none';
    const box = el('div', { className: 'ai-empty' });
    box.innerHTML = none ? '<b>Set up your AI</b>Choose Claude Code, Codex, or add an API key.' : '<b>How can I help?</b>Ask about the document you have open, add files with @, or ask for a new document, deck, sheet or quiz.';
    if (none) {
      const go = el('button', { className: 'btn primary', textContent: 'Open AI settings' });
      go.style.marginTop = '12px';
      go.onclick = () => api.openSettings('ai');
      box.append(el('br'), go);
    }
    log.append(box);
    return;
  }
  const last = history[history.length - 1];
  history.forEach((m) => {
    const live = !!running && m === last && m.role === 'assistant';
    const settled = !live;
    if (m.role === 'assistant') {
      if (m.steps?.length) log.append(stepRows(m, live));
      if (m.thinking?.trim()) log.append(thinkEl(m));
    }
    const raw = m.role === 'assistant' && !m.error && !settled ? hideOpenBlock(m.content || '') : m.content || '';
    const { text, files } = m.role === 'assistant' && !m.error ? splitFiles(raw) : { text: raw, files: [] };
    // The words around the blocks, then a card for each one.
    const pieces = files.length ? text.split(/\n\[\[file:(\d+)\]\]\n/) : [text];
    pieces.forEach((piece, idx) => {
      if (idx % 2 === 0) {
        if (!piece.trim() && (idx > 0 || live || files.length)) return;
        const d = el('div', { className: 'msg ' + (m.role === 'user' ? 'user' : m.error ? 'err' : 'bot') });
        d.innerHTML = (idx === 0 && m.label ? `<span class="attach">📎 ${fmt(m.label)}</span>` : '') + fmt(piece.trim() || '…');
        log.append(d);
      } else {
        const n = Number(piece);
        const f = files[n];
        const active = m === last && settled;
        log.append(f.kind === 'ask' ? askCard(m, f, n, active) : f.kind === 'plan' ? planCard(m, f, n, active) : f.kind === 'edit' ? editCard(m, f, n) : fileCard(m, f, n));
      }
    });
    if (m.role === 'assistant' && !m.error && m.content && settled && !files.some((f) => f.kind === 'ask' || f.kind === 'plan') ) {
      const cp = el('button', { className: 'copy', textContent: 'Copy' });
      cp.onclick = () => (navigator.clipboard.writeText(m.content), (cp.textContent = 'Copied'));
      log.append(cp);
    }
  });
  if (keep) log.scrollTop = log.scrollHeight;
}
function setSending(on) {
  const s = $('ai-send');
  s.textContent = on ? '■' : '➤';
  s.classList.toggle('stop', on);
  s.setAttribute('aria-label', on ? 'Stop' : 'Send');
}

// Steps the assistant is going through. Some come from the provider (Claude Code names each tool it
// uses); the rest are derived from what has streamed so far.
function setStep(m, id, label, state) {
  m.steps ||= [];
  const s = m.steps.find((x) => x.id === id);
  if (s) {
    if (label) s.label = label;
    if (state) s.state = state;
  } else m.steps.push({ id, label: label || id, state: state || 'running' });
}
function syncBlocks(m) {
  const re = /`{3,}[ \t]*atelier:(\w+)[ \t]*([^\n]*)/g;
  let n = 0;
  for (const b of (m.content || '').matchAll(re)) {
    const closed = /\n`{3,}(?!\w)/.test(m.content.slice(b.index + b[0].length));
    const kind = b[1];
    const label = kind === 'ask' ? 'Preparing questions' : kind === 'plan' ? 'Drafting a plan' : kind === 'edit' ? 'Preparing the changes' : `Writing ${b[2].trim() || 'a ' + kind + ' file'}`;
    setStep(m, 'blk' + n++, label, closed ? 'done' : 'running');
  }
}
function settleThinking(m) {
  if (m.thinkStart && !m.thinkMs) m.thinkMs = Date.now() - m.thinkStart;
  setStep(m, 'think', m.thinking ? 'Thought it through' : 'Thinking', 'done');
}

async function send() {
  if (running) return running.cancel();
  const input = $('ai-in');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.placeholder = 'Ask anything. Type @ to add a file.';
  await submit(text);
}
async function submit(text) {
  if (running) return;
  if (!aiSettings || aiSettings.provider === 'none') return api.openSettings('ai');
  closeMention();
  const ctx = await buildContext();
  history.push({ role: 'user', content: text, label: ctx.label });
  const reply = { role: 'assistant', content: '', steps: [], thinking: '', stepsOpen: false };
  history.push(reply);
  if (ctx.labels.length) setStep(reply, 'read', 'Read ' + (ctx.labels.length > 2 ? `${ctx.labels.length} documents` : ctx.labels.join(' and ')), 'done');
  setStep(reply, 'think', 'Thinking', 'running');
  const messages = [
    { role: 'system', content: 'You are the assistant built into Atelier, a workspace with Documents, Presentation, Spreadsheet and PDF apps. Be concise and practical.\n\n' + FILE_HELP + (['markdown', 'forms'].includes(ctxNow.app) && useCurrent ? EDIT_HELP : '') + ($('ai-ask').checked ? ASK_HELP : '') + (ctx.text ? '\n\n' + ctx.text : '') },
    ...history.filter((m) => m !== reply && !m.error).map(({ role, content }) => ({ role, content })),
  ];
  setSending(true);
  const agent = $('ai-agent').checked && isCli(aiSettings.provider);
  running = api.ai.chat({ messages, options: { agent } }, (ev) => {
    if (ev.type === 'text') {
      if (!reply.content) (settleThinking(reply), setStep(reply, 'write', 'Writing the reply', 'running'));
      reply.content += ev.text;
      syncBlocks(reply);
    } else if (ev.type === 'thinking') {
      reply.thinkStart ||= Date.now();
      reply.thinking += ev.text;
    } else if (ev.type === 'step') {
      settleThinking(reply);
      setStep(reply, 'p:' + ev.id, ev.label, ev.state);
    } else if (ev.type === 'error') {
      reply.error = true;
      reply.content = (reply.content ? reply.content + '\n\n' : '') + ev.message;
      return finish();
    } else if (ev.type === 'end') return finish();
    renderLog();
  });
  renderLog();
  function finish() {
    running = null;
    setSending(false);
    settleThinking(reply);
    for (const s of reply.steps) if (s.state === 'running') s.state = reply.error ? 'error' : 'done';
    // A plain answer needs no list of steps; keep it when there was real work to show.
    const worked = reply.thinking.trim() || reply.steps.some((s) => s.id.startsWith('p:') || s.id.startsWith('blk'));
    reply.steps = worked ? reply.steps.filter((s) => s.id !== 'think' || reply.thinking.trim()) : [];
    const w = reply.steps.find((s) => s.id === 'write');
    if (w) w.label = 'Wrote the reply';
    if (!reply.content) reply.content = '(no reply)';
    renderLog();
  }
}

$('ai-send').onclick = send;
$('ai-in').oninput = onInput;
$('ai-in').onkeydown = (e) => {
  if (mention && !$('mention').hidden) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = mention.items.length || 1;
      mention.sel = (mention.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      return renderMention();
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && mention.items[mention.sel]) return (e.preventDefault(), chooseMention(mention.items[mention.sel]));
    if (e.key === 'Escape') return (e.preventDefault(), closeMention());
  }
  if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), send());
};
$('ai-in').onblur = () => setTimeout(closeMention, 120);
$('ai-edit').onclick = async () => {
  const ok = await api.openAppAssistant();
  if (!ok) $('ai-edit').textContent = 'Open the Assistant from the app’s own ribbon';
};
$('ai-close').onclick = () => api.toggleAi();
$('ai-cfg').onclick = () => api.openSettings('ai');
$('ai-new').onclick = () => {
  running?.cancel();
  history = [];
  renderLog();
};
api.on('ui:ai-open', (state) => {
  open = !!state;
  if (open) {
    loadAi();
    refreshCtx();
    setTimeout(() => $('ai-in').focus(), 60);
  }
});
api.on('ui:ai-changed', loadAi);
api.info().then((i) => ((appsInfo = i.apps), renderReading()));
api.session.get().then((s) => ((session = s), renderReading()));
renderReading();
loadAi();
