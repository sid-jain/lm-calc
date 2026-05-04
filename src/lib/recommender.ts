import { decodeTokensPerSecond, estimateMemory } from './memory';
import { QUANT_LEVELS } from './quants';
import type { MemoryEstimate, Model, QuantLevel, SpeedEstimate } from './types';

export interface Constraints {
  ramGB: number;
  minContextLen: number;
  minTps: number;
  bandwidthGBps: number;
  lockQuantId: string | null;
  excludedDevs: Set<string>;
}

export interface Recommendation {
  model: Model;
  quant: QuantLevel;
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

// Score weights: quant quality dominates, then speed, then model size.
// Tune: QUANT_WEIGHT=100, TPS_WEIGHT=1, PARAMS_WEIGHT=0.001
const QUANT_WEIGHT = 100;
const TPS_WEIGHT = 1;
const PARAMS_WEIGHT = 0.001;

export function recommend(models: Model[], quants: QuantLevel[], c: Constraints): RecommendOutput {
  const matches: Recommendation[] = [];
  const rejected: RejectedRecommendation[] = [];

  for (const model of models) {
    const filterReasons: FilterReason[] = [];

    if (c.excludedDevs.has(model.developer)) {
      filterReasons.push({ type: 'excluded_dev' });
    }
    if (model.arch.maxContext < c.minContextLen) {
      filterReasons.push({ type: 'context_too_short', maxContext: model.arch.maxContext });
    }

    const candidates = c.lockQuantId ? quants.filter((q) => q.id === c.lockQuantId) : quants;

    // Use the cheapest (lowest bytesPerParam) candidate to check hardware limits:
    //   - worst case for RAM  → minRamGB is the minimum possible RAM needed
    //   - best case for speed → maxLowTps is the maximum achievable tok/s
    // Speed is bandwidth-bound and independent of whether the model fits in RAM,
    // so both hardware reasons can apply simultaneously.
    const cheapest = candidates[candidates.length - 1] ?? quants[quants.length - 1];
    const hardwareReasons: HardwareReason[] = [];

    const ramAtCheapest = estimateMemory(model, cheapest, c.minContextLen).totalGB;
    if (ramAtCheapest > c.ramGB) {
      hardwareReasons.push({ type: 'no_quant_fits_ram', minRamGB: ramAtCheapest });
    }

    const speedAtCheapest = decodeTokensPerSecond(
      model,
      cheapest,
      c.minContextLen,
      c.bandwidthGBps,
    );
    if (speedAtCheapest.lowTps < c.minTps) {
      hardwareReasons.push({ type: 'too_slow', maxLowTps: speedAtCheapest.lowTps });
    }

    if (filterReasons.length === 0 && hardwareReasons.length === 0) {
      // Walk from highest quality down to find the best quant that satisfies both constraints.
      // Guaranteed to find at least one (cheapest passed both checks above).
      for (const quant of candidates) {
        const estimate = estimateMemory(model, quant, c.minContextLen);
        if (estimate.totalGB > c.ramGB) continue;
        const speed = decodeTokensPerSecond(model, quant, c.minContextLen, c.bandwidthGBps);
        if (speed.lowTps < c.minTps) continue;
        const qualityIdx = QUANT_LEVELS.findIndex((q) => q.id === quant.id);
        const score =
          QUANT_WEIGHT * (QUANT_LEVELS.length - qualityIdx) +
          TPS_WEIGHT * speed.lowTps +
          PARAMS_WEIGHT * model.params;
        matches.push({ model, quant, estimate, speed, score });
        break;
      }
    } else {
      rejected.push({ model, filterReasons, hardwareReasons });
    }
  }

  return {
    matches: matches.sort((a, b) => b.score - a.score),
    rejected,
  };
}
