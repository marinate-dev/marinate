import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectReferences, isWordLikeModelToken } from '@marinate-audit/engine';
import type { CatalogEntry } from '@marinate-audit/engine';
import { loadCatalog } from './data.js';

/**
 * Data invariants — the SHIPPED catalog checked against ITSELF (PLAN.md §19).
 *
 * These exist because the 2026-07-24 pre-publish sweep proved that verifying the
 * catalog against live provider docs — the expensive, agent-driven pass — checks
 * exactly one axis and silently misses two others:
 *
 *   external truth   does the catalog match the docs?      → agent sweep, ~1M tokens
 *   internal consistency  does the catalog agree with itself?  → THIS FILE, free
 *   completeness     what is missing entirely?             → enumeration, not testable here
 *
 * The reachability check below found 5 real defects that the full doc sweep did not,
 * because no amount of reading provider docs tells you your own scanner can't match
 * the IDs you already wrote down. Every check here is a pure function over `data/`:
 * no network, no API keys, runs in milliseconds, and fails CI.
 *
 * Deliberately NOT here: "is this value current?" — that needs live docs and belongs
 * to the sweep. A green run here means the catalog is self-consistent, NOT that it is
 * up to date. Do not let it stand in for §19.
 */

/**
 * Load the repo-root `data/` explicitly, NOT whatever `loadCatalog()` resolves by
 * default. The default walks up looking for a `data/` dir and finds the gitignored
 * build artifact at `packages/cli/data` first — so without this override the suite
 * validates the last build's copy and silently passes on stale data. Same class of
 * build-order dependency the vitest alias in `vitest.config.ts` exists to remove.
 */
const DATA_ROOT = fileURLToPath(new URL('../../../data', import.meta.url));

const catalog = loadCatalog(DATA_ROOT);
const models = catalog.models;
const byId = new Map(models.map((m) => [m.id, m]));

/** All identifiers a user could plausibly pin for an entry. */
function identifiers(entry: CatalogEntry): string[] {
  return [entry.id, ...entry.aliases];
}

/**
 * Bare word-like tokens (`o1`, `o3`) are matched quoted-only, on purpose: CP1 finding
 * F1 showed that a free-text grammar for them resolved `const o1 = x` to a deprecated
 * OpenAI model. They are unreachable by the free-text pass BY DESIGN.
 */
function isIntentionallyQuotedOnly(ident: string): boolean {
  return isWordLikeModelToken(ident);
}

describe('catalog ↔ grammar reachability', () => {
  it('every catalog identifier is extractable by its own publisher grammar, in full', () => {
    const unreachable: string[] = [];

    for (const entry of models) {
      for (const ident of identifiers(entry)) {
        if (isIntentionallyQuotedOnly(ident)) continue;

        // Run the REAL detection path rather than re-declaring the regexes here —
        // a duplicated grammar in the test would drift from the one that ships.
        const refs = detectReferences({ path: 'probe.txt', text: `model = "${ident}"` });
        const exact = refs.find((r) => r.raw === ident && r.publisher === entry.publisher);

        if (!exact) {
          const got = refs.map((r) => `${r.publisher}:${r.raw}`).join(', ') || '(nothing)';
          unreachable.push(`${entry.publisher} ${ident} → extracted ${got}`);
        }
      }
    }

    // A catalog entry the scanner cannot match is dead data: perfectly correct,
    // permanently invisible. This is the check that caught the Mistral family.
    expect(unreachable, `unreachable catalog identifiers:\n  ${unreachable.join('\n  ')}`).toEqual(
      [],
    );
  });
});

