/**
 * Tests for state-helpers.ts — pure state management utilities.
 * No BrowserVM needed: tests cover canonicalAccountKey, getAccountPerspective,
 * addMessage/addMessages, cloneAccountMachine, cloneEntityState.
 * resolveEntityProposerId requires Env so we build a minimal stub.
 */

import { describe, expect, test } from 'bun:test';
import type { EntityState, AccountMachine, Env, EntityReplica } from '../types';
import type { EntityId, TokenId, AccountKey, SignerId, LockId } from '../ids';
import {
  canonicalAccountKey,
  getAccountPerspective,
  addMessage,
  addMessages,
  cloneAccountMachine,
  resolveEntityProposerId,
} from '../state-helpers';

// ─── Test Entity IDs ─────────────────────────────────────────────────────────
const LEFT = ('0x' + '0'.repeat(63) + '1') as EntityId;
const RIGHT = ('0x' + '0'.repeat(63) + '2') as EntityId;
const THIRD = ('0x' + '0'.repeat(63) + '3') as EntityId;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAccountMachine(overrides?: Partial<AccountMachine>): AccountMachine {
  return {
    leftEntity: LEFT,
    rightEntity: RIGHT,
    mempool: [],
    currentFrame: {
      height: 0,
      timestamp: 0,
      jHeight: 0,
      accountTxs: [],
      prevFrameHash: '0x00',
      stateHash: '0x00',
      tokenIds: [],
      deltas: [],
    },
    deltas: new Map(),
    locks: new Map() as Map<LockId, any>,
    swapOffers: new Map(),
    globalCreditLimits: { ownLimit: 0n, peerLimit: 0n },
    currentHeight: 0,
    rollbackCount: 0,
    leftJObservations: [],
    rightJObservations: [],
    jEventChain: [],
    lastFinalizedJHeight: 0,
    proofHeader: { fromEntity: LEFT, toEntity: RIGHT, cooperativeNonce: 0, disputeNonce: 0 },
    proofBody: { tokenIds: [], deltas: [] },
    disputeConfig: { leftDisputeDelay: 10, rightDisputeDelay: 10 },
    onChainSettlementNonce: 0,
    frameHistory: [],
    pendingWithdrawals: new Map(),
    requestedRebalance: new Map() as Map<TokenId, bigint>,
    ...overrides,
  } as AccountMachine;
}

function makeEntityState(overrides?: Partial<EntityState>): EntityState {
  return {
    entityId: LEFT,
    height: 0,
    timestamp: 1000,
    nonces: new Map() as Map<SignerId, number>,
    messages: [],
    proposals: new Map(),
    config: {
      mode: 'proposer-based',
      threshold: 1n,
      validators: ['signer-1'],
      shares: { 'signer-1': 1n },
    },
    reserves: new Map(),
    accounts: new Map() as Map<AccountKey, AccountMachine>,
    lastFinalizedJHeight: 0,
    jBlockObservations: [],
    jBlockChain: [],
    htlcRoutes: new Map(),
    htlcFeesEarned: 0n,
    swapBook: new Map(),
    lockBook: new Map(),
    orderbookExt: {
      books: new Map(),
      referrals: new Map(),
      hubProfile: { supportedPairs: [] },
    },
    ...overrides,
  } as EntityState;
}

// ═══════════════════════════════════════════════════════════════════════════════
// canonicalAccountKey
// ═══════════════════════════════════════════════════════════════════════════════

