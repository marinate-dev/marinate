import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import type { Catalog, InputFile, RuleSet } from './types.js';

/**
 * Inline test catalog. Tests deliberately do NOT depend on the bundled live data —
 * the pipeline behavior is what's under test, not the current state of the world.
 */
const CATALOG: Catalog = {
  version: 'test-2026.07.23',
  models: [
    // A stale chain: gemini-2.5-pro → gemini-3.0-pro, both active, older is superseded.
    {
      id: 'gemini-2.5-pro',
      publisher: 'google',
      aliases: [],
      family: 'gemini-pro',
      generation: 2.5,
      status: 'active',
      successor: 'gemini-3.0-pro',
      pricing: { inPerMTok: 5, outPerMTok: 15 },
      sources: ['https://ai.google.dev/pricing'],
      verifiedAt: '2026-07-23',
    },
    {
      id: 'gemini-3.0-pro',
      publisher: 'google',
      aliases: [],
      family: 'gemini-pro',
      generation: 3.0,
      status: 'active',
      pricing: { inPerMTok: 3, outPerMTok: 9 },
      sources: ['https://ai.google.dev/pricing'],
      verifiedAt: '2026-07-23',
    },
    // A retired model.
    {
      id: 'claude-3-5-sonnet-20241022',
      publisher: 'anthropic',
      aliases: [],
      family: 'sonnet',
      generation: 3.5,
      status: 'retired',
      successor: 'claude-sonnet-5',
      sources: ['https://platform.claude.com/docs/models'],
      verifiedAt: '2026-07-23',
    },
    {
      id: 'claude-sonnet-5',
      publisher: 'anthropic',
      aliases: [],
      family: 'sonnet',
      generation: 5,
      status: 'active',
      sources: ['https://platform.claude.com/docs/models'],
      verifiedAt: '2026-07-23',
    },
    // A deprecated model with a retirement date.
    {
      id: 'gpt-4o-2024-05-13',
      publisher: 'openai',
      aliases: [],
      family: 'gpt-4o',
      generation: 4,
      status: 'deprecated',
      retiresAt: '2026-09-01',
      successor: 'gpt-5',
      sources: ['https://platform.openai.com/docs/deprecations'],
      verifiedAt: '2026-07-23',
    },
    {
      id: 'gpt-5',
      publisher: 'openai',
      aliases: [],
      family: 'gpt',
      generation: 5,
      status: 'active',
      sources: ['https://platform.openai.com/docs/models'],
      verifiedAt: '2026-07-23',
    },
  ],
  floatingAliases: [
    {
      alias: 'opus',
      publisher: 'anthropic',
      currently: 'claude-opus-4-8',
      movedAt: '2026-06-01',
      previously: 'claude-opus-4-7',
      variantSuffixes: ['[1m]'],
      sources: ['https://platform.claude.com/docs/models'],
      verifiedAt: '2026-07-23',
    },
  ],
};

const RULES: RuleSet = { version: 'test', rules: [] };
const OPTS = { now: '2026-07-23T12:00:00.000Z', cliVersion: 'test' };

function run(files: InputFile[]) {
  return analyze(files, CATALOG, RULES, OPTS);
}

describe('analyze — the founding use case', () => {
  it('flags a stale model with generations-behind and price context', () => {
    const report = run([{ path: 'src/classify.ts', text: `const m = "gemini-2.5-pro";` }]);
    const stale = report.findings.find((f) => f.rule === 'LC-STALE');
    expect(stale).toBeDefined();
    expect(stale!.severity).toBe('stale');
    expect(stale!.model).toBe('gemini-2.5-pro');
    expect(stale!.priceContext).toBeDefined();
    // blended current = (3*5+15)/4 = 7.5 ; successor = (3*3+9)/4 = 4.5 ; 7.5/4.5 = 1.67
    expect(stale!.priceContext!.blendedMultiple).toBeCloseTo(1.67, 1);
    expect(stale!.message).toContain('1 generation behind');
    expect(report.summary.stale).toBe(1);
  });
});

