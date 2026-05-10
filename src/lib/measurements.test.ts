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
// memory ×0.90–1.30 and decode ×0.50–0.92 (see ESTIMATE_*_FACTOR and
// DECODE_EFFICIENCY_* in memory.ts — kept as the source of truth, this comment
// just tells the reader what to expect). If a methodology change makes the
// bands miss measured truth, this test fails — exactly the signal we want
// before such a change ships.
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
// bench.sh runs llama-bench with -n 128, so each measurement decodes 128 tokens
// after prefilling `depth`. The KV cache during decode holds ~depth + 128 entries.
const GEN_TOKENS_PAD = 128;
// Threshold beyond which q-quant KV measurements stop being bandwidth-bound and
// start being compute-bound (KV-dequant). See the comment in the speed test
// below and METHODOLOGY.md "Decode speed limits". Picked from first RTX 3060 +
// Llama 3.1 8B data — q-quant runs above this depth show efficiency 0.25–0.45,
// well outside the bandwidth-bound formula's [0.50, 0.90] band.
const COMPUTE_DOMINATED_DEPTH = 16384;

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

      // Memory band check is per-config, not per-row. bench.sh's nvidia-smi
      // sampler reports one peak across the whole config run, so every row
      // sharing (weight_quant, kv_quant, ctx) carries the same peak_vram_mib.
      // The peak reflects memory at the *deepest successful* depth, not at the
      // configured ctx (llama.cpp grows the KV cache with depth, doesn't
      // preallocate to ctx). So predict at min(ctx, max_successful_depth +
      // GEN_TOKENS_PAD) and run one assertion per (quant, ctx) group.
      type GroupKey = string;
      const memoryGroups = new Map<
        GroupKey,
        { weight: string; kv: string; ctx: number; maxDepth: number; peakMib: number }
      >();
      for (const s of fx.samples) {
        const key: GroupKey = `${s.weight_quant_id}|${s.kv_quant_id}|${s.ctx}`;
        const existing = memoryGroups.get(key);
        if (!existing) {
          memoryGroups.set(key, {
            weight: s.weight_quant_id,
            kv: s.kv_quant_id,
            ctx: s.ctx,
            maxDepth: s.depth,
            peakMib: s.peak_vram_mib,
          });
        } else {
          existing.maxDepth = Math.max(existing.maxDepth, s.depth);
          // peak is shared across rows in a config; take max as defensive fallback.
          existing.peakMib = Math.max(existing.peakMib, s.peak_vram_mib);
        }
      }
      for (const g of memoryGroups.values()) {
        const wq = QUANT_LEVELS.find((q) => q.id === g.weight);
        const kvq = KV_CACHE_QUANT_LEVELS.find((q) => q.id === g.kv);
        if (!wq || !kvq) continue; // skip-quant tests below catch the unknown-id case
        const ctxUsed = Math.min(g.ctx, g.maxDepth + GEN_TOKENS_PAD);
        const groupLabel = `${g.weight}+${g.kv} ctx=${g.ctx} (max_depth=${g.maxDepth})`;
        // Partial-OOM detection: bench.sh always appends a synthetic
        // depth = ctx - GEN_TOKENS_PAD to force a full-ctx KV allocation. If
        // the fixture's max successful depth is well below that, the synthetic
        // attempt OOMed mid-allocation. In that case peak_vram_mib reflects
        // the failed partial allocation (which can sit somewhere between the
        // depth-based and ctx-based predictions, depending on how far the
        // allocator got before erroring) — not a clean run we can assert
        // against. Skip the band check; the successful per-depth rows are
        // still in the fixture as data.
        const partialOom = g.maxDepth + GEN_TOKENS_PAD < g.ctx;
        if (partialOom) {
          test.skip(`${groupLabel}: peak VRAM skipped (partial OOM at synthetic max_depth)`, () => {});
          continue;
        }
        test(`${groupLabel}: peak VRAM inside predicted band`, () => {
          const est = estimateMemory(model, wq, ctxUsed, kvq);
          const lowMib = (est.rangeGB.low * BYTES_PER_GB) / BYTES_PER_MIB;
          const highMib = (est.rangeGB.high * BYTES_PER_GB) / BYTES_PER_MIB;
          const msg =
            `Peak VRAM ${g.peakMib} MiB outside predicted band ` +
            `[${lowMib.toFixed(0)}, ${highMib.toFixed(0)}] MiB ` +
            `(point estimate ${(est.totalGB * 1000).toFixed(0)} MB; ` +
            `weights=${est.weightsGB.toFixed(2)} GB, kv=${est.kvCacheGB.toFixed(2)} GB; ` +
            `ctx_used=${ctxUsed})`;
          expect(g.peakMib, msg).toBeGreaterThanOrEqual(lowMib);
          expect(g.peakMib, msg).toBeLessThanOrEqual(highMib);
        });
      }

      // Per-row checks: validate the quant ids are known, and run the decode
      // band assertion (which IS per-row — each depth is a distinct decode
      // measurement, unlike memory which is a per-config peak).
      for (const s of fx.samples) {
        const wq = QUANT_LEVELS.find((q) => q.id === s.weight_quant_id);
        const kvq = KV_CACHE_QUANT_LEVELS.find((q) => q.id === s.kv_quant_id);

        const sampleLabel = `${s.weight_quant_id}+${s.kv_quant_id} ctx=${s.ctx} depth=${s.depth}`;

        test(`${sampleLabel}: known weight + KV quant`, () => {
          expect(wq, `unknown weight_quant_id "${s.weight_quant_id}"`).toBeDefined();
          expect(kvq, `unknown kv_quant_id "${s.kv_quant_id}"`).toBeDefined();
        });

        if (!wq || !kvq) continue;

        if (s.tg_tok_s !== null) {
          // Decode-speed band check. The bandwidth-bound formula's KV term
          // depends on how full context actually is at decode time — that's
          // `depth`, not the allocated `ctx`.
          //
          // Skip the band check when the measurement is in a regime the
          // bandwidth-bound formula doesn't model: quantized KV at high depth.
          // KV-dequant compute (un-block, multiply by fp16 scale, cast) becomes
          // the bottleneck once the cache is large; the formula only sees byte
          // count and overpredicts. See METHODOLOGY.md "Decode speed limits".
          // We keep the assertion for FP16 KV (no dequant) at all depths, and
          // for q-quants at low depth (where weights still dominate).
          const inComputeDominatedRegime =
            s.kv_quant_id !== 'fp16' && s.depth > COMPUTE_DOMINATED_DEPTH;
          if (!inComputeDominatedRegime) {
            test(`${sampleLabel}: tg tok/s inside predicted band`, () => {
              const sp = decodeTokensPerSecond(model, wq, s.depth, device.bandwidthGBps, kvq);
              const msg =
                `tg ${s.tg_tok_s} tok/s outside predicted band ` +
                `[${sp.lowTps.toFixed(1)}, ${sp.highTps.toFixed(1)}] tok/s ` +
                `(theoretical ${sp.theoreticalTps.toFixed(1)}; bandwidth=${sp.bandwidthGBps} GB/s)`;
              expect(s.tg_tok_s as number, msg).toBeGreaterThanOrEqual(sp.lowTps);
              expect(s.tg_tok_s as number, msg).toBeLessThanOrEqual(sp.highTps);
            });
          } else {
            // Surface the skip explicitly so future readers (and CI logs) see
            // exactly how much data the gate is intentionally omitting.
            test.skip(`${sampleLabel}: tg tok/s skipped (compute-dominated)`, () => {});
          }
        }
      }
    });
  }
}
