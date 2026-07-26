/**
 * Marinate core types — the authoritative in-code expression of PLAN.md §15.
 *
 * Design invariants encoded here (each one came out of adversarial review; do not
 * relax without revisiting PLAN.md §3):
 *
 *  1. A model *reference* is not a *call site*. Text in a README can never fail CI.
 *  2. Publisher (who makes the model) is separate from serving platform (where the
 *     request goes). Lifecycle and behavior differ per platform, so severity is gated
 *     on how confidently we know the platform.
 *  3. Evidence class gates severity: only `documented` findings may fail CI.
 *  4. Floating aliases are a distinct concept from stable aliases — they re-point.
 */

// ---------------------------------------------------------------------------
// Providers, platforms, surfaces
// ---------------------------------------------------------------------------

/** Who publishes the model. Distinct from where it is served. */
export type Publisher =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'meta'
  | 'mistral';

/**
 * Where the request is actually served. Not cosmetic: retirement schedules and
 * documented behavior (e.g. prompt-cache minimums) can differ between a publisher's
 * direct API and a partner platform, so this gates severity.
 */
export type ServingPlatform =
  | 'direct'
  | 'bedrock'
  | 'vertex'
  | 'azure'
  | 'litellm-routed'
  | 'unknown';

/**
 * How sure we are about `ServingPlatform`. BREAKS NOW requires `proven`
 * (PLAN.md §3 rule 3) — anything less downgrades to a review notice.
 */
export type PlatformConfidence = 'proven' | 'inferred' | 'unknown';

/**
 * The code shape the call was found in. Non-`direct` surfaces may translate, rename,
 * or drop parameters, so parameter rules are downgraded on them.
 * `agent-config` is configuration rather than invocation: it can never produce a
 * parameter-rejection finding.
 */
export type Surface =
  | 'direct'
  | 'vercel-ai'
  | 'litellm'
  | 'agent-config'
  | 'unknown';

/** How a model expression's value was established. */
export type Resolution = 'literal' | 'constant' | 'config' | 'unresolved';

/** Where a bare model string was found, when it is not bound to a call site. */
export type ReferenceContext =
  | 'callsite-adjacent'
  | 'config'
  | 'agent-config'
  | 'unbound_literal';

// ---------------------------------------------------------------------------
// Evidence & severity
// ---------------------------------------------------------------------------

/**
 * `documented` — an official provider page states it (requires `sources` + `verifiedAt`).
 * `derived`    — computed from something documented (e.g. a token-count estimate).
 * `assumed`    — supplied by the user (annotations, future).
 *
 * Only `documented` may carry BREAKS NOW or UPGRADE BLOCKER.
 */
export type Evidence = 'documented' | 'derived' | 'assumed';

export type Severity =
  | 'breaks_now'
  | 'upgrade_blocker'
  | 'behavior_change'
  | 'stale'
  | 'unresolved';

/** CI threshold: fail on this severity and anything above it. */
export type FailOn = 'breaks' | 'upgrade' | 'behavior' | 'stale' | 'none';

/**
 * `mechanical` — exact source range known, edit is deterministic.
 * `guided`     — we can state the change but cannot safely construct it.
 *                (A model successor swap is ALWAYS at most `guided`: the successor
 *                 may itself introduce parameter breaks.)
 * `manual`     — needs developer judgement.
 */
export type FixConfidence = 'mechanical' | 'guided' | 'manual';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type LifecycleStatus = 'active' | 'deprecated' | 'retired';

export interface Pricing {
  /** USD per million input tokens, published list rate. */
  readonly inPerMTok: number;
  /** USD per million output tokens, published list rate. */
  readonly outPerMTok: number;
}

/** Capability flags exist only for publishers that have compatibility rules. */
export interface Capabilities {
  readonly samplingParams?: boolean;
  readonly budgetTokens?: boolean;
  readonly adaptiveThinking?: boolean;
  readonly prefill?: boolean;
  readonly effort?: readonly string[];
  readonly cacheMinTokens?: number;
}

/** Documented divergences when served somewhere other than the publisher's own API. */
export interface PlatformNotes {
  readonly bedrock?: Partial<Capabilities> & { readonly note?: string };
  readonly vertex?: Partial<Capabilities> & { readonly note?: string };
  readonly azure?: Partial<Capabilities> & { readonly note?: string };
}

