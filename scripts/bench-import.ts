#!/usr/bin/env tsx
/**
 * bench-import.ts — promote scripts/bench.sh results.csv into a regression fixture.
 *
 * Reads the CSV, drops TIMEOUT/ERROR rows, validates each row's model_id and
 * gpu_id against the calculator's data, and writes/merges one JSON file per
 * (model_id, gpu_id) pair under benchmarks/measurements/.
 *
 * The fixture files are the durable record. They're consumed by
 * src/lib/measurements.test.ts as the regression baseline: any change to the
 * memory math that pushes predictions outside the band of measured reality
 * fails CI.
 *
 * Usage:  tsx scripts/bench-import.ts <results.csv> [--out <dir>]
 *
 * Idempotent: re-importing the same rows replaces matching (weight_quant_id,
 * kv_quant_id, ctx, depth) entries rather than duplicating them.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { models } from '../src/lib/loadModels';
import { QUANT_LEVELS } from '../src/lib/quants';
import { KV_CACHE_QUANT_LEVELS } from '../src/lib/kvCacheQuants';
import { DEVICES } from '../src/lib/devices';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

interface Sample {
  // The matrix only emits symmetric KV (ctk == ctv), so a single id captures
  // both. validateRow() rejects asymmetric rows up front so they never reach
  // a fixture.
  weight_quant_id: string;
  kv_quant_id: string;
  ctx: number;
  depth: number;
  peak_vram_mib: number;
  pp_tok_s: number | null;
  tg_tok_s: number | null;
}

interface Fixture {
  model_id: string;
  gpu_id: string;
  llama_cpp_commit: string;
  captured_at: string;
  samples: Sample[];
}

const HEADER = [
  'timestamp',
  'llama_cpp_commit',
  'gpu_id',
  'gpu_name',
  'gpu_vram_mib',
  'model_id',
  'weight_quant_id',
  'ctx',
  'kv_quant_k',
  'kv_quant_v',
  'depth',
  'status',
  'peak_vram_mib',
  'pp_tok_s',
  'tg_tok_s',
  'notes',
] as const;

// Minimal CSV split — handles quoted gpu_name (the only field that may contain
// commas in our writer). No multi-line fields. Anything more exotic and we'd
// pull a dep, but bench.sh writes a controlled shape.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (c === ',' && !inQuote) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(path: string): Array<Record<string, string>> {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error(`empty CSV: ${path}`);
  const header = splitCsvLine(lines[0]);
  for (const expected of HEADER) {
    if (!header.includes(expected)) {
      throw new Error(`CSV missing column "${expected}". Got: ${header.join(',')}`);
    }
  }
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, j) => {
      row[h] = fields[j] ?? '';
    });
    out.push(row);
  }
  return out;
}

function validateRow(row: Record<string, string>): string | null {
  if (!models.find((m) => m.id === row.model_id)) return `unknown model_id "${row.model_id}"`;
  if (!QUANT_LEVELS.find((q) => q.id === row.weight_quant_id))
    return `unknown weight_quant_id "${row.weight_quant_id}"`;
  if (!KV_CACHE_QUANT_LEVELS.find((q) => q.id === row.kv_quant_k))
    return `unknown kv_quant_k "${row.kv_quant_k}"`;
  if (!KV_CACHE_QUANT_LEVELS.find((q) => q.id === row.kv_quant_v))
    return `unknown kv_quant_v "${row.kv_quant_v}"`;
  if (!DEVICES.find((d) => d.id === row.gpu_id)) return `unknown gpu_id "${row.gpu_id}"`;
  // Today the matrix only emits symmetric K/V quants — surface anything else as
  // skip-with-warning rather than silently picking one side.
  if (row.kv_quant_k !== row.kv_quant_v)
    return `asymmetric kv_quant_k=${row.kv_quant_k} != kv_quant_v=${row.kv_quant_v} (not yet supported by fixture schema)`;
  return null;
}

function rowToSample(row: Record<string, string>): Sample {
  const num = (s: string) => (s === 'N/A' || s === '' ? null : Number(s));
  return {
    weight_quant_id: row.weight_quant_id,
    kv_quant_id: row.kv_quant_k,
    ctx: Number(row.ctx),
    depth: Number(row.depth),
    peak_vram_mib: Number(row.peak_vram_mib),
    pp_tok_s: num(row.pp_tok_s),
    tg_tok_s: num(row.tg_tok_s),
  };
}

function addOrReplace(samples: Sample[], next: Sample): Sample[] {
  const idx = samples.findIndex(
    (s) =>
      s.weight_quant_id === next.weight_quant_id &&
      s.kv_quant_id === next.kv_quant_id &&
      s.ctx === next.ctx &&
      s.depth === next.depth,
  );
  if (idx >= 0) {
    const out = samples.slice();
    out[idx] = next;
    return out;
  }
  return [...samples, next];
}

function sortSamples(samples: Sample[]): Sample[] {
  return [...samples].sort((a, b) => {
    if (a.weight_quant_id !== b.weight_quant_id)
      return a.weight_quant_id.localeCompare(b.weight_quant_id);
    if (a.kv_quant_id !== b.kv_quant_id) return a.kv_quant_id.localeCompare(b.kv_quant_id);
    if (a.ctx !== b.ctx) return a.ctx - b.ctx;
    return a.depth - b.depth;
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    console.error(
      'Usage: tsx scripts/bench-import.ts <results.csv> [<results.csv>...] [--out <dir>]',
    );
    process.exit(1);
  }
  const csvPaths: string[] = [];
  let outDir = resolve(REPO_ROOT, 'benchmarks/measurements');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') {
      outDir = resolve(args[++i]);
    } else {
      csvPaths.push(args[i]);
    }
  }
  for (const p of csvPaths) {
    if (!existsSync(p)) {
      console.error(`No such file: ${p}`);
      process.exit(1);
    }
  }
  mkdirSync(outDir, { recursive: true });

  // Concatenate rows from every CSV. Fixtures are keyed by (model_id, gpu_id),
  // so importing many CSVs from many cloud boxes lands them in the right
  // per-pair fixture file with no manual merging needed.
  const rows = csvPaths.flatMap((p) => parseCsv(p));
  let kept = 0;
  let skipped = 0;
  // Group by (model_id, gpu_id). Capture the most recent commit + timestamp per
  // group so the fixture reflects the latest run. Older samples for the same
  // (quant, ctx, depth) tuple are replaced by addOrReplace().
  const groups = new Map<string, { fixture: Fixture; latestTs: string }>();

  for (const row of rows) {
    if (row.status !== 'OK') {
      skipped++;
      continue;
    }
    const err = validateRow(row);
    if (err) {
      console.warn(`skip row: ${err}`);
      skipped++;
      continue;
    }
    const peak = Number(row.peak_vram_mib);
    if (!Number.isFinite(peak) || peak <= 0) {
      console.warn(`skip row: invalid peak_vram_mib "${row.peak_vram_mib}"`);
      skipped++;
      continue;
    }
    const key = `${row.model_id}__${row.gpu_id}`;
    let entry = groups.get(key);
    if (!entry) {
      const path = join(outDir, `${key}.json`);
      let fixture: Fixture;
      if (existsSync(path)) {
        fixture = JSON.parse(readFileSync(path, 'utf8'));
      } else {
        fixture = {
          model_id: row.model_id,
          gpu_id: row.gpu_id,
          llama_cpp_commit: row.llama_cpp_commit,
          captured_at: row.timestamp,
          samples: [],
        };
      }
      entry = { fixture, latestTs: fixture.captured_at };
      groups.set(key, entry);
    }
    if (row.timestamp > entry.latestTs) {
      entry.latestTs = row.timestamp;
      entry.fixture.captured_at = row.timestamp;
      entry.fixture.llama_cpp_commit = row.llama_cpp_commit;
    }
    entry.fixture.samples = addOrReplace(entry.fixture.samples, rowToSample(row));
    kept++;
  }

  for (const [key, { fixture }] of groups.entries()) {
    fixture.samples = sortSamples(fixture.samples);
    const path = join(outDir, `${key}.json`);
    writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
    console.log(`wrote ${path} (${fixture.samples.length} samples)`);
  }

  console.log(`\nDone. ${kept} rows imported, ${skipped} skipped.`);
  if (groups.size === 0) {
    console.log(`(no fixtures changed — check the CSV has OK rows)`);
  } else {
    console.log(`Fixtures live under ${outDir}/`);
    console.log(
      `Existing fixtures: ${readdirSync(outDir)
        .filter((f) => f.endsWith('.json'))
        .join(', ')}`,
    );
  }
}

main();
