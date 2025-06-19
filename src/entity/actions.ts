import type { EntityId, SignerIdx } from '../types/primitives.js';
import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { EntityTx, OutboxMsg } from '../types/state.js';

// ============================================================================
// Action Types - Clear intent and side effects
// ============================================================================

export type Action<TState, TParams> = {
  name: string;
  validate: (state: TState, params: TParams) => Result<TParams>;
  execute: (state: TState, params: TParams) => TState;
  generateMessages?: (entityId: EntityId, params: TParams) => OutboxMsg[];
};

export type ActionResult<TState> = {
  newState: TState;
  messages: OutboxMsg[];
};

// ============================================================================
// Wallet Actions - Money operations
// ============================================================================

export type WalletState = {
  readonly balance: bigint;
  readonly nonce: number;
};

export type TransferParams = {
  readonly to: EntityId;
  readonly amount: bigint;
};

export type BurnParams = {
  readonly amount: bigint;
};

export type CreditParams = {
  readonly amount: bigint;
  readonly from: EntityId;
};

export const walletActions = {
  transfer: {
    name: 'transfer',
    
    validate: (state: WalletState, params: TransferParams): Result<TransferParams> => {
      if (params.amount <= 0n) return Err('Transfer amount must be positive');
      if (state.balance < params.amount) return Err('Insufficient balance for transfer');
      if (!params.to) return Err('Transfer requires a recipient');
      return Ok(params);
    },
    
    execute: (state: WalletState, params: TransferParams): WalletState => ({
      ...state,
      balance: state.balance - params.amount,
      nonce: state.nonce + 1
    }),
    
    generateMessages: (entityId: EntityId, params: TransferParams): OutboxMsg[] => [{
      from: entityId,
      to: params.to,
      command: {
        type: 'addTx',
        tx: {
          op: 'credit',
          data: {
            amount: params.amount.toString(),
            from: entityId,
            _internal: true
          }
        }
      }
    }]
  },
  
  burn: {
    name: 'burn',
    
    validate: (state: WalletState, params: BurnParams): Result<BurnParams> => {
      if (params.amount <= 0n) return Err('Burn amount must be positive');
      if (state.balance < params.amount) return Err('Insufficient balance to burn');
      return Ok(params);
    },
    
    execute: (state: WalletState, params: BurnParams): WalletState => ({
      ...state,
      balance: state.balance - params.amount,
      nonce: state.nonce + 1
    })
  },
  
  credit: {
    name: 'credit',
    
    validate: (state: WalletState, params: CreditParams): Result<CreditParams> => {
      if (params.amount <= 0n) return Err('Credit amount must be positive');
      if (!params.from) return Err('Credit requires a source');
      return Ok(params);
    },
    
    execute: (state: WalletState, params: CreditParams): WalletState => ({
      ...state,
      balance: state.balance + params.amount
    })
  }
};

// ============================================================================
// DAO Actions - Governance operations
// ============================================================================

export type Initiative = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly author: SignerIdx;
  readonly actions: readonly EntityTx[];
  readonly votes: ReadonlyMap<SignerIdx, boolean>;
  readonly status: 'active' | 'passed' | 'rejected' | 'executed';
};

export type DaoState = WalletState & {
  readonly initiatives: ReadonlyMap<string, Initiative>;
  readonly memberCount: number;
  readonly voteThreshold: number; // Percentage
};

export type CreateInitiativeParams = {
  readonly title: string;
  readonly description: string;
  readonly author: SignerIdx;
  readonly actions: readonly EntityTx[];
};

export type VoteParams = {
  readonly initiativeId: string;
  readonly support: boolean;
  readonly voter: SignerIdx;
};

export type ExecuteInitiativeParams = {
  readonly initiativeId: string;
  readonly actions: readonly EntityTx[];
};

