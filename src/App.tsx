import { useState } from 'react';
import { Controls } from './components/Controls';
import { ModelList } from './components/ModelList';
import { models } from './lib/loadModels';
import { QUANT_LEVELS } from './lib/quants';

export function App(): JSX.Element {
  const [ramGB, setRamGB] = useState(16);
  const [contextLen, setContextLen] = useState(8192);
  const [quant, setQuant] = useState(QUANT_LEVELS.find((q) => q.id === 'q4_k_m')!);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight">LM Calc</h1>
        <nav className="flex gap-4 text-sm text-slate-600 dark:text-slate-400">
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
        </nav>
      </header>

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
