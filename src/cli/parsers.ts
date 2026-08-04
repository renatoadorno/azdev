export function parseId(value: unknown, label = 'work item ID'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`Invalid ${label}: ${value}`);
    process.exit(1);
  }
  return n;
}
