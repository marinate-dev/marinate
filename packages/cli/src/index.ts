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
import { analyze, ENGINE_VERSION } from '@marinate/engine';
import type { Catalog, FailOn, RuleSet } from '@marinate/engine';

const CLI_VERSION = '0.0.0';

const FAIL_ON_VALUES: readonly FailOn[] = [
  'breaks',
  'upgrade',
  'behavior',
  'stale',
  'none',
];

const HELP = `
  marinate ${CLI_VERSION} — find retired, stale, and upgrade-breaking AI model configs

  USAGE
    marinate check [path]        Scan a directory (default: current directory)

  OPTIONS
    --target <MODEL_ID>          Also report what would break upgrading to this model
    --fail-on <level>            breaks | upgrade | behavior | stale | none  (default: breaks)
    --staged                     Scan the git index instead of the working tree
    --json                       Emit the machine-readable report on stdout
    --explain <RULE_OR_KEY>      Print the full text and sources for a rule or finding
    -h, --help                   Show this help
    -v, --version                Show version

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

/** M0 placeholder: real data lands bundled in M1 (PLAN.md §13). */
const EMPTY_CATALOG: Catalog = { version: 'unloaded', models: [], floatingAliases: [] };
const EMPTY_RULES: RuleSet = { version: 'unloaded', rules: [] };

function runCheck(path: string, options: { failOn: FailOn; json: boolean }): number {
  const report = analyze([], EMPTY_CATALOG, EMPTY_RULES, {
    now: new Date().toISOString(),
    cliVersion: CLI_VERSION,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    [
      `🥩 marinate ${CLI_VERSION}  ·  engine ${ENGINE_VERSION}  ·  data ${report.dataVersion}`,
      ``,
      `   Scaffold build — the scanner is not implemented yet, so this reports`,
      `   nothing rather than reporting something it has not verified.`,
      ``,
      `   target path : ${path}`,
      `   fail-on     : ${options.failOn}`,
      ``,
      `   Next: file discovery + model detection (M1).`,
      ``,
    ].join('\n'),
  );

  return 0;
}

function main(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      target: { type: 'string' },
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

  if (values.help || positionals.length === 0) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const [command, ...rest] = positionals;

  const failOnRaw = values['fail-on'] ?? 'breaks';
  if (!FAIL_ON_VALUES.includes(failOnRaw as FailOn)) {
    fail(
      `invalid --fail-on value ${JSON.stringify(failOnRaw)}; expected one of: ${FAIL_ON_VALUES.join(', ')}`,
    );
  }

  switch (command) {
    case 'check':
      return runCheck(rest[0] ?? '.', {
        failOn: failOnRaw as FailOn,
        json: values.json ?? false,
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
