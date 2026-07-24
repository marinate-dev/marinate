import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import type { Catalog, InputFile, RuleSet } from './types.js';

/**
 * Scale smoke test (PLAN.md §18 perf goal). Not a strict wall-clock assertion (that's
 * flaky in CI) — this proves analyze handles a large repo without error or pathological
 * blowup. Real repos in CP1 (worldmonitor, ~1,900 files) already ran fast; this pins
 * that the engine degrades linearly, not quadratically.
 */
const CATALOG: Catalog = {
  version: 't',
  models: [
    {
      id: 'gemini-2.5-pro', publisher: 'google', aliases: [], family: 'gemini-pro',
      generation: 2.5, status: 'deprecated', retiresAt: '2026-10-16', successor: 'gemini-3.0-pro',
      sources: ['https://x'], verifiedAt: '2026-07-24',
    },
    {
      id: 'gemini-3.0-pro', publisher: 'google', aliases: [], family: 'gemini-pro',
      generation: 3, status: 'active', sources: ['https://x'], verifiedAt: '2026-07-24',
    },
  ],
  floatingAliases: [],
};
const RULES: RuleSet = { version: 't', rules: [] };

describe('analyze at scale', () => {
  it('handles 2000 files with model references without error', () => {
    const files: InputFile[] = Array.from({ length: 2000 }, (_, i) => ({
      path: `src/mod-${i}.ts`,
      text: `const m = "gemini-2.5-pro";\n// filler line\nexport const x = ${i};`,
    }));
    const started = Date.now();
    const report = analyze(files, CATALOG, RULES, { now: '2026-07-24T00:00:00.000Z', cliVersion: 't' });
    const elapsed = Date.now() - started;

    expect(report.filesScanned).toBe(2000);
    expect(report.references).toBe(2000);
    // Each file's stale finding dedupes to one key (same rule+model, different file → 2000 keys).
    expect(report.findings.length).toBe(2000);
    // Generous ceiling — catches only a true quadratic regression, not CI jitter.
    expect(elapsed).toBeLessThan(5000);
  });
});
