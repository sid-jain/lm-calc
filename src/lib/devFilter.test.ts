import { describe, expect, test } from 'vitest';
import { nextExcludedOnPillClick } from './devFilter';

describe('nextExcludedOnPillClick', () => {
  const ALL = ['Alibaba', 'DeepSeek', 'Google', 'Meta'];

  test('clicking from default state solos the developer', () => {
    expect(nextExcludedOnPillClick('Meta', ALL, [])).toEqual(['Alibaba', 'DeepSeek', 'Google']);
  });

  test('clicking the only-included dev restores all', () => {
    // soloed on Meta -> click Meta -> back to all-included
    expect(nextExcludedOnPillClick('Meta', ALL, ['Alibaba', 'DeepSeek', 'Google'])).toEqual([]);
  });

  test('clicking an excluded dev includes it (multi-select)', () => {
    // soloed on Meta -> click Google -> Meta + Google included
    expect(nextExcludedOnPillClick('Google', ALL, ['Alibaba', 'DeepSeek', 'Google'])).toEqual([
      'Alibaba',
      'DeepSeek',
    ]);
  });

  test('clicking an included dev (when others are excluded too) excludes it', () => {
    // Meta + Google included -> click Meta -> Google soloed
    expect(nextExcludedOnPillClick('Meta', ALL, ['Alibaba', 'DeepSeek'])).toEqual([
      'Alibaba',
      'DeepSeek',
      'Meta',
    ]);
  });
});
