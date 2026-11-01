# Atelier Lite

**Documents, slides, sheets and PDFs, in one workspace.**

Atelier Lite is a desktop suite for Windows that puts a word processor, slides, a spreadsheet and a PDF editor in one window, sharing one folder, with one AI assistant that can read across all of them and create new documents.

- Works offline; no account, no cloud.
- Every document is a tab; several of the same app can be open at once.
- AI: Claude Code, Codex, local models (Ollama / LM Studio / llama.cpp), Anthropic API, OpenAI-compatible APIs, or a custom command.
- Light, dark and colour themes; text size; low-power mode for older PCs.
- Optional workspace lock: a password, PIN or security question encrypts the workspace's files.

See [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) for usage, [`docs/CHANGELOG.md`](docs/CHANGELOG.md) for release notes and [`docs/NOTICES.md`](docs/NOTICES.md) for open-source notices. In the app, press **F1**.

## Build

```
npm install
node scripts/sync-apps.mjs      # copy each app's build into apps/
npm run start                   # run
npm run dist:win                # build the Windows installer into release/
```

Version 1.0.0.

