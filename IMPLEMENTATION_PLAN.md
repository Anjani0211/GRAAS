# GRASS — Master Implementation Plan
# Version: 1.0 | Status: ACTIVE | Governs all agent execution

> **Agent Rule**: Read this file completely before touching any code.
> After completing each phase's exit criteria, update `PROGRESS.md` using the
> template at the bottom of this file. Never move to the next phase until all
> exit criteria for the current phase are GREEN.

---

## Project Context

**Existing stack** (from PROGRESS.md as of 2026-04-23):
- `web/` — Next.js + React + React Query
- `api/` — Node.js + Express + MongoDB
- Pipeline: 5 stages, NDJSON streaming, implemented
- OSINT providers live: WhoisXML, VirusTotal
- Missing: Gemini AI, phone/email/wallet enrichment, Neo4j, PDF generation,
  role-based auth, threat model controls, per-phase retry, audit logs

**North star**: Every phase below advances the system toward the GRASS PRD v2.0
spec. No phase introduces breaking changes to existing working functionality
without an explicit migration step.

---

## Phase 0 — Workspace Sanitation & Agent Bootstrap
### Duration target: Day 1 (complete before any feature work)

This phase runs ONCE. Its purpose is to ensure the codebase is in a known,
clean, compilable state before the agent begins making changes. No feature code
is written in this phase.

### 0.1 — Dependency Audit
- [ ] Run `npm audit` in both `api/` and `web/`. Log all HIGH/CRITICAL findings
      to `AUDIT_LOG.md`. Do not auto-fix — record only.
- [ ] Confirm `api/` TypeScript compiles: `npm run typecheck` must pass with
      zero errors.
- [ ] Confirm `web/` TypeScript compiles: `npx tsc --noEmit` must pass with
      zero errors.
- [ ] Confirm both dev servers start without crashing:
      `npm run dev` in `api/`, `npm run dev` in `web/`.

### 0.2 — Codebase Structure Verification
- [ ] Verify the following directories exist. If missing, create with a
      `.gitkeep` and note in PROGRESS.md:
  - `api/src/routes/`
  - `api/src/services/`
  - `api/src/models/`
  - `api/src/middleware/`
  - `api/src/config/`
  - `api/src/utils/`
  - `web/lib/`
  - `web/app/(admin)/admin/osint/`
- [ ] Verify `api/src/services/osintPipeline.ts` exists and exports a callable
      pipeline function.
- [ ] Verify NDJSON stream endpoint
      `POST /osint/case/:caseId/investigation/run` is reachable (returns 200 or
      401, not 404).

### 0.3 — Environment File Scaffold
Create `api/.env.example` (if it does not already exist) with ALL keys the
system will ever need. Mark unimplemented keys as `# TODO: Phase N`. Never
commit real secrets.

```
# ── Core ──
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb://localhost:27017/grass

# ── Auth ──
JWT_SECRET=changeme
JWT_EXPIRY=8h

# ── AI (Phase 2) ──
GEMINI_API_KEY=                        # TODO: Phase 2
GEMINI_MODEL=gemini-2.0-flash

# ── OSINT — Already live ──
VIRUSTOTAL_API_KEY=
WHOISXML_API_KEY=

# ── OSINT — Phase 3 ──
NUMVERIFY_API_KEY=                     # TODO: Phase 3
TRUECALLER_API_KEY=                    # TODO: Phase 3
ABUSEIPDB_API_KEY=                     # TODO: Phase 3
ETHERSCAN_API_KEY=                     # TODO: Phase 3
TRONSCAN_API_KEY=                      # TODO: Phase 3
HAVEIBEENPWNED_API_KEY=                # TODO: Phase 3
HUNTER_IO_API_KEY=                     # TODO: Phase 3
RAZORPAY_KEY_ID=                       # TODO: Phase 3
RAZORPAY_KEY_SECRET=                   # TODO: Phase 3

# ── Graph DB (Phase 4) ──
NEO4J_URI=bolt://localhost:7687        # TODO: Phase 4
NEO4J_USER=neo4j                       # TODO: Phase 4
NEO4J_PASSWORD=changeme                # TODO: Phase 4

# ── Storage (Phase 5) ──
MINIO_ENDPOINT=localhost               # TODO: Phase 5
MINIO_PORT=9000                        # TODO: Phase 5
MINIO_ACCESS_KEY=                      # TODO: Phase 5
MINIO_SECRET_KEY=                      # TODO: Phase 5
MINIO_BUCKET=grass-evidence            # TODO: Phase 5

# ── Rate Limiting ──
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### 0.4 — Lint Baseline
- [ ] Run ESLint across `api/src/` and `web/`. Record the count of errors and
      warnings in PROGRESS.md. This is the baseline. The agent must not
      **increase** lint errors in any subsequent phase.

### 0.5 — Create Tracking Files
- [ ] Create `AUDIT_LOG.md` with npm audit output.
- [ ] Ensure `PROGRESS.md` exists and has a Phase 0 section (see template).
- [ ] Create `IMPLEMENTATION_PLAN.md` (this file) at repo root if not already
      present.

### Phase 0 Exit Criteria (ALL must be GREEN before Phase 1)
| # | Criterion | Check |
|---|-----------|-------|
| 0-A | `npm run typecheck` passes in `api/` with 0 errors | |
| 0-B | `npx tsc --noEmit` passes in `web/` with 0 errors | |
| 0-C | Both dev servers start without crashing | |
| 0-D | `api/.env.example` exists with all keys scaffolded | |
| 0-E | `AUDIT_LOG.md` created with baseline findings | |
| 0-F | PROGRESS.md updated with Phase 0 completion block | |

---

## Phase 1 — Role-Based Auth & Threat Model Controls
### Duration target: Days 2–5

**Why first**: Security must be the foundation. All subsequent phases add
features that handle real victim data. Auth must exist before data touches the
system.

### 1.1 — User Model & Roles
Create `api/src/models/User.ts`:
```typescript
// Roles (in ascending privilege order):
type UserRole = 'VICTIM' | 'ANALYST' | 'SENIOR_ANALYST' | 'LE_PORTAL' | 'ADMIN';

