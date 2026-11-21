# Decision log

Architecture-changing decisions, with the reason, recorded before implementation (rule 17 of the master prompt).

## D-001: No R2; media stored in D1
**Date:** 2026-11-20. **Decided by:** product owner.
**Why:** R2 may require a payment method on the account even for free-tier usage, which conflicts with "$0, free plan only, no mandatory subscriptions". D1 bills by rows, not bytes.
**Consequences:**
- `uploaded_media.data` is a BLOB in D1. Images are resized and compressed to WebP in the browser before upload; the Worker enforces a hard size limit (target ≤ 200 KB) and verifies the MIME type by magic bytes.
- D1 free storage is 5 GB per account but only **500 MB per database**, so media volume is capped; the Admin Studio will show the figure.
- Media is served by the Worker with immutable cache headers (each hit is a Worker request; keep cover images small).
- The master prompt's R2 items (installer step 9, R2 quota rows, R2 deliverable) are intentionally dropped. R2 limits stay out of the usage monitor (`config/cloudflare-limits.json` → `notUsed`).

## D-002: Installer is a local web wizard
**Why:** non-technical administrators; the master prompt requires a guided installation experience. A Node HTTP server bound to `127.0.0.1` serves one HTML page; progress is streamed with Server-Sent Events.
**Protections:** one-time random token in the URL, Host allow-list (DNS rebinding), Origin check on POST, body size cap, one job at a time, no secrets in logs (redaction), no inline user data in HTML (text nodes only).
**Note:** `install.sh` / `install.ps1` only check Node.js and launch the same Node engine, as required.

## D-003: Password hashing uses PBKDF2 with a lowered iteration count if needed
**Why:** the Free plan allows 10 ms CPU per Worker request. PBKDF2-SHA-256 at OWASP-recommended iteration counts may exceed that.
**Decision:** use Web Crypto PBKDF2-SHA-256 with the highest iteration count that measures safely under the limit **on a real Free account**, stored per-hash in `administrators.kdf_params` so it can be raised later without breaking old hashes. **Phase 2 outcome:** the installer measures the account itself. It calls a setup-token-protected endpoint with 5 trials per step on the ladder 5k…100k iterations, takes the highest step where all trials succeed and stores 60 % of it (rounded down to 1,000, minimum 5,000) as the `KDF_ITERATIONS` secret. 100,000 is the hard ceiling of the Workers runtime. The result on a real Free account is **not yet measured**; the first real run reports it in the installer log and in `.gart/state.json`. Compensating controls: login rate limiting per IP and per account, long-password policy, uniform error messages, session tokens stored hashed.
**Trade-off accepted:** weaker resistance to offline cracking if the database is leaked.

## D-004: Roles
`owner` (everything, including managing admins and uninstall-level settings), `admin` (all content and games, manages editors), `editor` (quizzes and templates, no user management, no settings).

## D-005: Deliverable format
The project is delivered as a source archive built in phases. Each phase has exit criteria (docs/ARCHITECTURE.md §10). Phase 1 is delivered first.

## D-006: Live-game route is not exposed until phase 4 (superseded by D-018)
`/ws/:pin` is deliberately not routed in phase 1. Rooms must only be reachable for PINs registered by an authenticated host; otherwise anyone could create Durable Objects and consume quota.

## D-007: Durable Object SQL rows read limit
Cloudflare documents 5M/day on one page and 50M/day on another. The conservative 5M is used in `config/cloudflare-limits.json`.

## D-008: Backups exclude `admin_sessions`
Backups must not contain session tokens (master prompt §13). Password hashes are included because restoring administrators requires them; backups are therefore confidential files.

## D-009: Sessions
Opaque 256-bit random token in an HttpOnly, SameSite=Strict cookie (`__Host-` prefix on HTTPS). Only the SHA-256 hash is stored in D1. Idle timeout 8 h (sliding), absolute 14 days; `last_seen` is written back at most every 15 min to save D1 writes. Disabling an administrator or changing a password revokes sessions.

