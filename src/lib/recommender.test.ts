import { describe, expect, test } from 'vitest';
import { QUANT_LEVELS } from './quants';
import { recommend } from './recommender';
import type { Model } from './types';

const LLAMA_3_1_8B: Model = {
  id: 'llama-3-1-8b',
  displayName: 'Llama 3.1 8B',
  developer: 'Meta',
  hfRepo: 'meta-llama/Llama-3.1-8B',
  params: 8.03,
  isMoE: false,
  activeParams: null,
  arch: {
    layers: 32,
    attnHeads: 32,
    kvHeads: 8,
    headDim: 128,
    hiddenSize: 4096,
    vocabSize: 128256,
    tiedEmbeddings: false,
    maxContext: 131072,
    attentionType: 'gqa',
    slidingWindowSize: null,
    fullAttentionRatio: null,
    kvLoraRank: null,
    qkRopeHeadDim: null,
  },
};

const MIXTRAL_8X7B: Model = {
  id: 'mixtral-8x7b-v0-1',
  displayName: 'Mixtral 8x7B v0.1',
  developer: 'Mistral AI',
  hfRepo: 'mistralai/Mixtral-8x7B-v0.1',
  params: 46.703,
  isMoE: true,
  activeParams: 12.88,
  arch: {
    layers: 32,
    attnHeads: 32,
    kvHeads: 8,
    headDim: 128,
    hiddenSize: 4096,
    vocabSize: 32000,
    tiedEmbeddings: false,
    maxContext: 32768,
    attentionType: 'gqa',
    slidingWindowSize: null,
    fullAttentionRatio: null,
    kvLoraRank: null,
    qkRopeHeadDim: null,
  },
};

// 120 GB/s is chosen so that Q5_K_M just misses 10 tok/s lowTps (~8.85) while
// Q4_K_M clears it (~10.13), making Q4_K_M the highest-quality passing quant.
const BW_120 = 120;

describe('recommend — basic selection', () => {
  test('16 GB / 8k ctx / 10 tps at 120 GB/s recommends Llama-3.1-8B at Q4_K_M, not Q2_K', () => {
    const { matches } = recommend([LLAMA_3_1_8B], QUANT_LEVELS, {
      ramGB: 16,
      minContextLen: 8192,
      minTps: 10,
      bandwidthGBps: BW_120,
      lockQuantId: null,
      excludedDevs: new Set(),
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].model.id).toBe('llama-3-1-8b');
    expect(matches[0].quant.id).toBe('q4_k_m');
    expect(matches[0].quant.id).not.toBe('q2_k');
  });

  test('minTps higher than any 8B can deliver at 50 GB/s: no matches, rejected as too_slow', () => {
    // At 50 GB/s with FP16 KV, Llama 3.1 8B Q2_K lowTps ≈ 5.6 tok/s — below minTps=6.
    // We lock kv to fp16 because the auto-KV walk would pick Q4 KV at the cheapest
    // weight, making the cheapest combo faster than this test's intended threshold.
    const { matches, rejected } = recommend([LLAMA_3_1_8B], QUANT_LEVELS, {
      ramGB: 16,
      minContextLen: 8192,
      minTps: 6,
      bandwidthGBps: 50,
      lockQuantId: null,
      kvCacheQuantId: 'fp16',
      excludedDevs: new Set(),
    });
    expect(matches).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].hardwareReasons.map((r) => r.type)).toContain('too_slow');
  });
});

describe('recommend — lockQuantId', () => {
  test('lockQuantId=q4_k_m returns only Q4_K_M-quanted matches', () => {
    const { matches } = recommend([LLAMA_3_1_8B, MIXTRAL_8X7B], QUANT_LEVELS, {
      ramGB: 64,
      minContextLen: 8192,
      minTps: 5,
      bandwidthGBps: 200,
      lockQuantId: 'q4_k_m',
      excludedDevs: new Set(),
    });
    expect(matches.length).toBeGreaterThan(0);
    for (const r of matches) {
      expect(r.quant.id).toBe('q4_k_m');
    }
  });
});

