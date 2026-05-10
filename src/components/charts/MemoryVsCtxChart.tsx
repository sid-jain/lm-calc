import { useMemo } from 'react';
import type { Series } from '../../lib/appState';
import { findSamples } from '../../data/measurements';
import { estimateMemory } from '../../lib/memory';
import { Axis, DataPoint } from './chartPrimitives';
import {
  bandPath,
  fmtCtx,
  groupMemorySamplesByCtx,
  linearScale,
  logScale,
  mibToGB,
  niceLinearTicks,
  pointsToPath,
  powerOfTwoTicks,
  resolveSeries,
  seriesColor,
} from './chartScales';

// Y-axis is in decimal GB to match the rest of the UI (`estimateMemory().totalGB`,
// `Device.memoryGB`). Measured peaks come from nvidia-smi as MiB (binary), so
// they're the only values that need a unit conversion before plotting.

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
  // GPU VRAM threshold so the threshold lines are inside the plot area. All
  // values land in decimal GB before being added — predicted curves are
  // already GB; measured peaks come in as MiB and need conversion.
  const yMaxCandidates: number[] = [];
  for (const c of curves) {
    const last = c.points[c.points.length - 1];
    yMaxCandidates.push(last.rangeGB.high);
    if (c.resolved.device.memoryGB) yMaxCandidates.push(c.resolved.device.memoryGB);
  }
  for (const r of resolved) {
    for (const s of findSamples({
      modelId: r.series.modelId,
      gpuId: r.series.gpuId,
      weightQuantId: r.series.weightQuantId,
    })) {
      // OOM rows' peak_vram_mib reflects a partial allocation before crash
      // — not a real measurement, exclude from the auto-fit.
      if (s.status === 'oom') continue;
      yMaxCandidates.push(mibToGB(s.peak_vram_mib));
    }
  }
  const yMax = Math.max(...yMaxCandidates, 1) * 1.15;

  const margin = { top: 16, right: 16, bottom: 32, left: 44 };
  const xScale = logScale([xMin, xMax], [margin.left, width - margin.right]);
  const yScale = linearScale([0, yMax], [height - margin.bottom, margin.top]);
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const xAxisY = height - margin.bottom;
  const yAxisX = margin.left;

  const xTicks = powerOfTwoTicks(xMin, xMax);
  const yTicks = niceLinearTicks(0, yMax, 5);

  const showBand = curves.length === 1;

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

      {/* Axes first so curves render on top. axisPosition is the pixel coord
          of each spine (bottom-left of the plot), and gridSize sweeps the
          ticks toward the plot interior. */}
      <Axis
        orientation="x"
        scale={xScale}
        ticks={xTicks}
        tickFormatter={fmtCtx}
        axisPosition={xAxisY}
        gridSize={-plotHeight}
      />
      <Axis
        orientation="y"
        scale={yScale}
        ticks={yTicks}
        tickFormatter={(v) => `${v.toFixed(0)} GB`}
        axisPosition={yAxisX}
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
            yScale(p.rangeGB.high),
          ]);
          const lower: Array<[number, number]> = c.points.map((p) => [
            xScale(p.ctx),
            yScale(p.rangeGB.low),
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
          yScale(p.totalGB),
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
        const groups = groupMemorySamplesByCtx(samples);
        const ceilingGB = c.resolved.device.memoryGB ?? yMax;
        return groups.map((g, j) => {
          const cx = xScale(g.ctx);
          const cy = yScale(g.hasOom ? ceilingGB : mibToGB(g.peakMib));
          const title = g.hasOom
            ? `OOM at ctx=${g.ctx}${g.oomDepth ? `, depth=${g.oomDepth}` : ''} (${c.resolved.kvQuant.name} KV)`
            : `${mibToGB(g.peakMib).toFixed(2)} GB measured @ ctx=${g.ctx} (${c.resolved.kvQuant.name} KV)`;
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
