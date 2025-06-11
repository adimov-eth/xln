# XLN Code Organization Strategy

## Directory Structure

```
xln/
├── core/                    # Pure business logic
│   ├── types/              # Type definitions
│   │   ├── entity.ts       # Entity-specific types
│   │   ├── server.ts       # Server-specific types
│   │   ├── consensus.ts    # Consensus types
│   │   └── index.ts        # Re-exports
│   │
│   ├── entity/             # Entity operations
│   │   ├── state.ts        # State transitions
│   │   ├── mempool.ts      # Mempool management
│   │   ├── blocks.ts       # Block operations
│   │   └── index.ts
│   │
│   ├── server/             # Server operations
│   │   ├── state.ts        # Server state management
│   │   ├── routing.ts      # Message routing
│   │   ├── hash.ts         # Hashing utilities
│   │   └── index.ts
│   │
│   ├── consensus/          # Consensus mechanisms
│   │   ├── quorum.ts       # Quorum logic
│   │   ├── voting.ts       # Voting mechanisms
│   │   └── index.ts
│   │
│   └── protocols/          # Business protocols
│       ├── mint.ts         # Minting protocol
│       ├── transfer.ts     # Transfer protocol
│       └── index.ts
│
├── effects/                # Side effects & I/O
│   ├── persistence/        # Storage layer
│   │   ├── types.ts
│   │   ├── leveldb.ts
│   │   ├── wal.ts
│   │   └── snapshots.ts
│   │
│   ├── network/           # Network communication
│   │   ├── p2p.ts
│   │   ├── rpc.ts
│   │   └── sync.ts
│   │
│   └── crypto/            # Cryptographic operations
│       ├── signing.ts
│       ├── verification.ts
│       └── hash.ts
│
├── runtime/               # Runtime orchestration
│   ├── server.ts         # Main server loop
│   ├── config.ts         # Configuration
│   └── metrics.ts        # Performance monitoring
│
├── testing/              # Test utilities
│   ├── fixtures/         # Test data
│   ├── generators/       # Property-based test generators
│   └── helpers/          # Test helpers
│
└── examples/             # Example implementations
    ├── wallet/           # Simple wallet entity
    ├── dao/              # Multi-sig DAO
    └── dex/              # Decentralized exchange
```

## Core Design Principles

### 1. Strict Layering

```typescript
// core/types/entity.ts
export type EntityTx<T = unknown> = {
  readonly op: string;
  readonly data: T;
};

// core/types/state.ts
export type StateTransition<S, I> = (state: S, input: I) => S;

// effects/persistence/types.ts
export type StorageAdapter = {
  readonly put: (key: string, value: unknown) => Promise<void>;
  readonly get: <T>(key: string) => Promise<T>;
};
```

### 2. Protocol Composition

```typescript
// core/protocols/base.ts
export type Protocol<S, T> = {
  readonly name: string;
  readonly validate: (tx: EntityTx<T>) => boolean;
  readonly apply: (state: S, data: T) => S;
};

// core/protocols/mint.ts
export type MintData = {
  readonly amount: bigint;
};

export const mintProtocol: Protocol<WalletState, MintData> = {
  name: 'mint',
  validate: (tx) => tx.data.amount > 0n,
  apply: (state, data) => ({
    ...state,
    balance: state.balance + data.amount
  })
};

// core/protocols/index.ts
export const composeProtocols = <S>(
  protocols: Protocol<S, any>[]
): StateTransition<S, EntityTx> => {
  const protocolMap = new Map(
    protocols.map(p => [p.name, p])
  );
  
  return (state, tx) => {
    const protocol = protocolMap.get(tx.op);
    if (!protocol || !protocol.validate(tx)) return state;
    return protocol.apply(state, tx.data);
  };
};
```

### 3. Functional Builders

