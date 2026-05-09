import { nextExcludedOnPillClick } from '../lib/devFilter';

interface Props {
  allDevelopers: string[];
  excludedDevs: string[];
  onSetExcluded: (devs: string[]) => void;
}

const PILL_ACTIVE =
  'rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 transition hover:border-sky-400 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:border-sky-600';
const PILL_INACTIVE =
  'rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500 dark:hover:border-slate-600 dark:hover:text-slate-300';

export function DeveloperFilter({
  allDevelopers,
  excludedDevs,
  onSetExcluded,
}: Props): JSX.Element {
  const excludedSet = new Set(excludedDevs);
  const allActive = excludedDevs.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
      <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">Developers:</span>
      <button
        type="button"
        onClick={() => onSetExcluded([])}
        aria-pressed={allActive}
        className={allActive ? PILL_ACTIVE : PILL_INACTIVE}
      >
        All
      </button>
      {allDevelopers.map((dev) => {
        const active = !excludedSet.has(dev);
        return (
          <button
            key={dev}
            type="button"
            onClick={() =>
              onSetExcluded(nextExcludedOnPillClick(dev, allDevelopers, excludedDevs))
            }
            aria-pressed={active}
            className={active ? PILL_ACTIVE : PILL_INACTIVE}
          >
            {dev}
          </button>
        );
      })}
    </div>
  );
}
