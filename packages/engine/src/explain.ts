/**
 * Rule explanations for `marinate check --explain <rule>` (PLAN.md §12).
 *
 * Increment 1's findings are engine-generic (catalog-derived), so their "rules" don't
 * live in rules.json — they're documented here. Each entry explains what the finding
 * means, why it matters, and how the tool decides severity, so a developer can trust
 * (or challenge) any finding they see.
 */

export interface RuleInfo {
  readonly id: string;
  readonly title: string;
  readonly what: string;
  readonly severity: string;
}

export const RULE_INFO: Readonly<Record<string, RuleInfo>> = {
  'LC-RETIRED': {
    id: 'LC-RETIRED',
    title: 'Model is documented as retired',
    what: 'The pinned model appears in an official provider deprecation/retirement list. Retirement handling varies by publisher and serving platform — some reject the request, others redirect to a successor and bill at its rate.',
    severity:
      'Review notice in Increment 1. It is never a build-failing "breaks now" without a proven live call site on a proven platform — a model named in prose or a bare reference cannot fail CI.',
  },
  'LC-DEPRECATED': {
    id: 'LC-DEPRECATED',
    title: 'Model is documented as deprecated',
    what: 'The model still works but is on a published path to retirement. The finding shows the retirement date when the provider states one.',
    severity: 'Informational (stale). Surfaces the deadline so you can migrate before it is forced.',
  },
  'LC-STALE': {
    id: 'LC-STALE',
    title: 'A newer same-family model exists',
    what: 'The provider documents a same-family successor. The finding counts generations behind and, when both list prices are known and differ, adds published-list-rate context (never a claim about what you actually pay).',
    severity: 'Informational (stale).',
  },
  'LC-FLOATING': {
    id: 'LC-FLOATING',
    title: 'Pin is a floating alias',
    what: 'The value is a tier/latest alias (e.g. "opus", "gpt-4o") that re-points to a different concrete model over time, so the deployed model can change with no code edit. The finding shows what it resolves to today and warns if that target is itself deprecated.',
    severity:
      'Behavior-change when it is a real pin (a quoted literal, or any value in a config / agent-config file). An unquoted mention in prose is downgraded and cannot fail CI.',
  },
  'UNKNOWN-MODEL': {
    id: 'UNKNOWN-MODEL',
    title: 'Model-shaped string not in the catalog',
    what: 'A string that looks like a model ID but is not catalogued — a typo, a brand-new release, or a private deployment name. It is reported but not analyzed.',
    severity: 'Unresolved (informational). Never fails CI.',
  },
};

/** Render an explanation for a rule id, or undefined if unknown. */
export function explainRule(id: string): string | undefined {
  const info = RULE_INFO[id.toUpperCase()];
  if (!info) return undefined;
  return [
    `${info.id} — ${info.title}`,
    ``,
    `What it means:`,
    `  ${info.what}`,
    ``,
    `Severity:`,
    `  ${info.severity}`,
    ``,
  ].join('\n');
}
