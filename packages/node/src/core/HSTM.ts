/**
 * Interface for the storage service that persists state machine data.
 * Provides basic key-value operations for storing and retrieving state machine data.
 */
export interface IStorageService {
  /** Retrieves a value by its key from storage */
  get(key: Buffer): Promise<Buffer>;
  /** Stores a key-value pair in storage */
  put(key: Buffer, value: Buffer): Promise<void>;
  /** Removes a key-value pair from storage */
  delete(key: Buffer): Promise<void>;
}

/**
 * Represents a snapshot in the Hierarchical State-Time Machine.
 * A snapshot captures the complete state of the system at a particular point in time,
 * including inputs, current state, and outputs.
 */
export interface ISnap {
  /** Reference to the previous snapshot, null for initial state */
  prevSnap: Buffer | null;
  /** Map of input values that triggered this snapshot */
  input: Map<Buffer, unknown>;
  /** Map of state values at this snapshot */
  state: Map<Buffer, unknown>;
  /** Map of output values produced by this snapshot */
  output: Map<Buffer, unknown>;
  /** Unix timestamp when this snapshot was created */
  timestamp: number;
}

/**
 * Represents the State-Time Machine instance.
 * The STM manages state transitions and maintains the history of state changes
 * through a series of snapshots.
 */
export interface ISTM {
  /** Storage service for persisting state */
  storage: IStorageService;
  /** In-memory cache for quick access to recent values */
  cache: Map<Buffer, unknown>;
  /** Pending changes that haven't been committed to storage */
  diff: Map<Buffer, unknown>;
}

/**
 * Input type for state transitions.
 * Represents a collection of key-value pairs that trigger state changes.
 */
export type Input = Map<Buffer, unknown>;

/**
 * Error class for HSTM-specific errors.
 * Provides detailed error information for debugging and error handling.
 */
export class HSTMError extends Error {
  /**
   * Creates a new HSTM error.
   * @param message - Detailed error message
   * @param code - Error code for programmatic error handling
   */
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'HSTMError';
    Object.setPrototypeOf(this, HSTMError.prototype);
  }
}

/**
 * Creates a new STM instance with the specified storage.
 * Initializes the state machine with empty cache and diff maps.
 * 
 * @param storage - The storage service to use for persisting state
 * @returns A new ISTM instance
 * @throws {HSTMError} If initialization fails
 */
export async function createSTM(storage: IStorageService): Promise<ISTM> {
  try {
    if (!storage) {
      throw new HSTMError('Storage service is required', 'STORAGE_REQUIRED');
    }

    const cache = new Map<Buffer, unknown>();
    const diff = new Map<Buffer, unknown>();

    return {
      storage,
      cache,
      diff,
    };
  } catch (error: unknown) {
    if (error instanceof HSTMError) {
      throw error;
    }
    throw new HSTMError(
      `Failed to create STM: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'INITIALIZATION_ERROR'
    );
  }
}

/**
 * Processes a state transition with the given input
 */
export async function processSnap(
  stm: ISTM,
  input: Input,
): Promise<{ newState: Map<Buffer, unknown>; output: Map<Buffer, unknown> }> {
  try {
    if (!stm || !stm.storage) {
      throw new HSTMError('Invalid STM instance', 'INVALID_STM');
    }

    const newState = new Map(stm.cache);
    const output = new Map<Buffer, unknown>();

    // Process input and generate output
    for (const [key, value] of input.entries()) {
      newState.set(key, value);
      output.set(key, value);
    }

    return { newState, output };
  } catch (error: unknown) {
    if (error instanceof HSTMError) {
      throw error;
    }
    throw new HSTMError(
      `Failed to process snap: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'PROCESSING_ERROR'
    );
  }
}

/**
 * Commits a new snapshot to the STM
 */
export async function commitSnap(stm: ISTM, input: Input): Promise<Buffer> {
  try {
    const { cache, diff, storage } = stm;
    const timestamp = Date.now();
    const { newState, output } = await processSnap(stm, input);

    const newSnap: ISnap = {
      prevSnap: cache.size > 0 ? [...cache.keys()][0] : null,
      input,
      state: newState,
      output,
      timestamp,
    };

    const snapId = Buffer.from(timestamp.toString());

    // Update diff map
    for (const [key, value] of newState.entries()) {
      diff.set(key, value);
    }

    // Persist snap
    await storage.put(snapId, Buffer.from(JSON.stringify(newSnap)));

    // Update cache
    stm.cache = newState;

    return snapId;
  } catch (error: unknown) {
    throw new HSTMError(
      `Failed to commit snap: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'SNAP_COMMIT_FAILED'
    );
  }
}

/**
 * Flushes pending changes to the database
 */
export async function flushDiff(stm: ISTM): Promise<void> {
  try {
    const { storage, cache, diff } = stm;

    for (const [key, value] of diff.entries()) {
      await storage.put(key, Buffer.from(JSON.stringify(value)));
      cache.set(key, value);
    }

    diff.clear();
  } catch (error: unknown) {
    throw new HSTMError(
      `Failed to flush diff: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'DIFF_FLUSH_FAILED'
    );
  }
}

/**
 * Retrieves the current state of the STM
 */
export function getCurrentState(stm: ISTM): Map<Buffer, unknown> {
  return new Map(stm.cache);
}

/**
 * Retrieves a specific snapshot by ID
 */
export async function getSnap(stm: ISTM, snapId: Buffer): Promise<ISnap | null> {
  try {
    const snapData = await stm.storage.get(snapId);
    return snapData ? JSON.parse(snapData.toString()) as ISnap : null;
  } catch (error: unknown) {
    if (error instanceof HSTMError && error.code === 'KEY_NOT_FOUND') {
      return null;
    }
    throw new HSTMError(
      `Failed to get snap: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'SNAP_RETRIEVAL_FAILED'
    );
  }
}
