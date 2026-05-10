#!/usr/bin/env bash
#
# bench.sh — VRAM and decode/prefill throughput benchmark for any model on any GPU
#
# Drives llama.cpp's llama-bench across a (context × KV-quant × depth) matrix and
# captures peak VRAM (via nvidia-smi sampler) plus pp/tg tok/s per depth.
#
# Output is a CSV with columns identifying the model, weight quant, GPU, and
# llama.cpp commit, so multiple runs can accumulate into one file. The CSV is
# the input to scripts/bench-import.ts, which promotes results into committed
# fixtures under benchmarks/measurements/ used by the regression test.
#
# Usage:
#   ./scripts/bench.sh \
#     --model-id qwen3-6-27b \
#     --hf-repo unsloth/Qwen3.6-27B-GGUF \
#     --weight-quant q4_k_m \
#     --gpu-id rtx-3090
#
# Required flags:
#   --model-id <id>        joins to src/data/models.json (.id)
#   --hf-repo <repo>       HuggingFace repo containing the GGUF
#   --weight-quant <id>    joins to src/lib/quants.ts (.id), e.g. q4_k_m, q8_0
#
# Optional flags:
#   --gpu-id <id>          joins to src/lib/devices.ts (.id). If omitted, auto-detected
#                          via scripts/detect-device.ts (nvidia-smi → DEVICES). Pin
#                          this if the auto-pick is wrong.
#   --file-glob <pat>      GGUF filename pattern (default: derived from weight-quant)
#   --workdir <dir>        default $HOME/lm-calc-bench
#   --gpu-index <n>        default 0
#   --gen-tokens <n>       default 128
#   --reps <n>             default 2
#   --timeout <s>          per-config safety net (default 1800)
#   --matrix <auto|path>   default auto (calls scripts/bench-matrix.ts)
#   --depths <csv>         decode-depth ladder (default 512,4096,16384,32768)
#   --python <path>        python interpreter with huggingface_hub installed
#                          (default: python3 from PATH). Use this to point at a
#                          conda/venv interpreter without shadowing the system
#                          C/C++ toolchain — putting a conda env on PATH breaks
#                          llama.cpp's cmake build because it picks up conda's ld.
#   --install-deps         opt-in: run apt-get / pip when prereqs missing
#
# Background-friendly:
#   nohup ./scripts/bench.sh --model-id ... > run.log 2>&1 &
#   tmux new -d -s bench './scripts/bench.sh --model-id ...'

set -euo pipefail

# ============================ Arg parsing ============================
MODEL_ID=""
HF_REPO=""
WEIGHT_QUANT=""
GPU_ID=""
FILE_GLOB=""
WORKDIR="${WORKDIR:-$HOME/lm-calc-bench}"
GPU_INDEX=0
GEN_TOKENS=128
REPS=2
PER_TEST_TIMEOUT=1800
MATRIX="auto"
INSTALL_DEPS=0
PYTHON="python3"

# Depths at which to measure decode speed (prefilled prompt sizes, in tokens). The
# realistic question for agentic workflows is "how fast does the model generate
# when context is N tokens deep?" — depth controls that.
DEPTHS="512,4096,16384,32768"

usage() {
  # Print everything between the second `#` line and the first non-comment line.
  # Avoids a fixed line range that drifts when the docs grow.
  awk '/^#!/ {next} /^#/ {sub(/^# ?/,""); print; next} {exit}' "$0"
  exit "${1:-1}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --model-id)      MODEL_ID="$2"; shift 2 ;;
    --hf-repo)       HF_REPO="$2"; shift 2 ;;
    --weight-quant)  WEIGHT_QUANT="$2"; shift 2 ;;
    --gpu-id)        GPU_ID="$2"; shift 2 ;;
    --file-glob)     FILE_GLOB="$2"; shift 2 ;;
    --workdir)       WORKDIR="$2"; shift 2 ;;
    --gpu-index)     GPU_INDEX="$2"; shift 2 ;;
    --gen-tokens)    GEN_TOKENS="$2"; shift 2 ;;
    --reps)          REPS="$2"; shift 2 ;;
    --timeout)       PER_TEST_TIMEOUT="$2"; shift 2 ;;
    --matrix)        MATRIX="$2"; shift 2 ;;
    --depths)        DEPTHS="$2"; shift 2 ;;
    --python)        PYTHON="$2"; shift 2 ;;
    --install-deps)  INSTALL_DEPS=1; shift ;;
    -h|--help)       usage 0 ;;
    *)               echo "Unknown arg: $1"; usage 1 ;;
  esac
