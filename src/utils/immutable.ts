
export const assoc = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> => {
  if (map.get(key) === value) return map;
  const newMap = new Map(map);
  newMap.set(key, value);
  return newMap;
};

export const dissoc = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  if (!map.has(key)) return map;
  const newMap = new Map(map);
  newMap.delete(key);
  return newMap;
};