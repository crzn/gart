# Gart — Architecture & Implementation Plan (Phase 0)

Status: **approved 2026-11-20. Phase 1 delivered (see CHANGELOG.md).** Decisions taken on the open questions are recorded in DECISIONS.md and override the text below where they differ: **no R2** (media in D1, D-001), **local web installer** (D-002), **lowered PBKDF2 iterations** instead of a hashing Durable Object (D-003), roles owner/admin/editor (D-004).
Limits below were checked against Cloudflare docs on 2026-11-20. All quotas will live in `config/cloudflare-limits.json` and must be re-verified before each release.

---

## 1. Verified Cloudflare Free plan facts

| Resource | Free limit | Notes |
|---|---|---|
| Workers requests | 100,000/day | Static asset requests are free and unlimited. Resets 00:00 UTC (02:00 Kyiv). |
| Workers CPU | **10 ms per invocation** | Waiting on I/O is not CPU. |
| Workers subrequests | 50 external / 1,000 to CF services per invocation | |
| Durable Objects | SQLite-backed only | KV-backed DOs are paid-only. |
| DO requests | 100,000/day | Incoming WS messages billed 20:1; each WS connect = 1 request; outgoing messages and protocol pings free. |
| DO duration | 13,000 GB-s/day | Billed as 128 MB even if less used; wall-clock while not hibernated. |
| DO SQL rows written | 100,000/day | **Binding constraint** for us (see §9). |
| DO SQL rows read | 5M/day per docs page ("matches D1"); cloudflare.com pricing page says 50M/day | **Discrepancy.** Plan with 5M. |
| DO storage | 5 GB account total; 1 GB per object | |
| D1 | 5M rows read/day, 100K rows written/day, 5 GB total, 500 MB per database, 50 queries per invocation | |
| R2 | 10 GB-month, 1M Class A/month, 10M Class B/month, free egress | **Needs verification:** R2 may require a payment method on the account even for free usage. |
| Workers Logs | 200,000 events/day, 3-day retention | |
| Cron Triggers | 5 per account | |

**Behavior at the limit:** on the Free plan, exceeding any limit makes further operations of that type *fail with errors* until the daily reset. Nothing is billed, but a game in progress can break. This drives the quota-guard design below.

---

## 2. Conflicts and risks found in the requirements

1. **10 ms CPU vs password hashing.** PBKDF2 via Web Crypto may exceed 10 ms at a safe iteration count. *Action:* measure on a real Free account in Phase 2. Fallback: run hashing inside a dedicated Durable Object (30 s CPU limit by docs — also to be verified on Free), or lower iterations with documented trade-off. Not decided yet.
2. **R2 may not be $0-without-card.** If a card is required, R2 violates "free plan only" for some customers. *Proposal:* make R2 optional. No-R2 mode: client-side resize/compress to WebP ≤ 200 KB, stored as BLOBs in D1 (D1 bills rows, not bytes), served with immutable cache headers. Installer detects R2 availability and chooses.
3. **Daily caps are hard stops.** A load test of 120 players consumes real quota. Load tests must target a separate throwaway deployment, and the Usage Monitor must warn *before* a game starts.
4. **DO rows-written is the real ceiling** (~12 full games/day, §9). Fine for "several per month", but the design must avoid per-event writes.
5. **Legacy 1,000 requests/min burst limit** appeared in an older Workers doc for Free accounts. Unverified for today. Design keeps the join path to ~2 Worker requests per player (WS upgrade + static assets, which are free) so 120 joins in a minute stay far under it.
6. **Duplicate-answer and "no lost answers" vs hibernation.** In-memory state is lost on hibernation, so every accepted answer must be written to DO SQLite synchronously (SQLite writes in DOs are synchronous and durable before response output is released). This costs rows written but is required.
7. **Official usage cannot be read without a token.** Cloudflare GraphQL Analytics needs an API token. Per requirements, the monitor works without one (estimated + measured app counters) and offers optional token or manual reconciliation. Never present app counters as billing data.
8. **"Refuse to deploy if Free resources unavailable"** cannot be determined from a plan lookup alone. Installer will attempt creation and treat errors as authoritative.
9. **Turnstile** needs a widget created via API/dashboard (token or manual step). Make it optional and off by default; protect admin login with rate limiting first.
10. **Scope.** This is a multi-month product. We build in the 8 phases of your plan with exit criteria; "120 players supported" is only claimed after a real load test passes.

---

## 3. System architecture

