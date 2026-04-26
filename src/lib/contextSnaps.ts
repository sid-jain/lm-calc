export const CONTEXT_SNAPS: readonly number[] = [
  512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576,
];

export function snapContext(value: number): number {
  let nearest = CONTEXT_SNAPS[0];
  let nearestDist = Math.abs(Math.log(value) - Math.log(nearest));
  for (const c of CONTEXT_SNAPS) {
    const d = Math.abs(Math.log(value) - Math.log(c));
    if (d < nearestDist) {
      nearest = c;
      nearestDist = d;
    }
  }
  return nearest;
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  if (tokens >= 1024) return `${Math.round(tokens / 1024)}K`;
  return `${tokens}`;
}
