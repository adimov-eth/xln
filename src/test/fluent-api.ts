
import { expect } from 'bun:test';
import { createServer, importEntity, query, registerEntity, submitCommand } from '../engine/server.js';
import { SilentLogger } from '../infra/deps.js';
import { createBlockRunner } from '../infra/runner.js';
import { MemoryStorage } from '../storage/memory.js';
import { id, signer } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { EntityCommand, ServerState } from '../types/state.js';

// ============================================================================
// Test Scenario Builder
// ============================================================================

export class TestScenario {
  private server: ServerState;
  private runner: ReturnType<typeof createBlockRunner>;
  
  constructor(public description: string, protocols: ProtocolRegistry) {
    this.server = createServer();
    this.runner = createBlockRunner({
      storage: new MemoryStorage(),
      protocols,
      logger: SilentLogger
    });
  }
  
  withEntity(entityId: string, config: { protocol: string; signers: number[]; initialState?: any; timeoutMs?: number; thresholdPercent?: number; }): this {
    this.server = registerEntity(this.server, entityId, { 
      quorum: config.signers, 
      protocol: config.protocol, 
      timeoutMs: config.timeoutMs,
      thresholdPercent: config.thresholdPercent 
    });
    for (const signerId of config.signers) {
      this.server = importEntity(this.server, signer(signerId), entityId, config.initialState);
    }
    return this;
  }
  
  withWallet(walletId: string, owner: number | number[], balance: bigint, thresholdPercent?: number): this {
    const signers = Array.isArray(owner) ? owner : [owner];
    return this.withEntity(walletId, { 
      protocol: 'wallet', 
      signers, 
      initialState: { balance, nonce: 0 },
      thresholdPercent 
    });
  }
  
  withDao(daoId: string, members: number[], config?: { balance?: bigint; voteThreshold?: number; }): this {
    return this.withEntity(daoId, {
      protocol: 'dao',
      signers: members,
      initialState: {
        balance: config?.balance ?? 1000n,
        nonce: 0,
        initiatives: new Map(),
        memberCount: members.length,
        voteThreshold: config?.voteThreshold ?? 66
      }
    });
  }
  
  sendCommand(from: number, to: string, command: EntityCommand): this {
    this.server = submitCommand(this.server, signer(from), to, command);
    return this;
  }
  
  sendTransaction(from: number, to: string, tx: any): this {
    // Only auto-increment nonce for operations that don't require it
    // This helps catch bugs where nonce is forgotten for transfer/burn
    const requiresNonce = tx.op === 'transfer' || tx.op === 'burn';
    if (!requiresNonce && tx.nonce === undefined) {
      const nextNonce = this.getNextNonce(to);
      tx.nonce = nextNonce;
    }
    return this.sendCommand(from, to, { type: 'addTx', tx });
  }
  
  async tick(): Promise<this> {
    const result = await this.runner.processBlock(this.server);
    if (!result.ok) throw new Error(`Processing failed: ${result.error}`);
    this.server = result.value;
    return this;
  }
  
  async processBlocks(count: number): Promise<this> {
    for (let i = 0; i < count; i++) await this.tick();
    return this;
  }
  
  async processUntilIdle(maxIterations = 20): Promise<this> {
    for (let i = 0; i < maxIterations && this.server.mempool.length > 0; i++) {
      await this.tick();
    }
    if (this.server.mempool.length > 0) {
      console.warn(`Mempool not empty after ${maxIterations} iterations.`);
    }
    return this;
  }
  
  expectBalance(entity: string, expectedBalance: bigint): this {
    expect(this.findEntityState(entity).balance).toBe(expectedBalance);
    return this;
  }
  
  expectNonce(entity: string, expectedNonce: number): this {
    expect(this.findEntityState(entity).nonce).toBe(expectedNonce);
    return this;
  }
  
  expectInitiativeCount(entity: string, expectedCount: number): this {
    expect(this.findEntityState(entity).initiatives?.size ?? 0).toBe(expectedCount);
    return this;
  }
  
  expectInitiativeStatus(entity: string, initiativeIdOrIndex: string | number, expectedStatus: string): this {
    const state = this.findEntityState(entity);
    const initiative = (typeof initiativeIdOrIndex === 'number')
      ? Array.from(state.initiatives?.values() ?? [])[initiativeIdOrIndex]
      : state.initiatives?.get(initiativeIdOrIndex);
    expect(initiative).toBeDefined();
    expect(initiative!.status).toBe(expectedStatus);
    return this;
  }
  
  getInitiativeId(entity: string, index: number = 0): string {
    const state = this.findEntityState(entity);
    const initiatives = Array.from(state.initiatives?.keys() ?? []);
    if (initiatives.length <= index) throw new Error(`Initiative at index ${index} not found`);
    return initiatives[index]! as string;
  }
  
  private findEntity(entityId: string, atSigner?: number): any {
    if (atSigner !== undefined) {
      const entity = query.getEntity(this.server, signer(atSigner), entityId);
      if (!entity) throw new Error(`Entity "${entityId}" not found at signer ${atSigner}`);
      return entity;
    }
    const meta = this.server.registry.get(id(entityId));
    if (!meta) throw new Error(`Entity "${entityId}" not registered`);
    for (const signerIdx of meta.quorum) {
      const entity = query.getEntity(this.server, signerIdx, entityId);
      if (entity) return entity;
    }
    throw new Error(`Entity "${entityId}" not found at any signer`);
  }
  
  private findEntityState(entityId: string): any { return this.findEntity(entityId).data; }
  private getNextNonce(entityId: string): number { return (this.findEntityState(entityId).nonce ?? 0) + 1; }
}

// ============================================================================
// Test Scenario Factory and Patterns
// ============================================================================

export const scenario = (description: string) => ({
  withProtocols: (protocols: ProtocolRegistry) => new TestScenario(description, protocols)
});

export const patterns = {
  walletTransfer: (p: ProtocolRegistry) => scenario('wallet transfer').withProtocols(p).withWallet('alice', 0, 1000n).withWallet('bob', 1, 0n),
  multiSigDao: (p: ProtocolRegistry, m: number[] = [0, 1, 2]) => scenario('multi-sig DAO').withProtocols(p).withDao('dao', m),
  daoWithTreasury: (p: ProtocolRegistry) => scenario('DAO with treasury').withProtocols(p).withDao('dao', [0, 1, 2]).withWallet('treasury', 3, 0n)
};