```
Browser (Admin / Host / Projector / Player)
   │  HTTPS (static assets: free)         │  WSS
   ▼                                      ▼
Cloudflare Worker (Hono)  ───────────►  GameRoom Durable Object (1 per game, SQLite)
   │  /api/*  auth, CRUD, uploads          • lifecycle state machine
   │  /ws/:pin  upgrade → forwards to DO   • players, answers, scores (SQLite)
   │                                       • question timers via alarm()
   ├── D1: durable app data                • WebSocket Hibernation
   ├── media: stored in D1 (no R2, D-001)  • flushes final results → D1 once
   └── RateLimiter DO: login throttling
```

Key decisions:

- **One Worker** serves static assets (Vite build via Workers Static Assets), the Hono API, and WebSocket upgrades.
- **Room addressing:** `GameRoom` id = `idFromName(pin)`. Joining needs no D1 lookup; an unknown PIN is detected by the DO's empty state. Active-PIN uniqueness is checked at game creation by a `game_sessions` row (unique index on active PIN).
- **Hibernation:** use `ctx.acceptWebSocket()`, per-socket `serializeAttachment` (playerId, role), and `webSocketMessage/Close/Error` handlers. Question timers use `alarm()`, never `setTimeout`, so the room can hibernate between events. No application heartbeats; rely on protocol-level auto-response pings (free).
- **Authoritative server:** answer time = server receipt timestamp relative to the server-stored `question.startedAt`. Clients display a countdown from server-provided `startsAt/endsAt` and a one-time `serverTime` offset; they never score.
- **Single writer per room:** DO single-threading gives atomic "one answer per player per question" via `UNIQUE(question_idx, player_id)`.
- **Quota guard in the room:** per-socket token bucket (e.g. 5 msgs/s burst 10), duplicate-message id dedupe, max players cap, max message size.
- **Persistence boundary:** DO SQLite holds all live state. At `FINISHED`, one batched D1 write persists session, participants and per-answer results; then the DO schedules self-cleanup (alarm → delete storage after retention).
- **Admin auth:** PBKDF2 (pending §2.1), opaque 256-bit session token in `HttpOnly; Secure; SameSite=Strict` cookie, only the SHA-256 hash stored in D1, CSRF via custom-header + Origin check. Login throttling in a `RateLimiter` DO keyed by IP + username (no D1 writes on the hot path).
- **WS auth:** host connects with a short-lived HMAC-signed ticket minted by an authenticated API call (bound to game id, 60 s TTL, single use). Players receive a random `playerToken` at join (stored hashed in room SQLite) used for reconnect; replay protection via per-socket monotonically increasing `seq`.
- **Secrets:** `SESSION_SECRET`, `WS_TICKET_SECRET` set via `wrangler secret put`; never in repo or frontend.

---

## 4. Repository structure

```
gart/
├─ apps/
│  ├─ web/                  React + Vite + Tailwind (admin, host, projector, player)
│  │   └─ src/{pages,components,features,i18n,lib,styles}
│  └─ worker/               Hono API + DO + WS
│      └─ src/{routes,services,repositories,durable/GameRoom,middleware,usage}
├─ packages/
│  ├─ shared/               zod schemas, WS protocol types, scoring (pure, shared by tests)
│  └─ i18n/                 uk.json (default), en.json
├─ migrations/              D1 SQL migrations + seed (templates, avatars)
├─ config/cloudflare-limits.json
├─ installer/               Node engine, install.sh, install.ps1, steps/*, health checks
├─ tests/{unit,integration,ws,load,quota}
├─ docs/                    ARCHITECTURE, SECURITY, INSTALL, ADMIN, BACKUP-RECOVERY
├─ wrangler.template.jsonc  (real wrangler.jsonc generated by installer, gitignored)
├─ LICENSE (AGPL-3.0) · CHANGELOG.md · README.md
```

Layering rule: routes → services → repositories (all D1 SQL only in repositories). Scoring and protocol schemas live in `packages/shared` as pure functions so the DO and tests use identical code.

---

## 5. Database schema (D1)

All ids are random UUIDv4 text; timestamps are ISO-8601 UTC text (`created_at`, `updated_at`).

