# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email **mathannits92@gmail.com** with:

- what you found and where,
- how to reproduce it,
- the version of Atelier Lite (Help, About).

You will get a reply within a few days. Please give a reasonable time to fix the problem before telling anyone else.

## What Atelier Lite does with your data

- Files stay on your PC, in the workspace folder you choose. There is no account and no cloud storage, and Atelier Lite does not collect usage data.
- Nothing is sent to an AI engine until you set one up in Settings and ask the assistant something. Local engines (Ollama, LM Studio, llama.cpp) keep everything on your PC.
- API keys you enter are encrypted with Windows' per-user protection (Electron `safeStorage`) when it is available. Do not share your settings folder.
- The shell and every bundled app run in sandboxed views with Node.js disabled and context isolation on, and reach the system only through a small preload bridge.

## Workspace lock

When you turn on the lock, the files in the workspace are encrypted with AES-256-GCM, with a key derived from your password, PIN or security answer using scrypt. A recovery key is shown once when you set it up. **If you lose both the secret and the recovery key, the files cannot be recovered.** A short PIN is weaker than a long password; choose accordingly.

## Supported versions

Only the latest release receives fixes.
