#!/usr/bin/env node
/**
 * Catalog source watcher (PLAN.md §11).
 *
 * Every catalog entry already records the URLs its facts came from. This walks that
 * set, fetches each page, and diffs a normalized hash against a stored baseline — so
 * the watch list GENERATES ITSELF from the catalog and automatically covers new
 * providers as they're added. There is no second list to maintain and drift.
 *
 * Why hash pages rather than diff a models endpoint: on 2026-07-24 an endpoint diff
 * would have caught `claude-opus-5` appearing, but NOT that its prompt-cache minimum
 * is 512 (half its predecessor's), and NOT that the `opus` alias re-pointed. Those
 * facts live only in prose. Endpoint enumeration and page watching catch different
 * things; this is the half that needs no credentials.
 *
 * Deliberately dumb: it reports THAT a page changed, never what the change means.
 * Interpreting the diff is a human + live-docs job (that's §19). A watcher that tried
 * to auto-patch the catalog would be the same confidently-stale-knowledge failure the
 * product exists to catch.
 *
 *   node scripts/watch-sources.mjs            # compare against baseline, exit 1 on drift
 *   node scripts/watch-sources.mjs --update   # rewrite the baseline (do this after a review)
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = join(ROOT, 'data', 'catalog');
const BASELINE = join(ROOT, 'data', 'source-hashes.json');
const UPDATE = process.argv.includes('--update');

/**
 * Hosts this technique provably cannot watch, with the measurement that proved it.
 *
 * Measured 2026-07-24: ai.google.dev returns wildly different amounts of content on
 * identical back-to-back requests (12,679 vs 6,238 normalized chars — a ~51% swing,
 * non-converging across repeated fetches). Exact hashing fires every run; a tolerance
 * band wide enough to absorb 51% would not detect a real change either. Both options
 * are theatre, so these are recorded as UNWATCHED and must be re-verified by hand at
 * each data release.
 *
 * Removing a host from this list requires re-measuring, not optimism.
 */
const UNWATCHABLE = [
  { pattern: /^https:\/\/ai\.google\.dev\//, reason: 'renders non-deterministically (~51% size swing between identical requests); neither hashing nor a size band is meaningful' },
];

function unwatchableReason(url) {
  return UNWATCHABLE.find((u) => u.pattern.test(url))?.reason ?? null;
}

/** Anthropic serves clean markdown at `<url>.md`; far less churn than the HTML shell. */
function fetchableUrl(url) {
  if (url.includes('platform.claude.com/docs/') && !url.endsWith('.md')) return `${url}.md`;
  return url;
}

/**
 * Strip the parts of a page that change without the facts changing: markup, scripts,
 * and whitespace runs. Without this, a nav tweak or a copy edit trips every source and
 * the signal drowns. This is intentionally crude — over-normalizing risks hiding a real
 * change, so when in doubt it stays noisy.
 */
function normalize(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectSources() {
  const urls = new Map(); // url -> Set(provider)
  for (const file of readdirSync(CATALOG_DIR)) {
    if (!file.endsWith('.json')) continue;
    const entries = JSON.parse(readFileSync(join(CATALOG_DIR, file), 'utf8'));
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const url of entry.sources ?? []) {
        if (!urls.has(url)) urls.set(url, new Set());
        urls.get(url).add(entry.publisher ?? file.replace('.json', ''));
      }
    }
  }
  return urls;
}

