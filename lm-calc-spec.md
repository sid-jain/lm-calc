# LM Calc — Build Specification (v2)

## 1. Goal

A static web tool that takes three inputs — available RAM, context length, and quantization level — and lists which open-weight LLMs fit. The user picks from a sorted list; no backend, no accounts.

## 2. Design principles

These are non-negotiable. They're what makes this tool better than the existing ones.

1. **Truth over convenience.** All architecture data is derived directly from each model's `config.json` on HuggingFace. No values typed in by hand.
2. **Pure functions for math.** All memory calculations are deterministic functions of `(model, quant, contextLen)`. No side effects, no globals. Trivially unit-testable.
3. **Schema-validated data.** Every model entry passes through zod validation at load time. Bad data fails loudly at build time, not silently at runtime.
4. **Exact tests, not approximations.** Tests assert byte-exact values computed independently. No `~` or `toBeCloseTo(x, -1)`.
5. **Minimal v1 scope.** One screen, one mode. Comparison views, persistence, filters, and live HF lookups are explicitly v2.
6. **Honest about what we don't know.** Framework overhead, quant-specific tensor handling, and inference-engine differences create real uncertainty. The UI shows the estimate as a range and links to a methodology page that explains what's modeled and what isn't.

## 3. Tech stack

- React 18 + TypeScript + Vite
- Tailwind CSS (utility classes; no custom CSS framework)
- Zod for schema validation
- Vitest for tests
- ESLint + Prettier (Vite defaults)
- Hosted on Vercel as a static site

No Redux, no router, no backend, no database, no analytics, no auth.

## 4. Project layout

```
llm-ram-calc/
├── scripts/
│   ├── fetch-models.ts          # builds src/data/models.json from HF
│   └── model-sources.json       # list of HF repos + manual overrides
├── src/
│   ├── lib/
│   │   ├── types.ts             # TypeScript interfaces
│   │   ├── schema.ts            # zod schemas
│   │   ├── quants.ts            # QUANT_LEVELS constant
│   │   ├── memory.ts            # pure math functions
│   │   └── memory.test.ts       # exact-value tests
│   ├── data/
│   │   └── models.json          # GENERATED — do not hand-edit
│   ├── components/
│   │   ├── Controls.tsx
│   │   ├── ModelRow.tsx
│   │   └── ModelList.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## 5. Data pipeline (the key correctness mechanism)

### 5.1 Source of truth

`scripts/model-sources.json` — a hand-maintained list of HuggingFace repos plus the few values that aren't in `config.json`. Example entry:

```json
{
  "id": "llama-3.1-8b",
  "displayName": "Llama 3.1 8B",
  "family": "Llama 3",
  "developer": "Meta",
  "hfRepo": "meta-llama/Llama-3.1-8B",
  "params": 8.030,
  "attentionOverride": null,
  "slidingWindowSize": null,
  "fullAttentionRatio": null,
  "isMoE": false,
  "activeParams": null
}
```

The four override fields exist because some details aren't in `config.json`:
- `params` — exact param count is in the model card or `safetensors.index.json`, not the config; entering it directly is simpler than parsing weight files
- `attentionOverride` — set to `"mixed"` for Gemma 2/3 which alternate layer types
- `slidingWindowSize`, `fullAttentionRatio` — for mixed-attention models
- `isMoE`, `activeParams` — MoE detection is unreliable from config alone

### 5.2 Fetch script (`scripts/fetch-models.ts`)

For each entry in `model-sources.json`:
1. Fetch `https://huggingface.co/{hfRepo}/raw/main/config.json`
2. Extract: `hidden_size`, `num_hidden_layers`, `num_attention_heads`, `num_key_value_heads`, `vocab_size`, `max_position_embeddings`, `tie_word_embeddings`, `head_dim` (or compute as `hidden_size / num_attention_heads` if absent), `sliding_window` (if present)
3. Determine `attentionType`:
   - If `attentionOverride` is set → use it
   - Else if `num_key_value_heads === num_attention_heads` → `"full"`
   - Else if `num_key_value_heads === 1` → `"mqa"`
   - Else → `"gqa"`
