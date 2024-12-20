import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { StorageService } from '../services/StorageService';
import { StorageError } from '@xln/types';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Logger } from '../utils/Logger';
import { randomBytes } from 'crypto';

describe('StorageService', () => {
  let service: StorageService;
  let dbPath: string;

  beforeEach(async () => {
    // Create temporary database path
    dbPath = join(tmpdir(), `test-db-${Date.now()}`);

    // Create storage service
    service = new StorageService({
      dbPath,
      options: {
        compression: true,
        prefix: 'test:',
        ttl: 1000, // 1 second TTL
        encryption: {
          enabled: true,
          key: randomBytes(32).toString('hex'),
          algorithm: 'aes-256-cbc',
        },
      },
      logger: new Logger({ name: 'StorageTest' }),
    });

    await service.open();
  });

  afterEach(async () => {
    await service.close();
    await fs.rm(dbPath, { recursive: true, force: true });
  });

  describe('Basic Operations', () => {
    it('should store and retrieve values', async () => {
      const key = 'test-key';
      const value = { foo: 'bar', num: 42 };

      await service.put(key, value);
      const retrieved = await service.get<typeof value>(key);

      expect(retrieved?.data).to.deep.equal(value);
    });

    it('should handle non-existent keys', async () => {
      const result = await service.get('non-existent');
      expect(result).to.be.null;
    });

    it('should check key existence', async () => {
      const key = 'test-key';
      expect(await service.get(key)).to.be.null;

      await service.put(key, 'value');
      expect(await service.get(key)).to.not.be.null;

      await service.del(key);
      expect(await service.get(key)).to.be.null;
    });

    it('should list keys with prefix', async () => {
      await service.put('a:1', 'value1');
      await service.put('a:2', 'value2');
      await service.put('b:1', 'value3');

      const aKeys = await service.keys('a:');
      expect(aKeys).to.have.lengthOf(2);
      expect(aKeys).to.include('a:1');
      expect(aKeys).to.include('a:2');

      const bKeys = await service.keys('b:');
      expect(bKeys).to.have.lengthOf(1);
      expect(bKeys).to.include('b:1');
    });
  });

  describe('Batch Operations', () => {
    it('should perform batch operations', async () => {
      const batch = [
        { type: 'put' as const, key: 'key1', value: 'value1' },
        { type: 'put' as const, key: 'key2', value: 'value2' },
        { type: 'del' as const, key: 'key1' },
      ];

      await service.batch(batch);

      expect(await service.get('key1')).to.be.null;
      const key2Value = await service.get<string>('key2');
      expect(key2Value?.data).to.equal('value2');
    });
  });

  describe('Compression', () => {
    it('should compress and decompress data', async () => {
      const key = 'large-key';
      const value = { data: 'x'.repeat(1000) }; // Create large payload

      await service.put(key, value);
      const stats = await service.stats();

      expect(stats.compressionRatio).to.be.lessThan(1); // Verify compression
      const retrieved = await service.get<typeof value>(key);
      expect(retrieved?.data).to.deep.equal(value);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors', async () => {
      await service.close();
      try {
        await service.put('key', 'value');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(StorageError);
        expect((error as StorageError).code).to.equal('NOT_OPEN');
      }
    });

    it('should handle invalid data', async () => {
      try {
        await service.put('key', BigInt(123)); // BigInt can't be JSON serialized
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(StorageError);
        expect((error as StorageError).code).to.equal('PUT_FAILED');
      }
    });
  });

  describe('Storage Stats', () => {
    it('should calculate storage stats', async () => {
      await service.put('key1', { data: 'x'.repeat(100) });
      await service.put('key2', { data: 'y'.repeat(200) });

      const stats = await service.stats();
      expect(stats.keys).to.equal(2);
      expect(stats.size).to.be.greaterThan(0);
      expect(stats.encryptedKeys).to.equal(2);
    });
  });

  describe('TTL Support', () => {
    it('should handle TTL expiration', async () => {
      const key = 'ttl-key';
      const value = { data: 'test' };
      const ttl = 100; // 100ms TTL

      await service.put(key, value, ttl);
      expect(await service.get(key)).to.not.be.null;

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, ttl + 50));
      await service.cleanup();
      expect(await service.get(key)).to.be.null;
    });

    it('should update TTL with touch', async () => {
      const key = 'touch-key';
      const value = { data: 'test' };
      const initialTTL = 200; // 200ms initial TTL

      await service.put(key, value, initialTTL);

      // Wait for half the TTL
      await new Promise((resolve) => setTimeout(resolve, initialTTL / 2));

      // Update TTL
      const newTTL = 500; // 500ms new TTL
      await service.touch(key, newTTL);

      // Wait for original TTL to pass
      await new Promise((resolve) => setTimeout(resolve, initialTTL + 50));

      // Key should still exist
      expect(await service.get(key)).to.not.be.null;

      // Wait for new TTL to pass
      await new Promise((resolve) => setTimeout(resolve, newTTL));
      await service.cleanup();

      // Key should be expired
      expect(await service.get(key)).to.be.null;
    });

    it('should cleanup expired keys', async () => {
      const ttl = 100; // 100ms TTL
      await service.put('exp1', 'value1', ttl);
      await service.put('exp2', 'value2', ttl);
      await service.put('noexp', 'value3'); // No expiration

      // Wait for TTL to pass
      await new Promise((resolve) => setTimeout(resolve, ttl + 50));

      await service.cleanup();
      const remainingKeys = await service.keys('');
      expect(remainingKeys).to.have.lengthOf(1);
      expect(remainingKeys[0]).to.equal('noexp');
    });
  });

  describe('Encryption Support', () => {
    it('should encrypt and decrypt values', async () => {
      const key = 'secret-key';
      const value = { sensitive: 'data' };

      await service.put(key, value);
      const retrieved = await service.get<typeof value>(key);
      expect(retrieved?.data).to.deep.equal(value);
    });

    it('should handle encryption key rotation', async () => {
      const key = 'rotate-key';
      const value = { data: 'secret' };

      // Store with initial encryption key
      await service.put(key, value);

      // Create new service with different encryption key
      const newService = new StorageService({
        dbPath,
        options: {
          encryption: {
            enabled: true,
            key: randomBytes(32).toString('hex'),
            algorithm: 'aes-256-cbc',
          },
        },
      });

      await newService.open();

      try {
        await newService.get(key);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(StorageError);
        expect((error as StorageError).code).to.equal('GET_FAILED');
      }

      await newService.close();
    });

    it('should handle disabling encryption', async () => {
      const key = 'unencrypted-key';
      const value = { data: 'plain' };

      // Create service without encryption
      const plainService = new StorageService({
        dbPath: join(tmpdir(), `test-db-${Date.now()}`),
        options: {
          encryption: {
            enabled: false,
            key: '',
            algorithm: 'none',
          },
        },
      });

      await plainService.open();
      await plainService.put(key, value);

      const retrieved = await plainService.get<typeof value>(key);
      expect(retrieved?.data).to.deep.equal(value);

      await plainService.close();
    });
  });

  describe('Storage Stats', () => {
    it('should include encryption and expiration stats', async () => {
      await service.put('enc1', 'value1');
      await service.put('enc2', 'value2');
      await service.put('exp1', 'value3', 100);
      await service.put('exp2', 'value4', 100);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      const stats = await service.stats();
      expect(stats.encryptedKeys).to.equal(2);
      expect(stats.expiredKeys).to.equal(2);
    });
  });
});
