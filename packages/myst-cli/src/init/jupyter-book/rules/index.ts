import type { UpgradeRule } from '../rule.js';
import { anyRole } from './anyRole.js';
import { bibliographyArgument } from './bibliography.js';
import { citeParenthetical } from './cite.js';
import { docLinks } from './docLinks.js';
import { hideOutputFalse } from './hideOutput.js';
import { imageScale } from './imageScale.js';
import { labelLinks } from './labelLinks.js';
import { noExecuteTag } from './noExecute.js';
import { notebookHeader } from './notebookHeader.js';
import { onlyDirective } from './only.js';
import { proofKind } from './proofKind.js';
import { youtube } from './youtube.js';

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
  onlyDirective,
  youtube,
  imageScale,
  proofKind,
  bibliographyArgument,
  hideOutputFalse,
  noExecuteTag,
  docLinks,
  anyRole,
  labelLinks,
  citeParenthetical,
];
