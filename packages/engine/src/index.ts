/**
 * @marinate/engine — pure analysis core.
 *
 * Hard constraint: this package must never import `node:fs`, `node:process`,
 * `node:net`, or perform any IO. Everything it needs arrives as arguments and
 * everything it produces is returned. That is what keeps analysis deterministic
 * and testable, and it is what lets the same code later run in a browser
 * playground or an MCP server with no refactor (PLAN.md §11).
 */

export * from './types.js';

import type {
  AnalyzeOptions,
  Catalog,
  InputFile,
  Report,
  RuleSet,
} from './types.js';

/** Engine version, reported for reproducibility. */
export const ENGINE_VERSION = '0.0.0';

/**
 * Analyze a set of files against a catalog and rule set.
 *
 * M0: scaffold only — returns an empty report rather than fabricating findings.
 * Discovery lands in M1/M2, rule evaluation in M3 (PLAN.md §6).
 */
export function analyze(
  files: readonly InputFile[],
  _catalog: Catalog,
  _rules: RuleSet,
  options: AnalyzeOptions,
): Report {
  const started = Date.now();

  return {
    scannedAt: options.now,
    durationMs: Date.now() - started,
    filesScanned: files.length,
    callSites: 0,
    references: 0,
    findings: [],
    suppressed: [],
    summary: {
      breaksNow: 0,
      upgradeBlocker: 0,
      behaviorChange: 0,
      stale: 0,
      unresolved: 0,
      suppressed: 0,
    },
    dataVersion: 'unloaded',
    cliVersion: options.cliVersion,
  };
}
