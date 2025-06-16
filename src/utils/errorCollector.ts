import { ErrorSeverity } from '../types';

type Entry = { error: unknown; severity: ErrorSeverity; context?: unknown };

export type ErrorCollector = Readonly<{
  entries: readonly Entry[];
  add: (err: unknown, sev?: ErrorSeverity, ctx?: unknown) => ErrorCollector;
  hasCritical: () => boolean;
  hasErrors: () => boolean;
  format: () => string;
}>;

export const emptyCollector: ErrorCollector = (() => {
  const make = (entries: Entry[]): ErrorCollector => ({
    entries,
    add: (error, severity = ErrorSeverity.ERROR, context) =>
      make([...entries, { error, severity, context }]),
    hasCritical: () => entries.some(e => e.severity === ErrorSeverity.CRITICAL),
    hasErrors:   () => entries.length > 0,
    format:      () => entries.map(e =>
      `[${e.severity}] ${e.error instanceof Error ? e.error.message : String(e.error)}`
      + (e.context ? ` | ${JSON.stringify(e.context)}` : '')
    ).join('\n')
  });
  return make([]);
})();