# Marinate

**Finds retired, stale, and upgrade-breaking AI model configurations before they reach production.**

Model IDs and request parameters are spreading across application code, config files, and AI frameworks — and almost nobody re-checks a pin after writing it. Meanwhile releases ship every few weeks across Anthropic, OpenAI, Google, xAI, and Meta. Repos silently end up stale (a documented successor exists, often better *and* cheaper at published rates), broken on upgrade (parameters that are now documented-rejected, tool versions that must change in pairs, retired model IDs), or silently degraded (cache minimums move and caching turns off with no error).

Provider migration tools stop at their own ecosystem. **Marinate is one neutral, local compatibility check across providers and repositories.**

```bash
npx @marinate/cli check
```

> **Status: pre-alpha.** The scaffold builds and runs; the scanner lands in M1. See [`PLAN.md`](./PLAN.md) — strategy (Part I), engineering spec (Part II), and pitch (Part III) all live there.

## Privacy

Marinate analyzes source locally. It does not upload source code, prompts, file paths, credentials, model configurations, or scan results. Catalog and rule data ship bundled inside the package — the CLI makes no network requests of its own.

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
