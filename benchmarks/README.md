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

## Cloud GPU runs (orchestrated from local)

For GPUs you don't physically own (vast.ai, RunPod, Lambda, etc.), use
[`scripts/cloud-orchestrate.ts`](../scripts/cloud-orchestrate.ts) to drive
benches across N rented boxes from your laptop.

### Workflow

```sh
# 1. Spin up boxes on your provider of choice. Note host, port, user, ssh key.
# 2. Copy the manifest template and edit it.
cp scripts/cloud-targets.example.json scripts/cloud-targets.json
$EDITOR scripts/cloud-targets.json   # add your boxes, choose models

# 3. Orchestrate. (Run inside `tmux new -s orch ...` for multi-hour sweeps so
#    a laptop sleep / wifi drop doesn't kill it.)
npx tsx scripts/cloud-orchestrate.ts

# 4. On completion, import every box's CSV in one shot. Fixtures are keyed
#    by (model_id, gpu_id), so multi-box imports merge with no manual work.
npx tsx scripts/bench-import.ts cloud-results/*/results.csv

# 5. Verify the regression test stays green with the new fixtures.
npx vitest run src/lib/measurements.test.ts

# 6. Commit the new fixtures.
git add benchmarks/measurements/ && git commit -m '...'
```

### Manifest

`scripts/cloud-targets.json` has two arrays — **boxes** (where to run) and
**jobs** (what to run). Every box runs every job. Each job's `weight_quants`
is itself a sweep, so the unit of work per box is `(job × weight_quant)`.
`gpu_id` is auto-detected per box via [`detect-device.ts`](../scripts/detect-device.ts);
pin it on a box only if the auto-pick is wrong.

```jsonc
{
  "boxes": [
    {
      "name": "vast-3090",
      "host": "1.2.3.4",
      "port": 22,
      "user": "root",
      "ssh_key": "~/.ssh/vast",
    },
  ],
  "jobs": [
    {
      "model_id": "qwen3-6-27b",
      "hf_repo": "unsloth/Qwen3.6-27B-GGUF",
      "weight_quants": ["q8_0", "q4_k_m", "q2_k"],
    },
  ],
}
```

### Recommended model per GPU tier

The matrix only stresses the math when at least one config OOMs the GPU —
otherwise the upper memory band is never tested. Pick a model whose Q4_K_M
weights + full-context KV pressures the GPU's VRAM:

| GPU VRAM | Suggested `model_id`                      | Why                                                   |
| -------- | ----------------------------------------- | ----------------------------------------------------- |
| 8–12 GB  | `llama-3-1-8b`                            | ~5 GB weights; long-ctx KV pushes past 12 GB          |
| 16 GB    | `qwen3-14b`, `gemma-2-9b`                 | Mid-tier; pressures 16 GB at long context             |
| 24 GB    | `qwen3-6-27b`, `qwen3-32b`                | Validates the 24 GB sweet spot (3090, 4090, 7900 XTX) |
| 48 GB    | `llama-3-3-70b-instruct`                  | ~42 GB weights at Q4_K_M; tight fit                   |
| 80+ GB   | `kimi-k2-instruct` (MoE), `deepseek-v3-2` | Validates MoE active-params and MLA KV math at scale  |

Mismatched sizes are not pre-filtered (a 70B Q8_0 on a 12 GB card will OOM on
every config and produce no fixture rows — `bench-import.ts` drops them). The
orchestrator stays dumb so the math validation stays honest.

### Concurrency model

- **Across boxes: parallel.** All boxes run in their own promise concurrently.
- **Within a box: serial.** The GPU is the bottleneck; running two benches on
  one GPU thrashes VRAM and ruins both measurements.

### Per-box outputs

| Path                              | Contents                                             |
| --------------------------------- | ---------------------------------------------------- |
| `cloud-logs/<box>.log`            | Full rsync/ssh/bench stdout+stderr — the diagnostic. |
| `cloud-results/<box>/results.csv` | The bench's CSV, ready for `bench-import.ts`.        |

Both directories are gitignored. Only `benchmarks/measurements/*.json` (the
normalized fixtures) get committed.

### Per-provider notes

- **vast.ai** — community boxes from ~$0.20/hr for a 3090. A full matrix on a
  24 GB GPU is 60–90 min, so each fixture costs ~$0.30–0.60. Filter for
  "CUDA 12.x" + "Ubuntu 22.04".
- **RunPod** — pick a "PyTorch 2.x CUDA 12.x" template; same workflow.
- **Lambda / Paperspace** — any "CUDA 12.x" base image works.
- Anything with SSH and a CUDA 12.x base image will work — the orchestrator
  is provider-agnostic.

### Apple Silicon and AMD

`detect-device.ts` recognizes Apple Silicon (via `sysctl`) and AMD GPUs (via
`rocm-smi`), but `bench.sh` is currently CUDA-only. On those boxes the
orchestrator will fail at the bootstrap or bench step with a clear "TODO"
message. Adding Metal (Apple) and ROCm (AMD) build paths to `bench.sh` is the
obvious next step.
