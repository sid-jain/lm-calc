// Pure-function helpers for the Charts view: scales, tick generators, color
// palette, path encoders, and series resolution. Split out from
// chartPrimitives.tsx so the .tsx file holds only React components (keeps
// react-refresh's only-export-components rule happy and lets future refactors
// test the math without React).
import type { Series } from '../../lib/appState';
import { DEVICES } from '../../lib/devices';
import { KV_CACHE_QUANT_LEVELS } from '../../lib/kvCacheQuants';
import { models } from '../../lib/loadModels';
import { QUANT_LEVELS } from '../../lib/quants';
import type { KvCacheQuant, Model, QuantLevel } from '../../lib/types';
import type { Device } from '../../lib/devices';

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

// Convert nvidia-smi-reported MiB (binary) to the calculator's decimal-GB
// units used by `estimateMemory().rangeGB` and `Device.memoryGB`. Putting
// measured peaks and predicted curves on the same y-axis (decimal GB)
// matches the rest of the UI, which displays GB everywhere else.
export const BYTES_PER_MIB = 1024 ** 2;
export const BYTES_PER_GB_DECIMAL = 1e9;
export function mibToGB(mib: number): number {
  return (mib * BYTES_PER_MIB) / BYTES_PER_GB_DECIMAL;
}

// Group a sample list (already filtered to one (model, gpu, weight, kv)
// series) into one entry per ctx. peak_vram_mib is shared across rows of
// the same config in the bench output, so plotting one marker per row would
// stack identical points on top of each other. OOM rows get a distinct
// hasOom flag (the chart renders ×) and DON'T contribute their
// peak_vram_mib to the group's peak — that value is the partial allocation
// captured just before the crash, not a real measurement. This mirrors the
// grouping logic in src/lib/measurements.test.ts:96-129.
export interface MemoryGroup {
  ctx: number;
  peakMib: number;
  hasOom: boolean;
  oomDepth?: number;
}
export function groupMemorySamplesByCtx(
  samples: ReadonlyArray<{
    ctx: number;
    depth: number;
    peak_vram_mib: number;
    status?: 'oom';
  }>,
): MemoryGroup[] {
  const groups = new Map<number, MemoryGroup>();
  for (const s of samples) {
    const g = groups.get(s.ctx) ?? { ctx: s.ctx, peakMib: 0, hasOom: false };
    if (s.status === 'oom') {
      g.hasOom = true;
      g.oomDepth = s.depth;
    } else {
      g.peakMib = Math.max(g.peakMib, s.peak_vram_mib);
    }
    groups.set(s.ctx, g);
  }
  return Array.from(groups.values()).sort((a, b) => a.ctx - b.ctx);
}

// Resolve a `(modelId, gpuId, weightQuantId, kvQuantId)` series tuple to the
// typed objects the math + chart layers need. Returns null when any id
// doesn't resolve — callers filter those out (the URL deserializer already
// drops unknown ids, but defense-in-depth here costs nothing).
export interface ResolvedSeries {
  series: Series;
  model: Model;
  device: Device;
  weightQuant: QuantLevel;
  kvQuant: KvCacheQuant;
}
export function resolveSeries(s: Series): ResolvedSeries | null {
  const model = models.find((m) => m.id === s.modelId);
  const device = DEVICES.find((d) => d.id === s.gpuId);
  const weightQuant = QUANT_LEVELS.find((q) => q.id === s.weightQuantId);
  const kvQuant = KV_CACHE_QUANT_LEVELS.find((q) => q.id === s.kvQuantId);
  if (!model || !device || !weightQuant || !kvQuant) return null;
  return { series: s, model, device, weightQuant, kvQuant };
}
