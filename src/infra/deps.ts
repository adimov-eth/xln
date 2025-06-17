// ============================================================================
// infra/deps.ts - External dependencies
// ============================================================================

import type { Clock } from '../core/block.js';

export type Logger = {
  readonly info: (msg: string, data?: any) => void;
  readonly warn: (msg: string, data?: any) => void;
  readonly error: (msg: string, data?: any) => void;
};

export const SystemClock: Clock = {
  now: () => Date.now()
};

export const ConsoleLogger: Logger = {
  info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[ERROR] ${msg}`, data || '')
};

export const SilentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {}
}; 
