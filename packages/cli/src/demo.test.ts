import { describe, expect, it } from 'vitest';
import { analyze } from '@marinate/engine';
import type { Catalog, InputFile, RuleSet } from '@marinate/engine';
import { renderReport } from './render.js';

/**
 * The canonical demo output (PLAN.md §18): "the marketing screenshot is a test
 * artifact, not marketing copy." This renders a fixed demo repo against a FIXED demo
 * catalog (so it's deterministic regardless of live-data updates) and snapshots the
 * result. CI fails if rendering logic drifts — the screenshot can never lie about
 * what the tool actually does.
 */

const DEMO_CATALOG: Catalog = {
  version: '2026.07.24.demo',
  models: [
    {
      id: 'claude-3-5-sonnet-20241022', publisher: 'anthropic', aliases: [], family: 'sonnet',
      generation: 3.5, status: 'retired', successor: 'claude-sonnet-5',
      sources: ['https://platform.claude.com/docs/en/about-claude/model-deprecations'], verifiedAt: '2026-07-24',
    },
    {
      id: 'claude-sonnet-5', publisher: 'anthropic', aliases: [], family: 'sonnet',
      generation: 5, status: 'active', sources: ['https://platform.claude.com/docs'], verifiedAt: '2026-07-24',
    },
    {
      id: 'gemini-2.5-pro', publisher: 'google', aliases: [], family: 'gemini-pro',
      generation: 2.5, status: 'active', successor: 'gemini-3.0-pro',
      pricing: { inPerMTok: 5, outPerMTok: 15 },
      sources: ['https://ai.google.dev/gemini-api/docs/pricing'], verifiedAt: '2026-07-24',
    },
    {
      id: 'gemini-3.0-pro', publisher: 'google', aliases: [], family: 'gemini-pro',
      generation: 3, status: 'active', pricing: { inPerMTok: 3, outPerMTok: 9 },
      sources: ['https://ai.google.dev/gemini-api/docs/pricing'], verifiedAt: '2026-07-24',
    },
  ],
  floatingAliases: [
    {
      alias: 'opus', publisher: 'anthropic', currently: 'claude-opus-4-8',
      variantSuffixes: ['[1m]'], sources: ['https://code.claude.com/docs/en/model-config'], verifiedAt: '2026-07-24',
    },
  ],
};

const DEMO_FILES: InputFile[] = [
  { path: '.claude/settings.json', text: `{ "model": "opus[1m]" }` },
  { path: 'src/agent.py', text: `resp = client.messages.create(model="claude-3-5-sonnet-20241022")` },
  { path: 'src/classify.ts', text: `const MODEL = "gemini-2.5-pro";` },
];

const RULES: RuleSet = { version: 'demo', rules: [] };

describe('canonical demo output (CI fails on drift)', () => {
  it('renders the demo repo deterministically', () => {
    const report = analyze(DEMO_FILES, DEMO_CATALOG, RULES, {
      now: '2026-07-24T00:00:00.000Z',
      cliVersion: '0.1.0',
    });
    const rendered = renderReport(report, '0.1.0', '0.1.0');
    // Generated, never hand-written: run `vitest -u` to refill from a real render.
    // A human editing this by hand is a bug — the snapshot IS the marketing screenshot.
    expect(rendered).toMatchInlineSnapshot(`
      "🥩 marinate check — 3 files · 0 call sites · 3 references        data 2026.07.24.demo · cli 0.1.0

       ▲ BEHAVIOR    .claude/settings.json:1
            "opus[1m]" is a floating alias that currently resolves to claude-opus-4-8. Pin an explicit version so the deployed model can't change under you without a code edit.
            fix: Replace "opus" with an explicit version such as claude-opus-4-8.
            source: https://code.claude.com/docs/en/model-config · verified 2026-07-24

       ▲ REVIEW      src/agent.py:1
            claude-3-5-sonnet-20241022 is documented as retired; documented successor is claude-sonnet-5. Retirement handling varies by publisher and serving platform — some reject the request, others redirect to the successor and bill at its rate. Verify before relying on it.
            source: https://platform.claude.com/docs/en/about-claude/model-deprecations · verified 2026-07-24

       ● STALE       src/classify.ts:1
            gemini-2.5-pro is 1 generation behind (documented successor: gemini-3.0-pro). At a 3:1 input/output assumption, its published list rate is 1.67× gemini-3.0-pro's.
            source: https://ai.google.dev/gemini-api/docs/pricing · verified 2026-07-24

       2 behavior/review · 1 stale
      "
    `);
    // Hard invariant the demo must always prove: Increment 1 never emits BREAKS NOW.
    expect(rendered).not.toContain('BREAKS NOW');
    expect(report.summary.breaksNow).toBe(0);
  });
});
