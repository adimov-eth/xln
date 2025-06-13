// Pipeline utility for composing async operations

export type PipelineContext<T> = T & {
  errors: ErrorCollector;
};

export type PipelineStep<T> = (ctx: PipelineContext<T>) => Promise<PipelineContext<T>>;

export class ErrorCollector {
  private errors: Array<{ error: any; severity: ErrorSeverity; context?: any }> = [];
  
  add(error: any, severity: ErrorSeverity, context?: any): void {
    this.errors.push({ error, severity, context });
  }
  
  addCritical(error: any, context?: any): void {
    this.add(error, ErrorSeverity.CRITICAL, context);
  }
  
  addError(error: any, context?: any): void {
    this.add(error, ErrorSeverity.ERROR, context);
  }
  
  addWarning(error: any, context?: any): void {
    this.add(error, ErrorSeverity.WARNING, context);
  }
  
  hasCritical(): boolean {
    return this.errors.some(e => e.severity === ErrorSeverity.CRITICAL);
  }
  
  hasErrors(): boolean {
    return this.errors.length > 0;
  }
  
  format(): string {
    return this.errors.map(({ error, severity, context }) => 
      `[${ErrorSeverity[severity]}] ${error?.message || error} ${context ? JSON.stringify(context) : ''}`
    ).join('\n');
  }
  
  merge(other: ErrorCollector): void {
    this.errors.push(...other.errors);
  }
}

export enum ErrorSeverity {
  DEBUG = 0,
  WARNING = 1,
  ERROR = 2,
  CRITICAL = 3
}

export function createPipeline<T>(...steps: PipelineStep<T>[]): PipelineStep<T> {
  return async (initialCtx: PipelineContext<T>) => {
    let ctx = initialCtx;
    
    for (const step of steps) {
      // Short-circuit on critical errors
      if (ctx.errors.hasCritical()) {
        return ctx;
      }
      
      try {
        ctx = await step(ctx);
      } catch (error) {
        ctx.errors.addCritical(error, { step: step.name });
        return ctx;
      }
    }
    
    return ctx;
  };
}