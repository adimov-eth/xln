import { ErrorSeverity, type PipelineContext, type PipelineStep } from '../types';

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