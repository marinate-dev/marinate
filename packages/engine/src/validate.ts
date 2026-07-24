/**
 * Data validation (PLAN.md §13).
 *
 * The catalog and rules are the source of truth for every finding, so malformed data
 * must fail loudly and specifically — never a raw TypeError mid-scan (CP1 cosmetic
 * finding), and never a silent wrong answer. This runs at load, before analysis.
 *
 * Pure: it validates already-parsed values and returns a list of problems. The CLI
 * decides what to do with them (refuse to run, in practice).
 */

import type { CatalogEntry, FloatingAlias } from './types.js';

const STATUSES = new Set(['active', 'deprecated', 'retired']);
const PUBLISHERS = new Set(['anthropic', 'openai', 'google', 'xai', 'meta', 'mistral']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate one catalog entry; returns human-readable problems (empty = valid). */
export function validateCatalogEntry(entry: unknown, where: string): string[] {
  const problems: string[] = [];
  if (!isObject(entry)) return [`${where}: entry is not an object`];

  if (typeof entry['id'] !== 'string' || entry['id'] === '') {
    problems.push(`${where}: missing or empty "id"`);
  }
  if (!PUBLISHERS.has(entry['publisher'] as string)) {
    problems.push(`${where} (${String(entry['id'])}): invalid publisher ${JSON.stringify(entry['publisher'])}`);
  }
  if (!STATUSES.has(entry['status'] as string)) {
    problems.push(`${where} (${String(entry['id'])}): invalid status ${JSON.stringify(entry['status'])}`);
  }
  if (!Array.isArray(entry['aliases'])) {
    problems.push(`${where} (${String(entry['id'])}): "aliases" must be an array`);
  }
  if (entry['pricing'] !== undefined) {
    const p = entry['pricing'];
    if (!isObject(p) || typeof p['inPerMTok'] !== 'number' || typeof p['outPerMTok'] !== 'number') {
      problems.push(`${where} (${String(entry['id'])}): "pricing" must have numeric inPerMTok/outPerMTok`);
    }
  }
  if (entry['status'] === 'deprecated' && entry['retiresAt'] !== undefined && typeof entry['retiresAt'] !== 'string') {
    problems.push(`${where} (${String(entry['id'])}): "retiresAt" must be a date string`);
  }
  if (!Array.isArray(entry['sources'])) {
    problems.push(`${where} (${String(entry['id'])}): "sources" must be an array`);
  }
  return problems;
}

export function validateFloatingAlias(fa: unknown, where: string): string[] {
  const problems: string[] = [];
  if (!isObject(fa)) return [`${where}: floating alias is not an object`];
  if (typeof fa['alias'] !== 'string' || fa['alias'] === '') {
    problems.push(`${where}: missing or empty "alias"`);
  }
  if (!PUBLISHERS.has(fa['publisher'] as string)) {
    problems.push(`${where} (${String(fa['alias'])}): invalid publisher`);
  }
  if (typeof fa['currently'] !== 'string' || fa['currently'] === '') {
    problems.push(`${where} (${String(fa['alias'])}): missing "currently"`);
  }
  return problems;
}

/** Validate a whole parsed catalog file (array of entries). Throws with all problems. */
export function assertValidCatalogFile(entries: unknown, file: string): asserts entries is CatalogEntry[] {
  if (!Array.isArray(entries)) throw new Error(`${file}: expected a JSON array of model entries`);
  const problems = entries.flatMap((e, i) => validateCatalogEntry(e, `${file}[${i}]`));
  if (problems.length > 0) {
    throw new Error(`invalid catalog data:\n  ${problems.join('\n  ')}`);
  }
}

export function assertValidFloatingFile(entries: unknown, file: string): asserts entries is FloatingAlias[] {
  if (!Array.isArray(entries)) throw new Error(`${file}: expected a JSON array of floating aliases`);
  const problems = entries.flatMap((e, i) => validateFloatingAlias(e, `${file}[${i}]`));
  if (problems.length > 0) {
    throw new Error(`invalid floating-alias data:\n  ${problems.join('\n  ')}`);
  }
}
