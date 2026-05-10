import { useEffect, useReducer, useRef } from 'react';
import { ChartsView } from './components/charts/ChartsView';
import { Controls } from './components/Controls';
import { Methodology } from './components/Methodology';
import { Recommender } from './components/Recommender';
import { INITIAL_STATE, reducer } from './lib/appState';
import { DEFAULT_DEVICE_ID, DEFAULT_QUANT_ID } from './lib/config';
import { DEVICES, CUSTOM_DEVICE_ID } from './lib/devices';
import {
  AUTO_KV_QUANT,
  DEFAULT_KV_CACHE_QUANT,
  isAutoKvQuantId,
  resolveKvCacheQuant,
} from './lib/kvCacheQuants';
import { models } from './lib/loadModels';
import { AUTO_QUANT, QUANT_LEVELS, isAutoQuantId } from './lib/quants';
import { deserialize, readUrlParams, writeUrlParams } from './lib/urlSync';
import { useTheme } from './lib/useTheme';

function init(state: typeof INITIAL_STATE) {
  const params = readUrlParams();
  const partial = deserialize(params);
  // One-time migration: a pre-#view bookmark with #methodology or #charts in
  // the URL hash still lands on the right view. Once the user navigates,
  // urlSync writes ?view=… and the hash drops off naturally.
  if (!partial.view && typeof window !== 'undefined') {
    if (window.location.hash === '#methodology') partial.view = 'methodology';
    else if (window.location.hash === '#charts') partial.view = 'charts';
  }
  return {
    ...state,
    ...partial,
    profile: { ...state.profile, ...partial.profile },
    recommend: { ...state.recommend, ...partial.recommend },
  };
}

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE, init);
  const showMethodology = state.view === 'methodology';
  const showCharts = state.view === 'charts';
  const { theme, toggle } = useTheme();

  const { profile, recommend } = state;

  const isAutoQuant = isAutoQuantId(profile.quantId);
  const resolvedQuant =
    QUANT_LEVELS.find((q) => q.id === (isAutoQuant ? DEFAULT_QUANT_ID : profile.quantId)) ??
    QUANT_LEVELS[5];
  const resolvedKvQuant = isAutoKvQuantId(profile.kvCacheQuantId)
    ? AUTO_KV_QUANT
    : resolveKvCacheQuant(profile.kvCacheQuantId);
  const device =
    profile.deviceId === CUSTOM_DEVICE_ID
      ? {
          id: CUSTOM_DEVICE_ID,
          name: 'Custom',
          category: 'custom' as const,
          bandwidthGBps: profile.customBandwidthGBps,
        }
      : (DEVICES.find((d) => d.id === profile.deviceId) ??
        DEVICES.find((d) => d.id === DEFAULT_DEVICE_ID)!);
  const bandwidthGBps = device.bandwidthGBps;
  const effectiveRamGB = device.memoryGB ?? profile.ramGB;

  // Track the last-written view so the URL writer can choose pushState (when
  // the view changes — adds a history entry, browser back works) vs.
  // replaceState (continuous edits like slider drags, which would otherwise
  // pollute history with thousands of entries).
  const lastViewRef = useRef(state.view);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const viewChanged = lastViewRef.current !== state.view;
      writeUrlParams(state, { historyMethod: viewChanged ? 'push' : 'replace' });
      lastViewRef.current = state.view;
    });
    return () => cancelAnimationFrame(id);
  }, [state]);

  // Browser back/forward: re-hydrate state from the URL whenever the user
  // navigates through the history stack. The HYDRATE action does a deep
  // merge against INITIAL_STATE, so anything not in the URL falls back to
  // defaults — matches first-load behavior.
  useEffect(() => {
    const onPop = () => {
      const partial = deserialize(readUrlParams());
      dispatch({ type: 'HYDRATE', partial });
      lastViewRef.current = partial.view ?? 'calculator';
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-bold tracking-tight">LM Calc</h1>
          <span
            title="Pre-release — math, model list, and UI may all change"
            className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300"
          >
            v{__APP_VERSION__}
          </span>
        </div>
        <nav className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
          <button
            type="button"
            onClick={() =>
              dispatch({ type: 'SET_VIEW', view: showCharts ? 'calculator' : 'charts' })
            }
            className={
              showCharts
                ? 'font-medium text-slate-900 dark:text-slate-100'
                : 'hover:text-slate-900 dark:hover:text-slate-100'
            }
          >
            Charts
          </button>
          <button
            type="button"
            onClick={() =>
              dispatch({ type: 'SET_VIEW', view: showMethodology ? 'calculator' : 'methodology' })
            }
            className={
              showMethodology
                ? 'font-medium text-slate-900 dark:text-slate-100'
                : 'hover:text-slate-900 dark:hover:text-slate-100'
            }
          >
            Methodology
          </button>
          <a
            href="https://github.com/sid-jain/lm-calc"
            target="_blank"
            rel="noreferrer"
            className="hover:text-slate-900 dark:hover:text-slate-100"
          >
            GitHub
          </a>
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 text-base text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
        </nav>
      </header>

      {showMethodology ? (
        <Methodology />
      ) : showCharts ? (
        <ChartsView
          series={state.series}
          defaultSeries={{
            modelId: models[0]?.id ?? '',
            gpuId:
              device.id === CUSTOM_DEVICE_ID
                ? (DEVICES.find((d) => d.category === 'nvidia')?.id ?? DEFAULT_DEVICE_ID)
                : device.id,
            weightQuantId: resolvedQuant.id,
            kvQuantId: isAutoKvQuantId(profile.kvCacheQuantId)
              ? DEFAULT_KV_CACHE_QUANT.id
              : profile.kvCacheQuantId,
          }}
          onAdd={(s) => dispatch({ type: 'ADD_SERIES', series: s })}
          onRemove={(i) => dispatch({ type: 'REMOVE_SERIES', index: i })}
          onClear={() => dispatch({ type: 'CLEAR_SERIES' })}
        />
      ) : (
        <>
          <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
            Set your hardware constraints and get a ranked list of open-weight LLMs — each shown at
            the highest-quality quant that fits your RAM and meets your speed floor. Models that
            don't fit are listed below with the reason.
          </p>

          <main>
            <Controls
              ramGB={profile.ramGB}
              contextLen={profile.contextLen}
              quant={isAutoQuant ? AUTO_QUANT : resolvedQuant}
              kvQuant={resolvedKvQuant}
              device={device}
              customBandwidthGBps={profile.customBandwidthGBps}
              minTps={recommend.minTps}
              onRamGB={(v) => dispatch({ type: 'SET_RAM', ramGB: v })}
              onContextLen={(v) => dispatch({ type: 'SET_CONTEXT', contextLen: v })}
              onQuant={(q) => dispatch({ type: 'SET_QUANT', quantId: q.id })}
              onKvQuant={(q) => dispatch({ type: 'SET_KV_CACHE_QUANT', kvCacheQuantId: q.id })}
              onDevice={(d) => {
                dispatch({ type: 'SET_DEVICE', deviceId: d.id });
                if (d.id === CUSTOM_DEVICE_ID) {
                  dispatch({ type: 'SET_CUSTOM_BANDWIDTH', bw: d.bandwidthGBps });
                }
              }}
              onCustomBandwidth={(v) => dispatch({ type: 'SET_CUSTOM_BANDWIDTH', bw: v })}
              onMinTps={(v) => dispatch({ type: 'SET_MIN_TPS', minTps: v })}
            />

            <section className="mt-6">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Models
              </h3>
              <Recommender
                models={models}
                ramGB={effectiveRamGB}
                contextLen={profile.contextLen}
                bandwidthGBps={bandwidthGBps}
                lockQuantId={isAutoQuant ? null : profile.quantId}
                kvCacheQuantId={profile.kvCacheQuantId}
                minTps={recommend.minTps}
                excludedDevs={recommend.excludedDevs}
                onSetExcludedDevs={(devs) => dispatch({ type: 'SET_EXCLUDED_DEVS', devs })}
              />
            </section>
          </main>
        </>
      )}
    </div>
  );
}
