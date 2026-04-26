import { useMemo } from 'react';
import { estimateMemory } from '../lib/memory';
import type { Model, QuantLevel } from '../lib/types';
import { ModelRow } from './ModelRow';

interface Props {
  models: Model[];
  quant: QuantLevel;
  contextLen: number;
  ramGB: number;
}

export function ModelList({ models, quant, contextLen, ramGB }: Props): JSX.Element {
  const rows = useMemo(() => {
    return models
      .map((m) => ({ model: m, estimate: estimateMemory(m, quant, contextLen) }))
      .sort((a, b) => a.estimate.totalGB - b.estimate.totalGB);
  }, [models, quant, contextLen]);

  const fitCount = rows.filter((r) => r.estimate.totalGB <= ramGB).length;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="border-b border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <span className="font-semibold text-slate-900 dark:text-slate-100">{fitCount}</span> of{' '}
        {rows.length} models fit in {ramGB} GB
      </div>
      <ul>
        {rows.map(({ model, estimate }) => (
          <ModelRow
            key={model.id}
            model={model}
            quant={quant}
            contextLen={contextLen}
            ramGB={ramGB}
            estimate={estimate}
          />
        ))}
      </ul>
    </div>
  );
}
