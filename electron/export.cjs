// Turns what the AI writes into real files: Markdown -> .docx, slide Markdown -> .pptx,
// sheet sections (tables or CSV) -> .xlsx. Plain .md and .csv are written as they are.
const docx = require("docx");
const PptxGenJS = require("pptxgenjs");
const ExcelJS = require("exceljs");
const { buildDeck } = require("./deck.cjs");

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

// ---------------------------------------------------------------- docx
const H = [docx.HeadingLevel.HEADING_1, docx.HeadingLevel.HEADING_2, docx.HeadingLevel.HEADING_3, docx.HeadingLevel.HEADING_4, docx.HeadingLevel.HEADING_5, docx.HeadingLevel.HEADING_6];

function runs(tokens = [], style = {}) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case "strong":
        out.push(...runs(t.tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...runs(t.tokens, { ...style, italics: true }));
        break;
      case "del":
        out.push(...runs(t.tokens, { ...style, strike: true }));
        break;
      case "codespan":
        out.push(new docx.TextRun({ ...style, text: decode(t.text), font: "Consolas", shading: { type: docx.ShadingType.CLEAR, fill: "EEF0F3" } }));
        break;
      case "link":
        out.push(new docx.ExternalHyperlink({ link: t.href, children: runs(t.tokens?.length ? t.tokens : [{ type: "text", text: t.href }], { ...style, color: "0563C1", underline: {} }) }));
        break;
      case "br":
        out.push(new docx.TextRun({ ...style, break: 1 }));
        break;
      case "image":
        out.push(new docx.TextRun({ ...style, text: decode(t.text || "") }));
        break;
      case "html":
        break;
      default:
        if (t.tokens?.length) out.push(...runs(t.tokens, style));
        else out.push(new docx.TextRun({ ...style, text: decode(t.text ?? t.raw ?? "") }));
    }
  }
  return out;
}

let listSeq = 0;
function blocks(tokens, ctx = {}) {
  const out = [];
  const quote = ctx.quote ? { indent: { left: 540 }, border: { left: { style: docx.BorderStyle.SINGLE, size: 12, color: "B8BEC8", space: 8 } } } : {};
  for (const t of tokens) {
    switch (t.type) {
      case "heading":
        out.push(new docx.Paragraph({ heading: H[Math.min(5, t.depth - 1)], children: runs(t.tokens), spacing: { before: 240, after: 120 } }));
        break;
      case "paragraph":
      case "text":
        out.push(new docx.Paragraph({ children: runs(t.tokens ?? [t]), spacing: { after: 140 }, ...quote }));
        break;
      case "list": {
        const id = ++listSeq;
        const level = ctx.level ?? 0;
        t.items.forEach((item) => {
          const own = item.tokens.filter((x) => x.type !== "list");
          const prefix = item.task ? [new docx.TextRun({ text: item.checked ? "☑ " : "☐ " })] : [];
          const textTokens = own.flatMap((x) => (x.type === "text" || x.type === "paragraph" ? x.tokens ?? [x] : []));
          out.push(
            new docx.Paragraph({
              children: [...prefix, ...runs(textTokens)],
              spacing: { after: 60 },
              ...(t.ordered ? { numbering: { reference: "ol", level: Math.min(level, 5), instance: id } } : { bullet: { level: Math.min(level, 5) } }),
              ...quote,
            }),
          );
          for (const nested of item.tokens.filter((x) => x.type === "list")) out.push(...blocks([nested], { ...ctx, level: level + 1 }));
        });
        break;
      }
      case "blockquote":
        out.push(...blocks(t.tokens, { ...ctx, quote: true }));
        break;
      case "code":
        String(t.text).split("\n").forEach((line) => out.push(new docx.Paragraph({ children: [new docx.TextRun({ text: line || " ", font: "Consolas", size: 20 })], shading: { type: docx.ShadingType.CLEAR, fill: "F3F4F6" }, spacing: { after: 0 } })));
        out.push(new docx.Paragraph({ children: [], spacing: { after: 120 } }));
        break;
      case "hr":
        out.push(new docx.Paragraph({ border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } }, spacing: { after: 160 } }));
        break;
      case "table": {
        const cell = (c, head) =>
          new docx.TableCell({
            children: [new docx.Paragraph({ children: runs(c.tokens, head ? { bold: true } : {}) })],
            shading: head ? { type: docx.ShadingType.CLEAR, fill: "E8EBF0" } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
          });
        out.push(
          new docx.Table({
            width: { size: 100, type: docx.WidthType.PERCENTAGE },
            rows: [new docx.TableRow({ tableHeader: true, children: t.header.map((c) => cell(c, true)) }), ...t.rows.map((r) => new docx.TableRow({ children: r.map((c) => cell(c, false)) }))],
          }),
          new docx.Paragraph({ children: [], spacing: { after: 140 } }),
        );
        break;
      }
      default:
        break;
    }
  }
  return out;
}

