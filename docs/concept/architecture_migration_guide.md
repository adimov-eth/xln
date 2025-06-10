# XLN Architecture Migration Guide

## What Changed: 4-Layer → 3-Layer Architecture

This guide helps developers understand the key changes in XLN's architecture simplification.

## Before vs After

### OLD Architecture (4 Layers)
```
Server
  └── Signer (machine)
        └── Entity  
              └── Account
```

### NEW Architecture (3 Layers)  
```
Server
  └── Entity
        └── Account
```

## Key Changes Summary

| Aspect | OLD | NEW |
|--------|-----|-----|
| **Signer Concept** | Separate state machine | Organizational grouping + key derivation |
| **Data Structure** | `signers: SignerState[]` | `signers: EntityState[][]` |
| **Transaction Routing** | Server → Signer → Entity | Server → Entity (direct) |
| **Processing Pipeline** | 4 machine layers | 3 machine layers |
| **Complexity** | Higher | Lower |

## Detailed Changes

### 1. Signer Machine Removal

**OLD:**
```typescript
type SignerState = Map<string, EntityState>;
type ServerState = {
  signers: SignerState[];
  mempool: ServerInput[];
};

function applyServerInput(state: ServerState, input: ServerInput) {
  const signer = state.signers[input.signer];
  // Signer machine processing...
  signer.processEntity(input.entityId, input.entityInput);
}
```

**NEW:**
```typescript
type ServerState = {
  height: number;
  signers: EntityState[][];  // Direct array access
  mempool: ServerTx[];
};

function applyServerTx(state: ServerState, tx: ServerTx) {
  // Direct entity access - no Signer machine
  const entity = state.signers[tx.signerIndex][tx.entityIndex];
  const updated = applyEntityInput(entity, tx.input);
  state.signers[tx.signerIndex][tx.entityIndex] = updated;
}
```

### 2. Transaction Structure Changes

**OLD:**
```typescript
type ServerInput = 
  | { type: 'import_entity'; signer: number; entityId: string; ... }
  | { type: 'entity_input'; signer: number; entityId: string; input: EntityInput };
```

**NEW:**
```typescript
type ServerTx = {
  signerIndex: number;   // Direct index access
  entityIndex: number;   // Direct index access  
  input: EntityInput;    // No intermediate routing
};
```

### 3. Processing Pipeline Simplification

**OLD Flow:**
1. `ServerInput` → Server machine
2. Server routes to Signer machine by `signer` index
3. Signer machine routes to Entity by `entityId`
4. Entity processes `EntityInput`

**NEW Flow:**
1. `ServerTx` → Server (router only)
2. Server routes directly to Entity by `[signerIndex][entityIndex]`
3. Entity processes `EntityInput`

## What "Signer" Means Now

### Conceptual Change

**OLD Understanding:**
- Signer = Separate state machine that manages entities
- Has its own consensus and processing logic
- Intermediate layer between Server and Entity

**NEW Understanding:**
- Signer = Cryptographic identity + organizational grouping
- Key derivation index for generating private keys
- Logical container for related entities
- **NOT** a processing unit or state machine

### Practical Example

**OLD:**
```typescript
// Signer as machine
const signer = new SignerMachine(index);
signer.addEntity(entityId, entityState);
signer.processInput(entityInput);
```

**NEW:**
```typescript
// Signer as organizational grouping
const signerIndex = 0;  // Key derivation index
const entityIndex = 0;  // Position in signer's entity array
state.signers[signerIndex][entityIndex] = entityState;
```

## Code Migration Examples

### File Structure Changes

**OLD:**
```
src/
  server.ts     // Server machine
  signer.ts     // Signer machine  
  entity.ts     // Entity machine
  account.ts    // Account machine
```

**NEW:**
```
src/
  server.ts     // Server routing + state management
  entity.ts     // Entity machine (unchanged)
  account.ts    // Account machine (unchanged)
  // signer.ts deleted - no longer needed
```

