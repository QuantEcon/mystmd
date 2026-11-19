import type { UpgradeRule } from '../rule.js';
import { resolveDocument } from './docLinks.js';
import { escapeLinkText, explicitTitle, rewriteRoles } from './inline.js';

/**
 * `{any}`label`` becomes `[](#label)`, and `{any}`text <label>`` `[text](#label)`
 *
 * When the project's labels are known, a target is resolved in this order:
 * - a label of the project (matched case-insensitively) is converted;
 * - a document of the project is left untouched and reported as skipped;
 * - a target with the prefix of an inventory of the project's intersphinx
 *   mapping (`name:rest`) is skipped, as is an unprefixed dotted target
 *   (`numpy.array`) when the project has a mapping at all, since Sphinx
 *   resolves those through the inventories, which cannot be checked offline;
 * - anything else is a broken reference, and fails.
 *
 * Without the project's labels, every target is converted.
 */
export const anyRole: UpgradeRule = {
  name: 'any-role',
  run(lines, api) {
    const labels = api.context.labels
      ? new Set(api.context.labels.map((label) => label.toLowerCase()))
      : undefined;
    const inventories = new Set(api.context.intersphinx ?? []);
    rewriteRoles(lines, api, (role, line) => {
      if (role.name !== 'any') return undefined;
      const { text, target } = explicitTitle(role.content);
      if (labels && !labels.has(target.toLowerCase())) {
        const prefix = /^([^:]+):(.+)$/.exec(target)?.[1];
        if (resolveDocument(target, api.context)) {
          api.skip(line, `{any} target "${target}" is a document of the project, left untouched`);
        } else if (prefix !== undefined && inventories.has(prefix)) {
          api.skip(line, `{any} reference to another project (${target}), left untouched`);
        } else if (prefix === undefined && target.includes('.') && inventories.size) {
          api.skip(
            line,
            `{any} target "${target}" may resolve through the intersphinx inventories, left untouched`,
          );
        } else {
          api.fail(
            line,
            `{any} target "${target}" is neither a label nor a document of the project` +
              (prefix === undefined ? '' : `, and "${prefix}" is not in its intersphinx mapping`),
          );
        }
        return undefined;
      }
      return `[${text === undefined ? '' : escapeLinkText(text)}](#${target})`;
    });
  },
};
