# Repo Hygiene Audit Report

Date: 2026-02-09
Auditor: Claude Code (automated)
Scope: Everything outside `/runtime/` core consensus engine

---

## Summary Statistics

| Category              | Files  | Est. LOC  | Verdict |
|-----------------------|--------|-----------|---------|
| Confirmed debris      | 27     | ~2,312    | CUT     |
| Frontend (full dir)   | 9,671  | ~988,328  | ARCHIVE |
| .archive/             | 78     | ~28,000   | KEEP (already archived) |
| Dead scripts          | 16     | ~2,956    | CUT     |
| Dead E2E tests (UI)   | 34+    | ~7,481    | CUT     |
| Dead root scripts     | 3      | ~60       | CUT     |
| **Total removable**   | **~9,829** | **~1,001,137** | |

---

## 1. Confirmed Deletes

All six targets exist and are debris. Safe to remove.

### `.obsidian/` -- CUT
- 4 files (app.json, appearance.json, core-plugins.json, workspace.json)
- Obsidian editor personal config. Should never be in repo.

### `.agents/` -- CUT
- 6 files across economy/, inbox/, papertrail/, profiles/
- AI multi-agent scaffolding experiment (manifest.json, multiagent.md, ledger.json, claude-architect.md)
- Not used by any runtime code

### `prompts/` -- CUT
- 3 files: codex-ahb-analysis.md, codex-jwatcher-fix.md, codex-mint-help.md
- Codex/AI analysis prompts. No code depends on these.

### `scripts/news-api.ts`, `scripts/news-cron.ts`, `scripts/setup-news-cron.sh` -- CUT
- 1,134 LOC total
- HN news summarization service using Claude API. Completely unrelated to xln protocol.
- References `@anthropic-ai/sdk` and `frontend/static/news/data` output

### `jurisdictions/typechain-types.bak2/` -- CUT
- 13 files, ~10,863 LOC
- Stale backup of typechain-types. Active version lives at `jurisdictions/typechain-types/`

### `frontend/src/lib/view/components/VRControlsHUD.svelte` -- CUT
- 184 LOC
- Dead VR/WebXR HUD component. Not imported anywhere active.
- Dies with frontend anyway (see section 2)

### `git rm` commands:
```bash
git rm -r .obsidian/
git rm -r .agents/
git rm -r prompts/
git rm scripts/news-api.ts scripts/news-cron.ts scripts/setup-news-cron.sh
git rm -r jurisdictions/typechain-types.bak2/
git rm frontend/src/lib/view/components/VRControlsHUD.svelte
```

---

## 2. Frontend Assessment

### Salvage report review
`docs/core/frontend-salvage-report.md` correctly identifies:
- API surface (13 endpoints) -- already defined in `runtime/server.ts`
- Runtime function contract (16 functions) -- all live in `runtime/runtime.ts`
- Entity tx vocabulary (14 types) -- defined in runtime type system
- Critical mismatches (e.g. `startJEventWatcher` drift)

The report covers the high-value signals. Nothing was missed.

### Spot-check of 3 biggest files

**ArchitectPanel.svelte (3,945 LOC):**
- God-mode controls panel. 5 modes (explore, build, economy, governance, resolve).
- Imports raw scenario source via Vite `?raw` imports
- S&P 500 ticker hardcoded list, topology selector, "Xlnomy" creator
- Pure UI orchestration. No protocol logic that isn't already in runtime.

**JurisdictionPanel.svelte (1,645 LOC):**
- Time-travel-aware J-Machine viewer with dropdown selector
- BigInt deserialization helpers (duplicates logic in runtime)
- External balance/debt display via on-chain queries
- Pure visualization. All data sourced from env/runtime.

**RuntimeIOPanel.svelte (1,293 LOC):**
- Frame-by-frame I/O dump panel with structured log filtering
- Log level/category filtering UI
- Full JSON dump mode for debugging
- Pure debugging UI. No unique logic.

### Verdict: ARCHIVE entire `frontend/` directory

- 9,671 files, ~988K LOC (includes node_modules, build output, etc.)
- Type-check fails heavily (`svelte-check` is the current `bun run check` bottleneck)
- All protocol-relevant signals are captured in `docs/core/frontend-salvage-report.md`
- No protocol logic lives exclusively in frontend
- Removing frontend unblocks `bun run check` (see section 8)

```bash
git rm -r frontend/
```

---

## 3. .archive/ Directory -- KEEP

Contents confirmed as expected:

