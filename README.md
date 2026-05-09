# <img src="public/favicon.svg" width="32" align="center" alt="" /> LM Calc

Which open-weight LLMs will actually run on your hardware, and at which quant? Tell the calculator your RAM, context length, minimum decode speed, and device — get back a ranked list of models, each at the highest-quality quantization that still fits. Fully client-side. No backend, no accounts, no sign-up.

## Use it

<https://lmcalc.app>

> **Status: alpha.** The math and [methodology](METHODOLOGY.md) are still being validated against real-world measurements. Predicted RAM and tok/s ranges should be treated as estimates, not guarantees. Reports of what you actually observe — especially when they disagree with the calculator — are the most useful contribution right now. See [Contributing](CONTRIBUTING.md#reporting-real-world-measurements).

## What it does

### Constraints (inputs)

| Control            | What it sets                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Available RAM**  | VRAM or unified-memory budget in GB                                                                                                                              |
| **Context length** | Required token context; models that don't support it are filtered out                                                                                            |
| **Min speed**      | Minimum acceptable decode rate (tok/s); models that can't reach it are filtered out                                                                              |
| **Weight quant**   | _Recommend best quant_ (default) lets the engine pick; selecting a specific quant locks every result to that quant                                               |
| **KV cache quant** | _Recommend best KV cache quant_ (default) enumerates every (weight, KV) pair and picks the lowest joint quality loss; selecting a specific value locks every row |
| **Device**         | Sets memory bandwidth used for speed estimation; pick from common Apple, Nvidia, and DDR presets or enter a custom GB/s value                                    |
| **Developers**     | Pill filter to include or exclude specific model families                                                                                                        |

### Results (outputs)

**Matched models** — ranked by a composite score that prefers higher quant quality, then higher speed, then larger parameter count. Each row shows:

- Recommended weight + KV cache quant badges (the highest-quality combo that satisfies all constraints)
- Memory range (weights + KV cache + overhead, ×0.95 – ×1.20 of point estimate)
- Decode speed range (×0.50 – ×0.85 of theoretical maximum)
- Click to expand: full memory breakdown, architectural details, HuggingFace link

**Filtered-out models** — collapsible section below the matches. Each filtered model shows all reasons that apply:

| Reason       | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| Needs ≥X GB  | Even the lowest-quality quant exceeds your RAM budget                   |
| Max Y tok/s  | Fits in RAM (or would, if budget were larger) but can't reach min speed |
| Max ZK ctx   | Model's maximum context is below your required context length           |
| Dev excluded | Filtered out by your developer selection                                |

RAM and speed failures are computed independently: a model can show both if it's too large _and_ too slow on your bandwidth.

## Methodology

See [METHODOLOGY.md](METHODOLOGY.md). It is also rendered directly in the app (click **Methodology** in the header).

## How to add a model

There are two flows. Use **A** when you already know the HuggingFace repo. Use **B** to sweep recent releases from tracked developers — and, for MoE models, to have `activeParams` filled in automatically.

### Flow A — hand-add a known model

```bash
# 1. Add an entry to scripts/model-sources.json. For most dense models,
#    just the repo is enough:
#      { "hfRepo": "Qwen/Qwen3.6-27B" }
#    For MoE, activeParams is required (see Optional overrides below):
#      { "hfRepo": "Qwen/Qwen3-30B-A3B", "activeParams": 3.3 }

# 2. Regenerate src/data/models.json from HuggingFace.
#    Reads config.json (architecture), safetensors metadata (exact param
#    count), and a small owner→developer map to fill in everything else.
npm run fetch-models

# 3. Verify the math fixtures still pass.
npm test

# 4. (Optional) eyeball the new row in the dev server.
npm run dev

# 5. Commit both files together.
git add scripts/model-sources.json src/data/models.json
git commit -m "Add <model name>"
```

### Flow B — discover recent releases

`npm run discover-models` lists recent text-generation models from the tracked developers (Meta, Alibaba, Google, Mistral, Microsoft, DeepSeek, Moonshot AI) that aren't in `model-sources.json` yet, with paste-ready JSON lines. Quantized variants (`-GGUF`, `-AWQ`, `-FP8`, etc.) and training-step checkpoints are filtered out. Default lookback is 30 days; override with `SINCE_DAYS=N`.

```bash
# Plain run — uses repo-name suffix heuristics (-A3B, -A22B) for MoE.
npm run discover-models

# With ANTHROPIC_API_KEY set, the script hands each MoE model's HF README
# to Haiku 4.5 to extract activeParams, so the emitted JSON is ready to
# paste with no manual lookup. This is the recommended path for MoE.
ANTHROPIC_API_KEY=sk-ant-... npm run discover-models

# Or have it append every candidate directly to model-sources.json.
ANTHROPIC_API_KEY=sk-ant-... npm run discover-models -- --write

# Then the same fetch / test / commit dance as Flow A:
npm run fetch-models && npm test
```

Without `ANTHROPIC_API_KEY`, anything the suffix heuristic can't infer gets `"activeParams": 0` as a placeholder. `npm run fetch-models` rejects 0 with a pointed error, so no entry silently lands with the wrong number — you'll just have to fill it in by hand from the model card.

### Optional overrides

Add any of these fields to the entry when auto-derivation can't cover the case:

```json
{ "hfRepo": "Qwen/Qwen3-30B-A3B", "activeParams": 3.3 }
```

| Override            | When you need it                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `activeParams`      | **Required for MoE.** Per-token active param count in billions. The script will refuse to proceed without it. |
| `configRepo`        | When `hfRepo` is gated. The script fetches `config.json` and safetensors metadata from this mirror instead.   |
| `developer`         | When the HF org slug isn't in the built-in map.                                                               |
| `attentionOverride` | Last-resort escape hatch when auto-detection picks the wrong attention type.                                  |

The displayed name is mechanically derived from the repo's tail (dashes → spaces, first letter capitalized). It is intentionally not curated — `Llama 3.3 70B Instruct` and `Gemma 3 27b pt` are what HuggingFace publishes, and that's what we show.

### What the script auto-detects

- **Attention type**: MLA (`kv_lora_rank` in config), hybrid-linear (`full_attention_interval`), Gemma-style mixed (`layer_types` / `sliding_window_pattern` / `model_type: gemma2`), and GQA/MQA/full from head counts. Phi-3.5's misleading `sliding_window` is correctly ignored.
- **MoE**: presence of `num_experts` / `num_local_experts` / `n_routed_experts` in config.
- **Parameter count**: HF API `safetensors.total` first; falls back to `model.safetensors.index.json` `metadata.total_size` divided by bytes-per-param from `torch_dtype`; final fallback is a HEAD on the single-shard `model.safetensors`.

### Gated repos

Some official repos (Meta, Google) require auth. Two ways to handle them:

- Set `HF_TOKEN=hf_...` (or `HUGGINGFACE_HUB_TOKEN`) before running `npm run fetch-models`.
- Or pass `"configRepo": "some-public/mirror"` in the object form — the script will fetch from the mirror while keeping `hfRepo` pointing at the canonical source.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # run unit tests
npm run build        # type-check + production bundle
npm run fetch-models # regenerate src/data/models.json from HuggingFace
npm run discover-models # list recent unlisted models from tracked developers
```

## License

MIT.

## Credits

Inspired by the various community LLM RAM calculators that came before. The goal here is to be more honest about what the math models and what it doesn't, by deriving everything from `config.json` and showing an explicit range rather than a single number.
