// Slide Markdown -> a designed .pptx. The assistant writes plain Markdown with a few
// directives (layout, theme); this file does the design: colours, type scale, spacing,
// native charts and tables, so every slide is laid out properly whatever model wrote it.
//
//   theme: ocean              (optional header: theme, font, accent, footer)
//   ---
//   layout: stats
//   # Title
//   - 68% | Pass rate
//   Notes: speaker notes
const PptxGenJS = require("pptxgenjs");

let markedLib;
async function lexer(md) {
  markedLib ??= await import("marked");
  return markedLib.marked.lexer(md);
}
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const decode = (s) => String(s ?? "").replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENT[m] ?? m);
const plain = (tokens = []) =>
  tokens
    .map((t) => (t.tokens?.length ? plain(t.tokens) : t.type === "br" ? " " : decode(t.text ?? t.raw ?? "")))
    .join("")
    .trim();

// ---------------------------------------------------------------- themes
const THEMES = {
  slate: { dark: "1E293B", bg: "FFFFFF", surface: "F1F5F9", line: "E2E8F0", text: "0F172A", muted: "64748B", accent: "4F46E5", accent2: "0EA5E9" },
  ocean: { dark: "0B2545", bg: "FFFFFF", surface: "EEF5FB", line: "D6E4F0", text: "0B2545", muted: "5B7089", accent: "0077B6", accent2: "00B4D8" },
  forest: { dark: "14352A", bg: "FFFFFF", surface: "EFF6F1", line: "D5E5DB", text: "14352A", muted: "5E7A6B", accent: "2D7A4F", accent2: "95C11F" },
  sunset: { dark: "3B1F2B", bg: "FFFBF7", surface: "FDF0E6", line: "F3DCC8", text: "3B1F2B", muted: "86655F", accent: "E4572E", accent2: "F3A712" },
  violet: { dark: "231942", bg: "FFFFFF", surface: "F3F0FA", line: "E0D9F2", text: "231942", muted: "6B6489", accent: "7B2CBF", accent2: "E0479E" },
  rose: { dark: "3A0F26", bg: "FFFFFF", surface: "FDF0F5", line: "F5D7E3", text: "3A0F26", muted: "8A5B70", accent: "D6336C", accent2: "F59F00" },
  mono: { dark: "111111", bg: "FFFFFF", surface: "F4F4F5", line: "E4E4E7", text: "18181B", muted: "71717A", accent: "18181B", accent2: "71717A" },
  midnight: { dark: "0B1020", bg: "0F172A", surface: "1E293B", line: "334155", text: "E2E8F0", muted: "94A3B8", accent: "38BDF8", accent2: "A78BFA", night: true },
};
const hex = (c, fallback) => (/^#?[0-9a-f]{6}$/i.test(String(c || "").trim()) ? String(c).trim().replace("#", "").toUpperCase() : fallback);
const mix = (a, b, t) => {
  const p = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
};

// ---------------------------------------------------------------- geometry
const W = 13.333;
const H = 7.5;
const MX = 0.75;
const CW = W - MX * 2;
const TOP = 1.75; // where content starts under the title
const BOTTOM = 6.85;

// The biggest font size (within [min, max]) at which the paragraphs fit the box: a rough
// estimate of wrapped lines, so long text shrinks instead of spilling off the slide.
function fitFont(paras, w, h, max, min, gap = 0.45) {
  for (let s = max; s >= min; s--) {
    const cpl = Math.max(6, Math.floor((w * 72) / (s * 0.5)));
    let lines = 0;
    for (const p of paras) lines += Math.max(1, Math.ceil(String(p).length / cpl));
    if ((lines * s * 1.2) / 72 + (paras.length * gap * s) / 72 <= h) return s;
  }
  return min;
}

// The height those paragraphs take at a given size (same estimate as fitFont).
function needH(paras, w, s, gap = 0.45) {
  const cpl = Math.max(6, Math.floor((w * 72) / (s * 0.5)));
  let lines = 0;
  for (const p of paras) lines += Math.max(1, Math.ceil(String(p).length / cpl));
  return (lines * s * 1.2) / 72 + (paras.length * gap * s) / 72;
}

// ---------------------------------------------------------------- parsing
function inlineRuns(tokens = [], base = {}) {
  const out = [];
  for (const t of tokens) {
    if (t.type === "strong") out.push(...inlineRuns(t.tokens, { ...base, bold: true }));
    else if (t.type === "em") out.push(...inlineRuns(t.tokens, { ...base, italic: true }));
    else if (t.type === "codespan") out.push({ text: decode(t.text), options: { ...base, fontFace: "Consolas" } });
    else if (t.type === "link") out.push(...inlineRuns(t.tokens, base));
    else if (t.type === "br") out.push({ text: " ", options: base });
    else if (t.tokens?.length) out.push(...inlineRuns(t.tokens, base));
    else out.push({ text: decode(t.text ?? t.raw ?? ""), options: base });
  }
  return out;
}

async function parseSlide(src) {
  let text = src.replace(/\r\n/g, "\n");
  const s = { layout: "", type: "", title: "", lead: [], bullets: [], sections: [], tables: [], quote: null, notes: "" };
  // directives at the very top
  for (;;) {
    const m = /^[ \t]*(layout|type|theme)[ \t]*:[ \t]*([^\n]+)\n?/i.exec(text);
    if (!m) break;
    s[m[1].toLowerCase()] = m[2].trim().toLowerCase();
    text = text.slice(m[0].length).replace(/^\s*\n/, "");
  }
  text = text.replace(/^[ \t]*Notes?:[ \t]*([\s\S]*)$/im, (_m, n) => ((s.notes = n.trim()), ""));
  const tokens = (await lexer(text)).filter((t) => t.type !== "space");
  let cur = null;
  const bucket = () => cur || s;
  const item = (list, level, out) =>
    list.items.forEach((it) => {
      const own = it.tokens.filter((x) => x.type !== "list");
      const runs = inlineRuns(own.flatMap((x) => x.tokens ?? [x]));
      out.push({ runs, text: plain(own.flatMap((x) => x.tokens ?? [x])), level, ordered: !!list.ordered });
      it.tokens.filter((x) => x.type === "list").forEach((n) => item(n, level + 1, out));
    });
  for (const t of tokens) {
    if (t.type === "heading" && t.depth === 1 && !s.title) s.title = plain(t.tokens);
    else if (t.type === "heading") {
      cur = { title: plain(t.tokens), bullets: [], paras: [] };
      s.sections.push(cur);
    } else if (t.type === "list") item(t, 0, bucket().bullets);
    else if (t.type === "table") s.tables.push(t);
    else if (t.type === "blockquote") {
      // "— Name" on the line after the quote is the attribution, with or without a leading ">"
      const [body, ...by] = plain(t.tokens).split(/\n\s*[—–]\s*/);
      s.quote = { text: body.trim(), by: by.join(" ").trim() };
    }
    else if (t.type === "paragraph" || t.type === "text") {
      const p = plain(t.tokens ?? [t]);
      if (s.quote && !s.quote.by && /^[—–-]\s*\S/.test(p)) s.quote.by = p.replace(/^[—–-]\s*/, "");
      else (cur ? cur.paras : s.lead).push(p);
    } else if (t.type === "code") (cur ? cur.paras : s.lead).push(t.text);
  }
  return s;
}

// ---------------------------------------------------------------- building blocks
function Deck(theme, config, deckTitle) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deckTitle || "Presentation";
  pptx.author = "Atelier";
  return { pptx, T: theme, font: config.font || "Calibri", footer: config.footer || "", title: deckTitle };
}

