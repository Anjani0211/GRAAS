# GRASS — Setup & First-Run Guide

Everything you need to go from zero to a running investigation portal.

---

## Option A — One-Command Start (Docker, Recommended)

Requires: **Docker** running + **Node.js 22+** on the host (for `make seed`).

```bash
# 0. Use Node 22 (repo includes .nvmrc)
nvm use

# 1. Clone and enter the repo
cd "autobot projects/GRAAS"

# 2. Start the full stack
make up

# 3. Create the first admin user (run once)
make seed

# 4. Open the portal
open http://localhost:3000/login
# Email:    admin@grass.local
# Password: GrassAdmin2026Secure
```

> Locked out or changed the password and forgot it? Run `make reset-admin` — it
> resets the admin password, re-activates the account, and clears any
> brute-force lockout. Override the defaults with
> `make seed SEED_ADMIN_PASSWORD='YourStrongPass!'`.

That's it. GRAAS is running.

---

## Option B — Local Development (Hot-reload)

Use this when actively developing the code.

```bash
# Step 1 — Start infrastructure (MongoDB, Redis, MinIO, Neo4j)
make dev-services
# If another MongoDB already owns :27017 it is reused automatically.
# To force the bundled Mongo on another port: MONGO_HOST_PORT=27018 make dev-services

# Step 2 — Start API (in a new terminal)
make dev-api

# Step 3 — Start Web (in another terminal)
make dev-web

# Step 4 — Seed admin (first time only)
make seed
```

---

## Available Services After Startup

| Service      | URL                              | Credentials                       |
|--------------|----------------------------------|-----------------------------------|
| GRASS Web    | http://localhost:3000            | See seed credentials below        |
| GRASS API    | http://localhost:8000/api/health | —                                 |
| MinIO Console| http://localhost:9001            | grassadmin / grasssecret123       |
| Neo4j Browser| http://localhost:7474            | neo4j / grasspass123              |
| Bull Board   | http://localhost:8000/admin/queues | Admin JWT required               |

---

## First Login

After running `make seed`:

- **URL**: http://localhost:3000/login
- **Email**: admin@grass.local
- **Password**: GrassAdmin2026Secure
- **Role**: Admin (full access, HITL badge, LE submission)

To create a custom admin:
```bash
cd api && npm run seed:admin -- --email you@org.com --password "Str0ngPass!" --badge "BADGE-001" --name "Your Name"
```

Locked out or forgot the password? `make reset-admin` resets it and clears any
brute-force lockout. In local dev you can also copy `web/.env.example` to
`web/.env.local` to display the seeded credentials on the login page.

The dev server also works when opened via `http://127.0.0.1:3000` or a LAN IP —
the API base follows the browser hostname and dev CORS allows loopback/LAN
origins automatically.

---

## Creating Additional Users

Once logged in as admin, use `POST /api/auth/register`:

```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "analyst@grass.local",
    "password": "Analyst@2026",
    "role": "osint_analyst",
    "name": "OSINT Analyst"
  }'
```

### Role Reference

| Role            | Access                                              |
|-----------------|-----------------------------------------------------|
| `victim`        | Submit complaint, track case                        |
| `intake_officer`| View cases, triage                                  |
| `osint_analyst` | OSINT queue, run pipeline, ad-hoc tools             |
| `case_manager`  | Case assignment, status updates, victim messaging   |
| `legal_team`    | Escalation drafts, support coordination             |
| `senior_analyst`| Finalize reports, HITL badge, export PDF            |
| `le_portal`     | Law enforcement read-only access (admin UI today)   |
| `admin`         | Full access + create staff + audit + settings       |
| `super_admin`   | Same as admin (break-glass elevated role)           |

Staff accounts are created from **Team → Add staff** (does not switch your session). Public `/login` register is victim-only.

---

## Investigating a Case — Step by Step

