#!/bin/bash
set -euo pipefail

mkdir -p /data/db /app/uploads/evidence

mongod --dbpath /data/db --bind_ip 127.0.0.1 --port 27017 --quiet &
MONGO_PID=$!

# Wait until Mongo accepts connections
for i in $(seq 1 60); do
  if (echo > /dev/tcp/127.0.0.1/27017) >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

export MONGODB_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017/graas}"

node dist/app.js &
APP_PID=$!

term() {
  kill -TERM "$APP_PID" "$MONGO_PID" 2>/dev/null || true
}
trap term TERM INT

wait "$APP_PID"
status=$?
kill -TERM "$MONGO_PID" 2>/dev/null || true
exit "$status"
