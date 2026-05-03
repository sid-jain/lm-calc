import { useEffect, useReducer, useState } from 'react';
import { Controls } from './components/Controls';
import { Methodology } from './components/Methodology';
import { Recommender } from './components/Recommender';
import { INITIAL_STATE, reducer } from './lib/appState';
import { DEFAULT_QUANT_ID } from './lib/config';
import { DEVICES, CUSTOM_DEVICE_ID } from './lib/devices';
import { models } from './lib/loadModels';
import { AUTO_QUANT, AUTO_QUANT_ID, QUANT_LEVELS } from './lib/quants';
import { deserialize, readUrlParams, writeUrlParams } from './lib/urlSync';
import { useTheme } from './lib/useTheme';

function init(state: typeof INITIAL_STATE) {
  const params = readUrlParams();
  const partial = deserialize(params);
  return {
    ...state,
    ...partial,
    profile: { ...state.profile, ...partial.profile },
    recommend: { ...state.recommend, ...partial.recommend },
  };
}

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE, init);
  const [showMethodology, setShowMethodology] = useState(
    () => typeof window !== 'undefined' && window.location.hash === '#methodology',
  );
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const onPop = () => setShowMethodology(window.location.hash === '#methodology');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const { profile, recommend } = state;

  const isAutoQuant = profile.quantId === AUTO_QUANT_ID;
  const resolvedQuant =
    QUANT_LEVELS.find((q) => q.id === (isAutoQuant ? DEFAULT_QUANT_ID : profile.quantId)) ??
    QUANT_LEVELS[5];
  const device = DEVICES.find((d) => d.id === profile.deviceId) ?? DEVICES[4];
  const bandwidthGBps =
    profile.deviceId === CUSTOM_DEVICE_ID ? profile.customBandwidthGBps : device.bandwidthGBps;

  useEffect(() => {
    const id = requestAnimationFrame(() => writeUrlParams(state));
    return () => cancelAnimationFrame(id);
  }, [state]);

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
            onClick={() => {
              if (showMethodology) {
                history.back();
              } else {
                history.pushState(null, '', '#methodology');
                setShowMethodology(true);
              }
            }}
            className={showMethodology
              ? 'font-medium text-slate-900 dark:text-slate-100'
              : 'hover:text-slate-900 dark:hover:text-slate-100'}
          >
            Methodology
          </button>
          <a
            href="https://github.com"
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
              device={device}
              customBandwidthGBps={profile.customBandwidthGBps}
              minTps={recommend.minTps}
              onRamGB={(v) => dispatch({ type: 'SET_RAM', ramGB: v })}
              onContextLen={(v) => dispatch({ type: 'SET_CONTEXT', contextLen: v })}
              onQuant={(q) => dispatch({ type: 'SET_QUANT', quantId: q.id })}
              onDevice={(d) => {
                dispatch({ type: 'SET_DEVICE', deviceId: d.id });
                if (d.id === CUSTOM_DEVICE_ID) {
                  dispatch({ type: 'SET_CUSTOM_BANDWIDTH', bw: d.bandwidthGBps });
                }
              }}
              onCustomBandwidth={(v) => dispatch({ type: 'SET_CUSTOM_BANDWIDTH', bw: v })}
              onMinTps={(v) => dispatch({ type: 'SET_MIN_TPS', minTps: v })}
            />

            <div className="mt-6">
              <Recommender
                models={models}
                ramGB={profile.ramGB}
                contextLen={profile.contextLen}
                bandwidthGBps={bandwidthGBps}
                lockQuantId={isAutoQuant ? null : profile.quantId}
                minTps={recommend.minTps}
                excludedDevs={recommend.excludedDevs}
                onToggleDev={(dev) => dispatch({ type: 'TOGGLE_RECOMMEND_DEV', dev })}
                onClearDevs={() => dispatch({ type: 'CLEAR_RECOMMEND_DEVS' })}
              />
            </div>
          </main>
        </>
      )}
    </div>
  );
}
