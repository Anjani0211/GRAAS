#!/usr/bin/env bash
# Start GRAAS infrastructure. Reuses an existing MongoDB on :27017 instead of
# fighting it for the port (common when another local stack already runs one).
#
# Force the bundled MongoDB on a different host port:
#   MONGO_HOST_PORT=27018 bash scripts/dev-services.sh
set -euo pipefail

cd "$(dirname "$0")/.."

mongo_port="${MONGO_HOST_PORT:-27017}"

port_open() {
  local port="$1"
  (command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$port" >/dev/null 2>&1) ||
    bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" >/dev/null 2>&1
}

if [ "$mongo_port" = "27017" ] && port_open 27017; then
  echo "MongoDB already reachable on localhost:27017 — reusing it"
  docker compose up -d redis minio neo4j
else
  docker compose up -d mongo redis minio neo4j
fi

echo "Infrastructure ready:"
echo "  MongoDB → ${MONGODB_URI:-mongodb://localhost:${mongo_port}/graas}"
echo "  Redis   → localhost:6379"
echo "  MinIO   → localhost:9000 (console: localhost:9001)"
echo "  Neo4j   → localhost:7687 (browser: localhost:7474)"
