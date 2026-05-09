import { AUTO_KV_QUANT_ID, KV_CACHE_QUANT_LEVELS, resolveKvCacheQuant } from './kvCacheQuants';
import { decodeTokensPerSecond, estimateMemory } from './memory';
import type { KvCacheQuant, MemoryEstimate, Model, QuantLevel, SpeedEstimate } from './types';

export interface Constraints {
  ramGB: number;
  minContextLen: number;
  minTps: number;
  bandwidthGBps: number;
  lockQuantId: string | null;
  /** KV cache quant id. 'auto' / undefined → recommender picks; concrete id locks. */
  kvCacheQuantId?: string;
  excludedDevs: Set<string>;
}

export interface Recommendation {
  model: Model;
  quant: QuantLevel;
  kvQuant: KvCacheQuant;
  estimate: MemoryEstimate;
  speed: SpeedEstimate;
  score: number;
}

// User-controlled or model-capability filters — any combination can apply simultaneously.
export type FilterReason =
  | { type: 'excluded_dev' }
  | { type: 'context_too_short'; maxContext: number };

// Hardware constraints — both can apply simultaneously.
// no_quant_fits_ram: even the cheapest quant needs more RAM than the budget.
// too_slow: even the cheapest (fastest) quant's lowTps is below minTps.
// Speed is computed from bandwidth alone, so it is independent of whether the model fits in RAM.
export type HardwareReason =
  | { type: 'no_quant_fits_ram'; minRamGB: number }
  | { type: 'too_slow'; maxLowTps: number };

export type RejectionReason = FilterReason | HardwareReason;

export interface RejectedRecommendation {
  model: Model;
  filterReasons: FilterReason[]; // 0–2, any combination
  hardwareReasons: HardwareReason[]; // 0–2, any combination
}

export interface RecommendOutput {
  matches: Recommendation[];
  rejected: RejectedRecommendation[];
}

// Approximate perplexity deltas vs FP16, used to pick the lowest-loss (weight, kv)
// combo that fits the constraints. Numbers are rough rule-of-thumb values from
// llama.cpp benchmarks; the *relative ordering* matters more than the absolutes.
// Key fact the table captures: the Q4 → Q3 weight step is a quality cliff (~0.11
// perplexity), much larger than any FP16 → Q8 step (~0.005), so the recommender
// will trade FP16 KV for Q8 KV before sliding past Q4_K_M weights.
const WEIGHT_QUALITY_LOSS: Record<string, number> = {
  fp32: 0,
  fp16: 0,
  q8_0: 0.005,
  q6_k: 0.01,
  q5_k_m: 0.02,
  q4_k_m: 0.04,
  q4_0: 0.06,
  q3_k_m: 0.15,
  q2_k: 0.4,
};

const KV_QUALITY_LOSS: Record<string, number> = {
  fp16: 0,
  q8_0: 0.005,
  q4_0: 0.06,
};

// Score weighting: quality dominates, speed and params break ties.
// 0.005 quality step → 50 score units, larger than typical lowTps differences and
// far larger than typical params differences. Unknown ids fall back to high losses
// so they don't accidentally dominate.
const QUALITY_PENALTY = 10000;
const TPS_WEIGHT = 1;
const PARAMS_WEIGHT = 0.001;
const UNKNOWN_WEIGHT_LOSS = 1.0;
const UNKNOWN_KV_LOSS = 0.5;

function combinedLoss(weight: QuantLevel, kv: KvCacheQuant): number {
  return (
    (WEIGHT_QUALITY_LOSS[weight.id] ?? UNKNOWN_WEIGHT_LOSS) +
    (KV_QUALITY_LOSS[kv.id] ?? UNKNOWN_KV_LOSS)
  );
}

