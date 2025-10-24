# XLN - Cross-Local Network


**Instant off-chain settlement with on-chain finality.**

Byzantine consensus meets Bloomberg Terminal meets VR. Run complete economic simulations in your browser—no backend needed.

---

## [WEB] Directory Structure

```
Core:
  /vibepaper/           Philosophy, architecture, eternal specs
  /runtime/             Consensus engine (BFT entity + bilateral account state machines)
  /jurisdictions/       Solidity contracts (Ethereum, Polygon, Arbitrum, ...)
  /worlds/              Economic simulations (.xln.js scenario files)
  /view/                Panel UI components (Graph3D, Entities, Depository, Architect)
  /frontend/            Main xln.finance app (uses /view)
  /simnet/              BrowserVM genesis configs (offline blockchain)
  /proofs/              Validation tests (Playwright E2E + smoke tests)

Dev:
  bootstrap.sh          One-command setup
  workflow.md           Daily commands
  claude.md             AI instructions
  .archive/             Old implementations (never deleted)

---

## [LAUNCH] Quick Start

```bash
# Install + start everything
bun run dev

# Open browser
open http://localhost:8080
```

**First run:** ~2-3min (installs Foundry)
**After:** ~10sec

---

## [GOAL] What is XLN?

Cross-Local Network enables entities to:
- Exchange value **instantly off-chain** (BFT consensus)
- Anchor final state **on-chain** (Ethereum, Polygon, Arbitrum)
- Run complete **economic simulations in browser** (BrowserVM - no backend!)
- Visualize in **VR** (Quest/Vision Pro compatible)

**Think:** Lightning Network + Byzantine consensus + Bloomberg Terminal + Blender.

### Finance is physics of trust

---

## [BUILD] Architecture (J-E-A Layers)

### J - Jurisdiction Layer (On-Chain)
- **What:** Solidity contracts managing reserves, collateral, settlements
- **Where:** `/jurisdictions/contracts/`
- **Contracts:**
  - `Depository.sol` - Implements `IDepository` (future ERC standard)
  - `EntityProvider.sol` - Entity registration + quorum verification
- **Deploy:** Ethereum, Polygon, Arbitrum, any EVM chain

### E - Entity Layer (Off-Chain BFT Consensus)
- **What:** Distributed organizations with threshold signatures
- **Flow:** ADD_TX [RIGHTWARDS] PROPOSE [RIGHTWARDS] SIGN [RIGHTWARDS] COMMIT
- **Source:** `/runtime/entity-consensus.ts`
- **Deterministic:** Nonce-based ordering, Merkle state roots

### A - Account Layer (Bilateral Channels)
- **What:** Payment channels between entity pairs
- **Perspective:** Left/right with canonical ordering (entityA < entityB)
- **Source:** `/runtime/account-consensus.ts`
- **Settlement:** Bilateral state verification with Merkle proofs

---

## [PC] Key Commands

```bash
# Development
bun run dev              # Full stack (jurisdictions + runtime + frontend)
bun run check            # TypeScript + Svelte validation
bun run build            # Build runtime.js for browser

# Jurisdictions (Contracts)
bun run env:build        # Compile Solidity
bun run env:deploy       # Deploy to local network
bun run dev:reset        # Reset all networks + redeploy

# Frontend
cd frontend && bun run dev      # Vite dev server
cd frontend && bun run build    # Production build

