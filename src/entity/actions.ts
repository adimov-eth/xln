// ============================================================================
// entity/actions.ts - Pure state mutations that read like English
// ============================================================================

import type { Result } from '../types/result.js';
import { Err, Ok } from '../types/result.js';
import type { OutboxMsg } from '../types/state.js';
import type { EntityId } from '../types/primitives.js';
import { id } from '../types/primitives.js';

// ============================================================================
// Action Types - Clear intent and side effects
// ============================================================================

export type Action<TState, TParams> = {
  name: string;
  validate: (state: TState, params: TParams) => Result<TParams>;
  execute: (state: TState, params: TParams) => TState;
  generateMessages?: (entityId: string, params: TParams) => OutboxMsg[];
};

export type ActionResult<TState> = {
  newState: TState;
  messages: OutboxMsg[];
};

// ============================================================================
// Wallet Actions - Money operations
// ============================================================================

export type WalletState = {
  balance: bigint;
  nonce: number;
};

export type TransferParams = {
  to: string;
  amount: bigint;
  from?: string;
};

export type BurnParams = {
  amount: bigint;
};

export type CreditParams = {
  amount: bigint;
  from: string;
};

export const walletActions = {
  transfer: {
    name: 'transfer',
    
    validate: (state: WalletState, params: TransferParams): Result<TransferParams> => {
      if (params.amount <= 0n) {
        return Err('Transfer amount must be positive');
      }
      if (state.balance < params.amount) {
        return Err('Insufficient balance for transfer');
      }
      if (!params.to) {
        return Err('Transfer requires a recipient');
      }
      return Ok(params);
    },
    
    execute: (state: WalletState, params: TransferParams): WalletState => ({
      balance: state.balance - params.amount,
      nonce: state.nonce + 1
    }),
    
    generateMessages: (entityId: EntityId, params: TransferParams): OutboxMsg[] => [{
      from: entityId,
      to: id(params.to),
      command: {
        type: 'addTx',
        tx: {
          op: 'credit',
          data: {
            amount: params.amount.toString(),
            from: entityId.toString(),
            _internal: true
          }
        }
      }
    }]
  },
  
  burn: {
    name: 'burn',
    
    validate: (state: WalletState, params: BurnParams): Result<BurnParams> => {
      if (params.amount <= 0n) {
        return Err('Burn amount must be positive');
      }
      if (state.balance < params.amount) {
        return Err('Insufficient balance to burn');
      }
      return Ok(params);
    },
    
    execute: (state: WalletState, params: BurnParams): WalletState => ({
      balance: state.balance - params.amount,
      nonce: state.nonce + 1
    })
  },
  
  credit: {
    name: 'credit',
    
    validate: (state: WalletState, params: CreditParams): Result<CreditParams> => {
      if (params.amount <= 0n) {
        return Err('Credit amount must be positive');
      }
      if (!params.from) {
        return Err('Credit requires a source');
      }
      return Ok(params);
    },
    
    execute: (state: WalletState, params: CreditParams): WalletState => ({
      balance: state.balance + params.amount,
      nonce: state.nonce + 1
    })
  }
};

// ============================================================================
// DAO Actions - Governance operations
// ============================================================================

export type Initiative = {
  id: string;
  title: string;
  description: string;
  author: number;
  actions: any[];
  votes: Map<number, boolean>;
  status: 'active' | 'passed' | 'rejected' | 'executed';
  createdAt: number;
  executedAt?: number;
};

export type DaoState = WalletState & {
  initiatives: Map<string, Initiative>;
  memberCount: number;
  voteThreshold: number;
};

export type CreateInitiativeParams = {
  title: string;
  description: string;
  author: number;
  actions: any[];
};

export type VoteParams = {
  initiativeId: string;
  support: boolean;
  voter: number;
};

export type ExecuteInitiativeParams = {
  initiativeId: string;
  actions: any[];
};

