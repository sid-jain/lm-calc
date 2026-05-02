#!/usr/bin/env tsx
// Surface candidate models from the developers we already track. Run manually:
//   npm run discover-models
//
// Output is a list per developer of recent text-generation repos that aren't already in
// model-sources.json, with a paste-ready JSON line. The script does not modify any files —
// you read the list, decide what to add, and append entries by hand. This keeps the
// "what counts as worth listing?" judgment with the human.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDefaultResultOrder } from 'node:dns';

setDefaultResultOrder('ipv4first');

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = resolve(__dirname, 'model-sources.json');

const DEVELOPERS = [
  { owner: 'meta-llama', label: 'Meta' },
  { owner: 'Qwen', label: 'Alibaba' },
  { owner: 'google', label: 'Google' },
  { owner: 'mistralai', label: 'Mistral AI' },
  { owner: 'microsoft', label: 'Microsoft' },
  { owner: 'deepseek-ai', label: 'DeepSeek' },
  { owner: 'moonshotai', label: 'Moonshot AI' },
];

// Quantized / re-packaged variants and training-step checkpoints — not separate "models"
// for our purposes. The trailing `-\d{4,}` rule catches step counters like
// "Dayhoff-170M-UR90-HL-48000" but also date codes like "Mistral-Small-...-2501";
// the latter are usually already in our list anyway, and easy to add manually if not.
const SKIP_PATTERNS = [
  /-gguf\b/i,
  /-gptq\b/i,
  /-awq\b/i,
  /-fp8\b/i,
  /-fp4\b/i,
  /-int4\b/i,
  /-int8\b/i,
  /-bnb-/i,
  /-mlx\b/i,
  /-nvfp4\b/i,
  /-mxfp4\b/i,
  /-\d{4,}$/,
];

const PER_DEV_LIMIT = 40;

// Skip models created before this date by default. Override via SINCE_DAYS env var.
// 30 days is the run-it-monthly cadence; bump SINCE_DAYS=180 for a half-year sweep.
const SINCE_DAYS = Number(process.env.SINCE_DAYS ?? 30);
const SINCE_CUTOFF = new Date(Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000);

interface HfModel {
  id: string;
  pipeline_tag?: string;
  createdAt?: string;
}

