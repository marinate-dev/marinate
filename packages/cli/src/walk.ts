/**
 * File discovery (PLAN.md §14.1) — the CLI's job, because it touches the filesystem.
 *
 * Produces the InputFile[] the pure engine consumes. Honors .gitignore, skips the
 * usual heavy/irrelevant directories, caps file size, and filters to extensions that
 * can hold a model reference.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { InputFile } from '@marinate-audit/engine';
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
  if (isMinifiedName(name)) return false;
  return SCAN_EXTENSIONS.has(extensionOf(name)) || isEnvFile(name);
}

/**
 * Committed build output is noise — a bundled `index-c_645qQx.js` produces findings
 * nobody can act on (CP1: ~19% of worldmonitor's findings). Two cheap signals catch
 * most of it: an explicit `.min.` marker, and the content-hash filenames that
 * Vite/webpack/Rollup emit (`name-a1B2c3D4.js`).
 */
function isMinifiedName(name: string): boolean {
  if (/\.min\.(js|mjs|cjs|css)$/i.test(name)) return true;
  // hashed asset: base-<8+ base62>.ext
  if (/-[A-Za-z0-9_-]{8,}\.(js|mjs|cjs)$/.test(name)) return true;
  return false;
}

/** A file with an enormous single line is generated/bundled, whatever its name. */
function looksMinifiedContent(text: string): boolean {
  // Check only the first slice — minified files front-load a giant line.
  const head = text.slice(0, 200_000);
  let lineLen = 0;
  for (let i = 0; i < head.length; i++) {
    if (head.charCodeAt(i) === 10) lineLen = 0;
    else if (++lineLen > 5000) return true;
  }
  return false;
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
        const text = readFileSync(abs, 'utf8');
        if (looksMinifiedContent(text)) {
          skippedLarge += 1; // count minified-content skips alongside oversize skips
          continue;
        }
        files.push({ path: rel, text });
      } catch (error) {
        errors.push(`cannot read file ${rel}: ${String(error)}`);
      }
    }
  }

  recurse(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skippedLarge, errors };
}
