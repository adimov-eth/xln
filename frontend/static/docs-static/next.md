# Next Steps & Strategic Focus

**Last Updated:** 2025-10-10

---

## [GOAL] Strategic Vision

### **XLN Scope: B2B + B2E + E2E**

**NOT just wholesale settlement.** XLN is the complete payment stack:

- **B2B:** Corporate treasury, cross-border, wholesale settlement
- **B2E:** Payroll, expenses (employees get credit limits from employer)
- **E2E:** Personal payments, rent, friend IOUs, subscriptions

**One person, one account with:**
- Employer (salary + expense credit)
- Landlord (rent + security deposit as collateral)
- Friends (trust-based credit limits)
- Businesses (subscriptions with credit terms)

**All using same protocol. All sovereign. All with credit+collateral hybrid.**

### **Target: 51% of Electronic Payment Volume**

**Not 51% of wholesale. 51% of EVERYTHING:**
- Visa/MC ($10T+/year)
- PayPal/Venmo/Zelle ($1.5T+/year)
- Remittances ($800B/year)
- Personal credit relationships (unmeasured)

**Timeline: ~2042-2045** (20 years from 2017 idea publication)

**Path:**
- 2025-2027: Developer adoption (Lightning integrations)
- 2027-2030: Consumer fintech apps
- 2030-2035: Network effects
- 2035-2045: Becomes payment infrastructure

**Like TCP/IP:** Users won't know XLN exists. Apps just use it.

---

## [FIRE] PRIMARY FOCUS: Graph 3D/VR + Embeds

### **Strategic Decision (2025-10-10)**

**Focus ALL energy on:**
1. **Graph 3D visualization** - The "holy shit" moment
2. **VR experience** - Unique differentiator
3. **Embeddable scenarios** - Viral distribution

**Postpone:**
- [X] Graph 2D (removed from codebase)
- || Terminal view (developer tool, not growth lever)
- || Panels view (useful but not hook)

**Why Graph 3D?**
- First 30 seconds matter - text doesn't convince
- "Credit where it scales, collateral where it secures" is abstract
- **Watching** value flow through 3D grid makes it visceral
- Embeds = distribution engine (blog posts, docs, Twitter)
- VR = unique positioning

---

## [OK] Completed (2025-10-10 Session)

### Documentation System
- [OK] Consolidated /docs (55[RIGHTWARDS]46 files, organized directories)
- [OK] Integrated DocsView into main app
- [OK] Markdown rendering with sidebar navigation
- [OK] Auto-copy docs on dev startup
- [OK] Search functionality

### Infrastructure
- [OK] HTTPS dev server (localhost:8080, valid certs until 2028)
- [OK] RPC proxy (/rpc/ethereum [RIGHTWARDS] HTTP Hardhat)
- [OK] Fixed mixed content issues (HTTPS <-> HTTP)
- [OK] J-watcher connected via proxy

### Embeddable Scenarios
- [OK] IsolatedScenarioPlayer component (fully isolated state)
- [OK] YouTube-style playback controls
- [OK] Fast execution mode (tickInterval: 0)
- [OK] Multiple instances supported
- [OK] /embed route for external iframes
- [OK] Embedded in Docs intro page

### Time Machine Redesign
- [OK] Ultra-compact single-row layout
- [OK] Separate Time (m:ss.ms) / Runtime (frames) / FPS
- [OK] Loop modes (off/all/slice)
- [OK] Slice markers with visual indicators
- [OK] Speed dropdown (0.1x-10x)
- [OK] Export menu (JSON/URL/GIF)
- [OK] Keyboard shortcuts
- [OK] Apple liquid glass aesthetic

### Codebase Cleanup
- [OK] Removed Graph 2D from viewMode
- [OK] Renamed "Server" [RIGHTWARDS] "Runtime" in time machine
- [OK] Fixed time machine positioning (bottom of viewport)

---

## [OK] Completed (2025-10-10 Evening Session)

### **J-REA Rename (COMPLETE)**
- [OK] `server.ts` [RIGHTWARDS] `runtime.ts` (filename)
- [OK] `ServerInput` [RIGHTWARDS] `RuntimeInput` (types)
- [OK] `ServerTx` [RIGHTWARDS] `RuntimeTx`
- [OK] `processUntilEmpty()` [RIGHTWARDS] `process()`
- [OK] `server.js` [RIGHTWARDS] `runtime.js` (build output)
- [OK] All imports updated (20+ files)
- [OK] Build scripts updated (dev-full.sh, deploy-contracts.sh, package.json)
- [OK] `bun run check` passes (0 errors)