describe('analyze — severity floor for trust', () => {
  it('does NOT emit BREAKS NOW for a retired model found only as a bare reference', () => {
    // PLAN.md §3: with no proven call site, retirement is a review notice, not BREAKS NOW.
    const report = run([{ path: 'README.md', text: 'we used to use claude-3-5-sonnet-20241022' }]);
    const retired = report.findings.find((f) => f.rule === 'LC-RETIRED');
    expect(retired).toBeDefined();
    expect(retired!.severity).not.toBe('breaks_now');
    expect(retired!.severity).toBe('behavior_change');
    expect(retired!.downgraded).toBe(true);
    expect(report.summary.breaksNow).toBe(0);
  });
});

describe('analyze — deprecated', () => {
  it('surfaces the retirement deadline', () => {
    const report = run([{ path: 'x.py', text: `model="gpt-4o-2024-05-13"` }]);
    const dep = report.findings.find((f) => f.rule === 'LC-DEPRECATED');
    expect(dep).toBeDefined();
    expect(dep!.message).toContain('2026-09-01');
    expect(dep!.severity).toBe('stale');
  });
});

describe('analyze — floating aliases', () => {
  it('flags a bare-tier alias with variant suffix in agent config', () => {
    const report = run([{ path: '.claude/settings.json', text: `{ "model": "opus[1m]" }` }]);
    const floating = report.findings.find((f) => f.rule === 'LC-FLOATING');
    expect(floating).toBeDefined();
    expect(floating!.surface).toBe('agent-config');
    expect(floating!.message).toContain('claude-opus-4-8');
    expect(floating!.severity).toBe('behavior_change');
    expect(report.summary.breaksNow).toBe(0);
  });
});

describe('analyze — current models and unknowns', () => {
  it('says nothing about a current, non-superseded model', () => {
    const report = run([{ path: 'x.ts', text: `"claude-sonnet-5"` }]);
    expect(report.findings.filter((f) => f.severity !== 'unresolved')).toEqual([]);
  });

  it('marks a grammar-valid but uncatalogued model as unresolved, never breaking', () => {
    const report = run([{ path: 'x.ts', text: `"gpt-99-imaginary"` }]);
    const unknown = report.findings.find((f) => f.rule === 'UNKNOWN-MODEL');
    expect(unknown).toBeDefined();
    expect(unknown!.severity).toBe('unresolved');
    expect(report.summary.breaksNow).toBe(0);
  });
});

describe('analyze — suppression', () => {
  it('moves a matched finding into suppressed[] with its reason', () => {
    const report = analyze(
      [{ path: 'src/classify.ts', text: `"gemini-2.5-pro"` }],
      CATALOG,
      RULES,
      { ...OPTS, suppress: [{ rule: 'LC-STALE', path: 'src/**', reason: 'pinned intentionally' }] },
    );
    expect(report.findings.find((f) => f.rule === 'LC-STALE')).toBeUndefined();
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]!.reason).toBe('pinned intentionally');
    expect(report.summary.suppressed).toBe(1);
  });

  it('does NOT suppress when the suppression has expired (finding resurfaces)', () => {
    const report = analyze(
      [{ path: 'src/classify.ts', text: `"gemini-2.5-pro"` }],
      CATALOG,
      RULES,
      {
        ...OPTS,
        suppress: [{ rule: 'LC-STALE', path: 'src/**', reason: 'temporary', expires: '2026-01-01' }],
      },
    );
    expect(report.findings.find((f) => f.rule === 'LC-STALE')).toBeDefined();
    expect(report.suppressed).toHaveLength(0);
  });
});

