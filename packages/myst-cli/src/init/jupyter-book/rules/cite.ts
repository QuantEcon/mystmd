import type { UpgradeRule } from '../rule.js';
import { rewriteRoles } from './inline.js';

/**
 * A plain `{cite}` becomes `{cite:p}`
 *
 * sphinxcontrib-bibtex renders a plain `{cite}` as a parenthetical citation,
 * where mystmd renders it as a narrative one; `{cite:p}` keeps the meaning.
 */
export const citeParenthetical: UpgradeRule = {
  name: 'cite-parenthetical',
  run(lines, api) {
    rewriteRoles(lines, api, (role) => {
      if (role.name !== 'cite') return undefined;
      return `{cite:p}${role.raw.slice('{cite}'.length)}`;
    });
  },
};
