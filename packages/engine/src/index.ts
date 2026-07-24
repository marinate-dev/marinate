/**
 * @marinate-audit/engine — pure analysis core.
 *
 * Hard constraint: this package must never import `node:fs`, `node:process`,
 * `node:net`, or perform any IO. Everything it needs arrives as arguments and
 * everything it produces is returned. That is what keeps analysis deterministic
 * and testable, and it is what lets the same code later run in a browser
 * playground or an MCP server with no refactor (PLAN.md §11).
 */

export * from './types.js';
export { analyze } from './analyze.js';
export { detectReferences, detectAll } from './detect.js';
export {
  indexCatalog,
  generationsBehind,
  priceContextFor,
  type CatalogIndex,
} from './catalog.js';
export { findingKey } from './key.js';
export {
  assertValidCatalogFile,
  assertValidFloatingFile,
  validateCatalogEntry,
  validateFloatingAlias,
} from './validate.js';
export { RULE_INFO, explainRule } from './explain.js';

/** Engine version, reported for reproducibility. */
export const ENGINE_VERSION = '0.1.0';
