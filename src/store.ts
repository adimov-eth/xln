// store.ts
import { Level } from 'level';

export class Database {
  private db: Level<Buffer, Buffer>;

  constructor(path: string) {
    this.db = new Level(path, {
      keyEncoding: 'buffer',
      valueEncoding: 'buffer'
    });
  }

  async open(): Promise<void> {
    await this.db.open();
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async get(key: Buffer): Promise<Buffer | undefined> {
    try {
      return await this.db.get(key);
    } catch (error: any) {
      if (error.code === 'LEVEL_NOT_FOUND') {
        return undefined;
      }
      throw error;
    }
  }

  async put(key: Buffer, value: Buffer): Promise<void> {
    await this.db.put(key, value);
  }

  async batch(ops: Array<{ key: Buffer; value: Buffer }>): Promise<void> {
    const batch = this.db.batch();
    for (const op of ops) {
      batch.put(op.key, op.value);
    }
    await batch.write();
  }
}