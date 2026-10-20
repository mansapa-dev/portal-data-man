#!/usr/bin/env bash
# ==============================================================================
# staging-diagnostic.sh
# Read-only diagnostic script for Arena Staging Server (man1palembang).
# Safe to run: does NOT modify any system configuration, database, or processes.
# ==============================================================================
set -u

echo "======================================================================"
echo "          ARENA STAGING HOST DIAGNOSTIC (READ-ONLY)                   "
echo "          Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')                "
echo "======================================================================"

echo ""
echo "--- 1. CPU HARDWARE TOPOLOGY ---"
echo "nproc: $(nproc 2>/dev/null || echo 'unknown')"
if command -v lscpu >/dev/null 2>&1; then
  lscpu | grep -E "Model name|Architecture|CPU\(s\):|Thread\(s\) per core:|Core\(s\) per socket:|Socket\(s\):|CPU max MHz|CPU min MHz" || true
else
  echo "lscpu command not available"
fi

echo ""
echo "--- 2. SYSTEMD SERVICE CONFIGURATION ---"
SERVICE_NAME="arena-staging.service"
if command -v systemctl >/dev/null 2>&1; then
  systemctl show "$SERVICE_NAME" \
    --property=Id,ActiveState,SubState,MainPID,ExecStart,CPUQuotaPerSecUSec,CPUQuotaPeriodUSec,AllowedCPUs,Environment,EnvironmentFile 2>/dev/null || echo "Failed to query systemctl"
else
  echo "systemctl not available"
fi

echo ""
echo "--- 3. SERVICE PROCESS & CGROUP LIMITS ---"
PID=$(pgrep -f "server.js" | head -n 1 || true)
if [ -z "$PID" ] && command -v systemctl >/dev/null 2>&1; then
  PID=$(systemctl show "$SERVICE_NAME" --property=MainPID --value 2>/dev/null || true)
  [ "$PID" = "0" ] && PID=""
fi

if [ -n "$PID" ] && [ -d "/proc/$PID" ]; then
  echo "Resolved Target Node PID: $PID"
  echo "Process Command: $(tr '\0' ' ' < /proc/"$PID"/cmdline 2>/dev/null || true)"
  
  echo ""
  echo "Process Environment (UV_THREADPOOL_SIZE & Node vars):"
  tr '\0' '\n' < "/proc/$PID/environ" 2>/dev/null | grep -E "^(UV_THREADPOOL_SIZE|NODE_ENV|PASSWORD_VERIFY|DB_POOL|ARENA)" || echo "No matching env vars readable in /proc/$PID/environ (run with sudo if needed)"

  echo ""
  echo "Cgroup Membership (/proc/$PID/cgroup):"
  cat /proc/"$PID"/cgroup 2>/dev/null || true

  echo ""
  echo "Cgroup CPU Constraints:"
  # Check cgroup v2
  CGROUP_PATH=$(grep -E '^[0-9]+::' /proc/"$PID"/cgroup 2>/dev/null | cut -d: -f3 || true)
  if [ -n "$CGROUP_PATH" ] && [ -f "/sys/fs/cgroup${CGROUP_PATH}/cpu.max" ]; then
    echo "cgroup v2 cpu.max: $(cat "/sys/fs/cgroup${CGROUP_PATH}/cpu.max" 2>/dev/null)"
  elif [ -f "/sys/fs/cgroup/cpu.max" ]; then
    echo "root cgroup v2 cpu.max: $(cat /sys/fs/cgroup/cpu.max 2>/dev/null)"
  else
    # Check cgroup v1
    CGROUP_V1_PATH=$(grep 'cpu,cpuacct:' /proc/"$PID"/cgroup 2>/dev/null | cut -d: -f3 || true)
    if [ -n "$CGROUP_V1_PATH" ] && [ -f "/sys/fs/cgroup/cpu${CGROUP_V1_PATH}/cpu.cfs_quota_us" ]; then
      echo "cgroup v1 cpu.cfs_quota_us: $(cat "/sys/fs/cgroup/cpu${CGROUP_V1_PATH}/cpu.cfs_quota_us" 2>/dev/null)"
      echo "cgroup v1 cpu.cfs_period_us: $(cat "/sys/fs/cgroup/cpu${CGROUP_V1_PATH}/cpu.cfs_period_us" 2>/dev/null)"
    else
      echo "No cgroup quota files found under resolved paths"
    fi
  fi

  echo ""
  echo "Thread Counts and Scheduling (ps -L -p $PID):"
  ps -L -p "$PID" -o pid,tid,class,rtprio,ni,pri,psr,pcpu,stat,wchan:14,comm 2>/dev/null || ps -L -p "$PID" 2>/dev/null || echo "ps -L not supported"
else
  echo "No running Node.js server process detected for $SERVICE_NAME."
fi

echo ""
echo "--- 4. MASKED ENVIRONMENT CONFIGURATION ---"
ENV_FILES=(
  "/opt/arena/releases/current/.env"
  "/opt/arena/.env"
  "/etc/arena/arena-staging.env"
  "/etc/default/arena-staging"
  "/home/kurogane/Documents/portal-data/arena/.env"
)

mask_value() {
  local line="$1"
  local key="${line%%=*}"
  local val="${line#*=}"
  if echo "$key" | grep -qiE "secret|key|password|token|database_url|dsn"; then
    echo "${key}=***MASKED*** (length: ${#val})"
  else
    echo "$line"
  fi
}

FOUND_ENV=0
for ef in "${ENV_FILES[@]}"; do
  if [ -f "$ef" ]; then
    echo "Found env file: $ef"
    FOUND_ENV=1
    while IFS= read -r line || [ -n "$line" ]; do
      # skip blank or comment
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ -z "${line// }" ]] && continue
      mask_value "$line"
    done < "$ef"
    echo ""
  fi
done
[ "$FOUND_ENV" -eq 0 ] && echo "No standard env files found in searched locations."

echo ""
echo "--- 5. REVERSE PROXY / NGINX CONFIGURATION ---"
if command -v nginx >/dev/null 2>&1 || [ -d "/etc/nginx" ]; then
  echo "Scanning Nginx configs for arena / login routes:"
  grep -rE "(location|proxy_pass|limit_req|limit_conn|proxy_read_timeout|proxy_connect_timeout)" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | grep -v "#" | head -n 40 || echo "No active Nginx site configs matched."
else
  echo "Nginx directory / command not found on host"
fi

echo ""
echo "======================================================================"
echo "                   END OF DIAGNOSTIC REPORT                           "
echo "======================================================================"