interface IUser {
  _id: ObjectId;
  email: string;
  passwordHash: string;           // bcrypt, cost 12
  role: UserRole;
  badgeId?: string;               // Required for SENIOR_ANALYST+
  isActive: boolean;
  failedLoginAttempts: number;    // Lockout after 5
  lockedUntil?: Date;
  createdAt: Date;
  lastLoginAt?: Date;
  lastLoginIp?: string;
}
```

### 1.2 — JWT Auth Middleware
Create `api/src/middleware/auth.ts`:
- `authenticate` — verifies JWT, attaches `req.user`.
- `requireRole(...roles)` — middleware factory; returns 403 if user role not in
  list.
- `requireBadge` — returns 403 if `req.user.badgeId` is null/empty (used for
  HITL gate).
- All auth failures must be logged to a `audit_events` MongoDB collection with:
  `{userId, action, resourceId, ip, timestamp, outcome}`.

### 1.3 — Auth Routes
Create `api/src/routes/auth.ts`:
- `POST /auth/register` — Admin-only. Creates user accounts.
- `POST /auth/login` — Returns JWT. Enforces lockout after 5 failed attempts.
- `POST /auth/logout` — Invalidates token (blocklist in Redis or MongoDB set).
- `GET /auth/me` — Returns current user profile.

### 1.4 — RBAC Permission Matrix (Implementation)
Apply `requireRole` middleware to existing routes:

| Route | Minimum Role |
|-------|-------------|
| `GET /osint/queue` | ANALYST |
| `GET /osint/case/:id/investigation` | ANALYST |
| `POST /osint/case/:id/investigation/run` | ANALYST |
| `POST /osint/case/:id/investigation/tool` | ANALYST |
| `POST /osint/case/:id/investigation/finalize` | SENIOR_ANALYST + requireBadge |
| `POST /osint/case/:id/investigation/submit-le` | SENIOR_ANALYST + requireBadge |
| `POST /auth/register` | ADMIN |

### 1.5 — Rate Limiting
Add `express-rate-limit` to `api/src/middleware/rateLimiter.ts`:
- Global: 100 req/min per IP.
- Auth routes: 10 req/min per IP (stricter to prevent brute force).
- Pipeline run: 5 req/min per authenticated user.

### 1.6 — Audit Log Service
Create `api/src/services/auditLog.ts`:
```typescript
logEvent(params: {
  userId: string;
  action: AuditAction;   // enum: LOGIN | LOGOUT | CASE_VIEW | EVIDENCE_ACCESS
                          //       | PIPELINE_RUN | REPORT_EXPORT | LE_SUBMIT
  resourceId?: string;
  outcome: 'SUCCESS' | 'FAILURE';
  ip: string;
  metadata?: Record<string, unknown>;
}): Promise<void>
```
Every sensitive action must call this. Evidence file access is always logged.

### 1.7 — Frontend Auth Integration
- Add login page: `web/app/(auth)/login/page.tsx`
- Add JWT storage in `httpOnly` cookie (not localStorage).
- Add `AuthGuard` HOC that wraps all admin routes.
- Add role-aware UI — SENIOR_ANALYST+ sees "Finalize" button; ANALYST does not.

### Phase 1 Exit Criteria
| # | Criterion | Check |
|---|-----------|-------|
| 1-A | Unauthenticated request to `/osint/queue` returns 401 | |
| 1-B | ANALYST role cannot access finalize endpoint (returns 403) | |
| 1-C | HITL finalize endpoint blocked for user with no badgeId | |
| 1-D | Login lockout triggers after 5 failed attempts | |
| 1-E | Every evidence access creates an audit_events record | |
| 1-F | TypeScript compile passes in both `api/` and `web/` | |
| 1-G | PROGRESS.md updated with Phase 1 completion block | |

---

## Phase 2 — Gemini AI Integration (Replace Stub Parser)
### Duration target: Days 6–10

**Context**: Stage 2 of the pipeline currently uses a regex-based entity
extractor. This phase replaces it with Gemini 2.0 Flash, adds the Pydantic-
equivalent validation layer, and integrates Whisper for audio evidence.

### 2.1 — Gemini Service
Create `api/src/services/geminiService.ts`:

```typescript
interface GeminiExtractionResult {
  phones: ExtractedEntity[];
  upis: ExtractedEntity[];
  ips: ExtractedEntity[];
  urls: ExtractedEntity[];
  emails: ExtractedEntity[];
  crypto_wallets: ExtractedEntity[];
  telegram_ids: ExtractedEntity[];
  suspect_names: ExtractedEntity[];
  summary: string;          // 2–4 sentences, AI-generated
  confidence_overall: number; // 0.0 – 1.0
}

