# Contributing

Thanks for contributing to **Creative Agentic CMS**. This repo is a **local-first MVP** (no database, no auth). Please keep changes small, focused, and aligned with the project mission.

## Read first

- `README.md` — project overview + local dev
- `MISSION.md` — what the project is / isn’t (scope boundaries)
- `FACTORY_RULES.md` — process + safety rules (especially for dependencies and tests)
- `CLAUDE.md` — TypeScript conventions (strict, ES modules, Zod at boundaries, no `any`, pinned deps)

## Development setup

Prerequisites:
- Node.js **≥ 20**
- `pnpm` (recommended via corepack; repo pins `pnpm@9.15.6`)

Quickstart:
```bash
corepack enable
corepack prepare pnpm@9.15.6 --activate

pnpm install
cp .env.example .env

# Foreground dev (recommended)
./start.sh --foreground

# Or run the workspace dev script directly:
# pnpm dev
```

URLs (defaults):
- Web UI: `http://localhost:5173`
- API server: `http://localhost:5174`

Project data is stored locally under `./projects/<projectId>/` (gitignored).

## Running checks

Before opening a PR, run:
```bash
pnpm lint
pnpm test
pnpm build
```

E2E (Playwright):
```bash
# Install Playwright browsers (first time)
pnpm --filter @cac/web exec playwright install

# Run E2E tests
pnpm --filter @cac/web test:e2e
```

## Making changes

### Keep scope tight

- Follow `MISSION.md` hard invariants and the “out of scope” list.
- Avoid drive-by refactors. If you want to refactor, open an issue first.
- Keep per-file changes reasonable (see `FACTORY_RULES.md` for limits and expectations).

### TypeScript + runtime validation

- TypeScript is strict across the workspace.
- At system boundaries (HTTP inputs, env/config, filesystem data), validate with **Zod**.
- Prefer named exports; avoid default exports.

### Dependencies

- Avoid adding dependencies unless necessary.
- If you add one: pin exact versions (no `^`/`~`) and ensure the license does **not** require commercial terms.
- Be ready to justify why existing deps don’t suffice.

### Tests

- New behavior should include tests (unit/integration/E2E as appropriate).
- Don’t “fix” tests to match broken behavior; fix the source code.

## Pull requests

PR expectations:
- Link the originating issue in the PR description using `Fixes #N` / `Closes #N` / `Resolves #N`.
- Describe what changed and how it was verified (commands + results).
- Include screenshots for user-visible UI changes.
- Don’t commit generated artifacts, local projects, or secrets.

## Security

- **Never commit** `.env`, API keys, tokens, screenshots with sensitive content, or data under `./projects/`.
- This codebase is intended for **local** use. Be cautious with changes that bind servers to `0.0.0.0`, relax CORS, or expose filesystem paths.

Reporting:
- For security-sensitive issues, prefer GitHub **Security Advisories** (private) if available.
- Otherwise, open a GitHub issue but **avoid posting secrets or exploit details**.

