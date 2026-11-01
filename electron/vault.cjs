// Project vault: an optional lock on a project folder.
//
// A random master key encrypts every file in the project (AES-256-GCM, streamed, so big PDFs are
// fine). The master key is never stored in the clear: it is wrapped twice, once with a key made
// from the person's secret (a password or name, a PIN, or the answer to their own question) and
// once with a recovery key shown a single time. Changing the secret re-wraps 32 bytes; it does not
// touch the files. Locked files become "<name>.atlk"; unlocking puts them back where they were.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");

const VAULT_FILE = ".atelier-vault";
const MAGIC = Buffer.from("ATLK1\0\0\0"); // 8 bytes, then a 12-byte IV, the ciphertext and a 16-byte tag
const HEAD = MAGIC.length + 12;
const TAG = 16;
const EXT = ".atlk";
const AAD = Buffer.from("atelier-vault-v1");
const KDF = { N: 1 << 17, r: 8, p: 1 };
const METHODS = new Set(["password", "pin", "question"]);
const DEFAULTS = { idleMinutes: 15, onQuit: true, onScreenLock: true };

const vaultPath = (root) => path.join(root, VAULT_FILE);
function read(root) {
  try {
    const v = JSON.parse(fs.readFileSync(vaultPath(root), "utf8"));
    return v && v.v === 1 && v.wrap ? v : null;
  } catch {
    return null;
  }
}
const write = (root, v) => {
  const tmp = vaultPath(root) + ".part";
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, vaultPath(root));
};
const exists = (root) => !!read(root);

const scrypt = (secret, salt) =>
  new Promise((res, rej) => crypto.scrypt(secret, salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 256 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

// Answers and recovery keys are forgiving about case, spacing and dashes; passwords and PINs are exact.
function normalize(method, secret) {
  const s = String(secret ?? "");
  if (method === "question") return s.trim().toLowerCase().replace(/\s+/g, " ");
  if (method === "pin") return s.trim();
  if (method === "recovery") return s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  return s;
}
function check(method, secret) {
  const s = normalize(method, secret);
  if (method === "password" && s.length < 6) throw new Error("Use at least 6 characters.");
  if (method === "pin" && !/^\d{4,12}$/.test(s)) throw new Error("A PIN is 4 to 12 digits.");
  if (method === "question" && s.length < 3) throw new Error("The answer needs at least 3 characters.");
  return s;
}

async function wrap(secretText, master) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", await scrypt(secretText, salt), iv);
  c.setAAD(AAD);
  const ct = Buffer.concat([c.update(master), c.final()]);
  return { salt: salt.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64") };
}
async function unwrap(w, secretText) {
  const d = crypto.createDecipheriv("aes-256-gcm", await scrypt(secretText, Buffer.from(w.salt, "base64")), Buffer.from(w.iv, "base64"));
  d.setAAD(AAD);
  d.setAuthTag(Buffer.from(w.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(w.ct, "base64")), d.final()]); // throws when the secret is wrong
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function newRecoveryKey() {
  const bytes = crypto.randomBytes(20); // 160 bits -> 32 base32 characters
  let bits = 0, acc = 0, out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) (out += B32[(acc >>> (bits - 5)) & 31]), (bits -= 5);
  }
  return out.match(/.{4}/g).join("-");
}

function publicInfo(v) {
  if (!v) return { enabled: false };
  return { enabled: true, method: v.method, question: v.question || "", hint: v.hint || "", settings: { ...DEFAULTS, ...(v.settings || {}) }, hasRecovery: !!v.recovery };
}

// Turns the vault on. The caller is given the master key (the project is open) and the recovery key (shown once).
async function setup(root, { method, question = "", hint = "", secret, settings = {} }) {
  if (!METHODS.has(method)) throw new Error("Choose how to unlock.");
  if (method === "question" && !String(question).trim()) throw new Error("Write the question first.");
  const text = check(method, secret);
  const master = crypto.randomBytes(32);
  const recoveryKey = newRecoveryKey();
  const v = {
    v: 1,
    method,
    question: method === "question" ? String(question).trim().slice(0, 200) : "",
    hint: String(hint || "").trim().slice(0, 120),
    wrap: await wrap(text, master),
    recovery: await wrap(normalize("recovery", recoveryKey), master),
    settings: { ...DEFAULTS, ...settings },
  };
  write(root, v);
  return { master, recoveryKey };
}
async function unlock(root, secret) {
  const v = read(root);
  if (!v) throw new Error("This project is not protected.");
  try {
    return await unwrap(v.wrap, normalize(v.method, secret));
  } catch {
    const e = new Error("That isn't right.");
    e.code = "wrong";
    throw e;
  }
}
async function recover(root, recoveryKey) {
  const v = read(root);
  if (!v?.recovery) throw new Error("This project has no recovery key.");
  try {
    return await unwrap(v.recovery, normalize("recovery", recoveryKey));
  } catch {
    const e = new Error("That recovery key isn't right.");
    e.code = "wrong";
    throw e;
  }
}
// A new secret (and maybe a new method) for the same files.
async function change(root, master, { method, question = "", hint = "", secret }) {
  const v = read(root);
  if (!v) throw new Error("This project is not protected.");
  if (!METHODS.has(method)) throw new Error("Choose how to unlock.");
  if (method === "question" && !String(question).trim()) throw new Error("Write the question first.");
  const text = check(method, secret);
  Object.assign(v, { method, question: method === "question" ? String(question).trim().slice(0, 200) : "", hint: String(hint || "").trim().slice(0, 120), wrap: await wrap(text, master) });
  write(root, v);
}
async function newRecovery(root, master) {
  const v = read(root);
  const recoveryKey = newRecoveryKey();
  v.recovery = await wrap(normalize("recovery", recoveryKey), master);
  write(root, v);
  return recoveryKey;
}
function setSettings(root, patch) {
  const v = read(root);
  if (!v) return;
  const s = { ...DEFAULTS, ...(v.settings || {}) };
  if (patch.idleMinutes !== undefined) s.idleMinutes = Math.max(0, Math.min(1440, Math.round(Number(patch.idleMinutes) || 0)));
  if (patch.onQuit !== undefined) s.onQuit = !!patch.onQuit;
  if (patch.onScreenLock !== undefined) s.onScreenLock = !!patch.onScreenLock;
  v.settings = s;
  write(root, v);
}
const remove = (root) => fs.rmSync(vaultPath(root), { force: true });

