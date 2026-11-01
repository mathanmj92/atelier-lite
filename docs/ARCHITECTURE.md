# Architecture

Atelier Lite is an Electron app. One main window holds a **shell** (the tab strip, Home, Settings and the AI panel) and, below it, one **web view per tab**. Each tab shows one of the four bundled apps, loaded from a custom `app://` address, so the apps run completely offline.

```
                     main process  (electron/main.cjs)
   windows, tabs, workspaces, files, vault, AI, prefs, shortcuts
        |                      |                       |
   preload-shell.cjs     preload-app.cjs          ai.cjs / deck.cjs
        |                      |                  export.cjs / extract.cjs
   shell/  (tab strip,    apps/<id>/  one view     (write and read files for
   Home, Settings,        per tab, app://<id>/      the assistant)
   AI panel, lock)             |
                          shim/puter-shim.js
                    (offline stand-in the apps talk to)
```

## Processes and windows

| Piece | File | Role |
| --- | --- | --- |
| Main process | `electron/main.cjs` | Creates the window, one `WebContentsView` per tab, owns the workspace, preferences, the vault and every file operation. |
| Shell | `shell/index.html`, `shell.js`, `tabs.js`, `overlay.js` | The interface around the apps: tab strip with Home and workspace menu, the Home list, Settings, About, Help, the AI panel and the welcome screen. |
| Shell bridge | `electron/preload-shell.cjs` | The only way shell pages reach the main process (`window.shellApi`). |
| App bridge | `electron/preload-app.cjs` | Gives each bundled app its workspace path and the few things it needs. |
| Apps | `apps/documents`, `presentation`, `spreadsheet`, `pdf` | The four editors, built elsewhere and copied in by `scripts/sync-apps.mjs`. |

All views run with `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`.

## The `app://` protocol and the shim

Each app is served from `app://<id>/`. The apps were written to save to a cloud file system, so `shim/puter-shim.js` stands in for that service: it maps the app's file calls onto the workspace folder, applies the current theme and palette, and keeps the apps' interface consistent. `electron/rebrand.cjs` rewrites visible wording so no cloud-service names reach the user, while leaving file-format markers alone.

## Workspaces

A workspace is a folder. `Documents`, `Presentations`, `Spreadsheets` and `PDF Editor` subfolders hold the files, and an optional `<name>.atle` project file stores the open tabs and layout so a workspace reopens the way it was left. The list of recent workspaces and the preferences live in the app's user-data folder. The default root is `Documents\Atelier Lite`.

## Tabs and performance

- One view per tab, created on demand and destroyed on close.
- **Tab sleeper:** an idle tab with nothing unsaved is released from memory and comes back when selected. Low-power mode shortens the idle time and turns off motion.
- Text size is a single CSS variable applied across the shell.

## The AI assistant

`electron/ai.cjs` talks to the engine the user chose (Claude Code, Codex, a local server, the Anthropic API, an OpenAI-compatible API or a custom command). API keys are sealed with Electron `safeStorage` when available. The assistant works through tools rather than raw access:

- `electron/extract.cjs` reads text out of `.docx`, `.pptx`, `.xlsx` and `.pdf`.
- `electron/export.cjs` builds new `.docx`, `.pptx`, `.xlsx` and `.csv` files from Markdown-like text, using the `docx`, `pptxgenjs` and `exceljs` libraries.
- `electron/deck.cjs` lays out slide decks.
- In Lite the assistant creates and reads files; it does not edit an open document in place (that needs the Markdown or Forms editors of the full Atelier).

## The vault

`electron/vault.cjs` implements the optional workspace lock. A random 256-bit master key encrypts every file (AES-256-GCM, streamed, so large PDFs do not fill memory) into `*.atlk` files and preserves modification times. The master key is wrapped separately by each unlock method (password, PIN or security answer, each through scrypt) and by a one-time recovery key. Project (`.atle`) files and the vault file (`.atelier-vault`) stay readable so the workspace can be recognised and unlocked.

## Links between files

`Ctrl+Shift+K` opens a picker that inserts an `atelier://open/...` link (as a clickable link in the clipboard HTML) into the document being written. Clicking it opens the target file in its own tab.

## Packaging

`electron-builder` builds an NSIS installer: per-user, with a choice of install folder. App id `com.atelier.lite`, so it installs beside the full Atelier. File associations: `.docx`, `.pptx`, `.xlsx`, `.pdf` and `.atle`.

## Relationship to the full Atelier

Lite is generated from the full Atelier 2.6.0 source by removing the Forms, Markdown, Notes and Whiteboard apps and everything that only served them (file associations, the Forms launcher, the Markdown IPC, the matching assistant file kinds), then renaming. The shared shell, shim and AI layer are otherwise identical.
