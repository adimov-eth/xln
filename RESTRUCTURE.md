# Repository Restructure - October 11, 2025

**Essence-driven naming: Directories speak their purpose, not their location.**

## Changes

```
OLD                  [RIGHTWARDS]  NEW                   ESSENCE
─────────────────────────────────────────────────────────────────
/docs                [RIGHTWARDS]  /vibepaper            Philosophy, vision, specs
/src                 [RIGHTWARDS]  /runtime              Consensus engine + state machines
/contracts           [RIGHTWARDS]  /jurisdictions        On-chain J-machine layer
/scenarios           [RIGHTWARDS]  /worlds               Economic simulations
/e2e                 [RIGHTWARDS]  /proofs               E2E validation tests
                     [RIGHTWARDS]  /simnet (NEW)         BrowserVM genesis configs
```

## Why

**vibepaper/** - Documentation is energy, not bureaucracy. This is where the vibe lives.

**runtime/** - Pure consensus. Entity machines, account consensus, deterministic ticks. What it DOES.

**jurisdictions/** - Plural because multi-chain. Ethereum, Polygon, Arbitrum. Legal execution layers.

**worlds/** - Not "scenarios" (too abstract). These are complete simulated economies.

**proofs/** - Tests that PROVE correctness. More precise than "e2e" (which is implementation detail).

**simnet/** - The offline universe. BrowserVM configs, genesis states, network params.

## Migration Complete

[OK] All git history preserved (`git mv`)
[OK] Import paths updated (30+ references)
[OK] Build scripts fixed (package.json, *.sh)
[OK] Frontend fetch paths updated (/worlds/)
[OK] TypeScript check passes

## Updated References

- `bun run build` [RIGHTWARDS] builds `runtime/runtime.ts`
- `bun run check` [RIGHTWARDS] validates `runtime/` + `frontend/`
- Contract scripts [RIGHTWARDS] use `cd jurisdictions`
- Scenario loading [RIGHTWARDS] fetches from `/worlds/`
- Docs [RIGHTWARDS] live in `vibepaper/`

## New Structure Benefits

1. **Clearer Intent**: Name reveals purpose immediately
2. **Multi-Chain Ready**: "jurisdictions" (plural) anticipates L2s
3. **Modular UI**: `/view` components, `/frontend` app that uses them
4. **BrowserVM Home**: `/simnet` for offline simulation configs
5. **Poetic**: "vibepaper" > "docs", "worlds" > "scenarios"

**Status:** COMPLETE - Ready to build.