### Function Signature Changes

**OLD:**
```typescript
function processEntityInput(
  signerState: SignerState,
  entityId: string, 
  input: EntityInput
): SignerState

function applySignerInput(
  signer: SignerState,
  input: SignerInput  
): SignerState
```

**NEW:**
```typescript
function applyEntityInput(
  entity: EntityState,
  input: EntityInput
): EntityState

// No signer-level processing functions needed
```

## Benefits of the Change

### Reduced Complexity
- ❌ **Removed**: Signer machine state management
- ❌ **Removed**: Signer-level consensus logic  
- ❌ **Removed**: Entity ID → Entity mapping in signers
- ❌ **Removed**: Intermediate routing layer

### Improved Performance
- ✅ **Direct access**: `signers[i][j]` instead of map lookups
- ✅ **Fewer allocations**: No intermediate Signer objects
- ✅ **Simpler processing**: One less machine layer to traverse

### Better Mental Model
- ✅ **Clearer semantics**: Signer as identity, not processor
- ✅ **Easier debugging**: Fewer layers to trace through
- ✅ **Simpler testing**: Fewer integration points

## Common Migration Patterns

### Pattern 1: Entity Access

**OLD:**
```typescript
const signer = serverState.signers[signerIndex];
const entity = signer.get(entityId);
```

**NEW:**
```typescript
const entity = serverState.signers[signerIndex][entityIndex];
```

### Pattern 2: Entity Updates

**OLD:**
```typescript
const signer = serverState.signers[signerIndex];
const entity = signer.get(entityId);
const updated = applyEntityInput(entity, input);
signer.set(entityId, updated);
```

**NEW:**
```typescript
const entity = serverState.signers[signerIndex][entityIndex];
const updated = applyEntityInput(entity, input);
serverState.signers[signerIndex][entityIndex] = updated;
```

### Pattern 3: Iteration

**OLD:**
```typescript
for (const signer of serverState.signers) {
  for (const [entityId, entity] of signer) {
    // Process entity
  }
}
```

**NEW:**
```typescript
for (const [signerIndex, entities] of serverState.signers.entries()) {
  for (const [entityIndex, entity] of entities.entries()) {
    // Process entity
  }
}
```

## Things That Didn't Change

- **Entity machine logic**: All entity processing remains the same
- **Account machine logic**: All account processing remains the same  
- **Consensus rules**: Entity consensus and quorum logic unchanged
- **Storage strategy**: LevelDB, snapshots, and persistence unchanged
- **Functional approach**: Pure functions and immutable updates maintained

## Potential Issues During Migration

### 1. Entity ID Resolution
**Problem**: Old code relies on `entityId` strings for lookups  
**Solution**: Use `entityIndex` in array, or maintain separate ID→index mapping if needed

### 2. Dynamic Entity Addition
**Problem**: Old code used `signer.set(entityId, entity)` for dynamic addition  
**Solution**: Use array methods like `push()` or maintain entity registry

### 3. Signature Generation
**Problem**: Old code had signer-specific key management  
**Solution**: Derive keys using `deriveSignerKey(masterSecret, signerIndex)`

## Validation Checklist

- [ ] Removed all `SignerMachine` or `SignerState` references
- [ ] Updated `ServerInput` → `ServerTx` naming
- [ ] Changed entity access from map lookup to array index
- [ ] Updated processing pipeline to skip signer layer
- [ ] Verified entity and account logic unchanged
- [ ] Updated tests to reflect new data structures
- [ ] Checked that key derivation works with `signerIndex`

## Questions?

If you encounter issues during migration or need clarification on the architectural changes, refer to:
- `docs/concept/architecture_summary.md` - Current architecture overview
- `docs/concept/architecture_notes.md` - Detailed technical notes
- Meeting transcripts in `docs/concept/meetings.md` - Original discussions

The key principle: **Signer is now a tool, not a machine.** 