# Security notes (phase 3)

This document grows with each phase. It lists what is implemented **now** and what is still planned, so nothing is assumed to be protected that is not.

## Implemented in phase 1

| Area | Control |
|---|---|
| Installer | Local-only server (127.0.0.1), one-time token, Host and Origin checks, request body cap, single job at a time. Verified by manual probing (see CHANGELOG). |
| Cloudflare sign-in | Wrangler's official OAuth flow. No API token, Global API Key or password is requested, stored or logged. |
| Secrets | `SESSION_SECRET` and `WS_TICKET_SECRET` are generated with a CSPRNG, written to a 0600 temporary file, uploaded with `wrangler deploy --secrets-file`, and the file is deleted afterwards. Existing secrets are never rotated by Update/Repair. Values are redacted from installer logs. |
| Repository | `wrangler.jsonc`, `.dev.vars`, `.gart/`, `backups/` are git-ignored. |
| Input handling | Install-time company name and colour are validated by allow-list before being placed in SQL; quotes are escaped. Tested against injection strings. |
| Worker | `/api/*` responses are `Cache-Control: no-store` with `nosniff`; errors never echo internals. |
| Live-game access | The `/ws/:pin` route does not exist yet, so rooms cannot be created anonymously. |
| Data model | Foreign keys, unique constraints (one answer per player per question, one nickname per game, one active game per PIN), CHECK constraints. Tested against a real SQLite engine. |
| Backups | `admin_sessions` is excluded. |

## Implemented in phase 2

| Area | Control |
|---|---|
| Passwords | PBKDF2-SHA-256 with a per-hash random salt; iteration count stored with each hash and tuned to the account's CPU limit at install time. Policy: 12–128 characters, common-password and e-mail-part checks. |
| Sessions | 256-bit random opaque token; only its SHA-256 is stored. HttpOnly, SameSite=Strict cookie (`__Host-` on HTTPS). Idle 8 h, absolute 14 days. Logout, password change and disabling revoke sessions. |
| Sign-in | Same `invalid_credentials` answer for unknown, disabled and wrong-password cases, with a dummy hash computed for unknown accounts. |
| Rate limits | Per IP and per account for sign-in; per IP for setup and calibration (Durable Object, SQLite). |
| CSRF | Custom header required on all state-changing calls, plus Origin and `Sec-Fetch-Site` checks. |
| First owner | One-time `SETUP_TOKEN`; atomic insert; endpoint closed once any administrator exists. |
| Roles | owner/admin/editor enforced on the server; the last active owner cannot be demoted or disabled; no self-demotion. |
| Audit log | Sign-ins, failures, role and password changes are recorded without secrets. |
| Request size | 16 KB cap on API bodies. |

## Implemented in phase 3

| Area | Control |
|---|---|
| Uploads | Magic-byte type check (PNG, JPEG, WebP only; SVG and anything else refused with 415), 200 KB cap enforced before the body is read into memory and again after, 150 MB total cap, de-duplication by SHA-256. |
| Image delivery | `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, immutable caching with ETag. Ids are validated against a strict pattern before any query. |
| Content API | Every route needs a session; Zod validation of all inputs; exactly-one-correct-answer and size limits enforced on the server; editors may delete only their own quizzes. |
| Branding | Administrators and owners only for writes; colours restricted to `#rrggbb`, so no CSS can be injected. |
| Front end | React escapes all quiz text; no `dangerouslySetInnerHTML` anywhere. |

## Implemented in phase 4

| Area | Control |
|---|---|
| Connection gate | `/ws/:pin` requires a same-origin `Origin`, passes a per-IP limit and a D1 check that the game is live before any room is touched. |
| Host and projector | HMAC-signed tickets, 60 s, single use (nonce burned in the room), bound to game and role; a projector ticket cannot control the game; a second host replaces the first. |
| Players | Secret token per player, only its hash is stored; kicked players cannot return; nicknames validated (length, characters, uniqueness ignoring case); avatars from a fixed list. |
| Answers | Server clock only; one answer per player per question by primary key; rejected before start, after close and while paused; the correct answer is never sent before the question closes. |
| Abuse | Per-socket token bucket, repeated violations close the socket; unidentified sockets are dropped after 30 s; socket cap per room; at most 3 active games. |

## Implemented in phase 8

