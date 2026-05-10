#!/usr/bin/env tsx
/**
 * bench-matrix.ts — emit a (ctx, ctk, ctv) test matrix for a model.
 *
 * Reads ONLY `arch.maxContext` from src/data/models.json and the set of valid
 * KV-quant ids from src/lib/kvCacheQuants.ts. By design, no calculator math
 * (estimateMemory, kvCacheGB, bandwidth) is consulted — the bench results need
 * to be ground truth produced independently of the model under test, so the
 * matrix that defines what to measure cannot depend on it either.
 *
 * Usage:  tsx scripts/bench-matrix.ts <model-id>   → JSON list to stdout
 */
import { models } from '../src/lib/loadModels';
import { KV_CACHE_QUANT_LEVELS } from '../src/lib/kvCacheQuants';

const MIN_CTX = 1024;
// Standard context ladder. Two short contexts to anchor low-end behavior, plus
// half-max and max so we exercise the long-context cases that pressure VRAM.
const BASE_CTX = [8192, 32768];

function buildMatrix(modelId: string): Array<{ ctx: number; ctk: string; ctv: string }> {
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

  const rows: Array<{ ctx: number; ctk: string; ctv: string }> = [];
  for (const ctx of ctxs) {
    for (const id of kvIds) {
      rows.push({ ctx, ctk: id, ctv: id });
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
