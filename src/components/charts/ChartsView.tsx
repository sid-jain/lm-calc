import type { Series } from '../../lib/appState';
import { DecodeVsDepthChart } from './DecodeVsDepthChart';
import { MemoryVsCtxChart } from './MemoryVsCtxChart';
import { SeriesManager } from './SeriesManager';

export interface ChartsViewProps {
  series: Series[];
  // Pre-fill values for the add-series popover, taken from whatever the user
  // currently has selected on the calculator. Keeps the two surfaces feeling
  // continuous — open Charts after picking a model + GPU and the first add
  // is one click instead of four.
  defaultSeries: Series;
  onAdd: (s: Series) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}

export function ChartsView({
  series,
  defaultSeries,
  onAdd,
  onRemove,
  onClear,
}: ChartsViewProps): JSX.Element {
  return (
    <div>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        Compare predicted memory and decode throughput across configurations. Each series is one
        (model, GPU, weight quant, KV quant) tuple — add as many as you want to compare. Measured
        points from <code className="text-xs">benchmarks/measurements/</code> overlay the prediction
        lines where data exists; OOM rows render as red ×.
      </p>

      <SeriesManager
        series={series}
        defaultSeries={defaultSeries}
        onAdd={onAdd}
        onRemove={onRemove}
        onClear={onClear}
      />

      {series.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Add a series above to start comparing configs.
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Memory vs context length
            </h3>
            <div className="rounded border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
              <MemoryVsCtxChart series={series} />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Solid line: predicted total memory. Shaded band (single-series only): the calculator's
              0.90×–1.30× confidence range. Dashed horizontal line: GPU VRAM. Filled circles:
              measured peak VRAM. Red ×: measured OOM.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Decode tok/s vs context depth
            </h3>
            <div className="rounded border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
              <DecodeVsDepthChart series={series} />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Solid line: theoretical bandwidth-bound tok/s. Shaded band (single-series only): the
              0.50×–0.92× efficiency range. Amber region from depth ≥ 16K marks where KV-dequant
              compute starts to dominate the bandwidth-bound formula — measured points there often
              fall below the prediction by design.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
