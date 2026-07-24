import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyze, ENGINE_VERSION } from './index.js';
import type { Catalog, RuleSet } from './types.js';

const EMPTY_CATALOG: Catalog = { version: 'test', models: [], floatingAliases: [] };
const EMPTY_RULES: RuleSet = { version: 'test', rules: [] };

const OPTIONS = { now: '2026-07-23T00:00:00.000Z', cliVersion: 'test' };

describe('analyze', () => {
  it('reports no findings when given no files', () => {
    const report = analyze([], EMPTY_CATALOG, EMPTY_RULES, OPTIONS);

    expect(report.findings).toEqual([]);
    expect(report.summary.breaksNow).toBe(0);
    expect(report.cliVersion).toBe('test');
    expect(report.scannedAt).toBe(OPTIONS.now);
  });

  it('counts the files it was given', () => {
    const report = analyze(
      [
        { path: 'a.ts', text: 'const x = 1;' },
        { path: 'b.py', text: 'x = 1' },
      ],
      EMPTY_CATALOG,
      EMPTY_RULES,
      OPTIONS,
    );

    expect(report.filesScanned).toBe(2);
  });

  it('is deterministic: identical input yields an identical report', () => {
    const files = [{ path: 'a.ts', text: 'const x = 1;' }];
    const first = analyze(files, EMPTY_CATALOG, EMPTY_RULES, OPTIONS);
    const second = analyze(files, EMPTY_CATALOG, EMPTY_RULES, OPTIONS);

    // durationMs is wall-clock and excluded deliberately.
    const { durationMs: _a, ...a } = first;
    const { durationMs: _b, ...b } = second;
    expect(a).toEqual(b);
  });

  it('exposes a version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('engine purity (PLAN.md §11)', () => {
  // The engine must never touch IO. This is enforced socially by review and
  // mechanically here: a source-level check that no Node builtin is imported.
  // Keeping the engine IO-free is what lets the same code run in a browser
  // playground and an MCP server later with no refactor.
  it('imports no node: builtins in engine sources', () => {
    const sources = ['./index.ts', './types.ts'];

    for (const relative of sources) {
      const path = fileURLToPath(new URL(relative, import.meta.url));
      const text = readFileSync(path, 'utf8');
      expect(text, `${relative} must not import node: builtins`).not.toMatch(
        /from\s+['"]node:/,
      );
    }
  });
});
