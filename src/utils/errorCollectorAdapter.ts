import { ErrorSeverity, type ErrorCollector as MutableErrorCollector } from '../types';
import { type ErrorCollector, emptyCollector } from './errorCollector';

/**
 * Adapter that wraps the functional ErrorCollector to provide
 * the mutable interface expected by existing pipeline steps
 */
export class ErrorCollectorAdapter implements MutableErrorCollector {
  private collector: ErrorCollector;
  
  constructor(initial: ErrorCollector = emptyCollector) {
    this.collector = initial;
  }
  
  add(error: any, severity: ErrorSeverity, context?: any): void {
    this.collector = this.collector.add(error, severity, context);
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
    return this.collector.hasCritical();
  }
  
  hasErrors(): boolean {
    return this.collector.hasErrors();
  }
  
  format(): string {
    return this.collector.format();
  }
  
  merge(other: MutableErrorCollector): void {
    if (other instanceof ErrorCollectorAdapter) {
      // Merge all entries from the other collector
      for (const entry of other.collector.entries) {
        this.collector = this.collector.add(entry.error, entry.severity, entry.context);
      }
    }
  }
  
  // Expose the underlying functional collector
  get functionalCollector(): ErrorCollector {
    return this.collector;
  }
}