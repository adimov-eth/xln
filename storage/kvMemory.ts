// In-memory key-value store for testing

export interface KV {
  get(key: string): Promise<string | undefined>;
  put(key: string, val: string): Promise<void>;
  del(key: string): Promise<void>;
  batch(ops: { type: 'put' | 'del'; key: string; value?: string }[]): Promise<void>;
  iterator(options?: { gte?: string; lt?: string }): AsyncIterable<[string, string]>;
}

export class MemoryKV implements KV {
  private store: Map<string, string> = new Map();
  
  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }
  
  async put(key: string, val: string): Promise<void> {
    this.store.set(key, val);
  }
  
  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
  
  async batch(ops: { type: 'put' | 'del'; key: string; value?: string }[]): Promise<void> {
    for (const op of ops) {
      if (op.type === 'put' && op.value !== undefined) {
        this.store.set(op.key, op.value);
      } else if (op.type === 'del') {
        this.store.delete(op.key);
      }
    }
  }
  
  async *iterator(options?: { gte?: string; lt?: string }): AsyncIterable<[string, string]> {
    const entries = Array.from(this.store.entries())
      .sort(([a], [b]) => a.localeCompare(b));
    
    for (const [key, value] of entries) {
      if (options?.gte && key < options.gte) continue;
      if (options?.lt && key >= options.lt) break;
      yield [key, value];
    }
  }
  
  // Helper methods for testing
  clear(): void {
    this.store.clear();
  }
  
  size(): number {
    return this.store.size;
  }
  
  entries(): [string, string][] {
    return Array.from(this.store.entries());
  }
}