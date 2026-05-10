#!/usr/bin/env bash
#
# cloud-bootstrap.sh — one-time setup on a freshly-rented CUDA box.
#
# scripts/cloud-orchestrate.ts copies this file up and runs it once per box,
# before sweeping the bench across (model × weight_quant) combos. Idempotent:
# safe to re-run on the same box.
#
# Cloud images run as root, so no sudo. Touch ~/.lm-calc-bootstrapped so the
# orchestrator can short-circuit on subsequent runs.

set -euo pipefail

if [ -f "$HOME/.lm-calc-bootstrapped" ]; then
  echo "already bootstrapped (delete ~/.lm-calc-bootstrapped to redo)"
  exit 0
fi

apt-get update -qq
apt-get install -y -qq \
  git cmake build-essential \
  python3 python3-pip \
  curl ca-certificates

# Node + npm: many CUDA images ship without them.
if ! command -v npm >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

# huggingface_hub: bench.sh's downloader. --break-system-packages because PEP 668
# images mark the system Python as externally-managed; on a disposable cloud
# box that's fine.
python3 -m pip install -q --break-system-packages "huggingface_hub[cli]"

touch "$HOME/.lm-calc-bootstrapped"
echo "bootstrap done"