describe('recommend — MoE', () => {
  test('Mixtral-8x7B appears when total params fit RAM, uses active params for speed', () => {
    // At Q2_K: total weights = 46.703 * 0.419 ≈ 19.57 GB, total ≈ 21.14 GB — fits in 32 GB.
    // Speed uses activeParams=12.88, giving ~11.6 lowTps at 150 GB/s > minTps=5.
    const { matches } = recommend([MIXTRAL_8X7B], QUANT_LEVELS, {
      ramGB: 32,
      minContextLen: 8192,
      minTps: 5,
      bandwidthGBps: 150,
      lockQuantId: null,
      excludedDevs: new Set(),
    });
    expect(matches.length).toBeGreaterThan(0);
    const rec = matches[0];
    expect(rec.model.id).toBe('mixtral-8x7b-v0-1');
    expect(rec.estimate.weightsGB).toBeGreaterThan(
      rec.model.activeParams! * rec.quant.bytesPerParam,
    );
    expect(rec.speed.lowTps).toBeGreaterThan(5);
  });

  test('Mixtral-8x7B rejected as no_quant_fits_ram when budget is too small', () => {
    // 20 GB is not enough for Mixtral at any quant (Q2_K needs ~21.1 GB)
    const { matches, rejected } = recommend([MIXTRAL_8X7B], QUANT_LEVELS, {
      ramGB: 20,
      minContextLen: 8192,
      minTps: 1,
      bandwidthGBps: 150,
      lockQuantId: null,
      excludedDevs: new Set(),
    });
    expect(matches).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].hardwareReasons.map((r) => r.type)).toContain('no_quant_fits_ram');
  });
});