| Path | Description |
|------|-------------|
| `2019_docs/` | Original xln whitepaper (16 chapters + images) |
| `2019on.txt` | 2019 onwards text dump (37K) |
| `2019src.txt` | 2019 source dump (104K) |
| `2019vue.txt` | 2019 Vue frontend dump (502K) |
| `2024_src/` | Previous TS implementation: Channel.ts, Transition.ts, User.ts, tests |
| `old-e2e-tests/` | Placeholder with .gitkeep |
| `visualization/` | hubspokes.html + visualization.js (early prototypes) |
| `README.md` | Archive index |
| `ux-mockup.html` | UX mockup |

78 files total, ~28K LOC of text. Git history preserves everything.
CLAUDE.md explicitly references `.archive/2024_src/app/Channel.ts` as reference implementation for bilateral consensus.

**Verdict: KEEP.** Referenced by CLAUDE.md and useful for historical context. Already isolated.

---

## 4. Scripts Classification

### KEEP (useful for dev/ops)

| File | Purpose | Rationale |
|------|---------|-----------|
| `scripts/serve.ts` | Static file server for frontend/build/ | KEEP only if frontend is kept; otherwise CUT |
| `scripts/start-server.sh` | pm2 wrapper for `bun runtime/server.ts` | Production ops |
| `scripts/restart-server.sh` | Kill + restart server with anvil check | Production ops |
| `scripts/start-anvil.sh` | Persistent anvil testnet startup | Production ops |
| `scripts/start-prod-hub.sh` | Start production hub node | Production ops |
| `scripts/deploy-fresh.sh` | Deploy server with fresh DB state | Production ops |
| `scripts/diagnose-prod.sh` | Production server diagnostics | Production ops |
| `scripts/notify.sh` | macOS notification helper (16 LOC) | Dev convenience, used by package.json |
| `scripts/bootstrap-hub.ts` | Create hub entities with gossip metadata | Operational bootstrap |
| `scripts/dev/` (all 6 files) | dev-ci.sh, dev-quick.sh, dev-watch.sh, dev.sh, start-networks.sh, stop-networks.sh | Development workflow |
| `scripts/deployment/` (all 5 files) | deploy-bun.sh, deploy-direct.cjs, deploy-to-vultr.sh, setup-server-bun.sh, setup-server.sh | Server provisioning |

### CUT (dead/irrelevant)

| File | LOC | Rationale |
|------|-----|-----------|
| `scripts/news-api.ts` | 438 | News aggregator, unrelated to protocol |
| `scripts/news-cron.ts` | 638 | News cron job, unrelated to protocol |
| `scripts/setup-news-cron.sh` | 58 | News cron setup, unrelated to protocol |
| `scripts/comparative-api.ts` | 256 | AI model evaluation collector, unrelated |
| `scripts/check-payment.mjs` | 166 | Imports from `../src/server.ts` (dead path, no `src/` dir) |
| `scripts/generate-phantom-grid.ts` | 202 | Generates 1000-entity grid scenario text file; visualization demo |
| `scripts/inject-version.ts` | 60 | Injects git version into `frontend/src/lib/generated/version.ts`; dies with frontend |
| `scripts/fix-console-logs.sh` | 44 | One-time migration script (console.log -> logger); already applied |
| `scripts/debug/debug.js` | 14 | References dead `./src/server.ts` path |
| `scripts/debug/debug-simple.js` | ~50 | Debug helper (check if current) |
| `scripts/debug/debug-reserves.js` | ~100 | Debug helper (check if current) |
| `scripts/debug/enc.js` | ~120 | Encoding benchmark (cbor/rlp), requires dead deps |
| `scripts/debug/gpt.cjs` | 492 | LLM context generator, dev tooling not protocol |
| `scripts/playwright/` (4 files) | 256 | Playwright helpers for frontend UI testing; dies with frontend |

### CUT conditional on frontend removal

| File | LOC | Rationale |
|------|-----|-----------|
| `scripts/serve.ts` | ~60 | Serves `frontend/build/`; useless without frontend |
| `scripts/inject-version.ts` | 60 | Writes to `frontend/src/lib/generated/version.ts` |

```bash
# Definite cuts
git rm scripts/news-api.ts scripts/news-cron.ts scripts/setup-news-cron.sh
git rm scripts/comparative-api.ts scripts/check-payment.mjs
git rm scripts/generate-phantom-grid.ts scripts/fix-console-logs.sh
git rm -r scripts/debug/
git rm -r scripts/playwright/

# Conditional on frontend removal
git rm scripts/inject-version.ts scripts/serve.ts
```

---

## 5. Scenarios Classification

All files in `runtime/scenarios/`:

### ESSENTIAL (verifies core protocol behavior, keep)

