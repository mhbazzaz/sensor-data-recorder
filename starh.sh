#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SENSOR_APP_DIR="${PROJECT_ROOT}/sensor-app"
LOG_DIR="${PROJECT_ROOT}/logs"

INFLUX_TOKEN="SuperToken123456"
INFLUX_ORG="MohammadOrg"
INFLUX_BUCKET="FactoryMetrics"

APP_PIDS=()

start_app() {
  local log_file="$1"
  shift

  (
    "$@" >>"${log_file}" 2>&1
  ) &

  APP_PIDS+=("$!")
}

cleanup() {
  echo ""
  echo "[STOP] Shutting down Node apps..."

  for pid in "${APP_PIDS[@]:-}"; do
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
  done

  wait >/dev/null 2>&1 || true
  echo "[STOP] Node apps stopped. Docker containers are still running."
}

trap cleanup EXIT INT TERM

mkdir -p "${LOG_DIR}"

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║   Industrial IoT Monitoring System        ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

if ! docker info >/dev/null 2>&1; then
  echo "[FAIL] Docker is not running. Start Docker Desktop first."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] Node.js is not installed."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1 && ! docker-compose version >/dev/null 2>&1; then
  echo "[FAIL] Docker Compose not found."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE="docker-compose"
fi

echo "[OK] Docker, Compose, and Node.js are ready"
echo ""

echo "[1/5] Stopping existing containers..."
$COMPOSE -f "${PROJECT_ROOT}/docker-compose.yml" down --remove-orphans 2>/dev/null || true
echo ""

echo "[2/5] Starting services..."
$COMPOSE -f "${PROJECT_ROOT}/docker-compose.yml" up -d
echo ""

echo "[3/5] Waiting for services..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:8086/health" >/dev/null 2>&1; then
    echo "       InfluxDB is healthy (${i})"
    break
  fi
  sleep 2
done

echo "       Waiting for Node-RED..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:1880/" >/dev/null 2>&1; then
    echo "       Node-RED is up (${i})"
    break
  fi
  sleep 2
done

echo "       Waiting for Mosquitto..."
for i in $(seq 1 30); do
  if docker inspect -f '{{.State.Status}}' mosquitto 2>/dev/null | grep -q "running"; then
    echo "       Mosquitto is running (${i})"
    break
  fi
  sleep 2
done
echo ""

echo "[4/5] Starting Node apps..."
: >"${LOG_DIR}/receiver.log"
: >"${LOG_DIR}/mock-sensor.log"
start_app "${LOG_DIR}/receiver.log" node "${SENSOR_APP_DIR}/index.js"
sleep 2
start_app "${LOG_DIR}/mock-sensor.log" node "${SENSOR_APP_DIR}/mock-sensor.js"
sleep 5
echo "       [OK] Receiver and mock sensors started"
echo ""

echo "[5/5] Verifying data flow..."
DATA_OK=false
for attempt in 1 2 3; do
  RESULT=$(
    curl -sf "http://localhost:8086/api/v2/query?org=${INFLUX_ORG}" \
      --header "Authorization: Token ${INFLUX_TOKEN}" \
      --header "Accept: application/csv" \
      --header "Content-Type: application/vnd.flux" \
      --data "from(bucket: \"${INFLUX_BUCKET}\") |> range(start: -2m) |> limit(n: 1)" 2>/dev/null || true
  )

  if echo "${RESULT}" | grep -q "_measurement"; then
    DATA_OK=true
    break
  fi

  if [ "${attempt}" -lt 3 ]; then
    echo "       No data yet, waiting 5s... (attempt ${attempt}/3)"
    sleep 5
  fi
done

if [ "${DATA_OK}" = true ]; then
  echo "       [OK] Data is flowing to InfluxDB"
else
  echo "       [WARN] No data detected in InfluxDB yet"
fi
echo ""

echo "╔═══════════════════════════════════════════╗"
echo "║            System Ready!                  ║"
echo "╠═══════════════════════════════════════════╣"
echo "║                                           ║"
echo "║  Node-RED   http://localhost:1880         ║"
echo "║                                           ║"
echo "║  InfluxDB   http://localhost:8086         ║"
echo "║             admin / admin123              ║"
echo "║                                           ║"
echo "║  MQTT       mqtt://localhost:1883         ║"
echo "║                                           ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "App logs saved to:"
echo "  ${LOG_DIR}/receiver.log"
echo "  ${LOG_DIR}/mock-sensor.log"
echo ""
echo "Press Ctrl+C to stop the Node apps. Docker containers will stay running."
echo ""

wait
