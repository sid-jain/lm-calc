// Bundled benchmark fixtures, baked at build time so the Charts view can
// overlay measured points on the calculator's predicted curves without a
// runtime fetch. The single combined JSON is produced by
// scripts/bundle-measurements.ts (run as predev/prebuild and from
// bench-import.ts) — concatenating every file under benchmarks/measurements/.
//
// `Sample` and `Fixture` shapes mirror the ones in scripts/bench-import.ts
// and src/lib/measurements.test.ts.

import rawMeasurements from './measurements.json';

export interface Sample {
  weight_quant_id: string;
  kv_quant_id: string;
  ctx: number;
  depth: number;
  // Absent === 'ok'. 'oom' marks a (ctx, depth) the GPU couldn't fit; pp/tg
  // are null on those rows. peak_vram_mib on OOM rows reflects partial
  // allocation before crash — diagnostic only, not a clean measurement.
  status?: 'oom';
  peak_vram_mib: number;
  pp_tok_s: number | null;
  tg_tok_s: number | null;
}

export interface Fixture {
  model_id: string;
  gpu_id: string;
  llama_cpp_commit: string;
  captured_at: string;
  samples: Sample[];
}

export const fixtures: Fixture[] = rawMeasurements as Fixture[];

/**
 * Returns the samples in the fixture for `(modelId, gpuId)` that match the
 * given weight quant. Returns `[]` when no fixture exists or none match.
 * The chart components further filter by `kv_quant_id` per series.
 */
export function findSamples(opts: {
  modelId: string;
  gpuId: string;
  weightQuantId: string;
}): Sample[] {
  const fx = fixtures.find((f) => f.model_id === opts.modelId && f.gpu_id === opts.gpuId);
  if (!fx) return [];
  return fx.samples.filter((s) => s.weight_quant_id === opts.weightQuantId);
}

/**
 * Whether ANY fixture exists for `(modelId, gpuId)` regardless of quant.
 * Used by the chart's empty-fixture footnote.
 */
export function hasFixture(modelId: string, gpuId: string): boolean {
  return fixtures.some((f) => f.model_id === modelId && f.gpu_id === gpuId);
}

/**
 * Number of samples for the most-specific filter the caller can supply.
 * Used by the SeriesManager popover to mark dropdown options that have
 * measured data: callers walk the (model → gpu → weight → kv) tree and ask
 * `samplesCount(...)` at each level. Zero is "predictions only".
 */
export function samplesCount(opts: {
  modelId?: string;
  gpuId?: string;
  weightQuantId?: string;
  kvQuantId?: string;
}): number {
  let count = 0;
  for (const fx of fixtures) {
    if (opts.modelId && fx.model_id !== opts.modelId) continue;
    if (opts.gpuId && fx.gpu_id !== opts.gpuId) continue;
    for (const s of fx.samples) {
      if (opts.weightQuantId && s.weight_quant_id !== opts.weightQuantId) continue;
      if (opts.kvQuantId && s.kv_quant_id !== opts.kvQuantId) continue;
      count++;
    }
  }
  return count;
}