done

for req in MODEL_ID HF_REPO WEIGHT_QUANT; do
  if [ -z "${!req}" ]; then
    echo "ERROR: --${req,,} is required (got empty)" | tr '_' '-'
    usage 1
  fi
done

# Derive file glob from weight quant if not given (q4_k_m -> *Q4_K_M*.gguf).
if [ -z "$FILE_GLOB" ]; then
  FILE_GLOB="*${WEIGHT_QUANT^^}*.gguf"
fi

# ============================ Validate IDs against the calculator's data ============================
# Resolve repo root by walking up from this script (scripts/bench.sh → repo root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

banner() { printf "\n========== %s ==========\n" "$*"; }

# Auto-detect --gpu-id if not given. Runs detect-device.ts which probes nvidia-smi
# (Apple Silicon and AMD are detected but currently exit non-zero since bench.sh
# is CUDA-only). Override with --gpu-id if the auto-pick is wrong.
if [ -z "$GPU_ID" ]; then
  banner "Auto-detecting GPU"
  GPU_ID=$(cd "$REPO_ROOT" && npx --no-install tsx scripts/detect-device.ts) || {
    echo "ERROR: --gpu-id auto-detection failed. Pass --gpu-id explicitly."
    exit 1
  }
  echo "  Detected: $GPU_ID"
fi

banner "Validating IDs against calculator data"

# IDs go in as positional args (not interpolated into a JS string), so a typo
# surfaces as a clear "Unknown X" message instead of a TS parse error.
VALIDATION="$(cd "$REPO_ROOT" && npx --no-install tsx scripts/validate-ids.ts \
  "$MODEL_ID" "$WEIGHT_QUANT" "$GPU_ID" 2>&1)" || { echo "$VALIDATION"; exit 2; }

MAX_CONTEXT="${VALIDATION#maxContext=}"
echo "  model-id:     $MODEL_ID (maxContext=$MAX_CONTEXT)"
echo "  weight-quant: $WEIGHT_QUANT"
echo "  gpu-id:       $GPU_ID"

# ============================ Setup ============================
mkdir -p "$WORKDIR"/{model,results,logs}
LOG_DIR="$WORKDIR/logs"
RESULTS_CSV="$WORKDIR/results/results.csv"
SUMMARY_TXT="$WORKDIR/results/summary.txt"

if [ -d /usr/local/cuda/bin ]; then
  export PATH="/usr/local/cuda/bin:$PATH"
fi

# ============================ Prereq check ============================
banner "Checking prerequisites"
MISSING=()
for cmd in git cmake make nvidia-smi python3 curl; do
  command -v "$cmd" &>/dev/null || MISSING+=("$cmd")
done

if [ ${#MISSING[@]} -gt 0 ]; then
  if [ "$INSTALL_DEPS" -eq 1 ]; then
    echo "Installing missing tools: ${MISSING[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y -qq git cmake build-essential python3-pip curl
  else
    echo "ERROR: missing tools: ${MISSING[*]}"
    echo "Re-run with --install-deps to apt-get them, or install manually."
    exit 1
  fi
fi

if ! command -v nvcc &>/dev/null; then
  echo "ERROR: nvcc (CUDA compiler) not found. This script requires CUDA."
  exit 1
fi

GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader -i "$GPU_INDEX" | head -1 | xargs)
GPU_VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits -i "$GPU_INDEX" | head -1 | xargs)
echo "GPU:  $GPU_NAME ($GPU_VRAM MiB total VRAM, index=$GPU_INDEX)"
echo "CUDA: $(nvcc --version | grep release | sed 's/.*release //;s/,.*//')"

# ============================ Build llama.cpp ============================
banner "Building llama.cpp (CUDA)"
LLAMA_DIR="$WORKDIR/llama.cpp"
LLAMA_BENCH="$LLAMA_DIR/build/bin/llama-bench"
BUILD_LOG="$LOG_DIR/build.log"

if [ -x "$LLAMA_BENCH" ]; then
  echo "Already built: $LLAMA_BENCH"
