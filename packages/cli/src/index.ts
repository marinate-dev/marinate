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
import { analyze, ENGINE_VERSION } from '@marinate/engine';
import type { FailOn } from '@marinate/engine';
import { walk } from './walk.js';
import { loadCatalog, loadRules } from './data.js';
import { renderReport, shouldFail } from './render.js';

const CLI_VERSION = '0.1.0';

const FAIL_ON_VALUES: readonly FailOn[] = ['breaks', 'upgrade', 'behavior', 'stale', 'none'];

const HELP = `
  marinate ${CLI_VERSION} — find retired, stale, and upgrade-breaking AI model configs

  USAGE
    marinate check [path]        Scan a directory (default: current directory)

  OPTIONS
    --fail-on <level>            breaks | upgrade | behavior | stale | none  (default: breaks)
    --json                       Emit the machine-readable report on stdout
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

function runCheck(path: string, options: { failOn: FailOn; json: boolean }): number {
  const root = resolve(path);
  const { files, skippedLarge, errors } = walk(root);
  const catalog = loadCatalog();
  const rules = loadRules();

  const report = analyze(files, catalog, rules, {
    now: new Date().toISOString(),
    cliVersion: CLI_VERSION,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderReport(report, CLI_VERSION, ENGINE_VERSION));
    if (skippedLarge > 0) {
      process.stderr.write(`  (skipped ${skippedLarge} file(s) over 1 MB)\n`);
    }
    for (const err of errors) process.stderr.write(`  warning: ${err}\n`);
  }

  return shouldFail(report, options.failOn) ? 1 : 0;
}

function main(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      'fail-on': { type: 'string' },
      json: { type: 'boolean', default: false },
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
    fail(`invalid --fail-on value ${JSON.stringify(failOnRaw)}; expected one of: ${FAIL_ON_VALUES.join(', ')}`);
  }

  switch (command) {
    case 'check':
      return runCheck(rest[0] ?? '.', { failOn: failOnRaw as FailOn, json: values.json ?? false });
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
