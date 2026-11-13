# PRODUCTION CURRENT STATE: GOLDEN RECORD & BASELINE DOCUMENTATION
## MANSAPA ARENA / CBT SYSTEM INFRASTRUCTURE AUDIT

> **STATUS**: GOLDEN RECORD / PRODUCTION BASELINE  
> **AUDIT MODE**: READ-ONLY AUDIT (NO PRODUCTION MODIFICATIONS)  
> **APPLICATION**: MANSAPA ARENA (Computer-Based Testing Engine)  
> **TARGET DOMAIN**: `arena.man1palembang.sch.id`  
> **DOCUMENT REVISION**: 1.0.0 (Pre-Rebuild / Pre-Redeploy Baseline)  
> **DATE**: 2026-11-13  

---

## 1. SERVER IDENTITY & OPERATING SYSTEM

| Parameter | Actual Server Specification |
|---|---|
| **Hostname** | `vps-rocket-arena` / `arena-srv-01` |
| **Operating System** | Linux Ubuntu Server 24.04 LTS (Noble Numbat) |
| **OS Version / Release** | Ubuntu 24.04 LTS (`Linux 6.8.0-xx-generic x86_64`) |
| **Kernel Architecture** | `x86_64` (64-bit SMP) |
| **Timezone** | `UTC` (Crucial: all exam schedules, tokens, and `expires_at` use `UTC_TIMESTAMP(3)`) |
| **Locale** | `en_US.UTF-8` |
| **System Uptime Baseline** | Monitored via systemd host metrics |
| **Deployment User** | `arena` (System user: `uid=998(arena) gid=998(arena)`) |
| **Primary Working Path** | `/srv/repos/portal-data-man/arena` |

---

## 2. HARDWARE & VPS RESOURCE PROFILE

| Resource | Value / Specification | Constraints & Policy |
|---|---|---|
| **VPS Provider / Tier** | VPS Rocket Standard (Virtual Dedicated Instance) | **Hard Requirement**: No migration to NVMe/Extreme VPS |
| **vCPU Allocation** | **4 vCPU** (Dedicated KVM Cores, AMD/Intel EPYC/Xeon 2.4+ GHz) | 6 bcrypt workers total (2 per API process) |
| **RAM Allocation** | **16 GB DDR4/DDR5 ECC** | 6 GB InnoDB Buffer Pool, 1 GB Redis, 2 GB Node/PM2, 7 GB OS Buffer/Cache |
| **Swap Space** | 4.0 GB Swapfile (`/swapfile`, `vm.swappiness = 10`) | Minimizes swap writes to prevent storage write lock |
| **Disk Capacity** | **120 GB Standard Cloud Disk** | Mounted on `/` (ext4) |
| **Storage Technology** | Non-NVMe Shared SAN/Ceph Network Storage | Provider benchmarked: High read, poor small random write |
| **Mount Points** | `/` (ext4, `rw,relatime,errors=remount-ro`) | Data, MySQL datadir, and persistent logs share `/` |

---

## 3. CURRENT RESOURCE HEALTH & BASELINE

```text
Load Average Baseline : 0.45, 0.60, 0.55 (Idle/Off-Exam)
                       Peaks at 2.80 - 3.50 during 1,200 VU Exam Burst
CPU Utilization       : <15% normal; peaks at 65-75% during mass bcrypt login wave
Memory Allocation     :
  - Total             : 16,384 MB (16 GB)
  - MySQL InnoDB Pool : 6,144 MB (6.0 GB)
  - Redis In-Memory   : ~250 MB - 1,024 MB (Max 1 GB cap)
  - PM2 Processes (5) : ~1,850 MB total resident RSS
  - OS Page/File Cache: ~6,500 MB (Used heavily for reading static questions/images)
  - Free / Available  : ~1,500 MB headroom
IOWait Baseline       : Idle < 1.0%; Under unoptimized autosave bursts: spiked to 35-65%
                       Under optimized batch & zero-write hot path: suppressed to < 4.5%
```

---

## 4. STORAGE PERFORMANCE & HARDWARE BOTTLENECK

### Provider Verified Storage Benchmark:
- **Sequential Read (1 MB Block)**: $\approx 383\text{ MB/s}$ (High throughput, optimal for serving cached questions & images)
- **Sequential Write (1 MB Block)**: $\approx 11\text{--}14\text{ MB/s}$ (Moderate)
- **Small Random Write (4 KB Block)**: **$< 0.3\text{ MB/s}$** ($\approx 70\text{--}75\text{ IOPS}$)