export const daoActions = {
  createInitiative: {
    name: 'createInitiative',
    
    validate: (_state: DaoState, params: CreateInitiativeParams): Result<CreateInitiativeParams> => {
      if (!params.title) return Err('Initiative requires a title');
      if (!params.description) return Err('Initiative requires a description');
      if (!params.actions || params.actions.length === 0) return Err('Initiative requires at least one action');
      return Ok(params);
    },
    
    execute: (state: DaoState, params: CreateInitiativeParams): DaoState => {
      const initiativeId = generateInitiativeId(state);
      const initiative: Initiative = {
        id: initiativeId,
        ...params,
        votes: new Map(),
        status: 'active'
      };
      
      const newInitiatives = new Map(state.initiatives);
      newInitiatives.set(initiativeId, initiative);
      
      return {
        ...state,
        initiatives: newInitiatives,
        nonce: state.nonce + 1
      };
    }
  },
  
  vote: {
    name: 'vote',
    
    validate: (state: DaoState, params: VoteParams): Result<VoteParams> => {
      const initiative = state.initiatives.get(params.initiativeId);
      if (!initiative) return Err('Initiative not found');
      if (initiative.status !== 'active') return Err('Can only vote on active initiatives');
      if (initiative.votes.has(params.voter)) return Err('Already voted on this initiative');
      return Ok(params);
    },
    
    execute: (state: DaoState, params: VoteParams): DaoState => {
      const initiatives = new Map(state.initiatives);
      const initiative = initiatives.get(params.initiativeId)!;
      
      const newVotes = new Map(initiative.votes);
      newVotes.set(params.voter, params.support);
      
      const newStatus = checkIfInitiativePasses(newVotes, state.memberCount, state.voteThreshold)
        ? 'passed' as const
        : 'active' as const;
        
      const updatedInitiative: Initiative = { ...initiative, votes: newVotes, status: newStatus };
      initiatives.set(params.initiativeId, updatedInitiative);
      
      return { ...state, initiatives };
    }
  },
  
  executeInitiative: {
    name: 'executeInitiative',
    
    validate: (state: DaoState, params: ExecuteInitiativeParams): Result<ExecuteInitiativeParams> => {
      const initiative = state.initiatives.get(params.initiativeId);
      if (!initiative) return Err('Initiative not found');
      if (initiative.status !== 'passed') return Err('Initiative has not passed');
      
      // Update nonces for the actions to be executed
      let nextNonce = state.nonce + 1;
      const updatedActions = params.actions.map(action => ({
        ...action,
        nonce: nextNonce++
      }));
      
      return Ok({ ...params, actions: updatedActions });
    },
    
    execute: (state: DaoState, params: ExecuteInitiativeParams): DaoState => {
      const initiatives = new Map(state.initiatives);
      const initiative = initiatives.get(params.initiativeId)!;
      
      const executedInitiative: Initiative = { ...initiative, status: 'executed' };
      initiatives.set(params.initiativeId, executedInitiative);
      
      return { ...state, initiatives, nonce: state.nonce + 1 };
    },
    
    generateMessages: (entityId: EntityId, params: ExecuteInitiativeParams): OutboxMsg[] => {
      return params.actions.map(tx => {
        // Route to target entity for transfers, otherwise back to self
        const targetEntity = tx.op === 'transfer' && tx.data?.to ? tx.data.to : entityId;
        
        // For transfers, generate a credit transaction for the target
        if (tx.op === 'transfer' && tx.data?.to) {
          const creditTx = {
            op: 'credit',
            data: {
              amount: tx.data.amount.toString(),
              from: entityId,
              _internal: true
            }
            // No nonce for credit transactions
          };
          return {
            from: entityId,
            to: targetEntity,
            command: { type: 'addTx', tx: creditTx }
          };
        }
        
        // For other actions, send to self
        return {
          from: entityId,
          to: targetEntity,
          command: { type: 'addTx', tx }
        };
      });
    }
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

const generateInitiativeId = (state: DaoState): string => `init-${state.nonce}-${state.initiatives.size}`;

const checkIfInitiativePasses = (
  votes: ReadonlyMap<SignerIdx, boolean>,
  memberCount: number,
  threshold: number
): boolean => {
  const supportVotes = Array.from(votes.values()).filter(v => v).length;
  if (memberCount === 0) return false;
  // Use integer arithmetic to avoid floating point: supportVotes * 100 >= memberCount * threshold
  return supportVotes * 100 >= memberCount * threshold;
};