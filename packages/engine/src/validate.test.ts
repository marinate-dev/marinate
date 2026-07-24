import { describe, expect, it } from 'vitest';
import { assertValidCatalogFile, assertValidFloatingFile, validateCatalogEntry } from './validate.js';

describe('validateCatalogEntry', () => {
  const good = {
    id: 'x-1', publisher: 'openai', aliases: [], status: 'active',
    sources: ['https://x'], verifiedAt: '2026-07-24',
  };

  it('accepts a well-formed entry', () => {
    expect(validateCatalogEntry(good, 'f[0]')).toEqual([]);
  });

  it('rejects missing id, bad publisher, bad status', () => {
    expect(validateCatalogEntry({ ...good, id: '' }, 'f[0]').join()).toContain('id');
    expect(validateCatalogEntry({ ...good, publisher: 'nope' }, 'f[0]').join()).toContain('publisher');
    expect(validateCatalogEntry({ ...good, status: 'gone' }, 'f[0]').join()).toContain('status');
  });

  it('rejects non-numeric pricing', () => {
    const bad = { ...good, pricing: { inPerMTok: 'free', outPerMTok: 1 } };
    expect(validateCatalogEntry(bad, 'f[0]').join()).toContain('pricing');
  });
});

describe('assertValidCatalogFile', () => {
  it('throws a clear, aggregated error rather than a raw TypeError (CP1 finding)', () => {
    expect(() => assertValidCatalogFile([{ id: 'x' }], 'catalog/openai.json')).toThrow(
      /invalid catalog data/,
    );
  });
  it('throws when the top level is not an array', () => {
    expect(() => assertValidCatalogFile({ id: 'x' }, 'catalog/openai.json')).toThrow(/expected a JSON array/);
  });
  it('accepts a valid file', () => {
    expect(() =>
      assertValidCatalogFile(
        [{ id: 'a', publisher: 'meta', aliases: [], status: 'retired', sources: [], verifiedAt: '2026-07-24' }],
        'catalog/meta.json',
      ),
    ).not.toThrow();
  });
});

describe('assertValidFloatingFile', () => {
  it('requires alias, publisher, currently', () => {
    expect(() => assertValidFloatingFile([{ alias: 'opus' }], 'f')).toThrow(/invalid floating-alias data/);
  });
});
