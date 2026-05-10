import { useMemo } from 'react';
import type { Series } from '../../lib/appState';
import { findSamples } from '../../data/measurements';
import { DEVICES } from '../../lib/devices';
import { KV_CACHE_QUANT_LEVELS } from '../../lib/kvCacheQuants';
import { models } from '../../lib/loadModels';
import { estimateMemory } from '../../lib/memory';
import { QUANT_LEVELS } from '../../lib/quants';
import { Axis, DataPoint } from './chartPrimitives';
import {
  bandPath,
  fmtCtx,
  linearScale,
  logScale,
  niceLinearTicks,
  pointsToPath,
  powerOfTwoTicks,
  seriesColor,
} from './chartScales';

// Memory in GiB, displayed; calculator works in decimal GB internally — we
// convert once at draw time so the y-axis matches what nvidia-smi reports.
const MIB_PER_GIB = 1024;
const MIB_PER_GB_DECIMAL = 1000;

// Resolve a Series tuple to the typed objects the math layer needs. Returns
// null when any id doesn't resolve — caller filters those out.
function resolveSeries(s: Series) {
  const model = models.find((m) => m.id === s.modelId);
  const device = DEVICES.find((d) => d.id === s.gpuId);
  const weightQuant = QUANT_LEVELS.find((q) => q.id === s.weightQuantId);
  const kvQuant = KV_CACHE_QUANT_LEVELS.find((q) => q.id === s.kvQuantId);
  if (!model || !device || !weightQuant || !kvQuant) return null;
  return { series: s, model, device, weightQuant, kvQuant };
}

const CURVE_SAMPLES = 30;
const MIN_CTX = 1024;

export interface MemoryVsCtxChartProps {
  series: Series[];
  width?: number;
  height?: number;
}

