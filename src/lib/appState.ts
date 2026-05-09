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

export interface AppState {
  profile: Profile;
  recommend: RecommendState;
}

export type Action =
  | { type: 'SET_RAM'; ramGB: number }
  | { type: 'SET_CONTEXT'; contextLen: number }
  | { type: 'SET_QUANT'; quantId: string }
  | { type: 'SET_KV_CACHE_QUANT'; kvCacheQuantId: string }
  | { type: 'SET_DEVICE'; deviceId: string }
  | { type: 'SET_CUSTOM_BANDWIDTH'; bw: number }
  | { type: 'SET_MIN_TPS'; minTps: number }
  | { type: 'SET_EXCLUDED_DEVS'; devs: string[] };

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
  }
}
