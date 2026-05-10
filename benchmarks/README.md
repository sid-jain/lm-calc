# Benchmarks

This directory holds **measured ground truth** for the calculator's predictions.
The math in `src/lib/memory.ts` predicts memory and decode tok/s; the fixtures
under `measurements/` are real numbers captured by `llama-bench` on real GPUs.
The vitest suite [`src/lib/measurements.test.ts`](../src/lib/measurements.test.ts)
asserts that the bands the UI shows (memory ×0.95–1.20, decode ×0.50–0.85) still
bracket every measured sample. If a methodology change drifts the predictions
out of those bands, CI fails loudly.

## Fixture format

One file per `(model_id, gpu_id)` pair:

```
benchmarks/measurements/<model_id>__<gpu_id>.json
```

Schema:

```jsonc
{
  "model_id": "qwen3-6-27b", // joins to src/data/models.json .id
  "gpu_id": "rtx-3090", // joins to src/lib/devices.ts .id
  "llama_cpp_commit": "abc1234",
  "captured_at": "2026-05-09T12:34:56Z",
  "samples": [
    {
      "weight_quant_id": "q4_k_m", // joins to src/lib/quants.ts .id
      "kv_quant_id": "q8_0", // joins to src/lib/kvCacheQuants.ts .id
      "ctx": 32768, // configured context (drives KV alloc)
      "depth": 16384, // prefilled tokens at decode measurement
      "peak_vram_mib": 19840, // nvidia-smi sampler peak
      "pp_tok_s": 1820.0, // prefill speed at this depth
      "tg_tok_s": 38.4, // decode speed at this depth
    },
  ],
}
```

## Capturing a new measurement

The bench needs a CUDA-capable GPU and ~25 GB free disk per model.

```sh
# 1. Run the bench. Identifiers (--model-id, --weight-quant, --gpu-id) MUST
#    match ids that exist in the calculator's data — bench.sh validates them
#    up front and fails fast if not.
./scripts/bench.sh \
  --model-id qwen3-6-27b \
  --hf-repo unsloth/Qwen3.6-27B-GGUF \
  --weight-quant q4_k_m \
  --gpu-id rtx-3090

# 2. Promote the CSV into a fixture under benchmarks/measurements/.
npx tsx scripts/bench-import.ts ~/lm-calc-bench/results/results.csv

# 3. Verify the regression test still passes with the new fixture.
npx vitest run src/lib/measurements.test.ts
```

The import is idempotent — re-running replaces matching `(weight_quant, kv_quant, ctx, depth)`
samples instead of appending duplicates.

## Why measurements drive the math, not the other way round

The matrix generator [`scripts/bench-matrix.ts`](../scripts/bench-matrix.ts)
intentionally reads only `arch.maxContext` from `models.json` and the _ids_ of
the KV quants — never `bytesPerParam`, `bytesPerElement`, or `bandwidthGBps`.
This keeps the bench independent of the math under test, so the regression
fixture is genuine ground truth and not a self-fulfilling prophecy.

## Adding new GPUs / models

A new fixture just needs a successful `bench.sh` run on hardware that produces
matching `--gpu-id` and `--model-id`. No code changes; the test discovers
fixtures by globbing this directory.
