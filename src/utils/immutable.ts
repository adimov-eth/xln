// ============================================================================
// utils/immutable.ts - Efficient immutable operations
// ============================================================================

// Copy-on-write Map update - only clones if value changes
export const assoc = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> => {
  if (map.get(key) === value) return map;
  return new Map(map).set(key, value);
};

// Copy-on-write Map delete
export const dissoc = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  if (!map.has(key)) return map;
  const newMap = new Map(map);
  newMap.delete(key);
  return newMap;
}; 