# Testing
bun run proofs                  # Playwright E2E tests
bun test-ethereumjs-vm.ts       # BrowserVM smoke test
```

---

## [DESIGN] XLNView Panel System

**Bloomberg Terminal-style workspace. Drag, dock, float, tab - full Chrome DevTools UX.**

### Core 4 Panels (Open by Default)
1. **[WEB] Graph3D** - Force-directed network viz (WebGL/WebGPU toggle)
2. **[OFFICE] Entities** - Live entity list (reserves, accounts, activity)
3. **[$] Depository** - On-chain J-state viewer (BrowserVM queries)
4. **[TAKE] Architect** - God-mode controls (5 modes: Explore/Build/Economy/Governance/Resolve)

### Layouts
- **Default**: 4-panel workspace
- **Analyst**: Graph3D + Depository + Console (research mode)
- **Builder**: Architect + Graph3D + Entities (creation mode)
- **Embed**: Graph3D only (for docs/blog posts)

**Tech:** Dockview (2.8k stars), Svelte reactivity, localStorage persistence

**Source:** `/view/` + `/vibepaper/xlnview.md`

---

## [TEST] Simnet (Offline Blockchain in Browser)

**No localhost:8545. No cloud RPC. Pure browser.**

- **Engine:** @ethereumjs/vm v10 (official Ethereum Foundation implementation)
- **Deployed:** Depository.sol + 500 prefunded entities
- **Tokens:** USDC (id=1), ETH (id=2)
- **Reset:** Refresh page = new universe
- **Persistent:** Optional IndexedDB (resume sessions)

**Config:** `/simnet/genesis.json`

**Demo:**
```bash
bun test-ethereumjs-vm.ts
# [OK] Deploys contract, funds entities, executes transfers
```

---

## [GAME] VR/Quest Support

- **WebXR:** Enabled by default (WebGL renderer)
- **Offline:** Simnet works without network (perfect for VR demos)
- **Performance:** 72fps in Quest 3
- **Future:** Hand tracking, voice commands, spatial UI

---

## [DOCS] Documentation

### Forever (vibepaper/)
- `xlnview.md` - Panel architecture + BrowserVM integration
- `jea.md` - Jurisdiction-Entity-Account model
- `governance-architecture.md` - Multi-sig voting system
- `sessions/` - Technical deep-dives

### Disposable (Root .md)
- `workflow.md` - Daily dev commands
- `restructure.md` - Migration notes (Oct 2025 - delete later)
- `claude.md` - AI assistant instructions

---

## [FIRE] Recent Updates (Oct 2025)

- [OK] **Repository restructure** - Essence-driven naming (vibepaper, runtime, jurisdictions, worlds)
- [OK] **BrowserVM integration** - Offline simnet with @ethereumjs/vm
- [OK] **Panel workspace** - Dockview-based Bloomberg Terminal UX
- [OK] **WebGPU/WebGL switch** - Runtime renderer toggle (future-proof)
- [OK] **IDepository interface** - Standardizable ERC for reserve management
- [OK] **Depository** - 69% smaller, self-contained (6.6KB vs 21KB)

---

## [TOOLS] Tech Stack

**Runtime:** TypeScript + Bun
**Frontend:** Svelte + Vite + Three.js
**Contracts:** Solidity + Hardhat
**Blockchain:** @ethereumjs/vm (simnet) [RIGHTWARDS] Hardhat (local) [RIGHTWARDS] Ethereum/L2s (prod)
**Panels:** Dockview (2.8k*)
**Tests:** Playwright

---

## [MAP] Network Roadmap

### Simnet (Now - Oct 2025)
**Browser-only simulation. Zero infrastructure.**
- **Engine:** @ethereumjs/vm (in-browser blockchain)
- **Contracts:** Depository.sol (6.6KB, implements IDepository)
- **State:** 500 prefunded entities, USDC + ETH
- **Reset:** Refresh page = new universe
- **Use:** Scenario rehearsals, VR demos, tutorials

### Testnet (Q1 2026)
**Shared PoA network. Multi-user coordination.**
- **Network:** Arrakis (custom PoA chain)
- **Contracts:** Full suite (EntityProvider, Depository, SubcontractProvider)
- **Validators:** 5 trusted nodes
- **Use:** Integration testing, onboarding flows, load testing

### Mainnet (Q4 2026)
**Production deployment. Real value.**
- **Chains:** Ethereum (L1), Polygon/Arbitrum (L2s)
- **Governance:** Multi-sig + timelock
- **Audits:** Trail of Bits + OpenZeppelin
- **Use:** Live settlement network

---

## [BOOK] Learn More

**Start here:**
1. `workflow.md` - Daily dev commands
2. `/vibepaper/xlnview.md` - Panel architecture + BrowserVM
3. `/vibepaper/jea.md` - Jurisdiction-Entity-Account model
4. `/simnet/readme.md` - Offline blockchain setup

**For deep dives:** `/vibepaper/sessions/`

---

**License:** AGPL-3.0
**Status:** Active development (2025)
**Website:** xln.finance (coming soon)