| Table | Key columns / constraints |
|---|---|
| `administrators` | id, email UNIQUE, display_name, password_hash, password_salt, kdf_params, role (`owner`/`admin`/`editor`), disabled |
| `admin_sessions` | id, admin_id FK, token_hash UNIQUE, expires_at, last_seen_at, ip_hash, user_agent. Index on expires_at |
| `quiz_templates` | id, name, is_system, settings_json (timers, scoring, presentation, feedback) |
| `quizzes` | id, title, description, cover_media_id FK, category, tags_json, difficulty, language, template_id FK, settings_json, status (`draft`/`active`/`archived`), created_by FK. Index on status, updated_at |
| `questions` | id, quiz_id FK CASCADE, position, type (`single`/`truefalse`), text, image_media_id FK, time_limit_s, points, explanation. UNIQUE(quiz_id, position) |
| `answer_options` | id, question_id FK CASCADE, position, text, image_media_id FK, is_correct. UNIQUE(question_id, position) |
| `game_sessions` | id, quiz_id FK, pin, status, settings_snapshot_json, quiz_snapshot_json, started_at, finished_at, host_admin_id FK. Partial unique index on pin WHERE status in active states |
| `game_participants` | id, game_id FK, nickname, avatar, final_rank, total_points, correct_count. UNIQUE(game_id, nickname) |
| `game_results` | id, game_id FK, participant_id FK, question_position, option_id, is_correct, points, answer_ms. UNIQUE(game_id, participant_id, question_position) |
| `uploaded_media` | id, storage (`r2`/`d1`), object_key or blob, mime, bytes, sha256, uploaded_by FK |
| `application_settings` | key PK, value_json (branding, retention, language, safe-mode flag, usage config) |
| `usage_metrics` | day, metric, source (`measured`), value. PK(day, metric) — daily rollups only |
| `audit_logs` | id, admin_id, action, entity, entity_id, meta_json, created_at. Index on created_at |

Quiz and settings are **snapshotted** into `game_sessions`, so editing a quiz never alters a running or historical game. Templates are rows, not code.

---

## 6. WebSocket protocol (JSON, v1)

Envelope: `{ v:1, t:<type>, id:<client msgId>, seq:<int>, d:{...} }`. Server validates every message with zod; unknown/oversized messages close the socket with a code.

**Client → server**

| Type | Sender | Payload | Notes |
|---|---|---|---|
| `player.join` | player | nickname, avatar | Returns `playerToken`; nickname rules and uniqueness enforced |
| `player.resume` | player | playerToken | Reconnect |
| `host.auth` | host | ticket | Single-use HMAC ticket |
| `answer.submit` | player | questionIdx, optionId | Server time-stamps; first valid wins |
| `host.start` / `host.nextQuestion` / `host.closeQuestion` / `host.showResults` / `host.showLeaderboard` / `host.pause` / `host.resume` / `host.end` | host | — | Validated against state machine |
| `host.kick` | host | playerId | |
| `screen.attach` | projector | ticket (read-only) | Projector mode, no control rights |

**Server → client**

`hello` (serverTime, role, state snapshot) · `lobby.update` (counts, delta joins/leaves) · `player.joined` / `player.left` / `player.reconnected` · `question.start` (question w/o correct flag, startsAt, endsAt) · `answer.ack` / `answer.reject` (reason code) · `progress.update` (answered count, **throttled/coalesced ~1/s**) · `question.closed` · `results` (correct option, per-player points/rank/delta, distribution, explanation) · `leaderboard` · `game.paused` / `game.resumed` · `game.finished` (summary) · `error`.

Efficiency rules: no polling, no heartbeats; progress counters are coalesced; per-player results are sent individually only once per question; leaderboard sends top-N plus the recipient's own rank.

**State machine:** `CREATED → LOBBY → QUESTION_ACTIVE ⇄ (paused) → QUESTION_RESULTS → LEADERBOARD → QUESTION_ACTIVE … → FINISHED`; `CANCELLED` reachable from any non-final state. Transitions are a pure function in `packages/shared`, covered by table-driven tests.

**Scoring (deterministic, server-side):**
`points = correct ? base + round(base * speedFactor * max(0, 1 − elapsed/limit)) : 0`, where `speedFactor` is configurable (0 = no speed bonus). Integer math only, so results are reproducible. The Admin Studio shows the formula and a worked example.

---

## 7. Deployment process (installer)

Node engine shared by `install.sh` / `install.ps1`; wizard UI = **local web wizard on localhost** (CLI fallback). Steps, each idempotent with `check → plan → apply → verify`:

1. Verify Node ≥ required version/npm; install or verify Wrangler locally.
2. `wrangler login` (OAuth); list accounts via `wrangler whoami`; user selects.
3. Probe prerequisites by attempting resource creation (see §2.8). Abort with explanation if anything is unavailable on Free.
4. Create or reuse D1 database; detect R2 availability → create bucket or choose no-R2 mode (user informed of any charge-related prompt).
5. Generate `wrangler.jsonc` (gitignored) with D1/R2/DO bindings and the SQLite DO migration.
6. Generate and `wrangler secret put` the secrets (never logged or written to disk).
7. Build frontend → `wrangler deploy` → `wrangler d1 migrations apply`.
8. Create first administrator via a one-time setup token (hash stored in D1, consumed on first use); public registration is then permanently disabled.
9. Health checks: `/api/health`, D1 read/write, DO round trip, WS echo, static assets.
10. Print URL and summary. Actions: Install · Update · Repair · Backup config · Uninstall (data deletion requires typed confirmation).

