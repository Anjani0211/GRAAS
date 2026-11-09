# ─────────────────────────────────────────────────────────────
#  GRASS — Makefile
#  All commands run from the repo root.
#  Requires Node.js 22+ (see .nvmrc) and Docker.
# ─────────────────────────────────────────────────────────────

.PHONY: up up-full down reset seed seed-custom reset-admin logs logs-api logs-web \
	restart-api restart-web dev dev-services dev-services-down dev-api dev-web \
	typecheck test verify help

# Override on the command line, e.g. make seed SEED_ADMIN_PASSWORD='MyPass123!'
# The default avoids trailing punctuation so it is easy to type correctly.
SEED_ADMIN_EMAIL    ?= admin@grass.local
SEED_ADMIN_PASSWORD ?= GrassAdmin2026Secure
SEED_ADMIN_BADGE    ?= BADGE-ADMIN-001
SEED_ADMIN_NAME     ?= GRAAS Administrator

## ── Full stack (docker) ──────────────────────────────────────

# Start infra + API + Web (detached)
up:
	docker compose --env-file api/.env --profile app up -d --build
	@echo ""
	@echo "✅  GRASS stack is up!"
	@echo "   Web UI   → http://localhost:3000"
	@echo "   API      → http://localhost:8000/api/health"
	@echo "   MinIO    → http://localhost:9001  (grassadmin / grasssecret123)"
	@echo "   Neo4j    → http://localhost:7474  (neo4j / grasspass123)"
	@echo "   Bull UI  → http://localhost:8000/admin/queues"
	@echo ""
	@echo "   First run? → make seed"

# Start with local LLM (llama.cpp) + Playwright sidecar (TGStat enrichment)
up-full:
	docker compose --env-file api/.env -f docker-compose.yml -f docker-compose.llm.yml \
		--profile app --profile full up -d --build

# Stop all services
down:
	docker compose --env-file api/.env -f docker-compose.yml -f docker-compose.llm.yml \
		--profile app --profile full down

# Stop + remove volumes (full reset)
reset:
	docker compose --env-file api/.env -f docker-compose.yml -f docker-compose.llm.yml \
		--profile app --profile full down -v
	@echo "🗑️  All data volumes removed. Run 'make up && make seed' to start fresh."

# Tail logs (all services)
logs:
	docker compose logs -f

# Tail API logs only
logs-api:
	docker compose logs -f api

# Tail Web logs only
logs-web:
	docker compose logs -f web

# Restart just the API container (after code changes)
restart-api:
	docker compose restart api

# Restart just the Web container (after code changes)
restart-web:
	docker compose restart web

## ── First-boot seed ──────────────────────────────────────────

# Create the first ADMIN user (run once after first 'make up' or after dev-services)
seed:
	@echo "🌱 Seeding admin user..."
	cd api && npm run seed:admin -- \
		--email "$(SEED_ADMIN_EMAIL)" \
		--password "$(SEED_ADMIN_PASSWORD)" \
		--badge "$(SEED_ADMIN_BADGE)" \
		--name "$(SEED_ADMIN_NAME)"
	@echo ""
	@echo "   Login → http://localhost:3000/login"
	@echo "   Email : $(SEED_ADMIN_EMAIL)"
	@echo "   Pass  : $(SEED_ADMIN_PASSWORD)"

# Reset an existing admin's password + clear any brute-force lockout
reset-admin:
	@echo "🔑 Resetting admin credentials..."
	cd api && npm run seed:admin -- --force \
		--email "$(SEED_ADMIN_EMAIL)" \
		--password "$(SEED_ADMIN_PASSWORD)" \
		--badge "$(SEED_ADMIN_BADGE)" \
		--name "$(SEED_ADMIN_NAME)"
	@echo ""
	@echo "   Login → http://localhost:3000/login"
	@echo "   Email : $(SEED_ADMIN_EMAIL)"
	@echo "   Pass  : $(SEED_ADMIN_PASSWORD)"

# Seed with custom credentials
seed-custom:
	@echo "Usage: make seed SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='Str0ngPass!' SEED_ADMIN_BADGE=BADGE001"

## ── Local development (no docker for app code) ───────────────

# Start infrastructure services only (mongo, redis, minio, neo4j)
# If 27017 is already taken: MONGO_HOST_PORT=27018 make dev-services
dev-services:
	bash scripts/dev-services.sh

# Stop infrastructure services
dev-services-down:
	docker compose down

# Run API in watch mode (after dev-services)
dev-api:
	cd api && npm run dev

# Run Web in dev mode
dev-web:
	cd web && npm run dev

# Start infra + API + Web in one terminal
dev:
	npm run dev

## ── Quality checks ───────────────────────────────────────────

# TypeScript checks (both packages)
typecheck:
	@echo "Checking api/..."
	cd api && npm run typecheck
	@echo "Checking web/..."
	cd web && npm run typecheck
	@echo "✅  TypeScript: 0 errors"

# Run tests
test:
	@echo "Running API tests..."
	cd api && npm test
	@echo "Running Web tests..."
	cd web && npm test

# Typecheck + tests
verify:
	npm run verify

## ── Help ─────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  GRASS Makefile commands"
	@echo "  ───────────────────────────────────────────────"
	@echo "  make up              Start full stack (docker)"
	@echo "  make up-full         Start with local LLM + Playwright sidecar"
	@echo "  make down            Stop all containers"
	@echo "  make reset           Stop + wipe all data volumes"
	@echo "  make seed            Create first admin user"
	@echo "  make reset-admin     Reset admin password + clear lockout"
	@echo "  make logs            Tail all logs"
	@echo "  make logs-api        Tail API logs only"
	@echo "  make logs-web        Tail Web logs only"
	@echo "  make restart-api     Restart API container"
	@echo "  make restart-web     Restart Web container"
	@echo "  make dev-services    Start infra only (local dev)"
	@echo "  make dev             Start infra + API + Web"
	@echo "  make dev-api         Run API in watch mode"
	@echo "  make dev-web         Run Web in dev mode"
	@echo "  make typecheck       Run TS checks (api + web)"
	@echo "  make test            Run all tests"
	@echo "  make verify          Typecheck + tests"
	@echo "  ───────────────────────────────────────────────"
	@echo ""