interface HfApiResponse {
  safetensors?: { total?: number; parameters?: Record<string, number> };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Send the README to Haiku 4.5 with a tight extraction prompt. Returns the active-params
// count in billions, or null if the README doesn't state it (or the API call fails).
// Requires ANTHROPIC_API_KEY in the environment; absent → null and we fall back to placeholder.
async function llmExtractActiveParams(repo: string, readme: string): Promise<number | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16,
        system:
          'You extract data from MoE model card READMEs. Reply with ONLY the per-token ' +
          'activated parameter count in billions as a bare number (e.g. 3.3, 32, 49), or ' +
          'the word NULL if the README does not state it. No prose, no units, no explanation.',
        messages: [
          {
            role: 'user',
            content: `Repo: ${repo}\n\nREADME:\n${readme.slice(0, 20000)}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.[0]?.text?.trim();
    if (!text || text.toUpperCase() === 'NULL') return null;
    const n = Number(text);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// Try to derive activeParams without manual lookup:
//   1. Repo name suffix `-AYB` (Qwen 3 / Moonshot convention) — free, exact when present.
//   2. Haiku 4.5 reading the model card README (requires ANTHROPIC_API_KEY).
// Returns null if neither yields a plausible number; caller writes the 0 placeholder.
async function deriveActiveParams(
  repo: string,
  totalParamsB: number,
): Promise<{ value: number; source: string } | null> {
  const sane = (n: number): boolean => n > 0 && n <= totalParamsB * 1.05; // 5% rounding slack

  const repoMatch = repo.match(/-A(\d+(?:\.\d+)?)B(?:\b|$)/i);
  if (repoMatch) {
    const n = Number(repoMatch[1]);
    if (sane(n)) return { value: n, source: 'repo name' };
  }

  const readme = await fetchText(`https://huggingface.co/${repo}/raw/main/README.md`);
  if (!readme) return null;
  const llm = await llmExtractActiveParams(repo, readme);
  if (llm !== null && sane(llm)) return { value: llm, source: 'README (Haiku)' };
  return null;
}

async function listRecent(owner: string): Promise<HfModel[]> {
  const url = `https://huggingface.co/api/models?author=${encodeURIComponent(owner)}&pipeline_tag=text-generation&sort=createdAt&direction=-1&limit=${PER_DEV_LIMIT}`;
  return (await fetchJson<HfModel[]>(url)) ?? [];
}

async function detectMoEAndParams(repo: string): Promise<{ moe: boolean | null; paramsB: number | null }> {
  // config.json tells us MoE, also gives us torch_dtype to convert bytes → params if we
  // need to use the safetensors index fallback.
  const cfgRaw = await fetchJson<Record<string, unknown>>(
    `https://huggingface.co/${repo}/raw/main/config.json`,
  );
  const cfg = (cfgRaw?.text_config && typeof cfgRaw.text_config === 'object'
    ? (cfgRaw.text_config as Record<string, unknown>)
    : cfgRaw) ?? {};
  const moe = cfgRaw
    ? Boolean(cfg.num_experts || cfg.num_local_experts || cfg.n_routed_experts)
    : null;

  // Try API safetensors first (matches fetch-models.ts logic).
  const api = await fetchJson<HfApiResponse>(`https://huggingface.co/api/models/${repo}`);
  let totalParams: number | null = null;
  if (api?.safetensors) {
    totalParams =
      api.safetensors.total ??
      (api.safetensors.parameters
        ? Object.values(api.safetensors.parameters).reduce((a, b) => a + b, 0)
        : null);
  }
  if (!totalParams) {
    // Fall back to the safetensors index — divide bytes by 2 (assume bf16/fp16, the modern
    // default; this is a discovery preview, not the source of truth).
    const idx = await fetchJson<{ metadata?: { total_size?: number } }>(
      `https://huggingface.co/${repo}/raw/main/model.safetensors.index.json`,
    );
    if (idx?.metadata?.total_size) totalParams = idx.metadata.total_size / 2;
  }
  return { moe, paramsB: totalParams ? totalParams / 1e9 : null };
}

function shouldSkip(repo: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(repo));
}

// When we can't derive activeParams for an MoE entry, we write 0 as a placeholder.
// fetch-models rejects 0 with a clear error pointing at the model, so the broken state
// is loud — no silent skips, no entries that look complete but aren't.
const MOE_PLACEHOLDER = 0;

function entryLine(repo: string, moe: boolean | null, activeParams: number | null): string {
  if (!moe) return `  { "hfRepo": "${repo}" }`;
  const value = activeParams ?? MOE_PLACEHOLDER;
  return `  { "hfRepo": "${repo}", "activeParams": ${value} }`;
}

function appendEntries(entries: string[]): void {
  const raw = readFileSync(SOURCES_PATH, 'utf-8');
  // Splice new entries in just before the closing `]`. Preserves the file's hand-tuned
  // formatting (one entry per line) instead of round-tripping through JSON.stringify.
  const closeIdx = raw.lastIndexOf(']');
  const before = raw.slice(0, closeIdx).trimEnd();
  const after = raw.slice(closeIdx);
  const needsLeadingComma = !before.endsWith('[') && !before.endsWith(',');
  const insertion = (needsLeadingComma ? ',\n' : '\n') + entries.join(',\n') + '\n';
  writeFileSync(SOURCES_PATH, before + insertion + after);
}

async function main() {
  const writeMode = process.argv.includes('--write') || process.argv.includes('-w');
  const sources = JSON.parse(readFileSync(SOURCES_PATH, 'utf-8')) as { hfRepo: string }[];
  const seen = new Set(sources.map((s) => s.hfRepo.toLowerCase()));
  process.stderr.write(
    `Looking for models created in the last ${SINCE_DAYS} days (override with SINCE_DAYS=N).\n`,
  );
  if (writeMode) {
    process.stderr.write('Write mode: candidates will be appended to model-sources.json.\n');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      'Note: ANTHROPIC_API_KEY not set — MoE activeParams will only be auto-filled from repo-name suffixes (e.g. -A3B). Set the env var to extract from READMEs via Haiku 4.5.\n',
    );
  }

