# Catalog refresh — the procedure

The catalog is only worth anything while it is current. This is the whole loop,
for a person or for the weekly cloud routine ("Marinate catalog refresh"). Every
number in `data/catalog/*.json` must come from a live provider page you read
during the refresh, cited in that entry's `sources`, and stamped `verifiedAt`.
Never patch from memory, a changelog summary, or another catalog.

## 1. Find out what moved

```bash
node scripts/watch-sources.mjs        # which cited pages changed since the baseline
node scripts/check-models-api.mjs     # which served IDs the catalog does not know (needs provider keys)
```

Both exit 1 on drift by design. If both are clean, stop: no release.

## 2. Read the pages, then edit the data

For each provider with drift, read the live pages the catalog cites (Anthropic:
models overview, pricing, model deprecations, effort, prompt caching, release
notes, migration guide; Claude Code model-config for the `opus`/`sonnet`/`fable`
aliases) and apply only what the page says:

- **New model** → a new entry: `id`, `aliases` (the id itself, plus any documented
  alias), `family`, `generation`, `released`, `status: active`, `pricing`
  (base input/output per MTok — not batch, not cache), `capabilities`
  (`samplingParams`, `budgetTokens`, `adaptiveThinking`, `prefill`, `effort`
  levels, `cacheMinTokens`), `sources`, `verifiedAt`. Place it after the model
  it supersedes.
- **Superseded model** → `successor` on the old entry.
- **Deprecated / retired** → `status`, `retiresAt`, `successor` from the
  deprecations page. Retired means the publisher returns an error.
- **Price change** → `pricing`, and re-read the footnotes (introductory prices
  that became permanent, cache-read multipliers).
- **Floating alias moved** → `currently` in `floating-aliases.json`.
- Bump `data/version.json` to `YYYY.MM.DD.N` (N = 1 for the first release that day).
- Bump `packages/cli/package.json` `version` (patch): the bundled data ships
  with the CLI, and the version bump is what triggers publish-on-merge.

Things the schema cannot yet express (note them in the PR instead of inventing
fields): forced `tool_choice` support, whether thinking can be disabled,
context window and max output.

## 3. Prove it

```bash
pnpm test                                   # 73+ tests incl. the data invariants
pnpm build && node packages/cli/dist/index.js check tests/fixtures
node scripts/watch-sources.mjs --update     # accept the new baseline, only after the review
```

## 4. Open the PR

Branch `data/YYYY-MM-DD`, title `Data release YYYY.MM.DD.N: <what changed>`.
The body lists every changed value with the source URL and the sentence on the
page that supports it, plus the unknown IDs from the models-API check that were
NOT added and why. A reviewer must be able to check each number in under a
minute without leaving the PR.

## 5. After the merge

`.github/workflows/release.yml` publishes `marinate-audit` (and the engine, if
its version changed) to npm with provenance. It skips versions already on npm.
It needs, once, either npm trusted publishing linked to this repo and workflow,
or an `NPM_TOKEN` automation-token secret.
