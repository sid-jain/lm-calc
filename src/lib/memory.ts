import type { Model, QuantLevel, MemoryEstimate } from './types';

const FRAMEWORK_OVERHEAD_GB = 0.5;
const ESTIMATE_LOW_FACTOR = 0.95;
const ESTIMATE_HIGH_FACTOR = 1.2;

export function weightsGB(model: Model, quant: QuantLevel): number {
  return model.params * quant.bytesPerParam;
}

export function kvCacheGB(model: Model, contextLen: number): number {
  const ctx = Math.min(contextLen, model.arch.maxContext);
  const { layers, kvHeads, headDim, attentionType, slidingWindowSize, fullAttentionRatio } =
    model.arch;

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