const rect = (D, slide, x, y, w, h, fill, extra = {}) =>
  slide.addShape(extra.round ? D.pptx.ShapeType.roundRect : D.pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill, transparency: extra.transparency ?? 0 }, line: extra.line ? { color: extra.line, width: extra.lineW ?? 0.75 } : { type: "none" }, rectRadius: extra.round ? extra.round : undefined });
const dot = (D, slide, x, y, d, fill, transparency = 0) => slide.addShape(D.pptx.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: fill, transparency }, line: { type: "none" } });
const label = (D, slide, text, o) => slide.addText(text, { fontFace: D.font, margin: 0, valign: "top", ...o });

function chrome(D, slide, s, n) {
  const T = D.T;
  slide.background = { color: T.bg };
  rect(D, slide, MX, 0.5, 0.55, 0.07, T.accent);
  if (s.title) {
    const size = fitFont([s.title], CW, 0.95, 32, 22, 0.1);
    label(D, slide, s.title, { x: MX, y: 0.68, w: CW, h: 0.95, fontSize: size, bold: true, color: T.text, valign: "middle" });
  }
  label(D, slide, D.footer || D.title || "", { x: MX, y: 7.0, w: 8, h: 0.3, fontSize: 10, color: T.muted, valign: "middle" });
  label(D, slide, String(n), { x: W - MX - 1, y: 7.0, w: 1, h: 0.3, fontSize: 10, color: T.muted, align: "right", valign: "middle" });
}