interface ExtractedEntity {
  value: string;
  source_file: string;       // filename from evidence_hashes
  source_position?: string;  // char range or bbox: "chars:120-135"
  raw_context: string;       // 50-char window around the entity
}
```

System prompt requirements:
- Temperature: 0 (deterministic output).
- `responseMimeType: 'application/json'` (Gemini native JSON mode).
- The prompt must instruct the model to ONLY extract, never infer.
- Every entity MUST include `source_file` — entities without it are rejected.

### 2.2 — Entity Validation Layer (TypeScript Zod Schema)
Create `api/src/utils/entityValidator.ts` using `zod`:

```typescript
// Validation rules
phone:        /^(\+91|0)?[6-9]\d{9}$/
upi:          /^[a-zA-Z0-9._\-]{2,}@[a-zA-Z]{3,}$/
ip:           valid IPv4 or IPv6 (use 'net' module)
url:          parseable by URL constructor with http/https scheme
email:        RFC 5322 simplified regex
crypto_btc:   /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/
crypto_eth:   /^0x[a-fA-F0-9]{40}$/
crypto_trx:   /^T[a-zA-Z0-9]{33}$/
telegram_id:  numeric string only
```

Validation behavior:
- Values that FAIL validation → moved to `invalidEntities[]`, NOT dropped.
- `invalidEntities` are stored on the case and shown in UI flagged as "HITL
  Review Required".
- This ensures a misformatted but genuine entity is never silently discarded.

### 2.3 — Whisper Audio Transcription
Create `api/src/services/whisperService.ts`:
- Calls a self-hosted Whisper endpoint (configurable via `WHISPER_ENDPOINT` env
  var, defaults to `http://localhost:9000/asr`).
- If Whisper endpoint is unavailable, flag the audio file as
  `transcription_pending` and continue pipeline — do NOT block.
- Transcription output is appended to the evidence text corpus before Gemini
  parsing.
- Supported input: `.mp3`, `.mp4`, `.wav`, `.ogg`, `.m4a`.

### 2.4 — OCR for Image Evidence
Create `api/src/services/ocrService.ts`:
- Send images to Gemini Vision (same API, different prompt) to extract visible
  text.
- OCR prompt: "Extract ALL visible text from this image exactly as written.
  Return plain text only, no formatting."
- OCR output is appended to evidence text corpus before entity extraction.
- If image is a screenshot of a chat, preserve the message order in output.

### 2.5 — Replace Stage 2 in Pipeline
Update `api/src/services/osintPipeline.ts` Stage 2:
- Old: regex-based extraction → New: Gemini + Zod validation.
- Emit `stage_log` events with entity counts as they're extracted.
- Emit `entity_enriched` event for each validated entity immediately (do not
  wait for all entities).
- On Gemini API error: retry once with exponential backoff (2s), then fall back
  to regex extraction, emit `stage_log` with `fallback: true` flag.

### 2.6 — Frontend Entity Display
Update the pipeline UI to show:
- Per-entity type counts in real time as `entity_enriched` events arrive.
- `invalidEntities` in a separate "Flagged for Review" accordion (amber color).
- Gemini `summary` displayed in a card at the top of the pipeline results.
- Source evidence reference shown as a tooltip on each entity chip.

