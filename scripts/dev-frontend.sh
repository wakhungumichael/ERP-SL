#!/usr/bin/env bash
set -eo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# VS Code tasks may start a non-interactive shell that has not loaded nvm.
if ! command -v node >/dev/null 2>&1; then
  NVM_SCRIPT="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [[ -s "$NVM_SCRIPT" ]]; then
    source "$NVM_SCRIPT"
  fi
fi

if ! command -v node >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1; then
  echo "Node.js and pnpm are required in Linux/WSL. See docs/LOCAL_SETUP.md." >&2
  exit 1
fi

exec pnpm --filter @workspace/erp-ui dev "$@"
