import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The version a user sees (`marinate --version`, the report header) is a string literal,
 * not read from package.json at runtime. 0.1.2 shipped its package bump with the literal
 * still at 0.1.1, so every report would have misreported the CLI version. A release bump
 * that forgets either side now fails CI.
 */
function literal(path: string, name: string): string {
  const src = readFileSync(new URL(path, import.meta.url), 'utf8');
  const m = src.match(new RegExp(`const ${name} = '([^']+)'`));
  if (!m) throw new Error(`${name} literal not found in ${path}`);
  return m[1];
}

function pkgVersion(path: string): string {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).version;
}

describe('version literals match package.json', () => {
  it('CLI_VERSION equals packages/cli/package.json', () => {
    expect(literal('./index.ts', 'CLI_VERSION')).toBe(pkgVersion('../package.json'));
  });

  it('ENGINE_VERSION equals packages/engine/package.json', () => {
    expect(literal('../../engine/src/index.ts', 'ENGINE_VERSION')).toBe(pkgVersion('../../engine/package.json'));
  });
});
