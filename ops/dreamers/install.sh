#!/usr/bin/env bash
# ops/dreamers/install.sh — DREAMERS-001 §5
#
# Copies the runtime out of the repo into ~/.openclaw/dreamers/, installs the user unit,
# reloads systemd, prints the env NAMES it expects, and STOPS.
#
# IT DOES NOT ENABLE OR START THE SERVICE (§8). That is Francis's command, after a clean
# --dry-run. It also never reads, prints or writes ~/.openclaw/dreamers.env.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="$HOME/.openclaw/dreamers"
UNIT_DIR="$HOME/.config/systemd/user"

mkdir -p "$RUNTIME/personas" "$UNIT_DIR"

# The runtime is exactly what the loop needs at run time. The tests and this installer
# stay in the repo — the service has no reason to carry them.
cp "$SRC/loop.mjs"            "$RUNTIME/loop.mjs"
cp "$SRC/gate.mjs"            "$RUNTIME/gate.mjs"
cp "$SRC/context.md"          "$RUNTIME/context.md"
cp "$SRC/personas/beatrix.md" "$RUNTIME/personas/beatrix.md"
cp "$SRC/personas/anthony.md" "$RUNTIME/personas/anthony.md"
cp "$SRC/dreamers.service"    "$UNIT_DIR/dreamers.service"

chmod 600 "$RUNTIME"/*.mjs "$RUNTIME"/*.md "$RUNTIME"/personas/*.md 2>/dev/null || true

systemctl --user daemon-reload

echo "installed:"
echo "  runtime  $RUNTIME/{loop.mjs,gate.mjs,context.md,personas/{beatrix,anthony}.md}"
echo "  unit     $UNIT_DIR/dreamers.service"
echo
echo "expected in $HOME/.openclaw/dreamers.env (0600) — NAMES only, this script never reads it:"
echo "  BEATRIX_API_KEY"
echo "  ANTHONY_API_KEY"
echo "  DREAMERS_HONEYCOMB_ID"
echo
echo "NOT started. Next, in this order:"
echo "  1  node $RUNTIME/loop.mjs --dry-run        # twice; check the speaker alternates"
echo "  2  systemctl --user enable --now dreamers  # Francis only, after a clean dry-run"