async function toDocx(md, title) {
  const children = blocks(await lexer(md));
  if (!children.length) children.push(new docx.Paragraph({ children: [] }));
  const levels = Array.from({ length: 6 }, (_, i) => ({ level: i, format: docx.LevelFormat.DECIMAL, text: `%${i + 1}.`, alignment: docx.AlignmentType.START, style: { paragraph: { indent: { left: 540 + i * 360, hanging: 360 } } } }));
  const doc = new docx.Document({
    title: title || "Document",
    creator: "Atelier",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: { config: [{ reference: "ol", levels }] },
    sections: [{ children }],
  });
  return docx.Packer.toBuffer(doc);
}

// ---------------------------------------------------------------- pptx
async function toPptx(md, title) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = title || "Presentation";
  pptx.author = "Atelier";
  const parts = md.split(/^[ \t]*---[ \t]*$/m).map((s) => s.trim()).filter(Boolean);
  let first = true;
  for (const part of parts) {
    let notes = "";
    const body = part.replace(/^[ \t]*Notes?:[ \t]*([\s\S]*)$/im, (_m, n) => ((notes = n.trim()), ""));
    const tokens = (await lexer(body)).filter((t) => t.type !== "space");
    const heading = tokens.find((t) => t.type === "heading");
    const rest = tokens.filter((t) => t !== heading);
    const bullets = [];
    const lines = [];
    const tables = [];
    const addList = (list, level) =>
      list.items.forEach((item) => {
        const text = plain(item.tokens.filter((x) => x.type !== "list").flatMap((x) => x.tokens ?? [x]));
        bullets.push({ text, options: { bullet: list.ordered ? { type: "number" } : true, indentLevel: Math.min(level, 4), breakLine: true } });
        item.tokens.filter((x) => x.type === "list").forEach((n) => addList(n, level + 1));
      });
    for (const t of rest) {
      if (t.type === "list") addList(t, 0);
      else if (t.type === "table") tables.push(t);
      else if (t.type === "paragraph" || t.type === "text") lines.push(plain(t.tokens ?? [t]));
      else if (t.type === "blockquote") lines.push(plain(t.tokens));
      else if (t.type === "code") lines.push(t.text);
    }
    const slide = pptx.addSlide();
    const titleSlide = first || (!bullets.length && !tables.length);
    first = false;
    if (titleSlide) {
      slide.background = { color: "1F2937" };
      slide.addText(heading ? plain(heading.tokens) : lines.shift() || title || "Untitled", { x: 0.7, y: 1.6, w: 8.6, h: 1.4, fontSize: 38, bold: true, color: "FFFFFF", fontFace: "Calibri", valign: "bottom", fit: "shrink" });
      if (lines.length || bullets.length) slide.addText(lines.join("\n") || bullets.map((b) => b.text).join("\n"), { x: 0.7, y: 3.2, w: 8.6, h: 1.4, fontSize: 20, color: "C9D1E0", fontFace: "Calibri", valign: "top", fit: "shrink" });
    } else {
      slide.background = { color: "FFFFFF" };
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 5.625, fill: { color: "5B6CFF" }, line: { color: "5B6CFF" } });
      if (heading) slide.addText(plain(heading.tokens), { x: 0.6, y: 0.3, w: 8.9, h: 0.9, fontSize: 28, bold: true, color: "1F2937", fontFace: "Calibri", fit: "shrink", valign: "middle" });
      let y = 1.35;
      if (lines.length) {
        slide.addText(lines.join("\n\n"), { x: 0.7, y, w: 8.7, h: 0.9, fontSize: 16, color: "4B5563", fontFace: "Calibri", valign: "top", fit: "shrink" });
        y += 1.0;
      }
      if (bullets.length) slide.addText(bullets, { x: 0.7, y, w: 8.7, h: tables.length ? 2 : 5.625 - y - 0.4, fontSize: 20, color: "111827", fontFace: "Calibri", valign: "top", paraSpaceAfter: 8, fit: "shrink" });
      for (const t of tables) {
        const rows = [t.header, ...t.rows].map((r, ri) => r.map((c) => ({ text: plain(c.tokens), options: { bold: ri === 0, fill: { color: ri === 0 ? "E8EBF0" : "FFFFFF" }, color: "111827", fontSize: 14, border: { type: "solid", color: "D1D5DB", pt: 0.75 } } })));
        slide.addTable(rows, { x: 0.7, y: bullets.length ? 3.4 : y, w: 8.6, fontFace: "Calibri" });
      }
    }
    if (notes) slide.addNotes(notes);
  }
  if (!parts.length) pptx.addSlide().addText(title || "Untitled", { x: 1, y: 2, w: 8, h: 1, fontSize: 32 });
  return pptx.write({ outputType: "nodebuffer" });
}