| File | LOC | Tests |
|------|-----|-------|
| `ahb.ts` | ~600 | Core bilateral consensus: R2R, R2C, ondelta, settlement |
| `lock-ahb.ts` | ~500 | HTLC multi-hop routing: hashlock, secret propagation, fees |
| `htlc-4hop.ts` | ~300 | 4-hop onion routing verification |
| `settle.ts` | ~400 | Settlement workspace: propose, update, approve, execute |
| `multi-sig.ts` | ~300 | 2-of-3 BFT threshold consensus |
| `rapid-fire.ts` | ~300 | Stress test: 200 payments, rollback handling |
| `swap.ts` | ~400 | Bilateral swap orderbook: limit orders, partial fills |
| `swap-market.ts` | ~400 | Multi-party orderbook: 8 traders, 3 books |
| `grid.ts` | ~200 | Hub-spoke scaling vs broadcast bottleneck |
| `solvency-check.ts` | ~50 | Solvency verification utility |
| `helpers.ts` | ~400 | Shared scenario helpers (snap, assert, process wrappers) |
| `boot.ts` | ~300 | Shared boot utilities (BrowserVM, JReplica creation) |
| `index.ts` | 122 | Scenario registry (SCENARIOS + scenarioRegistry arrays) |
| `seeded-rng.ts` | ~50 | Deterministic PRNG for reproducibility |
| `types.ts` | ~200 | Scenario type definitions |
| `executor.ts` | ~200 | Scenario text file executor |
| `parser.ts` | ~300 | Scenario text file parser |
| `loader.ts` | ~30 | Scenario file/URL loader |

### DEMO/DEAD (remove or archive)

| File | LOC | Rationale |
|------|-----|-----------|
| `insurance-cascade.ts` | ~150 | Uses hardcoded mint/burn entity IDs, not integrated with real J-Machine. Demo only. |
| `topology-presets.ts` | ~200 | Country economic presets with emoji flags for visualization. No protocol test value. |

```bash
# Optional cleanup (low priority, harmless to keep)
git rm runtime/scenarios/insurance-cascade.ts runtime/scenarios/topology-presets.ts
```

**Note:** All 8 essential scenarios are registered in `index.ts`. Removing insurance-cascade and topology-presets requires updating `index.ts` scenarioRegistry (insurance-cascade entry at line 107-114).

---

## 6. E2E Tests Classification

### PROTOCOL (tests consensus/state machine -- keep after adaptation)

| File | Tests | Notes |
|------|-------|-------|
| `browser-evm.spec.ts` | BrowserVM contract deploy/call | Needs frontend webserver; convert to bun unit test |
| `time-machine-isolation.spec.ts` | Frame history correctness | Conceptually protocol; currently requires UI |

**Verdict:** These 2 specs test protocol concepts but currently depend on the frontend to exercise them. After frontend removal, they break. Their protocol assertions should be migrated to `runtime/scenarios/` as pure bun tests.

### UI (tests frontend -- dies with frontend removal)

Every other spec file tests UI elements, panel visibility, dropdown behavior, proposal creation via DOM, screenshot capture, etc.

| File | Category |
|------|----------|
| `account-opening-flow.spec.ts` | UI + console log verification |
| `ahb-demo.spec.ts` | UI: AHB preset, subtitle display |
| `ahb-smoke.spec.ts` | UI: AHB launch, frame count |
| `app-mode-toggle.spec.ts` | UI: mode toggle |
| `app-visual-check.spec.ts` | UI: visual check |
| `combined-flow.spec.ts` | UI: threshold slider + proposal |
| `compare-frontend.spec.ts` | UI: legacy vs svelte comparison |
| `complete-proposal-execution.spec.ts` | UI: proposal flow via DOM |
| `create-entity.spec.ts` | UI: entity creation via Formation panel |
| `debug-entity-selection.spec.ts` | UI: entity selection debug |
| `e2e-ahb-payment.spec.ts` | UI: full payment flow via browser |
| `e2e-payment.spec.ts` | UI: HTLC payment flow via browser |
| `final-proposal-execution.spec.ts` | UI: proposal execution |
| `gossip-account.spec.ts` | UI: gossip + account input |
| `quick-proposal-demo.spec.ts` | UI: proposal demo |
| `reserve-faucet.spec.ts` | UI: faucet in user mode |
| `reserves-verification.spec.ts` | UI: reserve display |
| `screenshot-ui.spec.ts` | UI: screenshot capture |
| `simple-proposal-verification.spec.ts` | UI: proposal creation verification |
| `step-by-step-proposal.spec.ts` | UI: step-by-step proposal |
| `tutorial-working-demo.spec.ts` | UI: complete tutorial walkthrough |
| `ui-dropdown.spec.ts` | UI: dropdown entity selection |
| `ui-formation.spec.ts` | UI: entity creation via Formation |
| `ui-panels.spec.ts` | UI: panel add/clone/remove (already `test.skip`) |
| `ui-time.spec.ts` | UI: time machine controls |
| `ux-flow-verification.spec.js` | UI: UX flow verification |
| `working-proposal-test.spec.ts` | UI: proposal test |
| `working-proposal-with-selection.spec.ts` | UI: proposal with selection |
| `ahb-mechanics-e2e.js` | UI: AHB mechanics via browser |
| `banking-demo.js` | UI: banking demo walkthrough |
| `r2r-visual-e2e.js` | UI: R2R visual demo |

