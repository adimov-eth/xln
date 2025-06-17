export class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;
  
  async acquire(): Promise<() => void> {
    if (this.queue.length >= 10_000) {
      throw new Error('Mutex queue overflow - possible deadlock');
    }
    
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    
    return new Promise(resolve => {
      this.queue.push(() => resolve(() => this.release()));
    });
  }
  
  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}