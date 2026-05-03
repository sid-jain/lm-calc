import { BUCKET_FITS_THRESHOLD } from './config';

export type FitStatus = 'fits' | 'tight' | 'over';

export function fitStatus(totalGB: number, ramGB: number): FitStatus {
  if (totalGB <= ramGB * BUCKET_FITS_THRESHOLD) return 'fits';
  if (totalGB <= ramGB) return 'tight';
  return 'over';
}

export const FIT_STYLES: Record<FitStatus, { tone: string; icon: string; label: string }> = {
  fits:  { tone: 'text-emerald-600 dark:text-emerald-400', icon: '✓', label: 'Fits' },
  tight: { tone: 'text-amber-600 dark:text-amber-400',     icon: '⚠', label: 'Tight' },
  over:  { tone: 'text-rose-600 dark:text-rose-400',       icon: '✗', label: "Doesn't fit" },
};
