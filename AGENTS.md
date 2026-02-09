# AGENTS.md — xln operational manual for AI coding agents

xln is a bilateral consensus network for instant off-chain settlement with on-chain finality.
Core state machine is a pure function: `(prevEnv, inputs) → nextEnv`. Runtime is Bun, not Node.
Four layers: Runtime (R) → Jurisdiction (J) → Entity (E) → Account (A).

## Commands

```bash
bun run check                  # Type-check core (tsc --noEmit via tsconfig.core.json)
bun run test                   # All tests (bun test runtime/__tests__/)
bun test runtime/__tests__/ids.test.ts           # Single test file
bun test runtime/__tests__/invariants.test.ts    # Property-based invariant tests
bun run format                 # Prettier write on ./runtime
bun run lint                   # ESLint on ./runtime
bun run dev                    # Dev server (anvil :8545 + runtime :8080 + relay :9000)
bun runtime/scenarios/lock-ahb.ts                # Run HTLC scenario
bun runtime/scenarios/grid.ts                    # Run multi-entity scenario
bun run env:build              # Compile Solidity (hardhat)
```

## Before You Commit

Run all three. No exceptions. Do not commit if any fail.

```bash
bun run check && bun run test && bun run format
```

Test files (`*.test.ts`) are excluded from type-checking. That's intentional.

## Banned Patterns

These will break the build, corrupt state, or get your changes rejected:

| Pattern                      | Why                                        | Use instead                                                          |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `JSON.stringify()`           | Crashes on BigInt. ESLint error-level ban. | `safeStringify()` from `serialization-utils.ts`                      |
| `JSON.parse()`               | No BigInt revival. ESLint error-level ban. | `safeParse()` from `serialization-utils.ts`                          |
| `Date.now()`                 | Breaks determinism in RJEA flow            | `env.timestamp`                                                      |
| `Math.random()`              | Breaks determinism in RJEA flow            | Seeded PRNG (`mulberry32`)                                           |
| `setTimeout/setInterval`     | Breaks determinism in RJEA flow            | Tick-based delays via `env.timestamp`                                |
| `crypto.randomBytes()`       | Breaks determinism in RJEA flow            | Seeded generator                                                     |
| `obj.prop = undefined`       | Violates `exactOptionalPropertyTypes`      | `delete obj.prop` or `...(val ? {prop: val} : {})`                   |
| `Buffer.compare()`           | Inconsistent cross-platform                | `buffersEqual()` from `serialization-utils.ts`                       |
| Default exports              | Not used anywhere in codebase              | Named exports only: `export function`, `export const`, `export type` |
| Mocks / stubs                | Real integration required                  | Use actual modules; no faking                                        |
| Hardcoded contract addresses | Addresses change per deploy                | `getAvailableJurisdictions()` from `evm.ts`                          |

## Code Style

**Prettier** (enforced):

- 120 char line width, single quotes, auto line endings
- Arrow parens avoided: `x => x` not `(x) => x`

**ESLint** (enforced):

- Import sorting via `simple-import-sort` (error-level)
- `@typescript-eslint/no-explicit-any`: warn
- `@typescript-eslint/no-unused-vars`: warn

**Import ordering** (enforced by simple-import-sort):

1. External packages (`ethers`, `@noble/hashes`, `bun:test`)
2. Internal type imports (`import type { Delta, Env } from './types'`)
3. Internal value imports (`import { Ok, Err } from './types'`)

**Import rules:**

- Relative paths only inside `runtime/` — use `./types` not `@xln/runtime/types`
- `import type` keyword required for type-only imports
- No file extensions in imports (except `.js` in test files if needed)
- Path aliases `@xln/runtime/*` and `@xln/brainvault/*` exist but are for external consumers

## Naming Conventions

| What             | Convention                         | Examples                                                  |
| ---------------- | ---------------------------------- | --------------------------------------------------------- |
| Files            | kebab-case                         | `entity-consensus.ts`, `serialization-utils.ts`           |
| Functions        | camelCase, verb-first              | `validateDelta()`, `isLeftEntity()`, `computeFrameHash()` |
| Boolean fns      | `is*` prefix                       | `isOk()`, `isErr()`, `isValidEntityId()`                  |
| Types/Interfaces | PascalCase, no `I` prefix          | `EntityState`, `AccountMachine`, `Delta`                  |
| Branded types    | PascalCase                         | `EntityId`, `SignerId`, `TokenId`, `LockId`               |
| Constants        | SCREAMING_SNAKE + `as const`       | `LIMITS`, `FINANCIAL`, `HTLC`, `TIMING`                   |
| Log labels       | `const L = 'MODULE_NAME' as const` | `const L = 'ENTITY_CONSENSUS' as const`                   |
| Project name     | Always lowercase                   | `xln`, never `XLN`                                        |

