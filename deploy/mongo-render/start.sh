#!/bin/bash
set -euo pipefail

PORT="${PORT:-8080}"
export MONGO_INITDB_ROOT_USERNAME="${MONGO_INITDB_ROOT_USERNAME:-graas}"
export MONGO_INITDB_ROOT_PASSWORD="${MONGO_INITDB_ROOT_PASSWORD:?MONGO_INITDB_ROOT_PASSWORD required}"
export MONGO_INITDB_DATABASE="${MONGO_INITDB_DATABASE:-graas}"

# Health endpoint for Render (public HTTP only on $PORT).
python3 - <<'PY' &
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

port = int(os.environ.get("PORT", "8080"))

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")
    def log_message(self, *_args):
        return

HTTPServer(("0.0.0.0", port), H).serve_forever()
PY

# Bind on all interfaces so Render private networking can reach 27017.
exec docker-entrypoint.sh mongod --bind_ip_all
