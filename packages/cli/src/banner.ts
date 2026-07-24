/**
 * First-run privacy notice (PLAN.md §2).
 *
 * We show the privacy posture once per machine, on stderr, so it never pollutes
 * `--json` output. A marker file records that it has been shown. This is the opposite
 * of hidden telemetry: we tell the user, up front, that nothing about their code
 * leaves the machine.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const NOTICE =
  'marinate analyzes source locally. It does not upload source code, prompts, file\n' +
  'paths, credentials, model configurations, or scan results. Catalog data ships inside\n' +
  'the package; the CLI makes no network requests of its own.';

function markerPath(): string {
  const base = process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache');
  return join(base, 'marinate', 'privacy-notice-shown');
}

/** Print the privacy notice once per machine. Safe to call every run. */
export function showPrivacyNoticeOnce(write: (s: string) => void): void {
  const marker = markerPath();
  if (existsSync(marker)) return;
  write(`\n${NOTICE}\n\n`);
  try {
    mkdirSync(join(marker, '..'), { recursive: true });
    writeFileSync(marker, `${new Date().toISOString()}\n`);
  } catch {
    // If we can't write the marker, showing the notice again next time is harmless.
  }
}