function bulletParas(D, bullets, size, color) {
  const out = [];
  bullets.forEach((b) => {
    b.runs.forEach((r, i) => {
      const o = { ...r.options, fontSize: size - (b.level ? 2 : 0), color: r.options?.color || color, fontFace: D.font };
      if (i === 0) o.bullet = b.ordered ? { type: "number", color: D.T.accent } : { code: b.level ? "2013" : "25CF", color: D.T.accent };
      if (i === 0) o.indentLevel = Math.min(b.level, 3);
      if (i === b.runs.length - 1) (o.breakLine = true);
      out.push({ text: r.text, options: o });
    });
  });
  return out;
}

// ---------------------------------------------------------------- layouts
function title(D, slide, s, closing) {
  const T = D.T;
  slide.background = { color: T.dark };
  dot(D, slide, 8.6, -2.4, 7.4, T.accent, 78);
  dot(D, slide, 10.9, 4.3, 3.8, T.accent2, 72);
  const sub = [...s.lead, ...s.bullets.map((b) => b.text)].join("\n");
  // the title sits on the accent bar, the subtitle under it
  const size = fitFont([s.title || ""], 8.4, 2.3, 50, 28, 0.1);
  label(D, slide, s.title || "", { x: 0.95, y: sub ? 1.55 : 2.2, w: 8.4, h: 2.3, fontSize: size, bold: true, color: "FFFFFF", valign: "bottom" });
  rect(D, slide, 0.95, sub ? 4.05 : 4.7, 0.9, 0.09, T.accent2);
  if (sub) label(D, slide, sub, { x: 0.95, y: 4.35, w: 7.6, h: 1.6, fontSize: 22, color: mix(T.dark, "FFFFFF", 0.75), valign: "top", lineSpacingMultiple: 1.1 });
}

function section(D, slide, s) {
  const T = D.T;
  slide.background = { color: T.accent };
  dot(D, slide, 9.3, 3.6, 6.2, "FFFFFF", 90);
  const m = /^(\d{1,2})[.:)]?\s+(.+)$/.exec(s.title || "");
  const head = m ? m[2] : s.title || "";
  if (m) label(D, slide, m[1].padStart(2, "0"), { x: 0.95, y: 1.2, w: 4, h: 1.7, fontSize: 88, bold: true, color: "FFFFFF", transparency: 40 });
  const size = fitFont([head], 9.5, 1.7, 46, 28, 0.1);
  label(D, slide, head, { x: 0.95, y: 3.0, w: 9.5, h: 1.7, fontSize: size, bold: true, color: "FFFFFF", valign: "bottom" });
  const sub = [...s.lead, ...s.bullets.map((b) => b.text)].join("\n");
  if (sub) label(D, slide, sub, { x: 0.95, y: 4.95, w: 8, h: 1.2, fontSize: 22, color: "FFFFFF", valign: "top" });
}

