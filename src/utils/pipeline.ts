import { ErrorSeverity, type ErrorCollector, type PipelineContext, type PipelineStep } from '../types';

export class ErrorCollectorImpl implements ErrorCollector {
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
      `[${severity}] ${error?.message || error} ${context ? JSON.stringify(context) : ''}`
    ).join('\n');
  }
  
  merge(other: ErrorCollector): void {
    if (other instanceof ErrorCollectorImpl) {
      this.errors.push(...other.errors);
    }
  }
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