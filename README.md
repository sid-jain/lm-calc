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
- **kv_cache** = `2 × kv_heads × head_dim × ctx × 2 bytes × layers` at FP16. For mixed-attention models (Gemma 2/3) the sliding layers use `ctx_sliding = min(ctx, sliding_window)`. KV cache is per-attention-layer regardless of MoE. **MLA** models (DeepSeek V3, Kimi K2, Moonlight) instead store a compressed latent + small rope cache: `(kv_lora_rank + qk_rope_head_dim) × 2 bytes × layers × ctx` — typically ~30× smaller than naive GQA at the same dimensions.
- **framework_overhead** = a flat 0.5 GB.

The displayed memory range is the point estimate scaled by 0.95× (low) and 1.20× (high) to reflect framework / per-tensor variability.

### Decode speed

Single-batch token generation is bandwidth-bound:

```
tok/s ≈ memory_bandwidth ÷ (active_weight_bytes + kv_cache_bytes)
```

For dense models, `active_weight_bytes = params × bytes_per_param`. For MoE, only the active experts are read per token, so `params` is replaced by the model's `activeParams`. The displayed range applies a 0.50–0.85× efficiency factor to the theoretical maximum to reflect real engine overhead. Prefill (prompt processing) is compute-bound and not modeled.

All architecture data (`hidden_size`, `num_hidden_layers`, `num_attention_heads`, `num_key_value_heads`, `head_dim`, `vocab_size`, `max_position_embeddings`, `tie_word_embeddings`, `sliding_window`) comes directly from each model's `config.json` on HuggingFace. It is fetched by `scripts/fetch-models.ts`, validated against a zod schema, and written to `src/data/models.json`. Bad data fails the build, not the runtime.

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

1. Add an entry to [`scripts/model-sources.json`](scripts/model-sources.json):

   ```json
   {
     "id": "my-new-model",
     "displayName": "My New Model 7B",
     "family": "MyFamily",
     "developer": "MyCorp",
     "hfRepo": "mycorp/my-new-model-7b",
     "params": 7.0,
     "attentionOverride": null,
     "slidingWindowSize": null,
     "fullAttentionRatio": null,
     "isMoE": false,
     "activeParams": null
   }
   ```

   Set the override fields only when the architecture needs it:
   - Mixed attention (Gemma 2/3): `attentionOverride: "mixed"`, `slidingWindowSize`, `fullAttentionRatio`.
   - MoE (Mixtral, Qwen 3 -A*): `isMoE: true` and `activeParams` (in billions, the published per-token active count). Total `params` still drives the memory math.

2. Run `npm run fetch-models`. This pulls `config.json`, validates the schema, and rewrites `src/data/models.json`. If the schema fails it tells you exactly what's wrong.

3. Run `npm test` — verifies that the canonical math fixtures still match.

4. Commit both `model-sources.json` and the regenerated `models.json` and open a PR.

### Gated repos

Some official repos (Meta, Google) require auth. Two ways to handle them:

- Set `HF_TOKEN=hf_...` (or `HUGGINGFACE_HUB_TOKEN`) before running `npm run fetch-models`.
- Or set `"configRepo": "some-public/mirror"` in the source entry — the script will fetch the config from the mirror while keeping `hfRepo` pointing at the canonical source.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # run unit tests
npm run build        # type-check + production bundle
npm run fetch-models # regenerate src/data/models.json from HuggingFace
```

## License

MIT.

## Credits

Inspired by the various community LLM RAM calculators that came before. The goal here is to be more honest about what the math models and what it doesn't, by deriving everything from `config.json` and showing an explicit range rather than a single number.
