import type { EntityInput, EntityState } from './entity.ts';
import type { Height, SignerIdx } from './primitives.ts';

// ----------------------- Unified Message Type ----------------------------

export type Message =
  | Readonly<{
      scope: 'direct';
      signer: SignerIdx;
      entityId: string;
      input: EntityInput;
    }>
  | Readonly<{
      scope: 'outbox';
      from: string;
      toEntity: string;
      toSigner: SignerIdx;
      input: EntityInput;
    }>;

// Type guards
export const isDirectMsg = (m: Message): m is Extract<Message, { scope: 'direct' }> => m.scope === 'direct';
export const isOutboxMsg = (m: Message): m is Extract<Message, { scope: 'outbox' }> => m.scope === 'outbox';

export type ServerState = Readonly<{
  height: Height;
  signers: Map<SignerIdx, Map<string, EntityState>>;
  mempool: readonly Message[];
}>; 