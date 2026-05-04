# Contributing

Thanks for taking a look. This is a small project with a narrow scope; the contributions that help most are new models, methodology corrections, and bug reports backed by concrete numbers.

## Adding a model

See [How to add a model](README.md#how-to-add-a-model) in the README. The short version: add an entry to [`scripts/model-sources.json`](scripts/model-sources.json), run `npm run fetch-models`, run `npm test`, and commit both `scripts/model-sources.json` and `src/data/models.json` in the same PR.

For MoE models, the recommended path is `npm run discover-models` with `ANTHROPIC_API_KEY` set - it fills `activeParams` automatically by reading the model card.

## Reporting real-world measurements

The project is in alpha and the math is still being validated against real hardware. **Reports of what you actually observe are the single most valuable contribution right now** - both when the numbers match and when they don't.

Open an issue with:

- The model id (or HuggingFace repo) and the quant you ran.
- The hardware (chip, RAM, OS) and runtime (llama.cpp, MLX, vLLM, Ollama, …).
- The constraints you set in the calculator (RAM, context, min tok/s, device).
- What the calculator predicted vs. what you measured (peak RSS / VRAM, sustained decode tok/s at the context length you tested).

Matches are useful too - they're how the methodology earns confidence. Don't only file when something's broken.

## Code changes

```bash
npm install
npm run dev          # http://localhost:5173
npm test
npm run lint
npm run build        # type-check + production bundle (must pass)
```

All four commands must pass before you open a PR. No CLA.

## Scope

Welcome:

- New models, model metadata fixes.
- Methodology corrections (with a citation or repro).
- Bug fixes.
- Small UI improvements.

Please open an issue first for:

- Larger UI rewrites.
- New input controls or output columns.
- Changes to the scoring / ranking logic.
