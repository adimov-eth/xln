// ============================================================================
// protocols/registry.ts - Protocol registry
// ============================================================================

import type { Protocol, ProtocolRegistry } from '../types/protocol.js';
import { DaoProtocol } from './dao.js';
import { WalletProtocol } from './wallet.js';

export const createProtocolRegistry = (
  ...protocols: Protocol<any, any>[]
): ProtocolRegistry => {
  return new Map(protocols.map(p => [p.name, p]));
};

export const defaultRegistry = createProtocolRegistry(
  WalletProtocol,
  DaoProtocol
);