// Sync component state to the URL query string. SSR-safe: every function early-returns
// when `window` is unavailable (the prerender runs in Node), so no hydration mismatch —
// the server renders defaults, and on mount the components read the URL and update.

export function readParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

// Set the keys in `updates`. A value of null/empty-string deletes the key. Other keys
// already in the URL are left alone so multiple components can write independently.
// Uses replaceState to avoid filling browser history with every slider tick.
export function writeParams(updates: Record<string, string | null>): void {
  if (typeof window === 'undefined') return;
  const current = readParams();
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === '') current.delete(k);
    else current.set(k, v);
  }
  const search = current.toString();
  const desired = search ? `?${search}` : '';
  if (window.location.search === desired) return;
  const newUrl = `${window.location.pathname}${desired}${window.location.hash}`;
  window.history.replaceState(null, '', newUrl);
}
