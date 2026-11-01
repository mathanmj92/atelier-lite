# Atelier Lite User Guide

**Atelier Lite: documents, slides, sheets and PDFs, in one workspace.**
A word processor, a presentation maker, a spreadsheet and a PDF editor in one window, sharing one folder, with one AI assistant that can read across all of them.

## 1. Getting started

Open Atelier Lite and the **welcome screen** asks what to do: **Create workspace** (you pick a folder, and your files are kept in it), or **Open workspace** (an Atelier `.atle` file, or any folder). Workspaces you used recently are listed underneath: click one to carry on where you left off.

After that you are on **Home**: the apps you can start, and every file in your workspace.

- The **Start something new** cards always start a new document, presentation or spreadsheet. To go back to something you already have open, click its tab.
- Use **+** in the tab strip to open another tab of any app. **Alt+1 … Alt+4** jumps to an app (or starts one if none is open).
- Click a file on Home to open it in the right app. Point at a file to **rename** (the pencil: type the new name and press Enter) or **delete** it (the bin: it goes to the Recycle Bin). Right-click a file, or use **⋯**, for more: open it in a different app, add it to the AI session, show it in its folder.
- The **house** at the left of the tab strip, or **Alt+H**, comes back to Home. It is always there.
- Closing Atelier Lite with tabs open asks whether to **save the session**, so they are there again next time.
- The top right has the **AI assistant**, **Settings** and **Help**. **Help** also has **Report a problem**, which opens an email to the developer with your note and the version details filled in.

## 2. The workspace

Everything lives in one folder on your computer (by default `Documents\Atelier Lite`), with a sub-folder per app:

| Folder | Holds |
| --- | --- |
| `Documents` | Word documents (.docx) |
| `Presentations` | Slide decks (.pptx) |
| `Spreadsheets` | Workbooks (.xlsx) and CSV files |
| `PDF Editor` | PDFs |

Files are ordinary files: copy, back up, or open them with other programs.

### Workspaces
A **workspace** (also called a project) is one of these folders for one piece of work. The **workspace button** next to Home shows the current one and lets you:

- **Switch** to another workspace, **create** a new one (name + location), or **open** a folder or a `.atle` file.
- **Save workspace now**, **rename** it, show its folder, or **close** it to go back to the welcome screen.

Each workspace keeps a small **`<name>.atle`** file in its folder: the open tabs, the AI session and the workspace's colour. It **saves itself** as you work, and when you open a workspace (or double-click its `.atle` file) the tabs come back asleep, so only the one you were on loads and the rest wake when you click them. Keep the `.atle` file with the folder if you copy or share it.

### Protect a workspace with a lock

A lock is optional, per workspace. Open **Settings, Security** (or the workspace button, **Protect this workspace**), then pick how it unlocks:

- **Password or name**: anything you like; a longer phrase is harder to guess.
- **PIN**: 4 to 12 digits. Quick, but easy to guess.
- **Security question**: you write the question; the answer is the secret (case and extra spaces are ignored).

You can add a hint, and Atelier Lite shows you a **recovery key** once. Keep it somewhere safe: if you forget your secret and lose the key, nobody can open the files, Atelier Lite included.

**What happens.** The workspace opens behind a lock screen. When it is locked, every file in it is encrypted (AES-256) and renamed `<name>.atlk`; unlocking turns them back into normal files and brings your tabs back. It locks when you press **Lock**, after the idle time you choose, when Windows locks or sleeps, and when you close Atelier Lite or switch workspace (each of these can be switched off). The assistant's conversation is cleared on a lock.

**Good to know.**
- File names, folder names and the `.atle` file stay readable; what is *inside* the files is encrypted. Files outside the workspace folder are not covered.
- While the workspace is open its files are plain, so another program can read them. If Atelier Lite is stopped abruptly, the files stay open until the next lock; the lock screen still appears at the next start.
- A wrong secret makes you wait: from the third try the wait doubles, up to five minutes.
- Change the secret, make a new recovery key, change the auto-lock time or turn the lock off from **Settings, Security** (each asks for your current secret). Turning it off decrypts everything.

**Saving and importing.** *Save As* and *Open* show the normal Windows file windows, and you can pick any folder. Files opened from outside the workspace are edited in place and still appear on Home as recent files.

## 3. Tabs

Every open document is a tab. Open as many as you like, including several of the same app.

- Opening a file that is already open jumps to its tab.
- **+** (or **Alt+T**) starts a new, blank tab of any app.
- **Alt+W** closes a tab. **Alt+PageUp / Alt+PageDown** switch tabs.
- Each tab is a full editor, so many open tabs use more memory. Tabs you are not using go to sleep by themselves (see section 9).

### A document in its own window
To look at one file without the workspace around it, use **Open in a new window** (right-click a file on Home, or **⋯**). You get just that document in a small window, with no Home or workspace. A file you double-click in Explorer, or open with Atelier Lite, opens this way too; press **Open workspace** in that window if you want the full app.

## 4. The AI assistant

Open it with the **AI assistant** button or **Alt+A**. It is the only AI in Atelier Lite.

### Choose a provider (⚙ in the panel, or Settings)
- **Claude Code** or **Codex**: uses the command-line tool you already have and its sign-in.
- **Local model**: runs on your PC through Ollama, LM Studio or llama.cpp. Free, private, works offline.
- **Anthropic API**, **OpenAI-compatible API**: paste an API key.
- **Custom command**: any tool that reads a prompt on stdin and prints an answer.

### What it can see: the *Reading* chips
Above the message box, **Reading** lists exactly what the assistant will be given, as chips:

