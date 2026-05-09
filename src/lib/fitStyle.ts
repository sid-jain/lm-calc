import { BUCKET_FITS_THRESHOLD } from './config';

export type FitStatus = 'fits' | 'tight' | 'over';

export function fitStatus(totalGB: number, ramGB: number): FitStatus {
  if (totalGB <= ramGB * BUCKET_FITS_THRESHOLD) return 'fits';
  if (totalGB <= ramGB) return 'tight';
  return 'over';
}

const FITS_PCT = Math.round(BUCKET_FITS_THRESHOLD * 100);

export const FIT_STYLES: Record<
  FitStatus,
  { tone: string; icon: string; label: string; description: string }
> = {
  fits: {
    tone: 'text-emerald-600 dark:text-emerald-400',
    icon: '✓',
    label: 'Fits',
    description: `Fits comfortably — total is at or below ${FITS_PCT}% of your RAM budget.`,
  },
  tight: {
    tone: 'text-amber-600 dark:text-amber-400',
    // Trailing U+FE0E forces text-presentation; without it most platforms
    // render U+26A0 as a color emoji that's noticeably larger than the
    // monochrome check / cross glyphs.
    icon: '⚠︎',
    label: 'Tight',
    description: `Tight fit — total uses more than ${FITS_PCT}% of your RAM budget. Real-world overhead may push it over.`,
  },
  over: {
    tone: 'text-rose-600 dark:text-rose-400',
    icon: '✗',
    label: "Doesn't fit",
    description: "Doesn't fit — total exceeds your RAM budget at this quant.",
  },
};
