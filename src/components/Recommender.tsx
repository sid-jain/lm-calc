import { useMemo } from 'react';
import { QUANT_LEVELS } from '../lib/quants';
import { recommend } from '../lib/recommender';
import type { Model } from '../lib/types';
import { DeveloperFilter } from './DeveloperFilter';
import { ModelRow } from './ModelRow';
import { RejectedRow } from './RejectedRow';

interface Props {
  models: Model[];
  ramGB: number;
  contextLen: number;
  bandwidthGBps: number;
  lockQuantId: string | null;
  kvCacheQuantId: string;
  minTps: number;
  excludedDevs: string[];
  onSetExcludedDevs: (devs: string[]) => void;
}

export function Recommender({
  models,
  ramGB,
  contextLen,
  bandwidthGBps,
  lockQuantId,
  kvCacheQuantId,
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
        kvCacheQuantId,
        excludedDevs: new Set(excludedDevs),
      }),
    [models, ramGB, contextLen, minTps, bandwidthGBps, lockQuantId, kvCacheQuantId, excludedDevs],
  );

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-sky-300 shadow-[0_0_20px_-2px_rgba(56,189,248,0.4)] dark:border-sky-700 dark:shadow-[0_0_20px_-2px_rgba(56,189,248,0.25)]">
        <DeveloperFilter
          allDevelopers={allDevelopers}
          excludedDevs={excludedDevs}
          onSetExcluded={onSetExcludedDevs}
        />

        <div className="border-b border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{matches.length}</span>{' '}
          {matches.length === 1 ? 'model meets' : 'models meet'} your constraints
        </div>

        {matches.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No models meet these constraints. Try raising RAM, lowering min tok/s, or allowing lower
            quants.
          </div>
        ) : (
          <ul>
            {matches.map(({ model, quant: recQuant, kvQuant, estimate }) => (
              <ModelRow
                key={model.id}
                model={model}
                quant={recQuant}
                kvQuant={kvQuant}
                contextLen={contextLen}
                ramGB={ramGB}
                bandwidthGBps={bandwidthGBps}
                estimate={estimate}
                quantLabel={recQuant.name}
                kvQuantLabel={kvQuant.name}
              />
            ))}
          </ul>
        )}
      </div>

      {rejected.length > 0 && (
        <section className="mt-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <h4 className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
            {rejected.length} filtered out
          </h4>
          <ul>
            {rejected.map((r) => (
              <RejectedRow
                key={r.model.id}
                {...r}
                contextLen={contextLen}
                bandwidthGBps={bandwidthGBps}
                lockQuantId={lockQuantId}
                kvCacheQuantId={kvCacheQuantId}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
