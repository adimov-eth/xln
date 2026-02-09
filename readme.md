# XLN - Cross-Local Network


**Instant off-chain settlement with on-chain finality.**

Kernel-first protocol runtime for off-chain consensus with on-chain finality.

---

## 🌐 Directory Structure

```
Core:
  /docs/                Philosophy, architecture, eternal specs
  /runtime/             Consensus engine (BFT entity + bilateral account state machines)
    /account-tx/        Account transaction handlers
    /entity-tx/         Entity transaction handlers
    /scenarios/         Economic simulations (ahb.ts, grid.ts, etc.)
    /jadapter/          EVM integrations (BrowserVM, RPC)
  /jurisdictions/       Solidity contracts (Ethereum, Polygon, Arbitrum, ...)
  /tests/               Legacy E2E archive (non-core)

Dev:
  /scripts/             Deployment + operational tooling
  /ai/                  AI integrations (STT server, telegram bot, council)
  bootstrap.sh          One-command setup
  CLAUDE.md             AI instructions
  .archive/             Old implementations (historical reference)

---

## 🚀 Quick Start

```bash
# Install + start kernel stack
bun run dev

# Health check
curl http://localhost:8080/api/health
```

**First run:** ~2-3min (installs Foundry)
**After:** ~10sec

---

## 🎯 What is XLN?

Cross-Local Network enables entities to:
- Exchange value **instantly off-chain** (BFT consensus)
- Anchor final state **on-chain** (Ethereum, Polygon, Arbitrum)
- Run deterministic **local simulations** (BrowserVM)

**Think:** Lightning-style state channels + Byzantine consensus + programmable entities.

### Finance is physics of trust

---

## 🏗️ Architecture (J-E-A Layers)

### J - Jurisdiction Layer (On-Chain)
- **What:** Solidity contracts managing reserves, collateral, settlements
- **Where:** `/jurisdictions/contracts/`
- **Contracts:**
  - `Depository.sol` - Implements `IDepository` (future ERC standard)
  - `EntityProvider.sol` - Entity registration + quorum verification
- **Deploy:** Ethereum, Polygon, Arbitrum, any EVM chain

### E - Entity Layer (Off-Chain BFT Consensus)
- **What:** Distributed organizations with threshold signatures
- **Flow:** ADD_TX → PROPOSE → SIGN → COMMIT
- **Source:** `/runtime/entity-consensus.ts`
- **Deterministic:** Nonce-based ordering, Merkle state roots

### A - Account Layer (Bilateral Channels)
- **What:** Payment channels between entity pairs
- **Perspective:** Left/right with canonical ordering (entityA < entityB)
- **Source:** `/runtime/account-consensus.ts`
- **Settlement:** Bilateral state verification with Merkle proofs

---

## 💻 Key Commands

```bash
# Development
bun run dev              # Contracts + runtime API + relay
bun run check            # Kernel TypeScript gate
bun run check:noncore    # Informational non-core type check

# Jurisdictions (Contracts)
bun run env:build        # Compile Solidity
bun run env:deploy       # Deploy to local network
bun run dev:reset        # Reset all networks + redeploy
node scripts/check-bytecode-size.mjs  # EIP-170 size gate
node scripts/generate-jurisdictions-config.mjs # Emit jurisdictions config from deployment

# Testing
bun run test                    # Runtime tests
cd jurisdictions && bunx hardhat test
```

---

## Frontend Status

Frontend code is intentionally removed from the active protocol repository.

- Preserved signal: `docs/core/frontend-salvage-report.md`
- Runtime API compatibility is enforced via `runtime/__tests__/server-api-smoke.test.ts`
- Kernel gates do not depend on UI build artifacts

---

## 🧪 Simnet (Offline VM)

**No localhost:8545. No cloud RPC. Pure browser.**

- **Engine:** @ethereumjs/vm v10 (official Ethereum Foundation implementation)
- **Deployed:** Depository.sol + 500 prefunded entities
- **Tokens:** USDC (id=1), ETH (id=2)
- **Reset:** Refresh page = new universe
- **Persistent:** Optional IndexedDB (resume sessions)

**Config:** Genesis configs in `runtime/evms/browser-evm.ts`

**Demo:** Run runtime scenarios - BrowserVM deploys contracts automatically

---

## 📚 Documentation Tree

```
Root:
  readme.md              This file - project overview
  CLAUDE.md              AI assistant instructions
  changelog.md           Version history

