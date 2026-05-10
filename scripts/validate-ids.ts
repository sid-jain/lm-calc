#!/usr/bin/env tsx
/**
 * validate-ids.ts — confirm a (model_id, weight_quant_id, gpu_id) triple
 * exists in the calculator's data, and emit machine-readable info for the
 * caller. Used by scripts/bench.sh up-front so a typo fails before we
 * spend 30 minutes building llama.cpp.
 *
 * Usage:
 *   tsx scripts/validate-ids.ts <model_id> <weight_quant_id> <gpu_id>
 *
 * On success, prints `maxContext=<N>` to stdout and exits 0.
 * On failure, prints a diagnostic to stderr and exits 2.
 *
 * Args are passed positionally so the bash caller doesn't have to interpolate
 * them into a JS string template (which historically meant a typo could
 * surface as a TS parse error instead of a clear "unknown id" message).
 */
import { models } from '../src/lib/loadModels';
import { QUANT_LEVELS } from '../src/lib/quants';
import { DEVICES } from '../src/lib/devices';

function main(): void {
  const [, , modelId, weightQuantId, gpuId] = process.argv;
  if (!modelId || !weightQuantId || !gpuId) {
    console.error('Usage: tsx scripts/validate-ids.ts <model_id> <weight_quant_id> <gpu_id>');
    process.exit(2);
  }
  const m = models.find((x) => x.id === modelId);
  if (!m) {
    console.error(`Unknown model-id: ${modelId}`);
    process.exit(2);
  }
  const q = QUANT_LEVELS.find((x) => x.id === weightQuantId);
  if (!q) {
    console.error(
      `Unknown weight-quant: ${weightQuantId} (valid: ${QUANT_LEVELS.map((x) => x.id).join(',')})`,
    );
    process.exit(2);
  }
  const d = DEVICES.find((x) => x.id === gpuId);
  if (!d) {
    console.error(`Unknown gpu-id: ${gpuId}`);
    process.exit(2);
  }
  // Single line of stdout, simple key=value format the caller can parse with
  // a one-line awk/sed rather than pulling in a JSON parser.
  console.log(`maxContext=${m.arch.maxContext}`);
}

main();
