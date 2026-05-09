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

## Releasing

Maintainers and agents: follow these steps exactly. The project is pre-1.0 alpha; every release is a GitHub pre-release.

### 1. Pick the version

We follow semver, scoped to the `0.x.y-alpha` line:

| Change                                                                | Bump                  |
| --------------------------------------------------------------------- | --------------------- |
| New user-visible feature, new control, methodology change             | **minor** (`0.X.0`)   |
| Bug fix, doc-only change, refactor, internal-only test additions      | **patch** (`0.x.Y`)   |
| Breaking change to the URL contract or to the public methodology math | minor; flag in commit |

When in doubt: if a user reading the release notes would care about it, bump minor.

### 2. Bump the version in source

Edit `package.json` (one occurrence) and `package-lock.json` (three occurrences — one top-level, one under `packages."".version`, plus the `name` block — `replace_all` works) to the new version. Then verify:

```bash
grep -n "\"version\":" package.json package-lock.json
# Should show only the new version, no stale references.
```

### 3. Commit, tag, push, release

The four steps run as three commands. The commit message is always `Bump to X.Y.Z-alpha`. The tag is annotated, prefixed with `v`, and matches the version exactly.

```bash
# Commit the bump (pre-commit hook runs format check + lint).
git add package.json package-lock.json
git commit -m "Bump to 0.7.0-alpha"

# Annotated tag, message identical to the tag name.
git tag -a v0.7.0-alpha -m "v0.7.0-alpha"

# Push commits + tag in one shot. The pre-push hook runs the full CI
# (format / lint / test / build) and refuses to push if anything fails.
git push --follow-tags

# Create the GitHub pre-release. Notes are auto-generated from commit
# messages since the previous tag — write good commit messages above.
gh release create v0.7.0-alpha --prerelease --generate-notes
```

### Don't

- Don't write custom release notes. `--generate-notes` reads from commit messages; if the notes look wrong, the commit messages were wrong.
- Don't create a release without a tag, or a tag without pushing it. `git push --follow-tags` enforces both.
- Don't drop the `--prerelease` flag until we're past 1.0. The "Latest" badge on GitHub Releases is reserved for stable.
- Don't skip hooks (`--no-verify`). If a hook fails, fix the underlying issue.

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
