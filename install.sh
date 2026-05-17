#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
#  nclaw — NeuroClaw CLI installer
#
#  Usage (one-liner from any machine):
#    curl -fsSL https://raw.githubusercontent.com/The-Code-Labz/nclaw-cli/main/install.sh | bash
#
#  Or clone & run:
#    git clone https://github.com/The-Code-Labz/nclaw-cli && cd nclaw-cli && bash install.sh
#
#  What this does:
#    1. Checks Node ≥ 20.
#    2. Clones the repo (or pulls latest if already cloned).
#    3. Runs `npm install` + `npm run build`.
#    4. Symlinks `nclaw` to /usr/local/bin (or ~/bin if not root).
#    5. Prompts `nclaw config` on first run.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_URL="https://github.com/The-Code-Labz/nclaw-cli.git"
INSTALL_DIR="${NCLAW_DIR:-$HOME/.nclaw-cli}"
BIN_LINK=""

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}  ✓${RESET} $*"; }
info() { echo -e "${CYAN}  →${RESET} $*"; }
warn() { echo -e "${YELLOW}  ⚠${RESET} $*"; }
die()  { echo -e "${RED}  ✗${RESET} $*" >&2; exit 1; }

echo ""
echo -e "${BOLD}  NeuroClaw CLI — installer${RESET}"
echo ""

# ── Node version check ────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  die "Node.js not found. Install Node ≥ 20 from https://nodejs.org"
fi
NODE_VER=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node $NODE_VER is too old. nclaw requires Node ≥ 20."
fi
ok "Node $NODE_VER detected"

# ── Clone / update ────────────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing install at $INSTALL_DIR…"
  git -C "$INSTALL_DIR" pull --ff-only origin main
else
  info "Cloning to $INSTALL_DIR…"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
ok "Source ready"

# ── Build ─────────────────────────────────────────────────────────────────────
info "Installing dependencies…"
npm install --prefix "$INSTALL_DIR" --silent
info "Building…"
npm run build --prefix "$INSTALL_DIR" --silent
ok "Build complete"

# ── Symlink ───────────────────────────────────────────────────────────────────
TARGET="$INSTALL_DIR/dist/index.js"
chmod +x "$TARGET"

if [ -w "/usr/local/bin" ]; then
  BIN_LINK="/usr/local/bin/nclaw"
else
  mkdir -p "$HOME/bin"
  BIN_LINK="$HOME/bin/nclaw"
  if [[ ":$PATH:" != *":$HOME/bin:"* ]]; then
    warn "Add ~/bin to your PATH: export PATH=\"\$HOME/bin:\$PATH\""
  fi
fi

ln -sf "$TARGET" "$BIN_LINK"
ok "Linked → $BIN_LINK"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  Installation complete!${RESET}"
echo ""
echo -e "  Run ${CYAN}nclaw config${RESET} to connect to your NeuroClaw server."
echo -e "  Then run ${CYAN}nclaw${RESET} to start chatting."
echo ""

# Auto-launch config if no config exists.
NCLAW_CFG="$HOME/.nclaw/config.json"
if [ ! -f "$NCLAW_CFG" ]; then
  read -r -p "  Run 'nclaw config' now? [Y/n] " ANSWER
  if [[ "$ANSWER" =~ ^[Yy]?$ ]]; then
    "$BIN_LINK" config
  fi
fi
