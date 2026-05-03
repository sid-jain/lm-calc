import type { AppState, Profile, RecommendState } from './appState';
import { INITIAL_STATE } from './appState';

export function serialize(state: AppState): URLSearchParams {
  const p = new URLSearchParams();

  // Profile — always written so bookmarks are self-contained and survive default changes
  p.set('ram', String(state.profile.ramGB));
  p.set('ctx', String(state.profile.contextLen));
  p.set('quant', state.profile.quantId);
  p.set('device', state.profile.deviceId);
  if (state.profile.deviceId === 'custom') p.set('bw', String(state.profile.customBandwidthGBps));

  // Recommend state — omit defaults to keep URLs clean
  if (state.recommend.minTps !== INITIAL_STATE.recommend.minTps) {
    p.set('minTps', String(state.recommend.minTps));
  }
  if (state.recommend.excludedDevs.length > 0) {
    p.set('excl', [...state.recommend.excludedDevs].sort().join(','));
  }

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

  return result;
}

export function readUrlParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function writeUrlParams(state: AppState): void {
  if (typeof window === 'undefined') return;
  const params = serialize(state);
  const search = params.toString();
  const desired = search ? `?${search}` : '';
  if (window.location.search === desired) return;
  const newUrl = `${window.location.pathname}${desired}${window.location.hash}`;
  window.history.replaceState(null, '', newUrl);
}
