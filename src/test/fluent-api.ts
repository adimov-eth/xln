// ============================================================================
// test/fluent-api.ts - Fluent test API that reads like English
// ============================================================================

import { expect } from 'bun:test';
import { createServer, importEntity, query, registerEntity, submitCommand } from '../engine/server.js';
import { transaction } from '../entity/transactions.js';
import { SilentLogger } from '../infra/deps.js';
import { createBlockRunner } from '../infra/runner.js';
import { MemoryStorage } from '../storage/memory.js';
import { id } from '../types/primitives.js';
import type { ProtocolRegistry } from '../types/protocol.js';
import type { EntityCommand, ServerState } from '../types/state.js';

// ============================================================================
// Test Scenario Builder
// ============================================================================

export class TestScenario {
  private server: ServerState;
  private protocols: ProtocolRegistry;
  private description: string;
  private runner: any;
  
  constructor(description: string, protocols: ProtocolRegistry) {
    this.description = description;
    this.protocols = protocols;
    this.server = createServer();
    this.runner = createBlockRunner({
      storage: new MemoryStorage(),
      protocols,
      logger: SilentLogger
    });
  }
  
  // ============================================================================
  // Entity Setup
  // ============================================================================
  
  withEntity(entityId: string, config: {
    protocol: string;
    signers: number[];
    initialState?: any;
    timeoutMs?: number;
  }): this {
    // Register the entity
    this.server = registerEntity(this.server, entityId, {
      quorum: config.signers,
      protocol: config.protocol,
      timeoutMs: config.timeoutMs
    });
    
    // Import for all signers
    for (const signerId of config.signers) {
      this.server = importEntity(
        this.server,
        signerId,
        entityId,
        config.initialState
      );
    }
    
    return this;
  }
  
  withWallet(walletId: string, owner: number, balance: bigint): this {
    return this.withEntity(walletId, {
      protocol: 'wallet',
      signers: [owner],
      initialState: { balance, nonce: 0 }
    });
  }
  
