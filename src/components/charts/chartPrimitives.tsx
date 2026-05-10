// React-only chart primitives. Pure-function helpers (scales, ticks, colors,
// paths) live next to this in chartScales.ts.
import type { Scale } from './chartScales';

export interface AxisProps {
  orientation: 'x' | 'y';
  scale: Scale;
  ticks: number[];
  tickFormatter: (v: number) => string;
  // Axis line + label color classes — passed through so the chart can theme
  // axes without each primitive re-deriving from theme state.
  className?: string;
  // Length of the perpendicular grid lines (the axis itself is at one edge,
  // grid extends across the plot).
  gridSize: number;
}

export function Axis({
  orientation,
  scale,
  ticks,
  tickFormatter,
  className,
  gridSize,
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
              <line x1={x} x2={x} y1={r0} y2={r0 - gridSize} className={`${stroke} opacity-30`} />
              <text x={x} y={r0 + 14} textAnchor="middle" className={text}>
                {tickFormatter(t)}
              </text>
            </g>
          );
        })}
        <line x1={r0} x2={r1} y1={r0} y2={r0} className={stroke} />
      </g>
    );
  }
  return (
    <g>
      {ticks.map((t) => {
        const y = scale(t);
        return (
          <g key={t}>
            <line x1={r0} x2={r0 + gridSize} y1={y} y2={y} className={`${stroke} opacity-30`} />
            <text x={r0 - 6} y={y + 3} textAnchor="end" className={text}>
              {tickFormatter(t)}
            </text>
          </g>
        );
      })}
      <line x1={r0} x2={r0} y1={r0} y2={r1} className={stroke} />
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