### Phase 2 Exit Criteria
| # | Criterion | Check |
|---|-----------|-------|
| 2-A | Gemini extracts phone/UPI/URL from a test statement with ≥90% precision | |
| 2-B | Entity with no `source_file` is rejected by Zod and moved to invalidEntities | |
| 2-C | Malformed UPI (missing @) is moved to invalidEntities, not dropped | |
| 2-D | Gemini API failure triggers regex fallback; `fallback:true` in stream log | |
| 2-E | Audio file triggers Whisper transcription; transcript feeds Gemini | |
| 2-F | Image file triggers OCR; extracted text feeds entity parser | |
| 2-G | TypeScript compile passes with 0 errors in both packages | |
| 2-H | PROGRESS.md updated with Phase 2 completion block | |

---

## Phase 3 — Full OSINT Enrichment Stack
### Duration target: Days 11–18

**Context**: Stage 3 currently has WhoisXML and VirusTotal. This phase adds
all remaining OSINT providers, implements the confidence scoring system, and
adds the circuit-breaker / fallback logic.

### 3.1 — Confidence Score Enum
Create `api/src/types/confidence.ts`:
```typescript
export enum ConfidenceScore {
  VERIFIED   = 4,   // 2+ independent APIs, matching results
  HIGH       = 3,   // 1 primary API, successful response
  MEDIUM     = 2,   // Web scraper or secondary source
  LOW        = 1,   // AI extraction only, OSINT returned nothing
  UNVERIFIED = 0,   // All lookups failed
}
```

### 3.2 — OSINT Provider Interface
Create `api/src/services/osint/providerInterface.ts`:
```typescript
interface OsintProvider<T> {
  name: string;
  tier: 'PRIMARY' | 'SECONDARY' | 'FALLBACK';
  entityType: EntityType;
  timeout: number;          // ms, default 15000
  lookup(value: string): Promise<OsintResult<T>>;
}

interface OsintResult<T> {
  success: boolean;
  data?: T;
  confidence: ConfidenceScore;
  source: string;           // provider name + response timestamp
  raw?: unknown;            // raw API response, stored for audit
  error?: string;
}
```

### 3.3 — Provider Implementations
Create one file per provider in `api/src/services/osint/providers/`:

**Phone Numbers** (`phoneProviders.ts`):
- Primary: `NumVerify` — carrier, country, line type.
- Secondary: `Truecaller` (unofficial) — name, spam score.
- Fallback: static regex analysis — format validity, operator from prefix.
- PII Rule: Send only last 7 digits to non-Indian APIs (privacy).

**UPI IDs** (`upiProviders.ts`):
- Primary: Razorpay VPA Validation API — bank name, holder status.
- Secondary: Cashfree VPA lookup.
- Fallback: IFSC directory lookup for bank name from `@suffix`.

**IP Addresses** (`ipProviders.ts`):
- Primary: AbuseIPDB — abuse score, report count, categories.
- Secondary: BinaryEdge — open ports, geolocation, ASN.
- Fallback: Local IP regex analysis — private/public/loopback classification.

**URLs & Domains** (`urlProviders.ts`):
- Primary: VirusTotal v3 (already live) — upgrade to include WHOIS, DNS.
- Secondary: URLScan.io — screenshot URL, page title, DNS records.
- Tertiary: WhoisXML (already live) — registrar, creation date.

**Email Addresses** (`emailProviders.ts`):
- Primary: HaveIBeenPwned v3 — breach list.
- Secondary: Hunter.io — domain verification, deliverability.
- Fallback: MX record DNS lookup (Node `dns` module, no API key needed).

**Crypto Wallets** (`cryptoProviders.ts`):
- BTC: Blockstream.info API — balance, tx count, last activity.
- ETH/ERC-20: Etherscan API — balance, tx history, contract interaction.
- TRX: TRONScan API — balance, tx history.
- Fallback: chain detection from address format only.

**Telegram IDs** (`telegramProviders.ts`):
- Primary: TGStat.ru public scraper — channel membership (Playwright).
- Note: Only processes IDs extracted from victim's own chat export.
- If Playwright unavailable: return LOW confidence with ID only.

### 3.4 — Circuit Breaker & Retry Logic
Create `api/src/utils/circuitBreaker.ts`:
- Each provider has its own circuit breaker state.
- States: `CLOSED` (normal) → `OPEN` (failing) → `HALF_OPEN` (testing).
- Opens after 3 consecutive failures within 60 seconds.
- Auto-closes after 5 minutes.
- Logs state transitions to audit_events.

Per-lookup retry:
- Max 1 retry on timeout (not on 4xx errors).
- Exponential backoff: 1s first retry, 3s second.
- Total budget per entity per provider: 15 seconds (hard timeout).

