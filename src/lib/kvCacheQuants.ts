import type { KvCacheQuant } from './types';

// Bytes-per-element values come from llama.cpp's GGUF block layouts:
//   FP16: 2 bytes plain
//   Q8_0: 32-elem block = 32 × int8 + fp16 scale = 34 bytes → 1.0625 bytes/elem
//   Q4_0: 32-elem block = 16 packed bytes + fp16 scale = 18 bytes → 0.5625 bytes/elem
// Per-token KV footprint = 2 (K + V) × kv_heads × head_dim × bytesPerElement × layers
// for standard attention, or (kv_lora_rank + qk_rope_head_dim) × bytesPerElement × layers
// for MLA.
const FP16: KvCacheQuant = {
  id: 'fp16',
  name: 'FP16',
  bytesPerElement: 2.0,
  description: 'Full half-precision KV cache (largest, lossless)',
};

const Q8_0: KvCacheQuant = {
  id: 'q8_0',
  name: 'Q8_0',
  bytesPerElement: 1.0625,
  description: '8-bit KV — near-lossless, ~1.9× smaller than FP16',
};

const Q4_0: KvCacheQuant = {
  id: 'q4_0',
  name: 'Q4_0',
  bytesPerElement: 0.5625,
  description: '4-bit KV — quality cost, ~3.5× smaller than FP16',
};

// Ordered from highest quality to lowest, matching the QUANT_LEVELS convention.
export const KV_CACHE_QUANT_LEVELS: KvCacheQuant[] = [FP16, Q8_0, Q4_0];

// Sentinel: when chosen, the recommender picks the highest-quality KV quant
// that lets each model meet the memory and speed constraints. bytesPerElement=0
// is a sentinel value — never used directly in arithmetic, only the id is checked.
export const AUTO_KV_QUANT_ID = 'auto';
export const AUTO_KV_QUANT: KvCacheQuant = {
  id: AUTO_KV_QUANT_ID,
  name: 'Recommend best quant',
  bytesPerElement: 0,
  description: 'Picks the highest-quality KV quant that fits.',
};

// Fallback used by memory.ts when callers don't pass a kvQuant — the math layer
// has no notion of "auto" since auto-resolution requires the recommender's
// constraints. Profile-level defaults live in appState (and resolve to AUTO).
export const DEFAULT_KV_CACHE_QUANT: KvCacheQuant = FP16;

// Profile-level default — what new sessions / cleared URLs land on. Mirrors the
// weight-quant default of 'auto'.
export const DEFAULT_KV_CACHE_QUANT_ID = AUTO_KV_QUANT_ID;

export function resolveKvCacheQuant(id: string | undefined): KvCacheQuant {
  return KV_CACHE_QUANT_LEVELS.find((q) => q.id === id) ?? DEFAULT_KV_CACHE_QUANT;
}
