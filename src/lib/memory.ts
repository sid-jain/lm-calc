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
