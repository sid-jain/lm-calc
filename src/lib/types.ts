export type AttentionType = 'full' | 'gqa' | 'mqa' | 'mixed' | 'mla' | 'hybrid-linear';

export interface Model {
  id: string;
  displayName: string;
  developer: string;
  hfRepo: string;
  params: number;
  isMoE: boolean;
  activeParams: number | null;
  arch: {
    layers: number;
    attnHeads: number;
    kvHeads: number;
    headDim: number;
    hiddenSize: number;
    vocabSize: number;
    tiedEmbeddings: boolean;
    maxContext: number;
    attentionType: AttentionType;
    slidingWindowSize: number | null;
    fullAttentionRatio: number | null;
    kvLoraRank: number | null;
    qkRopeHeadDim: number | null;
  };
}

export interface QuantLevel {
  id: string;
  name: string;
  bytesPerParam: number;
  description: string;
}

export interface KvCacheQuant {
  id: string;
  name: string;
  bytesPerElement: number;
  description: string;
}

// "Recommend best …" sentinels for the Profile / Controls UI. Deliberately omit
// the bytes-per-* field so they cannot be passed where math expects a real quant
// — TypeScript will reject `kvCacheGB(model, ctx, AUTO_KV_QUANT)` at compile time.
export interface AutoQuantSentinel {
  id: 'auto';
  name: string;
  description: string;
}

export interface AutoKvQuantSentinel {
  id: 'auto';
  name: string;
  description: string;
}

// Union types used by UI surfaces (Controls, App) where either the auto sentinel
// or a concrete quant can flow through. The recommender output, ModelRow, and
// memory functions all use the concrete types only.
export type WeightQuantOption = QuantLevel | AutoQuantSentinel;
export type KvCacheQuantOption = KvCacheQuant | AutoKvQuantSentinel;

export interface MemoryEstimate {
  weightsGB: number;
  kvCacheGB: number;
  overheadGB: number;
  totalGB: number;
  rangeGB: { low: number; high: number };
}

export interface SpeedEstimate {
  theoreticalTps: number;
  lowTps: number;
  highTps: number;
  weightBytesPerToken: number;
  kvBytesPerToken: number;
  bandwidthGBps: number;
}
