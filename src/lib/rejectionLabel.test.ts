import { describe, expect, test } from 'vitest';
import { rejectionLabel } from './rejectionLabel';

describe('rejectionLabel', () => {
  test('no_quant_fits_ram shows the minimum required RAM', () => {
    expect(rejectionLabel({ type: 'no_quant_fits_ram', minRamGB: 16.42 })).toBe('Needs ≥16.4 GB');
  });

  test('too_slow rounds tps to integer when ≥ 1', () => {
    expect(rejectionLabel({ type: 'too_slow', maxLowTps: 11.6 })).toBe('Max 12 tok/s');
  });

  test('too_slow shows "<1" when sub-unit', () => {
    expect(rejectionLabel({ type: 'too_slow', maxLowTps: 0.4 })).toBe('Max <1 tok/s');
  });

  test('context_too_short uses formatted context', () => {
    expect(rejectionLabel({ type: 'context_too_short', maxContext: 4096 })).toBe('Max 4K ctx');
  });

  test('excluded_dev returns the static label', () => {
    expect(rejectionLabel({ type: 'excluded_dev' })).toBe('Dev excluded');
  });
});