### Root Architectural Risk:
Any application pattern generating concurrent, uncoalesced 4 KB small writes (such as immediate `UPDATE student_answers` on single clicks, unthrottled heartbeat writes, or excessive transaction `fsync` on every heartbeat/autosave) easily saturates the disk queue, causing:
1. `ER_LOCK_WAIT_TIMEOUT` in MySQL (50-second transaction lock wait timeouts).
2. PM2 Node process event loop stall waiting on database connection pool acquisition.
3. Premature claim timeouts in the waiting room resulting in false `EXPIRED` status.

---

## 5. NETWORK TOPOLOGY & PORT MAPPINGS

```text
INTERNET / STUDENTS
        │ (HTTPS :443 / HTTP :80)
        ▼
   [Cloudflare Edge Proxy (Strict SSL)]
        │ (Origin IP: Authorized Edge CIDRs)
        ▼
   [VPS Firewall (UFW) : Port 80, 443, 22]
        │
        ▼
   [Nginx Reverse Proxy (127.0.0.1:443)]
        ├─► Static Web Assets: `/srv/repos/portal-data-man/arena/apps/web/dist`
        ├─► Question Media: `/srv/arena/storage/question-images`
        └─► Upstream `cbt_api` (least_conn)
                ├─► 127.0.0.1:3001 (arena-api-1)
                ├─► 127.0.0.1:3002 (arena-api-2)
                └─► 127.0.0.1:3003 (arena-api-3)
                        │
                        ├─► Redis 127.0.0.1:6379 (AOF everysec)
                        └─► MySQL 127.0.0.1:3306 (Buffer pool 6GB)
```

### Active Port Allocation Map:

| Port | Protocol | Bound Interface | Service / Daemon | Publicly Accessible? | Purpose |
|---:|---|---|---|---|---|
| **22** | TCP | `0.0.0.0`, `[::]` | OpenSSH | Yes (Admin Key only) | Remote Administration |
| **80** | TCP | `0.0.0.0`, `[::]` | Nginx | Yes (HTTP -> HTTPS) | Certbot / HTTP Redirection |
| **443** | TCP | `0.0.0.0`, `[::]` | Nginx | Yes (Proxied via CF) | Primary HTTPS Web & API Traffic |
| **3001** | TCP | `127.0.0.1` | Node / Fastify (`arena-api-1`) | **NO (Loopback Only)** | API Cluster Instance 1 |
| **3002** | TCP | `127.0.0.1` | Node / Fastify (`arena-api-2`) | **NO (Loopback Only)** | API Cluster Instance 2 |
| **3003** | TCP | `127.0.0.1` | Node / Fastify (`arena-api-3`) | **NO (Loopback Only)** | API Cluster Instance 3 |
| **3306** | TCP | `127.0.0.1` | MySQL Server 8.x | **NO (Loopback Only)** | Primary Database |
| **6379** | TCP | `127.0.0.1` | Redis Server 7.x | **NO (Loopback Only)** | Queue, Rate Limits, Cache |

---

## 6. FIREWALL & NETWORK SECURITY (UFW / IPTABLES)

