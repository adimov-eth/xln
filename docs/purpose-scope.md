# Purpose & Scope

## What is XLN?

XLN (Cross-Ledger Network) is a minimal-viable distributed ledger system that reimagines blockchain architecture through hierarchical autonomous state machines. It represents the convergence of years of research into scalable consensus mechanisms and practical deployment experience.

## In Scope

This specification covers the pure business logic of the XLN network:

- **Server → Signer → Entity Stack**: The three-level hierarchy that forms the backbone of XLN
- **State Persistence Rules**: How data is stored, snapshotted, and recovered
- **Message/Consensus Flow**: The lifecycle of transactions from submission to finality
- **Deterministic Execution**: Guarantees that enable audit-grade replay
- **Frame-based Architecture**: Block-like structures at the entity level

## Out of Scope

The following are explicitly excluded from this specification:

- **Cryptography Primitives**: BLS signatures, hash functions (use standard libraries)
- **Networking Adapters**: libp2p, WebSocket, HTTP transports
- **Access Control Layers**: Authentication, authorization mechanisms
- **Jurisdiction Details**: On-chain smart contract implementations
- **Channel Layer**: Two-party state channels (documented for context only)

## Design Philosophy

XLN emerges from several key insights:

1. **Not Everything Needs Global Consensus**: Most transactions only need agreement between involved parties
2. **Pure Functions Enable Reasoning**: Side-effect-free code is easier to test, audit, and scale
3. **Hierarchies Match Reality**: Organizations naturally form hierarchical structures
4. **Local Sovereignty Matters**: Participants should control their own data

## Target Use Cases

XLN is optimized for:

- **High-Frequency Trading**: Sub-second finality for financial applications
- **Organizational Governance**: Multi-signature entities with flexible quorums
- **Micropayments**: Bilateral channels for streaming payments
- **Cross-Jurisdiction Assets**: Unified interface across multiple blockchains

## Non-Goals

XLN explicitly does not attempt to:

- Replace existing Layer 1 blockchains
- Provide anonymous transactions
- Support arbitrary smart contracts
- Achieve perfect decentralization

## Relationship to Other Systems

- **vs. Rollups**: XLN entities are sovereign, not subordinate to L1
- **vs. Lightning**: Generalized state channels, not payment-specific
- **vs. Cosmos**: Hierarchical rather than hub-and-spoke
- **vs. State Channels**: Multi-party entities, not just bilateral

## Success Metrics

The design succeeds if:

1. Single-server MVP can process 10,000+ TPS
2. Multi-entity systems achieve linear scaling
3. Crash recovery completes in < 1 minute
4. Audit replay matches original execution 100%

## Document Scope

This documentation set provides:

- Complete technical specification
- Implementation guidelines
- Security analysis
- Performance targets
- Migration paths

It does not include:

- Business case analysis
- Token economics
- Legal/regulatory guidance
- Marketing materials

For the technical architecture, continue to [Design Principles](./design-principles.md).