# nclaw — NeuroClaw CLI

> A Claude Code / opencode-inspired terminal client for your self-hosted [NeuroClaw](https://github.com/The-Code-Labz/neuroclaw) multi-agent system.
> Run it in **any directory on any machine** — agents read and write files right where you are.

---

## How it works

When you run `nclaw` in a directory, it:

1. Scans your current working directory and sends a file tree to the agent as context
2. Streams the agent's response live in your terminal
3. When the agent calls file or shell tools (`fs_read`, `fs_write`, `bash_run`, etc.) those execute **locally on your machine in your current directory** — not on the NeuroClaw server
4. Results are sent back to the agent so it can continue

This is the same relay model used by Claude Code and opencode. The NeuroClaw server handles AI reasoning; your machine handles local execution.

```
You (any machine)          NeuroClaw Server
─────────────────          ──────────────────
cd ~/my-project
nclaw  ──── message + file tree ────▶  Agent thinks
       ◀─── tool_call: fs_write ────
writes file locally
       ──── tool result ────────────▶  Agent continues
       ◀─── chunk: "Done!" ─────────
```

---

## Features

- **Works anywhere** — run in any directory; all file/shell ops happen there
- **Real-time streaming** — watch agents think, use tools, and respond live
- **Full tool relay** — `fs_read`, `fs_write`, `fs_list`, `fs_search`, `bash_run` all execute locally
- **Rich TUI** — markdown rendering, tool progress, reasoning blocks, git-aware footer
- **Arrow-key agent picker** — `/agent` to switch between active NeuroClaw agents
- **Slash commands** — `/help`, `/clear`, `/new`, `/agent`, `/retry`, `/copy`, `/update`, `/exit`
- **`/update`** — pull latest + rebuild without leaving the TUI
- **Paste detection** — large pastes summarised inline, expanded on send
- **Tool confirmation** — shell commands prompt `y/a/n` with a persistent allowlist
- **Session continuity** — session ID maintained; `/new` to reset
- **Persistent history** — input history saved to `~/.nclaw/history.json`
- **`AGENT.md` support** — drop an `AGENT.md` in your project; it's injected into every request as project context

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

| Field | Description |
|-------|-------------|
| **Server URL** | Your NeuroClaw instance, e.g. `https://neuroclaw.yourdomain.com` |
| **Token** | Your dashboard token (`DASHBOARD_TOKEN` in your NeuroClaw `.env`) |

Config saved to `~/.nclaw/config.json`. Override with env vars at any time:

```bash
export NEUROCLAW_URL=https://neuroclaw.yourdomain.com
export NEUROCLAW_TOKEN=your_token_here
nclaw
```

---

## Usage

```bash
nclaw                  # launch TUI in current directory
nclaw config           # configure server URL + token
nclaw --yolo           # skip all tool confirmation prompts
```

### Working directory matters

```bash
cd ~/my-react-app
nclaw
# → agent sees your React project, writes files there, runs npm commands there

cd ~/my-python-api
nclaw
# → agent sees your Python project, writes files there, runs pip/pytest there
```

The agent always operates in **the directory you launched nclaw from**.

### AGENT.md — project context file

Drop an `AGENT.md` in any project directory and nclaw will inject it into every request:

```bash
cd ~/my-project
nclaw init      # scaffolds an AGENT.md template  (coming soon)
# or create it manually
```

The file tells the agent about your tech stack, key commands, architecture, and any special instructions. No more re-explaining your project every session.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | Insert newline |
| `Ctrl+C` | Abort stream / exit |
| `Esc` | Abort stream / dismiss suggestions |
| `↑ / ↓` | History navigation / suggestion picker |
| `Tab` | Accept slash-command suggestion |
| `Ctrl+U` | Clear input |
| `Ctrl+W` | Delete word |
| `Ctrl+K` | Delete to end of line |
| `Ctrl+A` / `Home` | Beginning of line |
| `Ctrl+E` / `End` | End of line |

---

## Slash commands

| Command | Description |
|---------|-------------|
| `/help` | Show command reference |
| `/clear` | Clear the screen |
| `/new` | Start a new session |
| `/agent` | Switch agent (arrow-key picker) |
| `/retry` | Re-send last message |
| `/copy` | Copy last agent reply to clipboard |
| `/permissions` | View tool allowlist |
| `/update` | Pull latest nclaw from GitHub and rebuild |
| `/exit` | Quit |

---

## Tool confirmation

When an agent wants to run a shell command, nclaw shows:

```
Run?  git status -s
y yes  a always  n no
```

- `y` — allow once
- `a` — add to allowlist (`~/.nclaw/permissions.json`); never prompted again for this command head
- `n` — deny; agent sees `{ error: "user denied" }`

Use `--yolo` to skip all prompts for the session.

---

## Updating

From inside the TUI:
```
/update
```

Or from the shell:
```bash
cd ~/.nclaw-cli   # or wherever you cloned it
git pull
npm install
npm run build
```

---

## Requirements

- Node.js ≥ 20
- A running NeuroClaw server with a valid `DASHBOARD_TOKEN`
- Git (for `/update` and branch display in footer)

---

## Architecture

```
nclaw (runs on your machine)        NeuroClaw server
────────────────────────────        ─────────────────────
src/index.tsx      entry            /api/status   health check
src/config.ts      ~/.nclaw/config  /api/agents   agent list
src/remote.ts      SSE stream ──────/api/chat ────agent response
src/executor.ts    LOCAL tool exec  /api/chat/tool-result
src/tree.ts        cwd file tree
src/history.ts     persistent history
src/updater.ts     self-update
src/permissions.ts allowlist

src/ui/
  App.tsx          root state machine
  MessageBubble.tsx chat renderer
  InputBar.tsx     prompt + picker
  Footer.tsx       status bar
  Welcome.tsx      splash screen
  Spinner.tsx      braille animation
  markdown.ts      chalk renderer
  theme.ts         colour palette
```

---

## Files created by nclaw

| Path | Purpose |
|------|---------|
| `~/.nclaw/config.json` | Server URL + token |
| `~/.nclaw/history.json` | Input history (500 entries) |
| `~/.nclaw/permissions.json` | Tool allowlist |

Everything else is created **in the directory you run nclaw from**.

---

## License

MIT — © NeuroClaw / The Code Labz
