import { type ReactNode, useState } from 'react';
import type { KvCacheQuant, MemoryEstimate, Model, QuantLevel, SpeedEstimate } from '../lib/types';
import { ModelDetails } from './ModelDetails';

interface Props {
  model: Model;
  quant: QuantLevel;
  kvQuant: KvCacheQuant;
  contextLen: number;
  estimate: MemoryEstimate;
  speed: SpeedEstimate;
  /** Extra badges rendered after the MoE badge (e.g. quant tag, ctx-clamped warning). */
  badges?: ReactNode;
  /** Right-aligned content: metrics for matches, rejection reasons for filtered-out. */
  rightSlot: ReactNode;
  /** Render with subdued colors and lighter borders (used for rejected rows). */
  muted?: boolean;
}

export function RowShell({
  model,
  quant,
  kvQuant,
  contextLen,
  estimate,
  speed,
  badges,
  rightSlot,
  muted = false,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const liBorder = muted
    ? 'border-b border-slate-100 last:border-b-0 dark:border-slate-800/60'
    : 'border-b border-slate-200 last:border-b-0 dark:border-slate-800';
  const nameTone = muted ? 'text-slate-600 dark:text-slate-400' : '';
  const devTone = muted
    ? 'text-slate-400 dark:text-slate-500'
    : 'text-slate-500 dark:text-slate-400';
  return (
    <li className={liBorder}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`truncate text-sm font-medium ${nameTone}`}>{model.displayName}</span>
            {model.isMoE && (
              <span
                title={`Mixture of Experts: ~${model.activeParams}B active per token, all ${model.params}B loaded into memory`}
                className="shrink-0 rounded border border-violet-300 bg-violet-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:border-violet-700/60 dark:bg-violet-950/40 dark:text-violet-300"
              >
                MoE
              </span>
            )}
            {badges}
          </div>
          <div className={`truncate text-xs ${devTone}`}>{model.developer}</div>
        </div>
        <div className="shrink-0 text-right tabular-nums">{rightSlot}</div>
      </button>
      {open && (
        <ModelDetails
          model={model}
          quant={quant}
          kvQuant={kvQuant}
          contextLen={contextLen}
          estimate={estimate}
          speed={speed}
        />
      )}
    </li>
  );
}
