import type { ServerEvents } from './types/events.ts';

export type EventMap = Record<string, (...args: any[]) => void>;

class Emitter<T extends EventMap> {
  private listeners: { [K in keyof T]?: Set<T[K]> } = {};

  on<K extends keyof T>(event: K, listener: T[K]): void {
    (this.listeners[event] ||= new Set()).add(listener);
  }

  off<K extends keyof T>(event: K, listener: T[K]): void {
    this.listeners[event]?.delete(listener);
  }

  once<K extends keyof T>(event: K, listener: T[K]): void {
    const wrapped = (...args: Parameters<T[K]>) => {
      this.off(event, wrapped as unknown as T[K]);
      listener(...args);
    };
    this.on(event, wrapped as unknown as T[K]);
  }

  emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): void {
    this.listeners[event]?.forEach((l) => l(...args));
  }
}

export const events = new Emitter<ServerEvents>(); 