### 3.5 — OSINT Orchestrator
Update `api/src/services/osintPipeline.ts` Stage 3:
- Run all entity types in parallel (Promise.allSettled).
- Within each entity type, run all values in parallel (rate-limited to 5
  concurrent per provider using a semaphore).
- Emit `entity_enriched` stream event after each entity completes enrichment.
- Enrich event payload:
  ```typescript
  {
    entity_value: string;
    entity_type: EntityType;
    results: OsintResult[];
    confidence: ConfidenceScore;   // highest confidence from any provider
    flags: string[];               // e.g. ["SPAM_REPORTED", "PHISHING_URL"]
  }
  ```

### 3.6 — PII Minimisation in Transit
Create `api/src/utils/piiSanitizer.ts`:
- `maskPhone(number)` → returns last 4 digits only for logging.
- `hashAccountNumber(acc)` → SHA-256 hex, used in non-Indian API calls.
- `stripExif(imageBuffer)` → removes EXIF before sending image to external API.
- Used automatically in every provider — not optional per call.

### Phase 3 Exit Criteria
| # | Criterion | Check |
|---|-----------|-------|
| 3-A | Phone enrichment returns carrier + spam score for a test number | |
| 3-B | UPI enrichment returns bank name for a valid VPA | |
| 3-C | IP enrichment returns AbuseIPDB score for a known bad IP | |
| 3-D | URL enrichment combines VirusTotal + URLScan results | |
| 3-E | Email enrichment returns breach data from HIBP | |
| 3-F | Crypto enrichment returns tx count for a known BTC address | |
| 3-G | Circuit breaker opens after 3 consecutive provider failures | |
| 3-H | Failed provider falls back to next tier; confidence marked accordingly | |
| 3-I | `entity_enriched` stream event fires for each entity in real time | |
| 3-J | PII sanitizer masks phone before sending to non-Indian API | |
| 3-K | TypeScript compile passes with 0 errors | |
| 3-L | PROGRESS.md updated with Phase 3 completion block | |

---

## Phase 4 — Neo4j Graph Correlation Engine
### Duration target: Days 19–24

**Context**: Stage 4 currently uses MongoDB queries for correlation. This
phase adds Neo4j as the graph backend. MongoDB correlation remains as fallback
if Neo4j is unavailable.

### 4.1 — Neo4j Setup
- Add `neo4j-driver` to `api/package.json`.
- Create `api/src/services/graphDB.ts` with:
  - Connection pool (max 10 connections).
  - `runQuery(cypher, params)` — typed query executor.
  - `isAvailable()` — health check, returns bool.
  - On Neo4j unavailable: log warning, fall back to MongoDB correlation.

### 4.2 — Node & Relationship Schema
On case OSINT run, write entities to Neo4j:

**Nodes** (MERGE on unique property to avoid duplicates):
```cypher
MERGE (p:PhoneNumber {value: $value})
MERGE (u:UpiID {value: $value})
MERGE (i:IPAddress {value: $value})
MERGE (d:Domain {value: $value})
MERGE (e:Email {value: $value})
MERGE (w:CryptoWallet {value: $value, chain: $chain})
MERGE (t:TelegramID {value: $value})
MERGE (c:Case {caseId: $caseId, date: $date, lossInr: $loss})
```

**Relationships**:
```cypher
(c:Case)-[:INVOLVED {confidence: $conf, source: $source}]->(entity)
```

### 4.3 — Cluster Detection Queries
Create `api/src/services/correlationQueries.ts`:

**SHARED_UPI_CLUSTER**:
```cypher
MATCH (c1:Case)-[:INVOLVED]->(u:UpiID)<-[:INVOLVED]-(c2:Case)
WHERE c1.caseId <> c2.caseId
WITH u, collect(DISTINCT c1.caseId) + collect(DISTINCT c2.caseId) AS cases
WHERE size(cases) >= 3
RETURN u.value AS upi, cases, size(cases) AS caseCount
ORDER BY caseCount DESC
```

**PHONE_MULE_CHAIN**:
```cypher
MATCH path = (c:Case)-[:INVOLVED*1..3]-(p:PhoneNumber)
WHERE c.caseId = $caseId
RETURN path
```

**DOMAIN_PHISHING_CAMPAIGN**:
```cypher
MATCH (c:Case)-[:INVOLVED]->(d:Domain)<-[:INVOLVED]-(c2:Case)
WHERE c.caseId <> c2.caseId
WITH d, collect(DISTINCT c.caseId) AS cases
WHERE size(cases) >= 5
RETURN d.value, cases
```