### **Arrakis Jurisdiction (COMPLETE)**
- [OK] Replaced "Ethereum" placeholder with "Arrakis" (demo J-machine)
- [OK] Created `jurisdictions.json` with Arrakis + Wakanda
- [OK] Currency: SPICE (Arrakis), VIBRANIUM (Wakanda pending)
- [OK] Updated all references (runtime.ts, scenarios, prepopulate)

### **RPC Proxy (COMPLETE)**
- [OK] Vite proxy: `/rpc/arrakis` [RIGHTWARDS] `http://localhost:8545`
- [OK] Zero SSL errors (`net::ERR_SSL_PROTOCOL_ERROR` eliminated)
- [OK] J-Watcher syncing successfully (jBlock=2)
- [OK] WebSocket HMR working

### **E2E Testing (COMPLETE)**
- [OK] Playwright MCP framework operational
- [OK] Tests: smoke, payment flow, consensus verification
- [OK] Live verification: payments processing, bilateral consensus working

### **XLNView Component (COMPLETE)**
- [OK] Created XLNView.svelte (embeddable with Graph+Panels tabs)
- [OK] Updated /embed route to use XLNView
- [OK] Grid positioning fix (reads from gossip profiles)
- [OK] URL format: `/embed?s=NAME&v=VIEW`

### **Financial Scenarios (COMPLETE)**
- [OK] Created `.xln.js` format specification
- [OK] 5 scenarios: phantom-grid, diamond-dybvig, corporate-treasury, share-release, dividend-payment
- [OK] Documentation: scenarios/README.xln.md

---

## o Critical TODOs - Immediate

### **0. DROPPED: J-REA Terminology**
**Reason:** "J-REA" sounds like "diarrhea" - bad branding
**Decision:** Keep code as "Runtime", avoid acronym in marketing

**Step 1: Code (src/ and frontend/src/)**
```bash
# Find all occurrences
grep -r "server" src/ frontend/src/ --include="*.ts" --include="*.svelte" -i | grep -i "machine\|layer\|S-machine"

# Rename patterns (case-sensitive):
# "Server" [RIGHTWARDS] "Runtime"
# "server" [RIGHTWARDS] "runtime" (when referring to the layer, not web server)
# "S-machine" [RIGHTWARDS] "R-machine"
# "JSEA" [RIGHTWARDS] "J-REA"
# "JEA" [RIGHTWARDS] "J-REA" (when referring to full model)

# Key files to update:
- src/types.ts (comments, type names)
- src/server.ts (module comments, log messages)
- frontend/src/lib/components/Layout/TimeMachine.svelte (already uses "Runtime" [CHECK])
- frontend/src/lib/stores/* (comments)

# Keep lowercase "server" when it means:
- server.ts (filename)
- server.js (build output)
- Web server / HTTP server contexts
```

**Step 2: Documentation (docs/)**
```bash
# Update all markdown files
grep -r "Server.*machine\|S-machine\|JSEA\|JEA model" docs/ --include="*.md"

# Replace in:
- docs/README.md (main architecture doc)
- docs/JEA.md [RIGHTWARDS] rename to docs/JREA.md
- docs/summary.md
- docs/philosophy/*.md
- docs/architecture/*.md

# Search and replace:
# "JEA" [RIGHTWARDS] "J-REA" (when referring to model)
# "Jurisdiction [RIGHTWARDS] Entity [RIGHTWARDS] Account" [RIGHTWARDS] "Jurisdiction [RIGHTWARDS] Runtime [RIGHTWARDS] Entity [RIGHTWARDS] Account"
# Add explanation: "J (on-chain) - REA (off-chain cascade)"
# "S-machine (Server)" [RIGHTWARDS] "R-machine (Runtime)"
# "Server: The Simulated Ground Layer" [RIGHTWARDS] "Runtime: The Simulation Host"
```

**Step 3: Comments and Logs**
```bash
# Update UI-facing strings
grep -r "Height.*Server\|Server.*height" src/ frontend/src/

# Change:
# "Server height" [RIGHTWARDS] "Runtime height"
# "Server frame" [RIGHTWARDS] "Runtime frame"
# "Server state" [RIGHTWARDS] "Runtime state"

# Keep "server" in:
# - File paths (server.ts, server.js)
# - Network contexts (HTTP server, dev server)
# - Variable names (serverTx, serverState) - these are OK, just add comment
```

