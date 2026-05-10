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
    series: partial.series ?? INITIAL_STATE.series,
    view: partial.view ?? INITIAL_STATE.view,
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
        kvCacheQuantId: 'q8_0',
        deviceId: 'ddr5-dual',
        customBandwidthGBps: 500,
      },
    };
    const result = roundTrip(state);
    expect(result.profile.ramGB).toBe(64);
    expect(result.profile.contextLen).toBe(32768);
    expect(result.profile.quantId).toBe('q6_k');
    expect(result.profile.kvCacheQuantId).toBe('q8_0');
    expect(result.profile.deviceId).toBe('ddr5-dual');
  });

  test('default (auto) kvCacheQuantId is omitted from URL', () => {
    expect(serialize(INITIAL_STATE).get('kvq')).toBeNull();
  });

  test('non-default kvCacheQuantId round-trips via kvq param', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      profile: { ...INITIAL_STATE.profile, kvCacheQuantId: 'q4_0' },
    };
    expect(serialize(state).get('kvq')).toBe('q4_0');
    expect(roundTrip(state).profile.kvCacheQuantId).toBe('q4_0');
  });

  test('explicit fp16 (now non-default) is preserved in URL', () => {
    // Now that auto is the default, an explicit FP16 selection must serialize.
    const state: AppState = {
      ...INITIAL_STATE,
      profile: { ...INITIAL_STATE.profile, kvCacheQuantId: 'fp16' },
    };
    expect(serialize(state).get('kvq')).toBe('fp16');
    expect(roundTrip(state).profile.kvCacheQuantId).toBe('fp16');
  });

  test('ram param is omitted when device has fixed memory', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      profile: { ...INITIAL_STATE.profile, deviceId: 'rtx-4090', ramGB: 64 },
    };
    expect(serialize(state).get('ram')).toBeNull();
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

  test('empty series omits charts param', () => {
    expect(serialize(INITIAL_STATE).get('charts')).toBeNull();
  });

  test('series list round-trips via charts param (when view=charts)', () => {
    const state: AppState = {
      ...INITIAL_STATE,
      view: 'charts',
      series: [
        {
          modelId: 'llama-3-1-8b',
          gpuId: 'rtx-3060-12gb',
          weightQuantId: 'q4_k_m',
          kvQuantId: 'fp16',
        },
        {
          modelId: 'llama-3-1-8b',
          gpuId: 'rtx-4070',
          weightQuantId: 'q4_k_m',
          kvQuantId: 'q4_0',
        },
      ],
    };
    const params = serialize(state);
    expect(params.get('charts')).toBe(
      'llama-3-1-8b:rtx-3060-12gb:q4_k_m:fp16,llama-3-1-8b:rtx-4070:q4_k_m:q4_0',
    );
    expect(roundTrip(state).series).toEqual(state.series);
  });

  test('charts param drops tuples that reference unknown ids', () => {
    // Stale-link guard — a since-renamed model shouldn't break the page.
    const params = new URLSearchParams(
      'charts=llama-3-1-8b:rtx-3060-12gb:q4_k_m:fp16,phantom-model:rtx-3060-12gb:q4_k_m:fp16',
    );
    const partial = deserialize(params);
    expect(partial.series).toHaveLength(1);
    expect(partial.series?.[0].modelId).toBe('llama-3-1-8b');
  });

  test('malformed charts tuples are silently dropped', () => {
    const params = new URLSearchParams('charts=broken,llama-3-1-8b:rtx-3060-12gb:q4_k_m:fp16');
    const partial = deserialize(params);
    expect(partial.series).toHaveLength(1);
  });

  test('default view (calculator) is omitted from URL', () => {
    expect(serialize(INITIAL_STATE).get('view')).toBeNull();
  });

  test('non-default view round-trips via view param', () => {
    const onCharts: AppState = { ...INITIAL_STATE, view: 'charts' };
    expect(serialize(onCharts).get('view')).toBe('charts');
    expect(roundTrip(onCharts).view).toBe('charts');

    const onMethodology: AppState = { ...INITIAL_STATE, view: 'methodology' };
    expect(serialize(onMethodology).get('view')).toBe('methodology');
    expect(roundTrip(onMethodology).view).toBe('methodology');
  });

  test('on Charts view, calculator-only params are dropped from the URL', () => {
    const onCharts: AppState = {
      ...INITIAL_STATE,
      view: 'charts',
      profile: {
        ...INITIAL_STATE.profile,
        ramGB: 64,
        contextLen: 32768,
        quantId: 'q4_k_m',
        deviceId: 'rtx-4070',
        kvCacheQuantId: 'q4_0',
      },
      recommend: { minTps: 30, excludedDevs: ['Meta'] },
    };
    const params = serialize(onCharts);
    // None of the calculator-state params should leak onto the Charts URL.
    expect(params.get('ram')).toBeNull();
    expect(params.get('ctx')).toBeNull();
    expect(params.get('quant')).toBeNull();
    expect(params.get('device')).toBeNull();
    expect(params.get('kvq')).toBeNull();
    expect(params.get('minTps')).toBeNull();
    expect(params.get('excl')).toBeNull();
    // But the view itself, and the series list (if any), still appear.
    expect(params.get('view')).toBe('charts');
  });

  test('on Calculator view, calculator params are written as before', () => {
    const onCalc: AppState = {
      ...INITIAL_STATE,
      view: 'calculator',
      profile: { ...INITIAL_STATE.profile, ramGB: 64, contextLen: 32768 },
    };
    const params = serialize(onCalc);
    expect(params.get('ctx')).toBe('32768');
    expect(params.get('view')).toBeNull();
  });

  test('unknown view value is ignored', () => {
    const params = new URLSearchParams('view=garbage');
    expect(deserialize(params).view).toBeUndefined();
  });

  test('on Calculator, the charts series does NOT leak onto the URL', () => {
    // Each view owns a disjoint URL surface — toggling Charts→Calculator
    // produces a URL that's purely about the calculator.
    const onCalc: AppState = {
      ...INITIAL_STATE,
      view: 'calculator',
      series: [
        {
          modelId: 'llama-3-1-8b',
          gpuId: 'rtx-3060-12gb',
          weightQuantId: 'q4_k_m',
          kvQuantId: 'fp16',
        },
      ],
    };
    expect(serialize(onCalc).get('charts')).toBeNull();
  });

  test('on Methodology, neither calculator nor charts params leak', () => {
    const onMeth: AppState = {
      ...INITIAL_STATE,
      view: 'methodology',
      profile: { ...INITIAL_STATE.profile, ramGB: 64 },
      series: [
        {
          modelId: 'llama-3-1-8b',
          gpuId: 'rtx-3060-12gb',
          weightQuantId: 'q4_k_m',
          kvQuantId: 'fp16',
        },
      ],
    };
    const params = serialize(onMeth);
    expect(params.get('charts')).toBeNull();
    expect(params.get('ram')).toBeNull();
    expect(params.get('ctx')).toBeNull();
    expect(params.get('view')).toBe('methodology');
  });
});