**TEMPORAL_BURST**:
```cypher
MATCH (c1:Case)-[:INVOLVED]->(u:UpiID)<-[:INVOLVED]-(c2:Case)
WHERE abs(duration.inSeconds(c1.date, c2.date).seconds) < 259200
WITH u, collect(DISTINCT c1) + collect(DISTINCT c2) AS cases
WHERE size(cases) >= 3
RETURN u.value, [c IN cases | c.caseId] AS caseIds
```

### 4.4 — Maltego Export
Create `api/src/utils/maltegoExport.ts`:
- Generates `.mtgx` XML file from Neo4j query results.
- Exported as a downloadable artifact on the case page.
- Export endpoint: `GET /osint/case/:caseId/investigation/maltego-export`

### 4.5 — Graph Visualization Data Endpoint
Create `GET /osint/case/:caseId/investigation/graph`:
- Returns D3-compatible JSON: `{nodes: [...], links: [...]}`.
- Nodes include: `id`, `type`, `label`, `confidence`, `flags`.
- Links include: `source`, `target`, `relationship`, `caseCount`.
- This powers the n8n-style topology view in the frontend.

### 4.6 — Frontend Graph View
Update `web/app/(admin)/admin/osint/case/[caseId]/page.tsx`:
- Add a "Graph" tab using `react-force-graph-2d` or D3.
- Node color by type: phone=green, upi=blue, ip=purple, url=amber, etc.
- Cluster alert badges shown inline when SHARED_UPI_CLUSTER or TEMPORAL_BURST
  fires.
- Clicking a node shows all cases it appears in (sidebar panel).

### Phase 4 Exit Criteria
| # | Criterion | Check |
|---|-----------|-------|
| 4-A | Case entities written to Neo4j after pipeline run | |
| 4-B | SHARED_UPI_CLUSTER query returns results for test dataset with shared UPI | |
| 4-C | TEMPORAL_BURST fires when 3+ cases share UPI within 72 hours | |
| 4-D | `/graph` endpoint returns D3-compatible JSON | |
| 4-E | Frontend graph view renders nodes and links correctly | |
| 4-F | Maltego `.mtgx` export downloads without error | |
| 4-G | Neo4j unavailable → pipeline falls back to MongoDB correlation without crash | |
| 4-H | TypeScript compile passes with 0 errors | |
| 4-I | PROGRESS.md updated with Phase 4 completion block | |

---

## Phase 5 — Evidence Integrity (MinIO + SHA-256 Chain)
### Duration target: Days 25–29

**Context**: Files are currently stored on local disk. This phase migrates
storage to MinIO with server-side encryption, enforces immutability of evidence
after intake, and generates the SHA-256 manifest referenced in GRASSReport v1.0.

### 5.1 — MinIO Service
Create `api/src/services/storageService.ts`:
```typescript
interface StorageService {
  upload(file: Buffer, metadata: EvidenceMetadata): Promise<StoredFile>;
  getPresignedUrl(path: string, expiresInSeconds: number): Promise<string>;
  computeSha256(buffer: Buffer): string;
  lockObject(path: string): Promise<void>;   // Object Lock: COMPLIANCE mode
}
```

MinIO Object Lock (COMPLIANCE mode) — once set, the object cannot be deleted
or overwritten by any user, including admin. This is the technical guarantee
for chain of custody.

### 5.2 — Evidence Hash Record Model
Create/update `api/src/models/EvidenceHash.ts`:
```typescript
interface IEvidenceHash {
  caseId: string;
  fileName: string;
  originalName: string;
  minioPath: string;
  sha256: string;
  fileSizeBytes: number;
  mimeType: string;
  ingestedAt: Date;
  ingestedByIp: string;   // encrypted with AES-256 at rest
  isLocked: boolean;      // true after MinIO COMPLIANCE lock applied
}
```
The `evidence_hashes` MongoDB collection must have a unique index on
`(caseId, sha256)` to prevent duplicate uploads.

### 5.3 — EXIF Stripping for Privacy
On every image/video upload, before writing to MinIO:
- Strip EXIF metadata from the copy sent to external OSINT APIs.
- Preserve the ORIGINAL file (with EXIF) in MinIO for forensic use.
- Store extracted EXIF data as a separate JSON artifact on the case.

### 5.4 — Migrate Existing Evidence Storage
Write a migration script `api/scripts/migrateEvidenceToMinio.ts`:
- Reads all existing evidence files from local disk.
- Uploads each to MinIO with server-side encryption.
- Computes SHA-256, writes EvidenceHash records.
- Does NOT delete local files until migration is verified.
- Is idempotent (re-runnable without duplication).

