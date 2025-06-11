import type { LogLevel } from './logger.ts';

export type StorageType = 'leveldb' | 'memory';

export interface ServerConfig {
  readonly server: {
    readonly tickMs: number;
    readonly snapshotInterval: number;
  };
  readonly storage: {
    readonly type: StorageType;
    readonly path: string;
  };
  readonly logging: {
    readonly level: LogLevel;
  };
  readonly features: {
    readonly metrics: boolean;
    readonly events: boolean;
  };
}

const DEFAULT_CONFIG: ServerConfig = {
  server: {
    tickMs: 100,
    snapshotInterval: 100,
  },
  storage: {
    type: 'leveldb',
    path: './data',
  },
  logging: {
    level: 'info',
  },
  features: {
    metrics: false,
    events: true,
  },
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  return {
    server: {
      tickMs: parseInt(env.XLN_TICK_MS ?? DEFAULT_CONFIG.server.tickMs.toString()),
      snapshotInterval: parseInt(env.XLN_SNAPSHOT_INTERVAL ?? DEFAULT_CONFIG.server.snapshotInterval.toString()),
    },
    storage: {
      type: (env.XLN_STORAGE_TYPE as StorageType) ?? DEFAULT_CONFIG.storage.type,
      path: env.XLN_STORAGE_PATH ?? DEFAULT_CONFIG.storage.path,
    },
    logging: {
      level: (env.XLN_LOG_LEVEL as LogLevel) ?? DEFAULT_CONFIG.logging.level,
    },
    features: {
      metrics: env.XLN_ENABLE_METRICS === 'true',
      events: env.XLN_ENABLE_EVENTS !== 'false', // enabled by default
    },
  };
}; 