#!/usr/bin/env tsx
/**
 * bundle-measurements.ts — concatenate every fixture under
 * benchmarks/measurements/*.json into a single src/data/measurements.json
 * the SPA imports at runtime.
 *
 * Mirrors the scripts/fetch-models.ts → src/data/models.json pattern. We use
 * a generator (rather than Vite's import.meta.glob) so the prerender step,
 * which runs under tsx/Node and lacks Vite's glob magic, can also resolve
 * the data via a plain `import data from '../data/measurements.json'`.
 *
 * Wired as `predev` + `prebuild` in package.json — and called from
 * scripts/bench-import.ts after every fixture write so the bundled file
 * stays in sync with whatever's under benchmarks/measurements/.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURE_DIR = join(REPO_ROOT, 'benchmarks/measurements');
const OUT = join(REPO_ROOT, 'src/data/measurements.json');

export function bundleMeasurements(): { count: number; bytes: number } {
  const fixtures: unknown[] = [];
  if (existsSync(FIXTURE_DIR)) {
    for (const f of readdirSync(FIXTURE_DIR).sort()) {
      if (!f.endsWith('.json')) continue;
      fixtures.push(JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')));
    }
  }
  mkdirSync(dirname(OUT), { recursive: true });
  // Pretty-print with sorted-by-filename order so git diffs are minimal when a
  // single fixture changes.
  const text = JSON.stringify(fixtures, null, 2) + '\n';
  writeFileSync(OUT, text);
  return { count: fixtures.length, bytes: text.length };
}

// Allow `tsx scripts/bundle-measurements.ts` as a standalone build step
// without making the helper run twice when imported from bench-import.ts.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { count, bytes } = bundleMeasurements();
  console.log(`Wrote ${OUT} (${count} fixtures, ${bytes.toLocaleString()} bytes)`);
}