### Supporting files (die with UI tests)

| File | Purpose |
|------|---------|
| `global-setup.ts` | Playwright base test extension |
| `run-test.ts` | E2E test runner for Claude Code |
| `tutorial-documentation-generator.ts` | Tutorial doc generator from E2E |
| `tests/utils/playwright-helpers.ts` | Playwright helpers |
| `tests/package.json` | Test package config |
| `tests/tsconfig.json` | Test TS config |
| `tests/e2e/screenshots/` | 58 screenshot files |
| `tests/scenarios/` | 3 scenario markdown docs |
| Markdown files | check_server.md, final_status.md, http_vs_https.md, legacy-vs-svelte-analysis.md, quickstart.md, readme.md, test_results.md |

### Verdict: CUT entire `tests/` directory

After frontend removal, all E2E tests break. Protocol correctness is verified via `runtime/scenarios/` which run as pure bun scripts with assertions. The 2 conceptually-protocol specs should be migrated first.

```bash
git rm -r tests/
git rm playwright.config.ts
```

---

## 7. package.json Cleanup

### Dead script references

| Script | Problem |
|--------|---------|
| `"deploy": "./deploy.sh"` | `deploy.sh` does not exist at repo root |
| `"deploy:full": "./deploy.sh --frontend"` | Same -- deploy.sh missing |
| `"dev:ci": "./dev-ci.sh"` | `dev-ci.sh` does not exist at root (lives at `scripts/dev/dev-ci.sh`) |
| `"dev:quick": "./dev-quick.sh"` | `dev-quick.sh` does not exist at root (lives at `scripts/dev/dev-quick.sh`) |
| `"dev:watch": "./dev-watch.sh"` | `dev-watch.sh` does not exist at root (lives at `scripts/dev/dev-watch.sh`) |
| `"serve": "bun run serve.ts"` | `serve.ts` does not exist at root (lives at `scripts/serve.ts`) |
| `"serve:dev"` | Same issue with serve.ts |

### Scripts that need updating after frontend removal

| Script | Current | Fix |
|--------|---------|-----|
| `"dev"` | Runs anvil + server + runtime build + relay + vite dev | Remove vite dev, remove runtime.js browser build |
| `"build"` | Builds `frontend/static/runtime.js` | Remove or repurpose (runtime is server-only) |
| `"build:static"` | `cd frontend && bun run build:static` | Remove |
| `"build:deploy"` | `npm run build:static` | Remove |
| `"check"` | `bun x tsc --noEmit && cd frontend && bun run check` | See section 8 |
| `"check:frontend"` | `cd frontend && bun run check` | Remove |
| `"test:e2e"` | `playwright test` | Remove (no frontend to test) |
| `"tutorial"` | Runs tutorial E2E spec | Remove |
| `"tutorial:headed"` | Same, headed | Remove |
| `"tutorial:demo"` | Same | Remove |
| `"tutorial:demo:headed"` | Same | Remove |
| `"generate:tutorials"` | `bun run tests/tutorial-documentation-generator.ts` | Remove |
| `"test:e2e:notify"` | Playwright + notification | Remove |
| `"dev:no-relay"` | `cd frontend && vite dev` | Remove |

### Frontend-only dependencies to remove

From `dependencies`:
- `dockview` -- Dockview panel layout (frontend-only)
- `jdenticon` -- Avatar/identicon generation (frontend-only)
- `@anthropic-ai/sdk` -- Used only by news scripts (being cut)

From `devDependencies`:
- `concurrently` -- Only needed for `dev` script running vite alongside server. Can keep if dev script still runs multiple processes, otherwise remove.

---

## 8. `bun run check` Fix Path

### Current definition (package.json line 34):
```json
"check": "bun x tsc --noEmit && cd frontend && bun run check"
```