## TypeScript Strictness

tsconfig.core.json (what `bun run check` validates) has maximum strictness:

- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`
- `noUnusedLocals` and `noUnusedParameters` are relaxed (false) in core config
- `exactOptionalPropertyTypes` is relaxed (false) in core config but true in base tsconfig
- Target: `esnext`, module resolution: `bundler`, types: `node` + `bun`

## Types

Types live in `runtime/types/` split by domain: `core.ts`, `account.ts`, `entity.ts`, `jurisdiction.ts`, `env.ts`, `settlement.ts`, `governance.ts`. Barrel re-export via `runtime/types/index.ts`.

**Branded types** (`runtime/ids.ts`): `EntityId`, `SignerId`, `JId`, `TokenId`, `LockId`, `AccountKey`. Created via validator functions that throw on invalid input: `toEntityId(s)`, `toSignerId(s)`.

**Discriminated unions** everywhere. `EntityTx` has 25+ variants on `type` field. `AccountInput`, `JurisdictionEvent`, `SettlementWorkspace` all discriminated.

**Result type** for recoverable errors:

```typescript
import { Ok, Err, isOk, isErr } from './types';
type Result<T, E> = { _tag: 'Ok'; value: T } | { _tag: 'Err'; error: E };
```

**State uses Map**, not plain objects: `EntityState.reserves: Map<string, bigint>`, `AccountMachine.deltas: Map<TokenId, Delta>`, `Env.eReplicas`, `Env.jReplicas`.

**EntityInput vs RoutedEntityInput**: `EntityInput` = deterministic consensus fields only. `RoutedEntityInput extends EntityInput` adds `signerId`/`runtimeId` as routing hints. `runtime.ts` strips routing at R→E boundary.

## Error Handling

- **Throw early, throw loud.** Never swallow errors.
- **Prefix**: `FINTECH-SAFETY:` for financial/identity violations, `FINANCIAL-SAFETY:` for routing/data integrity
- **Validate at source, trust downstream.** Functions like `validateDelta()`, `validateEntityState()` throw at entry. No defensive `?.` after validation.
- **Custom errors**: `FinancialDataCorruptionError`, `TypeSafetyViolationError` in `validation-utils.ts`
- **Safe collection access**: `safeMapGet(map, key, context)` — throws with context on missing key
- **Fail-fast logger**: `logError()` throws in fail-fast mode (`[FAIL_FAST]` prefix)
- **Strict assertions**: `assertRuntimeStateStrict(env)` validates frame shapes, hashes, heights

## Project Structure

| Directory            | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `runtime/`           | Core consensus engine, state machines, networking, scenarios            |
| `runtime/types/`     | All type definitions, split by R/J/E/A domain                           |
| `runtime/__tests__/` | Bun test files (property-based + unit + smoke)                          |
| `runtime/scenarios/` | Runnable integration scenarios (lock-ahb, grid, etc.)                   |
| `jurisdictions/`     | Solidity contracts (Depository.sol, EntityProvider.sol), Hardhat config |
| `brainvault/`        | HD wallet derivation (frozen — do not modify)                           |
| `scripts/`           | Operational scripts (deploy, bootstrap)                                 |
| `docs/`              | All documentation (never create .md in /runtime/)                       |
| `.archive/2024_src/` | Reference implementation for bilateral consensus patterns               |

## Key Gotchas

- **Bilateral ordering**: left entity = lower entityId (lexicographic comparison)
- **Time-travel**: Always read from `env`, never from live stores
- **No .md in /runtime/**: Documentation goes in `/docs/`
- **Bun only**: Never use npm, node, or pnpm
- **Test framework**: `bun:test` (import `describe`, `expect`, `test` from `bun:test`)
- **14 pre-existing type errors** in `bun run check` — known, don't fix unless asked
- **No TODO comments**: Fix the issue now or ask the user for direction
