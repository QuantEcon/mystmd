import { blockBody } from '../blocks.js';
import type { UpgradeRule } from '../rule.js';

/**
 * A bare `{youtube} <id>` becomes `{iframe} https://www.youtube.com/embed/<id>`
 *
 * A video with options or content fails: the iframe has no equivalent to guess.
 */
export const youtube: UpgradeRule = {
  name: 'youtube',
  run(lines, api) {
    api.doc.blocks
      .filter((block) => block.name === 'youtube')
      .forEach((block) => {
        const id = block.argument.trim();
        if (!/^[\w-]+$/.test(id)) {
          api.fail(block.open, `{youtube} "${id}" is not a video id: rewrite it by hand`);
          return;
        }
        const hasOptions = block.options.end > block.options.start;
        const hasBody = blockBody(lines, block).some((line) => line.trim());
        if (hasOptions || hasBody) {
          api.fail(block.open, `{youtube} with options or content: rewrite it by hand`);
          return;
        }
        const before = lines[block.open];
        const after = `${block.indent}${block.marker}{iframe} https://www.youtube.com/embed/${id}`;
        api.change(block.open, before, after);
        api.replace(block.open, block.open + 1, [after]);
      });
  },
};
