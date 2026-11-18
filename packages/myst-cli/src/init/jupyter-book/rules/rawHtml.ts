import { blockBody } from '../blocks.js';
import type { UpgradeRule } from '../rule.js';
import { excerpt } from '../rule.js';
import { isNotebookHeader } from './notebookHeader.js';

// Each shape is recognised only when the body is the whole element and nothing
// else: a body that merely starts with one may carry anything after it.
const IFRAME = /^<iframe\b[^>]*>\s*<\/iframe>$/;
const TABLE = /^<table[\s>][\s\S]*<\/table>$/;
const SRC = /\bsrc\s*=\s*["']([^"']+)["']/;

/**
 * The `{raw} html` blocks other than the notebook header: an `<iframe>`
 * becomes the `{iframe}` directive, and a `<table>` becomes plain HTML in the
 * Markdown, which mystmd turns into a table
 *
 * mystmd renders no `raw` node, so any other `{raw}` block fails.
 */
export const rawHtml: UpgradeRule = {
  name: 'raw-html',
  run(lines, api) {
    api.doc.blocks
      .filter((block) => block.name === 'raw')
      .forEach((block) => {
        const body = blockBody(lines, block);
        // The notebook header has its own rule
        if (isNotebookHeader(body)) return;
        const format = block.argument.trim();
        const html = body.join('\n').trim();
        const before = excerpt(lines.slice(block.open, block.close + 1));
        if (format === 'html' && IFRAME.test(html)) {
          const src = SRC.exec(html);
          if (!src) {
            api.fail(block.open, `{raw} html iframe with no src: rewrite it by hand`);
            return;
          }
          // `:width: 100%` is the only sizing the markup sets that the directive also expresses
          const replacement = [
            `${block.indent}${block.marker}{iframe} ${src[1]}`,
            `${block.indent}:width: 100%`,
            `${block.indent}${block.marker}`,
          ];
          api.change(block.open, before, excerpt(replacement));
          api.replace(block.open, block.close + 1, replacement);
          return;
        }
        if (format === 'html' && TABLE.test(html)) {
          // An HTML block runs on until a blank line, so the table keeps blank
          // lines around it, or the Markdown beside it is swallowed
          const replacement = [...body];
          while (replacement.length && !replacement[0].trim()) replacement.shift();
          while (replacement.length && !replacement[replacement.length - 1].trim()) {
            replacement.pop();
          }
          const tableLines = [...replacement];
          if (block.open > 0 && lines[block.open - 1].trim()) replacement.unshift('');
          if (block.close + 1 < lines.length && lines[block.close + 1].trim()) replacement.push('');
          api.change(block.open, before, excerpt(tableLines));
          api.replace(block.open, block.close + 1, replacement);
          return;
        }
        api.fail(
          block.open,
          `{raw} ${format || '(no format)'} is neither the notebook header, an HTML table nor an iframe: rewrite it by hand`,
        );
      });
  },
};
