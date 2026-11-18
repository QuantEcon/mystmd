import { posix } from 'node:path';
import type { UpgradeContext, UpgradeRule } from '../rule.js';
import { escapeLinkText, explicitTitle, rewriteRoles } from './inline.js';

const DOCUMENT_EXTENSIONS = /\.(md|ipynb)$/;

/**
 * Resolve a Sphinx document name as Sphinx does: relative to the page, or
 * from the project root when it starts with `/`
 */
export function resolveDocument(target: string, context: UpgradeContext): string | undefined {
  const page = context.path ?? '';
  const base = target.startsWith('/')
    ? posix.normalize(target.slice(1))
    : posix.join(posix.dirname(page), target);
  const files = new Set(context.files ?? []);
  return [base, `${base}.md`, `${base}.ipynb`].find(
    (candidate) => DOCUMENT_EXTENSIONS.test(candidate) && files.has(candidate),
  );
}

/**
 * The URL of a link from one project file to another
 */
export function relativeUrl(from: string, to: string): string {
  let url = posix.relative(posix.dirname(from), to);
  if (!url.startsWith('../')) url = `./${url}`;
  return /[\s()<>]/.test(url) ? `<${url}>` : url;
}

/**
 * `{doc}`page`` and `{doc}`text <page>`` become Markdown links to the file
 *
 * A target that reaches another project through intersphinx, or names no
 * document in the project, is left untouched and reported as skipped.
 */
export const docLinks: UpgradeRule = {
  name: 'doc-links',
  run(lines, api) {
    rewriteRoles(lines, api, (role, line) => {
      if (role.name !== 'doc') return undefined;
      const { text, target } = explicitTitle(role.content);
      if (target.includes(':')) {
        api.skip(line, `{doc} reference to another project (${target}), left untouched`);
        return undefined;
      }
      const file = resolveDocument(target, api.context);
      if (!file) {
        api.skip(line, `{doc} target "${target}" is not a document of the project, left untouched`);
        return undefined;
      }
      const url = relativeUrl(api.context.path ?? '', file);
      return `[${text === undefined ? '' : escapeLinkText(text)}](${url})`;
    });
  },
};
