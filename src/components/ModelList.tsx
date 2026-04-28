import { useMemo, useState } from 'react';
import { decodeTokensPerSecond, estimateMemory } from '../lib/memory';
import { SPEED_STYLES, speedTier, type SpeedTier } from '../lib/speedTier';
import {
  compareWithin,
  SORT_OPTIONS,
  type Row,
  type SortKey,
} from '../lib/sortRows';
import type { Model, QuantLevel } from '../lib/types';
import { ModelRow } from './ModelRow';

interface Props {
  models: Model[];
  quant: QuantLevel;
  contextLen: number;
  ramGB: number;
  bandwidthGBps: number;
}

type BucketKey = 'fits' | 'tight' | 'over';
const BUCKET_ORDER: BucketKey[] = ['fits', 'tight', 'over'];

const BUCKET_META: Record<
  BucketKey,
  { label: string; dot: string; tone: string }
> = {
  fits: {
    label: 'Fits comfortably',
    dot: 'bg-emerald-500',
    tone: 'text-emerald-700 dark:text-emerald-300',
  },
  tight: {
    label: 'Tight (within 90–100% of RAM)',
    dot: 'bg-amber-500',
    tone: 'text-amber-700 dark:text-amber-300',
  },
  over: {
    label: "Doesn't fit",
    dot: 'bg-rose-500',
    tone: 'text-rose-700 dark:text-rose-300',
  },
};

function bucketOf(totalGB: number, ramGB: number): BucketKey {
  if (totalGB <= ramGB * 0.9) return 'fits';
  if (totalGB <= ramGB) return 'tight';
  return 'over';
}

export function ModelList({
  models,
  quant,
  contextLen,
  ramGB,
  bandwidthGBps,
}: Props): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('memory-asc');

  const grouped = useMemo(() => {
    const all = models.map<Row>((m) => ({
      model: m,
      estimate: estimateMemory(m, quant, contextLen),
    }));
    const buckets: Record<BucketKey, Row[]> = { fits: [], tight: [], over: [] };
    for (const row of all) {
      buckets[bucketOf(row.estimate.totalGB, ramGB)].push(row);
    }
    const sortCtx = { quant, contextLen, bandwidthGBps };
    for (const key of BUCKET_ORDER) {
      buckets[key].sort((a, b) => compareWithin(a, b, sortKey, sortCtx));
    }
    return buckets;
  }, [models, quant, contextLen, ramGB, bandwidthGBps, sortKey]);

  const totalCount = grouped.fits.length + grouped.tight.length + grouped.over.length;
  const fitCount = grouped.fits.length + grouped.tight.length;

  const speedCounts = useMemo(() => {
    const counts: Record<SpeedTier, number> = { fast: 0, usable: 0, slow: 0 };
    for (const key of ['fits', 'tight'] as const) {
      for (const row of grouped[key]) {
        const speed = decodeTokensPerSecond(row.model, quant, contextLen, bandwidthGBps);
        const mid = (speed.lowTps + speed.highTps) / 2;
        counts[speedTier(mid)]++;
      }
    }
    return counts;
  }, [grouped, quant, contextLen, bandwidthGBps]);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 dark:text-slate-400">
          <div>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{fitCount}</span> of{' '}
            {totalCount} fit in {ramGB} GB
          </div>
          {fitCount > 0 && (
            <div
              className="flex items-center gap-2"
              title={`Decode-speed tiers among the ${fitCount} models that fit. Fast: ≥${20} tok/s. Usable: 5–20 tok/s. Slow: <5 tok/s.`}
            >
              <span>|</span>
              {(['fast', 'usable', 'slow'] as const).map((tier) => {
                const style = SPEED_STYLES[tier];
                return (
                  <span
                    key={tier}
                    title={`${style.label} (${style.threshold})`}
                    className="inline-flex items-center gap-1"
                  >
                    <span
                      aria-hidden="true"
                      className={`text-xs font-bold leading-none tracking-tighter ${style.tone}`}
                    >
                      {style.icon}
                    </span>
                    <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">
                      {speedCounts[tier]}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Sort:</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {BUCKET_ORDER.map((key) => {
        const rows = grouped[key];
        if (rows.length === 0) return null;
        const meta = BUCKET_META[key];
        return (
          <section key={key}>
            <div
              className={`flex items-center gap-2 border-b border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide dark:border-slate-800 dark:bg-slate-900/40 ${meta.tone}`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} aria-hidden="true" />
              <span>{meta.label}</span>
              <span className="ml-auto font-normal normal-case tracking-normal text-slate-500 dark:text-slate-400">
                {rows.length}
              </span>
            </div>
            <ul>
              {rows.map(({ model, estimate }) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  quant={quant}
                  contextLen={contextLen}
                  ramGB={ramGB}
                  bandwidthGBps={bandwidthGBps}
                  estimate={estimate}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
