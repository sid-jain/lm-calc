import type { AppState, Profile, RecommendState, Series, View } from './appState';
import { INITIAL_STATE } from './appState';
import { DEVICES } from './devices';
import { KV_CACHE_QUANT_LEVELS, DEFAULT_KV_CACHE_QUANT_ID } from './kvCacheQuants';
import { models } from './loadModels';
import { QUANT_LEVELS } from './quants';

export function serialize(state: AppState): URLSearchParams {
  const p = new URLSearchParams();

  // Calculator-only params — only meaningful on the calculator view, so emit
  // them only when that's what the user is looking at. On Charts /
  // Methodology, dropping them keeps the URL focused on what's actually on
  // screen (and shareable links land cleaner). Trade-off: a hard refresh on
  // Charts loses the calculator profile back to defaults; that's acceptable
  // since the user is on a view that doesn't show those values anyway.
  if (state.view === 'calculator') {
    // Profile — always written so calculator bookmarks are self-contained and
    // survive default changes.
    const selectedDevice = DEVICES.find((d) => d.id === state.profile.deviceId);
    const deviceHasFixedMemory = selectedDevice?.memoryGB !== undefined;
    if (!deviceHasFixedMemory) p.set('ram', String(state.profile.ramGB));
    p.set('ctx', String(state.profile.contextLen));
    p.set('quant', state.profile.quantId);
    if (state.profile.kvCacheQuantId !== DEFAULT_KV_CACHE_QUANT_ID) {
      p.set('kvq', state.profile.kvCacheQuantId);
    }
    p.set('device', state.profile.deviceId);
    if (state.profile.deviceId === 'custom') {
      p.set('bw', String(state.profile.customBandwidthGBps));
    }

    // Recommend state — omit defaults to keep URLs clean.
    if (state.recommend.minTps !== INITIAL_STATE.recommend.minTps) {
      p.set('minTps', String(state.recommend.minTps));
    }
    if (state.recommend.excludedDevs.length > 0) {
      p.set('excl', [...state.recommend.excludedDevs].sort().join(','));
    }
  }

  // Charts series — only emitted on the Charts view. The three views
  // (calculator / charts / methodology) own disjoint URL surfaces; toggling
  // away should produce a URL that's exclusively about the destination,
  // matching what a user who lands on that URL would expect to see. The
  // series list still lives in reducer state across in-session navigation,
  // so toggling Charts→Calc→Charts inside one tab preserves it; only
  // browser reload on a non-Charts URL drops the comparison.
  if (state.view === 'charts' && state.series.length > 0) {
    p.set(
      'charts',
      state.series
        .map((s) => `${s.modelId}:${s.gpuId}:${s.weightQuantId}:${s.kvQuantId}`)
        .join(','),
    );
  }

  // View — calculator is the default, so we omit it; the others
  // (methodology / charts) appear so a fresh visit to the URL lands on the
  // right surface.
  if (state.view !== 'calculator') p.set('view', state.view);

  return p;
}

export function deserialize(params: URLSearchParams): Partial<AppState> {
  const result: Partial<AppState> = {};

  const profile: Partial<Profile> = {};
  const ram = Number(params.get('ram'));
  if (Number.isFinite(ram) && ram > 0) profile.ramGB = ram;
  const ctx = Number(params.get('ctx'));
  if (Number.isFinite(ctx) && ctx > 0) profile.contextLen = ctx;
  const quant = params.get('quant');
  if (quant) profile.quantId = quant;
  const kvq = params.get('kvq');
  if (kvq) profile.kvCacheQuantId = kvq;
  const device = params.get('device');
  if (device) profile.deviceId = device;
  const bw = Number(params.get('bw'));
  if (Number.isFinite(bw) && bw > 0) profile.customBandwidthGBps = bw;
  if (Object.keys(profile).length > 0) {
    result.profile = { ...INITIAL_STATE.profile, ...profile };
  }

  const recommend: Partial<RecommendState> = {};
  const rawMinTps = params.get('minTps');
  if (rawMinTps !== null) {
    const minTps = Number(rawMinTps);
    if (Number.isFinite(minTps) && minTps >= 0) recommend.minTps = minTps;
  }
  // Accept both 'excl' (current) and 'rexcl' (legacy from old recommend-mode param)
  const excl = params.get('excl') ?? params.get('rexcl');
  if (excl) recommend.excludedDevs = excl.split(',').filter(Boolean);
  if (Object.keys(recommend).length > 0) {
    result.recommend = { ...INITIAL_STATE.recommend, ...recommend };
  }

  const charts = params.get('charts');
  if (charts) {
    const series: Series[] = [];
    for (const tup of charts.split(',')) {
      const parts = tup.split(':');
      if (parts.length !== 4) continue;
      const [modelId, gpuId, weightQuantId, kvQuantId] = parts;
      // Validate against the known id sets so a stale shared link with a
      // since-renamed model just drops that series instead of breaking the page.
      if (!models.find((m) => m.id === modelId)) continue;
      if (!DEVICES.find((d) => d.id === gpuId)) continue;
      if (!QUANT_LEVELS.find((q) => q.id === weightQuantId)) continue;
      if (!KV_CACHE_QUANT_LEVELS.find((q) => q.id === kvQuantId)) continue;
      series.push({ modelId, gpuId, weightQuantId, kvQuantId });
    }
    if (series.length > 0) result.series = series;
  }

  const rawView = params.get('view');
  if (rawView === 'methodology' || rawView === 'charts' || rawView === 'calculator') {
    result.view = rawView as View;
  }

  return result;
}

export function readUrlParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function writeUrlParams(
  state: AppState,
  opts: { historyMethod?: 'replace' | 'push' } = {},
): void {
  if (typeof window === 'undefined') return;
  const params = serialize(state);
  const search = params.toString();
  const desired = search ? `?${search}` : '';
  if (window.location.search === desired) return;
  const newUrl = `${window.location.pathname}${desired}${window.location.hash}`;
  // 'push' creates a history entry so the browser back button can return to
  // the previous URL — used when navigating between views. 'replace' (the
  // default) is right for noisy continuous changes like slider drags.
  if (opts.historyMethod === 'push') window.history.pushState(null, '', newUrl);
  else window.history.replaceState(null, '', newUrl);
}
