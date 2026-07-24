/**
 * Copy the catalog/rules data into the CLI package so it ships inside the published
 * tarball (PLAN.md §13 — data is bundled, the CLI makes no network request to fetch
 * it). The source of truth is the repo-root `data/` dir; this mirrors it to
 * `packages/cli/data/`, which `files` includes at publish time.
 *
 * Cross-platform (fs.cpSync, Node ≥22) — the previous chmod/glob approach broke on
 * Windows CI.
 */
import { cpSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/scripts
const repoData = join(here, '..', '..', '..', 'data'); // repo-root/data
const pkgData = join(here, '..', 'data'); // packages/cli/data

if (!existsSync(repoData)) {
  console.error(`bundle-data: source data dir not found at ${repoData}`);
  process.exit(1);
}

rmSync(pkgData, { recursive: true, force: true });
cpSync(repoData, pkgData, { recursive: true });
console.log(`bundle-data: copied ${repoData} → ${pkgData}`);
