# Glossary

Quick reference for XLN terminology.

## Core Terms

| Term | Definition |
|------|------------|
| **Input** | RLP envelope `[signerIdx, entityId, command]` |
| **Command** | `importEntity \| addTx \| proposeFrame \| signFrame \| commitFrame` |
| **Transaction (EntityTx)** | Signed atomic state mutation |
| **Frame** | Ordered batch of txs + post-state snapshot |
| **Hanko** | 48-byte BLS aggregate signature proving quorum approval |
| **Replica** | In-memory copy of an Entity under a specific signer |
| **ServerFrame** | Batch of Inputs processed in one tick + new global Merkle root |
| **Snapshot** | Last serialized state of every replica |
| **CAS blob** | Immutable, content-addressed store of historic frames |
| **Channel frame** | Off-chain batch inside a two-party channel (phase 2) |

## Architecture Terms

| Term | Definition |
|------|------------|
| **Entity** | Autonomous state machine with its own consensus |
| **Signer** | Private/public key pair participant |
| **Quorum** | Set of signers required for entity consensus |
| **Server** | Root coordinator processing inputs every 100ms |
| **Jurisdiction** | External blockchain for disputes and collateral |
| **Outbox** | Queue of messages from one entity to another |
| **Mempool** | Pool of pending transactions |

## Consensus Terms

| Term | Definition |
|------|------------|
| **Proposer** | Signer responsible for creating frames |
| **Validator** | Signer that verifies and signs proposals |
| **BFT** | Byzantine Fault Tolerant - survives malicious actors |
| **Finality** | Point when transaction cannot be reversed |
| **Height** | Sequential counter for blocks in a chain |
| **Threshold** | Minimum voting power needed for consensus |

## Storage Terms

| Term | Definition |
|------|------------|
| **WAL** | Write-Ahead Log for crash recovery |
| **LevelDB** | Key-value database used for persistence |
| **RLP** | Recursive Length Prefix encoding |
| **Merkle Root** | Cryptographic summary of all state |
| **Content Addressing** | Storage by hash rather than location |

## Security Terms

| Term | Definition |
|------|------------|
| **Nonce** | Number used once to prevent replay attacks |
| **Byzantine** | Arbitrarily malicious behavior |
| **Honest Majority** | Assumption that >50% of participants are honest |
| **Double Spend** | Attempting to spend the same funds twice |
| **Fork** | Competing versions of history |

## Performance Terms

| Term | Definition |
|------|------------|
| **TPS** | Transactions Per Second |
| **Tick** | 100ms server processing cycle |
| **Latency** | Time from submission to finality |
| **Throughput** | Total processing capacity |
| **Linear Scaling** | Performance grows proportionally with resources |

## Protocol Terms

| Term | Definition |
|------|------------|
| **Pure Function** | Function with no side effects |
| **Reducer** | Function that transforms state based on input |
| **Deterministic** | Same input always produces same output |
| **Fractal Interface** | Same pattern repeated at different scales |
| **State Machine** | System that transitions between defined states |

## Implementation Terms

| Term | Definition |
|------|------------|
| **MVP** | Minimum Viable Product |
| **libp2p** | Peer-to-peer networking library |
| **BLS12-381** | Pairing-friendly elliptic curve |
| **Keccak-256** | Hash function (Ethereum's SHA3) |
| **TypeScript** | Typed JavaScript used for implementation |

## Business Terms

| Term | Definition |
|------|------------|
| **DAO** | Decentralized Autonomous Organization |
| **Credit Line** | Bilateral trust relationship replacing collateral |
| **HTLC** | Hashed Time-Lock Contract for atomic swaps |
| **Hub** | Entity that routes payments between others |
| **Liquidity** | Available funds for transaction settlement |

## Comparison Terms

| Term | XLN Context | Traditional Context |
|------|-------------|---------------------|
| **Block** | Frame (entity-level) | Global ledger update |
| **Node** | Signer/Replica | Full blockchain node |
| **Smart Contract** | Entity logic | On-chain program |
| **Layer 2** | Not applicable | Rollup or state channel |
| **Gas** | No fees in XLN | Transaction fee unit |

## Acronyms

| Acronym | Expansion |
|---------|-----------|
| **XLN** | Cross-Ledger Network |
| **BFT** | Byzantine Fault Tolerant |
| **TPS** | Transactions Per Second |
| **WAL** | Write-Ahead Log |
| **CAS** | Content-Addressed Storage |
| **RLP** | Recursive Length Prefix |
| **HTLC** | Hashed Time-Lock Contract |
| **HSM** | Hardware Security Module |
| **MVP** | Minimum Viable Product |
| **DAO** | Decentralized Autonomous Organization |

## Type Notation

In documentation, we use:
- `Type` for TypeScript types
- `function()` for functions
- `CONSTANT` for constants
- `--flag` for CLI flags
- `/path/` for file paths
- `0x...` for hex values
- `field:` for object fields

## Units

| Unit | Value | Usage |
|------|-------|-------|
| **tick** | 100ms | Server processing cycle |
| **frame** | Variable | Entity block time |
| **bigint** | Unlimited | All numeric values |
| **wei** | 10^-18 | Smallest currency unit |
| **shares** | 1-100 | Voting power percentage |

For detailed type definitions, see [Data Model](./data-model.md).