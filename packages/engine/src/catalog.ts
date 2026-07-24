/**
 * Catalog-derived findings (PLAN.md §16.1).
 *
 * These are engine-generic: they work for all six publishers with zero per-publisher
 * rules, because they only read the catalog. This is the entire value of Increment 1
 * and the founding hook ("your gemini-2.5 is two generations behind").
 *
 * None of these read request parameters, so none of them need an AST.
 */

import type {
  Catalog,
  CatalogEntry,
  FloatingAlias,
  ModelReference,
  Pricing,
  PriceContext,
} from './types.js';

/** Case-insensitive index over catalog IDs and their stable aliases. */
export interface CatalogIndex {
  readonly catalog: Catalog;
  entryFor(idOrAlias: string): CatalogEntry | undefined;
  floatingFor(raw: string): FloatingAlias | undefined;
}

export function indexCatalog(catalog: Catalog): CatalogIndex {
  const byId = new Map<string, CatalogEntry>();
  for (const entry of catalog.models) {
    byId.set(entry.id.toLowerCase(), entry);
    for (const alias of entry.aliases) byId.set(alias.toLowerCase(), entry);
  }

  const floating = new Map<string, FloatingAlias>();
  for (const fa of catalog.floatingAliases) {
    floating.set(fa.alias.toLowerCase(), fa);
  }

  return {
    catalog,
    entryFor(idOrAlias) {
      return byId.get(idOrAlias.toLowerCase());
    },
    floatingFor(raw) {
      // Strip a trailing variant suffix like "[1m]" before matching the alias.
      const base = raw.toLowerCase().replace(/\[[^\]]*\]$/, '');
      const direct = floating.get(base);
      if (direct) return direct;
      // Also try the last path segment for "publisher/alias" forms (LiteLLM-style).
      const slash = base.lastIndexOf('/');
      if (slash >= 0) return floating.get(base.slice(slash + 1));
      return undefined;
    },
  };
}

/** Blended list-rate ratio, (3·in + 1·out)/4. The 3:1 assumption is always disclosed. */
function blended(p: Pricing): number {
  return (3 * p.inPerMTok + p.outPerMTok) / 4;
}

/**
 * Build price context comparing an entry to its documented same-family successor.
 * Returns undefined unless both have pricing and the multiple is meaningful (>=1.25).
 * Never a claim about what anyone pays — only published list rates.
 */
export function priceContextFor(
  entry: CatalogEntry,
  index: CatalogIndex,
): PriceContext | undefined {
  if (!entry.successor || !entry.pricing) return undefined;
  const successor = index.entryFor(entry.successor);
  if (!successor?.pricing) return undefined;

  const multiple = blended(entry.pricing) / blended(successor.pricing);
  if (multiple < 1.25) return undefined;

  return {
    currentPricing: entry.pricing,
    successorPricing: successor.pricing,
    successorId: successor.id,
    blendedMultiple: Math.round(multiple * 100) / 100,
  };
}

/** How many documented successors lie between an entry and the newest in its chain. */
export function generationsBehind(entry: CatalogEntry, index: CatalogIndex): number {
  let count = 0;
  let current: CatalogEntry | undefined = entry;
  const seen = new Set<string>();
  while (current?.successor && !seen.has(current.id)) {
    seen.add(current.id);
    const next: CatalogEntry | undefined = index.entryFor(current.successor);
    if (!next) break;
    count += 1;
    current = next;
  }
  return count;
}

/** Resolve what a floating alias currently points at, if the catalog knows. */
export function resolveFloating(
  ref: ModelReference,
  index: CatalogIndex,
): { floating: FloatingAlias; current?: CatalogEntry } | undefined {
  const fa = index.floatingFor(ref.raw);
  if (!fa) return undefined;
  const current = index.entryFor(fa.currently);
  return current ? { floating: fa, current } : { floating: fa };
}