else
  if [ ! -d "$LLAMA_DIR" ]; then
    git clone --depth 1 https://github.com/ggerganov/llama.cpp "$LLAMA_DIR"
  fi
  pushd "$LLAMA_DIR" >/dev/null
  echo "Configure + build → $BUILD_LOG"
  cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release > "$BUILD_LOG" 2>&1
  cmake --build build --config Release -j "$(nproc)" --target llama-bench llama-cli >> "$BUILD_LOG" 2>&1
  popd >/dev/null
  echo "Built: $LLAMA_BENCH"
fi

# Capture llama.cpp commit so each row can be attributed to a specific build.
LLAMA_COMMIT=$(git -C "$LLAMA_DIR" rev-parse --short HEAD)
echo "llama.cpp: $LLAMA_COMMIT"

# ============================ Download model ============================
banner "Downloading model ($HF_REPO, glob=$FILE_GLOB)"
MODEL_DIR="$WORKDIR/model/$MODEL_ID/$WEIGHT_QUANT"
mkdir -p "$MODEL_DIR"

# shellcheck disable=SC2086
EXISTING=$(ls $MODEL_DIR/$FILE_GLOB 2>/dev/null | sort | head -1 || true)

if [ -n "$EXISTING" ]; then
  echo "Already present: $EXISTING"
else
  if ! "$PYTHON" -c 'import huggingface_hub' &>/dev/null; then
    if [ "$INSTALL_DEPS" -eq 1 ]; then
      "$PYTHON" -m pip install -q -U "huggingface_hub[cli]"
    else
      echo "ERROR: python module 'huggingface_hub' missing for interpreter $PYTHON."
      echo "Re-run with --install-deps, point --python at an interpreter that has it,"
      echo "or run: $PYTHON -m pip install 'huggingface_hub[cli]'"
      exit 1
    fi
  fi
  "$PYTHON" - <<PYEOF
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="$HF_REPO",
    allow_patterns=["$FILE_GLOB"],
    local_dir="$MODEL_DIR",
)
PYEOF
fi

# Pick the model file. For multi-shard GGUFs (named *-00001-of-NNNNN.gguf), pass
# the first shard — llama.cpp auto-loads the rest. For single-file, just pick it.
# shellcheck disable=SC2086
ALL_FILES=$(ls $MODEL_DIR/$FILE_GLOB 2>/dev/null | sort)
SHARD_ONE=$(echo "$ALL_FILES" | grep -E '00001-of-[0-9]+\.gguf$' | head -1 || true)
if [ -n "$SHARD_ONE" ]; then
  MODEL_FILE="$SHARD_ONE"
  echo "Multi-shard GGUF detected; using first shard: $MODEL_FILE"
else
  MODEL_FILE=$(echo "$ALL_FILES" | head -1)
fi
[ -n "$MODEL_FILE" ] || { echo "ERROR: no GGUF matched $FILE_GLOB in $MODEL_DIR"; exit 1; }
du -sh "$MODEL_DIR" | awk '{print "Model size on disk: "$1}'

# ============================ Resolve test matrix ============================
banner "Resolving test matrix"
MATRIX_JSON=""
if [ "$MATRIX" = "auto" ]; then
  MATRIX_JSON="$(cd "$REPO_ROOT" && npx --no-install tsx scripts/bench-matrix.ts "$MODEL_ID")"
else
  [ -f "$MATRIX" ] || { echo "ERROR: matrix file not found: $MATRIX"; exit 1; }
  MATRIX_JSON="$(cat "$MATRIX")"
fi