// ---------------------------------------------------------------- xlsx
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") (row.push(cur), (cur = ""));
    else if (ch === "\n") (row.push(cur), rows.push(row), (row = []), (cur = ""));
    else cur += ch;
  }
  if (cur !== "" || row.length) (row.push(cur), rows.push(row));
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
function parseTable(body) {
  const lines = body.split(/\r?\n/).filter((l) => l.trim());
  if (lines.some((l) => /^\s*\|/.test(l))) {
    return lines
      .filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l) || !/-/.test(l))
      .filter((l) => /\|/.test(l))
      .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim()));
  }
  return parseCsv(body);
}
function parseSheets(text) {
  const sheets = [];
  const re = /^#{1,4}[ \t]*Sheet[ \t]*:[ \t]*(.+)$/gim;
  const marks = [...text.matchAll(re)];
  if (!marks.length) return [{ name: "Sheet1", rows: parseTable(text) }];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    sheets.push({ name: m[1].trim().replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Sheet${i + 1}`, rows: parseTable(text.slice(m.index + m[0].length, end)) });
  });
  return sheets;
}
function typed(raw) {
  const v = String(raw ?? "").trim();
  if (v === "") return { value: null };
  if (v.startsWith("=") && v.length > 1) return { value: { formula: v.slice(1) } };
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v) || /^[-+]?\d+(\.\d+)?$/.test(v)) return { value: Number(v.replace(/,/g, "")) };
  if (/^[-+]?\d+(\.\d+)?%$/.test(v)) return { value: Number(v.slice(0, -1)) / 100, numFmt: "0.0%" };
  if (/^[$€£]\s?[-+]?[\d,]+(\.\d+)?$/.test(v)) return { value: Number(v.replace(/[^\d.+-]/g, "")), numFmt: `"${v[0]}"#,##0.00` };
  return { value: v };
}
async function toXlsx(text, title) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Atelier";
  wb.title = title || "Workbook";
  const used = new Set();
  for (const sh of parseSheets(text)) {
    let name = sh.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = sh.name.slice(0, 28) + " " + n;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: sh.rows.length > 1 ? 1 : 0 }] });
    const widths = [];
    sh.rows.forEach((r, ri) => {
      const row = ws.getRow(ri + 1);
      r.forEach((raw, ci) => {
        const { value, numFmt } = typed(raw);
        const cell = row.getCell(ci + 1);
        cell.value = value;
        if (numFmt) cell.numFmt = numFmt;
        widths[ci] = Math.min(50, Math.max(widths[ci] || 8, String(raw ?? "").length + 2));
        if (ri === 0 && sh.rows.length > 1) {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
        }
      });
    });
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    if (sh.rows.length > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, widths.length) } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const KINDS = {
  docx: { ext: ".docx", build: (body, title) => toDocx(body, title), folder: "Documents", app: "documents" },
  pptx: { ext: ".pptx", build: (body, title) => buildDeck(body, title), folder: "Presentations", app: "presentation" },
  xlsx: { ext: ".xlsx", build: (body, title) => toXlsx(body, title), folder: "Spreadsheets", app: "spreadsheet" },
  csv: { ext: ".csv", build: async (body) => Buffer.from("﻿" + body.trim() + "\n", "utf8"), folder: "Spreadsheets", app: "spreadsheet" },
};

/** { kind, name, body } -> { buffer, fileName, folder, app } */
async function buildFile({ kind, name, body }) {
  const k = KINDS[String(kind).toLowerCase()];
  if (!k) throw new Error(`Can't create a "${kind}" file.`);
  const stem = String(name || "Untitled").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
  const buffer = await k.build(String(body ?? ""), stem);
  return { buffer, fileName: stem + k.ext, folder: k.folder, app: k.app };
}

module.exports = { buildFile, KINDS };
