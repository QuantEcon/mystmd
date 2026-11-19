import type { UpgradeRule } from '../rule.js';
import { codeCells, editOptionLines, optionEntries } from './options.js';

/** The unquoted YAML spellings of false */
const FALSE_VALUES = new Set(['false', 'False', 'FALSE']);

/**
 * The value of an option, without a trailing YAML comment in a `---` block
 */
function optionValue(value: string, yaml: boolean): string {
  return yaml ? value.replace(/\s+#.*$/, '') : value;
}

/**
 * `:hide-output: false` on a code cell is deleted
 *
 * The option is a no-op, since the output shows. It is deleted for any
 * unquoted YAML spelling of false (`false`, `False`, `FALSE`); any other value
 * fails, because hiding an output is the job of the `hide-output` tag.
 */
export const hideOutputFalse: UpgradeRule = {
  name: 'hide-output-false',
  run(lines, api) {
    codeCells(api.doc.blocks).forEach((block) => {
      const remove = new Set<number>();
      optionEntries(lines, block)
        .filter((entry) => !entry.nested && entry.key === 'hide-output')
        .forEach(({ line, value }) => {
          if (FALSE_VALUES.has(optionValue(value, block.options.yaml))) {
            remove.add(line);
            api.change(line, lines[line], '');
          } else {
            api.fail(
              line,
              `hide-output is "${value}", not false: rewrite it by hand, as a hide-output tag`,
            );
          }
        });
      if (remove.size) editOptionLines(lines, block, api, { remove });
    });
  },
};
