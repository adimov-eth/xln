# Example State

## Server State

```typescript
import type {
  ServerState,
  EntityState,
  EntityMeta,
  ServerTx,
  EntityTx,
  DirectTx,
  OutboxTx
} from './core/types';
import {
  height,
  signerIdx,
  entityId,
  blockHash
} from './core/types/primitives';

// Example application-specific state shape
type WalletState = {
  readonly balance: bigint;
  readonly nonce: number;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Entity States for each signer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Signer 0 - Personal wallet (single-signer)
const aliceWallet: EntityState = {
  tag: 'Idle',
  height: height(42),
  state: {
    balance: 1000000n,
    nonce: 15
  } satisfies WalletState,
  mempool: [
    { tag: 'Transfer', to: entityId('bob-wallet'), amount: 50000n },
    { tag: 'Transfer', to: entityId('hub'), amount: 100000n }
  ] satisfies readonly EntityTx[]
};

// Signer 0 - Also participates in a multi-sig DAO
const daoEntity: EntityState = {
  tag: 'Proposed',
  height: height(41),
  state: {
    balance: 5000000n,
    nonce: 3
  } satisfies WalletState,
  proposal: {
    txs: [
      { tag: 'Transfer', to: entityId('alice-wallet'), amount: 500000n }
    ],
    hash: blockHash('a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890'),
    timestamp: Date.now() - 30000 // 30 seconds ago
  }
};

// Signer 1 - Personal wallet with pending mint
const bobWallet: EntityState = {
  tag: 'Idle',
  height: height(43),
  state: {
    balance: 750000n,
    nonce: 8
  } satisfies WalletState,
  mempool: [
    { tag: 'Mint', amount: 200000n }
  ] satisfies readonly EntityTx[]
};

// Signer 1 - Payment hub entity
const hubEntity: EntityState = {
  tag: 'Committing',
  height: height(43),
  state: {
    balance: 10000000n,
    nonce: 127
  } satisfies WalletState,
  block: {
    txs: [
      { tag: 'Transfer', to: entityId('carol-wallet'), amount: 25000n },
      { tag: 'Transfer', to: entityId('alice-wallet'), amount: 75000n }
    ],
    hash: blockHash('deadbeef12345678901234567890123456789012345678901234567890fedcba'),
    timestamp: Date.now() - 5000,
    height: height(44)
  }
};

// Signer 2 - Personal wallet (empty mempool)
const carolWallet: EntityState = {
  tag: 'Idle',
  height: height(40),
  state: {
    balance: 300000n,
    nonce: 2
  } satisfies WalletState,
  mempool: []
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Entity Metadata (stored separately from state in real implementation)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const entityMetas: Record<string, EntityMeta> = {
  'alice-wallet': {
    id: entityId('alice-wallet'),
    quorum: [signerIdx(0)] // Single-signer
  },
  'dao': {
    id: entityId('dao'),
    quorum: [signerIdx(0), signerIdx(1), signerIdx(2)] // Multi-sig (all 3 signers)
  },
  'bob-wallet': {
    id: entityId('bob-wallet'),
    quorum: [signerIdx(1)] // Single-signer
  },
  'hub': {
    id: entityId('hub'),
    quorum: [signerIdx(1)] // Hub controlled by signer 1
  },
  'carol-wallet': {
    id: entityId('carol-wallet'),
    quorum: [signerIdx(2)] // Single-signer
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Server-level pending transactions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const serverMempool: readonly ServerTx[] = [
  // Direct transaction from signer 0 to propose a block on alice-wallet
  {
    tag: 'DirectTx',
    signer: signerIdx(0),
    entityId: entityId('alice-wallet'),
    input: { tag: 'ProposeBlock' }
  } satisfies DirectTx,
  
  // Signer 1 voting to commit the DAO proposal
  {
    tag: 'DirectTx',
    signer: signerIdx(1),
    entityId: entityId('dao'),
    input: {
      tag: 'CommitBlock',
      hash: blockHash('a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890')
    }
  } satisfies DirectTx,
  
  // Outbox message from hub to carol's wallet (inter-entity communication)
  {
    tag: 'OutboxTx',
    from: entityId('hub'),
    toEntity: entityId('carol-wallet'),
    toSigner: signerIdx(2),
    input: {
      tag: 'AddTx',
      tx: { tag: 'Mint', amount: 50000n }
    }
  } satisfies OutboxTx,
  
  // Carol adding a burn transaction
  {
    tag: 'DirectTx',
    signer: signerIdx(2),
    entityId: entityId('carol-wallet'),
    input: {
      tag: 'AddTx',
      tx: { tag: 'Burn', amount: 10000n }
    }
  } satisfies DirectTx
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Complete Server State
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const exampleServerState: ServerState = {
  tag: 'Running',
  height: height(100), // Server at block 100
  entities: new Map([
    // Signer 0's entities
    [entityId('alice-wallet'), aliceWallet],
    [entityId('dao'), daoEntity],
    
    // Signer 1's entities  
    [entityId('bob-wallet'), bobWallet],
    [entityId('hub'), hubEntity],
    
    // Signer 2's entities
    [entityId('carol-wallet'), carolWallet]
  ]),
  mempool: serverMempool
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper to visualize state
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function printServerState(state: ServerState): void {
  console.log(`Server State [${state.tag}] at height ${state.height}`);
  console.log(`Mempool: ${state.mempool.length} pending transactions\n`);
  
  // Group entities by signer for visualization
  const signerEntities = new Map<number, Array<[string, EntityState]>>();
  
  state.entities.forEach((entity, id) => {
    const meta = entityMetas[id];
    if (!meta) return;
    
    meta.quorum.forEach(signer => {
      if (!signerEntities.has(signer)) {
        signerEntities.set(signer, []);
      }
      signerEntities.get(signer)!.push([id, entity]);
    });
  });
  
  // Print by signer
  for (let i = 0; i < 3; i++) {
    console.log(`Signer ${i}:`);
    const entities = signerEntities.get(i) || [];
    
    entities.forEach(([id, entity]) => {
      const walletState = entity.state as WalletState;
      console.log(`  ${id} [${entity.tag}]`);
      console.log(`    Height: ${entity.height}, Balance: ${walletState.balance}`);
      
      if (entity.tag === 'Idle' && entity.mempool.length > 0) {
        console.log(`    Mempool: ${entity.mempool.length} txs`);
      } else if (entity.tag === 'Proposed') {
        console.log(`    Proposal: ${entity.proposal.txs.length} txs`);
      } else if (entity.tag === 'Committing') {
        console.log(`    Committing: block ${entity.block.height}`);
      }
    });
    console.log();
  }
}

// Example usage:
// printServerState(exampleServerState);

export { exampleServerState };

```