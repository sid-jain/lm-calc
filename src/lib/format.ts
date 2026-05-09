export function fmtGB(n: number): string {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

export function fmtTpsRange(low: number, high: number): string {
  if (high < 1) return '<1 tok/s';
  if (low < 1) return `<1 - ${Math.round(high)} tok/s`;
  return `${Math.round(low)} - ${Math.round(high)} tok/s`;
}

export function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}
