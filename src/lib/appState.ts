import { DEFAULT_BW, DEFAULT_CTX, DEFAULT_DEVICE_ID, DEFAULT_MIN_TPS, DEFAULT_RAM } from './config';
import { DEFAULT_KV_CACHE_QUANT_ID } from './kvCacheQuants';
import { AUTO_QUANT_ID } from './quants';

export interface Profile {
  ramGB: number;
  contextLen: number;
  quantId: string;
  kvCacheQuantId: string;
  deviceId: string;
  customBandwidthGBps: number;
}

export interface RecommendState {
  minTps: number;
  excludedDevs: string[];
}

// One line on the Charts view. Color is index-derived (not stored), so the
// tuple `(modelId, gpuId, weightQuantId, kvQuantId)` is the entire identity
// — also serves as the dedup key in ADD_SERIES.
export interface Series {
  modelId: string;
  gpuId: string;
  weightQuantId: string;
  kvQuantId: string;
}

export type View = 'calculator' | 'methodology' | 'charts';

export interface AppState {
  profile: Profile;
  recommend: RecommendState;
  series: Series[];
  view: View;
}

export type Action =
  | { type: 'SET_RAM'; ramGB: number }
  | { type: 'SET_CONTEXT'; contextLen: number }
  | { type: 'SET_QUANT'; quantId: string }
  | { type: 'SET_KV_CACHE_QUANT'; kvCacheQuantId: string }
  | { type: 'SET_DEVICE'; deviceId: string }
  | { type: 'SET_CUSTOM_BANDWIDTH'; bw: number }
  | { type: 'SET_MIN_TPS'; minTps: number }
  | { type: 'SET_EXCLUDED_DEVS'; devs: string[] }
  | { type: 'ADD_SERIES'; series: Series }
  | { type: 'REMOVE_SERIES'; index: number }
  | { type: 'CLEAR_SERIES' }
  | { type: 'SET_VIEW'; view: View }
  // Used by the popstate handler to re-hydrate after the user hits browser
  // back/forward. Performs a deep merge on top of INITIAL_STATE so the state
  // ends up exactly mirroring whatever's in the URL right now.
  | { type: 'HYDRATE'; partial: Partial<AppState> };

export function seriesKey(s: Series): string {
  return `${s.modelId}|${s.gpuId}|${s.weightQuantId}|${s.kvQuantId}`;
}

export const INITIAL_STATE: AppState = {
  profile: {
    ramGB: DEFAULT_RAM,
    contextLen: DEFAULT_CTX,
    quantId: AUTO_QUANT_ID,
    kvCacheQuantId: DEFAULT_KV_CACHE_QUANT_ID,
    deviceId: DEFAULT_DEVICE_ID,
    customBandwidthGBps: DEFAULT_BW,
  },
  recommend: {
    minTps: DEFAULT_MIN_TPS,
    excludedDevs: [],
  },
  series: [],
  view: 'calculator',
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_RAM':
      return { ...state, profile: { ...state.profile, ramGB: action.ramGB } };
    case 'SET_CONTEXT':
      return { ...state, profile: { ...state.profile, contextLen: action.contextLen } };
    case 'SET_QUANT':
      return { ...state, profile: { ...state.profile, quantId: action.quantId } };
    case 'SET_KV_CACHE_QUANT':
      return {
        ...state,
        profile: { ...state.profile, kvCacheQuantId: action.kvCacheQuantId },
      };
    case 'SET_DEVICE':
      return { ...state, profile: { ...state.profile, deviceId: action.deviceId } };
    case 'SET_CUSTOM_BANDWIDTH':
      return { ...state, profile: { ...state.profile, customBandwidthGBps: action.bw } };
    case 'SET_MIN_TPS':
      return { ...state, recommend: { ...state.recommend, minTps: action.minTps } };
    case 'SET_EXCLUDED_DEVS':
      return { ...state, recommend: { ...state.recommend, excludedDevs: action.devs } };
    case 'ADD_SERIES': {
      const key = seriesKey(action.series);
      // Dedup by tuple — adding the same combo twice is a no-op (and would
      // render two identical lines on top of each other anyway).
      if (state.series.some((s) => seriesKey(s) === key)) return state;
      return { ...state, series: [...state.series, action.series] };
    }
    case 'REMOVE_SERIES':
      return { ...state, series: state.series.filter((_, i) => i !== action.index) };
    case 'CLEAR_SERIES':
      return { ...state, series: [] };
    case 'SET_VIEW':
      return { ...state, view: action.view };
    case 'HYDRATE':
      return {
        ...INITIAL_STATE,
        ...action.partial,
        profile: { ...INITIAL_STATE.profile, ...action.partial.profile },
        recommend: { ...INITIAL_STATE.recommend, ...action.partial.recommend },
        series: action.partial.series ?? INITIAL_STATE.series,
        view: action.partial.view ?? INITIAL_STATE.view,
      };
  }
}
