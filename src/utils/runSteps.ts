import type { PipelineContext, PipelineStep } from '../types';

/**
 * Simple step runner that executes pipeline steps in sequence
 * Stops on critical errors, but continues on warnings
 */
export async function runSteps<T>(
  initialContext: PipelineContext<T>,
  ...steps: PipelineStep<T>[]
): Promise<PipelineContext<T>> {
  let ctx = initialContext;
  
  for (const step of steps) {
    // Short-circuit on critical errors
    if (ctx.errors.hasCritical()) {
      return ctx;
    }
    
    try {
      ctx = await step(ctx);
    } catch (error) {
      // Add critical error and stop
      ctx.errors.addCritical(error, { 
        step: step.name || 'unknown',
        error: error instanceof Error ? error.message : String(error)
      });
      return ctx;
    }
  }
  
  return ctx;
}

/**
 * Compose multiple steps into a single step
 * This allows for modular composition of pipeline steps
 */
export function composeSteps<T>(
  name: string,
  ...steps: PipelineStep<T>[]
): PipelineStep<T> {
  const composed: PipelineStep<T> = async (ctx) => {
    return runSteps(ctx, ...steps);
  };
  
  // Set the name for debugging
  Object.defineProperty(composed, 'name', { value: name });
  
  return composed;
}