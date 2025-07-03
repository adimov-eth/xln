# XLN Documentation

## Overview

XLN (Cross-Ledger Network) is a pure-function, Merkle-anchored ledger that scales linearly by sharding state into Entities and Channels. It reimagines blockchain architecture through hierarchical autonomous state machines, replacing traditional Layer 2 solutions with a Jurisdiction → Entity → Account model.

## Quick Links

[![API Docs](https://img.shields.io/badge/API-TypeDoc-blue)](/api/)
[![Changelog](https://img.shields.io/badge/Changelog-v1.3-green)](../CHANGELOG.md)
[![Walkthrough](https://img.shields.io/badge/Demo-Hello_Chat-orange)](./walkthrough.md)

## Documentation Structure

This documentation is organized to mirror the XLN v1.3 Unified Technical Specification:

### Core Concepts

1. [Purpose & Scope](./purpose-scope.md) - What XLN is and isn't
2. [Design Principles](./design-principles.md) - Pure functions, fractal interfaces, and more
3. [Layered Architecture](./layered-architecture.md) - Server → Signer → Entity → Channel

### Technical Reference

4. [Data Model](./data-model.md) - TypeScript type definitions and structures
5. [Consensus](./consensus.md) - Frame lifecycle and Byzantine fault tolerance
6. [Persistence](./persistence.md) - Storage architecture and replay mechanisms
7. [Hashing](./hashing.md) - Merkle roots and cryptographic primitives
8. [Security](./security.md) - Threat model and mitigations

### Implementation

9. [Performance](./performance.md) - Scalability targets and benchmarks
10. [Configuration](./configuration.md) - Runtime parameters and defaults
11. [Wire Protocol & RPC](./wire-rpc.md) - Network encoding and message formats
12. [Edge Cases](./edge-cases.md) - Known limitations and workarounds

### Getting Started

13. [Walkthrough](./walkthrough.md) - Step-by-step "hello chat" example
14. [API Reference](/api/) - Auto-generated TypeScript documentation

### Project Information

15. [Roadmap](./roadmap.md) - Development milestones
16. [Glossary](./glossary.md) - Key terms and definitions

## Additional Resources

- [Architecture Overview](./architecture.md) - Visual system overview
- [Data Flow](./data-flow.md) - Transaction lifecycle
- [Threat Model](./threat-model.md) - Security analysis

## Contributing

See our [Development Guide](../CLAUDE.md) for coding standards and contribution guidelines.
