# Plan — Issue #6 (Create CONTRIBUTING.md)

## 1. Plan overview (summary)

Add repository contribution guidelines aligned with the existing stack (TypeScript + pnpm workspaces + Vitest + Playwright) and existing repo rules (MISSION/FACTORY_RULES/CLAUDE). Also add `start.sh` / `stop.sh` (and `restart.sh`) so future agents can reliably run the dev environment from any worktree.

## 2. Context

- `docs/plans/active/2026-04-26-create-contributing-md-file-for-this-repo/spec.md` (issue spec)
- `README.md` (local dev, test commands, project overview)
- `CLAUDE.md` (coding standards)
- `FACTORY_RULES.md` + `MISSION.md` (scope, process, safety)
- `package.json` + `packages/*/package.json` (scripts and tooling)

## 3. Project directories involved and changes in project architecture, structure, modules and data

- Repo root: add `CONTRIBUTING.md`.
- Repo root: add `start.sh`, `stop.sh`, `restart.sh` for dev workflow.
- `docs/plans/active/...`: add spec and plan docs (factory process).

No runtime architecture changes; no data model changes.

## 4. Important implementation patterns / configuration

- Scripts must be worktree-safe: keep runtime state in `.workspace/` (already gitignored) and avoid fixed global paths.
- Prefer existing workspace scripts (`pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`) rather than introducing new tools.
- Contribution rules must match existing constraints:
  - Node ≥ 20, pnpm via corepack.
  - Strict TypeScript and Zod at boundaries.
  - No new dependencies without strong justification; no commercial licenses.

## 5. Detailed step-by-step implementation tasks

### Task A — Add developer scripts (`start.sh`, `stop.sh`, `restart.sh`)

Implementation:
- Create `start.sh` that:
  - Ensures `pnpm` is available.
  - Runs `pnpm install`.
  - Ensures `.env` exists (create from `.env.example` if missing).
  - Starts `pnpm dev` (background by default) and writes PID + logs under `.workspace/`.
  - Prints access URL(s) and log locations.
- Create `stop.sh` that terminates the started process using the recorded PID and cleans up state.
- Create `restart.sh` that composes `stop.sh` + `start.sh`.

Verification:
- `bash ./start.sh --help`
- `bash ./start.sh --foreground` (manual quick sanity; Ctrl+C stops)
- `bash ./start.sh` then `bash ./stop.sh` (background lifecycle)

Criteria:
- `completeness`: Scripts exist and cover install + start + stop. (threshold: 8)
- `correctness`: Stop reliably terminates the dev process started by start. (threshold: 8)
- `verification_steps`: Includes runnable commands to validate scripts. (threshold: 8)
- `error_handling`: Helpful errors when pnpm missing or PID stale. (threshold: 6)
- `worktree_safe`: Uses `.workspace/` for PID/logs; no cross-worktree collisions. (threshold: 8)

### Task B — Add `CONTRIBUTING.md`

Implementation:
- Create `CONTRIBUTING.md` describing:
  - How to set up dev environment and run the app.
  - How to run lint/typecheck/tests/E2E.
  - Code style expectations (reference `CLAUDE.md`).
  - Scope rules (reference `MISSION.md` / `FACTORY_RULES.md`).
  - PR expectations (small, focused diffs; include tests; link issues).
  - Security reporting guidance (no secrets; how to report vulnerabilities).

Verification:
- Ensure instructions match existing scripts/commands in `package.json` and README.

Criteria:
- `completeness`: Covers setup, verification, PR process, and security. (threshold: 8)
- `correctness`: Commands match actual npm/pnpm scripts. (threshold: 8)
- `verification_steps`: Lists exact commands to run before PR. (threshold: 8)
- `error_handling`: Warns against committing secrets; points to `.env.example`. (threshold: 6)
- `docs_consistency`: Avoids contradictions with `README.md` / `CLAUDE.md`. (threshold: 8)

## 6. Security and performance considerations and impacts

No runtime security/performance changes. Documentation includes safe-handling guidance for `.env` / `OPENAI_API_KEY` and dependency policies.

## 7. Necessary updates of project documentation

- Add `CONTRIBUTING.md`.

## 8. Questions to clarify uncertainties (if any)

None.

