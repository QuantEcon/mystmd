import type { UpgradeRule } from '../rule.js';
import { excerpt } from '../rule.js';
import { blockBody } from '../blocks.js';

const HEADER = /id\s*=\s*["']qe-notebook-header["']/;

/**
 * Whether a `{raw}` block is the notebook logo header
 */
export function isNotebookHeader(body: string[]): boolean {
  return HEADER.test(body.join('\n'));
}

/**
 * The notebook logo header, a `{raw} jupyter` or `{raw} html` block, is deleted
 *
 * The header belongs to the notebook export (`project.settings.myst_to_ipynb.header`),
 * not to a copy in every document.
 */
export const notebookHeader: UpgradeRule = {
  name: 'notebook-header',
  run(lines, api) {
    api.doc.blocks
      .filter((block) => block.name === 'raw' && isNotebookHeader(blockBody(lines, block)))
      .forEach((block) => {
        let end = block.close + 1;
        // The blank line below the block goes with it, so that a target above
        // the header stays attached to the heading below it
        if (end < lines.length && lines[end].trim() === '') end += 1;
        api.change(block.open, excerpt(lines.slice(block.open, block.close + 1)), '');
        api.replace(block.open, end, []);
      });
  },
};
