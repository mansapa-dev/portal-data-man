module.exports = {
  apps: [{
    name: 'arena-api',
    cwd: process.env.ARENA_DIR || '/srv/arena',
    script: 'apps/api/dist/server.js',
    exec_mode: 'cluster',
    instances: 3,
    kill_timeout: 60000,
    max_memory_restart: process.env.ARENA_MAX_MEMORY_RESTART || '1200M',
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
      DB_POOL_SIZE: '12',
      DB_QUEUE_LIMIT: '240',
      DB_CONNECT_TIMEOUT_MS: '10000',
      PASSWORD_VERIFY_WORKERS: '1',
      EXAM_QUESTION_SOURCE_TTL_MS: '2000',
      EXAM_QUESTION_REDIS_TTL_MS: '2000',
      WAITING_BATCH_SIZE: '300',
      WAITING_BATCH_INTERVAL_MS: '10000',
      WAITING_HEARTBEAT_TIMEOUT_MS: '90000',
      WAITING_CLAIM_TIMEOUT_MS: '60000',
      WAITING_WORKER_ENABLED: 'false',
      ATTEMPT_FINALIZER_ENABLED: 'false',
      // Tahap 2 (submit async) belum diaktifkan di production: proses API
      // memakai jalur finalisasi sinkron lama sampai migrasi 016 terpasang
      // dan load test staging selesai.
      SUBMIT_ASYNC: 'off',
    },
  }, {
    name: 'arena-finalization',
    max_memory_restart: '512M',
    cwd: process.env.ARENA_DIR || '/srv/arena',
    script: 'apps/api/dist/finalization-worker.js',
    instances: 1,
    exec_mode: 'fork',
    kill_timeout: 60000,
    env: { NODE_ENV: 'production', DB_POOL_SIZE: '6', DB_QUEUE_LIMIT: '24', FINALIZATION_CONCURRENCY: '4' },
  }, {
    name: 'arena-waiting',
    max_memory_restart: '256M',
    cwd: process.env.ARENA_DIR || '/srv/arena',
    script: 'apps/api/dist/waiting-worker.js',
    instances: 1,
    exec_mode: 'fork',
    kill_timeout: 60000,
    env: { NODE_ENV: 'production', DB_POOL_SIZE: '4', DB_QUEUE_LIMIT: '24' },
  }],
};