**Step 4: Git Rename**
```bash
# After all content updated:
git mv docs/JEA.md docs/JREA.md

# Update cross-references
grep -r "JEA.md" docs/
# Replace with JREA.md
```

**Verification:**
```bash
# Should find ZERO (only filename/variable refs):
grep -r "Server.*machine\|S-machine" src/ frontend/src/ docs/ --include="*.ts" --include="*.svelte" --include="*.md"

# Should find MANY:
grep -r "Runtime.*machine\|R-machine\|J-REA" docs/ --include="*.md"
```

**Example positioning:**
- "XLN uses the J-REA model"
- "**J** (Ethereum: public truth) - **REA** (Your machine: Runtime[RIGHTWARDS]Entity[RIGHTWARDS]Account)"
- "Deploy your REA, connect to any J"
- "Broadcast layer (J) | Unicast cascade (REA)"

**Estimate:** 2-3 hours (careful search-replace)
**Priority:** HIGH (foundational clarity)

---

## o Critical TODOs - Graph 3D Polish

### **1. Fix Grid Positioning** [OK] DONE (2025-10-10)
- [OK] Updated IsolatedScenarioPlayer to read `gossip.profiles[].metadata.position`
- [OK] Fallback to radial if no position data
- [OK] Now matches main Graph 3D behavior

---

### **2. Build 10 Killer Scenarios**

**Status:** Only 3 scenarios exist (h-network, diamond-dybvig, phantom-grid)
**Impact:** Limited embed content

**Needed scenarios:**
1. [OK] Diamond-Dybvig (bank run)
2. [OK] Phantom Grid (cube demo)
3. [X] Lightning Inbound Liquidity Failure
4. [X] XLN Credit Extension Solution
5. [X] Multi-Hop Routing
6. [X] Hub Liquidity Crisis
7. [X] Bilateral Settlement
8. [X] Credit-Collateral Rebalancing
9. [X] Collateral Backstop Demo
10. [X] Multi-Jurisdiction Flow

**Each scenario:**
- ~30 lines DSL
- Clear narrative (title + description per frame)
- 10-30 frames
- Embeddable in docs

**Estimate:** 8 hours (all 10)
**Priority:** HIGH (needed for docs, blog posts, demos)

---

### **3. Entity Labels & Balance Display**

**Status:** Entities show as unlabeled spheres
**Impact:** Can't tell what's happening

**Implementation:**
```typescript
// Add to IsolatedScenarioPlayer renderFrame()
const label = createTextSprite(
  `${profile.name}\n${formatBalance(profile.balance)}`
);
label.position.set(mesh.position.x, mesh.position.y + 8, mesh.position.z);
scene.add(label);
```

**Show on labels:**
- Entity number/name
- Current balance (if >0)
- Hub indicator (* emoji)

**Estimate:** 2 hours
**Priority:** HIGH (readability)

---

### **4. Account Connection Bars**

**Status:** No visual connection between entities
**Impact:** Can't see relationships/flows

**Implementation:**
- Use AccountManager from network3d/ (already extracted)
- Show bars with capacity visualization
- Color-code by delta (green=positive, red=negative)
- Animate on payment events

**Estimate:** 3 hours
**Priority:** MEDIUM (polish)

---

### **5. Camera Presets Per Scenario**

**Status:** Fixed camera angle, not optimized per scenario
**Impact:** Some scenarios show poorly

**Implementation:**
```typescript
// In scenario DSL:
0: Setup
grid 2 2 2
VIEW camera=isometric zoom=1.5

1: Payment
alice pay bob 100
VIEW camera=follow entity=alice
```

**Camera modes:**
- `orbital` - Default orbit around center
- `isometric` - 45° angle (best for cubes)
- `follow` - Track specific entity
- `overview` - Zoom out for full network

**Estimate:** 2 hours
**Priority:** MEDIUM (UX polish)

---

### **6. Narrative Subtitles**

**Status:** Exists but not used in embeds
**Impact:** Missing storytelling

**Implementation:**
- Enable NarrativeSubtitle in IsolatedScenarioPlayer
- Each scenario frame has `narrative` field
- Show as caption below 3D view

**Estimate:** 1 hour
**Priority:** MEDIUM (storytelling)

---

## [LAUNCH] Next Feature: Multi-View Embeddable Player

### **Concept**

Instead of 3D-only, embed FULL xlnomy with view switching:

