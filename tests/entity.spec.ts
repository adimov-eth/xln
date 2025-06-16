import { applyCmd, formatError, validateCmd } from '../src/core/entity';
import { createEntity } from '../src/core/server';
import type { EntityMeta, EntityState, EntityTx } from '../src/types';
import { toBlockHash, toBlockHeight, toEntityId, toSignerIdx } from '../src/types/primitives';

// Helper to assert entity is in Idle state
function assertIdle<T>(state: EntityState<T>): asserts state is EntityState<T> & { tag: 'Idle' } {
  if (state.tag !== 'Idle') {
    throw new Error(`Expected Idle state, got ${state.tag}`);
  }
}

describe('FSM two-phase API', () => {
  const eid = toEntityId('foo');
  const meta: EntityMeta = {
    id: eid,
    quorum: [toSignerIdx(0), toSignerIdx(1)],
    timeoutMs: 1000
  };
  let baseState: EntityState<{ balance: bigint }>;

  beforeEach(() => {
    baseState = createEntity<{ balance: bigint }>(toBlockHeight(0), { balance: 0n });
  });

  describe('validateCmd', () => {
    it('should reject add_tx in non-Idle state', () => {
      assertIdle(baseState); // Ensure baseState is Idle
      const proposedState: EntityState<{ balance: bigint }> = {
        tag: 'Proposed',
        height: baseState.height,
        state: baseState.state,
        mempool: baseState.mempool,
        proposal: {
          txs: [],
          hash: toBlockHash('0x123'),
          approves: new Set(),
          timestamp: Date.now(),
          proposer: toSignerIdx(0)
        },
        lastBlockHash: baseState.lastBlockHash,
        lastProcessedHeight: baseState.lastProcessedHeight
      };

      const result = validateCmd(
        proposedState,
        { type: 'add_tx', tx: { op: 'mint', data: { amount: '1' } } },
        toSignerIdx(0),
        meta
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(formatError(result.error)).toContain('Can only add transactions in Idle');
      }
    });

    it('should reject unauthorized signers', () => {
      const result = validateCmd(
        baseState,
        { type: 'add_tx', tx: { op: 'mint', data: { amount: '10' } } },
        toSignerIdx(99), // Not in quorum
        meta
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('unauthorized');
      }
    });

    it('should accept valid add_tx from authorized signer', () => {
      const result = validateCmd(
        baseState,
        { type: 'add_tx', tx: { op: 'mint', data: { amount: '10' } } },
        toSignerIdx(0),
        meta
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe('AddTx');
      }
    });

    it('should compute hash when validating propose_block', () => {
      assertIdle(baseState);
      const stateWithTxs: EntityState<{ balance: bigint }> = {
        ...baseState,
        mempool: [
          { op: 'mint', data: { amount: '100' } },
          { op: 'burn', data: { amount: '50' } }
        ]
      };

      const result = validateCmd(
        stateWithTxs,
        { type: 'propose_block', txs: stateWithTxs.mempool },
        toSignerIdx(0), // Proposer for height 0
        meta
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe('ProposeBlock');
        if (result.value.type === 'ProposeBlock') {
          expect(result.value.hash).toBeDefined();
          expect(result.value.hash.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('applyCmd', () => {
    it('should add transaction to mempool', () => {
      const validatedCmd = { type: 'AddTx' as const, tx: { op: 'mint', data: { amount: '10' } } as const };
      const [newState, messages] = applyCmd(baseState, validatedCmd, meta);

      if (newState.tag !== 'Faulted' && 'mempool' in newState) {
        expect(newState.mempool).toHaveLength(1);
        expect(newState.mempool[0]).toEqual({ op: 'mint', data: { amount: '10' } });
      }
      expect(messages).toHaveLength(0);
    });

    it('should handle propose_block for single signer', () => {
      const singleSignerMeta: EntityMeta = {
        id: eid,
        quorum: [toSignerIdx(0)], // Single signer
        timeoutMs: 1000
      };

      const txs: EntityTx[] = [{ op: 'mint', data: { amount: '100' } }];
      const hash = toBlockHash('0xabc');

      const validatedCmd = {
        type: 'ProposeBlock' as const,
        txs,
        hash,
        proposer: toSignerIdx(0)
      };

      const [newState, messages] = applyCmd(baseState, validatedCmd, singleSignerMeta);

      // Single signer should go directly to Committing
      expect(newState.tag).toBe('Committing');
      expect(messages).toHaveLength(1);
      expect(messages[0]?.input.type).toBe('commit_block');
    });

    it('should handle propose_block for multi-signer', () => {
      const txs: EntityTx[] = [{ op: 'mint', data: { amount: '100' } }];
      const hash = toBlockHash('0xabc');

      const validatedCmd = {
        type: 'ProposeBlock' as const,
        txs,
        hash,
        proposer: toSignerIdx(0)
      };

      const [newState, messages] = applyCmd(baseState, validatedCmd, meta);

      // Multi-signer should go to Proposed
      expect(newState.tag).toBe('Proposed');
      expect(messages).toHaveLength(1); // Approval request to other signer
      expect(messages[0]?.input.type).toBe('approve_block');
    });

    it('should handle timeout transition back to Idle', () => {
      assertIdle(baseState);
      const proposedState: EntityState<{ balance: bigint }> = {
        tag: 'Proposed',
        height: baseState.height,
        state: baseState.state,
        mempool: baseState.mempool,
        proposal: {
          txs: [{ op: 'mint', data: { amount: '50' } }],
          hash: toBlockHash('0x456'),
          approves: new Set([toSignerIdx(0)]),
          timestamp: Date.now() - 2000, // Old timestamp
          proposer: toSignerIdx(0)
        },
        lastBlockHash: baseState.lastBlockHash,
        lastProcessedHeight: baseState.lastProcessedHeight
      };

      const validatedCmd = { type: 'AddTx' as const, tx: { op: 'burn', data: { amount: '10' } } as const };
      
      // Apply with timeout check
      const [newState] = applyCmd(proposedState, validatedCmd, meta, Date.now());

      // Should transition to Idle and re-queue transactions
      expect(newState.tag).toBe('Idle');
      if (newState.tag === 'Idle') {
        expect(newState.mempool).toHaveLength(2); // Original tx + new tx
      }
    });
  });

  describe('mint + transfer flow', () => {
    it('should handle complete transaction flow', () => {
      // 1) Add a mint transaction
      const v1 = validateCmd(
        baseState,
        { type: 'add_tx', tx: { op: 'mint', data: { amount: '1000' } } },
        toSignerIdx(0),
        meta
      );
      expect(v1.ok).toBe(true);
      if (!v1.ok) return;

      const [s1] = applyCmd(baseState, v1.value, meta);
      if (s1.tag !== 'Faulted' && 'mempool' in s1) {
        expect(s1.mempool).toHaveLength(1);
      }

      // 2) Add a transfer transaction
      const v2 = validateCmd(
        s1,
        { type: 'add_tx', tx: { op: 'transfer', data: { amount: '500', to: 'bar' } } },
        toSignerIdx(1),
        meta
      );
      expect(v2.ok).toBe(true);
      if (!v2.ok) return;

      const [s2] = applyCmd(s1, v2.value, meta);
      if (s2.tag !== 'Faulted' && 'mempool' in s2) {
        expect(s2.mempool).toHaveLength(2);
      }

      // Could continue with block proposal validation...
    });
  });
});