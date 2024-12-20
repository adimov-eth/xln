import { expect } from 'chai';
import { createSTM, processSnap, commitSnap, flushDiff, getCurrentState, getSnap, HSTMError, IStorageService, ISTM } from '../core/HSTM';
import { Level } from 'level';
import fs from 'fs';
import path from 'path';

class TestStorageService implements IStorageService {
  private db: Level<Buffer, Buffer>;

  constructor(dbPath: string) {
    this.db = new Level<Buffer, Buffer>(dbPath, {
      keyEncoding: 'buffer',
      valueEncoding: 'buffer'
    });
  }

  async get(key: Buffer): Promise<Buffer> {
    try {
      const value = await this.db.get(key);
      return Buffer.isBuffer(value) ? value : Buffer.from(value);
    } catch (error: any) {
      if (error.type === 'NotFoundError') {
        throw new HSTMError('Key not found', 'KEY_NOT_FOUND');
      }
      throw new HSTMError(`Failed to get value: ${error.message}`, 'STORAGE_GET_FAILED');
    }
  }

  async put(key: Buffer, value: Buffer): Promise<void> {
    try {
      await this.db.put(key, value);
    } catch (error: any) {
      throw new HSTMError(`Failed to put value: ${error.message}`, 'STORAGE_PUT_FAILED');
    }
  }

  async delete(key: Buffer): Promise<void> {
    try {
      await this.db.del(key);
    } catch (error: any) {
      if (error.type === 'NotFoundError') {
        throw new HSTMError('Key not found', 'KEY_NOT_FOUND');
      }
      throw new HSTMError(`Failed to delete value: ${error.message}`, 'STORAGE_DELETE_FAILED');
    }
  }

  async close(): Promise<void> {
    try {
      await this.db.close();
    } catch (error: any) {
      throw new HSTMError(`Failed to close database: ${error.message}`, 'STORAGE_CLOSE_FAILED');
    }
  }
}

