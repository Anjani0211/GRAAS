#!/bin/bash
set -euo pipefail

PORT="${PORT:-8080}"
export MONGO_INITDB_ROOT_USERNAME="${MONGO_INITDB_ROOT_USERNAME:-graas}"
export MONGO_INITDB_ROOT_PASSWORD="${MONGO_INITDB_ROOT_PASSWORD:?MONGO_INITDB_ROOT_PASSWORD required}"
export MONGO_INITDB_DATABASE="${MONGO_INITDB_DATABASE:-graas}"

# Minimal HTTP health for Render public probe (Mongo stays on 27017 for private peers).
mkdir -p /tmp/health
echo ok >/tmp/health/index.html
/usr/local/bin/busybox httpd -f -p "0.0.0.0:${PORT}" -h /tmp/health &

exec docker-entrypoint.sh mongod --bind_ip_all
