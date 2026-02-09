# Frontend Salvage Report (Before Deletion)

Date: 2026-02-09
Scope: `/frontend/src` as untrusted source of hints only.

## Why this exists

Frontend is high-noise and type-broken, but it still encodes some useful assumptions about runtime/server interfaces. This file preserves those assumptions so frontend can be removed without losing signal.

## High-value signals to keep

### 1) API surface expected by clients

Observed in frontend calls and backed by server implementation:

- `POST /api/rpc` (also `/rpc`)
- `GET /api/health`
- `GET /api/state`
- `GET /api/clients`
- `GET /api/debug/events`
- `POST /api/debug/reset`
- `GET /api/debug/entities`
- `GET /api/tokens`
- `POST /api/faucet/erc20`
- `POST /api/faucet/gas`
- `POST /api/faucet/reserve`
- `POST /api/faucet/offchain`

Server source of truth:
- `/Users/adimov/Developer/xln/runtime/server.ts`

### 2) Runtime capabilities expected by UX flows

Frontend expects these runtime functions:

- `main`
- `process`
- `applyRuntimeInput`
- `createEmptyEnv`
- `registerEnvChangeCallback`
- `startRuntimeLoop`
- `startP2P`
- `sendEntityInput`
- `resolveEntityProposerId`
- `queueEntityInput`
- `processJBlockEvents`
- `refreshGossip`
- `clearGossip`
- `getActiveJAdapter`
- scenario entrypoints under `scenarios.*`

Primary usage sites:
- `/Users/adimov/Developer/xln/frontend/src/lib/stores/xlnStore.ts`
- `/Users/adimov/Developer/xln/frontend/src/lib/stores/vaultStore.ts`
- `/Users/adimov/Developer/xln/frontend/src/lib/view/panels/ArchitectPanel.svelte`

### 3) Entity tx vocabulary surfaced in user flows

Observed tx types from UI paths:

- `importReplica`
- `importJ`
- `openAccount`
- `directPayment`
- `htlcPayment`
- `deposit_collateral`
- `requestWithdrawal`
- `startDispute`
- `reserve_to_reserve`
- `j_broadcast`
- `accountInput`
- `profile-update`
- `placeSwapOffer`
- `cancelSwapOffer`

Primary usage sites:
- `/Users/adimov/Developer/xln/frontend/src/lib/components/Entity/PaymentPanel.svelte`
- `/Users/adimov/Developer/xln/frontend/src/lib/components/Entity/EntityPanelTabs.svelte`
- `/Users/adimov/Developer/xln/frontend/src/lib/view/panels/ArchitectPanel.svelte`

## Critical mismatches discovered

These are useful as drift indicators, not as code to preserve:

- Frontend expects `startJEventWatcher`, but runtime export does not provide it.
  - References:
    - `/Users/adimov/Developer/xln/xln.ts`
    - `/Users/adimov/Developer/xln/frontend/src/lib/stores/vaultStore.ts`
- Frontend references legacy Graph3D/depository panel structure that no longer matches actual mounted panels.
- Frontend type-check currently fails heavily, so frontend cannot be treated as executable truth.

## Low-value noise (safe to discard)

- Visual/layout/theme artifacts.
- Stale Graph3D/VR references not connected to active runtime correctness.
- Historical docs embedded in UI components.

## Deletion-safe minimum to preserve elsewhere

If frontend is removed, keep this set alive in non-frontend tests/docs:

1. API contract list above (`/api/*`, `/rpc`).
2. Runtime function contract list above.
3. Tx vocabulary list above.
4. Smoke checks for:
   - server boot
   - `GET /api/health`
   - `GET /api/tokens`
   - `POST /api/faucet/erc20`
   - `POST /api/faucet/offchain`