// ---------- files ----------
function* walk(dir) {
  let list = [];
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of list) {
    if (d.name.startsWith(".")) continue;
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(abs);
    else if (d.isFile()) yield abs;
  }
}
// What a lock covers: everything except the project file itself and our own temporaries.
const lockable = (f) => {
  const n = f.toLowerCase();
  return !n.endsWith(".atle") && !n.endsWith(EXT) && !n.endsWith(".part") && !n.endsWith(".atelier-tmp");
};
const plainFiles = (root) => [...walk(root)].filter(lockable);
const lockedFiles = (root) => [...walk(root)].filter((f) => f.toLowerCase().endsWith(EXT));

async function encryptFile(abs, key) {
  const st = fs.statSync(abs);
  const out = abs + EXT;
  const tmp = out + ".part";
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(AAD);
  const ws = fs.createWriteStream(tmp);
  ws.write(Buffer.concat([MAGIC, iv]));
  try {
    await pipeline(fs.createReadStream(abs), c, ws, { end: false });
    await new Promise((res, rej) => ws.end(c.getAuthTag(), (e) => (e ? rej(e) : res())));
    fs.renameSync(tmp, out);
    fs.utimesSync(out, st.atime, st.mtime);
    fs.unlinkSync(abs);
  } catch (e) {
    ws.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}
async function decryptFile(abs, key) {
  const st = fs.statSync(abs);
  let target = abs.slice(0, -EXT.length);
  if (fs.existsSync(target)) {
    const ext = path.extname(target);
    const base = target.slice(0, target.length - ext.length);
    let i = 1;
    do target = `${base} (unlocked${i > 1 ? " " + i : ""})${ext}`;
    while (fs.existsSync(target) && ++i);
  }
  const tmp = target + ".part";
  const fd = fs.openSync(abs, "r");
  let tag, head;
  try {
    if (st.size < HEAD + TAG) throw new Error("not a locked file");
    head = Buffer.alloc(HEAD);
    fs.readSync(fd, head, 0, HEAD, 0);
    tag = Buffer.alloc(TAG);
    fs.readSync(fd, tag, 0, TAG, st.size - TAG);
  } finally {
    fs.closeSync(fd);
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not a locked file");
  const d = crypto.createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
  d.setAAD(AAD);
  d.setAuthTag(tag);
  try {
    // an empty file has no ciphertext: nothing to stream
    if (st.size > HEAD + TAG) await pipeline(fs.createReadStream(abs, { start: HEAD, end: st.size - TAG - 1 }), d, fs.createWriteStream(tmp));
    else (d.final(), fs.writeFileSync(tmp, ""));
    fs.renameSync(tmp, target);
    fs.utimesSync(target, st.atime, st.mtime);
    fs.unlinkSync(abs);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

async function run(files, fn, onProgress) {
  const failed = [];
  let done = 0;
  onProgress?.(0, files.length);
  for (const f of files) {
    try {
      await fn(f);
    } catch (e) {
      failed.push({ file: f, message: e.message });
    }
    onProgress?.(++done, files.length);
  }
  return { total: files.length, failed };
}
const encryptTree = (root, key, onProgress) => run(plainFiles(root), (f) => encryptFile(f, key), onProgress);
const decryptTree = (root, key, onProgress) => run(lockedFiles(root), (f) => decryptFile(f, key), onProgress);

module.exports = { VAULT_FILE, exists, read, publicInfo, setup, unlock, recover, change, newRecovery, setSettings, remove, encryptTree, decryptTree, plainFiles, lockedFiles, DEFAULTS };
