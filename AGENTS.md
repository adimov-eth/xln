# Repository Guidelines

## Project Structure & Module Organization
- `src/` — core TypeScript modules and `server.ts` (runtime logic).
- `frontend/` — SvelteKit client (Bun/Vite); static assets in `frontend/static/`.
- `contracts/` — Hardhat Solidity project (`contracts/`, `test/`, `ignition/`).
- `e2e/` — Playwright end‑to‑end specs (`*.spec.ts`).
- `test/` — integration/unit TypeScript tests (`*.test.ts`).
- `dist/` — build outputs. `scripts/` — helper scripts. `docs/` — documentation.

## Build, Test, and Development Commands
- `npm run dev` — full local dev workflow. Use `./dev-quick.sh` for faster loops.
- `npm run serve:dev` — bundle `src/server.ts` and run the local server.
- `npm run build` — compile TypeScript to `dist/`.
- `npm run build:static` — build frontend for static hosting; `npm run build:deploy` for GH Pages.
- `npm test` / `npm run test:contracts` — run Hardhat contract tests.
- `npm run test:e2e` — Playwright tests under `e2e/` (`HEADED=true` to run headed).
- `npm run lint` / `npm run format` — ESLint and Prettier.
- Env helpers: `npm run env:run` (Hardhat node), `npm run env:deploy` (local deploy), `npm run env:build` (compile).

## Coding Style & Naming Conventions
- Language: TypeScript (ESM). Linting: ESLint (`plugin:@typescript-eslint`).
- Formatting: Prettier (120‑char width, single quotes). Run `npm run format` before committing.
- Naming: modules in kebab‑case (e.g., `name-resolution.ts`); classes/types in PascalCase.
- Tests: end with `.spec.ts` (e2e) or `.test.ts` (integration/unit).

## Testing Guidelines
- E2E: place specs in `e2e/*.spec.ts`; run with `npm run test:e2e`. Use `HEADED=true` for a headed browser.
- Contracts: write deterministic Hardhat tests in `contracts/test/`; run `npm test` or `npm run test:contracts`.
- Integration/unit: add under `test/` with `.test.ts` suffix. Keep tests isolated and idempotent.
- Local chain: use `npm run env:run` to start a node and `npm run env:deploy` to deploy locally when tests require it.

## Commit & Pull Request Guidelines
- Commits: imperative mood, sentence case, concise scope (e.g., "Refactor CI scripts for reliability"). Reference issues when relevant.
- PRs: include a clear description, linked issues, testing steps, and screenshots for UI changes.
- Checks: ensure `npm run lint`, `npm test`, and (when applicable) `npm run test:e2e` pass locally.
- Keep PRs focused and small; update docs if commands or behavior change.

## Agent‑Specific Notes
- Prefer minimal diffs; do not rename/move files unless requested.
- Follow existing patterns and project tools (ESLint/Prettier).
- If you change build/test scripts, update this file and related docs/scripts accordingly.

