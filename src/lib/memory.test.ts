import { describe, expect, test } from 'vitest';
import { weightsGB, kvCacheGB, estimateMemory } from './memory';
import type { Model } from './types';

const LLAMA_3_1_8B: Model = {
  id: 'llama-3-1-8b',
  displayName: 'Llama 3.1 8B',
  family: 'Llama 3',
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
  },
};

const GEMMA_2_9B: Model = {
  id: 'gemma-2-9b',
  displayName: 'Gemma 2 9B',
  family: 'Gemma 2',
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

describe('schema validation', () => {
  test('all models in models.json pass schema', async () => {
    const { ModelsSchema } = await import('./schema');
    const data = await import('../data/models.json');
    expect(() => ModelsSchema.parse(data.default)).not.toThrow();
  });
});
