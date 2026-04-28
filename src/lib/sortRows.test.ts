import { describe, expect, test } from 'vitest';
import { compareWithin, type Row, type SortContext } from './sortRows';
import { estimateMemory } from './memory';
import type { Model } from './types';

const Q4_K_M = { id: 'q4_k_m', name: 'Q4_K_M', bytesPerParam: 0.604, description: '' };
const CTX: SortContext = { quant: Q4_K_M, contextLen: 8192, bandwidthGBps: 1000 };

function makeRow(overrides: Partial<Model>): Row {
  const model: Model = {
    id: 'fixture',
    displayName: 'Fixture',
    family: 'Test',
    developer: 'Acme',
    hfRepo: 'acme/fixture',
    params: 8,
    isMoE: false,
    activeParams: null,
    arch: {
      layers: 32,
      attnHeads: 32,
      kvHeads: 8,
      headDim: 128,
      hiddenSize: 4096,
      vocabSize: 32000,
      tiedEmbeddings: false,
      maxContext: 8192,
      attentionType: 'gqa',
      slidingWindowSize: null,
      fullAttentionRatio: null,
      kvLoraRank: null,
      qkRopeHeadDim: null,
    },
    ...overrides,
  };
  return { model, estimate: estimateMemory(model, Q4_K_M, 8192) };
}

// Two MoE rows with the same total params (so weights/memory tie) but different active params
// — different decode speeds, identical memory footprint. Forces the sort key to actually drive.
const FAST = makeRow({
  id: 'fast',
  displayName: 'Fast 30B-A3B',
  developer: 'Acme',
  isMoE: true,
  activeParams: 3,
});
const SLOW = makeRow({
  id: 'slow',
  displayName: 'Slow 30B-A20B',
  developer: 'Beta',
  isMoE: true,
  activeParams: 20,
  params: 30,
});

describe('compareWithin', () => {
  test('speed-desc puts the faster model first', () => {
    expect(compareWithin(FAST, SLOW, 'speed-desc', CTX)).toBeLessThan(0);
    expect(compareWithin(SLOW, FAST, 'speed-desc', CTX)).toBeGreaterThan(0);
  });

  test('speed-asc puts the slower model first', () => {
    expect(compareWithin(FAST, SLOW, 'speed-asc', CTX)).toBeGreaterThan(0);
    expect(compareWithin(SLOW, FAST, 'speed-asc', CTX)).toBeLessThan(0);
  });

  test('existing keys still work', () => {
    const tiny = makeRow({ id: 't', displayName: 'A Model', developer: 'Acme', params: 1 });
    const huge = makeRow({ id: 'h', displayName: 'Z Model', developer: 'Zeta', params: 100 });

    expect(compareWithin(tiny, huge, 'memory-asc', CTX)).toBeLessThan(0);
    expect(compareWithin(tiny, huge, 'params-desc', CTX)).toBeGreaterThan(0);
    expect(compareWithin(tiny, huge, 'name', CTX)).toBeLessThan(0);
    expect(compareWithin(tiny, huge, 'developer', CTX)).toBeLessThan(0);
  });
});