describe('recommend — KV cache quant', () => {
  test('Q4 KV reduces RAM use vs FP16 — long-context model that overflows at FP16 fits at Q4', () => {
    // Llama 3.1 8B at Q4_K_M, 131072 ctx:
    //   weights ≈ 4.85 GB, FP16 KV ≈ 17.18 GB, total ≈ 22.53 GB
    //   Q4 KV ≈ 4.83 GB, total ≈ 10.18 GB
    // RAM budget 12 GB, lockQuantId=q4_k_m: rejects under FP16, accepts under Q4.
    const baseConstraints = {
      ramGB: 12,
      minContextLen: 131072,
      minTps: 0,
      bandwidthGBps: 200,
      lockQuantId: 'q4_k_m',
      excludedDevs: new Set<string>(),
    };
    const fp16 = recommend([LLAMA_3_1_8B], QUANT_LEVELS, {
      ...baseConstraints,
      kvCacheQuantId: 'fp16',
    });
    expect(fp16.matches).toHaveLength(0);
    expect(fp16.rejected[0].hardwareReasons.map((r) => r.type)).toContain('no_quant_fits_ram');

    const q4 = recommend([LLAMA_3_1_8B], QUANT_LEVELS, {
      ...baseConstraints,
      kvCacheQuantId: 'q4_0',
    });
    expect(q4.matches).toHaveLength(1);
    expect(q4.matches[0].kvQuant.id).toBe('q4_0');
  });

  test('omitting kvCacheQuantId is auto: picks FP16 when RAM permits', () => {
    // Plenty of RAM at 8K ctx — auto-KV walk hits FP16 first and stops.
    const c = {
      ramGB: 32,
      minContextLen: 8192,
      minTps: 0,
      bandwidthGBps: 200,
      lockQuantId: null,
      excludedDevs: new Set<string>(),
    };
    const dflt = recommend([LLAMA_3_1_8B], QUANT_LEVELS, c);
    const fp16 = recommend([LLAMA_3_1_8B], QUANT_LEVELS, { ...c, kvCacheQuantId: 'fp16' });
    expect(dflt.matches[0].estimate.totalGB).toBeCloseTo(fp16.matches[0].estimate.totalGB, 9);
    expect(dflt.matches[0].kvQuant.id).toBe('fp16');
  });

  test("'auto' kvCacheQuantId behaves identically to omitting it", () => {
    const c = {
      ramGB: 32,
      minContextLen: 8192,
      minTps: 0,
      bandwidthGBps: 200,
      lockQuantId: null,
      excludedDevs: new Set<string>(),
    };
    const auto = recommend([LLAMA_3_1_8B], QUANT_LEVELS, { ...c, kvCacheQuantId: 'auto' });
    const omitted = recommend([LLAMA_3_1_8B], QUANT_LEVELS, c);
    expect(auto.matches[0].kvQuant.id).toBe(omitted.matches[0].kvQuant.id);
    expect(auto.matches[0].quant.id).toBe(omitted.matches[0].quant.id);
  });

  test('auto KV downgrades to Q4 when FP16 and Q8 KV both overflow', () => {
    // Llama 3.1 8B, lockQuantId=q4_k_m, 128K ctx, RAM=12 GB:
    //   FP16 KV: 4.85 + 17.18 + 0.5 ≈ 22.53 GB  (overflows 12 GB)
    //   Q8 KV:   4.85 +  9.13 + 0.5 ≈ 14.48 GB  (still overflows 12 GB)
    //   Q4 KV:   4.85 +  4.83 + 0.5 ≈ 10.18 GB  (fits, joint loss 0.10)
    // Joint-loss scoring enumerates all three and picks Q4 (the only one that fits).
    const { matches } = recommend([LLAMA_3_1_8B], QUANT_LEVELS, {
      ramGB: 12,
      minContextLen: 131072,
      minTps: 0,
      bandwidthGBps: 200,
      lockQuantId: 'q4_k_m',
      kvCacheQuantId: 'auto',
      excludedDevs: new Set(),
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].kvQuant.id).toBe('q4_0');
    expect(matches[0].quant.id).toBe('q4_k_m');
  });

  test('auto KV downgrades to Q8 when FP16 KV would not fit but Q8 does', () => {
    // Pick a budget squarely between the FP16 and Q8 totals from the previous test:
    //   FP16: ~22.53 GB, Q8: ~14.48 GB. Budget=18 GB rejects FP16, accepts Q8.
    const { matches } = recommend([LLAMA_3_1_8B], QUANT_LEVELS, {
      ramGB: 18,
      minContextLen: 131072,
      minTps: 0,
      bandwidthGBps: 200,
      lockQuantId: 'q4_k_m',
      kvCacheQuantId: 'auto',
      excludedDevs: new Set(),
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].kvQuant.id).toBe('q8_0');
  });

  test('auto KV + auto weight at 32 GB / 8K ctx: picks FP16 weights + FP16 KV (lowest loss)', () => {
    // Plenty of headroom — Q8_0 / Q6_K / FP16 weights all fit, KV at any tier fits.
    // Joint-loss scoring picks FP16 weights + FP16 KV (loss 0). FP32 weights would
    // tie on quality but barely overflow at this RAM (8.03 × 4 = 32.12 GB, plus KV).
    const { matches } = recommend([LLAMA_3_1_8B], QUANT_LEVELS, {
      ramGB: 32,
      minContextLen: 8192,
      minTps: 0,
      bandwidthGBps: 200,
      lockQuantId: null,
      kvCacheQuantId: 'auto',
      excludedDevs: new Set(),
    });
    expect(matches[0].kvQuant.id).toBe('fp16');
    expect(matches[0].quant.id).toBe('fp16');
  });

  test('joint-loss scoring picks Q8_0+Q8 over Q3_K_M+FP16 when both fit', () => {
    // Llama 3.1 8B at 128K ctx, RAM=22 GB:
    //   Q4_K_M+FP16 = 22.53 GB → just over
    //   Q4_0+FP16   = 22.20 GB → just over
    //   Q3_K_M+FP16 = 21.61 GB → fits, weight loss 0.15
    //   Q8_0+Q8     = 18.16 GB → fits, joint loss 0.01  ← winner
    // The pre-fix walk (outer KV / inner weight / first-fit) picked Q3_K_M+FP16 — it
    // never compared across the KV axis. Joint-loss scoring picks Q8_0+Q8: better
    // weight precision *and* near-lossless KV, with a smaller total than Q3_K_M+FP16.
    const { matches } = recommend([LLAMA_3_1_8B], QUANT_LEVELS, {
      ramGB: 22,
      minContextLen: 131072,
      minTps: 0,
      bandwidthGBps: 1000,
      lockQuantId: null,
      kvCacheQuantId: 'auto',
      excludedDevs: new Set(),
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].quant.id).toBe('q8_0');
    expect(matches[0].kvQuant.id).toBe('q8_0');
  });

  test('joint-loss scoring picks Q4_K_M+Q8 over Q3_K_M+FP16 at a tight budget', () => {
    // Same selection logic as the user-reported Qwen 3.6 27B / RTX 3090 Ti case,
    // exercised against the existing Mixtral fixture (different arch, same shape:
    // a budget where the higher weight tier only fits once KV drops to Q8).
    //
    // Mixtral 46.703B at 32K ctx (32 layers, 8 kv_heads, 128 head_dim):
    //   FP16 KV per token = 32 × 2 × 8 × 128 × 32768 × 2 / 1e9 = 4.295 GB
    //   Q8_0 KV ≈ 2.281 GB,  Q4_0 KV ≈ 1.208 GB
    //   Q4_K_M weights = 28.21 GB → +FP16 KV = 33.0 GB; +Q8 KV = 30.99 GB
    //   Q3_K_M weights = 22.84 GB → +FP16 KV = 27.64 GB
    //   Budget=31 GB rejects Q4_K_M+FP16, accepts Q4_K_M+Q8 (30.99) and Q3_K_M+FP16 (27.64).
    // Joint loss: Q4_K_M+Q8 = 0.045, Q3_K_M+FP16 = 0.15 → Q4_K_M+Q8 wins.
    const { matches } = recommend([MIXTRAL_8X7B], QUANT_LEVELS, {
      ramGB: 31,
      minContextLen: 32768,
      minTps: 0,
      bandwidthGBps: 1000,
      lockQuantId: null,
      kvCacheQuantId: 'auto',
      excludedDevs: new Set(),
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].quant.id).toBe('q4_k_m');
    expect(matches[0].kvQuant.id).toBe('q8_0');
  });
});

