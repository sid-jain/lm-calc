import { formatContext } from '../lib/contextSnaps';
import { fmtBytes, fmtGB, fmtTpsRange } from '../lib/format';
import type { KvCacheQuant, MemoryEstimate, Model, QuantLevel, SpeedEstimate } from '../lib/types';

interface Props {
  model: Model;
  quant: QuantLevel;
  kvQuant: KvCacheQuant;
  contextLen: number;
  estimate: MemoryEstimate;
  speed: SpeedEstimate;
}

export function ModelDetails({
  model,
  quant,
  kvQuant,
  contextLen,
  estimate,
  speed,
}: Props): JSX.Element {
  const ctxClamped = contextLen > model.arch.maxContext;
  return (
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
          <span className="tabular-nums text-slate-700 dark:text-slate-300">{model.params}B</span>
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
          Attn:{' '}
          <span className="text-slate-700 dark:text-slate-300">{model.arch.attentionType}</span>
          {model.arch.attentionType === 'mixed' &&
            ` (${(model.arch.fullAttentionRatio ?? 0) * 100}% full, sw=${model.arch.slidingWindowSize})`}
        </div>
        <div>
          Max ctx:{' '}
          <span className="tabular-nums text-slate-700 dark:text-slate-300">
            {formatContext(model.arch.maxContext)}
          </span>
        </div>
      </div>
      <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Quant: {quant.name} ({quant.bytesPerParam.toFixed(4)} bytes/param) · KV at {kvQuant.name} (
        {kvQuant.bytesPerElement.toFixed(4)} bytes/elem) · decode is bandwidth-bound, range applies
        a 0.50–0.85× efficiency factor
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
  );
}
