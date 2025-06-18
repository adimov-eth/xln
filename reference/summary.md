# XLN: Technical Architecture and Legal Framework

## What XLN Actually Is

XLN is a distributed ledger system that uses hierarchical state machines instead of global consensus. Each participant runs their own server that maintains local state for entities they care about. The system achieves consistency through message passing and localized consensus mechanisms.

The key difference from traditional blockchains: participants only store and validate data for entities they directly interact with, not the entire network's transactions.

## Core Architecture

### Three-Level Hierarchy

1. **Servers**: Root machines that route messages and coordinate state
2. **Signers**: Account representations that hold signing authority  
3. **Entities**: Business logic containers (wallets, DAOs, or service providers)

Each entity can have multiple signers (like multiple signatories on a bank account). Each signer maintains a complete replica of the entity's state.

### How State Replication Works

When an entity has multiple signers:
- Each signer maintains an identical copy of entity state
- Changes require consensus among signers (majority or supermajority)
- State updates propagate through message passing
- Consensus happens locally within the entity, not globally

## Transaction Flow

### Single-Signer Entities (Personal Wallets)
1. User submits transaction to their signer
2. Transaction executes immediately
3. State updates locally
4. No consensus required

### Multi-Signer Entities (DAOs)
1. Any signer can propose transactions
2. Proposer creates a block containing transactions
3. Other signers receive and validate the proposal
4. With sufficient signatures (typically 2/3+), block commits
5. All signers update their local state

### Cross-Entity Transactions
1. Sender entity executes transaction locally
2. Generates message for receiver entity
3. Message routes through server infrastructure
4. Receiver entity processes when ready
5. No atomic guarantees across entities (similar to bank transfers)

## Consensus Mechanism

XLN uses a simplified Byzantine Fault Tolerant consensus within each entity:

- **Proposer Selection**: Deterministic round-robin based on block height
- **Block Creation**: Proposer packages pending transactions
- **Voting**: Other signers approve/reject the block
- **Finality**: 2/3+ signatures required for commitment
- **Timeout**: 30-second timeout prevents deadlock

This is similar to Tendermint but without the pre-vote phase, making it simpler but potentially less robust against certain attack vectors.

## Security Model

### What XLN Provides
- **Replay Protection**: Via nonce tracking
- **State Integrity**: Through deterministic state hashing
- **Crash Recovery**: Write-ahead logging and snapshots
- **Byzantine Tolerance**: Within entity quorums (2/3+ honest assumption)

### What XLN Doesn't Provide
- **Global Consensus**: No network-wide agreement
- **Trustless Operation**: Requires choosing trustworthy counterparties
- **Atomic Cross-Entity Transactions**: Currently no two-phase commit
- **Slashing**: No automatic punishment for misbehavior

### Trust Assumptions
- Within an entity: Standard BFT assumptions (2/3+ honest)
- Between entities: Trust-based (like correspondent banking)
- Server level: Currently assumes honest operation

## State Persistence

The system uses three storage layers:

1. **Memory**: Primary working state
2. **Write-Ahead Log**: Durability for crash recovery
3. **Snapshots**: Periodic state checkpoints

Recovery process:
1. Load latest snapshot
2. Replay WAL entries
3. Resume normal operation

## Comparison to Traditional Blockchains

### What's Similar
- Deterministic state machines
- Cryptographic hashing
- Block-based history
- Byzantine fault tolerance (within entities)

### What's Different
- No global mempool
- No mining or global consensus
- No forced data replication
- No gas fees (transaction costs determined by entities)
- 100ms block times (vs 12+ seconds)

## Legal and Regulatory Aspects

### Entity Structure
- Entities function similarly to legal entities (corporations, partnerships)
- Signers act like board members or authorized representatives
- Quorum rules mirror corporate governance
- Clear authorization chains for all actions

### Audit and Compliance
- Complete transaction history per entity
- Deterministic state recreation
- Clear counterparty identification
- Jurisdictional binding (entities declare their legal jurisdiction)

### Limitations
- No built-in privacy (unless added at protocol level)
- Operator liability unclear (servers might be seen as service providers)
- Cross-jurisdictional enforcement relies on traditional legal systems

## Technical Completeness

The current implementation includes:

### Implemented
- Hierarchical state machine architecture
- Single and multi-signer consensus
- WAL-based crash recovery
- Deterministic state hashing
- Basic wallet protocol (transfer, burn, credit)
- Message routing between entities

### Not Implemented
- Cryptographic signatures
- Network layer (currently single-process simulation)
- Cross-jurisdictional bridges
- Dispute resolution mechanisms
- Order matching (for hub entities)
- State synchronization protocols

## Why This Architecture

The design makes specific tradeoffs:

### Advantages
- **Performance**: 100ms finality for local consensus
- **Scalability**: Linear with number of entities, not transactions
- **Efficiency**: Only store/compute what you participate in
- **Flexibility**: Entities can implement custom rules

### Disadvantages
- **No Global Truth**: Different entities may have inconsistent views
- **Trust Required**: Must choose counterparties carefully
- **Limited Atomicity**: No cross-entity atomic operations
- **Centralization Risk**: Entities controlled by their signers

## Practical Implications

For a payment from Alice to Bob through a Hub:

1. Alice has account with Hub (local state)
2. Bob has account with Hub (separate local state)
3. Alice authorizes payment (updates her entity state)
4. Hub processes (updates internal ledger)
5. Hub credits Bob (updates Bob's entity state)
6. No global verification required

This is architecturally similar to traditional banking but with cryptographic proofs and automated settlement.

## Conclusion

XLN is a pragmatic system that trades global consensus for local efficiency. It's "complete" in that it provides the necessary primitives for a functioning ledger system: state machines, consensus, persistence, and message passing.

The model works well for scenarios where:
- Participants have existing trust relationships
- Speed matters more than global verifiability  
- Privacy is important
- Costs need to be predictable

It's less suitable when:
- Trustless operation is required
- Global consistency is critical
- Regulatory framework demands public verifiability
- Complex atomic multi-party transactions are common

The architecture represents a different point in the design space - closer to traditional financial systems than to Bitcoin, but with cryptographic verifiability and automated execution.