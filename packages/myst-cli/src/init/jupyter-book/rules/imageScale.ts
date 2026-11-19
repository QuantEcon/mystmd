import type { UpgradeRule } from '../rule.js';
import { optionEntries } from './options.js';

const SCALE = /^(\d+(?:\.\d+)?)\s*%?$/;

/**
 * `:scale: N` or `:scale: N%` on a figure or an image becomes `:width: N%`
 *
 * A scale beside a width, or a scale that is not a number, is left untouched.
 */
export const imageScale: UpgradeRule = {
  name: 'image-scale',
  run(lines, api) {
    api.doc.blocks
      .filter((block) => block.name === 'figure' || block.name === 'image')
      .forEach((block) => {
        const entries = optionEntries(lines, block).filter((entry) => !entry.nested);
        const scale = entries.find((entry) => entry.key === 'scale');
        if (!scale) return;
        if (entries.some((entry) => entry.key === 'width' || entry.key === 'w')) {
          api.skip(scale.line, `{${block.name}} has both a scale and a width, left untouched`);
          return;
        }
        const match = SCALE.exec(scale.value);
        if (!match) {
          api.skip(
            scale.line,
            `{${block.name}} scale "${scale.value}" is not a number, left untouched`,
          );
          return;
        }
        const before = lines[scale.line];
        const after = before.replace(/(:?)scale(:?)\s*.*$/, `$1width$2 ${match[1]}%`);
        api.change(scale.line, before, after);
        api.replace(scale.line, scale.line + 1, [after]);
      });
  },
};
