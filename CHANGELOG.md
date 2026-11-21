# Changelog

All notable changes. Format based on Keep a Changelog; versions follow SemVer.

## [0.8.3] - 2026-11-21

### Fixed
- The Updates tab could not read the release list on a real installation: GitHub limits anonymous API requests per address and Cloudflare's addresses are shared. The check now falls back to the public releases feed (no such limit), and when both fail the tab shows the reason.

## [0.8.2] - 2026-11-21

### Added
- **Updates tab** (owner only): checks the public GitHub releases, shows what is new, updates with one button and can install an earlier release. The work runs in a new Durable Object (`Updater`, migration `v3`) that downloads the release package, verifies its signature and file hashes, and then uses the same deploy engine as the installer. Progress and the Time Travel recovery point are shown; a migration that removes data needs a separate confirmation.
- The Cloudflare token for updates is stored encrypted (AES-GCM, key derived from the installation's `SESSION_SECRET`), can be deleted at any time, and is never returned by the API.
- The deploy script builds the Worker config from the build variables `GART_WORKER_NAME`, `GART_D1_NAME`, `GART_D1_ID`; `apps/worker/wrangler.jsonc` is git-ignored, so the repository carries nothing installation-specific.
- Source-code link in the footer (AGPL-3.0 section 13), CONTRIBUTING, vulnerability reporting policy, README for outsiders.

### Changed
- An update through the engine no longer touches the workers.dev address setting.
- Removed the leftover "editor and live games will appear in later phases" note from the system status page.

### Notes
- A copy installed before 0.8.2 does not have the Updates tab yet: update it once with the installer or the GitHub build, after that it can update itself.
- Restoring an earlier release works for 0.8.2 and later (earlier ones lack the Updater storage layout).

## [0.8.1] - 2026-11-21: install from the browser

### Added
- **Web installer.** Install Gart with only a browser and a Cloudflare account: paste a short bootstrap Worker into the Cloudflare dashboard, open it, follow the wizard (token, account, company name, e-mail, optional own domain). See ADMIN-GUIDE section 2b.
- **Signed release packages** (`scripts/build-package.mjs`, GitHub workflow `release.yml` on version tags): one file with the bundled Worker, site files and migrations, signed with ECDSA P-256. The installer page is signed too.
- **Deploy engine** (`packages/deploy-engine`): talks to the Cloudflare API (D1, migrations, static assets, Worker upload with secrets and Durable Object migrations, workers.dev, custom domain). The same engine will power updates from the admin panel (0.8.2).
- **Bootstrap Worker** (`bootstrap/`, `scripts/make-bootstrap.mjs`) and **install microsite** for GitHub Pages (`site/`, workflow `site.yml`).
- **First-time setup page** `/setup` in the app (owner name, e-mail, password; the one-time token comes in the URL fragment).
- `scripts/generate-signing-key.mjs` (run once by the maintainer), `scripts/release-notes.mjs`; release check rejects a private signing key in the repository.
- `/api/health` can be read from other addresses (needed by the installer to see that the new site is up).

### Tests
- Engine against a fake Cloudflare API that runs the real migrations on SQLite and checks request shapes; package signing/tamper tests; whole-wizard browser test through the real bootstrap Worker (a tampered installer page is refused, the relay refuses foreign callers); setup page browser test.

### Not verified
- **The real Cloudflare API has not been used yet.** Call shapes were copied from wrangler's source, but secrets on update (`keep_bindings`), Durable Object migrations, multi-statement D1 queries, asset upload and custom domains must be tried on a real account (first on a separate test copy).
- No signing key exists yet: the maintainer must run `npm run signing-key`, store the private key as the GitHub secret `GART_SIGNING_KEY`, commit `config/release.json`, enable GitHub Pages (Source: GitHub Actions) and make the repository public before the first signed release.

## [0.8.0] - 2026-11-21: security checks and release package (phase 8, part 2)

### Added
- `tests/e2e/abuse.e2e.mjs`: hostile WebSocket clients (oversized, binary, malformed messages, message flood) are cut off or answered with errors, and an honest player can still join and stay connected meanwhile.
- `npm run release:package`: builds `gart-<version>.zip` (source only; runs the release checks first). The archive was unpacked into an empty folder and `npm ci` plus the full check (typecheck, 161 tests, build) passed there.
- Security review of the web app and API: no HTML injection points (`innerHTML` and similar are not used), parameterised SQL (dynamic parts only from fixed column lists), CSV export neutralises formula cells, session cookie is HttpOnly/SameSite=Strict/`__Host-` on HTTPS. Recorded in docs/SECURITY.md.

### Not verified
- Load test and abuse tests on real Cloudflare.
- The session cookie name still starts with `ql_` (from the old project name); changing it would sign everyone out, so it is kept.

## [0.7.0] - 2026-11-21: confirmed Workers Builds release; load test; web security headers (phases 7-8, part 1)

### Added
- `tests/load/load-test.mjs`: a full game with up to 120 simulated players against any Gart address, with a dry-run mode, a JSON report (join and answer timings, disconnects, errors) and automatic cleanup. `tests/e2e/load-smoke.e2e.mjs` proves the script locally (120 players, all answers acknowledged).
- Security headers for the web app (`apps/web/public/_headers`): CSP, anti-framing, nosniff, referrer and permissions policies.
- Admin guide section 5c (load test), uk and en. Security document: phase 8 table.

### Confirmed
- The first release through Cloudflare Workers Builds worked on a real account (Status tab showed 0.6.1) and a game ran normally afterwards.
- Phase 7 (installer) needed no new code: bootstrap scripts, authentication, provisioning, deployment, first administrator and health checks were delivered and checked on a real account in phases 1-3.

### Not verified
- The load test has not been run against real Cloudflare yet.
- Security review of the remaining areas, final documentation pass and the release package are still to do (phase 8, part 2).

## [0.6.1] - 2026-11-21: renamed to Gart; updates from GitHub

### Changed
- The project is now called **Gart** (packages `@gart/*`, headers, storage keys, installer defaults, archive names). Existing installations keep working: the installer adopts the old `.quizlab` state folder as `.gart`, and an already deployed Worker and database keep their names (Cloudflare cannot rename them in place).

### Added
- `npm run deploy:cloudflare`: applies database migrations, then deploys; stops before touching the code if a migration fails. Meant for Cloudflare Workers Builds.
- GitHub Actions workflow `ci.yml`: runs the tests on every push; needs no token and deploys nothing.
- `npm run release:check`: versions agree everywhere, CHANGELOG has the entry, no secrets or private files.
- A test that rejects migrations that destroy data (`DROP TABLE/COLUMN`, `RENAME`, `DELETE`) unless marked `allow-destructive:`.
- `.node-version` (22); `apps/worker/wrangler.jsonc` is no longer git-ignored so it can be committed to a private repository.
- Admin guide: automatic updates from GitHub, release and rollback.

### Not verified
- Confirmed on a real account: the first release through Cloudflare Workers Builds (branch `release`) built, applied migrations and deployed; the Status tab shows 0.6.1.
- Setup note: Workers Builds has a separate configuration for non-production branches (default command `npx wrangler preview`, which fails with this project). Turn off "Builds for Preview branches" so only `release` builds.
- Still not checked: that a game runs normally after an automatic deploy (secrets preserved).

## [0.6.0] - 2026-11-20: Usage Monitor (phase 6)

### Added
- Usage tab (administrators and owner): today's position per Cloudflare resource with three clearly separated kinds of numbers (estimate, measured by the app, official entered by hand), alerts at 50/75/90/100 % (first three adjustable), 14-day history.
- Calculator: per game, busiest day, month, % of quota, worst case, games that still fit, bottleneck resource, storage over the retention period.
- Application-level counters in `usage_metrics`: games, players, answers, questions, WebSocket connections and messages, Durable Object and D1 rows, game seconds, uploads. Saved once per game inside the results batch, so counting costs 1 extra statement.
- Manual reconciliation with the Cloudflare dashboard (`usage_official`, migration 0004); no API token.
- Pre-game warning with the projected effect of the game and a safe mode (60 participants, sound off). Nothing is blocked for good, and no paid feature is ever switched on.
- Model coefficients in `config/cloudflare-limits.json`; D1 database storage cap (500 MB) added; unit tests that keep the model above the local measurements, and API and browser end-to-end tests.

### Not yet
- Cloudflare Analytics API integration (optional in the specification) is not built; manual figures are used instead.
- HTTP requests and CPU time are not measured by the app; read them from the Cloudflare dashboard.
- The model is checked only against local measurements, not a real account.

## [0.5.0] - 2026-11-20: live game screens (phase 5)

### Added
- Player screens (phone): join with PIN, nickname and avatar; countdown, answer buttons (colour plus shape), result with points and rank, leaderboard, final podium. Reconnects automatically and resumes the same player after a refresh.
- Host screen: PIN and join address, lobby with remove-player buttons, start, close question, pause/resume, leaderboard, next/finish, end early, cancel.
- Projector screen (`/screen/:id`): large, read-only, no menu.
- Quizzes tab: "Start game". New Games tab: list, reopen an unfinished game, results table, per-question statistics, CSV export (formula-safe, Latin file name).
- Unit tests for the client state machine and CSV helpers; browser end-to-end test with host, projector and phone-sized players.

### Not yet
- Sound effects, QR code for joining, animations between screens; Usage Monitor (phase 6).
- The projector page needs a signed-in administrator session.
- Screens were checked in headless Chromium at phone and 1920x1080 sizes, not on real devices or a real projector.

## [0.4.0] - 2026-11-20: live quiz engine (phase 4, server side)

### Added
- One Durable Object per game: lobby, countdown, questions with server-side timing, pause/resume, kick, reconnect, early end, leaderboard, final results; scoring with speed bonus and tie-break.
- `/ws/:pin` with Origin check, per-IP limit and a D1 check; host/projector tickets; player tokens.
- Game API: create (max 3 active), list, details, ticket, cancel, results, usage counters.
- Setting "Close the question once everyone has answered" (on by default).
- Results saved to D1 once at the end; migration 0003 drops two redundant indexes.
- End-to-end game test over real WebSockets (30 and 120 players, restart recovery) and unit tests for tickets and shuffling.

### Not yet
- No player, host or projector screens (phase 5): the engine is exercised by tests, not by people.
- Not measured on a real Cloudflare account: CPU per invocation, Cloudflare's own rows-written count, D1 bulk insert, hibernation.

## [0.3.1] - 2026-11-20: first real-use feedback on phase 3

Reported by the owner while testing 0.3.0 on a real Cloudflare account, where image upload (JPEG), quizzes, duplication and branding all worked.

### Changed
- Drop-down lists now use a dark scheme (they were rendered with a light background and white text on Windows).
- Quiz templates have Ukrainian and English names that state their main difference, a plain description, and, under the chosen template, a list of the exact settings it applies (generated from the real settings). A note says everything can be changed afterwards.
- Maximum questions per quiz lowered from 100 to 50.
- Hints under Category and Description; clearer names for the two question types.

### Decided (no change)
- Questions keep exactly one correct answer; "multiple correct answers" will not be added.

### Verified
- Typecheck, unit and end-to-end suites (API and browser). The dark list colours are a styling change checked in a screenshot only for the closed control: native option lists are drawn by the browser.

## [0.3.0] - 2026-11-20: Phase 3, quiz editor and branding

### Added
- Quiz management API and UI: create (optionally from one of six system templates), edit details (title, description, category, tags, difficulty, cover), game settings, status (draft, active, archived), duplicate, delete (editors only their own).
- Questions: single-answer (2 to 4 options) and true/false, optional image, time limit, points, explanation; add, edit, delete, reorder. Server-side validation (exactly one correct answer, no duplicate options, limits: 100 questions per quiz, 200 quizzes).
- Images stored in D1: type detected by magic bytes (PNG, JPEG, WebP; SVG refused), 200 KB cap, de-duplication by SHA-256, 150 MB total cap, public cacheable reads with ETag and a sandboxing CSP. The browser compresses to WebP/JPEG before upload.
- Branding: company name, logo and position, four colours, background image, welcome and final messages; stored in D1, publicly readable, applied live through CSS variables; contrast warning and preview.
- Audit entries for quiz creation, status change, duplication, deletion and branding changes.

### Fixed
- **Request loop in the Administrators tab (present in 0.2.0).** The translation function was recreated on every render, so the tab re-requested `/api/admins` continuously while open. This burned Worker requests (the free plan allows 100,000 per day) and reset form state. `t` is now a stable function, and automated tests assert that idle tabs make no API calls.

### Verified locally
- 60 API end-to-end checks for content (access control, validation, ordering, activation rules, images, branding, CSS injection refused), browser end-to-end of the editor and branding, earlier suites unchanged.

### Not verified
- Image upload and D1 BLOB behaviour on real Cloudflare (local D1 only), including real image sizes from phones.
- Import/export of quizzes and unused-image cleanup are not built yet.

## [0.2.0] - 2026-11-20: Phase 2, administrator accounts

### Added
- First administrator created by the installer wizard (e-mail, name, password typed twice). A one-time `SETUP_TOKEN` secret protects the endpoint, which closes permanently once an administrator exists.
- Automatic calibration of password hashing against the account's real CPU limit (ladder 5,000 to 100,000 iterations, 5 trials per step, 60 % safety margin), stored as the `KDF_ITERATIONS` secret.
- Sign-in, sign-out, session list and revocation, password change, administrator management (create, change role, disable or enable), roles owner/admin/editor.
- Login rate limiting (Durable Object), CSRF protection, audit log, 16 KB request cap.
- Web: login page, administration area with Status, My account and Administrators tabs (Ukrainian and English).
- Installer: "Create administrator" action when none exists yet.

### Changed
- `docs/ADMIN-GUIDE.*`, `docs/SECURITY.md`, `docs/DECISIONS.md` (D-003 outcome, D-009 to D-011).

### Verified locally
- Unit tests, 53 API end-to-end checks (setup race, CSRF, enumeration safety, lockout, role rules, session revocation), installer end-to-end against a local Worker with a fake Wrangler (password and token never appear in logs or state), browser end-to-end of the admin UI.

### Not verified
- The installer's administrator step and the CPU calibration against a real Cloudflare account. Locally the runtime has no CPU limit, so every step passes; the real measurement happens on your first run.
- No password reset by e-mail (keep two owners).

## [0.1.1] - 2026-11-20: first real-install fixes

Found during the first real installation on a Cloudflare account (Windows, Node.js 26).

### Fixed
- Deployment could fail right after a successful upload with `This Worker does not exist on your account [code: 10007]`: Cloudflare had not yet registered the new Worker. The installer now waits and retries the deployment up to three times, and shows a specific hint if it still fails.
- The log no longer prints the full sign-in JSON (account details and permissions) and no longer shows the expected "Worker not found" error during the first-install secrets check; an explanatory line is logged instead.
- The "Prepare" button now shows progress and is disabled while dependencies install, instead of appearing unresponsive.

### Verified
- All 52 automated tests pass; retry pattern checked against the exact error text from the report.
- Not verified: the fix against a real Cloudflare account. Whether the cause is a timing delay on Cloudflare's side is the most likely reading of the log, not a proven one.

## [0.1.0] - 2026-11-20: Phase 1, platform foundation

### Added
- Monorepo: `apps/web` (React 19, Vite, Tailwind 4, Lucide), `apps/worker` (Hono, SQLite-backed Durable Object skeleton), `packages/shared`.
- Shared logic with tests: scoring (deterministic integer math), game state machine, nickname validation and duplicate key, PIN generation without modulo bias, ranking with ties, quiz settings schema, WebSocket client-message validation, avatar list.
- D1 migrations `0001_init.sql` (13 tables with keys, constraints, indexes) and `0002_seed.sql` (6 system templates, default settings), tested against SQLite.
- Worker endpoints: `/api/health`, `/api/health/ws`, `/api/setup/status`.
- Quotas file `config/cloudflare-limits.json` (verified 2026-11-20).
- Local web installer (uk/en) with Install, Update, Repair, Backup, Uninstall; launchers `install.sh` and `install.ps1`.
- Administrator guides (English, Ukrainian), architecture, decisions and security documents. AGPL-3.0 license.

### Verification performed in this build
- TypeScript strict typecheck on all three packages: pass.
- 52 automated tests: pass.
- Web production build: pass.
- Worker run locally on workerd with local D1: migrations applied, `/api/health` ok, SPA deep links served, API 404s, WebSocket round trip through the Durable Object ok.
- `wrangler deploy --dry-run` with a config rendered from the template: all bindings recognised.
- Installer server probed manually: missing token 403, wrong Host 403, wrong Origin 403, unknown action 400; job events and sign-in diagnostics streamed correctly.

### Not verified
- A real deployment to a Cloudflare account (no Cloudflare login was available during development). The first real install is the open acceptance test for the installer; report any failing step with its log.
- Free-account CPU timing (needed for password hashing in phase 2).

### Not yet built
Administrator accounts and sign-in, quiz editor, branding editor, live game engine and UIs, usage monitor and calculator, import/export, load tests (phases 2–8). The first-administrator step of the installer arrives with phase 2.
