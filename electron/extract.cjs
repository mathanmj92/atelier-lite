// Turns the file an app is working on into plain text the AI can read.
const fs = require("node:fs");
const path = require("node:path");
const { unzipSync, strFromU8 } = require("fflate");

const LIMIT = 60000;

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const decode = (s) =>
  s
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m])
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
const numeric = (a, b) => (parseInt(a.match(/(\d+)\.xml$/)?.[1] || 0, 10) - parseInt(b.match(/(\d+)\.xml$/)?.[1] || 0, 10));

function docx(files) {
  const xml = files["word/document.xml"];
  if (!xml) return "";
  return strFromU8(xml)
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\s*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((l) => decode(l).replace(/\t+$/, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pptx(files) {
  const names = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(numeric);
  return names
    .map((n, i) => {
      const text = [...strFromU8(files[n]).matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g)]
        .map((p) => decode([...p[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("")))
        .filter(Boolean)
        .join("\n");
      const notesFile = `ppt/notesSlides/notesSlide${n.match(/(\d+)\.xml$/)[1]}.xml`;
      const notes = files[notesFile] ? decode([...strFromU8(files[notesFile]).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(" ")).trim() : "";
      return `--- Slide ${i + 1} ---\n${text}${notes ? `\n(Speaker notes: ${notes})` : ""}`;
    })
    .join("\n\n");
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
function xlsx(files) {
  const shared = files["xl/sharedStrings.xml"]
    ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")))
    : [];
  const wb = files["xl/workbook.xml"] ? [...strFromU8(files["xl/workbook.xml"]).matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decode(m[1])) : [];
  const sheets = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(numeric);
  return sheets
    .map((n, i) => {
      const rows = [];
      for (const r of strFromU8(files[n]).matchAll(/<row [^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const cells = [];
        for (const c of (r[1] || "").matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = /r="([A-Z]+\d+)"/.exec(c[1])?.[1];
          if (!ref) continue;
          const type = /t="(\w+)"/.exec(c[1])?.[1];
          const body = c[2] || "";
          const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
          const f = /<f[^>]*>([^<]*)<\/f>/.exec(body)?.[1];
          let val = "";
          if (type === "s") val = shared[Number(v)] ?? "";
          else if (type === "inlineStr") val = decode([...body.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""));
          else if (v != null) val = decode(v);
          if (f && val === "") val = "=" + decode(f);
          if (val !== "") cells[colIndex(ref)] = val;
        }
        if (cells.length) rows.push(Array.from(cells, (x) => x ?? "").slice(0, 30).join("\t"));
        if (rows.length >= 400) break;
      }
      return `--- Sheet: ${wb[i] || "Sheet" + (i + 1)} ---\n${rows.join("\n")}`;
    })
    .join("\n\n");
}

let pdfjs;
async function pdf(buf) {
  pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const out = [];
  let size = 0;
  for (let p = 1; p <= doc.numPages && size < LIMIT; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let line = "";
    const lines = [];
    for (const it of tc.items) {
      line += it.str;
      if (it.hasEOL) (lines.push(line), (line = ""));
    }
    if (line) lines.push(line);
    const text = lines.join("\n").trim();
    out.push(`--- Page ${p} of ${doc.numPages} ---\n${text}`);
    size += text.length;
  }
  await task.destroy?.();
  return out.join("\n\n");
}

// A .form file as readable text: title, questions with their options and which are marked correct.
function formText(raw) {
  let d;
  try {
    d = JSON.parse(raw.replace(/^﻿/, ""));
  } catch {
    return raw;
  }
  const qs = Array.isArray(d) ? d : d.questions || [];
  const out = [`# ${d.title || "Form"}`];
  if (d.kind && d.kind !== "quiz") out.push(`Type: ${d.kind}${d.anonymous ? " (anonymous)" : ""}`);
  if (d.description) out.push(d.description);
  qs.forEach((q, i) => {
    const label = q.label || q.q || q.question || "";
    out.push(`${i + 1}. ${label}${q.type ? ` [${q.type}]` : ""}`);
    (q.options || q.choices || []).forEach((o, j) => {
      const text = typeof o === "string" ? o : o.text;
      const right = typeof o === "object" ? o.correct : [].concat(q.answer ?? []).includes(j);
      out.push(`   ${right ? "[x]" : "[ ]"} ${text}`);
    });
    if (q.accepted) out.push(`   Answer: ${q.accepted}`);
  });
  return out.join("\n");
}

const cache = new Map();
async function extractFile(abs) {
  const st = fs.statSync(abs);
  const key = abs + "|" + st.mtimeMs;
  if (cache.has(key)) return cache.get(key);
  const ext = path.extname(abs).slice(1).toLowerCase();
  let text = "";
  if (["md", "markdown", "mdown", "txt", "csv", "tsv", "json", "html", "htm"].includes(ext)) text = fs.readFileSync(abs, "utf8");
  else if (ext === "form") text = formText(fs.readFileSync(abs, "utf8"));
  else if (ext === "pdf") text = await pdf(fs.readFileSync(abs));
  else if (["docx", "dotx", "docm"].includes(ext)) text = docx(unzipSync(new Uint8Array(fs.readFileSync(abs))));
  else if (["pptx", "potx"].includes(ext)) text = pptx(unzipSync(new Uint8Array(fs.readFileSync(abs))));
  else if (["xlsx", "xlsm"].includes(ext)) text = xlsx(unzipSync(new Uint8Array(fs.readFileSync(abs))));
  const truncated = text.length > LIMIT;
  const result = { text: truncated ? text.slice(0, LIMIT) : text, truncated, length: text.length };
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

module.exports = { extractFile, LIMIT };
