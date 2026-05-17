# nclaw — NeuroClaw CLI

> A Claude Code / opencode-inspired terminal client for your self-hosted [NeuroClaw](https://github.com/The-Code-Labz/neuroclaw) multi-agent system.

![nclaw demo](https://raw.githubusercontent.com/The-Code-Labz/nclaw-cli/main/docs/demo.gif)

---

## Features

- **Real-time streaming** — SSE-based with tool relay; watch agents think and act live
- **Rich TUI** — Ink-based React renderer; markdown, syntax hints, tool progress, reasoning blocks
- **Arrow-key agent picker** — `/agent` to switch between all active NeuroClaw agents
- **Slash commands** — `/help`, `/clear`, `/new`, `/agent`, `/retry`, `/copy`, `/exit`
- **Paste detection** — large pastes are summarised inline; expanded on submit
- **Tool confirmation** — shell commands prompt y/a/n with an always-allow allowlist
- **Session continuity** — session ID maintained across messages; `/new` to reset
- **Git-aware footer** — shows branch + dirty flag, model, tokens, cost
- **Works on any machine** — just needs Node ≥ 20 and a NeuroClaw server token

---

## Install

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/The-Code-Labz/nclaw-cli/main/install.sh | bash
```

### Manual

```bash
git clone https://github.com/The-Code-Labz/nclaw-cli
cd nclaw-cli
npm install
npm run build
npm link          # makes `nclaw` available globally
```

### npx (no install)

```bash
npx nclaw
```

---

## Setup

```bash
nclaw config
```

You'll be prompted for:

| Field | Description |
|-------|-------------|
| **Server URL** | Your NeuroClaw instance, e.g. `https://neuroclaw.yourdomain.com` |
| **Token** | The dashboard token from your NeuroClaw `.env` (`DASHBOARD_TOKEN`) |

Config is saved to `~/.nclaw/config.json`.

### Environment variables (alternative)

```bash
export NEUROCLAW_URL=https://neuroclaw.yourdomain.com
export NEUROCLAW_TOKEN=your_token_here
nclaw
```

---

## Usage

```
nclaw                  # start the TUI
nclaw config           # reconfigure server + token
nclaw --yolo           # skip all tool confirmation prompts
```

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | Insert newline |
| `Ctrl+C` | Abort stream / exit |
| `Esc` | Abort stream |
| `↑ / ↓` | History / suggestion navigation |
| `Tab` | Accept slash-command suggestion |
| `Ctrl+U` | Clear input |
| `Ctrl+W` | Delete word |
| `Ctrl+K` | Delete to end of line |
| `Ctrl+A` / `Home` | Beginning of line |
| `Ctrl+E` / `End` | End of line |

### Slash commands

| Command | Description |
|---------|-------------|
| `/help` | Show command reference |
| `/clear` | Clear the screen |
| `/new` | Start a new session |
| `/agent` | Switch agent (arrow-key picker) |
| `/retry` | Re-send last message |
| `/copy` | Copy last agent reply to clipboard |
| `/permissions` | View tool allowlist |
| `/exit` | Quit |

---

## Configuration file

`~/.nclaw/config.json`:

```json
{
  "url": "https://neuroclaw.yourdomain.com",
  "token": "your_dashboard_token",
  "defaultAgent": null
}
```

---

## Permissions / tool confirmations

When A.S.A.G.I (or any agent) wants to run a shell command, nclaw prompts:

```
  Run command?  git status -s
  y yes  a always allow  n no
```

- `y` — allow once
- `a` — add to allowlist (`~/.nclaw/permissions.json`); auto-approved forever
- `n` — deny

Use `--yolo` to skip all prompts for the session.

---

## Requirements

- Node.js ≥ 20
- A running NeuroClaw server with a valid `DASHBOARD_TOKEN`
- Git (optional, for branch display)

---

## Architecture

```
nclaw (CLI)
  ├── src/index.tsx       — entry, config wizard, bracketed paste setup
  ├── src/remote.ts       — SSE streaming + tool relay to NeuroClaw server
  ├── src/executor.ts     — local tool execution (fs_read/write/list, bash_run)
  ├── src/config.ts       — ~/.nclaw/config.json + env var resolution
  ├── src/permissions.ts  — persistent tool allowlist
  ├── src/tree.ts         — cwd file tree context injected into requests
  └── src/ui/
        ├── App.tsx        — root state machine
        ├── MessageBubble.tsx — chat message renderer
        ├── InputBar.tsx   — prompt, confirm, agent picker
        ├── Footer.tsx     — status bar
        ├── Welcome.tsx    — startup splash
        ├── Spinner.tsx    — braille animation
        ├── markdown.ts    — marked + chalk renderer
        └── theme.ts       — colour palette + tool icons
```

---

## License

MIT — © NeuroClaw / The Code Labz