  withDao(daoId: string, members: number[], config?: {
    balance?: bigint;
    voteThreshold?: number;
  }): this {
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
  
  // ============================================================================
  // Command Sending
  // ============================================================================
  
  sendCommand(from: number, to: string, command: EntityCommand): this {
    this.server = submitCommand(this.server, from, to, command);
    return this;
  }
  
  sendTransaction(from: number, to: string, tx: any): this {
    console.log('[DEBUG] TestScenario.sendTransaction:', {
      from,
      to,
      tx
    });
    return this.sendCommand(from, to, { type: 'addTx', tx });
  }
  
  transfer(from: number, fromEntity: string, toEntity: string, amount: bigint): this {
    const nextNonce = this.getNextNonce(fromEntity);
    return this.sendTransaction(
      from,
      fromEntity,
      transaction.transfer(toEntity, amount, nextNonce)
    );
  }
  
  burn(from: number, entity: string, amount: bigint): this {
    const nextNonce = this.getNextNonce(entity);
    return this.sendTransaction(
      from,
      entity,
      transaction.burn(amount, nextNonce)
    );
  }
  
  proposeBlock(proposer: number, entity: string): this {
    console.log('[DEBUG] proposeBlock:', { proposer, entity });
    const entityState = this.findEntity(entity);
    console.log('[DEBUG] Entity state before propose:', {
      stage: entityState.stage,
      height: entityState.height,
      mempool: entityState.mempool.length
    });
    return this.sendCommand(proposer, entity, { type: 'proposeBlock' });
  }
  
  // ============================================================================
  // Processing
  // ============================================================================
  
  async tick(): Promise<this> {
    const result = await this.runner.processBlock(this.server);
    if (!result.ok) {
      throw new Error(`Processing failed: ${result.error}`);
    }
    this.server = result.value;
    return this;
  }
  
  async processBlocks(count: number): Promise<this> {
    for (let i = 0; i < count; i++) {
      await this.tick();
    }
    return this;
  }
  
  async processMultiSigBlock(): Promise<this> {
    console.log('[DEBUG] processMultiSigBlock starting, mempool size:', this.server.mempool.length);
    // For multi-sig: process propose, share, approve, commit
    await this.tick();  // Process commands
    console.log('[DEBUG] After process commands, mempool size:', this.server.mempool.length);
    await this.tick();  // Share proposal
    console.log('[DEBUG] After share proposal, mempool size:', this.server.mempool.length);
    await this.tick();  // Receive approvals
    console.log('[DEBUG] After receive approvals, mempool size:', this.server.mempool.length);
    await this.tick();  // Commit
    console.log('[DEBUG] After commit, mempool size:', this.server.mempool.length);
    await this.processUntilIdle();  // Sync all signers
    console.log('[DEBUG] After processUntilIdle, mempool size:', this.server.mempool.length);
    return this;
  }
  
  async processUntilIdle(): Promise<this> {
    let maxIterations = 100;
    while (this.server.mempool.length > 0 && maxIterations-- > 0) {
      await this.tick();
    }
    if (maxIterations === 0) {
      throw new Error('Processing did not complete within 100 iterations');
    }
    return this;
  }
  
  // ============================================================================
  // Assertions
  // ============================================================================
  
  expectBalance(entity: string, expectedBalance: bigint): this {
    const state = this.findEntityState(entity);
    expect(state.balance).toBe(expectedBalance);
    return this;
  }
  
  expectNonce(entity: string, expectedNonce: number): this {
    const state = this.findEntityState(entity);
    expect(state.nonce).toBe(expectedNonce);
    return this;
  }
  
  expectEntityStage(entity: string, expectedStage: string): this {
    const entityState = this.findEntity(entity);
    expect(entityState.stage).toBe(expectedStage);
    return this;
  }
  
  expectMempoolSize(entity: string, expectedSize: number): this {
    const entityState = this.findEntity(entity);
    expect(entityState.mempool.length).toBe(expectedSize);
    return this;
  }
  
  expectServerMempoolSize(expectedSize: number): this {
    expect(this.server.mempool.length).toBe(expectedSize);
    return this;
  }
  
  expectInitiativeCount(entity: string, expectedCount: number): this {
    const state = this.findEntityState(entity);
    expect(state.initiatives?.size ?? 0).toBe(expectedCount);
    return this;
  }
  
  expectInitiativeStatus(entity: string, initiativeId: string | number, expectedStatus: string): this {
    const state = this.findEntityState(entity);
    console.log('[DEBUG] expectInitiativeStatus checking state at first signer');
    
    // If number provided, get the nth initiative
    let initiative;
    if (typeof initiativeId === 'number') {
      const initiatives = Array.from(state.initiatives?.values() ?? []);
      initiative = initiatives[initiativeId];
    } else {
      initiative = state.initiatives?.get(initiativeId);
    }
    
    if (initiative) {
      console.log('[DEBUG] Initiative found:', {
        id: typeof initiativeId === 'string' ? initiativeId : `index-${initiativeId}`,
        status: initiative.status,
        voteCount: initiative.votes?.size ?? 0,
        votes: Array.from(initiative.votes?.entries() ?? [])
      });
    } else {
      console.log('[DEBUG] Initiative not found!');
    }
    
    expect(initiative).toBeDefined();
    expect(initiative!.status).toBe(expectedStatus);
    return this;
  }
  
  // ============================================================================
  // Getters
  // ============================================================================
  
  getServer(): ServerState {
    return this.server;
  }
  
  getEntity(entity: string, signer?: number): any {
    return this.findEntity(entity, signer);
  }
  
  getBalance(entity: string): bigint {
    return this.findEntityState(entity).balance;
  }
  
  getNonce(entity: string): number {
    return this.findEntityState(entity).nonce;
  }
  
  getInitiativeId(entity: string, index: number = 0): string {
    const state = this.findEntityState(entity);
    if (!state.initiatives) {
      throw new Error('Entity does not have initiatives');
    }
    const initiatives = Array.from(state.initiatives.keys());
    console.log('[DEBUG] getInitiativeId:', {
      entity,
      index,
      initiativeCount: initiatives.length,
      initiativeIds: initiatives
    });
    if (index >= initiatives.length) {
      throw new Error(`Initiative at index ${index} not found`);
    }
    return initiatives[index] as string;
  }
  
  // ============================================================================
  // Helper Methods
  // ============================================================================
  
  private findEntity(entityId: string, atSigner?: number): any {
    // If signer specified, look there
    if (atSigner !== undefined) {
      const entity = query.getEntity(this.server, atSigner, entityId);
      if (!entity) {
        throw new Error(`Entity "${entityId}" not found at signer ${atSigner}`);
      }
      return entity;
    }
    
    // Otherwise, find the first signer that has it
    const meta = this.server.registry.get(id(entityId));
    if (!meta) {
      throw new Error(`Entity "${entityId}" not registered`);
    }
    
    for (const signer of meta.quorum) {
      const entity = query.getEntity(this.server, Number(signer), entityId);
      if (entity) return entity;
    }
    
    throw new Error(`Entity "${entityId}" not found at any signer`);
  }
  
  private findEntityState(entityId: string): any {
    const entity = this.findEntity(entityId);
    console.log('[DEBUG] findEntityState for', entityId, 'found at signer', this.getEntitySigner(entityId));
    return entity.data;
  }
  
  private getEntitySigner(entityId: string): number {
    const meta = this.server.registry.get(id(entityId));
    if (!meta) return -1;
    
    for (const signer of meta.quorum) {
      const entity = query.getEntity(this.server, Number(signer), entityId);
      if (entity) return Number(signer);
    }
    return -1;
  }
  
  private getNextNonce(entityId: string): number {
    const state = this.findEntityState(entityId);
    return (state.nonce ?? 0) + 1;
  }
}

// ============================================================================
// Test Scenario Factory
// ============================================================================

export const scenario = (description: string) => ({
  withProtocols: (protocols: ProtocolRegistry) => 
    new TestScenario(description, protocols)
});

// ============================================================================
// Common Test Patterns
// ============================================================================

export const patterns = {
  // Simple wallet transfer
  walletTransfer: (protocols: ProtocolRegistry) => 
    scenario('wallet transfer')
      .withProtocols(protocols)
      .withWallet('alice', 0, 1000n)
      .withWallet('bob', 1, 0n),
  
  // Multi-sig DAO
  multiSigDao: (protocols: ProtocolRegistry, members: number[] = [0, 1, 2]) =>
    scenario('multi-sig DAO')
      .withProtocols(protocols)
      .withDao('dao', members),
  
  // DAO with treasury
  daoWithTreasury: (protocols: ProtocolRegistry) =>
    scenario('DAO with treasury')
      .withProtocols(protocols)
      .withDao('dao', [0, 1, 2])
      .withWallet('treasury', 3, 0n)
};