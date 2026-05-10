import { DEFAULT_KV_CACHE_QUANT } from './kvCacheQuants';
import type { KvCacheQuant, Model, QuantLevel, MemoryEstimate, SpeedEstimate } from './types';

const FRAMEWORK_OVERHEAD_GB = 0.5;
const ESTIMATE_LOW_FACTOR = 0.95;
const ESTIMATE_HIGH_FACTOR = 1.2;
const DECODE_EFFICIENCY_LOW = 0.5;
// Bumped 0.85 → 0.92 based on RTX 3060 + Llama 3.1 8B Q4_K_M measurements:
// every fp16-KV decode came in at 0.85–0.904 of the bandwidth-bound theoretical
// max (see benchmarks/measurements/llama-3-1-8b__rtx-3060-12gb.json). 0.92
// gives ~1.5% headroom over the observed max. Future multi-GPU data may
// revise this further.
const DECODE_EFFICIENCY_HIGH = 0.92;

export function weightsGB(model: Model, quant: QuantLevel): number {
  return model.params * quant.bytesPerParam;
}

// kvQuant defaults to FP16 to preserve the historical hard-coded behavior for any
// callsite that hasn't been threaded through yet.
export function kvCacheGB(model: Model, contextLen: number, kvQuant?: KvCacheQuant): number {
  const ctx = Math.min(contextLen, model.arch.maxContext);
  const bpe = (kvQuant ?? DEFAULT_KV_CACHE_QUANT).bytesPerElement;
  const {
    layers,
    kvHeads,
    headDim,
    attentionType,
    slidingWindowSize,
    fullAttentionRatio,
    kvLoraRank,
    qkRopeHeadDim,
  } = model.arch;

  if (attentionType === 'mla') {
    // MLA stores a compressed KV latent + a rope-K cache, shared across all heads (per layer).
    // Per token per layer: (kv_lora_rank + qk_rope_head_dim) × bytesPerElement.
    const perTokenPerLayer = ((kvLoraRank ?? 0) + (qkRopeHeadDim ?? 0)) * bpe;
    return (layers * perTokenPerLayer * ctx) / 1e9;
  }

  // Standard KV: 2 (K + V) × kv_heads × head_dim × ctx × bytesPerElement.
  const bytesPerLayerAt = (c: number) => 2 * kvHeads * headDim * c * bpe;

  if (attentionType === 'mixed') {
    const fullLayers = Math.round(layers * (fullAttentionRatio ?? 0));
    const slidingLayers = layers - fullLayers;
    const slidingCtx = Math.min(ctx, slidingWindowSize ?? ctx);
    const bytes = fullLayers * bytesPerLayerAt(ctx) + slidingLayers * bytesPerLayerAt(slidingCtx);
    return bytes / 1e9;
  }

  // Linear-attention layers (Gated DeltaNet etc.) keep a constant-size recurrent state
  // independent of context length — small enough to fold into framework_overhead. Only
  // the full-attention layers contribute the standard KV cost.
  if (attentionType === 'hybrid-linear') {
    const fullLayers = Math.round(layers * (fullAttentionRatio ?? 0));
    return (fullLayers * bytesPerLayerAt(ctx)) / 1e9;
  }

  return (layers * bytesPerLayerAt(ctx)) / 1e9;
}

export function decodeTokensPerSecond(
  model: Model,
  quant: QuantLevel,
  contextLen: number,
  bandwidthGBps: number,
  kvQuant?: KvCacheQuant,
): SpeedEstimate {
  const activeParams =
    model.isMoE && model.activeParams !== null ? model.activeParams : model.params;
  const weightBytesPerToken = activeParams * quant.bytesPerParam * 1e9;
  const kvBytesPerToken = kvCacheGB(model, contextLen, kvQuant) * 1e9;
  const bytesPerToken = weightBytesPerToken + kvBytesPerToken;
  const theoreticalTps = (bandwidthGBps * 1e9) / bytesPerToken;
  return {
    theoreticalTps,
    lowTps: theoreticalTps * DECODE_EFFICIENCY_LOW,
    highTps: theoreticalTps * DECODE_EFFICIENCY_HIGH,
    weightBytesPerToken,
    kvBytesPerToken,
    bandwidthGBps,
  };
}

// Find the highest-quality quant strictly smaller than `current` whose total memory still
// fits in `ramGB`. Returns null if no smaller quant fits (or `current` is already the
// smallest). `quants` is expected ordered from largest bytesPerParam to smallest, matching
// QUANT_LEVELS — we walk it in order so the first hit is the highest-quality fit.
export function largestFittingQuant(
  model: Model,
  contextLen: number,
  ramGB: number,
  current: QuantLevel,
  quants: QuantLevel[],
  kvQuant?: KvCacheQuant,
): QuantLevel | null {
  for (const q of quants) {
    if (q.bytesPerParam >= current.bytesPerParam) continue;
    if (estimateMemory(model, q, contextLen, kvQuant).totalGB <= ramGB) return q;
  }
  return null;
}

export function estimateMemory(
  model: Model,
  quant: QuantLevel,
  contextLen: number,
  kvQuant?: KvCacheQuant,
): MemoryEstimate {
  const weights = weightsGB(model, quant);
  const kv = kvCacheGB(model, contextLen, kvQuant);
  const overhead = FRAMEWORK_OVERHEAD_GB;
  const total = weights + kv + overhead;
  return {
    weightsGB: weights,
    kvCacheGB: kv,
    overheadGB: overhead,
    totalGB: total,
    rangeGB: {
      low: total * ESTIMATE_LOW_FACTOR,
      high: total * ESTIMATE_HIGH_FACTOR,
    },
  };
}
