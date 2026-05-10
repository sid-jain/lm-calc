# Methodology

## Memory estimate

Total memory is the sum of three terms:

```
total = weights + kv_cache + framework_overhead
```

- **Weights** = `params × bytes_per_param` (quantization byte averages from llama.cpp). For MoE models (Mixtral, Qwen 3 -A\* variants) `params` is the **total** count — all experts must be in memory for inference.
- **KV cache** = `2 × kv_heads × head_dim × ctx × bytes_per_kv_element × layers`. The KV cache quant control sets `bytes_per_kv_element`: `FP16` = 2.0 (lossless), `Q8_0` = 1.0625 (~1.9× smaller, near-lossless), `Q4_0` = 0.5625 (~3.5× smaller, noticeable quality cost — especially on K). With **Recommend best KV cache quant** (the default), the recommender enumerates every `(weight, kv)` combination that fits and picks the lowest **joint quality loss** — using rough perplexity deltas from llama.cpp benchmarks (e.g. `Q4_K_M` weights + `Q8_0` KV ≈ 0.045 loss beats `Q3_K_M` weights + `FP16` KV ≈ 0.15, because the `Q4` → `Q3` weight cliff is much steeper than `FP16` → `Q8` KV). The chosen value is shown as a badge on each row. Engines like llama.cpp expose this via `--cache-type-k`/`--cache-type-v`.
  - Mixed-attention models (Gemma 2/3) use `min(ctx, sliding_window)` for sliding layers.
  - **MLA** models (DeepSeek V3, Kimi K2, Moonlight) store a compressed latent + small rope cache: `(kv_lora_rank + qk_rope_head_dim) × bytes_per_kv_element × layers × ctx` — typically ~30× smaller than naive GQA.
  - **Hybrid-linear** models (Qwen 3.6) interleave full-attention and linear-attention layers; only the full-attention layers contribute to the KV cache.
- **Framework overhead** = a flat 0.5 GB.

The displayed memory range is the point estimate scaled by **0.95× (low)** and **1.20× (high)** to reflect framework and per-tensor variability.

## Decode speed

Single-batch token generation is memory-bandwidth-bound:

```
tok/s ≈ bandwidth ÷ (active_weight_bytes + kv_bytes)
```

- For MoE, decode uses _active_ params per token (not total), so bandwidth is divided over far fewer bytes than the full weight size.
- The displayed range applies a **0.50–0.92× efficiency factor** to the theoretical maximum to reflect real engine overhead. The high end was raised from 0.85 to 0.92 after the first RTX 3060 measurements showed fp16-KV decode landed in 0.85–0.904.
- Prefill (prompt processing) is compute-bound and is not modeled here.

### Decode speed limits

The bandwidth-only formula assumes that once bytes arrive at the compute units, the matmul + attention math is "free." That holds when the cache is FP16 (no transformation between read and use), but breaks down for **quantized KV cache at high depth**:

- Q8_0 / Q4_0 KV stores values in 32-element blocks with an FP16 scale. Every read must dequantize: read int8/int4 → multiply by scale → cast to fp16 → use. That adds compute per byte, not modelled by the formula.
- At low depth this is invisible because weights dominate the byte count. Once KV bytes overtake weight bytes (depth ≳16K on a typical decoder), the dequant compute on the K/V tensors becomes the bottleneck instead of the bandwidth that delivered them.
- On low-bandwidth GPUs this hits earlier. RTX 3060 + Llama 3.1 8B + Q4_0 KV at depth 32K already runs at ~0.43 of the bandwidth-bound prediction; depth 130K runs at ~0.25.

The regression test in [src/lib/measurements.test.ts](src/lib/measurements.test.ts) skips the speed-band assertion when `kv_quant != fp16 AND depth > 16K` for this reason. The data is still committed in the fixtures — just not used to assert the calculator's bands. A future improvement to the formula would take `min(bandwidth_bound, compute_bound)`, with the compute term including dequant + attention FLOPS.

## Architecture data

All values (`hidden_size`, `num_hidden_layers`, `num_attention_heads`, `num_key_value_heads`, `head_dim`, `vocab_size`, `max_position_embeddings`, `tie_word_embeddings`, `sliding_window`) are fetched from each model's `config.json` on HuggingFace, validated against a zod schema at build time, and written to `src/data/models.json`. Bad data fails the build, not the runtime.

## Limitations

- **Single-batch inference** is assumed. No multi-GPU sharding.
- **Framework overhead** is approximated as a flat 0.5 GB. Real overhead varies by engine (llama.cpp, vLLM, MLX, Transformers).
- **Quant byte averages** are llama.cpp BPW values. Real GGUF sizes vary slightly because K-quants apply different bit widths to different tensors.
- **Prefill speed** (compute-bound, depends on FLOPS) isn't modeled. The displayed tok/s is decode-only.
- **MoE routing overhead** in real systems often re-reads experts due to routing variance. The 0.50× low end of the speed range accounts for this.
- **Per-engine differences** (llama.cpp vs vLLM vs MLX vs Transformers) are folded into the 0.50–0.85× efficiency band.
- **No activation memory** — negligible at batch size 1, but significant for larger batches or training.
