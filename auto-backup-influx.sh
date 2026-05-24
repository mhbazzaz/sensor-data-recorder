#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${PROJECT_ROOT}/backup-influx.sh"
BACKUP_HOUR=2
BACKUP_MINUTE=0

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

seconds_until_next_backup() {
  python3 - <<PY
from datetime import datetime, timedelta

hour = ${BACKUP_HOUR}
minute = ${BACKUP_MINUTE}
now = datetime.now()
target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)

if target <= now:
    target += timedelta(days=1)

print(int((target - now).total_seconds()))
PY
}

echo "[$(timestamp)] [backup] Auto backup worker started"
echo "[$(timestamp)] [backup] Schedule: daily at 02:00 AM"

while true; do
  SLEEP_SECONDS="$(seconds_until_next_backup)"
  echo "[$(timestamp)] [backup] Next backup in ${SLEEP_SECONDS} seconds"
  sleep "${SLEEP_SECONDS}"

  echo "[$(timestamp)] [backup] Running backup..."

  if bash "${BACKUP_SCRIPT}"; then
    echo "[$(timestamp)] [backup] Backup completed successfully"
  else
    echo "[$(timestamp)] [backup] Backup failed"
  fi
done
