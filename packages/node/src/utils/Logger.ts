/**
 * Logger configuration interface
 */
export interface ILoggerConfig {
  name: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Simple logger utility
 */
export class Logger {
  private name: string;
  private level: string;

  constructor(config: ILoggerConfig) {
    this.name = config.name;
    this.level = config.level || 'info';
  }

  /**
   * Logs debug message
   */
  public debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(`[${this.name}] ${message}`, ...args);
    }
  }

  /**
   * Logs info message
   */
  public info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(`[${this.name}] ${message}`, ...args);
    }
  }

  /**
   * Logs warning message
   */
  public warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`[${this.name}] ${message}`, ...args);
    }
  }

  /**
   * Logs error message
   */
  public error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(`[${this.name}] ${message}`, ...args);
    }
  }

  /**
   * Checks if message should be logged based on level
   */
  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }
}
