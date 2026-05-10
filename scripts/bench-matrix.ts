#!/usr/bin/env tsx
/**
 * bench-matrix.ts — emit a (ctx, ctk, ctv, depths) test matrix for a model.
 *
 * Reads ONLY `arch.maxContext` from src/data/models.json and the set of valid
 * KV-quant ids from src/lib/kvCacheQuants.ts. By design, no calculator math
 * (estimateMemory, kvCacheGB, bandwidth) is consulted — the bench results need
 * to be ground truth produced independently of the model under test, so the
 * matrix that defines what to measure cannot depend on it either.
 *
 * Why per-row depths: speed (pp/tg) at a given depth is essentially independent
 * of the configured ctx (the data showed depth=512 tg/s landing within ~0.3
 * tok/s across 4 ctx values). So measuring the same depth at every ctx —
 * which the previous flat (ctx, kv) matrix did — collected redundant speed
 * data. With a per-row depths list, we walk ctxs in ascending order and only
 * include each ladder point at the smallest ctx where it fits. Peak VRAM is
 * still measured at every ctx (driven by the synthetic max-depth probe added
 * by bench.sh, which forces full-KV allocation regardless of the configured
 * depth list), so the VRAM-vs-ctx coverage is preserved.
 *
 * Usage:  tsx scripts/bench-matrix.ts <model-id>   → JSON list to stdout
 */
import { models } from '../src/lib/loadModels';
import { KV_CACHE_QUANT_LEVELS } from '../src/lib/kvCacheQuants';

const MIN_CTX = 1024;
// Context ladder. Two short contexts anchor low-end behavior; half-max and
// max exercise long-context VRAM pressure (and feed OOM-direction assertions
// in measurements.test.ts when long-ctx fp16 doesn't fit on smaller cards).
const BASE_CTX = [8192, 32768];
// Decode-depth ladder. Doubling cadence so each step roughly doubles KV-cache
// fill, which is the variable that actually moves tg tok/s. Long-end points
// (64K..512K) cover the dequant-bottleneck regime documented in METHODOLOGY.md
// "Decode speed limits" — previously only sampled via the synthetic ctx-128
// probe, which gave just one point per ctx.
const DEPTH_LADDER = [512, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288];
// Must match GEN_TOKENS in bench.sh — bench expects (depth + GEN_TOKENS_PAD)
// tokens to fit in ctx (decode generates GEN_TOKENS more after prefilling depth).
const GEN_TOKENS_PAD = 128;

function buildMatrix(
  modelId: string,
): Array<{ ctx: number; ctk: string; ctv: string; depths: number[] }> {
  const m = models.find((x) => x.id === modelId);
  if (!m) {
    const ids = models.map((x) => x.id).join(', ');
    throw new Error(`Unknown model-id: ${modelId}. Valid ids: ${ids}`);
  }
  const max = m.arch.maxContext;
  const ctxSet = new Set<number>();
  for (const c of [...BASE_CTX, Math.floor(max / 2), max]) {
    if (c >= MIN_CTX && c <= max) ctxSet.add(c);
  }
  const ctxs = [...ctxSet].sort((a, b) => a - b);

  // Symmetric KV cross: (fp16,fp16), (q8_0,q8_0), (q4_0,q4_0). Mixed-quant K/V
  // is rare in practice and would balloon the matrix; symmetric covers the
  // useful axis (overall KV size).
  const kvIds = KV_CACHE_QUANT_LEVELS.map((q) => q.id);

  // Walk ctxs ascending so each depth lands at its smallest viable ctx (gives
  // the cheapest llama-bench config that can produce that data point).
  const measured = new Set<number>();
  const rows: Array<{ ctx: number; ctk: string; ctv: string; depths: number[] }> = [];
  for (const ctx of ctxs) {
    const fitting = DEPTH_LADDER.filter((d) => d + GEN_TOKENS_PAD <= ctx);
    const newDepths = fitting.filter((d) => !measured.has(d));
    for (const d of newDepths) measured.add(d);
    // Emit the row even when newDepths is empty: bench.sh's synthetic ctx-128
    // depth still produces a peak-VRAM datapoint at this ctx, and that's the
    // primary reason to include the larger ctxs in the ladder.
    for (const id of kvIds) {
      rows.push({ ctx, ctk: id, ctv: id, depths: newDepths });
    }
  }
  return rows;
}

function main() {
  const modelId = process.argv[2];
  if (!modelId) {
    console.error('Usage: tsx scripts/bench-matrix.ts <model-id>');
    process.exit(1);
  }
  try {
    const rows = buildMatrix(modelId);
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}

main();
