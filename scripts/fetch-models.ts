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

// One entry per model. `hfRepo` is the only required field — everything else is auto-derived
// from the model's config.json and safetensors metadata. The optional overrides handle the
// cases auto-derivation can't (MoE active params, gated repos, hand-crafted display names).
interface SourceEntry {
  hfRepo: string;
  configRepo?: string;
  displayName?: string;
  developer?: string;
  activeParams?: number;
  attentionOverride?: AttentionType;
}

interface HfConfig {
  model_type?: string;
  hidden_size?: number;
  num_hidden_layers?: number;
  num_attention_heads?: number;
  num_key_value_heads?: number;
  vocab_size?: number;
  max_position_embeddings?: number;
  tie_word_embeddings?: boolean;
  head_dim?: number;
  sliding_window?: number | null;
  sliding_window_pattern?: number | null;
  layer_types?: string[] | null;
  full_attention_interval?: number | null;
  kv_lora_rank?: number | null;
  qk_rope_head_dim?: number | null;
  num_experts?: number | null;
  num_local_experts?: number | null;
  n_routed_experts?: number | null;
}

interface HfApiResponse {
  safetensors?: {
    parameters?: Record<string, number>;
    total?: number;
  };
}

// Owner-prefix → developer name. Falls back to a prettified slug if unknown,
// or the user can override with `developer` in the source entry.
const DEVELOPER_BY_OWNER: Record<string, string> = {
  'meta-llama': 'Meta',
  Qwen: 'Alibaba',
  mistralai: 'Mistral AI',
  google: 'Google',
  microsoft: 'Microsoft',
  'deepseek-ai': 'DeepSeek',
  moonshotai: 'Moonshot AI',
};

function repoTail(hfRepo: string): string {
  const slash = hfRepo.indexOf('/');
  return slash === -1 ? hfRepo : hfRepo.slice(slash + 1);
}

