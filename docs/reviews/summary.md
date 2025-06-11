## Core Architecture (Unanimous Agreement)

### 1. **Hierarchical Machine Model**
```
Server (router/runtime)
  └── Signer (participant namespace/key management)
      └── Entity (DAO/wallet/hub with consensus)
          └── Channel (bilateral relationships)
```

### 2. **Fundamental Principles**
| Principle | Description | Consistency |
|-----------|-------------|-------------|
| **Sovereign Isolation** | Each machine maintains independent state | ✅ Consistent |
| **Message-Passing Only** | Actor model with inbox/outbox pattern | ✅ Consistent |
| **Single Proposer** | First signer in quorum, no rounds | ✅ Consistent |
| **Credit Over Collateral** | Paradigm shift from locked liquidity | ✅ Consistent |
| **Pure Functional Core** | No classes, deterministic execution | ✅ Consistent |
| **100ms Processing Cycle** | Server tick frequency | ✅ Consistent |

### 3. **Storage & Persistence Strategy**
- **In-memory first**: Everything loads at startup
- **LevelDB persistence**: 
  - `/entity_state/` - Snapshots
  - `/entity_blocks/` - Entity block history
  - `/server_blocks/` - Server block WAL
- **Lazy hashing**: Nulled on mutation, computed on flush

## Healthy Evolution Points

### 1. **From Generic to Specialized Machines**
- **Early**: "All machines identical with 2 in/out ports"
- **Final**: Specialized roles (Server=router, Entity=logic, Channel=bilateral)
- **Impact**: Better separation of concerns

### 2. **Consensus Simplification**
- **Early**: Full Tendermint-like complexity considered
- **Final**: Single proposer, no prevote, 67% threshold
- **Impact**: Dramatic complexity reduction

### 3. **Entity-Jurisdiction Binding**
- **Early**: Entities might span jurisdictions
- **Final**: One entity = one jurisdiction
- **Impact**: Cleaner regulatory model

## Priority Issues & Resolutions

### 🔴 **Critical (Address Immediately)**

1. **Terminology Standardization**
   - **Issue**: "Account" vs "Channel" inconsistency - RESOLVED
   - **Resolution**: Standardized on "Channel" for bilateral payment channels
   - **Action**: ✅ Created comprehensive glossary and updated all documentation

2. **RLP Schema Specification**
   - **Issue**: No canonical serialization defined
   - **Resolution**: Follow Ethereum's RLP with UTF-8 strings
   - **Action**: Document exact field ordering and encoding

3. **Signer Machine Clarification**
   - **Issue**: Machine vs namespace confusion
   - **Resolution**: Signer is a participant's self-sovereign entry point, not just a key
   - **Action**: Document as primary participant machine managing entity participation

### 🟡 **Important (Post-MVP)**

4. **EntityDirectory & Peer Discovery**
   - **Current**: "Gossip protocol" placeholder
   - **MVP**: Hardcoded directory entries
   - **Future**: Signed directory as its own Entity

5. **Transaction Validation**
   - **Current**: No validation
   - **MVP**: Skip for now
   - **Future**: Ethereum-inspired validation pipeline

6. **Error Handling**
   - **Current**: Basic LevelDB recovery
   - **MVP**: Acceptable for prototype
   - **Future**: Comprehensive failure modes

### 🟢 **Deferred (Acknowledged Limitations)**

7. **Mempool Management**
   - **Status**: Explicitly skipped for MVP
   - **Risk**: Accepted for controlled testing

8. **Multi-Server Architecture**
   - **Status**: Single-server simulation sufficient
   - **Future**: Distribution strategy needed

9. **Security/Signatures**
   - **Status**: Postponed after core logic
   - **Approach**: Pure business logic first

## Implementation Priorities (Per Guidance)

### Phase 1: Core Logic (Current)
1. Server & Entity machines only
2. Skip Channels entirely
3. Single-signer entities (personal wallets)
4. No signatures or security
5. Simulated networking via inbox/outbox loops

### Phase 2: Persistence & Recovery
1. LevelDB integration complete
2. WAL for server transactions
3. State snapshots every N blocks
4. Basic crash recovery

### Phase 3: Consensus & Multi-Signer
1. Implement quorum validation
2. Add signature verification
3. Multi-signer entity support

### Phase 4: Channels & Credits
1. Bilateral channel implementation
2. Credit line mechanics
3. Depositary dispute handling

## Key Clarifications Made

1. **Synchronization Question**: Refers to entity state catch-up when signers join/recover
2. **Invalid Transactions**: Ignored in MVP, validation pipeline for later
3. **Self-Routing**: Outbox → Mempool loop enables internal reactivity
4. **No Empty Blocks**: Confirmed design decision
5. **ServerHash**: Test/diagnostic only, never broadcast

## Architectural Strengths

- **Simplicity**: "Kalashnikov rifle" approach pays dividends
- **Isolation**: Prevents most distributed systems issues
- **Determinism**: Pure functions enable easy testing/debugging
- **Flexibility**: Can run without real networking
- **Clear Boundaries**: Core vs extensions well-defined

## Conclusion

The XLN vision successfully challenges blockchain orthodoxy while maintaining internal consistency. The progression from abstract concepts to concrete implementation follows sound engineering principles. Minor terminology issues are easily resolved and don't affect the core architecture.

**The system is ready for MVP implementation** following the phased approach outlined above.