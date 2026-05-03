import { describe, expect, test } from 'vitest';
import { INITIAL_STATE } from './appState';
import type { AppState } from './appState';
import { deserialize, serialize } from './urlSync';

function roundTrip(state: AppState): AppState {
  const params = serialize(state);
  const partial = deserialize(params);
  return {
    ...INITIAL_STATE,
    ...partial,
    profile: { ...INITIAL_STATE.profile, ...partial.profile },
    recommend: { ...INITIAL_STATE.recommend, ...partial.recommend },
  };
}

describe('urlSync — round-trip', () => {
  test('INITIAL_STATE round-trips correctly', () => {
    const result = roundTrip(INITIAL_STATE);
    expect(result.profile).toEqual(INITIAL_STATE.profile);
    expect(result.recommend.minTps).toBe(INITIAL_STATE.recommend.minTps);
    expect(result.recommend.excludedDevs).toEqual([]);
  });

  test('profile values round-trip', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      profile: {
        ramGB: 64,
        contextLen: 32768,
        quantId: 'q6_k',
        deviceId: 'rtx-4090',
        customBandwidthGBps: 500,
      },
    };
    const result = roundTrip(state);
    expect(result.profile.ramGB).toBe(64);
    expect(result.profile.contextLen).toBe(32768);
    expect(result.profile.quantId).toBe('q6_k');
    expect(result.profile.deviceId).toBe('rtx-4090');
  });

  test('custom device bw only serialized when deviceId=custom', () => {
    const withCustom: AppState = {
      ...INITIAL_STATE,
      profile: { ...INITIAL_STATE.profile, deviceId: 'custom', customBandwidthGBps: 250 },
    };
    expect(serialize(withCustom).get('bw')).toBe('250');

    const withRealDevice: AppState = {
      ...INITIAL_STATE,
      profile: { ...INITIAL_STATE.profile, deviceId: 'rtx-4090', customBandwidthGBps: 250 },
    };
    expect(serialize(withRealDevice).get('bw')).toBeNull();
  });

  test('recommend excludedDevs round-trip', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      recommend: { minTps: 15, excludedDevs: ['Meta', 'Google'] },
    };
    const result = roundTrip(state);
    expect(result.recommend.minTps).toBe(15);
    expect(result.recommend.excludedDevs).toEqual(expect.arrayContaining(['Meta', 'Google']));
    expect(result.recommend.excludedDevs).toHaveLength(2);
  });

  test('empty excludedDevs omits excl param', () => {
    expect(serialize(INITIAL_STATE).get('excl')).toBeNull();
  });

  test('minTps default is omitted from URL', () => {
    expect(serialize(INITIAL_STATE).get('minTps')).toBeNull();
  });

  test('non-default minTps round-trips', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      recommend: { ...INITIAL_STATE.recommend, minTps: 25 },
    };
    expect(roundTrip(state).recommend.minTps).toBe(25);
  });

  test('legacy rexcl param is read as excludedDevs', () => {
    const params = new URLSearchParams('ram=32&rexcl=Mistral+AI');
    const partial = deserialize(params);
    expect(partial.recommend?.excludedDevs).toContain('Mistral AI');
  });

  test('invalid sort key from old browse URL is silently ignored', () => {
    const params = new URLSearchParams('ram=64&sort=speed-desc');
    const partial = deserialize(params);
    // 'sort' is a browse-era param — deserializer ignores unknown keys
    expect(partial.profile?.ramGB).toBe(64);
    expect(partial.recommend).toBeUndefined();
  });
});
