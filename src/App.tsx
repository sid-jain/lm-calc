import { useEffect, useState } from 'react';
import { Controls } from './components/Controls';
import { ModelList } from './components/ModelList';
import { DEVICES } from './lib/devices';
import { models } from './lib/loadModels';
import { QUANT_LEVELS } from './lib/quants';
import { readParams, writeParams } from './lib/urlState';
import { useTheme } from './lib/useTheme';

const DEFAULT_RAM = 16;
const DEFAULT_CTX = 8192;
const DEFAULT_QUANT_ID = 'q4_k_m';
const DEFAULT_DEVICE_ID = 'apple-m3-pro';
const DEFAULT_BW = 150;

export function App(): JSX.Element {
  const [ramGB, setRamGB] = useState(DEFAULT_RAM);
  const [contextLen, setContextLen] = useState(DEFAULT_CTX);
  const [quant, setQuant] = useState(QUANT_LEVELS.find((q) => q.id === DEFAULT_QUANT_ID)!);
  const [device, setDevice] = useState(DEVICES.find((d) => d.id === DEFAULT_DEVICE_ID)!);
  const [customBandwidthGBps, setCustomBandwidthGBps] = useState(DEFAULT_BW);
  const { theme, toggle } = useTheme();

  // Hydrate from the URL after mount. The prerender runs in Node, so we render defaults
  // server-side and then snap to the URL-derived state once we hit the browser.
  useEffect(() => {
    const params = readParams();
    const ram = Number(params.get('ram'));
    if (Number.isFinite(ram) && ram > 0) setRamGB(ram);
    const ctx = Number(params.get('ctx'));
    if (Number.isFinite(ctx) && ctx > 0) setContextLen(ctx);
    const q = QUANT_LEVELS.find((x) => x.id === params.get('quant'));
    if (q) setQuant(q);
    const d = DEVICES.find((x) => x.id === params.get('device'));
    if (d) setDevice(d);
    const bw = Number(params.get('bw'));
    if (Number.isFinite(bw) && bw > 0) setCustomBandwidthGBps(bw);
  }, []);

  useEffect(() => {
    // Always write every key in scope so any populated URL is self-contained and
    // bookmark-stable across future default changes. Cold-visit URLs get auto-populated
    // on mount with the current defaults; if those defaults later change, existing
    // bookmarks still resolve to the values they captured.
    writeParams({
      ram: String(ramGB),
      ctx: String(contextLen),
      quant: quant.id,
      device: device.id,
      // bw is only meaningful when the device is "custom"; otherwise omit so flipping
      // device doesn't leave a stale bw value pinned in the URL.
      bw: device.id === 'custom' ? String(customBandwidthGBps) : null,
    });
  }, [ramGB, contextLen, quant, device, customBandwidthGBps]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-bold tracking-tight">LM Calc</h1>
          <span
            title="Pre-release — math, model list, and UI may all change"
            className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300"
          >
            v{__APP_VERSION__}
          </span>
        </div>
        <nav className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
          <a href="#methodology" className="hover:text-slate-900 dark:hover:text-slate-100">
            Methodology
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-slate-900 dark:hover:text-slate-100"
          >
            GitHub
          </a>
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 text-base text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
        </nav>
      </header>

      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Pick a RAM (or VRAM) budget, context length, and quantization. The list below shows which
        open-weight LLMs (Llama, Qwen, Gemma, Mistral, Phi, DeepSeek) actually fit, with weights /
        KV cache / overhead breakdowns derived from each model's HuggingFace{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">config.json</code>.
      </p>

      <main>
        <Controls
          ramGB={ramGB}
          contextLen={contextLen}
          quant={quant}
          device={device}
          customBandwidthGBps={customBandwidthGBps}
          onRamGB={setRamGB}
          onContextLen={setContextLen}
          onQuant={setQuant}
          onDevice={setDevice}
          onCustomBandwidth={setCustomBandwidthGBps}
        />

        <div className="mt-6">
          <ModelList
            models={models}
            quant={quant}
            contextLen={contextLen}
            ramGB={ramGB}
            bandwidthGBps={device.bandwidthGBps}
          />
        </div>
      </main>

      <footer
        id="methodology"
        className="mt-10 border-t border-slate-200 pt-6 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400"
      >
        <h2 className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
          Methodology
        </h2>
        <p className="mb-2">
          Total memory ≈ <em>weights</em> + <em>KV cache</em> + <em>0.5 GB framework overhead</em>.
          The displayed range applies a 0.95×–1.20× factor to the point estimate.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Weights</strong>: <code>params × bytesPerParam</code>. Quant byte averages come
            from llama.cpp; real GGUF sizes vary slightly per tensor.
          </li>
          <li>
            <strong>KV cache</strong>:{' '}
            <code>2 × kvHeads × headDim × ctx × 2 bytes × layers</code> at FP16. Mixed-attention
            models (Gemma 2/3) use the sliding window for sliding layers.{' '}
            <strong>MLA</strong> models (DeepSeek V3, Kimi K2, Moonlight) instead store a
            compressed latent and a small rope cache:{' '}
            <code>(kv_lora_rank + qk_rope_head_dim) × 2 bytes × layers × ctx</code>, ~30× smaller
            than naive GQA.
          </li>
          <li>
            <strong>MoE</strong> (Mixtral, Qwen 3 -A* variants): all experts must be loaded into
            memory, so weights use <em>total</em> params. Decode speed uses <em>active</em>
            params per token.
          </li>
          <li>
            <strong>Decode speed</strong>: single-batch token generation is bandwidth-bound.{' '}
            <code>tok/s ≈ bandwidth ÷ (active_weight_bytes + kv_bytes)</code>. The displayed range
            applies a 0.50–0.85× efficiency factor on top of the theoretical maximum to reflect
            real engine overhead. Prefill (prompt processing) is compute-bound and not modeled.
          </li>
          <li>Single-batch inference assumed. No multi-GPU sharding.</li>
          <li>
            Architecture data is fetched from each model's <code>config.json</code> on HuggingFace
            and validated by zod at build time.
          </li>
        </ul>
      </footer>
    </div>
  );
}
