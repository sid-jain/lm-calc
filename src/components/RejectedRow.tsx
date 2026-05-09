import { FIT_STYLES } from '../lib/fitStyle';
import { resolveKvCacheQuant } from '../lib/kvCacheQuants';
import { decodeTokensPerSecond, estimateMemory } from '../lib/memory';
import { QUANT_LEVELS } from '../lib/quants';
import type { RejectedRecommendation, RejectionReason } from '../lib/recommender';
import { rejectionLabel } from '../lib/rejectionLabel';
import { RowShell } from './RowShell';

const REJECTION_TONES: Record<RejectionReason['type'], string> = {
  no_quant_fits_ram: FIT_STYLES.over.tone, // rose  — hard RAM blocker
  too_slow: 'text-amber-600 dark:text-amber-400', // amber — speed threshold miss
  context_too_short: 'text-sky-600 dark:text-sky-400', // sky   — model ctx capability
  excluded_dev: 'text-slate-400 dark:text-slate-500', // slate — user filter choice
};

interface Props extends RejectedRecommendation {
  contextLen: number;
  bandwidthGBps: number;
  lockQuantId: string | null;
  kvCacheQuantId: string;
}

export function RejectedRow({
  model,
  filterReasons,
  hardwareReasons,
  contextLen,
  bandwidthGBps,
  lockQuantId,
  kvCacheQuantId,
}: Props): JSX.Element {
  const reasons: RejectionReason[] = [...filterReasons, ...hardwareReasons];

  // Use the locked quant if any, otherwise the cheapest (matches what the recommender
  // probed for hardware feasibility). Calculations clamp context to the model's max.
  const detailQuant =
    QUANT_LEVELS.find((q) => q.id === lockQuantId) ?? QUANT_LEVELS[QUANT_LEVELS.length - 1];
  const kvQuant = resolveKvCacheQuant(kvCacheQuantId);
  const effectiveContext = Math.min(contextLen, model.arch.maxContext);
  const estimate = estimateMemory(model, detailQuant, effectiveContext, kvQuant);
  const speed = decodeTokensPerSecond(model, detailQuant, effectiveContext, bandwidthGBps, kvQuant);

  return (
    <RowShell
      model={model}
      quant={detailQuant}
      kvQuant={kvQuant}
      contextLen={contextLen}
      estimate={estimate}
      speed={speed}
      muted
      rightSlot={
        <>
          {reasons.map((reason) => (
            <div key={reason.type} className={`text-sm ${REJECTION_TONES[reason.type]}`}>
              {rejectionLabel(reason)}
            </div>
          ))}
        </>
      }
    />
  );
}
