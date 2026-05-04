import { describe, expect, test } from 'vitest';
import { weightsGB, kvCacheGB, estimateMemory, decodeTokensPerSecond } from './memory';
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

const GEMMA_2_9B: Model = {
  id: 'gemma-2-9b',
  displayName: 'Gemma 2 9B',
  developer: 'Google',
  hfRepo: 'google/gemma-2-9b',
  params: 9.241,
  isMoE: false,
  activeParams: null,
  arch: {
    layers: 42,
    attnHeads: 16,
    kvHeads: 8,
    headDim: 256,
    hiddenSize: 3584,
    vocabSize: 256128,
    tiedEmbeddings: true,
    maxContext: 8192,
    attentionType: 'mixed',
    slidingWindowSize: 4096,
    fullAttentionRatio: 0.5,
    kvLoraRank: null,
    qkRopeHeadDim: null,
  },
};

describe('weightsGB', () => {
  test('Llama 3.1 8B at FP16', () => {
    expect(
      weightsGB(LLAMA_3_1_8B, { id: 'fp16', name: 'FP16', bytesPerParam: 2.0, description: '' }),
    ).toBeCloseTo(16.06, 6);
  });
  test('Llama 3.1 8B at Q4_K_M', () => {
    expect(
      weightsGB(LLAMA_3_1_8B, {
        id: 'q4_k_m',
        name: 'Q4_K_M',
        bytesPerParam: 0.604,
        description: '',
      }),
    ).toBeCloseTo(4.85012, 6);
  });
});

describe('kvCacheGB — uniform GQA', () => {
  test('Llama 3.1 8B at 8192 ctx', () => {
    expect(kvCacheGB(LLAMA_3_1_8B, 8192)).toBeCloseTo(1.073741824, 9);
  });
  test('Llama 3.1 8B at 131072 ctx (max)', () => {
    expect(kvCacheGB(LLAMA_3_1_8B, 131072)).toBeCloseTo(17.179869184, 9);
  });
  test('clamps ctx to maxContext', () => {
    expect(kvCacheGB(LLAMA_3_1_8B, 200000)).toBeCloseTo(17.179869184, 9);
  });
});

describe('kvCacheGB — mixed attention', () => {
  test('Gemma 2 9B at 8192 ctx', () => {
    expect(kvCacheGB(GEMMA_2_9B, 8192)).toBeCloseTo(2.113929216, 9);
  });
  test('Gemma 2 9B at 4096 ctx (≤ sliding window, both layer types use same ctx)', () => {
    expect(kvCacheGB(GEMMA_2_9B, 4096)).toBeCloseTo(1.409286144, 9);
  });
});

const KIMI_K2: Model = {
  id: 'kimi-k2',
  displayName: 'Kimi K2',
  developer: 'Moonshot AI',
  hfRepo: 'moonshotai/Kimi-K2-Instruct',
  params: 1026.5,
  isMoE: true,
  activeParams: 32.0,
  arch: {
    layers: 61,
    attnHeads: 64,
    kvHeads: 64,
    headDim: 192,
    hiddenSize: 7168,
    vocabSize: 163840,
    tiedEmbeddings: false,
    maxContext: 131072,
    attentionType: 'mla',
    slidingWindowSize: null,
    fullAttentionRatio: null,
    kvLoraRank: 512,
    qkRopeHeadDim: 64,
  },
};

describe('kvCacheGB — MLA', () => {
  test('Kimi K2 at 8K ctx', () => {
    // Per token per layer = (kv_lora_rank + qk_rope_head_dim) × 2 bytes (FP16)
    //                     = (512 + 64) × 2 = 1152 bytes
    // Total = 1152 × 61 layers × 8192 ctx / 1e9 = 0.575668224 GB
    expect(kvCacheGB(KIMI_K2, 8192)).toBeCloseTo(0.575668224, 9);
  });

  test('MLA is dramatically smaller than the equivalent naive GQA would be', () => {
    // Naive (kvHeads × headDim per layer) at K2's dims:
    //   64 × 192 × 8192 × 2 (KV) × 2 (FP16) × 61 layers / 1e9 = 24.50 GB
    // MLA: ~0.58 GB. Ratio > 30x. Locks in the MLA choice.
    const mla = kvCacheGB(KIMI_K2, 8192);
    const naive =
      (KIMI_K2.arch.layers * 2 * KIMI_K2.arch.kvHeads * KIMI_K2.arch.headDim * 8192 * 2) / 1e9;
    expect(naive / mla).toBeGreaterThan(30);
  });
});

// Qwen 3.6 27B: 64 layers in a hybrid stack — every 4th layer is full GQA, the other
// three are Gated DeltaNet (linear attention, ~constant-size recurrent state). 16 of 64
// layers contribute to the standard KV cache.
const QWEN_3_6_27B: Model = {
  id: 'qwen-3-6-27b',
  displayName: 'Qwen 3.6 27B',
  developer: 'Alibaba',
  hfRepo: 'Qwen/Qwen3.6-27B',
  params: 27.8,
  isMoE: false,
  activeParams: null,
  arch: {
    layers: 64,
    attnHeads: 24,
    kvHeads: 4,
    headDim: 256,
    hiddenSize: 5120,
    vocabSize: 248320,
    tiedEmbeddings: false,
    maxContext: 262144,
    attentionType: 'hybrid-linear',
    slidingWindowSize: null,
    fullAttentionRatio: 0.25,
    kvLoraRank: null,
    qkRopeHeadDim: null,
  },
};