describe('lifecycle invariants', () => {
  it('no entry is past its own retirement date while still marked active/deprecated', () => {
    // Uses a FIXED date, not `new Date()`: a clock-dependent test would start failing
    // on a day nobody touched the repo, and would make CI results irreproducible.
    // Bump this deliberately at each data release — that act IS the review.
    const asOf = '2026-10-15';

    const overdue = models
      .filter((m) => m.retiresAt && m.retiresAt < asOf && m.status !== 'retired')
      .map((m) => `${m.id}: retiresAt ${m.retiresAt} but status=${m.status}`);

    expect(overdue, `entries past retirement but not marked retired:\n  ${overdue.join('\n  ')}`)
      .toEqual([]);
  });

  it('every deprecated or retired entry names a successor', () => {
    // Without this, the tool reports "your model is dead" and offers nowhere to go —
    // which is worse than silence, because it burns the user's trust with no payoff.
    const orphaned = models
      .filter((m) => m.status !== 'active' && !m.successor)
      .map((m) => `${m.id} (${m.status})`);

    expect(orphaned, `dead entries with no successor:\n  ${orphaned.join('\n  ')}`).toEqual([]);
  });

  it('every successor points at an entry that actually exists', () => {
    // A dangling successor makes the tool contradict its own advice: it tells you to
    // migrate to an ID it cannot itself resolve.
    const dangling = models
      .filter((m) => m.successor && !byId.has(m.successor))
      .map((m) => `${m.id} → ${m.successor} (not in catalog)`);

    expect(dangling, `dangling successor targets:\n  ${dangling.join('\n  ')}`).toEqual([]);
  });

  it('no successor chain cycles', () => {
    const cyclic: string[] = [];
    for (const start of models) {
      const seen = new Set<string>([start.id]);
      let cur: string | undefined = start.successor;
      while (cur && byId.has(cur)) {
        if (seen.has(cur)) {
          cyclic.push(`${start.id} → … → ${cur}`);
          break;
        }
        seen.add(cur);
        cur = byId.get(cur)!.successor;
      }
    }
    expect(cyclic, `cyclic successor chains:\n  ${cyclic.join('\n  ')}`).toEqual([]);
  });
});

describe('provenance invariants', () => {
  it('every entry carries at least one source and a verifiedAt stamp', () => {
    // PLAN.md §3: only `documented` evidence may fail CI, and "documented" means a
    // source URL plus a date. An unsourced entry can never legitimately fail a build.
    const unsourced = models
      .filter((m) => !m.sources?.length || !m.verifiedAt)
      .map((m) => m.id);

    expect(unsourced, `entries missing sources/verifiedAt:\n  ${unsourced.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('no duplicate identifiers across the whole catalog', () => {
    // A duplicate id or alias makes catalog lookup order-dependent, which is how a
    // retired entry gets silently shadowed by an active one and the finding vanishes.
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const entry of models) {
      for (const ident of identifiers(entry)) {
        const prior = seen.get(ident);
        if (prior && prior !== entry.id) dupes.push(`${ident} claimed by both ${prior} and ${entry.id}`);
        else seen.set(ident, entry.id);
      }
    }
    expect(dupes, `duplicate identifiers:\n  ${dupes.join('\n  ')}`).toEqual([]);
  });
});

describe('floating alias invariants', () => {
  it('every floating alias resolves to a catalog entry', () => {
    // LC-FLOATING states "this currently resolves to X". If X isn't in the catalog we
    // print a claim we cannot substantiate.
    const dangling = catalog.floatingAliases
      .filter((a) => !byId.has(a.currently))
      .map((a) => `${a.alias} → ${a.currently} (not in catalog)`);

    expect(dangling, `floating aliases pointing nowhere:\n  ${dangling.join('\n  ')}`).toEqual([]);
  });

  it('no floating alias collides with a pinned catalog identifier', () => {
    // The two concepts are deliberately separate (PLAN.md §15): `aliases[]` never move,
    // floating aliases re-point. If a string is both, severity depends on lookup order.
    const collisions = catalog.floatingAliases
      .filter((a) => byId.has(a.alias))
      .map((a) => a.alias);

    expect(collisions, `alias is both floating and pinned:\n  ${collisions.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('a moved alias records where it moved from and when', () => {
    // The whole value of LC-FLOATING is "it changed on <date>". An alias with a
    // `previously` but no `movedAt` (or vice versa) renders an incomplete sentence.
    const half = catalog.floatingAliases
      .filter((a) => Boolean(a.previously) !== Boolean(a.movedAt))
      .map((a) => a.alias);

    expect(half, `aliases with half-recorded moves:\n  ${half.join('\n  ')}`).toEqual([]);
  });
});