```
┌─────────────────────────────────────┐
│ 3D │ Panels │ Terminal │            │
├─────────────────────────────────────┤
│  [Current view synchronized to      │
│   same timeline]                    │
├─────────────────────────────────────┤
│ << < > >> │ Time Machine │ 1.0x │ LIVE│
└─────────────────────────────────────┘
```

**Why:**
- **3D**: See topology
- **Panels**: See user's perspective (wallet balance)
- **Terminal**: See commands that generated this state
- **Same timeline**: All views sync to same frame

**Use case:**
Tutorial scenario with narrative:
- Frame 0 [3D]: "Alice and Hub connect"
- Frame 1 [Panel]: "Alice's wallet shows 100 USDC"
- Frame 2 [Terminal]: `alice pay hub 30`
- Frame 3 [Panel]: "Alice now has 70 USDC"

**Implementation:**
1. Extract Panel + Terminal views into embeddable components
2. Add tab switcher to IsolatedScenarioPlayer
3. All views share same `localEnv` and `localHistory`
4. Time machine controls all views

**Estimate:** 6 hours
**Priority:** HIGH (killer feature for interactive docs)

---

## o Important TODOs (Post-Graph-3D)

### **Backend: cooperativeClose**

**Status:** Still missing (was critical, now lower priority)
**Impact:** Can't close accounts gracefully

**Why lower priority now:**
- Graph 3D polish more important for adoption
- Can launch "Visual Demo" without full functionality
- Add cooperativeClose before production deployment

**Estimate:** 4-6 hours
**Priority:** Important, not urgent

---

### **Backend: Transaction Failure Tracking**

**Status:** Failed txs disappear silently
**Impact:** Poor UX

**Estimate:** 2 hours
**Priority:** Medium

---

### **Backend: Client-Side Dispute System**

**Status:** Contract has it, client doesn't
**Impact:** Can't challenge fraud

**Estimate:** 6-8 hours
**Priority:** Needed before mainnet

---

## [LIST] Graph 3D Roadmap

### Phase 1: Core Polish (Week 1)
1. [OK] Embeddable architecture (IsolatedScenarioPlayer)
2. [OK] Fast execution (tickInterval: 0)
3. [X] Fix grid positioning
4. [X] Entity labels
5. [X] OrbitControls integration

### Phase 2: Visual Quality (Week 2)
6. [X] Account connection bars
7. [X] Balance animations
8. [X] Camera presets
9. [X] Narrative subtitles
10. [X] Smooth transitions

### Phase 3: Content Creation (Week 3)
11. [X] Build 10 killer scenarios
12. [X] Embed in all comparison docs
13. [X] Blog post: "Why Lightning Failed (Interactive)"
14. [X] Twitter demos

### Phase 4: Multi-View Player (Week 4)
15. [X] 3D + Panels + Terminal in one embed
16. [X] View switching with shared timeline
17. [X] Tutorial scenarios with multi-view narratives

---

## [TOOLS] Development Tooling

### Dev Workflow
- [OK] HTTPS localhost:8080
- [OK] RPC proxy working
- [OK] Auto-rebuild with dev-full.sh
- [OK] Time machine with keyboard shortcuts

### Future Improvements
- [X] Foundry migration (100x faster tests)
- [X] Hardhat tracer (better debugging)

---

## [GOAL] Success Criteria

### Visual Demo Ready (Next 2-3 weeks)
- [OK] Docs consolidated and accessible
- [OK] HTTPS + RPC proxy working
- [OK] Embeddable scenarios functional
- [X] Grid positioning fixed
- [X] 10 polished scenarios
- [X] All comparison docs have embeds
- [X] Multi-view player working

### Beta Deployment (After Graph 3D)
- All above +
- cooperativeClose implemented
- Transaction failures tracked
- Basic dispute UI

### Mainnet Ready (Later)
- All above +
- Full dispute system
- Security audit
- Multi-jurisdiction tested

---

## [BRAIN] Development Philosophy

**Current mode:** Not building for timeline - building for quality.

**8 years since idea publication.** No rush. Get Graph 3D **perfect** first.

**Why Graph 3D matters:**
- Can't explain "organizational layer" with text
- Can't show "credit+collateral hybrid" in static images
- Need people to **experience** value flowing through network
- Embeds = distribution without asking permission

**When Graph 3D is polished:**
- Every blog post has live demo
- Every comparison doc shows actual topology
- Every tweet can link to interactive example
- Docs become living tutorials

Then add backend features (cooperativeClose, disputes).

---

**Next session: Fix grid positioning + add entity labels [RIGHTWARDS] make first embed truly beautiful.**
