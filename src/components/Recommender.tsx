import { useMemo } from 'react';
import { formatContext } from '../lib/contextSnaps';
import { FIT_STYLES } from '../lib/fitStyle';
import { QUANT_LEVELS } from '../lib/quants';
import { recommend, type RejectedRecommendation, type RejectionReason } from '../lib/recommender';
import type { Model } from '../lib/types';
import { DeveloperFilter } from './DeveloperFilter';
import { ModelRow } from './ModelRow';

interface Props {
  models: Model[];
  ramGB: number;
  contextLen: number;
  bandwidthGBps: number;
  lockQuantId: string | null;
  minTps: number;
  excludedDevs: string[];
  onSetExcludedDevs: (devs: string[]) => void;
}

const REJECTION_TONES: Record<RejectionReason['type'], string> = {
  no_quant_fits_ram: FIT_STYLES.over.tone, // rose  — hard RAM blocker
  too_slow: 'text-amber-600 dark:text-amber-400', // amber — speed threshold miss
  context_too_short: 'text-sky-600 dark:text-sky-400', // sky   — model ctx capability
  excluded_dev: 'text-slate-400 dark:text-slate-500', // slate — user filter choice
};

function rejectionValue(reason: RejectionReason): string {
  switch (reason.type) {
    case 'no_quant_fits_ram':
      return `Needs ≥${reason.minRamGB.toFixed(1)} GB`;
    case 'too_slow':
      return `Max ${reason.maxLowTps < 1 ? '<1' : Math.round(reason.maxLowTps)} tok/s`;
    case 'context_too_short':
      return `Max ${formatContext(reason.maxContext)} ctx`;
    case 'excluded_dev':
      return 'Dev excluded';
  }
}

function RejectedRow({
  model,
  filterReasons,
  hardwareReasons,
}: RejectedRecommendation): JSX.Element {
  const allReasons: RejectionReason[] = [...filterReasons, ...hardwareReasons];
  return (
    <li className="flex items-start justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0 dark:border-slate-800/60">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm text-slate-600 dark:text-slate-400">
            {model.displayName}
          </span>
          {model.isMoE && (
            <span className="shrink-0 rounded border border-violet-300 bg-violet-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:border-violet-700/60 dark:bg-violet-950/40 dark:text-violet-300">
              MoE
            </span>
          )}
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500">{model.developer}</div>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        {allReasons.map((reason) => (
          <div key={reason.type} className={`text-sm ${REJECTION_TONES[reason.type]}`}>
            {rejectionValue(reason)}
          </div>
        ))}
      </div>
    </li>
  );
}

export function Recommender({
  models,
  ramGB,
  contextLen,
  bandwidthGBps,
  lockQuantId,
  minTps,
  excludedDevs,
  onSetExcludedDevs,
}: Props): JSX.Element {
  const allDevelopers = useMemo(() => {
    const set = new Set(models.map((m) => m.developer));
    return Array.from(set).sort();
  }, [models]);

  const { matches, rejected } = useMemo(
    () =>
      recommend(models, QUANT_LEVELS, {
        ramGB,
        minContextLen: contextLen,
        minTps,
        bandwidthGBps,
        lockQuantId,
        excludedDevs: new Set(excludedDevs),
      }),
    [models, ramGB, contextLen, minTps, bandwidthGBps, lockQuantId, excludedDevs],
  );

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
      <DeveloperFilter
        allDevelopers={allDevelopers}
        excludedDevs={excludedDevs}
        onSetExcluded={onSetExcludedDevs}
      />

      {/* Summary */}
      <div className="border-b border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <span className="font-semibold text-slate-900 dark:text-slate-100">{matches.length}</span>{' '}
        {matches.length === 1 ? 'model meets' : 'models meet'} your constraints at{' '}
        {formatContext(contextLen)} context
      </div>

      {matches.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No models meet these constraints. Try raising RAM, lowering min tok/s, or allowing lower
          quants.
        </div>
      ) : (
        <ul>
          {matches.map(({ model, quant: recQuant, estimate }) => (
            <ModelRow
              key={model.id}
              model={model}
              quant={recQuant}
              contextLen={contextLen}
              ramGB={ramGB}
              bandwidthGBps={bandwidthGBps}
              estimate={estimate}
              quantLabel={recQuant.name}
            />
          ))}
        </ul>
      )}

      {rejected.length > 0 && (
        <details className="border-t-2 border-slate-200 dark:border-slate-700">
          <summary className="flex cursor-pointer select-none items-center justify-between bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:bg-slate-900/40 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200">
            <span>{rejected.length} filtered out</span>
            <span aria-hidden="true" className="text-slate-400 dark:text-slate-500">
              ▼
            </span>
          </summary>
          <ul>
            {rejected.map((r) => (
              <RejectedRow key={r.model.id} {...r} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
