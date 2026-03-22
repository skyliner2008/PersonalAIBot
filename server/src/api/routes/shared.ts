export function parseIntParam(
  value: unknown,
  defaultVal: number,
  min = 1,
  max = 1000,
): number {
  if (value == null) return defaultVal;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (Number.isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(n, max));
}