### Phase 5 Exit Criteria
| # | Criterion | Check |
|---|-----------|-------|
| 5-A | New evidence upload stored in MinIO with server-side encryption | |
| 5-B | SHA-256 written to evidence_hashes immediately on upload | |
| 5-C | evidence_hashes record cannot be updated via any API endpoint | |
| 5-D | Object Lock applied — MinIO object cannot be deleted via console | |
| 5-E | EXIF stripped from external-facing copies; original preserved in MinIO | |
| 5-F | Migration script runs on existing data without errors | |
| 5-G | TypeScript compile passes with 0 errors | |
| 5-H | PROGRESS.md updated with Phase 5 completion block | |

---

## Phase 6 — PDF Report Generation (GRASSReport v1.0)
### Duration target: Days 30–35

**Context**: Reports are currently Markdown. This phase generates a
professionally formatted, legally structured PDF using a template system.

### 6.1 — Report Schema Enforcement
Create `api/src/types/grassReport.ts` — the TypeScript equivalent of
GRASSReport v1.0 JSON schema (from PRD v2 Section 9). All 18 fields defined.
Zod schema validates the object before PDF generation begins.

### 6.2 — PDF Generator Service
Create `api/src/services/pdfService.ts`:
- Uses `puppeteer` (headless Chrome) to render HTML → PDF.
  (WeasyPrint is Python-only; Puppeteer works natively in Node.js.)
- HTML templates stored in `api/src/templates/report/`.
- Template uses CSS variables for theming — never hardcoded colors.
- Generates:
  - `report.pdf` (full, analyst-only).
  - `report_redacted.pdf` (victim-facing, no cross-case correlation data).

### 6.3 — Report Template Sections
The HTML template must render all sections from PRD v2 Section 3.6.2:
1. Cover page with Case ID, GRASSReport v1.0 version, analyst badge ID.
2. Evidence hash manifest table.
3. Executive summary (from Gemini, HITL-verified).
4. Victim statement verbatim.
5. Timeline of events.
6. Extracted entities & OSINT findings table with confidence indicators.
7. Cross-case correlation (Neo4j cluster alerts).
8. Modus operandi classification.
9. Actionable recommendations.
10. Legal draft appendix (pre-filled Section 94 BNSS + Section 457 BNSS).
11. Analyst certification block with badge ID.

### 6.4 — Legal Draft Templates
Create `api/src/templates/legal/`:
- `sec94_bnss_preservation.html` — Data preservation notice.
- `sec457_bnss_freeze.html` — Account freeze request.
- `sec63_bsa_certificate.html` — Electronic evidence certificate.
Auto-filled from case data. Analyst reviews before dispatch.

### 6.5 — Report Endpoints
- `GET /osint/case/:caseId/investigation/report/pdf` — Full PDF.
- `GET /osint/case/:caseId/investigation/report/pdf/redacted` — Redacted PDF.
- `GET /osint/case/:caseId/investigation/report/json` — GRASSReport JSON.

### Phase 6 Exit Criteria
| # | Criterion | Check |
|---|-----------|-------|
| 6-A | Full PDF generates without Puppeteer errors for a completed case | |
| 6-B | PDF contains all 11 sections from PRD v2 Section 3.6.2 | |
| 6-C | Evidence hash manifest in PDF matches evidence_hashes MongoDB records | |
| 6-D | Redacted PDF removes cross-case correlation data | |
| 6-E | Pre-filled Section 94 BNSS template contains correct case entities | |
| 6-F | GRASSReport JSON validates against Zod schema | |
| 6-G | Report cannot be generated if analyst badge is missing | |
| 6-H | TypeScript compile passes with 0 errors | |
| 6-I | PROGRESS.md updated with Phase 6 completion block | |

---

## Phase 7 — Pipeline Reliability (Retry, Replay, Queue)
### Duration target: Days 36–40

### 7.1 — Per-Stage Retry Orchestration
Update `api/src/services/osintPipeline.ts`:
- Each stage wrapped in a retry loop: max 2 retries, exponential backoff.
- Stage state persisted to MongoDB: `{stageId, status, startedAt, completedAt,
  retryCount, lastError}`.
- If a stage fails after retries, pipeline pauses at that stage — earlier
  stages' results are preserved.

### 7.2 — Run History & Replay
- Every pipeline run gets a unique `runId` (UUID).
- All run events stored to `pipeline_runs` MongoDB collection.
- `GET /osint/case/:caseId/investigation/runs` — paginated run history.
- `POST /osint/case/:caseId/investigation/runs/:runId/replay` — re-runs
  pipeline from a specific failed stage, preserving successful stage results.

### 7.3 — Background Job Queue (Bull)
Add `bull` queue for cases not requiring real-time streaming:
- Queue: `osint-pipeline`.
- Priority levels: `URGENT` (financial fraud > ₹1L), `NORMAL`, `BULK`.
- Worker: `api/src/workers/pipelineWorker.ts`.
- Concurrency: 3 jobs simultaneously.
- Monitoring UI: `bull-board` mounted at `/admin/queues` (ADMIN role only).

