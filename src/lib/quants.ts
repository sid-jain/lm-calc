import type { AutoQuantSentinel, QuantLevel, WeightQuantOption } from './types';

export const AUTO_QUANT_ID = 'auto';

export const AUTO_QUANT: AutoQuantSentinel = {
  id: AUTO_QUANT_ID,
  name: 'Recommend best quant',
  description: 'Picks the highest-quality weight quant that fits.',
};

// Quality-loss values capture the Q4 → Q3 cliff: dropping Q4_K_M to Q3_K_M
// (~0.11 perplexity) is much steeper than the upper-tier steps. The recommender
// reads this directly; ordering is what matters, not the exact numbers.
export const QUANT_LEVELS: QuantLevel[] = [
  {
    id: 'fp32',
    name: 'FP32',
    bytesPerParam: 4.0,
    qualityLoss: 0,
    description: 'Full precision (training)',
  },
  {
    id: 'fp16',
    name: 'FP16',
    bytesPerParam: 2.0,
    qualityLoss: 0,
    description: 'Half precision (BF16/FP16) — standard inference',
  },
  {
    id: 'q8_0',
    name: 'Q8_0',
    bytesPerParam: 1.0625,
    qualityLoss: 0.005,
    description: '8-bit, near-lossless',
  },
  {
    id: 'q6_k',
    name: 'Q6_K',
    bytesPerParam: 0.82,
    qualityLoss: 0.01,
    description: '6-bit, ~lossless',
  },
  {
    id: 'q5_k_m',
    name: 'Q5_K_M',
    bytesPerParam: 0.711,
    qualityLoss: 0.02,
    description: '5-bit, very small loss',
  },
  {
    id: 'q4_k_m',
    name: 'Q4_K_M',
    bytesPerParam: 0.604,
    qualityLoss: 0.04,
    description: '4-bit, recommended default',
  },
  {
    id: 'q4_0',
    name: 'Q4_0',
    bytesPerParam: 0.563,
    qualityLoss: 0.06,
    description: '4-bit, simpler',
  },
  {
    id: 'q3_k_m',
    name: 'Q3_K_M',
    bytesPerParam: 0.489,
    qualityLoss: 0.15,
    description: '3-bit, noticeable loss',
  },
  {
    id: 'q2_k',
    name: 'Q2_K',
    bytesPerParam: 0.419,
    qualityLoss: 0.4,
    description: '2-3 bit, significant loss',
  },
];

export function isAutoQuantId(id: string | undefined): boolean {
  return id === undefined || id === AUTO_QUANT_ID;
}

export function isAutoQuant(q: WeightQuantOption): q is AutoQuantSentinel {
  return q.id === AUTO_QUANT_ID;
}
