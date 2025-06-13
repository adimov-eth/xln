import { EntityId, SignerIdx, BlockHeight } from './types';

// Error severity levels
export enum ErrorSeverity {
  DEBUG = 'debug',      // Informational, can be ignored
  WARNING = 'warning',  // Should be logged but doesn't stop processing
  ERROR = 'error',      // Serious issue but can continue
  CRITICAL = 'critical' // Must stop processing
}

// Enhanced error types with severity
export interface ErrorWithSeverity {
  error: any;
  severity: ErrorSeverity;
  context?: {
    entityId?: EntityId;
    signer?: SignerIdx;
    height?: BlockHeight;
    operation?: string;
  };
  timestamp: number;
}

// Error collector for batch operations
export class ErrorCollector {
  private errors: ErrorWithSeverity[] = [];
  
  add(error: any, severity: ErrorSeverity, context?: ErrorWithSeverity['context']) {
    this.errors.push({
      error,
      severity,
      context,
      timestamp: Date.now()
    });
  }
  
  addDebug(error: any, context?: ErrorWithSeverity['context']) {
    this.add(error, ErrorSeverity.DEBUG, context);
  }
  
  addWarning(error: any, context?: ErrorWithSeverity['context']) {
    this.add(error, ErrorSeverity.WARNING, context);
  }
  
  addError(error: any, context?: ErrorWithSeverity['context']) {
    this.add(error, ErrorSeverity.ERROR, context);
  }
  
  addCritical(error: any, context?: ErrorWithSeverity['context']) {
    this.add(error, ErrorSeverity.CRITICAL, context);
  }
  
  hasCritical(): boolean {
    return this.errors.some(e => e.severity === ErrorSeverity.CRITICAL);
  }
  
  hasErrors(): boolean {
    return this.errors.some(e => 
      e.severity === ErrorSeverity.ERROR || 
      e.severity === ErrorSeverity.CRITICAL
    );
  }
  
  getErrors(): ErrorWithSeverity[] {
    return [...this.errors];
  }
  
  getBySeverity(severity: ErrorSeverity): ErrorWithSeverity[] {
    return this.errors.filter(e => e.severity === severity);
  }
  
  clear() {
    this.errors = [];
  }
  
  merge(other: ErrorCollector) {
    this.errors.push(...other.getErrors());
  }
  
  // Format errors for logging
  format(): string {
    if (this.errors.length === 0) return 'No errors';
    
    const grouped = this.errors.reduce((acc, err) => {
      if (!acc[err.severity]) acc[err.severity] = [];
      acc[err.severity].push(err);
      return acc;
    }, {} as Record<ErrorSeverity, ErrorWithSeverity[]>);
    
    let output = `Collected ${this.errors.length} errors:\n`;
    
    for (const [severity, errors] of Object.entries(grouped)) {
      output += `\n[${severity.toUpperCase()}] (${errors.length}):\n`;
      errors.forEach(err => {
        const ctx = err.context;
        const ctxStr = ctx ? 
          ` | ${ctx.operation || 'unknown'} @ ${ctx.entityId || 'unknown'}:${ctx.signer || '?'}` : '';
        
        // Better error message extraction
        let errorMsg = '';
        if (typeof err.error === 'string') {
          errorMsg = err.error;
        } else if (err.error?.message) {
          errorMsg = err.error.message;
        } else if (err.error?.type) {
          // Handle ProcessingError types
          errorMsg = `${err.error.type}: ${err.error.message || err.error.field || JSON.stringify(err.error)}`;
        } else {
          errorMsg = JSON.stringify(err.error);
        }
        
        output += `  - ${errorMsg}${ctxStr}\n`;
      });
    }
    
    return output;
  }
}

// Result type with error collection
export type CollectedResult<T> = {
  ok: true;
  value: T;
  errors: ErrorCollector;
} | {
  ok: false;
  errors: ErrorCollector;
};

export const CollectedOk = <T>(value: T, errors?: ErrorCollector): CollectedResult<T> => ({
  ok: true,
  value,
  errors: errors || new ErrorCollector()
});

export const CollectedErr = (errors: ErrorCollector): CollectedResult<never> => ({
  ok: false,
  errors
});