export interface CatalogEntry {
  readonly id: string;
  readonly publisher: Publisher;
  /** Stable pointers to THIS version (e.g. dated snapshots). Not floating aliases. */
  readonly aliases: readonly string[];
  readonly family?: string;
  readonly generation?: number;
  readonly released?: string;
  readonly status: LifecycleStatus;
  /** Known shutdown date when `status` is `deprecated`. */
  readonly retiresAt?: string;
  /** Documented same-family replacement, if the publisher names one. */
  readonly successor?: string;
  readonly pricing?: Pricing;
  readonly platformNotes?: PlatformNotes;
  readonly capabilities?: Capabilities;
  readonly sources: readonly string[];
  readonly verifiedAt: string;
}

/**
 * A tier pointer that RE-POINTS when a new generation ships (`opus`, `sonnet`).
 * Deliberately separate from `CatalogEntry.aliases`, which never move. Pinning to
 * one of these means the deployed model changes with no code edit.
 */
export interface FloatingAlias {
  readonly alias: string;
  readonly publisher: Publisher;
  readonly currently: string;
  readonly movedAt?: string;
  readonly previously?: string;
  /** e.g. `["[1m]"]` for context-window variants appended to the alias. */
  readonly variantSuffixes?: readonly string[];
  readonly sources: readonly string[];
  readonly verifiedAt: string;
}

