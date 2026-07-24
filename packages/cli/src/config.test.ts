import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, expiredSuppressions } from './config.js';

const dirs: string[] = [];
function repoWith(config: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'marinate-cfg-'));
  dirs.push(root);
  if (config !== null) writeFileSync(join(root, 'marinate.config.json'), config);
  return root;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns {} when no config file exists', () => {
    expect(loadConfig(repoWith(null))).toEqual({});
  });

  it('loads failOn, ignore, and suppress', () => {
    const cfg = loadConfig(
      repoWith('{"failOn":"stale","ignore":["dist/**"],"suppress":[{"rule":"LC-STALE","reason":"ok"}]}'),
    );
    expect(cfg.failOn).toBe('stale');
    expect(cfg.ignore).toEqual(['dist/**']);
    expect(cfg.suppress).toHaveLength(1);
  });

  it('rejects a suppression with no reason (accountability)', () => {
    expect(() => loadConfig(repoWith('{"suppress":[{"rule":"LC-STALE"}]}'))).toThrow(/reason/);
  });

  it('rejects an invalid failOn', () => {
    expect(() => loadConfig(repoWith('{"failOn":"whenever"}'))).toThrow(/failOn/);
  });

  it('rejects non-JSON', () => {
    expect(() => loadConfig(repoWith('{ not json'))).toThrow(/not valid JSON/);
  });
});

describe('expiredSuppressions', () => {
  it('flags suppressions whose expiry has passed', () => {
    const cfg = {
      suppress: [
        { rule: 'A', reason: 'x', expires: '2026-01-01' },
        { rule: 'B', reason: 'y', expires: '2027-01-01' },
        { rule: 'C', reason: 'z' },
      ],
    };
    const expired = expiredSuppressions(cfg, '2026-07-24');
    expect(expired.map((s) => s.rule)).toEqual(['A']);
  });
});
