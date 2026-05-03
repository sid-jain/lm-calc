# LLM RAM and Speed Calculator

A static web tool that answers: *"given my hardware, which open-weight LLMs can I actually run — and which quant should I use?"* Set your RAM budget, context length, minimum decode speed, and device; get back a ranked list of models, each at the highest-quality quantization that fits your constraints. No backend, no accounts.

## Live demo

<https://lmcalc.app>

## What it does

### Constraints (inputs)

| Control | What it sets |
|---|---|
| **Available RAM** | VRAM or unified-memory budget in GB |
| **Context length** | Required token context; models that don't support it are filtered out |
| **Min speed** | Minimum acceptable decode rate (tok/s); models that can't reach it are filtered out |
| **Quantization** | *Recommend best quant* (default) lets the engine pick; selecting a specific quant locks every result to that quant |
| **Device** | Sets memory bandwidth used for speed estimation; pick from common Apple, Nvidia, and DDR presets or enter a custom GB/s value |
| **Developers** | Pill filter to include or exclude specific model families |

### Results (outputs)

**Matched models** — ranked by a composite score that prefers higher quant quality, then higher speed, then larger parameter count. Each row shows:

- Recommended quant badge (the highest-quality quant that satisfies all constraints)
- Memory range (weights + KV cache + overhead, ×0.95 – ×1.20 of point estimate)
- Decode speed range (×0.50 – ×0.85 of theoretical maximum)
- Click to expand: full memory breakdown, architectural details, HuggingFace link

**Filtered-out models** — collapsible section below the matches. Each filtered model shows all reasons that apply, colour-coded:

| Colour | Reason | Meaning |
|---|---|---|
| Rose | Needs ≥X GB | Even the lowest-quality quant exceeds your RAM budget |
| Amber | Max Y tok/s | Fits in RAM (or would, if budget were larger) but can't reach min speed |
| Sky | Max ZK ctx | Model's maximum context is below your required context length |
| Slate | Dev excluded | Filtered out by your developer selection |

RAM and speed failures are computed independently: a model can show both if it's too large *and* too slow on your bandwidth.

## Methodology

See [METHODOLOGY.md](METHODOLOGY.md). It is also rendered directly in the app (click **Methodology** in the header).

## How to add a model

For most models, add an entry to [`scripts/model-sources.json`](scripts/model-sources.json) with just the HuggingFace repo:

```json
{ "hfRepo": "Qwen/Qwen3.6-27B" }
```

Then run `npm run fetch-models`. The script reads `config.json` (architecture), the safetensors metadata (exact parameter count), and a small owner→developer map to fill in everything else. The output lands in `src/data/models.json`. Run `npm test` to verify the math fixtures, then commit both files.

### Optional overrides

Add any of these fields to the entry when auto-derivation can't cover the case:

```json
{ "hfRepo": "Qwen/Qwen3-30B-A3B", "activeParams": 3.3 }
```

| Override | When you need it |
|---|---|
| `activeParams` | **Required for MoE.** Per-token active param count in billions. The script will refuse to proceed without it. |
| `configRepo` | When `hfRepo` is gated. The script fetches `config.json` and safetensors metadata from this mirror instead. |
| `developer` | When the HF org slug isn't in the built-in map. |
| `attentionOverride` | Last-resort escape hatch when auto-detection picks the wrong attention type. |

The displayed name is mechanically derived from the repo's tail (dashes → spaces, first letter capitalized). It is intentionally not curated — `Llama 3.3 70B Instruct` and `Gemma 3 27b pt` are what HuggingFace publishes, and that's what we show.

### What the script auto-detects

- **Attention type**: MLA (`kv_lora_rank` in config), hybrid-linear (`full_attention_interval`), Gemma-style mixed (`layer_types` / `sliding_window_pattern` / `model_type: gemma2`), and GQA/MQA/full from head counts. Phi-3.5's misleading `sliding_window` is correctly ignored.
- **MoE**: presence of `num_experts` / `num_local_experts` / `n_routed_experts` in config.
- **Parameter count**: HF API `safetensors.total` first; falls back to `model.safetensors.index.json` `metadata.total_size` divided by bytes-per-param from `torch_dtype`; final fallback is a HEAD on the single-shard `model.safetensors`.

### Discovering new releases

Run `npm run discover-models` to list recent text-generation models from the tracked developers (Meta, Alibaba, Google, Mistral, Microsoft, DeepSeek, Moonshot AI) that aren't in `model-sources.json` yet. The output is a list with paste-ready JSON lines. Pass `--write` (i.e. `npm run discover-models -- --write`) to append every candidate directly to the file. Default lookback is 30 days; override with `SINCE_DAYS=N`. Quantized variants (`-GGUF`, `-AWQ`, `-FP8`, etc.) and training-step checkpoints (`-12000`) are filtered out.

For MoE candidates, the script tries to fill `activeParams` automatically: first from the repo-name suffix (`-A3B`, `-A22B`), then by handing the model card README to Haiku 4.5 for extraction (requires `ANTHROPIC_API_KEY`). Anything it can't derive gets `"activeParams": 0` as a placeholder — `npm run fetch-models` rejects 0 with a pointed error, so no entry silently lands with the wrong number.

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
