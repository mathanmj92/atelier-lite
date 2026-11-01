// Tests for the parts of Atelier Lite that run without a window: the vault, the file writer and reader the
// assistant uses, the palette and the rewording of the bundled apps. Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const vault = require("../electron/vault.cjs");
const { buildFile } = require("../electron/export.cjs");
const { extractFile } = require("../electron/extract.cjs");
const { palette, THEMES } = require("../electron/theme.cjs");
const { rebrand } = require("../electron/rebrand.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "atelier-lite-test-"));

test("the palette has the same keys in light and dark, for every colour theme", () => {
  for (const t of THEMES) {
    const light = palette(t.id, false);
    const dark = palette(t.id, true);
    assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort(), t.id);
    assert.equal(light.dark, false);
    assert.equal(dark.dark, true);
    for (const v of Object.values(light)) if (typeof v === "string" && v.startsWith("#")) assert.match(v, /^#[0-9a-f]{6}$/i);
  }
});

test("rebrand rewords running text but keeps file-format markers and credits", () => {
  assert.equal(rebrand("Save to Puter"), "Save to the workspace");
  assert.equal(rebrand("Your Puter cloud"), "Your workspace");
  assert.equal(rebrand("PuterExportMeta"), "PuterExportMeta");
  assert.ok(rebrand("Puter Technologies Inc.").includes("Puter Technologies"));
  assert.equal(rebrand("nothing to change"), "nothing to change");
});

test("the writer builds real .docx, .pptx and .xlsx files, and a csv", async () => {
  const docx = await buildFile({ kind: "docx", name: "Report", body: "# Title\n\nHello **world**\n\n- a\n- b" });
  assert.equal(docx.app, "documents");
  assert.equal(docx.fileName, "Report.docx");
  assert.equal(Buffer.from(docx.buffer).subarray(0, 2).toString(), "PK"); // a zip container
  const pptx = await buildFile({ kind: "pptx", name: "Deck", body: "# One\n\n- a\n- b\n\n---\n\n# Two\n\ntext" });
  assert.equal(pptx.app, "presentation");
  assert.equal(Buffer.from(pptx.buffer).subarray(0, 2).toString(), "PK");
  const xlsx = await buildFile({ kind: "xlsx", name: "Sheet", body: "| a | b |\n|---|---|\n| 1 | 2 |" });
  assert.equal(xlsx.app, "spreadsheet");
  assert.equal(Buffer.from(xlsx.buffer).subarray(0, 2).toString(), "PK");
  const csv = await buildFile({ kind: "csv", name: "Data", body: "a,b\n1,2" });
  assert.equal(csv.app, "spreadsheet");
  await assert.rejects(buildFile({ kind: "md", name: "x", body: "# x" }), /Can't create/); // Lite has no Markdown app
  await assert.rejects(buildFile({ kind: "form", name: "x", body: "{}" }), /Can't create/);
});

test("the reader gets the text back out of what the writer made", async () => {
  const dir = tmp();
  const write = async (kind, body, name) => {
    const r = await buildFile({ kind, name, body });
    const p = path.join(dir, r.fileName);
    fs.writeFileSync(p, r.buffer);
    return p;
  };
  const d = await extractFile(await write("docx", "# Heading\n\nA paragraph about silicon.", "doc"));
  assert.match(d.text, /Heading/);
  assert.match(d.text, /silicon/);
  const s = await extractFile(await write("xlsx", "| item | cost |\n|---|---|\n| pen | 3 |", "sheet"));
  assert.match(s.text, /pen/);
  const p = await extractFile(await write("pptx", "# Opening slide\n\n- first point", "deck"));
  assert.match(p.text, /Opening slide/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the vault locks and unlocks a folder, and keeps timestamps and contents", async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "Documents"));
  fs.writeFileSync(path.join(root, "Documents", "a.txt"), "secret one");
  fs.writeFileSync(path.join(root, "b.bin"), Buffer.from([0, 1, 2, 3, 250]));
  fs.writeFileSync(path.join(root, "Project.atle"), "{}"); // stays readable
  const when = new Date("2026-01-02T03:04:05Z");
  fs.utimesSync(path.join(root, "b.bin"), when, when);

  const { master, recoveryKey } = await vault.setup(root, { method: "password", secret: "correct horse" });
  assert.equal(master.length, 32);
  assert.match(recoveryKey, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  assert.equal(vault.exists(root), true);

  const locked = await vault.encryptTree(root, master);
  assert.equal(locked.failed.length, 0);
  assert.equal(fs.existsSync(path.join(root, "Documents", "a.txt")), false);
  assert.equal(fs.existsSync(path.join(root, "Documents", "a.txt.atlk")), true);
  assert.equal(fs.existsSync(path.join(root, "Project.atle")), true);
  assert.ok(!fs.readFileSync(path.join(root, "Documents", "a.txt.atlk")).includes("secret one"));

  await assert.rejects(vault.unlock(root, "wrong"), (e) => e.code === "wrong");
  const key = await vault.unlock(root, "correct horse");
  const opened = await vault.decryptTree(root, key);
  assert.equal(opened.failed.length, 0);
  assert.equal(fs.readFileSync(path.join(root, "Documents", "a.txt"), "utf8"), "secret one");
  assert.deepEqual([...fs.readFileSync(path.join(root, "b.bin"))], [0, 1, 2, 3, 250]);
  assert.equal(Math.round(fs.statSync(path.join(root, "b.bin")).mtimeMs / 1000), Math.round(when.getTime() / 1000));

  // the recovery key opens it as well, in any case and with any dashes
  const viaRecovery = await vault.recover(root, recoveryKey.toLowerCase().replace(/-/g, " "));
  assert.deepEqual(viaRecovery, key);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the vault checks its secrets", async () => {
  const root = tmp();
  await assert.rejects(vault.setup(root, { method: "password", secret: "short" }), /at least 6/);
  await assert.rejects(vault.setup(root, { method: "pin", secret: "12ab" }), /PIN/);
  await assert.rejects(vault.setup(root, { method: "question", question: "", secret: "answer" }), /question/);
  await assert.rejects(vault.setup(root, { method: "nope", secret: "whatever" }), /Choose how/);
  assert.equal(vault.exists(root), false);
  fs.rmSync(root, { recursive: true, force: true });
});