describe('kvCacheGB — hybrid-linear', () => {
  test('Qwen 3.6 27B at 8K ctx counts only the 16 full-attention layers', () => {
    // 16 full layers × 2 (KV) × 4 kv_heads × 256 head_dim × 8192 ctx × 2 bytes / 1e9
    //   = 16 × 33,554,432 / 1e9 = 0.536870912 GB
    expect(kvCacheGB(QWEN_3_6_27B, 8192)).toBeCloseTo(0.536870912, 9);
  });

  test('hybrid-linear is 4× smaller than treating all layers as GQA', () => {
    // The whole point of the new attention type — guards against regressing to
    // counting all 64 layers if the dispatch ever breaks.
    const hybrid = kvCacheGB(QWEN_3_6_27B, 8192);
    const allLayers = (64 * 2 * 4 * 256 * 8192 * 2) / 1e9;
    expect(allLayers / hybrid).toBeCloseTo(4, 6);
  });
});

describe('estimateMemory', () => {
  test('total equals sum of components', () => {
    const e = estimateMemory(
      LLAMA_3_1_8B,
      { id: 'q4_k_m', name: '', bytesPerParam: 0.604, description: '' },
      8192,
    );
    expect(e.totalGB).toBeCloseTo(e.weightsGB + e.kvCacheGB + e.overheadGB, 9);
  });
  test('range brackets the estimate', () => {
    const e = estimateMemory(
      LLAMA_3_1_8B,
      { id: 'fp16', name: '', bytesPerParam: 2.0, description: '' },
      8192,
    );
    expect(e.rangeGB.low).toBeLessThan(e.totalGB);
    expect(e.rangeGB.high).toBeGreaterThan(e.totalGB);
  });
});

const MIXTRAL_8X7B: Model = {
  id: 'mixtral-8x7b',
  displayName: 'Mixtral 8x7B',
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

describe('MoE invariants', () => {
  test('weights use total params, not active', () => {
    // 46.703 * 0.604 = 28.208612 GB; the wrong answer (using activeParams) would be ~7.78 GB.
    expect(
      weightsGB(MIXTRAL_8X7B, {
        id: 'q4_k_m',
        name: 'Q4_K_M',
        bytesPerParam: 0.604,
        description: '',
      }),
    ).toBeCloseTo(28.208612, 6);
  });

  test('KV cache ignores isMoE / activeParams (depends only on attention arch)', () => {
    // 32 * 2 * 8 * 128 * 8192 * 2 / 1e9 = 1.073741824 — same formula as a dense GQA model.
    expect(kvCacheGB(MIXTRAL_8X7B, 8192)).toBeCloseTo(1.073741824, 9);
  });
});

describe('decodeTokensPerSecond', () => {
  const Q4_K_M = { id: 'q4_k_m', name: 'Q4_K_M', bytesPerParam: 0.604, description: '' };

  test('Llama 3.1 8B at Q4_K_M, 8K ctx, 1000 GB/s', () => {
    // bytesPerToken = active_params * bytesPerParam * 1e9 + kv_bytes
    //               = 8.030 * 0.604 * 1e9 + 1_073_741_824
    //               = 4_850_120_000 + 1_073_741_824 = 5_923_861_824
    const expectedBytesPerToken = 8.03 * 0.604 * 1e9 + 1_073_741_824;
    const expectedTps = (1000 * 1e9) / expectedBytesPerToken;

    const e = decodeTokensPerSecond(LLAMA_3_1_8B, Q4_K_M, 8192, 1000);
    expect(e.weightBytesPerToken + e.kvBytesPerToken).toBeCloseTo(expectedBytesPerToken, 6);
    expect(e.theoreticalTps).toBeCloseTo(expectedTps, 9);
    expect(e.lowTps).toBeCloseTo(expectedTps * 0.5, 9);
    expect(e.highTps).toBeCloseTo(expectedTps * 0.85, 9);
  });

  test('MoE uses activeParams, not total', () => {
    // Mixtral 8x7B: total 46.703B, active 12.88B. The function must use 12.88.
    const expectedWeightBytes = 12.88 * 0.604 * 1e9;
    const expectedKvBytes = 1_073_741_824; // same KV math as Llama 8B (matching arch)

    const e = decodeTokensPerSecond(MIXTRAL_8X7B, Q4_K_M, 8192, 1000);
    expect(e.weightBytesPerToken).toBeCloseTo(expectedWeightBytes, 6);
    expect(e.kvBytesPerToken).toBeCloseTo(expectedKvBytes, 6);

    // If the function had wrongly used total params, weightBytes would be ~3.6× larger
    // (46.703 / 12.88) and theoreticalTps would be much lower. This pins the active-params choice.
    const wrongDenseBytes = 46.703 * 0.604 * 1e9 + expectedKvBytes;
    const wrongTps = (1000 * 1e9) / wrongDenseBytes;
    expect(e.theoreticalTps).toBeGreaterThan(wrongTps * 2);
  });

  test('theoreticalTps scales linearly with bandwidth', () => {
    const at500 = decodeTokensPerSecond(LLAMA_3_1_8B, Q4_K_M, 8192, 500).theoreticalTps;
    const at1000 = decodeTokensPerSecond(LLAMA_3_1_8B, Q4_K_M, 8192, 1000).theoreticalTps;
    expect(at1000 / at500).toBeCloseTo(2, 9);
  });
});

describe('schema validation', () => {
  test('all models in models.json pass schema', async () => {
    const { ModelsSchema } = await import('./schema');
    const data = await import('../data/models.json');
    expect(() => ModelsSchema.parse(data.default)).not.toThrow();
  });

  test('MoE without activeParams is rejected', async () => {
    const { ModelSchema } = await import('./schema');
    const result = ModelSchema.safeParse({ ...MIXTRAL_8X7B, activeParams: null });
    expect(result.success).toBe(false);
  });
});
