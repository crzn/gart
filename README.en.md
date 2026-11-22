# 🎯 Gart

**Live quizzes for your team, school or club. Self-hosted on the free Cloudflare plan: $0 for infrastructure.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Cloudflare](https://img.shields.io/badge/runs%20on-Cloudflare%20Free-F38020.svg)](https://www.cloudflare.com/plans/)
[![React](https://img.shields.io/badge/web-React%20%2B%20Tailwind-61DAFB.svg)](apps/web)
[![Hono](https://img.shields.io/badge/API-Hono%20Worker-E36002.svg)](apps/worker)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

🌐 **Languages:** [Українська](README.md) · English

> **Know. Act. Win!** 🏆

Players join from their phones with a PIN or QR code, the host runs the game, and the projector shows questions and results. All you need is a Cloudflare account and a browser. The interface is Ukrainian by default, with English included. 🇺🇦

**Status: 0.14.0.** A full game with 120 simulated players runs locally. A real load test on Cloudflare is still ahead, so 120 simultaneous players on the live service are not yet confirmed. See [CHANGELOG.md](CHANGELOG.md) for what works today.

---

## ✨ Features

- 📱 **Join from a phone**: PIN or QR code, nickname and avatar. No accounts or apps for players.
- 🖥️ **Projector screen**: big question, options, answer chart, leaderboard and podium; everything scales to the screen, no animations.
- 🎛️ **Host console**: start, pause, close a question, leaderboard, finish; buttons in a bottom bar within reach.
- 🎵 **Built-in music and effects**: synthesized in the browser (no audio files), off until someone switches it on. The host screen, the projector and each player's phone have their own switch; a `/listen` page previews the music.
- 🧠 **Quiz editor**: templates, questions with images, game settings (time, points, speed bonus), cover and description.
- 🤖 **AI-made quizzes**: upload up to 5 `gart.json` files at once; a template with comments for AI downloads in one click.
- 🎨 **Branding**: logo, company name, slogan, colors, background, welcome and final messages.
- 👥 **Roles**: owner, admin, editor; audit log, sessions, login rate limiting.
- 📊 **Usage monitor**: how much of the free Cloudflare limits is used today and what the next game will cost.
- 🔄 **One-click updates**: signed packages, signature verified before install, rollback to the previous release.
- 🧰 **Browser installer**: nothing to install on your computer; a local wizard for Windows, macOS and Linux is also available.
- 🔒 **Privacy**: `/privacy` page, automatic result cleanup by retention period, one-click game deletion.

## 🏗️ Architecture

A TypeScript monorepo. The web app (React) is served through Workers Static Assets, the API runs on a single Cloudflare Worker (Hono). Each game lives in a Durable Object with SQLite and WebSocket, while long-lived data (quizzes, results, images) is stored in D1. Pure game logic (scoring, state machine, nickname rules, leaderboard, protocol) lives in `packages/shared` and is tested separately.

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## 🏠 Install in minutes

**From the browser, installing nothing:** open the [installer page](https://crzn.github.io/gart/) and follow the steps. You need a free Cloudflare account and an API token.

```
bash install.sh                                          # macOS / Linux
powershell -ExecutionPolicy Bypass -File .\install.ps1   # Windows
```

The second option needs Node.js 22.12+ on your computer. Full guide: [Administrator Guide](docs/ADMIN-GUIDE.en.md) · [Українською](docs/ADMIN-GUIDE.uk.md).

## 🚀 Develop locally

### Prerequisites

- Node.js 22.12 or newer
- npm 10 or newer

### One-command setup

```
npm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # local secrets, not for production
npm run db:migrate:local -w apps/worker                  # once: local D1
npm run dev:worker                                       # Worker on :8787
npm run dev:web                                          # Vite on :5173, /api proxied to the Worker
```

## 🔧 Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | ✅ | Signs administrator sessions |
| `WS_TICKET_SECRET` | ✅ | Signs one-time WebSocket tickets |
| `SETUP_TOKEN` | ✅ | One-time token for creating the first owner |
| `KDF_ITERATIONS` | — | Password hashing cost; the installer tunes it to your account's CPU limit |

The installer generates secrets for you. Never use the local values from `.dev.vars.example` in production.

## 📜 Scripts

| Command | What it does |
| --- | --- |
| `npm run check` | Types, tests and build: everything that must pass before a commit |
| `npm run dev:worker` | Local Worker with a simulated D1 |
| `npm run dev:web` | Web app with hot reload |
| `npm run test` | Unit tests (vitest) |
| `npm run install:wizard` | Local wizard: install, update, repair, backup, uninstall |
| `npm run release:check` | Checks that a release is ready to publish |
| `npm run release:package` | Builds the signed release package |
| `npm run signing-key` | Creates the release signing key |

## 🗂️ Project structure

```
apps/
  web/            # React + Tailwind: game, projector, host, admin
  worker/         # Hono API + Durable Objects (game room, updates, limits)
  installer-web/  # Browser installer
packages/
  shared/         # Pure logic and schemas shared by web and worker
  deploy-engine/  # Deploying to Cloudflare from code
migrations/       # D1 schema and seed data
installer/        # Local installation wizard
config/           # Cloudflare free-plan limits (the single place with quotas)
docs/             # Architecture, decisions, security, guides
tests/e2e/        # Browser tests against a real Worker
```

## 🚢 Releases & CI

A release is published with a `vX.Y.Z` tag: GitHub Actions builds the signed package (`gart-package.json` and `gart-installer.json`) and attaches it to the release. The owner gets updates from the admin panel: the package signature is verified before install, new database migrations are applied automatically, and you can roll back to the previous release if needed. For automatic updates from GitHub, connect the repository to Cloudflare Workers Builds; the steps are in the [Administrator Guide](docs/ADMIN-GUIDE.en.md).

## 🤝 Contributing

Ideas, fixes and translations are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and run `npm run check`. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## 📄 License

[GNU AGPL-3.0-only](LICENSE). You may run, modify and share Gart; if you offer a modified version to users over a network, you must also offer them its source code.