describe('recommend — rejection reasons', () => {
  test('excluded developer produces excluded_dev filterReason', () => {
    const { matches, rejected } = recommend([LLAMA_3_1_8B], QUANT_LEVELS, {
      ramGB: 64,
      minContextLen: 8192,
      minTps: 5,
      bandwidthGBps: 200,
      lockQuantId: null,
      excludedDevs: new Set(['Meta']),
    });
    expect(matches).toHaveLength(0);
    expect(rejected[0].filterReasons.map((r) => r.type)).toContain('excluded_dev');
  });

  test('model with maxContext below minContextLen produces context_too_short filterReason', () => {
    const smallCtxModel: Model = {
      ...LLAMA_3_1_8B,
      id: 'small-ctx',
      arch: { ...LLAMA_3_1_8B.arch, maxContext: 4096 },
    };
    const { matches, rejected } = recommend([smallCtxModel], QUANT_LEVELS, {
      ramGB: 64,
      minContextLen: 8192,
      minTps: 1,
      bandwidthGBps: 200,
      lockQuantId: null,
      excludedDevs: new Set(),
    });
    expect(matches).toHaveLength(0);
    const ctxReason = rejected[0].filterReasons.find((r) => r.type === 'context_too_short');
    expect(ctxReason).toBeDefined();
    if (ctxReason?.type === 'context_too_short') {
      expect(ctxReason.maxContext).toBe(4096);
    }
  });

  test('filterReasons and hardwareReasons are all independent and can all apply simultaneously', () => {
    // excluded_dev + context_too_short + no_quant_fits_ram + too_slow
    const tinyCtxHugeSlowModel: Model = {
      ...MIXTRAL_8X7B,
      id: 'multi-fail',
      arch: { ...MIXTRAL_8X7B.arch, maxContext: 2048 },
    };
    const { matches, rejected } = recommend([tinyCtxHugeSlowModel], QUANT_LEVELS, {
      ramGB: 8,
      minContextLen: 8192,
      minTps: 100, // impossibly high — ensures too_slow fires even at Q2_K
      bandwidthGBps: 10,
      lockQuantId: null,
      excludedDevs: new Set(['Mistral AI']),
    });
    expect(matches).toHaveLength(0);
    const filterTypes = rejected[0].filterReasons.map((r) => r.type);
    expect(filterTypes).toContain('excluded_dev');
    expect(filterTypes).toContain('context_too_short');
    const hwTypes = rejected[0].hardwareReasons.map((r) => r.type);
    expect(hwTypes).toContain('no_quant_fits_ram');
    expect(hwTypes).toContain('too_slow');
  });
});
