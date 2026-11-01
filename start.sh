#!/usr/bin/env bash
set -eo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"
if [[ ! -x .venv/bin/python ]]; then
  echo "Missing .venv/bin/python. Complete docs/LOCAL_SETUP.md first." >&2
  exit 1
fi
exec .venv/bin/python scripts/dev.py "$@"