### Phase 7 Exit Criteria
| # | Criterion | Check |
|---|-----------|-------|
| 7-A | Stage 3 failure retries up to 2 times before marking failed | |
| 7-B | Stage 2 success preserved when Stage 3 fails permanently | |
| 7-C | Run history endpoint returns paginated list of previous runs | |
| 7-D | Replay endpoint re-runs from failed stage without duplicating Stage 2 data | |
| 7-E | Bull queue processes 3 concurrent jobs correctly | |
| 7-F | Bull board accessible at /admin/queues for ADMIN role | |
| 7-G | TypeScript compile passes with 0 errors | |
| 7-H | PROGRESS.md updated with Phase 7 completion block | |

---

## Phase 8 — Data Retention, Legal Compliance & Audit Views
### Duration target: Days 41–46

### 8.1 — Automated Data Retention
Create `api/src/jobs/retentionJob.ts` (scheduled cron, runs daily at 02:00 UTC):
- Query cases where `closedAt < NOW - retentionDays`.
- Retention periods from PRD v2 Section 7.3 (hardcoded as constants).
- Deletion: MinIO object expiry + MongoDB soft-delete.
- Log every deletion to `retention_audit` collection.
- Never deletes `evidence_hashes` records (permanent by design).

### 8.2 — Audit View (ADMIN Role)
Create `web/app/(admin)/admin/audit/page.tsx`:
- Filterable table: action type, user, date range, outcome.
- Export as CSV.
- Shows retention deletion log separately.

### 8.3 — DPDP Act 2023 Compliance Checklist
Implement the following automatically:
- Victim can request evidence deletion via `POST /user/erasure-request`.
- Erasure request queued for SENIOR_ANALYST review (not immediate auto-delete).
- System sends acknowledgement email within 72 hours of erasure request.
- Erasure exception: active prosecution flag on case blocks deletion.

### Phase 8 Exit Criteria
| # | Criterion | Check |
|---|-----------|-------|
| 8-A | Retention cron job runs and deletes eligible evidence on schedule | |
| 8-B | evidence_hashes records NOT deleted by retention job | |
| 8-C | Audit view shows all audit_events with filter/export | |
| 8-D | Victim erasure request creates a queued review item | |
| 8-E | Active prosecution flag blocks erasure | |
| 8-F | TypeScript compile passes with 0 errors | |
| 8-G | PROGRESS.md updated with Phase 8 completion block | |

---

## Progress Recording Template
### (Agent appends one of these blocks after completing each phase)

```markdown
## Phase N — [Phase Name]

**Status**: COMPLETE
**Completed**: YYYY-MM-DD
**Run by**: [Agent identifier or "Cursor Agent"]

### Exit Criteria Results
| # | Criterion | Result |
|---|-----------|--------|
| N-A | [criterion text] | ✅ PASS |
| N-B | [criterion text] | ✅ PASS |

### Files Modified
- `path/to/file.ts` — [one-line description of change]
- `path/to/file2.ts` — [one-line description of change]

### Files Created
- `path/to/newfile.ts` — [one-line description]

### Decisions Made
- [Any architectural decision made during this phase, with justification]

### Known Gaps / Deferred to Later Phase
- [Anything intentionally left incomplete, with the phase it belongs to]

### TypeScript Compile Status
- `api/`: PASS (0 errors)
- `web/`: PASS (0 errors)

### Lint Delta
- Errors before: N | Errors after: N | Delta: 0 (must not increase)
```

---

## Global Rules for Agent Execution

1. **Read before writing**: Always read the target file before editing it.
2. **One phase at a time**: Never start Phase N+1 code before Phase N exit
   criteria are all GREEN.
3. **No silent failures**: If an exit criterion cannot be met, STOP, log the
   blocker in PROGRESS.md under the current phase, and halt.
4. **No breaking changes**: Never delete or rename an existing working
   endpoint without a deprecation comment and migration note.
5. **TypeScript is non-negotiable**: `npm run typecheck` in `api/` and
   `npx tsc --noEmit` in `web/` must pass with 0 errors after every file
   change.
6. **Lint discipline**: Lint error count must not increase from the Phase 0
   baseline.
7. **Secrets hygiene**: Never hardcode API keys. Always use `process.env.*`
   with a corresponding entry in `.env.example`.
8. **Test what you build**: For every new service, write at minimum one
   integration test that confirms the happy path works.
9. **PROGRESS.md is sacred**: It is the single source of truth for what is
   done. Update it immediately after each phase, not at the end of the week.
10. **Ask no one**: This plan is designed to be fully self-executing. If
    something is ambiguous, default to the more conservative/secure choice and
    document the decision in PROGRESS.md.
