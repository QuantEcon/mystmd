import type { Block } from '../blocks.js';
import { blockBody } from '../blocks.js';
import type { UpgradeRule } from '../rule.js';
import { excerpt } from '../rule.js';

function dedent(line: string, indent: string) {
  return line.startsWith(indent) ? line.slice(indent.length) : line.trimStart();
}

function hasAncestor(block: Block, name: string) {
  for (let parent = block.parent; parent; parent = parent.parent) {
    if (parent.name === name) return true;
  }
  return false;
}

/**
 * `{only} html` becomes its body, in place; `{only} latex` is deleted
 *
 * mystmd has no output-format conditionals, and no PDF build from these
 * sources. Any other expression fails.
 */
export const onlyDirective: UpgradeRule = {
  name: 'only',
  run(lines, api) {
    api.doc.blocks
      .filter((block) => block.name === 'only')
      .forEach((block) => {
        if (hasAncestor(block, 'only')) {
          api.fail(block.open, `{only} inside another {only}: rewrite it by hand`);
          return;
        }
        const format = block.argument.trim();
        if (format !== 'html' && format !== 'latex') {
          api.fail(
            block.open,
            `{only} ${format || '(no expression)'}: only "html" and "latex" can be converted`,
          );
          return;
        }
        if (block.options.end > block.options.start) {
          api.fail(block.open, `{only} with options: rewrite it by hand`);
          return;
        }
        const before = excerpt(lines.slice(block.open, block.close + 1));
        const body = blockBody(lines, block).map((line) => dedent(line, block.indent));
        while (body.length && !body[0].trim()) body.shift();
        while (body.length && !body[body.length - 1].trim()) body.pop();
        const start = block.open;
        let end = block.close + 1;
        if (format === 'latex' || !body.length) {
          // Delete the block, and one of the blank lines that surrounded it
          if (
            end < lines.length &&
            !lines[end].trim() &&
            (start === 0 || !lines[start - 1].trim())
          ) {
            end += 1;
          }
          api.change(block.open, before, '');
          api.replace(start, end, []);
          return;
        }
        // The body keeps blank lines around it, so it stays its own block
        const replacement = [...body];
        if (start > 0 && lines[start - 1].trim()) replacement.unshift('');
        if (end < lines.length && lines[end].trim()) replacement.push('');
        api.change(block.open, before, excerpt(body));
        api.replace(start, end, replacement);
      });
  },
};
