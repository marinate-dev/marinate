#!/usr/bin/env node
/**
 * Models-API check: the other half of the watcher.
 *
 * watch-sources.mjs notices when a documentation PAGE changes. This asks the
 * providers' own model-listing endpoints which IDs exist right now and reports
 * every ID the catalog does not know (as an entry id or an alias). A new model
 * shows up here the hour it is served, usually before the prose pages change.
 *
 * Read-only, credential-optional: a provider is checked only when its key is in
 * the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY); without one it is
 * skipped and said so. Nothing is written. Like the page watcher it reports
 * THAT an ID is unknown, never what to put in the catalog — that stays a
 * read-the-docs job (docs/CATALOG-REFRESH.md).
 *
 *   node scripts/check-models-api.mjs          # exit 1 when an unknown ID is served
 *   node scripts/check-models-api.mjs --json   # machine-readable report
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = join(ROOT, 'data', 'catalog');
const JSON_OUT = process.argv.includes('--json');

/** Every id and alias the catalog knows, by publisher. */
function knownIds() {
  const known = new Map();
  for (const file of readdirSync(CATALOG_DIR)) {
    if (!file.endsWith('.json')) continue;
    const rows = JSON.parse(readFileSync(join(CATALOG_DIR, file), 'utf8'));
    const list = Array.isArray(rows) ? rows : rows.aliases ?? [];
    for (const row of list) {
      const set = known.get(row.publisher) ?? new Set();
      if (row.id) set.add(row.id);
      if (row.alias) set.add(row.alias);
      for (const a of row.aliases ?? []) set.add(a);
      known.set(row.publisher, set);
    }
  }
  return known;
}

/** IDs the endpoints serve that are not models a config would pin (fine-tunes, embeddings, audio…). */
const OPENAI_IGNORE = /^(ft:|text-embedding|whisper|tts|dall-e|omni-moderation|babbage|davinci|gpt-image|sora|computer-use|codex-)/;

const PROVIDERS = [
  {
    publisher: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    async list(key) {
      const ids = [];
      let after = null;
      for (let page = 0; page < 10; page++) {
        const url = new URL('https://api.anthropic.com/v1/models');
        url.searchParams.set('limit', '100');
        if (after) url.searchParams.set('after_id', after);
        const res = await fetch(url, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
        if (!res.ok) throw new Error(`anthropic /v1/models ${res.status}`);
        const body = await res.json();
        for (const m of body.data ?? []) ids.push(m.id);
        if (!body.has_more) break;
        after = body.last_id;
      }
      return ids;
    },
  },
  {
    publisher: 'openai',
    envKey: 'OPENAI_API_KEY',
    async list(key) {
      const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } });
      if (!res.ok) throw new Error(`openai /v1/models ${res.status}`);
      const body = await res.json();
      return (body.data ?? []).map((m) => m.id).filter((id) => !OPENAI_IGNORE.test(id));
    },
  },
];

const known = knownIds();
const report = { checked: [], skipped: [], unknown: {}, errors: {} };

for (const p of PROVIDERS) {
  const key = process.env[p.envKey];
  if (!key) {
    report.skipped.push({ publisher: p.publisher, reason: `${p.envKey} not set` });
    continue;
  }
  try {
    const served = await p.list(key);
    const mine = known.get(p.publisher) ?? new Set();
    const unknown = served.filter((id) => !mine.has(id)).sort();
    report.checked.push({ publisher: p.publisher, served: served.length, unknown: unknown.length });
    if (unknown.length) report.unknown[p.publisher] = unknown;
  } catch (err) {
    report.errors[p.publisher] = String(err?.message ?? err);
  }
}

const drift = Object.keys(report.unknown).length > 0;
if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const s of report.skipped) console.log(`- ${s.publisher}: skipped (${s.reason})`);
  for (const c of report.checked) console.log(`- ${c.publisher}: ${c.served} IDs served, ${c.unknown} unknown to the catalog`);
  for (const [pub, ids] of Object.entries(report.unknown)) {
    console.log(`\n## ${pub}: IDs served but not in the catalog\n`);
    for (const id of ids) console.log(`  ✕ ${id}`);
  }
  for (const [pub, e] of Object.entries(report.errors)) console.log(`\n! ${pub}: ${e}`);
  if (drift) console.log('\nRead the provider docs for each ID and add a catalog entry (docs/CATALOG-REFRESH.md).');
  else if (report.checked.length) console.log('\nEvery served ID is in the catalog.');
}
process.exit(drift || Object.keys(report.errors).length ? 1 : 0);