describe('HSTM (Hierarchical State-Time Machine)', () => {
  const TEST_DB_PATH = './test-stm-db';
  let stm: Awaited<ReturnType<typeof createSTM>>;
  let storage: TestStorageService;

  // Helper function to create Buffer key-value pairs
  function createBufferMap(entries: [string, unknown][]): Map<Buffer, unknown> {
    return new Map(entries.map(([key, value]) => [Buffer.from(key), value]));
  }

  beforeEach(async () => {
    // Clean up test database if it exists
    try {
      if (fs.existsSync(TEST_DB_PATH)) {
        await new Promise<void>((resolve, reject) => {
          fs.rm(TEST_DB_PATH, { recursive: true, force: true }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
      storage = new TestStorageService(TEST_DB_PATH);
      stm = await createSTM(storage);
    } catch (error) {
      console.error('Failed to initialize test database:', error);
      throw error;
    }
  });

  afterEach(async () => {
    // Clean up after tests
    try {
      // Close the database first
      if (storage) {
        await storage.close();
      }
      
      // Then remove the files
      if (fs.existsSync(TEST_DB_PATH)) {
        await new Promise<void>((resolve, reject) => {
          fs.rm(TEST_DB_PATH, { recursive: true, force: true }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } catch (error) {
      console.error('Failed to cleanup test database:', error);
    }
  });

  describe('createSTM', () => {
    it('should create a new STM instance', () => {
      expect(stm).to.have.property('storage');
      expect(stm).to.have.property('cache');
      expect(stm).to.have.property('diff');
      expect(stm.cache.size).to.equal(0);
      expect(stm.diff.size).to.equal(0);
    });

    it('should throw HSTMError for invalid path', async () => {
      try {
        const invalidStorage = new TestStorageService('/invalid/path/to/db');
        await createSTM(invalidStorage);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(HSTMError);
        expect((error as HSTMError).code).to.equal('STM_CREATION_FAILED');
      }
    });
  });

  describe('processSnap', () => {
    it('should process state transition correctly', async () => {
      // First set up initial state
      await commitSnap(stm, createBufferMap([['key1', 'value1']]));
      
      // Then process new input
      const input = createBufferMap([['key2', 'value2']]);
      const result = await processSnap(stm, input);

      expect(result.newState.size).to.equal(2);
      expect(result.newState.get(Buffer.from('key1'))).to.equal('value1');
      expect(result.newState.get(Buffer.from('key2'))).to.equal('value2');
      expect(result.output).to.deep.equal(input);
    });

    it('should override existing values', async () => {
      // Set up initial state
      await commitSnap(stm, createBufferMap([['key1', 'value1']]));
      
      // Process new input that overrides existing value
      const input = createBufferMap([['key1', 'newValue1']]);
      const result = await processSnap(stm, input);

      expect(result.newState.size).to.equal(1);
      expect(result.newState.get(Buffer.from('key1'))).to.equal('newValue1');
    });

    it('should handle empty input', async () => {
      // Set up initial state
      await commitSnap(stm, createBufferMap([['key1', 'value1']]));
      
      // Process empty input
      const input = new Map<Buffer, unknown>();
      const result = await processSnap(stm, input);

      expect(result.newState.size).to.equal(1);
      expect(result.newState.get(Buffer.from('key1'))).to.equal('value1');
    });

    it('should throw error for invalid STM', async () => {
      const input = new Map<Buffer, unknown>();
      try {
        await processSnap({} as ISTM, input);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(HSTMError);
        expect((error as HSTMError).code).to.equal('INVALID_STM');
      }
    });
  });

  describe('commitSnap and getSnap', () => {
    it('should commit and retrieve a snap', async () => {
      const input = createBufferMap([['key1', 'value1']]);

      const snapId = await commitSnap(stm, input);
      const snap = await getSnap(stm, snapId);

      expect(snap).to.not.be.null;
      expect(snap!.input).to.deep.equal(input);
      expect(snap!.state.get(Buffer.from('key1'))).to.equal('value1');
    });

    it('should maintain snap history', async () => {
      const input1 = createBufferMap([['key1', 'value1']]);
      const input2 = createBufferMap([['key2', 'value2']]);

      const snapId1 = await commitSnap(stm, input1);
      const snapId2 = await commitSnap(stm, input2);

      const snap1 = await getSnap(stm, snapId1);
      const snap2 = await getSnap(stm, snapId2);

      expect(snap1!.state.size).to.equal(1);
      expect(snap2!.state.size).to.equal(2);
      expect(snap2!.prevSnap).to.deep.equal(snapId1);
    });
  });

  describe('flushDiff', () => {
    it('should persist changes to database', async () => {
      const input = createBufferMap([['key1', 'value1']]);

      await commitSnap(stm, input);
      await flushDiff(stm);

      expect(stm.diff.size).to.equal(0);
      expect(stm.cache.get(Buffer.from('key1'))).to.equal('value1');

      // Create new STM instance to verify persistence
      const newStm = await createSTM(storage);
      expect(newStm.cache.get(Buffer.from('key1'))).to.equal('value1');
    });
  });

  describe('getCurrentState', () => {
    it('should return current state', async () => {
      const input1 = createBufferMap([['key1', 'value1']]);
      const input2 = createBufferMap([['key2', 'value2']]);

      await commitSnap(stm, input1);
      await commitSnap(stm, input2);

      const currentState = getCurrentState(stm);
      expect(currentState.size).to.equal(2);
      expect(currentState.get(Buffer.from('key1'))).to.equal('value1');
      expect(currentState.get(Buffer.from('key2'))).to.equal('value2');
    });

    it('should return a copy of the state', async () => {
      const input = createBufferMap([['key1', 'value1']]);

      await commitSnap(stm, input);
      const state1 = getCurrentState(stm);
      const state2 = getCurrentState(stm);

      expect(state1).to.not.equal(state2);
      expect(state1).to.deep.equal(state2);
    });
  });
});
