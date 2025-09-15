# Repository Guidelines

## Project Structure & Module Organization
- `src/` — core TypeScript modules and `server.ts` (runtime logic).
- `frontend/` — SvelteKit client app (Bun/Vite); static assets in `frontend/static/`.
- `contracts/` — Hardhat Solidity project (`contracts/`, `test/`, `ignition/`).
- `e2e/` — Playwright end‑to‑end specs (`*.spec.ts`).
- `test/` — additional TypeScript tests (e.g., `test/integration/*.test.ts`).
- `dist/` — build outputs. `scripts/` — helper shell scripts. `docs/` — documentation.

## Build, Test, and Development Commands
- `npm run dev` — full local dev workflow (or `./dev-quick.sh` for faster loop).
- `npm run serve:dev` — bundle `src/server.ts` and run local server.
- `npm run build` — compile TypeScript to `dist/`.
- `npm run build:static` — build frontend for static hosting; `build:deploy` prepares GH Pages.
- `npm test` / `npm run test:contracts` — Hardhat contract tests.
- `npm run test:e2e` — Playwright tests under `e2e/` (use `HEADED=true` to run headed).
- `npm run lint` / `npm run format` — ESLint and Prettier.
- Env helpers: `npm run env:run` (Hardhat node), `env:deploy` (local deploy), `env:build` (compile).

## Coding Style & Naming Conventions
- Language: TypeScript (ESM). Linting: ESLint (`plugin:@typescript-eslint`), Formatting: Prettier.
- Prettier: 120‑char width, single quotes. Run `npm run format` before committing.
- Naming: modules prefer kebab‑case (e.g., `name-resolution.ts`); classes/types in PascalCase.
- Tests: end with `.spec.ts` (e2e) or `.test.ts` (integration/unit).

## Testing Guidelines
- E2E: place specs in `e2e/*.spec.ts`; run `npm run test:e2e`.
- Contracts: write deterministic Hardhat tests in `contracts/test/`; run `npm test`.
- Integration/unit: add under `test/` and use `.test.ts` suffix. Keep tests isolated and idempotent.

## Commit & Pull Request Guidelines
- Commits: imperative mood, sentence case, concise scope (e.g., "Refactor CI scripts for reliability"). Reference issues when relevant.
- PRs: include description, linked issues, testing steps, and screenshots for UI changes.
- Checks: ensure `npm run lint`, `npm test`, and (when applicable) `npm run test:e2e` pass locally.
- Keep PRs focused and small; update docs if commands or behavior change.

## Agent-Specific Notes
- Prefer minimal diffs; do not rename/move files unless requested. Follow Prettier/ESLint and existing patterns.
- If modifying build/test scripts, update this file and related docs/scripts accordingly.
