import { useState } from 'react';
import { formatContext } from '../lib/contextSnaps';
import { FIT_STYLES, fitStatus } from '../lib/fitStyle';
import { decodeTokensPerSecond, largestFittingQuant } from '../lib/memory';
import { QUANT_LEVELS } from '../lib/quants';
import { SPEED_STYLES, speedTier } from '../lib/speedTier';
import type { MemoryEstimate, Model, QuantLevel } from '../lib/types';

interface Props {
  model: Model;
  quant: QuantLevel;
  contextLen: number;
  ramGB: number;
  bandwidthGBps: number;
  estimate: MemoryEstimate;
  quantLabel?: string;
}

function fmtGB(n: number): string {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function fmtTpsRange(low: number, high: number): string {
  if (high < 1) return '<1 tok/s';
  if (low < 1) return `<1 - ${Math.round(high)} tok/s`;
  return `${Math.round(low)} - ${Math.round(high)} tok/s`;
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}

export function ModelRow({
  model,
  quant,
  contextLen,
  ramGB,
  bandwidthGBps,
  estimate,
  quantLabel,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const status = fitStatus(estimate.totalGB, ramGB);
  const fit = FIT_STYLES[status];
  const speed = decodeTokensPerSecond(model, quant, contextLen, bandwidthGBps);
  const speedMid = (speed.lowTps + speed.highTps) / 2;
  const spd = SPEED_STYLES[speedTier(speedMid)];
  const ctxClamped = contextLen > model.arch.maxContext;
  const fallbackQuant =
    status === 'over' ? largestFittingQuant(model, contextLen, ramGB, quant, QUANT_LEVELS) : null;

  return (
    <li className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{model.displayName}</span>
            {quantLabel && (
              <span className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {quantLabel}
              </span>
            )}
            {model.isMoE && (
              <span
                title={`Mixture of Experts: ~${model.activeParams}B active per token, all ${model.params}B loaded into memory`}
                className="shrink-0 rounded border border-violet-300 bg-violet-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:border-violet-700/60 dark:bg-violet-950/40 dark:text-violet-300"
              >
                MoE
              </span>
            )}
            {ctxClamped && (
              <span
                title={`Requested context (${formatContext(contextLen)}) exceeds this model's max - clamped to ${formatContext(model.arch.maxContext)} for the KV calculation.`}
                className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300"
              >
                ctx {formatContext(model.arch.maxContext)}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
            {model.developer}
          </div>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <div className="flex items-center justify-end gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>
              {fmtGB(estimate.rangeGB.low)} - {fmtGB(estimate.rangeGB.high)} GB
            </span>
            <span aria-hidden="true" className={`text-base font-bold leading-none ${fit.tone}`}>
              {fit.icon}
            </span>
            <span className="sr-only">{fit.label}</span>
          </div>
          <div
            className="flex items-center justify-end gap-1.5 text-sm text-slate-500 dark:text-slate-400"
            title={`${spd.label} (${spd.threshold})`}
          >
            <span>{fmtTpsRange(speed.lowTps, speed.highTps)}</span>
            <span
              aria-hidden="true"
              className={`text-[10px] font-bold leading-none tracking-tighter ${spd.tone}`}
            >
              {spd.icon}
            </span>
            <span className="sr-only">{spd.label}</span>
          </div>
          {fallbackQuant && (
            <div
              className="text-xs text-slate-500 dark:text-slate-400"
              title={`At ${quant.name} this model needs more than ${ramGB} GB. ${fallbackQuant.name} (${fallbackQuant.bytesPerParam} bytes/param) brings it under the limit.`}
            >
              Fits at {fallbackQuant.name}
            </div>
          )}
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

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Decode speed</dt>
              <dd className="tabular-nums">{fmtTpsRange(speed.lowTps, speed.highTps)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Theoretical max</dt>
              <dd className="tabular-nums">{speed.theoreticalTps.toFixed(1)} tok/s</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Bytes / token</dt>
              <dd className="tabular-nums">
                {fmtBytes(speed.weightBytesPerToken + speed.kvBytesPerToken)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Bandwidth</dt>
              <dd className="tabular-nums">{speed.bandwidthGBps} GB/s</dd>
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
              Layers:{' '}
              <span className="tabular-nums text-slate-700 dark:text-slate-300">
                {model.arch.layers}
              </span>
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
            Quant: {quant.name} ({quant.bytesPerParam} bytes/param) · KV at FP16 · decode is
            bandwidth-bound, range applies a 0.50–0.85× efficiency factor
          </div>
          {ctxClamped && (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Note: requested context ({formatContext(contextLen)}) exceeds model max - clamped to{' '}
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