4. Merge fetched fields with the override fields
5. Validate the result against the zod `ModelSchema` (section 6.2)
6. Write `src/data/models.json` (sorted by `params` ascending)

Run with `npm run fetch-models`. The script fails the whole run if any model fails validation. CI runs this on every PR to catch breakage from upstream config changes.

### 5.3 Maintainer workflow for adding a model

1. Add an entry to `scripts/model-sources.json` (≤10 lines)
2. Run `npm run fetch-models`
3. Run `npm test` — verifies math still produces expected values for canonical test models
4. Commit both `model-sources.json` and the regenerated `models.json`
5. Open PR

If a model has unusual architecture (sliding window, MoE, etc.), set the relevant override fields. If something doesn't fit the schema, the script tells you exactly what's wrong.

## 6. Types and schema

### 6.1 TypeScript interfaces (`src/lib/types.ts`)

```typescript
export type AttentionType = 'full' | 'gqa' | 'mqa' | 'mixed';

export interface Model {
  id: string;
  displayName: string;
  family: string;
  developer: string;
  hfRepo: string;
  params: number;              // billions, total (includes all MoE experts)
  isMoE: boolean;
  activeParams: number | null; // billions, only for MoE
  arch: {
    layers: number;
    attnHeads: number;
    kvHeads: number;
    headDim: number;
    hiddenSize: number;
    vocabSize: number;
    tiedEmbeddings: boolean;
    maxContext: number;
    attentionType: AttentionType;
    slidingWindowSize: number | null;
    fullAttentionRatio: number | null; // for 'mixed' only; e.g. 0.5 for Gemma 2
  };
}

export interface QuantLevel {
  id: string;
  name: string;
  bytesPerParam: number;
  description: string;
}

export interface MemoryEstimate {
  weightsGB: number;
  kvCacheGB: number;
  overheadGB: number;
  totalGB: number;
  rangeGB: { low: number; high: number };
}
```

### 6.2 Zod schema (`src/lib/schema.ts`)

```typescript
import { z } from 'zod';

export const ModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(1),
  family: z.string().min(1),
  developer: z.string().min(1),
  hfRepo: z.string().regex(/^[^/]+\/[^/]+$/),
  params: z.number().positive(),
  isMoE: z.boolean(),
  activeParams: z.number().positive().nullable(),
  arch: z.object({
    layers: z.number().int().positive(),
    attnHeads: z.number().int().positive(),
    kvHeads: z.number().int().positive(),
    headDim: z.number().int().positive(),
    hiddenSize: z.number().int().positive(),
    vocabSize: z.number().int().positive(),
    tiedEmbeddings: z.boolean(),
    maxContext: z.number().int().positive(),
    attentionType: z.enum(['full', 'gqa', 'mqa', 'mixed']),
    slidingWindowSize: z.number().int().positive().nullable(),
    fullAttentionRatio: z.number().min(0).max(1).nullable(),
  }),
}).refine(
  (m) => m.arch.kvHeads <= m.arch.attnHeads,
  'kvHeads cannot exceed attnHeads'
).refine(
  (m) => m.arch.attentionType !== 'mixed' || (m.arch.slidingWindowSize !== null && m.arch.fullAttentionRatio !== null),
  'mixed attention requires slidingWindowSize and fullAttentionRatio'
).refine(
  (m) => !m.isMoE || m.activeParams !== null,
  'MoE models require activeParams'
);
```

`ModelsSchema = z.array(ModelSchema)` is run on `models.json` at app startup. Any failure throws — caught by the build/dev server, never hits production.

## 7. Quantization levels (`src/lib/quants.ts`)

