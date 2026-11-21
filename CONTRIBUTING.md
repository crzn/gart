# Contributing to Gart

Thank you for helping. Gart is a small project with one hard rule: **it must run on the Cloudflare Free plan** (no paid products, limits in `config/cloudflare-limits.json`). A change that needs a paid feature will not be accepted.

## Set up

```
npm install
npm run check          # typecheck + all unit tests + build; must be green
npm run dev:worker     # Worker on :8787 (run `npm run db:migrate:local -w apps/worker` once)
npm run dev:web        # Vite on :5173, proxies /api to the Worker
```

Node.js 22.12 or newer. The browser tests in `tests/e2e/*.e2e.mjs` start their own local Worker and need Playwright (`npx playwright install chromium`); each file says how to run it.

## What a good change looks like

- Small and focused, with tests. Game rules live in `packages/shared` and are tested without a browser.
- User-visible text goes through the translation files (`apps/web/src/i18n`): Ukrainian is the default language, English is kept in step. Do not hard-code strings.
- Security-relevant code (sessions, tokens, release signature checking, the updater) needs a test that shows the failure case, not only the happy path.
- Database changes are new files in `migrations/`; never edit one that has been released. Migrations that remove data are flagged and need an explicit confirmation when updating.
- Update `CHANGELOG.md`, and `docs/DECISIONS.md` when you choose between alternatives.
- Do not add dependencies lightly: the Worker bundle must stay small (Free plan limit) and every package is a supply-chain risk.

## Pull requests

Open an issue first for anything bigger than a fix, so we can agree on the direction. In the pull request say what changed and why, and how you checked it. Releases are made by the maintainer: a version tag builds and signs the release package.

## Licence

By contributing you agree that your contribution is licensed under the GNU AGPL-3.0-only, like the rest of the project.

## Conduct

Be kind and assume good faith. Technical disagreement is welcome; personal attacks are not.
