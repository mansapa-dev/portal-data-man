# PRODUCTION COMMAND REFERENCE: MANSAPA ARENA
## SAFE OPERATIONAL, DIAGNOSTIC, & AUDIT COMMANDS

> **ENVIRONMENT**: Ubuntu 24.04 LTS / Node 22+ / Fastify / PM2 / MySQL 8.x / Redis 7.x  
> **POLICY**: Default commands are strictly **READ-ONLY**. Destructive commands are labeled **DANGEROUS** and must never be executed during active examinations.

---

## 1. SYSTEM IDENTITY & RESOURCE DIAGNOSTICS (READ-ONLY)

```bash
# Check OS release & kernel details
cat /etc/os-release
uname -a
hostnamectl

# Check server uptime, system load average, and logged-in sessions
uptime
w

# Check system memory, active swap, and buffer cache
free -h -w
swapon --show

# Check per-CPU utilization and core stats
lscpu
vmstat 1 5
mpstat -P ALL 1 3 2>/dev/null || echo "sysstat not installed"

# Check disk space and inode availability
df -hT
df -ih

# Check disk I/O activity without heavy load (Read-only)
iostat -xz 1 5 2>/dev/null || echo "sysstat not installed"
cat /sys/block/sd*/queue/scheduler 2>/dev/null || cat /sys/block/vd*/queue/scheduler 2>/dev/null
```

---

## 2. PM2 & APPLICATION RUNTIME INSPECTION (READ-ONLY)

```bash
# List status of all Arena processes (Run as user 'arena')
pm2 status
pm2 describe arena-api-1
pm2 describe arena-api-2
pm2 describe arena-api-3
pm2 describe arena-finalization
pm2 describe arena-waiting

# Inspect recent logs without tailing/locking
pm2 logs arena-api-1 --lines 50 --nostream
pm2 logs arena-finalization --lines 50 --nostream
pm2 logs arena-waiting --lines 50 --nostream

# View memory and CPU consumption of each process
pm2 monit --no-interaction 2>/dev/null || pm2 jlist
```

---

## 3. WEB SERVER (NGINX) VERIFICATION (READ-ONLY)

```bash
# Test Nginx syntax and configuration integrity
sudo nginx -t

# Dump the full effective Nginx running configuration (for audit)
sudo nginx -T

# Check Nginx service status
systemctl status nginx --no-pager

# View recent Nginx error log
tail -n 100 /var/log/nginx/error.log

# Monitor recent Arena access logs
tail -n 100 /var/log/nginx/arena-access.log 2>/dev/null || tail -n 100 /var/log/nginx/access.log
```

---

## 4. NETWORK & PORT MONITORING (READ-ONLY)

```bash
# List all active TCP listening sockets, ports, and PID/process names
ss -lntup

# Verify Arena loopback ports are listening
ss -lntp | grep -E ':(3001|3002|3003|3306|6379|80|443)'

# Check active IP addresses and default routing
ip -brief addr
ip route
cat /etc/resolv.conf

# Check UFW firewall status and configured rules
sudo ufw status verbose
```

---

## 5. DATABASE (MYSQL 8.X) AUDIT (READ-ONLY)

> **Note**: Passwords must be entered interactively via `-p`. Never place plaintext passwords in the shell history!

```bash
# Check MySQL service status
systemctl status mysql --no-pager

# Check active connections, running threads, and process list
mysql -u arena_app -p arena -e "SHOW STATUS LIKE 'Threads_%';"
mysql -u arena_app -p arena -e "SHOW STATUS LIKE 'Connections';"
mysql -u arena_app -p arena -e "SHOW STATUS LIKE 'Max_used_connections';"
mysql -u arena_app -p arena -e "SHOW PROCESSLIST;"

# Check InnoDB buffer pool and transaction engine status
mysql -u arena_app -p arena -e "SHOW ENGINE INNODB STATUS\G"

# Check active exam attempts and submission counts (Safe read)
mysql -u arena_app -p arena -e "SELECT status, COUNT(*) AS total FROM exam_attempts GROUP BY status;"
mysql -u arena_app -p arena -e "SELECT state, COUNT(*) AS total FROM exam_submissions GROUP BY state;" 2>/dev/null || true
```

---

## 6. CACHE & QUEUE (REDIS 7.X) AUDIT (READ-ONLY)

```bash
# Check Redis service status
systemctl status redis-server --no-pager

# Verify Redis ping and basic stats
redis-cli ping
redis-cli info server
redis-cli info memory
redis-cli info persistence
redis-cli info clients

# Verify Redis AOF and noeviction policy
redis-cli config get appendonly
redis-cli config get maxmemory-policy
redis-cli config get maxmemory

# Inspect active student queue lengths (Safe inspection)
redis-cli dbsize
```

---

## 7. SYSTEM SERVICE MANAGEMENT & LOGROTATE

```bash
# Check systemd limits and open file descriptors
cat /proc/sys/fs/file-nr
cat /proc/sys/net/core/somaxconn

# Inspect logrotate configuration for Nginx and system services
cat /etc/logrotate.d/nginx 2>/dev/null || true
cat /etc/logrotate.d/arena 2>/dev/null || true

# Check system journal for critical OOM or hardware errors
sudo journalctl -p 3 -xb --no-pager -n 50
```

---

## 8. DANGEROUS / STATE-MUTATING COMMANDS (CAUTION REQUIRED)

> [!CAUTION]
> The following commands modify running processes, disk data, or networking state.  
> **DO NOT RUN DURING ACTIVE EXAMINATIONS OR WITHOUT AN APPROVED MAINTENANCE WINDOW.**

```bash
# [DANGEROUS] Graceful restart of Arena PM2 processes
# Only run during scheduled maintenance after verifying no active exams:
# node --env-file=.env --input-type=module <<'NODE'
# import { spawnSync } from 'node:child_process';
# spawnSync('pm2', ['startOrReload', 'infra/ecosystem.config.cjs', '--update-env'], { stdio: 'inherit' });
# NODE

# [DANGEROUS] Nginx configuration reload
# Only execute after verifying 'sudo nginx -t' exits with status 0:
# sudo systemctl reload nginx

# [DANGEROUS] Database Schema Migrations
# Execute ONLY with 'arena_migrator' account during maintenance:
# mysql -u arena_migrator -p arena < database/migrations/014_session_capacity.sql
# mysql -u arena_migrator -p arena < database/migrations/015_exam_source_revision.sql
# mysql -u arena_migrator -p arena < database/migrations/016_exam_submissions.sql

# [DANGEROUS] Redis flush or memory wipe
# NEVER execute on production:
# redis-cli flushall   <-- WILL DESTROY IN-PROGRESS WAITING ROOM & QUEUE STATE!
```
