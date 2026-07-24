/**
 * Lexical model detection — Pass A (PLAN.md §14.2).
 *
 * Finds every model-looking string in a file's text, tags a probable publisher from
 * its grammar, and records where the string lives (source, config, agent-config).
 *
 * This is deliberately pure and text-only: no parsing, no catalog lookups, no
 * severity. It answers exactly one question — "where do model-looking strings
 * appear?" — and leaves what-they-mean to the catalog stage. That keeps Increment 1
 * shippable without an AST.
 */

import type { InputFile, ModelReference, Publisher, ReferenceContext } from './types.js';

interface Grammar {
  readonly publisher: Publisher;
  readonly pattern: RegExp;
}

/**
 * Publisher ID grammars. Each is anchored with \b so it matches inside strings,
 * object values, YAML, etc. The `g` flag drives per-match iteration; `i` because
 * providers are case-insensitive about their own IDs in practice.
 *
 * These recognize the *shape* of a model ID, not membership in the catalog — a
 * grammar hit that isn't in the catalog becomes an `unknown_model` info finding
 * later, which is how typos and day-old releases surface.
 */
const GRAMMARS: readonly Grammar[] = [
  // anthropic. / vertex @-dated forms are Anthropic too; the base grammar catches them.
  { publisher: 'anthropic', pattern: /\b(?:anthropic\.)?claude-[a-z0-9]+(?:[-.][a-z0-9]+)*\b/gi },
  // o-series REQUIRES a suffix (o1-mini, o4-mini, o1-2024-12-17). Bare `o1`/`o3` are
  // matched only as quoted literals (see BARE_ALIAS_GRAMMAR / detectAliasReferences),
  // so `const o1 = ...` no longer resolves to a model (CP1 finding F1).
  { publisher: 'openai', pattern: /\b(?:gpt-[a-z0-9.]+(?:-[a-z0-9.]+)*|o[0-9]+-[a-z0-9][a-z0-9.-]*|chatgpt-[a-z0-9.-]+)\b/gi },
  { publisher: 'google', pattern: /\bgemini-[0-9]+(?:\.[0-9]+)?-[a-z0-9.-]+\b/gi },
  { publisher: 'xai', pattern: /\bgrok-[a-z0-9.-]+\b/gi },
  { publisher: 'meta', pattern: /\b(?:meta-)?llama[-/][a-z0-9.-]+\b/gi },
  { publisher: 'mistral', pattern: /\b(?:mistral|mixtral|codestral)-[a-z0-9.-]+\b/gi },
];

/** Bare model tokens too word-like for the free-text grammar; matched quoted only. */
export function isWordLikeModelToken(raw: string): boolean {
  return /^o[0-9]+$/i.test(raw);
}

/** File shapes that hold configuration rather than code. */
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml']);

/**
 * Agent/tool config: real model pins nobody scans (PLAN.md §14.2). These are
 * configuration, not invocation, so downstream they can only yield lifecycle /
 * floating-alias findings — never a parameter rejection, never BREAKS NOW.
 */
function isAgentConfig(path: string): boolean {
  return (
    /(^|\/)\.claude\/settings(\.local)?\.json$/.test(path) ||
    /(^|\/)\.claude\/agents\/[^/]+\.md$/.test(path)
  );
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

function isEnvFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base === '.env' || base.startsWith('.env.');
}

function contextFor(path: string): ReferenceContext {
  if (isAgentConfig(path)) return 'agent-config';
  if (CONFIG_EXTENSIONS.has(extensionOf(path)) || isEnvFile(path)) return 'config';
  // In a source file we cannot yet tell adjacency without an AST; Pass B (M2) refines
  // this. For Increment 1 a source-file hit is treated as callsite-adjacent, which is
  // the honest default: near code, meaning-to-be-determined.
  return 'callsite-adjacent';
}

/** Precompute line-start offsets so we can map a byte index to a 1-based line. */
function lineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

function lineFor(starts: readonly number[], index: number): number {
  // Binary search for the greatest start <= index.
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Detect all model references in one file.
 *
 * A single position can match more than one grammar (rare, but e.g. a hand-written
 * odd string); we keep the first match at each start offset to avoid duplicates,
 * preferring earlier grammars in declaration order.
 */
export function detectReferences(file: InputFile): ModelReference[] {
  const context = contextFor(file.path);
  const starts = lineStarts(file.text);
  const claimed = new Set<number>();
  const refs: ModelReference[] = [];

  for (const { publisher, pattern } of GRAMMARS) {
    // Fresh lastIndex per file (patterns are module-level and stateful with /g).
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(file.text)) !== null) {
      const start = match.index;
      // Guard against zero-width matches looping forever.
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      if (claimed.has(start)) continue;
      claimed.add(start);
      refs.push({
        file: file.path,
        line: lineFor(starts, start),
        range: { start, end: start + match[0].length },
        raw: match[0],
        publisher,
        context,
        viaQuotedLiteral: false,
      });
    }
  }

  refs.sort((a, b) => a.range.start - b.range.start);
  return refs;
}

/** Detect across many files, preserving file order then in-file position. */
export function detectAll(files: readonly InputFile[]): ModelReference[] {
  const out: ModelReference[] = [];
  for (const file of files) out.push(...detectReferences(file));
  return out;
}

/** A floating-alias term to search for as a literal (e.g. `opus`, `sonnet`). */
export interface AliasTerm {
  readonly term: string;
  readonly publisher: Publisher;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect floating-alias references — bare tier names like `opus` that the model-ID
 * grammars deliberately do not match (too word-like). To avoid prose false positives
 * ("magnum opus"), an alias only counts when it is a COMPLETE quoted string literal,
 * optionally carrying a variant suffix: `"opus"`, `'sonnet'`, `"opus[1m]"`.
 *
 * The catalog owns the alias list, so this stays a lexical helper the analyzer feeds.
 */
export function detectAliasReferences(
  file: InputFile,
  terms: readonly AliasTerm[],
): ModelReference[] {
  if (terms.length === 0) return [];
  const starts = lineStarts(file.text);
  const context = contextFor(file.path);
  const refs: ModelReference[] = [];

  for (const { term, publisher } of terms) {
    // A quote, the exact term, an optional [..] suffix, then the matching-ish quote.
    const re = new RegExp(`(['"])(${escapeRegex(term)}(?:\\[[^\\]]*\\])?)['"]`, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(file.text)) !== null) {
      const inner = match[2]!;
      const start = match.index + 1; // skip opening quote
      refs.push({
        file: file.path,
        line: lineFor(starts, start),
        range: { start, end: start + inner.length },
        raw: inner,
        publisher,
        context,
        viaQuotedLiteral: true,
      });
    }
  }

  refs.sort((a, b) => a.range.start - b.range.start);
  return refs;
}
