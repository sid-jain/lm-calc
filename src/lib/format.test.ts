import { describe, expect, test } from 'vitest';
import { fmtBytes, fmtGB, fmtTpsRange } from './format';

describe('fmtGB', () => {
  test('uses two decimals below 10', () => {
    expect(fmtGB(0.5)).toBe('0.50');
    expect(fmtGB(2.456)).toBe('2.46');
    expect(fmtGB(9.99)).toBe('9.99');
  });

  test('uses one decimal between 10 and 100', () => {
    expect(fmtGB(10)).toBe('10.0');
    expect(fmtGB(42.789)).toBe('42.8');
  });

  test('uses no decimals at 100 or above', () => {
    expect(fmtGB(100)).toBe('100');
    expect(fmtGB(362.5)).toBe('363');
  });
});

describe('fmtTpsRange', () => {
  test('renders normal ranges', () => {
    expect(fmtTpsRange(42, 71)).toBe('42 - 71 tok/s');
  });

  test('clamps very-low low end to "<1"', () => {
    expect(fmtTpsRange(0.4, 5)).toBe('<1 - 5 tok/s');
  });

  test('returns "<1 tok/s" when both ends are sub-unit', () => {
    expect(fmtTpsRange(0.2, 0.5)).toBe('<1 tok/s');
  });

  test('rounds to integers', () => {
    expect(fmtTpsRange(41.4, 68.9)).toBe('41 - 69 tok/s');
  });
});

describe('fmtBytes', () => {
  test('GB scale', () => {
    expect(fmtBytes(2_500_000_000)).toBe('2.50 GB');
  });

  test('MB scale', () => {
    expect(fmtBytes(2_500_000)).toBe('2.5 MB');
  });

  test('KB scale', () => {
    expect(fmtBytes(2500)).toBe('2.5 KB');
  });

  test('raw bytes below 1000', () => {
    expect(fmtBytes(512)).toBe('512 B');
  });
});
