# PRODUCTION RECOVERY & DISASTER RESTORATION PLAYBOOK
## MANSAPA ARENA / CBT SYSTEM RUNBOOK

> **PURPOSE**: Standard operating recovery procedure in case of server reboot, service crash, network split, database stall, or cold recovery.  
> **PREREQUISITE**: Root / sudo access, user `arena` credentials, MySQL `arena_migrator` password, and access to the latest verified backup directory.

---

## 1. HIGH-LEVEL RECOVERY WORKFLOW (10-STEP SYSTEM CHECK)

```text
[STEP 1: Host Server] ──► [STEP 2: Network & UFW] ──► [STEP 3: MySQL 8.x]
                                                              │
[STEP 6: Node PM2]    ◄── [STEP 5: Redis 7.x]    ◄────────────┘
        │
        ▼
[STEP 7: Background Workers] ──► [STEP 8: Nginx & SSL] ──► [STEP 9: Probes /ready] ──► [STEP 10: CBT Flow Test]
```

---

### Step 1: Verify Host Server & OS Resources
1. Verify server is online and reachable via SSH: `ssh -i <key> arena@arena.man1palembang.sch.id`.
2. Check system time: `timedatectl status`. Verify timezone is **UTC** (crucial for exam session deadlines).
3. Check memory & swap: `free -m`. Ensure swap is available and memory is not pinned by zombie processes.
4. Check disk capacity: `df -h /`. Verify root filesystem has at least **15 GB** of free headroom for logs, temporary uploads, and database writes.

### Step 2: Verify Network & Firewall
1. Check interface IP assignment: `ip -brief addr`.
2. Verify firewall status: `sudo ufw status`. Confirm only ports 22, 80, 443 are open to incoming traffic.
3. Confirm internal ports (3001..3003, 3306, 6379) are **NOT** bound to public IP interfaces.

### Step 3: Verify & Recover MySQL Database
1. Check service status: `systemctl status mysql`.
2. If inactive, start: `sudo systemctl start mysql`.
3. Inspect error logs: `sudo tail -n 50 /var/log/mysql/error.log`.
4. Validate connectivity:
   ```bash
   mysql -u arena_app -p arena -e "SELECT 1;"
   ```
5. Check for hung transactions or uncommitted row locks:
   ```bash
   mysql -u arena_app -p arena -e "SHOW ENGINE INNODB STATUS\G"
   ```

### Step 4: Verify & Recover Redis Cache / Queue
1. Check service status: `systemctl status redis-server`.
2. If inactive, start: `sudo systemctl start redis-server`.
3. Verify ping response: `redis-cli ping` (must respond `PONG`).
4. Verify AOF persistence configuration:
   ```bash
   redis-cli config get appendonly        # Must be "yes"
   redis-cli config get maxmemory-policy  # Must be "noeviction"
   ```

### Step 5: Verify Application Working Directory & Environment
1. Switch to user `arena`: `sudo -iu arena`.
2. Navigate to repo directory: `cd /srv/repos/portal-data-man/arena`.
3. Confirm `.env` file exists and has correct permissions (`0600`):
   ```bash
   ls -la .env
   ```
4. Verify Node version: `node --version` (Must be `>= 22.x`).

### Step 6: Start / Recover Application Processes (PM2)
1. Check PM2 status: `pm2 status`.
2. If processes are stopped or missing, launch the full cluster profile:
   ```bash
   node --env-file=.env --input-type=module <<'NODE'
   import { spawnSync } from 'node:child_process';
   spawnSync('pm2', ['startOrReload', 'infra/ecosystem.config.cjs', '--update-env'], { stdio: 'inherit' });
   NODE
   ```
3. Verify that 5 distinct processes are running:
   - `arena-api-1` (Online, port 3001)
   - `arena-api-2` (Online, port 3002)
   - `arena-api-3` (Online, port 3003)
   - `arena-finalization` (Online, background worker)
   - `arena-waiting` (Online, waiting room worker)
4. Persist PM2 process state: `pm2 save`.

### Step 7: Verify Background Workers & Job Enqueue
1. Inspect worker logs:
   ```bash
   pm2 logs arena-finalization --lines 20 --nostream
   pm2 logs arena-waiting --lines 20 --nostream
   ```
2. Confirm no repetitive unhandled promise rejections or database connection timeouts.

### Step 8: Verify Nginx Reverse Proxy & SSL
1. Test Nginx syntax: `sudo nginx -t`.
2. Check Nginx daemon: `sudo systemctl status nginx`.
3. If down, start: `sudo systemctl start nginx`.
4. Validate TLS certificate validity:
   ```bash
   openssl x509 -in /etc/letsencrypt/live/arena.man1palembang.sch.id/fullchain.pem -noout -dates
   ```

### Step 9: Verify Health & Readiness Probes
1. Query local API health probe:
   ```bash
   curl -I http://127.0.0.1:3001/health
   curl -I http://127.0.0.1:3002/health
   curl -I http://127.0.0.1:3003/health
   ```
2. Query database readiness probe:
   ```bash
   curl -s http://127.0.0.1:3001/ready
   # Expected output: {"status":"ready"}
   ```
3. Query public endpoint through Cloudflare/Nginx:
   ```bash
   curl -I https://arena.man1palembang.sch.id/health
   ```

### Step 10: Verify End-to-End CBT Flow
1. Open administrator portal: `https://arena.man1palembang.sch.id/guru`.
2. Verify active schedules are visible.
3. Conduct a synthetic student login check (or staging rehearsal test).
4. Verify that waiting room, question loading, and heartbeat function cleanly.

---

## 2. DISASTER RECOVERY & DATABASE RESTORATION

If data corruption occurs or a catastrophic database loss happens:

### 1. Database Full Restore Procedure:
```bash
# 1. Stop all application workers to prevent incoming writes
pm2 stop all

# 2. Locate latest approved backup
export BACKUP_FILE="$HOME/arena-backups/latest/database.sql"
test -f "$BACKUP_FILE" || { echo "Backup file not found!"; exit 1; }

# 3. Restore database schema and data
mysql -u arena_migrator -p arena < "$BACKUP_FILE"

# 4. Verify table integrity
mysql -u arena_app -p arena -e "SHOW TABLES; SELECT COUNT(*) FROM students; SELECT COUNT(*) FROM exams;"

# 5. Restart application
pm2 start all
pm2 status
```

### 2. Rollback to Previous Stable Release:
```bash
cd /srv/repos/portal-data-man
# Check out documented previous stable commit
git checkout <PREVIOUS_STABLE_COMMIT_HASH>

cd arena
npm ci
npm run build

# Reload PM2 cluster with previous build
node --env-file=.env --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
spawnSync('pm2', ['startOrReload', 'infra/ecosystem.config.cjs', '--update-env'], { stdio: 'inherit' });
NODE

pm2 status
sudo nginx -t && sudo systemctl reload nginx
```