```typescript
// core/entity/builder.ts
export type EntityConfig<S> = {
  readonly initialState: S;
  readonly protocols: Protocol<S, any>[];
  readonly hooks?: {
    readonly beforeBlock?: (state: S) => S;
    readonly afterBlock?: (state: S) => S;
  };
};

export const createEntity = <S>(
  config: EntityConfig<S>
): EntityOperations<S> => {
  const applyTx = composeProtocols(config.protocols);
  
  return {
    applyInput: (entity, input, outbox) => 
      applyEntityInput(entity, input, applyTx, config.hooks, outbox),
    
    validateTx: (tx) => {
      const protocol = config.protocols.find(p => p.name === tx.op);
      return protocol?.validate(tx) ?? false;
    }
  };
};
```

### 4. Effect Isolation

```typescript
// effects/persistence/adapter.ts
export type PersistenceConfig = {
  readonly stateDB: StorageAdapter;
  readonly walDB: StorageAdapter;
  readonly blockDB: StorageAdapter;
};

export const createPersistence = (
  config: PersistenceConfig
): PersistenceOperations => ({
  saveSnapshot: async (server) => {
    // Implementation
  },
  
  logTransaction: async (height, tx) => {
    await config.walDB.put(
      `${height}:${tx.signer}:${tx.entityId}`,
      tx
    );
  },
  
  restore: async () => {
    // Implementation
  }
});

// runtime/server.ts
export const createServer = (deps: {
  persistence: PersistenceOperations;
  network?: NetworkOperations;
}) => {
  return {
    run: async (initialState: ServerState) => {
      let state = initialState;
      
      while (true) {
        await sleep(100);
        
        if (state.mempool.length > 0) {
          const newState = applyServerBlock(state);
          
          // Effects happen outside pure functions
          await deps.persistence.logTransaction(
            newState.height,
            state.mempool
          );
          
          state = newState;
        }
      }
    }
  };
};
```

### 5. Type-Safe Message Handling

```typescript
// core/types/messages.ts
export type MessageType = 
  | 'add_tx'
  | 'propose_block'
  | 'commit_block'
  | 'sync_request'
  | 'vote';

export type Message<T extends MessageType, D> = {
  readonly type: T;
  readonly data: D;
};

export type MessageHandler<S, T extends MessageType, D> = 
  (state: S, msg: Message<T, D>) => S;

// core/server/messages.ts
export const createMessageRouter = <S>(
  handlers: Map<MessageType, MessageHandler<S, any, any>>
): StateTransition<S, Message<any, any>> => {
  return (state, msg) => {
    const handler = handlers.get(msg.type);
    return handler ? handler(state, msg) : state;
  };
};
```

### 6. Testing Organization

```typescript
// testing/generators/entity.ts
import { fc } from '@fast-check/fast-check';

export const arbEntityTx = fc.oneof(
  fc.record({
    op: fc.constant('mint'),
    data: fc.record({
      amount: fc.bigInt({ min: 0n })
    })
  }),
  fc.record({
    op: fc.constant('transfer'),
    data: fc.record({
      to: fc.string(),
      amount: fc.bigInt({ min: 0n })
    })
  })
);

// testing/properties/determinism.ts
export const deterministicProperty = fc.property(
  arbServerState,
  arbEntityTx,
  (state, tx) => {
    const result1 = applyTx(state, tx);
    const result2 = applyTx(state, tx);
    return computeHash(result1) === computeHash(result2);
  }
);
```

### 7. Feature Modules

```typescript
// features/consensus/types.ts
export type ConsensusFeature = {
  readonly onPropose: (entity: EntityState) => EntityState;
  readonly onVote: (entity: EntityState, vote: Vote) => EntityState;
  readonly onCommit: (entity: EntityState) => EntityState;
};

// features/consensus/tendermint.ts
export const tendermintConsensus = (
  config: TendermintConfig
): ConsensusFeature => ({
  onPropose: (entity) => {
    // Tendermint-specific proposal logic
  },
  onVote: (entity, vote) => {
    // Vote collection
  },
  onCommit: (entity) => {
    // Finalization
  }
});
```

### 8. Configuration Management