function bullets(D, slide, s, n) {
  const T = D.T;
  chrome(D, slide, s, n);
  let y = TOP;
  const lead = s.lead.join("  ");
  if (lead) {
    const size = fitFont([lead], CW, 0.9, 20, 15, 0.1);
    label(D, slide, lead, { x: MX, y, w: CW, h: 0.9, fontSize: size, italic: true, color: T.muted });
    y += 1.0;
  }
  // sections become bold lead-ins when the slide was not given a column layout
  const items = [...s.bullets];
  s.sections.forEach((sec) => {
    items.push({ runs: [{ text: sec.title, options: { bold: true } }], text: sec.title, level: 0 });
    items.push(...sec.bullets);
    sec.paras.forEach((p) => items.push({ runs: [{ text: p, options: {} }], text: p, level: 1 }));
  });
  if (!items.length) return;
  const h = BOTTOM - y;
  const size = fitFont(items.map((b) => b.text), CW - 0.5, h, 24, 14, 0.55);
  slide.addText(bulletParas(D, items, size, T.text), { x: MX, y, w: CW, h, valign: "top", paraSpaceAfter: Math.round(size * 0.5), margin: 0, lineSpacingMultiple: 1.05 });
}

function panel(D, slide, x, y, w, h, T) {
  rect(D, slide, x, y, w, h, T.surface, { round: 0.12, line: T.line });
}

function columns(D, slide, s, n) {
  const T = D.T;
  chrome(D, slide, s, n);
  let cols = s.sections.slice(0, 3);
  if (!cols.length) cols = [{ title: "", bullets: s.bullets, paras: s.lead }];
  const gap = 0.4;
  const w = (CW - gap * (cols.length - 1)) / cols.length;
  const y = TOP;
  const avail = BOTTOM - y;
  const headH = cols.some((c) => c.title) ? 0.65 : 0;
  const texts = (c) => [...c.bullets.map((b) => b.text), ...c.paras];
  // one type size for every column, and panels only as tall as the longest one needs
  const size = Math.min(...cols.map((c) => fitFont(texts(c), w - 0.9, avail - headH - 0.55, 24, 13, 0.5)));
  const need = Math.max(...cols.map((c) => needH(texts(c), w - 0.9, size, 0.5)));
  const h = Math.min(avail, Math.max(3.4, headH + need + 0.7));
  cols.forEach((c, i) => {
    const x = MX + i * (w + gap);
    panel(D, slide, x, y, w, h, T);
    rect(D, slide, x, y, w, 0.09, i % 2 ? T.accent2 : T.accent);
    let cy = y + 0.3;
    if (c.title) {
      label(D, slide, c.title, { x: x + 0.3, y: cy, w: w - 0.6, h: 0.5, fontSize: 22, bold: true, color: i % 2 ? T.accent2 : T.accent, valign: "middle" });
      cy += 0.65;
    }
    const runs = c.paras.map((p) => ({ text: p, options: { fontSize: size, color: T.text, fontFace: D.font, breakLine: true } }));
    runs.push(...bulletParas(D, c.bullets, size, T.text));
    if (runs.length) slide.addText(runs, { x: x + 0.3, y: cy, w: w - 0.6, h: y + h - cy - 0.25, valign: "top", margin: 0, paraSpaceAfter: Math.round(size * 0.45) });
  });
}