# Parse matrix JSON into a bash array of "ctx ctk ctv" strings via python.
mapfile -t TESTS < <(echo "$MATRIX_JSON" | "$PYTHON" -c '
import json, sys
for row in json.load(sys.stdin):
    print(row["ctx"], row["ctk"], row["ctv"])
')
[ ${#TESTS[@]} -gt 0 ] || { echo "ERROR: empty test matrix"; exit 1; }
echo "Matrix has ${#TESTS[@]} configs:"
for t in "${TESTS[@]}"; do echo "  $t"; done

# ============================ Benchmark loop ============================
banner "Running benchmark matrix (depths: $DEPTHS)"
TIMESTAMP=$(date -u +%FT%TZ)

# Append to CSV — write header only if file is new/empty so multiple runs accumulate.
if [ ! -s "$RESULTS_CSV" ]; then
  echo "timestamp,llama_cpp_commit,gpu_id,gpu_name,gpu_vram_mib,model_id,weight_quant_id,ctx,kv_quant_k,kv_quant_v,depth,status,peak_vram_mib,pp_tok_s,tg_tok_s,notes" > "$RESULTS_CSV"
fi

# Translate our internal KV-cache quant ids (matching src/lib/kvCacheQuants.ts) to
# llama.cpp's --cache-type names. Only fp16 differs ('fp16' here, 'f16' there);
# q8_0 / q4_0 match.
to_llama_kv() {
  case "$1" in
    fp16) echo "f16" ;;
    *)    echo "$1" ;;
  esac
}

run_one() {
  local ctx=$1 ctk=$2 ctv=$3
  local label
  label=$(printf "%s_%s_ctx%06d_%s_%s" "$MODEL_ID" "$WEIGHT_QUANT" "$ctx" "$ctk" "$ctv")
  local logfile="$LOG_DIR/${label}.log"
  local vramlog="$LOG_DIR/${label}.vram"

  # Filter depths to only those that fit (d + GEN_TOKENS <= ctx).
  local depths_csv=""
  IFS=',' read -ra DARR <<<"$DEPTHS"
  for d in "${DARR[@]}"; do
    if (( d + GEN_TOKENS <= ctx )); then
      depths_csv+="${depths_csv:+,}$d"
    fi
  done

  # Inject a near-max depth so llama-bench actually allocates the configured KV cache.
  # Without this, `ctx=131072` + depths={512..32K} would only allocate ~32K of KV — so
  # we'd never observe the OOM scenarios the matrix exists to verify.
  local max_depth=$((ctx - GEN_TOKENS))
  if (( max_depth > 0 )); then
    local need_max=1
    IFS=',' read -ra _existing <<<"$depths_csv"
    for d in "${_existing[@]}"; do
      if (( d >= max_depth )); then need_max=0; break; fi
    done
    if (( need_max )); then
      depths_csv+="${depths_csv:+,}$max_depth"
    fi
  fi

  if [ -z "$depths_csv" ]; then
    echo "  $label: no depths fit, skipping"
    return
  fi

  printf "  %s  (depths: %s)\n" "$label" "$depths_csv"

  # Background VRAM sampler @ 1 Hz on the chosen GPU.
  nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits \
    -i "$GPU_INDEX" -l 1 > "$vramlog" 2>/dev/null &
  local smipid=$!

  # -d (depth) produces separate pp/tg rows in CSV (one with n_prompt>0,n_gen=0;
  # one with n_prompt=0,n_gen>0), letting us report prefill speed and generation
  # speed at each depth independently. -fa 1 (flash attention) is REQUIRED for
  # quantized KV cache (q8_0/q4_0) and dramatically reduces attention scratch
  # memory at long ctx.
  local d_args=()
  IFS=',' read -ra DEPTHS_ARR <<<"$depths_csv"
  for d in "${DEPTHS_ARR[@]}"; do
    d_args+=("-d" "$d")
  done

  local exit_code=0
  set +e
  timeout "$PER_TEST_TIMEOUT" "$LLAMA_BENCH" \
    -m "$MODEL_FILE" \
    -ctk "$(to_llama_kv "$ctk")" \
    -ctv "$(to_llama_kv "$ctv")" \
    -fa 1 \
    -p 512 -n "$GEN_TOKENS" \
    "${d_args[@]}" \
    -ngl 999 \
    -r "$REPS" \
    --progress \
    -o csv \
    > "$logfile" 2>&1
  exit_code=$?
  set -e

  kill "$smipid" 2>/dev/null || true
  wait "$smipid" 2>/dev/null || true

  local peak_vram="N/A"
  if [ -s "$vramlog" ]; then
    peak_vram=$(sort -n "$vramlog" | tail -1)
  fi

  # Determine failure status for depths that produced no data. We do NOT bail
  # out here on nonzero exit_code — llama-bench can complete several depths
  # successfully and then fail on a later one (e.g. trying to allocate 128K
  # f16 KV cache). The successful-depth data is in the log; we want to keep it.
  local failure_status="OK" failure_notes=""
  if [ "$exit_code" -eq 124 ]; then
    failure_status="TIMEOUT"; failure_notes="exceeded ${PER_TEST_TIMEOUT}s"
  elif [ "$exit_code" -ne 0 ]; then
    if grep -qiE "out of memory|cudaMalloc|failed to allocate|ggml_backend_cuda|failed to create context" "$logfile"; then
      failure_status="OOM"
    else
      failure_status="ERROR"; failure_notes="exit=$exit_code"
    fi
  fi

  # Parse one row per depth from llama-bench CSV. Stderr (CUDA init, progress)
  # and stdout (CSV) are mixed in the log file, so we identify the header by
  # content match (`^build_commit,`), not by NR==1.
  #
  # llama-bench emits two rows per depth:
  #   pp row: n_prompt>0, n_gen=0  → prefill speed
  #   tg row: n_prompt=0, n_gen>0  → decode speed
  # extract_metric picks one of the two based on `kind` (pp|tg).
  extract_metric() {
    local kind=$1 depth=$2 file=$3
    awk -F, -v depth="$depth" -v kind="$kind" '
      /^build_commit,/ {
        for (i=1;i<=NF;i++) { h=$i; gsub(/"/,"",h)
          if (h=="n_prompt") np=i
          if (h=="n_gen")    ng=i
          if (h=="n_depth")  nd=i
          if (h=="avg_ts")   ts=i
        }
        next
      }
      np && /^"/ {
        p=$np; g=$ng; dd=$nd; v=$ts
        gsub(/"/,"",p); gsub(/"/,"",g); gsub(/"/,"",dd); gsub(/"/,"",v)
        if (dd+0!=depth) next
        if (kind=="pp" && p+0>0 && g+0==0) { print v; exit }
        if (kind=="tg" && p+0==0 && g+0>0) { print v; exit }
      }
    ' "$file"
  }

  local any_ok=0 any_failed=0
  for d in "${DEPTHS_ARR[@]}"; do
    local pp tg
    pp=$(extract_metric pp "$d" "$logfile")
    tg=$(extract_metric tg "$d" "$logfile")

    local prefix="$TIMESTAMP,$LLAMA_COMMIT,$GPU_ID,\"$GPU_NAME\",$GPU_VRAM,$MODEL_ID,$WEIGHT_QUANT,$ctx,$ctk,$ctv,$d"

    if [ -n "$pp" ] || [ -n "$tg" ]; then
      any_ok=1
      [ -z "$pp" ] && pp="N/A"
      [ -z "$tg" ] && tg="N/A"
      if [[ "$pp" =~ ^[0-9.]+$ ]]; then pp=$(printf "%.1f" "$pp"); fi
      if [[ "$tg" =~ ^[0-9.]+$ ]]; then tg=$(printf "%.1f" "$tg"); fi
      echo "$prefix,OK,$peak_vram,$pp,$tg," >> "$RESULTS_CSV"
      printf "    depth=%-6d  pp=%9s tok/s  tg=%9s tok/s\n" "$d" "$pp" "$tg"
    else
      any_failed=1
      local s="$failure_status" n="$failure_notes"
      if [ "$s" = "OK" ]; then s="ERROR"; n="no data parsed"; fi
      echo "$prefix,$s,$peak_vram,N/A,N/A,$n" >> "$RESULTS_CSV"
      printf "    depth=%-6d  -> %s\n" "$d" "$s"
    fi
  done

  if [ "$any_ok" -eq 1 ] && [ "$any_failed" -eq 1 ]; then
    printf "    [partial: some depths %s, others succeeded]\n" "$failure_status"
  fi

  sleep 5
}

for spec in "${TESTS[@]}"; do
  # shellcheck disable=SC2086
  run_one $spec
done

# ============================ Summary ============================
banner "Summary"
{
  echo "GPU:        $GPU_NAME ($GPU_VRAM MiB) [id=$GPU_ID]"
  echo "Model:      $MODEL_ID (file: $(basename "$MODEL_FILE"))"
  echo "Weight q:   $WEIGHT_QUANT"
  echo "llama.cpp:  $LLAMA_COMMIT"
  echo "Date:       $TIMESTAMP"
  echo
  column -t -s, "$RESULTS_CSV"
} | tee "$SUMMARY_TXT"

echo
echo "Done."
echo "  CSV:     $RESULTS_CSV"
echo "  Summary: $SUMMARY_TXT"
echo "  Logs:    $LOG_DIR/"
echo
echo "Next: promote successful rows into a regression fixture with"
echo "  npx tsx scripts/bench-import.ts \"$RESULTS_CSV\""
