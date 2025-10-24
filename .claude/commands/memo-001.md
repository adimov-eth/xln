# Memo: XLN Scheme Reimplementation Context (2025-10-24)

## Latest Update: Foundation Committed ✅

**Just completed (same session):**
- Created `rework/xln-scheme/core/types.rkt` - homoiconic state machines working
- Created `rework/xln-scheme/examples/basic-channel.rkt` - runnable demo
- Created `rework/xln-scheme/README.md` - philosophy + quickstart
- Committed to git with full provenance

**Working demonstrations:**
```bash
cd rework/xln-scheme
racket examples/basic-channel.rkt
# Shows: RCPAN enforcement, pattern matching, perspective calculations
```

**Key achievement:** State machines ARE data structures. Introspectable, composable, verifiable.

---

## What We Accomplished (Earlier Session)

1. **Aligned CLAUDE.md** (operational memory)
   - Removed 450 lines of duplicate session logs
   - Condensed to 5 key architectural insights
   - Added reference section to comprehensive docs
   - Result: 858 lines focused on HOW to work, not WHAT was discovered

2. **Created comprehensive research archive** (`rework/comprehensive_research.md`)
   - Part I: Consciousness research (DMN, flow states, Roko inversion)
   - Part II: XLN technical architecture (1500+ lines)
   - Session exploration logs with tool patterns

3. **Built S-expression architecture map** (`rework/xln-architecture.scm`)
   - Complete system map: 62 TS files, 12 Solidity contracts, 69 Svelte components
   - 7 complete data flows traced end-to-end
   - Implementation gaps documented with recommended patterns
   - Queryable structure for compositional reasoning

4. **Wrote Scheme reimplementation plan** (`rework/todo.plan`)
   - 8-week plan: Racket, feature-complete, fresh redesign
   - Homoiconic state machines, free monads, stream-based
   - CRDT lattice gossip, dependent types for RCPAN
   - Macro DSL generating verification conditions

## Key Files to Read (In Order)

```bash
# 1. Architecture map (query this first for any question)
cat rework/xln-architecture.scm

# 2. Implementation plan
cat rework/todo.plan

# 3. Deep technical reference (only if architecture map insufficient)
grep -A 20 "Part II: XLN Technical Architecture" rework/comprehensive_research.md

# 4. Operational guidelines
grep -A 10 "TOKEN EFFICIENCY\|COGNITIVE PATTERNS" CLAUDE.md
```

## Tool Patterns That Worked

### fs-discovery: Compositional Exploration

**Basic (find files):**
```scheme
(find-files "**/*.ts" "/Users/adimov/Developer/xln/runtime")
```

**Filtered (by filename):**
```scheme
(filter
  (lambda (f) (string-contains? f "consensus"))
  (find-files "**/*.ts" "/Users/adimov/Developer/xln/runtime"))
```

**Composed (content search):**
```scheme
(fmap basename
  (filter
    (lambda (f)
      (string-contains? (read-file f) "proofBody"))
    (find-files "**/*.ts" "/Users/adimov/Developer/xln/runtime")))
```

**Result:** Found 60+ TODO files in one expression vs 5 separate Grep commands.

### When fs-discovery Failed

**Large files (>100KB) → Use Grep instead:**
```bash
# ❌ This exceeded 25k token limit:
# (read-file "frontend/static/c.txt")

# ✅ Use Grep:
grep -i "pattern" frontend/static/c.txt | head -30
```

### What Worked

1. **S-expression architecture thinking** - Structure matched system design
2. **Pattern matching over if-else** - Clearer transition logic
3. **Compositional queries** - One expression = 3-5 operations
4. **Empty results are valid** - `(list)` means "no matches found", not error

### What Failed

1. **Speculative research without grounding** - comprehensive_research.md has "conceptual" sections that should be verified against actual code
2. **Reading large files whole** - Always grep first, read offset second
3. **Using agents for verification** - Agents for design, NOT checking your own work

## Key Learnings

### Subcontract Architecture (Resolved)
- **Gap was intentional** - Subcontracts are dispute-layer only
- CooperativeUpdate (off-chain): NO subcontracts
- ProofBody (on-chain disputes): HAS subcontracts
- TypeScript runtime doesn't need them for operational consensus