Wrangler-cached OAuth credentials are not touched by the installer; no tokens are stored by us.

---

## 7a. Web installer and release packages (0.8.1)

```
GitHub Release (public)             Administrator's Cloudflare account
 gart-installer.json (signed page)   ┌───────────────────────────────────────────┐
 gart-package.json  (signed bundle)  │ bootstrap Worker (pasted by the admin)    │
        │                            │  / → installer page (signature checked)   │
        ├───────── /pkg ────────────►│  /pkg → relays the package                │
        │                            │  /cf/* → relays to api.cloudflare.com     │
 browser (installer page) ◄──────────┤  stores nothing                           │
   verifies package signature        └───────────────────────────────────────────┘
   deploy engine ── /cf/* ──► Cloudflare API: D1, migrations, assets, Worker upload, domain
```

- **Package** (`packages/deploy-engine/src/package-format.mjs`): one JSON file with the manifest (versions, SHA-256 of every file, Durable Object migrations, bindings, notes), its ECDSA P-256 signature over the exact manifest text, and the files (bundled Worker, static files, SQL migrations) as base64 blobs. Built by `scripts/build-package.mjs`; signed in CI with the secret `GART_SIGNING_KEY`; the public key lives in `config/release.json` and is embedded in the bootstrap script.
- **Engine** (`deploy.mjs`, `cloudflare.mjs`): verify, create or reuse D1, apply migrations (same `d1_migrations` bookkeeping as wrangler), upload static assets (session, buckets, completion token), upload the Worker (bindings, secrets on install, `keep_bindings` on update, Durable Object migration steps computed from the tag the Worker already has), enable workers.dev, optional custom domain. Call shapes follow wrangler's own source. Every step is safe to repeat.
- **Bootstrap Worker** (`bootstrap/bootstrap.template.js`): about 100 readable lines. Relay only for `/accounts`, `/zones`, `/user/tokens/verify`, only for same-origin calls from its own page. The installer page runs under a nonce-based CSP.
- **Setup page** (`/setup` in the web app): the installer sends the administrator there with the one-time token in the URL fragment; the password is typed on the new site and never passes through the installer.
- **Tests:** engine against a fake Cloudflare API that really runs the migrations on SQLite and checks request shapes (`tests/fakes/fake-cloudflare.mjs`); browser test of the whole wizard through the real bootstrap Worker (`tests/e2e/web-installer.e2e.mjs`). The real Cloudflare API has not been exercised yet.

## 7b. In-app updates (0.8.2)

```
Admin panel (owner) ── /api/updates/* ──► Worker ──► Updater Durable Object ("main")
                                                      ├─ stores: encrypted token, last release list, run progress
                                                      ├─ check:  GitHub releases API (cached 30 min)
                                                      └─ alarm:  download gart-package.json → verify signature + hashes
                                                                 → deploy engine (mode "update") → Cloudflare API
```

- `routes/updates.ts` (owner only, rate-limited, audited) is a thin wrapper; all state lives in `durable/Updater.ts`.
- The run is an alarm, so it survives the request that started it and gets the Durable Object CPU budget. The browser polls `GET /api/updates`; when the new code starts serving, the unfinished run is recognised as done because the running version equals the target.
- Steps: download, verify, then the engine's steps (database, migrations, assets, worker). Address and domain are never touched on update.
- A migration flagged as destructive stops the run in the `confirm` phase until the owner acknowledges it. Rollback to a package whose Durable Object migration list does not contain the installed tag is refused.
- Test: `tests/e2e/web-updates.e2e.mjs` (real Worker, fake Cloudflare and GitHub, real browser).

## 8. Usage Monitor methodology

Three clearly separated layers in the UI:

1. **Estimated** — calculator: inputs (games/month, players, questions, duration, reconnects, msgs/player, uploads, views, retention) × per-event coefficients in `config/cloudflare-limits.json`. Coefficients are initial analytical values and are **recalibrated from load-test measurements** before release.
2. **Measured (application)** — in-memory counters flushed once per game end and once per day into `usage_metrics` (no per-message D1 writes). Row counts for D1 come from each query's `meta.rows_read/rows_written`.
3. **Official** — optional Analytics GraphQL with a narrow read-only token, or manual entry/CSV reconciliation. Never mixed with 1–2.

