import { ErrorSeverity, type ErrorCollector as IErrorCollector } from '../types';

/**
 * Immutable error issue
 */
export interface Issue {
  readonly severity: ErrorSeverity;
  readonly error: any;
  readonly context?: any;
  readonly timestamp: number;
}

/**
 * Immutable error collection
 */
export interface ImmutableErrors {
  readonly issues: readonly Issue[];
}

/**
 * Create an empty error collection
 */
export const emptyErrors = (): ImmutableErrors => ({
  issues: []
});

/**
 * Add an issue to the collection (returns new collection)
 */
export const addIssue = (
  errors: ImmutableErrors,
  severity: ErrorSeverity,
  error: any,
  context?: any
): ImmutableErrors => ({
  issues: [
    ...errors.issues,
    {
      severity,
      error,
      context,
      timestamp: Date.now()
    }
  ]
});

/**
 * Add a critical error
 */
export const addCritical = (
  errors: ImmutableErrors,
  error: any,
  context?: any
): ImmutableErrors => addIssue(errors, ErrorSeverity.CRITICAL, error, context);

/**
 * Add an error
 */
export const addError = (
  errors: ImmutableErrors,
  error: any,
  context?: any
): ImmutableErrors => addIssue(errors, ErrorSeverity.ERROR, error, context);

/**
 * Add a warning
 */
export const addWarning = (
  errors: ImmutableErrors,
  error: any,
  context?: any
): ImmutableErrors => addIssue(errors, ErrorSeverity.WARNING, error, context);

/**
 * Check if there are critical errors
 */
export const hasCritical = (errors: ImmutableErrors): boolean =>
  errors.issues.some(issue => issue.severity === ErrorSeverity.CRITICAL);

/**
 * Check if there are any errors (including warnings)
 */
export const hasErrors = (errors: ImmutableErrors): boolean =>
  errors.issues.length > 0;

/**
 * Format errors for display
 */
export const formatErrors = (errors: ImmutableErrors): string => {
  if (errors.issues.length === 0) return 'No errors';
  
  const grouped = errors.issues.reduce((acc, issue) => {
    const key = ErrorSeverity[issue.severity];
    if (!acc[key]) acc[key] = [];
    acc[key].push(issue);
    return acc;
  }, {} as Record<string, Issue[]>);
  
  return Object.entries(grouped)
    .map(([severity, issues]) => 
      `${severity}: ${issues.length} issue(s)\n` +
      issues.map(i => `  - ${formatError(i.error)}${i.context ? ` (${JSON.stringify(i.context)})` : ''}`).join('\n')
    )
    .join('\n\n');
};

/**
 * Format a single error
 */
const formatError = (error: any): string => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    if (error.message) return error.message;
    if (error.type && error.message) return `${error.type}: ${error.message}`;
    return JSON.stringify(error);
  }
  return String(error);
};

/**
 * Merge two error collections
 */
export const mergeErrors = (
  errors1: ImmutableErrors,
  errors2: ImmutableErrors
): ImmutableErrors => ({
  issues: [...errors1.issues, ...errors2.issues]
});

/**
 * Simple mutable error collector implementation
 */
export class ErrorCollector implements IErrorCollector {
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
    if (this.errors.length === 0) return 'No errors';
    
    return this.errors
      .map(e => `[${e.severity}] ${e.error instanceof Error ? e.error.message : String(e.error)}${e.context ? ` | ${JSON.stringify(e.context)}` : ''}`)
      .join('\n');
  }

  merge(other: IErrorCollector): void {
    if (other instanceof ErrorCollector) {
      this.errors.push(...other.errors);
    }
  }
}