describe('analyze — CP1 regressions (false positives that would kill trust)', () => {
  it('F1: a variable named o1 does NOT resolve to the deprecated o1 model', () => {
    const catalog: Catalog = {
      ...CATALOG,
      models: [
        ...CATALOG.models,
        {
          id: 'o1-2024-12-17', publisher: 'openai', aliases: ['o1'], family: 'o1',
          generation: 1, status: 'deprecated', retiresAt: '2026-10-23', successor: 'gpt-5',
          sources: ['https://developers.openai.com/api/docs/deprecations'], verifiedAt: '2026-07-23',
        },
      ],
    };
    const bare = analyze([{ path: 'src/telemetry.ts', text: `const o1 = readSensor();\no1.append(x);` }], catalog, RULES, OPTS);
    expect(bare.findings.filter((f) => f.rule !== 'unresolved')).not.toContainEqual(
      expect.objectContaining({ rule: 'LC-DEPRECATED' }),
    );
    expect(bare.summary.stale).toBe(0);
    // But a quoted "o1" IS a real pin and must still resolve.
    const quoted = analyze([{ path: 'src/x.ts', text: `model: "o1"` }], catalog, RULES, OPTS);
    expect(quoted.findings.find((f) => f.rule === 'LC-DEPRECATED')).toBeDefined();
  });

  it('F2: retirement message does not assert "no longer accessible"', () => {
    const report = run([{ path: 'x.py', text: `"claude-3-5-sonnet-20241022"` }]);
    const retired = report.findings.find((f) => f.rule === 'LC-RETIRED');
    expect(retired!.message).not.toContain('no longer accessible');
    expect(retired!.message.toLowerCase()).toContain('varies by publisher');
  });

  it('S5: a floating alias in unquoted prose does not fail --fail-on behavior', () => {
    const catalog: Catalog = {
      ...CATALOG,
      floatingAliases: [
        { alias: 'gpt-5.6', publisher: 'openai', currently: 'gpt-5.6-sol', sources: ['https://x'], verifiedAt: '2026-07-23' },
      ],
    };
    const report = analyze([{ path: 'CHANGELOG.md', text: `Swapped to gpt-5.6 after the benchmark.` }], catalog, RULES, OPTS);
    const floating = report.findings.find((f) => f.rule === 'LC-FLOATING');
    // Emitted (informative) but downgraded and NOT behavior-severity → can't fail CI at behavior.
    if (floating) {
      expect(floating.downgraded).toBe(true);
      expect(floating.severity).toBe('unresolved');
    }
    expect(report.summary.behaviorChange).toBe(0);
  });

  it('S6: floating alias surfaces its resolved target being deprecated/retiring', () => {
    const catalog: Catalog = {
      ...CATALOG,
      models: [
        ...CATALOG.models,
        {
          id: 'claude-opus-4-1-20250805', publisher: 'anthropic', aliases: [], family: 'opus',
          generation: 4.1, status: 'deprecated', retiresAt: '2026-08-05',
          sources: ['https://x'], verifiedAt: '2026-07-23',
        },
      ],
      floatingAliases: [
        { alias: 'claude-opus-4-1', publisher: 'anthropic', currently: 'claude-opus-4-1-20250805', sources: ['https://x'], verifiedAt: '2026-07-23' },
      ],
    };
    const report = analyze([{ path: '.claude/settings.json', text: `{ "model": "claude-opus-4-1" }` }], catalog, RULES, OPTS);
    const f = report.findings.find((x) => x.rule === 'LC-FLOATING')!;
    expect(f.message).toContain('2026-08-05');
    expect(f.message.toLowerCase()).toContain('retiring');
  });

  it('S7: price context never compares across families and never emits NaN/Infinity', () => {
    const catalog: Catalog = {
      version: 't',
      models: [
        { id: 'a', publisher: 'openai', aliases: [], family: 'famA', status: 'active', successor: 'b', pricing: { inPerMTok: 10, outPerMTok: 10 }, sources: ['x'], verifiedAt: '2026-07-23' },
        // cross-family successor with zero pricing — must NOT emit
        { id: 'b', publisher: 'openai', aliases: [], family: 'famB', status: 'active', pricing: { inPerMTok: 0, outPerMTok: 0 }, sources: ['x'], verifiedAt: '2026-07-23' },
      ],
      floatingAliases: [],
    };
    const report = analyze([{ path: 'x.ts', text: `"a"` }], catalog, RULES, OPTS);
    const stale = report.findings.find((f) => f.rule === 'LC-STALE');
    // 'a' is stale (has successor) but must carry NO price context (cross-family + zero price)
    expect(stale?.priceContext).toBeUndefined();
    const json = JSON.stringify(report);
    expect(json).not.toContain('NaN');
    expect(json).not.toContain('Infinity');
  });
});

describe('analyze — determinism & keys', () => {
  it('produces stable finding keys independent of surrounding text', () => {
    const a = run([{ path: 'x.ts', text: `"gemini-2.5-pro"` }]);
    const b = run([{ path: 'x.ts', text: `// a comment added above\n\n\n"gemini-2.5-pro"` }]);
    const ka = a.findings.find((f) => f.rule === 'LC-STALE')!.key;
    const kb = b.findings.find((f) => f.rule === 'LC-STALE')!.key;
    expect(ka).toBe(kb); // key is semantic, not offset-based
    expect(ka).toMatch(/^F-[a-z2-7]{10}$/);
  });
});