function deriveId(hfRepo: string): string {
  return repoTail(hfRepo)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Mechanical: take the repo's tail, replace dashes/underscores with spaces, capitalize the
// first letter. No suffix stripping, no size-letter uppercasing, no letter-digit splitting —
// every transformation past this point is a curation decision, and we'd rather show what HF
// actually publishes than make per-model judgment calls.
function deriveDisplayName(hfRepo: string): string {
  const tail = repoTail(hfRepo).replace(/[-_]+/g, ' ').trim();
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

function deriveDeveloper(hfRepo: string): string {
  const owner = hfRepo.split('/')[0] ?? hfRepo;
  if (DEVELOPER_BY_OWNER[owner]) return DEVELOPER_BY_OWNER[owner];
  // Prettify the slug as a fallback. Users can override.
  return owner
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
  const raw = (await res.json()) as Record<string, unknown>;
  // Multimodal models (Gemma 3 4B+, Llama 4, Qwen 3.6) nest the text architecture under text_config.
  if (raw.text_config && typeof raw.text_config === 'object') {
    return raw.text_config as HfConfig;
  }
  return raw as HfConfig;
}

// Bytes-per-param for the dtype labels HF uses in `torch_dtype` / `dtype`.
const BYTES_PER_DTYPE: Record<string, number> = {
  float16: 2,
  bfloat16: 2,
  float32: 4,
  float: 4,
  float64: 8,
};

function bytesPerParam(cfg: HfConfig): number {
  const dtype = (cfg as Record<string, unknown>).torch_dtype ?? (cfg as Record<string, unknown>).dtype;
  if (typeof dtype === 'string' && BYTES_PER_DTYPE[dtype]) return BYTES_PER_DTYPE[dtype];
  return 2; // bf16/fp16 is the modern default
}

async function fetchHfJson<T>(url: string): Promise<T | null> {
  const headers: Record<string, string> = {};
  if (HF_TOKEN) headers.Authorization = `Bearer ${HF_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function fetchParams(repo: string, cfg: HfConfig): Promise<number> {
  // Fast path: HF API exposes parameter counts directly when its scanner has run.
  const apiUrl = `https://huggingface.co/api/models/${repo}`;
  const api = await fetchHfJson<HfApiResponse>(apiUrl);
  if (api?.safetensors) {
    const total =
      api.safetensors.total ??
      (api.safetensors.parameters
        ? Object.values(api.safetensors.parameters).reduce((a, b) => a + b, 0)
        : null);
    if (total) return Math.round((total / 1e9) * 1000) / 1000;
  }

  // Fallback: read the safetensors shard index for sharded repos. metadata.total_size is
  // raw bytes — divide by bytes-per-param from the model's dtype.
  const indexUrl = `https://huggingface.co/${repo}/raw/main/model.safetensors.index.json`;
  const index = await fetchHfJson<{ metadata?: { total_size?: number } }>(indexUrl);
  const totalSize = index?.metadata?.total_size;
  if (totalSize) {
    const params = totalSize / bytesPerParam(cfg);
    return Math.round((params / 1e9) * 1000) / 1000;
  }

  // Final fallback: a single-shard repo with model.safetensors. The HEAD's X-Linked-Size
  // header carries the LFS-pointed file size; Content-Length lies for LFS pointers.
  const headRes = await fetch(`https://huggingface.co/${repo}/resolve/main/model.safetensors`, {
    method: 'HEAD',
    redirect: 'follow',
    headers: HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {},
  });
  if (headRes.ok) {
    const size = Number(headRes.headers.get('x-linked-size') ?? headRes.headers.get('content-length'));
    if (size > 0) {
      const params = size / bytesPerParam(cfg);
      return Math.round((params / 1e9) * 1000) / 1000;
    }
  }

  throw new Error(
    `${repo}: could not determine parameter count from HF API, safetensors index, or single-file HEAD. ` +
      `The repo may use pytorch_model.bin only — add a "params" override or check the repo.`,
  );
}

function detectMoE(cfg: HfConfig): boolean {
  return Boolean(cfg.num_experts || cfg.num_local_experts || cfg.n_routed_experts);
}

function detectAttention(
  override: AttentionType | undefined,
  attnHeads: number,
  kvHeads: number,
  cfg: HfConfig,
): { type: AttentionType; fullAttentionRatio: number | null } {
  if (override) {
    return { type: override, fullAttentionRatio: null };
  }
  // MLA: compressed-latent KV cache (DeepSeek V3 family, Kimi K2, Moonlight).
  if (cfg.kv_lora_rank && cfg.qk_rope_head_dim) {
    return { type: 'mla', fullAttentionRatio: null };
  }
  // Hybrid linear+full (Qwen 3.6): every Nth layer is full attention, the rest are
  // linear-attention variants whose KV cost is constant in context.
  if (cfg.full_attention_interval && cfg.full_attention_interval > 1) {
    return { type: 'hybrid-linear', fullAttentionRatio: 1 / cfg.full_attention_interval };
  }
  // Gemma-style mixed: alternating sliding-window and full layers.
  if (cfg.layer_types && Array.isArray(cfg.layer_types)) {
    const fullCount = cfg.layer_types.filter((t) => t === 'full_attention').length;
    if (fullCount > 0 && fullCount < cfg.layer_types.length) {
      return { type: 'mixed', fullAttentionRatio: fullCount / cfg.layer_types.length };
    }
  }
  if (cfg.sliding_window && cfg.sliding_window_pattern && cfg.sliding_window_pattern > 1) {
    return { type: 'mixed', fullAttentionRatio: 1 / cfg.sliding_window_pattern };
  }
  // Older Gemma 2 configs omit sliding_window_pattern but the architecture is fixed:
  // every other layer is full attention. Use the model_type as a positive signal so we
  // don't accidentally apply this to Phi-3.5 (which sets sliding_window without using it).
  if (cfg.sliding_window && cfg.model_type === 'gemma2') {
    return { type: 'mixed', fullAttentionRatio: 0.5 };
  }
  // Phi-3.5 sets `sliding_window` but uses full attention. With no layer pattern and no
  // gemma model_type, that's the right default — fall through to GQA/full per heads.
  if (kvHeads === attnHeads) return { type: 'full', fullAttentionRatio: null };
  if (kvHeads === 1) return { type: 'mqa', fullAttentionRatio: null };
  return { type: 'gqa', fullAttentionRatio: null };
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
  const params = await fetchParams(fetchFrom, cfg);

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

  const isMoE = detectMoE(cfg);
  if (isMoE && src.activeParams === undefined) {
    throw new Error(
      `${src.hfRepo}: detected MoE (config has expert count). Add "activeParams" to the source entry — ` +
        `the per-token active parameter count from the model card, in billions.`,
    );
  }

  const { type: attentionType, fullAttentionRatio } = detectAttention(
    src.attentionOverride,
    attnHeads,
    kvHeads,
    cfg,
  );

  // sliding_window appears in many configs, but it's only meaningful for "mixed".
  // Phi-3.5 sets it without using sliding attention; we ignore it there.
  const slidingWindowSize = attentionType === 'mixed' ? cfg.sliding_window ?? null : null;

  return {
    id: deriveId(src.hfRepo),
    displayName: src.displayName ?? deriveDisplayName(src.hfRepo),
    developer: src.developer ?? deriveDeveloper(src.hfRepo),
    hfRepo: src.hfRepo,
    params,
    isMoE,
    activeParams: isMoE ? src.activeParams ?? null : null,
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
      slidingWindowSize,
      fullAttentionRatio,
      kvLoraRank: cfg.kv_lora_rank ?? null,
      qkRopeHeadDim: cfg.qk_rope_head_dim ?? null,
    },
  };
}

async function main() {
  const raw = JSON.parse(readFileSync(SOURCES_PATH, 'utf-8')) as unknown[];
  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null || typeof (entry as SourceEntry).hfRepo !== 'string') {
      throw new Error(
        `model-sources.json[${i}]: expected an object with an "hfRepo" field, got ${JSON.stringify(entry)}`,
      );
    }
  }
  const sources = raw as SourceEntry[];
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
      failures.push(`${src.hfRepo}: ${message}`);
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
