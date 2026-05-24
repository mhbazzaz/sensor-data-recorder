#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="${PROJECT_ROOT}/backups/influxdb"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
BACKUP_DIR="${BACKUP_ROOT}/latest"
CONTAINER_NAME="influxdb"
CONTAINER_BACKUP_DIR="/tmp/influxdb-backup-${TIMESTAMP}"

INFLUX_TOKEN="SuperToken123456"
INFLUX_ORG="MohammadOrg"
INFLUX_BUCKET="FactoryMetrics"

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║          InfluxDB Backup Utility          ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

if ! docker info >/dev/null 2>&1; then
  echo "[FAIL] Docker is not running. Start Docker Desktop first."
  exit 1
fi

if ! docker inspect -f '{{.State.Status}}' "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "[FAIL] InfluxDB container '${CONTAINER_NAME}' was not found."
  exit 1
fi

if ! docker inspect -f '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null | grep -q "running"; then
  echo "[FAIL] InfluxDB container '${CONTAINER_NAME}' is not running."
  exit 1
fi

rm -rf "${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

echo "[1/4] Checking InfluxDB health..."
if curl -sf "http://localhost:8086/health" >/dev/null 2>&1; then
  echo "       [OK] InfluxDB is reachable"
else
  echo "       [WARN] InfluxDB health endpoint did not respond, continuing with container backup"
fi
echo ""

echo "[2/4] Creating backup inside container..."
docker exec "${CONTAINER_NAME}" rm -rf "${CONTAINER_BACKUP_DIR}" >/dev/null 2>&1 || true
docker exec "${CONTAINER_NAME}" influx backup "${CONTAINER_BACKUP_DIR}" --token "${INFLUX_TOKEN}"
echo "       [OK] Backup created in container"
echo ""

echo "[3/4] Copying backup to host..."
docker cp "${CONTAINER_NAME}:${CONTAINER_BACKUP_DIR}/." "${BACKUP_DIR}/"
echo "       [OK] Backup copied to ${BACKUP_DIR}"
echo ""

echo "[4/4] Writing restore notes..."
cat >"${BACKUP_DIR}/RESTORE-INFO.txt" <<EOF
InfluxDB Backup Information
===========================

Created at: ${TIMESTAMP}
Backup folder mode: overwrite latest backup
Source container: ${CONTAINER_NAME}
Organization: ${INFLUX_ORG}
Bucket: ${INFLUX_BUCKET}

This backup was created with:
  influx backup ${CONTAINER_BACKUP_DIR} --token ${INFLUX_TOKEN}

Typical restore flow on another Docker-based InfluxDB 2.x instance:

1. Copy this backup folder to the target machine.
2. Copy the backup into the target InfluxDB container:
   docker cp ./$(basename "${BACKUP_DIR}")/. <target_container>:/tmp/influxdb-restore/

3. Run the restore:
   docker exec <target_container> influx restore /tmp/influxdb-restore --full --token <TARGET_ADMIN_TOKEN>

Notes:
- Prefer restoring into a fresh InfluxDB 2.x instance.
- Source and target should be compatible InfluxDB 2.x versions.
- The --full restore includes metadata and bucket data.
EOF
echo "       [OK] Restore instructions saved"
echo ""

docker exec "${CONTAINER_NAME}" rm -rf "${CONTAINER_BACKUP_DIR}" >/dev/null 2>&1 || true

echo "${TIMESTAMP}" >"${BACKUP_DIR}/LAST-BACKUP.txt"

echo "╔═══════════════════════════════════════════╗"
echo "║            Backup Complete!               ║"
echo "╠═══════════════════════════════════════════╣"
echo "║                                           ║"
echo "║  Backup folder:                           ║"
echo "║  ${BACKUP_DIR}"
echo "║                                           ║"
echo "║  Keep this folder safe for restore later. ║"
echo "║                                           ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
