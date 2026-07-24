/**
 * --staged: scan the git index, not the working tree (PLAN.md §12).
 *
 * This is what makes marinate useful in a pre-commit hook — it checks exactly what is
 * about to be committed, including staged-but-unsaved changes. Reads blob content from
 * the index via `git show :path`, so a file edited-but-not-staged is scanned in its
 * staged form, not its working-tree form.
 */

import { execFileSync } from 'node:child_process';
import type { InputFile } from '@marinate-audit/engine';

const SCAN_EXTENSIONS = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rb', '.go', '.java',
  '.json', '.yaml', '.yml', '.toml', '.md',
]);

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

function isEnvFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base === '.env' || base.startsWith('.env.');
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

export interface StagedResult {
  readonly files: InputFile[];
  readonly errors: readonly string[];
}

/**
 * Read staged (index) content of files that are Added/Copied/Modified.
 * Throws a clear error if `root` isn't a git repo — the CLI turns that into exit 2.
 */
export function readStaged(root: string): StagedResult {
  try {
    git(root, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    throw new Error('--staged requires a git repository (no git repo found here)');
  }

  const listing = git(root, [
    'diff', '--cached', '--name-only', '--diff-filter=ACM', '-z',
  ]);
  const paths = listing.split('\0').filter((p) => p !== '');

  const files: InputFile[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    if (!(SCAN_EXTENSIONS.has(extensionOf(path)) || isEnvFile(path))) continue;
    try {
      const text = git(root, ['show', `:${path}`]);
      files.push({ path, text });
    } catch (error) {
      errors.push(`cannot read staged ${path}: ${String(error)}`);
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, errors };
}
