import { CONTEXT_SNAPS, formatContext, snapContext } from '../lib/contextSnaps';
import { QUANT_LEVELS } from '../lib/quants';
import type { QuantLevel } from '../lib/types';

interface Props {
  ramGB: number;
  contextLen: number;
  quant: QuantLevel;
  onRamGB: (v: number) => void;
  onContextLen: (v: number) => void;
  onQuant: (q: QuantLevel) => void;
}

const RAM_MIN = 1;
const RAM_MAX = 1024;
const CTX_LOG_MIN = Math.log2(CONTEXT_SNAPS[0]);
const CTX_LOG_MAX = Math.log2(CONTEXT_SNAPS[CONTEXT_SNAPS.length - 1]);

export function Controls({
  ramGB,
  contextLen,
  quant,
  onRamGB,
  onContextLen,
  onQuant,
}: Props): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <label
          htmlFor="ram-input"
          className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          Available RAM
        </label>
        <div className="mt-2 flex items-baseline gap-2">
          <input
            id="ram-input"
            type="number"
            min={RAM_MIN}
            max={RAM_MAX}
            step={1}
            value={ramGB}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) {
                onRamGB(Math.max(RAM_MIN, Math.min(RAM_MAX, Math.round(n))));
              }
            }}
            className="w-24 rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-2 py-1 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
          />
          <span className="text-sm text-slate-500 dark:text-slate-400">GB</span>
        </div>
        <input
          aria-label="RAM slider"
          type="range"
          min={RAM_MIN}
          max={RAM_MAX}
          step={1}
          value={ramGB}
          onChange={(e) => onRamGB(Number(e.target.value))}
          className="mt-3 w-full accent-sky-600"
        />
      </div>

      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <label
          htmlFor="ctx-select"
          className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          Context length
        </label>
        <div className="mt-2 flex items-baseline gap-2">
          <select
            id="ctx-select"
            value={contextLen}
            onChange={(e) => onContextLen(Number(e.target.value))}
            className="rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-2 py-1 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
          >
            {CONTEXT_SNAPS.map((c) => (
              <option key={c} value={c}>
                {formatContext(c)}
              </option>
            ))}
          </select>
          <span className="text-sm text-slate-500 dark:text-slate-400">tokens</span>
        </div>
        <input
          aria-label="Context length slider"
          type="range"
          min={CTX_LOG_MIN}
          max={CTX_LOG_MAX}
          step={0.001}
          value={Math.log2(contextLen)}
          onChange={(e) => onContextLen(snapContext(2 ** Number(e.target.value)))}
          className="mt-3 w-full accent-sky-600"
        />
      </div>

      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <label
          htmlFor="quant-select"
          className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          Quantization
        </label>
        <select
          id="quant-select"
          value={quant.id}
          onChange={(e) => {
            const next = QUANT_LEVELS.find((q) => q.id === e.target.value);
            if (next) onQuant(next);
          }}
          className="mt-2 w-full rounded border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 px-2 py-2 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700"
        >
          {QUANT_LEVELS.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{quant.description}</p>
      </div>
    </div>
  );
}
