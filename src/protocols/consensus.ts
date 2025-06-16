/**
 * Consensus protocol - handles block proposal and approval logic
 */
import type { 
    EntityTx,
    OutboxMsg,
    EntityId,
    Result
} from '../types';
import { Ok, Err, toEntityId } from '../types';
import type { Protocol } from './types';

export interface ConsensusData {
    readonly transactions: EntityTx[];
}

export const ConsensusProtocol: Protocol<any, ConsensusData> = {
    name: 'consensus',
    
    validateTx(_tx: EntityTx): Result<ConsensusData, string> {
        // Consensus protocol doesn't handle regular transactions
        return Err('Consensus protocol only handles block operations');
    },
    
    applyTx(state: any, data: ConsensusData): Result<any, string> {
        // Apply all transactions in the block
        let newState = state;
        
        for (const tx of data.transactions) {
            const result = applyTransaction(tx, newState);
            if (result.ok) {
                newState = result.value;
            }
        }
        
        return Ok(newState);
    },
    
    generateMessages(entityId: EntityId, data: ConsensusData): readonly OutboxMsg[] {
        const messages: OutboxMsg[] = [];
        
        // Generate messages for transfers
        for (const tx of data.transactions) {
            if (tx.op === 'transfer' && tx.data.to) {
                messages.push({
                    from: entityId,
                    toEntity: toEntityId(tx.data.to),
                    input: {
                        type: 'add_tx',
                        tx: {
                            op: 'credit',
                            data: {
                                amount: tx.data.amount,
                                from: entityId
                            }
                        }
                    }
                });
            }
        }
        
        return messages;
    }
};

// Helper to apply a single transaction
function applyTransaction(tx: EntityTx, state: any): Result<any, string> {
    switch (tx.op) {
        case 'mint':  // Deprecated: use 'credit' instead
        case 'credit':
            if (typeof tx.data.amount === 'string') {
                const amount = BigInt(tx.data.amount);
                return Ok({
                    ...state,
                    balance: (state.balance || 0n) + amount
                });
            }
            return Err('Invalid credit amount');
            
        case 'burn':
            if (typeof tx.data.amount === 'string') {
                const amount = BigInt(tx.data.amount);
                const currentBalance = state.balance || 0n;
                if (currentBalance >= amount) {
                    return Ok({
                        ...state,
                        balance: currentBalance - amount
                    });
                }
                return Err('Insufficient balance');
            }
            return Err('Invalid burn amount');
            
        case 'transfer':
            if (typeof tx.data.amount === 'string' && tx.data.to) {
                const amount = BigInt(tx.data.amount);
                const currentBalance = state.balance || 0n;
                if (currentBalance >= amount) {
                    return Ok({
                        ...state,
                        balance: currentBalance - amount
                    });
                }
                return Err('Insufficient balance');
            }
            return Err('Invalid transfer');
            
        default:
            return Ok(state); // Unknown transaction types are ignored
    }
}

// Export helper for use in entity reducers
export function processBlockTransactions(
    txs: EntityTx[],
    state: any,
    entityId: EntityId
): [any, OutboxMsg[]] {
    const data: ConsensusData = { transactions: txs };
    const result = ConsensusProtocol.applyTx(state, data);
    const newState = result.ok ? result.value : state;
    const messages = ConsensusProtocol.generateMessages?.(entityId, data) || [];
    return [newState, messages as OutboxMsg[]];
}