- The document in the current tab (or just your **selection**).
- Your other open tabs, one chip each.
- Files you add with **+ Add file**, with **@** in the message (type `@` and pick a file), or *Add to AI session* on Home.

Click a chip to switch it off for this chat (it is struck through); click × on an added file to remove it. Nothing outside the chips is sent.

### Watching it work
While it works, a **steps** card shows what it is doing (reading your documents, thinking, using tools with Claude Code, writing a file) and a **Stop** button. When it is done the card folds away into "Worked through N steps".

### It asks before it guesses
With **Ask before acting** on (the default), a request that leaves something open gets a short card with a few questions and buttons: pick your answers and press **Continue**. For bigger jobs it shows a **plan** first; press **Go ahead** or **Change it**.

### Ask it to make a file
Ask for a document, deck or spreadsheet ("Combine these into one document", "Build a slide deck from these"). The reply shows a file card: press **Create file** to save it into your workspace, then **Open**. The AI never edits your originals.

**Decks are designed, not just typed.** The assistant picks a colour theme (slate, ocean, forest, sunset, violet, rose, mono, midnight) and a layout for every slide: title, section, bullets, two columns, cards, big-number stats, native charts, tables, a timeline, a quote, a closing slide. Text is sized to fit, and every slide is real PowerPoint content you can edit.

### Change the document you have open
- **Spreadsheet and Presentation:** press **✎ Edit this document with the assistant** (above the message box) to open the app's own assistant. It reads the workbook or the slides and changes them with tools (writing cells and formulas, rewriting slide text, adding slides), and every change has an **Undo**.
- **Documents:** its assistant drafts, rewrites and summarises the selection or the whole document, and you insert the result.

It works the same with Claude Code, Codex, a local model or an API key.

### Allow editing workspace files
With Claude Code or Codex you can tick *Allow editing workspace files* to let the tool read and change files in your workspace folder directly. Leave it off unless you want that.

## 5. Local models

1. Install **Ollama** (ollama.com) or **LM Studio** (lmstudio.ai) and start it.
2. In AI settings choose **Local model** and press **Detect**.
3. Pick an installed model, or download one with Ollama from the list.
4. Press **Save & test**.

Small models are fast but can struggle with long documents or with the file format for new files; larger ones do better. The *context window* setting controls how much text the model can read at once.

## 6. Settings and themes

The **gear** at the top right (or **Alt+,**) opens **Settings**, with its sections on the left and **Save** at the bottom:

- **General**: what Atelier Lite shows when it starts (the welcome screen or your last workspace), the folder offered for new workspaces, and whether closing asks to save the session.
- **Appearance**: **Light**, **Dark** or **System**, the **colour theme** (Indigo, Ocean, Forest, Amber, Rose, Violet, Graphite, Paper), **Text size** (Normal, Large, Largest) and **Reduce animation**.
- **AI assistant**: choose the provider and its keys (see section 4).
- **Security**: protect the workspace with a password, PIN or security question, choose when it locks itself, and make a new recovery key.
- **Performance**: **Low-power mode**, how long an unused tab waits before it goes to sleep, how many tabs stay awake, and the memory Atelier Lite is using now.
- **Shortcuts** and **About and report**.

Changes in General, Appearance and Performance wait for **Save**; the AI and Security screens have their own buttons. One choice of mode and colour paints the title bar, Home, the assistant and every app, so they always match. The Light / Dark switch in an app's account menu changes the whole of Atelier Lite too. Document pages stay white, like paper.

### Linking one file to another

Press **Ctrl+Shift+K** inside any app, choose a workspace file, and a link to it is put in at the cursor. Clicking the link opens that file in a tab. Outside an editable spot the link is copied for you to paste. You can also paste an `atelier://open/Folder/File.ext` address into the Insert link box of any app.

## 7. Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Alt+1 … Alt+4 | Open an app |
| Alt+H | Home |
| Alt+, | Settings |
| Ctrl+Shift+K | Link to another file |
| Alt+A | Show / hide the AI assistant |
| Alt+T | New tab (same app) |
| Alt+W | Close tab |
| Alt+PageUp / PageDown | Previous / next tab |
| F1 | Help & About |
| Esc | Close a menu or dialog |

## 8. Privacy

- Your files stay on your computer. Atelier Lite has no account and no cloud.
- Text leaves your PC only when you ask the AI, and only to the provider you chose. With a local model it never leaves.
- API keys are stored encrypted with Windows.
- A workspace can be locked with a password, PIN or security question, which encrypts its files (see *Protect a workspace with a lock*).

## 9. Running on a modest PC

Atelier Lite starts light: only Home runs at first, and the tab strip, the AI panel and dialogs load when first used. Tabs you are not using go to sleep by themselves (they keep their place in the strip and open again in a moment; a file with unsaved changes never sleeps). Turn on **Low-power mode** in Settings, Performance, for older PCs: fewer effects, two tabs awake at most. To keep memory low on an 8 GB machine, also close tabs you are finished with. Very large PDFs (up to 5,000 pages / 300 MB) open, but they need memory; close other large tabs first.

## 10. Troubleshooting

- **The AI says it isn't set up**: open Settings, AI assistant, choose a provider; use *Save & test*.
- **Claude Code / Codex shows "Not found"**: install it and sign in once in a terminal, then reopen settings.
- **Local model can't be reached**: start Ollama or LM Studio, then press *Detect*.
- **A file I made isn't on Home**: Home refreshes every few seconds; open Home again, or check the folder.
- **Reset Atelier Lite's settings**: close it and delete `%APPDATA%\atelier-lite\atelier.json`. Your files are not touched.

## 11. Updates

Atelier Lite does not contact any server. A new version arrives as a new installer: run it over the old one and your settings and workspace are kept.
