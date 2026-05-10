import { useState } from 'react';
import type { Series } from '../../lib/appState';
import { DEVICES } from '../../lib/devices';
import { KV_CACHE_QUANT_LEVELS } from '../../lib/kvCacheQuants';
import { models } from '../../lib/loadModels';
import { QUANT_LEVELS } from '../../lib/quants';
import { samplesCount } from '../../data/measurements';
import { seriesColor } from './chartScales';

// Marker for dropdown options that have measured data; using "●" rather than
// emoji so it picks up Tailwind text colors and works in dark mode without a
// separate icon system.
const HAS_DATA_MARK = '● ';
const NO_DATA_MARK = '○ ';

export interface SeriesManagerProps {
  series: Series[];
  // Default values for the add-series popover, pre-filled from the
  // calculator's current selection so the user lands in a sensible place.
  defaultSeries: Series;
  onAdd: (s: Series) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}

export function SeriesManager({
  series,
  defaultSeries,
  onAdd,
  onRemove,
  onClear,
}: SeriesManagerProps): JSX.Element {
  const [open, setOpen] = useState(series.length === 0);
  const [draft, setDraft] = useState<Series>(defaultSeries);

  const submit = () => {
    onAdd(draft);
    setOpen(false);
  };

  return (
    <section className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {series.map((s, i) => {
          const model = models.find((m) => m.id === s.modelId);
          const device = DEVICES.find((d) => d.id === s.gpuId);
          const wq = QUANT_LEVELS.find((q) => q.id === s.weightQuantId);
          const kvq = KV_CACHE_QUANT_LEVELS.find((q) => q.id === s.kvQuantId);
          if (!model || !device || !wq || !kvq) return null;
          const color = seriesColor(i);
          const matchedSamples = samplesCount({
            modelId: s.modelId,
            gpuId: s.gpuId,
            weightQuantId: s.weightQuantId,
            kvQuantId: s.kvQuantId,
          });
          return (
            <span
              key={i}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
              title={
                matchedSamples > 0
                  ? `${matchedSamples} measured sample${matchedSamples === 1 ? '' : 's'}`
                  : 'No measured data — predictions only'
              }
            >
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <span className="font-medium text-slate-800 dark:text-slate-100">
                {model.displayName}
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                {device.name} · {wq.name} · {kvq.name} KV
              </span>
              <span
                className={
                  matchedSamples > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-400 dark:text-slate-500'
                }
                aria-hidden
              >
                {matchedSamples > 0 ? '●' : '○'}
              </span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label="Remove series"
                className="text-slate-400 hover:text-red-500"
              >
                ×
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-400 px-3 py-1 text-xs text-slate-600 hover:border-slate-700 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-300 dark:hover:text-slate-100"
        >
          + Add series
        </button>
        {series.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-slate-500 hover:text-red-500 dark:text-slate-400"
          >
            Clear all
          </button>
        )}
      </div>

      {open &&
        (() => {
          // Each dropdown shows ● when picking that value (with the higher-level
          // selections held constant) leads to a tuple with measured data, ○ when
          // it doesn't. Walking top-down, each level's marker depends only on the
          // selections above it — so the user sees the data tree narrow as they
          // refine their pick.
          const draftFinalCount = samplesCount(draft);
          return (
            <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <label className="text-xs">
                  <span className="block text-slate-600 dark:text-slate-400">Model</span>
                  <select
                    value={draft.modelId}
                    onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    {models.map((m) => {
                      const has = samplesCount({ modelId: m.id }) > 0;
                      return (
                        <option key={m.id} value={m.id}>
                          {(has ? HAS_DATA_MARK : NO_DATA_MARK) + m.displayName}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="block text-slate-600 dark:text-slate-400">GPU / device</span>
                  <select
                    value={draft.gpuId}
                    onChange={(e) => setDraft({ ...draft, gpuId: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    {DEVICES.filter((d) => d.id !== 'custom').map((d) => {
                      const has = samplesCount({ modelId: draft.modelId, gpuId: d.id }) > 0;
                      return (
                        <option key={d.id} value={d.id}>
                          {(has ? HAS_DATA_MARK : NO_DATA_MARK) + d.name}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="block text-slate-600 dark:text-slate-400">Weight quant</span>
                  <select
                    value={draft.weightQuantId}
                    onChange={(e) => setDraft({ ...draft, weightQuantId: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    {QUANT_LEVELS.map((q) => {
                      const has =
                        samplesCount({
                          modelId: draft.modelId,
                          gpuId: draft.gpuId,
                          weightQuantId: q.id,
                        }) > 0;
                      return (
                        <option key={q.id} value={q.id}>
                          {(has ? HAS_DATA_MARK : NO_DATA_MARK) + q.name}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="block text-slate-600 dark:text-slate-400">KV quant</span>
                  <select
                    value={draft.kvQuantId}
                    onChange={(e) => setDraft({ ...draft, kvQuantId: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    {KV_CACHE_QUANT_LEVELS.map((q) => {
                      const has =
                        samplesCount({
                          modelId: draft.modelId,
                          gpuId: draft.gpuId,
                          weightQuantId: draft.weightQuantId,
                          kvQuantId: q.id,
                        }) > 0;
                      return (
                        <option key={q.id} value={q.id}>
                          {(has ? HAS_DATA_MARK : NO_DATA_MARK) + q.name}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span
                  className={
                    'text-xs ' +
                    (draftFinalCount > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400')
                  }
                >
                  {draftFinalCount > 0
                    ? `● ${draftFinalCount} measured sample${draftFinalCount === 1 ? '' : 's'} — overlays the prediction line`
                    : '○ No measurements for this combination — predictions only'}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  Options marked <span className="text-emerald-600 dark:text-emerald-400">●</span>{' '}
                  have data; <span>○</span> are predictions only.
                </span>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={submit}
                  className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  Add to charts
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="ml-2 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}
    </section>
  );
}
