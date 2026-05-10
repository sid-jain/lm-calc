// Pure-function helpers for the Charts view: scales, tick generators, color
// palette, and path encoders. Split out from chartPrimitives.tsx so the .tsx
// file holds only React components (keeps react-refresh's only-export-components
// rule happy and lets future refactors test the math without React).

export interface Scale {
  (value: number): number;
  invert: (px: number) => number;
  domain: [number, number];
  range: [number, number];
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const f = (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
  f.invert = (px: number) => d0 + ((px - r0) / (r1 - r0)) * span;
  f.domain = domain;
  f.range = range;
  return f as Scale;
}

export function logScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  const lspan = l1 - l0;
  const f = (v: number) => r0 + ((Math.log10(v) - l0) / lspan) * (r1 - r0);
  f.invert = (px: number) => 10 ** (l0 + ((px - r0) / (r1 - r0)) * lspan);
  f.domain = domain;
  f.range = range;
  return f as Scale;
}

// Pretty log-scale ticks at powers of 2 (memory ctx + depth are token counts;
// 2^n ticks are the natural labels — 1K, 4K, 16K, 64K, 256K, …).
export function powerOfTwoTicks(min: number, max: number): number[] {
  const out: number[] = [];
  let v = 1;
  while (v < min) v *= 2;
  while (v <= max) {
    out.push(v);
    v *= 2;
  }
  return out;
}

// Pretty linear-scale ticks: ~5 evenly-spaced rounded values.
export function niceLinearTicks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const rough = span / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  let step;
  if (norm < 1.5) step = mag;
  else if (norm < 3.5) step = 2 * mag;
  else if (norm < 7.5) step = 5 * mag;
  else step = 10 * mag;
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 0.0001; v += step) out.push(v);
  return out;
}

export function fmtCtx(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)}M`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}K`;
  return String(n);
}

// Six-color palette tuned to read in both light + dark themes. Lifted from
// Tailwind's 500-tier (vibrant enough on light bg) — paired with stroke-2 in
// the chart components so they don't get washed out.
const SERIES_COLORS = [
  '#0ea5e9', // sky-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#a855f7', // purple-500
  '#ef4444', // red-500
  '#14b8a6', // teal-500
];

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

// Polyline `points` attribute string from an array of (x, y) pairs.
export function pointsToPath(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

// Filled area between two paths (upper and lower). Used for the prediction band.
export function bandPath(upper: Array<[number, number]>, lower: Array<[number, number]>): string {
  const top = upper.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ');
  const bot = [...lower]
    .reverse()
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' L ');
  return `M ${top} L ${bot} Z`;
}
