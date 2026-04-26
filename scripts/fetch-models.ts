#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDefaultResultOrder } from 'node:dns';
import { ModelsSchema } from '../src/lib/schema';
import type { AttentionType, Model } from '../src/lib/types';

setDefaultResultOrder('ipv4first');

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = resolve(__dirname, 'model-sources.json');
const OUTPUT_PATH = resolve(__dirname, '../src/data/models.json');
const HF_TOKEN = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_HUB_TOKEN;

interface SourceEntry {
  id: string;
  displayName: string;
  family: string;
  developer: string;
  hfRepo: string;
  configRepo?: string;
  params: number;
  attentionOverride: AttentionType | null;
  slidingWindowSize: number | null;
  fullAttentionRatio: number | null;
  isMoE: boolean;
  activeParams: number | null;
}

interface HfConfig {
  hidden_size?: number;
  num_hidden_layers?: number;
  num_attention_heads?: number;
  num_key_value_heads?: number;
  vocab_size?: number;
  max_position_embeddings?: number;
  tie_word_embeddings?: boolean;
  head_dim?: number;
  sliding_window?: number | null;
}

async function fetchConfig(repo: string): Promise<HfConfig> {
  const url = `https://huggingface.co/${repo}/raw/main/config.json`;
  const headers: Record<string, string> = {};
  if (HF_TOKEN) headers.Authorization = `Bearer ${HF_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const hint =
      res.status === 401
        ? ' (gated repo — set HF_TOKEN or use a public mirror via "configRepo")'
        : '';
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}${hint}`);
  }
  return (await res.json()) as HfConfig;
}

function determineAttention(
  override: AttentionType | null,
  attnHeads: number,
  kvHeads: number,
): AttentionType {
  if (override) return override;
  if (kvHeads === attnHeads) return 'full';
  if (kvHeads === 1) return 'mqa';
  return 'gqa';
}

function requireField<T>(value: T | undefined | null, name: string, repo: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Missing required field "${name}" in config.json for ${repo}`);
  }
  return value;
}

async function buildModel(src: SourceEntry): Promise<Model> {
  const fetchFrom = src.configRepo ?? src.hfRepo;
  const cfg = await fetchConfig(fetchFrom);
  const hiddenSize = requireField(cfg.hidden_size, 'hidden_size', fetchFrom);
  const layers = requireField(cfg.num_hidden_layers, 'num_hidden_layers', fetchFrom);
  const attnHeads = requireField(cfg.num_attention_heads, 'num_attention_heads', fetchFrom);
  const kvHeads = cfg.num_key_value_heads ?? attnHeads;
  const vocabSize = requireField(cfg.vocab_size, 'vocab_size', fetchFrom);
  const maxContext = requireField(
    cfg.max_position_embeddings,
    'max_position_embeddings',
    fetchFrom,
  );
  const tiedEmbeddings = cfg.tie_word_embeddings ?? false;
  const headDim = cfg.head_dim ?? Math.floor(hiddenSize / attnHeads);
  const attentionType = determineAttention(src.attentionOverride, attnHeads, kvHeads);

  return {
    id: src.id,
    displayName: src.displayName,
    family: src.family,
    developer: src.developer,
    hfRepo: src.hfRepo,
    params: src.params,
    isMoE: src.isMoE,
    activeParams: src.activeParams,
    arch: {
      layers,
      attnHeads,
      kvHeads,
      headDim,
      hiddenSize,
      vocabSize,
      tiedEmbeddings,
      maxContext,
      attentionType,
      slidingWindowSize: src.slidingWindowSize,
      fullAttentionRatio: src.fullAttentionRatio,
    },
  };
}

async function main() {
  const sources = JSON.parse(readFileSync(SOURCES_PATH, 'utf-8')) as SourceEntry[];
  const models: Model[] = [];
  const failures: string[] = [];

  for (const src of sources) {
    const fetchFrom = src.configRepo ?? src.hfRepo;
    try {
      console.log(`Fetching ${fetchFrom} ...`);
      const model = await buildModel(src);
      models.push(model);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${src.id}: ${message}`);
      console.error(`  ✗ ${message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} model(s) failed to fetch:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  models.sort((a, b) => a.params - b.params);

  const parsed = ModelsSchema.safeParse(models);
  if (!parsed.success) {
    console.error('Validation failed:');
    console.error(JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(parsed.data, null, 2) + '\n');
  console.log(`\nWrote ${parsed.data.length} models to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