## D-010: Rate limiting in a Durable Object
Login, setup and calibration limits live in one global `RateLimiter` Durable Object (SQLite, fixed windows) because Workers have no shared memory. Cost is a few Durable Object requests per sign-in; accepted for an admin-only surface.

## D-011: First administrator is created only by the installer
A one-time `SETUP_TOKEN` secret gates `/api/setup`; the insert is atomic (`INSERT … WHERE NOT EXISTS`), so concurrent requests produce exactly one owner. After any administrator exists the endpoint is closed permanently. No e-mail-based password reset is built (no mail provider on the Free plan); mitigation is the guidance to keep two owners.

## D-012: Images are compressed in the browser and stored in D1
No R2 (D-001). The browser re-encodes every picture to WebP (JPEG fallback) under 200 KB before upload, so D1 rows stay small, uploads stay under the Worker body limits and the per-day D1 read budget is protected by immutable HTTP caching. The server never trusts the declared type: it checks magic bytes and refuses SVG, which can carry script. Reads are public because players are not signed in; ids are random UUIDs and responses carry a sandbox CSP.

## D-013: Question-level API instead of one large quiz document
Each question is saved on its own (`POST/PUT/DELETE /api/quizzes/:id/questions`) in a single D1 batch, keeping requests under the 16 KB JSON cap, limiting rows written per edit (D1 free tier: 100,000 writes per day) and avoiding lost updates when two people edit different questions.

## D-014: Branding is public data
Colours, name and logo id are readable without signing in (the sign-in page and player screens need them). Only valid `#rrggbb` colours are accepted, so branding cannot inject CSS.

## D-015: Answers are one row each; scores are derived (phase 4)
`answers` is `WITHOUT ROWID` with primary key (question, player): one row written per answer and a second answer is refused by the key, so no read-before-write is needed. Scores are never stored per player; totals come from one grouped query per question close and are cached in memory. Rows written is the binding Free limit, so this is the cheapest correct layout.

## D-016: One alarm, many timers (phase 4)
A Durable Object has a single alarm. Question close, auto-advance, persistence, cleanup and expiry are kept in `core.alarms` and the nearest is armed. This survives hibernation and restarts, which `setTimeout` does not.

## D-017: D1 receives results once, at the end (phase 4)
During play nothing is written to D1. At the end the room sends participants and per-answer results with `json_each` bulk inserts in chunks of 500 rows (about 8 statements, under the Free limit of 50 queries per invocation).

## D-018: WebSocket access (phase 4)
Players join with a PIN and receive a secret token (only its SHA-256 is stored). The host and projector use HMAC-signed, single-use tickets valid 60 s, bound to the game and role. `/ws/:pin` checks Origin, a per-IP limit (600 per 10 min, sized for an office behind one address) and that the game exists in D1 before a Durable Object is touched, so unknown PINs cost no quota. Replaces D-006.

## D-019: Projector uses an administrator session (phase 5)
The projector page requests a screen ticket like the host does, so it needs a signed-in browser. A separate "show code" flow for unattended displays was left out to keep one authentication path.

## D-020: Client keeps one state object fed by snapshot and events (phase 5)
Every (re)connection receives a full snapshot; later events change it through a pure reducer (`apps/web/src/game/reducer.ts`, unit-tested). Countdowns are computed from the server clock offset, not from the phone's clock, and freeze on pause.

## D-021: Measured usage is written once per game (phase 6)
Counting every request in D1 would spend the very quota being measured. Room counters are kept in memory and added to the results batch at the end of a game (one statement). Consequences: a game that is cancelled before it ends, or a room evicted mid-game, undercounts. HTTP and CPU are not counted at all. The dashboard says "lower bound" and asks for official figures.

## D-022: Alerts use the larger of measured and official (phase 6)
Measured figures undercount and official ones are typed by hand and can be stale, so the safer one is used. They are stored in separate tables so an estimate can never be mistaken for an official reading.

## D-023: Warn, never block for good (phase 6)
A game that the model says will push a resource to 75 % or more needs one explicit confirmation (and may use safe mode). There is no automatic refusal, because the model is conservative and the person running the event knows more than it does.