export function MemoryVsCtxChart({
  series,
  width = 720,
  height = 320,
}: MemoryVsCtxChartProps): JSX.Element {
  const resolved = useMemo(
    () => series.map(resolveSeries).filter((r): r is NonNullable<typeof r> => r !== null),
    [series],
  );

  // x-domain: 1K → max maxContext across selected models. Defaults bail if
  // somehow zero series resolve (parent renders an empty state in that case).
  const xMax = Math.max(...resolved.map((r) => r.model.arch.maxContext), MIN_CTX * 2);
  const xMin = MIN_CTX;

  // Per-series prediction curve at log-spaced ctx points. Memoized by tuple
  // identity so dragging the series list doesn't recompute curves that
  // haven't changed.
  const curves = useMemo(() => {
    return resolved.map((r) => {
      const ctxs: number[] = [];
      const lo = Math.log10(xMin);
      const hi = Math.log10(r.model.arch.maxContext);
      for (let i = 0; i < CURVE_SAMPLES; i++) {
        ctxs.push(10 ** (lo + ((hi - lo) * i) / (CURVE_SAMPLES - 1)));
      }
      const points = ctxs.map((ctx) => {
        const est = estimateMemory(r.model, r.weightQuant, ctx, r.kvQuant);
        return { ctx, ...est };
      });
      return { resolved: r, points };
    });
  }, [resolved, xMin]);

  // y-domain: comfortably above the highest measured/predicted value AND any
  // GPU VRAM threshold so the threshold lines are inside the plot area.
  const yMaxCandidates: number[] = [];
  for (const c of curves) {
    const last = c.points[c.points.length - 1];
    yMaxCandidates.push(last.rangeGB.high);
    if (c.resolved.device.memoryGB) yMaxCandidates.push(c.resolved.device.memoryGB);
  }
  // Include measured points (peak VRAM is reported in MiB, convert to GiB so
  // it lines up with the y-axis units).
  for (const r of resolved) {
    for (const s of findSamples({
      modelId: r.series.modelId,
      gpuId: r.series.gpuId,
      weightQuantId: r.series.weightQuantId,
    })) {
      if (s.status === 'oom') continue;
      yMaxCandidates.push(s.peak_vram_mib / MIB_PER_GIB);
    }
  }
  const yMax = Math.max(...yMaxCandidates, 1) * 1.15;

  const margin = { top: 16, right: 16, bottom: 32, left: 44 };
  const xScale = logScale([xMin, xMax], [margin.left, width - margin.right]);
  const yScale = linearScale([0, yMax], [height - margin.bottom, margin.top]);
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const xTicks = powerOfTwoTicks(xMin, xMax);
  const yTicks = niceLinearTicks(0, yMax, 5);

  const showBand = curves.length === 1;

  // Convert peak_vram from MiB (nvidia-smi convention) to the GB unit the
  // calculator's predictions use, so measured points sit on the same axis as
  // the prediction lines. The fixture's peak_vram is in MiB. Calculator
  // returns decimal GB. We display GiB on the y-axis to match what users see
  // in nvidia-smi / GPU specs — convert decimal GB to GiB for the curve too.
  const decimalGBtoGiB = (gb: number) => (gb * MIB_PER_GB_DECIMAL) / MIB_PER_GIB;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="Predicted memory vs context length, with measured points overlaid"
    >
      <defs>
        <clipPath id="memchart-plot-area">
          <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} />
        </clipPath>
      </defs>

      {/* axes first so curves render on top */}
      <Axis
        orientation="x"
        scale={xScale}
        ticks={xTicks}
        tickFormatter={fmtCtx}
        gridSize={-plotHeight}
      />
      <Axis
        orientation="y"
        scale={yScale}
        ticks={yTicks}
        tickFormatter={(v) => `${v.toFixed(0)} GiB`}
        gridSize={plotWidth}
      />

      {/* GPU VRAM threshold lines — one per unique GPU among series, dashed,
          colored to the first series for that GPU so it groups visually. */}
      {(() => {
        const seenGpus = new Map<string, number>();
        return curves
          .map((c, i) => {
            if (!c.resolved.device.memoryGB) return null;
            if (seenGpus.has(c.resolved.device.id)) return null;
            seenGpus.set(c.resolved.device.id, i);
            const y = yScale(c.resolved.device.memoryGB);
            const color = seriesColor(i);
            return (
              <g key={`vram-${c.resolved.device.id}`}>
                <line
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={y}
                  y2={y}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  opacity={0.6}
                />
                <text
                  x={width - margin.right - 4}
                  y={y - 4}
                  textAnchor="end"
                  fontSize={10}
                  fill={color}
                  opacity={0.85}
                >
                  {c.resolved.device.name} ({c.resolved.device.memoryGB} GB)
                </text>
              </g>
            );
          })
          .filter(Boolean);
      })()}

      {/* Bands (only when single series — multi-series with bands gets noisy) */}
      {showBand &&
        curves.map((c, i) => {
          const upper: Array<[number, number]> = c.points.map((p) => [
            xScale(p.ctx),
            yScale(decimalGBtoGiB(p.rangeGB.high)),
          ]);
          const lower: Array<[number, number]> = c.points.map((p) => [
            xScale(p.ctx),
            yScale(decimalGBtoGiB(p.rangeGB.low)),
          ]);
          return (
            <path
              key={`band-${i}`}
              d={bandPath(upper, lower)}
              fill={seriesColor(i)}
              opacity={0.12}
              clipPath="url(#memchart-plot-area)"
            />
          );
        })}

      {/* Prediction lines */}
      {curves.map((c, i) => {
        const linePts: Array<[number, number]> = c.points.map((p) => [
          xScale(p.ctx),
          yScale(decimalGBtoGiB(p.totalGB)),
        ]);
        return (
          <polyline
            key={`line-${i}`}
            points={pointsToPath(linePts)}
            fill="none"
            stroke={seriesColor(i)}
            strokeWidth={2}
            clipPath="url(#memchart-plot-area)"
          />
        );
      })}

      {/* Measured scatter — one symbol per (ctx, kv) config, NOT per row.
          peak_vram_mib is sampled by nvidia-smi across the whole config run
          (see bench.sh:run_one), so every row sharing (weight, kv, ctx)
          carries the same value. If ANY row in the config OOMed, that peak
          reflects a partial allocation before crash — plotting it as a
          successful measurement next to the red × would imply two outcomes
          for one config. Collapse to one marker per group: × at the GPU VRAM
          ceiling when any row OOMed, circle at peak_vram_mib otherwise. */}
      {curves.flatMap((c, i) => {
        const samples = findSamples({
          modelId: c.resolved.series.modelId,
          gpuId: c.resolved.series.gpuId,
          weightQuantId: c.resolved.series.weightQuantId,
        }).filter((s) => s.kv_quant_id === c.resolved.series.kvQuantId);
        // Group by ctx (weight + kv already fixed by series + filter above).
        type Group = { ctx: number; peakMib: number; hasOom: boolean; oomDepth?: number };
        const groups = new Map<number, Group>();
        for (const s of samples) {
          const g = groups.get(s.ctx) ?? {
            ctx: s.ctx,
            peakMib: 0,
            hasOom: false,
          };
          g.peakMib = Math.max(g.peakMib, s.peak_vram_mib);
          if (s.status === 'oom') {
            g.hasOom = true;
            g.oomDepth = s.depth;
          }
          groups.set(s.ctx, g);
        }
        const ceilingGiB = c.resolved.device.memoryGB
          ? (c.resolved.device.memoryGB * MIB_PER_GB_DECIMAL) / MIB_PER_GIB
          : yMax;
        return Array.from(groups.values()).map((g, j) => {
          const cx = xScale(g.ctx);
          const cy = yScale(g.hasOom ? ceilingGiB : g.peakMib / MIB_PER_GIB);
          const title = g.hasOom
            ? `OOM at ctx=${g.ctx}${g.oomDepth ? `, depth=${g.oomDepth}` : ''} (${c.resolved.kvQuant.name} KV)`
            : `${(g.peakMib / MIB_PER_GIB).toFixed(2)} GiB measured @ ctx=${g.ctx} (${c.resolved.kvQuant.name} KV)`;
          return (
            <DataPoint
              key={`pt-${i}-${j}`}
              cx={cx}
              cy={cy}
              color={seriesColor(i)}
              kind={g.hasOom ? 'oom' : 'ok'}
              title={title}
            />
          );
        });
      })}
    </svg>
  );
}
