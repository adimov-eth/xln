import { Logger } from '../utils/Logger';
import { StorageService } from './StorageService';
import { IStorageOptions } from '@xln/types';

/**
 * Error class for service operations
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/**
 * Base service configuration
 */
export interface IServiceConfig {
  dbPath: string;
  logger?: Logger;
  storageOptions?: Partial<IStorageOptions>;
}

/**
 * Base service class that provides common functionality
 */
export abstract class BaseService {
  protected storage: StorageService;
  protected logger: Logger;

  constructor(config: IServiceConfig) {
    this.logger = config.logger || new Logger({ name: this.constructor.name });
    this.storage = new StorageService({
      dbPath: config.dbPath,
      logger: this.logger,
      options: config.storageOptions,
    });
  }

  /**
   * Initializes the service
   */
  public async initialize(): Promise<void> {
    try {
      await this.storage.open();
      this.logger.info('Service initialized successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to initialize service: ${message}`);
      throw new ServiceError(`Failed to initialize service: ${message}`, 'INITIALIZATION_FAILED', error);
    }
  }

  /**
   * Closes the service
   */
  public async close(): Promise<void> {
    try {
      await this.storage.close();
      this.logger.info('Service closed successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to close service: ${message}`);
      throw new ServiceError(`Failed to close service: ${message}`, 'CLOSE_FAILED', error);
    }
  }

  /**
   * Stores a value
   */
  protected async store<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      await this.storage.put(key, value, ttl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to store value: ${message}`);
      throw new ServiceError(`Failed to store value: ${message}`, 'STORE_FAILED', error);
    }
  }

  /**
   * Retrieves a value
   */
  protected async retrieve<T>(key: string): Promise<T | null> {
    const value = await this.storage.get<T>(key);
    return value?.data ?? null;
  }

  /**
   * Deletes a value
   */
  protected async remove(key: string): Promise<void> {
    try {
      await this.storage.del(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to delete value: ${message}`);
      throw new ServiceError(`Failed to delete value: ${message}`, 'DELETE_FAILED', error);
    }
  }

  /**
   * Lists all keys with a given prefix
   */
  protected async listKeys(prefix: string): Promise<string[]> {
    try {
      return await this.storage.keys(prefix);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to list keys: ${message}`);
      throw new ServiceError(`Failed to list keys: ${message}`, 'LIST_FAILED', error);
    }
  }

  /**
   * Creates a batch operation
   */
  protected async batch<T>(
    operations: Array<{ type: 'put' | 'del'; key: string; value?: T; ttl?: number }>,
  ): Promise<void> {
    try {
      await this.storage.batch(operations);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to execute batch operation: ${message}`);
      throw new ServiceError(`Failed to execute batch operation: ${message}`, 'BATCH_FAILED', error);
    }
  }

  /**
   * Gets storage stats
   */
  protected async getStats(): Promise<void> {
    try {
      const stats = await this.storage.stats();
      this.logger.info('Storage stats:', stats);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to get storage stats: ${message}`);
      throw new ServiceError(`Failed to get storage stats: ${message}`, 'STATS_FAILED', error);
    }
  }
}
