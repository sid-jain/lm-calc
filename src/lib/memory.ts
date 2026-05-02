import type { Model, QuantLevel, MemoryEstimate, SpeedEstimate } from './types';

const FRAMEWORK_OVERHEAD_GB = 0.5;
const ESTIMATE_LOW_FACTOR = 0.95;
const ESTIMATE_HIGH_FACTOR = 1.2;
const DECODE_EFFICIENCY_LOW = 0.5;
const DECODE_EFFICIENCY_HIGH = 0.85;

export function weightsGB(model: Model, quant: QuantLevel): number {
  return model.params * quant.bytesPerParam;
}

export function kvCacheGB(model: Model, contextLen: number): number {
  const ctx = Math.min(contextLen, model.arch.maxContext);
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
    // Per token per layer: (kv_lora_rank + qk_rope_head_dim) × 2 bytes (FP16).
    const perTokenPerLayer = ((kvLoraRank ?? 0) + (qkRopeHeadDim ?? 0)) * 2;
    return (layers * perTokenPerLayer * ctx) / 1e9;
  }

  const bytesPerLayerAt = (c: number) => 2 * kvHeads * headDim * c * 2;

  if (attentionType === 'mixed') {
    const fullLayers = Math.round(layers * (fullAttentionRatio ?? 0));
    const slidingLayers = layers - fullLayers;
    const slidingCtx = Math.min(ctx, slidingWindowSize ?? ctx);
    const bytes =
      fullLayers * bytesPerLayerAt(ctx) + slidingLayers * bytesPerLayerAt(slidingCtx);
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
): SpeedEstimate {
  const activeParams = model.isMoE && model.activeParams !== null ? model.activeParams : model.params;
  const weightBytesPerToken = activeParams * quant.bytesPerParam * 1e9;
  const kvBytesPerToken = kvCacheGB(model, contextLen) * 1e9;
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
): QuantLevel | null {
  for (const q of quants) {
    if (q.bytesPerParam >= current.bytesPerParam) continue;
    if (estimateMemory(model, q, contextLen).totalGB <= ramGB) return q;
  }
  return null;
}

export function estimateMemory(
  model: Model,
  quant: QuantLevel,
  contextLen: number,
): MemoryEstimate {
  const weights = weightsGB(model, quant);
  const kv = kvCacheGB(model, contextLen);
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
