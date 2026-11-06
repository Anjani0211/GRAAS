# ─────────────────────────────────────────────────────────────
#  GRASS — Makefile
#  All commands run from the repo root.
# ─────────────────────────────────────────────────────────────

.PHONY: up down seed logs restart dev dev-down typecheck test help

## ── Full stack (docker) ──────────────────────────────────────

# Start all services + API + Web (detached)
up:
	docker compose up -d --build
	@echo ""
	@echo "✅  GRASS stack is up!"
	@echo "   Web UI   → http://localhost:3000"
	@echo "   API      → http://localhost:8000/api/health"
	@echo "   MinIO    → http://localhost:9001  (grassadmin / grasssecret123)"
	@echo "   Neo4j    → http://localhost:17474 (neo4j / grasspass123)"
	@echo "   Bull UI  → http://localhost:8000/admin/queues"
	@echo ""
	@echo "   First run? → make seed"

# Start with Playwright sidecar (TGStat enrichment)
up-full:
	docker compose --profile full up -d --build

# Stop all services
down:
	docker compose down

# Stop + remove volumes (full reset)
reset:
	docker compose down -v
	@echo "🗑️  All data volumes removed. Run 'make up && make seed' to start fresh."

# Tail logs (all services)
logs:
	docker compose logs -f

# Tail API logs only
logs-api:
	docker compose logs -f api

# Restart just the API container (after code changes)
restart-api:
	docker compose restart api

## ── First-boot seed ──────────────────────────────────────────

# Create the first ADMIN user (run once after first 'make up')
seed:
	@echo "🌱 Seeding admin user..."
	cd api && npm run seed:admin
	@echo ""
	@echo "   Login → http://localhost:3000/login"
	@echo "   Email : admin@grass.local"
	@echo "   Pass  : GrassAdmin@2026"

# Seed with custom credentials
seed-custom:
	@echo "Usage: cd api && npm run seed:admin -- --email you@example.com --password YourPass --badge BADGE001"

## ── Local development (no docker for app code) ───────────────

# Start infrastructure services only (mongo, redis, minio, neo4j)
dev-services:
	cd api && docker compose -f docker-compose.dev.yml up -d
	@echo "✅  Infrastructure services started"
	@echo "   MongoDB → localhost:27017"
	@echo "   Redis   → localhost:6379"
	@echo "   MinIO   → localhost:9000 (console: localhost:9001)"
	@echo "   Neo4j   → localhost:7687 (browser: localhost:7474)"

# Stop infrastructure services
dev-services-down:
	cd api && docker compose -f docker-compose.dev.yml down

# Run API in watch mode (after dev-services)
dev-api:
	cd api && npm run dev

# Run Web in dev mode
dev-web:
	cd web && npm run dev

## ── Quality checks ───────────────────────────────────────────

# TypeScript checks (both packages)
typecheck:
	@echo "Checking api/..."
	cd api && npm run typecheck
	@echo "Checking web/..."
	cd web && npx tsc --noEmit
	@echo "✅  TypeScript: 0 errors"

# Run tests
test:
	@echo "Running API tests..."
	cd api && npm test
	@echo "Running Web tests..."
	cd web && npm test

## ── Help ─────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  GRASS Makefile commands"
	@echo "  ───────────────────────────────────────────────"
	@echo "  make up              Start full stack (docker)"
	@echo "  make up-full         Start with Playwright sidecar"
	@echo "  make down            Stop all containers"
	@echo "  make reset           Stop + wipe all data volumes"
	@echo "  make seed            Create first admin user"
	@echo "  make logs            Tail all logs"
	@echo "  make logs-api        Tail API logs only"
	@echo "  make restart-api     Restart API container"
	@echo "  make dev-services    Start infra only (local dev)"
	@echo "  make dev-api         Run API in watch mode"
	@echo "  make dev-web         Run Web in dev mode"
	@echo "  make typecheck       Run TS checks (api + web)"
	@echo "  make test            Run all tests"
	@echo "  ───────────────────────────────────────────────"
	@echo ""