function cards(D, slide, s, n) {
  const T = D.T;
  chrome(D, slide, s, n);
  let items = s.sections.length ? s.sections : s.bullets.map((b) => ({ title: b.text.split(/\s*[:—–|]\s*/)[0], paras: [b.text.split(/\s*[:—–|]\s*/).slice(1).join(" — ")], bullets: [] }));
  items = items.slice(0, 6);
  if (!items.length) return;
  const per = items.length <= 3 ? items.length : items.length === 4 ? 2 : 3;
  const rows = Math.ceil(items.length / per);
  const gap = 0.35;
  const w = (CW - gap * (per - 1)) / per;
  const full = (BOTTOM - TOP - gap * (rows - 1)) / rows;
  const bodyOf = (c) => [...c.paras, ...c.bullets.map((b) => b.text)];
  const bsize = Math.min(...items.map((c) => fitFont(bodyOf(c), w - 0.6, full - 1.3, 20, 12, 0.5)));
  const h = Math.min(full, Math.max(2.8, 1.35 + Math.max(...items.map((c) => needH(bodyOf(c), w - 0.6, bsize, 0.5)))));
  items.forEach((c, i) => {
    const x = MX + (i % per) * (w + gap);
    const y = TOP + Math.floor(i / per) * (h + gap);
    panel(D, slide, x, y, w, h, T);
    dot(D, slide, x + 0.3, y + 0.3, 0.55, i % 2 ? T.accent2 : T.accent);
    label(D, slide, String(i + 1), { x: x + 0.3, y: y + 0.3, w: 0.55, h: 0.55, fontSize: 16, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
    label(D, slide, c.title, { x: x + 1.05, y: y + 0.3, w: w - 1.3, h: 0.55, fontSize: fitFont([c.title], w - 1.3, 0.55, 20, 14, 0.1), bold: true, color: T.text, valign: "middle" });
    const body = bodyOf(c);
    if (body.length) label(D, slide, body.join("\n"), { x: x + 0.3, y: y + 1.1, w: w - 0.6, h: h - 1.3, fontSize: bsize, color: T.muted, paraSpaceAfter: 6 });
  });
}

function stats(D, slide, s, n) {
  const T = D.T;
  chrome(D, slide, s, n);
  const items = s.bullets.slice(0, 4).map((b) => {
    const [value, ...rest] = b.text.split(/\s*[|—–]\s*/);
    return { value: value.trim(), label: rest.join(" — ").trim() };
  });
  if (!items.length) return;
  const gap = 0.35;
  const w = (CW - gap * (items.length - 1)) / items.length;
  const h = 3.5;
  const y = TOP + 0.55;
  items.forEach((it, i) => {
    const x = MX + i * (w + gap);
    panel(D, slide, x, y, w, h, T);
    rect(D, slide, x + 0.35, y + 0.4, 0.5, 0.07, i % 2 ? T.accent2 : T.accent);
    const size = fitFont([it.value], w - 0.7, 1.3, 60, 24, 0.1);
    label(D, slide, it.value, { x: x + 0.35, y: y + 0.65, w: w - 0.7, h: 1.4, fontSize: size, bold: true, color: i % 2 ? T.accent2 : T.accent, valign: "middle" });
    label(D, slide, it.label, { x: x + 0.35, y: y + 2.15, w: w - 0.7, h: 0.95, fontSize: fitFont([it.label], w - 0.7, 0.95, 18, 12, 0.1), color: T.muted });
  });
  const note = s.lead.join("  ");
  if (note) label(D, slide, note, { x: MX, y: y + h + 0.35, w: CW, h: 0.8, fontSize: 16, italic: true, color: T.muted });
}

function quote(D, slide, s, n) {
  const T = D.T;
  slide.background = { color: T.surface };
  rect(D, slide, 0, 0, 0.28, H, T.accent);
  label(D, slide, "“", { x: 1.1, y: 0.6, w: 2, h: 2, fontSize: 150, bold: true, color: T.accent, transparency: 30, fontFace: "Georgia" });
  const text = s.quote?.text || [...s.lead, s.title].filter(Boolean).join(" ");
  const size = fitFont([text], 10.4, 3.4, 36, 20, 0.15);
  label(D, slide, text, { x: 1.4, y: 2.2, w: 10.4, h: 3.4, fontSize: size, italic: true, color: T.text, valign: "middle", fontFace: "Georgia" });
  const by = s.quote?.by || (s.quote ? s.title : "");
  if (by) label(D, slide, "— " + by, { x: 1.4, y: 5.85, w: 10, h: 0.5, fontSize: 18, bold: true, color: T.accent });
}

function statement(D, slide, s, n) {
  const T = D.T;
  chrome(D, slide, { ...s, title: "" }, n);
  const text = [s.title, ...s.lead].filter(Boolean);
  const head = text[0] || "";
  const rest = text.slice(1).join("\n");
  const size = fitFont([head], CW - 1.4, 2.4, 46, 26, 0.1);
  label(D, slide, head, { x: MX + 0.3, y: rest ? 1.5 : 2.3, w: CW - 1.4, h: 2.4, fontSize: size, bold: true, color: T.text, valign: "bottom" });
  rect(D, slide, MX + 0.3, rest ? 4.0 : 4.8, 0.9, 0.09, T.accent2);
  if (rest) label(D, slide, rest, { x: MX + 0.3, y: 4.3, w: CW - 1.6, h: 2.1, fontSize: fitFont([rest], CW - 1.6, 2.1, 24, 14, 0.4), color: T.muted });
}

function table(D, slide, s, n) {
  const T = D.T;
  chrome(D, slide, s, n);
  const t = s.tables[0];
  if (!t) return bullets(D, slide, s, n);
  const cols = t.header.length;
  const rowsN = t.rows.length + 1;
  const size = rowsN > 9 ? 12 : rowsN > 6 ? 14 : 16;
  const mkCell = (c, head, ri) => ({
    text: plain(c.tokens),
    options: { bold: head, color: head ? "FFFFFF" : T.text, fill: { color: head ? T.accent : ri % 2 ? T.surface : T.bg }, fontSize: size, fontFace: D.font, valign: "middle", margin: [0.06, 0.12, 0.06, 0.12], border: [{ type: "none" }, { type: "none" }, { type: "solid", color: T.line, pt: 0.75 }, { type: "none" }] },
  });
  const data = [t.header.map((c) => mkCell(c, true, 0)), ...t.rows.map((r, ri) => r.map((c) => mkCell(c, false, ri)))];
  slide.addTable(data, { x: MX, y: TOP, w: CW, colW: Array(cols).fill(CW / cols), rowH: Math.min(0.62, (BOTTOM - TOP) / rowsN) });
  if (s.lead.length) label(D, slide, s.lead.join("  "), { x: MX, y: BOTTOM + 0.0, w: CW, h: 0.3, fontSize: 12, italic: true, color: T.muted });
}

const CHART_TYPES = { bar: "bar", column: "bar", line: "line", pie: "pie", doughnut: "doughnut", donut: "doughnut", area: "area" };
function chart(D, slide, s, n) {
  const T = D.T;
  chrome(D, slide, s, n);
  const t = s.tables[0];
  if (!t) return bullets(D, slide, s, n);
  const kind = CHART_TYPES[s.type] || "bar";
  const labels = t.rows.map((r) => plain(r[0].tokens));
  const series = t.header.slice(1).map((h, i) => ({ name: plain(h.tokens), labels, values: t.rows.map((r) => parseFloat(String(plain(r[i + 1]?.tokens || [])).replace(/[^0-9.\-]/g, "")) || 0) }));
  if (!series.length) return bullets(D, slide, s, n);
  const side = s.bullets.length || s.lead.length;
  const cw = side ? 7.9 : CW;
  const colors = [T.accent, T.accent2, mix(T.accent, T.muted, 0.5), "F59E0B", "10B981", "EF4444"];
  const pie = kind === "pie" || kind === "doughnut";
  slide.addChart(D.pptx.ChartType[kind], pie ? [series[0]] : series, {
    x: MX, y: TOP - 0.05, w: cw, h: BOTTOM - TOP + 0.1,
    chartColors: pie ? labels.map((_, i) => colors[i % colors.length]) : colors.slice(0, series.length),
    showLegend: pie || series.length > 1, legendPos: "b", legendFontSize: 12, legendColor: T.muted, legendFontFace: D.font,
    showValue: pie || labels.length <= 8, dataLabelColor: pie ? "FFFFFF" : T.muted, dataLabelFontSize: 12, dataLabelFontFace: D.font,
    catAxisLabelColor: T.muted, catAxisLabelFontSize: 12, catAxisLabelFontFace: D.font, valAxisLabelColor: T.muted, valAxisLabelFontSize: 12, valAxisLabelFontFace: D.font,
    valGridLine: { color: T.line, size: 0.75 }, catGridLine: { style: "none" }, barGapWidthPct: 60, lineSize: 3, lineDataSymbolSize: 9, holeSize: 55,
  });
  if (side) {
    const x = MX + cw + 0.4;
    const w = CW - cw - 0.4;
    panel(D, slide, x, TOP, w, BOTTOM - TOP, T);
    const paras = [...s.lead, ...s.bullets.map((b) => b.text)];
    const size = fitFont(paras, w - 0.7, BOTTOM - TOP - 0.6, 18, 12, 0.5);
    const runs = s.lead.map((p) => ({ text: p, options: { fontSize: size, color: T.muted, italic: true, breakLine: true, fontFace: D.font } }));
    runs.push(...bulletParas(D, s.bullets, size, T.text));
    slide.addText(runs, { x: x + 0.3, y: TOP + 0.3, w: w - 0.6, h: BOTTOM - TOP - 0.6, valign: "top", margin: 0, paraSpaceAfter: 8 });
  }
}

function timeline(D, slide, s, n) {
  const T = D.T;
  chrome(D, slide, s, n);
  const items = s.bullets.slice(0, 6).map((b) => {
    const [when, ...rest] = b.text.split(/\s*[|—–]\s*/);
    return { when: when.trim(), text: rest.join(" — ").trim() };
  });
  if (!items.length) return;
  const w = CW / items.length;
  const ly = 3.9;
  rect(D, slide, MX, ly - 0.02, CW, 0.05, T.line);
  items.forEach((it, i) => {
    const x = MX + i * w;
    dot(D, slide, x + 0.02, ly - 0.17, 0.36, i % 2 ? T.accent2 : T.accent);
    dot(D, slide, x + 0.13, ly - 0.06, 0.14, T.bg);
    label(D, slide, it.when, { x, y: ly - 0.95, w: w - 0.2, h: 0.6, fontSize: fitFont([it.when], w - 0.2, 0.6, 24, 14, 0.1), bold: true, color: i % 2 ? T.accent2 : T.accent, valign: "bottom" });
    const size = fitFont([it.text], w - 0.3, 2.2, 20, 12, 0.3);
    label(D, slide, it.text, { x, y: ly + 0.45, w: w - 0.3, h: 2.4, fontSize: size, color: T.text });
  });
}

const LAYOUTS = { title: (D, sl, s) => title(D, sl, s, false), closing: (D, sl, s) => title(D, sl, s, true), section, bullets, "two-column": columns, columns, cards, stats, quote, statement, table, chart, timeline };

function pickLayout(s, i, count) {
  if (LAYOUTS[s.layout]) return s.layout;
  if (i === 0 && !s.bullets.length && !s.tables.length) return "title";
  if (s.quote) return "quote";
  if (s.tables.length) return s.type ? "chart" : "table";
  if (s.sections.length === 2 || s.sections.length === 3) return "two-column";
  if (s.sections.length > 3) return "cards";
  if (i > 0 && !s.bullets.length && /^\d{1,2}[.:)]?\s+\S/.test(s.title)) return "section";
  if (i === count - 1 && !s.bullets.length && i > 0) return "closing";
  if (!s.bullets.length && s.lead.length <= 2) return "statement";
  return "bullets";
}

// ---------------------------------------------------------------- entry
async function buildDeck(md, deckTitle) {
  const parts = String(md || "").replace(/\r\n/g, "\n").split(/^[ \t]*---[ \t]*$/m).map((p) => p.trim()).filter(Boolean);
  const config = {};
  // a header made only of "key: value" lines configures the deck
  if (parts.length && parts[0].split("\n").every((l) => !l.trim() || /^[\w-]+\s*:\s*\S/.test(l)) && !/^#/m.test(parts[0]) && /^(theme|font|accent|footer|title)\s*:/im.test(parts[0])) {
    parts.shift().split("\n").forEach((l) => {
      const m = /^([\w-]+)\s*:\s*(.+)$/.exec(l.trim());
      if (m) config[m[1].toLowerCase()] = m[2].trim();
    });
  }
  const slides = [];
  for (const p of parts) slides.push(await parseSlide(p));
  const name = config.title || slides.find((s) => s.title)?.title || deckTitle || "Presentation";
  const base = THEMES[(config.theme || slides.find((s) => s.theme)?.theme || "slate").toLowerCase()] || THEMES.slate;
  const T = { ...base };
  if (hex(config.accent)) T.accent = hex(config.accent);
  const D = Deck(T, config, name);
  if (!slides.length) {
    D.pptx.addSlide().addText(deckTitle || "Untitled", { x: 1, y: 3, w: 11, h: 1.2, fontSize: 40, bold: true });
  }
  let n = 0;
  slides.forEach((s, i) => {
    n++;
    const slide = D.pptx.addSlide();
    LAYOUTS[pickLayout(s, i, slides.length)](D, slide, s, n);
    if (s.notes) slide.addNotes(s.notes);
  });
  return D.pptx.write({ outputType: "nodebuffer" });
}

module.exports = { buildDeck, THEMES };