export function recommend(models: Model[], quants: QuantLevel[], c: Constraints): RecommendOutput {
  const matches: Recommendation[] = [];
  const rejected: RejectedRecommendation[] = [];

  // Build the candidate sets for the cartesian walk.
  // - Auto KV (id 'auto' or undefined) → consider every KV quant, highest quality first.
  // - Locked KV → just that one.
  const isAutoKv = c.kvCacheQuantId === undefined || c.kvCacheQuantId === AUTO_KV_QUANT_ID;
  const kvCandidates = isAutoKv ? KV_CACHE_QUANT_LEVELS : [resolveKvCacheQuant(c.kvCacheQuantId)];
  const weightCandidates = c.lockQuantId ? quants.filter((q) => q.id === c.lockQuantId) : quants;

  for (const model of models) {
    const filterReasons: FilterReason[] = [];

    if (c.excludedDevs.has(model.developer)) {
      filterReasons.push({ type: 'excluded_dev' });
    }
    if (model.arch.maxContext < c.minContextLen) {
      filterReasons.push({ type: 'context_too_short', maxContext: model.arch.maxContext });
    }

    // Hardware feasibility uses the cheapest combo (lowest weight bpw × lowest KV bpe):
    //   - worst case for RAM  → minRamGB is the absolute minimum needed
    //   - best case for speed → maxLowTps is the absolute maximum achievable
    // Speed is bandwidth-bound and independent of whether the model fits in RAM,
    // so both hardware reasons can apply simultaneously.
    const cheapestWeight =
      weightCandidates[weightCandidates.length - 1] ?? quants[quants.length - 1];
    const cheapestKv = kvCandidates[kvCandidates.length - 1];
    const hardwareReasons: HardwareReason[] = [];

    const ramAtCheapest = estimateMemory(
      model,
      cheapestWeight,
      c.minContextLen,
      cheapestKv,
    ).totalGB;
    if (ramAtCheapest > c.ramGB) {
      hardwareReasons.push({ type: 'no_quant_fits_ram', minRamGB: ramAtCheapest });
    }

    const speedAtCheapest = decodeTokensPerSecond(
      model,
      cheapestWeight,
      c.minContextLen,
      c.bandwidthGBps,
      cheapestKv,
    );
    if (speedAtCheapest.lowTps < c.minTps) {
      hardwareReasons.push({ type: 'too_slow', maxLowTps: speedAtCheapest.lowTps });
    }

    if (filterReasons.length === 0 && hardwareReasons.length === 0) {
      // Joint-loss selection: enumerate every (weight, kv) combo that fits and meets
      // minTps, pick the lowest-loss one. The earlier "outer KV / inner weight /
      // first-fit" walk wrongly preferred Q3_K_M+FP16 KV over Q4_K_M+Q8 KV because it
      // never compared across the KV axis. Joint loss recognizes that an FP16→Q8 KV
      // step (~0.005 perplexity) is far cheaper than the Q4→Q3 weight cliff (~0.11),
      // so it picks Q4_K_M+Q8 in that scenario.
      let best: Recommendation | null = null;
      for (const kv of kvCandidates) {
        for (const weight of weightCandidates) {
          const estimate = estimateMemory(model, weight, c.minContextLen, kv);
          if (estimate.totalGB > c.ramGB) continue;
          const speed = decodeTokensPerSecond(model, weight, c.minContextLen, c.bandwidthGBps, kv);
          if (speed.lowTps < c.minTps) continue;
          const score =
            -QUALITY_PENALTY * combinedLoss(weight, kv) +
            TPS_WEIGHT * speed.lowTps +
            PARAMS_WEIGHT * model.params;
          if (best === null || score > best.score) {
            best = { model, quant: weight, kvQuant: kv, estimate, speed, score };
          }
        }
      }
      // Guaranteed non-null: the cheapest combo passed the feasibility checks above.
      if (best) matches.push(best);
    } else {
      rejected.push({ model, filterReasons, hardwareReasons });
    }
  }

  return {
    matches: matches.sort((a, b) => b.score - a.score),
    rejected,
  };
}
