# PRODUCTION DEPENDENCY SPECIFICATION
## MANSAPA ARENA RUNTIME, SYSTEM, & THIRD-PARTY INVENTORY

> **SCOPE**: Complete manifest of all operating system packages, language runtimes, libraries, persistent stores, reverse proxies, and external cloud dependencies required to build and operate the production system.

---

## 1. OPERATING SYSTEM & CORE PACKAGES

| Package / Component | Distribution / Upstream | Minimum Version | Production Target Version | Purpose |
|---|---|---|---|---|
| **Base OS** | Canonical Ubuntu Server | 22.04 LTS | **Ubuntu 24.04 LTS (Noble)** | Base Linux Operating System |
| **Linux Kernel** | Ubuntu Linux Generic | 5.15+ | **6.8.0-xx-generic** | OS Kernel & Network Subsystem |
| **OpenSSL** | Canonical / OpenSSL | 3.0+ | **3.0.13+** | Cryptographic primitives & TLS |
| **CA-Certificates**| Ubuntu Security | Current | Current | SSL trust store for OIDC/SSO |
| **UFW / IPTables** | Netfilter Project | Current | Current | Host firewall protection |
| **Git** | Ubuntu upstream | 2.34+ | **2.43+** | Source repository management |
| **Tar / Gzip** | GNU Project | Current | Current | Backup compression |

---

## 2. LANGUAGE RUNTIME & PROCESS MANAGERS

| Runtime / Daemon | Provider / Upstream | Minimum Version | Production Target Version | Configuration / Execution Mode |
|---|---|---|---|---|
| **Node.js** | NodeSource Binary | **v22.0.0** | **v22.13.0+ (LTS)** | Native ESM runtime with `--env-file` |
| **npm** | Node.js Core | 10.0+ | **10.8.0+** | Monorepo package manager |
| **PM2** | Global npm (`pm2`) | 5.3+ | **5.4.3+** | Process supervisor, cluster, auto-restart |

---

## 3. PRIMARY STORAGE & CACHE DAEMONS

| Service Daemon | Upstream | Required Version | Production Port | Bound Interface | Storage Engine / Persistence Mode |
|---|---|---|---:|---|---|
| **MySQL Server** | Oracle / Ubuntu Repo | **8.0.35+** | `3306` | `127.0.0.1` | InnoDB, 6 GB Buffer Pool, binlog sync 1 |
| **Redis Server** | Redis.io / Ubuntu Repo | **7.0.15+** | `6379` | `127.0.0.1` | In-memory, AOF everysec, `noeviction` |

---

## 4. WEB REVERSE PROXY & CDN

| Component | Provider / Tier | Required Version | Upstream Target | Role in Arena Architecture |
|---|---|---|---|---|
| **Nginx** | Ubuntu Main Repo | **1.24+** | `http://cbt_api` | Reverse proxy, static asset CDN, SSE buffer-bypass |
| **Cloudflare Edge** | Cloudflare Free/Pro | Cloud | Origin VPS (`:443`) | DDoS mitigation, SSL termination, edge caching for `/assets/` |

---

## 5. BACKEND NPM DEPENDENCIES (`@arena/api`)

From [`arena/apps/api/package.json`](file:///c:/laragon/www/portal-data-man/arena/apps/api/package.json):

| Package Name | Pinned Version | Category | Architectural Purpose |
|---|---|---|---|
| **`fastify`** | `^5.12.5` | Core Framework | High-performance asynchronous HTTP & SSE server |
| **`@fastify/helmet`** | `^13.1.1` | Security | Security response headers (CSP, HSTS, frame-guard) |
| **`@fastify/rate-limit`** | `^11.2.0` | Protection | Redis-backed distributed rate limiter per student session |
| **`@fastify/sensible`** | `^6.0.6` | Utilities | Standardized HTTP error response generator |
| **`mysql2`** | `^3.24.5` | Database Driver | High-throughput async MySQL client with connection pool |
| **`ioredis`** | `^5.11.1` | Cache Client | Robust Redis client supporting pipelines, Lua scripts, and BullMQ |
| **`bullmq`** | `^6.7.2` | Queue Engine | Redis-backed async submission and scoring job queue |
| **`bcrypt`** | `^6.0.0` | Cryptography | Native C++ password hashing worker for student PIN verification |
| **`bcryptjs`** | `^3.0.3` | Cryptography | Pure JavaScript fallback implementation |
| **`zod`** | `^3.25.76` | Validation | Strict runtime schema parsing for all API payloads and environment |
| **`sanitize-html`** | `^2.17.0` | Sanitization | XSS prevention on rich-text question bodies and options |
| **`tsx`** | `^4.23.1` | Tooling | TypeScript execution for development and diagnostic tools |
| **`typescript`** | `^5.9.3` | Compiler | Typechecking and ES-module production compilation |

---

## 6. FRONTEND NPM DEPENDENCIES (`@arena/web`)

From [`arena/apps/web/package.json`](file:///c:/laragon/www/portal-data-man/arena/apps/web/package.json):

| Package Name | Pinned Version | Category | Architectural Purpose |
|---|---|---|---|
| **`react`** | `^19.3.0` | UI Library | Modern React UI rendering engine |
| **`react-dom`** | `^19.3.0` | UI Library | DOM bindings for React 19 |
| **`vite`** | `^6.4.3` | Build System | High-speed frontend bundling and asset hashing |
| **`@vitejs/plugin-react`** | `^5.2.0` | Build Plugin | Fast Refresh and JSX transformation |
| **`xlsx`** | `0.20.3` | Reporting | Client-side export of exam score recapitulations |
| **`fflate`** | `^0.8.3` | Compression | High-speed ZIP decompression for offline assets |

---

## 7. EXTERNAL SYSTEM & INTEGRATION DEPENDENCIES

| System / Service | Integration Endpoint / Protocol | Authentication | Criticality | Fallback Mechanism |
|---|---|---|---|---|
| **SIPADU (Portal Data)** | `https://sipadu.example.sch.id` | OIDC Client Credentials | High (Student sync & staff SSO) | Local admin accounts & cached student tables |
| **OIDC Provider** | `https://sipadu.example.sch.id/oidc` | OAuth2 / OIDC | Medium (Staff login) | Local staff credentials stored in `staff_users` |
| **Cloudflare DNS / Proxy** | `arena.man1palembang.sch.id` | API Key / Managed Dashboard | High (Entry point) | Direct Origin A record (Emergency only) |
