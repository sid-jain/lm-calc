export type SpeedTier = 'fast' | 'usable' | 'slow';

export const SPEED_TIER_FAST_MIN = 20;
export const SPEED_TIER_USABLE_MIN = 5;

export function speedTier(tps: number): SpeedTier {
  if (tps >= SPEED_TIER_FAST_MIN) return 'fast';
  if (tps >= SPEED_TIER_USABLE_MIN) return 'usable';
  return 'slow';
}

export const SPEED_STYLES: Record<
  SpeedTier,
  { tone: string; icon: string; label: string; threshold: string }
> = {
  fast: {
    tone: 'text-emerald-600 dark:text-emerald-400',
    icon: '●●●',
    label: 'Fast',
    threshold: `≥${SPEED_TIER_FAST_MIN} tok/s`,
  },
  usable: {
    tone: 'text-amber-600 dark:text-amber-400',
    icon: '●●○',
    label: 'Usable',
    threshold: `${SPEED_TIER_USABLE_MIN}–${SPEED_TIER_FAST_MIN} tok/s`,
  },
  slow: {
    tone: 'text-rose-600 dark:text-rose-400',
    icon: '●○○',
    label: 'Slow',
    threshold: `<${SPEED_TIER_USABLE_MIN} tok/s`,
  },
};