export const daoActions = {
  createInitiative: {
    name: 'createInitiative',
    
    validate: (state: DaoState, params: CreateInitiativeParams): Result<CreateInitiativeParams> => {
      if (!params.title) {
        return Err('Initiative requires a title');
      }
      if (!params.description) {
        return Err('Initiative requires a description');
      }
      if (!params.actions || params.actions.length === 0) {
        return Err('Initiative requires at least one action');
      }
      return Ok(params);
    },
    
    execute: (state: DaoState, params: CreateInitiativeParams): DaoState => {
      const initiativeId = generateInitiativeId(state);
      const initiative: Initiative = {
        id: initiativeId,
        title: params.title,
        description: params.description,
        author: params.author,
        actions: params.actions,
        votes: new Map(),
        status: 'active',
        createdAt: Date.now()
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
      
      if (!initiative) {
        return Err('Initiative not found');
      }
      if (initiative.status !== 'active') {
        return Err('Can only vote on active initiatives');
      }
      if (initiative.votes.has(params.voter)) {
        return Err('Already voted on this initiative');
      }
      
      return Ok(params);
    },
    
    execute: (state: DaoState, params: VoteParams): DaoState => {
      const initiatives = new Map(state.initiatives);
      const initiative = initiatives.get(params.initiativeId)!;
      
      // Add the vote
      const newVotes = new Map(initiative.votes);
      newVotes.set(params.voter, params.support);
      
      // Check if initiative passes
      const updatedInitiative = {
        ...initiative,
        votes: newVotes,
        status: checkIfInitiativePasses(newVotes, state.memberCount, state.voteThreshold)
          ? 'passed' as const
          : initiative.status
      };
      
      initiatives.set(params.initiativeId, updatedInitiative);
      
      return {
        ...state,
        initiatives
        // Note: Voting doesn't increment nonce in this implementation
      };
    }
  },
  
  executeInitiative: {
    name: 'executeInitiative',
    
    validate: (state: DaoState, params: ExecuteInitiativeParams): Result<ExecuteInitiativeParams> => {
      const initiative = state.initiatives.get(params.initiativeId);
      
      if (!initiative) {
        return Err('Initiative not found');
      }
      if (initiative.status !== 'passed') {
        return Err('Initiative has not passed');
      }
      
      return Ok(params);
    },
    
    execute: (state: DaoState, params: ExecuteInitiativeParams): DaoState => {
      const initiatives = new Map(state.initiatives);
      const initiative = initiatives.get(params.initiativeId)!;
      
      const executedInitiative = {
        ...initiative,
        status: 'executed' as const,
        executedAt: Date.now()
      };
      
      initiatives.set(params.initiativeId, executedInitiative);
      
      return {
        ...state,
        initiatives,
        nonce: state.nonce + 1
      };
    },
    
    generateMessages: (entityId: EntityId, params: ExecuteInitiativeParams): OutboxMsg[] => {
      // Queue the initiative's actions for execution
      return params.actions.map(action => ({
        from: entityId,
        to: entityId,
        command: {
          type: 'addTx' as const,
          tx: action
        }
      }));
    }
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

const generateInitiativeId = (state: DaoState): string => {
  return `init-${state.initiatives.size + 1}`;
};

const checkIfInitiativePasses = (
  votes: Map<number, boolean>,
  memberCount: number,
  threshold: number
): boolean => {
  const supportVotes = Array.from(votes.values()).filter(v => v).length;
  const supportPercentage = (supportVotes / memberCount) * 100;
  return supportPercentage >= threshold;
};

// ============================================================================
// Action Execution Helper
// ============================================================================

export const executeAction = <TState, TParams>(
  action: Action<TState, TParams>,
  state: TState,
  params: TParams,
  entityId: EntityId
): Result<ActionResult<TState>> => {
  // Validate parameters
  const validation = action.validate(state, params);
  if (!validation.ok) {
    return Err(validation.error);
  }
  
  // Execute the action
  const newState = action.execute(state, validation.value);
  
  // Generate any messages
  const messages = action.generateMessages
    ? action.generateMessages(entityId, validation.value)
    : [];
  
  return Ok({ newState, messages });
};