// React-only chart primitives. Pure-function helpers (scales, ticks, colors,
// paths) live next to this in chartScales.ts.
import type { Scale } from './chartScales';

export interface AxisProps {
  orientation: 'x' | 'y';
  scale: Scale;
  ticks: number[];
  tickFormatter: (v: number) => string;
  // Pixel coord of the axis line on the perpendicular axis. For an x-axis at
  // the bottom of the plot this is `height - margin.bottom`; for a y-axis on
  // the left it's `margin.left`. Must be supplied by the caller — the
  // parallel-axis pixel range alone (scale.range) doesn't tell us where on
  // the perpendicular axis to draw.
  axisPosition: number;
  // Pixel extent of the perpendicular grid lines, measured from
  // `axisPosition` toward the plot interior. For an x-axis at the bottom,
  // pass `-plotHeight` so ticks rise upward; for a y-axis on the left, pass
  // `+plotWidth` so ticks extend rightward.
  gridSize: number;
  // Axis line + tick label color classes — passed through so the chart can
  // theme axes without each primitive re-deriving from theme state.
  className?: string;
}

export function Axis({
  orientation,
  scale,
  ticks,
  tickFormatter,
  axisPosition,
  gridSize,
  className,
}: AxisProps): JSX.Element {
  const [r0, r1] = scale.range;
  const stroke = className ?? 'stroke-slate-300 dark:stroke-slate-700';
  const text = 'fill-slate-600 dark:fill-slate-400 text-[10px]';
  if (orientation === 'x') {
    return (
      <g>
        {ticks.map((t) => {
          const x = scale(t);
          return (
            <g key={t}>
              <line
                x1={x}
                x2={x}
                y1={axisPosition}
                y2={axisPosition + gridSize}
                className={`${stroke} opacity-30`}
              />
              <text x={x} y={axisPosition + 14} textAnchor="middle" className={text}>
                {tickFormatter(t)}
              </text>
            </g>
          );
        })}
        <line x1={r0} x2={r1} y1={axisPosition} y2={axisPosition} className={stroke} />
      </g>
    );
  }
  return (
    <g>
      {ticks.map((t) => {
        const y = scale(t);
        return (
          <g key={t}>
            <line
              x1={axisPosition}
              x2={axisPosition + gridSize}
              y1={y}
              y2={y}
              className={`${stroke} opacity-30`}
            />
            <text x={axisPosition - 6} y={y + 3} textAnchor="end" className={text}>
              {tickFormatter(t)}
            </text>
          </g>
        );
      })}
      <line x1={axisPosition} x2={axisPosition} y1={r0} y2={r1} className={stroke} />
    </g>
  );
}

export interface DataPointProps {
  cx: number;
  cy: number;
  color: string;
  kind?: 'ok' | 'oom';
  // Tooltip text via title element — works without a JS popover layer.
  title?: string;
}

export function DataPoint({ cx, cy, color, kind = 'ok', title }: DataPointProps): JSX.Element {
  // OOM markers: red × overlay regardless of series color — the cliff is the
  // narrative, not which series caused it. OK markers: filled circle in the
  // series color.
  if (kind === 'oom') {
    const r = 4;
    return (
      <g>
        <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} stroke="#dc2626" strokeWidth={2} />
        <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} stroke="#dc2626" strokeWidth={2} />
        {title ? <title>{title}</title> : null}
      </g>
    );
  }
  return (
    <circle cx={cx} cy={cy} r={3} fill={color} stroke="white" strokeWidth={1}>
      {title ? <title>{title}</title> : null}
    </circle>
  );
}
