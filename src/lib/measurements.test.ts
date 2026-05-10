import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { models } from './loadModels';
import { QUANT_LEVELS } from './quants';
import { KV_CACHE_QUANT_LEVELS } from './kvCacheQuants';
import { DEVICES } from './devices';
import { estimateMemory, decodeTokensPerSecond } from './memory';

// Regression gate: for every measured sample under benchmarks/measurements/,
// assert that the calculator's UI bands still bracket reality. The bands are
// memory ×0.95–1.20 (set in memory.ts) and decode ×0.50–0.85. If a methodology
// change makes the bands miss measured truth, this test fails — exactly the
// signal we want before such a change ships.
//
// Fixtures are produced by scripts/bench.sh (raw measurements) → scripts/bench-import.ts
// (normalized JSON). The matrix that drives the bench is generated from raw
// model arch only (scripts/bench-matrix.ts), so the fixtures are independent of
// the math being validated.

interface Sample {
  weight_quant_id: string;
  kv_quant_id: string;
  ctx: number;
  depth: number;
  peak_vram_mib: number;
  pp_tok_s: number | null;
  tg_tok_s: number | null;
}

interface Fixture {
  model_id: string;
  gpu_id: string;
  llama_cpp_commit: string;
  captured_at: string;
  samples: Sample[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../../benchmarks/measurements');

function loadFixtures(): Fixture[] {
  if (!existsSync(FIXTURE_DIR)) return [];
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as Fixture);
}

const BYTES_PER_MIB = 1024 * 1024;
const BYTES_PER_GB = 1e9; // matches the calculator's GB convention (decimal, not GiB)

const fixtures = loadFixtures();

if (fixtures.length === 0) {
  // No measurements yet (e.g. fresh checkout). Emit a single passing test that
  // documents the contract, so the file is discoverable and obviously enabled
  // rather than silently empty.
  describe('measurement regression', () => {
    test('no fixtures yet — see benchmarks/README.md to capture one', () => {
      expect(fixtures).toHaveLength(0);
    });
  });
} else {
  for (const fx of fixtures) {
    const model = models.find((m) => m.id === fx.model_id);
    const device = DEVICES.find((d) => d.id === fx.gpu_id);

    describe(`measurements: ${fx.model_id} on ${fx.gpu_id}`, () => {
      test('fixture references a known model and device', () => {
        expect(model, `unknown model_id "${fx.model_id}"`).toBeDefined();
        expect(device, `unknown gpu_id "${fx.gpu_id}"`).toBeDefined();
      });

      if (!model || !device) return;

      for (const s of fx.samples) {
        const wq = QUANT_LEVELS.find((q) => q.id === s.weight_quant_id);
        const kvq = KV_CACHE_QUANT_LEVELS.find((q) => q.id === s.kv_quant_id);

        const sampleLabel = `${s.weight_quant_id}+${s.kv_quant_id} ctx=${s.ctx} depth=${s.depth}`;

        test(`${sampleLabel}: known weight + KV quant`, () => {
          expect(wq, `unknown weight_quant_id "${s.weight_quant_id}"`).toBeDefined();
          expect(kvq, `unknown kv_quant_id "${s.kv_quant_id}"`).toBeDefined();
        });

        if (!wq || !kvq) continue;

        // Memory band check. Peak VRAM in MiB (nvidia-smi convention) compared
        // against estimateMemory(...).rangeGB converted to MiB. The KV cache
        // size is driven by the configured ctx (llama-bench allocates the full
        // configured ctx up front), not the depth.
        test(`${sampleLabel}: peak VRAM inside predicted band`, () => {
          const est = estimateMemory(model, wq, s.ctx, kvq);
          const lowMib = (est.rangeGB.low * BYTES_PER_GB) / BYTES_PER_MIB;
          const highMib = (est.rangeGB.high * BYTES_PER_GB) / BYTES_PER_MIB;
          const msg =
            `Peak VRAM ${s.peak_vram_mib} MiB outside predicted band ` +
            `[${lowMib.toFixed(0)}, ${highMib.toFixed(0)}] MiB ` +
            `(point estimate ${(est.totalGB * 1000).toFixed(0)} MB; ` +
            `weights=${est.weightsGB.toFixed(2)} GB, kv=${est.kvCacheGB.toFixed(2)} GB)`;
          expect(s.peak_vram_mib, msg).toBeGreaterThanOrEqual(lowMib);
          expect(s.peak_vram_mib, msg).toBeLessThanOrEqual(highMib);
        });

        if (s.tg_tok_s !== null) {
          // Decode-speed band check. The bandwidth-bound formula's KV term
          // depends on how full context actually is at decode time — that's
          // `depth`, not the allocated `ctx`.
          test(`${sampleLabel}: tg tok/s inside predicted band`, () => {
            const sp = decodeTokensPerSecond(model, wq, s.depth, device.bandwidthGBps, kvq);
            const msg =
              `tg ${s.tg_tok_s} tok/s outside predicted band ` +
              `[${sp.lowTps.toFixed(1)}, ${sp.highTps.toFixed(1)}] tok/s ` +
              `(theoretical ${sp.theoreticalTps.toFixed(1)}; bandwidth=${sp.bandwidthGBps} GB/s)`;
            expect(s.tg_tok_s as number, msg).toBeGreaterThanOrEqual(sp.lowTps);
            expect(s.tg_tok_s as number, msg).toBeLessThanOrEqual(sp.highTps);
          });
        }
      }
    });
  }
}
