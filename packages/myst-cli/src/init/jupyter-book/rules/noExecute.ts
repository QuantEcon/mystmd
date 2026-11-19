import type { UpgradeRule } from '../rule.js';
import { codeCells, editOptionLines, optionEntries } from './options.js';

const TAG = 'no-execute';

function unquote(value: string) {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Remove the tag from a list written inline, `[a, b]` or `a, b`
 *
 * @returns the new value, or `undefined` when the tag is not in the list
 */
function removeFromList(value: string): string | undefined {
  const bracketed = /^\[(.*)\]$/.exec(value.trim());
  const items = (bracketed ? bracketed[1] : value)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item);
  const kept = items.filter((item) => unquote(item) !== TAG);
  if (kept.length === items.length) return undefined;
  return bracketed ? `[${kept.join(', ')}]` : kept.join(', ');
}

/**
 * The `no-execute` cell tag is removed: neither Sphinx nor mystmd knows it
 *
 * Only the tags of a code cell are touched; a `no-execute` class on a code
 * block is not a tag.
 */
export const noExecuteTag: UpgradeRule = {
  name: 'no-execute-tag',
  run(lines, api) {
    codeCells(api.doc.blocks).forEach((block) => {
      const remove = new Set<number>();
      const replace = new Map<number, string[]>();
      const entries = optionEntries(lines, block);
      entries.forEach((entry, index) => {
        if (entry.nested || entry.key !== 'tags') return;
        if (entry.value) {
          const value = removeFromList(entry.value);
          if (value === undefined) return;
          const before = lines[entry.line];
          if (value === '' || value === '[]') {
            remove.add(entry.line);
            api.change(entry.line, before, '');
          } else {
            const after = `${before.slice(0, before.lastIndexOf(entry.value))}${value}`;
            replace.set(entry.line, [after]);
            api.change(entry.line, before, after);
          }
          return;
        }
        // A YAML block list: the items are the nested lines below the key
        const items: number[] = [];
        for (let k = index + 1; k < entries.length && entries[k].nested; k++) {
          if (/^\s*-\s/.test(lines[entries[k].line])) items.push(entries[k].line);
        }
        const tagged = items.filter(
          (line) => unquote(lines[line].replace(/^\s*-\s*/, '').trim()) === TAG,
        );
        if (!tagged.length) return;
        tagged.forEach((line) => {
          remove.add(line);
          api.change(line, lines[line], '');
        });
        if (tagged.length === items.length) remove.add(entry.line);
      });
      if (remove.size || replace.size) editOptionLines(lines, block, api, { remove, replace });
    });
  },
};
