# Gart

Self-hosted live quiz platform for a company, a school or a club, running entirely on the **Cloudflare Free plan** ($0 infrastructure). Players join from their phones with a PIN, the host runs the game and a projector screen shows questions and results. Open source, AGPL-3.0.

**You only need a Cloudflare account and a browser.** Install it from the [install page](https://crzn.github.io/gart/) (no software on your computer), update it later from the admin panel. The interface is Ukrainian by default, English is included.

**Status: 0.12.0. All planned phases are built, plus install from the browser (0.8.1), updates from the admin panel (0.8.2) and presentation polish for the host screen and projector (0.9.0): QR code to join, original music and sound effects, animation, and import of quizzes from gart.json files, made by an AI assistant (0.10.0).** A full game with 120 simulated players passes locally; it has not been run on real Cloudflare yet, and neither has the browser installer, so 120 concurrent players and the installer are not yet confirmed on the real service. See [CHANGELOG.md](CHANGELOG.md) for exactly what works today.

## What works in this build

- **Presentation (0.9.0), host screen and projector only:** QR code to join, original background music and effects made in the browser (three variants, listening page at `/listen`), animations (respecting "reduce motion"). Participants' phones stay silent and plain.
- **Updates from the admin panel** (0.8.2): the owner sees new releases, what changed, and updates or goes back to an earlier release with a button; packages are signed and verified before anything is installed.
- **Browser installer** (0.8.1) and a local wizard (Windows, macOS, Linux): sign in with Cloudflare OAuth, create/reuse the D1 database, apply migrations, generate secrets, build, deploy, health-check. Actions: Install, Update, Repair, Backup, Uninstall.
- Cloudflare Worker (Hono) serving the web app via Workers Static Assets, with `/api/health`, a WebSocket/Durable Object round-trip check, and setup status.
- Complete D1 schema and seed data (13 tables, 6 quiz templates).
- Shared, tested game rules: deterministic scoring, game state machine, nickname rules, PIN generation, ranking, settings schema, WebSocket protocol validation.
- Responsive Ukrainian/English web shell (React, Tailwind).
- **Administrator accounts (phase 2):** first owner created by the installer, sign-in/sign-out, roles (owner/admin/editor), password change, session list and revocation, administrator management, login rate limiting, CSRF protection, audit log, automatic tuning of password hashing to the account's CPU limit.
- **Quiz editor and branding (phase 3):** templates, questions with images, game settings, statuses, duplication, runtime branding (colours, logo, background, messages).

## What is not built yet

quiz import/export; unused-image cleanup; Cloudflare Analytics API integration.

## Install

**From the browser, nothing to install on your computer:** follow the install page (GitHub Pages of this repository, `https://<owner>.github.io/<repo>/`) or section 2b of the **[Administrator Guide](docs/ADMIN-GUIDE.en.md)** ([українською](docs/ADMIN-GUIDE.uk.md)). You need a free Cloudflare account and an API token.

Advanced, with Node.js 22.12+ on your computer (local wizard):

```
bash install.sh                                          # macOS / Linux
powershell -ExecutionPolicy Bypass -File .\install.ps1   # Windows
```

## Develop

```
npm install
npm run check          # typecheck + tests + build
npm run dev:worker     # Worker on :8787 (local D1; run `npm run db:migrate:local -w apps/worker` once)
npm run dev:web        # Vite on :5173, proxies /api to the Worker
```

Layout: `apps/web` (React), `apps/worker` (Hono + Durable Object), `packages/shared` (pure logic used by both), `migrations/`, `installer/`, `config/cloudflare-limits.json` (the only place quotas live), `docs/`.

## Documents

[Architecture and plan](docs/ARCHITECTURE.md) · [Decisions](docs/DECISIONS.md) · [Security](docs/SECURITY.md) · [Admin guide EN](docs/ADMIN-GUIDE.en.md) · [UK](docs/ADMIN-GUIDE.uk.md)

## Contributing and security

[CONTRIBUTING.md](CONTRIBUTING.md) explains how to help; vulnerabilities are reported privately, see [SECURITY.md](SECURITY.md).

## License

GNU AGPL-3.0-only. See [LICENSE](LICENSE).
