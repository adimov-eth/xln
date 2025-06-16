import type { Protocol, ProtocolRegistry } from './types';
import { WalletProtocol } from './wallet';
import { ConsensusProtocol } from './consensus';

/**
 * Create a protocol registry from a list of protocols
 */
export const createProtocolRegistry = (
  ...protocols: Protocol<any, any>[]
): ProtocolRegistry => {
  return new Map(protocols.map(p => [p.name, p]));
};

/**
 * Default registry with built-in protocols
 */
export const defaultRegistry = createProtocolRegistry(WalletProtocol, ConsensusProtocol);

/**
 * Get protocol by name from registry
 */
export const getProtocol = <TState, TData>(
  registry: ProtocolRegistry,
  name: string
): Protocol<TState, TData> | undefined => {
  return registry.get(name);
};