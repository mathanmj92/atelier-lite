// Copies each app's production build into apps/<id> and prepares it for Atelier, once:
//   - the Puter script tag becomes Atelier's local stand-in (shim/puter-shim.js), and trackers go
//   - the apps that carry their own AI assistants get shim/no-ai.js
//   - wording is rewritten (electron/rebrand.cjs)
// Doing this at build time keeps start-up light: the installer just streams plain files.
// Pass --build to rebuild every app first.
import { cpSync, existsSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rebrand } = require('../electron/rebrand.cjs');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const everything = join(root, '..');
const APPS = {
  documents: 'vite.config.js',
  presentation: 'vite.config.electron.js',
  spreadsheet: 'vite.config.js',
  pdf: 'vite.config.js',
};
// The apps' own assistants read and edit the open document with tools. They run on the AI set up for
// Atelier (puter.ai in shim/puter-shim.js), so nothing is hidden any more.
const WITH_OWN_AI = new Set();
const PUTER_TAG = /<script[^>]*js\.puter\.com[^>]*><\/script>/gi;
const TRACKER_TAG = /<script[^>]*plausible\.io[^>]*><\/script>/gi;
const SHIM_TAG = '<script src="/__atelier/puter-shim.js"></script>';

function prepare(id, dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      n += prepare(id, p);
      continue;
    }
    const ext = extname(e.name).toLowerCase();
    if (!['.html', '.htm', '.js', '.mjs'].includes(ext)) continue;
    const before = readFileSync(p, 'utf8');
    let text = before;
    if (ext === '.html' || ext === '.htm') {
      text = text.replace(PUTER_TAG, SHIM_TAG).replace(TRACKER_TAG, '');
      // Apps that never loaded Puter (the whiteboard) still get the workspace-backed stand-in.
      if (!text.includes(SHIM_TAG)) text = text.replace(/<head[^>]*>/i, (m) => m + SHIM_TAG);
      if (WITH_OWN_AI.has(id) && !text.includes('no-ai.js')) text = text.replace('</body>', '<script src="/__atelier/no-ai.js"></script></body>');
    }
    text = rebrand(text);
    if (text !== before) {
      writeFileSync(p, text);
      n++;
    }
  }
  return n;
}

for (const [id, config] of Object.entries(APPS)) {
  const dir = join(everything, id);
  if (config && process.argv.includes('--build')) {
    console.log('building', id);
    execSync(`npx vite build --config ${config}`, { cwd: dir, stdio: 'inherit' });
  }
  const dist = join(dir, config ? 'dist' : 'src');
  if (!existsSync(join(dist, 'index.html'))) {
    // A partial checkout (only some apps' sources here): keep the copy already in apps/ rather than fail.
    if (existsSync(join(root, 'apps', id, 'index.html'))) {
      console.log('kept', id, '- no source here, using the copy in apps/');
      continue;
    }
    throw new Error(`${id}: no build at ${dist} (run with --build)`);
  }
  const out = join(root, 'apps', id);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // Test fixtures shipped in a public folder are not part of the app.
  cpSync(dist, out, { recursive: true, filter: (src) => !/[\\/]fixtures([\\/]|$)/.test(src) });
  console.log('copied', id, '- prepared', prepare(id, out), 'files');
}
