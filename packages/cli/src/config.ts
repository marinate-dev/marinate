/**
 * marinate.config.json loading (PLAN.md §12).
 *
 * A repo can set defaults (fail threshold, ignore globs) and — importantly —
 * suppressions, so a team can accept one finding without disabling the whole check.
 * Command-line flags always override the file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FailOn, SuppressionRule } from '@marinate-audit/engine';

export interface MarinateConfig {
  readonly failOn?: FailOn;
  readonly ignore?: readonly string[];
  readonly target?: string;
  readonly suppress?: readonly SuppressionRule[];
}

const FAIL_ON_VALUES: readonly FailOn[] = ['breaks', 'upgrade', 'behavior', 'stale', 'none'];

function validateConfig(raw: unknown, path: string): MarinateConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${path}: expected a JSON object`);
  }
  const obj = raw as Record<string, unknown>;

  if (obj['failOn'] !== undefined && !FAIL_ON_VALUES.includes(obj['failOn'] as FailOn)) {
    throw new Error(`${path}: invalid "failOn" ${JSON.stringify(obj['failOn'])}`);
  }
  if (obj['ignore'] !== undefined && !Array.isArray(obj['ignore'])) {
    throw new Error(`${path}: "ignore" must be an array of globs`);
  }
  if (obj['suppress'] !== undefined) {
    if (!Array.isArray(obj['suppress'])) throw new Error(`${path}: "suppress" must be an array`);
    obj['suppress'].forEach((s, i) => {
      if (typeof s !== 'object' || s === null) throw new Error(`${path}: suppress[${i}] must be an object`);
      const sr = s as Record<string, unknown>;
      if (typeof sr['rule'] !== 'string') throw new Error(`${path}: suppress[${i}] needs a "rule"`);
      // A reason is required so suppressions carry accountability (PLAN §12).
      if (typeof sr['reason'] !== 'string' || sr['reason'] === '') {
        throw new Error(`${path}: suppress[${i}] (${String(sr['rule'])}) needs a non-empty "reason"`);
      }
    });
  }
  return obj as MarinateConfig;
}

/** Load marinate.config.json from a repo root, or return {} if absent. */
export function loadConfig(root: string): MarinateConfig {
  const path = join(root, 'marinate.config.json');
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`marinate.config.json: not valid JSON (${String(error)})`);
  }
  return validateConfig(parsed, 'marinate.config.json');
}

/** Warn about suppressions whose expiry has passed — they no longer hide anything. */
export function expiredSuppressions(config: MarinateConfig, today: string): SuppressionRule[] {
  return (config.suppress ?? []).filter(
    (s) => s.expires !== undefined && s.expires < today,
  );
}
