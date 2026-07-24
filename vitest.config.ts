import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Tests run against engine SOURCE, not its built `dist/`.
 *
 * Without this, a CLI test that imports a runtime value from `@marinate-audit/engine`
 * resolves through the package's `exports` → `dist/index.js`, making the test suite
 * depend on `pnpm build` having run first — which is racy across platforms (it failed
 * on some CI runners and passed on others). Aliasing the bare package specifier to its
 * source entry makes `pnpm test` self-contained and deterministic everywhere.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@marinate-audit/engine': fileURLToPath(new URL('./packages/engine/src/index.ts', import.meta.url)),
    },
  },
});
