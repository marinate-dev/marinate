#!/usr/bin/env node
/**
 * marinate — CLI entry point.
 *
 * Dependency policy: this is a tool people run against private repositories, so the
 * runtime dependency tree stays intentionally tiny and reviewable. Argument parsing
 * uses Node's built-in `util.parseArgs` rather than a package (PLAN.md §2 privacy,
 * §4 supply chain). The only runtime dependency is our own engine.
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { analyze, ENGINE_VERSION, explainRule } from '@marinate-audit/engine';
import type { FailOn, InputFile, SuppressionRule } from '@marinate-audit/engine';
import { walk } from './walk.js';
import { readStaged } from './staged.js';
import { loadCatalog, loadRules } from './data.js';
import { loadConfig, expiredSuppressions } from './config.js';
import { renderReport, shouldFail } from './render.js';
import { showPrivacyNoticeOnce } from './banner.js';

const CLI_VERSION = '0.1.0';

const FAIL_ON_VALUES: readonly FailOn[] = ['breaks', 'upgrade', 'behavior', 'stale', 'none'];

const HELP = `
  marinate ${CLI_VERSION} — find retired, stale, and upgrade-breaking AI model configs

  USAGE
    marinate check [path]        Scan a directory (default: current directory)

  OPTIONS
    --fail-on <level>            breaks | upgrade | behavior | stale | none  (default: breaks)
    --staged                     Scan the git index (for pre-commit hooks)
    --json                       Emit the machine-readable report on stdout
    --explain <RULE>             Print what a rule means (e.g. LC-STALE) and exit
    -h, --help                   Show this help
    -v, --version                Show version

  CONFIG
    marinate.config.json at the repo root may set failOn, ignore globs, and
    suppress[] (each suppression needs a reason). Command-line flags override it.

  EXIT CODES
    0  no findings at or above the threshold
    1  findings at or above the threshold
    2  execution or configuration error

  PRIVACY
    Marinate analyzes source locally. It does not upload source code, prompts,
    file paths, credentials, model configurations, or scan results.
`;

interface ExitError extends Error {
  readonly exitCode: number;
}

function fail(message: string, exitCode = 2): never {
  const error = new Error(message) as Error & { exitCode: number };
  error.exitCode = exitCode;
  throw error;
}

function isExitError(error: unknown): error is ExitError {
  return error instanceof Error && typeof (error as ExitError).exitCode === 'number';
}

/** Minimal glob match for config `ignore` (same semantics as engine suppression paths). */
function matchesAny(globs: readonly string[], file: string): boolean {
  for (const glob of globs) {
    const re = new RegExp(
      '^' +
        glob
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, ' ')
          .replace(/\*/g, '[^/]*')
          .replace(/ /g, '.*') +
        '$',
    );
    if (re.test(file)) return true;
  }
  return false;
}

interface CheckOptions {
  readonly failOn: FailOn;
  readonly json: boolean;
  readonly staged: boolean;
}

function runCheck(path: string, cli: Partial<CheckOptions>): number {
  const root = resolve(path);
  const config = loadConfig(root);

  // Precedence: CLI flag > config file > built-in default.
  const failOn: FailOn = cli.failOn ?? config.failOn ?? 'breaks';
  const json = cli.json ?? false;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Gather files (working tree or git index).
  let files: InputFile[];
  const warnings: string[] = [];
  if (cli.staged) {
    const staged = readStaged(root);
    files = staged.files;
    warnings.push(...staged.errors);
  } else {
    const walked = walk(root);
    files = walked.files;
    warnings.push(...walked.errors);
    if (walked.skippedLarge > 0) warnings.push(`skipped ${walked.skippedLarge} large/minified file(s)`);
  }

  // Apply config `ignore` globs.
  if (config.ignore && config.ignore.length > 0) {
    files = files.filter((f) => !matchesAny(config.ignore!, f.path));
  }

  const catalog = loadCatalog();
  const rules = loadRules();
  const suppress: SuppressionRule[] = [...(config.suppress ?? [])];

  const report = analyze(files, catalog, rules, { now, cliVersion: CLI_VERSION, suppress });

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    showPrivacyNoticeOnce((s) => process.stderr.write(s));
    process.stdout.write(renderReport(report, CLI_VERSION, ENGINE_VERSION));
    for (const w of warnings) process.stderr.write(`  note: ${w}\n`);
    for (const s of expiredSuppressions(config, today)) {
      process.stderr.write(`  warning: suppression for ${s.rule} expired ${s.expires} — it no longer hides anything\n`);
    }
  }

  return shouldFail(report, failOn) ? 1 : 0;
}

function main(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      'fail-on': { type: 'string' },
      staged: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      explain: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });

  if (values.version) {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }

  // --explain is a lookup, not a scan: print and exit.
  if (values.explain !== undefined) {
    const text = explainRule(values.explain);
    if (!text) fail(`unknown rule ${JSON.stringify(values.explain)}. Known rules: LC-RETIRED, LC-DEPRECATED, LC-STALE, LC-FLOATING, UNKNOWN-MODEL`);
    process.stdout.write(`\n${text}`);
    return 0;
  }

  if (values.help || positionals.length === 0) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const [command, ...rest] = positionals;

  const failOnRaw = values['fail-on'];
  if (failOnRaw !== undefined && !FAIL_ON_VALUES.includes(failOnRaw as FailOn)) {
    fail(`invalid --fail-on value ${JSON.stringify(failOnRaw)}; expected one of: ${FAIL_ON_VALUES.join(', ')}`);
  }

  switch (command) {
    case 'check':
      return runCheck(rest[0] ?? '.', {
        ...(failOnRaw !== undefined ? { failOn: failOnRaw as FailOn } : {}),
        json: values.json ?? false,
        staged: values.staged ?? false,
      });
    default:
      fail(`unknown command ${JSON.stringify(command)}. Run \`marinate --help\`.`);
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (isExitError(error)) {
    process.stderr.write(`marinate: ${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    process.stderr.write(`marinate: unexpected error: ${String(error)}\n`);
    process.exitCode = 2;
  }
}
