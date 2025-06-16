export const toDeterministicJson = (value: unknown): unknown => {
  if (value == null)           return '';
  if (typeof value === 'bigint') return value.toString();
  if (['string','number','boolean'].includes(typeof value)) return value;
  
  if (Array.isArray(value)) return value.map(toDeterministicJson);
  if (value instanceof Set) return Array.from(value).sort().map(toDeterministicJson);
  if (value instanceof Map) return Array.from(value.entries())
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([k, v]) => [toDeterministicJson(k), toDeterministicJson(v)]);
  
  if (typeof value === 'object') {
    return Object.keys(value as any).sort()
      .map(k => [k, toDeterministicJson((value as any)[k])]);
  }
  return String(value);
};