export interface Catalog {
  readonly version: string;
  readonly models: readonly CatalogEntry[];
  readonly floatingAliases: readonly FloatingAlias[];
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * `rejection` — the request is documented as invalid (an error).
 * `behavior`  — the request succeeds but does something different (silent).
 *
 * Lifecycle, floating-alias, and price findings are NOT rules: they are derived
 * generically from the catalog, which is why they work for every publisher without
 * anyone writing a rule.
 */
export type RuleKind = 'rejection' | 'behavior';

export interface RuleConditions {
  /** Match on capability flags rather than model-ID lists, so new catalog entries inherit coverage. */
  readonly modelCapability?: Readonly<Record<string, boolean>>;
  readonly modelFamily?: readonly string[];
  readonly modelIds?: readonly string[];
  readonly minGeneration?: number;
  readonly paramsPresentAny?: readonly string[];
  readonly paramsPresentAll?: readonly string[];
  readonly lastMessageRole?: string;
  readonly toolTypes?: readonly string[];
  readonly toolNames?: readonly string[];
  readonly effortNotSupported?: boolean;
}

export type EditOp =
  | { readonly op: 'remove_property'; readonly props: readonly string[] }
  | { readonly op: 'rename_property'; readonly from: string; readonly to: string }
  | { readonly op: 'replace_string_literal'; readonly to: string }
  | { readonly op: 'replace_paired_tool'; readonly type: string; readonly name: string };

export interface Fix {
  readonly confidence: FixConfidence;
  readonly note: string;
  readonly edit?: EditOp;
}

export interface Rule {
  readonly id: string;
  readonly publisher: Publisher;
  readonly kind: RuleKind;
  readonly evidence: Evidence;
  readonly appliesWhen: RuleConditions;
  readonly title: string;
  readonly detail: string;
  readonly fix: Fix;
  readonly sources: readonly string[];
  readonly verifiedAt: string;
}

export interface RuleSet {
  readonly version: string;
  readonly rules: readonly Rule[];
}

// ---------------------------------------------------------------------------
// Scanner output
// ---------------------------------------------------------------------------

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export interface ProvenanceStep {
  readonly file: string;
  readonly line: number;
  readonly kind: 'literal' | 'constant' | 'config' | 'annotation';
}

/**
 * A model-looking string found anywhere. On its own this is inventory, not a
 * verdict: an unbound reference must never produce a failing severity.
 */
export interface ModelReference {
  readonly file: string;
  readonly line: number;
  readonly range: SourceRange;
  readonly raw: string;
  readonly publisher?: Publisher;
  readonly context: ReferenceContext;
  /**
   * True when the match was a complete quoted string literal (`"o1"`), false when it
   * came from the free-text grammar. Word-like tokens (bare `o1`, tier aliases) only
   * earn a finding when quoted — otherwise a variable named `o1` becomes a false
   * deprecation claim (CP1 finding F1).
   */
  readonly viaQuotedLiteral: boolean;
}

/** A discovered invocation of a supported SDK/framework, found independently of Pass A. */
export interface CallSite {
  readonly file: string;
  readonly line: number;
  readonly range: SourceRange;
  readonly publisher?: Publisher;
  readonly servingPlatform: ServingPlatform;
  readonly platformConfidence: PlatformConfidence;
  /** Absent when the model expression could not be resolved statically. */
  readonly model?: string;
  /** Source text of the model expression, resolved or not (kept for reporting). */
  readonly modelExpression: string;
  readonly resolution: Resolution;
  readonly provenance: readonly ProvenanceStep[];
  readonly surface: Surface;
  /** Key absent = param not present. Value `null` = present but unresolvable. */
  readonly params: Readonly<Record<string, unknown>>;
  readonly paramRanges: Readonly<Record<string, SourceRange>>;
}

// ---------------------------------------------------------------------------
// Findings & report
// ---------------------------------------------------------------------------

/**
 * Published-rate comparison along a documented successor edge. Never a claim about
 * what anyone actually pays — usage, caching and discounts are unknown to us.
 *
 * Reported in BOTH directions on purpose. Measured 2026-07-25 across the shipped
 * catalog: of 27 successor pairs with pricing on both sides, only 5 get cheaper on
 * upgrade and 19 get MORE expensive — `gemini-2.0-flash` → `gemini-3.6-flash` is 16×.
 * A tool that only mentions price when upgrading happens to save money is selling,
 * not reporting, and the omission would be doing the most work exactly where a
 * migration is about to blow up someone's bill.
 */
export interface PriceContext {
  readonly currentPricing: Pricing;
  readonly successorPricing: Pricing;
  readonly successorId: string;
  /** Blended (3·in + 1·out)/4 ratio. The 3:1 assumption is always stated in the message. */
  readonly blendedMultiple: number;
  /**
   * `successor_cheaper` — moving off this pin lowers the published rate.
   * `successor_pricier` — the documented successor costs more; budget before migrating.
   */
  readonly direction: 'successor_cheaper' | 'successor_pricier';
}

export interface Finding {
  /**
   * 10-char key over semantic inputs (rule, file, model, target, param) — deliberately
   * NOT byte offsets, so an unrelated edit above the call site doesn't change it.
   * Called a key, not an ID: it is stable in practice, not guaranteed.
   */
  readonly key: string;
  readonly rule: string;
  readonly severity: Severity;
  readonly evidence: Evidence;
  readonly file: string;
  readonly line: number;
  readonly model?: string;
  readonly target?: string;
  readonly servingPlatform: ServingPlatform;
  readonly platformConfidence: PlatformConfidence;
  readonly surface: Surface;
  /** True when a wrapper, unproven platform, or weak evidence lowered the severity. */
  readonly downgraded: boolean;
  readonly downgradeReason?: string;
  readonly message: string;
  readonly fix?: Fix;
  readonly priceContext?: PriceContext;
  readonly sources: readonly string[];
  readonly verifiedAt: string;
}

export interface SuppressedFinding {
  readonly finding: Finding;
  readonly reason: string;
  readonly expires?: string;
  readonly expired: boolean;
}

export interface ReportSummary {
  readonly breaksNow: number;
  readonly upgradeBlocker: number;
  readonly behaviorChange: number;
  readonly stale: number;
  readonly unresolved: number;
  readonly suppressed: number;
}

export interface Report {
  readonly scannedAt: string;
  readonly durationMs: number;
  readonly filesScanned: number;
  readonly callSites: number;
  readonly references: number;
  readonly findings: readonly Finding[];
  readonly suppressed: readonly SuppressedFinding[];
  readonly summary: ReportSummary;
  readonly dataVersion: string;
  readonly cliVersion: string;
}

// ---------------------------------------------------------------------------
// Engine input
// ---------------------------------------------------------------------------

/** A file handed to the engine. The engine never reads the filesystem itself. */
export interface InputFile {
  /** Repo-relative, POSIX separators. */
  readonly path: string;
  readonly text: string;
}

export interface SuppressionRule {
  readonly rule: string;
  readonly path?: string;
  readonly model?: string;
  readonly reason: string;
  readonly expires?: string;
}

export interface AnalyzeOptions {
  readonly target?: string;
  readonly suppress?: readonly SuppressionRule[];
  /** Injected so the engine stays deterministic and free of ambient clocks. */
  readonly now: string;
  readonly cliVersion: string;
}
