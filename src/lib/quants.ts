import type { QuantLevel } from './types';

export const QUANT_LEVELS: QuantLevel[] = [
  { id: 'fp32', name: 'FP32', bytesPerParam: 4.0, description: 'Full precision (training)' },
  {
    id: 'fp16',
    name: 'FP16',
    bytesPerParam: 2.0,
    description: 'Half precision (BF16/FP16) — standard inference',
  },
  { id: 'q8_0', name: 'Q8_0', bytesPerParam: 1.0625, description: '8-bit, near-lossless' },
  { id: 'q6_k', name: 'Q6_K', bytesPerParam: 0.82, description: '6-bit, ~lossless' },
  { id: 'q5_k_m', name: 'Q5_K_M', bytesPerParam: 0.711, description: '5-bit, very small loss' },
  {
    id: 'q4_k_m',
    name: 'Q4_K_M',
    bytesPerParam: 0.604,
    description: '4-bit, recommended default',
  },
  { id: 'q4_0', name: 'Q4_0', bytesPerParam: 0.563, description: '4-bit, simpler' },
  { id: 'q3_k_m', name: 'Q3_K_M', bytesPerParam: 0.489, description: '3-bit, noticeable loss' },
  { id: 'q2_k', name: 'Q2_K', bytesPerParam: 0.419, description: '2-3 bit, significant loss' },
];
