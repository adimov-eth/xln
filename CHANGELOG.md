# Changelog

## v1.3

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