1. **Victim submits** at http://localhost:3000/submit (5-step wizard)
2. **Admin/Analyst logs in** → http://localhost:3000/login
3. **Open OSINT Queue** → /admin/osint
4. **Click a case** → Open workspace
5. **Upload evidence** (PDF, screenshots, audio)
6. **Click "Run Investigation"** — watch the live pipeline:
   - Stage 1: Evidence hashing (SHA-256)
   - Stage 2: Gemini AI entity extraction
   - Stage 3: OSINT enrichment (12+ providers)
   - Stage 4: Neo4j graph correlation
   - Stage 5: Agent loop (8–40 iterations)
7. **Review** graph tab + agent leads + entity cards
8. **Export final report** — `GRASS_Investigation_Report_{caseNumber}.docx` and `.pdf` only (Senior Analyst + badge; pipeline stages 1–5 must complete)
9. **Submit to LE** (HITL gate — badge required)

---

## OSINT API Keys — Where to Get Them

Fill these in `api/.env` (or Admin → Settings). Without keys, enrichment returns
`mock: true` demo payloads — the UI labels them; do not treat them as live intel.

| Key                   | Where to Get                              | Cost        |
|-----------------------|-------------------------------------------|-------------|
| `NUMVERIFY_API_KEY`   | https://numverify.com                     | Free tier   |
| `ABUSEIPDB_API_KEY`   | https://www.abuseipdb.com/api             | Free 1k/day |
| `HAVEIBEENPWNED_API_KEY` | https://haveibeenpwned.com/API/Key     | $3.50/mo    |
| `HUNTER_IO_API_KEY`   | https://hunter.io/users/sign_up           | Free 25/mo  |
| `URLSCAN_API_KEY`     | https://urlscan.io/user/signup            | Free        |
| `ETHERSCAN_API_KEY`   | https://etherscan.io/register → API Keys  | Free        |
| `RAZORPAY_KEY_ID/SECRET` | https://dashboard.razorpay.com/signup  | Free dev    |
| `WHOISXML_API_KEY`    | Already set ✅                            | —           |
| `VIRUSTOTAL_API_KEY`  | Already set ✅                            | —           |
| `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `LLM_API_KEY` | Cloud LLM (or Admin → Settings) | Paid/free tiers |

---

## Makefile Quick Reference

```bash
make up              # Start full stack (infra + API + Web)
make up-full         # Full stack + Playwright sidecar
make down            # Stop everything
make reset           # Stop + wipe all data (fresh start)
make seed            # Create first admin user
make dev             # Infra + API + Web with hot-reload (no app containers)
make logs            # Tail all logs
make logs-api        # Tail API logs only
make logs-web        # Tail Web logs only
make restart-api     # Restart API after changes
make restart-web     # Restart Web after changes
make typecheck       # Run TypeScript checks
make test            # Run all tests
make verify          # Typecheck + tests
make help            # Show all commands
```

---

## Useful Endpoints

```
GET  /api/health                              Health check
POST /api/auth/login                          Login
POST /api/auth/register                       Register user (admin only)
GET  /api/osint/queue                         Investigation queue
POST /api/osint/case/:id/investigation/run    Run OSINT pipeline (streams NDJSON)
GET  /api/osint/case/:id/investigation        Get investigation results
GET  /api/osint/case/:id/investigation/report/docx   Full DOCX (senior analyst + badge)
GET  /api/osint/case/:id/investigation/report/pdf    Full PDF (senior analyst + badge)
GET  /api/admin/audit                         Audit log (admin only)
GET  /admin/queues                            Bull Board queue UI (admin JWT)
```

---

## Known Gaps (Non-blocking)

- **Node 20 is unsupported** — Next.js 16 and cloud LLM calls need Node 22+ (`.nvmrc` included).
- **MinIO image** — upstream `minio/minio` was removed from Docker Hub/Quay; compose uses the `bitnamilegacy/minio` mirror. Without MinIO the API falls back to local disk (`api/uploads/`).
- Email notification on victim erasure requests (DPDP §11(3)) — needs SendGrid/SES key
- Minor data special handling (DPDP §9)
- Shodan provider — requires paid API key
- Playwright/TGStat worker — start with `make up-full` for Telegram enrichment
- Cloud LLM key required for AI stages (Admin → Settings or `api/.env`)

---

*Last updated: 2026-04-29 | GRASS v1.0 — Phase 10 Infrastructure*