/docs/
  ├── contributing/      How to develop on XLN
  │   ├── workflow.md           Daily commands (bun run dev, etc)
  │   ├── bug-prevention.md     Pre-commit checklist
  │   ├── agentic.md            AI autonomous execution (80% rule)
  │   └── adhd-format.md        Response formatting guide
  │
  ├── research/          Explorations & specifications
  │   ├── insurance/            Insurance layer designs
  │   │   ├── claude-analysis.md
  │   │   ├── codex-analysis.md
  │   │   └── gemini-analysis.md
  │   ├── depository-core.md    Contract logic summary
  │   └── rollups-position.md   XLN vs rollups comparison
  │
  ├── planning/          Active & historical planning
  │   ├── active/
  │   │   └── next.md           Current priority tasks
  │   ├── completed/            Finished refactors
  │   └── launch-checklist.md   Pre-launch verification
  │
  ├── about/             Philosophy & origin
  │   ├── homakov.md            Founder's vision
  │   └── repo-structure.md     Private vs public repos
  │
  ├── testing/           Test procedures
  │   └── ahb-demo.md           AHB demo steps
  │
  └── docs/              Core architecture (existing)
      ├── rjea.md               R→E→A→J flow explanation
      ├── kernel-manifest.md    Core/non-core boundary
      ├── flow.md               Transaction flow
      └── ...                   (eternal specs)
```

**Quick links:**
- New to XLN? Start with [docs/about/homakov.md](docs/about/homakov.md)
- Want to contribute? Read [docs/contributing/workflow.md](docs/contributing/workflow.md)
- Current priorities? Check [docs/planning/active/next.md](docs/planning/active/next.md)
- Architecture deep-dive? See [docs/docs/rjea.md](docs/docs/rjea.md)

---

## 🔥 Recent Updates

- ✅ **Repository restructure** - Essence-driven naming (docs, runtime, jurisdictions, worlds)
- ✅ **BrowserVM integration** - Offline simnet with @ethereumjs/vm
- ✅ **Kernel boundary** - frontend removed from active runtime/deploy path
- ✅ **IDepository interface** - Standardizable ERC for reserve management
- ✅ **Depository hardening** - unsafe batch policy + EIP-170 size gate

---

## 🛠️ Tech Stack

**Runtime:** TypeScript + Bun
**Contracts:** Solidity + Hardhat
**Blockchain:** @ethereumjs/vm (simnet) → Hardhat (local) → Ethereum/L2s (prod)
**Tests:** Bun runtime tests + Hardhat contract tests

---

## 🗺️ Network Roadmap

### Simnet (Now)
**Browser-only simulation. Zero infrastructure.**
- **Engine:** @ethereumjs/vm (in-browser blockchain)
- **Contracts:** Depository.sol (6.6KB, implements IDepository)
- **State:** 500 prefunded entities, USDC + ETH
- **Reset:** Refresh page = new universe
- **Use:** Scenario rehearsals and protocol debugging

### Testnet (Q1 2026)
**Base Sepolia. Multi-user coordination.**
- **Network:** Base L2 Sepolia (chainId: 84532)
- **Contracts:** Full suite (EntityProvider, Depository, DeltaTransformer)
- **RPC:** https://sepolia.base.org
- **Use:** Integration testing, onboarding flows, load testing

### Mainnet (Q4 2026)
**Production deployment. Real value.**
- **Chains:** Base L2 (primary), Ethereum L1 (bridge)
- **Governance:** Multi-sig + timelock
- **Audits:** Trail of Bits + OpenZeppelin
- **Use:** Live settlement network

---

## 📖 Learn More

**Start here:**
1. [docs/contributing/workflow.md](docs/contributing/workflow.md) - Daily dev commands
2. [docs/core/kernel-manifest.md](docs/core/kernel-manifest.md) - Kernel/non-core boundary
3. [docs/docs/rjea.md](docs/docs/rjea.md) - R→E→A→J flow explanation
4. [docs/audit-protocol-readiness.md](docs/audit-protocol-readiness.md) - Readiness findings

**For deep dives:** [docs/docs/](docs/docs/)

---

**License:** AGPL-3.0
**Status:** Active development (2025)
**Website:** xln.finance (coming soon)
