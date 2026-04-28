import { decodeTokensPerSecond } from './memory';
import type { MemoryEstimate, Model, QuantLevel } from './types';

export type SortKey =
  | 'memory-asc'
  | 'params-asc'
  | 'params-desc'
  | 'speed-desc'
  | 'speed-asc'
  | 'name'
  | 'developer';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'memory-asc', label: 'Total memory (smallest first)' },
  { value: 'speed-desc', label: 'Speed (fastest first)' },
  { value: 'speed-asc', label: 'Speed (slowest first)' },
  { value: 'params-desc', label: 'Parameters (largest first)' },
  { value: 'params-asc', label: 'Parameters (smallest first)' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'developer', label: 'Developer (A–Z)' },
];

export interface Row {
  model: Model;
  estimate: MemoryEstimate;
}

export interface SortContext {
  quant: QuantLevel;
  contextLen: number;
  bandwidthGBps: number;
}

function tps(row: Row, ctx: SortContext): number {
  return decodeTokensPerSecond(row.model, ctx.quant, ctx.contextLen, ctx.bandwidthGBps)
    .theoreticalTps;
}

export function compareWithin(a: Row, b: Row, key: SortKey, ctx: SortContext): number {
  switch (key) {
    case 'memory-asc':
      return a.estimate.totalGB - b.estimate.totalGB;
    case 'params-asc':
      return a.model.params - b.model.params;
    case 'params-desc':
      return b.model.params - a.model.params;
    case 'speed-desc':
      return tps(b, ctx) - tps(a, ctx);
    case 'speed-asc':
      return tps(a, ctx) - tps(b, ctx);
    case 'name':
      return a.model.displayName.localeCompare(b.model.displayName);
    case 'developer':
      return (
        a.model.developer.localeCompare(b.model.developer) ||
        a.model.params - b.model.params
      );
  }
}
