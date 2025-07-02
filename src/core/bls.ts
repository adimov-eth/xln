export const aggregateSig = (a: string, b: string) => (a === '' ? b : a.slice(0, 6) + b.slice(6))
export const verifyAggregate = async (
  _hanko: string,
  _frame: unknown,
  _sigs: Record<string, string>,
  _q: unknown,
) => true
