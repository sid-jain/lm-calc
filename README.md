# LLM RAM Calculator

A static web tool that takes available RAM, context length, quantization, and target hardware, and lists which open-weight LLMs fit and roughly how fast they decode (tokens per second). No backend, no accounts.

## Live demo

<https://lmcalc.app>

## What it shows

For each model, given your inputs:

- **Total memory estimate** (weights + KV cache + framework overhead) as a range, with a fit / tight / over-RAM bucket.
- **Decode tok/s estimate** for the chosen device's memory bandwidth, as a range.
- **Architecture detail** (params, layers, attention type, max context) on click.

## Methodology

Total memory is the sum of three terms:

```
total = weights + kv_cache + framework_overhead
```

- **weights** = `params × bytes_per_param` (quantization byte averages from llama.cpp). For MoE models (Mixtral, Qwen 3 -A* variants) `params` is the **total** count — all experts must be in memory for inference.
- **kv_cache** = `2 × kv_heads × head_dim × ctx × 2 bytes × layers` at FP16. For mixed-attention models (Gemma 2/3) the sliding layers use `ctx_sliding = min(ctx, sliding_window)`. KV cache is per-attention-layer regardless of MoE. **MLA** models (DeepSeek V3, Kimi K2, Moonlight) instead store a compressed latent + small rope cache: `(kv_lora_rank + qk_rope_head_dim) × 2 bytes × layers × ctx` — typically ~30× smaller than naive GQA at the same dimensions. **Hybrid-linear** models (Qwen 3.6) interleave full GQA with linear-attention layers (Gated DeltaNet); only the full-attention layers contribute to the KV cache, the linear-attention layers' constant-size recurrent state is folded into framework_overhead.
- **framework_overhead** = a flat 0.5 GB.

The displayed memory range is the point estimate scaled by 0.95× (low) and 1.20× (high) to reflect framework / per-tensor variability.

### Decode speed

Single-batch token generation is bandwidth-bound:

```
tok/s ≈ memory_bandwidth ÷ (active_weight_bytes + kv_cache_bytes)
```

For dense models, `active_weight_bytes = params × bytes_per_param`. For MoE, only the active experts are read per token, so `params` is replaced by the model's `activeParams`. The displayed range applies a 0.50–0.85× efficiency factor to the theoretical maximum to reflect real engine overhead. Prefill (prompt processing) is compute-bound and not modeled.

All architecture data (`hidden_size`, `num_hidden_layers`, `num_attention_heads`, `num_key_value_heads`, `head_dim`, `vocab_size`, `max_position_embeddings`, `tie_word_embeddings`, `sliding_window`) comes directly from each model's `config.json` on HuggingFace. The total parameter count comes from the HF API's safetensors metadata (or `model.safetensors.index.json` as a fallback). Both are fetched by `scripts/fetch-models.ts`, validated against a zod schema, and written to `src/data/models.json`. Bad data fails the build, not the runtime.

## Limitations

- **Single-batch inference** is assumed.
- **Framework overhead** is approximated as a flat 0.5 GB. Real overhead depends heavily on engine (llama.cpp vs vLLM vs transformers).
- **Quant byte averages** are llama.cpp published BPW values divided by 8. Real GGUF sizes vary slightly per model because K-quants apply different bit widths to different tensors.
- **Prefill speed** (compute-bound, depends on FLOPS) isn't modeled. The displayed tok/s is decode-only.
- **MoE routing overhead** in real systems often re-reads experts due to routing variance. The 0.50× low end of the speed range captures this; the high end is closer to dense behavior.
- **Per-engine differences** (llama.cpp vs vLLM vs MLX vs Transformers) are folded into the single 0.50–0.85× efficiency band.
- **No multi-GPU sharding** — totals assume the model lives in one place.
- **No activation memory** — negligible for inference at batch size 1, but real for larger batches / training.

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

Run `npm run discover-models` to list recent text-generation models from the tracked developers (Meta, Alibaba, Google, Mistral, Microsoft, DeepSeek, Moonshot AI) that aren't in `model-sources.json` yet. The output is a list with paste-ready JSON lines. Pass `--write` (i.e. `npm run discover-models -- --write`) to append every candidate directly to the file. Default lookback is 180 days; override with `SINCE_DAYS=N`. Quantized variants (`-GGUF`, `-AWQ`, `-FP8`, etc.) and training-step checkpoints (`-12000`) are filtered out.

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
