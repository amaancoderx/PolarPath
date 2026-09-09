#!/usr/bin/env bash
# PolarPath launcher.  ./run.sh [--dev]
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$root"

echo
echo "  PolarPath"
echo "  Antarctic sea-ice, iceberg trajectory and navigation decision support"
echo

if [ ! -f backend/data/artefacts/sea_ice_forecaster.joblib ]; then
  echo "  Building model artefacts. First run only, a few minutes."
  python backend/scripts/train.py
  echo
fi

if [ "${1:-}" = "--dev" ]; then
  [ -d frontend/node_modules ] || (cd frontend && npm install)
  python -m uvicorn polarpath.main:app --app-dir backend --port 8000 --reload &
  trap 'kill $! 2>/dev/null' EXIT
  cd frontend && npm run dev
else
  if [ ! -f frontend/dist/index.html ]; then
    [ -d frontend/node_modules ] || (cd frontend && npm install)
    (cd frontend && npm run build)
  fi
  echo "  Open http://127.0.0.1:8000"
  echo
  python -m uvicorn polarpath.main:app --app-dir backend --port 8000 --host 127.0.0.1
fi
