import { describe, expect, test } from 'vitest';
import { INITIAL_STATE, reducer } from './appState';

describe('appState reducer — developer filter', () => {
  test('SET_EXCLUDED_DEVS replaces the excluded list', () => {
    const next = reducer(INITIAL_STATE, {
      type: 'SET_EXCLUDED_DEVS',
      devs: ['Google', 'Mistral AI', 'Alibaba'],
    });
    expect(next.recommend.excludedDevs).toEqual(['Google', 'Mistral AI', 'Alibaba']);
  });

  test('SET_EXCLUDED_DEVS overwrites prior selection', () => {
    const seeded = reducer(INITIAL_STATE, { type: 'SET_EXCLUDED_DEVS', devs: ['Meta'] });
    const next = reducer(seeded, { type: 'SET_EXCLUDED_DEVS', devs: ['Google'] });
    expect(next.recommend.excludedDevs).toEqual(['Google']);
  });

  test('SET_EXCLUDED_DEVS with empty array clears the filter', () => {
    const seeded = reducer(INITIAL_STATE, {
      type: 'SET_EXCLUDED_DEVS',
      devs: ['A', 'B', 'C'],
    });
    const next = reducer(seeded, { type: 'SET_EXCLUDED_DEVS', devs: [] });
    expect(next.recommend.excludedDevs).toEqual([]);
  });
});