## D-024: Updates come from GitHub through Cloudflare Workers Builds (0.6.1)
Chosen over GitHub Actions with an API token (a Cloudflare credential would be stored in GitHub) and over manual local updates (needs a computer with Node every time). The production branch is `release`, not `main`: pushing code and releasing it are two separate commands. GitHub Actions only runs the tests. `apps/worker/wrangler.jsonc` (ids, no secrets) is committed to the private repository because the build needs it; the publishing step never overwrites it. Rollback is Cloudflare's version rollback; the database is not rolled back, so migrations must be additive.

## D-025: Rename to Gart (0.6.1)
Display name, package scope, headers and storage keys changed. Names that already exist on Cloudflare (Worker, D1 database) are not renamed: the installer state keeps them. The old state folder `.quizlab` is adopted as `.gart`.

## D-026: Sound and animation only on host and projector; music generated in the browser (planned for 0.9.0)
Participant screens act as remote controls, so they get neither. Background music is original and synthesised with Web Audio instead of shipped as audio files: no licensing risk, no storage in D1, no bandwidth, loops without gaps. Trade-off: synthesised timbres are simpler than recorded instruments; revisit only if the result is judged too thin.

## D-027: Web installer and self-updating releases instead of a local wizard (0.8.1, 0.8.2)
The administrator has only a Cloudflare account. Gart is open source; releases are signed packages on the public GitHub Release page. A tiny bootstrap Worker in the administrator's own account serves the installer and relays calls to the Cloudflare API, so no third-party server ever sees the API token and browser CORS rules do not matter. The same deploy engine installs and updates. Trade-offs: needs an API token with Workers, D1 and zone permissions (stored encrypted for updates); package signing protects against tampering but not against theft of the maintainer's signing key; API behaviour (secrets, Durable Object migrations, domains) can only be proven on a real account, so it is first tried on a separate test copy.

## D-028: In-app updates run in a Durable Object with an encrypted token (0.8.2)
The Updates tab needs to run the deploy engine inside the Worker. A normal request has 10 ms of CPU on the Free plan, which verifying a signature and hashing a 1.5 MB package exceeds; a Durable Object invocation has 30 s, so a separate `Updater` object (migration `v3`) does the work from an alarm and keeps its progress in its own storage (no D1 writes). It also keeps the Cloudflare token, AES-GCM encrypted with a key derived from `SESSION_SECRET`: the owner supplies the token once, can delete it, and it is never returned. Alternatives rejected: a GitHub Action holding a Cloudflare token (a Cloudflare credential would sit in GitHub), a Cloudflare OAuth flow (needs a registered app and a server). Release list comes from the GitHub API and is cached (anonymous requests are limited per address); the package itself is always verified, so the unsigned release notes shown on screen cannot cause an installation. Rolling back reinstalls an earlier signed package; database changes are not undone because migrations only add, and anything that removes data is flagged and needs confirmation. Restoring is limited to 0.8.2 and later because earlier packages lack the `Updater` storage layout. An update never touches the workers.dev or domain settings.

## D-029: QR from a small library, music synthesised from a score (0.9.0)
QR codes: one dependency (`qrcode-generator`, MIT, no sub-dependencies, ~20 KB) loaded in its own chunk only where a QR is shown. Writing our own Reed-Solomon and mask selection would be riskier than reviewing a small library; a test decodes the rendered code with an independent decoder (`jsqr`, test-only) and compares it with the join address. Music: `apps/web/src/audio/music.ts` is pure data (melodies as scale degrees, chord roots, layers per mood), `engine.ts` turns it into sound with Web Audio oscillators, filters and noise. No audio files means no licensing questions, no storage and no download; the engine is a separate chunk loaded on the first click of "Enable sound", so participants' phones never fetch it. The score is original and written in the D Ukrainian Dorian scale (raised fourth); tests keep every note in the scale and check bar lengths, moods and that the three variants differ. Whether it is "recognisable" is a matter of ear and is decided from the administrator's feedback on the listening page. Host and projector have separate sound switches (stored per browser) because both are often open on one computer.

