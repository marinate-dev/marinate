/**
 * File discovery (PLAN.md §14.1) — the CLI's job, because it touches the filesystem.
 *
 * Produces the InputFile[] the pure engine consumes. Honors .gitignore, skips the
 * usual heavy/irrelevant directories, caps file size, and filters to extensions that
 * can hold a model reference.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { InputFile } from '@marinate/engine';
import { loadGitignore, type IgnoreMatcher } from './gitignore.js';

/** Directories never worth walking. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'venv',
  '.venv',
  '__pycache__',
]);

/** Extensions that can hold a model reference (PLAN.md §14.1). */
const SCAN_EXTENSIONS = new Set([
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.rb',
  '.go',
  '.java',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.md',
]);

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

function isEnvFile(name: string): boolean {
  return name === '.env' || name.startsWith('.env.');
}

function shouldScanFile(name: string): boolean {
  return SCAN_EXTENSIONS.has(extensionOf(name)) || isEnvFile(name);
}

/** POSIX-normalize a repo-relative path so the engine sees consistent separators. */
function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

export interface WalkResult {
  readonly files: InputFile[];
  readonly skippedLarge: number;
  readonly errors: readonly string[];
}

/**
 * Walk `root` recursively and read every scannable file.
 * `.claude/settings.json` and `.claude/agents/*.md` are always included even though
 * `.claude` might otherwise look like tooling — they are a first-class scan surface.
 */
export function walk(root: string): WalkResult {
  const files: InputFile[] = [];
  const errors: string[] = [];
  let skippedLarge = 0;

  const ignore: IgnoreMatcher = loadGitignore(root);

  function recurse(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      errors.push(`cannot read directory ${dir}: ${String(error)}`);
      return;
    }

    for (const name of entries) {
      const abs = join(dir, name);
      const rel = toPosix(relative(root, abs));

      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue; // broken symlink, race, permission — skip quietly
      }

      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        if (ignore.ignores(rel + '/')) continue;
        recurse(abs);
        continue;
      }

      if (!stat.isFile()) continue;
      if (!shouldScanFile(name)) continue;
      if (ignore.ignores(rel)) continue;
      if (stat.size > MAX_FILE_BYTES) {
        skippedLarge += 1;
        continue;
      }

      try {
        files.push({ path: rel, text: readFileSync(abs, 'utf8') });
      } catch (error) {
        errors.push(`cannot read file ${rel}: ${String(error)}`);
      }
    }
  }

  recurse(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skippedLarge, errors };
}