describe('canonicalAccountKey', () => {
  test('left:right when left < right', () => {
    const key = canonicalAccountKey(LEFT, RIGHT);
    expect(key).toBe(`${LEFT}:${RIGHT}`);
  });

  test('same result when reversed (commutativity)', () => {
    const key1 = canonicalAccountKey(LEFT, RIGHT);
    const key2 = canonicalAccountKey(RIGHT, LEFT);
    expect(key1).toBe(key2);
  });

  test('different pairs produce different keys', () => {
    const key1 = canonicalAccountKey(LEFT, RIGHT);
    const key2 = canonicalAccountKey(LEFT, THIRD);
    expect(key1).not.toBe(key2);
  });

  test('always puts smaller entity first', () => {
    const key = canonicalAccountKey(THIRD, LEFT);
    expect(key.startsWith(LEFT)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getAccountPerspective
// ═══════════════════════════════════════════════════════════════════════════════

describe('getAccountPerspective', () => {
  test('LEFT perspective: iAmLeft=true, to=counterparty', () => {
    const account = makeAccountMachine();
    const p = getAccountPerspective(account, LEFT);
    expect(p.iAmLeft).toBe(true);
    expect(p.from).toBe(LEFT);
    expect(p.to).toBe(RIGHT);
    expect(p.counterparty).toBe(RIGHT);
  });

  test('RIGHT perspective: iAmLeft=false, to=counterparty', () => {
    const account = makeAccountMachine();
    const p = getAccountPerspective(account, RIGHT);
    expect(p.iAmLeft).toBe(false);
    expect(p.from).toBe(RIGHT);
    expect(p.to).toBe(LEFT);
    expect(p.counterparty).toBe(LEFT);
  });

  test('to === counterparty invariant', () => {
    const account = makeAccountMachine();
    const leftP = getAccountPerspective(account, LEFT);
    const rightP = getAccountPerspective(account, RIGHT);
    expect(leftP.to).toBe(leftP.counterparty);
    expect(rightP.to).toBe(rightP.counterparty);
  });

  test('from + to cover both entities', () => {
    const account = makeAccountMachine();
    const p = getAccountPerspective(account, LEFT);
    const entities = new Set([p.from, p.to]);
    expect(entities.has(LEFT)).toBe(true);
    expect(entities.has(RIGHT)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// addMessage / addMessages
// ═══════════════════════════════════════════════════════════════════════════════

describe('addMessage', () => {
  test('appends message to state', () => {
    const state = makeEntityState();
    addMessage(state, 'hello');
    expect(state.messages).toEqual(['hello']);
  });

  test('preserves message order', () => {
    const state = makeEntityState();
    addMessage(state, 'first');
    addMessage(state, 'second');
    addMessage(state, 'third');
    expect(state.messages).toEqual(['first', 'second', 'third']);
  });

  test('enforces MESSAGE_LIMIT=10 — drops oldest', () => {
    const state = makeEntityState();
    for (let i = 0; i < 12; i++) {
      addMessage(state, `msg-${i}`);
    }
    expect(state.messages).toHaveLength(10);
    // Oldest two (msg-0, msg-1) should be gone
    expect(state.messages[0]).toBe('msg-2');
    expect(state.messages[9]).toBe('msg-11');
  });

  test('exactly at limit keeps all', () => {
    const state = makeEntityState();
    for (let i = 0; i < 10; i++) {
      addMessage(state, `msg-${i}`);
    }
    expect(state.messages).toHaveLength(10);
    expect(state.messages[0]).toBe('msg-0');
  });
});

describe('addMessages', () => {
  test('adds multiple messages', () => {
    const state = makeEntityState();
    addMessages(state, ['a', 'b', 'c']);
    expect(state.messages).toEqual(['a', 'b', 'c']);
  });

  test('enforces limit across batch', () => {
    const state = makeEntityState();
    const msgs = Array.from({ length: 15 }, (_, i) => `msg-${i}`);
    addMessages(state, msgs);
    expect(state.messages).toHaveLength(10);
    expect(state.messages[0]).toBe('msg-5');
  });

  test('empty array is noop', () => {
    const state = makeEntityState();
    addMessage(state, 'existing');
    addMessages(state, []);
    expect(state.messages).toEqual(['existing']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// cloneAccountMachine
// ═══════════════════════════════════════════════════════════════════════════════

describe('cloneAccountMachine', () => {
  test('clone equals original', () => {
    const account = makeAccountMachine();
    const clone = cloneAccountMachine(account);
    expect(clone.leftEntity).toBe(account.leftEntity);
    expect(clone.rightEntity).toBe(account.rightEntity);
    expect(clone.currentHeight).toBe(account.currentHeight);
  });

  test('clone is independent — mutations do not propagate', () => {
    const account = makeAccountMachine({
      mempool: [{ type: 'add_delta', data: { tokenId: 1 } }],
    });
    const clone = cloneAccountMachine(account);
    clone.mempool.push({ type: 'add_delta', data: { tokenId: 2 } });
    expect(account.mempool).toHaveLength(1);
    expect(clone.mempool).toHaveLength(2);
  });

  test('delta Map is deeply cloned', () => {
    const account = makeAccountMachine();
    account.deltas.set(1 as TokenId, {
      tokenId: 1 as TokenId,
      collateral: 100n,
      ondelta: 50n,
      offdelta: 0n,
      leftCreditLimit: 1000n,
      rightCreditLimit: 1000n,
      leftAllowance: 0n,
      rightAllowance: 0n,
    });
    const clone = cloneAccountMachine(account);
    const clonedDelta = clone.deltas.get(1 as TokenId);
    expect(clonedDelta).toBeDefined();
    expect(clonedDelta!.collateral).toBe(100n);

    // Mutate clone
    clonedDelta!.collateral = 999n;
    expect(account.deltas.get(1 as TokenId)!.collateral).toBe(100n);
  });

  test('forSnapshot=true strips clonedForValidation', () => {
    const innerClone = makeAccountMachine();
    const account = makeAccountMachine({
      proposal: {
        pendingFrame: {
          height: 1,
          timestamp: 1000,
          jHeight: 0,
          accountTxs: [],
          prevFrameHash: '0x00',
          stateHash: '0x00',
          tokenIds: [],
          deltas: [],
        },
        pendingSignatures: ['0xsig'],
        pendingAccountInput: {
          type: 'settlement',
          fromEntityId: LEFT,
          toEntityId: RIGHT,
          settleAction: { type: 'propose', diffs: [], version: 1 },
        },
        clonedForValidation: innerClone,
      },
    });

    const snapshot = cloneAccountMachine(account, true);
    expect(snapshot.proposal).toBeDefined();
    expect(snapshot.proposal!.clonedForValidation).toBeUndefined();
  });

  test('settlement workspace is cloned', () => {
    const account = makeAccountMachine({
      settlementWorkspace: {
        diffs: [{ tokenId: 1, leftDiff: 100n, rightDiff: -100n, collateralDiff: 0n, ondeltaDiff: 0n }],
        forgiveTokenIds: [1],
        insuranceRegs: [],
        initiatedBy: 'left',
        status: 'awaiting_counterparty',
        version: 1,
        createdAt: 1000,
        lastUpdatedAt: 1000,
        broadcastByLeft: false,
      },
    });
    const clone = cloneAccountMachine(account);
    expect(clone.settlementWorkspace).toBeDefined();
    expect(clone.settlementWorkspace!.diffs).toHaveLength(1);

    // Mutate clone's workspace
    clone.settlementWorkspace!.diffs[0]!.leftDiff = 999n;
    expect(account.settlementWorkspace!.diffs[0]!.leftDiff).toBe(100n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// resolveEntityProposerId
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveEntityProposerId', () => {
  function makeMinimalEnv(replicas: Map<string, Partial<EntityReplica>>): Env {
    return {
      eReplicas: replicas as Map<string, EntityReplica>,
      gossip: null,
    } as unknown as Env;
  }

  test('returns proposer signerId when replica is proposer', () => {
    const replicas = new Map<string, Partial<EntityReplica>>([
      [
        `${LEFT}:signer-1`,
        {
          entityId: LEFT,
          signerId: 'signer-1',
          isProposer: true,
          state: makeEntityState({
            config: { mode: 'proposer-based', threshold: 1n, validators: ['signer-1'], shares: { 'signer-1': 1n } },
          }),
        },
      ],
    ]);
    const env = makeMinimalEnv(replicas);
    expect(resolveEntityProposerId(env, LEFT, 'test')).toBe('signer-1');
  });

  test('falls back to validators[0] when not proposer', () => {
    const replicas = new Map<string, Partial<EntityReplica>>([
      [
        `${LEFT}:signer-1`,
        {
          entityId: LEFT,
          signerId: 'signer-1',
          isProposer: false,
          state: makeEntityState({
            config: {
              mode: 'proposer-based',
              threshold: 1n,
              validators: ['validator-0'],
              shares: { 'validator-0': 1n },
            },
          }),
        },
      ],
    ]);
    const env = makeMinimalEnv(replicas);
    expect(resolveEntityProposerId(env, LEFT, 'test')).toBe('validator-0');
  });

  test('falls back to signerId when validators empty', () => {
    const replicas = new Map<string, Partial<EntityReplica>>([
      [
        `${LEFT}:signer-1`,
        {
          entityId: LEFT,
          signerId: 'signer-1',
          isProposer: false,
          state: makeEntityState({ config: { mode: 'proposer-based', threshold: 1n, validators: [], shares: {} } }),
        },
      ],
    ]);
    const env = makeMinimalEnv(replicas);
    expect(resolveEntityProposerId(env, LEFT, 'test')).toBe('signer-1');
  });

  test('throws when no replica matches entity', () => {
    const replicas = new Map<string, Partial<EntityReplica>>();
    const env = makeMinimalEnv(replicas);
    expect(() => resolveEntityProposerId(env, LEFT, 'test')).toThrow(/SIGNER_RESOLUTION_FAILED/);
  });

  test('resolves from gossip board (array format)', () => {
    const replicas = new Map<string, Partial<EntityReplica>>();
    const env = {
      eReplicas: replicas,
      gossip: {
        getProfiles: () => [
          {
            entityId: LEFT,
            metadata: { board: ['gossip-signer-0', 'gossip-signer-1'] },
          },
        ],
      },
    } as unknown as Env;
    expect(resolveEntityProposerId(env, LEFT, 'test')).toBe('gossip-signer-0');
  });

  test('resolves from gossip board (object format with signerId)', () => {
    const replicas = new Map<string, Partial<EntityReplica>>();
    const env = {
      eReplicas: replicas,
      gossip: {
        getProfiles: () => [
          {
            entityId: LEFT,
            metadata: { board: { validators: [{ signerId: 'board-signer' }] } },
          },
        ],
      },
    } as unknown as Env;
    expect(resolveEntityProposerId(env, LEFT, 'test')).toBe('board-signer');
  });

  test('prefers proposer replica over gossip', () => {
    const replicas = new Map<string, Partial<EntityReplica>>([
      [
        `${LEFT}:proposer`,
        {
          entityId: LEFT,
          signerId: 'proposer',
          isProposer: true,
          state: makeEntityState(),
        },
      ],
    ]);
    const env = {
      eReplicas: replicas,
      gossip: {
        getProfiles: () => [
          {
            entityId: LEFT,
            metadata: { board: ['gossip-signer'] },
          },
        ],
      },
    } as unknown as Env;
    expect(resolveEntityProposerId(env, LEFT, 'test')).toBe('proposer');
  });
});