async function fetchNormalized(url) {
  const res = await fetch(fetchableUrl(url), {
    headers: { 'user-agent': 'marinate-catalog-watcher (+https://marinate.dev)' },
    redirect: 'follow',
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return { text: normalize(await res.text()) };
}

/**
 * Some doc hosts are NOT deterministic. Measured 2026-07-24: ai.google.dev alternates
 * between a full render (~12.7k chars) and a partial one (~6.2k) on identical
 * back-to-back requests — an edge cache serving a half-hydrated variant. Hashing a
 * single fetch there produces a "change" every other day, and a watcher that cries
 * wolf gets muted, which is strictly worse than no watcher.
 *
 * So: fetch up to ATTEMPTS times and keep the LONGEST body. The short variant is a
 * truncated render of the same page, so the longest is the fullest content — and a
 * genuine edit still moves it. Stops early once two fetches agree.
 */
const ATTEMPTS = 3;

async function hashUrl(url) {
  let best = null;
  let lastError = null;
  const lengths = [];

  for (let i = 0; i < ATTEMPTS; i++) {
    const r = await fetchNormalized(url);
    if (r.error) {
      lastError = r.error;
      continue;
    }
    lengths.push(r.text.length);
    if (!best || r.text.length > best.length) best = r.text;
    // Two identical lengths in a row means the host is behaving deterministically.
    if (lengths.length >= 2 && lengths[lengths.length - 1] === lengths[lengths.length - 2]) break;
  }

  if (!best) return { error: lastError ?? 'no response' };
  // An almost-empty body means a JS shell or a soft 404 — hashing it would produce a
  // stable hash for a page we are not actually reading. Surface it as an error instead,
  // because a "clean" watcher over unreadable pages is worse than no watcher.
  if (best.length < 500) return { error: `body too short (${best.length} chars) — likely a JS shell or soft 404` };

  const unstable = new Set(lengths).size > 1;
  return {
    hash: createHash('sha256').update(best).digest('hex').slice(0, 16),
    length: best.length,
    ...(unstable ? { unstable: true } : {}),
  };
}

const sources = collectSources();
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { sources: {} };
const next = {};
const changed = [];
const errored = [];
const added = [];

console.log(`watching ${sources.size} source URLs from ${readdirSync(CATALOG_DIR).length} catalog files\n`);

const unwatched = [];

for (const [url, providers] of [...sources].sort()) {
  const who = [...providers].sort().join(',');

  const reason = unwatchableReason(url);
  if (reason) {
    unwatched.push(`${who}: ${url} — ${reason}`);
    console.log(`  ⊘ ${url}\n      unwatched: ${reason}`);
    continue;
  }

  let result;
  try {
    result = await hashUrl(url);
  } catch (err) {
    result = { error: err.message };
  }

  if (result.error) {
    errored.push(`${who}: ${url} — ${result.error}`);
    // Keep the previous hash so a transient outage doesn't silently reset the baseline.
    if (baseline.sources[url]) next[url] = baseline.sources[url];
    console.log(`  ⚠ ${url}\n      ${result.error}`);
    continue;
  }

  const prior = baseline.sources[url];
  // Once a host has ever been seen rendering non-deterministically, keep watching it at
  // the lower fidelity permanently — a single stable-looking day doesn't make it stable.
  const unstable = Boolean(result.unstable || prior?.unstable);
  next[url] = {
    hash: result.hash,
    length: result.length,
    ...(unstable ? { unstable: true } : {}),
    providers: [...providers].sort(),
  };

  if (!prior) {
    added.push(`${who}: ${url}`);
    console.log(`  + ${url} (new source, baseline recorded)`);
    continue;
  }

  const delta = result.length - prior.length;
  const sign = delta >= 0 ? '+' : '';

  if (unstable) {
    /**
     * Measured 2026-07-24: ai.google.dev returns a materially different amount of
     * content on identical back-to-back requests and never converges, so an exact
     * hash there is pure noise. Watch these at reduced fidelity — flag only when the
     * page size moves outside a tolerance band, which still catches "a new model
     * section was added" while ignoring render jitter.
     *
     * This is a REAL loss of coverage, not a clever workaround: a small wording change
     * to one row on an unstable host will not be detected. It is reported as degraded
     * in the summary so it never reads as equivalent to an exact-hash source.
     */
    const TOLERANCE = 0.15;
    const drift = Math.abs(delta) / Math.max(prior.length, 1);
    if (drift > TOLERANCE) {
      changed.push(`${who}: ${url} (${sign}${delta} chars, ${(drift * 100).toFixed(0)}% — size band, host renders non-deterministically)`);
      console.log(`  ✕ SIZE BAND ${url}  (${sign}${delta} chars, ${(drift * 100).toFixed(0)}%)`);
    } else {
      // Keep the larger of the two so the band tracks the fullest render we've seen.
      next[url].length = Math.max(prior.length, result.length);
      console.log(`  ~ ${url} (unstable host, within ${(TOLERANCE * 100).toFixed(0)}% band)`);
    }
    continue;
  }

  if (prior.hash !== result.hash) {
    changed.push(`${who}: ${url} (${sign}${delta} chars)`);
    console.log(`  ✕ CHANGED ${url}  (${sign}${delta} chars)`);
  } else {
    console.log(`  · ${url}`);
  }
}

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify({ updatedAt: new Date().toISOString().slice(0, 10), sources: next }, null, 2)}\n`);
  console.log(`\nbaseline updated — ${Object.keys(next).length} sources`);
  process.exit(0);
}

console.log('');
if (changed.length) {
  console.log(`## ${changed.length} source page(s) changed since the last review\n`);
  for (const c of changed) console.log(`- ${c}`);
  console.log('\nRe-verify the affected catalog values against the live page, then run');
  console.log('`node scripts/watch-sources.mjs --update` to accept the new baseline.');
}
if (errored.length) {
  console.log(`\n## ${errored.length} source(s) unreachable — coverage gap, not a clean pass\n`);
  for (const e of errored) console.log(`- ${e}`);
}

// Always state coverage gaps, even on a green run. A watcher that reports "all clear"
// while silently not watching some sources is the same false-confidence failure the
// product exists to catch.
const degraded = Object.entries(next).filter(([, v]) => v.unstable);
if (degraded.length) {
  console.log(`\n## ${degraded.length} source(s) watched at REDUCED fidelity (size band only)\n`);
  console.log('These render non-deterministically, so small wording changes will NOT be');
  console.log('detected. Re-verify by hand at each data release.\n');
  for (const [url] of degraded) console.log(`- ${url}`);
}

if (unwatched.length) {
  console.log(`\n## ${unwatched.length} source(s) NOT WATCHED AT ALL — manual review required\n`);
  for (const u of unwatched) console.log(`- ${u}`);
}

if (!changed.length && !errored.length) {
  console.log(`\nno source pages changed (${unwatched.length} unwatched, see above).`);
}

// Unreachable sources fail too: a watcher that silently stops watching is the exact
// failure mode this is meant to prevent.
process.exit(changed.length || errored.length ? 1 : 0);
