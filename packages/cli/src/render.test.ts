import { describe, expect, it } from 'vitest';
import { shouldFail } from './render.js';
import type { Finding, Report } from '@marinate/engine';

function reportWith(severities: Finding['severity'][]): Report {
  const findings: Finding[] = severities.map((severity, i) => ({
    key: `F-${i}`,
    rule: 'X',
    severity,
    evidence: 'documented',
    file: 'x.ts',
    line: 1,
    servingPlatform: 'unknown',
    platformConfidence: 'unknown',
    surface: 'unknown',
    downgraded: false,
    message: '',
    sources: [],
    verifiedAt: '2026-07-23',
  }));
  return {
    scannedAt: '', durationMs: 0, filesScanned: 1, callSites: 0, references: 1,
    findings, suppressed: [],
    summary: { breaksNow: 0, upgradeBlocker: 0, behaviorChange: 0, stale: 0, unresolved: 0, suppressed: 0 },
    dataVersion: 'test', cliVersion: 'test',
  };
}

describe('shouldFail — exit-code policy', () => {
  it('default (breaks) fails only on BREAKS NOW', () => {
    expect(shouldFail(reportWith(['stale']), 'breaks')).toBe(false);
    expect(shouldFail(reportWith(['behavior_change']), 'breaks')).toBe(false);
    expect(shouldFail(reportWith(['breaks_now']), 'breaks')).toBe(true);
  });

  it('stale threshold fails on anything at or above stale', () => {
    expect(shouldFail(reportWith(['stale']), 'stale')).toBe(true);
    expect(shouldFail(reportWith(['unresolved']), 'stale')).toBe(false);
  });

  it('none never fails', () => {
    expect(shouldFail(reportWith(['breaks_now']), 'none')).toBe(false);
  });

  it('upgrade threshold fails on breaks and upgrade only', () => {
    expect(shouldFail(reportWith(['upgrade_blocker']), 'upgrade')).toBe(true);
    expect(shouldFail(reportWith(['behavior_change']), 'upgrade')).toBe(false);
  });
});
