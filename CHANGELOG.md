# Changelog

## v0.4.0-alpha

- Refactored `hashFrame` to use zero-copy hex encoding via `bytesToHex` from `@noble/hashes`.
- Added golden-vector tests for `hashFrame`.
- Protocol hash changed; old network snapshots are incompatible.