  let totalCandidates = 0;
  let moeUnresolvedCount = 0;
  const toAppend: string[] = [];
  for (const dev of DEVELOPERS) {
    process.stderr.write(`Scanning ${dev.owner} ...\n`);
    const models = await listRecent(dev.owner);
    type Candidate = {
      repo: string;
      created: string;
      paramsB: number;
      moe: boolean | null;
      activeParams: number | null;
      activeSource: string | null;
    };
    const candidates: Candidate[] = [];

    for (const m of models) {
      if (seen.has(m.id.toLowerCase())) continue;
      if (shouldSkip(m.id)) continue;
      if (m.createdAt && new Date(m.createdAt) < SINCE_CUTOFF) continue;
      const { moe, paramsB } = await detectMoEAndParams(m.id);
      // No safetensors → not a usable entry for the calculator.
      if (paramsB === null) continue;
      const derived = moe ? await deriveActiveParams(m.id, paramsB) : null;
      candidates.push({
        repo: m.id,
        created: m.createdAt?.slice(0, 10) ?? '?',
        paramsB,
        moe,
        activeParams: derived?.value ?? null,
        activeSource: derived?.source ?? null,
      });
    }

    if (candidates.length === 0) continue;
    totalCandidates += candidates.length;
    console.log(`\n=== ${dev.label}  (${candidates.length} candidate${candidates.length === 1 ? '' : 's'}) ===`);
    for (const c of candidates) {
      const sizeStr = `~${c.paramsB.toFixed(c.paramsB < 10 ? 1 : 0)}B`;
      let arch = c.moe === true ? 'MoE' : c.moe === false ? 'dense' : '?';
      if (c.moe) {
        arch += c.activeParams !== null
          ? ` A${c.activeParams}B from ${c.activeSource}`
          : ' ⚠ activeParams placeholder';
      }
      if (c.moe && c.activeParams === null) moeUnresolvedCount++;
      console.log(`  ${c.repo}  (${c.created}, ${sizeStr}, ${arch})`);
      console.log(entryLine(c.repo, c.moe, c.activeParams));
      if (writeMode) toAppend.push(entryLine(c.repo, c.moe, c.activeParams));
    }
  }

  if (totalCandidates === 0) {
    console.log('\nNo new candidates. The list is current.');
    return;
  }

  if (writeMode) {
    appendEntries(toAppend);
    console.log(`\nAppended ${toAppend.length} entr${toAppend.length === 1 ? 'y' : 'ies'} to model-sources.json.`);
    if (moeUnresolvedCount > 0) {
      console.log(
        `${moeUnresolvedCount} MoE entr${moeUnresolvedCount === 1 ? 'y has' : 'ies have'} ` +
          `\`"activeParams": ${MOE_PLACEHOLDER}\` — couldn't derive from repo name or README. ` +
          `Replace each 0 with the per-token active param count from the model card.`,
      );
    }
    console.log('Run `npm run fetch-models` once any placeholders are filled in.');
  } else {
    console.log(
      `\n${totalCandidates} candidate${totalCandidates === 1 ? '' : 's'} found. ` +
        `Re-run with --write to append all entries to model-sources.json ` +
        `(MoE activeParams is auto-filled when derivable, otherwise gets a 0 placeholder).`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
