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
    // At 50 GB/s, Llama 3.1 8B Q2_K lowTps ≈ 5.6 tok/s — below minTps=6
    const { matches, rejected } = recommend([LLAMA_3_1_8B], QUANT_LEVELS, {
      ramGB: 16,
      minContextLen: 8192,
      minTps: 6,
      bandwidthGBps: 50,
      lockQuantId: null,
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
