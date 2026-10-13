#!/usr/bin/env bash
set -euo pipefail
ARENA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$ARENA_ROOT/.env" ]]; then
  echo "arena/.env belum ada. Jalankan setup lokal terlebih dahulu."
  exit 1
fi
cd "$ARENA_ROOT"
exec npm run dev