```typescript
export const QUANT_LEVELS: QuantLevel[] = [
  { id: 'fp32',   name: 'FP32',    bytesPerParam: 4.0,    description: 'Full precision (training)' },
  { id: 'fp16',   name: 'FP16',    bytesPerParam: 2.0,    description: 'Half precision (BF16/FP16) — standard inference' },
  { id: 'q8_0',   name: 'Q8_0',    bytesPerParam: 1.0625, description: '8-bit, near-lossless' },
  { id: 'q6_k',   name: 'Q6_K',    bytesPerParam: 0.820,  description: '6-bit, ~lossless' },
  { id: 'q5_k_m', name: 'Q5_K_M',  bytesPerParam: 0.711,  description: '5-bit, very small loss' },
  { id: 'q4_k_m', name: 'Q4_K_M',  bytesPerParam: 0.604,  description: '4-bit, recommended default' },
  { id: 'q4_0',   name: 'Q4_0',    bytesPerParam: 0.563,  description: '4-bit, simpler' },
  { id: 'q3_k_m', name: 'Q3_K_M',  bytesPerParam: 0.489,  description: '3-bit, noticeable loss' },
  { id: 'q2_k',   name: 'Q2_K',    bytesPerParam: 0.419,  description: '2-3 bit, significant loss' },
];
```

These are llama.cpp's published bits-per-weight averages divided by 8. **Note:** real quant sizes vary slightly per model because K-quants use different bit widths for different tensors. The methodology section of the README states this explicitly.

## 8. Memory math (`src/lib/memory.ts`)

The entire calculation is three terms: weights, KV cache, fixed overhead. No activations (negligible for inference). No separate embedding term (already in `params`).

```typescript
import type { Model, QuantLevel, MemoryEstimate } from './types';

const FRAMEWORK_OVERHEAD_GB = 0.5;
const ESTIMATE_LOW_FACTOR = 0.95;
const ESTIMATE_HIGH_FACTOR = 1.20;

export function weightsGB(model: Model, quant: QuantLevel): number {
  return model.params * quant.bytesPerParam;
}

export function kvCacheGB(model: Model, contextLen: number): number {
  const ctx = Math.min(contextLen, model.arch.maxContext);
  const { layers, kvHeads, headDim, attentionType, slidingWindowSize, fullAttentionRatio } = model.arch;

  const bytesPerLayerAt = (c: number) => 2 * kvHeads * headDim * c * 2; // 2 (K+V) × ... × 2 (FP16)

  if (attentionType === 'mixed') {
    const fullLayers = Math.round(layers * (fullAttentionRatio ?? 0));
    const slidingLayers = layers - fullLayers;
    const slidingCtx = Math.min(ctx, slidingWindowSize ?? ctx);
    const bytes = fullLayers * bytesPerLayerAt(ctx) + slidingLayers * bytesPerLayerAt(slidingCtx);
    return bytes / 1e9;
  }

  return (layers * bytesPerLayerAt(ctx)) / 1e9;
}

export function estimateMemory(model: Model, quant: QuantLevel, contextLen: number): MemoryEstimate {
  const weights = weightsGB(model, quant);
  const kv = kvCacheGB(model, contextLen);
  const overhead = FRAMEWORK_OVERHEAD_GB;
  const total = weights + kv + overhead;
  return {
    weightsGB: weights,
    kvCacheGB: kv,
    overheadGB: overhead,
    totalGB: total,
    rangeGB: {
      low: total * ESTIMATE_LOW_FACTOR,
      high: total * ESTIMATE_HIGH_FACTOR,
    },
  };
}
```

That's the entire calculation engine. Three functions, ~30 lines.

## 9. Tests (`src/lib/memory.test.ts`)

Every test asserts an exact value computed by hand. These are the canonical fixtures; if the math changes, these must change.

