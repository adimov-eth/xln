import { type Decoded, RLP } from '@ethereumjs/rlp';

export type EntityState = {
  readonly value: number;
};

export type EntityTx = {
  readonly op: 'create' | 'increment';
  readonly amount?: number;
};


export function createInitialState(): EntityState {
  return { value: 0 };
}


export function executeTx(state: EntityState, tx: EntityTx): EntityState {
  switch (tx.op) {
    case 'create':
      return createInitialState();
    
    case 'increment':
      const increment = tx.amount ?? 1;
      return {
        ...state,
        value: state.value + increment,
      };
      
    default:
      return state;
  }
}

export function executeBlock(state: EntityState, txs: readonly EntityTx[]): EntityState {
  let currentState = txs[0]?.op === 'create' ? executeTx(state, txs[0]) : state;
  
  for (const tx of txs.slice(1)) {
    currentState = executeTx(currentState, tx);
  }
  return currentState;
}

export const encodeState = (state: EntityState): Buffer => {
  return Buffer.from(RLP.encode([state.value]));
};

export const decodeState = (data: Buffer): EntityState => {
  if (data.length === 0) {
    return createInitialState();
  }
  const decodedItems = RLP.decode(data) as unknown as Decoded[];
  
  if (Array.isArray(decodedItems) && decodedItems.length > 0 && decodedItems[0] instanceof Uint8Array) {
    const valueBuffer = Buffer.from(decodedItems[0]);
    const value = valueBuffer.length > 0 ? valueBuffer.readUIntBE(0, valueBuffer.length) : 0;
    return { value };
  }
  
  return createInitialState();
};

export const encodeTx = (tx: EntityTx): Buffer => {
  const opBuffer = Buffer.from(tx.op);
  if (tx.op === 'increment') {
    const amountBuffer = Buffer.alloc(4);
    amountBuffer.writeUInt32BE(tx.amount ?? 1);
    return Buffer.from(RLP.encode([opBuffer, amountBuffer]));
  }
  return Buffer.from(RLP.encode([opBuffer]));
};

export const decodeTx = (data: Buffer): EntityTx => {
  const decoded = RLP.decode(data) as unknown as Buffer[];
  const op = decoded[0]?.toString() as EntityTx['op'];
  const amountBuffer = decoded[1];
  if (op === 'increment' && amountBuffer) {
    const amount = amountBuffer.readUInt32BE(0);
    return { op, amount };
  }
  return { op };
};