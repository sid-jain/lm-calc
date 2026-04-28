import { useState } from 'react';
import type { MemoryEstimate, Model, QuantLevel } from '../lib/types';
import { formatContext } from '../lib/contextSnaps';

interface Props {
  model: Model;
  quant: QuantLevel;
  contextLen: number;
  ramGB: number;
  estimate: MemoryEstimate;
}

type Status = 'fits' | 'tight' | 'over';

function status(totalGB: number, ramGB: number): Status {
  if (totalGB <= ramGB * 0.9) return 'fits';
  if (totalGB <= ramGB) return 'tight';
  return 'over';
}

const STATUS_STYLES: Record<Status, { bar: string; badge: string; icon: string; label: string }> =
  {
    fits: {
      bar: 'bg-emerald-500',
      badge: 'text-emerald-700 dark:text-emerald-300',
      icon: '✓',
      label: 'Fits',
    },
    tight: {
      bar: 'bg-amber-500',
      badge: 'text-amber-700 dark:text-amber-300',
      icon: '⚠',
      label: 'Tight',
    },
    over: {
      bar: 'bg-rose-500',
      badge: 'text-rose-700 dark:text-rose-300',
      icon: '✗',
      label: "Doesn't fit",
    },
  };

function fmtGB(n: number): string {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

export function ModelRow({
  model,
  quant,
  contextLen,
  ramGB,
  estimate,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const s = status(estimate.totalGB, ramGB);
  const style = STATUS_STYLES[s];
  const widthPct = Math.min(100, (estimate.totalGB / ramGB) * 100);
  const ctxClamped = contextLen > model.arch.maxContext;

  return (
    <li className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-col gap-1.5 px-3 py-3 text-left transition hover:bg-slate-50 sm:grid sm:grid-cols-[1fr_auto_minmax(80px,160px)_auto] sm:items-center sm:gap-3 dark:hover:bg-slate-900"
      >
        <div className="flex items-baseline justify-between gap-3 sm:contents">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{model.displayName}</span>
              {model.isMoE && (
                <span
                  title={`Mixture of Experts — ~${model.activeParams}B active per token, all ${model.params}B loaded into memory`}
                  className="shrink-0 rounded border border-violet-300 bg-violet-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:border-violet-700/60 dark:bg-violet-950/40 dark:text-violet-300"
                >
                  MoE
                </span>
              )}
            </div>
            <div className="truncate text-xs text-slate-500 dark:text-slate-400">
              {model.developer} · {model.family}
            </div>
          </div>
          <div className="shrink-0 text-sm tabular-nums text-slate-700 dark:text-slate-300">
            {fmtGB(estimate.rangeGB.low)}–{fmtGB(estimate.rangeGB.high)} GB
          </div>
        </div>
        <div className="flex items-center gap-2 sm:contents">
          <div
            className="h-2 flex-1 overflow-hidden rounded bg-slate-200 sm:flex-none dark:bg-slate-800"
            aria-hidden="true"
          >
            <div className={`h-full ${style.bar}`} style={{ width: `${widthPct}%` }} />
          </div>
          <div
            className={`flex shrink-0 items-center gap-1 text-sm font-semibold ${style.badge}`}
          >
            <span aria-hidden="true">{style.icon}</span>
            <span className="sr-only">{style.label}</span>
          </div>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-100 bg-slate-50 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-900/40">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Weights</dt>
              <dd className="tabular-nums">{fmtGB(estimate.weightsGB)} GB</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">KV cache</dt>
              <dd className="tabular-nums">{fmtGB(estimate.kvCacheGB)} GB</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Overhead</dt>
              <dd className="tabular-nums">{fmtGB(estimate.overheadGB)} GB</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Total (point)</dt>
              <dd className="tabular-nums">{fmtGB(estimate.totalGB)} GB</dd>
            </div>
          </dl>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-4 dark:text-slate-400">
            <div>
              Params:{' '}
              <span className="tabular-nums text-slate-700 dark:text-slate-300">
                {model.params}B
              </span>
              {model.isMoE && model.activeParams !== null && (
                <span className="text-slate-500 dark:text-slate-400">
                  {' '}
                  (<span className="tabular-nums">{model.activeParams}B</span> active)
                </span>
              )}
            </div>
            <div>
              Layers: <span className="tabular-nums text-slate-700 dark:text-slate-300">{model.arch.layers}</span>
            </div>
            <div>
              Attn: <span className="text-slate-700 dark:text-slate-300">{model.arch.attentionType}</span>
              {model.arch.attentionType === 'mixed' &&
                ` (${model.arch.fullAttentionRatio! * 100}% full, sw=${model.arch.slidingWindowSize})`}
            </div>
            <div>
              Max ctx:{' '}
              <span className="tabular-nums text-slate-700 dark:text-slate-300">
                {formatContext(model.arch.maxContext)}
              </span>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Quant: {quant.name} ({quant.bytesPerParam} bytes/param) · KV at FP16
          </div>
          {ctxClamped && (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Note: requested context ({formatContext(contextLen)}) exceeds model max — clamped to{' '}
              {formatContext(model.arch.maxContext)} for the KV calculation.
            </div>
          )}
          <div className="mt-2 text-xs">
            <a
              href={`https://huggingface.co/${model.hfRepo}`}
              target="_blank"
              rel="noreferrer"
              className="text-sky-600 hover:underline dark:text-sky-400"
            >
              View on HuggingFace ↗
            </a>
          </div>
        </div>
      )}
    </li>
  );
}