Daily accounting uses the UTC day (reset at 00:00 UTC) and shows the local-time reset. Thresholds 50/75/90/100% configurable. Pre-game check: projected game cost vs remaining daily quota per resource; below threshold → warn; above → block-with-override or "safe mode" (no per-answer progress broadcasts, reduced audit detail). Nothing ever enables paid services.

---

## 9. First-pass capacity estimate (one 120-player, 20-question game)

*Analytical estimates, not measurements.*

| Resource | Per game | Free daily cap | Games/day at cap |
|---|---|---|---|
| Worker requests (WS upgrades, API) | ~500 | 100,000 | very high |
| DO billed requests (121 connects + ~3,000 msgs ÷ 20) | ~270 | 100,000 | ~370 |
| DO rows written (answers, scores, state, indexes) | ~6,000–9,000 | 100,000 | **~11–16** |
| D1 rows written (final persist, indexes) | ~3,000–6,000 | 100,000 | ~16–33 |
| DO duration (1 h awake, worst case) | ~450 GB-s | 13,000 | ~28 |
| DO/D1 rows read | tens of thousands | 5M | not binding |

Conclusion: several games per month is comfortable; ~10 full games on one UTC day is the practical ceiling. The ceiling is driven by rows written, so the engine batches score updates at question close and avoids per-event audit writes.

---

### 9.1 Phase 4 measurement (local `wrangler dev`, `tests/e2e/game.e2e.mjs`)

Counted inside the room (`GET /api/games/:id/usage`). Local numbers show the number of SQL rows the code touches; Cloudflare's own accounting was **not** checked on a real account yet.

| Game | Answers | DO rows written | DO rows read | Incoming WS messages |
|---|---|---|---|---|
| 30 players, 3 questions | 92 | 152 | 630 | 116 |
| 120 players, 3 questions | 365 | 497 | 2,460 | 371 |

Writes are about 1 row per answer plus about 2 per player plus a small constant, so a full 120 x 20 game is projected at about 2,700 rows written (answers 2,400 + players 240 + state), i.e. about 35 full games per UTC day against the 100,000 cap (the earlier estimate was 11-16). The projection is arithmetic on the measured slope, not a measurement of a 20-question game.

### 9.2 Usage Monitor (phase 6)

`packages/shared/src/usage.ts` holds the model, thresholds and projections (pure, unit-tested; the limits come from `config/cloudflare-limits.json`). Per 120 x 20 game the model gives about 2,700 Durable Object rows written, 4,600 D1 rows written, 89,000 Durable Object rows read (the read figure assumes the ranking is recomputed from all earlier answers at every question, so it grows with the square of the question count), 230 GB-s of duration and 480 Worker requests. With the shipped coefficients D1 rows written is the first daily limit to run out (about 21 such games a day), then Durable Object rows written (about 36). These are model outputs checked only against the local test; they are not Cloudflare measurements.

## 10. Implementation plan (phases and exit criteria)

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 1 | Repo, tooling, strict TS, wrangler template, limits config, docs skeleton | `npm run build`, lint and typecheck pass; empty Worker deploys to a scratch Free account |
| 2 | D1 migrations/seed, admin auth, sessions, rate limiter | Hashing CPU measured on Free; auth tests pass; setup-token flow works |
| 3 | Admin Studio: quizzes, editor (dnd), templates, branding, settings, media, import/export | Functional tests for CRUD and uploads pass |
| 4 | GameRoom DO, protocol, lifecycle, scoring, reconnect, hibernation | Unit + WS integration tests; hibernation recovery test passes |
| 5 | Player, Host, Projector, Results UIs (uk/en) | Manual run on phone + projector; Playwright smoke tests |
| 6 | Usage monitor, calculator, alerts, safe mode | Quota tests (daily/monthly/threshold/exhaustion) pass |
| 7 | Installer, all 5 actions, health checks | Clean install, re-install, repair and update on a fresh Free account |
| 8 | Load tests 1/30/60/100/120, security checks, docs, release | Recorded results: no lost answers, no duplicate scoring, correct ranking |

---

## 11. Decisions (answered)

1. **R2:** no R2. Media stored in D1.
2. **Installer UI:** local web wizard.
3. **Password hashing:** reduced iterations if PBKDF2 exceeds 10 ms CPU.
4. **Roles:** `owner` / `admin` / `editor` confirmed.
5. **Delivery:** source archive with an administrator guide and Cloudflare rollout instructions.
