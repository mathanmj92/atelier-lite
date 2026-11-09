# Changelog

All notable changes to Atelier Lite. The format follows [Keep a Changelog](https://keepachangelog.com/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0]

First release. Atelier Lite is Atelier 2.6.0 with the four office apps only.

### Included
- **Documents**, **Presentation**, **Spreadsheet** and **PDF Editor**, each in its own tab, with several of the same app open at once.
- Welcome screen with recent workspaces; create, open and rename workspaces; `.atle` project files.
- Home with every file in the workspace, with rename and delete.
- Tab strip with Home, the workspace menu and a **+** button for new files; Settings, Help and the AI assistant on the right.
- Settings: General, Appearance (light, dark, colour themes, text size), AI assistant, Security and Performance.
- AI assistant with Claude Code, Codex, local models, the Anthropic API, OpenAI-compatible APIs or a custom command; it reads files and creates documents, slides and sheets.
- Links between files (`Ctrl+Shift+K`, `atelier://open/...`).
- Workspace lock with password, PIN or security question (AES-256-GCM), plus a recovery key.
- Sleeping tabs and Low-power mode for older PCs.
- Asks to save the session when the window is closed; Report a problem.
- A user guide that opens as a Word document.

### Fixed before release
- Text on accent-coloured buttons and cards (such as Create workspace) is now dark in dark mode, so it is easy to read.
- Fixed a typo in the Security settings ("I vclose") and made the app name consistent as Atelier Lite in Settings, Security and About.
- The About page no longer claims the app never contacts a server; it says it does not check for updates by itself.

### Not included
Forms, Markdown, Notes and Whiteboard are part of the full Atelier and are not in Lite.

### Packaging
- Installs next to the full Atelier: its own app id (`com.atelier.lite`), its own settings and a default workspace folder `Documents\Atelier Lite`.
- File associations for `.docx`, `.pptx`, `.xlsx`, `.pdf` and `.atle`.
