# Marinate

**Finds retired, stale, and upgrade-breaking AI model configurations before they reach production.**

Model IDs and request parameters are spreading across application code, config files, and AI frameworks — and almost nobody re-checks a pin after writing it. Meanwhile releases ship every few weeks across Anthropic, OpenAI, Google, xAI, and Mistral. Repos silently end up stale (a documented successor exists, often better *and* cheaper at published rates), broken on upgrade (parameters that are now documented-rejected, tool versions that must change in pairs, retired model IDs), or silently degraded (cache minimums move and caching turns off with no error).

Provider migration tools stop at their own ecosystem. **Marinate is one neutral, local compatibility check across providers and repositories.**

```bash
npx marinate-audit check
```

> **Status: public alpha.** Lifecycle findings across five providers — retired, deprecated, superseded and floating-alias model pins, with the documented source and date behind every finding. Parameter rules ("this will break when you upgrade") are the next increment and are deliberately not shipped yet.
>
> What it does **not** claim: which model is best for your task, what you're actually paying, or that a cross-provider swap is safe. Every finding cites a provider doc and the date it was checked.

## Privacy

Marinate analyzes source locally. It does not upload source code, prompts, file paths, credentials, model configurations, or scan results. Catalog and rule data ship bundled inside the package — the CLI makes no network requests of its own.

## How Marinate compares

Several open-source tools now check model IDs against retirement dates. Pick the one that fits. Each line below is taken from the project's own README or listing, read on 2026-10-15.

| Tool | What it offers that Marinate doesn't |
|---|---|
| [llm-sunset](https://github.com/Ashveil1/llm-sunset) | Checks against a daily-updated list of official notices; SARIF output for GitHub code scanning; `fix` rewrites IDs; also covers Groq and Cohere |
| [Sunset](https://github.com/AppliedBenchmark/sunset) | Quotes each provider's official dates from a remote registry; covers Bedrock, Azure deployments, Vertex AI, and OpenRouter / Vercel AI Gateway slugs; PR comments |
| [LLM Status](https://llmstatus.ai/) (`mm`) | Registry of 16 providers updated every 6 hours with signed snapshots; `mm fix`; a GitHub App that fails PRs and can open a fix PR; RSS and JSON feeds |
| [LLM Model Deprecation Check](https://github.com/marketplace/actions/llm-model-deprecation-check) | GitHub Action backed by a hosted data repository, with replacement suggestions |
| [Chowkidar](https://github.com/bhav09/chowkidar) | Also audits environment variables, GitHub Secrets and cloud secret stores; Slack and Discord alerts before a sunset |
| [tracking-llm-discontinued](https://github.com/Baseline-quebec/tracking-llm-discontinued) | Composite Action that opens a GitHub issue per deprecated model |
| [model-eol](https://github.com/thossullivan/model-eol) | Proposes a machine-readable deprecation feed format, with sourced feeds for six providers, a PR-diff gate and SBOM output |

Where Marinate differs:

- **Agent and tool configs.** It reads `.claude/settings.json` and `.claude/agents/*.md` frontmatter, and tracks floating aliases such as Claude Code's `opus`, `sonnet` and `haiku`: what each resolves to today and when it last moved.
- **No network at scan time.** The catalog ships inside the package, so a scan is offline and repeatable. The trade-off: findings are only as current as the version you installed, while several tools above fetch a fresher registry.
- **Price context.** When a documented successor exists, the finding says whether it costs more or less at published list rates.
- **Data that checks itself.** CI fails on a retirement date that has passed, a successor with no entry, or a catalogued ID the scanner can't match.

Not yet: parameter rules, automatic fixes, SARIF, and providers beyond these five.

## Development

Requires Node ≥22 and pnpm.

```bash
pnpm install
pnpm build      # tsc project references, engine then cli
pnpm test       # vitest
pnpm typecheck

node packages/cli/dist/index.js check .
```

### Layout

| Path | Purpose |
|---|---|
| `packages/engine` | **Pure** analysis core — no filesystem, no network, no `process`. Enforced by a test. |
| `packages/cli` | `marinate` binary — walking, git index, rendering. Only package allowed Node APIs. |
| `data/` | Catalog + rules, bundled into the CLI at build time |
| `tests/fixtures/` | Regression corpus; also generates the canonical demo output |
| `.claude/agents/` | Model/effort routing for the build itself (PLAN.md §6.1) |

Engine purity is load-bearing: it keeps analysis deterministic and testable, and lets the same code later run in a browser playground or an MCP server with no refactor.

## License

MIT
