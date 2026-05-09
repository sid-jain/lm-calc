/**
 * Smart-click behavior for the developer filter pills.
 *
 * - Default state (no filter): clicking a pill solos it (the common "focus on this" intent)
 * - Filter state: clicking toggles in/out
 * - Clicking the only-included pill restores the default (avoids an empty selection)
 */
export function nextExcludedOnPillClick(
  dev: string,
  allDevs: string[],
  currentExcluded: string[],
): string[] {
  if (currentExcluded.length === 0) {
    return allDevs.filter((d) => d !== dev);
  }

  const excludedSet = new Set(currentExcluded);
  const includedDevs = allDevs.filter((d) => !excludedSet.has(d));

  if (includedDevs.length === 1 && includedDevs[0] === dev) {
    return [];
  }

  if (excludedSet.has(dev)) {
    return currentExcluded.filter((d) => d !== dev);
  }
  return [...currentExcluded, dev];
}
