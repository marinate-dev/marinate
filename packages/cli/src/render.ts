/**
 * Terminal rendering + exit-code policy (PLAN.md §5, §12).
 *
 * The report is the product's first impression, so it is generated, never
 * hand-written (PLAN.md §18). This renderer is the single source of that output; the
 * demo fixture runs through it in CI so the marketing screenshot can never drift from
 * real behavior.
 */

import type { FailOn, Finding, Report, Severity } from '@marinate-audit/engine';

const SEVERITY_ORDER: Record<Severity, number> = {
  breaks_now: 0,
  upgrade_blocker: 1,
  behavior_change: 2,
  stale: 3,
  unresolved: 4,
};

interface Glyph {
  readonly mark: string;
  readonly label: string;
}

function glyphFor(f: Finding): Glyph {
  switch (f.severity) {
    case 'breaks_now':
      return { mark: '✕', label: 'BREAKS NOW' };
    case 'upgrade_blocker':
      return { mark: '✕', label: 'UPGRADE' };
    case 'behavior_change':
      return f.downgraded
        ? { mark: '▲', label: 'REVIEW' }
        : { mark: '▲', label: 'BEHAVIOR' };
    case 'stale':
      return { mark: '●', label: 'STALE' };
    case 'unresolved':
      return { mark: '?', label: 'UNRESOLVED' };
  }
}

/** Fail-on thresholds, ordered least-to-most severe. */
const THRESHOLDS: Record<Exclude<FailOn, 'none'>, Severity[]> = {
  stale: ['breaks_now', 'upgrade_blocker', 'behavior_change', 'stale'],
  behavior: ['breaks_now', 'upgrade_blocker', 'behavior_change'],
  upgrade: ['breaks_now', 'upgrade_blocker'],
  breaks: ['breaks_now'],
};

/** Whether the report should fail CI at the given threshold. */
export function shouldFail(report: Report, failOn: FailOn): boolean {
  if (failOn === 'none') return false;
  const failing = new Set(THRESHOLDS[failOn]);
  return report.findings.some((f) => failing.has(f.severity));
}

function padLabel(label: string): string {
  return label.padEnd(11, ' ');
}

export function renderReport(report: Report, cliVersion: string, engineVersion: string): string {
  const lines: string[] = [];
  lines.push(
    `🥩 marinate check — ${report.filesScanned} files · ${report.callSites} call sites · ${report.references} references` +
      `        data ${report.dataVersion} · cli ${cliVersion}`,
  );
  lines.push('');

  if (report.findings.length === 0) {
    lines.push('   No lifecycle or staleness findings. Every model reference resolves to a');
    lines.push('   current, catalogued model.');
    lines.push('');
  } else {
    const sorted = [...report.findings].sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    );
    for (const f of sorted) {
      const g = glyphFor(f);
      const loc = `${f.file}:${f.line}`;
      lines.push(` ${g.mark} ${padLabel(g.label)} ${loc}`);
      lines.push(`      ${f.message}`);
      if (f.fix) lines.push(`      fix: ${f.fix.note}`);
      if (f.sources.length > 0) lines.push(`      source: ${f.sources[0]} · verified ${f.verifiedAt}`);
      lines.push('');
    }
  }

  const s = report.summary;
  const parts = [
    s.breaksNow ? `${s.breaksNow} breaks` : null,
    s.upgradeBlocker ? `${s.upgradeBlocker} upgrade` : null,
    s.behaviorChange ? `${s.behaviorChange} behavior/review` : null,
    s.stale ? `${s.stale} stale` : null,
    s.unresolved ? `${s.unresolved} unresolved` : null,
    s.suppressed ? `${s.suppressed} suppressed` : null,
  ].filter((p): p is string => p !== null);
  lines.push(` ${parts.length > 0 ? parts.join(' · ') : 'no findings'}`);

  // Note: engineVersion surfaced only in verbose contexts today; kept for parity.
  void engineVersion;
  return lines.join('\n') + '\n';
}
