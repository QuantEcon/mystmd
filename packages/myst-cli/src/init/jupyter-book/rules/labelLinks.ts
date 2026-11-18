import { posix } from 'node:path';
import type { UpgradeContext, UpgradeRule } from '../rule.js';
import { rewriteLinkUrls } from './inline.js';

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const LINK_PROTOCOLS = /^(mailto|tel|doi|wiki|xref|rrid|ror|github|data):/i;

/**
 * The project file a bare link URL names, relative to the page or the project root
 */
function resolveFile(url: string, context: UpgradeContext): string | undefined {
  const files = new Set(context.files ?? []);
  const candidates = [posix.join(posix.dirname(context.path ?? ''), url), posix.normalize(url)];
  return candidates
    .flatMap((base) => [base, `${base}.md`, `${base}.ipynb`])
    .find((candidate) => files.has(candidate));
}

/**
 * `[text](label)`, a bare label as the URL, becomes `[text](#label)`
 *
 * A URL that is neither a target in the project nor a file fails. URLs with a
 * scheme, a path, an anchor or a file extension are not bare labels.
 */
export const labelLinks: UpgradeRule = {
  name: 'label-links',
  run(lines, api) {
    const { labels } = api.context;
    if (!labels) return;
    const known = new Map(labels.map((label) => [label.toLowerCase(), label]));
    rewriteLinkUrls(lines, api, (link, line) => {
      const { url } = link;
      if (link.image) return undefined;
      if (/^[#/.]/.test(url) || /[#/?]/.test(url)) return undefined;
      if (URL_SCHEME.test(url) || LINK_PROTOCOLS.test(url)) return undefined;
      if (known.has(url.toLowerCase())) return `#${url}`;
      const file = resolveFile(url, api.context);
      if (file) {
        api.skip(line, `link to "${url}" names the file ${file}, not a label, left untouched`);
        return undefined;
      }
      // A file name with an extension, even a missing one, is not a label
      if (/\.[A-Za-z0-9]+$/.test(url)) return undefined;
      api.fail(line, `link to "${url}" is neither a target in the project nor a file`);
      return undefined;
    });
  },
};
