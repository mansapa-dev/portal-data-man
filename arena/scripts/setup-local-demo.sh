#!/usr/bin/env bash
set -euo pipefail
ARENA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ARENA_ROOT"
DB_CONTAINER=arena-local-db

if docker container inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  if [[ ! -f .env ]]; then
    echo "Container $DB_CONTAINER sudah ada, tetapi arena/.env tidak ditemukan. Pulihkan konfigurasi lokal sebelum melanjutkan."
    exit 1
  fi
  set -a
  source ./.env
  set +a
  npm run demo:migrate:integrity
  npm run demo:seed
  echo "Database demo sudah tersedia. Jalankan: npm run dev:local"
  exit 0
fi

if [[ -f .env ]]; then
  echo "arena/.env sudah ada tetapi container $DB_CONTAINER belum ada. Hapus hanya jika yakin ingin membuat DB demo baru."
  exit 1
fi

ARENA_LOCAL_DB_PASSWORD="$(openssl rand -hex 24)"
ARENA_LOCAL_ROOT_PASSWORD="$(openssl rand -hex 24)"
ARENA_AUTH_SECRET="$(openssl rand -hex 32)"
ARENA_PIN_SECRET="$(openssl rand -hex 32)"
ARENA_SETUP_TOKEN="$(openssl rand -hex 24)"
umask 077
cat > .env <<EOF
HOST=127.0.0.1
PORT=3001
LOG_LEVEL=info
DATABASE_URL=mysql://arena_app:${ARENA_LOCAL_DB_PASSWORD}@127.0.0.1:3308/arena
DB_POOL_SIZE=10
DB_QUEUE_LIMIT=200
ATTEMPT_FINALIZER_ENABLED=false
AUTH_TOKEN_SECRET=${ARENA_AUTH_SECRET}
PIN_ENCRYPTION_KEY=${ARENA_PIN_SECRET}
TRUST_PROXY=false
SETUP_TOKEN=${ARENA_SETUP_TOKEN}
ARENA_WEB_HOST=127.0.0.1
ARENA_WEB_PORT=5173
ARENA_API_URL=http://127.0.0.1:3001
ARENA_UPLOAD_DIR=./storage/question-images
EOF

docker run -d --name "$DB_CONTAINER" --restart unless-stopped \
  -e MYSQL_ROOT_PASSWORD="$ARENA_LOCAL_ROOT_PASSWORD" \
  -e MYSQL_DATABASE=arena -e MYSQL_USER=arena_app \
  -e MYSQL_PASSWORD="$ARENA_LOCAL_DB_PASSWORD" \
  -p 127.0.0.1:3308:3306 -v arena-local-db:/var/lib/mysql mysql:8.4 >/dev/null

ready=false
for _ in $(seq 1 60); do
  if docker exec "$DB_CONTAINER" mysqladmin ping -h 127.0.0.1 --silent >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs --tail 40 "$DB_CONTAINER"; exit 1; fi

set -a
source ./.env
set +a
npm run demo:migrate
npm run demo:seed
echo "Arena demo siap di http://localhost:5173"