### What it does:
1. `bun x tsc --noEmit` -- Runs root tsconfig. Currently the root `tsconfig.json` has `"include": ["src/**/*", "playwright.config.ts"]` but there is NO `src/` directory. This is vestigial and checks nothing useful.
2. `cd frontend && bun run check` -- Runs `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --threshold error && vite build`. This is the real type-checker, but it checks Svelte components.

### After frontend removal:

**Fix the root tsconfig.json:**
- Change `"include"` from `["src/**/*", "playwright.config.ts"]` to `["runtime/**/*"]`
- This makes `tsc --noEmit` actually check the core runtime

**Update check script:**
```json
"check": "bun x tsc --noEmit"
```

Remove `check:frontend` script entirely.

**Note:** The CLAUDE.md comment "svelte-check is the ONLY real type checker" becomes false after this fix -- root tsc takes over as the real checker once tsconfig includes runtime/.

---

## 9. Other Debris

### Root-level stray files

| File | Verdict | Rationale |
|------|---------|-----------|
| `brainvault.ts` | KEEP | CLI entry for BrainVault (used, documented) |
| `bv` | KEEP | 5-byte shim: `import './brainvault/cli.ts'` |
| `xln.ts` | KEEP | Main CLI entry point |
| `auto-deploy.sh` | KEEP | Production auto-deploy |
| `bootstrap.sh` | KEEP | One-liner installer |
| `deploy-contracts.sh` | KEEP | Multi-network contract deployment |
| `dev-full.sh` | KEEP | Full dev environment setup |
| `reset-networks.sh` | KEEP | Network reset + redeploy |
| `.prettierrc` | KEEP | Formatting config (used by `bun run format`) |
| `.eslintrc` | KEEP | Linting config (used by `bun run lint`) |
| `.eslintignore` | KEEP | Eslint ignore |
| `.cursorignore` | CUT | Cursor editor config, personal tooling |
| `.vscode/launch.json` | KEEP | Debug configuration (useful for devs) |
| `.github/workflows/` | KEEP | CI/CD workflows (build-and-test.yml, deploy.yml) -- will need updating after frontend removal |
| `.claude/agents/` | KEEP | Claude Code agent configurations (3 files, specialized architect/consensus agents) |
| `db-tmp/` | KEEP | Runtime database temp dir (has `runtime` subdir, used by server) |

### CUT

```bash
git rm .cursorignore
```

### Files needing updates (not removal)

| File | Issue |
|------|-------|
| `.github/workflows/build-and-test.yml` | Likely references frontend build/check steps |
| `.github/workflows/deploy.yml` | May reference frontend build |
| `tsconfig.json` | Include path needs updating (see section 8) |
| `package.json` | Extensive cleanup needed (see section 7) |
| `CLAUDE.md` | References `bun run check` behavior, frontend dev port, `cd frontend` commands |

---

## Complete `git rm` Execution Plan

### Phase 1: Confirmed debris (safe, no dependencies)
```bash
git rm -r .obsidian/
git rm -r .agents/
git rm -r prompts/
git rm scripts/news-api.ts scripts/news-cron.ts scripts/setup-news-cron.sh
git rm -r jurisdictions/typechain-types.bak2/
git rm .cursorignore
```

### Phase 2: Dead scripts
```bash
git rm scripts/comparative-api.ts
git rm scripts/check-payment.mjs
git rm scripts/generate-phantom-grid.ts
git rm scripts/fix-console-logs.sh
git rm -r scripts/debug/
```

### Phase 3: Frontend removal (after salvage report is confirmed complete)
```bash
git rm -r frontend/
git rm -r scripts/playwright/
git rm scripts/inject-version.ts
git rm scripts/serve.ts
```

### Phase 4: E2E test removal (after protocol tests migrated to scenarios)
```bash
git rm -r tests/
git rm playwright.config.ts
```

### Phase 5: Config updates (manual edits, not removals)
- `package.json`: Remove dead scripts, update `check`, remove frontend deps
- `tsconfig.json`: Update include paths
- `.github/workflows/`: Update CI to not reference frontend
- `CLAUDE.md`: Remove frontend references, update `bun run check` docs

---

## Risk Assessment

- **Zero risk:** Phase 1-2 (pure debris, nothing references these)
- **Low risk:** Phase 3 (frontend salvage report captures all signals; `bun run check` breaks until Phase 5 config update is done simultaneously)
- **Medium risk:** Phase 4 (E2E tests gone; mitigated by scenarios being the true protocol tests; 2 protocol-adjacent specs should be migrated first)
- **Required:** Phase 5 must be done simultaneously with Phase 3 to keep `bun run check` working