```typescript
import { describe, expect, test } from 'vitest';
import { weightsGB, kvCacheGB, estimateMemory } from './memory';
import type { Model } from './types';

const LLAMA_3_1_8B: Model = {
  id: 'llama-3.1-8b',
  displayName: 'Llama 3.1 8B',
  family: 'Llama 3',
  developer: 'Meta',
  hfRepo: 'meta-llama/Llama-3.1-8B',
  params: 8.030,
  isMoE: false,
  activeParams: null,
  arch: {
    layers: 32, attnHeads: 32, kvHeads: 8, headDim: 128,
    hiddenSize: 4096, vocabSize: 128256, tiedEmbeddings: false,
    maxContext: 131072, attentionType: 'gqa',
    slidingWindowSize: null, fullAttentionRatio: null,
  },
};

const GEMMA_2_9B: Model = {
  id: 'gemma-2-9b',
  displayName: 'Gemma 2 9B',
  family: 'Gemma 2',
  developer: 'Google',
  hfRepo: 'google/gemma-2-9b',
  params: 9.241,
  isMoE: false,
  activeParams: null,
  arch: {
    layers: 42, attnHeads: 16, kvHeads: 8, headDim: 256,
    hiddenSize: 3584, vocabSize: 256128, tiedEmbeddings: true,
    maxContext: 8192, attentionType: 'mixed',
    slidingWindowSize: 4096, fullAttentionRatio: 0.5,
  },
};

describe('weightsGB', () => {
  test('Llama 3.1 8B at FP16', () => {
    // 8.030 * 2.0 = 16.060
    expect(weightsGB(LLAMA_3_1_8B, { id: 'fp16', name: 'FP16', bytesPerParam: 2.0, description: '' }))
      .toBeCloseTo(16.060, 6);
  });
  test('Llama 3.1 8B at Q4_K_M', () => {
    // 8.030 * 0.604 = 4.85012
    expect(weightsGB(LLAMA_3_1_8B, { id: 'q4_k_m', name: 'Q4_K_M', bytesPerParam: 0.604, description: '' }))
      .toBeCloseTo(4.85012, 6);
  });
});

describe('kvCacheGB — uniform GQA', () => {
  test('Llama 3.1 8B at 8192 ctx', () => {
    // 32 * 2 * 8 * 128 * 8192 * 2 / 1e9 = 1.073741824
    expect(kvCacheGB(LLAMA_3_1_8B, 8192)).toBeCloseTo(1.073741824, 9);
  });
  test('Llama 3.1 8B at 131072 ctx (max)', () => {
    // 32 * 2 * 8 * 128 * 131072 * 2 / 1e9 = 17.179869184
    expect(kvCacheGB(LLAMA_3_1_8B, 131072)).toBeCloseTo(17.179869184, 9);
  });
  test('clamps ctx to maxContext', () => {
    expect(kvCacheGB(LLAMA_3_1_8B, 200000)).toBeCloseTo(17.179869184, 9);
  });
});

describe('kvCacheGB — mixed attention', () => {
  test('Gemma 2 9B at 8192 ctx', () => {
    // 21 full layers * (2*8*256*8192*2) + 21 sliding layers * (2*8*256*4096*2)
    // = 21 * 67108864 + 21 * 33554432 = 21 * 100663296 = 2113929216 bytes
    expect(kvCacheGB(GEMMA_2_9B, 8192)).toBeCloseTo(2.113929216, 9);
  });
  test('Gemma 2 9B at 4096 ctx (≤ sliding window, both layer types use same ctx)', () => {
    // 42 layers * (2 * 8 * 256 * 4096 * 2) = 42 * 33554432 = 1409286144 bytes
    expect(kvCacheGB(GEMMA_2_9B, 4096)).toBeCloseTo(1.409286144, 9);
  });
});

describe('estimateMemory', () => {
  test('total equals sum of components', () => {
    const e = estimateMemory(LLAMA_3_1_8B, { id: 'q4_k_m', name: '', bytesPerParam: 0.604, description: '' }, 8192);
    expect(e.totalGB).toBeCloseTo(e.weightsGB + e.kvCacheGB + e.overheadGB, 9);
  });
  test('range brackets the estimate', () => {
    const e = estimateMemory(LLAMA_3_1_8B, { id: 'fp16', name: '', bytesPerParam: 2.0, description: '' }, 8192);
    expect(e.rangeGB.low).toBeLessThan(e.totalGB);
    expect(e.rangeGB.high).toBeGreaterThan(e.totalGB);
  });
});

describe('schema validation', () => {
  test('all models in models.json pass schema', async () => {
    const { ModelsSchema } = await import('./schema');
    const data = await import('../data/models.json');
    expect(() => ModelsSchema.parse(data.default)).not.toThrow();
  });
});
```

