const instances = 3;
const basePort = 3001;

const apiApps = Array.from({ length: instances }, (_, i) => ({
  name: `arena-api-${i + 1}`,
  cwd: process.env.ARENA_DIR || '/srv/arena',
  script: 'apps/api/dist/server.js',
  exec_mode: 'fork',
  instances: 1,
  kill_timeout: 60000,
  max_memory_restart: process.env.ARENA_MAX_MEMORY_RESTART || '1200M',
  env: {
    NODE_ENV: 'production',
    PORT: String(basePort + i),
    LOG_LEVEL: 'warn',
    DB_POOL_SIZE: '12',
    DB_QUEUE_LIMIT: '240',
    // Bulkhead login: 3 proses API x 4 koneksi auth, terpisah dari pool ujian.
    AUTH_DB_POOL_SIZE: '4',
    AUTH_DB_QUEUE_LIMIT: '240',
    DB_CONNECT_TIMEOUT_MS: '10000',
    PASSWORD_VERIFY_WORKERS: '2',
    PASSWORD_VERIFY_QUEUE_LIMIT: '5000',
    PASSWORD_VERIFY_QUEUE_TIMEOUT_MS: '20000',
    PASSWORD_VERIFY_CONCURRENCY_PER_WORKER: '1',
    EXAM_QUESTION_SOURCE_TTL_MS: '2000',
    EXAM_QUESTION_REDIS_TTL_MS: '2000',
    WAITING_BATCH_SIZE: '300',
    WAITING_BATCH_INTERVAL_MS: '10000',
    WAITING_HEARTBEAT_TIMEOUT_MS: '90000',
    WAITING_CLAIM_TIMEOUT_MS: '60000',
    WAITING_WORKER_ENABLED: 'false',
    ATTEMPT_FINALIZER_ENABLED: 'false',
    // Submit async aktif: penerimaan TX1 durable di MySQL, scoring di BullMQ worker.
    SUBMIT_ASYNC: 'on',
    SUBMIT_LEASE_MS: '60000',
    SUBMIT_LEASE_MAX_ATTEMPTS: '5',
  },
}));

module.exports = {
  apps: [
    ...apiApps,
    {
      name: 'arena-finalization',
      max_memory_restart: '512M',
      cwd: process.env.ARENA_DIR || '/srv/arena',
      script: 'apps/api/dist/finalization-worker.js',
      instances: 1,
      exec_mode: 'fork',
      kill_timeout: 60000,
      env: {
        NODE_ENV: 'production',
        DB_POOL_SIZE: '6',
        DB_QUEUE_LIMIT: '24',
        FINALIZATION_CONCURRENCY: '4',
        SUBMIT_ASYNC: 'on',
      },
    },
    {
      name: 'arena-waiting',
      max_memory_restart: '256M',
      cwd: process.env.ARENA_DIR || '/srv/arena',
      script: 'apps/api/dist/waiting-worker.js',
      instances: 1,
      exec_mode: 'fork',
      kill_timeout: 60000,
      env: {
        NODE_ENV: 'production',
        DB_POOL_SIZE: '4',
        DB_QUEUE_LIMIT: '24',
      },
    },
  ],
};
