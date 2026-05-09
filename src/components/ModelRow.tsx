import { formatContext } from '../lib/contextSnaps';
import { FIT_STYLES, fitStatus } from '../lib/fitStyle';
import { fmtGB, fmtTpsRange } from '../lib/format';
import { decodeTokensPerSecond, largestFittingQuant } from '../lib/memory';
import { QUANT_LEVELS } from '../lib/quants';
import { SPEED_STYLES, speedTier } from '../lib/speedTier';
import type { KvCacheQuant, MemoryEstimate, Model, QuantLevel } from '../lib/types';
import { RowShell } from './RowShell';

interface Props {
  model: Model;
  quant: QuantLevel;
  kvQuant: KvCacheQuant;
  contextLen: number;
  ramGB: number;
  bandwidthGBps: number;
  estimate: MemoryEstimate;
  quantLabel?: string;
  kvQuantLabel?: string;
}

export function ModelRow({
  model,
  quant,
  kvQuant,
  contextLen,
  ramGB,
  bandwidthGBps,
  estimate,
  quantLabel,
  kvQuantLabel,
}: Props): JSX.Element {
  const status = fitStatus(estimate.totalGB, ramGB);
  const fit = FIT_STYLES[status];
  const speed = decodeTokensPerSecond(model, quant, contextLen, bandwidthGBps, kvQuant);
  const speedMid = (speed.lowTps + speed.highTps) / 2;
  const spd = SPEED_STYLES[speedTier(speedMid)];
  const ctxClamped = contextLen > model.arch.maxContext;
  const fallbackQuant =
    status === 'over'
      ? largestFittingQuant(model, contextLen, ramGB, quant, QUANT_LEVELS, kvQuant)
      : null;

  return (
    <RowShell
      model={model}
      quant={quant}
      kvQuant={kvQuant}
      contextLen={contextLen}
      estimate={estimate}
      speed={speed}
      badges={
        <>
          {quantLabel && (
            <span className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {quantLabel}
            </span>
          )}
          {kvQuantLabel && (
            <span
              title={`KV cache stored at ${kvQuantLabel} (${kvQuant.bytesPerElement.toFixed(4)} bytes/elem)`}
              className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              KV {kvQuantLabel}
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
        </>
      }
      rightSlot={
        <>
          <div
            className="flex items-center justify-end gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200"
            title={fit.description}
          >
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
        </>
      }
    />
  );
}