The `toBeCloseTo(x, n)` form asserts equality to `n` decimal places. Tolerances are tight (6–9 decimals) — these are exact arithmetic checks, not "in the ballpark."

## 10. Initial model list

`model-sources.json` ships with these models in v1. The fetch script fills in arch details from each `config.json`.

```
Llama 3.2 1B   (meta-llama/Llama-3.2-1B)
Llama 3.2 3B   (meta-llama/Llama-3.2-3B)
Llama 3.1 8B   (meta-llama/Llama-3.1-8B)
Llama 3.3 70B  (meta-llama/Llama-3.3-70B-Instruct)
Mistral 7B     (mistralai/Mistral-7B-v0.3)
Phi-3.5 mini   (microsoft/Phi-3.5-mini-instruct)   [override: attentionType=full]
Phi-4          (microsoft/phi-4)
Gemma 2 2B     (google/gemma-2-2b)                 [override: attentionType=mixed, slidingWindowSize=4096, fullAttentionRatio=0.5]
Gemma 2 9B     (google/gemma-2-9b)                 [same overrides]
Gemma 2 27B    (google/gemma-2-27b)                [same overrides]
Qwen 2.5 0.5B  (Qwen/Qwen2.5-0.5B)
Qwen 2.5 3B    (Qwen/Qwen2.5-3B)
Qwen 2.5 7B    (Qwen/Qwen2.5-7B)
Qwen 2.5 14B   (Qwen/Qwen2.5-14B)
Qwen 2.5 32B   (Qwen/Qwen2.5-32B)
Qwen 2.5 72B   (Qwen/Qwen2.5-72B)
DeepSeek-R1-Distill-Llama-8B   (deepseek-ai/DeepSeek-R1-Distill-Llama-8B)
DeepSeek-R1-Distill-Qwen-14B   (deepseek-ai/DeepSeek-R1-Distill-Qwen-14B)
DeepSeek-R1-Distill-Qwen-32B   (deepseek-ai/DeepSeek-R1-Distill-Qwen-32B)
DeepSeek-R1-Distill-Llama-70B  (deepseek-ai/DeepSeek-R1-Distill-Llama-70B)
```

Param counts come from the model card (entered as `params` in sources). Everything else comes from the fetch step.

MoE models (Mixtral, DeepSeek V3, Qwen3-MoE) are explicitly v2 — they need work for active vs. total params and (for DeepSeek V3) MLA attention math.

## 11. UI

One screen. Three controls at top, sorted model list below. That's it.

### 11.1 Layout

```
┌─────────────────────────────────────────────────────┐
│  LLM RAM Calculator              [methodology] [GH] │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┬──────────────┬──────────────┐    │
│  │ RAM          │ Context      │ Quantization │    │
│  │ [16 ▼] GB    │ [8192 ▼] tok │ [Q4_K_M  ▼]  │    │
│  └──────────────┴──────────────┴──────────────┘    │
├─────────────────────────────────────────────────────┤
│  18 of 20 models fit                                │
│                                                     │
│  Llama 3.2 1B          0.6–0.8 GB    ████░░░░  ✓   │
│  Qwen 2.5 0.5B         0.4–0.5 GB    ██░░░░░░  ✓   │
│  Llama 3.1 8B          5.7–7.2 GB    █████░░░  ✓   │
│  Gemma 2 9B            6.8–8.6 GB    ██████░░  ✓   │
│  ...                                                │
│  Llama 3.3 70B        45.0–56.4 GB   ████████  ✗   │
│                                                     │
│  Each row clickable → expands to show breakdown    │
│  (weights / KV cache / overhead) and notes         │
└─────────────────────────────────────────────────────┘
```

