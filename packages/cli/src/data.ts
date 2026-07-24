/**
 * Bundled data loading (PLAN.md §13).
 *
 * Catalog and rules ship inside the package — the CLI makes no network request to
 * fetch them. Signed remote updates are a v1.1 feature; for the alpha, the data date
 * is the package version, which is the most reproducible option and removes the
 * entire fetch/cache/verify attack surface.
 *
 * Data lives in `data/` at the repo root and is copied next to the built CLI at
 * publish time. In development we resolve it relative to the source tree.
 */

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Catalog, CatalogEntry, FloatingAlias, RuleSet } from '@marinate-audit/engine';
import { assertValidCatalogFile, assertValidFloatingFile } from '@marinate-audit/engine';

const PUBLISHERS = ['anthropic', 'openai', 'google', 'xai', 'meta', 'mistral'] as const;

function dataRoot(override?: string): string {
  if (override) return override;
  // dist/ location when built, or src/ in dev; walk up to find the data/ dir.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'data'), // bundled beside dist
    join(here, '..', '..', '..', 'data'), // repo root from packages/cli/dist
    join(here, '..', '..', '..', '..', 'data'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'catalog'))) return c;
  }
  throw new Error('bundled data directory not found');
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function loadCatalog(override?: string): Catalog {
  const root = dataRoot(override);
  const models: CatalogEntry[] = [];
  for (const publisher of PUBLISHERS) {
    const path = join(root, 'catalog', `${publisher}.json`);
    if (!existsSync(path)) continue;
    const entries = readJson<unknown>(path);
    // Fail loudly and specifically on bad data, never a raw crash mid-scan.
    assertValidCatalogFile(entries, `catalog/${publisher}.json`);
    models.push(...entries);
  }

  const floatingPath = join(root, 'catalog', 'floating-aliases.json');
  let floatingAliases: FloatingAlias[] = [];
  if (existsSync(floatingPath)) {
    const parsed = readJson<unknown>(floatingPath);
    assertValidFloatingFile(parsed, 'catalog/floating-aliases.json');
    floatingAliases = parsed;
  }

  const versionPath = join(root, 'version.json');
  const version = existsSync(versionPath)
    ? readJson<{ version: string }>(versionPath).version
    : 'dev';

  return { version, models, floatingAliases };
}

export function loadRules(): RuleSet {
  // Increment 1 ships no parameter rules — lifecycle findings are engine-generic.
  return { version: loadCatalog().version, rules: [] };
}
