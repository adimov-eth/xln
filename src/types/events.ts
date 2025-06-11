export interface ServerEvents {
  'block:processed': (height: number, txCount: number, hash: string) => void;
  'block:failed': (height: number, error: Error) => void;
  'entity:updated': (signerIdx: number, entityId: string, height: number) => void;
  'shutdown': () => void;
  [key: string]: (...args: any[]) => void;
} 