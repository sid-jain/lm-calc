#!/usr/bin/env bash
#
# cloud-bootstrap.sh — one-time setup before the bench sweep.
#
# scripts/cloud-orchestrate.ts ssh's into every box (including the operator's
# own machine when a manifest entry has `local: true` → ssh to localhost) and
# runs this once. Idempotent: safe to re-run on the same box.
#
# Two modes, picked from $EUID:
#   - root  (cloud images): apt-get installs system deps, then creates the venv.
#   - user (local desktop): skips apt-get (would mess with the user's system
#     and need sudo); just verifies the required tools are already on PATH and
#     creates the venv. If a tool is missing, errors with a clear "install X"
#     message rather than guessing.
#
# The sentinel filename embeds an md5sum of THIS script, so editing the
# bootstrap auto-invalidates old sentinels and forces a re-run on existing
# boxes — no need to ssh in and `rm ~/.lm-calc-bootstrapped` by hand.

set -euo pipefail

SCRIPT_HASH=$(md5sum "$0" | awk '{print $1}')
SENTINEL="$HOME/.lm-calc-bootstrapped-${SCRIPT_HASH}"

if [ -f "$SENTINEL" ]; then
  echo "already bootstrapped at this script revision ($SCRIPT_HASH)"
  exit 0
fi
# Clear out sentinels from older script revisions so they don't accumulate.
rm -f "$HOME"/.lm-calc-bootstrapped-* 2>/dev/null || true

# Mirror bench.sh's PATH prepend so the nvcc check below finds the toolkit on
# local desktops where /usr/local/cuda/bin isn't on the non-interactive
# shell's PATH (common — only added by .bashrc on interactive logins).
if [ -d /usr/local/cuda/bin ]; then
  export PATH="/usr/local/cuda/bin:$PATH"
fi

if [ "$EUID" -eq 0 ]; then
  # Root: install system deps. Cloud CUDA images ship missing most of these.
  apt-get update -qq
  apt-get install -y -qq \
    git cmake build-essential \
    python3 python3-pip python3-venv \
    curl ca-certificates

  # Node + npm: many CUDA images ship without them.
  if ! command -v npm >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
  fi
else
  # Non-root: assume system deps are already installed. Verify and bail with a
  # helpful message if not — better than a confusing failure deep inside the
  # llama.cpp build.
  missing=()
  for cmd in git cmake make gcc g++ python3 npm nvcc nvidia-smi; do
    command -v "$cmd" >/dev/null || missing+=("$cmd")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "ERROR: bootstrap is running as a non-root user (assumed local box)."
    echo "       The following tools are required but not on PATH: ${missing[*]}"
    echo "       Install them with your package manager (e.g. on Ubuntu:"
    echo "         sudo apt install git cmake build-essential python3-venv nodejs npm"
    echo "       and CUDA from https://developer.nvidia.com/cuda-downloads), then re-run."
    exit 1
  fi
  # Verify python3 has venv support — typical breakage on Ubuntu where the
  # `python3-venv` package is separate from `python3` itself.
  if ! python3 -c 'import venv' 2>/dev/null; then
    echo "ERROR: python3 is missing the 'venv' module (Ubuntu: apt install python3-venv)."
    exit 1
  fi
fi

# Isolated venv for huggingface_hub (bench.sh's downloader) — keeps system Python
# untouched, works on any Ubuntu (no PEP 668 dance), and survives pip-version
# differences across cloud images. The orchestrator passes
# --python ~/lm-calc-venv/bin/python to bench.sh so it picks up this interpreter
# without us having to "activate" anything across non-interactive ssh sessions.
python3 -m venv "$HOME/lm-calc-venv"
"$HOME/lm-calc-venv/bin/pip" install -q -U "huggingface_hub[cli]"

touch "$SENTINEL"
echo "bootstrap done (sentinel: $SENTINEL)"