### 11.2 Controls

- **RAM:** number input + slider, range 1–1024 GB, integer step
- **Context length:** number input + slider, log scale, range 512–1,000,000, snap to common values (512, 1K, 2K, 4K, 8K, 16K, 32K, 64K, 128K, 256K, 512K, 1M)
- **Quantization:** dropdown of `QUANT_LEVELS`

No localStorage in v1. State resets on reload.

### 11.3 Model row

Display: name, estimated range (e.g., "5.7–7.2 GB"), bar (width = `total/RAM`, capped at 100%), status icon.

Status:
- ✓ green: `total ≤ RAM × 0.9`
- ⚠ amber: `RAM × 0.9 < total ≤ RAM`
- ✗ red: `total > RAM`

Click to expand: shows weights, KV cache, overhead components and any notes (e.g., "context clamped from 32K to 8K — model max").

### 11.4 Accessibility

- All controls keyboard-navigable
- Color is never the only signal (icons accompany color)
- Sufficient contrast in both light and dark mode
- `prefers-color-scheme` for theme; no toggle in v1

## 12. README

Must include:

1. One-paragraph description and screenshot
2. Live demo URL
3. **Methodology section** (full formulas, what's modeled, what isn't)
4. **Limitations section:**
   - Single-batch inference assumed
   - Framework overhead is approximate (0.5 GB)
   - Quant byte averages don't account for per-tensor variation
   - MLA attention (DeepSeek V3) and MoE not in v1
   - No multi-GPU sharding
5. **How to add a model** (step-by-step using the fetch script)
6. Local dev: install / dev / test / build
7. License (MIT)
8. Credits to existing tools that informed this one

## 13. Acceptance criteria

- [ ] `npm run fetch-models` produces a valid `models.json` for every entry in `model-sources.json`
- [ ] `npm test` passes with all tests in section 9
- [ ] All models in `models.json` validate against `ModelsSchema`
- [ ] App builds without warnings: `npm run build`
- [ ] App runs at `localhost:5173` in dev mode
- [ ] Manual smoke test: change RAM/context/quant, list re-sorts and badges update correctly
- [ ] Deployed to Vercel with public URL
- [ ] README sections 12.1–12.7 written

## 14. Order of work

1. Scaffold: Vite + React + TS + Tailwind + Vitest + zod
2. Write `types.ts` and `schema.ts`
3. Write `quants.ts`
4. Write `memory.ts` and `memory.test.ts` — make tests pass first (TDD)
5. Write `fetch-models.ts`; populate `model-sources.json` with 3 models; verify generated `models.json` passes schema
6. Build minimal UI: Controls + ModelList + ModelRow (no styling)
7. Style with Tailwind
8. Add expand-on-click breakdown
9. Add remaining models to `model-sources.json`, regenerate
10. Write README
11. Deploy to Vercel

## 15. Out of scope (explicitly v2 or later)

- MoE models (need active vs. total params, expert routing)
- DeepSeek V3 MLA attention (different KV math)
- Comparison view (pin multiple configs side-by-side)
- localStorage persistence
- Filters / search (only useful at 50+ models)
- Tokens-per-second estimates
- Training memory
- Multi-GPU sharding
- LoRA adapter sizing
- Live HuggingFace lookup of arbitrary repos
- Per-framework overhead profiles (llama.cpp vs vLLM vs transformers)
