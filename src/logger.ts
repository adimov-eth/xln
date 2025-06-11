export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
}

class Logger {
  constructor(private minLevel: LogLevel = 'info') {}

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private log(level: LogLevel, scope: string, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      scope,
      message,
    };
    if (data !== undefined) {
      entry.data = data;
    }

    // Colored console output for development
    const colors = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m',  // green
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
    };
    const reset = '\x1b[0m';

    const coloredLevel = `${colors[level]}${level.toUpperCase()}${reset}`;
    const output = `[${entry.timestamp}] ${coloredLevel} [${scope}] ${message}`;
    
    if (level === 'error') {
      console.error(output, entry.data ? entry.data : '');
    } else {
      console.log(output, entry.data ? entry.data : '');
    }
  }

  debug(scope: string, message: string, data?: unknown): void {
    this.log('debug', scope, message, data);
  }

  info(scope: string, message: string, data?: unknown): void {
    this.log('info', scope, message, data);
  }

  warn(scope: string, message: string, data?: unknown): void {
    this.log('warn', scope, message, data);
  }

  error(scope: string, message: string, data?: unknown): void {
    this.log('error', scope, message, data);
  }
}

export const logger = new Logger();

// Default event listeners
import { events } from './events.ts';

events.on('block:processed', (height: number, txCount: number, hash: string) => {
  logger.info('Server', `Block ${height} processed: ${txCount} txs, hash: ${hash.slice(0, 8)}...`);
});

events.on('block:failed', (height: number, error: Error) => {
  logger.error('Server', `Block ${height} failed`, error);
});

events.on('entity:updated', (signerIdx: number, entityId: string, height: number) => {
  logger.debug('Entity', `Updated: signer=${signerIdx} entity=${entityId} height=${height}`);
});

events.on('shutdown', () => {
  logger.info('Server', 'Graceful shutdown initiated');
}); 