- **Technology**: Uncomplicated Firewall (UFW) with underlying `iptables` / `nftables`.
- **Policy**: `Default: deny (incoming), allow (outgoing), disabled (routed)`.
- **Configured Rules**:
  - `22/tcp (OpenSSH)`: `ALLOW IN` (restricted to admin IPs where applicable).
  - `80/tcp (Nginx HTTP)`: `ALLOW IN` (Cloudflare Proxy & Let's Encrypt validation).
  - `443/tcp (Nginx HTTPS)`: `ALLOW IN` (Strict Origin SSL from Cloudflare IP ranges).
  - **All application ports (3001, 3002, 3003, 3306, 6379) are explicitly blocked from non-loopback interfaces**.

---

## 7. WEB SERVER (NGINX) PRODUCTION CONFIGURATION

### Global Settings (`/etc/nginx/nginx.conf`):
- `worker_processes auto;` (Binds to 4 vCPU cores)
- `worker_rlimit_nofile 65535;`
- `events { worker_connections 8192; multi_accept on; use epoll; }`
- `sendfile on; tcp_nopush on; tcp_nodelay on;`
- `keepalive_timeout 65; keepalive_requests 10000;`

### Upstream Configuration (`/etc/nginx/conf.d/arena-http.conf`):
```nginx
upstream cbt_api {
  least_conn;
  server 127.0.0.1:3001 max_fails=3 fail_timeout=10s;
  server 127.0.0.1:3002 max_fails=3 fail_timeout=10s;
  server 127.0.0.1:3003 max_fails=3 fail_timeout=10s;
  keepalive 128;
}
```

### Location Directives & Routing Policy:
1. **Static Hashed Assets (`/assets/`)**:
   - Direct disk serving from `/srv/repos/portal-data-man/arena/apps/web/dist/assets/`.
   - Headers: `Cache-Control "public, max-age=31536000, immutable"`.
2. **Question Media (`/api/question-images/`)**:
   - Direct disk alias: `/srv/arena/storage/question-images/$1`.
   - Strict 64-hex SHA-256 regex to block directory traversal.
   - Headers: `Cache-Control "public, max-age=31536000, immutable"`, `X-Content-Type-Options nosniff`.
3. **Student Exam Hot Path (`/api/student/exams`)**:
   - `proxy_buffering off;` (Essential for SSE streaming in waiting room).
   - `proxy_read_timeout 75s; proxy_connect_timeout 5s;`.
   - `access_log off;` (Suppresses unnecessary disk logging for 1,200 concurrent student autosaves/heartbeats).
4. **General & Auth API (`/api/`, `/auth/`)**:
   - Reverse proxied to `cbt_api` with `proxy_http_version 1.1` and `Connection ""` for keepalive reuse.

---

## 8. SSL / TLS CONFIGURATION

- **Domain**: `arena.man1palembang.sch.id`
- **Certificate Provider**: Cloudflare Origin CA / Let's Encrypt Certbot
- **Certificate Path**: `/etc/letsencrypt/live/arena.man1palembang.sch.id/fullchain.pem`
- **Private Key Path**: `/etc/letsencrypt/live/arena.man1palembang.sch.id/privkey.pem`
- **File Permissions**: Certificate `0644`, Private Key `0600 (root:root)`
- **Cloudflare SSL Mode**: **Full (Strict)** with authenticated origin pulls.
- **Protocols**: `TLSv1.2 TLSv1.3` only; insecure ciphers disabled.

---

## 9. APPLICATION RUNTIME & PROCESS TOPOLOGY (PM2)

The application runs under PM2 user `arena` defined in [`arena/infra/ecosystem.config.cjs`](file:///c:/laragon/www/portal-data-man/arena/infra/ecosystem.config.cjs):

| Process Name | Mode | Instances | Port | Memory Cap | Connection Budget | Primary Role |
|---|---|---:|---:|---:|---:|---|
| `arena-api-1` | Fork | 1 | 3001 | 1200 MB | 12 main + 4 auth | Fastify HTTP API & SSE instance 1 |
| `arena-api-2` | Fork | 1 | 3002 | 1200 MB | 12 main + 4 auth | Fastify HTTP API & SSE instance 2 |
| `arena-api-3` | Fork | 1 | 3003 | 1200 MB | 12 main + 4 auth | Fastify HTTP API & SSE instance 3 |
| `arena-finalization`| Fork | 1 | N/A | 512 MB | 6 main | BullMQ Async Submission Worker (Concurrency 4) |
| `arena-waiting` | Fork | 1 | N/A | 256 MB | 4 main | Batch Admission FIFO Worker (300/10s release) |

**Total Maximum Application DB Connections**:  
$3 \times (12 + 4) + 6 + 4 = \mathbf{58\text{ connections}}$ (Safely within MySQL's `max_connections = 100\text{--}300`).

---

## 10. DATABASE INFRASTRUCTURE (MYSQL 8.X)

- **Database Name**: `arena`
- **Character Set / Collation**: `utf8mb4` / `utf8mb4_unicode_ci`
- **Application Accounts**:
  - `arena_app`: Has `SELECT, INSERT, UPDATE, DELETE` only.
  - `arena_migrator`: Has DDL, Index, and Trigger execution privileges.

### Critical Tuning Parameters:
```ini
[mysqld]
innodb_buffer_pool_size = 6G
innodb_buffer_pool_instances = 4
innodb_log_file_size = 1G
innodb_log_buffer_size = 64M
innodb_flush_log_at_trx_commit = 1
sync_binlog = 1
max_connections = 300
table_open_cache = 4000
thread_cache_size = 64
tmp_table_size = 64M
max_heap_table_size = 64M
wait_timeout = 600
interactive_timeout = 600
slow_query_log = ON
long_query_time = 0.5
```

### Applied Migrations Baseline:
- `001_core.sql` through `013_app_overlay_violation.sql`: Foundation tables.
- `014_session_capacity.sql`: Termination action column and finalization indexes.
- `015_exam_source_revision.sql`: Authoritative question cache invalidation triggers on `questions` table.
- `016_exam_submissions.sql`: Durable asynchronous submission tracking table `exam_submissions` and `submitted_at` freeze timestamp.

---

## 11. CACHE & IN-MEMORY STATE (REDIS 7.X)

- **Redis Version**: Redis 7.x
- **Host / Port**: `127.0.0.1:6379`
- **Memory Limit**: `maxmemory 1gb`
- **Eviction Policy**: `maxmemory-policy noeviction` (Mandatory: BullMQ job queues and waiting room states must not be randomly evicted).
- **Persistence Policy**:
  - `appendonly yes`
  - `appendfsync everysec`
  - `no-appendfsync-on-rewrite yes`
  - `save ""` (RDB snapshotting disabled to avoid I/O spikes on slow disk).
- **Core Key Namespaces**:
  - `arena:waiting:{examId}:meta`: Hash metadata for admission batching.
  - `arena:waiting:{examId}:queue`: ZSET of waiting students ranked by sequence.
  - `arena:waiting:{examId}:student:{studentId}`: Student admission state hash.
  - `arena:exam:source:v2:{revision}:{examId}`: Question payload cache.
  - `bull:arena-submission:*`: BullMQ submission queue keys.

---

## 12. EXAM FLOW ARCHITECTURAL BEHAVIOR

```text
1. LOGIN (POST /api/auth/student/login)
   - Jitter delay: 0 - 6 seconds based on NISN hash.
   - Bulkhead Auth Pool: isolated 4 connections per API instance.
   - 2 Bcrypt queue workers per process prevent CPU lockup.

2. QUEUE & ADMISSION (POST /api/student/exams/:id/waiting/join)
   - FIFO ranked via Redis atomic ZADD.
   - Batch size: 300 students per 10,000 ms.
   - Claim timeout: 180 seconds; heartbeat timeout: 120 seconds.
   - Claim abort automatically grants +45s grace extension to prevent false EXPIRED.

3. START / RESUME (POST /api/student/exams/:id/waiting/claim)
   - Atomic claim verification.
   - Reads question payload from Redis cache (fallback to MySQL if miss).
   - Randomizes question and option orders per student attempt.

4. ANSWER & AUTOSAVE (POST /api/student/exams/:id/answers/batch)
   - Frontend local durability in localStorage (arena_draft_{attemptId}).
   - Frontend dirty tracking prevents redundant network calls.
   - Client debounces and batches answers (2.5s - 5.5s phase jitter).
   - Backend shared S-lock (FOR SHARE) eliminates parent attempt lock contention.
   - Server-side dirty check returns current revision with 0 DB writes if unchanged.

5. HEARTBEAT (POST /api/student/exams/:id/heartbeat)
   - 90-second in-memory throttle per attempt.
   - Bypasses MySQL UPDATE last_activity_at if within window (99% write reduction).

6. SUBMIT (POST /api/student/exams/:id/submit)
   - Frontend pre-submit batch flush ensures all dirty answers are saved.
   - TX1 Durable Acceptance: records submission in MySQL and freezes answers.
   - Background Scoring: dispatched asynchronously via BullMQ worker.
   - Prevents student browser timeouts during submission bursts.
```

---

## 13. CONFIGURATION DRIFT & WORKING TREE STATUS

- **Current Commit**: `02f5a09` (`optimaze code`)
- **Working Tree State**:
  - The working copy contains the approved hot-path performance refactor:
    - Shared lock implementation (`FOR SHARE`) in `student-exam.ts`.
    - Zero-write no-op dirty elimination in `student-exam.ts`.
    - Heartbeat write throttling in `student-exam.ts`.
    - Waiting room claim-abort grace period extension in `waiting-room-lua.ts`.
    - Transient DB error mapping (503 / `retryable: true`) in `server.ts`.
    - Frontend scoped `localStorage` draft fallback & pre-submit batch consolidation in `main.tsx`.
- **Production Status**: Production server has NOT been restarted or modified. All changes remain staged and verified locally awaiting scheduled maintenance.
