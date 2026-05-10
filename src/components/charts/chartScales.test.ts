import { describe, expect, test } from 'vitest';
import { groupMemorySamplesByCtx, mibToGB } from './chartScales';

describe('mibToGB', () => {
  test('converts MiB (binary) to decimal GB', () => {
    // 1 GiB = 1024 MiB = 2^30 bytes ≈ 1.0737 decimal GB
    expect(mibToGB(1024)).toBeCloseTo(1.0737, 4);
    // 18450 MiB (a peak from the qwen3-6-27b 3090-Ti fixture) ≈ 19.346 GB
    expect(mibToGB(18450)).toBeCloseTo(19.346, 3);
  });
});

describe('groupMemorySamplesByCtx', () => {
  test('collapses one row per (ctx) and ignores depth duplication', () => {
    // bench.sh emits one CSV row per (ctx, depth) but peak_vram_mib is
    // sampled once per config — so multiple depths at the same ctx all
    // carry the same peak. Plot one marker per ctx, not per row.
    const groups = groupMemorySamplesByCtx([
      { ctx: 8192, depth: 512, peak_vram_mib: 6244 },
      { ctx: 8192, depth: 4096, peak_vram_mib: 6244 },
      { ctx: 8192, depth: 8064, peak_vram_mib: 6244 },
      { ctx: 32768, depth: 512, peak_vram_mib: 9692 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ ctx: 8192, peakMib: 6244, hasOom: false });
    expect(groups[1]).toMatchObject({ ctx: 32768, peakMib: 9692, hasOom: false });
  });

  test('OOM rows mark the group but do NOT contribute their peak', () => {
    // Real failure mode from bench.sh: the synthetic max-depth probe OOMs,
    // and peak_vram_mib reflects the partial allocation before the crash —
    // it's NOT a real "this fits at X" measurement. The chart wants the OK
    // peak from the same config (which was a clean run at lower depth) and
    // an explicit OOM marker; not the partial peak.
    const groups = groupMemorySamplesByCtx([
      { ctx: 65536, depth: 512, peak_vram_mib: 8000 },
      { ctx: 65536, depth: 65408, peak_vram_mib: 10200, status: 'oom' },
    ]);
    expect(groups).toHaveLength(1);
    // peakMib reflects only the OK row (8000), NOT the OOM row's 10200.
    expect(groups[0]).toMatchObject({
      ctx: 65536,
      peakMib: 8000,
      hasOom: true,
      oomDepth: 65408,
    });
  });

  test('an all-OOM group has hasOom=true and peakMib=0', () => {
    // No OK row to anchor a peak; the chart will plot the × at the GPU
    // ceiling, ignoring peakMib.
    const groups = groupMemorySamplesByCtx([
      { ctx: 131072, depth: 130944, peak_vram_mib: 5349, status: 'oom' },
    ]);
    expect(groups).toEqual([{ ctx: 131072, peakMib: 0, hasOom: true, oomDepth: 130944 }]);
  });

  test('groups are sorted by ctx ascending', () => {
    const groups = groupMemorySamplesByCtx([
      { ctx: 65536, depth: 0, peak_vram_mib: 100 },
      { ctx: 8192, depth: 0, peak_vram_mib: 200 },
      { ctx: 32768, depth: 0, peak_vram_mib: 300 },
    ]);
    expect(groups.map((g) => g.ctx)).toEqual([8192, 32768, 65536]);
  });
});
