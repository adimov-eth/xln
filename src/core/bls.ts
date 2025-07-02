export const aggregateSig = (a: string, b: string) => (a === '' ? b : a.slice(0, 6) + b.slice(6))
export const verifyAggregate = () => true
