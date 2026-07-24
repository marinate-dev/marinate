import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Privacy guarantee, source-enforced (PLAN.md §2). The CLI must never open a network
 * connection during a scan — that is what lets us say "nothing about your code leaves
 * the machine." The engine is already network-incapable (its own purity test); this
 * asserts the CLI layer imports no networking module and calls no fetch either.
 *
 * The one legitimate outbound tool, `npx`, lives in generated CI YAML (the Action),
 * not in the CLI runtime — so the runtime itself stays offline.
 */
describe('CLI makes no network calls (privacy)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  const forbidden = [
    /from\s+['"]node:(https?|net|dns|tls|http2|dgram)['"]/,
    /require\(\s*['"]node:(https?|net|dns|tls|http2|dgram)['"]\s*\)/,
    /\bfetch\s*\(/,
    /new\s+WebSocket\b/,
  ];

  for (const file of sources) {
    it(`${file} opens no network connection`, () => {
      const text = readFileSync(join(here, file), 'utf8');
      for (const pattern of forbidden) {
        expect(text, `${file} must not use ${pattern}`).not.toMatch(pattern);
      }
    });
  }
});
