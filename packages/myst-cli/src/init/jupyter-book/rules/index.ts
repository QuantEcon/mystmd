import type { UpgradeRule } from '../rule.js';
import { citeParenthetical } from './cite.js';
import { docLinks } from './docLinks.js';
import { hideOutputFalse } from './hideOutput.js';
import { noExecuteTag } from './noExecute.js';
import { notebookHeader } from './notebookHeader.js';

export { collectLabels } from './labels.js';

/**
 * The rewrite rules, in the order they run
 *
 * Each rule sees the document as the rules before it left it. Block rules run
 * before inline rules, so that an inline rule also reaches the content a block
 * rule moved.
 */
export const UPGRADE_RULES: UpgradeRule[] = [
  notebookHeader,
  hideOutputFalse,
  noExecuteTag,
  docLinks,
  citeParenthetical,
];
