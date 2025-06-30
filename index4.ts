
export type Hex      = `0x${string}`;
export type Address  = Hex;
export type UInt64   = bigint;
export type TS       = number;          // ms since Unix-epoch



export interface SignerMeta {
    address: Address;
    shares: number;
}

export interface Quorum {
    threshold: number;
    members:  SignerMeta[];
}


// transactions
export const enum TxKind { Chat = 'chat' }

export interface BaseTx<K extends TxKind = TxKind> {
   kind: K;
   nonce: UInt64;
   from: Address;
   body: unknown;
   sig: Hex;
}

export type ChatTx    = BaseTx<TxKind.Chat> & { body: { message: string } };
export type Transaction = ChatTx;

// frames
export interface Frame<T = unknown> {
    height: UInt64;
    ts: TS;
    txs:  Transaction[];
    state: T;
  }
  
  export interface ProposedFrame<T = unknown> extends Frame<T> {
    sigs: Map<Address, Hex>;
  }
  
  // entity replica
  export const enum Stage { Ready = 'ready', Awaiting = 'awaiting' }
  
  export interface EntityState {
    quorum: Quorum;
    nonces: Record<Address, UInt64>;
    chat: { from: Address; msg: string; ts: TS }[];
  }
  
  export interface Replica {
    /* identity */
    id: string;
    address: Address;
    /* governance */
    quorum: Quorum;
    proposer: Address;
    stage: Stage;
    /* working sets */
    mempool:  Transaction[];
    last: Frame<EntityState>;
    proposal?: ProposedFrame<EntityState>;
  }
  

  // commands (server-level traffic)
  export type Command =
    | { type: 'IMPORT';  replica: Replica }
    | { type: 'ADD_TX';   entityId: string; tx: Transaction }
    | { type: 'PROPOSE';  entityId: string }
    | { type: 'SIGN';     entityId: string; frameHash: Hex; sig: Hex }
    | { type: 'COMMIT';   entityId: string; frame: Frame<EntityState> };
  
  export interface Envelope {
     from: Address;
     to: Address;  // target proposer or replica
     cmd: Command;
  }