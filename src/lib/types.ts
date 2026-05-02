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
