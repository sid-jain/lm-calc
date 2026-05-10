#!/usr/bin/env tsx
/**
 * detect-device.ts — resolve the local hardware to a DEVICES id.
 *
 * Used by scripts/bench.sh when --gpu-id is omitted, and by
 * scripts/cloud-orchestrate.ts to ssh-detect each remote box without making
 * the user pin gpu_id in the manifest.
 *
 * Algorithm:
 *   1. Try Nvidia via nvidia-smi → match name + VRAM against the DEVICES table.
 *   2. Try Apple Silicon via sysctl, AMD via rocm-smi — currently both exit 3
 *      because bench.sh only supports CUDA today.
 *
 * On success, prints the matching DEVICES id to stdout, exit 0.
 * On failure, prints a diagnostic to stderr, exits non-zero.
 */
import { execFileSync } from 'node:child_process';
import { DEVICES } from '../src/lib/devices';

// Pattern table for Nvidia. Order matters — most specific first (e.g. "RTX 3090
// Ti" before "RTX 3090"). VRAM tiebreaks ambiguous patterns by tolerating ±1024 MiB
// of slack against nvidia-smi's reported total (drivers reserve some).
//
// Adding a new GPU: add a row here AND a matching entry to src/lib/devices.ts.
// The startup sanity-check below errors out if a referenced deviceId is missing.
const NVIDIA_PATTERNS: Array<{ pattern: RegExp; vramMib: number; deviceId: string }> = [
  { pattern: /rtx\s*3060/, vramMib: 12288, deviceId: 'rtx-3060-12gb' },
  { pattern: /rtx\s*3090\s*ti/, vramMib: 24576, deviceId: 'rtx-3090-ti' },
  { pattern: /rtx\s*3090/, vramMib: 24576, deviceId: 'rtx-3090' },
  { pattern: /rtx\s*4070\s*ti\s*super/, vramMib: 16384, deviceId: 'rtx-4070-ti-super' },
  { pattern: /rtx\s*4070\s*ti/, vramMib: 12288, deviceId: 'rtx-4070-ti' },
  { pattern: /rtx\s*4070/, vramMib: 12288, deviceId: 'rtx-4070' },
  { pattern: /rtx\s*4080\s*super/, vramMib: 16384, deviceId: 'rtx-4080-super' },
  { pattern: /rtx\s*4080/, vramMib: 16384, deviceId: 'rtx-4080' },
  { pattern: /rtx\s*4090/, vramMib: 24576, deviceId: 'rtx-4090' },
  { pattern: /rtx\s*5090/, vramMib: 32768, deviceId: 'rtx-5090' },
  { pattern: /rtx\s*5080/, vramMib: 16384, deviceId: 'rtx-5080' },
  { pattern: /rtx\s*5070\s*ti/, vramMib: 16384, deviceId: 'rtx-5070-ti' },
  { pattern: /rtx\s*6000\s*ada/, vramMib: 49152, deviceId: 'rtx-6000-ada' },
  { pattern: /rtx\s*a6000/, vramMib: 49152, deviceId: 'rtx-a6000' },
  { pattern: /a100.*80/, vramMib: 81920, deviceId: 'a100-80gb' },
  { pattern: /h100.*(sxm|hbm)/, vramMib: 81920, deviceId: 'h100-sxm' },
  { pattern: /h100.*pcie/, vramMib: 81920, deviceId: 'h100-pcie' },
  { pattern: /h100/, vramMib: 81920, deviceId: 'h100-sxm' }, // ambiguous → SXM is the typical cloud variant
  { pattern: /h200/, vramMib: 144384, deviceId: 'h200-sxm' },
];

// Sanity-check: every pattern must reference a real DEVICES id. Otherwise the
// pattern table has rotted away from src/lib/devices.ts and silently mismaps.
for (const { deviceId } of NVIDIA_PATTERNS) {
  if (!DEVICES.find((d) => d.id === deviceId)) {
    console.error(`detect-device.ts: pattern table references unknown deviceId "${deviceId}"`);
    process.exit(99);
  }
}

function tryQuery(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function detectNvidia(): string | null {
  const raw = tryQuery('nvidia-smi', [
    '--query-gpu=name,memory.total',
    '--format=csv,noheader,nounits',
  ]);
  if (!raw) return null;
  const firstLine = raw.split('\n')[0];
  const [name, vramStr] = firstLine.split(',').map((s) => s.trim());
  const vramMib = Number(vramStr);
  if (!name || !Number.isFinite(vramMib)) return null;

  const normalized = name.toLowerCase();
  for (const { pattern, vramMib: expected, deviceId } of NVIDIA_PATTERNS) {
    if (!pattern.test(normalized)) continue;
    if (Math.abs(vramMib - expected) > 1024) continue;
    return deviceId;
  }
  console.error(
    `detect-device.ts: nvidia-smi reports "${name}" (${vramMib} MiB) but no NVIDIA_PATTERNS row matched.`,
  );
  console.error(`Add a row to scripts/detect-device.ts and a DEVICES entry in src/lib/devices.ts.`);
  return null;
}

function detectAppleSilicon(): boolean {
  const brand = tryQuery('sysctl', ['-n', 'machdep.cpu.brand_string']);
  return !!brand && /Apple\s+M\d/i.test(brand);
}

function detectAmd(): boolean {
  return tryQuery('rocm-smi', ['--showproductname']) !== null;
}

function main(): void {
  const nv = detectNvidia();
  if (nv) {
    console.log(nv);
    return;
  }
  if (detectAppleSilicon()) {
    console.error(
      `detect-device.ts: Apple Silicon detected but bench.sh requires CUDA. Metal/MPS support is a TODO; pass --gpu-id manually if you have a workaround.`,
    );
    process.exit(3);
  }
  if (detectAmd()) {
    console.error(
      `detect-device.ts: AMD GPU detected but bench.sh requires CUDA. ROCm support is a TODO; pass --gpu-id manually if you have a workaround.`,
    );
    process.exit(3);
  }
  console.error(
    `detect-device.ts: no supported device detected. Pass --gpu-id explicitly (one of: ${DEVICES.map((d) => d.id).join(', ')}).`,
  );
  process.exit(1);
}

main();
