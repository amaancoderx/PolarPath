#!/usr/bin/env bash
# Capture interface screenshots with headless Chrome. The server must be running.
#
#   ./docs/shots/capture.sh [base-url]
#
# Console state is carried in the query string, so any view worth putting in a
# deck can be captured by adding a line here.
set -euo pipefail

CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="${1:-http://127.0.0.1:8000}"

shot() {
  local name="$1" query="$2" profile
  profile="$(mktemp -d)"
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars     --user-data-dir="$profile" --window-size=1680,1000     --virtual-time-budget=26000     --screenshot="$OUT/$name.png" "$URL/?$query" >/dev/null 2>&1 || true
  rm -rf "$profile"
  echo "captured $name"
}

shot operations "view=operations"
shot skill      "view=skill"
shot benchmark  "view=benchmark"
shot method     "view=method"
shot forecast   "view=operations&layer=risk&day=10"
shot infeasible "view=operations&vessel=sagarnidhi&to=hal"
