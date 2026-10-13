#!/usr/bin/env bash
set -euo pipefail
ARENA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ARENA_ROOT"
if [[ -f .env ]]; then
  set -a
  source ./.env
  set +a
fi
exec npm run dev:services
