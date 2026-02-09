# Kernel Manifest

Date: 2026-02-10  
Status: Active hardening boundary for testnet readiness.

## Core (blocking quality gate)

The following areas are considered protocol kernel for this cycle:

- `/Users/adimov/Developer/xln/runtime/` (excluding `scenarios/`, `scripts/`, `typechain/`)
- `/Users/adimov/Developer/xln/runtime/server.ts`
- `/Users/adimov/Developer/xln/runtime/networking/ws-server.ts`
- `/Users/adimov/Developer/xln/runtime/jurisdiction-factory.ts`
- `/Users/adimov/Developer/xln/runtime/health.ts`
- `/Users/adimov/Developer/xln/xln.ts`
- `/Users/adimov/Developer/xln/jurisdictions/contracts/`
- `/Users/adimov/Developer/xln/jurisdictions/hardhat.config.cjs`
- `/Users/adimov/Developer/xln/jurisdictions/scripts/deploy-base.cjs`

## Non-core (informational, non-blocking)

The following remain outside the blocking gate for this cycle:

- `/Users/adimov/Developer/xln/runtime/scenarios/`
- `/Users/adimov/Developer/xln/runtime/scripts/`
- `/Users/adimov/Developer/xln/runtime/typechain/`
- `/Users/adimov/Developer/xln/brainvault/`
- Frontend remnants and related artifacts (`/Users/adimov/Developer/xln/frontend/`, legacy UI scripts)
- Legacy operational scripts not required for kernel testnet path

## Policy

- `bun run check` is the blocking kernel TypeScript gate.
- Non-core checks are captured by `bun run check:noncore` and do not block kernel promotion.
- Protocol/security changes must land in core paths.
