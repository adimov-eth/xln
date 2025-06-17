// ============================================================================
// test/helpers.ts - Testing utilities
// ============================================================================

import { importEntity, registerEntity, submitTransaction } from '../core/server.js';
import { SilentLogger } from '../infra/deps.js';
import { createBlockRunner } from '../infra/runner.js';
import { defaultRegistry } from '../protocols/registry.js';
import { MemoryStorage } from '../storage/memory.js';
import type { BlockHeight } from '../types/primitives.js';
import { id, signer } from '../types/primitives.js';
import type { EntityCommand, EntityState, ServerState, ServerTx } from '../types/state.js';
import { createInitialState } from '../utils/serialization.js';
import { getCanonicalEntity } from '../utils/state-helpers.js';

export class TestScenario {
  private server: ServerState;
  private storage: MemoryStorage;
  private runner: ReturnType<typeof createBlockRunner>;
  
  constructor(public name: string) {
    this.server = createInitialState();
    this.storage = new MemoryStorage();
    this.runner = createBlockRunner({ 
      storage: this.storage, 
      protocols: defaultRegistry,
      logger: SilentLogger,
      snapshotInterval: 10
    });
  }
  
  entity(entityId: string, signers: number[], initialBalance = 1000n): this {
    this.server = registerEntity(this.server, entityId, signers, { balance: initialBalance, nonce: 0 });
    for (const signerIdx of signers) {
      this.server = importEntity(this.server, signer(signerIdx), entityId, { balance: initialBalance, nonce: 0 });
    }
    return this;
  }
  
  multiSigEntity(entityId: string, signers: number[], initialBalance = 10000n): this {
    this.server = registerEntity(this.server, entityId, signers, { balance: initialBalance, nonce: 0 }, 'wallet', 5000);
    for (const signerIdx of signers) {
      this.server = importEntity(this.server, signer(signerIdx), entityId, { balance: initialBalance, nonce: 0 });
    }
    return this;
  }
  
  async transaction(signerIdx: number, entityId: string, command: EntityCommand): Promise<this> {
    this.server = submitTransaction(this.server, signerIdx, entityId, command);
    const result = await this.runner.processBlock(this.server, false);
    if (result.ok) this.server = result.value;
    else throw new Error(result.error);
    return this;
  }
  
  async processBlock(): Promise<this> {
    const result = await this.runner.processBlock(this.server, false);
    if (result.ok) this.server = result.value;
    else throw new Error(result.error);
    return this;
  }
  
  async recover(): Promise<this> {
    const result = await this.runner.recover();
    if (result.ok) this.server = result.value;
    else throw new Error(result.error);
    return this;
  }
  
  getEntity(entityId: string): EntityState | undefined {
    return getCanonicalEntity(this.server, id(entityId));
  }
  
  getHeight(): BlockHeight { return this.server.height; }
  getMempool(): readonly ServerTx[] { return this.server.mempool; }
  getStorage(): MemoryStorage { return this.storage; }
  getState(): ServerState { return this.server; }
}

export const createTestScenario = (name: string): TestScenario => new TestScenario(name);