| Area | Measure |
|---|---|
| Web app headers | `apps/web/public/_headers`: Content-Security-Policy (own scripts only, no framing, no plugins), X-Frame-Options DENY, nosniff, no referrer, Permissions-Policy (camera, microphone, location off), COOP same-origin. Checked in a real browser: no CSP violations on the main pages. |
| Dependencies | `npm audit`: 0 known vulnerabilities at release time. Run it again before each release. |
| Review | Web: no `innerHTML`/`eval`; SQL is parameterised (dynamic parts come from fixed column lists); CSV cells starting with `= + - @` are neutralised; branding colours and logos are validated; SVG and disguised scripts are rejected on upload; session cookie is HttpOnly, SameSite=Strict, `__Host-` prefixed on HTTPS. |
| Abuse | `tests/e2e/abuse.e2e.mjs`: oversized (closed 1009), binary (1003), malformed (error answers), flood (rate_limited, then closed 1008); other players are unaffected. |
| Load | `tests/load/load-test.mjs` runs a full game with up to 120 simulated players against a real deployment; passes locally with 120 players. Not yet run against real Cloudflare. |

## Implemented in 0.8.1 (web installer)

| Area | Measure |
|---|---|
| Package integrity | Release packages and the installer page are signed (ECDSA P-256); the bootstrap Worker refuses an installer page with a bad signature, the installer refuses a package with a bad signature or a changed file. The private key exists only as the GitHub secret `GART_SIGNING_KEY` (and the maintainer's backup). |
| Token handling | The Cloudflare API token is typed on a page served by the administrator's own Worker and sent only to api.cloudflare.com through a relay limited to `/accounts`, `/zones`, `/user/tokens/verify` and to calls from that page. It is not stored by the installer. |
| Owner password | Typed on the new site's own `/setup` page; the one-time token travels in the URL fragment (not sent to any server) and the endpoint closes forever after the first owner exists. |
| Release hygiene | `prepare-release` also rejects a private signing key (JWK) anywhere in the repository. |

Known limits: trust in updates equals trust in the maintainer's signing key (if it is stolen, a malicious package can be signed). Rotating the key means changing `config/release.json` and re-pasting the bootstrap script; installed copies keep the old key until a transition release (planned with updates in 0.8.2).

## Planned (not yet implemented)

Optional Turnstile; abuse tests and a load run against a real deployment.

## Known limits

- A running game is a Durable Object: if its state is lost, results not yet written to D1 are lost. The room writes results once, at the end.
- Quiz images are readable by anyone who knows the image id (needed so players can see them). Do not upload confidential pictures.
- Unused images are not cleaned up yet.
- No e-mail password reset exists. Keep at least two owners.
- The CPU headroom for password hashing is measured once at install time; if Cloudflare changes the limit, re-measuring from the wizard is not supported yet (planned).
- Backup SQL files contain password hashes and quiz data. Store them as confidential.
- The installer cannot verify account plan details by lookup; it relies on resource creation succeeding, so an unavailable resource is reported as an error rather than pre-checked.
- Anyone who can run commands on the computer used for installation and is signed in to Wrangler can administer the Cloudflare resources. Run `npx wrangler logout` when finished on a shared computer.

## In-app updates (0.8.2)

| Risk | Protection |
|---|---|
| Someone gets the Cloudflare token kept for updates | Stored only inside the `Updater` Durable Object, encrypted with AES-GCM (key derived from the installation's `SESSION_SECRET`, fresh random IV). Never returned by any API. The owner can delete it at any time. A test scans the stored data for the plain token. |
| A non-owner starts an update | Every updates route requires the **owner** role; sign-in, CSRF header and rate limits apply. Connecting, disconnecting and starting an update are written to the audit log. |
| A tampered or fake release | Nothing is installed before the ECDSA signature and every file hash are verified with the public key built into the application. The version inside the signed manifest must equal the requested release. |
| A release that removes data | Migrations are flagged when they contain `DROP`, `DELETE`, renames and the like; the update stops and asks for explicit confirmation. A D1 Time Travel recovery point is recorded and shown before migrations run. |
| Rollback to a version that does not match the stored layout | Refused when the installed Durable Object migration tag is unknown to the older package. |
| Compromised signing key | Anyone holding the signing key can publish a package that every installation accepts. Keep the key only in the repository secret and in a password manager; rotating it means shipping a new application version through the installer. |
| Test-only variables (`RELEASE_*`, `CF_API_BASE`) | Never set by the installer or the update. Whoever can set variables on the Worker already controls it. |

## Reporting

Report vulnerabilities privately; see [SECURITY.md](../SECURITY.md) in the repository root.
