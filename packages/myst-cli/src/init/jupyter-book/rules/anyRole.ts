import type { UpgradeRule } from '../rule.js';
import { escapeLinkText, explicitTitle, rewriteRoles } from './inline.js';

/**
 * `{any}`label`` becomes `[](#label)`, and `{any}`text <label>`` `[text](#label)`
 *
 * When the project's labels are known, a target that is not one of them is
 * left untouched: it may name a document or another project.
 */
export const anyRole: UpgradeRule = {
  name: 'any-role',
  run(lines, api) {
    const labels = api.context.labels
      ? new Set(api.context.labels.map((label) => label.toLowerCase()))
      : undefined;
    rewriteRoles(lines, api, (role, line) => {
      if (role.name !== 'any') return undefined;
      const { text, target } = explicitTitle(role.content);
      if (labels && !labels.has(target.toLowerCase())) {
        api.skip(line, `{any} target "${target}" is not a label in the project, left untouched`);
        return undefined;
      }
      return `[${text === undefined ? '' : escapeLinkText(text)}](#${target})`;
    });
  },
};
