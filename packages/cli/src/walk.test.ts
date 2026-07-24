import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walk } from './walk.js';

const dirs: string[] = [];

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'marinate-walk-'));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('walk', () => {
  it('finds scannable files and skips node_modules and dist', () => {
    const root = makeRepo({
      'src/a.ts': '1',
      'src/b.py': '2',
      'node_modules/pkg/index.js': '3',
      'dist/out.js': '4',
      'README.md': '5',
    });
    const paths = walk(root).files.map((f) => f.path).sort();
    expect(paths).toEqual(['README.md', 'src/a.ts', 'src/b.py']);
  });

  it('honors a root .gitignore', () => {
    const root = makeRepo({
      '.gitignore': 'ignored/\nsecret.ts\n',
      'src/keep.ts': '1',
      'ignored/skip.ts': '2',
      'secret.ts': '3',
    });
    const paths = walk(root).files.map((f) => f.path).sort();
    expect(paths).toEqual(['src/keep.ts']);
  });

  it('includes .claude agent config even though .claude looks like tooling', () => {
    const root = makeRepo({
      '.claude/settings.json': '{"model":"opus"}',
      '.claude/agents/x.md': '---\nmodel: sonnet\n---',
    });
    const paths = walk(root).files.map((f) => f.path).sort();
    expect(paths).toContain('.claude/settings.json');
    expect(paths).toContain('.claude/agents/x.md');
  });

  it('does not scan unsupported extensions', () => {
    const root = makeRepo({ 'a.ts': '1', 'b.png': 'x', 'c.lock': 'y' });
    const paths = walk(root).files.map((f) => f.path).sort();
    expect(paths).toEqual(['a.ts']);
  });

  it('returns POSIX-separated paths', () => {
    const root = makeRepo({ 'deep/nested/file.ts': '1' });
    expect(walk(root).files[0]!.path).toBe('deep/nested/file.ts');
  });
});