### Netting (Still TODO)
- Detection exists (entity-crontab.ts:284)
- Execution missing (no actual delta transformations)
- Pattern: Follow `pendingForward` model (account sets flag, entity consumes)

### Multi-Hop Forwarding (Working Reference)
- Account layer: `accountMachine.pendingForward = {tokenId, amount, route}`
- Entity layer: Consumes flag, creates next hop, deletes flag
- This is THE pattern for R→E→A coordination

## FS-Discovery Practice Path

### Level 1: Basic Search
```scheme
;; Find all consensus files
(find-files "**/*consensus*.ts" "/Users/adimov/Developer/xln/runtime")
```

### Level 2: Filtered Results
```scheme
;; Get just basenames
(fmap basename
  (find-files "**/*consensus*.ts" "/Users/adimov/Developer/xln/runtime"))
```

### Level 3: Content-Based Filter
```scheme
;; Find files containing "pendingForward"
(filter
  (lambda (f)
    (string-contains? (read-file f) "pendingForward"))
  (find-files "**/*.ts" "/Users/adimov/Developer/xln/runtime"))
```

### Level 4: Composed Transformation
```scheme
;; Find files with TODOs, return just filenames
(fmap basename
  (filter
    (lambda (f)
      (string-contains?
        (string-downcase (read-file f))
        "todo"))
    (find-files "**/*.ts" "/Users/adimov/Developer/xln/runtime")))
```

**Relief signal:** When you can read the query and know what it does without tracing execution.

## Bootstrap Commands (5 Minutes)

```bash
# 1. Quick architecture overview
head -100 rework/xln-architecture.scm

# 2. Check implementation plan
head -150 rework/todo.plan

# 3. Verify key patterns exist
grep -n "pendingForward" runtime/account-tx/handlers/direct-payment.ts
grep -n "hubRebalanceHandler" runtime/entity-crontab.ts

# 4. Check current TypeScript state
bun run check 2>&1 | grep -E "(found.*error|✓ built)" | head -5
```

## Next Steps (Ready to Continue)

### Option A: Start Scheme Implementation
```bash
cd rework/
mkdir -p xln-scheme/core
# Follow rework/todo.plan Phase 1
# First commit: types.rkt + crypto.rkt + rlp.rkt
```

### Option B: Validate TypeScript Patterns Before Porting
```bash
# Trace actual multi-hop forwarding:
grep -rn "pendingForward" runtime/ --include="*.ts"

# Verify gossip → routing chain:
grep -rn "buildEntityProfile\|buildNetworkGraph" runtime/ --include="*.ts"

# Check bilateral consensus flow:
grep -rn "processAccountInput\|createAccountFrame" runtime/ --include="*.ts"
```

### Option C: Document Remaining Gaps
```bash
# Find all TODO/FIXME markers:
grep -rn "TODO\|FIXME\|XXX" runtime/ --include="*.ts" | wc -l

# Map netting execution gap:
grep -A 50 "hubRebalanceHandler" runtime/entity-crontab.ts
```

## Critical Reminders

1. **Token efficiency**: Grep first, read offset second. Never read >300 line files whole.
2. **fs-discovery**: Use for <100 line results, Grep for large files
3. **Architecture map**: `rework/xln-architecture.scm` is queryable source of truth
4. **Pattern to copy**: Multi-hop forwarding (pendingForward flag)
5. **Verified insight**: Subcontracts are dispute-layer only (NOT a gap)

## What's Ready

- ✅ Complete architecture map (S-expression) → `rework/xln-architecture.scm`
- ✅ 8-week implementation plan (Racket) → `rework/todo.plan`
- ✅ **Foundation module implemented** → `rework/xln-scheme/core/types.rkt`
- ✅ **Working demo** → `rework/xln-scheme/examples/basic-channel.rkt`
- ✅ Key patterns identified (pendingForward, gossip→routing)
- ✅ TypeScript reference codebase (working system)
- ✅ Smart contracts deployed (Depository, EntityProvider, SubcontractProvider)
- ✅ Frontend visualizer (3D network, time machine)

**Current Status:** Phase 1 started. Core types proven. Next: crypto.rkt, rlp.rkt, merkle.rkt.

**Quick Start:**
```bash
cd rework/xln-scheme
racket examples/basic-channel.rkt  # See homoiconic consensus in action
```

λ.
