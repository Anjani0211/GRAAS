#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  GRASS — dev.sh
#  Starts infrastructure services + API + Web in one terminal.
#  Ctrl+C kills everything cleanly.
# ─────────────────────────────────────────────────────────────

set -e

CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
RESET='\033[0m'

cleanup() {
  echo ""
  echo "Shutting down dev servers..."
  kill $(jobs -p) 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

echo ""
echo "🚀  Starting GRASS dev environment"
echo "   API → http://localhost:8000"
echo "   Web → http://localhost:3000"
echo ""

# Start infrastructure services (mongo, redis, minio, neo4j)
echo "▶  Starting infrastructure services..."
(cd api && npm run dev:services)
echo "✅  Infrastructure ready"
echo ""

# Start API and Web concurrently with coloured prefixes
(cd api && npm run dev 2>&1 | while IFS= read -r line; do echo -e "${CYAN}[API]${RESET} $line"; done) &
API_PID=$!

(cd web && npm run dev 2>&1 | while IFS= read -r line; do echo -e "${MAGENTA}[WEB]${RESET} $line"; done) &
WEB_PID=$!

wait $API_PID $WEB_PID
