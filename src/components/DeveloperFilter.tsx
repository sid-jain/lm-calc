interface Props {
  allDevelopers: string[];
  excludedDevs: string[];
  onToggle: (dev: string) => void;
  onClear: () => void;
}

export function DeveloperFilter({
  allDevelopers,
  excludedDevs,
  onToggle,
  onClear,
}: Props): JSX.Element {
  const excludedSet = new Set(excludedDevs);
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
      <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">Developers:</span>
      {allDevelopers.map((dev) => {
        const active = !excludedSet.has(dev);
        return (
          <button
            key={dev}
            type="button"
            onClick={() => onToggle(dev)}
            aria-pressed={active}
            className={
              active
                ? 'rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 transition hover:border-sky-400 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:border-sky-600'
                : 'rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500 dark:hover:border-slate-600 dark:hover:text-slate-300'
            }
          >
            {dev}
          </button>
        );
      })}
      {excludedDevs.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
        >
          show all
        </button>
      )}
    </div>
  );
}
