import { useState } from 'react';
import { Controls } from './components/Controls';
import { ModelList } from './components/ModelList';
import { models } from './lib/loadModels';
import { QUANT_LEVELS } from './lib/quants';
import { useTheme } from './lib/useTheme';

export function App(): JSX.Element {
  const [ramGB, setRamGB] = useState(16);
  const [contextLen, setContextLen] = useState(8192);
  const [quant, setQuant] = useState(QUANT_LEVELS.find((q) => q.id === 'q4_k_m')!);
  const { theme, toggle } = useTheme();

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
        open-weight LLMs — Llama, Qwen, Gemma, Mistral, Phi, DeepSeek — actually fit, with weights /
        KV cache / overhead breakdowns derived from each model's HuggingFace{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">config.json</code>.
      </p>

      <main>
        <Controls
          ramGB={ramGB}
          contextLen={contextLen}
          quant={quant}
          onRamGB={setRamGB}
          onContextLen={setContextLen}
          onQuant={setQuant}
        />

        <div className="mt-6">
          <ModelList models={models} quant={quant} contextLen={contextLen} ramGB={ramGB} />
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
            models (Gemma 2/3) use the sliding window for sliding layers.
          </li>
          <li>
            Single-batch inference assumed. No multi-GPU sharding. MLA (DeepSeek V3) and MoE
            active-vs-total accounting are out of scope for v1.
          </li>
          <li>
            Architecture data is fetched from each model's <code>config.json</code> on HuggingFace
            and validated by zod at build time.
          </li>
        </ul>
      </footer>
    </div>
  );
}
