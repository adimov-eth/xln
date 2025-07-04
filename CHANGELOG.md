# Changelog

## v1.4.1-RC2

### Implementation

- **Full v1.4.1-RC2 spec integration**: Updated codebase to implement XLN v1.4.1-RC2 Unified Technical Specification
- Added `ServerFrame` type for global state timeline tracking
- Renamed `ServerTx` to `ServerMetaTx` to avoid governance operation collisions (Y-1)
- Implemented canonical transaction sorting algorithm: nonce → sender → kind → index (Y-2)
- Updated frame hashing to use `keccak256(rlp(header ‖ txs))` (R-1)
- Changed `postState` to `postStateRoot` in Frame structure (A4)
- Added `FrameHeader` to `proposeFrame` command (A2)
- Ensured all timestamps use `bigint` type (A7)
- Added `msgHash` to `InboxMessage` and optional `channelId` to `AccountInput` (A6)

### Documentation

- Updated `/docs/spec.md` with complete v1.4.1-RC2 specification
- Aligned all documentation files with v1.4.1-RC2 types and terminology
- Added Y-67 edge case documentation for message mis-routing
- Updated data model documentation with new server-level types
- Enhanced consensus documentation with frame lifecycle details

## v1.4

### Documentation

- **Major documentation overhaul**: Complete rewrite of `/docs` to align with XLN v1.3 Unified Technical Specification
- Restructured documentation into 16 sections mirroring the spec structure
- Added comprehensive TypeScript code examples linked to actual implementation
- Migrated historical design documents to `/archive` for provenance
- No breaking code changes

## v0.4.0-alpha

- Refactored `hashFrame` to use zero-copy hex encoding via `bytesToHex` from `@noble/hashes`.
- Added golden-vector tests for `hashFrame`.
- Protocol hash changed; old network snapshots are incompatible.