```typescript
// runtime/config.ts
export type XLNConfig = {
  readonly server: {
    readonly tickMs: number;
    readonly snapshotInterval: number;
  };
  readonly consensus: {
    readonly type: 'single' | 'tendermint' | 'raft';
    readonly timeout: number;
  };
  readonly persistence: {
    readonly path: string;
    readonly compression: boolean;
  };
};

export const loadConfig = (
  env: NodeJS.ProcessEnv
): XLNConfig => ({
  server: {
    tickMs: parseInt(env.XLN_TICK_MS ?? '100'),
    snapshotInterval: parseInt(env.XLN_SNAPSHOT_INTERVAL ?? '100')
  },
  // ...
});
```

## Best Practices

### 1. **Use Branded Types**
```typescript
type EntityId = string & { readonly _brand: 'EntityId' };
type SignerIdx = number & { readonly _brand: 'SignerIdx' };

const toEntityId = (s: string): EntityId => s as EntityId;
const toSignerIdx = (n: number): SignerIdx => n as SignerIdx;
```

### 2. **Compose Small Functions**
```typescript
const pipe = <T>(...fns: Array<(x: T) => T>) => 
  (x: T) => fns.reduce((v, f) => f(v), x);

const processEntity = pipe(
  validateQuorum,
  applyPendingTxs,
  checkConsensus,
  finalizeBlock
);
```

### 3. **Use Opaque Types for State**
```typescript
export type OpaqueState<T> = {
  readonly _type: T;
  readonly _data: unknown;
};

export const createState = <T>(
  type: T,
  data: unknown
): OpaqueState<T> => ({ _type: type, _data: data });
```

### 4. **Separate Concerns with Lenses**
```typescript
import { Lens } from 'monocle-ts';

const entityLens = Lens.fromPath<ServerState>()(['signers']);
const mempoolLens = Lens.fromProp<EntityState>()('mempool');

const addToMempool = (tx: EntityTx) => 
  mempoolLens.modify(mp => [...mp, tx]);
```

### 5. **Use Result Types**
```typescript
type Result<T, E> = 
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

const validateAndApply = (
  state: EntityState,
  tx: EntityTx
): Result<EntityState, ValidationError> => {
  const validation = validateTx(tx);
  if (!validation.ok) return validation;
  
  return { 
    ok: true, 
    value: applyTx(state, tx) 
  };
};
```

## Migration Strategy

1. **Start with core types** - Move all types to dedicated modules
2. **Extract pure functions** - Separate business logic from effects
3. **Create protocol registry** - Implement extensible protocol system
4. **Add feature flags** - Enable gradual feature rollout
5. **Implement adapters** - Abstract external dependencies
6. **Add property tests** - Ensure invariants hold during refactoring

This organization will keep your codebase maintainable as XLN grows!


1. Strict Layer Separation

core/ - Pure business logic with no side effects

effects/ - All I/O, persistence, and network operations

runtime/ - Orchestration that combines core + effects

2. Protocol-Based Extensibility

Instead of growing your transaction handler into a massive switch statement, use a protocol registry:

// Define protocols independently
const protocols = [
  mintProtocol,
  transferProtocol,
  stakeProtocol,
  governanceProtocol
];

// Compose them into a single handler
const entityLogic = composeProtocols(protocols);


3. Feature Isolation

Each major feature (consensus, accounts, routing) gets its own module with a clear interface:

// features/accounts/index.ts
export type AccountsFeature = {
  readonly createAccount: (...) => Account;
  readonly updateBalance: (...) => Account;
  readonly settleDispute: (...) => Resolution;
};


4. Type Safety at Boundaries

Use branded types and Result types to catch errors at compile time:

type Valid<T> = T & { readonly _valid: true };

const validate = <T>(
  value: T,
  rules: ValidationRule<T>[]
): Result<Valid<T>, ValidationError> => {
  // Validation logic
};


Practical Next Steps:

Start Small: Begin by extracting your types into a proper module structure

Create Adapters: Wrap LevelDB operations in an adapter interface

Build Protocol Registry: Convert your applyTxs to use the protocol pattern

Add Property Tests: Use fast-check to verify invariants

Implement Feature Flags: Allow enabling/disabling features at runtime

