export const toDeterministicJson = (value: unknown): unknown => {
  if (value == null)           return '';
  if (typeof value === 'bigint') return value.toString();
  if (['string','number','boolean'].includes(typeof value)) return value;
  
  if (Array.isArray(value)) {
    // Pre-compute canonical form and JSON representation for each element
    const items = value.map(item => {
      const canonical = toDeterministicJson(item);
      return { canonical, json: JSON.stringify(canonical) };
    });
    
    // Sort by pre-computed JSON representation
    items.sort((a, b) => a.json.localeCompare(b.json));
    
    // Return just the canonical forms
    return items.map(item => item.canonical);
  }
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