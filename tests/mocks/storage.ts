import type { KV } from '../../src/types';
import { MemoryKV } from '../../src/storage/memory';

/**
 * Mock KV store that can simulate failures
 * Useful for testing error handling
 */
export class MockKV implements KV {
  private readonly inner: MemoryKV;
  private failurePatterns: Map<string, Error> = new Map();
  private operationFailures: Map<string, Error> = new Map();
  
  constructor() {
    this.inner = new MemoryKV();
  }
  
  // Configure failures
  failOn(operation: 'get' | 'put' | 'del' | 'batch' | 'iterator', error: Error): void {
    this.operationFailures.set(operation, error);
  }
  
  failOnKey(keyPattern: string | RegExp, error: Error): void {
    this.failurePatterns.set(keyPattern instanceof RegExp ? keyPattern.source : keyPattern, error);
  }
  
  reset(): void {
    this.failurePatterns.clear();
    this.operationFailures.clear();
    this.inner.clear();
  }
  
  // Check if should fail
  private checkFailure(operation: string, key?: string): void {
    // Check operation failures
    const opError = this.operationFailures.get(operation);
    if (opError) {
      throw opError;
    }
    
    // Check key pattern failures
    if (key) {
      for (const [pattern, error] of this.failurePatterns) {
        // Check if it's a regex pattern (stored as source)
        if (pattern.includes('^') || pattern.includes('$') || pattern.includes('\\')) {
          const regex = new RegExp(pattern);
          if (regex.test(key)) {
            throw error;
          }
        } else if (key.includes(pattern)) {
          // Simple string match
          throw error;
        }
      }
    }
  }
  
  async get(key: string): Promise<string | undefined> {
    this.checkFailure('get', key);
    return this.inner.get(key);
  }
  
  async put(key: string, val: string): Promise<void> {
    this.checkFailure('put', key);
    await this.inner.put(key, val);
  }
  
  async del(key: string): Promise<void> {
    this.checkFailure('del', key);
    await this.inner.del(key);
  }
  
  async batch(ops: { type: 'put' | 'del'; key: string; value?: string }[]): Promise<void> {
    this.checkFailure('batch');
    // Check individual key failures
    for (const op of ops) {
      this.checkFailure('batch', op.key);
    }
    await this.inner.batch(ops);
  }
  
  async *iterator(options?: { gte?: string; lt?: string }): AsyncIterable<[string, string]> {
    this.checkFailure('iterator');
    yield* this.inner.iterator(options);
  }
  
  // Delegate helper methods
  size(): number {
    return this.inner.size();
  }
  
  entries(): [string, string][] {
    return this.inner.entries();
  }
}