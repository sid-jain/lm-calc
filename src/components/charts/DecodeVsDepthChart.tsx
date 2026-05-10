import { useMemo } from 'react';
import type { Series } from '../../lib/appState';
import { findSamples } from '../../data/measurements';
import { decodeTokensPerSecond } from '../../lib/memory';
import { Axis, DataPoint } from './chartPrimitives';
import {
  bandPath,
  fmtCtx,
  linearScale,
  logScale,
  niceLinearTicks,
  pointsToPath,
  powerOfTwoTicks,
  resolveSeries,
  seriesColor,
} from './chartScales';

// Above this depth, KV-dequant compute starts to dominate the bandwidth-bound
// formula's prediction. Matches `COMPUTE_DOMINATED_DEPTH` in the regression
// test (src/lib/measurements.test.ts:62) and the discussion in METHODOLOGY.md
// "Decode speed limits". The chart shades this region so users see why the
// prediction diverges from measurements at large depth.
const COMPUTE_DOMINATED_DEPTH = 16384;

const CURVE_SAMPLES = 30;
const MIN_DEPTH = 512;

export interface DecodeVsDepthChartProps {
  series: Series[];
  width?: number;
  height?: number;
}

export function DecodeVsDepthChart({
  series,
  width = 720,
  height = 320,
}: DecodeVsDepthChartProps): JSX.Element {
  const resolved = useMemo(
    () => series.map(resolveSeries).filter((r): r is NonNullable<typeof r> => r !== null),
    [series],
  );

  // x-domain: 512 → max maxContext across selected models. The decode formula
  // takes depth (cache fill) — the maxContext defines the deepest meaningful
  // measurement on each model.
  const xMax = Math.max(...resolved.map((r) => r.model.arch.maxContext), MIN_DEPTH * 2);
  const xMin = MIN_DEPTH;

  const curves = useMemo(() => {
    return resolved.map((r) => {
      const depths: number[] = [];
      const lo = Math.log10(xMin);
      const hi = Math.log10(r.model.arch.maxContext);
      for (let i = 0; i < CURVE_SAMPLES; i++) {
        depths.push(10 ** (lo + ((hi - lo) * i) / (CURVE_SAMPLES - 1)));
      }
      const points = depths.map((depth) => {
        const sp = decodeTokensPerSecond(
          r.model,
          r.weightQuant,
          depth,
          r.device.bandwidthGBps,
          r.kvQuant,
        );
        return { depth, ...sp };
      });
      return { resolved: r, points };
    });
  }, [resolved, xMin]);

  // y-domain: cap at the max prediction (theoretical or band high) and any
  // measured tg_tok_s, plus headroom.
  const yMaxCandidates: number[] = [];
  for (const c of curves) yMaxCandidates.push(c.points[0].highTps);
  for (const r of resolved) {
    for (const s of findSamples({
      modelId: r.series.modelId,
      gpuId: r.series.gpuId,
      weightQuantId: r.series.weightQuantId,
    })) {
      if (s.kv_quant_id !== r.kvQuant.id) continue;
      if (typeof s.tg_tok_s === 'number') yMaxCandidates.push(s.tg_tok_s);
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

  // Compute-bound region — only render when its left edge is inside the plot.
  const computeBoundLeft = xScale(Math.max(COMPUTE_DOMINATED_DEPTH, xMin));
  const showComputeBoundShade = COMPUTE_DOMINATED_DEPTH < xMax;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="Predicted decode tokens-per-second vs context depth, with measured points overlaid"
    >
      <defs>
        <clipPath id="decchart-plot-area">
          <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} />
        </clipPath>
      </defs>

      {/* Compute-bound region shade — sits behind axes/grid. Soft amber so it
          reads as "be aware" not "broken". */}
      {showComputeBoundShade && (
        <g>
          <rect
            x={computeBoundLeft}
            y={margin.top}
            width={width - margin.right - computeBoundLeft}
            height={plotHeight}
            fill="#f59e0b"
            opacity={0.06}
          />
          <text
            x={computeBoundLeft + 6}
            y={margin.top + 12}
            fontSize={10}
            className="fill-amber-700 dark:fill-amber-300"
          >
            compute-bound (KV dequant)
          </text>
        </g>
      )}

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
        tickFormatter={(v) => `${v.toFixed(0)} tok/s`}
        axisPosition={yAxisX}
        gridSize={plotWidth}
      />

      {showBand &&
        curves.map((c, i) => {
          const upper: Array<[number, number]> = c.points.map((p) => [
            xScale(p.depth),
            yScale(p.highTps),
          ]);
          const lower: Array<[number, number]> = c.points.map((p) => [
            xScale(p.depth),
            yScale(p.lowTps),
          ]);
          return (
            <path
              key={`band-${i}`}
              d={bandPath(upper, lower)}
              fill={seriesColor(i)}
              opacity={0.12}
              clipPath="url(#decchart-plot-area)"
            />
          );
        })}

      {curves.map((c, i) => {
        // Predicted line uses theoreticalTps (the bandwidth-bound formula),
        // matching what the calculator's row currently displays as the point
        // estimate. The band (when shown) covers the lowTps/highTps range.
        const linePts: Array<[number, number]> = c.points.map((p) => [
          xScale(p.depth),
          yScale(p.theoreticalTps),
        ]);
        return (
          <polyline
            key={`line-${i}`}
            points={pointsToPath(linePts)}
            fill="none"
            stroke={seriesColor(i)}
            strokeWidth={2}
            clipPath="url(#decchart-plot-area)"
          />
        );
      })}

      {/* Measured scatter — only OK rows (OOM rows have null tg). */}
      {curves.flatMap((c, i) => {
        const samples = findSamples({
          modelId: c.resolved.series.modelId,
          gpuId: c.resolved.series.gpuId,
          weightQuantId: c.resolved.series.weightQuantId,
        }).filter((s) => s.kv_quant_id === c.resolved.series.kvQuantId && s.tg_tok_s !== null);
        return samples.map((s, j) => {
          const cx = xScale(s.depth);
          const cy = yScale(s.tg_tok_s as number);
          const title = `${(s.tg_tok_s as number).toFixed(1)} tok/s @ depth=${s.depth} (${c.resolved.kvQuant.name} KV)`;
          return (
            <DataPoint key={`pt-${i}-${j}`} cx={cx} cy={cy} color={seriesColor(i)} title={title} />
          );
        });
      })}
    </svg>
  );
}
