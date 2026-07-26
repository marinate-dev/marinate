import { describe, expect, it } from 'vitest';
import { detectReferences } from './detect.js';

describe('detectReferences', () => {
  it('finds a model string in TypeScript source', () => {
    const refs = detectReferences({
      path: 'src/agent.ts',
      text: `const m = "claude-sonnet-4-5";\nawait client.messages.create({ model: m });`,
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.raw).toBe('claude-sonnet-4-5');
    expect(refs[0]!.publisher).toBe('anthropic');
    expect(refs[0]!.line).toBe(1);
    expect(refs[0]!.context).toBe('callsite-adjacent');
  });

  it('tags publishers by grammar', () => {
    const text = [
      'a = "gpt-4o"',
      'b = "gemini-2.5-pro"',
      'c = "grok-3"',
      'd = "claude-opus-4-8"',
      'e = "mistral-large-latest"',
    ].join('\n');
    const refs = detectReferences({ path: 'x.py', text });
    const byPublisher = Object.fromEntries(refs.map((r) => [r.raw, r.publisher]));
    expect(byPublisher['gpt-4o']).toBe('openai');
    expect(byPublisher['gemini-2.5-pro']).toBe('google');
    expect(byPublisher['grok-3']).toBe('xai');
    expect(byPublisher['claude-opus-4-8']).toBe('anthropic');
    expect(byPublisher['mistral-large-latest']).toBe('mistral');
  });

  it('marks config files with the config context', () => {
    const refs = detectReferences({
      path: 'config/models.json',
      text: `{ "default": "gpt-4o-mini" }`,
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.context).toBe('config');
  });

  it('marks .claude agent config as agent-config context', () => {
    const settings = detectReferences({
      path: '.claude/settings.json',
      text: `{ "model": "opus" }`,
    });
    // "opus" alone is not a full model grammar match; the floating-alias layer handles
    // bare tiers. But a full ID in the same file must be tagged agent-config:
    const withId = detectReferences({
      path: '.claude/settings.json',
      text: `{ "model": "claude-opus-4-8" }`,
    });
    expect(withId[0]!.context).toBe('agent-config');
    expect(settings).toBeDefined();
  });

  it('reports correct line numbers across a multi-line file', () => {
    const text = `line1\nline2 "gpt-4o"\nline3\n"claude-opus-4-8"`;
    const refs = detectReferences({ path: 'x.ts', text });
    const byRaw = Object.fromEntries(refs.map((r) => [r.raw, r.line]));
    expect(byRaw['gpt-4o']).toBe(2);
    expect(byRaw['claude-opus-4-8']).toBe(4);
  });

  it('does not crash or match on a file with no models', () => {
    const refs = detectReferences({ path: 'x.ts', text: 'const x = 1 + 2;\n// nothing here' });
    expect(refs).toEqual([]);
  });

  it('handles the same model appearing twice', () => {
    const refs = detectReferences({
      path: 'x.ts',
      text: `"gpt-4o"\n"gpt-4o"`,
    });
    expect(refs).toHaveLength(2);
  });

  /**
   * Regression: the grammar path used to hardcode viaQuotedLiteral=false, so a real
   * quoted pin in source code could never reach BEHAVIOR CHANGE severity and
   * `--fail-on behavior` could only ever catch floating aliases in JSON/YAML.
   * Found by running against workshop's engine/model_registry.py:114, where an alias
   * whose target retires in 11 days was reported at the lowest tier.
   */
  describe('viaQuotedLiteral', () => {
    const raw = (text: string, want: string) =>
      detectReferences({ path: 'x.py', text }).find((r) => r.raw === want)!;

    it('is true for a double-quoted pin (Python dict key, TS constant)', () => {
      expect(raw('"claude-opus-4-1": {}', 'claude-opus-4-1').viaQuotedLiteral).toBe(true);
    });

    it('is true for single quotes and backticks', () => {
      expect(raw("model = 'gpt-4o'", 'gpt-4o').viaQuotedLiteral).toBe(true);
      expect(raw('const m = `gpt-4o`;', 'gpt-4o').viaQuotedLiteral).toBe(true);
    });

    it('is FALSE for a model named inside a longer string', () => {
      expect(raw('"we moved off gpt-4o last year"', 'gpt-4o').viaQuotedLiteral).toBe(false);
    });

    it('is FALSE in a bare comment', () => {
      expect(raw('# gpt-4o got retired and 404-ed', 'gpt-4o').viaQuotedLiteral).toBe(false);
    });

    it('is FALSE when quotes do not match (opening only)', () => {
      expect(raw('"gpt-4o + rest', 'gpt-4o').viaQuotedLiteral).toBe(false);
    });
  });
});
